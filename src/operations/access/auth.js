import crypto from "node:crypto";
import { hasArea } from "./areas.js";

export const SESSION_COOKIE = "martcom_ops";
export const REQUEST_HEADER = "x-ops-request";

// Usuario sintético para el token de entorno (OPERATIONS_TOKEN). Sirve para
// scripts y emergencias; sus acciones quedan registradas como tal.
export const TOKEN_USER = Object.freeze({ username: "token-operaciones", name: "Token de Operaciones", areas: ["admin"], active: true, via: "token" });

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    try { cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { cookies[key] = part.slice(index + 1).trim(); }
  }
  return cookies;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isHttps(req) {
  return req.secure === true || String(req.get?.("x-forwarded-proto") || "").split(",")[0].trim() === "https";
}

export function sessionCookie(req, token, expiresAt) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/operations", "HttpOnly", "SameSite=Strict"];
  if (expiresAt) parts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(req) {
  return sessionCookie(req, "", new Date(0).toISOString());
}

// Limita intentos fallidos de inicio de sesión por usuario e IP.
export class LoginThrottle {
  constructor({ maxFailures = 5, windowMs = 15 * 60 * 1000 } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.failures = new Map();
  }
  key(username, ip) { return `${String(username || "").toLowerCase()}|${ip || ""}`; }
  blockedFor(username, ip) {
    const entry = this.failures.get(this.key(username, ip));
    if (!entry || entry.count < this.maxFailures) return 0;
    const remaining = entry.first + this.windowMs - Date.now();
    if (remaining <= 0) { this.failures.delete(this.key(username, ip)); return 0; }
    return remaining;
  }
  fail(username, ip) {
    const key = this.key(username, ip);
    const entry = this.failures.get(key);
    if (!entry || Date.now() - entry.first > this.windowMs) this.failures.set(key, { count: 1, first: Date.now() });
    else entry.count += 1;
  }
  succeed(username, ip) { this.failures.delete(this.key(username, ip)); }
}

// Resuelve quién hace la petición: sesión por cookie o token de entorno en cabecera.
export function createAuthenticator({ users, sessions, legacyToken }) {
  return function authenticate(req) {
    const headerToken = req.get?.("x-operations-token");
    if (headerToken && legacyToken && safeEqual(headerToken, legacyToken)) return { user: { ...TOKEN_USER }, via: "token" };
    const token = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
    const session = sessions.get(token);
    if (!session) return null;
    const user = users.get(session.username);
    if (!user || !user.active) { sessions.destroy(token); return null; }
    return { user, via: "session", token };
  };
}

// Middleware: exige sesión. Con cookie, las escrituras deben traer la cabecera
// x-ops-request (un sitio externo no puede enviarla sin permiso CORS).
export function requireUser(authenticate) {
  return (req, res, next) => {
    const auth = authenticate(req);
    if (!auth) return res.status(401).json({ error: "Inicia sesión para continuar", code: "auth_required" });
    if (auth.via === "session" && !["GET", "HEAD"].includes(req.method) && req.get(REQUEST_HEADER) !== "1") {
      return res.status(403).json({ error: "Solicitud rechazada: falta la cabecera de Operations", code: "csrf" });
    }
    req.opsUser = auth.user;
    req.opsAuth = auth;
    next();
  };
}

export function requireArea(area) {
  return (req, res, next) => {
    if (!hasArea(req.opsUser, area)) return res.status(403).json({ error: "Tu usuario no tiene acceso a esta área", code: "forbidden" });
    next();
  };
}

export function actorOf(user) {
  if (!user) return null;
  return { username: user.username, name: user.name, via: user.via || "session" };
}
