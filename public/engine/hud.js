const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (at) => new Date(at).toLocaleTimeString([], { hour12: false });

const STATUS = {
  queued: ['queued', 'warn'],
  working: ['Claude is on it…', 'warn'],
  applied: ['fixed', 'good'],
  nochange: ['no code change', ''],
  failed: ['failed', 'bad'],
  unheard: ['no words heard', 'bad'],
  undone: ['undone', ''],
  undo: ['undo', ''],
};

/** The sidebar and on-canvas overlays. Pure DOM, no framework. */
export class Hud {
  constructor(handlers) {
    this.h = handlers;
    this.cards = new Map();
    this.tts = $('tts').checked;
    $('handsFree').onchange = (e) => { this.h.onHandsFree?.(e.target.checked); e.target.blur(); };
    $('tts').onchange = (e) => { this.tts = e.target.checked; e.target.blur(); };
  }

  setConn(ok) { const el = $('conn'); el.textContent = ok ? 'live' : 'offline'; el.className = `pill ${ok ? 'good' : 'bad'}`; }
  setVersion(v) { $('ver').textContent = `v${v}`; }
  setMic(status) {
    const el = $('mic');
    const map = { off: ['mic off', ''], on: ['mic on', 'good'], 'on-no-stt': ['mic on (no speech-to-text)', 'warn'], denied: ['mic blocked', 'bad'], rec: ['● talking', 'rec'] };
    const [t, c] = map[status] || map.off;
    el.textContent = t;
    el.className = `pill ${c}`;
  }

  hideStart() { $('start').hidden = true; }

  caption(text) {
    const el = $('caption');
    if (text == null) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text || 'listening…';
  }

  toast(text, kind = '', ms = 4500) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('toasts').prepend(el);
    setTimeout(() => el.remove(), ms);
  }

  agentStatus(text, kind = '') { const el = $('agentStatus'); el.textContent = text; el.className = `pill ${kind}`; }

  agentLine(text, kind = 'tool') {
    const ol = $('agentLog');
    const li = document.createElement('li');
    li.className = kind;
    li.textContent = text;
    li.title = text;
    ol.append(li);
    while (ol.children.length > 80) ol.firstChild.remove();
    ol.scrollTop = ol.scrollHeight;
  }

  utterance(u) {
    const ol = $('transcript');
    const li = document.createElement('li');
    if (u.ptt) li.className = 'ptt';
    li.innerHTML = `<time>${clock(u.startAt)}</time>${u.ptt ? '🎙 ' : ''}${esc(u.text)}`;
    ol.append(li);
    while (ol.children.length > 60) ol.firstChild.remove();
    ol.scrollTop = ol.scrollHeight;
  }

  feedback({ id, text, source }) {
    const li = document.createElement('li');
    const icon = { voice: '🎙', typed: '⌨️', crash: '💥', handsfree: '🎙' }[source] || '💬';
    li.innerHTML = `<q>${icon} ${esc(text || '(no transcript)')}</q><div class="meta"><span class="pill warn">queued</span></div><div class="summary"></div><div class="actions"></div>`;
    $('fixes').prepend(li);
    this.cards.set(id, { li, data: { id, text, source } });
  }

  feedbackStatus({ id, status, text, summary, files, costUsd, ms, version, fixId, startAt }) {
    const card = this.cards.get(id);
    if (!card) return;
    if (text && !card.data.text) { // transcribed on the server
      card.data.text = text;
      card.li.querySelector('q').textContent = `🎙 ${text}`;
    }
    const [label, cls] = STATUS[status] || [status, ''];
    const bits = [`<span class="pill ${cls}">${esc(label)}</span>`];
    if (version) bits.push(`v${version}`);
    if (files?.length) bits.push(files.map(esc).join(', '));
    if (ms) bits.push(`${(ms / 1000).toFixed(0)}s`);
    if (costUsd) bits.push(`$${costUsd.toFixed(2)}`);
    card.li.querySelector('.meta').innerHTML = bits.join(' · ');
    if (summary != null) card.li.querySelector('.summary').textContent = summary;
    const actions = card.li.querySelector('.actions');
    actions.innerHTML = '';
    if (status === 'applied' || status === 'nochange') {
      if (startAt) actions.append(this.#btn('↺ Retry that moment', () => this.h.onRetry?.(startAt)));
      if (status === 'applied' && fixId) actions.append(this.#btn('Undo', () => this.h.onUndo?.(fixId)));
    }
    if (status === 'undone') card.li.classList.add('undone');
  }

  #btn(label, fn) {
    const b = document.createElement('button');
    b.className = 'small';
    b.textContent = label;
    b.onclick = (e) => { e.currentTarget.blur(); fn(); };
    return b;
  }

  /** Show the typed-feedback box. Resolves with the text, or null if cancelled. */
  prompt() {
    const form = $('typebox');
    const input = $('typeinput');
    form.hidden = false;
    input.value = '';
    input.focus();
    return new Promise((resolve) => {
      const done = (v) => {
        form.hidden = true;
        form.onsubmit = null;
        input.onkeydown = null;
        input.blur();
        resolve(v);
      };
      form.onsubmit = (e) => { e.preventDefault(); done(input.value.trim() || null); };
      input.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } e.stopPropagation(); };
    });
  }
}
