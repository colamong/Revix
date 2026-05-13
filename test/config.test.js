import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RevixConfigError,
  DEFAULT_CONFIG,
  forcedReviewersForLabels,
  getSourceConfig,
  loadRevixConfig,
  mergeRevixConfig,
  shouldSkipReview
} from "../src/config/index.js";

test("loads default config", () => {
  const config = loadRevixConfig(mkdtempSync(join(tmpdir(), "revix-config-empty-")));
  assert.equal(config.output.format, "markdown");
  assert.equal(config.verdict.fail_on_request_changes, true);
  assert.ok(config.paths.contracts.includes("api/**"));
});

test("merges .revix.yml config fields", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-config-"));
  writeFileSync(join(projectRoot, ".revix.yml"), `reviewers:\n  enabled: [security, contract]\npaths:\n  ignored: [dist/**]\nlabels:\n  skip: [no-review]\n  force_reviewers:\n    force-security: [security]\noutput:\n  format: json\nprovider:\n  name: mock\n  fixture_dir: test/fixtures/mock-provider\n  max_output_tokens: 2048\nverdict:\n  fail_on_request_changes: false\n`, "utf8");

  const config = loadRevixConfig(projectRoot);
  assert.deepEqual(config.reviewers.enabled, ["security", "contract"]);
  assert.deepEqual(config.paths.ignored, ["dist/**"]);
  assert.equal(config.output.format, "json");
  assert.equal(config.provider.name, "mock");
  assert.equal(config.provider.fixture_dir, "test/fixtures/mock-provider");
  assert.equal(config.provider.max_output_tokens, 2048);
  assert.equal(config.verdict.fail_on_request_changes, false);
  assert.deepEqual(forcedReviewersForLabels(config, ["force-security"]), ["security"]);
});

test("supports legacy reviewer_skills and constitution aliases", () => {
  const config = mergeRevixConfig(DEFAULT_CONFIG, {
    reviewer_skills: { enabled: ["security"], disabled: ["readability"] },
    constitution: { rules: {} }
  });
  assert.deepEqual(config.reviewers.enabled, ["security"]);
  assert.deepEqual(config.reviewers.disabled, ["readability"]);
  assert.deepEqual(config.quality.overrides, { rules: {} });
});

test("rejects unknown fields and invalid output format", () => {
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { nope: true }), RevixConfigError);
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { output: { format: "xml" } }), RevixConfigError);
});

test("validates path arrays, labels, and reviewer ids", () => {
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { paths: { ignored: "dist/**" } }), RevixConfigError);
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { reviewers: { enabled: ["Security Reviewer"] } }), RevixConfigError);
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { provider: { name: "openai", model: "" } }), RevixConfigError);
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { provider: { max_output_tokens: 0 } }), RevixConfigError);
  assert.equal(shouldSkipReview(mergeRevixConfig(DEFAULT_CONFIG, { labels: { skip: ["skip"] } }), ["skip"]), true);
});

test("exposes per-source stage configuration with defaults", () => {
  const config = loadRevixConfig(mkdtempSync(join(tmpdir(), "revix-config-stage-")));
  assert.deepEqual(getSourceConfig(config, "working-tree"), { budget: 3, severity_floor: "MAJOR" });
  assert.deepEqual(getSourceConfig(config, "staged"), { budget: 3, severity_floor: "MAJOR" });
  assert.equal(getSourceConfig(config, "pr").labels.skip.length, 1);
});

test("syncs top-level labels into sources.pr.labels and vice versa", () => {
  const top = mergeRevixConfig(DEFAULT_CONFIG, { labels: { skip: ["no-review"], force_reviewers: { boom: ["security"] } } });
  assert.deepEqual(top.sources.pr.labels.skip, ["no-review"]);
  assert.deepEqual(top.sources.pr.labels.force_reviewers, { boom: ["security"] });

  const nested = mergeRevixConfig(DEFAULT_CONFIG, { sources: { pr: { labels: { skip: ["nested"], force_reviewers: {} } } } });
  assert.deepEqual(nested.labels.skip, ["nested"]);
});

test("rejects invalid stage budget and severity floor", () => {
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { sources: { working_tree: { budget: -1, severity_floor: "MAJOR" } } }), RevixConfigError);
  assert.throws(() => mergeRevixConfig(DEFAULT_CONFIG, { sources: { staged: { budget: 3, severity_floor: "MEDIUM" } } }), RevixConfigError);
});
