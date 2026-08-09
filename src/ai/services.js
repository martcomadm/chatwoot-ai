import { jsonFrom } from "./json.js";
import { historyOf, arrays } from "../utils/conversation.js";
import { MARTCOM_KNOWLEDGE } from "../knowledge/martcom.js";
import { validateNameCandidate } from "../semantic/name-validator.js";

export class AiServices {
  constructor(openai, config) { this.openai = openai; this.config = config; }

  async extractAmbiguous(memory, combinedText, conversation) {
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `Extrae únicamente datos explícitos o claramente inferibles del cliente MARTCOM. No borres ni inventes datos. Devuelve solo JSON:
{"nombre":null,"primer_nombre":null,"edad":null,"actividad":null,"tipo_trabajo":null,"tiene_imss":null,"ultima_cotizacion":null,"necesidad_principal":null,"necesidades":[],"afore_actual":null,"pregunta_cambio_afore":false,"curp_recibida":false,"nss_recibido":false,"contradicciones":[],"intereses":{},"contexto_laboral":{},"caso_fallecimiento":{"afiliado_imss_al_fallecer":null,"afore_contactada":null,"pension_negada":false,"motivo_negativa":null,"beneficiarios":[],"menor_beneficiario":null}}
CURP y NSS nunca son nombres. Un nombre completo escrito solo sí debe extraerse. Para casos de fallecimiento, extrae únicamente hechos expresos. Si la intención es RETIRO_AFORE_FALLECIMIENTO y la pregunta fue sobre el fallecido, un “sí” o “no” corresponde a caso_fallecimiento.afiliado_imss_al_fallecer, no a tiene_imss del cliente. Datos: si el fallecido tenía IMSS, si ya acudieron a la AFORE, si negaron pensión, el motivo comunicado, quiénes son beneficiarios y si hay un menor. “Contaba por empleo” significa que cotizó antes. “No me ponen seguro” significa tiene_imss=false y empleador_no_afilia=true. IMSS + INFONAVIT o AFORE apunta a plan_2. Conserva el dato previo si hay contradicción.`,
      input: `MEMORIA PREVIA:\n${JSON.stringify(memory, null, 2)}\n\nMENSAJES AGRUPADOS:\n${combinedText}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return jsonFrom(response.output_text);
  }

  async generateDecision(conversation, labels, memory, planner, combinedText) {
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `${MARTCOM_KNOWLEDGE}\n\nMEMORIA:\n${JSON.stringify(memory, null, 2)}\n\nDECISIÓN COMERCIAL:\n${JSON.stringify(planner, null, 2)}\n\nDevuelve solo JSON:\n{"reply":"mensaje breve","question_key":"nombre|edad|actividad|tiene_imss|ultima_cotizacion|necesidad_principal|curp|nss|aclarar_contradiccion|afiliado_imss_al_fallecer|afore_contactada|motivo_negativa|beneficiarios_fallecimiento|detalle_retiro_afore|detalle_pension_fallecimiento|detalle_queja|null","add_labels":[],"remove_labels":[],"handoff":false,"handoff_reason":""}\nObedece al planner y a la intención detectada. Si el planner es especializado, no conviertas el caso en cotización o afiliación.
Para RETIRO_AFORE_FALLECIMIENTO está prohibido pedir edad, actividad, CURP, NSS o hablar de cotización. Expresa empatía una sola vez y pregunta únicamente el dato indicado por el planner.
Acciones especializadas: preguntar_afiliacion_fallecido = preguntar si el fallecido tenía IMSS; preguntar_gestion_afore = preguntar si ya acudieron a la AFORE; preguntar_motivo_negativa = preguntar el motivo comunicado; preguntar_beneficiarios = preguntar quiénes son beneficiarios. Máximo ${this.config.maxReplyChars} caracteres. Una sola pregunta. Usa únicamente el asesor ${memory.asesor_presentacion || "asignado"}. No agregues cliente, venta, cerrado ni no_contesta.`,
      input: `MENSAJES NUEVOS:\n${combinedText}\n\nETIQUETAS:\n${labels.join(", ") || "ninguna"}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return jsonFrom(response.output_text);
  }

  async repairDecision(conversation, memory, planner, combinedText, decision, reasons) {
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `${MARTCOM_KNOWLEDGE}\nReescribe la respuesta porque falló calidad: ${reasons.join(", ")}. Obedece: ${JSON.stringify(planner)}. Devuelve el mismo JSON. Una pregunta, natural, sin recitar memoria.`,
      input: `MEMORIA:\n${JSON.stringify(memory)}\n\nMENSAJES:\n${combinedText}\n\nRESPUESTA RECHAZADA:\n${JSON.stringify(decision)}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return jsonFrom(response.output_text);
  }

  async handoffSummary(conversation, reason, memory) {
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `Genera una nota privada breve. No inventes. Formato:\nAXEL IA - RESUMEN\nNombre:\nEdad:\nActividad:\nNecesidad:\nPlan probable:\nIMSS actual:\nSituación laboral:\nAFORE actual:\nCURP recibida:\nNSS recibido:\nDocumentos:\nContradicciones:\nMotivo de transferencia:\nSi falta algo escribe “No informado”.`,
      input: `MOTIVO:\n${reason}\n\nMEMORIA:\n${JSON.stringify(memory, null, 2)}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return response.output_text.trim().slice(0, 1800);
  }
}

export function mergeMemory(current, ...patches) {
  const next = structuredClone(current);
  for (const patch of patches) {
    if (!patch) continue;

    for (const key of ["primer_nombre","edad","actividad","tipo_trabajo","tiene_imss","ultima_cotizacion","necesidad_principal","afore_actual","asesor_presentacion"]) {
      const value = patch[key];
      if (value !== null && value !== undefined && value !== "") next[key] = value;
    }

    if (patch.nombre !== null && patch.nombre !== undefined && patch.nombre !== "") {
      if (validateNameCandidate(patch.nombre).ok) next.nombre = patch.nombre;
    }

    for (const key of ["pregunta_cambio_afore","curp_recibida","nss_recibido"]) {
      if (typeof patch[key] === "boolean") next[key] = Boolean(next[key] || patch[key]);
    }

    next.necesidades = arrays(next.necesidades, patch.necesidades);
    next.documentos_recibidos = arrays(next.documentos_recibidos, patch.documentos_recibidos);
    next.contradicciones = arrays(next.contradicciones, patch.contradicciones);
    next.resolved_questions = arrays(next.resolved_questions, patch.resolved_questions);
    next.conflictos_resueltos = arrays(next.conflictos_resueltos, patch.conflictos_resueltos);
    next.intereses = { ...(next.intereses || {}), ...(patch.intereses || {}) };
    next.contexto_laboral = { ...(next.contexto_laboral || {}), ...(patch.contexto_laboral || {}) };
    next.slots = { ...(next.slots || {}), ...(patch.slots || {}) };
    next.experiencia = { ...(next.experiencia || {}), ...(patch.experiencia || {}) };
    next.caso_fallecimiento = { ...(next.caso_fallecimiento || {}), ...(patch.caso_fallecimiento || {}) };
    if (Array.isArray(patch.caso_fallecimiento?.beneficiarios)) next.caso_fallecimiento.beneficiarios = arrays(next.caso_fallecimiento?.beneficiarios, patch.caso_fallecimiento.beneficiarios);
  }
  if (next.nombre && !next.primer_nombre) next.primer_nombre = String(next.nombre).split(/\s+/)[0];
  return next;
}
