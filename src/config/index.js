import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYamlSubset } from "../constitution/index.js";

export class RevixConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "RevixConfigError";
  }
}

export const DEFAULT_CONFIG = Object.freeze({
  reviewers: Object.freeze({
    enabled: Object.freeze([]),
    disabled: Object.freeze([])
  }),
  skills: Object.freeze({
    paths: Object.freeze([])
  }),
  quality: Object.freeze({
    extends: Object.freeze([]),
    overrides: Object.freeze({})
  }),
  paths: Object.freeze({
    contracts: Object.freeze(["api/**", "schemas/**", "proto/**", "openapi/**"]),
    ignored: Object.freeze([]),
    security_sensitive: Object.freeze(["**/auth/**", "**/security/**", "**/*secret*", "**/*token*"]),
    performance_sensitive: Object.freeze(["**/db/**", "**/query/**", "**/cache/**", "**/worker/**"])
  }),
  selection: Object.freeze({
    rules: Object.freeze([])
  }),
  severity: Object.freeze({
    overrides: Object.freeze({})
  }),
  labels: Object.freeze({
    skip: Object.freeze(["skip-revix"]),
    force_reviewers: Object.freeze({})
  }),
  output: Object.freeze({
    format: "markdown"
  }),
  verdict: Object.freeze({
    fail_on_request_changes: true
  })
});

const TOP_LEVEL_KEYS = Object.freeze([
  "reviewers",
  "skills",
  "quality",
  "paths",
  "selection",
  "severity",
  "labels",
  "output",
  "verdict",
  "constitution",
  "reviewer_skills"
]);
const REVIEWER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

export function loadRevixConfig(projectRoot = process.cwd()) {
  const configPath = join(projectRoot, ".revix.yml");
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  return mergeRevixConfig(DEFAULT_CONFIG, parseYamlSubset(readFileSync(configPath, "utf8")));
}

export function mergeRevixConfig(defaultConfig = DEFAULT_CONFIG, rawConfig = {}) {
  assertObject(rawConfig, ".revix.yml");
  validateExactKeys(rawConfig, TOP_LEVEL_KEYS, ".revix.yml");
  const config = cloneConfig(defaultConfig);
  const normalized = normalizeCompatibility(rawConfig);

  for (const [section, value] of Object.entries(normalized)) {
    if (section === "constitution" || section === "reviewer_skills") {
      continue;
    }
    config[section] = mergeSection(config[section], value, section);
  }

  validateConfig(config);
  return deepFreeze(config);
}

export function shouldSkipReview(config, labels = []) {
  const labelSet = new Set(labels);
  const hasSkip = config.labels.skip.some((label) => labelSet.has(label));
  const hasForce = Object.keys(config.labels.force_reviewers).some((label) => labelSet.has(label));
  return hasSkip && !hasForce;
}

export function forcedReviewersForLabels(config, labels = []) {
  const labelSet = new Set(labels);
  const reviewers = new Set();
  for (const [label, reviewerIds] of Object.entries(config.labels.force_reviewers)) {
    if (labelSet.has(label)) {
      for (const reviewerId of reviewerIds) {
        reviewers.add(reviewerId);
      }
    }
  }
  return Object.freeze([...reviewers].sort());
}

function normalizeCompatibility(rawConfig) {
  const normalized = { ...rawConfig };
  if (rawConfig.reviewer_skills) {
    normalized.reviewers = {
      ...(normalized.reviewers ?? {}),
      enabled: rawConfig.reviewer_skills.enabled ?? normalized.reviewers?.enabled,
      disabled: rawConfig.reviewer_skills.disabled ?? normalized.reviewers?.disabled
    };
  }
  if (rawConfig.constitution) {
    normalized.quality = {
      ...(normalized.quality ?? {}),
      overrides: rawConfig.constitution
    };
  }
  return normalized;
}

function mergeSection(base, override, label) {
  assertObject(override, label);
  if (["quality.overrides", "severity.overrides", "labels.force_reviewers"].includes(label)) {
    return override;
  }
  validateExactKeys(override, Object.keys(base), label);
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(result[key]) && isPlainObject(value)) {
      result[key] = mergeSection(result[key], value, `${label}.${key}`);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function validateConfig(config) {
  assertReviewerIds(config.reviewers.enabled, "reviewers.enabled");
  assertReviewerIds(config.reviewers.disabled, "reviewers.disabled");
  assertStringArray(config.skills.paths, "skills.paths", true);
  assertStringArray(config.quality.extends, "quality.extends", true);
  assertObject(config.quality.overrides, "quality.overrides");
  assertStringArray(config.paths.contracts, "paths.contracts", true);
  assertStringArray(config.paths.ignored, "paths.ignored", true);
  assertStringArray(config.paths.security_sensitive, "paths.security_sensitive", true);
  assertStringArray(config.paths.performance_sensitive, "paths.performance_sensitive", true);
  if (!Array.isArray(config.selection.rules)) {
    throw new RevixConfigError("selection.rules must be an array");
  }
  assertObject(config.severity.overrides, "severity.overrides");
  assertStringArray(config.labels.skip, "labels.skip", true);
  assertObject(config.labels.force_reviewers, "labels.force_reviewers");
  for (const [label, reviewerIds] of Object.entries(config.labels.force_reviewers)) {
    assertString(label, "labels.force_reviewers key");
    assertReviewerIds(reviewerIds, `labels.force_reviewers.${label}`);
  }
  if (!["markdown", "json"].includes(config.output.format)) {
    throw new RevixConfigError("output.format must be markdown or json");
  }
  if (typeof config.verdict.fail_on_request_changes !== "boolean") {
    throw new RevixConfigError("verdict.fail_on_request_changes must be boolean");
  }
}

function assertReviewerIds(value, label) {
  assertStringArray(value, label, true);
  for (const reviewerId of value) {
    if (!REVIEWER_ID_PATTERN.test(reviewerId)) {
      throw new RevixConfigError(`${label} contains invalid reviewer id: ${reviewerId}`);
    }
  }
}

function cloneConfig(config) {
  return {
    reviewers: { enabled: [...config.reviewers.enabled], disabled: [...config.reviewers.disabled] },
    skills: { paths: [...config.skills.paths] },
    quality: { extends: [...config.quality.extends], overrides: { ...config.quality.overrides } },
    paths: {
      contracts: [...config.paths.contracts],
      ignored: [...config.paths.ignored],
      security_sensitive: [...config.paths.security_sensitive],
      performance_sensitive: [...config.paths.performance_sensitive]
    },
    selection: { rules: [...config.selection.rules] },
    severity: { overrides: { ...config.severity.overrides } },
    labels: {
      skip: [...config.labels.skip],
      force_reviewers: Object.fromEntries(Object.entries(config.labels.force_reviewers).map(([label, reviewerIds]) => [label, [...reviewerIds]]))
    },
    output: { ...config.output },
    verdict: { ...config.verdict }
  };
}

function assertObject(value, label) {
  if (!isPlainObject(value)) {
    throw new RevixConfigError(`${label} must be an object`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RevixConfigError(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new RevixConfigError(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array of strings`);
  }
}

function validateExactKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new RevixConfigError(`${label} has unknown field: ${key}`);
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
