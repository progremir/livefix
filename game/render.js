import { TILE, COLORS, PLAYER, CORRIDOR_TILES, ENEMY } from './config.js';
import { getLevel, tileAt, isSolid, totalCoins } from './level.js';
import { RING_LIFE } from './fx.js';

// render() must only read state, never change it.
//
// The scene uses 1 unit = 1 tile. Game y points down, so the scene's y is -gameY / TILE.
const sx = (x) => x / TILE;
const sy = (y) => -y / TILE;
const sz = (z) => z / TILE;

const MAX_PARTICLES = 220;
const RING_POOL = 6;

let world = null; // this module's scene, rebuilt on every hot reload and level change

export function renderGame(state, g, view) {
  const level = getLevel();
  const gl = sharedRenderer(view);
  if (world?.levelIndex !== state.level) world = buildWorld(level, state.level);
  syncWorld(world, state, level);
  gl.render(world.scene, world.camera);
  g.drawImage(gl.domElement, 0, 0, view.w, view.h);
  drawUi(g, state, level, view.w, view.h);
}

/** One WebGL context for the page's lifetime: browsers only allow a few, and code reloads often. */
function sharedRenderer(view) {
  const T = window.THREE;
  if (!window.__emberGl) {
    const gl = new T.WebGLRenderer({ antialias: true });
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = T.PCFSoftShadowMap;
    window.__emberGl = gl;
  }
  const gl = window.__emberGl;
  gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  gl.setSize(view.w, view.h, false);
  return gl;
}

// ------------------------------------------------------------------ building the scene

function buildWorld(level, levelIndex) {
  const T = window.THREE;
  window.__emberWorld?.scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.map?.dispose();
    o.material?.dispose?.();
  });

  const C = level.colors;
  const scene = new T.Scene();
  scene.fog = new T.Fog(C.skyBottom, 14, 70);

  const camera = new T.PerspectiveCamera(78, 16 / 9, 0.03, 400);
  scene.add(camera);

  const sky = new T.Mesh(
    new T.SphereGeometry(300, 24, 16),
    new T.MeshBasicMaterial({ map: gradientTexture(C.skyTop, C.skyBottom), side: T.BackSide, fog: false }),
  );
  scene.add(sky);

  scene.add(new T.HemisphereLight(C.skyBottom, C.groundDark, 1.6));
  const sun = new T.DirectionalLight('#fff4e0', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  addTerrain(scene, level, C);
  addCanyonWalls(scene, level, C);
  addGraffiti(scene, level);

  const coins = new T.InstancedMesh(
    new T.CylinderGeometry(0.28, 0.28, 0.07, 20).rotateX(Math.PI / 2),
    new T.MeshStandardMaterial({ color: COLORS.coin, emissive: COLORS.coinEdge, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.35 }),
    Math.max(1, level.coins.length),
  );
  coins.frustumCulled = false;
  scene.add(coins);

  const flags = level.checkpoints.map((cp) => {
    const flag = makeFlag(scene, sx(cp.tx * TILE + TILE / 2), sy((cp.ty + 1) * TILE), '#9aa0b4', 1.6);
    return { id: cp.id, ...flag };
  });
  if (level.goal) {
    makeFlag(scene, sx(level.goal.x + TILE / 2), sy(level.goal.y + TILE), COLORS.flag, 2.8);
    const beam = new T.Mesh(
      new T.BoxGeometry(0.5, 60, CORRIDOR_TILES),
      new T.MeshBasicMaterial({ color: COLORS.coin, transparent: true, opacity: 0.16, depthWrite: false, fog: false }),
    );
    beam.position.set(sx(level.goal.x + TILE / 2), sy(level.goal.y) + 26, CORRIDOR_TILES / 2);
    scene.add(beam);
  }

  const particles = new T.InstancedMesh(new T.BoxGeometry(0.09, 0.09, 0.09), new T.MeshBasicMaterial(), MAX_PARTICLES);
  particles.frustumCulled = false;
  scene.add(particles);

  const bullets = new T.InstancedMesh(new T.BoxGeometry(0.14, 0.14, 0.14), new T.MeshBasicMaterial({ color: '#ffaa00', fog: false }), 32);
  bullets.frustumCulled = false;
  bullets.count = 0;
  scene.add(bullets);

  const arrowMesh = new T.InstancedMesh(new T.BoxGeometry(0.06, 0.06, 0.35), new T.MeshBasicMaterial({ color: '#c8a86c', fog: false }), 32);
  arrowMesh.frustumCulled = false;
  arrowMesh.count = 0;
  scene.add(arrowMesh);

  const bombMesh = new T.InstancedMesh(new T.SphereGeometry(0.12, 8, 6), new T.MeshBasicMaterial({ color: '#333333', fog: false }), 8);
  bombMesh.frustumCulled = false;
  bombMesh.count = 0;
  scene.add(bombMesh);

  const enemyBombMesh = new T.InstancedMesh(new T.SphereGeometry(0.14, 8, 6), new T.MeshBasicMaterial({ color: '#ff2200', fog: false }), 16);
  enemyBombMesh.frustumCulled = false;
  enemyBombMesh.count = 0;
  scene.add(enemyBombMesh);

  const enemyBullets = new T.InstancedMesh(new T.SphereGeometry(0.12, 8, 6), new T.MeshBasicMaterial({ color: '#ff2255', fog: false }), 64);
  enemyBullets.frustumCulled = false;
  enemyBullets.count = 0;
  scene.add(enemyBullets);

  const ropeGeo = new T.CylinderGeometry(0.1, 0.1, 1, 8);
  const ropeMat = new T.MeshBasicMaterial({ color: '#ffffff', fog: false });
  const rope = new T.Mesh(ropeGeo, ropeMat);
  rope.visible = false;
  scene.add(rope);

  const rings = Array.from({ length: RING_POOL }, () => {
    const ring = new T.Mesh(new T.TorusGeometry(1, 0.05, 8, 32).rotateX(Math.PI / 2), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true }));
    ring.visible = false;
    scene.add(ring);
    return ring;
  });

  // Invisible, but it casts the shadow that shows where the player will land.
  const body = new T.Mesh(
    new T.BoxGeometry(sx(PLAYER.w), sx(PLAYER.h), sx(PLAYER.w)),
    new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  body.castShadow = true;
  scene.add(body);

  const chaseWall = new T.Mesh(
    new T.BoxGeometry(0.3, 200, CORRIDOR_TILES),
    new T.MeshStandardMaterial({ color: '#ff3300', emissive: '#ff2200', emissiveIntensity: 0.8, roughness: 0.3, fog: false }),
  );
  chaseWall.visible = false;
  scene.add(chaseWall);

  const built = {
    levelIndex, scene, camera, sky, sun, coins, flags, particles, rings, body, bullets, enemyBullets, arrows: arrowMesh, bombs: bombMesh, rope, chaseWall,
    enemies: new Map(),
    boss: makeBoss(scene),
    arms: makeArms(camera),
    rifle: makeRifle(camera),
    bow: makeBow(camera),
    enemyBombs: enemyBombMesh,
    matrix: new T.Matrix4(),
    color: new T.Color(),
  };
  window.__emberWorld = built;
  return built;
}

