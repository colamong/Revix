import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProviderError,
  computeBackoffMs,
  createAnthropicProvider,
  createMockProvider,
  createOpenAiProvider,
  parseProviderFindings,
  redactSensitiveValue
} from "../src/providers/index.js";

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

test("openai provider posts reviewer prompt and parses response array", async () => {
  const calls = [];
  const provider = createOpenAiProvider(providerConfig("openai"), {
    apiKey: "sk-testSECRET1234",
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({
        model: "gpt-test",
        output_text: JSON.stringify([finding("security")]),
        usage: { input_tokens: 10, output_tokens: 20 }
      });
    }
  });

  const response = await provider.review(prompt(), { reviewer: { reviewer_id: "security" } });

  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(JSON.parse(calls[0].request.body).model, "gpt-test");
  assert.equal(response.provider, "openai");
  assert.equal(response.json[0].finding_id, "finding-security");
});

test("anthropic provider posts reviewer prompt and parses response array", async () => {
  const calls = [];
  const provider = createAnthropicProvider(providerConfig("anthropic"), {
    apiKey: "sk-ant-testSECRET1234",
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({
        model: "claude-test",
        content: [{ type: "text", text: JSON.stringify([finding("security")]) }],
        usage: { input_tokens: 10, output_tokens: 20 }
      });
    }
  });

  const response = await provider.review(prompt(), { reviewer: { reviewer_id: "security" } });

  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(JSON.parse(calls[0].request.body).model, "gpt-test");
  assert.equal(response.provider, "anthropic");
  assert.equal(response.json[0].finding_id, "finding-security");
});

test("real providers require API keys and redact error payloads", async () => {
  assert.throws(() => createOpenAiProvider(providerConfig("openai"), { apiKey: "" }), ProviderError);
  const provider = createOpenAiProvider(providerConfig("openai"), {
    apiKey: "sk-testSECRET1234",
    fetchImpl: async () => jsonResponse({ error: "api_key=abc123" }, { ok: false, status: 401 })
  });

  await assert.rejects(
    () => provider.review(prompt(), { reviewer: { reviewer_id: "security" } }),
    (error) => error instanceof ProviderError && error.message.includes("api_key=[REDACTED]")
  );
});

test("provider retries transient fetch failures", async () => {
  let attempts = 0;
  const provider = createOpenAiProvider({ ...providerConfig("openai"), max_retries: 1 }, {
    apiKey: "sk-testSECRET1234",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("network reset");
      return jsonResponse({ output_text: "[]" });
    },
    sleep: async () => {}
  });

  const response = await provider.review(prompt(), { reviewer: { reviewer_id: "security" } });

  assert.equal(attempts, 2);
  assert.deepEqual(response.json, []);
});

test("provider applies exponential backoff with jitter between retries", async () => {
  let attempts = 0;
  const sleeps = [];
  const provider = createOpenAiProvider({ ...providerConfig("openai"), max_retries: 2 }, {
    apiKey: "sk-testSECRET1234",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return jsonResponse({ output_text: "[]" });
    },
    sleep: async (ms) => { sleeps.push(ms); }
  });

  await provider.review(prompt(), { reviewer: { reviewer_id: "security" } });

  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 500 && sleeps[0] < 1500, `first backoff (${sleeps[0]}) should be 500ms base + jitter`);
  assert.ok(sleeps[1] >= 1000 && sleeps[1] < 2000, `second backoff (${sleeps[1]}) should be 1000ms base + jitter`);
  assert.ok(sleeps[1] > sleeps[0], "backoff should grow between attempts");
});

test("computeBackoffMs grows exponentially and is capped", () => {
  const noJitter = () => 0;
  assert.equal(computeBackoffMs(0, { random: noJitter }), 500);
  assert.equal(computeBackoffMs(1, { random: noJitter }), 1000);
  assert.equal(computeBackoffMs(2, { random: noJitter }), 2000);
  assert.equal(computeBackoffMs(10, { random: noJitter }), 8000);
});

test("provider does not sleep after final failed attempt", async () => {
  let attempts = 0;
  const sleeps = [];
  const provider = createOpenAiProvider({ ...providerConfig("openai"), max_retries: 1 }, {
    apiKey: "sk-testSECRET1234",
    fetchImpl: async () => {
      attempts += 1;
      throw new Error("always fails");
    },
    sleep: async (ms) => { sleeps.push(ms); }
  });

  await assert.rejects(() => provider.review(prompt(), { reviewer: { reviewer_id: "security" } }), ProviderError);
  assert.equal(attempts, 2);
  assert.equal(sleeps.length, 1, "exactly one backoff: between attempt 0 and attempt 1, none after final");
});

function providerConfig(name) {
  return {
    name,
    model: "gpt-test",
    temperature: 0,
    timeout_ms: 5000,
    max_retries: 0,
    max_output_tokens: 2048
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function prompt() {
  return {
    output_contract: { schema: { type: "array", items: { type: "object" } } },
    reviewer: { reviewer_id: "security" },
    review_context: { pr: { title: "Test" } }
  };
}

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
