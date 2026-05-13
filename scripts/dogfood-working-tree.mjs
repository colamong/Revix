#!/usr/bin/env node
// Drives `revix review --working-tree` against codex CLI as the model backend.
// Promoted from the throwaway tmp script used to dogfood v0.1.1.
//
// Usage:
//   node scripts/dogfood-working-tree.mjs [--output report.json] [--reviewer id,id]
//
// Requires the `codex` CLI on PATH (see scripts/codex-eval-runner.mjs).

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRevixConfig } from "../src/config/index.js";
import { loadDefaultConstitution, mergeConstitution } from "../src/constitution/index.js";
import { parseModelJson } from "../src/evaluation/comparative.js";
import { runRevixReview } from "../src/orchestrator/index.js";
import { buildReviewerPrompt, renderReviewerPrompt } from "../src/prompt-builder/index.js";
import { collectWorkingTreeChangeset } from "../src/sources/working-tree.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CODEX_RUNNER = resolve(REPO_ROOT, "scripts", "codex-eval-runner.mjs");

main().catch((error) => {
  process.stderr.write(`dogfood: ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reviewerFilter = args.reviewer ? new Set(args.reviewer.split(",").map((id) => id.trim())) : null;

  const config = loadRevixConfig(REPO_ROOT);
  const qualityRules = mergeConstitution(loadDefaultConstitution(), { constitution: config.quality.overrides });

  const raw = await collectWorkingTreeChangeset({ type: "working-tree", cwd: REPO_ROOT });
  const { untracked_skipped: _skipped, ...prInput } = raw;
  process.stderr.write(`[dogfood] input: ${prInput.changed_files.length} files, ${prInput.raw_diff.length} diff bytes\n`);

  const codexRunner = async ({ reviewer, selection }) => {
    if (reviewerFilter && !reviewerFilter.has(reviewer.reviewer_id)) {
      process.stderr.write(`[dogfood] skip ${reviewer.reviewer_id} (filtered)\n`);
      return [];
    }
    const promptObj = buildReviewerPrompt({ prInput, selectedReviewer: selection, qualityRules, config });
    const rendered = renderReviewerPrompt(promptObj);
    const started = Date.now();
    process.stderr.write(`[dogfood] -> ${reviewer.reviewer_id} (${rendered.length} chars)\n`);
    const stdout = await spawnCodex(rendered);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    process.stderr.write(`[dogfood] <- ${reviewer.reviewer_id} (${elapsed}s, ${stdout.length} chars)\n`);
    const findings = extractFindings(stdout, reviewer.reviewer_id);
    process.stderr.write(`[dogfood]    findings: ${findings.length}\n`);
    return findings;
  };

  const result = await runRevixReview(prInput, {
    projectRoot: REPO_ROOT,
    config,
    qualityRules,
    outputFormat: "markdown",
    runner: codexRunner,
    continueOnError: true
  });

  const summary = buildSummary(result);
  process.stdout.write(result.output.markdown);
  process.stderr.write(`\n[dogfood] verdict=${summary.verdict} findings=${summary.finding_count} dropped=${summary.dropped.length} errors=${summary.reviewer_errors.length}\n`);

  if (args.output) {
    writeFileSync(resolve(REPO_ROOT, args.output), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    process.stderr.write(`[dogfood] summary written to ${args.output}\n`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output" || arg === "--reviewer") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      out[arg.slice(2)] = value;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: dogfood-working-tree [--output <path>] [--reviewer <id,id>]\n");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function extractFindings(rawText, reviewerId) {
  const text = String(rawText ?? "").trim();
  if (!text) return [];
  try {
    const parsed = parseModelJson(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.findings)) return parsed.findings;
    process.stderr.write(`[dogfood] !! ${reviewerId}: parsed output was not an array (keys=${Object.keys(parsed ?? {}).join(",") || "none"})\n`);
    return [];
  } catch (error) {
    process.stderr.write(`[dogfood] !! ${reviewerId}: parse failed (${error?.message ?? error}); head=${text.slice(0, 120).replace(/\n/g, " ")}\n`);
    return [];
  }
}

function spawnCodex(promptText) {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(process.execPath, [CODEX_RUNNER], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectFn);
    child.on("close", (code) => {
      if (code === 0) resolveFn(stdout);
      else rejectFn(new Error(`codex-eval-runner exited ${code}: ${stderr.slice(-400)}`));
    });
    child.stdin.end(promptText);
  });
}

function buildSummary(result) {
  return {
    verdict: result.finalDecision.verdict,
    finding_count: result.reviewerRun.findings.length,
    reviewer_count: result.selectedReviewers.length,
    dropped: result.reviewerRun.dropped.map((entry) => ({
      finding_id: entry.finding_id,
      reviewer_id: entry.reviewer_id,
      reason: entry.reason
    })),
    reviewer_errors: result.reviewerRun.errors.map((error) => ({
      reviewer_id: error.reviewerId,
      message: error.message,
      cause: error.cause?.message ?? null
    })),
    findings: result.reviewerRun.findings.map((finding) => ({
      finding_id: finding.finding_id,
      reviewer_id: finding.reviewer_id,
      severity: finding.severity,
      confidence: finding.confidence,
      tags: finding.tags,
      claim: finding.claim,
      evidence: finding.evidence,
      suggested_fix: finding.suggested_fix
    }))
  };
}
