import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const KEEP_MS = 15 * 60 * 1000; // in-memory telemetry window (everything is also on disk)

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

async function readJson(p, fallback = null) {
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return fallback; }
}

const pendingWrites = new Map();

/** Writes to one file run in call order, because they share a temp file. */
function writeJsonAtomic(p, obj) {
  const data = JSON.stringify(obj);
  const tmp = `${p}.tmp`;
  const write = (pendingWrites.get(p) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, p);
  });
  pendingWrites.set(p, write);
  return write;
}

function findLast(arr, fn) {
  for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return arr[i];
  return null;
}

/**
 * One play session on disk:
 *   telemetry.ndjson   inputs, events, samples, marks, errors  (all with epoch-ms `at`)
 *   snapshots.ndjson   full game state, 1/sec
 *   transcript.ndjson  everything you said, with start/end times
 *   audio/             continuous mic recording (+ index.ndjson with segment start times)
 *   feedback/NNN/      context bundle handed to the fixer for each piece of feedback
 *   versions/          copy of game/ before every fix (undo)
 *   state.json         latest game state, so you can resume after closing the tab
 */
export class Session {
  static async open(root, { fresh = false } = {}) {
    const base = path.join(root, 'sessions');
    await fsp.mkdir(base, { recursive: true });
    let id = null;
    if (!fresh) {
      const dirs = (await fsp.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
      id = dirs.at(-1) ?? null;
    }
    const s = new Session(root, path.join(base, id ?? stamp()));
    await s.#init();
    return s;
  }

  constructor(root, dir) {
    this.root = root;
    this.dir = dir;
    this.id = path.basename(dir);
    this.relDir = path.relative(root, dir);
    this.recent = { events: [], inputs: [], samples: [], snapshots: [], marks: [], errors: [], utterances: [] };
    this.streams = new Map();
    this.audio = new Map();
    this.latestAt = 0;
  }

  async #init() {
    for (const d of ['audio', 'feedback', 'versions']) await fsp.mkdir(path.join(this.dir, d), { recursive: true });
    this.meta = await readJson(path.join(this.dir, 'meta.json'), {
      id: this.id, createdAt: new Date().toISOString(), version: 0, feedbackSeq: 0, fixes: [], notes: [],
    });
    this.meta.version += 1; // fresh number per server start so no browser reuses a cached module
    this.cards = await readJson(path.join(this.dir, 'cards.json'), []);
    this.saved = await readJson(path.join(this.dir, 'state.json'), null);
    await this.#reloadRecent();
    await this.saveMeta();
  }

