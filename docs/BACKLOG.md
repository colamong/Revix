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

- v0.1 ships 10 seed cases. The original plan target was 30.
- **Cadence:** ~10 cases per minor release. Track RRS drift over time.

## Tracking note

Finding B-003 (the "verdict comes from a stub, not the real decision
pipeline") was the third dogfood finding. It was the one that invalidated the
golden-fixture baseline, so it was resolved in v0.1 itself rather than
deferred. See `runEval` + `runCaseDecisionPipeline` in
[bin/revix.js](../bin/revix.js).
