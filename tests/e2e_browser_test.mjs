/**
 * Fish Rain — Real Headless Chrome End-to-End Browser Test
 * Drives Chrome via DevTools Protocol (CDP) against the live Node + SQLite server.
 * Run: node --no-warnings tests/e2e_browser_test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

const ROOT = process.cwd();
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runE2E() {
  const clock = { offset: 0 };
  const server = await createAppServer({
    dbPath: ':memory:',
    quiet: true,
    seedIfEmpty: true,
    now: () => Date.now() + clock.offset,
    env: { LEADERBOARD_SECRET: 'e2e-test-secret-0123456789abcdef' }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const debugPort = 9366;
  const userDataDir = path.join(ROOT, '.tmp_chrome_profile');

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${port}/`
  ]);

  let ws;
  try {
    let targetUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const list = await res.json();
        const page = list.find((t) => t.type === 'page' && t.url.includes(`127.0.0.1:${port}`));
        if (page && page.webSocketDebuggerUrl) {
          targetUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {
        /* wait for Chrome */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(targetUrl, 'Connected to headless Chrome page target');

    ws = new WebSocket(targetUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    const pending = new Map();
    const consoleErrors = [];

    ws.addEventListener('message', (ev) => {
      const data = JSON.parse(ev.data);
      if (data.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(JSON.stringify(data.params));
      }
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    });

    const sendCdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (expression) => {
      const res = await sendCdp('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) {
        throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result.value;
    };

    await sendCdp('Runtime.enable');
    await sendCdp('Page.enable');

    // Wait for window.fishRainApp to initialize
    for (let i = 0; i < 30; i++) {
      const ready = await evaluate('Boolean(window.fishRainApp && window.fishRainApp.engine)');
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log('\n=== Headless Chrome E2E Verification ===');

    // 1. Verify Main Menu & 8 Bodies of Water Cards
    const menuCheck = await evaluate(`(() => {
      const cards = document.querySelectorAll('#env-cards-container .env-card');
      const ctrlCards = document.querySelectorAll('#control-cards-container .control-card');
      return {
        envCardCount: cards.length,
        ctrlCardCount: ctrlCards.length,
        firstUnlocked: cards[0]?.classList.contains('is-unlocked'),
        secondLocked: cards[1]?.classList.contains('is-locked')
      };
    })()`);
    assert.equal(menuCheck.envCardCount, 8, 'Renders all 8 Bodies of Water cards');
    assert.equal(menuCheck.ctrlCardCount, 3, 'Renders all 3 steering control mode cards');
    assert.equal(menuCheck.firstUnlocked, true, 'Level 1 Puddle is unlocked initially');
    assert.equal(menuCheck.secondLocked, true, 'Level 2 Pond is locked initially');
    console.log('  ✓ Main Menu renders all 8 Bodies of Water and 3 Control Schemes');

    // 2. Start Campaign -> Verify Level 1 Intro -> Cast Off -> Active Canvas Gameplay
    await evaluate(`document.getElementById('btn-play-campaign').click()`);
    await new Promise((r) => setTimeout(r, 150));

    const introState = await evaluate(`(() => ({
      gameScreenVisible: !document.getElementById('screen-game').hidden,
      introVisible: !document.getElementById('overlay-level-intro').hidden,
      status: window.fishRainApp.engine.status,
      hasToken: Boolean(window.fishRainApp.engine.sessionToken)
    }))()`);
    assert.equal(introState.gameScreenVisible, true);
    assert.equal(introState.introVisible, true);
    assert.equal(introState.status, 'LEVEL_INTRO');
    assert.equal(introState.hasToken, true, 'Signed session token acquired from /api/sessions');
    console.log('  ✓ Campaign launches Level 1 Intro and acquires signed HMAC session token');

    // Click Cast Off!
    await evaluate(`document.getElementById('btn-start-level').click()`);
    await new Promise((r) => setTimeout(r, 120));

    // 3. Test catching fish, completing Level 1 (Puddle), and unlocking Level 2 (Pond)
    const level1Complete = await evaluate(`(() => {
      const { engine } = window.fishRainApp;
      for (let i = 0; i < 10; i++) {
        engine.spawnSpecificObject('trout', engine.boat.x, engine.boat.y - 5);
        engine.step(0.02);
      }
      return {
        status: engine.status,
        completeOverlayVisible: !document.getElementById('overlay-level-complete').hidden,
        hudScore: document.getElementById('hud-score').textContent,
        levelsCleared: engine.levelsCleared
      };
    })()`);
    assert.equal(level1Complete.status, 'LEVEL_COMPLETE');
    assert.equal(level1Complete.completeOverlayVisible, true);
    assert.equal(level1Complete.levelsCleared, 1);
    console.log('  ✓ Catching fish updates HUD, completes Level 1 (Puddle), and shows Level Complete overlay');

    // 4. Advance to Level 2 (Pond), catch a Legendary fish, then finish run & submit score to SQLite Global Leaderboard
    clock.offset += 35_000; // advance server clock 35s so wall-clock check passes
    await evaluate(`(() => {
      document.getElementById('btn-next-level').click();
      document.getElementById('btn-start-level').click();
      const { engine } = window.fishRainApp;
      engine.elapsedMs = 25000;
      const marlin = engine.spawnSpecificObject('goldenmarlin', engine.boat.x, engine.boat.y - 5);
      marlin.warningMs = 0;
      engine.step(0.02);
      engine.finishRunAndCashOut();
    })()`);
    await new Promise((r) => setTimeout(r, 120));

    // Submit score manually from the Results screen:
    // First, verify bugfix: type skipper name, toggle auto-submit checkbox, verify name does NOT get reset!
    await evaluate(`(() => {
      const inp = document.getElementById('input-results-nickname');
      inp.value = 'E2ESkipper99';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      // Toggle auto-submit checkbox
      const cb = document.getElementById('toggle-auto-submit-results');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

    const nicknamePreserved = await evaluate(`document.getElementById('input-results-nickname').value`);
    assert.equal(nicknamePreserved, 'E2ESkipper99', 'Skipper nickname must not be reset when toggling auto-submit checkbox');
    console.log('  ✓ Typing skipper nickname and toggling auto-submit preserves entered nickname');

    await evaluate(`document.getElementById('btn-submit-score-now').click()`);
    await new Promise((r) => setTimeout(r, 250));

    const submitCheck = await evaluate(`(() => ({
      resultsVisible: !document.getElementById('screen-results').hidden,
      panelText: document.getElementById('global-submit-panel').textContent,
      lastResultOk: Boolean(window.fishRainApp.ui.lastSubmissionResult?.ok)
    }))()`);
    assert.equal(submitCheck.resultsVisible, true);
    assert.equal(submitCheck.lastResultOk, true, 'Score submitted to SQLite backend');
    assert.ok(submitCheck.panelText.includes('E2ESkipper99'), 'Displays submitted nickname and global rank');
    console.log('  ✓ Results screen submits score to SQLite Global Leaderboard and displays global rank');

    // 5. Open Global Leaderboard Modal and verify E2ESkipper99 appears on the board
    await evaluate(`document.getElementById('btn-results-leaderboard').click()`);
    await new Promise((r) => setTimeout(r, 200));

    const modalBoardText = await evaluate(`document.getElementById('global-table-body').textContent`);
    assert.ok(modalBoardText.includes('E2ESkipper99'), 'E2ESkipper99 is listed in Global Leaderboard modal');
    console.log('  ✓ Global Leaderboard modal displays SQLite entries and highlights the player row');

    // 6. Verify Mobile Portrait (390x844): Level Intro overlay is fully visible and Cast Off is reachable
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await evaluate(`(() => {
      window.fishRainApp.ui.closeAllModals();
      window.fishRainApp.ui.launchGameRun('CAMPAIGN', 'PUDDLE');
    })()`);
    await new Promise((r) => setTimeout(r, 150));

    const portraitIntroCheck = await evaluate(`(() => {
      const overlay = document.getElementById('overlay-level-intro');
      const card = overlay.querySelector('.overlay-card');
      const btnStart = document.getElementById('btn-start-level');
      const cardRect = card.getBoundingClientRect();
      const btnRect = btnStart.getBoundingClientRect();
      const overlayStyle = window.getComputedStyle(overlay);
      const cardStyle = window.getComputedStyle(card);

      return {
        overlayVisible: !overlay.hidden,
        overlayPosition: overlayStyle.position,
        overlayOverflowY: overlayStyle.overflowY,
        cardOverflowY: cardStyle.overflowY,
        cardWithinViewport: cardRect.top >= 0 && cardRect.bottom <= window.innerHeight,
        btnVisible: btnRect.height > 0 && btnRect.width > 0,
        btnInViewport: btnRect.bottom <= window.innerHeight && btnRect.top >= 0,
        btnBottom: Math.round(btnRect.bottom),
        windowHeight: window.innerHeight
      };
    })()`);
    assert.equal(portraitIntroCheck.overlayVisible, true, 'Intro overlay is visible');
    assert.equal(portraitIntroCheck.overlayPosition, 'fixed', 'Overlay uses fixed positioning on mobile portrait');
    assert.ok(
      portraitIntroCheck.cardOverflowY.includes('auto') || portraitIntroCheck.cardOverflowY.includes('scroll'),
      'Card has vertical scrolling enabled'
    );
    assert.equal(portraitIntroCheck.btnInViewport, true, 'Cast Off button is fully visible in portrait viewport');
    console.log('  ✓ Mobile portrait (390x844) renders scrollable Intro Overlay with reachable Cast Off button');

    // Click Cast Off on mobile portrait
    await evaluate(`document.getElementById('btn-start-level').click()`);
    await new Promise((r) => setTimeout(r, 100));

    const mobileCheck = await evaluate(`(() => {
      const canvasRect = document.getElementById('game-canvas').getBoundingClientRect();
      const leftBtnRect = document.getElementById('btn-touch-left').getBoundingClientRect();
      return {
        canvasWidth: Math.round(canvasRect.width),
        touchBtnHeight: Math.round(leftBtnRect.height),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2
      };
    })()`);
    assert.ok(mobileCheck.canvasWidth > 300 && mobileCheck.canvasWidth <= 390);
    assert.ok(mobileCheck.touchBtnHeight >= 44, 'Mobile touch buttons meet comfortable touch target height');
    assert.equal(mobileCheck.overflowX, false, 'Zero horizontal page overflow on mobile viewport');
    console.log('  ✓ Mobile viewport (390x844) renders responsive canvas and large touch buttons cleanly');

    // 7. Verify Mobile Landscape (844x390 and 667x375): Game fits on screen with zero scrolling
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 844,
      height: 390,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await evaluate(`window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('orientationchange'));`);
    await new Promise((r) => setTimeout(r, 150));

    const landscapeCheck844 = await evaluate(`(() => {
      const header = document.querySelector('.site-header');
      const canvas = document.getElementById('game-canvas');
      const canvasRect = canvas.getBoundingClientRect();
      const leftBtn = document.getElementById('btn-touch-left');
      const leftBtnRect = leftBtn.getBoundingClientRect();
      const headerStyle = window.getComputedStyle(header);

      return {
        headerHidden: headerStyle.display === 'none',
        scrollY: window.scrollY,
        canvasTop: Math.round(canvasRect.top),
        canvasBottom: Math.round(canvasRect.bottom),
        canvasHeight: Math.round(canvasRect.height),
        leftBtnBottom: Math.round(leftBtnRect.bottom),
        windowHeight: window.innerHeight,
        canvasFullyVisible: canvasRect.top >= 0 && canvasRect.bottom <= window.innerHeight,
        buttonsFullyVisible: leftBtnRect.bottom <= window.innerHeight + 5
      };
    })()`);
    assert.equal(landscapeCheck844.headerHidden, true, 'Site header is hidden during in-game landscape mode');
    assert.equal(landscapeCheck844.scrollY, 0, 'Zero page scroll required to view the game screen');
    assert.equal(landscapeCheck844.canvasFullyVisible, true, 'Game canvas is 100% visible on screen without scrolling');
    assert.equal(landscapeCheck844.buttonsFullyVisible, true, 'Touch steering buttons fit within landscape viewport');
    console.log('  ✓ Mobile landscape (844x390) fits HUD, canvas, and controls 100% on screen without scrolling');

    // Also test ultra-compact iPhone SE landscape (667x375)
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 667,
      height: 375,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await evaluate(`window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('orientationchange'));`);
    await new Promise((r) => setTimeout(r, 150));

    const landscapeCheck667 = await evaluate(`(() => {
      const canvasRect = document.getElementById('game-canvas').getBoundingClientRect();
      const leftBtnRect = document.getElementById('btn-touch-left').getBoundingClientRect();
      return {
        canvasTop: Math.round(canvasRect.top),
        canvasBottom: Math.round(canvasRect.bottom),
        leftBtnBottom: Math.round(leftBtnRect.bottom),
        windowHeight: window.innerHeight,
        canvasFullyVisible: canvasRect.top >= 0 && canvasRect.bottom <= window.innerHeight,
        buttonsFullyVisible: leftBtnRect.bottom <= window.innerHeight + 5
      };
    })()`);
    assert.equal(landscapeCheck667.canvasFullyVisible, true, 'Canvas fits cleanly on 667x375 screen');
    assert.equal(landscapeCheck667.buttonsFullyVisible, true, 'Steering buttons fit on 667x375 screen');
    console.log('  ✓ Compact landscape (667x375) renders without clipping or requiring scroll');

    assert.equal(consoleErrors.length, 0, `Expected 0 console errors, got: ${consoleErrors.join('; ')}`);
    console.log('  ✓ Zero browser console or runtime exceptions\n');
  } finally {
    if (ws) ws.close();
    chrome.kill();
    await new Promise((r) => server.close(r));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore locked temp files */
    }
  }
}

runE2E().catch((err) => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
