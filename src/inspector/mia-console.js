import fs from "node:fs";
import path from "node:path";
// Datos del nuevo inspector de Mia (vista de Admin).
// Cuatro vistas: Hoy (en vivo), Conversaciones, Calidad y Embudo/Configuración.
// Todo se calcula a partir de la memoria por conversación, los eventos del inspector,
// la cola de fuera de horario y la cola de seguimientos.

import { describeSchedule, localClock, nextOpeningDate, parseSchedule } from "../core/business-hours.js";

const DAY = 24 * 3600 * 1000;
const NOTICE_RE = /^¡Gracias por escribir a MARTCOM! Nuestro horario de atención es/;
const GENERIC_REPLY = "¿Me compartes un poco más sobre tu situación?";

export const SOURCE_LABELS = {
  llm: "IA",
  llm_repair: "IA corregida",
  fallback: "Respaldo genérico",
  fallback_ai_error: "Respaldo (falló la IA)",
  progressive_opening: "Regla · apertura",
  compact_plan_recommendation: "Regla · recomienda plan",
  contextual_plan_explanation: "Regla · explica plan",
  price_objection: "Regla · objeción de precio",
  medical_not_needed: "Regla · sin servicio médico",
  customer_deferral: "Regla · cliente pospone",
  customer_closing: "Regla · despedida",
  need_discovery: "Regla · descubre necesidad",
  onboarding: "Regla · documentos",
  quality_fallback: "Respaldo de calidad",
  coverage_and_requirements: "Regla · cobertura y requisitos",
  media_audio: "Regla · nota de voz",
  media_file: "Regla · archivo",
};

export function sourceLabel(source = "") {
  const s = String(source || "");
  if (SOURCE_LABELS[s]) return SOURCE_LABELS[s];
  if (s.startsWith("commitment:")) return "Regla · cierre de venta";
  if (s.startsWith("direct:")) return "Respuesta oficial";
  return s || "—";
}

export function sourceKind(source = "") {
  const s = String(source || "");
  if (s === "llm" || s === "llm_repair") return "ia";
  if (s.startsWith("fallback") || s === "quality_fallback") return "respaldo";
  return "regla";
}

export const EVENT_LABELS = {
  ai_reply_sent: "Mia respondió",
  empty_reply_skipped: "Mia decidió no responder",
  ignored_out_of_schedule: "Mensaje fuera de horario",
  after_hours_resumed: "Retomado al abrir",
  after_hours_skipped: "No retomado al abrir",
  pending_sweep_resumed: "Rescatado (chat pendiente)",
  pending_sweep_error: "Error en rescate",
  followup_sent: "Seguimiento enviado",
  followup_cancelled: "Seguimiento cancelado",
  followup_no_response: "No contestó (no_contesta)",
  followup_error: "Error en seguimiento",
  assigned_label_applied: "Etiqueta asignado",
  handoff: "Pasó a una persona",
  specialized_advice_handoff: "Pasó a Atención a Clientes",
  ai_error: "Error de la IA",
  processing_error: "Error al procesar",
  mia_paused_skip: "Mia en pausa",
  duplicate_reply_suppressed: "Respuesta duplicada evitada",
  duplicate_turn_skipped: "Mensaje ya en proceso por otro turno",
  empty_batch_skipped: "No respondió: no encontró mensajes nuevos para atender",
  duplicate_turn_skipped: "Mensaje duplicado",
  authorized_sale_workflow: "Expediente abierto/actualizado",
  payment_proof_auto_detected: "Comprobante recibido",
  conversation_patience_pause: "Cliente impaciente",
  frustration_detected: "Cliente molesto",
  operations_state_changed: "Operations actualizó el expediente",
  operations_customer_notification: "Aviso de Operations al cliente",
  reply_superseded: "Respuesta reemplazada (el cliente siguió escribiendo)",
  human_replied_skip: "No respondió: una persona del equipo ya había contestado",
  reassigned_skip: "No respondió: el chat está asignado a otra persona",
  stop_label_skip: "No respondió: el chat tiene una etiqueta de cierre",
  reply_outside_window: "Fuera de la ventana de 24 h (se usa plantilla)",
  auto_reply_ignored: "Respuesta automática del cliente ignorada",
  chatwoot_messages_fetch_failed: "No se pudieron leer los mensajes de Chatwoot",
  audio_transcribed: "Nota de voz transcrita",
  audio_transcription_failed: "No se pudo transcribir la nota de voz",
};

