# Providers

Revix supports three providers:

- `mock`: deterministic fixture-backed reviews
- `openai`: OpenAI Responses API
- `anthropic`: Anthropic Messages API

OpenAI uses `OPENAI_API_KEY`. Anthropic uses `ANTHROPIC_API_KEY`.

```yml
provider:
  name: anthropic
  model: claude-sonnet-4-5
  temperature: 0
  timeout_ms: 60000
  max_retries: 2
  max_output_tokens: 4096
```

Provider output must be a JSON array of Revix findings. Revix validates findings
against reviewer scope and quality rules before composing the final review.
