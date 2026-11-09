// Ficha del cliente (pedido 9-nov, punto 1 de "Mia más inteligente").
// Se actualiza con cada mensaje del cliente, sin IA, para que Mia no vuelva a preguntar lo que ya le dijeron
// (caso real: "soy régimen 73, tengo 320 semanas" y después "eso depende de tu caso"), cierre con su
// situación ("como me dijiste que tienes citas pendientes…") y Captura la vea al intervenir.
// También guarda las señales de compra que usa el puntaje (sales/lead-score.js).

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,;:!¡]+/g, " ").replace(/\s+/g, " ").trim();
}

const RELATIVES = [
  [/\b(?:mi|para mi|a mi)\s+(?:esposa|mujer|senora|pareja|novia)\b/, "su pareja"],
  [/\b(?:mi|para mi|a mi)\s+(?:esposo|marido|senor|novio)\b/, "su pareja"],
  [/\b(?:mi|mis|para mi|para mis|a mi|a mis)\s+(?:mama|madre|papa|padre|papas|padres|jefa|jefe)\b/, "sus papás"],
  [/\b(?:mi|mis|para mi|para mis)\s+(?:hijo|hija|hijos|hijas|bebe|nino|nina)\b/, "sus hijos"],
  [/\b(?:mi|para mi)\s+(?:hermano|hermana)\b/, "un hermano"],
  [/\b(?:mi|para mi)\s+(?:familia)\b/, "su familia"],
];

const OBJECTIONS = [
  [/\b(?:caro|cara|costoso|muy alto|no me alcanza|mas barato|descuento|me ofrecieron .{0,30}(?:barato|menos|\d{2,4}))\b/, "precio"],
  [/\b(?:fraude|estafa|desconfi\w*|enganan|no confio|es real|es verdad|es seguro|que seguridad|que garantia)\b/, "confianza"],
  [/\b(?:no tengo (?:dinero|lana|trabajo|ingresos)|lo economico|organizar mis gastos|cuando me paguen|hasta la quincena)\b/, "dinero"],
  [/\b(?:lo (?:pienso|voy a pensar|platico|consulto|comento|checo)|dejeme pensar|dejame pensar|lo hablo con)\b/, "lo quiere pensar"],
];

const INTERESTS = [
  [/\b(?:servicio medico|atencion medica|doctor|medicinas|consultas|hospital|clinica|cirugia|enferm\w*|embaraz\w*|parto)\b/, "servicio médico"],
  [/\b(?:pension\w*|jubil\w*|semanas)\b/, "pensión y semanas"],
  [/\bafore\b/, "AFORE"],
  [/\binfonavit\b/, "INFONAVIT"],
];

// Señales de compra para el puntaje.
const SIGNALS = {
  asked_payment: /\b(?:como (?:se )?pag\w*|donde (?:se )?pag\w*|forma de pago|metodos? de pago|cuenta para (?:pagar|depositar)|a que cuenta|deposito|transferencia)\b/,
  asked_start: /\b(?:como (?:le hago|inicio|empiezo|me afilio|me inscribo|me doy de alta)|que (?:necesito|ocupo|documentos|papeles|requisitos)|como los contacto|para afiliarme)\b/,
  urgency: /\b(?:urge|urgente|me urge|lo antes posible|cuanto antes|hoy mismo|antes del? (?:este |el )?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|fin de semana)|citas? pendientes?|tengo cita)\b/,
  interest: /\b(?:si me interesa|me interesa mucho|me interesa|me gusta la idea|si quiero|quiero (?:iniciar|afiliarme|contratar|darme de alta))\b/,
};

