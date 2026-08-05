const banned=[
  "tengo anotado","tengo registrado","confirmo que","ya registré","ya registre",
  "queda registrado","veo que","perfecto, tengo","para comenzar el diagnóstico"
];

function normalize(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9áéíóúüñ¿? ]/gi," ").replace(/\s+/g," ").trim();
}

function similarity(a,b){
  const aa=new Set(normalize(a).split(" ").filter(word=>word.length>2));
  const bb=new Set(normalize(b).split(" ").filter(word=>word.length>2));
  if(!aa.size||!bb.size) return 0;
  let common=0;for(const word of aa) if(bb.has(word)) common++;
  return common/Math.max(aa.size,bb.size);
}

export function checkReply(reply,{memory,questionKey,maxChars=850}){
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
  return {ok:reasons.length===0,reasons};
}
