import { interveneConversation, releaseConversation } from "./mia-intervention.js";
import { closeSaleInService, returnSaleToMia } from "./customer-service/service-sale.js";
import { extractContactPhone } from "./sale-factory.js";
import { MARTCOM_KNOWLEDGE } from "../knowledge/martcom.js";

// Reglas confirmadas que ya vienen en el sistema (solo lectura en "Respuestas de Mia").
function fixedRules() {
  return MARTCOM_KNOWLEDGE.split("\n").filter(line => /confirmad[oa]/i.test(line) && /^\s*-/.test(line) && !/datos confirmados/i.test(line)).map(line => line.replace(/^\s*-\s*/, "").trim());
}
import fs from "node:fs";
import { BUILD_LABEL } from "./build-info.js";
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

export function createOperationsRouter({ config, saleStore, workflow, memories, inspectorEvents, buffer, users, sessions, settings, audit, notifier = null, push = null, chatwoot = null, selfSenders = null, customerService = null, miaConsole = null, teamAnswers = null, learningInbox = null, replyFeedback = null, experiments = null, reactivation = null }) {
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

  const canInterveneMia = user => hasArea(user, "captura");
  const canTeachMia = user => hasArea(user, "supervision");
  // Celulares de los clientes: solo Supervisión y Admin (pedido 4-nov).
  // Cobranza también (4-nov): ve Chats de Mia (sin intervenir) con los celulares.
  const isCobranza = user => (user?.areas || []).includes("cobranza");
  const canSeeMiaPhones = user => hasArea(user, "supervision") || isCobranza(user);
  const canSeeMiaChats = user => canInterveneMia(user) || isCobranza(user) || (user?.areas || []).includes("observador");

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
  // Sin caché: después de cada despliegue todos (Admin incluido) ven los botones nuevos al recargar.
  router.get("/operations", (_req, res) => res.set("Cache-Control", "no-store").type("html").send(operationsAppPage()));
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
  router.get("/operations/sales/:id", (_req, res) => res.set("Cache-Control", "no-store").type("html").send(operationsAppPage()));

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
      areas: [...AREAS.filter(area => hasArea(user, area.key)).map(area => ({ ...area })), ...(canSeeMiaChats(user) ? [{ key: "chats", label: "Chats de Mia", queue: null }] : []), ...(canTeachMia(user) ? [{ key: "respuestas", label: "Respuestas de Mia", queue: null }] : [])],
      visible_queues: visibleQueues(user),
      queue_labels: QUEUE_LABELS,
      can: {
        supervise: hasArea(user, "supervision"),
        intervene: canInterveneMia(user),
        mia_phones: canSeeMiaPhones(user),
        admin: hasArea(user, "admin"),
        lab: hasArea(user, "admin") && String(config.appEnv || "").toLowerCase() === "next",
      },
      return_targets: Object.fromEntries(Object.entries(RETURN_TARGETS).map(([key, value]) => [key, value.label])),
      alert_hours: alertHours(),
      accounts_image_configured: Boolean(settings.accountsImage()),
      mia: settings.miaStatus(),
      build: BUILD_LABEL,
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

  // ── Chats de Mia (pedido 3-nov): todas las conversaciones de la IA + intervención de Captura ──
  router.get("/operations/api/mia-chats", async (req, res) => {
    if (!canSeeMiaChats(req.opsUser)) return res.status(403).json({ error: "Tu usuario no tiene acceso a Chats de Mia", code: "forbidden" });
    if (!miaConsole) return res.json({ items: [], total: 0, counts: {} });
    const showPhones = canSeeMiaPhones(req.opsUser);
    const result = miaConsole.rescueList({ search: String(req.query.q || ""), filter: String(req.query.filter || "all"), days: Number(req.query.days || 7), page: Number(req.query.page || 1), searchPhones: showPhones, sort: req.query.sort === "score" ? "score" : "recent" });
    if (!showPhones) return res.json({ ...result, items: result.items.map(({ phone, ...item }) => item) });
    // Chats anteriores a que Mia guardara el celular: se busca en Chatwoot (hasta 40 por carga) y se guarda.
    const missing = result.items.filter(item => !item.phone).slice(0, 40);
    for (let i = 0; i < missing.length && chatwoot?.getConversation; i += 5) {
      await Promise.all(missing.slice(i, i + 5).map(async item => {
        try {
          const phone = extractContactPhone(await chatwoot.getConversation(item.id));
          if (phone) { item.phone = phone; await memories.merge(item.id, { contact_phone: phone }); }
        } catch {}
      }));
    }
    res.json(result);
  });
  router.get("/operations/api/mia-chats/:id/conversation", async (req, res) => {
    if (!canSeeMiaChats(req.opsUser)) return res.status(403).json({ error: "Sin acceso", code: "forbidden" });
    const memory = memories.get(req.params.id);
    const id = Number(req.params.id);
    if (!id || !chatwoot) return res.json({ items: [], available: false });
    try {
      res.json({ items: await conversationItems(id, memory?.nombre || null), available: true, ratings: replyFeedback?.forConversation(id) || {}, can_rate: canInterveneMia(req.opsUser) && Boolean(replyFeedback) });
    } catch (error) { res.status(502).json({ error: "No se pudo leer la conversación de Chatwoot", detail: String(error?.message || error).slice(0, 200) }); }
  });
  // Calificar una respuesta de Mia (4-nov): 👍 o 👎 con "así debió contestar".
  router.post("/operations/api/mia-chats/:id/rate", async (req, res) => {
    if (!canInterveneMia(req.opsUser) || !replyFeedback) return res.status(403).json({ error: "Solo Captura, Supervisión o Admin califican respuestas", code: "forbidden" });
    try {
      const id = Number(req.params.id);
      const items = await conversationItems(id, null);
      const index = items.findIndex(m => m.id === String(req.body?.message_id || ""));
      if (index < 0 || items[index].who !== "mia") throw new Error("Solo se califican mensajes de Mia");
      // Lo que el cliente escribió justo antes de esa respuesta (desde el último mensaje del equipo o de Mia).
      const batch = [];
      for (let k = index - 1; k >= 0 && batch.length < 5; k--) {
        if (items[k].who === "nota") continue;
        if (items[k].who !== "cliente") break;
        if (items[k].text) batch.unshift(items[k].text);
      }
      const customerText = batch.join("\n");
      const item = replyFeedback.rate({ conversationId: id, messageId: items[index].id, rating: req.body?.rating, correction: req.body?.correction, note: req.body?.note, miaText: items[index].text, customerText, user: req.opsUser });
      try { await inspectorEvents?.record?.(id, "reply_rated", { rating: item.rating, by: item.by, message_id: item.message_id }); } catch {}
      audit.record("mia.reply.rate", actorOf(req.opsUser), { conversation_id: id, message_id: item.message_id, rating: item.rating });
      res.json({ ok: true, item });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-chats/:id/intervene", async (req, res) => {
    if (!canInterveneMia(req.opsUser)) return res.status(403).json({ error: "Solo Captura, Supervisión o Admin pueden intervenir", code: "forbidden" });
    try {
      await interveneConversation({ memories, chatwoot, conversationId: req.params.id, user: req.opsUser, note: req.body?.note, audit, inspectorEvents });
      res.json({ ok: true, chatwoot_url: chatwootConversationUrl({ conversation_id: Number(req.params.id) }) });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-chats/:id/release", async (req, res) => {
    if (!canInterveneMia(req.opsUser)) return res.status(403).json({ error: "Solo Captura, Supervisión o Admin pueden regresar chats a Mia", code: "forbidden" });
    try {
      await releaseConversation({ memories, chatwoot, conversationId: req.params.id, user: req.opsUser, miaAgentId: config?.chatwoot?.agentId || null, note: req.body?.note, canForce: hasArea(req.opsUser, "supervision"), audit, inspectorEvents });
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  // ── Respuestas de Mia (4-nov): el equipo enseña a Mia sin redespliegue ──
  const teachGuard = (req, res) => {
    if (!canTeachMia(req.opsUser)) { res.status(403).json({ error: "Solo Supervisión y Admin pueden editar las respuestas de Mia", code: "forbidden" }); return false; }
    if (!teamAnswers) { res.status(503).json({ error: "Respuestas de Mia no disponibles" }); return false; }
    return true;
  };
  const who = user => user?.name || user?.username || null;
  router.get("/operations/api/mia-answers", (req, res) => {
    if (!teachGuard(req, res)) return;
    res.json({ items: teamAnswers.list(), fixed: fixedRules(), open_learning: learningInbox?.list({ status: "open" }).length || 0, open_feedback: replyFeedback?.list({ status: "open" }).length || 0 });
  });
  router.post("/operations/api/mia-answers", (req, res) => {
    if (!teachGuard(req, res)) return;
    try {
      const item = teamAnswers.create({ topic: req.body?.topic, answer: req.body?.answer, phrases: req.body?.phrases, active: req.body?.active }, who(req.opsUser));
      audit.record("mia.answer.create", actorOf(req.opsUser), { id: item.id, topic: item.topic });
      res.json({ ok: true, item });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-answers/:id", (req, res) => {
    if (!teachGuard(req, res)) return;
    try {
      const item = teamAnswers.update(req.params.id, { topic: req.body?.topic, answer: req.body?.answer, phrases: req.body?.phrases, active: req.body?.active }, who(req.opsUser));
      audit.record("mia.answer.update", actorOf(req.opsUser), { id: item.id, topic: item.topic, active: item.active });
      res.json({ ok: true, item });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-answers/:id/delete", (req, res) => {
    if (!teachGuard(req, res)) return;
    try {
      const item = teamAnswers.get(req.params.id);
      teamAnswers.remove(req.params.id);
      audit.record("mia.answer.delete", actorOf(req.opsUser), { id: req.params.id, topic: item?.topic || null });
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  // Reactivación de prospectos con plantillas (5-nov).
  router.get("/operations/api/reactivation", (req, res) => {
    if (!teachGuard(req, res)) return;
    if (!reactivation) return res.json({ available: false });
    const all = memories.list?.() || [];
    const contacted = all.filter(m => (m.reactivation?.sent || []).length || m.reactivation?.docs_reminder_at);
    const firstSent = m => Date.parse(m.reactivation?.sent?.[0]?.at || m.reactivation?.docs_reminder_at || "") || 0;
    // Un renglón por cliente para filtrar en Operations (6-nov): contestaron, sin respuesta, aceptaron…
    const clientOf = m => {
      const sends = [...(m.reactivation?.sent || []).map(x => ({ template: x.template, at: x.at })), ...(m.reactivation?.docs_reminder_at ? [{ template: "recordatorio1", at: m.reactivation.docs_reminder_at }] : [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const last = sends.at(-1) || {};
      const repliedAt = Date.parse(m.reactivation?.replied_at || "") > firstSent(m) ? m.reactivation.replied_at : null;
      const docs = Boolean(m.reactivation?.docs_reminder_at);
      const accepted = Boolean(m.sales_cycle?.authorized) && !docs;
      const docsCompleted = docs && Boolean(m.operations?.documents_complete);
      const status = m.no_contact ? "no_contact" : docsCompleted ? "docs_completed" : accepted ? "accepted" : repliedAt ? "replied" : "waiting";
      return { id: Number(m.id), name: m.nombre || null, status, replied: Boolean(repliedAt), replied_at: repliedAt, accepted, docs_completed: docsCompleted, no_contact: Boolean(m.no_contact), sends: sends.length, last_template: last.template || null, last_at: last.at || null, plan: m.sales_cycle?.selected_plan || m.sales_cycle?.recommended_plan || null };
    };
    const clients = [...new Map([...contacted, ...all.filter(m => m.no_contact && (m.reactivation?.sent || []).length)].map(m => [String(m.id), m])).values()].map(clientOf)
      .sort((a, b) => String(b.replied_at || b.last_at || "").localeCompare(String(a.replied_at || a.last_at || "")));
    const preview = reactivation.plan();
    const byTemplate = {};
    for (const item of preview) byTemplate[item.template] = (byTemplate[item.template] || 0) + 1;
    res.json({
      available: true,
      config: settings.reactivation(),
      sent_today: reactivation.sentToday(),
      pending_now: preview.length,
      pending_by_template: byTemplate,
      results: {
        contacted: contacted.length,
        replied: contacted.filter(m => Date.parse(m.reactivation?.replied_at || "") > firstSent(m)).length,
        accepted: contacted.filter(m => m.sales_cycle?.authorized && !m.reactivation?.docs_reminder_at).length,
        docs_completed: contacted.filter(m => m.reactivation?.docs_reminder_at && m.operations?.documents_complete).length,
        no_contact: all.filter(m => m.no_contact).length,
      },
      clients,
      // Chats que la reactivación se saltó (9-nov): no están asignados a Mia, o tienen etiqueta de cierre / pausa.
      skipped: all.reduce((acc, m) => { const b = m.reactivation?.blocked_label; if (b) { const k = b === "not_mia" ? "not_mia" : b === "pausar_mia" ? "paused" : "closed"; acc[k] = (acc[k] || 0) + 1; } return acc; }, {}),
      recent: contacted.flatMap(m => [...(m.reactivation?.sent || []).map(x => ({ id: Number(m.id), name: m.nombre || null, template: x.template, at: x.at })), ...(m.reactivation?.docs_reminder_at ? [{ id: Number(m.id), name: m.nombre || null, template: "recordatorio1", at: m.reactivation.docs_reminder_at }] : [])].map(x => ({ ...x, replied: Date.parse(m.reactivation?.replied_at || "") > Date.parse(x.at) }))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30),
    });
  });
  router.post("/operations/api/reactivation", (req, res) => {
    if (!teachGuard(req, res)) return;
    try {
      const config = settings.setReactivation({ enabled: req.body?.enabled, daily_cap: req.body?.daily_cap }, actorOf(req.opsUser));
      audit.record("reactivation.config", actorOf(req.opsUser), config);
      res.json({ ok: true, config });
    } catch (error) { fail(res, error); }
  });

  // Pruebas A/B de mensajes (4-nov).
  router.get("/operations/api/mia-experiments", (req, res) => {
    if (!teachGuard(req, res)) return;
    if (!experiments) return res.json({ slots: [], items: [] });
    const all = memories.list?.() || [];
    res.json({ slots: experiments.slots(), items: experiments.list().reverse().map(item => ({ ...item, results: experiments.results(item.id, all) })) });
  });
  router.post("/operations/api/mia-experiments", (req, res) => {
    if (!teachGuard(req, res) || !experiments) return;
    try {
      const item = experiments.create({ slot: req.body?.slot, name: req.body?.name, bText: req.body?.b_text }, who(req.opsUser));
      audit.record("mia.experiment.start", actorOf(req.opsUser), { id: item.id, slot: item.slot });
      res.json({ ok: true, item });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-experiments/:id/finish", (req, res) => {
    if (!teachGuard(req, res) || !experiments) return;
    try {
      const item = experiments.finish(req.params.id, req.body?.winner, who(req.opsUser));
      audit.record("mia.experiment.finish", actorOf(req.opsUser), { id: item.id, slot: item.slot, winner: item.winner });
      res.json({ ok: true, item });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-experiments/override/:slot/clear", (req, res) => {
    if (!teachGuard(req, res) || !experiments) return;
    try {
      experiments.clearOverride(req.params.slot);
      audit.record("mia.experiment.revert", actorOf(req.opsUser), { slot: req.params.slot });
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  router.get("/operations/api/mia-feedback", (req, res) => {
    if (!teachGuard(req, res)) return;
    res.json({ items: replyFeedback?.list({ status: String(req.query.status || "open") }).slice(0, 200) || [], stats: replyFeedback?.stats() || null });
  });
  router.post("/operations/api/mia-feedback/:id/convert", (req, res) => {
    if (!teachGuard(req, res)) return;
    try {
      const item = replyFeedback.list({ status: "all" }).find(i => i.id === req.params.id);
      if (!item) throw new Error("No existe esa calificación");
      const answer = teamAnswers.create({ topic: req.body?.topic, answer: req.body?.answer, phrases: req.body?.phrases, source: "learned", learned_from: { conversation_id: item.conversation_id, message_id: item.message_id, by: item.by, kind: "correction" } }, who(req.opsUser));
      replyFeedback.resolve(item.id, "converted", who(req.opsUser), answer.id);
      audit.record("mia.answer.learned", actorOf(req.opsUser), { id: answer.id, topic: answer.topic, conversation_id: item.conversation_id, from: "correction" });
      res.json({ ok: true, item: answer });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-feedback/:id/archive", (req, res) => {
    if (!teachGuard(req, res)) return;
    try { replyFeedback.resolve(req.params.id, "archived", who(req.opsUser)); res.json({ ok: true }); } catch (error) { fail(res, error); }
  });
  router.get("/operations/api/mia-learning", (req, res) => {
    if (!teachGuard(req, res)) return;
    res.json({ items: learningInbox?.list({ status: String(req.query.status || "open") }).slice(0, 200) || [], scanning: Boolean(learningInbox?.running) });
  });
  router.post("/operations/api/mia-learning/scan", async (req, res) => {
    if (!teachGuard(req, res)) return;
    try { res.json({ ok: true, ...(await learningInbox?.scan()) }); } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-learning/:id/convert", (req, res) => {
    if (!teachGuard(req, res)) return;
    try {
      const item = learningInbox.list({ status: "all" }).find(i => i.id === req.params.id);
      if (!item) throw new Error("No existe esa pregunta");
      const answer = teamAnswers.create({ topic: req.body?.topic, answer: req.body?.answer, phrases: req.body?.phrases, source: "learned", learned_from: { conversation_id: item.conversation_id, message_id: item.message_id, by: item.by } }, who(req.opsUser));
      learningInbox.resolve(item.id, "converted", who(req.opsUser), answer.id);
      audit.record("mia.answer.learned", actorOf(req.opsUser), { id: answer.id, topic: answer.topic, conversation_id: item.conversation_id });
      res.json({ ok: true, item: answer });
    } catch (error) { fail(res, error); }
  });
  router.post("/operations/api/mia-learning/:id/dismiss", (req, res) => {
    if (!teachGuard(req, res)) return;
    try { learningInbox.resolve(req.params.id, "dismissed", who(req.opsUser)); res.json({ ok: true }); } catch (error) { fail(res, error); }
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
  // Caso con alguien que no está en el área (solo en Chatwoot): cualquiera de Atención lo puede tomar.
  const canWorkCase = (user, c) => hasArea(user, "supervision") || (hasArea(user, "atencion") && (!c.assignee?.username || c.assignee.username === user.username));
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
    const service = sale?.service?.open ? { reason: sale.service.reason, from_area: sale.service.from_area, from_queue: sale.service.from_queue, queue: sale.queue, queue_label: QUEUE_LABELS[sale.queue] || sale.queue, targets: Object.entries(RETURN_TARGETS).map(([key, t]) => ({ key, label: t.label, origin: key === sale.queue })) } : null;
    res.json({ case: caseView(c), service, links: { chatwoot: chatwootLink, sale: sale && canSeeSale(req.opsUser, sale) ? sale.sale_id : null }, can: { work: canWorkCase(req.opsUser, c), assign: hasArea(req.opsUser, "supervision"), return: Boolean(service) && canWorkCase(req.opsUser, c) } });
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
    if (c.assignee?.username && c.assignee.username !== req.opsUser.username && !hasArea(req.opsUser, "supervision")) return fail(res, new Error(`Este caso ya lo tiene ${c.assignee.name}`), 409);
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

  // Venta cerrada por Atención a Clientes (28-oct): el cliente se queda con Atención y Mia ya no sigue la venta.
  router.post("/operations/api/cases/:id/close-sale", async (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    if (!canWorkCase(req.opsUser, c)) return res.status(403).json({ error: "Este caso no es tuyo", code: "forbidden" });
    try { res.json({ ok: true, case: caseView(await closeSaleInService({ customerService, memories, chatwoot, c, user: req.opsUser, plan: String(req.body?.plan || ""), note: req.body?.note })) }); }
    catch (error) { fail(res, error); }
  });
  router.post("/operations/api/cases/:id/return-to-mia", async (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    if (!canWorkCase(req.opsUser, c)) return res.status(403).json({ error: "Este caso no es tuyo", code: "forbidden" });
    try { res.json({ ok: true, case: caseView(await returnSaleToMia({ customerService, memories, chatwoot, c, user: req.opsUser, miaAgentId: config?.chatwoot?.agentId || null, note: req.body?.note })) }); }
    catch (error) { fail(res, error); }
  });

  // Atención a Clientes regresa el expediente: a la misma área (ya se solucionó) o a otra que deba revisarlo.
  router.post("/operations/api/cases/:id/return", async (req, res) => {
    const c = visibleCase(req, res);
    if (!c) return;
    if (!canWorkCase(req.opsUser, c)) return res.status(403).json({ error: "Este caso no es tuyo", code: "forbidden" });
    const sale = c.sale_id ? saleStore.get(c.sale_id) : null;
    if (!sale?.service?.open) return fail(res, new Error("Este caso no tiene un expediente enviado por un área"));
    const target = String(req.body?.target || "origin");
    const note = String(req.body?.note || "").trim();
    try {
      const result = saleStore.runAs(actorOf(req.opsUser), () => workflow.returnFromService(sale.sale_id, { target, note, by: req.opsUser.name }));
      const label = QUEUE_LABELS[result.queue] || result.queue;
      const closed = customerService.setStatus(c.case_id, "resolved", { note: `Regresado a ${label}: ${note}`, by: actorOf(req.opsUser) });
      // La conversación vuelve con Mia para que siga el trámite con el cliente.
      if (sale.conversation_id && chatwoot?.assignConversation && config?.chatwoot?.agentId) {
        try { await chatwoot.assignConversation(sale.conversation_id, Number(config.chatwoot.agentId)); } catch {}
      }
      res.json({ ok: true, case: caseView(closed), sale: saleView(result, alertHours()) });
    } catch (error) { fail(res, error); }
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
        const area = AREAS.find(item => item.key === [].concat(ACTION_AREAS[action])[0]);
        return res.status(403).json({ error: `Esta acción corresponde a ${area?.label || "otra área"}`, code: "forbidden" });
      }
      const sale = visibleSale(req, res);
      if (!sale) return;
      // Mientras Atención a Clientes lo tiene, el área no lo mueve (Supervisión sí puede).
      if (sale.service?.open && !String(action).startsWith("supervision/") && !(req.opsUser?.areas || []).includes("admin")) return res.status(409).json({ error: "El expediente está en Atención a Clientes; espera a que lo regresen", code: "in_service" });
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
  // Enviar a Atención a Clientes con el motivo: abre (o anota) el caso con responsable por rotación.
  router.post(salePath("service"), async (req, res) => {
    const sale = visibleSale(req, res);
    if (!sale) return;
    if (!canRequestCall(req.opsUser, sale)) return res.status(403).json({ error: "Solo el área que tiene el expediente o Supervisión pueden enviarlo a Atención a Clientes", code: "forbidden" });
    if (!customerService) return res.status(503).json({ error: "Atención a Clientes no disponible" });
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return fail(res, new Error("Escribe por qué lo mandas a Atención a Clientes"));
    if (sale.service?.open) return fail(res, new Error("El expediente ya está en Atención a Clientes"), 409);
    const area = hasArea(req.opsUser, areaForQueue(sale.queue)) ? areaForQueue(sale.queue) : "supervision";
    const areaLabel = AREAS.find(a => a.key === area)?.label || area;
    try {
      const c = await customerService.openCase({ conversation_id: sale.conversation_id, kind: "escalated", reason: `${areaLabel}: ${reason}`, sale, from: actorOf(req.opsUser) });
      // Si el cliente ya tenía un caso abierto, ese caso se liga al expediente.
      if (!c.sale_id || c.kind !== "escalated") customerService.store.update(c.case_id, { sale_id: sale.sale_id, kind: "escalated", reason: c.reason || `${areaLabel}: ${reason}` }, "case.linked_sale", { sale_id: sale.sale_id });
      const result = saleStore.runAs(actorOf(req.opsUser), () => workflow.sendToService(sale.sale_id, { reason, area, case_id: c.case_id, by: req.opsUser.name }));
      res.json({ ok: true, sale: saleView(result, alertHours()), case_id: c.case_id });
    } catch (error) { fail(res, error); }
  });
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
  router.post(salePath("supervision/drop"), areaAction("supervision/drop", (req, body) => workflow.dropForNonPayment(req.params.id, body)));
  router.post(salePath("supervision/reactivate"), areaAction("supervision/reactivate", (req, body) => workflow.reactivateAfterPayment(req.params.id, body)));
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
