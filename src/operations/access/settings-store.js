import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./json-file.js";
import { DEFAULT_CUSTOMER_MESSAGES } from "../customer-messages.js";

// Horas que un expediente puede estar en cada área antes de marcarse como atrasado.
export const DEFAULT_ALERT_HOURS = Object.freeze({ capture: 4, validation: 4, validity: 48, payment: 24 });
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function now() { return new Date().toISOString(); }

// Configuración de Operations editable desde Admin.
export class OpsSettingsStore {
  constructor(file, accountsImageFile) {
    this.file = file;
    this.accountsImageFile = accountsImageFile;
    this.data = readJson(file, {});
  }

  persist() { writeJson(this.file, this.data); }

  alertHours() { return { ...DEFAULT_ALERT_HOURS, ...(this.data.alert_hours || {}) }; }
  customerMessages() { return { ...(this.data.customer_messages || {}) }; }
  accountsImage() { return this.data.accounts_image ? { ...this.data.accounts_image } : null; }

  // Pausa global de Mia: mientras esté activa, Mia no responde a ningún cliente.
  miaStatus() { return { paused: Boolean(this.data.mia?.paused), reason: this.data.mia?.reason || null, changed_at: this.data.mia?.changed_at || null, changed_by: this.data.mia?.changed_by || null }; }
  miaPaused() { return Boolean(this.data.mia?.paused); }
  setMiaPaused(paused, { reason = null, actor = null } = {}) {
    this.data.mia = { paused: Boolean(paused), reason: paused ? String(reason || "").trim().slice(0, 300) || null : null, changed_at: now(), changed_by: actor };
    this.persist();
    return this.miaStatus();
  }

  snapshot() {
    return {
      alert_hours: this.alertHours(),
      default_alert_hours: { ...DEFAULT_ALERT_HOURS },
      customer_messages: this.customerMessages(),
      default_customer_messages: { ...DEFAULT_CUSTOMER_MESSAGES },
      accounts_image: this.accountsImage(),
      mia: this.miaStatus(),
      updated_at: this.data.updated_at || null,
      updated_by: this.data.updated_by || null,
    };
  }

  update(patch = {}, actor = null) {
    const next = { ...this.data };
    if (patch.alert_hours) {
      const hours = {};
      for (const [queue, fallback] of Object.entries(DEFAULT_ALERT_HOURS)) {
        const value = patch.alert_hours[queue] ?? next.alert_hours?.[queue] ?? fallback;
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0 || number > 720) throw new Error("Las horas de alerta deben estar entre 1 y 720");
        hours[queue] = Math.round(number * 10) / 10;
      }
      next.alert_hours = hours;
    }
    if (patch.customer_messages) {
      const messages = { ...(next.customer_messages || {}) };
      for (const [key, value] of Object.entries(patch.customer_messages)) {
        if (!(key in DEFAULT_CUSTOMER_MESSAGES)) continue;
        const text = String(value ?? "").trim();
        if (text.length > 2000) throw new Error("Cada mensaje puede tener máximo 2,000 caracteres");
        if (text && text !== DEFAULT_CUSTOMER_MESSAGES[key]) messages[key] = text;
        else delete messages[key];
      }
      next.customer_messages = messages;
    }
    next.updated_at = now();
    next.updated_by = actor;
    this.data = next;
    this.persist();
    return this.snapshot();
  }

  setAccountsImage({ name, content_type, base64 }, actor = null) {
    if (!IMAGE_TYPES.has(String(content_type || ""))) throw new Error("Formato de imagen no permitido. Usa JPG, PNG o WEBP");
    const bytes = Buffer.from(String(base64 || ""), "base64");
    if (!bytes.length) throw new Error("La imagen está vacía");
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("La imagen de cuentas no puede exceder 10 MB");
    fs.mkdirSync(path.dirname(this.accountsImageFile), { recursive: true });
    fs.writeFileSync(this.accountsImageFile, bytes);
    this.data.accounts_image = { name: String(name || "cuentas.jpg").slice(0, 120), content_type, size: bytes.length, updated_at: now(), updated_by: actor };
    this.persist();
    return this.accountsImage();
  }

  clearAccountsImage() {
    try { fs.rmSync(this.accountsImageFile, { force: true }); } catch {}
    delete this.data.accounts_image;
    this.persist();
  }

  // Imagen por defecto lista para adjuntarse a una solicitud de pago.
  accountsImagePayload() {
    const meta = this.accountsImage();
    if (!meta || !fs.existsSync(this.accountsImageFile)) return null;
    return { accounts_image_name: meta.name, accounts_image_content_type: meta.content_type, accounts_image_base64: fs.readFileSync(this.accountsImageFile).toString("base64") };
  }

  accountsImageBytes() {
    const meta = this.accountsImage();
    if (!meta || !fs.existsSync(this.accountsImageFile)) return null;
    return { meta, bytes: fs.readFileSync(this.accountsImageFile) };
  }
}
