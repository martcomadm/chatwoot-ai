function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function normalizedName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasRecentEvent(events, type, sinceMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - sinceMs;
  return asArray(events).some((event) => event?.type === type && new Date(event.timestamp).getTime() >= cutoff);
}

export function buildAlerts(memory, timeline = []) {
  const alerts = [];
  const questions = asArray(memory?.preguntas_realizadas);
  const duplicates = questions.filter((value, index) => questions.indexOf(value) !== index);
  if (duplicates.length) alerts.push({ level: "warning", code: "repeated_question", message: `Preguntas repetidas detectadas: ${[...new Set(duplicates)].join(", ")}` });

  if (asArray(memory?.contradicciones).length) {
    alerts.push({ level: "warning", code: "memory_contradictions", message: `${memory.contradicciones.length} contradicción(es) en memoria.` });
  }

  if (memory?.curp_recibida && !memory?.nombre) {
    alerts.push({ level: "warning", code: "identity_incomplete", message: "Se recibió CURP pero el nombre no está confirmado." });
  }

  if (memory?.intent?.confidence != null && memory.intent.confidence > 0 && memory.intent.confidence < 0.75) {
    alerts.push({ level: "warning", code: "low_intent_confidence", message: `Confianza de intención baja: ${Math.round(memory.intent.confidence * 100)}%.` });
  }

  if (hasRecentEvent(timeline, "chatwoot_read_fallback")) {
    alerts.push({ level: "warning", code: "chatwoot_fallback", message: "Se utilizó respaldo del webhook por fallo de lectura de Chatwoot." });
  }

  if (asArray(timeline).some((event) => ["openai_error", "processor_error", "chatwoot_write_error"].includes(event?.type))) {
    alerts.push({ level: "error", code: "runtime_error", message: "La conversación registró al menos un error técnico." });
  }

  if (asArray(timeline).some((event) => event?.type === "quality_fallback")) {
    alerts.push({ level: "warning", code: "quality_fallback", message: "Se utilizó una respuesta de respaldo por control de calidad." });
  }


  if (Number(memory?.experiencia?.frustration_score || 0) > 0) {
    alerts.push({ level: Number(memory.experiencia.frustration_score) >= 2 ? "error" : "warning", code: "customer_frustration", message: `Frustración detectada (score ${memory.experiencia.frustration_score}).` });
  }

  if (memory?.slots?.curp_disponible === false && memory?.flujo?.siguiente_paso === "curp") {
    alerts.push({ level: "error", code: "unavailable_slot_planned", message: "El planner intenta pedir CURP aunque el cliente indicó que no la tiene disponible." });
  }
  if (memory?.caso_sujeto?.tipo === "tercero" && !memory?.caso_sujeto?.relacion) {
    alerts.push({ level: "warning", code: "third_party_unresolved", message: "Caso de tercero sin relación identificada." });
  }
  if ((memory?.resolved_questions || []).includes(memory?.flujo?.siguiente_paso)) {
    alerts.push({ level: "error", code: "resolved_question_planned", message: `El planner intenta preguntar un dato ya resuelto: ${memory.flujo.siguiente_paso}.` });
  }

  if (memory?.intent?.id === "RETIRO_AFORE_FALLECIMIENTO" && ["actividad", "curp", "tiene_imss"].includes(memory?.flujo?.siguiente_paso)) {
    alerts.push({ level: "error", code: "flow_mismatch", message: "El siguiente paso no coincide con el flujo especializado por fallecimiento." });
  }

  if (memory?.advisor_affinity?.agent_id && memory?.asesor_presentacion && normalizedName(memory.advisor_affinity.agent_name) !== normalizedName(memory.asesor_presentacion)) {
    alerts.push({ level: "warning", code: "identity_affinity_mismatch", message: `Presentación (${memory.asesor_presentacion}) distinta al asesor reservado (${memory.advisor_affinity.agent_name}). Conversación heredada o configuración previa.` });
  }
  if (memory?.advisor_affinity?.agent_id && memory?.handoff?.agent_id && Number(memory.advisor_affinity.agent_id) !== Number(memory.handoff.agent_id)) {
    alerts.push({ level: "error", code: "identity_handoff_mismatch", message: `El handoff fue a ID ${memory.handoff.agent_id}, pero la afinidad reservada corresponde al ID ${memory.advisor_affinity.agent_id}.` });
  }

  if (memory?.handoff?.status === "pending") {
    alerts.push({ level: "error", code: "handoff_pending", message: `Asignación automática pendiente${memory.handoff.agent_name ? ` para ${memory.handoff.agent_name}` : ""}: ${memory.handoff.last_error || "sin detalle"}.` });
  }

  return alerts;
}

