import type { ReviewEvalCase } from "./types.d.ts";

export function convertSwePrBenchDataset(input: {
  rawDir: string;
  outDir: string;
  limit?: number;
  evalSplit?: string;
}): Promise<{
  count: number;
  casesPath: string;
  summaryPath: string;
  summary: object;
}>;

export function convertSwePrBenchRecord(record: object, annotation?: object): ReviewEvalCase;
export function loadSwePrBenchRecords(rawDir: string): Promise<object[]>;
