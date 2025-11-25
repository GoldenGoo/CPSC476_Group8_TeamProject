// Assumes matter.min.js is loaded BEFORE this script.
// Top-level imports (global Matter)
const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Query, Vector } = Matter;

// Configuration
const CONFIG = {
    canvasCssW: 300,
    canvasCssH: 600,
    spawnYOffset: -60,
    gravityY: 0.1,
    lateralForce: 0.01,         // instantaneous force applied on keydown
    maxLateralSpeed: 0.03,         // limit horizontal speed
    angularImpulse: 0.005,      // rotation impulse
    angularDamping: 0.02,      // air/friction damping for rotation/linear when released
    maxAngularSpeed: 0.25,     // cap angular velocity so pieces don't spin out
    // soft drop: velocity-based increment applied while holding the down key
    // `softDropIncrement` is added to the current downward velocity each tick (then capped)
    softDropIncrement: 0.25,
    // cap for how fast a soft-dropped piece can fall (units: px/tick-ish)
    maxSoftDropSpeed: 6.0,
    timeToConsiderRestMs: 350,  // time of low speed to mark resting
};

// Utility: random color
// Note: shape creation and helpers moved to `shapes.js` as `window.ShapeFactory`.

// Main class per canvas screen
class StackGame {
    constructor(canvas, keymap) {
        this.canvas = canvas;
        this.score = 0;
        this.keymap = keymap; // { left, right, CCW, CW } key strings
        this.failed = false;
        this._overlay = null;
        this._overlayVisible = false;
        this.restartKey = (this.keymap && this.keymap.down) ? this.keymap.down.toLowerCase() : null; // used as keyboard shortcut for confirm
        this.activePiece = null;
        this.stackBodies = [];
        this.lastMoveTs = 0;
        // playerController handles key state and input application (only if a keymap was provided)
        if (this.keymap && Object.keys(this.keymap).length) {
            this.playerController = new PlayerController(this.keymap);
        }

        // register this instance so we can check when all games finish
        window.stackGames = window.stackGames || [];
        window.stackGames.push(this);

        // track bodies currently overlapping any FAIL sensor (store body.id)
        this._sensorOverlaps = new Set();

        this._initEngine();
        this._createRestartOverlay();
        this.spawnNextPiece();
    }

