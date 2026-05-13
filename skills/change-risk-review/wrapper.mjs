#!/usr/bin/env node
// Convenience wrapper for the change-risk-review skill.
// Translates an agent-friendly { mode, format } object into a Revix CLI invocation.

import { spawn } from "node:child_process";

const ALLOWED_MODES = new Set(["working-tree", "staged", "pr"]);

export async function runChangeRiskReview({ mode = "working-tree", format = "markdown", prNumber, repo, projectRoot } = {}) {
  if (!ALLOWED_MODES.has(mode)) {
    throw new Error(`unknown mode: ${mode}. Use one of: ${[...ALLOWED_MODES].join(", ")}`);
  }
  const args = ["review", "--format", format];
  if (mode === "working-tree") args.push("--working-tree");
  if (mode === "staged") args.push("--staged");
  if (mode === "pr") {
    if (!prNumber || !repo) {
      throw new Error("pr mode requires { prNumber, repo }");
    }
    throw new Error("pr mode is currently delivered via the GitHub Action; invoke revix from CI for PR reviews");
  }
  if (projectRoot) args.push("--project-root", projectRoot);

  return new Promise((resolveFn, rejectFn) => {
    const child = spawn("revix", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectFn);
    child.on("close", (exitCode) => resolveFn({ exitCode, stdout, stderr }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? "working-tree";
  runChangeRiskReview({ mode })
    .then((result) => {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.exitCode ?? 0;
    })
    .catch((error) => {
      process.stderr.write(`${error?.message ?? String(error)}\n`);
      process.exitCode = 1;
    });
}
