import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationProgress, handoffMetrics, rotationOverview, slotStates } from '../src/inspector/operations-service.js';

test('muestra siguiente asesor sin modificar la rotacion', () => {
  const config={handoff:{weekdayAgents:[{id:25,name:'Elizabeth'},{id:20,name:'Jonathan'}],saturdayAgents:[],sundayAgents:[]}};
  const store={snapshot:()=>({groups:{weekday:{next_index:1,completed_assignments:3,last_agent_id:25,last_agent_name:'Elizabeth'}}})};
  const r=rotationOverview(config,store)[0];
  assert.equal(r.nextAgent.id,20);
  assert.equal(r.completedAssignments,3);
});

test('calcula distribucion de handoffs',()=>{
  const m=handoffMetrics([{handoffStatus:'completed',handoffAgent:'Elizabeth'},{handoffStatus:'completed',handoffAgent:'Elizabeth'},{handoffStatus:'completed',handoffAgent:'Jonathan'},{handoffStatus:'pending'}]);
  assert.equal(m.completed,3); assert.equal(m.pending,1); assert.equal(m.byAgent[0].count,2);
});

test('marca slot no disponible',()=>{
  const slots=slotStates({slots:{curp_disponible:false},resolved_questions:[]});
  assert.equal(slots.find(x=>x.key==='curp').status,'no_disponible');
});

test('embudo completa handoff',()=>{
  const p=conversationProgress({intent:{id:'SERVICIO'},nombre:'Ana',curp_recibida:true,flujo:{fase:'transferencia'},handoff:{status:'completed'}});
  assert.equal(p.at(-1).done,true);
});
