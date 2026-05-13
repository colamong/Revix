#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRevixConfig } from "../src/config/index.js";
import { loadDefaultConstitution, mergeConstitution } from "../src/constitution/index.js";
import { parseUnifiedDiff } from "../src/pr-input/index.js";
import { createProvider } from "../src/providers/index.js";
import { loadEffectiveReviewerSkills } from "../src/reviewer-skills/index.js";
import { runRevixReview } from "../src/orchestrator/index.js";
import { collectStagedChangeset, collectWorkingTreeChangeset } from "../src/sources/index.js";
import {
  aggregateBenchResults,
  buildChangesetInput,
  loadRiskBenchCases,
  scoreCaseResult
} from "../src/evaluation/risk-bench.js";
import { detectConflicts } from "../src/conflicts/index.js";
import { generateSynthesisOptions } from "../src/synthesis/index.js";
import { evaluateFinalDecision } from "../src/decision/index.js";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export async function runCli(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const exitCode = await runMain(argv, { cwd, stdout, stderr });
    return exitCode;
  } catch (error) {
    stderr.write(`${error?.message ?? String(error)}\n`);
    return 1;
  }
}

async function runMain(argv, { cwd, stdout, stderr }) {
  const command = commandFrom(argv);
  const args = parseArgs(command.argsArgv ?? command.argv);
  if (args.help) {
    stdout.write(helpText(cwd));
    return 0;
  }
  if (command.name === "check") {
    return runCheck(args, { cwd, stdout });
  }
  if (command.name === "init") {
    return runInit(args, { cwd, stdout });
  }
  if (command.name === "skill") {
    return runSkill(command.argv, args, { cwd, stdout });
  }
  if (command.name === "review") {
    return runReview(args, { cwd, stdout, stderr });
  }
  if (command.name === "eval") {
    return runEval(command.argv, args, { cwd, stdout });
  }
  throw new Error(`unknown command: ${command.name}`);
}

async function runCheck(args, { cwd, stdout }) {
  const projectRoot = resolve(cwd, args.projectRoot ?? cwd);
  const config = loadRevixConfig(projectRoot);
  const qualityRules = mergeConstitution(loadDefaultConstitution(), {
    constitution: config.quality.overrides
  });
  const skills = loadEffectiveReviewerSkills(projectRoot, qualityRules);
  const schemas = readSchemaFiles(cwd);
  const result = {
    status: "ok",
    project_root: projectRoot,
    provider: config.provider.name,
    quality_rules: qualityRules.length,
    reviewer_skills: skills.length,
    schemas: schemas.length
  };

  if (args.format === "json" || args.output === "json") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(`Revix check passed\n`);
    stdout.write(`- Project root: ${projectRoot}\n`);
    stdout.write(`- Provider: ${config.provider.name}\n`);
    stdout.write(`- Quality rules: ${qualityRules.length}\n`);
    stdout.write(`- Reviewer skills: ${skills.length}\n`);
    stdout.write(`- Schemas: ${schemas.length}\n`);
  }
  return 0;
}

function runInit(args, { cwd, stdout }) {
  const projectRoot = resolve(cwd, args.projectRoot ?? cwd);
  const configPath = join(projectRoot, ".revix.yml");
  if (existsSync(configPath) && !args.force) {
    throw new Error(".revix.yml already exists; pass --force to overwrite");
  }
  writeFileSync(configPath, defaultConfigTemplate(), "utf8");
  stdout.write(`Created ${configPath}\n`);
  return 0;
}

function runSkill(argv, args, { cwd, stdout }) {
  if (argv[0] !== "init") {
    throw new Error("unknown skill command: use `revix skill init <reviewer-id>`");
  }
  const reviewerId = argv[1];
  if (!reviewerId || reviewerId.startsWith("-")) {
    throw new Error("revix skill init requires a reviewer id");
  }
  validateReviewerId(reviewerId);
  const projectRoot = resolve(cwd, args.projectRoot ?? cwd);
  const skillDir = join(projectRoot, ".revix", "reviewer-skills");
  const skillPath = join(skillDir, `${reviewerId}.reviewer.yml`);
  if (existsSync(skillPath) && !args.force) {
    throw new Error(`${skillPath} already exists; pass --force to overwrite`);
  }
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillPath, reviewerSkillTemplate(reviewerId), "utf8");
  stdout.write(`Created ${skillPath}\n`);
  return 0;
}

