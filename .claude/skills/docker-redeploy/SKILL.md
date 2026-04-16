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
docker compose up -d worker
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
docker compose up -d web
```

Verify the web container started cleanly:

```bash
docker logs eanhl-team-website-web-1 --tail 20
```

### Both services

```bash
docker compose build worker web
docker compose up -d worker web
```

## Container Reference

| Service | Container name                | Internal port |
| ------- | ----------------------------- | ------------- |
| worker  | `eanhl-team-website-worker-1` | —             |
| web     | `eanhl-team-website-web-1`    | 3000          |
| db      | `eanhl-team-website-db-1`     | 5432          |

DB connection from host: `postgresql://eanhl:eanhl_dev_2026@localhost:5433/eanhl`

The DB host port is `5433` (not `5432`) because port 5432 is occupied by another project on this machine. See `DEPLOY.md`.

## Rules

- Always tail logs after restart to confirm the new build is actually running.
- Do not skip the build step — `docker compose up -d` without `build` reuses the old image.
- If the worker crashes on startup, check `docker logs eanhl-team-website-worker-1` for the first error line.
