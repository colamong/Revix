export class PrClassificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrClassificationError";
  }
}

const PR_TYPES = Object.freeze([
  "feature",
  "bugfix",
  "refactor",
  "infra",
  "security",
  "contract",
  "test",
  "docs",
  "performance",
  "reliability",
  "mixed"
]);
const LEGACY_TYPE_ALIASES = Object.freeze({
  test: "test_only",
  docs: "docs_only",
  infra: "config_change",
  security: "security_sensitive",
  contract: "contract_change",
  performance: "performance_sensitive"
});
const ALIAS_TO_CANONICAL = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_TYPE_ALIASES).map(([canonical, alias]) => [alias, canonical])
));

export function classifyPr(prInput, config) {
  const signals = [];
  const labels = prInput.metadata.labels.map((label) => label.toLowerCase());
  const paths = prInput.changed_files.map((file) => file.path);
  const allDocs = paths.length > 0 && paths.every(isDocsPath);
  const allTests = paths.length > 0 && paths.every(isTestPath);
  const allConfig = paths.length > 0 && paths.every(isConfigPath);
  const allReliability = paths.length > 0 && paths.every(isReliabilityPath);

  addLabelSignals(labels, signals);
  addPathSignals(paths, config, signals);
  if (!allDocs && !allTests && !allConfig && !allReliability) {
    addTitleSignals(prInput.metadata.title, signals);
    addBodySignals(prInput.metadata.body, signals);
  }

  const types = new Set(signals.map((signal) => signal.type));
  if (allDocs) types.add("docs");
  if (allTests) types.add("test");
  if (allConfig) types.add("infra");
  if (allReliability) types.add("reliability");

  const orderedTypes = PR_TYPES.filter((type) => types.has(type));
  const primaryType = orderedTypes.length === 0 ? "mixed" : orderedTypes.length > 1 ? "mixed" : orderedTypes[0];
  const secondaryTypes = primaryType === "mixed" ? orderedTypes : orderedTypes.filter((type) => type !== primaryType);
  const legacyTypes = legacyAliasesFor(orderedTypes);

  return Object.freeze({
    primary_type: primaryType,
    secondary_types: Object.freeze(secondaryTypes),
    legacy_types: Object.freeze(legacyTypes),
    legacy_primary_type: primaryType === "mixed" ? "mixed" : LEGACY_TYPE_ALIASES[primaryType] ?? primaryType,
    signals: Object.freeze(signals),
    confidence: orderedTypes.length === 0 ? "LOW" : orderedTypes.length === 1 ? "HIGH" : "MEDIUM",
    rationale: buildRationale(primaryType, orderedTypes, signals)
  });
}

function addLabelSignals(labels, signals) {
  const labelMap = [
    ["bug", "bugfix"],
    ["bugfix", "bugfix"],
    ["feature", "feature"],
    ["refactor", "refactor"],
    ["infra", "infra"],
    ["ci", "infra"],
    ["ops", "infra"],
    ["security", "security"],
    ["contract", "contract"],
    ["api", "contract"],
    ["performance", "performance"],
    ["perf", "performance"],
    ["reliability", "reliability"],
    ["docs", "docs"],
    ["documentation", "docs"],
    ["test", "test"]
  ];
  for (const [label, type] of labelMap) {
    if (labels.includes(label)) {
      signals.push(signal(type, "label", label));
    }
  }
}

function addPathSignals(paths, config, signals) {
  for (const path of paths) {
    if (matchesAny(path, config.paths.ignored)) continue;
    if (matchesAny(path, config.paths.security_sensitive)) signals.push(signal("security", "path", path, "security_sensitive"));
    if (matchesAny(path, config.paths.contracts)) signals.push(signal("contract", "path", path, "contract_change"));
    if (matchesAny(path, config.paths.performance_sensitive)) signals.push(signal("performance", "path", path, "performance_sensitive"));
    if (isDocsPath(path)) signals.push(signal("docs", "extension", path, "docs_only"));
    if (isTestPath(path)) signals.push(signal("test", "extension", path, "test_only"));
    if (isConfigPath(path)) signals.push(signal("infra", "path", path, "config_change"));
    if (isReliabilityPath(path)) signals.push(signal("reliability", "path", path));
  }
}

function addTitleSignals(title, signals) {
  const lower = title.toLowerCase();
  if (/\bfix(e[sd])?\b|bug/.test(lower)) signals.push(signal("bugfix", "title", title));
  if (/\badd\b|\bnew\b|feature/.test(lower)) signals.push(signal("feature", "title", title));
  if (/refactor/.test(lower)) signals.push(signal("refactor", "title", title));
  if (/\b(ci|deploy|workflow|docker|terraform|infra)\b/.test(lower)) signals.push(signal("infra", "title", title));
  if (/\b(crash|retry|timeout|resilien|reliab)\b/.test(lower)) signals.push(signal("reliability", "title", title));
}

function addBodySignals(body = "", signals) {
  const lower = body.toLowerCase();
  if (/\b(crash|timeout|retry|fallback|resilience|reliability)\b/.test(lower)) signals.push(signal("reliability", "body", body));
}

function signal(type, source, value, legacy_type = LEGACY_TYPE_ALIASES[type]) {
  const normalizedType = ALIAS_TO_CANONICAL[type] ?? type;
  return Object.freeze({
    type: normalizedType,
    source,
    value,
    legacy_type
  });
}

export function matchesAny(path, patterns = []) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function isDocsPath(path) {
  return /(^docs\/|\.md$|\.mdx$)/i.test(path);
}

function isTestPath(path) {
  return /(^test\/|^tests\/|\.test\.[jt]s$|\.spec\.[jt]s$)/i.test(path);
}

function isConfigPath(path) {
  return /(^\.github\/|\.ya?ml$|\.json$|\.toml$|package\.json$)/i.test(path);
}

function isReliabilityPath(path) {
  return /(^src\/reliability\/|^src\/fallback\/|^src\/retry\/|^src\/worker\/|^src\/queue\/|timeout|retry|fallback)/i.test(path);
}

function legacyAliasesFor(types) {
  return Object.freeze(types.map((type) => LEGACY_TYPE_ALIASES[type]).filter(Boolean));
}

function buildRationale(primaryType, orderedTypes, signals) {
  if (signals.length === 0) return "No strong deterministic signals were found.";
  return `${primaryType} selected from ${orderedTypes.join(", ")} signals: ${signals.map((item) => `${item.source}:${item.value}`).join("; ")}`;
}
