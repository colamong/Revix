# Evaluation Strategy

Revix should be evaluated with fixture-based PR review scenarios before broad
reviewer logic is added.

## Fixture-Based Tests

Use representative PR metadata and diff fixtures for small bug fixes, refactors,
security-sensitive changes, test-only changes, and mixed changes.

## Golden Output Checks

Compare structured intermediate outputs and rendered GitHub comments against
expected results for stable scenarios.

## Constitution Compliance Checks

Verify that findings include required fields, cite evidence, expose conflicts,
and route final judgment through the Quality Constitution.

## Regression Cases

Track cases for reviewer conflicts, low-confidence findings, missing evidence,
malformed findings, unsupported PR types, and conflicting synthesis options.

## Review Quality Score

Revix review quality is measured with `Review Quality Score` (`RQS`), a 100-point
composite score that combines issue detection, precision, evidence accuracy,
severity calibration, actionability, final decision correctness, and noise.

RQS is intended for both internal golden fixtures and SWE-PRBench-style PR cases
with human review comments. Reports must show the top-line score and every
sub-score; a high aggregate score must not hide poor recall or noisy findings.

The v0.1 evaluator lives in `src/evaluation/` and accepts:

- an eval case with expected issues, expected verdict, and optional human review
  comments
- a Revix review result containing findings, synthesis options, final decision,
  and rendered output

The evaluator emits stable JSON plus a concise Markdown report with missed
issues and false positives.

## External Benchmark Data

SWE-PRBench data is downloaded into `eval-data/swe-prbench/raw/`, which is
ignored by git because it contains large PR diffs and reproducible benchmark
artifacts.

```bash
npm run eval:download:swe-prbench
npm run eval:convert:swe-prbench -- --eval-split eval-data/swe-prbench/raw/dataset/evals/eval_100.json
```

The converter emits Revix eval cases at
`eval-data/swe-prbench/converted/eval-cases.json`. Human review comments do not
always carry explicit severity or category labels, so conversion uses
deterministic heuristics for category, severity, and issue weight. Those fields
are benchmark-normalization metadata; the original human comment is preserved in
`human_review_comments` and `allowed_claims`.

## Comparative RQS Evaluation

Run a local rubric-recreation comparison across Revix, GStack Review,
Greptile-style, and CodeRabbit-style reviewers:

```bash
npm run eval:rqs -- --cases eval-data/swe-prbench/converted/eval-cases.json --reviewers revix,gstack,greptile,coderabbit --out eval-data/reports/latest
```

The default model runner is:

```bash
claude -p --tools "" --permission-mode plan --output-format json
```

Use `--command "<your command>"` to provide another JSON-producing runner. The
runner receives a ground-truth-free prompt on stdin and must return JSON with a
`findings` array. Invalid JSON is retried once with a repair prompt. Raw outputs,
normalized findings, and reports are written under ignored `eval-data/`.

Codex can be used as the runner when Claude usage is exhausted:

```bash
npm run eval:rqs -- --command "node scripts/codex-eval-runner.mjs"
```

These comparison scores are not official Greptile or CodeRabbit product results.
They are local prompt/rubric recreations scored by the same Revix RQS evaluator.
