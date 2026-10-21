import { extractFast, containsCurp, containsNss } from "../memory/fast-extractor.js";
import { parseSchedule, isOpen, nextOpeningDate, outOfScheduleMessage } from "./business-hours.js";
import { analyzeSales, planNext, answered } from "../sales/sales-engine.js";
import { checkReply } from "../ai/quality-checker.js";
import { mergeMemory } from "../ai/services.js";
import { fallbackDecision, contextualNextStep } from "./fallback.js";
import { contextualActivityPatch, enforcePreAuthorizationDecision } from "./next-commercial-guard.js";
import { progressiveOpeningDecision, compactPlanRecommendation, priceObjectionDecision, contextualPlanExplanation, disclosureViolations, effectivePlan, medicalNotNeededDecision, coverageAndRequirementsDecision } from "../sales/progressive-disclosure.js";
import { needGuardDecision, suppressRecommendationWithoutNeed, isAdvisoryTurn, deriveCommercialNeed } from "../sales/need-before-recommendation.js";
import { commitmentDecision } from "../sales/commitment-flow.js";
import { negatesCommitment } from "../sales/commitment-negation.js";
import { deferralDecision, detectDeferral, detectClosing } from "../sales/customer-deferral.js";
import { SelfSenders } from "./self-senders.js";
import { plausibleName } from "../semantic/name-validator.js";
import { isAutoReply } from "../semantic/auto-reply.js";
import { adOpeningDecision } from "../sales/ad-openings.js";
import { analyzeNextSale } from "../sales/next-sales-engine.js";
import { directAnswerDecision, protectDeterministicDecision, isDeterministicDecision, stripDecisionMetadata } from "./deterministic-decision-policy.js";
import { arrays, hasAttachments, isContact, isIncoming, messagesOf } from "../utils/conversation.js";
import { stopLabels } from "../chatwoot/labels.js";
import { classifyIntent } from "../intent/intent-engine.js";
import { analyzeReliability } from "../semantic/reliability.js";
import { resolveNegationScope } from "../semantic/negation-scope-resolver.js";
import { orchestrateConversation, startedBefore1997 } from "../orchestrator/conversation-orchestrator.js";
import { extractConversationFacts } from "../orchestrator/fact-extractor.js";
import { analyzeJudgment } from "../orchestrator/conversational-judgment.js";
import { analyzePatience, sensitiveSlotSuppressed } from "../semantic/conversational-patience.js";
import { resolveAnswer } from "../semantic/answer-resolver.js";
import { ensureAuthorizedSale } from "../operations/sale-factory.js";
import { discussedPlan } from "../sales/progressive-disclosure.js";
import { featureRejectionDecision } from "../sales/feature-rejection.js";
import { isAudioAttachment } from "../ai/audio.js";
import { buildOnboardingDecision, ONBOARDING_COMPLETE_TEXT, CALL_ACK_TEXT } from "../operations/onboarding-service.js";
import { specializedAdviceHandoff } from "./specialized-advice-handoff.js";
import { explicitHumanRequest, acceptsAdvisorOffer } from "./human-request.js";
import { trace, traceEnabled } from "../utils/debug-trace.js";
import { paymentProofAttachment } from "../operations/payment-proof.js";

// Etiqueta de Chatwoot que pausa a Mia solo en esa conversación.
export const PAUSE_LABEL = "pausar_mia";

const allowedLabels = new Set(["asignado", "cerrado", "chat_basura", "cliente", "embarazo", "no_contesta", "no_quiere_el_servicio", "predictivo", "proveedor", "reasignado", "rechazado", "seguimiento", "sin_atender", "validacion", "venta", "ya_tiene_servicio"]);
const protectedLabels = new Set(["asignado", "predictivo", "reasignado", "cliente", "venta"]);

// true si una persona del equipo (no Mia) mandó un mensaje público después de `sinceIso`.
// Mientras está cerrado Mia solo manda el aviso de horario, así que ese texto no cuenta.
function humanRepliedSince(conversation, sinceIso, miaAgentId, ignoreTexts = [], selfSenders = null) {
  const ignored = new Set(ignoreTexts.map(t => String(t || "").replace(/\s+/g, " ").trim()));
  const since = Date.parse(sinceIso || "") / 1000 || 0;
  return messagesOf(conversation).some(m => {
    const outgoing = m?.message_type === 1 || m?.message_type === "outgoing";
    const senderType = String(m?.sender_type || m?.sender?.type || "").toLowerCase();
    const senderId = Number(m?.sender_id || m?.sender?.id || 0);
    const text = String(m?.content || "").replace(/\s+/g, " ").trim();
    if (selfSenders?.isOwn?.(m)) return false;
    return outgoing && m?.private !== true && senderType === "user" && senderId !== Number(miaAgentId) && !ignored.has(text) && Number(m?.created_at || 0) >= since;
  });
}

// Mensajes del cliente que este turno debe procesar: los ids del buffer, con los
// adjuntos del webhook cuando la API de Chatwoot aún no los trae, y sin los ya procesados.
export function scrubOpeners(reply = "") {
  return String(reply || "")
    .replace(/(^|[.!?]\s+|[¡¿])veo que\s+/gi, (_m, pre) => `${pre}\u0000`)
    .replace(/,\s*veo que\s+/gi, ", ")
    .replace(/\u0000([a-záéíóúñ])/g, (_m, ch) => ch.toUpperCase())
    .replace(/\u0000/g, "");
}

// Lo que la IA lee de una imagen solo cuenta si es una identificación (INE, CURP, NSS). El nombre
// nunca reemplaza uno que ya teníamos (caso real 21-oct: el beneficiario del comprobante de pago).
export function identityOnly(found = {}, memory = {}) {
  const doc = String(found?.document_type || "").toLowerCase();
  const isId = ["ine", "curp", "nss"].includes(doc) || found?.ine_recibida === true;
  if (!isId) return {};
  const out = { ...found };
  if (memory?.nombre || !["ine", "curp"].includes(doc) || !plausibleName(out.nombre || "")) delete out.nombre;
  delete out.primer_nombre;
  return out;
}

