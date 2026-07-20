import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { MARTCOM_KNOWLEDGE } from "./knowledge.js";

const required = ["CHATWOOT_BASE_URL","CHATWOOT_ACCOUNT_ID","CHATWOOT_INBOX_ID",
"CHATWOOT_AI_AGENT_ID","CHATWOOT_ACCESS_TOKEN","OPENAI_API_KEY","OPENAI_MODEL"];
for (const key of required) if (!process.env[key]) {
  console.error(`Falta la variable obligatoria: ${key}`); process.exit(1);
}

const cfg = {
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
  delay:Number(process.env.AI_RESPONSE_DELAY_SECONDS||4),
  maxHistory:Number(process.env.AI_MAX_HISTORY_MESSAGES||30),
  maxReply:Number(process.env.AI_MAX_REPLY_CHARS||900),
  secret:process.env.WEBHOOK_SECRET||"",
  assigned:process.env.AI_ASSIGNED_LABEL||"asignado",
  unattended:process.env.AI_UNATTENDED_LABEL||"sin_atender",
  validation:process.env.AI_VALIDATION_LABEL||"validacion",
};

const labelsAllowed = new Set(["asignado","cerrado","chat_basura","cliente","embarazo",
"no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado",
"seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const stopLabels = new Set(["cerrado","chat_basura","no_quiere_el_servicio","rechazado","venta","validacion"]);
const openai = new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const app = express();
app.use(express.json({limit:"4mb"}));
const locks = new Set(), seen = new Map();
setInterval(()=>{const c=Date.now()-21600000; for(const [k,v] of seen) if(v<c) seen.delete(k)},1800000).unref();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function hour(){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:cfg.timezone,hour:"2-digit",hour12:false}).formatToParts(new Date());
  return Number(p.find(x=>x.type==="hour")?.value||0);
}
function inSchedule(){const h=hour(); return h>=cfg.start&&h<cfg.end}
function msg(p){return p?.message||p}
function convId(p){return Number(p?.conversation?.id??p?.message?.conversation_id??p?.conversation_id)}
function inboxId(p){return Number(p?.conversation?.inbox_id??p?.conversation?.inbox?.id??p?.inbox?.id??p?.message?.inbox_id)}
function assigneeId(p){return Number(p?.conversation?.meta?.assignee?.id??p?.conversation?.assignee?.id??p?.meta?.assignee?.id??p?.assignee?.id)}
function incoming(m){return m?.message_type==="incoming"||m?.message_type===0}
function attachments(m){return Array.isArray(m?.attachments)&&m.attachments.length>0}

function sensitive(text=""){
  const t=String(text).trim().toLowerCase();
  const curp=/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i;
  const nss=/\b\d{11}\b/;
  const words=["mi curp","curp:","mi nss","nss:","numero de seguro social","número de seguro social",
  "ine","constancia de situacion fiscal","constancia de situación fiscal","comprobante",
  "ya pague","ya pagué","revisar mis semanas","revisar semanas","revisar mi caso",
  "quiero una llamada","pueden llamarme","validar","verificar mi información"];
  return curp.test(text)||nss.test(text)||words.some(w=>t.includes(w));
}

function providerIntent(text=""){
  const t=String(text).toLowerCase();
  const words=["cartera de clientes","mis clientes","para mis clientes","vendo seguro","vendo seguros",
  "vendo seguridad social","yo vendo","soy agente","soy asesor","quiero canalizar","quiero ofrecer",
  "intermediario","proveedor","alianza comercial"];
  return words.some(w=>t.includes(w));
}
function started(c){
  const ms=c?.messages||c?.payload?.messages||[];
  return ms.some(m=>!m.private&&(m.message_type==="outgoing"||m.message_type===1));
}

