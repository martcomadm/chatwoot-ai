// Avisos sin tomar (11-nov). Del 5 al 10-nov hubo 65 avisos de "interesado sin responder" y solo 16 intervenciones.
// Si un aviso a Captura ("cliente listo para comprar" o "interesado sin responder") lleva 15 minutos sin que nadie
// intervenga el chat, Supervisión recibe una notificación con la lista. Una sola vez por aviso.
const MIN = 60 * 1000;

export function untakenAlerts(memories = [], { now = new Date(), afterMinutes = 15, maxHours = 6 } = {}) {
  const out = [];
  for (const m of memories) {
    if (!m?.id || m.no_contact || m.mia_omitted?.active || m.capture_intervention?.active || m.service_sale?.active || m.handoff?.status) continue;
    const c = m.sales_cycle || {};
    const candidates = [
      m.hot_lead_alert?.at && !c.authorized ? { kind: "hot", at: m.hot_lead_alert.at, label: String(m.hot_lead_alert.reason || "listo para comprar").toLowerCase() } : null,
      m.cold_lead_alert?.at && !c.authorized ? { kind: "cold", at: m.cold_lead_alert.at, label: "interesado sin responder" } : null,
    ].filter(Boolean).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const alert = candidates[0];
    if (!alert) continue;
    const age = now.getTime() - Date.parse(alert.at);
    if (!(age >= afterMinutes * MIN && age <= maxHours * 60 * MIN)) continue;
    // Alguien ya lo tomó después del aviso (aunque luego lo haya regresado a Mia).
    if (Date.parse(m.capture_intervention?.at || "") >= Date.parse(alert.at)) continue;
    if (m.alert_escalation?.for === alert.at) continue;
    out.push({ id: Number(m.id), name: m.nombre || "Cliente sin nombre", kind: alert.kind, label: alert.label, at: alert.at, minutes: Math.round(age / MIN) });
  }
  // Primero los listos para comprar, luego los más antiguos.
  return out.sort((a, b) => (a.kind === b.kind ? b.minutes - a.minutes : a.kind === "hot" ? -1 : 1));
}

export class AlertEscalation {
  constructor({ memories, notifier, inspectorEvents = null, isOpen = () => true, afterMinutes = 15 }) {
    Object.assign(this, { memories, notifier, inspectorEvents, isOpen, afterMinutes });
  }

  async tick(now = new Date()) {
    if (this.running || !this.isOpen(now)) return { escalated: 0 };
    this.running = true;
    try {
      const items = untakenAlerts(this.memories.list?.() || [], { now, afterMinutes: this.afterMinutes });
      if (!items.length) return { escalated: 0 };
      const to = this.notifier?.areaUsers?.("supervision") || [];
      const hot = items.filter(i => i.kind === "hot").length;
      await this.notifier?.notify?.({
        kind: "hot_lead", to,
        title: items.length === 1 ? "Aviso sin tomar: nadie ha atendido a este cliente" : `${items.length} avisos sin tomar en Captura`,
        body: `${items.slice(0, 6).map(i => `${i.name} (#${i.id}): ${i.label}, hace ${i.minutes} min`).join(" · ")}${items.length > 6 ? ` · y ${items.length - 6} más` : ""}.${hot ? " Los listos para comprar van primero." : ""}`,
        url: items.length === 1 ? `/operations?area=chats&chat=${items[0].id}` : "/operations?area=chats",
      });
      for (const i of items) {
        await this.memories.merge?.(i.id, { alert_escalation: { for: i.at, at: now.toISOString() } });
        try { await this.inspectorEvents?.record?.(i.id, "alert_escalated", { kind: i.kind, minutes: i.minutes, to }); } catch {}
      }
      return { escalated: items.length };
    } finally { this.running = false; }
  }

  start(everyMs = 5 * MIN) {
    this.timer = setInterval(() => this.tick().catch(error => console.error("NEXT avisos sin tomar:", error?.message || error)), everyMs);
    this.timer.unref?.();
  }
}
