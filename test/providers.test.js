import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockProvider, parseProviderFindings, redactSensitiveValue } from "../src/providers/index.js";

test("mock provider reads reviewer-specific fixture files", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "revix-provider-"));
  const fixtureDir = join(projectRoot, "mock");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "security.json"), JSON.stringify([finding("security")]), "utf8");
  const provider = createMockProvider({ projectRoot, fixtureDir: "mock" });
  const response = await provider.review({ task: "test" }, { reviewer: { reviewer_id: "security" } });

  assert.equal(response.provider, "mock");
  assert.deepEqual(response.json.map((item) => item.finding_id), ["finding-security"]);
  assert.equal(parseProviderFindings(response).length, 1);
});

test("provider redaction hides common secret shapes", () => {
  assert.equal(redactSensitiveValue("api_key=abc123 secret sk-testSECRET1234"), "api_key=[REDACTED] secret sk-[REDACTED]");
});

function finding(reviewerId) {
  return {
    finding_id: `finding-${reviewerId}`,
    reviewer_id: reviewerId,
    severity: "MINOR",
    claim: "The changed path needs an additional deterministic fixture check.",
    evidence: {
      file_path: "src/index.js",
      line_start: 1,
      line_end: 1,
      snippet: "export {}"
    },
    impact: "Missing fixture coverage can allow reviewer behavior to drift without a visible regression.",
    suggested_fix: "Add a deterministic fixture that covers this reviewer path.",
    verification_test: "Run the fixture-backed provider test and confirm the finding is loaded.",
    confidence: "HIGH",
    related_quality_rules: ["test.meaningful_coverage"],
    tags: ["test"]
  };
}
