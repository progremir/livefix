import { BULLET, ARROW, BOMB, CORRIDOR_DEPTH, PLAYER, TILE } from './config.js';
import { getLevel, tileAt, isSolid } from './level.js';
import { burst } from './fx.js';
import { playSound } from './audio.js';

// The engine doesn't pass mouse buttons in input, so track them on window (installed once per page).
if (typeof window !== 'undefined' && !window.__emberMouse) {
  const m = (window.__emberMouse = { down: false, rightDown: false });
  window.addEventListener('mousedown', (e) => { if (e.button === 0) m.down = true; if (e.button === 2) m.rightDown = true; }, true);
  window.addEventListener('mouseup', (e) => { if (e.button === 0) m.down = false; if (e.button === 2) m.rightDown = false; }, true);
  window.addEventListener('blur', () => { m.down = false; m.rightDown = false; });
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); }, true);
}

function hitPt(b) {
  const tx = Math.floor(b.x / TILE);
  const ty = Math.floor(b.y / TILE);
  const px = b.x - b.vx, py = b.y - (b.vy ?? 0);
  let hx = b.x, hy = b.y;
  if (px < tx * TILE) hx = tx * TILE;
  else if (px >= (tx + 1) * TILE) hx = (tx + 1) * TILE;
  if (py < ty * TILE) hy = ty * TILE;
  else if (py >= (ty + 1) * TILE) hy = (ty + 1) * TILE;
  return { x: hx, y: hy };
}

