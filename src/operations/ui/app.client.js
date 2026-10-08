"use strict";

// ═══════════════════════════════════════════════════════════════════════
// MARTCOM Operations — interfaz por áreas
// Captura · Validación · Vigencia · Cobranza trabajan su propia cola.
// Supervisión ve el flujo completo; Admin gestiona usuarios y configuración.
// ═══════════════════════════════════════════════════════════════════════

const QUEUE_AREA = { capture: "captura", validation: "validacion", validity: "vigencia", payment: "cobranza" };
const AREA_QUEUE = { captura: "capture", validacion: "validation", vigencia: "validity", cobranza: "payment" };
const WORK_AREAS = ["captura", "validacion", "vigencia", "cobranza"];
const AREA_LABELS = { captura: "Captura", validacion: "Validación", vigencia: "Vigencia", cobranza: "Cobranza", supervision: "Supervisión", admin: "Admin" };
const STAGES = [["capture", "Captura"], ["validation", "Validación"], ["validity", "Vigencia"], ["payment", "Cobranza"], ["completed", "Completado"]];

const AREA_INTRO = {
  captura: "Expedientes autorizados por el cliente, listos para dar de alta.",
  validacion: "Altas capturadas que esperan revisión de datos y documentos.",
  vigencia: "Expedientes validados que esperan confirmación de vigencia del IMSS.",
  cobranza: "Expedientes vigentes: solicitar pago, registrar comprobantes y validarlos.",
  supervision: "Todo el flujo, atrasos y desempeño del equipo.",
  admin: "Usuarios, bitácora, configuración y herramientas de laboratorio.",
};

const STATUS_LABELS = {
  authorized: "Autorizado", waiting_capture: "Por capturar", capture_in_progress: "En captura", alta_processed: "Alta procesada",
  waiting_validation: "Por validar", validation_in_progress: "En validación", validation_approved: "Validación aprobada", validation_rejected: "Rechazado en validación",
  waiting_validity: "Esperando vigencia", validity_confirmed: "Vigencia confirmada", payment_requested: "Pago solicitado", payment_received: "Comprobante recibido",
  payment_validated: "Pago validado", completed: "Completado", alta_issue: "Incidencia de alta", validity_issue: "Incidencia de vigencia",
  payment_issue: "Incidencia de pago", cancelled: "Cancelado",
};

const EVENT_LABELS = {
  "sale.created": "Expediente abierto",
  "documents.synced": "Documentos sincronizados",
  "capture.nss.registered": "NSS registrado",
  "capture.started": "Captura iniciada",
  "capture.completed": "Alta capturada",
  "validation.check.updated": "Revisión de validación actualizada",
  "validation.approved": "Validación aprobada",
  "validation.correction.requested": "Corrección solicitada",
  "validation.rejected": "Validación rechazada",
  "validation.reopened": "Validación reabierta",
  "validity.confirmed": "Vigencia confirmada",
  "validity.issue": "Incidencia de vigencia",
  "validity.reopened": "Vigencia reabierta",
  "validity.document.delivery_started": "Enviando vigencia al cliente",
  "validity.document.delivered": "Vigencia entregada al cliente",
  "validity.document.delivery_failed": "No se pudo entregar la vigencia",
  "payment.requested": "Pago solicitado",
  "payment.accounts_image.delivery_started": "Enviando cuentas al cliente",
  "payment.accounts_image.delivered": "Cuentas entregadas al cliente",
  "payment.accounts_image.delivery_failed": "No se pudieron entregar las cuentas",
  "payment.received": "Comprobante registrado",
  "payment.issue": "Incidencia de pago",
  "payment.reopened": "Pago reabierto",
  "payment.validated": "Pago validado",
  "supervision.returned": "Regresado por Supervisión",
  "supervision.cancelled": "Cancelado por Supervisión",
  "assignment.changed": "Responsable cambiado",
  "lab.reset": "Conversación LAB reiniciada",
  "auth.login": "Inicio de sesión",
  "auth.login_failed": "Intento fallido de inicio de sesión",
  "user.bootstrap": "Primer administrador creado",
  "user.created": "Usuario creado",
  "user.updated": "Usuario actualizado",
  "user.password_reset": "Contraseña restablecida",
  "user.password_changed": "Contraseña cambiada",
  "settings.updated": "Configuración actualizada",
  "settings.accounts_image_updated": "Imagen de cuentas actualizada",
  "settings.accounts_image_removed": "Imagen de cuentas eliminada",
  "lab.conversation_reset": "Conversación de prueba reiniciada",
  "mia.paused": "Mia pausada",
  "mia.resumed": "Mia reanudada",
};

const state = {
  me: null,
  view: null,
  sales: [],
  saleId: null,
  sale: null,
  saleLinks: {},
  filter: { assignee: "all", docs: "all", search: "", queue: "active" },
  overview: null,
  range: defaultRange(),
  adminTab: "users",
  admin: { users: [], audit: [], settings: null, auditFilter: { from: "", to: "", actor: "", sale_id: "" } },
  events: null,
};

const app = document.getElementById("app");
const dialogEl = document.getElementById("dialog");
const toastEl = document.getElementById("toast");

// ── Utilidades ─────────────────────────────────────────────────────────
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function areaVar(area) { return `var(--area-${area || "admin"})`; }
function money(value) {
  return value == null ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}
function dateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function duration(hours) {
  const minutes = Math.max(0, Math.round(Number(hours || 0) * 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 48) { const m = minutes % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(h / 24);
  const rest = h % 24;
  return rest ? `${d} d ${rest} h` : `${d} d`;
}
function plural(count, one, many) { return `${count} ${count === 1 ? one : many}`; }
function planLabel(plan) { return plan === "plan_2" ? "Plan 2" : plan === "plan_1" ? "Plan 1" : "Sin plan"; }
function statusLabel(status) { return STATUS_LABELS[status] || String(status || "").replaceAll("_", " "); }
function todayISO(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return date.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}
function defaultRange() { return { from: todayISO(-6), to: todayISO(0) }; }
function hasArea(area) { const areas = state.me?.user?.areas || []; return areas.includes("admin") || areas.includes(area); }
function actorName(actor) {
  if (!actor) return "Sistema";
  return actor.name || actor.username;
}
function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

function toast(message, kind = "") {
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  toastEl.appendChild(item);
  setTimeout(() => item.remove(), kind === "bad" ? 6000 : 3200);
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-ops-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (response.status === 401 && path !== "/operations/api/auth/login" && path !== "/operations/api/me/password") {
    state.me = null;
    stopEvents();
    renderLogin("Tu sesión terminó. Vuelve a iniciar sesión.");
    throw new Error("Sesión terminada");
  }
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
  return payload;
}

async function run(task, success) {
  try {
    const result = await task();
    if (success) toast(success);
    return result;
  } catch (error) {
    if (error.message !== "Sesión terminada") toast(error.message || String(error), "bad");
    return null;
  }
}

function readFileBase64(accept, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      if (file.size > maxBytes) return reject(new Error("El archivo no puede exceder 10 MB"));
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, base64: String(reader.result || "").split(",")[1] || "" });
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

// Diálogo genérico: fields = [{name,label,type,required,options,value,placeholder,help}]
function ask({ title, text = "", fields = [], confirm = "Confirmar", danger = false, area = null }) {
  return new Promise(resolve => {
    const fieldHtml = fields.map(field => {
      const id = `f-${field.name}`;
      const required = field.required ? "required" : "";
      let control;
      if (field.type === "textarea") control = `<textarea class="textarea" id="${id}" name="${field.name}" ${required} placeholder="${esc(field.placeholder || "")}">${esc(field.value || "")}</textarea>`;
      else if (field.type === "select") control = `<select class="select" id="${id}" name="${field.name}" ${required}>${field.options.map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(field.value ?? "") ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
      else if (field.type === "checkboxes") control = `<div class="chips">${field.options.map(([value, label]) => `<label class="check"><input type="checkbox" name="${field.name}" value="${esc(value)}" ${(field.value || []).includes(value) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div>`;
      else control = `<input class="input ${field.mono ? "mono" : ""}" id="${id}" name="${field.name}" type="${field.type || "text"}" ${required} value="${esc(field.value || "")}" placeholder="${esc(field.placeholder || "")}" ${field.pattern ? `pattern="${field.pattern}"` : ""} ${field.minlength ? `minlength="${field.minlength}"` : ""} autocomplete="${field.autocomplete || "off"}">`;
      return `<label class="field" ${field.type === "checkboxes" ? "" : `for="${id}"`}><span>${esc(field.label)}</span>${control}${field.help ? `<small class="muted">${esc(field.help)}</small>` : ""}</label>`;
    }).join("");
    dialogEl.innerHTML = `<form method="dialog" style="${area ? `--area:${areaVar(area)}` : ""}">
      <h2>${esc(title)}</h2>
      ${text ? `<p>${text}</p>` : ""}
      ${fieldHtml}
      <div class="dialog-actions">
        <button class="btn quiet" value="cancel" formnovalidate>Cancelar</button>
        <button class="btn ${danger ? "danger" : "primary"}" value="ok">${esc(confirm)}</button>
      </div>
    </form>`;
    const form = dialogEl.querySelector("form");
    const close = value => { dialogEl.close(); resolve(value); };
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") return close(null);
      if (!form.reportValidity()) return;
      const data = {};
      for (const field of fields) {
        if (field.type === "checkboxes") data[field.name] = [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map(input => input.value);
        else data[field.name] = form.elements[field.name].value.trim();
      }
      close(data);
    });
    dialogEl.addEventListener("cancel", () => resolve(null), { once: true });
    dialogEl.showModal();
    form.querySelector("input, textarea, select")?.focus();
  });
}

// ── Acceso ─────────────────────────────────────────────────────────────
function gateMark() {
  return `<div class="gate-mark" aria-hidden="true">${["captura", "validacion", "vigencia", "cobranza"].map(area => `<i style="background:${areaVar(area)}"></i>`).join("")}</div>`;
}

function renderLogin(message = "") {
  closePanel(false);
  app.innerHTML = `<main class="gate">
    <div class="gate-card">
      ${gateMark()}
      <h1>MARTCOM Operations</h1>
      <p>Inicia sesión con tu usuario para ver tu área de trabajo.</p>
      <form id="login-form">
        ${message ? `<div class="form-error">${esc(message)}</div>` : ""}
        <label class="field"><span>Usuario</span><input class="input" name="username" autocomplete="username" required autofocus></label>
        <label class="field"><span>Contraseña</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary">Iniciar sesión</button>
      </form>
    </div>
  </main>`;
  document.getElementById("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api("/operations/api/auth/login", { method: "POST", body: { username: form.username.value, password: form.password.value } });
      await start();
    } catch (error) {
      renderLogin(error.message);
    }
  });
}

