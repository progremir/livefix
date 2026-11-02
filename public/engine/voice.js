import { now } from './clock.js';
import { blobToB64, sleep, waitFor } from './util.js';

const WAKE = /^\s*(?:hey|ok|okay)?[\s,]*game\b[\s,.:!-]*(.*)$/i;
const toDb = (peak) => 20 * Math.log10(Math.max(peak, 1e-5));

/**
 * Microphone: one continuous recording for the whole session (stored next to the
 * telemetry, on the same clock), live speech-to-text for every utterance, and
 * push-to-talk clips for explicit feedback.
 */
export class Voice {
  constructor({ net, onPartial, onLevel, onUtterance, onWake }) {
    this.net = net;
    this.onPartial = onPartial;
    this.onLevel = onLevel;
    this.onUtterance = onUtterance;
    this.onWake = onWake;
    this.stream = null;
    this.rec = null;
    this.ptt = null;
    this.handsFree = false;
    this.speaking = false;
    this.sendChain = Promise.resolve();
    this.recognitionSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    this.status = 'off';
  }

  get enabled() { return !!this.stream; }

  async enable() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.#startMeter();
    this.#startContinuous();
    this.#startRecognition();
    this.status = this.recognitionSupported ? 'on' : 'on-no-stt';
    // Bluetooth mics stay silent for over a second while they switch profile.
    await waitFor(() => this.#peak() > 0, 3000);
  }

  get micLabel() { return this.stream?.getAudioTracks()[0]?.label || 'mic'; }

  #startMeter() {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(this.stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    this.#peak = () => {
      analyser.getFloatTimeDomainData(samples);
      return samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    };
  }

  #peak = () => 0;

  #mime() {
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  }

  #startContinuous() {
    const mime = this.#mime();
    const mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const startAt = now();
    const segment = `seg-${Math.round(startAt)}`;
    let seq = 0;
    this.net.send({ type: 'audio-start', segment, startAt, mime: mr.mimeType || mime });
    mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      const n = seq++;
      this.sendChain = this.sendChain.then(async () => {
        this.net.send({ type: 'audio-chunk', segment, seq: n, data: await blobToB64(e.data) });
      });
    };
    mr.start(2000);
    this.continuous = mr;
  }

  #startRecognition() {
    if (!this.recognitionSupported) return;
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new R();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    let startAt = null;
    let failures = 0;
    rec.onresult = (e) => {
      failures = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (startAt == null) startAt = now() - 300; // first partial lands ~300 ms after speech starts
        if (r.isFinal) {
          const s = startAt;
          startAt = null;
          if (text) this.#final({ startAt: s, endAt: now(), text, confidence: r[0].confidence });
        } else {
          if (this.ptt) this.ptt.partial = text;
          this.onPartial?.(text, !!this.ptt);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      // not-allowed, service-not-allowed, network (Chrome's recognizer is a cloud service), audio-capture…
      if (++failures >= 3 || e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.recognitionSupported = false;
        this.status = 'on-no-stt';
        this.onStatus?.(this.status, e.error);
      }
    };
    rec.onend = () => {
      startAt = null;
      if (this.recognitionSupported) setTimeout(() => { try { rec.start(); } catch { /* already running */ } }, 150 + failures * 500);
    };
    try { rec.start(); } catch { /* ignore */ }
    this.rec = rec;
  }

  #final(u) {
    const p = this.ptt;
    u.ptt = !!p;
    u.duringTts = this.speaking;
    if (p) {
      p.texts.push(u.text);
      p.partial = '';
    }
    this.net.send({ type: 'utterance', ...u });
    this.onUtterance?.(u);
    if (!p && this.handsFree && !u.duringTts) {
      const m = u.text.match(WAKE);
      if (m && m[1].trim().length > 2) this.onWake?.({ ...u, text: m[1].trim() });
    }
  }

  pttDown() {
    if (this.ptt) return false;
    const p = { startAt: now(), texts: [], partial: '', chunks: [], clipRec: null, peak: 0 };
    if (this.stream) {
      const mime = this.#mime();
      const mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      mr.ondataavailable = (e) => e.data.size && p.chunks.push(e.data);
      mr.start();
      p.clipRec = mr;
      p.meter = setInterval(() => {
        const peak = this.#peak();
        p.peak = Math.max(p.peak, peak);
        if (!p.partial) this.onLevel?.(toDb(peak));
      }, 50);
    }
    this.ptt = p;
    return true;
  }

  /** Resolves with { startAt, endAt, text, clip } once speech recognition has caught up. */
  async pttUp() {
    const p = this.ptt;
    if (!p || p.endAt) return null;
    p.endAt = now();
    clearInterval(p.meter);
    const clip = p.clipRec
      ? new Promise((res) => {
        p.clipRec.onstop = () => res(new Blob(p.chunks, { type: p.clipRec.mimeType }));
        p.clipRec.stop();
      })
      : Promise.resolve(null);
    if (this.rec && this.recognitionSupported) {
      await sleep(400);
      if (p.partial) {
        try { this.rec.stop(); } catch { /* forces the pending phrase to finalize */ }
      }
      await waitFor(() => !p.partial, 2000);
    }
    this.ptt = null;
    const text = [...p.texts, p.partial].join(' ').replace(/\s+/g, ' ').trim();
    return { startAt: p.startAt, endAt: p.endAt, text, clip: await clip, mic: { label: this.micLabel, peakDb: Math.round(toDb(p.peak)) } };
  }

  speak(text) {
    if (!window.speechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.08;
    u.onstart = () => { this.speaking = true; };
    u.onend = u.onerror = () => { setTimeout(() => { this.speaking = false; }, 400); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