// Eventos que explican por qué Mia no contestó; van en el .txt junto a los mensajes.
const SILENCE_EVENTS = new Set(["empty_batch_skipped", "duplicate_turn_skipped", "audio_transcription_failed", "empty_reply_skipped", "human_replied_skip", "reassigned_skip", "stop_label_skip", "mia_paused_skip", "ai_error", "processing_error", "after_hours_skipped", "reply_outside_window", "duplicate_reply_suppressed", "reply_superseded", "auto_reply_ignored", "chatwoot_messages_fetch_failed", "followup_cancelled", "handoff", "specialized_advice_handoff", "ignored_out_of_schedule"]);

const REASON_LABELS = {
  human_replied: "Parecía que una persona ya había contestado",
  conversation_closed: "La conversación estaba cerrada",
  customer_wrote: "El cliente volvió a escribir",
  reassigned: "Se reasignó a otra persona",
  closed: "La conversación se cerró",
  paused_label: "Chat en pausa",
  stop_label: "Chat con etiqueta de cierre",
  not_applicable: "Ya no aplicaba",
  after_hours_notice: "Se quedó con el aviso de horario",
  unanswered: "Mensaje sin contestar",
};

export const STAGES = [
  ["exploring", "Explorando"],
  ["plan_recommended", "Plan recomendado"],
  ["explaining", "Plan explicado"],
  ["interested", "Interesado"],
  ["authorized", "Aceptó iniciar"],
  ["documents", "Documentos completos"],
];
const STAGE_RANK = Object.fromEntries(STAGES.map(([key], i) => [key, i]));
STAGE_RANK.objection_handling = STAGE_RANK.explaining;
STAGE_RANK.qualified = STAGE_RANK.exploring;
STAGE_RANK.handoff = STAGE_RANK.interested;

const norm = text => String(text || "").replace(/\s+/g, " ").trim();
const ms = iso => Date.parse(iso || "") || 0;

function stageRank(memory = {}) {
  if (memory.operations?.documents_complete) return STAGE_RANK.documents;
  if (memory.sales_cycle?.authorized) return STAGE_RANK.authorized;
  return STAGE_RANK[memory.sales_cycle?.stage] ?? 0;
}

function stageLabel(memory = {}) { return STAGES[stageRank(memory)]?.[1] || "Explorando"; }

function planOf(memory = {}) {
  const plan = memory.sales_cycle?.selected_plan || memory.sales_cycle?.recommended_plan || null;
  return plan === "plan_2" ? "Plan 2" : plan === "plan_1" ? "Plan 1" : null;
}

const DEFERRAL_LABELS = { no_money: "Sin dinero por ahora", later: "Avisará después", closing: "Se despidió" };

// Por qué se cambió lo que escribió la IA (reasons del processor y del quality-checker).
const REPLACED_LABELS = {
  fallo_ia: "La IA no respondió (error o tiempo agotado)",
  pide_frase_terminos: "Pedía escribir una frase exacta de términos y condiciones",
  pago_antes_de_vigencia: "Ofrecía datos de pago antes del alta",
  pidio_curp_nss_antes_de_autorizar: "Pedía CURP/NSS antes de que el cliente aceptara",
  recomendo_plan_sin_necesidad: "Recomendaba un plan sin saber qué busca el cliente",
  reparacion_fallida: "La corrección automática tampoco pasó",
  respuesta_vacia: "Respuesta vacía",
  respuesta_larga: "Respuesta demasiado larga",
  multiples_preguntas: "Hacía más de una pregunta",
  respuesta_demasiado_similar_a_la_anterior: "Casi igual a la respuesta anterior",
  nombre_ya_conocido: "Volvía a pedir el nombre",
  edad_ya_conocida: "Volvía a pedir la edad",
  actividad_ya_conocida: "Volvía a pedir la actividad",
  imss_ya_conocido: "Volvía a preguntar si tiene IMSS",
  politica_pago_prematura: "Hablaba de plazos de pago antes de autorizar",
  cotizacion_inventada: "Mencionaba una “cotización”",
  ubicacion_inventada: "Inventaba una dirección",
  identidad_incorrecta: "Se presentaba con otro nombre",
  fuera_de_tema_indebido: "Dijo “no era para nosotros” a una respuesta del cliente",
  catalogo_completo_prematuro: "Mostraba los dos planes demasiado pronto",
  precio_no_solicitado_en_apertura: "Daba precio sin que lo pidieran",
  detalle_operativo_prematuro: "Daba detalles operativos demasiado pronto",
};
export function replacedReasonLabel(reason = "") {
  const [key, detail] = String(reason).split(":");
  if (key === "pregunta_ya_contestada") return `Volvía a preguntar algo ya contestado (${detail || "dato"})`;
  if (key.startsWith("frase_prohibida")) return `Usaba una frase prohibida (${detail || ""})`;
  if (key.startsWith("pregunta_resuelta")) return `Preguntaba algo ya resuelto (${detail || ""})`;
  if (key.startsWith("dato_sensible_suprimido")) return `Pedía un dato que el cliente dijo que no tiene a la mano (${detail || ""})`;
  return REPLACED_LABELS[key] || key;
}

