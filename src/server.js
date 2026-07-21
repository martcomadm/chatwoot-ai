import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { MARTCOM_KNOWLEDGE } from "./knowledge.js";
import { MemoryStore } from "./memory-store.js";

const need=["CHATWOOT_BASE_URL","CHATWOOT_ACCOUNT_ID","CHATWOOT_INBOX_ID","CHATWOOT_AI_AGENT_ID","CHATWOOT_ACCESS_TOKEN","OPENAI_API_KEY","OPENAI_MODEL"];
for(const k of need){if(!process.env[k]){console.error(`Falta ${k}`);process.exit(1);}}

const cfg={
  port:Number(process.env.PORT||3000),
  base:process.env.CHATWOOT_BASE_URL.replace(/\/+$/,""),
  account:Number(process.env.CHATWOOT_ACCOUNT_ID),
  inbox:Number(process.env.CHATWOOT_INBOX_ID),
  agent:Number(process.env.CHATWOOT_AI_AGENT_ID),
  token:process.env.CHATWOOT_ACCESS_TOKEN,
  model:process.env.OPENAI_MODEL,
  timezone:process.env.AI_TIMEZONE||"America/Mexico_City",
  start:Number(process.env.AI_START_HOUR||7),
  end:Number(process.env.AI_END_HOUR||22),
  maxHistory:Number(process.env.AI_MAX_HISTORY_MESSAGES||40),
  delay:Number(process.env.AI_RESPONSE_DELAY_SECONDS||4),
  maxReply:Number(process.env.AI_MAX_REPLY_CHARS||850),
  assigned:process.env.AI_ASSIGNED_LABEL||"asignado",
  unattended:process.env.AI_UNATTENDED_LABEL||"sin_atender",
  validation:process.env.AI_VALIDATION_LABEL||"validacion",
  memoryFile:process.env.MEMORY_FILE||"/app/data/conversation-memory.json",
  secret:process.env.WEBHOOK_SECRET||""
};

const allowed=new Set(["asignado","cerrado","chat_basura","cliente","embarazo","no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado","seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const stop=new Set(["cerrado","chat_basura","no_quiere_el_servicio","rechazado","venta","validacion"]);
const protectedLabels=new Set(["asignado","predictivo","reasignado","cliente","venta"]);
const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const memories=new MemoryStore(cfg.memoryFile);
const locks=new Set();
const app=express();
app.use(express.json({limit:"4mb"}));

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arrays=(a=[],b=[],max=50)=>[...new Set([...(a||[]),...(b||[])])].slice(-max);

function localHour(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:cfg.timezone,hour:"2-digit",hour12:false}).formatToParts(new Date());
  return Number(parts.find(x=>x.type==="hour")?.value||0);
}
const inSchedule=()=>localHour()>=cfg.start&&localHour()<cfg.end;
const messageOf=p=>p?.message||p;
const conversationIdOf=p=>Number(p?.conversation?.id??p?.message?.conversation_id??p?.conversation_id??p?.id);
const inboxIdOf=p=>Number(p?.conversation?.inbox_id??p?.conversation?.inbox?.id??p?.inbox?.id??p?.message?.inbox_id);
const incoming=m=>m?.message_type==="incoming"||m?.message_type===0;
const contact=m=>{const t=String(m?.sender_type||m?.sender?.type||"").toLowerCase();return !t||t==="contact";};
const attachments=m=>Array.isArray(m?.attachments)&&m.attachments.length>0;

function handoffReason(content=""){
  const text=String(content).trim(), lower=text.toLowerCase();
  if(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i.test(text)) return "El cliente proporcionó una CURP.";
  if(/\b\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{5}\b/.test(text)) return "El cliente proporcionó un NSS.";
  const human=["quiero hablar con un asesor","quiero hablar con una persona","comuníqueme con un asesor","comuniqueme con un asesor","pueden llamarme","puede llamarme","quiero una llamada","háblenme","hablenme"];
  if(human.some(x=>lower.includes(x))) return "El cliente solicitó atención directa de un asesor.";
  const paid=["ya hice el pago","ya realicé el pago","ya realice el pago","ya pagué","ya pague","te envío el comprobante","te envio el comprobante","adjunto el comprobante"];
  if(paid.some(x=>lower.includes(x))) return "El cliente reportó un pago o comprobante.";
  return null;
}

