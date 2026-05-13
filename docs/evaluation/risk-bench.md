# Risk-bench

The primary evaluation surface for Revix. Replaces the SWE-PRBench-style
comparative score as the headline metric.

## Why risk-bench replaces RQS

The previous RQS metric compared Revix findings to human PR comments from
SWE-PRBench. That biased Revix toward mimicking reviewer style: a valid,
risk-reducing finding that the human reviewer happened not to mention was
counted as a false positive. Risk-bench scores on the basis of risk reduction
itself — labelled `must_find` / `should_find` items the change actually
introduces — rather than reviewer-comment matching.

## Score: RRS

Risk Reduction Score (RRS), 0–100. Weighted composite of:

| Sub-metric            | Weight | What it catches                                     |
| --------------------- | -----: | --------------------------------------------------- |
| `must_recall`         |   0.30 | Missing critical risks                              |
| `should_recall`       |   0.15 | Missing useful risks                                |
| `forbidden_precision` |   0.20 | Out-of-scope findings (style, nits)                 |
| `budget_adherence`    |   0.10 | Over-eager / too-many findings                      |
| `verdict_correctness` |   0.15 | Wrong APPROVE / COMMENT / REQUEST_CHANGES / BLOCK   |
| `evidence_quality`    |   0.10 | Findings without file:line citation                 |

If `must_recall < 1.0` for a case, RRS for that case is hard-capped at 60. This
prevents shipping a build that misses critical risks regardless of how clean
the rest of the review is.

## Match logic

A Revix finding matches an expected `must_find` / `should_find` / `allowed_find`
entry when all of the following hold:

- If the entry specifies `quality_rule`, the finding's `related_quality_rules`
  includes that rule (or a dotted child of it).
- If the entry specifies `evidence_files`, the finding's `evidence.file_path`
  matches one of them (suffix-match also accepted to tolerate path prefixes).
- If the entry specifies `summary_hint`, fuzzy token overlap between the hint
  and the finding's `claim` is at least 40% of meaningful tokens.

For `forbidden_find`, patterns use glob-style matching against
`related_quality_rules` (`pattern_quality_rule`) and substring matching against
the claim (`pattern_summary`).

## Case schema

See [schemas/risk-bench-case.schema.json](../../schemas/risk-bench-case.schema.json)
and [eval/risk-bench/README.md](../../eval/risk-bench/README.md) for the
case-authoring guide.

## Running the bench

```sh
revix eval risk-bench \
  --cases eval/risk-bench/cases \
  --case-findings eval/risk-bench/fixtures/golden.json \
  --report report.json
```

The CLI exits non-zero if `summary.hard_gated > 0` or
`summary.median_rrs < 60`.

## v0.1 status

The v0.1 seed bench ships 10 hand-curated cases covering 8 risk types across 4
execution stages. The longer-term target is 30 cases; new cases are added by
copying an existing YAML and updating the fields. The bench grows over time and
tracks RRS regression per release.
