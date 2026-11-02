/** Tiny reconnecting WebSocket client with a send queue. */
export class Net {
  constructor(url) {
    this.url = url;
    this.handlers = new Map();
    this.queue = [];
    this.connected = false;
    this.#connect();
  }

  #connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.#emit('open');
      const q = this.queue;
      this.queue = [];
      for (const m of q) ws.send(m);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.#emit(msg.type, msg);
    };
    ws.onclose = () => {
      this.connected = false;
      this.#emit('close');
      setTimeout(() => this.#connect(), 1000);
    };
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  #emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  send(msg) {
    const s = JSON.stringify(msg);
    if (this.connected && this.ws.readyState === 1) this.ws.send(s);
    else if (this.queue.length < 2000) this.queue.push(s);
  }
}
