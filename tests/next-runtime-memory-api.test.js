import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../src/memory/memory-store.js";

test("MemoryStore expone hasProcessed para deduplicación del processor", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-next-memory-api-"));
  const store = new MemoryStore(path.join(dir, "memory.json"));
  assert.equal(typeof store.hasProcessed, "function");
  assert.equal(store.hasProcessed(101, 5001), false);
  await store.markProcessedMany(101, [5001]);
  assert.equal(store.hasProcessed(101, 5001), true);
  assert.equal(store.hasProcessed(101, "5001"), true);
});

test("deduplicación persiste después de reiniciar MemoryStore", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-next-memory-restart-"));
  const file = path.join(dir, "memory.json");
  const store1 = new MemoryStore(file);
  await store1.markProcessedMany(202, [7001, 7002]);
  const store2 = new MemoryStore(file);
  assert.equal(store2.hasProcessed(202, 7001), true);
  assert.equal(store2.hasProcessed(202, 7002), true);
  assert.equal(store2.hasProcessed(202, 7003), false);
});
