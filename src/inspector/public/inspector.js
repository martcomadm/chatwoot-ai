/* MARTCOM Inspector 1.6 - Analytics & Forecasting Center */
var active=null,current=null,alertsOnly=false,dashboardData=null;
var TOKEN_KEY='martcom_ai_inspector_token';
function el(id){return document.getElementById(id)}
function esc(v){return String(v==null?'No informado':v).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function token(){var v=el('token').value.trim();if(v)sessionStorage.setItem(TOKEN_KEY,v);return v}
function restoreToken(){var v=sessionStorage.getItem(TOKEN_KEY)||'';if(v)el('token').value=v}
function pct(v){return v==null?'No informado':Math.round(Number(v)*100)+'%'}
function fmtDate(v){if(!v)return 'No informado';try{return new Date(v).toLocaleString()}catch(_){return v}}
async function api(path){var r=await fetch(path,{headers:{'x-inspector-token':token()}});if(!r.ok){var d=await r.json().catch(function(){return {}});throw new Error(d.error||('HTTP '+r.status))}return r.json()}
function row(k,v){return '<div class="row"><div class="key">'+esc(k)+'</div><div>'+esc(v)+'</div></div>'}
function metric(label,value,sub){return '<div class="metric"><small>'+esc(label)+'</small><b>'+esc(value)+'</b>'+(sub?'<em>'+esc(sub)+'</em>':'')+'</div>'}
function fillSelect(id,items){var s=el(id),v=s.value;s.innerHTML='<option value="">'+({intent:'Todas las intenciones',advisor:'Todos los asesores',phase:'Todas las fases',temperature:'Todas las temperaturas'}[id]||'Todos')+'</option>'+items.map(function(x){return '<option value="'+esc(x)+'">'+esc(x)+'</option>'}).join('');s.value=v}
function queryString(){var p=new URLSearchParams();if(el('search').value.trim())p.set('search',el('search').value.trim());['intent','advisor','phase','temperature'].forEach(function(k){if(el(k).value)p.set(k,el(k).value)});if(alertsOnly)p.set('alerts','1');if(el('fromDate').value)p.set('from',el('fromDate').value);if(el('toDate').value)p.set('to',el('toDate').value);if(el('sort').value)p.set('sort',el('sort').value);return p.toString()}
async function loadHealth(){try{var d=await api('/inspector/api/health');var age=d.lastEventAt?Math.max(0,Math.round((Date.now()-new Date(d.lastEventAt).getTime())/1000)):null;el('health').innerHTML='<span class="'+(d.overall==='ok'?'ok':d.overall==='warning'?'warn':'bad')+'">● '+esc(d.overall==='ok'?'Sistema activo':d.overall==='warning'?'Con avisos':'Requiere atención')+'</span> · Core '+esc(d.version)+' · Inspector '+esc(d.inspectorVersion)+(age!=null?' · último evento '+age+' s':'')}catch(e){el('health').innerHTML='<span class="bad">● Sin acceso</span>'}}
function rotationStrip(rotations){if(!rotations||!rotations.length)return '';return '<div class="rotation-board">'+rotations.map(function(r){var names=(r.agents||[]).map(function(a,idx){var cls=idx===r.nextIndex?'next-agent':'';return '<span class="rotation-agent '+cls+'">'+esc(a.name)+' <small>#'+esc(a.id)+'</small></span>'}).join('<span class="arrow">→</span>');return '<div class="rotation-line"><b>'+esc(r.group)+'</b><div>'+names+'</div><small>Último: '+esc(r.lastAgentName||'—')+' · Siguiente: '+esc(r.nextAgent?r.nextAgent.name:'—')+' · Asignaciones: '+esc(r.completedAssignments)+'</small></div>'}).join('')+'</div>'}
function advisorMetrics(h){if(!h||!h.byAgent||!h.byAgent.length)return '<div class="empty compact">Sin handoffs completados todavía.</div>';return '<div class="advisor-grid">'+h.byAgent.map(function(a){return '<div class="advisor-metric"><b>'+esc(a.name)+'</b><span>'+esc(a.count)+' casos</span><small>'+esc(a.percentage)+'%</small></div>'}).join('')+'</div>'}
async function loadDashboard(){try{var d=await api('/inspector/api/dashboard?'+queryString());dashboardData=d;el('dashboard').innerHTML=metric('Memorias',d.stats.total)+metric('Activas 24 h',d.stats.recent24h)+metric('Handoffs',d.stats.handoffsCompleted,'completados')+metric('Handoff pendiente',d.stats.handoffsPending)+metric('Con alertas',d.stats.withAlerts)+metric('Errores 24 h',d.stats.errors24h)+'<div class="ops-wide"><h3>Rotación automática</h3>'+rotationStrip(d.rotations)+'</div><div class="ops-wide"><h3>Distribución por asesor</h3>'+advisorMetrics(d.handoffs)+'</div>';fillSelect('intent',d.filters.intents);fillSelect('advisor',d.filters.advisors);fillSelect('phase',d.filters.phases);fillSelect('temperature',d.filters.temperatures)}catch(e){el('dashboard').innerHTML=metric('Inspector',e.message)}}
async function loadList(){try{var d=await api('/inspector/api/conversations?'+queryString());el('count').textContent=d.items.length+' resultado(s)';if(!d.items.length){el('list').innerHTML='<div class="empty">Sin resultados.</div>';return}el('list').innerHTML=d.items.map(function(x){var badges='<div class="badges">'+(x.intent?'<span class="badge">'+esc(x.intent)+'</span>':'')+(x.handoffStatus==="completed"?'<span class="badge success">→ '+esc(x.handoffAgent)+'</span>':'')+(x.handoffStatus==="pending"?'<span class="badge error">handoff pendiente</span>':'')+(x.alertCount?'<span class="badge '+(x.hasErrorAlert?'error':'warn')+'">'+x.alertCount+' alerta(s)</span>':'')+'</div>';return '<div class="item '+(x.id===active?'active':'')+'" data-conversation-id="'+x.id+'"><strong>#'+x.id+' · '+esc(x.nombre||'Sin nombre')+'</strong><small>'+esc(x.fase||'Sin fase')+' · '+esc(fmtDate(x.actualizado_en))+'</small>'+badges+'</div>'}).join('')}catch(e){el('list').innerHTML='<div class="empty bad">'+esc(e.message)+'</div>'}}
function eventClass(e){if(['openai_error','processor_error','chatwoot_write_error','handoff_assignment_failed'].includes(e.type))return 'error';if(['chatwoot_read_fallback','quality_fallback','quality_repair','handoff_assignment_skipped','frustration_detected'].includes(e.type))return 'warning';if(['handoff_assignment_completed','question_resolved','answer_resolved'].includes(e.type))return 'success';return ''}
function eventLabel(t){var m={buffer_flush:'BUFFER · procesado',chatwoot_read_fallback:'CHATWOOT · fallback',intent_classified:'INTENT · clasificado',decision_state:'PLANNER · decisión',memory_updated:'MEMORIA · actualizada',quality_checked:'QUALITY · validado',quality_repair:'QUALITY · reparado',quality_fallback:'QUALITY · fallback',ai_reply_sent:'MARTCOM AI · respuesta',handoff:'HANDOFF · transferencia',handoff_summary_created:'HANDOFF · resumen',handoff_assignment_started:'HANDOFF · asignación iniciada',handoff_assignment_completed:'HANDOFF · asignación completada',handoff_assignment_failed:'HANDOFF · asignación fallida',handoff_assignment_skipped:'HANDOFF · omitida',semantic_normalized:'SEMANTIC · normalizado',answer_resolved:'SEMANTIC · respuesta resuelta',question_resolved:'MEMORIA · pregunta resuelta',resolved_question_blocked:'PLANNER · pregunta bloqueada',frustration_detected:'QUALITY · frustración',ignored_out_of_schedule:'CORE · fuera de horario',ignored_no_usable_messages:'CORE · sin mensaje utilizable'};return m[t]||t}
function timelineHtml(events){if(!events.length)return '<div class="empty">Sin eventos registrados.</div>';return events.slice().reverse().map(function(e){return '<div class="event '+eventClass(e)+'"><time>'+esc(fmtDate(e.timestamp))+'</time><strong>'+esc(eventLabel(e.type))+'</strong><code>'+esc(JSON.stringify(e.details||{}))+'</code></div>'}).join('')}
function alertsHtml(alerts){if(!alerts.length)return '<div class="empty">No se detectaron alertas de calidad.</div>';return alerts.map(function(a){return '<div class="alert '+(a.level==='error'?'error':'')+'"><b>'+esc(a.code)+'</b><br>'+esc(a.message)+'</div>'}).join('')}
function diagnosticsHtml(d){return '<div class="panel"><h3>Estado del sistema</h3><div class="inner">'+d.components.map(function(c){return '<div class="diagnostic"><b>'+esc(c.name)+'</b><span class="status '+esc(c.status)+'">'+esc(c.status.toUpperCase())+'</span><span>'+esc(c.detail)+'</span></div>'}).join('')+'</div></div>'}
function tabButton(id,label){return '<button type="button" class="tab '+(id==='summary'?'active':'')+'" data-tab="'+id+'">'+label+'</button>'}
function progressHtml(items){return '<div class="progress-flow">'+(items||[]).map(function(x){return '<div class="progress-step '+(x.done?'done':'')+'"><span>'+(x.done?'✓':'○')+'</span><b>'+esc(x.label)+'</b></div>'}).join('<div class="progress-link">→</div>')+'</div>'}
function slotHtml(slots){return '<div class="slot-grid">'+(slots||[]).map(function(s){return '<div class="slot"><b>'+esc(s.key)+'</b><span>'+esc(s.value)+'</span><small class="slot-status '+esc(s.status)+'">'+esc(s.status.replace('_',' '))+'</small></div>'}).join('')+'</div>'}
function orchestratorHtml(m,d){var o=m.orchestration||{},f=m.flujo||{};return '<div class="cols"><div class="panel"><h3>Conversation Orchestrator</h3><div class="inner">'+row('Solicitud directa',o.direct_request&&o.direct_request.type)+row('Respuesta directa',o.direct_answer&&o.direct_answer.type||o.direct_answer)+row('Intención',m.intent&&(m.intent.label||m.intent.id))+row('Acción',d.explanation.action)+row('Siguiente paso',f.siguiente_paso)+row('Última pregunta',m.ultima_pregunta)+row('Preguntas de precio',m.judgment&&m.judgment.price_requests)+row('Señales de confianza',m.judgment&&m.judgment.trust_signals)+row('Última objeción',m.judgment&&m.judgment.last_objection)+row('Prefiere humano',m.judgment&&m.judgment.human_preference?'Sí':'No')+'</div></div><div class="panel"><h3>Protecciones de memoria</h3><div class="inner">'+row('Preguntas resueltas',(m.resolved_questions||[]).join(' · '))+row('Preguntas bloqueadas',(m.blocked_questions||[]).join(' · '))+row('CURP disponible',m.slots&&m.slots.curp_disponible===false?'No':m.slots&&m.slots.curp_disponible===true?'Sí':'Sin definir')+row('NSS disponible',m.slots&&m.slots.nss_disponible===false?'No':m.slots&&m.slots.nss_disponible===true?'Sí':'Sin definir')+row('Frustración',m.experiencia&&m.experiencia.frustration_score||0)+row('Contradicciones',(m.contradicciones||[]).length)+'</div></div></div>'}
function renderConversation(){var d=current,m=d.memory||{},f=m.flujo||{},s=m.ventas||{},i=m.intent||{},h=m.handoff||{};el('conversationTitle').textContent='#'+d.conversationId;var tabs='<div class="tabs">'+tabButton('summary','Resumen')+tabButton('orchestrator','Orchestrator')+tabButton('handoff','Handoff')+tabButton('intentTab','Intención')+tabButton('planner','Planner / ¿Por qué?')+tabButton('timeline','Timeline')+tabButton('alerts','Alertas')+tabButton('memory','Memoria')+tabButton('diagnostics','Sistema')+'</div>';
var summary='<div id="tab-summary" class="tabpane"><h3 class="section-title">Embudo de conversación</h3>'+progressHtml(d.progress)+'<div class="stats">'+[['Intención',i.label||i.id],['Confianza',pct(i.confidence)],['Fase',f.fase],['Siguiente paso',f.siguiente_paso],['Asesor reservado',(m.advisor_affinity&&m.advisor_affinity.agent_name)||m.asesor_presentacion],['Handoff',h.status||'No iniciado']].map(function(a){return '<div class="stat"><small>'+esc(a[0])+'</small><b>'+esc(a[1])+'</b></div>'}).join('')+'</div><div class="panel"><h3>Datos y estado de slots</h3><div class="inner">'+slotHtml(d.slots)+'</div></div><div class="cols topgap"><div class="panel"><h3>Perfil del cliente</h3><div class="inner">'+row('Nombre',m.nombre)+row('Edad',m.edad)+row('Actividad',m.actividad)+row('IMSS actual',m.tiene_imss===true?'Sí':m.tiene_imss===false?'No':'No informado')+row('Necesidad',m.necesidad_principal)+row('Última cotización',m.ultima_cotizacion)+row('AFORE',m.afore_actual)+'</div></div><div class="panel"><h3>Estado comercial</h3><div class="inner">'+row('Plan recomendado',s.plan_recomendado)+row('Temperatura',s.temperatura)+row('Problema',s.problema)+row('Caso de tercero',m.caso_sujeto&&m.caso_sujeto.tipo)+row('Relación',m.caso_sujeto&&m.caso_sujeto.relacion)+'</div></div></div></div>';
var orchestrator='<div id="tab-orchestrator" class="tabpane" style="display:none">'+orchestratorHtml(m,d)+'</div>';
var handoff='<div id="tab-handoff" class="tabpane" style="display:none"><div class="cols"><div class="panel"><h3>Handoff automático</h3><div class="inner">'+row('Estado',h.status)+row('Asesor reservado',m.advisor_affinity&&m.advisor_affinity.agent_name)+row('ID reservado',m.advisor_affinity&&m.advisor_affinity.agent_id)+row('Presentación IA',m.asesor_presentacion)+row('Asesor handoff',h.agent_name)+row('ID handoff',h.agent_id)+row('Coincidencia',(!h.agent_id||!m.advisor_affinity||Number(h.agent_id)===Number(m.advisor_affinity.agent_id))?'✓':'⚠ NO COINCIDE')+row('Turno',(m.advisor_affinity&&m.advisor_affinity.group)||h.group)+row('Posición',(m.advisor_affinity&&m.advisor_affinity.rotation_position&&m.advisor_affinity.total_agents)?(m.advisor_affinity.rotation_position+' / '+m.advisor_affinity.total_agents):(h.rotation_position&&h.total_agents?(h.rotation_position+' / '+h.total_agents):h.rotation_position))+row('Reservado',fmtDate(m.advisor_affinity&&m.advisor_affinity.reserved_at))+row('Motivo',h.reason)+row('Asignado',fmtDate(h.assigned_at))+row('Último intento',fmtDate(h.last_attempt_at))+row('Último error',h.last_error)+'</div></div><div class="panel"><h3>Rotación actual</h3><div class="inner">'+rotationStrip(d.rotations)+'</div></div></div></div>';
var intent='<div id="tab-intentTab" class="tabpane" style="display:none"><div class="cols"><div class="panel"><h3>Clasificación</h3><div class="inner">'+row('ID',i.id)+row('Etiqueta',i.label)+row('Familia',i.family)+row('Prioridad',i.priority)+row('Confianza',pct(i.confidence))+row('Fuente',i.source)+row('Evidencia',(i.evidence||[]).join(' · '))+row('Alternativas',(i.alternatives||[]).map(function(a){return typeof a==='string'?a:(a.id||a.label||JSON.stringify(a))}).join(' · '))+'</div></div><div class="panel"><h3>Flujo seleccionado</h3><div class="inner">'+row('Fase',f.fase)+row('Siguiente paso',f.siguiente_paso)+row('Última pregunta',m.ultima_pregunta)+row('Preguntas realizadas',(m.preguntas_realizadas||[]).join(' → '))+'</div></div></div></div>';
var why='<div id="tab-planner" class="tabpane" style="display:none"><div class="why"><b>Explicación auditable de la decisión</b><ul>'+d.explanation.reasons.map(function(r){return '<li>'+esc(r)+'</li>'}).join('')+'</ul><div><b>Acción:</b> '+esc(d.explanation.action)+' &nbsp; <b>Dato objetivo:</b> '+esc(d.explanation.questionKey)+'</div></div></div>';
var timeline='<div id="tab-timeline" class="tabpane" style="display:none"><div class="timeline">'+timelineHtml(d.timeline)+'</div></div>';
var alerts='<div id="tab-alerts" class="tabpane" style="display:none">'+alertsHtml(d.alerts)+'</div>';
var memory='<div id="tab-memory" class="tabpane" style="display:none"><pre>'+esc(JSON.stringify(m,null,2))+'</pre></div>';
var diagnostics='<div id="tab-diagnostics" class="tabpane" style="display:none">'+diagnosticsHtml(d.diagnostics)+'</div>';
el('content').innerHTML=tabs+summary+orchestrator+handoff+intent+why+timeline+alerts+memory+diagnostics}
function switchTab(id){document.querySelectorAll('.tabpane').forEach(function(p){p.style.display='none'});document.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')});el('tab-'+id).style.display='block';document.querySelector('[data-tab="'+id+'"]').classList.add('active')}
async function show(id){active=id;await loadList();el('content').innerHTML='<div class="empty">Cargando…</div>';try{current=await api('/inspector/api/conversations/'+id);renderConversation()}catch(e){el('content').innerHTML='<div class="empty bad">'+esc(e.message)+'</div>'}}
function toggleAlerts(){alertsOnly=!alertsOnly;el('alertBtn').textContent='Solo alertas: '+(alertsOnly?'SÍ':'NO');loadList()}
async function refreshAll(){await loadHealth();await loadDashboard();await loadList();if(active)await show(active)}
function setTokenStatus(text,kind){el('health').innerHTML='<span class="'+(kind||'warn')+'">● '+esc(text)+'</span>'}

var ADMIN_KEY='martcom_ai_inspector_admin_token';
function adminToken(){var v=el('adminToken').value.trim();if(v)sessionStorage.setItem(ADMIN_KEY,v);return v}
async function adminApi(path,options){
  options=options||{};options.headers=Object.assign({'content-type':'application/json','x-inspector-admin-token':adminToken()},options.headers||{});
  var r=await fetch(path,options);var d=await r.json().catch(function(){return {}});
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;
}
function dateISO(d){var y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day}
function setRange(kind){
  var now=new Date(),from='',to='';
  if(kind==='today'){from=to=dateISO(now)}
  else if(kind==='yesterday'){var y=new Date(now);y.setDate(y.getDate()-1);from=to=dateISO(y)}
  else if(kind==='7'){var s=new Date(now);s.setDate(s.getDate()-6);from=dateISO(s);to=dateISO(now)}
  else if(kind==='30'){var s2=new Date(now);s2.setDate(s2.getDate()-29);from=dateISO(s2);to=dateISO(now)}
  el('fromDate').value=from;el('toDate').value=to;
  document.querySelectorAll('[data-range]').forEach(function(b){b.classList.toggle('active',b.dataset.range===kind)});

  el('controlBody').addEventListener('input',function(event){
    if(event.target.id==='rotationSearch'){
      CONTROL_STATE.search=event.target.value;
      renderActiveRotation();
      var s=el('rotationSearch');
      if(s){s.focus();s.setSelectionRange(s.value.length,s.value.length)}
      return;
    }
    var toggle=event.target.closest('[data-toggle-active]');
    if(toggle){
      var row=toggle.closest('.dynamic-agent-row');
      var agent=currentGroupAgents().find(function(a){return Number(a.id)===Number(row.dataset.agentId)});
      if(agent){agent.enabled=toggle.checked;markDirty();renderActiveRotation()}
    }
  });

  var dragId=null;
  el('controlBody').addEventListener('dragstart',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(!row)return;
    dragId=Number(row.dataset.agentId);
    row.classList.add('dragging');
    if(event.dataTransfer){
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',String(dragId));
    }
  });
  el('controlBody').addEventListener('dragend',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(row)row.classList.remove('dragging');
    document.querySelectorAll('.dynamic-agent-row').forEach(function(r){r.classList.remove('drag-over')});
  });
  el('controlBody').addEventListener('dragover',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(!row||dragId===null)return;
    event.preventDefault();
    row.classList.add('drag-over');
  });
  el('controlBody').addEventListener('dragleave',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(row)row.classList.remove('drag-over');
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
    var moved=agents.splice(from,1)[0];
    agents.splice(to,0,moved);
    CONTROL_STATE.data.groups[CONTROL_STATE.activeTab]=agents;
    markDirty();
    renderActiveRotation();
    dragId=null;
  });

  el('closeAdvisorModal').addEventListener('click',function(event){event.preventDefault();event.stopPropagation();closeAdvisorModal()});
  el('advisorModal').addEventListener('click',function(event){
    if(event.target===el('advisorModal'))closeAdvisorModal();
  });
  el('advisorSearch').addEventListener('input',function(){
    renderAdvisorModalList(CONTROL_STATE.data?.agents||[]);
  });
  el('advisorModalList').addEventListener('click',async function(event){
    var del=event.target.closest('[data-delete-master]');
    if(del){
      try{await deleteMasterAdvisor(Number(del.dataset.deleteMaster))}catch(e){alert(e.message)}
      return;
    }

    var btn=event.target.closest('[data-add-existing]');
    if(!btn)return;
    try{
      await adminApi('/inspector/api/control/agents/copy',{
        method:'POST',
        body:JSON.stringify({targetGroup:CONTROL_STATE.activeTab,agentId:Number(btn.dataset.addExisting)})
      });
      closeAdvisorModal();
      await loadControl();await refreshAll();
    }catch(e){alert(e.message)}
  });


  document.addEventListener('keydown',function(event){
    if(event.key!=='Escape')return;
    if(!el('advisorModal').classList.contains('hidden')){
      event.preventDefault();
      closeAdvisorModal();
      return;
    }
    if(!el('controlModal').classList.contains('hidden')){
      event.preventDefault();
      el('controlModal').classList.add('hidden');
    }
  });

  if(token())refreshAll();
}
var CONTROL_STATE={data:null,activeTab:'weekday',search:'',dirty:{}};

