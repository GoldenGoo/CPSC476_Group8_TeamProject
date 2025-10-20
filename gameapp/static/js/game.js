class GameScreen {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.shapes = [];
        this.running = false;

        //sync buffer to display size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        // get on-screen size in CSS pixels
        const rect = this.canvas.getBoundingClientRect();

        // set internal buffer to match CSS size
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        // update our cached dimensions
        this.width = rect.width;
        this.height = rect.height;
    }


    start() {
        this.running = true;
        this.lastTime = performance.now();
        requestAnimationFrame(this.loop.bind(this));
    }

    stop() {
        this.running = false;
    }

    loop(now) {
        if (!this.running) return;
        const delta = now - this.lastTime;
        this.lastTime = now;
        this.update(delta);
        this.render();
        requestAnimationFrame(this.loop.bind(this));
    }

    update(delta) {
        // update positions, spawn new shapes, handle collisions... seventually....
        for (let shape of this.shapes) {
            shape.y += delta * 0.1;  // simple gravity... very simple
        }
        // remove off-screen shapes (Will need this when our shapes "fall off" and lose balance)
        this.shapes = this.shapes.filter(s => s.y < this.height + s.size);
    }

    render() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        for (let shape of this.shapes) {
            this.drawShape(shape);
        }
    }

    drawShape(shape) {
        const { ctx } = this;
        // Snap to integer pixels to avoid subpixel jitter
        const drawX = Math.round(shape.x);
        const drawY = Math.round(shape.y);

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.fillStyle = shape.color;
        ctx.beginPath();

        if (shape.type === 'circle') {
            ctx.arc(0, 0, shape.size, 0, Math.PI * 2);

        } else {
            // All other types use precomputed verts
            const verts = shape.verts;
            ctx.moveTo(verts[0][0], verts[0][1]);
            for (let i = 1; i < verts.length; i++) {
            ctx.lineTo(verts[i][0], verts[i][1]);
            }
            ctx.closePath();
        }

        ctx.fill();
        ctx.restore();
    }


    spawnRandomShape() {
        const types = ['circle', 'polygon', 'star', 'blob'];
        const type = types[Math.floor(Math.random() * types.length)];
        const size = 10 + Math.random() * 30;
        const x = Math.random() * (this.width  - size * 2) + size;
        const y = -size;
        const color = `hsl(${Math.random() * 360}, 70%, 50%)`;

        // Base shape object
        const shape = { x, y, size, color, type };

        if (type === 'circle') {
        // Circle only needs radius
        // nothing else to precompute  

        } else if (type === 'polygon') {
        // random 3–7 sides
        const sides = 3 + Math.floor(Math.random() * 5);
        shape.verts = [];
        for (let i = 0; i < sides; i++) {
            const angle = (Math.PI * 2 / sides) * i - Math.PI / 2;
            shape.verts.push([
            Math.cos(angle) * size,
            Math.sin(angle) * size
            ]);
        }

        } else if (type === 'star') {
        // 5-point star, random inner ratio
        const sides = 5;
        const innerRatio = 0.5 + Math.random() * 0.3;
        shape.verts = [];
        for (let i = 0; i < sides * 2; i++) {
            const angle = (Math.PI * 2 / (sides * 2)) * i - Math.PI / 2;
            const r = i % 2 === 0 ? size : size * innerRatio;
            shape.verts.push([
            Math.cos(angle) * r,
            Math.sin(angle) * r
            ]);
        }

        } else if (type === 'blob') {
        // 5–8 control points, with noise factor
        const pts = 5 + Math.floor(Math.random() * 4);
        const noise = 0.8 + Math.random() * 0.2;
        shape.verts = [];
        for (let i = 0; i < pts; i++) {
            const angle  = (Math.PI * 2 / pts) * i;
            const offset = size * (1 + (Math.random() - 0.5) * noise);
            shape.verts.push([
            Math.cos(angle) * offset,
            Math.sin(angle) * offset
            ]);
        }
        }
        this.shapes.push(shape);
    }
}

    // initialize all canvases on DOM load
    window.addEventListener('DOMContentLoaded', () => {
    const screens = document.querySelectorAll('.game-screen canvas');
    screens.forEach((canvas, i) => {
    const gs = new GameScreen(canvas.id);
    // spawn a shape, this is the time interval 
    // for testing it is constant but in the future it'll depend on when the shape is placed.
    setInterval(() => gs.spawnRandomShape(), 2000);
    gs.start();
    // store reference
    window[`gameScreen${i+1}`] = gs;
    });
});