import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  RiskBenchError,
  aggregateBenchResults,
  fuzzyTextMatch,
  loadRiskBenchCases,
  scoreCaseResult,
  validateRiskBenchCase
} from "../src/evaluation/risk-bench.js";
import { runCli } from "../bin/revix.js";

const baseCase = Object.freeze({
  eval_id: "concurrency-balance-race",
  risk_type: "concurrency",
  execution_stage: "pre-merge",
  review_budget: 4,
  expected_verdict: "REQUEST_CHANGES",
  changeset: { source: "synthetic" }
});

test("scores a perfect hit on must_find with matching verdict", () => {
  const result = scoreCaseResult({
    case: {
      ...baseCase,
      must_find: [{ id: "race", quality_rule: "concurrency.atomic", evidence_files: ["balance.ts"], summary_hint: "balance read write without lock" }],
      should_find: [],
      allowed_find: [],
      forbidden_find: []
    },
    findings: [
      {
        claim: "Balance read and write without lock causes a race condition.",
        evidence: { file_path: "src/billing/balance.ts", line_start: 10 },
        related_quality_rules: ["concurrency.atomic.read_write"]
      }
    ],
    verdict: "REQUEST_CHANGES"
  });

  assert.equal(result.components.must_recall, 1);
  assert.equal(result.components.verdict_correctness, 1);
  assert.equal(result.must_hard_gated, false);
  assert.equal(result.rrs, 100);
});

test("caps RRS at 60 when must_find is missed", () => {
  const result = scoreCaseResult({
    case: {
      ...baseCase,
      must_find: [{ id: "race", quality_rule: "concurrency.atomic", evidence_files: ["balance.ts"], summary_hint: "balance read write" }],
      should_find: [],
      allowed_find: [],
      forbidden_find: []
    },
    findings: [],
    verdict: "REQUEST_CHANGES"
  });

  assert.equal(result.components.must_recall, 0);
  assert.equal(result.must_hard_gated, true);
  assert.ok(result.rrs <= 60);
});

test("forbidden pattern reduces precision component", () => {
  const result = scoreCaseResult({
    case: {
      ...baseCase,
      must_find: [],
      should_find: [],
      allowed_find: [],
      forbidden_find: [{ pattern_quality_rule: "style.*", reason: "out of scope" }]
    },
    findings: [
      { claim: "use let instead of var", related_quality_rules: ["style.let_over_var"], evidence: { file_path: "a.js", line_start: 1 } },
      { claim: "another finding", related_quality_rules: ["security.audit"], evidence: { file_path: "b.js", line_start: 2 } }
    ],
    verdict: "REQUEST_CHANGES"
  });

  assert.equal(result.matches.forbidden_hits, 1);
  assert.equal(result.components.forbidden_precision, 0.5);
});

test("budget overflow reduces budget_adherence", () => {
  const result = scoreCaseResult({
    case: { ...baseCase, must_find: [], should_find: [], allowed_find: [], forbidden_find: [] },
    findings: Array.from({ length: 6 }, (_, index) => ({
      claim: `finding ${index}`,
      evidence: { file_path: "a.js", line_start: index + 1 },
      related_quality_rules: []
    })),
    verdict: "REQUEST_CHANGES"
  });

  assert.equal(result.components.budget_adherence, 0.5);
});

test("evidence_quality penalises findings without file path or line", () => {
  const result = scoreCaseResult({
    case: { ...baseCase, must_find: [], should_find: [], allowed_find: [], forbidden_find: [] },
    findings: [
      { claim: "good", evidence: { file_path: "a.js", line_start: 1 }, related_quality_rules: [] },
      { claim: "bad", evidence: {}, related_quality_rules: [] }
    ],
    verdict: "REQUEST_CHANGES"
  });

  assert.equal(result.components.evidence_quality, 0.5);
});

test("fuzzyTextMatch matches with partial token overlap", () => {
  assert.equal(fuzzyTextMatch("balance read write race", "Balance read/write across await without lock"), true);
  assert.equal(fuzzyTextMatch("graphql subscription throttle", "Plain HTML rendering issue"), false);
});