// Señales de calidad de una respuesta de Mia, en el contexto de la conversación.
function replyFlags(event, previousReplies) {
  const d = event.details || {};
  const flags = [];
  const reply = norm(d.reply);
  if (reply && previousReplies.has(reply)) flags.push("repetida");
  if (reply === GENERIC_REPLY || String(d.decision_source || "").startsWith("fallback")) flags.push("generica");
  if (d.decision_source === "llm_repair") flags.push("corregida");
  if (d.quality && d.quality.ok === false) flags.push("calidad");
  return flags;
}

export const FLAG_LABELS = {
  repetida: "Respuesta repetida",
  generica: "Respuesta genérica",
  corregida: "IA corregida por calidad",
  calidad: "No pasó la revisión de calidad",
  sin_respuesta: "Mia no respondió",
  error: "Error",
  no_retomado: "No se retomó al abrir",
  molesto: "Cliente molesto o impaciente",
};

export class MiaConsole {
  constructor({ config, memories, inspectorEvents, afterHours = null, followUps = null, isOpen = () => true, isMiaPaused = () => false, operationsConfig = null, chatwoot = null, selfSenders = null, testFile = null }) {
    Object.assign(this, { config, memories, inspectorEvents, afterHours, followUps, isOpen, isMiaPaused, operationsConfig, chatwoot, selfSenders, testFile });
    this.manualTests = new Set();
    if (testFile) {
      try { this.manualTests = new Set((JSON.parse(fs.readFileSync(testFile, "utf8"))?.ids || []).map(Number)); }
      catch (error) { if (error.code !== "ENOENT") console.error("Inspector: no se pudo leer chats de prueba:", error.message); }
    }
  }

  // Chats de prueba (no cuentan en Hoy, Calidad ni Embudo): marcados a mano en el Inspector,
  // listados en INSPECTOR_TEST_CONVERSATIONS o reiniciados alguna vez desde el LAB de Operations.
  testIds(allEvents = this.inspectorEvents.listAll()) {
    const ids = new Set([...this.manualTests, ...(this.config.inspector?.testConversations || []).map(Number)]);
    for (const e of allEvents) if (e.type === "lab.conversation_reset") ids.add(Number(e.conversationId));
    return ids;
  }

  setTest(id, test) {
    id = Number(id);
    if (!Number.isFinite(id) || id <= 0) throw new Error("Conversación inválida");
    if (test) this.manualTests.add(id); else this.manualTests.delete(id);
    if (this.testFile) {
      fs.mkdirSync(path.dirname(this.testFile), { recursive: true });
      fs.writeFileSync(`${this.testFile}.tmp`, JSON.stringify({ ids: [...this.manualTests] }, null, 2));
      fs.renameSync(`${this.testFile}.tmp`, this.testFile);
    }
    return { id, test: this.testIds().has(id) };
  }

  timezone() { return this.config.ai?.timezone || "America/Mexico_City"; }
  dayKey(date) { return localClock(new Date(date), this.timezone()).date; }

  allMemories({ includeTests = false } = {}) {
    const list = typeof this.memories.list === "function" ? this.memories.list() : [];
    if (includeTests) return list;
    const tests = this.testIds();
    return list.filter(m => !tests.has(Number(m.id)));
  }

  eventsByConversation({ includeTests = false } = {}) {
    const all = this.inspectorEvents.listAll();
    const tests = includeTests ? new Set() : this.testIds(all);
    const map = new Map();
    for (const event of all) {
      if (tests.has(Number(event.conversationId))) continue;
      if (!map.has(event.conversationId)) map.set(event.conversationId, []);
      map.get(event.conversationId).push(event);
    }
    return map;
  }

  followUpEntries() {
    const list = this.followUps?.store?.list?.() || [];
    return list.map(entry => ({ ...entry, next_at: this.followUps.dueAt ? new Date(this.followUps.dueAt(entry) || 0).toISOString() : null }));
  }

