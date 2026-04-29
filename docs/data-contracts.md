# Data Contracts

Runtime validators are the source of truth for v1. JSON Schemas in `schemas/`
are published contract artifacts and are checked for valid JSON in the test
suite.

## Revix Config

Implemented in `src/config/`.

`.revix.yml` supports:

- `reviewers.enabled`, `reviewers.disabled`
- `skills.paths`
- `quality.extends`, `quality.overrides`
- `paths.contracts`, `paths.ignored`, `paths.security_sensitive`,
  `paths.performance_sensitive`
- `selection.rules`
- `severity.overrides`
- `labels.skip`, `labels.force_reviewers`
- `output.format`
- `verdict.fail_on_request_changes`

Compatibility aliases are accepted for earlier modules:

- `reviewer_skills.enabled` and `reviewer_skills.disabled`
- `constitution` mapped into `quality.overrides`

## PR Input

Implemented in `src/pr-input/`.

Required input:

- `metadata`: repo, number, title, body, author, labels, base/head refs
- `changed_files`: path, status, additions, deletions, optional patch,
  previous path, binary flag
- `raw_diff`: optional unified diff string

The validator returns parsed diff files and hunks with line-level entries that
preserve added/deleted/context line numbers for finding evidence.

## PR Classification

Implemented in `src/classification/`.

Output:

- `primary_type`
- `secondary_types`
- `signals`
- `confidence`
- `rationale`

Classification is deterministic and uses labels, changed paths, file extensions,
title keywords, and configured sensitive path patterns.

## Reviewer Selection

Implemented in `src/reviewer-selection/`.

Output per selected reviewer:

- `reviewer_id`
- `reason`
- `matched_signals`
- `skill`
- `scope_context`

`scope_context` is passed directly to finding validation and contains reviewer
ID, allowed tags, allowed quality rules, and effective quality rules.

## Finding

Implemented in `src/findings/`.

Required fields:

- `finding_id`
- `reviewer_id`
- `severity`
- `claim`
- `evidence`
- `impact`
- `suggested_fix`
- `verification_test`
- `confidence`
- `related_quality_rules`
- `tags`

Optional field:

- `evidence_refs`

Findings are evidence-based and validated against reviewer scope and effective
quality rules.

## Conflict

Implemented in `src/conflicts/`.

Conflict output:

- `conflict_id`
- `type`
- `finding_ids`
- `summary`
- `evidence_refs`
- `resolution_required`

Current conflict detection is deterministic and conservative. It covers severity
mismatch, claim contradiction, incompatible fixes, scope conflict, and confidence
conflict.

## Synthesis Option

Implemented in `src/synthesis/`.

Output:

- `option_id`
- `strategy`
- `summary`
- `finding_ids`
- `conflict_ids`
- `recommended_actions`
- `tradeoffs`
- `confidence`

Strategies are deterministic: `request_fix`, `ask_clarification`,
`comment_only`, and `resolve_conflict`.

## Final Judgment

Implemented in `src/decision/`.

Output:

- `verdict`
- `passed`
- `selected_option_ids`
- `blocking_finding_ids`
- `non_blocking_finding_ids`
- `conflict_ids`
- `constitution_evaluation`
- `warnings`

The decision module converts findings and conflicts into Quality Constitution
violations, then delegates rule severity and verdict behavior to
`evaluateConstitution()`.

## GitHub Comment

Implemented in `src/renderers/github-comment/`.

Output:

- `format`
- `markdown`
- `json`

The renderer only produces a comment body and render object. It does not call the
GitHub API.

## Orchestrator Result

Implemented in `src/orchestrator/`.

Top-level output:

- `prInput`
- `classification`
- `selectedReviewers`
- `reviewerRun`
- `conflicts`
- `synthesisOptions`
- `finalDecision`
- `output`

Reviewer execution remains injectable. The default runner emits no findings, and
CLI fixture mode can read reviewer outputs from JSON for local testing.
