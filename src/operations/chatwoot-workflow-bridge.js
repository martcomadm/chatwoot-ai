import { onboardingStateFromSale } from "./onboarding-service.js";

const CUSTOMER_MESSAGES=Object.freeze({
  "capture.completed":"Agradecemos su confianza. El trámite de afiliación ya se encuentra en proceso.\n\nEl Área de Validación se comunicará con usted para confirmar sus datos y asegurarse de que toda la información haya sido registrada correctamente.\nAdemás, por WhatsApp recibirá los Términos y Condiciones del servicio.\nLe pedimos, por favor, confirmar de enterado cuando los reciba.\n\nEl contacto se realizará desde los siguientes números:\n📞 561 485 8202\n📞 554 883 3726\n\nGracias nuevamente. Estamos para servirle.",
  "validation.approved":"Tu proceso de validación fue aprobado correctamente. Ahora estamos esperando la confirmación de vigencia ante el IMSS; en cuanto quede confirmada te aviso por aquí.",
  "validity.confirmed":"Tu afiliación ya aparece vigente. Te comparto tu documento de vigencia. El siguiente paso corresponde al primer pago del servicio; enseguida te indicaré cómo continuar.",
  "payment.received":"Recibimos el registro de tu pago. Estamos validándolo y te confirmaré por aquí cuando quede aplicado correctamente.",
  "payment.validated":"Tu pago fue validado correctamente y el proceso quedó completado. Gracias por confiar en MARTCOM. A partir de este momento, nuestro equipo de Atención a Clientes continuará brindándote seguimiento por este medio.",
});


function paymentRequestMessage(sale) {
  const amount = sale?.payment?.amount != null
    ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(sale.payment.amount)
    : "el importe indicado";
  return `Te comparto las cuentas disponibles para realizar tu pago por ${amount}. Este pago debe quedar cubierto el día de hoy para continuar con tu proceso. Cuando lo realices, envíame por aquí tu comprobante de pago, por favor.`;
}

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
  constructor({saleStore,chatwoot,labels,memories,inspectorEvents,customerServiceTeamId=0}){this.saleStore=saleStore;this.chatwoot=chatwoot;this.labels=labels;this.memories=memories;this.inspectorEvents=inspectorEvents;this.customerServiceTeamId=Number(customerServiceTeamId||0);this.listener=event=>this.handle(event).catch(error=>console.error("NEXT workflow bridge:",error))}
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
  customerMessage(event){if(event.type==="validation.correction.requested"&&event.details?.target==="customer")return `El área de validación necesita una corrección para continuar con tu proceso: ${event.details.reason}. Puedes enviarme por aquí la información o documento solicitado.`;return CUSTOMER_MESSAGES[event.type]||null}
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
        if (!section[spec.base64] || section[spec.delivered] || !spec.statuses.includes(sale.status)) continue;
        const started = Date.parse(section[spec.started] || "");
        if (Number.isFinite(started) && Date.now() - started < staleMs) continue;
        const content = kind === "validity" ? CUSTOMER_MESSAGES["validity.confirmed"] : paymentRequestMessage(sale);
        results.push({ sale_id: sale.sale_id, kind, delivered: await this.deliverAttachment(sale, kind, content) });
      }
    }
    return results;
  }

  async handle(event) {
    const sale = event?.sale;
    const conversationId = Number(sale?.conversation_id || 0);
    if (!conversationId) return;
    const onboarding = onboardingStateFromSale(sale);
    await this.memories.merge(conversationId, {
      sale_id: sale.sale_id,
      operations: {
        sale_id: sale.sale_id, status: sale.status, queue: sale.queue,
        validation_approved: Boolean(sale.validation?.approved), validation_rejected: Boolean(sale.validation?.rejected), validation_correction: sale.validation?.correction || null,
        validity_confirmed: Boolean(sale.validity?.confirmed), validity_confirmed_at: sale.validity?.confirmed_at || null, validity_confirmed_by: sale.validity?.confirmed_by || null, validity_issue: sale.validity?.issue || null, validity_document_name: sale.validity?.document_name || null,
        payment_requested: Boolean(sale.payment?.requested), payment_requested_at: sale.payment?.requested_at || null, payment_due_date: sale.payment?.due_date || null, payment_accounts_image_name: sale.payment?.accounts_image_name || null,
        payment_received: Boolean(sale.payment?.received), payment_received_at: sale.payment?.received_at || null, payment_reference: sale.payment?.reference || null, payment_proof_name: sale.payment?.proof_name || null, payment_issue: sale.payment?.issue || null,
        payment_validated: Boolean(sale.payment?.validated), payment_validated_at: sale.payment?.validated_at || null, payment_validated_by: sale.payment?.validated_by || null,
        completed_at: sale.completed_at || null,
        ...onboarding,
        updated_at: sale.updated_at,
      },
    });
    await this.record(conversationId, "operations_state_changed", { sale_id: sale.sale_id, event: event.type, status: sale.status, queue: sale.queue, ...onboarding });

    const content = event.type === "payment.requested" ? paymentRequestMessage(sale) : this.customerMessage(event);
    if (content) {
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
    if (event.type === "payment.validated") await this.completeHumanHandoff(conversationId, sale);
  }
}
