export class FinalComposerError extends Error {
  constructor(message) {
    super(message);
    this.name = "FinalComposerError";
  }
}

export function composeFinalReview({ prInput, classification, selectedReviewers = [], findings = [], conflicts = [], synthesisOptions = [], finalDecision, format = "github-comment" }) {
  if (!finalDecision) {
    throw new FinalComposerError("finalDecision is required");
  }
  if (!["markdown", "json", "github-comment"].includes(format)) {
    throw new FinalComposerError("format must be markdown, json, or github-comment");
  }
  const renderObject = buildRenderObject({
    prInput,
    classification,
    selectedReviewers,
    findings,
    conflicts,
    synthesisOptions,
    finalDecision
  });
  return Object.freeze({
    format,
    markdown: format === "json" ? "" : renderMarkdown({ prInput, renderObject, githubComment: format === "github-comment" }),
    json: renderObject
  });
}

export function buildRenderObject({ classification, selectedReviewers = [], findings = [], conflicts = [], synthesisOptions = [], finalDecision }) {
  return deepFreeze({
    verdict: finalDecision.verdict,
    passed: finalDecision.passed,
    classification: classification ? {
      primary_type: classification.primary_type,
      secondary_types: [...classification.secondary_types],
      legacy_primary_type: classification.legacy_primary_type,
      legacy_types: [...(classification.legacy_types ?? [])],
      confidence: classification.confidence,
      rationale: classification.rationale
    } : null,
    reviewer_coverage: selectedReviewers.map((reviewer) => ({
      reviewer_id: reviewer.reviewer_id,
      reason: reviewer.reason
    })),
    blocking_findings: findings.filter((finding) => finalDecision.blocking_finding_ids.includes(finding.finding_id)),
    non_blocking_findings: findings.filter((finding) => finalDecision.non_blocking_finding_ids.includes(finding.finding_id) && finding.severity !== "QUESTION"),
    questions: findings.filter((finding) => finding.severity === "QUESTION"),
    conflicts: conflicts.filter((conflict) => finalDecision.conflict_ids.includes(conflict.conflict_id)),
    synthesis_options: synthesisOptions.filter((option) => finalDecision.selected_option_ids.includes(option.option_id)),
    option_evaluations: finalDecision.option_evaluations ?? [],
    warnings: finalDecision.warnings
  });
}

function renderMarkdown({ prInput, renderObject, githubComment }) {
  const lines = [];
  lines.push(githubComment ? `# Revix PR Review: ${renderObject.verdict}` : `# Verdict`);
  if (!githubComment) {
    lines.push(renderObject.verdict);
  }
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
    if (renderObject.classification.legacy_types.length > 0) {
      lines.push(`- Compatibility aliases: ${renderObject.classification.legacy_types.join(", ")}`);
    }
    lines.push(`- Confidence: ${renderObject.classification.confidence}`);
    lines.push(`- Rationale: ${renderObject.classification.rationale}`);
  }

  appendReviewers(lines, renderObject.reviewer_coverage);
  appendFindingSection(lines, "Required Changes", renderObject.blocking_findings);
  appendFindingSection(lines, "Suggested Improvements", renderObject.non_blocking_findings);
  appendFindingSection(lines, "Questions", renderObject.questions);
  appendConflictSection(lines, renderObject.conflicts);
  appendSynthesisSection(lines, renderObject.synthesis_options);
  appendWarningsSection(lines, renderObject.warnings);
  lines.push("");
  lines.push("## Final Recommendation");
  lines.push(renderObject.passed ? "The PR can proceed under the current quality rules." : "Address the required changes before merge.");

  return `${lines.join("\n").trim()}\n`;
}

function appendReviewers(lines, reviewers) {
  lines.push("");
  lines.push("## Reviewer Coverage");
  if (reviewers.length === 0) {
    lines.push("- No reviewers selected.");
    return;
  }
  for (const reviewer of reviewers) {
    lines.push(`- ${reviewer.reviewer_id}: ${reviewer.reason}`);
  }
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
    if (finding.confidence === "LOW") {
      lines.push("- Confidence note: low-confidence findings are presented as uncertainty, not automatic blockers.");
    }
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
  lines.push("## Negotiated Decisions");
  if (conflicts.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const conflict of conflicts) {
    lines.push(`- ${conflict.conflict_id}: ${conflict.summary}`);
    lines.push(`  - Type: ${conflict.conflict_type ?? conflict.type}`);
    lines.push(`  - Findings: ${(conflict.involved_findings ?? conflict.finding_ids).join(", ")}`);
    lines.push(`  - Evidence: ${conflict.evidence_refs.join(", ")}`);
    if (conflict.required_resolution) {
      lines.push(`  - Required resolution: ${conflict.required_resolution}`);
    }
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
    if (option.disqualified_reason) {
      lines.push(`  - Disqualified: ${option.disqualified_reason}`);
    }
    lines.push(`  - Cost: ${option.implementation_cost}/5`);
    lines.push(`  - Risk: ${option.risk}`);
    for (const action of option.recommended_actions) {
      lines.push(`  - ${action}`);
    }
  }
}

function appendWarningsSection(lines, warnings) {
  lines.push("");
  lines.push("## Quality Constitution Check");
  if (warnings.length === 0) {
    lines.push("- No warnings.");
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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
