// 11-nov: OpenAI retira GPT-5 y o3 (11-dic-2026) y gpt-4o-mini-transcribe (26-feb-2027).
import test from "node:test";
import assert from "node:assert/strict";
import { currentModel, migrateOpenAiConfig, withModelFallback, modelUnavailable } from "../src/ai/model-migration.js";

test("los modelos retirados se cambian por el reemplazo de OpenAI", () => {
  assert.deepEqual(currentModel("gpt-5-mini"), { model: "gpt-5.6-terra", previous: "gpt-5-mini" });
  assert.equal(currentModel("gpt-5").model, "gpt-5.6-sol");
  assert.equal(currentModel("gpt-5-nano-2025-08-07").model, "gpt-5.6-luna");
  assert.equal(currentModel("o3").model, "gpt-5.6-sol");
  assert.deepEqual(currentModel("gpt-5.6-terra"), { model: "gpt-5.6-terra", previous: null });
  assert.deepEqual(currentModel("gpt-4.1-mini"), { model: "gpt-4.1-mini", previous: null }, "lo que no se retira no se toca");
  const { config, changes } = migrateOpenAiConfig({ model: "gpt-5-mini", strongModel: "gpt-5", transcribeModel: "gpt-4o-mini-transcribe", apiKey: "k" });
  assert.deepEqual([config.model, config.strongModel, config.transcribeModel, config.apiKey], ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-transcribe", "k"]);
  assert.equal(changes.length, 3);
  assert.equal(migrateOpenAiConfig({ model: "gpt-5-mini", strongModel: "" }).config.strongModel, "");
});

test("si la cuenta aún no tiene el modelo nuevo, se usa el anterior; otros errores no se reintentan", async () => {
  const calls = [];
  const fake = { responses: { async create(p) { calls.push(p.model); if (p.model === "gpt-5.6-terra") { const e = new Error("The model `gpt-5.6-terra` does not exist or you do not have access to it."); e.status = 404; throw e; } return { output_text: "ok", model: p.model }; } },
    audio: { transcriptions: { async create(p) { calls.push(p.model); return { text: "hola" }; } } } };
  const logs = [];
  const client = withModelFallback(fake, new Map([["gpt-5.6-terra", "gpt-5-mini"]]), { error: m => logs.push(m) });
  const r = await client.responses.create({ model: "gpt-5.6-terra", input: "x" });
  assert.equal(r.model, "gpt-5-mini");
  await client.responses.create({ model: "gpt-5.6-terra", input: "y" });
  assert.equal(logs.length, 1, "avisa una sola vez");
  assert.equal((await client.audio.transcriptions.create({ model: "gpt-transcribe" })).text, "hola");
  const failing = withModelFallback({ responses: { async create() { const e = new Error("Rate limit"); e.status = 429; throw e; } } }, new Map([["gpt-5.6-terra", "gpt-5-mini"]]));
  await assert.rejects(failing.responses.create({ model: "gpt-5.6-terra" }), /Rate limit/);
  assert.equal(modelUnavailable({ status: 400, message: "Unsupported model" }), true);
  assert.equal(modelUnavailable({ status: 500, message: "server error" }), false);
});
