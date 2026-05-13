# change-risk-review skill

The primary distribution surface for Revix on coding-agent platforms
(Claude Code, Codex).

## What it is

A single skill that exposes Revix's `revix review` CLI to the agent. Mode
(working-tree / staged / pr) is a runtime argument, not a separate skill
identity. This avoids skill-list sprawl in the agent UI and keeps a single
trigger surface ("any risks I'm missing before X").

## Skill manifest

[skills/change-risk-review/SKILL.md](../../skills/change-risk-review/SKILL.md) is
the manifest. It declares:

- when the agent should invoke (concrete decision points only)
- when *not* to invoke (general code review, style, naming)
- how to invoke (CLI command per mode)
- how to interpret the output (BLOCK / REQUEST_CHANGES / COMMENT / APPROVE)

## Installation

For Claude Code, drop the `skills/change-risk-review/` directory into the
agent's skill directory. For Codex, do the same in the Codex skill path.

The skill assumes the `revix` CLI is on PATH or invokable via `npx revix`. The
included `wrapper.mjs` is a convenience helper for invocation; the skill works
without it.

## Why one skill instead of several

The plan considered shipping multiple specialised skills
(`precommit-risk-review`, `pr-risk-review`, `release-risk-review`). One skill
won for v0.1 because:

- the engine is ~95% shared across stages
- a single trigger keeps the agent's decision simple
- specialised skills clutter the skill list with near-duplicates
- if dispatch quality degrades, splitting is a v0.2 option

## Out of scope

This skill does not:

- run tests
- format code
- explain what code does
- comment on style or naming

If the agent asks Revix for those things, the skill returns an APPROVE verdict
with no findings — by design.
