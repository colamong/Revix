export class GitHubCommentRenderError extends Error {
  constructor(message) {
    super(message);
    this.name = "GitHubCommentRenderError";
  }
}

export function renderGitHubReviewComment({ prInput, classification, selectedReviewers = [], findings = [], conflicts = [], synthesisOptions = [], finalDecision }) {
  if (!finalDecision) {
    throw new GitHubCommentRenderError("finalDecision is required");
  }

  const renderObject = Object.freeze({
    verdict: finalDecision.verdict,
    passed: finalDecision.passed,
    classification: classification ? {
      primary_type: classification.primary_type,
      secondary_types: [...classification.secondary_types],
      confidence: classification.confidence,
      rationale: classification.rationale
    } : null,
    reviewer_coverage: selectedReviewers.map((reviewer) => Object.freeze({
      reviewer_id: reviewer.reviewer_id,
      reason: reviewer.reason
    })),
    blocking_findings: findings.filter((finding) => finalDecision.blocking_finding_ids.includes(finding.finding_id)),
    non_blocking_findings: findings.filter((finding) => finalDecision.non_blocking_finding_ids.includes(finding.finding_id) && finding.severity !== "QUESTION"),
    questions: findings.filter((finding) => finding.severity === "QUESTION"),
    conflicts: conflicts.filter((conflict) => finalDecision.conflict_ids.includes(conflict.conflict_id)),
    synthesis_options: synthesisOptions.filter((option) => finalDecision.selected_option_ids.includes(option.option_id)),
    warnings: finalDecision.warnings
  });

  return Object.freeze({
    format: "markdown",
    markdown: renderMarkdown({ prInput, renderObject }),
    json: renderObject
  });
}

function renderMarkdown({ prInput, renderObject }) {
  const lines = [];
  lines.push(`# Revix PR Review: ${renderObject.verdict}`);
  if (prInput?.metadata) {
    lines.push("");
    lines.push(`PR: ${prInput.metadata.repo}#${prInput.metadata.number}`);
  }
  lines.push("");
  lines.push(`Result: ${renderObject.passed ? "passed" : "attention required"}`);

  if (renderObject.classification) {
    lines.push("");
    lines.push("## Classification");
    lines.push(`- Primary type: ${renderObject.classification.primary_type}`);
    lines.push(`- Secondary types: ${renderObject.classification.secondary_types.join(", ") || "none"}`);
    lines.push(`- Confidence: ${renderObject.classification.confidence}`);
    lines.push(`- Rationale: ${renderObject.classification.rationale}`);
  }

  lines.push("");
  lines.push("## Reviewer Coverage");
  if (renderObject.reviewer_coverage.length === 0) {
    lines.push("- No reviewers selected.");
  } else {
    for (const reviewer of renderObject.reviewer_coverage) {
      lines.push(`- ${reviewer.reviewer_id}: ${reviewer.reason}`);
    }
  }

  appendFindingSection(lines, "Blocking Findings", renderObject.blocking_findings);
  appendFindingSection(lines, "Non-Blocking Findings", renderObject.non_blocking_findings);
  appendFindingSection(lines, "Questions", renderObject.questions);
  appendConflictSection(lines, renderObject.conflicts);
  appendSynthesisSection(lines, renderObject.synthesis_options);
  appendWarningsSection(lines, renderObject.warnings);

  return `${lines.join("\n").trim()}\n`;
}

function appendFindingSection(lines, title, findings) {
  lines.push("");
  lines.push(`## ${title}`);
  if (findings.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const finding of findings) {
    lines.push(`### ${finding.finding_id} (${finding.severity}, ${finding.confidence})`);
    lines.push(`- Claim: ${finding.claim}`);
    lines.push(`- Evidence: ${formatEvidence(finding.evidence)}`);
    lines.push(`- Snippet: \`${oneLine(finding.evidence.snippet)}\``);
    lines.push(`- Impact: ${finding.impact}`);
    lines.push(`- Verification test: ${finding.verification_test}`);
    lines.push(`- Suggested fix: ${finding.suggested_fix}`);
    lines.push(`- Related quality rules: ${finding.related_quality_rules.join(", ")}`);
    lines.push(`- Tags: ${finding.tags.join(", ")}`);
  }
}

function appendConflictSection(lines, conflicts) {
  lines.push("");
  lines.push("## Conflicts Requiring Resolution");
  if (conflicts.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const conflict of conflicts) {
    lines.push(`- ${conflict.conflict_id}: ${conflict.summary}`);
    lines.push(`  - Type: ${conflict.type}`);
    lines.push(`  - Findings: ${conflict.finding_ids.join(", ")}`);
    lines.push(`  - Evidence: ${conflict.evidence_refs.join(", ")}`);
  }
}

function appendSynthesisSection(lines, options) {
  lines.push("");
  lines.push("## Recommended Actions");
  if (options.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const option of options) {
    lines.push(`- ${option.option_id}: ${option.summary}`);
    for (const action of option.recommended_actions) {
      lines.push(`  - ${action}`);
    }
  }
}

function appendWarningsSection(lines, warnings) {
  lines.push("");
  lines.push("## Constitution Warnings");
  if (warnings.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const warning of warnings) {
    lines.push(`- ${warning.ruleId}: ${warning.message}`);
  }
}

function formatEvidence(evidence) {
  return `${evidence.file_path}:${evidence.line_start}-${evidence.line_end}`;
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}
