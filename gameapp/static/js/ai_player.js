// Simple AI controller that mimics human PlayerController behavior but computes key state
(function(window, Matter){
    const { Body, Vector } = Matter;

    class AIController {
        constructor(options = {}) {
            this.options = Object.assign({ reactionMs: 120, aggression: 0.6, debug: false, startupDelayMs: 500, wallMargin: 36 }, options);
            this._keyState = { left: false, right: false, down: false, rotCCW: false, rotCW: false };
            this._lastDecision = 0;
            this._lastTargetX = null;
            this._debugOverlay = null;
        }

        // Decide on a keyState based on active piece position and velocity
        _decide(activePiece, game) {
            const now = Date.now();
            if (!activePiece || !activePiece.body) {
                this._keyState = { left: false, right: false, down: false, rotCCW: false, rotCW: false };
                return;
            }
            // Don't make adjustments until startupDelayMs after piece spawned
            if (activePiece && activePiece.spawnedAt) {
                if (now - activePiece.spawnedAt < this.options.startupDelayMs) return;
            }
            if (now - this._lastDecision < this.options.reactionMs) return;
            this._lastDecision = now;

            const body = activePiece.body;
            // Board-aware: examine existing stacked bodies to find a good gap to place the piece
            let targetX = game.width / 2;
            let pieceWidth = 30;
            try {
                const stacks = (game.stackBodies || []).filter(b => b && b.label === 'STACK');
                pieceWidth = (body.bounds.max.x - body.bounds.min.x) || 30;
                // Don't make adjustments until startupDelayMs after piece spawned
                // (startup delay already checked above)

                if (stacks.length === 0) {
                    targetX = game.width / 2;
                } else {
                    // build intervals of occupied space
                    const intervals = stacks.map(b => ({ left: b.bounds.min.x, right: b.bounds.max.x }));
                    // add virtual walls at 0 and game.width
                    intervals.push({ left: -9999, right: 0 });
                    intervals.push({ left: game.width, right: game.width + 9999 });
                    // sort by left
                    intervals.sort((a,b) => a.left - b.left);

                    // find best gap between intervals (gap = next.left - cur.right)
                    let bestGap = { left: 0, right: game.width, size: -1 };
                    for (let i = 0; i < intervals.length - 1; i++) {
                        const cur = intervals[i];
                        const next = intervals[i+1];
                        const gapLeft = cur.right;
                        const gapRight = next.left;
                        const gapSize = gapRight - gapLeft;
                        if (gapSize > bestGap.size) {
                            bestGap = { left: gapLeft, right: gapRight, size: gapSize };
                        }
                    }

                    // prefer gaps that fit the piece width (with small margin)
                    if (bestGap.size >= pieceWidth * 0.9) {
                        targetX = Math.max(0, Math.min(game.width, bestGap.left + bestGap.size / 2));
                    } else {
                        // otherwise aim to center over the widest gap available
                        targetX = Math.max(0, Math.min(game.width, bestGap.left + bestGap.size / 2));
                    }
                }
            } catch (e) {
                targetX = game.width / 2;
            }

            // clamp target away from inside walls to avoid nudging into them
            try {
                const margin = Math.max(this.options.wallMargin, pieceWidth * 0.5);
                const leftLimit = (game.leftWallInside && game.leftWallInside.bounds) ? game.leftWallInside.bounds.max.x + margin : margin;
                const rightLimit = (game.rightWallInside && game.rightWallInside.bounds) ? game.rightWallInside.bounds.min.x - margin : (game.width - margin);
                targetX = Math.max(leftLimit, Math.min(rightLimit, targetX));
            } catch (e) {}

            // compute dx and angles now (used for decisions and debug)
            const dx = body.position.x - targetX;
            const angle = body.angle; // radians
            const angDeg = angle * (180 / Math.PI);

            // store last target for debug
            this._lastTargetX = targetX;

            // horizontal decision with threshold proportional to piece size
            const threshold = Math.max(10, pieceWidth * 0.5);
            this._keyState.left = dx > threshold;
            this._keyState.right = dx < -threshold;

            // soft drop: once over target and rotation near upright, speed up drop
            const angOk = Math.abs(angDeg) < 8;
            const closeEnough = Math.abs(dx) < Math.max(8, pieceWidth * 0.4);
            this._keyState.down = closeEnough && angOk && (Math.random() < 0.3 * this.options.aggression);

            // try to reduce angular velocity and approach angle 0
            this._keyState.rotCCW = angDeg > 8;
            this._keyState.rotCW = angDeg < -8;

            // update overlay if debug enabled
            if (this.options.debug) {
                this._ensureDebugOverlay(game);
                this._updateDebugOverlay({ targetX, body, angDeg, dx });
            }
        }

        // apply inputs using the same physics manipulations as PlayerController
        applyInputs(activePiece, CONFIG, game) {
            this._decide(activePiece, game);
            if (!activePiece || !activePiece.body) return;
            const body = activePiece.body;

            // prevent pushing toward walls: if near wall, ignore lateral command toward that wall
            try {
                const pieceWidth = (body.bounds.max.x - body.bounds.min.x) || 30;
                const margin = Math.max(this.options.wallMargin, pieceWidth * 0.5);
                const leftLimit = (game.leftWallInside && game.leftWallInside.bounds) ? game.leftWallInside.bounds.max.x + margin : margin;
                const rightLimit = (game.rightWallInside && game.rightWallInside.bounds) ? game.rightWallInside.bounds.min.x - margin : (game.width - margin);
                const nearLeft = body.position.x < leftLimit + Math.max(6, pieceWidth * 0.25);
                const nearRight = body.position.x > rightLimit - Math.max(6, pieceWidth * 0.25);

                if (this._keyState.left && !nearLeft) {
                    Body.applyForce(body, body.position, { x: -CONFIG.lateralForce * body.mass, y: 0 });
                }
                if (this._keyState.right && !nearRight) {
                    Body.applyForce(body, body.position, { x: CONFIG.lateralForce * body.mass, y: 0 });
                }
            } catch (e) {
                if (this._keyState.left) Body.applyForce(body, body.position, { x: -CONFIG.lateralForce * body.mass, y: 0 });
                if (this._keyState.right) Body.applyForce(body, body.position, { x: CONFIG.lateralForce * body.mass, y: 0 });
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
            // update debug overlay each tick if enabled
            if (this.options.debug) {
                this._ensureDebugOverlay(game);
                this._updateDebugOverlay({ targetX: this._lastTargetX, keyState: this._keyState, lastDecision: this._lastDecision });
            }
        }

        _ensureDebugOverlay(game) {
            try {
                if (!game || !game.canvas) return;
                if (this._debugOverlay && this._debugOverlay.parentElement === game.canvas.parentElement) return;
                // create overlay
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.top = '6px';
                el.style.left = '6px';
                el.style.padding = '6px 8px';
                el.style.background = 'rgba(0,0,0,0.45)';
                el.style.color = 'white';
                el.style.font = '12px monospace';
                el.style.pointerEvents = 'none';
                el.style.zIndex = 9999;
                el.className = 'ai-debug-overlay';
                // position container relative to canvas parent
                const parent = game.canvas.parentElement;
                parent.style.position = parent.style.position || 'relative';
                parent.appendChild(el);
                this._debugOverlay = el;
            } catch (e) {}
        }

        _updateDebugOverlay(info) {
            if (!this._debugOverlay) return;
            const t = info || {};
            const lines = [];
            lines.push(`targetX: ${t.targetX ? Math.round(t.targetX) : 'n/a'}`);
            if (t.keyState) {
                lines.push(`keys: L=${t.keyState.left?1:0} R=${t.keyState.right?1:0} D=${t.keyState.down?1:0} < ${t.keyState.rotCCW? 'CCW':''}${t.keyState.rotCW? 'CW':''}`);
            }
            if (t.lastDecision) lines.push(`lastDec: ${new Date(t.lastDecision).toLocaleTimeString()}`);
            this._debugOverlay.textContent = lines.join('\n');
        }
    }

    window.AIController = AIController;

})(window, Matter);
