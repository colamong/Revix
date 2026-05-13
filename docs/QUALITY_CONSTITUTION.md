# Quality Constitution

The Quality Constitution is the rule set Revix uses to decide whether findings
should block a PR. Rules have an id, kind, category, tags, description, and
severity behavior.

Hard rules can produce `REQUEST_CHANGES` or `BLOCK`. Soft rules normally produce
comments unless the project config makes them stricter.

Project overrides go in `.revix.yml` under `quality.overrides`.

```yml
quality:
  overrides:
    rules:
      testability.verifiable_behavior:
        severityBehavior:
          defaultSeverity: MAJOR
```

Revix rejects overrides that disable built-in hard constraints or weaken hard
rule verdict behavior.
