import { findingCanBlockMerge } from "../findings/index.js";

export class SynthesisError extends Error {
  constructor(message) {
    super(message);
    this.name = "SynthesisError";
  }
}

export function generateSynthesisOptions({ findings = [], conflicts = [] } = {}) {
  if (!Array.isArray(findings)) {
    throw new SynthesisError("findings must be an array");
  }
  if (!Array.isArray(conflicts)) {
    throw new SynthesisError("conflicts must be an array");
  }

  const findingsById = new Map(findings.map((finding) => [finding.finding_id, finding]));
  const options = [];

  for (const conflict of [...conflicts].sort(compareBy("conflict_id"))) {
    const relatedFindings = conflict.finding_ids.map((findingId) => findingsById.get(findingId)).filter(Boolean);
    options.push(freezeOption({
      option_id: `option-conflict-${conflict.conflict_id}`,
      strategy: "resolve_conflict",
      summary: `Resolve ${conflict.type} before finalizing the review.`,
      finding_ids: [...conflict.finding_ids].sort(),
      conflict_ids: [conflict.conflict_id],
      recommended_actions: [
        conflict.summary,
        "Compare cited evidence and choose the fix path that satisfies the related quality rules."
      ],
      tradeoffs: [
        "Requires maintainer or reviewer clarification before the final recommendation is stable."
      ],
      confidence: optionConfidence(relatedFindings, "MEDIUM")
    }));
  }

  for (const finding of [...findings].sort(compareBy("finding_id"))) {
    if (finding.severity === "QUESTION") {
      options.push(freezeOption({
        option_id: `option-clarify-${finding.finding_id}`,
        strategy: "ask_clarification",
        summary: `Ask for clarification on ${finding.finding_id}.`,
        finding_ids: [finding.finding_id],
        conflict_ids: [],
        recommended_actions: [finding.verification_test, finding.suggested_fix],
        tradeoffs: ["Clarification avoids treating uncertain evidence as a blocking decision."],
        confidence: finding.confidence
      }));
      continue;
    }

    if (findingCanBlockMerge(finding)) {
      options.push(freezeOption({
        option_id: `option-fix-${finding.finding_id}`,
        strategy: "request_fix",
        summary: `Request a fix for ${finding.finding_id}.`,
        finding_ids: [finding.finding_id],
        conflict_ids: conflictsForFinding(conflicts, finding.finding_id),
        recommended_actions: [finding.suggested_fix, finding.verification_test],
        tradeoffs: ["Blocks or delays merge until the cited impact is addressed."],
        confidence: finding.confidence
      }));
      continue;
    }

    options.push(freezeOption({
      option_id: `option-comment-${finding.finding_id}`,
      strategy: "comment_only",
      summary: `Leave a non-blocking comment for ${finding.finding_id}.`,
      finding_ids: [finding.finding_id],
      conflict_ids: conflictsForFinding(conflicts, finding.finding_id),
      recommended_actions: [finding.suggested_fix, finding.verification_test],
      tradeoffs: ["Keeps the feedback visible without blocking merge."],
      confidence: finding.confidence
    }));
  }

  return Object.freeze(options.sort(compareBy("option_id")));
}

function conflictsForFinding(conflicts, findingId) {
  return Object.freeze(
    conflicts
      .filter((conflict) => conflict.finding_ids.includes(findingId))
      .map((conflict) => conflict.conflict_id)
      .sort()
  );
}

function optionConfidence(findings, fallback) {
  if (findings.length === 0) {
    return fallback;
  }
  if (findings.some((finding) => finding.confidence === "LOW")) {
    return "LOW";
  }
  if (findings.some((finding) => finding.confidence === "MEDIUM")) {
    return "MEDIUM";
  }
  return "HIGH";
}

function freezeOption(option) {
  return Object.freeze({
    option_id: option.option_id,
    strategy: option.strategy,
    summary: option.summary,
    finding_ids: Object.freeze([...option.finding_ids]),
    conflict_ids: Object.freeze([...option.conflict_ids]),
    recommended_actions: Object.freeze([...option.recommended_actions]),
    tradeoffs: Object.freeze([...option.tradeoffs]),
    confidence: option.confidence
  });
}

function compareBy(key) {
  return (left, right) => String(left[key]).localeCompare(String(right[key]));
}
