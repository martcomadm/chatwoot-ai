"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Inspector de Mia — MARTCOM NEXT (solo Admin, con INSPECTOR_TOKEN)
// Vistas: Hoy · Estadísticas · Conversaciones · Calidad · Embudo y configuración
// ═══════════════════════════════════════════════════════════════════════

const app = document.getElementById("app");
const TOKEN_KEY = "mia-inspector-token";
const state = { stats: null, sq: { group: "week", from: "", to: "", cmpMode: "prev", cmpFrom: "", cmpTo: "", preset: "12w" }, sMetric: "nuevas", token: "", view: "hoy", live: null, convs: null, convFilter: "all", convSearch: "", conv: null, convTab: "chat", quality: null, qDays: 7, qFlag: "", funnel: null, fDays: 30, adminToken: "", timer: null };

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const store = { get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };

function toast(text) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = text; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}

async function api(path, options = {}) {
  const headers = { "x-inspector-token": state.token, ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !options.headers?.["x-inspector-admin-token"]) { logout("El token ya no es válido."); throw new Error("401"); }
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

// ── Fechas ─────────────────────────────────────────────────────────────
const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

// Descarga las conversaciones del rango en un solo .txt (con el filtro actual).
async function exportTxt(button, kind = "txt") {
  const from = document.getElementById("export-from")?.value || todayLocal();
  const to = document.getElementById("export-to")?.value || from;
  state.exportFrom = from; state.exportTo = to;
  const filter = ["authorized", "handoff", "tests"].includes(state.convFilter) ? state.convFilter : "all";
  const label = button.textContent;
  button.disabled = true; button.textContent = "Preparando…";
  try {
    const response = await fetch(`/inspector/api/v2/export.${kind}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&filter=${filter}`, { headers: { "x-inspector-token": state.token } });
    if (response.status === 401) { logout("El token ya no es válido."); return; }
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Error ${response.status}`);
    const count = Number(response.headers.get("X-Export-Count") || 0);
    const name = (response.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || `mia-${kind === "csv" ? "chats" : "conversaciones"}-${from}.${kind}`;
    const url = URL.createObjectURL(await response.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(count ? `Listo: ${count} conversación(es) en ${name}` : "No hubo conversaciones en esas fechas.");
  } catch (error) { toast(`No se pudo descargar: ${error.message}`); }
  finally { button.disabled = false; button.textContent = label; }
}
const fmtTime = iso => { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }); };
const fmtDate = iso => { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); };
function ago(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return fmtDate(iso);
}
function until(iso) {
  if (!iso) return "—";
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (min <= 0) return "en breve";
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `en ${h} h ${min % 60} min` : fmtDate(iso);
}
const person = (name, id) => name ? esc(name) : `<span class="muted">Chat #${esc(id)}</span>`;

// ── Acceso ─────────────────────────────────────────────────────────────
function gate(message = "") {
  stopTimer();
  app.innerHTML = `<div class="gate"><form class="gate-card" id="gate" autocomplete="off">
    <h1>Inspector de Mia</h1>
    <p>Actividad, calidad y resultados de Mia en NEXT. Acceso solo para Admin.</p>
    ${message ? `<div class="error">${esc(message)}</div>` : ""}
    <label><span class="muted" style="font-weight:600;font-size:14px">Token del inspector</span>
      <input class="input mono" type="password" name="mia-inspector-token" id="token-input" autocomplete="new-password" required placeholder="INSPECTOR_TOKEN"></label>
    <button class="btn primary">Entrar</button>
  </form></div>`;
  document.getElementById("gate").addEventListener("submit", async event => {
    event.preventDefault();
    state.token = document.getElementById("token-input").value.trim();
    try { await api("/inspector/api/v2/live"); store.set(TOKEN_KEY, state.token); start(); }
    catch (error) { if (error.message !== "401") gate(error.message); }
  });
  document.getElementById("token-input").focus();
}
function logout(message) { state.token = ""; store.set(TOKEN_KEY, ""); gate(message); }

// ── Estructura ─────────────────────────────────────────────────────────
const VIEWS = [["hoy", "Hoy"], ["estadisticas", "Estadísticas"], ["conversaciones", "Conversaciones"], ["calidad", "Calidad"], ["embudo", "Embudo y configuración"]];

function shell() {
  const live = state.live;
  const mia = live?.mia || {};
  const status = mia.paused ? ["paused", "Mia en pausa"] : mia.open ? ["", "Mia atendiendo"] : ["closed", `Fuera de horario${mia.next_opening ? ` · abre el ${esc(new Date(mia.next_opening + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric" }))}` : ""}`];
  app.innerHTML = `<header class="top">
      <div class="top-row">
        <div class="brand"><strong>MARTCOM · Inspector de Mia</strong><span>NEXT</span></div>
        <span class="status ${status[0]}"><span class="dot"></span>${status[1]}</span>
        <a class="btn quiet small" href="/inspector/clasico">Vista clásica</a>
        <button class="btn quiet small" data-act="logout">Salir</button>
      </div>
      <nav class="tabs" role="tablist">${VIEWS.map(([key, label]) => `<button role="tab" data-view="${key}" aria-selected="${state.view === key}">${label}</button>`).join("")}</nav>
    </header>
    <main class="main" id="view"></main>`;
}

async function render() {
  shell();
  const view = document.getElementById("view");
  try {
    if (state.view === "hoy") view.innerHTML = renderLive();
    if (state.view === "conversaciones") { if (!state.convs) await loadConvs(); view.innerHTML = renderConversations(); scrollChat(); }
    if (state.view === "estadisticas") { if (!state.stats) await loadStats(); view.innerHTML = renderStats(); }
    if (state.view === "calidad") { if (!state.quality) await loadQuality(); view.innerHTML = renderQuality(); }
    if (state.view === "embudo") { if (!state.funnel) await loadFunnel(); view.innerHTML = renderFunnel(); }
  } catch (error) { if (error.message !== "401") view.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
}

async function loadLive() { state.live = await api("/inspector/api/v2/live"); }
async function loadConvs() { state.convs = await api(`/inspector/api/v2/conversations?filter=${encodeURIComponent(state.convFilter)}&search=${encodeURIComponent(state.convSearch)}`); }
async function loadConv(id) { state.conv = await api(`/inspector/api/v2/conversations/${encodeURIComponent(id)}`); }
async function loadStats() {
  const q = state.sq;
  const params = new URLSearchParams({ group: q.group });
  if (q.from && q.to) { params.set("from", q.from); params.set("to", q.to); }
  if (q.cmpMode === "custom" && q.cmpFrom && q.cmpTo) { params.set("cmp_from", q.cmpFrom); params.set("cmp_to", q.cmpTo); }
  state.stats = await api(`/inspector/api/v2/stats?${params}`);
  q.from = state.stats.range.from; q.to = state.stats.range.to;
  if (q.cmpMode !== "custom") { q.cmpFrom = state.stats.compare.from; q.cmpTo = state.stats.compare.to; }
}
async function loadQuality() { state.quality = await api(`/inspector/api/v2/quality?days=${state.qDays}`); }
async function loadFunnel() { state.funnel = await api(`/inspector/api/v2/funnel?days=${state.fDays}`); }

// ── Hoy ────────────────────────────────────────────────────────────────
function kpi(label, value, cls = "") { return `<div class="kpi ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`; }
function convRow(id, name, when, what = "", tags = "") {
  return `<li><button class="row" data-open="${esc(id)}"><span class="who">${person(name, id)}</span><span class="when">${esc(when)}</span>${what ? `<span class="what">${esc(what)}</span>` : ""}${tags ? `<span class="tags">${tags}</span>` : ""}</button></li>`;
}

function renderLive() {
  const d = state.live;
  if (!d) return `<div class="empty">Cargando…</div>`;
  const k = d.kpis;
  return `<div class="head"><div><h1>Hoy</h1><p>${esc(d.mia.schedule)} · se actualiza cada 30 s</p></div><button class="btn small" data-act="refresh">Actualizar</button></div>
    <section class="kpis" aria-label="Indicadores de hoy">
      ${kpi("Clientes atendidos", k.conversations_today)}${kpi("Chats nuevos", k.new_today)}${kpi("Respuestas de Mia", k.replies_today)}
      ${kpi("Aceptaron iniciar", k.authorized_today)}${kpi("Pasaron a una persona", k.handoffs_today)}
      ${kpi("Esperando horario", k.waiting_schedule, k.waiting_schedule ? "warn" : "")}${kpi("Seguimientos programados", k.followups_pending)}
      ${kpi("Seguimientos enviados", k.followups_sent_today)}${kpi("No contestaron", k.no_response_today)}${kpi("Errores", k.errors_today, k.errors_today ? "alert" : "")}
    </section>
    <div class="cols">
      <div class="stack">
        <section class="card o1"><div class="card-head"><h2>Necesitan atención</h2><small>últimas 24 h</small></div>
          ${d.attention.length ? `<ul class="rows">${d.attention.map(a => convRow(a.id, a.name, ago(a.at), "", a.reasons.map(r => `<span class="tag bad">${esc(r)}</span>`).join(""))).join("")}</ul>` : `<div class="empty">Nada pendiente. Mia no tuvo errores, repeticiones ni chats sin retomar.</div>`}
        </section>
        <section class="card o4"><div class="card-head"><h2>Actividad reciente</h2><small>${d.activity.length} eventos</small></div>
          ${d.activity.length ? `<ul class="rows scroll">${d.activity.map(a => convRow(a.id, a.name, ago(a.at), a.text || "", `<span class="tag ${a.type === "ai_reply_sent" ? "mia" : /error/.test(a.type) ? "bad" : ""}">${esc(a.label)}</span>${a.source ? `<span class="tag">${esc(a.source)}</span>` : ""}`)).join("")}</ul>` : `<div class="empty">Sin actividad todavía.</div>`}
        </section>
      </div>
      <div class="stack">
        <section class="card o2"><div class="card-head"><h2>Esperando horario</h2><small>se retoman al abrir</small></div>
          ${d.queue.length ? `<ul class="rows">${d.queue.map(q => convRow(q.id, q.name, `desde ${fmtTime(q.since)}`, `${q.messages} mensaje(s) del cliente`)).join("")}</ul>` : `<div class="empty">Ningún chat en espera.</div>`}
        </section>
        <section class="card o3"><div class="card-head"><h2>Próximos seguimientos</h2><small>20 min · 3 h · 20 h</small></div>
          ${d.followups.length ? `<ul class="rows">${d.followups.map(f => convRow(f.id, f.name, until(f.next_at), `Seguimiento ${f.sent + 1} de 3`)).join("")}</ul>` : `<div class="empty">No hay seguimientos programados.</div>`}
        </section>
      </div>
    </div>`;
}

// ── Conversaciones ─────────────────────────────────────────────────────
const CONV_FILTERS = [["all", "Todas"], ["authorized", "Aceptaron"], ["deferred", "Pospusieron"], ["waiting", "En espera"], ["handoff", "Con persona"], ["tests", "Pruebas"]];

function renderConversations() {
  const list = state.convs?.items || [];
  const c = state.conv;
  return `<div class="split ${c ? "has-detail" : ""}">
    <section class="card list-card">
      <form class="list-tools" id="conv-search" autocomplete="off">
        <input class="input" type="search" name="mia-busqueda" autocomplete="off" placeholder="Buscar nombre, # o texto" value="${esc(state.convSearch)}">
        <div class="chips">${CONV_FILTERS.map(([key, label]) => `<button type="button" class="tag button" data-conv-filter="${key}" aria-pressed="${state.convFilter === key}">${label}</button>`).join("")}</div>
        <div class="export-tools" title="Descarga en un solo archivo .txt todas las conversaciones con actividad en esas fechas (con el filtro elegido)">
          <label>Desde <input class="input" type="date" id="export-from" value="${esc(state.exportFrom || todayLocal())}"></label>
          <label>Hasta <input class="input" type="date" id="export-to" value="${esc(state.exportTo || todayLocal())}"></label>
          <button type="button" class="btn small" data-act="export-txt">Descargar .txt</button>
          <button type="button" class="btn small" data-act="export-csv" title="Una fila por chat: número del cliente, línea de WhatsApp por la que escribió, cómo llegó y resultado">Descargar CSV</button>
        </div>
      </form>
      <div class="conv-list">${list.length ? `<ul class="rows">${list.map(i => `<li><button class="row" data-open="${i.id}" aria-current="${c?.id === i.id}">
          <span class="who">${person(i.name, i.id)}</span><span class="when">${esc(ago(i.last_at))}</span>
          <span class="what">${esc(i.last_customer || i.last_reply || "")}</span>
          <span class="tags"><span class="tag">${esc(i.stage)}</span>${i.plan ? `<span class="tag mia">${esc(i.plan)}</span>` : ""}${i.deferral ? `<span class="tag warn">${esc(i.deferral)}</span>` : ""}${i.waiting_schedule ? `<span class="tag warn">Esperando horario</span>` : ""}${i.followup ? `<span class="tag">Seguimiento</span>` : ""}${i.handoff ? `<span class="tag">Con persona</span>` : ""}</span>
        </button></li>`).join("")}</ul>` : `<div class="empty">Sin conversaciones con este filtro.</div>`}</div>
    </section>
    <section class="card detail-card">${c ? renderDetail(c) : `<div class="empty">Elige una conversación para ver el chat y por qué Mia contestó lo que contestó.</div>`}</section>
  </div>`;
}

function renderDetail(c) {
  const s = c.summary;
  const facts = c.facts.filter(f => f.value);
  const notices = [];
  if (c.waiting_schedule) notices.push(`Esperando horario desde ${fmtDate(c.waiting_schedule.since)} · se retoma al abrir.`);
  if (c.followup) notices.push(`Seguimiento ${c.followup.sent + 1} de 3 programado ${until(c.followup.next_at)}.`);
  if (c.transcript_error) notices.push(`No se pudo leer Chatwoot (${c.transcript_error}); se muestra lo registrado por Mia.`);
  const chat = c.transcript.length ? c.transcript.map(m => `<div class="msg ${m.who}"><div class="meta">${m.who === "cliente" ? "Cliente" : esc(m.label || (m.who === "mia" ? "Mia" : "Persona"))} · ${esc(fmtDate(m.at))}${(m.flags || []).map(f => `<span class="tag bad">${esc(FLAG_TEXT[f] || f)}</span>`).join("")}${m.attachments ? `<span class="tag">${m.attachments} adjunto(s)</span>` : ""}</div><div class="text">${esc(m.text)}</div></div>`).join("") : `<div class="empty">Sin mensajes.</div>`;
  const events = c.events.length ? `<ul class="events">${c.events.map(e => `<li><span class="muted">${esc(fmtDate(e.at))}</span><div><strong>${esc(e.label)}</strong>${e.source ? ` <span class="tag mia">${esc(e.source)}</span>` : ""}${eventDetail(e)}</div></li>`).join("")}</ul>` : `<div class="empty">Sin eventos.</div>`;
  return `<div class="detail-head">
      <div><button class="btn quiet small back" data-act="back">← Conversaciones</button><h2>${person(s.name, c.id)}</h2>
        <div class="tags" style="margin-top:6px"><span class="tag">#${c.id}</span><span class="tag">${esc(s.stage)}</span>${s.plan ? `<span class="tag mia">${esc(s.plan)}</span>` : ""}${s.authorized ? `<span class="tag ok">Aceptó iniciar</span>` : ""}${s.deferral ? `<span class="tag warn">${esc(s.deferral)}</span>` : ""}${c.test ? `<span class="tag">Chat de prueba</span>` : ""}</div></div>
      <div class="detail-actions"><button class="btn quiet small" data-act="toggle-test" title="Los chats de prueba no cuentan en Hoy, Calidad ni Embudo">${c.test ? "Quitar de pruebas" : "Marcar como prueba"}</button><button class="btn small" data-act="reload-conv">Actualizar</button></div>
    </div>
    ${facts.length ? `<div class="facts">${facts.map(f => `<div><span>${esc(f.label)}</span><b>${esc(f.value)}</b></div>`).join("")}</div>` : ""}
    ${notices.map(n => `<div class="notice">${esc(n)}</div>`).join("")}
    <div class="subtabs" role="tablist" style="margin-top:12px"><button role="tab" data-conv-tab="chat" aria-selected="${state.convTab === "chat"}">Chat</button><button role="tab" data-conv-tab="eventos" aria-selected="${state.convTab === "eventos"}">Eventos (${c.events.length})</button></div>
    ${state.convTab === "chat" ? `<div class="chat" id="chat">${chat}</div>` : events}`;
}

const REASONS = { human_replied: "parecía que una persona ya había contestado", conversation_closed: "la conversación estaba cerrada", customer_wrote: "el cliente volvió a escribir", reassigned: "se reasignó a otra persona", closed: "la conversación se cerró", paused_label: "chat en pausa", stop_label: "etiqueta de cierre", not_applicable: "ya no aplicaba", after_hours_notice: "se quedó con el aviso de horario", unanswered: "mensaje sin contestar" };
function eventDetail(e) {
  const d = e.details || {};
  const parts = [];
  if (d.customer_text) parts.push(`Cliente: ${d.customer_text}`);
  if (d.reply) parts.push(`Mia: ${d.reply}`);
  if (d.text && !d.reply) parts.push(d.text);
  if (d.reason) parts.push(`Motivo: ${REASONS[d.reason] || d.reason}`);
  if (d.kind) parts.push(`Tipo: ${REASONS[d.kind] || d.kind}`);
  if (d.error) parts.push(`Error: ${d.error}`);
  return parts.length ? `<pre>${esc(parts.join("\n"))}</pre>` : "";
}
function scrollChat() { requestAnimationFrame(() => { const chat = document.getElementById("chat"); if (chat) chat.scrollTop = chat.scrollHeight; }); }

// ── Calidad ────────────────────────────────────────────────────────────
const FLAG_TEXT = { repetida: "Repetida", generica: "Genérica", corregida: "Corregida", calidad: "Falló calidad", sin_respuesta: "Sin respuesta", error: "Error", no_retomado: "No retomado", molesto: "Cliente molesto" };
const daysSeg = (current, attr, options) => `<div class="segmented">${options.map(n => `<button data-${attr}="${n}" aria-pressed="${current === n}">${n === 1 ? "24 h" : `${n} días`}</button>`).join("")}</div>`;

function renderQuality() {
  const q = state.quality;
  const total = q.sources.ia + q.sources.regla + q.sources.respaldo || 1;
  const pct = n => Math.round((n / total) * 100);
  const items = q.items.filter(i => !state.qFlag || i.flags.includes(state.qFlag));
  return `<div class="head"><div><h1>Calidad de respuestas</h1><p>${q.replies} respuestas de Mia en los últimos ${q.days} días</p></div>${daysSeg(state.qDays, "qdays", [1, 7, 30])}</div>
    <section class="card" style="margin-bottom:16px"><div class="card-body">
      <strong>¿Quién decidió las respuestas?</strong>
      <div class="bar" role="img" aria-label="Reglas ${pct(q.sources.regla)}%, IA ${pct(q.sources.ia)}%, respaldo ${pct(q.sources.respaldo)}%">
        <i style="width:${pct(q.sources.regla)}%;background:var(--brand)"></i><i style="width:${pct(q.sources.ia)}%;background:var(--focus)"></i><i style="width:${pct(q.sources.respaldo)}%;background:var(--danger)"></i></div>
      <div class="legend"><span><i class="sw" style="background:var(--brand)"></i>Reglas y respuestas oficiales <b>${pct(q.sources.regla)}%</b></span><span><i class="sw" style="background:var(--focus)"></i>IA <b>${pct(q.sources.ia)}%</b></span><span><i class="sw" style="background:var(--danger)"></i>Respaldo genérico <b>${pct(q.sources.respaldo)}%</b></span></div>
    </div></section>
    <section class="card"><div class="card-head"><h2>Casos para revisar</h2><small>${items.length}</small></div>
      <div class="card-body" style="padding-bottom:6px"><div class="chips"><button class="tag button" data-qflag="" aria-pressed="${!state.qFlag}">Todos</button>${q.counts.filter(c => c.count).map(c => `<button class="tag button" data-qflag="${c.key}" aria-pressed="${state.qFlag === c.key}">${esc(c.label)} · ${c.count}</button>`).join("")}</div></div>
      ${items.length ? items.map(i => `<div class="qitem" data-open="${i.id}" data-goto="conversaciones" role="button" tabindex="0">
          <div class="line"><strong>${person(i.name, i.id)}</strong>${i.flag_labels.map(l => `<span class="tag bad">${esc(l)}</span>`).join("")}${i.source ? `<span class="tag">${esc(i.source)}</span>` : ""}<span class="muted" style="margin-left:auto;font-size:13px">${esc(fmtDate(i.at))}</span></div>
          ${i.customer ? `<div class="quote">${esc(i.customer)}</div>` : ""}${i.reply ? `<div class="quote mia">${esc(i.reply)}</div>` : ""}
          ${i.why && i.why.length ? `<div class="why"><b>Por qué se cambió la respuesta de la IA:</b> ${i.why.map(esc).join(" · ")}</div>` : ""}
          ${i.ai_draft ? `<details class="draft"><summary>Ver lo que había escrito la IA</summary><div class="quote">${esc(i.ai_draft)}</div></details>` : ""}
        </div>`).join("") : `<div class="empty">Sin casos en este periodo. 👍</div>`}
    </section>`;
}

// ── Estadísticas ───────────────────────────────────────────────────────
// Tendencias por día, semana o mes, comparación contra otro periodo y desgloses.
const GROUP_TEXT = { day: "día", week: "semana", month: "mes" };
const isoDay = d => d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
function shiftDays(date, n) { return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
function mondayOf(date) { return shiftDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)); }
const PRESETS = [["week", "Esta semana"], ["lastweek", "Semana pasada"], ["month", "Este mes"], ["lastmonth", "Mes pasado"], ["12w", "Últimas 12 semanas"], ["6m", "Últimos 6 meses"], ["30d", "Últimos 30 días"]];
function applyPreset(key) {
  const today = isoDay(new Date());
  const [y, m] = today.split("-").map(Number);
  const first = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  const q = state.sq;
  q.preset = key; q.cmpMode = "prev";
  if (key === "week") Object.assign(q, { group: "day", from: mondayOf(today), to: today });
  if (key === "lastweek") Object.assign(q, { group: "day", from: shiftDays(mondayOf(today), -7), to: shiftDays(mondayOf(today), -1) });
  if (key === "month") Object.assign(q, { group: "day", from: first(y, m), to: today });
  if (key === "lastmonth") Object.assign(q, { group: "week", from: first(y, m - 1), to: shiftDays(first(y, m), -1) });
  if (key === "12w") Object.assign(q, { group: "week", from: shiftDays(mondayOf(today), -77), to: today });
  if (key === "6m") Object.assign(q, { group: "month", from: first(y, m - 5), to: today });
  if (key === "30d") Object.assign(q, { group: "day", from: shiftDays(today, -29), to: today });
}

const money = n => `$${Math.round(n).toLocaleString("es-MX")}`;
function fmtSecs(s) { if (s === null || s === undefined) return "—"; if (s < 60) return `${s} s`; const m = Math.floor(s / 60); return m < 60 ? `${m} min ${s % 60 ? `${s % 60} s` : ""}`.trim() : `${Math.floor(m / 60)} h ${m % 60} min`; }
function fmtMetric(metric, value) {
  if (value === null || value === undefined) return "—";
  if (metric.unit === "%") return `${value}%`;
  if (metric.unit === "s") return fmtSecs(value);
  if (metric.unit === "$") return money(value);
  return Number(value).toLocaleString("es-MX");
}
function delta(metric, cur, prev) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return { text: "sin comparación", cls: "" };
  const diff = cur - prev;
  if (diff === 0) return { text: "igual", cls: "" };
  const good = metric.good ? (diff > 0) === (metric.good === "up") : null;
  const cls = good === null ? "" : good ? "up" : "down";
  const arrow = diff > 0 ? "▲" : "▼";
  if (metric.unit === "%") return { text: `${arrow} ${Math.abs(Math.round(diff * 10) / 10)} pts`, cls };
  if (!prev) return { text: `${arrow} nuevo`, cls };
  return { text: `${arrow} ${Math.abs(Math.round((diff / prev) * 1000) / 10)}%`, cls };
}

function renderStats() {
  const s = state.stats;
  const q = state.sq;
  const metrics = Object.fromEntries(s.metrics.map(m => [m.key, m]));
  const metric = metrics[state.sMetric] || metrics.nuevas;
  const groups = [...new Set(s.metrics.map(m => m.group))];
  const tiles = groups.map(g => `<section class="kgroup" aria-label="${esc(g)}"><h2>${g === "Mia" ? "Ventas con Mia" : g === "Operations" ? "Operations" : "Calidad de Mia"}</h2><div class="stiles">${s.metrics.filter(m => m.group === g).map(m => {
    const d = delta(m, s.totals[m.key], s.previous[m.key]);
    return `<button class="stile" data-metric="${m.key}" aria-pressed="${metric.key === m.key}" title="Ver la tendencia de ${esc(m.label)}"><span>${esc(m.label)}</span><b>${esc(fmtMetric(m, s.totals[m.key]))}</b><small><span class="delta ${d.cls}">${esc(d.text)}</span> antes ${esc(fmtMetric(m, s.previous[m.key]))}</small></button>`;
  }).join("")}</div></section>`).join("");
  const insight = s.insights.length ? `<ul class="insights">${s.insights.map(i => {
    const m = metrics[i.key];
    const change = i.unit === "pts" ? `${i.change > 0 ? "subió" : "bajó"} ${Math.abs(i.change)} puntos` : i.change === null ? "apareció" : `${i.change > 0 ? "subió" : "bajó"} ${Math.abs(i.change)}%`;
    return `<li class="${i.good === null ? "" : i.good ? "up" : "down"}"><span class="ico" aria-hidden="true">${i.good === null ? "•" : i.good ? "▲" : "▼"}</span><span><b>${esc(i.label)}</b> ${change}: ${esc(fmtMetric(m, i.previous))} → ${esc(fmtMetric(m, i.current))}</span></li>`;
  }).join("")}</ul>` : `<div class="empty">Sin cambios importantes entre los dos periodos (o todavía hay pocos datos).</div>`;
  const tableCols = ["nuevas", "atendidas", "aceptaron", "conversion", "a_persona", "pospusieron", "no_contestaron", "pct_genericas", "expedientes", "altas", "pagadas", "ingreso"].map(k => metrics[k]);
  const table = `<div class="tscroll"><table class="stable"><thead><tr><th scope="col">${esc(GROUP_TEXT[s.group][0].toUpperCase() + GROUP_TEXT[s.group].slice(1))}</th>${tableCols.map(m => `<th scope="col">${esc(m.label)}</th>`).join("")}</tr></thead><tbody>
    ${s.buckets.slice().reverse().map(b => `<tr><th scope="row">${esc(b.label)}${b.partial ? ' <span class="tag">en curso</span>' : ""}</th>${tableCols.map(m => `<td>${esc(fmtMetric(m, b[m.key]))}</td>`).join("")}</tr>`).join("")}
    <tr class="total"><th scope="row">Total del periodo</th>${tableCols.map(m => `<td>${esc(fmtMetric(m, s.totals[m.key]))}</td>`).join("")}</tr>
    <tr class="prev"><th scope="row">Periodo de comparación</th>${tableCols.map(m => `<td>${esc(fmtMetric(m, s.previous[m.key]))}</td>`).join("")}</tr>
  </tbody></table></div>`;
  return `<div class="head"><div><h1>Estadísticas</h1><p>${esc(s.range.label)} · comparado con ${esc(s.compare.label)}</p></div><button class="btn small" data-act="stats-csv">Descargar CSV</button></div>
    <section class="card controls"><div class="card-body">
      <div class="chips">${PRESETS.map(([k, l]) => `<button type="button" class="tag button" data-preset="${k}" aria-pressed="${q.preset === k}">${l}</button>`).join("")}</div>
      <form id="stats-form" class="sform" autocomplete="off">
        <div class="field fgroup"><span>Agrupar por</span><div class="segmented">${[["day", "Día"], ["week", "Semana"], ["month", "Mes"]].map(([k, l]) => `<button type="button" data-sgroup="${k}" aria-pressed="${s.group === k}">${l}</button>`).join("")}</div></div>
        <label class="field"><span>Desde</span><input class="input" type="date" name="from" value="${esc(q.from)}"></label>
        <label class="field"><span>Hasta</span><input class="input" type="date" name="to" value="${esc(q.to)}"></label>
        <label class="field"><span>Comparar con</span><select class="input" name="cmp" id="cmp-mode"><option value="prev" ${q.cmpMode !== "custom" ? "selected" : ""}>Periodo anterior</option><option value="custom" ${q.cmpMode === "custom" ? "selected" : ""}>Otras fechas…</option></select></label>
        <label class="field cmpf" ${q.cmpMode === "custom" ? "" : "hidden"}><span>Comparar desde</span><input class="input" type="date" name="cmp_from" value="${esc(q.cmpFrom)}"></label>
        <label class="field cmpf" ${q.cmpMode === "custom" ? "" : "hidden"}><span>Comparar hasta</span><input class="input" type="date" name="cmp_to" value="${esc(q.cmpTo)}"></label>
        <button class="btn primary small">Aplicar</button>
      </form>
    </div></section>
    <section class="card"><div class="card-head"><h2>Lo que más cambió</h2><small>contra ${esc(s.compare.label)}</small></div><div class="card-body">${insight}</div></section>
    ${tiles}
    <section class="card"><div class="card-head"><h2>${esc(metric.label)} por ${esc(GROUP_TEXT[s.group])}</h2><small>toca un indicador de arriba para cambiar la gráfica</small></div><div class="card-body">${trendChart(s, metric)}</div></section>
    <section class="card"><div class="card-head"><h2>Detalle por ${esc(GROUP_TEXT[s.group])}</h2><small>lo más reciente arriba</small></div>${table}</section>
    <div class="cols2">
      ${breakdownCard("¿Cómo llegaron?", "conversaciones nuevas en el periodo y cuántas aceptaron", s.breakdowns.entry, true)}
      ${breakdownCard("¿Qué buscan?", "lo que dijeron que necesitan", s.breakdowns.need, true)}
      ${breakdownCard("Edad", "de las conversaciones nuevas", s.breakdowns.age, true)}
      ${breakdownCard("Plan de quienes aceptaron", "en el periodo", s.breakdowns.plan, false)}
      ${breakdownCard("¿Dónde se quedaron?", "clientes que pospusieron o se despidieron", s.breakdowns.deferral, false)}
      ${heatmapCard(s.heatmap)}
    </div>
    ${s.notes.response_time ? `<p class="foot">${esc(s.notes.response_time)}</p>` : ""}
    <p class="foot">Las ventas pagadas e ingresos son el primer pago de cada expediente ($1,100 Plan 1 · $1,500 Plan 2). Los chats de prueba no cuentan.</p>`;
}

// Etiqueta corta del eje: "10 ago" (semana), "29 oct" (día), "oct" (mes).
const axisLabel = (label, group) => group === "week" ? label.split(" – ")[0] : group === "day" ? label.replace(/^\S+\s/, "") : label.replace(/ \d{4}$/, "");
function trendChart(s, metric) {
  const data = s.buckets.map(b => ({ label: b.label, value: b[metric.key], partial: b.partial }));
  if (!data.length) return `<div class="empty">Sin datos.</div>`;
  const values = data.map(d => Number(d.value) || 0);
  const max = Math.max(...values, 1);
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; })();
  const W = 960, H = 260, L = 44, R = 8, T = 16, B = 46;
  const step = (W - L - R) / data.length;
  const bw = Math.max(3, Math.min(48, step * 0.62));
  const y = v => T + (H - T - B) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const every = Math.ceil(data.length / 12);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const bars = data.map((d, i) => {
    const x = L + i * step + (step - bw) / 2;
    const v = Number(d.value) || 0;
    const h = Math.max(v ? 2 : 0, H - B - y(v));
    const tip = `${d.label}: ${fmtMetric(metric, d.value)}${d.partial ? " (en curso)" : ""}`;
    return `<g class="bar-g"><rect class="hit" x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}"><title>${esc(tip)}</title></rect><path class="barp ${d.partial ? "partial" : ""}" d="M${x},${H - B} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(0, h - 4)} z"><title>${esc(tip)}</title></path>
      ${data.length <= 16 && v ? `<text class="vlabel" x="${x + bw / 2}" y="${H - B - h - 5}" text-anchor="middle">${esc(fmtMetric(metric, d.value))}</text>` : ""}
      ${i % every === 0 ? `<text class="xlabel" x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle">${esc(axisLabel(d.label, s.group))}</text>` : ""}</g>`;
  }).join("");
  return `<div class="chartwrap"><svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric.label)} por ${esc(GROUP_TEXT[s.group])}">
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ylabel" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(fmtMetric(metric, Math.round(t * 10) / 10))}</text>`).join("")}
    ${bars}
    <line class="avg" x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}"><title>Promedio: ${esc(fmtMetric(metric, Math.round(avg * 10) / 10))}</title></line>
  </svg></div><div class="legend"><span><i class="sw" style="background:var(--brand)"></i>${esc(metric.label)}</span><span><i class="sw dash"></i>Promedio del periodo ${esc(fmtMetric(metric, Math.round(avg * 10) / 10))}</span><span><i class="sw" style="background:var(--brand);opacity:.45"></i>Periodo en curso</span></div>`;
}

function breakdownCard(title, sub, rows, withConversion) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2><small>${esc(sub)}</small></div><div class="card-body">${rows.length ? `<div class="brk">${withConversion ? `<div class="brk-row head"><span></span><span class="track"></span><span class="num">Total</span><span class="num">Aceptaron</span></div>` : ""}${rows.map(r => `<div class="brk-row"><span>${esc(r.label)}</span><span class="track"><i style="width:${(r.count / max) * 100}%"></i></span><span class="num">${r.count}</span>${withConversion ? `<span class="num">${r.aceptaron} <small>${r.conversion}%</small></span>` : ""}</div>`).join("")}</div>` : `<div class="empty">Sin datos en el periodo.</div>`}</div></section>`;
}

function heatmapCard(h) {
  const max = Math.max(1, ...h.cells.flat());
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return `<section class="card"><div class="card-head"><h2>¿Cuándo escriben?</h2><small>mensajes de clientes por día y hora</small></div><div class="card-body"><div class="heat" role="table" aria-label="Mensajes por día y hora">
    <div class="heat-row" role="row"><span></span>${hours.map(hh => `<span class="hh" role="columnheader">${hh % 3 === 0 ? hh : ""}</span>`).join("")}</div>
    ${h.cells.map((row, d) => `<div class="heat-row" role="row"><span class="hd" role="rowheader">${esc(h.weekdays[d])}</span>${row.map((v, hh) => `<span class="cell" role="cell" style="--a:${v ? 0.12 + 0.88 * (v / max) : 0}" title="${esc(h.weekdays[d])} ${hh}:00 · ${v} mensaje(s)"></span>`).join("")}</div>`).join("")}
  </div><div class="legend" style="margin-top:8px"><span>Menos</span><span class="ramp" aria-hidden="true"></span><span>Más</span></div></div></section>`;
}

function statsCsv() {
  const s = state.stats;
  if (!s) return;
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [[GROUP_TEXT[s.group], ...s.metrics.map(m => m.label)].map(cell).join(",")];
  for (const b of s.buckets) rows.push([b.label + (b.partial ? " (en curso)" : ""), ...s.metrics.map(m => b[m.key])].map(cell).join(","));
  rows.push(["Total del periodo", ...s.metrics.map(m => s.totals[m.key])].map(cell).join(","));
  rows.push([`Comparación (${s.compare.label})`, ...s.metrics.map(m => s.previous[m.key])].map(cell).join(","));
  const url = URL.createObjectURL(new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `mia-estadisticas-${s.range.from}_a_${s.range.to}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Embudo y configuración ─────────────────────────────────────────────
function renderFunnel() {
  const { funnel: f, config: c, diagnostics: diag } = state.funnel;
  const max = Math.max(f.stages[0]?.count || 0, 1);
  return `<div class="head"><div><h1>Embudo y configuración</h1><p>${f.total} conversaciones con actividad en los últimos ${f.days} días</p></div>${daysSeg(state.fDays, "fdays", [7, 30, 90])}</div>
    <div class="cols">
      <div class="stack">
        <section class="card"><div class="card-head"><h2>Avance de venta</h2><small>cuántos llegaron al menos a cada etapa</small></div><div class="card-body funnel">
          ${f.stages.map(s => `<div class="fstep"><span>${esc(s.label)}</span><div class="track"><div class="fill" style="width:${(s.count / max) * 100}%"></div></div><span class="num"><b>${s.count}</b><small>${Math.round((s.count / max) * 100)}%</small></span></div>`).join("")}
        </div></section>
        <section class="card"><div class="card-head"><h2>¿Dónde se quedaron?</h2></div><div class="card-body funnel">
          ${f.exits.map(s => `<div class="fstep"><span>${esc(s.label)}</span><div class="track"><div class="fill" style="width:${(s.count / max) * 100}%;background:var(--warn)"></div></div><span class="num"><b>${s.count}</b></span></div>`).join("")}
        </div></section>
        <section class="card"><div class="card-head"><h2>Plan de interés</h2></div><div class="card-body funnel">
          ${f.plans.map(s => `<div class="fstep"><span>${esc(s.label)}</span><div class="track"><div class="fill" style="width:${(s.count / max) * 100}%;background:var(--focus)"></div></div><span class="num"><b>${s.count}</b></span></div>`).join("")}
        </div></section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h2>Configuración de Mia</h2></div><div class="card-body"><dl class="kv">
          <dt>Estado</dt><dd>${c.mia.paused ? '<span class="tag bad">En pausa</span>' : '<span class="tag ok">Activa</span>'} <span class="muted">(se pausa desde Operations › Admin)</span></dd>
          <dt>Horario</dt><dd>${esc(c.schedule.text)}<br><span class="muted">${c.schedule.open_now ? "Abierto ahora" : "Cerrado ahora"} · ${esc(c.schedule.timezone)} · AI_SCHEDULE=<span class="mono">${esc(c.schedule.raw || "—")}</span></span></dd>
          <dt>Seguimientos</dt><dd>${c.followups.enabled ? esc(c.followups.minutes.map(m => (m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`)).join(" · ")) : "Apagados"}</dd>
          <dt>Modelo de IA</dt><dd class="mono">${esc(c.mia.model || "—")}</dd>
        </dl></div></section>
        <section class="card"><div class="card-head"><h2>Rotación de asesores</h2><small>a quién pasa Mia un chat</small></div><div class="card-body rot">
          ${c.rotation.map(g => `<div class="rot-group"><h3>${esc(g.label)} ${g.agents.length ? "" : '<span class="tag bad">Sin asesores</span>'}</h3>
            ${g.agents.map(a => `<span class="agent">${esc(a.name)} <span class="muted mono">#${a.id}</span>${state.adminToken ? `<button title="Quitar" data-rot-remove="${g.key}" data-agent="${a.id}">×</button>` : ""}</span>`).join("") || '<span class="muted">Nadie asignado.</span>'}
            ${state.adminToken ? `<form class="rot-add" data-rot-add="${g.key}" autocomplete="off"><input class="input mono" name="id" type="number" min="1" placeholder="ID Chatwoot" required><input class="input" name="name" placeholder="Nombre" required><button class="btn small">Agregar</button></form>` : ""}
          </div>`).join("")}
          ${c.admin_edit ? (state.adminToken ? `<button class="btn quiet small" data-act="admin-off">Terminar edición</button>` : `<form class="rot-add" id="admin-form" autocomplete="off"><input class="input mono" type="password" name="mia-admin-token" autocomplete="new-password" placeholder="INSPECTOR_ADMIN_TOKEN para editar" required><button class="btn small">Editar rotación</button></form>`) : '<span class="muted">Para editar se necesita INSPECTOR_ADMIN_TOKEN en el servidor.</span>'}
        </div></section>
        <section class="card"><div class="card-head"><h2>Estado del sistema</h2><small>${esc(diag.overall || "")}</small></div><div class="card-body"><ul class="diag">
          ${(diag.components || []).map(x => `<li><span>${esc(x.name)}</span><span class="tag ${x.status === "ok" ? "ok" : x.status === "warning" ? "warn" : "bad"}">${esc(String(x.status).toUpperCase())}</span><span>${esc(x.detail)}</span></li>`).join("")}
        </ul></div></section>
      </div>
    </div>`;
}

async function saveRotation(group, agents) {
  try {
    await api(`/inspector/api/control/rotations/${encodeURIComponent(group)}`, { method: "PUT", body: JSON.stringify({ agents }), headers: { "x-inspector-admin-token": state.adminToken } });
    toast("Rotación actualizada.");
    state.funnel = null; await render();
  } catch (error) { toast(error.message === "Token administrador inválido" ? "El token de administrador no es válido." : error.message); }
}

// ── Eventos de la página ───────────────────────────────────────────────
async function openConversation(id) {
  state.view = "conversaciones"; state.convTab = "chat";
  if (!state.convs) await loadConvs();
  await loadConv(id);
  await render();
}

app.addEventListener("click", async event => {
  // Abrir "Ver lo que había escrito la IA" no debe llevar a la conversación.
  if (event.target.closest("details.draft")) return;
  const el = event.target.closest("[data-preset],[data-sgroup],[data-metric],[data-view],[data-act],[data-open],[data-conv-filter],[data-conv-tab],[data-qdays],[data-qflag],[data-fdays],[data-rot-remove]");
  if (!el) return;
  if (el.dataset.preset) { applyPreset(el.dataset.preset); await loadStats(); return render(); }
  if (el.dataset.sgroup) { state.sq.group = el.dataset.sgroup; state.sq.preset = ""; state.sq.from = ""; state.sq.to = ""; await loadStats(); return render(); }
  if (el.dataset.metric) { state.sMetric = el.dataset.metric; return render(); }
  if (el.dataset.view) { state.view = el.dataset.view; if (state.view === "hoy") await loadLive(); return render(); }
  if (el.dataset.open) return openConversation(el.dataset.open);
  if (el.dataset.convFilter) { state.convFilter = el.dataset.convFilter; await loadConvs(); return render(); }
  if (el.dataset.convTab) { state.convTab = el.dataset.convTab; return render(); }
  if (el.dataset.qdays) { state.qDays = Number(el.dataset.qdays); await loadQuality(); return render(); }
  if (el.dataset.qflag !== undefined && el.matches("[data-qflag]")) { state.qFlag = el.dataset.qflag; return render(); }
  if (el.dataset.fdays) { state.fDays = Number(el.dataset.fdays); await loadFunnel(); return render(); }
  if (el.dataset.rotRemove) {
    const group = state.funnel.config.rotation.find(g => g.key === el.dataset.rotRemove);
    return saveRotation(group.key, group.agents.filter(a => String(a.id) !== el.dataset.agent));
  }
  const act = el.dataset.act;
  if (act === "logout") return logout("");
  if (act === "refresh") { await loadLive(); return render(); }
  if (act === "back") { state.conv = null; return render(); }
  if (act === "export-txt") return exportTxt(el);
  if (act === "export-csv") return exportTxt(el, "csv");
  if (act === "stats-csv") return statsCsv();
  if (act === "reload-conv") { await loadConv(state.conv.id); return render(); }
  if (act === "toggle-test") {
    await api(`/inspector/api/v2/conversations/${state.conv.id}/test`, { method: "POST", body: JSON.stringify({ test: !state.conv.test }) });
    // Las demás vistas se recalculan sin el chat de prueba.
    state.quality = null; state.funnel = null;
    await Promise.all([loadConv(state.conv.id), loadConvs(), loadLive()]);
    return render();
  }
  if (act === "admin-off") { state.adminToken = ""; return render(); }
});
app.addEventListener("change", event => { if (event.target.id === "cmp-mode") for (const el of document.querySelectorAll(".cmpf")) el.hidden = event.target.value !== "custom"; });
app.addEventListener("keydown", event => { if (event.key === "Enter" && event.target.matches(".qitem")) event.target.click(); });
app.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === "stats-form") {
    const d = new FormData(form);
    Object.assign(state.sq, { from: String(d.get("from") || ""), to: String(d.get("to") || ""), cmpMode: String(d.get("cmp") || "prev"), cmpFrom: String(d.get("cmp_from") || ""), cmpTo: String(d.get("cmp_to") || ""), preset: "" });
    await loadStats(); return render();
  }
  if (form.id === "conv-search") { state.convSearch = new FormData(form).get("mia-busqueda") || ""; await loadConvs(); return render(); }
  if (form.id === "admin-form") { state.adminToken = String(new FormData(form).get("mia-admin-token") || "").trim(); return render(); }
  if (form.dataset.rotAdd) {
    const data = new FormData(form);
    const group = state.funnel.config.rotation.find(g => g.key === form.dataset.rotAdd);
    return saveRotation(group.key, [...group.agents, { id: Number(data.get("id")), name: String(data.get("name")).trim(), enabled: true }]);
  }
});

function stopTimer() { if (state.timer) clearInterval(state.timer); state.timer = null; }
async function start() {
  stopTimer();
  try { await loadLive(); } catch (error) { if (error.message !== "401") gate(error.message); return; }
  await render();
  state.timer = setInterval(async () => {
    if (document.hidden) return;
    try {
      // Solo se refresca la vista "Hoy"; las demás no se recargan solas para no perder lo que estás leyendo.
      if (state.view === "hoy") { await loadLive(); await render(); }
    } catch {}
  }, 30000);
}

state.token = store.get(TOKEN_KEY);
if (state.token) start(); else gate();
