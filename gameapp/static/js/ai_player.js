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
            this.aggressionMultiplier = 1.0;  // dynamic multiplier set by game.js
        }

        setAggressionMultiplier(multiplier) {
            this.aggressionMultiplier = Math.max(0.1, Math.min(3.0, multiplier));
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
                    // build intervals of occupied space by sorting stack bounds
                    const intervals = stacks.map(b => ({ left: b.bounds.min.x, right: b.bounds.max.x }))
                        .sort((a, b) => a.left - b.left);
                    
                    // merge overlapping/adjacent intervals to get continuous occupied regions
                    const merged = [];
                    for (let i = 0; i < intervals.length; i++) {
                        const cur = intervals[i];
                        if (merged.length > 0) {
                            const last = merged[merged.length - 1];
                            if (cur.left <= last.right + 5) {  // overlap or very close (5px tolerance)
                                last.right = Math.max(last.right, cur.right);
                            } else {
                                merged.push({ left: cur.left, right: cur.right });
                            }
                        } else {
                            merged.push({ left: cur.left, right: cur.right });
                        }
                    }

                    // find gaps (empty spaces between occupied regions and edges)
                    const gaps = [];
                    
                    // gap before first stack
                    if (merged.length > 0 && merged[0].left > 0) {
                        gaps.push({ left: 0, right: merged[0].left, size: merged[0].left, center: merged[0].left / 2 });
                    }
                    
                    // gaps between stacks
                    for (let i = 0; i < merged.length - 1; i++) {
                        const gapLeft = merged[i].right;
                        const gapRight = merged[i + 1].left;
                        const gapSize = gapRight - gapLeft;
                        gaps.push({ left: gapLeft, right: gapRight, size: gapSize, center: (gapLeft + gapRight) / 2 });
                    }
                    
                    // gap after last stack
                    if (merged.length > 0 && merged[merged.length - 1].right < game.width) {
                        const lastRight = merged[merged.length - 1].right;
                        gaps.push({ left: lastRight, right: game.width, size: game.width - lastRight, center: (lastRight + game.width) / 2 });
                    }
                    
                    // if no gaps found (stacks span entire width), fall back to center
                    if (gaps.length === 0) {
                        targetX = game.width / 2;
                    } else {
                        // Score each gap: size (primary), center-bias (secondary)
                        let bestGap = gaps[0];
                        let bestScore = -Infinity;
                        
                        for (let gap of gaps) {
                            const distanceFromCenter = Math.abs(gap.center - game.width / 2);
                            // Primary: gap size. Secondary: proximity to center (penalty of 0.1 per pixel of distance)
                            const score = gap.size - (distanceFromCenter * 0.1);
                            
                            if (score > bestScore) {
                                bestScore = score;
                                bestGap = gap;
                            }
                        }
                        
                        targetX = bestGap.center;
                    }
                }
            } catch (e) {
                targetX = game.width / 2;
            }

            // clamp target away from inside walls to avoid nudging into them
            // use a larger margin to account for rotated pieces that may have extended points
            try {
                const margin = Math.max(this.options.wallMargin, pieceWidth * 0.7);  // increased from 0.5
                const extraWallMargin = 15;  // additional safety buffer for rotated shapes
                const leftLimit = (game.leftWallInside && game.leftWallInside.bounds) ? game.leftWallInside.bounds.max.x + margin + extraWallMargin : margin + extraWallMargin;
                const rightLimit = (game.rightWallInside && game.rightWallInside.bounds) ? game.rightWallInside.bounds.min.x - margin - extraWallMargin : (game.width - margin - extraWallMargin);
                targetX = Math.max(leftLimit, Math.min(rightLimit, targetX));
            } catch (e) {}

            // compute dx and angles now (used for decisions and debug)
            const dx = body.position.x - targetX;
            const angle = body.angle; // radians
            const angDeg = angle * (180 / Math.PI);

            // --- Rotation logic: prefer flatter, more stable orientation ---
            // Get piece dimensions in current orientation
            const w = body.bounds.max.x - body.bounds.min.x;
            const h = body.bounds.max.y - body.bounds.min.y;
            const isTall = h > w * 1.1;  // piece is taller than wide (unstable)

            // If currently tall, we want to rotate to make it wider
            // Snap to nearest 45-degree increment to simplify: 0°, 45°, 90°, 135°, 180°, etc.
            let targetAngleDeg = Math.round(angDeg / 45) * 45;  // snap to 45-deg increments
            
            // If piece is tall, prefer a 90-degree rotation to flip it horizontal
            if (isTall) {
                const nearestMultipleOf90 = Math.round(angDeg / 90) * 90;
                // rotate 90 degrees away from current snap
                targetAngleDeg = nearestMultipleOf90 + 90;
            }
            
            // Normalize to 0-360 range
            targetAngleDeg = ((targetAngleDeg % 360) + 360) % 360;
            const targetAngleRad = targetAngleDeg * (Math.PI / 180);
            
            // Calculate angle difference (shortest path)
            let angleDiff = targetAngleRad - angle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

            // store last target for debug
            this._lastTargetX = targetX;

            // horizontal decision with threshold proportional to piece size
            const threshold = Math.max(10, pieceWidth * 0.5);
            this._keyState.left = dx > threshold;
            this._keyState.right = dx < -threshold;

            // soft drop: once over target and rotation near upright, speed up drop
            const angOk = Math.abs(angleDiff * 180 / Math.PI) < 5;  // rotation is stable
            const closeEnough = Math.abs(dx) < Math.max(8, pieceWidth * 0.4);
            const effectiveAggression = this.options.aggression * this.aggressionMultiplier;
            this._keyState.down = closeEnough && angOk && (Math.random() < 0.3 * effectiveAggression);

            // Rotation: rotate toward target angle (prefer flat/stable orientation)
            const rotThreshold = 5;  // degrees
            if (Math.abs(angleDiff * 180 / Math.PI) > rotThreshold) {
                // Need to rotate: choose direction based on shortest path
                if (angleDiff > 0) {
                    this._keyState.rotCW = true;
                    this._keyState.rotCCW = false;
                } else {
                    this._keyState.rotCCW = true;
                    this._keyState.rotCW = false;
                }
            } else {
                // Close to target angle: stop rotating
                this._keyState.rotCW = false;
                this._keyState.rotCCW = false;
            }

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
