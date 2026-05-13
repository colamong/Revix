import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseNameStatus, parseNumstat, mapStatusCode } from "../src/sources/git-utils.js";
import { collectWorkingTreeChangeset } from "../src/sources/working-tree.js";
import { collectStagedChangeset } from "../src/sources/staged.js";
import { collectChangeset } from "../src/sources/index.js";

test("parseNameStatus maps add/modify/delete/rename codes", () => {
  const entries = parseNameStatus("A\tnew.js\nM\tedited.js\nD\tgone.js\nR090\told.js\trenamed.js\n");
  assert.deepEqual(entries, [
    { status: "added", path: "new.js" },
    { status: "modified", path: "edited.js" },
    { status: "deleted", path: "gone.js" },
    { status: "renamed", path: "renamed.js", previous_path: "old.js" }
  ]);
});

test("parseNumstat extracts adds, deletes, and binary marker", () => {
  const stats = parseNumstat("3\t1\tedited.js\n-\t-\timage.png\n");
  assert.deepEqual(stats.get("edited.js"), { additions: 3, deletions: 1, binary: false });
  assert.deepEqual(stats.get("image.png"), { additions: 0, deletions: 0, binary: true });
});

test("mapStatusCode handles unknown codes gracefully", () => {
  assert.equal(mapStatusCode("X"), "modified");
});

test("collectWorkingTreeChangeset captures uncommitted edits", async () => {
  const repo = makeGitRepo();
  writeFileSync(join(repo, "app.js"), "console.log('hello')\nconsole.log('changed')\n", "utf8");

  const changeset = await collectWorkingTreeChangeset({ cwd: repo });

  assert.equal(changeset.metadata.head_ref, "WORKTREE");
  assert.equal(changeset.metadata.base_ref.length > 0, true);
  assert.equal(changeset.changed_files.length, 1);
  assert.equal(changeset.changed_files[0].path, "app.js");
  assert.equal(changeset.changed_files[0].additions >= 1, true);
  assert.match(changeset.raw_diff, /diff --git/);
});

test("collectWorkingTreeChangeset includes untracked files as added-file diffs", async () => {
  const repo = makeGitRepo();
  writeFileSync(join(repo, "new-secret.js"), "export const apiKey = 'placeholder'\n", "utf8");

  const changeset = await collectWorkingTreeChangeset({ cwd: repo });

  const paths = changeset.changed_files.map((file) => file.path);
  assert.ok(paths.includes("new-secret.js"), "untracked file should appear in changed_files");
  const newFileEntry = changeset.changed_files.find((file) => file.path === "new-secret.js");
  assert.equal(newFileEntry.status, "added");
  assert.equal(newFileEntry.additions, 1);
  assert.match(changeset.raw_diff, /new file mode 100644/);
  assert.match(changeset.raw_diff, /\+export const apiKey = 'placeholder'/);
});

test("collectWorkingTreeChangeset honors includeUntracked=false", async () => {
  const repo = makeGitRepo();
  writeFileSync(join(repo, "app.js"), "console.log('edited')\n", "utf8");
  writeFileSync(join(repo, "fresh.txt"), "scratch\n", "utf8");

  const changeset = await collectWorkingTreeChangeset({ cwd: repo, includeUntracked: false });

  const paths = changeset.changed_files.map((file) => file.path);
  assert.ok(paths.includes("app.js"));
  assert.ok(!paths.includes("fresh.txt"));
});

test("collectStagedChangeset reports head_ref=INDEX and only staged files", async () => {
  const repo = makeGitRepo();
  writeFileSync(join(repo, "staged.js"), "// staged change\n", "utf8");
  writeFileSync(join(repo, "unstaged.js"), "// unstaged change\n", "utf8");
  execFileSync("git", ["add", "staged.js"], { cwd: repo });

  const changeset = await collectStagedChangeset({ cwd: repo });

  assert.equal(changeset.metadata.head_ref, "INDEX");
  const paths = changeset.changed_files.map((file) => file.path);
  assert.ok(paths.includes("staged.js"));
  assert.ok(!paths.includes("unstaged.js"));
});

test("collectChangeset dispatcher routes by source type", async () => {
  const repo = makeGitRepo();
  writeFileSync(join(repo, "app.js"), "// edited\n", "utf8");

  const fromWorkingTree = await collectChangeset({ type: "working-tree", cwd: repo });
  assert.equal(fromWorkingTree.metadata.head_ref, "WORKTREE");

  await assert.rejects(
    () => collectChangeset({ type: "unknown" }),
    /unknown changeset source type/
  );
});

function makeGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "revix-sources-"));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Revix Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "app.js"), "console.log('hello')\n", "utf8");
  execFileSync("git", ["add", "app.js"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], { cwd: dir });
  return dir;
}
