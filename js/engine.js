/**
 * Fish Rain — 2D Arcade Game Engine & Canvas Renderer
 * Handles level progression across the 8 Bodies of Water, physics (currents, wind,
 * rogue waves), collision detection, scoring, particle effects, and custom 2D rendering.
 */

import {
  GAME_CONSTANTS,
  RARITY_TIERS,
  ENVIRONMENTS,
  ENVIRONMENT_ORDER,
  FALLING_OBJECTS,
  ACHIEVEMENTS,
  ROGUE_WAVE_TIERS
} from './config.js';
import {
  getComboMultiplier,
  getComboTierLabel,
  calculateCatchPoints,
  recomputeFinalScore
} from './scoring.js';
import { sound } from './sound.js';

export class FishRainEngine {
  constructor({ canvas, input, onStateChange, onLevelIntro, onLevelComplete, onGameOver } = {}) {
    this.canvas = canvas || null;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.input = input || null;

    this.onStateChange = onStateChange || (() => {});
    this.onLevelIntro = onLevelIntro || (() => {});
    this.onLevelComplete = onLevelComplete || (() => {});
    this.onGameOver = onGameOver || (() => {});

    this.width = GAME_CONSTANTS.LOGICAL_WIDTH;
    this.height = GAME_CONSTANTS.LOGICAL_HEIGHT;

    this.rafId = null;
    this.lastFrameTime = 0;

    this.resetToIdle();
  }

  resetToIdle() {
    this.status = 'IDLE'; // 'IDLE' | 'LEVEL_INTRO' | 'PLAYING' | 'PAUSED' | 'LEVEL_COMPLETE' | 'GAME_OVER'
    this.gameMode = 'CAMPAIGN'; // 'CAMPAIGN' | 'QUICK_PLAY'
    this.startEnvId = 'PUDDLE';
    this.currentEnvId = 'PUDDLE';
    this.highestEnvId = 'PUDDLE';
    this.sessionToken = null;

    this.lives = GAME_CONSTANTS.STARTING_LIVES;
    this.maxLives = GAME_CONSTANTS.MAX_LIVES;

    // Run-wide cumulative stats (verifiable by recomputeFinalScore)
    this.catchScore = 0;
    this.levelsCleared = 0;
    this.flawlessLevels = 0;
    this.hazardsHit = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.elapsedMs = 0;
    this.catchesByRarity = {
      COMMON: 0,
      UNCOMMON: 0,
      RARE: 0,
      LEGENDARY: 0,
      BONUS: 0,
      NEUTRAL: 0
    };
    this.unlockedAchievements = [];
    this.bestCatch = { id: null, name: 'None Yet', points: 0, rarity: 'COMMON' };

    // Current level state
    this.levelCatchScore = 0;
    this.levelFishCaught = 0;
    this.levelDamageTaken = 0;
    this.levelElapsedMs = 0;
    this.spawnTimerMs = 0;

    // Environmental dynamics
    this.currentVx = 0;
    this.windVx = 0;
    this.windTargetVx = 0;
    this.windChangeTimerMs = 0;
    this.lightningFlashAlpha = 0;

    // Rogue wave state
    this.rogueWave = {
      state: 'NONE', // 'NONE' | 'WARNING' | 'SURGE'
      tier: ROGUE_WAVE_TIERS.SWELL,
      tierId: 'SWELL',
      timerMs: 0,
      cooldownMs: 10000,
      direction: 1, // 1 = left-to-right, -1 = right-to-left
      crestX: 0,
      hasHitBoat: false,
      tookDamageDuringWave: false
    };

    // Player boat state
    this.boat = {
      x: this.width / 2,
      y: GAME_CONSTANTS.BOAT_Y,
      vx: 0,
      tiltRad: 0,
      invulnMs: 0,
      wideNetMs: 0,
      turboMs: 0,
      netAnimMs: 0,
      knockbackVx: 0,
      pitchRad: 0,
      pitchVelRad: 0,
      waveImpactActive: false,
      waveImpactDir: 0,
      waveImpactTierId: null
    };

    // Active entities
    this.fallingObjects = [];
    this.particles = [];
    this.floatingTexts = [];
    this.rainDrops = [];
    this.screenShakeMs = 0;
    this.statusBanner = { text: '', color: '#38bdf8', timerMs: 0 };

    this._initRainDrops();
  }

