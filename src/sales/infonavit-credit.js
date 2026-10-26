// Clientes con crédito INFONAVIT activo: Mia no les ofrece el Plan 2 (indicación de MARTCOM, 22-oct).
// Se detecta cuando lo dicen ("tengo crédito Infonavit", "estoy pagando mi casa de Infonavit",
// "me descuentan Infonavit", "yo pago Infonavit") y se recuerda en sales_cycle.infonavit_credit.

function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
}

const ACTIVE_RE = [
  /\b(?:tengo|tenemos|cuento con|traigo|ando con|sigo con)\s+(?:un\s+|mi\s+|el\s+)?credito\s+(?:activo\s+|vigente\s+)?(?:de\s+|del\s+|con\s+(?:el\s+)?)?(?:infonavit|fovissste)\b/,
  /\b(?:tengo|tenemos)\s+(?:un\s+)?credito\s+(?:activo|vigente)\b/,
  /\bcredito\s+(?:de\s+|del\s+)?infonavit\s+(?:activo|vigente)\b/,
  /\b(?:estoy|sigo|seguimos|estamos|ando)\s+pagando\s+(?:mi\s+|una\s+|la\s+|el\s+)?(?:casa|credito|vivienda|depa\w*)\b.{0,25}\binfonavit\b/,
  /\b(?:pago|pagamos|estoy pagando|sigo pagando)\s+(?:mi\s+|el\s+)?(?:credito\s+(?:de\s+|del\s+)?)?infonavit\b/,
  /\bme\s+(?:descuentan|descontaban|estan descontando|cobran)\s+(?:el\s+|lo del\s+|del\s+)?(?:credito\s+(?:de\s+|del\s+)?)?infonavit\b/,
  /\b(?:tengo|tenemos)\s+(?:una\s+)?casa\s+(?:de|del|con)\s+infonavit\b(?!.{0,20}\b(?:ya (?:la )?pague|liquid\w*|ya termine))/,
  /\bdebo\s+(?:mi\s+|la\s+|el\s+)?(?:casa|credito)\b.{0,20}\binfonavit\b/,
  // "Por tener un crédito vigente de Infonavit…" (caso real 23-oct).
  /\b(?:por|al|como|ya que|porque)\s+(?:yo\s+)?(?:tener|tengo)\s+(?:un\s+)?credito\s+(?:activo|vigente)\b/,
];
const NOT_ACTIVE_RE = /\b(?:no tengo|nunca he tenido|no cuento con)\b.{0,25}\b(?:credito|infonavit|casa|fovissste)\b|\b(?:ya (?:lo |la )?(?:pague|liquide|termine de pagar)|liquid\w*|quiero (?:sacar|tener|un) credito|para (?:sacar|tener) (?:un )?credito|ya no tengo)\b/;

export function hasActiveInfonavitCredit(text = "") {
  const v = norm(text);
  if (!v || !/\b(?:infonavit|fovissste|credito)\b/.test(v)) return false;
  if (NOT_ACTIVE_RE.test(v)) return false;
  return ACTIVE_RE.some(re => re.test(v));
}

export function hasInfonavitCredit(memory = {}) {
  return Boolean(memory?.sales_cycle?.infonavit_credit);
}

export const INFONAVIT_CREDIT_TEXT = "Gracias por comentarlo. Como tienes un crédito INFONAVIT activo, el Plan 2 no aplica en tu caso. Lo que te conviene es el Plan 1, de $1,100 MXN mensuales: servicio médico del IMSS y semanas cotizadas, con un salario diario registrado de $480 MXN. ¿Quieres que te explique cómo funciona?";
export const INFONAVIT_CREDIT_PLAN2_TEXT = "Como tienes un crédito INFONAVIT activo, el Plan 2 no aplica en tu caso. La opción para ti es el Plan 1, de $1,100 MXN mensuales, con servicio médico del IMSS y semanas cotizadas. ¿Quieres que iniciemos tu trámite con el Plan 1?";
export const INFONAVIT_CREDIT_PRICE_TEXT = "En tu caso, como tienes un crédito INFONAVIT activo, la opción es el Plan 1: $1,100 MXN mensuales, con servicio médico del IMSS y semanas cotizadas (salario diario registrado de $480 MXN).";
