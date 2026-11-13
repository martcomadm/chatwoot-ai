import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { NotificationInbox } from "../src/operations/notifications/notification-inbox.js";
import { OpsNotifier } from "../src/operations/notifications/ops-notifier.js";

// 10-nov: "que la notificación dure más" y "que tengan su pestaña de notificaciones".
test("buzón: cada persona guarda sus avisos, con leídos y sin leer", () => {
  const inbox = new NotificationInbox(null);
  const now = new Date("2026-11-10T16:00:00Z");
  const id = inbox.add(["pamela", "sofi", "pamela"], { kind: "hot_lead", title: "Cliente listo para comprar", body: "Laura (Plan 1)", url: "/operations?area=chats&chat=11347" }, now);
  inbox.add(["pamela"], { kind: "assigned", title: "Te asignaron un expediente", sale_id: "S-1" }, new Date(now.getTime() + 1000));
  assert.equal(inbox.add(["pamela"], { kind: "test", title: "Avisos activados" }), null, "la prueba de avisos no se guarda");
  const p = inbox.list("pamela");
  assert.deepEqual(p.items.map(i => i.title), ["Te asignaron un expediente", "Cliente listo para comprar"], "más nuevo primero, sin duplicar");
  assert.equal(p.unread, 2);
  assert.equal(inbox.list("sofi").unread, 1);
  assert.deepEqual(inbox.markRead("pamela", [id]), { changed: 1, unread: 1 });
  assert.equal(inbox.list("sofi").unread, 1, "leer el mío no cambia el de otra persona");
  assert.deepEqual(inbox.markRead("pamela"), { changed: 1, unread: 0 });
  // 14 días y 150 por persona.
  inbox.add(["pamela"], { title: "nuevo" }, new Date(now.getTime() + 15 * 86400e3));
  assert.deepEqual(inbox.list("pamela").items.map(i => i.title), ["nuevo"]);
  for (let i = 0; i < 160; i++) inbox.add(["x"], { title: `n${i}` }, now);
  assert.equal(inbox.list("x", { limit: 500 }).items.length, 150);
});

test("OpsNotifier: el aviso queda en el buzón y viaja con su id", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-inbox-"));
  const inbox = new NotificationInbox(path.join(dir, "n.json"));
  const notifier = new OpsNotifier({ users: { list: () => [] }, store: { vapid: () => null }, inbox });
  const seen = [];
  notifier.on("notify", n => seen.push(n));
  await notifier.notify({ kind: "hot_lead", to: ["pamela"], title: "Cliente listo para comprar", body: "x", url: "/operations?area=chats&chat=1" });
  assert.ok(seen[0].id);
  assert.equal(inbox.list("pamela").items[0].id, seen[0].id);
  await notifier.notify({ kind: "info", to: [], title: "nadie" });
  assert.equal(inbox.list("pamela").items.length, 1);
});
