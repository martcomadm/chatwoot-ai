// Respuesta a la apertura del anuncio "revisar mi caso" / "seguir sumando para pensión"
// (pregunta: "¿hace cuánto dejaste de cotizar y en qué año empezaste a cotizar?").
//
// Export 2 al 4-nov: de 42 chats que llegaron por esos anuncios no se cerró ninguna venta.
// El cliente contaba su caso ("empecé en el 85, hace 10 años dejé de cotizar") y Mia
// contestaba un texto genérico que ignoraba lo que dijo, luego "¿te explico cómo funciona?",
// luego la explicación y hasta el tercer mensaje "¿iniciamos?". Muchos se iban en el camino.
// Ahora: se le contesta con su caso (Ley 73 o Ley 97), el plan, precio y proceso, y se cierra.

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n").replace(/\s+/g, " ").trim();
}

const ASKED_RE = /en que ano (?:empezaste|comenzaste) a cotizar/;
const REPROMPT_MARK = "en que ano comenzaste a cotizar";
export function askedCaseQuestion(memory = {}) {
  return ASKED_RE.test(norm(memory?.ultima_respuesta_agente || ""));
}

function fullYear(two, nowYear) {
  const n = Number(two);
  if (n >= 100) return n;
  const candidate = 2000 + n;
  return candidate <= nowYear ? candidate : 1900 + n;
}

