import { evaluateConstitution, VERDICTS } from "../constitution/index.js";
import { findingCanBlockMerge } from "../findings/index.js";

export class DecisionError extends Error {
  constructor(message) {
    super(message);
    this.name = "DecisionError";
  }
}

const SEVERITY_RANK = new Map(["NIT", "QUESTION", "MINOR", "MAJOR", "BLOCKER"].map((value, index) => [value, index]));
const VERDICT_RANK = new Map(VERDICTS.map((value, index) => [value, index]));

export function evaluateFinalDecision({ qualityRules, findings = [], conflicts = [], synthesisOptions = [] }) {
  if (!Array.isArray(qualityRules)) {
    throw new DecisionError("qualityRules must be an array");
  }
  if (!Array.isArray(findings)) {
    throw new DecisionError("findings must be an array");
  }
  if (!Array.isArray(conflicts)) {
    throw new DecisionError("conflicts must be an array");
  }
  if (!Array.isArray(synthesisOptions)) {
    throw new DecisionError("synthesisOptions must be an array");
  }

  const warnings = [];
  const violations = [
    ...findingViolations(findings, qualityRules, warnings),
    ...conflictViolations(conflicts, findings, qualityRules, warnings)
  ];
  const constitutionEvaluation = evaluateConstitution(qualityRules, violations);
  const blockingFindingIds = findings
    .filter((finding) => findingCanBlockMerge(finding))
    .map((finding) => finding.finding_id)
    .sort();
  const conflictIds = conflicts
    .filter((conflict) => conflict.resolution_required)
    .map((conflict) => conflict.conflict_id)
    .sort();
  const selectedOptionIds = selectOptionIds(synthesisOptions, blockingFindingIds, conflictIds);
  const nonBlockingFindingIds = findings
    .filter((finding) => !blockingFindingIds.includes(finding.finding_id))
    .map((finding) => finding.finding_id)
    .sort();

  let verdict = constitutionEvaluation.verdict;
  if (conflictIds.length > 0 && blockingFindingIds.length > 0) {
    verdict = stricterVerdict(verdict, "REQUEST_CHANGES");
  } else if (conflictIds.length > 0) {
    verdict = stricterVerdict(verdict, "COMMENT");
  }

  const allWarnings = [...warnings, ...(constitutionEvaluation.warnings ?? [])]
    .map((warning) => Object.freeze({ ruleId: warning.ruleId, message: warning.message }));

  return Object.freeze({
    verdict,
    passed: verdict === "APPROVE" || verdict === "COMMENT",
    selected_option_ids: Object.freeze(selectedOptionIds),
    option_evaluations: Object.freeze(synthesisOptions.map((option) => Object.freeze({
      option_id: option.option_id,
      selected: selectedOptionIds.includes(option.option_id),
      disqualified: Boolean(option.disqualified_reason),
      disqualified_reason: option.disqualified_reason ?? null,
      score_dimensions: option.score_dimensions ? Object.freeze({ ...option.score_dimensions }) : null
    }))),
    blocking_finding_ids: Object.freeze(blockingFindingIds),
    non_blocking_finding_ids: Object.freeze(nonBlockingFindingIds),
    conflict_ids: Object.freeze(conflictIds),
    constitution_evaluation: constitutionEvaluation,
    warnings: Object.freeze(allWarnings)
  });
}

function findingViolations(findings, qualityRules, warnings) {
  const rulesById = enabledRulesById(qualityRules);
  const violations = [];
  for (const finding of [...findings].sort((left, right) => left.finding_id.localeCompare(right.finding_id))) {
    const evidenceRef = evidenceRefForFinding(finding);
    if (!evidenceRef) {
      warnings.push({ ruleId: "finding.missing_evidence", message: `finding ${finding.finding_id} has no usable evidence` });
      continue;
    }
    for (const ruleId of [...finding.related_quality_rules].sort()) {
      const rule = rulesById.get(ruleId);
      if (!rule) {
        warnings.push({ ruleId, message: `finding ${finding.finding_id} references disabled or unknown quality rule` });
        continue;
      }
      if (finding.severity === "NIT" && rule.kind === "hard") {
        warnings.push({ ruleId, message: `NIT finding ${finding.finding_id} was not used as a hard-rule decision source` });
        continue;
      }
      if (finding.severity === "QUESTION" && rule.kind === "hard") {
        warnings.push({ ruleId, message: `QUESTION finding ${finding.finding_id} was not used as a hard-rule decision source` });
        continue;
      }
      violations.push({
        ruleId,
        kind: rule.kind,
        severity: capSeverity(finding.severity, rule.severityBehavior.maxSeverity),
        message: finding.claim,
        evidenceRefs: [evidenceRef],
        sourceFindingIds: [finding.finding_id],
        sourceConflictIds: [],
        confidence: finding.confidence
      });
    }
  }
  return violations;
}

