function arr(v){ return Array.isArray(v) ? v : []; }
function groupAgents(config, group, operationsConfig=null, date=new Date()){
  if(operationsConfig){
    const dateKey = new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:config?.ai?.timezone||"America/Mexico_City"}).format(date);
    return operationsConfig.agentsFor(group, dateKey, {activeOnly:false});
  }
  if(group === 'sunday') return arr(config?.handoff?.sundayAgents);
  if(group === 'saturday') return arr(config?.handoff?.saturdayAgents);
  return arr(config?.handoff?.weekdayAgents);
}

export function rotationOverview(config, handoffRotation, operationsConfig=null){
  const state = typeof handoffRotation?.snapshot === 'function' ? handoffRotation.snapshot() : { groups:{} };
  return ['weekday','saturday','sunday'].map(group => {
    const agents = groupAgents(config, group, operationsConfig);
    const current = state?.groups?.[group] || {};
    const nextIndex = agents.length ? Math.abs(Number(current.next_index || 0)) % agents.length : null;
    return {
      group,
      agents,
      nextIndex,
      nextAgent: nextIndex == null ? null : agents[nextIndex],
      lastAgentId: current.last_agent_id || null,
      lastAgentName: current.last_agent_name || null,
      lastConversationId: current.last_conversation_id || null,
      lastAssignedAt: current.last_assigned_at || null,
      lastReservedAgentId: current.last_reserved_agent_id || null,
      lastReservedAgentName: current.last_reserved_agent_name || null,
      lastReservedConversationId: current.last_reserved_conversation_id || null,
      lastReservedAt: current.last_reserved_at || null,
      totalReservations: Number(current.total_reservations || 0),
      completedAssignments: Number(current.completed_assignments || 0),
    };
  });
}

export function handoffMetrics(items=[]){
  const completed = items.filter(x => x.handoffStatus === 'completed');
  const pending = items.filter(x => x.handoffStatus === 'pending');
  const failed = items.filter(x => x.handoffStatus === 'failed');
  const byAgent = {};
  for(const item of completed){
    const key = item.handoffAgent || `ID ${item.handoffAgentId || '?'}`;
    byAgent[key] = (byAgent[key] || 0) + 1;
  }
  const total = completed.length;
  return {
    completed: total,
    pending: pending.length,
    failed: failed.length,
    byAgent: Object.entries(byAgent).map(([name,count]) => ({ name, count, percentage: total ? Math.round(count*1000/total)/10 : 0 })).sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name)),
  };
}

export function conversationProgress(memory={}){
  const handoffDone = memory?.handoff?.status === 'completed';
  const hasSummary = Boolean(memory?.handoff?.summary_created_at) || handoffDone || ['transferencia','validacion'].includes(memory?.flujo?.fase);
  const dataReady = Boolean(memory?.nombre || memory?.edad != null || memory?.actividad || memory?.tiene_imss != null || memory?.necesidad_principal);
  return [
    { id:'entrada', label:'Entrada', done:true },
    { id:'diagnostico', label:'Diagnóstico', done:Boolean(memory?.intent?.id || memory?.necesidad_principal) },
    { id:'datos', label:'Datos', done:dataReady },
    { id:'validacion', label:'Validación', done:Boolean(memory?.curp_recibida || memory?.nss_recibido || memory?.slots?.curp_estado || memory?.slots?.nss_estado || hasSummary) },
    { id:'resumen', label:'Resumen', done:hasSummary },
    { id:'handoff', label:'Handoff', done:handoffDone },
  ];
}

export function slotStates(memory={}){
  const resolved = new Set(arr(memory?.resolved_questions));
  const state = (key,value,unavailable=false,inferred=false) => ({ key, value, status: unavailable ? 'no_disponible' : resolved.has(key) || value !== null && value !== undefined && value !== '' ? (inferred ? 'inferido' : 'confirmado') : 'pendiente' });
  return [
    state('nombre', memory.nombre),
    state('edad', memory.edad),
    state('actividad', memory.actividad || memory.tipo_trabajo),
    state('tiene_imss', memory.tiene_imss),
    state('curp', memory.curp_valor || (memory.curp_recibida ? 'Recibida' : null), memory?.slots?.curp_disponible === false),
    state('nss', memory.nss_recibido ? 'Recibido' : null, memory?.slots?.nss_disponible === false),
    state('necesidad', memory.necesidad_principal, false, Boolean(memory.necesidad_principal && !resolved.has('necesidad_principal'))),
  ];
}
