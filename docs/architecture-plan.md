# Architecture Plan

Revix is a staged PR review orchestration pipeline with explicit contracts
between each stage.

## Implemented Modules

- Config loader: reads `.revix.yml`, applies defaults, validates supported
  fields, and exposes label/path behavior.
- PR input adapter: validates PR metadata, changed files, and unified diffs.
- PR classifier: maps PR metadata and changed paths into deterministic PR types
  and review signals.
- Quality Constitution: loads built-in quality rules, merges project overrides,
  and evaluates rule violations.
- Reviewer skill pack: loads versioned built-in reviewer YAML files and project
  overrides.
- Reviewer selector: chooses reviewer skills from classification, config, labels,
  and reviewer availability.
- Reviewer runner: provides an injectable runner interface and normalizes
  reviewer output into structured findings.
- Finding validator: enforces evidence, severity, confidence, scope, and quality
  rule constraints.
- Conflict detector: identifies deterministic conflicts between normalized
  findings.
- Synthesis generator: turns findings and conflicts into deterministic candidate
  resolution options.
- Final decision evaluator: maps findings and conflicts into Quality
  Constitution violations and produces the final verdict.
- GitHub comment renderer: formats the final review result as a GitHub-ready
  Markdown comment and JSON-compatible render object.
- Orchestrator/CLI: runs the pipeline from PR input to final output with an
  injectable reviewer runner and local fixture support.

## Remaining Modules

- Live reviewer runner integration behind the existing injectable runner
  boundary.
- GitHub API posting, if Revix later needs to publish comments directly instead
  of rendering comment bodies.
- Richer synthesis negotiation once deterministic conflict handling is validated
  against real PR fixtures.

## Design Notes

- Reviewer logic remains separate from final judgment logic.
- Runtime validators are authoritative for v1; JSON Schemas are published
  contract artifacts.
- External AI/model execution should stay behind the reviewer runner interface.
- The conflict detector and synthesis generator are intentionally conservative
  and deterministic for v1.
