# Docker Redeploy

Use this skill after committing new worker or web code that needs to run inside Docker.

## Why This Exists

After a commit, the running Docker containers continue executing the previously built image. New code is silently ignored until the image is rebuilt. This has caused at least one full verification pass to debug — the worker cycled normally but logged no trace of new functionality.

## Detection — Is the image stale?

Check whether the running container predates the last commit:

```bash
git log --oneline -1 --format="%ai %s"
docker inspect eanhl-team-website-worker-1 --format '{{.Created}}'
```

If the container creation timestamp is older than the commit timestamp, the image is stale.

## Redeploy Sequence

### Worker

```bash
docker compose build worker
docker compose up -d --no-deps worker
```

Verify new code is running — look for log lines that only exist in the new version:

```bash
docker logs eanhl-team-website-worker-1 --tail 40
```

For member stats ingestion, the signal is:

```
[members] nhl26: N/N members upserted
```

### Web

```bash
docker compose build web
docker compose up -d --no-deps web
```

Verify the web container started cleanly:

```bash
docker logs eanhl-team-website-web-1 --tail 20
```

### Both services

```bash
docker compose build worker web
docker compose up -d --no-deps worker web
```

## Container Reference

| Service | Container name                | Internal port |
| ------- | ----------------------------- | ------------- |
| worker  | `eanhl-team-website-worker-1` | —             |
| web     | `eanhl-team-website-web-1`    | 3000          |
| db      | `eanhl-team-website-db-1`     | 5432          |

DB connection from host: `postgresql://eanhl:$POSTGRES_PASSWORD@localhost:5433/eanhl`
(load it with `set -a && source .env && set +a`; never paste the literal password here)

The DB host port is `5433` (not `5432`) because port 5432 is occupied by another project on this machine. See `DEPLOY.md`.

## Rules

- Always tail logs after restart to confirm the new build is actually running.
- Do not skip the build step — `docker compose up -d` without `build` reuses the old image.
- Always pass `--no-deps`. Without it Compose may also recreate `db` (and restart
  PostgreSQL) when it considers that container out of date — this happened on
  2026-10-05; data was intact, but a database restart should never be a side effect.
- Before rebuilding, tag the running images as a rollback point, e.g.
  `docker tag eanhl-team-website-web:latest eanhl-team-website-web:rollback-<date>`.
  Rollback = retag that image as `:latest` and `docker compose up -d --no-deps web`.
  Tag BEFORE `docker compose build`: on this Docker Desktop setup the old image
  record disappears as soon as the build moves `:latest`, even while a container
  still runs it, and can no longer be tagged (seen 2026-10-05).
- If the worker crashes on startup, check `docker logs eanhl-team-website-worker-1` for the first error line.
