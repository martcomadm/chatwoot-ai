import { extractConversationAttachments } from "./document-service.js";
import { onboardingStateFromSale } from "./onboarding-service.js";

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
      telefono: sender.phone_number || sender.identifier || null,
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
    documents: { files: extractConversationAttachments(conversation) },
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
