export const FINDING_SEVERITIES = Object.freeze(["NIT", "QUESTION", "MINOR", "MAJOR", "BLOCKER"]);
export const FINDING_CONFIDENCES = Object.freeze(["HIGH", "MEDIUM", "LOW"]);

const FINDING_KEYS = Object.freeze([
  "finding_id",
  "reviewer_id",
  "severity",
  "claim",
  "evidence",
  "evidence_refs",
  "impact",
  "suggested_fix",
  "verification_test",
  "confidence",
  "related_quality_rules",
  "tags"
]);
const REQUIRED_FINDING_KEYS = FINDING_KEYS.filter((key) => key !== "evidence_refs");
const EVIDENCE_KEYS = Object.freeze(["file_path", "line_start", "line_end", "snippet"]);
const RULE_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const TAG_PATTERN = /^[a-z][a-z0-9_-]*$/;
const VAGUE_PHRASES = Object.freeze(["bad", "unclear", "maybe", "looks wrong", "fix this", "check it"]);

export class FindingValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FindingValidationError";
  }
}

export function validateFindings(findings, context) {
  if (!Array.isArray(findings)) {
    throw new FindingValidationError("findings must be an array");
  }
  return Object.freeze(findings.map((finding) => validateFinding(finding, context)));
}

export function validateFinding(finding, context) {
  validateContext(context);
  assertObject(finding, "finding");
  validateExactKeys(finding, FINDING_KEYS, "finding");
  for (const key of REQUIRED_FINDING_KEYS) {
    if (!(key in finding)) {
      throw new FindingValidationError(`finding.${key} is required`);
    }
  }

  const normalized = {
    finding_id: normalizeString(finding.finding_id, "finding.finding_id"),
    reviewer_id: normalizeString(finding.reviewer_id, "finding.reviewer_id"),
    severity: normalizeEnum(finding.severity, FINDING_SEVERITIES, "finding.severity"),
    claim: normalizeConcreteText(finding.claim, "finding.claim"),
    evidence: normalizeEvidence(finding.evidence, "finding.evidence"),
    impact: normalizeConcreteText(finding.impact, "finding.impact"),
    suggested_fix: normalizeConcreteText(finding.suggested_fix, "finding.suggested_fix"),
    verification_test: normalizeConcreteText(finding.verification_test, "finding.verification_test"),
    confidence: normalizeEnum(finding.confidence, FINDING_CONFIDENCES, "finding.confidence"),
    related_quality_rules: normalizeRuleIds(finding.related_quality_rules),
    tags: normalizeTags(finding.tags)
  };

  if ("evidence_refs" in finding) {
    if (!Array.isArray(finding.evidence_refs)) {
      throw new FindingValidationError("finding.evidence_refs must be an array");
    }
    normalized.evidence_refs = Object.freeze(
      finding.evidence_refs.map((evidence, index) => normalizeEvidence(evidence, `finding.evidence_refs[${index}]`))
    );
  }

  validateScope(normalized, context);
  validateRelatedQualityRules(normalized, context);
  validateSeverityRules(normalized, context);

  return freezeFinding(normalized);
}

export function findingCanBlockMerge(finding) {
  return finding.severity === "BLOCKER" || finding.severity === "MAJOR";
}

function validateContext(context) {
  assertObject(context, "finding validation context");
  validateExactKeys(context, ["reviewer_id", "allowed_tags", "allowed_quality_rules", "quality_rules"], "finding validation context");
  normalizeString(context.reviewer_id, "context.reviewer_id");
  assertStringArray(context.allowed_tags, "context.allowed_tags");
  assertStringArray(context.allowed_quality_rules, "context.allowed_quality_rules");
  if (!Array.isArray(context.quality_rules)) {
    throw new FindingValidationError("context.quality_rules must be an array");
  }
}

function validateScope(finding, context) {
  if (finding.reviewer_id !== context.reviewer_id) {
    throw new FindingValidationError(`finding reviewer_id is outside reviewer scope: ${finding.reviewer_id}`);
  }

  const allowedTags = new Set(context.allowed_tags);
  for (const tag of finding.tags) {
    if (!allowedTags.has(tag)) {
      throw new FindingValidationError(`finding tag is outside reviewer scope: ${tag}`);
    }
  }

  const allowedRules = new Set(context.allowed_quality_rules);
  for (const ruleId of finding.related_quality_rules) {
    if (!allowedRules.has(ruleId)) {
      throw new FindingValidationError(`finding quality rule is outside reviewer scope: ${ruleId}`);
    }
  }
}

function validateRelatedQualityRules(finding, context) {
  const rulesById = new Map(context.quality_rules.filter((rule) => rule?.enabled !== false).map((rule) => [rule.id, rule]));
  for (const ruleId of finding.related_quality_rules) {
    if (!rulesById.has(ruleId)) {
      throw new FindingValidationError(`finding references unknown quality rule: ${ruleId}`);
    }
  }
}

