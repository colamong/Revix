You are working in plan mode.

Task:
Design the Conflict Detector for Revix.

The detector should identify conflicts between reviewer findings.

Conflict examples:
1. Performance recommends caching, Security warns about sensitive data exposure.
2. Architecture recommends abstraction, Performance warns about overhead.
3. Contract says API is safe, Documentation says contract docs are missing.
4. Test reviewer says coverage is insufficient, Readability reviewer says added tests are too complex.
5. One finding is BLOCKER while another treats the same issue as MINOR.

Conflict record fields:
- conflict_id
- involved_reviewers
- involved_findings
- conflict_type
- summary
- competing_claims
- affected_quality_rules
- required_resolution
- confidence

Conflict types:
- security_vs_performance
- contract_vs_implementation
- reliability_vs_complexity
- architecture_vs_scope
- severity_mismatch
- duplicate_or_overlapping_findings

Please propose:
- Conflict detection rules
- Data model
- Heuristics
- Deduplication behavior
- Examples
- Unit test strategy

Do not implement yet.