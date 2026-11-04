// Aviso a Captura cuando un cliente interesado se enfría (pedido 4-nov, punto 2).
// Export 29-oct al 4-nov: 162 clientes vieron el plan y el precio y solo 16 aceptaron. Si alguien
// que ya vio el plan deja de contestar 2 horas, Operations avisa a Captura (página + celular)
// para que una persona intervenga desde "Chats de Mia" mientras el cliente sigue interesado.
//
// Fuente: la serie de seguimientos. Mientras la conversación tenga una serie abierta, el cliente
// no ha contestado desde el último mensaje de Mia (mia_at); al escribir, la serie se reinicia.

const HOUR = 60 * 60 * 1000;
const SKIP_DEFERRALS = new Set(["declined", "closing", "mistake", "not_fit", "later", "no_money"]);

function planOf(memory = {}) {
  const c = memory.sales_cycle || {};
  return c.selected_plan || c.last_plan || (c.explained_plans || []).at(-1) || (c.pitched_plans || []).at(-1) || c.recommended_plan || null;
}

function sawPlan(memory = {}) {
  const c = memory.sales_cycle || {};
  return Boolean((c.pitched_plans || []).length || (c.explained_plans || []).length || (c.fully_explained_plans || []).length || c.selected_plan);
}

function label(plan) { return plan === "plan_2" ? "Plan 2 ($1,500)" : plan === "plan_1" ? "Plan 1 ($1,100)" : "un plan"; }

// Motivo por el que NO se avisa (o null si sí corresponde).
export function coldLeadSkipReason(memory = {}, entry = {}, now = new Date(), { minHours = 2, maxHours = 24 } = {}) {
  const c = memory.sales_cycle || {};
  if (c.authorized) return "authorized";
  if (!sawPlan(memory)) return "no_plan_seen";
  if (SKIP_DEFERRALS.has(String(c.deferral || ""))) return "deferred";
  if (memory.capture_intervention?.active) return "intervened";
  if (memory.service_sale?.active) return "service_sale";
  if (memory.handoff?.status) return "human";
  const miaAt = Date.parse(entry.mia_at || "");
  if (!Number.isFinite(miaAt)) return "no_time";
  const silent = now.getTime() - miaAt;
  if (silent < minHours * HOUR) return "too_soon";
  if (silent > maxHours * HOUR) return "too_old";
  if (memory.cold_lead_alert?.for_mia_at === entry.mia_at) return "already_alerted";
  return null;
}

export class ColdLeadAlerts {
  constructor({ followUpStore, memories, notifier, inspectorEvents = null, isOpen = () => true, minHours = 2, maxHours = 24 }) {
    Object.assign(this, { followUpStore, memories, notifier, inspectorEvents, isOpen, minHours, maxHours });
  }

  async tick(now = new Date()) {
    if (this.running || !this.isOpen(now)) return { alerted: 0 };
    this.running = true;
    let alerted = 0;
    try {
      for (const entry of this.followUpStore?.list?.() || []) {
        const id = Number(entry.conversationId);
        const memory = this.memories.get(id) || {};
        if (coldLeadSkipReason(memory, entry, now, this) !== null) continue;
        const hours = Math.floor((now.getTime() - Date.parse(entry.mia_at)) / HOUR);
        const name = memory.nombre || "Cliente sin nombre";
        const to = this.notifier?.areaUsers?.("captura") || [];
        await this.notifier?.notify?.({
          kind: "cold_lead", to,
          title: "Cliente interesado sin responder",
          body: `${name} vio el ${label(planOf(memory))} y no contesta desde hace ${hours} h · #${id}. Intervén desde Chats de Mia.`,
          url: `/operations?area=chats&chat=${id}`,
        });
        await this.memories.merge(id, { cold_lead_alert: { at: now.toISOString(), for_mia_at: entry.mia_at, to } });
        try { await this.inspectorEvents?.record?.(id, "cold_lead_alert", { hours, plan: planOf(memory), to }); } catch {}
        alerted++;
      }
    } finally { this.running = false; }
    return { alerted };
  }

  start(everyMs = 10 * 60 * 1000) {
    this.timer = setInterval(() => this.tick().catch(error => console.error("NEXT aviso de clientes interesados:", error)), everyMs);
    this.timer.unref?.();
  }
}
