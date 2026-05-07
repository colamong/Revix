#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRevixConfig } from "../src/config/index.js";
import { loadDefaultConstitution, mergeConstitution } from "../src/constitution/index.js";
import { parseUnifiedDiff } from "../src/pr-input/index.js";
import { createProvider } from "../src/providers/index.js";
import { loadEffectiveReviewerSkills } from "../src/reviewer-skills/index.js";
import { runRevixReview } from "../src/orchestrator/index.js";

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
    const exitCode = await runMain(argv, { cwd, stdout });
    return exitCode;
  } catch (error) {
    stderr.write(`${error?.message ?? String(error)}\n`);
    return 1;
  }
}

async function runMain(argv, { cwd, stdout }) {
  const command = commandFrom(argv);
  const args = parseArgs(command.argv);
  if (args.help) {
    stdout.write(helpText(cwd));
    return 0;
  }
  if (command.name === "check") {
    return runCheck(args, { cwd, stdout });
  }
  if (command.name === "review") {
    return runReview(args, { cwd, stdout });
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

async function runReview(args, { cwd, stdout }) {
  const input = readReviewInput(args, cwd);
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

function commandFrom(argv) {
  const first = argv[0];
  if (first === "review" || first === "check") {
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
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readReviewInput(args, cwd) {
  if (args.input) {
    return JSON.parse(readFileSync(resolve(cwd, args.input), "utf8"));
  }
  if (!args.diff) {
    throw new Error("--input or --diff is required");
  }
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

function helpText(cwd) {
  const binPath = pathToFileURL(resolve(cwd, "bin/revix.js")).pathname;
  return [
    `Usage: node ${binPath} <command> [options]`,
    "",
    "Commands:",
    "  review   Run the Revix review pipeline",
    "  check    Validate config, quality rules, reviewer skills, and schemas",
    "",
    "Review options:",
    "  --input pr.json",
    "  --diff sample.diff --metadata metadata.json",
    "  --project-root .",
    "  --format markdown|json|github-comment",
    "  --reviewer-output findings.json",
    "  --mock --mock-fixture-dir fixtures/mock-provider",
    "  --dry-run",
    ""
  ].join("\n");
}
