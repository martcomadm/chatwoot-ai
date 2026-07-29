const present=v=>v!==null&&v!==undefined&&v!=="";

export function analyzeSales(memory){
  const interests=memory.intereses||{};
  const plan=(interests.infonavit||interests.afore||memory.necesidad_principal==="plan_2")?"plan_2":
    (interests.servicio_medico||interests.imss||["servicio_medico","afiliacion_imss"].includes(memory.necesidad_principal))?"plan_1":null;
  const score=[memory.nombre,memory.edad,memory.actividad,memory.tiene_imss!==null,plan].filter(Boolean).length;
  const temperature=memory.curp_recibida||memory.nss_recibido?"muy_caliente":score>=4?"caliente":score>=2?"templado":"frio";
  let problem=null;
  if(memory.contexto_laboral?.empleador_no_afilia) problem="empleador_no_afilia";
  else if(memory.actividad==="desempleado") problem="sin_empleo";
  else if(memory.tiene_imss===false) problem="sin_imss";
  return {plan_recomendado:plan,temperatura:temperature,problema:problem};
}

export function planNext(memory){
  if((memory.contradicciones||[]).length) return {action:"aclarar_contradiccion",question_key:"aclarar_contradiccion",rephrase:false};
  if(!present(memory.necesidad_principal) && !Object.values(memory.intereses||{}).some(Boolean)) return {action:"preguntar_necesidad",question_key:"necesidad_principal",rephrase:(memory.preguntas_realizadas||[]).includes("necesidad_principal")};
  if(memory.tiene_imss===null || memory.tiene_imss===undefined) return {action:"preguntar_imss",question_key:"tiene_imss",rephrase:(memory.preguntas_realizadas||[]).includes("tiene_imss")};
  if(!present(memory.nombre)) return {action:"preguntar_nombre",question_key:"nombre",rephrase:(memory.preguntas_realizadas||[]).includes("nombre")};
  if(!present(memory.edad)) return {action:"preguntar_edad",question_key:"edad",rephrase:(memory.preguntas_realizadas||[]).includes("edad")};
  if(!present(memory.actividad)) return {action:"preguntar_actividad",question_key:"actividad",rephrase:(memory.preguntas_realizadas||[]).includes("actividad")};
  if(!memory.curp_recibida) return {action:"solicitar_curp",question_key:"curp",rephrase:(memory.preguntas_realizadas||[]).includes("curp")};
  if(!memory.nss_recibido) return {action:"solicitar_nss",question_key:"nss",rephrase:(memory.preguntas_realizadas||[]).includes("nss")};
  return {action:"transferir",question_key:null};
}

export function answered(memory,key){
  const map={
    nombre:memory.nombre,edad:memory.edad,actividad:memory.actividad,
    tiene_imss:memory.tiene_imss,ultima_cotizacion:memory.ultima_cotizacion,
    necesidad_principal:memory.necesidad_principal,curp:memory.curp_recibida,nss:memory.nss_recibido
  };
  if(!(key in map)) return false;
  return map[key]!==null&&map[key]!==undefined&&map[key]!=="";
}