export function explainDecision(memory, timeline = []) {
  const plannerEvent = [...asArray(timeline)].reverse().find((event) => event?.type === "decision_state");
  const planner = plannerEvent?.details?.planner || {};
  const reasons = [];

  if (memory?.intent?.id) reasons.push(`Intención detectada: ${memory.intent.label || memory.intent.id}.`);
  if (memory?.intent?.evidence?.length) reasons.push(`Evidencia: ${memory.intent.evidence.join("; ")}.`);
  if (memory?.intent?.confidence != null) reasons.push(`Confianza de clasificación: ${Math.round(Number(memory.intent.confidence || 0) * 100)}%.`);
  if (planner?.action) reasons.push(`El planner seleccionó la acción “${planner.action}”.`);
  if (planner?.question_key) reasons.push(`Dato objetivo del siguiente paso: ${planner.question_key}.`);
  if (memory?.flujo?.fase) reasons.push(`Fase actual: ${memory.flujo.fase}.`);
  if (memory?.ultima_pregunta) reasons.push(`Última pregunta registrada: ${memory.ultima_pregunta}.`);
  if (memory?.resolved_questions?.length) reasons.push(`Preguntas resueltas: ${memory.resolved_questions.join(", ")}.`);
  if (memory?.orchestration?.direct_request?.type) reasons.push(`Solicitud directa detectada: ${memory.orchestration.direct_request.type}; debe responderse antes del siguiente paso.`);
  if (memory?.caso_sujeto?.tipo === "tercero") reasons.push(`El caso corresponde a un tercero (${memory.caso_sujeto.relacion || "relación pendiente"}).`);
  if (memory?.slots?.curp_disponible === false) reasons.push("El cliente indicó que la CURP no está disponible; no debe volver a solicitarse.");
  if (Number(memory?.experiencia?.frustration_score || 0) > 0) reasons.push(`Frustración acumulada: ${memory.experiencia.frustration_score}.`);
  if (memory?.advisor_affinity?.agent_id) reasons.push(`Afinidad de asesor: ${memory.advisor_affinity.agent_name} (ID ${memory.advisor_affinity.agent_id}), reservado para presentación y handoff.`);
  if (memory?.handoff?.status === "completed") reasons.push(`Handoff automático completado con ${memory.handoff.agent_name || memory.handoff.agent_id} (${memory.handoff.group || "turno"}).`);
  if (memory?.handoff?.status === "pending") reasons.push(`Handoff automático pendiente: ${memory.handoff.last_error || "error sin detalle"}.`);

  const answered = [];
  if (memory?.nombre) answered.push("nombre");
  if (memory?.edad != null) answered.push("edad");
  if (memory?.actividad) answered.push("actividad");
  if (memory?.tiene_imss != null) answered.push("situación IMSS");
  if (memory?.necesidad_principal) answered.push("necesidad");
  if (answered.length) reasons.push(`Datos ya confirmados: ${answered.join(", ")}.`);

  return {
    action: planner?.action || memory?.flujo?.siguiente_paso || null,
    questionKey: planner?.question_key || memory?.flujo?.siguiente_paso || null,
    reasons,
  };
}

export function summarizeConversation(memory, timeline = [], id = null) {
  const alerts = buildAlerts(memory, timeline);
  return {
    id: Number(id ?? memory?.id),
    nombre: memory?.nombre || null,
    necesidad: memory?.necesidad_principal || null,
    fase: memory?.flujo?.fase || null,
    nextStep: memory?.flujo?.siguiente_paso || null,
    plan: memory?.ventas?.plan_recomendado || null,
    temperatura: memory?.ventas?.temperatura || null,
    asesor: memory?.advisor_affinity?.agent_name || memory?.asesor_presentacion || null,
    presentationAdvisor: memory?.asesor_presentacion || null,
    affinityAgent: memory?.advisor_affinity?.agent_name || null,
    affinityAgentId: memory?.advisor_affinity?.agent_id || null,
    intent: memory?.intent?.label || memory?.intent?.id || null,
    intentId: memory?.intent?.id || null,
    intentConfidence: memory?.intent?.confidence ?? null,
    priority: memory?.intent?.priority || "normal",
    curp: Boolean(memory?.curp_recibida),
    nss: Boolean(memory?.nss_recibido),
    handoffStatus: memory?.handoff?.status || null,
    handoffAgent: memory?.handoff?.agent_name || null,
    handoffAgentId: memory?.handoff?.agent_id || null,
    handoffGroup: memory?.handoff?.group || null,
    contradictions: asArray(memory?.contradicciones).length,
    alertCount: alerts.length,
    hasErrorAlert: alerts.some((alert) => alert.level === "error"),
    actualizado_en: memory?.actualizado_en || null,
  };
}

