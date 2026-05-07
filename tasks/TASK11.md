You are working in plan mode.

Task:
Design the Revix CLI.

Revix should be usable locally before GitHub Action integration.

Required commands:
1. revix init
2. revix check
3. revix review
4. revix validate
5. revix explain

Command behavior:

revix init:
- Create a default .revix.yml.
- Optionally create example skill override files.
- Should not overwrite existing files unless explicitly forced.

revix check:
- Validate .revix.yml.
- Validate built-in and custom skill files.
- Validate Quality Constitution rules.
- Print clear errors and warnings.

revix review:
- Accept PR diff input.
- Accept optional PR metadata input.
- Run the full review pipeline.
- Support output formats: markdown, json, github-comment.
- Support dry-run mode.
- Support mock mode for deterministic local testing.

revix validate:
- Validate a reviewer output JSON file against the finding schema.
- Validate conflict records and final review output.

revix explain:
- Explain which reviewers would run for a given PR metadata/diff.
- Explain which rules caused the final verdict.

Suggested command examples:
- revix init
- revix check
- revix review --diff ./examples/sample.diff --output markdown
- revix review --diff ./examples/sample.diff --metadata ./examples/pr.json --mock
- revix validate --findings ./examples/findings.json
- revix explain --diff ./examples/sample.diff

Please propose:
- CLI architecture
- Command structure
- Required flags
- Error handling
- Exit codes
- Output behavior
- Config loading behavior
- Test strategy

Do not implement yet.