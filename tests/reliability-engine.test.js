import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmployment, semanticEquivalent } from "../src/semantic/normalizer.js";
import { validateNameCandidate, extractValidatedName } from "../src/semantic/name-validator.js";
import { resolveAnswer } from "../src/semantic/answer-resolver.js";
import { detectFrustration } from "../src/semantic/frustration.js";
import { planNext } from "../src/sales/sales-engine.js";
import { MessageBuffer } from "../src/core/message-buffer.js";

function baseMemory(overrides={}) {
  return {
    nombre:null,edad:null,actividad:null,tipo_trabajo:null,tiene_imss:null,
    necesidad_principal:"afiliacion_imss",intereses:{imss:true},curp_recibida:false,nss_recibido:false,
    resolved_questions:[],contradicciones:[],conflictos_resueltos:[],slots:{},preguntas_realizadas:[],
    caso_fallecimiento:{},intent:{id:null},flujo:{},...overrides
  };
}

test("TEST-001 desempleo equivalente no genera diferencia semantica",()=>{
  assert.equal(normalizeEmployment("No tengo trabajo").value,"desempleado");
  assert.equal(normalizeEmployment("Estoy desempleado").value,"desempleado");
  assert.equal(semanticEquivalent("tipo_trabajo","No tengo trabajo","Estoy desempleado"),true);
});

test("TEST-AGE respuesta numerica se vincula a ultima pregunta",()=>{
  const result=resolveAnswer("50",baseMemory({ultima_pregunta:"edad"}));
  assert.equal(result.patch.edad,50);
  assert.ok(result.resolved.includes("edad"));
});

test("TEST-YES si se vincula a IMSS cuando esa fue la pregunta",()=>{
  const result=resolveAnswer("Siii",baseMemory({ultima_pregunta:"tiene_imss"}));
  assert.equal(result.patch.tiene_imss,true);
  assert.ok(result.resolved.includes("tiene_imss"));
});

test("TEST-NAME frase conversacional se rechaza",()=>{
  assert.equal(validateNameCandidate("Ya te había dicho que estoy desempleado").ok,false);
  assert.equal(extractValidatedName("Ya te había dicho que estoy desempleado",baseMemory({ultima_pregunta:"nombre"})),null);
});

test("TEST-NAME nombre real despues de pregunta se acepta",()=>{
  assert.equal(extractValidatedName("Ignacio López Lorenzana",baseMemory({ultima_pregunta:"nombre"})),"Ignacio López Lorenzana");
});

test("TEST-NAME actividad no se convierte en nombre",()=>{
  assert.equal(extractValidatedName("Manejo un taxi",baseMemory({ultima_pregunta:"nombre"})),null);
  assert.equal(validateNameCandidate("Requiero asesoría para mi pensión").ok,false);
});

test("TEST-RESOLVED planner no pregunta edad resuelta",()=>{
  const memory=baseMemory({nombre:"Ignacio López",edad:50,actividad:null,tiene_imss:false,resolved_questions:["nombre","edad","tiene_imss"]});
  const plan=planNext(memory);
  assert.equal(plan.question_key,"actividad");
});

test("TEST-FRUSTRATION reclamo repetido activa circuit breaker",()=>{
  const result=detectFrustration("Ya te había dicho mi edad, cuántas más???");
  assert.equal(result.high,true);
});

test("TEST-DEDUPE mismo message_id solo entra una vez al buffer",async()=>{
  let calls=0;
  const buffer=new MessageBuffer(10,async()=>{calls++;});
  const message={id:123,content:"hola"};
  assert.equal(buffer.enqueue(7,message,"message_created",{}),true);
  assert.equal(buffer.enqueue(7,message,"conversation_updated",{}),false);
  await new Promise(r=>setTimeout(r,40));
  assert.equal(calls,1);
});
