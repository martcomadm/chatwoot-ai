// Detecta cuando el cliente NIEGA o RECHAZA iniciar/contratar.
// Los detectores de autorización, interés y compromiso buscan frases como
// "quiero iniciar" o "procedamos"; sin esta guarda, "no quiero iniciar el
// trámite" o "mejor no procedamos" se interpretaban como autorización.

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Frases con "no" que en realidad son afirmativas o neutrales.
const BENIGN_NEGATIONS = [
  /\bno hay (?:problema|inconveniente|bronca|pedo)\b/g,
  /\bpor que no\b/g,
  /\bno tengo (?:ninguna )?(?:duda|pregunta)s?\b/g,
  /\bclaro que si\b/g,
];

const NEGATORS = "(?:no|nunca|jamas|tampoco|ni)";

const COMMITMENT_WORDS = [
  "quiero", "quisiera", "deseo", "podemos", "vamos", "voy", "puedo",
  "me interesa", "me quedo", "me convence",
  "procedamos", "iniciemos", "empecemos", "empezemos", "continuemos", "sigamos",
  "proceder", "iniciar", "empezar", "continuar", "contratar", "contratarlo", "hacerlo", "seguir",
  "adelante", "afiliarme", "darme de alta", "dar de alta",
].map(word => word.replace(/ /g, "\\s+")).join("|");

// "no" seguido (con hasta dos palabras intermedias) de un verbo de compromiso:
// "no quiero", "ya no quiero", "no lo quiero", "mejor no procedamos", "no, todavía no iniciemos".
const NEGATED_COMMITMENT = new RegExp(`\\b${NEGATORS}\\b[,.]?(?:\\s+\\S+){0,2}?\\s+(?:${COMMITMENT_WORDS})\\b`);

const EXPLICIT_REJECTION = [
  /\b(?:ya|mejor|todavia|aun|por ahora|por el momento|de momento)\s+no\b/,
  /\bno,?\s+gracias\b/,
  /\bno me interesa\b/,
  /\bno estoy (?:seguro|segura|convencido|convencida|interesado|interesada|listo|lista)\b/,
  /\b(?:cancela|cancelar|cancelalo|olvidalo|dejalo asi)\b/,
];

export function negatesCommitment(text) {
  let value = norm(text);
  if (!value) return false;
  for (const pattern of BENIGN_NEGATIONS) value = value.replace(pattern, " ");
  value = value.replace(/\s+/g, " ").trim();
  if (EXPLICIT_REJECTION.some(pattern => pattern.test(value))) return true;
  return NEGATED_COMMITMENT.test(value);
}