  summarize(memory, events = []) {
    const replies = events.filter(e => e.type === "ai_reply_sent");
    const lastReply = replies.at(-1);
    const lastCustomer = [...events].reverse().find(e => e.details?.customer_text);
    const lastAt = events.at(-1)?.timestamp || memory.actualizado_en || null;
    return {
      id: Number(memory.id),
      name: memory.nombre || null,
      stage: stageLabel(memory),
      stage_rank: stageRank(memory),
      plan: planOf(memory),
      authorized: Boolean(memory.sales_cycle?.authorized),
      deferral: DEFERRAL_LABELS[memory.sales_cycle?.deferral] || null,
      handoff: memory.handoff?.status || null,
      last_customer: lastCustomer?.details?.customer_text || null,
      last_reply: lastReply?.details?.reply || memory.ultima_respuesta_agente || null,
      last_source: lastReply ? sourceLabel(lastReply.details?.decision_source) : null,
      last_at: lastAt,
      replies: replies.length,
    };
  }

  // ── Hoy / en vivo ────────────────────────────────────────────────
  live(now = new Date()) {
    const today = this.dayKey(now);
    const byConv = this.eventsByConversation();
    const memories = new Map(this.allMemories().map(m => [Number(m.id), m]));
    const todayEvents = [...byConv.values()].flat().filter(e => this.dayKey(e.timestamp) === today);
    const count = type => todayEvents.filter(e => e.type === type).length;
    const conversationsToday = new Set(todayEvents.filter(e => e.type === "ai_reply_sent").map(e => e.conversationId));
    const newToday = [...byConv.entries()].filter(([, events]) => this.dayKey(events[0]?.timestamp) === today).length;
    const nameOf = id => memories.get(Number(id))?.nombre || null;

    const week = this.config.ai?.schedule ? parseSchedule(this.config.ai.schedule) : null;
    const attention = [];
    const since = now.getTime() - DAY;
    for (const [id, events] of byConv) {
      const recent = events.filter(e => ms(e.timestamp) >= since);
      const errors = recent.filter(e => ["ai_error", "processing_error", "followup_error", "pending_sweep_error"].includes(e.type));
      // Un chat que no se retomó deja de ser pendiente si Mia contestó después.
      const lastReplyAt = ms(events.filter(e => e.type === "ai_reply_sent").at(-1)?.timestamp);
      const skipped = recent.filter(e => e.type === "after_hours_skipped" && ms(e.timestamp) > lastReplyAt);
      const angry = recent.filter(e => ["frustration_detected", "conversation_patience_pause"].includes(e.type));
      const seen = new Set();
      let repeated = 0;
      for (const e of events.filter(x => x.type === "ai_reply_sent")) {
        const r = norm(e.details?.reply);
        if (seen.has(r) && ms(e.timestamp) >= since) repeated++;
        seen.add(r);
      }
      const reasons = [];
      if (errors.length) reasons.push(`${errors.length} error(es)`);
      if (skipped.length) reasons.push("No se retomó al abrir");
      if (angry.length) reasons.push("Cliente molesto o impaciente");
      if (repeated) reasons.push("Respuesta repetida");
      if (reasons.length) attention.push({ id, name: nameOf(id), reasons, at: recent.at(-1)?.timestamp || null });
    }
    attention.sort((a, b) => ms(b.at) - ms(a.at));

    const queue = (this.afterHours?.list?.() || []).map(e => ({ id: e.conversationId, name: nameOf(e.conversationId), since: e.first_at, messages: e.ids?.length || 0 }));
    const followUps = this.followUpEntries()
      .filter(e => Number(e.sent || 0) < (this.followUps?.offsets?.length || 3))
      .map(e => ({ id: e.conversationId, name: nameOf(e.conversationId), sent: Number(e.sent || 0), next_at: e.next_at }))
      .sort((a, b) => ms(a.next_at) - ms(b.next_at));
    const activity = [...byConv.values()].flat()
      .filter(e => EVENT_LABELS[e.type])
      .sort((a, b) => ms(b.timestamp) - ms(a.timestamp))
      .slice(0, 40)
      .map(e => ({ id: e.conversationId, name: nameOf(e.conversationId), at: e.timestamp, type: e.type, label: EVENT_LABELS[e.type], text: e.details?.reply || e.details?.text || REASON_LABELS[e.details?.reason] || e.details?.reason || null, source: e.type === "ai_reply_sent" ? sourceLabel(e.details?.decision_source) : null }));

    return {
      now: now.toISOString(),
      mia: {
        paused: Boolean(this.isMiaPaused()),
        open: this.isOpen(now),
        schedule: week ? describeSchedule(week) : "Siempre abierto",
        next_opening: week && !this.isOpen(now) ? nextOpeningDate(week, now, this.timezone()) : null,
      },
      kpis: {
        conversations_today: conversationsToday.size,
        new_today: newToday,
        replies_today: count("ai_reply_sent"),
        waiting_schedule: queue.length,
        followups_pending: followUps.length,
        followups_sent_today: count("followup_sent"),
        no_response_today: count("followup_no_response"),
        handoffs_today: count("handoff") + count("specialized_advice_handoff"),
        // Clientes cuyo expediente se abrió por primera vez hoy.
        authorized_today: [...byConv.values()].filter(events => this.dayKey(events.find(e => e.type === "authorized_sale_workflow")?.timestamp || 0) === today && events.some(e => e.type === "authorized_sale_workflow")).length,
        errors_today: count("ai_error") + count("processing_error"),
      },
      attention: attention.slice(0, 30),
      queue,
      followups: followUps.slice(0, 30),
      activity,
    };
  }

