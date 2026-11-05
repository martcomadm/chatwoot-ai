// Catálogo de plantillas aprobadas de WhatsApp (Twilio Content) que tiene MARTCOM.
// Las mandó el equipo el 5-nov (capturas de Twilio). Todas: español (MX), tipo texto, sin
// variables, aprobadas el 23-sep-2026. Se envían por nombre a través de Chatwoot
// (ver whatsapp-templates.js). Si se crea o cambia una plantilla en Twilio, actualizar aquí.
//
// Categoría: Marketing = reactivar / vender (WhatsApp exige Marketing para eso);
// Utility = avisos de un trámite en curso (documentos, pagos, vigencia).

export const TEMPLATE_CATALOG = Object.freeze([
  // ── Reactivar prospectos (Marketing) ──
  // También es el seguimiento fuera de la ventana de 24 h (5-nov: reemplaza a saludodia3, que no existe).
  { name: "seguimiento3", sid: "HXeb436fed1c53dc4469afdbf566fc5c7c", category: "marketing", use: "reactivation",
    text: "Buen día. Te escribo para saber si aún te interesa continuar con tu afiliación al IMSS.\nCon gusto puedo apoyarte a iniciar el proceso hoy mismo." },
  { name: "saludodia2", sid: "HX2b94ae005ff7368105daeb88c6cd5711", category: "marketing", use: "reactivation",
    text: "Buen día. Espero que estés teniendo un excelente día.\nQuedo al pendiente si deseas información o iniciar tu registro al IMSS." },
  { name: "saludodia1", sid: "HX84eab969658607387d20e52f8ea2fb6d", category: "marketing", use: "reactivation",
    text: "¡Hola! Muy buen día.\nEstoy disponible para apoyarte con cualquier duda sobre tu afiliación al IMSS." },
  { name: "procesoafiliacion1", sid: "HX1fba0b8eda96cd77ed9add370c6a1704", category: "marketing", use: "reactivation",
    text: "El proceso es muy sencillo:\n1️⃣ Revisamos tus datos\n2️⃣ Realizamos tu alta\n3️⃣ Recibes tu vigencia del IMSS\nTodo el proceso tarda de 24 a 48 hrs." },
  { name: "planes", sid: "HX76f1d806eba39db701888019d8493998", category: "marketing", use: "reactivation",
    text: "Le mando los planes que manejamos:\n\nPlan 1\n1. Servicio médico completo\n2. Cotización de semanas\n\nPlan 2\n1. Servicio médico completo\n2. Cotización de semanas\n3. Aportaciones a su AFORE\n4. Suma de puntos en Infonavit" },
  // ── Documentos (Utility) ──
  // 5-nov: se usa así (solo dice CURP y NSS); la INE la pide Mia después.
  { name: "recordatorio1", sid: "HX0fb0f8cff106c8f6a02bdf02d5c494b4", category: "utility", use: "documents",
    text: "Para continuar con tu afiliación al IMSS solo necesitamos:\n• CURP\n• Número de Seguro Social\nEn cuanto me los compartas podemos iniciar tu registro." },
  // ── Vigencia y referidos ──
  { name: "vigencia1", sid: "HX66fc9ff34587064ba8d3105d3bf455cf", category: "utility", use: "validity",
    text: "¡Buen día!\nAgradecemos su paciencia y confianza.\nLe informo que usted ya cuenta con vigencia de manera exitosa en sistema.\n\nAyúdeme confirmando, para que le pueda hacer llegar su archivo de Vigencia de Derechos.\nPor favor, muchas gracias." },
  { name: "vigencia2", sid: "HX66dc774f8ed42c6bd65f57cfba170a70", category: "marketing", use: "validity_call",
    text: "¡Buen día!\nMe alegra informarle que ya cuenta con vigencia en el sistema.\nY me interesa realizarle una llamada para darle a detalle la información que viene en su archivo de vigencia.\n¿En qué horario podría recibir mi llamada?" },
  { name: "recomendacion2", sid: "HXfa7ecf449ab8f8d0ce89cd2b49256dd5", category: "marketing", use: "referral",
    text: "Si algún familiar o conocido necesita afiliación al IMSS, puedes compartirle mi contacto.\nCon gusto lo apoyamos." },
  // ── Cobranza (Utility) ──
  // 5-nov: no usarla en automático (dice "Evita recargos"; el recargo no aplica siempre).
  { name: "cobrodia1", sid: "HX6b0c5063c9d2b266af01e35e76abd870", category: "utility", use: "payment_reminder", auto: false,
    text: "Hola, 👋\nTe recordamos que tu pago pronto va vencer.\n\nEvita recargos y mantén tu servicio activo 💼\n\nResponde PAGAR para enviarte opciones de pago" },
  { name: "seguimientocobro1", sid: "HXf3b969d9baa7db3ec87f951c25174367", category: "utility", use: "payment_followup",
    text: "¡Buen día!\nMe gustaría poder apoyarle ya que no he recibido respuesta suya, y es importante registrar su pago para evitar que su servicio se vea afectado.\n¿Hay algo en lo que pueda ayudarle?" },
  { name: "confirmacionpago", sid: "HX8b32d6fd36db06bb7637160ba9153b40", category: "utility", use: "payment_confirmed",
    text: "¡Buen día!\n\nEspero se encuentre muy bien el día de hoy.\n\nEl pago de su servicio ya fue confirmado con éxito en el sistema.\nAgradecemos mucho su confianza y compromiso, seguimos a sus órdenes." },
]);

export function templateByName(name) {
  return TEMPLATE_CATALOG.find(t => t.name === name) || null;
}

export function templatesFor(use) {
  return TEMPLATE_CATALOG.filter(t => t.use === use);
}
