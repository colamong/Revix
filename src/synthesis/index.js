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
    options.push(...conflictOptions(conflict, relatedFindings));
  }

  for (const finding of [...findings].sort(compareBy("finding_id"))) {
    if (finding.severity === "QUESTION") {
      options.push(makeOption({
        option_id: `option-clarify-${finding.finding_id}`,
        strategy: "ask_clarification",
        summary: `Ask for clarification on ${finding.finding_id}.`,
        finding_ids: [finding.finding_id],
        conflict_ids: [],
        recommended_actions: [finding.verification_test, finding.suggested_fix],
        tradeoffs: ["Clarification avoids treating uncertain evidence as a blocking decision."],
        confidence: finding.confidence,
        findings: [finding],
        implementation_cost: 1,
        expected_benefit: "Clarifies whether the cited risk is real before blocking the PR."
      }));
      continue;
    }

    if (findingCanBlockMerge(finding)) {
      options.push(makeOption({
        option_id: `option-fix-${finding.finding_id}`,
        strategy: "request_fix",
        summary: `Request a fix for ${finding.finding_id}.`,
        finding_ids: [finding.finding_id],
        conflict_ids: conflictsForFinding(conflicts, finding.finding_id),
        recommended_actions: [finding.suggested_fix, finding.verification_test],
        tradeoffs: ["Blocks or delays merge until the cited impact is addressed."],
        confidence: finding.confidence,
        findings: [finding],
        implementation_cost: costForFinding(finding),
        expected_benefit: finding.impact
      }));
      continue;
    }

    options.push(makeOption({
      option_id: `option-comment-${finding.finding_id}`,
      strategy: "comment_only",
      summary: `Leave a non-blocking comment for ${finding.finding_id}.`,
      finding_ids: [finding.finding_id],
      conflict_ids: conflictsForFinding(conflicts, finding.finding_id),
      recommended_actions: [finding.suggested_fix, finding.verification_test],
      tradeoffs: ["Keeps the feedback visible without blocking merge."],
      confidence: finding.confidence,
      findings: [finding],
      implementation_cost: 0,
      expected_benefit: "Preserves review signal without blocking merge."
    }));
  }

  return Object.freeze(options.sort(compareBy("option_id")));
}

