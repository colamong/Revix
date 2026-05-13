import { collectPrGithubChangeset } from "./pr-github.js";
import { collectStagedChangeset } from "./staged.js";
import { collectWorkingTreeChangeset } from "./working-tree.js";

export { collectPrGithubChangeset } from "./pr-github.js";
export { collectStagedChangeset } from "./staged.js";
export { collectWorkingTreeChangeset } from "./working-tree.js";
export { GitSourceError } from "./git-utils.js";

export const SOURCE_TYPES = Object.freeze(["pr", "working-tree", "staged"]);

export async function collectChangeset(source, options = {}) {
  if (!source || typeof source !== "object") {
    throw new Error("collectChangeset requires a source object with a type field");
  }
  switch (source.type) {
    case "pr":
      return collectPrGithubChangeset(source, options);
    case "working-tree":
      return collectWorkingTreeChangeset(source, options);
    case "staged":
      return collectStagedChangeset(source, options);
    default:
      throw new Error(`unknown changeset source type: ${source.type}`);
  }
}
