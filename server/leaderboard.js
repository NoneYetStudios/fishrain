/**
 * Fish Rain — Global Leaderboard API (zero external npm dependencies).
 *
 * Storage: SQLite via Node's built-in `node:sqlite` (DatabaseSync in WAL mode).
 * Security:
 *  - Parameterized SQL queries only
 *  - Stateless HMAC-SHA256 single-use session tokens (`POST /api/sessions`)
 *  - Server-side score recomputation & anti-cheat bounds verification (`recomputeFinalScore`)
 *  - Wall-clock run duration plausibility checks
 *  - Shared family-friendly nickname validation (`validateNickname`)
 *  - Per-IP rate limiting & strict body size limits
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ENVIRONMENTS, ENVIRONMENT_ORDER, FALLING_OBJECTS } from '../js/config.js';
import { recomputeFinalScore, SCORE_LIMITS } from '../js/scoring.js';
import { validateNickname } from '../js/leaderboard.js';
export { validateNickname };

export const LIMITS = {
  MAX_BODY_BYTES: 2048,
  NICKNAME_MIN: 1,
  NICKNAME_MAX: 16,
  MAX_ELAPSED_SECONDS: SCORE_LIMITS.MAX_ELAPSED_SECONDS,
  TOKEN_TTL_MS: 3 * 60 * 60 * 1000,
  MIN_RUN_WALL_MS: 2000,
  ELAPSED_SLACK_MS: 5000,
  PAGE_SIZE_DEFAULT: 25,
  PAGE_SIZE_MAX: 50,
  MAX_OFFSET: 10000
};

export const RATE_LIMITS = {
  sessions: { max: 30, windowMs: 60_000 },
  submit: { max: 10, windowMs: 60_000 },
  read: { max: 120, windowMs: 60_000 }
};

const SUBMIT_FIELDS = new Set([
  'token',
  'nickname',
  'gameMode',
  'startEnvId',
  'highestEnvId',
  'levelsCleared',
  'flawlessLevels',
  'catchesByRarity',
  'hazardsHit',
  'maxCombo',
  'catchScore',
  'achievements',
  'bestCatchName',
  'elapsedSeconds',
  'score'
]);

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Stateless HMAC-SHA256 Session Token Signer                          */
/* ------------------------------------------------------------------ */

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function createTokenSigner(secret, now = () => Date.now()) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest();
  return {
    issue(gameMode, startEnvId) {
      const payload = {
        v: 1,
        n: crypto.randomBytes(16).toString('hex'),
        m: gameMode,
        e: startEnvId,
        t: now()
      };
      const body = b64u(JSON.stringify(payload));
      return {
        token: `${body}.${b64u(sign(body))}`,
        expiresAt: payload.t + LIMITS.TOKEN_TTL_MS
      };
    },
    verify(token) {
      if (typeof token !== 'string' || token.length > 420) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [body, sig] = parts;
      let given;
      try {
        given = Buffer.from(sig, 'base64url');
      } catch {
        return null;
      }
      const expected = sign(body);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        return null;
      }
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (p.v !== 1 || typeof p.n !== 'string' || typeof p.t !== 'number') return null;
        return p;
      } catch {
        return null;
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Fixed-Window Per-IP Rate Limiter                                    */
/* ------------------------------------------------------------------ */

export function createRateLimiter(limits, now = () => Date.now()) {
  const buckets = new Map();
  return {
    hit(kind, key) {
      const cfg = limits[kind];
      const t = now();
      if (buckets.size > 10000) {
        for (const [k, b] of buckets) {
          if (b.resetAt <= t) buckets.delete(k);
        }
      }
      const id = `${kind}|${key}`;
      let b = buckets.get(id);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + cfg.windowMs };
        buckets.set(id, b);
      }
      b.count += 1;
      return {
        allowed: b.count <= cfg.max,
        retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000))
      };
    }
  };
}

