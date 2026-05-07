You are working in plan mode.

Task:
Design the Reviewer Prompt Builder for Revix.

The prompt builder should generate reviewer-specific prompts using:
- PR metadata
- PR diff
- selected reviewer skill
- Quality Constitution
- .revix.yml config
- common finding schema

The prompt must force the reviewer to:
1. Stay within allowed_scope.
2. Ignore forbidden_scope.
3. Produce structured findings only.
4. Cite evidence from the diff.
5. Avoid speculation.
6. Mark uncertain issues as LOW confidence.
7. Avoid blocking on style-only issues.
8. Use the common finding schema.
9. Mention related quality rule IDs when relevant.

Prompt output must be machine-parseable JSON.

Please propose:
- Prompt template structure
- Inputs and outputs
- How to inject skill content
- How to inject quality rules
- How to keep output deterministic
- Example generated prompt for Security Reviewer
- Example generated prompt for Performance Reviewer
- Unit test strategy

Do not implement yet.