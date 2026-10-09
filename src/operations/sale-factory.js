import { extractConversationAttachments } from "./document-service.js";
import { onboardingStateFromSale } from "./onboarding-service.js";

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^whatsapp:/i, "").replace(/[\s().-]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return cleaned.startsWith("+") ? `+${digits}` : digits;
}

function extractContactPhone(conversation = {}) {
  const meta = conversation?.meta || {};
  const sender = meta.sender || conversation?.contact || {};
  const candidates = [
    sender.phone_number,
    sender.phone,
    sender.identifier,
    sender.additional_attributes?.phone_number,
    sender.additional_attributes?.phone,
    sender.custom_attributes?.phone_number,
    conversation?.contact?.phone_number,
    conversation?.contact?.phone,
    conversation?.contact?.identifier,
    conversation?.contact?.additional_attributes?.phone_number,
    conversation?.contact_inbox?.source_id,
    meta?.contact_inbox?.source_id,
    sender?.contact_inboxes?.[0]?.source_id,
    conversation?.contact?.contact_inboxes?.[0]?.source_id,
    conversation?.contact_inboxes?.[0]?.source_id,
    conversation?.additional_attributes?.phone_number,
  ];
  for (const value of candidates) {
    const phone = normalizePhone(value);
    if (phone) return phone;
  }
  return null;
}

function planPrice(plan) {
  if (plan === "plan_1") return 1100;
  if (plan === "plan_2") return 1500;
  return null;
}

export function saleInputFromMemory({ conversationId, conversation = {}, memory = {} }) {
  const plan = memory.sales_cycle?.selected_plan || memory.sales_cycle?.recommended_plan || null;
  const meta = conversation?.meta || {};
  const sender = meta.sender || conversation?.contact || {};
  return {
    conversation_id: Number(conversationId),
    contact_id: Number(sender.id || conversation?.contact_id || 0) || null,
    customer: {
      nombre: memory.nombre || sender.name || null,
      telefono: extractContactPhone(conversation),
      edad: memory.edad ?? null,
      actividad: memory.actividad || null,
      curp: memory.curp_valor || null,
      nss: memory.nss_valor || null,
    },
    sale: {
      plan,
      precio: planPrice(plan),
      salario_diario: 480,
      authorized: Boolean(memory.sales_cycle?.authorized),
      authorization_text: memory.sales_cycle?.authorization_text || null,
    },
    documents: { files: extractConversationAttachments(conversation, { expectedType: memory.operations?.onboarding_next || memory.operations?.onboarding_last_requested || null }) },
  };
}

export async function ensureAuthorizedSale({ workflow, memories, inspectorEvents, conversationId, conversation, memory }) {
  if (!memory.sales_cycle?.authorized) return { created: false, sale: null };
  const input = saleInputFromMemory({ conversationId, conversation, memory });
  let sale = workflow.openAuthorizedSale(input);
  sale = workflow.syncDocuments(sale.sale_id, { customer: input.customer, files: input.documents.files });
  const onboarding = onboardingStateFromSale(sale);
  await memories.merge(conversationId, {
    sale_id: sale.sale_id,
    operations: { sale_id: sale.sale_id, status: sale.status, queue: sale.queue, ...onboarding, updated_at: sale.updated_at },
    sales_cycle: { ...memory.sales_cycle, stage: "authorized" },
  });
  try { await inspectorEvents?.record(conversationId, "operations_sale_ready", { sale_id: sale.sale_id, status: sale.status, queue: sale.queue, ...onboarding }); } catch {}
  return { created: true, sale };
}