function validateSeverityRules(finding, context) {
  if (finding.confidence === "LOW" && finding.severity === "BLOCKER") {
    throw new FindingValidationError("LOW confidence findings cannot be BLOCKER");
  }

  if (finding.severity === "MAJOR" && finding.confidence === "LOW") {
    throw new FindingValidationError("MAJOR findings require HIGH or MEDIUM confidence");
  }

  if ((finding.tags.includes("style") || finding.tags.includes("nit")) && ["BLOCKER", "MAJOR"].includes(finding.severity)) {
    throw new FindingValidationError("style-only or nit findings cannot be BLOCKER or MAJOR");
  }

  if (finding.severity === "QUESTION" && !isClarificationQuestion(finding)) {
    throw new FindingValidationError("QUESTION findings must ask for clarification");
  }

  if (finding.severity === "BLOCKER") {
    if (finding.confidence !== "HIGH") {
      throw new FindingValidationError("BLOCKER findings require HIGH confidence");
    }
    const rulesById = new Map(context.quality_rules.map((rule) => [rule.id, rule]));
    const hasHardRule = finding.related_quality_rules.some((ruleId) => rulesById.get(ruleId)?.kind === "hard");
    if (!hasHardRule) {
      throw new FindingValidationError("BLOCKER findings require at least one hard related quality rule");
    }
  }
}

function normalizeEvidence(evidence, label) {
  assertObject(evidence, label);
  validateExactKeys(evidence, EVIDENCE_KEYS, label);
  for (const key of EVIDENCE_KEYS) {
    if (!(key in evidence)) {
      throw new FindingValidationError(`${label}.${key} is required`);
    }
  }
  const lineStart = normalizeLineNumber(evidence.line_start, `${label}.line_start`);
  const lineEnd = normalizeLineNumber(evidence.line_end, `${label}.line_end`);
  if (lineStart > lineEnd) {
    throw new FindingValidationError(`${label}.line_start must be less than or equal to line_end`);
  }
  return Object.freeze({
    file_path: normalizeString(evidence.file_path, `${label}.file_path`),
    line_start: lineStart,
    line_end: lineEnd,
    snippet: normalizeString(evidence.snippet, `${label}.snippet`)
  });
}

function normalizeRuleIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FindingValidationError("finding.related_quality_rules must be a non-empty array");
  }
  return Object.freeze(value.map((ruleId, index) => {
    const normalized = normalizeString(ruleId, `finding.related_quality_rules[${index}]`);
    if (!RULE_ID_PATTERN.test(normalized)) {
      throw new FindingValidationError(`finding.related_quality_rules[${index}] is not a valid rule ID`);
    }
    return normalized;
  }));
}

function normalizeTags(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FindingValidationError("finding.tags must be a non-empty array");
  }
  return Object.freeze(value.map((tag, index) => {
    const normalized = normalizeString(tag, `finding.tags[${index}]`).toLowerCase();
    if (!TAG_PATTERN.test(normalized)) {
      throw new FindingValidationError(`finding.tags[${index}] is not a valid tag`);
    }
    return normalized;
  }));
}

function normalizeConcreteText(value, label) {
  const normalized = normalizeString(value, label);
  const lower = normalized.toLowerCase();
  if (normalized.length < 12 || VAGUE_PHRASES.some((phrase) => lower.includes(phrase))) {
    throw new FindingValidationError(`${label} is too vague`);
  }
  return normalized;
}

function normalizeString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FindingValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeEnum(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    throw new FindingValidationError(`${label} must be one of: ${allowedValues.join(", ")}`);
  }
  return value;
}

function normalizeLineNumber(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new FindingValidationError(`${label} must be an integer greater than or equal to 1`);
  }
  return value;
}

function isClarificationQuestion(finding) {
  return finding.claim.includes("?") || finding.tags.includes("question") || finding.tags.includes("needs-clarification");
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FindingValidationError(`${label} must be an object`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new FindingValidationError(`${label} must be an array of non-empty strings`);
  }
}

function validateExactKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new FindingValidationError(`${label} has unknown field: ${key}`);
    }
  }
}

function freezeFinding(finding) {
  const frozen = {
    ...finding,
    evidence: Object.freeze({ ...finding.evidence }),
    related_quality_rules: Object.freeze([...finding.related_quality_rules]),
    tags: Object.freeze([...finding.tags])
  };
  if (finding.evidence_refs) {
    frozen.evidence_refs = Object.freeze(finding.evidence_refs.map((evidence) => Object.freeze({ ...evidence })));
  }
  return Object.freeze(frozen);
}
