// El cliente quiere iniciar, pero en una fecha: "me gustaría que se realizara ahora pero para cubrir el pago
// sería en unos 10 días", "¿le parece que comencemos en la segunda quincena de noviembre?" (casos reales 3 al
// 5-nov). Antes se despedía con "cuando puedas, escríbeme" o la IA lo confirmaba sin abrir el trámite, y la
// venta se perdía. Ahora la venta queda autorizada con la fecha, se piden los documentos desde hoy y Captura
// recibe una nota para programar el alta (así lo hizo Brenda el 5-nov: "la inscripción debe llevarse a cabo el
// 27 de noviembre"). El primer pago se hace hasta que el alta aparece vigente (regla de MARTCOM).
import { negatesCommitment } from "./commitment-negation.js";

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const DAYS = "lunes|martes|miercoles|jueves|viernes|sabado|domingo";

const INTENT_RE = new RegExp([
  "\\bm(?:e|ie|i me) gustaria (?:que )?(?:se )?(?:realiz|inici|hici|hag|empez|comenz|dier|tramit|diera|quede|quedara|arranc)\\w*",
  "\\bm(?:e|ie|i me) gustaria (?:iniciar|empezar|comenzar|darme de alta|hacer el tramite|contratar)\\b",
  "\\b(?:si )?(?:quiero|queremos|deseo|quisiera|pienso) (?:iniciar|empezar|comenzar|darme de alta|dar de alta|hacer el tramite|contratar|arrancar|tramitar)\\b",
  "\\b(?:iniciemos|comencemos|empecemos|empezemos|arranquemos)\\b",
  "\\b(?:lo|la) (?:iniciamos|empezamos|comenzamos|hacemos|tramitamos|arrancamos)\\b",
  "\\b(?:podemos|podriamos|puedo|podria) (?:iniciar|empezar|comenzar|arrancar|darme de alta|hacer el tramite)\\b",
  "\\bsi me interesa\\b|\\bme interesa (?:mucho|bastante)\\b",
].join("|"));

// Cuándo. Devuelve el texto tal como lo dijo, para repetírselo.
const WHEN_RE = new RegExp([
  `\\b(?:(?:la|en la|para la|a la) )?(?:primera|segunda|1a|2a|1ra|2da) quincena(?: de (?:${MONTHS}))?\\b`,
  `\\b(?:la|mi|en la|para la|en mi|para mi) (?:proxima |siguiente )?quincena\\b`,
  "\\b(?:en|dentro de) (?:unos |como |aproximadamente |aprox |mas o menos )?(?:\\d{1,2}|un|una|dos|tres|cuatro|cinco|diez|quince) (?:dias|semanas?)\\b",
  "\\b(?:la|en la|para la) (?:proxima|siguiente|otra) semana\\b",
  "\\b(?:el|al|para el|en el) (?:proximo|siguiente) mes\\b",
  `\\b(?:a|para|en) (?:fin|finales|principios|inicios) de(?: (?:mes|${MONTHS}))?\\b`,
  `\\b(?:el|para el|a partir del?) (?:dia (?:[1-9]|[12]\\d|3[01])|(?:[1-9]|[12]\\d|3[01]|primero) de (?:${MONTHS}))\\b`,
  `\\b(?:en|para|hasta) (?:${MONTHS})\\b`,
  `\\b(?:el|este|para el|hasta el) (?:${DAYS})\\b`,
  "\\bcuando (?:me (?:paguen|depositen|llegue (?:mi|el) (?:deposito|pago|sueldo|quincena))|cobre|reciba (?:mi )?(?:pago|sueldo|deposito|quincena))\\b",
].join("|"));

// Pregunta con la que Mia ofrece programar el alta (customer-deferral.js). Si contesta solo la fecha ("el 15",
// "en la quincena"), eso basta.
export const SCHEDULE_OFFER_MARK = "¿Para qué fecha te acomoda?";

const ACCENTS = [[/\bdias\b/g, "días"], [/\bdia\b/g, "día"], [/\bproxima\b/g, "próxima"], [/\bproximo\b/g, "próximo"], [/\bmiercoles\b/g, "miércoles"], [/\bsabado\b/g, "sábado"]];

