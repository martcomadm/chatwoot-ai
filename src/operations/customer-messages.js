// Mensajes que Mia envía al cliente cuando el expediente avanza en Operations.
// Admin puede reemplazarlos; si un mensaje se deja vacío se usa el de aquí.

export const CUSTOMER_MESSAGE_DEFINITIONS = Object.freeze([
  {
    key: "capture.completed",
    label: "Alta capturada",
    help: "Se envía cuando Captura termina el alta.",
    text: "Agradecemos su confianza. El trámite de afiliación ya se encuentra en proceso.\n\nEl Área de Validación se comunicará con usted para confirmar sus datos y asegurarse de que toda la información haya sido registrada correctamente.\nAdemás, por WhatsApp recibirá los Términos y Condiciones del servicio.\nLe pedimos, por favor, confirmar de enterado cuando los reciba.\n\nEl contacto se realizará desde los siguientes números:\n📞 561 485 8202\n📞 554 883 3726\n\nGracias nuevamente. Estamos para servirle.",
  },
  {
    key: "validation.correction.requested",
    label: "Corrección solicitada al cliente",
    help: "Se envía cuando Validación pide al cliente corregir algo. {motivo} se reemplaza por lo que escribió Validación.",
    text: "El área de validación necesita una corrección para continuar con tu proceso: {motivo}. Puedes enviarme por aquí la información o documento solicitado.",
  },
  {
    key: "validation.approved",
    label: "Validación aprobada",
    help: "Se envía cuando Validación aprueba el expediente.",
    text: "Tu proceso de validación fue aprobado correctamente. Ahora estamos esperando la confirmación de vigencia ante el IMSS; en cuanto quede confirmada te aviso por aquí.",
  },
  {
    key: "validity.confirmed",
    label: "Vigencia confirmada",
    help: "Acompaña al documento de vigencia.",
    text: "Tu afiliación ya aparece vigente. Te comparto tu documento de vigencia. El siguiente paso corresponde al primer pago del servicio; enseguida te indicaré cómo continuar.",
  },
  {
    key: "payment.requested",
    label: "Solicitud de pago",
    help: "Acompaña a la imagen de cuentas. {monto} se reemplaza por el importe del plan.",
    text: "Te comparto las cuentas disponibles para realizar tu pago por {monto}. Este pago debe quedar cubierto el día de hoy para continuar con tu proceso. Cuando lo realices, envíame por aquí tu comprobante de pago, por favor.",
  },
  {
    key: "payment.received",
    label: "Comprobante recibido",
    help: "Se envía cuando se registra el comprobante.",
    text: "Recibimos el registro de tu pago. Estamos validándolo y te confirmaré por aquí cuando quede aplicado correctamente.",
  },
  {
    key: "payment.validated",
    label: "Pago validado",
    help: "Cierra el proceso y pasa la conversación a Atención a Clientes.",
    text: "Tu pago fue validado correctamente y el proceso quedó completado. Gracias por confiar en MARTCOM. A partir de este momento, nuestro equipo de Atención a Clientes continuará brindándote seguimiento por este medio.",
  },
]);

export const DEFAULT_CUSTOMER_MESSAGES = Object.freeze(Object.fromEntries(CUSTOMER_MESSAGE_DEFINITIONS.map(item => [item.key, item.text])));

export function formatAmount(amount) {
  return amount != null
    ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(amount)
    : "el importe indicado";
}

// Devuelve el texto para un evento, o null si ese evento no notifica al cliente.
export function renderCustomerMessage(eventType, { sale, details } = {}, overrides = {}) {
  if (eventType === "validation.correction.requested" && details?.target !== "customer") return null;
  const template = String(overrides?.[eventType] || "").trim() || DEFAULT_CUSTOMER_MESSAGES[eventType];
  if (!template) return null;
  return template
    .replaceAll("{monto}", formatAmount(sale?.payment?.amount))
    .replaceAll("{motivo}", String(details?.reason || "").trim() || "revisar la información enviada");
}
