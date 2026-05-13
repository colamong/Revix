import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "./git-utils.js";

export const UNTRACKED_MAX_FILES = 50;
export const UNTRACKED_MAX_FILE_BYTES = 1024 * 1024; // 1 MiB
const BINARY_SAMPLE_BYTES = 8192;

export function listUntrackedFiles(cwd) {
  const output = runGit(["ls-files", "--others", "--exclude-standard"], { cwd, allowEmpty: true });
  return output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

export function buildUntrackedAdditions(cwd, paths) {
  const diffs = [];
  const changed = [];
  const skipped = [];
  const truncated = paths.length > UNTRACKED_MAX_FILES;
  const candidates = truncated ? paths.slice(0, UNTRACKED_MAX_FILES) : paths;

  for (const relativePath of candidates) {
    const result = synthesiseAddedFileDiff(cwd, relativePath);
    if (result.skipped) {
      skipped.push({ path: relativePath, reason: result.skipped, size: result.size });
      continue;
    }
    diffs.push(result.diff);
    changed.push(Object.freeze({
      path: relativePath,
      status: "added",
      additions: result.additions,
      deletions: 0,
      previous_path: undefined,
      binary: false
    }));
  }

  if (truncated) {
    skipped.push({ truncated_after: UNTRACKED_MAX_FILES, total_untracked: paths.length });
  }

  return { diffs, changed, skipped };
}

function synthesiseAddedFileDiff(cwd, relativePath) {
  const fullPath = join(cwd, relativePath);
  let stats;
  try {
    stats = statSync(fullPath);
  } catch {
    return { skipped: "unreadable" };
  }
  if (!stats.isFile()) {
    return { skipped: "not-a-file" };
  }
  if (stats.size > UNTRACKED_MAX_FILE_BYTES) {
    return { skipped: "too-large", size: stats.size };
  }

  let buffer;
  try {
    buffer = readFileSync(fullPath);
  } catch {
    return { skipped: "read-failed" };
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
  if (sample.includes(0)) {
    return { skipped: "binary" };
  }

  const text = buffer.toString("utf8");
  const trailingNewline = text.endsWith("\n");
  const rawLines = text.split("\n");
  const contentLines = trailingNewline ? rawLines.slice(0, -1) : rawLines;
  const additions = contentLines.length;
  const header = [
    `diff --git a/${relativePath} b/${relativePath}`,
    `new file mode 100644`,
    `--- /dev/null`,
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${Math.max(additions, 1)} @@`
  ];
  const body = contentLines.map((line) => `+${line}`);
  if (!trailingNewline) {
    body.push("\\ No newline at end of file");
  }
  if (additions === 0) {
    body.push("+");
  }
  const diff = [...header, ...body, ""].join("\n");
  return { diff, additions };
}
