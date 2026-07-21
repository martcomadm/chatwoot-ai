import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { MARTCOM_KNOWLEDGE } from "./knowledge.js";

const required = [
  "CHATWOOT_BASE_URL","CHATWOOT_ACCOUNT_ID","CHATWOOT_INBOX_ID",
  "CHATWOOT_AI_AGENT_ID","CHATWOOT_ACCESS_TOKEN","OPENAI_API_KEY","OPENAI_MODEL"
];

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
  maxHistory: Number(process.env.AI_MAX_HISTORY_MESSAGES || 40),
  delaySeconds: Number(process.env.AI_RESPONSE_DELAY_SECONDS || 4),
  maxReplyChars: Number(process.env.AI_MAX_REPLY_CHARS || 900),
  assignedLabel: process.env.AI_ASSIGNED_LABEL || "asignado",
  unattendedLabel: process.env.AI_UNATTENDED_LABEL || "sin_atender",
  validationLabel: process.env.AI_VALIDATION_LABEL || "validacion",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
};

const allowedLabels = new Set([
  "asignado","cerrado","chat_basura","cliente","embarazo","no_contesta",
  "no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado",
  "seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"
]);

const stopLabels = new Set([
  "cerrado","chat_basura","no_quiere_el_servicio","rechazado","venta","validacion"
]);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
app.use(express.json({ limit: "4mb" }));

const processedMessages = new Map();
const conversationLocks = new Set();

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, timestamp] of processedMessages.entries()) {
    if (timestamp < cutoff) processedMessages.delete(id);
  }
}, 30 * 60 * 1000).unref();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getLocalHour() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.timezone, hour: "2-digit", hour12: false
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

function isWithinSchedule() {
  const hour = getLocalHour();
  return hour >= cfg.startHour && hour < cfg.endHour;
}

function getMessage(payload) { return payload?.message || payload; }

function getConversationId(payload) {
  return Number(
    payload?.conversation?.id ??
    payload?.message?.conversation_id ??
    payload?.conversation_id ??
    payload?.id
  );
}

function getInboxId(payload) {
  return Number(
    payload?.conversation?.inbox_id ??
    payload?.conversation?.inbox?.id ??
    payload?.inbox?.id ??
    payload?.message?.inbox_id
  );
}

function isIncoming(message) {
  return message?.message_type === "incoming" || message?.message_type === 0;
}

function senderIsContact(message) {
  const type = String(message?.sender_type || message?.sender?.type || "").toLowerCase();
  return !type || type === "contact";
}

function hasAttachments(message) {
  return Array.isArray(message?.attachments) && message.attachments.length > 0;
}

function detectHandoffReason(content = "") {
  const text = String(content).trim();
  const lower = text.toLowerCase();
  const curpPattern = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i;
  const nssPattern = /\b\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{5}\b/;

  if (curpPattern.test(text)) return "El cliente proporcionó una CURP.";
  if (nssPattern.test(text)) return "El cliente proporcionó un NSS.";

  const human = [
    "quiero hablar con un asesor","quiero hablar con una persona",
    "comuníqueme con un asesor","comuniqueme con un asesor",
    "pueden llamarme","puede llamarme","quiero una llamada","háblenme","hablenme"
  ];
  if (human.some((phrase) => lower.includes(phrase))) {
    return "El cliente solicitó atención directa de un asesor.";
  }

  const payment = [
    "ya hice el pago","ya realicé el pago","ya realice el pago",
    "ya pagué","ya pague","te envío el comprobante",
    "te envio el comprobante","adjunto el comprobante"
  ];
  if (payment.some((phrase) => lower.includes(phrase))) {
    return "El cliente reportó un pago o comprobante que requiere validación.";
  }
  return null;
}

