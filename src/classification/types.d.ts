export type PrType = "feature" | "bugfix" | "refactor" | "test_only" | "docs_only" | "config_change" | "security_sensitive" | "contract_change" | "performance_sensitive" | "mixed";
export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface PrSignal {
  type: PrType;
  source: "label" | "path" | "extension" | "title";
  value: string;
}

export interface PrClassification {
  primary_type: PrType;
  secondary_types: PrType[];
  signals: PrSignal[];
  confidence: ClassificationConfidence;
  rationale: string;
}

export class PrClassificationError extends Error {}
export function classifyPr(prInput: object, config: object): PrClassification;
export function matchesAny(path: string, patterns?: string[]): boolean;
