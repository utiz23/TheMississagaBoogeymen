# EANHL Team Stats

Stats and analytics website for EASHL club **The Boogeymen** (#19224, platform: common-gen5).

Ingests match data from two sources — EA's undocumented Pro Clubs API **and** OCR of recorded gameplay video — archives it to PostgreSQL, and serves a dark-themed stats frontend. Cross-game career stats (NHL 25/26/27) are the core feature. Self-hosted on a home server (Hotel-Echo) via Docker Compose.

---

## Repository Map

Code (all tracked):

| Path                      | What it is                                                               |
| ------------------------- | ------------------------------------------------------------------------ |
| `apps/web`                | Next.js 15 (App Router) frontend + API routes, member logins             |
| `apps/worker`             | Ingestion worker — polls EA API every 5 min, transforms, aggregates      |
| `apps/discord`            | Discord game-result poster (opt-in Compose profile `discord`)            |
| `packages/db`             | Drizzle ORM schema, migrations, shared query functions                   |
| `packages/ea-client`      | EA Pro Clubs API client (retry, backoff, throttle, typed)                |
| `tools/game_ocr`          | Python OCR CLI for fixed-layout NHL screens — **frozen, reference only** |
| `tools/video_ingest`      | Python video-to-match OCR pipeline — **frozen, reference only**          |
| `tools/historical_import` | Manifest-driven backfill of older-title (NHL 22–25) recordings           |
| `ops/`                    | Backup and verification services for Hotel-Echo (see `ops/README.md`)    |
| `scripts/`                | Repo scripts (`verify-ocr.sh`, X-Factor icon scraper)                    |

OCR and video-stats work moved to the sister repo `eanhl-live-engine` on
2026-10-21. The OCR code here stays as it is, for reference.

Documents:

| Path                     | What it is                                                         |
| ------------------------ | ------------------------------------------------------------------ |
| `HANDOFF.md`             | Current state and next actions — start here                        |
| `CLAUDE.md`, `AGENTS.md` | Rules for AI agents (commands, conventions, commit protocol)       |
| `DEPLOY.md`              | Cold-start deployment checklist                                    |
| `docs/`                  | All other documents — index in [`docs/README.md`](docs/README.md)  |
| `research/`              | Raw research captures (EA API, ChelHead, old NHL stats, OCR shots) |

Local only (git-ignored, on this machine only — **not backed up by git**):

| Path                 | What it is                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- |
| `_local/`            | Used design hand-offs, old backup zips, retired labeling tools — see its README         |
| `*.zip` at root      | New Claude Design hand-offs land here; move them to `_local/design-handoffs/` after use |
| `discord-preview/`   | Output of `pnpm --filter @eanhl/discord preview` (regenerable)                          |
| `.claude/worktrees/` | Git worktrees of active feature branches                                                |
| `.venv/`, `.venv-1/` | Python environments (`.venv-1` runs the OCR pytest suites)                              |
| `.env`               | Application secrets — never commit, never give to verification commands                 |

**Live site:** https://boogeymen.app, hosted on Hotel-Echo.
**Public pages:** Home · `/games` · `/games/[id]` · `/roster` · `/roster/[id]` · `/stats` · `/legal/*`
**Member pages (Discord login, invite-only):** `/login` · `/account` · `/admin/*`

---

## Quick Start (local dev)

Requires Node.js ≥ 22, pnpm ≥ 10, and Docker.

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL
docker compose up db

# 3. Copy env and fill in values (set a real BETTER_AUTH_SECRET)
cp .env.example .env

# 4. Run migrations and seed game titles
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

# Worker CLI (load env first)
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

**Live source — EA API.** EA's API returns only the ~5 most recent matches. The worker polls every 5 minutes, stores raw JSON payloads immediately, then transforms and aggregates. Raw payloads are kept indefinitely — miss a match and you can't get it back, but transform bugs can always be fixed via `reprocess --all`.

**Backfill source — video OCR.** Matches the API missed (or that predate it) are recovered from screen recordings. `tools/video_ingest` decodes gameplay video, classifies and segments frames into per-match reels, OCRs the post-game box score, associates each reel to a match, and promotes confirmed results into the database. `tools/game_ocr` is the underlying screen-level OCR CLI.

Aggregates are precomputed per game title (never on read). See `docs/ARCHITECTURE.md` for full design details, `docs/ocr/` for the OCR/video subsystem, and `docs/planning/product-roadmap.md` for near-term plans.

---

## Environment Variables

See `.env.example` for all variables. Key ones:

| Variable              | Default                 | Description                                   |
| --------------------- | ----------------------- | --------------------------------------------- |
| `DATABASE_URL`        | —                       | PostgreSQL connection string                  |
| `BETTER_AUTH_SECRET`  | —                       | Auth signing secret (set a long random value) |
| `BETTER_AUTH_URL`     | `http://localhost:3000` | Auth base URL                                 |
| `APP_BASE_URL`        | `http://localhost:3000` | App base URL                                  |
| `EA_CLUB_ID`          | `19224`                 | EA club ID                                    |
| `EA_PLATFORM`         | `common-gen5`           | EA platform identifier                        |
| `POLL_INTERVAL_MS`    | `300000`                | Worker poll interval (5 min)                  |
| `EA_REQUEST_DELAY_MS` | `1000`                  | Throttle between EA API calls                 |
| `HEALTH_PORT`         | `3001`                  | Worker health endpoint port                   |
