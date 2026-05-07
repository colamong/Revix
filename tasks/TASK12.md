You are working in plan mode.

Task:
Design GitHub Action integration for Revix.

The GitHub Action should run Revix on pull requests.

Workflow behavior:
1. Trigger on pull_request events.
2. Respect skip labels from .revix.yml.
3. Collect PR metadata.
4. Collect changed files and diff.
5. Run revix review.
6. Post or update a single PR comment.
7. Optionally fail the workflow if verdict is REQUEST_CHANGES.

Requirements:
- Safe for public open-source repositories.
- Safe for forked PRs.
- Do not expose secrets in logs.
- Dry-run mode should be available.
- Mock mode should be available for tests.
- Must update the existing Revix comment instead of spamming new comments.
- Must support output format github-comment.
- Must support label-based reviewer overrides.
- Must support paths.ignored from .revix.yml.
- Should avoid reviewing huge diffs unless explicitly allowed.

Configuration examples:
- labels.skip: ["ai-review-skip", "revix-skip"]
- labels.force_reviewers.security: "revix/security"
- verdict.fail_on_request_changes: true

Please propose:
- GitHub Action architecture
- action.yml inputs
- Required permissions
- Workflow YAML example
- Secret handling strategy
- Comment marker strategy
- Fork PR safety strategy
- Large diff behavior
- Failure behavior
- Test strategy

Do not implement yet.