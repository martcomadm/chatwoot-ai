import { planIntentFlow } from "../intent/flows.js";

const present=v=>v!==null&&v!==undefined&&v!=="";
const resolved=(memory,key)=>(memory.resolved_questions||[]).includes(key);

export function analyzeSales(memory){
  const interests=memory.intereses||{};
  const plan=(interests.infonavit||interests.afore||memory.necesidad_principal==="plan_2")?"plan_2":
    (interests.servicio_medico||interests.imss||["servicio_medico","afiliacion_imss"].includes(memory.necesidad_principal))?"plan_1":null;
  const score=[memory.nombre,memory.edad,memory.actividad,memory.tiene_imss!==null,plan].filter(Boolean).length;
  const temperature=memory.curp_recibida||memory.nss_recibido?"muy_caliente":score>=4?"caliente":score>=2?"templado":"frio";
  let problem=null;
  if(memory.contexto_laboral?.empleador_no_afilia) problem="empleador_no_afilia";
  else if(memory.tipo_trabajo==="desempleado"||memory.actividad==="desempleado") problem="sin_empleo";
  else if(memory.tiene_imss===false) problem="sin_imss";
  return {plan_recomendado:plan,temperatura:temperature,problema:problem};
}

export function planNext(memory){
  const intentPlan = planIntentFlow(memory);
  if (intentPlan && !(intentPlan.question_key && resolved(memory,intentPlan.question_key))) return intentPlan;

  const pendingConflicts=(memory.contradicciones||[]).filter((item)=>{
    if(typeof item!=="object"||!item?.id) return false;
    return !(memory.conflictos_resueltos||[]).includes(item.id);
  });
  if(pendingConflicts.length && !resolved(memory,"aclarar_contradiccion")) return {action:"aclarar_contradiccion",question_key:"aclarar_contradiccion",rephrase:false};

  if(!present(memory.necesidad_principal) && !Object.values(memory.intereses||{}).some(Boolean) && !resolved(memory,"necesidad_principal")) return {action:"preguntar_necesidad",question_key:"necesidad_principal",rephrase:false};
  if((memory.tiene_imss===null || memory.tiene_imss===undefined) && !resolved(memory,"tiene_imss")) return {action:"preguntar_imss",question_key:"tiene_imss",rephrase:false};
  if(!present(memory.nombre) && !resolved(memory,"nombre")) return {action:"preguntar_nombre",question_key:"nombre",rephrase:false};
  if(!present(memory.edad) && !resolved(memory,"edad")) return {action:"preguntar_edad",question_key:"edad",rephrase:false};
  if(!present(memory.actividad) && !resolved(memory,"actividad")) return {action:"preguntar_actividad",question_key:"actividad",rephrase:false};

  if(!memory.curp_recibida && !resolved(memory,"curp")) {
    if(memory.slots?.nss_disponible===false && memory.slots?.curp_disponible===true) return {action:"solicitar_curp",question_key:"curp",rephrase:false};
    return {action:"solicitar_curp",question_key:"curp",rephrase:false};
  }
  if(!memory.nss_recibido && !resolved(memory,"nss") && memory.slots?.nss_disponible!==false) return {action:"solicitar_nss",question_key:"nss",rephrase:false};
  return {action:"transferir",question_key:null};
}

export function answered(memory,key){
  if((memory.resolved_questions||[]).includes(key)) return true;
  const map={
    nombre:memory.nombre,edad:memory.edad,actividad:memory.actividad,
    tiene_imss:memory.tiene_imss,ultima_cotizacion:memory.ultima_cotizacion,
    necesidad_principal:memory.necesidad_principal,curp:memory.curp_recibida,nss:memory.nss_recibido,
    afiliado_imss_al_fallecer:memory.caso_fallecimiento?.afiliado_imss_al_fallecer,
    afore_contactada:memory.caso_fallecimiento?.afore_contactada,
    motivo_negativa:memory.caso_fallecimiento?.motivo_negativa,
    beneficiarios_fallecimiento:(memory.caso_fallecimiento?.beneficiarios||[]).length?true:null
  };
  if(!(key in map)) return false;
  return map[key]!==null&&map[key]!==undefined&&map[key]!=="";
}