  // ── Conversaciones ───────────────────────────────────────────────
  conversations({ search = "", filter = "all", limit = 200 } = {}) {
    const byConv = this.eventsByConversation({ includeTests: true });
    const tests = this.testIds();
    const q = norm(search).toLowerCase();
    const queueIds = new Set((this.afterHours?.list?.() || []).map(e => Number(e.conversationId)));
    const followIds = new Set(this.followUpEntries().map(e => Number(e.conversationId)));
    let items = this.allMemories({ includeTests: true }).map(memory => ({
      ...this.summarize(memory, byConv.get(Number(memory.id)) || []),
      test: tests.has(Number(memory.id)),
      waiting_schedule: queueIds.has(Number(memory.id)),
      followup: followIds.has(Number(memory.id)),
    }));
    if (q) items = items.filter(i => [i.id, i.name, i.last_customer, i.last_reply].map(v => String(v || "").toLowerCase()).join(" ").includes(q));
    // Los chats de prueba solo aparecen en su propio filtro.
    items = filter === "tests" ? items.filter(i => i.test) : items.filter(i => !i.test);
    if (filter === "authorized") items = items.filter(i => i.authorized);
    if (filter === "deferred") items = items.filter(i => i.deferral);
    if (filter === "waiting") items = items.filter(i => i.waiting_schedule || i.followup);
    if (filter === "handoff") items = items.filter(i => i.handoff);
    return { items: items.sort((a, b) => ms(b.last_at) - ms(a.last_at)).slice(0, limit), total: items.length };
  }