// Datos del caso en lo que escribió el cliente. Solo lo que dice explícitamente.
export function parseCaseData(text = "", { now = new Date(), askedStartYear = false } = {}) {
  const v = norm(text);
  const nowYear = now.getFullYear();
  const START = "(?:empec\\w*|empez\\w*|empes\\w*|enpes\\w*|enpez\\w*|enpec\\w*|comenc\\w*|comenz\\w*|inici\\w*|me dieron de alta|me dio de alta|me afiliaron|entre a trabajar|cotice|cotize|trabaje)";
  const YEAR = "(?:19[4-9]\\d|20[0-2]\\d|'?[4-9]\\d|0\\d|1\\d|2[0-6])";
  let startYear = null;
  // "empecé a cotizar en 1985", "me dieron de alta en el 90", "empecé a cotizar en el como 85", "comencé el 1 de septiembre del 88".
  const startMatch = v.match(new RegExp(`${START}[^.]{0,45}?\\b(?:en|el|del|de|desde|como|por|año|ano|al)\\s+(?:el\\s+|como\\s+|en\\s+el\\s+|ano\\s+|año\\s+)?(?:\\d{1,2}\\s+de\\s+[a-z]+\\s+(?:de|del)\\s+)?(${YEAR})\\b(?!\\s*(?:anos|años|semanas|meses|dias))`));
  if (startMatch) startYear = fullYear(startMatch[1].replace("'", ""), nowYear);
  // "empecé a cotizar hace 36 años", "desde hace 36 años".
  const startAgo = v.match(new RegExp(`${START}[^.]{0,30}?\\b(?:desde\\s+)?hace\\s+(?:como\\s+|unos\\s+|mas de\\s+)?(\\d{1,2})\\s+anos`));
  if (!startYear && startAgo) startYear = nowYear - Number(startAgo[1]);
  // Respuesta corta a la pregunta del año: "1988", "Como en el 82".
  if (!startYear && askedStartYear) {
    const bare = v.match(/^(?:(?:si|hola|buenos dias|buenas tardes|buenas noches|bueno)[ ,.]+)*(?:en\s+(?:el\s+)?|como\s+(?:en\s+(?:el\s+)?)?|el\s+|del\s+)?(19[4-9]\d|20[0-2]\d|[4-9]\d)[ .!]*$/);
    if (bare) startYear = fullYear(bare[1], nowYear);
  }
  // "A partir del 2011 inicié al 2020", "empecé a cotizar en 1974 hasta 1998" (casos reales 10-nov: se tomó 2020
  // como el año en que empezó): con un rango, el primero es cuando empezó y el segundo cuando dejó de cotizar.
  const range = v.match(/\b(19[4-9]\d|20[0-2]\d)\b[^.\d]{0,28}\b(?:a|al|hasta|asta)\s+(?:el\s+)?(19[4-9]\d|20[0-2]\d)\b/);
  let rangeEnd = null;
  if (range && Number(range[1]) < Number(range[2]) && (startYear || new RegExp(START).test(v) || askedStartYear)) { startYear = Number(range[1]); rangeEnd = Number(range[2]); }
  if (startYear && (startYear < 1940 || startYear > nowYear)) startYear = null;

  let stoppedYearsAgo = null;
  const stopAgo = v.match(/\b(?:deje|dejamos|deje de|termine|sali)\b[^.]{0,25}?\bhace\s+(?:como\s+|unos\s+|mas de\s+|mas se\s+)?(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(anos|ano|meses|mes|semanas|semana)\b/)
    || v.match(/\bhace\s+(?:como\s+|unos\s+|mas de\s+|mas se\s+)?(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(anos|ano|meses|mes|semanas|semana)\b[^.]{0,20}\b(?:que\s+)?deje\b/)
    || v.match(/\b(?:mas (?:de|se)\s+)?(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(anos|ano|meses|mes)\s+(?:sin cotizar|que deje|de que deje)\b/);
  const WORDS = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  if (stopAgo) {
    const n = WORDS[stopAgo[1]] ?? Number(stopAgo[1]);
    stoppedYearsAgo = /mes|semana/.test(stopAgo[2]) ? 0 : n;
  }
  const stopYear = v.match(/\bdeje de (?:cotizar|trabajar)(?:(?!\b(?:empe|enpe|comen|inici))[^.]){0,30}?\b(?:en|el|del|de|desde)\s+(?:el\s+|ano\s+)?(?:\d{1,2}\s+de\s+[a-z]+\s+(?:de|del)\s+)?(19[4-9]\d|20[0-2]\d|[4-9]\d|0\d|1\d|2[0-6])\b(?!\s*(?:anos|semanas|meses))/);
  if (stoppedYearsAgo === null && rangeEnd && rangeEnd <= nowYear) stoppedYearsAgo = nowYear - rangeEnd;
  if (stoppedYearsAgo === null && stopYear) stoppedYearsAgo = Math.max(0, nowYear - fullYear(stopYear[1], nowYear));

  const stillContributing = /\b(?:sigo|aun estoy|todavia estoy|actualmente (?:sigo |estoy )?|estoy)\s+cotizando\b|\b(?:actualmente|aun|todavia) cotizo\b/.test(v);
  const neverContributed = /\bnunca (?:he |e )?(?:cotizado|cotice|cotize|tuve cotizacion|tube cotizacion)\b/.test(v);
  const doesNotRemember = /\b(?:no (?:me )?(?:acuerdo|recuerdo)|no se (?:bien|exactamente|cuando)|ya no se)\b/.test(v);
  const ley73Stated = /\bley\s*73\b/.test(v);
  const ley97Stated = /\bley\s*97\b/.test(v);
  const ley = ley73Stated ? 73 : ley97Stated ? 97 : startYear ? (startYear <= 1996 ? 73 : startYear >= 1998 ? 97 : null) : null;
  return { startYear, stoppedYearsAgo, stillContributing, neverContributed, doesNotRemember, ley };
}

const GREETING_ONLY_RE = /^(?:(?:hola+|buen(?:os)? dias?|buenas(?: tardes| noches)?|que tal|saludos|si+|ok|claro|por favor|porfavor|una disculpa|disculpa|disculpe|perdon|gracias|me puede atender|me pueden atender|si por favor|si porfavor|mia|mía)[ ,.!¿?]*)+$/;

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

export function caseDiagnosisDecision(memory = {}, text = "", { now = new Date() } = {}) {
  if (memory?.sales_cycle?.authorized || !askedCaseQuestion(memory)) return null;
  const raw = String(text || "").trim();
  if (!raw) return null;
  const v = norm(raw);
  // Solo saludó o dijo "sí" (casos reales: "Hola", "Buenos días, una disculpa…", "Si por favor"): se repite la
  // pregunta de forma breve, en vez de que la IA pregunte otra cosa ("¿tienes IMSS?", "¿tu nombre?").
  const alreadyReprompted = norm(memory?.ultima_respuesta_agente || "").includes(REPROMPT_MARK);
  if (!alreadyReprompted && (GREETING_ONLY_RE.test(v) || /^(?:buenos dias|hola|buenas tardes)?[ ,.]*(?:una )?disculpa[^?]{0,60}$/.test(v))) {
    return {
      reply: "¡Con gusto! Para revisar tu caso, ¿recuerdas más o menos en qué año comenzaste a cotizar y hace cuánto dejaste de hacerlo? Con eso te digo qué opción te conviene.",
      question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", case_diagnosis: "reprompt",
    };
  }
  if (/[?¿]/.test(raw)) return null;
  // ISSSTE, portabilidad o Modalidad 40 los revisa un asesor (regla 27-oct): no se diagnostica aquí.
  if (/\b(?:issste|portabilidad|modalidad\s*(?:40|10)|negativa de pension|ya (?:estoy )?pensionad[oa]|jubilad[oa])\b/.test(v)) return null;
  const data = parseCaseData(raw, { now, askedStartYear: true });
  // Sigue cotizando con su trabajo: lo atiende la respuesta "mientras trabajes, tu patrón te da el IMSS".
  if (data.stillContributing && data.stoppedYearsAgo === null) return null;
  const hasData = data.startYear || data.ley || data.stoppedYearsAgo !== null || data.neverContributed || data.doesNotRemember;
  if (!hasData) return null;

  const plan2 = /\b(?:afore|infonavit)\b/.test(v) || memory?.commercial_need?.afore_infonavit === true;
  const parts = ["Gracias por contarme."];
  if (data.ley === 73) {
    parts.push(`${data.startYear ? `Como empezaste a cotizar en ${data.startYear}, antes del 1 de julio de 1997` : "Como empezaste a cotizar antes del 1 de julio de 1997"}, tu caso es Ley 73: tus semanas siguen registradas en el IMSS y, para reactivar tus derechos y tramitar tu pensión, necesitas al menos 13 meses de afiliación.`);
  } else if (data.ley === 97) {
    parts.push(`${data.startYear ? `Como empezaste a cotizar en ${data.startYear}, después del 1 de julio de 1997` : "Como empezaste a cotizar después del 1 de julio de 1997"}, tu caso es Ley 97: tu pensión depende de las semanas que acumules, así que lo importante es seguir sumando.`);
  } else if (data.neverContributed) {
    parts.push("No hay problema: desde que quedas dado de alta empiezas a sumar semanas.");
  } else if (data.stoppedYearsAgo) {
    parts.push(`Aunque dejaste de cotizar hace ${plural(data.stoppedYearsAgo, "año", "años")}, puedes retomar tu cotización y seguir sumando semanas.`);
  } else if (data.doesNotRemember) {
    parts.push("No te preocupes, no necesitas el dato exacto para empezar.");
  } else {
    parts.push("Puedes retomar tu cotización y seguir sumando semanas.");
  }
  parts.push(plan2
    ? "Con el Plan 2 te damos de alta ante el IMSS con un salario diario registrado de $480 MXN: sigues sumando semanas, tienes servicio médico y además aportas a tu AFORE e INFONAVIT. Cuesta $1,500 MXN mensuales."
    : "Con el Plan 1 te damos de alta ante el IMSS con un salario diario registrado de $480 MXN: sigues sumando semanas y además tienes servicio médico. Cuesta $1,100 MXN mensuales.");
  parts.push("Todo se hace por este medio; con tus documentos completos el alta queda en unas 48 horas hábiles y el primer pago se hace hasta que tu alta ya está vigente. ¿Quieres que iniciemos tu trámite?");
  return {
    reply: parts.join(" "),
    question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    case_diagnosis: data.ley ? `ley_${data.ley}` : "general",
    plan: plan2 ? "plan_2" : "plan_1",
    case_data: data,
  };
}
