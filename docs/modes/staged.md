# Staged review

Reviews the changes staged in the git index (`git diff --staged`).

## When to use

- A developer has run `git add` and is about to commit. This is the strictest,
  cleanest checkpoint before history is written.
- Pre-commit hooks that want to scope review to exactly the contents of the
  next commit, ignoring unstaged scratch edits.

## Invocation

```sh
revix review --staged --format markdown
```

To review staged changes in a different directory, pass `--source-cwd <path>`.

## Behaviour

- Source: `git diff --staged`.
- Metadata is synthesised: `head_ref = INDEX`, otherwise identical to
  [working-tree mode](working-tree.md).
- Defaults match working-tree mode: `budget = 3`, `severity_floor = MAJOR`.
  Tunable under `sources.staged` in `.revix.yml`.

## Limitations

- Sees only what is staged. If the developer staged a partial hunk, Revix
  reviews only that hunk.
- Does not currently inspect commit message intent.
