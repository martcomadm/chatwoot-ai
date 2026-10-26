// Áreas de Operations y lo que cada una puede ver y hacer.
//
// Un usuario puede pertenecer a varias áreas. Cada área operativa trabaja una
// sola cola del flujo del expediente; Supervisión y Admin ven todas.
// Observador ve todas las colas (para seguir cómo va cada venta) pero no tiene
// ninguna acción: no aparece en ACTION_AREAS ni trabaja una cola.

export const AREAS = Object.freeze([
  { key: "captura", label: "Captura", queue: "capture" },
  { key: "validacion", label: "Validación", queue: "validation" },
  { key: "vigencia", label: "Vigencia", queue: "validity" },
  { key: "cobranza", label: "Cobranza", queue: "payment" },
  { key: "atencion", label: "Atención a Clientes", queue: null },
  { key: "observador", label: "Observador", queue: null },
  { key: "supervision", label: "Supervisión", queue: null },
  { key: "admin", label: "Admin", queue: null },
]);

export const AREA_KEYS = Object.freeze(AREAS.map(area => area.key));
export const WORK_AREAS = Object.freeze(AREAS.filter(area => area.queue));
export const QUEUE_LABELS = Object.freeze({
  capture: "Captura",
  validation: "Validación",
  validity: "Vigencia",
  payment: "Cobranza",
  completed: "Completados",
  cancelled: "Cancelados",
  dropped: "Bajas por falta de pago",
});

// Acción de la API → área que la ejecuta. Admin puede ejecutar cualquiera.
export const ACTION_AREAS = Object.freeze({
  "documents/sync": "captura",
  "capture/nss": "captura",
  "capture/curp": "captura",
  "capture/call": "captura",
  "capture/name": "captura",
  "supervision/name": "supervision",
  "capture/start": "captura",
  "capture/complete": "captura",
  "validation/check": "validacion",
  "validation/correction": "validacion",
  "validation/reject": "validacion",
  "validation/reopen": "validacion",
  "validity/confirm": "vigencia",
  "validity/issue": "vigencia",
  "validity/reopen": "vigencia",
  "payment/request": "cobranza",
  "payment/receive": "cobranza",
  "payment/issue": "cobranza",
  "payment/reopen": "cobranza",
  "payment/validate": "cobranza",
  "supervision/return": "supervision",
  // Cancelar: Supervisión y Cobranza (26-oct).
  "supervision/cancel": ["supervision", "cobranza"],
  "supervision/assign": "supervision",
  "supervision/plan": "supervision",
  // Baja por falta de pago y reactivación: Supervisión y Cobranza (26-oct).
  "supervision/drop": ["supervision", "cobranza"],
  "supervision/reactivate": ["supervision", "cobranza"],
});

export function normalizeAreas(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(",");
  return [...new Set(list.map(value => String(value || "").trim().toLowerCase()).filter(value => AREA_KEYS.includes(value)))];
}

export function hasArea(user, area) {
  const areas = user?.areas || [];
  return areas.includes("admin") || areas.includes(area);
}

// Supervisión, Admin y Observador ven todas las colas, incluidos completados y cancelados.
export function seesAllQueues(user) {
  return hasArea(user, "supervision") || (user?.areas || []).includes("observador");
}

export function visibleQueues(user) {
  if (seesAllQueues(user)) return Object.keys(QUEUE_LABELS);
  const queues = WORK_AREAS.filter(area => (user?.areas || []).includes(area.key)).map(area => area.queue);
  // Cobranza también ve los completados (para dar de baja a quien deja de pagar) y las bajas por falta de pago.
  if ((user?.areas || []).includes("cobranza")) queues.push("completed", "dropped", "cancelled");
  return [...new Set(queues)];
}

export function canSeeSale(user, sale) {
  return Boolean(sale) && visibleQueues(user).includes(sale.queue);
}

// "Solicitar llamada": el área que tiene el expediente en su cola, o Supervisión/Admin (no Observador).
export function canRequestCall(user, sale) {
  if (!sale || ["completed", "cancelled", "dropped"].includes(sale.queue)) return false;
  if (hasArea(user, "supervision")) return true;
  const area = areaForQueue(sale.queue);
  return Boolean(area) && hasArea(user, area);
}

export function canRunAction(user, action) {
  const area = ACTION_AREAS[action];
  return Array.isArray(area) ? area.some(item => hasArea(user, item)) : Boolean(area) && hasArea(user, area);
}

export function areaForQueue(queue) {
  return WORK_AREAS.find(area => area.queue === queue)?.key || null;
}