async function cw(path,opt={}){
  const r=await fetch(`${cfg.base}${path}`,{...opt,headers:{
    "Content-Type":"application/json","api_access_token":cfg.token,...(opt.headers||{})
  }});
  const tx=await r.text(); let d=null; try{d=tx?JSON.parse(tx):null}catch{d=tx}
  if(!r.ok) throw new Error(`Chatwoot ${r.status}: ${JSON.stringify(d)}`);
  return d;
}
const getConv=id=>cw(`/api/v1/accounts/${cfg.account}/conversations/${id}`);
async function getLabels(id){const d=await cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/labels`); return Array.isArray(d?.payload)?d.payload:[]}
async function setLabels(id,arr){return cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/labels`,{method:"POST",body:JSON.stringify({labels:[...new Set(arr)].filter(x=>labelsAllowed.has(x))})})}
async function mergeLabels(id,add=[],remove=[]){
  const cur=await getLabels(id), next=new Set(cur.filter(x=>labelsAllowed.has(x)));
  remove.forEach(x=>next.delete(x)); add.forEach(x=>labelsAllowed.has(x)&&next.add(x));
  if([...next].sort().join("|")!==[...cur].sort().join("|")) await setLabels(id,[...next]);
  return [...next];
}
async function send(id,content,priv=false){return cw(`/api/v1/accounts/${cfg.account}/conversations/${id}/messages`,{method:"POST",body:JSON.stringify({content,message_type:"outgoing",private:priv})})}
function history(c){
  const ms=c?.messages||c?.payload?.messages||[];
  return ms.filter(m=>!m.private&&m.content).slice(-cfg.maxHistory).map(m=>
    `${(m.message_type==="incoming"||m.message_type===0)?"CLIENTE":"AGENTE"}: ${String(m.content).trim()}`
  ).join("\n");
}
function parseJson(t){
  const s=String(t||"").replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```$/i,"").trim();
  try{return JSON.parse(s)}catch{const a=s.indexOf("{"),b=s.lastIndexOf("}"); if(a>=0&&b>a)return JSON.parse(s.slice(a,b+1)); throw new Error("JSON inválido")}
}
async function summarize(c,reason){
  const r=await openai.responses.create({model:cfg.model,instructions:`Resume para un asesor MARTCOM sin inventar.
Formato:
AXEL IA - RESUMEN
Nombre:
Edad:
Actividad:
Necesidad:
IMSS actual:
Última cotización:
Datos/documentos recibidos:
Motivo de transferencia:
Usa "No informado" cuando falte un dato.`,
  input:`Motivo: ${reason}\n\nHistorial:\n${history(c)}`});
  return r.output_text.trim().slice(0,1600);
}
async function handoff(id,c,reason){
  await mergeLabels(id,[cfg.validation],[]);
  await send(id,"Perfecto, ya recibí la información. Un asesor revisará personalmente su caso para darle una orientación precisa. En unos momentos continuará la atención.");
  let note; try{note=await summarize(c,reason)}catch{note=`AXEL IA - RESUMEN\nMotivo: ${reason}\nRevisar historial.`}
  await send(id,note,true);
}
async function facts(c){
  const r=await openai.responses.create({model:cfg.model,instructions:`Extrae solo datos explícitos del historial. No inventes.
Devuelve solo JSON válido:
{"name":null,"age":null,"activity":null,"has_imss":null,"had_imss_before":null,"last_contribution":null,"main_need":null,"is_provider":false,"provider_context":null,"strong_interest":false}
is_provider=true si tiene cartera, vende seguros/seguridad social o busca servicio para sus clientes.`,
  input:history(c)||"Sin historial."});
  return parseJson(r.output_text);
}
async function decision(c,labs,known,isProvider){
  const r=await openai.responses.create({model:cfg.model,instructions:`${MARTCOM_KNOWLEDGE}
DATOS YA CONOCIDOS:
${JSON.stringify(known,null,2)}
CONVERSACIÓN YA INICIADA: ${started(c)?"SÍ":"NO"}
PROVEEDOR DETECTADO: ${isProvider?"SÍ":"NO"}

Devuelve solo JSON:
{"reply":"","add_labels":[],"remove_labels":[],"handoff":false,"handoff_reason":""}
Reglas absolutas:
- No preguntes datos que ya tienen valor en DATOS YA CONOCIDOS.
- Si la conversación ya inició, no saludes ni te presentes.
- Si es proveedor, agrega proveedor, elimina cliente y habla de su cartera; no preguntes por su IMSS personal.
- cliente solo significa cliente actual confirmado de MARTCOM.
- Haz una sola pregunta principal y avanza desde el último mensaje.
- reply máximo ${cfg.maxReply} caracteres.
- No agregues cerrado, no_contesta ni venta.
- No elimines asignado, predictivo ni reasignado.
- Si requiere revisión humana, handoff=true y agrega validacion.
- Si hay interés fuerte, solicita primero CURP y después NSS, no ambos de golpe.`,
  input:`Etiquetas: ${labs.join(", ")||"ninguna"}\n\nHistorial:\n${history(c)}`});
  const d=parseJson(r.output_text);
  d.reply=String(d.reply||"").trim().slice(0,cfg.maxReply);
  d.add_labels=(Array.isArray(d.add_labels)?d.add_labels:[]).filter(x=>labelsAllowed.has(x)&&!["cerrado","no_contesta","venta"].includes(x));
  d.remove_labels=(Array.isArray(d.remove_labels)?d.remove_labels:[]).filter(x=>labelsAllowed.has(x)&&!["asignado","predictivo","reasignado"].includes(x));
  d.handoff=Boolean(d.handoff); d.handoff_reason=String(d.handoff_reason||"").trim();
  if(isProvider||known?.is_provider){
    if(!d.add_labels.includes("proveedor"))d.add_labels.push("proveedor");
    if(!d.remove_labels.includes("cliente"))d.remove_labels.push("cliente");
  }
  if(d.handoff&&!d.add_labels.includes(cfg.validation))d.add_labels.push(cfg.validation);
  return d;
}
async function processIncoming(p){
  const m=msg(p), mid=String(m?.id||""), id=convId(p);
  if(!mid||!id||seen.has(mid))return; seen.set(mid,Date.now());
  if(inboxId(p)!==cfg.inbox||!incoming(m)||m?.private===true)return;
  if(!inSchedule()){console.log(`Fuera de horario. Conversación ${id}`);return}
  if(locks.has(id))return; locks.add(id);
  try{
    await sleep(cfg.delay*1000);
    const c=await getConv(id);
    const ib=Number(c?.inbox_id||c?.inbox?.id);
    const ai=Number(c?.meta?.assignee?.id||c?.assignee?.id);
    const st=String(c?.status||"").toLowerCase();
    if(ib!==cfg.inbox)return;
    if(ai!==cfg.agent){console.log(`Ignorada ${id}: asignada al agente ${ai}.`);return}
    if(["resolved","closed"].includes(st))return;

    let labs=await mergeLabels(id,[cfg.assigned],[cfg.unattended]);
    if(labs.some(x=>stopLabels.has(x))){console.log(`Ignorada ${id}: etiqueta de detención.`);return}

    if(attachments(m)||sensitive(m?.content||"")){
      await handoff(id,c,attachments(m)?"Documento o archivo recibido.":"Dato sensible o solicitud de revisión recibida.");
      console.log(JSON.stringify({event:"handoff",conversationId:id})); return;
    }

    const h=history(c);
    const isProvider=providerIntent(h);
    const known=await facts(c);
    const d=await decision(c,labs,known,isProvider);
    labs=await mergeLabels(id,d.add_labels,d.remove_labels);
    if(d.handoff) await handoff(id,c,d.handoff_reason||"Requiere revisión humana.");
    else if(d.reply) await send(id,d.reply);
    console.log(JSON.stringify({event:"processed",conversationId:id,provider:isProvider||known?.is_provider,knownFacts:known,labels:labs,handoff:d.handoff}));
  }catch(e){
    console.error(`Error en conversación ${id}:`,e);
  }finally{locks.delete(id)}
}
async function processUpdate(p){
  const id=convId(p);
  if(!id||inboxId(p)!==cfg.inbox||assigneeId(p)!==cfg.agent)return;
  try{await mergeLabels(id,[cfg.assigned],[cfg.unattended]); console.log(`Conversación ${id} recibida por AXEL IA.`)}
  catch(e){console.error("Error al etiquetar conversación:",e)}
}

app.get("/",(_q,r)=>r.json({service:"martcom-chatwoot-ai",version:"2.2.0",status:"ok",schedule:`${cfg.start}:00-${cfg.end}:00 ${cfg.timezone}`,inbox_id:cfg.inbox,agent_id:cfg.agent}));
app.get("/health",(_q,r)=>r.json({status:"ok",version:"2.2.0",timestamp:new Date().toISOString()}));
app.post("/webhook/chatwoot",(q,r)=>{
  if(cfg.secret&&q.query.secret!==cfg.secret)return r.status(401).json({error:"unauthorized"});
  r.status(200).json({received:true});
  const e=String(q.body?.event||"");
  if(e==="message_created")void processIncoming(q.body);
  else if(e==="conversation_updated")void processUpdate(q.body);
});
app.listen(cfg.port,"0.0.0.0",()=>console.log(`AXEL IA V2.2 escuchando en puerto ${cfg.port}`));
