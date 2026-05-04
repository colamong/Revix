#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  countComparativeReportErrors,
  createCommandModelRunner,
  DEFAULT_EVAL_COMMAND,
  preflightModelRunner,
  runComparativeReviewQualityEval
} from "../src/evaluation/comparative.js";

const args = parseArgs(process.argv.slice(2));
const casesPath = args.cases ?? "eval-data/swe-prbench/converted/eval-cases.json";
const reviewers = args.reviewers ?? "revix,gstack,greptile,coderabbit";
const outDir = args.out ?? "eval-data/reports/latest";
const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
const command = args.command ?? DEFAULT_EVAL_COMMAND;
const timeoutMs = args["timeout-ms"] ? Number.parseInt(args["timeout-ms"], 10) : undefined;
const diagnostic = Boolean(args.diagnostic);
const allowErrors = Boolean(args["allow-errors"]);
const preflight = !Boolean(args["no-preflight"]);

try {
  const cases = JSON.parse(await readFile(casesPath, "utf8"));
  const modelRunner = createCommandModelRunner({ command, timeoutMs });

  if (preflight) {
    await preflightModelRunner({ modelRunner, command });
  }

  const { results, report } = await runComparativeReviewQualityEval({
    cases,
    reviewers,
    limit,
    outDir,
    command,
    modelRunner
  });

  console.log(`RQS comparative eval complete: ${report.case_count} cases, ${report.reviewer_count} reviewers.`);
  for (const [reviewer, item] of Object.entries(report.reviewers)) {
    console.log(`${reviewer}: RQS ${item.rqs}, detection ${item.sub_scores.detection}, precision ${item.sub_scores.precision}, errors ${item.errors.length}`);
  }
  if (diagnostic) {
    for (const line of diagnosticLines(report, results)) {
      console.log(line);
    }
  }
  console.log(`Report: ${outDir}/summary.md`);

  const errorCount = countComparativeReportErrors(report);
  if (errorCount > 0 && !allowErrors) {
    console.error(`Eval run invalid/incomplete: ${errorCount} reviewer/model error(s). Re-run with --allow-errors to write reports while allowing exit code 0.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(formatCliError(error));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function diagnosticLines(report, results) {
  const lines = [];
  const casesById = new Map();
  for (const reviewerReport of Object.values(report.reviewers)) {
    for (const evaluation of reviewerReport.cases ?? []) {
      if (!casesById.has(evaluation.eval_id)) casesById.set(evaluation.eval_id, []);
    }
  }
  for (const [evalId, rows] of casesById) {
    const expectedCategories = expectedCategoriesFor(report, evalId);
    lines.push(`[diagnostic] case: ${evalId}`);
    for (const row of diagnosticRowsFor(report, results, evalId)) {
      const inScope = row.finding_count > 0 || isReviewerInScope(row.allowed_tags, expectedCategories);
      const suffix = row.finding_count === 0
        ? ` [in-scope: ${inScope ? "yes" : "no"}, expected categories: ${expectedCategories.join(",") || "none"}]`
        : "";
      lines.push(`  reviewer: ${row.reviewer_id.padEnd(11, " ")} -> ${row.finding_count} finding(s)${suffix}`);
      rows.push(row);
    }
  }
  return lines;
}

function diagnosticRowsFor(report, results, evalId) {
  const rows = [];
  for (const [reviewer, reviewerReport] of Object.entries(report.reviewers)) {
    const evaluation = (reviewerReport.cases ?? []).find((item) => item.eval_id === evalId);
    if (!evaluation) continue;
    const reviewResult = findReviewResult(results, reviewer, evalId);
    const diagnosticRows = reviewResult?.diagnostic?.reviewer_runs;
    if (Array.isArray(diagnosticRows) && diagnosticRows.length > 0) {
      rows.push(...diagnosticRows);
    } else {
      rows.push({
        reviewer_id: reviewer,
        finding_count: evaluation.matches.filter((match) => match.matched).length + evaluation.false_positives.length,
        allowed_tags: [reviewer]
      });
    }
  }
  return rows.sort((left, right) => left.reviewer_id.localeCompare(right.reviewer_id));
}

function findReviewResult(results, reviewer, evalId) {
  return results.find((result) => result.reviewer === reviewer && result.eval_id === evalId)?.reviewResult;
}

function expectedCategoriesFor(report, evalId) {
  const categories = new Set();
  for (const reviewerReport of Object.values(report.reviewers)) {
    const evaluation = (reviewerReport.cases ?? []).find((item) => item.eval_id === evalId);
    for (const match of evaluation?.matches ?? []) {
      categories.add(normalizeCategory(match.expected_issue?.category));
    }
    for (const issue of evaluation?.missed_issues ?? []) {
      categories.add(normalizeCategory(issue.category));
    }
    for (const issue of evaluation?.skipped_issues ?? []) {
      categories.add(normalizeCategory(issue.category));
    }
  }
  return [...categories].filter(Boolean).sort();
}

function isReviewerInScope(allowedTags = [], expectedCategories = []) {
  const normalizedAllowed = new Set(allowedTags.map(normalizeCategory));
  return expectedCategories.some((category) => normalizedAllowed.has(category));
}

function normalizeCategory(category) {
  return category === "documentation" ? "docs" : String(category ?? "");
}

function formatCliError(error) {
  const lines = [];
  lines.push(`Eval runner failed: ${error.message}`);
  const details = error.details ?? error.cause?.details;
  if (details?.command) lines.push(`command: ${details.command}`);
  for (const key of ["code", "errno", "syscall", "timeoutMs"]) {
    if (details?.[key] !== undefined) lines.push(`${key}: ${details[key]}`);
  }
  if (details?.stderr) lines.push(`stderr: ${details.stderr}`);
  if (details?.stdout) lines.push(`stdout: ${details.stdout}`);
  const cause = error.cause;
  if (cause && cause !== error) {
    if (cause.code !== undefined) lines.push(`cause.code: ${cause.code}`);
    if (cause.errno !== undefined) lines.push(`cause.errno: ${cause.errno}`);
    if (cause.syscall !== undefined) lines.push(`cause.syscall: ${cause.syscall}`);
  }
  return lines.join("\n");
}
