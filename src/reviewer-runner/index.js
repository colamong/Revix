import { validateFindings } from "../findings/index.js";

export class ReviewerRunError extends Error {
  constructor(message, { reviewerId, cause } = {}) {
    super(message);
    this.name = "ReviewerRunError";
    this.reviewerId = reviewerId;
    this.cause = cause;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      reviewerId: this.reviewerId,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        code: this.cause.code,
        details: this.cause.details
      } : undefined
    };
  }
}

export async function runSelectedReviewers({ prInput, classification, selectedReviewers, runner, continueOnError = false }) {
  if (typeof runner !== "function") {
    throw new ReviewerRunError("runner must be a function");
  }
  const results = [];
  const errors = [];

  for (const selected of selectedReviewers) {
    try {
      const rawFindings = await runner({
        prInput,
        classification,
        reviewer: selected.skill,
        selection: selected
      });
      const normalizedFindings = validateFindings(rawFindings ?? [], selected.scope_context);
      results.push(Object.freeze({
        reviewer_id: selected.reviewer_id,
        findings: normalizedFindings
      }));
    } catch (error) {
      const wrapped = new ReviewerRunError(`reviewer failed: ${selected.reviewer_id}`, {
        reviewerId: selected.reviewer_id,
        cause: error
      });
      if (!continueOnError) {
        throw wrapped;
      }
      errors.push(wrapped);
    }
  }

  return Object.freeze({
    results: Object.freeze(results.sort((left, right) => left.reviewer_id.localeCompare(right.reviewer_id))),
    findings: Object.freeze(results.flatMap((result) => [...result.findings]).sort((left, right) => left.finding_id.localeCompare(right.finding_id))),
    errors: Object.freeze(errors)
  });
}
