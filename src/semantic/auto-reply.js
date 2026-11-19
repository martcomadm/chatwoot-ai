// Respuestas automáticas de otros negocios ("Gracias por tu mensaje… en este momento no
// podemos responder"). No son del cliente: Mia no contesta (caso real 16-oct).
function norm(v) { return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim(); }

export function isAutoReply(text) {
  const v = norm(text);
  if (!v || /\b(imss|afiliar\w*|plan\s*[12]|semanas|pension\w*|martcom|mia)\b/.test(v)) return false;
  const signals = [
    /\bgracias por (?:tu|su) (?:mensaje|preferencia|comunicarte|comunicarse|contactarnos)\b/,
    /\ben este momento no (?:podemos|puedo|nos es posible) (?:responder|atender|contestar)/,
    /\b(?:te|le) (?:responderemos|contestaremos|atenderemos)\b|\blo haremos lo antes posible\b|\ba la brevedad\b/,
    /\b(?:respuesta|mensaje) automatic[oa]\b|\bfuera de (?:nuestro )?horario\b/,
    /\b(?:te|le) agradecemos (?:tu|su) preferencia\b/,
  ].filter(re => re.test(v)).length;
  return signals >= 2;
}
