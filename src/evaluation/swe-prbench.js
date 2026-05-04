import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_SOURCE = "swe-prbench";

export async function convertSwePrBenchDataset({ rawDir, outDir, limit, evalSplit } = {}) {
  if (!rawDir) throw new Error("rawDir is required");
  if (!outDir) throw new Error("outDir is required");

  const records = await loadSwePrBenchRecords(rawDir);
  const annotations = await loadAnnotations(rawDir);
  const selectedTaskIds = evalSplit ? new Set(await loadEvalSplit(evalSplit)) : null;
  const selected = records
    .filter((record) => !selectedTaskIds || selectedTaskIds.has(record.task_id))
    .slice(0, limit ?? records.length);
  const cases = selected.map((record) => convertSwePrBenchRecord(record, annotations.get(record.task_id)));
  const summary = buildSummary(cases, { rawDir, evalSplit, limit });

  await mkdir(outDir, { recursive: true });
  const casesPath = join(outDir, "eval-cases.json");
  const summaryPath = join(outDir, "SUMMARY.json");
  await writeJson(casesPath, cases);
  await writeJson(summaryPath, summary);

  return {
    count: cases.length,
    casesPath,
    summaryPath,
    summary
  };
}

export function convertSwePrBenchRecord(record, annotation) {
  if (!record?.task_id) throw new Error("SWE-PRBench record missing task_id");
  const comments = normalizeComments(annotation?.comments ?? record.human_review_comments ?? []);
  const issues = comments.map((comment, index) => expectedIssueFromComment(record, comment, index));
  return {
    eval_id: `swe-prbench:${record.task_id}`,
    source: DEFAULT_SOURCE,
    pr_input: {
      metadata: {
        id: record.task_id,
        title: record.title ?? "",
        description: record.description ?? "",
        labels: labelsForRecord(record),
        author: "swe-prbench",
        base_branch: record.base_branch ?? "main",
        head_branch: record.head_branch ?? String(record.pr_number ?? record.task_id),
        files_changed: normalizeChangedFiles(record.changed_files),
        additions: record.lines_added ?? 0,
        deletions: record.lines_removed ?? 0
      },
      diff: {
        raw: record.diff_patch ?? "",
        files: normalizeChangedFiles(record.changed_files)
      },
      source: {
        repo: record.repo,
        pr_number: record.pr_number,
        pr_url: record.pr_url,
        base_commit: record.base_commit,
        head_commit: record.head_commit,
        difficulty: record.difficulty,
        rvs_score: record.rvs_score
      }
    },
    expected_issues: issues,
    expected_verdict: expectedVerdict(record, issues),
    human_review_comments: comments
  };
}