  async conversation(id) {
    id = Number(id);
    const memory = this.memories.get(id);
    const events = this.inspectorEvents.get(id).map(e => ({ ...e, conversationId: id }));
    const replyEvents = events.filter(e => e.type === "ai_reply_sent");
    const followTexts = new Set(events.filter(e => e.type === "followup_sent").map(e => norm(e.details?.text)));

    // Conversación real desde Chatwoot; si no se puede leer, se arma con los eventos.
    let transcript = null;
    let transcriptError = null;
    if (this.chatwoot?.getMessages || this.chatwoot?.getAllMessages) {
      try {
        const raw = this.chatwoot.getAllMessages ? await this.chatwoot.getAllMessages(id) : await this.chatwoot.getMessages(id);
        const list = Array.isArray(raw?.payload) ? raw.payload : Array.isArray(raw) ? raw : [];
        const usedReplies = new Set();
        const transcribed = new Map(events.filter(e => e.type === "audio_transcribed" && e.details?.message_id).map(e => [String(e.details.message_id), e.details.text || ""]));
        transcript = list
          .filter(m => m && m.private !== true && [0, 1, "incoming", "outgoing"].includes(m.message_type))
          .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
          .map(m => {
            const incoming = m.message_type === 0 || m.message_type === "incoming";
            const text = norm(m.content);
            const at = new Date(Number(m.created_at || 0) * 1000).toISOString();
            if (incoming) {
              const voice = transcribed.get(String(m.id));
              return { who: "cliente", text: voice ? `🎤 (nota de voz) ${voice}` : m.content || "", at, attachments: (m.attachments || []).length };
            }
            // Cada mensaje de Mia se empareja con su propio evento (en orden), aunque el texto se repita.
            const match = replyEvents.find(e => !usedReplies.has(e) && norm(e.details?.reply) === text);
            if (match) usedReplies.add(match);
            let who = "persona";
            let label = m.sender?.name ? `Persona · ${m.sender.name}` : "Persona del equipo";
            if (match) { who = "mia"; label = sourceLabel(match.details?.decision_source); }
            else if (NOTICE_RE.test(text)) { who = "mia"; label = "Aviso de horario"; }
            else if (followTexts.has(text)) { who = "mia"; label = "Seguimiento"; }
            else if (this.selfSenders?.isOwn?.(m)) { who = "mia"; label = "Mia"; }
            return { who, label, text: m.content || "", at, attachments: (m.attachments || []).length, flags: match ? replyFlags(match, new Set(replyEvents.filter(r => ms(r.timestamp) < ms(match.timestamp)).map(r => norm(r.details?.reply)))) : [], why: match ? (match.details?.replaced_reasons || []).map(replacedReasonLabel) : [] };
          });
      } catch (error) { transcriptError = String(error?.message || error).slice(0, 200); }
    }
    if (!transcript) {
      transcript = [];
      const seen = new Set();
      for (const e of replyEvents) {
        if (e.details?.customer_text) transcript.push({ who: "cliente", text: e.details.customer_text, at: e.timestamp });
        transcript.push({ who: "mia", label: sourceLabel(e.details?.decision_source), text: e.details?.reply || "", at: e.timestamp, flags: replyFlags(e, seen), why: (e.details?.replaced_reasons || []).map(replacedReasonLabel) });
        seen.add(norm(e.details?.reply));
      }
    }

    const followUp = this.followUpEntries().find(e => Number(e.conversationId) === id) || null;
    const queued = (this.afterHours?.list?.() || []).find(e => Number(e.conversationId) === id) || null;
    return {
      id,
      test: this.testIds().has(id),
      summary: this.summarize({ ...memory, id }, events),
      facts: [
        ["Nombre", memory.nombre],
        ["Edad", memory.edad],
        ["Actividad", memory.actividad],
        ["Tiene IMSS", memory.tiene_imss === true ? "Sí" : memory.tiene_imss === false ? "No" : null],
        ["Necesidad", memory.necesidad_principal],
        ["Plan", planOf(memory)],
        ["Etapa", stageLabel(memory)],
        ["Aceptó iniciar", memory.sales_cycle?.authorized ? "Sí" : "No"],
        ["Documento pendiente", memory.operations?.onboarding_next || (memory.operations?.documents_complete ? "Completos" : null)],
        ["Pospuso", DEFERRAL_LABELS[memory.sales_cycle?.deferral] || null],
        ["Pasó a persona", memory.handoff?.status ? `${memory.handoff.agent_name || "Sí"}${memory.handoff.reason ? ` · ${memory.handoff.reason}` : ""}` : null],
      ].map(([label, value]) => ({ label, value: value === undefined || value === null || value === "" ? null : String(value) })),
      followup: followUp ? { sent: Number(followUp.sent || 0), next_at: followUp.next_at } : null,
      waiting_schedule: queued ? { since: queued.first_at, messages: queued.ids?.length || 0 } : null,
      transcript,
      transcript_error: transcriptError,
      events: events.slice().reverse().slice(0, 120).map(e => ({ at: e.timestamp, type: e.type, label: EVENT_LABELS[e.type] || e.type, source: e.type === "ai_reply_sent" ? sourceLabel(e.details?.decision_source) : null, details: e.details || {} })),
    };
  }

