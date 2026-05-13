import { readFileSync } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseYamlSubset } from "../constitution/index.js";

const RISK_BENCH_MAX_RECURSION_DEPTH = 16;

export class RiskBenchError extends Error {
  constructor(message) {
    super(message);
    this.name = "RiskBenchError";
  }
}

export const RISK_BENCH_VERSION = "1";

export const EXECUTION_STAGES = Object.freeze(["pre-commit", "pre-push", "pre-merge", "pre-release"]);
export const RISK_TYPES = Object.freeze([
  "security", "concurrency", "data-loss", "api-break", "perf", "observability", "reliability", "correctness"
]);
const RISK_BENCH_VERDICTS = Object.freeze(["APPROVE", "COMMENT", "REQUEST_CHANGES", "BLOCK"]);

export const RRS_WEIGHTS = Object.freeze({
  must_recall: 0.30,
  should_recall: 0.15,
  forbidden_precision: 0.20,
  budget_adherence: 0.10,
  verdict_correctness: 0.15,
  evidence_quality: 0.10
});

export const MUST_HARD_GATE_CAP = 60;
const MATCH_TOKEN_RATIO = 0.4;
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with", "is",
  "are", "be", "this", "that", "it", "as", "at", "by", "from", "into", "not", "no"
]);

export function scoreCaseResult({ case: caseSpec, findings = [], verdict, runtime = {} }) {
  const mustMatches = matchExpected(caseSpec.must_find, findings);
  const shouldMatches = matchExpected(caseSpec.should_find, findings);
  const allowedMatches = matchExpected(caseSpec.allowed_find, findings);

  const usedFindings = new Set([
    ...mustMatches.usedFindingIndices.keys(),
    ...shouldMatches.usedFindingIndices.keys(),
    ...allowedMatches.usedFindingIndices.keys()
  ]);
  const forbiddenHits = countForbiddenHits(caseSpec.forbidden_find ?? [], findings);

  const mustRecall = ratio(mustMatches.foundCount, caseSpec.must_find?.length ?? 0, 1);
  const shouldRecall = ratio(shouldMatches.foundCount, caseSpec.should_find?.length ?? 0, 1);
  const forbiddenPrecision = findings.length === 0 ? 1 : 1 - (forbiddenHits / findings.length);
  const budgetAdherence = computeBudgetAdherence(caseSpec.review_budget, findings.length, usedFindings.size);
  const verdictCorrectness = verdict === caseSpec.expected_verdict ? 1 : 0;
  const evidenceQuality = computeEvidenceQuality(findings);

  const components = {
    must_recall: mustRecall,
    should_recall: shouldRecall,
    forbidden_precision: forbiddenPrecision,
    budget_adherence: budgetAdherence,
    verdict_correctness: verdictCorrectness,
    evidence_quality: evidenceQuality
  };

  let rrs = 0;
  for (const [key, weight] of Object.entries(RRS_WEIGHTS)) {
    rrs += weight * components[key];
  }
  rrs = Math.round(rrs * 100);
  const mustHardGated = mustRecall < 1 && (caseSpec.must_find?.length ?? 0) > 0;
  if (mustHardGated) {
    rrs = Math.min(rrs, MUST_HARD_GATE_CAP);
  }

  return Object.freeze({
    eval_id: caseSpec.eval_id,
    risk_type: caseSpec.risk_type,
    execution_stage: caseSpec.execution_stage,
    rrs,
    must_hard_gated: mustHardGated,
    components,
    matches: {
      must: mustMatches.detail,
      should: shouldMatches.detail,
      allowed: allowedMatches.detail,
      forbidden_hits: forbiddenHits
    },
    findings_count: findings.length,
    verdict_observed: verdict ?? null,
    runtime
  });
}

export function aggregateBenchResults(results) {
  if (results.length === 0) {
    return Object.freeze({ count: 0, median_rrs: 0, mean_rrs: 0, must_recall_pass_rate: 0, hard_gated: 0 });
  }
  const rrsList = [...results.map((row) => row.rrs)].sort((a, b) => a - b);
  const median = rrsList.length % 2 === 1
    ? rrsList[(rrsList.length - 1) / 2]
    : Math.round((rrsList[rrsList.length / 2 - 1] + rrsList[rrsList.length / 2]) / 2);
  const mean = Math.round(rrsList.reduce((sum, value) => sum + value, 0) / rrsList.length);
  const mustRecallPass = results.filter((row) => row.components.must_recall >= 1).length;
  const hardGated = results.filter((row) => row.must_hard_gated).length;
  return Object.freeze({
    count: results.length,
    median_rrs: median,
    mean_rrs: mean,
    must_recall_pass_rate: round(mustRecallPass / results.length, 3),
    hard_gated: hardGated
  });
}

