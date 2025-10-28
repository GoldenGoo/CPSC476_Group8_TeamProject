// Assumes matter.min.js is loaded BEFORE this script.
// Top-level imports (global Matter)
const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Query, Vector } = Matter;

// Configuration
const CONFIG = {
    canvasCssW: 300,
    canvasCssH: 600,
    spawnYOffset: -60,
    gravityY: 0.5,
    lateralForce: 0.02,         // instantaneous force applied on keydown
    maxLateralSpeed: 1,         // limit horizontal speed
    angularImpulse: 0.005,      // rotation impulse
    timeToConsiderRestMs: 350,  // time of low speed to mark resting
};

// Utility: random color
function randomColor() { return `hsl(${Math.floor(Math.random()*360)},70%,50%)`; }

// Base piece factory: returns a Matter body positioned at (x,y)
function createPiece(type, x, y, size, options = {}) {
    if (type === 'circle') {
        return Bodies.circle(x, y, size, options);
    }
    if (type === 'polygon') {
        const sides = options.sides || (3 + Math.floor(Math.random()*5));
        return Bodies.polygon(x, y, sides, size, options);
    }
    if (type === 'star' || type === 'blob') {
        // Build vertex array, then use fromVertices via Bodies.fromVertices
        const verts = (type === 'star') ? makeStarVertices(size, 5, 0.45 + Math.random()*0.25)
                                    : makeBlobVertices(size, 5 + Math.floor(Math.random()*4), 0.25 + Math.random()*0.3);
        // Provide centered vertices
        const body = Bodies.fromVertices(x, y, [verts], Object.assign({ render: { fillStyle: options.fillStyle } }, options), true);
        return body;
    }
    // fallback rectangle
    return Bodies.rectangle(x, y, size*1.6, size, options);
}

