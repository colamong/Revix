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
    ...config
  };
  if (providerConfig.name !== "mock") {
    throw new ProviderError(`provider ${providerConfig.name} is configured but real provider calls are deferred to v0.2`, {
      provider: providerConfig.name
    });
  }
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
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"'\s]+/gi, "$1[REDACTED]");
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
