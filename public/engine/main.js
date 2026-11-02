import * as THREE from './vendor/three.module.min.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Recorder } from './recorder.js';
import { Engine } from './core.js';
import { Voice } from './voice.js';
import { Hud } from './hud.js';
import { now } from './clock.js';
import { blobToB64 } from './util.js';

window.THREE = THREE; // for game code, which render() may use without importing it

const LOOKBACK_MS = 10000; // how far before you start talking the fixer looks

const canvas = document.getElementById('game');
const net = new Net(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const input = new Input();
const recorder = new Recorder(net, canvas);
const engine = new Engine({ canvas, recorder, input });
let serverInfo = {};
let started = false;

const hud = new Hud({
  onHandsFree: (on) => { voice.handsFree = on; },
  onUndo: (fixId) => net.send({ type: 'undo', fixId }),
  onRetry: (startAt) => retryMoment(startAt),
});

const voice = new Voice({
  net,
  onPartial: (text, inPtt) => { if (inPtt) hud.caption(text); },
  onLevel: (db) => hud.caption(`${voice.micLabel} ${'▮'.repeat(Math.max(0, Math.min(10, Math.round((db + 60) / 5))))}`),
  onUtterance: (u) => hud.utterance(u),
  onWake: (u) => submitFeedback({ text: u.text, startAt: u.startAt, endAt: u.endAt, source: 'handsfree' }),
});
voice.onStatus = (status, why) => {
  hud.setMic(micStatus());
  if (!serverInfo.transcriber) hud.toast(`Speech-to-text stopped working (${why}). Your voice is still recorded; T now opens the text box.`, 'bad', 8000);
};

// ---------------------------------------------------------------- server → browser
net.on('open', () => { hud.setConn(true); net.send({ type: 'hello' }); });
net.on('close', () => hud.setConn(false));

net.on('welcome', async (m) => {
  serverInfo = m;
  if (!engine.mod) {
    await engine.boot(m.version, m.resume);
    hud.setVersion(engine.version);
    for (const f of m.history || []) { hud.feedback(f); hud.feedbackStatus(f); }
    if (m.resume) hud.toast('Resumed your last session right where you left off', 'good');
  } else if (m.version !== engine.version) {
    await applyReload(m.version, 'reconnected');
  }
  hud.agentStatus(m.busy ? 'working' : 'idle', m.busy ? 'warn' : '');
  if (voice.enabled) hud.setMic(micStatus());
});

net.on('reload', (m) => applyReload(m.version, m.reason));

net.on('agent', (m) => {
  if (m.status) hud.agentStatus(m.status, m.kind || '');
  if (m.line) hud.agentLine(m.line, m.lineKind || 'tool');
});

net.on('feedback-status', (m) => {
  hud.feedbackStatus(m);
  if (m.status === 'applied') {
    hud.toast(`🔧 ${m.summary || 'Fixed'}`, 'good', 7000);
    if (hud.tts) voice.speak(m.summary);
  } else if (m.status === 'nochange' && m.summary) {
    hud.toast(`💬 ${m.summary}`, '', 7000);
    if (hud.tts) voice.speak(m.summary);
  } else if (m.status === 'failed') {
    hud.toast(`Fix failed: ${m.summary || 'unknown error'}`, 'bad', 8000);
  } else if (m.status === 'unheard') {
    hud.toast(`🎙 ${m.summary}`, 'bad', 8000);
  } else if (m.status === 'undone') {
    hud.toast('↩ Undone', '', 3000);
  }
});

net.on('toast', (m) => hud.toast(m.text, m.kind));

async function applyReload(version, reason) {
  const res = await engine.hotSwap(version, reason);
  net.send({ type: 'reload-result', version, ok: res.ok, error: res.error || null });
  hud.setVersion(engine.version);
  if (!res.ok) hud.toast(`New code rejected before it touched your game: ${res.error.message}`, 'bad', 8000);
  else if (!res.same && reason === 'file change') hud.toast(`↻ Reloaded v${version}. Progress intact.`, 'good');
}

// ---------------------------------------------------------------- controls
addEventListener('keydown', (e) => {
  if (!started || e.target.closest?.('input, textarea, button')) return;
  if (e.code === 'KeyT') { e.preventDefault(); if (!e.repeat) startTalk(); }
  else if (e.code === 'Enter') { e.preventDefault(); typeFeedback(); }
  else if (e.code === 'Backspace') { e.preventDefault(); if (engine.rewind(5)) hud.toast('⏪ Rewound 5 seconds'); }
  else if (e.code === 'Escape') {
    e.preventDefault();
    if (!usesPointerLock()) setPaused(!engine.paused);
    else if (engine.paused) lockPointer();
    else if (document.pointerLockElement) document.exitPointerLock();
    else setPaused(true);
  }
});
addEventListener('keyup', (e) => { if (e.code === 'KeyT') endTalk(); });

const usesPointerLock = () => !!engine.mod?.meta?.pointerLock;

function lockPointer() {
  if (usesPointerLock()) canvas.requestPointerLock()?.catch?.(() => {});
}

canvas.addEventListener('click', () => { if (started && !typing) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  if (!started || typing) return;
  setPaused(!document.pointerLockElement);
});

function setPaused(on) {
  engine.paused = on;
  recorder.paused = on;
  recorder.mark(on ? 'pause' : 'unpause');
}

const micStatus = () => (voice.status === 'on-no-stt' && serverInfo.transcriber ? 'on' : voice.status);

let talking = false;
function startTalk() {
  if (!voice.enabled) { typeFeedback(); return; }
  if (!voice.pttDown()) return;
  talking = true;
  hud.setMic('rec');
  hud.caption('');
  recorder.mark('ptt-start');
}

async function endTalk() {
  if (!talking) return;
  talking = false;
  hud.setMic(micStatus());
  const r = await voice.pttUp();
  hud.caption(null);
  if (!r) return;
  recorder.mark('ptt-end');
  if (r.text) return submitFeedback({ ...r, source: 'voice' });
  if (r.clip?.size && serverInfo.transcriber) return submitFeedback({ ...r, text: '', source: 'voice' });
  if (!voice.recognitionSupported) {
    hud.toast('No speech-to-text in this browser (Chrome/Edge have it). Type it instead.', 'bad', 6000);
    typeFeedback(r.startAt);
  } else {
    hud.toast("Didn't catch that. Hold T and try again, or press Enter to type.", 'bad');
  }
}

let typing = false;
async function typeFeedback(startAt = now()) {
  if (typing) return;
  typing = true;
  const wasPaused = engine.paused;
  if (document.pointerLockElement) document.exitPointerLock();
  engine.paused = true;
  recorder.paused = true;
  input.setEnabled(false);
  const text = await hud.prompt();
  input.setEnabled(true);
  engine.paused = wasPaused;
  recorder.paused = wasPaused;
  typing = false;
  lockPointer();
  if (text) submitFeedback({ text, startAt, endAt: startAt, source: 'typed' });
}

let fbSeq = 0;
async function submitFeedback({ text, startAt, endAt, source, clip, mic, error }) {
  const id = `fb${Date.now().toString(36)}${fbSeq++}`;
  hud.feedback({ id, text, source });
  recorder.flush(); // make sure the server has the telemetry up to this moment
  const end = Math.max(startAt, endAt || startAt);
  const frames = await recorder.framesBetween(startAt - LOOKBACK_MS, end + 500);
  net.send({
    type: 'feedback', id, text, source, startAt, endAt: end, version: engine.version, frames,
    error: error || null,
    mic: mic || null,
    clip: clip?.size ? { mime: clip.type, data: await blobToB64(clip) } : null,
  });
}

const crashSeen = new Map();
engine.onCrash = (info) => {
  hud.setVersion(engine.version);
  if (info.at - (crashSeen.get(info.message) || 0) < 30000) return;
  crashSeen.set(info.message, info.at);
  hud.toast(info.rolledBack
    ? `💥 The new code crashed, so I put v${engine.version} back. Asking Claude to fix it…`
    : `💥 ${info.message}`, 'bad', 8000);
  submitFeedback({ text: `The game threw an error during ${info.phase}: ${info.message}`, startAt: info.at, endAt: info.at, source: 'crash', error: info });
};

async function retryMoment(startAt) {
  const res = await fetch(`/api/snapshot?at=${Math.round(startAt - 4000)}`);
  if (!res.ok) { hud.toast('No snapshot saved for that moment', 'bad'); return; }
  const snap = await res.json();
  engine.restore(snap.state, 'retry moment');
  hud.toast('↺ Back to just before that moment, now running the new code', 'good');
}

// ---------------------------------------------------------------- persistence
setInterval(() => {
  if (started && engine.state) net.send({ type: 'state-save', state: engine.state, tick: engine.tick, version: engine.version });
}, 2000);
addEventListener('pagehide', () => {
  if (!started || !engine.state) return;
  const body = JSON.stringify({ state: engine.state, tick: engine.tick, version: engine.version });
  navigator.sendBeacon('/api/state', new Blob([body], { type: 'application/json' }));
});

// ---------------------------------------------------------------- start
document.getElementById('startMic').onclick = async () => {
  try {
    await voice.enable();
    hud.setMic(micStatus());
  } catch (err) {
    hud.setMic('denied');
    hud.toast(`Mic unavailable (${err.message}). T opens the text box instead.`, 'bad', 7000);
  }
  start();
};
document.getElementById('startNoMic').onclick = () => start();

function start() {
  started = true;
  hud.hideStart();
  document.activeElement?.blur();
  setPaused(false);
  lockPointer();
  recorder.mark('play-start', { mic: voice.enabled });
}

// handy for debugging from the console
Object.assign(window, { livefix: { engine, recorder, voice, net } });