function dropTrailingQuestion(reply = "") {
  const parts = String(reply).trim().split(/(?<=[.!?])\s+/);
  if (parts.length > 1 && /\?$/.test(parts.at(-1))) parts.pop();
  else if (parts.length === 1 && /\?$/.test(parts[0])) return "";
  return parts.join(" ").trim();
}

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
  const forced = new Set((snapshot.forceIds || []).map(String));
  return batch.filter(m => forced.has(String(m.id)) || !memories.hasProcessed(conversationId, m.id));
}

// Si la memoria perdió el plan, lo recupera de los últimos 12 mensajes de la conversación.
function recoverCommercialContext(conversation, memory = {}) {
  if (memory?.sales_cycle?.selected_plan || memory?.sales_cycle?.recommended_plan) return memory;
  const recent = messagesOf(conversation).slice(-12).map(m => String(m?.content || "")).join(" ").toLowerCase();
  const plan = /\bplan\s*(2|dos)\b/.test(recent) ? "plan_2" : /\bplan\s*(1|uno)\b/.test(recent) ? "plan_1" : null;
  if (!plan) return memory;
  return { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), stage: memory.sales_cycle?.stage || "plan_recommended", recommended_plan: plan } };
}

// Algunos clientes escriben con puntos en vez de espacios; sin esto ninguna regla los entiende.
export function undotted(text = "") {
  const value = String(text || "");
  const dotted = (value.match(/[\p{L}\d]\.[\p{L}\d]/gu) || []).length;
  const spaces = (value.match(/ /g) || []).length;
  if (dotted < 3 || spaces >= dotted) return value;
  return value.replace(/([\p{L}\d])\.(?=[\p{L}\d])/gu, "$1 ");
}

