You are working in plan mode.

Task:
Design and implement inline PR comments for Revix.

Goal:
Allow Revix to comment directly on relevant changed lines when evidence includes file path and line range.

Requirements:
1. Map finding evidence to GitHub diff positions.
2. Only comment on changed lines.
3. Fall back to summary comment when mapping fails.
4. Avoid duplicate comments across reruns.
5. Respect severity filters.
6. Do not inline low-confidence findings by default.
7. Keep one final summary comment.

Default behavior:
- BLOCKER and MAJOR can become inline comments.
- MINOR/QUESTION/NIT stay in summary unless configured.
- LOW confidence findings stay in summary.

Please propose:
- GitHub diff position mapping strategy
- Inline comment deduplication strategy
- Config options
- Failure fallback
- Tests
- Example output

Do not implement until the plan is approved.