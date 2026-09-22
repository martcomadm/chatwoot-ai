import { extractFast, containsCurp, containsNss } from "../memory/fast-extractor.js";
import { analyzeSales, planNext, answered } from "../sales/sales-engine.js";
import { checkReply } from "../ai/quality-checker.js";
import { mergeMemory } from "../ai/services.js";
import { fallbackDecision } from "./fallback.js";
import { contextualActivityPatch, enforcePreAuthorizationDecision } from "./next-commercial-guard.js";
import { progressiveOpeningDecision, compactPlanRecommendation, contextualPlanExplanation, disclosureViolations } from "../sales/progressive-disclosure.js";
import { needGuardDecision, suppressRecommendationWithoutNeed } from "../sales/need-before-recommendation.js";
import { commitmentDecision } from "../sales/commitment-flow.js";
import { analyzeNextSale } from "../sales/next-sales-engine.js";
import { directAnswerDecision, protectDeterministicDecision, isDeterministicDecision, stripDecisionMetadata } from "./deterministic-decision-policy.js";
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

const allowedLabels=new Set(["asignado","cerrado","chat_basura","cliente","embarazo","no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado","seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const protectedLabels=new Set(["asignado","predictivo","reasignado","cliente","venta"]);
function batchFrom(conversation,snapshot,memories,conversationId){const all=messagesOf(conversation);const wanted=new Set(snapshot.ids||[]);const webhook=[...(snapshot.webhookMessages?.values?.()||[])];let batch=all.filter(m=>m?.id&&wanted.has(String(m.id))&&isIncoming(m)&&m.private!==true&&isContact(m));if(!batch.length)batch=webhook.filter(m=>isIncoming(m)&&m.private!==true&&isContact(m));return batch.filter(m=>!memories.hasProcessed(conversationId,m.id));}
function explicitHumanRequest(text){return /\b(humano|persona|asesor|asesora|ejecutivo|ejecutiva|agente real|hablar con alguien|atencion personal|atención personal)\b/i.test(text||"");}
function paymentProofAttachment(messages=[]){
  for(const message of messages||[]){
    const attachments=Array.isArray(message?.attachments)?message.attachments:[];
    for(const attachment of attachments){
      const type=String(attachment?.file_type||attachment?.extension||attachment?.content_type||"").toLowerCase();
      if(type.includes("audio")||type.includes("video")) continue;
      const proof_url=attachment?.data_url||attachment?.download_url||attachment?.file_url||attachment?.url||null;
      const proof_name=attachment?.file_name||attachment?.filename||attachment?.name||"comprobante";
      if(proof_url||attachment?.id) return {proof_url,proof_name,attachment_id:attachment?.id||null,file_type:type||null};
    }
  }
  return null;
}

export class ConversationProcessor{
constructor({config,chatwoot,labels,memories,agentRotation,ai,inspectorEvents,handoffRouter,workflow}){this.config=config;this.chatwoot=chatwoot;this.labels=labels;this.memories=memories;this.agentRotation=agentRotation;this.ai=ai;this.inspectorEvents=inspectorEvents;this.handoffRouter=handoffRouter;this.workflow=workflow;}
async record(id,type,data={}){try{await this.inspectorEvents?.record(id,type,data);}catch{}}
async transfer(conversationId,conversation,reason,memory){await this.labels.mergeSafe(conversationId,[this.config.ai.validationLabel],[],conversation);const summary=await this.ai.handoffSummary(conversation,reason,memory);await this.chatwoot.sendMessage(conversationId,summary,true);await this.chatwoot.sendMessage(conversationId,"Voy a pedir apoyo a una persona de nuestro equipo para continuar contigo. Ya le dejo el contexto para que no tengas que repetir todo.");let routed=null;if(typeof this.handoffRouter?.handoff==="function")routed=await this.handoffRouter.handoff(conversationId,{reason,memory});else if(typeof this.handoffRouter?.route==="function")routed=await this.handoffRouter.route({conversationId,reason,reservedAdvisor:memory?.advisor_affinity||null});await this.record(conversationId,"handoff",{reason,routed});return routed;}
async process(conversationId,snapshot){
const conversation=await this.chatwoot.getConversation(conversationId);if(Number(conversation?.inbox_id||conversation?.inbox?.id)!==Number(this.config.chatwoot.inboxId))return;const assigneeId=Number(conversation?.meta?.assignee?.id||conversation?.assignee?.id||0);if(assigneeId&&assigneeId!==Number(this.config.chatwoot.agentId))return;let currentLabels=conversation?.labels||[];if(currentLabels.some(label=>stopLabels.has(label)))return;const batch=batchFrom(conversation,snapshot,this.memories,conversationId);if(!batch.length)return;const messageIds=batch.map(m=>m.id);const combinedText=batch.map(m=>m.content||"").filter(Boolean).join("\n").trim();if(!combinedText&&!batch.some(hasAttachments)){await this.memories.markProcessedMany(conversationId,messageIds);return;}
let base=this.memories.get(conversationId);const intent=classifyIntent(combinedText,base);const salesCyclePatch=analyzeNextSale(combinedText,base).patch;const fastPatch=extractFast(combinedText,base);const activityPatch=contextualActivityPatch(combinedText,base);if(containsCurp(combinedText))fastPatch.curp_recibida=true;if(containsNss(combinedText))fastPatch.nss_recibido=true;const facts=extractConversationFacts(combinedText,base);const reliability=analyzeReliability(combinedText,base,{...fastPatch,...activityPatch,...facts.patch,intereses:{...(fastPatch.intereses||{}),...(facts.patch.intereses||{})},slots:{...(fastPatch.slots||{}),...(facts.patch.slots||{})}});const orchestration=orchestrateConversation(combinedText,base);const judgment=analyzeJudgment(combinedText,base);const patience=analyzePatience(combinedText,base);const negation=resolveNegationScope(combinedText);if(negation.status==="ambiguous"){judgment.shouldHandoff=false;judgment.directAnswer=negation.clarification;judgment.question={type:"clarify_interest",answerKey:null};}
const llmPatch=await this.ai.extractAmbiguous(base,combinedText,conversation);llmPatch.contradicciones=[];let memory=mergeMemory(base,fastPatch,facts.patch,llmPatch,activityPatch,reliability.patch,judgment.patch,patience.patch,salesCyclePatch,{orchestration:{direct_request:judgment.question||orchestration.directRequest,direct_answer:judgment.directAnswer||orchestration.directAnswer}});memory.intent=intent;memory.contradicciones=reliability.contradictions;for(const message of batch)if(hasAttachments(message))memory.documentos_recibidos=arrays(memory.documentos_recibidos,message.attachments.map(a=>a?.file_type||a?.extension||"archivo"));await this.memories.set(conversationId,memory);
const paymentSale=this.workflow?.store?.findByConversationId?.(conversationId);
const paymentProof=paymentSale?.status==="payment_requested" ? (paymentProofAttachment(batch)||paymentProofAttachment([...(snapshot?.webhookMessages?.values?.()||[])])) : null;
if(paymentProof){
  try{
    this.workflow.receivePayment(paymentSale.sale_id,{...paymentProof,by:"Mia · comprobante recibido por Chatwoot",notes:combinedText||"Comprobante enviado por el cliente"});
    await this.record(conversationId,"payment_proof_auto_detected",{sale_id:paymentSale.sale_id,proof_name:paymentProof.proof_name,attachment_id:paymentProof.attachment_id,file_type:paymentProof.file_type});
    await this.memories.markProcessedMany(conversationId,messageIds);
    return;
  }catch(error){
    await this.record(conversationId,"payment_proof_auto_detection_failed",{sale_id:paymentSale.sale_id,error:error.message});
    console.error("NEXT no pudo registrar comprobante automáticamente:",error);
  }
}
if(patience.shouldPause){await this.record(conversationId,"conversation_patience_pause",{sensitive_state:patience.state||null,reply:patience.reply});await this.chatwoot.sendMessage(conversationId,patience.reply);await this.memories.markProcessedMany(conversationId,messageIds);return;}
const b2b=orchestration.shouldHandoffB2B||memory.intent?.id==="PROVEEDOR";const frustrated=Number(memory.experiencia?.frustration_score||0)>=2||judgment.shouldHandoff;if(explicitHumanRequest(combinedText)||b2b||frustrated){if(b2b)await this.labels.mergeSafe(conversationId,["proveedor",this.config.ai.validationLabel],[],conversation);const reason=explicitHumanRequest(combinedText)?"El cliente solicitó atención humana.":b2b?"Solicitud comercial de proveedor/asesor.":judgment.handoffReason||"El caso requiere intervención humana.";await this.transfer(conversationId,conversation,reason,memory);await this.memories.markProcessedMany(conversationId,messageIds);return;}
if(memory.sales_cycle?.authorized&&this.workflow){const result=await ensureAuthorizedSale({workflow:this.workflow,memories:this.memories,inspectorEvents:this.inspectorEvents,conversationId,conversation,memory});memory=this.memories.get(conversationId);await this.record(conversationId,"authorized_sale_workflow",{sale_id:result.sale?.sale_id,status:result.sale?.status,documents_complete:result.sale?.documents?.complete,missing:result.sale?.documents?.missing||[]});}
const sales=analyzeSales(memory);let planner=planNext({...memory,ventas:sales});const directRequest=judgment.question||orchestration.directRequest;if(directRequest)planner={...planner,direct_answer_first:true,direct_request:directRequest.type,customer_question_priority:true};
if(directRequest&&["curp","nss"].includes(planner?.question_key))planner={...planner,question_key:null,customer_question_priority:true};if(!memory.sales_cycle?.authorized&&["curp","nss"].includes(planner?.question_key))planner={...planner,action:"continuar_venta",question_key:null,specialized:true};if(["curp","nss"].includes(planner?.question_key)&&sensitiveSlotSuppressed(memory,planner.question_key))planner={action:"esperar_o_continuar_sin_dato_sensible",question_key:null,specialized:true};if(memory.sales_cycle?.authorized)planner={action:"expediente_onboarding",question_key:memory.operations?.onboarding_next||null,specialized:true,operations:memory.operations};memory.ventas=sales;memory.flujo={fase:memory.sales_cycle?.authorized?"operaciones":"venta",siguiente_paso:planner.question_key};await this.memories.set(conversationId,memory);

let decision;
const onboardingDecision=buildOnboardingDecision(memory,combinedText);
const openingDecision=progressiveOpeningDecision(memory,combinedText);
const needDecision=needGuardDecision(memory,combinedText);
const contextualExplanation=contextualPlanExplanation(base,combinedText);
const compactRecommendation=compactPlanRecommendation(memory,combinedText);
const directDecision=directAnswerDecision({judgment,orchestration});
const commitment=commitmentDecision(memory,combinedText);
if(directDecision)decision=directDecision;
else if(contextualExplanation)decision=protectDeterministicDecision(contextualExplanation,"contextual_plan_explanation");
else if(commitment)decision=protectDeterministicDecision(commitment,`commitment:${commitment.commitment}`);
else if(memory.sales_cycle?.authorized&&onboardingDecision)decision=protectDeterministicDecision(onboardingDecision,"onboarding");
else if(openingDecision)decision=protectDeterministicDecision(openingDecision,"progressive_opening");
else if(needDecision)decision=protectDeterministicDecision(needDecision,"need_discovery");
else if(compactRecommendation)decision=protectDeterministicDecision(compactRecommendation,"compact_plan_recommendation");
else decision=await this.ai.generateDecision(conversation,currentLabels,memory,planner,combinedText);
if(!isDeterministicDecision(decision)&&!answered(combinedText,decision))decision=fallbackDecision(memory,planner);
if(!isDeterministicDecision(decision))decision=enforcePreAuthorizationDecision(decision,memory);
if(!isDeterministicDecision(decision))decision=suppressRecommendationWithoutNeed(decision,memory);
const violations=disclosureViolations(decision,memory,combinedText);if(violations.length&&!isDeterministicDecision(decision))decision=fallbackDecision(memory,planner);
const quality=checkReply(decision,memory);if(!quality.ok&&!isDeterministicDecision(decision))decision=await this.ai.repairDecision(conversation,memory,planner,combinedText,decision,quality.reasons||[]);
if(!decision?.reply)decision=fallbackDecision(memory,planner);
decision=stripDecisionMetadata(decision);
await this.chatwoot.sendMessage(conversationId,decision.reply);
memory={...memory,ultima_respuesta_agente:decision.reply,ultima_pregunta:decision.question_key||null};
await this.memories.set(conversationId,memory);
await this.memories.markProcessedMany(conversationId,messageIds);
await this.record(conversationId,"ai_reply_sent",{reply:decision.reply,decision_source:decision.__source||null});
}
}
