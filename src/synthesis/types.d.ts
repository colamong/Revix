import type { ReviewConflict } from "../conflicts/types.d.ts";
import type { FindingConfidence, StructuredFinding } from "../findings/types.d.ts";

export type SynthesisStrategy = "request_fix" | "ask_clarification" | "comment_only" | "resolve_conflict" | "prefer_reviewer" | "compromise" | "minimal_safe_change";

export interface SynthesisScoreDimensions {
  security_safety: number;
  contract_safety: number;
  reliability: number;
  correctness: number;
  performance: number;
  maintainability: number;
  testability: number;
  observability: number;
  implementation_cost: number;
}

export interface SynthesisOption {
  option_id: string;
  strategy: SynthesisStrategy;
  summary: string;
  description: string;
  finding_ids: string[];
  conflict_ids: string[];
  recommended_actions: string[];
  required_changes: string[];
  satisfied_quality_rules: string[];
  weakened_quality_rules: string[];
  risk: "low" | "medium" | "high" | "disqualified";
  implementation_cost: number;
  expected_benefit: string;
  reviewers_likely_to_accept: string[];
  reviewers_likely_to_reject: string[];
  score_dimensions: SynthesisScoreDimensions;
  disqualified_reason: string | null;
  tradeoffs: string[];
  confidence: FindingConfidence;
}

export class SynthesisError extends Error {}

export function generateSynthesisOptions(input?: {
  findings?: readonly StructuredFinding[];
  conflicts?: readonly ReviewConflict[];
}): readonly SynthesisOption[];