export function updateProfile(profile = {}, text = "", { now = new Date(), attachments = 0, curp = false } = {}) {
  const v = norm(text);
  const next = { ...(profile || {}) };
  const signals = { ...(next.signals || {}) };
  if (v) {
    const weeks = v.match(/\b(?:tengo|tiene|cuento con|llevo|me reconocen|me aparecen|son)\s+(?:como\s+|unas\s+|mas de\s+|casi\s+|alrededor de\s+|aproximadamente\s+)?(\d{2,4})\s+semanas\b/);
    if (weeks && Number(weeks[1]) >= 20 && Number(weeks[1]) <= 2600) next.weeks = Number(weeks[1]);
    const ley = v.match(/\b(?:ley|regimen)\s*(73|97)\b/);
    if (ley) next.ley = Number(ley[1]);
    const year = v.match(/\b(?:empece|empec[eé]|comence|inicie|cotice|cotizo|desde(?: el)?|en el|en)\s+(?:a\s+cotizar\s+)?(?:en\s+)?(?:el\s+)?(?:ano\s+)?(19[4-9]\d|20[0-2]\d)\b/);
    if (year) { next.start_year = Number(year[1]); if (!next.ley) next.ley = next.start_year <= 1996 ? 73 : next.start_year >= 1998 ? 97 : next.ley; }
    const age = v.match(/\b(?:tengo|cumplo|cumpli|edad(?: de)?)\s+(\d{2})\s+(?:anos|ano)\b(?!\s+(?:sin|cotizando|trabajando|de cotizar|que))/);
    if (age && Number(age[1]) >= 18 && Number(age[1]) <= 95) next.age = Number(age[1]);
    if (/\b(?:no (?:tengo|estoy|cuento con) (?:trabajo|empleo)|desemplead\w*|me (?:corrieron|despidieron|liquidaron)|sin trabajo|estoy en casa|ama de casa)\b/.test(v)) next.work = "sin empleo formal";
    else if (/\b(?:independiente|por mi cuenta|negocio propio|tengo un negocio|comerciante|freelance|honorarios)\b/.test(v)) next.work = "independiente";
    else if (/\b(?:pensionad[oa]|jubilad[oa])\b/.test(v)) next.work = "pensionado";
    for (const [re, who] of RELATIVES) if (re.test(v)) { next.for_whom = who; break; }
    const interests = new Set(next.interests || []);
    for (const [re, label] of INTERESTS) if (re.test(v)) interests.add(label);
    if (interests.size) next.interests = [...interests];
    for (const [re, label] of OBJECTIONS) if (re.test(v)) { next.objection = label; break; }
    const urgent = v.match(SIGNALS.urgency);
    if (urgent) next.urgency = String(text).replace(/\s+/g, " ").trim().slice(0, 120);
    for (const [key, re] of Object.entries(SIGNALS)) if (re.test(v)) signals[key] = now.toISOString();
  }
  if (attachments > 0) signals.sent_files = now.toISOString();
  if (curp) signals.sent_curp = now.toISOString();
  next.signals = signals;
  next.updated_at = now.toISOString();
  return next;
}

// Para Operations (Chats de Mia) y el Inspector.
export function profileFacts(profile = {}) {
  const p = profile || {};
  const out = [];
  if (p.for_whom) out.push(["Para quién", p.for_whom]);
  if (p.age) out.push(["Edad", `${p.age} años`]);
  if (p.work) out.push(["Trabajo", p.work]);
  if (p.weeks) out.push(["Semanas", String(p.weeks)]);
  if (p.ley) out.push(["Ley", `Ley ${p.ley}${p.start_year ? ` (cotiza desde ${p.start_year})` : ""}`]);
  if (p.interests?.length) out.push(["Le interesa", p.interests.join(", ")]);
  if (p.objection) out.push(["Objeción", p.objection]);
  if (p.urgency) out.push(["Prisa", `"${p.urgency}"`]);
  return out;
}

// Una frase con lo que el cliente contó, para el cierre ("Como me dijiste que…"). null si no hay nada útil.
export function personalTouch(profile = {}) {
  const p = profile || {};
  if (p.urgency) return "Como me comentaste que tienes prisa, si me mandas hoy tus documentos lo iniciamos de inmediato.";
  if (p.weeks && p.ley === 73) return p.weeks >= 500
    ? `Con tus ${p.weeks} semanas en Ley 73 ya tienes las 500 mínimas; con el alta reactivas tus derechos para tramitar tu pensión.`
    : `Con tus ${p.weeks} semanas en Ley 73, cada mes con nosotros te acerca a las 500 que necesitas para pensionarte.`;
  if (p.weeks && p.ley === 97) return p.weeks >= 800
    ? `Con tus ${p.weeks} semanas ya tienes las 800 mínimas de la Ley 97; mientras llegas a la edad sigues sumando y con servicio médico.`
    : `Con tus ${p.weeks} semanas en Ley 97, cada mes con nosotros te acerca a las 800 que necesitas para pensionarte.`;
  if (p.for_whom === "sus papás") return "Así tus papás pueden quedar como beneficiarios, sujeto a la validación del IMSS.";
  if (p.for_whom === "su pareja") return "Así tu pareja también puede quedar como beneficiaria, sujeto a la validación del IMSS.";
  if (p.work === "sin empleo formal") return "Así no te quedas sin servicio médico ni dejas de sumar semanas mientras no tienes empleo formal.";
  return null;
}
