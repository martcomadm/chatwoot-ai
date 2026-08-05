export function fallbackDecision(memory, planner, combinedText) {
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
  return { reply: `${prefix} ${questions[planner?.question_key] || "¿Me compartes un poco más sobre tu situación?"}`, question_key: planner?.question_key || null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "" };
}
