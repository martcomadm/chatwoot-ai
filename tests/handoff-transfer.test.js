import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

test("transferencia crea resumen antes de asignar al asesor humano", async () => {
  const order = [];
  let stored = {};
  const processor = new ConversationProcessor({
    config: { ai: { validationLabel: "validacion" } },
    chatwoot: {
      async sendMessage(_id, content, isPrivate) {
        order.push(isPrivate ? `private:${content}` : `public:${content}`);
      },
    },
    labels: {
      async mergeSafe() { order.push("label:validacion"); return ["validacion"]; },
    },
    memories: {
      async merge(_id, patch) { stored = { ...stored, ...patch }; return stored; },
    },
    agentRotation: null,
    ai: {
      async handoffSummary() { order.push("summary:generate"); return "AXEL IA - RESUMEN\nCaso listo"; },
    },
    inspectorEvents: {
      async record(_id, type) { order.push(`event:${type}`); },
    },
    handoffRouter: {
      async route() {
        order.push("chatwoot:assign");
        return {
          status: "completed",
          group: "sunday",
          agent: { id: 25, name: "Elizabeth Aguilera" },
          rotation_position: 1,
          total_agents: 3,
          assigned_at: "2026-08-09T12:00:00.000Z",
        };
      },
    },
  });

  await processor.transfer(99, {}, "CURP recibida", { flujo: { fase: "diagnostico" } });

  const privateIndex = order.findIndex(v => v.startsWith("private:AXEL IA - RESUMEN"));
  const assignIndex = order.indexOf("chatwoot:assign");
  assert.ok(privateIndex >= 0);
  assert.ok(assignIndex > privateIndex, `Orden incorrecto: ${order.join(" -> ")}`);
  assert.equal(stored.handoff.completed, true);
  assert.equal(stored.handoff.agent_id, 25);
});
