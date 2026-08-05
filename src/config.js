const required = [
  "CHATWOOT_BASE_URL", "CHATWOOT_ACCOUNT_ID", "CHATWOOT_INBOX_ID",
  "CHATWOOT_AI_AGENT_ID", "CHATWOOT_ACCESS_TOKEN", "OPENAI_API_KEY", "OPENAI_MODEL"
];

export function loadConfig() {
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Falta la variable obligatoria ${key}`);
  }

  return {
    port: Number(process.env.PORT || 3000),
    chatwoot: {
      baseUrl: process.env.CHATWOOT_BASE_URL.replace(/\/+$/, ""),
      accountId: Number(process.env.CHATWOOT_ACCOUNT_ID),
      inboxId: Number(process.env.CHATWOOT_INBOX_ID),
      agentId: Number(process.env.CHATWOOT_AI_AGENT_ID),
      token: process.env.CHATWOOT_ACCESS_TOKEN,
    },
    openai: { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    ai: {
      timezone: process.env.AI_TIMEZONE || "America/Mexico_City",
      startHour: Number(process.env.AI_START_HOUR || 7),
      endHour: Number(process.env.AI_END_HOUR || 22),
      maxHistory: Number(process.env.AI_MAX_HISTORY_MESSAGES || 50),
      bufferMs: Number(process.env.AI_MESSAGE_BUFFER_MS || 3000),
      maxReplyChars: Number(process.env.AI_MAX_REPLY_CHARS || 850),
      assignedLabel: process.env.AI_ASSIGNED_LABEL || "asignado",
      unattendedLabel: process.env.AI_UNATTENDED_LABEL || "sin_atender",
      validationLabel: process.env.AI_VALIDATION_LABEL || "validacion",
      introAgents: String(process.env.AI_INTRO_AGENTS || "Susana Solis,Carlos Ruiz,Jozic Martinez")
        .split(",").map(v => v.trim()).filter(Boolean),
    },
    storage: {
      memoryFile: process.env.MEMORY_FILE || "/app/data/conversation-memory.json",
      rotationFile: process.env.AGENT_ROTATION_FILE || "/app/data/agent-rotation.json",
    },
    webhookSecret: process.env.WEBHOOK_SECRET || "",
  };
}
