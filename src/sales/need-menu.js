// Menú numerado en el segundo seguimiento (pedido 4-nov, punto 1).
// Export 29-oct al 4-nov: 92 de 294 clientes escribieron una sola vez y no contestaron la
// primera pregunta (qué buscan o cuándo cotizaron). Responder "2" cuesta menos que contar su
// historial, así que el seguimiento ofrece opciones y Mia sigue la venta con lo que elijan.

export const NEED_MENU_MARK = "Responde con el número";

export const NEED_MENU_TEXT = `Hola de nuevo 😊 Para darte la información correcta, ¿qué te interesa más? ${NEED_MENU_MARK}:
1️⃣ Servicio médico del IMSS
2️⃣ Seguir sumando semanas para mi pensión
3️⃣ Todo lo anterior y además AFORE e INFONAVIT`;

// Lo que equivale a cada opción, en palabras que el resto de Mia ya entiende.
const OPTION_TEXT = {
  1: "Me interesa el servicio médico",
  2: "Quiero seguir sumando semanas para mi pensión",
  3: "Me interesa todo: servicio médico, semanas y también AFORE e INFONAVIT",
};

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\u{FE0F}\u{20E3}]/gu, "").replace(/\s+/g, " ").trim();
}

export function menuWasSent(lastReply = "") {
  return String(lastReply || "").includes(NEED_MENU_MARK);
}

// "2", "la 2", "opción 3", "el uno", "2️⃣", "1 y 2", "las 3". Devuelve el texto equivalente o null.
export function menuChoiceText(lastReply = "", text = "") {
  if (!menuWasSent(lastReply)) return null;
  const v = norm(text).replace(/[.!,;:]+$/g, "").trim();
  if (!v || v.length > 40) return null;
  const WORD = { uno: 1, un: 1, dos: 2, tres: 3 };
  const tokens = [...v.matchAll(/\b([123]|uno|dos|tres)\b/g)].map(m => WORD[m[1]] || Number(m[1]));
  if (!tokens.length) return null;
  // Solo el número con palabras de relleno: "la 2", "opcion 3", "el 1 por favor", "1 y 2", "las dos" (= 3? no: ambigua).
  const filler = v.replace(/\b(?:[123]|uno|dos|tres|la|el|las|los|opcion|opciones|numero|num|no|y|e|por favor|porfavor|porfa|si|me interesa|quiero|seria|creo que|mejor)\b/g, "").replace(/[^a-z]/g, "");
  if (filler.length) return null;
  if (/^las dos$|^los dos$|^ambas?$/.test(v)) return null;
  const unique = [...new Set(tokens)];
  const choice = unique.includes(3) || (unique.includes(1) && unique.includes(2)) ? (unique.includes(3) ? 3 : 2) : unique[0];
  return OPTION_TEXT[choice] || null;
}
