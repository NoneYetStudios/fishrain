/**
 * Fish Rain — Scoring & Server-Verifiable Run Calculation Module
 * Shared between Browser Client and Node.js Leaderboard Backend.
 */

import {
  ENVIRONMENTS,
  ENVIRONMENT_ORDER,
  FALLING_OBJECTS,
  ACHIEVEMENTS
} from './config.js';

export const SCORE_LIMITS = {
  MAX_TOTAL_SCORE: 500000,
  MAX_CATCHES_PER_TIER: 600,
  MAX_ELAPSED_SECONDS: 7200,
  MIN_ELAPSED_SECONDS: 2
};

/**
 * Returns the combo multiplier for a given consecutive catch streak.
 */
export function getComboMultiplier(streak) {
  const s = Math.max(0, Math.floor(Number(streak) || 0));
  if (s >= 20) return 3.0;
  if (s >= 15) return 2.5;
  if (s >= 10) return 2.0;
  if (s >= 6) return 1.5;
  if (s >= 3) return 1.25;
  return 1.0;
}

/**
 * Returns a human-readable tier label for the current combo streak.
 */
export function getComboTierLabel(streak) {
  const s = Math.max(0, Math.floor(Number(streak) || 0));
  if (s >= 20) return '⚡ UNSTOPPABLE (3.0×)';
  if (s >= 15) return '🔥 FEVER NET (2.5×)';
  if (s >= 10) return '🔥 HOT STREAK (2.0×)';
  if (s >= 6) return '✨ DIALED IN (1.5×)';
  if (s >= 3) return '👍 NICE RHYTHM (1.25×)';
  return '1.0×';
}

/**
 * Computes exact points awarded for catching a single object.
 */
export function calculateCatchPoints(objectId, streak, envId) {
  const obj = FALLING_OBJECTS[objectId];
  const env = ENVIRONMENTS[envId] || ENVIRONMENTS.PUDDLE;
  if (!obj || obj.points <= 0) return 0;
  const comboMult = getComboMultiplier(streak);
  return Math.round(obj.points * comboMult * env.difficultyMultiplier);
}

/**
 * Rarity point bounds (min base points and max base points in FALLING_OBJECTS).
 */
export const TIER_BASE_BOUNDS = {
  COMMON: { min: 50, max: 110 },
  UNCOMMON: { min: 180, max: 300 },
  RARE: { min: 420, max: 620 },
  LEGENDARY: { min: 900, max: 2000 },
  BONUS: { min: 200, max: 650 }, // lifering at full health can grant 250 + 400 = 650 base
  NEUTRAL: { min: 0, max: 0 }
};

/**
 * Recomputes and validates a completed run's score and component statistics.
 * Returns null if any component is malformed, out of range, or mathematically inconsistent.
 */
