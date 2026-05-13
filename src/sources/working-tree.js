import { GitSourceError, deriveAuthor, deriveBaseRef, deriveRepoSlug, parseNameStatus, parseNumstat, runGit } from "./git-utils.js";
import { buildUntrackedAdditions, listUntrackedFiles } from "./untracked.js";

export async function collectWorkingTreeChangeset(source = {}, options = {}) {
  const cwd = source.cwd ?? options.cwd ?? process.cwd();
  const baseRef = source.baseRef ?? "HEAD";
  const includeUntracked = source.includeUntracked !== false;

  const trackedDiff = runGit(["diff", "--no-color", baseRef], { cwd, allowEmpty: true });
  const nameStatus = parseNameStatus(runGit(["diff", "--name-status", baseRef], { cwd, allowEmpty: true }));
  const numstat = parseNumstat(runGit(["diff", "--numstat", baseRef], { cwd, allowEmpty: true }));

  const trackedFiles = nameStatus.map((entry) => {
    const stats = numstat.get(entry.path) ?? { additions: 0, deletions: 0, binary: false };
    return Object.freeze({
      path: entry.path,
      status: entry.status,
      additions: stats.additions,
      deletions: stats.deletions,
      previous_path: entry.previous_path,
      binary: stats.binary
    });
  });

  let untrackedDiff = "";
  let untrackedChanged = [];
  let untrackedSkipped = [];
  if (includeUntracked) {
    const untrackedPaths = listUntrackedFiles(cwd);
    if (untrackedPaths.length > 0) {
      const result = buildUntrackedAdditions(cwd, untrackedPaths);
      untrackedDiff = result.diffs.join("");
      untrackedChanged = result.changed;
      untrackedSkipped = result.skipped;
    }
  }

  const changedFiles = [...trackedFiles, ...untrackedChanged];
  const rawDiff = `${trackedDiff}${untrackedDiff}`;

  if (changedFiles.length === 0 && rawDiff.trim() === "") {
    throw new GitSourceError("no uncommitted changes to review (working tree clean against HEAD)");
  }

  return Object.freeze({
    metadata: Object.freeze({
      repo: deriveRepoSlug(cwd),
      title: source.title ?? "Working tree changes",
      body: source.body ?? "",
      author: source.author ?? deriveAuthor(cwd),
      labels: Object.freeze(source.labels ? [...source.labels] : []),
      base_ref: deriveBaseRef(cwd),
      head_ref: "WORKTREE"
    }),
    changed_files: Object.freeze(changedFiles),
    raw_diff: rawDiff,
    untracked_skipped: Object.freeze(untrackedSkipped)
  });
}
