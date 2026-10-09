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

Open `.env` and set:

- `POSTGRES_PASSWORD` to a non-default value
- `BETTER_AUTH_SECRET` to a long random value
- `BETTER_AUTH_URL` to the public base URL of the web app
- `APP_BASE_URL` to the same public base URL, used when admins copy invite links

Leave everything else at the defaults unless you have a specific reason to change it.

> The `DATABASE_URL` line in `.env` uses `localhost:5432` — this is for host-side tools
> (migrations, psql). The `web` and `worker` containers connect to `db:5432` internally;
> this is handled automatically in `docker-compose.yml`.
>
> **Port conflict:** The database publishes on host port `5433` by default, to avoid clashing
> with a system PostgreSQL on `5432`. Set `DB_HOST_PORT` in `.env` to move it, and make
> `DATABASE_URL` match (`localhost:<port>`). The containers are unaffected — they always connect
> to `db:5432` on the internal Docker network.
>
> All published ports bind to `127.0.0.1`. See **Host port exposure** below before widening one.

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

## 7. Member logins: settings and the first admin

Members sign in with **Discord only**, and only through an invite link. Plan:
`docs/superpowers/plans/2026-10-09-member-logins-step-1.md`.

### Settings (server `.env`)

```bash
BETTER_AUTH_SECRET=<openssl rand -base64 32>   # 32+ characters, no default
BETTER_AUTH_URL=https://boogeymen.app
APP_BASE_URL=https://boogeymen.app
DISCORD_CLIENT_ID=<Discord app "Boogeymen" → OAuth2>
DISCORD_CLIENT_SECRET=<same page, "Reset Secret">
```

The Discord application's redirect must be exactly
`https://boogeymen.app/api/auth/callback/discord`. With a missing or weak
setting the auth routes refuse to start (500) while the rest of the site keeps
working — check the web container log for "Member logins are misconfigured".

### The first admin (once)

Invites are normally made by an admin on `/admin/accounts`. The very first
admin comes from a one-time command, which refuses once any admin exists:

```bash
docker compose exec worker node dist/init-admin-cli.js --player-id 2
# [init-admin] admin invite for silkyjoker85 — works once, until …:
#   https://boogeymen.app/invite/<token>
```

Open the link, sign in with Discord, and that account is the admin, linked to
the player. Only the token's hash is stored; if the link is lost or expires,
run the command again (it replaces the old link). `--dry-run` checks without
writing; `--hours` sets the lifetime (default 24).

### Checking the auth surface after a deploy

```bash
curl -s -o /dev/null -w 'get-session %{http_code}\n' https://boogeymen.app/api/auth/get-session  # 200
curl -s -o /dev/null -w 'login %{http_code}\n' https://boogeymen.app/login                       # 200
curl -s -o /dev/null -w 'password sign-in %{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{"email":"a@b.test","password":"password123"}' \
  https://boogeymen.app/api/auth/sign-in/email                                                  # 404
```

### Emergency: sign everyone out

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c 'DELETE FROM sessions;'
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

## Host port exposure

Every port this stack publishes binds to `127.0.0.1`:

| Service         | Host binding     | Reached by                                                   |
| --------------- | ---------------- | ------------------------------------------------------------ |
| `web`           | `127.0.0.1:3000` | `cloudflared` over the compose network; SSH tunnel           |
| `worker` health | `127.0.0.1:3001` | the host itself; SSH/Tailscale for remote checks             |
| `db`            | `127.0.0.1:5433` | host-side tools (migrations, psql); containers use `db:5432` |

**Docker's published ports are not covered by your host firewall.** Publishing a port
writes DNAT rules that are evaluated before the usual `ufw`/`firewalld` filter rules, so a
`0.0.0.0` binding is genuinely reachable from the LAN — and from the internet if anything
upstream forwards to this host — even with a restrictive firewall configured. Never use
`0.0.0.0` as a production binding.

### Verifying that ports are private

The absence of a tunnel route does not prove a port is private: a published port, a router
port-forward, or a UPnP mapping can each expose it by a path the tunnel knows nothing about.
Verify directly, from three vantage points:

```bash
# 1. On the host — what is actually bound, and to which address?
ss -tlnp | grep -E ':(3000|3001|5433)\s'      # expect 127.0.0.1, not 0.0.0.0 or *
docker compose ps --format 'table {{.Service}}\t{{.Ports}}'

# 2. From another machine on the LAN — must fail to connect
nc -zv <host-lan-ip> 3000 3001 5433

# 3. From outside the network — must fail to connect.
#    Use an off-network host you control, or a reputable port-check service against
#    your WAN address. Check the WAN address, not the domain: the domain resolves to
#    Cloudflare, so testing it proves nothing about this host.
nc -zv <wan-ip> 3000 3001 5433
```

