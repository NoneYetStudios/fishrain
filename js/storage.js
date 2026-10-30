/**
 * Fish Rain — LocalStorage Persistence & Personal Records Manager
 * Persists unlocked levels, personal bests (overall & per body of water),
 * control preferences, tilt sensitivity, and sound mute setting.
 */

import { ENVIRONMENTS, ENVIRONMENT_ORDER, CONTROL_MODES } from './config.js';

export const STORAGE_KEY = 'stabthefinger_fishrain_v1_records';

function createEmptyEnvStats() {
  return {
    bestScore: 0,
    timesCleared: 0,
    bestCombo: 0,
    flawlessClears: 0
  };
}

export function createDefaultRecords() {
  const byEnv = {};
  for (const envId of ENVIRONMENT_ORDER) {
    byEnv[envId] = createEmptyEnvStats();
  }
  return {
    version: 1,
    muted: false,
    controlMode: 'HYBRID',
    tiltSensitivity: 1.2,
    unlockedLevel: 1,
    overall: {
      bestScore: 0,
      highestLevel: 1,
      gamesPlayed: 0,
      totalFishCaught: 0,
      legendaryCaught: 0,
      longestCombo: 0,
      bestCatchName: 'None Yet',
      bestCatchPoints: 0
    },
    byEnv
  };
}

let inMemoryFallback = createDefaultRecords();

const numOrZero = (val) => {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

export function sanitizeRecords(raw) {
  const defaults = createDefaultRecords();
  if (!raw || typeof raw !== 'object') return defaults;

  defaults.muted = Boolean(raw.muted);
  defaults.controlMode = CONTROL_MODES[raw.controlMode] ? raw.controlMode : 'HYBRID';

  const sens = Number(raw.tiltSensitivity);
  defaults.tiltSensitivity = Number.isFinite(sens) ? Math.max(0.5, Math.min(2.5, sens)) : 1.2;

  const ul = numOrZero(raw.unlockedLevel);
  defaults.unlockedLevel = Math.max(1, Math.min(ENVIRONMENT_ORDER.length, ul || 1));

  if (raw.overall && typeof raw.overall === 'object') {
    defaults.overall.bestScore = numOrZero(raw.overall.bestScore);
    defaults.overall.highestLevel = Math.max(1, Math.min(8, numOrZero(raw.overall.highestLevel) || 1));
    defaults.overall.gamesPlayed = numOrZero(raw.overall.gamesPlayed);
    defaults.overall.totalFishCaught = numOrZero(raw.overall.totalFishCaught);
    defaults.overall.legendaryCaught = numOrZero(raw.overall.legendaryCaught);
    defaults.overall.longestCombo = numOrZero(raw.overall.longestCombo);
    defaults.overall.bestCatchName =
      typeof raw.overall.bestCatchName === 'string' && raw.overall.bestCatchName.trim()
        ? raw.overall.bestCatchName.trim().slice(0, 48)
        : 'None Yet';
    defaults.overall.bestCatchPoints = numOrZero(raw.overall.bestCatchPoints);
  }

  if (raw.byEnv && typeof raw.byEnv === 'object') {
    for (const envId of ENVIRONMENT_ORDER) {
      const src = raw.byEnv[envId];
      if (src && typeof src === 'object') {
        defaults.byEnv[envId] = {
          bestScore: numOrZero(src.bestScore),
          timesCleared: numOrZero(src.timesCleared),
          bestCombo: numOrZero(src.bestCombo),
          flawlessClears: numOrZero(src.flawlessClears)
        };
      }
    }
  }

  return defaults;
}

export function loadRecords() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return sanitizeRecords(inMemoryFallback);
    }
    const rawStr = window.localStorage.getItem(STORAGE_KEY);
    if (!rawStr) {
      return sanitizeRecords(inMemoryFallback);
    }
    const parsed = JSON.parse(rawStr);
    const sanitized = sanitizeRecords(parsed);
    inMemoryFallback = sanitized;
    return sanitized;
  } catch (_err) {
    return sanitizeRecords(inMemoryFallback);
  }
}

export function saveRecords(records) {
  const sanitized = sanitizeRecords(records);
  inMemoryFallback = sanitized;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    }
  } catch (_err) {
    /* keep in-memory fallback */
  }
  return sanitized;
}

