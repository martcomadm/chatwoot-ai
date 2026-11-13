import { confirmsStart } from "./start-confirmation.js";
import { SCHEDULE_OFFER_MARK } from "./scheduled-start.js";
import { plausibleName } from "../semantic/name-validator.js";
// Cuando el cliente pospone ("ahorita no tengo dinero", "yo le aviso") o cierra la
// plática ("no, todo bien, gracias"), Mia debe despedirse con amabilidad y dejar de
// insistir: no volver a ofrecer el plan, no pedir más datos y no programar seguimientos.

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// "cuanto" aparece seguido como error de dedo de "cuento" ("no cuánto con dinero").
const NO_MONEY_RE = [
  // "Tengo algunos gastos que cubrir en esta quincena… tengo que revisar mi presupuesto" (13-nov, #11692).
  /\btengo\s+(?:algunos|unos|varios|muchos)\s+gastos\b|\b(?:revisar|checar|acomodar|ajustar|organizar)\s+(?:mi|mis|el)\s+(?:presupuesto|gastos|finanzas)\b/,
  /\bno (?:cuento|cuanto|tengo|traigo|dispongo)(?: ahorita| ahora| por ahora)?(?: con)? (?:el |la |los )?(?:dinero|recurso|recursos|lana|varo|fondos|presupuesto|para pagar|para pagarlo|forma de pagar|forma de pago|como pagar)\b/,
  /\bno tengo (?:ahorita |ahora |por el momento )?(?:la |una )?(?:forma|manera|modo) de pagar\b/,
  /\b(?:ahorita|por el momento|por ahora|de momento|en este momento)\b.{0,40}\bno (?:puedo pagar|tengo (?:dinero|para)|cuento con|cuanto con|me alcanza)\b/,
  /\bestoy (?:corta|corto|sin dinero|sin lana)\b/,
  // "Dame oportunidad de organizar mis gastos", "no tengo ingresos" (casos reales 3 y 5-nov).
  // "Déjeme que lo hable con mi hijo porque él me va a apoyar con lo económico", "checo lo económico" (6-nov).
  /\blo economico\b|\b(?:me|nos) (?:va|van) a apoyar con (?:el pago|los pagos|el dinero)\b/,
  /\b(?:organizar|acomodar|ajustar|ordenar|nivelar)(?:me)?\s+(?:con\s+)?(?:mis|los|mi)\s+(?:gastos?|finanzas|cuentas|pagos|quincena)\b|\bno (?:tengo|cuento con) (?:ingresos|trabajo ni dinero|entradas)\b/,
  // "No conseguí el dinero para depositarlo" (caso real 19-oct, con faltas).
  /\bno\s*(?:consegui|consigi|consigui|junte|pude juntar|pude conseguir|alcance)\b.{0,25}\b(?:dinero|lana|pago|deposit\w*|pagar)\b/,
];

