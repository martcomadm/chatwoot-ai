const clean = value => String(value || "").trim();
const lower = value => clean(value).toLowerCase();

const CURP_RE = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i;
const NSS_RE = /\b\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{5}\b/;

const NAME_STOP_WORDS = new Set([
  "hola","buen","buenas","tardes","dias","día","informacion","información",
  "imss","infonavit","afore","servicio","medico","médico","empleo","trabajo",
  "gracias","favor","quiero","quisiera","tengo","cuenta","cotizar","cotizacion",
  "cotización","seguro","afiliacion","afiliación","plan","ambos","coppel","coopel"
]);

function titleCaseName(value){
  return clean(value)
    .replace(/\s+/g," ")
    .split(" ")
    .map(part => part ? part[0].toLocaleUpperCase("es-MX") + part.slice(1).toLocaleLowerCase("es-MX") : part)
    .join(" ");
}

function possibleStandaloneName(text, memory){
  const value=clean(text).replace(/[.,;:!?]+$/g,"");
  if(!value || value.length<5 || value.length>90 || /\d/.test(value)) return null;
  const words=value.split(/\s+/).filter(Boolean);
  if(words.length<2 || words.length>7) return null;
  if(words.some(w => NAME_STOP_WORDS.has(w.toLowerCase()))) return null;
  if(words.some(w => !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+$/.test(w))) return null;
  const askedForName=memory?.ultima_pregunta==="nombre" || memory?.flujo?.siguiente_paso==="nombre";
  const looksLikeFullName=words.length>=3;
  return askedForName || looksLikeFullName ? titleCaseName(value) : null;
}

function extractName(text,memory){
  const value=clean(text);
  const explicit=value.match(/(?:mi nombre (?:completo )?es|me llamo|soy)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{5,90})/i)?.[1];
  if(explicit){
    const candidate=explicit.split(/[,.!?\n]/)[0].trim();
    const words=candidate.split(/\s+/);
    if(words.length>=2 && words.length<=7) return titleCaseName(candidate);
  }
  const lines=value.split(/\n+/).map(line=>line.trim()).filter(Boolean);
  for(let i=lines.length-1;i>=0;i--){
    const candidate=possibleStandaloneName(lines[i],memory);
    if(candidate) return candidate;
  }
  return possibleStandaloneName(value,memory);
}

