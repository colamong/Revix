import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDefaultConstitution } from "../src/constitution/index.js";
import { validateFinding } from "../src/findings/index.js";
import {
  BUILTIN_REVIEWER_IDS,
  ReviewerSkillValidationError,
  createFindingValidationContext,
  loadBuiltInReviewerSkills,
  loadEffectiveReviewerSkills,
  validateReviewerSkill
} from "../src/reviewer-skills/index.js";

const qualityRules = loadDefaultConstitution();

test("validates all 10 built-in skills load and pass validation", () => {
  const skills = loadBuiltInReviewerSkills(qualityRules);

  assert.deepEqual(skills.map((skill) => skill.reviewer_id), BUILTIN_REVIEWER_IDS);
  assert.equal(skills.length, 10);
});

test("rejects missing required fields", () => {
  const skill = securitySkill();
  delete skill.display_name;

  assert.throws(() => validateReviewerSkill(skill, qualityRules), ReviewerSkillValidationError);
});

test("rejects invalid reviewer_id", () => {
  assert.throws(() => validateReviewerSkill({ ...securitySkill(), reviewer_id: "Security Reviewer" }, qualityRules), ReviewerSkillValidationError);
});

test("rejects invalid flexibility_score", () => {
  assert.throws(() => validateReviewerSkill({ ...securitySkill(), flexibility_score: 1.2 }, qualityRules), ReviewerSkillValidationError);
});

test("rejects unknown quality rules and empty quality_rules_focus", () => {
  assert.throws(
    () => validateReviewerSkill({
      ...securitySkill(),
      allowed_scope: {
        ...securitySkill().allowed_scope,
        quality_rules: ["security.no_new_risk", "project.unknown_rule"]
      },
      quality_rules_focus: ["project.unknown_rule"]
    }, qualityRules),
    ReviewerSkillValidationError
  );
  assert.throws(() => validateReviewerSkill({ ...securitySkill(), quality_rules_focus: [] }, qualityRules), ReviewerSkillValidationError);
});

test("rejects forbidden and allowed tag overlap", () => {
  assert.throws(
    () => validateReviewerSkill({
      ...securitySkill(),
      forbidden_scope: { tags: ["security"], note: "overlap" }
    }, qualityRules),
    ReviewerSkillValidationError
  );
});

test("rejects built-in overrides that weaken evidence-only or final-judgment separation", () => {
  const projectRoot = projectWithSkill("security.reviewer.yml", securitySkillYaml({
    promptInstructions: [
      "Produce structured findings.",
      "Use the structured finding schema exactly."
    ]
  }));

  assert.throws(() => loadEffectiveReviewerSkills(projectRoot, qualityRules), ReviewerSkillValidationError);
});

test("allows project overrides that narrow scope or add stricter severity policies", () => {
  const projectRoot = projectWithSkill("security.reviewer.yml", securitySkillYaml({
    allowedTags: "[security, privacy]",
    forbiddenTags: "[style, formatting, naming, logging]",
    loggingMaxSeverity: "MINOR",
    exampleTags: "[security, privacy]"
  }));
  const skills = loadEffectiveReviewerSkills(projectRoot, qualityRules);
  const security = skills.find((skill) => skill.reviewer_id === "security");

  assert.deepEqual(security.allowed_scope.tags, ["security", "privacy"]);
  assert.equal(security.severity_policy.max_severity_by_tag.logging, "MINOR");
});

test("allows custom project skills with unique reviewer IDs", () => {
  const projectRoot = projectWithSkill("ai-prompts.reviewer.yml", customSkillYaml());
  const skills = loadEffectiveReviewerSkills(projectRoot, qualityRules);

  assert.ok(skills.some((skill) => skill.reviewer_id === "ai-prompts"));
});

test("rejects duplicate custom reviewer IDs", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-reviewer-skills-"));
  const skillDir = join(projectRoot, ".revix", "reviewer-skills");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "one.reviewer.yml"), customSkillYaml(), "utf8");
  writeFileSync(join(skillDir, "two.reviewer.yml"), customSkillYaml(), "utf8");

  assert.throws(() => loadEffectiveReviewerSkills(projectRoot, qualityRules), ReviewerSkillValidationError);
});

test("applies .revix.yml enabled and disabled reviewer skill selection", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-reviewer-selection-"));
  writeFileSync(join(projectRoot, ".revix.yml"), `reviewer_skills:\n  enabled: [security, contract]\n  disabled: [contract]\n`, "utf8");

  const skills = loadEffectiveReviewerSkills(projectRoot, qualityRules);
  assert.deepEqual(skills.map((skill) => skill.reviewer_id), ["security"]);
});

test("creates finding validation context from reviewer scope", () => {
  const security = loadBuiltInReviewerSkills(qualityRules).find((skill) => skill.reviewer_id === "security");
  const context = createFindingValidationContext(security, qualityRules);

  assert.equal(context.reviewer_id, "security");
  assert.ok(context.allowed_tags.includes("security"));
  assert.ok(context.allowed_quality_rules.includes("security.no_new_risk"));
  assert.equal(context.quality_rules.length, qualityRules.length);
});

