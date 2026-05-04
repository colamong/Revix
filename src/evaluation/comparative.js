import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { classifyPr } from "../classification/index.js";
import { loadDefaultConstitution, mergeConstitution } from "../constitution/index.js";
import { evaluateFinalDecision } from "../decision/index.js";
import { composeFinalReview } from "../final-composer/index.js";
import { buildReviewerPrompt, renderReviewerPrompt } from "../prompt-builder/index.js";
import { validatePrInput } from "../pr-input/index.js";
import { runSelectedReviewers } from "../reviewer-runner/index.js";
import { selectReviewers } from "../reviewer-selection/index.js";
import { loadEffectiveReviewerSkills } from "../reviewer-skills/index.js";
import { detectConflicts } from "../conflicts/index.js";
import { generateSynthesisOptions } from "../synthesis/index.js";
import { loadRevixConfig } from "../config/index.js";
import {
  evaluateReviewQuality,
  evaluateReviewQualitySuite
} from "./index.js";

export const COMPARATIVE_REVIEWERS = Object.freeze(["revix", "gstack", "greptile", "coderabbit"]);
export const DEFAULT_EVAL_COMMAND = "claude -p --tools \"\" --permission-mode plan --output-format json";

const STYLE_PROFILES = Object.freeze({
  gstack: Object.freeze({
    display_name: "GStack Review",
    rubric: [
      "Run a critical pass for SQL/data safety, race conditions, LLM trust boundaries, shell injection, and enum completeness.",
      "Run an informational pass for async/sync mixing, field safety, prompt issues, type coercion, frontend view issues, time windows, completeness gaps, and CI/CD.",
      "Use confidence calibration. Only report concrete findings with evidence.",
      "Every finding must include an actionable fix and verification."
    ]
  }),
  greptile: Object.freeze({
    display_name: "Greptile-style",
    rubric: [
      "Act as a full-codebase-context PR reviewer that prioritizes bugs, security risks, antipatterns, and multi-file regressions.",
      "Prefer context-aware inline comments with specific evidence and practical suggestions.",
      "Apply repository custom rules when visible in the PR metadata or diff.",
      "Avoid noisy comments; report only issues that a human reviewer should act on."
    ]
  }),
  coderabbit: Object.freeze({
    display_name: "CodeRabbit-style",
    rubric: [
      "Act as a context-aware AI PR reviewer focused on bugs, security, performance regressions, maintainability, and concise fix guidance.",
      "Provide actionable comments suitable for GitHub PR review.",
      "Prefer clear defects over style-only feedback.",
      "Keep findings concise and include a verification step."
    ]
  })
});

export class ComparativeEvaluationError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "ComparativeEvaluationError";
    this.cause = cause;
  }
}

export async function runComparativeReviewQualityEval({
  cases,
  reviewers = COMPARATIVE_REVIEWERS,
  limit,
  outDir,
  command = DEFAULT_EVAL_COMMAND,
  modelRunner,
  cacheDir,
  projectRoot = process.cwd()
} = {}) {
  if (!Array.isArray(cases)) throw new ComparativeEvaluationError("cases must be an array");
  const selectedCases = cases.slice(0, limit ?? cases.length);
  const selectedReviewers = normalizeReviewers(reviewers);
  const runner = modelRunner ?? createCommandModelRunner({ command });
  const effectiveCacheDir = cacheDir ?? (outDir ? join(outDir, "cache") : "");
  const results = [];

  for (const evalCase of selectedCases) {
    for (const reviewer of selectedReviewers) {
      const result = await evaluateReviewerOnCase({
        evalCase,
        reviewer,
        modelRunner: runner,
        cacheDir: effectiveCacheDir,
        projectRoot
      });
      results.push(result);
    }
  }

  const report = buildComparativeReport(results);
  if (outDir) {
    await writeComparativeReport({ outDir, results, report });
  }
  return Object.freeze({ results: Object.freeze(results), report });
}

