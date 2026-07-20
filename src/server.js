import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { MARTCOM_KNOWLEDGE } from "./knowledge.js";

const required = ["CHATWOOT_BASE_URL","CHATWOOT_ACCOUNT_ID","CHATWOOT_INBOX_ID","CHATWOOT_AI_AGENT_ID","CHATWOOT_ACCESS_TOKEN","OPENAI_API_KEY","OPENAI_MODEL"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Falta la variable obligatoria: ${key}`);
    process.exit(1);
  }
}

const cfg = {
  port: Number(process.env.PORT || 3000),
  chatwootBaseUrl: process.env.CHATWOOT_BASE_URL.replace(/\/+$/, ""),
  accountId: Number(process.env.CHATWOOT_ACCOUNT_ID),
  inboxId: Number(process.env.CHATWOOT_INBOX_ID),
  aiAgentId: Number(process.env.CHATWOOT_AI_AGENT_ID),
  chatwootToken: process.env.CHATWOOT_ACCESS_TOKEN,
  model: process.env.OPENAI_MODEL,
  timezone: process.env.AI_TIMEZONE || "America/Mexico_City",
  startHour: Number(process.env.AI_START_HOUR || 7),
  endHour: Number(process.env.AI_END_HOUR || 22),
  maxHistory: Number(process.env.AI_MAX_HISTORY_MESSAGES || 30),
  delaySeconds: Number(process.env.AI_RESPONSE_DELAY_SECONDS || 4),
  maxReplyChars: Number(process.env.AI_MAX_REPLY_CHARS || 900),
  assignedLabel: process.env.AI_ASSIGNED_LABEL || "asignado",
  unattendedLabel: process.env.AI_UNATTENDED_LABEL || "sin_atender",
  validationLabel: process.env.AI_VALIDATION_LABEL || "validacion",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
};

const allowedLabels = new Set(["asignado","cerrado","chat_basura","cliente","embarazo","no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado","seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const stopLabels = new Set(["cerrado","chat_basura","no_quiere_el_servicio","rechazado","venta","validacion"]);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
app.use(express.json({ limit: "4mb" }));

const processedMessages = new Map();
const conversationLocks = new Set();
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, timestamp] of processedMessages.entries()) if (timestamp < cutoff) processedMessages.delete(id);
}, 30 * 60 * 1000).unref();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getLocalHour() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone, hour: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}
function isWithinSchedule() { const hour = getLocalHour(); return hour >= cfg.startHour && hour < cfg.endHour; }
function getMessage(payload) { return payload?.message || payload; }
function getConversationId(payload) { return Number(payload?.conversation?.id ?? payload?.message?.conversation_id ?? payload?.conversation_id); }
function getInboxId(payload) { return Number(payload?.conversation?.inbox_id ?? payload?.conversation?.inbox?.id ?? payload?.inbox?.id ?? payload?.message?.inbox_id); }
function getAssigneeId(payload) { return Number(payload?.conversation?.meta?.assignee?.id ?? payload?.conversation?.assignee?.id ?? payload?.meta?.assignee?.id ?? payload?.assignee?.id); }
function isIncoming(message) { return message?.message_type === "incoming" || message?.message_type === 0; }
function senderIsContact(message) { const type = String(message?.sender_type || message?.sender?.type || "").toLowerCase(); return !type || type === "contact"; }
function hasAttachments(message) { return Array.isArray(message?.attachments) && message.attachments.length > 0; }

function containsSensitiveDataOrReviewRequest(content = "") {
  const text = String(content).trim();
  const lower = text.toLowerCase();
  const curpPattern = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i;
  const nssPattern = /\b\d{11}\b/;
  const terms = ["mi curp","curp:","mi nss","nss:","numero de seguro social","número de seguro social","ine","constancia de situacion fiscal","constancia de situación fiscal","comprobante","deposito","depósito","transferencia","ya pague","ya pagué","revisar mis semanas","revisar semanas","revisar mi caso","revisen mi caso","quiero una llamada","pueden llamarme","háblenme","hablenme","validar","verificar mi informacion","verificar mi información"];
  return curpPattern.test(text) || nssPattern.test(text) || terms.some((term) => lower.includes(term));
}

async function cw(path, options = {}) {
  const response = await fetch(`${cfg.chatwootBaseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", api_access_token: cfg.chatwootToken, ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function getConversation(id) { return cw(`/api/v1/accounts/${cfg.accountId}/conversations/${id}`); }
async function getLabels(id) {
  const data = await cw(`/api/v1/accounts/${cfg.accountId}/conversations/${id}/labels`);
  return Array.isArray(data?.payload) ? data.payload : [];
}
async function setLabels(id, labels) {
  const clean = [...new Set(labels)].filter((label) => allowedLabels.has(label));
  return cw(`/api/v1/accounts/${cfg.accountId}/conversations/${id}/labels`, { method: "POST", body: JSON.stringify({ labels: clean }) });
}
async function mergeLabels(id, add = [], remove = []) {
  const current = await getLabels(id);
  const next = new Set(current.filter((label) => allowedLabels.has(label)));
  for (const label of remove) next.delete(label);
  for (const label of add) if (allowedLabels.has(label)) next.add(label);
  if ([...next].sort().join("|") !== [...current].sort().join("|")) await setLabels(id, [...next]);
  return [...next];
}
async function sendMessage(id, content, privateNote = false) {
  return cw(`/api/v1/accounts/${cfg.accountId}/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, message_type: "outgoing", private: privateNote }),
  });
}

function getConversationMessages(conversation) {
  for (const candidate of [conversation?.messages, conversation?.payload?.messages, conversation?.conversation?.messages]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
function normalizeHistory(conversation) {
  return getConversationMessages(conversation)
    .filter((m) => !m.private && m.content)
    .slice(-cfg.maxHistory)
    .map((m) => `${isIncoming(m) ? "CLIENTE" : "AGENTE"}: ${String(m.content).trim()}`)
    .join("\n");
}
function getLastIncomingMessage(conversation) {
  const messages = getConversationMessages(conversation);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && isIncoming(m) && m.private !== true && senderIsContact(m)) return m;
  }
  return null;
}
function extractJson(text) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("La respuesta del modelo no contiene JSON válido.");
  }
}

async function makeHandoffSummary(conversation, reason) {
  const response = await openai.responses.create({
    model: cfg.model,
    instructions: `Genera un resumen privado para un asesor humano de MARTCOM. No inventes datos. Usa únicamente el historial. Formato:\nAXEL IA - RESUMEN\nNombre:\nEdad:\nActividad:\nNecesidad:\nIMSS actual:\nÚltima cotización:\nDatos/documentos recibidos:\nMotivo de transferencia:\nSi un dato no está disponible escribe "No informado".`,
    input: `Motivo técnico: ${reason}\n\nHistorial:\n${normalizeHistory(conversation)}`,
  });
  return response.output_text.trim().slice(0, 1600);
}
async function transferToHuman(id, conversation, reason) {
  const reply = "Perfecto, ya recibí la información. Un asesor revisará personalmente su caso para darle una orientación precisa. En unos momentos continuará la atención.";
  await mergeLabels(id, [cfg.validationLabel], []);
  await sendMessage(id, reply, false);
  let summary;
  try { summary = await makeHandoffSummary(conversation, reason); }
  catch { summary = `AXEL IA - RESUMEN\nMotivo de transferencia: ${reason}\nRevisar historial completo.`; }
  await sendMessage(id, summary, true);
}

async function generateDecision(conversation, labels) {
  const response = await openai.responses.create({
    model: cfg.model,
    instructions: `${MARTCOM_KNOWLEDGE}\nDevuelve ÚNICAMENTE JSON válido con esta forma:\n{"reply":"mensaje breve","add_labels":["etiqueta"],"remove_labels":["etiqueta"],"handoff":false,"handoff_reason":""}\nReglas técnicas: reply máximo ${cfg.maxReplyChars} caracteres. No agregues cerrado, no_contesta ni venta. No elimines asignado, predictivo ni reasignado. Si requiere consulta oficial, pago, vigencia, documentos o caso particular usa handoff=true y agrega validacion. Si hay interés fuerte, solicita CURP o NSS, no ambos de golpe.`,
    input: `Etiquetas actuales: ${labels.join(", ") || "ninguna"}\n\nHistorial:\n${normalizeHistory(conversation)}`,
  });
  const d = extractJson(response.output_text);
  d.reply = String(d.reply || "").trim().slice(0, cfg.maxReplyChars);
  d.add_labels = Array.isArray(d.add_labels) ? d.add_labels.filter((x) => allowedLabels.has(x) && !["cerrado","no_contesta","venta"].includes(x)) : [];
  d.remove_labels = Array.isArray(d.remove_labels) ? d.remove_labels.filter((x) => allowedLabels.has(x) && !["asignado","predictivo","reasignado"].includes(x)) : [];
  d.handoff = Boolean(d.handoff);
  d.handoff_reason = String(d.handoff_reason || "").trim();
  if (d.handoff && !d.add_labels.includes(cfg.validationLabel)) d.add_labels.push(cfg.validationLabel);
  return d;
}

async function processConversationMessage({ conversationId, message, source }) {
  const messageId = String(message?.id || "");
  if (!conversationId || !messageId) return;
  if (processedMessages.has(messageId)) { console.log(`Mensaje ${messageId} ignorado: ya fue procesado (${source}).`); return; }
  if (conversationLocks.has(conversationId)) { console.log(`Conversación ${conversationId} ignorada: ya está siendo procesada.`); return; }
  if (!isWithinSchedule()) { console.log(`Fuera de horario. Conversación ${conversationId}`); return; }

  conversationLocks.add(conversationId);
  try {
    await sleep(cfg.delaySeconds * 1000);
    const conversation = await getConversation(conversationId);
    const actualInboxId = Number(conversation?.inbox_id || conversation?.inbox?.id);
    const actualAssigneeId = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id);
    const status = String(conversation?.status || "").toLowerCase();

    if (actualInboxId !== cfg.inboxId) return console.log(`Ignorada ${conversationId}: inbox ${actualInboxId}.`);
    if (actualAssigneeId !== cfg.aiAgentId) return console.log(`Ignorada ${conversationId}: asignada al agente ${actualAssigneeId}.`);
    if (["resolved","closed"].includes(status)) return console.log(`Ignorada ${conversationId}: estado ${status}.`);

    let labels = await mergeLabels(conversationId, [cfg.assignedLabel], [cfg.unattendedLabel]);
    if (labels.some((label) => stopLabels.has(label))) return console.log(`Ignorada ${conversationId}: tiene etiqueta de detención.`);

    processedMessages.set(messageId, Date.now());
    const sensitive = hasAttachments(message) || containsSensitiveDataOrReviewRequest(message?.content || "");
    if (sensitive) {
      const reason = hasAttachments(message) ? "El cliente envió uno o más archivos o documentos." : "El cliente envió datos sensibles o solicitó revisión humana o específica.";
      await transferToHuman(conversationId, conversation, reason);
      console.log(JSON.stringify({ event: "handoff", source, conversationId, messageId, reason }));
      return;
    }

    const decision = await generateDecision(conversation, labels);
    labels = await mergeLabels(conversationId, decision.add_labels, decision.remove_labels);
    if (decision.handoff) await transferToHuman(conversationId, conversation, decision.handoff_reason || "El caso requiere revisión humana.");
    else if (decision.reply) await sendMessage(conversationId, decision.reply, false);

    console.log(JSON.stringify({ event: "processed", source, conversationId, messageId, labels, handoff: decision.handoff }));
  } catch (error) {
    console.error(`Error en conversación ${conversationId}:`, error);
  } finally {
    conversationLocks.delete(conversationId);
  }
}

async function processIncoming(payload) {
  const message = getMessage(payload);
  const conversationId = getConversationId(payload);
  const inboxId = getInboxId(payload);
  if (!message?.id || !conversationId || inboxId !== cfg.inboxId) return;
  if (!isIncoming(message) || message?.private === true || !senderIsContact(message)) return;
  await processConversationMessage({ conversationId, message, source: "message_created" });
}

async function processConversationUpdate(payload) {
  const conversationId = getConversationId(payload);
  const inboxId = getInboxId(payload);
  const assigneeId = getAssigneeId(payload);
  if (!conversationId || inboxId !== cfg.inboxId || assigneeId !== cfg.aiAgentId) return;

  try {
    const conversation = await getConversation(conversationId);
    const actualInboxId = Number(conversation?.inbox_id || conversation?.inbox?.id);
    const actualAssigneeId = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id);
    if (actualInboxId !== cfg.inboxId || actualAssigneeId !== cfg.aiAgentId) return;

    const labels = await mergeLabels(conversationId, [cfg.assignedLabel], [cfg.unattendedLabel]);
    console.log(`Conversación ${conversationId} recibida por AXEL IA.`);
    if (labels.some((label) => stopLabels.has(label))) return console.log(`Conversación ${conversationId} no procesada: tiene etiqueta de detención.`);

    const lastIncomingMessage = getLastIncomingMessage(conversation);
    if (!lastIncomingMessage) return console.log(`Conversación ${conversationId} no tiene un mensaje entrante pendiente.`);

    await processConversationMessage({ conversationId, message: lastIncomingMessage, source: "conversation_updated" });
  } catch (error) {
    console.error(`Error al procesar conversación asignada ${conversationId}:`, error);
  }
}

app.get("/", (_req, res) => res.json({ service: "martcom-chatwoot-ai", version: "2.1.0", status: "ok", schedule: `${cfg.startHour}:00-${cfg.endHour}:00 ${cfg.timezone}`, inbox_id: cfg.inboxId, agent_id: cfg.aiAgentId }));
app.get("/health", (_req, res) => res.json({ status: "ok", version: "2.1.0", timestamp: new Date().toISOString() }));
app.post("/webhook/chatwoot", (req, res) => {
  if (cfg.webhookSecret && req.query.secret !== cfg.webhookSecret) return res.status(401).json({ error: "unauthorized" });
  res.status(200).json({ received: true });
  const event = String(req.body?.event || "");
  if (event === "message_created") void processIncoming(req.body);
  else if (event === "conversation_updated") void processConversationUpdate(req.body);
});

app.listen(cfg.port, "0.0.0.0", () => console.log(`AXEL IA V2.1 escuchando en puerto ${cfg.port}`));

