import { resolveAnswer } from "./answer-resolver.js";
import { normalizeSemantic } from "./normalizer.js";
import { resolveSemanticConflicts } from "./conflict-resolver.js";
import { detectFrustration } from "./frustration.js";

function resolvedFromPatch(patch = {}) {
  const keys = [];
  if (patch.nombre) keys.push("nombre");
  if (patch.edad !== null && patch.edad !== undefined) keys.push("edad");
  if (patch.actividad) keys.push("actividad");
  if (patch.tiene_imss !== null && patch.tiene_imss !== undefined) keys.push("tiene_imss");
  if (patch.necesidad_principal) keys.push("necesidad_principal");
  if (patch.curp_recibida) keys.push("curp");
  if (patch.nss_recibido) keys.push("nss");
  return keys;
}

export function analyzeReliability(text, memory, fastPatch = {}) {
  const answer = resolveAnswer(text, memory);
  const deterministicPatch = {
    ...fastPatch,
    ...answer.patch,
    contexto_laboral: { ...(fastPatch.contexto_laboral || {}), ...(answer.patch.contexto_laboral || {}) },
    caso_fallecimiento: { ...(fastPatch.caso_fallecimiento || {}), ...(answer.patch.caso_fallecimiento || {}) },
    slots: { ...(fastPatch.slots || {}), ...(answer.patch.slots || {}) },
  };

  const resolvedQuestions = [...new Set([
    ...(memory?.resolved_questions || []),
    ...resolvedFromPatch(deterministicPatch),
    ...answer.resolved,
  ])];

  const semantic = normalizeSemantic(text);
  const conflicts = resolveSemanticConflicts(memory, deterministicPatch);
  const frustration = detectFrustration(text);

  return {
    patch: { ...deterministicPatch, resolved_questions: resolvedQuestions },
    answerEvents: answer.events,
    semanticEvents: semantic,
    conflictEvents: conflicts.events,
    contradictions: conflicts.contradictions,
    frustration,
  };
}