function renderSetup(available) {
  app.innerHTML = `<main class="gate">
    <div class="gate-card">
      ${gateMark()}
      <h1>Crea el primer administrador</h1>
      <p>Operations todavía no tiene usuarios. ${available ? "Usa el token de Operations del servidor para crear tu cuenta de administrador." : "Configura OPERATIONS_TOKEN en el servidor y recarga esta página."}</p>
      ${available ? `<form id="setup-form">
        <label class="field"><span>Token de Operations</span><input class="input" name="token" type="password" required autocomplete="off"></label>
        <label class="field"><span>Tu nombre</span><input class="input" name="name" required autocomplete="name"></label>
        <label class="field"><span>Usuario</span><input class="input" name="username" required autocomplete="username" placeholder="ej. axel.martinez"></label>
        <label class="field"><span>Contraseña</span><input class="input" name="password" type="password" minlength="10" required autocomplete="new-password"><small class="muted">Mínimo 10 caracteres.</small></label>
        <button class="btn primary">Crear administrador</button>
      </form>` : ""}
    </div>
  </main>`;
  document.getElementById("setup-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    try {
      await api("/operations/api/auth/bootstrap", { method: "POST", body: { token: form.token.value, name: form.name.value, username: form.username.value, password: form.password.value } });
      await start();
    } catch (error) {
      const err = document.createElement("div");
      err.className = "form-error";
      err.textContent = error.message;
      form.prepend(err);
    }
  });
}

async function logout() {
  stopEvents();
  try { await api("/operations/api/auth/logout", { method: "POST" }); } catch {}
  state.me = null;
  renderLogin();
}

async function changePassword() {
  const data = await ask({
    title: "Cambiar mi contraseña",
    fields: [
      { name: "current", label: "Contraseña actual", type: "password", required: true, autocomplete: "current-password" },
      { name: "next", label: "Nueva contraseña", type: "password", required: true, minlength: 10, autocomplete: "new-password", help: "Mínimo 10 caracteres." },
    ],
    confirm: "Cambiar contraseña",
  });
  if (!data) return;
  await run(() => api("/operations/api/me/password", { method: "POST", body: data }), "Contraseña cambiada");
}

// ── Arranque y navegación ──────────────────────────────────────────────
async function boot() {
  try {
    const status = await api("/operations/api/auth/status");
    if (status.needs_setup) return renderSetup(status.setup_available);
    if (!status.user) return renderLogin();
    await start();
  } catch (error) {
    app.innerHTML = `<main class="gate"><div class="gate-card"><h1>No se pudo abrir Operations</h1><p>${esc(error.message)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div></main>`;
  }
}

async function start() {
  state.me = await api("/operations/api/me");
  const params = new URLSearchParams(location.search);
  const pathSale = location.pathname.match(/^\/operations\/sales\/([^/]+)/);
  const available = state.me.areas.map(area => area.key);
  const requested = params.get("area");
  state.view = available.includes(requested) ? requested : (available.find(area => WORK_AREAS.includes(area)) || available[0]);
  state.saleId = pathSale ? decodeURIComponent(pathSale[1]) : params.get("sale");
  await loadSales();
  renderShell();
  await renderView();
  if (state.saleId) await openSale(state.saleId, { push: false });
  startEvents();
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.view) params.set("area", state.view);
  if (state.saleId) params.set("sale", state.saleId);
  history.replaceState(null, "", `/operations?${params.toString()}`);
}

async function go(view) {
  if (view === state.view) return;
  state.view = view;
  state.filter = { assignee: "all", docs: "all", search: "", queue: "active" };
  closePanel(false);
  syncUrl();
  renderShell();
  await renderView();
}

async function loadSales() {
  const result = await api("/operations/api/sales");
  state.sales = result.items || [];
}

function salesForArea(area) {
  const queue = AREA_QUEUE[area];
  return state.sales.filter(sale => sale.queue === queue);
}

function renderShell() {
  const me = state.me;
  const nav = me.areas.map(area => {
    let count = "";
    if (WORK_AREAS.includes(area.key)) {
      const items = salesForArea(area.key);
      const late = items.filter(sale => sale.urgency === "overdue" || sale.urgency === "issue").length;
      count = late ? `<span class="nav-count alert" title="${late} atrasados o con incidencia">${items.length}</span>` : `<span class="nav-count">${items.length}</span>`;
    }
    const sep = area.key === "supervision" && me.areas.some(item => WORK_AREAS.includes(item.key)) ? `<div class="nav-sep" role="presentation"></div>` : "";
    return `${sep}<button class="nav-item" style="--area:${areaVar(area.key)}" data-go="${area.key}" ${state.view === area.key ? 'aria-current="page"' : ""}><span>${esc(area.label)}</span>${count}</button>`;
  }).join("");
  app.innerHTML = `<div class="shell">
    <nav class="rail" aria-label="Áreas">
      <div class="brand"><strong>MARTCOM</strong><span>Operations NEXT</span></div>
      <div class="nav">${nav}</div>
      <div class="rail-foot">
        ${miaStatusHtml()}
        <div class="who">${esc(me.user.name)}<small>${esc(me.user.username)}</small></div>
        <div class="row">
          ${me.user.via === "token" ? "" : `<button class="btn quiet small" data-act="password">Contraseña</button>`}
          <button class="btn quiet small" data-act="logout">Cerrar sesión</button>
        </div>
      </div>
    </nav>
    <main class="main" id="view"></main>
  </div>`;
}

function miaStatusHtml() {
  const mia = state.me.mia || {};
  const control = state.me.can.admin ? `<button class="btn small ${mia.paused ? "primary" : "danger"}" data-act="mia-toggle">${mia.paused ? "Reanudar a Mia" : "Pausar a Mia"}</button>` : "";
  return `<div class="mia-status ${mia.paused ? "paused" : ""}" id="mia-status">
    <span><span class="mia-dot"></span>${mia.paused ? "Mia en pausa" : "Mia respondiendo"}</span>
    ${mia.paused && mia.reason ? `<small>${esc(mia.reason)}</small>` : ""}
    ${control}
  </div>`;
}

async function toggleMia() {
  const paused = !state.me.mia?.paused;
  const data = await ask(paused
    ? { title: "Pausar a Mia", text: "Mia dejará de responder a todos los clientes hasta que la reanudes. Los mensajes que lleguen mientras tanto debe atenderlos una persona; Mia no los contestará después.", fields: [{ name: "reason", label: "Motivo", type: "textarea", required: true, placeholder: "Ej. respuestas incorrectas sobre precios, revisión del equipo" }], confirm: "Pausar a Mia", danger: true, area: "supervision" }
    : { title: "Reanudar a Mia", text: "Mia volverá a responder los mensajes nuevos de los clientes.", confirm: "Reanudar a Mia", area: "supervision" });
  if (!data) return;
  const done = await run(() => api("/operations/api/mia/pause", { method: "POST", body: { paused, reason: data.reason || "" } }), paused ? "Mia está en pausa" : "Mia volvió a responder");
  if (done) {
    state.me.mia = done.mia;
    const box = document.getElementById("mia-status");
    if (box) box.outerHTML = miaStatusHtml();
  }
}

function updateNavCounts() {
  for (const button of document.querySelectorAll(".nav-item[data-go]")) {
    const area = button.dataset.go;
    if (!WORK_AREAS.includes(area)) continue;
    const items = salesForArea(area);
    const late = items.filter(sale => sale.urgency === "overdue" || sale.urgency === "issue").length;
    const count = button.querySelector(".nav-count");
    if (!count) continue;
    count.textContent = items.length;
    count.classList.toggle("alert", late > 0);
    count.title = late ? `${late} atrasados o con incidencia` : "";
  }
}

