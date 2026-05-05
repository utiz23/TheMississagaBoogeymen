# Smoke Checks

Use this as the default verification loop for normal feature work in this repo.

## Default Workflow

1. Run `postgres` checks first for DB-heavy changes.
2. Run `playwright` checks first for frontend changes.
3. Keep the local command loop short:
   - `pnpm build`
   - `pnpm typecheck`
   - `pnpm --filter web lint`

For convenience:

```bash
pnpm smoke:quick
```

`smoke:quick` runs `build` first so `apps/web` has fresh `.next/types` before the root `typecheck` pass.

## Postgres Checks

Use the `postgres` MCP server before writing one-off scripts when you need to verify:

- migration state
- row counts
- aggregate/query outputs
- importer side effects

Minimal sanity query:

```sql
select current_database() as db, current_user as user, now() as server_time;
```

Useful repo-specific checks:

```sql
select count(*) from historical_player_season_stats;
select count(*) from historical_club_member_season_stats;
select count(*) from historical_club_team_stats;
```

## Playwright Checks

Use the `playwright` MCP server as the default browser verification path for:

- `/`
- `/games`
- `/roster`
- `/stats`
- archive-title switching (`?title=nhl22`, `?title=nhl25`, etc.)
- mode switching (`?mode=6s`, `?mode=3s`)

Minimal frontend smoke flow:

1. Navigate to `http://localhost:3000/`
2. Confirm the page title
3. Capture an accessibility snapshot
4. Check console output
5. Repeat on the route you changed

## Importer Regression Checks

After importer changes:

1. `pnpm --filter @eanhl/db lint`
2. `pnpm --filter @eanhl/db test`
3. `pnpm build`
4. Verify target row counts or one representative query through `postgres`

## Decision Rule

- If `pnpm build` passes but `pnpm lint` fails at repo root, do not pretend the repo is clean.
- If a change touches importers or queries, verify with `postgres`.
- If a change touches pages or UI state, verify with `playwright`.
