export class ReviewQualityEvaluationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewQualityEvaluationError";
  }
}

export const RQS_WEIGHTS = Object.freeze({
  detection: 0.35,
  precision: 0.20,
  evidence: 0.15,
  severity: 0.10,
  actionability: 0.10,
  decision: 0.05,
  noise: 0.05
});

const SEVERITY_ORDER = Object.freeze(["NIT", "QUESTION", "MINOR", "MAJOR", "BLOCKER"]);
const BLOCKING_VERDICTS = new Set(["REQUEST_CHANGES", "BLOCK"]);
const BLOCKING_SEVERITIES = new Set(["MAJOR", "BLOCKER"]);
const LINE_LEVEL_MATCH_THRESHOLD = 0.45;
const FILE_LEVEL_MATCH_THRESHOLD = 0.30;
const BREAKDOWN_CATEGORIES = Object.freeze(["correctness", "security", "contract", "test", "docs", "performance"]);
const CATEGORY_WEIGHTS = Object.freeze({
  security: 2,
  privacy: 2,
  data_loss: 2,
  data: 2,
  contract: 2,
  correctness: 1.5,
  reliability: 1.5,
  performance: 1.5,
  test: 1,
  docs: 1,
  documentation: 1,
  completeness: 1,
  readability: 1,
  style: 0.25,
  nit: 0.25
});

export async function evaluateReviewQuality({ evalCase, reviewResult }) {
  validateEvalCase(evalCase);
  const findings = reviewResult?.reviewerRun?.findings ?? reviewResult?.findings ?? [];
  const synthesisOptions = reviewResult?.synthesisOptions ?? reviewResult?.synthesis_options ?? [];
  const finalDecision = reviewResult?.finalDecision ?? reviewResult?.final_decision ?? {};
  const outputMarkdown = reviewResult?.output?.markdown ?? reviewResult?.markdown ?? "";
  const matches = await matchExpectedIssues(evalCase.expected_issues, findings);
  const matchableExpectedIssues = evalCase.expected_issues.filter((issue) => !isLowMatchabilityIssue(issue));
  const matchableMatches = matches.filter((match) => !isLowMatchabilityIssue(match.expected_issue));
  const skippedIssues = evalCase.expected_issues.filter(isLowMatchabilityIssue);
  const matchDiagnostics = await matchDiagnosticsFor(matchableExpectedIssues, findings, matchableMatches);
  const lowMatchedFindingIds = new Set(matches
    .filter((match) => isLowMatchabilityIssue(match.expected_issue) && match.matched)
    .map((match) => match.finding.finding_id));
  const matchableFindings = findings.filter((finding) => !lowMatchedFindingIds.has(finding.finding_id));
  const detection = scoreDetection(matchableExpectedIssues, matchableMatches);
  const precision = scorePrecision(matchableFindings, matchableMatches);
  const evidence = scoreEvidence(matchableExpectedIssues, matchableMatches);
  const severity = scoreSeverity(matchableExpectedIssues, matchableMatches);
  const actionability = scoreActionability(matchableMatches, matchableFindings);
  const decision = scoreDecision(evalCase.expected_verdict, finalDecision.verdict);
  const noise = scoreNoise({ findings, matches, synthesisOptions, outputMarkdown });
  const subScores = { detection, precision, evidence, severity, actionability, decision, noise };
  const rqs = weightedScore(subScores);
  const categoryRecall = categoryRecallFor(matchableExpectedIssues, matchableMatches);
  const categoryBreakdown = categoryBreakdownFor(matchableExpectedIssues, matchableMatches);

  return deepFreeze({
    eval_id: evalCase.eval_id,
    rqs,
    sub_scores: subScores,
    metric_applicability: metricApplicability({ matchableExpectedIssues, matchableMatches, matchableFindings }),
    precision_recall_f1: precisionRecallF1(detection, precision),
    category_recall: categoryRecall,
    category_breakdown: categoryBreakdown,
    match_diagnostics: matchDiagnostics,
    severity_confusion: severityConfusion(matchableExpectedIssues, matchableMatches),
    matches,
    missed_issues: missedIssues(matchableExpectedIssues, matchableMatches),
    skipped_issues: Object.freeze(skippedIssues.map(freezeIssue)),
    false_positives: falsePositives(findings, matches),
    expected_verdict: evalCase.expected_verdict,
    actual_verdict: finalDecision.verdict ?? "UNKNOWN"
  });
}

