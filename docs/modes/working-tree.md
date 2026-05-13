# Working-tree review

Reviews uncommitted edits in the local checkout (`git diff HEAD`).

## When to use

- An agent or developer is about to commit a focused set of changes and wants a
  risk check first.
- Pre-commit hooks that need a fast, narrow risk signal.

## Invocation

```sh
revix review --working-tree --format markdown
```

Equivalent default invocation: `revix review` (working-tree is the implicit
default when no other source is given).

To review changes in a different directory, pass `--source-cwd <path>`.

## Behaviour

- Source: `git diff HEAD` (everything not in the latest commit, staged or not).
- Metadata is synthesised: `repo` from `git config remote.origin.url`,
  `author` from `git config user.email`, `head_ref = WORKTREE`,
  `base_ref` = current branch name.
- Defaults are tighter than PR mode (`budget = 3`, `severity_floor = MAJOR`) to
  reflect the smaller and noisier signal of in-progress work. Tunable under
  `sources.working_tree` in `.revix.yml`.

## Limitations

- Only sees what is currently in the working copy; not aware of related history.
- Findings cite the working-copy file path; if the file is in flux this can
  become stale quickly.
