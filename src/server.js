import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { loadConfig } from "./config.js";
import { ChatwootApi } from "./chatwoot/api.js";
import { LabelService } from "./chatwoot/labels.js";
import { MemoryStore } from "./memory/memory-store.js";
import { AgentRotationStore } from "./memory/agent-rotation-store.js";
import { AiServices } from "./ai/services.js";
import { ConversationProcessor } from "./core/conversation-processor.js";
import { MessageBuffer } from "./core/message-buffer.js";
import { createRouter } from "./routes.js";
import { InspectorEventStore } from "./inspector/event-store.js";

try {
  const config = loadConfig();
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const chatwoot = new ChatwootApi(config.chatwoot);
  const labels = new LabelService(chatwoot);
  const memories = new MemoryStore(config.storage.memoryFile);
  const agentRotation = new AgentRotationStore(config.storage.rotationFile, config.ai.introAgents);
  const inspectorEvents = new InspectorEventStore(config.storage.inspectorEventsFile, config.inspector.maxEventsPerConversation);
  const ai = new AiServices(openai, { ...config.openai, ...config.ai });
  const processor = new ConversationProcessor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents });
  const buffer = new MessageBuffer(config.ai.bufferMs, (id, snapshot) => processor.process(id, snapshot));

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(createRouter({ config, memories, buffer, inspectorEvents }));

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`MARTCOM AI V3.1.0 escuchando en puerto ${config.port}`);
    console.log(`Arquitectura modular activa`);
    console.log(`Buffer de mensajes: ${config.ai.bufferMs} ms`);
    console.log(`Memoria persistente: ${config.storage.memoryFile}`);
    console.log(`Inspector: /inspector`);
    console.log(`Rotación: ${config.ai.introAgents.join(" -> ")}`);
  });
} catch (error) {
  console.error("No se pudo iniciar MARTCOM AI V3.1.0:", error);
  process.exit(1);
}
