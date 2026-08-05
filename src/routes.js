import express from "express";
import { conversationIdOf, inboxIdOf, isContact, isIncoming, messageOf, messagesOf } from "./utils/conversation.js";

export function createRouter({ config, memories, buffer }) {
  const router = express.Router();

  router.get("/", (_req, res) => res.json({
    service: "martcom-ai-sales-intelligence",
    version: "3.0.0",
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

  router.get("/health", (_req, res) => res.json({ status: "ok", version: "3.0.0", timestamp: new Date().toISOString() }));
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
