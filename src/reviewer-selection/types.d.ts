import type { ReviewerSkill } from "../reviewer-skills/types.d.ts";
import type { FindingValidationContext } from "../findings/types.d.ts";

export interface SelectedReviewer {
  reviewer_id: string;
  reason: string;
  matched_signals: object[];
  skill: ReviewerSkill;
  scope_context: FindingValidationContext;
}

export class ReviewerSelectionError extends Error {}
export function selectReviewers(input: {
  prInput: object;
  classification: object;
  config: object;
  skills: readonly ReviewerSkill[];
  qualityRules: readonly object[];
}): readonly SelectedReviewer[];
