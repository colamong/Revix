# Dogfooding Revix on its own working tree

The `scripts/dogfood-working-tree.mjs` driver runs `revix review --working-tree`
against the repo's current uncommitted edits, using the local `codex` CLI as
the model backend for every selected reviewer. We use it to catch regressions
in Revix itself before shipping a release — the v0.1.1 dogfood found 6
real issues that became the v0.1.1 patches.

## Prerequisites

- `codex` CLI on `PATH` (verified with `codex --version`).
- The repo's working tree contains the changes you want reviewed
  (`git status` will show them).

## Run

```sh
npm run dogfood
# or, with a summary report file:
npm run dogfood -- --output dogfood-report.json
# or, restrict to a subset of reviewers (slower runs only one or two at a time):
npm run dogfood -- --reviewer security,reliability
```

stdout is the rendered review markdown. stderr is a per-reviewer trace plus a
final verdict line; warnings about findings dropped by reviewer-scope
validation (off-scope tags / quality rules) appear here too. When `--output`
is supplied, a structured JSON summary is also written.

## What it does, briefly

1. Collects the working-tree changeset via `collectWorkingTreeChangeset`
   (includes untracked files).
2. For each reviewer selected by Revix, builds the same reviewer prompt the
   normal pipeline would, then pipes it to `scripts/codex-eval-runner.mjs`.
3. Feeds the parsed findings back into `runRevixReview` so conflict
   detection, synthesis, and the final decision pipeline still apply.

## Cost / runtime notes

- Codex is invoked once per selected reviewer, sequentially.
- A full dogfood pass on this repo takes ~6-12 minutes on a non-trivial
  working tree (7 reviewers, ~30-120s each). Use `--reviewer` to narrow.
- Codex runs read-only and ephemeral; it cannot touch the working tree.
