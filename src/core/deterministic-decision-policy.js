const FACT_LOCKED_TYPES = new Set([
  "identity",
  "process_time",
  "plan_2_contributions",
  "registered_salary",
  "requirements",
  "price",
  "services",
  "services_plan_1",
  "services_plan_2",
  "trust",
  "b2b",
  "clarify_quote",
  "explain_curp",
  "operational_model",
]);

export function directAnswerDecision({ judgment, orchestration }) {
  const request = judgment?.question || orchestration?.directRequest;
  if (!request || !FACT_LOCKED_TYPES.has(request.type || request.answerKey)) return null;
  const answer = judgment?.directAnswer || orchestration?.directAnswer;
  if (!answer) return null;
  return {
    reply: answer,
    question_key: null,
    add_labels: [],
    remove_labels: [],
    handoff: false,
    handoff_reason: "",
    __deterministic: true,
    __source: `direct:${request.type || request.answerKey || "unknown"}`,
  };
}

export function protectDeterministicDecision(decision, source) {
  if (!decision) return decision;
  return { ...decision, __deterministic: true, __source: source || decision.__source || "deterministic" };
}

export function isDeterministicDecision(decision) {
  return decision?.__deterministic === true;
}

export function shouldSkipAnsweredFallback(decision) {
  return isDeterministicDecision(decision);
}

export function shouldSkipQualityRepair(decision) {
  return isDeterministicDecision(decision);
}

export function stripDecisionMetadata(decision) {
  if (!decision || typeof decision !== "object") return decision;
  const { __deterministic, __source, ...publicDecision } = decision;
  return publicDecision;
}
