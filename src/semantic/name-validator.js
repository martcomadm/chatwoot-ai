const STOP_WORD_ONLY = new Set(["mil","gracias","claro","bueno","perfecto","hola","si","sí","no","ok","sale","adelante","sería","seria"]);
const STOP_PATTERNS = [
  /\b(estoy|tengo|quiero|quisiera|necesito|trabajo|trabajando|desemplead[oa]|empleo|imss|afore|infonavit|curp|nss|seguro)\b/i,
  /\b(ya\s+(?:te|le)?\s*(?:habia|había|he)?\s*dicho|ya\s+(?:te|le)?\s*dije|no\s+tengo|me\s+interesa|requiero\s+asesor[ií]a)\b/i,
  /\b(manejo|cotizar|cotizaci[oó]n|pension|pensión|informaci[oó]n|precio|costo|cu[aá]nto|cuanto|tendr[ií]a|sale|mensualidad|servicio)\b/i,
  /^(?:s[ií]\s+)?pero\b|^ser[ií]a\b|\b(?:que|qu[eé])\s+costo\b|\bnecesito\s+(?:el\s+)?costo\b/i,
];

// Palabras que nunca inician un nombre (casos reales: "Deje trabajar", "Que modalidad
// atienden", "Claro que sí", "Sí gracias", "Como es", "Y si es legal").
const NEVER_FIRST = new Set(["que", "qué", "como", "cómo", "cual", "cuál", "cuales", "cuáles", "donde", "dónde", "cuando", "cuándo", "cuanto", "cuánto",
  "si", "sí", "no", "claro", "ok", "okey", "gracias", "y", "o", "pero", "deje", "dejé", "es", "ya", "hola", "buenas", "buenos", "bien", "muy",
  "mi", "yo", "el", "la", "los", "las", "un", "una", "este", "esta", "eso", "esto", "perfecto", "listo", "quiero", "tengo", "soy", "estoy",
  "por", "para", "con", "sin", "a", "al", "en", "de", "del", "me", "le", "te", "se", "lo", "su", "nada", "nomas", "nomás", "tambien", "también",
  "vale", "va", "sale", "bueno", "porfa", "nesecito", "necesito", "ocupo", "busco", "ahorita", "ahora", "entonces", "pues", "oiga", "oye", "disculpe", "perdon", "perdón", "porque", "aun", "aún",
  // Casos reales 23 al 26-oct: "Q prosige", "Q devo de aser", "Ambos cosas", "Todo lo mencionado", "Mari estoy viendo".
  "q", "k", "x", "ambos", "ambas", "todo", "todos", "todas", "las", "nop", "nel", "osea", "pos"]);
// "Porfa Expliqueme", "Nesecito Afiliarme" (casos reales 19 y 20-oct) también se guardaban como nombre.
const NEVER_ANY = /\b(?:porfa|porfavor|expl[ií]que\w*|espl[ií]que\w*|explica\w*|nesecito|necesito|nesesito|afiliar\w*|afiliacion\w*|afiliaciones|inscrib\w*|ayuda|ayudar\w*|interesa\w*|informacion|info|dudas?|pregunta\w*|consulta|asesor\w*|ocupo|busco|gracias|modalidad|atienden|trabajar|legal|empresa|patron(?:es)?|planes?|diferencia|hay|cuesta|costo|ubicaci[oó]n|informes?|favor|semanas|años|anos|hogar|casa|esposo|esposa|hijos?|solo|servicios?|m[eé]dic\w*|ustedes|financ\w*|mensualidad\w*|tiempo|alta|imss|imms|tramite|trámite|iniciar|haber|aclar\w*|ecuaci[oó]n|seguir|año|trabaj\w*|chofer|taxi\w*|construcci[oó]n|obrero|ovrero|comerciante|empleado|colima|d[eé]j[ae]me|d[eé]jeme|deja|dejame|perm[ií]t[ae]me|perm[ií]tame|checo|checar|chec[oa]|confirm\w*|cosas?|mencionad[oa]s?|prosig\w*|devo|debo|aser|hacer|hago|revis\w*|momento|poquito|pokito|ratito|espere?|esperame|luego|despu[eé]s|ma[ñn]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|viendo|opciones|pensar\w*|aviso|llamo|ok|okey|ninguna|nada|cotizo|cotizando|pagando|pago)\b/i;

export function validateNameCandidate(value) {
  const text = String(value ?? "").trim().replace(/[.,;:!?]+$/g, "").replace(/\b([A-Za-z]{1,3})\.(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/g, "$1. ");
  const firstWord = text.split(/\s+/)[0]?.toLowerCase() || "";
  if (NEVER_FIRST.has(firstWord) || NEVER_ANY.test(text)) return { ok: false, reason: "not_a_name" };
  if (!text || text.length < 4 || text.length > 90 || /\d/.test(text)) return { ok: false, reason: "shape" };
  if (STOP_WORD_ONLY.has(text.toLowerCase())) return { ok: false, reason: "stop_word" };
  if (/^(mil\s+)?gracias(?:\s+por.*)?$/i.test(text)) return { ok: false, reason: "gratitude_phrase" };
  if (STOP_PATTERNS.some((pattern) => pattern.test(text))) return { ok: false, reason: "conversation_phrase" };
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 7) return { ok: false, reason: "word_count" };
  // Abreviaturas como "Ma." (María) o "J." son parte del nombre (caso real: "Ma.Magdalena Banda Mendoza").
  if (words.some((word) => !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+$/.test(word) && !/^[A-Za-zÁÉÍÓÚÑáéíóúñ]{1,3}\.$/.test(word))) return { ok: false, reason: "characters" };
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

  // "Nombre: Rosa Martha Molina" (aunque no se haya preguntado).
  const labeled = raw.match(/\bnombre\s*[:=-]\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]{3,90})/i)?.[1];
  if (labeled) {
    const candidate = labeled.split(/\n/)[0].trim();
    if (validateNameCandidate(candidate).ok || isSingleName(candidate)) return titleCaseName(candidate);
  }

  const asked = memory?.ultima_pregunta === "nombre" || memory?.flujo?.siguiente_paso === "nombre";
  if (!asked) return null;
  const soy = raw.match(/^soy\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{4,90})$/i)?.[1];
  if (soy && validateNameCandidate(soy).ok) return titleCaseName(soy);
  // "Soy Elisa, cuento con 58 años": se toman las palabras con mayúscula después de "soy".
  const soyCapital = raw.match(/^[Ss]oy\s+((?:[A-ZÁÉÍÓÚÑ][a-záéíóúüñ]+)(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúüñ]+){0,4})\b/)?.[1];
  if (soyCapital && (validateNameCandidate(soyCapital).ok || isSingleName(soyCapital))) return titleCaseName(soyCapital);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (validateNameCandidate(line).ok) return titleCaseName(line);
  }
  // Un solo nombre de pila ("Liliana") cuando se acaba de preguntar el nombre.
  for (const line of lines) {
    if (isSingleName(line)) return titleCaseName(line);
  }
  return null;
}

// Para nombres que propone la IA: se aceptan nombres completos válidos o un nombre de pila.
export function plausibleName(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && (validateNameCandidate(text).ok || isSingleName(text));
}

function isSingleName(value) {
  const text = String(value ?? "").trim().replace(/[.,;:!?]+$/g, "");
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,20}$/.test(text)) return false;
  if (NEVER_FIRST.has(text.toLowerCase()) || NEVER_ANY.test(text) || STOP_WORD_ONLY.has(text.toLowerCase())) return false;
  return /^[A-ZÁÉÍÓÚÑ]/.test(text);
}
