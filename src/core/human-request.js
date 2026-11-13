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
  // Molestia porque le contesta un sistema (caso real 2-nov, Irma: "no sé si es una computadora la que me está
  // contestando, siempre les pregunto lo mismo y no me contestan" y luego "pinche computadoras"): pasa a una persona.
  /\b(?:es|sea|son)\s+(?:una?\s+)?(?:computadora|maquina|robot|bot|grabadora|contestadora)s?\b.{0,40}\b(?:contest|respond)\w*/,
  /\b(?:me|nos)\s+(?:esta\s+)?(?:contesta|responde|atiende)\s+(?:una?\s+)?(?:computadora|maquina|robot|bot|contestadora)\b/,
  /\bpinches?\s+(?:computadoras?|maquinas?|robots?|bots?)\b/,
  // Cliente que ya está (o estuvo) con MARTCOM y reclama (caso real 10-nov: "ya pagué más de un año con ustedes… no me
  // dieron de baja… no sé con quién hablo que no entiende" recibió los planes dos veces y terminó insultando).
  /\bya (?:pague|cumpli|estuve|termine)\b.{0,40}\bcon ustedes\b|\b(?:llevo|tengo|pague|estuve)\b.{0,25}\b(?:ano|anos|meses)\b.{0,25}\bcon ustedes\b/,
  /\bno (?:me )?(?:han dado|dieron|pueden dar|quieren dar|han podido dar)\s+(?:de\s+)?(?:la\s+)?baja\b|\bno presentan la baja\b|\bmi tramite esta detenido\b/,
  /\bno he (?:tenido|recibido) (?:ninguna |una )?respuesta\b|\bsigo esperando\b.{0,30}\b(?:respuesta|llamada|que me)\b|^sigo esperando$/,
  /\bno se con quien hablo\b|\b(?:que|usted|ustedes) no entiend\w+\b|\bno me entiend\w+\b/,
  /\b(?:hdspm|chspm|hdp|hijos? de (?:su|tu) (?:puta|perra|chingada)|chingu?en a su|pendej[oa]s?|rater[oa]s|ladrones|estafadores)\b/,
];

export function explicitHumanRequest(text) {
  const value = norm(text);
  if (!value) return false;
  return PATTERNS.some(pattern => pattern.test(value));
}

// Mia ofreció "¿Quieres que te comunique con un asesor?" y el cliente dijo que sí.
export function acceptsAdvisorOffer(text, lastReply = "") {
  // "¿…o prefieres que un asesor revise tu caso primero?" → "Sí, revisarlo por favor" (caso real 27-oct).
  if (/prefieres que un asesor revise tu caso/.test(norm(lastReply)) && /\b(?:asesor|r?revis\w*|que lo revise|que lo vea|revision)\b/.test(norm(text)) && !/\b(?:iniciemos|iniciar|no)\b/.test(norm(text))) return true;
  // "Puedo comunicarte con un asesor para que revise tu caso" → "Si me interesa la asesoría" (12-nov, #11645).
  if (!/(?:quieres que te comunique|puedo comunicarte|te puedo comunicar|te comunico|deseas que te comunique|te gustaria que te comunique) con un asesor/.test(norm(lastReply))) return false;
  const value = norm(text).replace(/[^a-z0-9n ]+/g, " ").replace(/\s+/g, " ").trim();
  // "Ok, voy a buscar la hoja rosa y te envío foto" (caso real 21-oct) no es aceptar al asesor.
  const short = value.split(" ").length <= 5 || /\b(?:asesor|asesora|persona|comuni\w*|pasame|pasenme)\b/.test(value);
  return short && /^(?:si|claro|por favor|porfavor|ok|okay|va|sale|de acuerdo|me parece|esta bien|bueno|me interesa)\b/.test(value) && !/\bno\b/.test(value) && !/\b(?:voy a|luego|despues|manana|te envio|te mando)\b/.test(value);
}

