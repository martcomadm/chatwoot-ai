import fs from "node:fs";
import assert from "node:assert/strict";
const js=fs.readFileSync(new URL("../src/inspector/public/inspector.js",import.meta.url),"utf8");
const page=fs.readFileSync(new URL("../src/inspector/page.js",import.meta.url),"utf8");

assert.match(js,/closeAdvisorModal'\)\.addEventListener\('click'/);
assert.match(js,/advisorModalList'\)\.addEventListener\('click'/);
assert.match(js,/data-delete-master/);
assert.match(js,/data-add-existing/);
assert.match(js,/data-remove-from-group/);
assert.match(js,/data-menu-move/);
assert.match(js,/data-menu-copy/);
assert.match(js,/addEventListener\('dragstart'/);
assert.match(js,/addEventListener\('drop'/);
assert.match(js,/saveCurrentRotation/);
assert.match(js,/advisorCreateBtn'\)\.addEventListener/);
assert.match(page,/advisorNewId/);
assert.match(page,/advisorNewName/);
console.log("Inspector V1.5.2 interaction regression OK");
