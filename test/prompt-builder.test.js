import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeRevixConfig } from "../src/config/index.js";
import { classifyPr } from "../src/classification/index.js";
import { loadDefaultConstitution } from "../src/constitution/index.js";
import { validatePrInput } from "../src/pr-input/index.js";
import { buildReviewerPrompt, renderReviewerPrompt } from "../src/prompt-builder/index.js";
import { loadBuiltInReviewerSkills } from "../src/reviewer-skills/index.js";
import { selectReviewers } from "../src/reviewer-selection/index.js";
import { validPrInput } from "./pr-input.test.js";

test("builds deterministic JSON-only prompt for security reviewer", () => {
  const context = promptContext(["src/auth/session.js"], mergeRevixConfig(DEFAULT_CONFIG, { paths: { security_sensitive: ["src/auth/**"] } }));
  const selectedReviewer = context.selectedReviewers.find((reviewer) => reviewer.reviewer_id === "security");
  const prompt = buildReviewerPrompt({ ...context, selectedReviewer });
  const rendered = renderReviewerPrompt(prompt);

  assert.equal(prompt.output_contract.format, "json_only");
  assert.ok(prompt.reviewer.allowed_scope.tags.includes("security"));
  assert.match(rendered, /Return only machine-parseable JSON/);
  assert.doesNotMatch(rendered, /chain-of-thought/i);
  assert.equal(rendered, renderReviewerPrompt(prompt));
});

test("builds performance reviewer prompt with focused rules", () => {
  const config = mergeRevixConfig(DEFAULT_CONFIG, { paths: { performance_sensitive: ["src/query/**"] } });
  const context = promptContext(["src/query/users.js"], config);
  const selectedReviewer = context.selectedReviewers.find((reviewer) => reviewer.reviewer_id === "performance");
  const prompt = buildReviewerPrompt({ ...context, selectedReviewer });

  assert.equal(prompt.reviewer.reviewer_id, "performance");
  assert.ok(prompt.quality_rules.some((rule) => rule.id === "performance.reasonable_cost"));
  assert.ok(prompt.guardrails.some((line) => line.includes("Stay within allowed_scope")));
});

function promptContext(paths, config) {
  const qualityRules = loadDefaultConstitution();
  const prInput = validatePrInput(validPrInput({
    changed_files: paths.map((path) => ({ path, status: "modified", additions: 1, deletions: 0 })),
    raw_diff: ""
  }));
  const classification = classifyPr(prInput, config);
  const selectedReviewers = selectReviewers({
    prInput,
    classification,
    config,
    skills: loadBuiltInReviewerSkills(qualityRules),
    qualityRules
  });
  return { prInput, classification, selectedReviewers, qualityRules, config };
}
