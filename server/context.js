import fsp from 'node:fs/promises';
import path from 'node:path';

export const LOOKBACK_MS = 10000;
const MAX_EVENT_ROWS = 160;
const DISCONTINUITY = new Set(['restore', 'resume', 'new-game']);

const sec = (ms) => `${ms >= 0 ? '+' : '−'}${Math.abs(ms / 1000).toFixed(2)}s`;
const clock = (at) => new Date(at).toISOString().slice(11, 23);
const compact = (o) => JSON.stringify(o ?? {}).replace(/"(\w+)":/g, '$1:');

/**
 * Writes the context bundle for one piece of feedback:
 *   feedback.md   what was said, lined up against the game timeline (t=0 = started talking)
 *   window.json   the raw telemetry for that window (+ snapshots, for tools/replay.mjs)
 *   frames/       screenshots, 4 per second
 *   voice.*       the push-to-talk audio clip, if any
 */
export async function buildBundle(session, fb, seq) {
  const name = String(seq).padStart(3, '0');
  const dir = path.join(session.dir, 'feedback', name);
  const relDir = path.relative(session.root, dir);
  await fsp.mkdir(path.join(dir, 'frames'), { recursive: true });

  const t0 = fb.startAt;
  const from = t0 - LOOKBACK_MS;
  const to = Math.max(fb.endAt || t0, t0) + 500;
  const w = session.window(from, to);
  const rel = (at) => at - t0;

  // Screenshots
  const frames = [];
  for (const [i, f] of (fb.frames || []).entries()) {
    const file = `frames/f${String(i).padStart(2, '0')}_t${sec(rel(f.at)).replace('−', '-')}.jpg`;
    await fsp.writeFile(path.join(dir, file), Buffer.from(f.data, 'base64'));
    frames.push({ file, at: f.at });
  }

  let clipFile = null;
  if (fb.clip?.data) {
    const ext = /ogg/.test(fb.clip.mime) ? 'ogg' : /mp4/.test(fb.clip.mime) ? 'm4a' : 'webm';
    clipFile = `voice.${ext}`;
    await fsp.writeFile(path.join(dir, clipFile), Buffer.from(fb.clip.data, 'base64'));
  }

  const feedback = { id: fb.id, seq, text: fb.text, source: fb.source, startAt: fb.startAt, endAt: fb.endAt, version: fb.version, error: fb.error ?? null };
  await fsp.writeFile(path.join(dir, 'window.json'), JSON.stringify({ feedback, ...w }));

  const md = renderMarkdown({ fb, seq, w, t0, rel, frames, clipFile, relDir, currentVersion: session.meta.version });
  await fsp.writeFile(path.join(dir, 'feedback.md'), md);
  return { dir, relDir, clipPath: clipFile ? path.join(dir, clipFile) : null };
}