async function runReview(args, { cwd, stdout, stderr }) {
  const input = await resolveReviewInput(args, cwd, stderr);
  const projectRoot = resolve(cwd, args.projectRoot ?? cwd);
  const config = loadRevixConfig(projectRoot);
  const outputFormat = args.format ?? args.output ?? config.output.format;
  if (!["markdown", "json", "github-comment"].includes(outputFormat)) {
    throw new Error("--format/--output must be markdown, json, or github-comment");
  }
  const runner = args.reviewerOutput ? fixtureRunner(resolve(cwd, args.reviewerOutput)) : undefined;
  const provider = runner ? undefined : createProvider(config.provider, {
    projectRoot,
    fixtureDir: args.mockFixtureDir
  });
  const result = await runRevixReview(input, {
    projectRoot,
    config,
    outputFormat,
    runner,
    provider,
    fixtureDir: args.mockFixtureDir
  });

  emitDroppedFindingsWarning(result, stderr);

  if (outputFormat === "json") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(result.output.markdown);
  }

  if (shouldFailOnVerdict(result, config, args.dryRun)) {
    return 2;
  }
  return 0;
}

function emitDroppedFindingsWarning(result, stderr) {
  const dropped = result?.reviewerRun?.dropped;
  if (!stderr || !Array.isArray(dropped) || dropped.length === 0) return;
  const byReviewer = new Map();
  for (const entry of dropped) {
    const reviewer = entry.reviewer_id ?? "unknown";
    byReviewer.set(reviewer, (byReviewer.get(reviewer) ?? 0) + 1);
  }
  const summary = [...byReviewer.entries()]
    .map(([reviewer, count]) => `${reviewer} (${count})`)
    .join(", ");
  stderr.write(`revix: ${dropped.length} finding(s) dropped from reviewer scope - ${summary}. Inspect with --format json under reviewerRun.dropped.\n`);
}

