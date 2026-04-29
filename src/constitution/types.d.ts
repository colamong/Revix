export type ConstraintKind = "hard" | "soft";
export type RuleSeverity = "BLOCKER" | "MAJOR" | "MINOR" | "QUESTION" | "NIT";
export type Verdict = "APPROVE" | "COMMENT" | "REQUEST_CHANGES" | "BLOCK";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface SeverityBehavior {
  defaultSeverity: RuleSeverity;
  maxSeverity: RuleSeverity;
  onViolation: Verdict;
  blocksMerge: boolean;
}

export interface QualityRule {
  id: string;
  kind: ConstraintKind;
  category: string;
  tags: string[];
  description: string;
  severityBehavior: SeverityBehavior;
  enabled: boolean;
}

export interface RuleViolation {
  ruleId: string;
  kind: ConstraintKind;
  severity: RuleSeverity;
  message: string;
  evidenceRefs: string[];
  sourceFindingIds: string[];
  sourceConflictIds: string[];
  confidence: Confidence;
}

export interface ConstitutionWarning {
  ruleId: string;
  message: string;
}

export interface ConstitutionEvaluation {
  verdict: Verdict;
  passed: boolean;
  hardViolations: RuleViolation[];
  softViolations: RuleViolation[];
  warnings: ConstitutionWarning[];
  appliedRuleIds: string[];
}

export class ConstitutionConfigError extends Error {}

export function loadDefaultConstitution(): readonly QualityRule[];
export function loadProjectConfig(projectRoot?: string): object;
export function loadEffectiveConstitution(projectRoot?: string): readonly QualityRule[];
export function mergeConstitution(defaultRules: readonly QualityRule[], projectConfig?: object): readonly QualityRule[];
export function evaluateConstitution(rules: readonly QualityRule[], violations?: RuleViolation[]): ConstitutionEvaluation;
export function parseYamlSubset(source: string): unknown;
