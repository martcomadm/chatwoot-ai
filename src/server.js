import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const required = [
  "CHATWOOT_BASE_URL",
  "CHATWOOT_ACCOUNT_ID",
  "CHATWOOT_INBOX_ID",
  "CHATWOOT_AI_AGENT_ID",
  "CHATWOOT_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
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
  maxHistory: Number(process.env.AI_MAX_HISTORY_MESSAGES || 25),
  delaySeconds: Number(process.env.AI_RESPONSE_DELAY_SECONDS || 4),
  maxReplyChars: Number(process.env.AI_MAX_REPLY_CHARS || 1200),
  assignedLabel: process.env.AI_ASSIGNED_LABEL || "asignado",
  unattendedLabel: process.env.AI_UNATTENDED_LABEL || "sin_atender",
  validationLabel: process.env.AI_VALIDATION_LABEL || "validacion",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
};

const allowedLabels = new Set([
  "asignado",
  "cerrado",
  "chat_basura",
  "cliente",
  "embarazo",
  "no_contesta",
  "no_quiere_el_servicio",
  "predictivo",
  "proveedor",
  "reasignado",
  "rechazado",
  "seguimiento",
  "sin_atender",
  "validacion",
  "venta",
  "ya_tiene_servicio",
]);

const terminalLabels = new Set([
  "cerrado",
  "chat_basura",
  "no_quiere_el_servicio",
  "rechazado",
  "venta",
]);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
app.use(express.json({ limit: "2mb" }));

// Deduplación sencilla en memoria. Evita procesar dos veces el mismo webhook.
const processedMessages = new Map();
const conversationLocks = new Set();

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, timestamp] of processedMessages.entries()) {
    if (timestamp < cutoff) processedMessages.delete(id);
  }
}, 30 * 60 * 1000).unref();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLocalHour() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

function isWithinSchedule() {
  const hour = getLocalHour();
  return hour >= cfg.startHour && hour < cfg.endHour;
}

function getConversationId(payload) {
  return Number(
    payload?.conversation?.id ??
    payload?.conversation?.display_id ??
    payload?.id ??
    payload?.message?.conversation_id
  );
}

function getMessage(payload) {
  return payload?.message || payload;
}

function getInboxId(payload) {
  return Number(
    payload?.conversation?.inbox_id ??
    payload?.conversation?.inbox?.id ??
    payload?.inbox?.id ??
    payload?.message?.inbox_id
  );
}

function getAssigneeId(payload) {
  return Number(
    payload?.conversation?.meta?.assignee?.id ??
    payload?.conversation?.assignee?.id ??
    payload?.meta?.assignee?.id ??
    payload?.assignee?.id
  );
}

function isIncoming(message) {
  return (
    message?.message_type === "incoming" ||
    message?.message_type === 0
  );
}

function isPrivate(message) {
  return message?.private === true;
}

function senderIsContact(message) {
  const type = String(message?.sender_type || message?.sender?.type || "").toLowerCase();
  return !type || type === "contact";
}

async function cw(path, options = {}) {
  const response = await fetch(`${cfg.chatwootBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      api_access_token: cfg.chatwootToken,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function getConversation(conversationId) {
  return cw(
    `/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}`
  );
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
    {
      method: "POST",
      body: JSON.stringify({ labels: clean }),
    }
  );
}

async function mergeLabels(conversationId, add = [], remove = []) {
  const current = await getLabels(conversationId);
  const next = new Set(current.filter((label) => allowedLabels.has(label)));

  for (const label of remove) next.delete(label);
  for (const label of add) {
    if (allowedLabels.has(label)) next.add(label);
  }

  if ([...next].sort().join("|") !== [...current].sort().join("|")) {
    await setLabels(conversationId, [...next]);
  }

  return [...next];
}

async function sendMessage(conversationId, content, isPrivateNote = false) {
  return cw(
    `/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content,
        message_type: "outgoing",
        private: isPrivateNote,
      }),
    }
  );
}

function normalizeHistory(conversation) {
  const messages =
    conversation?.messages ||
    conversation?.payload?.messages ||
    [];

  return messages
    .filter((m) => !m.private && m.content)
    .slice(-cfg.maxHistory)
    .map((m) => {
      const role =
        m.message_type === "incoming" || m.message_type === 0
          ? "CLIENTE"
          : "AGENTE";
      return `${role}: ${String(m.content).trim()}`;
    })
    .join("\n");
}

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("La respuesta del modelo no contiene JSON válido.");
  }
}

