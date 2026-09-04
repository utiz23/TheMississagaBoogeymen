# ops/ — operational units (in-repo, reproducible)

## Verification database isolation (read this first)

Verification runs suites that **write** — `@eanhl/db` integration tests, the
`@eanhl/worker` suite, and the `--full` reprocess E2E. Everything they write
lands wherever `DATABASE_URL` points, so the verification path must never be
given the application's `DATABASE_URL`.

The contract, enforced in code by
[`apps/worker/scripts/lib/test-db-guard.mjs`](../apps/worker/scripts/lib/test-db-guard.mjs):

- the source DSN is **`TEST_DATABASE_URL` only**. `DATABASE_URL` is never read
  as a source and there is **no `.env` fallback** anywhere in this path;
- `TEST_DB_CONTAINER`, `TEST_DB_COMPOSE_PROJECT` and `TEST_DB_COMPOSE_SERVICE`
  are **mandatory and have no defaults** — a default would name the production
  container;
- the source database and the generated clone must both be inside the approved
  namespace `eanhl_test` / `eanhl_dev` / `eanhl_ci` / `eanhl_scratch`
  (`eanhl`, `postgres`, `template0`, `template1` and anything carrying a
  production marker are rejected);
- before **any** `CREATE DATABASE` / `DROP DATABASE`, including stale-clone
  cleanup, the harness inspects the container, requires its Compose
  project/service labels to match exactly, requires
  `eanhl.nonproduction="true"`, requires it to be running with PostgreSQL
  reachable, and then reads the cluster `system_identifier` **twice** — once
  over `TEST_DATABASE_URL` and once through `docker exec` — and requires them to
  be identical.

That last check is the point. A loopback address proves nothing: `ssh -L
5434:prod-db:5432` makes a remote production cluster answer on `127.0.0.1`. Its
`system_identifier` will not match the local container's, and the harness
refuses. Any failed command, empty or malformed identifier, or mismatch is a
refusal — it fails closed, never open.

### 1. Bring up the disposable verification cluster

It is a **separate** Compose project from the application stack, on its own
port and its own volume:

```bash
cp ops/verify.env.example ~/.config/eanhl/verify.env   # mkdir -p ~/.config/eanhl first
chmod 600 ~/.config/eanhl/verify.env
$EDITOR ~/.config/eanhl/verify.env                     # set TEST_DB_PASSWORD + the DSN

set -a && . ~/.config/eanhl/verify.env && set +a
docker compose --env-file "$HOME/.config/eanhl/verify.env" \
  -f docker-compose.test.yml up -d
```

`--env-file` is not optional. Without it `docker compose` implicitly reads the
repo-root `.env` — the **application** env file — to interpolate
`TEST_DB_PASSWORD` and friends. Naming the verification env file explicitly
keeps the application `.env` out of this workflow. Use the same form for every
other verification-cluster command:

```bash
COMPOSE_VERIFY=(docker compose --env-file "$HOME/.config/eanhl/verify.env" -f docker-compose.test.yml)
"${COMPOSE_VERIFY[@]}" config     # parse/inspect, starts nothing
"${COMPOSE_VERIFY[@]}" ps
"${COMPOSE_VERIFY[@]}" logs -f db-test
"${COMPOSE_VERIFY[@]}" down       # add -v to discard the seeded volume
```

This creates project `eanhl-verify-test`, service `db-test`, container
`eanhl-verify-test-db-test-1`, database `eanhl_test`, published on
`127.0.0.1:5434` (the application uses 5433 — deliberately different so a stale
shell variable cannot cross the two). The container carries
`eanhl.nonproduction="true"`; without that label the harness will not touch it.

### 2. Seed it

The worker suite anchors ~10 tests on real ingested match 250/463 data that
migrations do not recreate, so the verification database needs a seed. This is
an **operator** step, run deliberately and not by any hook or timer:

```bash
# Take a dump of the application database (read-only on the source).
docker exec eanhl-team-website-db-1 \
  pg_dump -U eanhl --no-owner --no-privileges eanhl > /tmp/eanhl-seed.sql

# Load it into the verification cluster.
docker exec -i eanhl-verify-test-db-test-1 \
  psql -U eanhl_test -d eanhl_test -v ON_ERROR_STOP=1 < /tmp/eanhl-seed.sql

shred -u /tmp/eanhl-seed.sql   # it is a full copy of the application data
```

Refresh it when the schema or the anchor matches drift. The harness clones
`eanhl_test` per run and drops the clone afterwards, so the seed itself stays
intact.

