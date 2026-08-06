import { extractFast, containsCurp, containsNss } from "../memory/fast-extractor.js";
import { analyzeSales, planNext, answered } from "../sales/sales-engine.js";
import { checkReply } from "../ai/quality-checker.js";
import { mergeMemory } from "../ai/services.js";
import { fallbackDecision } from "./fallback.js";
import { arrays, hasAttachments, historyOf, isContact, isIncoming, messagesOf } from "../utils/conversation.js";
import { stopLabels } from "../chatwoot/labels.js";

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
  constructor({ config, chatwoot, labels, memories, agentRotation, ai, inspectorEvents }) {
    this.config = config;
    this.chatwoot = chatwoot;
    this.labels = labels;
    this.memories = memories;
    this.agentRotation = agentRotation;
    this.ai = ai;
    this.inspectorEvents = inspectorEvents;
    this.conversationCache = new Map();
  }

  inSchedule() {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: this.config.ai.timezone, hour: "2-digit", hour12: false }).formatToParts(new Date());
    const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
    return hour >= this.config.ai.startHour && hour < this.config.ai.endHour;
  }

  async transfer(id, conversation, reason, memory) {
    await this.labels.mergeSafe(id, [this.config.ai.validationLabel], [], conversation);
    await this.chatwoot.sendMessage(id, "Gracias, ya tengo la información necesaria. Voy a revisar tu caso para darte la orientación adecuada.");
    let summary;
    try { summary = await this.ai.handoffSummary(conversation, reason, memory); }
    catch { summary = `AXEL IA - RESUMEN\nMotivo de transferencia: ${reason}\nRevisar historial completo.`; }
    await this.chatwoot.sendMessage(id, summary, true);
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

    let currentLabels = await this.labels.mergeSafe(conversationId, [this.config.ai.assignedLabel], [this.config.ai.unattendedLabel], conversation);
    if (currentLabels.some(label => stopLabels.has(label))) return;

    const batch = batchFrom(conversation, snapshot, this.memories, conversationId);
    if (!batch.length) { await this.record(conversationId, "ignored_no_usable_messages"); return; }

    const combinedText = batch.map(message => String(message.content || "").trim()).filter(Boolean).join("\n");
    const messageIds = batch.map(message => String(message.id));

    let memory = this.memories.get(conversationId);
    if (!memory.asesor_presentacion) {
      memory.asesor_presentacion = await this.agentRotation.next();
      await this.memories.set(conversationId, memory);
    }

    const fastPatch = extractFast(combinedText, memory);
    const llmPatch = await this.ai.extractAmbiguous(memory, combinedText, conversation);
    memory = mergeMemory(memory, llmPatch, fastPatch);
    for (const message of batch) {
      if (hasAttachments(message)) memory.documentos_recibidos = arrays(memory.documentos_recibidos, message.attachments.map(item => item?.file_type || item?.extension || "archivo"));
    }

    const sales = analyzeSales(memory);
    const planner = planNext({ ...memory, ventas: sales });
    await this.record(conversationId, "decision_state", { sales, planner, memorySnapshot: memory });
    memory.ventas = sales;
    memory.flujo = { fase: planner.action === "solicitar_curp" ? "cotizacion" : planner.action === "transferir" ? "transferencia" : "diagnostico", siguiente_paso: planner.question_key };
    await this.memories.set(conversationId, memory);
    memory = this.memories.get(conversationId);

    const reason = handoffReason(batch, combinedText);
    if (reason) {
      await this.transfer(conversationId, conversation, reason, memory);
      await this.memories.markProcessedMany(conversationId, messageIds);
      await this.record(conversationId, "handoff", { reason, messageIds, advisor: memory.asesor_presentacion });
      console.log(JSON.stringify({ event: "handoff", version: "3.0.1.1", conversationId, messageIds, reason, sources: snapshot.sources, memory }));
      return;
    }

    let decision = await this.ai.generateDecision(conversation, currentLabels, memory, planner, combinedText);
    decision.reply = removeAdvisorSignature(decision.reply, memory.asesor_presentacion);
    if (decision.question_key && answered(memory, decision.question_key)) decision = { ...decision, question_key: planner.question_key };

    let quality = checkReply(decision.reply, { memory, questionKey: decision.question_key, maxChars: this.config.ai.maxReplyChars });
    if (!quality.ok) {
      try {
        decision = await this.ai.repairDecision(conversation, memory, planner, combinedText, decision, quality.reasons);
        decision.reply = removeAdvisorSignature(decision.reply, memory.asesor_presentacion);
        quality = checkReply(decision.reply, { memory, questionKey: decision.question_key, maxChars: this.config.ai.maxReplyChars });
      } catch (error) { console.warn(`Aviso reparación ${conversationId}: ${error.message}`); }
    }
    if (!quality.ok) decision = fallbackDecision(memory, planner, combinedText);

    decision.reply = removeAdvisorSignature(decision.reply, memory.asesor_presentacion);
    decision.reply = String(decision.reply || "").trim().slice(0, this.config.ai.maxReplyChars);
    decision.add_labels = Array.isArray(decision.add_labels) ? decision.add_labels.filter(label => allowedLabels.has(label) && !["cliente","venta","cerrado","no_contesta"].includes(label)) : [];
    decision.remove_labels = Array.isArray(decision.remove_labels) ? decision.remove_labels.filter(label => allowedLabels.has(label) && !protectedLabels.has(label)) : [];
    currentLabels = await this.labels.mergeSafe(conversationId, decision.add_labels, decision.remove_labels, conversation);

    if (decision.handoff || planner.action === "transferir") {
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
    console.log(JSON.stringify({ event: "processed", version: "3.0.1.1", conversationId, messageIds, sources: snapshot.sources, planner, labels: currentLabels, memory: this.memories.get(conversationId) }));
  }
}