export function evaluateReviewQualitySuite(results) {
  if (!Array.isArray(results)) {
    throw new ReviewQualityEvaluationError("results must be an array");
  }
  const cases = results.map((item) => item.evaluation ?? item);
  const average = (field) => {
    const applicable = cases.filter((item) => metricApplies(item, field));
    if (applicable.length === 0) return 0;
    return round(applicable.reduce((sum, item) => sum + item.sub_scores[field], 0) / applicable.length);
  };
  const subScores = Object.fromEntries(Object.keys(RQS_WEIGHTS).map((field) => [field, average(field)]));
  const totalExpected = cases.reduce((sum, item) => sum + item.matches.filter((match) => !isLowMatchabilityIssue(match.expected_issue)).length + item.missed_issues.length, 0);
  const totalMatched = cases.reduce((sum, item) => sum + item.matches.filter((match) => !isLowMatchabilityIssue(match.expected_issue) && match.matched).length, 0);
  const totalFindings = cases.reduce((sum, item) => sum + item.matches.filter((match) => !isLowMatchabilityIssue(match.expected_issue) && match.matched).length + item.false_positives.length, 0);
  const recall = totalExpected === 0 ? 100 : round((totalMatched / totalExpected) * 100);
  const precision = totalFindings === 0 ? (totalExpected === 0 ? 100 : 0) : round((totalMatched / totalFindings) * 100);
  const f1 = precision + recall === 0 ? 0 : round((2 * precision * recall) / (precision + recall));

  return deepFreeze({
    rqs: weightedScore(subScores),
    sub_scores: subScores,
    precision_recall_f1: { precision, recall, f1 },
    category_breakdown: aggregateCategoryBreakdown(cases),
    cases
  });
}

