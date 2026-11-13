// Puntaje de compra de cada chat (pedido 9-nov, punto 3 de "Mia más inteligente").
// Ordena Chats de Mia para que Captura atienda primero a quien está por cerrar (el domingo 8 hubo 54 chats y
// solo 5 los tocó una persona). 0–100, con los motivos para que se entienda de dónde sale.

const HOUR = 60 * 60 * 1000;
const ms = v => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : 0; };

export function leadScore(memory = {}, { lastCustomerAt = null, now = new Date() } = {}) {
  const c = memory.sales_cycle || {};
  const p = memory.profile || {};
  const s = p.signals || {};
  if (c.authorized) return { score: 100, level: "accepted", label: "Aceptó", reasons: ["Aceptó iniciar"] };
  if (memory.no_contact || c.deferral === "declined" || c.deferral === "not_fit" || c.deferral === "mistake") return { score: 0, level: "low", label: "Baja", reasons: ["No le interesa"] };
  let score = 5;
  const reasons = [];
  const add = (points, reason) => { score += points; if (reason) reasons.push(reason); };
  const sawPlan = (c.pitched_plans || []).length || (c.explained_plans || []).length || c.recommended_plan || c.selected_plan;
  if (sawPlan) add(15, "Vio el plan y el precio");
  if ((c.fully_explained_plans || c.explained_plans || []).length) add(10, "Le explicaron el plan completo");
  if (s.sent_curp || s.sent_files) add(25, s.sent_curp ? "Mandó su CURP" : "Mandó documentos");
  if (s.asked_payment) add(20, "Preguntó cómo pagar");
  else if (s.asked_start) add(15, "Preguntó cómo iniciar o qué necesita");
  if (s.urgency || p.urgency) add(15, "Tiene prisa");
  if (s.interest) add(10, "Dijo que le interesa");
  if (memory.hot_lead_alert?.at) add(5, null);
  if (c.scheduled_start) add(20, "Aceptó con fecha");
  if (c.deferral === "no_money") add(-15, "Sin dinero por ahora");
  else if (c.deferral === "later" || c.deferral === "start_later") add(-10, "Lo pospuso");
  else if (c.deferral === "closing") add(-20, "Se despidió");
  if (p.objection === "confianza") add(-5, "Duda de la confianza");
  const last = ms(lastCustomerAt);
  if (last) {
    const age = now.getTime() - last;
    if (age < 2 * HOUR) add(10, "Escribió hace poco");
    else if (age < 24 * HOUR) add(5, null);
    else if (age > 72 * HOUR) add(-15, "Lleva días sin escribir");
  }
  score = Math.max(0, Math.min(99, Math.round(score)));
  const level = score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  return { score, level, label: level === "high" ? "Alta" : level === "medium" ? "Media" : "Baja", reasons };
}
