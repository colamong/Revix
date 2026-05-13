import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildReviewerPrompt, renderReviewerPrompt } from "../prompt-builder/index.js";

export class ProviderError extends Error {
  constructor(message, { provider = "unknown", cause } = {}) {
    super(redactSensitiveValue(message));
    this.name = "ProviderError";
    this.provider = provider;
    this.cause = cause;
  }
}

export function createProvider(config = {}, { projectRoot = process.cwd(), fixtureDir } = {}) {
  const providerConfig = {
    name: "mock",
    fixture_dir: "",
    model: "",
    temperature: 0,
    timeout_ms: 60000,
    max_retries: 0,
    max_output_tokens: 4096,
    ...config
  };
  if (providerConfig.name === "openai") return createOpenAiProvider(providerConfig);
  if (providerConfig.name === "anthropic") return createAnthropicProvider(providerConfig);
  if (providerConfig.name !== "mock") throw new ProviderError(`unsupported provider: ${providerConfig.name}`, { provider: providerConfig.name });
  return createMockProvider({
    fixtureDir: fixtureDir ?? providerConfig.fixture_dir,
    projectRoot
  });
}

export function createMockProvider({ fixtureDir = "", projectRoot = process.cwd() } = {}) {
  const resolvedFixtureDir = fixtureDir ? resolve(projectRoot, fixtureDir) : "";
  return Object.freeze({
    name: "mock",
    async review(prompt, { reviewer }) {
      const findings = loadMockFindings(resolvedFixtureDir, reviewer.reviewer_id);
      return Object.freeze({
        provider: "mock",
        model: "fixture",
        raw: JSON.stringify(findings),
        json: findings,
        usage: Object.freeze({
          prompt_chars: renderReviewerPrompt(prompt).length,
          completion_chars: JSON.stringify(findings).length
        })
      });
    }
  });
}

export function createProviderReviewerRunner({ provider, prInput, classification, qualityRules, config }) {
  if (!provider || typeof provider.review !== "function") {
    throw new ProviderError("provider.review must be a function");
  }
  return async ({ reviewer, selection }) => {
    const prompt = buildReviewerPrompt({
      prInput,
      classification,
      selectedReviewer: selection,
      qualityRules,
      config
    });
    const response = await provider.review(prompt, { reviewer, selection });
    return parseProviderFindings(response);
  };
}

export function createOpenAiProvider(config, { fetchImpl = globalThis.fetch, apiKey = process.env.OPENAI_API_KEY, sleep = realSleep } = {}) {
  assertProviderReady("openai", config, apiKey, fetchImpl);
  return Object.freeze({
    name: "openai",
    async review(prompt) {
      const body = {
        model: config.model,
        instructions: "You are Revix. Return only JSON matching the requested reviewer finding array.",
        input: renderReviewerPrompt(prompt),
        temperature: config.temperature,
        max_output_tokens: config.max_output_tokens,
        text: {
          format: {
            type: "json_schema",
            name: "revix_reviewer_findings",
            strict: false,
            schema: prompt.output_contract?.schema ?? { type: "array" }
          }
        }
      };
      const json = await fetchJsonWithRetry({
        provider: "openai",
        url: "https://api.openai.com/v1/responses",
        headers: {
          "authorization": `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body,
        config,
        fetchImpl,
        sleep
      });
      const raw = extractOpenAiText(json);
      return Object.freeze({
        provider: "openai",
        model: json.model ?? config.model,
        raw,
        json: parseJsonArray(raw, "openai"),
        usage: json.usage ?? {}
      });
    }
  });
}

export function createAnthropicProvider(config, { fetchImpl = globalThis.fetch, apiKey = process.env.ANTHROPIC_API_KEY, sleep = realSleep } = {}) {
  assertProviderReady("anthropic", config, apiKey, fetchImpl);
  return Object.freeze({
    name: "anthropic",
    async review(prompt) {
      const body = {
        model: config.model,
        max_tokens: config.max_output_tokens,
        temperature: config.temperature,
        system: "You are Revix. Return only JSON matching the requested reviewer finding array.",
        messages: [
          {
            role: "user",
            content: renderReviewerPrompt(prompt)
          }
        ]
      };
      const json = await fetchJsonWithRetry({
        provider: "anthropic",
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body,
        config,
        fetchImpl,
        sleep
      });
      const raw = extractAnthropicText(json);
      return Object.freeze({
        provider: "anthropic",
        model: json.model ?? config.model,
        raw,
        json: parseJsonArray(raw, "anthropic"),
        usage: json.usage ?? {}
      });
    }
  });
}

export function parseProviderFindings(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.json)) {
    return response.json;
  }
  if (typeof response?.raw === "string") {
    try {
      const parsed = JSON.parse(response.raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      throw new ProviderError("provider returned invalid JSON", { provider: response.provider, cause: error });
    }
  }
  throw new ProviderError("provider response must contain a findings array", { provider: response?.provider });
}

export function redactSensitiveValue(value) {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-[REDACTED]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"'\s]+/gi, "$1[REDACTED]");
}

async function fetchJsonWithRetry({ provider, url, headers, body, config, fetchImpl, sleep = realSleep }) {
  let lastError;
  for (let attempt = 0; attempt <= config.max_retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new ProviderError(`${provider} request failed with ${response.status}: ${redactSensitiveValue(text)}`, { provider });
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt >= config.max_retries) break;
      await sleep(computeBackoffMs(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError(`${provider} request failed: ${redactSensitiveValue(lastError?.message ?? lastError)}`, {
    provider,
    cause: lastError
  });
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8000;

export function computeBackoffMs(attempt, { random = Math.random } = {}) {
  const exp = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_CAP_MS);
  const jitter = random() * Math.min(BACKOFF_BASE_MS, BACKOFF_CAP_MS);
  return exp + jitter;
}

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertProviderReady(provider, config, apiKey, fetchImpl) {
  if (!fetchImpl) throw new ProviderError(`${provider} provider requires global fetch`, { provider });
  if (!config.model) throw new ProviderError(`${provider} provider requires provider.model`, { provider });
  if (!apiKey) {
    const envName = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    throw new ProviderError(`${provider} provider requires ${envName}`, { provider });
  }
}

function extractOpenAiText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const chunks = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  if (chunks.length > 0) return chunks.join("");
  throw new ProviderError("openai response did not include output text", { provider: "openai" });
}

function extractAnthropicText(response) {
  const chunks = (response.content ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text);
  if (chunks.length > 0) return chunks.join("");
  throw new ProviderError("anthropic response did not include text content", { provider: "anthropic" });
}

function parseJsonArray(raw, provider) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (error) {
    throw new ProviderError(`${provider} provider returned invalid JSON`, { provider, cause: error });
  }
  throw new ProviderError(`${provider} provider response must be a JSON array`, { provider });
}

function loadMockFindings(fixtureDir, reviewerId) {
  if (!fixtureDir) {
    return [];
  }
  const reviewerPath = join(fixtureDir, `${reviewerId}.json`);
  if (existsSync(reviewerPath)) {
    const parsed = JSON.parse(readFileSync(reviewerPath, "utf8"));
    return Array.isArray(parsed) ? parsed : parsed[reviewerId] ?? [];
  }
  const aggregatePath = join(fixtureDir, "findings.json");
  if (existsSync(aggregatePath)) {
    const parsed = JSON.parse(readFileSync(aggregatePath, "utf8"));
    if (Array.isArray(parsed)) {
      return parsed.filter((finding) => finding.reviewer_id === reviewerId);
    }
    return parsed[reviewerId] ?? [];
  }
  return [];
}
