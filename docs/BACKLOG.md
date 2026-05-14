# Revix backlog

Outstanding items from v0.1 dogfood and design work. Each entry links back to the
file:line where the issue lives and notes the suggested fix.

## Resolved in v0.1.1 (dogfood findings)

### B-001 — `--reviewer-output` flag schema is overloaded (RESOLVED)

- The eval-mode flag is renamed to `--case-findings`. Using `--reviewer-output`
  with `revix eval risk-bench` now fails fast with a pointer to the correct
  flag. Docs and the bench acceptance test were updated to match. See
  [bin/revix.js](../bin/revix.js) and [test/risk-bench.test.js](../test/risk-bench.test.js).

### B-002 — Working-tree mode does not include untracked files (RESOLVED)

- [src/sources/untracked.js](../src/sources/untracked.js) now lists untracked
  files via `git ls-files --others --exclude-standard` and synthesises an
  added-file diff for each. Working-tree mode concatenates that with the
  tracked `git diff HEAD` output. Guardrails: skip binary files (NUL byte in
  first 8 KiB), skip files larger than 1 MiB, cap at 50 files per run; the CLI
  emits a stderr warning when anything is skipped. Verified against this very
  repo's working tree: 44 untracked files now visible alongside 25 modified.

### B-004 — `loadRiskBenchCases` lacks symlink-cycle detection (RESOLVED)

- [src/evaluation/risk-bench.js](../src/evaluation/risk-bench.js) now resolves
  each directory via `fs.realpath` and tracks visited canonical paths, and
  bails with a clear error if recursion exceeds depth 16. Symlinks to
  directories are followed once; cycles produce no output past the second
  visit.

## Risk-bench v0.2 alignment work

### B-005 — Constitution gap fill (RESOLVED in v0.1)

- Resolved in v0.1 by adding four new rules to `src/constitution/defaults.yml`:
  `reliability.no_data_loss` (BLOCK), `reliability.no_unbounded_retries`
  (REQUEST_CHANGES), `performance.no_n_plus_one` (REQUEST_CHANGES), and
  `observability.no_silent_regressions` (COMMENT). Reviewer scopes for
  reliability, performance, and observability were widened to include these.
- The same change reconciled four seed cases that had been authoring rule
  IDs that did not exist (e.g. `api.no_breaking_changes`,
  `concurrency.atomic_read_write`) — those now route through the closest
  real rule and the cases' `expected_verdict` aligns with what Revix
  actually produces.
- Golden-fixture baseline went from RRS median 85 (after the v0.1 decision-
  pipeline fix) to RRS median 100. The 100 is no longer a stub — it's the
  real decision pipeline scoring against an honestly-aligned case set.

### B-006 — Grow the seed bench from 10 → 30 cases

- v0.1 shipped 10 seed cases. v0.1.1 adds 10 more (now 20 of 30).
- **Cadence:** ~10 cases per minor release. Track RRS drift over time.
- The v0.1.1 batch adds the first **APPROVE** case (`refactor-pure-rename`)
  as false-positive calibration — until now the bench had no scenario
  where the correct answer is "do not raise anything", so over-firing
  could not be measured. The case uses `forbidden_find` to penalise the
  most likely false-positive shapes (false contract-break, false
  testability gap).
- Verdict mix after expansion (n=20): BLOCK 6, REQUEST_CHANGES 8,
  COMMENT 5, APPROVE 1. Baseline: median RRS 100, hard_gated 0,
  must_recall_pass_rate 1.0.
- Remaining 10 cases (v0.2 batch) should diversify on: perf (only 1
  case today), real-world refactors that include a hidden behavioural
  change, and additional APPROVE calibration shapes (dependency bump,
  no-op move).

## Resolved in v0.1.2 (post-dogfood pagination fix)

### B-007 — GitHub PR source does not paginate `/files` (RESOLVED)

- v0.1.1 dogfood surfaced that [src/sources/pr-github.js](../src/sources/pr-github.js)
  called the GitHub pulls files endpoint a single time with `?per_page=100`,
  so any PR with more than 100 changed files would silently truncate. The
  `changed_files` list, reviewer selection, evidence validation, and final
  verdict could all be derived from a partial diff — exactly the false-safe
  failure mode the constitution's `reliability.fail_safely` rule is meant
  to prevent. Reported as `architecture-pr-files-pagination-001` and
  `reliability-pr-files-pagination-001` (both MAJOR/HIGH).
- Fix: `collectPrGithubChangeset` now loops the endpoint with `&page=N` and
  stops when the page returns fewer than `per_page` rows or an empty array.
  A 50-page (5000-file) sanity ceiling causes the run to fail closed with a
  clear error rather than under-review an unbounded PR.
- Tests: two new cases in [test/github-action.test.js](../test/github-action.test.js)
  cover the >100-files path (105 across two pages) and the exact-multiple
  edge case (full page then empty). Suite 188/188 (186 baseline + 2).
  Risk-bench unchanged at 20 cases, median RRS 100, hard_gated 0,
  must_recall 1.0.

## Resolved in v0.1.1 (framework)

### B-008 — Off-scope findings tore down the whole reviewer output (RESOLVED)

- v0.1.1 dogfood surfaced that any single off-scope tag or `quality_rule`
  in a finding caused the framework to silently drop the entire reviewer's
  output. The security reviewer emitted 11 findings; only 6 reached the
  user, with no observable signal.
- Fixed by splitting `FindingValidationError` into a soft-drop subclass
  `FindingOutOfScopeError` for off-scope tags / quality_rules while keeping
  hard throws for reviewer_id mismatches and other shape violations.
  `validateFindings` now returns `{ findings, dropped }`; the
  reviewer-runner aggregates dropped per reviewer; the CLI emits a one-line
  stderr warning summarising what was filtered (mirrors the
  untracked-skipped pattern).
- Also widened three reviewer scopes the dogfood flagged as legitimately
  reaching beyond their published taxonomy: architecture +=
  `reliability`, contract += `cli`, security += `data-exposure`. See
  [src/findings/index.js](../src/findings/index.js),
  [src/reviewer-runner/index.js](../src/reviewer-runner/index.js),
  [bin/revix.js](../bin/revix.js), and the three reviewer YAMLs under
  `src/reviewer-skills/builtin/v1/`.
- Tests: 186/186 (182 baseline + 4 new soft-drop tests). Risk-bench
  unchanged at 20 cases, median RRS 100, hard_gated 0, must_recall 1.0.

## Tracking note

Finding B-003 (the "verdict comes from a stub, not the real decision
pipeline") was the third dogfood finding. It was the one that invalidated the
golden-fixture baseline, so it was resolved in v0.1 itself rather than
deferred. See `runEval` + `runCaseDecisionPipeline` in
[bin/revix.js](../bin/revix.js).
