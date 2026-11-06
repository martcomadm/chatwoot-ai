import test from "node:test";
import assert from "node:assert/strict";
import { assigneeIdOf, webhookEventAllowedForAgent } from "../src/utils/webhook-isolation.js";

test("message_created assigned to LAB 53 is allowed", () => {
  const payload = { event:"message_created", conversation:{ id:100, inbox_id:6, meta:{ assignee:{ id:53 } } } };
  assert.equal(assigneeIdOf(payload),53);
  assert.equal(webhookEventAllowedForAgent(payload,53),true);
});

test("message_created assigned to production AXEL IA 12 is rejected", () => {
  const payload = { event:"message_created", conversation:{ id:100, inbox_id:6, meta:{ assignee:{ id:12 } } } };
  assert.equal(webhookEventAllowedForAgent(payload,53),false);
});

test("message_created assigned to another human is rejected", () => {
  const payload = { event:"message_created", conversation:{ id:100, inbox_id:6, meta:{ assignee:{ id:25 } } } };
  assert.equal(webhookEventAllowedForAgent(payload,53),false);
});

test("missing assignee fails closed", () => {
  const payload = { event:"message_created", conversation:{ id:100, inbox_id:6 } };
  assert.equal(assigneeIdOf(payload),null);
  assert.equal(webhookEventAllowedForAgent(payload,53),false);
});

test("nested message conversation assignee is recognized", () => {
  const payload = { event:"message_created", message:{ id:1, conversation:{ id:100, inbox_id:6, assignee:{ id:53 } } } };
  assert.equal(webhookEventAllowedForAgent(payload,53),true);
});

test("invalid expected agent fails closed", () => {
  const payload = { conversation:{ meta:{ assignee:{ id:53 } } } };
  assert.equal(webhookEventAllowedForAgent(payload,null),false);
});