    _initEngine() {
        // size canvas backing store for DPR
        this._resizeCanvasForDPR();

        this.engine = Engine.create();
        this.world = this.engine.world;
        this.world.gravity.y = CONFIG.gravityY;

        this.render = Render.create({
            canvas: this.canvas,
            engine: this.engine,
            options: {
                width: this.width,
                height: this.height,
                wireframes: false,
                background: '#111',
                showVelocity: false
            }
        });

        // floor only; left/right walls are not collision walls
        const thickness = 120;
        const floor = Bodies.rectangle(this.width/2, this.height + thickness/2, this.width + 400, thickness, { isStatic: true, label: 'FLOOR', render: { visible: true, fillStyle: '#222' }});
        World.add(this.world, floor);

        // sensor geometry
        const sensorThickness = 10;                      // thin strip just outside canvas
        const safeHeight = Math.round(this.height / 6);  // lower safe zone height
        const failHeight = this.height - safeHeight;     // remaining height above safe zone

        // Left fail sensor (covers top 5/6), safe sensor (covers bottom 1/6)
        this.leftFail  = Bodies.rectangle(
            sensorThickness/2,         // x just outside left
            failHeight / 2,             // center y for top section
            sensorThickness,
            failHeight,
            { isSensor: true, isStatic: true, label: 'LEFT_FAIL',
                render: { visible: true, fillStyle: 'rgba(255,0,0,0.12)', strokeStyle: 'rgba(255,0,0,0.3)', lineWidth: 1 } }
        );

        // Left inner collision wall (thin, inside canvas), physically blocks active pieces
        this.leftWallInside = Bodies.rectangle(
            sensorThickness/2,          // just inside the left edge
            failHeight / 2,
            sensorThickness/4,            // thin solid wall
            failHeight,
            {
                isSensor: false,
                isStatic: true,
                label: 'LEFT_WALL',
                // remove friction so the wall doesn't artificially slow falling pieces
                friction: 0,
                frictionStatic: 0,
                restitution: 0,
                render: { visible: true, fillStyle: 'rgba(255,0,0,0.06)' }
            }
        );

        this.leftSafe  = Bodies.rectangle(
            sensorThickness/2,         // x just outside left
            failHeight + safeHeight/2,  // center y for bottom safe section
            sensorThickness,
            safeHeight,
            { isSensor: false, isStatic: true, label: 'LEFT_SAFE',
                render: { visible: true, fillStyle: 'rgba(0,200,100,0.12)', strokeStyle: 'rgba(0,200,100,0.35)', lineWidth: 1 } }
        );

        // Right fail sensor (covers top 5/6), safe sensor (covers bottom 1/6)
        this.rightFail = Bodies.rectangle(
            this.width - sensorThickness/2,
            failHeight / 2,
            sensorThickness,
            failHeight,
            { isSensor: true, isStatic: true, label: 'RIGHT_FAIL',
                render: { visible: true, fillStyle: 'rgba(255,0,0,0.12)', strokeStyle: 'rgba(255,0,0,0.3)', lineWidth: 1 } }
        );

        this.rightWallInside = Bodies.rectangle(
            this.width - sensorThickness/2, // just inside right edge
            failHeight / 2,
            sensorThickness/4,
            failHeight,
            {
                isSensor: false,
                isStatic: true,
                label: 'RIGHT_WALL',
                // remove friction so the wall doesn't artificially slow falling pieces
                friction: 0,
                frictionStatic: 0,
                restitution: 0,
                render: { visible: true, fillStyle: 'rgba(255,0,0,0.06)' }
            }
        );

        this.rightSafe = Bodies.rectangle(
            this.width - sensorThickness/2,
            failHeight + safeHeight/2,
            sensorThickness,
            safeHeight,
            { isSensor: false, isStatic: true, label: 'RIGHT_SAFE',
                render: { visible: true, fillStyle: 'rgba(0,200,100,0.12)', strokeStyle: 'rgba(0,200,100,0.35)', lineWidth: 1 } }
        );

        // add all sensors to world
        World.add(this.world, [ this.leftFail, this.leftWallInside, this.leftSafe, this.rightFail, this.rightWallInside, this.rightSafe ]);

        Render.run(this.render);
        this.runner = Runner.create();
        Runner.run(this.runner, this.engine);

    // Improved collision handlers:
    // - keep a set of bodies overlapping fail sensors
    // - handle collisionStart as before and add overlapping bodies to the set
    // - handle collisionActive to re-check velocities for overlaps (covers the "slow down while overlapping" case)
    // - handle collisionEnd to remove overlaps
    {
        const FALLING_VELOCITY_THRESHOLD = 0.5; // downward velocity threshold (Matter uses +y downward)
        const rootBody = (b) => (b && b.parent && b.parent !== b) ? b.parent : b;
        const isPartOf = (candidate, target) => {
            if (!candidate || !target) return false;
            if (candidate.id === target.id) return true;
            if (target.parts && target.parts.some(p => p.id === candidate.id)) return true;
            return false;
        };

        // collisionStart: add sensor overlaps and finalize falling pieces
        Events.on(this.engine, 'collisionStart', (event) => {
            for (const pair of event.pairs) {
                const a = rootBody(pair.bodyA);
                const b = rootBody(pair.bodyB);

                // sensor handling
                if (a.isSensor || b.isSensor) {
                    const sensor = a.isSensor ? a : b;
                    const other = sensor === a ? b : a;
                    if (!other || other.isSensor) continue;
                    if (sensor.label && sensor.label.endsWith('_SAFE')) continue;
                    if (sensor.label && sensor.label.endsWith('_FAIL')) {
                        // mark overlap so we can re-evaluate in collisionActive
                        this._sensorOverlaps.add(other.id);
                        const vy = other.velocity ? other.velocity.y : 0;
                        if (vy <= FALLING_VELOCITY_THRESHOLD) {
                            this._onOutOfBounds(other);
                        }
                    }
                    continue;
                }

                // finalize falling piece when it hits a non-sensor/stack/floor
                if (!this.activePiece || !this.activePiece.body) continue;
                const active = this.activePiece.body;
                const collidedWithActive = isPartOf(a, active) || isPartOf(b, active);
                if (!collidedWithActive) continue;

                const fallingPart = isPartOf(a, active) ? a : b;
                const otherBody = fallingPart === a ? b : a;
                if (!otherBody || otherBody.isSensor) continue;
                if (otherBody.label === 'FALLING') continue;

                const now = Date.now();
                if (this.activePiece && now - this.activePiece.spawnedAt < 80) continue;
                this._finalizeFallingBody(fallingPart);
            }
        });

        // collisionActive: continuously re-check bodies that remain overlapping fail sensors
        Events.on(this.engine, 'collisionActive', (event) => {
            for (const pair of event.pairs) {
                const a = rootBody(pair.bodyA);
                const b = rootBody(pair.bodyB);
                const sensor = a.isSensor ? a : (b.isSensor ? b : null);
                const other = sensor ? (sensor === a ? b : a) : null;
                if (!sensor || !other || other.isSensor) continue;
                if (sensor.label && sensor.label.endsWith('_SAFE')) continue;
                if (sensor.label && sensor.label.endsWith('_FAIL')) {
                    // ensure we track this overlap
                    this._sensorOverlaps.add(other.id);
                    const vy = other.velocity ? other.velocity.y : 0;
                    if (vy <= FALLING_VELOCITY_THRESHOLD) {
                        this._onOutOfBounds(other);
                    }
                }
            }
        });

        // collisionEnd: remove from overlap tracking
        Events.on(this.engine, 'collisionEnd', (event) => {
            for (const pair of event.pairs) {
                const a = rootBody(pair.bodyA);
                const b = rootBody(pair.bodyB);
                const sensor = a.isSensor ? a : (b.isSensor ? b : null);
                const other = sensor ? (sensor === a ? b : a) : null;
                if (!sensor || !other || other.isSensor) continue;
                if (sensor.label && sensor.label.endsWith('_FAIL')) {
                    this._sensorOverlaps.delete(other.id);
                }
            }
        });
    }

    // monitor resting logic on each tick
    Events.on(this.engine, 'afterUpdate', () => this._afterUpdate());
  }

