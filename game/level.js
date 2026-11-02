import { TILE, ENEMY, PHYSICS, COLORS, CENTER_Z } from './config.js';

// Legend:
//   #  solid block          =  one-way platform (jump up through, land on top)
//   ^  spikes               o  coin
//   P  player start         E  enemy (patrols the ground it stands on)
//   B  bomber enemy (patrols and drops timed bombs)
//   C  checkpoint flag      G  goal flag
//   .  empty
export const MAP = [
  '#..................................................................................................#',
  '#..................................................................................................#',
  '#..................................................................................................#',
  '#..................................................................................................#',
  '#..................................................................................................#',
  '#.................................................o................................................#',
  '#...............................................o####..............................................#',
  '#..............................................######..............................................#',
  '#.............................................o######..............................................#',
  '#............................................########..............................................#',
  '#.................oo........................o########.................................o............#',
  '#...........oo...====......................##########....oo..........ooo.............===...........#',
  '#..............................oo...oo.....##########..======......................................#',
  '#...........##...........................############.............................##...............#',
  '#..P...ooo..##.E......oo.....C....E......############.............C.....#...E.o...........oo...G..#',
  '####################........#########################^^^^^^^^^^^^################........###########',
  '####################^^^^^^^^#####################################################^^^^^^^^###########',
];

const SKY = '#' + '.'.repeat(78) + '#';

// Frozen Peaks. Each row is split into blocks of 10 columns to keep them lined up.
export const FROST_MAP = [
  SKY, SKY, SKY, SKY, SKY, SKY, SKY, SKY, SKY, SKY,
  '#.........' + '..........' + '..........' + '......oo..' + '..........' + '..........' + '.....oo...' + '.........#',
  '#.........' + '..........' + '..........' + '.....====.' + '..........' + '..........' + '....####..' + '.........#',
  '#.........' + '......o...' + '.....oo...' + 'C.........' + '..........' + '.oo.......' + '....####..' + '.........#',
  '#.........' + '..........' + '....====##' + '####......' + '..........' + '.##.......' + '..==####..' + '.........#',
  '#..P...ooo' + '..........' + '...E....##' + '####......' + '....E.....' + '.##...C.#.' + '.E..####..' + '..ooo.G..#',
  '##########' + '#####...##' + '##########' + '####^^^^^#' + '#########.' + '.##..#####' + '########^^' + '^#########',
  '##########' + '#####...##' + '##########' + '##########' + '#########.' + '.##..#####' + '##########' + '##########',
];

// Enchanted Castle: a gentle, sparkly level with wide platforms and lots of coins.
export const CASTLE_MAP = (() => {
  const r = Array.from({ length: 17 }, () => Array(100).fill('.'));
  const put = (x, y, ch) => { r[y][x] = ch; };
  for (let y = 0; y < 17; y++) { put(0, y, '#'); put(99, y, '#'); }
  for (let x = 0; x < 100; x++) { put(x, 15, '#'); put(x, 16, '#'); }
  for (const [a, b] of [[22, 25], [48, 51], [74, 77]]) for (let x = a; x <= b; x++) { put(x, 15, '.'); put(x, 16, '.'); }
  for (const [a, b, y] of [[21, 26, 12], [47, 52, 12], [73, 78, 12], [33, 37, 11], [60, 64, 10], [86, 90, 11]]) for (let x = a; x <= b; x++) put(x, y, '=');
  put(3, 14, 'P'); put(28, 14, 'C'); put(70, 14, 'C'); put(96, 14, 'G');
  for (const x of [34, 58, 84]) put(x, 14, 'E');
  for (const x of [8, 9, 10, 15, 16, 17]) put(x, 13, 'o');
  for (const a of [22, 48, 74]) for (let x = a; x < a + 4; x++) put(x, 11, 'o');
  for (const x of [34, 35, 36]) put(x, 10, 'o');
  for (const x of [61, 62, 63]) put(x, 9, 'o');
  for (const x of [87, 88, 89]) put(x, 10, 'o');
  return r.map((row) => row.join(''));
})();

// Hellfire Pit: a molten inferno of fire and obsidian.
export const HELL_MAP = (() => {
  const r = Array.from({ length: 17 }, () => Array(100).fill('.'));
  const put = (x, y, ch) => { r[y][x] = ch; };
  for (let y = 0; y < 17; y++) { put(0, y, '#'); put(99, y, '#'); }
  for (let x = 0; x < 100; x++) { put(x, 15, '#'); put(x, 16, '#'); }
  for (const [a, b] of [[22, 25], [48, 52], [74, 77]]) {
    for (let x = a; x <= b; x++) { put(x, 15, '.'); put(x, 16, '^'); }
  }
  for (const [a, b, y] of [[12, 16, 11], [30, 34, 10], [55, 59, 10], [40, 44, 8], [65, 69, 11], [82, 86, 10]]) {
    for (let x = a; x <= b; x++) put(x, y, '=');
  }
  for (let x = 22; x <= 25; x++) put(x, 12, '#');
  for (let x = 48; x <= 52; x++) put(x, 12, '#');
  for (let x = 74; x <= 77; x++) put(x, 12, '#');
  put(3, 14, 'P');
  put(30, 14, 'C');
  put(65, 14, 'C');
  put(96, 14, 'G');
  put(20, 14, 'E');
  put(45, 14, 'E');
  put(58, 14, 'B');
  put(75, 14, 'E');
  for (const x of [5, 6, 7]) put(x, 13, 'o');
  for (const x of [13, 14, 15]) put(x, 10, 'o');
  for (const x of [31, 32, 33]) put(x, 9, 'o');
  for (const x of [41, 42, 43]) put(x, 7, 'o');
  for (const x of [56, 57, 58]) put(x, 9, 'o');
  for (const x of [66, 67, 68]) put(x, 10, 'o');
  for (const x of [83, 84, 85]) put(x, 9, 'o');
  for (const x of [88, 89, 90]) put(x, 13, 'o');
  return r.map((row) => row.join(''));
})();

