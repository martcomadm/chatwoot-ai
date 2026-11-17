// Prueba A/B "modo ligero" (17-nov, pedido de Dirección). Las conversaciones NUEVAS se reparten de forma estable:
//  - "full" (versión A): Mia como está, con todas sus reglas y respuestas fijas.
//  - "light" (versión B): la IA contesta con el conocimiento de MARTCOM y solo quedan las protecciones esenciales
//    (notas de voz/archivos, "no me escriban", pases a una persona, aceptación y expediente, revisión de calidad de la
//    IA —precios y datos inventados— y el aviso de crédito INFONAVIT con el Plan 2).
// MIA_LIGHT_SHARE = % de conversaciones nuevas en modo ligero (0 apaga la prueba; por defecto 50).
// Las conversaciones que ya existían siguen igual (sin modo asignado = completo).
import crypto from "node:crypto";

export const MIA_MODE_EXPERIMENT = "mia_mode_v1";
export const MIA_MODE_LABELS = { full: "Mia completa (A)", light: "Modo ligero (B)" };

export function lightShare(env = process.env) {
  const n = Number(env?.MIA_LIGHT_SHARE ?? 50);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
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
