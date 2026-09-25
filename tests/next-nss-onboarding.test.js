import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractFast } from "../src/memory/fast-extractor.js";
import { mergeMemory } from "../src/ai/services.js";
import { operationsPage } from "../src/operations/operations-page.js";

test("NSS is extracted as a normalized value and survives memory merge", () => {
  const patch = extractFast("33957885354", { ultima_pregunta: "nss" });
  assert.equal(patch.nss_recibido, true);
  assert.equal(patch.nss_valor, "33957885354");
  const merged = mergeMemory({ nss_recibido: false }, patch);
  assert.equal(merged.nss_recibido, true);
  assert.equal(merged.nss_valor, "33957885354");
});

test("NSS embedded in natural text is normalized", () => {
  const patch = extractFast("Mi NSS es 33-95-78-85354", {});
  assert.equal(patch.nss_recibido, true);
  assert.equal(patch.nss_valor, "33957885354");
});

test("Operations page explicitly binds DOM nodes instead of relying on id globals", () => {
  const html = operationsPage();
  for (const id of ["tabs","stats","banner","grid","count","search","docs","resetConversationId","resetResult","resetConversationBtn"]) {
    assert.match(html, new RegExp("const " + id + "=document\\.getElementById\\('" + id + "'\\)"));
  }
});