function gradientTexture(top, bottom) {
  const T = window.THREE;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, bottom);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

/** A soft grey speckle. Multiplied with each block's color, it shows speed as you run. */
function speckleTexture() {
  const T = window.THREE;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 140; i++) {
    const a = 0.02 + ((i * 37) % 10) / 180;
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect((i * 29) % 64, (i * 53) % 64, 1 + (i % 2), 1 + (i % 2));
  }
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 64, 64);
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

/** Draws many copies of one shape. Each item is { x, y, z, w, h, d, color } in scene units. */
function addInstances(scene, geometry, material, items, { shadow = true } = {}) {
  if (!items.length) return;
  const T = window.THREE;
  const mesh = new T.InstancedMesh(geometry, material, items.length);
  const m = new T.Matrix4();
  const color = new T.Color();
  items.forEach((it, i) => {
    m.makeScale(it.w, it.h, it.d).setPosition(it.x, it.y, it.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.set(it.color).multiplyScalar(it.shade ?? 1));
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addTerrain(scene, level, C) {
  const T = window.THREE;
  const dirt = [], topping = [], planks = [], spikes = [];
  const open = (tx, ty) => !isSolid(tileAt(tx, ty));

  for (let ty = 0; ty < level.rows; ty++) {
    for (let tx = 0; tx < level.cols; tx++) {
      const ch = tileAt(tx, ty);
      const x = tx + 0.5, top = -ty;
      for (let lane = 0; lane < CORRIDOR_TILES; lane++) {
        const z = lane + 0.5;
        const shade = (tx + lane + ty) % 2 ? 1 : 0.86;
        if (ch === '#' && (open(tx, ty - 1) || open(tx, ty + 1) || open(tx - 1, ty) || open(tx + 1, ty))) {
          dirt.push({ x, y: top - 0.5, z, w: 1, h: 1, d: 1, color: C.ground, shade });
          if (open(tx, ty - 1)) topping.push({ x, y: top - 0.11, z, w: 1.002, h: 0.24, d: 1.002, color: C.grass, shade });
        } else if (ch === '=') {
          planks.push({ x, y: top - 0.125, z, w: 1, h: 0.25, d: 1, color: C.plank, shade });
        } else if (ch === '^') {
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
            spikes.push({ x: tx + 0.25 + a * 0.5, y: top - 0.75, z: lane + 0.25 + b * 0.5, w: 1, h: 1, d: 1, color: C.spike });
          }
        }
      }
    }
  }

  const blockMaterial = new T.MeshStandardMaterial({ map: speckleTexture(), roughness: 0.92 });
  const cube = new T.BoxGeometry(1, 1, 1);
  addInstances(scene, cube, blockMaterial, dirt);
  addInstances(scene, cube, blockMaterial, topping);
  addInstances(scene, cube, blockMaterial, planks);
  addInstances(scene, new T.ConeGeometry(0.2, 0.5, 8), new T.MeshStandardMaterial({ metalness: 0.5, roughness: 0.35 }), spikes);
}

function addCanyonWalls(scene, level, C) {
  const T = window.THREE;
  const height = 90, thick = 2;
  const box = (w, d, x, z, color, repeatX) => {
    const map = speckleTexture();
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.repeat.set(repeatX, height / 2);
    // A little of its own glow, so dark levels still show where the walls are.
    const wall = new T.Mesh(new T.BoxGeometry(w, height, d), new T.MeshStandardMaterial({ map, color, emissive: color, emissiveIntensity: 0.9, roughness: 1 }));
    wall.position.set(x, -level.rows + height / 2 - 12, z);
    wall.receiveShadow = true;
    scene.add(wall);
  };
  box(level.cols + thick * 2, thick, level.cols / 2, -thick / 2, C.hillNear, level.cols / 2);
  box(level.cols + thick * 2, thick, level.cols / 2, CORRIDOR_TILES + thick / 2, C.hillFar, level.cols / 2);
  box(thick, CORRIDOR_TILES, -thick / 2, CORRIDOR_TILES / 2, C.hillNear, 3);
  box(thick, CORRIDOR_TILES, level.cols + thick / 2, CORRIDOR_TILES / 2, C.hillNear, 3);
}

function graffitiTexture() {
  const T = window.THREE;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,50,150,0.65)';
  g.beginPath(); g.arc(55, 70, 22, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(50,255,120,0.75)';
  g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(110, 45); g.lineTo(135, 30); g.lineTo(155, 50); g.lineTo(175, 35); g.stroke();
  g.fillStyle = 'rgba(255,210,0,0.55)';
  g.beginPath(); g.ellipse(195, 130, 18, 26, 0.3, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(100,160,255,0.7)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(30, 170); g.lineTo(70, 150); g.lineTo(90, 180); g.stroke();
  g.fillStyle = 'rgba(255,80,80,0.7)';
  g.beginPath();
  g.moveTo(155, 195);
  g.bezierCurveTo(155, 185, 140, 185, 140, 195);
  g.bezierCurveTo(140, 205, 155, 215, 155, 215);
  g.bezierCurveTo(155, 215, 170, 205, 170, 195);
  g.bezierCurveTo(170, 185, 155, 185, 155, 195);
  g.fill();
  g.fillStyle = 'rgba(255,50,150,0.35)';
  g.fillRect(50, 90, 3, 28); g.fillRect(60, 92, 2, 20);
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function addGraffiti(scene, level) {
  const T = window.THREE;
  const tex = graffitiTexture();
  const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, side: T.DoubleSide, fog: true, depthWrite: false });
  const geo = new T.PlaneGeometry(2.5, 2.5);
  const n = Math.max(4, Math.floor(level.cols / 10));
  for (let i = 0; i < n; i++) {
    const x = Math.floor(i * (level.cols / n) + 2) + 0.5;
    const y = -Math.floor(level.rows * 0.4) - (i % 3);
    const s = 0.8 + (i % 4) * 0.3;
    const left = new T.Mesh(geo, mat);
    left.position.set(x, y, 0.05);
    left.scale.setScalar(s);
    scene.add(left);
    const right = new T.Mesh(geo, mat);
    right.position.set(x + 3 + (i % 5), y + 1, CORRIDOR_TILES - 0.05);
    right.rotation.y = Math.PI;
    right.scale.setScalar(s * 0.8);
    scene.add(right);
  }
}

function makeFlag(scene, x, groundY, color, height) {
  const T = window.THREE;
  const z = CORRIDOR_TILES / 2;
  const pole = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, height, 10), new T.MeshStandardMaterial({ color: '#e5e5e5' }));
  pole.position.set(x, groundY + height / 2, z);
  pole.castShadow = true;
  scene.add(pole);

  const shape = new T.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(height * 0.42, -height * 0.13);
  shape.lineTo(0, -height * 0.26);
  shape.closePath();
  const material = new T.MeshStandardMaterial({ color, side: T.DoubleSide, emissive: color, emissiveIntensity: 0.35 });
  const flag = new T.Mesh(new T.ShapeGeometry(shape), material);
  flag.position.set(x, groundY + height, z);
  scene.add(flag);
  return { flag, material };
}

