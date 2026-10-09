// Áreas de Operations y lo que cada una puede ver y hacer.
//
// Un usuario puede pertenecer a varias áreas. Cada área operativa trabaja una
// sola cola del flujo del expediente; Supervisión y Admin ven todas.

export const AREAS = Object.freeze([
  { key: "captura", label: "Captura", queue: "capture" },
  { key: "validacion", label: "Validación", queue: "validation" },
  { key: "vigencia", label: "Vigencia", queue: "validity" },
  { key: "cobranza", label: "Cobranza", queue: "payment" },
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
});

// Acción de la API → área que la ejecuta. Admin puede ejecutar cualquiera.
export const ACTION_AREAS = Object.freeze({
  "documents/sync": "captura",
  "capture/nss": "captura",
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
  "supervision/cancel": "supervision",
  "supervision/assign": "supervision",
});

export function normalizeAreas(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(",");
  return [...new Set(list.map(value => String(value || "").trim().toLowerCase()).filter(value => AREA_KEYS.includes(value)))];
}

export function hasArea(user, area) {
  const areas = user?.areas || [];
  return areas.includes("admin") || areas.includes(area);
}

// Supervisión y Admin ven todas las colas, incluidos completados y cancelados.
export function seesAllQueues(user) {
  return hasArea(user, "supervision");
}

export function visibleQueues(user) {
  if (seesAllQueues(user)) return Object.keys(QUEUE_LABELS);
  return WORK_AREAS.filter(area => (user?.areas || []).includes(area.key)).map(area => area.queue);
}

export function canSeeSale(user, sale) {
  return Boolean(sale) && visibleQueues(user).includes(sale.queue);
}

export function canRunAction(user, action) {
  const area = ACTION_AREAS[action];
  return Boolean(area) && hasArea(user, area);
}

export function areaForQueue(queue) {
  return WORK_AREAS.find(area => area.queue === queue)?.key || null;
}
