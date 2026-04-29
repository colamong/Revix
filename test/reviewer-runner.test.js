import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config/index.js";
import { classifyPr } from "../src/classification/index.js";
import { validatePrInput } from "../src/pr-input/index.js";
import { loadDefaultConstitution } from "../src/constitution/index.js";
import { loadBuiltInReviewerSkills } from "../src/reviewer-skills/index.js";
import { selectReviewers } from "../src/reviewer-selection/index.js";
import { ReviewerRunError, runSelectedReviewers } from "../src/reviewer-runner/index.js";
import { validPrInput } from "./pr-input.test.js";

const qualityRules = loadDefaultConstitution();
const skills = loadBuiltInReviewerSkills(qualityRules);

test("normalizes valid reviewer output", async () => {
  const selected = selectedSecurity();
  const result = await runSelectedReviewers({
    prInput: prInput(),
    classification: classifyPr(prInput(), DEFAULT_CONFIG),
    selectedReviewers: selected,
    runner: ({ reviewer }) => reviewer.reviewer_id === "security" ? [finding("security", "finding-001")] : []
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.errors.length, 0);
});

test("rejects invalid reviewer output unless continueOnError is enabled", async () => {
  await assert.rejects(() => runSelectedReviewers({
    prInput: prInput(),
    classification: classifyPr(prInput(), DEFAULT_CONFIG),
    selectedReviewers: selectedSecurity(),
    runner: () => [{ nope: true }]
  }), ReviewerRunError);

  const result = await runSelectedReviewers({
    prInput: prInput(),
    classification: classifyPr(prInput(), DEFAULT_CONFIG),
    selectedReviewers: selectedSecurity(),
    runner: () => [{ nope: true }],
    continueOnError: true
  });
  assert.equal(result.errors.length, 1);
});

test("enforces per-reviewer scope and deterministic aggregation order", async () => {
  const selected = selectedSecurity();
  await assert.rejects(() => runSelectedReviewers({
    prInput: prInput(),
    classification: classifyPr(prInput(), DEFAULT_CONFIG),
    selectedReviewers: selected,
    runner: () => [finding("contract", "finding-002")]
  }), ReviewerRunError);

  const result = await runSelectedReviewers({
    prInput: prInput(),
    classification: classifyPr(prInput(), DEFAULT_CONFIG),
    selectedReviewers: selected,
    runner: () => [finding("security", "finding-b"), finding("security", "finding-a")]
  });
  assert.deepEqual(result.findings.map((item) => item.finding_id), ["finding-a", "finding-b"]);
});

function selectedSecurity() {
  return selectReviewers({
    prInput: prInput(),
    classification: { primary_type: "security_sensitive", secondary_types: [], signals: [], confidence: "HIGH", rationale: "" },
    config: DEFAULT_CONFIG,
    skills,
    qualityRules
  }).filter((item) => item.reviewer_id === "security");
}

function prInput() {
  return validatePrInput(validPrInput({ metadata: { ...validPrInput().metadata, labels: [] } }));
}

function finding(reviewerId, findingId) {
  return {
    finding_id: findingId,
    reviewer_id: reviewerId,
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
