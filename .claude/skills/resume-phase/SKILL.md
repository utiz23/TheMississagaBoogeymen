# Resume Phase

Use this skill when resuming work after a pause, compact, or handoff.

## Goal

Rebuild only the context needed to continue the current phase without rereading the whole repository.

## Workflow

1. Read `HANDOFF.md`.
2. Read the relevant sections of `docs/ARCHITECTURE.md`.
3. Inspect `git status --short`.
4. Inspect the files mentioned in the current handoff or failing verification.
5. Summarize:
   - current phase
   - what is complete
   - what is in progress
   - blockers or assumptions
   - the next 1-3 concrete actions

## Rules

- Prefer targeted reads over full-file dumps.
- Do not restate the entire architecture unless specifically asked.
- If the handoff and repo disagree, trust the current repo state and note the mismatch.
