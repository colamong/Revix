#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRevixConfig } from "../config/index.js";
import { runRevixReview } from "../orchestrator/index.js";
import { redactSensitiveValue } from "../providers/index.js";
import { collectPrGithubChangeset } from "../sources/pr-github.js";

export { collectPrGithubChangeset as collectPrInput } from "../sources/pr-github.js";

const COMMENT_MARKER = "<!-- revix-review -->";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGitHubAction({
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    fetchImpl: globalThis.fetch
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export async function runGitHubAction({ env = process.env, stdout = process.stdout, stderr = process.stderr, fetchImpl = globalThis.fetch } = {}) {
  try {
    const options = actionOptions(env);
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const pr = event.pull_request;
    if (!pr || !event.repository?.full_name) {
      throw new GitHubActionError("Revix GitHub Action only supports pull_request events");
    }
    const token = env.GITHUB_TOKEN;
    if (!token && !options.dryRun) {
      throw new GitHubActionError("GITHUB_TOKEN is required unless dry-run is true");
    }

    const api = createGitHubClient({ env, token, fetchImpl });
    const prInput = await collectPrGithubChangeset({ type: "pr", api, event, pr });
    const projectRoot = resolve(env.GITHUB_WORKSPACE ?? process.cwd(), options.configPath);
    const config = actionConfig(loadRevixConfig(projectRoot), options);
    const result = await runRevixReview(prInput, {
      projectRoot,
      config,
      outputFormat: "github-comment"
    });
    const body = `${COMMENT_MARKER}\n${result.output.markdown}`;

    if (options.comment && !options.dryRun) {
      await upsertReviewComment({ api, repo: event.repository.full_name, issueNumber: pr.number, body });
    }
    stdout.write(body);

    if (!options.dryRun && config.verdict.fail_on_request_changes && ["REQUEST_CHANGES", "BLOCK"].includes(result.finalDecision.verdict)) {
      return 2;
    }
    return 0;
  } catch (error) {
    stderr.write(`${error?.message ?? String(error)}\n`);
    return 1;
  }
}

export function actionOptions(env) {
  return Object.freeze({
    provider: input(env, "provider"),
    model: input(env, "model"),
    configPath: input(env, "config-path") || ".",
    dryRun: booleanInput(input(env, "dry-run"), false),
    comment: booleanInput(input(env, "comment"), true),
    failOnRequestChanges: optionalBooleanInput(input(env, "fail-on-request-changes"))
  });
}

export async function upsertReviewComment({ api, repo, issueNumber, body }) {
  const comments = await api.getJson(`/repos/${repo}/issues/${issueNumber}/comments?per_page=100`);
  const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(COMMENT_MARKER));
  if (existing) {
    return api.patchJson(`/repos/${repo}/issues/comments/${existing.id}`, { body });
  }
  return api.postJson(`/repos/${repo}/issues/${issueNumber}/comments`, { body });
}

export function createGitHubClient({ env, token, fetchImpl }) {
  const apiBase = env.GITHUB_API_URL ?? "https://api.github.com";
  const request = async (path, { method = "GET", accept = "application/vnd.github+json", body } = {}) => {
    const headers = {
      "accept": accept,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28"
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    if (!response.ok) {
      throw new GitHubActionError(`GitHub API request failed with ${response.status}: ${redactSensitiveValue(text)}`);
    }
    return text;
  };
  return Object.freeze({
    getText: (path, options) => request(path, options),
    getJson: async (path, options) => JSON.parse(await request(path, options)),
    postJson: async (path, body) => JSON.parse(await request(path, { method: "POST", body })),
    patchJson: async (path, body) => JSON.parse(await request(path, { method: "PATCH", body }))
  });
}

function actionConfig(config, options) {
  const copy = JSON.parse(JSON.stringify(config));
  if (options.provider) copy.provider.name = options.provider;
  if (options.model) copy.provider.model = options.model;
  if (typeof options.failOnRequestChanges === "boolean") {
    copy.verdict.fail_on_request_changes = options.failOnRequestChanges;
  }
  return copy;
}

function input(env, name) {
  return env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`]?.trim() ?? "";
}

function booleanInput(value, defaultValue) {
  if (value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function optionalBooleanInput(value) {
  return value === "" ? undefined : booleanInput(value, false);
}

export class GitHubActionError extends Error {
  constructor(message) {
    super(message);
    this.name = "GitHubActionError";
  }
}
