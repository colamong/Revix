import type { PrClassification } from "../classification/types.d.ts";
import type { RevixConfig } from "../config/types.d.ts";
import type { QualityRule } from "../constitution/types.d.ts";
import type { PrInput } from "../pr-input/types.d.ts";
import type { ReviewerRunInput } from "../reviewer-runner/types.d.ts";

export interface ProviderResponse {
  provider: string;
  model: string;
  raw: string;
  json: unknown[];
  usage?: object;
}

export interface ReviewProvider {
  name: string;
  review(prompt: object, context: object): Promise<ProviderResponse> | ProviderResponse;
}

export class ProviderError extends Error {
  provider: string;
  cause?: unknown;
}

export function createProvider(config?: object, options?: { projectRoot?: string; fixtureDir?: string }): ReviewProvider;
export function createMockProvider(options?: { fixtureDir?: string; projectRoot?: string }): ReviewProvider;
export function createOpenAiProvider(config: object, options?: { fetchImpl?: typeof fetch; apiKey?: string }): ReviewProvider;
export function createAnthropicProvider(config: object, options?: { fetchImpl?: typeof fetch; apiKey?: string }): ReviewProvider;
export function createProviderReviewerRunner(input: {
  provider: ReviewProvider;
  prInput: PrInput;
  classification: PrClassification;
  qualityRules: readonly QualityRule[];
  config: RevixConfig;
}): (input: ReviewerRunInput) => Promise<unknown[]>;
export function parseProviderFindings(response: ProviderResponse | unknown[]): unknown[];
export function redactSensitiveValue(value: unknown): string;
