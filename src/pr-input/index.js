export class PrInputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrInputValidationError";
  }
}

const FILE_STATUSES = Object.freeze(["added", "modified", "deleted", "renamed", "copied", "unchanged"]);
const METADATA_KEYS = Object.freeze(["repo", "number", "title", "body", "author", "labels", "base_ref", "head_ref"]);
const FILE_KEYS = Object.freeze(["path", "status", "additions", "deletions", "patch", "previous_path", "binary"]);
const INPUT_KEYS = Object.freeze(["metadata", "changed_files", "raw_diff"]);

export function validatePrInput(input) {
  assertObject(input, "pr input");
  validateExactKeys(input, INPUT_KEYS, "pr input");
  const metadata = normalizeMetadata(input.metadata);
  const changedFiles = normalizeChangedFiles(input.changed_files);
  const rawDiff = typeof input.raw_diff === "string" ? input.raw_diff.trim() : "";
  if (changedFiles.length === 0 && rawDiff === "") {
    throw new PrInputValidationError("pr input must include changed_files or raw_diff");
  }
  const parsedDiff = rawDiff ? parseUnifiedDiff(rawDiff) : { raw: "", files: [] };
  return deepFreeze({
    metadata,
    changed_files: changedFiles,
    raw_diff: rawDiff,
    diff: parsedDiff
  });
}

export function parseUnifiedDiff(rawDiff) {
  if (typeof rawDiff !== "string" || rawDiff.trim() === "") {
    throw new PrInputValidationError("raw diff must be a non-empty string");
  }
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawDiff.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = { file_path: extractGitPath(line), hunks: [] };
      currentHunk = null;
      continue;
    }
    if (!currentFile) {
      continue;
    }
    if (line.startsWith("+++ ")) {
      const filePath = line.slice(4).trim();
      if (filePath !== "/dev/null") {
        currentFile.file_path = stripDiffPrefix(filePath);
      }
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (!match) {
        throw new PrInputValidationError(`malformed diff hunk header: ${line}`);
      }
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      currentHunk = {
        header: line,
        old_start: oldLine,
        new_start: newLine,
        context: match[3].trim(),
        lines: []
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk) {
      const prefix = line[0] ?? " ";
      if (![" ", "+", "-", "\\"].includes(prefix)) {
        throw new PrInputValidationError(`malformed diff line: ${line}`);
      }
      const entry = {
        type: prefix === "+" ? "add" : prefix === "-" ? "delete" : prefix === "\\" ? "meta" : "context",
        old_line: prefix === "+" || prefix === "\\" ? null : oldLine,
        new_line: prefix === "-" || prefix === "\\" ? null : newLine,
        content: prefix === "\\" ? line : line.slice(1)
      };
      currentHunk.lines.push(entry);
      if (prefix !== "+" && prefix !== "\\") oldLine += 1;
      if (prefix !== "-" && prefix !== "\\") newLine += 1;
    }
  }
  if (currentFile) {
    files.push(currentFile);
  }
  if (files.length === 0) {
    throw new PrInputValidationError("raw diff did not contain any file diffs");
  }
  return deepFreeze({ raw: rawDiff, files });
}

function normalizeMetadata(value) {
  assertObject(value, "metadata");
  validateExactKeys(value, METADATA_KEYS, "metadata");
  for (const key of ["repo", "title", "author", "base_ref", "head_ref"]) {
    assertString(value[key], `metadata.${key}`);
  }
  const hasNumber = value.number !== undefined && value.number !== null;
  if (hasNumber && (!Number.isInteger(value.number) || value.number < 1)) {
    throw new PrInputValidationError("metadata.number must be a positive integer when present");
  }
  const body = typeof value.body === "string" ? value.body : "";
  if (!Array.isArray(value.labels) || value.labels.some((label) => typeof label !== "string" || label.trim() === "")) {
    throw new PrInputValidationError("metadata.labels must be an array of strings");
  }
  return {
    repo: value.repo.trim(),
    number: hasNumber ? value.number : null,
    title: value.title.trim(),
    body,
    author: value.author.trim(),
    labels: Object.freeze(value.labels.map((label) => label.trim())),
    base_ref: value.base_ref.trim(),
    head_ref: value.head_ref.trim()
  };
}

function normalizeChangedFiles(value) {
  if (!Array.isArray(value)) {
    throw new PrInputValidationError("changed_files must be an array");
  }
  return Object.freeze(value.map((file, index) => {
    assertObject(file, `changed_files[${index}]`);
    validateExactKeys(file, FILE_KEYS, `changed_files[${index}]`);
    assertString(file.path, `changed_files[${index}].path`);
    if (!FILE_STATUSES.includes(file.status)) {
      throw new PrInputValidationError(`changed_files[${index}].status is unsupported`);
    }
    for (const key of ["additions", "deletions"]) {
      if (!Number.isInteger(file[key]) || file[key] < 0) {
        throw new PrInputValidationError(`changed_files[${index}].${key} must be a non-negative integer`);
      }
    }
    if ("patch" in file && file.patch !== undefined && typeof file.patch !== "string") {
      throw new PrInputValidationError(`changed_files[${index}].patch must be a string`);
    }
    if ("previous_path" in file && file.previous_path !== undefined && typeof file.previous_path !== "string") {
      throw new PrInputValidationError(`changed_files[${index}].previous_path must be a string`);
    }
    if ("binary" in file && typeof file.binary !== "boolean") {
      throw new PrInputValidationError(`changed_files[${index}].binary must be boolean`);
    }
    return Object.freeze({
      path: file.path.trim(),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
      previous_path: file.previous_path,
      binary: file.binary === true
    });
  }));
}

function extractGitPath(line) {
  const parts = line.split(" ");
  return stripDiffPrefix(parts[3] ?? parts[2] ?? "");
}

function stripDiffPrefix(filePath) {
  return filePath.replace(/^a\//, "").replace(/^b\//, "");
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PrInputValidationError(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PrInputValidationError(`${label} must be a non-empty string`);
  }
}

function validateExactKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PrInputValidationError(`${label} has unknown field: ${key}`);
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
