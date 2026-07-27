const banned=[
  "tengo anotado","tengo registrado","confirmo que","ya registré","ya registre",
  "queda registrado","veo que","perfecto, tengo","para comenzar el diagnóstico"
];

export function checkReply(reply,{memory,questionKey,maxChars=850}){
  const text=String(reply||"").trim();
  const reasons=[];
  if(!text) reasons.push("respuesta_vacia");
  if(text.length>maxChars) reasons.push("respuesta_larga");
  const l=text.toLowerCase();
  for(const phrase of banned) if(l.includes(phrase)) reasons.push(`frase_prohibida:${phrase}`);
  const questionMarks=(text.match(/\?/g)||[]).length;
  if(questionMarks>1) reasons.push("multiples_preguntas");
  if(questionKey && (memory.preguntas_realizadas||[]).includes(questionKey)) reasons.push(`pregunta_repetida:${questionKey}`);
  if(questionKey==="nombre"&&memory.nombre) reasons.push("nombre_ya_conocido");
  if(questionKey==="edad"&&memory.edad) reasons.push("edad_ya_conocida");
  if(questionKey==="actividad"&&memory.actividad) reasons.push("actividad_ya_conocida");
  if(questionKey==="tiene_imss"&&memory.tiene_imss!==null&&memory.tiene_imss!==undefined) reasons.push("imss_ya_conocido");
  if(questionKey==="curp"&&memory.curp_recibida) reasons.push("curp_ya_recibida");
  if(questionKey==="nss"&&memory.nss_recibido) reasons.push("nss_ya_recibido");
  return {ok:reasons.length===0,reasons};
}
