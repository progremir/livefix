// Purely cosmetic particles. They live in state so a hot reload never pops them.
const MAX_PARTICLES = 220;
export const RING_LIFE = 16;

export function burst(state, ctx, x, y, color, n = 12, speed = 3.5, z) {
  const pz = z !== undefined ? z : state.player.z;
  for (let i = 0; i < n; i++) {
    const a = ctx.rng() * Math.PI * 2;
    const s = speed * (0.4 + ctx.rng() * 0.8);
    state.particles.push({ x, y, z: pz, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, vz: (ctx.rng() - 0.5) * s * 2, life: 30 + Math.floor(ctx.rng() * 20), color });
  }
  if (state.particles.length > MAX_PARTICLES) state.particles.splice(0, state.particles.length - MAX_PARTICLES);
}

/** Dust kicked out from under the player's feet. */
export function jumpDust(state, ctx, x, y) {
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    state.particles.push({ x, y, z: state.player.z, vx: side * (1 + ctx.rng() * 2.5), vy: -ctx.rng() * 1.2, vz: (ctx.rng() - 0.5) * 5, life: 12 + Math.floor(ctx.rng() * 10), color: '#f0e6d2' });
  }
  trim(state);
}

/** A ring and a spray of sparks pushed down from the player's feet, as if kicking off the air. */
export function airJumpBurst(state, ctx, x, y) {
  state.particles.push({ x, y, z: state.player.z, vx: 0, vy: 0, vz: 0, life: RING_LIFE, color: '#ffffff', ring: true });
  for (let i = 0; i < 14; i++) {
    state.particles.push({ x, y, z: state.player.z, vx: (ctx.rng() - 0.5) * 6, vy: 1 + ctx.rng() * 3, vz: (ctx.rng() - 0.5) * 6, life: 14 + Math.floor(ctx.rng() * 12), color: '#9fe8ff' });
  }
  trim(state);
}

function trim(state) {
  if (state.particles.length > MAX_PARTICLES) state.particles.splice(0, state.particles.length - MAX_PARTICLES);
}

export function updateParticles(state) {
  const ps = state.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const q = ps[i];
    if (!q.ring) { q.x += q.vx; q.y += q.vy; q.z += q.vz ?? 0; q.vy += 0.18; q.vx *= 0.98; }
    if (--q.life <= 0) ps.splice(i, 1);
  }
}
