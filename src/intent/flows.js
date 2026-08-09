import { INTENTS } from "./catalog.js";
const asked = (memory, key) => (memory.preguntas_realizadas || []).includes(key);
const resolved = (memory, key) => (memory.resolved_questions || []).includes(key);
function retirementByDeathFlow(memory) {
  const data = memory.caso_fallecimiento || {};
  if (data.afiliado_imss_al_fallecer == null && !resolved(memory, "afiliado_imss_al_fallecer")) return { action: "preguntar_afiliacion_fallecido", question_key: "afiliado_imss_al_fallecer", rephrase: asked(memory, "afiliado_imss_al_fallecer"), specialized: true };
  if (data.afore_contactada == null && !resolved(memory, "afore_contactada")) return { action: "preguntar_gestion_afore", question_key: "afore_contactada", rephrase: asked(memory, "afore_contactada"), specialized: true };
  if (!data.motivo_negativa && data.pension_negada && !resolved(memory, "motivo_negativa")) return { action: "preguntar_motivo_negativa", question_key: "motivo_negativa", rephrase: asked(memory, "motivo_negativa"), specialized: true };
  if ((!Array.isArray(data.beneficiarios) || !data.beneficiarios.length) && !resolved(memory, "beneficiarios_fallecimiento")) return { action: "preguntar_beneficiarios", question_key: "beneficiarios_fallecimiento", rephrase: asked(memory, "beneficiarios_fallecimiento"), specialized: true };
  return { action: "transferir_orientacion_fallecimiento", question_key: null, specialized: true };
}
export function planIntentFlow(memory) {
  switch (memory.intent?.id) {
    case INTENTS.RETIRO_AFORE_FALLECIMIENTO: return retirementByDeathFlow(memory);
    case INTENTS.RETIRO_AFORE: return { action: "orientar_retiro_afore", question_key: "detalle_retiro_afore", rephrase: asked(memory, "detalle_retiro_afore"), specialized: true };
    case INTENTS.VIUDEZ:
    case INTENTS.ORFANDAD: return { action: "orientar_pension_fallecimiento", question_key: "detalle_pension_fallecimiento", rephrase: asked(memory, "detalle_pension_fallecimiento"), specialized: true };
    case INTENTS.QUEJA: return { action: "atender_queja", question_key: "detalle_queja", rephrase: asked(memory, "detalle_queja"), specialized: true };
    default: return null;
  }
}