async function renderView() {
  const view = document.getElementById("view");
  if (!view) return;
  if (WORK_AREAS.includes(state.view)) return renderWorkArea(view);
  if (state.view === "supervision") return renderSupervision(view);
  if (state.view === "admin") return renderAdmin(view);
}

function pageHead(area, title, subtitle, extra = "") {
  return `<header class="page-head" style="--area:${areaVar(area)}"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${extra}</header>`;
}

// ── Cola de un área de trabajo ─────────────────────────────────────────
function filteredSales(items) {
  const f = state.filter;
  const me = state.me.user.username;
  const search = f.search.toLowerCase();
  return items.filter(sale => {
    if (f.assignee === "me" && sale.assignee?.username !== me) return false;
    if (f.assignee === "none" && sale.assignee) return false;
    if (f.docs === "complete" && sale.documents?.complete !== true) return false;
    if (f.docs === "incomplete" && sale.documents?.complete === true) return false;
    if (search && ![sale.sale_id, sale.customer?.nombre, sale.customer?.telefono, sale.customer?.curp, sale.customer?.nss, sale.conversation_id, sale.payment?.reference].some(value => String(value || "").toLowerCase().includes(search))) return false;
    return true;
  }).sort(byUrgency);
}

// Lo más urgente primero: incidencias, atrasados, luego por tiempo en el área.
function byUrgency(a, b) {
  const rank = { issue: 0, overdue: 1, warning: 2, ok: 3 };
  return (rank[a.urgency] ?? 3) - (rank[b.urgency] ?? 3) || (b.hours_in_queue || 0) - (a.hours_in_queue || 0);
}

function segmented(name, value, options) {
  return `<div class="segmented" role="group">${options.map(([key, label]) => `<button data-filter="${name}" data-value="${key}" aria-pressed="${value === key}">${esc(label)}</button>`).join("")}</div>`;
}

function clock(sale) {
  if (["completed", "cancelled"].includes(sale.queue)) return `<span class="muted">${dateTime(sale.completed_at || sale.updated_at)}</span>`;
  const pct = sale.limit_hours ? Math.min(100, Math.round((sale.hours_in_queue / sale.limit_hours) * 100)) : 0;
  const hint = sale.urgency === "issue" ? "Incidencia" : sale.limit_hours ? `de ${duration(sale.limit_hours)}` : "";
  return `<span class="clock" data-urgency="${esc(sale.urgency)}" title="En el área desde ${esc(dateTime(sale.queue_entered_at))}"><span class="clock-ring" style="--pct:${sale.urgency === "issue" ? 100 : pct}"></span><span>${duration(sale.hours_in_queue)}<small>${esc(hint)}</small></span></span>`;
}

function docsCell(sale) {
  const checklist = sale.documents?.checklist;
  if (!checklist) return "—";
  const ok = sale.documents?.complete;
  return `<span class="tag ${ok ? "ok" : "warn"}">${checklist.received_count}/${checklist.required_count} datos</span>`;
}

function saleRows(items, { showArea = false } = {}) {
  if (!items.length) return "";
  const head = `<div class="queue-row queue-head" role="row"><span>Cliente</span><span>Estado</span><span>Plan</span><span>${showArea ? "Área" : "Datos para alta"}</span><span>Responsable</span><span>Tiempo en el área</span></div>`;
  return head + items.map(sale => {
    const area = QUEUE_AREA[sale.queue];
    return `<button class="queue-row" role="row" data-sale="${esc(sale.sale_id)}" style="--area:${areaVar(area || "supervision")}" ${state.saleId === sale.sale_id ? 'aria-current="true"' : ""}>
      <span class="cell-customer"><strong>${esc(sale.customer?.nombre || "Cliente sin nombre")}</strong><small class="mono">${esc(sale.sale_id)}</small></span>
      <span>${esc(statusLabel(sale.status))}</span>
      <span>${esc(planLabel(sale.sale?.plan))}<span class="cell-sub">${money(sale.sale?.precio)}</span></span>
      <span>${showArea ? `<span class="tag area" style="--area:${areaVar(area || "supervision")}">${esc(sale.queue_label)}</span>` : docsCell(sale)}</span>
      <span>${sale.assignee ? esc(sale.assignee.name) : '<span class="muted">Sin asignar</span>'}</span>
      <span>${clock(sale)}</span>
    </button>`;
  }).join("");
}

function emptyQueue(area) {
  const messages = {
    captura: "No hay expedientes por capturar. Llegarán aquí cuando un cliente autorice iniciar su trámite.",
    validacion: "No hay altas por validar. Captura las enviará aquí al completarlas.",
    vigencia: "No hay expedientes esperando vigencia.",
    cobranza: "No hay pagos pendientes.",
  };
  return `<div class="empty"><strong>Cola al día</strong>${esc(messages[area] || "Sin expedientes con estos filtros.")}</div>`;
}

function renderWorkArea(view) {
  const area = state.view;
  const all = salesForArea(area);
  const items = filteredSales(all);
  const late = all.filter(sale => sale.urgency === "overdue").length;
  const issues = all.filter(sale => sale.urgency === "issue").length;
  const mine = all.filter(sale => sale.assignee?.username === state.me.user.username).length;
  const limit = state.me.alert_hours?.[AREA_QUEUE[area]];
  const summary = [`${all.length} en la cola`, mine ? `${plural(mine, "asignado", "asignados")} a ti` : null, late ? plural(late, "atrasado", "atrasados") : null, issues ? `${issues} con incidencia` : null].filter(Boolean).join(", ");
  view.style.setProperty("--area", areaVar(area));
  view.innerHTML = `
    ${pageHead(area, state.me.areas.find(item => item.key === area)?.label || area, `${AREA_INTRO[area]} ${limit ? `Tiempo objetivo: ${duration(limit)}.` : ""}`, `<p class="muted" style="margin:0">${esc(summary)}</p>`)}
    <div class="toolbar">
      ${segmented("assignee", state.filter.assignee, [["all", "Todos"], ["me", "Míos"], ["none", "Sin asignar"]])}
      ${area === "captura" ? segmented("docs", state.filter.docs, [["all", "Todos los datos"], ["complete", "Completos"], ["incomplete", "Incompletos"]]) : ""}
      <input class="input" type="search" placeholder="Buscar nombre, folio, CURP, NSS, teléfono" value="${esc(state.filter.search)}" data-search aria-label="Buscar expedientes">
    </div>
    <div class="queue" role="table" aria-label="Expedientes de ${esc(area)}">${items.length ? saleRows(items) : emptyQueue(area)}</div>`;
}

// ── Panel del expediente ───────────────────────────────────────────────
async function openSale(id, { push = true } = {}) {
  state.saleId = id;
  if (push) syncUrl();
  markCurrentRow();
  try {
    const result = await api(`/operations/api/sales/${encodeURIComponent(id)}`);
    state.sale = result.sale;
    state.saleLinks = result.links || {};
    renderPanel();
  } catch (error) {
    if (error.message !== "Sesión terminada") toast(error.message, "bad");
    closePanel();
  }
}

function closePanel(sync = true) {
  state.saleId = null;
  state.sale = null;
  document.getElementById("panel")?.remove();
  document.getElementById("scrim")?.remove();
  markCurrentRow();
  if (sync && state.me) syncUrl();
}

function markCurrentRow() {
  for (const row of document.querySelectorAll(".queue-row[data-sale]")) {
    if (row.dataset.sale === state.saleId) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  }
}

function stagesHtml(sale) {
  const order = STAGES.map(([queue]) => queue);
  const currentIndex = sale.queue === "cancelled" ? -1 : order.indexOf(sale.queue);
  return `<ol class="stages" aria-label="Etapas del expediente">${STAGES.map(([queue, label], index) => {
    const cls = sale.queue === "completed" || index < currentIndex ? "done" : index === currentIndex ? "current" : "";
    return `<li class="${cls}" ${index === currentIndex ? 'aria-current="step"' : ""}>${esc(label)}</li>`;
  }).join("")}</ol>`;
}

function canAct(sale, area) { return sale.queue === AREA_QUEUE[area] && hasArea(area); }

