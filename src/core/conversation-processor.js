import { extractFast, containsCurp, containsNss } from "../memory/fast-extractor.js";
import { analyzeSales, planNext, answered } from "../sales/sales-engine.js";
import { checkReply } from "../ai/quality-checker.js";
import { mergeMemory } from "../ai/services.js";
import { fallbackDecision } from "./fallback.js";
import { arrays, hasAttachments, isContact, isIncoming, messagesOf } from "../utils/conversation.js";
import { stopLabels } from "../chatwoot/labels.js";
import { classifyIntent } from "../intent/intent-engine.js";
import { analyzeReliability } from "../semantic/reliability.js";
import { resolveNegationScope } from "../semantic/negation-scope-resolver.js";
import { orchestrateConversation } from "../orchestrator/conversation-orchestrator.js";
import { extractConversationFacts } from "../orchestrator/fact-extractor.js";
import { analyzeJudgment } from "../orchestrator/conversational-judgment.js";
import { analyzePatience, sensitiveSlotSuppressed } from "../semantic/conversational-patience.js";
import { ensureAuthorizedSale } from "../operations/sale-factory.js";
import { buildOnboardingDecision } from "../operations/onboarding-service.js";

const allowedLabels = new Set(["asignado","cerrado","chat_basura","cliente","embarazo","no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado","seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const protectedLabels = new Set(["asignado","predictivo","reasignado","cliente","venta"]);

function batchFrom(conversation, snapshot, memories, conversationId) {
  const all = messagesOf(conversation);
  const wanted = new Set(snapshot.ids || []);
  const webhook = [...(snapshot.webhookMessages?.values?.() || [])];
  let batch = all.filter(m => m?.id && wanted.has(String(m.id)) && isIncoming(m) && m.private !== true && isContact(m));
  if (!batch.length) batch = webhook.filter(m => isIncoming(m) && m.private !== true && isContact(m));
  return batch.filter(m => !memories.isProcessed(conversationId, m.id));
}
function explicitHumanRequest(text) { return /\b(humano|persona|asesor|asesora|ejecutivo|ejecutiva|agente real|hablar con alguien|atencion personal|atención personal)\b/i.test(text || ""); }

export class ConversationProcessor {
  constructor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter, workflow }) {
    this.config=config; this.chatwoot=chatwoot; this.labels=labels; this.memories=memories; this.agentRotation=agentRotation; this.ai=ai; this.inspectorEvents=inspectorEvents; this.handoffRouter=handoffRouter; this.workflow=workflow;
  }
  async record(id,type,data={}) { try { await this.inspectorEvents?.record(id,type,data); } catch {} }
  async transfer(conversationId, conversation, reason, memory) {
    await this.labels.mergeSafe(conversationId,[this.config.ai.validationLabel],[],conversation);
    const summary = await this.ai.handoffSummary(conversation, reason, memory);
    await this.chatwoot.sendMessage(conversationId, summary, true);
    await this.chatwoot.sendMessage(conversationId,"Voy a pedir apoyo a una persona de nuestro equipo para continuar contigo. Ya le dejo el contexto para que no tengas que repetir todo.");
    let routed = null;
    if (typeof this.handoffRouter?.handoff === "function") routed = await this.handoffRouter.handoff(conversationId,{ reason, memory });
    else if (typeof this.handoffRouter?.route === "function") routed = await this.handoffRouter.route({ conversationId, reason, reservedAdvisor: memory?.advisor_affinity || null });
    await this.record(conversationId,"handoff",{ reason, routed });
    return routed;
  }

  async process(conversationId, snapshot) {
    const conversation = await this.chatwoot.getConversation(conversationId);
    if (Number(conversation?.inbox_id || conversation?.inbox?.id) !== Number(this.config.chatwoot.inboxId)) return;
    const assigneeId = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id || 0);
    if (assigneeId && assigneeId !== Number(this.config.chatwoot.agentId)) return;
    let currentLabels = conversation?.labels || [];
    if (currentLabels.some(label => stopLabels.has(label))) return;
    const batch = batchFrom(conversation,snapshot,this.memories,conversationId);
    if (!batch.length) return;
    const messageIds = batch.map(m=>m.id);
    const combinedText = batch.map(m=>m.content||"").filter(Boolean).join("\n").trim();
    if (!combinedText && !batch.some(hasAttachments)) { await this.memories.markProcessedMany(conversationId,messageIds); return; }

    let base = this.memories.get(conversationId);
    const intent = classifyIntent(combinedText, base);
    const fastPatch = extractFast(combinedText, base);
    if (containsCurp(combinedText)) fastPatch.curp_recibida = true;
    if (containsNss(combinedText)) fastPatch.nss_recibido = true;
    const facts = extractConversationFacts(combinedText, base);
    const reliability = analyzeReliability(combinedText, base, { ...fastPatch, ...facts.patch, intereses: { ...(fastPatch.intereses || {}), ...(facts.patch.intereses || {}) }, slots: { ...(fastPatch.slots || {}), ...(facts.patch.slots || {}) } });
    const orchestration = orchestrateConversation(combinedText, base);
    const judgment = analyzeJudgment(combinedText, base);
    const patience = analyzePatience(combinedText, base);
    const negation = resolveNegationScope(combinedText);
    if (negation.status === "ambiguous") { judgment.shouldHandoff=false; judgment.directAnswer=negation.clarification; judgment.question={type:"clarify_interest",answerKey:null}; }

    const llmPatch = await this.ai.extractAmbiguous(base, combinedText, conversation);
    llmPatch.contradicciones = [];
    let memory = mergeMemory(base, fastPatch, facts.patch, llmPatch, reliability.patch, judgment.patch, patience.patch, { orchestration: { direct_request: judgment.question || orchestration.directRequest, direct_answer: judgment.directAnswer || orchestration.directAnswer } });
    memory.intent=intent; memory.contradicciones=reliability.contradictions;
    for (const message of batch) if (hasAttachments(message)) memory.documentos_recibidos=arrays(memory.documentos_recibidos,message.attachments.map(a=>a?.file_type||a?.extension||"archivo"));
    await this.memories.set(conversationId,memory);

    if (patience.shouldPause) {
      await this.record(conversationId,"conversation_patience_pause",{ sensitive_state:patience.state||null, reply:patience.reply });
      await this.chatwoot.sendMessage(conversationId,patience.reply);
      await this.memories.markProcessedMany(conversationId,messageIds);
      return;
    }
    const b2b=orchestration.shouldHandoffB2B||memory.intent?.id==="PROVEEDOR";
    const frustrated=Number(memory.experiencia?.frustration_score||0)>=2||judgment.shouldHandoff;
    if (explicitHumanRequest(combinedText)||b2b||frustrated) {
      if(b2b) await this.labels.mergeSafe(conversationId,["proveedor",this.config.ai.validationLabel],[],conversation);
      const reason=explicitHumanRequest(combinedText)?"El cliente solicitó atención humana.":b2b?"Solicitud comercial de proveedor/asesor.":judgment.handoffReason||"El caso requiere intervención humana.";
      await this.transfer(conversationId,conversation,reason,memory); await this.memories.markProcessedMany(conversationId,messageIds); return;
    }

    if (memory.sales_cycle?.authorized && this.workflow) {
      const result=await ensureAuthorizedSale({workflow:this.workflow,memories:this.memories,inspectorEvents:this.inspectorEvents,conversationId,conversation,memory});
      memory=this.memories.get(conversationId);
      await this.record(conversationId,"authorized_sale_workflow",{sale_id:result.sale?.sale_id,status:result.sale?.status,documents_complete:result.sale?.documents?.complete,missing:result.sale?.documents?.missing||[]});
    }

    const sales=analyzeSales(memory); let planner=planNext({...memory,ventas:sales});
    const directRequest=judgment.question||orchestration.directRequest;
    if(directRequest) planner={...planner,direct_answer_first:true,direct_request:directRequest.type,customer_question_priority:true};
    // Una pregunta directa nunca debe terminar inmediatamente en una solicitud de CURP/NSS.
    if(directRequest && ["curp","nss"].includes(planner?.question_key)) planner={...planner,question_key:null,customer_question_priority:true};
    if(!memory.sales_cycle?.authorized&&["curp","nss"].includes(planner?.question_key)) planner={...planner,action:"continuar_venta",question_key:null,specialized:true};
    if(["curp","nss"].includes(planner?.question_key)&&sensitiveSlotSuppressed(memory,planner.question_key)) planner={action:"esperar_o_continuar_sin_dato_sensible",question_key:null,specialized:true};
    if(memory.sales_cycle?.authorized) planner={action:"expediente_onboarding",question_key:memory.operations?.onboarding_next||null,specialized:true,operations:memory.operations};
    memory.ventas=sales; memory.flujo={fase:memory.sales_cycle?.authorized?"operaciones":"venta",siguiente_paso:planner.question_key}; await this.memories.set(conversationId,memory);

    let decision;
    const onboardingDecision=buildOnboardingDecision(memory,combinedText);
    if(memory.sales_cycle?.authorized&&onboardingDecision&&!directRequest) decision=onboardingDecision;
    else decision=await this.ai.generateDecision(conversation,currentLabels,memory,planner,combinedText);
    if(memory.sales_cycle?.authorized){decision.handoff=false;if(onboardingDecision&&!directRequest)decision.question_key=onboardingDecision.question_key;}
    if(directRequest && ["curp","nss"].includes(decision.question_key)) decision.question_key=null;
    if(decision.question_key&&answered(memory,decision.question_key)&&!memory.sales_cycle?.authorized)decision=fallbackDecision(memory,planner,combinedText);

    let quality=checkReply(decision.reply,{memory,questionKey:decision.question_key,maxChars:this.config.ai.maxReplyChars});
    if(!quality.ok){try{decision=await this.ai.repairDecision(conversation,memory,planner,combinedText,decision,quality.reasons);}catch{decision=fallbackDecision(memory,planner,combinedText);}quality=checkReply(decision.reply,{memory,questionKey:decision.question_key,maxChars:this.config.ai.maxReplyChars});}
    if(!quality.ok&&memory.sales_cycle?.authorized&&onboardingDecision)decision=onboardingDecision;else if(!quality.ok)decision=fallbackDecision(memory,planner,combinedText);
    decision.reply=String(decision.reply||"").trim().slice(0,this.config.ai.maxReplyChars);
    decision.add_labels=Array.isArray(decision.add_labels)?decision.add_labels.filter(l=>allowedLabels.has(l)&&!["cliente","venta","cerrado","no_contesta"].includes(l)):[];
    decision.remove_labels=Array.isArray(decision.remove_labels)?decision.remove_labels.filter(l=>allowedLabels.has(l)&&!protectedLabels.has(l)):[];
    currentLabels=await this.labels.mergeSafe(conversationId,decision.add_labels,decision.remove_labels,conversation);
    if(decision.handoff) await this.transfer(conversationId,conversation,decision.handoff_reason||"El caso requiere intervención humana.",memory);
    else if(decision.reply){
      if(!memory.presentacion_realizada){const publicName=this.config.ai.publicName||"Mia de MARTCOM";if(!decision.reply.toLowerCase().includes(publicName.toLowerCase()))decision.reply=`Hola, soy ${publicName}. ${decision.reply}`;await this.memories.merge(conversationId,{asesor_presentacion:publicName,presentacion_realizada:true});}
      await this.chatwoot.sendMessage(conversationId,decision.reply);
      const questions=decision.question_key?arrays(memory.preguntas_realizadas,[decision.question_key]):memory.preguntas_realizadas;
      await this.memories.merge(conversationId,{preguntas_realizadas:questions,ultima_pregunta:decision.question_key||null,ultima_respuesta_agente:decision.reply,operations:{...(memory.operations||{}),onboarding_last_requested:onboardingDecision?.onboarding_requirement||memory.operations?.onboarding_last_requested||null}});
      await this.record(conversationId,"ai_reply_sent",{reply:decision.reply,questionKey:decision.question_key,planner,quality,onboarding:onboardingDecision?.onboarding_requirement||null});
    }
    await this.memories.markProcessedMany(conversationId,messageIds);
  }
}
