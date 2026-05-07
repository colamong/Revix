import type { ReviewEvalCase, ReviewQualityEvaluation } from "./types.d.ts";

export const COMPARATIVE_REVIEWERS: readonly ["revix", "gstack", "greptile", "coderabbit"];
export const DEFAULT_EVAL_COMMAND: string;

export class ComparativeEvaluationError extends Error {}

export function runComparativeReviewQualityEval(input: {
  cases: ReviewEvalCase[];
  reviewers?: string[] | string;
  limit?: number;
  outDir?: string;
  command?: string;
  modelRunner?: (prompt: string) => Promise<string> | string;
  cacheDir?: string;
  projectRoot?: string;
}): Promise<{ results: object[]; report: object }>;

export function evaluateReviewerOnCase(input: {
  evalCase: ReviewEvalCase;
  reviewer: string;
  modelRunner: (prompt: string) => Promise<string> | string;
  cacheDir?: string;
  projectRoot?: string;
}): Promise<{ reviewer: string; eval_id: string; evaluation: ReviewQualityEvaluation | null; error: object | null }>;

export function buildProfilePrompt(input: { profile: string; evalCase: ReviewEvalCase }): object;
export function invokeModelForJson(input: { prompt: object; modelRunner: (prompt: string) => Promise<string> | string; cacheKey: string; cacheDir?: string; repair?: boolean }): Promise<{ raw: string; parsed: object }>;
export function parseModelJson(raw: string): object;
export function normalizeModelFindings(input: { parsed: object; reviewer: string; evalCase: ReviewEvalCase }): object[];
export function normalizeRevixModelFindings(input: { parsed: object; reviewer: object; selection: object; evalCase: ReviewEvalCase }): object[];
export function createCommandModelRunner(input?: { command?: string; timeoutMs?: number }): (prompt: string) => Promise<string>;
export function buildComparativeReport(results: object[]): object;
export function writeComparativeReport(input: { outDir: string; results: object[]; report: object }): Promise<void>;
export function renderComparativeMarkdown(report: object): string;
