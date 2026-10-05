# Nightly database backup

Every night at 3:00 a.m. (America/Edmonton) the `backup` service:

1. copies the live database (about 27 MB compressed),
2. **proves the copy works** by restoring it into a throwaway database inside
   the backup container and checking the match count,
3. saves it on the backup disk (`K:\eanhl-backups` on the main PC),
4. uploads it to Backblaze B2,
5. checks in with Healthchecks.io. If a run fails — or never happens (PC off,
   Docker stopped, disk missing) — Healthchecks.io **emails the owner**.

If the PC was off at 3:00, the backup runs as soon as everything is up again
that day. A whole run takes about 30 seconds and doesn't interrupt the site.

## Where the copies are

| Where | What is kept |
|---|---|
| `K:\eanhl-backups\daily\` | last 14 nights |
| `K:\eanhl-backups\weekly\` | last 8 Sundays |
| `K:\eanhl-backups\monthly\` | last 12 first-of-the-month copies |
| Backblaze B2 bucket, folder `eanhl/<year>/` | 90 days (Backblaze's own lifecycle rule hides older copies, then deletes them 7 days later) |

File names carry the date: `eanhl-2026-10-05.dump` locally,
`eanhl-20261005T090000Z.dump` (UTC time) in Backblaze.

## Everyday use

Nothing. No email means it's working. You can also look at the check on
healthchecks.io at any time — it shows every run with its log.

Handy commands (run in the project folder):

```bash
docker compose exec backup backup.sh     # take a backup right now
docker compose logs backup --tail 40     # see what recent runs did
docker compose ps backup                 # is the service running?
```

## If you get an alert email

Open the check on healthchecks.io — the failed run's log is attached to it.
Common causes:

- **"backup disk not found"** — K: isn't connected/mounted. Reconnect it, then
  run a backup by hand.
- **"database ... is not answering"** — the site's database is down; that's the
  bigger problem. `docker compose ps`.
- **curl error 401 during step 4** — the Backblaze key is wrong or was deleted.
  Make a new key (see Setup) and update `.env`, then
  `docker compose up -d backup`.
- **No log at all, just "no check-in"** — the PC was off, or Docker Desktop
  isn't running.

## How to get data back

Pick the copy you want: a file from `K:\eanhl-backups\...`, or download one
from Backblaze (Browse Files → your bucket → `eanhl/<year>/` → Download).
In the commands below, replace `FILE` with its path as Linux sees it — e.g.
`/mnt/k/eanhl-backups/daily/eanhl-2026-10-05.dump` or
`/mnt/c/Users/micha/Downloads/eanhl-20261005T090000Z.dump`.

### A. Just look at an old copy (safe — the live site is untouched)

```bash
docker run -d --rm --name restore-check -e POSTGRES_USER=eanhl \
  -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=eanhl -p 127.0.0.1:5440:5432 postgres:16-alpine
sleep 10
docker exec -i restore-check pg_restore -U eanhl -d eanhl --no-owner --exit-on-error < FILE
docker exec restore-check psql -U eanhl -d eanhl -c 'select count(*), max(played_at) from matches'
docker stop restore-check        # throws it away again
```

### B. Replace the live database with a backup (the real emergency)

This **overwrites everything currently in the live database**. Ask Claude to do
it with you if you can.

```bash
# 1. stop everything that uses the database
docker compose stop web worker backup
# 2. keep a copy of the current (broken) state, just in case
docker compose exec -T db pg_dump -U eanhl -Fc eanhl > /mnt/k/eanhl-backups/before-restore-$(date +%F-%H%M).dump
# 3. empty the database and load the backup
docker compose exec -T db dropdb -U eanhl eanhl
docker compose exec -T db createdb -U eanhl eanhl
docker compose exec -T db pg_restore -U eanhl -d eanhl --no-owner --exit-on-error < FILE
# 4. check it, then start everything again
docker compose exec -T db psql -U eanhl -d eanhl -c 'select count(*), max(played_at) from matches'
docker compose start web worker backup
```

Matches played between that backup and now are re-fetched by the worker only
if EA still lists them (EA keeps roughly the last 5 games).

## Setup (one time per machine — already done on the main PC)

1. **Backblaze B2** (backblaze.com, free tier): create a **private** bucket
   with encryption enabled; under *Lifecycle Settings* use custom rules —
   days till hide `90`, days till delete `7`. Under *Application Keys* add a
   key limited to that bucket with access type **Write Only**, and copy both
   values (the application key is shown only once). Note: Backblaze's "Write
   Only" preset can still delete files in that bucket; it can't touch anything
   else in the account.
2. **Healthchecks.io**: create a check with schedule *Cron* `0 3 * * *`,
   time zone `America/Edmonton`, grace time 2 hours. Copy its ping URL.
3. **`.env`** in the project folder (never committed):
   ```
   COMPOSE_PROFILES=backup          # add ",public" etc. if other profiles are used
   B2_KEY_ID=...
   B2_APP_KEY=...
   HC_PING_URL=https://hc-ping.com/...
   # optional: BACKUP_DIR (default /mnt/k/eanhl-backups), BACKUP_TIME (03:00), BACKUP_TZ
   ```
4. Mark the backup folder (a safety check — runs refuse to start without it,
   so an unplugged disk can't silently send backups somewhere else):
   `mkdir -p /mnt/k/eanhl-backups && touch /mnt/k/eanhl-backups/.eanhl-backup-target`
5. `docker compose up -d --build backup`, then `docker compose exec backup backup.sh`
   and confirm the run shows up on healthchecks.io.

## Not included (on purpose)

- **Encryption with a password of our own.** Today the database holds public
  game stats only, and a lost password means unreadable backups. Revisit when
  logins launch and the database starts holding emails.
- The older, unfinished Proton Drive backup system in `ops/backup/` is
  parked and not used by this service.