function areaActions(sale) {
  const buttons = [];
  const add = (action, label, kind = "", disabled = "") => buttons.push(`<button class="btn ${kind}" data-sale-act="${action}" ${disabled ? `disabled title="${esc(disabled)}"` : ""}>${esc(label)}</button>`);
  if (canAct(sale, "captura")) {
    if (sale.status === "waiting_capture") add("capture-start", "Iniciar captura", "primary");
    if (["waiting_capture", "capture_in_progress"].includes(sale.status)) {
      add("capture-complete", "Completar alta", sale.status === "capture_in_progress" ? "primary" : "", sale.documents?.complete ? "" : `Faltan: ${(sale.documents?.missing || []).join(", ").toUpperCase()}`);
      add("capture-nss", "Registrar NSS");
      add("documents-sync", "Actualizar documentos");
    }
  }
  if (canAct(sale, "validacion")) {
    if (["waiting_validation", "validation_in_progress"].includes(sale.status)) {
      add("validation-correction-capture", "Pedir corrección a Captura");
      add("validation-correction-customer", "Pedir corrección al cliente");
      add("validation-reject", "Rechazar", "danger");
    }
    if (sale.status === "validation_rejected") add("validation-reopen", "Reabrir validación", "primary");
  }
  if (canAct(sale, "vigencia")) {
    if (sale.status === "waiting_validity") { add("validity-confirm", "Subir vigencia y confirmar", "primary"); add("validity-issue", "Reportar incidencia", "danger"); }
    if (sale.status === "validity_issue") add("validity-reopen", "Reabrir vigencia", "primary");
  }
  if (canAct(sale, "cobranza")) {
    if (sale.status === "validity_confirmed") add("payment-request", "Solicitar pago", "primary");
    if (sale.status === "payment_requested") { add("payment-receive", "Registrar comprobante", "primary"); add("payment-issue", "Reportar incidencia", "danger"); }
    if (sale.status === "payment_received") { add("payment-validate", "Validar pago y cerrar", "primary"); add("payment-issue", "Reportar incidencia", "danger"); }
    if (sale.status === "payment_issue") add("payment-reopen", "Reabrir pago", "primary");
  }
  return buttons;
}

function validationChecks(sale) {
  const keys = [["datos", "Datos del cliente"], ["alta", "Alta en el IMSS"], ["documentos", "Documentos"], ["revision_final", "Revisión final"]];
  const editable = canAct(sale, "validacion") && ["waiting_validation", "validation_in_progress"].includes(sale.status);
  return `<div class="checklist">${keys.map(([key, label]) => editable
    ? `<label class="check"><input type="checkbox" data-check="${key}" ${sale.validation?.[key] ? "checked" : ""}> ${esc(label)}</label>`
    : `<div class="item"><span class="mark ${sale.validation?.[key] ? "yes" : "no"}">${sale.validation?.[key] ? "✓" : "–"}</span>${esc(label)}</div>`).join("")}</div>
    ${editable ? `<p class="muted" style="margin:8px 0 0;font-size:14px">Al marcar las cuatro, el expediente pasa a Vigencia.</p>` : ""}`;
}

function documentsHtml(sale) {
  const checklist = sale.documents?.checklist;
  const reqs = checklist?.requirements || [];
  const files = sale.documents?.files || [];
  const reqHtml = reqs.map(req => `<div class="item"><span class="mark ${req.received ? "yes" : "no"}">${req.received ? "✓" : "✕"}</span>${esc(req.label)}${req.alternative_received ? ` <span class="muted">(con ${esc(String(req.alternative_received).toUpperCase())})</span>` : ""}</div>`).join("");
  const deferred = (checklist?.deferred || []).map(item => `<div class="item"><span class="mark ${item.received ? "yes" : "no"}">${item.received ? "✓" : "–"}</span>${esc(item.label)} <span class="muted">(se pide a los ${item.request_after_months} meses)</span></div>`).join("");
  const fileHtml = files.length
    ? `<div class="files">${files.map(file => file.url
      ? `<a href="${esc(file.url)}" target="_blank" rel="noopener"><span class="tag">${esc(String(file.type || "otro").toUpperCase())}</span>${esc(file.name || "archivo")}</a>`
      : `<div class="notice"><span class="tag">${esc(String(file.type || "otro").toUpperCase())}</span> ${esc(file.name || "archivo")}</div>`).join("")}</div>`
    : `<p class="muted" style="margin:10px 0 0">El cliente aún no ha enviado archivos.</p>`;
  return `<div class="checklist">${reqHtml}${deferred}</div>${fileHtml}`;
}

