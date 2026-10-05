# CLAUDE.md

## Project

EASHL team stats website for club #19224 (platform: common-gen5). Monorepo that ingests data from EA's undocumented Pro Clubs API, archives it, and serves a stats/analytics frontend.

Self-hosted via Docker Compose on **Hotel-Echo** (home server; `ssh hotel-echo`, repo `~/eanhl-team-website`) since 2026-10-05. The main PC (this dev machine) keeps a stopped fallback copy and runs video-OCR. Audience is a handful of team members.

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
pnpm --filter worker run-quality --run-id N --json        # Print run-quality report (read-only)
pnpm --filter worker run-quality --run-id N --emit-row    # Write report row to ocr_run_quality_reports
pnpm --filter worker run-quality --match-id N --json      # Convenience: resolve to active run
pnpm --filter worker run-quality --all-runs --emit-row    # Backfill content-only reports for every run
docker compose up         # Start all services (web + worker + postgres)
docker compose up db      # Start only PostgreSQL
pnpm --filter worker test:safety   # Verification-DB isolation suite (no Docker/DB needed)
pnpm verify:ocr                    # Full OCR verification harness (needs the verify env file)
docker compose --env-file "$HOME/.config/eanhl/verify.env" -f docker-compose.test.yml up -d   # Disposable VERIFICATION cluster
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

### Loading env for VERIFICATION (never `.env`)

Verification runs suites that write. It must never receive the application
`DATABASE_URL`. Nothing in the verification path reads `.env`, and there are no
defaults — a missing variable fails closed rather than selecting production.

```bash
set -a && . ~/.config/eanhl/verify.env && set +a   # NOT .env
pnpm verify:ocr
```

Every verification-cluster `docker compose` command must pass
`--env-file "$HOME/.config/eanhl/verify.env"`. Without it Compose implicitly
reads the repo-root application `.env`.

`~/.config/eanhl/verify.env` (mode 600, operator-created, template at
`ops/verify.env.example`) supplies `TEST_DATABASE_URL`, `TEST_DB_CONTAINER`,
`TEST_DB_COMPOSE_PROJECT` and `TEST_DB_COMPOSE_SERVICE`. Setup, seeding, the
approved database namespace, and the attestation contract are in `ops/README.md`;
the enforcement lives in `apps/worker/scripts/lib/test-db-guard.mjs`. The
pre-push hook blocks (it does not skip) when that configuration is absent; bypass
with `git push --no-verify`.

### Querying the live database

The live database is on **Hotel-Echo**, not this machine:

```bash
ssh hotel-echo 'docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "SELECT ..."'
```

The same container name on the main PC holds the pre-move fallback copy
(frozen 2026-10-05, 435 matches) — not live data.

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

`HANDOFF.md` is a short, current-state index — not a log. Update it at
natural stopping points — not mid-task — after a significant architectural
decision or schema change, or when a conversation ends with meaningful work
done.

**100-150 lines is the target; 200 lines and 12KB are hard ceilings that
must not be exceeded.** It holds the current objective/status, the latest
verified checkpoint, essential operational constraints (summarized
directly, not reproduced), immediate blockers, links to the active
documents that carry the detail, and the next 1-3 actions. Update the
relevant section **in place** — never append a new dated entry on top of
the old one; that append pattern is exactly what grows this file back into
an unusable log.

Durable detail has exactly one authoritative home each, never duplicated
into `HANDOFF.md` itself:

- `docs/journal/YYYY-MM.md` — concise dated work diary (create the current
  month's file as needed).
- `docs/planning/` — active plans and roadmaps, in their existing topical
  locations.
- `docs/archive/` — historical handoff snapshots and retired/superseded
  material, copied byte-for-byte before anything is reworded, each marked
  with its status and, if superseded, a link to the replacement.

Check the size every time you touch this file — it's part of the normal
update, not a separate cleanup session. Crossing 150 lines doesn't by
itself force a relocation — condensing an active blocker to a concise
summary is fine as long as its substance survives; relocate only when
condensing alone won't keep the file under the 200-line/12KB ceiling, or
the material is no longer current. Age alone never justifies dropping a
still-open blocker or decision. Full detail:
`.claude/skills/handoff-update/SKILL.md`.

## Workflow Policy

How we work — roles (the operator decides, Claude leads, Codex is an optional
second-opinion reviewer), process sized to risk, reporting, and when to stop
and ask — is one page: `docs/operations/agent-manager-workflow.md`. Don't
restate it here.

## Commit Protocol

This section is the single home for commit and push rules; `AGENTS.md` points here.

### Default rules

- Commit each verified step of work the operator asked for — one focused commit per logical unit. Don't commit work nobody asked for, or exploratory changes, without asking.
- Do not commit something broken (failing typecheck, failing tests, half-applied migration). If a checkpoint isn't verifiable, finish or revert first.
- Do not include unrelated dirty files in a focused commit. If the working tree has unrelated drift, either stash it, leave it alone, or commit it separately with its own message.
- If in doubt about scope or whether something should ship, ask.

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

- Push verified commits on `main` after each step (operator practice since 2026-10-05): GitHub is the off-site copy of the code, and a local-only commit is not a backup.
- Never push broken work. Pushing a new branch, force-pushing, or pushing anything the operator hasn't seen described needs the operator's OK.

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

- the active objective and any decisions made toward it, with rationale
- authorization boundaries already granted (e.g. approved edits, commit/push scope)
- files changed in the current workstream
- latest verification results
- unresolved assumptions or blockers
- the next 1-3 concrete actions

Do not preserve long command output unless it contains an active error that still matters.

## Plan Reference

Full architecture plan: `docs/ARCHITECTURE.md`