function conflictOptions(conflict, findings) {
  const sortedFindings = [...findings].sort(compareBy("finding_id"));
  const common = {
    finding_ids: [...conflict.finding_ids].sort(),
    conflict_ids: [conflict.conflict_id],
    confidence: optionConfidence(sortedFindings, conflict.confidence ?? "MEDIUM"),
    findings: sortedFindings
  };
  const options = [
    makeOption({
      ...common,
      option_id: `option-conflict-${conflict.conflict_id}`,
      strategy: "resolve_conflict",
      summary: `Resolve ${conflict.type} before finalizing the review.`,
      recommended_actions: [
        conflict.summary,
        conflict.required_resolution ?? "Compare cited evidence and choose the fix path that satisfies the related quality rules."
      ],
      tradeoffs: ["Requires maintainer or reviewer clarification before the final recommendation is stable."],
      implementation_cost: 2,
      expected_benefit: "Prevents contradictory reviewer guidance from becoming the final recommendation."
    }),
    makeOption({
      ...common,
      option_id: `option-compromise-${conflict.conflict_id}`,
      strategy: "compromise",
      summary: `Apply a compromise for ${conflict.conflict_id}.`,
      recommended_actions: ["Choose a fix that mitigates the highest-impact claim and documents the accepted tradeoff."],
      tradeoffs: ["May not fully satisfy every reviewer preference."],
      implementation_cost: 3,
      expected_benefit: "Balances competing quality rules without ignoring either side."
    }),
    makeOption({
      ...common,
      option_id: `option-minimal-safe-${conflict.conflict_id}`,
      strategy: "minimal_safe_change",
      summary: `Use the smallest safe change for ${conflict.conflict_id}.`,
      recommended_actions: ["Make the least invasive change that resolves hard quality-rule risk first."],
      tradeoffs: ["Leaves non-blocking improvements for follow-up."],
      implementation_cost: 1,
      expected_benefit: "Keeps small PRs moving while preserving hard constraints."
    })
  ];

  for (const finding of sortedFindings) {
    options.push(makeOption({
      ...common,
      option_id: `option-prefer-${finding.finding_id}-${conflict.conflict_id}`,
      strategy: "prefer_reviewer",
      summary: `Prefer ${finding.reviewer_id}'s recommendation for ${conflict.conflict_id}.`,
      recommended_actions: [finding.suggested_fix, finding.verification_test],
      tradeoffs: [`May weaken competing reviewer concerns from ${sortedFindings.filter((candidate) => candidate.finding_id !== finding.finding_id).map((candidate) => candidate.reviewer_id).join(", ") || "other reviewers"}.`],
      implementation_cost: costForFinding(finding),
      expected_benefit: finding.impact,
      preferred_finding_id: finding.finding_id
    }));
  }
  return options;
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

function makeOption(option) {
  const findings = option.findings ?? [];
  const satisfied = [...new Set(findings.flatMap((finding) => finding.related_quality_rules))].sort();
  const weakened = option.strategy === "comment_only" || option.strategy === "prefer_reviewer"
    ? weakenedRulesFor(option, findings)
    : [];
  const scoreDimensions = scoreFor(option, findings, weakened);
  const disqualified = disqualifiedReason(option, findings, weakened);
  return freezeOption({
    description: option.summary,
    required_changes: option.recommended_actions,
    satisfied_quality_rules: satisfied,
    weakened_quality_rules: weakened,
    risk: riskFor(option, findings, weakened, disqualified),
    implementation_cost: option.implementation_cost,
    expected_benefit: option.expected_benefit,
    reviewers_likely_to_accept: reviewersLikelyToAccept(option, findings),
    reviewers_likely_to_reject: reviewersLikelyToReject(option, findings),
    score_dimensions: scoreDimensions,
    disqualified_reason: disqualified,
    ...option
  });
}

function freezeOption(option) {
  return Object.freeze({
    option_id: option.option_id,
    strategy: option.strategy,
    summary: option.summary,
    description: option.description,
    finding_ids: Object.freeze([...option.finding_ids]),
    conflict_ids: Object.freeze([...option.conflict_ids]),
    recommended_actions: Object.freeze([...option.recommended_actions]),
    required_changes: Object.freeze([...option.required_changes]),
    satisfied_quality_rules: Object.freeze([...option.satisfied_quality_rules]),
    weakened_quality_rules: Object.freeze([...option.weakened_quality_rules]),
    risk: option.risk,
    implementation_cost: option.implementation_cost,
    expected_benefit: option.expected_benefit,
    reviewers_likely_to_accept: Object.freeze([...option.reviewers_likely_to_accept]),
    reviewers_likely_to_reject: Object.freeze([...option.reviewers_likely_to_reject]),
    score_dimensions: Object.freeze({ ...option.score_dimensions }),
    disqualified_reason: option.disqualified_reason,
    tradeoffs: Object.freeze([...option.tradeoffs]),
    confidence: option.confidence
  });
}

function costForFinding(finding) {
  if (finding.severity === "BLOCKER") return 3;
  if (finding.severity === "MAJOR") return 2;
  return 1;
}

function weakenedRulesFor(option, findings) {
  if (option.strategy === "prefer_reviewer" && option.preferred_finding_id) {
    return [...new Set(findings
      .filter((finding) => finding.finding_id !== option.preferred_finding_id)
      .flatMap((finding) => finding.related_quality_rules))]
      .sort();
  }
  if (option.strategy === "comment_only") {
    return [...new Set(findings.flatMap((finding) => finding.related_quality_rules))].sort();
  }
  return [];
}

function scoreFor(option, findings, weakened) {
  const tags = new Set(findings.flatMap((finding) => finding.tags));
  const base = {
    security_safety: tags.has("security") ? 4 : 3,
    contract_safety: tags.has("contract") ? 4 : 3,
    reliability: tags.has("reliability") ? 4 : 3,
    correctness: tags.has("correctness") ? 4 : 3,
    performance: tags.has("performance") ? 4 : 3,
    maintainability: tags.has("maintainability") || tags.has("readability") ? 4 : 3,
    testability: tags.has("test") || tags.has("testability") ? 4 : 3,
    observability: tags.has("observability") ? 4 : 3,
    implementation_cost: option.implementation_cost
  };
  if (option.confidence === "LOW") {
    base.correctness = Math.max(1, base.correctness - 1);
    base.testability = Math.max(1, base.testability - 1);
  }
  if (weakened.length > 0) {
    base.security_safety = Math.max(1, base.security_safety - (weakened.some((rule) => rule.startsWith("security.")) ? 2 : 1));
    base.contract_safety = Math.max(1, base.contract_safety - (weakened.some((rule) => rule.startsWith("contract.")) ? 2 : 1));
  }
  return base;
}

function riskFor(option, findings, weakened, disqualified) {
  if (disqualified) return "disqualified";
  if (weakened.some((rule) => rule.startsWith("security.") || rule.startsWith("contract."))) return "high";
  if (option.confidence === "LOW" || findings.some((finding) => finding.confidence === "LOW")) return "medium";
  return "low";
}

function reviewersLikelyToAccept(option, findings) {
  if (option.strategy === "prefer_reviewer" && option.preferred_finding_id) {
    const preferred = findings.find((finding) => finding.finding_id === option.preferred_finding_id);
    return preferred ? [preferred.reviewer_id] : [];
  }
  return [...new Set(findings.map((finding) => finding.reviewer_id))].sort();
}

function reviewersLikelyToReject(option, findings) {
  if (option.strategy !== "prefer_reviewer" || !option.preferred_finding_id) {
    return [];
  }
  return [...new Set(findings.filter((finding) => finding.finding_id !== option.preferred_finding_id).map((finding) => finding.reviewer_id))].sort();
}

function disqualifiedReason(option, findings, weakened) {
  const hasBlockingHardSignal = findings.some((finding) => finding.severity === "BLOCKER" && finding.related_quality_rules.some((rule) => rule.startsWith("security.") || rule.startsWith("contract.")));
  if (hasBlockingHardSignal && weakened.some((rule) => rule.startsWith("security.") || rule.startsWith("contract."))) {
    return "Hard security or contract quality-rule risk is weakened without mitigation.";
  }
  return null;
}

function compareBy(key) {
  return (left, right) => String(left[key]).localeCompare(String(right[key]));
}