function otherGroupActions(sourceGroup){
  return ['weekday','saturday','sunday'].filter(function(g){return g!==sourceGroup}).map(function(g){
    return '<button data-menu-move="'+g+'">Mover a '+g.toUpperCase()+'</button>'+
           '<button data-menu-copy="'+g+'">Copiar a '+g.toUpperCase()+'</button>';
  }).join('');
}

function filteredAgentsForActiveTab(){
  var groups=CONTROL_STATE.data?.groups||{};
  var agents=groups[CONTROL_STATE.activeTab]||[];
  var q=(CONTROL_STATE.search||'').trim().toLowerCase();
  if(!q)return agents;
  return agents.filter(function(a){
    return String(a.name||'').toLowerCase().includes(q)||String(a.id||'').includes(q);
  });
}

function renderActiveRotation(){
  if(!CONTROL_STATE.data)return;
  var groups=CONTROL_STATE.data.groups||{};
  var rotations=CONTROL_STATE.data.rotations||{};
  var group=CONTROL_STATE.activeTab;
  var agents=filteredAgentsForActiveTab();
  var allAgents=groups[group]||[];
  var activeCount=allAgents.filter(function(a){return a.enabled!==false}).length;
  var inactiveCount=allAgents.length-activeCount;
  var rot=(rotations.groups||rotations||{})[group]||{};
  var nextName=rot.next?.name||rot.next_name||rot.next||'No informado';
  var lastName=rot.last?.name||rot.last_name||rot.last||'No informado';

  el('rotationContent').innerHTML=
    '<div class="rotation-summary">'+
      '<div><span>Total</span><b>'+allAgents.length+'</b></div>'+
      '<div><span>Activos</span><b>'+activeCount+'</b></div>'+
      '<div><span>Inactivos</span><b>'+inactiveCount+'</b></div>'+
      '<div><span>Siguiente</span><b>'+esc(String(nextName))+'</b></div>'+
      '<div><span>Último</span><b>'+esc(String(lastName))+'</b></div>'+
    '</div>'+
    '<div class="rotation-toolbar">'+
      '<input id="rotationSearch" placeholder="Buscar por nombre o ID…" value="'+esc(CONTROL_STATE.search||'')+'">'+
      '<button id="openAddAdvisor" class="primary-small">+ Agregar asesor</button>'+
      '<button id="saveActiveRotation" class="primary-small">'+(CONTROL_STATE.dirty[group]?'Guardar cambios *':'Guardar cambios')+'</button>'+
    '</div>'+
    '<div id="sortableAgents" class="dynamic-agent-list">'+
      (agents.length?agents.map(function(a){
        return '<div class="dynamic-agent-row" draggable="true" data-agent-id="'+a.id+'">'+
          '<div class="drag-handle" title="Arrastrar">☰</div>'+
          '<div class="agent-main"><b>'+esc(a.name)+'</b><small>#'+a.id+'</small></div>'+
          '<label class="status-toggle"><input type="checkbox" data-toggle-active '+(a.enabled!==false?'checked':'')+'><span>'+(a.enabled!==false?'Activo':'Inactivo')+'</span></label>'+
          '<button class="kebab" data-agent-menu title="Acciones">⋮</button>'+
          '<div class="agent-menu hidden">'+
             otherGroupActions(group)+
             '<button data-toggle-via-menu="'+(a.enabled!==false?'disable':'enable')+'">'+(a.enabled!==false?'Desactivar':'Activar')+'</button>'+
             '<button class="menu-danger" data-remove-from-group>Quitar del turno</button>'+
          '</div>'+
        '</div>';
      }).join(''):'<div class="empty compact">No hay asesores que coincidan con la búsqueda.</div>')+
    '</div>';
}

