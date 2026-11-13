import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../src/memory/memory-store.js";
import { SaleStore } from "../src/operations/sale-store.js";

test("LAB reset primitives clear conversation memory and only its sales", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"martcom-next-reset-"));
  const memories=new MemoryStore(path.join(dir,"memory.json"));
  const sales=new SaleStore(path.join(dir,"sales.json"));
  await memories.merge(101,{nombre:"Prueba Uno",sales_cycle:{authorized:true}});
  await memories.merge(202,{nombre:"Prueba Dos"});
  sales.create({sale_id:"LAB-101",conversation_id:101,customer:{nombre:"Prueba Uno"},sale:{authorized:true}});
  sales.create({sale_id:"LAB-202",conversation_id:202,customer:{nombre:"Prueba Dos"},sale:{authorized:true}});

  const removed=sales.deleteByConversationId(101);
  await memories.clear(101);

  assert.deepEqual(removed.map(s=>s.sale_id),["LAB-101"]);
  assert.equal(sales.findByConversationId(101),null);
  assert.equal(sales.findByConversationId(202)?.sale_id,"LAB-202");
  assert.equal(memories.get(101).nombre,null);
  assert.equal(memories.get(202).nombre,"Prueba Dos");
});

test("sale sequence is not rewound by LAB reset", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"martcom-next-reset-seq-"));
  const sales=new SaleStore(path.join(dir,"sales.json"));
  const first=sales.create({conversation_id:1,sale:{authorized:true}});
  sales.deleteByConversationId(1);
  const second=sales.create({conversation_id:1,sale:{authorized:true}});
  assert.notEqual(first.sale_id,second.sale_id);
  assert.ok(Number(second.sale_id.split("-").at(-1))>Number(first.sale_id.split("-").at(-1)));
});
