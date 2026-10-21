import { CASE_KIND_LABELS, CASE_STATUSES, OPEN_STATUSES } from "./case-store.js";

// Rotación y vida de los casos de Atención a Clientes.
// - Entran: venta completada (pago validado), casos que Mia canaliza y clientes con su trámite
//   completado que vuelven a escribir (estos, de preferencia, con quien los atendió la última vez).
// - Se asignan por turnos entre las personas activas del área "Atención a Clientes" (Admin las da de
//   alta con su ID de Chatwoot); la conversación también se les asigna en Chatwoot.
// - Fuera del horario de atención el caso espera y se asigna al abrir.
const clip = (t, n = 140) => { const v = String(t || "").replace(/\s+/g, " ").trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };

export class CustomerService {
  constructor({ store, users, chatwoot = null, notifier = null, isOpen = () => true, logger = console }) {
    this.store = store;
    this.users = users;
    this.chatwoot = chatwoot;
    this.notifier = notifier;
    this.isOpen = isOpen;
    this.logger = logger;
    this.lastPing = new Map();
  }

  agents() {
    return (this.users?.list?.() || []).filter(u => u.active && (u.areas || []).includes("atencion")).sort((a, b) => a.username.localeCompare(b.username));
  }

  // Siguiente persona en la rotación (o la preferida si sigue activa en el área).
  nextAgent(prefer = null) {
    const agents = this.agents();
    if (!agents.length) return null;
    if (prefer) { const p = agents.find(a => a.username === prefer); if (p) return p; }
    const last = this.store.rotationLast();
    const index = agents.findIndex(a => a.username === last);
    const next = agents[(index + 1) % agents.length];
    this.store.setRotationLast(next.username);
    return next;
  }

  async openCase({ conversation_id, kind, reason = null, sale = null, customer = {}, prefer = null }) {
    const existing = conversation_id ? this.store.openForConversation(conversation_id) : null;
    if (existing) {
      // Ya hay un caso abierto: no se duplica; se anota el nuevo motivo.
      return this.store.update(existing.case_id, {}, "case.note", { note: `${CASE_KIND_LABELS[kind] || kind}${reason ? `: ${clip(reason, 200)}` : ""}` });
    }
    const created = this.store.create({
      conversation_id, kind, reason,
      sale_id: sale?.sale_id || null,
      customer: { nombre: sale?.customer?.nombre || customer.nombre || null, telefono: sale?.customer?.telefono || customer.telefono || null, plan: sale?.sale?.plan || customer.plan || null },
    });
    return this.assign(created, { prefer });
  }

  async assign(c, { prefer = null, username = null, by = null } = {}) {
    if (!username && !this.isOpen()) return c; // espera a la apertura (tick)
    const agent = username ? this.agents().find(a => a.username === username) : this.nextAgent(prefer);
    if (!agent) {
      const updated = this.store.update(c.case_id, { pending_assignment: true }, "case.unassigned", { reason: "sin_personas_en_area" });
      await this.notify(updated, "Caso de Atención a Clientes sin responsable", "Agrega personas al área Atención a Clientes en Admin.", this.supervisors());
      return updated;
    }
    const assignee = { username: agent.username, name: agent.name, chatwoot_agent_id: agent.chatwoot_agent_id || null, assigned_at: new Date().toISOString() };
    let chatwootAssigned = false;
    if (c.conversation_id && agent.chatwoot_agent_id && this.chatwoot?.assignConversation) {
      try { await this.chatwoot.assignConversation(c.conversation_id, agent.chatwoot_agent_id); chatwootAssigned = true; }
      catch (error) { this.logger.warn?.(`Atención a Clientes: no se pudo asignar en Chatwoot ${c.conversation_id}:`, error?.message || error); }
    }
    const updated = this.store.runAs(by, () => this.store.update(c.case_id, { assignee, pending_assignment: false }, "case.assigned", { to: agent.username, to_name: agent.name, chatwoot: chatwootAssigned, by_rotation: !username }));
    if (agent.username !== by?.username) await this.notify(updated, "Nuevo caso de Atención a Clientes", `${updated.customer?.nombre || "Cliente"} · ${CASE_KIND_LABELS[updated.kind] || updated.kind}${updated.reason ? ` · ${clip(updated.reason, 80)}` : ""}`, [agent.username]);
    return updated;
  }

  supervisors() { return (this.users?.list?.() || []).filter(u => u.active && (u.areas || []).includes("supervision")).map(u => u.username); }

  async notify(c, title, body, to) {
    if (!this.notifier || !to?.length) return;
    try { await this.notifier.notify({ kind: "service", to, title, body, url: `/operations?area=atencion&case=${encodeURIComponent(c.case_id)}`, sale_id: c.case_id }); } catch {}
  }

  // El cliente escribió. Con caso abierto: aviso a su responsable (máx. uno cada 10 min).
  // Sin caso abierto y con su trámite completado: se abre un caso con quien lo atendió antes.
  async customerWrote(conversationId, text, { sale = null } = {}, nowMs = Date.now()) {
    const open = this.store.openForConversation(conversationId);
    if (open) {
      const last = this.lastPing.get(open.case_id);
      if (last !== undefined && nowMs - last < 10 * 60 * 1000) return open;
      this.lastPing.set(open.case_id, nowMs);
      if (open.assignee?.username) await this.notify(open, `${open.customer?.nombre || "Cliente"} escribió por WhatsApp`, clip(text) || "(adjunto)", [open.assignee.username]);
      return open;
    }
    const previous = this.store.forConversation(conversationId).at(-1) || null;
    // Solo clientes con su trámite completado (o que ya eran casos de Atención a Clientes por eso).
    if (sale?.queue === "completed" || ["completed_sale", "returning"].includes(previous?.kind)) {
      return this.openCase({ conversation_id: conversationId, kind: "returning", reason: clip(text, 200) || null, sale, customer: previous?.customer || {}, prefer: previous?.assignee?.username || null });
    }
    return null;
  }

  // Casos que llegaron fuera de horario o sin personas: se asignan al abrir.
  async tick() {
    if (!this.isOpen()) return 0;
    let n = 0;
    for (const c of this.store.list({ status: "open" })) {
      if (!c.pending_assignment || c.assignee) continue;
      await this.assign(c);
      n++;
    }
    return n;
  }

  setStatus(caseId, status, { note = "", by = null } = {}) {
    const c = this.store.get(caseId);
    if (!c) throw new Error("Caso no encontrado");
    if (!Object.values(CASE_STATUSES).includes(status)) throw new Error("Estado inválido");
    if (status === CASE_STATUSES.RESOLVED && !String(note || "").trim()) throw new Error("Escribe qué se resolvió");
    const patch = { status, ...(status === CASE_STATUSES.RESOLVED ? { resolved_at: new Date().toISOString() } : { resolved_at: null }) };
    return this.store.runAs(by, () => this.store.update(caseId, patch, `case.${status}`, { note: String(note || "").trim() || null }));
  }

  start(intervalMs = 60_000) {
    const timer = setInterval(() => void this.tick().catch(e => this.logger.error?.("Atención a Clientes:", e?.message || e)), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

export { OPEN_STATUSES };