function renderExceptionsView(){
  var exceptions=CONTROL_STATE.data?.exceptions||{};
  el('opsView').innerHTML=
    '<div class="secondary-view">'+
      '<div class="section-head"><div><h3>Excepciones por fecha</h3><small>Usa una rotación especial para una fecha concreta.</small></div></div>'+
      '<div class="exception-create">'+
        '<input id="exceptionDate" type="date">'+
        '<select id="exceptionBase"><option value="weekday">Copiar WEEKDAY</option><option value="saturday">Copiar SATURDAY</option><option value="sunday">Copiar SUNDAY</option></select>'+
        '<button id="createException" class="primary-small">Crear / reemplazar</button>'+
      '</div>'+
      '<div class="exception-cards">'+
        Object.keys(exceptions).sort().map(function(date){
          var enabled=(exceptions[date]||[]).filter(function(a){return a.enabled!==false});
          return '<div class="exception-card"><div><b>'+date+'</b><small>'+enabled.length+' asesores activos</small></div>'+
            '<div class="exception-agents">'+enabled.map(function(a){return '<span>'+esc(a.name)+'</span>'}).join('')+'</div>'+
            '<button data-delete-exception="'+date+'" class="danger-small">Eliminar</button></div>';
        }).join('')+
        (!Object.keys(exceptions).length?'<div class="empty compact">No hay excepciones configuradas.</div>':'')+
      '</div>'+
    '</div>';
}

