import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { MARTCOM_KNOWLEDGE } from "./knowledge.js";
import { MemoryStore } from "./memory-store.js";
import { extractFast, containsCurp, containsNss } from "./fast-extractor.js";
import { analyzeSales, planNext, answered } from "./sales-engine.js";
import { checkReply } from "./quality-checker.js";

const required=["CHATWOOT_BASE_URL","CHATWOOT_ACCOUNT_ID","CHATWOOT_INBOX_ID","CHATWOOT_AI_AGENT_ID","CHATWOOT_ACCESS_TOKEN","OPENAI_API_KEY","OPENAI_MODEL"];
for(const key of required){if(!process.env[key]){console.error(`Falta ${key}`);process.exit(1);}}

const cfg={
  port:Number(process.env.PORT||3000),
  base:process.env.CHATWOOT_BASE_URL.replace(/\/+$/, ""),
  account:Number(process.env.CHATWOOT_ACCOUNT_ID),
  inbox:Number(process.env.CHATWOOT_INBOX_ID),
  agent:Number(process.env.CHATWOOT_AI_AGENT_ID),
  token:process.env.CHATWOOT_ACCESS_TOKEN,
  model:process.env.OPENAI_MODEL,
  timezone:process.env.AI_TIMEZONE||"America/Mexico_City",
  start:Number(process.env.AI_START_HOUR||7),
  end:Number(process.env.AI_END_HOUR||22),
  maxHistory:Number(process.env.AI_MAX_HISTORY_MESSAGES||50),
  bufferMs:Number(process.env.AI_MESSAGE_BUFFER_MS||3000),
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
const app=express();
const queue=new Map();
app.use(express.json({limit:"4mb"}));

const arrays=(a=[],b=[],max=100)=>[...new Set([...(a||[]),...(b||[])])].slice(-max);
const messageOf=payload=>payload?.message||payload;
const conversationIdOf=payload=>Number(payload?.conversation?.id??payload?.message?.conversation_id??payload?.conversation_id??payload?.id);
const inboxIdOf=payload=>Number(payload?.conversation?.inbox_id??payload?.conversation?.inbox?.id??payload?.inbox?.id??payload?.message?.inbox_id);
const incoming=message=>message?.message_type==="incoming"||message?.message_type===0;
const contact=message=>{const type=String(message?.sender_type||message?.sender?.type||"").toLowerCase();return !type||type==="contact";};
const hasAttachments=message=>Array.isArray(message?.attachments)&&message.attachments.length>0;

function localHour(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:cfg.timezone,hour:"2-digit",hour12:false}).formatToParts(new Date());
  return Number(parts.find(part=>part.type==="hour")?.value||0);
}
const inSchedule=()=>localHour()>=cfg.start&&localHour()<cfg.end;

async function cw(path,options={}){
  const response=await fetch(cfg.base+path,{...options,headers:{"Content-Type":"application/json",api_access_token:cfg.token,...(options.headers||{})}});
  const text=await response.text();
  let data=null;
  try{data=text?JSON.parse(text):null;}catch{data=text;}
  if(!response.ok) throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const getConversation=id=>cw(`/api/v1/accounts/${cfg.account}/conversations/${id}`);
async function getLabels(id){const data=await cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/labels`);return Array.isArray(data?.payload)?data.payload:[];}
async function setLabels(id,labels){const clean=[...new Set(labels)].filter(label=>allowed.has(label));return cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/labels`,{method:"POST",body:JSON.stringify({labels:clean})});}
async function mergeLabels(id,add=[],remove=[]){
  const current=await getLabels(id),next=new Set(current.filter(label=>allowed.has(label)));
  for(const label of remove) if(!protectedLabels.has(label)) next.delete(label);
  for(const label of add) if(allowed.has(label)) next.add(label);
  if([...next].sort().join("|")!==[...current].sort().join("|")) await setLabels(id,[...next]);
  return [...next];
}
const sendMessage=(id,content,priv=false)=>cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/messages`,{method:"POST",body:JSON.stringify({content,message_type:"outgoing",private:priv})});

function messagesOf(conversation){
  for(const candidate of [conversation?.messages,conversation?.payload?.messages,conversation?.conversation?.messages]) if(Array.isArray(candidate)) return candidate;
  return [];
}
function historyOf(conversation){
  return messagesOf(conversation).filter(message=>!message.private&&message.content).slice(-cfg.maxHistory).map(message=>`${incoming(message)?"CLIENTE":"AGENTE"}: ${String(message.content).trim()}`).join("\n");
}
function jsonFrom(text){
  const source=String(text||"").replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```$/i,"").trim();
  try{return JSON.parse(source);}catch{
    const start=source.indexOf("{"),end=source.lastIndexOf("}");
    if(start>=0&&end>start) return JSON.parse(source.slice(start,end+1));
    throw new Error("OpenAI no devolvió JSON válido");
  }
}

