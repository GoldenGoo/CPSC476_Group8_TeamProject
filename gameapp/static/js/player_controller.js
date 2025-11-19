// PlayerController: handles keyboard input and applies control forces to active piece
(function(window, Matter){
    const { Body } = Matter;

    class PlayerController {
        constructor(keymap) {
            this.keymap = keymap || {};
            this._keyState = { left: false, right: false, down: false, rotCCW: false, rotCW: false };
            this.lastMoveTs = 0;
            this._onKeyDown = this._onKeyDown.bind(this);
            this._onKeyUp = this._onKeyUp.bind(this);
            this._clearKeyState = this._clearKeyState.bind(this);
            this._bindInput();
        }

        _bindInput() {
            window.addEventListener('keydown', this._onKeyDown);
            window.addEventListener('keyup', this._onKeyUp);
            window.addEventListener('blur', this._clearKeyState);
        }

        removeListeners() {
            try {
                window.removeEventListener('keydown', this._onKeyDown);
                window.removeEventListener('keyup', this._onKeyUp);
                window.removeEventListener('blur', this._clearKeyState);
            } catch (e) {}
        }

        _onKeyDown(e) {
            const k = e.key.toLowerCase();
            if (k === this.keymap.left) this._keyState.left = true;
            if (k === this.keymap.right) this._keyState.right = true;
            if (k === this.keymap.down) this._keyState.down = true;
            if (k === this.keymap.rotCCW) this._keyState.rotCCW = true;
            if (k === this.keymap.rotCW) this._keyState.rotCW = true;
            if (Object.values(this.keymap).includes(k)) e.preventDefault();
        }

        _onKeyUp(e) {
            const k = e.key.toLowerCase();
            if (k === this.keymap.left) this._keyState.left = false;
            if (k === this.keymap.right) this._keyState.right = false;
            if (k === this.keymap.down) this._keyState.down = false;
            if (k === this.keymap.rotCCW) this._keyState.rotCCW = false;
            if (k === this.keymap.rotCW) this._keyState.rotCW = false;
        }

        _clearKeyState() {
            this._keyState.left = false;
            this._keyState.right = false;
            this._keyState.down = false;
            this._keyState.rotCCW = false;
            this._keyState.rotCW = false;
        }

        // apply controls to the currently active piece; mirrors previous _applyInputs
        applyInputs(activePiece, CONFIG) {
            if (!activePiece || !activePiece.body) return;
            const body = activePiece.body;

            if (this._keyState.left) {
                Body.applyForce(body, body.position, { x: -CONFIG.lateralForce * body.mass, y: 0 });
            }
            if (this._keyState.right) {
                Body.applyForce(body, body.position, { x: CONFIG.lateralForce * body.mass, y: 0 });
            }

            const av = body.angularVelocity;
            if (this._keyState.rotCCW) {
                const newAv = av - CONFIG.angularImpulse;
                Body.setAngularVelocity(body, Math.max(-CONFIG.maxAngularSpeed, newAv));
            } else if (this._keyState.rotCW) {
                const newAv = av + CONFIG.angularImpulse;
                Body.setAngularVelocity(body, Math.min(CONFIG.maxAngularSpeed, newAv));
            } else {
                const decel = Math.max(CONFIG.angularImpulse * 2, 0.01);
                if (av > 0) {
                    const newAv = Math.max(0, av - decel);
                    Body.setAngularVelocity(body, newAv);
                } else if (av < 0) {
                    const newAv = Math.min(0, av + decel);
                    Body.setAngularVelocity(body, newAv);
                }
            }

            const vx = body.velocity.x;
            if (Math.abs(vx) > CONFIG.maxLateralSpeed) {
                Body.setVelocity(body, { x: Math.sign(vx) * CONFIG.maxLateralSpeed, y: body.velocity.y });
            }

            const avCap = body.angularVelocity;
            if (Math.abs(avCap) > CONFIG.maxAngularSpeed) {
                Body.setAngularVelocity(body, Math.sign(avCap) * CONFIG.maxAngularSpeed);
            }

            if (this._keyState.down) {
                const vy = body.velocity.y || 0;
                const newVy = Math.min(vy + CONFIG.softDropIncrement, CONFIG.maxSoftDropSpeed);
                Body.setVelocity(body, { x: body.velocity.x, y: newVy });
            }

            this.lastMoveTs = Date.now();
        }
    }

    window.PlayerController = PlayerController;

})(window, Matter);