function renderAuditView(){
  var audit=CONTROL_STATE.data?.audit||[];
  el('opsView').innerHTML=
    '<div class="secondary-view"><div class="section-head"><div><h3>Historial de cambios</h3><small>Movimientos y cambios hechos desde el Control Center.</small></div></div>'+
      '<div class="audit-list">'+
        (audit.length?audit.slice(0,100).map(function(a){
          var details=a.details||{};
          var info=details.group||details.targetGroup||details.date||details.sourceGroup||'';
          return '<div class="audit-item"><time>'+fmtDate(a.timestamp)+'</time><b>'+esc(a.type)+'</b><span>'+esc(String(info))+'</span></div>';
        }).join(''):'<div class="empty compact">Sin cambios registrados.</div>')+
      '</div></div>';
}

function renderControlShell(){
  var d=CONTROL_STATE.data||{},groups=d.groups||{},exceptions=d.exceptions||{};
  var tabs=['weekday','saturday','sunday'];
  el('controlBody').innerHTML=
    '<div class="ops-tabs">'+
      tabs.map(function(g){
        var count=(groups[g]||[]).filter(function(a){return a.enabled!==false}).length;
        return '<button class="ops-tab '+(CONTROL_STATE.activeTab===g?'active':'')+'" data-ops-tab="'+g+'">'+g.toUpperCase()+' <span>'+count+'</span></button>';
      }).join('')+
      '<button class="ops-tab '+(CONTROL_STATE.activeTab==='exceptions'?'active':'')+'" data-ops-tab="exceptions">EXCEPCIONES <span>'+Object.keys(exceptions).length+'</span></button>'+
      '<button class="ops-tab '+(CONTROL_STATE.activeTab==='audit'?'active':'')+'" data-ops-tab="audit">HISTORIAL</button>'+
    '</div>'+
    '<div id="opsView"></div>';

  if(['weekday','saturday','sunday'].includes(CONTROL_STATE.activeTab)){
    el('opsView').innerHTML='<div id="rotationContent"></div>';
    renderActiveRotation();
  }else if(CONTROL_STATE.activeTab==='exceptions'){
    renderExceptionsView();
  }else{
    renderAuditView();
  }
}

