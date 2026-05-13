import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  applyBenchmarkFindingPolicy,
  buildComparativeReport,
  buildProfilePrompt,
  invokeModelForJson,
  normalizeModelFindings,
  normalizeRevixModelFindings,
  parseModelJson,
  renderComparativeMarkdown,
  runComparativeReviewQualityEval
} from "../src/evaluation/comparative.js";
import { loadDefaultConstitution } from "../src/constitution/index.js";

test("profile prompts do not expose ground truth fields", () => {
  const prompt = buildProfilePrompt({ profile: "gstack", evalCase: evalCase() });
  const serialized = JSON.stringify(prompt);

  assert.doesNotMatch(serialized, /expected_issues/);
  assert.doesNotMatch(serialized, /human_review_comments/);
  assert.doesNotMatch(serialized, /The hidden expected issue/);
  assert.match(serialized, /gstack/);
  assert.match(serialized, /diff --git/);
});

test("codex-basic profile prompt is available for baseline comparisons", () => {
  const prompt = buildProfilePrompt({ profile: "codex-basic", evalCase: evalCase() });
  const serialized = JSON.stringify(prompt);

  assert.match(serialized, /Codex Basic Review/);
  assert.doesNotMatch(serialized, /expected_issues/);
});

test("normalizes recreated reviewer findings into Revix finding shape", () => {
  const findings = normalizeModelFindings({
    reviewer: "greptile",
    evalCase: evalCase(),
    parsed: {
      findings: [
        {
          severity: "P1",
          category: "security",
          claim: "The raw token is logged and can expose credentials.",
          evidence: { file_path: "src/auth.js", line: 2, snippet: "logger.info(token)" },
          confidence: 9
        }
      ]
    }
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].reviewer_id, "greptile");
  assert.equal(findings[0].severity, "BLOCKER");
  assert.equal(findings[0].confidence, "HIGH");
  assert.deepEqual(findings[0].tags, ["security"]);
  assert.deepEqual(findings[0].related_quality_rules, ["security.benchmark_signal"]);
});

test("normalizes Revix reviewer findings back into selected scope", () => {
  const findings = normalizeRevixModelFindings({
    reviewer: { reviewer_id: "documentation" },
    selection: {
      scope_context: {
        allowed_tags: ["docs", "documentation"],
        allowed_quality_rules: ["documentation.must_update"]
      }
    },
    evalCase: evalCase(),
    parsed: {
      findings: [
        {
          reviewer_id: "other",
          severity: "low",
          claim: "The metadata description contains a typo in the public check text.",
          evidence: "src/auth.js line 2 says token logging text is malformed.",
          impact: "Users can misunderstand the generated check documentation.",
          suggested_fix: "Update the metadata text so it names the field correctly.",
          verification_test: "Regenerate or inspect the rendered documentation output.",
          confidence: "high",
          tags: ["metadata"],
          related_quality_rules: ["metadata.typo"]
        }
      ]
    }
  });

  assert.equal(findings[0].reviewer_id, "documentation");
  assert.deepEqual(findings[0].tags, ["docs"]);
  assert.deepEqual(findings[0].related_quality_rules, ["documentation.must_update"]);
  assert.equal(findings[0].evidence.file_path, "src/auth.js");
});

test("benchmark policy caps Revix findings and de-escalates weak blocking findings", () => {
  const reviewerRun = {
    results: [
      {
        reviewer_id: "security",
        findings: [
          finding("a-hard-high", { severity: "BLOCKER", confidence: "HIGH", related_quality_rules: ["security.no_new_risk"] }),
          finding("b-hard-medium", { severity: "MAJOR", confidence: "MEDIUM", related_quality_rules: ["security.no_new_risk"] }),
          finding("c-soft-high", { severity: "MAJOR", confidence: "HIGH", related_quality_rules: ["readability.easy_to_understand"], tags: ["readability"] })
        ]
      },
      {
        reviewer_id: "documentation",
        findings: [
          finding("d-doc", { reviewer_id: "documentation", severity: "MAJOR", related_quality_rules: ["readability.easy_to_understand"], tags: ["docs"] })
        ]
      }
    ],
    findings: [],
    errors: []
  };
  reviewerRun.findings = reviewerRun.results.flatMap((result) => result.findings);

  const calibrated = applyBenchmarkFindingPolicy({
    reviewerRun,
    evalCase: evalCase(),
    qualityRules: loadDefaultConstitution(),
    maxTotalFindings: 2,
    maxFindingsPerReviewer: 2
  });

  assert.equal(calibrated.benchmark_policy.input_findings, 4);
  assert.equal(calibrated.benchmark_policy.output_findings, 2);
  assert.deepEqual(calibrated.findings.map((item) => item.finding_id), ["a-hard-high", "b-hard-medium"]);
  assert.equal(calibrated.findings.find((item) => item.finding_id === "a-hard-high").severity, "BLOCKER");
  assert.equal(calibrated.findings.find((item) => item.finding_id === "b-hard-medium").severity, "MINOR");
});

test("model JSON parser handles Claude JSON envelopes and markdown fences", () => {
  assert.deepEqual(parseModelJson(JSON.stringify({ result: "{\"findings\":[]}" })), { findings: [] });
  assert.deepEqual(parseModelJson("```json\n{\"findings\":[]}\n```"), { findings: [] });
  assert.throws(
    () => parseModelJson(JSON.stringify({ is_error: true, result: "You're out of extra usage" })),
    /model runner returned an error/
  );
});

