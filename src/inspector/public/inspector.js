/* MARTCOM Inspector 1.7 — UI reorganizada */
var active=null,current=null,alertsOnly=false,listSeq=0;
var TOKEN_KEY='martcom_ai_inspector_token';
var GROUPS=['weekday','saturday','sunday'];
var GROUP_LABEL={weekday:'Lunes a viernes',saturday:'Sábado',sunday:'Domingo'};
function groupLabel(g){return GROUP_LABEL[g]||g}

function el(id){return document.getElementById(id)}
function esc(v){return String(v==null?'No informado':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function isBlank(v){return v==null||v===''||(Array.isArray(v)&&!v.length)}
function val(v){return isBlank(v)?'<span class="nil">—</span>':esc(v)}
function token(){var v=el('token').value.trim();if(v)sessionStorage.setItem(TOKEN_KEY,v);return v}
function restoreToken(){var v=sessionStorage.getItem(TOKEN_KEY)||'';if(v)el('token').value=v}
function pct(v){return v==null?null:Math.round(Number(v)*100)+'%'}
function fmtDate(v){if(!v)return null;var d=new Date(v);return isNaN(d)?String(v):d.toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'})}
function yesNo(v){return v===true?'Sí':v===false?'No':null}
async function api(path){var r=await fetch(path,{headers:{'x-inspector-token':token()}});if(!r.ok){var d=await r.json().catch(function(){return {}});throw new Error(d.error||('HTTP '+r.status))}return r.json()}
function row(k,v){return '<div class="row"><div class="key">'+esc(k)+'</div><div class="val">'+val(v)+'</div></div>'}
function rowHtml(k,html){return '<div class="row"><div class="key">'+esc(k)+'</div><div class="val">'+html+'</div></div>'}
function panel(title,body){return '<div class="panel"><h3>'+esc(title)+'</h3><div class="inner">'+body+'</div></div>'}
function kpi(label,value,sub,tone){return '<div class="kpi'+(tone?' '+tone:'')+'"><span>'+esc(label)+'</span><b>'+esc(value==null?0:value)+'</b>'+(sub?'<em>'+esc(sub)+'</em>':'')+'</div>'}
function fillSelect(id,items){var s=el(id),v=s.value;s.innerHTML='<option value="">'+({intent:'Todas las intenciones',advisor:'Todos los asesores',phase:'Todas las fases',temperature:'Todas las temperaturas'}[id]||'Todos')+'</option>'+(items||[]).map(function(x){return '<option value="'+esc(x)+'">'+esc(x)+'</option>'}).join('');s.value=v}
function queryString(){var p=new URLSearchParams();if(el('search').value.trim())p.set('search',el('search').value.trim());['intent','advisor','phase','temperature'].forEach(function(k){if(el(k).value)p.set(k,el(k).value)});if(alertsOnly)p.set('alerts','1');if(el('fromDate').value)p.set('from',el('fromDate').value);if(el('toDate').value)p.set('to',el('toDate').value);if(el('sort').value)p.set('sort',el('sort').value);return p.toString()}
function setTokenStatus(text,kind){el('health').innerHTML='<span class="'+(kind||'warn')+'"><i class="dot"></i>'+esc(text)+'</span>'}

/* ---------- Conversaciones ---------- */
async function loadHealth(){
  try{
    var d=await api('/inspector/api/health');
    var age=d.lastEventAt?Math.max(0,Math.round((Date.now()-new Date(d.lastEventAt).getTime())/1000)):null;
    var kind=d.overall==='ok'?'ok':d.overall==='warning'?'warn':'bad';
    var label=d.overall==='ok'?'Sistema activo':d.overall==='warning'?'Con avisos':'Requiere atención';
    el('health').innerHTML='<span class="'+kind+'" title="Core '+esc(d.version)+' · Inspector '+esc(d.inspectorVersion)+'"><i class="dot"></i>'+esc(label)+(age!=null?' · último evento hace '+esc(ago(age)):'')+'</span>';
  }catch(e){setTokenStatus('Token inválido o sin acceso','bad')}
}
function ago(s){if(s<60)return s+' s';if(s<3600)return Math.round(s/60)+' min';if(s<86400)return Math.round(s/3600)+' h';return Math.round(s/86400)+' d'}
function rotationStrip(rotations){
  if(!rotations||!rotations.length)return '<div class="empty compact">Sin rotaciones configuradas.</div>';
  return rotations.map(function(r){
    var chips=(r.agents||[]).map(function(a,idx){return '<span class="chip'+(idx===r.nextIndex?' next':'')+'">'+esc(a.name)+' <small>#'+esc(a.id)+'</small></span>'}).join('');
    return '<div class="rotation-line"><b>'+esc(groupLabel(r.group))+'</b><div class="chips">'+(chips||'<span class="nil">Sin asesores</span>')+'</div><small>Último: '+esc(r.lastAgentName||'—')+' · Siguiente: '+esc(r.nextAgent?r.nextAgent.name:'—')+' · '+esc(r.completedAssignments)+' asignaciones</small></div>';
  }).join('');
}
function advisorShares(h){
  if(!h||!h.byAgent||!h.byAgent.length)return '<div class="empty compact">Aún no hay transferencias completadas.</div>';
  return h.byAgent.map(function(a){var p=Math.max(0,Math.min(100,Number(a.percentage)||0));return '<div class="share-row"><span>'+esc(a.name)+'</span><div class="meter"><i style="width:'+p+'%"></i></div><span>'+esc(a.count)+' · '+esc(a.percentage)+'%</span></div>'}).join('');
}
async function loadDashboard(){
  try{
    var d=await api('/inspector/api/dashboard?'+queryString()),s=d.stats||{};
    el('dashboard').innerHTML=
      kpi('Memorias',s.total)+kpi('Activas en 24 h',s.recent24h)+kpi('Transferidas',s.handoffsCompleted)+
      kpi('Transferencia pendiente',s.handoffsPending,null,s.handoffsPending?'warn':'')+
      kpi('Con alertas',s.withAlerts,null,s.withAlerts?'warn':'')+kpi('Errores en 24 h',s.errors24h,null,s.errors24h?'err':'');
    el('opsSummaryBody').innerHTML='<div><h4>Rotación automática</h4>'+rotationStrip(d.rotations)+'</div><div><h4>Transferencias por asesor</h4>'+advisorShares(d.handoffs)+'</div>';
    var f=d.filters||{};fillSelect('intent',f.intents);fillSelect('advisor',f.advisors);fillSelect('phase',f.phases);fillSelect('temperature',f.temperatures);
  }catch(e){el('dashboard').innerHTML='<div class="empty compact bad">'+esc(e.message)+'</div>'}
}
function itemState(x){if(x.hasErrorAlert)return 's-err';if(x.alertCount||x.handoffStatus==='pending')return 's-warn';if(x.handoffStatus==='completed')return 's-ok';return ''}
function itemHtml(x){
  var badges=(x.intent?'<span class="badge">'+esc(x.intent)+'</span>':'')+
    (x.handoffStatus==='completed'?'<span class="badge success">Transferida a '+esc(x.handoffAgent)+'</span>':'')+
    (x.handoffStatus==='pending'?'<span class="badge warn">Transferencia pendiente</span>':'')+
    (x.alertCount?'<span class="badge '+(x.hasErrorAlert?'error':'warn')+'">'+esc(x.alertCount)+(x.alertCount===1?' alerta':' alertas')+'</span>':'');
  return '<button type="button" class="item '+itemState(x)+(x.id===active?' active':'')+'" data-conversation-id="'+esc(x.id)+'">'+
    '<span class="item-top"><strong>'+esc(x.nombre||'Sin nombre')+'</strong><small>#'+esc(x.id)+'</small></span>'+
    '<small class="item-meta">'+esc(x.fase||'Sin fase')+' · '+esc(fmtDate(x.actualizado_en)||'sin fecha')+'</small>'+
    (badges?'<span class="badges">'+badges+'</span>':'')+'</button>';
}
async function loadList(){
  var seq=++listSeq;
  try{
    var d=await api('/inspector/api/conversations?'+queryString());
    if(seq!==listSeq)return; // llegó una respuesta más nueva mientras tanto
    el('count').textContent=d.items.length+(d.items.length===1?' resultado':' resultados');
    el('list').innerHTML=d.items.length?d.items.map(itemHtml).join(''):'<div class="empty">Ninguna conversación coincide con los filtros.</div>';
  }catch(e){if(seq===listSeq)el('list').innerHTML='<div class="empty bad">'+esc(e.message)+'</div>'}
}
function markActive(){document.querySelectorAll('#list .item').forEach(function(i){i.classList.toggle('active',Number(i.dataset.conversationId)===active)})}

function eventClass(e){if(['openai_error','processor_error','chatwoot_write_error','handoff_assignment_failed'].includes(e.type))return 'error';if(['chatwoot_read_fallback','quality_fallback','quality_repair','handoff_assignment_skipped','frustration_detected'].includes(e.type))return 'warning';if(['handoff_assignment_completed','question_resolved','answer_resolved'].includes(e.type))return 'success';return ''}
function eventLabel(t){var m={buffer_flush:'Mensajes procesados',chatwoot_read_fallback:'Chatwoot: lectura de respaldo',intent_classified:'Intención clasificada',decision_state:'Decisión del planner',memory_updated:'Memoria actualizada',quality_checked:'Respuesta validada',quality_repair:'Respuesta reparada',quality_fallback:'Respuesta de respaldo',ai_reply_sent:'Respuesta enviada',handoff:'Transferencia',handoff_summary_created:'Resumen de transferencia',handoff_assignment_started:'Asignación iniciada',handoff_assignment_completed:'Asignación completada',handoff_assignment_failed:'Asignación fallida',handoff_assignment_skipped:'Asignación omitida',semantic_normalized:'Texto normalizado',answer_resolved:'Respuesta resuelta',question_resolved:'Pregunta resuelta',resolved_question_blocked:'Pregunta bloqueada (ya resuelta)',frustration_detected:'Frustración detectada',ignored_out_of_schedule:'Ignorado: fuera de horario',ignored_no_usable_messages:'Ignorado: sin mensaje utilizable'};return m[t]||t}
function timelineHtml(events){
  if(!events||!events.length)return '<div class="empty">Sin eventos registrados.</div>';
  return '<div class="timeline">'+events.slice().reverse().map(function(e){
    var details=e.details&&Object.keys(e.details).length?'<details><summary>Detalles</summary><code>'+esc(JSON.stringify(e.details,null,2))+'</code></details>':'';
    return '<div class="event '+eventClass(e)+'"><div class="event-head"><strong>'+esc(eventLabel(e.type))+'</strong><time>'+esc(fmtDate(e.timestamp)||'')+'</time></div>'+details+'</div>';
  }).join('')+'</div>';
}
function alertsHtml(alerts){if(!alerts||!alerts.length)return '<div class="empty">No se detectaron alertas de calidad.</div>';return alerts.map(function(a){return '<div class="alert '+(a.level==='error'?'error':'')+'"><b>'+esc(a.code)+'</b>'+esc(a.message)+'</div>'}).join('')}
function diagnosticsHtml(d){return panel('Estado del sistema',((d&&d.components)||[]).map(function(c){return '<div class="diagnostic"><b>'+esc(c.name)+'</b><span class="status '+esc(c.status)+'">'+esc(c.status==='ok'?'Correcto':c.status==='warning'?'Aviso':c.status==='error'?'Error':c.status)+'</span><span>'+val(c.detail)+'</span></div>'}).join(''))}
function tabButton(id,label,count,tone){return '<button type="button" class="tab'+(id==='summary'?' active':'')+'" data-tab="'+id+'">'+esc(label)+(count?'<span class="count'+(tone?' '+tone:'')+'">'+count+'</span>':'')+'</button>'}
function progressHtml(items){return '<div class="progress-flow">'+(items||[]).map(function(x){return '<div class="progress-step'+(x.done?' done':'')+'"><span>'+(x.done?'✓':'')+'</span>'+esc(x.label)+'</div>'}).join('')+'</div>'}
function slotHtml(slots){if(!slots||!slots.length)return '<div class="empty compact">Sin datos capturados.</div>';return '<div class="slot-grid">'+slots.map(function(s){return '<div class="slot"><b>'+esc(s.key)+'</b><span>'+val(s.value)+'</span><small class="slot-status '+esc(s.status)+'">'+esc(String(s.status||'').replace(/_/g,' '))+'</small></div>'}).join('')+'</div>'}
function sensitiveState(v){return v===false?'No':v===true?'Sí':'Sin definir'}
function orchestratorHtml(m,d){
  var o=m.orchestration||{},f=m.flujo||{},j=m.judgment||{};
  return '<div class="cols">'+
    panel('Orquestador',row('Solicitud directa',o.direct_request&&o.direct_request.type)+row('Respuesta directa',o.direct_answer&&o.direct_answer.type||o.direct_answer)+row('Intención',m.intent&&(m.intent.label||m.intent.id))+row('Acción',d.explanation.action)+row('Siguiente paso',f.siguiente_paso)+row('Última pregunta',m.ultima_pregunta)+row('Preguntas de precio',j.price_requests)+row('Señales de confianza',j.trust_signals)+row('Última objeción',j.last_objection)+row('Prefiere humano',j.human_preference?'Sí':'No'))+
    panel('Protecciones de memoria',row('Preguntas resueltas',(m.resolved_questions||[]).join(', '))+row('Preguntas bloqueadas',(m.blocked_questions||[]).join(', '))+row('CURP disponible',sensitiveState(m.slots&&m.slots.curp_disponible))+row('NSS disponible',sensitiveState(m.slots&&m.slots.nss_disponible))+row('Frustración',m.experiencia&&m.experiencia.frustration_score||0)+row('Contradicciones',(m.contradicciones||[]).length))+
  '</div>';
}
function handoffHtml(m,d){
  var h=m.handoff||{},a=m.advisor_affinity||{};
  var match=!h.agent_id||!a.agent_id||Number(h.agent_id)===Number(a.agent_id);
  var pos=(a.rotation_position&&a.total_agents)?(a.rotation_position+' de '+a.total_agents):(h.rotation_position&&h.total_agents?(h.rotation_position+' de '+h.total_agents):h.rotation_position);
  return '<div class="cols">'+
    panel('Transferencia automática',row('Estado',h.status||'No iniciada')+row('Asesor reservado',a.agent_name&&(a.agent_name+(a.agent_id?' (#'+a.agent_id+')':'')))+row('Presentado por la IA',m.asesor_presentacion)+row('Asesor asignado',h.agent_name&&(h.agent_name+(h.agent_id?' (#'+h.agent_id+')':'')))+rowHtml('Coincidencia',match?'Coincide':'<span class="mismatch">No coincide con el reservado</span>')+row('Turno',groupLabel(a.group||h.group||''))+row('Posición en rotación',pos)+row('Reservado',fmtDate(a.reserved_at))+row('Motivo',h.reason)+row('Asignado',fmtDate(h.assigned_at))+row('Último intento',fmtDate(h.last_attempt_at))+row('Último error',h.last_error))+
    panel('Rotación actual',rotationStrip(d.rotations))+
  '</div>';
}
function renderConversation(){
  var d=current,m=d.memory||{},f=m.flujo||{},s=m.ventas||{},i=m.intent||{},h=m.handoff||{};
  var alerts=d.alerts||[],timeline=d.timeline||[];
  el('conversationTitle').innerHTML='<small>#'+esc(d.conversationId)+'</small>';
  var head='<div class="case-head"><h2>'+esc(m.nombre||'Sin nombre')+'</h2><small>'+esc(f.fase||'Sin fase')+(m.actualizado_en?' · actualizado '+esc(fmtDate(m.actualizado_en)):'')+'</small></div>';
  var tabs='<div class="tabs" role="tablist">'+tabButton('summary','Resumen')+tabButton('orchestrator','Orquestador')+tabButton('handoff','Transferencia')+tabButton('intentTab','Intención')+tabButton('planner','Por qué respondió así')+tabButton('timeline','Eventos',timeline.length)+tabButton('alerts','Alertas',alerts.length,alerts.length?'warn':'')+tabButton('memory','Memoria')+tabButton('diagnostics','Sistema')+'</div>';
  var stats=[['Intención',i.label||i.id],['Confianza',pct(i.confidence)],['Siguiente paso',f.siguiente_paso],['Asesor reservado',(m.advisor_affinity&&m.advisor_affinity.agent_name)||m.asesor_presentacion],['Transferencia',h.status||'No iniciada'],['Temperatura',s.temperatura]];
  var summary='<div id="tab-summary" class="tabpane">'+progressHtml(d.progress)+
    '<div class="stats">'+stats.map(function(a){return '<div class="stat"><small>'+esc(a[0])+'</small><b>'+val(a[1])+'</b></div>'}).join('')+'</div>'+
    panel('Datos capturados',slotHtml(d.slots))+
    '<div class="cols topgap">'+
      panel('Perfil del cliente',row('Nombre',m.nombre)+row('Edad',m.edad)+row('Actividad',m.actividad)+row('IMSS actual',yesNo(m.tiene_imss))+row('Necesidad',m.necesidad_principal)+row('Última cotización',m.ultima_cotizacion)+row('AFORE',m.afore_actual))+
      panel('Estado comercial',row('Plan recomendado',s.plan_recomendado)+row('Temperatura',s.temperatura)+row('Problema',s.problema)+row('Caso de tercero',m.caso_sujeto&&m.caso_sujeto.tipo)+row('Relación',m.caso_sujeto&&m.caso_sujeto.relacion))+
    '</div></div>';
  var pane=function(id,html){return '<div id="tab-'+id+'" class="tabpane hidden">'+html+'</div>'};
  var intent='<div class="cols">'+
    panel('Clasificación',row('ID',i.id)+row('Etiqueta',i.label)+row('Familia',i.family)+row('Prioridad',i.priority)+row('Confianza',pct(i.confidence))+row('Fuente',i.source)+row('Evidencia',(i.evidence||[]).join(', '))+row('Alternativas',(i.alternatives||[]).map(function(a){return typeof a==='string'?a:(a.id||a.label||JSON.stringify(a))}).join(', ')))+
    panel('Flujo seleccionado',row('Fase',f.fase)+row('Siguiente paso',f.siguiente_paso)+row('Última pregunta',m.ultima_pregunta)+row('Preguntas realizadas',(m.preguntas_realizadas||[]).join(' → ')))+
  '</div>';
  var ex=d.explanation||{reasons:[]};
  var why='<div class="why"><b>Razones de la decisión</b><ul>'+(ex.reasons||[]).map(function(r){return '<li>'+esc(r)+'</li>'}).join('')+'</ul>'+row('Acción',ex.action)+row('Dato que buscaba',ex.questionKey)+'</div>';
  el('content').innerHTML=head+tabs+summary+
    pane('orchestrator',orchestratorHtml(m,d))+pane('handoff',handoffHtml(m,d))+pane('intentTab',intent)+pane('planner',why)+
    pane('timeline',timelineHtml(timeline))+pane('alerts',alertsHtml(alerts))+
    pane('memory','<pre>'+esc(JSON.stringify(m,null,2))+'</pre>')+pane('diagnostics',diagnosticsHtml(d.diagnostics));
}
function switchTab(id){
  document.querySelectorAll('#content .tabpane').forEach(function(p){p.classList.toggle('hidden',p.id!=='tab-'+id)});
  document.querySelectorAll('#content .tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===id)});
}
async function show(id){
  active=id;markActive();
  el('content').innerHTML='<div class="empty">Cargando expediente…</div>';
  try{current=await api('/inspector/api/conversations/'+id);if(active===id)renderConversation()}
  catch(e){el('content').innerHTML='<div class="empty bad">'+esc(e.message)+'</div>'}
}
function toggleAlerts(){alertsOnly=!alertsOnly;el('alertBtn').setAttribute('aria-pressed',String(alertsOnly));loadList()}
async function refreshAll(){
  await Promise.all([loadHealth(),loadDashboard(),loadList()]);
  if(active)await show(active);
}

/* ---------- Fechas ---------- */
function dateISO(d){var y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day}
function setRange(kind){
  var now=new Date(),from='',to='';
  if(kind==='today'){from=to=dateISO(now)}
  else if(kind==='yesterday'){var y=new Date(now);y.setDate(y.getDate()-1);from=to=dateISO(y)}
  else if(kind==='7'){var s=new Date(now);s.setDate(s.getDate()-6);from=dateISO(s);to=dateISO(now)}
  else if(kind==='30'){var s2=new Date(now);s2.setDate(s2.getDate()-29);from=dateISO(s2);to=dateISO(now)}
  el('fromDate').value=from;el('toDate').value=to;
  document.querySelectorAll('[data-range]').forEach(function(b){b.classList.toggle('active',b.dataset.range===kind)});
  if(token())refreshAll();
}

/* ---------- Control operativo ---------- */
var ADMIN_KEY='martcom_ai_inspector_admin_token';
var CONTROL_STATE={data:null,activeTab:'weekday',search:'',dirty:{}};
function adminToken(){var v=el('adminToken').value.trim();if(v)sessionStorage.setItem(ADMIN_KEY,v);return v}
async function adminApi(path,options){
  options=options||{};options.headers=Object.assign({'content-type':'application/json','x-inspector-admin-token':adminToken()},options.headers||{});
  var r=await fetch(path,options);var d=await r.json().catch(function(){return {}});
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;
}
function otherGroupActions(sourceGroup){
  return GROUPS.filter(function(g){return g!==sourceGroup}).map(function(g){
    return '<button type="button" data-menu-move="'+g+'">Mover a '+esc(groupLabel(g))+'</button>'+
           '<button type="button" data-menu-copy="'+g+'">Copiar a '+esc(groupLabel(g))+'</button>';
  }).join('');
}
function currentGroupAgents(){return CONTROL_STATE.data?.groups?.[CONTROL_STATE.activeTab]||[]}
function filteredAgentsForActiveTab(){
  var agents=currentGroupAgents();
  var q=(CONTROL_STATE.search||'').trim().toLowerCase();
  if(!q)return agents;
  return agents.filter(function(a){return String(a.name||'').toLowerCase().includes(q)||String(a.id||'').includes(q)});
}
// rotationOverview() devuelve un array [{group:'weekday',nextAgent,lastAgentName,...}].
function rotationFor(rotations,group){
  if(Array.isArray(rotations))return rotations.find(function(r){return r&&r.group===group})||{};
  return (rotations&&rotations[group])||{};
}
function agentRowHtml(a,position,group){
  var on=a.enabled!==false;
  return '<div class="dynamic-agent-row'+(on?'':' is-off')+'" draggable="true" data-agent-id="'+esc(a.id)+'">'+
    '<div class="drag-handle" title="Arrastra para reordenar" aria-hidden="true">⠿</div>'+
    '<div class="position">'+position+'</div>'+
    '<div class="agent-main"><b>'+esc(a.name)+'</b><small>#'+esc(a.id)+'</small></div>'+
    '<label class="status-toggle"><input type="checkbox" data-toggle-active '+(on?'checked':'')+'><span>'+(on?'Activo':'Inactivo')+'</span></label>'+
    '<button type="button" class="kebab" data-agent-menu aria-label="Acciones para '+esc(a.name)+'">⋮</button>'+
    '<div class="agent-menu hidden">'+otherGroupActions(group)+
      '<button type="button" data-toggle-via-menu="'+(on?'disable':'enable')+'">'+(on?'Desactivar':'Activar')+'</button>'+
      '<button type="button" class="menu-danger" data-remove-from-group>Quitar del turno</button>'+
    '</div></div>';
}
// Shell (estadísticas + buscador + lista). El buscador no se vuelve a pintar al teclear.
function renderActiveRotation(){
  if(!CONTROL_STATE.data)return;
  el('rotationContent').innerHTML=
    '<div id="rotationStats" class="rotation-summary"></div>'+
    '<div class="rotation-toolbar">'+
      '<input id="rotationSearch" type="search" placeholder="Buscar por nombre o ID" aria-label="Buscar asesor en el turno" value="'+esc(CONTROL_STATE.search||'')+'">'+
      '<span id="dirtyNote" class="dirty-note"></span>'+
      '<button type="button" id="openAddAdvisor" class="btn small">Agregar asesor</button>'+
      '<button type="button" id="saveActiveRotation" class="btn small primary">Guardar cambios</button>'+
    '</div>'+
    '<div id="sortableAgents" class="dynamic-agent-list"></div>';
  renderRotationBody();
}
function renderRotationBody(){
  var group=CONTROL_STATE.activeTab,all=currentGroupAgents(),agents=filteredAgentsForActiveTab();
  var activeCount=all.filter(function(a){return a.enabled!==false}).length;
  var rot=rotationFor(CONTROL_STATE.data.rotations,group);
  var nextName=(rot.nextAgent&&rot.nextAgent.name)||'No informado';
  var lastName=rot.lastAgentName||'No informado';
  el('rotationStats').innerHTML=
    '<div><span>Total</span><b>'+all.length+'</b></div><div><span>Activos</span><b>'+activeCount+'</b></div><div><span>Inactivos</span><b>'+(all.length-activeCount)+'</b></div>'+
    '<div><span>Siguiente</span><b title="'+esc(nextName)+'">'+esc(nextName)+'</b></div><div><span>Último</span><b title="'+esc(lastName)+'">'+esc(lastName)+'</b></div>';
  el('sortableAgents').innerHTML=agents.length?agents.map(function(a){return agentRowHtml(a,all.indexOf(a)+1,group)}).join(''):'<div class="empty compact">'+(all.length?'Ningún asesor coincide con la búsqueda.':'Este turno no tiene asesores. Usa “Agregar asesor”.')+'</div>';
  var dirty=!!CONTROL_STATE.dirty[group];
  el('dirtyNote').textContent=dirty?'Cambios sin guardar':'';
  el('saveActiveRotation').disabled=!dirty;
}
function renderExceptionsView(){
  var exceptions=CONTROL_STATE.data?.exceptions||{};
  var dates=Object.keys(exceptions).sort();
  el('opsView').innerHTML=
    '<div class="secondary-view">'+
      '<div class="section-head"><h3>Excepciones por fecha</h3><small>Usa una rotación especial en un día concreto, por ejemplo un feriado.</small></div>'+
      '<div class="exception-create">'+
        '<input id="exceptionDate" type="date" aria-label="Fecha">'+
        '<select id="exceptionBase" aria-label="Copiar desde">'+GROUPS.map(function(g){return '<option value="'+g+'">Copiar de '+esc(groupLabel(g))+'</option>'}).join('')+'</select>'+
        '<button type="button" id="createException" class="btn primary">Crear o reemplazar</button>'+
      '</div>'+
      '<div class="exception-cards">'+
        (dates.length?dates.map(function(date){
          var enabled=(exceptions[date]||[]).filter(function(a){return a.enabled!==false});
          return '<div class="exception-card"><div><b>'+esc(date)+'</b><small>'+enabled.length+(enabled.length===1?' asesor activo':' asesores activos')+'</small></div>'+
            '<div class="chips">'+enabled.map(function(a){return '<span class="chip">'+esc(a.name)+'</span>'}).join('')+'</div>'+
            '<button type="button" data-delete-exception="'+esc(date)+'" class="btn small danger">Eliminar</button></div>';
        }).join(''):'<div class="empty compact">No hay excepciones configuradas.</div>')+
      '</div></div>';
}
function renderAuditView(){
  var audit=CONTROL_STATE.data?.audit||[];
  el('opsView').innerHTML=
    '<div class="secondary-view"><div class="section-head"><h3>Historial de cambios</h3><small>Últimos 100 cambios hechos desde el Control operativo.</small></div>'+
      '<div class="audit-list">'+
        (audit.length?audit.slice(0,100).map(function(a){
          var details=a.details||{};
          var info=details.group||details.targetGroup||details.date||details.sourceGroup||'';
          return '<div class="audit-item"><time>'+esc(fmtDate(a.timestamp)||'')+'</time><b>'+esc(a.type)+'</b><span>'+esc(GROUP_LABEL[info]||String(info))+'</span></div>';
        }).join(''):'<div class="empty compact">Sin cambios registrados.</div>')+
      '</div></div>';
}
function renderControlShell(){
  var d=CONTROL_STATE.data||{},groups=d.groups||{},exceptions=d.exceptions||{};
  el('controlBody').innerHTML=
    '<div class="ops-tabs" role="tablist">'+
      GROUPS.map(function(g){
        var count=(groups[g]||[]).filter(function(a){return a.enabled!==false}).length;
        return '<button type="button" class="ops-tab'+(CONTROL_STATE.activeTab===g?' active':'')+'" data-ops-tab="'+g+'">'+esc(groupLabel(g))+(CONTROL_STATE.dirty[g]?' •':'')+'<span>'+count+'</span></button>';
      }).join('')+
      '<button type="button" class="ops-tab'+(CONTROL_STATE.activeTab==='exceptions'?' active':'')+'" data-ops-tab="exceptions">Excepciones<span>'+Object.keys(exceptions).length+'</span></button>'+
      '<button type="button" class="ops-tab'+(CONTROL_STATE.activeTab==='audit'?' active':'')+'" data-ops-tab="audit">Historial</button>'+
    '</div>'+
    '<div id="opsView"></div>';
  if(GROUPS.includes(CONTROL_STATE.activeTab)){el('opsView').innerHTML='<div id="rotationContent"></div>';renderActiveRotation()}
  else if(CONTROL_STATE.activeTab==='exceptions')renderExceptionsView();
  else renderAuditView();
}
function renderControl(d){CONTROL_STATE.data=d;renderControlShell()}
function markDirty(){
  if(GROUPS.includes(CONTROL_STATE.activeTab)){
    var first=!CONTROL_STATE.dirty[CONTROL_STATE.activeTab];
    CONTROL_STATE.dirty[CONTROL_STATE.activeTab]=true;
    if(first){var t=document.querySelector('[data-ops-tab="'+CONTROL_STATE.activeTab+'"]');if(t&&t.firstChild)t.firstChild.textContent=groupLabel(CONTROL_STATE.activeTab)+' •'}
  }
}
function dirtyGroups(exceptGroup){
  return Object.keys(CONTROL_STATE.dirty).filter(function(g){return CONTROL_STATE.dirty[g]&&g!==exceptGroup});
}
// Las acciones que recargan el panel descartan reordenamientos/activaciones sin guardar: pedir confirmación.
function confirmDiscard(exceptGroup){
  var pending=dirtyGroups(exceptGroup);
  if(!pending.length)return true;
  return confirm('Hay cambios sin guardar en '+pending.map(groupLabel).join(', ')+'.\n\nSi continúas se perderán. ¿Continuar?');
}
async function saveCurrentRotation(){
  var group=CONTROL_STATE.activeTab;
  if(!GROUPS.includes(group))return;
  if(!confirmDiscard(group))return;
  await adminApi('/inspector/api/control/rotations/'+group,{method:'PUT',body:JSON.stringify({agents:currentGroupAgents()})});
  CONTROL_STATE.dirty[group]=false;
  await loadControl();await refreshAll();
}
async function dynamicMove(agentId,targetGroup){
  var sourceGroup=CONTROL_STATE.activeTab;
  if(!confirmDiscard())return;
  if(!confirm('¿Mover este asesor de '+groupLabel(sourceGroup)+' a '+groupLabel(targetGroup)+'?'))return;
  await adminApi('/inspector/api/control/agents/move',{method:'POST',body:JSON.stringify({sourceGroup:sourceGroup,targetGroup:targetGroup,agentId:Number(agentId)})});
  await loadControl();await refreshAll();
}
async function removeFromCurrentGroup(agentId){
  var group=CONTROL_STATE.activeTab;
  var agent=currentGroupAgents().find(function(a){return Number(a.id)===Number(agentId)});
  if(!agent)return;
  if(!confirmDiscard())return;
  if(!confirm('¿Quitar a '+agent.name+' de '+groupLabel(group)+'?\n\nSeguirá en el catálogo para volver a agregarlo después.'))return;
  await adminApi('/inspector/api/control/agents/remove',{method:'POST',body:JSON.stringify({group:group,agentId:Number(agentId)})});
  await loadControl();await refreshAll();
}
async function deleteMasterAdvisor(agentId){
  var agent=(CONTROL_STATE.data?.agents||[]).find(function(a){return Number(a.id)===Number(agentId)});
  var name=agent?.name||('ID '+agentId);
  if(!confirmDiscard())return;
  if(!confirm('¿Eliminar a '+name+' del catálogo?\n\nSolo es posible si ya no pertenece a ningún turno ni excepción.'))return;
  await adminApi('/inspector/api/control/agents/'+Number(agentId),{method:'DELETE'});
  await loadControl();await refreshAll();
  renderAdvisorModalList(CONTROL_STATE.data?.agents||[]);
}
async function dynamicCopy(agentId,targetGroup){
  if(!confirmDiscard())return;
  await adminApi('/inspector/api/control/agents/copy',{method:'POST',body:JSON.stringify({targetGroup:targetGroup,agentId:Number(agentId)})});
  await loadControl();await refreshAll();
}
function openAddAdvisorModal(){
  el('controlModal').classList.add('modal-underlay');
  el('advisorModal').classList.remove('hidden');
  el('advisorSearch').value='';
  renderAdvisorModalList(CONTROL_STATE.data?.agents||[]);
  requestAnimationFrame(function(){el('advisorSearch').focus()});
}
function closeAdvisorModal(){
  el('advisorModal').classList.add('hidden');
  el('controlModal').classList.remove('modal-underlay');
}
async function createAdvisorFromModal(){
  var id=Number(el('advisorNewId')?.value);
  var name=(el('advisorNewName')?.value||'').trim();
  if(!Number.isFinite(id)||id<=0) return alert('Escribe un ID de Chatwoot válido');
  if(name.length<2) return alert('Escribe el nombre del asesor');
  if(!confirmDiscard())return;
  await adminApi('/inspector/api/control/agents',{method:'POST',body:JSON.stringify({id:id,name:name})});
  await loadControl();
  renderAdvisorModalList(CONTROL_STATE.data?.agents||[]);
  el('advisorNewId').value='';el('advisorNewName').value='';
}
function renderAdvisorModalList(agents){
  var q=(el('advisorSearch').value||'').trim().toLowerCase();
  var inGroup={};currentGroupAgents().forEach(function(a){inGroup[Number(a.id)]=true});
  var filtered=(agents||[]).filter(function(a){return !q||String(a.name||'').toLowerCase().includes(q)||String(a.id).includes(q)});
  var label=groupLabel(CONTROL_STATE.activeTab);
  el('advisorModalList').innerHTML=filtered.map(function(a){
    var already=inGroup[Number(a.id)];
    return '<div class="advisor-pick-row"><div><b>'+esc(a.name)+'</b><small>#'+esc(a.id)+(already?' · ya está en '+esc(label):'')+'</small></div>'+
      '<div class="advisor-pick-actions">'+
        '<button type="button" class="btn small primary" data-add-existing="'+esc(a.id)+'"'+(already?' disabled':'')+'>Agregar a '+esc(label)+'</button>'+
        '<button type="button" class="btn small danger" data-delete-master="'+esc(a.id)+'">Eliminar</button>'+
      '</div></div>';
  }).join('')||'<div class="empty compact">Ningún asesor coincide con la búsqueda.</div>';
}
async function loadControl(){
  try{
    var saved=sessionStorage.getItem(ADMIN_KEY)||'';if(saved&&!el('adminToken').value)el('adminToken').value=saved;
    if(!adminToken())throw new Error('Escribe el token de administrador');
    if(!el('token').value.trim())throw new Error('Escribe primero el token del Inspector en la barra superior');
    await adminApi('/inspector/api/control/admin-check');
    var d=await api('/inspector/api/control/rotations');
    CONTROL_STATE.dirty={};
    renderControl(d);
  }catch(e){el('controlBody').innerHTML='<div class="secondary-view"><div class="alert error">'+esc(e.message)+'</div></div>'}
}
function openControl(){
  el('controlModal').classList.remove('hidden');
  var saved=sessionStorage.getItem(ADMIN_KEY)||'';
  if(saved)el('adminToken').value=saved;
  // Si hay cambios sin guardar, se conservan en lugar de recargar desde el servidor.
  if(CONTROL_STATE.data&&dirtyGroups().length){renderControlShell();return}
  if(saved)loadControl();else el('adminToken').focus();
}

/* ---------- Análisis ---------- */
var ANALYTICS_STATE={loaded:false};
function setAnalyticsRange(kind){
  var n=new Date(),to=dateISO(n),from=to;
  if(kind==='7'){var d=new Date(n);d.setDate(d.getDate()-6);from=dateISO(d)}
  if(kind==='30'){var d2=new Date(n);d2.setDate(d2.getDate()-29);from=dateISO(d2)}
  if(kind==='month')from=dateISO(new Date(n.getFullYear(),n.getMonth(),1));
  el('analyticsFrom').value=from;el('analyticsTo').value=to;
  document.querySelectorAll('[data-analytics-range]').forEach(function(b){b.classList.toggle('active',b.dataset.analyticsRange===kind)});
  loadAnalytics();
}
function aDelta(v){if(v===null||v===undefined)return '<span class="delta neutral" title="Sin periodo previo para comparar">s/d</span>';var c=v>0?'up':v<0?'down':'neutral';return '<span class="delta '+c+'" title="Contra el periodo anterior">'+(v>0?'+':'')+esc(v)+'%</span>'}
function aMetric(label,value,sub,delta){return '<div class="metric-card"><span>'+esc(label)+'</span><b>'+esc(value==null?0:value)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+(delta!==false?aDelta(delta):'')+'</div>'}
// numCols: índices de columnas numéricas, alineadas a la derecha.
function aTable(h,rows,numCols){
  numCols=numCols||[];
  var cls=function(i){return numCols.indexOf(i)>=0?' class="num"':''};
  return '<div class="analytics-table-wrap"><table class="analytics-table"><thead><tr>'+h.map(function(x,i){return '<th'+cls(i)+'>'+esc(x)+'</th>'}).join('')+'</tr></thead><tbody>'+
    (rows.length?rows.map(function(r){return '<tr>'+r.map(function(c,i){return '<td'+cls(i)+'>'+esc(String(c??''))+'</td>'}).join('')+'</tr>'}).join(''):'<tr><td colspan="'+h.length+'" class="nil">Sin datos en el periodo.</td></tr>')+
  '</tbody></table></div>';
}
function aBars(items,labelKey,valueKey){
  if(!items.length)return '<div class="empty compact">Sin datos en el periodo.</div>';
  var max=Math.max(1,...items.map(function(x){return Number(x[valueKey]||0)}));
  return items.map(function(x){var v=Number(x[valueKey]||0),w=v?Math.max(2,Math.round(v/max*100)):0;return '<div class="bar-row"><span>'+esc(String(x[labelKey]))+'</span><div class="meter"><i style="width:'+w+'%"></i></div><b>'+v+'</b></div>'}).join('');
}
function card(title,body,sub){return '<section class="analytics-card"><div class="card-title"><b>'+esc(title)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div>'+body+'</section>'}
function renderAnalytics(d){
  var k=d.kpis||{},p=d.projection||{},c=d.comparison||{},ph=p.projected_handoffs||{};
  el('analyticsContent').innerHTML=
  '<div class="analytics-kpis">'+
    aMetric('Conversaciones',k.conversations,null,c.conversations?.delta_pct)+
    aMetric('Transferencias',k.handoffs,(k.handoff_rate??0)+'% de las conversaciones',c.handoffs?.delta_pct)+
    aMetric('Alertas',k.alerts,(k.alerts_per_100??0)+' por cada 100',c.alerts?.delta_pct)+
    aMetric('Objeciones de precio',k.price_objections,null,false)+
    aMetric('Pidieron un humano',k.human_requests,null,false)+
    aMetric('CURP recibidas',k.curp_received,null,false)+
  '</div>'+
  '<div class="analytics-grid two">'+
    card('Conversaciones por día','<div class="bars">'+aBars(d.daily||[],'date','count')+'</div>')+
    card('Actividad por hora','<div class="bars cols2">'+aBars((d.hourly||[]).map(function(x){return {label:String(x.hour).padStart(2,'0')+':00',count:x.count}}),'label','count')+'</div>')+
  '</div>'+
  '<div class="analytics-grid two">'+
    card('Intenciones',aTable(['Intención','Casos','%'],(d.intents||[]).map(function(x){return [x.intent,x.count,x.share+'%']}),[1,2]))+
    card('Embudo',aTable(['Etapa','Casos','%'],(d.funnel||[]).map(function(x){return [x.stage,x.count,x.rate+'%']}),[1,2]))+
  '</div>'+
  '<div class="analytics-grid">'+
    card('Distribución por asesor',aTable(['Asesor','Conversaciones','Transferencias','Tasa','Alertas','Objeciones de precio'],(d.advisors||[]).map(function(x){return [x.advisor,x.conversations,x.handoffs,x.handoff_rate+'%',x.alerts,x.price_objections]}),[1,2,3,4,5]))+
  '</div>'+
  '<div class="analytics-grid two">'+
    card('Calidad por versión del Core',aTable(['Versión','Conversaciones','Alertas','% alertas','% transferidas'],(d.versions||[]).map(function(x){return [x.version,x.conversations,x.alerts,x.alert_rate+'%',x.handoff_rate+'%']}),[1,2,3,4]))+
    card('Proyección del mes',
      '<div class="projection-current"><b>'+Number(p.current||0)+'</b><small>conversaciones acumuladas · '+Number(p.daily_average||0)+' por día · faltan '+Number(p.remaining_days||0)+' días</small></div>'+
      '<div class="projection-scenarios">'+
        '<div><span>Conservador</span><b>'+Number(p.conservative||0)+'</b><small>≈ '+Number(ph.conservative||0)+' transferencias</small></div>'+
        '<div class="base"><span>Esperado</span><b>'+Number(p.base||0)+'</b><small>≈ '+Number(ph.base||0)+' transferencias</small></div>'+
        '<div><span>Alto</span><b>'+Number(p.high||0)+'</b><small>≈ '+Number(ph.high||0)+' transferencias</small></div>'+
      '</div><div class="projection-note">Estimación estadística'+(p.methodology?' ('+esc(p.methodology)+')':'')+'. No garantiza resultados.</div>')+
  '</div>';
}
async function loadAnalytics(){
  if(!token()){el('analyticsContent').innerHTML='<div class="empty">Escribe el token del Inspector arriba para calcular las métricas.</div>';return}
  var q=new URLSearchParams();if(el('analyticsFrom').value)q.set('from',el('analyticsFrom').value);if(el('analyticsTo').value)q.set('to',el('analyticsTo').value);
  el('analyticsContent').innerHTML='<div class="empty">Calculando métricas…</div>';
  try{var d=await api('/inspector/api/analytics?'+q.toString());ANALYTICS_STATE.loaded=true;renderAnalytics(d)}catch(e){el('analyticsContent').innerHTML='<div class="alert error">'+esc(e.message)+'</div>'}
}
function switchMainTab(tab){
  document.querySelectorAll('[data-main-tab]').forEach(function(b){b.classList.toggle('active',b.dataset.mainTab===tab)});
  el('analyticsView').classList.toggle('hidden',tab!=='analytics');
  el('conversationsView').classList.toggle('hidden',tab==='analytics');
  if(tab==='analytics'&&!ANALYTICS_STATE.loaded)setAnalyticsRange('30');
}

/* ---------- Eventos ---------- */
function bindUi(){
  restoreToken();
  document.querySelectorAll('[data-main-tab]').forEach(function(b){b.addEventListener('click',function(){switchMainTab(b.dataset.mainTab)})});
  document.querySelectorAll('[data-analytics-range]').forEach(function(b){b.addEventListener('click',function(){setAnalyticsRange(b.dataset.analyticsRange)})});
  el('analyticsRefresh').addEventListener('click',loadAnalytics);

  el('refreshBtn').addEventListener('click',function(){
    if(!token()){setTokenStatus('Escribe el token del Inspector','warn');el('token').focus();return}
    refreshAll();
  });
  el('alertBtn').addEventListener('click',toggleAlerts);
  el('token').addEventListener('keydown',function(event){
    if(event.key==='Enter'){
      event.preventDefault();
      if(!token()){setTokenStatus('Escribe el token del Inspector','warn');return}
      refreshAll();
    }
  });
  el('token').addEventListener('input',function(){var value=el('token').value.trim();if(value)sessionStorage.setItem(TOKEN_KEY,value)});

  var debounce;
  ['search','intent','advisor','phase','temperature'].forEach(function(id){
    el(id).addEventListener(id==='search'?'input':'change',function(){
      if(!token())return;
      clearTimeout(debounce);
      debounce=setTimeout(loadList,id==='search'?220:0);
    });
  });
  ['fromDate','toDate','sort'].forEach(function(id){
    el(id).addEventListener('change',function(){
      document.querySelectorAll('[data-range]').forEach(function(b){b.classList.remove('active')});
      if(token())refreshAll();
    });
  });
  document.querySelectorAll('[data-range]').forEach(function(btn){
    btn.addEventListener('click',function(){setRange(btn.dataset.range)});
  });

  el('list').addEventListener('click',function(event){
    var item=event.target.closest('[data-conversation-id]');
    if(item)show(Number(item.dataset.conversationId));
  });
  el('content').addEventListener('click',function(event){
    var tab=event.target.closest('[data-tab]');
    if(tab)switchTab(tab.dataset.tab);
  });

  // -------- Control operativo --------
  el('controlBtn').addEventListener('click',openControl);
  el('closeControl').addEventListener('click',function(event){event.preventDefault();el('controlModal').classList.add('hidden')});
  el('controlModal').addEventListener('click',function(event){if(event.target===el('controlModal'))el('controlModal').classList.add('hidden')});
  el('adminToken').addEventListener('keydown',function(event){
    if(event.key==='Enter'){event.preventDefault();if(confirmDiscard())loadControl()}
  });
  el('loadControl').addEventListener('click',function(){if(confirmDiscard())loadControl()});

  // Cierra los menús ⋮ al hacer clic fuera de ellos.
  document.addEventListener('click',function(event){
    if(event.target.closest('[data-agent-menu]')||event.target.closest('.agent-menu'))return;
    document.querySelectorAll('.agent-menu').forEach(function(m){m.classList.add('hidden')});
  });

  el('controlBody').addEventListener('click',async function(event){
    var tab=event.target.closest('[data-ops-tab]');
    if(tab){CONTROL_STATE.activeTab=tab.dataset.opsTab;CONTROL_STATE.search='';renderControlShell();return}
    if(event.target.id==='openAddAdvisor'){openAddAdvisorModal();return}
    if(event.target.id==='saveActiveRotation'){try{await saveCurrentRotation()}catch(e){alert(e.message)}return}

    var menuButton=event.target.closest('[data-agent-menu]');
    if(menuButton){
      var menu=menuButton.parentNode.querySelector('.agent-menu');
      document.querySelectorAll('.agent-menu').forEach(function(m){if(m!==menu)m.classList.add('hidden')});
      menu.classList.toggle('hidden');
      return;
    }
    var moveTo=event.target.closest('[data-menu-move]');
    if(moveTo){try{await dynamicMove(moveTo.closest('.dynamic-agent-row').dataset.agentId,moveTo.dataset.menuMove)}catch(e){alert(e.message)}return}
    var copyTo=event.target.closest('[data-menu-copy]');
    if(copyTo){try{await dynamicCopy(copyTo.closest('.dynamic-agent-row').dataset.agentId,copyTo.dataset.menuCopy)}catch(e){alert(e.message)}return}
    var removeBtn=event.target.closest('[data-remove-from-group]');
    if(removeBtn){try{await removeFromCurrentGroup(removeBtn.closest('.dynamic-agent-row').dataset.agentId)}catch(e){alert(e.message)}return}
    var toggleMenu=event.target.closest('[data-toggle-via-menu]');
    if(toggleMenu){
      var row4=toggleMenu.closest('.dynamic-agent-row');
      var agent=currentGroupAgents().find(function(a){return Number(a.id)===Number(row4.dataset.agentId)});
      if(agent){agent.enabled=toggleMenu.dataset.toggleViaMenu==='enable';markDirty();renderRotationBody()}
      return;
    }
    var del=event.target.closest('[data-delete-exception]');
    if(del){
      if(!confirmDiscard()||!confirm('¿Eliminar la excepción del '+del.dataset.deleteException+'?'))return;
      try{await adminApi('/inspector/api/control/exceptions/'+del.dataset.deleteException,{method:'DELETE'});await loadControl();await refreshAll()}catch(e){alert(e.message)}
      return;
    }
    if(event.target.id==='createException'){
      var date=el('exceptionDate').value,base=el('exceptionBase').value;
      if(!date)return alert('Elige una fecha');
      if(!confirmDiscard())return;
      try{
        await adminApi('/inspector/api/control/exceptions/'+date,{method:'PUT',body:JSON.stringify({agents:CONTROL_STATE.data.groups?.[base]||[]})});
        await loadControl();await refreshAll();
      }catch(e){alert(e.message)}
    }
  });

  // Búsqueda y activo/inactivo: solo se repinta la lista, el buscador conserva el foco.
  el('controlBody').addEventListener('input',function(event){
    if(event.target.id==='rotationSearch'){CONTROL_STATE.search=event.target.value;renderRotationBody();return}
    var toggle=event.target.closest('[data-toggle-active]');
    if(toggle){
      var row=toggle.closest('.dynamic-agent-row');
      var agent=currentGroupAgents().find(function(a){return Number(a.id)===Number(row.dataset.agentId)});
      if(agent){agent.enabled=toggle.checked;markDirty();renderRotationBody()}
    }
  });

  // -------- Arrastrar y soltar --------
  var dragId=null;
  el('controlBody').addEventListener('dragstart',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(!row)return;
    dragId=Number(row.dataset.agentId);
    row.classList.add('dragging');
    if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(dragId))}
  });
  el('controlBody').addEventListener('dragend',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(row)row.classList.remove('dragging');
    document.querySelectorAll('.dynamic-agent-row').forEach(function(r){r.classList.remove('drag-over')});
    dragId=null;
  });
  el('controlBody').addEventListener('dragover',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(!row||dragId===null)return;
    event.preventDefault();row.classList.add('drag-over');
  });
  el('controlBody').addEventListener('dragleave',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(row&&!row.contains(event.relatedTarget))row.classList.remove('drag-over');
  });
  el('controlBody').addEventListener('drop',function(event){
    var target=event.target.closest('.dynamic-agent-row');
    if(!target||dragId===null)return;
    event.preventDefault();
    var targetId=Number(target.dataset.agentId);
    if(targetId===dragId)return;
    var agents=currentGroupAgents().slice();
    var from=agents.findIndex(function(a){return Number(a.id)===dragId});
    var to=agents.findIndex(function(a){return Number(a.id)===targetId});
    if(from<0||to<0)return;
    agents.splice(to,0,agents.splice(from,1)[0]);
    CONTROL_STATE.data.groups[CONTROL_STATE.activeTab]=agents;
    markDirty();renderRotationBody();
    dragId=null;
  });

  // -------- Modal para agregar asesor --------
  el('closeAdvisorModal').addEventListener('click',function(event){event.preventDefault();event.stopPropagation();closeAdvisorModal()});
  el('advisorModal').addEventListener('click',function(event){if(event.target===el('advisorModal'))closeAdvisorModal()});
  el('advisorSearch').addEventListener('input',function(){renderAdvisorModalList(CONTROL_STATE.data?.agents||[])});
  el('advisorModalList').addEventListener('click',async function(event){
    var del=event.target.closest('[data-delete-master]');
    if(del){try{await deleteMasterAdvisor(Number(del.dataset.deleteMaster))}catch(e){alert(e.message)}return}
    var btn=event.target.closest('[data-add-existing]');
    if(btn){
      if(!confirmDiscard())return;
      try{
        await adminApi('/inspector/api/control/agents/copy',{method:'POST',body:JSON.stringify({targetGroup:CONTROL_STATE.activeTab,agentId:Number(btn.dataset.addExisting)})});
        closeAdvisorModal();
        await loadControl();await refreshAll();
      }catch(e){alert(e.message)}
    }
  });
  el('advisorCreateBtn').addEventListener('click',async function(){try{await createAdvisorFromModal()}catch(e){alert(e.message)}});
  el('advisorNewName').addEventListener('keydown',async function(event){
    if(event.key==='Enter'){event.preventDefault();try{await createAdvisorFromModal()}catch(e){alert(e.message)}}
  });

  // Escape cierra primero el modal de arriba.
  document.addEventListener('keydown',function(event){
    if(event.key!=='Escape')return;
    if(!el('advisorModal').classList.contains('hidden')){event.preventDefault();closeAdvisorModal();return}
    if(!el('controlModal').classList.contains('hidden')){event.preventDefault();el('controlModal').classList.add('hidden')}
  });

  if(token())refreshAll();
}

document.addEventListener('DOMContentLoaded',bindUi);
