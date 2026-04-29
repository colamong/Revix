import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../bin/revix.js";

test("CLI prints markdown for valid input", async () => {
  const fixture = makeFixture();
  const result = await runCliForTest([
    "--input",
    fixture.inputPath,
    "--project-root",
    fixture.projectRoot
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Revix PR Review: APPROVE/);
});

test("CLI prints json and fails when configured verdict requires it", async () => {
  const fixture = makeFixture({
    config: `labels:\n  force_reviewers:\n    force-security: [security]\n`,
    findings: [finding("finding-security")]
  });
  const result = await runCliForTest([
    "--input",
    fixture.inputPath,
    "--project-root",
    fixture.projectRoot,
    "--format",
    "json",
    "--reviewer-output",
    fixture.findingsPath
  ]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /"verdict": "BLOCK"/);
});

test("CLI exits non-zero for invalid input", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-cli-invalid-"));
  const inputPath = join(projectRoot, "invalid.json");
  writeFileSync(inputPath, "{}", "utf8");
  const result = await runCliForTest([
    "--input",
    inputPath,
    "--project-root",
    projectRoot
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /metadata/);
});

async function runCliForTest(argv) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(argv, {
    cwd: process.cwd(),
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } }
  });
  return { exitCode, stdout, stderr };
}

function makeFixture({ config = "", findings = [] } = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-cli-"));
  if (config) {
    writeFileSync(join(projectRoot, ".revix.yml"), config, "utf8");
  }
  const inputPath = join(projectRoot, "pr.json");
  const findingsPath = join(projectRoot, "findings.json");
  writeFileSync(inputPath, JSON.stringify(prInput()), "utf8");
  writeFileSync(findingsPath, JSON.stringify(findings), "utf8");
  return { projectRoot, inputPath, findingsPath };
}

function prInput() {
  return {
    metadata: {
      repo: "example/repo",
      number: 42,
      title: "Add session token handling",
      body: "Adds token handling to auth session creation.",
      author: "alice",
      labels: ["force-security"],
      base_ref: "main",
      head_ref: "feature/session-token"
    },
    changed_files: [
      {
        path: "src/auth/session.js",
        status: "modified",
        additions: 2,
        deletions: 1
      }
    ],
    raw_diff: "diff --git a/src/auth/session.js b/src/auth/session.js\n--- a/src/auth/session.js\n+++ b/src/auth/session.js\n@@ -1,2 +1,3 @@\n const a = 1;\n+logger.info({ token: session.token });\n const b = 2;\n"
  };
}

function finding(id) {
  return {
    finding_id: id,
    reviewer_id: "security",
    severity: "BLOCKER",
    claim: "The new token logging path can expose credentials in application logs.",
    evidence: {
      file_path: "src/auth/session.js",
      line_start: 2,
      line_end: 2,
      snippet: "logger.info({ token: session.token });"
    },
    impact: "A user session token could be captured by log aggregation and reused by compromised log readers.",
    suggested_fix: "Remove the token field from the log payload or replace it with a non-sensitive token identifier.",
    verification_test: "Add a test that creates a session and asserts the emitted log payload does not contain the raw token.",
    confidence: "HIGH",
    related_quality_rules: ["security.no_new_risk"],
    tags: ["security"]
  };
}
