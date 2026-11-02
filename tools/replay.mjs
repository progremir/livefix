#!/usr/bin/env node
// Re-simulates a recorded moment with the CURRENT game code.
//
//   node tools/replay.mjs <bundle dir> [--from <sec>] [--to <sec>] [--every <sec>]
//
// Times are seconds relative to when the player started talking (t=0); --from -3 means 3 s before.
// Starts from the nearest full-state snapshot at or before --from, feeds the exact recorded
// inputs tick by tick, and prints what happened originally next to what happens now.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { makeCtx, inputFrom } from '../public/engine/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirArg = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
if (!dirArg) {
  console.error('usage: node tools/replay.mjs <bundle dir> [--from <sec>] [--to <sec>] [--every <sec>]');
  process.exit(2);
}

const bundleDir = path.resolve(ROOT, dirArg);
const win = JSON.parse(fs.readFileSync(path.join(bundleDir, 'window.json'), 'utf8'));
const t0 = win.feedback.startAt;
const fromAt = t0 + opt('from', -4) * 1000;
const toAt = Number.isFinite(opt('to', NaN)) ? t0 + opt('to') * 1000 : win.to;
const every = Math.max(1, Math.round(opt('every', 0.5) * 60));

// Pick the snapshot: the latest one at or before --from, but never replay across a state jump
// (rewind, resume, new game): if one happened before t=0, start after it; if after, stop there.
const JUMPS = ['restore', 'resume', 'new-game'];
let snap = [...win.snapshots].reverse().find((s) => s.at <= fromAt) ?? win.snapshots[0];
if (!snap) {
  console.error('No snapshot in this window to start from.');
  process.exit(1);
}
const notes = [];
const jumpBefore = win.marks.filter((m) => JUMPS.includes(m.type) && m.at > snap.at && m.at <= t0).at(-1);
if (jumpBefore) {
  const after = win.snapshots.find((s) => s.at >= jumpBefore.at);
  if (after) {
    snap = after;
    notes.push(`the game state jumped (${jumpBefore.type}) at ${((jumpBefore.at - t0) / 1000).toFixed(2)}s, so the replay starts after it`);
  }
}
const jumpAfter = win.marks.find((m) => JUMPS.includes(m.type) && m.at > Math.max(snap.at, t0) && m.at < toAt);
if (jumpAfter) notes.push(`the game state jumped (${jumpAfter.type}) at +${((jumpAfter.at - t0) / 1000).toFixed(2)}s, so the replay stops there`);
const endAt = jumpAfter ? jumpAfter.at : toAt;

const atToSec = (at) => (at - t0) / 1000;
const tickRate = 60;
// Use recorded ticks to find the last tick before endAt (wall time and ticks diverge while paused).
const rec = [...win.samples, ...win.events, ...win.inputs, ...win.snapshots].filter((x) => x.at <= endAt && x.t >= snap.t);
const last = rec.reduce((m, x) => (x.t > m.t ? x : m), { t: snap.t, at: snap.at });
// ...plus up to 0.5 s more if the recording stops early (e.g. the tick that crashed was never recorded).
const endTick = Math.max(snap.t + 1, last.t + Math.min(30, Math.max(0, Math.round(((endAt - last.at) / 1000) * tickRate))));
const tickToSec = (t) => atToSec(snap.at) + (t - snap.t) / tickRate;
const fmt = (s) => `${s >= 0 ? '+' : '-'}${Math.abs(s).toFixed(2)}s`.padStart(7);
const compact = (o) => JSON.stringify(o ?? {}).replace(/"(\w+)":/g, '$1:');

const mod = await import(`${pathToFileURL(path.join(ROOT, 'game', 'main.js')).href}?v=${Date.now()}`);
const state = structuredClone(snap.state);
mod.migrate?.(state, makeCtx(state, snap.t));

// Inputs: what was held at the snapshot, then every recorded change by tick.
const allInputs = [win.inputsBefore, ...win.inputs].filter(Boolean);
let held = [...allInputs].reverse().find((i) => i.t <= snap.t)?.d ?? [];
const byTick = new Map(allInputs.filter((i) => i.t > snap.t && i.t <= endTick).map((i) => [i.t, i]));

const replayed = [];
const states = [];
for (let t = snap.t + 1; t <= endTick; t++) {
  const rec = byTick.get(t);
  if (rec) held = rec.d;
  const input = rec ? inputFrom(rec.d, rec.p, rec.r, rec.m) : inputFrom(held);
  try {
    mod.update(state, input, makeCtx(state, t, (type, data = {}) => replayed.push({ t, type, data })));
  } catch (err) {
    console.log(`\n💥 update() threw at ${fmt(tickToSec(t))}: ${err.stack}`);
    process.exit(1);
  }
  if ((t - snap.t) % every === 0 || t === endTick) states.push({ t, d: mod.describe ? mod.describe(state) : null });
}

const recorded = win.events.filter((e) => e.t > snap.t && e.t <= endTick);
const reloads = win.marks.filter((m) => ['reload', 'rollback'].includes(m.type) && m.at > snap.at && m.at <= endAt);

console.log(`Replay ${fmt(tickToSec(snap.t))} → ${fmt(tickToSec(endTick))} (ticks ${snap.t}→${endTick}) with the CURRENT code in game/.`);
console.log(`Started from the snapshot at ${fmt(atToSec(snap.at))} (recorded on v${snap.v}); ${byTick.size} input changes replayed.`);
for (const n of notes) console.log(`Note: ${n}.`);
if (reloads.length) console.log(`Note: the code changed during the original window (${reloads.map((m) => `${m.type} at ${fmt(atToSec(m.at)).trim()}`).join(', ')}).`);

console.log('\nRecorded events (what the player actually saw):');
for (const e of recorded) console.log(`  ${fmt(tickToSec(e.t))}  ${e.type} ${compact(e.data)}`);
if (!recorded.length) console.log('  (none)');

console.log('\nReplayed events (current code):');
for (const e of replayed) console.log(`  ${fmt(tickToSec(e.t))}  ${e.type} ${compact(e.data)}`);
if (!replayed.length) console.log('  (none)');

const count = (list) => list.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
const a = count(recorded);
const b = count(replayed);
const diffs = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => (a[k] || 0) !== (b[k] || 0)).map((k) => `${k}: ${a[k] || 0} → ${b[k] || 0}`);
console.log(`\nEvent count changes (recorded → replayed): ${diffs.length ? diffs.join(', ') : 'none'}`);

if (states.length && states[0].d) {
  console.log(`\nReplayed state every ${(every / 60).toFixed(2)}s:`);
  for (const s of states) console.log(`  ${fmt(tickToSec(s.t))}  ${compact(s.d)}`);
}
