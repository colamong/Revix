# Reviewer Skills

Reviewer skills are YAML files ending in `.reviewer.yml`. Built-ins ship in
`src/reviewer-skills/builtin/v1`; project skills live in `.revix/reviewer-skills`
or directories listed in `skills.paths`.

Create a scaffold:

```sh
node bin/revix.js skill init ai-prompts
node bin/revix.js check
```

Each skill defines identity, scope, severity policy, focused quality rules,
prompt instructions, and examples. Keep skills concise. Put only durable reviewer
behavior in the file, and prefer evidence-based instructions over broad advice.

The format follows the same design principle as Claude/Anthropic skills:
metadata first, narrowly scoped instructions, and reusable references only when
needed. Revix keeps a dedicated `.reviewer.yml` runtime format so reviewer
validation remains deterministic.
