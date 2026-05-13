# Pull request review

Reviews a GitHub pull request. This is the original Revix invocation mode and
remains the canonical CI integration.

## When to use

- A pull request has been opened and CI should post a single risk-review
  comment.
- A reviewer or agent wants a one-shot risk read of a specific PR.

## Invocation

The standard path is the GitHub Action — see [docs/GITHUB_ACTION.md](../GITHUB_ACTION.md).

A direct CLI invocation against a curated payload is also supported:

```sh
revix review --input pr.json
revix review --diff sample.diff --metadata metadata.json
```

`pr.json` follows the
[PR input contract](../data-contracts.md). The GitHub Action does the same
shape conversion automatically from the live API.

## Behaviour

- Source: GitHub REST API (PR metadata, changed files, and diff).
- Comment marker: `<!-- revix-review -->`. The action upserts a single comment
  under that marker.
- Defaults are looser than working-tree mode: `budget = 6`,
  `severity_floor = MINOR`. Tunable under `sources.pr` in `.revix.yml`.

## Backwards-compatible config

The legacy top-level `labels:` block is still accepted and is automatically
mirrored into `sources.pr.labels` at load time. New configurations should use
the nested form:

```yml
sources:
  pr:
    labels:
      skip: [skip-revix]
      force_reviewers:
        force-security: [security]
```