function renderControl(d){
  CONTROL_STATE.data=d;
  renderControlShell();
}

function currentGroupAgents(){
  return CONTROL_STATE.data?.groups?.[CONTROL_STATE.activeTab]||[];
}

function markDirty(){
  if(['weekday','saturday','sunday'].includes(CONTROL_STATE.activeTab)){
    CONTROL_STATE.dirty[CONTROL_STATE.activeTab]=true;
  }
}

async function saveCurrentRotation(){
  var group=CONTROL_STATE.activeTab;
  if(!['weekday','saturday','sunday'].includes(group))return;
  await adminApi('/inspector/api/control/rotations/'+group,{
    method:'PUT',
    body:JSON.stringify({agents:currentGroupAgents()})
  });
  CONTROL_STATE.dirty[group]=false;
  await loadControl();
  await refreshAll();
}

async function dynamicMove(agentId,targetGroup){
  var sourceGroup=CONTROL_STATE.activeTab;
  if(!confirm('¿Mover este asesor de '+sourceGroup.toUpperCase()+' a '+targetGroup.toUpperCase()+'?'))return;
  await adminApi('/inspector/api/control/agents/move',{
    method:'POST',
    body:JSON.stringify({sourceGroup:sourceGroup,targetGroup:targetGroup,agentId:Number(agentId)})
  });
  await loadControl();await refreshAll();
}

async function removeFromCurrentGroup(agentId){
  var group=CONTROL_STATE.activeTab;
  var agent=currentGroupAgents().find(function(a){return Number(a.id)===Number(agentId)});
  if(!agent)return;
  if(!confirm('¿Quitar a '+agent.name+' de '+group.toUpperCase()+'?\\n\\nSeguirá disponible en el catálogo para volver a agregarlo después.'))return;
  await adminApi('/inspector/api/control/agents/remove',{
    method:'POST',
    body:JSON.stringify({group:group,agentId:Number(agentId)})
  });
  await loadControl();await refreshAll();
}

async function deleteMasterAdvisor(agentId){
  var agent=(CONTROL_STATE.data?.agents||[]).find(function(a){return Number(a.id)===Number(agentId)});
  var name=agent?.name||('ID '+agentId);
  if(!confirm('¿Eliminar a '+name+' del catálogo maestro?\\n\\nSolo será posible si ya no pertenece a ningún turno ni excepción.'))return;
  await adminApi('/inspector/api/control/agents/'+Number(agentId),{method:'DELETE'});
  await loadControl();await refreshAll();
  renderAdvisorModalList(CONTROL_STATE.data?.agents||[]);
}

async function dynamicCopy(agentId,targetGroup){
  await adminApi('/inspector/api/control/agents/copy',{
    method:'POST',
    body:JSON.stringify({sourceGroup:CONTROL_STATE.activeTab,targetGroup:targetGroup,agentId:Number(agentId)})
  });
  await loadControl();await refreshAll();
}

function openAddAdvisorModal(){
  var agents=CONTROL_STATE.data?.agents||[];
  el('controlModal').classList.add('modal-underlay');
  el('advisorModal').classList.remove('hidden');
  requestAnimationFrame(function(){
    el('advisorSearch').value='';
    el('advisorSearch').focus();
    renderAdvisorModalList(agents);
  });
}
function closeAdvisorModal(){
  el('advisorModal').classList.add('hidden');
  el('controlModal').classList.remove('modal-underlay');
}

