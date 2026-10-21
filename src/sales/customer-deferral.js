import { plausibleName } from "../semantic/name-validator.js";
// Cuando el cliente pospone ("ahorita no tengo dinero", "yo le aviso") o cierra la
// plática ("no, todo bien, gracias"), Mia debe despedirse con amabilidad y dejar de
// insistir: no volver a ofrecer el plan, no pedir más datos y no programar seguimientos.

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// "cuanto" aparece seguido como error de dedo de "cuento" ("no cuánto con dinero").
const NO_MONEY_RE = [
  /\bno (?:cuento|cuanto|tengo|traigo|dispongo)(?: ahorita| ahora| por ahora)?(?: con)? (?:el |la |los )?(?:dinero|recurso|recursos|lana|varo|fondos|presupuesto|para pagar|para pagarlo|forma de pagar|forma de pago|como pagar)\b/,
  /\bno tengo (?:ahorita |ahora |por el momento )?(?:la |una )?(?:forma|manera|modo) de pagar\b/,
  /\b(?:ahorita|por el momento|por ahora|de momento|en este momento)\b.{0,40}\bno (?:puedo pagar|tengo (?:dinero|para)|cuento con|cuanto con|me alcanza)\b/,
  /\bestoy (?:corta|corto|sin dinero|sin lana)\b/,
  // "No conseguí el dinero para depositarlo" (caso real 19-oct, con faltas).
  /\bno\s*(?:consegui|consigi|consigui|junte|pude juntar|pude conseguir|alcance)\b.{0,25}\b(?:dinero|lana|pago|deposit\w*|pagar)\b/,
];

