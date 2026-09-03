const REQUIRED = Object.freeze([
  { key: "curp", label: "CURP", kind: "data" },
  { key: "nss", label: "NSS", kind: "data" },
  { key: "ine", label: "INE", kind: "document" },
  { key: "csf", label: "Constancia de Situación Fiscal", kind: "document" },
]);

function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function classifyAttachment(attachment = {}) {
  const text = norm([attachment.file_name, attachment.filename, attachment.name, attachment.extension, attachment.file_type].filter(Boolean).join(" "));
  if (/\b(ine|credencial|identificacion|identificación)\b/.test(text)) return "ine";
  if (/\b(constancia|situacion fiscal|situación fiscal|csf|rfc)\b/.test(text)) return "csf";
  if (/\bcurp\b/.test(text)) return "curp";
  if (/\b(nss|seguro social)\b/.test(text)) return "nss";
  return "other";
}

export function attachmentReference(attachment = {}, message = {}) {
  return {
    id: String(attachment.id || `${message.id || "msg"}-${attachment.file_name || attachment.filename || attachment.name || Date.now()}`),
    type: classifyAttachment(attachment),
    name: attachment.file_name || attachment.filename || attachment.name || "archivo",
    content_type: attachment.content_type || attachment.file_type || null,
    url: attachment.data_url || attachment.file_url || attachment.download_url || null,
    message_id: message.id ? String(message.id) : null,
    received_at: message.created_at ? new Date(Number(message.created_at) * 1000).toISOString() : new Date().toISOString(),
    source: "chatwoot",
  };
}

export function documentPackageStatus(sale = {}) {
  const files = Array.isArray(sale.documents?.files) ? sale.documents.files : [];
  const data = sale.customer || {};
  const states = {
    curp: Boolean(data.curp || files.some(file => file.type === "curp")),
    nss: Boolean(data.nss || files.some(file => file.type === "nss")),
    ine: files.some(file => file.type === "ine"),
    csf: files.some(file => file.type === "csf"),
  };
  const requirements = REQUIRED.map(item => ({ ...item, received: Boolean(states[item.key]) }));
  const missing = requirements.filter(item => !item.received).map(item => item.key);
  return {
    complete: missing.length === 0,
    received_count: requirements.length - missing.length,
    required_count: requirements.length,
    missing,
    requirements,
  };
}

export function mergeAttachmentFiles(current = [], incoming = []) {
  const map = new Map();
  for (const file of [...current, ...incoming]) {
    const key = String(file.id || `${file.message_id || ""}:${file.name || ""}:${file.url || ""}`);
    map.set(key, { ...(map.get(key) || {}), ...file });
  }
  return [...map.values()];
}

export function extractConversationAttachments(conversation = {}) {
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages
    : Array.isArray(conversation?.messages?.payload)
      ? conversation.messages.payload
      : [];
  const refs = [];
  for (const message of messages) {
    for (const attachment of (message?.attachments || [])) refs.push(attachmentReference(attachment, message));
  }
  return refs;
}

export { REQUIRED as DOCUMENT_REQUIREMENTS };
