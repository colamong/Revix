import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultConstitution, parseYamlSubset } from "../constitution/index.js";

export const BUILTIN_REVIEWER_IDS = Object.freeze([
  "architecture",
  "contract",
  "domain",
  "security",
  "reliability",
  "performance",
  "test",
  "observability",
  "documentation",
  "readability"
]);

export class ReviewerSkillValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewerSkillValidationError";
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(moduleDir, "builtin", "v1");
const REVIEWER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const RULE_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const TAG_PATTERN = /^[a-z][a-z0-9_-]*$/;
const SEVERITIES = Object.freeze(["NIT", "QUESTION", "MINOR", "MAJOR", "BLOCKER"]);
const SEVERITY_RANK = new Map(SEVERITIES.map((value, index) => [value, index]));
const REQUIRED_SKILL_KEYS = Object.freeze([
  "schema_version",
  "skill_version",
  "reviewer_id",
  "display_name",
  "responsibility",
  "background",
  "bias",
  "flexibility_score",
  "allowed_scope",
  "forbidden_scope",
  "severity_policy",
  "quality_rules_focus",
  "prompt_instructions",
  "examples"
]);
const SAFETY_INSTRUCTION_PATTERNS = Object.freeze([
  /evidence[- ]based/i,
  /(do not|don't).*(final|merge).*decision/i
]);

export function loadBuiltInReviewerSkills(qualityRules = loadDefaultConstitution()) {
  const skills = readReviewerSkillFiles(BUILTIN_DIR, qualityRules);
  const byId = new Map(skills.map((skill) => [skill.reviewer_id, skill]));
  for (const reviewerId of BUILTIN_REVIEWER_IDS) {
    if (!byId.has(reviewerId)) {
      throw new ReviewerSkillValidationError(`missing built-in reviewer skill: ${reviewerId}`);
    }
  }
  return Object.freeze(BUILTIN_REVIEWER_IDS.map((reviewerId) => byId.get(reviewerId)));
}

export function loadProjectReviewerSkills(projectRoot, qualityRules = loadDefaultConstitution()) {
  const seen = new Set();
  const skills = [];
  for (const directory of reviewerSkillDirectories(projectRoot)) {
    if (!existsSync(directory)) {
      throw new ReviewerSkillValidationError(`reviewer skill path does not exist: ${directory}`);
    }
    for (const skill of readReviewerSkillFiles(directory, qualityRules)) {
      if (seen.has(skill.reviewer_id)) {
        throw new ReviewerSkillValidationError(`duplicate project reviewer_id: ${skill.reviewer_id}`);
      }
      seen.add(skill.reviewer_id);
      skills.push(skill);
    }
  }
  return Object.freeze(skills.sort((left, right) => left.reviewer_id.localeCompare(right.reviewer_id)));
}

export function loadEffectiveReviewerSkills(projectRoot = process.cwd(), qualityRules = loadDefaultConstitution()) {
  const builtIns = loadBuiltInReviewerSkills(qualityRules);
  const builtInsById = new Map(builtIns.map((skill) => [skill.reviewer_id, skill]));
  const effectiveById = new Map(builtIns.map((skill) => [skill.reviewer_id, skill]));

  for (const projectSkill of loadProjectReviewerSkills(projectRoot, qualityRules)) {
    const builtInBase = builtInsById.get(projectSkill.reviewer_id);
    if (builtInBase) {
      validateBuiltInOverride(projectSkill, builtInBase);
    }
    effectiveById.set(projectSkill.reviewer_id, projectSkill);
  }

  const selection = loadReviewerSkillSelection(projectRoot);
  for (const reviewerId of selection.disabled) {
    effectiveById.delete(reviewerId);
  }
  if (selection.enabled.length > 0) {
    const allowed = new Set(selection.enabled);
    for (const reviewerId of [...effectiveById.keys()]) {
      if (!allowed.has(reviewerId)) {
        effectiveById.delete(reviewerId);
      }
    }
  }

  return Object.freeze([...effectiveById.values()].sort((left, right) => left.reviewer_id.localeCompare(right.reviewer_id)));
}

export function validateReviewerSkill(skill, qualityRules = loadDefaultConstitution()) {
  assertObject(skill, "reviewer skill");
  validateExactKeys(skill, REQUIRED_SKILL_KEYS, `reviewer skill ${skill.reviewer_id ?? "<unknown>"}`);
  for (const key of REQUIRED_SKILL_KEYS) {
    if (!(key in skill)) {
      throw new ReviewerSkillValidationError(`reviewer skill.${key} is required`);
    }
  }

  const normalized = {
    schema_version: normalizeSchemaVersion(skill.schema_version),
    skill_version: normalizeVersion(skill.skill_version, "skill_version"),
    reviewer_id: normalizeReviewerId(skill.reviewer_id),
    display_name: normalizeString(skill.display_name, "display_name"),
    responsibility: normalizeString(skill.responsibility, "responsibility"),
    background: normalizeString(skill.background, "background"),
    bias: normalizeStringArray(skill.bias, "bias"),
    flexibility_score: normalizeFlexibilityScore(skill.flexibility_score),
    allowed_scope: normalizeAllowedScope(skill.allowed_scope),
    forbidden_scope: normalizeForbiddenScope(skill.forbidden_scope),
    severity_policy: normalizeSeverityPolicy(skill.severity_policy),
    quality_rules_focus: normalizeRuleIds(skill.quality_rules_focus, "quality_rules_focus"),
    prompt_instructions: normalizeStringArray(skill.prompt_instructions, "prompt_instructions"),
    examples: normalizeExamples(skill.examples)
  };

  validateQualityRuleReferences(normalized, qualityRules);
  validateScopeConsistency(normalized);
  validateSeverityPolicy(normalized, qualityRules);
  validatePromptInstructions(normalized);
  validateExamples(normalized, qualityRules);

  return freezeSkill(normalized);
}

export function createFindingValidationContext(skill, qualityRules = loadDefaultConstitution()) {
  return Object.freeze({
    reviewer_id: skill.reviewer_id,
    allowed_tags: Object.freeze([...skill.allowed_scope.tags]),
    allowed_quality_rules: Object.freeze([...skill.allowed_scope.quality_rules]),
    quality_rules: Object.freeze([...qualityRules])
  });
}

function readReviewerSkillFiles(directory, qualityRules) {
  const seen = new Set();
  const skills = [];
  const files = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".reviewer.yml"))
    .sort();
  for (const fileName of files) {
    const skill = validateReviewerSkill(parseYamlSubset(readFileSync(join(directory, fileName), "utf8")), qualityRules);
    if (seen.has(skill.reviewer_id)) {
      throw new ReviewerSkillValidationError(`duplicate reviewer_id in ${directory}: ${skill.reviewer_id}`);
    }
    seen.add(skill.reviewer_id);
    skills.push(skill);
  }
  return Object.freeze(skills);
}