export async function evaluateReviewerOnCase({ evalCase, reviewer, modelRunner, cacheDir, projectRoot = process.cwd() }) {
  const reviewerId = normalizeReviewers([reviewer])[0];
  try {
    const reviewResult = reviewerId === "revix"
      ? await runRevixEvalProfile({ evalCase, modelRunner, cacheDir, projectRoot })
      : await runStyleEvalProfile({ evalCase, reviewer: reviewerId, modelRunner, cacheDir });
    const evaluation = await evaluateReviewQuality({ evalCase, reviewResult });
    return deepFreeze({
      reviewer: reviewerId,
      eval_id: evalCase.eval_id,
      reviewResult,
      evaluation,
      error: null
    });
  } catch (error) {
    return deepFreeze({
      reviewer: reviewerId,
      eval_id: evalCase.eval_id,
      reviewResult: null,
      evaluation: null,
      error: {
        name: error.name ?? "Error",
        message: error.message
      }
    });
  }
}

export function buildProfilePrompt({ profile, evalCase }) {
  if (profile === "revix") {
    throw new ComparativeEvaluationError("revix uses built-in reviewer prompts");
  }
  const styleProfile = STYLE_PROFILES[profile];
  if (!styleProfile) throw new ComparativeEvaluationError(`unknown reviewer profile: ${profile}`);
  const prInput = normalizeEvalPrInput(evalCase);
  return deepFreeze({
    schema_version: 1,
    task: "local_recreated_review_quality_eval",
    reviewer_profile: {
      reviewer_id: profile,
      display_name: styleProfile.display_name,
      note: "This is a local rubric recreation for comparison, not an official product invocation.",
      rubric: styleProfile.rubric
    },
    output_contract: outputContract(profile),
    pr_input: prInput,
    fairness_rules: [
      "Do not assume hidden ground truth.",
      "Use only the PR metadata and diff in this prompt.",
      "Return an empty findings array when there are no actionable issues.",
      "Return JSON only."
    ]
  });
}

export async function invokeModelForJson({ prompt, modelRunner, cacheKey, cacheDir, repair = true }) {
  if (cacheDir) {
    const cached = await readCache(cacheDir, cacheKey);
    if (cached) return cached;
  }
  const raw = await modelRunner(renderPrompt(prompt));
  let parsed;
  try {
    parsed = parseModelJson(raw);
  } catch (error) {
    if (!repair) throw error;
    const repairRaw = await modelRunner(renderRepairPrompt(raw, error));
    parsed = parseModelJson(repairRaw);
  }
  if (cacheDir) {
    await writeCache(cacheDir, cacheKey, { raw, parsed });
  }
  return { raw, parsed };
}

export function parseModelJson(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new ComparativeEvaluationError("model returned empty output");
  const direct = tryParseJson(text);
  if (direct.ok) return unwrapModelJson(direct.value);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed.ok) return unwrapModelJson(parsed.value);
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const parsed = tryParseJson(text.slice(first, last + 1));
    if (parsed.ok) return unwrapModelJson(parsed.value);
  }
  throw new ComparativeEvaluationError("model output was not parseable JSON");
}

export function normalizeModelFindings({ parsed, reviewer, evalCase }) {
  const rawFindings = Array.isArray(parsed) ? parsed : parsed?.findings ?? [];
  if (!Array.isArray(rawFindings)) {
    throw new ComparativeEvaluationError("model JSON must contain a findings array");
  }
  return rawFindings.map((finding, index) => normalizeModelFinding({ finding, reviewer, evalCase, index }));
}

export function normalizeRevixModelFindings({ parsed, reviewer, selection, evalCase }) {
  const normalized = normalizeModelFindings({ parsed, reviewer: reviewer.reviewer_id, evalCase });
  const allowedTags = selection.scope_context.allowed_tags;
  const allowedRules = selection.scope_context.allowed_quality_rules;
  const fallbackTag = allowedTags[0] ?? reviewer.reviewer_id;
  const fallbackRule = allowedRules[0] ?? `${fallbackTag}.benchmark_signal`;
  return normalized.map((finding) => {
    const tags = finding.tags.filter((tag) => allowedTags.includes(tag));
    const relatedRules = finding.related_quality_rules.filter((ruleId) => allowedRules.includes(ruleId));
    return {
      ...finding,
      reviewer_id: reviewer.reviewer_id,
      tags: tags.length > 0 ? tags : [fallbackTag],
      related_quality_rules: relatedRules.length > 0 ? relatedRules : [fallbackRule]
    };
  });
}