/* ------------------------------------------------------------------ */
/* SQLite Schema, Migrations & Store                                   */
/* ------------------------------------------------------------------ */

const ENV_SQL_LIST = ENVIRONMENT_ORDER.map((k) => `'${k}'`).join(',');

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE scores (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id       TEXT    NOT NULL UNIQUE,
        nickname         TEXT    NOT NULL CHECK (length(nickname) BETWEEN 1 AND 64),
        score            INTEGER NOT NULL CHECK (score BETWEEN 0 AND ${SCORE_LIMITS.MAX_TOTAL_SCORE}),
        game_mode        TEXT    NOT NULL CHECK (game_mode IN ('CAMPAIGN', 'QUICK_PLAY')),
        start_env_id     TEXT    NOT NULL CHECK (start_env_id IN (${ENV_SQL_LIST})),
        highest_env_id   TEXT    NOT NULL CHECK (highest_env_id IN (${ENV_SQL_LIST})),
        highest_level    INTEGER NOT NULL CHECK (highest_level BETWEEN 1 AND 8),
        levels_cleared   INTEGER NOT NULL CHECK (levels_cleared BETWEEN 0 AND 8),
        flawless_levels  INTEGER NOT NULL CHECK (flawless_levels BETWEEN 0 AND 8),
        fish_caught      INTEGER NOT NULL CHECK (fish_caught >= 0),
        legendary_caught INTEGER NOT NULL CHECK (legendary_caught >= 0),
        max_combo        INTEGER NOT NULL CHECK (max_combo >= 0),
        best_catch_name  TEXT    NOT NULL DEFAULT '',
        elapsed_seconds  INTEGER NOT NULL CHECK (elapsed_seconds BETWEEN 2 AND ${LIMITS.MAX_ELAPSED_SECONDS}),
        created_at       INTEGER NOT NULL
      );
      CREATE INDEX idx_scores_rank       ON scores (score DESC, highest_level DESC, created_at ASC, id ASC);
      CREATE INDEX idx_scores_level_rank ON scores (highest_level DESC, score DESC, created_at ASC, id ASC);
      CREATE INDEX idx_scores_env_rank   ON scores (highest_env_id, score DESC, created_at ASC, id ASC);
      CREATE INDEX idx_scores_mode_rank  ON scores (game_mode, score DESC, created_at ASC, id ASC);
    `
  }
];

const WHERE = {
  none: '',
  env: 'WHERE highest_env_id = ?',
  mode: 'WHERE game_mode = ?',
  both: 'WHERE highest_env_id = ? AND game_mode = ?'
};

const RANK_COND = `(
  score > ?
  OR (score = ? AND highest_level > ?)
  OR (score = ? AND highest_level = ? AND created_at < ?)
  OR (score = ? AND highest_level = ? AND created_at = ? AND id < ?)
)`;

export function openDatabase(dbPath, { seedIfEmpty = false } = {}) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  migrate(db);
  if (seedIfEmpty) {
    seedInitialLeaderboard(db);
  }
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function seedInitialLeaderboard(db) {
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM scores').get().n);
  if (count > 0) return;

  const now = Date.now();
  const seeds = [
    ['seed_fr_1', 'CaptainBarnacle', 38450, 'CAMPAIGN', 'PUDDLE', 'OPEN_OCEAN', 8, 8, 4, 148, 6, 26, 'The Sovereign Golden Marlin', 410, now - 86400000 * 4],
    ['seed_fr_2', 'RogueWaveRider', 29800, 'CAMPAIGN', 'PUDDLE', 'COAST', 7, 6, 3, 122, 3, 21, 'Baby Kraken Tentacle-Bass', 345, now - 86400000 * 3],
    ['seed_fr_3', 'SoggySkipper42', 22150, 'CAMPAIGN', 'PUDDLE', 'BAY', 6, 5, 2, 98, 2, 18, 'Living Fossil Coelacanth', 290, now - 86400000 * 2],
    ['seed_fr_4', 'AnvilDodger99', 16400, 'CAMPAIGN', 'PUDDLE', 'SWIFT_RIVER', 5, 4, 2, 81, 0, 15, 'Imperial Golden Koi', 230, now - 86400000 * 2],
    ['seed_fr_5', 'TroutMagnet', 11250, 'CAMPAIGN', 'PUDDLE', 'CALM_RIVER', 4, 3, 1, 64, 0, 14, 'High-Voltage Eel', 185, now - 86400000],
    ['seed_fr_6', 'BootCollector7', 7420, 'CAMPAIGN', 'PUDDLE', 'LAKE', 3, 2, 1, 46, 0, 11, 'Imperial Golden Koi', 135, now - 43200000],
    ['seed_fr_7', 'PondPioneer', 3890, 'CAMPAIGN', 'PUDDLE', 'POND', 2, 1, 1, 28, 0, 9, 'Northern Pike', 85, now - 21600000],
    ['seed_fr_8', 'PuddleSplash10', 1480, 'QUICK_PLAY', 'PUDDLE', 'PUDDLE', 1, 1, 1, 14, 0, 7, 'Largemouth Bass', 42, now - 7200000]
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO scores (
      session_id, nickname, score, game_mode, start_env_id, highest_env_id,
      highest_level, levels_cleared, flawless_levels, fish_caught, legendary_caught,
      max_combo, best_catch_name, elapsed_seconds, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const s of seeds) {
      stmt.run(...s);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function filterParts(filter) {
  const hasEnv = Boolean(filter.env);
  const hasMode = Boolean(filter.mode);
  const key = hasEnv && hasMode ? 'both' : hasEnv ? 'env' : hasMode ? 'mode' : 'none';
  const params = [];
  if (hasEnv) params.push(filter.env);
  if (hasMode) params.push(filter.mode);
  return { where: WHERE[key], params };
}

export function createStore(db) {
  const insertStmt = db.prepare(`
    INSERT INTO scores (
      session_id, nickname, score, game_mode, start_env_id, highest_env_id,
      highest_level, levels_cleared, flawless_levels, fish_caught, legendary_caught,
      max_combo, best_catch_name, elapsed_seconds, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function count(filter = {}) {
    const { where, params } = filterParts(filter);
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM scores ${where}`).get(...params).n);
  }

  function rankOf(row, filter = {}) {
    const { where, params } = filterParts(filter);
    const joiner = where ? `${where} AND` : 'WHERE';
    const sql = `SELECT COUNT(*) AS n FROM scores ${joiner} ${RANK_COND}`;
    const n = Number(
      db
        .prepare(sql)
        .get(
          ...params,
          row.score,
          row.score,
          row.highest_level,
          row.score,
          row.highest_level,
          row.created_at,
          row.score,
          row.highest_level,
          row.created_at,
          row.id
        ).n
    );
    return n + 1;
  }

  const toEntry = (r) => ({
    nickname: r.nickname,
    score: r.score,
    gameMode: r.game_mode,
    startEnvId: r.start_env_id,
    highestEnvId: r.highest_env_id,
    highestLevel: r.highest_level,
    levelsCleared: r.levels_cleared,
    flawlessLevels: r.flawless_levels,
    fishCaught: r.fish_caught,
    legendaryCaught: r.legendary_caught,
    maxCombo: r.max_combo,
    bestCatchName: r.best_catch_name,
    elapsedSeconds: r.elapsed_seconds,
    createdAt: r.created_at
  });

  return {
    insertScore(rec) {
      db.exec('BEGIN IMMEDIATE');
      try {
        let info;
        try {
          info = insertStmt.run(
            rec.sessionId,
            rec.nickname,
            rec.score,
            rec.gameMode,
            rec.startEnvId,
            rec.highestEnvId,
            rec.highestLevel,
            rec.levelsCleared,
            rec.flawlessLevels,
            rec.fishCaught,
            rec.legendaryCaught,
            rec.maxCombo,
            rec.bestCatchName,
            rec.elapsedSeconds,
            rec.createdAt
          );
        } catch (err) {
          if (/UNIQUE/i.test(String(err.message))) {
            throw new ApiError(409, 'duplicate', 'This game session has already been submitted.');
          }
          throw err;
        }

        const row = {
          id: Number(info.lastInsertRowid),
          nickname: rec.nickname,
          score: rec.score,
          game_mode: rec.gameMode,
          start_env_id: rec.startEnvId,
          highest_env_id: rec.highestEnvId,
          highest_level: rec.highestLevel,
          levels_cleared: rec.levelsCleared,
          flawless_levels: rec.flawlessLevels,
          fish_caught: rec.fishCaught,
          legendary_caught: rec.legendaryCaught,
          max_combo: rec.maxCombo,
          best_catch_name: rec.bestCatchName,
          elapsed_seconds: rec.elapsedSeconds,
          created_at: rec.createdAt
        };

        const ranks = {
          global: rankOf(row, {}),
          env: rankOf(row, { env: rec.highestEnvId }),
          mode: rankOf(row, { mode: rec.gameMode })
        };

        db.exec('COMMIT');
        return { entry: toEntry(row), ranks };
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        throw err;
      }
    },

    list(filter, sort, limit, offset) {
      const { where, params } = filterParts(filter);
      const orderBy =
        sort === 'level'
          ? 'ORDER BY highest_level DESC, score DESC, created_at ASC, id ASC'
          : 'ORDER BY score DESC, highest_level DESC, created_at ASC, id ASC';

      const rows = db
        .prepare(
          `SELECT id, nickname, score, game_mode, start_env_id, highest_env_id,
                  highest_level, levels_cleared, flawless_levels, fish_caught,
                  legendary_caught, max_combo, best_catch_name, elapsed_seconds, created_at
           FROM scores ${where} ${orderBy} LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

      return {
        entries: rows.map((r, i) => ({ rank: offset + i + 1, ...toEntry(r) })),
        total: count(filter)
      };
    },

    count
  };
}