function reviewerSkillDirectories(projectRoot) {
  const dirs = [];
  const projectDir = join(projectRoot, ".revix", "reviewer-skills");
  if (existsSync(projectDir)) dirs.push(projectDir);
  const configPath = join(projectRoot, ".revix.yml");
  if (!existsSync(configPath)) return dirs;
  const parsed = parseYamlSubset(readFileSync(configPath, "utf8"));
  const configuredPaths = parsed.skills?.paths ?? [];
  if (!Array.isArray(configuredPaths)) return dirs;
  for (const configuredPath of configuredPaths) {
    if (typeof configuredPath === "string" && configuredPath.trim() !== "") {
      dirs.push(resolve(projectRoot, configuredPath));
    }
  }
  return Object.freeze([...new Set(dirs)]);
}

function loadReviewerSkillSelection(projectRoot) {
  const configPath = join(projectRoot, ".revix.yml");
  if (!existsSync(configPath)) {
    return { enabled: [], disabled: [] };
  }
  const parsed = parseYamlSubset(readFileSync(configPath, "utf8"));
  const selection = parsed.reviewer_skills ?? {};
  assertObject(selection, "reviewer_skills");
  validateExactKeys(selection, ["enabled", "disabled"], "reviewer_skills");
  return {
    enabled: selection.enabled ? normalizeReviewerIds(selection.enabled, "reviewer_skills.enabled") : [],
    disabled: selection.disabled ? normalizeReviewerIds(selection.disabled, "reviewer_skills.disabled") : []
  };
}

