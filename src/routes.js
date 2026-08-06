import express from "express";
import { inspectorPage } from "./inspector/page.js";
import { conversationIdOf, inboxIdOf, isContact, isIncoming, messageOf, messagesOf } from "./utils/conversation.js";

export function createRouter({ config, memories, buffer, inspectorEvents }) {
  const router = express.Router();


  function inspectorAuthorized(req) {
    if (!config.inspector.token) return false;
    return req.get("x-inspector-token") === config.inspector.token || req.query.token === config.inspector.token;
  }

  router.get("/inspector", (_req, res) => res.type("html").send(inspectorPage()));
  router.get("/inspector/api/health", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    res.json({ status: "ok", version: "3.0.1.2", architecture: "modular", memoryFile: config.storage.memoryFile, eventsFile: config.storage.inspectorEventsFile });
  });
  router.get("/inspector/api/conversations", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    const allMemories = typeof memories.list === "function"
      ? memories.list()
      : Object.entries(memories.data || {}).map(([id]) => ({
          id: Number(id),
          ...memories.get(Number(id)),
        }));

    const items = allMemories
      .filter(memory => Number.isFinite(Number(memory.id)))
      .map(memory => ({
        id: Number(memory.id),
        nombre: memory.nombre,
        necesidad: memory.necesidad_principal,
        fase: memory.flujo?.fase,
        plan: memory.ventas?.plan_recomendado,
        asesor: memory.asesor_presentacion,
        actualizado_en: memory.actualizado_en,
      }));
    res.json({ items });
  });
  router.get("/inspector/api/conversations/:conversationId", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    const id = Number(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "conversation_id inválido" });
    res.json({ conversationId: id, memory: memories.get(id), timeline: inspectorEvents.get(id) });
  });

  router.get("/", (_req, res) => res.json({
    service: "martcom-ai-sales-intelligence",
    version: "3.0.1.2",
    status: "ok",
    architecture: "modular",
    memory_file: config.storage.memoryFile,
    rotation_file: config.storage.rotationFile,
    intro_agents: config.ai.introAgents,
    message_buffer_ms: config.ai.bufferMs,
    schedule: `${config.ai.startHour}:00-${config.ai.endHour}:00 ${config.ai.timezone}`,
    inbox_id: config.chatwoot.inboxId,
    agent_id: config.chatwoot.agentId,
  }));

  router.get("/health", (_req, res) => res.json({ status: "ok", version: "3.0.1.2", timestamp: new Date().toISOString() }));
  router.get("/memory/:conversationId", (req, res) => {
    const id = Number(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "conversation_id inválido" });
    res.json(memories.get(id));
  });
  router.delete("/memory/:conversationId", async (req, res) => {
    if (config.webhookSecret && req.query.secret !== config.webhookSecret) return res.status(401).json({ error: "unauthorized" });
    const id = Number(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "conversation_id inválido" });
    await memories.clear(id);
    res.json({ deleted: true, conversationId: id });
  });

  router.post("/webhook/chatwoot", (req, res) => {
    if (config.webhookSecret && req.query.secret !== config.webhookSecret) return res.status(401).json({ error: "unauthorized" });
    res.status(200).json({ received: true });
    const event = String(req.body?.event || "");
    const id = conversationIdOf(req.body);
    if (!id) return;

    if (event === "message_created") {
      const message = messageOf(req.body);
      if (!message?.id || inboxIdOf(req.body) !== config.chatwoot.inboxId || !isIncoming(message) || message.private === true || !isContact(message)) return;
      buffer.enqueue(id, message, "message_created", req.body);
    } else if (event === "conversation_updated") {
      const conversation = req.body?.conversation || req.body;
      const inbox = Number(conversation?.inbox_id || conversation?.inbox?.id || inboxIdOf(req.body));
      const agent = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id || req.body?.assignee?.id);
      if (inbox && inbox !== config.chatwoot.inboxId) return;
      if (agent && agent !== config.chatwoot.agentId) return;
      const messages = messagesOf(conversation);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && isIncoming(message) && !message.private && isContact(message)) {
          buffer.enqueue(id, message, "conversation_updated", req.body);
          return;
        }
      }
      console.log(`Actualización ${id} recibida sin mensaje entrante utilizable; no se consulta Chatwoot.`);
    }
  });

  return router;
}
