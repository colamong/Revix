# Risk-bench

Hand-curated synthetic cases used to score Revix's change-risk review quality.

## Layout

- `cases/` — one YAML file per case, validated by [schemas/risk-bench-case.schema.json](../../schemas/risk-bench-case.schema.json).
- `fixtures/golden.json` — reference findings keyed by `eval_id`. Used as a baseline so the bench can run without a live model.

## Running

```sh
revix eval risk-bench \
  --cases eval/risk-bench/cases \
  --case-findings eval/risk-bench/fixtures/golden.json \
  --report report.json
```

The CLI exits non-zero if `summary.hard_gated > 0` or `summary.median_rrs < 60`.

## Scope

v0.1 ships with 10 seed cases covering 8 risk types across 4 execution stages. The longer-term target is 30 cases; the gap is tracked as a follow-up. Add new cases by copying an existing YAML file and updating `eval_id`, `risk_type`, `execution_stage`, `changeset`, and the expectation lists.

## Baseline (v0.1)

After the v0.1 constitution gap-fill (4 new rules: `reliability.no_data_loss`, `reliability.no_unbounded_retries`, `performance.no_n_plus_one`, `observability.no_silent_regressions`), the golden-fixture baseline is:

- median RRS: **100**
- mean RRS: **100**
- must_recall pass rate: 1.0
- hard_gated: 0

This number is now produced by Revix's real decision pipeline, not by a stub. New cases that surface constitution gaps (rules that ought to exist but do not) will pull the baseline below 100 and that is expected — they signal `src/constitution/defaults.yml` needs to grow.

## Notes

- The bench loader does not validate that `quality_rule` references resolve to enabled rules. This is intentional: it lets case authors flag risk categories the constitution should grow to cover. The cost is that an author can typo a rule and silently get a fallback verdict.

## Authoring a case

Each case is a self-contained changeset plus expectation set:

- `eval_id` — unique slug, also the key in `fixtures/golden.json`.
- `risk_type` — one of `security`, `concurrency`, `data-loss`, `api-break`, `perf`, `observability`, `reliability`, `correctness`.
- `execution_stage` — one of `pre-commit`, `pre-push`, `pre-merge`, `pre-release`.
- `review_budget` — max non-noise findings expected for this case.
- `expected_verdict` — `APPROVE | COMMENT | REQUEST_CHANGES | BLOCK`.
- `changeset` — synthetic metadata, changed files, and unified diff.
- `must_find` — risks that must be raised. Each missing entry caps RRS at 60.
- `should_find` — risks that should be raised. Misses reduce score but don't gate.
- `allowed_find` — risks that are acceptable to raise without penalty.
- `forbidden_find` — patterns of findings that are out of scope and reduce precision.

Match logic uses fuzzy token overlap against `summary_hint`, plus optional `quality_rule` and `evidence_files` filters.
