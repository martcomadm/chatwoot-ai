import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffRotationStore } from "../src/handoff/handoff-rotation-store.js";
import { HandoffRouter } from "../src/handoff/handoff-router.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

function affinitySetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-affinity-"));
  const store = new HandoffRotationStore(path.join(dir, "handoff.json"));
  const calls = [];
  const config = {
    ai: { timezone: "America/Mexico_City" },
    handoff: {
      enabled: true,
      sundayAgents: [{ id: 25, name: "Elizabeth Aguilera" }, { id: 20, name: "Jonathan Nuñez" }, { id: 31, name: "Tonatiuh Ramirez" }],
      saturdayAgents: [{ id: 40, name: "Alberto Gonzalez" }, { id: 26, name: "Pamela Montiel" }, { id: 32, name: "Vicente Martinez" }],
      weekdayAgents: [{ id: 25, name: "Elizabeth Aguilera" }, { id: 20, name: "Jonathan Nuñez" }, { id: 31, name: "Tonatiuh Ramirez" }, { id: 40, name: "Alberto Gonzalez" }, { id: 26, name: "Pamela Montiel" }, { id: 32, name: "Vicente Martinez" }],
    },
  };
  const chatwoot = { async assignConversation(conversationId, assigneeId) { calls.push({ conversationId, assigneeId }); return { id: assigneeId }; } };
  return { store, router: new HandoffRouter({ config, store, chatwoot }), config, calls };
}

test("la reserva avanza la rotación y queda fija por conversación", async () => {
  const { router } = affinitySetup();
  const date = new Date("2026-08-11T18:00:00Z");
  const a = await router.reserve({ conversationId: 7001, date });
  const again = await router.reserve({ conversationId: 7001, date });
  const b = await router.reserve({ conversationId: 7002, date });
  assert.equal(a.agent.id, 25);
  assert.equal(again.agent.id, 25);
  assert.equal(again.reused, true);
  assert.equal(b.agent.id, 20);
});

test("handoff usa exactamente el asesor reservado", async () => {
  const { router, calls } = affinitySetup();
  const date = new Date("2026-08-11T18:00:00Z");
  const reserved = await router.reserve({ conversationId: 7101, date });
  const affinity = { agent_id: reserved.agent.id, agent_name: reserved.agent.name, group: reserved.group, rotation_position: reserved.rotation_position, total_agents: reserved.total_agents };
  const result = await router.route({ conversationId: 7101, reason: "CURP", reservedAdvisor: affinity, date });
  assert.equal(result.status, "completed");
  assert.equal(result.agent.id, reserved.agent.id);
  assert.equal(calls[0].assigneeId, reserved.agent.id);
});

test("ConversationProcessor usa el asesor reservado como presentación", async () => {
  let memory = {};
  const { router } = affinitySetup();
  // Forzamos fecha/grupo mediante un router wrapper para que la prueba no dependa del día real.
  const wrapper = {
    ...router,
    agentsFor: router.agentsFor.bind(router),
    findAgentByName: router.findAgentByName.bind(router),
    async reserve({ conversationId }) { return router.reserve({ conversationId, date: new Date("2026-08-11T18:00:00Z") }); },
  };
  const processor = new ConversationProcessor({
    config: {}, chatwoot: {}, labels: {}, ai: {}, inspectorEvents: { async record() {} },
    handoffRouter: wrapper,
    agentRotation: { async next() { return "NO DEBE USARSE"; } },
    memories: {
      async set(_id, next) { memory = structuredClone(next); return memory; },
      get() { return structuredClone(memory); },
    },
  });
  const updated = await processor.ensureAdvisorAffinity(7201, {});
  assert.equal(updated.asesor_presentacion, "Elizabeth Aguilera");
  assert.equal(updated.advisor_affinity.agent_id, 25);
  assert.equal(updated.advisor_affinity.agent_name, "Elizabeth Aguilera");
});

test("conversación heredada Alberto Martinez se vincula al Alberto real del turno", async () => {
  const { router } = affinitySetup();
  const match = router.findAgentByName("Alberto Martinez", new Date("2026-08-11T18:00:00Z"));
  assert.equal(match.agent.id, 40);
  assert.equal(match.agent.name, "Alberto Gonzalez");
});
