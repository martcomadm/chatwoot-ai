import { CORE_VERSION, INSPECTOR_VERSION } from "../version.js";

export function inspectorPage() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>MARTCOM AI Inspector</title>
<link rel="stylesheet" href="/inspector/assets/inspector.css">
<script src="/inspector/assets/inspector.js" defer></script>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <b>MARTCOM Inspector</b>
    <small>Inspector ${INSPECTOR_VERSION} · Core ${CORE_VERSION}</small>
  </div>
  <nav class="main-tabs" aria-label="Secciones">
    <button type="button" class="main-tab active" data-main-tab="conversations">Conversaciones</button>
    <button type="button" class="main-tab" data-main-tab="analytics">Análisis</button>
    <button type="button" class="main-tab" id="controlBtn">Control operativo</button>
  </nav>
  <div class="session">
    <div id="health" class="health" role="status">Sin conectar</div>
    <input id="token" type="password" autocomplete="off" placeholder="Token del Inspector" aria-label="Token del Inspector">
  </div>
</header>

<main class="wrap">
  <section id="conversationsView">
    <div id="dashboard" class="kpis"></div>
    <details id="opsSummary" class="ops-summary">
      <summary>Rotación y distribución por asesor</summary>
      <div id="opsSummaryBody" class="ops-summary-body"></div>
    </details>

    <div class="filters">
      <div class="filter-row">
        <input id="search" type="search" placeholder="Buscar por ID, nombre o necesidad" aria-label="Buscar">
        <select id="intent" aria-label="Intención"><option value="">Todas las intenciones</option></select>
        <select id="advisor" aria-label="Asesor"><option value="">Todos los asesores</option></select>
        <select id="phase" aria-label="Fase"><option value="">Todas las fases</option></select>
        <select id="temperature" aria-label="Temperatura"><option value="">Todas las temperaturas</option></select>
        <button type="button" class="toggle-btn" id="alertBtn" aria-pressed="false">Solo con alertas</button>
      </div>
      <div class="filter-row">
        <div class="segmented" role="group" aria-label="Periodo">
          <button type="button" data-range="today">Hoy</button><button type="button" data-range="yesterday">Ayer</button><button type="button" data-range="7">7 días</button><button type="button" data-range="30">30 días</button><button type="button" data-range="all" class="active">Todo</button>
        </div>
        <label class="field">Desde <input id="fromDate" type="date"></label>
        <label class="field">Hasta <input id="toDate" type="date"></label>
        <label class="field">Orden <select id="sort"><option value="newest">Más recientes</option><option value="oldest">Más antiguas</option><option value="alerts">Más alertas</option><option value="id_desc">ID descendente</option><option value="id_asc">ID ascendente</option><option value="name">Nombre</option></select></label>
        <button type="button" class="btn primary push-right" id="refreshBtn">Actualizar</button>
      </div>
    </div>

    <div class="layout">
      <section class="pane list-pane" aria-label="Conversaciones">
        <div class="pane-head"><b>Conversaciones</b><small id="count"></small></div>
        <div id="list" class="list"><div class="empty">Escribe el token del Inspector arriba para ver las conversaciones.</div></div>
      </section>
      <section class="pane detail-pane" aria-label="Expediente">
        <div class="pane-head"><b>Expediente</b><span id="conversationTitle"></span></div>
        <div id="content" class="content"><div class="empty">Selecciona una conversación de la lista.</div></div>
      </section>
    </div>
  </section>

  <section id="analyticsView" class="hidden">
    <div class="filters">
      <div class="filter-row">
        <div class="segmented" role="group" aria-label="Periodo de análisis">
          <button type="button" data-analytics-range="today">Hoy</button><button type="button" data-analytics-range="7">7 días</button><button type="button" data-analytics-range="30" class="active">30 días</button><button type="button" data-analytics-range="month">Mes actual</button>
        </div>
        <label class="field">Desde <input id="analyticsFrom" type="date"></label>
        <label class="field">Hasta <input id="analyticsTo" type="date"></label>
        <button type="button" class="btn primary push-right" id="analyticsRefresh">Actualizar</button>
      </div>
    </div>
    <div id="analyticsContent"><div class="empty">Elige un periodo para calcular las métricas.</div></div>
  </section>
</main>

<div id="controlModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="controlTitle">
  <div class="modal-card">
    <div class="modal-head">
      <div><b id="controlTitle">Control operativo</b><small>Ordena, activa o desactiva asesores por turno sin reiniciar el servicio.</small></div>
      <button type="button" id="closeControl" class="icon-btn" aria-label="Cerrar">×</button>
    </div>
    <div class="admin-auth">
      <input id="adminToken" type="password" autocomplete="off" placeholder="Token de administrador" aria-label="Token de administrador">
      <button type="button" id="loadControl" class="btn primary">Abrir control</button>
    </div>
    <div id="controlBody"><div class="empty compact">Escribe el token de administrador para editar las rotaciones.</div></div>
  </div>
</div>

<div id="advisorModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="advisorTitle">
  <div class="advisor-modal-card">
    <div class="modal-head">
      <div><b id="advisorTitle">Agregar asesor</b><small>Elige un asesor del catálogo o registra uno nuevo.</small></div>
      <button type="button" id="closeAdvisorModal" class="icon-btn" aria-label="Cerrar">×</button>
    </div>
    <div class="advisor-search-wrap"><input id="advisorSearch" type="search" placeholder="Buscar por nombre o ID" aria-label="Buscar asesor"></div>
    <div class="advisor-create-row">
      <input id="advisorNewId" type="number" min="1" placeholder="ID en Chatwoot" aria-label="ID en Chatwoot">
      <input id="advisorNewName" placeholder="Nombre del asesor" aria-label="Nombre del asesor">
      <button type="button" id="advisorCreateBtn" class="btn">Registrar asesor</button>
    </div>
    <div id="advisorModalList" class="advisor-modal-list"></div>
  </div>
</div>
</body>
</html>`;
}
