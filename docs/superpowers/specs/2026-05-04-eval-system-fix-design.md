# Eval System Fix — Design Spec

**Date:** 2026-05-04
**Status:** Approved for implementation
**Implementor:** Codex
**Reviewer:** Claude (design review only)

---

## Problem Statement

The SWE-PRBench evaluation run (codex-smoke, 2026-04-30) showed 0% detection rate (RQS detection=0) for both `revix` and `gstack` reviewers. Root cause analysis revealed two distinct problems:

1. **Evaluation scoring is incorrect.** The LLM did produce valid findings (e.g., `test-001`: missing test case, `documentation-001`: typo), but the matching algorithm gave them 0 credit due to category mismatch and strict token-overlap claim matching.

2. **Ground truth includes unmatchable issues.** 6 of 6 expected issues in the test case required project-specific knowledge (prowler contribution guidelines, CHANGELOG conventions). No general AI reviewer can be expected to catch these.

Phase 2 (reviewer prompt improvement) is deferred until Phase 1 produces honest signal.

---

## Scope

### In scope (Phase 1)

- `src/evaluation/index.js` — matching algorithm
- `scripts/convert-swe-prbench.mjs` — category heuristics + `matchability` field
- `schemas/review-quality-eval-case.schema.json` — `matchability` field
- `test/evaluation.test.js` — new test cases for changed logic
- Eval report format — per-category RQS breakdown

### Out of scope

- Reviewer skills (`src/reviewer-selection/`, skill YAMLs, `src/prompt-builder/`)
- Provider integration
- Phase 2 prompt calibration (decided after Phase 1 results)

---

## Design

### 1a. Matching Algorithm (`src/evaluation/index.js`)

#### Claim matching: token overlap → semantic similarity

Current implementation uses Jaccard token overlap. This fails when the LLM paraphrases the same issue in different words.

Replace with embedding-based cosine similarity using a local model (no external API calls during eval). Use `@xenova/transformers` with `all-MiniLM-L6-v2` (runs in Node.js, ~25MB, no GPU needed). Cache embeddings per string to avoid re-computation.

Similarity threshold for claim match: **0.60** (calibrated so semantically equivalent paraphrases pass, unrelated claims fail).

Fallback: if embedding model is unavailable, fall back to existing token overlap with a warning log.

#### Category match: 0/1 → partial credit

Current: exact category match = score 1.0, mismatch = 0.

New: if file + line match but category differs, award partial score (0.5 instead of 0).

Rationale: a `test` reviewer finding the same issue as an expected `contract` issue at the same location is a valid detection, just categorized differently.

#### File-level issue detection

When `expected_issue.line_start === 1 && expected_issue.line_end === 1`, treat the issue as file-level (SWE-PRBench stores file-level comments at line 1 by convention).

For file-level issues:

- Exclude line match from scoring entirely (redistribute weight)
- Use only file match + claim match + category match
- Lower matching threshold to **0.30** (from 0.45)

For line-level issues: keep threshold at **0.45**, all four components active.

#### Weight tables

**Line-level issues (default):**

| Component      | Weight | Notes                                    |
| -------------- | ------ | ---------------------------------------- |
| file match     | 0.25   | Unchanged                                |
| line match     | 0.25   | Unchanged                                |
| claim match    | 0.35   | Now semantic similarity                  |
| category match | 0.15   | Now partial credit (0.5) on mismatch     |

**File-level issues (`line_start === line_end === 1`):**

| Component      | Weight | Notes                                    |
| -------------- | ------ | ---------------------------------------- |
| file match     | 0.35   | Increased (line match weight absorbed)   |
| claim match    | 0.45   | Increased                                |
| category match | 0.20   | Increased                                |

---

### 1b. SWE-PRBench Converter (`scripts/convert-swe-prbench.mjs`)

#### Category heuristic fix

Current heuristics over-assign `contract` category to project-specific convention comments.

New priority order for category assignment:

