import express from "express";
import { describeSchedule, parseSchedule } from "./core/business-hours.js";
import { fileURLToPath } from "node:url";
import { inspectorPage } from "./inspector/page.js";
import { buildAlerts, dashboardStats, explainDecision, filterConversations, summarizeConversation, uniqueFilterOptions } from "./inspector/inspector-service.js";
import { buildDiagnostics } from "./inspector/diagnostics-service.js";
import { conversationProgress, handoffMetrics, rotationOverview, slotStates } from "./inspector/operations-service.js";
import { conversationIdOf, inboxIdOf, isContact, isIncoming, messageOf, messagesOf } from "./utils/conversation.js";
import { buildAnalytics } from "./inspector/analytics-service.js";
import { trace } from "./utils/debug-trace.js";
import { APP_VERSION } from "./version.js";

export function createRouter({ config, memories, buffer, inspectorEvents, handoffRotation, operationsConfig, chatwoot }) {
  const router = express.Router();
  const inspectorPublicPath = fileURLToPath(new URL("./inspector/public/", import.meta.url));
  router.use("/inspector/assets", express.static(inspectorPublicPath, {
    fallthrough: false,
    maxAge: "5m",
    etag: true,
  }));


  function inspectorAuthorized(req) {
    if (!config.inspector.token) return false;
    return req.get("x-inspector-token") === config.inspector.token || req.query.token === config.inspector.token;
  }
  function inspectorAdminAuthorized(req) {
    if (!config.inspector.adminToken) return false;
    return req.get("x-inspector-admin-token") === config.inspector.adminToken;
  }

  router.get("/inspector", (_req, res) => res.type("html").send(inspectorPage()));
  router.get("/inspector/api/health", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    const diagnostics = buildDiagnostics({ config, memories, inspectorEvents });
    res.json({ status: "ok", overall: diagnostics.overall, version: APP_VERSION, inspectorVersion: "1.6", architecture: "modular", lastEventAt: inspectorEvents.stats?.().lastEventAt || null, autoHandoff: config.handoff.enabled, diagnostics });
  });
  router.get("/inspector/api/dashboard", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    const all = (typeof memories.list === "function" ? memories.list() : Object.entries(memories.data || {}).map(([id]) => ({ id: Number(id), ...memories.get(Number(id)) })))
      .filter(memory => Number.isFinite(Number(memory.id)))
      .map(memory => summarizeConversation(memory, inspectorEvents.get(Number(memory.id)), memory.id));
    const events = typeof inspectorEvents.listAll === "function" ? inspectorEvents.listAll() : [];
    const filtered = filterConversations(all, req.query, config.ai.timezone);
    const ids = new Set(filtered.map(item=>Number(item.id)));
    const filteredEvents = events.filter(event=>ids.has(Number(event.conversationId)));
    res.json({ stats: dashboardStats(filtered, filteredEvents), filters: uniqueFilterOptions(all), handoffs: handoffMetrics(filtered), rotations: rotationOverview(config, handoffRotation, operationsConfig), range:{from:req.query.from||null,to:req.query.to||null} });
  });
  router.get("/inspector/api/diagnostics", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    res.json(buildDiagnostics({ config, memories, inspectorEvents }));
  });
  router.get("/inspector/api/conversations", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    const allMemories = typeof memories.list === "function"
      ? memories.list()
      : Object.entries(memories.data || {}).map(([id]) => ({ id: Number(id), ...memories.get(Number(id)) }));
    const items = allMemories
      .filter(memory => Number.isFinite(Number(memory.id)))
      .map(memory => summarizeConversation(memory, inspectorEvents.get(Number(memory.id)), memory.id));
    res.json({ items: filterConversations(items, req.query, config.ai.timezone) });
  });
  router.get("/inspector/api/conversations/:conversationId", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    const id = Number(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "conversation_id inválido" });
    const memory = memories.get(id);
    const timeline = inspectorEvents.get(id);
    res.json({
      conversationId: id,
      memory,
      timeline,
      alerts: buildAlerts(memory, timeline),
      explanation: explainDecision(memory, timeline),
      diagnostics: buildDiagnostics({ config, memories, inspectorEvents }),
      progress: conversationProgress(memory),
      slots: slotStates(memory),
      rotations: rotationOverview(config, handoffRotation, operationsConfig),
    });
  });


  router.get("/inspector/api/analytics", (req,res)=>{
    if(!inspectorAuthorized(req)) return res.status(401).json({error:"Token del Inspector inválido"});
    try{
      return res.json(buildAnalytics({
        memories:typeof memories.list==="function"?memories.list():[],
        events:inspectorEvents?.list?inspectorEvents.list():[],
        from:req.query.from||null,to:req.query.to||null,timezone:config.ai.timezone
      }));
    }catch(error){
      console.error("Analytics error:",error);
      return res.status(500).json({error:"No se pudo generar Analytics",detail:error.message});
    }
  });

  router.get("/inspector/api/control/rotations", (req,res)=>{
    if(!inspectorAuthorized(req)) return res.status(401).json({error:"Token del Inspector inválido"});
    const state = operationsConfig.snapshot();
    res.json({
      adminEnabled:Boolean(config.inspector.adminToken),
      groups:state.groups,
      agents:operationsConfig.allAgents(),
      exceptions:state.exceptions,
      audit:(state.audit||[]).slice().reverse().slice(0,100),
      rotations:rotationOverview(config,handoffRotation,operationsConfig)
    });
  });

  router.put("/inspector/api/control/rotations/:group", express.json(), async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.setGroup(req.params.group, req.body?.agents, "inspector-admin");
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });


  router.post("/inspector/api/control/agents", express.json(), async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.addMasterAgent({id:req.body?.id,name:req.body?.name},"inspector-admin");
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });

  router.post("/inspector/api/control/agents/remove", express.json(), async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.removeAgentFromGroup(
        req.body?.group,
        req.body?.agentId,
        "inspector-admin"
      );
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });

  router.delete("/inspector/api/control/agents/:id", async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.deleteMasterAgent(req.params.id,"inspector-admin");
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });

  router.post("/inspector/api/control/agents/move", express.json(), async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.moveAgent({
        sourceGroup:req.body?.sourceGroup,
        targetGroup:req.body?.targetGroup,
        agentId:req.body?.agentId
      },"inspector-admin");
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });

  router.post("/inspector/api/control/agents/copy", express.json(), async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.copyAgent({
        targetGroup:req.body?.targetGroup,
        agentId:req.body?.agentId
      },"inspector-admin");
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });

  router.put("/inspector/api/control/exceptions/:date", express.json(), async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.setException(req.params.date, req.body?.agents, "inspector-admin");
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });

  router.delete("/inspector/api/control/exceptions/:date", async (req,res)=>{
    if(!inspectorAdminAuthorized(req)) return res.status(401).json({error:"Token administrador inválido"});
    try{
      const state = await operationsConfig.deleteException(req.params.date, "inspector-admin");
      return res.json({ok:true,state});
    }catch(error){ return res.status(400).json({error:error.message}); }
  });

  router.get("/", (_req, res) => res.json({
    service: "martcom-ai-sales-intelligence",
    version: APP_VERSION,
    app_env: config.appEnv,
    status: "ok",
    architecture: "modular",
    memory_file: config.storage.memoryFile,
    rotation_file: config.storage.rotationFile,
    handoff_rotation_file: config.storage.handoffRotationFile,
    intro_agents: config.ai.introAgents,
    auto_handoff: config.handoff.enabled,
    handoff_sunday_agents: config.handoff.sundayAgents,
    handoff_saturday_agents: config.handoff.saturdayAgents,
    handoff_weekday_agents: config.handoff.weekdayAgents,
    message_buffer_ms: config.ai.bufferMs,
    schedule: `${describeSchedule(parseSchedule(config.ai.schedule))} · ${config.ai.timezone}`,
    inbox_id: config.chatwoot.inboxId,
    agent_id: config.chatwoot.agentId,
  }));

  router.get("/health", (_req, res) => res.json({ status: "ok", version: APP_VERSION, timestamp: new Date().toISOString() }));
  // La memoria contiene datos personales (nombre, CURP, NSS): exige token del Inspector.
  router.get("/memory/:conversationId", (req, res) => {
    if (!inspectorAuthorized(req)) return res.status(401).json({ error: "Token del Inspector inválido" });
    const id = Number(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "conversation_id inválido" });
    res.json(memories.get(id));
  });
  router.delete("/memory/:conversationId", async (req, res) => {
    // Antes, sin WEBHOOK_SECRET configurado cualquiera podía borrar memoria.
    const secretOk = Boolean(config.webhookSecret) && req.query.secret === config.webhookSecret;
    if (!secretOk && !inspectorAdminAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
    const id = Number(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "conversation_id inválido" });
    await memories.clear(id);
    res.json({ deleted: true, conversationId: id });
  });

  router.post("/webhook/chatwoot", async (req, res) => {
    if (config.webhookSecret && req.query.secret !== config.webhookSecret) return res.status(401).json({ error: "unauthorized" });
    res.status(200).json({ received: true });
    const event = String(req.body?.event || "");
    const id = conversationIdOf(req.body);
    if (!id) return;

    if (event === "message_created") {
      const message = messageOf(req.body);
      const attachmentList = Array.isArray(message?.attachments) ? message.attachments : [];
      trace("webhook",({
        conversation: id,
        message: message?.id ? String(message.id) : null,
        inbox: inboxIdOf(req.body) || null,
        message_type: message?.message_type ?? null,
        sender_type: message?.sender_type || message?.sender?.type || null,
        private: message?.private === true,
        attachments: attachmentList.length,
        attachment_keys: attachmentList.map(item => Object.keys(item || {})),
        attachment_types: attachmentList.map(item => String(item?.file_type || item?.content_type || item?.extension || "")),
        attachment_has_url: attachmentList.map(item => Boolean(item?.data_url || item?.download_url || item?.file_url || item?.url)),
        payload_keys: Object.keys(req.body || {}),
        message_keys: message && typeof message === "object" ? Object.keys(message) : [],
      }));
      if (!message?.id || inboxIdOf(req.body) !== config.chatwoot.inboxId || !isIncoming(message) || message.private === true || !isContact(message)) {
        trace("webhook_rejected",({
          conversation: id,
          message: message?.id ? String(message.id) : null,
          has_id: Boolean(message?.id),
          inbox_ok: inboxIdOf(req.body) === config.chatwoot.inboxId,
          incoming: isIncoming(message),
          contact: isContact(message),
          private: message?.private === true,
          attachments: attachmentList.length,
        }));
        return;
      }
      const queued = buffer.enqueue(id, message, "message_created", req.body);
      trace("buffer_enqueue",({ conversation: id, message: String(message.id), attachments: attachmentList.length, queued }));
    } else if (event === "conversation_updated") {
      const conversation = req.body?.conversation || req.body;
      const inbox = Number(conversation?.inbox_id || conversation?.inbox?.id || inboxIdOf(req.body));
      const agent = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id || req.body?.assignee?.id);
      if (inbox && inbox !== config.chatwoot.inboxId) return;
      if (agent && agent !== config.chatwoot.agentId) return;
      const messages = messagesOf(conversation);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && message.id && isIncoming(message) && !message.private && isContact(message) && !memories.hasProcessed(id, message.id)) {
          buffer.enqueue(id, message, "conversation_updated", req.body);
          return;
        }
      }
      try {
        const fresh = await chatwoot.getMessages(id);
        const freshMessages = Array.isArray(fresh?.payload) ? fresh.payload : Array.isArray(fresh) ? fresh : messagesOf(fresh);
        for (let index = freshMessages.length - 1; index >= 0; index -= 1) {
          const message = freshMessages[index];
          if (message && message.id && isIncoming(message) && !message.private && isContact(message) && !memories.hasProcessed(id, message.id)) {
            buffer.enqueue(id, message, "conversation_updated_recovery", req.body);
            console.log(`Actualización ${id}: mensaje entrante ${message.id} recuperado desde Chatwoot.`);
            return;
          }
        }
        console.log(`Actualización ${id} recibida sin mensaje entrante nuevo utilizable, incluso tras consultar Chatwoot.`);
      } catch (error) {
        console.error(`No se pudo recuperar la conversación ${id} tras conversation_updated:`, error?.message || error);
      }
    }
  });

  return router;
}