function validateBuiltInOverride(override, base) {
  if (override.schema_version !== base.schema_version) {
    throw new ReviewerSkillValidationError(`built-in override cannot change schema_version: ${override.reviewer_id}`);
  }
  if (override.reviewer_id !== base.reviewer_id) {
    throw new ReviewerSkillValidationError("built-in override cannot change reviewer_id");
  }
  if (override.quality_rules_focus.length === 0) {
    throw new ReviewerSkillValidationError(`built-in override cannot remove all quality rules: ${override.reviewer_id}`);
  }
  validatePromptInstructions(override);
  if (rank(override.severity_policy.style_only_max_severity) > rank(base.severity_policy.style_only_max_severity)) {
    throw new ReviewerSkillValidationError(`built-in override cannot weaken style-only max severity: ${override.reviewer_id}`);
  }
}

function validateQualityRuleReferences(skill, qualityRules) {
  const rulesById = new Map(qualityRules.filter((rule) => rule.enabled !== false).map((rule) => [rule.id, rule]));
  for (const ruleId of [...skill.allowed_scope.quality_rules, ...skill.quality_rules_focus]) {
    if (!rulesById.has(ruleId)) {
      throw new ReviewerSkillValidationError(`reviewer skill references unknown quality rule: ${ruleId}`);
    }
  }
  for (const ruleId of skill.quality_rules_focus) {
    if (!skill.allowed_scope.quality_rules.includes(ruleId)) {
      throw new ReviewerSkillValidationError(`quality_rules_focus must be a subset of allowed_scope.quality_rules: ${ruleId}`);
    }
  }
}

function validateScopeConsistency(skill) {
  const allowedTags = new Set(skill.allowed_scope.tags);
  for (const tag of skill.forbidden_scope.tags) {
    if (allowedTags.has(tag)) {
      throw new ReviewerSkillValidationError(`forbidden_scope tag overlaps allowed_scope tag: ${tag}`);
    }
  }
}

function validateSeverityPolicy(skill, qualityRules) {
  const hardRules = new Set(qualityRules.filter((rule) => rule.kind === "hard").map((rule) => rule.id));
  for (const [tag, severity] of Object.entries(skill.severity_policy.max_severity_by_tag)) {
    if ((tag === "style" || tag === "nit") && rank(severity) >= rank("MAJOR")) {
      throw new ReviewerSkillValidationError(`${tag} max severity cannot be MAJOR or BLOCKER`);
    }
  }
  if (rank(skill.severity_policy.style_only_max_severity) >= rank("MAJOR")) {
    throw new ReviewerSkillValidationError("style_only_max_severity cannot be MAJOR or BLOCKER");
  }
  const blockerRequires = skill.severity_policy.blocker_requires;
  if (blockerRequires.confidence !== "HIGH") {
    throw new ReviewerSkillValidationError("BLOCKER policy must require HIGH confidence");
  }
  if (blockerRequires.hard_quality_rule !== true) {
    throw new ReviewerSkillValidationError("BLOCKER policy must require a hard quality rule");
  }
  const hasHardFocus = skill.quality_rules_focus.some((ruleId) => hardRules.has(ruleId));
  const canEmitBlocker = Object.values(skill.severity_policy.max_severity_by_tag).some((severity) => severity === "BLOCKER");
  if (canEmitBlocker && !hasHardFocus) {
    throw new ReviewerSkillValidationError("skills with BLOCKER severity must focus at least one hard quality rule");
  }
}

function validatePromptInstructions(skill) {
  const joined = skill.prompt_instructions.join("\n");
  for (const pattern of SAFETY_INSTRUCTION_PATTERNS) {
    if (!pattern.test(joined)) {
      throw new ReviewerSkillValidationError(`prompt_instructions must preserve safety instruction: ${pattern}`);
    }
  }
}

