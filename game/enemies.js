import { ENEMY, TILE, CENTER_Z } from './config.js';
import { getLevel, tileAt, isSolid } from './level.js';
import { killPlayer } from './player.js';
import { burst } from './fx.js';

export function spawnEnemy(def) {
  return { id: def.id, x: def.x, y: def.y, z: CENTER_Z, w: ENEMY.w, h: ENEMY.h, vx: ENEMY.speed, minX: def.minX, maxX: def.maxX, alive: true, bomber: def.bomber || false };
}

/** Make sure every enemy in the level exists in state and has current patrol bounds. */
export function syncEnemies(state) {
  const defs = getLevel().enemies;
  const byId = new Map(state.enemies.map((e) => [e.id, e]));
  for (const def of defs) {
    const e = byId.get(def.id);
    if (!e) state.enemies.push(spawnEnemy(def));
    else { e.minX = def.minX; e.maxX = def.maxX; e.z ??= CENTER_Z; }
  }
  const ids = new Set(defs.map((d) => d.id));
  state.enemies = state.enemies.filter((e) => ids.has(e.id));
}

function overlaps(p, e, pad) {
  return p.x < e.x + e.w + pad && p.x + p.w > e.x - pad && p.y < e.y + e.h + pad && p.y + p.h > e.y - pad
    && Math.abs(p.z - e.z) < (p.w + e.w) / 2 + pad;
}

function updateEnemyBullets(state, ctx) {
  const p = state.player;
  const list = state.enemyBullets;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.x += b.vx; b.y += b.vy; b.z += b.vz;
    if (--b.life <= 0 || isSolid(tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE)))) { list.splice(i, 1); continue; }
    if (p.alive && b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h && Math.abs(b.z - p.z) < p.w / 2 + 4) {
      list.splice(i, 1);
      if (p.safeTicks <= 0) killPlayer(state, ctx, 'enemy_bullet', {});
    }
  }
}

export function updateEnemies(state, ctx) {
  state.enemyBullets ??= [];
  updateEnemyBullets(state, ctx);
  const p = state.player;
  const cp = state.checkpoint;
  const atCheckpoint = cp && Math.abs(p.x - cp.x) < 48 && Math.abs(p.y - cp.y) < 48;
  // Enemy bombs: tick fuses, explode on expiry
  state.enemyBombs ??= [];
  for (let i = state.enemyBombs.length - 1; i >= 0; i--) {
    const eb = state.enemyBombs[i];
    if (--eb.fuse <= 0) {
      burst(state, ctx, eb.x, eb.y, '#ff4500', 22, 4);
      ctx.emit('enemy_bomb_explode', { x: Math.round(eb.x), y: Math.round(eb.y) });
      if (p.alive && p.safeTicks <= 0 && Math.hypot(p.x + p.w / 2 - eb.x, p.y + p.h / 2 - eb.y, p.z - eb.z) < 44) {
        killPlayer(state, ctx, 'enemy_bomb', {});
      }
      state.enemyBombs.splice(i, 1);
    }
  }

  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.x += e.vx;
    if (e.x < e.minX) { e.x = e.minX; e.vx = Math.abs(e.vx); }
    if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.vx = -Math.abs(e.vx); }
    e.z = CENTER_Z + Math.sin(state.time * 0.9 + e.minX * 0.07) * ENEMY.weave * TILE;

    if (e.cd === undefined) e.cd = 60 + Math.floor(ctx.rng() * 60);
    if (e.cd > 0) e.cd--;
    if (p.alive && e.cd <= 0) {
      const sx = e.x + e.w / 2, sy = e.y + e.h / 2;
      const dx = p.x + p.w / 2 - sx, dy = p.y + p.h / 2 - sy, dz = p.z - e.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 420 && d > 20) {
        e.cd = 100;
        const s = 4 / d;
        state.enemyBullets.push({ x: sx, y: sy, z: e.z, vx: dx * s, vy: dy * s, vz: dz * s, life: 140 });
        ctx.emit('enemy_shoot', { enemy: e.id });
      }
    }

    // Bomber: drop a timed bomb on the ground
    if (e.bomber) {
      if (e.bombCd === undefined) e.bombCd = 90 + Math.floor(ctx.rng() * 60);
      if (e.bombCd > 0) e.bombCd--;
      if (p.alive && e.bombCd <= 0) {
        const bd = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
        if (bd < 320) {
          e.bombCd = 120 + Math.floor(ctx.rng() * 60);
          state.enemyBombs.push({ x: e.x + e.w / 2, y: e.y + e.h, z: e.z, fuse: 90 });
          ctx.emit('enemy_bomb_drop', { enemy: e.id, x: Math.round(e.x), y: Math.round(e.y) });
        }
      }
    }

    if (!p.alive) continue;
    // Generous box for stomping, slightly smaller than the drawn enemy for getting hurt.
    const prevFeet = p.y + p.h - p.vy;
    if (p.vy > 1 && prevFeet <= e.y + 4 && overlaps(p, e, ENEMY.stompPad)) {
      e.alive = false;
      p.vy = -7;
      state.score += 50;
      burst(state, ctx, e.x + e.w / 2, e.y + e.h / 2, '#b072d1', 18);
      ctx.emit('stomp', { enemy: e.id });
    } else if (p.safeTicks <= 0 && !atCheckpoint && overlaps(p, e, -ENEMY.hurtInset)) {
      killPlayer(state, ctx, 'enemy', { enemy: e.id });
    }
  }
}
