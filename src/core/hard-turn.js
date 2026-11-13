// ¿Este mensaje lo debe contestar el modelo avanzado? (pedido 9-nov). Solo donde se gana o se pierde la venta:
// dudas de confianza, comparación de precio, casos de pensión complicados, mensajes largos con varias
// preguntas, cliente molesto o cuando Mia ya contestó algo genérico. Devuelve el motivo o null.

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

const WEAK_LAST = [
  /tienes alguna duda sobre el plan [12] o quieres que iniciemos tu tramite\?$/,
  /si te parece bien, ¿iniciamos tu tramite con el plan [12]\?$/,
  /me compartes un poco mas sobre tu situacion\?$/,
  /que te interesa principalmente: servicio medico, semanas, infonavit o afore\?$/,
];

export function hardTurnReason({ text = "", memory = {}, frustrated = false } = {}) {
  const raw = String(text || "");
  const v = norm(raw);
  if (!v) return null;
  if (frustrated || /\b(?:no me (?:entiendes|entiende|contestas|contesta)|ya te dije|ya le dije|otra vez lo mismo|eres (?:un )?robot|no sirve\w*|que mal servicio|me (?:estas|esta) molestando|pesim\w*)\b/.test(v)) return "cliente molesto";
  if (/\b(?:fraude|estafa|engan\w*|no (?:les? )?confio|desconfi\w*|es real|es verdad|es seguro|es legal|que garantia|que seguridad|me dijeron que son)\b/.test(v)) return "duda de confianza";
  if (/\b(?:me ofrecieron|me ofrecen|mas barato|mas economico|otra empresa|en otro lado|otro gestor|la competencia)\b/.test(v)) return "compara precio";
  if (/\b(?:modalidad 40|mod(?:alidad)? ?40|issste|cesantia|vejez|viudez|orfandad|invalidez|pension (?:por|de) (?:viudez|invalidez|cesantia|vejez|orfandad)|dos (?:numeros|nss)|unir (?:mis )?(?:numeros|semanas)|semanas (?:del|de) (?:gobierno|issste))\b/.test(v)) return "caso de pensión complicado";
  if (raw.length > 280 || (raw.match(/\?/g) || []).length >= 2) return "varias preguntas o mensaje largo";
  const last = norm(memory?.ultima_respuesta_agente || "");
  if (last && WEAK_LAST.some(re => re.test(last))) return "Mia ya contestó algo genérico";
  return null;
}
