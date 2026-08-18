import { INTENTS, INTENT_META } from "./catalog.js";
import { INTENT_RULES } from "./rules.js";

function matchesRule(text, rule) {
  if (rule.all && !rule.all.every(pattern => pattern.test(text))) return false;
  if (rule.any && !rule.any.some(pattern => pattern.test(text))) return false;
  return true;
}

function confidenceFrom(score, runnerUp = 0) {
  if (score <= 0) return 0.35;
  const margin = Math.max(0, score - runnerUp);
  return Math.min(0.99, 0.52 + score * 0.045 + margin * 0.025);
}

export function classifyIntent(text, previousIntent = null) {
  const normalized = String(text || "").trim();
  const scores = new Map();
  const evidence = new Map();
  for (const rule of INTENT_RULES) {
    if (!matchesRule(normalized, rule)) continue;
    scores.set(rule.intent, (scores.get(rule.intent) || 0) + rule.weight);
    evidence.set(rule.intent, [...(evidence.get(rule.intent) || []), rule.evidence]);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  let selected = ranked[0]?.[0] || previousIntent?.id || INTENTS.OTRO;
  let score = ranked[0]?.[1] || 0;
  const runnerUp = ranked[1]?.[1] || 0;
  if (previousIntent?.id && previousIntent.id !== INTENTS.OTRO && previousIntent.confidence >= 0.8 && score < 5) {
    selected = previousIntent.id;
    score = Math.max(score, Math.round(previousIntent.confidence * 10));
  }
  const meta = INTENT_META[selected] || INTENT_META[INTENTS.OTRO];
  return {
    id: selected, label: meta.label, family: meta.family, priority: meta.priority,
    confidence: Number(confidenceFrom(score, runnerUp).toFixed(2)),
    evidence: [...new Set(evidence.get(selected) || previousIntent?.evidence || [])],
    alternatives: ranked.slice(1, 4).map(([id, value]) => ({ id, score: value })),
    classified_at: new Date().toISOString(), source: score > 0 ? "rules" : previousIntent?.source || "fallback"
  };
}
