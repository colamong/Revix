import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  convertSwePrBenchDataset,
  convertSwePrBenchRecord
} from "../src/evaluation/swe-prbench.js";

test("converts a SWE-PRBench record into a Revix eval case", () => {
  const evalCase = convertSwePrBenchRecord(record(), {
    task_id: "linkding__1261",
    comments: [
      {
        comment_id: "c1",
        body: "This is a breaking change for clients that expect absolute favicon URLs.",
        file: "bookmarks/views/settings.py",
        line: 42,
        is_in_diff: true,
        is_initiating_comment: true
      }
    ]
  });

  assert.equal(evalCase.eval_id, "swe-prbench:linkding__1261");
  assert.equal(evalCase.expected_verdict, "REQUEST_CHANGES");
  assert.equal(evalCase.expected_issues[0].category, "contract");
  assert.equal(evalCase.expected_issues[0].severity, "MAJOR");
  assert.equal(evalCase.expected_issues[0].weight, 2);
  assert.equal(evalCase.pr_input.metadata.title, record().title);
  assert.match(evalCase.pr_input.diff.raw, /diff --git/);
});

test("derives non-blocking suggestion line and docs category from diff hunk", () => {
  const evalCase = convertSwePrBenchRecord(record({ has_requested_changes: true }), {
    task_id: "linkding__1261",
    comments: [
      {
        comment_id: "c1",
        body: "```suggestion\n    \"Description\": \"Use clearer public wording.\"\n```",
        file: "metadata.json",
        line: null,
        diff_hunk: "@@ -0,0 +1,4 @@\n+{\n+    \"Provider\": \"aws\",\n+    \"Description\": \"Old wording\"\n+}",
        requires_change: false
      }
    ]
  });

  assert.equal(evalCase.expected_issues[0].category, "docs");
  assert.equal(evalCase.expected_issues[0].severity, "MINOR");
  assert.equal(evalCase.expected_issues[0].line_start, 3);
});

test("converts a raw SWE-PRBench directory with eval split filtering", async () => {
  const root = await mkdtemp(join(tmpdir(), "revix-swe-prbench-"));
  const rawDir = join(root, "dataset");
  const outDir = join(root, "converted");
  await mkdir(join(rawDir, "annotations"), { recursive: true });
  await mkdir(join(rawDir, "evals"), { recursive: true });
  await writeFile(join(rawDir, "prs.jsonl"), `${JSON.stringify(record())}\n${JSON.stringify(record({ task_id: "skip__1" }))}\n`);
  await writeFile(join(rawDir, "annotations", "linkding__1261_human.json"), `${JSON.stringify({
    task_id: "linkding__1261",
    comments: [{ comment_id: "c1", body: "The API response is incompatible with existing clients.", file: "api.py", line: 7 }]
  })}\n`);
  await writeFile(join(rawDir, "evals", "eval_100.json"), `${JSON.stringify({ task_ids: ["linkding__1261"] })}\n`);

  const result = await convertSwePrBenchDataset({
    rawDir,
    outDir,
    evalSplit: join(rawDir, "evals", "eval_100.json")
  });
  const cases = JSON.parse(await readFile(result.casesPath, "utf8"));
  const summary = JSON.parse(await readFile(result.summaryPath, "utf8"));

  assert.equal(result.count, 1);
  assert.equal(cases[0].eval_id, "swe-prbench:linkding__1261");
  assert.equal(summary.count, 1);
  assert.equal(summary.expected_issue_count, 1);
});

test("maps suggestion block comments to docs category", () => {
  const evalCase = convertSwePrBenchRecord(record(), {
    task_id: "linkding__1261",
    comments: [{
      comment_id: "c1",
      body: "```suggestion\nUse clearer public wording.\n```",
      file: "bookmarks/views/settings.py",
      line: 4
    }]
  });

  assert.equal(evalCase.expected_issues[0].category, "docs");
});

test("maps CHANGELOG comments to docs category", () => {
  const evalCase = convertSwePrBenchRecord(record(), {
    task_id: "linkding__1261",
    comments: [{
      comment_id: "c1",
      body: "Move this entry under the current UNRELEASED section in the CHANGELOG.",
      file: "CHANGELOG.md",
      line: 8
    }]
  });

  assert.equal(evalCase.expected_issues[0].category, "docs");
});

test("assigns matchability low to short suggestion claims", () => {
  const evalCase = convertSwePrBenchRecord(record(), {
    task_id: "linkding__1261",
    comments: [{
      comment_id: "c1",
      body: "```suggestion\nUse clearer wording.\n```",
      file: "metadata.json",
      line: 3
    }]
  });

  assert.equal(evalCase.expected_issues[0].matchability, "low");
});

test("assigns matchability high to substantive correctness claims", () => {
  const evalCase = convertSwePrBenchRecord(record(), {
    task_id: "linkding__1261",
    comments: [{
      comment_id: "c1",
      body: "The new branch skips validation when the cached profile is stale, causing incorrect authorization decisions for active users.",
      file: "bookmarks/views/settings.py",
      line: 42
    }]
  });

  assert.equal(evalCase.expected_issues[0].category, "correctness");
  assert.equal(evalCase.expected_issues[0].matchability, "high");
});

function record(overrides = {}) {
  return {
    task_id: "linkding__1261",
    repo: "sissbruecker/linkding",
    repo_name: "linkding",
    repo_clone_url: "https://github.com/sissbruecker/linkding.git",
    repo_url: "https://github.com/sissbruecker/linkding",
    pr_number: 1261,
    pr_url: "https://github.com/sissbruecker/linkding/pull/1261",
    title: "Remove absolute URIs from settings page",
    description: "Avoid absolute URIs in settings page responses.",
    language: "Python",
    pr_type: "feature",
    difficulty: "Type3_Latent",
    rvs_score: 0.345,
    lines_added: 27,
    lines_removed: 16,
    changed_files: ["bookmarks/views/settings.py"],
    base_commit: "a".repeat(40),
    head_commit: "b".repeat(40),
    has_requested_changes: true,
    human_review_comments: [],
    diff_patch: "diff --git a/bookmarks/views/settings.py b/bookmarks/views/settings.py\n+return favicon_path",
    ...overrides
  };
}
