import { execFileSync } from "node:child_process";

export class GitSourceError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "GitSourceError";
    if (cause) this.cause = cause;
  }
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

export function runGit(args, { cwd, allowEmpty = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: DEFAULT_MAX_BUFFER,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (!allowEmpty && output.trim() === "") {
      throw new GitSourceError(`git ${args.join(" ")} produced no output`);
    }
    return output;
  } catch (error) {
    if (error instanceof GitSourceError) throw error;
    const stderr = error?.stderr?.toString?.() ?? "";
    throw new GitSourceError(`git ${args.join(" ")} failed: ${stderr || error?.message || "unknown error"}`, { cause: error });
  }
}

export function parseNameStatus(output) {
  const entries = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t+/);
    const code = parts[0];
    if (!code) continue;
    const status = mapStatusCode(code);
    if (code.startsWith("R") || code.startsWith("C")) {
      entries.push({ status, path: parts[2], previous_path: parts[1] });
    } else {
      entries.push({ status, path: parts[1] });
    }
  }
  return entries;
}

export function parseNumstat(output) {
  const stats = new Map();
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t+/);
    if (parts.length < 3) continue;
    const additions = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
    const deletions = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
    const binary = parts[0] === "-" && parts[1] === "-";
    const renameMatch = /^(.*)\s*\{(.*) => (.*)\}(.*)$/.exec(parts[2]);
    const finalPath = renameMatch
      ? `${renameMatch[1]}${renameMatch[3]}${renameMatch[4]}`.replace(/\/\//g, "/")
      : parts[2];
    stats.set(finalPath, { additions, deletions, binary });
  }
  return stats;
}

export function mapStatusCode(code) {
  const letter = code[0];
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  if (letter === "R") return "renamed";
  if (letter === "C") return "copied";
  return "modified";
}

export function deriveRepoSlug(cwd) {
  try {
    const url = runGit(["config", "--get", "remote.origin.url"], { cwd, allowEmpty: true }).trim();
    if (!url) return "local";
    const match = /[:/]([^:/]+\/[^:/]+?)(?:\.git)?$/.exec(url);
    return match ? match[1] : "local";
  } catch {
    return "local";
  }
}

export function deriveAuthor(cwd) {
  try {
    return runGit(["config", "--get", "user.email"], { cwd, allowEmpty: true }).trim();
  } catch {
    return "";
  }
}

export function deriveBaseRef(cwd) {
  try {
    const ref = runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd, allowEmpty: true }).trim();
    return ref || "HEAD";
  } catch {
    return "HEAD";
  }
}
