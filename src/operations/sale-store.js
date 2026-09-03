import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { documentPackageStatus, mergeAttachmentFiles } from "./document-service.js";

function clone(value) { return structuredClone(value); }
function now() { return new Date().toISOString(); }

export class SaleStore extends EventEmitter {
  constructor(file) { super(); this.file = file; this.data = { sequence: 0, sales: {} }; this.load(); }
  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed && typeof parsed === "object") { this.data.sequence = Number(parsed.sequence || 0); this.data.sales = parsed.sales && typeof parsed.sales === "object" ? parsed.sales : {}; }
    } catch (error) { console.warn(`No se pudo leer SaleStore ${this.file}: ${error.message}`); }
  }
  persist() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = `${this.file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2)); fs.renameSync(tmp, this.file); }
  nextId() { this.data.sequence += 1; const date = new Date().toISOString().slice(0, 10).replaceAll("-", ""); return `MART-${date}-${String(this.data.sequence).padStart(5, "0")}`; }
  list(filter = {}) { let items = Object.values(this.data.sales).map(clone); if (filter.status) items = items.filter(item => item.status === filter.status); if (filter.queue) items = items.filter(item => item.queue === filter.queue); return items.sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at))); }
  get(id) { return this.data.sales[id] ? clone(this.data.sales[id]) : null; }
  findByConversationId(conversationId) { const id = Number(conversationId); return this.list().find(item => Number(item.conversation_id) === id) || null; }

  create(input) {
    const saleId = input.sale_id || this.nextId();
    if (this.data.sales[saleId]) throw new Error(`El expediente ${saleId} ya existe`);
    const timestamp = now();
    const sale = {
      sale_id: saleId,
      conversation_id: Number(input.conversation_id || 0) || null,
      contact_id: Number(input.contact_id || 0) || null,
      customer: { nombre: input.customer?.nombre || null, telefono: input.customer?.telefono || null, edad: input.customer?.edad ?? null, actividad: input.customer?.actividad || null, curp: input.customer?.curp || null, nss: input.customer?.nss || null },
      sale: { plan: input.sale?.plan || null, precio: input.sale?.precio ?? null, salario_diario: input.sale?.salario_diario ?? 480, authorized: Boolean(input.sale?.authorized), authorization_text: input.sale?.authorization_text || null },
      documents: { files: mergeAttachmentFiles([], input.documents?.files || []), checklist: null, complete: false, missing: [], updated_at: timestamp },
      status: input.status || "authorized",
      queue: input.queue || "capture",
      capture: { assigned_to: null, assigned_name: null, started_at: null, completed_at: null, notes: "" },
      validation: { datos: false, alta: false, documentos: false, revision_final: false, approved: false, approved_at: null, notes: "" },
      validity: { confirmed: false, document_url: null, document_name: null, confirmed_at: null, notes: "" },
      payment: { requested: false, requested_at: null, received: false, received_at: null, validated: false, validated_at: null, notes: "" },
      events: [], created_at: timestamp, updated_at: timestamp,
    };
    const checklist = documentPackageStatus(sale);
    sale.documents = { ...sale.documents, checklist, complete: checklist.complete, missing: checklist.missing };
    this.data.sales[saleId] = sale;
    this.addEvent(saleId, "sale.created", { status: sale.status, queue: sale.queue, documents_complete: checklist.complete, missing: checklist.missing }, false);
    this.persist(); this.emit("sale", { type: "sale.created", sale: this.get(saleId) }); return this.get(saleId);
  }

  syncDocuments(id, input = {}) {
    const sale = this.data.sales[id];
    if (!sale) throw new Error("Expediente no encontrado");
    sale.customer = { ...sale.customer, ...(input.customer || {}) };
    const files = mergeAttachmentFiles(sale.documents?.files || [], input.files || []);
    const next = { ...sale, documents: { ...(sale.documents || {}), files } };
    const checklist = documentPackageStatus(next);
    sale.documents = { files, checklist, complete: checklist.complete, missing: checklist.missing, updated_at: now() };
    sale.updated_at = now();
    this.addEvent(id, "documents.synced", { complete: checklist.complete, missing: checklist.missing, file_count: files.length }, false);
    this.persist();
    const result = this.get(id);
    this.emit("sale", { type: "documents.synced", sale: result, details: { complete: checklist.complete, missing: checklist.missing } });
    return result;
  }

  update(id, patch, eventType = "sale.updated", eventDetails = {}) {
    const current = this.data.sales[id]; if (!current) throw new Error("Expediente no encontrado");
    this.data.sales[id] = { ...current, ...patch, updated_at: now() }; this.addEvent(id, eventType, eventDetails, false); this.persist(); const sale = this.get(id); this.emit("sale", { type: eventType, sale, details: eventDetails }); return sale;
  }
  addEvent(id, type, details = {}, persist = true) { const current = this.data.sales[id]; if (!current) throw new Error("Expediente no encontrado"); current.events ||= []; current.events.push({ type, at: now(), details }); if (current.events.length > 300) current.events = current.events.slice(-300); current.updated_at = now(); if (persist) this.persist(); }
}