const LATER_RE = [
  /\b(?:yo )?(?:le|les|los|las|te) (?:aviso|escribo|contacto|marco|busco|confirmo)\b/,
  /\bcuando (?:yo )?(?:pueda|tenga|junte|me paguen|cobre|lo tenga|tenga el dinero)\b/,
  /\b(?:mas adelante|despues (?:le|les|te) (?:escribo|aviso)|luego (?:le|les|te) (?:escribo|aviso)|otro dia)\b/,
  /\blo (?:voy a pensar|pienso|consulto|platico|reviso|checo|analizo)\b/,
  /\b(?:dej[ae]me|deja|deje|dejeme)\s+(?:lo\s+)?(?:platico|platicar|consulto|consultar|comento|comentar|hablo|hablar)\b|\b(?:lo\s+)?(?:platico|consulto|comento|hablo)\s+con\s+(?:mi|mis)\s+(?:esposo|esposa|pareja|familia|hijos?|hijas?|marido|senora|mama|papa)\b/,
  /\b(?:yo\s+)?(?:me|nos)\s+(?:comunicaria|comunicariamos|comunico|comunicamos|pongo en contacto|reporto)\s+con\s+(?:ustedes|usted|contigo|ella|el)\b|\b(?:aun|todavia)\s+no\s+(?:he|eh|e|hemos)\s+(?:hablado|platicado|consultado|decidido)\b/,
  // Casos reales 17-oct: "lo estoy considerando", "te mando mañana", "para el siguiente mes",
  // "lunes o martes", "voy de salida… le mando mensaje", "sería ahora que renuncie".
  /\b(?:lo|la)\s+estoy\s+(?:considerando|pensando|analizando|viendo|revisando)\b|\b(?:estoy|estamos)\s+(?:platicando|viendo|consultando|hablando)(?:lo)?\s+con\s+(?:mi|mis)\b/,
  /\b(?:te|le|les)\s+(?:lo\s+|los\s+|las\s+)?(?:mando|envio|paso|comparto)\s+(?:manana|el lunes|el martes|en la semana|mas tarde|al rato|despues)\b|\bmanana\s+(?:te|le|les)\s+(?:mando|envio|paso|escribo)\b/,
  /\b(?:para|hasta|a partir de)\s+(?:el\s+)?(?:siguiente|proximo|otro)\s+mes\b|\b(?:el\s+)?(?:1|primero)\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|\b(?:la\s+)?(?:proxima|siguiente|otra)\s+semana\b|\b(?:lunes|martes|miercoles|jueves|viernes|sabado)\s+o\s+(?:lunes|martes|miercoles|jueves|viernes|sabado)\b/,
  /\bvoy de salida\b|\b(?:le|te)\s+mando\s+mensaje\b.{0,25}\b(?:regrese|regreso|llegue|pueda)\b|\bestoy ocupad[oa]\b/,
  /\b(?:seria|sera|cuando)\s+(?:ahora\s+)?(?:que\s+)?(?:renuncie|me liquiden|deje de trabajar|salga del trabajo|me den de baja)\b/,
  /\b(?:me|nos)\s+vuelvo\s+a\s+(?:comunicar|poner en contacto)|\b(?:me|nos)\s+volvemos\s+a\s+comunicar|\b(?:te|le|les)\s+vuelvo\s+a\s+(?:escribir|marcar|contactar)\b/,
  /\b(?:dej[ae]me|deje|dejeme) (?:lo )?(?:reviso|revisar|checo|checar|pienso|pensar|veo|ver|analizo)\b|\bvoy a (?:revisar|checar|pensarlo|analizarlo)\b/,
  /\b(?:te|le|les) (?:mando|escribo|envio) (?:un )?(?:mensaje|msj)? ?mas tarde\b|\bmas tarde (?:te|le|les) (?:escribo|mando|aviso)\b|\bte puedo mandar mensaje mas tarde\b/,
  /\b(?:me|nos) (?:comunico|comunicamos|reporto|pongo en contacto)\b.{0,25}\b(?:mas adelante|maz adelante|despues|luego|en otro momento|otro dia)\b/,
  // Casos reales 19 y 20-oct: "voy a comentar y me comunico nuevamente", "primero platico con
  // mi familia" (con faltas: "boy", "coni"), "más delante", "por el momento no", "deja juntar y
  // te vuelvo a mandar mensaje", "salgo a ver dónde lo consigo".
  /\b(?:voy|boy|vamos) a (?:comentar|comentarlo|platicar|platicarlo|consultar|consultarlo|hablarlo|pensar|pensarlo|ver)(?:lo)?\b|\b(?:me|nos) (?:comunico|comunicamos|reporto) (?:nuevamente|de nuevo|otra vez)\b/,
  /\b(?:platic|consult|coment|habl)\w*\s+con(?:\s*i|\s+mi|\s+mis|\s+la|\s+el)?\s*(?:familia|esposo|esposa|pareja|hijos?|hijas?|marido|senora|mama|papa)\b/,
  /\bmas d?e?lante\b|^(?:por el momento|de momento|por ahora|ahorita|en este momento|por lo pronto)\s+no\b/,
  /\b(?:dej[ae]me|deja|deje)\s+(?:junt\w*|ahorr\w*|reun\w*)\b|\b(?:te|le|les) vuelvo a (?:mandar|enviar) (?:un )?(?:mensaje|msj)\b/,
  /\b(?:salgo|voy) (?:a ver|aber|haber|a buscar)\b.{0,30}\b(?:consigo|conseguir|junto|juntar|dinero|lana)\b/,
  // "Mañana ok necesito checar mi número de IMSS", "Voy a buscar los papeles" (casos reales 20 y 21-oct).
  /^(?:ok\s+|bueno\s+|si\s+)?manana\b|\b(?:necesito|tengo que|voy a|deja|dejame|dejeme)\s+(?:checar|buscar|revisar|ver|conseguir|sacar|localizar)\s+(?:mi|mis|el|la|los|las)\s+(?:numero|nss|curp|ine|papeles|documentos|datos|credencial)\b/,
  /\bestoy en espera de\b|\btodavia no (?:lo )?(?:decido|se|tengo)\b|\bno gracias,? (?:despues|luego|mas adelante)\b/,
];

const THANKS_RE = /\b(?:gracias|grasias|graciaz|todo bien|igualmente|saludos|bendiciones|que amable)\b/;
const CLOSING_ONLY_RE = /^(?:(?:a|ah|ahh|oh|ok|okay|okey|si|no|ninguna|ninguno|nada|vale|va|bueno|muy bien|todo bien|esta bien|perfecto|listo|de acuerdo|entendido|gracias|grasias|graciaz|muchas gracias|mil gracias|muchisimas gracias|que amable|igualmente|saludos|bendiciones|excelente|por la informacion|por todo)[ ,.!]*)+$/;

