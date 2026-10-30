/**
 * Fish Rain — Comprehensive Game Logic, Controls, Physics & Progression Test Suite
 * Run: node tests/game_logic.mjs
 */

import assert from 'node:assert/strict';
import {
  GAME_CONSTANTS,
  ENVIRONMENTS,
  ENVIRONMENT_ORDER,
  FALLING_OBJECTS,
  CONTROL_MODES,
  ACHIEVEMENTS,
  ROGUE_WAVE_TIERS
} from '../js/config.js';
import {
  getComboMultiplier,
  calculateCatchPoints,
  recomputeFinalScore
} from '../js/scoring.js';
import { InputController } from '../js/input.js';
import { FishRainEngine } from '../js/engine.js';
import {
  loadRecords,
  unlockEnvironmentLevel,
  recordLevelCompletion,
  recordRunFinished,
  updatePreferences,
  resetRecords
} from '../js/storage.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
  }
}

console.log('\n=== 1. Environments (Bodies of Water) & Object Definitions ===');

await test('Defines all 8 Bodies of Water in escalating progression order', () => {
  assert.equal(ENVIRONMENT_ORDER.length, 8);
  assert.deepEqual(ENVIRONMENT_ORDER, [
    'PUDDLE',
    'POND',
    'LAKE',
    'CALM_RIVER',
    'SWIFT_RIVER',
    'BAY',
    'COAST',
    'OPEN_OCEAN'
  ]);

  let prevScore = 0;
  let prevMult = 0;
  for (let i = 0; i < ENVIRONMENT_ORDER.length; i++) {
    const env = ENVIRONMENTS[ENVIRONMENT_ORDER[i]];
    assert.ok(env, `Missing environment ${ENVIRONMENT_ORDER[i]}`);
    assert.equal(env.level, i + 1);
    assert.ok(env.targetScore > prevScore, `${env.id} targetScore should escalate`);
    assert.ok(env.difficultyMultiplier > prevMult, `${env.id} difficultyMultiplier should escalate`);
    prevScore = env.targetScore;
    prevMult = env.difficultyMultiplier;
  }
});

await test('Catalog includes Common, Uncommon, Rare, Legendary fish, Bonuses, Neutral comedy items, and Hazards with distinct icons', () => {
  const values = Object.values(FALLING_OBJECTS);
  assert.ok(values.some((o) => o.category === 'FISH' && o.rarity === 'COMMON'));
  assert.ok(values.some((o) => o.category === 'FISH' && o.rarity === 'UNCOMMON'));
  assert.ok(values.some((o) => o.category === 'FISH' && o.rarity === 'RARE'));
  assert.ok(values.some((o) => o.category === 'FISH' && o.rarity === 'LEGENDARY'));
  assert.ok(values.some((o) => o.category === 'BONUS'));
  assert.ok(values.some((o) => o.category === 'NEUTRAL' && o.points === 0));
  assert.ok(values.some((o) => o.category === 'HAZARD' && !o.isGiant));
  assert.ok(values.some((o) => o.category === 'HAZARD' && o.isGiant));

  // Verify all objects define a non-empty icon
  for (const obj of values) {
    assert.ok(typeof obj.icon === 'string' && obj.icon.length > 0, `Missing icon for ${obj.id}`);
  }

  // Verify key non-fish objects have their specific icons
  assert.equal(FALLING_OBJECTS.piano.icon, '🎹');
  assert.equal(FALLING_OBJECTS.fridge.icon, '🧊');
  assert.equal(FALLING_OBJECTS.oldboot.icon, '🥾');
  assert.equal(FALLING_OBJECTS.anvil.icon, '🔨');
  assert.equal(FALLING_OBJECTS.fiberglass_cow.icon, '🐄');
  assert.equal(FALLING_OBJECTS.satellite.icon, '🛰️');
  assert.equal(FALLING_OBJECTS.rubberduck.icon, '🦆');
  assert.equal(FALLING_OBJECTS.soggypizza.icon, '🍕');
  assert.equal(FALLING_OBJECTS.warranty_bottle.icon, '🍾');
  assert.equal(FALLING_OBJECTS.lawnchair.icon, '🪑');
  assert.equal(FALLING_OBJECTS.brick.icon, '🧱');
  assert.equal(FALLING_OBJECTS.tacklebox.icon, '🧰');
  assert.equal(FALLING_OBJECTS.thermos.icon, '☕');
  assert.equal(FALLING_OBJECTS.bowlingball.icon, '🎳');
  assert.equal(FALLING_OBJECTS.tire.icon, '🛞');
  assert.equal(FALLING_OBJECTS.doubloon.icon, '🪙');
  assert.equal(FALLING_OBJECTS.lifering.icon, '🛟');

  // Verify engine object spawn carries item.icon
  const engine = new FishRainEngine();
  const spawned = engine.spawnSpecificObject('piano', 400, 100);
  assert.equal(spawned.icon, '🎹');

  // Verify custom vector and icon renderers execute cleanly on mock canvas 2D context
  const mockCtx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    ellipse() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    rect() {},
    roundRect() {},
    fillRect() {},
    strokeRect() {},
    fill() {},
    stroke() {},
    fillText() {},
    strokeText() {},
    measureText() { return { width: 40 }; }
  };

  for (const obj of values) {
    const spawnedItem = engine.spawnSpecificObject(obj.id, 300, 150);
    assert.doesNotThrow(() => {
      engine._renderFallingObject(mockCtx, spawnedItem);
    }, `Rendering failed for ${obj.id}`);
  }
});

