import { now } from './clock.js';
import { STEP_MS, makeCtx, inputFrom } from './shared.js';

/**
 * The engine owns two things the game code never does: the clock and the state.
 * Game code (game/main.js) is a set of functions that can be swapped at any time;
 * the state object they operate on stays put, so a hot reload never costs progress.
 */
export class Engine {
  constructor({ canvas, recorder, input }) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.recorder = recorder;
    this.input = input;
    this.mod = null;
    this.version = 0;
    this.state = null;
    this.tick = 0;
    this.paused = true;
    this.crashed = null;
    this.lastSwap = null;
    this.errTimes = [];
    this.renderErr = null;
    this.acc = 0;
    this.last = 0;
    this.onCrash = null;
    this.onAfterRender = null;
  }

  emitter(tick) {
    return (type, data = {}) => this.recorder.event({ at: now(), t: tick, type, data });
  }

  async boot(version, resume) {
    this.mod = await this.load(version);
    this.version = version;
    this.#size();
    if (resume?.state) {
      this.state = resume.state;
      this.tick = resume.tick || 0;
      if (typeof this.state.__rng !== 'number') this.state.__rng = randomSeed();
      this.#migrate(this.mod, this.state);
      this.recorder.mark('resume', { version, tick: this.tick });
    } else {
      this.newGame();
    }
    requestAnimationFrame((t) => this.#frame(t));
  }

  newGame() {
    const box = { __rng: randomSeed() };
    const state = this.mod.init(makeCtx(box, this.tick, this.emitter(this.tick)));
    state.__rng = box.__rng;
    this.state = state;
    this.crashed = null;
    this.recorder.mark('new-game', { version: this.version });
  }

  async load(version) {
    // Every version gets its own URL prefix, so relative imports inside game/ are fresh too.
    const mod = await import(`/game@${version}/main.js`);
    for (const k of ['init', 'update', 'render']) {
      if (typeof mod[k] !== 'function') throw new Error(`game/main.js must export function ${k}()`);
    }
    return mod;
  }

  /** Load a new version of the game code and swap it in without touching progress. */
  async hotSwap(version, reason = '') {
    if (version === this.version) return { ok: true, same: true };
    let mod;
    try {
      mod = await this.load(version);
      this.#validate(mod);
    } catch (err) {
      const error = errInfo(err);
      this.recorder.mark('reload-failed', { version, error: error.message });
      return { ok: false, error };
    }
    const before = structuredClone(this.state);
    try {
      this.#migrate(mod, this.state);
    } catch (err) {
      this.state = before;
      return { ok: false, error: errInfo(err) };
    }
    this.lastSwap = { prevMod: this.mod, prevVersion: this.version, at: now() };
    this.mod = mod;
    this.version = version;
    this.crashed = null;
    this.errTimes = [];
    this.renderErr = null;
    this.#size();
    this.recorder.mark('reload', { version, reason });
    return { ok: true };
  }

  /** Dry-run new code on copies of the live state before it touches the real thing. */
  #validate(mod) {
    const clone = structuredClone(this.state);
    mod.migrate?.(clone, makeCtx(clone, this.tick));
    const held = inputFrom([...this.input.down]);
    const none = inputFrom([]);
    for (let i = 1; i <= 40; i++) mod.update(clone, i <= 20 ? held : none, makeCtx(clone, this.tick + i));
    structuredClone(clone); // throws if the new code put functions/DOM nodes into state

    const fresh = { __rng: 1 };
    const s2 = mod.init(makeCtx(fresh, 0));
    s2.__rng = fresh.__rng;
    for (let i = 1; i <= 5; i++) mod.update(s2, none, makeCtx(s2, i));

    const off = document.createElement('canvas');
    off.width = this.view.w;
    off.height = this.view.h;
    mod.render(clone, off.getContext('2d'), this.view);
    mod.describe?.(clone);
  }

  rewind(seconds = 5) {
    const snap = this.recorder.ticksAgo(Math.round(seconds * 60));
    if (!snap) return false;
    this.restore(snap.state, `rewind ${seconds}s`);
    return true;
  }

  restore(state, reason) {
    const prev = this.state;
    this.state = structuredClone(state);
    if (typeof this.state.__rng !== 'number') this.state.__rng = prev?.__rng ?? randomSeed();
    this.#migrate(this.mod, this.state);
    this.crashed = null;
    this.errTimes = [];
    this.recorder.mark('restore', { reason, version: this.version });
  }

  #migrate(mod, state) {
    mod.migrate?.(state, makeCtx(state, this.tick, this.emitter(this.tick)));
  }

  #size() {
    const w = this.mod.meta?.width || 960;
    const h = this.mod.meta?.height || 540;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.view?.w === w && this.view?.h === h && this.dpr === dpr) return;
    this.view = { w, h };
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.aspectRatio = `${w} / ${h}`;
  }

  #frame(ts) {
    requestAnimationFrame((t) => this.#frame(t));
    let dt = this.last ? ts - this.last : STEP_MS;
    this.last = ts;
    if (dt > 250) dt = STEP_MS; // tab was hidden: don't fast-forward
    if (!this.paused && !this.crashed) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP_MS && n < 5) {
        this.#step();
        this.acc -= STEP_MS;
        n++;
      }
      if (n === 5) this.acc = 0;
    } else {
      this.acc = 0;
    }
    this.#render();
  }

  #step() {
    const { input, change } = this.input.sample();
    const tick = this.tick + 1;
    try {
      this.mod.update(this.state, input, makeCtx(this.state, tick, this.emitter(tick)));
    } catch (err) {
      this.#runtimeError(err, 'update');
      return;
    }
    this.tick = tick;
    this.recorder.tick({ tick, at: now(), state: this.state, change, version: this.version, describe: this.mod.describe });
  }

  #render() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    try {
      this.mod.render(this.state, g, this.view);
      this.renderErr = null;
    } catch (err) {
      if (g.reset) g.reset();
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.#banner(`render error: ${err.message}`, '#8b1e2d');
      if (this.renderErr !== err.message) {
        this.renderErr = err.message;
        this.#runtimeError(err, 'render');
      }
    }
    if (this.crashed) this.#banner(`Game crashed: ${this.crashed.message} — waiting for a fix (Backspace rewinds)`, '#8b1e2d');
    else if (this.paused) this.#banner('Paused', 'rgba(0,0,0,0.55)');
    this.onAfterRender?.(g, this.view);
  }

  #banner(text, bg) {
    const g = this.g;
    g.save();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = bg;
    g.fillRect(0, this.view.h - 40, this.view.w, 40);
    g.fillStyle = '#fff';
    g.font = '15px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(text.slice(0, 120), 14, this.view.h - 20);
    g.restore();
  }

  #runtimeError(err, phase) {
    const info = { ...errInfo(err), phase, version: this.version, at: now() };
    this.recorder.error(info);
    const good = this.recorder.lastGood();
    if (phase === 'update' && good) this.state = structuredClone(good.state);

    const swap = this.lastSwap;
    if (swap && info.at - swap.at < 15000) {
      // Fresh code broke the game: put the previous code back so the player can keep going.
      this.mod = swap.prevMod;
      this.version = swap.prevVersion;
      this.lastSwap = null;
      this.renderErr = null;
      try { this.#migrate(this.mod, this.state); } catch { /* best effort */ }
      this.recorder.mark('rollback', { to: this.version, reason: info.message });
      this.onCrash?.({ ...info, rolledBack: true });
      return;
    }
    if (phase === 'update') {
      this.errTimes = this.errTimes.filter((t) => info.at - t < 2000);
      this.errTimes.push(info.at);
      if (this.errTimes.length >= 3) this.crashed = info;
    }
    this.onCrash?.({ ...info, rolledBack: false });
  }
}

function errInfo(err) {
  return {
    message: String(err?.message ?? err),
    stack: String(err?.stack ?? '').split('\n').slice(0, 10).join('\n'),
  };
}

const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;