function asksSomething(text) {
  return /[?¿]/.test(String(text || "")) || /\b(?:cuanto|cuando abren|que documentos|cuales|como le hago|donde)\b/.test(norm(text)) && !/\bcuando (?:yo )?(?:pueda|tenga)\b/.test(norm(text));
}

// "no_money" | "later" | null
export function detectDeferral(text) {
  const value = norm(text);
  if (!value || /[?¿]/.test(String(text))) return null;
  if (NO_MONEY_RE.some(re => re.test(value))) return "no_money";
  if (LATER_RE.some(re => re.test(value))) return "later";
  return null;
}

// Mensaje que solo agradece o confirma que no tiene dudas ("No, todo bien. Gracias").
// Si Mia acaba de ofrecer algo ("¿quieres…?", "podemos ayudarte…"), un "sí, gracias" es
// aceptar la oferta, no despedirse (caso real: Elisa, 14-oct).
const OFFER_RE = /\b(quieres|quiere|te gustaria|le gustaria|deseas|desea|podemos ayudarte|puedo ayudarte|puedo explicarte|te explico|prefieres)\b/;

// "Gracias x su valioso tiempo", "gracias por la atención" (caso real 20-oct) siguen siendo despedidas.
function stripThanksTail(value) {
  return value.replace(/\b(?:por|x)\s+(?:su|tu|la|el|toda la|todo el)?\s*(?:valioso\s+)?(?:tiempo|informacion|info|atencion|apoyo|ayuda|paciencia|amabilidad)\b/g, " ").replace(/\s+/g, " ").trim();
}

export function detectClosing(text, { lastReply = "" } = {}) {
  const value = stripThanksTail(norm(text));
  if (!value || asksSomething(text)) return false;
  if (/^(?:si|claro)\b/.test(value) && OFFER_RE.test(norm(lastReply))) return false;
  return THANKS_RE.test(value) && CLOSING_ONLY_RE.test(value);
}

const CLOSING_MARK = "escríbeme por aquí";

