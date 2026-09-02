const normalize=value=>String(value??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");

export const SALES_STAGES=["exploring","qualified","plan_recommended","explaining","objection_handling","interested","authorized","handoff"];

function explicitAuthorization(text){
  const v=normalize(text);
  return /\b(quiero (?:hacerlo|contratar|iniciar|proceder|comenzar)|quiero el plan|adelante (?:con|el)|iniciemos|hagamos el tramite|procede|procedamos|si quiero hacerlo|me interesa contratar|quiero afiliarme ya)\b/.test(v);
}
function thinking(text){return /\b(lo voy a pensar|dejame pensarlo|lo pienso|despues te digo|mas tarde|aun no|todavia no)\b/.test(normalize(text));}
function rejection(text){return /\b(no me interesa|no quiero el servicio|ya no quiero continuar|no gracias ya no)\b/.test(normalize(text));}
function objection(text){return /\b(caro|costoso|precio|costo|cuanto|confianza|seguro que|no estoy seguro|duda|por que)\b/.test(normalize(text));}

export function recommendPlan(memory={}){
  const interests=memory.intereses||{};
  const needs=new Set(memory.necesidades||[]);
  if(interests.infonavit||interests.afore||needs.has("infonavit")||needs.has("afore")||memory.necesidad_principal==="plan_2"){
    return {id:"plan_2",name:"Plan 2",reason:"El cliente busca, además de afiliación/continuidad, componentes relacionados con AFORE o INFONAVIT."};
  }
  if(interests.servicio_medico||interests.semanas_cotizadas||interests.imss||needs.has("servicio_medico")||needs.has("semanas_cotizadas")||memory.necesidad_principal){
    return {id:"plan_base",name:"Plan base",reason:"El cliente busca servicio médico, semanas cotizadas, beneficiarios o afiliación voluntaria al IMSS."};
  }
  return null;
}

export function analyzeAutonomousSale(text,memory={}){
  const previous=memory.sales_cycle||{};
  const plan=recommendPlan(memory);
  let stage=previous.stage||"exploring";
  let authorized=Boolean(previous.authorized);
  let event=null;

  if(rejection(text)){
    stage="exploring";event="sales_rejected";
  }else if(thinking(text)){
    stage=stage==="authorized"?"interested":stage;event="sales_thinking";
  }else if(explicitAuthorization(text)){
    stage="authorized";authorized=true;event="sales_authorized";
  }else if(objection(text)&&plan){
    stage="objection_handling";event="sales_objection";
  }else if(plan&&["exploring","qualified"].includes(stage)){
    stage="plan_recommended";event="plan_recommended";
  }else if(plan&&stage==="plan_recommended"){
    stage="explaining";
  }

  const qualified=Boolean(memory.tiene_imss!==null&&memory.tiene_imss!==undefined) && Boolean(memory.edad||memory.necesidad_principal||Object.keys(memory.intereses||{}).length);
  if(stage==="exploring"&&qualified)stage="qualified";

  return {
    patch:{sales_cycle:{...previous,stage,qualified,plan_id:plan?.id||previous.plan_id||null,plan_name:plan?.name||previous.plan_name||null,authorized,authorization_at:authorized?(previous.authorization_at||new Date().toISOString()):null,last_event:event,last_event_at:new Date().toISOString()}},
    plan,event,stage,authorized,
    shouldHandoff:authorized,
    handoffReason:authorized?`Cliente autorizó continuar con el trámite${plan?.name?` después de recomendar ${plan.name}`:""}.`:null
  };
}

export function salesInstruction(memory={}){
  const s=memory.sales_cycle||{};
  if(s.authorized)return "El cliente ya autorizó el trámite: confirma brevemente y procede al handoff; no solicites CURP/NSS antes de transferir salvo que el cliente los haya enviado voluntariamente.";
  if(s.stage==="plan_recommended")return `Recomienda ${s.plan_name||"la opción adecuada"} de forma consultiva: conecta beneficios con la necesidad explícita del cliente, sin inventar precio ni condiciones. No pidas CURP/NSS para poder explicar el plan.`;
  if(s.stage==="explaining")return "Explica beneficios y funcionamiento del plan con lenguaje breve. Responde dudas antes de recopilar más datos y busca una confirmación natural de interés.";
  if(s.stage==="objection_handling")return "Atiende primero la objeción comercial. No presiones, no inventes precios y no uses CURP/NSS como salida. Después pregunta si desea continuar con la opción explicada.";
  if(s.stage==="interested")return "El cliente muestra interés. Aclara la duda pendiente y pregunta de forma natural si desea que iniciemos el trámite.";
  return "Realiza diagnóstico comercial mínimo y conversa sobre la necesidad. No conviertas la conversación en un formulario.";
}
