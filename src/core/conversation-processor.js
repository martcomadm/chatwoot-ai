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

const allowedLabels = new Set(["asignado","cerrado","chat_basura","cliente","embarazo","no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado","seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const protectedLabels = new Set(["asignado","predictivo","reasignado","cliente","venta"]);

function batchFrom(conversation, snapshot, memories, conversationId) {
  const all = messagesOf(conversation);
  const wanted = new Set(snapshot.ids || []);
  const webhook = [...(snapshot.webhookMessages?.values?.() || [])];
  let batch = all.filter(m => m?.id && wanted.has(String(m.id)) && isIncoming(m) && m.private !== true && isContact(m));
  if (!batch.length) batch = webhook.filter(m => isIncoming(m) && m.private !== true && isContact(m));
  if (!batch.length) batch = [...all].reverse().filter(m => isIncoming(m) && m.private !== true && isContact(m)).slice(0, 1);
  return [...new Map(batch.filter(m => m?.id).map(m => [String(m.id), m])).values()]
    .filter(m => !memories.hasProcessed(conversationId, m.id));
}

function explicitHumanRequest(text) {
  const lower = String(text || "").toLowerCase();
  return ["quiero hablar con un asesor","quiero hablar con una persona","comuníqueme con un asesor","comuniqueme con un asesor","pueden llamarme","puede llamarme","quiero una llamada","háblenme","hablenme"].some(v => lower.includes(v));
}

export class ConversationProcessor {
  constructor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter, workflow }) {
    this.config = config;
    this.chatwoot = chatwoot;
    this.labels = labels;
    this.memories = memories;
    this.agentRotation = agentRotation;
    this.ai = ai;
    this.inspectorEvents = inspectorEvents;
    this.handoffRouter = handoffRouter;
    this.workflow = workflow;
  }

  inSchedule() {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: this.config.ai.timezone, hour: "2-digit", hour12: false }).formatToParts(new Date());
    const hour = Number(parts.find(p => p.type === "hour")?.value || 0);
    return hour >= this.config.ai.startHour && hour < this.config.ai.endHour;
  }

  async record(id, type, details = {}) {
    try { await this.inspectorEvents?.record(id, type, details); } catch {}
  }

  async performAutoHandoff(id, reason, memory) {
    if (!this.handoffRouter) return { status: "skipped" };
    const result = await this.handoffRouter.route({ conversationId: id, reason, reservedAdvisor: memory?.advisor_affinity || null });
    await this.memories.merge(id, { handoff: { status: result.status, completed: result.status === "completed", reason, agent_id: result.agent?.id || null, agent_name: result.agent?.name || null, assigned_at: result.assigned_at || null, last_error: result.error || result.reason || null } });
    await this.record(id, `handoff_assignment_${result.status}`, { reason, result });
    return result;
  }

  async transfer(id, conversation, reason, memory, clientMessage = "Voy a dejar tu caso listo para que continúe directamente una persona de nuestro equipo.") {
    await this.labels.mergeSafe(id, [this.config.ai.validationLabel], [], conversation);
    await this.chatwoot.sendMessage(id, clientMessage);
    let summary;
    try { summary = await this.ai.handoffSummary(conversation, reason, memory); }
    catch { summary = `MARTCOM NEXT - RESUMEN\nMotivo de transferencia: ${reason}\nRevisar historial completo.`; }
    await this.chatwoot.sendMessage(id, summary, true);
    return this.performAutoHandoff(id, reason, memory);
  }

  async process(conversationId, snapshot) {
    await this.record(conversationId, "buffer_flush", { messageIds: snapshot.ids, sources: snapshot.sources });
    if (!this.inSchedule()) return;

    const conversation = await this.chatwoot.getConversation(conversationId);
    const inbox = Number(conversation?.inbox_id || conversation?.inbox?.id);
    const agent = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id);
    const status = String(conversation?.status || "").toLowerCase();
    if (inbox !== this.config.chatwoot.inboxId || agent !== this.config.chatwoot.agentId || ["resolved", "closed"].includes(status)) return;

    let currentLabels = await this.labels.mergeSafe(conversationId, [this.config.ai.assignedLabel], [this.config.ai.unattendedLabel], conversation);
    if (currentLabels.some(label => stopLabels.has(label))) return;

    const batch = batchFrom(conversation, snapshot, this.memories, conversationId);
    if (!batch.length) return;
    const combinedText = batch.map(m => String(m.content || "").trim()).filter(Boolean).join("\n");
    const messageIds = batch.map(m => String(m.id));

    let memory = this.memories.get(conversationId);
    const intent = classifyIntent(combinedText, memory.intent);
    const base = { ...memory, intent };
    const fastPatch = extractFast(combinedText, base);
    const facts = extractConversationFacts(combinedText, base);
    const reliability = analyzeReliability(combinedText, base, { ...fastPatch, ...facts.patch, intereses: { ...(fastPatch.intereses || {}), ...(facts.patch.intereses || {}) }, slots: { ...(fastPatch.slots || {}), ...(facts.patch.slots || {}) } });
    const orchestration = orchestrateConversation(combinedText, base);
    const judgment = analyzeJudgment(combinedText, base);
    const patience = analyzePatience(combinedText, base);
    const negation = resolveNegationScope(combinedText);
    if (negation.status === "ambiguous") {
      judgment.shouldHandoff = false;
      judgment.directAnswer = negation.clarification;
      judgment.question = { type: "clarify_interest", answerKey: null };
    }

    const llmPatch = await this.ai.extractAmbiguous(base, combinedText, conversation);
    llmPatch.contradicciones = [];
    memory = mergeMemory(base, llmPatch, reliability.patch, judgment.patch, patience.patch, {
      orchestration: { direct_request: judgment.question || orchestration.directRequest, direct_answer: judgment.directAnswer || orchestration.directAnswer },
    });
    memory.intent = intent;
    memory.contradicciones = reliability.contradictions;
    for (const message of batch) if (hasAttachments(message)) memory.documentos_recibidos = arrays(memory.documentos_recibidos, message.attachments.map(a => a?.file_type || a?.extension || "archivo"));
    await this.memories.set(conversationId, memory);

    if (patience.shouldPause) {
      await this.chatwoot.sendMessage(conversationId, patience.reply);
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }

    const b2b = orchestration.shouldHandoffB2B || memory.intent?.id === "PROVEEDOR";
    const frustrated = Number(memory.experiencia?.frustration_score || 0) >= 2 || judgment.shouldHandoff;
    if (explicitHumanRequest(combinedText) || b2b || frustrated) {
      if (b2b) await this.labels.mergeSafe(conversationId, ["proveedor", this.config.ai.validationLabel], [], conversation);
      const reason = explicitHumanRequest(combinedText) ? "El cliente solicitó atención humana." : b2b ? "Solicitud comercial de proveedor/asesor." : judgment.handoffReason || "El caso requiere intervención humana.";
      await this.transfer(conversationId, conversation, reason, memory);
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }

    // NEXT: CURP, NSS y archivos ya no provocan handoff automático. Si el cliente ya autorizó,
    // forman parte del expediente y el chat continúa bajo la identidad pública de NEXT.
    if (memory.sales_cycle?.authorized && this.workflow) {
      const result = await ensureAuthorizedSale({ workflow: this.workflow, memories: this.memories, inspectorEvents: this.inspectorEvents, conversationId, conversation, memory });
      memory = this.memories.get(conversationId);
      await this.record(conversationId, "authorized_sale_workflow", { sale_id: result.sale?.sale_id, status: result.sale?.status });
    }

    const sales = analyzeSales(memory);
    let planner = planNext({ ...memory, ventas: sales });
    const directRequest = judgment.question || orchestration.directRequest;
    if (directRequest) planner = { ...planner, direct_answer_first: true, direct_request: directRequest.type, customer_question_priority: true };
    if (!memory.sales_cycle?.authorized && ["curp","nss"].includes(planner?.question_key)) planner = { ...planner, action: "continuar_venta", question_key: null, specialized: true };
    if (["curp","nss"].includes(planner?.question_key) && sensitiveSlotSuppressed(memory, planner.question_key)) planner = { action: "esperar_o_continuar_sin_dato_sensible", question_key: null, specialized: true };
    if (memory.sales_cycle?.authorized) planner = { action: "expediente_abierto", question_key: null, specialized: true, operations: memory.operations };

    memory.ventas = sales;
    memory.flujo = { fase: memory.sales_cycle?.authorized ? "operaciones" : "venta", siguiente_paso: planner.question_key };
    await this.memories.set(conversationId, memory);

    let decision = await this.ai.generateDecision(conversation, currentLabels, memory, planner, combinedText);
    if (memory.sales_cycle?.authorized) {
      decision.handoff = false;
      decision.question_key = null;
      if (!decision.reply) decision.reply = "Perfecto. Ya inicié tu proceso y generé tu expediente. Nuestro equipo continuará con el alta y yo te avisaré por aquí conforme avance cada etapa.";
    }
    if (decision.question_key && answered(memory, decision.question_key)) decision = fallbackDecision(memory, planner, combinedText);

    let quality = checkReply(decision.reply, { memory, questionKey: decision.question_key, maxChars: this.config.ai.maxReplyChars });
    if (!quality.ok) {
      try { decision = await this.ai.repairDecision(conversation, memory, planner, combinedText, decision, quality.reasons); }
      catch { decision = fallbackDecision(memory, planner, combinedText); }
      quality = checkReply(decision.reply, { memory, questionKey: decision.question_key, maxChars: this.config.ai.maxReplyChars });
    }
    if (!quality.ok) decision = fallbackDecision(memory, planner, combinedText);

    decision.reply = String(decision.reply || "").trim().slice(0, this.config.ai.maxReplyChars);
    decision.add_labels = Array.isArray(decision.add_labels) ? decision.add_labels.filter(l => allowedLabels.has(l) && !["cliente","venta","cerrado","no_contesta"].includes(l)) : [];
    decision.remove_labels = Array.isArray(decision.remove_labels) ? decision.remove_labels.filter(l => allowedLabels.has(l) && !protectedLabels.has(l)) : [];
    currentLabels = await this.labels.mergeSafe(conversationId, decision.add_labels, decision.remove_labels, conversation);

    if (decision.handoff) {
      await this.transfer(conversationId, conversation, decision.handoff_reason || "El caso requiere intervención humana.", memory);
    } else if (decision.reply) {
      if (!memory.presentacion_realizada) {
        const publicName = this.config.ai.publicName || "Mia de MARTCOM";
        if (!decision.reply.toLowerCase().includes(publicName.toLowerCase())) decision.reply = `Hola, soy ${publicName}. ${decision.reply}`;
        await this.memories.merge(conversationId, { asesor_presentacion: publicName, presentacion_realizada: true });
      }
      await this.chatwoot.sendMessage(conversationId, decision.reply);
      const questions = decision.question_key ? arrays(memory.preguntas_realizadas, [decision.question_key]) : memory.preguntas_realizadas;
      await this.memories.merge(conversationId, { preguntas_realizadas: questions, ultima_pregunta: decision.question_key || null, ultima_respuesta_agente: decision.reply });
      await this.record(conversationId, "ai_reply_sent", { reply: decision.reply, questionKey: decision.question_key, planner, quality });
    }

    await this.memories.markProcessedMany(conversationId, messageIds);
  }
}
