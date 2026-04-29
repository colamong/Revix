import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConstitutionConfigError,
  evaluateConstitution,
  loadDefaultConstitution,
  loadEffectiveConstitution,
  mergeConstitution
} from "../src/constitution/index.js";

const HARD_RULE_IDS = [
  "security.no_new_risk",
  "contract.no_breaking_change_without_versioning",
  "reliability.fail_safely",
  "privacy.no_sensitive_data_exposure",
  "query.no_unsafe_query_access"
];

const SOFT_RULE_IDS = [
  "maintainability.clear_boundaries",
  "readability.easy_to_understand",
  "performance.reasonable_cost",
  "observability.debuggable_failure",
  "testability.verifiable_behavior",
  "simplicity.minimal_necessary_change"
];

test("loads all required default hard and soft rule IDs", () => {
  const rules = loadDefaultConstitution();
  const byId = new Map(rules.map((rule) => [rule.id, rule]));

  for (const ruleId of HARD_RULE_IDS) {
    assert.equal(byId.get(ruleId)?.kind, "hard");
  }
  for (const ruleId of SOFT_RULE_IDS) {
    assert.equal(byId.get(ruleId)?.kind, "soft");
  }
});

test("rejects disabling built-in hard constraints", () => {
  const defaults = loadDefaultConstitution();

  assert.throws(
    () => mergeConstitution(defaults, {
      constitution: {
        rules: {
          "security.no_new_risk": { enabled: false }
        }
      }
    }),
    ConstitutionConfigError
  );
});

test("rejects downgrading hard rule verdict behavior", () => {
  const defaults = loadDefaultConstitution();

  assert.throws(
    () => mergeConstitution(defaults, {
      constitution: {
        rules: {
          "security.no_new_risk": {
            severityBehavior: { onViolation: "REQUEST_CHANGES" }
          }
        }
      }
    }),
    ConstitutionConfigError
  );
});

test("allows soft rule severity, tags, and description overrides", () => {
  const defaults = loadDefaultConstitution();
  const rules = mergeConstitution(defaults, {
    constitution: {
      rules: {
        "performance.reasonable_cost": {
          description: "Project-specific performance cost policy.",
          tags: ["performance", "cost", "scalability"],
          severityBehavior: { defaultSeverity: "MINOR" }
        }
      }
    }
  });

  const rule = rules.find((candidate) => candidate.id === "performance.reasonable_cost");
  assert.equal(rule.description, "Project-specific performance cost policy.");
  assert.deepEqual(rule.tags, ["performance", "cost", "scalability"]);
  assert.equal(rule.severityBehavior.defaultSeverity, "MINOR");
});

test("allows valid project-specific additional rules in deterministic order", () => {
  const defaults = loadDefaultConstitution();
  const rules = mergeConstitution(defaults, {
    constitution: {
      additionalRules: {
        "project.z_rule": {
          kind: "soft",
          category: "project",
          tags: ["project"],
          description: "Z rule.",
          severityBehavior: {
            defaultSeverity: "MINOR",
            maxSeverity: "MAJOR",
            onViolation: "COMMENT",
            blocksMerge: false
          },
          enabled: true
        },
        "project.a_rule": {
          kind: "hard",
          category: "project",
          tags: ["project"],
          description: "A rule.",
          severityBehavior: {
            defaultSeverity: "MAJOR",
            maxSeverity: "BLOCKER",
            onViolation: "REQUEST_CHANGES",
            blocksMerge: true
          },
          enabled: true
        }
      }
    }
  });

  assert.deepEqual(rules.slice(-2).map((rule) => rule.id), ["project.a_rule", "project.z_rule"]);
});

test("rejects duplicate or shadowing additional rule IDs", () => {
  const defaults = loadDefaultConstitution();

  assert.throws(
    () => mergeConstitution(defaults, {
      constitution: {
        additionalRules: {
          "security.no_new_risk": {
            kind: "hard",
            category: "security",
            tags: ["security"],
            description: "Duplicate built-in.",
            severityBehavior: {
              defaultSeverity: "BLOCKER",
              maxSeverity: "BLOCKER",
              onViolation: "BLOCK",
              blocksMerge: true
            },
            enabled: true
          }
        }
      }
    }),
    ConstitutionConfigError
  );
});

