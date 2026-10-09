import { extractFast, containsCurp, containsNss } from "../memory/fast-extractor.js";
import { parseSchedule, isOpen, nextOpeningDate, outOfScheduleMessage } from "./business-hours.js";
import { analyzeSales, planNext, answered } from "../sales/sales-engine.js";
import { checkReply } from "../ai/quality-checker.js";
import { mergeMemory } from "../ai/services.js";
import { fallbackDecision } from "./fallback.js";
import { contextualActivityPatch, enforcePreAuthorizationDecision } from "./next-commercial-guard.js";
import { progressiveOpeningDecision, compactPlanRecommendation, priceObjectionDecision, contextualPlanExplanation, disclosureViolations, effectivePlan } from "../sales/progressive-disclosure.js";
import { needGuardDecision, suppressRecommendationWithoutNeed, isAdvisoryTurn } from "../sales/need-before-recommendation.js";
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
import { resolveAnswer } from "../semantic/answer-resolver.js";
import { ensureAuthorizedSale } from "../operations/sale-factory.js";
import { buildOnboardingDecision } from "../operations/onboarding-service.js";
import { specializedAdviceHandoff } from "./specialized-advice-handoff.js";
import { explicitHumanRequest } from "./human-request.js";
import { trace, traceEnabled } from "../utils/debug-trace.js";
import { paymentProofAttachment } from "../operations/payment-proof.js";

// Etiqueta de Chatwoot que pausa a Mia solo en esa conversación.
export const PAUSE_LABEL = "pausar_mia";

const allowedLabels = new Set(["asignado", "cerrado", "chat_basura", "cliente", "embarazo", "no_contesta", "no_quiere_el_servicio", "predictivo", "proveedor", "reasignado", "rechazado", "seguimiento", "sin_atender", "validacion", "venta", "ya_tiene_servicio"]);
const protectedLabels = new Set(["asignado", "predictivo", "reasignado", "cliente", "venta"]);

// true si una persona del equipo (no Mia) mandó un mensaje público después de `sinceIso`.
// Mientras está cerrado Mia solo manda el aviso de horario, así que ese texto no cuenta.
function humanRepliedSince(conversation, sinceIso, miaAgentId, ignoreTexts = []) {
  const ignored = new Set(ignoreTexts.map(t => String(t || "").replace(/\s+/g, " ").trim()));
  const since = Date.parse(sinceIso || "") / 1000 || 0;
  return messagesOf(conversation).some(m => {
    const outgoing = m?.message_type === 1 || m?.message_type === "outgoing";
    const senderType = String(m?.sender_type || m?.sender?.type || "").toLowerCase();
    const senderId = Number(m?.sender_id || m?.sender?.id || 0);
    const text = String(m?.content || "").replace(/\s+/g, " ").trim();
    return outgoing && m?.private !== true && senderType === "user" && senderId !== Number(miaAgentId) && !ignored.has(text) && Number(m?.created_at || 0) >= since;
  });
}

// Mensajes del cliente que este turno debe procesar: los ids del buffer, con los
// adjuntos del webhook cuando la API de Chatwoot aún no los trae, y sin los ya procesados.
function batchFrom(conversation, snapshot, memories, conversationId) {
  const all = messagesOf(conversation);
  const wanted = new Set(snapshot.ids || []);
  const webhook = [...(snapshot.webhookMessages?.values?.() || [])];
  const webhookById = new Map(webhook.filter(m => m?.id).map(m => [String(m.id), m]));
  let batch = all
    .filter(m => m?.id && wanted.has(String(m.id)) && isIncoming(m) && m.private !== true && isContact(m))
    .map(m => {
      const hook = webhookById.get(String(m.id));
      if (!hook) return m;
      const fetchedAttachments = Array.isArray(m.attachments) ? m.attachments : [];
      const webhookAttachments = Array.isArray(hook.attachments) ? hook.attachments : [];
      return { ...hook, ...m, attachments: webhookAttachments.length ? webhookAttachments : fetchedAttachments };
    });
  if (!batch.length) batch = webhook.filter(m => isIncoming(m) && m.private !== true && isContact(m));
  return batch.filter(m => !memories.hasProcessed(conversationId, m.id));
}

// Si la memoria perdió el plan, lo recupera de los últimos 12 mensajes de la conversación.
function recoverCommercialContext(conversation, memory = {}) {
  if (memory?.sales_cycle?.selected_plan || memory?.sales_cycle?.recommended_plan) return memory;
  const recent = messagesOf(conversation).slice(-12).map(m => String(m?.content || "")).join(" ").toLowerCase();
  const plan = /\bplan\s*(2|dos)\b/.test(recent) ? "plan_2" : /\bplan\s*(1|uno)\b/.test(recent) ? "plan_1" : null;
  if (!plan) return memory;
  return { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), stage: memory.sales_cycle?.stage || "plan_recommended", recommended_plan: plan } };
}

