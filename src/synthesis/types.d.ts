import type { ReviewConflict } from "../conflicts/types.d.ts";
import type { FindingConfidence, StructuredFinding } from "../findings/types.d.ts";

export type SynthesisStrategy = "request_fix" | "ask_clarification" | "comment_only" | "resolve_conflict";

export interface SynthesisOption {
  option_id: string;
  strategy: SynthesisStrategy;
  summary: string;
  finding_ids: string[];
  conflict_ids: string[];
  recommended_actions: string[];
  tradeoffs: string[];
  confidence: FindingConfidence;
}

export class SynthesisError extends Error {}

export function generateSynthesisOptions(input?: {
  findings?: readonly StructuredFinding[];
  conflicts?: readonly ReviewConflict[];
}): readonly SynthesisOption[];
