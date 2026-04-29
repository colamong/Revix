import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONSTRAINT_KINDS = Object.freeze(["hard", "soft"]);
export const RULE_SEVERITIES = Object.freeze(["NIT", "QUESTION", "MINOR", "MAJOR", "BLOCKER"]);
export const VERDICTS = Object.freeze(["APPROVE", "COMMENT", "REQUEST_CHANGES", "BLOCK"]);

const SEVERITY_RANK = new Map(RULE_SEVERITIES.map((value, index) => [value, index]));
const VERDICT_RANK = new Map(VERDICTS.map((value, index) => [value, index]));
const RULE_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = join(moduleDir, "defaults.yml");
const COMPAT_CONFIG_KEYS = Object.freeze(["constitution", "reviewer_skills", "reviewers", "skills", "quality", "paths", "selection", "severity", "labels", "output", "verdict"]);

export class ConstitutionConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConstitutionConfigError";
  }
}

export function loadDefaultConstitution() {
  const parsed = parseYamlSubset(readFileSync(DEFAULTS_PATH, "utf8"));
  assertObject(parsed, "default constitution");
  if (parsed.version !== 1) {
    throw new ConstitutionConfigError("default constitution version must be 1");
  }
  if (!Array.isArray(parsed.rules)) {
    throw new ConstitutionConfigError("default constitution must define rules as an array");
  }
  const rules = parsed.rules.map((rule) => normalizeRule(rule));
  validateRuleSet(rules);
  return Object.freeze(rules.map(freezeRule));
}

export function loadProjectConfig(projectRoot = process.cwd()) {
  const configPath = join(projectRoot, ".revix.yml");
  if (!existsSync(configPath)) {
    return {};
  }
  const parsed = parseYamlSubset(readFileSync(configPath, "utf8"));
  assertObject(parsed, ".revix.yml");
  validateProjectConfigShape(parsed);
  return parsed;
}

export function loadEffectiveConstitution(projectRoot = process.cwd()) {
  return mergeConstitution(loadDefaultConstitution(), loadProjectConfig(projectRoot));
}

export function mergeConstitution(defaultRules, projectConfig = {}) {
  const rulesById = new Map(defaultRules.map((rule) => [rule.id, cloneRule(rule)]));
  const defaultRulesById = new Map(defaultRules.map((rule) => [rule.id, rule]));
  const constitutionConfig = projectConfig.constitution ?? {};
  validateProjectConfigShape(projectConfig);

  const overrides = constitutionConfig.rules ?? {};
  for (const [ruleId, override] of Object.entries(overrides)) {
    if (!rulesById.has(ruleId)) {
      throw new ConstitutionConfigError(`unknown built-in rule override: ${ruleId}`);
    }
    validateRuleId(ruleId);
    validateOverride(ruleId, override);
    const baseRule = defaultRulesById.get(ruleId);
    const mergedRule = applyOverride(rulesById.get(ruleId), override);
    validateBuiltInHardRuleNotWeakened(baseRule, mergedRule);
    rulesById.set(ruleId, mergedRule);
  }

  const additionalRules = constitutionConfig.additionalRules ?? {};
  const additionalRuleIds = Object.keys(additionalRules).sort();
  for (const ruleId of additionalRuleIds) {
    if (rulesById.has(ruleId)) {
      throw new ConstitutionConfigError(`additional rule shadows an existing rule: ${ruleId}`);
    }
    validateRuleId(ruleId);
    const rule = normalizeRule({ id: ruleId, ...additionalRules[ruleId] });
    rulesById.set(ruleId, rule);
  }

  return Object.freeze([...rulesById.values()].map(freezeRule));
}