function makeEnemy(scene) {
  const T = window.THREE;
  const group = new T.Group();
  const bodyMaterial = new T.MeshStandardMaterial({ color: COLORS.enemy, roughness: 0.55 });
  const body = new T.Mesh(new T.SphereGeometry(0.5, 20, 14), bodyMaterial);
  body.scale.set(sx(ENEMY.w), sx(ENEMY.h), sx(ENEMY.w));
  body.castShadow = true;
  group.add(body);
  addEyes(group, 0.13, 0.09, 0.36, 0.1);
  scene.add(group);
  return { group, bodyMaterial };
}

function addEyes(group, spread, height, forward, size) {
  const T = window.THREE;
  const white = new T.MeshBasicMaterial({ color: '#ffffff' });
  const dark = new T.MeshBasicMaterial({ color: '#111111' });
  for (const side of [-1, 1]) {
    const eye = new T.Mesh(new T.SphereGeometry(size, 12, 10), white);
    eye.position.set(side * spread, height, forward);
    const pupil = new T.Mesh(new T.SphereGeometry(size * 0.5, 10, 8), dark);
    pupil.position.set(side * spread, height, forward + size * 0.72);
    group.add(eye, pupil);
  }
}

function makeBoss(scene) {
  const T = window.THREE;
  const group = new T.Group();
  const bodyMaterial = new T.MeshStandardMaterial({ color: '#d84315', roughness: 0.5 });
  const body = new T.Mesh(new T.SphereGeometry(0.76, 24, 16), bodyMaterial);
  body.castShadow = true;
  group.add(body);
  addEyes(group, 0.27, 0.2, 0.55, 0.18);
  const brow = new T.MeshBasicMaterial({ color: '#4e2600' });
  for (const side of [-1, 1]) {
    const b = new T.Mesh(new T.BoxGeometry(0.38, 0.07, 0.07), brow);
    b.position.set(side * 0.27, 0.42, 0.68);
    b.rotation.z = side * 0.35;
    group.add(b);
  }
  const hearts = [-0.42, 0, 0.42].map((x) => {
    const heart = new T.Mesh(new T.BoxGeometry(0.34, 0.14, 0.14), new T.MeshBasicMaterial({ color: '#ff5252', fog: false }));
    heart.position.set(x, 1.05, 0);
    group.add(heart);
    return heart;
  });
  group.visible = false;
  scene.add(group);
  return { group, bodyMaterial, hearts };
}