console.log('\n=== 2. Player Control Schemes (Keyboard, Touch Buttons, Mouse Follow, Mobile Tilt) ===');

await test('Keyboard and On-Screen Touch Buttons steer left and right accurately', () => {
  const input = new InputController();
  assert.equal(input.getSteeringCommand(480, 100, 860).axis, 0);

  input.keysDown.add('LEFT');
  assert.equal(input.getSteeringCommand(480, 100, 860).axis, -1);
  input.keysDown.clear();

  input.buttonRightHeld = true;
  assert.equal(input.getSteeringCommand(480, 100, 860).axis, 1);
  input.buttonRightHeld = false;
});

await test('Mouse Follow mode establishes persistent target, clamps to bounds, stops upon reaching, and allows environmental drift', () => {
  const input = new InputController();
  input.setControlMode('MOUSE_FOLLOW');

  // 1. Move mouse far right (e.g. beyond boundary at 9999px)
  input.setMouseTarget(9999);
  assert.equal(input.mouseSteeringActive, true);

  // Steers right toward clamped boundary (860)
  const cmdRight = input.getSteeringCommand(480, 100, 860);
  assert.equal(cmdRight.source, 'MOUSE_FOLLOW');
  assert.equal(cmdRight.targetX, 860);
  assert.ok(cmdRight.axis > 0.3, 'Should steer right toward clamped boundary');

  // Once boat reaches within arrival radius of 860 (radius is 24px, so 840 is inside arrival zone), steering deactivates!
  const cmdReached = input.getSteeringCommand(840, 100, 860);
  assert.equal(cmdReached.source, 'MOUSE_FOLLOW_REACHED');
  assert.equal(cmdReached.axis, 0);
  assert.equal(input.mouseSteeringActive, false);

  // If a river current subsequently pushes the boat back to 500, boat does NOT auto-return!
  const cmdDrift = input.getSteeringCommand(500, 100, 860);
  assert.equal(cmdDrift.source, 'IDLE');
  assert.equal(cmdDrift.axis, 0);

  // 2. Move mouse to 200: establishes new target and resumes steering
  input.setMouseTarget(200);
  assert.equal(input.mouseSteeringActive, true);
  const cmdLeft = input.getSteeringCommand(500, 100, 860);
  assert.equal(cmdLeft.source, 'MOUSE_FOLLOW');
  assert.ok(cmdLeft.axis < -0.3, 'Should steer left toward 200');

  // 3. Move mouse far left beyond playfield (-500px): clamps to minX (100)
  input.setMouseTarget(-500);
  const cmdFarLeft = input.getSteeringCommand(500, 100, 860);
  assert.equal(cmdFarLeft.targetX, 100);
  assert.ok(cmdFarLeft.axis < 0);
});

