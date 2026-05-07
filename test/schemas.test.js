import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SCHEMAS = [
  "schemas/finding.schema.json",
  "schemas/conflict.schema.json",
  "schemas/final-output.schema.json",
  "schemas/pr-input.schema.json",
  "schemas/review-quality-eval-case.schema.json",
  "schemas/review-quality-evaluation.schema.json",
  "schemas/reviewer-skill.schema.json",
  "schemas/revix-config.schema.json",
  "schemas/synthesis-option.schema.json"
];

test("published JSON schemas parse", () => {
  for (const schemaPath of SCHEMAS) {
    const parsed = JSON.parse(readFileSync(schemaPath, "utf8"));
    assert.equal(typeof parsed.$id, "string", `${schemaPath} must define $id`);
    assert.equal(parsed.type, "object", `${schemaPath} must describe an object`);
  }
});