export class ConversationProcessor {
  constructor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter, workflow, turnLock = null, isMiaPaused = () => false, afterHours = null }) {
    this.config = config;
    this.chatwoot = chatwoot;
    this.labels = labels;
    this.memories = memories;
    this.agentRotation = agentRotation;
    this.ai = ai;
    this.inspectorEvents = inspectorEvents;
    this.handoffRouter = handoffRouter;
    this.workflow = workflow;
    this.turnLock = turnLock;
    this.isMiaPaused = isMiaPaused;
    this.afterHours = afterHours;
  }

  async record(id, type, data = {}) {
    try { await this.inspectorEvents?.record(id, type, data); } catch {}
  }

  // Llama a la IA sin que un error (caída, límite de uso, tiempo agotado) detenga el turno:
  // registra el error y devuelve el valor de respaldo.
  async safeAi(conversationId, step, call, fallbackValue) {
    try {
      return await call();
    } catch (error) {
      console.error(`NEXT: falló la IA (${step}) en conversación ${conversationId}:`, error?.message || error);
      await this.record(conversationId, "ai_error", { step, error: String(error?.message || error).slice(0, 300) });
      return fallbackValue;
    }
  }

  // Handoff a un asesor humano: nota privada con resumen, aviso al cliente y asignación por rotación.
  async transfer(conversationId, conversation, reason, memory) {
    await this.labels.mergeSafe(conversationId, [this.config.ai.validationLabel], [], conversation);
    const summary = await this.safeAi(conversationId, "handoff_summary", () => this.ai.handoffSummary(conversation, reason, memory), `RESUMEN NO DISPONIBLE (falló la IA)\nMotivo de transferencia: ${reason}\nRevisa el historial de la conversación.`);
    await this.chatwoot.sendMessage(conversationId, summary, true);
    await this.chatwoot.sendMessage(conversationId, "Voy a pedir apoyo a una persona de nuestro equipo para continuar contigo. Ya le dejo el contexto para que no tengas que repetir todo.");
    let routed = null;
    if (typeof this.handoffRouter?.handoff === "function") routed = await this.handoffRouter.handoff(conversationId, { reason, memory });
    else if (typeof this.handoffRouter?.route === "function") routed = await this.handoffRouter.route({ conversationId, reason, reservedAdvisor: memory?.advisor_affinity || null });
    await this.record(conversationId, "handoff", { reason, routed });
    return routed;
  }

  // Handoff especializado: canaliza la conversación al equipo de Atención a Clientes.
  async transferToCustomerService(conversationId, conversation, reason, memory, specialized = {}) {
    await this.labels.mergeSafe(conversationId, [this.config.ai.validationLabel], [], conversation);
    const summary = await this.safeAi(conversationId, "handoff_summary", () => this.ai.handoffSummary(conversation, reason, memory), `RESUMEN NO DISPONIBLE (falló la IA)\nMotivo de transferencia: ${reason}\nRevisa el historial de la conversación.`);
    await this.chatwoot.sendMessage(conversationId, `MÍA → ATENCIÓN A CLIENTES\nMotivo: ${reason}\n\n${summary}`, true);
    await this.chatwoot.sendMessage(conversationId, "Para revisar correctamente esa parte de tu caso necesito apoyo de nuestro equipo de Atención a Clientes. Voy a canalizar tu conversación y les dejaré el contexto de lo que ya revisamos para que no tengas que repetir la información.");
    const teamId = Number(this.config.operations.customerServiceTeamId);
    const routed = await this.chatwoot.assignTeam(conversationId, teamId);
    await this.record(conversationId, "specialized_advice_handoff", { reason, kind: specialized?.kind || "specialized_advice", team_id: teamId, routed });
    return routed;
  }

  // Registra un comprobante de pago si el expediente lo espera. Devuelve true si lo registró.
  async registerPaymentProof(conversationId, batch, snapshot, combinedText) {
    const sale = this.workflow?.store?.findByConversationId?.(conversationId);
    if (sale?.status !== "payment_requested") return false;
    const proof = paymentProofAttachment(batch) || paymentProofAttachment([...(snapshot?.webhookMessages?.values?.() || [])]);
    if (!proof) return false;
    try {
      this.workflow.receivePayment(sale.sale_id, { ...proof, by: "Mia · comprobante recibido por Chatwoot", notes: combinedText || "Comprobante enviado por el cliente" });
      await this.record(conversationId, "payment_proof_auto_detected", { sale_id: sale.sale_id, proof_name: proof.proof_name, attachment_id: proof.attachment_id, file_type: proof.file_type });
      return true;
    } catch (error) {
      await this.record(conversationId, "payment_proof_auto_detection_failed", { sale_id: sale.sale_id, error: error.message });
      console.error("NEXT no pudo registrar comprobante automáticamente:", error);
      return false;
    }
  }

  // Horario de atención por día (AI_SCHEDULE). Sin horario configurado, siempre abierto.
  scheduleWeek() {
    const text = this.config.ai?.schedule;
    if (!text) return null;
    if (this._scheduleText !== text) { this._scheduleWeek = parseSchedule(text); this._scheduleText = text; }
    return this._scheduleWeek;
  }

  inSchedule(now = new Date()) {
    const week = this.scheduleWeek();
    return !week || isOpen(week, now, this.config.ai.timezone);
  }

  async notifyOutOfSchedule(conversationId, messageIds, now = new Date()) {
    const week = this.scheduleWeek();
    // Un aviso por conversación y por periodo cerrado: la clave es la fecha de la siguiente apertura.
    const period = week ? nextOpeningDate(week, now, this.config.ai.timezone) : "sin-horario";
    const firstNotice = !this.turnLock || this.turnLock.claim(conversationId, [`fuera-horario-${period}`]);
    await this.record(conversationId, "ignored_out_of_schedule", { message_ids: messageIds.map(String), notice_sent: firstNotice, reopens: period });
    if (firstNotice && week) await this.chatwoot.sendMessage(conversationId, outOfScheduleMessage(week));
  }

  async markAssigned(conversationId, currentLabels, conversation) {
    const { assignedLabel, unattendedLabel } = this.config.ai || {};
    if (!assignedLabel) return currentLabels;
    const names = currentLabels.map(label => (typeof label === "string" ? label : label?.title));
    if (names.includes(assignedLabel) && !names.includes(unattendedLabel)) return currentLabels;
    const updated = await this.labels.mergeSafe(conversationId, [assignedLabel], unattendedLabel ? [unattendedLabel] : [], conversation);
    await this.record(conversationId, "assigned_label_applied", { label: assignedLabel, removed: names.includes(unattendedLabel) ? unattendedLabel : null });
    return updated;
  }

  async process(conversationId, snapshot) {
    // ── 1. Cargar la conversación y mezclar adjuntos que solo trae el webhook ──
    const conversation = await this.chatwoot.getConversation(conversationId);
    const webhookMessages = [...(snapshot?.webhookMessages?.values?.() || [])];
    if (webhookMessages.length) {
      const byId = new Map(messagesOf(conversation).filter(m => m?.id).map(m => [String(m.id), m]));
      for (const wm of webhookMessages) {
        if (!wm?.id) continue;
        const existing = byId.get(String(wm.id));
        const wa = Array.isArray(wm.attachments) ? wm.attachments : [];
        if (existing && wa.length) existing.attachments = wa;
        else if (!existing) conversation.messages = [...(conversation.messages || []), wm];
      }
    }

    // ── 1b. Retomar mensajes que llegaron fuera de horario ──
    // Al abrir, los mensajes de la noche se atienden junto con lo que el cliente escriba ahora,
    // en un solo turno. Si una persona del equipo ya le contestó, Mia no se mete.
    let resumedAfterHours = false;
    const queued = this.afterHours?.has?.(conversationId) && this.inSchedule() ? this.afterHours.take(conversationId) : null;
    if (queued) {
      const closed = ["resolved", "closed"].includes(String(conversation?.status || "").toLowerCase());
      if (closed || humanRepliedSince(conversation, queued.first_at, this.config.chatwoot.agentId, [this.scheduleWeek() && outOfScheduleMessage(this.scheduleWeek())])) {
        await this.record(conversationId, "after_hours_skipped", { reason: closed ? "conversation_closed" : "human_replied", message_ids: queued.ids });
        await this.memories.markProcessedMany(conversationId, queued.ids);
      } else {
        snapshot = { ...(snapshot || {}), ids: [...new Set([...(snapshot?.ids || []).map(String), ...queued.ids])] };
        resumedAfterHours = true;
        await this.record(conversationId, "after_hours_resumed", { message_ids: queued.ids, since: queued.first_at });
      }
    }

    // ── 2. Guardas de aislamiento: inbox, asignación y etiquetas de alto ──
    if (Number(conversation?.inbox_id || conversation?.inbox?.id) !== Number(this.config.chatwoot.inboxId)) return;
    const assigneeId = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id || 0);
    // Una conversación reasignada a otra persona solo se procesa para registrar el
    // comprobante de un expediente que espera pago (excepción acordada con server.js).
    // En ese caso Mia NUNCA responde: solo registra el comprobante y termina.
    const reassigned = Boolean(assigneeId && assigneeId !== Number(this.config.chatwoot.agentId));
    if (reassigned && this.workflow?.store?.findByConversationId?.(conversationId)?.status !== "payment_requested") return;
    let currentLabels = conversation?.labels || [];
    if (currentLabels.some(label => stopLabels.has(label))) return;
    // Pausa: global desde Operations o por conversación con la etiqueta "pausar_mia".
    // Mia no responde ni registra nada; los mensajes quedan para que los atienda una persona.
    const pausedByLabel = currentLabels.some(label => (typeof label === "string" ? label : label?.title) === PAUSE_LABEL);
    if (pausedByLabel || this.isMiaPaused()) {
      await this.record(conversationId, "mia_paused_skip", { reason: pausedByLabel ? "label" : "global", message_ids: (snapshot?.ids || []).map(String) });
      // Se marcan como atendidos para que, al reanudar, Mia no conteste mensajes viejos.
      if (snapshot?.ids?.length) await this.memories.markProcessedMany(conversationId, snapshot.ids);
      return;
    }

    // ── 3. Armar el lote de mensajes nuevos del cliente ──
    const batch = batchFrom(conversation, snapshot, this.memories, conversationId);
    trace("processor", ({
      conversation: conversationId,
      snapshot_ids: (snapshot?.ids || []).map(String),
      webhook_messages: webhookMessages.map(m => ({ id: String(m?.id || ""), attachments: Array.isArray(m?.attachments) ? m.attachments.length : 0 })),
      batch: batch.map(m => ({ id: String(m?.id || ""), attachments: Array.isArray(m?.attachments) ? m.attachments.length : 0 })),
      authorized: Boolean(this.memories.get(conversationId)?.sales_cycle?.authorized),
      expected: this.memories.get(conversationId)?.operations?.onboarding_next || this.memories.get(conversationId)?.operations?.onboarding_last_requested || null,
    }));
    if (!batch.length) return;
    if (traceEnabled()) await this.record(conversationId, "attachment_pipeline_debug", {
      snapshot_ids: (snapshot.ids || []).map(String),
      webhook: [...(snapshot.webhookMessages?.values?.() || [])].map(m => ({
        id: String(m?.id || ""),
        attachments: Array.isArray(m?.attachments) ? m.attachments.length : 0,
        keys: (m?.attachments || []).map(x => Object.keys(x || {})),
        type: (m?.attachments || []).map(x => String(x?.file_type || x?.content_type || "")),
        has_url: (m?.attachments || []).map(x => Boolean(x?.data_url || x?.download_url || x?.file_url || x?.url)),
      })),
      batch: batch.map(m => ({
        id: String(m?.id || ""),
        attachments: Array.isArray(m?.attachments) ? m.attachments.length : 0,
        keys: (m?.attachments || []).map(x => Object.keys(x || {})),
        type: (m?.attachments || []).map(x => String(x?.file_type || x?.content_type || "")),
        has_url: (m?.attachments || []).map(x => Boolean(x?.data_url || x?.download_url || x?.file_url || x?.url)),
      })),
    });
    const messageIds = batch.map(m => m.id);
    // Fuera del horario de atención Mia no conversa: avisa una sola vez por periodo
    // cerrado y deja los mensajes sin marcar para que el equipo los vea al abrir.
    if (!this.inSchedule()) {
      this.afterHours?.add(conversationId, messageIds);
      await this.notifyOutOfSchedule(conversationId, messageIds);
      return;
    }
    // Un mismo mensaje del cliente se atiende una sola vez, aunque llegue duplicado.
    if (this.turnLock && !this.turnLock.claim(conversationId, messageIds)) {
      await this.record(conversationId, "duplicate_turn_skipped", { message_ids: messageIds.map(String) });
      return;
    }
    const combinedText = batch.map(m => m.content || "").filter(Boolean).join("\n").trim();
    if (!combinedText && !batch.some(hasAttachments)) {
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    if (reassigned) {
      await this.registerPaymentProof(conversationId, batch, snapshot, combinedText);
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    // Al recibir el chat Mia pone la etiqueta "asignado" y quita "sin_atender" (igual que producción).
    currentLabels = await this.markAssigned(conversationId, currentLabels, conversation);

    // ── 4. Análisis determinista del turno ──
    let base = recoverCommercialContext(conversation, this.memories.get(conversationId));
    const intent = classifyIntent(combinedText, base);
    const salesCyclePatch = analyzeNextSale(combinedText, base).patch;
    const fastPatch = extractFast(combinedText, base);
    const answerResolution = resolveAnswer(combinedText, base);
    const answerPatch = { ...(answerResolution.patch || {}), resolved_questions: [...(answerResolution.resolved || [])] };
    const activityPatch = contextualActivityPatch(combinedText, base);
    if (containsCurp(combinedText)) fastPatch.curp_recibida = true;
    if (containsNss(combinedText)) fastPatch.nss_recibido = true;
    const facts = extractConversationFacts(combinedText, base);
    const reliability = analyzeReliability(combinedText, base, {
      ...fastPatch,
      ...activityPatch,
      ...facts.patch,
      intereses: { ...(fastPatch.intereses || {}), ...(facts.patch.intereses || {}) },
      slots: { ...(fastPatch.slots || {}), ...(facts.patch.slots || {}) },
    });
    const orchestration = orchestrateConversation(combinedText, base);
    const judgment = analyzeJudgment(combinedText, base);
    const patience = analyzePatience(combinedText, base);
    const negation = resolveNegationScope(combinedText);
    if (negation.status === "ambiguous") {
      judgment.shouldHandoff = false;
      judgment.directAnswer = negation.clarification;
      judgment.question = { type: "clarify_interest", answerKey: null };
    }

    // ── 5. Extracción con IA (texto ambiguo y, tras autorización, documentos) ──
    const llmPatch = (await this.safeAi(conversationId, "extract", () => this.ai.extractAmbiguous(base, combinedText, conversation), {})) || {};
    llmPatch.contradicciones = [];
    let documentPatch = {};
    const documentAttachments = batch.flatMap(m => m.attachments || []);
    trace("vision_gate", ({ conversation: conversationId, authorized: Boolean(base?.sales_cycle?.authorized), attachments: documentAttachments.length, expected: base?.operations?.onboarding_next || base?.operations?.onboarding_last_requested || null }));
    if (base?.sales_cycle?.authorized && batch.some(hasAttachments)) {
      try {
        trace("vision_start", ({ conversation: conversationId, attachments: documentAttachments.length }));
        documentPatch = await this.ai.extractDocumentData(documentAttachments);
        trace("vision_result", ({ conversation: conversationId, keys: Object.keys(documentPatch || {}), ine_recibida: Boolean(documentPatch?.ine_recibida), curp_recibida: Boolean(documentPatch?.curp_recibida), nss_recibido: Boolean(documentPatch?.nss_recibido) }));
      } catch (error) { console.error("NEXT no pudo analizar documento:", error); }
    }

    // ── 6. Consolidar memoria ──
    let memory = mergeMemory(
      base, fastPatch, answerPatch, facts.patch, llmPatch, documentPatch, activityPatch,
      reliability.patch, judgment.patch, patience.patch, salesCyclePatch,
      { orchestration: { direct_request: judgment.question || orchestration.directRequest, direct_answer: judgment.directAnswer || orchestration.directAnswer } },
    );
    memory.intent = intent;
    memory.contradicciones = reliability.contradictions;
    for (const message of batch) if (hasAttachments(message)) memory.documentos_recibidos = arrays(memory.documentos_recibidos, message.attachments.map(a => a?.file_type || a?.extension || "archivo"));
    await this.memories.set(conversationId, memory);

    // ── 7. Salidas tempranas: comprobante de pago, pausa por paciencia, handoff ──
    if (await this.registerPaymentProof(conversationId, batch, snapshot, combinedText)) {
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    if (patience.shouldPause) {
      await this.record(conversationId, "conversation_patience_pause", { sensitive_state: patience.state || null, reply: patience.reply });
      await this.chatwoot.sendMessage(conversationId, patience.reply);
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    const b2b = orchestration.shouldHandoffB2B || memory.intent?.id === "PROVEEDOR";
    const frustrated = Number(memory.experiencia?.frustration_score || 0) >= 2 || judgment.shouldHandoff;
    const specialized = specializedAdviceHandoff(combinedText, memory);
    if (explicitHumanRequest(combinedText) || b2b || frustrated || specialized) {
      if (b2b) await this.labels.mergeSafe(conversationId, ["proveedor", this.config.ai.validationLabel], [], conversation);
      const reason = explicitHumanRequest(combinedText) ? "El cliente solicitó atención humana."
        : b2b ? "Solicitud comercial de proveedor/asesor."
        : specialized?.reason || judgment.handoffReason || "El caso requiere intervención humana.";
      if (specialized && Number(this.config.operations?.customerServiceTeamId) > 0) {
        await this.transferToCustomerService(conversationId, conversation, reason, memory, specialized);
        await this.memories.markProcessedMany(conversationId, messageIds);
        return;
      }
      await this.transfer(conversationId, conversation, reason, memory);
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }

    // ── 8. Venta autorizada: abrir/actualizar el expediente con los documentos recibidos ──
    if (memory.sales_cycle?.authorized && this.workflow) {
      const expectedDocument = memory.operations?.onboarding_next || memory.operations?.onboarding_last_requested || null;
      const incoming = batch.flatMap(m => (m.attachments || []).map(a => ({ ...a })));
      if (incoming.length && documentPatch?.ine_recibida === true) {
        for (const a of incoming) {
          a.file_name = `ine_${a.file_name||a.filename||a.name||"documento"}`;
          a.file_type = a.file_type || a.content_type || "image";
        }
        conversation.messages = [...(conversation.messages || []), { id: `incoming-${Date.now()}`, created_at: Date.now() / 1000, attachments: incoming }];
        await this.record(conversationId, "document_attachment_injected", { expected: expectedDocument, count: incoming.length, vision_ine: true });
      }
      const result = await ensureAuthorizedSale({ workflow: this.workflow, memories: this.memories, inspectorEvents: this.inspectorEvents, conversationId, conversation, memory });
      memory = this.memories.get(conversationId);
      await this.record(conversationId, "authorized_sale_workflow", { sale_id: result.sale?.sale_id, status: result.sale?.status, documents_complete: result.sale?.documents?.complete, missing: result.sale?.documents?.missing || [] });
      if (traceEnabled()) await this.record(conversationId, "document_sale_debug", {
        expected: expectedDocument,
        incoming_count: incoming.length,
        files: (result.sale?.documents?.files || []).map(x => ({ type: x?.type || null, message_id: x?.message_id || null, attachment_id: x?.attachment_id || null })),
        missing: result.sale?.documents?.missing || [],
      });
    }

    // ── 9. Planner: siguiente paso comercial u operativo ──
    const sales = analyzeSales(memory);
    let planner = planNext({ ...memory, ventas: sales });
    const directRequest = judgment.question || orchestration.directRequest;
    if (directRequest) planner = { ...planner, direct_answer_first: true, direct_request: directRequest.type, customer_question_priority: true };
    if (directRequest && ["curp", "nss"].includes(planner?.question_key)) planner = { ...planner, question_key: null, customer_question_priority: true };
    if (!memory.sales_cycle?.authorized && ["curp", "nss"].includes(planner?.question_key)) planner = { ...planner, action: "continuar_venta", question_key: null, specialized: true };
    if (["curp", "nss"].includes(planner?.question_key) && sensitiveSlotSuppressed(memory, planner.question_key)) planner = { action: "esperar_o_continuar_sin_dato_sensible", question_key: null, specialized: true };
    if (memory.sales_cycle?.authorized) planner = { action: "expediente_onboarding", question_key: memory.operations?.onboarding_next || null, specialized: true, operations: memory.operations };
    memory.ventas = sales;
    memory.flujo = { fase: memory.sales_cycle?.authorized ? "operaciones" : "venta", siguiente_paso: planner.question_key };
    await this.memories.set(conversationId, memory);

    // ── 10. Elegir la respuesta: reglas deterministas en orden de prioridad, luego IA ──
    let decision;
    const onboardingDecision = buildOnboardingDecision(memory, combinedText);
    const openingDecision = progressiveOpeningDecision(memory, combinedText);
    const needDecision = needGuardDecision(memory, combinedText);
    const contextualExplanation = contextualPlanExplanation(base, combinedText);
    const compactRecommendation = compactPlanRecommendation(memory, combinedText);
    const priceObjection = priceObjectionDecision(memory, combinedText);
    const directDecision = directAnswerDecision({ judgment, orchestration });
    const commitment = commitmentDecision(memory, combinedText);
    const advisoryTurn = isAdvisoryTurn(combinedText);
    if (advisoryTurn) {
      planner = { ...planner, action: "asesoria_conversacional", question_key: null, specialized: true, advisory: true, customer_question_priority: true };
      await this.record(conversationId, "advisory_turn", { text: combinedText, commercial_need: memory.commercial_need || null });
    }
    if (priceObjection) decision = protectDeterministicDecision(priceObjection, "price_objection");
    else if (directDecision) decision = directDecision;
    else if (contextualExplanation) decision = protectDeterministicDecision(contextualExplanation, "contextual_plan_explanation");
    else if (commitment) decision = protectDeterministicDecision(commitment, `commitment:${commitment.commitment}`);
    else if (memory.sales_cycle?.authorized && onboardingDecision) decision = protectDeterministicDecision(onboardingDecision, "onboarding");
    else if (openingDecision && !advisoryTurn) decision = protectDeterministicDecision(openingDecision, "progressive_opening");
    else if (needDecision && !advisoryTurn) decision = protectDeterministicDecision(needDecision, "need_discovery");
    else if (compactRecommendation && !advisoryTurn) decision = protectDeterministicDecision(compactRecommendation, "compact_plan_recommendation");
    else {
      const generated = await this.safeAi(conversationId, "decision", () => this.ai.generateDecision(conversation, currentLabels, memory, planner, combinedText), null);
      decision = generated ? { ...generated, __source: "llm" } : { ...fallbackDecision(memory, planner, combinedText), __source: "fallback_ai_error" };
    }

    // ── 11. Guardas sobre respuestas de IA (las deterministas no se tocan) ──
    // Firmas reales: answered(memory, key), checkReply(reply, {memory, questionKey, maxChars}),
    // disclosureViolations(reply, {memory, combinedText}), enforcePreAuthorizationDecision(decision,
    // {memory, planner, combinedText, fallbackDecision}). Llamarlas con otros argumentos hacía que
    // toda respuesta de la IA se reemplazara por la pregunta de respaldo.
    const fallback = () => ({ ...fallbackDecision(memory, planner, combinedText), __source: "fallback" });
    const quality = reply => checkReply(reply, { memory, questionKey: decision?.question_key, maxChars: this.config.ai.maxReplyChars });
    const applyCommercialGuards = () => {
      if (isDeterministicDecision(decision)) return;
      decision = enforcePreAuthorizationDecision(decision, { memory, planner, combinedText, fallbackDecision });
      decision = suppressRecommendationWithoutNeed(decision, memory, combinedText);
    };
    const applyDisclosureGuard = () => {
      if (isDeterministicDecision(decision)) return [];
      const reasons = disclosureViolations(decision?.reply, { memory, combinedText });
      if (reasons.length && openingDecision && !directDecision && !commitment) decision = protectDeterministicDecision(openingDecision, "progressive_opening");
      return reasons;
    };
    if (memory.sales_cycle?.authorized && decision) {
      decision.handoff = false;
      if (onboardingDecision && !directRequest && !commitment) decision.question_key = onboardingDecision.question_key;
    }
    if (directRequest && ["curp", "nss"].includes(decision?.question_key)) decision.question_key = null;
    // Si la IA pregunta algo que el cliente ya respondió, usar la siguiente pregunta pendiente.
    if (!isDeterministicDecision(decision) && decision?.question_key && answered(memory, decision.question_key) && !memory.sales_cycle?.authorized) decision = fallback();
    applyCommercialGuards();
    let disclosureReasons = applyDisclosureGuard();
    let qualityCheck = quality(decision?.reply);
    if (!qualityCheck.ok && !isDeterministicDecision(decision)) {
      try { decision = { ...(await this.ai.repairDecision(conversation, memory, planner, combinedText, decision, qualityCheck.reasons) || {}), __source: "llm_repair" }; }
      catch { decision = fallback(); }
      qualityCheck = quality(decision?.reply);
    }
    if (!qualityCheck.ok && !isDeterministicDecision(decision) && memory.sales_cycle?.authorized && onboardingDecision) decision = protectDeterministicDecision(onboardingDecision, "onboarding");
    else if (!qualityCheck.ok && !isDeterministicDecision(decision)) decision = fallback();
    applyCommercialGuards();
    disclosureReasons = applyDisclosureGuard();
    const decisionSource = decision?.__source || "unknown";
    const decisionState = { nss_resolution: decision?.nss_resolution || null, onboarding_requirement: decision?.onboarding_requirement || onboardingDecision?.onboarding_requirement || null };
    decision = stripDecisionMetadata(decision || {});
    decision.reply = String(decision.reply || "").trim().slice(0, this.config.ai.maxReplyChars || 850);
    decision.add_labels = Array.isArray(decision.add_labels) ? decision.add_labels.filter(label => allowedLabels.has(label) && !["cliente", "venta", "cerrado", "no_contesta"].includes(label)) : [];
    decision.remove_labels = Array.isArray(decision.remove_labels) ? decision.remove_labels.filter(label => allowedLabels.has(label) && !protectedLabels.has(label)) : [];
    if (decision.add_labels.length || decision.remove_labels.length) currentLabels = await this.labels.mergeSafe(conversationId, decision.add_labels, decision.remove_labels, conversation);

    if (decision.handoff && !memory.sales_cycle?.authorized) {
      await this.transfer(conversationId, conversation, decision.handoff_reason || "El caso requiere intervención humana.", memory);
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    // Una respuesta vacía significa "no repetir la misma pregunta": no se envía nada.
    if (!decision.reply) {
      await this.record(conversationId, "empty_reply_skipped", { question_key: decision.question_key || null, decision_source: decisionSource });
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }

    // ── 12. Presentarse, deduplicar y enviar ──
    // Mia se presenta en su primera respuesta de la conversación, venga de la IA o de una regla.
    const publicName = this.config.ai.publicName || "Mia de MARTCOM";
    const firstReply = !memory.presentacion_realizada && !memory.ultima_respuesta_agente;
    if (firstReply && !decision.reply.toLowerCase().includes(publicName.toLowerCase())) decision.reply = `¡Hola! Soy ${publicName}. ${decision.reply}`;
    // Chat retomado al abrir: agradecer la espera justo después de la presentación (si la hay).
    if (resumedAfterHours) {
      const intro = decision.reply.match(/^(¡Hola!\s*Soy [^.]+\.\s*)/);
      decision.reply = intro ? `${intro[1]}Gracias por tu paciencia. ${decision.reply.slice(intro[1].length)}` : `Gracias por tu paciencia. ${decision.reply}`;
    }

    // Final dedupe barrier: Chatwoot can deliver the same customer turn through
    // message_created and conversation_updated (or even to overlapping app instances).
    // Before sending, consult the authoritative Chatwoot history and suppress an
    // identical recent outgoing reply. This is intentionally at the last possible
    // point so every decision path is protected, not only the opening greeting.
    let duplicateReply = false;
    try {
      const fresh = await this.chatwoot.getMessages(conversationId);
      const recent = Array.isArray(fresh?.payload) ? fresh.payload : Array.isArray(fresh) ? fresh : messagesOf(fresh);
      const normalizedReply = String(decision.reply || "").replace(/\s+/g, " ").trim();
      duplicateReply = recent.slice(-12).some(message => {
        const outgoing = message?.message_type === "outgoing" || message?.message_type === 1;
        const same = String(message?.content || "").replace(/\s+/g, " ").trim() === normalizedReply;
        const created = Number(message?.created_at || 0);
        const recentEnough = !created || Math.abs(Date.now() / 1000 - created) <= 90;
        return outgoing && message?.private !== true && same && recentEnough;
      });
    } catch (error) {
      console.error(`NEXT no pudo verificar deduplicación de respuesta en conversación ${conversationId}:`, error?.message || error);
    }
    if (duplicateReply) {
      await this.record(conversationId, "duplicate_reply_suppressed", { reply: decision.reply, message_ids: messageIds.map(String) });
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    await this.chatwoot.sendMessage(conversationId, decision.reply);
    memory = {
      ...memory,
      ultima_respuesta_agente: decision.reply,
      ultima_pregunta: decision.question_key || null,
      preguntas_realizadas: decision.question_key ? arrays(memory.preguntas_realizadas, [decision.question_key]) : memory.preguntas_realizadas,
      presentacion_realizada: true,
      asesor_presentacion: memory.asesor_presentacion || publicName,
      operations: { ...(memory.operations || {}), onboarding_last_requested: decisionState.onboarding_requirement || memory.operations?.onboarding_last_requested || null },
    };
    // Recordar qué plan ya se recomendó o explicó para no repetir el mismo mensaje después.
    const pitchKey = { compact_plan_recommendation: "pitched_plans", contextual_plan_explanation: "explained_plans" }[decisionSource];
    const pitchedPlan = pitchKey ? effectivePlan(memory) : null;
    if (pitchedPlan) memory = { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), [pitchKey]: arrays(memory.sales_cycle?.[pitchKey], [pitchedPlan]) } };
    if (decisionState.nss_resolution) {
      memory = { ...memory, nss_resolution: decisionState.nss_resolution, operations: { ...(memory.operations || {}), nss_resolution: decisionState.nss_resolution } };
    }
    await this.memories.set(conversationId, memory);
    await this.memories.markProcessedMany(conversationId, messageIds);
    await this.record(conversationId, "ai_reply_sent", { reply: decision.reply, question_key: decision.question_key || null, decision_source: decisionSource, planner_action: planner?.action || null, quality: qualityCheck, progressive_disclosure: disclosureReasons, commitment: commitment?.commitment || null });
  }
}