export function createCommandModelRunner({ command = DEFAULT_EVAL_COMMAND, timeoutMs = 120000 } = {}) {
  return async (prompt) => new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new ComparativeEvaluationError(`model command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new ComparativeEvaluationError(`model command exited ${code}: ${stderr.trim()}`));
      }
    });
    child.stdin.end(prompt);
  });
}

export function buildComparativeReport(results) {
  const byReviewer = new Map();
  for (const result of results) {
    const entry = byReviewer.get(result.reviewer) ?? { evaluations: [], errors: [] };
    if (result.evaluation) entry.evaluations.push(result.evaluation);
    if (result.error) entry.errors.push({ eval_id: result.eval_id, ...result.error });
    byReviewer.set(result.reviewer, entry);
  }
  const reviewers = {};
  for (const [reviewer, entry] of [...byReviewer.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    reviewers[reviewer] = {
      ...evaluateReviewQualitySuite(entry.evaluations),
      category_recall: aggregateCategoryRecall(entry.evaluations),
      severity_confusion: aggregateSeverityConfusion(entry.evaluations),
      errors: entry.errors
    };
  }
  return deepFreeze({
    generated_at: new Date().toISOString(),
    reviewer_count: Object.keys(reviewers).length,
    case_count: new Set(results.map((result) => result.eval_id)).size,
    reviewers,
    improvement_candidates: improvementCandidates(reviewers)
  });
}

export async function writeComparativeReport({ outDir, results, report }) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outDir, "summary.md"), renderComparativeMarkdown(report));
}

export function renderComparativeMarkdown(report) {
  const lines = [];
  lines.push("# Revix RQS Comparative Evaluation");
  lines.push("");
  lines.push("This is a local rubric recreation benchmark, not an official Greptile or CodeRabbit product result.");
  lines.push("");
  lines.push("| Reviewer | RQS | Detection | Precision | Evidence | Severity | Actionability | Decision | Noise | Errors |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [reviewer, item] of Object.entries(report.reviewers)) {
    lines.push(`| ${reviewer} | ${item.rqs} | ${item.sub_scores.detection} | ${item.sub_scores.precision} | ${item.sub_scores.evidence} | ${item.sub_scores.severity} | ${item.sub_scores.actionability} | ${item.sub_scores.decision} | ${item.sub_scores.noise} | ${item.errors.length} |`);
  }
  lines.push("");
  lines.push("## Category Breakdown");
  lines.push("");
  lines.push("| Reviewer | Category | Expected | Matched | Recall | Avg RQS |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const [reviewer, item] of Object.entries(report.reviewers)) {
    for (const [category, breakdown] of Object.entries(item.category_breakdown ?? {})) {
      lines.push(`| ${reviewer} | ${category} | ${breakdown.expected} | ${breakdown.matched} | ${breakdown.recall} | ${breakdown.avg_rqs} |`);
    }
  }
  lines.push("");
  lines.push("## Improvement Candidates");
  if (report.improvement_candidates.length === 0) {
    lines.push("- None above the 10 point gap threshold.");
  } else {
    for (const item of report.improvement_candidates) {
      lines.push(`- ${item.metric}: Revix ${item.revix_score}, best comparison ${item.best_score} (${item.best_reviewer}), gap ${item.gap}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function runRevixEvalProfile({ evalCase, modelRunner, cacheDir, projectRoot }) {
  const config = loadRevixConfig(projectRoot);
  const qualityRules = mergeConstitution(loadDefaultConstitution(), {
    constitution: config.quality.overrides
  });
  const prInput = validatePrInput(normalizeEvalPrInput(evalCase));
  const classification = classifyPr(prInput, config);
  const skills = loadEffectiveReviewerSkills(projectRoot, qualityRules);
  const selectedReviewers = selectReviewers({ prInput, classification, config, skills, qualityRules });
  const runner = async ({ reviewer, selection }) => {
    const prompt = buildReviewerPrompt({
      prInput,
      classification,
      selectedReviewer: selection,
      qualityRules,
      config
    });
    const cacheKey = cacheHash("revix", evalCase.eval_id, reviewer.reviewer_id, prompt);
    const { parsed } = await invokeModelForJson({ prompt, modelRunner, cacheKey, cacheDir });
    return normalizeRevixModelFindings({ parsed, reviewer, selection, evalCase });
  };
  const reviewerRun = await runSelectedReviewers({
    prInput,
    classification,
    selectedReviewers,
    runner,
    continueOnError: true
  });
  const conflicts = detectConflicts(reviewerRun.findings);
  const synthesisOptions = generateSynthesisOptions({ findings: reviewerRun.findings, conflicts });
  const finalDecision = evaluateFinalDecision({ qualityRules, findings: reviewerRun.findings, conflicts, synthesisOptions });
  const output = composeFinalReview({
    prInput,
    classification,
    selectedReviewers,
    findings: reviewerRun.findings,
    conflicts,
    synthesisOptions,
    finalDecision,
    format: "github-comment"
  });
  return deepFreeze({ reviewerRun, conflicts, synthesisOptions, finalDecision, output });
}

async function runStyleEvalProfile({ evalCase, reviewer, modelRunner, cacheDir }) {
  const prompt = buildProfilePrompt({ profile: reviewer, evalCase });
  const cacheKey = cacheHash(reviewer, evalCase.eval_id, "profile", prompt);
  const { parsed, raw } = await invokeModelForJson({ prompt, modelRunner, cacheKey, cacheDir });
  const findings = normalizeModelFindings({ parsed, reviewer, evalCase });
  return deepFreeze({
    reviewerRun: { findings },
    synthesisOptions: [],
    finalDecision: { verdict: verdictForFindings(findings) },
    output: { markdown: raw }
  });
}

function normalizeEvalPrInput(evalCase) {
  const input = evalCase?.pr_input ?? {};
  const metadata = input.metadata ?? {};
  const source = input.source ?? {};
  const changedFiles = normalizeChangedFiles(input.diff?.files ?? metadata.files_changed ?? source.changed_files ?? []);
  return {
    metadata: {
      repo: metadata.repo ?? source.repo ?? "swe-prbench/unknown",
      number: normalizePositiveInteger(metadata.number ?? source.pr_number ?? metadata.id),
      title: metadata.title ?? "",
      body: metadata.body ?? metadata.description ?? "",
      author: metadata.author ?? "swe-prbench",
      labels: metadata.labels ?? [],
      base_ref: metadata.base_ref ?? metadata.base_branch ?? "main",
      head_ref: metadata.head_ref ?? metadata.head_branch ?? String(metadata.id ?? "eval")
    },
    changed_files: changedFiles,
    raw_diff: input.raw_diff ?? input.diff?.raw ?? ""
  };
}

function normalizeChangedFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => {
    if (typeof file === "string") {
      return { path: file, status: "modified", additions: 0, deletions: 0 };
    }
    return {
      path: file.path ?? file.file_path ?? "UNKNOWN",
      status: file.status ?? "modified",
      additions: Number.isInteger(file.additions) ? file.additions : 0,
      deletions: Number.isInteger(file.deletions) ? file.deletions : 0,
      patch: file.patch
    };
  });
}

