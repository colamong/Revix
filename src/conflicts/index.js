export class ConflictDetectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictDetectionError";
  }
}

const BLOCKING = new Set(["BLOCKER", "MAJOR"]);
const LOW = new Set(["QUESTION", "NIT"]);

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
  return Object.freeze({
    conflict_id: `conflict-${type}-${findingIds.join("-")}`,
    type,
    finding_ids: Object.freeze(findingIds),
    summary: `${type} between ${findingIds[0]} and ${findingIds[1]}`,
    evidence_refs: Object.freeze([formatEvidence(left.evidence), formatEvidence(right.evidence)]),
    resolution_required: true
  });
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

function formatEvidence(evidence) {
  return `${evidence.file_path}:${evidence.line_start}-${evidence.line_end}`;
}
