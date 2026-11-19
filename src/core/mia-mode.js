// "Mia libre" (17-nov, pedido de Dirección): una Mia con menos restricciones atiende una parte de las conversaciones
// NUEVAS para probar si vende mejor. El reparto es estable por conversación:
//  - "full" (versión A): Mia como está, con todas sus reglas y respuestas fijas.
//  - "light" (versión B, Mia libre): la IA contesta con el conocimiento de MARTCOM y solo quedan las protecciones esenciales
//    (notas de voz/archivos, "no me escriban", pases a una persona, aceptación y expediente, revisión de calidad de la
//    IA —precios y datos inventados— y el aviso de crédito INFONAVIT con el Plan 2).
// MIA_LIBRE_SHARE = % de conversaciones nuevas para Mia libre (0 la apaga; por defecto 20). Sus expedientes los
// trabajan solo quienes tienen el permiso "Mia libre" (Captura y las demás áreas no los ven).
// Las conversaciones que ya existían siguen igual (sin modo asignado = completo).
import crypto from "node:crypto";

export const MIA_MODE_EXPERIMENT = "mia_mode_v1";
export const MIA_MODE_LABELS = { full: "Mia normal", light: "Mia libre" };

export function lightShare(env = process.env) {
  const n = Number(env?.MIA_LIBRE_SHARE ?? 20);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 20;
}

export function modeBucket(conversationId) {
  const h = crypto.createHash("sha1").update(`${MIA_MODE_EXPERIMENT}:${conversationId}`).digest();
  return h.readUInt16BE(0) % 100;
}

export function assignMiaMode(memory = {}, conversationId, { share = lightShare(), now = new Date() } = {}) {
  if (memory?.mia_mode) return memory;
  const fresh = !memory?.ultima_respuesta_agente && !memory?.presentacion_realizada && !memory?.sales_cycle?.authorized && !memory?.operations?.sale_id;
  if (!fresh || !(share > 0)) return memory;
  const mode = modeBucket(conversationId) < share ? "light" : "full";
  return {
    ...memory,
    mia_mode: mode,
    experiments: { ...(memory.experiments || {}), [MIA_MODE_EXPERIMENT]: { slot: "mia_mode", variant: mode === "light" ? "B" : "A", at: now.toISOString() } },
  };
}

export const isLightMode = memory => memory?.mia_mode === "light";