const LATER_RE = [
  // 10-nov: "Si pero por el momento no lo haré", "esperemos al lunes", "te envío mis datos el fin de semana",
  // "se los envío el jueves o más tardar el viernes" (recibieron el plan otra vez o una pregunta genérica).
  /\bpor (?:el|este) momento no\b|\bpor ahora no\b|\bde momento no\b/,
  // "Si hoy le mando mensaje" (10-nov: la IA contestó "sí, puedes mandar el mensaje hoy" y repitió el plan).
  /\b(?:hoy|manana|al rato|mas tarde|en la tarde|en la noche|luego|despues)\s+(?:le|les|te)\s+(?:mando|envio|escribo|marco)\b/,
  /\besper(?:emos|amos|o|are|ame|eme)\s+(?:al?|hasta|para)\s+(?:el\s+|la\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|proxim\w+|otra semana|quincena|fin de mes|manana)\b/,
  /\b(?:te|se|le|les)\s+(?:los\s+|las\s+|lo\s+)?(?:envio|mando|paso)\b.{0,40}\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|fin de semana|manana|mas tarde|al rato|en la tarde|en la noche|quincena)\b/,
  // "Estoy de viaje… cuando regrese por favor", "le resuelvo luego" (casos reales 7 y 9-nov).
  /\b(?:estoy|ando|voy)\s+de\s+viaje\b|\bcuando\s+(?:regrese|vuelva|llegue a casa|este de regreso)\b|\b(?:le|te|les)\s+resuelvo\s+(?:luego|despues|mas tarde|en un rato)\b/,
  /\b(?:yo )?(?:le|les|los|las|te) (?:aviso|abiso|escribo|contacto|marco|busco|confirmo)\b/,
  /\bcuando (?:yo )?(?:pueda|tenga|junte|me paguen|cobre|lo tenga|tenga el dinero)\b/,
  /\b(?:mas adelante|despues (?:le|les|te) (?:escribo|aviso)|luego (?:le|les|te) (?:escribo|aviso)|otro dia)\b/,
  /\blo (?:voy a pensar|pienso|consulto|platico|reviso|checo|analizo)\b/,
  /\b(?:dej[ae]me|deja|deje|dejeme)\s+(?:lo\s+)?(?:platico|platicar|consulto|consultar|comento|comentar|hablo|hablar)\b|\b(?:lo\s+)?(?:platico|consulto|comento|hablo)\s+con\s+(?:mi|mis)\s+(?:esposo|esposa|pareja|familia|hijos?|hijas?|marido|senora|mama|papa)\b/,
  /\b(?:yo\s+)?(?:me|nos)\s+(?:comunicaria|comunicariamos|comunico|comunicamos|pongo en contacto|reporto)\s+con\s+(?:ustedes|usted|contigo|ella|el)\b|\b(?:aun|todavia)\s+no\s+(?:he|eh|e|hemos)\s+(?:hablado|platicado|consultado|decidido)\b/,
  // Casos reales 17-oct: "lo estoy considerando", "te mando mañana", "para el siguiente mes",
  // "lunes o martes", "voy de salida… le mando mensaje", "sería ahora que renuncie".
  /\b(?:lo|la)\s+estoy\s+(?:considerando|pensando|analizando|viendo|revisando)\b|\b(?:estoy|estamos)\s+(?:platicando|viendo|consultando|hablando)(?:lo)?\s+con\s+(?:mi|mis)\b/,
  /\b(?:te|le|les)\s+(?:lo\s+|los\s+|las\s+)?(?:mando|envio|paso|comparto)\s+(?:manana|el lunes|el martes|en la semana|mas tarde|al rato|despues)\b|\bmanana\s+(?:te|le|les)\s+(?:mando|envio|paso|escribo)\b/,
  /\b(?:para|hasta|a partir de)\s+(?:el\s+)?(?:siguiente|proximo|otro)\s+mes\b|\b(?:el\s+)?(?:1|primero)\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b(?!\s+(?:de|del)\s+\d{2,4})|\b(?:la\s+)?(?:proxima|siguiente|otra)\s+semana\b|\b(?:lunes|martes|miercoles|jueves|viernes|sabado)\s+o\s+(?:lunes|martes|miercoles|jueves|viernes|sabado)\b/,
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
  /\b(?:podemos|puedo|quiero)\s+(?:iniciar|empezar|comenzar)\b.{0,25}\b(?:el lunes|el martes|el miercoles|el jueves|el viernes|el sabado|el domingo|manana|la otra semana|la proxima semana|despues|luego|mas tarde)\b|\b(?:llegando|cuando llegue|al llegar)\b.{0,25}\b(?:los|las|lo|la)\s+(?:busco|mando|envio|paso|checo)\b|\b(?:te|se|le)\s+(?:lo|la|los|las)\s+(?:mando|envio|paso)\s+(?:en un rato|al rato|mas tarde|manana|en (?:una|dos|tres|unas) horas?)\b|\ben (?:una|dos|tres|unas|un par de) horas?\b.{0,20}\b(?:te|se|le)\s+(?:lo|la|los|las)\s+(?:mando|envio|paso)\b/,
  // "Estoy checando los documentos y le reporto", "deje y checo papeles" (caso real 6-nov: recibió el plan otra vez).
  /\b(?:estoy|ando|estamos)\s+(?:checando|buscando|juntando|revisando|reuniendo|sacando)\s+(?:los\s+|mis\s+|las\s+)?(?:documentos|papeles|datos|requisitos)\b|\b(?:checo|busco|junto|reviso|saco)\s+(?:los\s+|mis\s+)?(?:papeles|documentos)\b/,
  // "En otro momento, gracias" (caso real 27-oct: quedó sin respuesta).
  /\ben otro momento\b/,
  /\bestoy en espera de\b|\btodavia no (?:lo )?(?:decido|se|tengo)\b|\bno gracias,? (?:despues|luego|mas adelante)\b/,
  // Casos reales 23 al 26-oct: "Mari estoy viendo opciones", "Estoy revisando la opción", "Ok déjeme, checar
  // mañana lo decido", "les voy a llamar… el próximo mes", "al próximo mes me contacto", "Dame una hora y mando todo".
  /\b(?:estoy|estamos|ando)\s+(?:viendo|revisando|checando|comparando|analizando)\s+(?:las\s+|la\s+|otras\s+)?(?:opciones|opcion|precios|alternativas|informacion)\b/,
  /\bmanana\s+(?:lo\s+|le\s+|te\s+)?(?:decido|confirmo|concreto|digo|aviso|resuelvo)\b|\b(?:le|te)\s+(?:puedo\s+)?confirm\w*\s+(?:el\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana)\b/,
  /\b(?:les|le|te)\s+voy\s+a\s+(?:llamar|marcar|escribir|hablar|contactar)\b|\b(?:al|el)\s+(?:proximo|siguiente)\s+mes\b/,
  /^(?:ok\s+)?(?:dame|deme|denme|dejame|dejeme)\s+(?:una|un|unas|dos|tres|unos)\s+(?:hora|horas|rato|ratito|minutos|dias)\b/,
  // "Haré todo lo posible por mandar documentos mañana", "te los mando en un par de horas" (casos reales 28-oct y 1-nov:
  // la IA quería pedir la CURP y la revisión la cambiaba por una pregunta genérica).
  // Un "Sí, solo que… le envío papeles mañana" acepta iniciar (caso 21-oct): ese no cuenta aquí.
  /^(?!(?:si|claro|va|sale|ok si)\b).*\b(?:mandar|enviar|pasar|mando|envio|paso)\w*\s+(?:los\s+|mis\s+|tus\s+|sus\s+)?(?:documentos|papeles|datos)\b.{0,25}\b(?:manana|al rato|mas tarde|luego|despues|en la tarde|en la noche|el lunes|el martes|el miercoles|el jueves|el viernes|el sabado|el domingo)\b/,
  /\b(?:te|se|le|t)\s+(?:lo|la|los|las)\s+(?:mando|envio|paso)\s+en\s+(?:un\s+par\s+de\s+horas|un\s+rato|unas\s+horas)\b/,
];

