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
  "test_only",
  "docs_only",
  "config_change",
  "security_sensitive",
  "contract_change",
  "performance_sensitive",
  "mixed"
]);

export function classifyPr(prInput, config) {
  const signals = [];
  const labels = prInput.metadata.labels.map((label) => label.toLowerCase());
  const paths = prInput.changed_files.map((file) => file.path);
  const allDocs = paths.length > 0 && paths.every(isDocsPath);
  const allTests = paths.length > 0 && paths.every(isTestPath);
  const allConfig = paths.length > 0 && paths.every(isConfigPath);

  addLabelSignals(labels, signals);
  addPathSignals(paths, config, signals);
  if (!allDocs && !allTests) {
    addTitleSignals(prInput.metadata.title, signals);
  }

  const types = new Set(signals.map((signal) => signal.type));
  if (allDocs) types.add("docs_only");
  if (allTests) types.add("test_only");
  if (allConfig) types.add("config_change");

  const orderedTypes = PR_TYPES.filter((type) => types.has(type));
  const primaryType = orderedTypes.length === 0 ? "mixed" : orderedTypes.length > 1 ? "mixed" : orderedTypes[0];
  const secondaryTypes = primaryType === "mixed" ? orderedTypes : orderedTypes.filter((type) => type !== primaryType);

  return Object.freeze({
    primary_type: primaryType,
    secondary_types: Object.freeze(secondaryTypes),
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
    ["security", "security_sensitive"],
    ["contract", "contract_change"],
    ["performance", "performance_sensitive"],
    ["docs", "docs_only"],
    ["test", "test_only"]
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
    if (matchesAny(path, config.paths.security_sensitive)) signals.push(signal("security_sensitive", "path", path));
    if (matchesAny(path, config.paths.contracts)) signals.push(signal("contract_change", "path", path));
    if (matchesAny(path, config.paths.performance_sensitive)) signals.push(signal("performance_sensitive", "path", path));
    if (isDocsPath(path)) signals.push(signal("docs_only", "extension", path));
    if (isTestPath(path)) signals.push(signal("test_only", "extension", path));
    if (isConfigPath(path)) signals.push(signal("config_change", "path", path));
  }
}

function addTitleSignals(title, signals) {
  const lower = title.toLowerCase();
  if (/\bfix(e[sd])?\b|bug/.test(lower)) signals.push(signal("bugfix", "title", title));
  if (/\badd\b|\bnew\b|feature/.test(lower)) signals.push(signal("feature", "title", title));
  if (/refactor/.test(lower)) signals.push(signal("refactor", "title", title));
}

function signal(type, source, value) {
  return Object.freeze({ type, source, value });
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

function buildRationale(primaryType, orderedTypes, signals) {
  if (signals.length === 0) return "No strong deterministic signals were found.";
  return `${primaryType} selected from ${orderedTypes.join(", ")} signals: ${signals.map((item) => `${item.source}:${item.value}`).join("; ")}`;
}