/** First-person arms. They hang off the camera, so they stay on screen. */
function makeArms(camera) {
  const T = window.THREE;
  const sleeve = new T.MeshStandardMaterial({ color: COLORS.player, roughness: 0.7 });
  const hand = new T.MeshStandardMaterial({ color: COLORS.playerDark, roughness: 0.7 });
  const flame = new T.MeshBasicMaterial({ color: '#ff8a00', fog: false });
  const make = (side) => {
    const pivot = new T.Group();
    const arm = new T.Mesh(new T.CapsuleGeometry(0.04, 0.3, 4, 10).rotateX(Math.PI / 2), sleeve);
    arm.position.z = -0.16;
    const fist = new T.Mesh(new T.SphereGeometry(0.055, 12, 10), hand);
    fist.position.z = -0.35;
    const jet = new T.Mesh(new T.ConeGeometry(0.05, 0.2, 10).rotateX(Math.PI), flame);
    jet.position.set(side * 0.05, -0.1, -0.1);
    pivot.add(arm, fist, jet);
    camera.add(pivot);
    return { pivot, jet, side };
  };
  return [make(-1), make(1)];
}

/** First-person AK-style rifle attached to the camera. */
function makeRifle(camera) {
  const T = window.THREE;
  const group = new T.Group();
  const metal = new T.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.35, metalness: 0.75 });
  const wood = new T.MeshStandardMaterial({ color: '#6b3a1f', roughness: 0.8 });

  // Receiver
  const receiver = new T.Mesh(new T.BoxGeometry(0.056, 0.064, 0.6), metal);
  receiver.position.set(0, 0, -0.4);
  group.add(receiver);

  // Barrel
  const barrel = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, 0.4, 8).rotateX(Math.PI / 2), metal);
  barrel.position.set(0, 0.015, -0.9);
  group.add(barrel);

  // Muzzle brake
  const muzzle = new T.Mesh(new T.BoxGeometry(0.032, 0.032, 0.07), metal);
  muzzle.position.set(0, 0.015, -1.14);
  group.add(muzzle);

  // Gas tube
  const gasTube = new T.Mesh(new T.CylinderGeometry(0.01, 0.01, 0.32, 8).rotateX(Math.PI / 2), metal);
  gasTube.position.set(0, 0.052, -0.8);
  group.add(gasTube);

  // Front sight post
  const sight = new T.Mesh(new T.BoxGeometry(0.01, 0.05, 0.01), metal);
  sight.position.set(0, 0.08, -0.7);
  group.add(sight);

  // Curved magazine (angled box)
  const mag = new T.Mesh(new T.BoxGeometry(0.036, 0.15, 0.07), metal);
  mag.position.set(0, -0.1, -0.35);
  mag.rotation.x = 0.3;
  group.add(mag);

  // Stock
  const stock = new T.Mesh(new T.BoxGeometry(0.044, 0.056, 0.26), wood);
  stock.position.set(0, -0.006, 0.05);
  group.add(stock);

  // Handguard
  const handguard = new T.Mesh(new T.BoxGeometry(0.052, 0.056, 0.2), wood);
  handguard.position.set(0, -0.006, -0.72);
  group.add(handguard);

  // Position: lower-right, held naturally
  group.position.set(0.1, -0.1, -0.15);
  group.rotation.set(0.1, 0.04, -0.015);

  camera.add(group);
  return { group };
}

