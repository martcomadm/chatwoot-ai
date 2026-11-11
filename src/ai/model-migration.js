// Modelos que OpenAI retira (aviso del 11-nov): GPT-5 y o3 se apagan el 11-dic-2026 y gpt-4o-mini-transcribe el
// 26-feb-2027. Si EasyPanel todavía tiene uno de esos nombres, NEXT usa el reemplazo que recomienda OpenAI
// (https://developers.openai.com/api/docs/deprecations) sin tener que tocar las variables. Si el reemplazo falla
// porque la cuenta aún no lo tiene, se usa el modelo anterior mientras siga vivo.
const RETIRED = {
  "gpt-5": "gpt-5.6-sol", "gpt-5-2025-08-07": "gpt-5.6-sol",
  "gpt-5-mini": "gpt-5.6-terra", "gpt-5-mini-2025-08-07": "gpt-5.6-terra",
  "gpt-5-nano": "gpt-5.6-luna", "gpt-5-nano-2025-08-07": "gpt-5.6-luna",
  "gpt-5-pro": "gpt-5.6-sol", "gpt-5-pro-2025-10-06": "gpt-5.6-sol",
  "o3": "gpt-5.6-sol", "o3-2025-04-16": "gpt-5.6-sol",
  "o3-pro": "gpt-5.6-sol", "o3-pro-2025-06-10": "gpt-5.6-sol",
  "gpt-4o-mini-transcribe": "gpt-transcribe", "gpt-4o-mini-transcribe-2025-03-20": "gpt-transcribe", "gpt-4o-mini-transcribe-2025-12-15": "gpt-transcribe",
};

// { model, previous }: previous es el nombre retirado (para usarlo de respaldo) o null.
export function currentModel(name) {
  const model = String(name || "").trim();
  const next = RETIRED[model.toLowerCase()];
  return next ? { model: next, previous: model } : { model: model || null, previous: null };
}

// ¿El error dice que el modelo no existe o la cuenta no tiene acceso? (no se reintenta por otros errores)
export function modelUnavailable(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = `${error?.code || ""} ${error?.error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return /model_not_found|does not exist|do not have access|not have access to model|unsupported model|invalid model|model .* not (?:found|available|supported)/.test(text)
    || (status === 404 && /model/.test(text));
}

// Envuelve el cliente de OpenAI: cada llamada con un modelo actualizado que falle por "modelo no disponible"
// se repite con el nombre anterior. Avisa una vez en los logs.
export function withModelFallback(openai, previousOf, log = console) {
  const warned = new Set();
  const wrap = (fn, self) => async (params, options) => {
    try { return await fn.call(self, params, options); }
    catch (error) {
      const previous = previousOf.get(params?.model);
      if (!previous || !modelUnavailable(error)) throw error;
      if (!warned.has(params.model)) { warned.add(params.model); log.error?.(`NEXT: el modelo ${params.model} no está disponible en esta cuenta; se usa ${previous} (se retira pronto).`); }
      return fn.call(self, { ...params, model: previous }, options);
    }
  };
  return new Proxy(openai, {
    get(target, prop) {
      if (prop === "responses" && target.responses) return { ...target.responses, create: wrap(target.responses.create, target.responses) };
      if (prop === "audio" && target.audio?.transcriptions) return { ...target.audio, transcriptions: { ...target.audio.transcriptions, create: wrap(target.audio.transcriptions.create, target.audio.transcriptions) } };
      return target[prop];
    },
  });
}

// Aplica la migración a la configuración de OpenAI. Devuelve la config nueva y el mapa nuevo→anterior.
export function migrateOpenAiConfig(openaiConfig = {}) {
  const previousOf = new Map();
  const out = { ...openaiConfig };
  const changes = [];
  for (const key of ["model", "strongModel", "transcribeModel"]) {
    if (!out[key]) continue;
    const { model, previous } = currentModel(out[key]);
    if (previous) { out[key] = model; previousOf.set(model, previous); changes.push(`${previous} → ${model}`); }
  }
  return { config: out, previousOf, changes };
}
