import crypto from "node:crypto";
import { readJson, writeJson } from "./json-file.js";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function digest(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

// Sesiones de Operations. Solo se guarda el hash del token, nunca el token, y se
// persisten en disco para que un reinicio del servicio no saque a todos.
export class SessionStore {
  constructor(file, ttlMs = SESSION_TTL_MS) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.data = readJson(file, { sessions: {} });
    this.data.sessions ||= {};
    this.prune();
  }

  persist() { writeJson(this.file, this.data, 0o600); }

  prune() {
    const cutoff = Date.now();
    let changed = false;
    for (const [key, session] of Object.entries(this.data.sessions)) {
      if (Date.parse(session.expires_at) <= cutoff) { delete this.data.sessions[key]; changed = true; }
    }
    if (changed) this.persist();
  }

  create(username) {
    const token = crypto.randomBytes(32).toString("base64url");
    const createdAt = new Date();
    this.data.sessions[digest(token)] = {
      username,
      created_at: createdAt.toISOString(),
      expires_at: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
    };
    this.persist();
    return { token, expiresAt: this.data.sessions[digest(token)].expires_at };
  }

  get(token) {
    if (!token) return null;
    const session = this.data.sessions[digest(token)];
    if (!session) return null;
    if (Date.parse(session.expires_at) <= Date.now()) { this.destroy(token); return null; }
    return { ...session };
  }

  destroy(token) {
    const key = digest(token);
    if (!this.data.sessions[key]) return false;
    delete this.data.sessions[key];
    this.persist();
    return true;
  }

  destroyForUser(username, exceptToken = null) {
    const keep = exceptToken ? digest(exceptToken) : null;
    let removed = 0;
    for (const [key, session] of Object.entries(this.data.sessions)) {
      if (session.username === username && key !== keep) { delete this.data.sessions[key]; removed += 1; }
    }
    if (removed) this.persist();
    return removed;
  }
}
