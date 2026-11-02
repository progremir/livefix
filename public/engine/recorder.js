import { now } from './clock.js';
import { blobToB64 } from './util.js';

const RING_TICKS = 60 * 12;   // last 12 s of per-tick state, for rewind and crash recovery
const SAMPLE_EVERY = 6;       // describe(state) at 10 Hz
const SNAPSHOT_EVERY = 60;    // full state to the server at 1 Hz
const FRAME_MS = 250;         // screenshots at 4 fps...
const FRAME_KEEP_MS = 25000;  // ...kept in memory for 25 s

/**
 * Records everything that happens in the game on one clock and streams it to the server:
 * inputs (every change), events (ctx.emit), state samples, full snapshots, marks, errors.
 * Screenshots stay in the browser until a piece of feedback needs them.
 */
export class Recorder {
  constructor(net, canvas) {
    this.net = net;
    this.canvas = canvas;
    this.ring = [];
    this.frames = [];
    this.buf = empty();
    this.forceSnapshot = true;
    this.paused = false;
    this.thumb = document.createElement('canvas');
    this.thumb.width = 480;
    this.thumb.height = 270;
    setInterval(() => this.flush(), 500);
    setInterval(() => this.#grab(), FRAME_MS);
  }

  tick({ tick, at, state, change, version, describe }) {
    const copy = structuredClone(state);
    this.ring.push({ tick, at, state: copy });
    if (this.ring.length > RING_TICKS) this.ring.splice(0, this.ring.length - RING_TICKS);
    if (change) this.buf.inputs.push({ t: tick, at, ...change });
    if (describe && tick % SAMPLE_EVERY === 0) {
      try { this.buf.samples.push({ t: tick, at, v: version, d: describe(state) }); } catch { /* describe is optional */ }
    }
    if (this.forceSnapshot || tick % SNAPSHOT_EVERY === 0) {
      this.buf.snapshots.push({ t: tick, at, v: version, state: copy });
      this.forceSnapshot = false;
    }
  }

  event(e) { this.buf.events.push(e); }
  error(e) { this.buf.errors.push(e); }
  mark(type, data = {}) {
    this.buf.marks.push({ at: now(), type, ...data });
    if (['reload', 'restore', 'resume', 'new-game', 'rollback'].includes(type)) this.forceSnapshot = true;
  }

  flush() {
    const b = this.buf;
    if (!b.events.length && !b.inputs.length && !b.samples.length && !b.snapshots.length && !b.marks.length && !b.errors.length) return;
    this.buf = empty();
    this.net.send({ type: 'telemetry', ...b });
  }

  lastGood() { return this.ring.at(-1); }

  ticksAgo(n) {
    const last = this.ring.at(-1);
    if (!last) return null;
    const target = last.tick - n;
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i].tick <= target) return this.ring[i];
    return this.ring[0];
  }

  #grab() {
    if (this.paused || document.hidden || !this.canvas.width) return;
    const at = now();
    this.thumb.getContext('2d').drawImage(this.canvas, 0, 0, this.thumb.width, this.thumb.height);
    this.thumb.toBlob((blob) => {
      if (!blob) return;
      this.frames.push({ at, blob });
      const cutoff = now() - FRAME_KEEP_MS;
      while (this.frames.length && this.frames[0].at < cutoff) this.frames.shift();
    }, 'image/jpeg', 0.72);
  }

  async framesBetween(a, b) {
    const sel = this.frames.filter((f) => f.at >= a && f.at <= b);
    return Promise.all(sel.map(async (f) => ({ at: f.at, data: await blobToB64(f.blob) })));
  }
}

function empty() {
  return { events: [], inputs: [], samples: [], snapshots: [], marks: [], errors: [] };
}
