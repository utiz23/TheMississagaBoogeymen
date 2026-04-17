# AGENTS.md

## Commit Rules

These rules are for Codex and any other agent operating in this repository.

### Default behavior

- Do not commit automatically just because code changed.
- Commit when the user explicitly asks for a commit, asks for a backup/sync point, or when the current work has reached a stable verified checkpoint and the user has indicated that checkpointing is desired.
- Do not bundle unrelated dirty changes into a commit unless the user explicitly asks to commit everything in the repo.

### Before committing

Always do these checks first:

1. Inspect `git status --short`
2. Understand whether unrelated dirty files are present
3. Verify the change with the smallest relevant checks
4. Make sure the commit scope matches the user request

If the tree contains unrelated changes and the user did **not** ask to commit everything:

- commit only the relevant files
- call out what was intentionally excluded

### Commit scope

Prefer focused commits:

- one feature
- one fix
- one schema change
- one docs/handoff update

Avoid mixed commits unless the user explicitly wants a full snapshot/backup.

### Commit messages

Use clear messages. Prefer:

- `feat(db): ...`
- `fix(worker): ...`
- `docs(handoff): ...`
- `chore: checkpoint full repo state for sync`

Avoid lazy messages like:

- `checkpoint`
- `wip`
- `misc fixes`
- `stuff`

### Push behavior

- Do not push automatically unless the user explicitly asks for push/backup/sync.
- If the user wants a recoverable backup, a local commit is not enough — push it.
- If working on a risky change, prefer a short-lived feature branch over direct work on `main`.

### Branching

Default:

- `main` = sync/stable baseline

Prefer short-lived branches for risky or multi-step work:

- `feat/...`
- `fix/...`
- `spike/...`

Examples:

- `feat/stats-table-integration`
- `fix/player-profile-backfill`
- `spike/ea-club-record-source`

### When direct commits to `main` are acceptable

- the user explicitly wants a backup/checkpoint on `main`
- the change is small, verified, and immediately intended as the new baseline
- there is no parallel branch workflow in progress

### Handoff discipline

When a meaningful commit is made:

- update `HANDOFF.md` at a natural stopping point if the work changed project state
- mention the commit hash in the summary to the user when useful

### Non-negotiables

- Never rewrite or amend commits unless the user explicitly asks
- Never hide unrelated staged changes inside a “focused” commit
- Never pretend a backup exists if the commit was not pushed when remote backup was requested
