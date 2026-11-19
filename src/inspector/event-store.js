import fs from "node:fs";
import path from "node:path";

const STORES = new Set();
export function flushInspectorEventStores() { for (const store of STORES) store.flushSync(); }

export class InspectorEventStore {
  // 17-nov (lentitud): antes cada evento reescribía TODO el archivo con formato bonito (cientos de MB con el tiempo) y
  // bloqueaba el servidor casi un segundo por evento. Ahora se agrupan las escrituras (una cada `persistDelayMs` como
  // máximo, sin formato) y las lecturas usan una copia en caché que solo se reconstruye cuando llega un evento nuevo.
  constructor(filePath, maxPerConversation = 200, { persistDelayMs = 2000 } = {}) {
    this.filePath = filePath;
    this.maxPerConversation = maxPerConversation;
    this.persistDelayMs = persistDelayMs;
    this.data = {};
    this.queue = Promise.resolve();
    this.version = 0;
    this.cache = null;
    this.timer = null;
    this.pending = null;
    this.dirty = false;
    this.load();
    STORES.add(this);
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8").trim();
        this.data = raw ? JSON.parse(raw) : {};
      } else {
        this.persistSync();
      }
    } catch (error) {
      console.error("Inspector: no se pudo cargar timeline:", error);
      this.data = {};
    }
  }

  persistSync() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data), "utf8");
    fs.renameSync(temp, this.filePath);
    this.dirty = false;
  }

  // Programa una escritura (agrupada). Devuelve la promesa de esa escritura por si alguien necesita esperarla.
  persist() {
    this.dirty = true;
    if (this.pending) return this.pending;
    this.pending = new Promise(resolve => {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.queue = this.queue.then(async () => {
          this.pending = null;
          if (!this.dirty) return;
          this.dirty = false;
          await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
          const temp = `${this.filePath}.tmp`;
          await fs.promises.writeFile(temp, JSON.stringify(this.data), "utf8");
          await fs.promises.rename(temp, this.filePath);
        }).catch(error => console.error("Inspector: no se pudo guardar timeline:", error?.message || error)).then(resolve);
      }, this.persistDelayMs);
      this.timer.unref?.();
    });
    return this.pending;
  }

  // Escribe ya lo pendiente sin esperar al agrupado (pruebas y herramientas).
  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    await this.queue;
    if (this.dirty) { await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.tmp`; await fs.promises.writeFile(temp, JSON.stringify(this.data), "utf8"); await fs.promises.rename(temp, this.filePath); this.dirty = false; }
  }

  // Escribe ya lo pendiente (al apagar el servidor).
  flushSync() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; this.pending = null; }
    if (this.dirty) { try { this.persistSync(); } catch (error) { console.error("Inspector: no se pudo guardar timeline al cerrar:", error?.message || error); } }
  }

  touch() { this.version += 1; this.cache = null; }

  // Todos los eventos (con conversationId) en orden de tiempo + agrupados por conversación. Solo lectura: se comparten
  // entre llamadas hasta el siguiente evento, así que nadie debe modificarlos.
  index() {
    if (this.cache) return this.cache;
    const all = [], byConversation = new Map();
    for (const [key, events] of Object.entries(this.data)) {
      const conversationId = Number(key);
      if (!Number.isFinite(conversationId) || !Array.isArray(events)) continue;
      const list = events.map(event => ({ conversationId, ...event }));
      byConversation.set(conversationId, list);
      for (const event of list) all.push(event);
    }
    all.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    this.cache = { all, byConversation };
    return this.cache;
  }

  async record(conversationId, type, details = {}) {
    const key = String(conversationId);
    const events = Array.isArray(this.data[key]) ? this.data[key] : [];
    events.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      type,
      details,
    });
    // Se conserva siempre el primer evento: las Estadísticas lo usan como fecha en que llegó el cliente.
    this.data[key] = events.length > this.maxPerConversation ? [events[0], ...events.slice(-(this.maxPerConversation - 1))] : events;
    this.touch();
    this.persist();
  }

  get(conversationId) {
    return Array.isArray(this.data[String(conversationId)])
      ? structuredClone(this.data[String(conversationId)])
      : [];
  }

  listAll() {
    return this.index().all.slice();
  }

  stats() {
    const events = this.index().all;
    return { conversations: this.listConversationIds().length, events: events.length, lastEventAt: events.at(-1)?.timestamp || null };
  }

  listConversationIds() {
    return Object.keys(this.data)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
  }
}