  // ── Exportar conversaciones a texto ─────────────────────────────
  // Todas las conversaciones con actividad entre `from` y `to` (fechas locales AAAA-MM-DD),
  // en un solo .txt: quién dijo qué, a qué hora, de dónde salió cada respuesta de Mia
  // y sus alertas. Sin teléfono, CURP ni NSS.
  async exportText({ from, to, filter = "all", now = new Date() } = {}) {
    const today = this.dayKey(now);
    const valid = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
    from = valid(from) ? from : today;
    to = valid(to) ? to : from;
    if (from > to) [from, to] = [to, from];
    const inRange = iso => { if (!iso) return false; const d = this.dayKey(iso); return d >= from && d <= to; };
    const byConv = this.eventsByConversation({ includeTests: true });
    const tests = this.testIds();
    let ids = this.allMemories({ includeTests: true })
      .filter(m => (byConv.get(Number(m.id)) || []).some(e => inRange(e.timestamp)))
      .map(m => Number(m.id));
    ids = filter === "tests" ? ids.filter(id => tests.has(id)) : ids.filter(id => !tests.has(id));
    const details = [];
    for (let i = 0; i < ids.length; i += 4) details.push(...await Promise.all(ids.slice(i, i + 4).map(id => this.conversation(id).then(c => ({ ...c, all_events: this.inspectorEvents.get(id) || [] })).catch(error => ({ id, error: String(error?.message || error) })))));
    if (filter === "authorized") details.splice(0, details.length, ...details.filter(c => c.summary?.authorized));
    if (filter === "handoff") details.splice(0, details.length, ...details.filter(c => c.summary?.handoff));
    details.sort((a, b) => ms(a.transcript?.[0]?.at) - ms(b.transcript?.[0]?.at));

    const tz = this.timezone();
    const stamp = iso => iso ? new Date(iso).toLocaleString("es-MX", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
    const line = "=".repeat(72);
    const out = [
      "MARTCOM · Conversaciones de Mia (NEXT)",
      `Rango: ${from === to ? from : `${from} a ${to}`} · ${details.length} conversación(es)${filter === "tests" ? " · solo chats de prueba" : " · sin chats de prueba"}`,
      `Generado: ${stamp(now.toISOString())} (hora del centro de México)`,
      "", line,
    ];
    details.forEach((c, index) => {
      if (c.error) { out.push(`#${index + 1} · Conversación ${c.id}`, `No se pudo leer: ${c.error}`, line); return; }
      const facts = (c.facts || []).filter(f => f.value).map(f => `${f.label}: ${f.value}`);
      out.push(`#${index + 1} · Conversación ${c.id} · ${c.summary?.name || "Sin nombre"}`);
      if (facts.length) out.push(facts.join(" · "));
      if (c.transcript_error) out.push(`(No se pudo leer Chatwoot: ${c.transcript_error}; se muestran solo los mensajes registrados por Mia)`);
      out.push("-".repeat(72));
      const notes = (c.all_events || []).filter(e => SILENCE_EVENTS.has(e.type)).map(e => {
        const d = e.details || {};
        const extra = [d.assignee_name ? `asignado a ${d.assignee_name}` : null, d.reason ? (REASON_LABELS[d.reason] || d.reason) : null, d.labels?.length ? `etiquetas: ${d.labels.join(", ")}` : null, d.error ? `error: ${String(d.error).slice(0, 160)}` : null, d.decision_source ? `origen: ${d.decision_source}` : null].filter(Boolean).join(" · ");
        return { who: "nota", at: e.timestamp, text: `⚙ ${EVENT_LABELS[e.type] || e.type}${extra ? ` (${extra})` : ""}` };
      });
      const lines = [...(c.transcript || []), ...notes].sort((a, b) => ms(a.at) - ms(b.at) || (a.who === "nota") - (b.who === "nota"));
      for (const m of lines) {
        if (m.who === "nota") { out.push(`   [${stamp(m.at)}] ${m.text}`, ""); continue; }
        const who = m.who === "cliente" ? "CLIENTE" : m.who === "mia" ? `MIA (${m.label || "Mia"})` : (m.label || "PERSONA").toUpperCase();
        const extras = [m.attachments ? `${m.attachments} adjunto(s)` : null, ...(m.flags || []).map(f => FLAG_LABELS[f] || f)].filter(Boolean);
        out.push(`[${stamp(m.at)}] ${who}${extras.length ? ` [${extras.join(" · ")}]` : ""}:`);
        out.push(String(m.text || (m.attachments ? "(solo adjunto)" : "(vacío)")).trim());
        if (m.why?.length) out.push(`   ↳ La IA había escrito otra cosa; se cambió porque: ${m.why.join("; ")}`);
        out.push("");
      }
      out.push(line);
    });
    const name = `mia-conversaciones-${from === to ? from : `${from}_a_${to}`}.txt`;
    return { name, text: out.join("\n") + "\n", count: details.length };
  }

  // ── Calidad ──────────────────────────────────────────────────────
  quality({ days = 7, now = new Date() } = {}) {
    const since = now.getTime() - days * DAY;
    const byConv = this.eventsByConversation();
    const memories = new Map(this.allMemories().map(m => [Number(m.id), m]));
    const items = [];
    const sources = { ia: 0, regla: 0, respaldo: 0 };
    let replies = 0;
    for (const [id, events] of byConv) {
      const seen = new Set();
      for (const e of events) {
        const inRange = ms(e.timestamp) >= since;
        const base = { id, name: memories.get(id)?.nombre || null, at: e.timestamp };
        if (e.type === "ai_reply_sent") {
          const flags = replyFlags(e, seen);
          seen.add(norm(e.details?.reply));
          if (!inRange) continue;
          replies++;
          sources[sourceKind(e.details?.decision_source)]++;
          if (flags.length) items.push({ ...base, flags, customer: e.details?.customer_text || null, reply: e.details?.reply || null, source: sourceLabel(e.details?.decision_source),
            ai_draft: e.details?.ai_draft || null, why: (e.details?.replaced_reasons || []).map(replacedReasonLabel) });
          continue;
        }
        if (!inRange) continue;
        if (e.type === "empty_reply_skipped" && !["customer_closing", "customer_deferral"].includes(e.details?.decision_source)) items.push({ ...base, flags: ["sin_respuesta"], customer: e.details?.customer_text || null, source: sourceLabel(e.details?.decision_source) });
        if (["ai_error", "processing_error"].includes(e.type)) items.push({ ...base, flags: ["error"], reply: e.details?.error || e.details?.message || null });
        if (e.type === "after_hours_skipped") items.push({ ...base, flags: ["no_retomado"], reply: REASON_LABELS[e.details?.reason] || e.details?.reason || null });
        if (["frustration_detected", "conversation_patience_pause"].includes(e.type)) items.push({ ...base, flags: ["molesto"], customer: e.details?.text || null });
      }
    }
    const counts = {};
    for (const item of items) for (const flag of item.flags) counts[flag] = (counts[flag] || 0) + 1;
    return {
      days,
      replies,
      sources,
      counts: Object.entries(FLAG_LABELS).map(([key, label]) => ({ key, label, count: counts[key] || 0 })),
      items: items.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, 300).map(i => ({ ...i, flag_labels: i.flags.map(f => FLAG_LABELS[f]) })),
    };
  }

