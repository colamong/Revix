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
  sources: Object.freeze({
    pr: Object.freeze({
      labels: Object.freeze({
        skip: Object.freeze(["skip-revix"]),
        force_reviewers: Object.freeze({})
      })
    }),
    working_tree: Object.freeze({
      budget: 3,
      severity_floor: "MAJOR"
    }),
    staged: Object.freeze({
      budget: 3,
      severity_floor: "MAJOR"
    })
  }),
  output: Object.freeze({
    format: "markdown"
  }),
  provider: Object.freeze({
    name: "mock",
    fixture_dir: "",
    model: "",
    temperature: 0,
    timeout_ms: 60000,
    max_retries: 0,
    max_output_tokens: 4096
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
  "sources",
  "output",
  "provider",
  "verdict",
  "constitution",
  "reviewer_skills"
]);
const SEVERITY_FLOORS = Object.freeze(["NIT", "QUESTION", "MINOR", "MAJOR", "BLOCKER"]);
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
  const prLabels = rawConfig.sources?.pr?.labels;
  if (prLabels && !rawConfig.labels) {
    normalized.labels = prLabels;
  }
  if (rawConfig.labels && !prLabels) {
    normalized.sources = {
      ...(normalized.sources ?? {}),
      pr: {
        ...(normalized.sources?.pr ?? {}),
        labels: rawConfig.labels
      }
    };
  }
  return normalized;
}

function mergeSection(base, override, label) {
  assertObject(override, label);
  if (["quality.overrides", "severity.overrides", "labels.force_reviewers", "sources.pr.labels.force_reviewers"].includes(label)) {
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
  validateSourcesConfig(config.sources);
  if (!["markdown", "json", "github-comment"].includes(config.output.format)) {
    throw new RevixConfigError("output.format must be markdown, json, or github-comment");
  }
  validateProviderConfig(config.provider);
  if (typeof config.verdict.fail_on_request_changes !== "boolean") {
    throw new RevixConfigError("verdict.fail_on_request_changes must be boolean");
  }
}

function validateSourcesConfig(sources) {
  assertObject(sources, "sources");
  assertObject(sources.pr, "sources.pr");
  assertObject(sources.pr.labels, "sources.pr.labels");
  assertStringArray(sources.pr.labels.skip, "sources.pr.labels.skip", true);
  assertObject(sources.pr.labels.force_reviewers, "sources.pr.labels.force_reviewers");
  for (const stage of ["working_tree", "staged"]) {
    const stageConfig = sources[stage];
    assertObject(stageConfig, `sources.${stage}`);
    if (!Number.isInteger(stageConfig.budget) || stageConfig.budget < 0) {
      throw new RevixConfigError(`sources.${stage}.budget must be a non-negative integer`);
    }
    if (!SEVERITY_FLOORS.includes(stageConfig.severity_floor)) {
      throw new RevixConfigError(`sources.${stage}.severity_floor must be one of ${SEVERITY_FLOORS.join(", ")}`);
    }
  }
}

export function getSourceConfig(config, sourceType) {
  if (sourceType === "pr") {
    return config.sources.pr;
  }
  if (sourceType === "working-tree" || sourceType === "working_tree") {
    return config.sources.working_tree;
  }
  if (sourceType === "staged") {
    return config.sources.staged;
  }
  return undefined;
}

function validateProviderConfig(provider) {
  assertObject(provider, "provider");
  validateExactKeys(provider, ["name", "fixture_dir", "model", "temperature", "timeout_ms", "max_retries", "max_output_tokens"], "provider");
  if (!["mock", "openai", "anthropic"].includes(provider.name)) {
    throw new RevixConfigError("provider.name must be mock, openai, or anthropic");
  }
  if (typeof provider.fixture_dir !== "string") {
    throw new RevixConfigError("provider.fixture_dir must be a string");
  }
  if (typeof provider.model !== "string") {
    throw new RevixConfigError("provider.model must be a string");
  }
  if (typeof provider.temperature !== "number" || provider.temperature < 0 || provider.temperature > 2) {
    throw new RevixConfigError("provider.temperature must be a number from 0 to 2");
  }
  if (!Number.isInteger(provider.timeout_ms) || provider.timeout_ms < 1) {
    throw new RevixConfigError("provider.timeout_ms must be a positive integer");
  }
  if (!Number.isInteger(provider.max_retries) || provider.max_retries < 0) {
    throw new RevixConfigError("provider.max_retries must be a non-negative integer");
  }
  if (!Number.isInteger(provider.max_output_tokens) || provider.max_output_tokens < 1) {
    throw new RevixConfigError("provider.max_output_tokens must be a positive integer");
  }
  if (provider.name !== "mock" && provider.model.trim() === "") {
    throw new RevixConfigError("provider.model is required when provider.name is openai or anthropic");
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
    sources: {
      pr: {
        labels: {
          skip: [...config.sources.pr.labels.skip],
          force_reviewers: Object.fromEntries(Object.entries(config.sources.pr.labels.force_reviewers).map(([label, reviewerIds]) => [label, [...reviewerIds]]))
        }
      },
      working_tree: { ...config.sources.working_tree },
      staged: { ...config.sources.staged }
    },
    output: { ...config.output },
    provider: { ...config.provider },
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
