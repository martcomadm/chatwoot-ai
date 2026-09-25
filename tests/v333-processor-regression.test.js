import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src=fs.readFileSync(new URL("../src/core/conversation-processor.js",import.meta.url),"utf8");
test("processor no conserva joined indefinido",()=>assert.doesNotMatch(src,/text:\s*joined/));
test("processor integra patience antes de handoff",()=>assert.match(src,/conversation_patience_pause/));
test("processor bloquea CURP NSS tras pregunta directa",()=>{
  assert.match(src,/directRequest&&\["curp","nss"\]\.includes\(planner\?\.question_key\)/);
  assert.match(src,/question_key:null,customer_question_priority:true/);
});