function normalizeModelFinding({ finding, reviewer, evalCase, index }) {
  const category = normalizeCategory(finding.category ?? finding.tags?.[0] ?? reviewer);
  const evidence = normalizeModelEvidence(finding.evidence ?? finding.location ?? {}, evalCase);
  return {
    finding_id: String(finding.finding_id ?? `${reviewer}-${sanitizeId(evalCase.eval_id)}-${index + 1}`),
    reviewer_id: String(finding.reviewer_id ?? reviewer),
    severity: normalizeSeverity(finding.severity),
    claim: concrete(finding.claim ?? finding.title ?? finding.description, "Reviewer identified an actionable PR issue."),
    evidence,
    impact: concrete(finding.impact, "This can cause a regression, confusing behavior, or a missed review requirement for users."),
    suggested_fix: concrete(finding.suggested_fix ?? finding.fix, "Update the changed code so the flagged behavior is handled explicitly and safely."),
    verification_test: concrete(finding.verification_test ?? finding.test, "Add or run a focused regression test that exercises the flagged PR behavior."),
    confidence: normalizeConfidence(finding.confidence),
    related_quality_rules: normalizeRuleIds(finding.related_quality_rules, category),
    tags: normalizeTags(finding.tags, category)
  };
}

function normalizeModelEvidence(evidence, evalCase) {
  if (typeof evidence === "string") {
    return evidenceFromText(evidence, evalCase);
  }
  const fallbackFile = firstChangedFile(evalCase);
  const lineStart = normalizePositiveInteger(evidence.line_start ?? evidence.line ?? evidence.start_line);
  return {
    file_path: String(evidence.file_path ?? evidence.path ?? evidence.file ?? fallbackFile),
    line_start: lineStart,
    line_end: normalizePositiveInteger(evidence.line_end ?? evidence.end_line ?? lineStart),
    snippet: concrete(evidence.snippet ?? evidence.diff_hunk ?? evidence.code, "Evidence is in the PR diff for this changed file.")
  };
}