  // ── Embudo y configuración ───────────────────────────────────────
  funnel({ days = 30, now = new Date() } = {}) {
    const since = now.getTime() - days * DAY;
    const byConv = this.eventsByConversation();
    const memories = this.allMemories().filter(m => {
      const last = ms(byConv.get(Number(m.id))?.at(-1)?.timestamp) || ms(m.actualizado_en);
      return last >= since;
    });
    const stages = STAGES.map(([key, label], i) => ({ key, label, count: memories.filter(m => stageRank(m) >= i).length }));
    const exits = Object.entries(DEFERRAL_LABELS).map(([key, label]) => ({ key, label, count: memories.filter(m => m.sales_cycle?.deferral === key).length }));
    const events = [...byConv.values()].flat().filter(e => ms(e.timestamp) >= since);
    const convWith = types => new Set(events.filter(e => types.includes(e.type)).map(e => e.conversationId)).size;
    exits.push({ key: "no_contesta", label: "No contestó a los seguimientos", count: convWith(["followup_no_response"]) });
    exits.push({ key: "handoff", label: "Pasó a una persona", count: convWith(["handoff", "specialized_advice_handoff"]) });
    const plans = ["Plan 1", "Plan 2"].map(label => ({ label, count: memories.filter(m => planOf(m) === label).length }));
    return { days, total: memories.length, stages, exits, plans };
  }

  configuration(now = new Date()) {
    const week = this.config.ai?.schedule ? parseSchedule(this.config.ai.schedule) : null;
    const groups = this.operationsConfig?.snapshot?.().groups || {};
    const names = { weekday: "Lunes a viernes", saturday: "Sábado", sunday: "Domingo" };
    return {
      schedule: { text: week ? describeSchedule(week) : "Siempre abierto", raw: this.config.ai?.schedule || null, timezone: this.timezone(), open_now: this.isOpen(now) },
      followups: { enabled: Boolean(this.followUps), minutes: (this.followUps?.offsets || []).map(v => Math.round(v / 60000)) },
      mia: { paused: Boolean(this.isMiaPaused()), model: this.config.openai?.model || null, name: this.config.ai?.publicName || "Mia de MARTCOM" },
      rotation: Object.entries(names).map(([key, label]) => ({ key, label, agents: (groups[key] || []).map(a => ({ id: a.id, name: a.name, enabled: a.enabled !== false })) })),
      admin_edit: Boolean(this.config.inspector?.adminToken),
    };
  }
}
