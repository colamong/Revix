# Quickstart

## Local Review

```sh
npm install
node bin/revix.js init
node bin/revix.js check
node bin/revix.js review --input test/fixtures/e2e-pr-input.json --dry-run
```

## Mock Provider

Use mock fixtures for deterministic tests and demos:

```sh
node bin/revix.js review \
  --input test/fixtures/e2e-pr-input.json \
  --mock-fixture-dir test/fixtures/mock-provider \
  --format github-comment \
  --dry-run
```

## Real Provider

```sh
set OPENAI_API_KEY=...
node bin/revix.js review --input pr.json --project-root . --format github-comment
```

Configure `.revix.yml` with `provider.name` and `provider.model` first.
