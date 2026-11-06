import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { OperationsConfigStore } from "../src/handoff/operations-config-store.js";

const ROT = [{ id: 26, name: "Pamela Montiel" }, { id: 24, name: "Adriana Rangel" }, { id: 20, name: "Jonathan Nuñez" }, { id: 40, name: "Alberto Gonzalez" }];
const NEW = [{ id: 26, name: "Pamela Montiel" }, { id: 31, name: "Tonatiuh Ramirez" }, { id: 20, name: "Jonathan Nuñez" }, { id: 40, name: "Alberto Gonzalez" }];

test("21-oct: Tonatiuh Ramirez (31) sustituye a Adriana Rangel (24) en la rotación guardada, en su mismo lugar", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-rot-")), "handoff-config.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, groups: { weekday: ROT, saturday: ROT, sunday: [ROT[0], ROT[1]] }, exceptions: { "2099-01-01": [ROT[1]], "2000-01-01": [ROT[1]] }, audit: [], agents: ROT }));
  const store = new OperationsConfigStore(file, { weekday: NEW, saturday: NEW, sunday: NEW });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(saved.groups.weekday.map(a => a.id), [26, 31, 20, 40]);
  assert.deepEqual(saved.groups.saturday.map(a => a.id), [26, 31, 20, 40]);
  assert.deepEqual(saved.groups.sunday.map(a => a.id), [26, 31]);
  assert.deepEqual(saved.exceptions["2099-01-01"].map(a => a.id), [31], "excepciones futuras");
  assert.deepEqual(saved.exceptions["2000-01-01"].map(a => a.id), [24], "las pasadas no se tocan");
  assert.ok(!saved.agents.some(a => a.id === 24));
  assert.equal(saved.groups.weekday[1].name, "Tonatiuh Ramirez");
  // Si después alguien vuelve a poner a Adriana a mano, no se vuelve a cambiar.
  saved.groups.weekday = ROT; fs.writeFileSync(file, JSON.stringify(saved));
  new OperationsConfigStore(file, { weekday: NEW, saturday: NEW, sunday: NEW });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).groups.weekday.map(a => a.id), [26, 24, 20, 40]);
  assert.ok(store);
});