// Vertex generators
function makeStarVertices(radius, points, innerRatio) {
    const verts = [];
    for (let i=0;i<points*2;i++){
        const angle = (Math.PI*2/(points*2))*i - Math.PI/2;
        const r = (i%2===0) ? radius : radius*innerRatio;
        verts.push({ x: Math.cos(angle)*r, y: Math.sin(angle)*r });
    }
    return verts;
}
function makeBlobVertices(radius, points, noise) {
    const verts = [];
    for (let i=0;i<points;i++){
        const angle = (Math.PI*2/points)*i;
        const offset = radius * (1 + (Math.random()-0.5)*noise);
        verts.push({ x: Math.cos(angle)*offset, y: Math.sin(angle)*offset });
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
            -sensorThickness/2,         // x just outside left
            failHeight / 2,             // center y for top section
            sensorThickness,
            failHeight,
            { isSensor: true, isStatic: true, label: 'LEFT_FAIL',
                render: { visible: true, fillStyle: 'rgba(255,0,0,0.12)', strokeStyle: 'rgba(255,0,0,0.3)', lineWidth: 1 } }
        );

        this.leftSafe  = Bodies.rectangle(
            -sensorThickness/2,         // x just outside left
            failHeight + safeHeight/2,  // center y for bottom safe section
            sensorThickness,
            safeHeight,
            { isSensor: true, isStatic: true, label: 'LEFT_SAFE',
                render: { visible: true, fillStyle: 'rgba(0,200,100,0.12)', strokeStyle: 'rgba(0,200,100,0.35)', lineWidth: 1 } }
        );

        // Right fail sensor (covers top 5/6), safe sensor (covers bottom 1/6)
        this.rightFail = Bodies.rectangle(
            this.width + sensorThickness/2,
            failHeight / 2,
            sensorThickness,
            failHeight,
            { isSensor: true, isStatic: true, label: 'RIGHT_FAIL',
                render: { visible: true, fillStyle: 'rgba(255,0,0,0.12)', strokeStyle: 'rgba(255,0,0,0.3)', lineWidth: 1 } }
        );

        this.rightSafe = Bodies.rectangle(
            this.width + sensorThickness/2,
            failHeight + safeHeight/2,
            sensorThickness,
            safeHeight,
            { isSensor: true, isStatic: true, label: 'RIGHT_SAFE',
                render: { visible: true, fillStyle: 'rgba(0,200,100,0.12)', strokeStyle: 'rgba(0,200,100,0.35)', lineWidth: 1 } }
        );

        // add all sensors to world
        World.add(this.world, [ this.leftFail, this.leftSafe, this.rightFail, this.rightSafe ]);

        Render.run(this.render);
        this.runner = Runner.create();
        Runner.run(this.runner, this.engine);

    // Collision event to detect sensor contacts
    Events.on(this.engine, 'collisionStart', (event) => {
        for (const pair of event.pairs) {
            const a = pair.bodyA;
            const b = pair.bodyB;

            // handle left/right fail sensors, only fail if the colliding object isnt falling
            if (a.isSensor && (a.label === 'LEFT_FAIL' || a.label === 'RIGHT_FAIL')) {
                if (!b.isSensor) {
                    const vy = b.velocity ? b.velocity.y : 0;
                    // If the object is still falling down fast, ignore it
                    if (Math.abs(vy) <= FALLING_VELOCITY_THRESHOLD) {
                    this._onOutOfBounds(b);
                    }
                }
                continue;
            }
            if (b.isSensor && (b.label === 'LEFT_FAIL' || b.label === 'RIGHT_FAIL')) {
                if (!a.isSensor) {
                    const vy = a.velocity ? a.velocity.y : 0;
                    if (Math.abs(vy) <= FALLING_VELOCITY_THRESHOLD) {
                    this._onOutOfBounds(a);
                    }
                }
                continue;
            }

            // grace period avoid immediate finalize on spawn
            const now = Date.now();
            if (this.activePiece && now - this.activePiece.spawnedAt < 80) continue;

            // finalize the falling body
            this._finalizeFallingBody(falling);
        }
    });

    // monitor resting logic on each tick
    Events.on(this.engine, 'afterUpdate', () => this._afterUpdate());
  }

    _finalizeFallingBody(body) {
        if (!this.activePiece) return;
        if (body !== this.activePiece.body) return;

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
            if (k === this.keymap.rotCCW) this._keyState.rotCCW = true;
            if (k === this.keymap.rotCW) this._keyState.rotCW = true;
            // prevent default to stop page scroll for some keys
            if (Object.values(this.keymap).includes(k)) e.preventDefault();
        };
        this._onKeyUp = (e) => {
            const k = e.key.toLowerCase();
            if (k === this.keymap.left) this._keyState.left = false;
            if (k === this.keymap.right) this._keyState.right = false;
            if (k === this.keymap.rotCCW) this._keyState.rotCCW = false;
            if (k === this.keymap.rotCW) this._keyState.rotCW = false;
        };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    spawnNextPiece() {
        if (this.failed) return;
        if (this.activePiece) return; // only one at a time

        const size = 18 + Math.random()*28;
        const types = ['circle','polygon','star','blob'];
        const type = types[Math.floor(Math.random()*types.length)];
        const x = this.width/2;
        const y = CONFIG.spawnYOffset;

        const fill = randomColor();
        const options = { restitution: 0.0, friction: 0.1, density: 0.0025, render: { fillStyle: fill }, label: 'FALLING' };

        const body = createPiece(type, x, y, size, options);
        body.label = 'FALLING';
        Body.setAngularVelocity(body, 0);
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

        // rotation control
        if (this._keyState.rotCCW) {
            Body.applyForce(body, { x: body.position.x, y: body.position.y - 1 }, { x: 0, y: 0 }); // not null
            Body.setAngularVelocity(body, body.angularVelocity - CONFIG.angularImpulse);
        }
        if (this._keyState.rotCW) {
            Body.setAngularVelocity(body, body.angularVelocity + CONFIG.angularImpulse);
        }

        // limit horizontal velocity
        const vx = body.velocity.x;
        if (Math.abs(vx) > CONFIG.maxLateralSpeed) {
            Body.setVelocity(body, { x: Math.sign(vx) * CONFIG.maxLateralSpeed, y: body.velocity.y });
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
    }

    reset() {
        // remove event handlers and bodies, then remake world
        // simpler approach might be to rebuild the instance
        Runner.stop(this.runner);
        Render.stop(this.render);
        World.clear(this.world, true);
        Engine.clear(this.engine);

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
    const keymap1 = { left: 'a', right: 'd', rotCCW: 'q', rotCW: 'e' };
    const keymap2 = { left: 'j', right: 'l', rotCCW: 'u', rotCW: 'o' };
    //const keymap3 = { left: 'arrowleft', right: 'arrowright', rotCCW: 'comma', rotCW: 'period' }; // just for testing

    const canv1 = document.getElementById('gameCanvas1');
    const canv2 = document.getElementById('gameCanvas2');
    const canv3 = document.getElementById('gameCanvas3');

    window.game1 = new StackGame(canv1, keymap1);
    window.game2 = new StackGame(canv2, keymap2);
    //window.game3 = new StackGame(canv3, keymap3);
});
