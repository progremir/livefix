import './env.js';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Session } from './session.js';
import { Fixer, describeFixer } from './fixer.js';
import { buildBundle } from './context.js';
import { hashDir, isInside } from './files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const GAME = path.join(ROOT, 'game');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const TRANSCRIBE = process.env.LIVEFIX_TRANSCRIBE_CMD || ''; // e.g. "whisper-cli -m model.bin -nt -f {file}"

const session = await Session.open(ROOT, { fresh: process.argv.includes('--fresh') });

// ------------------------------------------------------------------ hub (browser connections)
class Hub {
  clients = new Set();
  waiters = new Map();

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.readyState === 1) c.send(s);
  }

  agent(msg) { this.broadcast({ type: 'agent', ...msg }); }

  card(id, status, extra = {}) {
    const c = session.card(id, { status, ...extra });
    this.broadcast({ type: 'feedback-status', ...c });
  }

  /** Tell browsers to load a version and wait for the first verdict from the engine's dry run. */
  reloadAndWait(version, reason, timeoutMs = 10000) {
    if (![...this.clients].some((c) => c.readyState === 1)) return Promise.resolve({ ok: true, unverified: true });
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiters.delete(version); resolve({ ok: true, unverified: true }); }, timeoutMs);
      this.waiters.set(version, (r) => { clearTimeout(t); resolve(r); });
      this.broadcast({ type: 'reload', version, reason });
    });
  }

  resolveReload(m) {
    const w = this.waiters.get(m.version);
    if (w) { this.waiters.delete(m.version); w(m); }
  }
}
const hub = new Hub();
const fixer = new Fixer({ root: ROOT, session, hub });
fixer.lastHash = await hashDir(GAME);

// ------------------------------------------------------------------ manual edits hot-reload too
let watchTimer = null;
fs.watch(GAME, { recursive: true }, () => {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(async () => {
    if (fixer.busy) return; // the fixer reloads once when it's done
    const h = await hashDir(GAME);
    if (h === fixer.lastHash) return;
    fixer.lastHash = h;
    const version = session.bumpVersion();
    console.log(`[watch] game/ changed → v${version}`);
    hub.broadcast({ type: 'reload', version, reason: 'file change' });
  }, 200);
});

// ------------------------------------------------------------------ feedback intake
async function onFeedback(m) {
  const seq = session.nextSeq();
  session.card(m.id, { id: m.id, text: m.text, source: m.source, startAt: m.startAt, seq, status: 'queued' });
  let bundle = await buildBundle(session, m, seq);
  let text = (m.text || '').trim();
  if (!text && bundle.clipPath && TRANSCRIBE) {
    text = await transcribe(bundle.clipPath);
    if (text) bundle = await buildBundle(session, { ...m, text, clip: null }, seq);
  }
  if (text === null) {
    hub.card(m.id, 'failed', { summary: 'The transcriber failed. See the server log.' });
    return;
  }
  if (!text) {
    const mic = m.mic ? ` from ${m.mic.label} (loudest ${m.mic.peakDb} dB)` : '';
    hub.card(m.id, 'unheard', { summary: `No words heard${mic}. Check that mic, then hold T and talk.` });
    return;
  }
  hub.card(m.id, 'queued', { text, seq });
  console.log(`[feedback #${seq}] ${m.source}: ${text}`);
  const { frames, clip, ...fb } = m;
  fixer.enqueue({ type: 'feedback', fb: { ...fb, text }, bundle, seq });
}

function transcribe(file) {
  return new Promise((resolve) => {
    exec(TRANSCRIBE.replaceAll('{file}', JSON.stringify(file)), { timeout: 60000 }, (err, stdout) => {
      if (err) console.error('[transcribe]', err.message);
      resolve(err ? null : String(stdout).replace(/\s+/g, ' ').trim());
    });
  });
}

function welcome() {
  return {
    type: 'welcome',
    session: session.id,
    version: session.meta.version,
    resume: session.saved,
    history: session.cards.slice(-30),
    busy: fixer.busy,
    transcriber: !!TRANSCRIBE,
  };
}

// ------------------------------------------------------------------ http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webm': 'audio/webm' };

async function serveFile(res, base, rel) {
  const file = path.resolve(base, `.${path.posix.normalize(`/${rel}`)}`);
  if (!isInside(file, base)) return send(res, 403, 'forbidden');
  try {
    const body = await fsp.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    send(res, 404, 'not found');
  }
}

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/') return serveFile(res, PUBLIC, 'index.html');
  if (p.startsWith('/engine/')) return serveFile(res, PUBLIC, p.slice(1));
  const g = p.match(/^\/game@\d+\/(.+)$/);
  if (g) return serveFile(res, GAME, g[1]);
  if (p === '/api/snapshot') {
    const snap = session.snapshotAt(Number(url.searchParams.get('at')));
    return snap ? send(res, 200, snap, 'application/json') : send(res, 404, 'no snapshot');
  }
  if (p === '/api/state' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { await session.saveState(JSON.parse(body)); } catch { /* ignore */ }
    return send(res, 204, '');
  }
  if (p === '/api/session') return send(res, 200, { ...session.meta, dir: session.relDir }, 'application/json');
  send(res, 404, 'not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 * 1024 });
wss.on('connection', (ws) => {
  hub.clients.add(ws);
  ws.on('close', () => hub.clients.delete(ws));
  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try {
      switch (m.type) {
        case 'hello': ws.send(JSON.stringify(welcome())); break;
        case 'telemetry': session.ingest(m); break;
        case 'utterance': session.addUtterance(m); break;
        case 'audio-start': session.audioStart(m); break;
        case 'audio-chunk': session.audioChunk(m); break;
        case 'state-save': await session.saveState(m); break;
        case 'reload-result': hub.resolveReload(m); break;
        case 'feedback': await onFeedback(m); break;
        case 'undo': fixer.enqueue({ type: 'undo', fixId: m.fixId }); break;
        default: break;
      }
    } catch (err) {
      console.error(`[ws ${m.type}]`, err);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  livefix  →  http://localhost:${PORT}\n`);
  console.log(`  session   ${session.relDir}${session.saved ? '  (resuming saved progress)' : ''}`);
  console.log(`  fixer     ${describeFixer()}`);
  console.log('  hold T in the game and talk; edits in game/ hot-reload too\n');
});