// "Ahorita no estoy trabajando", "Por el momento no cuento con IMSS": responden una pregunta, no posponen.
const ANSWERS_STATE_RE = /^(?:por el momento|de momento|por ahora|ahorita|en este momento|por lo pronto)\s+no\s+(?:estoy|tengo|cuento|trabajo|cotizo|soy|me dan)\b/;

const THANKS_RE = /\b(?:gracias|grasias|graciaz|todo bien|igualmente|saludos|bendiciones|lindo dia|bonito dia|feliz dia|para ti tambien|para usted tambien|que amable|agradezco|agradecid[oa]|muy amable)\b/;
const CLOSING_ONLY_RE = /^(?:(?:a|ah|ahh|oh|ok|okay|okey|si|no|ninguna|ninguno|nada|vale|va|bueno|muy bien|todo bien|esta bien|perfecto|listo|de acuerdo|entendido|gracias|grasias|graciaz|muchas gracias|mil gracias|muchisimas gracias|que amable|igualmente|saludos|bendiciones|excelente|por la informacion|por todo|y|bien|buenas noches|buenas tardes|buen dia|buenos dias|bonito dia|feliz dia|que descanse|te agradezco|le agradezco|agradezco|se lo agradezco|te lo agradezco|lo agradezco|les agradezco|pendientes|pendiente|buena tarde|buen dia a usted|muchisimo|mucho|muy amable|muy valiosa (?:tu|su) informacion|muy valiosa|lindo dia|para ti|para usted|tambien|igual)[ ,.!]*)+$/;

