/**
 * Fish Rain — Application Bootstrap
 */

import { InputController } from './input.js';
import { FishRainEngine } from './engine.js';
import { FishRainUI } from './ui.js';

function bootstrap() {
  const canvas = document.getElementById('game-canvas');
  let ui = null;

  const input = new InputController({
    onPauseToggle: () => {
      if (engine.status === 'PLAYING' || engine.status === 'PAUSED') {
        engine.togglePause();
      }
    },
    onControlModeChange: () => {
      if (ui) ui.syncControlPreferenceUI();
    }
  });

  const engine = new FishRainEngine({
    canvas,
    input,
    onStateChange: (hud) => {
      if (ui) ui.updateHUD(hud);
    },
    onLevelIntro: (env) => {
      if (ui) ui.handleLevelIntro(env);
    },
    onLevelComplete: (summary) => {
      if (ui) ui.handleLevelComplete(summary);
    },
    onGameOver: (snapshot) => {
      if (ui) ui.handleGameOver(snapshot);
    }
  });

  ui = new FishRainUI({ engine, input });
  ui.init();

  if (typeof window !== 'undefined') {
    window.fishRainApp = { engine, input, ui };
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}
