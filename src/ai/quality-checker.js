const banned=[
  "tengo anotado","tengo registrado","confirmo que","ya registré","ya registre",
  "queda registrado","veo que","perfecto, tengo","para comenzar el diagnóstico"
];

function normalize(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9áéíóúüñ¿? ]/gi," ").replace(/\s+/g," ").trim();
}


function escapeRegExp(value){
  return String(value||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}

function endsWithAdvisorSignature(text, advisor){
  const name=String(advisor||"").trim();
  if(!name) return false;
  const escaped=escapeRegExp(name);
  const pattern=new RegExp(`(?:^|\\n)\\s*(?:atentamente[,.:;-]?\\s*|saludos[,.:;-]?\\s*|[-–—]\\s*)?${escaped}\\s*[.!]?$`,"i");
  return pattern.test(String(text||"").trim());
}

function similarity(a,b){
  const aa=new Set(normalize(a).split(" ").filter(word=>word.length>2));
  const bb=new Set(normalize(b).split(" ").filter(word=>word.length>2));
  if(!aa.size||!bb.size) return 0;
  let common=0;for(const word of aa) if(bb.has(word)) common++;
  return common/Math.max(aa.size,bb.size);
}

export function checkReply(reply,{memory,questionKey,maxChars=850,customerText=""}){
  const text=String(reply||"").trim();
  const reasons=[];
  if(!text) reasons.push("respuesta_vacia");
  if(text.length>maxChars) reasons.push("respuesta_larga");
  const l=text.toLowerCase();
  for(const phrase of banned) if(l.includes(phrase)) reasons.push(`frase_prohibida:${phrase}`);
  const questionMarks=(text.match(/\?/g)||[]).length;
  if(questionMarks>1) reasons.push("multiples_preguntas");

  // Una pregunta pendiente puede reformularse. Solo se bloquea si la respuesta es
  // prácticamente igual a la última enviada, no por compartir la misma question_key.
  if(memory?.ultima_respuesta_agente && similarity(text,memory.ultima_respuesta_agente)>=0.82){
    reasons.push("respuesta_demasiado_similar_a_la_anterior");
  }

  if(questionKey==="nombre"&&memory.nombre) reasons.push("nombre_ya_conocido");
  if(questionKey==="edad"&&memory.edad) reasons.push("edad_ya_conocida");
  if(questionKey==="actividad"&&memory.actividad) reasons.push("actividad_ya_conocida");
  if(questionKey==="tiene_imss"&&memory.tiene_imss!==null&&memory.tiene_imss!==undefined) reasons.push("imss_ya_conocido");
  if(questionKey==="curp"&&memory.curp_recibida) reasons.push("curp_ya_recibida");
  if(questionKey==="nss"&&memory.nss_recibido) reasons.push("nss_ya_recibido");
  if(["curp","nss"].includes(questionKey)){
    const state=memory?.slots?.[`${questionKey}_estado`];
    if(["promised_later","searching","unavailable","declined","ask_later","refused"].includes(state) || memory?.data_collection?.sensitive_requests_suppressed) reasons.push(`dato_sensible_suprimido:${questionKey}`);
  }

  if(questionKey && (memory?.resolved_questions||[]).includes(questionKey)) reasons.push(`pregunta_resuelta:${questionKey}`);
  // La misma pregunta ya se hizo 2 veces (caso real 20-oct: "¿estás dado de alta en el IMSS?" 5 veces
  // a un cliente que no entendía): se deja de preguntar y se avanza.
  const repeatedKey=questionKey||(asksImssStatus(text)?"tiene_imss":null);
  // Solo si la pregunta anterior también fue esa: la IA etiqueta a veces mal question_key y se tiraban
  // respuestas buenas ("¿a qué te dedicas?", caso real 21-oct).
  if(repeatedKey && memory?.ultima_pregunta===repeatedKey && Number(memory?.asked_counts?.[repeatedKey]||0)>=2) reasons.push(`pregunta_repetida_muchas_veces:${repeatedKey}`);
  // Antes de autorizar no se mencionan plazos de pago ni bajas, ni se inventan "cotizaciones",
  // direcciones u otro nombre de asesor (casos reales del 13 y 14 de octubre).
  if(!memory?.sales_cycle?.authorized && /(antes de las 6|d[eé] de baja|darse de baja|dar de baja el proceso)/i.test(text)) reasons.push("politica_pago_prematura");
  // "Semanas de cotización" es normal; lo prohibido es ofrecer "preparar una cotización" (precios fijos).
  if(/\b(?:una|la|tu|su|esta|nueva|personalizada)\s+cotizaci[oó]n\b|\bcotizaci[oó]n\s+(?:personalizada|formal|a tu medida)\b|\b(?:prepar|envi|mand|hac|elabor)\w*\s+(?:una\s+|la\s+|tu\s+)?cotizaci[oó]n\b/i.test(text) && !/\bsemanas? de cotizaci[oó]n\b/i.test(text)) reasons.push("cotizacion_inventada");
  if(/\bxochimilco\b|\bcolonia\b|\balcald[ií]a\b/i.test(text)) reasons.push("ubicacion_inventada");
  // "Parece que ese mensaje no era para nosotros" solo cabe ante cadenas o avisos largos;
  // a "No lo conozco" (respuesta a una pregunta de Mia) se le contestó eso (caso real 15-oct).
  if(/no era para nosotros/i.test(text)&&String(customerText||"").trim().length<120) reasons.push("fuera_de_tema_indebido");
  // La IA inventaba un paso de "escribe exactamente: He leído y acepto…" y ofrecía las cuentas
  // antes del alta (caso real 19-oct, el cliente acabó molesto).
  if(/he le[ií]do y acepto|responde exactamente|escribe exactamente/i.test(text)) reasons.push("pide_frase_terminos");
  // Caso real 21-oct: "inicio tu trámite… el área de validación (validacion@martcom.com.mx) te pedirá CURP, NSS e INE"
  // sin que el sistema abriera el expediente. En la venta no se dan correos ni se da por iniciado el trámite.
  if(/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) reasons.push("menciona_correo");
  // Formas de pago: solo transferencia, depósito u OXXO (confirmado 26-oct); antes la IA ofrecía efectivo.
  if(/(?:,|\bo\b|\by\b)\s+(?:en\s+)?efectivo\b/i.test(text) && !/\bno\b.{0,25}\befectivo\b/i.test(text)) reasons.push("ofrece_pago_efectivo");
  // Solo afirmaciones ("Inicio tu trámite", "Ya registré tu caso"), no preguntas ni ofertas
  // ("¿Quieres que inicie el trámite?", caso real 21-oct: se tiraban respuestas buenas).
  if(!memory?.sales_cycle?.authorized && String(text).split(/(?<=[.!?¿])\s+/).some(sentence=>!/[?¿]/.test(sentence) && !/\b(?:que|si|cuando|para|puedo|podemos|quieres|deseas|gustas)[\s,]+(?:[\w,]+\s+){0,2}(?:inicio|registro|abro|doy)\b/i.test(sentence) && /(?:^|[\s,;:])(?:inicio|inici[ée]|registro|registr[ée]|abr[ií]|abro|di de alta|doy de alta)\s+(?:tu|el|su)\s+(?:tr[aá]mite|caso|expediente|alta)\b|\bya (?:qued[oó]|est[aá]) (?:iniciado|registrado) tu (?:tr[aá]mite|caso)\b/i.test(sentence) && !/\binicie\b/i.test(sentence.match(/inici\S*/i)?.[0]||""))) reasons.push("da_por_iniciado_sin_autorizacion");
  // Este número no recibe llamadas, pero un asesor sí la regresa (casos reales 20-oct).
  if(/\bno (?:realizamos|ofrecemos|damos|manejamos|hacemos|tenemos)\s+(?:atenci[oó]n\s+(?:por|telef[oó]nica)|llamadas|atenci[oó]n por tel[eé]fono)/i.test(text)) reasons.push("niega_llamadas");
  if(!memory?.sales_cycle?.authorized && /(?:comparta|comparto|env[ií]e|env[ií]o|mande|mando|indique|indico|pase|paso)\s+(?:los\s+)?datos\s+(?:para|de)(?:l)?\s+(?:el\s+)?(?:pago|dep[oó]sito)|datos (?:bancarios|para (?:el )?pago|de pago)|cuentas? para (?:pagar|depositar)/i.test(text)) reasons.push("pago_antes_de_vigencia");
  if(/\bsoy\s+axel\b|\baxel\s+(?:de|ia)\b/i.test(text)) reasons.push("identidad_incorrecta");
  return {ok:reasons.length===0,reasons};
}

export function asksImssStatus(text=""){
  const t=String(text||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  return /\?/.test(t)&&/\b(?:dado de alta|alta activa|imss (?:activo|vigente)|sigues cotizando|ya no (?:estas )?cotiza\w*|tienes imss|cuentas con imss|estas cotizando)\b/.test(t);
}
