/**
 * Fish Rain — Unified Input Controller
 * Supports:
 * 1. Keyboard (ArrowLeft/ArrowRight, A/D) — always available
 * 2. On-Screen Touch/Hold Buttons (Left / Right)
 * 3. Mouse / Pointer Follow (smooth horizontal tracking)
 * 4. Optional Mobile Tilt Mode (DeviceOrientation API with calibration, sensitivity, and graceful fallback)
 */

import { GAME_CONSTANTS, CONTROL_MODES } from './config.js';

export class InputController {
  constructor({ onPauseToggle, onControlModeChange } = {}) {
    this.controlMode = 'HYBRID'; // 'HYBRID' | 'MOUSE_FOLLOW' | 'TILT'
    this.tiltSensitivity = 1.2;
    this.onPauseToggle = onPauseToggle || (() => {});
    this.onControlModeChange = onControlModeChange || (() => {});

    // Keyboard & button states
    this.keysDown = new Set();
    this.buttonLeftHeld = false;
    this.buttonRightHeld = false;

    // Mouse / Pointer follow state (Persistent Target Tracking)
    this.mouseTargetX = null;
    this.mouseSteeringActive = false;
    this.lastPointerLogicalX = null;
    this.arrivalRadius = GAME_CONSTANTS.MOUSE_ARRIVAL_RADIUS || 24;
    this.canvasElement = null;

    // Mobile Tilt (DeviceOrientation) state
    this.tiltSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    this.tiltPermissionState = 'prompt'; // 'prompt' | 'granted' | 'denied' | 'unsupported'
    this.tiltListening = false;
    this.tiltHasReceivedReading = false;
    this.rawTiltAngle = 0;
    this.calibratedZeroAngle = 0;
    this.smoothedTiltInput = 0; // -1.0 to +1.0

    this._boundKeyDown = (e) => this._handleKeyDown(e);
    this._boundKeyUp = (e) => this._handleKeyUp(e);
    this._boundBlur = () => this.resetActiveInputs();
    this._boundDeviceOrientation = (e) => this._handleDeviceOrientation(e);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._boundKeyDown);
      window.addEventListener('keyup', this._boundKeyUp);
      window.addEventListener('blur', this._boundBlur);
    }
  }

  setControlMode(mode) {
    if (!CONTROL_MODES[mode]) return this.controlMode;
    this.controlMode = mode;
    this.mouseTargetX = null;
    this.mouseSteeringActive = false;
    this.lastPointerLogicalX = null;
    this.smoothedTiltInput = 0;
    this.onControlModeChange(this.controlMode);
    return this.controlMode;
  }

  setTiltSensitivity(sens) {
    const n = Number(sens);
    if (Number.isFinite(n)) {
      this.tiltSensitivity = Math.max(0.5, Math.min(2.5, n));
    }
    return this.tiltSensitivity;
  }

  resetActiveInputs() {
    this.keysDown.clear();
    this.buttonLeftHeld = false;
    this.buttonRightHeld = false;
    this.mouseTargetX = null;
    this.mouseSteeringActive = false;
    this.lastPointerLogicalX = null;
    this.smoothedTiltInput = 0;
  }

  /**
   * Attaches pointer listeners to the game canvas for Mouse Follow and direct touch drag.
   * Tracks intentional movement to set persistent horizontal targets.
   */
  attachCanvas(canvas) {
    this.canvasElement = canvas;
    if (!canvas) return;

    const MIN_POINTER_MOVE_PX = 3; // Minimum movement threshold to ignore sensor/micro-jitter

    const handlePointerAction = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      // Convert clientX to logical canvas X, clamping between 0 and LOGICAL_WIDTH
      const ratio = (clientX - rect.left) / rect.width;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const logicalX = clampedRatio * GAME_CONSTANTS.LOGICAL_WIDTH;

      if (this.lastPointerLogicalX !== null) {
        const delta = Math.abs(logicalX - this.lastPointerLogicalX);
        if (delta < MIN_POINTER_MOVE_PX) {
          return; // Ignore sub-threshold micro jitter
        }
      }

      this.lastPointerLogicalX = logicalX;
      this.mouseTargetX = logicalX;
      this.mouseSteeringActive = true;
    };

    canvas.addEventListener('pointermove', (e) => {
      if (this.controlMode === 'MOUSE_FOLLOW' || e.buttons > 0 || e.pointerType === 'touch') {
        handlePointerAction(e.clientX);
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      handlePointerAction(e.clientX);
    });

    // Note: When pointer leaves canvas/window, we intentionally retain the established target!
    // The boat continues moving toward mouseTargetX until it reaches it.
  }

  /**
   * Attaches holdable Left and Right on-screen buttons.
   */
  attachTouchButtons(btnLeft, btnRight) {
    const bindHoldButton = (btn, setFlag) => {
      if (!btn) return;
      const start = (e) => {
        if (e.cancelable) e.preventDefault();
        setFlag(true);
        btn.classList.add('is-held');
      };
      const end = (e) => {
        if (e && e.cancelable) e.preventDefault();
        setFlag(false);
        btn.classList.remove('is-held');
      };

      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
      btn.addEventListener('pointerleave', end);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };

    bindHoldButton(btnLeft, (v) => {
      this.buttonLeftHeld = v;
    });
    bindHoldButton(btnRight, (v) => {
      this.buttonRightHeld = v;
    });
  }

  /**
   * Requests DeviceOrientation permission ONLY following an explicit user gesture.
   * Gracefully detects unsupported browsers or denied permissions.
   */
  async enableTiltMode() {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      this.tiltSupported = false;
      this.tiltPermissionState = 'unsupported';
      return {
        ok: false,
        state: 'unsupported',
        message: 'Device orientation sensors are not supported on this browser or device.'
      };
    }

    try {
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const response = await window.DeviceOrientationEvent.requestPermission();
        if (response !== 'granted') {
          this.tiltPermissionState = 'denied';
          return {
            ok: false,
            state: 'denied',
            message: 'Motion sensor permission was denied. Using On-Screen Buttons & Keyboard instead.'
          };
        }
      }

      this.tiltPermissionState = 'granted';
      if (!this.tiltListening) {
        window.addEventListener('deviceorientation', this._boundDeviceOrientation, true);
        this.tiltListening = true;
      }
      this.setControlMode('TILT');
      return {
        ok: true,
        state: 'granted',
        message: 'Tilt Mode active! Tilt your device left or right to steer. Tap Calibrate to set neutral.'
      };
    } catch (err) {
      this.tiltPermissionState = 'denied';
      return {
        ok: false,
        state: 'denied',
        message: `Could not activate tilt sensor (${err?.message || 'permission blocked'}). Using Buttons instead.`
      };
    }
  }

  /**
   * Calibrates the current physical tilt angle as neutral (0°).
   */
  calibrateTilt() {
    this.calibratedZeroAngle = this.rawTiltAngle;
    this.smoothedTiltInput = 0;
    return this.calibratedZeroAngle;
  }

  /**
   * Injects a synthetic tilt reading (used for automated testing and sensor simulation).
   */
  simulateTiltAngle(gammaDegrees) {
    this.tiltSupported = true;
    this.tiltPermissionState = 'granted';
    this.tiltHasReceivedReading = true;
    this.rawTiltAngle = Number(gammaDegrees) || 0;
  }

  _handleDeviceOrientation(event) {
    if (!event || (event.gamma === null && event.beta === null)) return;
    this.tiltHasReceivedReading = true;

    // Determine primary horizontal tilt axis based on screen orientation
    let angle = Number(event.gamma) || 0;
    if (typeof window !== 'undefined' && window.screen?.orientation?.angle) {
      const orientAngle = window.screen.orientation.angle;
      if (orientAngle === 90) {
        angle = Number(event.beta) || 0;
      } else if (orientAngle === 270 || orientAngle === -90) {
        angle = -(Number(event.beta) || 0);
      }
    }
    // Clamp raw tilt to [-65, +65] degrees to avoid gimbal flip at 90 deg
    this.rawTiltAngle = Math.max(-65, Math.min(65, angle));
  }

  _handleKeyDown(e) {
    // Ignore keyboard shortcuts when typing into an input field (e.g. nickname input)
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
      return;
    }

    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      this.keysDown.add('LEFT');
      e.preventDefault();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      this.keysDown.add('RIGHT');
      e.preventDefault();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      this.onPauseToggle();
    }
  }

  _handleKeyUp(e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      this.keysDown.delete('LEFT');
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      this.keysDown.delete('RIGHT');
    }
  }

  /**
   * Sets or updates the mouse follow target directly (used by pointer events and tests).
   */
  setMouseTarget(logicalX) {
    const clamped = Math.max(0, Math.min(GAME_CONSTANTS.LOGICAL_WIDTH, Number(logicalX) || 0));
    this.mouseTargetX = clamped;
    this.lastPointerLogicalX = clamped;
    this.mouseSteeringActive = true;
  }

  /**
   * Computes the horizontal steering velocity command in [-1, +1] or targetX follow delta
   * for the current frame. Keyboard and On-Screen Buttons ALWAYS remain responsive as overrides!
   */
  getSteeringCommand(boatX, minX, maxX) {
    // 1. Check explicit Keyboard or On-Screen Button presses first (always available!)
    const leftPressed = this.keysDown.has('LEFT') || this.buttonLeftHeld;
    const rightPressed = this.keysDown.has('RIGHT') || this.buttonRightHeld;

    if (leftPressed && !rightPressed) {
      this.mouseSteeringActive = false; // Player explicitly took manual control
      return { axis: -1, source: 'DIGITAL' };
    }
    if (rightPressed && !leftPressed) {
      this.mouseSteeringActive = false; // Player explicitly took manual control
      return { axis: 1, source: 'DIGITAL' };
    }

    // 2. Check Mouse Follow mode (Persistent Target Tracking)
    if (this.controlMode === 'MOUSE_FOLLOW' && this.mouseSteeringActive && this.mouseTargetX !== null) {
      // Clamp target to playable boundaries
      const clampedTarget = Math.max(minX, Math.min(maxX, this.mouseTargetX));
      const diff = clampedTarget - boatX;
      const arrivalRadius = this.arrivalRadius;

      // Target Zone / Arrival Radius Check:
      // Once the boat enters the arrival zone around the target coordinate, immediately deactivate steering!
      if (Math.abs(diff) <= arrivalRadius) {
        this.mouseSteeringActive = false; // Arrival condition fulfilled. Deactivates steering permanently until new input.
        return { axis: 0, source: 'MOUSE_FOLLOW_REACHED', targetX: clampedTarget };
      }

      // Smooth steering toward destination outside the arrival zone.
      // We ensure a decisive minimum directional effort (MOUSE_MIN_STEERING_AXIS) so opposing currents
      // or winds cannot stall the boat right before entering the arrival radius.
      const sign = Math.sign(diff);
      const minEffort = GAME_CONSTANTS.MOUSE_MIN_STEERING_AXIS || 0.35;
      const approachProportional = Math.min(1, Math.abs(diff) / 75);
      const axisMagnitude = minEffort + (1 - minEffort) * approachProportional;
      const axis = sign * axisMagnitude;

      return { axis, source: 'MOUSE_FOLLOW', targetX: clampedTarget };
    }

    // 3. Check Mobile Tilt mode
    if (this.controlMode === 'TILT' && this.tiltHasReceivedReading) {
      const deltaDeg = this.rawTiltAngle - this.calibratedZeroAngle;
      const deadzoneDeg = 2.5;

      if (Math.abs(deltaDeg) <= deadzoneDeg) {
        // In neutral position: steering is inactive so currents/wind/waves move boat freely
        this.smoothedTiltInput = 0;
        return { axis: 0, source: 'TILT_NEUTRAL', tiltDegrees: deltaDeg };
      }

      const effectiveDeg = deltaDeg - Math.sign(deltaDeg) * deadzoneDeg;
      // Full speed at ~18 degrees beyond deadzone (scaled by sensitivity)
      const targetAxis = Math.max(-1, Math.min(1, (effectiveDeg / 18) * this.tiltSensitivity));
      this.smoothedTiltInput = this.smoothedTiltInput * 0.7 + targetAxis * 0.3;
      return { axis: this.smoothedTiltInput, source: 'TILT', tiltDegrees: deltaDeg };
    }

    return { axis: 0, source: 'IDLE' };
  }

  getTiltStatus() {
    const deltaDeg = this.rawTiltAngle - this.calibratedZeroAngle;
    return {
      supported: this.tiltSupported,
      permissionState: this.tiltPermissionState,
      hasReading: this.tiltHasReceivedReading,
      rawAngle: Math.round(this.rawTiltAngle * 10) / 10,
      calibratedZero: Math.round(this.calibratedZeroAngle * 10) / 10,
      relativeAngle: Math.round(deltaDeg * 10) / 10,
      sensitivity: this.tiltSensitivity
    };
  }
}
