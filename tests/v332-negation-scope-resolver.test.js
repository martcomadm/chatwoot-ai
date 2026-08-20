import test from "node:test";
import assert from "node:assert/strict";
import { resolveNegationScope } from "../src/semantic/negation-scope-resolver.js";

test("sin coma + por favor queda ambiguo",()=>{
  const r=resolveNegationScope("No quiero información por favor gracias");
  assert.equal(r.status,"ambiguous");
  assert.equal(r.reason,"possible_missing_comma_after_no");
});

test("no quiero información gracias es rechazo",()=>{
  assert.equal(resolveNegationScope("No quiero información, gracias").status,"negative");
});

test("No, quiero información es positivo",()=>{
  assert.equal(resolveNegationScope("No, quiero información por favor").status,"positive");
});

test("no gracias ya no me interesa es rechazo",()=>{
  assert.equal(resolveNegationScope("No gracias, ya no me interesa").status,"negative");
});

test("No, sí me interesa es positivo",()=>{
  assert.equal(resolveNegationScope("No, sí me interesa").status,"positive");
});

test("No quiero el servicio es rechazo claro",()=>{
  assert.equal(resolveNegationScope("No quiero el servicio, gracias").status,"negative");
});

test("quiero información normal es positivo",()=>{
  assert.equal(resolveNegationScope("Quiero información por favor").status,"positive");
});
