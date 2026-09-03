function norm(v){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

export function detectDirectRequest(text){
  const v=norm(text);
  if(/\b(donde se (encuentran|ubican)|donde estan|ubicacion|oficinas?|razon social|estafa|fraude|confiable|seguro que|son reales)\b/.test(v)){
    return {type:'trust',priority:'high',answerKey:'trust'};
  }
  if(/\b(que ofrecen|que incluye|que manejan|paquetes|planes|servicios|diferencia entre (el )?plan|plan 1|plan 2)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services'};
  if(/\b(precio|cuanto cuesta|cuanto cobra|mensualidad|costo|cuanto sale)\b/.test(v)) return {type:'price',priority:'high',answerKey:'price'};
  if(/\b(quiero vender|quiero revender|quiero comercializar|quiero distribuir|quiero ofrecer (el|su) servicio|vender las afiliaciones|vender afiliaciones|ser distribuidor|ser proveedor|quiero ser asesor|ser asesor comercial|trabajar como asesor|integrarme como asesor|alianza comercial|trabajar con ustedes vendiendo|comercializar afiliaciones|ofrecer afiliaciones a (mis )?clientes|generar afiliaciones para terceros)\b/.test(v)) return {type:'b2b',priority:'critical',answerKey:'b2b'};
  return null;
}

export function directAnswerText(request){
  if(!request) return null;
  if(request.answerKey==='services') return 'Tenemos dos opciones: Plan 1 por $1,100 MXN, enfocado en servicio médico, semanas cotizadas y beneficiarios; y Plan 2 por $1,500 MXN, que además contempla AFORE, INFONAVIT e incapacidades conforme al caso. Ambos manejan un salario diario registrado de $480 MXN.';
  if(request.answerKey==='price') return 'El Plan 1 tiene un costo de $1,100 MXN y el Plan 2 de $1,500 MXN. Ambos manejan un salario diario registrado de $480 MXN; el Plan 2 además contempla AFORE, INFONAVIT e incapacidades conforme al caso.';
  if(request.answerKey==='trust') return 'Atendemos clientes de todo México y nuestra operación está en CDMX. Si antes de compartir datos quieres validar información de la empresa, con gusto podemos ayudarte a hacerlo.';
  if(request.answerKey==='b2b') return 'Claro. Si buscas vender u ofrecer nuestras afiliaciones como asesor o proveedor, voy a revisar tu solicitud comercial para darle continuidad.';
  return null;
}

export function orchestrateConversation(text,memory={}){
  const direct=detectDirectRequest(text);
  return {
    directRequest:direct,
    directAnswer:directAnswerText(direct),
    shouldHandoffB2B:direct?.type==='b2b',
    label:direct?.type==='b2b'?'proveedor':null,
    events:direct?[{type:'direct_request_detected',request:direct}]:[]
  };
}
