/**
 * Fish Rain — User Interface, Menus, HUD, Modals & Global Leaderboard Integration
 */

import {
  ENVIRONMENTS,
  ENVIRONMENT_ORDER,
  CONTROL_MODES,
  ACHIEVEMENTS
} from './config.js';
import { sound } from './sound.js';
import {
  loadRecords,
  unlockEnvironmentLevel,
  recordLevelCompletion,
  recordRunFinished,
  updatePreferences,
  resetRecords
} from './storage.js';
import {
  validateNickname,
  generateDefaultNickname,
  loadAutoSubmitPreference,
  saveAutoSubmitPreference,
  loadSavedNickname,
  saveNickname,
  createSession,
  submitScore,
  fetchLeaderboard
} from './leaderboard.js';

export class FishRainUI {
  constructor({ engine, input }) {
    this.engine = engine;
    this.input = input;

    this.lastRunSnapshot = null;
    this.lastSubmissionResult = null;
    this.submittingScore = false;

    this.globalState = {
      env: 'all',
      mode: 'all',
      sort: 'score',
      limit: 20,
      offset: 0,
      total: 0,
      highlightNickname: ''
    };
  }

  init() {
    const records = loadRecords();
    sound.setMuted(records.muted);
    this.input.setControlMode(records.controlMode);
    this.input.setTiltSensitivity(records.tiltSensitivity);

    // Ensure a valid default nickname is ready
    let savedNick = loadSavedNickname();
    if (!savedNick || !validateNickname(savedNick).ok) {
      savedNick = generateDefaultNickname();
      saveNickname(savedNick);
    }

    this._bindHeaderAndModals();
    this._bindMenuControls();
    this._bindGameplayControls();
    this._bindResultsControls();
    this._bindGlobalLeaderboardModal();

    this.syncSoundButton();
    this.syncControlPreferenceUI();
    this.syncAutoSubmitAndNicknameUI();
    this.renderEnvironmentCards();
    this.populateGlobalFilterSelects();

    // Pause automatically if tab is hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.engine.pauseIfPlaying();
      }
    });

    // Reset scroll to top on orientation change or resize during active gameplay
    window.addEventListener('orientationchange', () => {
      if (document.body?.classList.contains('in-game')) {
        window.scrollTo(0, 0);
      }
    });
    window.addEventListener('resize', () => {
      if (document.body?.classList.contains('in-game')) {
        window.scrollTo(0, 0);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Screen Switching & Modals                                           */
  /* ------------------------------------------------------------------ */

  showScreen(screenId) {
    for (const id of ['screen-menu', 'screen-game', 'screen-results']) {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== screenId;
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('in-game', screenId === 'screen-game');
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
    if (screenId === 'screen-menu') {
      this.engine.stopLoop();
      this.renderEnvironmentCards();
      this.syncControlPreferenceUI();
    }
  }

  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    if (this.engine.status === 'PLAYING') {
      this.engine.pauseIfPlaying();
    }
    el.hidden = false;
  }

  closeAllModals() {
    for (const el of document.querySelectorAll('.modal-backdrop')) {
      el.hidden = true;
    }
  }

  _bindHeaderAndModals() {
    document.getElementById('btn-help')?.addEventListener('click', () => {
      this.openModal('modal-help');
    });

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.syncControlPreferenceUI();
      this.openModal('modal-settings');
    });

    document.getElementById('btn-records')?.addEventListener('click', () => {
      this.renderLocalRecordsModal();
      this.openModal('modal-records');
    });

    document.getElementById('btn-global')?.addEventListener('click', () => {
      this.openGlobalLeaderboard();
    });

    document.getElementById('btn-mute')?.addEventListener('click', () => {
      const nextMuted = !sound.isMuted();
      sound.setMuted(nextMuted);
      updatePreferences({ muted: nextMuted });
      this.syncSoundButton();
    });

    for (const btn of document.querySelectorAll('[data-close-modal]')) {
      btn.addEventListener('click', () => this.closeAllModals());
    }

    for (const backdrop of document.querySelectorAll('.modal-backdrop')) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.closeAllModals();
      });
    }

    document.getElementById('btn-reset-records')?.addEventListener('click', () => {
      resetRecords();
      this.renderLocalRecordsModal();
      this.renderEnvironmentCards();
    });
  }

  syncSoundButton() {
    const btn = document.getElementById('btn-mute');
    if (!btn) return;
    const muted = sound.isMuted();
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btn.textContent = muted ? '🔇 Sound: OFF' : '🔊 Sound: ON';
  }

  /* ------------------------------------------------------------------ */
  /* Main Menu & Environment Cards                                       */
  /* ------------------------------------------------------------------ */

  _bindMenuControls() {
    document.getElementById('btn-play-campaign')?.addEventListener('click', () => {
      this.launchGameRun('CAMPAIGN', 'PUDDLE');
    });

    document.getElementById('btn-unlock-all-levels')?.addEventListener('click', () => {
      unlockEnvironmentLevel(ENVIRONMENT_ORDER.length);
      this.renderEnvironmentCards();
    });

    document.getElementById('btn-menu-open-global')?.addEventListener('click', () => {
      this.openGlobalLeaderboard();
    });

    // Auto-submit & nickname bindings on menu and modal
    const bindAutoToggle = (checkboxId) => {
      const cb = document.getElementById(checkboxId);
      if (!cb) return;
      cb.addEventListener('change', () => {
        saveAutoSubmitPreference(cb.checked);
        this.syncAutoSubmitAndNicknameUI();
      });
    };
    bindAutoToggle('toggle-auto-submit');
    bindAutoToggle('toggle-auto-submit-modal');

    const bindNicknameInput = (inputId, feedbackId) => {
      const inp = document.getElementById(inputId);
      if (!inp) return;
      inp.addEventListener('input', () => {
        const res = validateNickname(inp.value);
        const fb = document.getElementById(feedbackId);
        if (res.ok) {
          saveNickname(res.value);
          if (fb) fb.hidden = true;
          this.syncNicknameInputs(inp);
        } else if (fb) {
          fb.textContent = res.message;
          fb.hidden = false;
        }
      });
    };
    bindNicknameInput('input-leaderboard-nickname', 'pref-nickname-feedback');
    bindNicknameInput('input-leaderboard-nickname-modal', 'pref-nickname-feedback-modal');

    const bindRandomBtn = (btnId) => {
      document.getElementById(btnId)?.addEventListener('click', () => {
        const nick = generateDefaultNickname();
        saveNickname(nick);
        this.syncAutoSubmitAndNicknameUI();
      });
    };
    bindRandomBtn('btn-generate-nickname');
    bindRandomBtn('btn-generate-nickname-modal');

    // Settings modal radio & tilt bindings
    for (const radio of document.querySelectorAll('input[name="modal-control-mode"]')) {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        const val = radio.value;
        if (val === 'TILT') {
          await this._handleActivateTilt();
        } else {
          this.input.setControlMode(val);
          updatePreferences({ controlMode: val });
          this.syncControlPreferenceUI();
        }
      });
    }

    const slider = document.getElementById('input-tilt-sensitivity');
    slider?.addEventListener('input', () => {
      const val = Number(slider.value);
      this.input.setTiltSensitivity(val);
      updatePreferences({ tiltSensitivity: val });
      this.syncControlPreferenceUI();
    });

    document.getElementById('btn-enable-tilt')?.addEventListener('click', () => {
      this._handleActivateTilt();
    });

    document.getElementById('btn-calibrate-tilt')?.addEventListener('click', () => {
      const zero = this.input.calibrateTilt();
      const msgEl = document.getElementById('tilt-status-message');
      if (msgEl) {
        msgEl.textContent = `Calibrated neutral center at ${zero.toFixed(1)}°. Tilt left or right to steer!`;
      }
    });

    document.getElementById('btn-fallback-buttons')?.addEventListener('click', () => {
      this.switchToButtonsControl();
    });
  }

  async _handleActivateTilt() {
    const res = await this.input.enableTiltMode();
    const msgEl = document.getElementById('tilt-status-message');
    if (msgEl) {
      msgEl.textContent = res.message;
    }
    if (res.ok) {
      updatePreferences({ controlMode: 'TILT' });
    } else {
      this.input.setControlMode('HYBRID');
      updatePreferences({ controlMode: 'HYBRID' });
    }
    this.syncControlPreferenceUI();
  }

  switchToButtonsControl() {
    this.input.setControlMode('HYBRID');
    updatePreferences({ controlMode: 'HYBRID' });
    const msgEl = document.getElementById('tilt-status-message');
    if (msgEl) {
      msgEl.textContent = 'Switched to Keyboard + On-Screen Buttons.';
    }
    this.syncControlPreferenceUI();
  }

  syncNicknameInputs(excludeInput = null) {
    const saved = loadSavedNickname();
    for (const id of ['input-leaderboard-nickname', 'input-leaderboard-nickname-modal', 'input-results-nickname']) {
      const el = document.getElementById(id);
      if (el && el !== excludeInput) {
        el.value = saved;
      }
    }
  }

  syncAutoSubmitAndNicknameUI() {
    const enabled = loadAutoSubmitPreference();
    for (const id of ['toggle-auto-submit', 'toggle-auto-submit-modal', 'toggle-auto-submit-results']) {
      const cb = document.getElementById(id);
      if (cb) cb.checked = enabled;
    }
    this.syncNicknameInputs();
  }

  syncControlPreferenceUI() {
    const mode = this.input.controlMode;
    const sens = this.input.tiltSensitivity;

    // Render Menu Control Cards
    const container = document.getElementById('control-cards-container');
    if (container) {
      container.innerHTML = '';
      for (const ctrl of Object.values(CONTROL_MODES)) {
        const card = document.createElement('div');
        card.className = `control-card ${ctrl.id === mode ? 'is-selected' : ''}`;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        const title = document.createElement('h3');
        title.textContent = `${ctrl.id === mode ? '✅ ' : ''}${ctrl.name}`;
        const desc = document.createElement('p');
        desc.textContent = ctrl.description;

        card.append(title, desc);
        const selectHandler = async () => {
          if (ctrl.id === 'TILT') {
            await this._handleActivateTilt();
            this.openModal('modal-settings');
          } else {
            this.input.setControlMode(ctrl.id);
            updatePreferences({ controlMode: ctrl.id });
            this.syncControlPreferenceUI();
          }
        };
        card.addEventListener('click', selectHandler);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectHandler();
          }
        });
        container.appendChild(card);
      }
    }

    // Sync Settings Modal radio buttons & slider
    for (const radio of document.querySelectorAll('input[name="modal-control-mode"]')) {
      radio.checked = radio.value === mode;
    }
    const slider = document.getElementById('input-tilt-sensitivity');
    if (slider) slider.value = String(sens);
    const label = document.getElementById('label-tilt-sensitivity');
    if (label) label.textContent = `${sens.toFixed(1)}×`;

    // Sync Gameplay HUD & Touch Bar Indicators
    const modeMeta = CONTROL_MODES[mode] || CONTROL_MODES.HYBRID;
    const pill = document.getElementById('touch-mode-indicator');
    if (pill) {
      pill.textContent = `Controls: ${modeMeta.shortName}`;
    }

    const hudSwitchBtn = document.getElementById('btn-switch-to-buttons');
    if (hudSwitchBtn) {
      hudSwitchBtn.hidden = mode !== 'TILT';
    }
    const tiltQuickBar = document.getElementById('tilt-quick-bar');
    if (tiltQuickBar) {
      tiltQuickBar.hidden = mode !== 'TILT';
    }
  }

  renderEnvironmentCards() {
    const container = document.getElementById('env-cards-container');
    if (!container) return;
    container.innerHTML = '';

    const records = loadRecords();
    const unlockedLevel = records.unlockedLevel || 1;

    for (const envId of ENVIRONMENT_ORDER) {
      const env = ENVIRONMENTS[envId];
      const isUnlocked = env.level <= unlockedLevel;
      const stats = records.byEnv[envId] || { bestScore: 0, timesCleared: 0 };

      const card = document.createElement('div');
      card.className = `env-card ${isUnlocked ? 'is-unlocked' : 'is-locked'}`;
      card.dataset.envId = env.id;

      const top = document.createElement('div');
      top.className = 'env-card-top';

      const pill = document.createElement('span');
      pill.className = 'env-level-pill';
      pill.textContent = `Level ${env.level} • ${env.shortName}`;

      const mult = document.createElement('span');
      mult.className = 'env-mult-pill';
      mult.textContent = `${env.difficultyMultiplier.toFixed(2)}× Score`;
      top.append(pill, mult);

      const h3 = document.createElement('h3');
      h3.textContent = `${env.icon} ${env.name}`;

      const desc = document.createElement('p');
      desc.textContent = env.newChallenge;

      const meta = document.createElement('div');
      meta.className = 'env-card-meta';
      const bestSpan = document.createElement('span');
      bestSpan.textContent = `Best: ${stats.bestScore.toLocaleString()} pts`;
      const quotaSpan = document.createElement('span');
      quotaSpan.textContent = `Quota: ${env.targetCatches} Fish or ${env.targetScore.toLocaleString()} pts`;
      meta.append(bestSpan, quotaSpan);

      const actions = document.createElement('div');
      actions.className = 'env-card-actions';

      const btn = document.createElement('button');
      btn.type = 'button';
      if (isUnlocked) {
        btn.className = env.level === 1 ? 'btn-primary btn-sm' : 'btn-nav btn-sm';
        btn.textContent = `🚤 Quick Play ${env.shortName}`;
        btn.addEventListener('click', () => {
          this.launchGameRun('QUICK_PLAY', env.id);
        });
      } else {
        btn.className = 'btn-nav btn-sm';
        btn.disabled = true;
        btn.textContent = `🔒 Clear Level ${env.level - 1} to Unlock`;
      }
      actions.appendChild(btn);

      card.append(top, h3, desc, meta, actions);
      container.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Launching & Managing Active Gameplay                                */
  /* ------------------------------------------------------------------ */

  async launchGameRun(gameMode = 'CAMPAIGN', startEnvId = 'PUDDLE') {
    this.closeAllModals();
    this.lastRunSnapshot = null;
    this.lastSubmissionResult = null;

    this.showScreen('screen-game');
    this.engine.startNewRun({
      gameMode,
      startEnvId,
      sessionToken: null,
      skipIntro: false
    });

    // Request signed server session token asynchronously so offline play is never blocked
    const token = await createSession(this.engine.gameMode, this.engine.startEnvId);
    if (token) {
      this.engine.setSessionToken(token);
    }
  }

  _bindGameplayControls() {
    const canvas = document.getElementById('game-canvas');
    const btnLeft = document.getElementById('btn-touch-left');
    const btnRight = document.getElementById('btn-touch-right');

    this.input.attachCanvas(canvas);
    this.input.attachTouchButtons(btnLeft, btnRight);

    document.getElementById('btn-start-level')?.addEventListener('click', () => {
      document.getElementById('overlay-level-intro').hidden = true;
      this.engine.beginActiveLevelPlay();
    });

    document.getElementById('btn-next-level')?.addEventListener('click', () => {
      document.getElementById('overlay-level-complete').hidden = true;
      this.engine.advanceToNextLevel({ skipIntro: false });
    });

    document.getElementById('btn-finish-quickplay')?.addEventListener('click', () => {
      document.getElementById('overlay-level-complete').hidden = true;
      this.engine.finishRunAndCashOut();
    });

    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.engine.togglePause();
    });

    document.getElementById('btn-resume-game')?.addEventListener('click', () => {
      this.engine.togglePause();
    });

    document.getElementById('btn-pause-settings')?.addEventListener('click', () => {
      this.syncControlPreferenceUI();
      this.openModal('modal-settings');
    });

    document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
      this.launchGameRun(this.engine.gameMode, this.engine.startEnvId);
    });

    document.getElementById('btn-pause-menu')?.addEventListener('click', () => {
      this.showScreen('screen-menu');
    });

    document.getElementById('btn-abandon-run')?.addEventListener('click', () => {
      this.showScreen('screen-menu');
    });

    document.getElementById('btn-switch-to-buttons')?.addEventListener('click', () => {
      this.switchToButtonsControl();
    });

    document.getElementById('btn-quick-calibrate')?.addEventListener('click', () => {
      this.input.calibrateTilt();
      this.engine.setBanner('🎯 Tilt Center Calibrated!', '#4ade80', 1800);
    });

    document.getElementById('btn-quick-disable-tilt')?.addEventListener('click', () => {
      this.switchToButtonsControl();
    });
  }

  handleLevelIntro(env) {
    const overlay = document.getElementById('overlay-level-intro');
    if (!overlay) return;

    document.getElementById('overlay-level-complete').hidden = true;
    document.getElementById('overlay-pause').hidden = true;

    document.getElementById('intro-level-badge').textContent =
      this.engine.gameMode === 'CAMPAIGN'
        ? `CAMPAIGN • BODY OF WATER ${env.level} OF 8`
        : `QUICK PLAY • LEVEL ${env.level}`;
    document.getElementById('intro-env-title').textContent = `${env.icon} ${env.name}`;
    document.getElementById('intro-env-tagline').textContent = env.tagline;
    document.getElementById('intro-env-challenge').textContent = env.newChallenge;
    document.getElementById('intro-env-targets').textContent =
      `Level Quota: Catch ${env.targetCatches} Fish OR reach ${env.targetScore.toLocaleString()} Level Points (${env.difficultyMultiplier.toFixed(2)}× Multiplier)`;

    overlay.hidden = false;
  }

  handleLevelComplete(summary) {
    recordLevelCompletion({
      envId: summary.env.id,
      levelScore: summary.levelCatchScore + summary.levelClearBonus + summary.flawlessBonus,
      maxCombo: this.engine.maxCombo,
      flawless: summary.flawless
    });

    const overlay = document.getElementById('overlay-level-complete');
    if (!overlay) return;

    document.getElementById('complete-title').textContent = `${summary.env.icon} ${summary.env.name} Cleared!`;

    const grid = document.getElementById('complete-stats-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="stat-mini-box">
          <span>Level Catch Score</span>
          <strong>+${summary.levelCatchScore.toLocaleString()} pts</strong>
        </div>
        <div class="stat-mini-box">
          <span>Fish Caught in Level</span>
          <strong>${summary.levelFishCaught} Fish</strong>
        </div>
        <div class="stat-mini-box">
          <span>Level Clear Bonus</span>
          <strong>+${summary.levelClearBonus.toLocaleString()} pts</strong>
        </div>
        <div class="stat-mini-box">
          <span>Flawless Hull Bonus</span>
          <strong>${summary.flawless ? `+${summary.flawlessBonus} pts (No Hits!)` : '0 pts (Hull Hit)'}</strong>
        </div>
      `;
    }

    const nextBtn = document.getElementById('btn-next-level');
    const finishBtn = document.getElementById('btn-finish-quickplay');
    if (summary.hasNextLevel && summary.nextEnv) {
      nextBtn.textContent = `🌊 NEXT: ${summary.nextEnv.shortName.toUpperCase()} (LEVEL ${summary.nextEnv.level}) →`;
      finishBtn.hidden = false;
    } else {
      nextBtn.textContent = '🏆 COMPLETE RUN & VIEW FINAL SCORE →';
      finishBtn.hidden = true;
    }

    overlay.hidden = false;
  }

  updateHUD(hud) {
    const pauseOverlay = document.getElementById('overlay-pause');
    if (pauseOverlay) {
      pauseOverlay.hidden = hud.status !== 'PAUSED';
    }

    const modeLabel = document.getElementById('hud-mode-label');
    if (modeLabel) {
      modeLabel.textContent =
        hud.gameMode === 'CAMPAIGN'
          ? `CAMPAIGN • LEVEL ${hud.env.level}/8`
          : `QUICK PLAY • LEVEL ${hud.env.level}`;
    }

    const envName = document.getElementById('hud-env-name');
    if (envName) {
      envName.textContent = `${hud.env.icon} ${hud.env.name}`;
    }

    const condParts = [];
    if (Math.abs(hud.currentVx) > 5) {
      condParts.push(`🌊 Current ${hud.currentVx > 0 ? '→' : '←'} ${Math.abs(hud.currentVx)}`);
    }
    if (Math.abs(hud.windVx) > 8) {
      condParts.push(`💨 Wind ${hud.windVx > 0 ? '→' : '←'} ${Math.abs(hud.windVx)}`);
    }
    if (hud.rogueWaveState !== 'NONE') {
      condParts.push(`⚠️ ROGUE WAVE!`);
    }
    const condEl = document.getElementById('hud-conditions');
    if (condEl) {
      condEl.textContent = condParts.length ? condParts.join(' • ') : 'Calm Water • Steady Rain';
    }

    const scoreEl = document.getElementById('hud-score');
    if (scoreEl) {
      scoreEl.textContent = hud.score.toLocaleString();
    }

    const comboEl = document.getElementById('hud-combo');
    if (comboEl) {
      comboEl.textContent = `Combo: ${hud.combo}× (${hud.comboMult.toFixed(2)}×Pts)`;
    }

    const progFill = document.getElementById('hud-progress-fill');
    if (progFill) {
      progFill.style.width = `${hud.progressPct}%`;
    }

    const progText = document.getElementById('hud-progress-text');
    if (progText) {
      progText.textContent = `${hud.progressPct}% (${hud.levelFishCaught}/${hud.targetCatches} Fish or ${hud.levelCatchScore}/${hud.targetScore} Pts)`;
    }

    const buffsEl = document.getElementById('hud-buffs');
    if (buffsEl) {
      const activeBuffs = [];
      if (hud.wideNetRemainingSec > 0) activeBuffs.push(`🕸️ Wide Net (${hud.wideNetRemainingSec}s)`);
      if (hud.turboRemainingSec > 0) activeBuffs.push(`☕ Turbo Oars (${hud.turboRemainingSec}s)`);
      buffsEl.textContent = activeBuffs.length ? activeBuffs.join(' • ') : hud.comboLabel;
    }

    const livesEl = document.getElementById('hud-lives');
    if (livesEl) {
      const fullHearts = '❤️'.repeat(Math.max(0, hud.lives));
      const emptyHearts = '🖤'.repeat(Math.max(0, hud.maxLives - hud.lives));
      livesEl.textContent = fullHearts + emptyHearts;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Results / Game Over Screen & Global Score Submission                */
  /* ------------------------------------------------------------------ */

  _bindResultsControls() {
    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this.launchGameRun(this.engine.gameMode, this.engine.startEnvId);
    });

    document.getElementById('btn-results-leaderboard')?.addEventListener('click', () => {
      this.openGlobalLeaderboard();
    });

    document.getElementById('btn-results-menu')?.addEventListener('click', () => {
      this.showScreen('screen-menu');
    });
  }

  async handleGameOver(snapshot) {
    this.lastRunSnapshot = snapshot;
    this.lastSubmissionResult = null;

    const recordUpdate = recordRunFinished({
      finalScore: snapshot.score,
      highestEnvId: snapshot.highestEnvId,
      totalFishCaught: snapshot.breakdown.totalFishCaught,
      legendaryCaught: snapshot.catchesByRarity.LEGENDARY,
      maxCombo: snapshot.maxCombo,
      bestCatchName: snapshot.bestCatch.name,
      bestCatchPoints: snapshot.bestCatch.points
    });

    this.showScreen('screen-results');
    this.renderResultsCards(snapshot, recordUpdate);
    this.renderGlobalSubmitPanel(snapshot);

    // If automatic submission is enabled, automatically submit right away
    if (loadAutoSubmitPreference() && snapshot.score > 0) {
      await this.submitCurrentRunToGlobal({ isAuto: true });
    }
  }

  renderResultsCards(snapshot, recordUpdate) {
    const container = document.getElementById('results-cards-container');
    if (!container) return;

    const b = snapshot.breakdown;
    const isVictory = snapshot.reason === 'VICTORY';
    const headline = isVictory
      ? `🏆 Expedition Complete! Reached ${snapshot.highestEnvName}!`
      : `💥 Hull Sunk in ${snapshot.highestEnvName} (Level ${snapshot.highestLevel})`;

    const achBadges =
      snapshot.achievements.length > 0
        ? snapshot.achievements
            .map((id) => ACHIEVEMENTS[id])
            .filter(Boolean)
            .map((a) => `${a.icon} ${a.title} (+${a.bonus})`)
            .join(' • ')
        : 'None this run';

    container.innerHTML = `
      <div class="results-grid">
        <div class="result-card">
          <span class="overlay-badge ${isVictory ? 'badge-success' : ''}">${isVictory ? 'EXPEDITION COMPLETE' : 'GAME OVER'}</span>
          <h2>${headline}</h2>
          <div class="final-score-banner">${snapshot.score.toLocaleString()} PTS</div>
          ${recordUpdate.isNewOverallBest ? '<p style="color:#4ade80;font-weight:800;margin:0 0 10px;">🌟 NEW PERSONAL BEST SCORE!</p>' : ''}
          <ul class="breakdown-list">
            <li><span>Fish &amp; Bonus Catch Points</span><strong>+${b.catchScore.toLocaleString()}</strong></li>
            <li><span>Bodies of Water Cleared (${snapshot.levelsCleared})</span><strong>+${b.levelBonusTotal.toLocaleString()}</strong></li>
            <li><span>Flawless Hull Bonuses (${snapshot.flawlessLevels})</span><strong>+${b.flawlessBonusTotal.toLocaleString()}</strong></li>
            <li><span>Best Combo Bonus (${snapshot.maxCombo}× Streak)</span><strong>+${b.comboMilestoneBonus.toLocaleString()}</strong></li>
            <li><span>Achievement Bonuses</span><strong>+${b.achievementBonusTotal.toLocaleString()}</strong></li>
          </ul>
        </div>

        <div class="result-card">
          <h3>🎣 Catch Log &amp; Run Statistics</h3>
          <ul class="breakdown-list">
            <li><span>Highest Body of Water</span><strong>Level ${snapshot.highestLevel}: ${snapshot.highestEnvName}</strong></li>
            <li><span>Total Fish Caught</span><strong>${b.totalFishCaught} Fish</strong></li>
            <li>
              <span>Rarity Breakdown</span>
              <strong>
                ${snapshot.catchesByRarity.COMMON} C /
                ${snapshot.catchesByRarity.UNCOMMON} U /
                ${snapshot.catchesByRarity.RARE} R /
                ${snapshot.catchesByRarity.LEGENDARY} L
              </strong>
            </li>
            <li><span>Best Single Catch</span><strong>${snapshot.bestCatch.name} (${snapshot.bestCatch.points.toLocaleString()} pts)</strong></li>
            <li><span>Harmless Junk Collected</span><strong>${snapshot.catchesByRarity.NEUTRAL} Items (0 pts)</strong></li>
            <li><span>Falling Hazards Hit</span><strong>${snapshot.hazardsHit} Hits</strong></li>
            <li><span>Achievements Earned</span><strong>${achBadges}</strong></li>
          </ul>
        </div>
      </div>
    `;

    const strip = document.getElementById('results-records-strip');
    if (strip) {
      const rec = recordUpdate.records.overall;
      strip.textContent = `Local Career Best: ${rec.bestScore.toLocaleString()} pts • Highest Water: Level ${rec.highestLevel} • Total Career Fish: ${rec.totalFishCaught.toLocaleString()} • Longest Combo: ${rec.longestCombo}×`;
    }
  }

  renderGlobalSubmitPanel(snapshot) {
    const panel = document.getElementById('global-submit-panel');
    if (!panel) return;

    const savedNick = loadSavedNickname() || generateDefaultNickname();
    const autoEnabled = loadAutoSubmitPreference();

    if (this.lastSubmissionResult && this.lastSubmissionResult.ok) {
      const { entry, ranks } = this.lastSubmissionResult.data;
      panel.innerHTML = '';
      const title = document.createElement('h3');
      title.style.margin = '0 0 6px';
      title.style.color = '#4ade80';
      title.textContent = `✅ Score Submitted to Global Leaderboard!`;

      const summary = document.createElement('p');
      summary.style.margin = '0 0 10px';
      summary.textContent = `Skipper "${entry.nickname}" ranked #${ranks.global} Overall Global (#${ranks.env} in ${snapshot.highestEnvName}) with ${entry.score.toLocaleString()} pts!`;

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-primary btn-sm';
      viewBtn.textContent = '🌍 View Your Rank on Global Leaderboard';
      viewBtn.addEventListener('click', () => {
        this.globalState.highlightNickname = entry.nickname;
        this.openGlobalLeaderboard();
      });

      panel.append(title, summary, viewBtn);
      return;
    }

    panel.innerHTML = `
      <h3 style="margin:0 0 8px;color:#38bdf8;">🌍 Submit Run to Global Leaderboard</h3>
      <div class="nickname-field-row" style="margin-bottom:10px;">
        <label for="input-results-nickname" class="pref-field-label">Skipper Nickname:</label>
        <div class="nickname-input-wrap">
          <input
            type="text"
            id="input-results-nickname"
            class="pref-nickname-input"
            maxlength="16"
            value=""
            placeholder="Enter nickname"
          />
          <button type="button" id="btn-results-random-nick" class="btn-tool btn-sm">🎲 Random</button>
          <button type="button" id="btn-submit-score-now" class="btn-primary btn-sm">
            🚀 Submit Score (${snapshot.score.toLocaleString()} pts)
          </button>
        </div>
      </div>
      <label class="pref-toggle-label" for="toggle-auto-submit-results">
        <input type="checkbox" id="toggle-auto-submit-results" class="pref-checkbox" ${autoEnabled ? 'checked' : ''} />
        <span class="pref-toggle-text">Automatically submit future scores to global leaderboard</span>
      </label>
      <p id="results-submit-feedback" class="pref-feedback-msg" role="alert" hidden></p>
    `;

    const nickInput = document.getElementById('input-results-nickname');
    if (nickInput) {
      nickInput.value = savedNick;
      nickInput.addEventListener('input', () => {
        const res = validateNickname(nickInput.value);
        const fb = document.getElementById('results-submit-feedback');
        if (res.ok) {
          saveNickname(res.value);
          if (fb) fb.hidden = true;
          this.syncNicknameInputs(nickInput);
        } else if (fb) {
          fb.textContent = res.message;
          fb.hidden = false;
        }
      });
    }

    document.getElementById('btn-results-random-nick')?.addEventListener('click', () => {
      const generated = generateDefaultNickname();
      saveNickname(generated);
      this.syncAutoSubmitAndNicknameUI();
    });

    document.getElementById('toggle-auto-submit-results')?.addEventListener('change', (e) => {
      // If user typed into nickInput, save that nickname first so syncAutoSubmitAndNicknameUI doesn't revert it
      if (nickInput) {
        const res = validateNickname(nickInput.value);
        if (res.ok) {
          saveNickname(res.value);
        }
      }
      saveAutoSubmitPreference(e.target.checked);
      this.syncAutoSubmitAndNicknameUI();
    });

    document.getElementById('btn-submit-score-now')?.addEventListener('click', () => {
      this.submitCurrentRunToGlobal({ isAuto: false });
    });
  }

  async submitCurrentRunToGlobal({ isAuto = false } = {}) {
    if (!this.lastRunSnapshot || this.submittingScore) return;
    if (this.lastSubmissionResult?.ok) return;

    const nickInput = document.getElementById('input-results-nickname');
    const candidateNick = nickInput ? nickInput.value : loadSavedNickname();
    const valid = validateNickname(candidateNick);
    const fbEl = document.getElementById('results-submit-feedback');

    if (!valid.ok) {
      if (fbEl) {
        fbEl.textContent = valid.message;
        fbEl.hidden = false;
      }
      return;
    }

    saveNickname(valid.value);
    this.syncNicknameInputs();

    if (!this.lastRunSnapshot.token) {
      // Attempt to issue a token if offline at start; note server requires wall-clock >= 2s
      if (fbEl) {
        fbEl.textContent = isAuto
          ? 'Global leaderboard was unreachable when this run began. Score saved to Local Records.'
          : 'No active server session token for this run (server may be offline). Score is saved in Local Records.';
        fbEl.hidden = false;
      }
      return;
    }

    this.submittingScore = true;
    const submitBtn = document.getElementById('btn-submit-score-now');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    const s = this.lastRunSnapshot;
    const payload = {
      token: s.token,
      nickname: valid.value,
      gameMode: s.gameMode,
      startEnvId: s.startEnvId,
      highestEnvId: s.highestEnvId,
      levelsCleared: s.levelsCleared,
      flawlessLevels: s.flawlessLevels,
      catchesByRarity: s.catchesByRarity,
      hazardsHit: s.hazardsHit,
      maxCombo: s.maxCombo,
      catchScore: s.catchScore,
      achievements: s.achievements,
      bestCatchName: s.bestCatch.name,
      elapsedSeconds: s.elapsedSeconds,
      score: s.score
    };

    const res = await submitScore(payload);
    this.submittingScore = false;
    this.lastSubmissionResult = res;

    if (res.ok) {
      this.globalState.highlightNickname = valid.value;
      this.renderGlobalSubmitPanel(this.lastRunSnapshot);
    } else {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = `🚀 Submit Score (${s.score.toLocaleString()} pts)`;
      }
      if (fbEl) {
        fbEl.textContent = res.message || 'Could not submit score to global leaderboard.';
        fbEl.hidden = false;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Local Records & Global Leaderboard Modals                           */
  /* ------------------------------------------------------------------ */

  renderLocalRecordsModal() {
    const container = document.getElementById('records-modal-content');
    if (!container) return;

    const records = loadRecords();
    const o = records.overall;

    let envRowsHtml = '';
    for (const envId of ENVIRONMENT_ORDER) {
      const env = ENVIRONMENTS[envId];
      const st = records.byEnv[envId] || { bestScore: 0, timesCleared: 0, bestCombo: 0, flawlessClears: 0 };
      const unlocked = env.level <= records.unlockedLevel;
      envRowsHtml += `
        <tr>
          <td>Level ${env.level}: ${env.icon} ${env.name}</td>
          <td>${unlocked ? '🔓 Unlocked' : '🔒 Locked'}</td>
          <td><strong>${st.bestScore.toLocaleString()}</strong></td>
          <td>${st.timesCleared}</td>
          <td>${st.flawlessClears}</td>
          <td>${st.bestCombo}×</td>
        </tr>
      `;
    }

    container.innerHTML = `
      <div class="overlay-stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));">
        <div class="stat-mini-box">
          <span>Personal Best Score</span>
          <strong>${o.bestScore.toLocaleString()} pts</strong>
        </div>
        <div class="stat-mini-box">
          <span>Highest Water Reached</span>
          <strong>Level ${o.highestLevel} (${ENVIRONMENTS[ENVIRONMENT_ORDER[o.highestLevel - 1]]?.shortName || 'Puddle'})</strong>
        </div>
        <div class="stat-mini-box">
          <span>Total Fish Caught</span>
          <strong>${o.totalFishCaught.toLocaleString()} (${o.legendaryCaught} Legendary)</strong>
        </div>
        <div class="stat-mini-box">
          <span>Longest Combo / Best Catch</span>
          <strong>${o.longestCombo}× • ${o.bestCatchName}</strong>
        </div>
      </div>

      <h3 style="margin:14px 0 8px;color:#38bdf8;">Records by Body of Water</h3>
      <div class="global-table-wrap">
        <table class="records-table">
          <thead>
            <tr>
              <th>Body of Water</th>
              <th>Status</th>
              <th>Best Score</th>
              <th>Clears</th>
              <th>Flawless</th>
              <th>Best Combo</th>
            </tr>
          </thead>
          <tbody>${envRowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  populateGlobalFilterSelects() {
    const envSelect = document.getElementById('global-filter-env');
    if (!envSelect) return;
    envSelect.innerHTML = '<option value="all">All Bodies of Water</option>';
    for (const envId of ENVIRONMENT_ORDER) {
      const env = ENVIRONMENTS[envId];
      const opt = document.createElement('option');
      opt.value = env.id;
      opt.textContent = `Level ${env.level}: ${env.icon} ${env.shortName}`;
      envSelect.appendChild(opt);
    }
  }

  _bindGlobalLeaderboardModal() {
    const envSelect = document.getElementById('global-filter-env');
    const modeSelect = document.getElementById('global-filter-mode');
    const sortSelect = document.getElementById('global-filter-sort');

    const onFilterChange = () => {
      this.globalState.env = envSelect?.value || 'all';
      this.globalState.mode = modeSelect?.value || 'all';
      this.globalState.sort = sortSelect?.value || 'score';
      this.globalState.offset = 0;
      this.refreshGlobalLeaderboard();
    };

    envSelect?.addEventListener('change', onFilterChange);
    modeSelect?.addEventListener('change', onFilterChange);
    sortSelect?.addEventListener('change', onFilterChange);

    document.getElementById('global-prev')?.addEventListener('click', () => {
      if (this.globalState.offset >= this.globalState.limit) {
        this.globalState.offset -= this.globalState.limit;
        this.refreshGlobalLeaderboard();
      }
    });

    document.getElementById('global-next')?.addEventListener('click', () => {
      if (this.globalState.offset + this.globalState.limit < this.globalState.total) {
        this.globalState.offset += this.globalState.limit;
        this.refreshGlobalLeaderboard();
      }
    });
  }

  async openGlobalLeaderboard() {
    this.syncAutoSubmitAndNicknameUI();
    this.openModal('modal-global');
    await this.refreshGlobalLeaderboard();
  }

  async refreshGlobalLeaderboard() {
    const statusEl = document.getElementById('global-status');
    const tbody = document.getElementById('global-table-body');
    const pageInfo = document.getElementById('global-page-info');
    const prevBtn = document.getElementById('global-prev');
    const nextBtn = document.getElementById('global-next');

    if (statusEl) statusEl.textContent = 'Loading global rankings...';
    if (tbody) tbody.innerHTML = '';

    const res = await fetchLeaderboard({
      env: this.globalState.env,
      mode: this.globalState.mode,
      sort: this.globalState.sort,
      limit: this.globalState.limit,
      offset: this.globalState.offset
    });

    if (!res.ok) {
      if (statusEl) {
        statusEl.textContent = res.message || 'Global leaderboard is offline.';
      }
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    const { entries, total } = res.data;
    this.globalState.total = total || 0;

    if (statusEl) {
      statusEl.textContent =
        total === 0
          ? 'No global scores recorded for this filter yet. Be the first skipper on the board!'
          : `Showing ${entries.length} of ${total} global runs`;
    }

    const currentNick = (this.globalState.highlightNickname || loadSavedNickname() || '').toLowerCase();

    if (tbody) {
      for (const row of entries) {
        const tr = document.createElement('tr');
        if (currentNick && String(row.nickname).toLowerCase() === currentNick) {
          tr.className = 'is-player-row';
        }

        const envMeta = ENVIRONMENTS[row.highestEnvId] || ENVIRONMENTS.PUDDLE;
        const dateStr = row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—';

        const tdRank = document.createElement('td');
        tdRank.textContent = `#${row.rank}`;

        const tdNick = document.createElement('td');
        const strongNick = document.createElement('strong');
        strongNick.textContent = row.nickname;
        tdNick.appendChild(strongNick);
        if (currentNick && String(row.nickname).toLowerCase() === currentNick) {
          const youBadge = document.createElement('span');
          youBadge.textContent = ' (You)';
          youBadge.style.color = '#facc15';
          youBadge.style.fontWeight = '800';
          tdNick.appendChild(youBadge);
        }

        const tdScore = document.createElement('td');
        tdScore.style.fontWeight = '800';
        tdScore.style.color = '#facc15';
        tdScore.textContent = Number(row.score).toLocaleString();

        const tdWater = document.createElement('td');
        tdWater.textContent = `Lv.${row.highestLevel} ${envMeta.icon} ${envMeta.shortName}`;

        const tdFish = document.createElement('td');
        tdFish.textContent = `${row.fishCaught} (${row.maxCombo}×)`;

        const tdBest = document.createElement('td');
        tdBest.textContent = row.bestCatchName || '—';

        const tdDate = document.createElement('td');
        tdDate.textContent = dateStr;

        tr.append(tdRank, tdNick, tdScore, tdWater, tdFish, tdBest, tdDate);
        tbody.appendChild(tr);
      }
    }

    const currentPage = Math.floor(this.globalState.offset / this.globalState.limit) + 1;
    const totalPages = Math.max(1, Math.ceil(this.globalState.total / this.globalState.limit));
    if (pageInfo) {
      pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    }
    if (prevBtn) prevBtn.disabled = this.globalState.offset <= 0;
    if (nextBtn) nextBtn.disabled = this.globalState.offset + this.globalState.limit >= this.globalState.total;
  }
}
