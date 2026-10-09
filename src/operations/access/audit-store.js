import { readJson, writeJson } from "./json-file.js";

const MAX_ENTRIES = 5000;

// Bitácora administrativa: inicios de sesión, cambios de usuarios, configuración
// y herramientas LAB. Los movimientos de expedientes viven en cada expediente.
export class OpsAuditStore {
  constructor(file, maxEntries = MAX_ENTRIES) {
    this.file = file;
    this.maxEntries = maxEntries;
    this.data = readJson(file, { entries: [] });
    this.data.entries ||= [];
  }

  record(type, actor = null, details = {}) {
    const entry = { type, at: new Date().toISOString(), actor, details };
    this.data.entries.push(entry);
    if (this.data.entries.length > this.maxEntries) this.data.entries = this.data.entries.slice(-this.maxEntries);
    writeJson(this.file, this.data);
    return entry;
  }

  list() { return this.data.entries.map(entry => structuredClone(entry)); }
}
