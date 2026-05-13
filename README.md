# Revix

A change-risk review engine for code changes, packaged as a skill for AI coding
agents (Claude Code, Codex) and as a CLI / GitHub Action. Revix focuses on
high-signal, low-noise risk detection: it flags security, concurrency, data-loss,
API-break, performance, observability, reliability, and correctness risks — and
intentionally stays out of style, naming, and docstring nits.

## What Revix is

- A reviewer that runs at concrete decision points: **before committing**,
  **before pushing**, **before merging**, **before releasing**.
- An engine built on a configurable quality constitution and 10 focused reviewer
  modules (security, reliability, performance, concurrency, contract, etc.).
- Evidence-grounded: every finding cites a `file:line` and a quality rule.

## What Revix is not

- A general "review my whole codebase" agent.
- A style or formatting linter.
- A merge bot. It produces a recommendation; humans (or CI gates) act on it.

## Modes

| Stage                      | Command                                            |
| -------------------------- | -------------------------------------------------- |
| Working tree (uncommitted) | `revix review --working-tree`                      |
| Staged (git index)         | `revix review --staged`                            |
| Pull request               | GitHub Action (see [docs/GITHUB_ACTION.md](docs/GITHUB_ACTION.md)) |

Commit, branch-diff, and release-range modes are slated for v0.2.

## Quick Start

```sh
npm install
node bin/revix.js init           # writes a default .revix.yml
node bin/revix.js check          # validates config and reviewers
node bin/revix.js review --working-tree --format markdown
```

For deterministic local runs, use the mock provider:

```sh
node bin/revix.js review \
  --input test/fixtures/e2e-pr-input.json \
  --mock-fixture-dir test/fixtures/mock-provider \
  --format github-comment \
  --dry-run
```

## Use as a Claude Code / Codex skill

Install [`skills/change-risk-review/`](skills/change-risk-review/) into your
agent's skill directory. The skill triggers on phrases like "before committing
this," "is this safe to push," and "any risks I'm missing." It wraps the same
`revix review` CLI used above and returns the verdict and findings to the agent.

See [skills/change-risk-review/SKILL.md](skills/change-risk-review/SKILL.md).

## Providers

Revix supports `mock`, `openai`, and `anthropic`.

```yml
provider:
  name: openai
  model: gpt-5.5
  temperature: 0
  timeout_ms: 60000
  max_retries: 2
  max_output_tokens: 4096
```

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for real provider runs. Revix does
not pick a default real model because availability changes over time.

## GitHub Action

```yml
name: Revix
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: colamong/Revix@v0.2
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        with:
          provider: openai
          model: gpt-5.5
```

The action posts or updates one PR comment marked with `<!-- revix-review -->`.

## Risk-bench evaluation

Revix is evaluated against hand-curated synthetic cases that label the risks a
change must surface (`must_find`), should surface (`should_find`), and must not
surface (`forbidden_find`). The headline metric is the **Risk Reduction Score
(RRS)**: a 0–100 composite of recall, precision against out-of-scope findings,
budget adherence, verdict correctness, and evidence quality. Missing any
`must_find` item hard-caps RRS at 60.

```sh
node bin/revix.js eval risk-bench \
  --cases eval/risk-bench/cases \
  --case-findings eval/risk-bench/fixtures/golden.json \
  --report report.json
```

See [eval/risk-bench/README.md](eval/risk-bench/README.md) and
[docs/evaluation-strategy.md](docs/evaluation-strategy.md).

The legacy SWE-PRBench-style comparative evaluation
(`src/evaluation/comparative.js`) is retained as an internal regression check
but is no longer the headline metric — it rewards mimicking human PR comments,
not reducing change risk.

## Reviewer modules

The 10 built-in reviewer modules live in `src/reviewer-skills/builtin/v1`. Each
module owns a narrow scope (security, reliability, performance, etc.). Project
modules can extend or override these:

```sh
node bin/revix.js skill init ai-prompts
node bin/revix.js check
```

Project modules are loaded from `.revix/reviewer-skills` and any directories in
`skills.paths`.

## Documentation

- [Quickstart](docs/QUICKSTART.md)
- [Configuration](docs/CONFIGURATION.md)
- [Reviewer Modules](docs/SKILLS.md)
- [Quality Constitution](docs/QUALITY_CONSTITUTION.md)
- [GitHub Action](docs/GITHUB_ACTION.md)
- [Providers](docs/PROVIDERS.md)
- [Examples](docs/EXAMPLES.md)
- [Risk-bench](eval/risk-bench/README.md)
- [Change-risk-review skill](skills/change-risk-review/SKILL.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Security](docs/SECURITY.md)
- [Changelog](docs/CHANGELOG.md)
- [Backlog](docs/BACKLOG.md)
