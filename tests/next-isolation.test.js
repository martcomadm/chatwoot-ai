import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { validateNextIsolation } from "../src/config.js";

function config(overrides={}){
  const dataDir="/app/data-next";
  return {
    appEnv:"next",
    allowedInboxIds:[99],
    chatwoot:{inboxId:99},
    storage:{
      dataDir,
      memoryFile:path.join(dataDir,"conversation-memory.json"),
      rotationFile:path.join(dataDir,"agent-rotation.json"),
      handoffRotationFile:path.join(dataDir,"handoff-rotation.json"),
      inspectorEventsFile:path.join(dataDir,"inspector-events.json"),
      handoffConfigFile:path.join(dataDir,"handoff-config.json"),
      salesFile:path.join(dataDir,"sales.json"),
    },
    ...overrides,
  };
}

test("NEXT isolation accepts an isolated laboratory configuration",()=>{
  assert.equal(validateNextIsolation(config()),true);
});

test("NEXT refuses to start without APP_ENV=next",()=>{
  assert.throws(()=>validateNextIsolation(config({appEnv:"production"})),/APP_ENV=next/i);
});

test("NEXT refuses production Inbox 6 even when allowlisted",()=>{
  assert.throws(()=>validateNextIsolation(config({allowedInboxIds:[6],chatwoot:{inboxId:6}})),/Inbox 6.*producción/i);
});

test("NEXT refuses a Chatwoot inbox outside its explicit allowlist",()=>{
  assert.throws(()=>validateNextIsolation(config({allowedInboxIds:[99],chatwoot:{inboxId:100}})),/no está autorizado/i);
});

test("NEXT refuses the production shared data directory",()=>{
  const storage={...config().storage,dataDir:"/app/data",memoryFile:"/app/data/conversation-memory.json",rotationFile:"/app/data/agent-rotation.json",handoffRotationFile:"/app/data/handoff-rotation.json",inspectorEventsFile:"/app/data/inspector-events.json",handoffConfigFile:"/app/data/handoff-config.json",salesFile:"/app/data/sales.json"};
  assert.throws(()=>validateNextIsolation(config({storage})),/independiente/i);
});

test("NEXT refuses persistence files that escape NEXT_DATA_DIR",()=>{
  const base=config();
  const storage={...base.storage,salesFile:"/app/data/sales.json"};
  assert.throws(()=>validateNextIsolation(config({storage})),/salesFile.*NEXT_DATA_DIR/i);
});