### 3. The verification env file

Path: `~/.config/eanhl/verify.env` · mode `600` · owned by the operator ·
template `ops/verify.env.example`.

| Variable                                                  | Required    | Rule                                                                                                                                                                 |
| --------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL`                                       | yes         | `postgres://`/`postgresql://`, loopback host, database in the approved namespace. The role must be able to execute `pg_control_system()` (the Compose superuser is). |
| `TEST_DB_CONTAINER`                                       | yes         | Exact container name. Must contain a nonproduction token (`test`/`tests`/`dev`/`ci`/`scratch`/`verify`) and no production marker.                                    |
| `TEST_DB_COMPOSE_PROJECT`                                 | yes         | Must equal the container's `com.docker.compose.project` label exactly, same naming rules.                                                                            |
| `TEST_DB_COMPOSE_SERVICE`                                 | yes         | Must equal the container's `com.docker.compose.service` label exactly.                                                                                               |
| `TEST_DB_USER` / `TEST_DB_PASSWORD` / `TEST_DB_HOST_PORT` | for compose | Consumed by `docker-compose.test.yml` when bringing the cluster up.                                                                                                  |

**Never** put `DATABASE_URL` in this file, and never merge it into the
application `.env`. It holds a database password: keep it at mode `600`, outside
the repo, and out of backups that leave the machine.

### 4. Run verification

```bash
set -a && . ~/.config/eanhl/verify.env && set +a
pnpm verify:ocr            # or: bash scripts/verify-ocr.sh --full
```

`scripts/verify-ocr.sh` unsets `DATABASE_URL` for its whole run and provisions a
fresh disposable clone per DB-backed step (steps 1, 2, 4 and `--full`). Each
clone is dropped afterwards, including on Ctrl-C. A run therefore costs a few
extra `pg_dump | psql` copies compared with the old single-clone harness; that
is the price of never handing a production DSN to a suite that writes.

The hermetic safety suite runs first and can be run on its own at any time — it
needs no Docker, no PostgreSQL and no secrets:

```bash
pnpm --filter @eanhl/worker test:safety
```

## Nightly OCR verification

`eanhl-verify.service` + `eanhl-verify.timer` run `scripts/verify-ocr.sh --full`
nightly — the catch-all that exercises the heavy end-to-end path the advisory
pre-push hook skips. The units are committed here so the deliverable lives in
the repo; only the `systemctl enable` is machine-local.

The service loads `%h/.config/eanhl/verify.env` — the verification env file
above — and **not** the application `.env`. The path has no leading `-`, so a
missing file fails the unit rather than starting a run with no isolation
configuration.

### systemd (preferred)

```bash
mkdir -p ~/.config/systemd/user
ln -sf "$PWD/ops/eanhl-verify.service" ~/.config/systemd/user/eanhl-verify.service
ln -sf "$PWD/ops/eanhl-verify.timer"   ~/.config/systemd/user/eanhl-verify.timer
systemctl --user daemon-reload
systemctl --user enable --now eanhl-verify.timer
loginctl enable-linger "$USER"        # run while logged out
systemctl --user list-timers eanhl-verify.timer
```

Edit `WorkingDirectory` in `eanhl-verify.service` if the repo is not at
`~/projects/eanhl-team-website`.

Logs: `journalctl --user -u eanhl-verify.service -e`

### cron fallback (no systemd --user)

```cron
# 03:30 nightly — full OCR verify. Edit the repo path. Loads the VERIFICATION
# env file, never the application .env.
30 3 * * *  cd "$HOME/projects/eanhl-team-website" && unset DATABASE_URL && set -a && . "$HOME/.config/eanhl/verify.env" && set +a && bash scripts/verify-ocr.sh --full >> "$HOME/eanhl-verify.log" 2>&1
```

## Enforcement model (read this)

- **Authoritative, fail-closed:** the `decoder-runs activate` quality gate
  (WS0.1A). Bad runs cannot become canonical regardless of local git config.
- **Advisory:** the `.githooks/pre-push` hook (bypassable with `--no-verify`),
  self-installed via the root `package.json` `prepare` script
  (`git config core.hooksPath .githooks`) on `pnpm install`. It no longer
  sources `.env`; if the verification configuration is missing it **blocks**
  rather than skipping, because a missing safety configuration must not read as
  "nothing to check".
- **Catch-all:** this nightly timer.
- **Hermetic:** the verification-database isolation safety suite
  (`apps/worker/scripts/lib/*.test.mjs`), which runs before any DB-backed step
  and proves the refusals above without a database.
