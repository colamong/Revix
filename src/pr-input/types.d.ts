export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unchanged";

export interface PrMetadata {
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
  base_ref: string;
  head_ref: string;
}

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  patch?: string;
  previous_path?: string;
  binary: boolean;
}

export interface ParsedDiffLine {
  type: "add" | "delete" | "context" | "meta";
  old_line: number | null;
  new_line: number | null;
  content: string;
}

export interface ParsedDiffHunk {
  header: string;
  old_start: number;
  new_start: number;
  context: string;
  lines: ParsedDiffLine[];
}

export interface ParsedDiffFile {
  file_path: string;
  hunks: ParsedDiffHunk[];
}

export interface PrInput {
  metadata: PrMetadata;
  changed_files: ChangedFile[];
  raw_diff: string;
  diff: { raw: string; files: ParsedDiffFile[] };
}

export class PrInputValidationError extends Error {}
export function validatePrInput(input: unknown): PrInput;
export function parseUnifiedDiff(rawDiff: string): PrInput["diff"];
