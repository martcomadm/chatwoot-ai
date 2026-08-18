import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OperationsConfigStore } from "../src/handoff/operations-config-store.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"martcom-agentmgr-"));
const file=path.join(dir,"config.json");

const store=new OperationsConfigStore(file,{
  weekday:[{id:1,name:"Ana"},{id:2,name:"Beto"}],
  saturday:[{id:3,name:"Caro"}],
  sunday:[{id:4,name:"Dani"}]
});

assert.equal(store.allAgents().length,4);

await store.copyAgent({targetGroup:"saturday",agentId:1});
assert.deepEqual(store.agentsFor("saturday").map(a=>a.id),[3,1]);

await store.copyAgent({targetGroup:"saturday",agentId:1});
assert.deepEqual(store.agentsFor("saturday").map(a=>a.id),[3,1]);

await store.moveAgent({sourceGroup:"weekday",targetGroup:"sunday",agentId:2});
assert.deepEqual(store.agentsFor("weekday").map(a=>a.id),[1]);
assert.deepEqual(store.agentsFor("sunday").map(a=>a.id),[4,2]);

let failed=false;
try{
  await store.moveAgent({sourceGroup:"weekday",targetGroup:"saturday",agentId:1});
}catch(e){failed=true}
assert.equal(failed,true);

assert.ok(store.snapshot().audit.some(x=>x.type==="agent_copied_to_group"));
assert.ok(store.snapshot().audit.some(x=>x.type==="agent_moved_between_groups"));

console.log("Agent Assignment Manager tests OK");
