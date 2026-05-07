You are working in plan mode.

Task:
Implement real LLM provider support for Revix.

Goal:
Add provider adapters while keeping mock provider as the default for tests.

Providers:
1. OpenAI
2. Anthropic
3. Mock

Requirements:
- Provider interface must stay stable.
- Provider secrets must come from environment variables.
- Provider outputs must be schema-validated.
- Provider errors must be safe and readable.
- Temperature should default to 0.
- Timeout and retry options should be configurable.
- Logs must redact API keys and sensitive values.

Config example:
provider:
  name: openai
  model: gpt-5.5
  timeout_ms: 60000
  max_retries: 2

Please propose:
- Files to add or modify
- Provider adapter design
- Config updates
- Error handling
- Retry/timeout behavior
- Tests with mocked API calls
- Documentation updates

Do not implement until the plan is approved.