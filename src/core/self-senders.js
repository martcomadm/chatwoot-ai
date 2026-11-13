import fs from "node:fs";
import path from "node:path";

// Cuentas de Chatwoot con las que Mia publica sus mensajes.
//
// El token de la API puede pertenecer a un usuario distinto del agente asignado
// (CHATWOOT_AI_AGENT_ID); por eso los mensajes de Mia pueden aparecer con otro
// sender_id. Para no confundirlos con mensajes de una persona del equipo, se aprende
// el sender_id de cada mensaje que Mia envía y se guarda en disco.

// Textos que siempre son de Mia aunque aún no se conozca su cuenta.
const OWN_TEXT_PATTERNS = [/^¡Gracias por escribir a MARTCOM! Nuestro horario de atención es/];

export class SelfSenders {
  constructor(file = null, initial = []) {
    this.file = file;
    this.ids = new Set(initial.map(Number).filter(Boolean));
    if (file) {
      try { for (const id of JSON.parse(fs.readFileSync(file, "utf8"))?.ids || []) this.ids.add(Number(id)); }
      catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer self-senders:", error.message); }
    }
  }

  learn(message) {
    const id = Number(message?.sender?.id || message?.sender_id || 0);
    if (!id || this.ids.has(id)) return;
    this.ids.add(id);
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ ids: [...this.ids] }, null, 2));
    } catch (error) { console.error("NEXT: no se pudo guardar self-senders:", error.message); }
  }

  isOwn(message) {
    const id = Number(message?.sender_id || message?.sender?.id || 0);
    if (id && this.ids.has(id)) return true;
    const text = String(message?.content || "").trim();
    return OWN_TEXT_PATTERNS.some(re => re.test(text));
  }

  // Envuelve el cliente de Chatwoot para aprender la cuenta en cada envío de Mia.
  wrap(chatwoot) {
    for (const method of ["sendMessage", "sendMessageWithAttachment", "sendTemplate"]) {
      const original = chatwoot[method]?.bind(chatwoot);
      if (!original) continue;
      chatwoot[method] = async (...args) => {
        const result = await original(...args);
        this.learn(result);
        return result;
      };
    }
    return chatwoot;
  }
}