function mergeMemory(current,...patches){
  const next=structuredClone(current);
  for(const patch of patches){
    if(!patch) continue;
    for(const key of ["nombre","primer_nombre","edad","actividad","tipo_trabajo","tiene_imss","ultima_cotizacion","necesidad_principal","afore_actual"]){
      const value=patch[key];if(value!==null&&value!==undefined&&value!=="") next[key]=value;
    }
    for(const key of ["pregunta_cambio_afore","curp_recibida","nss_recibido"]){if(typeof patch[key]==="boolean") next[key]=Boolean(next[key]||patch[key]);}
    next.necesidades=arrays(next.necesidades,patch.necesidades);
    next.documentos_recibidos=arrays(next.documentos_recibidos,patch.documentos_recibidos);
    next.contradicciones=arrays(next.contradicciones,patch.contradicciones);
    next.intereses={...(next.intereses||{}),...(patch.intereses||{})};
    next.contexto_laboral={...(next.contexto_laboral||{}),...(patch.contexto_laboral||{})};
  }
  if(next.nombre&&!next.primer_nombre) next.primer_nombre=String(next.nombre).split(/\s+/)[0];
  return next;
}

async function extractAmbiguous(memory,combinedText,conversation){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`Extrae únicamente datos explícitos o claramente inferibles del cliente MARTCOM. No borres ni inventes datos. Devuelve solo JSON:
{"nombre":null,"primer_nombre":null,"edad":null,"actividad":null,"tipo_trabajo":null,"tiene_imss":null,"ultima_cotizacion":null,"necesidad_principal":null,"necesidades":[],"afore_actual":null,"pregunta_cambio_afore":false,"curp_recibida":false,"nss_recibido":false,"contradicciones":[],"intereses":{},"contexto_laboral":{}}
Reglas: CURP y NSS nunca son nombres. Un nombre completo escrito solo sí debe extraerse. “Contaba por empleo” significa que cotizó antes, no que tenga IMSS actualmente. “No me ponen seguro” significa tiene_imss=false y empleador_no_afilia=true. IMSS + INFONAVIT o AFORE apunta a plan_2. Conserva el dato previo si hay contradicción y agrega una descripción breve en contradicciones.`,
    input:`MEMORIA PREVIA:\n${JSON.stringify(memory,null,2)}\n\nMENSAJES AGRUPADOS:\n${combinedText}\n\nHISTORIAL:\n${historyOf(conversation)}`
  });
  return jsonFrom(response.output_text);
}

function handoffReason(messages,combinedText){
  if(messages.some(hasAttachments)) return "El cliente envió uno o más archivos o documentos.";
  if(containsCurp(combinedText)) return "El cliente proporcionó una CURP.";
  if(containsNss(combinedText)) return "El cliente proporcionó un NSS.";
  const lower=combinedText.toLowerCase();
  const human=["quiero hablar con un asesor","quiero hablar con una persona","comuníqueme con un asesor","comuniqueme con un asesor","pueden llamarme","puede llamarme","quiero una llamada","háblenme","hablenme"];
  if(human.some(value=>lower.includes(value))) return "El cliente solicitó atención directa de un asesor.";
  const paid=["ya hice el pago","ya realicé el pago","ya realice el pago","ya pagué","ya pague","te envío el comprobante","te envio el comprobante","adjunto el comprobante"];
  if(paid.some(value=>lower.includes(value))) return "El cliente reportó un pago o comprobante.";
  return null;
}

