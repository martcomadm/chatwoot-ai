import fs from "node:fs";
import express from "express";
import { operationsAppPage } from "./ui/operations-app.js";
import { publicSale } from "./sale-store.js";
import { RETURN_TARGETS } from "./workflow-engine.js";
import { AREAS, ACTION_AREAS, QUEUE_LABELS, areaForQueue, canRequestCall, canRunAction, canSeeSale, hasArea, normalizeAreas, seesAllQueues, visibleQueues } from "./access/areas.js";
import { LoginThrottle, REQUEST_HEADER, actorOf, clearSessionCookie, createAuthenticator, requireArea, requireUser, sessionCookie } from "./access/auth.js";
import { normalizeUsername } from "./access/user-store.js";
import { CASE_KIND_LABELS, CASE_STATUS_LABELS } from "./customer-service/case-store.js";
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

const PWA_DIR = new URL("./ui/pwa/", import.meta.url);
const PWA_FILES = { "icon-192.png": "image/png", "icon-512.png": "image/png", "icon-180.png": "image/png", "manifest.webmanifest": "application/manifest+json" };

export function createOperationsRouter({ config, saleStore, workflow, memories, inspectorEvents, buffer, users, sessions, settings, audit, notifier = null, push = null, chatwoot = null, selfSenders = null, customerService = null }) {
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
  // Service worker y archivos para instalar la página en el celular (avisos con la página cerrada).
  router.get("/operations/sw.js", (_req, res) => {
    res.set("Service-Worker-Allowed", "/operations").set("Cache-Control", "no-cache").type("application/javascript");
    res.send(fs.readFileSync(new URL("sw.js", PWA_DIR), "utf8"));
  });
  router.get("/operations/pwa/:file", (req, res) => {
    const type = PWA_FILES[req.params.file];
    if (!type) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=86400").type(type).send(fs.readFileSync(new URL(req.params.file, PWA_DIR)));
  });
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

  // ── Avisos (Web Push) ────────────────────────────────────────────────────
  router.get("/operations/api/push/key", (req, res) => {
    const subs = push ? push.forUser(req.opsUser.username) : [];
    res.json({ enabled: Boolean(push), public_key: push?.vapid()?.publicKey || null, devices: subs.length });
  });
  router.post("/operations/api/push/subscribe", (req, res) => {
    if (!push) return res.status(503).json({ error: "Avisos no disponibles" });
    if (req.opsUser.via === "token") return fail(res, new Error("El token de Operations no recibe avisos"));
    try { push.add(req.opsUser.username, req.body?.subscription, req.get("user-agent")); res.json({ ok: true, devices: push.forUser(req.opsUser.username).length }); }
    catch (error) { fail(res, error); }
  });
  router.post("/operations/api/push/unsubscribe", (req, res) => {
    if (push && req.body?.endpoint) push.remove(req.opsUser.username, String(req.body.endpoint));
    res.json({ ok: true });
  });
  router.post("/operations/api/push/test", async (req, res) => {
    if (!notifier) return res.status(503).json({ error: "Avisos no disponibles" });
    const result = await notifier.notify({ kind: "test", to: [req.opsUser.username], title: "Avisos activados", body: "Así te llegarán los avisos de Operations.", url: "/operations" });
    res.json({ ok: true, pushed: result.pushed });
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
    // "Abrir en Chatwoot" solo para Supervisión y Cobranza; los demás ven la conversación en el expediente.
    const canOpenChatwoot = hasArea(req.opsUser, "supervision") || hasArea(req.opsUser, "cobranza");
    res.json({ sale: saleView(sale, alertHours()), links: { chatwoot: canOpenChatwoot ? chatwootConversationUrl(sale) : null } });
  });

  // Conversación de WhatsApp (solo lectura) para verla sin entrar a Chatwoot.
  async function conversationItems(conversationId, customerName) {
    const raw = chatwoot.getAllMessages ? await chatwoot.getAllMessages(conversationId) : await chatwoot.getMessages(conversationId);
    const list = Array.isArray(raw?.payload) ? raw.payload : Array.isArray(raw) ? raw : [];
    return list
      .filter(m => m && [0, 1, "incoming", "outgoing"].includes(m.message_type))
      // Notas privadas no, salvo la transcripción de notas de voz (útil para Captura).
      .filter(m => m.private !== true || /^🎤 Transcripción/.test(String(m.content || "")))
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      .slice(-300)
      .map(m => {
        const incoming = m.message_type === 0 || m.message_type === "incoming";
        const own = !incoming && (selfSenders?.isOwn?.(m) || Number(m.sender_id || m.sender?.id || 0) === Number(config.chatwoot?.agentId || -1));
        return {
          id: String(m.id),
          who: m.private ? "nota" : incoming ? "cliente" : own ? "mia" : "persona",
          name: incoming ? (customerName || "Cliente") : own ? "Mia" : (m.sender?.name || "Equipo"),
          text: String(m.content || ""),
          at: new Date(Number(m.created_at || 0) * 1000).toISOString(),
          attachments: (m.attachments || []).map(a => ({ type: String(a.file_type || "").toLowerCase(), url: a.data_url || a.file_url || null, thumb: a.thumb_url || null, name: a.file_name || a.fallback_title || null })).filter(a => a.url),
        };
      });
  }
  async function sendConversation(res, conversationId, customerName) {
    if (!conversationId || !chatwoot) return res.json({ items: [], available: false });
    try { res.json({ items: await conversationItems(conversationId, customerName), available: true }); }
    catch (error) { res.status(502).json({ error: "No se pudo leer la conversación de Chatwoot", detail: String(error?.message || error).slice(0, 200) }); }
  }
  router.get("/operations/api/sales/:id/conversation", async (req, res) => {
    const sale = visibleSale(req, res);
    if (!sale) return;
    return sendConversation(res, sale.conversation_id, sale.customer?.nombre);
  });

  // ── Atención a Clientes ─────────────────────────────────────────────────
  const caseStore = customerService?.store || null;
  const canSeeCases = user => hasArea(user, "atencion") || hasArea(user, "supervision") || (user?.areas || []).includes("observador");
  const caseView = (c, { withEvents = true } = {}) => { const v = structuredClone(c); if (!withEvents) delete v.events; return { ...v, kind_label: CASE_KIND_LABELS[c.kind] || c.kind, status_label: CASE_STATUS_LABELS[c.status] || c.status }; };
  function visibleCase(req, res) {
    if (!caseStore) { res.status(503).json({ error: "Atención a Clientes no disponible" }); return null; }
    if (!canSeeCases(req.opsUser)) { res.status(403).json({ error: "Tu usuario no tiene acceso a Atención a Clientes", code: "forbidden" }); return null; }
    const c = caseStore.get(req.params.id);
    if (!c) { res.status(404).json({ error: "Caso no encontrado" }); return null; }
    return c;
  }
  const canWorkCase = (user, c) => hasArea(user, "supervision") || (hasArea(user, "atencion") && (!c.assignee || c.assignee.username === user.username));
  router.get("/operations/api/cases", (req, res) => {
    if (!caseStore) return res.json({ items: [] });
    if (!canSeeCases(req.opsUser)) return res.status(403).json({ error: "Tu usuario no tiene acceso a Atención a Clientes", code: "forbidden" });
    res.json({ items: caseStore.list().map(c => caseView(c, { withEvents: false })) });
  });
  router.get("/operations/api/cases/people", (req, res) => {
    if (!canSeeCases(req.opsUser)) return res.status(403).json({ error: "Sin acceso", code: "forbidden" });
    res.json({ items: (customerService?.agents() || []).map(u => ({ username: u.username, name: u.name, chatwoot_agent_id: u.chatwoot_agent_id || null })) });
  });
  router.get("/operations/api/cases/:id", (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    const sale = c.sale_id ? saleStore.get(c.sale_id) : null;
    const chatwootLink = (hasArea(req.opsUser, "atencion") || hasArea(req.opsUser, "supervision")) && c.conversation_id ? chatwootConversationUrl({ conversation_id: c.conversation_id }) : null;
    res.json({ case: caseView(c), links: { chatwoot: chatwootLink, sale: sale && canSeeSale(req.opsUser, sale) ? sale.sale_id : null }, can: { work: canWorkCase(req.opsUser, c), assign: hasArea(req.opsUser, "supervision") } });
  });
  router.get("/operations/api/cases/:id/conversation", async (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    return sendConversation(res, c.conversation_id, c.customer?.nombre);
  });
  router.post("/operations/api/cases/:id/take", async (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    if (!hasArea(req.opsUser, "atencion")) return res.status(403).json({ error: "Solo Atención a Clientes puede tomar casos", code: "forbidden" });
    if (c.assignee && c.assignee.username !== req.opsUser.username && !hasArea(req.opsUser, "supervision")) return fail(res, new Error(`Este caso ya lo tiene ${c.assignee.name}`), 409);
    try { res.json({ ok: true, case: caseView(await customerService.assign(c, { username: req.opsUser.username, by: actorOf(req.opsUser) })) }); }
    catch (error) { fail(res, error); }
  });
  router.post("/operations/api/cases/:id/assign", async (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    if (!hasArea(req.opsUser, "supervision")) return res.status(403).json({ error: "Solo Supervisión reasigna casos", code: "forbidden" });
    const username = String(req.body?.username || "");
    if (!customerService.agents().some(a => a.username === username)) return fail(res, new Error("Elige a una persona activa de Atención a Clientes"));
    try { res.json({ ok: true, case: caseView(await customerService.assign(c, { username, by: actorOf(req.opsUser) })) }); }
    catch (error) { fail(res, error); }
  });
  router.post("/operations/api/cases/:id/status", (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    if (!canWorkCase(req.opsUser, c)) return res.status(403).json({ error: "Este caso no es tuyo", code: "forbidden" });
    try { res.json({ ok: true, case: caseView(customerService.setStatus(c.case_id, String(req.body?.status || ""), { note: req.body?.note, by: actorOf(req.opsUser) })) }); }
    catch (error) { fail(res, error); }
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
  router.post(salePath("capture/name"), areaAction("capture/name", (req, body) => workflow.correctCustomerName(req.params.id, body)));
  router.post(salePath("supervision/name"), areaAction("supervision/name", (req, body) => workflow.correctCustomerName(req.params.id, body, { anyStage: true })));
  // Solicitar llamada: disponible para el área que tiene el expediente (y Supervisión), no solo Captura.
  const requestCallHandler = (req, res) => {
    const sale = visibleSale(req, res);
    if (!sale) return;
    if (!canRequestCall(req.opsUser, sale)) return res.status(403).json({ error: "Solo el área que tiene el expediente o Supervisión pueden solicitar la llamada", code: "forbidden" });
    try {
      const area = areaForQueue(sale.queue);
      const body = { ...(req.body || {}), by: req.opsUser.name, area: hasArea(req.opsUser, area) ? area : "supervision" };
      const result = saleStore.runAs(actorOf(req.opsUser), () => workflow.requestCall(req.params.id, body));
      res.json({ ok: true, sale: saleView(result, alertHours()) });
    } catch (error) { fail(res, error); }
  };
  router.post(salePath("capture/call"), requestCallHandler);
  router.post(salePath("call"), requestCallHandler);
  router.post(salePath("capture/curp"), areaAction("capture/curp", (req, body) => workflow.registerCurp(req.params.id, body)));
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
  router.post(salePath("supervision/plan"), areaAction("supervision/plan", (req, body) => workflow.changePlan(req.params.id, body)));
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

  // Pausar / reanudar a Mia para todas las conversaciones (solo Admin). Todos ven el estado.
  router.get("/operations/api/mia", (_req, res) => res.json(settings.miaStatus()));
  router.post("/operations/api/mia/pause", requireArea("admin"), (req, res) => {
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
      const user = users.create({ username: req.body?.username, name: req.body?.name, areas: req.body?.areas, password: req.body?.password, chatwoot_agent_id: req.body?.chatwoot_agent_id });
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
      if (req.body?.chatwoot_agent_id !== undefined) patch.chatwoot_agent_id = req.body.chatwoot_agent_id;
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
    // Avisos dirigidos a esta persona (sonido y aviso dentro de la página).
    const notifyListener = n => { if ((n.to || []).includes(user.username)) res.write(`data: ${JSON.stringify({ type: "notify", notification: { ...n, to: undefined } })}\n\n`); };
    notifier?.on("notify", notifyListener);
    const caseListener = event => { if (canSeeCases(user)) res.write(`data: ${JSON.stringify({ type: "case", case_id: event.case?.case_id })}\n\n`); };
    caseStore?.on("case", caseListener);
    const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 25000);
    req.on("close", () => { clearInterval(keepAlive); saleStore.off("sale", listener); notifier?.off("notify", notifyListener); caseStore?.off("case", caseListener); });
  });

  return router;
}
