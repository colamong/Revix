import type { ReviewConflict } from "../conflicts/types.d.ts";
import type { ConstitutionEvaluation, ConstitutionWarning, QualityRule, Verdict } from "../constitution/types.d.ts";
import type { StructuredFinding } from "../findings/types.d.ts";
import type { SynthesisOption } from "../synthesis/types.d.ts";

export interface FinalDecision {
  verdict: Verdict;
  passed: boolean;
  selected_option_ids: string[];
  blocking_finding_ids: string[];
  non_blocking_finding_ids: string[];
  conflict_ids: string[];
  constitution_evaluation: ConstitutionEvaluation;
  warnings: ConstitutionWarning[];
}

export class DecisionError extends Error {}

export function evaluateFinalDecision(input: {
  qualityRules: readonly QualityRule[];
  findings?: readonly StructuredFinding[];
  conflicts?: readonly ReviewConflict[];
  synthesisOptions?: readonly SynthesisOption[];
}): FinalDecision;
