import type { QualityRule } from "../constitution/types.d.ts";

export type FindingSeverity = "BLOCKER" | "MAJOR" | "MINOR" | "QUESTION" | "NIT";
export type FindingConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface FindingEvidence {
  file_path: string;
  line_start: number;
  line_end: number;
  snippet: string;
}

export interface StructuredFinding {
  finding_id: string;
  reviewer_id: string;
  severity: FindingSeverity;
  claim: string;
  evidence: FindingEvidence;
  evidence_refs?: FindingEvidence[];
  impact: string;
  suggested_fix: string;
  verification_test: string;
  confidence: FindingConfidence;
  related_quality_rules: string[];
  tags: string[];
}

export interface FindingValidationContext {
  reviewer_id: string;
  allowed_tags: string[];
  allowed_quality_rules: string[];
  quality_rules: readonly QualityRule[];
}

export class FindingValidationError extends Error {}
export class FindingOutOfScopeError extends FindingValidationError {
  finding_id: string | null;
  reason: string;
}

export interface DroppedFinding {
  finding_id: string | null;
  reviewer_id: string;
  reason: string;
}

export interface ValidatedFindings {
  findings: readonly StructuredFinding[];
  dropped: readonly DroppedFinding[];
}

export function validateFinding(finding: unknown, context: FindingValidationContext): StructuredFinding;
export function validateFindings(findings: unknown, context: FindingValidationContext): ValidatedFindings;
export function findingCanBlockMerge(finding: StructuredFinding): boolean;
