import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

test("CLI review subcommand supports github-comment output", async () => {
  const fixture = makeFixture();
  const result = await runCliForTest([
    "review",
    "--input",
    fixture.inputPath,
    "--project-root",
    fixture.projectRoot,
    "--format",
    "github-comment"
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

test("CLI dry-run does not fail on request changes", async () => {
  const fixture = makeFixture({
    config: `labels:\n  force_reviewers:\n    force-security: [security]\n`,
    findings: [finding("finding-security")]
  });
  const result = await runCliForTest([
    "review",
    "--input",
    fixture.inputPath,
    "--project-root",
    fixture.projectRoot,
    "--reviewer-output",
    fixture.findingsPath,
    "--dry-run"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Revix PR Review: BLOCK/);
});

test("CLI check validates project configuration and schemas", async () => {
  const fixture = makeFixture();
  const result = await runCliForTest([
    "check",
    "--project-root",
    fixture.projectRoot
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Revix check passed/);
  assert.match(result.stdout, /Reviewer skills:/);
});

test("CLI review can use mock provider fixture directory", async () => {
  const fixture = makeFixture({
    config: `labels:\n  force_reviewers:\n    force-security: [security]\n`
  });
  const mockDir = join(fixture.projectRoot, "mock-provider");
  mkdirSync(mockDir);
  writeFileSync(join(mockDir, "security.json"), JSON.stringify([finding("finding-security")]), "utf8");
  const result = await runCliForTest([
    "review",
    "--input",
    fixture.inputPath,
    "--project-root",
    fixture.projectRoot,
    "--mock-fixture-dir",
    "mock-provider",
    "--dry-run"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /finding-security/);
});

test("CLI review accepts separate diff and metadata inputs", async () => {
  const fixture = makeFixture();
  const diffPath = join(fixture.projectRoot, "sample.diff");
  const metadataPath = join(fixture.projectRoot, "metadata.json");
  writeFileSync(diffPath, prInput().raw_diff, "utf8");
  writeFileSync(metadataPath, JSON.stringify(prInput().metadata), "utf8");
  const result = await runCliForTest([
    "review",
    "--diff",
    diffPath,
    "--metadata",
    metadataPath,
    "--project-root",
    fixture.projectRoot,
    "--dry-run"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Revix PR Review: APPROVE/);
});

test("CLI review with no source flag defaults to working-tree", async () => {
  const repo = makeGitRepoWithEdit();
  const result = await runCliForTest([
    "review",
    "--source-cwd",
    repo,
    "--project-root",
    repo,
    "--dry-run"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Revix PR Review/);
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

test("CLI init creates default config without overwriting", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-cli-init-"));
  const first = await runCliForTest(["init", "--project-root", projectRoot]);
  const second = await runCliForTest(["init", "--project-root", projectRoot]);

  assert.equal(first.exitCode, 0);
  assert.equal(existsSync(join(projectRoot, ".revix.yml")), true);
  assert.equal(second.exitCode, 1);
  assert.match(second.stderr, /already exists/);
});

test("CLI skill init scaffolds a valid reviewer skill", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-cli-skill-init-"));
  const created = await runCliForTest(["skill", "init", "ai-prompts", "--project-root", projectRoot]);
  const checked = await runCliForTest(["check", "--project-root", projectRoot]);

  assert.equal(created.exitCode, 0);
  assert.equal(existsSync(join(projectRoot, ".revix", "reviewer-skills", "ai-prompts.reviewer.yml")), true);
  assert.equal(checked.exitCode, 0);
  assert.match(checked.stdout, /Reviewer skills: 11/);
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

function makeGitRepoWithEdit() {
  const dir = mkdtempSync(join(tmpdir(), "revix-cli-worktree-"));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Revix Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "app.js"), "console.log('hello')\n", "utf8");
  execFileSync("git", ["add", "app.js"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], { cwd: dir });
  writeFileSync(join(dir, "app.js"), "console.log('hello')\nconsole.log('changed')\n", "utf8");
  return dir;
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
