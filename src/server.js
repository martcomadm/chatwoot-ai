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
import { UserStore } from "./operations/access/user-store.js";
import { SessionStore } from "./operations/access/session-store.js";
import { OpsSettingsStore } from "./operations/access/settings-store.js";
import { OpsAuditStore } from "./operations/access/audit-store.js";
import { TurnLock } from "./core/turn-lock.js";
import path from "node:path";

// Última barrera: una promesa rechazada sin manejar se registra en vez de tumbar el
// servicio (Node termina el proceso por defecto y se perderían los mensajes en espera).
process.on("unhandledRejection", reason => {
  console.error("NEXT: promesa rechazada sin manejar:", reason?.stack || reason?.message || reason);
});

try {
  const config = loadConfig();
  // Sin límite, el SDK espera hasta 10 minutos por intento y deja la conversación trabada.
  const openai = new OpenAI({ apiKey: config.openai.apiKey, timeout: config.openai.timeoutMs, maxRetries: config.openai.maxRetries });
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
  const opsUsers = new UserStore(config.storage.opsUsersFile);
  const opsSessions = new SessionStore(config.storage.opsSessionsFile);
  const opsSettings = new OpsSettingsStore(config.storage.opsSettingsFile, config.storage.opsAccountsImageFile);
  const opsAudit = new OpsAuditStore(config.storage.opsAuditFile);
  const workflowBridge = new ChatwootWorkflowBridge({ saleStore, chatwoot, labels, memories, inspectorEvents, customerServiceTeamId: config.operations.customerServiceTeamId, settings: opsSettings });
  workflowBridge.start();
  workflowBridge.reconcileCompletedSales().catch(error=>console.error("NEXT reconciliación de completados:",error));
  workflowBridge.retryPendingDeliveries().catch(error=>console.error("NEXT reintento de documentos pendientes:",error));
  setInterval(()=>workflowBridge.retryPendingDeliveries().catch(error=>console.error("NEXT reintento de documentos pendientes:",error)),15*60*1000).unref();
  const ai = new AiServices(openai, { ...config.openai, ...config.ai });
  const turnLock = new TurnLock(path.join(config.storage.dataDir, "turn-locks"));
  turnLock.prune();
  setInterval(() => turnLock.prune(), 6 * 60 * 60 * 1000).unref();
  const processor = new ConversationProcessor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter, workflow, turnLock, isMiaPaused: () => opsSettings.miaPaused() });
  const buffer = new MessageBuffer(config.ai.bufferMs, (id, snapshot) => processor.process(id, snapshot), {
    onError: (id, error, snapshot) => inspectorEvents.record(id, "processing_error", { error: String(error?.message || error).slice(0, 500), message_ids: (snapshot?.ids || []).map(String) }),
  });

  const app = express();
  app.use(express.json({ limit: "16mb" }));

  // Segunda barrera de aislamiento para Inbox compartido.
  // Por defecto NEXT solo procesa message_created asignados al usuario LAB.
  // Excepción acotada: si existe un expediente de ESA conversación esperando pago,
  // permitimos el evento para que el comprobante pueda registrarse aunque Operaciones
  // haya cambiado la asignación del chat. El processor mantiene el resto de guardas.
  app.use(async (req, res, next) => {
    if (req.method !== "POST" || req.path !== "/webhook/chatwoot") return next();
    // Validar el secreto ANTES de consultar Chatwoot o el SaleStore: sin esto,
    // cualquiera podía provocar llamadas a la API de Chatwoot con webhooks falsos.
    if (config.webhookSecret && req.query.secret !== config.webhookSecret) return res.status(401).json({ error: "unauthorized" });
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

    // Algunos canales (p. ej. WhatsApp) no incluyen assignee en message_created.
    // No descartamos esos eventos a ciegas: verificamos la asignación real en Chatwoot.
    // Esto mantiene el aislamiento de NEXT y permite que attachments lleguen al router.
    try {
      if (conversationId) {
        const freshConversation = await chatwoot.getConversation(conversationId);
        const freshAssigneeId = Number(
          freshConversation?.meta?.assignee?.id ||
          freshConversation?.assignee?.id ||
          0
        );
        if (freshAssigneeId === Number(config.chatwoot.agentId)) {
          console.log(`NEXT permitió message_created de conversación ${conversationId} tras verificar asignación LAB en Chatwoot.`);
          return next();
        }
        console.log(`NEXT ignoró message_created de conversación ${conversationId}: asignación real ${freshAssigneeId || "sin agente"}, esperada ${config.chatwoot.agentId}.`);
      } else {
        console.log("NEXT ignoró message_created sin conversation_id verificable.");
      }
    } catch (error) {
      console.error(`NEXT no pudo verificar asignación real de conversación ${conversationId || "desconocida"}:`, error?.message || error);
    }
    return res.status(200).json({ received: true, ignored: true, reason: "assignee_not_allowed" });
  });

  app.use(createOperationsRouter({ config, saleStore, workflow, memories, inspectorEvents, buffer, users: opsUsers, sessions: opsSessions, settings: opsSettings, audit: opsAudit }));
  app.use(createRouter({ config, memories, buffer, inspectorEvents, handoffRotation, operationsConfig, chatwoot }));

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`MARTCOM AI NEXT escuchando en puerto ${config.port}`);
    console.log(`Identidad pública: ${config.ai.publicName}`);
    console.log(`Memoria persistente: ${config.storage.memoryFile}`);
    console.log(`Expedientes de venta: ${config.storage.salesFile}`);
    console.log(`Operations: /operations · realtime SSE · ${opsUsers.count()} usuarios`);
    if (!opsUsers.count()) console.log(opsSettings && config.operations.token ? "Operations sin usuarios: entra a /operations y crea el primer administrador con OPERATIONS_TOKEN." : "Operations sin usuarios y sin OPERATIONS_TOKEN: configura OPERATIONS_TOKEN para crear el primer administrador.");
    console.log(`Chatwoot Workflow Bridge: activo`);
    console.log(`Inspector: /inspector`);
  });
} catch (error) {
  console.error("No se pudo iniciar MARTCOM AI NEXT:", error);
  process.exit(1);
}
