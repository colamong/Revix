import test from "node:test";
import assert from "node:assert/strict";
import { detectConflicts } from "../src/conflicts/index.js";

test("returns no conflicts for compatible findings", () => {
  assert.deepEqual(detectConflicts([finding("a", { severity: "MINOR" }), finding("b", { line_start: 20, line_end: 20, severity: "MINOR" })]), []);
});

test("detects severity mismatch on same range", () => {
  const conflicts = detectConflicts([finding("a", { severity: "BLOCKER" }), finding("b", { severity: "NIT" })]);
  assert.equal(conflicts[0].type, "severity_conflict");
});

test("detects incompatible fixes", () => {
  const conflicts = detectConflicts([
    finding("a", { severity: "MAJOR", suggested_fix: "Remove the new token logging statement from this path." }),
    finding("b", { severity: "MAJOR", suggested_fix: "Keep the token logging statement and add a comment." })
  ]);
  assert.equal(conflicts[0].type, "fix_conflict");
});

test("detects claim contradiction across reviewers", () => {
  const conflicts = detectConflicts([
    finding("a", { reviewer_id: "security", claim: "The change removes the authorization check for this endpoint.", line_start: 10, line_end: 10 }),
    finding("b", { reviewer_id: "contract", claim: "The change preserves the authorization check for this endpoint.", line_start: 20, line_end: 20 })
  ]);
  assert.equal(conflicts[0].type, "claim_contradiction");
});

test("detects confidence conflict and stable IDs", () => {
  const conflicts = detectConflicts([
    finding("b", { severity: "MAJOR", confidence: "HIGH" }),
    finding("a", { severity: "MINOR", confidence: "LOW" })
  ]);
  assert.equal(conflicts[0].type, "confidence_conflict");
  assert.equal(conflicts[0].conflict_id, "conflict-confidence_conflict-a-b");
});

function finding(id, overrides = {}) {
  return {
    finding_id: id,
    reviewer_id: "security",
    severity: "MAJOR",
    claim: "The new token logging path can expose credentials in application logs.",
    evidence: {
      file_path: "src/auth/session.js",
      line_start: overrides.line_start ?? 42,
      line_end: overrides.line_end ?? 44,
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