async function runEval(argv, args, { cwd, stdout }) {
  const sub = argv[0];
  if (sub !== "risk-bench") {
    throw new Error("usage: revix eval risk-bench [--cases <dir>] [--case-findings <path>] [--report <path>]");
  }
  const projectRoot = resolve(cwd, args.projectRoot ?? cwd);
  const casesDir = resolve(cwd, args.cases ?? "eval/risk-bench/cases");
  const cases = await loadRiskBenchCases(casesDir);
  if (args.reviewerOutput && !args.caseFindings) {
    throw new Error("`--reviewer-output` is for `revix review`. For `revix eval risk-bench` use `--case-findings <path>` (JSON map keyed by eval_id).");
  }
  const fixtureMap = readFixtureFindingsMap(args.caseFindings, cwd);

  const config = loadRevixConfig(projectRoot);
  const qualityRules = mergeConstitution(loadDefaultConstitution(), {
    constitution: config.quality.overrides
  });
  const results = [];
  for (const caseSpec of cases) {
    const rawFindings = fixtureMap[caseSpec.eval_id] ?? [];
    const findings = normaliseCaseFindings(rawFindings);
    const verdict = runCaseDecisionPipeline(findings, qualityRules);
    const input = buildChangesetInput(caseSpec.changeset);
    const score = scoreCaseResult({
      case: caseSpec,
      findings,
      verdict,
      runtime: { config_provider: config.provider.name }
    });
    results.push({ ...score, input_repo: input.metadata.repo });
  }
  const summary = aggregateBenchResults(results);
  const report = { version: 1, generated_at: new Date().toISOString(), summary, cases: results };

  if (args.report) {
    writeFileSync(resolve(cwd, args.report), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    stdout.write(`Risk-bench report written to ${args.report}\n`);
  } else {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  if (summary.hard_gated > 0 || summary.median_rrs < 60) {
    return 2;
  }
  return 0;
}

function readFixtureFindingsMap(path, cwd) {
  if (!path) return {};
  const raw = JSON.parse(readFileSync(resolve(cwd, path), "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("--case-findings must be a JSON object keyed by eval_id");
  }
  return raw;
}

function normaliseCaseFindings(rawFindings) {
  return rawFindings.map((finding, index) => Object.freeze({
    finding_id: finding.finding_id ?? `case-finding-${index}`,
    reviewer_id: finding.reviewer_id ?? "case",
    severity: finding.severity,
    claim: finding.claim ?? "",
    evidence: Object.freeze({ ...(finding.evidence ?? {}) }),
    impact: finding.impact ?? "",
    suggested_fix: finding.suggested_fix ?? "",
    verification_test: finding.verification_test ?? "",
    confidence: finding.confidence ?? "HIGH",
    related_quality_rules: Object.freeze([...(finding.related_quality_rules ?? [])]),
    tags: Object.freeze([...(finding.tags ?? [])])
  }));
}

function runCaseDecisionPipeline(findings, qualityRules) {
  const conflicts = detectConflicts(findings);
  const synthesisOptions = generateSynthesisOptions({ findings, conflicts });
  const decision = evaluateFinalDecision({ qualityRules, findings, conflicts, synthesisOptions });
  return decision.verdict;
}

function commandFrom(argv) {
  const first = argv[0];
  if (first === "skill") {
    return { name: "skill", argv: argv.slice(1), argsArgv: argv.slice(3) };
  }
  if (first === "eval") {
    return { name: "eval", argv: argv.slice(1), argsArgv: argv.slice(2) };
  }
  if (first === "review" || first === "check") {
    return { name: first, argv: argv.slice(1) };
  }
  if (first === "init") {
    return { name: first, argv: argv.slice(1) };
  }
  if (first && !first.startsWith("-")) {
    return { name: first, argv: argv.slice(1) };
  }
  return { name: "review", argv };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--input") {
      args.input = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--metadata") {
      args.metadata = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--diff") {
      args.diff = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--working-tree") {
      args.workingTree = true;
      continue;
    }
    if (arg === "--staged") {
      args.staged = true;
      continue;
    }
    if (arg === "--source-cwd") {
      args.sourceCwd = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--cases") {
      args.cases = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--case-findings") {
      args.caseFindings = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--report") {
      args.report = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--project-root") {
      args.projectRoot = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--format" || arg === "--output") {
      const value = requireValue(argv, ++index, arg);
      args[arg === "--format" ? "format" : "output"] = value;
      continue;
    }
    if (arg === "--reviewer-output") {
      args.reviewerOutput = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--mock-fixture-dir") {
      args.mockFixtureDir = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--mock") {
      args.mock = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function resolveReviewInput(args, cwd, stderr) {
  if (args.input) {
    return JSON.parse(readFileSync(resolve(cwd, args.input), "utf8"));
  }
  if (args.diff) {
    if (!args.metadata) {
      throw new Error("--metadata is required when using --diff");
    }
    const metadataRaw = JSON.parse(readFileSync(resolve(cwd, args.metadata), "utf8"));
    const metadata = metadataRaw.metadata ?? metadataRaw;
    const rawDiff = readFileSync(resolve(cwd, args.diff), "utf8");
    const parsedDiff = parseUnifiedDiff(rawDiff);
    return {
      metadata,
      changed_files: parsedDiff.files.map((file) => changedFileFromDiff(file)),
      raw_diff: rawDiff
    };
  }
  if (args.workingTree && args.staged) {
    throw new Error("--working-tree and --staged are mutually exclusive");
  }
  const sourceCwd = resolve(cwd, args.sourceCwd ?? cwd);
  if (args.staged) {
    return collectStagedChangeset({ type: "staged", cwd: sourceCwd });
  }
  const changeset = await collectWorkingTreeChangeset({ type: "working-tree", cwd: sourceCwd });
  return stripSourceSideChannels(changeset, stderr);
}

function stripSourceSideChannels(changeset, stderr) {
  if (changeset?.untracked_skipped?.length && stderr) {
    stderr.write(`revix: ${changeset.untracked_skipped.length} untracked entry(ies) were skipped (binary, too-large, or truncated). See \`git status\` for context.\n`);
  }
  if (!changeset || !("untracked_skipped" in changeset)) {
    return changeset;
  }
  const { untracked_skipped: _, ...rest } = changeset;
  return rest;
}

function changedFileFromDiff(file) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions += 1;
      if (line.type === "delete") deletions += 1;
    }
  }
  return {
    path: file.file_path,
    status: "modified",
    additions,
    deletions
  };
}

function fixtureRunner(reviewerOutputPath) {
  const raw = JSON.parse(readFileSync(reviewerOutputPath, "utf8"));
  return ({ reviewer }) => {
    if (Array.isArray(raw)) {
      return raw.filter((finding) => finding.reviewer_id === reviewer.reviewer_id);
    }
    return raw[reviewer.reviewer_id] ?? [];
  };
}

function shouldFailOnVerdict(result, config, dryRun = false) {
  if (dryRun || !config.verdict.fail_on_request_changes) {
    return false;
  }
  return result.finalDecision.verdict === "REQUEST_CHANGES" || result.finalDecision.verdict === "BLOCK";
}

function readSchemaFiles(cwd) {
  const schemaDir = resolve(cwd, "schemas");
  if (!existsSync(schemaDir)) return [];
  return readdirSync(schemaDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => JSON.parse(readFileSync(resolve(schemaDir, fileName), "utf8")));
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function validateReviewerId(reviewerId) {
  if (!/^[a-z][a-z0-9_-]*$/.test(reviewerId)) {
    throw new Error("reviewer id must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, or underscores");
  }
}

function defaultConfigTemplate() {
  return [
    "reviewers:",
    "  enabled: []",
    "  disabled: []",
    "skills:",
    "  paths: []",
    "provider:",
    "  name: mock",
    "  fixture_dir: .revix/mock-provider",
    "  model: \"\"",
    "  temperature: 0",
    "  timeout_ms: 60000",
    "  max_retries: 0",
    "  max_output_tokens: 4096",
    "output:",
    "  format: github-comment",
    "verdict:",
    "  fail_on_request_changes: true",
    ""
  ].join("\n");
}

function reviewerSkillTemplate(reviewerId) {
  const displayName = `${reviewerId.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")} Reviewer`;
  return `schema_version: 1
skill_version: 1.0.0
reviewer_id: ${reviewerId}
display_name: ${displayName}
responsibility: Identify concrete ${reviewerId} review risks that are visible in the PR diff.
background: Review only PR metadata, changed files, and diff evidence. Prefer specific, testable claims over broad commentary.
bias:
  - Prefer findings that include a focused verification path.
flexibility_score: 0.4
allowed_scope:
  tags: [${reviewerId}, testing, verification]
  quality_rules:
    - testability.verifiable_behavior
  file_patterns: ["**/*"]
forbidden_scope:
  tags: [style, formatting]
  note: Do not report style-only issues unless they create a concrete ${reviewerId} risk.
severity_policy:
  max_severity_by_tag:
    ${reviewerId}: MAJOR
    testing: MAJOR
    verification: MAJOR
  blocker_requires:
    confidence: HIGH
    hard_quality_rule: true
  style_only_max_severity: NIT
quality_rules_focus:
  - testability.verifiable_behavior
prompt_instructions:
  - Produce evidence-based findings only.
  - Do not make final merge decisions.
  - Use the structured finding schema exactly.
examples:
  - name: missing verification
    finding:
      severity: MAJOR
      claim: The changed behavior does not include a focused verification path.
      related_quality_rules: [testability.verifiable_behavior]
      tags: [${reviewerId}, testing, verification]
`;
}

function helpText(cwd) {
  const binPath = pathToFileURL(resolve(cwd, "bin/revix.js")).pathname;
  return [
    `Usage: node ${binPath} <command> [options]`,
    "",
    "Commands:",
    "  review            Run the Revix review pipeline",
    "  check             Validate config, quality rules, reviewer skills, and schemas",
    "  init              Create a default .revix.yml",
    "  skill init <reviewer-id>",
    "  eval risk-bench   Score Revix against a risk-bench case suite",
    "                    options: --cases <dir> --case-findings <json> --report <path>",
    "",
    "Review options:",
    "  --input pr.json                  (curated changeset JSON)",
    "  --diff sample.diff --metadata metadata.json",
    "  --working-tree                   (git diff HEAD, default when no other source given)",
    "  --staged                         (git diff --staged)",
    "  --source-cwd <path>              (root for --working-tree / --staged; defaults to cwd)",
    "  --project-root .",
    "  --format markdown|json|github-comment",
    "  --reviewer-output findings.json",
    "  --mock --mock-fixture-dir fixtures/mock-provider",
    "  --dry-run",
    "  --force",
    ""
  ].join("\n");
}
