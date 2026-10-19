// Primera respuesta según el anuncio de Facebook del que llega el cliente (el mensaje
// automático de WhatsApp de cada anuncio). La idea es continuar exactamente lo que el
// anuncio prometió, en vez de una apertura genérica o de soltar el precio de entrada:
// - Pensión ("¿Aún puedes pensionarte?", "Tus semanas pueden seguir creciendo"): revisar su caso.
// - Servicio médico ("Si no cuentas con IMSS…", "sin filas, sin citas"): afiliación rápida.
// - "Ya estoy afiliado": seguir cotizando si deja de trabajar.

function norm(v) {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
}

export const AD_OPENINGS = Object.freeze({
  pension: "Sí, aunque hayas dejado de trabajar puedes seguir sumando semanas para tu pensión: te damos de alta ante el IMSS y sigues cotizando, además con servicio médico. Para revisar tu caso, ¿hace cuánto dejaste de cotizar y, más o menos, en qué año empezaste a cotizar?",
  case_review: "Con gusto revisamos tu caso. Para saber qué opciones tienes, ¿hace cuánto dejaste de cotizar y, más o menos, en qué año empezaste a cotizar?",
  no_imss: "Claro que sí. Realizamos tu afiliación al IMSS para que tengas servicio médico (consultas, medicamentos, estudios y hospitalización) y sigas sumando semanas. Todo se hace por este medio y, con tus documentos completos, el alta suele quedar en unas 48 horas hábiles. ¿Lo buscas principalmente para servicio médico o también te interesa aportar a tu AFORE e INFONAVIT?",
  already_affiliated: "Qué bien que ya cuentas con IMSS. Si en algún momento dejas de trabajar, con nosotros puedes seguir cotizando y conservar tu servicio médico. ¿Tu alta actual es por tu trabajo o estás buscando otra opción?",
});

export function adOpeningKind(text = "") {
  const raw = String(text || "");
  const v = norm(raw);
  if (!v || v.length > 120 || /[?¿]/.test(raw)) return null;
  if (/\bdeje de cotizar\b.*\b(seguir sumando|pensionarme|pension)\b|^quiero seguir cotizando\b|\bseguir cotizando en el seguro\b/.test(v)) return "pension";
  if (/\binformacion y revisar mi caso\b/.test(v)) return "case_review";
  if (/\bno cuento con imss y quiero afiliarme\b|^comenzar con mi afiliacion\b/.test(v)) return "no_imss";
  if (/^ya estoy afiliado al imss\b/.test(v)) return "already_affiliated";
  return null;
}

// Solo en la primera respuesta de la conversación (o al retomarla al abrir).
export function adOpeningDecision(memory = {}, text = "") {
  if (memory?.ultima_respuesta_agente || memory?.sales_cycle?.authorized) return null;
  const kind = adOpeningKind(text);
  if (!kind) return null;
  return { reply: AD_OPENINGS[kind], question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", ad_opening: kind };
}
