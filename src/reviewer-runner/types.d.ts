import type { StructuredFinding } from "../findings/types.d.ts";
import type { ReviewerSkill } from "../reviewer-skills/types.d.ts";
import type { SelectedReviewer } from "../reviewer-selection/types.d.ts";

export interface ReviewerRunInput {
  prInput: object;
  classification: object;
  reviewer: ReviewerSkill;
  selection: SelectedReviewer;
}

export interface ReviewerRunResult {
  reviewer_id: string;
  findings: readonly StructuredFinding[];
}

export class ReviewerRunError extends Error {
  reviewerId?: string;
  cause?: unknown;
}

export function runSelectedReviewers(input: {
  prInput: object;
  classification: object;
  selectedReviewers: readonly SelectedReviewer[];
  runner: (input: ReviewerRunInput) => unknown[] | Promise<unknown[]>;
  continueOnError?: boolean;
}): Promise<{ results: readonly ReviewerRunResult[]; findings: readonly StructuredFinding[]; errors: readonly ReviewerRunError[] }>;
