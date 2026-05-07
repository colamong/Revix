import test from "node:test";
import assert from "node:assert/strict";
import { composeFinalReview } from "../src/final-composer/index.js";
import { evaluateFinalDecision } from "../src/decision/index.js";
import { loadDefaultConstitution } from "../src/constitution/index.js";
import { generateSynthesisOptions } from "../src/synthesis/index.js";

test("composes markdown, json, and github-comment outputs", () => {
  const findings = [finding("finding-security")];
  const synthesisOptions = generateSynthesisOptions({ findings });
  const finalDecision = evaluateFinalDecision({ qualityRules: loadDefaultConstitution(), findings, synthesisOptions });

  const markdown = composeFinalReview({ prInput: prInput(), classification: classification(), findings, synthesisOptions, finalDecision, format: "markdown" });
  const json = composeFinalReview({ prInput: prInput(), classification: classification(), findings, synthesisOptions, finalDecision, format: "json" });
  const github = composeFinalReview({ prInput: prInput(), classification: classification(), findings, synthesisOptions, finalDecision, format: "github-comment" });

  assert.equal(markdown.format, "markdown");
  assert.equal(json.format, "json");
  assert.equal(github.format, "github-comment");
  assert.match(markdown.markdown, /# Verdict/);
  assert.equal(json.markdown, "");
  assert.match(github.markdown, /Revix PR Review: BLOCK/);
  assert.doesNotMatch(github.markdown, /chain-of-thought/i);
});

test("renders low-confidence findings as uncertainty", () => {
  const findings = [finding("finding-question", { severity: "QUESTION", confidence: "LOW", claim: "Should this token be logged for the session path?" })];
  const synthesisOptions = generateSynthesisOptions({ findings });
  const finalDecision = evaluateFinalDecision({ qualityRules: loadDefaultConstitution(), findings, synthesisOptions });
  const output = composeFinalReview({ findings, synthesisOptions, finalDecision, format: "github-comment" });

  assert.match(output.markdown, /low-confidence findings are presented as uncertainty/);
});

function prInput() {
  return {
    metadata: { repo: "example/repo", number: 1 },
    changed_files: [],
    raw_diff: "",
    diff: { raw: "", files: [] }
  };
}

function classification() {
  return {
    primary_type: "security",
    secondary_types: [],
    legacy_primary_type: "security_sensitive",
    legacy_types: ["security_sensitive"],
    signals: [],
    confidence: "HIGH",
    rationale: "security path"
  };
}

function finding(id, overrides = {}) {
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
    tags: ["security"],
    ...overrides
  };
}
