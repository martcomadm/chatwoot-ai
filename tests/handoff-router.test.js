import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffRotationStore } from "../src/handoff/handoff-rotation-store.js";
import { HandoffRouter } from "../src/handoff/handoff-router.js";

function setup({ failIds = new Set(), weekdayAgents = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-handoff-"));
  const store = new HandoffRotationStore(path.join(dir, "handoff.json"));
  const calls = [];
  const chatwoot = {
    async assignConversation(conversationId, assigneeId) {
      calls.push({ conversationId, assigneeId });
      if (failIds.has(assigneeId)) throw new Error("Chatwoot 403: null");
      return { id: assigneeId, name: `Agent ${assigneeId}` };
    },
  };
  const config = {
    ai: { timezone: "America/Mexico_City" },
    handoff: {
      enabled: true,
      sundayAgents: [
        { id: 25, name: "Elizabeth Aguilera" },
        { id: 20, name: "Jonathan Nuñez" },
        { id: 31, name: "Tonatiuh Ramirez" },
      ],
      saturdayAgents: [
        { id: 40, name: "Alberto Gonzalez" },
        { id: 26, name: "Pamela Montiel" },
        { id: 32, name: "Vicente Martinez" },
      ],
      weekdayAgents,
    },
  };
  return { router: new HandoffRouter({ config, store, chatwoot }), store, calls };
}

const sunday = new Date("2026-08-09T18:00:00Z"); // domingo al mediodía CDMX
const saturday = new Date("2026-08-08T18:00:00Z");
const monday = new Date("2026-08-10T18:00:00Z");

test("domingo rota Elizabeth -> Jonathan -> Tonatiuh -> Elizabeth", async () => {
  const { router } = setup();
  const ids = [];
  for (let i = 1; i <= 4; i++) {
    const result = await router.route({ conversationId: 100 + i, reason: "test", date: sunday });
    assert.equal(result.status, "completed");
    ids.push(result.agent.id);
  }
  assert.deepEqual(ids, [25, 20, 31, 25]);
});

test("sábado rota Alberto -> Pamela -> Vicente -> Alberto", async () => {
  const { router } = setup();
  const ids = [];
  for (let i = 1; i <= 4; i++) {
    const result = await router.route({ conversationId: 200 + i, reason: "test", date: saturday });
    ids.push(result.agent.id);
  }
  assert.deepEqual(ids, [40, 26, 32, 40]);
});

test("si Chatwoot falla, la conversación conserva su asesor reservado y la siguiente conversación recibe el siguiente", async () => {
  const { router } = setup({ failIds: new Set([25]) });
  const first = await router.route({ conversationId: 301, reason: "test", date: sunday });
  const retry = await router.route({ conversationId: 301, reason: "test", date: sunday });
  const secondConversation = await router.route({ conversationId: 302, reason: "test", date: sunday });
  assert.equal(first.status, "failed");
  assert.equal(retry.status, "failed");
  assert.equal(first.agent.id, 25);
  assert.equal(retry.agent.id, 25);
  assert.equal(secondConversation.agent.id, 20);
});

test("entre semana no asigna si no hay turno configurado", async () => {
  const { router, calls } = setup();
  const result = await router.route({ conversationId: 401, reason: "test", date: monday });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "no_agents_configured");
  assert.equal(calls.length, 0);
});

test("entre semana puede habilitarse después sin cambiar código", async () => {
  const { router } = setup({ weekdayAgents: [{ id: 99, name: "Asesor Semana" }] });
  const result = await router.route({ conversationId: 501, reason: "test", date: monday });
  assert.equal(result.status, "completed");
  assert.equal(result.agent.id, 99);
});