function asksSomething(text) {
  return /[?¿]/.test(String(text || "")) || /\b(?:cuanto|cuando abren|que documentos|cuales|como le hago|donde)\b/.test(norm(text)) && !/\bcuando (?:yo )?(?:pueda|tenga)\b/.test(norm(text));
}

// "no_money" | "later" | null
export function detectDeferral(text) {
  const value = norm(text).replace(/[,;:!]+/g, " ").replace(/\.{2,}/g, " ").replace(/\s+/g, " ").trim();
  if (!value || /[?¿❓]/.test(String(text))) return null;
  // "Cómo los contacto / Para afiliarme con ustedes" (caso real 6-nov) pregunta, no pospone.
  if (/^(?:pero\s+|y\s+|oiga\s+)?(?:como|donde|a donde|en donde|cual|en que tiempo|por que|que pasa)\b/.test(value) || /^(?:pero\s+|y\s+)?cuando\b(?!\s+(?:yo\s+)?(?:pueda|tenga|junte|me paguen|cobre|lo tenga|regrese|llegue|salga|termine))/.test(value)) return null;
  // "Que costos tienen para platicarlo con mi pareja" (caso real 21-oct): primero el precio.
  // "Creo que está bien el precio, lo comento con mis clientes y me vuelvo a comunicar" (caso real 28-oct) sí pospone.
  const priceOk = /\b(?:esta bien|me parece bien|es buen|es bueno|esta accesible)\s+(?:el\s+)?precio\b|\bel precio (?:esta|me parece) bien\b/.test(value);
  if (/\b(?:cuanto|costos?|precios?|cuesta|cobran|mensualidad)\b/.test(value) && !priceOk && !NO_MONEY_RE.some(re => re.test(value))) return null;
  if (NO_MONEY_RE.some(re => re.test(value))) return "no_money";
  if (ANSWERS_STATE_RE.test(value)) return null;
  // "Ahorita no me puedo pensionar, es una pregunta" (caso real 8-nov) no pospone.
  if (/\b(?:es una pregunta|es una prejunta|es pregunta|solo pregunto|nada mas pregunto|solo es pregunta|era una pregunta)\b/.test(value)) return null;
  // "Soy ley 73, en qué año no me acuerdo, necesito checar mis papeles" (caso real 27-oct) responde la pregunta.
  if (/\b(?:no me acuerdo|no recuerdo)\b/.test(value)) return null;
  if (LATER_RE.some(re => re.test(value))) return "later";
  // "Ok checo las recomendaciones" (12-nov, #11617): lo va a revisar por su cuenta.
  if (/\b(?:checo|chequo|reviso|veo|leo)\s+(?:las\s+|sus\s+)?(?:recomendaciones|resenas|opiniones|comentarios|pagina|facebook)\b/.test(value)) return "later";
  // 12-nov: "yo ya luego me contacto con usted", "no lo tengo ahorita, estoy en el trabajo", "me comunico más tarde".
  if (/\b(?:luego|despues|mas tarde|al rato|en la tarde|manana)\s+(?:me|nos|le|les)\s+(?:contacto|comunico|marco|escribo|reporto)\b|\b(?:me|nos)\s+(?:contacto|comunico)\s+(?:mas tarde|luego|despues|al rato|manana)\b|\bno\s+(?:lo|los|la|las)\s+tengo\s+(?:ahorita|orita|aqui|a la mano|en este momento)\b|\b(?:estoy|ando)\s+(?:en el|en mi)\s+(?:trabajo|chamba)\b|\bestoy\s+(?:entrando|por entrar)\s+(?:a|q|al)\s+trabaj\w*\b/.test(value)) return "later";
  // "Gracias / Pero ahorita no / Estoy en proceso de pensión" (caso real 10-nov: recibió los planes otra vez).
  if (String(text).split(/\n+/).some(line => /^(?:(?:pero|pues|gracias|no|ok|mmm|ay)\s+)*(?:ahorita|orita|por ahorita|por ahora|ahora)\s+no(?:\s+gracias)?$/.test(norm(line).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim()))) return "later";
  return null;
}