export function loadRiskBenchCase(filePath) {
  const text = readFileSync(filePath, "utf8");
  const parsed = parseYamlSubset(text);
  return validateRiskBenchCase(parsed, filePath);
}

export async function loadRiskBenchCases(globRoot) {
  const root = resolve(globRoot);
  const stats = await stat(root).catch(() => null);
  if (!stats) {
    throw new RiskBenchError(`risk-bench case directory not found: ${root}`);
  }
  const cases = [];
  const visited = new Set();
  const queue = [{ path: root, depth: 0 }];
  while (queue.length > 0) {
    const { path: dir, depth } = queue.pop();
    if (depth > RISK_BENCH_MAX_RECURSION_DEPTH) {
      throw new RiskBenchError(`risk-bench case directory exceeds max recursion depth ${RISK_BENCH_MAX_RECURSION_DEPTH} at ${dir}`);
    }
    let realDir;
    try {
      realDir = await realpath(dir);
    } catch (error) {
      throw new RiskBenchError(`risk-bench cannot resolve ${dir}: ${error?.message ?? "unknown error"}`);
    }
    if (visited.has(realDir)) {
      continue;
    }
    visited.add(realDir);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const childStat = await stat(path).catch(() => null);
        if (childStat?.isDirectory()) {
          queue.push({ path, depth: depth + 1 });
        } else if (childStat?.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
          const text = await readFile(path, "utf8");
          cases.push(validateRiskBenchCase(parseYamlSubset(text), path));
        }
      } else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
        const text = await readFile(path, "utf8");
        cases.push(validateRiskBenchCase(parseYamlSubset(text), path));
      }
    }
  }
  cases.sort((a, b) => a.eval_id.localeCompare(b.eval_id));
  return cases;
}

export function validateRiskBenchCase(raw, source = "<inline>") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RiskBenchError(`${source}: risk-bench case must be an object`);
  }
  requireString(raw.eval_id, "eval_id", source);
  requireOneOf(raw.risk_type, RISK_TYPES, "risk_type", source);
  requireOneOf(raw.execution_stage, EXECUTION_STAGES, "execution_stage", source);
  if (!Number.isInteger(raw.review_budget) || raw.review_budget < 0) {
    throw new RiskBenchError(`${source}: review_budget must be a non-negative integer`);
  }
  requireOneOf(raw.expected_verdict, RISK_BENCH_VERDICTS, "expected_verdict", source);
  if (!raw.changeset || typeof raw.changeset !== "object") {
    throw new RiskBenchError(`${source}: changeset is required`);
  }
  const mustFind = normalizeExpectedList(raw.must_find, `${source}.must_find`);
  const shouldFind = normalizeExpectedList(raw.should_find, `${source}.should_find`);
  const allowedFind = normalizeExpectedList(raw.allowed_find, `${source}.allowed_find`);
  const forbiddenFind = normalizeForbiddenList(raw.forbidden_find, `${source}.forbidden_find`);
  return Object.freeze({
    eval_id: raw.eval_id,
    risk_type: raw.risk_type,
    execution_stage: raw.execution_stage,
    review_budget: raw.review_budget,
    expected_verdict: raw.expected_verdict,
    changeset: raw.changeset,
    must_find: mustFind,
    should_find: shouldFind,
    allowed_find: allowedFind,
    forbidden_find: forbiddenFind
  });
}

export function buildChangesetInput(changeset) {
  const metadata = changeset.metadata ?? {};
  return {
    metadata: {
      repo: metadata.repo ?? "local",
      number: typeof metadata.number === "number" ? metadata.number : null,
      title: metadata.title ?? "",
      body: metadata.body ?? "",
      author: metadata.author ?? "",
      labels: Array.isArray(metadata.labels) ? metadata.labels : [],
      base_ref: metadata.base_ref ?? "HEAD",
      head_ref: metadata.head_ref ?? "WORKTREE"
    },
    changed_files: changeset.changed_files ?? [],
    raw_diff: changeset.raw_diff ?? ""
  };
}