function validateExamples(skill, qualityRules) {
  const rulesById = new Map(qualityRules.filter((rule) => rule.enabled !== false).map((rule) => [rule.id, rule]));
  const allowedTags = new Set(skill.allowed_scope.tags);
  for (const example of skill.examples) {
    for (const tag of example.finding.tags) {
      if (!allowedTags.has(tag)) {
        throw new ReviewerSkillValidationError(`example tag is outside allowed scope: ${tag}`);
      }
    }
    for (const ruleId of example.finding.related_quality_rules) {
      if (!rulesById.has(ruleId)) {
        throw new ReviewerSkillValidationError(`example references unknown quality rule: ${ruleId}`);
      }
      if (!skill.allowed_scope.quality_rules.includes(ruleId)) {
        throw new ReviewerSkillValidationError(`example rule is outside allowed scope: ${ruleId}`);
      }
    }
    if ((example.finding.tags.includes("style") || example.finding.tags.includes("nit")) && rank(example.finding.severity) >= rank("MAJOR")) {
      throw new ReviewerSkillValidationError("style or nit example cannot be MAJOR or BLOCKER");
    }
    if (example.finding.severity === "BLOCKER") {
      const hasHardRule = example.finding.related_quality_rules.some((ruleId) => rulesById.get(ruleId)?.kind === "hard");
      if (!hasHardRule) {
        throw new ReviewerSkillValidationError("BLOCKER example requires a hard related quality rule");
      }
    }
  }
}

function normalizeAllowedScope(value) {
  assertObject(value, "allowed_scope");
  validateExactKeys(value, ["tags", "quality_rules", "file_patterns"], "allowed_scope");
  return {
    tags: normalizeTags(value.tags, "allowed_scope.tags"),
    quality_rules: normalizeRuleIds(value.quality_rules, "allowed_scope.quality_rules"),
    file_patterns: normalizeStringArray(value.file_patterns, "allowed_scope.file_patterns")
  };
}

function normalizeForbiddenScope(value) {
  assertObject(value, "forbidden_scope");
  validateExactKeys(value, ["tags", "note"], "forbidden_scope");
  return {
    tags: value.tags ? normalizeTags(value.tags, "forbidden_scope.tags", true) : [],
    note: normalizeString(value.note, "forbidden_scope.note")
  };
}

function normalizeSeverityPolicy(value) {
  assertObject(value, "severity_policy");
  validateExactKeys(value, ["max_severity_by_tag", "blocker_requires", "style_only_max_severity"], "severity_policy");
  assertObject(value.max_severity_by_tag, "severity_policy.max_severity_by_tag");
  assertObject(value.blocker_requires, "severity_policy.blocker_requires");
  const maxSeverityByTag = {};
  for (const [tag, severity] of Object.entries(value.max_severity_by_tag)) {
    maxSeverityByTag[normalizeTag(tag, `severity_policy.max_severity_by_tag.${tag}`)] = normalizeSeverity(severity, `severity_policy.max_severity_by_tag.${tag}`);
  }
  return {
    max_severity_by_tag: maxSeverityByTag,
    blocker_requires: { ...value.blocker_requires },
    style_only_max_severity: normalizeSeverity(value.style_only_max_severity, "severity_policy.style_only_max_severity")
  };
}

function normalizeExamples(value) {
  if (!Array.isArray(value)) {
    throw new ReviewerSkillValidationError("examples must be an array");
  }
  return value.map((example, index) => {
    assertObject(example, `examples[${index}]`);
    validateExactKeys(example, ["name", "finding"], `examples[${index}]`);
    assertObject(example.finding, `examples[${index}].finding`);
    validateExactKeys(example.finding, ["severity", "claim", "related_quality_rules", "tags"], `examples[${index}].finding`);
    return {
      name: normalizeString(example.name, `examples[${index}].name`),
      finding: {
        severity: normalizeSeverity(example.finding.severity, `examples[${index}].finding.severity`),
        claim: normalizeString(example.finding.claim, `examples[${index}].finding.claim`),
        related_quality_rules: normalizeRuleIds(example.finding.related_quality_rules, `examples[${index}].finding.related_quality_rules`),
        tags: normalizeTags(example.finding.tags, `examples[${index}].finding.tags`)
      }
    };
  });
}