async function cw(path, options = {}) {
  const response = await fetch(`${cfg.chatwootBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      api_access_token: cfg.chatwootToken,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function getConversation(conversationId) {
  return cw(`/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}`);
}

async function getLabels(conversationId) {
  const data = await cw(
    `/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}/labels`
  );
  return Array.isArray(data?.payload) ? data.payload : [];
}

async function setLabels(conversationId, labels) {
  const clean = [...new Set(labels)].filter((label) => allowedLabels.has(label));
  return cw(
    `/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}/labels`,
    { method: "POST", body: JSON.stringify({ labels: clean }) }
  );
}

async function mergeLabels(conversationId, add = [], remove = []) {
  const current = await getLabels(conversationId);
  const next = new Set(current.filter((label) => allowedLabels.has(label)));

  for (const label of remove) next.delete(label);
  for (const label of add) if (allowedLabels.has(label)) next.add(label);

  if ([...next].sort().join("|") !== [...current].sort().join("|")) {
    await setLabels(conversationId, [...next]);
  }
  return [...next];
}

async function sendMessage(conversationId, content, privateNote = false) {
  return cw(
    `/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content,
        message_type: "outgoing",
        private: privateNote
      })
    }
  );
}

function getConversationMessages(conversation) {
  const candidates = [
    conversation?.messages,
    conversation?.payload?.messages,
    conversation?.conversation?.messages
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function normalizeHistory(conversation) {
  return getConversationMessages(conversation)
    .filter((message) => !message.private && message.content)
    .slice(-cfg.maxHistory)
    .map((message) => {
      const role =
        message.message_type === "incoming" || message.message_type === 0
          ? "CLIENTE" : "AGENTE";
      return `${role}: ${String(message.content).trim()}`;
    })
    .join("\n");
}

function getLastIncomingMessage(conversation) {
  const messages = getConversationMessages(conversation);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      isIncoming(message) &&
      message.private !== true &&
      senderIsContact(message)
    ) return message;
  }
  return null;
}

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("La respuesta del modelo no contiene JSON válido.");
  }
}

async function buildCustomerProfile(conversation) {
  const history = normalizeHistory(conversation);

  const response = await openai.responses.create({
    model: cfg.model,
    instructions: `
Extrae una ficha estructurada del cliente.
No inventes datos. No confundas CURP o NSS con nombre.
Devuelve ÚNICAMENTE JSON válido:

{
  "nombre": null,
  "edad": null,
  "actividad": null,
  "tipo_trabajo": null,
  "tiene_imss": null,
  "ultima_cotizacion": null,
  "necesidades": [],
  "afore_actual": null,
  "pregunta_cambio_afore": false,
  "curp_recibida": false,
  "nss_recibido": false,
  "documentos_recibidos": [],
  "datos_confirmados": [],
  "datos_pendientes": [],
  "contradicciones": [],
  "ultima_pregunta_del_agente": null
}

Reglas:
- nombre solo si el cliente expresó su nombre.
- CURP de 18 caracteres nunca es nombre.
- NSS de 11 dígitos nunca es nombre.
- tiene_imss debe ser true, false o null.
- necesidades puede incluir servicio_medico, semanas, pension, beneficiarios,
  afore, infonavit o afiliacion.
- contradicciones debe señalar datos incompatibles.
- datos_confirmados contiene lo ya conocido.
- datos_pendientes solo contiene datos relevantes que faltan.
`,
    input: `Historial:\n${history}`
  });

  return extractJson(response.output_text);
}

async function makeHandoffSummary(conversation, reason, profile) {
  const history = normalizeHistory(conversation);

  const response = await openai.responses.create({
    model: cfg.model,
    instructions: `
Genera una nota privada breve para un asesor humano.
Usa la ficha como fuente principal. No inventes.
No confundas CURP con nombre.

Formato obligatorio:

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
Documentos recibidos:
Contradicciones:
Motivo de transferencia:

Si no hay dato, escribe "No informado".
`,
    input:
      `Motivo: ${reason}\n\n` +
      `Ficha:\n${JSON.stringify(profile, null, 2)}\n\n` +
      `Historial:\n${history}`
  });

  return response.output_text.trim().slice(0, 1800);
}