  _initRainDrops() {
    this.rainDrops = [];
    for (let i = 0; i < 65; i++) {
      this.rainDrops.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        len: 10 + Math.random() * 12,
        speed: 380 + Math.random() * 180
      });
    }
  }

  /**
   * Starts a new run in either CAMPAIGN or QUICK_PLAY mode.
   */
  startNewRun({ gameMode = 'CAMPAIGN', startEnvId = 'PUDDLE', sessionToken = null, skipIntro = false } = {}) {
    this.resetToIdle();
    this.gameMode = gameMode === 'QUICK_PLAY' ? 'QUICK_PLAY' : 'CAMPAIGN';
    this.startEnvId = ENVIRONMENTS[startEnvId] ? startEnvId : 'PUDDLE';
    if (this.gameMode === 'CAMPAIGN') {
      this.startEnvId = 'PUDDLE';
    }
    this.currentEnvId = this.startEnvId;
    this.highestEnvId = this.startEnvId;
    this.sessionToken = sessionToken;

    this._setupEnvironment(this.currentEnvId, { skipIntro });
    this.startLoop();
  }

  setSessionToken(token) {
    this.sessionToken = token;
  }

  _setupEnvironment(envId, { skipIntro = false } = {}) {
    const env = ENVIRONMENTS[envId] || ENVIRONMENTS.PUDDLE;
    this.currentEnvId = env.id;

    const curIdx = ENVIRONMENT_ORDER.indexOf(env.id);
    const highIdx = ENVIRONMENT_ORDER.indexOf(this.highestEnvId);
    if (curIdx > highIdx) {
      this.highestEnvId = env.id;
    }

    this.levelCatchScore = 0;
    this.levelFishCaught = 0;
    this.levelDamageTaken = 0;
    this.levelElapsedMs = 0;
    this.spawnTimerMs = 450;

    this.fallingObjects = [];
    this.particles = [];
    this.floatingTexts = [];

    this.boat.x = this.width / 2;
    this.boat.vx = 0;
    this.boat.tiltRad = 0;
    this.boat.invulnMs = 0;
    this.boat.knockbackVx = 0;
    this.boat.pitchRad = 0;
    this.boat.pitchVelRad = 0;
    this.boat.waveImpactActive = false;
    this.boat.waveImpactDir = 0;
    this.boat.waveImpactTierId = null;

    this.currentVx = env.currentSpeed;
    this.windVx = 0;
    this.windTargetVx = 0;
    this.windChangeTimerMs = 2500;

    this.rogueWave = {
      state: 'NONE',
      timerMs: 0,
      cooldownMs: env.rogueWaveEnabled ? env.rogueWaveIntervalSec * 1000 : 999999,
      direction: Math.random() < 0.5 ? 1 : -1,
      crestX: 0,
      tier: ROGUE_WAVE_TIERS.SWELL,
      tierId: 'SWELL',
      hasHitBoat: false,
      tookDamageDuringWave: false
    };

    if (skipIntro) {
      this.status = 'PLAYING';
      this.onStateChange(this.getHUDState());
    } else {
      this.status = 'LEVEL_INTRO';
      this.onLevelIntro(env);
      this.onStateChange(this.getHUDState());
    }
  }

  beginActiveLevelPlay() {
    if (this.status === 'LEVEL_INTRO') {
      this.status = 'PLAYING';
      this.lastFrameTime = performance.now();
      this.onStateChange(this.getHUDState());
    }
  }

  togglePause() {
    if (this.status === 'PLAYING') {
      this.status = 'PAUSED';
      if (this.input) this.input.resetActiveInputs();
      this.onStateChange(this.getHUDState());
    } else if (this.status === 'PAUSED') {
      this.status = 'PLAYING';
      this.lastFrameTime = performance.now();
      this.onStateChange(this.getHUDState());
    }
    return this.status;
  }

  pauseIfPlaying() {
    if (this.status === 'PLAYING') {
      this.status = 'PAUSED';
      if (this.input) this.input.resetActiveInputs();
      this.onStateChange(this.getHUDState());
    }
  }

  startLoop() {
    if (this.rafId || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }
    this.lastFrameTime = performance.now();
    const tick = (now) => {
      const dtSec = Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;
      if (this.status === 'PLAYING') {
        this.step(dtSec);
      }
      this.render();
      if (this.status !== 'IDLE' && this.status !== 'GAME_OVER') {
        this.rafId = window.requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.rafId && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  /**
   * Returns playable horizontal boat bounds [minX, maxX] for the current Body of Water.
   */
  getPlayableBounds() {
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;
    const playableW = this.width * env.playableWidthRatio;
    const margin = (this.width - playableW) / 2;
    const halfBoat = GAME_CONSTANTS.BOAT_BASE_WIDTH * 0.48;
    return {
      waterLeft: margin,
      waterRight: this.width - margin,
      minX: margin + halfBoat,
      maxX: this.width - margin - halfBoat
    };
  }

  /**
   * Advances simulation physics by `dt` seconds.
   */
  step(dt) {
    if (this.status !== 'PLAYING' || dt <= 0) return;

    const dtMs = dt * 1000;
    this.elapsedMs += dtMs;
    this.levelElapsedMs += dtMs;

    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;
    const bounds = this.getPlayableBounds();

    // 1. Update boat buff timers & invulnerability
    if (this.boat.invulnMs > 0) this.boat.invulnMs = Math.max(0, this.boat.invulnMs - dtMs);
    if (this.boat.wideNetMs > 0) this.boat.wideNetMs = Math.max(0, this.boat.wideNetMs - dtMs);
    if (this.boat.turboMs > 0) this.boat.turboMs = Math.max(0, this.boat.turboMs - dtMs);
    if (this.boat.netAnimMs > 0) this.boat.netAnimMs = Math.max(0, this.boat.netAnimMs - dtMs);
    if (this.screenShakeMs > 0) this.screenShakeMs = Math.max(0, this.screenShakeMs - dtMs);
    if (this.statusBanner.timerMs > 0) this.statusBanner.timerMs = Math.max(0, this.statusBanner.timerMs - dtMs);
    if (this.lightningFlashAlpha > 0) this.lightningFlashAlpha = Math.max(0, this.lightningFlashAlpha - dt * 2.2);

    // 2. Update environmental currents & wind gusts
    if (env.currentSpeed > 0) {
      if (env.currentOscillation) {
        const phase = this.levelElapsedMs * 0.00075;
        this.currentVx = env.currentSpeed * Math.sin(phase);
      } else {
        this.currentVx = env.currentSpeed;
      }
    } else {
      this.currentVx = 0;
    }

    if (env.windMaxSpeed > 0) {
      this.windChangeTimerMs -= dtMs;
      if (this.windChangeTimerMs <= 0) {
        this.windChangeTimerMs = 3200 + Math.random() * 2800;
        const prevSign = Math.sign(this.windTargetVx);
        this.windTargetVx = (Math.random() * 2 - 1) * env.windMaxSpeed;
        if (Math.abs(this.windTargetVx) > 65 && Math.sign(this.windTargetVx) !== prevSign) {
          this.setBanner(`💨 SQUALL GUST: ${this.windTargetVx > 0 ? 'EAST →' : '← WEST'}!`, '#38bdf8', 2200);
          sound.playWeatherWarning();
        }
      }
      this.windVx += (this.windTargetVx - this.windVx) * Math.min(1, dt * 1.5);
    } else {
      this.windVx = 0;
    }

    // Occasional lightning in Coast / Open Ocean
    if ((env.id === 'COAST' || env.id === 'OPEN_OCEAN') && Math.random() < dt * 0.12) {
      this.lightningFlashAlpha = 0.55;
    }

    // 3. Update Rogue Waves (Coast & Open Ocean)
    let roguePushVx = 0;
    if (env.rogueWaveEnabled) {
      this._stepRogueWave(dtMs, env);
      if (this.rogueWave.state === 'SURGE') {
        const tier = this.rogueWave.tier || ROGUE_WAVE_TIERS.SWELL;
        const distToCrest = this.boat.x - this.rogueWave.crestX;
        const influenceRadius = tier.widthSigma * 1.35;
        if (Math.abs(distToCrest) < influenceRadius) {
          const falloff = 1 - Math.min(1, Math.abs(distToCrest) / influenceRadius);
          roguePushVx = this.rogueWave.direction * tier.pushSpeed * (0.65 + 0.35 * falloff);
        }

        // Trigger physical wave impact when the crest hits the boat
        if (!this.rogueWave.hasHitBoat && Math.abs(distToCrest) <= 60) {
          this._triggerRogueWaveImpact(this.rogueWave);
        }
      }
    }

    // 4. Update Boat Movement from Input + Current + Rogue Wave Knockback
    const steer = this.input
      ? this.input.getSteeringCommand(this.boat.x, bounds.minX, bounds.maxX)
      : { axis: 0, source: 'IDLE' };

    // Update Pitch Physics & Recovery influenced by player steering (Section 8)
    if (this.boat.waveImpactActive || Math.abs(this.boat.pitchRad) > 0.005) {
      const tier = ROGUE_WAVE_TIERS[this.boat.waveImpactTierId] || ROGUE_WAVE_TIERS.SWELL;
      const waveDir = this.boat.waveImpactDir || 1;

      // Steering alignment relative to wave direction:
      // Positive: steering in the same direction wave traveled (prolongs pitch/recovery)
      // Negative: counter-steering against wave direction (accelerates recovery)
      const steeringAlignment = steer.axis * waveDir; // [-1.0, 1.0]

      // Base spring-damper constants
      let k = GAME_CONSTANTS.ROGUE_PITCH_SPRING_STIFFNESS;
      let c = GAME_CONSTANTS.ROGUE_PITCH_SPRING_DAMPING;

      // Subtle, proportional steering influence:
      // Countersteering (steeringAlignment < 0) increases spring stiffness and damping
      // Steering with wave (steeringAlignment > 0) gently softens stiffness and damping
      if (steeringAlignment < 0) {
        const factor = Math.abs(steeringAlignment) * GAME_CONSTANTS.ROGUE_STEERING_RECOVERY_INFLUENCE;
        k *= (1 + factor * 0.9);
        c *= (1 + factor * 0.8);
      } else if (steeringAlignment > 0) {
        const factor = steeringAlignment * GAME_CONSTANTS.ROGUE_STEERING_RECOVERY_INFLUENCE;
        k *= (1 - factor * 0.6);
        c *= (1 - factor * 0.5);
      }

      // Spring-damper integration with natural rocking overshoot
      const springAcc = -k * this.boat.pitchRad - c * this.boat.pitchVelRad;
      this.boat.pitchVelRad += springAcc * dt;
      this.boat.pitchRad += this.boat.pitchVelRad * dt;

      // Settle condition
      if (
        Math.abs(this.boat.pitchRad) < 0.012 &&
        Math.abs(this.boat.pitchVelRad) < 0.04 &&
        Math.abs(this.boat.knockbackVx) < 5
      ) {
        this.boat.pitchRad = 0;
        this.boat.pitchVelRad = 0;
        this.boat.waveImpactActive = false;
      }
    }

    // Decay horizontal knockback momentum gradually
    if (Math.abs(this.boat.knockbackVx) > 0) {
      this.boat.knockbackVx *= Math.exp(-GAME_CONSTANTS.ROGUE_KNOCKBACK_DECAY * dt);
      if (Math.abs(this.boat.knockbackVx) < 3) {
        this.boat.knockbackVx = 0;
      }
    }

    // Steering effectiveness during impact (Section 4)
    let steeringEffectiveness = 1.0;
    if (this.boat.waveImpactActive && Math.abs(this.boat.pitchRad) > 0) {
      const tier = ROGUE_WAVE_TIERS[this.boat.waveImpactTierId] || ROGUE_WAVE_TIERS.SWELL;
      const pitchRatio = Math.min(1.0, Math.abs(this.boat.pitchRad) / ((tier.basePitchAngle || 0.35) * 1.15));
      steeringEffectiveness = 1.0 - pitchRatio * (1.0 - (tier.minSteeringFactor || 0.6));
    }

    const speedMult = this.boat.turboMs > 0 ? GAME_CONSTANTS.TURBO_SPEED_MULTIPLIER : 1.0;
    const maxBoatSpeed = GAME_CONSTANTS.BASE_BOAT_SPEED * speedMult;

    // Turbo oars also reduce river current and wave push by 40%
    const currentResistance = this.boat.turboMs > 0 ? 0.6 : 1.0;

    // Transition from ambient wave push to discrete impact impulse:
    // When knockbackVx is active after crest impact, it drives the wave horizontal shove.
    // Before crest impact, roguePushVx provides gradual ambient push as the swell approaches.
    const waveVx = Math.abs(this.boat.knockbackVx) > 0 ? this.boat.knockbackVx : roguePushVx;
    const externalVx = (this.currentVx + waveVx) * currentResistance;

    const targetPlayerVx = steer.axis * maxBoatSpeed * steeringEffectiveness;
    this.boat.vx = targetPlayerVx + externalVx;
    this.boat.x += this.boat.vx * dt;

    if (this.boat.x < bounds.minX) {
      this.boat.x = bounds.minX;
    } else if (this.boat.x > bounds.maxX) {
      this.boat.x = bounds.maxX;
    }

    // Compute boat vertical wave bobbing and tilt angle (combining ambient slope + velocity tilt + wave impact pitch)
    const waveSurfaceY = this.getWaterHeightAt(this.boat.x);
    this.boat.y = waveSurfaceY - 8;
    const waveSlope =
      (this.getWaterHeightAt(this.boat.x + 18) - this.getWaterHeightAt(this.boat.x - 18)) / 36;
    const velTilt = (steer.axis * 0.11);

    // During severe rogue wave impact, attenuate opposing ambient water slope so it doesn't fight or diminish bow-up lift
    const pitchIntensity = Math.min(1.0, Math.abs(this.boat.pitchRad) / 0.65);
    const ambientSlopeWeight = (1.0 - pitchIntensity * 0.85) * 0.65;
    this.boat.tiltRad = waveSlope * ambientSlopeWeight + velTilt + this.boat.pitchRad;

    // 5. Spawn falling objects
    this.spawnTimerMs -= dtMs;
    if (this.spawnTimerMs <= 0 && this.fallingObjects.length < env.maxSimultaneous) {
      this.spawnRandomObject(env, bounds);
      // Slight escalation as the level progresses
      const pacingFactor = Math.max(0.78, 1 - (this.levelElapsedMs / 90000) * 0.18);
      const jitter = 0.75 + Math.random() * 0.5;
      this.spawnTimerMs = env.spawnIntervalMs * pacingFactor * jitter;
    }

    // 6. Update falling objects & check collisions
    const netMult = this.boat.wideNetMs > 0 ? GAME_CONSTANTS.WIDE_NET_MULTIPLIER : 1.0;
    const catchHalfW = (GAME_CONSTANTS.BOAT_BASE_WIDTH * 0.54) * netMult;
    const hullHalfW = GAME_CONSTANTS.BOAT_BASE_WIDTH * 0.42;

    for (let i = this.fallingObjects.length - 1; i >= 0; i--) {
      const item = this.fallingObjects[i];
      if (item.warningMs > 0) {
        item.warningMs = Math.max(0, item.warningMs - dtMs);
        continue;
      }

      // Wind drift affects lighter items more than heavy hazards
      const windInfluence = item.category === 'HAZARD' ? 0.35 : 0.72;
      item.x += (item.vx + this.windVx * windInfluence) * dt;
      item.y += item.vy * dt;
      item.phase += dt * 7.5;
      item.rotation += item.spinSpeed * dt;

      // Keep within playable water columns
      const pad = item.radius + 8;
      if (item.x < bounds.waterLeft + pad) {
        item.x = bounds.waterLeft + pad;
        item.vx = Math.abs(item.vx) * 0.5;
      } else if (item.x > bounds.waterRight - pad) {
        item.x = bounds.waterRight - pad;
        item.vx = -Math.abs(item.vx) * 0.5;
      }

      // Check collision with player's boat
      const dy = Math.abs(item.y - (this.boat.y - 8));
      const dx = Math.abs(item.x - this.boat.x);
      const effectiveHalfW = item.category === 'HAZARD' ? hullHalfW : catchHalfW;

      if (dy <= item.radius + 22 && dx <= effectiveHalfW + item.radius * 0.75) {
        if (item.category !== 'HAZARD' && this.isFishingSuspended()) {
          // Boat is pitched too steeply to net fish or bonuses.
          // Object continues falling past the boat into the water without being caught.
          continue;
        }

        this._resolveItemCollision(item);
        this.fallingObjects.splice(i, 1);
        if (this.status !== 'PLAYING') return; // Level completed or Game Over triggered
        continue;
      }

      // Check if object splashed into the water un-caught
      const waterY = this.getWaterHeightAt(item.x);
      if (item.y - item.radius >= waterY) {
        this._spawnSplash(item.x, waterY, item.isGiant ? 18 : 8, '#bae6fd');
        sound.playSplash(item.isGiant ? 1.2 : 0.45);
        this.fallingObjects.splice(i, 1);
      }
    }

    // 7. Update particles, rain, and floating texts
    this._stepParticlesAndEffects(dt, dtMs);

    // 8. Notify HUD listener
    this.onStateChange(this.getHUDState());
  }

  _stepRogueWave(dtMs, env) {
    const rw = this.rogueWave;
    if (rw.state === 'NONE') {
      rw.cooldownMs -= dtMs;
      if (rw.cooldownMs <= 0) {
        // Select wave tier based on environment configuration
        const allowedTiers = (env.rogueWaveAllowedTiers && env.rogueWaveAllowedTiers.length > 0)
          ? env.rogueWaveAllowedTiers
          : ['SWELL'];
        const chosenTierId = allowedTiers[Math.floor(Math.random() * allowedTiers.length)];
        const tier = ROGUE_WAVE_TIERS[chosenTierId] || ROGUE_WAVE_TIERS.SWELL;
        rw.tierId = chosenTierId;
        rw.tier = tier;

        rw.state = 'WARNING';
        rw.timerMs = 2600;
        rw.direction = Math.random() < 0.5 ? 1 : -1;
        rw.tookDamageDuringWave = false;
        const sideLabel = rw.direction === 1 ? 'PORT (LEFT)' : 'STARBOARD (RIGHT)';
        this.setBanner(`${tier.warningPrefix} INCOMING FROM ${sideLabel}! BRACE & STEER!`, tier.color, 2600);
        sound.playRogueWaveWarning(tier.foghornPitch);
      }
    } else if (rw.state === 'WARNING') {
      rw.timerMs -= dtMs;
      if (rw.timerMs <= 0) {
        const tier = rw.tier || ROGUE_WAVE_TIERS.SWELL;
        rw.state = 'SURGE';
        rw.timerMs = tier.durationMs;
        rw.crestX = rw.direction === 1 ? -100 : this.width + 100;
        rw.hasHitBoat = false;
        this.setBanner(`${tier.warningPrefix} SURGING! RIDE THE CREST!`, tier.color, Math.min(3200, tier.durationMs));
        this.screenShakeMs = Math.max(this.screenShakeMs, tier.cameraShake * 35);
      }
    } else if (rw.state === 'SURGE') {
      rw.timerMs -= dtMs;
      const tier = rw.tier || ROGUE_WAVE_TIERS.SWELL;
      const sweepDistance = this.width + 200;
      const sweepSpeed = sweepDistance / (tier.durationMs / 1000);
      rw.crestX += rw.direction * sweepSpeed * (dtMs / 1000);

      // Continuous spray particles and subtle camera rumble during severe surge
      if (tier.sprayParticles > 0 && Math.random() < 0.7) {
        const sprayCount = Math.ceil(tier.sprayParticles * 0.25);
        const sprayX = rw.crestX + (Math.random() - 0.5) * tier.widthSigma;
        const sprayY = this.getWaterHeightAt(sprayX);
        this._spawnSplash(sprayX, sprayY, sprayCount, tier.foamColor);
      }
      if (tier.cameraShake >= 10 && this.screenShakeMs < 120) {
        this.screenShakeMs = 120;
      }

      if (rw.timerMs <= 0) {
        rw.state = 'NONE';
        rw.cooldownMs = env.rogueWaveIntervalSec * 1000;
        if (!rw.tookDamageDuringWave) {
          this._unlockAchievement('ROGUE_SURVIVOR');
        }
      }
    }
  }

  /**
   * Returns whether fish catching is currently suspended due to steep boat pitch.
   * Hazards still collide and cause damage even while fishing is suspended.
   */
  isFishingSuspended() {
    return Math.abs(this.boat.pitchRad) > GAME_CONSTANTS.FISHING_PITCH_THRESHOLD_RAD;
  }

  /**
   * Applies the physical rogue wave impact on the boat:
   * 1. Horizontal knockback impulse in wave travel direction (scaled by wave height)
   * 2. Boat bow-up pitch in wave cresting direction (scaled by wave height)
   * 3. Splash particles, sound, and temporary steering reduction
   */
  _triggerRogueWaveImpact(rw) {
    rw.hasHitBoat = true;
    const tier = rw.tier || ROGUE_WAVE_TIERS.SWELL;
    const variation = 0.92 + Math.random() * 0.16; // Bounded ±8% variation

    const impulse = (tier.knockbackImpulse || 210) * variation;
    const peakPitch = (tier.basePitchAngle || 0.30) * variation;
    const waveDir = rw.direction || 1;

    // 1. Horizontal Knockback Impulse in the direction of wave travel
    this.boat.knockbackVx = waveDir * impulse;
    this.boat.waveImpactDir = waveDir;
    this.boat.waveImpactActive = true;
    this.boat.waveImpactTierId = rw.tierId || 'SWELL';

    // 2. Boat Pitch / Bow Lift:
    // The end of the boat facing the oncoming wave rises as it climbs the wave face:
    // - Wave moving left-to-right (dir = +1, oncoming from left): left end rises -> positive canvas rotation (+).
    // - Wave moving right-to-left (dir = -1, oncoming from right): right end rises -> negative canvas rotation (-).
    this.boat.pitchRad = waveDir * peakPitch;
    this.boat.pitchVelRad = 0;

    // 3. Impact reaction: water spray particles & splash audio
    const sprayCount = tier.sprayParticles || 16;
    this._spawnSplash(this.boat.x, this.boat.y + 4, sprayCount, tier.foamColor);
    sound.playSplash(tier.id === 'TITANIC' ? 1.4 : tier.id === 'GALE' ? 1.05 : 0.7);

    // Modest, crisp screen shake so falling items remain clearly visible
    this.screenShakeMs = Math.max(this.screenShakeMs, tier.cameraShake * 16);

    // Floating notification for significant wave hits
    if (tier.id === 'TITANIC') {
      this._addFloatingText('🚨 TITANIC WAVE HIT! BOW UP!', this.boat.x, this.boat.y - 52, tier.color, 1.25);
    } else if (tier.id === 'GALE') {
      this._addFloatingText('⚠️ MONSTER WAVE HIT!', this.boat.x, this.boat.y - 48, tier.color, 1.1);
    }
  }

  /**
   * Computes vertical water surface height Y at horizontal coordinate `x`.
   */
  getWaterHeightAt(x) {
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;
    const t = this.levelElapsedMs * 0.0035;
    const baseWave =
      Math.sin(x * env.waveFrequency + t) * env.waveAmplitude +
      Math.cos(x * env.waveFrequency * 1.7 - t * 1.3) * (env.waveAmplitude * 0.4);

    let rogueLift = 0;
    if (this.rogueWave.state === 'SURGE') {
      const tier = this.rogueWave.tier || ROGUE_WAVE_TIERS.SWELL;
      const dist = x - this.rogueWave.crestX;
      const sigma = tier.widthSigma;
      rogueLift = -tier.lift * Math.exp(-(dist * dist) / (2 * sigma * sigma));
    }

    return GAME_CONSTANTS.WATER_SURFACE_Y + baseWave + rogueLift;
  }

  /**
   * Spawns a weighted falling object appropriate for the current environment.
   */
  spawnRandomObject(env, bounds) {
    const roll = Math.random();
    let poolIds = [];

    if (roll < env.hazardRatio) {
      poolIds = env.hazardPool;
    } else if (roll < env.hazardRatio + env.neutralRatio) {
      poolIds = env.neutralPool;
    } else if (roll < env.hazardRatio + env.neutralRatio + env.bonusRatio) {
      poolIds = ['tacklebox', 'thermos', 'doubloon', 'lifering'];
    } else {
      poolIds = env.fishPool;
    }

    // Weighted selection within the chosen pool
    const candidates = poolIds.map((id) => FALLING_OBJECTS[id]).filter(Boolean);
    if (candidates.length === 0) return null;

    const totalWeight = candidates.reduce((acc, c) => acc + (c.weight || 10), 0);
    let pick = Math.random() * totalWeight;
    let chosen = candidates[0];
    for (const c of candidates) {
      pick -= c.weight || 10;
      if (pick <= 0) {
        chosen = c;
        break;
      }
    }

    const pad = chosen.radius + 16;
    const spawnX = bounds.waterLeft + pad + Math.random() * Math.max(40, bounds.waterRight - bounds.waterLeft - pad * 2);

    return this.spawnSpecificObject(chosen.id, spawnX);
  }

  /**
   * Spawns a specific object by ID at `x` (also used directly in unit/integration tests).
   */
  spawnSpecificObject(objectId, x, y = -28) {
    const def = FALLING_OBJECTS[objectId];
    if (!def) return null;
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;

    const baseFallSpeed = 165 * env.fallSpeedMultiplier * (def.speedFactor || 1.0);
    const entity = {
      uid: Math.random().toString(36).slice(2, 10),
      id: def.id,
      name: def.name,
      icon: def.icon || '🐟',
      category: def.category,
      rarity: def.rarity,
      points: def.points,
      radius: def.radius,
      isGiant: Boolean(def.isGiant),
      buffType: def.buffType || null,
      color: def.color,
      accentColor: def.accentColor,
      quip: def.quip,
      x: Number.isFinite(x) ? x : this.width / 2,
      y,
      vx: (Math.random() - 0.5) * 24,
      vy: baseFallSpeed,
      phase: Math.random() * Math.PI * 2,
      rotation: 0,
      spinSpeed: def.category === 'FISH' ? 0 : (Math.random() - 0.5) * 2.4,
      warningMs: def.isGiant || def.radius >= 30 ? 600 : 0
    };

    this.fallingObjects.push(entity);
    return entity;
  }

  /**
   * Resolves catching a fish, bonus, neutral comedy item, or colliding with a hazard.
   */
  _resolveItemCollision(item) {
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;

    if (item.category === 'FISH') {
      const prevMult = getComboMultiplier(this.combo);
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      const newMult = getComboMultiplier(this.combo);

      const pts = calculateCatchPoints(item.id, this.combo, env.id);
      this.catchScore += pts;
      this.levelCatchScore += pts;
      this.levelFishCaught += 1;
      this.catchesByRarity[item.rarity] = (this.catchesByRarity[item.rarity] || 0) + 1;

      if (pts > this.bestCatch.points) {
        this.bestCatch = {
          id: item.id,
          name: item.name,
          points: pts,
          rarity: item.rarity
        };
      }

      this.boat.netAnimMs = 260;
      const rarityMeta = RARITY_TIERS[item.rarity] || RARITY_TIERS.COMMON;
      this._spawnSplash(item.x, this.boat.y - 14, item.rarity === 'LEGENDARY' ? 20 : 10, rarityMeta.color);
      this._addFloatingText(
        `+${pts} ${item.name}!`,
        item.x,
        this.boat.y - 34,
        rarityMeta.color,
        item.rarity === 'LEGENDARY' || item.rarity === 'RARE' ? 1.25 : 1.0
      );

      if (item.rarity === 'LEGENDARY') {
        this.setBanner(`👑 ${item.quip}`, '#facc15', 3000);
        this._unlockAchievement('FIRST_LEGENDARY');
      } else if (newMult > prevMult) {
        sound.playComboUp();
        this._addFloatingText(getComboTierLabel(this.combo), this.boat.x, this.boat.y - 58, '#facc15', 1.15);
      }

      if (this.combo >= 10) this._unlockAchievement('COMBO_10');
      if (this.combo >= 20) this._unlockAchievement('COMBO_20');

      sound.playCatch(item.rarity);
      this._checkLevelProgression();
      return;
    }

    if (item.category === 'BONUS') {
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.catchesByRarity.BONUS += 1;

      let basePts = calculateCatchPoints(item.id, this.combo, env.id);

      if (item.buffType === 'WIDE_NET') {
        this.boat.wideNetMs = GAME_CONSTANTS.BUFF_DURATION_MS;
      } else if (item.buffType === 'TURBO_OARS') {
        this.boat.turboMs = GAME_CONSTANTS.BUFF_DURATION_MS;
      } else if (item.buffType === 'COMBO_BOOST') {
        this.combo += 2;
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      } else if (item.buffType === 'EXTRA_LIFE') {
        if (this.lives < this.maxLives) {
          this.lives += 1;
        } else {
          // Full-hull bonus scaled by environment
          basePts += Math.round(200 * env.difficultyMultiplier);
        }
      }

      this.catchScore += basePts;
      this.levelCatchScore += basePts;
      this.boat.netAnimMs = 260;

      this._spawnSplash(item.x, this.boat.y - 14, 14, '#fb923c');
      this._addFloatingText(`+${basePts} ${item.name}`, item.x, this.boat.y - 38, '#fb923c', 1.15);
      this.setBanner(`${item.icon || '⭐'} ${item.quip}`, '#fb923c', 2600);
      sound.playBonus();

      if (this.combo >= 10) this._unlockAchievement('COMBO_10');
      if (this.combo >= 20) this._unlockAchievement('COMBO_20');

      this._checkLevelProgression();
      return;
    }

    if (item.category === 'NEUTRAL') {
      // Neutral items earn 0 points, do NOT damage the boat, and do NOT reset the combo!
      this.catchesByRarity.NEUTRAL += 1;
      this.boat.netAnimMs = 200;
      this._spawnSplash(item.x, this.boat.y - 12, 7, '#cbd5e1');
      this._addFloatingText(`0 PTS • ${item.name}`, item.x, this.boat.y - 34, '#cbd5e1', 1.0);
      this.setBanner(`${item.icon || '🥾'} ${item.quip}`, '#e2e8f0', 2800);
      sound.playNeutral();

      if (this.catchesByRarity.NEUTRAL >= 3) {
        this._unlockAchievement('BOOT_COLLECTOR');
      }
      return;
    }

    if (item.category === 'HAZARD') {
      if (this.boat.invulnMs > 0) {
        // Deflected while invulnerable
        this._addFloatingText('DEFLECTED!', item.x, this.boat.y - 30, '#94a3b8', 0.95);
        return;
      }

      this.lives = Math.max(0, this.lives - 1);
      this.hazardsHit += 1;
      this.levelDamageTaken += 1;
      this.combo = 0;
      this.boat.invulnMs = GAME_CONSTANTS.INVULNERABILITY_MS;
      this.screenShakeMs = 380;
      if (this.rogueWave.state === 'SURGE') {
        this.rogueWave.tookDamageDuringWave = true;
      }

      this._spawnSplash(item.x, this.boat.y - 10, 22, '#ef4444');
      this._addFloatingText(`-1 LIFE! ${item.name}`, item.x, this.boat.y - 40, '#ef4444', 1.25);
      this.setBanner(`💥 ${item.icon ? item.icon + ' ' : ''}${item.quip}`, '#fca5a5', 3200);
      sound.playHazardHit();

      if (this.lives <= 0) {
        this._triggerGameOver('HULL_SUNK');
      }
    }
  }

  _unlockAchievement(achId) {
    const ach = ACHIEVEMENTS[achId];
    if (!ach || this.unlockedAchievements.includes(achId)) return;
    this.unlockedAchievements.push(achId);
    this._addFloatingText(`${ach.icon} ${ach.title} (+${ach.bonus})`, this.boat.x, this.boat.y - 68, '#facc15', 1.25);
  }

  _checkLevelProgression() {
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;
    const minFishForScoreClear = Math.max(3, Math.ceil(env.targetCatches * 0.5));
    if (
      this.levelFishCaught >= env.targetCatches ||
      (this.levelCatchScore >= env.targetScore && this.levelFishCaught >= minFishForScoreClear)
    ) {
      this._completeCurrentLevel();
    }
  }

  _completeCurrentLevel() {
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;
    this.levelsCleared += 1;
    const flawless = this.levelDamageTaken === 0;
    if (flawless) {
      this.flawlessLevels += 1;
    }
    // Restores +1 life upon clearing a level if damaged
    if (this.lives < this.maxLives) {
      this.lives += 1;
    }

    this.status = 'LEVEL_COMPLETE';
    if (this.input) this.input.resetActiveInputs();
    sound.playLevelClear();

    const curIdx = ENVIRONMENT_ORDER.indexOf(env.id);
    const hasNextLevel = this.gameMode === 'CAMPAIGN' && curIdx < ENVIRONMENT_ORDER.length - 1;
    const nextEnv = hasNextLevel ? ENVIRONMENTS[ENVIRONMENT_ORDER[curIdx + 1]] : null;

    const summary = {
      env,
      levelCatchScore: this.levelCatchScore,
      levelFishCaught: this.levelFishCaught,
      levelClearBonus: env.levelClearBonus,
      flawless,
      flawlessBonus: flawless ? env.flawlessBonus : 0,
      totalScoreSoFar: this.getVerifiedScoreBreakdown().finalScore,
      hasNextLevel,
      nextEnv,
      gameMode: this.gameMode
    };

    this.onLevelComplete(summary);
    this.onStateChange(this.getHUDState());
  }

  /**
   * Advances to the next Body of Water after completing a level, or finishes the run if at the end.
   */
  advanceToNextLevel({ skipIntro = false } = {}) {
    const curIdx = ENVIRONMENT_ORDER.indexOf(this.currentEnvId);
    if (this.gameMode === 'CAMPAIGN' && curIdx < ENVIRONMENT_ORDER.length - 1) {
      const nextEnvId = ENVIRONMENT_ORDER[curIdx + 1];
      this._setupEnvironment(nextEnvId, { skipIntro });
    } else {
      this._triggerGameOver('VICTORY');
    }
  }

  /**
   * Ends the current run (either when lives reach 0 or when the player finishes/cashes out).
   */
  _triggerGameOver(reason = 'HULL_SUNK') {
    this.status = 'GAME_OVER';
    if (this.input) this.input.resetActiveInputs();
    if (reason === 'HULL_SUNK') {
      sound.playGameOver();
    } else {
      sound.playLevelClear();
    }

    const snapshot = this.buildRunSubmissionSnapshot(reason);
    this.onGameOver(snapshot);
    this.onStateChange(this.getHUDState());
  }

  finishRunAndCashOut() {
    this._triggerGameOver('VICTORY');
  }

  /**
   * Returns the live score breakdown using the shared `recomputeFinalScore` formula.
   */
  getVerifiedScoreBreakdown() {
    const elapsedSeconds = Math.max(2, Math.round(this.elapsedMs / 1000));
    const calc = recomputeFinalScore({
      gameMode: this.gameMode,
      startEnvId: this.startEnvId,
      highestEnvId: this.highestEnvId,
      levelsCleared: this.levelsCleared,
      flawlessLevels: this.flawlessLevels,
      catchesByRarity: this.catchesByRarity,
      hazardsHit: this.hazardsHit,
      maxCombo: this.maxCombo,
      catchScore: this.catchScore,
      achievements: this.unlockedAchievements,
      elapsedSeconds
    });

    if (calc) return calc;

    // Fallback during first 2 seconds of a run
    return {
      finalScore: this.catchScore,
      catchScore: this.catchScore,
      levelBonusTotal: 0,
      flawlessBonusTotal: 0,
      comboMilestoneBonus: this.maxCombo * 15,
      achievementBonusTotal: 0,
      totalFishCaught:
        this.catchesByRarity.COMMON +
        this.catchesByRarity.UNCOMMON +
        this.catchesByRarity.RARE +
        this.catchesByRarity.LEGENDARY,
      highestLevel: ENVIRONMENT_ORDER.indexOf(this.highestEnvId) + 1
    };
  }

  /**
   * Builds the tamper-evident submission snapshot for the Global Leaderboard API.
   */
  buildRunSubmissionSnapshot(reason = 'HULL_SUNK') {
    const elapsedSeconds = Math.max(2, Math.round(this.elapsedMs / 1000));
    const breakdown = this.getVerifiedScoreBreakdown();
    const highestEnv = ENVIRONMENTS[this.highestEnvId] || ENVIRONMENTS.PUDDLE;

    return {
      reason,
      token: this.sessionToken,
      gameMode: this.gameMode,
      startEnvId: this.startEnvId,
      highestEnvId: this.highestEnvId,
      highestEnvName: highestEnv.name,
      highestLevel: highestEnv.level,
      levelsCleared: this.levelsCleared,
      flawlessLevels: this.flawlessLevels,
      catchesByRarity: { ...this.catchesByRarity },
      hazardsHit: this.hazardsHit,
      maxCombo: this.maxCombo,
      catchScore: this.catchScore,
      achievements: [...this.unlockedAchievements],
      elapsedSeconds,
      score: breakdown.finalScore,
      breakdown,
      bestCatch: { ...this.bestCatch }
    };
  }

  getHUDState() {
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;
    const scorePct = Math.min(100, Math.round((this.levelCatchScore / env.targetScore) * 100));
    const catchPct = Math.min(100, Math.round((this.levelFishCaught / env.targetCatches) * 100));
    const progressPct = Math.max(scorePct, catchPct);
    const breakdown = this.getVerifiedScoreBreakdown();

    return {
      status: this.status,
      gameMode: this.gameMode,
      env,
      score: breakdown.finalScore,
      levelCatchScore: this.levelCatchScore,
      targetScore: env.targetScore,
      levelFishCaught: this.levelFishCaught,
      targetCatches: env.targetCatches,
      progressPct,
      lives: this.lives,
      maxLives: this.maxLives,
      combo: this.combo,
      maxCombo: this.maxCombo,
      comboMult: getComboMultiplier(this.combo),
      comboLabel: getComboTierLabel(this.combo),
      currentVx: Math.round(this.currentVx),
      windVx: Math.round(this.windVx),
      rogueWaveState: this.rogueWave.state,
      rogueWaveTier: this.rogueWave.tierId || 'SWELL',
      isFishingSuspended: this.isFishingSuspended(),
      boatTiltDeg: Math.round((this.boat.tiltRad * 180) / Math.PI),
      boatKnockbackVx: Math.round(this.boat.knockbackVx),
      wideNetRemainingSec: Math.ceil(this.boat.wideNetMs / 1000),
      turboRemainingSec: Math.ceil(this.boat.turboMs / 1000)
    };
  }

  setBanner(text, color = '#38bdf8', durationMs = 2400) {
    this.statusBanner = { text, color, timerMs: durationMs };
  }

  _spawnSplash(x, y, count = 10, color = '#bae6fd') {
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI * (0.15 + Math.random() * 0.7);
      const speed = 70 + Math.random() * 160;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 3.5,
        color,
        alpha: 1,
        lifeMs: 380 + Math.random() * 280,
        maxLifeMs: 660
      });
    }
  }

  _addFloatingText(text, x, y, color = '#ffffff', scale = 1.0) {
    this.floatingTexts.push({
      text,
      x: Math.max(90, Math.min(this.width - 90, x)),
      y,
      vy: -52,
      color,
      scale,
      lifeMs: 1150,
      maxLifeMs: 1150
    });
  }

  _stepParticlesAndEffects(dt, dtMs) {
    // Update rain drops
    for (const r of this.rainDrops) {
      r.x += this.windVx * 0.85 * dt;
      r.y += r.speed * dt;
      if (r.y > GAME_CONSTANTS.WATER_SURFACE_Y) {
        r.y = -15;
        r.x = Math.random() * this.width;
      }
      if (r.x < 0) r.x += this.width;
      if (r.x > this.width) r.x -= this.width;
    }

    // Update splash particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt; // gravity
      p.lifeMs -= dtMs;
      p.alpha = Math.max(0, p.lifeMs / p.maxLifeMs);
      if (p.lifeMs <= 0) this.particles.splice(i, 1);
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.lifeMs -= dtMs;
      if (ft.lifeMs <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  /* ========================================================================
     2D CANVAS RENDERING
     ======================================================================== */

  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const env = ENVIRONMENTS[this.currentEnvId] || ENVIRONMENTS.PUDDLE;
    const bounds = this.getPlayableBounds();

    ctx.save();

    // Screen shake on hazard collision
    if (this.screenShakeMs > 0) {
      const mag = (this.screenShakeMs / 380) * 9;
      ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
    }

    // 1. Sky Background Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, GAME_CONSTANTS.WATER_SURFACE_Y);
    skyGrad.addColorStop(0, env.palette.skyTop);
    skyGrad.addColorStop(1, env.palette.skyBottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Lightning flash overlay
    if (this.lightningFlashAlpha > 0) {
      ctx.fillStyle = `rgba(248, 250, 252, ${this.lightningFlashAlpha})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // 2. Environment-Specific Horizon Scenery
    this._renderEnvironmentScenery(ctx, env, bounds);

    // 3. Rain Streaks
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const windDx = this.windVx * 0.032;
    for (const r of this.rainDrops) {
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + windDx, r.y + r.len);
    }
    ctx.stroke();

    // 4. Falling Objects (Fish, Bonuses, Neutral Junk, and Hazards)
    for (const item of this.fallingObjects) {
      this._renderFallingObject(ctx, item);
    }

    // 5. Animated Water Body & Banks
    this._renderWaterAndBanks(ctx, env, bounds);

    // 6. Player Fishing Boat & Angler
    this._renderFishingBoat(ctx);

    // 7. Mouse-Follow Target Indicator (when in MOUSE_FOLLOW mode and actively steering toward target)
    if (
      this.input &&
      this.input.controlMode === 'MOUSE_FOLLOW' &&
      this.input.mouseSteeringActive &&
      this.input.mouseTargetX !== null
    ) {
      const tx = Math.max(bounds.minX, Math.min(bounds.maxX, this.input.mouseTargetX));
      ctx.save();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx, this.boat.y - 35);
      ctx.lineTo(tx, this.boat.y + 15);
      ctx.stroke();
      ctx.restore();
    }

    // 8. Splash Particles & Floating Score/Quip Texts
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const ft of this.floatingTexts) {
      const alpha = Math.min(1, ft.lifeMs / 350);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${Math.round(16 * ft.scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // 9. Weather / Rogue Wave / Status Banner at Top of Canvas
    if (this.statusBanner.timerMs > 0 && this.statusBanner.text) {
      this._renderStatusBanner(ctx);
    }

    ctx.restore();
  }

  _renderEnvironmentScenery(ctx, env, bounds) {
    const horizonY = GAME_CONSTANTS.WATER_SURFACE_Y - 12;

    // Storm clouds across top of sky
    ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 165 + this.levelElapsedMs * 0.012) % (this.width + 200)) - 100;
      ctx.beginPath();
      ctx.arc(cx, 38, 62, 0, Math.PI * 2);
      ctx.arc(cx + 48, 44, 52, 0, Math.PI * 2);
      ctx.arc(cx - 48, 46, 48, 0, Math.PI * 2);
      ctx.fill();
    }

    if (env.id === 'PUDDLE') {
      // Suburban wooden fence & grassy hills behind the puddle
      ctx.fillStyle = '#365314';
      ctx.fillRect(0, horizonY - 38, this.width, 46);
      ctx.fillStyle = '#78350f';
      for (let x = 20; x < this.width; x += 36) {
        if (x < bounds.waterLeft - 15 || x > bounds.waterRight + 5) {
          ctx.fillRect(x, horizonY - 62, 22, 54);
        }
      }
    } else if (env.id === 'POND') {
      // Rolling green hills and cattails
      ctx.fillStyle = '#14532d';
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.quadraticCurveTo(240, horizonY - 75, 480, horizonY - 25);
      ctx.quadraticCurveTo(720, horizonY - 85, this.width, horizonY - 15);
      ctx.lineTo(this.width, horizonY + 20);
      ctx.lineTo(0, horizonY + 20);
      ctx.fill();
    } else if (env.id === 'LAKE') {
      // Distant mountain peaks and pine trees
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(180, horizonY - 130);
      ctx.lineTo(350, horizonY - 40);
      ctx.lineTo(560, horizonY - 155);
      ctx.lineTo(780, horizonY - 50);
      ctx.lineTo(960, horizonY - 110);
      ctx.lineTo(960, horizonY + 10);
      ctx.closePath();
      ctx.fill();
    } else if (env.id === 'CALM_RIVER' || env.id === 'SWIFT_RIVER') {
      // River gorge banks & pines
      ctx.fillStyle = env.palette.horizonLand;
      ctx.beginPath();
      ctx.moveTo(0, horizonY - 90);
      ctx.lineTo(310, horizonY - 25);
      ctx.lineTo(650, horizonY - 30);
      ctx.lineTo(this.width, horizonY - 95);
      ctx.lineTo(this.width, horizonY + 15);
      ctx.lineTo(0, horizonY + 15);
      ctx.closePath();
      ctx.fill();
    } else if (env.id === 'BAY') {
      // Coastal headland with Lighthouse on the left
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(0, horizonY - 55);
      ctx.lineTo(190, horizonY - 45);
      ctx.lineTo(240, horizonY + 10);
      ctx.lineTo(0, horizonY + 10);
      ctx.fill();

      // Lighthouse tower
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(72, horizonY - 135, 24, 85);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(72, horizonY - 115, 24, 18);
      ctx.fillRect(72, horizonY - 80, 24, 18);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(68, horizonY - 148, 32, 13);

      // Rotating lighthouse beam
      const beamAlpha = 0.14 + 0.08 * Math.sin(this.levelElapsedMs * 0.004);
      ctx.fillStyle = `rgba(254, 240, 138, ${beamAlpha})`;
      ctx.beginPath();
      ctx.moveTo(84, horizonY - 142);
      ctx.lineTo(420, horizonY - 210);
      ctx.lineTo(420, horizonY - 60);
      ctx.closePath();
      ctx.fill();
    } else if (env.id === 'COAST') {
      // Jagged sea stacks
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(40, horizonY + 10);
      ctx.lineTo(75, horizonY - 95);
      ctx.lineTo(125, horizonY + 10);
      ctx.moveTo(820, horizonY + 10);
      ctx.lineTo(860, horizonY - 110);
      ctx.lineTo(910, horizonY + 10);
      ctx.fill();
    }
  }

  _renderWaterAndBanks(ctx, env, bounds) {
    // Draw animated water wave polygon
    const waterGrad = ctx.createLinearGradient(0, GAME_CONSTANTS.WATER_SURFACE_Y - 25, 0, this.height);
    waterGrad.addColorStop(0, env.palette.waterTop);
    waterGrad.addColorStop(1, env.palette.waterBottom);

    ctx.fillStyle = waterGrad;
    ctx.beginPath();
    ctx.moveTo(bounds.waterLeft, this.height);
    for (let x = bounds.waterLeft; x <= bounds.waterRight; x += 12) {
      ctx.lineTo(x, this.getWaterHeightAt(x));
    }
    ctx.lineTo(bounds.waterRight, this.getWaterHeightAt(bounds.waterRight));
    ctx.lineTo(bounds.waterRight, this.height);
    ctx.closePath();
    ctx.fill();

    // Foam crest line along the water surface
    const rw = this.rogueWave;
    const rwTier = rw.tier || ROGUE_WAVE_TIERS.SWELL;
    const isSurging = rw.state === 'SURGE';
    const crestLineWidth = isSurging
      ? (rw.tierId === 'TITANIC' ? 9 : rw.tierId === 'GALE' ? 7 : 5)
      : 3;

    ctx.strokeStyle = isSurging ? rwTier.foamColor : env.palette.foamColor;
    ctx.lineWidth = crestLineWidth;
    ctx.beginPath();
    for (let x = bounds.waterLeft; x <= bounds.waterRight; x += 12) {
      const y = this.getWaterHeightAt(x);
      if (x === bounds.waterLeft) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Render prominent frothing crest curl when rogue wave is surging across the screen
    if (isSurging && rw.crestX >= bounds.waterLeft - 50 && rw.crestX <= bounds.waterRight + 50) {
      ctx.save();
      const crestY = this.getWaterHeightAt(rw.crestX);
      ctx.fillStyle = rwTier.foamColor;
      ctx.shadowColor = rwTier.color;
      ctx.shadowBlur = rw.tierId === 'TITANIC' ? 16 : 8;
      ctx.beginPath();
      ctx.arc(rw.crestX, crestY, rw.tierId === 'TITANIC' ? 12 : rw.tierId === 'GALE' ? 9 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Current directional streamlines inside the water
    if (Math.abs(this.currentVx) > 5) {
      ctx.save();
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.35)';
      ctx.lineWidth = 2;
      const dir = Math.sign(this.currentVx);
      const offset = (this.levelElapsedMs * (this.currentVx / 1000)) % 120;
      for (let baseX = bounds.waterLeft + 40; baseX < bounds.waterRight - 40; baseX += 120) {
        let sx = baseX + offset;
        if (sx < bounds.waterLeft + 20) sx += bounds.waterRight - bounds.waterLeft - 40;
        if (sx > bounds.waterRight - 20) sx -= bounds.waterRight - bounds.waterLeft - 40;
        const sy = GAME_CONSTANTS.WATER_SURFACE_Y + 38;
        ctx.beginPath();
        ctx.moveTo(sx - dir * 18, sy);
        ctx.lineTo(sx + dir * 18, sy);
        ctx.lineTo(sx + dir * 10, sy - 5);
        ctx.moveTo(sx + dir * 18, sy);
        ctx.lineTo(sx + dir * 10, sy + 5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Left and right shore banks when playableWidthRatio < 1.0
    if (bounds.waterLeft > 2) {
      ctx.fillStyle = env.palette.bankColor;
      // Left bank
      ctx.beginPath();
      ctx.moveTo(0, GAME_CONSTANTS.WATER_SURFACE_Y - 16);
      ctx.lineTo(bounds.waterLeft + 6, GAME_CONSTANTS.WATER_SURFACE_Y + 6);
      ctx.lineTo(bounds.waterLeft + 18, this.height);
      ctx.lineTo(0, this.height);
      ctx.closePath();
      ctx.fill();

      // Right bank
      ctx.beginPath();
      ctx.moveTo(this.width, GAME_CONSTANTS.WATER_SURFACE_Y - 16);
      ctx.lineTo(bounds.waterRight - 6, GAME_CONSTANTS.WATER_SURFACE_Y + 6);
      ctx.lineTo(bounds.waterRight - 18, this.height);
      ctx.lineTo(this.width, this.height);
      ctx.closePath();
      ctx.fill();

      // Grass/stone top trim on banks
      ctx.fillStyle = env.palette.horizonLand;
      ctx.fillRect(0, GAME_CONSTANTS.WATER_SURFACE_Y - 20, bounds.waterLeft + 4, 10);
      ctx.fillRect(bounds.waterRight - 4, GAME_CONSTANTS.WATER_SURFACE_Y - 20, bounds.waterLeft + 4, 10);
    }
  }

  _renderFishingBoat(ctx) {
    const b = this.boat;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.tiltRad);

    // Blink effect during post-hit invulnerability
    if (b.invulnMs > 0 && Math.floor(b.invulnMs / 90) % 2 === 1) {
      ctx.globalAlpha = 0.45;
    }

    const netScale = b.wideNetMs > 0 ? GAME_CONSTANTS.WIDE_NET_MULTIPLIER : 1.0;
    const halfW = (GAME_CONSTANTS.BOAT_BASE_WIDTH / 2) * (b.wideNetMs > 0 ? 1.12 : 1.0);

    // Turbo Oars flame/foam wake
    if (b.turboMs > 0) {
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(-halfW - 8, 4, 9 + Math.random() * 4, 0, Math.PI * 2);
      ctx.arc(halfW + 8, 4, 9 + Math.random() * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Skipper character in yellow rain slicker & sou'wester hat
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(-14, -36, 28, 24, 6);
    ctx.fill();
    // Face
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(0, -42, 9, 0, Math.PI * 2);
    ctx.fill();
    // Rain hat
    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.ellipse(0, -48, 16, 5, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // Catching Landing Net (expands when Wide Net buff is active; indicates suspended state when steeply pitched)
    const isSuspended = this.isFishingSuspended();
    const netBounce = b.netAnimMs > 0 ? -6 : 0;
    if (isSuspended) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = b.wideNetMs > 0 ? '#fde047' : '#e2e8f0';
      ctx.lineWidth = b.wideNetMs > 0 ? 3.5 : 2.5;
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.ellipse(0, -24 + netBounce, 42 * netScale, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Indicator when boat is pitched too steeply to fish
    if (isSuspended) {
      ctx.save();
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NET TILTED!', 0, -58);
      ctx.restore();
    }

    // Boat Wooden/Painted Hull
    ctx.fillStyle = '#b91c1c';
    ctx.strokeStyle = '#fef2f2';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-halfW, -14);
    ctx.lineTo(halfW, -14);
    ctx.lineTo(halfW * 0.76, 14);
    ctx.lineTo(-halfW * 0.76, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Hull stripe & portholes
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-halfW * 0.85, -8, halfW * 1.7, 5);

    ctx.restore();
  }

  _renderFallingObject(ctx, item) {
    // If warning timer is active for a giant/heavy hazard, render top-of-screen warning indicator
    if (item.warningMs > 0) {
      ctx.save();
      const pulse = 0.65 + 0.35 * Math.sin(item.warningMs * 0.03);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(item.x, 42);
      ctx.lineTo(item.x - 18, 14);
      ctx.lineTo(item.x + 18, 14);
      ctx.closePath();
      ctx.fill();
      ctx.font = '900 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fef2f2';
      const warningIcon = item.icon ? `${item.icon} ` : '';
      ctx.fillText(`⚠️ ${warningIcon}${item.name.toUpperCase()}`, item.x, 56);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(item.x, item.y);

    // Rarity / Category Aura
    if (item.rarity === 'LEGENDARY' || item.rarity === 'RARE' || item.category === 'BONUS') {
      const tier = RARITY_TIERS[item.rarity] || RARITY_TIERS.COMMON;
      ctx.fillStyle = tier.glow;
      ctx.beginPath();
      ctx.arc(0, 0, item.radius * 1.42, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.category === 'HAZARD') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
      ctx.beginPath();
      ctx.arc(0, 0, item.radius * 1.25, 0, Math.PI * 2);
      ctx.fill();
    }

    if (item.category === 'FISH') {
      // Draw swimming/falling fish pointing downward with wiggling tail
      const wiggle = Math.sin(item.phase) * 0.16;
      ctx.rotate(Math.PI / 2 + wiggle);
      const r = item.radius;

      // Tail fin
      ctx.fillStyle = item.accentColor;
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, 0);
      ctx.lineTo(-r * 1.35, -r * 0.58);
      ctx.lineTo(-r * 1.35, r * 0.58);
      ctx.closePath();
      ctx.fill();

      // Fish body
      ctx.fillStyle = item.color;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.95, r * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Eye
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(r * 0.45, -r * 0.16, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(r * 0.5, -r * 0.16, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Rotate falling non-fish item
      ctx.rotate(item.rotation);
      const r = item.radius;

      switch (item.id) {
        case 'piano':
          this._renderPiano(ctx, r, item);
          break;
        case 'fridge':
          this._renderFridge(ctx, r, item);
          break;
        case 'oldboot':
          this._renderOldBoot(ctx, r, item);
          break;
        case 'anvil':
          this._renderAnvil(ctx, r, item);
          break;
        case 'fiberglass_cow':
          this._renderCow(ctx, r, item);
          break;
        case 'satellite':
          this._renderSatellite(ctx, r, item);
          break;
        case 'rubberduck':
          this._renderRubberDuck(ctx, r, item);
          break;
        case 'soggypizza':
          this._renderPizza(ctx, r, item);
          break;
        case 'warranty_bottle':
          this._renderBottle(ctx, r, item);
          break;
        case 'lawnchair':
          this._renderLawnChair(ctx, r, item);
          break;
        case 'brick':
          this._renderBrick(ctx, r, item);
          break;
        case 'tacklebox':
          this._renderTackleBox(ctx, r, item);
          break;
        case 'thermos':
          this._renderThermos(ctx, r, item);
          break;
        case 'bowlingball':
          this._renderBowlingBall(ctx, r, item);
          break;
        case 'tire':
          this._renderTire(ctx, r, item);
          break;
        case 'doubloon':
          this._renderDoubloon(ctx, r, item);
          break;
        case 'lifering':
          this._renderLifeRing(ctx, r, item);
          break;
        default:
          ctx.fillStyle = item.color;
          ctx.strokeStyle = item.category === 'HAZARD' ? '#ef4444' : '#f8fafc';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.roundRect(-r * 0.9, -r * 0.75, r * 1.8, r * 1.5, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = item.accentColor;
          ctx.fillRect(-r * 0.65, -r * 0.25, r * 1.3, r * 0.5);
          if (item.icon) {
            ctx.font = `${Math.round(r * 0.6)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.icon, 0, 0);
          }
          break;
      }

      // Clear icon/badge label so every falling object is immediately readable at arcade speed
      ctx.rotate(-item.rotation);
      ctx.font = '800 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      const shortName = item.name.split(' ').slice(-1)[0];
      const icon = item.icon || '';
      const shortTag =
        item.category === 'HAZARD'
          ? `⚠️ ${icon} ${shortName}`
          : item.category === 'BONUS'
          ? `⭐ ${icon} ${shortName}`
          : `${icon} ${shortName}`.trim();
      ctx.strokeText(shortTag, 0, r + 13);
      ctx.fillText(shortTag, 0, r + 13);
    }

    ctx.restore();
  }

  _renderPiano(ctx, r, item) {
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = item.category === 'HAZARD' ? '#ef4444' : '#94a3b8';
    ctx.lineWidth = 2.5;

    // Grand piano rim
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, r * 0.75);
    ctx.lineTo(r * 0.75, r * 0.75);
    ctx.lineTo(r * 0.75, r * 0.1);
    ctx.bezierCurveTo(r * 0.75, -r * 0.5, r * 0.2, -r * 0.85, -r * 0.25, -r * 0.85);
    ctx.lineTo(-r * 0.75, -r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Soundboard inner area (golden wood)
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, r * 0.4);
    ctx.lineTo(r * 0.6, r * 0.4);
    ctx.bezierCurveTo(r * 0.6, -r * 0.35, r * 0.1, -r * 0.7, -r * 0.2, -r * 0.7);
    ctx.lineTo(-r * 0.6, -r * 0.7);
    ctx.closePath();
    ctx.fill();

    // Gold strings inside
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.2;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * (r * 0.14), r * 0.35);
      ctx.lineTo(i * (r * 0.08) - r * 0.2, -r * 0.55);
      ctx.stroke();
    }

    // Keyboard section at bottom edge
    const kw = r * 1.4;
    const kh = r * 0.35;
    const kx = -kw / 2;
    const ky = r * 0.4;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(kx, ky, kw, kh);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.strokeRect(kx, ky, kw, kh);

    // White keys lines
    const numKeys = 7;
    const keyW = kw / numKeys;
    for (let i = 1; i < numKeys; i++) {
      ctx.beginPath();
      ctx.moveTo(kx + i * keyW, ky);
      ctx.lineTo(kx + i * keyW, ky + kh);
      ctx.stroke();
    }
    // Black sharps
    ctx.fillStyle = '#0f172a';
    const blackKeyIdxs = [0, 1, 3, 4, 5];
    for (const bIdx of blackKeyIdxs) {
      ctx.fillRect(kx + (bIdx + 0.68) * keyW, ky, keyW * 0.64, kh * 0.62);
    }

    // 🎹 icon badge
    ctx.font = `${Math.round(r * 0.58)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎹', -r * 0.05, -r * 0.15);
  }

  _renderFridge(ctx, r, item) {
    const fw = r * 1.4;
    const fh = r * 1.85;
    const fx = -fw / 2;
    const fy = -fh / 2;

    // Fridge cabinet body
    ctx.fillStyle = '#65a30d';
    ctx.strokeStyle = item.category === 'HAZARD' ? '#ef4444' : '#365314';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, 6);
    ctx.fill();
    ctx.stroke();

    // Freezer door dividing seam
    const seamY = fy + fh * 0.36;
    ctx.strokeStyle = '#365314';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx, seamY);
    ctx.lineTo(fx + fw, seamY);
    ctx.stroke();

    // Chrome door handles on right edge
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(fx + fw - 7, fy + fh * 0.14, 5, fh * 0.16, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(fx + fw - 7, seamY + fh * 0.08, 5, fh * 0.24, 2);
    ctx.fill();
    ctx.stroke();

    // Compressor ventilation grill at bottom
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(fx + 4, fy + fh - 8, fw - 8, 5);

    // 🧊 icon badge on upper freezer
    ctx.font = `${Math.round(r * 0.62)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧊', 0, fy + fh * 0.18);
  }

  _renderOldBoot(ctx, r, item) {
    ctx.save();
    ctx.fillStyle = '#78350f';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(r * 0.35, -r * 0.85);
    ctx.lineTo(-r * 0.25, -r * 0.85);
    ctx.lineTo(-r * 0.3, -r * 0.15);
    ctx.lineTo(-r * 0.9, r * 0.1);
    ctx.quadraticCurveTo(-r * 1.05, r * 0.45, -r * 0.85, r * 0.55);
    ctx.lineTo(r * 0.55, r * 0.55);
    ctx.lineTo(r * 0.55, r * 0.1);
    ctx.quadraticCurveTo(r * 0.45, -r * 0.4, r * 0.35, -r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Rubber lug sole & raised heel
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, r * 0.55);
    ctx.lineTo(r * 0.55, r * 0.55);
    ctx.lineTo(r * 0.55, r * 0.75);
    ctx.lineTo(r * 0.2, r * 0.75);
    ctx.lineTo(r * 0.2, r * 0.65);
    ctx.lineTo(-r * 0.85, r * 0.65);
    ctx.closePath();
    ctx.fill();

    // Yellow laces
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const ly = -r * 0.65 + i * (r * 0.22);
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, ly);
      ctx.lineTo(-r * 0.08, ly + r * 0.1);
      ctx.moveTo(-r * 0.08, ly);
      ctx.lineTo(-r * 0.28, ly + r * 0.1);
      ctx.stroke();
    }

    // 🥾 icon badge
    ctx.font = `${Math.round(r * 0.65)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🥾', r * 0.05, 0);
    ctx.restore();
  }

  _renderAnvil(ctx, r, item) {
    ctx.save();
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = item.category === 'HAZARD' ? '#ef4444' : '#64748b';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.6);
    ctx.lineTo(r * 0.8, -r * 0.6);
    ctx.lineTo(r * 0.8, -r * 0.35);
    ctx.lineTo(r * 0.55, -r * 0.35);
    ctx.quadraticCurveTo(r * 0.25, 0, r * 0.65, r * 0.65);
    ctx.lineTo(r * 0.75, r * 0.75);
    ctx.lineTo(-r * 0.75, r * 0.75);
    ctx.lineTo(-r * 0.65, r * 0.65);
    ctx.quadraticCurveTo(-r * 0.25, 0, -r * 0.45, -r * 0.35);
    ctx.lineTo(-r * 1.0, -r * 0.45);
    ctx.quadraticCurveTo(-r * 0.7, -r * 0.6, -r * 0.3, -r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Top face steel plate
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-r * 0.3, -r * 0.6, r * 1.05, r * 0.12);

    // Hardy hole
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(r * 0.55, -r * 0.58, r * 0.14, r * 0.08);

    // ACME label & 🔨 icon
    ctx.font = `900 ${Math.round(r * 0.26)}px sans-serif`;
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ACME', 0, r * 0.2);

    ctx.font = `${Math.round(r * 0.52)}px sans-serif`;
    ctx.fillText('🔨', 0, -r * 0.14);
    ctx.restore();
  }

  _renderCow(ctx, r, item) {
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = item.category === 'HAZARD' ? '#ef4444' : '#1e293b';
    ctx.lineWidth = 2.5;

    // Torso
    ctx.beginPath();
    ctx.ellipse(r * 0.05, 0, r * 0.65, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.ellipse(-r * 0.6, -r * 0.25, r * 0.28, r * 0.24, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Snout / Muzzle (pink)
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.ellipse(-r * 0.8, -r * 0.2, r * 0.14, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Horns
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.moveTo(-r * 0.58, -r * 0.44);
    ctx.lineTo(-r * 0.65, -r * 0.68);
    ctx.lineTo(-r * 0.5, -r * 0.46);
    ctx.fill();

    // 4 legs
    ctx.fillStyle = '#f8fafc';
    const legX = [-r * 0.35, -r * 0.15, r * 0.25, r * 0.45];
    for (const lx of legX) {
      ctx.fillRect(lx, r * 0.25, r * 0.12, r * 0.55);
      ctx.strokeRect(lx, r * 0.25, r * 0.12, r * 0.55);
      // Hooves
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(lx, r * 0.68, r * 0.12, r * 0.12);
      ctx.fillStyle = '#f8fafc';
    }

    // Holstein black spots
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(r * 0.2, -r * 0.12, r * 0.22, r * 0.16, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, r * 0.08, r * 0.18, r * 0.14, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.55, -r * 0.3, r * 0.1, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    // 🐄 icon badge
    ctx.font = `${Math.round(r * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐄', r * 0.05, -r * 0.05);
    ctx.restore();
  }

  _renderSatellite(ctx, r, item) {
    ctx.save();
    const bw = r * 0.65;
    const bh = r * 0.65;
    // Central gold bus
    ctx.fillStyle = '#eab308';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 2;
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

    // Left and Right Solar Panels
    const pw = r * 0.55;
    const ph = r * 0.75;
    ctx.fillStyle = '#1d4ed8';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-bw / 2 - pw - 4, -ph / 2, pw, ph);
    ctx.strokeRect(-bw / 2 - pw - 4, -ph / 2, pw, ph);
    ctx.fillRect(bw / 2 + 4, -ph / 2, pw, ph);
    ctx.strokeRect(bw / 2 + 4, -ph / 2, pw, ph);

    // Solar gridlines
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-bw / 2 - pw - 4, 0);
    ctx.lineTo(-bw / 2 - 4, 0);
    ctx.moveTo(-bw / 2 - pw / 2 - 4, -ph / 2);
    ctx.lineTo(-bw / 2 - pw / 2 - 4, ph / 2);
    ctx.moveTo(bw / 2 + 4, 0);
    ctx.lineTo(bw / 2 + pw + 4, 0);
    ctx.moveTo(bw / 2 + pw / 2 + 4, -ph / 2);
    ctx.lineTo(bw / 2 + pw / 2 + 4, ph / 2);
    ctx.stroke();

    // Top parabolic antenna dish
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -bh / 2 - 8, r * 0.28, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Mast & red beacon
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(0, -bh / 2 - 8);
    ctx.lineTo(0, -bh / 2 - 18);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(0, -bh / 2 - 18, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 🛰️ icon
    ctx.font = `${Math.round(r * 0.48)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛰️', 0, 0);
    ctx.restore();
  }

  _renderRubberDuck(ctx, r, item) {
    ctx.save();
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 2;

    // Body with upturned tail
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.2);
    ctx.quadraticCurveTo(-r * 0.6, r * 0.05, -r * 0.4, r * 0.35);
    ctx.quadraticCurveTo(0, r * 0.75, r * 0.45, r * 0.4);
    ctx.quadraticCurveTo(r * 0.7, 0, r * 0.35, -r * 0.2);
    ctx.quadraticCurveTo(-r * 0.1, -r * 0.35, -r * 0.8, -r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Round head
    ctx.beginPath();
    ctx.arc(r * 0.3, -r * 0.35, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Orange beak
    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.moveTo(r * 0.6, -r * 0.42);
    ctx.lineTo(r * 1.0, -r * 0.28);
    ctx.lineTo(r * 0.6, -r * 0.18);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.42, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.37, -r * 0.44, 1.0, 0, Math.PI * 2);
    ctx.fill();

    // 🦆 icon badge
    ctx.font = `${Math.round(r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🦆', -r * 0.05, r * 0.08);
    ctx.restore();
  }

  _renderPizza(ctx, r, item) {
    ctx.save();
    // Crust
    ctx.fillStyle = '#b45309';
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.85, Math.PI * 1.15, Math.PI * 1.85);
    ctx.lineTo(0, r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Melted cheese
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, -r * 0.5, r * 0.72, Math.PI * 1.2, Math.PI * 1.8);
    ctx.lineTo(0, r * 0.78);
    ctx.closePath();
    ctx.fill();

    // Pepperonis
    ctx.fillStyle = '#b91c1c';
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 1;
    const peps = [
      { x: -r * 0.25, y: -r * 0.25, r: r * 0.18 },
      { x: r * 0.25, y: -r * 0.15, r: r * 0.18 },
      { x: 0, y: r * 0.25, r: r * 0.16 }
    ];
    for (const p of peps) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 🍕 icon badge
    ctx.font = `${Math.round(r * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍕', 0, -r * 0.05);
    ctx.restore();
  }

  _renderBottle(ctx, r, item) {
    ctx.save();
    const bw = r * 1.0;
    const bh = r * 1.6;

    // Translucent glass bottle
    ctx.fillStyle = 'rgba(16, 185, 129, 0.72)';
    ctx.strokeStyle = '#047857';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(-r * 0.22, -bh / 2);
    ctx.lineTo(r * 0.22, -bh / 2);
    ctx.lineTo(r * 0.22, -bh / 2 + r * 0.38);
    ctx.quadraticCurveTo(bw / 2, -bh / 2 + r * 0.45, bw / 2, -bh / 2 + r * 0.75);
    ctx.lineTo(bw / 2, bh / 2 - 4);
    ctx.quadraticCurveTo(bw / 2, bh / 2, bw / 2 - 4, bh / 2);
    ctx.lineTo(-bw / 2 + 4, bh / 2);
    ctx.quadraticCurveTo(-bw / 2, bh / 2, -bw / 2, bh / 2 - 4);
    ctx.lineTo(-bw / 2, -bh / 2 + r * 0.75);
    ctx.quadraticCurveTo(-bw / 2, -bh / 2 + r * 0.45, -r * 0.22, -bh / 2 + r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cork
    ctx.fillStyle = '#d97706';
    ctx.fillRect(-r * 0.18, -bh / 2 - 6, r * 0.36, 7);

    // Parchment scroll inside
    ctx.fillStyle = '#fef3c7';
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-r * 0.24, -r * 0.1, r * 0.48, r * 0.7, 3);
    ctx.fill();
    ctx.stroke();
    // Red wax seal
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(0, r * 0.25, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 🍾 icon badge
    ctx.font = `${Math.round(r * 0.52)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍾', 0, -r * 0.1);
    ctx.restore();
  }

  _renderLawnChair(ctx, r, item) {
    ctx.save();
    const cw = r * 1.5;
    const ch = r * 1.5;

    // Aluminum frame scissor legs
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-cw / 2 + 4, ch / 2);
    ctx.lineTo(cw / 2 - 4, -ch / 2 + 6);
    ctx.moveTo(cw / 2 - 4, ch / 2);
    ctx.lineTo(-cw / 2 + 4, -ch / 2 + 6);
    ctx.stroke();

    // Webbed seat
    ctx.fillStyle = '#2dd4bf';
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-cw / 2 + 6, -ch / 2 + 4, cw - 12, ch - 16, 4);
    ctx.fill();
    ctx.stroke();

    // Alternating white straps
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-cw / 2 + 10, -ch / 2 + 10, cw - 20, 5);
    ctx.fillRect(-cw / 2 + 10, 0, cw - 20, 5);
    ctx.fillRect(-cw / 2 + 10, ch / 2 - 20, cw - 20, 5);

    // 🪑 icon badge
    ctx.font = `${Math.round(r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪑', 0, -r * 0.05);
    ctx.restore();
  }

  _renderBrick(ctx, r, item) {
    ctx.save();
    const bw = r * 1.7;
    const bh = r * 1.1;
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = item.category === 'HAZARD' ? '#7f1d1d' : '#991b1b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 3);
    ctx.fill();
    ctx.stroke();

    // 3 Core holes
    ctx.fillStyle = '#450a0a';
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 1;
    const holeX = [-bw * 0.28, 0, bw * 0.28];
    for (const hx of holeX) {
      ctx.beginPath();
      ctx.arc(hx, 0, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Highlight edge
    ctx.fillStyle = 'rgba(254, 202, 202, 0.4)';
    ctx.fillRect(-bw / 2 + 2, -bh / 2 + 1, bw - 4, 3);

    // 🧱 icon badge
    ctx.font = `${Math.round(r * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧱', 0, 0);
    ctx.restore();
  }

  _renderTackleBox(ctx, r, item) {
    ctx.save();
    const tw = r * 1.6;
    const th = r * 1.25;
    ctx.fillStyle = '#f97316';
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(-tw / 2, -th / 2, tw, th, 5);
    ctx.fill();
    ctx.stroke();

    // Divider seam
    ctx.strokeStyle = '#c2410c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-tw / 2, -th * 0.12);
    ctx.lineTo(tw / 2, -th * 0.12);
    ctx.stroke();

    // Silver handle
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-tw * 0.25, -th / 2);
    ctx.lineTo(-tw * 0.25, -th / 2 - 7);
    ctx.lineTo(tw * 0.25, -th / 2 - 7);
    ctx.lineTo(tw * 0.25, -th / 2);
    ctx.stroke();

    // Brass latches
    ctx.fillStyle = '#fde047';
    ctx.fillRect(-tw * 0.3, -th * 0.18, tw * 0.12, 7);
    ctx.fillRect(tw * 0.18, -th * 0.18, tw * 0.12, 7);

    // 🧰 icon badge
    ctx.font = `${Math.round(r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧰', 0, th * 0.14);
    ctx.restore();
  }

  _renderThermos(ctx, r, item) {
    ctx.save();
    const tw = r * 1.0;
    const th = r * 1.7;
    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-tw / 2, -th / 2, tw, th, 4);
    ctx.fill();
    ctx.stroke();

    // Silver screw cap
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-tw * 0.44, -th / 2 - 8, tw * 0.88, 9, 3);
    ctx.fill();
    ctx.stroke();

    // Black grip ribs
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-tw / 2, -th * 0.15, tw, 3);
    ctx.fillRect(-tw / 2, th * 0.2, tw, 3);

    // ☕ icon badge
    ctx.font = `${Math.round(r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('☕', 0, 0);
    ctx.restore();
  }

  _renderBowlingBall(ctx, r, item) {
    ctx.save();
    ctx.fillStyle = '#1d4ed8';
    ctx.strokeStyle = item.category === 'HAZARD' ? '#ef4444' : '#1e3a8a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Highlight sheen
    ctx.fillStyle = 'rgba(248, 250, 252, 0.35)';
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // 3 finger grip holes
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-r * 0.22, -r * 0.1, r * 0.12, 0, Math.PI * 2);
    ctx.arc(r * 0.18, -r * 0.1, r * 0.12, 0, Math.PI * 2);
    ctx.arc(0, r * 0.22, r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // 🎳 icon badge
    ctx.font = `${Math.round(r * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎳', 0, -r * 0.05);
    ctx.restore();
  }

  _renderTire(ctx, r, item) {
    ctx.save();
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = item.category === 'HAZARD' ? '#ef4444' : '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Outer tread grooves
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const x1 = Math.cos(a) * (r * 0.72);
      const y1 = Math.sin(a) * (r * 0.72);
      const x2 = Math.cos(a) * (r * 0.96);
      const y2 = Math.sin(a) * (r * 0.96);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Rim & center hole
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
    ctx.fill();

    // 🛞 icon badge
    ctx.font = `${Math.round(r * 0.52)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛞', 0, 0);
    ctx.restore();
  }

  _renderDoubloon(ctx, r, item) {
    ctx.save();
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner beaded ring
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
    ctx.stroke();

    // 🪙 icon badge
    ctx.font = `${Math.round(r * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪙', 0, 0);
    ctx.restore();
  }

  _renderLifeRing(ctx, r, item) {
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ea580c';

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.stroke();

    // White alternating segments
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, Math.PI * 0.25, Math.PI * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, Math.PI * 1.25, Math.PI * 1.75);
    ctx.closePath();
    ctx.fill();

    // Center cutout hole
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Grab rope loops
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2);
    ctx.stroke();

    // 🛟 icon badge
    ctx.font = `${Math.round(r * 0.52)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛟', 0, 0);
    ctx.restore();
  }

  _renderStatusBanner(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.strokeStyle = this.statusBanner.color;
    ctx.lineWidth = 2;
    const bw = Math.min(this.width - 40, 660);
    const bx = (this.width - bw) / 2;
    ctx.beginPath();
    ctx.roundRect(bx, 12, bw, 36, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '800 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.statusBanner.color;
    ctx.fillText(this.statusBanner.text, this.width / 2, 35);
    ctx.restore();
  }
}
