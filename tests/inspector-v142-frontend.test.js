import fs from "node:fs";
import assert from "node:assert/strict";
const js=fs.readFileSync(new URL("../src/inspector/public/inspector.js",import.meta.url),"utf8");
assert.match(js,/data-menu-move/);
assert.match(js,/data-menu-copy/);
assert.match(js,/data-agent-menu/);
assert.match(js,/ops-tab/);
console.log("Inspector legacy frontend compatibility updated for V1.5");
