const STOP_WORD_ONLY = new Set(["mil","gracias","claro","bueno","perfecto","hola","si","sí","no","ok","sale","adelante","sería","seria"]);
const STOP_PATTERNS = [
  /\b(estoy|tengo|quiero|quisiera|necesito|trabajo|trabajando|desemplead[oa]|empleo|imss|afore|infonavit|curp|nss|seguro)\b/i,
  /\b(ya\s+(?:te|le)?\s*(?:habia|había|he)?\s*dicho|ya\s+(?:te|le)?\s*dije|no\s+tengo|me\s+interesa|requiero\s+asesor[ií]a)\b/i,
  /\b(manejo|cotizar|cotizaci[oó]n|pension|pensión|informaci[oó]n|precio|costo|cu[aá]nto|cuanto|tendr[ií]a|sale|mensualidad|servicio)\b/i,
  /^(?:s[ií]\s+)?pero\b|^ser[ií]a\b|\b(?:que|qu[eé])\s+costo\b|\bnecesito\s+(?:el\s+)?costo\b/i,
];

export function validateNameCandidate(value) {
  const text = String(value ?? "").trim().replace(/[.,;:!?]+$/g, "");
  if (!text || text.length < 4 || text.length > 90 || /\d/.test(text)) return { ok: false, reason: "shape" };
  if (STOP_WORD_ONLY.has(text.toLowerCase())) return { ok: false, reason: "stop_word" };
  if (/^(mil\s+)?gracias(?:\s+por.*)?$/i.test(text)) return { ok: false, reason: "gratitude_phrase" };
  if (STOP_PATTERNS.some((pattern) => pattern.test(text))) return { ok: false, reason: "conversation_phrase" };
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 7) return { ok: false, reason: "word_count" };
  if (words.some((word) => !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+$/.test(word))) return { ok: false, reason: "characters" };
  return { ok: true, reason: "valid" };
}

export function titleCaseName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").split(" ")
    .map((part) => part ? part[0].toLocaleUpperCase("es-MX") + part.slice(1).toLocaleLowerCase("es-MX") : part)
    .join(" ");
}

export function extractValidatedName(text, memory = {}) {
  const raw = String(text ?? "").trim();
  const explicit = raw.match(/(?:mi nombre (?:completo )?es|me llamo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{4,90})/i)?.[1];
  if (explicit) {
    const candidate = explicit.split(/[,.!?\n]/)[0].trim();
    if (validateNameCandidate(candidate).ok) return titleCaseName(candidate);
  }

  const asked = memory?.ultima_pregunta === "nombre" || memory?.flujo?.siguiente_paso === "nombre";
  if (!asked) return null;
  const soy = raw.match(/^soy\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{4,90})$/i)?.[1];
  if (soy && validateNameCandidate(soy).ok) return titleCaseName(soy);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (validateNameCandidate(line).ok) return titleCaseName(line);
  }
  return null;
}
