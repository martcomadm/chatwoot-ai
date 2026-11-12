import test from "node:test";
import assert from "node:assert/strict";
import { AREA_KEYS, hasArea, normalizeAreas, seesAllQueues } from "../src/operations/access/areas.js";

// 10-nov: usuario que solo revisa y corrige a Mia (Chats de Mia + Respuestas de Mia).
test("área 'Calidad de Mia': existe y no da acceso a expedientes ni a otras áreas", () => {
  assert.ok(AREA_KEYS.includes("calidad"));
  assert.deepEqual(normalizeAreas("calidad"), ["calidad"]);
  const u = { areas: ["calidad"] };
  for (const area of ["captura", "validacion", "vigencia", "cobranza", "atencion", "supervision", "admin"]) assert.equal(hasArea(u, area), false, area);
  assert.equal(seesAllQueues(u), false);
  assert.equal(hasArea({ areas: ["admin"] }, "calidad"), true);
});

test("permiso 'Chats de Mia' (12-nov): existe y no da acceso a ninguna cola ni área", () => {
  assert.ok(AREA_KEYS.includes("chats_mia"));
  const u = { areas: ["chats_mia"] };
  for (const area of ["captura", "validacion", "vigencia", "cobranza", "atencion", "supervision", "admin", "calidad"]) assert.equal(hasArea(u, area), false, area);
  assert.equal(seesAllQueues(u), false);
});