function stageInfo(sale) {
  const parts = [];
  if (sale.validation?.correction?.open) parts.push(`<div class="notice warn"><strong>Corrección solicitada ${sale.validation.correction.target === "customer" ? "al cliente" : "a Captura"}:</strong> ${esc(sale.validation.correction.reason)}</div>`);
  if (sale.validation?.rejected) parts.push(`<div class="notice bad"><strong>Rechazado en validación:</strong> ${esc(sale.validation.notes || "")}</div>`);
  if (sale.validity?.issue?.open) parts.push(`<div class="notice bad"><strong>Incidencia de vigencia:</strong> ${esc(sale.validity.issue.reason)}</div>`);
  if (sale.payment?.issue?.open) parts.push(`<div class="notice bad"><strong>Incidencia de pago:</strong> ${esc(sale.payment.issue.reason)}</div>`);
  if (sale.cancellation) parts.push(`<div class="notice bad"><strong>Cancelado:</strong> ${esc(sale.cancellation.reason)} <span class="muted">(${esc(dateTime(sale.cancellation.at))})</span></div>`);
  const facts = [];
  if (sale.validity?.confirmed) facts.push(["Vigencia", `${sale.validity.document_name || "Documento"} (${sale.validity.delivered_to_customer ? "entregada al cliente" : sale.validity.delivery_error ? "no se pudo entregar; se reintentará" : "pendiente de entregar"})`]);
  if (sale.payment?.requested) facts.push(["Pago solicitado", `${money(sale.payment.amount)} el ${dateTime(sale.payment.requested_at)}`]);
  if (sale.payment?.received) facts.push(["Comprobante", sale.payment.proof_url ? `<a href="${esc(sale.payment.proof_url)}" target="_blank" rel="noopener">${esc(sale.payment.proof_name || "Ver comprobante")}</a>` : esc(sale.payment.proof_name || "Registrado")]);
  if (sale.payment?.reference) facts.push(["Referencia", `<span class="mono">${esc(sale.payment.reference)}</span>`]);
  if (sale.payment?.validated) facts.push(["Pago validado", `${sale.payment.validated_by || ""}, ${dateTime(sale.payment.validated_at)}`]);
  const factHtml = facts.length ? `<dl class="facts" style="margin-top:${parts.length ? "12px" : "0"}">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v.startsWith("<") ? v : esc(v)}</dd></div>`).join("")}</dl>` : "";
  return parts.join("") + factHtml;
}

function historyHtml(sale) {
  const events = [...(sale.events || [])].reverse().slice(0, 80);
  if (!events.length) return `<p class="muted">Sin movimientos.</p>`;
  return `<ol class="timeline">${events.map(event => {
    const details = event.details || {};
    const note = details.reason || details.notes || (event.type === "assignment.changed" ? (details.to_name ? `Ahora: ${details.to_name}` : "Sin responsable") : "") || (event.type === "supervision.returned" ? `A ${state.me.queue_labels?.[details.to_queue] || details.to_queue}` : "");
    return `<li class="${event.actor ? "person" : ""}"><div><div class="what">${esc(EVENT_LABELS[event.type] || event.type)}</div>${note ? `<div>${esc(note)}</div>` : ""}<div class="meta">${esc(actorName(event.actor))}, ${esc(dateTime(event.at))}</div></div></li>`;
  }).join("")}</ol>`;
}

function renderPanel() {
  const sale = state.sale;
  if (!sale) return;
  const area = QUEUE_AREA[sale.queue] || "supervision";
  const workArea = AREA_QUEUE[QUEUE_AREA[sale.queue]] ? QUEUE_AREA[sale.queue] : null;
  const me = state.me.user.username;
  const assignButtons = [];
  if (workArea && hasArea(workArea) && sale.assignee?.username !== me && (!sale.assignee || hasArea("supervision"))) assignButtons.push(`<button class="btn small" data-sale-act="take">Tomar expediente</button>`);
  if (workArea && sale.assignee && (sale.assignee.username === me || hasArea("supervision"))) assignButtons.push(`<button class="btn quiet small" data-sale-act="release">Soltar</button>`);
  const actions = areaActions(sale);
  const supervision = [];
  if (hasArea("supervision")) {
    if (workArea) supervision.push(`<button class="btn" data-sale-act="sup-assign">Asignar a…</button>`);
    if (sale.status !== "completed") supervision.push(`<button class="btn" data-sale-act="sup-return">${sale.queue === "cancelled" ? "Reactivar en…" : "Regresar a…"}</button>`);
    if (!["completed", "cancelled"].includes(sale.status)) supervision.push(`<button class="btn danger" data-sale-act="sup-cancel">Cancelar expediente</button>`);
  }
  const c = sale.customer || {};
  const facts = [
    ["Teléfono", c.telefono ? `<span class="mono">${esc(c.telefono)}</span>` : "—"],
    ["CURP", c.curp ? `<span class="mono">${esc(c.curp)}</span>` : "—"],
    ["NSS", c.nss ? `<span class="mono">${esc(c.nss)}</span>` : "—"],
    ["Edad", esc(c.edad ?? "—")],
    ["Actividad", esc(c.actividad || "—")],
    ["Plan", `${esc(planLabel(sale.sale?.plan))}, ${money(sale.sale?.precio)}`],
    ["Abierto", esc(dateTime(sale.created_at))],
    ["Conversación", state.saleLinks?.chatwoot ? `<a href="${esc(state.saleLinks.chatwoot)}" target="_blank" rel="noopener">Abrir en Chatwoot</a>` : esc(sale.conversation_id || "—")],
  ];
  const html = `
    <div class="scrim" id="scrim" data-act="close-panel"></div>
    <aside class="panel" id="panel" style="--area:${areaVar(area)}" role="dialog" aria-modal="false" aria-labelledby="panel-title">
      <div class="panel-head">
        <div class="top">
          <div>
            <h2 id="panel-title">${esc(c.nombre || "Cliente sin nombre")}</h2>
            <div class="folio mono">${esc(sale.sale_id)}</div>
          </div>
          <button class="btn quiet" data-act="close-panel" aria-label="Cerrar expediente">Cerrar</button>
        </div>
        ${stagesHtml(sale)}
      </div>
      <div class="panel-body">
        <section>
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
            <div><span class="tag area" style="--area:${areaVar(area)}">${esc(statusLabel(sale.status))}</span></div>
            ${clock(sale)}
          </div>
          ${workArea ? `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap"><div><span class="muted">Responsable:</span> <strong>${sale.assignee ? esc(sale.assignee.name) : "Sin asignar"}</strong></div><div class="actions">${assignButtons.join("")}</div></div>` : ""}
          ${actions.length ? `<div class="actions" style="margin-top:14px">${actions.join("")}</div>` : ""}
        </section>
        ${stageInfo(sale) ? `<section>${stageInfo(sale)}</section>` : ""}
        ${["validation", "validity", "payment", "completed"].includes(sale.queue) ? `<section><h3>Revisión de validación</h3>${validationChecks(sale)}</section>` : ""}
        <section><h3>Datos del cliente</h3><dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl></section>
        <section><h3>Documentos</h3>${documentsHtml(sale)}</section>
        ${supervision.length ? `<section><h3>Supervisión</h3><div class="actions">${supervision.join("")}</div></section>` : ""}
        <section><h3>Historial</h3>${historyHtml(sale)}</section>
      </div>
    </aside>`;
  document.getElementById("panel")?.remove();
  document.getElementById("scrim")?.remove();
  document.body.insertAdjacentHTML("beforeend", html);
}

async function saleAction(action) {
  const sale = state.sale;
  if (!sale) return;
  const id = encodeURIComponent(sale.sale_id);
  const area = QUEUE_AREA[sale.queue];
  const post = (path, body = {}, message) => run(() => api(`/operations/api/sales/${id}/${path}`, { method: "POST", body }), message);
  let done = null;
  switch (action) {
    case "take": done = await post("take", {}, "Expediente asignado a ti"); break;
    case "release": done = await post("release", {}, "Expediente liberado"); break;
    case "capture-start": done = await post("capture/start", {}, "Captura iniciada"); break;
    case "capture-complete": done = await post("capture/complete", {}, "Alta capturada: pasa a Validación"); break;
    case "documents-sync": done = await post("documents/sync", {}, "Documentos actualizados"); break;
    case "capture-nss": {
      const data = await ask({ title: "Registrar NSS", text: "Escribe el NSS localizado para este cliente.", fields: [{ name: "nss", label: "NSS (11 dígitos)", required: true, pattern: "[0-9 -]{11,15}", mono: true, value: sale.customer?.nss || "" }], confirm: "Registrar NSS", area });
      if (data) done = await post("capture/nss", { nss: data.nss, source: "localizado_por_captura" }, "NSS registrado");
      break;
    }
    case "validation-correction-capture":
    case "validation-correction-customer": {
      const customer = action.endsWith("customer");
      const data = await ask({ title: customer ? "Pedir corrección al cliente" : "Pedir corrección a Captura", text: customer ? "Mia enviará este motivo al cliente por WhatsApp y el expediente regresa a Captura." : "El expediente regresa a Captura con este motivo.", fields: [{ name: "reason", label: "¿Qué hay que corregir?", type: "textarea", required: true }], confirm: "Enviar corrección", area });
      if (data) done = await post("validation/correction", { target: customer ? "customer" : "capture", reason: data.reason }, "Corrección solicitada");
      break;
    }
    case "validation-reject": {
      const data = await ask({ title: "Rechazar validación", fields: [{ name: "reason", label: "Motivo del rechazo", type: "textarea", required: true }], confirm: "Rechazar", danger: true, area });
      if (data) done = await post("validation/reject", data, "Validación rechazada");
      break;
    }
    case "validation-reopen": done = await post("validation/reopen", {}, "Validación reabierta"); break;
    case "validity-confirm": {
      let file;
      try { file = await readFileBase64(".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"); } catch (error) { toast(error.message, "bad"); break; }
      if (!file) break;
      const ok = await ask({ title: "Confirmar vigencia", text: `Se enviará <strong>${esc(file.name)}</strong> al cliente junto con el aviso de vigencia.`, confirm: "Confirmar y enviar", area });
      if (ok) done = await post("validity/confirm", { document_name: file.name, document_content_type: file.type || "application/pdf", document_base64: file.base64 }, "Vigencia confirmada: pasa a Cobranza");
      break;
    }
    case "validity-issue": {
      const data = await ask({ title: "Reportar incidencia de vigencia", fields: [{ name: "reason", label: "Describe la incidencia", type: "textarea", required: true }], confirm: "Reportar", danger: true, area });
      if (data) done = await post("validity/issue", data, "Incidencia registrada");
      break;
    }
    case "validity-reopen": done = await post("validity/reopen", {}, "Vigencia reabierta"); break;
    case "payment-request": {
      const configured = state.me.accounts_image_configured;
      const options = configured ? [["default", "Usar la imagen de cuentas configurada"], ["upload", "Subir otra imagen"]] : [["upload", "Subir imagen de cuentas"]];
      const data = await ask({ title: "Solicitar pago", text: `Mia enviará las cuentas al cliente y le indicará que el pago de <strong>${money(sale.sale?.precio)}</strong> debe cubrirse hoy.`, fields: [{ name: "source", label: "Imagen de cuentas", type: "select", options, value: options[0][0] }, { name: "method", label: "Método de pago (opcional)", placeholder: "Transferencia, depósito…" }], confirm: "Continuar", area });
      if (!data) break;
      let body = { method: data.method || undefined };
      if (data.source === "upload") {
        let file;
        try { file = await readFileBase64(".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"); } catch (error) { toast(error.message, "bad"); break; }
        if (!file) break;
        body = { ...body, accounts_image_name: file.name, accounts_image_content_type: file.type || "image/jpeg", accounts_image_base64: file.base64 };
      }
      done = await post("payment/request", body, "Pago solicitado al cliente");
      break;
    }
    case "payment-receive": {
      const data = await ask({ title: "Registrar comprobante", text: "Usa esto si el cliente envió el comprobante por otro medio. Los que llegan por WhatsApp se registran solos.", fields: [{ name: "proof_name", label: "Nombre o descripción del comprobante", required: true, value: "comprobante.pdf" }, { name: "reference", label: "Referencia bancaria (opcional)", mono: true }], confirm: "Registrar", area });
      if (data) done = await post("payment/receive", data, "Comprobante registrado");
      break;
    }
    case "payment-validate": {
      const ok = await ask({ title: "Validar pago y cerrar", text: "Confirma que el pago se reflejó. El expediente se cierra y la conversación pasa a Atención a Clientes.", confirm: "Validar y cerrar", area });
      if (ok) done = await post("payment/validate", {}, "Pago validado: expediente completado");
      break;
    }
    case "payment-issue": {
      const data = await ask({ title: "Reportar incidencia de pago", fields: [{ name: "reason", label: "Describe la incidencia", type: "textarea", required: true }], confirm: "Reportar", danger: true, area });
      if (data) done = await post("payment/issue", data, "Incidencia registrada");
      break;
    }
    case "payment-reopen": done = await post("payment/reopen", {}, "Pago reabierto"); break;
    case "sup-assign": {
      const workArea = QUEUE_AREA[sale.queue];
      const people = await run(() => api(`/operations/api/people?area=${encodeURIComponent(workArea)}`));
      if (!people) break;
      const options = [["", "Sin responsable"], ...people.items.map(person => [person.username, person.name])];
      const data = await ask({ title: "Asignar expediente", text: people.items.length ? "" : "No hay personas activas en esta área. Agrégalas desde Admin.", fields: [{ name: "username", label: "Responsable", type: "select", options, value: sale.assignee?.username || "" }], confirm: "Asignar", area: "supervision" });
      if (data) done = await post("supervision/assign", { username: data.username || null }, "Responsable actualizado");
      break;
    }
    case "sup-return": {
      const targets = Object.entries(state.me.return_targets || {}).filter(([queue]) => queue !== sale.queue || sale.queue === "cancelled");
      const data = await ask({ title: sale.queue === "cancelled" ? "Reactivar expediente" : "Regresar expediente", text: "Todo lo posterior a esa etapa se reinicia y el expediente vuelve a pasar por sus revisiones.", fields: [{ name: "target", label: "Llevar a", type: "select", options: targets, value: targets[0]?.[0] }, { name: "reason", label: "Motivo", type: "textarea", required: true }], confirm: sale.queue === "cancelled" ? "Reactivar" : "Regresar", area: "supervision" });
      if (data) done = await post("supervision/return", data, "Expediente movido");
      break;
    }
    case "sup-cancel": {
      const data = await ask({ title: "Cancelar expediente", text: "El expediente sale de todas las colas. Supervisión puede reactivarlo después.", fields: [{ name: "reason", label: "Motivo de la cancelación", type: "textarea", required: true }], confirm: "Cancelar expediente", danger: true, area: "supervision" });
      if (data) done = await post("supervision/cancel", data, "Expediente cancelado");
      break;
    }
  }
  if (done) await refreshAfterChange(done.sale);
}

async function refreshAfterChange(updated) {
  await loadSales();
  updateNavCounts();
  if (updated && state.saleId === updated.sale_id) {
    const stillVisible = state.me.visible_queues.includes(updated.queue);
    if (stillVisible) await openSale(updated.sale_id, { push: false });
    else closePanel();
  }
  await renderView();
  markCurrentRow();
}

async function toggleCheck(key, checked) {
  const sale = state.sale;
  const done = await run(() => api(`/operations/api/sales/${encodeURIComponent(sale.sale_id)}/validation/check`, { method: "POST", body: { key, checked } }));
  if (done) {
    if (done.sale.queue !== sale.queue) toast("Validación aprobada: pasa a Vigencia");
    await refreshAfterChange(done.sale);
  } else {
    renderPanel();
  }
}

// ── Supervisión ────────────────────────────────────────────────────────
async function renderSupervision(view) {
  view.style.setProperty("--area", areaVar("supervision"));
  view.innerHTML = `${pageHead("supervision", "Supervisión", AREA_INTRO.supervision)}<div class="empty">Cargando tablero…</div>`;
  const overview = await run(() => api(`/operations/api/supervision/overview?from=${state.range.from}&to=${state.range.to}`));
  if (!overview) return;
  state.overview = overview;
  drawSupervision(view);
}

function drawSupervision(view) {
  const o = state.overview;
  const flow = o.flow.map(step => `<button class="flow-step" style="--area:${areaVar(step.area)}" data-flow="${step.queue}">
      <h3>${esc(step.label)}</h3>
      <div class="big">${step.total}</div>
      <ul>
        <li class="${step.overdue ? "bad" : ""}">${plural(step.overdue, "atrasado", "atrasados")}${step.limit_hours ? ` (más de ${duration(step.limit_hours)})` : ""}</li>
        ${step.issues ? `<li class="bad">${step.issues} con incidencia</li>` : ""}
        ${step.warning ? `<li class="warn">${step.warning} por vencer</li>` : ""}
        <li>${step.unassigned} sin responsable</li>
        ${step.total ? `<li>El más antiguo: ${duration(step.oldest_hours)}</li>` : ""}
      </ul>
    </button>`).join("");

  const alerts = o.alerts.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Expediente</th><th>Área</th><th class="num">Tiempo</th><th class="wide-only">Responsable</th></tr></thead><tbody>${o.alerts.slice(0, 15).map(alert => `<tr>
        <td><a href="#" data-sale-link="${esc(alert.sale_id)}">${esc(alert.customer || "Cliente sin nombre")}</a><br><small class="mono muted">${esc(alert.sale_id)}</small></td>
        <td><span class="tag area" style="--area:${areaVar(QUEUE_AREA[alert.queue])}">${esc(alert.queue_label)}</span>${alert.urgency === "issue" ? `<br><small class="muted">${esc(statusLabel(alert.status))}</small>` : ""}</td>
        <td class="num"><strong style="color:var(--danger)">${duration(alert.hours)}</strong>${alert.limit_hours ? `<br><small class="muted">límite ${duration(alert.limit_hours)}</small>` : ""}</td>
        <td class="wide-only">${alert.assignee ? esc(alert.assignee.name) : '<span class="muted">Sin asignar</span>'}</td>
      </tr>`).join("")}</tbody></table></div>${o.alerts.length > 15 ? `<p class="muted">y ${o.alerts.length - 15} más en la lista de abajo.</p>` : ""}`
    : `<div class="empty"><strong>Sin atrasos</strong>Todos los expedientes están dentro de su tiempo objetivo.</div>`;

  const performance = o.performance.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Persona</th><th class="num">Terminados</th><th class="num">Tiempo promedio</th><th class="wide-only">Detalle</th></tr></thead><tbody>${o.performance.map(person => `<tr>
        <td><strong>${esc(person.name)}</strong><br><span class="chips">${person.areas.map(area => `<span class="tag area" style="--area:${areaVar(area)}">${esc(AREA_LABELS[area] || area)}</span>`).join("")}</span></td>
        <td class="num"><strong>${person.total}</strong></td>
        <td class="num">${person.avg_hours == null ? "—" : duration(person.avg_hours)}</td>
        <td class="wide-only"><small>${Object.entries(person.by_event).map(([type, count]) => `${esc(o.performance_events[type]?.label || type)}: ${count}`).join("<br>")}</small></td>
      </tr>`).join("")}</tbody></table></div>`
    : `<div class="empty"><strong>Sin actividad en el periodo</strong>Cambia las fechas para ver otro rango.</div>`;

  const queueOptions = [["active", "Activos"], ["capture", "Captura"], ["validation", "Validación"], ["validity", "Vigencia"], ["payment", "Cobranza"], ["completed", "Completados"], ["cancelled", "Cancelados"]];
  const search = state.filter.search.toLowerCase();
  const list = state.sales.filter(sale => (state.filter.queue === "active" ? !["completed", "cancelled"].includes(sale.queue) : sale.queue === state.filter.queue))
    .filter(sale => !search || [sale.sale_id, sale.customer?.nombre, sale.customer?.telefono, sale.customer?.curp, sale.customer?.nss, sale.conversation_id].some(value => String(value || "").toLowerCase().includes(search)))
    .sort(state.filter.queue === "completed" || state.filter.queue === "cancelled" ? (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) : byUrgency);

  view.innerHTML = `
    ${pageHead("supervision", "Supervisión", AREA_INTRO.supervision, `<form class="range" id="range-form">
      <label class="field"><span>Desde</span><input class="input" type="date" name="from" value="${esc(state.range.from)}"></label>
      <label class="field"><span>Hasta</span><input class="input" type="date" name="to" value="${esc(state.range.to)}"></label>
      <button class="btn">Aplicar</button>
    </form>`)}
    <p class="muted" style="margin:-6px 0 14px">${plural(o.totals.active, "expediente activo", "expedientes activos")}. En el periodo: ${plural(o.totals.completed_in_range, "completado", "completados")} y ${plural(o.totals.cancelled_in_range, "cancelado", "cancelados")}.</p>
    <div class="flow">${flow}</div>
    <div class="grid-2">
      <div class="block"><h2>Atrasos e incidencias</h2><p>Expedientes que pasaron su tiempo objetivo o tienen una incidencia abierta.</p>${alerts}</div>
      <div class="block"><h2>Desempeño por persona</h2><p>Trabajo terminado en el periodo y tiempo promedio desde que el expediente llegó al área.</p>${performance}</div>
    </div>
    <div class="section-gap">
      <div class="toolbar">
        ${segmented("queue", state.filter.queue, queueOptions)}
        <input class="input" type="search" placeholder="Buscar nombre, folio, CURP, NSS" value="${esc(state.filter.search)}" data-search aria-label="Buscar expedientes">
      </div>
      <div class="queue" role="table" aria-label="Todos los expedientes">${list.length ? saleRows(list, { showArea: true }) : `<div class="empty"><strong>Sin expedientes</strong>No hay expedientes con estos filtros.</div>`}</div>
    </div>`;
  document.getElementById("range-form").addEventListener("submit", async event => {
    event.preventDefault();
    state.range = { from: event.target.from.value, to: event.target.to.value };
    await renderSupervision(view);
  });
}

// ── Admin ──────────────────────────────────────────────────────────────
async function renderAdmin(view) {
  view.style.setProperty("--area", areaVar("admin"));
  const tabs = [["users", "Usuarios"], ["audit", "Bitácora"], ["settings", "Configuración"]];
  if (state.me.can.lab) tabs.push(["lab", "Laboratorio"]);
  view.innerHTML = `${pageHead("admin", "Admin", AREA_INTRO.admin)}
    <div class="subnav" role="tablist">${tabs.map(([key, label]) => `<button role="tab" data-admin-tab="${key}" aria-selected="${state.adminTab === key}">${esc(label)}</button>`).join("")}</div>
    <div id="admin-body"><div class="empty">Cargando…</div></div>`;
  const body = document.getElementById("admin-body");
  if (state.adminTab === "users") return renderUsers(body);
  if (state.adminTab === "audit") return renderAudit(body);
  if (state.adminTab === "settings") return renderSettings(body);
  if (state.adminTab === "lab") return renderLab(body);
}

function areaChips(keys) {
  return `<span class="chips">${keys.map(key => `<span class="tag area" style="--area:${areaVar(key)}">${esc(AREA_LABELS[key] || key)}</span>`).join("")}</span>`;
}

async function renderUsers(body) {
  const result = await run(() => api("/operations/api/admin/users"));
  if (!result) return;
  state.admin.users = result.items;
  state.admin.areas = result.areas;
  const rows = result.items.map(user => `<tr>
      <td><strong>${esc(user.name)}</strong><br><small class="mono muted">${esc(user.username)}</small></td>
      <td>${areaChips(user.areas)}</td>
      <td>${user.active ? '<span class="tag ok">Activo</span>' : '<span class="tag bad">Inactivo</span>'}</td>
      <td>${esc(dateTime(user.last_login_at))}</td>
      <td><div class="actions">
        <button class="btn small" data-user-act="edit" data-user="${esc(user.username)}">Editar</button>
        <button class="btn small" data-user-act="password" data-user="${esc(user.username)}">Nueva contraseña</button>
        <button class="btn small ${user.active ? "danger" : ""}" data-user-act="toggle" data-user="${esc(user.username)}">${user.active ? "Desactivar" : "Activar"}</button>
      </div></td>
    </tr>`).join("");
  body.innerHTML = `<div class="block">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <div><h2 style="margin:0;font-size:18px">Personas con acceso</h2><p class="muted" style="margin:2px 0 0;font-size:14px">Cada persona solo ve las áreas que tenga asignadas. Admin incluye todas.</p></div>
        <button class="btn primary" style="--area:${areaVar("admin")}" data-user-act="create">Agregar persona</button>
      </div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Persona</th><th>Áreas</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map(byte => chars[byte % chars.length]).join("");
}

