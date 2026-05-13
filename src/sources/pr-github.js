export async function collectPrGithubChangeset(source, options = {}) {
  const api = source.api ?? options.api;
  const event = source.event ?? options.event;
  const pr = source.pr ?? event?.pull_request;
  if (!api || !event || !pr) {
    throw new Error("pr-github source requires { api, event, pr }");
  }
  const files = await api.getJson(`/repos/${event.repository.full_name}/pulls/${pr.number}/files?per_page=100`);
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

function normalizeStatus(status) {
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  if (status === "added") return "added";
  return "modified";
}
