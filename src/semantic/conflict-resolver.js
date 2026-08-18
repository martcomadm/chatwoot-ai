import { semanticEquivalent } from "./normalizer.js";

function conflictId(field, previousValue, nextValue) {
  return `${field}:${String(previousValue)}|${String(nextValue)}`;
}

export function resolveSemanticConflicts(memory, patch = {}) {
  const contradictions = [];
  const events = [];
  const resolved = new Set(memory?.conflictos_resueltos || []);
  const fields = ["tipo_trabajo", "tiene_imss"];

  for (const field of fields) {
    const previousValue = memory?.[field];
    const nextValue = patch?.[field];
    if (previousValue === null || previousValue === undefined || nextValue === null || nextValue === undefined) continue;
    if (semanticEquivalent(field, previousValue, nextValue)) {
      events.push({ type: "equivalent", field, previousValue, nextValue });
      continue;
    }
    const id = conflictId(field, previousValue, nextValue);
    if (!resolved.has(id)) {
      contradictions.push({ id, field, previousValue, nextValue, status: "pending" });
      events.push({ type: "conflict", id, field, previousValue, nextValue });
    }
  }

  return { contradictions, events };
}

export function markConflictResolved(memory, field) {
  const conflicts = Array.isArray(memory?.contradicciones) ? memory.contradicciones : [];
  const ids = conflicts.filter((item) => typeof item === "object" && item?.field === field && item?.id).map((item) => item.id);
  return [...new Set([...(memory?.conflictos_resueltos || []), ...ids])];
}
