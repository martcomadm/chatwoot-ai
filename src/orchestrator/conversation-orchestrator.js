import { INFONAVIT_CREDIT_PRICE_TEXT, INFONAVIT_CREDIT_PLAN2_TEXT } from '../sales/infonavit-credit.js';
import { effectivePlan } from '../sales/progressive-disclosure.js';
import { FACT_LOCKED_TYPES } from '../core/deterministic-decision-policy.js';

function norm(v){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

function isRequirementsQuestion(v){
  const cleaned=String(v||"").replace(/[¿?¡!.,;:()[\]{}]/g," ").replace(/\s+/g," ").trim();
  const hasRequirements=/\brequisitos?\b/.test(cleaned);
  const hasDocuments=/\b(documentos?|documentacion|papeles?|papeleria)\b/.test(cleaned);
  if(/\bque (?:necesita|necesitas|ocupa|ocupas|requiere|requieres) que (?:le|te) (?:envie|mande|pase|de)\b/.test(cleaned)) return true;
  const askCue=/\b(que|cual|cuales|necesito|necesitas|necesitan|piden|solicitan|requieren|ocupo|hace falta|se necesita)\b/.test(cleaned);
  const processCue=/\b(iniciar|tramite|tramitar|afiliarme|alta|darme de alta|empezar)\b/.test(cleaned);
  // "k nesesitamos" / "¿qué necesito?" solo (caso real 21-oct).
  if(/^(?:y\s+)?que\s+(?:necesitamos|necesito|se necesita|necesitas|ocupas|ocupo|hace falta)$/.test(cleaned)) return true;
  const asksWhatIsNeeded=/\bque se necesita\b/.test(cleaned)||/\bque necesito\b/.test(cleaned)||/\bque hace falta\b/.test(cleaned);
  return (hasRequirements && askCue) || (hasDocuments && (askCue || processCue)) || (asksWhatIsNeeded && processCue);
}

export const OPERATIONAL_MODEL_ANSWER='Tu alta se realiza con una empresa y, además, contamos con una empresa de respaldo. Mientras realices tu pago mensual en tiempo y forma, no deberías tener ningún inconveniente con tu afiliación.';

export function detectDirectRequest(text){
  const v=norm(text);
  if(/\b(como (?:dices que )?te llamas|como te llamas|cual es tu nombre|quien eres|con quien hablo)\b/.test(v)) return {type:'identity',priority:'high',answerKey:'identity'};
  // "¿Cuánto sería la mensualidad y en cuánto tiempo duraría pagándolo?" (caso real 20-oct): precio y plazo de pago.
  if(/\b(mensualidad|cuanto (?:seria|serian|cuesta|cobran|pagaria)|costo|precio)\b/.test(v) && /\b(?:cuanto tiempo|en cuanto tiempo|hasta cuando|por cuanto tiempo)\b.{0,30}\b(?:pag\w*|duraria|dudaria|tendria que)\b/.test(v)) return {type:'payment_duration',priority:'high',answerKey:'payment_duration'};
  // "¿Por cuánto tiempo tengo que pagar los 1500?", "1,100 x cuánto tiempo" (casos reales 23 y 25-oct).
  if(/\b(?:por cuanto tiempo|cuanto tiempo|hasta cuando)\b.{0,25}\b(?:tengo|tendria|hay|debo|tendre) que (?:pagar|estar pagando|seguir pagando)\b.{0,25}\b(?:1[,.]?[15]00|mil (?:cien|quinientos)|mensualidad|el plan|los pagos)\b|\b1[,.]?[15]00\b.{0,12}\b(?:x|por) cuanto tiempo\b/.test(v)) return {type:'payment_duration',priority:'high',answerKey:'payment_duration'};
  if(/\b(cuanto tarda|cuanto tiempo tarda|cuanto demora|tiempo de proceso|tiempo del tramite|tiempo de(?:l)? alta|tiempo (?:de|para) (?:activacion|quedar activo|darme de alta)|cuanto tiempo (?:para|en) (?:el alta|darme de alta|quedar)|en cuanto (?:quedo|quedaria|estaria) (?:dado de alta|activo)|tramite cuanto tarda|en cuanto tiempo|cuantas horas tarda)\b/.test(v)) return {type:'process_time',priority:'high',answerKey:'process_time'};
  if(/\b(?:el )?acceso (?:al )?(?:servicio medico|imss).{0,25}(?:es )?(?:total|completo|completo al cien|100)|\b(?:tengo|tendre|tienes|tienen|incluye|da|dan)\b.{0,25}\b(?:acceso|servicio)\b.{0,20}\b(?:total|completo|100)\b/.test(v)) return {type:'medical_access_scope',priority:'high',answerKey:'medical_access_scope'};
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
  // "¿Le podrían checar cómo ando?" (caso real 14-oct): pide revisar su situación.
  const asksStatusCheck=/\b(?:checar|chekar|chequar|revisar|ver|checarme|revisarme)\b.{0,25}\b(?:como (?:ando|estoy|voy)|mis semanas|mi situacion|mi estatus|mi status)\b/.test(v);
  if(asksCaseReview||asksStatusCheck) return {type:'case_review',priority:'high',answerKey:'case_review'};
  // A CURP sent immediately after Mia requested NSS/CURP for a case review is
  // an answer to that intake request. Keep the turn in case-review intake so
  // stale retirement/Plan 1 context cannot trigger another recommendation.
  const standaloneCurp=/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/i.test(String(text||"").replace(/\s+/g,"").trim());
  if(standaloneCurp) return {type:'case_review_curp',priority:'high',answerKey:'case_review_curp'};
  // "¿Primero verifican mi alta y después se deposita, o primero el depósito?" (caso real 15-oct).
  const mentionsPayment=/\b(deposit\w*|pag\w*|transferencia|transfiero|aportacion\w*|cuota|mensualidad)\b/.test(v);
  const mentionsAlta=/\b(alta|vigencia|verificar|verifica\w*|afiliacion|afiliarme|registr\w*)\b/.test(v);
  if(mentionsPayment && (/\b(primero|despues|antes|luego)\b/.test(v) && mentionsAlta || /\b(cuando|en que momento)\s+(?:se\s+|hago\s+(?:el\s+)?|realizo\s+(?:el\s+)?)?(?:pag\w*|deposit\w*)\b/.test(v) || /\b(se paga|pago) (?:antes|despues)\b/.test(v) || /\ba partir de cuando\b/.test(v))) return {type:'payment_order',priority:'high',answerKey:'payment_order',fixed:/\b(?:fija|fijo|variable|cambia|sube)\b/.test(v)};
  // "¿Y cuándo tengo que pagar?", "El pago, ¿cuándo se realiza?", "El pago de los 1500 ¿en qué momento?" (23 y 25-oct).
  if(/\b(?:cuando|en que momento)\s+(?:tengo|tendria|hay|debo|tendre)\s+que\s+(?:pagar|depositar|hacer el pago)\b|\b(?:el\s+)?(?:primer\s+)?pago\b.{0,30}\b(?:cuando se (?:realiza|hace)|en que momento|a partir de cuando|cuando seria)\b/.test(v)) return {type:'payment_order',priority:'high',answerKey:'payment_order',fixed:false};
  // Semanas que no aparecen en su historial: se aclaran en la clínica del IMSS ya activo con nosotros (20-oct).
  if(/\b(?:no (?:me )?(?:aparecen|salen|estan|reconocen|registraron|toman en cuenta)|perdi|se perdieron|me quitaron|desaparecieron)\b.{0,40}\bsemanas\b|\bsemanas\b.{0,60}\b(?:no (?:me )?(?:aparecen|salen|estan|reconocen|registraron|cuentan)|se perdieron|desaparecieron)\b/.test(v)) return {type:'missing_weeks',priority:'high',answerKey:'missing_weeks'};
  // "Me faltan semanas" (para pensionarse, caso real 20-oct): seguir sumando semanas con nosotros.
  if(/^(?:hola\s+)?(?:es que\s+|pues\s+)?(?:me|m|mi|nos)\s+faltan?\s+(?:unas?\s+|algunas\s+|mas\s+|pocas\s+|\d+\s+)?semanas\b/.test(v.replace(/[^a-z0-9n ]+/g,' ').replace(/\s+/g,' ').trim()) || /\b(?:me|m)\s+faltan?\s+(?:\d+\s+)?semanas\s+(?:para|pa)\s+(?:pensionarme|jubilarme|la pension|mi pension)\b/.test(v)) return {type:'needs_weeks',priority:'high',answerKey:'needs_weeks'};
  // "¿La empresa sería la misma de siempre? En donde estaba me la cambiaban cada mes" / "¿No cambian de empresa a cada rato?" (20-oct).
  if(/\b(?:empresa|patron)\b.{0,60}\b(?:la misma|el mismo|misma de siempre|cambia\w*|cambian|cambio)\b|\b(?:cambian|cambiaban|cambia|cambiar)\s+(?:de\s+)?(?:empresa|patron)\b|\bme la cambiaban\b/.test(v)
    // "¿Cada mes se da de baja y vuelve a incorporar?", "¿Qué permanencia se tiene con el mismo patrón?", "¿Me cambiarían de empresa cada rato?" (23 al 26-oct).
    || /\b(?:mismo|misma)\s+(?:patron|empresa)\b|\bpermanencia\b|\bcambi\w*\s+(?:de\s+)?(?:empresa|patron)\b|\b(?:se\s+)?(?:da|dan|dar|doy)\s+de\s+baja\b.{0,40}\b(?:vuelv\w*|reincorpor\w*|incorpor\w*|de nuevo|otra vez)\b|\bcada mes se (?:actualiza|renueva|cambia)\b/.test(v)) return {type:'same_company',priority:'high',answerKey:'same_company'};
  // "¿Maneja altas con retroactivo?": no se manejan (confirmado 26-oct).
  if(/\bretroactiv\w*\b|\bfecha (?:anterior|atrasada|pasada)\b.{0,20}\balta\b|\balta\b.{0,20}\bfecha (?:anterior|atrasada|pasada)\b/.test(v)) return {type:'retroactive',priority:'high',answerKey:'retroactive'};
  // "¿El costo de la activación?", "me refiero a sus honorarios" (caso real 22-oct: recibió 4 veces la
  // misma respuesta de precios).
  if(/\b(?:activacion|inscripcion|apertura|comision\w*|me refiero a (?:sus |los |tus )?honorarios|cuota (?:de )?(?:inicial|de entrada)|costo (?:extra|adicional|aparte|inicial)|pago (?:inicial|unico|de entrada))\b/.test(v) && /\b(?:costo|cuanto|cobran|son|sus|honorarios|activacion|me refiero|hay)\b/.test(v)) return {type:'fees',priority:'high',answerKey:'fees'};
  // "Sigo laborando, pero no tengo seguro social" (caso real 22-oct): trabaja sin IMSS.
  if(/\b(?:trabajo|trabajando|laboro|laborando|tengo trabajo|empleado)\b.{0,40}\b(?:no tengo|no cuento con|sin|no me dan|no me da)\s+(?:el\s+)?(?:seguro|imss)\b/.test(v)) return {type:'working_no_imss',priority:'high',answerKey:'working_no_imss'};
  // "No tengo NSS", "no tengo credencial" antes de iniciar (casos reales 22-oct: "si no lo tienes no
  // podremos completar el trámite").
  {
    const noNss=/\b(?:no tengo|no cuento con|no se|no recuerdo|no encuentro|perdi|mo tengo|sin)\b.{0,15}\b(?:nss|numero de (?:seguro|imss|afiliacion)|ssn)\b|\b(?:nss|ssn)\b.{0,12}\bno (?:lo )?tengo\b/.test(v);
    const noIne=/\b(?:no tengo|no cuento con|apenas (?:la )?(?:tramite|saque)|sin|perdi)\b.{0,15}\b(?:ine|ife|credencial)\b|\b(?:ine|ife|credencial)\b.{0,15}\b(?:no (?:la )?tengo|apenas la tramite)\b/.test(v);
    if(noNss||noIne) return {type:'missing_docs',priority:'high',answerKey:'missing_docs',noNss,noIne};
  }
  // "Me faltan 5 semanas para la pensión" (caso real 21-oct).
  {
    const m=v.match(/\b(?:me|m|nos)\s+faltan?\s+(?:como\s+|unas\s+|solo\s+)?(\d{1,3})\s+semanas\b/);
    if(m && Number(m[1])>0 && Number(m[1])<=150) return {type:'few_weeks_left',priority:'high',answerKey:'few_weeks_left',weeks:Number(m[1]),pre1997:false};
  }
  // "¿Cuántas semanas necesito para pensionarme?": mínimo 500 (Ley 73) y 800 (Ley 97), confirmado 26-oct.
  if(/\b(?:cuantas|minimo de|minimas?|cuantas son las) semanas\b.{0,50}\b(?:pension\w*|jubil\w*|retir\w*)\b|\b(?:pension\w*|jubil\w*)\b.{0,50}\b(?:cuantas semanas|semanas minimas|minimo de semanas|semanas se necesitan|semanas necesito)\b/.test(v)
    // "¿Cuántos años debería cotizar para una pensión?", "por cuánto tiempo tendría que cotizar" (23-oct).
    || /\b(?:cuantos anos|cuanto tiempo|por cuanto tiempo)\b.{0,25}\b(?:deberia|debo|tendria|tengo|hay) que cotizar\b|\bcuantos anos\b.{0,20}\bcotizar\b.{0,30}\b(?:pension\w*|jubil\w*)\b/.test(v.replace(/ñ/g,'n'))) return {type:'min_weeks',priority:'high',answerKey:'min_weeks'};
  // Guardería y carta patronal: MARTCOM la proporciona (confirmado 20-oct).
  if(/\bguarderia\b|\bcarta (?:del )?patr?on\w*\b|\bcarta patronal\b|\bconstancia (?:del )?patron\w*\b/.test(v)) return {type:'daycare',priority:'high',answerKey:'daycare'};
  // Ya cotiza con su trabajo (texto confirmado 20-oct). No si ya renunció o lo van a dar de baja.
  if(/\b(?:actualmente|ahorita|ahora|ya|si)?\s*(?:estoy|sigo|ando)\s+(?:laborando|trabajando|cotizando)\b.{0,40}\b(?:cuento con|tengo|me da|me dan)\s+(?:el\s+)?(?:seguro|imss)\b|\b(?:actualmente\s+|ya\s+)?(?:cotizo|estoy cotizando)\s+(?:actualmente\s+)?(?:en|con)\s+(?:el\s+)?(?:imss|seguro)\b|\bya estoy cotizando en el seguro\b/.test(v) && !/\b(?:renunci\w*|baja|ya no|dejare|voy a dejar|me corrieron|liquid\w*)\b/.test(v) && !/\bno (?:tengo|cuento con|me dan|me da)\b.{0,12}\b(?:seguro|imss)\b|\bsin (?:seguro|imss)\b/.test(v)) return {type:'employed',priority:'high',answerKey:'employed'};
  // "Buenos días, aún estoy cotizando" a "¿hace cuánto dejaste de cotizar?" (caso real 25-oct: se le recomendó el Plan 1).
  if(/^(?:(?:buenos dias|buen dia|buenas tardes|hola|si|pues)[ ,.]+)*(?:aun|todavia|actualmente|ahorita)?\s*(?:sigo|estoy|aun estoy|todavia estoy)\s+(?:cotizando|trabajando)(?:\s+(?:todavia|aun|actualmente|en (?:una|la) empresa|con (?:mi )?patron))?[ .!]*$/.test(v)) return {type:'employed',priority:'high',answerKey:'employed'};
  // "¿Cómo saber si estoy cotizando?" / "¿cómo veo mis semanas?" (casos reales 17-oct).
  if(/\bcomo (?:saber|se|sabria|puedo saber|veo|puedo ver|consulto|checo|reviso)\b.{0,20}\b(?:si estoy cotizando|si sigo cotizando|mis semanas|mis cotizaciones|cuantas semanas|semanas cotizadas)\b|\bcuantas semanas tengo\b/.test(v)) return {type:'check_weeks',priority:'high',answerKey:'check_weeks'};
  // "¿Cómo puedo hacer beneficiaria a mi pareja? Vivimos en unión libre" (caso real 25-oct: recibió los pasos del trámite).
  if(/\b(?:beneficiari\w*|asegurar a|dar de alta a|afiliar a|meter a)\s*(?:a\s+)?(?:mi|mis)?\s*(?:pareja|esposa|esposo|concubin\w*|novia|novio|mujer|marido|hijos?|hijas?|mama|papa|padres)\b|\b(?:mi|mis)\s+(?:pareja|esposa|esposo|concubin\w*|hijos?|hijas?|padres|mama|papa)\b.{0,40}\b(?:beneficiari\w*|asegurar\w*|union libre)\b|\blo de (?:mi|mis) (?:pareja|esposa|esposo|concubin\w*|hijos?|hijas?|padres)\b/.test(v)){
    const employed=/\b(?:estoy|sigo|ando)\s+(?:empleado|empleada|trabajando|laborando|cotizando)\b|\bmi patron\b|\bmi trabajo me da\b/.test(v);
    return {type:'beneficiary',priority:'high',answerKey:'beneficiary',employed,partner:/\b(?:pareja|esposa|esposo|concubin\w*|novia|novio|mujer|marido|union libre)\b/.test(v)};
  }
  // "¿Tiene un costo el que usted me dé información?" (caso real 24-oct: recibió los precios).
  if(/\b(?:tiene|cobra|cobran|cuesta)\b.{0,25}\b(?:costo|algo|cobro)?\b.{0,25}\b(?:me (?:de|den|da|dan|proporcione\w*)|darme|dar)\s+(?:la\s+)?(?:informacion|info|asesoria)\b|\b(?:la\s+)?(?:informacion|asesoria)\s+(?:tiene\s+(?:algun\s+)?costo|cuesta|se cobra|es gratis)\b/.test(v)) return {type:'info_free',priority:'high',answerKey:'info_free'};
  // "¿Y ese no aporta a AFORE, verdad?" sobre el Plan 1 (caso real 24-oct: recibió otra vez la explicación del Plan 1).
  if(/\b(?:ese|este|el plan (?:1|uno))\s+(?:plan\s+)?no\s+(?:aporta|incluye|tiene|da|cubre)\s+(?:a\s+|al\s+|el\s+|la\s+)?(?:afore|infonavit)\b/.test(v)) return {type:'plan1_no_afore',priority:'high',answerKey:'plan1_no_afore'};
  // Ya tiene una pensión (invalidez, cesantía…): caso para un asesor.
  if(/\b(?:estoy|ya estoy|soy|ya soy)\s+pensionad[oa]\b|\bpensionad[oa]\s+por\b|\btengo (?:una )?pension (?:de|por)\b/.test(v)) return {type:'already_pensioned',priority:'high',answerKey:'already_pensioned'};
  // "¿Qué plan me conviene?" / "en tu experiencia, ¿cuál conviene más?"
  if(/\b(?:que|cual)\s+(?:plan\s+)?(?:me\s+)?(?:conviene|recomiendas|recomienda|sugieres|es mejor)\b|\ben tu experiencia\b|\bcual (?:de los dos|plan) (?:me )?(?:conviene|recomiendas)\b/.test(v)) return {type:'which_plan',priority:'high',answerKey:'which_plan'};
  // "¿Me podrías proporcionar una página?" (caso 17-oct): la página oficial de MARTCOM.
  if(/\b(pagina|pagina web|sitio|sitio web|web|internet|facebook|redes sociales|link|enlace)\b/.test(v)&&/\b(tienen|tiene|hay|cual es|me (?:das|da|pasas|pasa|proporcionas|proporciona|compartes|comparte|podrias|podria)|donde (?:puedo|veo)|para conocer|para ver|para verificar)\b/.test(v)) return {type:'website',priority:'high',answerKey:'website'};
  // La página del anuncio se llama "Seguro Social Integral": hay quien cree que habla con el IMSS.
  if(/\b(?:son|eres|es|estoy hablando con|hablo con)\s+(?:el |del |de el )?imss\b|\b(?:son|es|eres)\s+(?:de |del )?gobierno\b|\bson oficiales\b|\bseguro social integral\b/.test(v)) return {type:'are_you_imss',priority:'high',answerKey:'are_you_imss'};
  if(isRequirementsQuestion(v)) return {type:'requirements',priority:'high',answerKey:'requirements'};
  const asksRegisteredSalary=/\b(?:que|cual|cuanto|de cuanto)\b.{0,35}\b(?:salario|sueldo)\b.{0,35}\b(?:cotizado|registrado|maneja|manejan|manejas|tiene|es|pones|ponen|usan|registran|cotizar)\b|\b(?:salario|sueldo)\b.{0,35}\b(?:cotizado|registrado|maneja|manejan|manejas|pones|ponen|para cotizar)\b/.test(v);
  // "¿Con ese salario registrado me conviene para una buena pensión?" no es solo el dato del salario.
  if(/\b(salario|sueldo)\b/.test(v) && /\b(pension\w*|jubil\w*|conviene|me sirve|me ayuda|alcanza)\b/.test(v)) return {type:'salary_pension',priority:'high',answerKey:'salary_pension'};
  if(asksRegisteredSalary) return {type:'registered_salary',priority:'high',answerKey:'registered_salary'};
  // Ubicación, legitimidad y "con qué empresa" son preguntas distintas (antes compartían
  // una sola respuesta y "un seguro que me cubra" se tomaba como desconfianza).
  const asksLocation=/\b(donde (?:te|se|los|lo) (?:encuentro|encuentran|ubicas|ubican|ubico)|donde se (?:encuentran|ubican)|donde (?:estan|esta|queda|quedan|se ubica)|en donde (?:estan|esta)|ubicacion|ubicados|ubicada|ubicas|oficinas?|direccion|domicilio de (?:la empresa|ustedes))\b/.test(v)
    || /\b(?:ustedes\s+)?(?:estan|se encuentran|son|atienden|tienen (?:oficina|sucursal)\w*)\s+(?:de|en)\s+(?!el plan|la afiliacion|el imss|linea|horario|confianza|verdad|proceso|tramite|espera|acuerdo)[a-z]{4,}/.test(v) && /[?¿]|\b(?:ustedes|estan|sucursal|oficina)\b/.test(String(text))
    || /\b(?:hay|tienen)\s+(?:sucursal|oficina)\w*\b/.test(v)
    || /\b(?:en )?(?:toda la republica|todo el pais|todo mexico|toda la republica mexicana|cualquier estado|otro estado|mi estado|foraneos?)\b/.test(v);
  const asksLegitimacy=/\b(es legal|son legales|legalidad|certeza|que tan seguro|seguro sea|es seguro hacerlo|que garantia|garantia tengo|es verdad|no es fraude|es legitimo|es real|son reales|estafa\w*|fraude|fraudes|confiable|confiables|es seguro esto|es de confianza|no me (?:van a )?(?:estafar|robar)|me (?:van a )?dar de baja)\b/.test(v) && !/\bmodalidad\b|\bm40\b/.test(v);
  const asksCompany=/\b(razon social|cual es la empresa|que empresa|con que empresa|nombre de la empresa|cuantos patrones|con cuantos patrones|quien (?:seria|es) (?:mi )?patron)\b/.test(v);
  if([asksLocation,asksLegitimacy,asksCompany].filter(Boolean).length>1) return {type:'trust',priority:'high',answerKey:'trust'};
  if(asksLocation && !/\b(?:infonavit|afore|plan\s*[12]|semanas)\b/.test(v) && !/\b(?:mi direccion|direccion (?:en|de) (?:el|la|mi) (?:ine|credencial)|vivo en|estoy viviendo|vivia en)\b/.test(v)) return {type:'location',priority:'high',answerKey:'location'};
  if(asksLegitimacy) return {type:'legitimacy',priority:'high',answerKey:'legitimacy'};
  if(asksCompany) return {type:'operational_model',priority:'high',answerKey:'operational_model'};
  if(/\bmodalidad\s*(?:40|cuarenta)\b|\bm40\b/.test(v)) return {type:'modality_40',priority:'high',answerKey:'modality_40'};
  if(/\b(que modalidad|cual modalidad|en que modalidad|alguna modalidad|por modalidad|es modalidad|modalidad (?:10|40|diez|cuarenta)|modalidad (?:manejan|atienden|es|o como))\b/.test(v)){
    return {type:'modality',priority:'high',answerKey:'modality'};
  }
  if(/\bincapacidad(?:es)?\b/.test(v) && /\b(cobrar|cobro|cobran|cobra|pagan|paga|pagarian|cubre|cubren|incluye|agarr\w*|agarias|dan|tengo derecho|aplica|manejan|tienen|saber|requiere|se requiere)\b/.test(v)){
    return {type:'disability',priority:'high',answerKey:'disability',maternity:/\b(maternidad|embaraz\w*|parto)\b/.test(v)};
  }
  if(/\bcomo (?:puedo|le hago|hago|se hace|seria|es) (?:para )?(?:cotizar|empezar|iniciar|darme de alta|dar de alta|afiliarme|contratar|inscribirme|el tramite|el proceso)\b|\bcomo me (?:doy|dan|puedo dar) de alta\b|\bcomo (?:se puede|puedo|podria) hacer(?:lo| eso| el tramite)?\b(?! (?:esas |las |mis )?aportaciones)|\bque (?:hay|tengo) que hacer\b|\bcomo (?:es|funciona) el (?:tramite|proceso)\b|\bque (?:tengo|debo) que hacer para (?:empezar|iniciar|afiliarme|darme de alta)\b/.test(v)){
    return {type:'how_to_start',priority:'high',answerKey:'how_to_start'};
  }
  // Preguntas sobre jubilación o pensión: dependen del caso; se responde con honestidad
  // y se ofrece seguir sumando semanas, en vez de un respaldo genérico.
  const pensionWord=/\b(jubil\w*|pension\w*)\b/.test(v);
  const pensionAsk=/\b(puedo|podre|podria|voy a poder|me toca|cuando|cuanto|cuantos|que edad|a que edad|requisitos|ya tengo las semanas|me falta|me faltan|tendria que|tengo que)\b/.test(v);
  if(pensionWord && pensionAsk) return {type:'pension_general',priority:'high',answerKey:'pension_general'};
  // Las preguntas por un plan concreto conservan el contexto del plan.
  // "Ok y por curiosidad el plan 2 cuál sería" (caso real 21-oct: recibió la cobertura del Plan 1).
  if(/\b(?:y\s+)?(?:el\s+)?plan\s*(?:2|dos)\s+(?:cual|como|que)\s+(?:seria|es|sera|incluye|trae)\b|\b(?:como|cual|que)\s+(?:es|seria)\s+el\s+plan\s*(?:2|dos)\b|^(?:y\s+)?(?:el\s+)?plan\s*(?:2|dos)\s*\?/.test(v+(/[?¿]/.test(String(text))?' ?':''))) return {type:'services',priority:'high',answerKey:'services',plan:'plan_2'};
  if(/\b(?:y\s+)?(?:el\s+)?plan\s*(?:1|uno)\s+(?:cual|como|que)\s+(?:seria|es|sera|incluye|trae)\b|\b(?:como|cual|que)\s+(?:es|seria)\s+el\s+plan\s*(?:1|uno)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_1'};
  // "¿Y lo del Infonavit dónde queda?" (caso real 21-oct: recibió la ubicación de la oficina).
  if(/\b(?:lo del|y el|y la|el|la)\s+(?:infonavit|afore)\b.{0,25}\b(?:donde queda|donde entra|como queda|que pasa|no viene|no incluye|no entra|tambien)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_2'};
  // "¿Dónde pagaría?" / "¿cómo se paga?" antes de iniciar (caso real 21-oct, sin respuesta).
  if(/\b(?:donde|como|en donde|por donde|de que forma|en que forma)\s+(?:se\s+)?(?:pagaria|pago|paga|pagaria yo|tengo que pagar|hago el pago|deposito|pagar)\b|\b(?:formas?|metodos?|medios?)\s+de\s+pago\b/.test(v)) return {type:'payment_method',priority:'high',answerKey:'payment_method'};
  // "Me va a cotizar con muy poco" (salario registrado de $480, caso real 21-oct).
  if(/\bcotizar?\w*\s+con\s+(?:muy\s+)?poco\b|\b(?:salario|sueldo)\s+(?:muy\s+)?(?:bajo|poquito|poco)\b|\bcotiza\w*\s+(?:muy\s+)?bajo\b/.test(v)) return {type:'salary_pension',priority:'high',answerKey:'salary_pension'};
  if(/\bbeneficios?\s+(?:del|de el|de|que (?:tiene|da|incluye) el)\s+plan\s*(?:2|dos)\b|\bplan\s*(?:2|dos)\b.{0,15}\bbeneficios?\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_2'};
  if(/\bbeneficios?\s+(?:del|de el|de|que (?:tiene|da|incluye) el)\s+plan\s*(?:1|uno)\b|\bplan\s*(?:1|uno)\b.{0,15}\bbeneficios?\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_1'};
  if(/\bque incluye (?:el )?plan\s*(1|uno)\b|\bplan\s*(?:1|uno)\b.{0,12}\b(?:que (?:me )?incluye|incluye|que trae|que tiene)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_1'};
  if(/\bque incluye (?:el )?plan\s*(2|dos)\b|\bplan\s*(?:2|dos)\b.{0,12}\b(?:que (?:me )?incluye|incluye|que trae|que tiene)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services',plan:'plan_2'};
  // Solo es pregunta de servicios cuando el cliente realmente pregunta por ellos.
  // Menciones declarativas como "me quedo con el Plan 1" o "quiero el Plan 1"
  // pertenecen al commitment-flow y no deben convertirse en catálogo de planes.
  if(/\b(que beneficios|beneficios (?:me |nos )?(?:ofrece|ofrecen|tiene|tienen|incluye|da|dan)|que ofrecen|que incluye|que manejan|cuales? (?:son )?(?:los )?(?:paquetes|planes|servicios)|que (?:paquetes|planes|servicios|plan|paquete) (?:tienen|manejan|ofrecen|hay)|no se que plan(?:es)?|diferencia entre (?:el |los )?plan(?:es)?|que diferencia(?:s)? (?:hay|tienen|tiene)|cual es la diferencia|explicame (?:los )?(?:dos|ambos)|explicar (?:los )?(?:dos|ambos)|(?:los )?dos planes|ambos planes)\b/.test(v)) return {type:'services',priority:'high',answerKey:'services'};
  // ¿El pago es mensual? Va antes que el precio general para responder la frecuencia.
  if(/\b(?:es mensual|son mensuales|pago mensual|mensualmente|cada mes|al mes|por mes|cada cuanto (?:se paga|pago|se cobra|hay que pagar)|un solo pago|pago unico|es anual|se paga una vez)\b/.test(v)) return {type:'payment_frequency',priority:'high',answerKey:'payment_frequency'};
  if(/\b(es gratis|es gratuito|seria gratuito|seria gratis|sin costo|no tiene costo)\b/.test(v)) return {type:'not_free',priority:'high',answerKey:'not_free'};
  if(/\b(tengo que pagar|hay que pagar|se paga|tiene costo|tiene algun costo)\b/.test(v)) return {type:'payment_frequency',priority:'high',answerKey:'payment_frequency'};
  // "¿Te paso mi número de IMSS para que me cotice?" (caso real 20-oct): es el precio; no se necesita el NSS.
  if(/\b(?:me|nos|le)\s+cotic?(?:e|en|es|ce|cen)\b|\buna cotizacion\b|\bcotizarme\b|\bme (?:das|da|pasas|haces|hace) (?:una |la )?cotizacion\b/.test(v)) return {type:'price',priority:'high',answerKey:'price',quote:/\b(?:nss|numero (?:de )?(?:imss|seguro|afiliacion)|curp)\b/.test(v)};
  if(/\bcuanto (?:seria|es|sale)\s+(?:en|de)\s+(?:tiempo|meses|anos|semanas|pension)\b|\bcuanto tiempo\b/.test(v) && !/\b(precio|costo|cuesta|cobran|mensualidad|pagar|pago)\b/.test(v)) return null;
  if(/\b(precio|precios|costos|honorarios|cuanto cuesta|que cuesta|cuanto cobra|cuanto cobran|mensualidad|costo|cuota|tarifa|cuanto sale|cuanto es|cuanto vale|cuanto seria|cuanto pagaria|cuanto pago|cuanto (?:tengo|tendria|hay) que (?:aportar|pagar|dar|depositar))\b/.test(v)) return {type:'price',priority:'high',answerKey:'price'};
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
  if(request.answerKey==='are_you_imss') return 'No, no somos el IMSS. Soy Mia de MARTCOM, una consultoría que realiza tu afiliación ante el IMSS: tu alta queda registrada en el IMSS y, cuando esté vigente, puedes verificarla tú mismo en la app IMSS Digital o en tu clínica.';
  if(request.answerKey==='website') return 'Claro, nuestra página es https://martcom-econtact.mx/ y ahí encuentras nuestros datos de contacto. Además, cuando tu alta esté vigente puedes comprobarla tú mismo directamente con el IMSS, en la app IMSS Digital o en tu clínica.';
  if(request.answerKey==='missing_weeks') return `Las semanas que no te aparecen se aclaran directamente en tu clínica del IMSS, y para hacerlo necesitas estar dado de alta: ya activo con nosotros, acudes a tu clínica a solicitar la aclaración de tus semanas. Mientras tanto, con tu alta sigues sumando semanas nuevas y tienes servicio médico del IMSS.${request.pre1997 ? ' Como empezaste a cotizar antes del 1 de julio de 1997, tu caso se revisa con la Ley 73: necesitas al menos 13 meses de afiliación antes de tramitar tu pensión para reactivar tus derechos.' : ''} ¿Quieres que te explique cómo funciona el Plan 1, de $1,100 MXN mensuales?`;
  if(request.answerKey==='working_no_imss') return 'Sí se puede: aunque trabajes, si tu patrón no te tiene dado de alta en el IMSS, con nosotros puedes afiliarte, tener servicio médico y seguir sumando semanas. El Plan 1 cuesta $1,100 MXN mensuales. ¿Quieres que te explique cómo funciona?';
  if(request.answerKey==='fees') return 'Nuestros honorarios son la mensualidad del plan: $1,100 MXN al mes en el Plan 1 o $1,500 MXN al mes en el Plan 2. No cobramos una cuota de activación aparte, y el primer pago se hace hasta que tu alta esté vigente ante el IMSS. ¿Quieres que iniciemos tu trámite?';
  if(request.answerKey==='missing_docs'){
    const parts=[];
    if(request.noNss) parts.push('si no tienes tu NSS, con tu CURP lo podemos localizar, y si nunca has tenido uno, se puede tramitar uno nuevo');
    if(request.noIne) parts.push('si todavía no tienes tu INE, podemos empezar con tu CURP y la INE la envías cuando la tengas');
    return `No te preocupes: ${parts.join('; ')}. Para iniciar me basta con tu CURP. ¿Quieres que iniciemos tu trámite?`;
  }
  if(request.answerKey==='few_weeks_left'){
    const months=Math.max(1,Math.ceil(request.weeks/4.3));
    return `Con nosotros sumas alrededor de 4 semanas cotizadas por cada mes, así que ${request.weeks} semanas se completan en aproximadamente ${months} ${months===1?'mes':'meses'}.${request.pre1997?' Como empezaste a cotizar antes del 1 de julio de 1997 (Ley 73), además necesitas al menos 13 meses de afiliación antes de tramitar tu pensión para reactivar tus derechos.':' Si empezaste a cotizar antes del 1 de julio de 1997 (Ley 73), además necesitas al menos 13 meses de afiliación antes de tramitar tu pensión.'} El Plan 1 cuesta $1,100 MXN mensuales e incluye servicio médico del IMSS. ¿Quieres que iniciemos tu trámite?`;
  }
  if(request.answerKey==='beneficiary'&&request.employed) return 'Si ya estás cotizando con tu patrón, a tu pareja la registras como beneficiaria directamente en tu clínica del IMSS (en la ventanilla de Afiliación), aunque vivan en unión libre; ese trámite no lo hacemos nosotros. Si más adelante dejas de trabajar, con nosotros puedes seguir cotizando y mantener a tus beneficiarios. ¿Te puedo ayudar en algo más?';
  if(request.answerKey==='beneficiary') return `Sí. Con tu alta con nosotros puedes registrar como beneficiarios a ${request.partner?'tu pareja (aunque vivan en unión libre)':'tu pareja'}, a tus hijos menores de 16 años y a tus padres, sujeto a validación del IMSS. Está incluido desde el Plan 1, de $1,100 MXN mensuales. ¿Quieres que te explique cómo funciona?`;
  if(request.answerKey==='info_free') return 'No, la información no tiene ningún costo: con gusto te resuelvo tus dudas por aquí. Solo pagas la mensualidad del plan si decides afiliarte: el Plan 1 cuesta $1,100 MXN al mes y el Plan 2 $1,500 MXN al mes. ¿Qué te gustaría saber?';
  if(request.answerKey==='plan1_no_afore') return 'Correcto: el Plan 1 ($1,100 MXN mensuales) incluye servicio médico del IMSS y semanas cotizadas, pero no aportaciones a AFORE ni puntos INFONAVIT. Si quieres que también se aporte a tu AFORE, eso lo incluye el Plan 2, de $1,500 MXN mensuales. ¿Cuál te interesa más?';
  if(request.answerKey==='credit_price') return INFONAVIT_CREDIT_PRICE_TEXT;
  if(request.answerKey==='credit_plan2') return INFONAVIT_CREDIT_PLAN2_TEXT;
  if(request.answerKey==='payment_method') return 'El pago es mensual y se hace hasta que tu alta esté vigente: primero te enviamos tu documento de vigencia y después nuestra área de Cobranza te comparte por aquí los datos para pagar por transferencia, depósito u OXXO.';
  if(request.answerKey==='min_weeks') return `Para pensionarte se necesitan como mínimo 500 semanas cotizadas si eres Ley 73 (empezaste a cotizar antes del 1 de julio de 1997) y 800 semanas si eres Ley 97.${request.pre1997?' Como empezaste a cotizar antes de 1997, tu caso es Ley 73: además necesitas al menos 13 meses de afiliación antes de tramitar tu pensión.':''} Con nosotros sigues sumando semanas y tienes servicio médico del IMSS; el Plan 1 cuesta $1,100 MXN mensuales. ¿Quieres que te explique cómo funciona?`;
  if(request.answerKey==='retroactive') return 'No manejamos altas con fecha retroactiva: tu alta cuenta a partir de que se realiza. Lo que sí hacemos es darte de alta ante el IMSS para que tengas servicio médico y sigas sumando semanas desde ahora; el Plan 1 cuesta $1,100 MXN mensuales. ¿Quieres que te explique cómo funciona?';
  if(request.answerKey==='needs_weeks') return 'Te podemos ayudar a seguir sumando las semanas que te faltan: te damos de alta ante el IMSS y sigues cotizando, además con servicio médico. Para revisar tu caso, ¿hace cuánto dejaste de cotizar y, más o menos, en qué año empezaste a cotizar?';
  if(request.answerKey==='daycare') return 'Sí. Con tu alta vigente puedes usar la guardería del IMSS cuando corresponda, y nosotros te proporcionamos la carta patronal que el IMSS pide para el trámite de la guardería. El Plan 1, de $1,100 MXN mensuales, incluye servicio médico del IMSS y guardería. ¿Quieres que te explique cómo funciona?';
  if(request.answerKey==='employed') return 'Mientras trabajes, tu patrón te da el IMSS. Cuando dejes de trabajar, con nosotros puedes seguir cotizando sin perder tu servicio médico. ¿Te gustaría que te explique cómo funciona para cuando lo necesites?';
  if(request.answerKey==='check_weeks') return 'Puedes consultarlo tú mismo en la app IMSS Digital o en la página del IMSS, en la opción "Constancia de Semanas Cotizadas"; solo necesitas tu CURP, tu NSS y un correo electrónico. Ahí ves cuántas semanas tienes reconocidas y si estás dado de alta actualmente. ¿Quieres que te explique cómo podemos ayudarte a seguir sumando semanas?';
  if(request.answerKey==='already_pensioned') return 'Gracias por contarme. Como ya cuentas con una pensión, tu caso necesita una revisión especial para saber qué te conviene y qué permite el IMSS en tu situación. ¿Quieres que te comunique con un asesor para revisarlo?';
  if(request.answerKey==='which_plan'){
    if(request.plan==='plan_2') return 'Por lo que me cuentas, te conviene el Plan 2 ($1,500 MXN mensuales): además del servicio médico del IMSS y tus semanas, suma aportaciones a tu AFORE y puntos para INFONAVIT. ¿Quieres que iniciemos tu trámite?';
    if(request.plan==='plan_1') return 'Por lo que me cuentas, te conviene el Plan 1 ($1,100 MXN mensuales): tienes servicio médico del IMSS y sigues sumando semanas cotizadas. Si además quisieras aportar a AFORE e INFONAVIT, sería el Plan 2. ¿Quieres que iniciemos tu trámite?';
    return 'Depende de lo que buscas: si quieres servicio médico del IMSS y seguir sumando semanas, el Plan 1 ($1,100 MXN mensuales) es suficiente; si además quieres aportar a tu AFORE y sumar puntos para INFONAVIT, te conviene el Plan 2 ($1,500 MXN mensuales). ¿Te interesa también AFORE e INFONAVIT?';
  }
  if(request.answerKey==='modality_40') return 'La Modalidad 40 es un trámite que haces por tu cuenta directamente ante el IMSS para seguir cotizando, y no incluye servicio médico. Lo nuestro es distinto: tu alta se realiza con una empresa, sigues sumando semanas con un salario diario registrado de $480 MXN y además tienes servicio médico del IMSS; el Plan 1 cuesta $1,100 MXN mensuales. Cuál te conviene más depende de tu caso (si empezaste a cotizar antes o después del 1 de julio de 1997, tus semanas y tus salarios registrados). ¿Quieres que te comunique con un asesor para revisarlo?';
  if(request.answerKey==='payment_order') return `Primero va tu alta: con tu CURP, NSS e INE realizamos tu registro y, cuando ya aparece vigente ante el IMSS, te enviamos tu documento de vigencia para que puedas comprobarlo. Después de eso realizas tu primer pago.${request.fixed?' La mensualidad es fija: $1,100 MXN en el Plan 1 o $1,500 MXN en el Plan 2, cada mes.':''} ¿Quieres que iniciemos tu trámite?`;
  if(request.answerKey==='salary_pension') return 'Es una buena pregunta. En ambos planes el salario diario registrado es de $480 MXN y no se puede cambiar. Lo que te da el plan es seguir sumando semanas cotizadas. Cuánto sería tu pensión depende de tu caso: si empezaste a cotizar antes o después del 1 de julio de 1997, cuántas semanas tienes y los salarios registrados en tu historial; por eso no puedo asegurarte un monto. Con tu constancia de semanas cotizadas, un asesor puede revisar cómo te conviene. ¿Quieres que te comunique con un asesor?';
  if(request.answerKey==='registered_salary') return 'Ambos planes manejan un salario diario registrado de $480 MXN.';
  if(request.answerKey==='pension_impact') return 'Seguir cotizando semanas puede ayudarte a continuar construyendo tu historial ante el IMSS, pero no puedo asegurarte que tu pensión aumente solo por contratar la afiliación. El monto de una pensión depende de varios datos de tu historial y régimen. Si tu objetivo es pensión, podemos revisar primero tu caso para orientarte sin prometer un incremento que todavía no conocemos.';
  if(request.answerKey==='case_review') return 'Para empezar a revisar tu caso, compárteme tu NSS si lo tienes a la mano. Si no lo tienes, no te preocupes: con tu CURP podemos localizarlo y continuar sin atrasar la revisión.';
  if(request.answerKey==='case_review_curp') return 'Perfecto, ya tengo tu CURP. Con este dato podemos localizar tu NSS y continuar con la revisión de tu caso. No necesitas volver a enviarme la información anterior.';
  if(request.answerKey==='requirements'&&request.intent) return 'Para iniciar necesitamos CURP, NSS e INE del titular; la Constancia de Situación Fiscal se pide hasta los 3 meses de que ya estés con nosotros. Cuando los tengas a la mano, envíamelos por aquí y arrancamos tu trámite.';
  if(request.answerKey==='requirements') return 'Para iniciar necesitamos CURP, NSS e INE del titular. La Constancia de Situación Fiscal es opcional al inicio y se solicitará a los 3 meses de que ya estés con nosotros. Si todavía estás revisando la opción, no necesitas enviar tus documentos aún.';
  if(request.answerKey==='services' && request.plan==='plan_1') return 'El Plan 1 tiene un costo de $1,100 MXN mensuales e incluye:\n• Servicio médico del IMSS: consultas, medicamentos, estudios clínicos, cirugías, hospitalización, especialidades, maternidad y guardería cuando corresponda.\n• Seguir cotizando semanas con un salario diario registrado de $480 MXN.\n• Registrar como beneficiarios a tu pareja, hijos menores de 16 años y padres, sujeto a validación del IMSS.\nTodo conforme a las reglas del IMSS. ¿Hay algún beneficio en particular que quieras que te explique?';
  if(request.answerKey==='services' && request.plan==='plan_2') return 'El Plan 2 tiene un costo de $1,500 MXN mensuales e incluye todo lo del Plan 1 (servicio médico del IMSS, semanas cotizadas con salario diario registrado de $480 MXN y beneficiarios) y además:\n• Aportaciones a tu AFORE, alternando un mes 5.5% y el siguiente 10%.\n• Puntos para crédito INFONAVIT, conforme a sus reglas (no garantiza la aprobación ni el monto del crédito).\n• Incapacidades conforme a las reglas del IMSS.\n¿Quieres que te explique cómo funcionan las aportaciones a AFORE?';
  if(request.answerKey==='services') return 'Tenemos dos opciones: Plan 1 por $1,100 MXN mensuales, enfocado en servicio médico, semanas cotizadas y beneficiarios; y Plan 2 por $1,500 MXN mensuales, que además contempla AFORE, INFONAVIT e incapacidades conforme al caso. Ambos manejan un salario diario registrado de $480 MXN.';
  if(request.answerKey==='payment_frequency') return 'Sí, el pago es mensual: el Plan 1 cuesta $1,100 MXN al mes y el Plan 2 $1,500 MXN al mes.';
  if(request.answerKey==='price'&&request.quote) return 'No necesito tu número de IMSS para darte el precio: los planes tienen un costo fijo. El Plan 1 cuesta $1,100 MXN mensuales (servicio médico del IMSS y semanas cotizadas) y el Plan 2 $1,500 MXN mensuales (además AFORE, INFONAVIT e incapacidades conforme al caso). Ambos manejan un salario diario registrado de $480 MXN.';
  if(request.answerKey==='payment_duration') return 'El Plan 1 cuesta $1,100 MXN mensuales y el Plan 2 $1,500 MXN mensuales. Se paga mes a mes, sin plazo mínimo ni forzoso: mantienes tu afiliación el tiempo que quieras.';
  if(request.answerKey==='same_company') return 'Tu alta se mantiene con la misma empresa mientras realices tu pago mensual en tiempo y forma, en día hábil; no te cambiamos de empresa cada mes. Además contamos con una empresa de respaldo, y cuando tu alta esté vigente puedes comprobarla tú mismo en la app IMSS Digital o en tu clínica.';
  if(request.answerKey==='price') return 'El Plan 1 tiene un costo de $1,100 MXN mensuales y el Plan 2 de $1,500 MXN mensuales. Ambos manejan un salario diario registrado de $480 MXN; el Plan 2 además contempla AFORE, INFONAVIT e incapacidades conforme al caso.';
  if(request.answerKey==='disability') return `Las incapacidades se contemplan en el Plan 2, de $1,500 MXN mensuales, conforme a las reglas del IMSS y a tu caso. El Plan 1, de $1,100 MXN mensuales, se enfoca en servicio médico y semanas cotizadas.${request.maternity ? " Para la incapacidad por maternidad, el IMSS pide haber cotizado cierto número de semanas antes del parto, así que conviene revisarlo con anticipación." : ""} No manejamos incapacidades permanentes ni por riesgo de trabajo. ¿Quieres que te explique cómo funciona el Plan 2?`;
  if(request.answerKey==='how_to_start') return 'Es sencillo y todo se hace por este medio: eliges tu plan (Plan 1 de $1,100 MXN mensuales o Plan 2 de $1,500 MXN mensuales), nos compartes CURP, NSS e INE del titular y, cuando se confirme tu expediente, realizas tu pago mensual. Con la documentación completa, el alta suele quedar en aproximadamente 48 horas hábiles. ¿Quieres que iniciemos tu trámite?';
  if(request.answerKey==='not_free') return 'El servicio no es gratuito: tiene un costo mensual. El Plan 1 cuesta $1,100 MXN al mes y el Plan 2 $1,500 MXN al mes, e incluyen tu alta ante el IMSS con servicio médico y semanas cotizadas.';
  if(request.answerKey==='location') return 'Nuestra operación está en la Ciudad de México y atendemos a clientes de todo el país. Todo el trámite se hace por este medio, no necesitas acudir a ninguna oficina.';
  if(request.answerKey==='legitimacy') return 'Entiendo la duda. Tu alta queda registrada ante el IMSS con una empresa y, además, contamos con una empresa de respaldo. Cuando tu alta esté vigente puedes comprobarla tú mismo directamente con el IMSS, por ejemplo en la app IMSS Digital o en tu clínica. Mientras tu pago mensual esté al corriente, no deberías tener ningún inconveniente.'+(request.offerAdvisor?' Si prefieres que una persona te atienda y resuelva tus dudas, ¿quieres que te comunique con un asesor?':'');
  if(request.answerKey==='operational_model') return OPERATIONAL_MODEL_ANSWER;
  if(request.answerKey==='modality') return 'Tu alta se realiza con una empresa y, además, contamos con una empresa de respaldo. Con ella cuentas con servicio médico del IMSS una vez que tu alta está vigente y sigues sumando semanas cotizadas. Si necesitas el detalle de la modalidad para un trámite específico, un asesor te lo confirma.';
  if(['pension_general','pension_orientation','pension_min_term'].includes(request.answerKey)){
    const plan2=request.plan==='plan_2';
    const offer=plan2?'el Plan 2, de $1,500 MXN mensuales, que además incluye servicio médico del IMSS y aportaciones a AFORE e INFONAVIT':'el Plan 1, de $1,100 MXN mensuales, que además incluye servicio médico del IMSS';
    const regime=request.pre1997?' Como empezaste a cotizar antes del 1 de julio de 1997, tu caso se revisa con las reglas de la Ley 73: necesitas al menos 13 meses de afiliación antes de tramitar tu pensión para reactivar tus derechos.':'';
    if(request.answerKey==='pension_min_term') return request.pre1997
      ? `Como empezaste a cotizar antes del 1 de julio de 1997, tu caso es Ley 73: necesitas mantener tu afiliación al menos 13 meses antes de tramitar tu pensión, para reactivar tus derechos. Cuánto te falta en semanas y cuánto sería tu pensión depende de tu historial; con tu constancia de semanas cotizadas, un asesor puede revisarlo contigo. ¿Quieres que te comunique con un asesor?`
      : `Si empezaste a cotizar antes del 1 de julio de 1997 (Ley 73), necesitas mantener tu afiliación al menos 13 meses antes de tramitar tu pensión, para reactivar tus derechos. Si empezaste después, depende de tus semanas cotizadas. Con tu constancia de semanas, un asesor puede revisar tu caso. ¿Quieres que te comunique con un asesor?`;
    if(request.answerKey==='pension_orientation') return `Con gusto. Para orientarte bien sobre tu pensión hay que revisar tu historial: cuántas semanas tienes reconocidas, tu edad y cuándo empezaste a cotizar.${regime} Con tu constancia de semanas cotizadas, un asesor puede decirte cuánto te falta y cómo te conviene avanzar. Mientras tanto, con ${offer.split(',')[0]} sigues sumando semanas desde ahora. ¿Quieres que te comunique con un asesor para revisarlo?`;
    // Texto confirmado (15-oct); si el plan ya se explicó no se vuelve a ofrecer explicarlo.
    return `Eso depende de tu caso: principalmente de si empezaste a cotizar antes o después del 1 de julio de 1997, de cuántas semanas tienes reconocidas y de tu edad.${regime} Con tu constancia de semanas cotizadas se puede revisar cuánto te falta. Lo que nosotros hacemos es ayudarte a seguir sumando semanas con ${offer}. ${request.explained?'¿Quieres que te comunique con un asesor para revisar tu caso?':'¿Quieres que te explique cómo funciona?'}`;
  }
  if(request.answerKey==='trust') return 'Entiendo la duda. Nuestra operación está en la Ciudad de México y atendemos a clientes de todo el país; todo el trámite se hace por este medio. Tu alta queda registrada ante el IMSS con una empresa y, además, contamos con una empresa de respaldo. Cuando tu alta esté vigente puedes comprobarla tú mismo directamente con el IMSS, por ejemplo en la app IMSS Digital o en tu clínica.'+(request.offerAdvisor?' Si prefieres que una persona te atienda y resuelva tus dudas, ¿quieres que te comunique con un asesor?':'');
  if(request.answerKey==='b2b') return 'Claro. Si buscas vender u ofrecer nuestras afiliaciones como asesor o proveedor, voy a revisar tu solicitud comercial para darle continuidad.';
  return null;
}

// Preguntas de catálogo ("¿qué planes tienen?", "¿qué ofrecen?", "diferencia entre planes")
// piden ambos planes. "¿Qué incluye?" / "explícame lo que incluye" sin número se refiere
// al plan del que ya se está hablando: antes respondía el catálogo genérico de dos planes
// justo después de que Mia ofreciera explicar el Plan 1.
function asksPlanCatalog(text){
  const v=norm(text);
  return /\b(planes|paquetes|opciones|que ofrecen|que manejan|diferencia|diferencias|cuales son|comparar|compara)\b/.test(v);
}

// Contexto de pensión del cliente: si ya habló de pensión o Mia le ofreció orientarlo.
function pensionContext(memory={}){
  const last=norm(memory?.ultima_respuesta_agente||'');
  return Boolean(memory?.commercial_need?.retirement)||/\b(pension|orientarte|semanas cotizadas)\b/.test(last);
}
// ¿Empezó a cotizar antes del 1 de julio de 1997? ("Trabajé del 86 al 90", "empecé en el 87").
export function startedBefore1997(text=''){
  const v=norm(text);
  // Un año 1950-1996 escrito completo, o abreviado tras "del", "en el", "desde" ("del 86 al 90").
  // "tengo 57 años" no cuenta: es la edad.
  const full=/\b19(?:[5-8]\d|9[0-6])\b/.test(v);
  const short=/\b(?:del|en el|desde el|desde|en)\s+(?:[5-8]\d|9[0-6])\b(?!\s*a(?:n|ñ)os)/.test(v);
  return (full||short)&&/\b(trabaje|cotice|cotize|empece|empeze|inicie|estuve|labore|cotizaba|trabajaba|cotizar|trabajar|alta|afilie|afiliaron|registre|registraron|di de alta|dieron de alta)\b/.test(v);
}

// Enriquecer una pregunta con el contexto del cliente (plan, Ley 73, si ya se le explicó, confianza).
function enrich(direct,text,memory){
  if(!direct) return direct;
  // Crédito INFONAVIT activo: no se ofrece el Plan 2 (22-oct).
  if(memory?.sales_cycle?.infonavit_credit){
    if(['price','payment_frequency','not_free','fees','payment_duration'].includes(direct.answerKey)) return {...direct,type:'credit_price',answerKey:'credit_price'};
    if(['plan_2_contributions','disability','plan1_no_afore'].includes(direct.answerKey)||(direct.answerKey==='services'&&direct.plan==='plan_2')) return {...direct,type:'credit_plan2',answerKey:'credit_plan2'};
    if(direct.answerKey==='services') return {...direct,plan:'plan_1'};
    if(direct.answerKey==='which_plan') return {...direct,plan:'plan_1'};
  }
  if(direct.answerKey==='services'&&!direct.plan&&!asksPlanCatalog(text)){
    const plan=effectivePlan(memory);
    if(plan==='plan_1'||plan==='plan_2') direct={...direct,plan,planFrom:'conversation'};
  }
  if(direct.answerKey==='which_plan'){
    const need=memory?.commercial_need||{};
    const plan=memory?.sales_cycle?.selected_plan||(need.afore_infonavit?'plan_2':(need.service_medical||need.weeks||need.retirement)?'plan_1':null);
    direct={...direct,plan};
  }
  if(['pension_general','pension_orientation','pension_min_term'].includes(direct.answerKey)){
    const plan=effectivePlan(memory)||'plan_1';
    direct={...direct,plan,explained:(memory?.sales_cycle?.explained_plans||[]).includes(plan),pre1997:Boolean(memory?.pension_data?.cotizo_antes_1997)||startedBefore1997(String(text||''))};
  }
  // Vuelve a preguntar el precio justo después de recibirlo ("Sus honorarios", caso real 22-oct): no se repite.
  if(direct.answerKey==='price'&&!direct.quote&&/^El Plan 1 tiene un costo de \$1,100/.test(String(memory?.ultima_respuesta_agente||''))) direct={...direct,type:'fees',answerKey:'fees'};
  if(direct.answerKey==='min_weeks') direct={...direct,pre1997:Boolean(memory?.pension_data?.cotizo_antes_1997)||startedBefore1997(String(text||''))};
  if(direct.answerKey==='few_weeks_left') direct={...direct,pre1997:Boolean(memory?.pension_data?.cotizo_antes_1997)||startedBefore1997(String(text||''))};
  // Ya quiere iniciar ("puedo enviarle papeles mañana", "podemos iniciar el lunes", caso real 21-oct).
  if(direct.answerKey==='requirements'&&/\b(?:envi\w*|mand\w*|pas\w*|busc\w*|iniciar|empezar|comenzar)\b.{0,30}\b(?:papeles|documentos|tramite|lunes|manana)\b|\b(?:papeles|documentos)\b.{0,20}\b(?:manana|luego|despues|al rato)\b/.test(norm(text))) direct={...direct,intent:true};
  if(direct.answerKey==='missing_weeks') direct={...direct,pre1997:Boolean(memory?.pension_data?.cotizo_antes_1997)||startedBefore1997(String(text||''))};
  // Segunda vez que duda de la legitimidad: además de la respuesta, ofrecer un asesor (caso 17-oct).
  if(['legitimacy','trust'].includes(direct.answerKey)&&memory?.sales_cycle?.trust_answered) direct={...direct,offerAdvisor:true};
  return direct;
}

// Varias preguntas en un mensaje ("¿qué incluye el plan 2? / ¿cuánto tengo que aportar? / ¿qué
// garantía tengo?"): se contestan todas, en orden, con una sola pregunta al final.
function multiQuestion(text,memory){
  const parts=String(text||'').split(/\n+|(?<=\?)\s+/).map(p=>p.trim()).filter(p=>p.length>=4);
  if(parts.length<2) return null;
  const seen=new Set(); const answers=[];
  for(const part of parts){
    let d=detectDirectRequest(part);
    if(!d&&/\b(orientame|asesorame)\b/.test(norm(part))) continue;
    d=enrich(d,part,memory);
    const key=d?.answerKey;
    if(!key||seen.has(key)||!FACT_LOCKED_TYPES.has(d.type||key)) continue;
    const answer=directAnswerText(d);
    if(!answer) continue;
    seen.add(key); answers.push(answer);
  }
  if(answers.length<2) return null;
  const strip=a=>a.replace(/\s*[^.!?]*\?\s*$/,'').trim();
  let combined=answers.slice(0,-1).map(strip).concat(answers.at(-1)).join('\n\n');
  while(combined.length>840&&answers.length>2){answers.splice(-2,1);combined=answers.slice(0,-1).map(strip).concat(answers.at(-1)).join('\n\n');}
  if(combined.length>840) return null;
  // Cerrar con un siguiente paso si la última respuesta no trae pregunta.
  if(!/\?\s*$/.test(combined)&&combined.length<790) combined+=' ¿Tienes alguna otra duda o quieres que iniciemos tu trámite?';
  return {type:'multi',priority:'high',answerKey:'multi',combined,parts:[...seen]};
}

export function orchestrateConversation(text,memory={}){
  const multi=multiQuestion(text,memory);
  if(multi) return { directRequest:multi, directAnswer:multi.combined, shouldHandoffB2B:false, label:null, events:[{type:'direct_request_detected',request:{type:'multi',parts:multi.parts}}] };
  let direct=detectDirectRequest(text);
  // "Oriéntame por favor" con contexto de pensión: orientación + asesor (caso real: Silvia, 16-oct).
  if(!direct&&/\b(orientame|orienteme|orientenme|asesorame|asesoreme|ayudame a entender|que me recomiendas|que me recomienda)\b/.test(norm(text))&&pensionContext(memory)){
    direct={type:'pension_orientation',priority:'high',answerKey:'pension_orientation'};
  }
  // "¿Por cuánto tiempo?" / "¿cuántos meses tengo que pagar?" en contexto de pensión (caso Silvia).
  if((!direct||direct.answerKey==='pension_general')&&/\b(?:por cuanto tiempo|cuanto tiempo (?:tengo|tendria|debo|hay) que|cuantos meses (?:tengo|tendria|debo|hay)|tiempo minimo|minimo de (?:meses|tiempo)|cuanto tiempo (?:debo|tengo que) (?:estar|pagar|cotizar|quedarme))\b/.test(norm(text))&&(pensionContext(memory)||/\bpension/.test(norm(text)))){
    direct={type:'pension_min_term',priority:'high',answerKey:'pension_min_term'};
  }
  direct=enrich(direct,text,memory);
  return {
    directRequest:direct,
    directAnswer:directAnswerText(direct),
    shouldHandoffB2B:direct?.type==='b2b',
    label:direct?.type==='b2b'?'proveedor':null,
    events:direct?[{type:'direct_request_detected',request:direct}]:[]
  };
}
