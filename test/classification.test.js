import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeRevixConfig } from "../src/config/index.js";
import { classifyPr } from "../src/classification/index.js";
import { validatePrInput } from "../src/pr-input/index.js";
import { validPrInput } from "./pr-input.test.js";

test("classifies docs-only and test-only changes", () => {
  const docs = classifyPr(prWithFiles(["docs/guide.md"]), DEFAULT_CONFIG);
  const tests = classifyPr(prWithFiles(["test/session.test.js"]), DEFAULT_CONFIG);
  assert.equal(docs.primary_type, "docs");
  assert.equal(docs.legacy_primary_type, "docs_only");
  assert.equal(tests.primary_type, "test");
  assert.equal(tests.legacy_primary_type, "test_only");
});

test("uses labels and title keywords", () => {
  const pr = validatePrInput(validPrInput({ metadata: { ...validPrInput().metadata, title: "Fix crash", labels: ["bug"] } }));
  const classification = classifyPr(pr, DEFAULT_CONFIG);
  assert.ok(classification.secondary_types.includes("bugfix") || classification.primary_type === "bugfix" || classification.primary_type === "mixed");
});

test("detects security, contract, performance-sensitive, and mixed changes from paths", () => {
  const config = mergeRevixConfig(DEFAULT_CONFIG, {
    paths: {
      security_sensitive: ["src/auth/**"],
      contracts: ["api/**"],
      performance_sensitive: ["src/query/**"]
    }
  });
  assert.ok(typesFor(["src/auth/session.js"], config).includes("security"));
  assert.ok(aliasesFor(["src/auth/session.js"], config).includes("security_sensitive"));
  assert.ok(typesFor(["api/openapi.yml"], config).includes("contract"));
  assert.ok(aliasesFor(["api/openapi.yml"], config).includes("contract_change"));
  assert.ok(typesFor(["src/query/users.js"], config).includes("performance"));
  assert.ok(aliasesFor(["src/query/users.js"], config).includes("performance_sensitive"));
  assert.equal(classifyPr(prWithFiles(["src/auth/session.js", "api/openapi.yml"]), config).primary_type, "mixed");
});

test("detects canonical infra and reliability signals", () => {
  assert.equal(classifyPr(prWithFiles([".github/workflows/ci.yml"]), DEFAULT_CONFIG).primary_type, "infra");
  assert.equal(classifyPr(prWithFiles(["src/retry/job.js"]), DEFAULT_CONFIG).primary_type, "reliability");
});

function typesFor(paths, config) {
  const result = classifyPr(prWithFiles(paths), config);
  return [result.primary_type, ...result.secondary_types, ...result.signals.map((signal) => signal.type)];
}

function aliasesFor(paths, config) {
  const result = classifyPr(prWithFiles(paths), config);
  return [result.legacy_primary_type, ...result.legacy_types, ...result.signals.map((signal) => signal.legacy_type).filter(Boolean)];
}

function prWithFiles(paths) {
  return validatePrInput(validPrInput({
    metadata: { ...validPrInput().metadata, title: "Update changed files", labels: [] },
    changed_files: paths.map((path) => ({ path, status: "modified", additions: 1, deletions: 0 })),
    raw_diff: ""
  }));
}