export function updateBullets(state, input, ctx) {
  const p = state.player;

  if (p.fireCooldown > 0) p.fireCooldown--;

  // Fire on left click
  const mouse = typeof window !== 'undefined' ? window.__emberMouse : null;
  if (p.fireCooldown <= 0 && (mouse?.down ?? false)) {
    const cosP = Math.cos(p.pitch);
    const dirX = Math.cos(p.yaw) * cosP;
    const dirY = -Math.sin(p.pitch);
    const dirZ = Math.sin(p.yaw) * cosP;
    if (p.usingBow) {
      state.arrows.push({
        x: p.x + p.w / 2,
        y: p.y + PLAYER.eye,
        z: p.z,
        vx: dirX * ARROW.speed,
        vy: dirY * ARROW.speed,
        vz: dirZ * ARROW.speed,
        life: ARROW.life,
      });
      p.fireCooldown = ARROW.cooldown;
      playSound('arrow_shoot');
      ctx.emit('arrow_shoot', { x: Math.round(p.x), y: Math.round(p.y) });
    } else {
      state.bullets.push({
        x: p.x + p.w / 2,
        y: p.y + PLAYER.eye,
        z: p.z,
        vx: dirX * BULLET.speed,
        vy: dirY * BULLET.speed,
        vz: dirZ * BULLET.speed,
        life: BULLET.life,
      });
      p.fireCooldown = BULLET.cooldown;
      playSound('shoot');
      ctx.emit('shoot', { x: Math.round(p.x), y: Math.round(p.y) });
    }
  }

  // Move & collide
  const level = getLevel();
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx;
    b.y += b.vy ?? 0;
    b.z += b.vz;
    if (--b.life <= 0) { state.bullets.splice(i, 1); continue; }
    if (b.z < 0 || b.z > CORRIDOR_DEPTH) {
      b.z = Math.max(0, Math.min(CORRIDOR_DEPTH, b.z));
      burst(state, ctx, b.x, b.y, '#ffffff', 16, 4, b.z);
      burst(state, ctx, b.x, b.y, '#ffaa00', 8, 3, b.z);
      playSound('hit_wall');
      state.bullets.splice(i, 1);
      continue;
    }
    if (b.x < 0 || b.x > level.width) { state.bullets.splice(i, 1); continue; }

    if (isSolid(tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE)))) {
      const hp = hitPt(b);
      burst(state, ctx, hp.x, hp.y, '#ffffff', 16, 4, b.z);
      burst(state, ctx, hp.x, hp.y, '#ffaa00', 8, 3, b.z);
      playSound('hit_wall');
      state.bullets.splice(i, 1);
      continue;
    }

    let hit = false;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (b.x > e.x - 6 && b.x < e.x + e.w + 6 && b.y > e.y - 6 && b.y < e.y + e.h + 6 && Math.abs(b.z - e.z) < 20) {
        e.alive = false;
        state.score += 50;
        burst(state, ctx, e.x + e.w / 2, e.y + e.h / 2, '#ff6d00', 14, 3);
        playSound('hit_enemy');
        ctx.emit('shoot_kill', { enemy: e.id });
        hit = true;
        break;
      }
    }

    if (!hit && state.boss?.alive) {
      const bo = state.boss;
      if (b.x > bo.x - 6 && b.x < bo.x + bo.w + 6 && b.y > bo.y - 6 && b.y < bo.y + bo.h + 6 && Math.abs(b.z - bo.z) < 24) {
        bo.hp--;
        bo.flashTicks = 18;
        state.score += 100;
        burst(state, ctx, bo.x + bo.w / 2, bo.y + bo.h / 2, '#ff6d00', 20, 4);
        playSound('hit_enemy');
        ctx.emit('boss_hit', { hp: bo.hp, pattern: bo.pattern });
        if (bo.hp <= 0) {
          bo.alive = false;
          bo.respawnTimer = 180;
          state.score += 200;
          burst(state, ctx, bo.x + bo.w / 2, bo.y + bo.h / 2, '#ffd23f', 45, 7);
          ctx.emit('boss_defeated', { x: Math.round(bo.x), y: Math.round(bo.y) });
        }
        hit = true;
      }
    }

    if (hit) state.bullets.splice(i, 1);
  }

  // Arrows: slower, with gravity
  state.arrows ??= [];
  for (let i = state.arrows.length - 1; i >= 0; i--) {
    const a = state.arrows[i];
    a.vy += ARROW.gravity;
    a.x += a.vx;
    a.y += a.vy;
    a.z += a.vz;
    if (--a.life <= 0) { state.arrows.splice(i, 1); continue; }
    if (a.z < 0 || a.z > CORRIDOR_DEPTH) {
      a.z = Math.max(0, Math.min(CORRIDOR_DEPTH, a.z));
      burst(state, ctx, a.x, a.y, '#ffffff', 12, 3, a.z);
      burst(state, ctx, a.x, a.y, '#c8a86c', 6, 2, a.z);
      playSound('hit_wall');
      state.arrows.splice(i, 1);
      continue;
    }
    if (a.x < 0 || a.x > level.width) { state.arrows.splice(i, 1); continue; }
    if (isSolid(tileAt(Math.floor(a.x / TILE), Math.floor(a.y / TILE)))) {
      const hp = hitPt(a);
      burst(state, ctx, hp.x, hp.y, '#ffffff', 12, 3, a.z);
      burst(state, ctx, hp.x, hp.y, '#c8a86c', 6, 2, a.z);
      playSound('hit_wall');
      state.arrows.splice(i, 1);
      continue;
    }

    let hit = false;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (a.x > e.x - 8 && a.x < e.x + e.w + 8 && a.y > e.y - 8 && a.y < e.y + e.h + 8 && Math.abs(a.z - e.z) < 20) {
        e.alive = false;
        state.score += 50;
        burst(state, ctx, e.x + e.w / 2, e.y + e.h / 2, '#ff6d00', 14, 3);
        playSound('hit_enemy');
        ctx.emit('arrow_kill', { enemy: e.id });
        hit = true;
        break;
      }
    }

    if (!hit && state.boss?.alive) {
      const bo = state.boss;
      if (a.x > bo.x - 8 && a.x < bo.x + bo.w + 8 && a.y > bo.y - 8 && a.y < bo.y + bo.h + 8 && Math.abs(a.z - bo.z) < 24) {
        bo.hp--;
        bo.flashTicks = 18;
        state.score += 100;
        burst(state, ctx, bo.x + bo.w / 2, bo.y + bo.h / 2, '#ff6d00', 20, 4);
        playSound('hit_enemy');
        ctx.emit('boss_hit', { hp: bo.hp, pattern: bo.pattern });
        if (bo.hp <= 0) {
          bo.alive = false;
          bo.respawnTimer = 180;
          state.score += 200;
          burst(state, ctx, bo.x + bo.w / 2, bo.y + bo.h / 2, '#ffd23f', 45, 7);
          ctx.emit('boss_defeated', { x: Math.round(bo.x), y: Math.round(bo.y) });
        }
        hit = true;
      }
    }

    if (hit) state.arrows.splice(i, 1);
  }

  // Bombs: hold F to charge, release to throw further
  if (input.pressed.KeyF) {
    p.bombCharge = 0;
  }
  if (p.bombCharge >= 0 && input.down.KeyF) {
    p.bombCharge = Math.min(BOMB.maxCharge, p.bombCharge + 1);
  }
  if (p.bombCharge >= 0 && input.released.KeyF) {
    const cosP = Math.cos(p.pitch);
    const dirX = Math.cos(p.yaw) * cosP;
    const dirY = -Math.sin(p.pitch);
    const dirZ = Math.sin(p.yaw) * cosP;
    const charge = p.bombCharge / BOMB.maxCharge;
    const speed = BOMB.speed * (1 + charge);
    state.bombs.push({
      x: p.x + p.w / 2,
      y: p.y + PLAYER.eye,
      z: p.z,
      vx: dirX * speed,
      vy: dirY * speed,
      vz: dirZ * speed,
      fuse: BOMB.fuse + Math.floor(p.bombCharge * 0.5),
    });
    ctx.emit('bomb_throw', { x: Math.round(p.x), y: Math.round(p.y), charge: Math.round(charge * 100) / 100 });
    p.bombCharge = -1;
  }

  for (let i = state.bombs.length - 1; i >= 0; i--) {
    const b = state.bombs[i];
    b.vy += BOMB.gravity;
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
    if (--b.fuse <= 0 || b.x < 0 || b.x > level.width || b.z < 0 || b.z > CORRIDOR_DEPTH || isSolid(tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE)))) {
      explodeBomb(state, ctx, b.x, b.y, b.z);
      state.bombs.splice(i, 1);
    }
  }
}