/* ------------------------------------------------------------------ */
/* HTTP Request Handler                                                */
/* ------------------------------------------------------------------ */

function clientKey(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      const parts = xff
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const ctype = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (ctype !== 'application/json') {
      reject(new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.'));
      req.resume();
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > LIMITS.MAX_BODY_BYTES) {
      reject(new ApiError(413, 'payload_too_large', 'Request body too large.'));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > LIMITS.MAX_BODY_BYTES) {
        aborted = true;
        reject(new ApiError(413, 'payload_too_large', 'Request body too large.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        resolve(parsed);
      } catch {
        reject(new ApiError(400, 'invalid_json', 'Request body must be a JSON object.'));
      }
    });
    req.on('error', () => reject(new ApiError(400, 'invalid_request', 'Request failed.')));
  });
}

function intParam(value, name, { min, max, def }) {
  if (value === null || value === undefined || value === '') return def;
  if (!/^\d{1,6}$/.test(value)) throw new ApiError(400, 'invalid_query', `Invalid "${name}".`);
  const n = Number(value);
  if (n < min || n > max) {
    throw new ApiError(400, 'invalid_query', `"${name}" must be between ${min} and ${max}.`);
  }
  return n;
}

const ALLOWED_BEST_CATCH_NAMES = new Set([
  '',
  'None Yet',
  ...Object.values(FALLING_OBJECTS)
    .filter((o) => o.category === 'FISH')
    .map((o) => o.name)
]);

