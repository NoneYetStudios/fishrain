/**
 * Fish Rain — Global Leaderboard API, SQLite Persistence & Anti-Cheat Test Suite
 * Run: node --no-warnings tests/leaderboard_api.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recomputeFinalScore } from '../js/scoring.js';
import { createAppServer, resolvePublicFile } from '../server.js';
import { validateNickname } from '../server/leaderboard.js';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
  }
}

const SECRET = 'fishrain-test-secret-0123456789abcdef';
const BIG_LIMITS = {
  sessions: { max: 50000, windowMs: 60000 },
  submit: { max: 50000, windowMs: 60000 },
  read: { max: 50000, windowMs: 60000 }
};

async function startServer({
  dbPath = ':memory:',
  rateLimits = BIG_LIMITS,
  clock = { offset: 0 },
  seedIfEmpty = false,
  env = {}
} = {}) {
  const server = await createAppServer({
    dbPath,
    quiet: true,
    now: () => Date.now() + clock.offset,
    rateLimits: rateLimits === 'default' ? undefined : rateLimits,
    seedIfEmpty,
    env: { LEADERBOARD_SECRET: SECRET, ...env }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((r) => server.close(r));
  return { server, base, clock, stop };
}

async function api(base, method, urlPath, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(base + urlPath, init);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, headers: res.headers };
}

function buildValidRunPayload(token, over = {}) {
  const base = {
    gameMode: 'CAMPAIGN',
    startEnvId: 'PUDDLE',
    highestEnvId: 'LAKE',
    levelsCleared: 2,
    flawlessLevels: 1,
    catchesByRarity: {
      COMMON: 12,
      UNCOMMON: 6,
      RARE: 2,
      LEGENDARY: 0,
      BONUS: 1,
      NEUTRAL: 3
    },
    hazardsHit: 1,
    maxCombo: 11,
    catchScore: 3450,
    achievements: ['COMBO_10', 'BOOT_COLLECTOR'],
    bestCatchName: 'Imperial Golden Koi',
    elapsedSeconds: 45,
    ...over
  };
  const rc = recomputeFinalScore(base);
  assert.ok(rc, 'buildValidRunPayload must produce a valid recomputed score');
  return {
    token,
    nickname: over.nickname || 'SoggySkipper42',
    ...base,
    score: over.score !== undefined ? over.score : rc.finalScore
  };
}

console.log('\n=== 1. Health, Static Security & Nickname Validation ===');

const ctx = await startServer();

await check('GET /api/health returns 200 OK', async () => {
  const r = await api(ctx.base, 'GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

await check('Static server blocks access to database files, server scripts, and dotfiles', async () => {
  assert.equal(resolvePublicFile('/data/leaderboard.sqlite'), null);
  assert.equal(resolvePublicFile('/server.js'), null);
  assert.equal(resolvePublicFile('/package.json'), null);
  assert.equal(resolvePublicFile('/../lemstand/package.json'), null);

  const resDb = await fetch(`${ctx.base}/data/leaderboard.sqlite`);
  assert.equal(resDb.status, 404);
  const resPkg = await fetch(`${ctx.base}/package.json`);
  assert.equal(resPkg.status, 404);
});

await check('Nickname validator accepts clean names and rejects XSS, control chars, and profanity', () => {
  assert.equal(validateNickname('CaptainTrout99').ok, true);
  assert.equal(validateNickname('Bass Master').ok, true);
  assert.equal(validateNickname('').ok, false);
  assert.equal(validateNickname('TooLongNickname12345').ok, false);
  assert.equal(validateNickname('<script>alert(1)').ok, false);
  assert.equal(validateNickname('f_u_c_k_you').ok, false);
});

console.log('\n=== 2. Session Issuance, Score Verification & Anti-Cheat ===');

await check('Issues signed session token and accepts verified score submission', async () => {
  const sess = await api(ctx.base, 'POST', '/api/sessions', {
    gameMode: 'CAMPAIGN',
    startEnvId: 'PUDDLE'
  });
  assert.equal(sess.status, 201);
  assert.ok(sess.json.token);

  // Advance server clock by 50 seconds
  ctx.clock.offset += 50_000;

  const payload = buildValidRunPayload(sess.json.token, { nickname: 'MarlinHunter' });
  const sub = await api(ctx.base, 'POST', '/api/scores', payload);
  assert.equal(sub.status, 201);
  assert.equal(sub.json.entry.nickname, 'MarlinHunter');
  assert.equal(sub.json.entry.score, payload.score);
  assert.equal(sub.json.ranks.global, 1);
  assert.equal(sub.json.ranks.env, 1);
});

await check('Rejects duplicate submission of the same session token with 409', async () => {
  const sess = await api(ctx.base, 'POST', '/api/sessions', {
    gameMode: 'CAMPAIGN',
    startEnvId: 'PUDDLE'
  });
  ctx.clock.offset += 50_000;
  const payload = buildValidRunPayload(sess.json.token, { nickname: 'OnceOnly' });

  const first = await api(ctx.base, 'POST', '/api/scores', payload);
  assert.equal(first.status, 201);

  const second = await api(ctx.base, 'POST', '/api/scores', payload);
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, 'duplicate');
});

await check('Rejects arbitrary score forgery (score_mismatch) and impossible catchScore', async () => {
  const sess = await api(ctx.base, 'POST', '/api/sessions', {
    gameMode: 'CAMPAIGN',
    startEnvId: 'PUDDLE'
  });
  ctx.clock.offset += 50_000;

  // Claim 99,999 points when formula says 5,115
  const forged = buildValidRunPayload(sess.json.token, { score: 99999 });
  const r1 = await api(ctx.base, 'POST', '/api/scores', forged);
  assert.equal(r1.status, 422);
  assert.equal(r1.json.error.code, 'score_mismatch');

  // Claim impossible catchScore = 500,000 for 12 common fish
  const badComp = {
    ...buildValidRunPayload(sess.json.token),
    catchScore: 400000,
    score: 401665
  };
  const r2 = await api(ctx.base, 'POST', '/api/scores', badComp);
  assert.equal(r2.status, 422);
  assert.equal(r2.json.error.code, 'invalid_components');
});

await check('Rejects instant 0-second bot submissions and session environment mismatches', async () => {
  const sess = await api(ctx.base, 'POST', '/api/sessions', {
    gameMode: 'CAMPAIGN',
    startEnvId: 'PUDDLE'
  });
  // Do NOT advance server clock (0ms wall time)
  const payload = buildValidRunPayload(sess.json.token);
  const fastRes = await api(ctx.base, 'POST', '/api/scores', payload);
  assert.equal(fastRes.status, 422);
  assert.equal(fastRes.json.error.code, 'implausible_run');

  // Now advance clock, but claim QUICK_PLAY on OPEN_OCEAN using a CAMPAIGN/PUDDLE token
  ctx.clock.offset += 50_000;
  const mismatchPayload = buildValidRunPayload(sess.json.token, {
    gameMode: 'QUICK_PLAY',
    startEnvId: 'OPEN_OCEAN',
    highestEnvId: 'OPEN_OCEAN',
    levelsCleared: 1,
    flawlessLevels: 1,
    catchScore: 9500
  });
  const misRes = await api(ctx.base, 'POST', '/api/scores', mismatchPayload);
  assert.equal(misRes.status, 422);
  assert.equal(misRes.json.error.code, 'session_mismatch');
});

console.log('\n=== 3. Deterministic Tie-Breaking, Filtering, Sorting & Disk Persistence ===');

await check('Breaks ties deterministically (earlier timestamp wins ties) and supports filtering', async () => {
  const ctxTie = await startServer();

  const s1 = await api(ctxTie.base, 'POST', '/api/sessions', { gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE' });
  const s2 = await api(ctxTie.base, 'POST', '/api/sessions', { gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE' });

  ctxTie.clock.offset += 50_000;
  const p1 = buildValidRunPayload(s1.json.token, { nickname: 'FirstSkipper' });
  await api(ctxTie.base, 'POST', '/api/scores', p1);

  ctxTie.clock.offset += 5_000;
  const p2 = buildValidRunPayload(s2.json.token, { nickname: 'SecondSkipper' });
  await api(ctxTie.base, 'POST', '/api/scores', p2);

  const board = await api(ctxTie.base, 'GET', '/api/leaderboard?env=all&mode=all&sort=score');
  assert.equal(board.status, 200);
  assert.equal(board.json.total, 2);
  assert.equal(board.json.entries[0].nickname, 'FirstSkipper');
  assert.equal(board.json.entries[0].rank, 1);
  assert.equal(board.json.entries[1].nickname, 'SecondSkipper');
  assert.equal(board.json.entries[1].rank, 2);

  await ctxTie.stop();
});

await check('Persists scores across server restarts in on-disk SQLite WAL database', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishrain-sqlite-'));
  const dbFile = path.join(tmpDir, 'leaderboard.sqlite');

  const srv1 = await startServer({ dbPath: dbFile, seedIfEmpty: true });
  const initialBoard = await api(srv1.base, 'GET', '/api/leaderboard');
  assert.equal(initialBoard.status, 200);
  assert.equal(initialBoard.json.total, 8, 'Seeds 8 default arcade entries when new file DB created');

  // Submit a new #1 score (50,000+ pts)
  const sess = await api(srv1.base, 'POST', '/api/sessions', { gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE' });
  srv1.clock.offset += 65_000;
  const topPayload = buildValidRunPayload(sess.json.token, {
    nickname: 'DiskPersistPro',
    highestEnvId: 'OPEN_OCEAN',
    levelsCleared: 8,
    flawlessLevels: 5,
    catchesByRarity: { COMMON: 30, UNCOMMON: 25, RARE: 15, LEGENDARY: 8, BONUS: 4, NEUTRAL: 4 },
    maxCombo: 25,
    catchScore: 42000,
    achievements: ['FIRST_LEGENDARY', 'COMBO_10', 'COMBO_20', 'BOOT_COLLECTOR', 'ROGUE_SURVIVOR'],
    elapsedSeconds: 60
  });
  const sub = await api(srv1.base, 'POST', '/api/scores', topPayload);
  assert.equal(sub.status, 201);
  assert.equal(sub.json.ranks.global, 1);
  await srv1.stop();

  // Restart a fresh server instance pointing at the same SQLite file
  const srv2 = await startServer({ dbPath: dbFile, seedIfEmpty: true });
  const afterRestart = await api(srv2.base, 'GET', '/api/leaderboard?limit=5');
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.json.total, 9);
  assert.equal(afterRestart.json.entries[0].nickname, 'DiskPersistPro');
  assert.equal(afterRestart.json.entries[0].score, topPayload.score);
  await srv2.stop();

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

await ctx.stop();

console.log(`\nLeaderboard API Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
