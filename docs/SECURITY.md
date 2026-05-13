# Security

Do not commit API keys, provider responses containing secrets, or private PR
fixtures.

Revix reads provider credentials from environment variables:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Provider and GitHub API errors are redacted where they pass through Revix error
handling, but callers should still avoid logging secrets in fixtures and config.

Report security issues privately to the repository maintainer.
