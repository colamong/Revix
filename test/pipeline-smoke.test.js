import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyPr,
  detectConflicts,
  loadBuiltInReviewerSkills,
  loadDefaultConstitution,
  loadRevixConfig,
  runSelectedReviewers,
  selectReviewers,
  validatePrInput
} from "../src/index.js";

test("TASK05-10 pipeline smoke flow", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-pipeline-"));
  writeFileSync(join(projectRoot, ".revix.yml"), `paths:\n  security_sensitive: [src/auth/**]\nlabels:\n  force_reviewers:\n    force-security: [security]\n`, "utf8");

  const config = loadRevixConfig(projectRoot);
  const qualityRules = loadDefaultConstitution();
  const prInput = validatePrInput({
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
  });

  const classification = classifyPr(prInput, config);
  const skills = loadBuiltInReviewerSkills(qualityRules);
  const selectedReviewers = selectReviewers({
    prInput,
    classification,
    config,
    skills,
    qualityRules
  });

  const run = await runSelectedReviewers({
    prInput,
    classification,
    selectedReviewers,
    runner: ({ reviewer }) => reviewer.reviewer_id === "security" ? [
      finding("finding-security-blocker", "BLOCKER", "HIGH"),
      finding("finding-security-question", "QUESTION", "LOW")
    ] : []
  });

  const conflicts = detectConflicts(run.findings);

  assert.equal(classification.primary_type, "mixed");
  assert.ok(selectedReviewers.some((reviewer) => reviewer.reviewer_id === "security"));
  assert.equal(run.findings.length, 2);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "severity_conflict");
});

function finding(findingId, severity, confidence) {
  return {
    finding_id: findingId,
    reviewer_id: "security",
    severity,
    claim: severity === "QUESTION"
      ? "Should the raw token be present in the log payload for this session path?"
      : "The new token logging path can expose credentials in application logs.",
    evidence: {
      file_path: "src/auth/session.js",
      line_start: 2,
      line_end: 2,
      snippet: "logger.info({ token: session.token });"
    },
    impact: "A user session token could be captured by log aggregation and reused by compromised log readers.",
    suggested_fix: "Remove the token field from the log payload or replace it with a non-sensitive token identifier.",
    verification_test: "Add a test that creates a session and asserts the emitted log payload does not contain the raw token.",
    confidence,
    related_quality_rules: ["security.no_new_risk"],
    tags: ["security"]
  };
}
