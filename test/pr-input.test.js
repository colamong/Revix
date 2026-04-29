import test from "node:test";
import assert from "node:assert/strict";
import { PrInputValidationError, parseUnifiedDiff, validatePrInput } from "../src/pr-input/index.js";

test("validates GitHub-like PR metadata and parses diff hunks", () => {
  const pr = validatePrInput(validPrInput());
  assert.equal(pr.metadata.number, 7);
  assert.equal(pr.diff.files[0].file_path, "src/auth/session.js");
  assert.equal(pr.diff.files[0].hunks[0].lines.find((line) => line.type === "add").new_line, 2);
});

test("supports deleted, renamed, and binary/no-patch changed files", () => {
  const pr = validatePrInput({
    ...validPrInput({ raw_diff: "" }),
    changed_files: [
      { path: "old.js", status: "deleted", additions: 0, deletions: 5 },
      { path: "new.js", previous_path: "older.js", status: "renamed", additions: 1, deletions: 1 },
      { path: "image.png", status: "modified", additions: 0, deletions: 0, binary: true }
    ]
  });
  assert.equal(pr.changed_files.length, 3);
});

test("rejects missing metadata, unsupported status, and empty inputs", () => {
  const input = validPrInput();
  delete input.metadata.title;
  assert.throws(() => validatePrInput(input), PrInputValidationError);
  assert.throws(() => validatePrInput({ ...validPrInput(), changed_files: [{ path: "x", status: "moved", additions: 0, deletions: 0 }] }), PrInputValidationError);
  assert.throws(() => validatePrInput({ metadata: validPrInput().metadata, changed_files: [], raw_diff: "" }), PrInputValidationError);
});

test("rejects malformed diff shape", () => {
  assert.throws(() => parseUnifiedDiff("not a diff"), PrInputValidationError);
  assert.throws(() => parseUnifiedDiff("diff --git a/a.js b/a.js\n@@ malformed @@"), PrInputValidationError);
});

export function validPrInput(overrides = {}) {
  return {
    metadata: {
      repo: "example/repo",
      number: 7,
      title: "Add secure login",
      body: "Adds session handling.",
      author: "alice",
      labels: ["feature"],
      base_ref: "main",
      head_ref: "feature/login"
    },
    changed_files: [
      { path: "src/auth/session.js", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1 @@" }
    ],
    raw_diff: "diff --git a/src/auth/session.js b/src/auth/session.js\n--- a/src/auth/session.js\n+++ b/src/auth/session.js\n@@ -1,2 +1,3 @@\n const a = 1;\n+const token = createToken();\n const b = 2;\n",
    ...overrides
  };
}
