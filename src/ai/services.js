import { jsonFrom } from "./json.js";
import { historyOf, arrays } from "../utils/conversation.js";
import { MARTCOM_KNOWLEDGE } from "../knowledge/martcom.js";
import { validateNameCandidate } from "../semantic/name-validator.js";
import { analyzeAutonomousSale, salesInstruction } from "../sales/autonomous-sales-engine.js";

export function buildCommercialExtractionPatch(memory, combinedText) {
  return analyzeAutonomousSale(combinedText, memory).patch;
}

export class AiServices {
  constructor(openai, config) { this.openai = openai; this.config = config; }

  async extractAmbiguous(memory, combinedText, conversation) {
    const commercialPatch = buildCommercialExtractionPatch(memory, combinedText);
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `Extrae únicamente datos explícitos o claramente inferibles del cliente MARTCOM. No borres ni inventes datos. Devuelve solo JSON:
{"nombre":null,"primer_nombre":null,"edad":null,"actividad":null,"tipo_trabajo":null,"tiene_imss":null,"ultima_cotizacion":null,"necesidad_principal":null,"necesidades":[],"afore_actual":null,"pregunta_cambio_afore":false,"curp_recibida":false,"nss_recibido":false,"contradicciones":[],"intereses":{},"contexto_laboral":{},"caso_fallecimiento":{"afiliado_imss_al_fallecer":null,"afore_contactada":null,"pension_negada":false,"motivo_negativa":null,"beneficiarios":[],"menor_beneficiario":null}}
CURP y NSS nunca son nombres. Un nombre completo escrito solo sí debe extraerse. Para casos de fallecimiento, extrae únicamente hechos expresos. Si la intención es RETIRO_AFORE_FALLECIMIENTO y la pregunta fue sobre el fallecido, un “sí” o “no” corresponde a caso_fallecimiento.afiliado_imss_al_fallecer, no a tiene_imss del cliente. Datos: si el fallecido tenía IMSS, si ya acudieron a la AFORE, si negaron pensión, el motivo comunicado, quiénes son beneficiarios y si hay un menor. “Contaba por empleo” significa que cotizó antes. “No me ponen seguro” significa tiene_imss=false y empleador_no_afilia=true. IMSS + INFONAVIT o AFORE apunta a plan_2. Conserva el dato previo si hay contradicción.`,
      input: `MEMORIA PREVIA:\n${JSON.stringify(memory, null, 2)}\n\nMENSAJES AGRUPADOS:\n${combinedText}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return { ...jsonFrom(response.output_text), ...commercialPatch };
  }

  async generateDecision(conversation, labels, memory, planner, combinedText) {
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `${MARTCOM_KNOWLEDGE}\n\nMEMORIA:\n${JSON.stringify(memory, null, 2)}\n\nDECISIÓN COMERCIAL:\n${JSON.stringify(planner, null, 2)}\n\nMODO COMERCIAL V3.4.0:\n${salesInstruction(memory)}\n\nDevuelve solo JSON:\n{"reply":"mensaje breve","question_key":"nombre|edad|actividad|tiene_imss|ultima_cotizacion|necesidad_principal|curp|nss|aclarar_contradiccion|afiliado_imss_al_fallecer|afore_contactada|motivo_negativa|beneficiarios_fallecimiento|detalle_retiro_afore|detalle_pension_fallecimiento|detalle_queja|null","add_labels":[],"remove_labels":[],"handoff":false,"handoff_reason":""}\nJERARQUÍA: 1) preferencia humana, 2) pregunta explícita, 3) objeción, 4) corrección, 5) datos nuevos, 6) venta consultiva, 7) siguiente slot. La meta ya no es obtener CURP/NSS: es entender la necesidad, recomendar el plan correcto, explicar beneficios, resolver objeciones y obtener autorización explícita para iniciar. CURP/NSS no son requisito para explicar o recomendar un plan y no deben usarse como fallback. Si el cliente pregunta precio, responde lo autorizado: el costo depende del plan y salario registrado; no inventes cifras. Si el cliente expresa intención clara de contratar/iniciar, confirma y deja que el Core haga el handoff. Si necesita pensarlo, respeta su decisión y no presiones.\nNegation Scope: una frase ambigua nunca activa no_quiere_el_servicio; solo rechazos claros. No vuelvas a pedir slots unavailable/refused/ask_later/promised_later/searching/declined ni blocked_questions. No hagas afirmaciones concluyentes sobre pensión, semanas necesarias, modalidad legal, alta patronal o mecánica jurídica si no están expresamente autorizadas. RETIRO_AFORE_FALLECIMIENTO sigue siendo flujo especializado y no se convierte en venta de afiliación. Máximo ${this.config.maxReplyChars} caracteres. Una sola pregunta. Usa únicamente el asesor ${memory.asesor_presentacion || "asignado"}. No agregues cliente, venta, cerrado ni no_contesta.`,
      input: `MENSAJES NUEVOS:\n${combinedText}\n\nETIQUETAS:\n${labels.join(", ") || "ninguna"}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return jsonFrom(response.output_text);
  }

  async repairDecision(conversation, memory, planner, combinedText, decision, reasons) {
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `${MARTCOM_KNOWLEDGE}\nReescribe la respuesta porque falló calidad: ${reasons.join(", ")}. Obedece: ${JSON.stringify(planner)}. Modo comercial: ${salesInstruction(memory)}. Devuelve el mismo JSON. Una pregunta, natural, sin recitar memoria.`,
      input: `MEMORIA:\n${JSON.stringify(memory)}\n\nMENSAJES:\n${combinedText}\n\nRESPUESTA RECHAZADA:\n${JSON.stringify(decision)}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return jsonFrom(response.output_text);
  }

  async handoffSummary(conversation, reason, memory) {
    const response = await this.openai.responses.create({
      model: this.config.model,
      instructions: `Genera una nota privada breve. No inventes. Formato:\nAXEL IA - RESUMEN\nNombre:\nEdad:\nActividad:\nNecesidad:\nPlan recomendado:\nEtapa comercial:\nTrámite autorizado:\nIMSS actual:\nSituación laboral:\nAFORE actual:\nCURP recibida:\nNSS recibido:\nDocumentos:\nContradicciones:\nMotivo de transferencia:\nSi falta algo escribe “No informado”.`,
      input: `MOTIVO:\n${reason}\n\nMEMORIA:\n${JSON.stringify(memory, null, 2)}\n\nHISTORIAL:\n${historyOf(conversation, this.config.maxHistory)}`,
    });
    return response.output_text.trim().slice(0, 1800);
  }
}

export function mergeMemory(current, ...patches) {
  const next = structuredClone(current);
  for (const patch of patches) {
    if (!patch) continue;
    for (const key of ["edad","actividad","tipo_trabajo","tiene_imss","ultima_cotizacion","necesidad_principal","afore_actual","asesor_presentacion","curp_valor"]) {
      const value = patch[key]; if (value !== null && value !== undefined && value !== "") next[key] = value;
    }
    if (patch.nombre !== null && patch.nombre !== undefined && patch.nombre !== "" && validateNameCandidate(patch.nombre).ok) { next.nombre=patch.nombre; next.primer_nombre=String(patch.nombre).trim().split(/\s+/)[0]; }
    for (const key of ["pregunta_cambio_afore","curp_recibida","nss_recibido"]) if (typeof patch[key] === "boolean") next[key]=Boolean(next[key]||patch[key]);
    next.necesidades=arrays(next.necesidades,patch.necesidades); next.documentos_recibidos=arrays(next.documentos_recibidos,patch.documentos_recibidos); next.contradicciones=arrays(next.contradicciones,patch.contradicciones); next.resolved_questions=arrays(next.resolved_questions,patch.resolved_questions); next.blocked_questions=arrays(next.blocked_questions,patch.blocked_questions); next.conflictos_resueltos=arrays(next.conflictos_resueltos,patch.conflictos_resueltos);
    for(const key of ["intereses","contexto_laboral","slots","data_collection","experiencia","caso_fallecimiento","caso_sujeto","pension_data","orchestration","judgment","sales_cycle"]) next[key]={...(next[key]||{}),...(patch[key]||{})};
    if(Array.isArray(patch.caso_fallecimiento?.beneficiarios)) next.caso_fallecimiento.beneficiarios=arrays(next.caso_fallecimiento?.beneficiarios,patch.caso_fallecimiento.beneficiarios);
  }
  if(next.nombre&&!next.primer_nombre)next.primer_nombre=String(next.nombre).split(/\s+/)[0];
  return next;
}
