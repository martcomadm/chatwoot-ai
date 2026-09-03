import { onboardingStateFromSale } from "./onboarding-service.js";

const CUSTOMER_MESSAGES=Object.freeze({
  "capture.completed":"Gracias. Tu alta ya fue procesada y ahora pasará a revisión. Te avisaré en cuanto el área de validación confirme que todo está correcto.",
  "validation.approved":"Tu proceso de validación fue aprobado correctamente. Ahora estamos esperando la confirmación de vigencia ante el IMSS; en cuanto quede confirmada te aviso por aquí.",
  "validity.confirmed":"Tu afiliación ya aparece vigente. El siguiente paso corresponde al pago del servicio. Enseguida te indicaré cómo continuar con el pago.",
  "payment.received":"Recibimos el registro de tu pago. Estamos validándolo y te confirmaré por aquí cuando quede aplicado correctamente.",
  "payment.validated":"Tu pago fue validado correctamente y el proceso quedó completado. Gracias por confiar en MARTCOM.",
});

export class ChatwootWorkflowBridge{
  constructor({saleStore,chatwoot,memories,inspectorEvents}){this.saleStore=saleStore;this.chatwoot=chatwoot;this.memories=memories;this.inspectorEvents=inspectorEvents;this.listener=event=>this.handle(event).catch(error=>console.error("NEXT workflow bridge:",error))}
  start(){this.saleStore.on("sale",this.listener)}stop(){this.saleStore.off("sale",this.listener)}
  async record(conversationId,type,details={}){try{await this.inspectorEvents?.record(conversationId,type,details)}catch{}}
  customerMessage(event){if(event.type==="validation.correction.requested"&&event.details?.target==="customer")return `El área de validación necesita una corrección para continuar con tu proceso: ${event.details.reason}. Puedes enviarme por aquí la información o documento solicitado.`;return CUSTOMER_MESSAGES[event.type]||null}
  async handle(event){const sale=event?.sale,conversationId=Number(sale?.conversation_id||0);if(!conversationId)return;const onboarding=onboardingStateFromSale(sale);await this.memories.merge(conversationId,{sale_id:sale.sale_id,operations:{sale_id:sale.sale_id,status:sale.status,queue:sale.queue,validation_approved:Boolean(sale.validation?.approved),validation_rejected:Boolean(sale.validation?.rejected),validation_correction:sale.validation?.correction||null,validity_confirmed:Boolean(sale.validity?.confirmed),validity_confirmed_at:sale.validity?.confirmed_at||null,validity_confirmed_by:sale.validity?.confirmed_by||null,validity_issue:sale.validity?.issue||null,validity_document_name:sale.validity?.document_name||null,payment_requested:Boolean(sale.payment?.requested),payment_received:Boolean(sale.payment?.received),payment_validated:Boolean(sale.payment?.validated),...onboarding,updated_at:sale.updated_at}});await this.record(conversationId,"operations_state_changed",{sale_id:sale.sale_id,event:event.type,status:sale.status,queue:sale.queue,...onboarding});const content=this.customerMessage(event);if(!content)return;await this.chatwoot.sendMessage(conversationId,content);await this.record(conversationId,"operations_customer_notification",{sale_id:sale.sale_id,event:event.type})}
}
