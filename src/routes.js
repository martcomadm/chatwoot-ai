import express from "express";
import { fileURLToPath } from "node:url";
import { inspectorPage } from "./inspector/page.js";
import { buildAlerts, dashboardStats, explainDecision, filterConversations, summarizeConversation, uniqueFilterOptions } from "./inspector/inspector-service.js";
import { buildDiagnostics } from "./inspector/diagnostics-service.js";
import { conversationProgress, handoffMetrics, rotationOverview, slotStates } from "./inspector/operations-service.js";
import { conversationIdOf, inboxIdOf, isContact, isIncoming, messageOf, messagesOf } from "./utils/conversation.js";

export function createRouter({ config, memories, buffer, inspectorEvents, handoffRotation, operationsConfig }) {
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
    res.json({ status: "ok", overall: diagnostics.overall, version: "3.3.0", inspectorVersion: "1.5", architecture: "modular", lastEventAt: inspectorEvents.stats?.().lastEventAt || null, autoHandoff: config.handoff.enabled, diagnostics });
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
    version: "3.2.2",
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
    schedule: `${config.ai.startHour}:00-${config.ai.endHour}:00 ${config.ai.timezone}`,
    inbox_id: config.chatwoot.inboxId,
    agent_id: config.chatwoot.agentId,
  }));

  router.get("/health", (_req, res) => res.json({ status: "ok", version: "3.2.2", timestamp: new Date().toISOString() }));
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
