import test from "node:test";
import assert from "node:assert/strict";
import { specializedAdviceHandoff } from "../src/core/specialized-advice-handoff.js";

test("general pension question stays with Mia",()=>{
  assert.equal(specializedAdviceHandoff("¿y mi pensión aumenta?"),null);
});
test("ordinary sales guidance stays with Mia",()=>{
  assert.equal(specializedAdviceHandoff("No sé qué me conviene, quiero que me guíen"),null);
});
test("individual pension calculation escalates",()=>{
  assert.equal(specializedAdviceHandoff("Tengo 57 años y 824 semanas, ¿cuánto me quedaría de pensión?")?.kind,"specialized_pension");
});
test("individual weeks review escalates",()=>{
  assert.equal(specializedAdviceHandoff("¿Puedes revisar mis semanas cotizadas y decirme qué me conviene?")?.kind,"specialized_record_review");
});
test("record discrepancy escalates",()=>{
  assert.equal(specializedAdviceHandoff("Me faltan semanas cotizadas y no aparecen en mi historial")?.kind,"specialized_discrepancy");
});
