import { TILE, CORRIDOR_DEPTH, HOOK, PLAYER } from './config.js';
import { tileAt, isSolid, getLevel } from './level.js';

export function updateHook(state, input, ctx) {
  const p = state.player;
  if (!p.alive) { p.hook = null; return; }

  const mouse = typeof window !== 'undefined' ? window.__emberMouse : null;
  const hookDown = (mouse?.rightDown ?? false) || !!input.down.KeyH;
  const hookPressed = hookDown && !p.hookRightPrev;
  p.hookRightPrev = hookDown;

  // Toggle: press fires a new hook, or releases an attached one
  if (hookPressed) {
    if (p.hook && p.hook.phase === 'attached') {
      if (p.vy > 0) p.vy *= 0.6;
      p.hook = null;
      ctx.emit('hook_release', { x: Math.round(p.x), y: Math.round(p.y) });
    } else if (!p.hook) {
      const cosP = Math.cos(p.pitch);
      const dirX = Math.cos(p.yaw) * cosP;
      const dirY = -Math.sin(p.pitch);
      const dirZ = Math.sin(p.yaw) * cosP;
      p.hook = {
        phase: 'flying',
        x: p.x + p.w / 2,
        y: p.y + PLAYER.eye,
        z: p.z,
        vx: dirX * HOOK.speed,
        vy: dirY * HOOK.speed,
        vz: dirZ * HOOK.speed,
        dist: 0,
      };
      ctx.emit('hook_fire', { x: Math.round(p.x), y: Math.round(p.y) });
    }
  }

  if (!p.hook) return;

  if (p.hook.phase === 'flying') {
    const h = p.hook;
    h.x += h.vx;
    h.y += h.vy;
    h.z += h.vz;
    h.dist += HOOK.speed;
    const level = getLevel();

    // Out of range or out of bounds: retract
    if (h.dist > HOOK.maxRange || h.x < 0 || h.x > level.width || h.z < 0 || h.z > CORRIDOR_DEPTH || h.y < 0 || h.y > level.height) {
      p.hook = null;
      return;
    }

    // Canyon walls (z boundaries)
    if (h.z <= 2 || h.z >= CORRIDOR_DEPTH - 2) {
      h.z = Math.max(2, Math.min(CORRIDOR_DEPTH - 2, h.z));
      h.phase = 'attached';
      h.ax = h.x; h.ay = h.y; h.az = h.z;
      h.ropeLen = ropeDist(p, h);
      ctx.emit('hook_attach', { x: Math.round(h.x), y: Math.round(h.y) });
      return;
    }

    // Solid tiles and one-way platforms
    const tx = Math.floor(h.x / TILE);
    const ty = Math.floor(h.y / TILE);
    const tile = tileAt(tx, ty);
    if (isSolid(tile) || tile === '=') {
      const tileX = tx * TILE, tileY = ty * TILE;
      h.x = h.x > tileX + TILE / 2 ? tileX + TILE : tileX;
      h.y = h.y > tileY + TILE / 2 ? tileY + TILE : tileY;
      h.phase = 'attached';
      h.ax = h.x; h.ay = h.y; h.az = h.z;
      h.ropeLen = ropeDist(p, h);
      ctx.emit('hook_attach', { x: Math.round(h.x), y: Math.round(h.y) });
      return;
    }
  } else if (p.hook.phase === 'attached') {
    const h = p.hook;
    h.ropeLen = Math.max(20, h.ropeLen - 0.5);
    const pcx = p.x + p.w / 2;
    const pcy = p.y + p.h / 2;
    const pcz = p.z;
    const toAx = h.ax - pcx, toAy = h.ay - pcy, toAz = h.az - pcz;
    const dist = Math.sqrt(toAx * toAx + toAy * toAy + toAz * toAz);
    if (dist > h.ropeLen && dist > 0.01) {
      const nx = (pcx - h.ax) / dist, ny = (pcy - h.ay) / dist, nz = (pcz - h.az) / dist;
      p.x = h.ax + nx * h.ropeLen - p.w / 2;
      p.y = h.ay + ny * h.ropeLen - p.h / 2;
      p.z = h.az + nz * h.ropeLen;
      const vDotN = p.vx * nx + p.vy * ny + p.vz * nz;
      if (vDotN > 0) {
        p.vx -= vDotN * nx;
        p.vy -= vDotN * ny;
        p.vz -= vDotN * nz;
      }
    }
    if (dist < 28) {
      p.hook = null;
      ctx.emit('hook_release', { x: Math.round(p.x), y: Math.round(p.y) });
    }
  }
}

function ropeDist(p, h) {
  const dx = p.x + p.w / 2 - h.ax;
  const dy = p.y + p.h / 2 - h.ay;
  const dz = p.z - h.az;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}