async function generateDecision(conversation,labels,memory,planner,combinedText){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`${MARTCOM_KNOWLEDGE}

MEMORIA PERSISTENTE:
${JSON.stringify(memory,null,2)}

DECISIÓN DEL MOTOR COMERCIAL:
${JSON.stringify(planner,null,2)}

Devuelve solo JSON:
{"reply":"mensaje breve","question_key":"nombre|edad|actividad|tiene_imss|ultima_cotizacion|necesidad_principal|curp|nss|aclarar_contradiccion|null","add_labels":[],"remove_labels":[],"handoff":false,"handoff_reason":""}

Obedece la acción del motor comercial. Máximo ${cfg.maxReply} caracteres. Haz una sola pregunta. No agregues cliente, venta, cerrado ni no_contesta. No repitas datos conocidos. Antes de responder, considera todos los mensajes agrupados como un solo turno.`,
    input:`MENSAJES NUEVOS AGRUPADOS:\n${combinedText}\n\nETIQUETAS:\n${labels.join(", ")||"ninguna"}\n\nHISTORIAL:\n${historyOf(conversation)}`
  });
  return jsonFrom(response.output_text);
}

async function repairDecision(conversation,memory,planner,combinedText,decision,reasons){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`${MARTCOM_KNOWLEDGE}
Reescribe la respuesta porque falló el control de calidad: ${reasons.join(", ")}.
Obedece el siguiente paso: ${JSON.stringify(planner)}.
Memoria: ${JSON.stringify(memory)}.
Devuelve solo JSON con el mismo esquema:
{"reply":"mensaje breve","question_key":"nombre|edad|actividad|tiene_imss|ultima_cotizacion|necesidad_principal|curp|nss|aclarar_contradiccion|null","add_labels":[],"remove_labels":[],"handoff":false,"handoff_reason":""}
Una sola pregunta, sin recitar la memoria y sin frases de formulario.`,
    input:`MENSAJES AGRUPADOS:\n${combinedText}\n\nRESPUESTA RECHAZADA:\n${JSON.stringify(decision)}\n\nHISTORIAL:\n${historyOf(conversation)}`
  });
  return jsonFrom(response.output_text);
}

async function handoffSummary(conversation,reason,memory){
  const response=await openai.responses.create({
    model:cfg.model,
    instructions:`Genera una nota privada breve para el asesor. No inventes datos. Formato:
AXEL IA - RESUMEN
Nombre:
Edad:
Actividad:
Necesidad:
Plan probable:
IMSS actual:
Situación laboral:
AFORE actual:
CURP recibida:
NSS recibido:
Documentos:
Contradicciones:
Motivo de transferencia:
Si falta algo escribe “No informado”.`,
    input:`MOTIVO:\n${reason}\n\nMEMORIA:\n${JSON.stringify(memory,null,2)}\n\nHISTORIAL:\n${historyOf(conversation)}`
  });
  return response.output_text.trim().slice(0,1800);
}

async function transfer(id,conversation,reason,memory){
  await mergeLabels(id,[cfg.validation],[]);
  await sendMessage(id,"Perfecto, ya recibí la información. Un asesor revisará personalmente su caso para darle una orientación precisa. En unos momentos continuará la atención.");
  let summary;
  try{summary=await handoffSummary(conversation,reason,memory);}catch{summary=`AXEL IA - RESUMEN\nMotivo de transferencia: ${reason}\nRevisar historial completo.`;}
  await sendMessage(id,summary,true);
}

function queueState(id){
  if(!queue.has(id)) queue.set(id,{ids:new Set(),sources:new Set(),timer:null,processing:false,dirty:false});
  return queue.get(id);
}
function enqueue(id,messageId,source){
  const state=queueState(id);
  if(messageId) state.ids.add(String(messageId));
  state.sources.add(source);
  if(state.processing){state.dirty=true;return;}
  if(state.timer) clearTimeout(state.timer);
  state.timer=setTimeout(()=>void processQueued(id),cfg.bufferMs);
}

