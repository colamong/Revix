import type { PrClassification } from "../classification/types.d.ts";
import type { ReviewConflict } from "../conflicts/types.d.ts";
import type { FinalDecision } from "../decision/types.d.ts";
import type { StructuredFinding } from "../findings/types.d.ts";
import type { PrInput } from "../pr-input/types.d.ts";
import type { SelectedReviewer } from "../reviewer-selection/types.d.ts";
import type { SynthesisOption } from "../synthesis/types.d.ts";

export type FinalReviewFormat = "markdown" | "json" | "github-comment";

export interface FinalReviewOutput {
  format: FinalReviewFormat;
  markdown: string;
  json: object;
}

export class FinalComposerError extends Error {}

export function buildRenderObject(input: {
  classification?: PrClassification;
  selectedReviewers?: readonly SelectedReviewer[];
  findings?: readonly StructuredFinding[];
  conflicts?: readonly ReviewConflict[];
  synthesisOptions?: readonly SynthesisOption[];
  finalDecision: FinalDecision;
}): object;

export function composeFinalReview(input: {
  prInput?: PrInput;
  classification?: PrClassification;
  selectedReviewers?: readonly SelectedReviewer[];
  findings?: readonly StructuredFinding[];
  conflicts?: readonly ReviewConflict[];
  synthesisOptions?: readonly SynthesisOption[];
  finalDecision: FinalDecision;
  format?: FinalReviewFormat;
}): FinalReviewOutput;
