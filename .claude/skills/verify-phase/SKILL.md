# Verify Phase

Use this skill whenever a phase or significant work chunk needs validation.

## Pre-Check — DB Package Rebuild

**If any file in `packages/db/src/` was modified, rebuild first:**

```bash
pnpm --filter @eanhl/db build
```

Without this, `pnpm typecheck` on web or worker will report spurious "no exported member" errors for new query/schema exports — even though the code is correct.

## Default Commands

Run, in this order:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

If format fails, fix with `pnpm format` then re-check.

Add focused checks when relevant, for example:

```bash
pnpm --filter @eanhl/ea-client test
pnpm --filter @eanhl/worker typecheck
docker compose config
```

## Output Format

Report only:

- which commands ran
- whether each passed or failed
- the shortest useful failure summary

## Rules

- Do not paste long passing command logs.
- If a command fails, surface the first real cause, not the full cascade.
- If verification is blocked by environment limitations, say that clearly.
