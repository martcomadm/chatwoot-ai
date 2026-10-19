import { onboardingStateFromSale, operationsMemoryFromSale } from "./onboarding-service.js";
import { renderCustomerMessage } from "./customer-messages.js";
import { replyWindowOpen, TEMPLATE_TEXTS } from "../chatwoot/whatsapp-templates.js";

const ATTACHMENT_DELIVERIES = Object.freeze({
  validity: {
    section: "validity", event: "validity.document",
    base64: "document_base64", name: "document_name", contentType: "document_content_type",
    started: "delivery_started_at", delivered: "delivered_to_customer", deliveredAt: "delivered_at",
    error: "delivery_error", attempts: "delivery_attempts",
    defaultName: "vigencia.pdf", defaultType: "application/pdf",
    statuses: ["validity_confirmed", "payment_requested", "payment_received", "payment_issue", "payment_validated", "completed"],
    details: section => ({ document_name: section.document_name || null }),
  },
  payment: {
    section: "payment", event: "payment.accounts_image",
    base64: "accounts_image_base64", name: "accounts_image_name", contentType: "accounts_image_content_type",
    started: "accounts_image_delivery_started_at", delivered: "accounts_image_delivered", deliveredAt: "accounts_image_delivered_at",
    error: "accounts_image_delivery_error", attempts: "accounts_image_delivery_attempts",
    defaultName: "cuentas.jpg", defaultType: "image/jpeg",
    statuses: ["payment_requested"],
    details: section => ({ accounts_image_name: section.accounts_image_name || null, due_date: section.due_date || null }),
  },
});

export class ChatwootWorkflowBridge{
  constructor({saleStore,chatwoot,labels,memories,inspectorEvents,customerServiceTeamId=0,settings=null,templates=null}){this.templates=templates;this.saleStore=saleStore;this.settings=settings;this.chatwoot=chatwoot;this.labels=labels;this.memories=memories;this.inspectorEvents=inspectorEvents;this.customerServiceTeamId=Number(customerServiceTeamId||0);this.listener=event=>this.handle(event).catch(error=>console.error("NEXT workflow bridge:",error))}
  start(){this.saleStore.on("sale",this.listener)}
  stop(){this.saleStore.off("sale",this.listener)}
  async reconcileCompletedSales(){
    const completed=this.saleStore.list({status:"completed"});
    for(const sale of completed){
      const conversationId=Number(sale?.conversation_id||0);
      if(!conversationId)continue;
      try{
        const conversation=await this.chatwoot.getConversation(conversationId);
        const rawLabels=conversation?.labels||conversation?.meta?.labels||[];
        const labels=rawLabels.map(item=>typeof item==="string"?item:item?.title||item?.name).filter(Boolean);
        const teamId=Number(conversation?.meta?.team?.id||conversation?.team?.id||0);
        if(labels.includes("completado")&&teamId===this.customerServiceTeamId)continue;
        await this.completeHumanHandoff(conversationId,sale);
        await this.record(conversationId,"completed_handoff_reconciled",{sale_id:sale.sale_id,team_id:this.customerServiceTeamId});
      }catch(error){
        await this.record(conversationId,"completed_handoff_reconcile_failed",{sale_id:sale.sale_id,error:error.message});
        console.error("NEXT no pudo reconciliar expediente completado:",error);
      }
    }
  }
  async record(conversationId,type,details={}){try{await this.inspectorEvents?.record(conversationId,type,details)}catch{}}
  // Texto configurado en Admin (o el predeterminado) para el evento; null si no notifica.
  customerMessage(event){return renderCustomerMessage(event.type,{sale:event.sale,details:event.details},this.settings?.customerMessages?.()||{})}
  async completeHumanHandoff(conversationId,sale){
    if(!this.customerServiceTeamId){await this.record(conversationId,"completed_handoff_skipped",{sale_id:sale.sale_id,reason:"customer_service_team_not_configured"});console.warn("NEXT completó expediente pero CUSTOMER_SERVICE_TEAM_ID no está configurado.");return;}
    try{
      await this.labels?.finalizeForCustomerService(conversationId);
      await this.chatwoot.assignTeam(conversationId,this.customerServiceTeamId);
      await this.record(conversationId,"completed_handoff",{sale_id:sale.sale_id,label:"completado",team_id:this.customerServiceTeamId});
    }catch(error){
      await this.record(conversationId,"completed_handoff_failed",{sale_id:sale.sale_id,team_id:this.customerServiceTeamId,error:error.message});
      console.error("NEXT no pudo transferir expediente completado a Atención a Clientes:",error);
    }
  }
  // Envía un adjunto (vigencia o cuentas de pago) una sola vez. Si Chatwoot falla,
  // libera el envío para que retryPendingDeliveries() lo reintente; antes quedaba
  // marcado como "en envío" para siempre y el cliente nunca recibía el documento.
  async deliverAttachment(sale, kind, content) {
    const spec = ATTACHMENT_DELIVERIES[kind];
    const section = sale?.[spec.section] || {};
    const base64 = section[spec.base64];
    if (!base64 || section[spec.delivered]) return false;
    const startedAt = new Date().toISOString();
    await this.saleStore.update(sale.sale_id, { [spec.section]: { ...section, [spec.started]: startedAt, [spec.error]: null } }, `${spec.event}.delivery_started`, spec.details(section));
    try {
      await this.chatwoot.sendMessageWithAttachment(Number(sale.conversation_id), content, {
        base64,
        filename: section[spec.name] || spec.defaultName,
        contentType: section[spec.contentType] || spec.defaultType,
      });
    } catch (error) {
      const current = this.saleStore.get(sale.sale_id)?.[spec.section] || section;
      await this.saleStore.update(sale.sale_id, { [spec.section]: { ...current, [spec.started]: null, [spec.error]: String(error?.message || error).slice(0, 500), [spec.attempts]: Number(current[spec.attempts] || 0) + 1 } }, `${spec.event}.delivery_failed`, { ...spec.details(section), error: String(error?.message || error).slice(0, 200) });
      await this.record(Number(sale.conversation_id), `${spec.event}_delivery_failed`, { sale_id: sale.sale_id, error: String(error?.message || error).slice(0, 200) });
      console.error(`NEXT no pudo entregar ${spec.event} del expediente ${sale.sale_id}:`, error?.message || error);
      return false;
    }
    const current = this.saleStore.get(sale.sale_id)?.[spec.section] || section;
    await this.saleStore.update(sale.sale_id, { [spec.section]: { ...current, [spec.base64]: null, [spec.started]: startedAt, [spec.delivered]: true, [spec.deliveredAt]: new Date().toISOString(), [spec.error]: null } }, `${spec.event}.delivered`, spec.details(section));
    return true;
  }

