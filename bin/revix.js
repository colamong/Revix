#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRevixConfig } from "../src/config/index.js";
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
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(helpText(cwd));
    return 0;
  }
  if (!args.input) {
    throw new Error("--input is required");
  }

  const input = JSON.parse(readFileSync(resolve(cwd, args.input), "utf8"));
  const projectRoot = resolve(cwd, args.projectRoot ?? cwd);
  const config = loadRevixConfig(projectRoot);
  const runner = args.reviewerOutput ? fixtureRunner(resolve(cwd, args.reviewerOutput)) : undefined;
  const result = await runRevixReview(input, {
    projectRoot,
    config,
    outputFormat: args.format,
    runner
  });
  const format = args.format ?? result.output.format;

  if (format === "json") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(result.output.markdown);
  }

  if (shouldFailOnVerdict(result, config)) {
    return 2;
  }
  return 0;
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
      args.input = argv[++index];
      continue;
    }
    if (arg === "--project-root") {
      args.projectRoot = argv[++index];
      continue;
    }
    if (arg === "--format") {
      args.format = argv[++index];
      if (!["markdown", "json"].includes(args.format)) {
        throw new Error("--format must be markdown or json");
      }
      continue;
    }
    if (arg === "--reviewer-output") {
      args.reviewerOutput = argv[++index];
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
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

function shouldFailOnVerdict(result, config) {
  if (!config.verdict.fail_on_request_changes) {
    return false;
  }
  return result.finalDecision.verdict === "REQUEST_CHANGES" || result.finalDecision.verdict === "BLOCK";
}

function helpText(cwd) {
  const binPath = pathToFileURL(resolve(cwd, "bin/revix.js")).pathname;
  return `Usage: node ${binPath} --input pr.json [--project-root .] [--format markdown|json] [--reviewer-output findings.json]\n`;
}