export function evaluateConstitution(rules, violations = []) {
  const enabledRules = new Map(rules.filter((rule) => rule.enabled).map((rule) => [rule.id, rule]));
  const hardViolations = [];
  const softViolations = [];
  const warnings = [];
  let verdict = "APPROVE";

  for (const rawViolation of violations) {
    assertObject(rawViolation, "rule violation");
    const rule = enabledRules.get(rawViolation.ruleId);
    if (!rule) {
      warnings.push(makeWarning(rawViolation, `violation references disabled or unknown rule: ${rawViolation.ruleId}`));
      continue;
    }

    const violation = normalizeViolation(rawViolation, rule);
    if (violation.evidenceRefs.length === 0) {
      warnings.push(makeWarning(violation, `violation for ${violation.ruleId} has no evidenceRefs`));
      continue;
    }

    if (rule.kind === "hard") {
      hardViolations.push(violation);
      verdict = stricterVerdict(verdict, rule.severityBehavior.onViolation);
      verdict = stricterVerdict(verdict, "REQUEST_CHANGES");
    } else {
      softViolations.push(violation);
      const softVerdict = violation.severity === "NIT" ? "COMMENT" : rule.severityBehavior.onViolation;
      verdict = stricterVerdict(verdict, softVerdict);
    }
  }

  return Object.freeze({
    verdict,
    passed: verdict === "APPROVE" || verdict === "COMMENT",
    hardViolations: Object.freeze(hardViolations),
    softViolations: Object.freeze(softViolations),
    warnings: Object.freeze(warnings),
    appliedRuleIds: Object.freeze([...enabledRules.keys()])
  });
}

function applyOverride(rule, override) {
  return normalizeRule({
    ...rule,
    ...override,
    id: rule.id,
    kind: rule.kind,
    category: rule.category,
    severityBehavior: {
      ...rule.severityBehavior,
      ...(override.severityBehavior ?? {})
    }
  });
}

function validateBuiltInHardRuleNotWeakened(baseRule, mergedRule) {
  if (baseRule.kind !== "hard") {
    return;
  }
  if (!mergedRule.enabled) {
    throw new ConstitutionConfigError(`built-in hard rule cannot be disabled: ${baseRule.id}`);
  }
  if (!mergedRule.severityBehavior.blocksMerge) {
    throw new ConstitutionConfigError(`built-in hard rule cannot stop blocking merge: ${baseRule.id}`);
  }
  if (rank(VERDICT_RANK, mergedRule.severityBehavior.onViolation) < rank(VERDICT_RANK, baseRule.severityBehavior.onViolation)) {
    throw new ConstitutionConfigError(`built-in hard rule verdict cannot be downgraded: ${baseRule.id}`);
  }
  if (rank(SEVERITY_RANK, mergedRule.severityBehavior.defaultSeverity) < rank(SEVERITY_RANK, baseRule.severityBehavior.defaultSeverity)) {
    throw new ConstitutionConfigError(`built-in hard rule severity cannot be downgraded: ${baseRule.id}`);
  }
  if (rank(SEVERITY_RANK, mergedRule.severityBehavior.maxSeverity) < rank(SEVERITY_RANK, baseRule.severityBehavior.maxSeverity)) {
    throw new ConstitutionConfigError(`built-in hard rule max severity cannot be downgraded: ${baseRule.id}`);
  }
}

function normalizeRule(rule) {
  assertObject(rule, "quality rule");
  validateExactKeys(rule, ["id", "kind", "category", "tags", "description", "severityBehavior", "enabled"], `rule ${rule.id ?? "<unknown>"}`);
  validateRuleId(rule.id);
  assertEnum(rule.kind, CONSTRAINT_KINDS, `rule ${rule.id}.kind`);
  assertString(rule.category, `rule ${rule.id}.category`);
  assertString(rule.description, `rule ${rule.id}.description`);
  assertStringArray(rule.tags, `rule ${rule.id}.tags`);
  if (typeof rule.enabled !== "boolean") {
    throw new ConstitutionConfigError(`rule ${rule.id}.enabled must be boolean`);
  }
  const severityBehavior = normalizeSeverityBehavior(rule.id, rule.severityBehavior, true);
  return {
    id: rule.id,
    kind: rule.kind,
    category: rule.category,
    tags: [...rule.tags],
    description: rule.description,
    severityBehavior,
    enabled: rule.enabled
  };
}

