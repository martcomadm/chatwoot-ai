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

try {
  const config=loadConfig(),openai=new OpenAI({apiKey:config.openai.apiKey}),chatwoot=new ChatwootApi(config.chatwoot),labels=new LabelService(chatwoot),memories=new MemoryStore(config.storage.memoryFile),agentRotation=new AgentRotationStore(config.storage.rotationFile,config.ai.introAgents),inspectorEvents=new InspectorEventStore(config.storage.inspectorEventsFile,config.inspector.maxEventsPerConversation),handoffRotation=new HandoffRotationStore(config.storage.handoffRotationFile),operationsConfig=new OperationsConfigStore(config.storage.handoffConfigFile,{weekday:config.handoff.weekdayAgents,saturday:config.handoff.saturdayAgents,sunday:config.handoff.sundayAgents}),handoffRouter=new HandoffRouter({config,store:handoffRotation,chatwoot,operationsConfig}),ai=new AiServices(openai,{...config.openai,...config.ai}),processor=new ConversationProcessor({config,chatwoot,labels,memories,agentRotation,ai,inspectorEvents,handoffRouter}),buffer=new MessageBuffer(config.ai.bufferMs,(id,snapshot)=>processor.process(id,snapshot));
  const app=express();app.use(express.json({limit:"4mb"}));app.use(createRouter({config,memories,buffer,inspectorEvents,handoffRotation,operationsConfig}));
  app.listen(config.port,"0.0.0.0",()=>{
    console.log(`MARTCOM AI V3.4.0 escuchando en puerto ${config.port}`);
    console.log(`Arquitectura modular activa`);console.log(`Buffer de mensajes: ${config.ai.bufferMs} ms`);console.log(`Memoria persistente: ${config.storage.memoryFile}`);console.log(`Inspector: /inspector · versión 1.7`);console.log(`Advisor Affinity: activo`);console.log(`Conversational Judgment Engine: activo`);console.log(`Autonomous Sales Engine: activo`);console.log(`Auto handoff: ${config.handoff.enabled?"activo":"desactivado"}`);console.log(`Operations Control Center: ${config.inspector.adminToken?"activo":"solo lectura (sin INSPECTOR_ADMIN_TOKEN)"}`);console.log(`Domingo: ${config.handoff.sundayAgents.map(a=>`${a.name}(${a.id})`).join(" -> ")||"sin agentes"}`);console.log(`Sábado: ${config.handoff.saturdayAgents.map(a=>`${a.name}(${a.id})`).join(" -> ")||"sin agentes"}`);
  });
}catch(error){console.error("No se pudo iniciar MARTCOM AI V3.4.0:",error);process.exit(1)}