async function processQueued(conversationId){
  const state=queueState(conversationId);
  if(state.processing){state.dirty=true;return;}
  state.processing=true;state.timer=null;
  const requestedIds=[...state.ids];state.ids.clear();
  const sources=[...state.sources];state.sources.clear();state.dirty=false;
  try{
    if(!inSchedule()){console.log(`Fuera de horario. Conversación ${conversationId}`);return;}
    const conversation=await getConversation(conversationId);
    const inbox=Number(conversation?.inbox_id||conversation?.inbox?.id);
    const agent=Number(conversation?.meta?.assignee?.id||conversation?.assignee?.id);
    const status=String(conversation?.status||"").toLowerCase();
    if(inbox!==cfg.inbox||agent!==cfg.agent||["resolved","closed"].includes(status)) return;

    let labels=await mergeLabels(conversationId,[cfg.assigned],[cfg.unattended]);
    if(labels.some(label=>stop.has(label))) return;

    const allMessages=messagesOf(conversation);
    const requested=new Set(requestedIds);
    let batch=allMessages.filter(message=>message?.id&&requested.has(String(message.id))&&incoming(message)&&!message.private&&contact(message));
    if(!batch.length){
      for(let i=allMessages.length-1;i>=0;i--){const message=allMessages[i];if(message&&incoming(message)&&!message.private&&contact(message)){batch=[message];break;}}
    }
    batch=batch.filter(message=>!memories.hasProcessed(conversationId,message.id));
    if(!batch.length) return;
    batch.sort((a,b)=>Number(a.created_at||0)-Number(b.created_at||0));
    const combinedText=batch.map(message=>String(message.content||"").trim()).filter(Boolean).join("\n");
    const messageIds=batch.map(message=>String(message.id));

    let memory=memories.get(conversationId);
    const fastPatch=extractFast(combinedText,memory);
    const llmPatch=await extractAmbiguous(memory,combinedText,conversation);
    memory=mergeMemory(memory,llmPatch,fastPatch);
    for(const message of batch){
      if(hasAttachments(message)) memory.documentos_recibidos=arrays(memory.documentos_recibidos,message.attachments.map(item=>item?.file_type||item?.extension||"archivo"));
    }
    const sales=analyzeSales(memory);
    const planner=planNext({...memory,ventas:sales});
    memory.ventas=sales;
    memory.flujo={fase:planner.action==="solicitar_curp"?"cotizacion":planner.action==="transferir"?"transferencia":"diagnostico",siguiente_paso:planner.question_key};
    await memories.set(conversationId,memory);
    await memories.markProcessedMany(conversationId,messageIds);
    memory=memories.get(conversationId);

    const reason=handoffReason(batch,combinedText);
    if(reason){
      await transfer(conversationId,conversation,reason,memory);
      console.log(JSON.stringify({event:"handoff",version:"2.5.0",conversationId,messageIds,reason,sources,memory}));
      return;
    }

    let decision=await generateDecision(conversation,labels,memory,planner,combinedText);
    if(decision.question_key&&answered(memory,decision.question_key)){
      decision={...decision,question_key:planner.question_key};
    }
    let quality=checkReply(decision.reply,{memory,questionKey:decision.question_key,maxChars:cfg.maxReply});
    if(!quality.ok){
      decision=await repairDecision(conversation,memory,planner,combinedText,decision,quality.reasons);
      quality=checkReply(decision.reply,{memory,questionKey:decision.question_key,maxChars:cfg.maxReply});
    }
    if(!quality.ok) throw new Error(`Respuesta rechazada por calidad: ${quality.reasons.join(", ")}`);

    decision.reply=String(decision.reply||"").trim().slice(0,cfg.maxReply);
    decision.add_labels=Array.isArray(decision.add_labels)?decision.add_labels.filter(label=>allowed.has(label)&&!["cliente","venta","cerrado","no_contesta"].includes(label)):[];
    decision.remove_labels=Array.isArray(decision.remove_labels)?decision.remove_labels.filter(label=>allowed.has(label)&&!protectedLabels.has(label)):[];
    labels=await mergeLabels(conversationId,decision.add_labels,decision.remove_labels);

    if(decision.handoff||planner.action==="transferir"){
      await transfer(conversationId,conversation,decision.handoff_reason||"El caso requiere revisión humana.",memory);
    }else if(decision.reply){
      await sendMessage(conversationId,decision.reply);
      const questions=decision.question_key?arrays(memory.preguntas_realizadas,[decision.question_key]):memory.preguntas_realizadas;
      await memories.merge(conversationId,{preguntas_realizadas:questions,ultima_pregunta:decision.question_key||null,ultima_respuesta_agente:decision.reply});
    }
    console.log(JSON.stringify({event:"processed",version:"2.5.0",conversationId,messageIds,sources,planner,labels,memory:memories.get(conversationId)}));
  }catch(error){console.error(`Error en conversación ${conversationId}:`,error);}
  finally{
    state.processing=false;
    if(state.dirty||state.ids.size){state.dirty=false;if(state.timer)clearTimeout(state.timer);state.timer=setTimeout(()=>void processQueued(conversationId),cfg.bufferMs);}
  }
}