async function userAction(action, username) {
  const areaOptions = (state.admin.areas || []).map(area => [area.key, area.label]);
  const user = state.admin.users.find(item => item.username === username);
  let done = null;
  if (action === "create") {
    const password = randomPassword();
    const data = await ask({ title: "Agregar persona", fields: [
      { name: "name", label: "Nombre completo", required: true },
      { name: "username", label: "Usuario", required: true, placeholder: "ej. ana.lopez", help: "Minúsculas, números, punto o guion. Lo usará para iniciar sesión." },
      { name: "areas", label: "Áreas", type: "checkboxes", options: areaOptions },
      { name: "password", label: "Contraseña temporal", required: true, minlength: 10, value: password, mono: true, help: "Compártela por un medio privado; la persona puede cambiarla después." },
    ], confirm: "Agregar", area: "admin" });
    if (data) done = await run(() => api("/operations/api/admin/users", { method: "POST", body: data }), `${data.name} agregado`);
  }
  if (action === "edit" && user) {
    const data = await ask({ title: `Editar a ${user.name}`, fields: [
      { name: "name", label: "Nombre completo", required: true, value: user.name },
      { name: "areas", label: "Áreas", type: "checkboxes", options: areaOptions, value: user.areas },
    ], confirm: "Guardar cambios", area: "admin" });
    if (data) done = await run(() => api(`/operations/api/admin/users/${encodeURIComponent(username)}`, { method: "PATCH", body: data }), "Cambios guardados");
  }
  if (action === "password" && user) {
    const data = await ask({ title: `Nueva contraseña para ${user.name}`, text: "Se cerrarán sus sesiones abiertas.", fields: [{ name: "password", label: "Contraseña temporal", required: true, minlength: 10, value: randomPassword(), mono: true }], confirm: "Guardar contraseña", area: "admin" });
    if (data) done = await run(() => api(`/operations/api/admin/users/${encodeURIComponent(username)}/password`, { method: "POST", body: data }), "Contraseña actualizada");
  }
  if (action === "toggle" && user) {
    const activate = !user.active;
    const ok = await ask({ title: `${activate ? "Activar" : "Desactivar"} a ${user.name}`, text: activate ? "Podrá volver a iniciar sesión." : "No podrá iniciar sesión y sus sesiones abiertas se cerrarán. Sus movimientos se conservan en la bitácora.", confirm: activate ? "Activar" : "Desactivar", danger: !activate, area: "admin" });
    if (ok) done = await run(() => api(`/operations/api/admin/users/${encodeURIComponent(username)}`, { method: "PATCH", body: { active: activate } }), activate ? "Usuario activado" : "Usuario desactivado");
  }
  if (done) await renderUsers(document.getElementById("admin-body"));
}

