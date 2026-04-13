# Schema Change

Use this skill whenever you modify anything in `packages/db/src/` — schema files, migrations, or query functions.

## Why This Exists

The `@eanhl/db` package must be compiled before any dependent package (`apps/web`, `apps/worker`) can resolve its exports. Skipping the build causes spurious typecheck failures that look like missing exports — not schema errors. This has burned multiple sessions.

## Trigger Conditions

Invoke whenever you:
- Add or modify a Drizzle schema file (`packages/db/src/schema/*.ts`)
- Add or modify a query function (`packages/db/src/queries/*.ts`)
- Run `pnpm --filter db generate` or `pnpm --filter db migrate`

## Sequence

### 1. If schema columns or tables changed — generate + migrate first

```bash
pnpm --filter db generate   # writes migration SQL
pnpm --filter db migrate    # applies to live DB
```

Verify the migration applied:

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

### 2. Always — rebuild `@eanhl/db` before running typecheck

```bash
pnpm --filter @eanhl/db build
```

This compiles the TypeScript to `dist/` so the new exports are visible to consumers. **Do this even if you only changed a query, not the schema.**

### 3. Run the standard quality gate

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

If format fails, fix with `pnpm format` then re-check.

### 4. If transform or ingestion code changed — rebuild worker and reprocess

```bash
pnpm --filter @eanhl/worker build
set -a && source .env && set +a
pnpm --filter worker reprocess --all
```

The `set -a && source .env && set +a` prefix is required — the local worker process needs `DATABASE_URL` from `.env`.

After reprocess, aggregates are recomputed automatically for affected game titles.

### 5. If the change needs to run in Docker — redeploy

Use the `docker-redeploy` skill.

## Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Module '...' has no exported member 'X'` | `@eanhl/db` not rebuilt | `pnpm --filter @eanhl/db build` |
| `DATABASE_URL environment variable is required` | `.env` not loaded | `set -a && source .env && set +a` |
| New columns all NULL in DB | Reprocess not run after transform update | `pnpm --filter @eanhl/worker build && reprocess --all` |
| Worker cycle runs but new code has no effect | Docker image stale | Use `docker-redeploy` skill |
