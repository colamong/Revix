import type { QualityRule } from "../constitution/types.d.ts";
import type { FindingValidationContext } from "../findings/types.d.ts";

export interface ReviewerScope {
  tags: string[];
  quality_rules: string[];
  file_patterns: string[];
}

export interface ForbiddenReviewerScope {
  tags: string[];
  note: string;
}

export interface ReviewerSeverityPolicy {
  max_severity_by_tag: Record<string, "BLOCKER" | "MAJOR" | "MINOR" | "QUESTION" | "NIT">;
  blocker_requires: Record<string, boolean | string>;
  style_only_max_severity: "BLOCKER" | "MAJOR" | "MINOR" | "QUESTION" | "NIT";
}

export interface ReviewerSkillExample {
  name: string;
  finding: {
    severity: "BLOCKER" | "MAJOR" | "MINOR" | "QUESTION" | "NIT";
    claim: string;
    related_quality_rules: string[];
    tags: string[];
  };
}

export interface ReviewerSkill {
  schema_version: 1;
  skill_version: string;
  reviewer_id: string;
  display_name: string;
  responsibility: string;
  background: string;
  bias: string[];
  flexibility_score: number;
  allowed_scope: ReviewerScope;
  forbidden_scope: ForbiddenReviewerScope;
  severity_policy: ReviewerSeverityPolicy;
  quality_rules_focus: string[];
  prompt_instructions: string[];
  examples: ReviewerSkillExample[];
}

export class ReviewerSkillValidationError extends Error {}

export const BUILTIN_REVIEWER_IDS: readonly string[];

export function loadBuiltInReviewerSkills(qualityRules?: readonly QualityRule[]): readonly ReviewerSkill[];
export function loadProjectReviewerSkills(projectRoot: string, qualityRules?: readonly QualityRule[]): readonly ReviewerSkill[];
export function loadEffectiveReviewerSkills(projectRoot?: string, qualityRules?: readonly QualityRule[]): readonly ReviewerSkill[];
export function validateReviewerSkill(skill: unknown, qualityRules?: readonly QualityRule[]): ReviewerSkill;
export function createFindingValidationContext(skill: ReviewerSkill, qualityRules?: readonly QualityRule[]): FindingValidationContext;