/** First-person bow attached to the camera. */
function makeBow(camera) {
  const T = window.THREE;
  const group = new T.Group();
  const wood = new T.MeshStandardMaterial({ color: '#8b5e3c', roughness: 0.7 });
  const stringMat = new T.MeshBasicMaterial({ color: '#e0e0e0', fog: false });

  const arc = new T.Mesh(
    new T.TorusGeometry(0.22, 0.014, 6, 16, Math.PI * 1.1),
    wood
  );
  arc.rotation.z = Math.PI * 0.95;
  group.add(arc);

  const str = new T.Mesh(
    new T.CylinderGeometry(0.003, 0.003, 0.34, 4).rotateZ(Math.PI / 2),
    stringMat
  );
  str.position.set(0.03, 0, 0);
  group.add(str);

  group.position.set(0.08, -0.08, -0.3);
  group.visible = false;

  camera.add(group);
  return { group };
}

// ------------------------------------------------------------------ syncing state to the scene

function syncWorld(w, state, level) {
  const p = state.player;
  const t = state.time;
  const { matrix } = w;
  const speed = Math.hypot(p.vx, p.vz);

  // Camera: eyes near the top of the player's box, with a small run bob and a landing dip.
  const stride = p.onGround ? Math.sin(t * 13) * Math.min(1, speed / 4) : 0;
  const eyeY = p.alive ? p.y + PLAYER.eye + stride * 0.7 + Math.max(0, p.squash) * 9 : p.y + p.h - 4;
  const cx = sx(p.x + p.w / 2), cy = sy(eyeY), cz = sz(p.z);
  const cosP = Math.cos(p.pitch);
  w.camera.position.set(cx, cy, cz);
  w.camera.lookAt(cx + Math.cos(p.yaw) * cosP, cy + Math.sin(p.pitch), cz + Math.sin(p.yaw) * cosP);
  if (p.wallSide !== 0) w.camera.rotateZ(p.wallSide * Math.cos(p.yaw) * 0.15);
  const fov = p.dashTicks > 0 ? 92 : 78;
  if (w.camera.fov !== fov) {
    w.camera.fov = fov;
    w.camera.updateProjectionMatrix();
  }
  w.sky.position.copy(w.camera.position);

  w.sun.position.set(cx - 5, cy + 30, cz + 7);
  w.sun.target.position.set(cx, cy, cz);
  w.body.position.set(cx, sy(p.y + p.h / 2), cz);
  w.body.visible = p.alive;

  // Chase wall
  if (state.chaseWallX !== null) {
    w.chaseWall.visible = true;
    w.chaseWall.position.set(sx(state.chaseWallX), 50, CORRIDOR_TILES / 2);
    w.chaseWall.material.emissiveIntensity = 0.6 + Math.sin(state.time * 4) * 0.3;
  } else {
    w.chaseWall.visible = false;
  }

  // Wall lean: arms and gun shift toward the wall when wall-running
  const wallLean = p.wallSide !== 0 ? p.wallSide * 0.045 : 0;
  const wallTuck = p.wallSide !== 0 ? 0.4 : 1;
  const hookActive = p.hook !== null;

  for (const arm of w.arms) {
    const lift = p.onGround ? 0 : 0.02;
    // Running swing: arms bob in opposite phases, scaled by speed
    const runSwing = p.onGround ? Math.sin(t * 13) * Math.min(1, speed / 4) * 0.06 * arm.side * wallTuck : 0;
    const runFwd = p.onGround ? Math.cos(t * 13) * Math.min(1, speed / 4) * 0.04 * arm.side * wallTuck : 0;
    // Jump pump: arms rise when going up, drop when falling
    const jumpLift = !p.onGround ? (p.vy < 0 ? -0.12 : 0.08) : 0;
    const ax = arm.side === 1 ? 0.05 : -0.01;
    const ay = -0.055 + lift;
    const az = arm.side === 1 ? 0.02 : -0.06;
    arm.pivot.visible = p.alive;
    // Reach from the shoulder (off screen) to the rifle: right hand on the grip, left under the handguard.
    const gp = w.rifle.group.position;
    const hzOff = arm.side === 1 ? (hookActive ? -0.55 : -0.2) : -0.72;
    const hx = gp.x + (arm.side === 1 ? 0 : -0.005), hy = gp.y + (arm.side === 1 ? -0.075 : -0.065), hz = gp.z + hzOff;
    const sxp = arm.side * 0.14 + wallLean, syp = -0.32 + runSwing + jumpLift, szp = 0.1 + runFwd;
    const dx = hx - sxp, dy = hy - syp, dz = hz - szp;
    const len = Math.hypot(dx, dy, dz);
    arm.pivot.position.set(sxp, syp, szp);
    arm.pivot.rotation.order = 'YXZ';
    arm.pivot.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0);
    arm.pivot.scale.set(1.6, 1.6, len / 0.35);
    arm.jet.visible = !!p.jets;
    arm.jet.scale.setScalar(1 + Math.sin(t * 40 + arm.side) * 0.2);
  }

  // Rifle sway and recoil
  const recoil = p.fireCooldown > 4 ? (p.fireCooldown - 4) * 0.003 : 0;
  const swayX = Math.sin(t * 7) * 0.0015 * Math.min(1, speed / 3) * wallTuck;
  const swayY = Math.cos(t * 9) * 0.001 * Math.min(1, speed / 3) * wallTuck;
  const jumpDip = !p.onGround ? (p.vy < 0 ? -0.08 : 0.05) : 0;
  const hookDip = hookActive ? -0.08 : 0;
  const hookTilt = hookActive ? 0.35 : 0;
  w.rifle.group.position.set(0.1 + swayX + wallLean, -0.1 + swayY + recoil + jumpDip + hookDip, -0.15 - recoil * 2.5);
  w.rifle.group.rotation.set(0.1 - recoil * 0.4 + jumpDip * 0.5 + hookTilt, 0.04, -0.015 + p.wallSide * 0.06);
  w.rifle.group.visible = p.alive && !hookActive && !p.usingBow;
  w.bow.group.visible = p.alive && !hookActive && p.usingBow;

  // Grapple rope
  const hook = p.hook;
  if (hook) {
    w.rope.visible = true;
    const hx = hook.phase === 'flying' ? hook.x : hook.ax;
    const hy = hook.phase === 'flying' ? hook.y : hook.ay;
    const hz = hook.phase === 'flying' ? hook.z : hook.az;
    const px3 = sx(p.x + p.w / 2), py3 = sy(p.y + PLAYER.eye), pz3 = sz(p.z);
    const dx = sx(hx) - px3, dy = sy(hy) - py3, dz = sz(hz) - pz3;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    w.rope.position.set(px3 + dx / 2, py3 + dy / 2, pz3 + dz / 2);
    w.rope.scale.set(1, Math.max(0.01, len), 1);
    if (len > 0.001) {
      const V3 = window.THREE.Vector3;
      w.rope.quaternion.setFromUnitVectors(new V3(0, 1, 0), new V3(dx, dy, dz).normalize());
    }
  } else {
    w.rope.visible = false;
  }

  level.coins.forEach((c, i) => {
    const y = sy(c.y + Math.sin(t * 3 + c.x * 0.05) * 3);
    const scale = state.coins[c.id] ? 0 : 1;
    matrix.makeRotationY(t * 3 + c.x * 0.01).scale({ x: scale, y: scale, z: scale }).setPosition(sx(c.x), y, sz(c.z));
    w.coins.setMatrixAt(i, matrix);
  });
  w.coins.instanceMatrix.needsUpdate = true;

  for (const f of w.flags) {
    const reached = state.checkpointsReached[f.id];
    f.material.color.set(reached ? COLORS.flagReached : '#9aa0b4');
    f.material.emissive.copy(f.material.color);
  }

  syncEnemies(w, state);
  syncBoss(w, state);
  syncParticles(w, state);
  syncBullets(w, state);
}

