You are working in plan mode.

Task:
Design the fixture and integration test system for Revix.

Revix should have deterministic tests without requiring real LLM calls.

Required fixture types:
1. PR metadata fixtures
2. PR diff fixtures
3. .revix.yml fixtures
4. reviewer skill fixtures
5. mock provider response fixtures
6. expected finding fixtures
7. expected conflict fixtures
8. expected final output snapshots

Required PR scenarios:
- clean PR with no findings
- feature PR
- bugfix PR
- refactor PR
- infra PR
- docs-only PR
- contract-breaking PR
- security-sensitive PR
- performance optimization PR
- conflicting reviewer findings
- low-confidence finding
- huge diff fallback
- ignored path PR

Required test levels:
1. Unit tests
2. Schema validation tests
3. Snapshot tests
4. CLI tests
5. End-to-end mock provider tests
6. GitHub Action dry-run test

Please propose:
- Test directory structure
- Fixture naming convention
- Fixture format
- Snapshot strategy
- Mock provider strategy
- CI test command
- Coverage expectations
- Example test cases

Do not implement yet.