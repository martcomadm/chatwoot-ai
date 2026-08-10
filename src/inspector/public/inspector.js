var active=null,current=null,alertsOnly=false;
var TOKEN_KEY='martcom_ai_inspector_token';
function el(id){return document.getElementById(id)}function esc(v){return String(v==null?'No informado':v).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}function token(){
  var value=el('token').value.trim();
  if(value){sessionStorage.setItem(TOKEN_KEY,value)}
  return value;
}
function restoreToken(){
  var saved=sessionStorage.getItem(TOKEN_KEY)||'';
  if(saved) el('token').value=saved;
}
function pct(v){return v==null?'No informado':Math.round(Number(v)*100)+'%'}
async function api(path){var r=await fetch(path,{headers:{'x-inspector-token':token()}});if(!r.ok){var d=await r.json().catch(function(){return {}});throw new Error(d.error||('HTTP '+r.status))}return r.json()}
function row(k,v){return '<div class="row"><div class="key">'+esc(k)+'</div><div>'+esc(v)+'</div></div>'}
function metric(label,value){return '<div class="metric"><small>'+esc(label)+'</small><b>'+esc(value)+'</b></div>'}
function fillSelect(id,items){var s=el(id),v=s.value;s.innerHTML='<option value="">'+({intent:'Todas las intenciones',advisor:'Todos los asesores',phase:'Todas las fases',temperature:'Todas las temperaturas'}[id]||'Todos')+'</option>'+items.map(function(x){return '<option value="'+esc(x)+'">'+esc(x)+'</option>'}).join('');s.value=v}
function queryString(){var p=new URLSearchParams();if(el('search').value.trim())p.set('search',el('search').value.trim());['intent','advisor','phase','temperature'].forEach(function(k){if(el(k).value)p.set(k,el(k).value)});if(alertsOnly)p.set('alerts','1');return p.toString()}
async function loadHealth(){try{var d=await api('/inspector/api/health');el('health').innerHTML='<span class="'+(d.overall==='ok'?'ok':d.overall==='warning'?'warn':'bad')+'">● '+esc(d.overall==='ok'?'Sistema activo':d.overall==='warning'?'Con avisos':'Requiere atención')+'</span> · '+esc(d.version)}catch(e){el('health').innerHTML='<span class="bad">● Sin acceso</span>'}}
async function loadDashboard(){try{var d=await api('/inspector/api/dashboard');el('dashboard').innerHTML=metric('Memorias',d.stats.total)+metric('Activas 24 h',d.stats.recent24h)+metric('Transferidas',d.stats.transferred)+metric('Clientes calientes',d.stats.hot)+metric('Con alertas',d.stats.withAlerts)+metric('Errores 24 h',d.stats.errors24h);fillSelect('intent',d.filters.intents);fillSelect('advisor',d.filters.advisors);fillSelect('phase',d.filters.phases);fillSelect('temperature',d.filters.temperatures)}catch(e){el('dashboard').innerHTML=metric('Inspector',e.message)}}
async function loadList(){try{var d=await api('/inspector/api/conversations?'+queryString());el('count').textContent=d.items.length+' resultado(s)';if(!d.items.length){el('list').innerHTML='<div class="empty">Sin resultados.</div>';return}el('list').innerHTML=d.items.map(function(x){var badges='<div class="badges">'+(x.intent?'<span class="badge">'+esc(x.intent)+'</span>':'')+(x.alertCount?'<span class="badge '+(x.hasErrorAlert?'error':'warn')+'">'+x.alertCount+' alerta(s)</span>':'')+'</div>';return '<div class="item '+(x.id===active?'active':'')+'" data-conversation-id="'+x.id+'"><strong>#'+x.id+' · '+esc(x.nombre||'Sin nombre')+'</strong><small>'+esc(x.fase||'Sin fase')+' · '+esc(x.actualizado_en||'')+'</small>'+badges+'</div>'}).join('')}catch(e){el('list').innerHTML='<div class="empty bad">'+esc(e.message)+'</div>'}}
function eventClass(e){if(['openai_error','processor_error','chatwoot_write_error'].includes(e.type))return 'error';if(['chatwoot_read_fallback','quality_fallback','quality_repair'].includes(e.type))return 'warning';return ''}
function eventLabel(t){var m={buffer_flush:'Buffer procesado',chatwoot_read_fallback:'Fallback Chatwoot',intent_classified:'Intención clasificada',decision_state:'Planner',memory_updated:'Memoria actualizada',quality_checked:'Control de calidad',quality_repair:'Respuesta reparada',quality_fallback:'Fallback de calidad',ai_reply_sent:'Respuesta enviada',handoff:'Transferencia',ignored_out_of_schedule:'Fuera de horario',ignored_no_usable_messages:'Sin mensaje utilizable'};return m[t]||t}
function timelineHtml(events){if(!events.length)return '<div class="empty">Sin eventos registrados.</div>';return events.map(function(e){return '<div class="event '+eventClass(e)+'"><time>'+esc(new Date(e.timestamp).toLocaleString())+'</time><strong>'+esc(eventLabel(e.type))+'</strong><code>'+esc(JSON.stringify(e.details||{}))+'</code></div>'}).join('')}
function alertsHtml(alerts){if(!alerts.length)return '<div class="empty">No se detectaron alertas de calidad.</div>';return alerts.map(function(a){return '<div class="alert '+(a.level==='error'?'error':'')+'"><b>'+esc(a.code)+'</b><br>'+esc(a.message)+'</div>'}).join('')}
function diagnosticsHtml(d){return '<div class="panel"><h3>Diagnóstico del sistema</h3><div class="inner">'+d.components.map(function(c){return '<div class="diagnostic"><b>'+esc(c.name)+'</b><span class="status '+esc(c.status)+'">'+esc(c.status.toUpperCase())+'</span><span>'+esc(c.detail)+'</span></div>'}).join('')+'</div></div>'}
function tabButton(id,label){return '<button type="button" class="tab '+(id==='summary'?'active':'')+'" data-tab="'+id+'">'+label+'</button>'}
function renderConversation(){var d=current,m=d.memory||{},f=m.flujo||{},s=m.ventas||{},i=m.intent||{};el('conversationTitle').textContent='#'+d.conversationId;var tabs='<div class="tabs">'+tabButton('summary','Resumen')+tabButton('intentTab','Intención')+tabButton('planner','Planner / ¿Por qué?')+tabButton('timeline','Timeline')+tabButton('alerts','Alertas')+tabButton('memory','Memoria')+tabButton('diagnostics','Diagnóstico')+'</div>';
var summary='<div id="tab-summary" class="tabpane"><div class="stats">'+['Intención|'+(i.label||i.id),'Confianza|'+pct(i.confidence),'Fase|'+f.fase,'Siguiente paso|'+f.siguiente_paso,'Asesor|'+m.asesor_presentacion].map(function(x){var a=x.split('|');return '<div class="stat"><small>'+esc(a[0])+'</small><b>'+esc(a.slice(1).join('|'))+'</b></div>'}).join('')+'</div><div class="cols"><div class="panel"><h3>Perfil del cliente</h3><div class="inner">'+row('Nombre',m.nombre)+row('Edad',m.edad)+row('Actividad',m.actividad)+row('IMSS actual',m.tiene_imss===true?'Sí':m.tiene_imss===false?'No':'No informado')+row('Necesidad',m.necesidad_principal)+row('Última cotización',m.ultima_cotizacion)+row('AFORE',m.afore_actual)+'</div></div><div class="panel"><h3>Estado comercial</h3><div class="inner">'+row('Plan recomendado',s.plan_recomendado)+row('Temperatura',s.temperatura)+row('Problema',s.problema)+row('CURP recibida',m.curp_recibida?'Sí':'No')+row('NSS recibido',m.nss_recibido?'Sí':'No')+row('Contradicciones',(m.contradicciones||[]).length)+'</div></div></div></div>';
var intent='<div id="tab-intentTab" class="tabpane" style="display:none"><div class="cols"><div class="panel"><h3>Clasificación</h3><div class="inner">'+row('ID',i.id)+row('Etiqueta',i.label)+row('Familia',i.family)+row('Prioridad',i.priority)+row('Confianza',pct(i.confidence))+row('Fuente',i.source)+row('Evidencia',(i.evidence||[]).join(' · '))+row('Alternativas',(i.alternatives||[]).map(function(a){return typeof a==='string'?a:(a.id||a.label||JSON.stringify(a))}).join(' · '))+'</div></div><div class="panel"><h3>Flujo seleccionado</h3><div class="inner">'+row('Fase',f.fase)+row('Siguiente paso',f.siguiente_paso)+row('Última pregunta',m.ultima_pregunta)+row('Preguntas realizadas',(m.preguntas_realizadas||[]).join(' → '))+'</div></div></div></div>';
var why='<div id="tab-planner" class="tabpane" style="display:none"><div class="why"><b>Explicación auditable de la decisión</b><ul>'+d.explanation.reasons.map(function(r){return '<li>'+esc(r)+'</li>'}).join('')+'</ul><div><b>Acción:</b> '+esc(d.explanation.action)+' &nbsp; <b>Dato objetivo:</b> '+esc(d.explanation.questionKey)+'</div></div></div>';
var timeline='<div id="tab-timeline" class="tabpane" style="display:none"><div class="timeline">'+timelineHtml(d.timeline)+'</div></div>';
var alerts='<div id="tab-alerts" class="tabpane" style="display:none">'+alertsHtml(d.alerts)+'</div>';
var memory='<div id="tab-memory" class="tabpane" style="display:none"><pre>'+esc(JSON.stringify(m,null,2))+'</pre></div>';
var diagnostics='<div id="tab-diagnostics" class="tabpane" style="display:none">'+diagnosticsHtml(d.diagnostics)+'</div>';
el('content').innerHTML=tabs+summary+intent+why+timeline+alerts+memory+diagnostics}
function switchTab(id){document.querySelectorAll('.tabpane').forEach(function(p){p.style.display='none'});document.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')});el('tab-'+id).style.display='block';document.querySelector('[data-tab="'+id+'"]').classList.add('active')}
async function show(id){active=id;await loadList();el('content').innerHTML='<div class="empty">Cargando…</div>';try{current=await api('/inspector/api/conversations/'+id);renderConversation()}catch(e){el('content').innerHTML='<div class="empty bad">'+esc(e.message)+'</div>'}}
function toggleAlerts(){alertsOnly=!alertsOnly;el('alertBtn').textContent='Solo alertas: '+(alertsOnly?'SÍ':'NO');loadList()}
async function refreshAll(){await loadHealth();await loadDashboard();await loadList();if(active)await show(active)}

function setTokenStatus(text,kind){
  el('health').innerHTML='<span class="'+(kind||'warn')+'">● '+esc(text)+'</span>';
}
function bindUi(){
  restoreToken();

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
    if(value) sessionStorage.setItem(TOKEN_KEY,value);
  });

  var debounce;
  ['search','intent','advisor','phase','temperature'].forEach(function(id){
    el(id).addEventListener(id==='search'?'input':'change',function(){
      if(!token()) return;
      clearTimeout(debounce);
      debounce=setTimeout(loadList,180);
    });
  });

  el('list').addEventListener('click',function(event){
    var item=event.target.closest('[data-conversation-id]');
    if(item) show(Number(item.dataset.conversationId));
  });

  el('content').addEventListener('click',function(event){
    var tab=event.target.closest('[data-tab]');
    if(tab) switchTab(tab.dataset.tab);
  });

  if(token()) refreshAll();
}
document.addEventListener('DOMContentLoaded',bindUi);