async function transferToHuman(conversationId, conversation, reason, profile) {
  const reply =
    "Perfecto, ya recibí la información. Un asesor revisará personalmente su caso para darle una orientación precisa. En unos momentos continuará la atención.";

  await mergeLabels(conversationId, [cfg.validationLabel], []);
  await sendMessage(conversationId, reply, false);

  let summary;
  try {
    summary = await makeHandoffSummary(conversation, reason, profile);
  } catch {
    summary =
      `AXEL IA - RESUMEN\nMotivo de transferencia: ${reason}\n` +
      `Revisar historial completo.`;
  }
  await sendMessage(conversationId, summary, true);
}

async function generateDecision(conversation, labels, profile) {
  const history = normalizeHistory(conversation);

  const response = await openai.responses.create({
    model: cfg.model,
    instructions: `
${MARTCOM_KNOWLEDGE}

FICHA DEL CLIENTE
${JSON.stringify(profile, null, 2)}

Devuelve ÚNICAMENTE JSON válido:
{
  "reply": "mensaje breve para el cliente",
  "add_labels": ["etiqueta"],
  "remove_labels": ["etiqueta"],
  "handoff": false,
  "handoff_reason": ""
}

Reglas obligatorias:
- No preguntes nada que aparezca en datos_confirmados.
- Si tiene_imss es false, jamás vuelvas a preguntar si tiene IMSS.
- Si edad existe, no la vuelvas a pedir.
- Si actividad existe, no la vuelvas a pedir.
- Si necesidades ya tiene datos, no vuelvas a listar todas las opciones.
- Si contradicciones tiene elementos, pregunta solo por la contradicción más importante.
- Haz una sola pregunta principal por turno.
- Reconoce brevemente la información confirmada.
- Si pregunta por cambio de AFORE, aclara que es un trámite distinto.
- reply máximo ${cfg.maxReplyChars} caracteres.
- No agregues cerrado, no_contesta ni venta automáticamente.
- No elimines asignado, predictivo ni reasignado.
- Si hay interés fuerte, solicita CURP o NSS, no ambos.
- Si requiere revisión oficial o humana, handoff=true y agrega validacion.
`,
    input:
      `Etiquetas actuales: ${labels.join(", ") || "ninguna"}\n\n` +
      `Historial:\n${history}`
  });

  const decision = extractJson(response.output_text);
  decision.reply = String(decision.reply || "").trim().slice(0, cfg.maxReplyChars);
  decision.add_labels = Array.isArray(decision.add_labels)
    ? decision.add_labels.filter((label) => allowedLabels.has(label)) : [];
  decision.remove_labels = Array.isArray(decision.remove_labels)
    ? decision.remove_labels.filter((label) => allowedLabels.has(label)) : [];
  decision.handoff = Boolean(decision.handoff);
  decision.handoff_reason = String(decision.handoff_reason || "").trim();

  decision.add_labels = decision.add_labels.filter(
    (label) => !["cerrado","no_contesta","venta"].includes(label)
  );
  decision.remove_labels = decision.remove_labels.filter(
    (label) => !["asignado","predictivo","reasignado"].includes(label)
  );

  if (decision.handoff && !decision.add_labels.includes(cfg.validationLabel)) {
    decision.add_labels.push(cfg.validationLabel);
  }
  return decision;
}

