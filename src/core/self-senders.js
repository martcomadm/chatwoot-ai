import fs from "node:fs";
import path from "node:path";

// Cuentas de Chatwoot con las que Mia publica sus mensajes.
//
// El token de la API puede pertenecer a un usuario distinto del agente asignado
// (CHATWOOT_AI_AGENT_ID); por eso los mensajes de Mia pueden aparecer con otro
// sender_id. Para no confundirlos con mensajes de una persona del equipo, se aprende
// el sender_id de cada mensaje que Mia envía y se guarda en disco.

// Textos que siempre son de Mia aunque aún no se conozca su cuenta.
const OWN_TEXT_PATTERNS = [/^¡Gracias por escribir a MARTCOM! Nuestro horario de atención es/];

// 19-nov: parte del equipo escribe en Chatwoot con la misma cuenta que usa Mia ("Buenas tardes Sr. German… soy
// Adriana Rangel", "De las que le mande le queda la 093?"). Por la cuenta no se distinguen, así que además se
// guarda el id de cada mensaje que Mia envía (un renglón por mensaje en <archivo>.sent.log). Un mensaje de esa
// cuenta que Mia no envió, escrito después de empezar a registrar, es de una persona.
const SENT_KEEP_MS = 40 * 24 * 3600 * 1000;

export class SelfSenders {
  constructor(file = null, initial = []) {
    this.file = file;
    this.ids = new Set(initial.map(Number).filter(Boolean));
    this.sent = new Map();
    this.trackingSince = null;
    if (file) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, "utf8")) || {};
        for (const id of saved.ids || []) this.ids.add(Number(id));
        if (saved.tracking_since) this.trackingSince = Date.parse(saved.tracking_since) || null;
      }
      catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer self-senders:", error.message); }
      this.loadSent();
    }
  }

  get sentLog() { return this.file ? `${this.file.replace(/\.json$/, "")}.sent.log` : null; }

  loadSent() {
    const log = this.sentLog;
    let text = "";
    try { text = fs.readFileSync(log, "utf8"); } catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer los mensajes de Mia:", error.message); return; }
    const cutoff = Date.now() - SENT_KEEP_MS;
    let lines = 0;
    for (const line of text.split("\n")) {
      const [id, at] = line.trim().split(" ");
      if (!id) continue;
      lines++;
      const ts = Number(at) || 0;
      if (ts >= cutoff) this.sent.set(id, ts);
    }
    // Se compacta cuando ya sobran muchos renglones viejos.
    if (lines > this.sent.size * 1.5 + 1000) {
      try { fs.writeFileSync(log, [...this.sent].map(([id, ts]) => `${id} ${ts}`).join("\n") + "\n"); } catch {}
    }
  }

  saveMeta() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ ids: [...this.ids], tracking_since: this.trackingSince ? new Date(this.trackingSince).toISOString() : null }, null, 2));
    } catch (error) { console.error("NEXT: no se pudo guardar self-senders:", error.message); }
  }

  rememberSent(message) {
    const mid = message?.id;
    if (mid === undefined || mid === null || mid === "") return;
    const now = Date.now();
    this.sent.set(String(mid), now);
    if (!this.trackingSince) { this.trackingSince = now; this.saveMeta(); }
    if (this.sentLog) {
      try { fs.mkdirSync(path.dirname(this.sentLog), { recursive: true }); fs.appendFileSync(this.sentLog, `${mid} ${now}\n`); }
      catch (error) { console.error("NEXT: no se pudo registrar un mensaje de Mia:", error.message); }
    }
  }

  // Mensaje de la cuenta de Mia que Mia no envió (una persona del equipo con la misma cuenta).
  writtenByPerson(message) {
    if (!this.trackingSince) return false;
    if (this.sent.has(String(message?.id))) return false;
    const created = Number(message?.created_at || 0) * 1000;
    // Lo anterior a que se empezara a registrar se sigue tomando como de Mia.
    return created > this.trackingSince + 60 * 1000;
  }

  learn(message) {
    if (message && message.private !== true) this.rememberSent(message);
    const id = Number(message?.sender?.id || message?.sender_id || 0);
    if (!id || this.ids.has(id)) return;
    this.ids.add(id);
    this.saveMeta();
  }

  isOwn(message) {
    const text = String(message?.content || "").trim();
    if (OWN_TEXT_PATTERNS.some(re => re.test(text))) return true;
    const id = Number(message?.sender_id || message?.sender?.id || 0);
    if (id && this.ids.has(id)) return !this.writtenByPerson(message);
    return false;
  }

  // Ya se sabe distinguir a Mia de una persona que usa su misma cuenta.
  get tracking() { return Boolean(this.trackingSince); }

  // Envuelve el cliente de Chatwoot para aprender la cuenta en cada envío de Mia.
  wrap(chatwoot) {
    for (const method of ["sendMessage", "sendMessageWithAttachment", "sendTemplate"]) {
      const original = chatwoot[method]?.bind(chatwoot);
      if (!original) continue;
      chatwoot[method] = async (...args) => {
        const result = await original(...args);
        this.learn(result);
        return result;
      };
    }
    return chatwoot;
  }
}