function normalizeSeverityBehavior(ruleId, value, requireAllFields) {
  assertObject(value, `rule ${ruleId}.severityBehavior`);
  const required = ["defaultSeverity", "maxSeverity", "onViolation", "blocksMerge"];
  validateExactKeys(value, required, `rule ${ruleId}.severityBehavior`);
  if (requireAllFields) {
    for (const key of required) {
      if (!(key in value)) {
        throw new ConstitutionConfigError(`rule ${ruleId}.severityBehavior.${key} is required`);
      }
    }
  }
  if ("defaultSeverity" in value) {
    assertEnum(value.defaultSeverity, RULE_SEVERITIES, `rule ${ruleId}.severityBehavior.defaultSeverity`);
  }
  if ("maxSeverity" in value) {
    assertEnum(value.maxSeverity, RULE_SEVERITIES, `rule ${ruleId}.severityBehavior.maxSeverity`);
  }
  if ("onViolation" in value) {
    assertEnum(value.onViolation, VERDICTS, `rule ${ruleId}.severityBehavior.onViolation`);
  }
  if ("blocksMerge" in value && typeof value.blocksMerge !== "boolean") {
    throw new ConstitutionConfigError(`rule ${ruleId}.severityBehavior.blocksMerge must be boolean`);
  }
  if (rank(SEVERITY_RANK, value.defaultSeverity) > rank(SEVERITY_RANK, value.maxSeverity)) {
    throw new ConstitutionConfigError(`rule ${ruleId}.defaultSeverity cannot exceed maxSeverity`);
  }
  return {
    defaultSeverity: value.defaultSeverity,
    maxSeverity: value.maxSeverity,
    onViolation: value.onViolation,
    blocksMerge: value.blocksMerge
  };
}

function normalizeViolation(violation, rule) {
  validateExactKeys(
    violation,
    ["ruleId", "kind", "severity", "message", "evidenceRefs", "sourceFindingIds", "sourceConflictIds", "confidence"],
    `violation ${violation.ruleId ?? "<unknown>"}`
  );
  assertEnum(violation.severity, RULE_SEVERITIES, `violation ${violation.ruleId}.severity`);
  assertEnum(violation.confidence, ["HIGH", "MEDIUM", "LOW"], `violation ${violation.ruleId}.confidence`);
  assertString(violation.message, `violation ${violation.ruleId}.message`);
  assertStringArray(violation.evidenceRefs, `violation ${violation.ruleId}.evidenceRefs`);
  assertStringArray(violation.sourceFindingIds, `violation ${violation.ruleId}.sourceFindingIds`);
  assertStringArray(violation.sourceConflictIds, `violation ${violation.ruleId}.sourceConflictIds`);
  return Object.freeze({
    ruleId: violation.ruleId,
    kind: rule.kind,
    severity: violation.severity,
    message: violation.message,
    evidenceRefs: Object.freeze([...violation.evidenceRefs]),
    sourceFindingIds: Object.freeze([...violation.sourceFindingIds]),
    sourceConflictIds: Object.freeze([...violation.sourceConflictIds]),
    confidence: violation.confidence
  });
}

function validateProjectConfigShape(config) {
  assertObject(config, ".revix.yml");
  validateExactKeys(config, COMPAT_CONFIG_KEYS, ".revix.yml");
  if (!("constitution" in config)) {
    return;
  }
  assertObject(config.constitution, "constitution");
  validateExactKeys(config.constitution, ["rules", "additionalRules"], "constitution");
  if ("rules" in config.constitution) {
    assertObject(config.constitution.rules, "constitution.rules");
    for (const [ruleId, override] of Object.entries(config.constitution.rules)) {
      validateRuleId(ruleId);
      validateOverride(ruleId, override);
    }
  }
  if ("additionalRules" in config.constitution) {
    assertObject(config.constitution.additionalRules, "constitution.additionalRules");
    for (const [ruleId, rule] of Object.entries(config.constitution.additionalRules)) {
      validateRuleId(ruleId);
      normalizeRule({ id: ruleId, ...rule });
    }
  }
}

