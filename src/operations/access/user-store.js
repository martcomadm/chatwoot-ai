import crypto from "node:crypto";
import { readJson, writeJson } from "./json-file.js";
import { normalizeAreas } from "./areas.js";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 10;

function now() { return new Date().toISOString(); }

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("base64");
  return { salt, hash };
}

function publicUser(user) {
  if (!user) return null;
  const { password_hash, password_salt, ...rest } = user;
  return structuredClone(rest);
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validatePassword(password) {
  if (String(password || "").length < MIN_PASSWORD_LENGTH) throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
}

// Usuarios de Operations. Las contraseñas se guardan con scrypt + sal por usuario.
export class UserStore {
  constructor(file) {
    this.file = file;
    this.data = readJson(file, { users: {} });
    this.data.users ||= {};
  }

  persist() { writeJson(this.file, this.data, 0o600); }

  count() { return Object.keys(this.data.users).length; }

  list() {
    return Object.values(this.data.users).map(publicUser).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  get(username) { return publicUser(this.data.users[normalizeUsername(username)]); }

  activeAdmins(excluding = null) {
    return Object.values(this.data.users).filter(user => user.active && user.areas.includes("admin") && user.username !== excluding).length;
  }

  create({ username, name, areas, password }) {
    const key = normalizeUsername(username);
    if (!USERNAME_RE.test(key)) throw new Error("El usuario debe tener de 3 a 32 caracteres: letras minúsculas, números, punto, guion o guion bajo");
    if (this.data.users[key]) throw new Error(`El usuario ${key} ya existe`);
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Escribe el nombre de la persona");
    const cleanAreas = normalizeAreas(areas);
    if (!cleanAreas.length) throw new Error("Asigna al menos un área");
    validatePassword(password);
    const { salt, hash } = hashPassword(password);
    const timestamp = now();
    this.data.users[key] = { username: key, name: cleanName, areas: cleanAreas, active: true, password_salt: salt, password_hash: hash, created_at: timestamp, updated_at: timestamp, last_login_at: null, password_changed_at: timestamp };
    this.persist();
    return this.get(key);
  }

  update(username, patch = {}) {
    const key = normalizeUsername(username);
    const user = this.data.users[key];
    if (!user) throw new Error("Usuario no encontrado");
    const next = { ...user };
    if (patch.name !== undefined) {
      next.name = String(patch.name || "").trim();
      if (!next.name) throw new Error("Escribe el nombre de la persona");
    }
    if (patch.areas !== undefined) {
      next.areas = normalizeAreas(patch.areas);
      if (!next.areas.length) throw new Error("Asigna al menos un área");
    }
    if (patch.active !== undefined) next.active = Boolean(patch.active);
    const losesAdmin = user.active && user.areas.includes("admin") && (!next.active || !next.areas.includes("admin"));
    if (losesAdmin && this.activeAdmins(key) === 0) throw new Error("Debe quedar al menos un administrador activo");
    next.updated_at = now();
    this.data.users[key] = next;
    this.persist();
    return this.get(key);
  }

  setPassword(username, password) {
    const key = normalizeUsername(username);
    const user = this.data.users[key];
    if (!user) throw new Error("Usuario no encontrado");
    validatePassword(password);
    const { salt, hash } = hashPassword(password);
    this.data.users[key] = { ...user, password_salt: salt, password_hash: hash, password_changed_at: now(), updated_at: now() };
    this.persist();
    return this.get(key);
  }

  // Devuelve el usuario si la contraseña es correcta y está activo; null en otro caso.
  // Siempre calcula un hash para no revelar por tiempo si el usuario existe.
  verify(username, password) {
    const user = this.data.users[normalizeUsername(username)];
    const salt = user?.password_salt || "sin-usuario";
    const { hash } = hashPassword(password, salt);
    const expected = Buffer.from(user?.password_hash || hash, "base64");
    const actual = Buffer.from(hash, "base64");
    const ok = Boolean(user) && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!ok || !user.active) return null;
    return this.get(user.username);
  }

  markLogin(username) {
    const user = this.data.users[normalizeUsername(username)];
    if (!user) return;
    user.last_login_at = now();
    this.persist();
  }
}