async function createAdvisorFromModal(){
  var id=Number(el('advisorNewId')?.value);
  var name=(el('advisorNewName')?.value||'').trim();
  if(!Number.isFinite(id)||id<=0) return alert('Introduce un ID válido de Chatwoot');
  if(name.length<2) return alert('Introduce el nombre del asesor');
  await adminApi('/inspector/api/control/agents',{
    method:'POST',
    body:JSON.stringify({id:id,name:name})
  });
  await loadControl();
  renderAdvisorModalList(CONTROL_STATE.data?.agents||[]);
  if(el('advisorNewId')) el('advisorNewId').value='';
  if(el('advisorNewName')) el('advisorNewName').value='';
}

function renderAdvisorModalList(agents){
  var q=(el('advisorSearch').value||'').trim().toLowerCase();
  var filtered=(agents||[]).filter(function(a){
    return !q||String(a.name||'').toLowerCase().includes(q)||String(a.id).includes(q);
  });
  el('advisorModalList').innerHTML=filtered.map(function(a){
    return '<div class="advisor-pick-row"><div><b>'+esc(a.name)+'</b><small>#'+a.id+'</small></div>'+
      '<div class="advisor-pick-actions">'+
        '<button data-add-existing="'+a.id+'">Agregar a '+CONTROL_STATE.activeTab.toUpperCase()+'</button>'+
        '<button class="danger-outline" data-delete-master="'+a.id+'">Eliminar</button>'+
      '</div></div>';
  }).join('')||'<div class="empty compact">Sin resultados.</div>';
}

async function loadControl(){
  try{
    var saved=sessionStorage.getItem(ADMIN_KEY)||'';if(saved&&!el('adminToken').value)el('adminToken').value=saved;
    if(!adminToken())throw new Error('Introduce INSPECTOR_ADMIN_TOKEN');
    var d=await api('/inspector/api/control/rotations');renderControl(d);
  }catch(e){el('controlBody').innerHTML='<div class="alert error">'+esc(e.message)+'</div>'}
}
async function saveGroup(group){
  try{
    await adminApi('/inspector/api/control/rotations/'+group,{method:'PUT',body:JSON.stringify({agents:agentsFromEditor(group)})});
    await loadControl();await refreshAll();
  }catch(e){alert(e.message)}
}


async function addMasterAgent(){
  var id=Number(el('newAgentId')?.value);
  var name=(el('newAgentName')?.value||'').trim();
  if(!Number.isFinite(id)||id<=0)return alert('Introduce un ID válido de Chatwoot');
  if(name.length<2)return alert('Introduce el nombre del asesor');
  await adminApi('/inspector/api/control/agents',{method:'POST',body:JSON.stringify({id:id,name:name})});
  await loadControl();
}
async function moveAgentBetweenGroups(row){
  var sourceGroup=row.closest('.control-group').dataset.group;
  var targetGroup=row.querySelector('[data-target-group]').value;
  var agentId=Number(row.dataset.agentId);
  if(sourceGroup===targetGroup)return;
  if(!confirm('¿Mover este asesor de '+sourceGroup.toUpperCase()+' a '+targetGroup.toUpperCase()+'?'))return;
  await adminApi('/inspector/api/control/agents/move',{
    method:'POST',
    body:JSON.stringify({sourceGroup:sourceGroup,targetGroup:targetGroup,agentId:agentId})
  });
  await loadControl();await refreshAll();
}
async function copyAgentBetweenGroups(row){
  var sourceGroup=row.closest('.control-group').dataset.group;
  var targetGroup=row.querySelector('[data-target-group]').value;
  var agentId=Number(row.dataset.agentId);
  await adminApi('/inspector/api/control/agents/copy',{
    method:'POST',
    body:JSON.stringify({sourceGroup:sourceGroup,targetGroup:targetGroup,agentId:agentId})
  });
  await loadControl();await refreshAll();
}
async function copyMasterAgent(button){
  var agentId=Number(button.dataset.masterCopy);
  var targetGroup=button.closest('.master-agent').querySelector('[data-master-target]').value;
  await adminApi('/inspector/api/control/agents/copy',{
    method:'POST',
    body:JSON.stringify({targetGroup:targetGroup,agentId:agentId})
  });
  await loadControl();await refreshAll();
}