export function renderReviewQualityReport(evaluation) {
  const lines = [];
  lines.push(`# Revix Review Quality: ${evaluation.rqs}/100`);
  lines.push("");
  lines.push(`Precision: ${evaluation.precision_recall_f1.precision}`);
  lines.push(`Recall: ${evaluation.precision_recall_f1.recall}`);
  lines.push(`F1: ${evaluation.precision_recall_f1.f1}`);
  lines.push("");
  lines.push("## Sub-Scores");
  for (const [key, value] of Object.entries(evaluation.sub_scores)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Category Breakdown");
  lines.push("");
  lines.push("| Category | Expected | Matched | Recall | Avg RQS |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const [category, item] of Object.entries(evaluation.category_breakdown ?? emptyCategoryBreakdown())) {
    lines.push(`| ${category} | ${item.expected} | ${item.matched} | ${item.recall} | ${item.avg_rqs} |`);
  }
  lines.push("");
  lines.push("## Skipped Issues (low matchability)");
  if ((evaluation.skipped_issues ?? []).length === 0) {
    lines.push("- None.");
  } else {
    lines.push(`- Skipped issues (low matchability): ${evaluation.skipped_issues.length}`);
    for (const issue of evaluation.skipped_issues) {
      lines.push(`- ${issue.issue_id}: ${issue.claim}`);
    }
  }
  lines.push("");
  lines.push("## Missed Issues");
  if (evaluation.missed_issues.length === 0) {
    lines.push("- None.");
  } else {
    for (const issue of evaluation.missed_issues) {
      lines.push(`- ${issue.issue_id}: ${issue.claim}`);
    }
  }
  lines.push("");
  lines.push("## False Positives");
  if (evaluation.false_positives.length === 0) {
    lines.push("- None.");
  } else {
    for (const finding of evaluation.false_positives) {
      lines.push(`- ${finding.finding_id}: ${finding.claim}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function matchExpectedIssues(expectedIssues = [], findings = []) {
  const available = new Set(findings.map((finding) => finding.finding_id));
  const matches = [];
  for (const issue of expectedIssues) {
    let best = null;
    for (const finding of findings) {
      if (!available.has(finding.finding_id)) continue;
      const score = await matchScore(issue, finding);
      if (!best || score.total > best.score) {
        best = { finding, score: score.total, details: score.details };
      }
    }
    if (best && best.score >= matchThreshold(issue)) {
      available.delete(best.finding.finding_id);
      matches.push(freezeMatch(issue, best.finding, best.score, best.details));
    } else {
      matches.push(freezeMatch(issue, null, 0, null));
    }
  }
  return Object.freeze(matches);
}

export async function matchScore(issue, finding) {
  const fileScore = fileMatchScore(issue.file_path, finding.evidence?.file_path);
  const lineScore = lineMatchScore(issue, finding);
  const claimScore = await claimMatchScore(issue, finding);
  const categoryScore = categoryMatchScore(issue, finding, { fileScore, lineScore });
  const total = isFileLevelIssue(issue)
    ? roundRatio((fileScore * 0.35) + (claimScore * 0.45) + (categoryScore * 0.20))
    : roundRatio((fileScore * 0.25) + (lineScore * 0.25) + (claimScore * 0.35) + (categoryScore * 0.15));
  return {
    total,
    details: {
      file: roundRatio(fileScore),
      line: roundRatio(lineScore),
      claim: roundRatio(claimScore),
      category: roundRatio(categoryScore)
    }
  };
}

function isFileLevelIssue(issue) {
  return issue?.line_start === 1 && issue?.line_end === 1;
}

function matchThreshold(issue) {
  return isFileLevelIssue(issue) ? FILE_LEVEL_MATCH_THRESHOLD : LINE_LEVEL_MATCH_THRESHOLD;
}

function fileMatchScore(expectedPath, actualPath) {
  if (!expectedPath || !actualPath) return 0;
  if (actualPath === expectedPath) return 1;
  if (expectedPath.endsWith(`/${actualPath}`) || actualPath.endsWith(`/${expectedPath}`)) return 0.8;
  const expectedBase = expectedPath.split(/[\\/]/).pop();
  const actualBase = actualPath.split(/[\\/]/).pop();
  return expectedBase && expectedBase === actualBase ? 0.6 : 0;
}

function scoreDetection(expectedIssues, matches) {
  const totalWeight = expectedIssues.reduce((sum, issue) => sum + issueWeight(issue), 0);
  if (totalWeight === 0) return 100;
  const detected = matches.reduce((sum, match) => sum + (issueWeight(match.expected_issue) * match.match_score), 0);
  return round((detected / totalWeight) * 100);
}

function scorePrecision(findings, matches) {
  if (findings.length === 0) {
    return matches.length === 0 ? 100 : 0;
  }
  const matchedCredit = matches.filter((match) => match.matched).reduce((sum, match) => sum + match.match_score, 0);
  const penalty = falsePositives(findings, matches).reduce((sum, finding) => sum + falsePositivePenalty(finding), 0);
  return clampScore(((matchedCredit - penalty) / findings.length) * 100);
}

function scoreEvidence(expectedIssues, matches) {
  if (expectedIssues.length === 0) return 100;
  const totalWeight = expectedIssues.reduce((sum, issue) => sum + issueWeight(issue), 0);
  const evidenceCredit = matches.reduce((sum, match) => {
    const score = match.matched ? ((match.match_details.file * 0.4) + (match.match_details.line * 0.6)) : 0;
    return sum + (issueWeight(match.expected_issue) * score);
  }, 0);
  return round((evidenceCredit / totalWeight) * 100);
}

function scoreSeverity(expectedIssues, matches) {
  if (expectedIssues.length === 0) return 100;
  const totalWeight = expectedIssues.reduce((sum, issue) => sum + issueWeight(issue), 0);
  const severityCredit = matches.reduce((sum, match) => {
    const score = match.matched ? severityScore(match.expected_issue.severity, match.finding.severity) : 0;
    return sum + (issueWeight(match.expected_issue) * score);
  }, 0);
  return round((severityCredit / totalWeight) * 100);
}

function scoreActionability(matches, findings) {
  if (findings.length === 0) return matches.length === 0 ? 100 : 0;
  const matched = matches.filter((match) => match.matched);
  if (matched.length === 0) return 0;
  const score = matched.reduce((sum, match) => sum + actionabilityScore(match.finding), 0) / matched.length;
  return round(score * 100);
}

function scoreDecision(expectedVerdict, actualVerdict) {
  if (!expectedVerdict) return 100;
  if (expectedVerdict === actualVerdict) return 100;
  if (BLOCKING_VERDICTS.has(expectedVerdict) && BLOCKING_VERDICTS.has(actualVerdict)) return 70;
  if (!BLOCKING_VERDICTS.has(expectedVerdict) && !BLOCKING_VERDICTS.has(actualVerdict)) return 70;
  return 0;
}

function scoreNoise({ findings, matches, synthesisOptions, outputMarkdown }) {
  let score = 100;
  const matchedFindingIds = new Set(matches.filter((match) => match.matched).map((match) => match.finding.finding_id));
  const duplicateCount = duplicateFindings(findings).length;
  const falsePositiveCount = findings.filter((finding) => !matchedFindingIds.has(finding.finding_id)).length;
  score -= duplicateCount * 15;
  score -= falsePositiveCount * 10;
  if (synthesisOptions.length > Math.max(5, findings.length * 3)) score -= 15;
  if (outputMarkdown.length > 5000) score -= 10;
  if (findings.some((finding) => finding.confidence === "LOW" && BLOCKING_SEVERITIES.has(finding.severity))) score -= 25;
  return clampScore(score);
}

function weightedScore(subScores) {
  return round(Object.entries(RQS_WEIGHTS).reduce((sum, [key, weight]) => sum + (subScores[key] * weight), 0));
}

function precisionRecallF1(detection, precision) {
  const recall = detection;
  const f1 = precision + recall === 0 ? 0 : round((2 * precision * recall) / (precision + recall));
  return { precision, recall, f1 };
}

function metricApplicability({ matchableExpectedIssues, matchableMatches, matchableFindings }) {
  const hasExpected = matchableExpectedIssues.length > 0;
  const hasFindings = matchableFindings.length > 0;
  const hasMatchedFindings = matchableMatches.some((match) => match.matched);
  return Object.freeze({
    detection: hasExpected,
    precision: hasExpected || hasFindings,
    evidence: hasExpected,
    severity: hasExpected,
    actionability: hasMatchedFindings,
    decision: true,
    noise: true
  });
}

function metricApplies(evaluation, field) {
  if (evaluation.metric_applicability && field in evaluation.metric_applicability) {
    return evaluation.metric_applicability[field];
  }
  if (["detection", "evidence", "severity"].includes(field)) {
    return evaluation.matches.some((match) => !isLowMatchabilityIssue(match.expected_issue));
  }
  if (field === "precision") {
    return evaluation.matches.some((match) => !isLowMatchabilityIssue(match.expected_issue)) || evaluation.false_positives.length > 0;
  }
  if (field === "actionability") {
    return evaluation.matches.some((match) => !isLowMatchabilityIssue(match.expected_issue) && match.matched);
  }
  return true;
}

function categoryRecallFor(expectedIssues, matches) {
  const categories = new Map();
  for (const issue of expectedIssues) {
    const category = issue.category;
    const entry = categories.get(category) ?? { detected: 0, total: 0 };
    entry.total += issueWeight(issue);
    categories.set(category, entry);
  }
  for (const match of matches) {
    const category = match.expected_issue.category;
    const entry = categories.get(category);
    entry.detected += issueWeight(match.expected_issue) * match.match_score;
  }
  return Object.freeze(Object.fromEntries([...categories.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, entry]) => [
    category,
    round((entry.detected / entry.total) * 100)
  ])));
}

function categoryBreakdownFor(expectedIssues, matches) {
  const entries = emptyCategoryBreakdown();
  const matchesByIssue = new Map(matches.map((match) => [match.expected_issue.issue_id, match]));
  for (const issue of expectedIssues) {
    if (!entries[issue.category]) continue;
    const entry = entries[issue.category];
    const match = matchesByIssue.get(issue.issue_id);
    entry.expected += 1;
    if (match?.matched) entry.matched += 1;
    entry._score += match?.matched ? match.match_score * 100 : 0;
  }
  return finalizeCategoryBreakdown(entries);
}

function aggregateCategoryBreakdown(cases) {
  const entries = emptyCategoryBreakdown();
  for (const evaluation of cases) {
    const breakdown = evaluation.category_breakdown ?? emptyCategoryBreakdown();
    for (const category of BREAKDOWN_CATEGORIES) {
      const source = breakdown[category] ?? { expected: 0, matched: 0, avg_rqs: 0 };
      const entry = entries[category];
      entry.expected += source.expected;
      entry.matched += source.matched;
      entry._score += source.avg_rqs * source.expected;
    }
  }
  return finalizeCategoryBreakdown(entries);
}

function emptyCategoryBreakdown() {
  return Object.fromEntries(BREAKDOWN_CATEGORIES.map((category) => [
    category,
    { expected: 0, matched: 0, recall: 0, avg_rqs: 0, _score: 0 }
  ]));
}

function finalizeCategoryBreakdown(entries) {
  return Object.freeze(Object.fromEntries(BREAKDOWN_CATEGORIES.map((category) => {
    const entry = entries[category];
    return [category, Object.freeze({
      expected: entry.expected,
      matched: entry.matched,
      recall: entry.expected === 0 ? 0 : round((entry.matched / entry.expected) * 100),
      avg_rqs: entry.expected === 0 ? 0 : round(entry._score / entry.expected)
    })];
  })));
}

function severityConfusion(expectedIssues, matches) {
  const rows = {};
  for (const severity of SEVERITY_ORDER) {
    rows[severity] = Object.fromEntries(SEVERITY_ORDER.map((candidate) => [candidate, 0]));
    rows[severity].MISSED = 0;
  }
  for (const match of matches) {
    const expected = match.expected_issue.severity;
    const actual = match.matched ? match.finding.severity : "MISSED";
    rows[expected][actual] += 1;
  }
  return deepFreeze(rows);
}

function missedIssues(expectedIssues, matches) {
  const matchedIssueIds = new Set(matches.filter((match) => match.matched).map((match) => match.expected_issue.issue_id));
  return Object.freeze(expectedIssues.filter((issue) => !matchedIssueIds.has(issue.issue_id)).map(freezeIssue));
}

function falsePositives(findings, matches) {
  const matchedFindingIds = new Set(matches.filter((match) => match.matched).map((match) => match.finding.finding_id));
  return Object.freeze(findings.filter((finding) => !matchedFindingIds.has(finding.finding_id)).map((finding) => Object.freeze({
    finding_id: finding.finding_id,
    reviewer_id: finding.reviewer_id,
    severity: finding.severity,
    claim: finding.claim,
    evidence: finding.evidence
  })));
}

async function matchDiagnosticsFor(expectedIssues, findings, matches) {
  const matchesByIssue = new Map(matches.map((match) => [match.expected_issue.issue_id, match]));
  const diagnostics = [];
  for (const issue of expectedIssues) {
    const match = matchesByIssue.get(issue.issue_id);
    let best = null;
    for (const finding of findings) {
      const score = await matchScore(issue, finding);
      if (!best || score.total > best.score) {
        best = { finding, score: score.total, details: score.details };
      }
    }
    const threshold = matchThreshold(issue);
    diagnostics.push(Object.freeze({
      issue_id: issue.issue_id,
      category: issue.category,
      threshold,
      matched: Boolean(match?.matched),
      match_score: match?.match_score ?? 0,
      miss_reason: match?.matched ? "matched" : matchMissReason({ issue, best, threshold }),
      expected_issue: freezeIssue(issue),
      top_candidate: best ? freezeDiagnosticCandidate(best.finding, best.score, best.details) : null
    }));
  }
  return Object.freeze(diagnostics);
}

function freezeDiagnosticCandidate(finding, score, details) {
  return Object.freeze({
    finding_id: finding.finding_id,
    reviewer_id: finding.reviewer_id,
    claim: finding.claim,
    evidence: Object.freeze({ ...finding.evidence }),
    score: roundRatio(score),
    details: Object.freeze({
      file: roundRatio(details.file),
      line: roundRatio(details.line),
      claim: roundRatio(details.claim),
      category: roundRatio(details.category)
    })
  });
}

function matchMissReason({ issue, best, threshold }) {
  if (!best) return "no_candidate";
  if (best.score >= threshold) return "matched";
  if (best.details.file <= 0.5) return "file_mismatch";
  if (!isFileLevelIssue(issue) && best.details.line <= 0.5) return "line_mismatch";
  if (best.details.claim < 0.6) return "claim_mismatch";
  if (best.details.category === 0) return "category_mismatch";
  return "below_threshold";
}

function issueWeight(issue) {
  if (typeof issue.weight === "number" && issue.weight > 0) return issue.weight;
  return CATEGORY_WEIGHTS[issue.category] ?? 1;
}

function isLowMatchabilityIssue(issue) {
  return issue?.matchability === "low";
}

function lineMatchScore(issue, finding) {
  if (!issue.line_start || !issue.line_end || !finding.evidence?.line_start || !finding.evidence?.line_end) return 0;
  if (rangesOverlap(issue.line_start, issue.line_end, finding.evidence.line_start, finding.evidence.line_end)) return 1;
  const distance = Math.min(
    Math.abs(issue.line_start - finding.evidence.line_end),
    Math.abs(finding.evidence.line_start - issue.line_end)
  );
  if (distance <= 2) return 0.8;
  if (distance <= 5) return 0.5;
  return 0;
}

async function claimMatchScore(issue, finding) {
  const issueClaims = [issue.claim, ...(issue.allowed_claims ?? [])].filter(Boolean);
  const findingText = `${finding.claim} ${finding.impact} ${finding.suggested_fix}`.toLowerCase();
  let best = 0;
  for (const claim of issueClaims) {
    best = Math.max(best, tokenOverlap(claim.toLowerCase(), findingText));
  }
  if (issue.root_cause) {
    best = Math.max(best, tokenOverlap(issue.root_cause.toLowerCase(), findingText));
  }
  return best;
}

function categoryMatchScore(issue, finding, { fileScore = 0, lineScore = 0 } = {}) {
  const values = new Set([
    ...(finding.tags ?? []),
    ...(finding.related_quality_rules ?? []).map((ruleId) => ruleId.split(".")[0]),
    finding.reviewer_id
  ].filter(Boolean));
  if (values.has(issue.category)) return 1;
  if (issue.category === "docs" && values.has("documentation")) return 1;
  if (issue.category === "data_loss" && (values.has("data") || values.has("privacy"))) return 0.7;
  return fileScore > 0.5 && lineScore > 0.5 ? 0.5 : 0;
}

function severityScore(expected, actual) {
  if (expected === actual) return 1;
  const expectedRank = SEVERITY_ORDER.indexOf(expected);
  const actualRank = SEVERITY_ORDER.indexOf(actual);
  if (expectedRank === -1 || actualRank === -1) return 0;
  const crossesBlockingBoundary = BLOCKING_SEVERITIES.has(expected) !== BLOCKING_SEVERITIES.has(actual);
  if (crossesBlockingBoundary) return 0.2;
  const distance = Math.abs(expectedRank - actualRank);
  if (distance === 1) return 0.7;
  if (distance === 2) return 0.4;
  return 0;
}

function actionabilityScore(finding) {
  let score = 0;
  if (concreteText(finding.suggested_fix)) score += 0.45;
  if (concreteText(finding.verification_test)) score += 0.35;
  if (concreteText(finding.impact)) score += 0.20;
  return score;
}

function falsePositivePenalty(finding) {
  if (!finding.evidence?.file_path || !finding.evidence?.line_start) return 0.5;
  if (BLOCKING_SEVERITIES.has(finding.severity)) return 1;
  return actionabilityScore(finding) >= 0.6 ? 0.25 : 0.5;
}

function duplicateFindings(findings) {
  const seen = new Set();
  const duplicates = [];
  for (const finding of findings) {
    const key = `${finding.evidence?.file_path}:${finding.evidence?.line_start}:${normalizeTokens(finding.claim).slice(0, 5).join(" ")}`;
    if (seen.has(key)) duplicates.push(finding);
    seen.add(key);
  }
  return duplicates;
}

function tokenOverlap(left, right) {
  const leftTokens = new Set(normalizeTokens(left));
  const rightTokens = new Set(normalizeTokens(right));
  if (leftTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / leftTokens.size;
}

function normalizeTokens(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["the", "and", "for", "that", "this", "with", "from", "into", "could", "should", "would"].includes(token));
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function concreteText(value) {
  return typeof value === "string" && value.trim().length >= 20 && !/\b(fix this|bad|unclear|maybe)\b/i.test(value);
}

function freezeMatch(issue, finding, score, details) {
  return Object.freeze({
    expected_issue: freezeIssue(issue),
    finding: finding ? Object.freeze({
      finding_id: finding.finding_id,
      reviewer_id: finding.reviewer_id,
      severity: finding.severity,
      claim: finding.claim,
      evidence: finding.evidence,
      impact: finding.impact,
      suggested_fix: finding.suggested_fix,
      verification_test: finding.verification_test,
      confidence: finding.confidence
    }) : null,
    matched: Boolean(finding),
    match_score: roundRatio(score),
    match_details: details ? Object.freeze(details) : null
  });
}

function freezeIssue(issue) {
  return Object.freeze({
    issue_id: issue.issue_id,
    category: issue.category,
    severity: issue.severity,
    claim: issue.claim,
    file_path: issue.file_path,
    line_start: issue.line_start,
    line_end: issue.line_end,
    weight: issueWeight(issue),
    matchability: issue.matchability
  });
}

function validateEvalCase(evalCase) {
  if (!evalCase || typeof evalCase !== "object") {
    throw new ReviewQualityEvaluationError("evalCase must be an object");
  }
  if (typeof evalCase.eval_id !== "string" || evalCase.eval_id.trim() === "") {
    throw new ReviewQualityEvaluationError("evalCase.eval_id is required");
  }
  if (!Array.isArray(evalCase.expected_issues)) {
    throw new ReviewQualityEvaluationError("evalCase.expected_issues must be an array");
  }
  for (const issue of evalCase.expected_issues) {
    validateExpectedIssue(issue);
  }
}

function validateExpectedIssue(issue) {
  for (const key of ["issue_id", "category", "severity", "claim", "file_path", "line_start", "line_end"]) {
    if (!(key in issue)) throw new ReviewQualityEvaluationError(`expected issue missing ${key}`);
  }
  if (!SEVERITY_ORDER.includes(issue.severity)) {
    throw new ReviewQualityEvaluationError(`expected issue has invalid severity: ${issue.severity}`);
  }
}

function clampScore(value) {
  return round(Math.max(0, Math.min(100, value)));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value) {
  return Math.round(value * 1000) / 1000;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