Also confirm no port-forward or UPnP mapping to this host exists in the router's admin
interface. Record the date and result — this is the evidence the Gate 2 "confirm the
database port and worker health endpoint will not be exposed" item asks for.

### Granting the remote OCR pipeline database access

If the OCR/video-ingest pipeline on another machine needs to reach PostgreSQL directly, bind
to **this host's own Tailscale address** — a specific address on the private tailnet — rather
than widening to `0.0.0.0`. In `.env` on the database host:

```bash
DB_BIND_ADDR=100.98.29.119     # this host's tailnet address; NOT 0.0.0.0
```

Then `docker compose up -d db` and re-run the verification above: the port must answer on the
tailnet address and still refuse on the LAN and WAN addresses. Tailscale ACLs, not the port
binding alone, decide which tailnet devices may connect.

---

## Publishing the site (Cloudflare Tunnel)

The tunnel is **opt-in**, behind the `public` compose profile. A host that does not publish
the site runs the default stack and gets `db`, `worker`, and `web` only — no cloudflared
container, no warning, nothing to configure.

### Enabling it

1. Create the tunnel and its DNS records in Cloudflare, with ingress routed to
   `http://web:3000` — the compose network's internal name for the web container. Route only
   `web`. The database and worker health endpoints must have no ingress rule and no DNS
   record.
2. Write the tunnel token into a file on the host. It is never passed as a command argument
   (arguments show up in `docker inspect`, in `ps`, and in pasted `docker compose config`
   output) and never stored in the repo:

   ```bash
   mkdir -p ./secrets
   install -m 600 /dev/null ./secrets/cloudflared-tunnel-token
   printf %s '<token>' > ./secrets/cloudflared-tunnel-token   # no newline, no prefix
   ```

   `./secrets/` is gitignored. Set `TUNNEL_TOKEN_FILE` in `.env` to use a different path.

   The `cloudflared` image runs as uid `65532`, and Compose bind-mounts the file with its host
   ownership, so a `600` file owned by your user fails with "permission denied" when reading the
   token file. Hand the file to that uid (it stays `600`; seen on Hotel-Echo 2026-10-05):

   ```bash
   sudo chown 65532:65532 ./secrets/cloudflared-tunnel-token
   ```

3. Set `BETTER_AUTH_URL` and `APP_BASE_URL` in `.env` to the public `https://` URL.
4. Start with the profile:

   ```bash
   docker compose --profile public up -d
   ```

Every later command that should include the tunnel needs the flag too
(`docker compose --profile public ps`, `... restart cloudflared`). Without it, Compose treats
cloudflared as out of scope and leaves it alone.

> The mounted token file keeps the secret out of process listings and rendered config. It
> does **not** hide it from a host administrator: anyone who can read the file, or who can
> talk to the Docker daemon (which is root-equivalent), can read the token. Treat host root
> access and tunnel-token compromise as the same event.

### Updating cloudflared

The image is pinned to an exact version **and** digest, and `--no-autoupdate` stops the binary
from replacing itself. Do not change the pin to `latest` — an unpinned tunnel is a container
that can change what it runs underneath you, on a restart you did not schedule.

To update deliberately:

```bash
# 1. Pick the target release and resolve its digest.
docker pull cloudflare/cloudflared:<new-version>
docker image inspect cloudflare/cloudflared:<new-version> --format '{{index .RepoDigests 0}}'

# 2. Edit docker-compose.yml: set image to cloudflare/cloudflared:<new-version>@sha256:<digest>
#    Commit that change — the pin belongs in git, not only on the host.

# 3. Roll it, and confirm the tunnel re-registers.
docker compose --profile public up -d cloudflared
docker compose --profile public logs cloudflared --tail 50   # expect registered connections
curl -sSI https://<your-domain> | head -1                    # expect HTTP/2 200
```

If the new version misbehaves, restore the previous `image:` line and re-run step 3 — the old
digest is still the rollback target.

---

## Troubleshooting

| Symptom                                                   | Likely cause                                                  | Fix                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| Worker logs "No active game titles. Skipping cycle."      | `game_titles` table is empty or no row has `is_active = true` | Re-run the seed script                                          |
| Web or worker crash-loops with DB errors                  | Migrations not applied                                        | Run `pnpm --filter db migrate` then restart                     |
| `curl localhost:3001/health` connection refused           | Worker container not running or `HEALTH_PORT` mismatch        | Check `docker compose ps` and `.env`                            |
| `next build` hangs during `docker compose up`             | First-time image build — normal                               | Wait for build to complete                                      |
| `docker compose up db` fails: "port is already allocated" | Another PostgreSQL is using the host port                     | Set `DB_HOST_PORT` in `.env` and update `DATABASE_URL` to match |
