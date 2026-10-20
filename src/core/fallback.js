import { effectivePlan, discussedPlan } from "../sales/progressive-disclosure.js";
const REPHRASED = {
  nombre: "Para continuar, ¿me compartes tu nombre completo?",
  edad: "¿Me confirmas tu edad, por favor? Solo el número de años.",
  actividad: "¿Me cuentas a qué te dedicas actualmente? Por ejemplo: comerciante, empleado, hogar o sin trabajo.",
  tiene_imss: "¿Me confirmas si actualmente estás dado de alta en el IMSS?",
};

export function fallbackDecision(memory, planner, combinedText) {
  const specialized = {
    afiliado_imss_al_fallecer: "Lamento mucho la pérdida. ¿Tu familiar tenía afiliación vigente al IMSS cuando falleció?",
    afore_contactada: "¿Ya acudieron a la AFORE para solicitar la orientación o el retiro de los recursos?",
    motivo_negativa: "¿Qué motivo les indicaron para negar la pensión?",
    beneficiarios_fallecimiento: "¿Quiénes aparecen o podrían tener derecho como beneficiarios?",
    detalle_retiro_afore: "¿El retiro de la AFORE es por desempleo, pensión, fallecimiento u otra causa?",
    detalle_pension_fallecimiento: "¿La consulta es por viudez, orfandad u otro posible beneficiario?",
    detalle_queja: "Lamento lo ocurrido. ¿Me puedes contar brevemente qué pasó para canalizarlo correctamente?",
  };
  if (specialized[planner?.question_key]) {
    return { reply: specialized[planner.question_key], question_key: planner.question_key, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "" };
  }

  const hasAfore = Boolean(memory?.intereses?.afore) || /afor[eé]|aportaciones?/i.test(combinedText);
  const continuity = Boolean(memory?.contexto_laboral?.busca_continuidad) || /constantes?|continuidad|sin cambios cada semana/i.test(combinedText);
  // Ya no se antepone "Podemos orientarte sobre una opción con aportaciones a tu AFORE.": salía
  // como relleno sin relación con lo que el cliente dijo (casos reales 17 a 20-oct).
  const prefix = hasAfore && continuity ? "Buscas continuidad en el alta y las aportaciones a tu AFORE." : "";
  const questions = {
    necesidad_principal: "¿Qué te interesa principalmente: servicio médico, semanas, INFONAVIT o AFORE?",
    tiene_imss: "¿Actualmente tienes un alta activa ante el IMSS?",
    nombre: "¿Me compartes tu nombre completo, por favor?",
    edad: "¿Cuántos años tienes?",
    actividad: "¿A qué te dedicas actualmente?",
    curp: "¿Me compartes tu CURP para continuar con tu trámite?",
    nss: "¿Me compartes tu Número de Seguridad Social?",
    aclarar_contradiccion: "¿Me confirmas cuál de los datos anteriores es el correcto?",
  };
  const direct = memory?.orchestration?.direct_answer;
  if (planner?.action === "esperar_o_continuar_sin_dato_sensible") {
    return { reply: direct || "No hay problema, dejamos ese dato pendiente por ahora. Cuando lo tengas a la mano continuamos.", question_key:null, add_labels:[], remove_labels:[], handoff:false, handoff_reason:"" };
  }
  if (planner?.direct_answer_first && !planner?.question_key && direct) {
    return { reply: direct, question_key:null, add_labels:[], remove_labels:[], handoff:false, handoff_reason:"" };
  }
  // Si el cliente ya dijo qué busca, no se le vuelve a preguntar (caso real: Griselda, 14-oct).
  const need = memory?.commercial_need || {};
  const needKnown = Boolean(need.service_medical || need.weeks || need.afore_infonavit || need.retirement);
  const askedKey = planner?.question_key === "necesidad_principal" && needKnown ? null : planner?.question_key;
  const nextQuestion = questions[askedKey] || (direct ? "" : contextualNextStep(memory));
  const lastQuestion = memory?.ultima_pregunta || null;
  const questionKey = askedKey || null;
  // La misma pregunta pendiente: antes Mia se quedaba callada y el cliente no recibía nada
  // ("ACTUALMENTE 58", "Podría darme más información"). Ahora la reformula una vez y, si ya la
  // reformuló, propone el siguiente paso. Los mensajes duplicados los frenan TurnLock y la memoria.
  if (!direct && questionKey && questionKey === lastQuestion) {
    const last = String(memory?.ultima_respuesta_agente || "").trim();
    const rephrased = REPHRASED[questionKey];
    const reply = rephrased && !last.endsWith(rephrased) ? rephrased : contextualNextStep(memory);
    return { reply, question_key: rephrased && reply === rephrased ? questionKey : null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "" };
  }
  const reply = [direct || prefix, nextQuestion].filter(Boolean).join(" ").trim();
  return { reply, question_key: questionKey, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "" };
}

// Antes el respaldo era siempre "¿Me compartes un poco más sobre tu situación?", que los
// clientes no entendían (aparecía tras responder "¿a qué te dedicas?" o al hacer una pregunta).
// Ahora propone el siguiente paso según dónde va la conversación, sin repetirse.
export function contextualNextStep(memory = {}) {
  const need = memory?.commercial_need || {};
  const plan = discussedPlan(memory);
  const options = [];
  const label = plan === "plan_2" ? "Plan 2" : "Plan 1";
  const explained = (memory?.sales_cycle?.explained_plans || []).includes(plan);
  // Con el plan ya identificado pero sin explicar, lo natural es ofrecer explicarlo
  // (caso real: tras "No estoy trabajando" Mia contestó "¿Hay algo más en lo que te pueda ayudar?").
  if (plan && !explained) options.push(`Gracias. Con lo que me cuentas, el ${label} es el que mejor se ajusta a lo que buscas. ¿Quieres que te explique cómo funciona?`);
  if (plan) options.push(`¿Tienes alguna duda sobre el ${label} o quieres que iniciemos tu trámite?`);
  // Sin plan identificado se pregunta qué busca (antes salía "¿Hay algo más…?" porque la IA
  // había anotado una necesidad en texto libre; caso Laura, 17-oct).
  else options.push("Para orientarte mejor, ¿qué buscas principalmente: servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?");
  if (plan) options.push("¿Hay algo más en lo que te pueda ayudar?");
  else options.push("Cuéntame un poco más de lo que buscas y te digo qué plan te conviene: ¿te interesa sobre todo el servicio médico o también aportar a tu AFORE?");
  const last = String(memory?.ultima_respuesta_agente || "").trim();
  return options.find(option => !last.endsWith(option)) || options.at(-1);
}
