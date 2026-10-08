import express from "express";
import { operationsAppPage } from "./ui/operations-app.js";
import { publicSale } from "./sale-store.js";
import { RETURN_TARGETS } from "./workflow-engine.js";
import { AREAS, ACTION_AREAS, QUEUE_LABELS, areaForQueue, canRunAction, canSeeSale, hasArea, normalizeAreas, seesAllQueues, visibleQueues } from "./access/areas.js";
import { LoginThrottle, REQUEST_HEADER, actorOf, clearSessionCookie, createAuthenticator, requireArea, requireUser, sessionCookie } from "./access/auth.js";
import { normalizeUsername } from "./access/user-store.js";
import { buildAuditTrail, buildOverview, hoursInQueue, queueEnteredAt, urgencyOf } from "./supervision-service.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const VALIDITY_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function estimatedBytes(base64) { return Math.floor(String(base64 || "").length * 3 / 4); }

// Expediente para la API: sin documentos base64 y con el reloj de su área.
function saleView(sale, alertHours, { withEvents = true } = {}) {
  const view = publicSale(sale);
  if (!withEvents) delete view.events;
  return {
    ...view,
    queue_label: QUEUE_LABELS[sale.queue] || sale.queue,
    queue_entered_at: queueEnteredAt(sale),
    hours_in_queue: Math.round(hoursInQueue(sale) * 10) / 10,
    urgency: urgencyOf(sale, alertHours),
    limit_hours: alertHours?.[sale.queue] ?? null,
  };
}

