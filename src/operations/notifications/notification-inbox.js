// Buzón de notificaciones por persona (pedido 10-nov: "se les desaparece muy rápido" y "que tengan su pestaña
// de notificaciones"). Guarda los últimos avisos de cada usuario para que los vea después en Operations →
// Notificaciones, con leídos / no leídos. Se conservan 14 días, hasta 150 por persona.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PER_USER = 150;

export class NotificationInbox {
  constructor(file = null) {
    this.file = file;
    this.state = { users: {} };
    try { if (file) this.state = { users: {}, ...JSON.parse(fs.readFileSync(file, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer el buzón de notificaciones:", error.message); }
  }

  persist() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.state));
        fs.renameSync(tmp, this.file);
      } catch (error) { console.error("NEXT: no se pudo guardar el buzón de notificaciones:", error.message); }
    }, 1500);
    this.timer.unref?.();
  }

  add(usernames = [], n = {}, now = new Date()) {
    if (n.kind === "test") return null;
    const id = crypto.randomUUID();
    const item = { id, title: String(n.title || "").slice(0, 200), body: String(n.body || "").slice(0, 600), kind: n.kind || "info", url: n.url || null, sale_id: n.sale_id || null, at: now.toISOString(), read_at: null };
    const cutoff = now.getTime() - KEEP_MS;
    for (const username of new Set(usernames.filter(Boolean))) {
      const list = (this.state.users[username] || []).filter(i => Date.parse(i.at) >= cutoff);
      list.push({ ...item });
      this.state.users[username] = list.slice(-MAX_PER_USER);
    }
    this.persist();
    return id;
  }

  list(username, { limit = 100 } = {}) {
    const items = [...(this.state.users[username] || [])].reverse().slice(0, limit);
    return { items, unread: this.unread(username) };
  }

  unread(username) { return (this.state.users[username] || []).filter(i => !i.read_at).length; }

  // ids vacío = todas.
  markRead(username, ids = [], now = new Date()) {
    const wanted = new Set(ids);
    let changed = 0;
    for (const item of this.state.users[username] || []) {
      if (!item.read_at && (!wanted.size || wanted.has(item.id))) { item.read_at = now.toISOString(); changed++; }
    }
    if (changed) this.persist();
    return { changed, unread: this.unread(username) };
  }
}
