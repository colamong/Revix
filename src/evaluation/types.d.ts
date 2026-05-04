import type { Verdict } from "../constitution/types.d.ts";
import type { FindingSeverity, StructuredFinding } from "../findings/types.d.ts";

export interface ExpectedReviewIssue {
  issue_id: string;
  category: string;
  severity: FindingSeverity;
  claim: string;
  file_path: string;
  line_start: number;
  line_end: number;
  allowed_claims?: string[];
  root_cause?: string;
  weight?: number;
  matchability?: "high" | "low";
}

export interface ReviewEvalCase {
  eval_id: string;
  pr_input?: object;
  expected_issues: ExpectedReviewIssue[];
  expected_verdict?: Verdict;
  human_review_comments?: object[];
}

export interface ReviewQualitySubScores {
  detection: number;
  precision: number;
  evidence: number;
  severity: number;
  actionability: number;
  decision: number;
  noise: number;
}

export interface ReviewQualityEvaluation {
  eval_id: string;
  rqs: number;
  sub_scores: ReviewQualitySubScores;
  precision_recall_f1: { precision: number; recall: number; f1: number };
  category_recall: Record<string, number>;
  severity_confusion: object;
  matches: object[];
  missed_issues: object[];
  false_positives: object[];
  expected_verdict?: Verdict;
  actual_verdict: string;
}

export class ReviewQualityEvaluationError extends Error {}

export const RQS_WEIGHTS: Readonly<ReviewQualitySubScores>;
export function evaluateReviewQuality(input: { evalCase: ReviewEvalCase; reviewResult: object }): Promise<ReviewQualityEvaluation>;
export function evaluateReviewQualitySuite(results: Array<ReviewQualityEvaluation | { evaluation: ReviewQualityEvaluation }>): object;
export function renderReviewQualityReport(evaluation: ReviewQualityEvaluation): string;
export function matchExpectedIssues(expectedIssues?: ExpectedReviewIssue[], findings?: StructuredFinding[]): Promise<readonly object[]>;
export function matchScore(issue: ExpectedReviewIssue, finding: StructuredFinding): Promise<object>;
