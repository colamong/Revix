# Examples

## Explain Local Fixture

```sh
node bin/revix.js review --input test/fixtures/e2e-pr-input.json --dry-run
```

## JSON Output

```sh
node bin/revix.js review \
  --input test/fixtures/e2e-pr-input.json \
  --format json \
  --dry-run
```

## Separate Diff and Metadata

```sh
node bin/revix.js review \
  --diff sample.diff \
  --metadata pr-metadata.json \
  --project-root . \
  --dry-run
```

## Add a Reviewer Skill

```sh
node bin/revix.js skill init ai-prompts
node bin/revix.js check
```