// Levels play in this order. colors, groundAccel and friction override the defaults.
const LEVELS = [
  { name: 'Ember Hills', map: MAP },
  {
    name: 'Frozen Peaks',
    map: FROST_MAP,
    groundAccel: 0.35, // slippery: slower to get going...
    friction: 0.93,    // ...and slower to stop
    colors: {
      skyTop: '#0f2a47', skyBottom: '#9fd3e8', hillFar: '#6f9dbd', hillNear: '#4f7d9e',
      ground: '#7fb2cf', groundDark: '#4f86a8', grass: '#f2fbff', plank: '#a9c7d6', spike: '#e8fbff',
    },
  },
  {
    name: 'Enchanted Castle',
    map: CASTLE_MAP,
    colors: {
      skyTop: '#f7a8d8', skyBottom: '#ffe9f5', hillFar: '#d9b8f0', hillNear: '#b894e0',
      ground: '#e8b4d0', groundDark: '#c98ab4', grass: '#9be8c4', plank: '#ffd98a', spike: '#ffffff',
    },
  },
  {
    name: 'Hellfire Pit',
    map: HELL_MAP,
    colors: {
      skyTop: '#0d0000', skyBottom: '#3d0a0a', hillFar: '#2d0808', hillNear: '#1f0505',
      ground: '#2d1b0e', groundDark: '#1a0f07', grass: '#ff4500', plank: '#8b4513', spike: '#ff6600',
    },
  },
];

let current = 0;
const cached = [];

/** Choose which level getLevel() and tileAt() read. The index itself lives in state.level. */
export function setLevel(index) {
  current = index;
}

export const levelCount = () => LEVELS.length;

/** Coins across every level, for the final score. */
export const totalCoins = () => LEVELS.reduce((n, l) => n + l.map.join('').split('o').length - 1, 0);

/** Parsed content of the current level. Re-parsed whenever this module hot-reloads. */
export function getLevel() {
  if (cached[current]) return cached[current];
  const def = LEVELS[current];
  const MAP = def.map;
  const rows = MAP.length;
  const cols = Math.max(...MAP.map((r) => r.length));
  const coins = [];
  const enemies = [];
  const checkpoints = [];
  let start = { x: 2 * TILE, y: 2 * TILE };
  let goal = null;

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ch = MAP[ty][tx] ?? '.';
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      if (ch === 'o') coins.push({ id: `c_${tx}_${ty}`, x: cx, y: cy, z: CENTER_Z + Math.sin(tx * 0.45) * TILE * 2 });
      if (ch === 'P') start = { x: tx * TILE + 5, y: (ty + 1) * TILE - 28 };
      if (ch === 'C') checkpoints.push({ id: `cp_${tx}_${ty}`, tx, ty, x: tx * TILE + 5, y: (ty + 1) * TILE - 28 });
      if (ch === 'G') goal = { tx, ty, x: tx * TILE, y: ty * TILE };
      if (ch === 'E') enemies.push({ id: `e_${tx}_${ty}`, tx, ty, ...patrolBounds(tx, ty) });
      if (ch === 'B') enemies.push({ id: `e_${tx}_${ty}`, tx, ty, bomber: true, ...patrolBounds(tx, ty) });
    }
  }

  cached[current] = {
    name: def.name, rows, cols, width: cols * TILE, height: rows * TILE, coins, enemies, checkpoints, start, goal,
    colors: { ...COLORS, ...def.colors },
    groundAccel: def.groundAccel ?? PHYSICS.groundAccel,
    friction: def.friction ?? PHYSICS.friction,
  };
  return cached[current];
}

/** Tile character at tile coords. Outside the map: walls left/right, open sky above, void below. */
export function tileAt(tx, ty) {
  const map = LEVELS[current].map;
  if (tx < 0 || tx >= map[0].length) return '#';
  if (ty < 0 || ty >= map.length) return '.';
  return map[ty][tx] ?? '.';
}

export const isSolid = (ch) => ch === '#';

function patrolBounds(tx, ty) {
  const walkable = (x) => isSolid(tileAt(x, ty + 1)) && !isSolid(tileAt(x, ty)) && tileAt(x, ty + 1) !== '^';
  let l = tx;
  let r = tx;
  while (walkable(l - 1)) l--;
  while (walkable(r + 1)) r++;
  return {
    minX: l * TILE,
    maxX: (r + 1) * TILE,
    x: tx * TILE + (TILE - ENEMY.w) / 2,
    y: (ty + 1) * TILE - ENEMY.h,
  };
}
