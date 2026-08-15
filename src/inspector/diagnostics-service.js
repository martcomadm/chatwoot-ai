import fs from "node:fs";
import path from "node:path";

function fileDiagnostic(name, filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const exists = fs.existsSync(filePath);
    fs.accessSync(path.dirname(filePath), fs.constants.R_OK | fs.constants.W_OK);
    return { name, status: "ok", detail: exists ? `Accesible: ${filePath}` : `Directorio escribible; el archivo se creará al usarse: ${filePath}` };
  } catch (error) {
    return { name, status: "error", detail: error.message };
  }
}

export function buildDiagnostics({ config, memories, inspectorEvents }) {
  const recentEvents = typeof inspectorEvents?.listAll === "function" ? inspectorEvents.listAll() : [];
  const recentFallbacks = recentEvents.filter((event) => event.type === "chatwoot_read_fallback").slice(-20);
  const recentAiErrors = recentEvents.filter((event) => ["openai_error", "processor_error"].includes(event.type)).slice(-20);

  const components = [
    { name: "Core Engine", status: "ok", detail: "Proceso Node.js activo." },
    { name: "OpenAI", status: config.openai.apiKey ? (recentAiErrors.length ? "warning" : "ok") : "error", detail: config.openai.apiKey ? (recentAiErrors.length ? `${recentAiErrors.length} error(es) recientes registrados.` : `Modelo configurado: ${config.openai.model}`) : "OPENAI_API_KEY no configurada." },
    { name: "Chatwoot lectura", status: recentFallbacks.length ? "warning" : "ok", detail: recentFallbacks.length ? `Fallback de webhook activo; ${recentFallbacks.length} fallo(s) de lectura en eventos recientes.` : "Sin fallos de lectura registrados en el historial disponible." },
    { name: "Chatwoot escritura", status: config.chatwoot.token ? "ok" : "error", detail: config.chatwoot.token ? "Token configurado." : "Token no configurado." },
    fileDiagnostic("Memory Engine", config.storage.memoryFile),
    fileDiagnostic("Inspector Event Store", config.storage.inspectorEventsFile),
    fileDiagnostic("Rotación de presentación", config.storage.rotationFile),
    fileDiagnostic("Rotación de handoff", config.storage.handoffRotationFile),
    { name: "Advisor Affinity / Auto Handoff", status: config.handoff.enabled ? "ok" : "warning", detail: config.handoff.enabled ? `Activo · Afinidad activa · Domingo ${config.handoff.sundayAgents.length} agente(s) · Sábado ${config.handoff.saturdayAgents.length} agente(s) · Entre semana ${config.handoff.weekdayAgents.length} agente(s).` : "Desactivado por configuración." },
    { name: "Intent Engine", status: "ok", detail: "V3.1 activo y observable." },
    { name: "Message Buffer", status: "ok", detail: `${config.ai.bufferMs} ms.` },
    { name: "Horario", status: "ok", detail: `${config.ai.startHour}:00-${config.ai.endHour}:00 · ${config.ai.timezone}` },
    { name: "Memorias cargadas", status: "ok", detail: `${typeof memories.list === "function" ? memories.list().length : Object.keys(memories.data || {}).length} conversación(es).` },
  ];

  const overall = components.some((item) => item.status === "error") ? "error" : components.some((item) => item.status === "warning") ? "warning" : "ok";
  return { overall, checkedAt: new Date().toISOString(), components };
}
