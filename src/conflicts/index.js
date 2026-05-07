export class ConflictDetectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictDetectionError";
  }
}

const BLOCKING = new Set(["BLOCKER", "MAJOR"]);
const LOW = new Set(["QUESTION", "NIT"]);
const CONFLICT_TYPE_ALIASES = Object.freeze({
  severity_conflict: "severity_mismatch",
  claim_contradiction: "contract_vs_implementation",
  fix_conflict: "reliability_vs_complexity",
  scope_conflict: "architecture_vs_scope",
  confidence_conflict: "duplicate_or_overlapping_findings",
  security_vs_performance: "security_vs_performance"
});

export function detectConflicts(findings) {
  if (!Array.isArray(findings)) {
    throw new ConflictDetectionError("findings must be an array");
  }
  const conflicts = [];
  const sorted = [...findings].sort((left, right) => left.finding_id.localeCompare(right.finding_id));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const left = sorted[i];
      const right = sorted[j];
      const type = classifyConflict(left, right);
      if (!type) continue;
      conflicts.push(makeConflict(type, left, right));
    }
  }
  return Object.freeze(conflicts.sort((left, right) => left.conflict_id.localeCompare(right.conflict_id)));
}

function classifyConflict(left, right) {
  if (hasTag(left, "security") && hasTag(right, "performance") && sameEvidence(left, right)) {
    return "security_vs_performance";
  }
  if (hasTag(left, "performance") && hasTag(right, "security") && sameEvidence(left, right)) {
    return "security_vs_performance";
  }
  if (sameEvidence(left, right) && severityDistance(left.severity, right.severity) >= 3) {
    return "severity_conflict";
  }
  if (sharesRule(left, right) && contradicts(left.claim, right.claim)) {
    return "claim_contradiction";
  }
  if (sameEvidence(left, right) && incompatibleFix(left.suggested_fix, right.suggested_fix)) {
    return "fix_conflict";
  }
  if (left.reviewer_id === right.reviewer_id && !sameRuleSet(left, right)) {
    return "scope_conflict";
  }
  if (sameEvidence(left, right) && ((BLOCKING.has(left.severity) && right.confidence === "LOW") || (BLOCKING.has(right.severity) && left.confidence === "LOW") || (BLOCKING.has(left.severity) && LOW.has(right.severity)) || (BLOCKING.has(right.severity) && LOW.has(left.severity)))) {
    return "confidence_conflict";
  }
  return null;
}

function makeConflict(type, left, right) {
  const findingIds = [left.finding_id, right.finding_id].sort();
  const findings = [left, right].sort((a, b) => a.finding_id.localeCompare(b.finding_id));
  const affectedRules = [...new Set(findings.flatMap((finding) => finding.related_quality_rules))].sort();
  const competingClaims = findings.map((finding) => Object.freeze({
    finding_id: finding.finding_id,
    reviewer_id: finding.reviewer_id,
    claim: finding.claim,
    suggested_fix: finding.suggested_fix,
    severity: finding.severity,
    confidence: finding.confidence
  }));
  return Object.freeze({
    conflict_id: `conflict-${type}-${findingIds.join("-")}`,
    type,
    conflict_type: CONFLICT_TYPE_ALIASES[type] ?? type,
    involved_reviewers: Object.freeze([...new Set(findings.map((finding) => finding.reviewer_id))].sort()),
    involved_findings: Object.freeze(findingIds),
    finding_ids: Object.freeze(findingIds),
    summary: `${type} between ${findingIds[0]} and ${findingIds[1]}`,
    competing_claims: Object.freeze(competingClaims),
    affected_quality_rules: Object.freeze(affectedRules),
    evidence_refs: Object.freeze([formatEvidence(left.evidence), formatEvidence(right.evidence)]),
    required_resolution: resolutionFor(type, findings),
    resolution_required: true,
    confidence: conflictConfidence(type, findings)
  });
}

function resolutionFor(type, findings) {
  if (type === "security_vs_performance") {
    return "Choose a mitigation that preserves security while documenting any accepted performance cost.";
  }
  if (type === "severity_conflict") {
    return "Reconcile severity using the cited impact and quality rule behavior before final judgment.";
  }
  if (type === "claim_contradiction") {
    return "Compare cited evidence and determine which claim is supported by the diff.";
  }
  if (type === "fix_conflict") {
    return "Pick one fix path or define a compromise that satisfies the affected quality rules.";
  }
  if (type === "confidence_conflict") {
    return "Treat the low-confidence side as uncertainty unless stronger evidence is added.";
  }
  return `Resolve disagreement between ${findings.map((finding) => finding.reviewer_id).join(" and ")}.`;
}

function conflictConfidence(type, findings) {
  if (type === "confidence_conflict" || findings.some((finding) => finding.confidence === "LOW")) return "LOW";
  if (findings.some((finding) => finding.confidence === "MEDIUM")) return "MEDIUM";
  return "HIGH";
}

function sameEvidence(left, right) {
  return left.evidence.file_path === right.evidence.file_path
    && rangesOverlap(left.evidence.line_start, left.evidence.line_end, right.evidence.line_start, right.evidence.line_end);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function sharesRule(left, right) {
  const rightRules = new Set(right.related_quality_rules);
  return left.related_quality_rules.some((ruleId) => rightRules.has(ruleId));
}

function sameRuleSet(left, right) {
  return left.related_quality_rules.join("|") === right.related_quality_rules.join("|");
}

function contradicts(leftClaim, rightClaim) {
  const left = leftClaim.toLowerCase();
  const right = rightClaim.toLowerCase();
  return (/\b(remove|removes|removed|disable|disables|disabled|unsafe|exposes|breaks)\b/.test(left) && /\b(add|adds|added|enable|enables|enabled|safe|preserve|preserves|preserved|fixes)\b/.test(right))
    || (/\b(add|adds|added|enable|enables|enabled|safe|preserve|preserves|preserved|fixes)\b/.test(left) && /\b(remove|removes|removed|disable|disables|disabled|unsafe|exposes|breaks)\b/.test(right));
}

function incompatibleFix(leftFix, rightFix) {
  const left = leftFix.toLowerCase();
  const right = rightFix.toLowerCase();
  return (left.includes("remove") && right.includes("keep")) || (left.includes("keep") && right.includes("remove")) || (left.includes("disable") && right.includes("enable")) || (left.includes("enable") && right.includes("disable"));
}

function severityDistance(left, right) {
  const order = ["NIT", "QUESTION", "MINOR", "MAJOR", "BLOCKER"];
  return Math.abs(order.indexOf(left) - order.indexOf(right));
}

function hasTag(finding, tag) {
  return Array.isArray(finding.tags) && finding.tags.includes(tag);
}

function formatEvidence(evidence) {
  return `${evidence.file_path}:${evidence.line_start}-${evidence.line_end}`;
}