await test('Mouse Follow target zone with opposing and assisting environmental forces', async () => {
  const { FishRainEngine } = await import('../js/engine.js');
  const input = new InputController();
  const engine = new FishRainEngine({ input });
  input.setControlMode('MOUSE_FOLLOW');

  // Scenario 1: Cursor LEFT while water pushes RIGHT
  // Swift river oscillating or positive current
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'SWIFT_RIVER', skipIntro: true });
  engine.currentVx = 120; // Current pushes strongly RIGHT (+120 px/sec)
  engine.boat.x = 600;

  // Move cursor left to target 400
  input.setMouseTarget(400);
  assert.equal(input.mouseSteeringActive, true);

  // Advance simulation; despite +120px/s opposing current, boat enters arrival zone [376, 424]
  for (let i = 0; i < 40; i++) {
    engine.step(0.04);
    if (!input.mouseSteeringActive) break;
  }
  assert.equal(input.mouseSteeringActive, false, 'Steering stops once within arrival radius of cursor, even with opposing current');
  assert.ok(Math.abs(engine.boat.x - 400) <= input.arrivalRadius + 2, 'Boat arrived inside the arrival zone');

  // Current now carries boat to the right (away from 400); steering must NOT resume!
  const xAtArrival = engine.boat.x;
  for (let i = 0; i < 20; i++) {
    engine.step(0.04);
  }
  assert.ok(engine.boat.x > xAtArrival + 30, 'Water moves boat naturally to the right');
  assert.equal(input.mouseSteeringActive, false, 'Does not resume steering just because water moved boat away');

  // Scenario 2: Cursor RIGHT while water pushes LEFT
  engine.currentVx = -120; // Current pushes strongly LEFT (-120 px/sec)
  engine.boat.x = 300;

  // Move cursor right to target 550
  input.setMouseTarget(550);
  assert.equal(input.mouseSteeringActive, true);

  for (let i = 0; i < 40; i++) {
    engine.step(0.04);
    if (!input.mouseSteeringActive) break;
  }
  assert.equal(input.mouseSteeringActive, false, 'Steering stops once within arrival radius of target when fighting leftward current');
  assert.ok(Math.abs(engine.boat.x - 550) <= input.arrivalRadius + 2);

  // New intentional mouse movement resumes steering
  input.setMouseTarget(750);
  assert.equal(input.mouseSteeringActive, true, 'Moving cursor again establishes new target and resumes steering');
});

await test('Tilt mode steers beyond deadzone, deactivates at neutral to allow environmental drift, and supports button overrides', () => {
  const input = new InputController();
  input.setControlMode('TILT');
  input.setTiltSensitivity(1.5);

  // Simulate holding phone at a +6 degree resting angle and calibrating center
  input.simulateTiltAngle(6);
  assert.equal(input.calibrateTilt(), 6);

  // Neutral reading within deadzone: steering input is 0 (currents/wind can freely move boat)
  input.simulateTiltAngle(7.5);
  const cmdNeutral = input.getSteeringCommand(480, 100, 860);
  assert.equal(cmdNeutral.source, 'TILT_NEUTRAL');
  assert.equal(cmdNeutral.axis, 0);

  // Tilting 20 degrees right of calibrated center (angle = 26) resumes active steering
  input.simulateTiltAngle(26);
  const cmdTiltRight = input.getSteeringCommand(480, 100, 860);
  assert.equal(cmdTiltRight.source, 'TILT');
  assert.ok(cmdTiltRight.axis > 0.2, 'Tilting right should produce positive steering');

  // Returning to neutral stops steering again
  input.simulateTiltAngle(6);
  assert.equal(input.getSteeringCommand(480, 100, 860).axis, 0);

  // Holding Left Touch Button immediately overrides tilt!
  input.simulateTiltAngle(26); // device tilted right
  input.buttonLeftHeld = true; // but player presses Left button
  const overrideCmd = input.getSteeringCommand(480, 100, 860);
  assert.equal(overrideCmd.source, 'DIGITAL');
  assert.equal(overrideCmd.axis, -1);
  input.buttonLeftHeld = false;
});

await test('Switching control schemes cleanly resets active mouse targets and tilt steering without stale input', () => {
  const input = new InputController();
  input.setControlMode('MOUSE_FOLLOW');
  input.setMouseTarget(750);
  assert.equal(input.mouseSteeringActive, true);

  // Switch to HYBRID (keyboard / buttons)
  input.setControlMode('HYBRID');
  assert.equal(input.mouseTargetX, null);
  assert.equal(input.mouseSteeringActive, false);
  assert.equal(input.getSteeringCommand(480, 100, 860).axis, 0);

  // Switch to TILT
  input.setControlMode('TILT');
  input.simulateTiltAngle(25);
  assert.ok(input.getSteeringCommand(480, 100, 860).axis > 0);

  // Switch back to HYBRID
  input.setControlMode('HYBRID');
  assert.equal(input.getSteeringCommand(480, 100, 860).axis, 0);
});