test("model invocation retries repair once and caches parsed output", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "revix-eval-cache-"));
  let calls = 0;
  const modelRunner = async () => {
    calls += 1;
    return calls === 1 ? "not json" : "{\"findings\":[]}";
  };

  const first = await invokeModelForJson({
    prompt: { task: "test" },
    modelRunner,
    cacheKey: "case-a",
    cacheDir
  });
  const second = await invokeModelForJson({
    prompt: { task: "test" },
    modelRunner: async () => {
      throw new Error("cache should prevent this call");
    },
    cacheKey: "case-a",
    cacheDir
  });

  assert.equal(calls, 2);
  assert.deepEqual(first.parsed, { findings: [] });
  assert.deepEqual(second.parsed, { findings: [] });
});

test("comparative report emits reviewer scores and improvement candidates", async () => {
  const cases = [evalCase()];
  const modelRunner = async (promptText) => {
    const prompt = JSON.parse(promptText);
    if (prompt.reviewer_profile?.reviewer_id === "gstack") {
      return JSON.stringify({
        findings: [
          {
            severity: "BLOCKER",
            category: "security",
            claim: "The raw token is logged and can expose credentials.",
            evidence: { file_path: "src/auth.js", line: 2, snippet: "logger.info(token)" },
            impact: "A leaked token can be reused by anyone who can read aggregated application logs.",
            suggested_fix: "Remove the token from the log payload or replace it with a non-sensitive identifier.",
            verification_test: "Add a regression test that asserts the emitted log payload never contains the raw token.",
            confidence: "HIGH"
          }
        ]
      });
    }
    return "{\"findings\":[]}";
  };

  const { report } = await runComparativeReviewQualityEval({
    cases,
    reviewers: ["revix", "gstack"],
    modelRunner
  });
  const markdown = renderComparativeMarkdown(report);

  assert.ok(report.reviewers.revix);
  assert.ok(report.reviewers.gstack);
  assert.ok(report.reviewers.gstack.rqs > report.reviewers.revix.rqs);
  assert.ok(report.improvement_candidates.some((item) => item.metric === "detection"));
  assert.match(markdown, /local rubric recreation benchmark/);
});

test("eval CLI runs against a two-case fixture with a command runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "revix-eval-cli-"));
  const casesPath = join(root, "cases.json");
  const outDir = join(root, "out");
  const runnerPath = join(root, "runner.mjs");
  await writeFile(casesPath, `${JSON.stringify([evalCase({ eval_id: "case-1" }), evalCase({ eval_id: "case-2" })])}\n`);
  await writeFile(runnerPath, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ findings: [] })));\n");

  const result = spawnSync(process.execPath, [
    "scripts/run-review-quality-eval.mjs",
    "--cases",
    casesPath,
    "--out",
    outDir,
    "--limit",
    "2",
    "--reviewers",
    "revix,gstack",
    "--command",
    `"${process.execPath}" "${runnerPath}"`
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.error?.code === "EPERM") {
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(await readFile(join(outDir, "summary.json"), "utf8"));
  assert.equal(summary.case_count, 2);
  assert.equal(summary.reviewer_count, 2);
});

test("buildComparativeReport keeps stable JSON shape", () => {
  const report = buildComparativeReport([]);

  assert.equal(report.case_count, 0);
  assert.equal(report.reviewer_count, 0);
  assert.deepEqual(report.improvement_candidates, []);
});

function evalCase(overrides = {}) {
  return {
    eval_id: "case-security",
    pr_input: {
      metadata: {
        repo: "example/repo",
        number: 7,
        title: "Log session token for debugging",
        body: "Adds more auth logs.",
        author: "dev",
        labels: ["security"],
        base_ref: "main",
        head_ref: "auth-logs",
        files_changed: [{ path: "src/auth.js", status: "modified", additions: 1, deletions: 0 }]
      },
      diff: {
        raw: "diff --git a/src/auth.js b/src/auth.js\n--- a/src/auth.js\n+++ b/src/auth.js\n@@ -1,2 +1,3 @@\n export function login(session) {\n+  logger.info({ token: session.token });\n }\n",
        files: [{ path: "src/auth.js", status: "modified", additions: 1, deletions: 0 }]
      }
    },
    expected_issues: [
      {
        issue_id: "expected-security",
        category: "security",
        severity: "BLOCKER",
        claim: "The hidden expected issue should never appear in prompts.",
        file_path: "src/auth.js",
        line_start: 2,
        line_end: 2,
        allowed_claims: ["The raw token is logged and can expose credentials."],
        root_cause: "raw token logged",
        weight: 2
      }
    ],
    expected_verdict: "BLOCK",
    human_review_comments: [{ body: "The hidden expected issue should never appear in prompts." }],
    ...overrides
  };
}

function finding(id, overrides = {}) {
  return {
    finding_id: id,
    reviewer_id: "security",
    severity: "MAJOR",
    claim: "The raw token is logged and can expose credentials.",
    evidence: {
      file_path: "src/auth.js",
      line_start: 2,
      line_end: 2,
      snippet: "logger.info({ token: session.token })"
    },
    impact: "A leaked token can be reused by anyone who can read aggregated application logs.",
    suggested_fix: "Remove the token from the log payload or replace it with a non-sensitive identifier.",
    verification_test: "Add a regression test that asserts the emitted log payload never contains the raw token.",
    confidence: "HIGH",
    related_quality_rules: ["security.no_new_risk"],
    tags: ["security"],
    ...overrides
  };
}