function faceCamera(group, camera) {
  group.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
}

function syncEnemies(w, state) {
  const seen = new Set();
  for (const e of state.enemies) {
    seen.add(e.id);
    if (!w.enemies.has(e.id)) w.enemies.set(e.id, makeEnemy(w.scene));
    const { group } = w.enemies.get(e.id);
    group.visible = e.alive;
    if (!e.alive) continue;
    const bob = Math.abs(Math.sin(state.time * 8 + e.x * 0.1)) * 2;
    group.position.set(sx(e.x + e.w / 2), sy(e.y + e.h / 2 - bob), sz(e.z));
    faceCamera(group, w.camera);
  }
  for (const [id, enemy] of w.enemies) if (!seen.has(id)) enemy.group.visible = false;
}

function syncBoss(w, state) {
  const b = state.boss;
  const { group, bodyMaterial, hearts } = w.boss;
  group.visible = !!b?.alive;
  if (!group.visible) return;
  group.position.set(sx(b.x + b.w / 2), sy(b.y + b.h / 2 + Math.sin(state.time * 4) * 3), sz(b.z));
  faceCamera(group, w.camera);
  bodyMaterial.color.set(b.flashTicks > 0 && Math.floor(b.flashTicks / 3) % 2 ? '#ffffff' : '#d84315');
  hearts.forEach((heart, i) => { heart.visible = i < b.hp; });
}

