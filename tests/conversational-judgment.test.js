import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJudgment, detectHumanPreference, detectQuestion } from '../src/orchestrator/conversational-judgment.js';
import { governSlotAnswer, slotBlocked } from '../src/semantic/slot-governance.js';
import { validateNameCandidate } from '../src/semantic/name-validator.js';
import { resolveSubject } from '../src/semantic/subject-resolver.js';

test('human preference stops questionnaire',()=>{
  assert.equal(detectHumanPreference('No me gusta hablar con un chat, prefiero atención personal'),true);
  const j=analyzeJudgment('No me gusta hablar con un chat, prefiero atención personal',{});
  assert.equal(j.shouldHandoff,true);
});

test('second explicit price request escalates to human',()=>{
  const first=analyzeJudgment('Quiero saber el costo',{});
  assert.equal(first.patch.judgment.price_requests,1);
  assert.equal(first.shouldHandoff,false);
  const second=analyzeJudgment('Pero antes quiero saber el costo',{judgment:first.patch.judgment});
  assert.equal(second.patch.judgment.price_requests,2);
  assert.equal(second.shouldHandoff,true);
});

test('clarification question is detected before slots',()=>{
  assert.equal(detectQuestion('Cotización de qué ?')?.type,'clarify_quote');
  assert.equal(detectQuestion('En qué consiste el CURP')?.type,'explain_curp');
});

test('CURP not at hand becomes ask_later and blocked',()=>{
  const result=governSlotAnswer('Ahora no lo tengo a la mano',{ultima_pregunta:'curp'});
  assert.equal(result.patch.slots.curp_estado,'ask_later');
  assert.equal(slotBlocked({...result.patch},'curp'),true);
});

test('gratitude cannot become a name',()=>{
  assert.equal(validateNameCandidate('Mil gracias').ok,false);
  assert.equal(validateNameCandidate('Miguel Axel Yañez').ok,true);
});

test('subject correction spouse is deterministic',()=>{
  assert.equal(resolveSubject('Esposo',{}).patch.caso_sujeto.relacion,'esposo');
  assert.equal(resolveSubject('Es para mi padre',{}).patch.caso_sujeto.relacion,'padre');
});
