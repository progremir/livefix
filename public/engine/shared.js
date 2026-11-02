// Shared by the browser engine and the Node replay tool, so a replay runs
// exactly the same tick logic the player saw.

export const TICK_HZ = 60;
export const STEP_MS = 1000 / TICK_HZ;
export const RESERVED_KEYS = ['KeyT', 'Enter', 'Backspace', 'Escape'];

export function makeCtx(state, tick, emit) {
  return {
    dt: 1 / TICK_HZ,
    tick,
    emit: emit || (() => {}),
    rng() {
      // mulberry32, advanced inside state so it survives reloads and replays exactly
      const a = (state.__rng = ((state.__rng >>> 0) + 0x6d2b79f5) >>> 0);
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export const toSet = (list) => {
  const o = {};
  for (const k of list || []) o[k] = true;
  return o;
};

/** Rebuild the per-tick input object from a recorded input change. */
export function inputFrom(down, pressed = [], released = [], look = [0, 0]) {
  return { down: toSet(down), pressed: toSet(pressed), released: toSet(released), look: { dx: look[0], dy: look[1] } };
}

export function seedState(state, seed) {
  if (typeof state.__rng !== 'number') state.__rng = seed >>> 0;
  return state;
}
