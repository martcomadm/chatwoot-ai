// Intervención de Captura en un chat de Mia (pedido 3-nov): alguien de Captura toma la
// conversación para ayudar o salvar la venta. La conversación se asigna en Chatwoot a esa
// persona; con eso Mia se queda callada (guarda de asignación) y los seguimientos se detienen.
// "Regresar a Mia" la vuelve a asignar al agente de Mia.
export function interventionActive(memory) {
  return Boolean(memory?.capture_intervention?.active);
}

export async function interveneConversation({ memories, chatwoot, conversationId, user, note = "", audit = null, inspectorEvents = null }) {
  const id = Number(conversationId);
  if (!id) throw new Error("Conversación no válida");
  const memory = memories.get(id);
  if (!memory) throw new Error("Esta conversación no la atiende Mia");
  if (interventionActive(memory)) throw new Error(`Este chat ya lo intervino ${memory.capture_intervention.by || "otra persona"}`);
  const agentId = Number(user?.chatwoot_agent_id || 0);
  if (!agentId) throw new Error("Tu usuario no tiene un agente de Chatwoot. Pide a Admin que lo configure para poder intervenir.");
  if (!chatwoot?.assignConversation) throw new Error("Chatwoot no está disponible");
  const text = String(note || "").trim();
  await chatwoot.assignConversation(id, agentId);
  const at = new Date().toISOString();
  await memories.merge(id, { capture_intervention: { active: true, by: user.name || user.username, username: user.username, agent_id: agentId, note: text || null, at } });
  try { await chatwoot.sendMessage?.(id, `CAPTURA INTERVINO ESTE CHAT\nResponsable: ${user.name || user.username}\nMia deja de contestar mientras la conversación esté asignada a esta persona.${text ? `\nNota: ${text}` : ""}`, true); } catch {}
  try { await inspectorEvents?.record?.(id, "capture_intervention", { by: user.name || user.username, note: text || null }); } catch {}
  audit?.record?.("mia.intervene", { username: user.username, name: user.name }, { conversation_id: id, note: text || null });
  return memories.get(id);
}

export async function releaseConversation({ memories, chatwoot, conversationId, user, miaAgentId, note = "", canForce = false, audit = null, inspectorEvents = null }) {
  const id = Number(conversationId);
  const memory = memories.get(id);
  if (!interventionActive(memory)) throw new Error("Este chat no está intervenido");
  if (memory.capture_intervention.username && memory.capture_intervention.username !== user.username && !canForce) throw new Error(`Este chat lo tiene ${memory.capture_intervention.by}`);
  if (!miaAgentId) throw new Error("No está configurado el agente de Mia en Chatwoot");
  const text = String(note || "").trim();
  await chatwoot.assignConversation(id, Number(miaAgentId));
  await memories.merge(id, { capture_intervention: { ...memory.capture_intervention, active: false, released_at: new Date().toISOString(), released_by: user.name || user.username } });
  try { await chatwoot.sendMessage?.(id, `CAPTURA REGRESÓ EL CHAT A MIA\nPor: ${user.name || user.username}${text ? `\nNota: ${text}` : ""}`, true); } catch {}
  try { await inspectorEvents?.record?.(id, "capture_intervention_released", { by: user.name || user.username, note: text || null }); } catch {}
  audit?.record?.("mia.release", { username: user.username, name: user.name }, { conversation_id: id, note: text || null });
  return memories.get(id);
}

// Omitir un chat (pedido 11-nov): el equipo lo saca de Mia por completo. Mia no le contesta, no le manda
// seguimientos ni plantillas de reactivación, no genera avisos a Captura y el chat sale de las listas de
// Chats de Mia (queda en "Omitidos"). No se toca nada en Chatwoot (ni asignación ni etiquetas): quien lo
// atiende sigue igual. "Dejar de omitir" lo regresa a la normalidad.
export function chatOmitted(memory) {
  return Boolean(memory?.mia_omitted?.active);
}

export async function omitConversation({ memories, conversationId, user, note = "", followUps = null, audit = null, inspectorEvents = null }) {
  const id = Number(conversationId);
  if (!id) throw new Error("Conversación no válida");
  const memory = memories.get(id);
  if (!memory) throw new Error("Esta conversación no la atiende Mia");
  if (chatOmitted(memory)) throw new Error(`Este chat ya lo omitió ${memory.mia_omitted.by || "otra persona"}`);
  const text = String(note || "").trim().slice(0, 300) || null;
  await memories.merge(id, { mia_omitted: { active: true, by: user.name || user.username, username: user.username, note: text, at: new Date().toISOString() } });
  try { followUps?.cancel?.(id, "omitted"); } catch {}
  try { await inspectorEvents?.record?.(id, "mia_omitted", { by: user.name || user.username, note: text }); } catch {}
  audit?.record?.("mia.omit", { username: user.username, name: user.name }, { conversation_id: id, note: text });
  return memories.get(id);
}

export async function unomitConversation({ memories, conversationId, user, audit = null, inspectorEvents = null }) {
  const id = Number(conversationId);
  const memory = memories.get(id);
  if (!chatOmitted(memory)) throw new Error("Este chat no está omitido");
  await memories.merge(id, { mia_omitted: { ...memory.mia_omitted, active: false, restored_at: new Date().toISOString(), restored_by: user.name || user.username } });
  try { await inspectorEvents?.record?.(id, "mia_unomitted", { by: user.name || user.username }); } catch {}
  audit?.record?.("mia.unomit", { username: user.username, name: user.name }, { conversation_id: id });
  return memories.get(id);
}
