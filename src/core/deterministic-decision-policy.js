export function directAnswerDecision({ judgment, orchestration }) {
  const answer = judgment?.directAnswer || orchestration?.directAnswer;
  const request = judgment?.question || orchestration?.directRequest;
  if (!answer || !request) return null;
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
