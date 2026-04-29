import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRevixReview } from "../src/index.js";

test("runs TASK05-16 pipeline end to end", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-orchestrator-"));
  writeFileSync(join(projectRoot, ".revix.yml"), `labels:\n  force_reviewers:\n    force-security: [security]\n`, "utf8");

  const result = await runRevixReview(prInput(), {
    projectRoot,
    runner: ({ reviewer }) => reviewer.reviewer_id === "security" ? [finding("finding-security")] : []
  });

  assert.equal(result.classification.primary_type, "mixed");
  assert.equal(result.reviewerRun.findings.length, 1);
  assert.equal(result.finalDecision.verdict, "BLOCK");
  assert.match(result.output.markdown, /Revix PR Review: BLOCK/);
  assert.ok(result.synthesisOptions.some((option) => option.strategy === "request_fix"));
});

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
