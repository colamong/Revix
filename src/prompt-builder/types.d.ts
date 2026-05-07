import type { PrClassification } from "../classification/types.d.ts";
import type { RevixConfig } from "../config/types.d.ts";
import type { QualityRule } from "../constitution/types.d.ts";
import type { PrInput } from "../pr-input/types.d.ts";
import type { SelectedReviewer } from "../reviewer-selection/types.d.ts";

export interface ReviewerPrompt {
  schema_version: 1;
  task: "revix_reviewer_findings";
  output_contract: object;
  reviewer: object;
  review_context: object;
  quality_rules: object[];
  config_context: object;
  guardrails: string[];
}

export class PromptBuilderError extends Error {}

export function buildReviewerPrompt(input: {
  prInput: PrInput;
  classification?: PrClassification;
  selectedReviewer: SelectedReviewer;
  qualityRules?: readonly QualityRule[];
  config?: RevixConfig;
}): ReviewerPrompt;

export function renderReviewerPrompt(promptObject: ReviewerPrompt | object): string;