// Pide platicarlo por teléfono ("Le puedo marcar xfa", "me gustaría platicarlo bien x teléfono",
// casos reales 20-oct). Este número no recibe llamadas, pero un asesor sí puede regresarle la llamada.
const CALL_PATTERNS = [
  // "Por favor comuníquense conmigo" (10-nov: recibió "¿tienes alguna duda sobre el Plan 1?").
  /\b(?:comuniquen?se|comuniquese|comunicarse|contactenme|contactense|llamenme|llameme|marqueme)\b(?:\s+con\s*migo|\s+conmigo)?/,
  /\bque (?:alguien |un asesor |una persona )?se (?:comunique|comuniquen|contacte|contacten) con\s*migo\b/,
  /\b(?:le|te|les)?\s*(?:puedo|podria|puedes|pueden|podrian)\s+(?:marcar|llamar)(?:le|te|les)?\b/,
  /\b(?:me|nos)\s+(?:puede|pueden|podria|podrian|puedes|podrias)\s+(?:marcar|llamar|hablar por telefono)\b/,
  /\b(?:platicar\w*|hablar\w*|explicar\w*|ver\w*|tratar\w*)\b.{0,25}\b(?:por|x|via)\s+(?:telefono|llamada|cel|celular)\b/,
  /\b(?:prefiero|quiero|quisiera|me gustaria)\s+(?:una\s+)?(?:llamada|por telefono|que me (?:llamen|marquen|hablen))\b/,
  /\b(?:a que|que|cual)\s+(?:numero|telefono)\s+(?:les?|te)?\s*(?:puedo\s+)?(?:marco|llamo|marcar|llamar)\b/,
  /\bllamenme\b|\bmarqueme\b|\bmarcame\b|\bllamame\b/,
  // "Su tel. Cel.", "Tel", "¿Me da su número de teléfono?" (casos reales 25 y 26-oct): quiere llamar.
  /^(?:(?:su|tu|un|el|me da su|me das tu|me pasa su|me pasas tu|cual es su|cual es tu)\s+)?(?:tel|telefono|cel|celular|numero de telefono|numero telefonico|whats para llamar)(?:\s+(?:cel|celular|por favor|porfa|para llamar))*$/,
  /\b(?:me (?:da|das|pasa|pasas|comparte|compartes|proporciona)|cual es)\s+(?:su|tu|el|un)\s+(?:numero de )?(?:telefono|tel|celular|cel)\b/,
  // "¿Algún teléfono para poder marcar?", "comunicación vía telefónica", "no puedo hablar con nadie" (caso real 27-oct).
  /\b(?:algun|un|su|otro)\s+(?:numero|telefono|tel)\s+(?:para|donde|al que|a donde)\s+(?:pode\w*\s+|pueda\s+|les\s+)?(?:marcar|llamar|hablar|comunicarme)\b/,
  /\b(?:comunicacion|hablar|platicar)\s+(?:via|por)\s+(?:telefonica|telefono|llamada)\b|\bno puedo hablar con nadie\b/,
  // "Si me permites que sea personal, mejor con un contacto" (13-nov, #11719 recibió "aquí te espero").
  /\b(?:que sea|sea|seria|mejor)\s+(?:en\s+)?personal\b|\bmejor\s+con\s+(?:un|una)\s+(?:contacto|persona|asesor\w*)\b/,
  // "¿me las podrían aclarar por medio de una llamada?" (12-nov, #11633: recibió la lista de precios).
  /\b(?:por medio de|mediante|con)\s+una\s+llamada\b|\b(?:aclarar|resolver|explicar|platicar|ver)\w*\b.{0,40}\b(?:en|por|x)\s+(?:una\s+)?(?:llamada|telefono)\b/,
];

