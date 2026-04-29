import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultConstitution } from "../src/constitution/index.js";
import { evaluateFinalDecision } from "../src/decision/index.js";
import { generateSynthesisOptions } from "../src/synthesis/index.js";

test("hard blocker finding produces BLOCK verdict", () => {
  const qualityRules = loadDefaultConstitution();
  const findings = [finding("finding-security", { severity: "BLOCKER", related_quality_rules: ["security.no_new_risk"] })];
  const synthesisOptions = generateSynthesisOptions({ findings });
  const decision = evaluateFinalDecision({ qualityRules, findings, synthesisOptions });

  assert.equal(decision.verdict, "BLOCK");
  assert.deepEqual(decision.blocking_finding_ids, ["finding-security"]);
  assert.equal(decision.passed, false);
});

test("soft-only finding stays COMMENT", () => {
  const qualityRules = loadDefaultConstitution();
  const findings = [finding("finding-readability", {
    severity: "MINOR",
    reviewer_id: "readability",
    related_quality_rules: ["readability.easy_to_understand"],
    tags: ["readability"]
  })];
  const decision = evaluateFinalDecision({
    qualityRules,
    findings,
    synthesisOptions: generateSynthesisOptions({ findings })
  });

  assert.equal(decision.verdict, "COMMENT");
  assert.equal(decision.passed, true);
});

test("QUESTION and NIT hard-rule findings do not block final decision", () => {
  const qualityRules = loadDefaultConstitution();
  const findings = [
    finding("finding-question", { severity: "QUESTION", confidence: "LOW", claim: "Should this token be logged for the session path?" }),
    finding("finding-nit", { severity: "NIT" })
  ];
  const decision = evaluateFinalDecision({
    qualityRules,
    findings,
    synthesisOptions: generateSynthesisOptions({ findings })
  });

  assert.equal(decision.verdict, "APPROVE");
  assert.equal(decision.warnings.length, 2);
});

test("conflict with blocking finding escalates at least to REQUEST_CHANGES", () => {
  const qualityRules = loadDefaultConstitution();
  const findings = [finding("a", { severity: "MAJOR" }), finding("b", { severity: "NIT", confidence: "LOW" })];
  const conflicts = [{
    conflict_id: "conflict-severity_conflict-a-b",
    type: "severity_conflict",
    finding_ids: ["a", "b"],
    summary: "severity conflict between a and b",
    evidence_refs: ["src/auth/session.js:42-44"],
    resolution_required: true
  }];
  const decision = evaluateFinalDecision({
    qualityRules,
    findings,
    conflicts,
    synthesisOptions: generateSynthesisOptions({ findings, conflicts })
  });

  assert.ok(["REQUEST_CHANGES", "BLOCK"].includes(decision.verdict));
  assert.deepEqual(decision.conflict_ids, ["conflict-severity_conflict-a-b"]);
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