// Mensaje que solo agradece o confirma que no tiene dudas ("No, todo bien. Gracias").
// Si Mia acaba de ofrecer algo ("¿quieres…?", "podemos ayudarte…"), un "sí, gracias" es
// aceptar la oferta, no despedirse (caso real: Elisa, 14-oct).
const OFFER_RE = /\b(quieres|quiere|te gustaria|le gustaria|deseas|desea|podemos ayudarte|puedo ayudarte|puedo explicarte|te explico|prefieres)\b/;

// "Gracias x su valioso tiempo", "gracias por la atención" (caso real 20-oct) siguen siendo despedidas.
function stripThanksTail(value) {
  // "Muchas gracias por tu apoyo, Jehová Dios les bendiga y los proteja en todo momento" (8-nov: recibió
  // "¿Tienes alguna duda sobre el Plan 1…?").
  value = value.replace(/\b(?:que\s+)?(?:jehova\s+|mi\s+|el\s+)?(?:dios|diosito|el senor)\s+(?:te|le|les|los|lo|la|las|nos|me)\s+(?:bendiga|proteja|cuide|acompane|guarde|ayude|de)\b.*$/, " ").replace(/\s+/g, " ").trim();
  return value.replace(/\b(?:por|x)\s+(?:su|tu|la|el|toda la|todo el)?\s*(?:valioso\s+)?(?:tiempo|informacion|info|atencion|apoyo|ayuda|paciencia|amabilidad)\b/g, " ").replace(/\s+/g, " ").trim();
}

export function detectClosing(text, { lastReply = "" } = {}) {
  const value = stripThanksTail(norm(text).replace(/[^\p{L}\p{N}\s,.!]/gu, " ").replace(/\s+/g, " ").trim());
  if (!value || asksSomething(text)) return false;
  if (/^(?:si|claro)\b/.test(value) && OFFER_RE.test(norm(lastReply))) return false;
  // "Agradezco la atención, estaremos en contacto por este medio", "Le agradezco mucho la información, que pase
  // un buen día y estamos en contacto" (casos reales 10 y 11-nov: recibieron otra pregunta de venta).
  const full = norm(text);
  if (full.length <= 160 && !/\b(?:quiero|me interesa|iniciar|iniciemos|empezar|afiliarme|mando|envio)\b/.test(full)
    && (/\b(?:estamos|estaremos|seguimos|seguiremos|quedamos|nos mantenemos|nos ponemos) en contacto\b/.test(full)
      || (/\b(?:agradezco|gracias)\b/.test(full) && /\bque (?:pase|pasen|tenga|tengan|tengas)\b.{0,20}\b(?:dia|tarde|noche)\b/.test(full)))) return true;
  return THANKS_RE.test(value) && CLOSING_ONLY_RE.test(value);
}

const CLOSING_MARK = "escríbeme por aquí";
function alreadyClosedText(last = "") { return String(last || "").includes(CLOSING_MARK); }

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

// "Disculpe no haré trámite", "No necesito ya el servicio", "No quiero continuar con el trámite" (24-oct).
const DECLINE_ANY_RE = /\bsi no(?: es posible| se puede| esta bien)?,? (?:ni modo,? )?(?:muchas )?gracias\b|\bno (?:hare|voy a hacer|realizare|voy a realizar) (?:el |ningun )?tramite\b|\b(?:no|ya no) (?:necesitare|necesito|ocupo|requiero|quiero) (?:ya )?(?:el |del |tu |su )?servicio\b|\bno (?:quiero|deseo|voy a) (?:continuar|seguir) con el tramite\b|^(?:ya|ya lo|ya la)\s+(?:encontre|consegui|tengo otra opcion|contrate)\b/;
// "No, me equivoqué, perdón" (caso real 24-oct): escribió por error.
const MISTAKE_RE = /^(?:no[ ,.!]*)?(?:me equivoque|me equivoque de (?:chat|numero|contacto)|fue un error|era para otra persona|no era para ustedes|disculpe? me equivoque|perdon me equivoque)\b/;
const NOT_FIT_RE = /\bno (?:es|era) (?:lo que|el (?:servicio|plan) que) (?:busco|buscaba|necesito|necesitaba|quiero|queria|ocupo)\b|\bno (?:es|era) (?:para mi|lo mio)\b|\bno me (?:sirve|funciona)\b(?! (?:el|la) (?:plan|horario))/;
const NOT_FIT_MARK = "qué es lo que buscas";
const START_LATER_MARK = "envíamelos por aquí y arrancamos tu trámite";

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

