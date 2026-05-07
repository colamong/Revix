export class PromptBuilderError extends Error {
  constructor(message) {
    super(message);
    this.name = "PromptBuilderError";
  }
}

const FINDING_OUTPUT_SCHEMA = Object.freeze({
  type: "array",
  items: Object.freeze({
    type: "object",
    required: Object.freeze([
      "finding_id",
      "reviewer_id",
      "severity",
      "claim",
      "evidence",
      "impact",
      "suggested_fix",
      "verification_test",
      "confidence",
      "related_quality_rules",
      "tags"
    ])
  })
});

export function buildReviewerPrompt({ prInput, classification, selectedReviewer, qualityRules = [], config = {} }) {
  if (!prInput?.metadata) {
    throw new PromptBuilderError("prInput.metadata is required");
  }
  if (!selectedReviewer?.skill) {
    throw new PromptBuilderError("selectedReviewer.skill is required");
  }
  const skill = selectedReviewer.skill;
  const allowedRuleIds = new Set(skill.allowed_scope?.quality_rules ?? []);
  const focusedRules = qualityRules
    .filter((rule) => allowedRuleIds.has(rule.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((rule) => Object.freeze({
      id: rule.id,
      kind: rule.kind,
      category: rule.category,
      description: rule.description,
      tags: [...rule.tags].sort(),
      severity_behavior: rule.severityBehavior
    }));

  return deepFreeze({
    schema_version: 1,
    task: "revix_reviewer_findings",
    output_contract: {
      format: "json_only",
      schema: FINDING_OUTPUT_SCHEMA,
      instructions: [
        "Return only machine-parseable JSON.",
        "Return an empty array when there are no findings.",
        "Do not include prose, markdown, or hidden reasoning."
      ]
    },
    reviewer: {
      reviewer_id: skill.reviewer_id,
      display_name: skill.display_name,
      responsibility: skill.responsibility,
      background: skill.background,
      bias: [...skill.bias],
      flexibility_score: skill.flexibility_score,
      allowed_scope: cloneScope(skill.allowed_scope),
      forbidden_scope: cloneForbiddenScope(skill.forbidden_scope),
      severity_policy: cloneSeverityPolicy(skill.severity_policy),
      quality_rules_focus: [...skill.quality_rules_focus].sort(),
      prompt_instructions: [...skill.prompt_instructions]
    },
    review_context: {
      pr: {
        repo: prInput.metadata.repo,
        number: prInput.metadata.number,
        title: prInput.metadata.title,
        body: prInput.metadata.body,
        author: prInput.metadata.author,
        labels: [...prInput.metadata.labels].sort(),
        base_ref: prInput.metadata.base_ref,
        head_ref: prInput.metadata.head_ref
      },
      classification: classification ? {
        primary_type: classification.primary_type,
        secondary_types: [...classification.secondary_types],
        legacy_primary_type: classification.legacy_primary_type,
        legacy_types: [...(classification.legacy_types ?? [])],
        confidence: classification.confidence,
        rationale: classification.rationale,
        signals: [...classification.signals].map((item) => ({ ...item }))
      } : null,
      changed_files: [...prInput.changed_files]
        .map((file) => ({
          path: file.path,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          previous_path: file.previous_path,
          binary: file.binary
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      diff: {
        raw: prInput.raw_diff,
        files: [...(prInput.diff?.files ?? [])].map((file) => ({
          file_path: file.file_path,
          hunks: file.hunks
        }))
      }
    },
    quality_rules: focusedRules,
    config_context: {
      output_format: config.output?.format,
      fail_on_request_changes: config.verdict?.fail_on_request_changes,
      ignored_paths: [...(config.paths?.ignored ?? [])].sort()
    },
    guardrails: [
      "Stay within allowed_scope.",
      "Ignore forbidden_scope.",
      "Cite evidence from changed lines or explicit PR metadata.",
      "Avoid speculation; use LOW confidence for uncertainty.",
      "Do not block on style-only issues.",
      "Mention related quality rule IDs when relevant."
    ]
  });
}

export function renderReviewerPrompt(promptObject) {
  if (!promptObject || typeof promptObject !== "object") {
    throw new PromptBuilderError("promptObject must be an object");
  }
  return JSON.stringify(promptObject, Object.keys(flattenKeys(promptObject)).sort(), 2);
}

function cloneScope(scope) {
  return {
    tags: [...(scope?.tags ?? [])].sort(),
    quality_rules: [...(scope?.quality_rules ?? [])].sort(),
    file_patterns: [...(scope?.file_patterns ?? [])].sort()
  };
}

function cloneForbiddenScope(scope) {
  return {
    tags: [...(scope?.tags ?? [])].sort(),
    note: scope?.note ?? ""
  };
}

function cloneSeverityPolicy(policy) {
  return {
    max_severity_by_tag: Object.fromEntries(Object.entries(policy?.max_severity_by_tag ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    blocker_requires: Object.fromEntries(Object.entries(policy?.blocker_requires ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    style_only_max_severity: policy?.style_only_max_severity
  };
}

function flattenKeys(value, keys = {}) {
  if (Array.isArray(value)) {
    for (const item of value) flattenKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys[key] = true;
      flattenKeys(child, keys);
    }
  }
  return keys;
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
