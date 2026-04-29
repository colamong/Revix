# Evaluation Strategy

Revix should be evaluated with fixture-based PR review scenarios before broad
reviewer logic is added.

## Fixture-Based Tests

Use representative PR metadata and diff fixtures for small bug fixes, refactors,
security-sensitive changes, test-only changes, and mixed changes.

## Golden Output Checks

Compare structured intermediate outputs and rendered GitHub comments against
expected results for stable scenarios.

## Constitution Compliance Checks

Verify that findings include required fields, cite evidence, expose conflicts,
and route final judgment through the Quality Constitution.

## Regression Cases

Track cases for reviewer conflicts, low-confidence findings, missing evidence,
malformed findings, unsupported PR types, and conflicting synthesis options.