export function extractFast(text,memory={}){
  const raw=clean(text), l=lower(raw);
  const patch={
    nombre:null,primer_nombre:null,edad:null,actividad:null,tipo_trabajo:null,
    tiene_imss:null,ultima_cotizacion:null,necesidad_principal:null,necesidades:[],
    afore_actual:null,pregunta_cambio_afore:false,curp_recibida:false,nss_recibido:false,
    documentos_recibidos:[],contradicciones:[],intereses:{},contexto_laboral:{}
  };

  const name=extractName(raw,memory);
  if(name){patch.nombre=name;patch.primer_nombre=name.split(/\s+/)[0];}

  const age=raw.match(/\b(?:tengo\s+)?(1[89]|[2-7]\d|8[0-5])\s*a(?:ñ|n)os?\b/i)?.[1];
  if(age) patch.edad=Number(age);

  if(/\b(no tengo|no cuento con|no estoy afiliad[oa]|sin)\b.{0,20}\b(imss|seguro)\b/i.test(raw)) patch.tiene_imss=false;
  if(/\b(si tengo|sí tengo|cuento con|estoy afiliad[oa]|tengo)\b.{0,20}\b(imss|seguro)\b/i.test(raw) && !/no tengo|no cuento|no estoy|sin seguro/i.test(raw)) patch.tiene_imss=true;
  if(/\b(contaba|ten[ií]a)\b.{0,20}\b(imss|seguro)\b/i.test(raw)){
    patch.tiene_imss=false;
    patch.contexto_laboral.cotizo_anteriormente=true;
  }

  if(/\b(desemplead[oa]|sin empleo|no trabajo)\b/i.test(raw)){
    patch.actividad="desempleado";patch.tipo_trabajo="desempleado";patch.contexto_laboral.empleado=false;
  }else if(/\b(tengo (?:un )?empleo|soy emplead[oa]|trabajo para|trabajo en)\b/i.test(raw)){
    patch.actividad="empleado";patch.tipo_trabajo="empleado";patch.contexto_laboral.empleado=true;
  }else if(/\b(trabajo por mi cuenta|independiente|comerciante|negocio propio|autoemplead[oa])\b/i.test(raw)){
    patch.actividad="independiente";patch.tipo_trabajo="independiente";patch.contexto_laboral.empleado=false;
  }

  if(/no (?:me|nos) (?:dan|ponen|han puesto|dieron).{0,25}(imss|seguro)|empleo.{0,40}sin (imss|seguro)/i.test(raw)){
    patch.tiene_imss=false;
    patch.contexto_laboral.empleador_no_afilia=true;
    patch.contexto_laboral.empleado=true;
    if(!patch.actividad) patch.actividad="empleado";
  }

  if(/servicio m[eé]dico|atenci[oó]n m[eé]dica|consultas? m[eé]dicas?/i.test(raw)){
    patch.intereses.servicio_medico=true;patch.necesidades.push("servicio_medico");
  }
  if(/infonavit|puntos? (?:de )?infonavit|cr[eé]dito (?:de )?vivienda/i.test(raw)){
    patch.intereses.infonavit=true;patch.necesidades.push("infonavit");
  }
  if(/\bafor[eé]\b|aportaciones?\s+(?:a\s+)?(?:mi\s+)?afor[eé]|aportes?\s+(?:a\s+)?(?:mi\s+)?afor[eé]/i.test(raw)){
    patch.intereses.afore=true;patch.necesidades.push("afore");
  }
  if(/\baltas?\b|darme de alta|dado de alta|afiliarme|afiliaci[oó]n/i.test(raw)){
    patch.intereses.imss=true;patch.necesidades.push("imss");
  }
  if(/constantes?|continuidad|sin cambios cada semana|sin bajas?|aportaciones? continuas?/i.test(raw)){
    patch.contexto_laboral.busca_continuidad=true;
  }
  if(/semanas? cotizadas?|seguir cotizando|cotizar semanas/i.test(raw)){
    patch.intereses.semanas_cotizadas=true;patch.necesidades.push("semanas_cotizadas");
  }
  if(/\bambos\b/i.test(raw)){
    if(memory?.intereses?.servicio_medico || memory?.necesidad_principal==="servicio_medico") patch.intereses.servicio_medico=true;
    if(memory?.intereses?.infonavit) patch.intereses.infonavit=true;
  }

  const afore=raw.match(/(?:afor[eé].{0,20}(?:en|es)|la tengo en|estoy en)\s+(coppel|coopel|banamex|citibanamex|azteca|profuturo|sura|xxi banorte|inbursa)/i)?.[1];
  if(afore) patch.afore_actual=afore.toLowerCase()==="coopel"?"Coppel":titleCaseName(afore);
  if(/cambiar.{0,20}afor[eé]|afor[eé].{0,20}cambiar/i.test(raw)) patch.pregunta_cambio_afore=true;

  if(CURP_RE.test(raw)) patch.curp_recibida=true;
  if(NSS_RE.test(raw)) patch.nss_recibido=true;

  if(patch.intereses.infonavit || patch.intereses.afore) patch.necesidad_principal="plan_2";
  else if(patch.intereses.servicio_medico) patch.necesidad_principal="servicio_medico";
  else if(patch.intereses.imss) patch.necesidad_principal="afiliacion_imss";

  patch.necesidades=[...new Set(patch.necesidades)];
  return patch;
}

export function containsCurp(text){return CURP_RE.test(clean(text));}
export function containsNss(text){return NSS_RE.test(clean(text));}
