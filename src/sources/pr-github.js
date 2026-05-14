const FILES_PER_PAGE = 100;
const FILES_PAGE_LIMIT = 50;

export async function collectPrGithubChangeset(source, options = {}) {
  const api = source.api ?? options.api;
  const event = source.event ?? options.event;
  const pr = source.pr ?? event?.pull_request;
  if (!api || !event || !pr) {
    throw new Error("pr-github source requires { api, event, pr }");
  }
  const files = await fetchAllPrFiles(api, event.repository.full_name, pr.number);
  const diff = await api.getText(`/repos/${event.repository.full_name}/pulls/${pr.number}`, {
    accept: "application/vnd.github.v3.diff"
  });
  return Object.freeze({
    metadata: Object.freeze({
      repo: event.repository.full_name,
      number: pr.number,
      title: pr.title ?? "",
      body: pr.body ?? "",
      author: pr.user?.login ?? "",
      labels: Object.freeze((pr.labels ?? []).map((label) => label.name).sort()),
      base_ref: pr.base?.ref ?? "",
      head_ref: pr.head?.ref ?? ""
    }),
    changed_files: Object.freeze(files.map((file) => Object.freeze({
      path: file.filename,
      status: normalizeStatus(file.status),
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      previous_path: file.previous_filename,
      binary: !file.patch
    }))),
    raw_diff: diff
  });
}

async function fetchAllPrFiles(api, repo, prNumber) {
  const collected = [];
  for (let page = 1; page <= FILES_PAGE_LIMIT; page += 1) {
    const batch = await api.getJson(
      `/repos/${repo}/pulls/${prNumber}/files?per_page=${FILES_PER_PAGE}&page=${page}`
    );
    if (!Array.isArray(batch) || batch.length === 0) {
      return collected;
    }
    collected.push(...batch);
    if (batch.length < FILES_PER_PAGE) {
      return collected;
    }
  }
  throw new Error(
    `pr-github source: aborted after ${FILES_PAGE_LIMIT} pages (>${FILES_PAGE_LIMIT * FILES_PER_PAGE} files) for ${repo} PR #${prNumber}; PR exceeds reviewable size`
  );
}

function normalizeStatus(status) {
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  if (status === "added") return "added";
  return "modified";
}
