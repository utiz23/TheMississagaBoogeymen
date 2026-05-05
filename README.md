# EANHL Team Stats

Stats and analytics website for EASHL club **The Boogeymen** (#19224, platform: common-gen5).

Ingests match data from EA's undocumented Pro Clubs API, archives it to PostgreSQL, and serves a dark-themed stats frontend. Self-hosted on a home PC via Docker Compose.

---

## What's Inside

| App / Package | Description |
|---|---|
| `apps/web` | Next.js 15 (App Router) frontend |
| `apps/worker` | Ingestion worker — polls EA API every 5 min |
| `packages/db` | Drizzle ORM schema, migrations, query functions |
| `packages/ea-client` | EA Pro Clubs API client (retry, throttle, typed) |

**Pages:** Home · `/games` · `/games/[id]` · `/roster` · `/roster/[id]` · `/stats`

---

## Quick Start (local dev)

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL
docker compose up db

# 3. Copy and fill env
cp .env.example .env

# 4. Run migrations and seed game title
pnpm --filter db migrate
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl \
  -f packages/db/seed/game_titles.sql

# 5. Start dev servers
pnpm dev
```

> **DB port:** `5433` (not 5432 — conflict with another local project).

---

## Common Commands

```bash
pnpm dev                              # Start all dev servers
pnpm --filter web dev                 # Web only
pnpm --filter worker dev              # Worker only

pnpm build                            # Build all packages
pnpm --filter @eanhl/db build         # Build db package (required after schema changes)

pnpm --filter db generate             # Generate Drizzle migration
pnpm --filter db migrate              # Apply migrations

pnpm typecheck                        # TypeScript check (all packages)
pnpm lint                             # ESLint
pnpm format                           # Prettier (write)

# Worker CLI
set -a && source .env && set +a
pnpm --filter worker reprocess            # Retry failed transforms
pnpm --filter worker reprocess --all      # Reprocess all raw payloads
pnpm --filter worker reprocess --dry-run  # Preview only
pnpm --filter worker ingest-now           # Force immediate ingestion cycle

# Database
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "SELECT ..."
```

---

## Production Deployment

See `DEPLOY.md` for the full cold-start checklist.

```bash
# Build and start all services
docker compose build
docker compose up -d

# Worker health check
curl localhost:3001/health
```

Docker Compose runs three services: `web` (Next.js), `worker` (ingestion), `db` (PostgreSQL).

---

## Architecture

EA's API returns only the ~5 most recent matches. The worker polls every 5 minutes, stores raw JSON payloads immediately, then transforms and aggregates. Raw payloads are kept indefinitely — miss a match and you can't get it back, but transform bugs can always be fixed via `reprocess --all`.

See `docs/ARCHITECTURE.md` for full design details and `docs/ROADMAP.md` for near-term plans.
See `docs/SMOKE-CHECKS.md` for the default local verification loop and MCP-assisted smoke checks.

---

## Environment Variables

See `.env.example` for all variables. Key ones:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `EA_CLUB_ID` | `19224` | EA club ID |
| `EA_PLATFORM` | `common-gen5` | EA platform identifier |
| `POLL_INTERVAL_MS` | `300000` | Worker poll interval (5 min) |
| `EA_REQUEST_DELAY_MS` | `1000` | Throttle between EA API calls |
| `HEALTH_PORT` | `3001` | Worker health endpoint port |
