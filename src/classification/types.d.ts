export type PrType = "feature" | "bugfix" | "refactor" | "infra" | "security" | "contract" | "test" | "docs" | "performance" | "reliability" | "mixed";
export type LegacyPrType = "test_only" | "docs_only" | "config_change" | "security_sensitive" | "contract_change" | "performance_sensitive" | PrType;
export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface PrSignal {
  type: PrType;
  legacy_type?: LegacyPrType;
  source: "label" | "path" | "extension" | "title" | "body";
  value: string;
}

export interface PrClassification {
  primary_type: PrType;
  secondary_types: PrType[];
  legacy_primary_type: LegacyPrType;
  legacy_types: LegacyPrType[];
  signals: PrSignal[];
  confidence: ClassificationConfidence;
  rationale: string;
}

export class PrClassificationError extends Error {}
export function classifyPr(prInput: object, config: object): PrClassification;
export function matchesAny(path: string, patterns?: string[]): boolean;