function normalizeSchemaVersion(value) {
  if (value !== 1) {
    throw new ReviewerSkillValidationError("schema_version must be 1");
  }
  return value;
}

function normalizeVersion(value, label) {
  const normalized = normalizeString(value, label);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new ReviewerSkillValidationError(`${label} must be semantic version x.y.z`);
  }
  return normalized;
}

function normalizeReviewerId(value) {
  const normalized = normalizeString(value, "reviewer_id");
  if (!REVIEWER_ID_PATTERN.test(normalized)) {
    throw new ReviewerSkillValidationError("reviewer_id is invalid");
  }
  return normalized;
}

function normalizeReviewerIds(value, label) {
  if (!Array.isArray(value)) {
    throw new ReviewerSkillValidationError(`${label} must be an array`);
  }
  return value.map((item) => {
    const normalized = normalizeString(item, label);
    if (!REVIEWER_ID_PATTERN.test(normalized)) {
      throw new ReviewerSkillValidationError(`${label} contains invalid reviewer_id: ${item}`);
    }
    return normalized;
  });
}

function normalizeFlexibilityScore(value) {
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw new ReviewerSkillValidationError("flexibility_score must be a number from 0 to 1");
  }
  return value;
}

function normalizeRuleIds(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReviewerSkillValidationError(`${label} must be a non-empty array`);
  }
  return value.map((item) => {
    const normalized = normalizeString(item, label);
    if (!RULE_ID_PATTERN.test(normalized)) {
      throw new ReviewerSkillValidationError(`${label} contains invalid rule id: ${item}`);
    }
    return normalized;
  });
}

function normalizeTags(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new ReviewerSkillValidationError(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  return value.map((item) => normalizeTag(item, label));
}

function normalizeTag(value, label) {
  const normalized = normalizeString(value, label).toLowerCase();
  if (!TAG_PATTERN.test(normalized)) {
    throw new ReviewerSkillValidationError(`${label} contains invalid tag: ${value}`);
  }
  return normalized;
}

function normalizeSeverity(value, label) {
  if (!SEVERITIES.includes(value)) {
    throw new ReviewerSkillValidationError(`${label} must be one of: ${SEVERITIES.join(", ")}`);
  }
  return value;
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReviewerSkillValidationError(`${label} must be a non-empty array`);
  }
  return value.map((item) => normalizeString(item, label));
}

function normalizeString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReviewerSkillValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewerSkillValidationError(`${label} must be an object`);
  }
}

function validateExactKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ReviewerSkillValidationError(`${label} has unknown field: ${key}`);
    }
  }
}

function rank(severity) {
  const value = SEVERITY_RANK.get(severity);
  if (value === undefined) {
    throw new ReviewerSkillValidationError(`unknown severity: ${severity}`);
  }
  return value;
}

function freezeSkill(skill) {
  return Object.freeze({
    ...skill,
    bias: Object.freeze([...skill.bias]),
    allowed_scope: Object.freeze({
      tags: Object.freeze([...skill.allowed_scope.tags]),
      quality_rules: Object.freeze([...skill.allowed_scope.quality_rules]),
      file_patterns: Object.freeze([...skill.allowed_scope.file_patterns])
    }),
    forbidden_scope: Object.freeze({
      tags: Object.freeze([...skill.forbidden_scope.tags]),
      note: skill.forbidden_scope.note
    }),
    severity_policy: Object.freeze({
      max_severity_by_tag: Object.freeze({ ...skill.severity_policy.max_severity_by_tag }),
      blocker_requires: Object.freeze({ ...skill.severity_policy.blocker_requires }),
      style_only_max_severity: skill.severity_policy.style_only_max_severity
    }),
    quality_rules_focus: Object.freeze([...skill.quality_rules_focus]),
    prompt_instructions: Object.freeze([...skill.prompt_instructions]),
    examples: Object.freeze(skill.examples.map((example) => Object.freeze({
      name: example.name,
      finding: Object.freeze({
        severity: example.finding.severity,
        claim: example.finding.claim,
        related_quality_rules: Object.freeze([...example.finding.related_quality_rules]),
        tags: Object.freeze([...example.finding.tags])
      })
    })))
  });
}