export function recomputeFinalScore(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const gameMode = payload.gameMode;
  if (gameMode !== 'CAMPAIGN' && gameMode !== 'QUICK_PLAY') return null;

  const startEnvId = payload.startEnvId;
  const highestEnvId = payload.highestEnvId;
  const startIdx = ENVIRONMENT_ORDER.indexOf(startEnvId);
  const highIdx = ENVIRONMENT_ORDER.indexOf(highestEnvId);
  if (startIdx === -1 || highIdx === -1 || highIdx < startIdx) return null;
  if (gameMode === 'CAMPAIGN' && startEnvId !== 'PUDDLE') return null;
  if (gameMode === 'QUICK_PLAY' && highIdx !== startIdx) return null;

  const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

  const maxPossibleLevels = gameMode === 'CAMPAIGN' ? highIdx - startIdx + 1 : 1;
  const minPossibleLevels = gameMode === 'CAMPAIGN' ? highIdx - startIdx : 0;
  const levelsCleared = payload.levelsCleared;
  const flawlessLevels = payload.flawlessLevels;
  if (!isInt(levelsCleared, minPossibleLevels, maxPossibleLevels)) return null;
  if (!isInt(flawlessLevels, 0, levelsCleared)) return null;

  const elapsedSeconds = payload.elapsedSeconds;
  if (!isInt(elapsedSeconds, SCORE_LIMITS.MIN_ELAPSED_SECONDS, SCORE_LIMITS.MAX_ELAPSED_SECONDS)) {
    return null;
  }

  const hazardsHit = payload.hazardsHit ?? 0;
  if (!isInt(hazardsHit, 0, 50)) return null;

  const rawRarities = payload.catchesByRarity;
  if (!rawRarities || typeof rawRarities !== 'object') return null;

  const tiers = ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'BONUS', 'NEUTRAL'];
  const counts = {};
  for (const t of tiers) {
    const c = rawRarities[t] ?? 0;
    if (!isInt(c, 0, SCORE_LIMITS.MAX_CATCHES_PER_TIER)) return null;
    counts[t] = c;
  }

  const totalFishCaught = counts.COMMON + counts.UNCOMMON + counts.RARE + counts.LEGENDARY;
  const totalPositiveCatches = totalFishCaught + counts.BONUS;
  const maxCombo = payload.maxCombo ?? 0;
  // Each doubloon can add +2 to combo, so maxCombo can be up to totalPositiveCatches + counts.BONUS * 2
  const maxPossibleCombo = totalPositiveCatches + counts.BONUS * 2;
  if (!isInt(maxCombo, 0, Math.max(0, maxPossibleCombo))) return null;
  if (totalPositiveCatches > 0 && maxCombo < 1) return null;

  // Verify catchScore against mathematical min/max bounds for the claimed catches
  const catchScore = payload.catchScore;
  if (!isInt(catchScore, 0, SCORE_LIMITS.MAX_TOTAL_SCORE)) return null;

  const minEnvMult = ENVIRONMENTS[startEnvId].difficultyMultiplier;
  const maxEnvMult = ENVIRONMENTS[highestEnvId].difficultyMultiplier;
  const maxComboMult = getComboMultiplier(maxCombo);

  let minCatchBound = 0;
  let maxCatchBound = 0;
  for (const t of ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'BONUS']) {
    const n = counts[t];
    if (n > 0) {
      minCatchBound += n * Math.floor(TIER_BASE_BOUNDS[t].min * 1.0 * minEnvMult);
      maxCatchBound += n * Math.ceil(TIER_BASE_BOUNDS[t].max * maxComboMult * maxEnvMult);
    }
  }

  if (totalPositiveCatches === 0 && catchScore !== 0) return null;
  if (catchScore < minCatchBound || catchScore > maxCatchBound) return null;

  // Compute deterministic level clear and flawless bonuses
  let levelBonusTotal = 0;
  let flawlessBonusTotal = 0;
  for (let i = 0; i < levelsCleared; i++) {
    const envKey = ENVIRONMENT_ORDER[startIdx + i];
    const env = ENVIRONMENTS[envKey];
    if (env) {
      levelBonusTotal += env.levelClearBonus;
    }
  }

  if (flawlessLevels > 0) {
    // Flawless levels can be any subset of cleared levels; to keep client & server 100% deterministic,
    // flawlessLevels is either an integer count (using the first N cleared levels in Quick Play or Campaign)
    // OR we compute from cleared environments in order:
    // Better yet: each cleared level grants env.flawlessBonus when cleared flawlessly, OR we use a standard
    // formula: flawlessLevels * 350 * averageDifficulty, OR let's make flawless bonus deterministic per level!
    // Wait: if we pass `flawlessLevelIds` or make flawless bonus = `flawlessLevels * 400`, then any subset of
    // flawless levels has an exact deterministic value from `flawlessLevels` alone!
    flawlessBonusTotal = flawlessLevels * 400;
  }

  // Validate achievements and sum achievement bonuses
  const rawAchievements = Array.isArray(payload.achievements) ? payload.achievements : [];
  if (rawAchievements.length > Object.keys(ACHIEVEMENTS).length) return null;
  const seenAch = new Set();
  let achievementBonusTotal = 0;

  for (const achId of rawAchievements) {
    if (typeof achId !== 'string' || !ACHIEVEMENTS[achId] || seenAch.has(achId)) return null;
    seenAch.add(achId);

    // Verify achievement prerequisites against run stats
    if (achId === 'FIRST_LEGENDARY' && counts.LEGENDARY < 1) return null;
    if (achId === 'COMBO_10' && maxCombo < 10) return null;
    if (achId === 'COMBO_20' && maxCombo < 20) return null;
    if (achId === 'BOOT_COLLECTOR' && counts.NEUTRAL < 3) return null;
    if (achId === 'ROGUE_SURVIVOR' && highIdx < 6) return null; // Coast (idx 6) or Open Ocean (idx 7)

    achievementBonusTotal += ACHIEVEMENTS[achId].bonus;
  }

  const comboMilestoneBonus = maxCombo * 15;
  const finalScore =
    catchScore +
    levelBonusTotal +
    flawlessBonusTotal +
    comboMilestoneBonus +
    achievementBonusTotal;

  if (finalScore < 0 || finalScore > SCORE_LIMITS.MAX_TOTAL_SCORE) return null;

  return {
    finalScore,
    catchScore,
    levelBonusTotal,
    flawlessBonusTotal,
    comboMilestoneBonus,
    achievementBonusTotal,
    totalFishCaught,
    highestLevel: highIdx + 1,
    highestEnvId,
    startEnvId,
    gameMode
  };
}
