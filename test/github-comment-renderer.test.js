import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFinalDecision, generateSynthesisOptions, loadDefaultConstitution, renderGitHubReviewComment } from "../src/index.js";

test("renders markdown with required finding fields", () => {
  const qualityRules = loadDefaultConstitution();
  const findings = [finding("finding-security")];
  const synthesisOptions = generateSynthesisOptions({ findings });
  const finalDecision = evaluateFinalDecision({ qualityRules, findings, synthesisOptions });
  const rendered = renderGitHubReviewComment({
    prInput: {
      metadata: { repo: "example/repo", number: 1 },
      changed_files: [],
      raw_diff: "",
      diff: { raw: "", files: [] }
    },
    classification: {
      primary_type: "security_sensitive",
      secondary_types: [],
      signals: [],
      confidence: "HIGH",
      rationale: "security path"
    },
    selectedReviewers: [{ reviewer_id: "security", reason: "matched security", matched_signals: [], skill: {}, scope_context: {} }],
    findings,
    conflicts: [],
    synthesisOptions,
    finalDecision
  });

  assert.match(rendered.markdown, /Claim:/);
  assert.match(rendered.markdown, /Evidence:/);
  assert.match(rendered.markdown, /Impact:/);
  assert.match(rendered.markdown, /Verification test:/);
  assert.match(rendered.markdown, /Suggested fix:/);
  assert.match(rendered.markdown, /Related quality rules:/);
  assert.equal(rendered.json.verdict, "BLOCK");
});

function finding(id) {
  return {
    finding_id: id,
    reviewer_id: "security",
    severity: "BLOCKER",
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
    tags: ["security"]
  };
}
