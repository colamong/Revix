# Quality Constitution

The canonical constitution lives in `.specify/memory/constitution.md`. This file
summarizes the project-specific quality rules for planning and discussion.

## Evidence-First Rule

Review findings must be grounded in PR metadata, diff lines, repository context,
or an explicit statement of uncertainty.

## Reviewer Role Rule

Reviewers produce evidence-based claims. They are not judges and must not make
the final merge/block decision.

## Finding Shape

Each finding must include:

- Claim
- Evidence
- Impact
- Test
- Fix
- Confidence
- Severity

## Conflict Rule

Conflicts between reviewers must be represented explicitly and resolved through
structured negotiation. Priority override is not a sufficient resolution model.

## Final Judgment Rule

Final decisions must be based on fixed quality rules that consider evidence
strength, impact, severity, confidence, testability, and available fixes.
