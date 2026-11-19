import test from "node:test";
import assert from "node:assert/strict";
import { buildOnboardingDecision, NSS_LOOKUP_DONE_TEXT, NSS_NEW_DONE_TEXT } from "../src/operations/onboarding-service.js";

// 18-nov (Silverio): sin NSS y sin otros documentos pendientes, cada "ok"/"gracias" recibía otra vez
// "Perfecto, ya recibimos tu documentación…".
function run(texts, ops = {}) {
  let mem = { sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "s1", onboarding_next: "nss", documents_missing: ["nss"], ...ops }, ultima_respuesta_agente: "Gracias. Ahora compárteme por favor el número de seguridad social (NSS) del titular." };
  return texts.map(t => {
    const d = buildOnboardingDecision(mem, t);
    if (d?.nss_resolution) mem = { ...mem, nss_resolution: d.nss_resolution, operations: { ...mem.operations, nss_resolution: d.nss_resolution } };
    if (d?.reply) mem.ultima_respuesta_agente = d.reply;
    return d === null ? null : d.reply;
  });
}

test("sin NSS: se le confirma una vez y los 'ok' / 'gracias' no repiten el aviso", () => {
  const [first, ok, thanks, ok2, question] = run(["no lo tengo tengo INE", "ok", "gracias", "ok", "¿cuándo me dan de alta?"]);
  assert.equal(first, NSS_LOOKUP_DONE_TEXT);
  assert.doesNotMatch(first, /demás documentos pendientes/);
  assert.equal(ok, "");
  assert.equal(thanks, "");
  assert.equal(ok2, "");
  assert.equal(question, null);
});

test("nunca ha tenido NSS y no falta nada más", () => {
  const [first, ok] = run(["nunca he tenido nss", "ok gracias"]);
  assert.equal(first, NSS_NEW_DONE_TEXT);
  assert.equal(ok, "");
});

test("si faltan otros documentos, sí se mencionan", () => {
  const [first] = run(["no lo tengo"], { documents_missing: ["nss", "curp"] });
  assert.match(first, /demás documentos pendientes/);
});
