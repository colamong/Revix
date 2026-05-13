---
name: change-risk-review
description: Run a focused change-risk review on the current working tree, staged changes, or a GitHub pull request. Use before committing, pushing, or merging to catch security, concurrency, data-loss, API-break, performance, observability, reliability, and correctness risks. Not a general code-review pass — it is intentionally narrow to keep signal high and noise low.
---

# Change-Risk Review (Revix)

This skill runs **Revix** against the changes you are about to commit, push, or merge. Revix is a configurable change-risk review engine: it raises only findings that violate the project's quality constitution and that have evidence in the diff.

## When to invoke

Use this skill when the user is at a concrete decision point:

- "before committing this" — review the working tree
- "before pushing this" — review the working tree (or staged, if they staged manually)
- "before merging" / "is this PR safe to merge" — review the PR
- "any risks I'm missing" on a focused change — review the working tree

Do not invoke this skill for:

- general "review my code" or refactor advice
- style, naming, formatting, or docstring questions
- explaining what a piece of code does

Those are out of scope by design.

## How to invoke

Run from the repository root.

| Stage | Command |
|---|---|
| Working tree (uncommitted) | `revix review --working-tree --format markdown` |
| Staged (git index) | `revix review --staged --format markdown` |
| Pull request | `revix review --pr <number>` (typically via the GitHub Action) |

JSON output is available with `--format json` if you want to parse the findings yourself.

If `revix` is not on PATH, run `npx revix review --working-tree` instead.

## Interpreting the output

Revix returns a single verdict and zero or more findings.

- `BLOCK` — there is at least one finding that violates a hard quality rule with high confidence. Do not let the user commit/push/merge until it is addressed.
- `REQUEST_CHANGES` — there are concrete risks the user should fix or consciously accept before proceeding.
- `COMMENT` — there are observations. Not blocking; surface them, let the user decide.
- `APPROVE` — no risks detected within the configured constitution. This does **not** mean the change is correct overall — it means Revix's risk constitution found nothing to flag. Other checks (tests, type-checking, manual review) still apply.

Each finding cites a `file:line` and the quality rule it violates. Quote those in your response so the user can verify.

## Configuration

Project-level configuration lives at `.revix.yml` at the repository root. Common adjustments:

- Per-stage `budget` and `severity_floor` under `sources.working_tree`, `sources.staged`, `sources.pr`.
- Enable / disable individual reviewers under `reviewers.enabled` and `reviewers.disabled`.
- Extend the quality constitution under `quality.overrides`.

See [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md).

## Failure handling

- If `revix` is not installed, suggest `npm install -g revix` or `npx revix`.
- If the working tree has no changes, Revix returns `APPROVE` with zero findings. Surface that as "no uncommitted changes to review."
- If git is not initialised, surface the error to the user — Revix needs a git working copy for `--working-tree` and `--staged`.
- If a non-zero exit code is returned, the configured verdict gate has fired. Read the markdown output to determine the verdict.
