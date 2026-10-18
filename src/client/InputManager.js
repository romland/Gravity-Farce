const DEFAULT_INPUT_CONFIG = {
    keyboard: {
        up: ['ShiftLeft', 'ShiftRight', 'Shift', 'KeyS', 'Numpad5'],
        left: ['ArrowLeft', 'KeyA', 'Numpad4'],
        right: ['ArrowRight', 'KeyD', 'Numpad6'],
        shoot: ['Enter', 'Numpad8', 'ArrowUp', 'KeyW', 'Space', 'Return']
    },
    camera: {
        up: ['ArrowUp'],
        down: ['ArrowDown'],
        left: ['ArrowLeft'],
        right: ['ArrowRight']
    },
    system: {
        escape: ['Escape'],
        restartCavern: ['Slash', 'NumpadDivide', 'Backslash'],
        watchReplay: ['KeyX'],
        pause: ['KeyP'],
        toggleDebugLines: ['KeyV'],
        toggleFreecam: ['KeyC'],
        powerup2x: ['KeyU'],
        powerup3x: ['KeyI'],
        powerupRear: ['KeyO'],
        spawnBot: ['KeyB'],
        dumpBots: ['KeyN'],
        jumpLevel: ['KeyL', 'KeyJ'],
        addLife: ['KeyM']
    },
    gamepad: {
        up: [1, 2, 3],    // Face buttons B/X/Y
        left: [14],       // D-pad left
        right: [15],      // D-pad right
        shoot: [12, 0]    // D-pad up, A button
    },
    analog: {
        turnAxis: 0,
        turnDeadzone: 0.15,
        shootAxis: 1,
        shootThreshold: -0.5, // Push stick up to shoot
        thrustButton: 7 // Right Trigger (RT)
    }
};

class InputManager {
    constructor(config, onInputChanged, onAction) {
        this.config = config || DEFAULT_INPUT_CONFIG;
        this.onInputChanged = onInputChanged;
        this.onAction = onAction;
        
        this.state = {
            kb: { up: false, left: false, right: false, shoot: false },
            touch: { up: false, left: false, right: false, shoot: false },
            pad: { up: false, left: false, right: false, shoot: false, analogX: 0, analogUp: 0 },
            cam: { up: false, down: false, left: false, right: false }
        };
        
        this.merged = { up: false, left: false, right: false, shoot: false, analogX: 0, analogUp: 0 };
        
        this.bindKeyboard();
        this.bindTouchControls();
    }

    bindKeyboard() {
        window.addEventListener('keydown', e => this.handleKey(e, true));
        window.addEventListener('keyup', e => this.handleKey(e, false));
    }