export function callRequest(text) {
  const value = norm(text).replace(/[^a-z0-9n ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value || /\bno (?:me )?(?:llamen|marquen|quiero llamada)\b/.test(value)) return false;
  return CALL_PATTERNS.some(pattern => pattern.test(value));
}

export const CALL_HANDOFF_TEXT = "Este número de WhatsApp no recibe llamadas, pero con gusto un asesor te llama. Ya le dejo el contexto de lo que platicamos para que no tengas que repetirlo. ¿A qué número y en qué horario te queda mejor que te marquemos?";

// Último seguimiento (4-nov): "¿Prefieres que un asesor te llame…? Dime sí y a qué hora…".
// "Sí", "a las 5", "mañana en la tarde", "después de las 6" aceptan la llamada.
export const CALL_OFFER_MARK = "prefieres que un asesor te llame";
// 12-nov: también cuentan las ofertas de llamada de las respuestas del equipo y de la IA ("podemos agendar una
// llamada el día de mañana a partir de las 10:00 am… ¿Estás de acuerdo?"). Tres clientes dijeron "sí, de acuerdo"
// y nadie registró la llamada (#11638, #11649).
const CALL_OFFER_RE = /prefieres que un asesor te llame|(?:agendar|agendemos|programar|programemos|fijar|fijemos)\s+(?:una|tu|la)\s+llamada|(?:que|si)\s+(?:un asesor|una asesora|alguien del equipo)\s+te\s+(?:llame|marque)|te\s+(?:llame|marque)\s+un\s+asesor|(?:realizarle|hacerte|hacerle)\s+una\s+llamada/;
// Hora que Mia ya propuso en la oferta ("mañana a partir de las 10:00 am").
function offeredTime(lastReply = "") {
  const m = norm(lastReply).match(/\b(?:(?:el dia de )?(?:hoy|manana|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo))\s+)?(?:a partir de las|despues de las|a las)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a m|p m|hrs?)?/);
  return m ? m[0].replace(/^el dia de /, "").trim() : null;
}
const TIME_RE = /\b(?:a las|alas|despues de las|antes de las|entre las|de las)\s*\d{1,2}(?::\d{2})?|\b\d{1,2}(?::\d{2})?\s*(?:am|pm|hrs?|horas)\b|\b(?:en la|por la)\s+(?:manana|tarde|noche)\b|\b(?:ahorita|ahora|ya|cuando gusten|cuando quieran|a cualquier hora|cualquier hora|hoy|manana)\b/;
export function acceptsCallOffer(text, lastReply = "") {
  if (!CALL_OFFER_RE.test(norm(lastReply))) return null;
  const value = norm(text).replace(/[^a-z0-9n: ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value || /^(?:no|nop|nel)\b|\bno (?:gracias|me llamen|me marquen|puedo|quiero|me interesa)\b|\bya no\b|\bpor mensaje\b|\bpor (?:aqui|escrito|whats)\b/.test(value)) return null;
  // "Ok checo las recomendaciones" (12-nov, #11617) no acepta la llamada: lo va a revisar por su cuenta.
  if (/\b(?:checo|chequo|reviso|reviso|analizo|lo pienso|lo voy a pensar|lo veo|lo checo|lo reviso|recomendaciones|resenas|facebook|luego le|luego te|yo le (?:marco|aviso|escribo)|yo me comunico|yo les? (?:marco|aviso|escribo))\b/.test(value)) return null;
  const proposed = offeredTime(lastReply);
  const yes = /^(?:si+|sip|claro|ok|okay|va|vale|sale|por favor|porfavor|de acuerdo|me parece|esta bien|bueno|perfecto|adelante|orale)\b/.test(value);
  const time = TIME_RE.test(value);
  if (!yes && !time) return null;
  if (!time && value.split(" ").length > 6) return null;
  return time ? { time: String(text || "").trim().slice(0, 120) } : proposed ? { time: proposed, proposed: true } : { time: null };
}
export function callOfferReply(accepted) {
  return accepted?.time
    ? `¡Perfecto! Le dejo tu horario${accepted.proposed ? ` (${accepted.time})` : ""} a un asesor para que te marque a este número, y también el contexto de lo que platicamos para que no tengas que repetirlo.`
    : "¡Perfecto! Un asesor te va a llamar a este número y ya le dejo el contexto de lo que platicamos. ¿En qué horario te queda mejor que te marque?";
}
