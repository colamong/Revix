import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReviewQuality,
  evaluateReviewQualitySuite,
  matchExpectedIssues,
  matchScore,
  renderReviewQualityReport
} from "../src/evaluation/index.js";

test("matches exact, near-line, and root-cause equivalent findings", async () => {
  const exact = await matchScore(expectedIssue(), finding());
  const near = await matchScore(expectedIssue(), finding({ evidence: { ...finding().evidence, line_start: 4, line_end: 4 } }));
  const wrongFile = await matchScore(expectedIssue(), finding({ evidence: { ...finding().evidence, file_path: "src/other.js" } }));
  const basename = await matchScore(expectedIssue(), finding({ evidence: { ...finding().evidence, file_path: "session.js" } }));

  assert.ok(exact.total > 0.9);
  assert.ok(near.total > 0.7);
  assert.ok(basename.total > wrongFile.total);
  assert.ok(wrongFile.total < exact.total);

  const matches = await matchExpectedIssues([expectedIssue()], [finding(), finding({ finding_id: "duplicate" })]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].finding.finding_id, "finding-security");
});

test("scores perfect review quality at the top end", async () => {
  const evaluation = await evaluateReviewQuality({
    evalCase: evalCase({ expected_issues: [expectedIssue()], expected_verdict: "BLOCK" }),
    reviewResult: reviewResult({ findings: [finding()], verdict: "BLOCK" })
  });

  assert.equal(evaluation.sub_scores.detection, 100);
  assert.equal(evaluation.sub_scores.precision, 100);
  assert.equal(evaluation.sub_scores.evidence, 100);
  assert.equal(evaluation.sub_scores.severity, 100);
  assert.equal(evaluation.sub_scores.decision, 100);
  assert.ok(evaluation.rqs > 95);
  assert.deepEqual(evaluation.missed_issues, []);
  assert.deepEqual(evaluation.false_positives, []);
});

test("penalizes false positives and noisy output", async () => {
  const evaluation = await evaluateReviewQuality({
    evalCase: evalCase({ expected_issues: [], expected_verdict: "APPROVE" }),
    reviewResult: reviewResult({
      findings: [finding({ severity: "BLOCKER" })],
      verdict: "BLOCK",
      synthesisOptions: new Array(8).fill(null).map((_, index) => ({ option_id: `option-${index}` })),
      markdown: "x".repeat(6000)
    })
  });

  assert.equal(evaluation.sub_scores.detection, 100);
  assert.equal(evaluation.sub_scores.precision, 0);
  assert.equal(evaluation.sub_scores.decision, 0);
  assert.ok(evaluation.sub_scores.noise < 80);
  assert.equal(evaluation.false_positives.length, 1);
});

test("penalizes severity distance and missed blocking boundary", async () => {
  const evaluation = await evaluateReviewQuality({
    evalCase: evalCase({ expected_issues: [expectedIssue({ severity: "BLOCKER" })], expected_verdict: "BLOCK" }),
    reviewResult: reviewResult({ findings: [finding({ severity: "MINOR" })], verdict: "COMMENT" })
  });

  assert.equal(evaluation.sub_scores.severity, 20);
  assert.equal(evaluation.sub_scores.decision, 0);
  assert.ok(evaluation.rqs < 90);
});

test("aggregates smoke eval suite and renders stable report", async () => {
  const cases = smokeEvalCases();
  const evaluations = await Promise.all(cases.map(({ evalCase, reviewResult }) => evaluateReviewQuality({ evalCase, reviewResult })));
  const suite = evaluateReviewQualitySuite(evaluations);
  const report = renderReviewQualityReport(evaluations[0]);

  assert.equal(evaluations.length, 10);
  assert.ok(suite.rqs > 40);
  assert.match(report, /Revix Review Quality:/);
  assert.match(report, /Sub-Scores/);
});

