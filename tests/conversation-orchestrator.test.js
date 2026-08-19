import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAge } from '../src/semantic/age-extractor.js';
import { normalizeCurp } from '../src/semantic/curp-normalizer.js';
import { orchestrateConversation } from '../src/orchestrator/conversation-orchestrator.js';
import { extractConversationFacts } from '../src/orchestrator/fact-extractor.js';
import { resolveSubject } from '../src/semantic/subject-resolver.js';
import { resolveAnswer } from '../src/semantic/answer-resolver.js';
import { classifyIntent } from '../src/intent/intent-engine.js';
import { planNext } from '../src/sales/sales-engine.js';

test('edad distingue fecha de edad',()=>{
  assert.equal(extractAge('30 de julio cumplí 71 años').value,71);
});

test('curp con espacios se normaliza',()=>{
  const result=normalizeCurp('ZAGI 671224 MN L M RR 02');
  assert.equal(result.value,'ZAGI671224MNLMRR02');
});

test('direct answer detecta que ofrecen',()=>{
  assert.equal(orchestrateConversation('Que ofrecen').directRequest.type,'services');
});

test('direct answer detecta confianza y ubicación',()=>{
  assert.equal(orchestrateConversation('Dónde se encuentran y cuál es su razón social porque hay muchos estafadores').directRequest.type,'trust');
});

test('proveedor gana intención comercial',()=>{
  assert.equal(classifyIntent('Quiero vender las afiliaciones').id,'PROVEEDOR');
});

test('subject resolver detecta caso para padre',()=>{
  assert.equal(resolveSubject('Es para mi papá').patch.caso_sujeto.relacion,'padre');
});

test('extrae múltiples hechos de pensión',()=>{
  const out=extractConversationFacts('Soy ley 73 tengo 68 años 702 semanas cotizadas y 12 años sin cotizar');
  assert.equal(out.patch.edad,68);
  assert.equal(out.patch.pension_data.semanas,702);
  assert.equal(out.patch.pension_data.ley,'ley_73');
  assert.equal(out.patch.pension_data.anos_sin_cotizar,12);
});

test('curp no disponible queda bloqueada',()=>{
  const out=resolveAnswer('No la tengo a la mano',{ultima_pregunta:'curp'});
  assert.equal(out.patch.slots.curp_disponible,false);
});

test('planner no vuelve a pedir curp no disponible',()=>{
  const memory={
    intent:{id:'AFILIACION_IMSS'},resolved_questions:['necesidad_principal','tiene_imss','nombre','edad','actividad'],
    necesidad_principal:'afiliacion_imss',tiene_imss:false,nombre:'Juan Perez',edad:50,actividad:'independiente',
    curp_recibida:false,nss_recibido:false,slots:{curp_disponible:false,nss_disponible:true},contradicciones:[]
  };
  assert.equal(planNext(memory).question_key,'nss');
});