```text
1. Contains ```suggestion ... ``` block          → category: docs
2. Mentions CHANGELOG / UNRELEASED / changelog   → category: docs
3. "remove this" / "revert" / "undo"             → category: correctness
4. Mentions API signature / interface / breaking  → category: contract
5. Mentions test / coverage / assertion           → category: test
6. Default                                        → category: correctness
```

#### `matchability` field

Add a `matchability: "high" | "low"` field to each converted expected issue.

Rules for `low`:

- Category is `docs` AND the claim is a `` ```suggestion `` diff block
- Claim mentions a project-specific path pattern (e.g., CHANGELOG, codecov.yml, `.metadata.json` field values)
- Claim is shorter than 15 tokens (too terse to match semantically)

Rules for `high`:

- Everything else

#### RQS calculation with `matchability`

Issues with `matchability: low` are excluded from the RQS denominator (detection, precision, recall, F1 calculations) but are still shown in the report under "Skipped issues (low matchability)".

This prevents a low-matchability-heavy case from dominating the score.

Schema change: add `matchability` enum field to `schemas/review-quality-eval-case.schema.json`.

---

### 1c. Per-category RQS Report

Add per-category breakdown to both JSON and Markdown report outputs.

Markdown table added after the current summary table:

```markdown
## Category Breakdown

| Category    | Expected (matchable) | Matched | Recall | Avg RQS |
| ----------- | -------------------- | ------- | ------ | ------- |
| correctness | N                    | N       | N%     | N       |
| security    | N                    | N       | N%     | N       |
| contract    | N                    | N       | N%     | N       |
| test        | N                    | N       | N%     | N       |
| docs        | N                    | N       | N%     | N       |
| performance | N                    | N       | N%     | N       |
```

JSON addition to `summary.json`:

```json
"category_breakdown": {
  "correctness": { "expected": 0, "matched": 0, "recall": 0, "avg_rqs": 0 }
}
```

---

### 1d. Diagnostic Mode

Add `--diagnostic` flag to the eval CLI (the script that `npm run eval:rqs` invokes).

When active, the report includes for each case:

- Which reviewers were selected and why
- How many findings each reviewer produced
- For 0-finding reviewers: was the reviewer in scope for the expected issues?

This is the input for Phase 2 analysis. No behavior changes — diagnostic output only.

---

## Test Coverage

All changes must maintain the existing 110 passing tests. New tests required:

| Test | File | What to verify |
| ---- | ---- | -------------- |
| File-level issue uses relaxed threshold | `test/evaluation.test.js` | `line_start=1` issue matched at threshold 0.30 |
| Cross-category partial credit | `test/evaluation.test.js` | `test` finding matched against `contract` expected issue with score 0.5 |
| Claim semantic match | `test/evaluation.test.js` | Paraphrased claim matches with cosine sim ≥ 0.60 |
| Converter: suggestion block → docs | `test/swe-prbench-converter.test.js` | `` ```suggestion `` pattern maps to `docs` |
| Converter: CHANGELOG → docs | `test/swe-prbench-converter.test.js` | CHANGELOG mention maps to `docs` |
| Converter: matchability low | `test/swe-prbench-converter.test.js` | Short suggestion claim gets `matchability: low` |
| matchability low excluded from RQS | `test/evaluation.test.js` | Low-matchability issues don't inflate denominator |
| Per-category breakdown in report | `test/evaluation.test.js` | `category_breakdown` present in JSON output |

---

## Dependencies

- `@xenova/transformers` — local embedding model for claim similarity (add to `package.json`)
- No other new dependencies

---

## Success Criteria (Phase 1 done when)

1. All 110 existing tests pass + all new tests above pass
2. Re-run codex-smoke on `prowler__9865`: `test-001` and `documentation-001` findings receive non-zero match scores
3. 100-case eval produces per-category breakdown with non-zero recall in at least one category
4. `matchability` field present in converted `eval-cases.json`
5. No RQS regression on existing golden fixtures (`test/fixtures/`)
