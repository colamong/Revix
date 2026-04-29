# Revix Quality Constitution

## Core Principles

### I. Evidence Before Opinion
Every review output must be grounded in PR metadata, diff evidence, repository
context, or explicit uncertainty. A finding without inspectable evidence is not
eligible for final judgment.

### II. Reviewers Produce Claims, Not Verdicts
Reviewer roles identify risks and produce structured claims. They do not make
the final decision, override other reviewers, or silently suppress conflicting
claims.

### III. Findings Must Be Actionable
Each finding must include claim, evidence, impact, test, fix, confidence, and
severity. Missing required fields must be treated as a quality failure in the
review output.

### IV. Conflicts Require Structured Negotiation
Reviewer disagreement must be represented explicitly as a conflict with the
competing claims, evidence, assumptions, and possible synthesis options. Conflicts
must not be resolved by reviewer priority alone.

### V. Final Judgment Follows Fixed Quality Rules
The final PR review comment must be based on stable quality rules, not ad hoc
model preference. Severity, confidence, evidence strength, and testability are
required inputs to the final decision.

## Development Constraints

- Keep PR review orchestration separate from individual reviewer logic.
- Prefer explicit data contracts for all intermediate artifacts.
- Treat malformed, low-evidence, or low-confidence findings as first-class cases.
- Preserve enough traceability to explain how the final GitHub comment was formed.

## Review Workflow

The intended pipeline is: PR metadata and diff input, PR type classification,
reviewer selection, reviewer-specific analysis, claim normalization, conflict
detection, synthesis option generation, constitution evaluation, and GitHub PR
comment rendering.

## Governance

This constitution is the source of truth for Revix quality decisions. Changes to
these principles must be made through the Spec Kit constitution workflow and
reflected in documentation and tests when implementation exists.

**Version**: 0.1.0 | **Ratified**: 2026-04-29 | **Last Amended**: 2026-04-29