  /** After a server restart, reload the last few minutes so retries and context still work. */
  async #reloadRecent() {
    const tail = async (file, maxBytes = 24 * 1024 * 1024) => {
      let fh;
      try {
        fh = await fsp.open(path.join(this.dir, file), 'r');
        const { size } = await fh.stat();
        const start = Math.max(0, size - maxBytes);
        const buf = Buffer.alloc(size - start);
        await fh.read(buf, 0, buf.length, start);
        const lines = buf.toString('utf8').split('\n');
        if (start > 0) lines.shift(); // probably a partial line
        return lines.filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
      } catch {
        return [];
      } finally {
        await fh?.close();
      }
    };
    const keys = { event: 'events', input: 'inputs', sample: 'samples', mark: 'marks', error: 'errors' };
    for (const { k, ...item } of await tail('telemetry.ndjson')) if (keys[k]) this.recent[keys[k]].push(item);
    this.recent.snapshots.push(...(await tail('snapshots.ndjson')));
    this.recent.utterances.push(...(await tail('transcript.ndjson', 2 * 1024 * 1024)));
    for (const arr of Object.values(this.recent)) for (const x of arr) if ((x.at ?? 0) > this.latestAt) this.latestAt = x.at;
    this.#prune();
  }

  async saveMeta() {
    await writeJsonAtomic(path.join(this.dir, 'meta.json'), this.meta).catch((err) => console.error('[meta]', err.message));
  }

  bumpVersion() {
    this.meta.version += 1;
    this.saveMeta();
    return this.meta.version;
  }

  nextSeq() {
    this.meta.feedbackSeq += 1;
    this.saveMeta();
    return this.meta.feedbackSeq;
  }

  #append(file, obj) {
    let s = this.streams.get(file);
    if (!s) {
      s = fs.createWriteStream(path.join(this.dir, file), { flags: 'a' });
      this.streams.set(file, s);
    }
    s.write(`${JSON.stringify(obj)}\n`);
  }

  ingest(t) {
    const kinds = { events: 'event', inputs: 'input', samples: 'sample', marks: 'mark', errors: 'error' };
    for (const [key, k] of Object.entries(kinds)) {
      for (const item of t[key] || []) {
        this.recent[key].push(item);
        this.#append('telemetry.ndjson', { k, ...item });
        if (item.at > this.latestAt) this.latestAt = item.at;
      }
    }
    for (const snap of t.snapshots || []) {
      this.recent.snapshots.push(snap);
      this.#append('snapshots.ndjson', snap);
    }
    this.#prune();
  }

  addUtterance(u) {
    const rec = { startAt: u.startAt, endAt: u.endAt, text: u.text, ptt: !!u.ptt, confidence: u.confidence ?? null, duringTts: !!u.duringTts };
    this.recent.utterances.push(rec);
    this.#append('transcript.ndjson', rec);
  }

  #prune() {
    const cutoff = this.latestAt - KEEP_MS;
    for (const key of Object.keys(this.recent)) {
      const arr = this.recent[key];
      let i = 0;
      while (i < arr.length && (arr[i].at ?? arr[i].endAt) < cutoff) i++;
      if (i) arr.splice(0, i);
    }
  }

  /** Everything recorded between two instants (epoch ms), plus what's needed to replay it. */
  window(from, to) {
    const r = this.recent;
    const inR = (x) => x.at >= from && x.at <= to;
    const snapshots = r.snapshots.filter((s) => s.at >= from - 5000 && s.at <= to);
    const before = findLast(r.snapshots, (s) => s.at < from - 5000);
    if (before) snapshots.unshift(before);
    return {
      from,
      to,
      events: r.events.filter(inR),
      inputs: r.inputs.filter(inR),
      inputsBefore: findLast(r.inputs, (x) => x.at < from),
      samples: r.samples.filter(inR),
      marks: r.marks.filter((m) => m.at >= from - 30000 && m.at <= to),
      errors: r.errors.filter((e) => e.at >= from - 30000 && e.at <= to),
      utterances: r.utterances.filter((u) => u.endAt >= from - 20000 && u.startAt <= to),
      snapshots,
    };
  }

  snapshotAt(at) {
    return findLast(this.recent.snapshots, (s) => s.at <= at) ?? this.recent.snapshots[0] ?? null;
  }

  async saveState({ state, tick, version }) {
    if (!state) return;
    this.saved = { state, tick, version, savedAt: Date.now() };
    this.#stateWrite = (this.#stateWrite || Promise.resolve())
      .then(() => writeJsonAtomic(path.join(this.dir, 'state.json'), this.saved))
      .catch(() => {});
  }
  #stateWrite = null;

  audioStart({ segment, startAt, mime }) {
    if (!/^seg-\d+$/.test(segment)) return;
    const ext = /ogg/.test(mime) ? 'ogg' : /mp4/.test(mime) ? 'm4a' : 'webm';
    const file = `audio/${segment}.${ext}`;
    this.audio.set(segment, file);
    this.#append('audio/index.ndjson', { file, startAt, mime });
  }

  audioChunk({ segment, data }) {
    const file = this.audio.get(segment);
    if (!file || !data) return;
    fs.appendFileSync(path.join(this.dir, file), Buffer.from(data, 'base64'));
  }

  card(id, patch) {
    let c = this.cards.find((x) => x.id === id);
    if (!c) { c = { id }; this.cards.push(c); }
    Object.assign(c, patch);
    if (this.cards.length > 200) this.cards.splice(0, this.cards.length - 200);
    writeJsonAtomic(path.join(this.dir, 'cards.json'), this.cards).catch(() => {});
    return c;
  }
}
