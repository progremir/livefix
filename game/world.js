import { TILE, BANNER_TICKS, CHASE } from './config.js';
import { getLevel, setLevel, levelCount, tileAt } from './level.js';
import { killPlayer, createPlayer } from './player.js';
import { syncEnemies } from './enemies.js';
import { burst } from './fx.js';

export function updateWorld(state, ctx) {
  const p = state.player;
  const level = getLevel();
  if (!p.alive) return;

  // Chase wall: closes in from behind
  if (state.chaseWallX !== null) {
    state.chaseWallX += CHASE.speed;
    if (p.x < state.chaseWallX) {
      killPlayer(state, ctx, 'chase_wall', { x: Math.round(p.x) });
      return;
    }
  }

  // Coins
  for (const c of level.coins) {
    if (state.coins[c.id]) continue;
    // Coin (radius ~10) touches anywhere on the player's body, not just the top-left corner.
    if (c.x > p.x - 10 && c.x < p.x + p.w + 10 && c.y > p.y - 10 && c.y < p.y + p.h + 10 && Math.abs(c.z - p.z) < p.w / 2 + 10) {
      state.coins[c.id] = true;
      state.score += 10;
      burst(state, ctx, c.x, c.y, '#ffd23f', 10, 2.5);
      ctx.emit('coin', { id: c.id, total: Object.keys(state.coins).length });
    }
  }

  // Spikes: touching the lower half of a spike tile is deadly.
  const l = Math.floor(p.x / TILE), r = Math.floor((p.x + p.w - 1) / TILE);
  const t = Math.floor(p.y / TILE), b = Math.floor((p.y + p.h - 1) / TILE);
  for (let ty = t; ty <= b; ty++) {
    for (let tx = l; tx <= r; tx++) {
      if (tileAt(tx, ty) === '^' && p.y + p.h > ty * TILE + TILE / 2) {
        killPlayer(state, ctx, 'spikes', { tile: `${tx},${ty}` });
        return;
      }
    }
  }

  // Checkpoints
  for (const cp of level.checkpoints) {
    const x = cp.tx * TILE;
    if (p.x + p.w > x && p.x < x + TILE && p.y + p.h > cp.ty * TILE - TILE && p.y < (cp.ty + 1) * TILE) {
      if (state.checkpoint?.id !== cp.id) {
        state.checkpoint = { id: cp.id, x: cp.x, y: cp.y };
        state.checkpointsReached[cp.id] = true;
        burst(state, ctx, x + TILE / 2, cp.ty * TILE, '#4cd964', 14);
        ctx.emit('checkpoint', { id: cp.id });
      }
    }
  }

  // Goal
  const g = level.goal;
  if (g && !state.won && p.x + p.w > g.x + 8 && p.x < g.x + TILE - 8 && p.y + p.h > g.y - TILE * 2) {
    if (state.level + 1 < levelCount()) {
      startNextLevel(state, ctx);
      return;
    }
    state.won = true;
    burst(state, ctx, g.x + TILE / 2, g.y - TILE, '#ffd23f', 40, 5);
    ctx.emit('win', { time: Math.round(state.time * 10) / 10, coins: state.coinsBanked + Object.keys(state.coins).length, deaths: state.deaths });
  }
}

function startNextLevel(state, ctx) {
  state.coinsBanked += Object.keys(state.coins).length;
  state.level += 1;
  setLevel(state.level);
  const level = getLevel();
  state.player = createPlayer(level.start);
  state.chaseWallX = level.start.x - CHASE.startOffset * TILE;
  state.checkpoint = null;
  state.checkpointsReached = {};
  state.coins = {};
  state.enemies = [];
  syncEnemies(state);
  state.particles = [];
  state.bannerTicks = BANNER_TICKS;
  ctx.emit('level', { level: state.level + 1, name: level.name });
}
