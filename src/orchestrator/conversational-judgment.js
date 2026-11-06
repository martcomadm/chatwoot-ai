import { directAnswerText, OPERATIONAL_MODEL_ANSWER } from './conversation-orchestrator.js';

function norm(v){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

export function detectHumanPreference(text){
  const v=norm(text);
  const patterns=[
    /quiero (?:hablar|comunicarme) con (?:una persona|alguien|un asesor|asesor humano)/,
    /prefiero (?:hablar|atencion|atención) (?:con una persona|personal|humana)/,
    /no (?:me gusta|quiero) (?:hablar|tratar) con (?:un )?(?:chat|bot|robot)/,
    /quiero (?:atencion|atención) (?:personal|humana)/,
    /que me atienda (?:una persona|un asesor)/,
  ];
  return patterns.some(re=>re.test(v));
}

export function isOperationalModelQuestion(v){
  return /me (?:dan|darian|darán|van a dar) de alta (?:con|en) (?:una|alguna|que|cual) (?:empresa|patron)|(?:con|en) (?:que|cual) empresa (?:me|quedo|estaria|apareceria)|me registrar[ií]an como (?:empleado|trabajador)|como es (?:el|la) (?:alta|afiliacion) (?:con|en) (?:la |una )?empresa|quien (?:seria|es|va a ser) mi patron|(?:con|que) patron (?:me|quedo)|aparezco como (?:empleado|trabajador)/.test(v);
}

export function detectQuestion(text){
  const v=norm(text);
  if(/\b(?:que|cual|cuanto|de cuanto)\b.{0,35}\b(?:salario|sueldo)\b.{0,25}\b(?:cotizado|registrado|maneja|manejan|tiene|es)\b|\b(?:salario|sueldo)\b.{0,35}\b(?:cotizado|registrado|maneja|manejan)\b/.test(v)) return {type:'registered_salary',answerKey:'registered_salary'};
  if(/\b(cuanto (?:cuesta|cobran?|sale)|precio|costo|mensualidad|aproximad[oa])\b/.test(v)) return {type:'price',answerKey:'price'};
  if(/\bque incluye (?:el )?plan\s*(1|uno)\b/.test(v)) return {type:'services_plan_1',answerKey:'services_plan_1'};
  if(/\bque incluye (?:el )?plan\s*(2|dos)\b/.test(v)) return {type:'services_plan_2',answerKey:'services_plan_2'};
  // Requiere intención interrogativa real: una mención declarativa de Plan 1/2
  // pertenece al commitment-flow.
  if(/\b(que ofrecen|que incluye|que manejan|cuales? (?:son )?(?:los )?(?:beneficios|planes|paquetes|servicios)|que (?:beneficios|planes|paquetes|servicios) (?:tienen|manejan|ofrecen)|diferencia entre (?:el )?plan)\b/.test(v)) return {type:'services',answerKey:'services'};
  if(/\b(donde (?:estan|se encuentran|se ubican)|ubicacion|oficinas?|direccion|direcci[oó]n|razon social|confiable|estafa|fraude|son reales)\b/.test(v)) return {type:'trust',answerKey:'trust'};
  if(/cotizaci[oó]n de qu[eé]|qu[eé] cotizaci[oó]n|a qu[eé] te refieres con cotizaci[oó]n/.test(v)) return {type:'clarify_quote',answerKey:'clarify_quote'};
  if(/(?:que|qu[eé]) (?:es|significa) (?:el )?curp|en qu[eé] consiste (?:el )?curp|curp es la fecha/.test(v)) return {type:'explain_curp',answerKey:'explain_curp'};
  // Cómo es el alta (con qué empresa / patrón). Ya no se transfiere: Mia responde con el texto oficial.
  if(isOperationalModelQuestion(v)) return {type:'operational_model',answerKey:'operational_model'};
  return null;
}

export function detectObjection(text){
  const v=norm(text);
  if(/antes de compartir (?:mis |algun )?datos|no (?:quiero|me gustaria) (?:dar|compartir) datos|no me comprometa|sin saber (?:el )?costo/.test(v)) return {type:'data_before_price',severity:'high'};
  if(/no me convence|no me da confianza|busco confianza|empresa (?:estable|confiable)|muchos estafadores|me preocupa (?:que sea )?fraude/.test(v)) return {type:'trust',severity:'high'};
  if(/es muy caro|muy costoso|no puedo pagar|no me alcanza/.test(v)) return {type:'price_resistance',severity:'medium'};
  return null;
}

export function controlledAnswer(key,memory={}){
  // Precios y planes salen de las respuestas oficiales del orquestador: una sola fuente
  // de verdad. (En producción la estrategia era no dar precio; en NEXT sí se da.)
  const answers={
    registered_salary:'Ambos planes manejan un salario diario registrado de $480 MXN.',
    price:directAnswerText({answerKey:'price'}),
    services_plan_1:directAnswerText({answerKey:'services',plan:'plan_1'}),
    services_plan_2:directAnswerText({answerKey:'services',plan:'plan_2'}),
    services:directAnswerText({answerKey:'services'}),
    trust:'Atendemos clientes de todo México y nuestra operación está en CDMX. Si antes de compartir datos quieres validar información de la empresa, es totalmente válido hacerlo primero.',
    clarify_quote:'Me refiero a la cotización de la opción de afiliación que corresponda a tu caso: el plan, el salario de registro y los beneficios que buscas.',
    explain_curp:'La CURP es la Clave Única de Registro de Población; no es solamente la fecha de nacimiento. Si no la tienes a la mano, podemos dejar ese dato pendiente por ahora.',
    operational_model:OPERATIONAL_MODEL_ANSWER,
  };

  return answers[key]||null;
}

export function analyzeJudgment(text,memory={}){
  const question=detectQuestion(text);
  const objection=detectObjection(text);
  const humanPreference=detectHumanPreference(text);
  const advisoryRequest=/\b(?:quiero|necesito|busco|quisiera|me gustaria)\s+(?:una\s+)?(?:asesoria|orientacion|informacion)\b|\b(?:asesorame|orientame)\b/i.test(norm(text));
  const previous=memory?.judgment||{};
  // human_preference is turn-scoped. A previous handoff-like interpretation must
  // never survive into a later answer such as "no, no tengo".
  const currentHumanPreference=Boolean(humanPreference);
  const priceRequests=Number(previous.price_requests||0)+(question?.type==='price'?1:0);
  const trustSignals=Number(previous.trust_signals||0)+((question?.type==='trust'||objection?.type==='trust')?1:0);
  // NEXT da precios oficiales: preguntar el costo varias veces ya no transfiere a un humano.
  const shouldHandoffSensitive=question?.sensitive===true;
  return {
    question,
    objection,
    humanPreference,
    directAnswer:controlledAnswer(question?.answerKey,memory),
    interrupt:{
      active:Boolean(question||objection||humanPreference),
      type:humanPreference?'human_preference':objection?.type||question?.type||null,
      priority:humanPreference?'critical':objection?.severity==='high'?'high':question?'high':'normal',
      resume_planner:!humanPreference&&!shouldHandoffSensitive
    },
    // Pedir "asesoría" u "orientación" es una intención conversacional para Mia,
    // no una solicitud de transferencia. Solo transferimos si el cliente pide
    // explícitamente una persona/asesor humano o se activa otra causa controlada.
    shouldHandoff:humanPreference||shouldHandoffSensitive,
    handoffReason:humanPreference
      ?'El cliente pidió o manifestó preferencia por atención humana.'
        :shouldHandoffSensitive
          ?'El cliente solicita explicación de la mecánica operativa del alta; requiere respuesta humana controlada.'
          :null,
    patch:{
      judgment:{
        ...previous,
        price_requests:priceRequests,
        trust_signals:trustSignals,
        last_question_type:question?.type||previous.last_question_type||null,
        last_objection:objection?.type||previous.last_objection||null,
        human_preference:currentHumanPreference,
        advisory_request:Boolean(previous.advisory_request||advisoryRequest),
        interrupt_type:humanPreference?'human_preference':objection?.type||question?.type||previous.interrupt_type||null,
        interrupt_active:Boolean(question||objection||humanPreference),
      }
    },
    events:[
      ...(question?[{type:'customer_question_detected',question}]:[]),
      ...(objection?[{type:'objection_detected',objection}]:[]),
      ...(humanPreference?[{type:'human_preference_detected'}]:[]),
    ]
  };
}