export function unlockEnvironmentLevel(levelNumber) {
  const records = loadRecords();
  const clamped = Math.max(1, Math.min(ENVIRONMENT_ORDER.length, Math.floor(Number(levelNumber) || 1)));
  if (clamped > records.unlockedLevel) {
    records.unlockedLevel = clamped;
  }
  if (clamped > records.overall.highestLevel) {
    records.overall.highestLevel = clamped;
  }
  return saveRecords(records);
}

export function recordLevelCompletion({ envId, levelScore, maxCombo, flawless }) {
  const records = loadRecords();
  const env = ENVIRONMENTS[envId];
  if (!env) return records;

  const envStats = records.byEnv[envId] || createEmptyEnvStats();
  envStats.timesCleared += 1;
  if (levelScore > envStats.bestScore) {
    envStats.bestScore = Math.floor(levelScore);
  }
  if (maxCombo > envStats.bestCombo) {
    envStats.bestCombo = Math.floor(maxCombo);
  }
  if (flawless) {
    envStats.flawlessClears += 1;
  }
  records.byEnv[envId] = envStats;

  const nextLevel = Math.min(ENVIRONMENT_ORDER.length, env.level + 1);
  if (nextLevel > records.unlockedLevel) {
    records.unlockedLevel = nextLevel;
  }
  if (nextLevel > records.overall.highestLevel) {
    records.overall.highestLevel = nextLevel;
  }

  return saveRecords(records);
}

export function recordRunFinished({
  finalScore = 0,
  highestEnvId = 'PUDDLE',
  totalFishCaught = 0,
  legendaryCaught = 0,
  maxCombo = 0,
  bestCatchName = 'None Yet',
  bestCatchPoints = 0
}) {
  const records = loadRecords();
  const env = ENVIRONMENTS[highestEnvId] || ENVIRONMENTS.PUDDLE;
  const scoreVal = Math.max(0, Math.floor(Number(finalScore) || 0));

  const prevBest = records.overall.bestScore;
  const prevEnvBest = records.byEnv[env.id]?.bestScore || 0;

  records.overall.gamesPlayed += 1;
  records.overall.totalFishCaught += numOrZero(totalFishCaught);
  records.overall.legendaryCaught += numOrZero(legendaryCaught);

  if (scoreVal > records.overall.bestScore) {
    records.overall.bestScore = scoreVal;
  }
  if (env.level > records.overall.highestLevel) {
    records.overall.highestLevel = env.level;
  }
  if (env.level > records.unlockedLevel) {
    records.unlockedLevel = env.level;
  }
  if (maxCombo > records.overall.longestCombo) {
    records.overall.longestCombo = numOrZero(maxCombo);
  }
  if (bestCatchPoints > records.overall.bestCatchPoints && bestCatchName) {
    records.overall.bestCatchPoints = numOrZero(bestCatchPoints);
    records.overall.bestCatchName = String(bestCatchName).slice(0, 48);
  }

  const envStats = records.byEnv[env.id] || createEmptyEnvStats();
  if (scoreVal > envStats.bestScore) {
    envStats.bestScore = scoreVal;
  }
  if (maxCombo > envStats.bestCombo) {
    envStats.bestCombo = numOrZero(maxCombo);
  }
  records.byEnv[env.id] = envStats;

  const saved = saveRecords(records);
  return {
    records: saved,
    isNewOverallBest: scoreVal > 0 && scoreVal > prevBest,
    isNewEnvBest: scoreVal > 0 && scoreVal > prevEnvBest,
    previousOverallBest: prevBest
  };
}

export function updatePreferences({ muted, controlMode, tiltSensitivity }) {
  const records = loadRecords();
  if (muted !== undefined) records.muted = Boolean(muted);
  if (controlMode !== undefined && CONTROL_MODES[controlMode]) {
    records.controlMode = controlMode;
  }
  if (tiltSensitivity !== undefined) {
    const s = Number(tiltSensitivity);
    if (Number.isFinite(s)) {
      records.tiltSensitivity = Math.max(0.5, Math.min(2.5, s));
    }
  }
  return saveRecords(records);
}

export function resetRecords() {
  const current = loadRecords();
  const fresh = createDefaultRecords();
  fresh.muted = current.muted;
  fresh.controlMode = current.controlMode;
  fresh.tiltSensitivity = current.tiltSensitivity;
  return saveRecords(fresh);
}