function localDateKey(value, timezone="America/Mexico_City"){
  if(!value) return null;
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:timezone}).formatToParts(date);
  const get = type => parts.find(p=>p.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function filterConversations(items, query = {}, timezone="America/Mexico_City") {
  const search = lower(query.search).trim();
  const intent = lower(query.intent).trim();
  const advisor = lower(query.advisor).trim();
  const phase = lower(query.phase).trim();
  const temperature = lower(query.temperature).trim();
  const priority = lower(query.priority).trim();
  const alertsOnly = String(query.alerts || "") === "1";
  const from = String(query.from || "").trim();
  const to = String(query.to || "").trim();
  const sort = String(query.sort || "newest").trim();

  return items.filter((item) => {
    if (search) {
      const haystack = [item.id, item.nombre, item.necesidad, item.intent, item.plan, item.asesor].map(lower).join(" ");
      if (!haystack.includes(search)) return false;
    }
    if (intent && lower(item.intentId) !== intent && lower(item.intent) !== intent) return false;
    if (advisor && lower(item.asesor) !== advisor) return false;
    if (phase && lower(item.fase) !== phase) return false;
    if (temperature && lower(item.temperatura) !== temperature) return false;
    if (priority && lower(item.priority) !== priority) return false;
    if (alertsOnly && !item.alertCount) return false;
    if (from || to) {
      const key = localDateKey(item.actualizado_en, timezone);
      if (!key) return false;
      if (from && key < from) return false;
      if (to && key > to) return false;
    }
    return true;
  }).sort((a,b)=>{
    if(sort === "oldest") return new Date(a.actualizado_en||0)-new Date(b.actualizado_en||0);
    if(sort === "id_asc") return Number(a.id)-Number(b.id);
    if(sort === "id_desc") return Number(b.id)-Number(a.id);
    if(sort === "name") return String(a.nombre||"").localeCompare(String(b.nombre||""),"es");
    if(sort === "alerts") return Number(b.alertCount||0)-Number(a.alertCount||0) || new Date(b.actualizado_en||0)-new Date(a.actualizado_en||0);
    return new Date(b.actualizado_en||0)-new Date(a.actualizado_en||0);
  });
}

export function dashboardStats(items = [], events = []) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent = items.filter((item) => item.actualizado_en && now - new Date(item.actualizado_en).getTime() <= day);
  const transferred = items.filter((item) => item.handoffStatus === "completed" || item.fase === "transferencia" || item.curp || item.nss);
  const handoffsCompleted = items.filter((item) => item.handoffStatus === "completed");
  const handoffsPending = items.filter((item) => item.handoffStatus === "pending");
  const hot = items.filter((item) => lower(item.temperatura) === "caliente");
  const withAlerts = items.filter((item) => item.alertCount > 0);
  const errors24h = asArray(events).filter((event) => {
    const age = now - new Date(event.timestamp).getTime();
    return age <= day && ["openai_error", "processor_error", "chatwoot_write_error"].includes(event.type);
  }).length;

  return {
    total: items.length,
    recent24h: recent.length,
    transferred: transferred.length,
    hot: hot.length,
    withAlerts: withAlerts.length,
    errors24h,
    handoffsCompleted: handoffsCompleted.length,
    handoffsPending: handoffsPending.length,
  };
}

export function uniqueFilterOptions(items = []) {
  const unique = (key) => [...new Set(items.map((item) => item[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  return {
    intents: unique("intent"),
    advisors: unique("asesor"),
    phases: unique("fase"),
    temperatures: unique("temperatura"),
    priorities: unique("priority"),
  };
}
