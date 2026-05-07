You are working in plan mode.

Task:
Implement GitHub Action support for Revix.

Goal:
Allow users to run Revix automatically on pull requests.

Requirements:
1. Add action.yml.
2. Add GitHub Action entrypoint.
3. Collect PR metadata.
4. Fetch PR diff.
5. Run Revix review pipeline.
6. Post or update one PR comment.
7. Support dry-run mode.
8. Respect .revix.yml skip labels and ignored paths.
9. Support fail_on_request_changes.
10. Avoid leaking secrets.

Do not implement inline comments yet.

Please propose:
- Files to add or modify
- Action input schema
- Required GitHub permissions
- Comment update strategy
- Error handling
- Test strategy
- Example workflow YAML

Do not implement until the plan is approved.