// 17-nov (pedido de Dirección): cuando Mia pide o menciona el NSS, que diga "número de seguridad social" para que
// el cliente no se confunda con la sigla. Se aplica al texto que sale hacia el cliente (no a lo que se guarda en
// memoria, para que las comparaciones con los textos fijos sigan funcionando).
export function clarifyNss(text) {
  const value = String(text ?? "");
  if (!/\bNSS\b/.test(value) || /seguridad social/i.test(value)) return value;
  return value.replace(/\bNSS\b/, "número de seguridad social (NSS)");
}
