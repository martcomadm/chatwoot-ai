// Decide si el cliente pide explícitamente hablar con una persona del equipo.
// Una solicitud de "asesoría"/"orientación" pertenece a Mia; el handoff exige
// pedir a un humano. La palabra "persona" sola NO basta: "es para otra persona"
// o "¿cuánto cuesta por persona?" son preguntas comerciales normales.

function norm(text) {
  return String(text || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const TARGET = "(?:asesor|asesora|ejecutivo|ejecutiva|persona|humano|humana|alguien|agente)";
const DET = "(?:(?:un|una|el|la|algun|alguna|tu|su|otro|otra)\\s+)?(?:\\w+\\s+)?";

const PATTERNS = [
  /\b(?:quiero|necesito|prefiero|dame|deme)\s+(?:a\s+)?(?:un|una)\s+(?:humano|persona real|agente real|asesor humano|asesora humana)\b/,
  /\b(?:agente real|persona real|atencion personal(?:izada)?)\b/,
  new RegExp(`\\b(?:hablar|platicar|comunicar|comunicarme|contactar|contactarme)\\s+(?:directamente\\s+)?con\\s+${DET}${TARGET}\\b`),
  new RegExp(`\\b(?:pasame|pasenme|comunicame|comuniquenme|comuniqueme|transfiereme|canalizame)\\s+(?:con|a)\\s+${DET}${TARGET}\\b`),
  new RegExp(`\\bque me (?:atienda|llame|marque|contacte)\\s+${DET}${TARGET}\\b`),
  /\b(?:asesor|asesora|ejecutivo|ejecutiva)\s+human[oa]\b/,
  /\b(?:pueden|puede|podrian|podria)\s+(?:llamarme|marcarme)\b|\bquiero una llamada\b|\bhablenme\b|\bmarquenme\b/,
  /\bno quiero (?:hablar con )?(?:un |una )?(?:bot|robot|maquina|ia|inteligencia artificial)\b/,
  // "llamada con un agente que no sea IA", "alguien que no sea AI" (casos reales 19-oct, con faltas).
  /\b(?:alguien|persona|agente|asesor|asesora|humano)\s+(?:que|sue|q|k|ke)\s+no\s+sea[^a-z]{0,6}(?:una?\s+)?(?:ia|ai|bot|robot|maquina|inteligencia artificial)\b/,
  /\bllamada con (?:un |una |el |la |mi )?(?:agente|asesor|asesora|ejecutivo|persona)\b/,
];

export function explicitHumanRequest(text) {
  const value = norm(text);
  if (!value) return false;
  return PATTERNS.some(pattern => pattern.test(value));
}

// Mia ofreció "¿Quieres que te comunique con un asesor?" y el cliente dijo que sí.
export function acceptsAdvisorOffer(text, lastReply = "") {
  if (!/quieres que te comunique con un asesor/.test(norm(lastReply))) return false;
  const value = norm(text).replace(/[^a-z0-9n ]+/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:si|claro|por favor|porfavor|ok|okay|va|sale|de acuerdo|me parece|esta bien|bueno)\b/.test(value) && !/\bno\b/.test(value);
}

// Pide platicarlo por teléfono ("Le puedo marcar xfa", "me gustaría platicarlo bien x teléfono",
// casos reales 20-oct). Este número no recibe llamadas, pero un asesor sí puede regresarle la llamada.
const CALL_PATTERNS = [
  /\b(?:le|te|les)?\s*(?:puedo|podria|puedes|pueden|podrian)\s+(?:marcar|llamar)(?:le|te|les)?\b/,
  /\b(?:me|nos)\s+(?:puede|pueden|podria|podrian|puedes|podrias)\s+(?:marcar|llamar|hablar por telefono)\b/,
  /\b(?:platicar\w*|hablar\w*|explicar\w*|ver\w*|tratar\w*)\b.{0,25}\b(?:por|x|via)\s+(?:telefono|llamada|cel|celular)\b/,
  /\b(?:prefiero|quiero|quisiera|me gustaria)\s+(?:una\s+)?(?:llamada|por telefono|que me (?:llamen|marquen|hablen))\b/,
  /\b(?:a que|que|cual)\s+(?:numero|telefono)\s+(?:les?|te)?\s*(?:puedo\s+)?(?:marco|llamo|marcar|llamar)\b/,
  /\bllamenme\b|\bmarqueme\b|\bmarcame\b|\bllamame\b/,
];

export function callRequest(text) {
  const value = norm(text).replace(/[^a-z0-9n ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value || /\bno (?:me )?(?:llamen|marquen|quiero llamada)\b/.test(value)) return false;
  return CALL_PATTERNS.some(pattern => pattern.test(value));
}

export const CALL_HANDOFF_TEXT = "Este número de WhatsApp no recibe llamadas, pero con gusto un asesor te llama. Ya le dejo el contexto de lo que platicamos para que no tengas que repetirlo. ¿A qué número y en qué horario te queda mejor que te marquemos?";