function normalizeExpectedList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new RiskBenchError(`${label} must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new RiskBenchError(`${label}[${index}] must be an object`);
    }
    requireString(entry.id, "id", `${label}[${index}]`);
    return Object.freeze({
      id: entry.id,
      severity: entry.severity ?? null,
      quality_rule: entry.quality_rule ?? null,
      evidence_files: Object.freeze(Array.isArray(entry.evidence_files) ? [...entry.evidence_files] : []),
      summary_hint: entry.summary_hint ?? null
    });
  });
}

function normalizeForbiddenList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new RiskBenchError(`${label} must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new RiskBenchError(`${label}[${index}] must be an object`);
    }
    if (!entry.pattern_quality_rule && !entry.pattern_summary) {
      throw new RiskBenchError(`${label}[${index}] must define pattern_quality_rule or pattern_summary`);
    }
    return Object.freeze({
      pattern_quality_rule: entry.pattern_quality_rule ?? null,
      pattern_summary: entry.pattern_summary ?? null,
      reason: entry.reason ?? ""
    });
  });
}

function matchExpected(expectedList = [], findings) {
  const detail = [];
  const usedFindingIndices = new Map();
  let foundCount = 0;
  for (const expected of expectedList) {
    const match = findings.findIndex((finding, index) => !usedFindingIndices.has(index) && findingMatchesExpected(finding, expected));
    if (match >= 0) {
      usedFindingIndices.set(match, expected.id);
      foundCount += 1;
      detail.push({ id: expected.id, matched: true, finding_index: match });
    } else {
      detail.push({ id: expected.id, matched: false });
    }
  }
  return { foundCount, detail, usedFindingIndices };
}

export function findingMatchesExpected(finding, expected) {
  if (expected.quality_rule && !findingMatchesQualityRule(finding, expected.quality_rule)) {
    return false;
  }
  if (expected.evidence_files.length > 0 && !findingMatchesAnyFile(finding, expected.evidence_files)) {
    return false;
  }
  if (expected.summary_hint && !fuzzyTextMatch(expected.summary_hint, finding.claim ?? "")) {
    return false;
  }
  return true;
}

function findingMatchesQualityRule(finding, qualityRule) {
  const rules = finding.related_quality_rules ?? [];
  return rules.some((rule) => rule === qualityRule || rule.startsWith(`${qualityRule}.`));
}

function findingMatchesAnyFile(finding, files) {
  const filePath = finding.evidence?.file_path ?? "";
  return files.some((expected) => filePath === expected || filePath.endsWith(`/${expected}`));
}

export function fuzzyTextMatch(needle, haystack) {
  const needleTokens = tokenize(needle);
  if (needleTokens.length === 0) return true;
  const haystackTokens = new Set(tokenize(haystack));
  let hits = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) hits += 1;
  }
  return hits / needleTokens.length >= MATCH_TOKEN_RATIO;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[._-]+|[._-]+$/g, ""))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function countForbiddenHits(forbiddenList, findings) {
  let hits = 0;
  for (const finding of findings) {
    for (const forbidden of forbiddenList) {
      if (findingMatchesForbidden(finding, forbidden)) {
        hits += 1;
        break;
      }
    }
  }
  return hits;
}

function findingMatchesForbidden(finding, forbidden) {
  if (forbidden.pattern_quality_rule) {
    const rx = patternToRegex(forbidden.pattern_quality_rule);
    const rules = finding.related_quality_rules ?? [];
    if (rules.some((rule) => rx.test(rule))) return true;
  }
  if (forbidden.pattern_summary) {
    const claim = (finding.claim ?? "").toLowerCase();
    if (claim.includes(forbidden.pattern_summary.toLowerCase())) return true;
  }
  return false;
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function computeBudgetAdherence(budget, total, kept) {
  if (!Number.isFinite(budget) || budget <= 0) return total === 0 ? 1 : 0;
  if (total <= budget) return 1;
  const overflow = total - budget;
  return Math.max(0, 1 - overflow / budget);
}

function computeEvidenceQuality(findings) {
  if (findings.length === 0) return 1;
  let good = 0;
  for (const finding of findings) {
    if (finding.evidence?.file_path && Number.isInteger(finding.evidence?.line_start)) {
      good += 1;
    }
  }
  return good / findings.length;
}

function ratio(numerator, denominator, fallback) {
  if (denominator <= 0) return fallback;
  return Math.min(1, numerator / denominator);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function requireString(value, key, source) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RiskBenchError(`${source}: ${key} must be a non-empty string`);
  }
}

function requireOneOf(value, allowed, key, source) {
  if (!allowed.includes(value)) {
    throw new RiskBenchError(`${source}: ${key} must be one of ${allowed.join(", ")}`);
  }
}
