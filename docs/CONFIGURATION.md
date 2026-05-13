# Configuration

Revix reads `.revix.yml` from the project root.

```yml
reviewers:
  enabled: []
  disabled: []
skills:
  paths: []
paths:
  ignored: []
labels:
  skip: [skip-revix]
  force_reviewers:
    force-security: [security]
output:
  format: github-comment
provider:
  name: mock
  fixture_dir: .revix/mock-provider
  model: ""
  temperature: 0
  timeout_ms: 60000
  max_retries: 0
  max_output_tokens: 4096
verdict:
  fail_on_request_changes: true
```

`skills.paths` lists additional directories containing `*.reviewer.yml` files.
Relative paths resolve from the project root.

`provider.model` is required for `openai` and `anthropic`.
