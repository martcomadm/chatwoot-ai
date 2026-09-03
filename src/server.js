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
import { HandoffRotationStore, HandoffRouter, OperationsConfigStore } from "./handoff/index.js";
import { SaleStore } from "./operations/sale-store.js";
import { SaleWorkflowEngine } from "./operations/workflow-engine.js";
import { createOperationsRouter } from "./operations/operations-router.js";

try {
  const config = loadConfig();
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const chatwoot = new ChatwootApi(config.chatwoot);
  const labels = new LabelService(chatwoot);
  const memories = new MemoryStore(config.storage.memoryFile);
  const agentRotation = new AgentRotationStore(config.storage.rotationFile, config.ai.introAgents);
  const inspectorEvents = new InspectorEventStore(config.storage.inspectorEventsFile, config.inspector.maxEventsPerConversation);
  const handoffRotation = new HandoffRotationStore(config.storage.handoffRotationFile);
  const operationsConfig = new OperationsConfigStore(config.storage.handoffConfigFile, {
    weekday: config.handoff.weekdayAgents,
    saturday: config.handoff.saturdayAgents,
    sunday: config.handoff.sundayAgents,
  });
  const handoffRouter = new HandoffRouter({ config, store: handoffRotation, chatwoot, operationsConfig });
  const saleStore = new SaleStore(config.storage.salesFile);
  const workflow = new SaleWorkflowEngine(saleStore);
  const ai = new AiServices(openai, { ...config.openai, ...config.ai });
  const processor = new ConversationProcessor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter });
  const buffer = new MessageBuffer(config.ai.bufferMs, (id, snapshot) => processor.process(id, snapshot));

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(createOperationsRouter({ config, saleStore, workflow }));
  app.use(createRouter({ config, memories, buffer, inspectorEvents, handoffRotation, operationsConfig }));

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`MARTCOM AI NEXT escuchando en puerto ${config.port}`);
    console.log(`Identidad pública: ${config.ai.publicName}`);
    console.log(`Memoria persistente: ${config.storage.memoryFile}`);
    console.log(`Expedientes de venta: ${config.storage.salesFile}`);
    console.log(`Operations: /operations · realtime SSE`);
    console.log(`Inspector: /inspector`);
  });
} catch (error) {
  console.error("No se pudo iniciar MARTCOM AI NEXT:", error);
  process.exit(1);
}