async function generateDecision(conversation, labels) {
  const history = normalizeHistory(conversation);

  const instructions = `
Eres AXEL IA, agente de atención y ventas de MARTCOM dentro de Chatwoot.
Responde en español de México, con tono humano, profesional, amable y directo.
No digas que eres IA. No inventes precios, fechas, beneficios, vigencias, estados de pago,
altas, semanas cotizadas ni datos del cliente. No prometas resultados del IMSS.

Tu objetivo es entender la necesidad, pedir solo los datos necesarios y avanzar la atención.
Nunca solicites contraseñas, NIP, códigos SMS, datos completos de tarjeta ni documentos sensibles
por el chat. Cuando el caso requiera consultar pagos, vigencia, alta, documentación interna,
quejas, cancelaciones, correcciones o información que no esté en la conversación:
- responde que canalizarás el caso para revisión;
- establece handoff=true;
- incluye la etiqueta validacion;
- redacta una nota privada breve y útil para el humano.

Solo puedes administrar estas etiquetas:
asignado, cerrado, chat_basura, cliente, embarazo, no_contesta,
no_quiere_el_servicio, predictivo, proveedor, reasignado, rechazado,
seguimiento, sin_atender, validacion, venta, ya_tiene_servicio.

Criterios:
- cliente: confirmó ser cliente actual de MARTCOM.
- embarazo: menciona embarazo como parte relevante de su necesidad.
- proveedor: quiere vender, distribuir o colaborar ofreciendo servicios.
- seguimiento: existe interés pero falta decisión, dato o contacto posterior.
- validacion: requiere intervención o comprobación interna.
- ya_tiene_servicio: ya cuenta con el servicio solicitado, sin confirmar que sea MARTCOM.
- no_quiere_el_servicio: expresa claramente que no desea el servicio.
- rechazado: recibió información y decidió no continuar.
- chat_basura: spam, prueba o contenido sin relación.
- venta: úsala solamente si en el historial hay confirmación inequívoca de contratación;
  ante duda, no la uses.
- cerrado: no la agregues automáticamente en esta primera versión.
- no_contesta: no la agregues como reacción a un mensaje; se usará después en seguimientos programados.

Devuelve ÚNICAMENTE JSON válido con esta forma:
{
  "reply": "mensaje para el cliente",
  "add_labels": ["etiqueta"],
  "remove_labels": ["etiqueta"],
  "handoff": false,
  "private_note": ""
}

Reglas:
- reply debe ser breve y natural, máximo ${cfg.maxReplyChars} caracteres.
- No agregues cerrado ni no_contesta.
- Conserva predictivo y reasignado.
- No elimines asignado.
- Si handoff=true, private_note debe resumir el motivo y el punto actual.
`;

  const input = `
Etiquetas actuales: ${labels.join(", ") || "ninguna"}

Historial:
${history || "Sin historial disponible."}
`;

  const response = await openai.responses.create({
    model: cfg.model,
    instructions,
    input,
  });

  const decision = extractJson(response.output_text);
  decision.reply = String(decision.reply || "").trim().slice(0, cfg.maxReplyChars);
  decision.add_labels = Array.isArray(decision.add_labels)
    ? decision.add_labels.filter((x) => allowedLabels.has(x))
    : [];
  decision.remove_labels = Array.isArray(decision.remove_labels)
    ? decision.remove_labels.filter((x) => allowedLabels.has(x))
    : [];
  decision.handoff = Boolean(decision.handoff);
  decision.private_note = String(decision.private_note || "").trim();

  // Controles duros de la aplicación.
  decision.add_labels = decision.add_labels.filter(
    (label) => !["cerrado", "no_contesta"].includes(label)
  );
  decision.remove_labels = decision.remove_labels.filter(
    (label) => !["asignado", "predictivo", "reasignado"].includes(label)
  );

  if (decision.handoff && !decision.add_labels.includes(cfg.validationLabel)) {
    decision.add_labels.push(cfg.validationLabel);
  }

  return decision;
}

