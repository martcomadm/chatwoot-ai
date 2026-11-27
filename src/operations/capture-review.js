import { readJson, writeJson } from "./access/json-file.js";

// Revisión de semanas con Captura (pedido 2-nov): si el cliente solo quiere revisar sus semanas cotizadas,
// Mia lo pasa con un capturista. Turnos entre las personas activas del área Captura que tienen ID de Chatwoot;
// la conversación se les asigna y reciben aviso en Operations.
export class CaptureReviewRouter {
  constructor({ users, chatwoot = null, notifier = null, file = null, logger = console, area = "captura", title = "Cliente quiere revisar sus semanas", url = "/operations" }) {
    this.area = area;
    this.title = title;
    this.url = url;
    this.users = users;
    this.chatwoot = chatwoot;
    this.notifier = notifier;
    this.file = file;
    this.logger = logger;
    this.data = file ? readJson(file, { last: null }) : { last: null };
  }

  agents() {
    return (this.users?.list?.() || []).filter(u => u.active && (u.areas || []).includes(this.area) && u.chatwoot_agent_id).sort((a, b) => a.username.localeCompare(b.username));
  }

  next() {
    const agents = this.agents();
    if (!agents.length) return null;
    const index = agents.findIndex(a => a.username === this.data.last);
    const agent = agents[(index + 1) % agents.length];
    this.data.last = agent.username;
    if (this.file) writeJson(this.file, this.data);
    return agent;
  }

  async route({ conversationId, reason = "", customer = {} }) {
    const agent = this.next();
    const everyone = (this.users?.list?.() || []).filter(u => u.active && (u.areas || []).includes(this.area)).map(u => u.username);
    let assigned = false;
    if (agent && this.chatwoot?.assignConversation) {
      try { await this.chatwoot.assignConversation(conversationId, Number(agent.chatwoot_agent_id)); assigned = true; }
      catch (error) { this.logger.warn?.(`Revisión de semanas: no se pudo asignar ${conversationId}:`, error?.message || error); }
    }
    try {
      await this.notifier?.notify?.({ kind: "new", to: agent ? [agent.username] : everyone, title: this.title, body: `${customer.nombre || "Cliente"}${reason ? ` · ${String(reason).slice(0, 90)}` : ""} · conversación #${conversationId}`, url: String(this.url).replace("{id}", conversationId) });
    } catch {}
    return { agent: agent ? { username: agent.username, name: agent.name, chatwoot_agent_id: agent.chatwoot_agent_id } : null, assigned };
  }
}
