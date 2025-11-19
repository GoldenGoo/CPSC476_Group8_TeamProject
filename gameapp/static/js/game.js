// Assumes matter.min.js is loaded BEFORE this script.
// Top-level imports (global Matter)
const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Query, Vector } = Matter;

// Configuration
const CONFIG = {
    canvasCssW: 300,
    canvasCssH: 600,
    spawnYOffset: -60,
    gravityY: 0.1,
    lateralForce: 0.02,         // instantaneous force applied on keydown
    maxLateralSpeed: 0.05,         // limit horizontal speed
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
function randomColor() { return `hsl(${Math.floor(Math.random()*360)},70%,50%)`; }

// Base piece factory: returns a Matter body positioned at (x,y)
// Supported types: 'rectangle', 'diamond', 'star', 'triangle', 'pentagon', 'roman'
// `size` is a tunable base size — functions scale shapes from that base.
function createPiece(type, x, y, size, options = {}) {
    type = (type || '').toLowerCase();
    const o = Object.assign({}, options);

    switch (type) {
        case 'rectangle': {
            const w = Math.round(size * 1.6);
            const h = Math.round(size);
            return Bodies.rectangle(x, y, w, h, o);
        }

        case 'diamond': {
            // diamond is a rotated square/rect; create via polygon vertices
            const half = size / 1.25;
            const verts = [
                { x: 0, y: -half },
                { x: half, y: 0 },
                { x: 0, y: half },
                { x: -half, y: 0 }
            ];
            return Bodies.fromVertices(x, y, [verts], o, true);
        }

        case 'triangle': {
            const verts = makeRegularPolygonVertices(3, size);
            return Bodies.fromVertices(x, y, [verts], o, true);
        }

        case 'pentagon': {
            const verts = makeRegularPolygonVertices(5, size);
            return Bodies.fromVertices(x, y, [verts], o, true);
        }

        case 'star': {
            // 5-point star by default; innerRatio tunable via options.innerRatio
            const points = options.points || 5;
            const innerRatio = (typeof options.innerRatio === 'number') ? options.innerRatio : 0.45;
            const verts = makeStarVertices(size, points, innerRatio);
            return Bodies.fromVertices(x, y, [verts], o, true);
        }

        case 'semicircle': {
            // create a solid semicircle (half-disc) by sampling the arc
            // radius: use provided size as radius
            const radius = size;
            // choose number of segments based on size for smoothness
            const segments = Math.max(8, Math.round(radius / 1.5));
            const verts = [];
            const angleStep = Math.PI / segments; // semicircle spans PI radians
            for (let i = 0; i <= segments; i++) {
                const angle = i * angleStep;
                const xOff = Math.cos(angle) * radius;
                const yOff = Math.sin(angle) * radius;
                verts.push({ x: xOff, y: yOff });
            }
            // Bodies.fromVertices will decompose if necessary
            return Bodies.fromVertices(x, y, [verts], o, true);
        }


        default: {
            // fallback to a rectangle if an unknown type is given
            const w = Math.round(size * 1.6);
            const h = Math.round(size);
            return Bodies.rectangle(x, y, w, h, o);
        }
    }
}

// Helper: regular polygon vertices centered at (0,0)
function makeRegularPolygonVertices(sides, radius) {
    const verts = [];
    for (let i = 0; i < sides; i++) {
        const theta = (Math.PI * 2 * i) / sides - Math.PI / 2;
        verts.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
    }
    return verts;
}

// Helper: star vertices (alternating outer/inner radii)
function makeStarVertices(radius, points, innerRatio) {
    const verts = [];
    const total = points * 2;
    for (let i = 0; i < total; i++) {
        const angle = (Math.PI * 2 * i) / total - Math.PI / 2;
        const r = (i % 2 === 0) ? radius : radius * innerRatio;
        verts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    return verts;
}

// Main class per canvas screen
class StackGame {
    constructor(canvas, keymap) {
        this.canvas = canvas;
        this.keymap = keymap; // { left, right, CCW, CW } key strings
        this.failed = false;
        this.activePiece = null;
        this.stackBodies = [];
        this.lastMoveTs = 0;
        this._keyState = {}; // track pressed keys

        // register this instance so we can check when all games finish
        window.stackGames = window.stackGames || [];
        window.stackGames.push(this);

        // track bodies currently overlapping any FAIL sensor (store body.id)
        this._sensorOverlaps = new Set();

        this._initEngine();
        this._bindInput();
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

        // spawn the next piece shortly after
        setTimeout(() => {
            if (!this.failed) this.spawnNextPiece();
        }, 160);
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
        // scoped key handlers
        this._onKeyDown = (e) => {
            const k = e.key.toLowerCase();
            if (k === this.keymap.left) this._keyState.left = true;
            if (k === this.keymap.right) this._keyState.right = true;
            if (k === this.keymap.down) this._keyState.down = true;
            if (k === this.keymap.rotCCW) this._keyState.rotCCW = true;
            if (k === this.keymap.rotCW) this._keyState.rotCW = true;
            // prevent default to stop page scroll for some keys
            if (Object.values(this.keymap).includes(k)) e.preventDefault();
        };
        this._onKeyUp = (e) => {
            const k = e.key.toLowerCase();
            if (k === this.keymap.left) this._keyState.left = false;
            if (k === this.keymap.right) this._keyState.right = false;
            if (k === this.keymap.down) this._keyState.down = false;
            if (k === this.keymap.rotCCW) this._keyState.rotCCW = false;
            if (k === this.keymap.rotCW) this._keyState.rotCW = false;
        };
        // clear keys when window loses focus so boosts don't stick
        this._clearKeyState = () => {
            this._keyState.left = false;
            this._keyState.right = false;
            this._keyState.down = false;
            this._keyState.rotCCW = false;
            this._keyState.rotCW = false;
        };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._clearKeyState);
    }

    spawnNextPiece() {
        if (this.failed) return;
        if (this.activePiece) return; // only one at a time

        // tunable base size
        const size = 18 + Math.random() * 28;
        // use only the new shape types
        const types = ['rectangle', 'diamond', 'triangle', 'pentagon', 'star', 'semicircle'];
        const type = types[Math.floor(Math.random() * types.length)];
        const x = this.width / 2;
        const y = CONFIG.spawnYOffset;

        const fill = randomColor();
        const options = {
            restitution: 0.0,
            friction: 0.1,
            density: 0.0025,
            render: { fillStyle: fill },
            label: 'FALLING'
        };

        const body = createPiece(type, x, y, size, options);
        body.label = 'FALLING';
        Body.setAngularVelocity(body, 0);
        // give some air/friction so rotation decays when player stops applying torque
        body.frictionAir = CONFIG.angularDamping;

        World.add(this.world, body);
        this.activePiece = { body, spawnedAt: Date.now(), settledSince: null };
    }

    _applyInputs() {
        if (!this.activePiece || this.failed) return;
        const body = this.activePiece.body;

        // lateral movement
        if (this._keyState.left) {
            Body.applyForce(body, body.position, { x: -CONFIG.lateralForce * body.mass, y: 0 });
        }
        if (this._keyState.right) {
            Body.applyForce(body, body.position, { x: CONFIG.lateralForce * body.mass, y: 0 });
        }

        // rotation control: adjust angular velocity directly while key is pressed
        // and decelerate quickly when released so rotation stops without applying linear forces
        const av = body.angularVelocity;
        if (this._keyState.rotCCW) {
            const newAv = av - CONFIG.angularImpulse;
            Body.setAngularVelocity(body, Math.max(-CONFIG.maxAngularSpeed, newAv));
        } else if (this._keyState.rotCW) {
            const newAv = av + CONFIG.angularImpulse;
            Body.setAngularVelocity(body, Math.min(CONFIG.maxAngularSpeed, newAv));
        } else {
            // no rotation keys pressed -> apply quick angular deceleration toward zero
            const decel = Math.max(CONFIG.angularImpulse * 2, 0.01);
            if (av > 0) {
                const newAv = Math.max(0, av - decel);
                Body.setAngularVelocity(body, newAv);
            } else if (av < 0) {
                const newAv = Math.min(0, av + decel);
                Body.setAngularVelocity(body, newAv);
            }
        }

        // limit horizontal velocity
        const vx = body.velocity.x;
        if (Math.abs(vx) > CONFIG.maxLateralSpeed) {
            Body.setVelocity(body, { x: Math.sign(vx) * CONFIG.maxLateralSpeed, y: body.velocity.y });
        }

        // cap angular velocity so pieces don't spin forever
        const avCap = body.angularVelocity;
        if (Math.abs(avCap) > CONFIG.maxAngularSpeed) {
            Body.setAngularVelocity(body, Math.sign(avCap) * CONFIG.maxAngularSpeed);
        }

        // soft drop: while down key held, gently increase downward velocity, capped
        if (this._keyState.down) {
            const vy = body.velocity.y || 0;
            const newVy = Math.min(vy + CONFIG.softDropIncrement, CONFIG.maxSoftDropSpeed);
            Body.setVelocity(body, { x: body.velocity.x, y: newVy });
        }

        this.lastMoveTs = Date.now();
    }

  
    _afterUpdate() {
        if (this.failed) return;
        // keep applying inputs to active piece while present
        this._applyInputs();
        // we no longer need time-based settling conversion because collisionStart handles instant finalization
        // should probably keep safety checks (off-screen detection, etc.)
    }

    _onOutOfBounds(body) {
        if (this.failed) return;
        this.failed = true;
        // freeze physics by stopping the runner and render
        try {
            Runner.stop(this.runner);
            Render.stop(this.render);
        } catch (e) {}
        // Optional, but we  set all bodies static
        Composite.allBodies(this.world).forEach(b => { if (!b.isStatic) Body.setStatic(b, true); });
        // Mark failure visually (e.g., tint canvas), done by adding an overlay class
        this.canvas.parentElement.classList.add('failed');
        console.log('Game failed on canvas', this.canvas.id, 'body', body.id);
   
        // check whether all registered games have finished, then prompt once to restart page
        setTimeout(() => {
            const all = (window.stackGames || []).filter(g => g && typeof g.failed === 'boolean');
            if (all.length === 0) return;
            const allFailed = all.every(g => g.failed);
            if (!allFailed) return;
            if (window._restartPromptShown) return;
            window._restartPromptShown = true;
            // simple popup restart, reload page if user confirms
            if (confirm('All players have finished. Restart the game?')) {
                location.reload();
            }
        }, 20);
    }

    reset() {
        // remove event handlers and bodies, then remake world
        // simpler approach might be to rebuild the instance
        Runner.stop(this.runner);
        Render.stop(this.render);
        // remove input listeners to avoid duplicates or stuck handlers
        try {
            window.removeEventListener('keydown', this._onKeyDown);
            window.removeEventListener('keyup', this._onKeyUp);
            window.removeEventListener('blur', this._clearKeyState);
        } catch (e) {}
        World.clear(this.world, true);
        Engine.clear(this.engine);

        // on reset, clear failed state in the global registry so other games aren't blocked
        window._restartPromptShown = false;

        // cleanup DOM render canvas pixel buffer (keep element)
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0,0,this.canvas.width, this.canvas.height);

        this.failed = false;
        this.activePiece = null;
        this.stackBodies = [];
        this.canvas.parentElement.classList.remove('failed');

        this._initEngine(); // re-create engine/render
        this.spawnNextPiece();
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
    //window.game3 = new StackGame(canv3, keymap3);
});