test("rejects unknown fields in .revix.yml shape", () => {
  const defaults = loadDefaultConstitution();

  assert.throws(
    () => mergeConstitution(defaults, {
      constitution: {
        rules: {
          "performance.reasonable_cost": {
            unexpected: true
          }
        }
      }
    }),
    ConstitutionConfigError
  );
});

test("escalates verdict correctly for hard violations", () => {
  const rules = loadDefaultConstitution();
  const result = evaluateConstitution(rules, [
    violation({
      ruleId: "security.no_new_risk",
      kind: "hard",
      severity: "BLOCKER"
    })
  ]);

  assert.equal(result.verdict, "BLOCK");
  assert.equal(result.passed, false);
  assert.equal(result.hardViolations.length, 1);
});

test("keeps soft-only violations at COMMENT unless configured stricter", () => {
  const defaults = loadDefaultConstitution();
  const commentResult = evaluateConstitution(defaults, [
    violation({
      ruleId: "readability.easy_to_understand",
      kind: "soft",
      severity: "MINOR"
    })
  ]);

  assert.equal(commentResult.verdict, "COMMENT");
  assert.equal(commentResult.passed, true);

  const stricterRules = mergeConstitution(defaults, {
    constitution: {
      rules: {
        "testability.verifiable_behavior": {
          severityBehavior: {
            onViolation: "REQUEST_CHANGES",
            blocksMerge: true
          }
        }
      }
    }
  });
  const stricterResult = evaluateConstitution(stricterRules, [
    violation({
      ruleId: "testability.verifiable_behavior",
      kind: "soft",
      severity: "MAJOR"
    })
  ]);

  assert.equal(stricterResult.verdict, "REQUEST_CHANGES");
  assert.equal(stricterResult.passed, false);
});

test("NIT-level soft violations never block merge", () => {
  const defaults = loadDefaultConstitution();
  const rules = mergeConstitution(defaults, {
    constitution: {
      rules: {
        "simplicity.minimal_necessary_change": {
          severityBehavior: {
            onViolation: "REQUEST_CHANGES",
            blocksMerge: true
          }
        }
      }
    }
  });

  const result = evaluateConstitution(rules, [
    violation({
      ruleId: "simplicity.minimal_necessary_change",
      kind: "soft",
      severity: "NIT"
    })
  ]);

  assert.equal(result.verdict, "COMMENT");
  assert.equal(result.passed, true);
});

test("reports violations without evidence as warnings and excludes them from verdict calculation", () => {
  const rules = loadDefaultConstitution();
  const result = evaluateConstitution(rules, [
    violation({
      ruleId: "privacy.no_sensitive_data_exposure",
      kind: "hard",
      severity: "BLOCKER",
      evidenceRefs: []
    })
  ]);

  assert.equal(result.verdict, "APPROVE");
  assert.equal(result.hardViolations.length, 0);
  assert.equal(result.warnings.length, 1);
});

test("loads project overrides from .revix.yml", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-constitution-"));
  writeFileSync(
    join(projectRoot, ".revix.yml"),
    `constitution:
  rules:
    performance.reasonable_cost:
      severityBehavior:
        defaultSeverity: MINOR
        onViolation: COMMENT
      tags: [performance, cost]
  additionalRules:
    project.no_silent_ai_prompt_change:
      kind: hard
      category: reliability
      tags: [ai, prompts]
      description: Reviewer behavior changes must include fixture coverage.
      severityBehavior:
        defaultSeverity: MAJOR
        maxSeverity: BLOCKER
        onViolation: REQUEST_CHANGES
        blocksMerge: true
      enabled: true
`,
    "utf8"
  );

  const rules = loadEffectiveConstitution(projectRoot);
  assert.ok(rules.some((rule) => rule.id === "project.no_silent_ai_prompt_change"));
});

function violation(overrides = {}) {
  return {
    ruleId: "security.no_new_risk",
    kind: "hard",
    severity: "MAJOR",
    message: "A concrete constitution violation.",
    evidenceRefs: ["src/example.js:10"],
    sourceFindingIds: ["finding-1"],
    sourceConflictIds: [],
    confidence: "HIGH",
    ...overrides
  };
}
