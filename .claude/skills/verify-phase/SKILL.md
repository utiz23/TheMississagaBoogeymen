# Verify Phase

Use this skill whenever a milestone or significant chunk of work needs
validation before it's reported as done. Match verification to what actually
changed rather than always running the full default list — see
`docs/operations/agent-manager-workflow.md` §7.

## Documentation-only changes

Skip the code gates below. Instead: reread the diff, and check that any
paths/commands/section references you touched or added still resolve.

## Hook, script, or config changes

There is no blanket exemption for "config" — verify appropriate to what the
configuration actually affects, not a fixed list:

- A hook or script's own logic: a focused behavioral check (fixture inputs,
  a stubbed dependency for anything destructive/slow/external) rather than a
  full repo build.
- Build/lint/type config (`tsconfig*.json`, `.eslintrc*`, `prettier` config):
  run the tool it configures (`pnpm typecheck` / `pnpm lint` /
  `pnpm format:check`) so the change is proven against real output, not just
  read.
- Runtime/deployment config (`docker-compose*.yml`, env templates, CI/hook
  registration in `.claude/settings.json`): validate it structurally
  (`docker compose config`, a schema/parse check) and, where practical,
  exercise the actual behavior it changes (e.g. trigger the hook it
  registers) rather than assuming the YAML/JSON is correct because it reads
  correctly.

## Pre-Check — DB Package Rebuild

**If any file in `packages/db/src/` was modified, rebuild first:**

```bash
pnpm --filter @eanhl/db build
```

Without this, `pnpm typecheck` on web or worker will report spurious "no exported member" errors for new query/schema exports — even though the code is correct.

## Selecting Commands for Code Changes

Pick commands proportional to what changed — this is not a fixed checklist
to run every time regardless of the diff:

```bash
pnpm typecheck        # any TypeScript change
pnpm lint             # any TypeScript change
pnpm format:check     # any change to a formatted file type
```

These three are the usual baseline for a TypeScript change because they're
cheap and catch most regressions; skip whichever doesn't apply (e.g. a pure
Markdown edit doesn't need `pnpm typecheck`). Add focused, package-specific
checks when relevant, for example:

```bash
pnpm --filter @eanhl/ea-client test
pnpm --filter @eanhl/worker typecheck
docker compose config
```

If format fails, fix only the files you touched — e.g.
`pnpm prettier --write <changed-file> [<changed-file> ...]` — then re-check.
Do not run a blanket `pnpm format` across the whole repo; that rewrites
unrelated files and obscures your actual diff.

## Output Format

Report only:

- which commands ran
- whether each passed or failed
- the shortest useful failure summary

## Rules

- Do not paste long passing command logs.
- If a command fails, surface the first real cause, not the full cascade.
- If verification is blocked by environment limitations, say that clearly.