async function processIncoming(payload){
  const message=messageOf(payload),id=conversationIdOf(payload),inbox=inboxIdOf(payload);
  if(!message?.id||!id||inbox!==cfg.inbox) return;
  if(!incoming(message)||message?.private===true||!contact(message)) return;
  enqueue(id,message.id,"message_created");
}

async function processConversationUpdate(payload){
  const id=conversationIdOf(payload);if(!id)return;
  try{
    const conversation=await getConversation(id);
    const inbox=Number(conversation?.inbox_id||conversation?.inbox?.id);
    const agent=Number(conversation?.meta?.assignee?.id||conversation?.assignee?.id);
    if(inbox!==cfg.inbox||agent!==cfg.agent)return;
    const messages=messagesOf(conversation);
    for(let i=messages.length-1;i>=0;i--){const message=messages[i];if(message&&incoming(message)&&!message.private&&contact(message)){enqueue(id,message.id,"conversation_updated");break;}}
  }catch(error){console.error(`Error asignación ${id}:`,error);}
}

app.get("/",(_req,res)=>res.json({service:"martcom-chatwoot-ai",version:"2.5.0",status:"ok",memory_file:cfg.memoryFile,message_buffer_ms:cfg.bufferMs,schedule:`${cfg.start}:00-${cfg.end}:00 ${cfg.timezone}`,inbox_id:cfg.inbox,agent_id:cfg.agent}));
app.get("/health",(_req,res)=>res.json({status:"ok",version:"2.5.0",timestamp:new Date().toISOString()}));
app.get("/memory/:conversationId",(req,res)=>{const id=Number(req.params.conversationId);if(!id)return res.status(400).json({error:"conversation_id inválido"});res.json(memories.get(id));});
app.delete("/memory/:conversationId",async(req,res)=>{if(cfg.secret&&req.query.secret!==cfg.secret)return res.status(401).json({error:"unauthorized"});const id=Number(req.params.conversationId);if(!id)return res.status(400).json({error:"conversation_id inválido"});await memories.clear(id);res.json({deleted:true,conversationId:id});});
app.post("/webhook/chatwoot",(req,res)=>{if(cfg.secret&&req.query.secret!==cfg.secret)return res.status(401).json({error:"unauthorized"});res.status(200).json({received:true});const event=String(req.body?.event||"");if(event==="message_created")void processIncoming(req.body);else if(event==="conversation_updated")void processConversationUpdate(req.body);});

app.listen(cfg.port,"0.0.0.0",()=>{
  console.log(`AXEL IA V2.5 escuchando en puerto ${cfg.port}`);
  console.log(`Buffer de mensajes: ${cfg.bufferMs} ms`);
  console.log(`Memoria persistente: ${cfg.memoryFile}`);
});
