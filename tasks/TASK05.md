You are working in plan mode.

Task:
Design the Revix configuration system.

Revix should read configuration from .revix.yml.

The config should support:
- enabled reviewers
- disabled reviewers
- custom skill paths
- quality constitution overrides
- contract files
- security-sensitive paths
- performance-sensitive paths
- ignored paths
- reviewer selection rules
- severity overrides
- labels behavior
- output format
- fail behavior

Example config fields:
- reviewers.enabled
- reviewers.disabled
- skills.paths
- quality.extends
- quality.overrides
- paths.contracts
- paths.ignored
- paths.security_sensitive
- paths.performance_sensitive
- labels.skip
- labels.force_reviewers
- output.format: markdown | json
- verdict.fail_on_request_changes

Please propose:
- Full .revix.yml schema
- Default config
- Merge order
- Validation rules
- Error behavior
- Example config
- Unit test strategy

Do not implement yet.