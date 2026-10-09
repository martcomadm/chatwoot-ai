import fs from "node:fs";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

function safe(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, "_"); }

// Candado por mensaje del cliente. Garantiza que un mismo mensaje se procese una
// sola vez aunque llegue por dos eventos de Chatwoot a la vez o lo reciban dos
// instancias del servicio que comparten el volumen de datos (p.ej. durante un
// redespliegue). Se apoya en la creación exclusiva de archivos ("wx"), que es
// atómica en el sistema de archivos.
export class TurnLock {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(conversationId, messageId) { return path.join(this.dir, `${safe(conversationId)}-${safe(messageId)}.lock`); }

  // true si este proceso obtuvo el turno; false si alguno de los mensajes ya lo tenía otro.
  claim(conversationId, messageIds = []) {
    const created = [];
    for (const messageId of messageIds) {
      try {
        const fd = fs.openSync(this.file(conversationId, messageId), "wx");
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        fs.closeSync(fd);
        created.push(messageId);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // Otro proceso ya tiene este mensaje: liberar lo que tomamos y ceder el turno.
        for (const id of created) { try { fs.rmSync(this.file(conversationId, id), { force: true }); } catch {} }
        return false;
      }
    }
    return true;
  }

  // Borra candados viejos para que la carpeta no crezca sin límite.
  prune(maxAgeMs = 2 * DAY_MS) {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".lock")) continue;
      const file = path.join(this.dir, name);
      try { if (fs.statSync(file).mtimeMs < cutoff) { fs.rmSync(file, { force: true }); removed += 1; } } catch {}
    }
    return removed;
  }
}