test("security and contract examples validate against finding severity constraints", () => {
  const skills = loadBuiltInReviewerSkills(qualityRules);

  for (const reviewerId of ["security", "contract"]) {
    const skill = skills.find((candidate) => candidate.reviewer_id === reviewerId);
    const context = createFindingValidationContext(skill, qualityRules);
    const example = skill.examples[0].finding;
    const finding = validateFinding({
      finding_id: `${reviewerId}-example-001`,
      reviewer_id: reviewerId,
      severity: example.severity,
      claim: example.claim,
      evidence: {
        file_path: "src/example.js",
        line_start: 1,
        line_end: 1,
        snippet: "changed behavior"
      },
      impact: "The changed behavior can affect downstream users or runtime safety in a concrete way.",
      suggested_fix: "Adjust the implementation to preserve the documented behavior or add explicit mitigation.",
      verification_test: "Add a focused regression test that exercises the changed behavior and expected outcome.",
      confidence: "HIGH",
      related_quality_rules: example.related_quality_rules,
      tags: example.tags
    }, context);

    assert.equal(finding.reviewer_id, reviewerId);
  }
});

function projectWithSkill(fileName, contents) {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-reviewer-skills-"));
  const skillDir = join(projectRoot, ".revix", "reviewer-skills");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, fileName), contents, "utf8");
  return projectRoot;
}

function securitySkill() {
  return {
    schema_version: 1,
    skill_version: "1.0.0",
    reviewer_id: "security",
    display_name: "Security Reviewer",
    responsibility: "Identify security regressions and unsafe trust boundaries.",
    background: "Review security risk using only PR metadata, diff, and repository context.",
    bias: ["Prefer fail-closed behavior."],
    flexibility_score: 0.2,
    allowed_scope: {
      tags: ["security", "privacy", "logging"],
      quality_rules: ["security.no_new_risk", "privacy.no_sensitive_data_exposure"],
      file_patterns: ["**/*"]
    },
    forbidden_scope: {
      tags: ["style"],
      note: "Do not report style-only issues."
    },
    severity_policy: {
      max_severity_by_tag: {
        security: "BLOCKER",
        privacy: "BLOCKER",
        logging: "MAJOR"
      },
      blocker_requires: {
        confidence: "HIGH",
        hard_quality_rule: true
      },
      style_only_max_severity: "NIT"
    },
    quality_rules_focus: ["security.no_new_risk", "privacy.no_sensitive_data_exposure"],
    prompt_instructions: [
      "Produce evidence-based findings only.",
      "Do not make final merge decisions.",
      "Use the structured finding schema exactly."
    ],
    examples: [
      {
        name: "token logging",
        finding: {
          severity: "BLOCKER",
          claim: "Raw session tokens are logged during session creation.",
          related_quality_rules: ["security.no_new_risk", "privacy.no_sensitive_data_exposure"],
          tags: ["security", "privacy", "logging"]
        }
      }
    ]
  };
}

function securitySkillYaml({
  allowedTags = "[security, privacy, auth, query, data-access, logging]",
  forbiddenTags = "[style, formatting, naming]",
  loggingMaxSeverity = "MAJOR",
  exampleTags = "[security, privacy, logging]",
  promptInstructions = [
    "Produce evidence-based findings only.",
    "Do not make final merge decisions.",
    "Use the structured finding schema exactly."
  ]
} = {}) {
  return `schema_version: 1
skill_version: 1.0.1
reviewer_id: security
display_name: Security Reviewer
responsibility: Identify security regressions and unsafe trust boundaries.
background: Review security risk using only PR metadata, diff, and repository context.
bias:
  - Prefer fail-closed behavior.
flexibility_score: 0.2
allowed_scope:
  tags: ${allowedTags}
  quality_rules:
    - security.no_new_risk
    - privacy.no_sensitive_data_exposure
    - query.no_unsafe_query_access
  file_patterns: ["**/*"]
forbidden_scope:
  tags: ${forbiddenTags}
  note: Do not report style-only issues.
severity_policy:
  max_severity_by_tag:
    security: BLOCKER
    privacy: BLOCKER
    logging: ${loggingMaxSeverity}
  blocker_requires:
    confidence: HIGH
    hard_quality_rule: true
  style_only_max_severity: NIT
quality_rules_focus:
  - security.no_new_risk
  - privacy.no_sensitive_data_exposure
  - query.no_unsafe_query_access
prompt_instructions:
${promptInstructions.map((line) => `  - ${line}`).join("\n")}
examples:
  - name: token logging
    finding:
      severity: BLOCKER
      claim: Raw session tokens are logged during session creation.
      related_quality_rules: [security.no_new_risk, privacy.no_sensitive_data_exposure]
      tags: ${exampleTags}
`;
}

function customSkillYaml() {
  return `schema_version: 1
skill_version: 1.0.0
reviewer_id: ai-prompts
display_name: AI Prompt Reviewer
responsibility: Identify prompt behavior changes that are not verifiable.
background: Review only prompt and model-behavior changes visible in the diff.
bias:
  - Prefer fixture coverage for prompt changes.
flexibility_score: 0.4
allowed_scope:
  tags: [testability, regression]
  quality_rules:
    - testability.verifiable_behavior
  file_patterns: ["**/*"]
forbidden_scope:
  tags: [style]
  note: Do not report style-only issues.
severity_policy:
  max_severity_by_tag:
    testability: MAJOR
    regression: MAJOR
  blocker_requires:
    confidence: HIGH
    hard_quality_rule: true
  style_only_max_severity: NIT
quality_rules_focus:
  - testability.verifiable_behavior
prompt_instructions:
  - Produce evidence-based findings only.
  - Do not make final merge decisions.
  - Use the structured finding schema exactly.
examples:
  - name: missing fixture
    finding:
      severity: MAJOR
      claim: The prompt behavior changes without a fixture that verifies expected output.
      related_quality_rules: [testability.verifiable_behavior]
      tags: [testability, regression]
`;
}