async function processIncoming(payload) {
  const message = getMessage(payload);
  const messageId = String(message?.id || "");
  const conversationId = getConversationId(payload);
  const inboxId = getInboxId(payload);

  if (!messageId || !conversationId) return;
  if (processedMessages.has(messageId)) return;
  processedMessages.set(messageId, Date.now());

  if (inboxId !== cfg.inboxId) return;
  if (!isIncoming(message) || isPrivate(message) || !senderIsContact(message)) return;
  if (!isWithinSchedule()) {
    console.log(`Fuera de horario. Conversación ${conversationId}`);
    return;
  }

  if (conversationLocks.has(conversationId)) {
    console.log(`Conversación ${conversationId} ya está en proceso.`);
    return;
  }

  conversationLocks.add(conversationId);

  try {
    await sleep(cfg.delaySeconds * 1000);

    // Se vuelve a consultar para confirmar que un humano no tomó el chat durante la espera.
    const conversation = await getConversation(conversationId);
    const actualInboxId = Number(conversation?.inbox_id || conversation?.inbox?.id);
    const actualAssigneeId = Number(
      conversation?.meta?.assignee?.id ||
      conversation?.assignee?.id
    );
    const status = String(conversation?.status || "").toLowerCase();

    if (actualInboxId !== cfg.inboxId) return;
    if (actualAssigneeId !== cfg.aiAgentId) {
      console.log(`Conversación ${conversationId} ya no está asignada a AXEL IA.`);
      return;
    }
    if (["resolved", "closed"].includes(status)) return;

    let labels = await mergeLabels(
      conversationId,
      [cfg.assignedLabel],
      [cfg.unattendedLabel]
    );

    if (labels.some((label) => terminalLabels.has(label))) {
      console.log(`Conversación ${conversationId} tiene etiqueta terminal.`);
      return;
    }

    const decision = await generateDecision(conversation, labels);

    labels = await mergeLabels(
      conversationId,
      decision.add_labels,
      decision.remove_labels
    );

    if (decision.reply) {
      await sendMessage(conversationId, decision.reply, false);
    }

    if (decision.handoff && decision.private_note) {
      await sendMessage(
        conversationId,
        `AXEL IA solicita intervención humana.\n\n${decision.private_note}`,
        true
      );
    }

    console.log(
      JSON.stringify({
        event: "processed",
        conversationId,
        labels,
        handoff: decision.handoff,
      })
    );
  } catch (error) {
    console.error(`Error en conversación ${conversationId}:`, error);
    try {
      await mergeLabels(conversationId, [cfg.validationLabel], []);
      await sendMessage(
        conversationId,
        `AXEL IA encontró un error técnico y requiere revisión humana.\n\n${String(error.message).slice(0, 500)}`,
        true
      );
    } catch (secondaryError) {
      console.error("No se pudo registrar el error en Chatwoot:", secondaryError);
    }
  } finally {
    conversationLocks.delete(conversationId);
  }
}

async function processConversationUpdate(payload) {
  const conversationId = getConversationId(payload);
  const inboxId = getInboxId(payload);
  const assigneeId = getAssigneeId(payload);

  if (!conversationId || inboxId !== cfg.inboxId || assigneeId !== cfg.aiAgentId) {
    return;
  }

  try {
    await mergeLabels(
      conversationId,
      [cfg.assignedLabel],
      [cfg.unattendedLabel]
    );
    console.log(`Conversación ${conversationId} recibida por AXEL IA.`);
  } catch (error) {
    console.error("Error al etiquetar conversación asignada:", error);
  }
}

app.get("/", (_req, res) => {
  res.json({
    service: "martcom-chatwoot-ai",
    status: "ok",
    schedule: `${cfg.startHour}:00-${cfg.endHour}:00 ${cfg.timezone}`,
    inbox_id: cfg.inboxId,
    agent_id: cfg.aiAgentId,
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/webhook/chatwoot", (req, res) => {
  if (
    cfg.webhookSecret &&
    req.query.secret !== cfg.webhookSecret
  ) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Contestamos rápido a Chatwoot y procesamos después.
  res.status(200).json({ received: true });

  const event = String(req.body?.event || "");
  if (event === "message_created") {
    void processIncoming(req.body);
  } else if (event === "conversation_updated") {
    void processConversationUpdate(req.body);
  }
});

app.listen(cfg.port, "0.0.0.0", () => {
  console.log(`AXEL IA escuchando en puerto ${cfg.port}`);
});
