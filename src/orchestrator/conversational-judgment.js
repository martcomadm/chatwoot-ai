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

export function detectQuestion(text){
  const v=norm(text);
  if(/\b(cuanto (?:cuesta|cobran?|sale)|precio|costo|mensualidad|aproximad[oa])\b/.test(v)) return {type:'price',answerKey:'price'};
  if(/\b(que ofrecen|que incluye|que manejan|beneficios?|planes?|paquetes?|servicios?)\b/.test(v)) return {type:'services',answerKey:'services'};
  if(/\b(donde (?:estan|se encuentran|se ubican)|ubicacion|oficinas?|razon social|confiable|estafa|fraude|son reales)\b/.test(v)) return {type:'trust',answerKey:'trust'};
  if(/cotizaci[oó]n de qu[eé]|qu[eé] cotizaci[oó]n|a qu[eé] te refieres con cotizaci[oó]n/.test(v)) return {type:'clarify_quote',answerKey:'clarify_quote'};
  if(/(?:que|qu[eé]) (?:es|significa) (?:el )?curp|en qu[eé] consiste (?:el )?curp|curp es la fecha/.test(v)) return {type:'explain_curp',answerKey:'explain_curp'};
  if(/me dan de alta con (?:una|alguna) empresa|me registrar[ií]an como empleado|como es el alta con empresa/.test(v)) return {type:'operational_model',answerKey:'operational_model',sensitive:true};
  return null;
}

export function detectObjection(text){
  const v=norm(text);
  if(/antes de compartir (?:mis |algun )?datos|no (?:quiero|me gustaria) (?:dar|compartir) datos|no me comprometa|sin saber (?:el )?costo/.test(v)) return {type:'data_before_price',severity:'high'};
  if(/no me convence|no me da confianza|busco confianza|empresa (?:estable|confiable)|muchos estafadores|me preocupa (?:que sea )?fraude/.test(v)) return {type:'trust',severity:'high'};
  if(/es muy caro|muy costoso|no puedo pagar|no me alcanza/.test(v)) return {type:'price_resistance',severity:'medium'};
  return null;
}

export function controlledAnswer(key){
  const answers={
    price:'El costo depende del plan y del salario con el que se realice el registro. No quiero darte una cifra incorrecta sin revisar qué opción corresponde a tu caso.',
    services:'Manejamos opciones que pueden incluir servicio médico, cotización de semanas y beneficiarios; también existe una opción que puede contemplar aportaciones relacionadas con AFORE e INFONAVIT según el caso.',
    trust:'Atendemos clientes de todo México y nuestra operación está en CDMX. Si antes de compartir datos quieres validar información de la empresa, es totalmente válido hacerlo primero.',
    clarify_quote:'Me refiero a la cotización de la opción de afiliación que corresponda a tu caso: el plan, el salario de registro y los beneficios que buscas.',
    explain_curp:'La CURP es la Clave Única de Registro de Población; no es solamente la fecha de nacimiento. Si no la tienes a la mano, podemos dejar ese dato pendiente por ahora.',
    operational_model:'Ese punto debe explicarse con precisión según el servicio y tu caso. Prefiero que un asesor te lo aclare directamente antes de darte una respuesta incorrecta.',
  };
  return answers[key]||null;
}

export function analyzeJudgment(text,memory={}){
  const question=detectQuestion(text);
  const objection=detectObjection(text);
  const humanPreference=detectHumanPreference(text);
  const previous=memory?.judgment||{};
  const priceRequests=Number(previous.price_requests||0)+(question?.type==='price'?1:0);
  const trustSignals=Number(previous.trust_signals||0)+((question?.type==='trust'||objection?.type==='trust')?1:0);
  const shouldHandoffPrice=question?.type==='price' && (priceRequests>=2 || objection?.type==='data_before_price');
  const shouldHandoffSensitive=question?.sensitive===true;
  return {
    question,
    objection,
    humanPreference,
    directAnswer:controlledAnswer(question?.answerKey),
    shouldHandoff:humanPreference||shouldHandoffPrice||shouldHandoffSensitive,
    handoffReason:humanPreference
      ?'El cliente pidió o manifestó preferencia por atención humana.'
      :shouldHandoffPrice
        ?'El cliente insiste en conocer costo antes de compartir más datos; requiere explicación comercial humana.'
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
        human_preference:Boolean(previous.human_preference||humanPreference),
      }
    },
    events:[
      ...(question?[{type:'customer_question_detected',question}]:[]),
      ...(objection?[{type:'objection_detected',objection}]:[]),
      ...(humanPreference?[{type:'human_preference_detected'}]:[]),
    ]
  };
}
