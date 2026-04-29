import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeRevixConfig } from "../src/config/index.js";
import { classifyPr } from "../src/classification/index.js";
import { validatePrInput } from "../src/pr-input/index.js";
import { loadDefaultConstitution } from "../src/constitution/index.js";
import { loadBuiltInReviewerSkills } from "../src/reviewer-skills/index.js";
import { ReviewerSelectionError, selectReviewers } from "../src/reviewer-selection/index.js";
import { validPrInput } from "./pr-input.test.js";

const qualityRules = loadDefaultConstitution();
const skills = loadBuiltInReviewerSkills(qualityRules);

test("selects default reviewers from classification", () => {
  const selected = selectFor(["src/auth/session.js"], mergeRevixConfig(DEFAULT_CONFIG, { paths: { security_sensitive: ["src/auth/**"] } }));
  assert.ok(selected.some((item) => item.reviewer_id === "security"));
  assert.ok(selected.every((item) => item.scope_context.reviewer_id === item.reviewer_id));
});

test("respects enabled and disabled reviewers", () => {
  const selected = selectFor(["src/auth/session.js"], mergeRevixConfig(DEFAULT_CONFIG, {
    reviewers: { enabled: ["security", "test"], disabled: ["test"] },
    paths: { security_sensitive: ["src/auth/**"] }
  }));
  assert.deepEqual(selected.map((item) => item.reviewer_id), ["security"]);
});

test("honors forced reviewers and skip labels", () => {
  const config = mergeRevixConfig(DEFAULT_CONFIG, {
    labels: {
      skip: ["skip-review"],
      force_reviewers: { "force-contract": ["contract"] }
    }
  });
  assert.deepEqual(selectFor(["docs/readme.md"], config, ["skip-review"]).map((item) => item.reviewer_id), []);
  assert.deepEqual(selectFor(["docs/readme.md"], config, ["skip-review", "force-contract"]).map((item) => item.reviewer_id), ["contract"]);
});

test("rejects unknown forced reviewers", () => {
  const config = mergeRevixConfig(DEFAULT_CONFIG, {
    labels: { force_reviewers: { "force-unknown": ["unknown-reviewer"] } }
  });
  assert.throws(() => selectFor(["src/index.js"], config, ["force-unknown"]), ReviewerSelectionError);
});

test("selects contract and documentation reviewers for contract and docs paths", () => {
  assert.ok(selectFor(["api/openapi.yml"], DEFAULT_CONFIG).some((item) => item.reviewer_id === "contract"));
  assert.deepEqual(selectFor(["docs/readme.md"], DEFAULT_CONFIG).map((item) => item.reviewer_id), ["documentation"]);
});

function selectFor(paths, config, labels = []) {
  const prInput = validatePrInput(validPrInput({
    metadata: { ...validPrInput().metadata, labels },
    changed_files: paths.map((path) => ({ path, status: "modified", additions: 1, deletions: 0 })),
    raw_diff: ""
  }));
  return selectReviewers({
    prInput,
    classification: classifyPr(prInput, config),
    config,
    skills,
    qualityRules
  });
}