function evidenceFromText(text, evalCase) {
  const fallbackFile = firstChangedFile(evalCase);
  const file = /`([^`]+\.[A-Za-z0-9]+)`/.exec(text)?.[1]
    ?? /([\w./-]+\.[A-Za-z0-9]+)\s+line/i.exec(text)?.[1]
    ?? fallbackFile;
  const parsedLine = Number.parseInt(/line[s]?\s+(\d+)/i.exec(text)?.[1], 10);
  const lineStart = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : 1;
  return {
    file_path: file,
    line_start: lineStart,
    line_end: lineStart,
    snippet: concrete(text.slice(0, 500), "Evidence is in the PR diff for this changed file.")
  };
}

function outputContract(reviewer) {
  return {
    format: "json_only",
    schema: {
      type: "object",
      required: ["findings"],
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            required: ["severity", "claim", "evidence", "impact", "suggested_fix", "verification_test", "confidence", "tags"]
          }
        }
      }
    },
    reviewer_id: reviewer
  };
}

function renderPrompt(prompt) {
  return JSON.stringify(prompt, null, 2);
}

function renderRepairPrompt(raw, error) {
  return JSON.stringify({
    task: "repair_review_findings_json",
    error: error.message,
    invalid_output: String(raw ?? "").slice(0, 12000),
    instructions: [
      "Return valid JSON only.",
      "Use shape {\"findings\": [...]} or [] with no markdown."
    ]
  });
}

async function readCache(cacheDir, cacheKey) {
  const path = join(cacheDir, `${cacheKey}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeCache(cacheDir, cacheKey, value) {
  const path = join(cacheDir, `${cacheKey}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function cacheHash(...parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function unwrapModelJson(value) {
  if (value?.is_error === true) {
    throw new ComparativeEvaluationError(`model runner returned an error: ${String(value.result ?? value.error ?? "unknown error")}`);
  }
  if (typeof value?.result === "string") {
    const nested = tryParseJson(value.result.trim());
    if (nested.ok) return nested.value;
  }
  return value;
}

function tryParseJson(value) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error };
  }
}

function normalizeReviewers(reviewers) {
  const values = typeof reviewers === "string" ? reviewers.split(",") : reviewers;
  return values.map((item) => String(item).trim()).filter(Boolean).map((item) => {
    if (!COMPARATIVE_REVIEWERS.includes(item)) {
      throw new ComparativeEvaluationError(`unknown reviewer: ${item}`);
    }
    return item;
  });
}

function verdictForFindings(findings) {
  if (findings.some((finding) => finding.severity === "BLOCKER" || finding.severity === "MAJOR")) return "REQUEST_CHANGES";
  return findings.length > 0 ? "COMMENT" : "APPROVE";
}

function normalizeSeverity(value) {
  const upper = String(value ?? "").toUpperCase();
  if (["BLOCKER", "MAJOR", "MINOR", "NIT", "QUESTION"].includes(upper)) return upper;
  if (["P0", "P1", "CRITICAL"].includes(upper)) return "BLOCKER";
  if (["P2", "HIGH"].includes(upper)) return "MAJOR";
  if (["P3", "MEDIUM", "INFO", "INFORMATIONAL"].includes(upper)) return "MINOR";
  if (["P4", "LOW", "NITPICK"].includes(upper)) return "NIT";
  return "MINOR";
}

function normalizeConfidence(value) {
  if (typeof value === "number") {
    if (value >= 8) return "HIGH";
    if (value >= 5) return "MEDIUM";
    return "LOW";
  }
  const upper = String(value ?? "").toUpperCase();
  if (["HIGH", "MEDIUM", "LOW"].includes(upper)) return upper;
  if (["9", "10", "8"].includes(upper)) return "HIGH";
  if (["5", "6", "7"].includes(upper)) return "MEDIUM";
  return "LOW";
}

function normalizeCategory(value) {
  const normalized = String(value ?? "correctness").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  if (normalized === "documentation") return "docs";
  if (["security", "data_loss", "contract", "correctness", "reliability", "performance", "test", "docs", "readability", "style", "nit"].includes(normalized)) {
    return normalized;
  }
  return "correctness";
}

function normalizeTags(tags, category) {
  const values = Array.isArray(tags) ? tags : [category];
  return [...new Set(values.map(normalizeCategory))];
}

function normalizeRuleIds(ruleIds, category) {
  if (Array.isArray(ruleIds) && ruleIds.length > 0) return ruleIds.map((ruleId) => String(ruleId));
  return [`${category}.benchmark_signal`];
}

function concrete(value, fallback) {
  const text = String(value ?? "").trim();
  return text.length >= 12 ? text : fallback;
}

function firstChangedFile(evalCase) {
  const files = evalCase?.pr_input?.metadata?.files_changed ?? evalCase?.pr_input?.diff?.files ?? [];
  const first = files[0];
  if (typeof first === "string") return first;
  return first?.path ?? first?.file_path ?? "UNKNOWN";
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function aggregateCategoryRecall(evaluations) {
  const totals = {};
  for (const evaluation of evaluations) {
    for (const [category, score] of Object.entries(evaluation.category_recall)) {
      const item = totals[category] ?? { sum: 0, count: 0 };
      item.sum += score;
      item.count += 1;
      totals[category] = item;
    }
  }
  return Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right)).map(([category, item]) => [
    category,
    Math.round((item.sum / item.count) * 100) / 100
  ]));
}

function aggregateSeverityConfusion(evaluations) {
  const aggregate = {};
  for (const evaluation of evaluations) {
    for (const [expected, row] of Object.entries(evaluation.severity_confusion)) {
      aggregate[expected] ??= {};
      for (const [actual, count] of Object.entries(row)) {
        aggregate[expected][actual] = (aggregate[expected][actual] ?? 0) + count;
      }
    }
  }
  return aggregate;
}

function improvementCandidates(reviewers) {
  const revix = reviewers.revix;
  if (!revix) return [];
  const candidates = [];
  for (const metric of Object.keys(revix.sub_scores)) {
    const best = bestComparison(reviewers, (item) => item.sub_scores[metric]);
    addCandidate(candidates, metric, revix.sub_scores[metric], best);
  }
  const categories = new Set(Object.values(reviewers).flatMap((item) => Object.keys(item.category_recall)));
  for (const category of categories) {
    const best = bestComparison(reviewers, (item) => item.category_recall[category] ?? 0);
    addCandidate(candidates, `category:${category}`, revix.category_recall[category] ?? 0, best);
  }
  return candidates.sort((left, right) => right.gap - left.gap);
}

function bestComparison(reviewers, scoreOf) {
  let best = { reviewer: "", score: 0 };
  for (const [reviewer, item] of Object.entries(reviewers)) {
    if (reviewer === "revix") continue;
    const score = scoreOf(item);
    if (score > best.score) best = { reviewer, score };
  }
  return best;
}

function addCandidate(candidates, metric, revixScore, best) {
  const gap = Math.round((best.score - revixScore) * 100) / 100;
  if (gap >= 10) {
    candidates.push({
      metric,
      revix_score: revixScore,
      best_score: best.score,
      best_reviewer: best.reviewer,
      gap
    });
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
