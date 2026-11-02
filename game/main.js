// Ember Run: the game the engine is hosting.
//
// Engine contract (see GAME.md):
//   init(ctx) -> state      fresh game state (plain JSON-safe data only)
//   migrate(state, ctx)     runs after every hot reload / resume; must be idempotent
//   update(state, input, ctx)  one fixed 60 Hz tick; deterministic (use ctx.rng)
//   render(state, g, view)  draw only; never mutate state (3D, see render.js)
//   describe(state)         compact summary recorded 10x/sec for the fixer to read

import { TILE, CENTER_Z, CHASE } from './config.js';
import { getLevel, setLevel } from './level.js';
import { createPlayer, updatePlayer } from './player.js';
import { syncEnemies, updateEnemies } from './enemies.js';
import { syncBoss, updateBoss } from './boss.js';
import { updateBullets } from './bullets.js';
import { updateHook } from './hook.js';
import { updateWorld } from './world.js';
import { updateParticles } from './fx.js';
import { renderGame } from './render.js';

export const meta = { title: 'Ember Run', width: 960, height: 540, pointerLock: true };

// Track push-to-talk (T key) for the listening orb animation.
let talking = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyT') talking = true; }, true);
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyT') talking = false; }, true);
  window.addEventListener('blur', () => { talking = false; }, true);
}

export function init(ctx) {
  setLevel(0);
  const level = getLevel();
  const state = {
    level: 0,
    coinsBanked: 0,
    bannerTicks: 0,
    player: createPlayer(level.start),
    checkpoint: null,
    checkpointsReached: {},
    coins: {},
    score: 0,
    deaths: 0,
    time: 0,
    won: false,
    runs: 1,
    enemies: [],
    particles: [],
    bullets: [],
    arrows: [],
    bombs: [],
    enemyBombs: [],
    chaseWallX: level.start.x - CHASE.startOffset * TILE,
  };
  syncEnemies(state);
  syncBoss(state);
  return state;
}

export function migrate(state, ctx) {
  state.level ??= 0;
  state.coinsBanked ??= 0;
  state.bannerTicks ??= 0;
  setLevel(state.level);
  const level = getLevel();
  state.player ??= createPlayer(level.start);
  state.player.coyote ??= 0;
  state.player.jumpBuffer ??= 0;
  state.player.airJumps ??= 1;
  state.player.jetFuel ??= 90;
  state.player.jets ??= false;
  state.player.safeTicks ??= 0;
  state.player.dashCooldown ??= 0;
  state.player.dashTicks ??= 0;
  state.player.dashX ??= 1;
  state.player.dashZ ??= 0;
  state.player.z ??= CENTER_Z;
  state.player.vz ??= 0;
  state.player.yaw ??= 0;
  state.player.pitch ??= 0;
  state.checkpoint ??= null;
  state.checkpointsReached ??= {};
  state.coins ??= {};
  state.score ??= 0;
  state.deaths ??= 0;
  state.time ??= 0;
  state.won ??= false;
  state.runs ??= 1;
  state.enemies ??= [];
  state.particles ??= [];
  state.bullets ??= [];
  state.enemyBullets ??= [];
  state.player.fireCooldown ??= 0;
  state.player.wallSide ??= 0;
  state.player.hook ??= null;
  state.player.hookRightPrev ??= false;
  state.player.bombCharge ??= -1;
  state.player.flying ??= false;
  state.player.flyTapTimer ??= 0;
  state.player.stepTimer ??= 0;
  state.player.usingBow = false;
  state.arrows ??= [];
  state.bombs ??= [];
  state.enemyBombs ??= [];
  state.chaseWallX ??= level.start.x - CHASE.startOffset * TILE;
  state.listenGlow ??= 0;
  delete state.buddy;
  delete state.buddyDelay;
  delete state.camera;
  delete state.teleportedToStart41;
  delete state.teleportedToLevel3_44;
  delete state.teleportedToLevel4_53;
  syncEnemies(state);
  syncBoss(state);
}

export function update(state, input, ctx) {
  setLevel(state.level);
  if (state.bannerTicks > 0) state.bannerTicks--;
  if (state.won) {
    if (input.pressed.KeyR) restart(state, ctx);
    updateParticles(state);
    return;
  }
  state.time += ctx.dt;
  if (talking) state.listenGlow = Math.min(1, state.listenGlow + 0.08);
  else state.listenGlow = Math.max(0, state.listenGlow - 0.04);
  updatePlayer(state, input, ctx);
  updateHook(state, input, ctx);
  updateBullets(state, input, ctx);
  updateEnemies(state, ctx);
  updateBoss(state, ctx);
  updateWorld(state, ctx);
  updateParticles(state);
}

export function render(state, g, view) {
  setLevel(state.level);
  renderGame(state, g, view);
}

export function describe(state) {
  const p = state.player;
  const r = (n) => Math.round(n);
  const r1 = (n) => Math.round(n * 10) / 10;
  const near = state.enemies
    .filter((e) => e.alive && Math.abs(e.x - p.x) < 160 && Math.abs(e.y - p.y) < 96)
    .map((e) => ({ id: e.id, dx: r(e.x - p.x), dy: r(e.y - p.y), dz: r(e.z - p.z) }));
  if (state.boss?.alive && Math.abs(state.boss.x - p.x) < 200) near.push({ id: 'boss', dx: r(state.boss.x - p.x), dy: r(state.boss.y - p.y), dz: r(state.boss.z - p.z), hp: state.boss.hp, pat: state.boss.pattern });
  return {
    level: state.level + 1,
    p: { x: r(p.x), y: r(p.y), z: r(p.z), vx: r1(p.vx), vy: r1(p.vy), vz: r1(p.vz), yawDeg: r(p.yaw * 57.3), pitchDeg: r(p.pitch * 57.3), ground: p.onGround, alive: p.alive,
         tile: [Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.y + p.h - 1) / TILE)] },
    ...(p.hook ? { hook: { phase: p.hook.phase, dist: r(p.hook.dist) } } : {}),
    coins: Object.keys(state.coins).length,
    deaths: state.deaths,
    cp: state.checkpoint?.id ?? null,
    ...(near.length ? { near } : {}),
    ...(state.won ? { won: true } : {}),
  };
}

function restart(state, ctx) {
  const runs = state.runs + 1;
  Object.assign(state, init(ctx), { runs });
}
