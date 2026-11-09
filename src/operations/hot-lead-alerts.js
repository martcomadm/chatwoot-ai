// Aviso inmediato a Captura cuando un cliente está listo para comprar (pedido 9-nov, punto 3).
// El aviso de "cliente que se enfría" (cold-lead-alerts.js) llega a las 2 h de silencio; a quien tiene
// prisa ("necesito estar dado de alta antes del lunes"), pregunta cómo pagar o qué documentos ocupa, se le
// cierra mejor con una persona en minutos. Un aviso por conversación cada 24 h.

const DAY = 24 * 60 * 60 * 1000;

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

const BY_ANSWER = {
  process_time_urgent: "Tiene prisa por estar dado de alta",
  how_to_start: "Pregunta cómo iniciar",
  payment_method: "Pregunta cómo se paga",
  payment_order: "Pregunta cuándo se paga",
  requirements: "Pregunta qué documentos necesita",
  still_covered: "Quiere cambiarse con nosotros cuando termine su vigencia actual",
};

const URGENT_RE = /\b(?:urge|urgente|me urge|lo antes posible|cuanto antes|hoy mismo|lo necesito ya|lo necesito hoy|tengo cita|citas? pendientes?|antes del? (?:este |el )?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|fin de semana))\b/;

// Motivo para avisar, o null.
export function hotLeadReason({ memory = {}, text = "", answerKey = null, now = new Date() } = {}) {
  const c = memory.sales_cycle || {};
  if (c.authorized) return null;
  if (memory.capture_intervention?.active || memory.service_sale?.active || memory.no_contact) return null;
  if (memory.handoff?.status && !["completed", "returned"].includes(String(memory.handoff.status))) return null;
  const last = Date.parse(memory.hot_lead_alert?.at || "");
  if (Number.isFinite(last) && now.getTime() - last < DAY) return null;
  if (answerKey && BY_ANSWER[answerKey]) return BY_ANSWER[answerKey];
  if (URGENT_RE.test(norm(text))) return "Tiene prisa";
  return null;
}

function planLabel(memory = {}) {
  const c = memory.sales_cycle || {};
  const plan = c.selected_plan || c.last_plan || c.recommended_plan || (c.explained_plans || []).at(-1) || null;
  return plan === "plan_2" ? "Plan 2" : plan === "plan_1" ? "Plan 1" : null;
}

export class HotLeadAlerts {
  constructor({ memories, notifier, inspectorEvents = null }) {
    Object.assign(this, { memories, notifier, inspectorEvents });
  }

  async alert({ conversation_id, memory = {}, text = "", reason, now = new Date() }) {
    const id = Number(conversation_id);
    if (!id || !reason) return false;
    const to = this.notifier?.areaUsers?.("captura") || [];
    const name = memory.nombre || "Cliente sin nombre";
    const plan = planLabel(memory);
    const quote = String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);
    await this.notifier?.notify?.({
      kind: "hot_lead", to,
      title: "Cliente listo para comprar",
      body: `${name}${plan ? ` (${plan})` : ""}: ${reason.toLowerCase()} · "${quote}" · #${id}. Escríbele o llámale ahora desde Chats de Mia.`,
      url: `/operations?area=chats&chat=${id}`,
    });
    await this.memories?.merge?.(id, { hot_lead_alert: { at: now.toISOString(), reason, to } });
    try { await this.inspectorEvents?.record?.(id, "hot_lead_alert", { reason, text: quote, to }); } catch {}
    return true;
  }
}
