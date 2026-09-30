function norm(v){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

function isRequirementsQuestion(v){
  const cleaned=String(v||"").replace(/[¿?¡!.,;:()[\]{}]/g," ").replace(/\s+/g," ").trim();
  const hasRequirements=/\brequisitos?\b/.test(cleaned);
  const hasDocuments=/\b(documentos?|papeles?)\b/.test(cleaned);
  const askCue=/\b(que|cual|cuales|necesito|necesitas|necesitan|piden|solicitan|requieren|ocupo|hace falta|se necesita)\b/.test(cleaned);
  const processCue=/\b(iniciar|tramite|tramitar|afiliarme|alta|darme de alta|empezar)\b/.test(cleaned);
  const asksWhatIsNeeded=/\bque se necesita\b/.test(cleaned)||/\bque necesito\b/.test(cleaned)||/\bque hace falta\b/.test(cleaned);
  return (hasRequirements && askCue) || (hasDocuments && (askCue || processCue)) || (asksWhatIsNeeded && processCue);
}

export function detectDirectRequest(text){
  const v=norm(text);
  if(/\b(como (?:dices que )?te llamas|como te llamas|cual es tu nombre|quien eres|con quien hablo)\b/.test(v)) return {type:'identity',priority:'high',answerKey:'identity'};
  if(/\b(cuanto tarda|cuanto tiempo tarda|cuanto demora|tiempo de proceso|tiempo del tramite|tramite cuanto tarda|en cuanto tiempo|cuantas horas tarda)\b/.test(v)) return {type:'process_time',priority:'high',answerKey:'process_time'};
  if(/\b(?:el )?acceso (?:al )?(?:servicio medico|imss).{0,25}(?:es )?(?:total|completo|completo al cien|100)|\b(?:tengo|tendre|incluye|da)\b.{0,25}\b(?:acceso|servicio)\b.{0,20}\b(?:total|completo|100)\b/.test(v)) return {type:'medical_access_scope',priority:'high',answerKey:'medical_access_scope'};
  if(/\b(medicamento|medicamentos|medicina|medicinas|cirugia|cirugias|operacion|operaciones|hospitalizacion|hospitalizar|estudios|consulta|consultas|especialista|especialidad)\b/.test(v) && /\b(puedo|puede|podria|incluye|cubre|dan|dar|solicitar|recibir|hacerme|atienden|atender)\b/.test(v)) return {type:'medical_benefit_followup',priority:'high',answerKey:'medical_benefit_followup'};
  if(/\b(operar|operen|opere|operacion|cirugia|cirugia mayor|apendice|apendicitis|vesicula|hernia|rodilla|cadera|catarata|parto|cesarea)\b/.test(v) && /\b(quiero|necesito|requiero|me van|puedo|podrian|hacerme|realizarme|tratar|atiendan)\b/.test(v)) return {type:'medical_specific_procedure',priority:'high',answerKey:'medical_specific_procedure'};
  const asksAforeAmount=/\b(?:cuanto|cuanta|cuantas|que porcentaje|porcentaje de|de cuanto)\b.{0,45}\b(?:aportacion(?:es)?|afore)\b|\b(?:aportacion(?:es)?|afore)\b.{0,45}\b(?:cuanto|cuanta|cuantas|que porcentaje|porcentaje)\b/.test(v);
  const asksInfonavitPoints=/\b(?:cuantos?|cuantas?)\b.{0,30}\bpuntos?\b|\bpuntos?\b.{0,30}\b(?:cuantos?|cuantas?)\b/.test(v);
  if(asksAforeAmount||asksInfonavitPoints) return {type:'plan_2_contributions',priority:'high',answerKey:'plan_2_contributions'};
  // Pension outcome is case-specific. Detect the question so Mia always answers
  // instead of letting a stale discovery planner swallow the customer turn.
  if(/\b(?:mi pension|la pension)\b.{0,35}\b(?:aumenta|sube|incrementa|mejora|seria mayor|sera mayor)\b|\b(?:aumenta|sube|incrementa|mejora)\b.{0,35}\b(?:mi pension|la pension)\b/.test(v)) return {type:'pension_impact',priority:'high',answerKey:'pension_impact'};
  // "¿Qué necesitas para revisar mi caso?" is a request to begin case review,
  // not a request to hear the previously recommended plan again.
  const asksCaseReview=/\b(?:para|pa)\s+(?:revisar|checar|ver|evaluar|analizar)\s+(?:mi|el)\s+caso\b.{0,45}\b(?:que necesitas|que ocupas|que te paso|que te doy|que requieres|que hace falta)\b|\b(?:que necesitas|que ocupas|que te paso|que te doy|que requieres|que hace falta)\b.{0,45}\b(?:revisar|checar|ver|evaluar|analizar)\s+(?:mi|el)\s+caso\b/.test(v);
  if(asksCaseReview) return {type:'case_review',priority:'high',answerKey:'case_review'};
  // A CURP sent immediately after Mia requested NSS/CURP for a case review is
  // an answer to that intake request. Keep the turn in case-review intake so
  // stale retirement/Plan 1 context cannot trigger another recommendation.
  const standaloneCurp=/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/i.test(String(text||"").replace(/\s+/g,"").trim());
  if(standaloneCurp) return {type:'case_review_curp',priority:'high',answerKey:'case_review_curp'};
  if(isRequirementsQuestion(v)) return {type:'requirements',priority:'high',answerKey:'requirements'};
  const asksRegisteredSalary=/\b(?:que|cual|cuanto|de cuanto)\b.{0,35}\b(?:salario|sueldo)\b.{0,25}\b(?:cotizado|registrado|maneja|manejan|tiene|es)\b|\b(?:salario|sueldo)\b.{0,35}\b(?:cotizado|registrado|maneja|manejan)\b/.test(v);
  if(asksRegisteredSalary) return {type:'registered_salary',priority:'high',answerKey:'registered_salary'};
  if(/\b(donde se (encuentran|ubican)|donde estan|ubicacion|oficinas?|razon social|estafa|fraude|confiable|seguro que|son reales)\b/.test(v)){
    return {type:'trust',priority:'high',answerKey:'trust'};
  }
  // Las preguntas por un plan concreto conservan el contexto del plan.
  if(/\bque incluye (?:el )?plan\s*(1|uno)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_1'};
  if(/\bque incluye (?:el )?plan\s*(2|dos)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_2'};
  // Solo es pregunta de servicios cuando el cliente realmente pregunta por ellos.
  // Menciones declarativas como "me quedo con el Plan 1" o "quiero el Plan 1"
  // pertenecen al commitment-flow y no deben convertirse en catálogo de planes.
  if(/\b(que ofrecen|que incluye|que manejan|cuales? (?:son )?(?:los )?(?:paquetes|planes|servicios)|que (?:paquetes|planes|servicios) (?:tienen|manejan|ofrecen)|diferencia entre (?:el )?plan)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services'};
  if(/\b(precio|cuanto cuesta|cuanto cobra|mensualidad|costo|cuanto sale)\b/.test(v)) return {type:'price',priority:'high',answerKey:'price'};
  if(/\b(quiero vender|quiero revender|quiero comercializar|quiero distribuir|quiero ofrecer (el|su) servicio|vender las afiliaciones|vender afiliaciones|ser distribuidor|ser proveedor|quiero ser asesor|ser asesor comercial|trabajar como asesor|integrarme como asesor|alianza comercial|trabajar con ustedes vendiendo|comercializar afiliaciones|ofrecer afiliaciones a (mis )?clientes|generar afiliaciones para terceros)\b/.test(v)) return {type:'b2b',priority:'critical',answerKey:'b2b'};
  return null;
}

export function directAnswerText(request){
  if(!request) return null;
  if(request.answerKey==='identity') return 'Me llamo Mia, soy la asistente virtual de MARTCOM. 😊';
  if(request.answerKey==='process_time') return 'Una vez que recibimos la documentación completa, el proceso suele tomar aproximadamente 48 horas hábiles. El tiempo puede variar según la revisión del caso.';
  if(request.answerKey==='medical_access_scope') return 'Sí. Una vez que tu alta esté vigente, tienes acceso al servicio médico del IMSS como trabajador asegurado: consultas, atención médica, medicamentos, estudios, hospitalización y cirugías cuando sean indicados por el personal médico del IMSS, conforme a sus procesos y reglas. También puedes registrar beneficiarios cuando corresponda. Si tienes una atención específica en mente, dime cuál y te explico cómo aplica.';
  if(request.answerKey==='medical_benefit_followup') return 'Sí. Una vez que tu alta esté vigente, puedes recibir medicamentos y también atención quirúrgica a través del IMSS. En el caso de una cirugía, primero debes ser valorado por el personal médico del Instituto y la cirugía debe ser indicada y programada conforme a sus procesos médicos. Los medicamentos igualmente se entregan cuando son prescritos dentro de la atención del IMSS. Si ya tienes un diagnóstico o sabes qué cirugía necesitas, puedo orientarte sobre el siguiente paso.';
  if(request.answerKey==='medical_specific_procedure') return 'Sí, ese tipo de atención puede realizarse a través del IMSS una vez que tu alta esté vigente. En un caso como una operación de apéndice, el IMSS debe valorarte y determinar médicamente la atención necesaria; si se trata de una urgencia, debes acudir directamente a Urgencias para valoración. La indicación y realización del procedimiento dependen del personal médico del Instituto. Si actualmente tienes dolor intenso o síntomas de una posible apendicitis, no esperes a completar un trámite: busca atención médica de urgencia.';
  if(request.answerKey==='plan_2_contributions') return 'En el Plan 2, la aportación a AFORE se maneja de forma alternada: un mes es de 5.5% y el siguiente de 10%, repitiendo ese esquema. En INFONAVIT, la acumulación estimada es de entre 200 y 250 puntos. Si quieres, también puedo explicarte cómo se integra este beneficio con el resto del Plan 2.';
  if(request.answerKey==='registered_salary') return 'Ambos planes manejan un salario diario registrado de $480 MXN.';
  if(request.answerKey==='pension_impact') return 'Seguir cotizando semanas puede ayudarte a continuar construyendo tu historial ante el IMSS, pero no puedo asegurarte que tu pensión aumente solo por contratar la afiliación. El monto de una pensión depende de varios datos de tu historial y régimen. Si tu objetivo es pensión, podemos revisar primero tu caso para orientarte sin prometer un incremento que todavía no conocemos.';
  if(request.answerKey==='case_review') return 'Para empezar a revisar tu caso, compárteme tu NSS si lo tienes a la mano. Si no lo tienes, no te preocupes: con tu CURP podemos localizarlo y continuar sin atrasar la revisión.';
  if(request.answerKey==='case_review_curp') return 'Perfecto, ya tengo tu CURP. Con este dato podemos localizar tu NSS y continuar con la revisión de tu caso. No necesitas volver a enviarme la información anterior.';
  if(request.answerKey==='requirements') return 'Para iniciar necesitamos CURP, NSS e INE del titular. La Constancia de Situación Fiscal es opcional al inicio y se solicitará a los 3 meses de que ya estés con nosotros. Si todavía estás revisando la opción, no necesitas enviar tus documentos aún.';
  if(request.answerKey==='services' && request.plan==='plan_1') return 'El Plan 1 cuesta $1,100 MXN e incluye servicio médico del IMSS, continuación de semanas cotizadas y la posibilidad de registrar beneficiarios conforme a las reglas del IMSS. Si quieres, también puedo explicarte algún beneficio en particular.';
  if(request.answerKey==='services' && request.plan==='plan_2') return 'El Plan 2 cuesta $1,500 MXN e incluye servicio médico y continuación de semanas, además de aportaciones a AFORE y acumulación de puntos para INFONAVIT; también contempla incapacidades conforme al caso.';
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