var ANALYTICS_STATE={loaded:false};
function aDate(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function setAnalyticsRange(kind){
  var n=new Date(),to=aDate(n),from=to;
  if(kind==="7"){var d=new Date(n);d.setDate(d.getDate()-6);from=aDate(d)}
  if(kind==="30"){var d2=new Date(n);d2.setDate(d2.getDate()-29);from=aDate(d2)}
  if(kind==="month")from=aDate(new Date(n.getFullYear(),n.getMonth(),1));
  el("analyticsFrom").value=from;el("analyticsTo").value=to;
  document.querySelectorAll("[data-analytics-range]").forEach(function(b){b.classList.toggle("active",b.dataset.analyticsRange===kind)});
  loadAnalytics();
}
function aDelta(v){if(v===null||v===undefined)return '<span class="delta neutral">s/d</span>';var c=v>0?"up":v<0?"down":"neutral";return '<span class="delta '+c+'">'+(v>0?"+":"")+v+'%</span>'}
function aTable(h,rows){return '<div class="analytics-table-wrap"><table class="analytics-table"><thead><tr>'+h.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(String(c??""))+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+h.length+'">Sin datos.</td></tr>')+'</tbody></table></div>'}
function aBars(items,labelKey,valueKey){
  var max=Math.max(1,...items.map(x=>Number(x[valueKey]||0)));
  return items.map(function(x){var v=Number(x[valueKey]||0),w=Math.max(2,Math.round(v/max*100));return '<div class="bar-row"><span>'+esc(String(x[labelKey]))+'</span><div class="bar-track"><i style="width:'+w+'%"></i></div><b>'+v+'</b></div>'}).join('');
}
function renderAnalytics(d){
  var k=d.kpis||{},p=d.projection||{},c=d.comparison||{};
  el("analyticsContent").innerHTML=
  '<div class="analytics-kpis">'+
    '<div class="metric-card"><span>Conversaciones</span><b>'+k.conversations+'</b>'+aDelta(c.conversations?.delta_pct)+'</div>'+
    '<div class="metric-card"><span>Handoffs</span><b>'+k.handoffs+'</b><small>'+k.handoff_rate+'%</small>'+aDelta(c.handoffs?.delta_pct)+'</div>'+
    '<div class="metric-card"><span>Alertas</span><b>'+k.alerts+'</b><small>'+k.alerts_per_100+' /100</small>'+aDelta(c.alerts?.delta_pct)+'</div>'+
    '<div class="metric-card"><span>Objeciones precio</span><b>'+k.price_objections+'</b></div>'+
    '<div class="metric-card"><span>Humano solicitado</span><b>'+k.human_requests+'</b></div>'+
    '<div class="metric-card"><span>CURP recibidas</span><b>'+k.curp_received+'</b></div>'+
  '</div>'+
  '<div class="analytics-grid two">'+
    '<section class="analytics-card"><div class="section-title"><b>Conversaciones por día</b><small>Volumen del periodo</small></div><div class="bars">'+aBars(d.daily||[],"date","count")+'</div></section>'+
    '<section class="analytics-card"><div class="section-title"><b>Actividad por hora</b><small>Distribución horaria</small></div><div class="bars compact-bars">'+aBars((d.hourly||[]).map(x=>({label:String(x.hour).padStart(2,"0")+":00",count:x.count})),"label","count")+'</div></section>'+
  '</div>'+
  '<div class="analytics-grid two">'+
    '<section class="analytics-card"><div class="section-title"><b>Intenciones</b></div>'+aTable(["Intención","Casos","%"],(d.intents||[]).map(x=>[x.intent,x.count,x.share+"%"]))+'</section>'+
    '<section class="analytics-card"><div class="section-title"><b>Embudo</b></div>'+aTable(["Etapa","Casos","%"],(d.funnel||[]).map(x=>[x.stage,x.count,x.rate+"%"]))+'</section>'+
  '</div>'+
  '<div class="analytics-grid one"><section class="analytics-card"><div class="section-title"><b>Distribución por asesor</b></div>'+aTable(["Asesor","Chats","Handoffs","Tasa","Alertas","Precio"],(d.advisors||[]).map(x=>[x.advisor,x.conversations,x.handoffs,x.handoff_rate+"%",x.alerts,x.price_objections]))+'</section></div>'+
  '<div class="analytics-grid two">'+
    '<section class="analytics-card"><div class="section-title"><b>Calidad por versión</b></div>'+aTable(["Versión","Chats","Alertas","Alertas %","Handoff %"],(d.versions||[]).map(x=>[x.version,x.conversations,x.alerts,x.alert_rate+"%",x.handoff_rate+"%"]))+'</section>'+
    '<section class="analytics-card projection-card"><div class="section-title"><b>Proyección mensual</b><small>'+esc(p.methodology||"")+'</small></div><div class="projection-current"><span>Acumulado</span><b>'+Number(p.current||0)+'</b><small>'+Number(p.remaining_days||0)+' días restantes · '+Number(p.daily_average||0)+'/día</small></div><div class="projection-scenarios"><div><span>Conservador</span><b>'+Number(p.conservative||0)+'</b><small>Handoffs ≈ '+Number(p.projected_handoffs?.conservative||0)+'</small></div><div class="base"><span>Base</span><b>'+Number(p.base||0)+'</b><small>Handoffs ≈ '+Number(p.projected_handoffs?.base||0)+'</small></div><div><span>Alto</span><b>'+Number(p.high||0)+'</b><small>Handoffs ≈ '+Number(p.projected_handoffs?.high||0)+'</small></div></div><div class="projection-note">Proyección estadística; no garantiza resultados.</div></section>'+
  '</div>';
}
async function loadAnalytics(){
  if(!token())return;
  var q=new URLSearchParams();if(el("analyticsFrom").value)q.set("from",el("analyticsFrom").value);if(el("analyticsTo").value)q.set("to",el("analyticsTo").value);
  el("analyticsContent").innerHTML='<div class="empty">Calculando métricas…</div>';
  try{var d=await api("/inspector/api/analytics?"+q.toString());ANALYTICS_STATE.loaded=true;renderAnalytics(d)}catch(e){el("analyticsContent").innerHTML='<div class="alert error">'+esc(e.message)+'</div>'}
}
function switchMainTab(tab){
  document.querySelectorAll("[data-main-tab]").forEach(b=>b.classList.toggle("active",b.dataset.mainTab===tab));
  el("analyticsView").classList.toggle("hidden",tab!=="analytics");
  el("conversationsView").classList.toggle("hidden",tab==="analytics");
  if(tab==="analytics"&&!ANALYTICS_STATE.loaded)setAnalyticsRange("30");
}