function conflictViolations(conflicts, findings, qualityRules, warnings) {
  const rulesById = enabledRulesById(qualityRules);
  const findingsById = new Map(findings.map((finding) => [finding.finding_id, finding]));
  const violations = [];
  for (const conflict of [...conflicts].sort((left, right) => left.conflict_id.localeCompare(right.conflict_id))) {
    if (!conflict.resolution_required) {
      continue;
    }
    if (!Array.isArray(conflict.evidence_refs) || conflict.evidence_refs.length === 0) {
      warnings.push({ ruleId: "conflict.missing_evidence", message: `conflict ${conflict.conflict_id} has no usable evidence` });
      continue;
    }
    const relatedFindings = conflict.finding_ids.map((findingId) => findingsById.get(findingId)).filter(Boolean);
    const relatedRuleIds = [...new Set(relatedFindings.flatMap((finding) => finding.related_quality_rules))].sort();
    for (const ruleId of relatedRuleIds) {
      const rule = rulesById.get(ruleId);
      if (!rule) {
        continue;
      }
      const severity = capSeverity(strongestSeverity(relatedFindings), rule.severityBehavior.maxSeverity);
      if (severity === "NIT" || (severity === "QUESTION" && rule.kind === "hard")) {
        continue;
      }
      violations.push({
        ruleId,
        kind: rule.kind,
        severity,
        message: conflict.summary,
        evidenceRefs: [...conflict.evidence_refs],
        sourceFindingIds: [...conflict.finding_ids].sort(),
        sourceConflictIds: [conflict.conflict_id],
        confidence: conflictConfidence(conflict, relatedFindings)
      });
    }
  }
  return violations;
}

function selectOptionIds(options, blockingFindingIds, conflictIds) {
  const blocking = new Set(blockingFindingIds);
  const conflicts = new Set(conflictIds);
  return options
    .filter((option) => !option.disqualified_reason)
    .filter((option) => option.finding_ids.some((findingId) => blocking.has(findingId)) || option.conflict_ids.some((conflictId) => conflicts.has(conflictId)) || option.strategy === "ask_clarification")
    .map((option) => option.option_id)
    .sort();
}

function enabledRulesById(qualityRules) {
  return new Map(qualityRules.filter((rule) => rule.enabled).map((rule) => [rule.id, rule]));
}

function evidenceRefForFinding(finding) {
  if (!finding.evidence?.file_path || !finding.evidence?.line_start || !finding.evidence?.line_end) {
    return null;
  }
  return `${finding.evidence.file_path}:${finding.evidence.line_start}-${finding.evidence.line_end}`;
}

function strongestSeverity(findings) {
  let strongest = "NIT";
  for (const finding of findings) {
    if (rank(SEVERITY_RANK, finding.severity) > rank(SEVERITY_RANK, strongest)) {
      strongest = finding.severity;
    }
  }
  return strongest;
}

function capSeverity(severity, maxSeverity) {
  return rank(SEVERITY_RANK, severity) > rank(SEVERITY_RANK, maxSeverity) ? maxSeverity : severity;
}

function conflictConfidence(conflict, findings) {
  if (conflict.type === "confidence_conflict" || findings.some((finding) => finding.confidence === "LOW")) {
    return "LOW";
  }
  if (findings.some((finding) => finding.confidence === "MEDIUM")) {
    return "MEDIUM";
  }
  return "HIGH";
}

function stricterVerdict(left, right) {
  return rank(VERDICT_RANK, right) > rank(VERDICT_RANK, left) ? right : left;
}

function rank(rankMap, value) {
  const result = rankMap.get(value);
  if (result === undefined) {
    throw new DecisionError(`unknown ranked value: ${value}`);
  }
  return result;
}