test("validateRiskBenchCase rejects malformed cases", () => {
  assert.throws(() => validateRiskBenchCase({ eval_id: "" }), RiskBenchError);
  assert.throws(() => validateRiskBenchCase({ ...baseCase, risk_type: "unknown" }), RiskBenchError);
  assert.throws(() => validateRiskBenchCase({ ...baseCase, review_budget: -1 }), RiskBenchError);
  assert.throws(() => validateRiskBenchCase({ ...baseCase, must_find: [{}] }), RiskBenchError);
  assert.throws(() => validateRiskBenchCase({ ...baseCase, forbidden_find: [{ reason: "no pattern" }] }), RiskBenchError);
});

test("loadRiskBenchCases bails on excessive recursion depth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "risk-bench-deep-"));
  let path = dir;
  for (let depth = 0; depth < 20; depth += 1) {
    path = join(path, `nest${depth}`);
    mkdirSync(path);
  }
  await assert.rejects(
    () => loadRiskBenchCases(dir),
    /max recursion depth/
  );
});

test("loadRiskBenchCases reads YAML cases from a directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "risk-bench-cases-"));
  mkdirSync(join(dir, "concurrency"), { recursive: true });
  writeFileSync(join(dir, "concurrency", "race.yaml"), [
    "eval_id: race-case",
    "risk_type: concurrency",
    "execution_stage: pre-merge",
    "review_budget: 4",
    "expected_verdict: REQUEST_CHANGES",
    "changeset:",
    "  source: synthetic",
    "must_find:",
    "  - id: race-id",
    "    quality_rule: concurrency.atomic",
    "    summary_hint: balance read write",
    ""
  ].join("\n"), "utf8");

  const cases = await loadRiskBenchCases(dir);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].eval_id, "race-case");
  assert.equal(cases[0].must_find[0].id, "race-id");
});

test("seed bench scores at or above the acceptance threshold", async () => {
  const repoRoot = process.cwd();
  const reportPath = join(mkdtempSync(join(tmpdir(), "risk-bench-report-")), "report.json");
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli([
    "eval", "risk-bench",
    "--cases", resolve(repoRoot, "eval/risk-bench/cases"),
    "--case-findings", resolve(repoRoot, "eval/risk-bench/fixtures/golden.json"),
    "--report", reportPath
  ], {
    cwd: repoRoot,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } }
  });
  assert.equal(exitCode, 0, `bench failed: stderr=${stderr} stdout=${stdout}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.ok(report.summary.count >= 20, `expected at least 20 seed cases, got ${report.summary.count}`);
  assert.ok(report.summary.median_rrs >= 95, `median RRS regressed: ${report.summary.median_rrs}`);
  assert.equal(report.summary.must_recall_pass_rate, 1, "must_recall must hit 1.0 on golden fixture");
  assert.equal(report.summary.hard_gated, 0, "no case should be hard-gated under golden fixture");
});

test("eval risk-bench rejects --reviewer-output with a helpful misuse error", async () => {
  const repoRoot = process.cwd();
  const tmpDir = mkdtempSync(join(tmpdir(), "risk-bench-misuse-"));
  const fixturePath = join(tmpDir, "wrong-shape.json");
  writeFileSync(fixturePath, "[]", "utf8");

  let stderr = "";
  const exitCode = await runCli([
    "eval", "risk-bench",
    "--cases", resolve(repoRoot, "eval/risk-bench/cases"),
    "--reviewer-output", fixturePath
  ], {
    cwd: repoRoot,
    stdout: { write: () => {} },
    stderr: { write: (value) => { stderr += value; } }
  });
  assert.equal(exitCode, 1);
  assert.match(stderr, /--case-findings/);
});

test("aggregateBenchResults computes median, mean, and hard-gate counts", () => {
  const rollup = aggregateBenchResults([
    { rrs: 100, components: { must_recall: 1 }, must_hard_gated: false },
    { rrs: 60, components: { must_recall: 0 }, must_hard_gated: true },
    { rrs: 75, components: { must_recall: 1 }, must_hard_gated: false }
  ]);
  assert.equal(rollup.count, 3);
  assert.equal(rollup.median_rrs, 75);
  assert.equal(rollup.hard_gated, 1);
  assert.equal(rollup.must_recall_pass_rate, 0.667);
});
