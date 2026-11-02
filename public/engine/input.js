import { RESERVED_KEYS, inputFrom } from './shared.js';

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']);

/** Keyboard and pointer-lock mouse state sampled once per tick, so every tick's input can be recorded and replayed. */
export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.enabled = true;
    this.lookX = 0;
    this.lookY = 0;
    addEventListener('keydown', (e) => this.#onDown(e));
    addEventListener('keyup', (e) => this.#onUp(e));
    addEventListener('blur', () => this.releaseAll());
    addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
  }

  #onDown(e) {
    if (!this.enabled || RESERVED_KEYS.includes(e.code)) return;
    if (PREVENT.has(e.code)) e.preventDefault();
    if (e.repeat || this.down.has(e.code)) return;
    this.down.add(e.code);
    this.pressed.add(e.code);
  }

  #onUp(e) {
    if (RESERVED_KEYS.includes(e.code)) return;
    if (this.down.delete(e.code)) this.released.add(e.code);
  }

  releaseAll() {
    for (const k of this.down) this.released.add(k);
    this.down.clear();
  }

  setEnabled(on) {
    if (!on) this.releaseAll();
    this.enabled = on;
  }

  /** Returns { input, change } where change is null if nothing changed this tick. */
  sample() {
    const p = [...this.pressed];
    const r = [...this.released];
    const d = [...this.down];
    this.pressed.clear();
    this.released.clear();
    const m = [Math.round(this.lookX), Math.round(this.lookY)];
    this.lookX = 0;
    this.lookY = 0;
    const moved = m[0] || m[1];
    return { input: inputFrom(d, p, r, m), change: p.length || r.length || moved ? { p, r, d, ...(moved ? { m } : {}) } : null };
  }
}
