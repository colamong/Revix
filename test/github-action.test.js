import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPrInput, createGitHubClient, GitHubActionError, runGitHubAction, upsertReviewComment } from "../src/github-action/index.js";

test("collectPrInput builds Revix PR input from GitHub API data", async () => {
  const api = {
    getJson: async () => [{
      filename: "src/index.js",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1 @@"
    }],
    getText: async () => "diff --git a/src/index.js b/src/index.js\n"
  };

  const input = await collectPrInput({ api, event: eventPayload(), pr: eventPayload().pull_request });

  assert.equal(input.metadata.repo, "colamong/Revix");
  assert.equal(input.changed_files[0].path, "src/index.js");
  assert.equal(input.raw_diff.startsWith("diff --git"), true);
});

test("collectPrInput paginates PR files endpoint beyond 100 entries", async () => {
  const filesPage1 = Array.from({ length: 100 }, (_, i) => ({
    filename: `src/page1-${i}.js`,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -1 +1 @@"
  }));
  const filesPage2 = Array.from({ length: 5 }, (_, i) => ({
    filename: `src/page2-${i}.js`,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -1 +1 @@"
  }));
  const calls = [];
  const api = {
    getJson: async (path) => {
      calls.push(path);
      if (/[?&]page=1(?:$|&)/.test(path)) return filesPage1;
      if (/[?&]page=2(?:$|&)/.test(path)) return filesPage2;
      throw new Error(`unexpected getJson path: ${path}`);
    },
    getText: async () => "diff --git a/src/page1-0.js b/src/page1-0.js\n"
  };

  const input = await collectPrInput({ api, event: eventPayload(), pr: eventPayload().pull_request });

  assert.equal(input.changed_files.length, 105, "expected all 105 files across both pages");
  const paths = input.changed_files.map((file) => file.path);
  assert.ok(paths.includes("src/page2-0.js"), "files from page 2 must be included");
  assert.ok(paths.includes("src/page2-4.js"), "last entry from page 2 must be included");
  assert.equal(calls.length, 2, "should fetch exactly two pages when page 2 returns less than per_page");
});

test("collectPrInput stops paginating when a full page is followed by an empty page", async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => ({
    filename: `src/file-${i}.js`,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -1 +1 @@"
  }));
  const calls = [];
  const api = {
    getJson: async (path) => {
      calls.push(path);
      if (/[?&]page=1(?:$|&)/.test(path)) return fullPage;
      if (/[?&]page=2(?:$|&)/.test(path)) return [];
      throw new Error(`unexpected getJson path: ${path}`);
    },
    getText: async () => "diff --git a/src/file-0.js b/src/file-0.js\n"
  };

  const input = await collectPrInput({ api, event: eventPayload(), pr: eventPayload().pull_request });

  assert.equal(input.changed_files.length, 100);
  assert.equal(calls.length, 2, "should request page 2 then stop when empty");
});

test("upsertReviewComment updates existing marker comment", async () => {
  const calls = [];
  const api = {
    getJson: async () => [{ id: 10, body: "<!-- revix-review -->\nold" }],
    patchJson: async (path, body) => {
      calls.push({ method: "PATCH", path, body });
      return { id: 10 };
    },
    postJson: async () => {
      throw new Error("should not post");
    }
  };

  await upsertReviewComment({ api, repo: "colamong/Revix", issueNumber: 1, body: "<!-- revix-review -->\nnew" });

  assert.deepEqual(calls.map((call) => call.method), ["PATCH"]);
  assert.equal(calls[0].path, "/repos/colamong/Revix/issues/comments/10");
});

test("createGitHubClient omits Authorization header when token is absent", async () => {
  const calls = [];
  const client = createGitHubClient({
    env: { GITHUB_API_URL: "https://api.github.com" },
    token: undefined,
    fetchImpl: async (url, request) => {
      calls.push({ url, headers: request.headers });
      return { ok: true, status: 200, async text() { return "[]"; } };
    }
  });

  await client.getJson("/repos/colamong/Revix/issues/1/comments");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, undefined);
});

test("createGitHubClient redacts secrets in failed-response error body", async () => {
  const client = createGitHubClient({
    env: { GITHUB_API_URL: "https://api.github.com" },
    token: "ghs_token",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return "{\"message\":\"Bad credentials\",\"api_key\":\"abc123secret\"}";
      }
    })
  });

  await assert.rejects(
    () => client.getJson("/repos/colamong/Revix/issues/1/comments"),
    (error) => {
      assert.ok(error instanceof GitHubActionError);
      assert.match(error.message, /\[REDACTED\]/);
      assert.ok(!error.message.includes("abc123secret"));
      return true;
    }
  );
});

test("GitHub Action dry-run renders review without posting", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "revix-action-"));
  const eventPath = join(workspace, "event.json");
  writeFileSync(eventPath, JSON.stringify(eventPayload()), "utf8");
  const calls = [];
  const result = await runActionForTest({
    workspace,
    eventPath,
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (url.includes("/files")) return jsonResponse(githubFiles());
      if (request.headers.accept.includes("diff")) return textResponse("diff --git a/src/index.js b/src/index.js\n");
      throw new Error(`unexpected request: ${url}`);
    },
    dryRun: true
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Revix PR Review: APPROVE/);
  assert.equal(calls.some((call) => call.request.method === "POST" || call.request.method === "PATCH"), false);
});

test("GitHub Action posts a new review comment", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "revix-action-"));
  const eventPath = join(workspace, "event.json");
  writeFileSync(eventPath, JSON.stringify(eventPayload()), "utf8");
  const writes = [];
  const result = await runActionForTest({
    workspace,
    eventPath,
    fetchImpl: async (url, request) => {
      if (url.includes("/files")) return jsonResponse(githubFiles());
      if (request.headers.accept.includes("diff")) return textResponse("diff --git a/src/index.js b/src/index.js\n");
      if (url.includes("/comments") && request.method === "GET") return jsonResponse([]);
      if (url.includes("/comments") && request.method === "POST") {
        writes.push(JSON.parse(request.body));
        return jsonResponse({ id: 1 });
      }
      throw new Error(`unexpected request: ${url}`);
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(writes.length, 1);
  assert.match(writes[0].body, /<!-- revix-review -->/);
});

async function runActionForTest({ workspace, eventPath, fetchImpl, dryRun = false }) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runGitHubAction({
    env: {
      GITHUB_WORKSPACE: workspace,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_TOKEN: "ghs_test",
      INPUT_DRY_RUN: String(dryRun),
      INPUT_COMMENT: "true"
    },
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    fetchImpl
  });
  return { exitCode, stdout, stderr };
}

function eventPayload() {
  return {
    repository: { full_name: "colamong/Revix" },
    pull_request: {
      number: 7,
      title: "Update docs",
      body: "Adds documentation.",
      user: { login: "alice" },
      labels: [],
      base: { ref: "main" },
      head: { ref: "docs" }
    }
  };
}

function githubFiles() {
  return [{ filename: "src/index.js", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@" }];
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function textResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return payload;
    }
  };
}
