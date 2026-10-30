/**
 * Fish Rain — Global Leaderboard Client & Nickname Validator (Shared Client/Server)
 * Thin, defensive wrapper around the /api endpoints. Never throws; gracefully handles
 * offline or static hosting while keeping Local Records 100% functional.
 */

export const AUTO_SUBMIT_KEY = 'stabthefinger_fishrain_v1_auto_submit';
export const NICKNAME_KEY = 'stabthefinger_fishrain_v1_nickname';
export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 16;
const NICKNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u;

const BANNED_SUBSTRINGS = [
  'fuck', 'fuk', 'fuq', 'fck', 'phuck', 'shit', 'sh1t', 'bitch', 'b1tch',
  'asshole', 'cunt', 'kunt', 'dickhead', 'pussy', 'whore', 'wh0re', 'bastard',
  'faggot', 'fagot', 'nigga', 'nigger', 'n1gg', 'chink', 'wetback', 'spic',
  'kike', 'retard', 'r3tard', 'nazi', 'hitler', 'porn', 'p0rn', 'jizz',
  'penis', 'vagina', 'blowjob', 'dildo', 'rapist', 'suicide', 'killurself'
];

const LEET_MAP = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's'
};

function deLeet(str) {
  let out = '';
  for (const ch of str.toLowerCase()) {
    out += LEET_MAP[ch] || ch;
  }
  return out.replace(/[^a-z0-9]/g, '');
}

const DEFAULT_NICK_ADJECTIVES = [
  'Soggy', 'Stormy', 'Lucky', 'Salty', 'Nimble', 'Steady', 'Brave', 'Swift',
  'Captain', 'Drizzly', 'Tidal', 'Mighty', 'Golden', 'Reckless', 'Clever', 'Dizzy'
];

const DEFAULT_NICK_NOUNS = [
  'Angler', 'Marlin', 'Skipper', 'Trout', 'Catfish', 'Dinghy', 'Sailor',
  'Pelican', 'Tackle', 'Minnow', 'Barnacle', 'Fisher', 'Voyager', 'Oarsman'
];

/**
 * Generates a friendly, valid default fishing nickname (e.g. "SoggySkipper42").
 */
export function generateDefaultNickname() {
  const adj = DEFAULT_NICK_ADJECTIVES[Math.floor(Math.random() * DEFAULT_NICK_ADJECTIVES.length)];
  const noun = DEFAULT_NICK_NOUNS[Math.floor(Math.random() * DEFAULT_NICK_NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  const candidate = `${adj}${noun}${num}`;
  return candidate.length > NICKNAME_MAX ? candidate.slice(0, NICKNAME_MAX) : candidate;
}

/**
 * Normalizes and validates a player nickname.
 * Returns { ok: true, value } or { ok: false, message }.
 */
export function validateNickname(raw) {
  if (typeof raw !== 'string') return { ok: false, message: 'Nickname must be text.' };
  const normalized = raw.normalize('NFKC');
  if (/\p{C}/u.test(normalized)) {
    return { ok: false, message: 'Nickname contains invalid control characters.' };
  }
  const value = normalized.trim().replace(/ {2,}/g, ' ');
  const len = [...value].length;
  if (len < NICKNAME_MIN) return { ok: false, message: 'Please enter a nickname.' };
  if (len > NICKNAME_MAX) {
    return { ok: false, message: `Nickname must be ${NICKNAME_MAX} characters or fewer.` };
  }
  if (!NICKNAME_RE.test(value)) {
    return {
      ok: false,
      message: "Nickname may only use letters, numbers, spaces and _ . ' - (starting with a letter or number)."
    };
  }
  const cleanCheck = deLeet(value);
  for (const banned of BANNED_SUBSTRINGS) {
    if (cleanCheck.includes(banned)) {
      return {
        ok: false,
        message: 'Nickname not allowed. Please choose a family-friendly fishing name.'
      };
    }
  }
  return { ok: true, value };
}

let inMemoryAutoSubmit = false;
let inMemoryNickname = '';

export function loadAutoSubmitPreference() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(AUTO_SUBMIT_KEY) === 'true';
    }
    return inMemoryAutoSubmit;
  } catch {
    return inMemoryAutoSubmit;
  }
}

export function saveAutoSubmitPreference(enabled) {
  const val = Boolean(enabled);
  inMemoryAutoSubmit = val;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AUTO_SUBMIT_KEY, val ? 'true' : 'false');
    }
  } catch {
    /* fallback to in-memory */
  }
  return val;
}

export function loadSavedNickname() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(NICKNAME_KEY);
      if (typeof stored === 'string') {
        inMemoryNickname = stored;
        return stored;
      }
    }
    return inMemoryNickname;
  } catch {
    return inMemoryNickname;
  }
}

export function saveNickname(nickname) {
  const str = typeof nickname === 'string' ? nickname : '';
  inMemoryNickname = str;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(NICKNAME_KEY, str);
    }
  } catch {
    /* ignore */
  }
  return str;
}

const REQUEST_TIMEOUT_MS = 8000;

function apiBase() {
  const base = typeof window !== 'undefined' && window.FISHRAIN_API_BASE;
  return typeof base === 'string' ? base.replace(/\/+$/, '') : '';
}

export function isNetworkAvailable() {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}

async function request(method, pathAndQuery, body) {
  if (!isNetworkAvailable()) {
    return { ok: false, status: 0, code: 'offline', message: 'Global leaderboard is offline.' };
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await window.fetch(`${apiBase()}${pathAndQuery}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
      credentials: 'omit'
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const defaultMsg =
        res.status === 404
          ? 'The global leaderboard API is not available on this server.'
          : `Request failed (${res.status}).`;
      return {
        ok: false,
        status: res.status,
        code: json?.error?.code || (res.status === 404 ? 'not_found' : 'http_error'),
        message: json?.error?.message || defaultMsg
      };
    }
    return { ok: true, data: json };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      code: aborted ? 'timeout' : 'network_error',
      message: aborted ? 'The leaderboard took too long to respond.' : 'Could not reach the global leaderboard.'
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Requests a signed, single-use game session token when a run starts.
 */
export async function createSession(gameMode = 'CAMPAIGN', startEnvId = 'PUDDLE') {
  const res = await request('POST', '/api/sessions', { gameMode, startEnvId });
  return res.ok && typeof res.data?.token === 'string' ? res.data.token : null;
}

/**
 * Submits a completed run to the global leaderboard.
 */
export function submitScore(payload) {
  return request('POST', '/api/scores', payload);
}

/**
 * Queries the global leaderboard with optional filters:
 * - env: 'all' or an environment ID ('PUDDLE' .. 'OPEN_OCEAN')
 * - mode: 'all', 'CAMPAIGN', or 'QUICK_PLAY'
 * - sort: 'score' (default) or 'level'
 */
export function fetchLeaderboard({
  env = 'all',
  mode = 'all',
  sort = 'score',
  limit = 25,
  offset = 0
} = {}) {
  const q = new URLSearchParams({
    env,
    mode,
    sort,
    limit: String(limit),
    offset: String(offset)
  });
  return request('GET', `/api/leaderboard?${q.toString()}`);
}
