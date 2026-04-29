import type { PrClassification } from "../../classification/types.d.ts";
import type { ReviewConflict } from "../../conflicts/types.d.ts";
import type { FinalDecision } from "../../decision/types.d.ts";
import type { StructuredFinding } from "../../findings/types.d.ts";
import type { PrInput } from "../../pr-input/types.d.ts";
import type { SelectedReviewer } from "../../reviewer-selection/types.d.ts";
import type { SynthesisOption } from "../../synthesis/types.d.ts";

export interface RenderedReviewComment {
  format: "markdown";
  markdown: string;
  json: object;
}

export class GitHubCommentRenderError extends Error {}

export function renderGitHubReviewComment(input: {
  prInput?: PrInput;
  classification?: PrClassification;
  selectedReviewers?: readonly SelectedReviewer[];
  findings?: readonly StructuredFinding[];
  conflicts?: readonly ReviewConflict[];
  synthesisOptions?: readonly SynthesisOption[];
  finalDecision: FinalDecision;
}): RenderedReviewComment;
