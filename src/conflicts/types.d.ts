export type ConflictType = "severity_conflict" | "claim_contradiction" | "fix_conflict" | "scope_conflict" | "confidence_conflict";

export interface ReviewConflict {
  conflict_id: string;
  type: ConflictType;
  finding_ids: string[];
  summary: string;
  evidence_refs: string[];
  resolution_required: boolean;
}

export class ConflictDetectionError extends Error {}
export function detectConflicts(findings: unknown[]): readonly ReviewConflict[];