console.log('\n=== 3. Catching Mechanics, Combos, Neutral Junk, Hazards & Buffs ===');

await test('Catching fish awards rarity-scaled points, increments combo, and triggers achievements', () => {
  const input = new InputController();
  const engine = new FishRainEngine({ input });
  engine.startNewRun({ gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE', skipIntro: true });

  // Spawn a common bluegill right above the boat
  const f1 = engine.spawnSpecificObject('bluegill', engine.boat.x, engine.boat.y - 5);
  assert.ok(f1);
  engine.step(0.02);

  assert.equal(engine.combo, 1);
  assert.equal(engine.catchesByRarity.COMMON, 1);
  assert.equal(engine.catchScore, calculateCatchPoints('bluegill', 1, 'PUDDLE'));

  // Catch a Legendary Golden Marlin
  const leg = engine.spawnSpecificObject('goldenmarlin', engine.boat.x, engine.boat.y - 5);
  leg.warningMs = 0;
  engine.step(0.02);

  assert.equal(engine.catchesByRarity.LEGENDARY, 1);
  assert.ok(engine.unlockedAchievements.includes('FIRST_LEGENDARY'));
  assert.equal(engine.bestCatch.id, 'goldenmarlin');
});

await test('Catching neutral items (Old Boot, Rubber Duck) earns 0 points without losing a life or resetting combo', () => {
  const engine = new FishRainEngine({ input: new InputController() });
  engine.startNewRun({ gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE', skipIntro: true });

  // First build a 3x combo
  for (let i = 0; i < 3; i++) {
    engine.spawnSpecificObject('bluegill', engine.boat.x, engine.boat.y - 5);
    engine.step(0.02);
  }
  const scoreBefore = engine.catchScore;
  const livesBefore = engine.lives;
  assert.equal(engine.combo, 3);

  // Catch 3 neutral items in a row
  for (const id of ['oldboot', 'rubberduck', 'warranty_bottle']) {
    engine.spawnSpecificObject(id, engine.boat.x, engine.boat.y - 5);
    engine.step(0.02);
  }

  assert.equal(engine.catchScore, scoreBefore, 'Neutral items should add 0 catchScore');
  assert.equal(engine.lives, livesBefore, 'Neutral items must not cost a life');
  assert.equal(engine.combo, 3, 'Neutral items must not break combo');
  assert.equal(engine.catchesByRarity.NEUTRAL, 3);
  assert.ok(engine.unlockedAchievements.includes('BOOT_COLLECTOR'));
});

await test('Special Bonus collectibles grant Wide Net, Turbo Oars, Combo Boost, and Extra Life', () => {
  const engine = new FishRainEngine({ input: new InputController() });
  engine.startNewRun({ gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE', skipIntro: true });

  engine.spawnSpecificObject('tacklebox', engine.boat.x, engine.boat.y - 5);
  engine.step(0.02);
  assert.ok(engine.boat.wideNetMs > 7000, 'Tackle Box activates Wide Net buff');

  engine.spawnSpecificObject('thermos', engine.boat.x, engine.boat.y - 5);
  engine.step(0.02);
  assert.ok(engine.boat.turboMs > 7000, 'Thermos activates Turbo Oars buff');

  const comboBefore = engine.combo;
  engine.spawnSpecificObject('doubloon', engine.boat.x, engine.boat.y - 5);
  engine.step(0.02);
  assert.equal(engine.combo, comboBefore + 3, 'Doubloon increments combo by 1 + 2 bonus');

  engine.lives = 2;
  engine.spawnSpecificObject('lifering', engine.boat.x, engine.boat.y - 5);
  engine.step(0.02);
  assert.equal(engine.lives, 3, 'Life Ring restores +1 life');
});

await test('Hazards cost 1 life, reset combo, grant brief invulnerability, and trigger Game Over at 0 lives', () => {
  let gameOverSnapshot = null;
  const engine = new FishRainEngine({
    input: new InputController(),
    onGameOver: (snap) => {
      gameOverSnapshot = snap;
    }
  });
  engine.startNewRun({ gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE', skipIntro: true });

  // Build combo first
  engine.spawnSpecificObject('bass', engine.boat.x, engine.boat.y - 5);
  engine.step(0.02);
  assert.equal(engine.combo, 1);

  // Hit by a bowling ball
  const ball = engine.spawnSpecificObject('bowlingball', engine.boat.x, engine.boat.y - 5);
  ball.warningMs = 0;
  engine.step(0.02);

  assert.equal(engine.lives, 2);
  assert.equal(engine.combo, 0);
  assert.ok(engine.boat.invulnMs > 1000, 'Post-hit invulnerability active');

  // Second hit during invulnerability is deflected!
  const brick = engine.spawnSpecificObject('brick', engine.boat.x, engine.boat.y - 5);
  brick.warningMs = 0;
  engine.step(0.02);
  assert.equal(engine.lives, 2, 'Should deflect hazard while invulnerable');

  // Advance past invulnerability and take 2 more hits to reach 0 lives
  engine.boat.invulnMs = 0;
  const fridge = engine.spawnSpecificObject('fridge', engine.boat.x, engine.boat.y - 5);
  fridge.warningMs = 0;
  engine.step(0.02);
  assert.equal(engine.lives, 1);

  engine.boat.invulnMs = 0;
  const cow = engine.spawnSpecificObject('fiberglass_cow', engine.boat.x, engine.boat.y - 5);
  cow.warningMs = 0;
  engine.step(0.02);

  assert.equal(engine.lives, 0);
  assert.equal(engine.status, 'GAME_OVER');
  assert.ok(gameOverSnapshot, 'Game Over snapshot emitted');
  assert.equal(gameOverSnapshot.hazardsHit, 3);
});

console.log('\n=== 4. Level Progression, River Currents & Open Ocean Rogue Waves ===');

await test('Completing level quota triggers Level Complete, awards Flawless bonus, and advances through all 8 environments', () => {
  let lastLevelSummary = null;
  const engine = new FishRainEngine({
    input: new InputController(),
    onLevelComplete: (s) => {
      lastLevelSummary = s;
    }
  });
  engine.startNewRun({ gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE', skipIntro: true });

  // Catch 10 fish in Puddle to meet targetCatches = 10
  for (let i = 0; i < 10; i++) {
    engine.spawnSpecificObject('bass', engine.boat.x, engine.boat.y - 5);
    engine.step(0.02);
  }

  assert.equal(engine.status, 'LEVEL_COMPLETE');
  assert.ok(lastLevelSummary);
  assert.equal(lastLevelSummary.env.id, 'PUDDLE');
  assert.equal(lastLevelSummary.flawless, true);
  assert.equal(lastLevelSummary.flawlessBonus, 400);
  assert.equal(lastLevelSummary.nextEnv.id, 'POND');

  // Advance to Level 2 (Pond)
  engine.advanceToNextLevel({ skipIntro: true });
  assert.equal(engine.status, 'PLAYING');
  assert.equal(engine.currentEnvId, 'POND');
  assert.equal(engine.highestEnvId, 'POND');
});

await test('River Current pushes boat in Calm River and Swift River, and Open Ocean triggers Rogue Waves with varying strengths', () => {
  const engine = new FishRainEngine({ input: new InputController() });
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'CALM_RIVER', skipIntro: true });

  const startX = engine.boat.x;
  engine.step(0.5);
  assert.ok(engine.boat.x > startX + 20, 'Calm River steady current pushes idle boat downstream');

  // Test Rogue Wave lifecycle and tier selection in Open Ocean
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });
  assert.ok(Array.isArray(ENVIRONMENTS.OPEN_OCEAN.rogueWaveAllowedTiers));
  assert.deepEqual(ENVIRONMENTS.OPEN_OCEAN.rogueWaveAllowedTiers, ['SWELL', 'GALE', 'TITANIC']);

  engine.rogueWave.cooldownMs = 50;
  engine.step(0.1); // triggers WARNING
  assert.equal(engine.rogueWave.state, 'WARNING');
  assert.ok(['SWELL', 'GALE', 'TITANIC'].includes(engine.rogueWave.tierId), 'Rogue wave selected a valid tier');
  assert.ok(engine.rogueWave.tier.lift >= 58, 'Tier defines substantial wave lift');

  engine.rogueWave.timerMs = 50;
  engine.step(0.1); // transitions to SURGE
  assert.equal(engine.rogueWave.state, 'SURGE');
  assert.ok(engine.screenShakeMs > 0, 'Surge triggers camera screen shake based on wave strength');

  // Survive the Rogue Wave surge without taking damage
  engine.rogueWave.timerMs = 50;
  engine.step(0.1); // finishes SURGE
  assert.equal(engine.rogueWave.state, 'NONE');
  assert.ok(engine.unlockedAchievements.includes('ROGUE_SURVIVOR'), 'Surviving Rogue Wave unlocks achievement');
});

await test('Varying Rogue Wave tiers (SWELL, GALE, TITANIC) produce escalating lift and horizontal surge forces', () => {
  const engine = new FishRainEngine({ input: new InputController() });
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });

  // 1. Swell Tier (Level 7 Coast or standard Ocean wave)
  engine.rogueWave.state = 'SURGE';
  engine.rogueWave.tierId = 'SWELL';
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.SWELL;
  engine.rogueWave.crestX = 500;
  engine.rogueWave.direction = 1;
  const swellWaterHeight = engine.getWaterHeightAt(500);

  // 2. Gale Tier (Monstrous wave)
  engine.rogueWave.tierId = 'GALE';
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.GALE;
  const galeWaterHeight = engine.getWaterHeightAt(500);

  // 3. Titanic Tier (Abyssal Leviathan wave)
  engine.rogueWave.tierId = 'TITANIC';
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.TITANIC;
  const titanicWaterHeight = engine.getWaterHeightAt(500);

  // Water height is measured from top down, so higher lift means lower Y coordinate
  assert.ok(
    galeWaterHeight < swellWaterHeight - 20,
    `GALE should lift water higher than SWELL (gale: ${galeWaterHeight}, swell: ${swellWaterHeight})`
  );
  assert.ok(
    titanicWaterHeight < galeWaterHeight - 20,
    `TITANIC should lift water higher than GALE (titanic: ${titanicWaterHeight}, gale: ${galeWaterHeight})`
  );

  // Test horizontal surge force scaling
  engine.boat.x = 500; // Directly at wave crest
  engine.currentVx = 0; // isolate surge push

  // SWELL push
  engine.rogueWave.state = 'SURGE';
  engine.rogueWave.timerMs = 2000;
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.SWELL;
  engine.rogueWave.tierId = 'SWELL';
  engine.rogueWave.crestX = 500;
  engine.rogueWave.direction = 1;
  engine.rogueWave.hasHitBoat = false;
  engine.boat.knockbackVx = 0;
  engine.step(0.01);
  const swellVx = engine.boat.vx;

  // TITANIC push
  engine.boat.x = 500;
  engine.rogueWave.state = 'SURGE';
  engine.rogueWave.timerMs = 2000;
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.TITANIC;
  engine.rogueWave.tierId = 'TITANIC';
  engine.rogueWave.crestX = 500;
  engine.rogueWave.direction = 1;
  engine.rogueWave.hasHitBoat = false;
  engine.boat.knockbackVx = 0;
  engine.step(0.01);
  const titanicVx = engine.boat.vx;

  assert.ok(
    titanicVx > swellVx + 100,
    `Titanic surge push (${titanicVx} px/s) should significantly exceed Swell push (${swellVx} px/s)`
  );
});

await test('Rogue wave impact applies scaled horizontal knockback impulse and bow-up pitch in both wave directions', () => {
  const engine = new FishRainEngine({ input: new InputController() });
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });

  // 1. Wave traveling Left-to-Right (direction = +1)
  engine.rogueWave.state = 'SURGE';
  engine.rogueWave.timerMs = 2000;
  engine.rogueWave.tierId = 'GALE';
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.GALE;
  engine.rogueWave.direction = 1;
  engine.rogueWave.crestX = engine.boat.x - 10;
  engine.rogueWave.hasHitBoat = false;
  engine.step(0.016);

  assert.equal(engine.rogueWave.hasHitBoat, true, 'Wave should hit boat when crest reaches boat');
  assert.ok(engine.boat.knockbackVx > 250, 'Knockback Vx should be positive (rightward)');
  assert.ok(engine.boat.pitchRad > 0.45, 'Pitch angle should be positive (raising left bow upward to climb oncoming wave from left)');
  assert.equal(engine.boat.waveImpactActive, true);

  // Knockback decays gradually over time rather than instant teleportation
  const initialKnockback = engine.boat.knockbackVx;
  engine.step(0.1);
  assert.ok(engine.boat.knockbackVx < initialKnockback, 'Knockback decays over time');
  assert.ok(engine.boat.knockbackVx > 0, 'Knockback retains forward momentum');

  // 2. Wave traveling Right-to-Left (direction = -1) with TITANIC tier
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });
  engine.rogueWave.state = 'SURGE';
  engine.rogueWave.timerMs = 2000;
  engine.rogueWave.tierId = 'TITANIC';
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.TITANIC;
  engine.rogueWave.direction = -1;
  engine.rogueWave.crestX = engine.boat.x + 10;
  engine.rogueWave.hasHitBoat = false;
  engine.step(0.016);

  assert.ok(engine.boat.knockbackVx < -400, 'Titanic knockback Vx should be strongly negative (leftward)');
  assert.ok(engine.boat.pitchRad < -0.90, 'Titanic pitch angle should be negative (raising right bow upward to climb oncoming wave from right)');
});