export function deferralDecision(memory = {}, combinedText = "", { resumedAfterHours = false, teamOff = null } = {}) {
  // "Ok muy bien… puedo mandarte la documentación mañana" a "¿Quieres que iniciemos?" (12-nov, #11649) es aceptar:
  // lo atiende el flujo de compromiso, que abre el expediente.
  if (!memory.sales_cycle?.authorized && confirmsStart(combinedText, memory)) return null;
  // "Deme un momento y le marco" (13-nov, #11708): quiere llamar; lo contesta la respuesta de contacto.
  if (/\b(?:le|les|te)\s+(?:marco|llamo)\b/.test(norm(combinedText))) return null;
  // "No me interesa el servicio médico" (13-nov, #11637) no es despedida: el plan también es para sus semanas
  // (lo contesta medicalNotNeededDecision).
  if (/\bno (?:me interesa|necesito|quiero|ocupo|busco)\b.{0,25}\b(?:el |lo del )?(?:seguro medico|servicio medico|atencion medica)\b/.test(norm(combinedText))) return null;
  // Cliente con trámite iniciado: "Muchas gracias" no es despedida de venta ("cuando quieras
  // continuar…" no aplica). Lo atiende el seguimiento del expediente.
  if (memory.sales_cycle?.authorized) return null;
  // Mia ya se despidió: a la cortesía ya no se contesta ni se programan seguimientos
  // (caso real: Silvia recibió dos despedidas más y otro "¿Te gustaría que iniciemos…?").
  const lastReply = String(memory.ultima_respuesta_agente || "");
  // También cuando la despedida la escribió la IA ("Que tengas buen día", "escríbeme y con gusto te apoyo";
  // caso real 24-oct: a un "Ok" final volvió a ofrecer el Plan 1).
  const closedBefore = lastReply.includes(CLOSING_MARK) || (!/[?¿]/.test(lastReply) && /que tengas (?:un )?(?:buen|excelente|bonito|lindo) d[ií]a|que te vaya (?:muy )?bien|escr[ií]beme y con gusto|quedo al pendiente|cuando quieras retomar/i.test(lastReply));
  if (closedBefore && isCourtesy(combinedText)) {
    return { reply: "", question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", deferral: detectDeferral(combinedText) || "closing" };
  }
  // Ya consiguió trabajo (12-nov: "Ya empecé a laborar…", "Disculpe ya me dieron de alta"): su patrón le da el IMSS.
  // Se despide con gusto y no se le insiste más.
  if (gotJob(combinedText)) {
    const name = firstName(memory);
    return { reply: `¡Qué gusto${name}, felicidades por tu trabajo! Mientras tu patrón te tenga dado de alta ya cuentas con IMSS. Si más adelante lo vuelves a necesitar, ${CLOSING_MARK} y con gusto te ayudo.`, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", deferral: "not_fit" };
  }
  // "No de momento, ando en la calle, pero en dos horas te lo mando" (caso real 22-oct) no es rechazo.
  if (MISTAKE_RE.test(norm(combinedText).replace(/[,.!]+/g, " ").replace(/\s+/g, " ").replace(/\b(?:perdon|disculpa|disculpe|una disculpa)\b/g, " ").trim()) && !/[?¿]/.test(String(combinedText))) {
    return { reply: "No te preocupes. Si en algún momento necesitas información sobre tu afiliación al IMSS, aquí estoy para ayudarte.", question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", deferral: "mistake" };
  }
  const declines = (DECLINE_RE.test(norm(combinedText)) || DECLINE_ANY_RE.test(norm(combinedText))) && !/\b(?:pero|te lo|te los|se lo|se los|le mando|te mando|te envio|al rato|en un rato|horas|manana|luego)\b/.test(norm(combinedText));
  if (!resumedAfterHours && Boolean(memory.ultima_respuesta_agente) && declines && !/[?¿]/.test(String(combinedText))) {
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
  // "Por el momento no" a "¿ya tienes IMSS activo?" responde la pregunta (caso real 24-oct: se despidió).
  const shortNo = /^(?:por el momento|de momento|por ahora|ahorita|en este momento|por lo pronto)\s+no[ .!]*$/.test(norm(combinedText));
  if (shortNo && /\b(?:imss|seguro social)\b.{0,40}\?|cuentas con imss|tienes imss|imss activo|alta activa/i.test(norm(lastReply))) return null;
  let kind = detectDeferral(combinedText);
  // "Por el momento no" a "¿Te quedó alguna duda?" = no tiene dudas: despedida corta, no otra vez "cuando puedas…".
  if (shortNo && /alguna duda/.test(norm(lastReply))) kind = null;
  if (shortNo && /alguna duda/.test(norm(lastReply))) return { reply: alreadyClosedText(lastReply) ? "" : `Con gusto${firstName(memory)}. Quedo al pendiente; cuando quieras continuar, ${CLOSING_MARK}.`, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", deferral: "closing" };
  // Un "gracias" solo cierra la plática si Mia ya había contestado algo real (no al aviso
  // de horario ni al retomar un chat de la noche).
  const closing = !kind && !resumedAfterHours && Boolean(memory.ultima_respuesta_agente) && detectClosing(combinedText, { lastReply: memory.ultima_respuesta_agente });
  if (!kind && !closing) return null;
  const name = firstName(memory);
  const plan = planLabel(memory);
  const alreadyClosed = String(memory.ultima_respuesta_agente || "").includes(CLOSING_MARK);
  let reply;
  // Quiere iniciar pero después ("Podemos iniciar el trámite el lunes, voy a buscar mis papeles",
  // "mañana le envío papeles"; casos reales 21 y 22-oct): se le dice qué tener listo.
  const startLater = kind === "later" && /\bno\s+(?:lo|los|la|las)\s+tengo\b|\b(?:papeles|documentos|documentacion|curp|nss|ine|iniciar|empezar|tramite)\b|\b(?:te|se|le|les)\s+(?:los\s+|las\s+|lo\s+)?(?:envio|mando|paso)\b|\b(?:mando|envio|paso|ma do)\s+(?:todo|mis datos|los datos)\b|\b(?:te|t|se|le)\s+(?:los|las)\s+(?:mando|envio|paso)\b/.test(norm(combinedText));
  if (startLater) reply = String(memory.ultima_respuesta_agente || "").includes(START_LATER_MARK) ? "" : `Perfecto${name}. Cuando tengas a la mano tu CURP, NSS e INE, ${START_LATER_MARK}${plan ? ` con ${plan}` : ""}.`;
  // Sin dinero por ahora (5-nov: la objeción más común, y siempre terminaba en despedida): una vez se le dice que
  // hoy no paga nada y se le ofrece programar el alta para cuando tenga el pago.
  else if (kind === "no_money" && plan && !memory.sales_cycle?.schedule_offered && !lastReply.includes(SCHEDULE_OFFER_MARK)) reply = `Entiendo${name}, no te preocupes. Para iniciar hoy no pagas nada: el primer pago se hace hasta que tu alta ya aparece vigente. Si te ayuda, dejamos tu trámite listo y programamos tu alta para cuando tengas el pago (por ejemplo, tu próxima quincena). ${SCHEDULE_OFFER_MARK}`;
  else if (kind === "no_money") reply = `Entiendo${name}, no te preocupes. Cuando tengas la posibilidad, ${CLOSING_MARK} y con gusto retomamos tu trámite${plan ? ` con ${plan}` : ""}. Aquí estaré para ayudarte.`;
  // Día sin equipo (9-nov, punto 5): una vez se le ofrece dejar su lugar apartado para el siguiente día hábil.
  else if (kind === "later" && !alreadyClosed && teamOff && plan && !memory.sales_cycle?.weekend_offer) reply = `Claro${name}, sin problema. Por si te sirve: hoy es ${teamOff.today} y el equipo arranca ${teamOff.next} a primera hora. Si me mandas hoy tu CURP, te aparto un lugar para que tu trámite sea de los primeros, y no pagas nada hasta que compruebes tu alta en el IMSS. Si prefieres pensarlo con calma, ${CLOSING_MARK} cuando quieras.`;
  // "Déjeme pensar bien qué plan me conviene y ya le aviso" (8-nov): se le ayuda a decidir.
  else if (kind === "later" && !alreadyClosed && /\b(?:que|cual)\s+plan\b/.test(norm(combinedText))) reply = `Claro${name}, tómate tu tiempo. Por si te ayuda a decidir: si lo que más te importa es el servicio médico y seguir sumando semanas, el Plan 1 ($1,100 MXN mensuales) es suficiente; el Plan 2 ($1,500 MXN mensuales) conviene si además quieres aportaciones a tu AFORE. Cuando lo tengas, ${CLOSING_MARK} y lo iniciamos.`;
  else if (kind === "later") reply = alreadyClosed ? "" : `Claro${name}, sin problema. Cuando puedas, ${CLOSING_MARK} y con gusto continuamos con tu trámite. ${plan ? "Y recuerda que para iniciar no pagas nada: tu primer pago es hasta que compruebas en el IMSS que tu alta ya está vigente." : "Aquí estaré para ayudarte."}`;
  // Un "gracias" después de que Mia ya se despidió no necesita otra respuesta.
  else reply = alreadyClosed ? "" : `Con gusto${name}. Quedo al pendiente; cuando quieras continuar, ${CLOSING_MARK}.`;
  return {
    reply,
    question_key: null,
    add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    deferral: startLater ? "start_later" : kind || "closing",
    ...(reply.includes(SCHEDULE_OFFER_MARK) ? { schedule_offer: true } : {}),
    ...(teamOff && reply.includes("te aparto un lugar para que tu trámite sea de los primeros") ? { weekend_offer: true } : {}),
  };
}

// Respuesta de Mia que ya se despide ("Cuando quieras retomar…, que tengas buen día", "quedo al pendiente"): después
// de ella no se programan seguimientos (casos reales 27-oct: le siguieron escribiendo a quien dijo que no tenía dinero).
export function isClosingReply(reply = "") {
  const value = String(reply || "");
  if (!value.trim()) return false;
  if (value.includes(CLOSING_MARK)) return true;
  return !/[?¿]/.test(value) && /que tengas (?:un )?(?:buen|excelente|bonito|lindo) d[ií]a|que te vaya (?:muy )?bien|escr[ií]be(?:me|ame)? (?:por aqu[ií] )?y (?:con gusto|retomamos)|quedo al pendiente|cuando quieras retomar|cuando (?:puedas|pueda) (?:avisar|escr[ií]be)/i.test(value);
}

// "Ya empecé a laborar", "ya entré a trabajar", "ya conseguí trabajo", "ya me dieron de alta (en mi trabajo)".
// No cuenta "estoy por entrar a trabajar pero no sé si me van a dar de alta" (11-nov, #11620).
export function gotJob(text = "") {
  const v = norm(text).replace(/[.,;:!¡]+/g, " ").replace(/\s+/g, " ").trim();
  if (!v || /[?¿]/.test(String(text)) || /\b(?:no se si|todavia no|aun no|estoy por|voy a entrar|por entrar)\b/.test(v)) return false;
  return /\bya\s+(?:empece|entre|comence|inicie|estoy)\s+(?:a\s+)?(?:laborar|trabajar|trabajando|laborando)\b|\bya\s+(?:consegui|encontre|tengo)\s+(?:un\s+)?(?:trabajo|empleo|chamba)\b|\bya\s+me\s+(?:dieron|dio|dan)\s+de\s+alta\b(?!.{0,30}\b(?:ustedes|martcom|con ustedes)\b)|\bya\s+(?:me\s+)?(?:contrataron|aseguraron)\b/.test(v);
}