function validateOverride(ruleId, override) {
  assertObject(override, `override ${ruleId}`);
  validateExactKeys(override, ["description", "tags", "enabled", "severityBehavior"], `override ${ruleId}`);
  if ("description" in override) {
    assertString(override.description, `override ${ruleId}.description`);
  }
  if ("tags" in override) {
    assertStringArray(override.tags, `override ${ruleId}.tags`);
  }
  if ("enabled" in override && typeof override.enabled !== "boolean") {
    throw new ConstitutionConfigError(`override ${ruleId}.enabled must be boolean`);
  }
  if ("severityBehavior" in override) {
    assertObject(override.severityBehavior, `override ${ruleId}.severityBehavior`);
    validateExactKeys(override.severityBehavior, ["defaultSeverity", "maxSeverity", "onViolation", "blocksMerge"], `override ${ruleId}.severityBehavior`);
    if ("defaultSeverity" in override.severityBehavior) {
      assertEnum(override.severityBehavior.defaultSeverity, RULE_SEVERITIES, `override ${ruleId}.severityBehavior.defaultSeverity`);
    }
    if ("maxSeverity" in override.severityBehavior) {
      assertEnum(override.severityBehavior.maxSeverity, RULE_SEVERITIES, `override ${ruleId}.severityBehavior.maxSeverity`);
    }
    if ("onViolation" in override.severityBehavior) {
      assertEnum(override.severityBehavior.onViolation, VERDICTS, `override ${ruleId}.severityBehavior.onViolation`);
    }
    if ("blocksMerge" in override.severityBehavior && typeof override.severityBehavior.blocksMerge !== "boolean") {
      throw new ConstitutionConfigError(`override ${ruleId}.severityBehavior.blocksMerge must be boolean`);
    }
  }
}

function validateRuleSet(rules) {
  const ids = new Set();
  for (const rule of rules) {
    if (ids.has(rule.id)) {
      throw new ConstitutionConfigError(`duplicate rule id: ${rule.id}`);
    }
    ids.add(rule.id);
  }
}

function validateRuleId(ruleId) {
  if (typeof ruleId !== "string" || !RULE_ID_PATTERN.test(ruleId)) {
    throw new ConstitutionConfigError(`invalid rule id: ${ruleId}`);
  }
}

function validateExactKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConstitutionConfigError(`${label} has unknown field: ${key}`);
    }
  }
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConstitutionConfigError(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConstitutionConfigError(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ConstitutionConfigError(`${label} must be an array of non-empty strings`);
  }
}

function assertEnum(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    throw new ConstitutionConfigError(`${label} must be one of: ${allowedValues.join(", ")}`);
  }
}

function rank(rankMap, value) {
  const result = rankMap.get(value);
  if (result === undefined) {
    throw new ConstitutionConfigError(`unknown ranked value: ${value}`);
  }
  return result;
}

function stricterVerdict(left, right) {
  return rank(VERDICT_RANK, right) > rank(VERDICT_RANK, left) ? right : left;
}

function cloneRule(rule) {
  return {
    ...rule,
    tags: [...rule.tags],
    severityBehavior: { ...rule.severityBehavior }
  };
}

function freezeRule(rule) {
  return Object.freeze({
    ...rule,
    tags: Object.freeze([...rule.tags]),
    severityBehavior: Object.freeze({ ...rule.severityBehavior })
  });
}

function makeWarning(violation, message) {
  return Object.freeze({
    ruleId: String(violation.ruleId ?? "unknown"),
    message
  });
}

export function parseYamlSubset(source) {
  const lines = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => {
      const withoutComment = raw.trimStart().startsWith("#") ? "" : raw;
      return {
        indent: withoutComment.length - withoutComment.trimStart().length,
        text: withoutComment.trim()
      };
    })
    .filter((line) => line.text.length > 0);

  if (lines.length === 0) {
    return {};
  }
  const [value, nextIndex] = parseBlock(lines, 0, lines[0].indent);
  if (nextIndex !== lines.length) {
    throw new ConstitutionConfigError("unable to parse YAML subset");
  }
  return value;
}