  // Reintenta adjuntos pendientes: fallidos, o "en envío" desde hace más de 10 minutos
  // (por ejemplo, si el proceso se reinició a mitad del envío).
  async retryPendingDeliveries({ staleMs = 10 * 60 * 1000 } = {}) {
    const results = [];
    for (const sale of this.saleStore.list()) {
      if (!Number(sale?.conversation_id)) continue;
      for (const [kind, spec] of Object.entries(ATTACHMENT_DELIVERIES)) {
        const section = sale[spec.section] || {};
        if (kind === "validity" && section.awaiting_customer_reply) {
          results.push({ sale_id: sale.sale_id, kind, delivered: await this.deliverAwaitingValidity(Number(sale.conversation_id), { checkWindow: true }) });
          continue;
        }
        if (!section[spec.base64] || section[spec.delivered] || !spec.statuses.includes(sale.status)) continue;
        const started = Date.parse(section[spec.started] || "");
        if (Number.isFinite(started) && Date.now() - started < staleMs) continue;
        const content = this.customerMessage({ type: kind === "validity" ? "validity.confirmed" : "payment.requested", sale, details: {} });
        results.push({ sale_id: sale.sale_id, kind, delivered: await this.deliverAttachment(sale, kind, content) });
      }
    }
    return results;
  }

  // ¿Se le puede escribir al cliente sin plantilla? Ante un error de Chatwoot se asume que sí
  // (comportamiento anterior) para no frenar la entrega.
  async windowOpen(conversationId) {
    try { return replyWindowOpen(await this.chatwoot.getConversation(conversationId)); }
    catch (error) { await this.record(conversationId, "reply_window_check_failed", { error: String(error?.message || error).slice(0, 200) }); return true; }
  }

  // Vigencia lista pero el cliente está fuera de las 24 h: se manda la plantilla "vigencia1"
  // y el documento se entrega en cuanto el cliente conteste. Devuelve true si quedó en espera.
  async holdValidityForReply(conversationId, sale) {
    if (!this.templates?.enabled?.("validity") || await this.windowOpen(conversationId)) return false;
    const result = await this.templates.send(conversationId, "validity");
    await this.record(conversationId, result.sent ? "validity_template_sent" : "validity_template_failed", { sale_id: sale.sale_id, ...result });
    if (!result.sent) return false;
    const current = this.saleStore.get(sale.sale_id)?.validity || sale.validity || {};
    await this.saleStore.update(sale.sale_id, { validity: { ...current, awaiting_customer_reply: true, template_sent_at: new Date().toISOString() } }, "validity.awaiting_customer_reply", { template: result.name });
    return true;
  }

