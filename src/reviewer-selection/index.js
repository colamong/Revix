import { forcedReviewersForLabels, shouldSkipReview } from "../config/index.js";
import { createFindingValidationContext } from "../reviewer-skills/index.js";

export class ReviewerSelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewerSelectionError";
  }
}

const TYPE_REVIEWERS = Object.freeze({
  feature: ["architecture", "test"],
  bugfix: ["reliability", "test"],
  refactor: ["architecture", "readability", "test"],
  test_only: ["test"],
  docs_only: ["documentation"],
  config_change: ["reliability", "documentation"],
  security_sensitive: ["security", "test"],
  contract_change: ["contract", "test"],
  performance_sensitive: ["performance", "test"],
  mixed: ["architecture", "test"]
});

export function selectReviewers({ prInput, classification, config, skills, qualityRules }) {
  const skillsById = new Map(skills.map((skill) => [skill.reviewer_id, skill]));
  const labels = prInput.metadata.labels;
  const forced = forcedReviewersForLabels(config, labels);
  const hasSkipLabel = config.labels.skip.some((label) => labels.includes(label));
  if (shouldSkipReview(config, labels)) {
    return Object.freeze([]);
  }

  const selected = new Map();
  const add = (reviewerId, reason, matchedSignals = []) => {
    if (config.reviewers.disabled.includes(reviewerId)) return;
    if (config.reviewers.enabled.length > 0 && !config.reviewers.enabled.includes(reviewerId)) return;
    const skill = skillsById.get(reviewerId);
    if (!skill) {
      throw new ReviewerSelectionError(`unknown reviewer selected: ${reviewerId}`);
    }
    selected.set(reviewerId, {
      reviewer_id: reviewerId,
      reason,
      matched_signals: Object.freeze(matchedSignals),
      skill,
      scope_context: createFindingValidationContext(skill, qualityRules)
    });
  };

  if (!hasSkipLabel) {
    for (const reviewerId of TYPE_REVIEWERS[classification.primary_type] ?? []) {
      add(reviewerId, `primary type ${classification.primary_type}`, classification.signals);
    }
    for (const type of classification.secondary_types) {
      for (const reviewerId of TYPE_REVIEWERS[type] ?? []) {
        add(reviewerId, `secondary type ${type}`, classification.signals.filter((signal) => signal.type === type));
      }
    }
    for (const signal of classification.signals) {
      for (const reviewerId of TYPE_REVIEWERS[signal.type] ?? []) {
        add(reviewerId, `matched ${signal.type} signal`, [signal]);
      }
    }
  }
  for (const reviewerId of forced) {
    if (!skillsById.has(reviewerId)) {
      throw new ReviewerSelectionError(`unknown forced reviewer: ${reviewerId}`);
    }
    add(reviewerId, "forced by label", []);
  }

  return Object.freeze([...selected.values()].sort((left, right) => left.reviewer_id.localeCompare(right.reviewer_id)).map(freezeSelection));
}

function freezeSelection(selection) {
  return Object.freeze({
    reviewer_id: selection.reviewer_id,
    reason: selection.reason,
    matched_signals: selection.matched_signals,
    skill: selection.skill,
    scope_context: selection.scope_context
  });
}