    _finalizeFallingBody(body) {
        // allow passing either the active body or one of its parts
        if (!this.activePiece) return;
        const active = this.activePiece.body;
        const matchesActive = (b, target) => {
            if (!b || !target) return false;
            if (b.id === target.id) return true;
            if (target.parts && target.parts.some(p => p.id === b.id)) return true;
            return false;
        };
        if (!matchesActive(body, active)) return;

        // remove player control
        this.activePiece = null;

        // zero small velocities so it doesn't immediately tumble away
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);

        // tune physical properties so placed piece resists sliding/bouncing but still reacts to forces
        body.restitution = 0;         // no bounce
        body.friction = 0.9;         // lots of friction
        body.frictionStatic = 0.9;
        Body.setDensity(body, body.density || 0.0025); // keep density reasonable

        // optionally reduce sleep threshold so it can sleep when settled but still wake on impacts
        body.sleepThreshold = 10;

        // mark label for bookkeeping
        body.label = 'STACK';
        this.stackBodies.push(body);

        // update the score (+1 for each piece placed) - might update this to vary based on the size of the shape
        this.score++; 
        console.log("Current Score:", this.score);
        this._updateScoreDisplay();

        // spawn the next piece shortly after
        setTimeout(() => {
            if (!this.failed) this.spawnNextPiece();
        }, 160);
    }

    // Helper to update the label visually
    _updateScoreDisplay() {
        // Find the label associated with this canvas
        const wrapper = this.canvas.closest('.screen-wrap');
        if (wrapper) {
            const label = wrapper.querySelector('.screen-label');
            // Keep the original name and append score
            const baseName = label.getAttribute('data-name') || label.textContent.split(':')[0];
            // Store original name in attribute if not there so we don't lose it
            if (!label.getAttribute('data-name')) label.setAttribute('data-name', baseName);
            
            label.textContent = `${baseName}: ${this.score}`;
        }
    }

    _resizeCanvasForDPR() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(rect.width * dpr);
        this.canvas.height = Math.round(rect.height * dpr);
        const ctx = this.canvas.getContext('2d');
        ctx.setTransform(1,0,0,1,0,0);
        ctx.scale(dpr, dpr);
        this.width = Math.round(rect.width);
        this.height = Math.round(rect.height);
    }

    _bindInput() {
        // input handled by PlayerController; kept for API parity
    }

    spawnNextPiece() {
        if (this.failed) return;
        if (this.activePiece) return; // only one at a time

        // tunable base size
        const size = 25 + Math.random() * 10;
        // use only the new shape types
        const types = ['rectangle', 'diamond', 'triangle', 'pentagon', 'star', 'semicircle'];
        const type = types[Math.floor(Math.random() * types.length)];
        const x = this.width / 2;
        const y = CONFIG.spawnYOffset;

        const fill = (window.ShapeFactory && window.ShapeFactory.randomColor) ? window.ShapeFactory.randomColor() : '#f0f';
        const options = {
            restitution: 0.0,
            friction: 0.1,
            density: 0.0025,
            render: { fillStyle: fill},
            label: 'FALLING'
        };

        // Default body is a pink rectangle
        const body = (window.ShapeFactory && window.ShapeFactory.createPiece) ? window.ShapeFactory.createPiece(type, x, y, size, options) : Bodies.rectangle(x,y,Math.round(size*1.6),Math.round(size), options);
        body.label = 'FALLING';
        Body.setAngularVelocity(body, 0);
        // give some air/friction so rotation decays when player stops applying torque
        body.frictionAir = CONFIG.angularDamping;

        World.add(this.world, body);
        this.activePiece = { body, spawnedAt: Date.now(), settledSince: null };
    }
  
    _afterUpdate() {
        if (this.failed) return;
        // human controller
        if (this.playerController && typeof this.playerController.applyInputs === 'function') {
            this.playerController.applyInputs(this.activePiece, CONFIG);
        }
        // AI controller (if present)
        if (this.aiController && typeof this.aiController.applyInputs === 'function') {
            this.aiController.applyInputs(this.activePiece, CONFIG, this);
        }
        // we no longer need time-based settling conversion because collisionStart handles instant finalization
    }

    _onOutOfBounds(body) {
        if (this.failed) return;
        this.failed = true;
        // freeze physics by stopping the runner and render
        try {
            Runner.stop(this.runner);
            Render.stop(this.render);
        } catch (e) {}
        // Optional, but we set all bodies static
        Composite.allBodies(this.world).forEach(b => { if (!b.isStatic) Body.setStatic(b, true); });

        // Only save if a human player (i.e. has a keymap) to avoid logging AI scores
        console.log('Game failed. Final Score:', this.score);
        if (this.keymap) {
            this._sendScoreToBackend(this.score);
        }

        // Mark failure visually (e.g. tint canvas), done by adding an overlay class
        this.canvas.parentElement.classList.add('failed');
        console.log('Game failed on canvas', this.canvas.id, 'body', body.id);
   
        // show only a per-canvas restart overlay so players can individually restart
        setTimeout(() => this._showRestartOverlay(), 20);
    }

    // Helper to POST data to Django
    _sendScoreToBackend(finalScore) {
        // We need the CSRF token for Django POST requests
        const getCookie = (name) => {
            let cookieValue = null;
            if (document.cookie && document.cookie !== '') {
                const cookies = document.cookie.split(';');
                for (let i = 0; i < cookies.length; i++) {
                    const cookie = cookies[i].trim();
                    if (cookie.substring(0, name.length + 1) === (name + '=')) {
                        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                        break;
                    }
                }
            }
            return cookieValue;
        }

        fetch('/save_score/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ score: finalScore })
        })
        .then(response => response.json())
        .then(data => console.log('Score saved:', data))
        .catch(error => console.error('Error saving score:', error));
    }

    reset() {
        // remove event handlers and bodies, then remake world
        // simpler approach might be to rebuild the instance
        Runner.stop(this.runner);
        Render.stop(this.render);
        // remove input listeners to avoid duplicates or stuck handlers
        try {
            if (this.playerController && typeof this.playerController.removeListeners === 'function') {
                this.playerController.removeListeners();
            }
        } catch (e) {}
        World.clear(this.world, true);
        Engine.clear(this.engine);

        // per-canvas restart overlay will be hidden; no global prompt used anymore

        // cleanup DOM render canvas pixel buffer (keep element)
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0,0,this.canvas.width, this.canvas.height);

        this.failed = false;
        this.activePiece = null;
        this.stackBodies = [];
        this.canvas.parentElement.classList.remove('failed');
        // hide any restart overlay if present
        try { this._hideRestartOverlay(); } catch (e) {}

        this._initEngine(); // re-create engine/render
        // recreate controller so it re-binds listeners (only if a keymap was provided)
        if (this.keymap && Object.keys(this.keymap).length) {
            this.playerController = new PlayerController(this.keymap);
        }
        this.spawnNextPiece();
    }

    // Creates a minimal overlay element for per-canvas restart confirmation.
    _createRestartOverlay() {
        const screen = this.canvas.parentElement;
        if (!screen) return;
        const overlay = document.createElement('div');
        overlay.className = 'restart-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.tabIndex = -1;
        overlay.style.display = 'none';
        // Ensure overlay is above the canvas even if the canvas creates a stacking context
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'auto';

        const modal = document.createElement('div');
        modal.className = 'restart-modal';
        // make sure modal sits above overlay background
        modal.style.zIndex = '10000';
        const p = document.createElement('p');
        p.textContent = 'Restart?';
        modal.appendChild(p);

        const btn = document.createElement('button');
        btn.className = 'restart-confirm';
        btn.textContent = 'Confirm';
        modal.appendChild(btn);

        // hint for keyboard confirmation, use provided key if available
        const hint = document.createElement('div');
        hint.className = 'restart-hint';
        hint.textContent = this.restartKey ? `Press '${this.restartKey.toUpperCase()}' to confirm` : '';
        modal.appendChild(hint);

        overlay.appendChild(modal);
        screen.appendChild(overlay);

        // click handler
        btn.addEventListener('click', () => {
            this._hideRestartOverlay();
            this.reset();
        });

        // close with Escape to hide overlay
        overlay.addEventListener('click', (evt) => {
            if (evt.target === overlay) {
                this._hideRestartOverlay();
            }
        });

        // keyboard handler - only while overlay is visible
        this._keyHandler = (e) => {
            if (!this._overlayVisible) return;
            if (!e || !e.key) return;
            const key = e.key.toLowerCase();
            // confirm if matches restart key
            if (this.restartKey && key === this.restartKey.toLowerCase()) {
                this._hideRestartOverlay();
                this.reset();
            }
            // close overlay on Escape
            if (key === 'escape') {
                this._hideRestartOverlay();
            }
        };

        window.addEventListener('keydown', this._keyHandler);

        this._overlay = overlay;
        console.log('[StackGame] restart overlay created for canvas', this.canvas && this.canvas.id);
    }

    _showRestartOverlay() {
        if (!this._overlay) return;
        this._overlay.setAttribute('aria-hidden', 'false');
        this._overlay.style.display = 'flex';
        this._overlayVisible = true;
        console.log('[StackGame] showing restart overlay for canvas', this.canvas && this.canvas.id);
    }

    _hideRestartOverlay() {
        if (!this._overlay) return;
        this._overlay.setAttribute('aria-hidden', 'true');
        this._overlay.style.display = 'none';
        this._overlayVisible = false;
        console.log('[StackGame] hiding restart overlay for canvas', this.canvas && this.canvas.id);
    }
}


window.addEventListener('DOMContentLoaded', () => {
    const keymap1 = { left: 'a', right: 'd', down: 's', rotCCW: 'q', rotCW: 'e' };
    const keymap2 = { left: 'j', right: 'l', down: 'k', rotCCW: 'u', rotCW: 'o' };
    //const keymap3 = { left: 'arrowleft', right: 'arrowright', rotCCW: 'comma', rotCW: 'period' }; // just for testing

    const canv1 = document.getElementById('gameCanvas1');
    const canv2 = document.getElementById('gameCanvas2');
    const canv3 = document.getElementById('gameCanvas3');

    window.game1 = new StackGame(canv1, keymap1);
    window.game2 = new StackGame(canv2, keymap2);
    // AI-driven third player (no keymap -> no PlayerController)
    window.game3 = new StackGame(canv3, null);
    window.game3.aiController = new AIController({ reactionMs: 110, aggression: 0.7, debug: true });
});
