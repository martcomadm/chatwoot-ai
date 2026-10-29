// Detecta un comprobante de pago entre los adjuntos de un mensaje del cliente.
// Antes cualquier adjunto que no fuera audio/video contaba (ubicaciones,
// contactos, stickers de otros tipos, adjuntos sin URL...). Ahora solo una
// imagen o un PDF con URL descargable se registra como comprobante; Cobranza
// sigue validándolo manualmente antes de cerrar el expediente.

const IMAGE_EXT = /\.(?:jpe?g|png|webp|heic|heif)(?:\?|#|$)/i;
const PDF_EXT = /\.pdf(?:\?|#|$)/i;

function urlOf(attachment) {
  return attachment?.data_url || attachment?.download_url || attachment?.file_url || attachment?.url || null;
}

function nameOf(attachment) {
  return attachment?.file_name || attachment?.filename || attachment?.name || null;
}

export function proofKindOf(attachment = {}) {
  const fileType = String(attachment?.file_type || "").toLowerCase();
  const contentType = String(attachment?.content_type || attachment?.extension || "").toLowerCase();
  const url = String(urlOf(attachment) || "");
  const name = String(nameOf(attachment) || "");
  if (!url) return null;
  if (fileType === "image" || contentType.startsWith("image/") || IMAGE_EXT.test(name) || IMAGE_EXT.test(url)) {
    if (/audio|video|sticker/.test(fileType + " " + contentType)) return null;
    return "image";
  }
  if (contentType === "application/pdf" || contentType === "pdf" || PDF_EXT.test(name) || PDF_EXT.test(url)) return "pdf";
  return null;
}

export function paymentProofAttachment(messages = []) {
  for (const message of messages || []) {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    for (const attachment of attachments) {
      const kind = proofKindOf(attachment);
      if (!kind) continue;
      return {
        proof_url: urlOf(attachment),
        proof_name: nameOf(attachment) || (kind === "pdf" ? "comprobante.pdf" : "comprobante"),
        attachment_id: attachment?.id || null,
        message_id: message?.id ?? null,
        file_type: String(attachment?.file_type || attachment?.content_type || kind).toLowerCase(),
      };
    }
  }
  return null;
}
