You are working in plan mode.

Task:
Design the PR Classifier and Reviewer Selector for Revix.

The classifier should inspect:
- PR title
- PR body
- changed files
- diff summary
- labels
- .revix.yml rules

PR types:
- feature
- bugfix
- refactor
- infra
- security
- contract
- test
- docs
- performance
- reliability

Reviewer selection should be config-driven.

Default selection examples:
- security PR -> security, test, reliability
- contract PR -> contract, test, documentation
- infra PR -> security, reliability, observability
- performance PR -> performance, reliability, test
- refactor PR -> architecture, test, readability
- docs PR -> documentation only unless contract files changed

Please propose:
- Input schema
- Output schema
- Classification rules
- Reviewer selection mapping
- Label override behavior
- Confidence handling
- Fallback behavior
- Unit test cases

Do not implement yet.