# GitHub Action

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
          comment: "true"
```

Inputs:

- `provider`: `mock`, `openai`, or `anthropic`
- `model`: model name for real providers
- `config-path`: project root containing `.revix.yml`
- `dry-run`: render without posting comments or failing
- `fail-on-request-changes`: override verdict failure behavior
- `comment`: post or update one PR comment

The action updates a single comment containing `<!-- revix-review -->`.
