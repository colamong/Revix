You are working in plan mode.

Task:
Design the LLM Provider Abstraction for Revix.

Revix should not be tied to one LLM provider.

Supported provider design should allow:
- OpenAI
- Anthropic
- local/mock provider
- future providers

MVP requirement:
- mock provider must exist for deterministic tests.
- real provider integration can be minimal or behind interfaces.
- provider output must be validated against Revix schemas.

Provider responsibilities:
1. Accept a prompt and provider options.
2. Return raw model output.
3. Parse or expose structured JSON.
4. Report token/cost metadata when available.
5. Surface provider errors safely.
6. Never leak secrets into logs.

Provider config example:
provider:
  name: openai
  model: gpt-5.5
  temperature: 0
  timeout_ms: 60000
  max_retries: 2

Mock provider config example:
provider:
  name: mock
  fixture_dir: examples/mock-responses

Please propose:
- Provider interface
- Provider config schema
- Mock provider design
- Error handling
- Retry behavior
- Timeout behavior
- JSON parsing strategy
- Schema validation behavior
- Logging redaction
- Unit test strategy

Do not implement yet.