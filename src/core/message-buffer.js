export class MessageBuffer {
  // onError(conversationId, error, snapshot): se llama cuando procesar un turno falla.
  // Un error en una conversación nunca debe tumbar el servicio para las demás.
  constructor(bufferMs, processor, { onError = null } = {}) {
    this.bufferMs = bufferMs;
    this.processor = processor;
    this.onError = onError;
    this.states = new Map();
    this.seen = new Map();
    this.seenTtlMs = 15 * 60 * 1000;
    this.processingIds = new Set();
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
      if (this.seen.has(key) || this.processingIds.has(key)) return false;
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

  // Agenda un turno sin mensaje nuevo (p.ej. retomar chats que escribieron fuera de horario).
  // El processor decide qué mensajes atender; si la conversación ya está en proceso, se repite al terminar.
  wake(id, source = "wake") {
    const state = this.state(id);
    state.sources.add(source);
    if (state.processing) { state.dirty = true; return true; }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => void this.flush(id), this.bufferMs);
    return true;
  }

  resetConversation(id) {
    const keyPrefix=`${id}:`;
    const state=this.states.get(id);
    if(state?.timer) clearTimeout(state.timer);
    // Pending snapshots from before a LAB reset must never be processed as a new turn.
    // An already-running processor cannot be cancelled here, but clearing queued state
    // prevents delayed webhook/conversation_updated work from surviving the reset.
    if(state && !state.processing) this.states.delete(id);
    else if(state){ state.ids.clear(); state.sources.clear(); state.webhookMessages.clear(); state.payload=null; state.dirty=false; }
    for(const key of [...this.seen.keys()]) if(key.startsWith(keyPrefix)) this.seen.delete(key);
    return true;
  }

  async flush(id) {
    const state = this.state(id);
    if (state.processing) { state.dirty = true; return; }
    state.processing = true;
    state.timer = null;
    const snapshot = { ids: [...state.ids], sources: [...state.sources], payload: state.payload, webhookMessages: new Map(state.webhookMessages) };
    state.ids.clear(); state.sources.clear(); state.dirty = false;
    for (const messageId of snapshot.ids) this.processingIds.add(`${id}:${messageId}`);
    try { await this.processor(id, snapshot); }
    catch (error) {
      console.error(`NEXT: falló el procesamiento de la conversación ${id}:`, error?.stack || error?.message || error);
      try { await this.onError?.(id, error, snapshot); } catch (handlerError) { console.error("NEXT: también falló el registro del error:", handlerError?.message || handlerError); }
    }
    finally {
      for (const messageId of snapshot.ids) this.processingIds.delete(`${id}:${messageId}`);
      state.processing = false;
      for (const messageId of snapshot.ids) state.webhookMessages.delete(String(messageId));
      if (state.dirty || state.ids.size) {
        state.dirty = false;
        state.timer = setTimeout(() => void this.flush(id), this.bufferMs);
      }
    }
  }
}
