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
];

export function explicitHumanRequest(text) {
  const value = norm(text);
  if (!value) return false;
  return PATTERNS.some(pattern => pattern.test(value));
}