function explodeBomb(state, ctx, x, y, z) {
  burst(state, ctx, x, y, '#ff6d00', 30, 5);
  burst(state, ctx, x, y, '#ffd23f', 20, 4);
  ctx.emit('bomb_explode', { x: Math.round(x), y: Math.round(y), z: Math.round(z) });
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const dx = e.x + e.w / 2 - x, dy = e.y + e.h / 2 - y, dz = e.z - z;
    if (Math.hypot(dx, dy, dz) < BOMB.radius) {
      e.alive = false;
      state.score += 50;
      ctx.emit('bomb_kill', { enemy: e.id });
    }
  }
  if (state.boss?.alive) {
    const bo = state.boss;
    const dx = bo.x + bo.w / 2 - x, dy = bo.y + bo.h / 2 - y, dz = bo.z - z;
    if (Math.hypot(dx, dy, dz) < BOMB.radius + 10) {
      bo.hp--;
      bo.flashTicks = 18;
      state.score += 100;
      ctx.emit('boss_hit', { hp: bo.hp, pattern: bo.pattern });
      if (bo.hp <= 0) {
        bo.alive = false;
        bo.respawnTimer = 180;
        state.score += 200;
        burst(state, ctx, bo.x + bo.w / 2, bo.y + bo.h / 2, '#ffd23f', 45, 7);
        ctx.emit('boss_defeated', { x: Math.round(bo.x), y: Math.round(bo.y) });
      }
    }
  }
}