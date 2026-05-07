# Revix

Revix is an AI-powered PR review orchestrator for producing evidence-based,
consensus-oriented GitHub PR review comments.

The project is prepared for spec-driven development with GitHub Spec Kit. Product
logic should be introduced through the Spec Kit flow:

1. `$speckit-constitution` to refine quality principles.
2. `$speckit-specify` to define the feature.
3. `$speckit-plan` to choose the implementation approach.
4. `$speckit-tasks` to produce implementation tasks.
5. `$speckit-implement` to build from the approved task list.

Planning references live in `docs/`. The canonical Spec Kit constitution lives
in `.specify/memory/constitution.md`.

## Local Usage

Run the full deterministic pipeline with a PR input fixture:

```sh
npm test
node bin/revix.js check
node bin/revix.js review --input test/fixtures/e2e-pr-input.json
```

For local reviewer-output fixtures, pass structured findings as JSON:

```sh
node bin/revix.js \
  review \
  --input test/fixtures/e2e-pr-input.json \
  --project-root test/fixtures/e2e-project \
  --reviewer-output test/fixtures/e2e-reviewer-output-blocking.json \
  --format github-comment
```

For fixture-backed mock provider runs, put reviewer findings in
`<fixture-dir>/<reviewer_id>.json` or `<fixture-dir>/findings.json` and run:

```sh
node bin/revix.js review \
  --input test/fixtures/e2e-pr-input.json \
  --mock-fixture-dir test/fixtures/mock-provider \
  --dry-run
```

The v0.1 CLI supports `review` and `check`. It renders Markdown, JSON, or a
GitHub-comment-shaped Markdown body. It does not call external AI providers or
post comments to GitHub.