function firstName(memory = {}) {
  const raw = String(memory.primer_nombre || memory.nombre || "").trim().split(/\s+/)[0] || "";
  // Nombres mal capturados antes de la corrección ("Claro", "Deje", "Si") no se usan.
  if (!raw || raw.length < 2 || !plausibleName(raw)) return "";
  return `, ${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
}

function planLabel(memory = {}) {
  const plan = memory.sales_cycle?.selected_plan || memory.sales_cycle?.recommended_plan;
  return plan === "plan_2" ? "el Plan 2" : plan === "plan_1" ? "el Plan 1" : null;
}

// "No gracias" a una oferta (p. ej. al seguimiento "¿Te gustaría que iniciemos…?").
// "No me interesa Infonavit" no es esto: descarta solo una parte (feature-rejection.js).
const DECLINE_RE = /^(?:no|nop|nel)[ ,.!]*(?:muchas |mil )?gracias\b|^(?:muchas |mil )?gracias[ ,.!]*(?:pero )?no (?:me )?interesa\b|^no[ ,.!]*(?:me interesa(?! (?:el |la |lo de )?(?:infonavit|afore|credito|plan))|por ahora|por el momento|de momento)\b/;

const NOT_FIT_RE = /\bno (?:es|era) (?:lo que|el (?:servicio|plan) que) (?:busco|buscaba|necesito|necesitaba|quiero|queria|ocupo)\b|\bno (?:es|era) (?:para mi|lo mio)\b|\bno me (?:sirve|funciona)\b(?! (?:el|la) (?:plan|horario))/;
const NOT_FIT_MARK = "qué es lo que buscas";

// Mensajes de cortesía que no piden nada ("Ok", "Gracias", "👍", "No gracias, yo les aviso").
export function isCourtesy(text) {
  const raw = String(text || "").trim();
  if (!raw || /[?¿]/.test(raw)) return false;
  // "Ok gracias Mia!" — el nombre de Mia no cambia que sea cortesía.
  const value = norm(raw).replace(/[^a-z ]+/g, " ").replace(/\b(?:mia|martcom|senorita|seno?r)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return true; // solo emojis o signos
  return CLOSING_ONLY_RE.test(value) || DECLINE_RE.test(value) || Boolean(detectDeferral(raw))
    || /^(?:ok|okey|okay|va|sale|vale|listo|entendido|enterado|de acuerdo|perfecto|bien|muy bien|si|claro|igualmente|buen dia|bonito dia|que este bien)(?: gracias| muchas gracias| igualmente)?$/.test(value);
}

export function deferralDecision(memory = {}, combinedText = "", { resumedAfterHours = false } = {}) {
  // Cliente con trámite iniciado: "Muchas gracias" no es despedida de venta ("cuando quieras
  // continuar…" no aplica). Lo atiende el seguimiento del expediente.
  if (memory.sales_cycle?.authorized) return null;
  // Mia ya se despidió: a la cortesía ya no se contesta ni se programan seguimientos
  // (caso real: Silvia recibió dos despedidas más y otro "¿Te gustaría que iniciemos…?").
  const closedBefore = String(memory.ultima_respuesta_agente || "").includes(CLOSING_MARK);
  if (closedBefore && isCourtesy(combinedText)) {
    return { reply: "", question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", deferral: detectDeferral(combinedText) || "closing" };
  }
  if (!resumedAfterHours && Boolean(memory.ultima_respuesta_agente) && DECLINE_RE.test(norm(combinedText)) && !/[?¿]/.test(String(combinedText))) {
    const name = firstName(memory);
    return { reply: `Entendido${name}, gracias por tu tiempo. Si más adelante te interesa, ${CLOSING_MARK} y con gusto te ayudo.`, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", deferral: "declined" };
  }
  // "No es lo que busco. Gracias" (caso real 20-oct, quedó sin respuesta): una sola vez se pregunta
  // qué busca; si ya se le preguntó, se despide.
  if (!resumedAfterHours && Boolean(memory.ultima_respuesta_agente) && NOT_FIT_RE.test(norm(combinedText)) && !/[?¿]/.test(String(combinedText))) {
    const asked = String(memory.ultima_respuesta_agente || "").includes(NOT_FIT_MARK);
    const name = firstName(memory);
    return { reply: asked ? `Entendido${name}, gracias por tu tiempo. Si más adelante te interesa, ${CLOSING_MARK} y con gusto te ayudo.` : `Entiendo${name}, gracias por decirme. ¿Me cuentas qué es lo que buscas? Así reviso si te podemos ayudar de otra forma.`, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", deferral: asked ? "declined" : "not_fit" };
  }
  const kind = detectDeferral(combinedText);
  // Un "gracias" solo cierra la plática si Mia ya había contestado algo real (no al aviso
  // de horario ni al retomar un chat de la noche).
  const closing = !kind && !resumedAfterHours && Boolean(memory.ultima_respuesta_agente) && detectClosing(combinedText, { lastReply: memory.ultima_respuesta_agente });
  if (!kind && !closing) return null;
  const name = firstName(memory);
  const plan = planLabel(memory);
  const alreadyClosed = String(memory.ultima_respuesta_agente || "").includes(CLOSING_MARK);
  let reply;
  if (kind === "no_money") reply = `Entiendo${name}, no te preocupes. Cuando tengas la posibilidad, ${CLOSING_MARK} y con gusto retomamos tu trámite${plan ? ` con ${plan}` : ""}. Aquí estaré para ayudarte.`;
  else if (kind === "later") reply = alreadyClosed ? "" : `Claro${name}, sin problema. Cuando puedas, ${CLOSING_MARK} y con gusto continuamos con tu trámite. Aquí estaré para ayudarte.`;
  // Un "gracias" después de que Mia ya se despidió no necesita otra respuesta.
  else reply = alreadyClosed ? "" : `Con gusto${name}. Quedo al pendiente; cuando quieras continuar, ${CLOSING_MARK}.`;
  return {
    reply,
    question_key: null,
    add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    deferral: kind || "closing",
  };
}