function parseBlock(lines, index, indent) {
  if (lines[index]?.indent !== indent) {
    throw new ConstitutionConfigError("invalid YAML indentation");
  }
  if (lines[index].text.startsWith("- ")) {
    return parseArray(lines, index, indent);
  }
  return parseObject(lines, index, indent);
}

function parseObject(lines, index, indent) {
  const result = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new ConstitutionConfigError(`unexpected YAML indentation near: ${line.text}`);
    }
    if (line.text.startsWith("- ")) {
      break;
    }
    const pair = parseKeyValue(line.text);
    if (pair.valueText === "|" || pair.valueText === ">") {
      const [value, nextIndex] = parseBlockScalar(lines, cursor + 1, indent, pair.valueText);
      result[pair.key] = value;
      cursor = nextIndex;
    } else if (pair.valueText === "") {
      if (cursor + 1 >= lines.length || lines[cursor + 1].indent <= indent) {
        result[pair.key] = {};
        cursor += 1;
      } else {
        const [child, nextIndex] = parseBlock(lines, cursor + 1, lines[cursor + 1].indent);
        result[pair.key] = child;
        cursor = nextIndex;
      }
    } else {
      result[pair.key] = parseScalar(pair.valueText);
      cursor += 1;
    }
  }
  return [result, cursor];
}

function parseArray(lines, index, indent) {
  const result = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent || !line.text.startsWith("- ")) {
      break;
    }
    const rest = line.text.slice(2).trim();
    if (rest === "") {
      const [child, nextIndex] = parseBlock(lines, cursor + 1, lines[cursor + 1].indent);
      result.push(child);
      cursor = nextIndex;
      continue;
    }
    if (rest.includes(":")) {
      const pair = parseKeyValue(rest);
      const item = {};
      cursor += 1;
      if (pair.valueText === "|" || pair.valueText === ">") {
        const [value, nextIndex] = parseBlockScalar(lines, cursor, indent, pair.valueText);
        item[pair.key] = value;
        cursor = nextIndex;
      } else {
        item[pair.key] = pair.valueText === "" ? {} : parseScalar(pair.valueText);
      }
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const [child, nextIndex] = parseObject(lines, cursor, lines[cursor].indent);
        Object.assign(item, child);
        cursor = nextIndex;
      }
      result.push(item);
    } else {
      result.push(parseScalar(rest));
      cursor += 1;
    }
  }
  return [result, cursor];
}

function parseBlockScalar(lines, index, parentIndent, style) {
  const scalarLines = [];
  let cursor = index;
  while (cursor < lines.length && lines[cursor].indent > parentIndent) {
    scalarLines.push(lines[cursor].text);
    cursor += 1;
  }
  if (style === ">") {
    return [scalarLines.join(" ").replace(/\s+/g, " ").trim(), cursor];
  }
  return [scalarLines.join("\n").trim(), cursor];
}

function parseKeyValue(text) {
  const separator = text.indexOf(":");
  if (separator <= 0) {
    throw new ConstitutionConfigError(`expected YAML key/value pair near: ${text}`);
  }
  return {
    key: text.slice(0, separator).trim(),
    valueText: text.slice(separator + 1).trim()
  };
}

function parseScalar(valueText) {
  if (valueText === "true") {
    return true;
  }
  if (valueText === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(valueText)) {
    return Number(valueText);
  }
  if (valueText.startsWith("[") && valueText.endsWith("]")) {
    const inner = valueText.slice(1, -1).trim();
    if (inner === "") {
      return [];
    }
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  if ((valueText.startsWith("\"") && valueText.endsWith("\"")) || (valueText.startsWith("'") && valueText.endsWith("'"))) {
    return valueText.slice(1, -1);
  }
  return valueText;
}