export async function loadSwePrBenchRecords(rawDir) {
  const prsJsonlPath = join(rawDir, "prs.jsonl");
  const text = await readFile(prsJsonlPath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function expectedIssueFromComment(record, comment, index) {
  const category = inferCategory(record, comment);
  const severity = inferSeverity(record, comment, category);
  const body = normalizeText(comment.body ?? comment.text ?? comment.comment ?? "");
  const filePath = comment.file ?? comment.path ?? firstChangedFile(record);
  const line = normalizeLine(comment.line ?? comment.original_line ?? comment.position ?? lineFromDiffHunk(comment.diffHunk ?? comment.diff_hunk, body));
  const claim = firstSentence(body);
  return {
    issue_id: `${record.task_id}:human:${comment.comment_id ?? comment.id ?? index + 1}`,
    category,
    severity,
    claim,
    file_path: filePath,
    line_start: line,
    line_end: line,
    allowed_claims: [body].filter(Boolean),
    root_cause: rootCauseHint(body),
    weight: weightFor(category),
    matchability: inferMatchability({ category, claim, body, filePath })
  };
}

async function loadAnnotations(rawDir) {
  const annotationsDir = join(rawDir, "annotations");
  const annotations = new Map();
  let files = [];
  try {
    files = await readdir(annotationsDir);
  } catch {
    return annotations;
  }
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const annotation = JSON.parse(await readFile(join(annotationsDir, file), "utf8"));
    if (annotation.task_id) annotations.set(annotation.task_id, annotation);
  }
  return annotations;
}

async function loadEvalSplit(evalSplitPath) {
  const parsed = JSON.parse(await readFile(evalSplitPath, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  return parsed.task_ids ?? [];
}

function normalizeComments(comments) {
  return comments
    .filter((comment) => comment && (comment.body || comment.text || comment.comment))
    .map((comment) => ({
      comment_id: comment.comment_id ?? comment.id,
      author: comment.author,
      body: normalizeText(comment.body ?? comment.text ?? comment.comment),
      path: comment.path ?? comment.file,
      file: comment.file ?? comment.path,
      line: comment.line ?? comment.original_line ?? comment.position,
      diffHunk: comment.diffHunk ?? comment.diff_hunk,
      is_in_diff: comment.is_in_diff,
      is_initiating_comment: comment.is_initiating_comment
    }));
}

function labelsForRecord(record) {
  return [
    record.language ? `language:${String(record.language).toLowerCase()}` : null,
    record.pr_type ? `pr-type:${record.pr_type}` : null,
    record.difficulty ? `difficulty:${record.difficulty}` : null
  ].filter(Boolean);
}

function normalizeChangedFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((path) => ({
    path,
    status: "modified",
    additions: 0,
    deletions: 0
  }));
}

function expectedVerdict(record, issues) {
  if (issues.length === 0) return "APPROVE";
  if (record.has_requested_changes || issues.some((issue) => issue.severity === "BLOCKER")) return "REQUEST_CHANGES";
  return "COMMENT";
}

function inferCategory(record, comment) {
  const commentText = String(comment.body ?? "");
  if (/```suggestion/.test(commentText)) return "docs";
  if (/changelog|unreleased/i.test(commentText)) return "docs";
  if (/\b(remove this|revert|undo)\b/i.test(commentText)) return "correctness";
  if (/\b(api|interface|breaking.change|signature)\b/i.test(commentText)) return "contract";
  if (/\b(test|coverage|assert|assertion)\b/i.test(commentText)) return "test";
  const recordText = `${record.title ?? ""} ${record.description ?? ""} ${comment.path ?? comment.file ?? ""}`;
  if (/\b(secret|token|credential|auth|permission|xss|csrf|sql injection|leak)\b/i.test(recordText)) return "security";
  if (/\b(slow|performance|latency|timeout|memory|n\+1|query)\b/i.test(recordText)) return "performance";
  if (String(record.pr_type ?? "").toLowerCase().includes("bug")) return "correctness";
  return "correctness";
}

function inferMatchability({ category, claim, body, filePath }) {
  const text = `${claim ?? ""} ${body ?? ""} ${filePath ?? ""}`;
  if (category === "docs" && /```suggestion/.test(text)) return "low";
  if (/\bCHANGELOG\b|codecov\.yml|\.metadata\.json/i.test(text)) return "low";
  if (normalizeTokens(claim).length < 15) return "low";
  return "high";
}

function inferSeverity(record, comment, category) {
  const text = `${comment.body ?? ""}`.toLowerCase();
  if (category === "security" || /\b(data loss|credential|secret|exploit)\b/.test(text)) return "BLOCKER";
  if (comment.requires_change || comment.is_blocking) return "MAJOR";
  if (category === "contract" || category === "performance") return "MAJOR";
  if (category === "docs" || category === "readability") return "MINOR";
  return "MAJOR";
}

function lineFromDiffHunk(diffHunk, body) {
  if (typeof diffHunk !== "string" || diffHunk.trim() === "") return null;
  const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(diffHunk);
  if (!header) return null;
  const targetKey = suggestionKey(body);
  let newLine = Number.parseInt(header[1], 10);
  for (const line of diffHunk.split(/\r?\n/).slice(1)) {
    const prefix = line[0] ?? " ";
    const content = line.slice(1);
    if ((prefix === "+" || prefix === " ") && (!targetKey || content.includes(targetKey))) {
      return newLine;
    }
    if (prefix !== "-") newLine += 1;
  }
  return Number.parseInt(header[1], 10);
}

function suggestionKey(body) {
  const match = /"([^"]+)"\s*:/.exec(body ?? "");
  return match?.[1] ?? null;
}

function firstSentence(text) {
  const normalized = normalizeText(text);
  const [first] = normalized.split(/(?<=[.!?])\s+/);
  return first?.slice(0, 280) || "Human reviewer flagged this code path.";
}

function rootCauseHint(text) {
  const tokens = normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 8);
  return tokens.join(" ");
}

function firstChangedFile(record) {
  return Array.isArray(record.changed_files) && record.changed_files.length > 0 ? record.changed_files[0] : "UNKNOWN";
}

function normalizeLine(value) {
  const line = Number.parseInt(value, 10);
  return Number.isFinite(line) && line > 0 ? line : 1;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function weightFor(category) {
  if (["security", "data_loss", "contract"].includes(category)) return 2;
  if (["correctness", "reliability", "performance"].includes(category)) return 1.5;
  if (["style", "nit"].includes(category)) return 0.25;
  return 1;
}

function buildSummary(cases, input) {
  const categories = {};
  for (const item of cases.flatMap((evalCase) => evalCase.expected_issues)) {
    categories[item.category] = (categories[item.category] ?? 0) + 1;
  }
  return {
    source: DEFAULT_SOURCE,
    generated_at: new Date().toISOString(),
    input,
    count: cases.length,
    expected_issue_count: cases.reduce((sum, evalCase) => sum + evalCase.expected_issues.length, 0),
    categories: Object.fromEntries(Object.entries(categories).sort(([left], [right]) => left.localeCompare(right)))
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
