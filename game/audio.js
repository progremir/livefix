// Procedural sound effects via Web Audio API. No audio files needed.
let ac = null;

function getCtx() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function playSound(name) {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getCtx();
    switch (name) {
      case 'shoot': playShoot(ctx); break;
      case 'arrow_shoot': playArrowShoot(ctx); break;
      case 'jump': playJump(ctx); break;
      case 'double_jump': playDoubleJump(ctx); break;
      case 'step': playStep(ctx); break;
      case 'hit_wall': playHitWall(ctx); break;
      case 'hit_enemy': playHitEnemy(ctx); break;
    }
  } catch { /* audio not available */ }
}

function playShoot(ctx) {
  const t = ctx.currentTime;
  // Noise burst
  const len = ctx.sampleRate * 0.08;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
  const src = ctx.createBufferSource(); src.buffer = buf;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass';
  flt.frequency.setValueAtTime(4000, t); flt.frequency.exponentialRampToValueAtTime(500, t + 0.06);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  src.connect(flt); flt.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(t + 0.08);
  // Low thump
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(og); og.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.1);
}

function playArrowShoot(ctx) {
  const t = ctx.currentTime;
  const len = ctx.sampleRate * 0.12;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len) * 0.5;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const flt = ctx.createBiquadFilter(); flt.type = 'bandpass';
  flt.frequency.setValueAtTime(800, t); flt.frequency.exponentialRampToValueAtTime(2000, t + 0.1);
  flt.Q.value = 2;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(flt); flt.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(t + 0.12);
}

function playJump(ctx) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(500, t + 0.08);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.15);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.15);
}

function playDoubleJump(ctx) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(700, t + 0.06);
  osc.frequency.exponentialRampToValueAtTime(250, t + 0.12);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.12);
}

function playStep(ctx) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(80, t); osc.frequency.exponentialRampToValueAtTime(35, t + 0.05);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.06);
  // Tiny noise texture
  const len = ctx.sampleRate * 0.03;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.005)) * 0.3;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 800;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.06, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  src.connect(flt); flt.connect(ng); ng.connect(ctx.destination);
  src.start(t); src.stop(t + 0.03);
}

function playHitWall(ctx) {
  const t = ctx.currentTime;
  // Short metallic ping
  const osc = ctx.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(3200, t); osc.frequency.exponentialRampToValueAtTime(800, t + 0.04);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.05);
  // Tiny noise click
  const len = ctx.sampleRate * 0.02;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003));
  const src = ctx.createBufferSource(); src.buffer = buf;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  src.connect(ng); ng.connect(ctx.destination);
  src.start(t); src.stop(t + 0.02);
}

function playHitEnemy(ctx) {
  const t = ctx.currentTime;
  // Low thud
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(200, t); osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.1);
  // Wet splat noise
  const len = ctx.sampleRate * 0.06;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012)) * 0.6;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 1200;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.2, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  src.connect(flt); flt.connect(ng); ng.connect(ctx.destination);
  src.start(t); src.stop(t + 0.06);
}