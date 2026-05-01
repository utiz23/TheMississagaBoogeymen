# CLAUDE.md

## Project

EASHL team stats website for club #19224 (platform: common-gen5). Monorepo that ingests data from EA's undocumented Pro Clubs API, archives it, and serves a stats/analytics frontend.

Self-hosted on a home PC via Docker Compose. Audience is a handful of team members.

## Architecture

- `apps/web` — Next.js 15 (App Router) frontend + API routes. No separate API server.
- `apps/worker` — Standalone Node.js ingestion worker (polling, transform, aggregation)
- `packages/db` — Drizzle ORM schema, migrations, shared query functions
- `packages/ea-client` — EA Pro Clubs API client with retry/backoff/throttle

## Tech Stack

- **Runtime:** Node.js, TypeScript (strict)
- **Monorepo:** pnpm workspaces + Turborepo
- **Database:** PostgreSQL 16 (local Docker container)
- **ORM:** Drizzle ORM (drizzle-kit for migrations)
- **Frontend:** Next.js 15 App Router, Tailwind CSS 4, shadcn/ui
- **Deployment:** Docker Compose (web + worker + postgres)

## Key Domain Concepts

- **Game title** (NHL 25, NHL 26, NHL 27) is the primary data grouping. Cross-game career stats are the core feature.
- **Content seasons** (in-game battlepass seasons, ~5/year) are secondary metadata. Managed manually.
- **EA API** returns ~5 recent matches and all values as strings. Worker polls every 5 minutes. Missing the window means permanent data loss.
- **Player identity** anchored on `ea_id` (blazeId) in theory — but blazeId is absent from EA match payloads in production. Gamertag fallback is the real production path. `players.ea_id` is nullable permanently.
- **Match uniqueness** is composite: `(game_title_id, match_id)`. Surrogate `bigserial` PK, not the EA match ID.

## Conventions

- Server Components by default. Client Components only for interactivity (sorting, tabs, nav toggle).
- Queries go in `packages/db/src/queries/`. Frontend imports from `@eanhl/db/queries`.
- Raw EA API payloads are stored verbatim before any transformation. Never discard raw data.
- Aggregates are precomputed per game title (and optionally per content season). Never compute on read.
- All percentage/rate DB fields use `numeric(5,2)`. GAA uses `numeric(4,2)`.
- `transform_status` is a strict enum: `'pending' | 'success' | 'error'`.
- Non-overlapping worker loop (async wait, not setInterval). Configurable via `POLL_INTERVAL_MS`.

## Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm build                # Build all packages (turborepo)
pnpm dev                  # Start dev servers
pnpm --filter web dev     # Start only the Next.js dev server
pnpm --filter worker dev  # Start only the ingestion worker
pnpm --filter db generate # Generate Drizzle migrations
pnpm --filter db migrate  # Run migrations
pnpm --filter worker reprocess            # Reprocess failed transforms
pnpm --filter worker reprocess --dry-run  # Preview reprocessing
pnpm --filter worker reprocess --all      # Reprocess ALL raw payloads (backfill after schema/transform change)
docker compose up         # Start all services (web + worker + postgres)
docker compose up db      # Start only PostgreSQL
```

### After modifying `packages/db/src/`

Always rebuild the package before running typecheck on any consumer (web, worker):

```bash
pnpm --filter @eanhl/db build
```

New query exports are not visible to consumers until this runs. This is the most common cause of "no exported member" typecheck errors.

### After modifying worker source for local CLI use

```bash
pnpm --filter @eanhl/worker build
```

Required before `reprocess --all` runs the updated transform locally.

### Loading env for local worker commands

Worker CLI commands (`reprocess`, `ingest-now`) need `DATABASE_URL` from `.env`:

```bash
set -a && source .env && set +a
pnpm --filter worker reprocess --all
```

### Querying the live database

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "SELECT ..."
```

Container: `eanhl-team-website-db-1` · User: `eanhl` · DB: `eanhl` · Host port: `5433` (not 5432 — conflict with another project).

### Format fix (write, not just check)

```bash
pnpm format
```

### After deploying new code to Docker

See the `docker-redeploy` skill. Always rebuild the image — `docker compose up -d` alone reuses the old image.

## Environment Variables

See `.env.example`. Key vars:

- `DATABASE_URL` — PostgreSQL connection string
- `EA_CLUB_ID` — `19224`
- `EA_PLATFORM` — `common-gen5`
- `POLL_INTERVAL_MS` — Worker poll interval (default: 300000)
- `EA_REQUEST_DELAY_MS` — Throttle between EA API calls (default: 1000)
- `INGEST_CYCLE_TIMEOUT_MS` — Max time per ingestion cycle (default: 120000)

## Design Direction

Always-dark theme. Red accents, sharp/aggressive esports aesthetic. No light mode toggle. Scoreboard-style cards, high contrast, minimal decoration.

## Handoff Protocol

`HANDOFF.md` is the session continuity file. Update it:

- After completing any plan phase
- After any significant architectural decision or schema change
- When a session ends with meaningful work done (user says goodbye, wraps up, or asks to commit)

What to keep current in `HANDOFF.md`:

- **Current Status** — which phase, what's ready to start
- **What Was Done** — bullet summary of the session's work (add, don't replace previous entries unless they're superseded)
- **What's Next** — the immediate next steps with enough detail to orient a cold start
- **Open Decisions / Blockers** — anything unresolved that the next session needs to know

Do not update `HANDOFF.md` mid-task. Update it at natural stopping points only.

## Commit Protocol

Commit behavior in this repo must be deliberate.

### Default rules

- Do not commit automatically just because files changed.
- Commit when the user explicitly asks, asks for a backup/sync point, or wants a stable verified checkpoint preserved.
- Do not include unrelated dirty files unless the user explicitly says to commit everything.

### Before any commit

Always:

1. run `git status --short`
2. confirm the intended commit scope
3. verify the change with the smallest relevant checks
4. inspect for unrelated dirty work that should stay out of the commit

### Commit scope

Prefer focused commits:

- one feature
- one fix
- one schema/migration change
- one docs/handoff update

Use a full-repo checkpoint commit only when the user explicitly wants a backup/sync snapshot.

### Commit messages

Prefer clear messages like:

- `feat(db): add skater/goalie GP split to local aggregates`
- `fix(worker): backfill player_profiles for member-only players`
- `docs(handoff): update roadmap after dual-role aggregate rollout`
- `chore: checkpoint full repo state for macbook sync`

Avoid useless messages like:

- `checkpoint`
- `wip`
- `misc`

### Push behavior

- Do not push automatically unless the user explicitly asks for push/backup/sync.
- If the user asks for a backup on GitHub or another machine, commit **and** push.
- A local-only commit is not a real backup for that request.

### Branching guidance

`main` is the baseline/sync branch.

Prefer short-lived feature branches for risky or multi-step work:

- `feat/...`
- `fix/...`
- `spike/...`

Direct commits to `main` are acceptable only when:

- the user explicitly wants a checkpoint on `main`
- the change is small and verified
- or there is no parallel branch workflow in progress

### History hygiene

- do not amend or rewrite commits unless explicitly asked
- do not hide unrelated staged changes inside a supposedly focused commit
- if the commit intentionally includes everything in the repo, say so clearly

## Summary Instructions

When compacting or resuming, preserve only:

- current phase and immediate objective
- files changed in the current workstream
- latest verification results
- unresolved assumptions or blockers
- the next 1-3 concrete actions

Do not preserve long command output unless it contains an active error that still matters.

## Plan Reference

Full architecture plan: `docs/ARCHITECTURE.md`
