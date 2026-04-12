# Deployment Guide

Self-hosted deployment via Docker Compose on a home PC.

## Prerequisites

- Docker + Docker Compose installed
- `pnpm` installed on the host (for migrations)
- `psql` available (for seeding; or use `docker compose exec db psql` as an alternative)

---

## Startup sequence

**Order is critical.** Migrations and seeding must run before the application services start,
or both `web` and `worker` will crash-loop with "relation does not exist" errors.

```
1. Configure env
2. Start database
3. Run migrations
4. Seed game_titles
5. Start all services
6. Verify
```

---

## 1. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set `POSTGRES_PASSWORD` to a non-default value. Leave everything else at
the defaults unless you have a specific reason to change it.

> The `DATABASE_URL` line in `.env` uses `localhost:5432` — this is for host-side tools
> (migrations, psql). The `web` and `worker` containers connect to `db:5432` internally;
> this is handled automatically in `docker-compose.yml`.
>
> **Port conflict:** If port 5432 is already in use by another PostgreSQL instance (e.g. another
> Docker project), change the host port in `docker-compose.yml` (e.g. `"5433:5432"`) and update
> `DATABASE_URL` in `.env` to match (`localhost:5433`). The containers are unaffected — they
> always connect to `db:5432` on the internal Docker network.

---

## 2. Start the database

```bash
docker compose up db -d
```

Wait until the health check passes:

```bash
docker compose ps
# Status column should show "healthy" for the db service
```

---

## 3. Run migrations

Run from the host (not inside a container). Replace `YOURPASSWORD` with the value you set
in `.env`:

```bash
DATABASE_URL=postgresql://eanhl:YOURPASSWORD@localhost:5432/eanhl \
  pnpm --filter db migrate
```

Migrations are idempotent — safe to re-run after upgrades.

---

## 4. Seed the active game title

The worker checks `game_titles WHERE is_active = true` at the start of every cycle. Without
at least one active row it logs "No active game titles. Skipping cycle." and does nothing.

```bash
# Via psql on the host:
psql postgresql://eanhl:YOURPASSWORD@localhost:5432/eanhl \
  < packages/db/seed/game_titles.sql

# Or via the db container if psql is not installed locally:
docker compose exec -T db psql -U eanhl eanhl \
  < packages/db/seed/game_titles.sql
```

Running the seed script again is safe (uses `ON CONFLICT DO NOTHING`).

---

## 5. Start all services

```bash
docker compose up -d
```

Docker Compose builds the `web` and `worker` images on first run (may take a few minutes).
All three services start: `db`, `worker`, `web`.

---

## 6. Verify

```bash
# Watch worker logs — should see "Starting polling loop" within seconds
docker compose logs worker -f

# Health endpoint
# Returns {"status":"degraded"} until the first ingest cycle completes,
# then {"status":"ok"} with the last ingest timestamp.
curl http://localhost:3001/health

# Web app
open http://localhost:3000
```

The worker runs its first ingestion cycle within `POLL_INTERVAL_MS` (default: 5 minutes).
To trigger an immediate cycle without waiting:

```bash
docker compose exec worker node dist/ingest-now.js
```

---

## Ongoing operations

### Restart services

```bash
docker compose restart           # all services
docker compose restart worker    # worker only
```

### Force an immediate ingestion cycle

```bash
docker compose exec worker node dist/ingest-now.js
```

### Reprocess failed transforms

If some raw payloads have `transform_status = 'error'` (visible in `ingestion_log`):

```bash
docker compose exec worker node dist/reprocess.js
# Preview without writing:
docker compose exec worker node dist/reprocess.js --dry-run
```

### Apply new migrations after a schema update

```bash
docker compose down
DATABASE_URL=postgresql://eanhl:YOURPASSWORD@localhost:5432/eanhl \
  pnpm --filter db migrate
docker compose up -d
```

### Backup the database

```bash
docker compose exec db pg_dump -U eanhl eanhl > backup_$(date +%Y%m%d_%H%M%S).sql
```

Restore:

```bash
docker compose exec -T db psql -U eanhl eanhl < backup_20260101_120000.sql
```

---

## Troubleshooting

| Symptom                                                   | Likely cause                                                  | Fix                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Worker logs "No active game titles. Skipping cycle."      | `game_titles` table is empty or no row has `is_active = true` | Re-run the seed script                                                      |
| Web or worker crash-loops with DB errors                  | Migrations not applied                                        | Run `pnpm --filter db migrate` then restart                                 |
| `curl localhost:3001/health` connection refused           | Worker container not running or `HEALTH_PORT` mismatch        | Check `docker compose ps` and `.env`                                        |
| `next build` hangs during `docker compose up`             | First-time image build — normal                               | Wait for build to complete                                                  |
| `docker compose up db` fails: "port is already allocated" | Another PostgreSQL is using port 5432                         | Change `docker-compose.yml` to `"5433:5432"` and update `.env` DATABASE_URL |
