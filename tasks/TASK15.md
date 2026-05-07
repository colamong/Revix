You are working in plan mode.

Task:
Finalize the Revix v0.1 MVP implementation plan.

Revix v0.1 should be the smallest useful open-source version.

MVP must include:
1. .revix.yml config loading
2. Default Quality Constitution
3. Common finding schema
4. Built-in reviewer skill definitions
5. PR classifier
6. Reviewer selector
7. Prompt builder
8. Mock provider
9. Reviewer output validation
10. Conflict detector
11. Basic negotiation option generation
12. Option evaluator
13. Final composer
14. Output formatter
15. CLI command: revix review
16. CLI command: revix check
17. Fixtures and deterministic tests

MVP can defer:
- Real OpenAI/Anthropic provider implementation
- GitHub Action publishing
- Inline PR comments
- Dashboard UI
- Persistent review history
- Learning from past reviews
- Advanced semantic conflict detection
- Parallel reviewer execution
- Auto-fix PR generation

Implementation constraints:
- Keep dependencies minimal.
- Prefer explicit schemas and types.
- Keep all outputs machine-parseable before formatting.
- No project-private assumptions.
- All examples must be safe for open source.
- Use mock provider for deterministic tests.

Please propose:
- Final module structure
- File-by-file implementation plan
- Implementation order
- Acceptance criteria
- Test checklist
- CLI examples
- Known limitations
- Risks
- What to defer to v0.2

Do not implement yet.