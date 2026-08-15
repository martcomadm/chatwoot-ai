import { extractFast, containsCurp, containsNss } from "../memory/fast-extractor.js";
import { analyzeSales, planNext, answered } from "../sales/sales-engine.js";
import { checkReply } from "../ai/quality-checker.js";
import { mergeMemory } from "../ai/services.js";
import { fallbackDecision } from "./fallback.js";
import { arrays, hasAttachments, historyOf, isContact, isIncoming, messagesOf } from "../utils/conversation.js";
import { stopLabels } from "../chatwoot/labels.js";
import { classifyIntent } from "../intent/intent-engine.js";
import { analyzeReliability } from "../semantic/reliability.js";
import { markConflictResolved } from "../semantic/conflict-resolver.js";
import { orchestrateConversation } from "../orchestrator/conversation-orchestrator.js";
import { extractConversationFacts } from "../orchestrator/fact-extractor.js";

const allowedLabels = new Set(["asignado","cerrado","chat_basura","cliente","embarazo","no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado","seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const protectedLabels = new Set(["asignado","predictivo","reasignado","cliente","venta"]);

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeAdvisorSignature(reply, advisor) {
  let text = String(reply || "").trim();
  const name = String(advisor || "").trim();
  if (!text || !name) return text;

  const escaped = escapeRegExp(name);
  const trailingSignature = new RegExp(
    `(?:\\n|^)[ \t]*(?:atentamente[,.:;-]?[ \t]*|saludos[,.:;-]?[ \t]*|[-–—][ \t]*)?${escaped}[ \t]*[.!]?$`,
    "i"
  );

  text = text.replace(trailingSignature, "").trim();
  return text;
}

function handoffReason(messages, combinedText) {
  if (messages.some(hasAttachments)) return "El cliente envió uno o más archivos o documentos.";
  if (containsCurp(combinedText)) return "El cliente proporcionó una CURP.";
  if (containsNss(combinedText)) return "El cliente proporcionó un NSS.";
  const lower = combinedText.toLowerCase();
  const human = ["quiero hablar con un asesor","quiero hablar con una persona","comuníqueme con un asesor","comuniqueme con un asesor","pueden llamarme","puede llamarme","quiero una llamada","háblenme","hablenme"];
  if (human.some(value => lower.includes(value))) return "El cliente solicitó atención directa de un asesor.";
  const paid = ["ya hice el pago","ya realicé el pago","ya realice el pago","ya pagué","ya pague","te envío el comprobante","te envio el comprobante","adjunto el comprobante"];
  if (paid.some(value => lower.includes(value))) return "El cliente reportó un pago o comprobante.";
  return null;
}

function batchFrom(conversation, snapshot, memories, conversationId) {
  const allMessages = messagesOf(conversation);
  const requested = new Set(snapshot.ids);
  const webhookMessages = [...snapshot.webhookMessages.values()];
  let batch = allMessages.filter(message => message?.id && requested.has(String(message.id)) && isIncoming(message) && message?.private !== true && isContact(message));
  if (!batch.length) batch = webhookMessages.filter(message => message?.id && requested.has(String(message.id)) && isIncoming(message) && message?.private !== true && isContact(message));
  if (!batch.length && webhookMessages.length) batch = webhookMessages.filter(message => isIncoming(message) && message?.private !== true && isContact(message));
  if (!batch.length) {
    for (let index = allMessages.length - 1; index >= 0; index -= 1) {
      const message = allMessages[index];
      if (message && isIncoming(message) && message?.private !== true && isContact(message)) { batch = [message]; break; }
    }
  }
  return [...new Map(batch.filter(message => message?.id).map(message => [String(message.id), message])).values()]
    .filter(message => !memories.hasProcessed(conversationId, message.id))
    .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
}

export class ConversationProcessor {
  constructor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter }) {
    this.config = config;
    this.chatwoot = chatwoot;
    this.labels = labels;
    this.memories = memories;
    this.agentRotation = agentRotation;
    this.ai = ai;
    this.inspectorEvents = inspectorEvents;
    this.handoffRouter = handoffRouter;
    this.conversationCache = new Map();
  }

  inSchedule() {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: this.config.ai.timezone, hour: "2-digit", hour12: false }).formatToParts(new Date());
    const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
    return hour >= this.config.ai.startHour && hour < this.config.ai.endHour;
  }

  async ensureAdvisorAffinity(id, memory) {
    if (memory?.advisor_affinity?.agent_id) return memory;

    // Conversaciones anteriores a V3.2.2: si ya se presentó un asesor, intentamos
    // vincular ese nombre al usuario real del turno sin cambiar lo que vio el cliente.
    if (memory?.presentacion_realizada && memory?.asesor_presentacion && this.handoffRouter) {
      const matched = this.handoffRouter.findAgentByName(memory.asesor_presentacion);
      if (matched?.agent?.id) {
        const affinity = {
          agent_id: matched.agent.id,
          agent_name: matched.agent.name,
          group: matched.group,
          rotation_position: null,
          total_agents: this.handoffRouter.agentsFor(matched.group).length,
          reserved_at: new Date().toISOString(),
          status: "legacy_matched",
          source: "legacy_presentation_match",
        };
        const updated = { ...memory, advisor_affinity: affinity };
        await this.memories.set(id, updated);
        await this.record(id, "advisor_affinity_legacy_matched", { affinity, presentation: memory.asesor_presentacion });
        return updated;
      }
    }

    if (this.handoffRouter) {
      const reserved = await this.handoffRouter.reserve({ conversationId: id });
      if (reserved.status === "reserved") {
        const affinity = {
          agent_id: reserved.agent.id,
          agent_name: reserved.agent.name,
          group: reserved.group,
          rotation_position: reserved.rotation_position,
          total_agents: reserved.total_agents,
          reserved_at: reserved.reserved_at,
          status: "reserved",
          source: "advisor_affinity_v3.2.2",
        };
        const presentationName = memory?.presentacion_realizada && memory?.asesor_presentacion
          ? memory.asesor_presentacion
          : reserved.agent.name;
        const updated = { ...memory, advisor_affinity: affinity, asesor_presentacion: presentationName };
        await this.memories.set(id, updated);
        await this.record(id, "advisor_affinity_reserved", { affinity });
        return updated;
      }
      await this.record(id, "advisor_affinity_skipped", { reason: reserved.reason, group: reserved.group });
    }

    // Compatibilidad: si no hay turno real configurado, conserva la rotación antigua solo para presentación.
    if (!memory?.asesor_presentacion && this.agentRotation) {
      const advisor = await this.agentRotation.next();
      const updated = { ...memory, asesor_presentacion: advisor };
      await this.memories.set(id, updated);
      await this.record(id, "advisor_affinity_fallback_intro", { advisor });
      return updated;
    }
    return memory;
  }

  async performAutoHandoff(id, reason, memory) {
    if (!this.handoffRouter) return { status: "skipped", reason: "router_not_available" };

    const attemptedAt = new Date().toISOString();
    await this.record(id, "handoff_assignment_started", { reason, attemptedAt });
    const reservedAdvisor = memory?.advisor_affinity?.agent_id
      ? memory.advisor_affinity
      : memory?.handoff?.agent_id
        ? {
            agent_id: memory.handoff.agent_id,
            agent_name: memory.handoff.agent_name,
            group: memory.handoff.group,
            rotation_position: memory.handoff.rotation_position,
            total_agents: memory.handoff.total_agents,
          }
        : null;
    const result = await this.handoffRouter.route({ conversationId: id, reason, reservedAdvisor });

    if (result.status === "completed") {
      const handoff = {
        status: "completed",
        completed: true,
        agent_id: result.agent.id,
        agent_name: result.agent.name,
        group: result.group,
        rotation_position: result.rotation_position,
        total_agents: result.total_agents,
        reason,
        assigned_at: result.assigned_at,
        last_error: null,
        last_attempt_at: attemptedAt,
      };
      const affinity = {
        ...(memory.advisor_affinity || {}),
        agent_id: result.agent.id,
        agent_name: result.agent.name,
        group: result.group,
        rotation_position: result.rotation_position ?? memory.advisor_affinity?.rotation_position ?? null,
        total_agents: result.total_agents ?? memory.advisor_affinity?.total_agents ?? null,
        status: "assigned",
        assigned_at: result.assigned_at,
      };
      await this.memories.merge(id, { advisor_affinity: affinity, handoff, flujo: { ...(memory.flujo || {}), fase: "transferencia", siguiente_paso: null } });
      await this.record(id, "handoff_assignment_completed", handoff);
      return result;
    }

    if (result.status === "failed") {
      const handoff = {
        status: "pending",
        completed: false,
        agent_id: result.agent?.id || null,
        agent_name: result.agent?.name || null,
        group: result.group || null,
        rotation_position: result.rotation_position || null,
        total_agents: null,
        reason,
        assigned_at: null,
        last_error: result.error || "Error desconocido",
        last_attempt_at: attemptedAt,
      };
      await this.memories.merge(id, { handoff });
      await this.record(id, "handoff_assignment_failed", handoff);
      console.warn(`Auto handoff ${id} falló: ${handoff.last_error}`);
      return result;
    }

    await this.memories.merge(id, {
      handoff: {
        status: "skipped",
        completed: false,
        reason,
        group: result.group || null,
        last_error: result.reason || null,
        last_attempt_at: attemptedAt,
      },
    });
    await this.record(id, "handoff_assignment_skipped", result);
    return result;
  }

  async transfer(id, conversation, reason, memory, clientMessage = "Gracias, ya tengo la información necesaria. Voy a revisar tu caso para darte la orientación adecuada.") {
    await this.labels.mergeSafe(id, [this.config.ai.validationLabel], [], conversation);
    await this.chatwoot.sendMessage(id, clientMessage);
    let summary;
    try { summary = await this.ai.handoffSummary(conversation, reason, memory); }
    catch { summary = `AXEL IA - RESUMEN\nMotivo de transferencia: ${reason}\nRevisar historial completo.`; }
    await this.chatwoot.sendMessage(id, summary, true);
    await this.record(id, "handoff_summary_created", { reason });
    return this.performAutoHandoff(id, reason, memory);
  }

  async record(conversationId, type, details = {}) {
    try { await this.inspectorEvents?.record(conversationId, type, details); }
    catch (error) { console.warn(`Inspector no pudo registrar ${type}: ${error.message}`); }
  }

  async process(conversationId, snapshot) {
    await this.record(conversationId, "buffer_flush", { messageIds: snapshot.ids, sources: snapshot.sources });
    if (!this.inSchedule()) { console.log(`Fuera de horario. Conversación ${conversationId}`); await this.record(conversationId, "ignored_out_of_schedule"); return; }

    let conversation;
    try {
      conversation = await this.chatwoot.getConversation(conversationId);
      this.conversationCache.set(conversationId, conversation);
    } catch (error) {
      const cached = snapshot.payload || this.conversationCache.get(conversationId);
      const fallback = cached?.conversation || cached?.message?.conversation || cached;
      if (!fallback) throw error;
      conversation = fallback;
      console.warn(`Aviso lectura ${conversationId}: ${error.message}. Se usará el contenido del webhook.`);
      await this.record(conversationId, "chatwoot_read_fallback", { error: error.message });
    }

    const inbox = Number(conversation?.inbox_id || conversation?.inbox?.id);
    const agent = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id);
    const status = String(conversation?.status || "").toLowerCase();
    if (inbox !== this.config.chatwoot.inboxId || agent !== this.config.chatwoot.agentId || ["resolved", "closed"].includes(status)) return;

    const pendingHandoffMemory = this.memories.get(conversationId);
    if (pendingHandoffMemory.handoff?.status === "pending" && !pendingHandoffMemory.handoff?.completed) {
      const retryResult = await this.performAutoHandoff(
        conversationId,
        pendingHandoffMemory.handoff.reason || "Reintento de asignación automática.",
        pendingHandoffMemory
      );
      if (retryResult.status === "completed") {
        console.log(JSON.stringify({ event: "handoff_retry_completed", version: "3.2.2", conversationId }));
        return;
      }
    }

    let currentLabels = await this.labels.mergeSafe(conversationId, [this.config.ai.assignedLabel], [this.config.ai.unattendedLabel], conversation);
    if (currentLabels.some(label => stopLabels.has(label))) return;

    const batch = batchFrom(conversation, snapshot, this.memories, conversationId);
    if (!batch.length) { await this.record(conversationId, "ignored_no_usable_messages"); return; }

    const combinedText = batch.map(message => String(message.content || "").trim()).filter(Boolean).join("\n");
    const messageIds = batch.map(message => String(message.id));

    let memory = this.memories.get(conversationId);
    memory = await this.ensureAdvisorAffinity(conversationId, memory);

    const previousCustomerImss = memory.tiene_imss;
    const intent = classifyIntent(combinedText, memory.intent);
    const memoryWithIntent = { ...memory, intent };
    const fastPatch = extractFast(combinedText, memoryWithIntent);
    const facts = extractConversationFacts(combinedText, memoryWithIntent);
    const reliability = analyzeReliability(combinedText, memoryWithIntent, { ...fastPatch, ...facts.patch, intereses: { ...(fastPatch.intereses || {}), ...(facts.patch.intereses || {}) }, slots: { ...(fastPatch.slots || {}), ...(facts.patch.slots || {}) } });
    const orchestration = orchestrateConversation(combinedText, memoryWithIntent);

    for (const event of reliability.answerEvents) await this.record(conversationId, "answer_resolved", event);
    for (const event of reliability.semanticEvents) await this.record(conversationId, "semantic_normalized", event);
    for (const event of reliability.conflictEvents) await this.record(conversationId, event.type === "conflict" ? "semantic_conflict_detected" : "semantic_equivalent", event);
    for (const event of facts.events) await this.record(conversationId, "fact_extracted", event);
    for (const event of orchestration.events) await this.record(conversationId, event.type, event);

    const llmPatch = await this.ai.extractAmbiguous(memoryWithIntent, combinedText, conversation);
    // Las contradicciones se calculan de forma determinista. El LLM no puede crear conflictos por texto libre.
    llmPatch.contradicciones = [];
    memory = mergeMemory(memoryWithIntent, llmPatch, reliability.patch, { orchestration: { direct_request: orchestration.directRequest, direct_answer: orchestration.directAnswer } });
    memory.intent = intent;
    memory.contradicciones = reliability.contradictions;

    if (memoryWithIntent.ultima_pregunta === "aclarar_contradiccion" && combinedText.trim()) {
      memory.conflictos_resueltos = markConflictResolved(memoryWithIntent, memoryWithIntent.contradicciones?.[0]?.field);
      memory.contradicciones = [];
      memory.resolved_questions = arrays(memory.resolved_questions, ["aclarar_contradiccion"]);
      await this.record(conversationId, "semantic_conflict_resolved", { source: "customer_clarification" });
    }

    const previousFrustration = Number(memoryWithIntent.experiencia?.frustration_score || 0);
    if (reliability.frustration.detected) {
      memory.experiencia = {
        ...(memory.experiencia || {}),
        frustration_score: previousFrustration + reliability.frustration.score,
        frustration_events: arrays(memory.experiencia?.frustration_events, reliability.frustration.evidence),
      };
      await this.record(conversationId, "frustration_detected", { ...reliability.frustration, total: memory.experiencia.frustration_score });
    }

    if (intent.id === "RETIRO_AFORE_FALLECIMIENTO" && memory.ultima_pregunta === "afiliado_imss_al_fallecer") {
      memory.tiene_imss = previousCustomerImss;
    }
    await this.record(conversationId, "intent_classified", { intent: memory.intent, messageIds });
    for (const message of batch) {
      if (hasAttachments(message)) memory.documentos_recibidos = arrays(memory.documentos_recibidos, message.attachments.map(item => item?.file_type || item?.extension || "archivo"));
    }

    // Circuit breaker: si el cliente ya está claramente frustrado, no seguimos interrogando.
    if (Number(memory.experiencia?.frustration_score || 0) >= 2) {
      await this.memories.set(conversationId, memory);
      const reason = "Cliente frustrado por repetición o falta de comprensión; requiere continuidad humana.";
      const message = "Tienes razón, no quiero hacerte repetir la información. Voy a revisar lo que ya me compartiste para continuar correctamente.";
      await this.transfer(conversationId, conversation, reason, memory, message);
      await this.memories.markProcessedMany(conversationId, messageIds);
      await this.record(conversationId, "frustration_handoff", { score: memory.experiencia.frustration_score, evidence: memory.experiencia.frustration_events });
      console.log(JSON.stringify({ event: "frustration_handoff", version: "3.2.2", conversationId, messageIds }));
      return;
    }

    if (orchestration.shouldHandoffB2B || memory.intent?.id === "PROVEEDOR") {
      await this.memories.set(conversationId, memory);
      await this.labels.mergeSafe(conversationId, ["proveedor", this.config.ai.validationLabel], [], conversation);
      const reason = "El cliente desea comercializar afiliaciones o establecer una relación como proveedor.";
      const message = "Claro, ese proceso es distinto a una afiliación personal. Voy a revisar contigo la parte comercial para orientarte correctamente.";
      await this.transfer(conversationId, conversation, reason, memory, message);
      await this.memories.markProcessedMany(conversationId, messageIds);
      await this.record(conversationId, "b2b_handoff", { reason, messageIds });
      console.log(JSON.stringify({ event: "b2b_handoff", version: "3.2.2", conversationId, messageIds }));
      return;
    }

    const sales = analyzeSales(memory);
    let planner = planNext({ ...memory, ventas: sales });
    if (orchestration.directRequest?.type === "trust" && ["curp","nss"].includes(planner?.question_key)) {
      planner = { action: "responder_confianza", question_key: null, specialized: true, direct_answer_first: true };
    }
    if (orchestration.directRequest) planner = { ...planner, direct_answer_first: true, direct_request: orchestration.directRequest.type };
    await this.record(conversationId, "decision_state", { sales, planner, memorySnapshot: memory });
    memory.ventas = sales;
    memory.flujo = { fase: planner.specialized ? "orientacion_especializada" : planner.action === "solicitar_curp" ? "cotizacion" : ["transferir","transferir_datos_no_disponibles"].includes(planner.action) ? "transferencia" : "diagnostico", siguiente_paso: planner.question_key };
    await this.memories.set(conversationId, memory);
    await this.record(conversationId, "memory_updated", { fase: memory.flujo?.fase, siguientePaso: memory.flujo?.siguiente_paso, intent: memory.intent?.id });
    memory = this.memories.get(conversationId);

    const reason = handoffReason(batch, combinedText);
    if (reason) {
      await this.transfer(conversationId, conversation, reason, memory);
      await this.memories.markProcessedMany(conversationId, messageIds);
      await this.record(conversationId, "handoff", { reason, messageIds, advisor: memory.asesor_presentacion });
      console.log(JSON.stringify({ event: "handoff", version: "3.2.2", conversationId, messageIds, reason, sources: snapshot.sources, memory }));
      return;
    }

    let decision = await this.ai.generateDecision(conversation, currentLabels, memory, planner, combinedText);
    decision.reply = removeAdvisorSignature(decision.reply, memory.asesor_presentacion);
    if (decision.question_key && answered(memory, decision.question_key)) {
      await this.record(conversationId, "resolved_question_blocked", { attempted: decision.question_key, planner });
      decision = fallbackDecision(memory, planner, combinedText);
    }

    let quality = checkReply(decision.reply, { memory, questionKey: decision.question_key, maxChars: this.config.ai.maxReplyChars });
    await this.record(conversationId, "quality_checked", { ok: quality.ok, reasons: quality.reasons || [], questionKey: decision.question_key });
    if (!quality.ok) {
      try {
        await this.record(conversationId, "quality_repair", { reasons: quality.reasons || [] });
        decision = await this.ai.repairDecision(conversation, memory, planner, combinedText, decision, quality.reasons);
        decision.reply = removeAdvisorSignature(decision.reply, memory.asesor_presentacion);
        quality = checkReply(decision.reply, { memory, questionKey: decision.question_key, maxChars: this.config.ai.maxReplyChars });
        await this.record(conversationId, "quality_checked", { ok: quality.ok, reasons: quality.reasons || [], questionKey: decision.question_key, afterRepair: true });
      } catch (error) { console.warn(`Aviso reparación ${conversationId}: ${error.message}`); await this.record(conversationId, "openai_error", { stage: "repairDecision", error: error.message }); }
    }
    if (!quality.ok) {
      await this.record(conversationId, "quality_fallback", { reasons: quality.reasons || [], planner });
      decision = fallbackDecision(memory, planner, combinedText);
    }

    decision.reply = removeAdvisorSignature(decision.reply, memory.asesor_presentacion);
    decision.reply = String(decision.reply || "").trim().slice(0, this.config.ai.maxReplyChars);
    decision.add_labels = Array.isArray(decision.add_labels) ? decision.add_labels.filter(label => allowedLabels.has(label) && !["cliente","venta","cerrado","no_contesta"].includes(label)) : [];
    decision.remove_labels = Array.isArray(decision.remove_labels) ? decision.remove_labels.filter(label => allowedLabels.has(label) && !protectedLabels.has(label)) : [];
    currentLabels = await this.labels.mergeSafe(conversationId, decision.add_labels, decision.remove_labels, conversation);

    if (decision.handoff || planner.action === "transferir" || planner.action === "transferir_orientacion_fallecimiento" || planner.action === "transferir_datos_no_disponibles") {
      await this.transfer(conversationId, conversation, decision.handoff_reason || "El caso requiere revisión humana.", memory);
    } else if (decision.reply) {
      if (!memory.presentacion_realizada) {
        if (!decision.reply.toLowerCase().includes(String(memory.asesor_presentacion).toLowerCase())) decision.reply = `Hola, soy ${memory.asesor_presentacion} de MARTCOM. ${decision.reply}`;
        await this.memories.merge(conversationId, { asesor_presentacion: memory.asesor_presentacion, presentacion_realizada: true });
      }
      await this.chatwoot.sendMessage(conversationId, decision.reply);
      await this.record(conversationId, "ai_reply_sent", { reply: decision.reply, questionKey: decision.question_key, planner, quality });
      const questions = decision.question_key ? arrays(memory.preguntas_realizadas, [decision.question_key]) : memory.preguntas_realizadas;
      await this.memories.merge(conversationId, { preguntas_realizadas: questions, ultima_pregunta: decision.question_key || null, ultima_respuesta_agente: decision.reply });
    }

    await this.memories.markProcessedMany(conversationId, messageIds);
    console.log(JSON.stringify({ event: "processed", version: "3.2.2", conversationId, messageIds, sources: snapshot.sources, planner, labels: currentLabels, memory: this.memories.get(conversationId) }));
  }
}