// ¿La respuesta explica a fondo un plan? Devuelve "plan_1" | "plan_2" | null.
export function explainedPlanInReply(reply = "") {
  const text = String(reply || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const detail = [/\$?480\b|salario diario/, /incluye|seguro medico|servicio medico/, /48 horas|beneficiari|pareja|hijos/].filter(re => re.test(text)).length;
  if (detail < 2) return null;
  if (/plan 2\b/.test(text) && /1,?500/.test(text) && !/plan 1\b/.test(text)) return "plan_2";
  if (/plan 1\b/.test(text) && /1,?100/.test(text) && !/plan 2\b/.test(text)) return "plan_1";
  return null;
}

export class ConversationProcessor {
  constructor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents, handoffRouter, workflow, turnLock = null, isMiaPaused = () => false, afterHours = null, followUps = null, selfSenders = null, requeue = null, templates = null }) {
    this.templates = templates;
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
    this.followUps = followUps;
    this.selfSenders = selfSenders || new SelfSenders();
    this.requeue = requeue;
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
    // Caso para Atención a Clientes con responsable por rotación.
    try { await this.onCustomerServiceCase?.({ conversation_id: conversationId, kind: "specialized", reason, customer: { nombre: memory?.nombre || null, plan: memory?.sales_cycle?.selected_plan || memory?.sales_cycle?.recommended_plan || null } }); } catch (error) { console.error("NEXT Atención a Clientes (canalizado):", error?.message || error); }
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
      if (closed || humanRepliedSince(conversation, queued.first_at, this.config.chatwoot.agentId, [this.scheduleWeek() && outOfScheduleMessage(this.scheduleWeek())], this.selfSenders)) {
        await this.record(conversationId, "after_hours_skipped", { reason: closed ? "conversation_closed" : "human_replied", message_ids: queued.ids });
        await this.memories.markProcessedMany(conversationId, queued.ids);
      } else {
        snapshot = { ...(snapshot || {}), ids: [...new Set([...(snapshot?.ids || []).map(String), ...queued.ids])], forceIds: queued.force ? queued.ids : [] };
        resumedAfterHours = true;
        await this.record(conversationId, "after_hours_resumed", { message_ids: queued.ids, since: queued.first_at });
      }
    }

    // ── 1c. Mensajes que no vienen en la conversación ──
    // GET /conversations/:id de Chatwoot solo trae los mensajes más recientes. Al retomar un
    // chat de la noche (o rescatarlo) no hay webhook, y si el último mensaje es el aviso de
    // horario el mensaje del cliente no aparecía: Mia no contestaba nada. Se completan con
    // la lista de mensajes.
    const knownIds = new Set(messagesOf(conversation).map(m => String(m?.id)));
    const missingIds = (snapshot?.ids || []).map(String).filter(id => !knownIds.has(id));
    if (missingIds.length && typeof this.chatwoot.getMessages === "function") {
      try {
        const raw = await this.chatwoot.getMessages(conversationId);
        const list = Array.isArray(raw?.payload) ? raw.payload : Array.isArray(raw) ? raw : messagesOf(raw);
        const extra = list.filter(m => m?.id && !knownIds.has(String(m.id)));
        if (extra.length) conversation.messages = [...messagesOf(conversation), ...extra].sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
      } catch (error) {
        await this.record(conversationId, "chatwoot_messages_fetch_failed", { error: String(error?.message || error).slice(0, 300) });
      }
    }

    // ── 2. Guardas de aislamiento: inbox, asignación y etiquetas de alto ──
    if (Number(conversation?.inbox_id || conversation?.inbox?.id) !== Number(this.config.chatwoot.inboxId)) return;
    const assigneeId = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id || 0);
    // Una conversación reasignada a otra persona solo se procesa para registrar el
    // comprobante de un expediente que espera pago (excepción acordada con server.js).
    // En ese caso Mia NUNCA responde: solo registra el comprobante y termina.
    const reassigned = Boolean(assigneeId && assigneeId !== Number(this.config.chatwoot.agentId));
    const pendingSale = this.workflow?.store?.findByConversationId?.(conversationId);
    // También se procesa (sin que Mia responda) la respuesta a la plantilla de vigencia.
    const awaitingValidity = Boolean(pendingSale?.validity?.awaiting_customer_reply);
    // Aviso a Operations: el cliente de un expediente en proceso escribió (aunque lo atienda una persona).
    {
      const incoming = [...(snapshot?.webhookMessages?.values?.() || [])].filter(m => isIncoming(m) && m?.private !== true);
      const text = incoming.map(m => m.content || ((m.attachments || []).length ? "📎 Envió un archivo" : "")).filter(Boolean).join(" · ");
      if (incoming.length && pendingSale && this.onOperationsCustomerMessage) { try { await this.onOperationsCustomerMessage(pendingSale, text); } catch {} }
      // Atención a Clientes: aviso a quien tiene el caso, o caso nuevo si el cliente ya completó su trámite.
      if (incoming.length && this.onCustomerServiceMessage) { try { await this.onCustomerServiceMessage(conversationId, text, pendingSale); } catch {} }
    }
    // Se registra para que el Inspector y el .txt digan por qué Mia no contestó (antes era silencio sin rastro).
    if (reassigned && pendingSale?.status !== "payment_requested" && !awaitingValidity) {
      await this.record(conversationId, "reassigned_skip", { assignee_id: assigneeId, assignee_name: conversation?.meta?.assignee?.name || null, message_ids: (snapshot?.ids || []).map(String) });
      return;
    }
    let currentLabels = conversation?.labels || [];
    const stopped = currentLabels.some(label => stopLabels.has(typeof label === "string" ? label : label?.title));
    if (stopped && !awaitingValidity) {
      await this.record(conversationId, "stop_label_skip", { labels: currentLabels.map(l => typeof l === "string" ? l : l?.title).filter(Boolean), message_ids: (snapshot?.ids || []).map(String) });
      return;
    }
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
    // El cliente escribió: se cancelan los seguimientos pendientes.
    this.followUps?.customerWrote(conversationId);
    // El cliente contestó a la plantilla de vigencia: se le entrega su documento y listo.
    if (awaitingValidity && typeof this.onValidityReply === "function") {
      let delivered = false;
      try { delivered = await this.onValidityReply(conversationId); }
      catch (error) { await this.record(conversationId, "validity_reply_delivery_failed", { error: String(error?.message || error).slice(0, 300) }); }
      // Con el chat en manos de Operaciones (etiqueta de alto o reasignado) Mia no conversa.
      if (delivered || stopped || reassigned) {
        await this.memories.markProcessedMany(conversationId, messageIds);
        return;
      }
    }
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
    // ── 3b. Notas de voz → texto (máx. 10 min). Mia contesta como si lo hubiera escrito y el equipo
    // ve la transcripción en una nota privada de Chatwoot. ──
    let audioTooLong = false;
    for (const m of batch) {
      const audios = (m.attachments || []).filter(isAudioAttachment);
      if (!audios.length || String(m.content || "").trim() || !this.ai?.transcribeAudio) continue;
      const texts = [];
      for (const audio of audios.slice(0, 3)) {
        let result;
        try { result = await this.ai.transcribeAudio(audio); } catch (error) { result = { ok: false, reason: "error", error: String(error?.message || error) }; }
        await this.record(conversationId, result.ok ? "audio_transcribed" : "audio_transcription_failed", { message_id: String(m.id), seconds: result.seconds ? Math.round(result.seconds) : null, reason: result.reason || null, text: result.ok ? result.text.slice(0, 2000) : null, error: result.error || null });
        if (result.ok) texts.push(result.text);
        else if (result.reason === "too_long") audioTooLong = true;
      }
      if (texts.length) {
        m.content = texts.join(" ");
        m.__transcribed = true;
        try { await this.chatwoot.sendMessage(conversationId, `🎤 Transcripción de la nota de voz del cliente:\n«${texts.join(" ")}»`, true); } catch {}
      }
    }
    // "Si.laberdad.tengo.apenas.55.años." (caso real 19-oct): puntos en lugar de espacios.
    const combinedText = undotted(batch.map(m => m.content || "").filter(Boolean).join("\n").trim());
    if (!combinedText && !batch.some(hasAttachments)) {
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    // Respuesta automática de otro negocio: no se contesta (no es el cliente escribiendo).
    if (isAutoReply(combinedText) && !batch.some(hasAttachments)) {
      await this.record(conversationId, "auto_reply_ignored", { customer_text: combinedText.slice(0, 300) });
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
    // Nombres mal capturados en versiones anteriores ("Deje Trabajar", "Claro Que Si") se descartan.
    if (base.nombre && !plausibleName(base.nombre)) base = { ...base, nombre: null, primer_nombre: null };
    // Si lo último que vio el cliente fue una pregunta de una persona del equipo ("¿Te gustaría
    // comenzar con tu trámite?"), su "Si por favor" responde a eso (caso real 20-oct, Enedino).
    {
      const batchIdSet = new Set(messageIds.map(String));
      const firstBatchAt = Math.min(...messagesOf(conversation).filter(m => batchIdSet.has(String(m.id))).map(m => Number(m.created_at || 0)).filter(n => n > 0), Infinity);
      const lastOutgoing = messagesOf(conversation)
        .filter(m => (m?.message_type === 1 || m?.message_type === "outgoing") && m?.private !== true && String(m?.content || "").trim() && Number(m.created_at || 0) <= firstBatchAt)
        .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0)).at(-1);
      const byHuman = lastOutgoing && !this.selfSenders?.isOwn?.(lastOutgoing)
        && String(lastOutgoing?.sender_type || lastOutgoing?.sender?.type || "").toLowerCase() === "user"
        && Number(lastOutgoing?.sender_id || lastOutgoing?.sender?.id || 0) !== Number(this.config.chatwoot.agentId);
      if (byHuman && String(lastOutgoing.content).trim() !== String(base.ultima_respuesta_agente || "").trim()) {
        base = { ...base, ultima_respuesta_agente: String(lastOutgoing.content).trim() };
      }
    }
    const intent = classifyIntent(combinedText, base);
    const salesCyclePatch = analyzeNextSale(combinedText, base).patch;
    const fastPatch = extractFast(combinedText, base);
    const answerResolution = resolveAnswer(combinedText, base);
    const answerPatch = { ...(answerResolution.patch || {}), resolved_questions: [...(answerResolution.resolved || [])] };
    const activityPatch = contextualActivityPatch(combinedText, base);
    if (containsCurp(combinedText)) fastPatch.curp_recibida = true;
    // "Trabajé del 86 al 90": cotizó antes de 1997 (Ley 73); sirve para orientar sobre pensión.
    // Respuesta a "¿en qué año empezaste a cotizar?" (apertura del anuncio de pensión): basta el año.
    const askedStartYear = /en que ano empezaste a cotizar/.test(String(base.ultima_respuesta_agente || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ñ/g, "n"));
    const yearAnswer = askedStartYear && /\b(?:19[5-8]\d|199[0-6])\b|\b(?:el|del|en el|desde el|desde|en)\s+(?:[5-8]\d|9[0-6])\b(?!\s*a(?:n|ñ)os)/i.test(combinedText);
    if (startedBefore1997(combinedText) || yearAnswer) fastPatch.pension_data = { ...(fastPatch.pension_data || {}), cotizo_antes_1997: true };
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
    // La necesidad comercial se calcula sin IA: si la extracción falla o tarda, no se pierde
    // ("quiero seguir sumando para pensionarme" y luego Mia volvía a preguntar qué buscaba).
    if (!llmPatch.commercial_need) llmPatch.commercial_need = deriveCommercialNeed(combinedText, base.commercial_need);
    // "Todo" a "¿qué es lo más importante para ti…?" = servicio médico, semanas y AFORE/INFONAVIT (caso real 15-oct).
    const askedNeed = base.ultima_pregunta === "necesidad_principal" || /lo mas importante para ti|que te interesa principalmente|que buscas principalmente/.test(String(base.ultima_respuesta_agente || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    if (askedNeed && /^(?:(?:en si|pues|si|bueno)\s+)?(?:en\s+)?(?:todo|todos|todas|las tres|los tres|todo eso|todo lo anterior|de todo|me interesa todo|quiero todo|todo completo)\b|\b(?:requiero|necesito|quiero) todo\b|\btodos los (?:servicios|beneficios)\b|\bel (?:servicio|plan) completo\b/.test(combinedText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").trim())) {
      // "Todo menos Infonavit" (caso real 19-oct): todo salvo lo excluido.
      const excludes = /\b(?:menos|excepto|salvo|sin|pero no)\s+(?:el |la |lo de )?(?:infonavit|afore)\b/.test(combinedText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
      llmPatch.commercial_need = { ...(llmPatch.commercial_need || {}), service_medical: true, weeks: true, afore_infonavit: !excludes, unknown: false };
    }
    // La IA a veces toma frases como nombre ("Deje", "Claro que sí"): se descartan.
    if (llmPatch.nombre && !plausibleName(llmPatch.nombre)) { delete llmPatch.nombre; delete llmPatch.primer_nombre; }
    let documentPatch = {};
    const documentAttachments = batch.flatMap(m => m.attachments || []);
    trace("vision_gate", ({ conversation: conversationId, authorized: Boolean(base?.sales_cycle?.authorized), attachments: documentAttachments.length, expected: base?.operations?.onboarding_next || base?.operations?.onboarding_last_requested || null }));
    // Solo mientras falten datos del expediente y nunca en Cobranza: una foto ahí es el comprobante de
    // pago y su "Nombre del beneficiario" (la cuenta de MARTCOM) terminaba como nombre del cliente (21-oct).
    const paymentStage = ["payment_requested", "payment_issue", "payment_received", "payment_validated", "completed"].includes(String(base?.operations?.status || "")) || ["payment", "completed"].includes(String(base?.operations?.queue || ""));
    if (base?.sales_cycle?.authorized && batch.some(hasAttachments) && !paymentStage && !base?.operations?.documents_complete) {
      try {
        trace("vision_start", ({ conversation: conversationId, attachments: documentAttachments.length }));
        documentPatch = identityOnly(await this.ai.extractDocumentData(documentAttachments), base);
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
      // Si después ya no regresa, el seguimiento normal lo retoma.
      this.followUps?.afterReply?.(conversationId, { customerAt: new Date(), reply: patience.reply });
      return;
    }
    const b2b = orchestration.shouldHandoffB2B || memory.intent?.id === "PROVEEDOR";
    const frustrated = Number(memory.experiencia?.frustration_score || 0) >= 2 || judgment.shouldHandoff;
    const specialized = specializedAdviceHandoff(combinedText, memory);
    const wantsHuman = explicitHumanRequest(combinedText) || acceptsAdvisorOffer(combinedText, base.ultima_respuesta_agente);
    if (wantsHuman || b2b || frustrated || specialized) {
      if (b2b) await this.labels.mergeSafe(conversationId, ["proveedor", this.config.ai.validationLabel], [], conversation);
      const reason = wantsHuman ? "El cliente solicitó atención humana."
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
      // Documentos que mandó ANTES de aceptar (o "ya se la mandé"): se revisan ahora con la IA para
      // no volver a pedirlos (caso real 20-oct: Enedino mandó fotos y luego le pidieron la CURP).
      const justAuthorized = !base.sales_cycle?.authorized;
      const claimsSent = /\b(?:ya\s+)?(?:se\s+|te\s+|le\s+)?(?:l[oa]s?\s+)?(?:mande|mandé|envie|envié|pase|pasé|comparti|compartí|adjunte|adjunté)\b|\bya (?:esta|están?|estan) (?:arriba|enviad[oa]s?|mandad[oa]s?)\b/i.test(combinedText);
      if ((justAuthorized || claimsSent) && !memory.operations?.documents_complete) {
        const done = new Set((memory.analyzed_attachments || []).map(String));
        const batchIdsSet = new Set(messageIds.map(String));
        const earlier = messagesOf(conversation)
          .filter(m => isIncoming(m) && m?.private !== true && !batchIdsSet.has(String(m.id)) && (m.attachments || []).length)
          .flatMap(m => (m.attachments || []).map(a => ({ ...a, __message_id: m.id })))
          .filter(a => !done.has(String(a.id || a.data_url || "")))
          .slice(-3);
        if (earlier.length && this.ai?.extractDocumentData) {
          let found = {};
          try { found = identityOnly(await this.ai.extractDocumentData(earlier) || {}, memory); } catch (error) { console.error("NEXT no pudo analizar documentos previos:", error?.message || error); }
          const patch = { analyzed_attachments: arrays(memory.analyzed_attachments, earlier.map(a => String(a.id || a.data_url || ""))) };
          if (found.curp_valor && /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/i.test(String(found.curp_valor).replace(/\s+/g, ""))) Object.assign(patch, { curp_valor: String(found.curp_valor).replace(/\s+/g, "").toUpperCase(), curp_recibida: true });
          if (found.nss_valor && String(found.nss_valor).replace(/\D/g, "").length === 11) Object.assign(patch, { nss_valor: String(found.nss_valor).replace(/\D/g, ""), nss_recibido: true });
          if (found.ine_recibida === true) {
            patch.ine_recibida = true;
            const ine = earlier.map(({ __message_id, ...a }) => ({ ...a, file_name: `ine_${a.file_name || a.filename || a.name || "documento"}`, file_type: a.file_type || a.content_type || "image" }));
            conversation.messages = [...(conversation.messages || []), { id: `earlier-${Date.now()}`, created_at: Date.now() / 1000, attachments: ine }];
          }
          memory = { ...memory, ...patch };
          await this.memories.set(conversationId, memory);
          await this.record(conversationId, "earlier_documents_analyzed", { count: earlier.length, curp: Boolean(patch.curp_valor), nss: Boolean(patch.nss_valor), ine: Boolean(patch.ine_recibida), reason: justAuthorized ? "authorized" : "customer_says_sent" });
        }
      }
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
    const replacedReasons = [];
    const onboardingDecision = buildOnboardingDecision(memory, combinedText);
    const openingDecision = progressiveOpeningDecision(memory, combinedText);
    const needDecision = needGuardDecision(memory, combinedText);
    const contextualExplanation = contextualPlanExplanation(base, combinedText);
    const compactRecommendation = compactPlanRecommendation(memory, combinedText);
    const priceObjection = priceObjectionDecision(memory, combinedText);
    // Con el trámite iniciado, una CURP es un documento del expediente, no una "revisión de caso".
    const directDecisionRaw = directAnswerDecision({ judgment, orchestration });
    const directDecision = memory.sales_cycle?.authorized && /^direct:case_review/.test(directDecisionRaw?.__source || "") ? null : directDecisionRaw;
    const commitment = commitmentDecision(memory, combinedText);
    // El cliente pospone ("ahorita no tengo dinero", "yo le aviso") o solo agradece: despedirse y no insistir.
    // "No me interesa Infonavit" descarta una parte, no es despedida (caso real 19-oct).
    const featureRejection = featureRejectionDecision(memory, combinedText);
    const deferral = featureRejection ? null : deferralDecision(memory, combinedText, { resumedAfterHours });
    // Notas de voz o archivos sin texto antes de iniciar el trámite: Mia no puede escucharlos
    // ni revisarlos, así que lo dice en vez de contestar algo sin relación.
    const mediaOnly = !combinedText && !memory.sales_cycle?.authorized && batch.some(hasAttachments)
      ? (batch.some(m => (m.attachments || []).some(a => /audio|voice|ogg|opus/i.test(String(a?.file_type || a?.content_type || a?.extension || "")))) ? "audio" : "file")
      : null;
    const mediaDecision = mediaOnly ? {
      reply: mediaOnly === "audio"
        ? (audioTooLong
          ? "Recibí tu nota de voz, pero es muy larga (más de 10 minutos) y no la pude escuchar completa. ¿Me puedes escribir o mandar un audio más corto con lo principal?"
          : "No pude escuchar bien tu nota de voz 🙏 ¿Me lo puedes escribir por mensaje o mandar otro audio?")
        // Con un plan ya platicado, mandar documentos es señal de compra: se guardan y se ofrece
        // iniciar; al aceptar se revisan (caso real 20-oct, Enedino).
        : (discussedPlan(memory)
          ? `Gracias, recibí tus documentos. Los usaremos para tu expediente en cuanto iniciemos tu trámite. ¿Quieres que iniciemos tu trámite con el ${discussedPlan(memory) === "plan_2" ? "Plan 2" : "Plan 1"}?`
          : "Gracias, recibí tu archivo. Por ahora no puedo revisar archivos por aquí antes de iniciar tu trámite. ¿Me cuentas por mensaje en qué te puedo ayudar?"),
      question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    } : null;
    const medicalNotNeeded = medicalNotNeededDecision(memory, combinedText);
    const coverageFollowUp = coverageAndRequirementsDecision(base, combinedText);
    const advisoryTurn = isAdvisoryTurn(combinedText);
    if (advisoryTurn) {
      planner = { ...planner, action: "asesoria_conversacional", question_key: null, specialized: true, advisory: true, customer_question_priority: true };
      await this.record(conversationId, "advisory_turn", { text: combinedText, commercial_need: memory.commercial_need || null });
    }
    const adOpening = adOpeningDecision(base, combinedText);
    if (mediaDecision) decision = protectDeterministicDecision(mediaDecision, `media_${mediaOnly}`);
    else if (adOpening) decision = protectDeterministicDecision(adOpening, `ad_opening:${adOpening.ad_opening}`);
    else if (featureRejection) decision = protectDeterministicDecision(featureRejection, "feature_rejection");
    else if (deferral) decision = protectDeterministicDecision(deferral, `customer_${deferral.deferral === "closing" ? "closing" : "deferral"}`);
    else if (priceObjection) decision = protectDeterministicDecision(priceObjection, "price_objection");
    else if (medicalNotNeeded) decision = protectDeterministicDecision(medicalNotNeeded, "medical_not_needed");
    else if (memory.sales_cycle?.authorized && onboardingDecision?.priority) decision = protectDeterministicDecision(onboardingDecision, "onboarding");
    else if (directDecision) decision = directDecision;
    else if (contextualExplanation) decision = protectDeterministicDecision(contextualExplanation, "contextual_plan_explanation");
    else if (coverageFollowUp) decision = protectDeterministicDecision(coverageFollowUp, "coverage_and_requirements");
    else if (commitment) decision = protectDeterministicDecision(commitment, `commitment:${commitment.commitment}`);
    else if (memory.sales_cycle?.authorized && onboardingDecision) decision = protectDeterministicDecision(onboardingDecision, "onboarding");
    else if (openingDecision && !advisoryTurn) decision = protectDeterministicDecision(openingDecision, "progressive_opening");
    else if (needDecision && !advisoryTurn) decision = protectDeterministicDecision(needDecision, "need_discovery");
    else if (compactRecommendation && !advisoryTurn) decision = protectDeterministicDecision(compactRecommendation, "compact_plan_recommendation");
    else {
      const generated = await this.safeAi(conversationId, "decision", () => this.ai.generateDecision(conversation, currentLabels, memory, planner, combinedText), null);
      decision = generated ? { ...generated, __source: "llm" } : { ...fallbackDecision(memory, planner, combinedText), __source: "fallback_ai_error" };
      if (!generated) replacedReasons.push("fallo_ia");
    }
    // Para el Inspector: qué escribió la IA y por qué se cambió (antes solo se veía el respaldo).
    const aiDraft = decision?.__source === "llm" ? String(decision.reply || "") : null;
    // "Veo que…" está prohibido, pero tirar toda la respuesta por eso dejaba al cliente con
    // "¿Me compartes tu nombre completo?" (12 chats del 19-20 oct). Se quita la frase y se conserva lo demás.
    if (["llm"].includes(decision?.__source)) decision = { ...decision, reply: scrubOpeners(decision.reply) };

    // ── 11. Guardas sobre respuestas de IA (las deterministas no se tocan) ──
    // Firmas reales: answered(memory, key), checkReply(reply, {memory, questionKey, maxChars}),
    // disclosureViolations(reply, {memory, combinedText}), enforcePreAuthorizationDecision(decision,
    // {memory, planner, combinedText, fallbackDecision}). Llamarlas con otros argumentos hacía que
    // toda respuesta de la IA se reemplazara por la pregunta de respaldo.
    const fallback = () => ({ ...fallbackDecision(memory, planner, combinedText), __source: "fallback" });
    const quality = reply => checkReply(reply, { memory, questionKey: decision?.question_key, maxChars: this.config.ai.maxReplyChars, customerText: combinedText });
    const applyCommercialGuards = () => {
      if (isDeterministicDecision(decision)) return;
      const before = decision?.reply;
      decision = enforcePreAuthorizationDecision(decision, { memory, planner, combinedText, fallbackDecision });
      if (decision?.reply !== before) replacedReasons.push("pidio_curp_nss_antes_de_autorizar");
      const beforeNeed = decision?.reply;
      decision = suppressRecommendationWithoutNeed(decision, memory, combinedText);
      if (decision?.reply !== beforeNeed) replacedReasons.push("recomendo_plan_sin_necesidad");
    };
    const applyDisclosureGuard = () => {
      if (isDeterministicDecision(decision)) return [];
      const reasons = disclosureViolations(decision?.reply, { memory, combinedText });
      if (reasons.length && openingDecision && !directDecision && !commitment) { decision = protectDeterministicDecision(openingDecision, "progressive_opening"); replacedReasons.push(...reasons); }
      return reasons;
    };
    if (memory.sales_cycle?.authorized && decision) {
      decision.handoff = false;
      if (onboardingDecision && !directRequest && !commitment) decision.question_key = onboardingDecision.question_key;
    }
    if (directRequest && ["curp", "nss"].includes(decision?.question_key)) decision.question_key = null;
    // Si la IA pregunta algo que el cliente ya respondió, usar la siguiente pregunta pendiente.
    if (!isDeterministicDecision(decision) && decision?.question_key && answered(memory, decision.question_key) && !memory.sales_cycle?.authorized) {
      // La IA respondió pero terminó repitiendo una pregunta ya contestada: se conserva la
      // respuesta y se quita solo esa pregunta final, en lugar de tirar todo al respaldo.
      const trimmed = dropTrailingQuestion(decision.reply);
      if (trimmed.length < 25) replacedReasons.push(`pregunta_ya_contestada:${decision.question_key}`);
      decision = trimmed.length >= 25 ? { ...decision, reply: trimmed, question_key: null } : fallback();
    }
    applyCommercialGuards();
    let disclosureReasons = applyDisclosureGuard();
    let qualityCheck = quality(decision?.reply);
    if (!qualityCheck.ok && !isDeterministicDecision(decision)) {
      replacedReasons.push(...qualityCheck.reasons);
      try { decision = { ...(await this.ai.repairDecision(conversation, memory, planner, combinedText, decision, qualityCheck.reasons) || {}), __source: "llm_repair" }; decision.reply = scrubOpeners(decision.reply); }
      catch { decision = fallback(); }
      qualityCheck = quality(decision?.reply);
    }
    if (!qualityCheck.ok && !isDeterministicDecision(decision) && memory.sales_cycle?.authorized && onboardingDecision) decision = protectDeterministicDecision(onboardingDecision, "onboarding");
    else if (!qualityCheck.ok && !isDeterministicDecision(decision)) { replacedReasons.push("reparacion_fallida"); decision = fallback(); }
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
      await this.record(conversationId, "empty_reply_skipped", { customer_text: combinedText.slice(0, 600), question_key: decision.question_key || null, decision_source: decisionSource });
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }

    // La IA a veces contesta sin siguiente paso ("Anotado que eres transportista/chofer."): el cliente
    // no sabe qué sigue y la plática se muere (casos 17-oct). Se agrega el siguiente paso.
    // Nunca después de una despedida: "…cuando decidas, escríbeme y retomamos el trámite. ¿Tienes
    // alguna duda sobre el Plan 1…?" (casos reales 19 y 20-oct).
    const closingLike = /escr[ií]beme|quedo al pendiente|aqu[ií] te espero|aqu[ií] estar[eé]|aqu[ií] quedo|cuando (?:lo tengas|puedas|regreses|est[eé]s list|quieras|decidas|gustes|tengas)|te aviso por aqu[ií]|que tengas (?:un )?(?:buen|excelente|bonito|lindo) d[ií]a|que est[eé]s bien|retom(?:amos|arlo|emos)|t[oó]mate (?:el|tu) tiempo|gracias por (?:tu tiempo|avisar|contarme)/i;
    const customerClosing = Boolean(detectDeferral(combinedText)) || detectClosing(combinedText, { lastReply: memory.ultima_respuesta_agente || "" });
    const openEnded = ["llm", "llm_repair"].includes(decisionSource) || /^direct:(services|price|location|registered_salary|requirements|process_time|payment_frequency|not_free|identity|website|are_you_imss)$/.test(decisionSource);
    if (openEnded && !customerClosing && !memory.sales_cycle?.authorized && !/[?¿]/.test(decision.reply) && !closingLike.test(decision.reply)) {
      const next = String(contextualNextStep(memory) || "").replace(/^Gracias\.\s*/, "");
      if (next && !decision.reply.includes(next) && (decision.reply.length + next.length + 1) <= (this.config.ai.maxReplyChars || 850)) {
        decision.reply = `${decision.reply} ${next}`;
        await this.record(conversationId, "next_step_appended", { next });
      }
    }
    // Nunca la misma respuesta fija dos veces seguidas (Modalidad 40 repetida a Martín, 17-19 oct):
    // la segunda vez se ofrece un asesor.
    const CONSULTATIVE = /^direct:(modality_40|modality|pension_general|pension_orientation|pension_min_term|salary_pension|legitimacy|trust|operational_model|already_pensioned|disability)$/;
    if (CONSULTATIVE.test(decisionSource) && decision.reply.trim() === String(memory.ultima_respuesta_agente || "").trim()) {
      decision.reply = "Para revisar bien tu caso y resolver lo que me comentas, lo mejor es que lo vea un asesor. ¿Quieres que te comunique con uno?";
      await this.record(conversationId, "repeated_answer_replaced", { source: decisionSource });
    }

    // ── 12. Presentarse, deduplicar y enviar ──
    // Mia se presenta en su primera respuesta de la conversación, venga de la IA o de una regla.
    const publicName = this.config.ai.publicName || "Mia de MARTCOM";
    const firstReply = !memory.presentacion_realizada && !memory.ultima_respuesta_agente;
    if (firstReply && !decision.reply.toLowerCase().includes(publicName.toLowerCase())) decision.reply = `¡Hola! Soy ${publicName}. ${decision.reply}`;
    // La IA a veces abre con "Mia de MARTCOM. …" o "Soy Mia de MARTCOM. …" sin saludo: completar la presentación.
    if (firstReply && decision.reply.toLowerCase().startsWith(publicName.toLowerCase())) decision.reply = `¡Hola! Soy ${decision.reply}`;
    if (firstReply) decision.reply = decision.reply.replace(/^(?:hola[,!.]?\s*)?soy\s+mia de martcom[.,:;]?\s*/i, `¡Hola! Soy ${publicName}. `)
      // "Soy Mia de MARTCOM: buenos días." → no repetir el saludo en minúscula tras la presentación.
      .replace(/^(¡Hola! Soy [^.]+\.\s*)(?:buen(?:os|as)?\s+(?:d[ií]as|tardes|noches)[.!,]?\s*)/i, "$1")
      .replace(/^(¡Hola! Soy [^.]+\.\s*)([a-záéíóúñ])/, (_m, intro, ch) => intro + ch.toUpperCase());
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
    let humanAnswered = false;
    let supersededBy = [];
    try {
      const fresh = await this.chatwoot.getMessages(conversationId);
      const recent = Array.isArray(fresh?.payload) ? fresh.payload : Array.isArray(fresh) ? fresh : messagesOf(fresh);
      // Si el cliente escribió de nuevo mientras Mia preparaba esta respuesta, no se envía:
      // se vuelve a atender todo junto (antes salían dos respuestas seguidas, una ya vieja).
      const batchIds = new Set(messageIds.map(String));
      const newestBatchId = Math.max(0, ...messageIds.map(Number).filter(Number.isFinite));
      supersededBy = this.requeue ? recent.filter(message => isIncoming(message) && message?.private !== true && isContact(message)
        && !batchIds.has(String(message.id)) && Number(message.id) > newestBatchId && !this.memories.hasProcessed(conversationId, message.id)).map(m => String(m.id)) : [];
      // Una persona del equipo contestó después del mensaje del cliente: Mia no se mete
      // (caso real 19-oct: José Lara escribió y en el mismo minuto salió "¡Hola! Soy Mia…").
      const batchAt = Math.max(0, ...recent.filter(m => batchIds.has(String(m.id))).map(m => Number(m.created_at || 0)));
      const sinceIso = batchAt ? new Date(batchAt * 1000).toISOString() : null;
      humanAnswered = Boolean(sinceIso) && humanRepliedSince({ messages: recent }, sinceIso, this.config.chatwoot.agentId, [], this.selfSenders);
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
    this.supersedes ||= new Map();
    if (supersededBy.length && !duplicateReply && (this.supersedes.get(conversationId) || 0) < 3) {
      this.supersedes.set(conversationId, (this.supersedes.get(conversationId) || 0) + 1);
      await this.record(conversationId, "reply_superseded", { reply: decision.reply, message_ids: messageIds.map(String), newer_ids: supersededBy });
      this.turnLock?.release?.(conversationId, messageIds.map(String));
      this.requeue(conversationId, messageIds.map(String));
      return;
    }
    if (humanAnswered) {
      await this.record(conversationId, "human_replied_skip", { reply: decision.reply, message_ids: messageIds.map(String) });
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    if (duplicateReply) {
      await this.record(conversationId, "duplicate_reply_suppressed", { reply: decision.reply, message_ids: messageIds.map(String) });
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    this.supersedes?.delete(conversationId);
    // Fuera de la ventana de 24 h de WhatsApp el texto libre no llega ("Error al enviar"): pasaba al
    // retomar el lunes chats del sábado en la noche. Se manda la plantilla de seguimiento, una vez.
    if (conversation?.can_reply === false) {
      const already = Date.now() - Date.parse(memory.reengage_template_at || 0) < 24 * 60 * 60 * 1000;
      let result = { sent: false, reason: already ? "already_sent" : "no_templates" };
      if (!already && this.templates?.enabled?.("followUp24h")) result = await this.templates.send(conversationId, "followUp24h");
      await this.record(conversationId, "reply_outside_window", { reply: decision.reply, template: result });
      this.followUps?.cancel?.(conversationId);
      if (result.sent) memory = { ...memory, reengage_template_at: new Date().toISOString(), ultima_respuesta_agente: "Hola, buen día. Si aún estás interesado en afiliarte al IMSS, con gusto puedo ayudarte a iniciar tu proceso." };
      await this.memories.set(conversationId, memory);
      await this.memories.markProcessedMany(conversationId, messageIds);
      return;
    }
    await this.chatwoot.sendMessage(conversationId, decision.reply);
    memory = {
      ...memory,
      ...(decision.reply === ONBOARDING_COMPLETE_TEXT ? { onboarding_complete_notified: true } : {}),
      ...(decision.reply === CALL_ACK_TEXT ? { call_ack_at: new Date().toISOString() } : {}),
      ultima_respuesta_agente: decision.reply,
      ultima_pregunta: decision.question_key || null,
      preguntas_realizadas: decision.question_key ? arrays(memory.preguntas_realizadas, [decision.question_key]) : memory.preguntas_realizadas,
      presentacion_realizada: true,
      asesor_presentacion: memory.asesor_presentacion || publicName,
      operations: { ...(memory.operations || {}), onboarding_last_requested: decisionState.onboarding_requirement || memory.operations?.onboarding_last_requested || null },
    };
    // El cliente pospuso o cerró la plática: se guarda el motivo para el embudo del inspector.
    if (deferral) memory = { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), deferral: deferral.deferral, deferral_at: new Date().toISOString() } };
    // Descartó AFORE/INFONAVIT o el Plan 2: desde ahora se habla del Plan 1 (también en los seguimientos).
    if (decisionSource === "feature_rejection") {
      const cycle = memory.sales_cycle || {};
      memory = { ...memory, commercial_need: { ...(memory.commercial_need || {}), afore_infonavit: false }, sales_cycle: { ...cycle, recommended_plan: "plan_1", selected_plan: cycle.selected_plan === "plan_2" ? null : cycle.selected_plan || null, pitched_plans: arrays(cycle.pitched_plans, ["plan_1"]) } };
    }
    // Recordar qué plan ya se recomendó o explicó para no repetir el mismo mensaje después.
    const pitchKey = { compact_plan_recommendation: "pitched_plans", contextual_plan_explanation: "explained_plans" }[decisionSource];
    const pitchedPlan = pitchKey ? effectivePlan(memory) : null;
    if (pitchedPlan) memory = { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), [pitchKey]: arrays(memory.sales_cycle?.[pitchKey], [pitchedPlan]) } };
    // Si la IA explicó un plan con su detalle (precio + salario registrado o lo que incluye), cuenta
    // como explicado: antes el respaldo volvía a ofrecer "¿Quieres que te explique cómo funciona?".
    // Ya se le respondió una duda de legitimidad: si vuelve a dudar, se le ofrece un asesor.
    if (/^direct:(legitimacy|trust)$/.test(decisionSource) || /^direct:multi$/.test(decisionSource) && /Tu alta queda registrada ante el IMSS con una empresa/.test(decision.reply)) memory = { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), trust_answered: true } };
    // Plan del que se habló al último (si la respuesta menciona solo uno).
    const plansInReply = [...new Set([...String(decision.reply || "").matchAll(/\bPlan\s*(1|2)\b/gi)].map(m => `plan_${m[1]}`))];
    if (plansInReply.length === 1) memory = { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), last_plan: plansInReply[0] } };
    const explainedByText = explainedPlanInReply(decision.reply);
    if (explainedByText) memory = { ...memory, sales_cycle: { ...(memory.sales_cycle || {}), pitched_plans: arrays(memory.sales_cycle?.pitched_plans, [explainedByText]), explained_plans: arrays(memory.sales_cycle?.explained_plans, [explainedByText]) } };
    if (decisionState.nss_resolution) {
      memory = { ...memory, nss_resolution: decisionState.nss_resolution, operations: { ...(memory.operations || {}), nss_resolution: decisionState.nss_resolution } };
    }
    await this.memories.set(conversationId, memory);
    await this.memories.markProcessedMany(conversationId, messageIds);
    // Programar seguimientos si el cliente deja de contestar (no si acaba de rechazar).
    if (this.followUps && !negatesCommitment(combinedText) && !deferral) {
      const lastCustomerAt = Math.max(0, ...batch.map(m => Number(m.created_at || 0))) * 1000 || Date.now();
      this.followUps.afterReply(conversationId, { customerAt: new Date(lastCustomerAt), reply: decision.reply });
    }
    await this.record(conversationId, "ai_reply_sent", { customer_text: combinedText.slice(0, 600), stage: memory.sales_cycle?.stage || null, reply: decision.reply, question_key: decision.question_key || null, decision_source: decisionSource, planner_action: planner?.action || null, quality: qualityCheck, progressive_disclosure: disclosureReasons, commitment: commitment?.commitment || null,
      ...(aiDraft && aiDraft.trim() !== String(decision.reply || "").trim() ? { ai_draft: aiDraft.slice(0, 900), replaced_reasons: [...new Set(replacedReasons)] } : {}) });
  }
}