async function processConversationMessage({ conversationId, message, source }) {
  const messageId = String(message?.id || "");
  if (!conversationId || !messageId) return;

  if (processedMessages.has(messageId)) {
    console.log(`Mensaje ${messageId} ignorado: ya fue procesado.`);
    return;
  }

  if (conversationLocks.has(conversationId)) {
    console.log(`Conversación ${conversationId} ya está en proceso.`);
    return;
  }

  if (!isWithinSchedule()) {
    console.log(`Fuera de horario. Conversación ${conversationId}`);
    return;
  }

  conversationLocks.add(conversationId);

  try {
    await sleep(cfg.delaySeconds * 1000);

    const conversation = await getConversation(conversationId);
    const actualInboxId = Number(conversation?.inbox_id || conversation?.inbox?.id);
    const actualAssigneeId = Number(
      conversation?.meta?.assignee?.id || conversation?.assignee?.id
    );
    const status = String(conversation?.status || "").toLowerCase();

    if (actualInboxId !== cfg.inboxId) return;

    if (actualAssigneeId !== cfg.aiAgentId) {
      console.log(`Ignorada ${conversationId}: asignada al agente ${actualAssigneeId}.`);
      return;
    }

    if (["resolved","closed"].includes(status)) return;

    let labels = await mergeLabels(
      conversationId,
      [cfg.assignedLabel],
      [cfg.unattendedLabel]
    );

    if (labels.some((label) => stopLabels.has(label))) {
      console.log(`Ignorada ${conversationId}: tiene etiqueta de detención.`);
      return;
    }

    processedMessages.set(messageId, Date.now());

    const profile = await buildCustomerProfile(conversation);

    const handoffReason = hasAttachments(message)
      ? "El cliente envió uno o más archivos o documentos."
      : detectHandoffReason(message?.content || "");

    if (handoffReason) {
      await transferToHuman(conversationId, conversation, handoffReason, profile);
      console.log(JSON.stringify({
        event: "handoff", source, conversationId, messageId, reason: handoffReason, profile
      }));
      return;
    }

    const decision = await generateDecision(conversation, labels, profile);

    labels = await mergeLabels(
      conversationId,
      decision.add_labels,
      decision.remove_labels
    );

    if (decision.handoff) {
      await transferToHuman(
        conversationId,
        conversation,
        decision.handoff_reason || "El caso requiere revisión humana.",
        profile
      );
    } else if (decision.reply) {
      await sendMessage(conversationId, decision.reply, false);
    }

    console.log(JSON.stringify({
      event: "processed", source, conversationId, messageId,
      labels, handoff: decision.handoff, profile
    }));
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

  if (!message?.id || !conversationId) return;
  if (inboxId !== cfg.inboxId) return;

  if (!isIncoming(message) || message?.private === true || !senderIsContact(message)) {
    return;
  }

  await processConversationMessage({
    conversationId,
    message,
    source: "message_created"
  });
}

async function processConversationUpdate(payload) {
  const conversationId = getConversationId(payload);
  if (!conversationId) return;

  try {
    const conversation = await getConversation(conversationId);
    const actualInboxId = Number(conversation?.inbox_id || conversation?.inbox?.id);
    const actualAssigneeId = Number(
      conversation?.meta?.assignee?.id || conversation?.assignee?.id
    );

    if (actualInboxId !== cfg.inboxId || actualAssigneeId !== cfg.aiAgentId) return;

    const labels = await mergeLabels(
      conversationId,
      [cfg.assignedLabel],
      [cfg.unattendedLabel]
    );

    console.log(`Conversación ${conversationId} recibida por AXEL IA.`);

    if (labels.some((label) => stopLabels.has(label))) {
      console.log(`Conversación ${conversationId} no procesada: etiqueta de detención.`);
      return;
    }

    const lastIncomingMessage = getLastIncomingMessage(conversation);
    if (!lastIncomingMessage) return;

    await processConversationMessage({
      conversationId,
      message: lastIncomingMessage,
      source: "conversation_updated"
    });
  } catch (error) {
    console.error(`Error al procesar conversación asignada ${conversationId}:`, error);
  }
}

app.get("/", (_req, res) => {
  res.json({
    service: "martcom-chatwoot-ai",
    version: "2.3.0",
    status: "ok",
    schedule: `${cfg.startHour}:00-${cfg.endHour}:00 ${cfg.timezone}`,
    inbox_id: cfg.inboxId,
    agent_id: cfg.aiAgentId
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "2.3.0",
    timestamp: new Date().toISOString()
  });
});

app.post("/webhook/chatwoot", (req, res) => {
  if (cfg.webhookSecret && req.query.secret !== cfg.webhookSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  res.status(200).json({ received: true });

  const event = String(req.body?.event || "");
  if (event === "message_created") {
    void processIncoming(req.body);
  } else if (event === "conversation_updated") {
    void processConversationUpdate(req.body);
  }
});

app.listen(cfg.port, "0.0.0.0", () => {
  console.log(`AXEL IA V2.3 escuchando en puerto ${cfg.port}`);
});