export function createLeaderboardApi({
  dbPath = ':memory:',
  secret,
  now = () => Date.now(),
  rateLimits = RATE_LIMITS,
  allowedOrigin = null,
  trustProxy = false,
  seedIfEmpty = dbPath !== ':memory:'
} = {}) {
  if (!secret || String(secret).length < 16) {
    throw new Error('LEADERBOARD_SECRET must be set to a random string of at least 16 characters.');
  }
  const db = openDatabase(dbPath, { seedIfEmpty });
  const store = createStore(db);
  const signer = createTokenSigner(secret, now);
  const limiter = createRateLimiter(rateLimits, now);

  function send(req, res, status, body, extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...extraHeaders
    };
    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin;
      headers.Vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function enforce(kind, req) {
    const r = limiter.hit(kind, clientKey(req, trustProxy));
    if (!r.allowed) {
      const err = new ApiError(429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.');
      err.retryAfterSec = r.retryAfterSec;
      throw err;
    }
  }

  async function createSession(req, res) {
    enforce('sessions', req);
    const body = await readJsonBody(req);
    const gameMode = body.gameMode === undefined ? 'CAMPAIGN' : body.gameMode;
    if (gameMode !== 'CAMPAIGN' && gameMode !== 'QUICK_PLAY') {
      throw new ApiError(400, 'invalid_mode', 'Unsupported game mode.');
    }
    const startEnvId = body.startEnvId === undefined ? 'PUDDLE' : body.startEnvId;
    if (typeof startEnvId !== 'string' || !Object.prototype.hasOwnProperty.call(ENVIRONMENTS, startEnvId)) {
      throw new ApiError(400, 'invalid_env', 'Unsupported environment.');
    }
    if (gameMode === 'CAMPAIGN' && startEnvId !== 'PUDDLE') {
      throw new ApiError(400, 'invalid_env', 'Campaign runs must start at the Puddle.');
    }
    const { token, expiresAt } = signer.issue(gameMode, startEnvId);
    send(req, res, 201, { token, expiresAt });
  }

  async function submitScore(req, res) {
    enforce('submit', req);
    const body = await readJsonBody(req);

    for (const k of Object.keys(body)) {
      if (!SUBMIT_FIELDS.has(k)) {
        throw new ApiError(400, 'unknown_field', `Unexpected field "${k}".`);
      }
    }

    const claims = signer.verify(body.token);
    if (!claims) {
      throw new ApiError(401, 'invalid_token', 'Invalid game session token.');
    }
    const t = now();
    if (claims.t > t + 1000 || t - claims.t > LIMITS.TOKEN_TTL_MS) {
      throw new ApiError(401, 'token_expired', 'This game session has expired.');
    }

    if (body.gameMode !== claims.m || body.startEnvId !== claims.e) {
      throw new ApiError(422, 'session_mismatch', 'Submission does not match the signed game session.');
    }

    const nick = validateNickname(body.nickname);
    if (!nick.ok) {
      throw new ApiError(422, 'invalid_nickname', nick.message);
    }

    if (!Number.isInteger(body.score) || body.score < 0 || body.score > SCORE_LIMITS.MAX_TOTAL_SCORE) {
      throw new ApiError(400, 'invalid_score', 'Score is out of range.');
    }

    const recomputed = recomputeFinalScore(body);
    if (!recomputed) {
      throw new ApiError(422, 'invalid_components', 'Inconsistent or out-of-range score components.');
    }
    if (recomputed.finalScore !== body.score) {
      throw new ApiError(422, 'score_mismatch', 'Submitted score does not match the official game scoring formula.');
    }

    const wallMs = t - claims.t;
    if (wallMs < LIMITS.MIN_RUN_WALL_MS || body.elapsedSeconds * 1000 > wallMs + LIMITS.ELAPSED_SLACK_MS) {
      throw new ApiError(422, 'implausible_run', 'Run timing does not match the game session.');
    }

    const rawBestCatch = typeof body.bestCatchName === 'string' ? body.bestCatchName.trim() : 'None Yet';
    const bestCatchName = ALLOWED_BEST_CATCH_NAMES.has(rawBestCatch) ? rawBestCatch : 'None Yet';

    const result = store.insertScore({
      sessionId: claims.n,
      nickname: nick.value,
      score: recomputed.finalScore,
      gameMode: recomputed.gameMode,
      startEnvId: recomputed.startEnvId,
      highestEnvId: recomputed.highestEnvId,
      highestLevel: recomputed.highestLevel,
      levelsCleared: body.levelsCleared,
      flawlessLevels: body.flawlessLevels,
      fishCaught: recomputed.totalFishCaught,
      legendaryCaught: body.catchesByRarity?.LEGENDARY || 0,
      maxCombo: body.maxCombo || 0,
      bestCatchName,
      elapsedSeconds: body.elapsedSeconds,
      createdAt: t
    });

    send(req, res, 201, result);
  }

  function getLeaderboard(req, res, url) {
    enforce('read', req);
    const q = url.searchParams;
    const envParam = q.get('env');
    if (
      envParam !== null &&
      envParam !== '' &&
      envParam !== 'all' &&
      !Object.prototype.hasOwnProperty.call(ENVIRONMENTS, envParam)
    ) {
      throw new ApiError(400, 'invalid_query', 'Unsupported environment filter.');
    }

    const modeParam = q.get('mode');
    if (modeParam !== null && modeParam !== '' && modeParam !== 'all' && modeParam !== 'CAMPAIGN' && modeParam !== 'QUICK_PLAY') {
      throw new ApiError(400, 'invalid_query', 'Unsupported game mode filter.');
    }

    const sortParam = q.get('sort') || 'score';
    if (sortParam !== 'score' && sortParam !== 'level') {
      throw new ApiError(400, 'invalid_query', 'Unsupported sort parameter.');
    }

    const limit = intParam(q.get('limit'), 'limit', {
      min: 1,
      max: LIMITS.PAGE_SIZE_MAX,
      def: LIMITS.PAGE_SIZE_DEFAULT
    });
    const offset = intParam(q.get('offset'), 'offset', {
      min: 0,
      max: LIMITS.MAX_OFFSET,
      def: 0
    });

    const filter = {
      env: envParam && envParam !== 'all' ? envParam : null,
      mode: modeParam && modeParam !== 'all' ? modeParam : null
    };

    const { entries, total } = store.list(filter, sortParam, limit, offset);
    send(
      req,
      res,
      200,
      {
        entries,
        total,
        limit,
        offset,
        sort: sortParam,
        filter: { env: filter.env, mode: filter.mode }
      },
      { 'Cache-Control': 'public, max-age=5' }
    );
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;

    try {
      if (req.method === 'OPTIONS') {
        const headers = {};
        if (allowedOrigin && req.headers.origin === allowedOrigin) {
          headers['Access-Control-Allow-Origin'] = allowedOrigin;
          headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
          headers['Access-Control-Allow-Headers'] = 'Content-Type';
          headers['Access-Control-Max-Age'] = '600';
          headers.Vary = 'Origin';
        }
        res.writeHead(204, headers);
        res.end();
        return true;
      }

      const route = url.pathname;
      if (route === '/api/health') {
        if (req.method !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        send(req, res, 200, { ok: true, service: 'Fish Rain Leaderboard API' });
      } else if (route === '/api/leaderboard') {
        if (req.method !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        getLeaderboard(req, res, url);
      } else if (route === '/api/sessions') {
        if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        await createSession(req, res);
      } else if (route === '/api/scores') {
        if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        await submitScore(req, res);
      } else {
        throw new ApiError(404, 'not_found', 'Unknown API endpoint.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const extra = err.retryAfterSec ? { 'Retry-After': String(err.retryAfterSec) } : {};
        if (err.status === 405) extra.Allow = 'GET, POST, OPTIONS';
        send(req, res, err.status, { error: { code: err.code, message: err.message } }, extra);
      } else {
        console.error('Leaderboard internal error:', err?.message || err);
        send(req, res, 500, { error: { code: 'internal_error', message: 'Internal server error.' } });
      }
    }
    return true;
  }

  let closed = false;
  return {
    handle,
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    },
    store
  };
}
