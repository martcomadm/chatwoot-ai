// Expediente cancelado (Supervisión o Cobranza, 26-oct): el cliente deja de estar "en trámite". Si vuelve
// a escribir, Mia lo atiende como a cualquier prospecto (sin pedirle documentos del expediente cancelado) y,
// si vuelve a aceptar, se abre un expediente nuevo.

// Etiquetas que ponía el trámite y que callan a Mia: con el expediente cancelado ya no aplican.
export const SALE_STOP_LABELS = new Set(["venta", "validacion", "completado"]);

export function memoryAfterCancellation(memory = {}) {
  const cycle = memory.sales_cycle || {};
  return {
    ...memory,
    sale_id: null,
    operations: {},
    onboarding_complete_notified: false,
    call_ack_at: null,
    sales_cycle: {
      ...cycle,
      stage: "exploring",
      authorized: false,
      authorization_text: null,
      selected_plan: null,
      interested: false,
      deferral: null,
      cancelled_sale_id: memory.sale_id || cycle.cancelled_sale_id || null,
    },
  };
}