  // El cliente contestó a la plantilla de vigencia: se entrega el documento con su mensaje.
  async deliverAwaitingValidity(conversationId, { checkWindow = false } = {}) {
    const sale = this.saleStore.findByConversationId?.(conversationId);
    const section = sale?.validity || {};
    if (!section.awaiting_customer_reply) return false;
    if (checkWindow && !(await this.windowOpen(conversationId))) return false;
    if (checkWindow && !this.saleStore.get(sale.sale_id)?.validity?.awaiting_customer_reply) return false;
    // Se libera la espera antes de enviar para que dos mensajes seguidos no lo manden dos veces.
    await this.saleStore.update(sale.sale_id, { validity: { ...section, awaiting_customer_reply: false } }, "validity.customer_replied", {});
    const fresh = this.saleStore.get(sale.sale_id) || sale;
    const content = this.customerMessage({ type: "validity.confirmed", sale: fresh, details: {} });
    let delivered = false;
    if (fresh.validity?.document_base64 && !fresh.validity?.delivered_to_customer) delivered = await this.deliverAttachment(fresh, "validity", content);
    else if (content) { await this.chatwoot.sendMessage(conversationId, content); delivered = true; }
    await this.record(conversationId, "validity_delivered_after_reply", { sale_id: sale.sale_id, delivered });
    return delivered;
  }

  // Al terminar el proceso: invitación a recomendar. Dentro de las 24 h como texto normal;
  // fuera, con la plantilla "recomendacion2". Una sola vez por conversación.
  async sendReferral(conversationId, sale) {
    if (!this.templates?.enabled?.("referral")) return;
    const memory = this.memories.get?.(conversationId) || {};
    if (memory.referral_sent_at) return;
    let result;
    if (await this.windowOpen(conversationId)) {
      try { await this.chatwoot.sendMessage(conversationId, TEMPLATE_TEXTS.referral); result = { sent: true, as: "text" }; }
      catch (error) { result = { sent: false, reason: "send_error", error: String(error?.message || error).slice(0, 200) }; }
    } else result = { ...(await this.templates.send(conversationId, "referral")), as: "template" };
    if (result.sent) await this.memories.merge(conversationId, { referral_sent_at: new Date().toISOString() });
    await this.record(conversationId, result.sent ? "referral_sent" : "referral_failed", { sale_id: sale.sale_id, ...result });
  }

  async handle(event) {
    const sale = event?.sale;
    const conversationId = Number(sale?.conversation_id || 0);
    if (!conversationId) return;
    const onboarding = onboardingStateFromSale(sale);
    await this.memories.merge(conversationId, { sale_id: sale.sale_id, operations: operationsMemoryFromSale(sale) });
    await this.record(conversationId, "operations_state_changed", { sale_id: sale.sale_id, event: event.type, status: sale.status, queue: sale.queue, ...onboarding });

    const content = this.customerMessage(event);
    if (content && event.type === "validity.confirmed" && !sale.validity?.delivered_to_customer && !sale.validity?.delivery_started_at && await this.holdValidityForReply(conversationId, sale)) {
      // Queda en espera: el documento sale cuando el cliente conteste a la plantilla.
    } else if (content) {
      let delivered = false;
      if (event.type === "validity.confirmed" && sale.validity?.document_base64 && !sale.validity?.delivery_started_at && !sale.validity?.delivered_to_customer) {
        delivered = await this.deliverAttachment(sale, "validity", content);
      } else if (event.type === "payment.requested" && sale.payment?.accounts_image_base64 && !sale.payment?.accounts_image_delivery_started_at && !sale.payment?.accounts_image_delivered) {
        delivered = await this.deliverAttachment(sale, "payment", content);
      } else {
        await this.chatwoot.sendMessage(conversationId, content);
        delivered = true;
      }
      if (delivered) await this.record(conversationId, "operations_customer_notification", { sale_id: sale.sale_id, event: event.type });
    }
    if (event.type === "payment.validated") {
      await this.sendReferral(conversationId, sale);
      await this.completeHumanHandoff(conversationId, sale);
    }
  }
}
