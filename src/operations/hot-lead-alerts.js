// Aviso inmediato a Captura cuando un cliente está listo para comprar (pedido 9-nov, punto 3).
// El aviso de "cliente que se enfría" (cold-lead-alerts.js) llega a las 2 h de silencio; a quien tiene
// prisa ("necesito estar dado de alta antes del lunes"), pregunta cómo pagar o qué documentos ocupa, se le
// cierra mejor con una persona en minutos. Un aviso por conversación cada 24 h.

import { isTeamOff, mxDay, mxHour, parseOffDays } from "../core/team-days.js";

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

// Pendientes de los días sin equipo (9-nov, punto 5): el primer día hábil, a partir de las 9:00, Captura recibe
// la lista de quien aceptó (sin documentos completos), quien quedó listo para comprar o aceptó con fecha.
export function weekendPending(memories = [], { since, until }) {
  const inWindow = at => { const t = Date.parse(at || ""); return Number.isFinite(t) && t >= since && t < until; };
  const out = [];
  for (const m of memories) {
    if (!m?.id || Date.parse(m.weekend_digest_at || "") >= until || m.capture_intervention?.active || m.no_contact) continue;
    const c = m.sales_cycle || {};
    let reason = null;
    if (c.authorized && inWindow(c.authorized_at) && !m.operations?.documents_complete) reason = c.scheduled_start ? `aceptó con fecha (${c.scheduled_start.when})` : "aceptó iniciar; faltan documentos";
    else if (!c.authorized && inWindow(m.hot_lead_alert?.at)) reason = String(m.hot_lead_alert.reason || "listo para comprar").toLowerCase();
    else if (!c.authorized && inWindow(c.weekend_offer)) reason = "se le ofreció apartar su lugar";
    if (reason) out.push({ id: Number(m.id), name: m.nombre || "Cliente sin nombre", reason });
  }
  return out;
}

export class HotLeadAlerts {
  constructor({ memories, notifier, inspectorEvents = null, offDays = parseOffDays() }) {
    Object.assign(this, { memories, notifier, inspectorEvents, offDays });
  }

  async weekendDigest(now = new Date()) {
    if (isTeamOff(now, this.offDays) || mxHour(now) < 9) return { sent: 0 };
    // Ventana: los días sin equipo justo antes de hoy.
    let start = now.getTime() - DAY, days = 0;
    while (isTeamOff(new Date(start), this.offDays) && days < 7) { start -= DAY; days++; }
    if (!days) return { sent: 0 };
    const todayStart = Date.parse(`${mxDay(now)}T06:00:00Z`);
    const since = todayStart - days * DAY;
    const items = weekendPending(this.memories.list?.() || [], { since, until: todayStart });
    if (!items.length) return { sent: 0 };
    await this.notifier?.notify?.({
      kind: "hot_lead", to: this.notifier?.areaUsers?.("captura") || [],
      title: `Pendientes del fin de semana: ${items.length} cliente${items.length === 1 ? "" : "s"}`,
      body: items.slice(0, 8).map(i => `${i.name} (#${i.id}): ${i.reason}`).join(" · ") + (items.length > 8 ? ` · y ${items.length - 8} más` : ""),
      url: `/operations?area=chats`,
    });
    const at = now.toISOString();
    for (const i of items) await this.memories.merge?.(i.id, { weekend_digest_at: at });
    return { sent: items.length };
  }

  start(everyMs = 30 * 60 * 1000) {
    this.timer = setInterval(() => this.weekendDigest().catch(error => console.error("NEXT pendientes del fin de semana:", error?.message || error)), everyMs);
    this.timer.unref?.();
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
