# Review Tuning Rationale

This document records numeric tuning decisions for Revix review evaluation. Do
not change numeric review tuning parameters unless the change is recorded here
with a source, local evidence, expected effect, and rollback condition.

## Source Basis

- SWE-PRBench is a public PR-review benchmark of 350 real merged pull requests
  with human reviewer comments as ground truth. It is useful for PR review
  alignment, but local results are only comparable when the dataset version,
  judge, prompt, and scoring protocol are held stable.
  Source: https://arxiv.org/abs/2603.26130 and
  https://huggingface.co/datasets/foundry-ai/swe-prbench
- Precision is `tp / (tp + fp)`, recall is `tp / (tp + fn)`, and F1 is the
  harmonic mean of precision and recall. Tuning should consider both false
  positives and misses.
  Source: https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_score.html,
  https://scikit-learn.org/stable/modules/generated/sklearn.metrics.recall_score.html,
  and https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_recall_fscore_support.html
- Threshold selection is separate from producing scores and should be tuned on
  validation data, not on the same holdout used for final claims.
  Source: https://scikit-learn.org/stable/modules/classification_threshold.html
- Repeated adaptive tuning against a leaderboard or holdout can overfit that
  benchmark. Treat local benchmark gains as hypotheses until they survive a
  held-out run and spot human review.
  Source: https://proceedings.mlr.press/v37/blum15.html and
  https://jmlr.csail.mit.edu/beta/papers/v11/cawley10a.html
- LLM-as-judge and model-comparison evals can be affected by rubric, position,
  verbosity, and model bias. Evaluation reports should state sample size,
  judge/model, rubric version, and limitations.
  Source: https://arxiv.org/abs/2306.05685,
  https://arxiv.org/abs/2305.17926,
  https://developers.openai.com/api/docs/guides/evaluation-best-practices,
  and https://platform.claude.com/docs/en/test-and-evaluate/develop-tests

## Local Calibration Evidence

The current converted SWE-PRBench data at
`eval-data/swe-prbench/converted/eval-cases.json` contains 350 cases. The
expected issue-count distribution is:

| Field | P50 | P75 | P90 |
| --- | ---: | ---: | ---: |
| All converted expected issues per case | 3 | 6 | 10 |
| High-matchability expected issues per case | 1 | 2 | 3 |

The May 7, 2026 smoke run on the first 10 cases produced this baseline before
benchmark-mode calibration:

| Mode | RQS | Detection | Precision | Decision | Noise |
| --- | ---: | ---: | ---: | ---: | ---: |
| codex-basic | 7.75 | 0 | 0 | 67 | 88 |
| gstack | 7.65 | 0 | 0 | 64 | 89 |
| revix | 4.05 | 0 | 0 | 34 | 47 |

After applying the benchmark policy in this document and reusing the same cached
model outputs, Revix moved to RQS 4.5 and noise 56. Detection, precision, and
decision stayed unchanged, so the next tuning target remains evidence/file
alignment and decision calibration, not RQS-weight changes.

Interpretation: Revix produced more raw findings, but they did not align with
the benchmark's human-comment ground truth and caused more false positives and
over-escalated decisions. This is a benchmark-alignment and calibration problem,
not proof that every extra Revix finding is invalid.

## Numeric Tuning Ledger

| Parameter | Old value | New value | Source and local evidence | Expected effect | Rollback condition |
| --- | ---: | ---: | --- | --- | --- |
| `BENCHMARK_POLICY.max_total_findings` | unbounded | 6 | P75 of all converted expected issues per SWE-PRBench case is 6. This keeps benchmark-mode output near the upper quartile of human-comment density while preserving room for multi-issue PRs. | Lower false positives and noise in local RQS without changing the evaluator. | Roll back or raise if held-out recall drops while precision/noise does not improve. |
| `BENCHMARK_POLICY.max_findings_per_reviewer` | unbounded | 2 | P75 of high-matchability expected issues per case is 2. Per-reviewer caps stop one specialized reviewer from dominating the final review. | Reduce duplicate/speculative findings from broad reviewer fan-out. | Roll back or raise if useful high-confidence findings are consistently truncated in manual audit. |
| Benchmark blocking gate | any `MAJOR` or `BLOCKER` can remain blocking | require `HIGH` confidence, changed-file evidence, and at least one hard quality rule | Calibration sources recommend separating threshold/action selection from scoring and tuning thresholds on validation data. Local smoke failures showed Revix over-escalating `COMMENT` cases. | Reduce accidental `REQUEST_CHANGES`/`BLOCK` from soft or weakly evidenced findings. | Roll back if request-change cases with clear hard-rule violations are downgraded in held-out evals. |

## Guardrails

- Do not change `RQS_WEIGHTS`, `LINE_LEVEL_MATCH_THRESHOLD`, or
  `FILE_LEVEL_MATCH_THRESHOLD` as part of product-output tuning. Evaluator
  changes require a separate evaluator-version document.
- Report local benchmark results as local rubric recreation, not an official
  SWE-PRBench leaderboard result.
- Keep benchmark mode separate from default product review behavior until held
  out results and manual audits show that the stricter policy improves real
  reviewer usefulness.
