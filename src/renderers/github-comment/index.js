import { composeFinalReview } from "../../final-composer/index.js";

export class GitHubCommentRenderError extends Error {
  constructor(message) {
    super(message);
    this.name = "GitHubCommentRenderError";
  }
}

export function renderGitHubReviewComment(input) {
  if (!input?.finalDecision) {
    throw new GitHubCommentRenderError("finalDecision is required");
  }
  return composeFinalReview({ ...input, format: "github-comment" });
}
