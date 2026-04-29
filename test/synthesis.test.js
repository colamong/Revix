import test from "node:test";
import assert from "node:assert/strict";
import { generateSynthesisOptions } from "../src/synthesis/index.js";

test("creates request-fix, clarification, and comment-only options", () => {
  const options = generateSynthesisOptions({
    findings: [
      finding("finding-blocker", { severity: "BLOCKER", confidence: "HIGH" }),
      finding("finding-question", { severity: "QUESTION", confidence: "LOW", claim: "Should this token be logged for the session path?" }),
      finding("finding-nit", { severity: "NIT", confidence: "HIGH" })
    ]
  });

  assert.deepEqual(options.map((option) => option.strategy), ["ask_clarification", "comment_only", "request_fix"]);
  assert.deepEqual(options.map((option) => option.option_id), [
    "option-clarify-finding-question",
    "option-comment-finding-nit",
    "option-fix-finding-blocker"
  ]);
});

test("creates conflict resolution options before finding options", () => {
  const options = generateSynthesisOptions({
    findings: [finding("a", { severity: "BLOCKER" }), finding("b", { severity: "NIT", confidence: "LOW" })],
    conflicts: [{
      conflict_id: "conflict-severity_conflict-a-b",
      type: "severity_conflict",
      finding_ids: ["a", "b"],
      summary: "severity conflict between a and b",
      evidence_refs: ["src/auth/session.js:42-44"],
      resolution_required: true
    }]
  });

  const conflictOption = options.find((option) => option.strategy === "resolve_conflict");
  assert.equal(conflictOption.option_id, "option-conflict-conflict-severity_conflict-a-b");
  assert.equal(conflictOption.confidence, "LOW");
});

function finding(id, overrides = {}) {
  return {
    finding_id: id,
    reviewer_id: "security",
    severity: "MAJOR",
    claim: "The new token logging path can expose credentials in application logs.",
    evidence: {
      file_path: "src/auth/session.js",
      line_start: 42,
      line_end: 44,
      snippet: "logger.info({ token: session.token })"
    },
    impact: "A user session token could be captured by log aggregation and reused by compromised log readers.",
    suggested_fix: "Remove the token field from the log payload or replace it with a non-sensitive token identifier.",
    verification_test: "Add a test that creates a session and asserts the emitted log payload does not contain the raw token.",
    confidence: "HIGH",
    related_quality_rules: ["security.no_new_risk"],
    tags: ["security"],
    ...overrides
  };
}