    handleKey(e, isPressed) {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'INPUT') {
            if (isPressed && !e.repeat) {
                if (this.config.system?.escape?.includes(e.code)) {
                    activeEl.blur();
                    if (this.onAction) this.onAction('escape');
                } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
                    if (this.onAction) this.onAction('inputEnter', activeEl.id);
                }
            }
            return;
        }
        let changed = false;
        
        if (isPressed && !e.repeat && this.config.system) {
            for (const [action, keys] of Object.entries(this.config.system)) {
                if (keys.includes(e.code)) {
                    e.preventDefault();
                    if (this.onAction) this.onAction(action);
                    return; // System keys absorb the input
                }
            }
        }
        
        if (this.config.keyboard) {
            for (const [action, keys] of Object.entries(this.config.keyboard)) {
                if (keys.includes(e.code)) {
                    this.state.kb[action] = isPressed;
                    changed = true;
                }
            }
        }
        
        if (this.config.camera) {
            for (const [action, keys] of Object.entries(this.config.camera)) {
                if (keys.includes(e.code)) {
                    this.state.cam[action] = isPressed;
                }
            }
        }
        
        if (changed) this.emit();
    }

    bindTouchControls() {
        const bind = (id, action) => {
            const el = document.getElementById(id);
            if (!el) return;
            const setTouch = (e, val) => {
                e.preventDefault();
                this.state.touch[action] = val;
                this.emit();
            };
            el.addEventListener('touchstart', e => setTouch(e, true), { passive: false });
            el.addEventListener('touchend', e => setTouch(e, false), { passive: false });
            el.addEventListener('touchcancel', e => setTouch(e, false), { passive: false });
        };

        bind('btn-left', 'left');
        bind('btn-right', 'right');
        bind('btn-thrust', 'up');
        bind('btn-fire', 'shoot');
    }

    updateGamepad() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const padConfig = this.config.gamepad;
        const analogConfig = this.config.analog;

        let nextPad = { up: false, left: false, right: false, shoot: false, analogX: 0, analogUp: 0 };

        for (const gp of gamepads) {
            if (!gp) continue;

            nextPad.up = nextPad.up || this.checkButtons(gp, padConfig.up);
            nextPad.left = nextPad.left || this.checkButtons(gp, padConfig.left);
            nextPad.right = nextPad.right || this.checkButtons(gp, padConfig.right);
            nextPad.shoot = nextPad.shoot || this.checkButtons(gp, padConfig.shoot);

            if (gp.axes[analogConfig.shootAxis] < analogConfig.shootThreshold) {
                nextPad.shoot = true;
            }

            const rawX = gp.axes[analogConfig.turnAxis];
            if (Math.abs(rawX) > analogConfig.turnDeadzone) {
                nextPad.analogX = rawX;
                if (rawX < -analogConfig.turnDeadzone) nextPad.left = true;
                if (rawX > analogConfig.turnDeadzone) nextPad.right = true;
            }
            
            const rawThrust = gp.buttons[analogConfig.thrustButton]?.value || 0;
            if (rawThrust > 0.05) {
                nextPad.analogUp = rawThrust;
                nextPad.up = true; // Digital fallback for when server analog is disabled
            }
        }

        if (this.hasPadStateChanged(nextPad)) {
            this.state.pad = nextPad;
            this.emit();
        }
    }

    checkButtons(gp, indices) {
        return indices.some(idx => gp.buttons[idx] && gp.buttons[idx].pressed);
    }

    hasPadStateChanged(next) {
        return next.up !== this.state.pad.up || 
               next.left !== this.state.pad.left || 
               next.right !== this.state.pad.right || 
               next.shoot !== this.state.pad.shoot || 
               Math.abs(next.analogX - this.state.pad.analogX) > 0.05 ||
               Math.abs(next.analogUp - this.state.pad.analogUp) > 0.05;
    }

    emit() {
        const next = {
            up: this.state.kb.up || this.state.touch.up || this.state.pad.up,
            left: this.state.kb.left || this.state.touch.left || this.state.pad.left,
            right: this.state.kb.right || this.state.touch.right || this.state.pad.right,
            shoot: this.state.kb.shoot || this.state.touch.shoot || this.state.pad.shoot,
            analogX: this.state.pad.analogX || 0,
            analogUp: this.state.pad.analogUp || 0
        };

        if (this.hasMergedStateChanged(next)) {
            this.merged = next;
            if (this.onInputChanged) this.onInputChanged(this.merged);
        }
    }

    hasMergedStateChanged(next) {
        return next.up !== this.merged.up || 
               next.left !== this.merged.left || 
               next.right !== this.merged.right || 
               next.shoot !== this.merged.shoot || 
               next.analogX !== this.merged.analogX ||
               next.analogUp !== this.merged.analogUp;
    }

    vibrate(duration, weakMag = 1.0, strongMag = 1.0) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
            if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
                gp.vibrationActuator.playEffect('dual-rumble', {
                    startDelay: 0, duration, weakMagnitude: weakMag, strongMagnitude: strongMag
                }).catch(() => {});
            }
        }
    }

    forceReset() {
        this.state.kb = { up: false, left: false, right: false, shoot: false };
        this.state.touch = { up: false, left: false, right: false, shoot: false };
        this.state.pad = { up: false, left: false, right: false, shoot: false, analogX: 0, analogUp: 0 };
        this.emit();
    }
}
