import { GitSourceError, deriveAuthor, deriveBaseRef, deriveRepoSlug, parseNameStatus, parseNumstat, runGit } from "./git-utils.js";

export async function collectStagedChangeset(source = {}, options = {}) {
  const cwd = source.cwd ?? options.cwd ?? process.cwd();

  const rawDiff = runGit(["diff", "--no-color", "--staged"], { cwd, allowEmpty: true });
  const nameStatus = parseNameStatus(runGit(["diff", "--name-status", "--staged"], { cwd, allowEmpty: true }));
  const numstat = parseNumstat(runGit(["diff", "--numstat", "--staged"], { cwd, allowEmpty: true }));
  if (nameStatus.length === 0 && rawDiff.trim() === "") {
    throw new GitSourceError("no staged changes to review (git index is empty)");
  }

  const changedFiles = nameStatus.map((entry) => {
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

  return Object.freeze({
    metadata: Object.freeze({
      repo: deriveRepoSlug(cwd),
      title: source.title ?? "Staged changes",
      body: source.body ?? "",
      author: source.author ?? deriveAuthor(cwd),
      labels: Object.freeze(source.labels ? [...source.labels] : []),
      base_ref: deriveBaseRef(cwd),
      head_ref: "INDEX"
    }),
    changed_files: Object.freeze(changedFiles),
    raw_diff: rawDiff
  });
}