function renderMarkdown({ fb, seq, w, t0, rel, frames, clipFile, relDir, currentVersion }) {
  const L = [];
  const src = { voice: 'voice, push-to-talk', handsfree: 'voice, hands-free', typed: 'typed', crash: 'automatic crash report (not said by the player)' }[fb.source] || fb.source;
  L.push(`# Feedback #${seq} (${src})`, '');
  L.push(`> ${fb.text || '(empty)'}`, '');
  const dur = (fb.endAt || t0) - t0;
  L.push(`- Started ${fb.source === 'typed' ? 'typing' : 'talking'} at ${clock(t0)} UTC${dur > 0 ? `, for ${(dur / 1000).toFixed(1)}s` : ''}. **All times below are relative to that moment (t=0).** People usually react 0.5–3 s after the thing they mean.`);
  L.push(`- Game code version then: v${fb.version}${currentVersion !== fb.version ? ` (current: v${currentVersion})` : ''}.`);
  if (fb.source === 'typed') L.push('- The game was paused while they typed, so nothing after t=0 is gameplay.');

  const s0 = nearest(w.samples, t0);
  if (s0) L.push(`- Player state at t=0: \`${compact(s0.d)}\``);
  L.push('');

  if (fb.error) {
    L.push('## Error', '', '```', fb.error.message, fb.error.stack || '', '```', '');
  }

  const said = w.utterances.filter((u) => u.text);
  if (said.length) {
    L.push('## What the player said around then', '');
    for (const u of said) L.push(`- ${sec(rel(u.startAt))} ${u.ptt ? '(feedback)' : '(said aloud)'}: “${u.text}”`);
    L.push('');
  }

  const marks = w.marks.filter((m) => !['ptt-start', 'ptt-end'].includes(m.type));
  if (marks.length) {
    L.push('## Engine marks (reloads, rewinds, pauses…)', '');
    for (const m of marks) {
      const { at, type, ...rest } = m;
      L.push(`- ${sec(rel(at))} **${type}**${DISCONTINUITY.has(type) ? ' (state jumped here)' : ''} ${Object.keys(rest).length ? compact(rest) : ''}`);
    }
    L.push('');
  }

  L.push(`## Game events (${sec(-LOOKBACK_MS)} … ${sec(w.to - t0)})`, '');
  let events = w.events;
  if (events.length > MAX_EVENT_ROWS) {
    events = [...events].sort((a, b) => Math.abs(a.at - t0) - Math.abs(b.at - t0)).slice(0, MAX_EVENT_ROWS).sort((a, b) => a.at - b.at);
    L.push(`(${w.events.length} events; showing the ${MAX_EVENT_ROWS} closest to t=0, all of them are in window.json)`, '');
  }
  if (!events.length) L.push('(no events)');
  else {
    L.push('| t | event | data |', '|---|---|---|');
    for (const e of events) L.push(`| ${sec(rel(e.at))} | ${e.type} | \`${compact(e.data)}\` |`);
  }
  L.push('');

  L.push('## Inputs (↓ pressed, ↑ released)', '');
  const held = w.inputsBefore?.d?.length ? `Held at window start: ${w.inputsBefore.d.join(', ')}. ` : '';
  const inputs = w.inputs.filter((i) => i.p.length || i.r.length).map((i) => `${sec(rel(i.at))} ${[...i.p.map((k) => `↓${k}`), ...i.r.map((k) => `↑${k}`)].join(' ')}`);
  L.push(held + (inputs.length ? inputs.join(' · ') : '(no input changes)'), '');

  L.push('## State samples, every 0.25 s (from describe())', '', '```');
  let lastAt = -Infinity;
  for (const s of w.samples) {
    if (s.at - lastAt < 240) continue;
    lastAt = s.at;
    L.push(`${sec(rel(s.at)).padStart(7)}  ${compact(s.d)}`);
  }
  L.push('```', '');

  const errs = w.errors;
  if (errs.length) {
    L.push('## Errors in this window', '');
    for (const e of errs) L.push(`- ${sec(rel(e.at))} [${e.phase}] ${e.message}`);
    L.push('');
  }

  L.push('## Screenshots', '');
  if (!frames.length) L.push('(none)');
  else {
    const key = pickKeyFrames(frames, w.events, t0);
    L.push(`${frames.length} frames in \`${relDir}/frames/\`, 4 per second, from ${sec(rel(frames[0].at))} to ${sec(rel(frames.at(-1).at))}.`);
    L.push(`Most useful ones to look at first: ${key.map((f) => `\`${f.file}\``).join(', ')}`);
  }
  L.push('');
  if (clipFile) L.push(`Push-to-talk audio: \`${relDir}/${clipFile}\``, '');

  L.push('## Reproduce / verify', '', 'Re-simulate this moment with the current code (nearest snapshot + the exact recorded inputs):', '',
    '```', `node tools/replay.mjs ${relDir}`, `node tools/replay.mjs ${relDir} --from -3 --to 1 --every 0.1`, '```', '');
  return L.join('\n');
}

function nearest(arr, at) {
  let best = null;
  for (const x of arr) if (!best || Math.abs(x.at - at) < Math.abs(best.at - at)) best = x;
  return best;
}

function pickKeyFrames(frames, events, t0) {
  const bad = events
    .filter((e) => /death|die|crash|hit|fail|error/i.test(e.type))
    .sort((a, b) => Math.abs(a.at - t0) - Math.abs(b.at - t0))
    .slice(0, 2)
    .map((e) => e.at);
  const out = [];
  for (const at of [t0 - 1500, t0, ...bad]) {
    const f = nearest(frames, at);
    if (f && !out.includes(f)) out.push(f);
  }
  return out.sort((a, b) => a.at - b.at);
}