export function createOperationsRouter({ config, saleStore, workflow, memories, inspectorEvents, buffer, users, sessions, settings, audit }) {
  const router = express.Router();
  const throttle = new LoginThrottle();
  const authenticate = createAuthenticator({ users, sessions, legacyToken: config.operations?.token || "" });
  const signedIn = requireUser(authenticate);
  const alertHours = () => settings.alertHours();

  function chatwootConversationUrl(sale) {
    if (!sale?.conversation_id) return null;
    const base = String(config.chatwoot?.baseUrl || "").replace(/\/+$/, "");
    return `${base}/app/accounts/${config.chatwoot.accountId}/conversations/${sale.conversation_id}`;
  }

  function fail(res, error, status = 400) { return res.status(status).json({ error: error?.message || String(error) }); }

  function visibleSale(req, res) {
    const sale = saleStore.get(req.params.id);
    if (!sale) { res.status(404).json({ error: "Expediente no encontrado" }); return null; }
    if (!canSeeSale(req.opsUser, sale)) { res.status(403).json({ error: "Este expediente no está en tu área", code: "forbidden" }); return null; }
    return sale;
  }

  function startSession(req, res, user) {
    const { token, expiresAt } = sessions.create(user.username);
    users.markLogin(user.username);
    res.setHeader("Set-Cookie", sessionCookie(req, token, expiresAt));
  }

  function requireRequestHeader(req, res, next) {
    if (req.get(REQUEST_HEADER) !== "1") return res.status(403).json({ error: "Solicitud rechazada: falta la cabecera de Operations", code: "csrf" });
    next();
  }

  // ── Páginas ──────────────────────────────────────────────────────────────
  router.get("/operations", (_req, res) => res.type("html").send(operationsAppPage()));
  router.get("/operations/sales/:id", (_req, res) => res.type("html").send(operationsAppPage()));

  // ── Sesión ───────────────────────────────────────────────────────────────
  router.get("/operations/api/auth/status", (req, res) => {
    const auth = authenticate(req);
    res.json({ needs_setup: users.count() === 0, setup_available: Boolean(config.operations?.token), user: auth?.user || null });
  });

  // Alta del primer administrador. Solo funciona mientras no exista ningún usuario
  // y exige el OPERATIONS_TOKEN configurado en el servidor.
  router.post("/operations/api/auth/bootstrap", requireRequestHeader, (req, res) => {
    if (users.count() > 0) return fail(res, new Error("Operations ya tiene usuarios. Inicia sesión."), 409);
    const expected = config.operations?.token || "";
    if (!expected) return fail(res, new Error("Configura OPERATIONS_TOKEN en el servidor para crear el primer administrador"), 503);
    if (String(req.body?.token || "") !== expected) return fail(res, new Error("El token de Operations no es correcto"), 401);
    try {
      const user = users.create({ username: req.body?.username, name: req.body?.name, password: req.body?.password, areas: ["admin"] });
      audit.record("user.bootstrap", actorOf(user), { username: user.username });
      startSession(req, res, user);
      res.json({ ok: true, user });
    } catch (error) { fail(res, error); }
  });

  router.post("/operations/api/auth/login", requireRequestHeader, (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const ip = req.ip || "";
    const blocked = throttle.blockedFor(username, ip);
    if (blocked) return fail(res, new Error(`Demasiados intentos. Intenta de nuevo en ${Math.ceil(blocked / 60000)} minutos.`), 429);
    const user = users.verify(username, req.body?.password);
    if (!user) {
      throttle.fail(username, ip);
      audit.record("auth.login_failed", null, { username });
      return fail(res, new Error("Usuario o contraseña incorrectos"), 401);
    }
    throttle.succeed(username, ip);
    startSession(req, res, user);
    audit.record("auth.login", actorOf(user), {});
    res.json({ ok: true, user });
  });

  router.post("/operations/api/auth/logout", (req, res) => {
    const auth = authenticate(req);
    if (auth?.token) sessions.destroy(auth.token);
    res.setHeader("Set-Cookie", clearSessionCookie(req));
    res.json({ ok: true });
  });

  // ── A partir de aquí todo exige sesión ───────────────────────────────────
  router.use("/operations/api", signedIn);

  router.get("/operations/api/me", (req, res) => {
    const user = req.opsUser;
    res.json({
      user,
      areas: AREAS.filter(area => hasArea(user, area.key)).map(area => ({ ...area })),
      visible_queues: visibleQueues(user),
      queue_labels: QUEUE_LABELS,
      can: {
        supervise: hasArea(user, "supervision"),
        admin: hasArea(user, "admin"),
        lab: hasArea(user, "admin") && String(config.appEnv || "").toLowerCase() === "next",
      },
      return_targets: Object.fromEntries(Object.entries(RETURN_TARGETS).map(([key, value]) => [key, value.label])),
      alert_hours: alertHours(),
      accounts_image_configured: Boolean(settings.accountsImage()),
      mia: settings.miaStatus(),
    });
  });

  router.post("/operations/api/me/password", (req, res) => {
    const user = req.opsUser;
    if (user.via === "token") return fail(res, new Error("El token de Operations no tiene contraseña"));
    if (!users.verify(user.username, req.body?.current)) return fail(res, new Error("La contraseña actual no es correcta"), 401);
    try {
      users.setPassword(user.username, req.body?.next);
      sessions.destroyForUser(user.username, req.opsAuth.token);
      audit.record("user.password_changed", actorOf(user), { username: user.username, self: true });
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  // ── Expedientes ──────────────────────────────────────────────────────────
  router.get("/operations/api/sales", (req, res) => {
    const queues = new Set(visibleQueues(req.opsUser));
    let items = saleStore.list({ status: req.query.status || undefined }).filter(sale => queues.has(sale.queue));
    if (req.query.queue) items = items.filter(sale => sale.queue === req.query.queue);
    const documents = String(req.query.documents || "").toLowerCase();
    if (documents === "complete") items = items.filter(sale => sale.documents?.complete === true);
    if (documents === "incomplete") items = items.filter(sale => sale.documents?.complete !== true);
    if (req.query.assignee === "me") items = items.filter(sale => sale.assignee?.username === req.opsUser.username);
    if (req.query.assignee === "none") items = items.filter(sale => !sale.assignee);
    const search = String(req.query.search || "").trim().toLowerCase();
    if (search) items = items.filter(sale => [sale.sale_id, sale.customer?.nombre, sale.customer?.telefono, sale.customer?.curp, sale.customer?.nss, sale.conversation_id, sale.payment?.reference].some(value => String(value || "").toLowerCase().includes(search)));
    const hours = alertHours();
    res.json({ items: items.map(sale => saleView(sale, hours, { withEvents: false })) });
  });

  router.get("/operations/api/sales/:id", (req, res) => {
    const sale = visibleSale(req, res);
    if (!sale) return;
    res.json({ sale: saleView(sale, alertHours()), links: { chatwoot: chatwootConversationUrl(sale) } });
  });

  router.post("/operations/api/sales", requireArea("supervision"), (req, res) => {
    try {
      const sale = saleStore.runAs(actorOf(req.opsUser), () => workflow.openAuthorizedSale(req.body || {}));
      res.json({ ok: true, sale: saleView(sale, alertHours()) });
    } catch (error) { fail(res, error); }
  });

  // Ejecuta una acción del flujo con permisos de área y atribución al usuario.
  // El campo "by" siempre es el nombre del usuario en sesión, nunca lo que mande el navegador.
  function areaAction(action, handler) {
    return (req, res) => {
      if (!canRunAction(req.opsUser, action)) {
        const area = AREAS.find(item => item.key === ACTION_AREAS[action]);
        return res.status(403).json({ error: `Esta acción corresponde a ${area?.label || "otra área"}`, code: "forbidden" });
      }
      const sale = visibleSale(req, res);
      if (!sale) return;
      try {
        const body = { ...(req.body || {}), by: req.opsUser.name };
        const result = saleStore.runAs(actorOf(req.opsUser), () => handler(req, body, sale));
        res.json({ ok: true, sale: saleView(result, alertHours()) });
      } catch (error) { fail(res, error); }
    };
  }

  const salePath = action => `/operations/api/sales/:id/${action}`;
  router.post(salePath("documents/sync"), areaAction("documents/sync", (req, body) => workflow.syncDocuments(req.params.id, body)));
  router.post(salePath("capture/nss"), areaAction("capture/nss", (req, body) => workflow.registerNss(req.params.id, body)));
  router.post(salePath("capture/start"), areaAction("capture/start", req => workflow.startCapture(req.params.id, { id: req.opsUser.username, name: req.opsUser.name })));
  router.post(salePath("capture/complete"), areaAction("capture/complete", (req, body) => workflow.completeCapture(req.params.id, body)));
  router.post(salePath("validation/check"), areaAction("validation/check", (req, body) => workflow.setValidationCheck(req.params.id, body.key, body.checked, body)));
  router.post(salePath("validation/correction"), areaAction("validation/correction", (req, body) => workflow.requestCorrection(req.params.id, body)));
  router.post(salePath("validation/reject"), areaAction("validation/reject", (req, body) => workflow.rejectValidation(req.params.id, body)));
  router.post(salePath("validation/reopen"), areaAction("validation/reopen", (req, body) => workflow.reopenRejected(req.params.id, body)));
  router.post(salePath("validity/confirm"), areaAction("validity/confirm", (req, body) => {
    if (body.document_base64) {
      if (estimatedBytes(body.document_base64) > MAX_FILE_BYTES) throw new Error("El documento de vigencia no puede exceder 10 MB");
      if (!VALIDITY_TYPES.has(String(body.document_content_type || ""))) throw new Error("Formato de vigencia no permitido. Usa PDF, JPG, PNG o WEBP");
    }
    return workflow.confirmValidity(req.params.id, body);
  }));
  router.post(salePath("validity/issue"), areaAction("validity/issue", (req, body) => workflow.reportValidityIssue(req.params.id, body)));
  router.post(salePath("validity/reopen"), areaAction("validity/reopen", (req, body) => workflow.reopenValidity(req.params.id, body)));
  router.post(salePath("payment/request"), areaAction("payment/request", (req, body) => {
    // Sin imagen subida se usa la imagen de cuentas configurada en Admin.
    const payload = body.accounts_image_base64 ? body : { ...body, ...(settings.accountsImagePayload() || {}) };
    if (!payload.accounts_image_base64) throw new Error("Sube la imagen de cuentas o configura una imagen por defecto en Admin");
    if (estimatedBytes(payload.accounts_image_base64) > MAX_FILE_BYTES) throw new Error("La imagen de cuentas no puede exceder 10 MB");
    if (!IMAGE_TYPES.has(String(payload.accounts_image_content_type || ""))) throw new Error("Formato de imagen no permitido. Usa JPG, PNG o WEBP");
    return workflow.requestPayment(req.params.id, payload);
  }));
  router.post(salePath("payment/receive"), areaAction("payment/receive", (req, body) => workflow.receivePayment(req.params.id, body)));
  router.post(salePath("payment/issue"), areaAction("payment/issue", (req, body) => workflow.reportPaymentIssue(req.params.id, body)));
  router.post(salePath("payment/reopen"), areaAction("payment/reopen", (req, body) => workflow.reopenPayment(req.params.id, body)));
  router.post(salePath("payment/validate"), areaAction("payment/validate", (req, body) => workflow.validatePayment(req.params.id, body)));

  // Tomar / soltar un expediente de la cola propia.
  router.post(salePath("take"), (req, res) => {
    const sale = visibleSale(req, res);
    if (!sale) return;
    const area = areaForQueue(sale.queue);
    if (!area || !hasArea(req.opsUser, area)) return res.status(403).json({ error: "Solo puedes tomar expedientes de tu área", code: "forbidden" });
    if (sale.assignee && sale.assignee.username !== req.opsUser.username && !hasArea(req.opsUser, "supervision")) return fail(res, new Error(`Este expediente ya lo tiene ${sale.assignee.name}`), 409);
    try {
      const result = saleStore.runAs(actorOf(req.opsUser), () => workflow.assign(sale.sale_id, { username: req.opsUser.username, name: req.opsUser.name }));
      res.json({ ok: true, sale: saleView(result, alertHours()) });
    } catch (error) { fail(res, error); }
  });
  router.post(salePath("release"), (req, res) => {
    const sale = visibleSale(req, res);
    if (!sale) return;
    if (sale.assignee?.username !== req.opsUser.username && !hasArea(req.opsUser, "supervision")) return res.status(403).json({ error: "Solo puedes soltar expedientes asignados a ti", code: "forbidden" });
    try {
      const result = saleStore.runAs(actorOf(req.opsUser), () => workflow.assign(sale.sale_id, null));
      res.json({ ok: true, sale: saleView(result, alertHours()) });
    } catch (error) { fail(res, error); }
  });

  // ── Supervisión ──────────────────────────────────────────────────────────
  router.post(salePath("supervision/return"), areaAction("supervision/return", (req, body) => workflow.returnToStage(req.params.id, body)));
  router.post(salePath("supervision/cancel"), areaAction("supervision/cancel", (req, body) => workflow.cancelSale(req.params.id, body)));
  router.post(salePath("supervision/assign"), areaAction("supervision/assign", (req, body, sale) => {
    if (!body.username) return workflow.assign(sale.sale_id, null);
    const target = users.get(body.username);
    const area = areaForQueue(sale.queue);
    if (!target || !target.active) throw new Error("Usuario no encontrado o inactivo");
    if (!area || !target.areas.includes(area)) throw new Error(`${target.name} no pertenece al área de ${QUEUE_LABELS[sale.queue] || sale.queue}`);
    return workflow.assign(sale.sale_id, { username: target.username, name: target.name });
  }));

  router.get("/operations/api/supervision/overview", requireArea("supervision"), (req, res) => {
    res.json(buildOverview(saleStore.list(), { alertHours: alertHours(), from: req.query.from || null, to: req.query.to || null }));
  });

  // Personas activas por área (para asignar expedientes).
  router.get("/operations/api/people", requireArea("supervision"), (req, res) => {
    const area = String(req.query.area || "");
    res.json({ items: users.list().filter(user => user.active && (!area || user.areas.includes(area))).map(user => ({ username: user.username, name: user.name, areas: user.areas })) });
  });

  // Pausar / reanudar a Mia para todas las conversaciones (Supervisión y Admin).
  router.get("/operations/api/mia", (_req, res) => res.json(settings.miaStatus()));
  router.post("/operations/api/mia/pause", requireArea("supervision"), (req, res) => {
    const paused = Boolean(req.body?.paused);
    const reason = String(req.body?.reason || "").trim();
    if (paused && !reason) return fail(res, new Error("Escribe el motivo de la pausa"));
    const status = settings.setMiaPaused(paused, { reason, actor: actorOf(req.opsUser) });
    audit.record(paused ? "mia.paused" : "mia.resumed", actorOf(req.opsUser), { reason: status.reason });
    console.warn(`NEXT: Mia ${paused ? "PAUSADA" : "reanudada"} por ${req.opsUser.username}${paused ? `: ${reason}` : ""}`);
    res.json({ ok: true, mia: status });
  });

  // ── Admin ────────────────────────────────────────────────────────────────
  const admin = requireArea("admin");
  router.get("/operations/api/admin/users", admin, (_req, res) => res.json({ items: users.list(), areas: AREAS }));
  router.post("/operations/api/admin/users", admin, (req, res) => {
    try {
      const user = users.create({ username: req.body?.username, name: req.body?.name, areas: req.body?.areas, password: req.body?.password });
      audit.record("user.created", actorOf(req.opsUser), { username: user.username, areas: user.areas });
      res.json({ ok: true, user });
    } catch (error) { fail(res, error); }
  });
  router.patch("/operations/api/admin/users/:username", admin, (req, res) => {
    try {
      const before = users.get(req.params.username);
      const patch = {};
      if (req.body?.name !== undefined) patch.name = req.body.name;
      if (req.body?.areas !== undefined) patch.areas = normalizeAreas(req.body.areas);
      if (req.body?.active !== undefined) patch.active = req.body.active;
      const user = users.update(req.params.username, patch);
      if (before?.active && !user.active) sessions.destroyForUser(user.username);
      audit.record("user.updated", actorOf(req.opsUser), { username: user.username, before: before && { name: before.name, areas: before.areas, active: before.active }, after: { name: user.name, areas: user.areas, active: user.active } });
      res.json({ ok: true, user });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/admin/users/:username/password", admin, (req, res) => {
    try {
      const user = users.setPassword(req.params.username, req.body?.password);
      sessions.destroyForUser(user.username);
      audit.record("user.password_reset", actorOf(req.opsUser), { username: user.username });
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  router.get("/operations/api/admin/audit", admin, (req, res) => {
    res.json({ items: buildAuditTrail(saleStore.list(), audit.list(), { from: req.query.from || null, to: req.query.to || null, actor: req.query.actor || null, saleId: req.query.sale_id || null, limit: req.query.limit }) });
  });

  router.get("/operations/api/admin/settings", admin, (_req, res) => res.json(settings.snapshot()));
  router.put("/operations/api/admin/settings", admin, (req, res) => {
    try {
      const snapshot = settings.update({ alert_hours: req.body?.alert_hours, customer_messages: req.body?.customer_messages }, actorOf(req.opsUser));
      audit.record("settings.updated", actorOf(req.opsUser), { sections: Object.keys(req.body || {}) });
      res.json({ ok: true, settings: snapshot });
    } catch (error) { fail(res, error); }
  });
  router.get("/operations/api/admin/settings/accounts-image", admin, (_req, res) => {
    const image = settings.accountsImageBytes();
    if (!image) return res.status(404).json({ error: "No hay imagen de cuentas configurada" });
    res.setHeader("Content-Type", image.meta.content_type);
    res.setHeader("Cache-Control", "no-store");
    res.end(image.bytes);
  });
  router.put("/operations/api/admin/settings/accounts-image", admin, (req, res) => {
    try {
      const meta = settings.setAccountsImage({ name: req.body?.name, content_type: req.body?.content_type, base64: req.body?.base64 }, actorOf(req.opsUser));
      audit.record("settings.accounts_image_updated", actorOf(req.opsUser), { name: meta.name, size: meta.size });
      res.json({ ok: true, accounts_image: meta });
    } catch (error) { fail(res, error); }
  });
  router.delete("/operations/api/admin/settings/accounts-image", admin, (req, res) => {
    settings.clearAccountsImage();
    audit.record("settings.accounts_image_removed", actorOf(req.opsUser), {});
    res.json({ ok: true });
  });

  // Reinicio de una conversación de prueba (solo APP_ENV=next, solo Admin).
  router.post("/operations/api/lab/reset-conversation", admin, async (req, res) => {
    try {
      if (String(config.appEnv || "").toLowerCase() !== "next") return res.status(403).json({ error: "Reset LAB solo está disponible en APP_ENV=next" });
      const conversationId = Number(req.body?.conversation_id);
      if (!Number.isInteger(conversationId) || conversationId <= 0) return res.status(400).json({ error: "conversation_id inválido" });
      if (req.body?.confirm !== `RESET ${conversationId}`) return res.status(400).json({ error: `Confirmación requerida: RESET ${conversationId}` });
      const previousMemory = memories?.get(conversationId);
      // Purge delayed webhook work first. Otherwise a message queued before the reset
      // can run afterwards and reconstruct old conversational facts into fresh memory.
      buffer?.resetConversation?.(conversationId);
      const removedSales = saleStore.deleteByConversationId(conversationId);
      await memories?.clear(conversationId);
      const removedIds = removedSales.map(sale => sale.sale_id);
      await inspectorEvents?.record(conversationId, "lab.conversation_reset", { conversation_id: conversationId, removed_sale_ids: removedIds, had_memory: Boolean(previousMemory?.actualizado_en), requested_by: req.opsUser.username });
      audit.record("lab.conversation_reset", actorOf(req.opsUser), { conversation_id: conversationId, removed_sale_ids: removedIds });
      console.warn(`NEXT LAB reset conversación ${conversationId} por ${req.opsUser.username}; expedientes eliminados: ${removedIds.join(",") || "ninguno"}`);
      return res.json({ ok: true, conversation_id: conversationId, memory_cleared: true, removed_sale_ids: removedIds });
    } catch (error) { return fail(res, error); }
  });

  // ── Tiempo real (SSE) ────────────────────────────────────────────────────
  // Quien ve todas las colas recibe el expediente completo; las áreas solo reciben
  // el detalle de expedientes de su cola y un aviso mínimo de los demás.
  router.get("/operations/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    const user = req.opsUser;
    const queues = new Set(visibleQueues(user));
    const listener = event => {
      let payload = event;
      if (event?.sale) {
        payload = seesAllQueues(user) || queues.has(event.sale.queue)
          ? { ...event, sale: saleView(event.sale, alertHours(), { withEvents: false }) }
          : { type: event.type, sale_id: event.sale.sale_id, queue: event.sale.queue };
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    saleStore.on("sale", listener);
    const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 25000);
    req.on("close", () => { clearInterval(keepAlive); saleStore.off("sale", listener); });
  });

  return router;
}
