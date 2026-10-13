"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Inspector de Mia — MARTCOM NEXT (solo Admin, con INSPECTOR_TOKEN)
// Vistas: Hoy · Conversaciones · Calidad · Embudo y configuración
// ═══════════════════════════════════════════════════════════════════════

const app = document.getElementById("app");
const TOKEN_KEY = "mia-inspector-token";
const state = { token: "", view: "hoy", live: null, convs: null, convFilter: "all", convSearch: "", conv: null, convTab: "chat", quality: null, qDays: 7, qFlag: "", funnel: null, fDays: 30, adminToken: "", timer: null };

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
const VIEWS = [["hoy", "Hoy"], ["conversaciones", "Conversaciones"], ["calidad", "Calidad"], ["embudo", "Embudo y configuración"]];

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
    if (state.view === "calidad") { if (!state.quality) await loadQuality(); view.innerHTML = renderQuality(); }
    if (state.view === "embudo") { if (!state.funnel) await loadFunnel(); view.innerHTML = renderFunnel(); }
  } catch (error) { if (error.message !== "401") view.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
}

async function loadLive() { state.live = await api("/inspector/api/v2/live"); }
async function loadConvs() { state.convs = await api(`/inspector/api/v2/conversations?filter=${encodeURIComponent(state.convFilter)}&search=${encodeURIComponent(state.convSearch)}`); }
async function loadConv(id) { state.conv = await api(`/inspector/api/v2/conversations/${encodeURIComponent(id)}`); }
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
const CONV_FILTERS = [["all", "Todas"], ["authorized", "Aceptaron"], ["deferred", "Pospusieron"], ["waiting", "En espera"], ["handoff", "Con persona"]];

function renderConversations() {
  const list = state.convs?.items || [];
  const c = state.conv;
  return `<div class="split ${c ? "has-detail" : ""}">
    <section class="card list-card">
      <form class="list-tools" id="conv-search" autocomplete="off">
        <input class="input" type="search" name="mia-busqueda" autocomplete="off" placeholder="Buscar nombre, # o texto" value="${esc(state.convSearch)}">
        <div class="chips">${CONV_FILTERS.map(([key, label]) => `<button type="button" class="tag button" data-conv-filter="${key}" aria-pressed="${state.convFilter === key}">${label}</button>`).join("")}</div>
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
        <div class="tags" style="margin-top:6px"><span class="tag">#${c.id}</span><span class="tag">${esc(s.stage)}</span>${s.plan ? `<span class="tag mia">${esc(s.plan)}</span>` : ""}${s.authorized ? `<span class="tag ok">Aceptó iniciar</span>` : ""}${s.deferral ? `<span class="tag warn">${esc(s.deferral)}</span>` : ""}</div></div>
      <button class="btn small" data-act="reload-conv">Actualizar</button>
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
        </div>`).join("") : `<div class="empty">Sin casos en este periodo. 👍</div>`}
    </section>`;
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
  const el = event.target.closest("[data-view],[data-act],[data-open],[data-conv-filter],[data-conv-tab],[data-qdays],[data-qflag],[data-fdays],[data-rot-remove]");
  if (!el) return;
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
  if (act === "reload-conv") { await loadConv(state.conv.id); return render(); }
  if (act === "admin-off") { state.adminToken = ""; return render(); }
});
app.addEventListener("keydown", event => { if (event.key === "Enter" && event.target.matches(".qitem")) event.target.click(); });
app.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
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