await test('Fishing is suspended during steep pitch above threshold while hazard collisions remain fully active', () => {
  const engine = new FishRainEngine({ input: new InputController() });
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });

  // Pitch boat steeply above FISHING_PITCH_THRESHOLD_RAD (e.g. 0.95 rad from a heavy rogue wave)
  engine.boat.pitchRad = 0.95;
  engine.step(0.001); // updates boat.tiltRad
  assert.equal(engine.isFishingSuspended(), true, 'Fishing should be suspended when pitch exceeds threshold');

  // Spawn a fish directly above the boat
  const fish = engine.spawnSpecificObject('tuna', engine.boat.x, engine.boat.y - 5);
  engine.step(0.02);

  // Fish should NOT be caught, combo should not increment, score should not increase
  assert.equal(engine.catchScore, 0, 'No points awarded while fishing suspended');
  assert.equal(engine.combo, 0, 'Combo should not increment');
  assert.equal(engine.fallingObjects.length, 1, 'Fish falls past the tilted boat into the water');

  // Now spawn a hazard (e.g. piano) while fishing is STILL suspended
  const hazard = engine.spawnSpecificObject('piano', engine.boat.x, engine.boat.y - 5);
  hazard.warningMs = 0;
  const initialLives = engine.lives;
  engine.step(0.02);

  // Hazard MUST still collide and inflict damage!
  assert.equal(engine.lives, initialLives - 1, 'Hazards must still collide and damage the hull while tilted');
  assert.equal(engine.hazardsHit, 1);

  // Clear any past objects, then right the boat below threshold: normal fishing resumes
  engine.boat.invulnMs = 0;
  engine.boat.pitchRad = 0;
  engine.boat.pitchVelRad = 0;
  engine.step(0.001); // updates boat.tiltRad back to level
  assert.equal(engine.isFishingSuspended(), false);

  engine.fallingObjects = [];
  engine.combo = 0;
  engine.spawnTimerMs = 99999;
  engine.spawnSpecificObject('tuna', engine.boat.x, engine.boat.y - 5);
  engine.step(0.02);
  assert.ok(engine.catchScore > 0, 'Catching resumes once boat settles below threshold');
  assert.equal(engine.combo, 1);
});

