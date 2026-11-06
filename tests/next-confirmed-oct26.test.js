import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest, directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { checkReply } from "../src/ai/quality-checker.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

// Respuestas confirmadas por MARTCOM el 26-oct.
const answer = t => directAnswerText(detectDirectRequest(t));

test("no hay altas con retroactivo", () => {
  assert.match(answer("Maneja altas con retroactivo?"), /^No manejamos altas con fecha retroactiva/);
  assert.match(MARTCOM_KNOWLEDGE, /Altas con fecha retroactiva: NO se manejan/);
});

test("misma empresa pagando en tiempo y forma; sin plazo mínimo ni forzoso", () => {
  assert.match(answer("No cambian de empresa a cada rato ?"), /en tiempo y forma, en día hábil/);
  assert.match(answer("Y cuánto serían la mensualidad y en cuanto tiempo dudaría pagandolo"), /sin plazo mínimo ni forzoso/);
});

test("formas de pago: sin efectivo", () => {
  assert.doesNotMatch(MARTCOM_KNOWLEDGE, /OXXO o efectivo/);
  assert.ok(checkReply("Puedes pagar por transferencia, depósito, OXXO o efectivo.", { memory: {}, maxChars: 850 }).reasons.includes("ofrece_pago_efectivo"));
  assert.ok(!checkReply("Puedes pagar por transferencia, depósito u OXXO; no se acepta efectivo.", { memory: {}, maxChars: 850 }).reasons.includes("ofrece_pago_efectivo"));
});

test("semanas mínimas: 500 en Ley 73 y 800 en Ley 97", () => {
  for (const t of ["¿Cuántas semanas necesito para pensionarme?", "cual es el minimo de semanas para la pension", "para jubilarme cuantas semanas se necesitan"]) assert.equal(detectDirectRequest(t)?.answerKey, "min_weeks", t);
  assert.match(answer("¿Cuántas semanas necesito para pensionarme?"), /500 semanas cotizadas si eres Ley 73.*800 semanas si eres Ley 97/);
  assert.match(directAnswerText({ ...detectDirectRequest("¿cuántas semanas necesito para pensionarme?"), pre1997: true }), /tu caso es Ley 73/);
});