async function renderAudit(body) {
  const f = state.admin.auditFilter;
  const query = new URLSearchParams(Object.entries(f).filter(([, value]) => value));
  const result = await run(() => api(`/operations/api/admin/audit?${query.toString()}`));
  if (!result) return;
  if (!state.admin.users.length) { const users = await run(() => api("/operations/api/admin/users")); if (users) { state.admin.users = users.items; state.admin.areas = users.areas; } }
  const people = [["", "Todas las personas"], ["sistema", "Sistema y Mia"], ...state.admin.users.map(user => [user.username, user.name])];
  const rows = result.items.map(row => {
    const d = row.details || {};
    const detail = d.reason || d.notes || (d.username && row.kind === "admin" ? `Usuario: ${d.username}` : "") || (d.conversation_id ? `Conversación ${d.conversation_id}` : "") || (row.type === "assignment.changed" ? (d.to_name || "Sin responsable") : "") || (d.key ? `${d.key}: ${d.checked ? "sí" : "no"}` : "");
    return `<tr>
      <td><span class="mono">${esc(dateTime(row.at))}</span></td>
      <td>${esc(actorName(row.actor))}</td>
      <td>${esc(EVENT_LABELS[row.type] || row.type)}</td>
      <td>${row.sale_id ? `<a href="#" data-sale-link="${esc(row.sale_id)}" class="mono">${esc(row.sale_id)}</a>${row.customer ? `<br><small class="muted">${esc(row.customer)}</small>` : ""}` : '<span class="muted">—</span>'}</td>
      <td>${esc(detail)}</td>
    </tr>`;
  }).join("");
  body.innerHTML = `<form class="toolbar" id="audit-form">
      <label class="field" style="width:150px"><span>Desde</span><input class="input" type="date" name="from" value="${esc(f.from)}"></label>
      <label class="field" style="width:150px"><span>Hasta</span><input class="input" type="date" name="to" value="${esc(f.to)}"></label>
      <label class="field" style="min-width:200px"><span>Persona</span><select class="select" name="actor">${people.map(([value, label]) => `<option value="${esc(value)}" ${f.actor === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <label class="field" style="width:200px"><span>Folio</span><input class="input mono" name="sale_id" value="${esc(f.sale_id)}" placeholder="MART-…"></label>
      <button class="btn" style="align-self:end">Filtrar</button>
    </form>
    <div class="block">${result.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Persona</th><th>Movimiento</th><th>Expediente</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table></div>${result.items.length >= 500 ? `<p class="muted">Se muestran los 500 más recientes. Usa los filtros para acotar.</p>` : ""}` : `<div class="empty"><strong>Sin movimientos</strong>No hay registros con estos filtros.</div>`}</div>`;
  document.getElementById("audit-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    state.admin.auditFilter = { from: form.from.value, to: form.to.value, actor: form.actor.value, sale_id: form.sale_id.value.trim() };
    await renderAudit(body);
  });
}

async function renderSettings(body) {
  const settings = await run(() => api("/operations/api/admin/settings"));
  if (!settings) return;
  state.admin.settings = settings;
  const hourFields = [["capture", "Captura", "captura"], ["validation", "Validación", "validacion"], ["validity", "Vigencia", "vigencia"], ["payment", "Cobranza", "cobranza"]];
  const messages = [
    ["capture.completed", "Alta capturada", "Se envía cuando Captura termina el alta."],
    ["validation.correction.requested", "Corrección solicitada al cliente", "{motivo} se reemplaza por lo que escribió Validación."],
    ["validation.approved", "Validación aprobada", "Se envía cuando Validación aprueba el expediente."],
    ["validity.confirmed", "Vigencia confirmada", "Acompaña al documento de vigencia."],
    ["payment.requested", "Solicitud de pago", "Acompaña a la imagen de cuentas. {monto} se reemplaza por el importe del plan."],
    ["payment.received", "Comprobante recibido", "Se envía cuando se registra el comprobante."],
    ["payment.validated", "Pago validado", "Cierra el proceso y pasa la conversación a Atención a Clientes."],
  ];
  const image = settings.accounts_image;
  body.innerHTML = `<form class="settings-grid" id="settings-form">
      <div class="block">
        <h2>Tiempos objetivo por área</h2>
        <p>Horas que un expediente puede estar en cada área antes de marcarse como atrasado.</p>
        <div class="hours">${hourFields.map(([queue, label, area]) => `<label class="field"><span><span class="dot" style="--area:${areaVar(area)};display:inline-block;margin-right:6px"></span>${esc(label)}</span><input class="input" type="number" min="1" max="720" step="0.5" name="hours-${queue}" value="${esc(settings.alert_hours[queue])}" required></label>`).join("")}</div>
      </div>
      <div class="block">
        <h2>Imagen de cuentas para pagos</h2>
        <p>Cobranza la usará por defecto al solicitar un pago. También puede subir otra en cada expediente.</p>
        ${image ? `<img class="image-preview" src="/operations/api/admin/settings/accounts-image?v=${encodeURIComponent(image.updated_at)}" alt="Imagen de cuentas actual"><p class="muted" style="margin:0 0 10px">${esc(image.name)}, actualizada ${esc(dateTime(image.updated_at))} por ${esc(actorName(image.updated_by))}.</p>` : `<p class="notice warn" style="margin:0 0 10px">No hay imagen configurada: Cobranza tendrá que subirla en cada solicitud.</p>`}
        <div class="actions"><button type="button" class="btn" data-settings-act="upload-image">${image ? "Reemplazar imagen" : "Subir imagen"}</button>${image ? `<button type="button" class="btn danger" data-settings-act="remove-image">Quitar imagen</button>` : ""}</div>
      </div>
      <div class="block">
        <h2>Mensajes al cliente</h2>
        <p>Lo que Mia envía por WhatsApp cuando el expediente avanza. Déjalo como está o edítalo; "Restaurar" vuelve al texto original.</p>
        ${messages.map(([key, label, help]) => `<div class="message-edit">
          <header><strong>${esc(label)}</strong><button type="button" class="btn quiet small" data-restore="${esc(key)}">Restaurar</button></header>
          <small>${esc(help)}</small>
          <textarea class="textarea" name="msg-${esc(key)}" rows="${Math.min(12, Math.max(3, Math.ceil(String(settings.customer_messages[key] || settings.default_customer_messages[key] || "").length / 110) + String(settings.customer_messages[key] || settings.default_customer_messages[key] || "").split("\n").length))}">${esc(settings.customer_messages[key] || settings.default_customer_messages[key] || "")}</textarea>
        </div>`).join("")}
      </div>
      <div class="save-bar">${settings.updated_at ? `<span class="muted" style="align-self:center;margin-right:auto">Última modificación: ${esc(dateTime(settings.updated_at))} por ${esc(actorName(settings.updated_by))}</span>` : ""}<button class="btn primary" style="--area:${areaVar("admin")}">Guardar configuración</button></div>
    </form>`;
  const form = document.getElementById("settings-form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const alert_hours = Object.fromEntries(hourFields.map(([queue]) => [queue, Number(form[`hours-${queue}`].value)]));
    const customer_messages = Object.fromEntries(messages.map(([key]) => [key, form[`msg-${key}`].value]));
    const done = await run(() => api("/operations/api/admin/settings", { method: "PUT", body: { alert_hours, customer_messages } }), "Configuración guardada");
    if (done) { state.me.alert_hours = done.settings.alert_hours; await loadSales(); await renderSettings(body); }
  });
  for (const button of form.querySelectorAll("[data-restore]")) {
    button.addEventListener("click", () => { form[`msg-${button.dataset.restore}`].value = settings.default_customer_messages[button.dataset.restore] || ""; });
  }
}

