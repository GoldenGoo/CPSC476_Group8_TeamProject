// game_matter.js
const { Engine, Render, Runner, World, Bodies, Body, Composite, Vertices, Common } = Matter;

class MatterGameScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;

    this.engine = Engine.create();
    this.world = this.engine.world;

    this.render = Render.create({
      canvas: this.canvas,
      engine: this.engine,
      options: {
        width: this.width,
        height: this.height,
        wireframes: false,
        background: '#111'
      }
    });

    // static floor and walls
    const thickness = 60;
    const walls = [
      Bodies.rectangle(this.width/2, this.height + thickness/2, this.width, thickness, { isStatic: true }),
      Bodies.rectangle(-thickness/2, this.height/2, thickness, this.height, { isStatic: true }),
      Bodies.rectangle(this.width + thickness/2, this.height/2, thickness, this.height, { isStatic: true })
    ];
    World.add(this.world, walls);

    Render.run(this.render);
    this.runner = Runner.create();
    Runner.run(this.runner, this.engine);

    // optional: set gravity
    this.engine.world.gravity.y = 1.0;

    // keep references for cleanup if needed
    this.spawnInterval = null;
  }

  // spawn a random shape as a Matter body
  spawnRandomShape() {
    const types = ['circle','polygon','star','blob'];
    const type = types[Math.floor(Math.random()*types.length)];
    const size = 20 + Math.random()*30;
    const x = Common.random(size, this.width - size);
    const y = -size;

    let body;
    if (type === 'circle') {
      body = Bodies.circle(x, y, size, { restitution: 0.2, friction: 0.1, render: { fillStyle: randomColor() }});
    } else if (type === 'polygon') {
      const sides = 3 + Math.floor(Math.random()*5);
      body = Bodies.polygon(x, y, sides, size, { restitution:0.1, friction:0.2, render:{ fillStyle: randomColor() }});
    } else if (type === 'star') {
      // build star vertex array then use fromVertices
      const verts = makeStarVertices(size, 5, 0.5 + Math.random()*0.3);
      body = Bodies.fromVertices(x, y, [verts], { restitution:0.1, friction:0.2, render:{ fillStyle: randomColor() }}, true);
    } else { // blob
      const verts = makeBlobVertices(size, 6 + Math.floor(Math.random()*3), 0.25 + Math.random()*0.3);
      body = Bodies.fromVertices(x, y, [verts], { restitution:0.05, friction:0.3, render:{ fillStyle: randomColor() }}, true);
    }

    if (body) World.add(this.world, body);
  }

  startSpawning(rateMs = 1000) {
    if (this.spawnInterval) clearInterval(this.spawnInterval);
    this.spawnInterval = setInterval(() => this.spawnRandomShape(), rateMs);
  }

  stopSpawning() {
    if (this.spawnInterval) clearInterval(this.spawnInterval);
    this.spawnInterval = null;
  }

  // cleanup if instance gets removed
  destroy() {
    this.stopSpawning();
    Render.stop(this.render);
    Runner.stop(this.runner);
    Composite.clear(this.world, false);
    Engine.clear(this.engine);
    this.render.canvas.remove();
    this.render.canvas = null;
  }
}

// helper utils
function randomColor() {
  return `hsl(${Math.floor(Math.random()*360)},70%,50%)`;
}

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
  return Vertices.clockwiseSort(verts);
}

// initialize all canvases
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.game-screen canvas').forEach((canvas) => {
    const g = new MatterGameScreen(canvas);
    g.startSpawning(900);
    // keep for debugging or network sync
    window[`matterGame_${canvas.id}`] = g;
  });
});