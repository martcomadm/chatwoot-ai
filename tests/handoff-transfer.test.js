import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

test("transferencia crea resumen antes de asignar al asesor humano", async () => {
  const order = [];
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
    memories: {},
    agentRotation: null,
    ai: {
      async handoffSummary() { order.push("summary:generate"); return "MARTCOM AI - RESUMEN\nCaso listo"; },
    },
    inspectorEvents: {
      async record(_id, type) { order.push(`event:${type}`); },
    },
    handoffRouter: {
      async route({ conversationId, reason }) {
        order.push("chatwoot:assign");
        assert.equal(conversationId, 99);
        assert.equal(reason, "Solicitud humana");
        return { status: "completed", agent: { id: 25, name: "Elizabeth Aguilera" } };
      },
    },
  });

  await processor.transfer(99, {}, "Solicitud humana", {});

  const privateIndex = order.findIndex(v => v.startsWith("private:MARTCOM AI - RESUMEN"));
  const assignIndex = order.indexOf("chatwoot:assign");
  assert.ok(privateIndex >= 0);
  assert.ok(assignIndex > privateIndex, `Orden incorrecto: ${order.join(" -> ")}`);
});
