// Conversaciones que ya atiende una persona del equipo, aunque no estén asignadas a ella.
//
// Casos reales 23 al 26-oct: Isela Galicia, Yair Ruiz y otros asesores abren el chat desde el número de
// MARTCOM ("Muchas gracias por recibir mi llamada, por este medio seguiremos nuestra comunicación.
// Regáleme un mensaje de confirmación"). El cliente contestaba "Sí" y Mia le preguntaba qué necesitaba,
// le recomendaba un plan o le pedía su nombre, a clientes que ya pagan su servicio con esa asesora.

import { messagesOf } from "../utils/conversation.js";

function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

function isOutgoing(m) {
  return m?.message_type === 1 || m?.message_type === "outgoing";
}

function isActivity(m) {
  return m?.message_type === 2 || m?.message_type === "activity";
}

// true si el primer mensaje público de la conversación lo mandó una persona del equipo (no Mia) y Mia
// todavía no ha escrito nada: el chat lo abrió un asesor y es suyo.
export function agentStartedConversation(conversation, miaAgentId, selfSenders = null) {
  const msgs = messagesOf(conversation)
    .filter(m => m && m.private !== true && !isActivity(m))
    .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
  if (!msgs.length) return false;
  const isHuman = m => isOutgoing(m)
    && !selfSenders?.isOwn?.(m)
    && String(m?.sender_type || m?.sender?.type || "").toLowerCase() === "user"
    && Number(m?.sender_id || m?.sender?.id || 0) !== Number(miaAgentId);
  if (!isHuman(msgs[0])) return false;
  return !msgs.some(m => isOutgoing(m) && !isHuman(m));
}

// "Ya tengo asesora, es Isela Galicia", "Mi asesor es…", "Solo una cosa más, me atiende la Srta. Isela".
// Devuelve el nombre si lo dice, true si no, o null.
export function mentionsOwnAdvisor(text = "") {
  const v = norm(text).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!v) return null;
  const title = "(?:(?:la|el|srita|srta|senorita|sr|senor|lic|licenciada|licenciado)\\s+)*";
  const patterns = [
    new RegExp(`\\bya tengo (?:mi |una |un )?(?:asesor|asesora|hacedor|ejecutiva|ejecutivo)\\b(?:\\s+(?:es|se llama|y es|que es))?\\s*${title}([a-z]+(?: [a-z]+)?)?`),
    new RegExp(`\\b(?:mi|su) (?:asesor|asesora|hacedor|ejecutiva|ejecutivo) (?:es|se llama)\\s+${title}([a-z]+(?: [a-z]+)?)`),
    new RegExp(`\\bme (?:atiende|esta atendiendo|lleva el tramite)\\s+${title}([a-z]+(?: [a-z]+)?)`),
    new RegExp(`\\bprefiero (?:seguir|continuar) con\\s+${title}([a-z]+(?: [a-z]+)?)`),
    new RegExp(`\\bque (?:siga|continue) (?:gestionando |atendiendome |con mi tramite )?${title}([a-z]+(?: [a-z]+)?)`),
  ];
  for (const re of patterns) {
    const m = v.match(re);
    if (!m) continue;
    const name = String(m[1] || "").replace(/\b(?:gracias|saludos|y|pero|con|mi|tramite)\b.*$/, "").trim();
    if (!name || /^(?:que|para|de|el|la|en|es|un|una|el tramite)$/.test(name)) return true;
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }
  return null;
}

// Ya es cliente de MARTCOM: "Ya estoy inscrita", "Ya tengo ese plan", "Ya estoy pagando el plan 2",
// "Ya pago el servicio con ustedes" (casos reales 21 al 25-oct).
export function existingClient(text = "") {
  const v = norm(text);
  return /\bya (?:estoy|soy) (?:inscrit[oa]|client[ea]|afiliad[oa] con ustedes|dad[oa] de alta con ustedes)\b|\bya tengo (?:ese|el|mi|este) (?:plan|paquete|servicio con ustedes)\b|\bya (?:estoy|estaba) pagando (?:el |mi |este |ese )?(?:plan|paquete|servicio)\b|\bya (?:pago|le pago|les pago) (?:el servicio|mi servicio|el plan|con ustedes)\b|\bya tengo (?:\d+|varios|unos) meses (?:pagando|con ustedes)\b/.test(v);
}

export function ownAdvisorReply(name) {
  return typeof name === "string"
    ? `Perfecto, gracias por avisarme. Le aviso a ${name} para que continúe contigo por este medio.`
    : "Perfecto, gracias por avisarme. Le aviso a tu asesor para que continúe contigo por este medio.";
}

export const EXISTING_CLIENT_TEXT = "Gracias por avisarme. Como ya eres cliente, le paso tu conversación a nuestro equipo de Atención a Clientes para que te ayude con lo que necesitas. Ya les dejo el contexto para que no tengas que repetirlo.";
