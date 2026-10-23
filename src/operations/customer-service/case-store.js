import { EventEmitter } from "node:events";
import { readJson, writeJson } from "../access/json-file.js";

// Casos de Atención a Clientes: ventas completadas, casos que Mia canaliza y clientes que vuelven
// a escribir. Cada caso tiene responsable (asignado por rotación) y estado.
export const CASE_STATUSES = Object.freeze({ NEW: "new", IN_PROGRESS: "in_progress", FOLLOWING: "following", RESOLVED: "resolved" });
export const OPEN_STATUSES = new Set(["new", "in_progress", "following"]);
export const CASE_KIND_LABELS = Object.freeze({ completed_sale: "Venta completada", specialized: "Canalizado por Mia", returning: "Cliente activo escribió", escalated: "Enviado por un área" });
export const CASE_STATUS_LABELS = Object.freeze({ new: "Nuevo", in_progress: "Atendiendo", following: "En seguimiento", resolved: "Atendido" });

const now = () => new Date().toISOString();
const clone = v => structuredClone(v);

export class CaseStore extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.data = readJson(file, { seq: 0, cases: {}, rotation: { last: null } });
    this.data.cases ||= {};
    this.data.rotation ||= { last: null };
    this.currentActor = null;
  }

  persist() { writeJson(this.file, this.data); }

  runAs(actor, fn) {
    const previous = this.currentActor;
    this.currentActor = actor || null;
    try { return fn(); } finally { this.currentActor = previous; }
  }

  get(id) { const c = this.data.cases[id]; return c ? clone(c) : null; }

  list({ status = null } = {}) {
    let items = Object.values(this.data.cases);
    if (status === "open") items = items.filter(c => OPEN_STATUSES.has(c.status));
    else if (status) items = items.filter(c => c.status === status);
    return items.map(clone).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  forConversation(conversationId) {
    return Object.values(this.data.cases).filter(c => Number(c.conversation_id) === Number(conversationId)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map(clone);
  }

  openForConversation(conversationId) { return this.forConversation(conversationId).filter(c => OPEN_STATUSES.has(c.status)).at(-1) || null; }

  create(input = {}) {
    const date = now().slice(0, 10).replace(/-/g, "");
    this.data.seq = Number(this.data.seq || 0) + 1;
    const id = `AC-${date}-${String(this.data.seq).padStart(5, "0")}`;
    const timestamp = now();
    this.data.cases[id] = {
      case_id: id,
      conversation_id: Number(input.conversation_id) || null,
      sale_id: input.sale_id || null,
      kind: input.kind || "specialized",
      reason: input.reason || null,
      customer: { nombre: input.customer?.nombre || null, telefono: input.customer?.telefono || null, plan: input.customer?.plan || null },
      status: CASE_STATUSES.NEW,
      assignee: null,
      pending_assignment: true,
      created_at: timestamp, updated_at: timestamp, resolved_at: null,
      events: [],
    };
    this.addEvent(id, "case.created", { kind: input.kind, reason: input.reason || null });
    this.persist();
    const c = this.get(id);
    this.emit("case", { type: "case.created", case: c });
    return c;
  }

  update(id, patch, type, details = {}) {
    const current = this.data.cases[id];
    if (!current) throw new Error("Caso no encontrado");
    this.data.cases[id] = { ...current, ...patch, updated_at: now() };
    this.addEvent(id, type, details);
    this.persist();
    const c = this.get(id);
    this.emit("case", { type, case: c, details });
    return c;
  }

  addEvent(id, type, details = {}) {
    const c = this.data.cases[id];
    c.events ||= [];
    c.events.push({ type, at: now(), details, actor: this.currentActor ? { ...this.currentActor } : null });
    if (c.events.length > 200) c.events = c.events.slice(-200);
  }

  rotationLast() { return this.data.rotation.last || null; }
  setRotationLast(username) { this.data.rotation.last = username; this.persist(); }
}