function syncParticles(w, state) {
  const { matrix, color, particles, rings } = w;
  let n = 0;
  let r = 0;
  for (const q of state.particles) {
    const z = sz(q.z ?? state.player.z);
    if (q.ring) {
      const ring = rings[r++];
      if (!ring) continue;
      const age = 1 - q.life / RING_LIFE;
      ring.visible = true;
      ring.position.set(sx(q.x), sy(q.y), z);
      ring.scale.setScalar(0.25 + age * 1.1);
      ring.material.opacity = q.life / RING_LIFE;
      continue;
    }
    if (n >= MAX_PARTICLES) continue;
    const s = Math.min(1, q.life / 20);
    matrix.makeScale(s, s, s).setPosition(sx(q.x), sy(q.y), z);
    particles.setMatrixAt(n, matrix);
    particles.setColorAt(n, color.set(q.color));
    n++;
  }
  particles.count = n;
  particles.instanceMatrix.needsUpdate = true;
  if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
  for (; r < rings.length; r++) rings[r].visible = false;
}

function syncBullets(w, state) {
  const { matrix, bullets } = w;
  let n = 0;
  for (const b of state.bullets) {
    if (n >= 32) break;
    matrix.makeScale(1, 1, 1).setPosition(sx(b.x), sy(b.y), sz(b.z));
    bullets.setMatrixAt(n, matrix);
    n++;
  }
  bullets.count = n;
  bullets.instanceMatrix.needsUpdate = true;
  const eb = w.enemyBullets;
  if (eb) {
    let m = 0;
    for (const b of state.enemyBullets ?? []) {
      if (m >= 64) break;
      matrix.makeScale(1, 1, 1).setPosition(sx(b.x), sy(b.y), sz(b.z));
      eb.setMatrixAt(m++, matrix);
    }
    eb.count = m;
    eb.instanceMatrix.needsUpdate = true;
  }

  if (w.arrows) {
    let an = 0;
    for (const a of state.arrows ?? []) {
      if (an >= 32) break;
      matrix.makeScale(1, 1, 1).setPosition(sx(a.x), sy(a.y), sz(a.z));
      w.arrows.setMatrixAt(an++, matrix);
    }
    w.arrows.count = an;
    w.arrows.instanceMatrix.needsUpdate = true;
  }

  if (w.bombs) {
    let bn = 0;
    for (const b of state.bombs ?? []) {
      if (bn >= 8) break;
      matrix.makeScale(1, 1, 1).setPosition(sx(b.x), sy(b.y), sz(b.z));
      w.bombs.setMatrixAt(bn++, matrix);
    }
    w.bombs.count = bn;
    w.bombs.instanceMatrix.needsUpdate = true;
  }

  if (w.enemyBombs) {
    let en = 0;
    for (const eb of state.enemyBombs ?? []) {
      if (en >= 16) break;
      const urgency = 1 - eb.fuse / 90;
      const sc = 1 + urgency * 0.5;
      matrix.makeScale(sc, sc, sc).setPosition(sx(eb.x), sy(eb.y), sz(eb.z));
      w.enemyBombs.setMatrixAt(en, matrix);
      w.enemyBombs.setColorAt(en, w.color.set('#ff2200').multiplyScalar(0.6 + urgency * 0.8));
      en++;
    }
    w.enemyBombs.count = en;
    w.enemyBombs.instanceMatrix.needsUpdate = true;
    if (w.enemyBombs.instanceColor) w.enemyBombs.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ 2D overlay

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}

function drawUi(g, state, level, w, h) {
  const p = state.player;
  const coins = Object.keys(state.coins).length;

  // Crosshair
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect(w / 2 - 1, h / 2 - 7, 2, 14);
  g.fillRect(w / 2 - 7, h / 2 - 1, 14, 2);

  if (!p.alive) {
    g.fillStyle = 'rgba(160,20,10,0.45)';
    g.fillRect(0, 0, w, h);
  } else if (p.safeTicks > 0) {
    g.strokeStyle = `rgba(120,220,255,${0.25 + 0.25 * Math.sin(state.time * 10)})`;
    g.lineWidth = 10;
    g.strokeRect(0, 0, w, h);
  }

  g.font = 'bold 18px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(g, 12, 12, 290, 34, 10);
  g.fillStyle = COLORS.coin;
  g.beginPath();
  g.arc(32, 29, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.text;
  g.fillText(`${coins}/${level.coins.length}`, 48, 30);
  g.fillText(`✖ ${state.deaths}`, 125, 30);
  const m = Math.floor(state.time / 60), s = (state.time % 60).toFixed(1).padStart(4, '0');
  g.fillText(`${m}:${s}`, 205, 30);

  if (state.bannerTicks > 0) {
    g.globalAlpha = Math.min(1, state.bannerTicks / 30);
    g.textAlign = 'center';
    g.font = 'bold 40px system-ui, sans-serif';
    g.fillText(`Level ${state.level + 1}: ${level.name}`, w / 2, h * 0.3);
    g.textAlign = 'left';
    g.globalAlpha = 1;
  }

  const hint = document.pointerLockElement
    ? 'WASD move · Space jump · Shift jet · X dash · Right-click grapple · double-tap Space to fly'
    : 'Click the game to look around · Q/E also turn';
  g.font = 'bold 14px system-ui, sans-serif';
  const hintW = g.measureText(hint).width + 20;
  g.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(g, 10, h - 32, hintW, 24, 6);
  g.fillStyle = '#fff';
  g.fillText(hint, 20, h - 19);

  // Listening orb (push-to-talk)
  if (state.listenGlow > 0.01) {
    const glow = state.listenGlow;
    const ocx = w / 2, ocy = h - 58;
    const pulse = 1 + Math.sin(state.time * 6) * 0.12 * glow;
    const r = 14 * glow * pulse;
    const grad = g.createRadialGradient(ocx, ocy, 0, ocx, ocy, r * 2.5);
    grad.addColorStop(0, `rgba(100,220,255,${0.5 * glow})`);
    grad.addColorStop(0.5, `rgba(80,180,255,${0.2 * glow})`);
    grad.addColorStop(1, 'rgba(80,180,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(ocx, ocy, r * 2.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(180,240,255,${0.9 * glow})`;
    g.beginPath(); g.arc(ocx, ocy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(255,255,255,${0.8 * glow})`;
    g.beginPath(); g.arc(ocx, ocy - r * 0.2, r * 0.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(100,220,255,${0.6 * glow})`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(ocx, ocy, r + 4 + Math.sin(state.time * 4) * 2, 0, Math.PI * 2); g.stroke();
  }

  // Bomb charge animation (holding F)
  if (p.bombCharge >= 0) {
    const charge = p.bombCharge / 60;
    const bcx = w - 70, bcy = h - 70;
    const baseR = 12 + charge * 14;
    const pulse = 1 + Math.sin(state.time * 14) * 0.08 * charge;
    const br = baseR * pulse;
    const grad2 = g.createRadialGradient(bcx, bcy, 0, bcx, bcy, br * 2);
    grad2.addColorStop(0, `rgba(255,100,30,${0.4 + charge * 0.3})`);
    grad2.addColorStop(1, 'rgba(255,100,30,0)');
    g.fillStyle = grad2;
    g.beginPath(); g.arc(bcx, bcy, br * 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(50,50,50,${0.7 + charge * 0.3})`;
    g.beginPath(); g.arc(bcx, bcy, br, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(255,${180 + Math.sin(state.time * 20) * 75 | 0},0,0.9)`;
    g.beginPath(); g.arc(bcx, bcy - br - 3, 3 + charge * 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(255,140,0,0.8)`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(bcx, bcy, br + 6, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
    g.stroke();
  }

  if (state.won) {
    g.fillStyle = 'rgba(10,10,30,0.7)';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.fillStyle = COLORS.text;
    g.font = 'bold 44px system-ui, sans-serif';
    g.fillText('You made it!', w / 2, h / 2 - 40);
    g.font = '20px system-ui, sans-serif';
    g.fillText(`${state.coinsBanked + coins}/${totalCoins()} coins · ${state.deaths} deaths · ${m}:${s}`, w / 2, h / 2 + 10);
    g.fillText('Press R to run again', w / 2, h / 2 + 50);
    g.textAlign = 'left';
  }
}
