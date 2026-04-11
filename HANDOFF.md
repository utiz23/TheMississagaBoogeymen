# Handoff

## Current Status

**Phase:** 0 complete — Monorepo foundation set up. Ready to begin Phase 1.

**Last updated:** 2026-04-11

---

## What Was Done

### Architecture & Planning

- Full system architecture designed and documented in `docs/ARCHITECTURE.md`
- Blueprint (`EASHL Team Stats Website – Full Blueprint.md`) treated as reference only; plan supersedes it
- Key decisions: no separate API server (Next.js handles it), game titles as primary grouping (not in-game seasons), Docker Compose for self-hosting, composite match PK `(game_title_id, match_id)`

### Phase 0: Monorepo Foundation

- pnpm workspaces + Turborepo configured
- TypeScript 5 strict base config + per-package tsconfigs
- ESLint v9 flat config (strict TypeScript rules) + Prettier
- Docker Compose with db + worker + web services, restart policies, health checks
- `.env.example` with all required vars
- `apps/api` removed; `apps/worker` created in its place
- All four workspaces have `package.json` + `tsconfig.json`
- `pnpm install` runs clean

---

## What's Next

### Phase 1: Database + EA Client + API Exploration

1. **`packages/db`** — Drizzle ORM setup, full schema, migrations, run against local PostgreSQL
2. **`packages/ea-client`** — HTTP client with retry/backoff/throttle, typed endpoints
3. **Manually probe the EA API** — call each endpoint, save real responses as fixtures in `packages/ea-client/__fixtures__/`
4. **Resolve unknowns:**
   - Is `ea_id` (blazeId) present and stable across endpoints?
   - Are match IDs unique per game title, or globally unique?
   - Is in-game season number present in the match response?
5. **Contract tests** — parse fixtures through transform logic, assert expected output

Full schema in `docs/ARCHITECTURE.md` §3.2.

---

## Open Decisions / Blockers

None currently. Unknowns above are resolved during Phase 1 exploration.

---

## Key Files

| File                   | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Full architecture plan with schema, ingestion strategy, phases |
| `CLAUDE.md`            | Project conventions, commands, domain concepts                 |
| `.env.example`         | All required environment variables                             |
| `docker-compose.yml`   | Service definitions                                            |
| `pnpm-workspace.yaml`  | Workspace layout                                               |
| `turbo.json`           | Build pipeline                                                 |
