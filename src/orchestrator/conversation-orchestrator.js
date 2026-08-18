function norm(v){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

export function detectDirectRequest(text){
  const v=norm(text);
  if(/\b(donde se (encuentran|ubican)|donde estan|ubicacion|oficinas?|razon social|estafa|fraude|confiable|seguro que|son reales)\b/.test(v)){
    return {type:'trust',priority:'high',answerKey:'trust'};
  }
  if(/\b(que ofrecen|que incluye|que manejan|paquetes|planes|servicios)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services'};
  if(/\b(precio|cuanto cuesta|cuanto cobra|mensualidad|costo)\b/.test(v)) return {type:'price',priority:'high',answerKey:'price'};
  if(/\b(quiero vender|vender las afiliaciones|ser distribuidor|ser proveedor|alianza comercial|trabajar con ustedes vendiendo|comercializar afiliaciones)\b/.test(v)) return {type:'b2b',priority:'critical',answerKey:'b2b'};
  return null;
}

export function directAnswerText(request){
  if(!request) return null;
  if(request.answerKey==='services') return 'Manejamos opciones de afiliación que pueden incluir servicio médico, cotización de semanas y beneficiarios; también existe una opción con aportaciones relacionadas con AFORE e INFONAVIT.';
  if(request.answerKey==='price') return 'El costo depende del plan y del salario con el que se realice el registro; no quiero darte una cantidad incorrecta sin revisar qué opción corresponde a tu caso.';
  if(request.answerKey==='trust') return 'Atendemos clientes de todo México y nuestra operación está en CDMX. Si antes de compartir datos quieres validar información de la empresa, con gusto podemos ayudarte a hacerlo.';
  if(request.answerKey==='b2b') return 'Claro. Si lo que buscas es comercializar afiliaciones o trabajar como proveedor, ese es un proceso distinto al de afiliación de un cliente.';
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
