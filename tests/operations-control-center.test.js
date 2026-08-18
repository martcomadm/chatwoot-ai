import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OperationsConfigStore } from "../src/handoff/operations-config-store.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"martcom-ops-"));
const file=path.join(dir,"config.json");
const store=new OperationsConfigStore(file,{
  weekday:[{id:25,name:"Elizabeth"},{id:20,name:"Jonathan"},{id:31,name:"Tonatiuh"}],
  saturday:[{id:40,name:"Alberto"}],
  sunday:[{id:26,name:"Pamela"}]
});
assert.equal(store.agentsFor("weekday").length,3);
await store.setGroup("weekday",[
  {id:20,name:"Jonathan",enabled:true},
  {id:25,name:"Elizabeth",enabled:false},
  {id:31,name:"Tonatiuh",enabled:true}
]);
assert.deepEqual(store.agentsFor("weekday").map(a=>a.id),[20,31]);
assert.deepEqual(store.agentsFor("weekday",null,{activeOnly:false}).map(a=>a.id),[20,25,31]);
await store.setException("2026-08-20",[{id:31,name:"Tonatiuh",enabled:true}]);
assert.deepEqual(store.agentsFor("weekday","2026-08-20").map(a=>a.id),[31]);
await store.deleteException("2026-08-20");
assert.equal(store.snapshot().exceptions["2026-08-20"],undefined);
assert.ok(store.snapshot().audit.length>=3);
console.log("Operations Control Center tests OK");