test("matches file-level issue (line_start=1) with relaxed threshold", async () => {
  const matches = await matchExpectedIssues([
    expectedIssue({
      issue_id: "expected-file-level",
      category: "contract",
      claim: "The file-level metadata convention is violated.",
      file_path: "config/check.metadata.json",
      line_start: 1,
      line_end: 1,
      allowed_claims: [],
      root_cause: undefined
    })
  ], [
    finding({
      finding_id: "finding-file-level",
      reviewer_id: "test",
      tags: ["test"],
      related_quality_rules: ["test.coverage_gap"],
      claim: "The tests need one more explicit branch assertion.",
      evidence: {
        ...finding().evidence,
        file_path: "config/check.metadata.json",
        line_start: 42,
        line_end: 42
      }
    })
  ]);

  assert.equal(matches[0].matched, true);
  assert.equal(matches[0].match_score, 0.35);
});

test("awards partial category credit when file+line match but category differs", async () => {
  const score = await matchScore(
    expectedIssue({
      category: "contract",
      claim: "The response shape removes a required field from the API contract.",
      file_path: "api/openapi.yml",
      line_start: 10,
      line_end: 10
    }),
    finding({
      reviewer_id: "test",
      tags: ["test"],
      related_quality_rules: ["test.coverage_gap"],
      claim: "The response shape removes a required field from the API contract.",
      evidence: {
        ...finding().evidence,
        file_path: "api/openapi.yml",
        line_start: 10,
        line_end: 10
      }
    })
  );

  assert.equal(score.details.category, 0.5);
  assert.ok(score.total > 0.8);
});

test("matches semantically equivalent claims with cosine similarity", async () => {
  const score = await matchScore(
    expectedIssue({
      claim: "The raw token is logged and can expose credentials.",
      allowed_claims: []
    }),
    finding({
      claim: "Logging the raw token can expose credentials in application logs."
    })
  );

  assert.ok(score.details.claim >= 0.6);
});

test("excludes low-matchability issues from RQS denominator", async () => {
  const evaluation = await evaluateReviewQuality({
    evalCase: evalCase({
      expected_issues: [
        expectedIssue(),
        expectedIssue({
          issue_id: "expected-low",
          category: "docs",
          severity: "MINOR",
          claim: "```suggestion Rename this title. ```",
          file_path: "CHANGELOG.md",
          line_start: 1,
          line_end: 1,
          matchability: "low"
        })
      ]
    }),
    reviewResult: reviewResult({ findings: [finding()] })
  });

  assert.equal(evaluation.sub_scores.detection, 100);
  assert.equal(evaluation.precision_recall_f1.recall, 100);
  assert.equal(evaluation.skipped_issues.length, 1);
  assert.deepEqual(evaluation.missed_issues, []);
});

test("includes category_breakdown in JSON report output", async () => {
  const evaluation = await evaluateReviewQuality({
    evalCase: evalCase({ expected_issues: [expectedIssue({ category: "correctness" })] }),
    reviewResult: reviewResult({ findings: [finding({ tags: ["correctness"], reviewer_id: "correctness" })] })
  });

  assert.ok(evaluation.category_breakdown);
  assert.equal(evaluation.category_breakdown.correctness.expected, 1);
  assert.equal(evaluation.category_breakdown.correctness.matched, 1);
  assert.ok("security" in evaluation.category_breakdown);
});