async function cw(path,options={}){
  const res=await fetch(cfg.base+path,{...options,headers:{"Content-Type":"application/json",api_access_token:cfg.token,...(options.headers||{})}});
  const text=await res.text(); let data=null;
  try{data=text?JSON.parse(text):null;}catch{data=text;}
  if(!res.ok) throw new Error(`Chatwoot ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
const getConversation=id=>cw(`/api/v1/accounts/${cfg.account}/conversations/${id}`);
async function getLabels(id){
  const d=await cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/labels`);
  return Array.isArray(d?.payload)?d.payload:[];
}
async function setLabels(id,labels){
  const clean=[...new Set(labels)].filter(x=>allowed.has(x));
  return cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/labels`,{method:"POST",body:JSON.stringify({labels:clean})});
}
async function mergeLabels(id,add=[],remove=[]){
  const current=await getLabels(id), next=new Set(current.filter(x=>allowed.has(x)));
  for(const x of remove) if(!protectedLabels.has(x)) next.delete(x);
  for(const x of add) if(allowed.has(x)) next.add(x);
  if([...next].sort().join("|")!==[...current].sort().join("|")) await setLabels(id,[...next]);
  return [...next];
}
const sendMessage=(id,content,priv=false)=>cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/messages`,{method:"POST",body:JSON.stringify({content,message_type:"outgoing",private:priv})});

