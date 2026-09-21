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
import { ChatwootWorkflowBridge } from "./operations/chatwoot-workflow-bridge.js";
import { webhookEventAllowedForAgent } from "./utils/webhook-isolation.js";

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
  const workflowBridge = new ChatwootWorkflowBridge({ saleStore, chatwoot, labels, memories, inspectorEvents, customerServiceTeamId: config.operations.customerServiceTeamId });
  workflowBridge.start();
  workflowBridge.reconcileCompletedSales().catch(error=>console.error("NEXT reconciliación de completados:",error));
  const ai = new AiServices(openai, { ...config.openai, ...config.ai });
  const processor = new ConversationProcessor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter, workflow });
  const buffer = new MessageBuffer(config.ai.bufferMs, (id, snapshot) => processor.process(id, snapshot));

  const app = express();
  app.use(express.json({ limit: "16mb" }));

  // Segunda barrera de aislamiento para Inbox compartido.
  // Por defecto NEXT solo procesa message_created asignados al usuario LAB.
  // Excepción acotada: si existe un expediente de ESA conversación esperando pago,
  // permitimos el evento para que el comprobante pueda registrarse aunque Operaciones
  // haya cambiado la asignación del chat. El processor mantiene el resto de guardas.
  app.use((req, res, next) => {
    if (req.method !== "POST" || req.path !== "/webhook/chatwoot") return next();
    if (String(req.body?.event || "") !== "message_created") return next();
    if (webhookEventAllowedForAgent(req.body, config.chatwoot.agentId)) return next();

    const conversationId = Number(
      req.body?.conversation?.id ||
      req.body?.message?.conversation_id ||
      req.body?.conversation_id ||
      0
    );
    const paymentSale = conversationId ? saleStore.findByConversationId(conversationId) : null;
    if (paymentSale?.status === "payment_requested") {
      console.log(`NEXT permitió message_created de pago para conversación ${conversationId} aunque no esté asignada al usuario LAB.`);
      return next();
    }

    console.log("NEXT ignoró message_created: conversación no asignada explícitamente al usuario LAB.");
    return res.status(200).json({ received: true, ignored: true, reason: "assignee_not_allowed" });
  });

  app.use(createOperationsRouter({ config, saleStore, workflow, memories, inspectorEvents }));
  app.use(createRouter({ config, memories, buffer, inspectorEvents, handoffRotation, operationsConfig }));

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`MARTCOM AI NEXT escuchando en puerto ${config.port}`);
    console.log(`Identidad pública: ${config.ai.publicName}`);
    console.log(`Memoria persistente: ${config.storage.memoryFile}`);
    console.log(`Expedientes de venta: ${config.storage.salesFile}`);
    console.log(`Operations: /operations · realtime SSE`);
    console.log(`Chatwoot Workflow Bridge: activo`);
    console.log(`Inspector: /inspector`);
  });
} catch (error) {
  console.error("No se pudo iniciar MARTCOM AI NEXT:", error);
  process.exit(1);
}
