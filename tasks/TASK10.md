You are working in plan mode.

Task:
Design the Final Review Composer and Output Formatter for Revix.

The composer should generate final review output from:
- PR classification
- selected reviewers
- reviewer findings
- detected conflicts
- negotiated options
- selected options
- Quality Constitution evaluation

Supported output formats:
1. markdown
2. json
3. github-comment markdown

Markdown format:

## Verdict
APPROVE | COMMENT | REQUEST_CHANGES

## Summary
Short summary of the review result.

## Required Changes
BLOCKER and MAJOR findings that must be fixed.

## Negotiated Decisions
Conflicts and selected compromise options.

## Suggested Improvements
MINOR, QUESTION, and NIT findings.

## Missing Tests
Required or recommended tests.

## Quality Constitution Check
Hard constraints passed or failed.

## Final Recommendation
Clear merge recommendation.

Verdict rules:
- Any unresolved hard constraint violation -> REQUEST_CHANGES
- Any BLOCKER -> REQUEST_CHANGES
- MAJOR findings may produce REQUEST_CHANGES depending on config
- Only MINOR/QUESTION/NIT -> COMMENT
- No findings -> APPROVE

Rules:
- Do not expose internal chain-of-thought.
- Do not overstate LOW confidence findings.
- Do not block on style-only issues.
- Keep GitHub comments concise.
- JSON output must remain machine-parseable.

Please propose:
- Input schema
- Output schema
- Markdown format
- JSON format
- GitHub comment format
- Verdict rules
- Grouping strategy
- Snapshot test strategy
- Example output

Do not implement yet.