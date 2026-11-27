// Trazas de diagnóstico del pipeline de adjuntos/INE. Se activan solo con
// DEBUG_TRACE=1 para no llenar los logs (ni el Inspector) en cada mensaje.
export function traceEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.DEBUG_TRACE || "").trim().toLowerCase());
}

export function trace(label, data) {
  if (!traceEnabled()) return;
  console.log(`INE TRACE ${label}`, JSON.stringify(data));
}