function bindUi(){
  restoreToken();
  document.querySelectorAll('[data-main-tab]').forEach(function(b){b.addEventListener('click',function(){switchMainTab(b.dataset.mainTab)})});
  el('mainControlBtn').addEventListener('click',function(){el('controlModal').classList.remove('hidden');var s=sessionStorage.getItem(ADMIN_KEY)||'';if(s)el('adminToken').value=s;if(s)loadControl()});
  document.querySelectorAll('[data-analytics-range]').forEach(function(b){b.addEventListener('click',function(){setAnalyticsRange(b.dataset.analyticsRange)})});
  el('analyticsRefresh').addEventListener('click',loadAnalytics);

  el('refreshBtn').addEventListener('click',function(){
    if(!token()){setTokenStatus('Introduce el token','warn');return}
    refreshAll();
  });

  el('alertBtn').addEventListener('click',toggleAlerts);

  el('token').addEventListener('keydown',function(event){
    if(event.key==='Enter'){
      event.preventDefault();
      if(!token()){setTokenStatus('Introduce el token','warn');return}
      refreshAll();
    }
  });

  el('token').addEventListener('input',function(){
    var value=el('token').value.trim();
    if(value)sessionStorage.setItem(TOKEN_KEY,value);
  });

  var debounce;
  ['search','intent','advisor','phase','temperature'].forEach(function(id){
    el(id).addEventListener(id==='search'?'input':'change',function(){
      if(!token())return;
      clearTimeout(debounce);
      debounce=setTimeout(loadList,180);
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

  // -------- Operations Control Center --------
  el('controlBtn').addEventListener('click',function(){
    el('controlModal').classList.remove('hidden');
    var saved=sessionStorage.getItem(ADMIN_KEY)||'';
    if(saved)el('adminToken').value=saved;
    if(saved)loadControl();
  });

  el('closeControl').addEventListener('click',function(event){
    event.preventDefault();
    el('controlModal').classList.add('hidden');
  });

  el('controlModal').addEventListener('click',function(event){
    if(event.target===el('controlModal'))el('controlModal').classList.add('hidden');
  });

  el('adminToken').addEventListener('keydown',function(event){
    if(event.key==='Enter'){
      event.preventDefault();
      loadControl();
    }
  });

  el('loadControl').addEventListener('click',loadControl);

  // Dynamic controls: tabs, menus, move/copy/remove, exceptions.
  el('controlBody').addEventListener('click',async function(event){
    var tab=event.target.closest('[data-ops-tab]');
    if(tab){
      CONTROL_STATE.activeTab=tab.dataset.opsTab;
      CONTROL_STATE.search='';
      renderControlShell();
      return;
    }

    if(event.target.id==='openAddAdvisor'){
      openAddAdvisorModal();
      return;
    }

    if(event.target.id==='saveActiveRotation'){
      try{await saveCurrentRotation()}catch(e){alert(e.message)}
      return;
    }

    var menuButton=event.target.closest('[data-agent-menu]');
    if(menuButton){
      var menu=menuButton.parentNode.querySelector('.agent-menu');
      document.querySelectorAll('.agent-menu').forEach(function(m){
        if(m!==menu)m.classList.add('hidden');
      });
      menu.classList.toggle('hidden');
      return;
    }

    var moveTo=event.target.closest('[data-menu-move]');
    if(moveTo){
      var row=moveTo.closest('.dynamic-agent-row');
      try{await dynamicMove(row.dataset.agentId,moveTo.dataset.menuMove)}catch(e){alert(e.message)}
      return;
    }

    var copyTo=event.target.closest('[data-menu-copy]');
    if(copyTo){
      var row2=copyTo.closest('.dynamic-agent-row');
      try{await dynamicCopy(row2.dataset.agentId,copyTo.dataset.menuCopy)}catch(e){alert(e.message)}
      return;
    }

    var removeBtn=event.target.closest('[data-remove-from-group]');
    if(removeBtn){
      var row3=removeBtn.closest('.dynamic-agent-row');
      try{await removeFromCurrentGroup(row3.dataset.agentId)}catch(e){alert(e.message)}
      return;
    }

    var toggleMenu=event.target.closest('[data-toggle-via-menu]');
    if(toggleMenu){
      var row4=toggleMenu.closest('.dynamic-agent-row');
      var agent=currentGroupAgents().find(function(a){
        return Number(a.id)===Number(row4.dataset.agentId);
      });
      if(agent){
        agent.enabled=toggleMenu.dataset.toggleViaMenu==='enable';
        markDirty();
        renderActiveRotation();
      }
      return;
    }

    var del=event.target.closest('[data-delete-exception]');
    if(del && confirm('¿Eliminar excepción '+del.dataset.deleteException+'?')){
      try{
        await adminApi('/inspector/api/control/exceptions/'+del.dataset.deleteException,{method:'DELETE'});
        await loadControl();await refreshAll();
      }catch(e){alert(e.message)}
      return;
    }

    if(event.target.id==='createException'){
      var date=el('exceptionDate').value;
      var base=el('exceptionBase').value;
      if(!date)return alert('Selecciona una fecha');
      try{
        var baseAgents=CONTROL_STATE.data.groups?.[base]||[];
        await adminApi('/inspector/api/control/exceptions/'+date,{
          method:'PUT',
          body:JSON.stringify({agents:baseAgents})
        });
        await loadControl();await refreshAll();
      }catch(e){alert(e.message)}
      return;
    }
  });

  // Search and active/inactive state.
  el('controlBody').addEventListener('input',function(event){
    if(event.target.id==='rotationSearch'){
      CONTROL_STATE.search=event.target.value;
      renderActiveRotation();
      var search=el('rotationSearch');
      if(search){
        search.focus();
        search.setSelectionRange(search.value.length,search.value.length);
      }
      return;
    }

    var toggle=event.target.closest('[data-toggle-active]');
    if(toggle){
      var row=toggle.closest('.dynamic-agent-row');
      var agent=currentGroupAgents().find(function(a){
        return Number(a.id)===Number(row.dataset.agentId);
      });
      if(agent){
        agent.enabled=toggle.checked;
        markDirty();
        renderActiveRotation();
      }
    }
  });

  // -------- Drag & Drop --------
  var dragId=null;

  el('controlBody').addEventListener('dragstart',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(!row)return;
    dragId=Number(row.dataset.agentId);
    row.classList.add('dragging');
    if(event.dataTransfer){
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',String(dragId));
    }
  });

  el('controlBody').addEventListener('dragend',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(row)row.classList.remove('dragging');
    document.querySelectorAll('.dynamic-agent-row').forEach(function(r){
      r.classList.remove('drag-over');
    });
    dragId=null;
  });

  el('controlBody').addEventListener('dragover',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(!row||dragId===null)return;
    event.preventDefault();
    row.classList.add('drag-over');
  });

  el('controlBody').addEventListener('dragleave',function(event){
    var row=event.target.closest('.dynamic-agent-row');
    if(row)row.classList.remove('drag-over');
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

    var moved=agents.splice(from,1)[0];
    agents.splice(to,0,moved);
    CONTROL_STATE.data.groups[CONTROL_STATE.activeTab]=agents;
    markDirty();
    renderActiveRotation();
    dragId=null;
  });

  // -------- Add Advisor modal --------
  el('closeAdvisorModal').addEventListener('click',function(event){
    event.preventDefault();
    event.stopPropagation();
    closeAdvisorModal();
  });

  el('advisorModal').addEventListener('click',function(event){
    if(event.target===el('advisorModal'))closeAdvisorModal();
  });

  el('advisorSearch').addEventListener('input',function(){
    renderAdvisorModalList(CONTROL_STATE.data?.agents||[]);
  });

  el('advisorModalList').addEventListener('click',async function(event){
    var del=event.target.closest('[data-delete-master]');
    if(del){
      try{await deleteMasterAdvisor(Number(del.dataset.deleteMaster))}catch(e){alert(e.message)}
      return;
    }

    var btn=event.target.closest('[data-add-existing]');
    if(btn){
      try{
        await adminApi('/inspector/api/control/agents/copy',{
          method:'POST',
          body:JSON.stringify({
            targetGroup:CONTROL_STATE.activeTab,
            agentId:Number(btn.dataset.addExisting)
          })
        });
        closeAdvisorModal();
        await loadControl();await refreshAll();
      }catch(e){alert(e.message)}
      return;
    }
  });

  // Manual new advisor form inside modal.
  el('advisorCreateBtn').addEventListener('click',async function(){
    try{await createAdvisorFromModal()}catch(e){alert(e.message)}
  });

  el('advisorNewName').addEventListener('keydown',async function(event){
    if(event.key==='Enter'){
      event.preventDefault();
      try{await createAdvisorFromModal()}catch(e){alert(e.message)}
    }
  });

  // Escape closes the top-most modal first.
  document.addEventListener('keydown',function(event){
    if(event.key!=='Escape')return;

    if(!el('advisorModal').classList.contains('hidden')){
      event.preventDefault();
      closeAdvisorModal();
      return;
    }

    if(!el('controlModal').classList.contains('hidden')){
      event.preventDefault();
      el('controlModal').classList.add('hidden');
    }
  });

  if(token())refreshAll();
}

document.addEventListener('DOMContentLoaded',bindUi);