function messagesOf(c){
  for(const x of [c?.messages,c?.payload?.messages,c?.conversation?.messages]) if(Array.isArray(x)) return x;
  return [];
}
function historyOf(c){
  return messagesOf(c).filter(m=>!m.private&&m.content).slice(-cfg.maxHistory).map(m=>`${incoming(m)?"CLIENTE":"AGENTE"}: ${String(m.content).trim()}`).join("\n");
}
function lastIncoming(c){
  const ms=messagesOf(c);
  for(let i=ms.length-1;i>=0;i--){const m=ms[i];if(m&&incoming(m)&&!m.private&&contact(m)) return m;}
  return null;
}
function jsonFrom(text){
  const s=String(text||"").replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```$/i,"").trim();
  try{return JSON.parse(s);}catch{
    const a=s.indexOf("{"),b=s.lastIndexOf("}");
    if(a>=0&&b>a)return JSON.parse(s.slice(a,b+1));
    throw new Error("OpenAI no devolvió JSON válido");
  }
}
function mergeMemory(current,patch){
  const next={...current};
  for(const k of ["nombre","edad","actividad","tipo_trabajo","tiene_imss","ultima_cotizacion","necesidad_principal","afore_actual"]){
    const v=patch?.[k]; if(v!==null&&v!==undefined&&v!=="") next[k]=v;
  }
  for(const k of ["pregunta_cambio_afore","curp_recibida","nss_recibido"]){
    if(typeof patch?.[k]==="boolean") next[k]=Boolean(current[k]||patch[k]);
  }
  next.necesidades=arrays(current.necesidades,patch?.necesidades);
  next.documentos_recibidos=arrays(current.documentos_recibidos,patch?.documentos_recibidos);
  next.contradicciones=arrays(current.contradicciones,patch?.contradicciones);
  return next;
}

async function extractMemoryUpdate(conversation,current,newMessage){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`Actualiza memoria persistente de un cliente MARTCOM. No borres datos confirmados ni inventes.
Devuelve solo JSON:
{"nombre":null,"edad":null,"actividad":null,"tipo_trabajo":null,"tiene_imss":null,"ultima_cotizacion":null,"necesidad_principal":null,"necesidades":[],"afore_actual":null,"pregunta_cambio_afore":false,"curp_recibida":false,"nss_recibido":false,"documentos_recibidos":[],"contradicciones":[]}
CURP nunca es nombre. NSS nunca es nombre. tiene_imss solo true, false o null.
Si dice "no tengo IMSS", usa false. Si dice "desempleado", actividad="desempleado".
Si dice "servicio médico", necesidad_principal="servicio_medico".
Si contradice un dato previo, conserva el previo y agrega contradicción.
No tomes mensajes automáticos de entrada como datos confirmados.`,
    input:`MEMORIA PREVIA:\n${JSON.stringify(current,null,2)}\n\nMENSAJE NUEVO:\n${String(newMessage?.content||"")}\n\nHISTORIAL:\n${historyOf(conversation)}`
  });
  return jsonFrom(response.output_text);
}

async function generateDecision(conversation,labels,memory){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`${MARTCOM_KNOWLEDGE}

MEMORIA PERSISTENTE:
${JSON.stringify(memory,null,2)}

Devuelve solo JSON:
{"reply":"mensaje breve","question_key":"nombre|edad|actividad|tiene_imss|ultima_cotizacion|necesidad_principal|curp|nss|aclarar_contradiccion|null","add_labels":[],"remove_labels":[],"handoff":false,"handoff_reason":""}

Máximo ${cfg.maxReply} caracteres.
No agregues cliente, venta, cerrado ni no_contesta.
No elimines asignado, predictivo, reasignado, cliente ni venta.
Haz una sola pregunta principal.
No preguntes datos confirmados en memoria.
Si todos los datos principales están confirmados y hay interés, solicita CURP.
No repitas ni resumas los datos confirmados salvo que sea necesario para aclarar algo.
Evita frases como "tengo anotado", "confirmo", "ya registré", "veo que" o "entiendo que".
No uses el nombre del cliente en todos los mensajes.
Responde como un asesor humano: breve, directo y natural.
Antes de devolver el JSON revisa que reply no suene como formulario ni repita la memoria.`,
    input:`ETIQUETAS:\n${labels.join(", ")||"ninguna"}\n\nHISTORIAL:\n${historyOf(conversation)}`
  });
  return jsonFrom(response.output_text);
}

function answered(memory,key){
  const map={
    nombre:memory.nombre,edad:memory.edad,actividad:memory.actividad,
    tiene_imss:memory.tiene_imss,ultima_cotizacion:memory.ultima_cotizacion,
    necesidad_principal:memory.necesidad_principal,curp:memory.curp_recibida,nss:memory.nss_recibido
  };
  return key in map&&map[key]!==null&&map[key]!==""&&map[key]!==false;
}

async function fallbackDecision(conversation,memory,rejected){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`${MARTCOM_KNOWLEDGE}
La respuesta anterior repitió "${rejected}", dato ya confirmado.
Usa esta memoria:
${JSON.stringify(memory,null,2)}
Devuelve solo JSON:
{"reply":"mensaje breve","question_key":"otro_dato_pendiente_o_null","add_labels":[],"remove_labels":[],"handoff":false,"handoff_reason":""}
No repitas preguntas ya respondidas.
No recites la memoria ni confirmes nuevamente datos conocidos.
Evita "tengo anotado", "confirmo", "ya registré" y frases similares.
La respuesta debe sonar humana, breve y natural.`,
    input:`HISTORIAL:\n${historyOf(conversation)}`
  });
  return jsonFrom(response.output_text);
}

async function handoffSummary(conversation,reason,memory){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`Genera nota privada breve. Usa memoria como fuente principal. No inventes ni confundas CURP/NSS con nombre.
Formato:
AXEL IA - RESUMEN
Nombre:
Edad:
Actividad:
Necesidad:
IMSS actual:
Última cotización:
AFORE:
CURP recibida:
NSS recibido:
Documentos:
Contradicciones:
Motivo de transferencia:
Si falta un dato escribe "No informado".`,
    input:`MOTIVO:\n${reason}\n\nMEMORIA:\n${JSON.stringify(memory,null,2)}\n\nHISTORIAL:\n${historyOf(conversation)}`
  });
  return response.output_text.trim().slice(0,1800);
}

async function transfer(id,conversation,reason,memory){
  await mergeLabels(id,[cfg.validation],[]);
  await sendMessage(id,"Perfecto, ya recibí la información. Un asesor revisará personalmente su caso para darle una orientación precisa. En unos momentos continuará la atención.");
  let summary;
  try{summary=await handoffSummary(conversation,reason,memory);}
  catch{summary=`AXEL IA - RESUMEN\nMotivo de transferencia: ${reason}\nRevisar historial completo.`;}
  await sendMessage(id,summary,true);
}

async function processMessage({conversationId,message,source}){
  const messageId=String(message?.id||"");
  if(!conversationId||!messageId)return;
  if(memories.hasProcessed(conversationId,messageId)){console.log(`Mensaje ${messageId} ya procesado`);return;}
  if(locks.has(conversationId)){console.log(`Conversación ${conversationId} en proceso`);return;}
  if(!inSchedule()){console.log(`Fuera de horario. Conversación ${conversationId}`);return;}

  locks.add(conversationId);
  try{
    await sleep(cfg.delay*1000);
    const conversation=await getConversation(conversationId);
    const inbox=Number(conversation?.inbox_id||conversation?.inbox?.id);
    const agent=Number(conversation?.meta?.assignee?.id||conversation?.assignee?.id);
    const status=String(conversation?.status||"").toLowerCase();
    if(inbox!==cfg.inbox)return;
    if(agent!==cfg.agent){console.log(`Ignorada ${conversationId}: agente ${agent}`);return;}
    if(["resolved","closed"].includes(status))return;

    let labels=await mergeLabels(conversationId,[cfg.assigned],[cfg.unattended]);
    if(labels.some(x=>stop.has(x))){console.log(`Ignorada ${conversationId}: etiqueta de detención`);return;}

    let memory=memories.get(conversationId);
    const patch=await extractMemoryUpdate(conversation,memory,message);
    memory=mergeMemory(memory,patch);

    if(attachments(message)){
      memory.documentos_recibidos=arrays(memory.documentos_recibidos,message.attachments.map(a=>a?.file_type||a?.extension||"archivo"));
    }

    await memories.set(conversationId,memory);
    await memories.markProcessed(conversationId,messageId);
    memory=memories.get(conversationId);

    const reason=attachments(message)?"El cliente envió uno o más archivos o documentos.":handoffReason(message?.content||"");
    if(reason){
      await transfer(conversationId,conversation,reason,memory);
      console.log(JSON.stringify({event:"handoff",source,conversationId,messageId,reason,memory}));
      return;
    }

    let decision=await generateDecision(conversation,labels,memory);
    if(decision.question_key&&answered(memory,decision.question_key)){
      console.log(`Pregunta repetida bloqueada ${conversationId}: ${decision.question_key}`);
      decision=await fallbackDecision(conversation,memory,decision.question_key);
    }

    decision.reply=String(decision.reply||"").trim().slice(0,cfg.maxReply);
    decision.add_labels=Array.isArray(decision.add_labels)?decision.add_labels.filter(x=>allowed.has(x)&&!["cliente","venta","cerrado","no_contesta"].includes(x)):[];
    decision.remove_labels=Array.isArray(decision.remove_labels)?decision.remove_labels.filter(x=>allowed.has(x)&&!protectedLabels.has(x)):[];
    labels=await mergeLabels(conversationId,decision.add_labels,decision.remove_labels);

    if(decision.handoff){
      await transfer(conversationId,conversation,decision.handoff_reason||"El caso requiere revisión humana.",memory);
    }else if(decision.reply){
      await sendMessage(conversationId,decision.reply);
      const questions=decision.question_key?arrays(memory.preguntas_realizadas,[decision.question_key],100):memory.preguntas_realizadas;
      await memories.merge(conversationId,{preguntas_realizadas:questions,ultima_pregunta:decision.question_key||null,ultima_respuesta_agente:decision.reply});
    }

    console.log(JSON.stringify({event:"processed",source,conversationId,messageId,labels,handoff:Boolean(decision.handoff),memory:memories.get(conversationId)}));
  }catch(error){
    console.error(`Error en conversación ${conversationId}:`,error);
  }finally{locks.delete(conversationId);}
}

async function processIncoming(payload){
  const message=messageOf(payload), id=conversationIdOf(payload), inbox=inboxIdOf(payload);
  if(!message?.id||!id||inbox!==cfg.inbox)return;
  if(!incoming(message)||message?.private===true||!contact(message))return;
  await processMessage({conversationId:id,message,source:"message_created"});
}

async function processConversationUpdate(payload){
  const id=conversationIdOf(payload);
  if(!id)return;
  try{
    const conversation=await getConversation(id);
    const inbox=Number(conversation?.inbox_id||conversation?.inbox?.id);
    const agent=Number(conversation?.meta?.assignee?.id||conversation?.assignee?.id);
    if(inbox!==cfg.inbox||agent!==cfg.agent)return;

    const labels=await mergeLabels(id,[cfg.assigned],[cfg.unattended]);
    console.log(`Conversación ${id} recibida por AXEL IA.`);
    if(labels.some(x=>stop.has(x))){console.log(`Conversación ${id} detenida por etiqueta`);return;}

    const message=lastIncoming(conversation);
    if(!message){console.log(`Conversación ${id} sin mensaje entrante`);return;}
    await processMessage({conversationId:id,message,source:"conversation_updated"});
  }catch(error){console.error(`Error asignación ${id}:`,error);}
}

app.get("/",(_req,res)=>res.json({
  service:"martcom-chatwoot-ai",version:"2.4.1",status:"ok",
  memory_file:cfg.memoryFile,
  schedule:`${cfg.start}:00-${cfg.end}:00 ${cfg.timezone}`,
  inbox_id:cfg.inbox,agent_id:cfg.agent
}));

app.get("/health",(_req,res)=>res.json({
  status:"ok",version:"2.4.1",timestamp:new Date().toISOString()
}));

app.get("/memory/:conversationId",(req,res)=>{
  const id=Number(req.params.conversationId);
  if(!id)return res.status(400).json({error:"conversation_id inválido"});
  res.json(memories.get(id));
});

app.delete("/memory/:conversationId",async(req,res)=>{
  if(cfg.secret&&req.query.secret!==cfg.secret)return res.status(401).json({error:"unauthorized"});
  const id=Number(req.params.conversationId);
  if(!id)return res.status(400).json({error:"conversation_id inválido"});
  await memories.clear(id);
  res.json({deleted:true,conversationId:id});
});

app.post("/webhook/chatwoot",(req,res)=>{
  if(cfg.secret&&req.query.secret!==cfg.secret)return res.status(401).json({error:"unauthorized"});
  res.status(200).json({received:true});
  const event=String(req.body?.event||"");
  if(event==="message_created")void processIncoming(req.body);
  else if(event==="conversation_updated")void processConversationUpdate(req.body);
});

app.listen(cfg.port,"0.0.0.0",()=>{
  console.log(`AXEL IA V2.4.1 escuchando en puerto ${cfg.port}`);
  console.log(`Memoria persistente: ${cfg.memoryFile}`);
});
