import fs from "node:fs";
import assert from "node:assert/strict";

const js=fs.readFileSync(new URL("../src/inspector/public/inspector.js",import.meta.url),"utf8");
assert.match(js,/data-agent-move/);
assert.match(js,/data-agent-copy/);
assert.match(js,/data-master-copy/);
assert.match(js,/agents\/move/);
assert.match(js,/agents\/copy/);
console.log("Inspector V1.4.2 frontend tests OK");