export function detectScheduledStart(text = "", { offered = false } = {}) {
  const value = norm(text).replace(/[,;:!¡¿?]+/g, " ").replace(/\.{1,}/g, " ").replace(/\s+/g, " ").trim();
  if (!value || negatesCommitment(value)) return null;
  if (/\bno (?:me interesa|quiero|voy a|creo)\b/.test(value)) return null;
  // A la oferta también se contesta solo con la fecha, o "sí, para el 15".
  if (!INTENT_RE.test(value) && !offered) return null;
  if (offered && /\b(?:no|nel|tampoco|ya no|mejor no)\b/.test(value) && !INTENT_RE.test(value)) return null;
  // "Si me interesa, el sábado confirmo" todavía no decide: pospone (customer-deferral.js).
  if (/\b(?:confirmo|le confirmo|te confirmo|aviso|abiso|decido|lo pienso|lo veo|lo checo|lo consulto|lo platico)\b/.test(value)) return null;
  // "Sí me interesa, ¿cuánto cuesta el 2?" pregunta, no pone fecha.
  if (/[?¿]/.test(String(text)) && /\b(?:cuanto|cuesta|costo|precio|que incluye|cual)\b/.test(value)) return null;
  // A la oferta ("¿Para qué fecha te acomoda?") basta "el 15".
  const m = value.match(WHEN_RE) || (offered ? value.match(/\b(?:el|para el|hasta el) (?:[1-9]|[12]\d|3[01])\b/) : null);
  if (!m) return null;
  let when = m[0].replace(/^(?:a partir del?|hasta el|hasta|para el|para la|para mi|para|en el|en la|en mi|al|a la|a)\s+/, "").trim();
  // "el lunes", "la próxima semana" se leen mejor con artículo; "unos 10 días" con "en".
  if (/^(?:unos|como|aproximadamente|aprox|mas o menos|\d|un |una |dos|tres|cuatro|cinco|diez|quince)/.test(when) && /\b(?:dias|semanas?)\b/.test(when)) when = `en ${when}`;
  else if (new RegExp(`^(?:${DAYS})$`).test(when)) when = `el ${when}`;
  else if (/^(?:proxima|siguiente|otra) semana$|^(?:(?:primera|segunda|1a|2a|1ra|2da|proxima|siguiente) )?quincena/.test(when)) when = `la ${when}`;
  else if (/^(?:proximo|siguiente) mes$/.test(when)) when = `el ${when}`;
  else if (/^(?:fin|finales|principios|inicios) de/.test(when)) when = `a ${when}`;
  else if (/^(?:dia )?(?:\d|primero)/.test(when)) when = `el ${when}`;
  else if (new RegExp(`^(?:${MONTHS})$`).test(when)) when = `en ${when}`;
  else if (/^cuando\b/.test(when)) when = when;
  for (const [re, rep] of ACCENTS) when = when.replace(re, rep);
  return { when, text: String(text || "").trim().slice(0, 240) };
}

function forTarget(w = "") {
  return /^en .*\b(?:días|semanas?)$/.test(w) ? `dentro de ${w.slice(3)}`
    : /^(?:en|a) /.test(w) ? w.slice(w.indexOf(" ") + 1)
    : w;
}

export function scheduledStartIntro(scheduled = {}) {
  const w = String(scheduled.when || "");
  const target = w ? forTarget(w).replace(/\bme (paguen|depositen|llegue)\b/, "te $1").replace(/\bmi\b/g, "tu").replace(/\bcobre\b/, "cobres").replace(/\breciba\b/, "recibas") : "";
  const when = target ? ` para ${target}` : "";
  return `¡Perfecto! Dejamos tu trámite apartado y le pido al equipo que programe tu alta${when}. Hoy no pagas nada: el primer pago se hace hasta que tu alta ya aparece vigente.`;
}

export function scheduledStartNote(scheduled = {}) {
  const w = String(scheduled.when || "");
  const target = w ? forTarget(w).replace(/\bme (paguen|depositen|llegue)\b/, "le $1").replace(/\bmi\b/g, "su").replace(/\bcobre\b/, "cobre").replace(/\breciba\b/, "reciba") : "la fecha que indica";
  return `MÍA → CAPTURA\nEl cliente quiere iniciar su trámite pero con fecha: "${scheduled.text || ""}". Programen el alta para ${target} y confírmenle por aquí. Mia ya le pidió sus documentos.`;
}
