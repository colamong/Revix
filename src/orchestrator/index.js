import { classifyPr } from "../classification/index.js";
import { detectConflicts } from "../conflicts/index.js";
import { loadDefaultConstitution, mergeConstitution } from "../constitution/index.js";
import { evaluateFinalDecision } from "../decision/index.js";
import { validatePrInput } from "../pr-input/index.js";
import { renderGitHubReviewComment } from "../renderers/github-comment/index.js";
import { runSelectedReviewers } from "../reviewer-runner/index.js";
import { selectReviewers } from "../reviewer-selection/index.js";
import { loadEffectiveReviewerSkills } from "../reviewer-skills/index.js";
import { loadRevixConfig } from "../config/index.js";
import { generateSynthesisOptions } from "../synthesis/index.js";

export class RevixOrchestratorError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "RevixOrchestratorError";
    this.cause = cause;
  }
}

export async function runRevixReview(input, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const config = options.config ?? loadRevixConfig(projectRoot);
  const qualityRules = options.qualityRules ?? loadQualityRules(projectRoot, config);
  const runner = options.runner ?? emptyRunner;
  const outputFormat = options.outputFormat ?? config.output.format;

  const prInput = validatePrInput(input);
  const classification = classifyPr(prInput, config);
  const skills = options.skills ?? loadEffectiveReviewerSkills(projectRoot, qualityRules);
  const selectedReviewers = selectReviewers({
    prInput,
    classification,
    config,
    skills,
    qualityRules
  });
  const reviewerRun = await runSelectedReviewers({
    prInput,
    classification,
    selectedReviewers,
    runner,
    continueOnError: options.continueOnError ?? false
  });
  const conflicts = detectConflicts(reviewerRun.findings);
  const synthesisOptions = generateSynthesisOptions({
    findings: reviewerRun.findings,
    conflicts
  });
  const finalDecision = evaluateFinalDecision({
    qualityRules,
    findings: reviewerRun.findings,
    conflicts,
    synthesisOptions
  });
  const rendered = renderGitHubReviewComment({
    prInput,
    classification,
    selectedReviewers,
    findings: reviewerRun.findings,
    conflicts,
    synthesisOptions,
    finalDecision
  });

  return Object.freeze({
    prInput,
    classification,
    selectedReviewers,
    reviewerRun,
    conflicts,
    synthesisOptions,
    finalDecision,
    output: Object.freeze({
      format: outputFormat,
      markdown: rendered.markdown,
      json: rendered.json
    })
  });
}

function loadQualityRules(projectRoot, config) {
  return mergeConstitution(loadDefaultConstitution(), {
    constitution: config.quality.overrides
  });
}

function emptyRunner() {
  return [];
}