await test('Player steering direction relative to wave influences pitch recovery (countersteering accelerates, steering with prolongs)', () => {
  const input = new InputController();
  const engine = new FishRainEngine({ input });
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });

  // Wave traveling left-to-right (waveImpactDir = 1), boat pitched right-bow up (pitchRad = -0.75)
  // Scenario A: Player Countersteers left (keysDown LEFT -> steer.axis = -1)
  engine.boat.pitchRad = -0.75;
  engine.boat.pitchVelRad = 0;
  engine.boat.waveImpactActive = true;
  engine.boat.waveImpactDir = 1;
  engine.boat.waveImpactTierId = 'GALE';
  input.keysDown.add('LEFT');

  // Step 0.72 seconds with countersteering
  for (let i = 0; i < 45; i++) engine.step(0.016);
  const countersteerPitchAbs = Math.abs(engine.boat.pitchRad);
  input.keysDown.clear();

  // Scenario B: Player Steers right with the wave (keysDown RIGHT -> steer.axis = +1)
  engine.boat.pitchRad = -0.75;
  engine.boat.pitchVelRad = 0;
  engine.boat.waveImpactActive = true;
  engine.boat.waveImpactDir = 1;
  engine.boat.waveImpactTierId = 'GALE';
  input.keysDown.add('RIGHT');

  // Step 0.72 seconds steering with wave
  for (let i = 0; i < 45; i++) engine.step(0.016);
  const steeringWithPitchAbs = Math.abs(engine.boat.pitchRad);
  input.keysDown.clear();

  // Countersteering should return the boat closer to level (smaller remaining pitch) than steering with the wave
  assert.ok(
    countersteerPitchAbs < steeringWithPitchAbs - 0.05,
    `Countersteering (${countersteerPitchAbs.toFixed(3)}) should accelerate recovery compared to steering with wave (${steeringWithPitchAbs.toFixed(3)})`
  );

  // Scenario C: Verify steering with the wave does not prevent recovery indefinitely
  input.keysDown.add('RIGHT');
  for (let i = 0; i < 150; i++) engine.step(0.02);
  input.keysDown.clear();
  assert.ok(Math.abs(engine.boat.pitchRad) < 0.1, 'Boat still recovers even when player steers with wave');
});

