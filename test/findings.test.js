import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultConstitution } from "../src/constitution/index.js";
import {
  FindingValidationError,
  findingCanBlockMerge,
  validateFinding,
  validateFindings
} from "../src/findings/index.js";

const qualityRules = loadDefaultConstitution();
const baseContext = {
  reviewer_id: "security-reviewer",
  allowed_tags: ["security", "privacy", "logging", "question", "style", "nit"],
  allowed_quality_rules: [
    "security.no_new_risk",
    "privacy.no_sensitive_data_exposure",
    "readability.easy_to_understand"
  ],
  quality_rules: qualityRules
};

test("accepts a complete valid finding with primary evidence and optional evidence refs", () => {
  const finding = validateFinding(validFinding(), baseContext);

  assert.equal(finding.finding_id, "finding-001");
  assert.equal(finding.evidence.file_path, "src/auth/session.js");
  assert.equal(finding.evidence_refs.length, 1);
  assert.ok(Object.isFrozen(finding));
  assert.ok(Object.isFrozen(finding.evidence));
});

test("validates arrays of findings", () => {
  const findings = validateFindings([validFinding({ finding_id: "finding-001" }), validFinding({ finding_id: "finding-002" })], baseContext);

  assert.equal(findings.length, 2);
  assert.ok(Object.isFrozen(findings));
});

test("rejects missing evidence", () => {
  const finding = validFinding();
  delete finding.evidence;

  assert.throws(() => validateFinding(finding, baseContext), FindingValidationError);
});

test("rejects empty evidence snippet", () => {
  assert.throws(
    () => validateFinding(validFinding({ evidence: { ...validFinding().evidence, snippet: "" } }), baseContext),
    FindingValidationError
  );
});

test("rejects invalid line ranges", () => {
  assert.throws(
    () => validateFinding(validFinding({ evidence: { ...validFinding().evidence, line_start: 44, line_end: 42 } }), baseContext),
    FindingValidationError
  );
});

test("rejects unknown fields", () => {
  assert.throws(() => validateFinding({ ...validFinding(), extra: true }, baseContext), FindingValidationError);
});

test("rejects invalid severity and confidence", () => {
  assert.throws(() => validateFinding(validFinding({ severity: "CRITICAL" }), baseContext), FindingValidationError);
  assert.throws(() => validateFinding(validFinding({ confidence: "SURE" }), baseContext), FindingValidationError);
});

test("rejects vague claim, impact, suggested fix, and verification test", () => {
  assert.throws(() => validateFinding(validFinding({ claim: "Looks wrong." }), baseContext), FindingValidationError);
  assert.throws(() => validateFinding(validFinding({ impact: "Bad code." }), baseContext), FindingValidationError);
  assert.throws(() => validateFinding(validFinding({ suggested_fix: "Fix this." }), baseContext), FindingValidationError);
  assert.throws(() => validateFinding(validFinding({ verification_test: "Check it." }), baseContext), FindingValidationError);
});

test("rejects LOW confidence BLOCKER", () => {
  assert.throws(() => validateFinding(validFinding({ severity: "BLOCKER", confidence: "LOW" }), baseContext), FindingValidationError);
});

test("rejects style or nit tagged findings at BLOCKER or MAJOR", () => {
  assert.throws(() => validateFinding(validFinding({ severity: "MAJOR", tags: ["style"] }), styleContext()), FindingValidationError);
  assert.throws(() => validateFinding(validFinding({ severity: "BLOCKER", tags: ["nit"] }), styleContext()), FindingValidationError);
});

test("rejects BLOCKER without a hard related quality rule", () => {
  assert.throws(
    () => validateFinding(validFinding({
      severity: "BLOCKER",
      related_quality_rules: ["readability.easy_to_understand"],
      tags: ["style"]
    }), styleContext()),
    FindingValidationError
  );
});

test("rejects unknown related quality rules", () => {
  assert.throws(
    () => validateFinding(validFinding({ related_quality_rules: ["project.unknown_rule"] }), {
      ...baseContext,
      allowed_quality_rules: [...baseContext.allowed_quality_rules, "project.unknown_rule"]
    }),
    FindingValidationError
  );
});

test("rejects findings outside reviewer scope", () => {
  assert.throws(() => validateFinding(validFinding({ reviewer_id: "performance-reviewer" }), baseContext), FindingValidationError);
  assert.throws(() => validateFinding(validFinding({ tags: ["performance"] }), baseContext), FindingValidationError);
  assert.throws(
    () => validateFinding(validFinding({ related_quality_rules: ["query.no_unsafe_query_access"] }), baseContext),
    FindingValidationError
  );
});

test("confirms NIT and QUESTION findings remain non-blocking", () => {
  const nit = validateFinding(validFinding({
    severity: "NIT",
    confidence: "LOW",
    related_quality_rules: ["readability.easy_to_understand"],
    tags: ["nit"]
  }), styleContext());
  const question = validateFinding(validFinding({
    severity: "QUESTION",
    confidence: "LOW",
    claim: "Should this log include the user identifier when privacy mode is enabled?",
    related_quality_rules: ["readability.easy_to_understand"],
    tags: ["question"]
  }), styleContext());

  assert.equal(findingCanBlockMerge(nit), false);
  assert.equal(findingCanBlockMerge(question), false);
});

test("normalizes returned findings deterministically", () => {
  const finding = validateFinding(validFinding({
    finding_id: " finding-003 ",
    reviewer_id: " security-reviewer ",
    tags: ["Security", "Privacy", "Logging"]
  }), baseContext);

  assert.equal(finding.finding_id, "finding-003");
  assert.equal(finding.reviewer_id, "security-reviewer");
  assert.deepEqual(finding.tags, ["security", "privacy", "logging"]);
});

function validFinding(overrides = {}) {
  return {
    finding_id: "finding-001",
    reviewer_id: "security-reviewer",
    severity: "BLOCKER",
    claim: "The new token logging path can expose credentials in application logs.",
    evidence: {
      file_path: "src/auth/session.js",
      line_start: 42,
      line_end: 44,
      snippet: "logger.info({ token: session.token }, \"session created\")"
    },
    evidence_refs: [
      {
        file_path: "src/auth/session.js",
        line_start: 12,
        line_end: 13,
        snippet: "token: string"
      }
    ],
    impact: "A user session token could be captured by log aggregation and reused by compromised log readers.",
    suggested_fix: "Remove the token field from the log payload or replace it with a non-sensitive token identifier.",
    verification_test: "Add a test that creates a session and asserts the emitted log payload does not contain the raw token.",
    confidence: "HIGH",
    related_quality_rules: ["security.no_new_risk", "privacy.no_sensitive_data_exposure"],
    tags: ["security", "privacy", "logging"],
    ...overrides
  };
}

function styleContext() {
  return {
    reviewer_id: "security-reviewer",
    allowed_tags: ["style", "nit", "question"],
    allowed_quality_rules: ["readability.easy_to_understand"],
    quality_rules: qualityRules
  };
}
