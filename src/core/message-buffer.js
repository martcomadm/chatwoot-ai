export class MessageBuffer {
  constructor(bufferMs, processor) {
    this.bufferMs = bufferMs;
    this.processor = processor;
    this.states = new Map();
    this.seen = new Map();
    this.seenTtlMs = 15 * 60 * 1000;
  }

  cleanupSeen() {
    const cutoff = Date.now() - this.seenTtlMs;
    for (const [key, timestamp] of this.seen.entries()) if (timestamp < cutoff) this.seen.delete(key);
  }

  state(id) {
    if (!this.states.has(id)) this.states.set(id, { ids: new Set(), sources: new Set(), timer: null, processing: false, dirty: false, payload: null, webhookMessages: new Map() });
    return this.states.get(id);
  }

  enqueue(id, message, source, payload) {
    const messageId = message?.id ? String(message.id) : null;
    if (messageId) {
      this.cleanupSeen();
      const key = `${id}:${messageId}`;
      if (this.seen.has(key)) return false;
      this.seen.set(key, Date.now());
    }

    const state = this.state(id);
    state.payload = payload || state.payload;
    if (messageId) { state.ids.add(messageId); state.webhookMessages.set(messageId, message); }
    state.sources.add(source);
    if (state.processing) { state.dirty = true; return true; }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => void this.flush(id), this.bufferMs);
    return true;
  }

  async flush(id) {
    const state = this.state(id);
    if (state.processing) { state.dirty = true; return; }
    state.processing = true;
    state.timer = null;
    const snapshot = { ids: [...state.ids], sources: [...state.sources], payload: state.payload, webhookMessages: new Map(state.webhookMessages) };
    state.ids.clear(); state.sources.clear(); state.dirty = false;
    try { await this.processor(id, snapshot); }
    finally {
      state.processing = false;
      for (const messageId of snapshot.ids) state.webhookMessages.delete(String(messageId));
      if (state.dirty || state.ids.size) {
        state.dirty = false;
        state.timer = setTimeout(() => void this.flush(id), this.bufferMs);
      }
    }
  }
}
