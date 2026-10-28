// Venta cerrada por Atención a Clientes (pedido 28-oct): la persona de Atención cerró la venta y el cliente
// se queda con ella. Mia ya no sigue el proceso normal de venta en esa conversación (no responde, no manda
// seguimientos) hasta que alguien la regrese a Mia.
//
// Se marca en tres lugares para que ningún camino la reactive por error:
// - memoria de la conversación (service_sale.active) → el procesador de Mia la ignora;
// - etiqueta "venta" en Chatwoot → los seguimientos automáticos se detienen;
// - la conversación queda asignada a quien tiene el caso.
export const SERVICE_SALE_LABEL = "venta";
const PLAN_LABELS = { plan_1: "Plan 1", plan_2: "Plan 2" };

export function serviceSaleActive(memory) {
  return Boolean(memory?.service_sale?.active);
}

async function setLabel(chatwoot, conversationId, add) {
  if (typeof chatwoot?.getLabels !== "function" || typeof chatwoot?.setLabels !== "function") return;
  const current = (await chatwoot.getLabels(conversationId))?.payload || [];
  const next = add ? [...new Set([...current, SERVICE_SALE_LABEL])] : current.filter(label => label !== SERVICE_SALE_LABEL);
  if (next.length !== current.length) await chatwoot.setLabels(conversationId, next);
}

export async function closeSaleInService({ customerService, memories, chatwoot = null, c, user, plan = "", note = "", logger = console }) {
  if (!c?.conversation_id) throw new Error("Este caso no tiene conversación");
  if (c.status === "resolved") throw new Error("Reabre el caso antes de cerrar la venta");
  const memory = memories.get(c.conversation_id) || {};
  if (serviceSaleActive(memory)) throw new Error("La venta de este cliente ya la cerró Atención a Clientes");
  const planKey = PLAN_LABELS[plan] ? plan : null;
  const by = { username: user.username, name: user.name };
  let current = c;
  // Si nadie lo tenía, se queda con quien cerró la venta (y en Chatwoot también).
  if (!current.assignee && (user.areas || []).includes("atencion")) current = await customerService.assign(current, { username: user.username, by });
  const owner = current.assignee || by;
  const at = new Date().toISOString();
  await memories.merge(c.conversation_id, { service_sale: { active: true, case_id: c.case_id, plan: planKey, note: String(note || "").trim() || null, by: by.name, owner: owner.name || null, at } });
  const updated = customerService.store.runAs(by, () => customerService.store.update(current.case_id, {
    service_sale: { active: true, plan: planKey, at, by: by.name },
    status: "in_progress", resolved_at: null,
    customer: { ...current.customer, plan: planKey || current.customer?.plan || null },
  }, "case.sale_closed", { note: [planKey ? PLAN_LABELS[planKey] : null, String(note || "").trim() || null].filter(Boolean).join(" · ") || null }));
  try {
    await setLabel(chatwoot, c.conversation_id, true);
    if (owner.chatwoot_agent_id && chatwoot?.assignConversation) await chatwoot.assignConversation(c.conversation_id, Number(owner.chatwoot_agent_id));
    await chatwoot?.sendMessage?.(c.conversation_id, `ATENCIÓN A CLIENTES CERRÓ LA VENTA${planKey ? ` (${PLAN_LABELS[planKey]})` : ""}\nResponsable: ${owner.name || by.name}\nMia ya no sigue el proceso de venta en esta conversación.${String(note || "").trim() ? `\nNota: ${String(note).trim()}` : ""}`, true);
  } catch (error) { logger.warn?.("Venta cerrada por Atención (Chatwoot):", error?.message || error); }
  return updated;
}

export async function returnSaleToMia({ customerService, memories, chatwoot = null, c, user, miaAgentId = null, note = "", logger = console }) {
  if (!c?.conversation_id) throw new Error("Este caso no tiene conversación");
  const memory = memories.get(c.conversation_id) || {};
  if (!serviceSaleActive(memory) && !c.service_sale?.active) throw new Error("Este caso no tiene una venta cerrada por Atención a Clientes");
  if (!String(note || "").trim()) throw new Error("Escribe por qué regresa con Mia");
  const by = { username: user.username, name: user.name };
  await memories.merge(c.conversation_id, { service_sale: { active: false, returned_at: new Date().toISOString(), returned_by: by.name } });
  const updated = customerService.store.runAs(by, () => customerService.store.update(c.case_id, { service_sale: { ...(c.service_sale || {}), active: false } }, "case.sale_returned", { note: String(note).trim() }));
  try {
    await setLabel(chatwoot, c.conversation_id, false);
    if (miaAgentId && chatwoot?.assignConversation) await chatwoot.assignConversation(c.conversation_id, Number(miaAgentId));
    await chatwoot?.sendMessage?.(c.conversation_id, `ATENCIÓN A CLIENTES REGRESÓ LA CONVERSACIÓN A MIA\nPor: ${by.name}\nMotivo: ${String(note).trim()}`, true);
  } catch (error) { logger.warn?.("Regresar a Mia (Chatwoot):", error?.message || error); }
  return updated;
}