async function settingsAction(action) {
  const body = document.getElementById("admin-body");
  if (action === "upload-image") {
    let file;
    try { file = await readFileBase64(".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"); } catch (error) { return toast(error.message, "bad"); }
    if (!file) return;
    const done = await run(() => api("/operations/api/admin/settings/accounts-image", { method: "PUT", body: { name: file.name, content_type: file.type, base64: file.base64 } }), "Imagen de cuentas guardada");
    if (done) { state.me.accounts_image_configured = true; await renderSettings(body); }
  }
  if (action === "remove-image") {
    const ok = await ask({ title: "Quitar imagen de cuentas", text: "Cobranza tendrá que subir la imagen en cada solicitud de pago.", confirm: "Quitar imagen", danger: true, area: "admin" });
    if (!ok) return;
    const done = await run(() => api("/operations/api/admin/settings/accounts-image", { method: "DELETE" }), "Imagen quitada");
    if (done) { state.me.accounts_image_configured = false; await renderSettings(body); }
  }
}

function renderLab(body) {
  body.innerHTML = `<div class="block" style="max-width:560px">
      <h2>Reiniciar conversación de prueba</h2>
      <p>Borra solo la memoria NEXT y los expedientes asociados a esa conversación para volver a probar desde cero. No toca Chatwoot ni otras conversaciones.</p>
      <form id="lab-form" class="toolbar" style="margin:0">
        <label class="field" style="flex:1"><span>ID de conversación en Chatwoot</span><input class="input mono" name="conversation" inputmode="numeric" pattern="[0-9]+" required></label>
        <button class="btn danger" style="align-self:end">Reiniciar prueba</button>
      </form>
      <div id="lab-result" style="margin-top:12px"></div>
    </div>`;
  document.getElementById("lab-form").addEventListener("submit", async event => {
    event.preventDefault();
    const id = Number(event.target.conversation.value);
    const data = await ask({ title: `Reiniciar conversación ${id}`, text: `Se borrará la memoria NEXT y los expedientes LAB de esta conversación. Escribe <strong class="mono">RESET ${id}</strong> para confirmar.`, fields: [{ name: "confirm", label: "Confirmación", required: true, mono: true }], confirm: "Reiniciar", danger: true, area: "admin" });
    if (!data) return;
    if (data.confirm !== `RESET ${id}`) return toast(`Escribe exactamente RESET ${id}`, "bad");
    const done = await run(() => api("/operations/api/lab/reset-conversation", { method: "POST", body: { conversation_id: id, confirm: data.confirm } }), `Conversación ${id} reiniciada`);
    if (done) {
      document.getElementById("lab-result").innerHTML = `<div class="notice">Memoria limpia. Expedientes eliminados: ${esc(done.removed_sale_ids.join(", ") || "ninguno")}.</div>`;
      event.target.reset();
      await loadSales();
      updateNavCounts();
    }
  });
}

// ── Tiempo real ────────────────────────────────────────────────────────
const refreshSoon = debounce(async event => {
  if (!state.me) return;
  try {
    await loadSales();
    updateNavCounts();
    try {
      const mia = await api("/operations/api/mia");
      if (mia.paused !== state.me.mia?.paused) { state.me.mia = mia; const box = document.getElementById("mia-status"); if (box) box.outerHTML = miaStatusHtml(); }
    } catch {}
    const panelOpen = Boolean(document.getElementById("panel"));
    if (state.view !== "admin" && !document.querySelector("dialog[open]")) {
      if (state.view === "supervision") {
        const overview = await api(`/operations/api/supervision/overview?from=${state.range.from}&to=${state.range.to}`);
        state.overview = overview;
        drawSupervision(document.getElementById("view"));
      } else {
        const search = document.activeElement?.matches?.("[data-search]");
        if (!search) await renderView();
      }
      markCurrentRow();
    }
    if (panelOpen && state.saleId && event?.sale_id === state.saleId && !document.querySelector("dialog[open]")) {
      if (state.sales.some(sale => sale.sale_id === state.saleId)) await openSale(state.saleId, { push: false });
      else closePanel();
    }
  } catch {}
}, 500);

function startEvents() {
  stopEvents();
  const source = new EventSource("/operations/api/events");
  source.onmessage = message => {
    let data = {};
    try { data = JSON.parse(message.data); } catch {}
    if (data.type === "connected") return;
    refreshSoon({ sale_id: data.sale?.sale_id || data.sale_id || null });
  };
  state.events = source;
}
function stopEvents() { state.events?.close(); state.events = null; }

// ── Eventos de la interfaz ─────────────────────────────────────────────
document.addEventListener("click", async event => {
  const target = event.target.closest("[data-go], [data-act], [data-sale], [data-sale-act], [data-filter], [data-flow], [data-sale-link], [data-admin-tab], [data-user-act], [data-settings-act]");
  if (!target) return;
  if (target.dataset.go) return go(target.dataset.go);
  if (target.dataset.act === "logout") return logout();
  if (target.dataset.act === "password") return changePassword();
  if (target.dataset.act === "mia-toggle") return toggleMia();
  if (target.dataset.act === "close-panel") return closePanel();
  if (target.dataset.sale) return openSale(target.dataset.sale);
  if (target.dataset.saleLink) { event.preventDefault(); return openSale(target.dataset.saleLink); }
  if (target.dataset.saleAct) { target.disabled = true; try { await saleAction(target.dataset.saleAct); } finally { target.disabled = false; } return; }
  if (target.dataset.filter) { state.filter[target.dataset.filter] = target.dataset.value; return state.view === "supervision" ? drawSupervision(document.getElementById("view")) : renderView(); }
  if (target.dataset.flow) { state.filter.queue = target.dataset.flow; drawSupervision(document.getElementById("view")); document.querySelector(".section-gap")?.scrollIntoView({ behavior: "smooth" }); return; }
  if (target.dataset.adminTab) { state.adminTab = target.dataset.adminTab; return renderView(); }
  if (target.dataset.userAct) return userAction(target.dataset.userAct, target.dataset.user);
  if (target.dataset.settingsAct) return settingsAction(target.dataset.settingsAct);
});

document.addEventListener("change", event => {
  const check = event.target.closest("[data-check]");
  if (check) toggleCheck(check.dataset.check, check.checked);
});

const onSearch = debounce(value => {
  state.filter.search = value;
  const input = document.querySelector("[data-search]");
  const caret = input?.selectionStart;
  if (state.view === "supervision") drawSupervision(document.getElementById("view"));
  else renderView();
  const next = document.querySelector("[data-search]");
  if (next) { next.focus(); next.setSelectionRange(caret, caret); }
}, 200);
document.addEventListener("input", event => {
  if (event.target.matches("[data-search]")) onSearch(event.target.value);
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.getElementById("panel") && !document.querySelector("dialog[open]")) closePanel();
});

boot();
