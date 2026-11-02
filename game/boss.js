import { TILE, CENTER_Z } from './config.js';
import { getLevel } from './level.js';
import { killPlayer } from './player.js';
import { burst } from './fx.js';

const BOSS_W = 48, BOSS_H = 48;
const PATROL_SPEED = 1.8;
const HOP_VY = -12;
const DART_SPEED = 5.5;
const MAX_HP = 3;
const Z_CHASE = 1.2;

export function createBoss() {
  const tx = 60;
  const x = tx * TILE;
  const y = 15 * TILE - BOSS_H;
  return {
    x, y, z: CENTER_Z, w: BOSS_W, h: BOSS_H,
    vx: PATROL_SPEED, vy: 0,
    hp: MAX_HP, alive: true,
    pattern: 0, patternTimer: 0,
    flashTicks: 0,
    minX: 54 * TILE, maxX: 72 * TILE,
    baseY: 15 * TILE - BOSS_H,
    onGround: true,
    respawnTimer: 0,
  };
}

export function syncBoss(state) {
  if (!state.boss) state.boss = createBoss();
  state.boss.respawnTimer ??= 0;
  state.boss.z ??= CENTER_Z;
  if (state.boss.alive) {
    state.boss.minX = 54 * TILE;
    state.boss.maxX = 72 * TILE;
  }
}

export function updateBoss(state, ctx) {
  const b = state.boss;
  if (!b) return;
  if (!b.alive) {
    if (b.respawnTimer > 0) {
      b.respawnTimer--;
      if (b.respawnTimer <= 0) {
        const p = state.player;
        const offX = -3 * TILE;
        b.x = p.x + offX;
        b.y = p.y + p.h - BOSS_H;
        b.baseY = p.y + p.h - BOSS_H;
        b.z = p.z;
        b.minX = p.x + offX - 5 * TILE;
        b.maxX = p.x + offX + 5 * TILE;
        b.hp = MAX_HP;
        b.alive = true;
        b.pattern = 0;
        b.patternTimer = 0;
        b.flashTicks = 0;
        b.vx = PATROL_SPEED;
        b.vy = 0;
        b.onGround = true;
        ctx.emit('boss_respawn', { x: Math.round(b.x), y: Math.round(b.y) });
      }
    }
    return;
  }
  const p = state.player;

  if (b.flashTicks > 0) { b.flashTicks--; return; }
  b.patternTimer++;
  b.z += Math.max(-Z_CHASE, Math.min(Z_CHASE, p.z - b.z));

  switch (b.pattern) {
    case 0: // Patrol – smooth back-and-forth
      b.vx = PATROL_SPEED;
      b.x += b.vx;
      if (b.x < b.minX) { b.x = b.minX; b.vx = PATROL_SPEED; }
      if (b.x + b.w > b.maxX) { b.x = b.maxX - b.w; b.vx = -PATROL_SPEED; }
      b.y = b.baseY;
      b.onGround = true;
      break;
    case 1: // Hopper – periodic jumps toward player
      if (!b.onGround) {
        b.vy += 0.55;
        b.y += b.vy;
        b.x += b.vx;
        b.x = Math.max(b.minX, Math.min(b.maxX - b.w, b.x));
        if (b.y >= b.baseY) { b.y = b.baseY; b.vy = 0; b.onGround = true; }
      } else {
        if (b.patternTimer % 45 === 0) {
          b.vy = HOP_VY;
          b.vx = Math.sign(p.x - b.x) * 2;
          b.onGround = false;
        }
      }
      break;
    case 2: // Dart – fast dashes with hops between
      if (b.patternTimer % 80 < 30) {
        if (b.patternTimer % 80 === 0) {
          b.vx = Math.sign(p.x - b.x) * DART_SPEED;
        }
        b.x += b.vx;
        b.x = Math.max(b.minX, Math.min(b.maxX - b.w, b.x));
        b.y = b.baseY;
        b.onGround = true;
      } else {
        if (!b.onGround) {
          b.vy += 0.55;
          b.y += b.vy;
          if (b.y >= b.baseY) { b.y = b.baseY; b.vy = 0; b.onGround = true; }
        }
        if (b.patternTimer % 80 === 50) {
          b.vy = -9;
          b.onGround = false;
        }
      }
      break;
  }

  if (!p.alive) return;

  const stompPad = 12;
  const dz = Math.abs(p.z - b.z);
  const overlapStomp = p.x < b.x + b.w + stompPad && p.x + p.w > b.x - stompPad && p.y < b.y + b.h + stompPad && p.y + p.h > b.y - stompPad && dz < (p.w + b.w) / 2 + stompPad;
  const hx = b.x + 5, hy = b.y + 5, hw = b.w - 10, hh = b.h - 10;
  const overlapHurt = p.x < hx + hw && p.x + p.w > hx && p.y < hy + hh && p.y + p.h > hy && dz < (p.w + hw) / 2;

  const prevFeet = p.y + p.h - p.vy;
  if (p.vy > 1 && prevFeet <= b.y + 6 && overlapStomp) {
    b.hp--;
    b.flashTicks = 18;
    b.pattern = (b.pattern + 1) % 3;
    b.patternTimer = 0;
    p.vy = -9;
    state.score += 100;
    burst(state, ctx, b.x + b.w / 2, b.y + b.h / 2, '#ff6d00', 26, 5);
    ctx.emit('boss_hit', { hp: b.hp, pattern: b.pattern });
    if (b.hp <= 0) {
      b.alive = false;
      b.respawnTimer = 180;
      state.score += 200;
      burst(state, ctx, b.x + b.w / 2, b.y + b.h / 2, '#ffd23f', 45, 7);
      ctx.emit('boss_defeated', { x: Math.round(b.x), y: Math.round(b.y) });
    }
  } else if (p.safeTicks <= 0 && overlapHurt) {
    killPlayer(state, ctx, 'boss', { x: Math.round(b.x), y: Math.round(b.y) });
  }
}