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
