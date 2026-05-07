import type { FindingConfidence, FindingSeverity } from "../findings/types.d.ts";

export type ConflictType = "severity_conflict" | "claim_contradiction" | "fix_conflict" | "scope_conflict" | "confidence_conflict" | "security_vs_performance";
export type CanonicalConflictType = "security_vs_performance" | "contract_vs_implementation" | "reliability_vs_complexity" | "architecture_vs_scope" | "severity_mismatch" | "duplicate_or_overlapping_findings";

export interface CompetingClaim {
  finding_id: string;
  reviewer_id: string;
  claim: string;
  suggested_fix: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
}

export interface ReviewConflict {
  conflict_id: string;
  type: ConflictType;
  conflict_type: CanonicalConflictType | ConflictType;
  involved_reviewers: string[];
  involved_findings: string[];
  finding_ids: string[];
  summary: string;
  competing_claims: CompetingClaim[];
  affected_quality_rules: string[];
  evidence_refs: string[];
  required_resolution: string;
  resolution_required: boolean;
  confidence: FindingConfidence;
}

export class ConflictDetectionError extends Error {}
export function detectConflicts(findings: unknown[]): readonly ReviewConflict[];
