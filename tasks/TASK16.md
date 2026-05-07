Proceed with implementation based on the approved Revix v0.1 MVP plan.

Implementation rules:
- Keep the MVP small and explicit.
- Implement only the approved v0.1 scope.
- Do not add real LLM provider calls yet unless already planned.
- Use mock provider fixtures for deterministic behavior.
- Add schema validation for config, skills, findings, conflicts, and final output.
- Add tests for every core module.
- Add CLI commands: revix review and revix check.
- Do not implement GitHub Action publishing yet.
- Do not include any company-private assumptions or examples.
- Keep all sample diffs and fixtures generic.

After implementation, provide:
1. Changed files list
2. Key design decisions
3. Commands to run tests
4. Example revix review command
5. Example output summary
6. Known limitations
7. Suggested next tasks for v0.2