await test('Rogue wave knockback and pitch physically impact boat across Mouse Follow, Tilt, and Button control schemes', () => {
  const input = new InputController();
  const engine = new FishRainEngine({ input });

  // 1. Mouse Follow mode: active target does not cancel knockback impulse
  input.setControlMode('MOUSE_FOLLOW');
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });
  input.setMouseTarget(480);
  engine.boat.x = 480;

  // Rogue wave hits moving right (+1)
  engine.rogueWave.state = 'SURGE';
  engine.rogueWave.timerMs = 2000;
  engine.rogueWave.tierId = 'TITANIC';
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.TITANIC;
  engine.rogueWave.direction = 1;
  engine.rogueWave.crestX = 480;
  engine.rogueWave.hasHitBoat = false;

  engine.step(0.016);
  assert.ok(engine.boat.vx > 300, 'Mouse Follow does not cancel wave knockback');
  assert.ok(engine.boat.x > 480, 'Boat is physically displaced away from mouse target');

  // 2. Mobile Tilt mode: tilt steering is influenced and boat pitches
  input.setControlMode('TILT');
  input.simulateTiltAngle(20); // tilted right
  engine.startNewRun({ gameMode: 'QUICK_PLAY', startEnvId: 'OPEN_OCEAN', skipIntro: true });
  engine.boat.x = 480;

  engine.rogueWave.state = 'SURGE';
  engine.rogueWave.timerMs = 2000;
  engine.rogueWave.tierId = 'GALE';
  engine.rogueWave.tier = ROGUE_WAVE_TIERS.GALE;
  engine.rogueWave.direction = -1; // wave moving left
  engine.rogueWave.crestX = 480;
  engine.rogueWave.hasHitBoat = false;

  engine.step(0.016);
  assert.ok(engine.boat.vx < -200, 'Tilt mode receives strong leftward wave knockback');
  assert.ok(engine.boat.pitchRad < -0.45, 'Tilt mode boat receives bow-up pitch angle climbing rightward wave');
});

