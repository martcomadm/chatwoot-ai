export class MessageBuffer {
  constructor(bufferMs, processor) { this.bufferMs = bufferMs; this.processor = processor; this.states = new Map(); }
  state(id) {
    if (!this.states.has(id)) this.states.set(id, { ids: new Set(), sources: new Set(), timer: null, processing: false, dirty: false, payload: null, webhookMessages: new Map() });
    return this.states.get(id);
  }
  enqueue(id, message, source, payload) {
    const state = this.state(id);
    state.payload = payload || state.payload;
    if (message?.id) { state.ids.add(String(message.id)); state.webhookMessages.set(String(message.id), message); }
    state.sources.add(source);
    if (state.processing) { state.dirty = true; return; }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => void this.flush(id), this.bufferMs);
  }
  async flush(id) {
    const state = this.state(id);
    if (state.processing) { state.dirty = true; return; }
    state.processing = true; state.timer = null;
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
