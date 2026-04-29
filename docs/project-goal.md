# Project Goal

Revix is an AI-powered PR review orchestrator that turns PR metadata and diffs
into structured reviewer claims, conflict-aware synthesis, constitution-based
judgment, and a final GitHub PR review comment.

## Problem Statement

PR review agents often mix evidence, preference, and final judgment in one
unstructured response. Revix separates those responsibilities so that review
outputs can be inspected, compared, tested, and reused across projects.

## Target Users

- AI agents that need a repeatable PR review skill framework.
- Maintainers who want evidence-based review comments.
- Reviewers who need conflicts and tradeoffs surfaced instead of hidden.

## Core Pipeline

1. Accept PR metadata and diff input.
2. Classify the PR type.
3. Select relevant reviewers.
4. Run reviewer-specific review logic.
5. Normalize reviewer outputs into structured claims.
6. Detect conflicts between reviewer claims.
7. Generate synthesis options.
8. Evaluate options against the Quality Constitution.
9. Produce a final GitHub PR review comment.
