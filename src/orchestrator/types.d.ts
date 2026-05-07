import type { PrClassification } from "../classification/types.d.ts";
import type { RevixConfig } from "../config/types.d.ts";
import type { ReviewConflict } from "../conflicts/types.d.ts";
import type { QualityRule } from "../constitution/types.d.ts";
import type { FinalDecision } from "../decision/types.d.ts";
import type { PrInput } from "../pr-input/types.d.ts";
import type { ReviewProvider } from "../providers/types.d.ts";
import type { ReviewerRunInput, ReviewerRunResult } from "../reviewer-runner/types.d.ts";
import type { SelectedReviewer } from "../reviewer-selection/types.d.ts";
import type { ReviewerSkill } from "../reviewer-skills/types.d.ts";
import type { SynthesisOption } from "../synthesis/types.d.ts";

export interface RevixReviewResult {
  prInput: PrInput;
  classification: PrClassification;
  selectedReviewers: readonly SelectedReviewer[];
  reviewerRun: { results: readonly ReviewerRunResult[]; findings: readonly object[]; errors: readonly Error[] };
  conflicts: readonly ReviewConflict[];
  synthesisOptions: readonly SynthesisOption[];
  finalDecision: FinalDecision;
  output: {
    format: "markdown" | "json" | "github-comment";
    markdown: string;
    json: object;
  };
}

export class RevixOrchestratorError extends Error {
  cause?: unknown;
}

export function runRevixReview(input: unknown, options?: {
  projectRoot?: string;
  config?: RevixConfig;
  qualityRules?: readonly QualityRule[];
  skills?: readonly ReviewerSkill[];
  outputFormat?: "markdown" | "json" | "github-comment";
  provider?: ReviewProvider;
  fixtureDir?: string;
  continueOnError?: boolean;
  runner?: (input: ReviewerRunInput) => unknown[] | Promise<unknown[]>;
}): Promise<RevixReviewResult>;
