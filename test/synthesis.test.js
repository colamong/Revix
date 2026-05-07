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
  assert.equal(options.find((option) => option.option_id === "option-fix-finding-blocker").implementation_cost, 3);
  assert.ok(options.every((option) => option.required_changes.length > 0));
  assert.ok(options.every((option) => option.score_dimensions.correctness >= 1));
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
  assert.ok(options.some((option) => option.strategy === "compromise"));
  assert.ok(options.some((option) => option.strategy === "minimal_safe_change"));
  assert.ok(options.some((option) => option.strategy === "prefer_reviewer"));
});

test("marks options that weaken hard security or contract rules as disqualified", () => {
  const options = generateSynthesisOptions({
    findings: [finding("a", { severity: "BLOCKER" }), finding("b", { reviewer_id: "performance", tags: ["performance"], related_quality_rules: ["performance.reasonable_cost"] })],
    conflicts: [{
      conflict_id: "conflict-security_vs_performance-a-b",
      type: "security_vs_performance",
      conflict_type: "security_vs_performance",
      finding_ids: ["a", "b"],
      involved_findings: ["a", "b"],
      involved_reviewers: ["performance", "security"],
      summary: "security versus performance conflict",
      competing_claims: [],
      affected_quality_rules: ["security.no_new_risk", "performance.reasonable_cost"],
      evidence_refs: ["src/auth/session.js:42-44"],
      required_resolution: "Preserve security before accepting performance cost.",
      resolution_required: true,
      confidence: "HIGH"
    }]
  });

  const preferPerformance = options.find((option) => option.option_id === "option-prefer-b-conflict-security_vs_performance-a-b");
  assert.equal(preferPerformance.risk, "disqualified");
  assert.match(preferPerformance.disqualified_reason, /Hard security/);
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