function smokeEvalCases() {
  return [
    { evalCase: evalCase({ eval_id: "internal-clean", expected_issues: [], expected_verdict: "APPROVE" }), reviewResult: reviewResult({ findings: [], verdict: "APPROVE" }) },
    { evalCase: evalCase({ eval_id: "internal-security", expected_issues: [expectedIssue()], expected_verdict: "BLOCK" }), reviewResult: reviewResult({ findings: [finding()], verdict: "BLOCK" }) },
    { evalCase: evalCase({ eval_id: "internal-contract", expected_issues: [expectedIssue({ issue_id: "expected-contract", category: "contract", claim: "The response shape removes a required field from the API contract.", severity: "MAJOR", file_path: "api/openapi.yml" })], expected_verdict: "REQUEST_CHANGES" }), reviewResult: reviewResult({ findings: [finding({ finding_id: "finding-contract", reviewer_id: "contract", tags: ["contract"], related_quality_rules: ["contract.no_breaking_change"], claim: "The API response shape removes a required field from the contract.", severity: "MAJOR", evidence: { ...finding().evidence, file_path: "api/openapi.yml" } })], verdict: "REQUEST_CHANGES" }) },
    { evalCase: evalCase({ eval_id: "internal-false-positive", expected_issues: [], expected_verdict: "APPROVE" }), reviewResult: reviewResult({ findings: [finding({ finding_id: "finding-fp", severity: "MINOR" })], verdict: "COMMENT" }) },
    { evalCase: evalCase({ eval_id: "internal-conflict", expected_issues: [expectedIssue()], expected_verdict: "BLOCK" }), reviewResult: reviewResult({ findings: [finding(), finding({ finding_id: "finding-question", severity: "QUESTION", claim: "Should the raw token be logged for this session path?" })], verdict: "BLOCK" }) },
    sweCase("swe-stylelint", "docs", "MINOR", "The changeset text should describe the exact false negative fixed."),
    sweCase("swe-linkding", "contract", "MAJOR", "Relative favicon URLs break clients that expect absolute URLs."),
    sweCase("swe-vitest", "docs", "MINOR", "The new API documentation anchor should match the released symbol name."),
    sweCase("swe-ragas", "correctness", "MAJOR", "Runtime imports must include EvaluationResult outside type-checking guards."),
    sweCase("swe-prowler", "docs", "MINOR", "The check title should be phrased as the failing resource state.")
  ];
}

function sweCase(evalId, category, severity, claim) {
  const expected = expectedIssue({
    issue_id: `expected-${evalId}`,
    category,
    severity,
    claim,
    file_path: "src/example.js",
    allowed_claims: [claim]
  });
  return {
    evalCase: evalCase({
      eval_id: evalId,
      expected_issues: [expected],
      expected_verdict: severity === "MAJOR" ? "REQUEST_CHANGES" : "COMMENT",
      human_review_comments: [{ body: claim, path: expected.file_path, line: expected.line_start }]
    }),
    reviewResult: reviewResult({
      findings: [finding({
        finding_id: `finding-${evalId}`,
        reviewer_id: category === "docs" ? "documentation" : category,
        tags: [category === "docs" ? "documentation" : category],
        related_quality_rules: [`${category === "docs" ? "documentation" : category}.example_rule`],
        severity,
        claim,
        evidence: { ...finding().evidence, file_path: expected.file_path }
      })],
      verdict: severity === "MAJOR" ? "REQUEST_CHANGES" : "COMMENT"
    })
  };
}

function evalCase(overrides = {}) {
  return {
    eval_id: "eval-security",
    expected_issues: [expectedIssue()],
    expected_verdict: "BLOCK",
    ...overrides
  };
}

function expectedIssue(overrides = {}) {
  return {
    issue_id: "expected-security",
    category: "security",
    severity: "BLOCKER",
    claim: "The raw token is logged and can expose credentials.",
    file_path: "src/auth/session.js",
    line_start: 2,
    line_end: 2,
    allowed_claims: [
      "The token logging path can expose credentials.",
      "The new token logging path can expose credentials in application logs."
    ],
    root_cause: "raw token logged",
    ...overrides
  };
}

function reviewResult({ findings = [finding()], verdict = "BLOCK", synthesisOptions = [], markdown = "" } = {}) {
  return {
    reviewerRun: { findings },
    synthesisOptions,
    finalDecision: { verdict },
    output: { markdown }
  };
}

function finding(overrides = {}) {
  return {
    finding_id: "finding-security",
    reviewer_id: "security",
    severity: "BLOCKER",
    claim: "The new token logging path can expose credentials in application logs.",
    evidence: {
      file_path: "src/auth/session.js",
      line_start: 2,
      line_end: 2,
      snippet: "logger.info({ token: session.token });"
    },
    impact: "A user session token could be captured by log aggregation and reused by compromised log readers.",
    suggested_fix: "Remove the token field from the log payload or replace it with a non-sensitive token identifier.",
    verification_test: "Add a test that creates a session and asserts the emitted log payload does not contain the raw token.",
    confidence: "HIGH",
    related_quality_rules: ["security.no_new_risk"],
    tags: ["security"],
    ...overrides
  };
}
