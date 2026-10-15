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
  const prefix = hasAfore ? (continuity ? "Buscas continuidad en el alta y las aportaciones a tu AFORE." : "Podemos orientarte sobre una opción con aportaciones a tu AFORE.") : "";
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
  // Never resend the exact pending question just because a duplicate/stale event
  // produced no new usable answer. The processor will ask again only after a real
  // customer turn changes the planner or supplies new information.
  if (!direct && questionKey && questionKey === lastQuestion) {
    return { reply: "", question_key: questionKey, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "" };
  }
  const reply = [direct || prefix, nextQuestion].filter(Boolean).join(" ").trim();
  return { reply, question_key: questionKey, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "" };
}

// Antes el respaldo era siempre "¿Me compartes un poco más sobre tu situación?", que los
// clientes no entendían (aparecía tras responder "¿a qué te dedicas?" o al hacer una pregunta).
// Ahora propone el siguiente paso según dónde va la conversación, sin repetirse.
export function contextualNextStep(memory = {}) {
  const need = memory?.commercial_need || {};
  const plan = memory?.sales_cycle?.selected_plan || memory?.sales_cycle?.recommended_plan
    || (need.afore_infonavit ? "plan_2" : (need.service_medical || need.weeks || need.retirement) ? "plan_1" : null);
  const knowsNeed = Boolean(need.service_medical || need.weeks || need.afore_infonavit || need.retirement || memory?.necesidad_principal);
  const options = [];
  const label = plan === "plan_2" ? "Plan 2" : "Plan 1";
  const explained = (memory?.sales_cycle?.explained_plans || []).includes(plan);
  // Con el plan ya identificado pero sin explicar, lo natural es ofrecer explicarlo
  // (caso real: tras "No estoy trabajando" Mia contestó "¿Hay algo más en lo que te pueda ayudar?").
  if (plan && !explained) options.push(`Gracias. Con lo que me cuentas, el ${label} es el que mejor se ajusta a lo que buscas. ¿Quieres que te explique cómo funciona?`);
  if (plan) options.push(`¿Tienes alguna duda sobre el ${label} o quieres que iniciemos tu trámite?`);
  else if (!knowsNeed) options.push("Para orientarte mejor, ¿qué buscas principalmente: servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?");
  options.push("¿Hay algo más en lo que te pueda ayudar?");
  const last = String(memory?.ultima_respuesta_agente || "").trim();
  return options.find(option => !last.endsWith(option)) || options.at(-1);
}