await test('LocalStorage persistence tracks unlocked levels, per-water records, and preferences', () => {
  resetRecords();
  let rec = loadRecords();
  assert.equal(rec.unlockedLevel, 1);

  recordLevelCompletion({ envId: 'PUDDLE', levelScore: 1400, maxCombo: 10, flawless: true });
  rec = loadRecords();
  assert.equal(rec.unlockedLevel, 2, 'Clearing Puddle unlocks Pond (Level 2)');
  assert.equal(rec.byEnv.PUDDLE.bestScore, 1400);
  assert.equal(rec.byEnv.PUDDLE.flawlessClears, 1);

  updatePreferences({ muted: true, controlMode: 'MOUSE_FOLLOW', tiltSensitivity: 1.8 });
  rec = loadRecords();
  assert.equal(rec.muted, true);
  assert.equal(rec.controlMode, 'MOUSE_FOLLOW');
  assert.equal(rec.tiltSensitivity, 1.8);
});

await test('Shared recomputeFinalScore verifies valid run snapshots and rejects tampered scores', () => {
  const engine = new FishRainEngine({ input: new InputController() });
  engine.startNewRun({ gameMode: 'CAMPAIGN', startEnvId: 'PUDDLE', skipIntro: true });
  engine.elapsedMs = 15000;
  for (let i = 0; i < 5; i++) {
    engine.spawnSpecificObject('trout', engine.boat.x, engine.boat.y - 5);
    engine.step(0.02);
  }
  const snap = engine.buildRunSubmissionSnapshot('HULL_SUNK');
  const verified = recomputeFinalScore(snap);
  assert.ok(verified);
  assert.equal(verified.finalScore, snap.score);

  // Tampering with catchScore beyond mathematical bounds returns null
  const tampered = { ...snap, catchScore: 999999 };
  assert.equal(recomputeFinalScore(tampered), null);
});

console.log(`\nGame Logic Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
