import path from "node:path";

function parseBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1","true","yes","on","si","sí"].includes(String(value).trim().toLowerCase());
}

function parseAgents(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean).map(item => {
    const [idPart, ...nameParts] = item.split(":"); const id = Number(idPart.trim());
    if (!Number.isFinite(id) || id <= 0) return null;
    return { id, name: nameParts.join(":").trim() || `Agente ${id}` };
  }).filter(Boolean);
}
function parseIds(value) { return String(value || "").split(",").map(v => Number(v.trim())).filter(v => Number.isFinite(v) && v > 0); }

const required = ["CHATWOOT_BASE_URL","CHATWOOT_ACCOUNT_ID","CHATWOOT_INBOX_ID","CHATWOOT_AI_AGENT_ID","CHATWOOT_ACCESS_TOKEN","OPENAI_API_KEY","OPENAI_MODEL","APP_ENV","ALLOWED_INBOX_IDS"];

export function validateNextIsolation(config) {
  if (String(config.appEnv || "").toLowerCase() !== "next") throw new Error("MARTCOM AI Next requiere APP_ENV=next");
  if (!Array.isArray(config.allowedInboxIds) || !config.allowedInboxIds.length) throw new Error("ALLOWED_INBOX_IDS debe contener al menos un inbox autorizado");
  if (!config.allowedInboxIds.includes(Number(config.chatwoot?.inboxId))) throw new Error(`CHATWOOT_INBOX_ID ${config.chatwoot?.inboxId} no está autorizado en ALLOWED_INBOX_IDS`);
  const agentId = Number(config.chatwoot?.agentId);
  if (!Number.isFinite(agentId) || agentId <= 0) throw new Error("CHATWOOT_AI_AGENT_ID debe identificar al usuario exclusivo de NEXT");
  if (agentId === 12) throw new Error("El agente 12 pertenece a AXEL IA de producción y está prohibido para NEXT");
  if (Number(config.chatwoot?.inboxId) === 6 && agentId !== 53) throw new Error("Inbox 6 compartido solo está autorizado para el usuario LAB 53");
  const root = path.resolve(config.storage?.dataDir || "");
  if (!root || root === "/" || root === "/app/data") throw new Error("NEXT_DATA_DIR debe ser un directorio independiente y no puede ser /app/data");
  for (const [key, file] of Object.entries(config.storage || {})) {
    if (key === "dataDir") continue;
    const resolved = path.resolve(String(file || ""));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${key} debe permanecer dentro de NEXT_DATA_DIR (${root})`);
  }
  return true;
}

export function loadConfig() {
  for (const key of required) if (!process.env[key]) throw new Error(`Falta la variable obligatoria ${key}`);
  const dataDir = path.resolve(process.env.NEXT_DATA_DIR || "/app/data-next");
  const config = {
    appEnv: String(process.env.APP_ENV || "").trim().toLowerCase(), allowedInboxIds: parseIds(process.env.ALLOWED_INBOX_IDS), port: Number(process.env.PORT || 3000),
    chatwoot: { baseUrl: process.env.CHATWOOT_BASE_URL.replace(/\/+$/, ""), accountId: Number(process.env.CHATWOOT_ACCOUNT_ID), inboxId: Number(process.env.CHATWOOT_INBOX_ID), agentId: Number(process.env.CHATWOOT_AI_AGENT_ID), token: process.env.CHATWOOT_ACCESS_TOKEN },
    openai: { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    ai: { timezone: process.env.AI_TIMEZONE || "America/Mexico_City", startHour: Number(process.env.AI_START_HOUR || 7), endHour: Number(process.env.AI_END_HOUR || 22), maxHistory: Number(process.env.AI_MAX_HISTORY_MESSAGES || 50), bufferMs: Number(process.env.AI_MESSAGE_BUFFER_MS || 3000), maxReplyChars: Number(process.env.AI_MAX_REPLY_CHARS || 850), assignedLabel: process.env.AI_ASSIGNED_LABEL || "asignado", unattendedLabel: process.env.AI_UNATTENDED_LABEL || "sin_atender", validationLabel: process.env.AI_VALIDATION_LABEL || "validacion", publicName: process.env.AI_PUBLIC_NAME || "Mia de MARTCOM", introAgents: String(process.env.AI_INTRO_AGENTS || "Mia de MARTCOM").split(",").map(v => v.trim()).filter(Boolean) },
    storage: { dataDir, memoryFile: process.env.MEMORY_FILE || path.join(dataDir,"conversation-memory.json"), rotationFile: process.env.AGENT_ROTATION_FILE || path.join(dataDir,"agent-rotation.json"), handoffRotationFile: process.env.HANDOFF_ROTATION_FILE || path.join(dataDir,"handoff-rotation.json"), inspectorEventsFile: process.env.INSPECTOR_EVENTS_FILE || path.join(dataDir,"inspector-events.json"), handoffConfigFile: process.env.HANDOFF_CONFIG_FILE || path.join(dataDir,"handoff-config.json"), salesFile: process.env.SALES_FILE || path.join(dataDir,"sales.json") },
    handoff: { enabled: parseBool(process.env.AUTO_HANDOFF,true), sundayAgents: parseAgents(process.env.HANDOFF_SUNDAY_AGENTS || "25:Elizabeth Aguilera,20:Jonathan Nuñez,31:Tonatiuh Ramirez"), saturdayAgents: parseAgents(process.env.HANDOFF_SATURDAY_AGENTS || "40:Alberto Gonzalez,26:Pamela Montiel,32:Vicente Martinez"), weekdayAgents: parseAgents(process.env.HANDOFF_WEEKDAY_AGENTS || "") },
    webhookSecret: process.env.WEBHOOK_SECRET || "",
    inspector: { token: process.env.INSPECTOR_TOKEN || "", maxEventsPerConversation: Number(process.env.INSPECTOR_MAX_EVENTS_PER_CONVERSATION || 200), adminToken: process.env.INSPECTOR_ADMIN_TOKEN || "" },
    operations: { token: process.env.OPERATIONS_TOKEN || process.env.INSPECTOR_ADMIN_TOKEN || "" },
  };
  validateNextIsolation(config); return config;
}
