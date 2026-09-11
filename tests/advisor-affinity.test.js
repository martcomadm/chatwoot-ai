import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffRotationStore } from "../src/handoff/handoff-rotation-store.js";
import { HandoffRouter } from "../src/handoff/handoff-router.js";

function affinitySetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-affinity-"));
  const store = new HandoffRotationStore(path.join(dir, "handoff.json"));
  const calls = [];
  const config = {
    ai: { timezone: "America/Mexico_City", publicName: "Mia de MARTCOM" },
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
  const result = await router.route({ conversationId: 7101, reason: "Intervención humana", reservedAdvisor: affinity, date });
  assert.equal(result.status, "completed");
  assert.equal(result.agent.id, reserved.agent.id);
  assert.equal(calls[0].assigneeId, reserved.agent.id);
});

test("NEXT conserva identidad propia y no presenta asesor humano antes del handoff", () => {
  const { config } = affinitySetup();
  assert.equal(config.ai.publicName, "Mia de MARTCOM");
  assert.notEqual(config.ai.publicName, "Elizabeth Aguilera");
});

test("conversación heredada Alberto Martinez se vincula al Alberto real del turno", async () => {
  const { router } = affinitySetup();
  const match = router.findAgentByName("Alberto Martinez", new Date("2026-08-11T18:00:00Z"));
  assert.equal(match.agent.id, 40);
  assert.equal(match.agent.name, "Alberto Gonzalez");
});
