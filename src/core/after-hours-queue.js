import fs from "node:fs";
import path from "node:path";

// Chats que escribieron fuera del horario de atención. Se guardan en disco para que
// sobrevivan a un reinicio, y al abrir Mia los retoma en el orden en que llegaron.
export class AfterHoursQueue {
  constructor(file) {
    this.file = file;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(file, "utf8")) || {}; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer la cola fuera de horario:", error.message); }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  add(conversationId, messageIds = [], now = new Date()) {
    const key = String(conversationId);
    const entry = this.data[key] || { ids: [], first_at: now.toISOString() };
    entry.ids = [...new Set([...entry.ids, ...messageIds.map(String)])];
    entry.last_at = now.toISOString();
    this.data[key] = entry;
    this.persist();
    return entry;
  }

  has(conversationId) { return Boolean(this.data[String(conversationId)]); }

  // Saca la conversación de la cola y devuelve lo que tenía (o null).
  take(conversationId) {
    const key = String(conversationId);
    const entry = this.data[key];
    if (!entry) return null;
    delete this.data[key];
    this.persist();
    return entry;
  }

  // Conversaciones pendientes, la más antigua primero.
  list() {
    return Object.entries(this.data)
      .map(([conversationId, entry]) => ({ conversationId: Number(conversationId), ...entry }))
      .sort((a, b) => String(a.first_at).localeCompare(String(b.first_at)));
  }

  size() { return Object.keys(this.data).length; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Revisa cada `intervalMs` si ya es horario de atención y, si hay chats pendientes,
// los despierta uno por uno con `spacingMs` de separación para no contestar todo de golpe.
// `wake(conversationId)` debe encolar el turno (MessageBuffer.wake) y no esperar la respuesta.
export function startAfterHoursResume({ queue, isOpen, wake, intervalMs = 60_000, spacingMs = 8_000, log = console }) {
  let draining = false;
  async function drain() {
    if (draining || !isOpen() || !queue.size()) return 0;
    draining = true;
    let woken = 0;
    try {
      for (const { conversationId } of queue.list()) {
        if (!isOpen()) break;
        if (!queue.has(conversationId)) continue;
        if (woken) await sleep(spacingMs);
        wake(conversationId);
        woken++;
      }
      if (woken) log.log?.(`NEXT: se retomaron ${woken} chats que escribieron fuera de horario.`);
    } catch (error) {
      log.error?.("NEXT: falló la reanudación de chats fuera de horario:", error?.message || error);
    } finally { draining = false; }
    return woken;
  }
  const timer = setInterval(() => void drain(), intervalMs);
  timer.unref?.();
  return { drain, stop: () => clearInterval(timer) };
}
