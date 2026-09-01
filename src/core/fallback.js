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
  const prefix = hasAfore ? (continuity ? "Entiendo: buscas continuidad en el alta y las aportaciones a tu AFORE." : "Claro, podemos orientarte sobre una opción con aportaciones a tu AFORE.") : "Claro, te ayudo a revisar tu caso.";
  const questions = {
    necesidad_principal: "¿Qué te interesa principalmente: servicio médico, semanas, INFONAVIT o AFORE?",
    tiene_imss: "¿Actualmente tienes un alta activa ante el IMSS?",
    nombre: "¿Me compartes tu nombre completo, por favor?",
    edad: "¿Cuántos años tienes?",
    actividad: "¿A qué te dedicas actualmente?",
    curp: "¿Me compartes tu CURP para revisar la cotización?",
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
  const nextQuestion = questions[planner?.question_key] || (direct ? "" : "¿Me compartes un poco más sobre tu situación?");
  const reply = [direct || prefix, nextQuestion].filter(Boolean).join(" ").trim();
  return { reply, question_key: planner?.question_key || null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "" };
}
