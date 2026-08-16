# Deploy `540777a` (period-family review-gating) to Docker — 2026-08-15

**Result:** ✅ **PASS**. `web` and `worker` rebuilt from an isolated snapshot of commit
`540777a17daa9f5df428cf0ffab141a02314748b` and redeployed. All smoke checks pass except one
**pre-existing, unrelated** worker `/health` defect (documented below, not caused by this session
and not fixed by it, per the "no source-code changes" constraint).

**Scope of this session:** build, deploy, and smoke-test the exact committed repository state at
`540777a`, excluding all dirty/untracked working-tree changes. No source change, no migration
change, no manual migration/promotion/rescue/smoke-test database write, no rescue, OCR promotion,
reprocessing, or manually invoked ingest command, no commit, no push. The redeployed worker resumed
its normal scheduled ingestion cycle and performed expected routine application writes (see §7.5,
§9).

| field | value |
|---|---|
| Deployed commit | `540777a17daa9f5df428cf0ffab141a02314748b` (branch `main`) |
| Repository HEAD at session start and end | `540777a17daa9f5df428cf0ffab141a02314748b` (unchanged) |
| Isolated snapshot | `/tmp/eanhl-deploy-540777a-snapshot` (populated via `git archive 540777a…`) |
| Project name | `eanhl-team-website` |

---

## 1. Authorization

Presented the full Phase 5 gate — snapshot path/commit, dirty-file exclusion proof, old/new image
IDs, rollback tags and commands, build results, family-column code confirmation in both new images,
running container IDs, exact deploy/rollback commands, and confirmation that `db` would not be
touched and no container had changed yet — and asked for `DEPLOY CLEAN HEAD 540777A`.

**Authorization received verbatim:** `DEPLOY CLEAN HEAD 540777A`.

---

## 2. Preflight (read-only)

- `git status --short` / `git rev-parse HEAD` confirmed HEAD at `540777a`, branch `main`, with the
  known pre-existing dirty/untracked files (3s lineup shaping, OCR coverage pills, games-list work,
  docs) — all left untouched throughout.
- Running containers before deploy: `eanhl-team-website-web-1` (image `145c0bde76cd`, built
  2026-08-02), `eanhl-team-website-worker-1` (image `4b753d6cfdc2`, built 2026-06-01),
  `eanhl-team-website-db-1` (`postgres:16-alpine`, healthy, up 10h). Web/worker logs showed no
  errors — worker completing normal 5-minute ingest cycles.
- Database reconfirmed read-only (`PGOPTIONS=-c default_transaction_read_only=on`):
  17 `match_period_summaries` columns, 3 family CHECK constraints, 0 backfill mismatches, 259 rows /
  65 matches, family distribution 171 `pending_review` / 88 `reviewed` per family, visibility parity
  88 rows — all matching the authoritative
  [migration-0056-application-2026-08-15.md](migration-0056-application-2026-08-15.md) record.
- Selected samples: **match 250** (all 4 periods `reviewed` — the canonical OCR benchmark match) and
  **match 253** (all 4 periods `pending_review`). Captured expected period values for match 250
  (P1 0-0/5-2/6-2, P2 2-0/9-3/5-3, P3 1-3/6-9/5-3, P4(OT) 1-0/9-2/5-1 — goals/shots/faceoffs) for
  later comparison.

---

## 3. Isolated snapshot — dirty-worktree exclusion proof

```bash
git archive 540777a17daa9f5df428cf0ffab141a02314748b | tar -x -C /tmp/eanhl-deploy-540777a-snapshot
```

Verified:
- `apps/web/src/components/ui/ocr-pill.tsx`, `apps/web/src/lib/lineup-shape.ts`,
  `apps/web/src/lib/ocr-coverage.ts`, `packages/db/src/queries/ocr-coverage.ts` — **absent** from
  the snapshot.
- Snapshot's `apps/web/src/app/games/page.tsx` does **not** contain `getOcrCoverageForMatches`.
- Snapshot **does** contain `packages/db/migrations/0056_period_family_review_status.sql` and the
  family-column query code in `packages/db/src/queries/match-enrichments.ts`.
- No `.env` file present in the snapshot.
- The snapshot's copy of the 0056 migration file diffed byte-identical against
  `git show 540777a:packages/db/migrations/0056_period_family_review_status.sql`.

---

## 4. Rollback preparation

| service | old image ID | rollback tag |
|---|---|---|
| web | `145c0bde76cd` | `eanhl-team-website-web:pre-0056-deploy-20260815` |
| worker | `4b753d6cfdc2` | `eanhl-team-website-worker:pre-0056-deploy-20260815` |

Tags verified to resolve to the original image digests before and after the build.

Rollback command (not executed — deployment succeeded):

```bash
docker tag eanhl-team-website-web:pre-0056-deploy-20260815 eanhl-team-website-web:latest
docker tag eanhl-team-website-worker:pre-0056-deploy-20260815 eanhl-team-website-worker:latest
docker compose -p eanhl-team-website --env-file /home/michal/projects/eanhl-team-website/.env \
  -f /tmp/eanhl-deploy-540777a-snapshot/docker-compose.yml \
  up -d --no-deps --force-recreate web worker
```

---

## 5. Build

```bash
docker compose -p eanhl-team-website --env-file /home/michal/projects/eanhl-team-website/.env \
  build web worker
```

**Exit code 0** for both. Build context was the isolated snapshot directory (not the primary
working tree). Dependency chain built in-container per each Dockerfile: `@eanhl/db` →
`@eanhl/ea-client` → app (`web`/`worker`).

| service | new image ID | created |
|---|---|---|
| web | `089f0b6938c1` | 2026-08-16T03:13:16Z |
| worker | `1e0e30e63890` | 2026-08-16T03:12:03Z |

Confirmed different from the old image IDs. In-image `grep` for `goalsReviewStatus` found matches
in 11 files (web) and 10 files (worker), including `apps/worker/dist/reconcile-periods-cli.js`.
`find` for the dirty untracked filenames (`ocr-pill.tsx`, `lineup-shape.ts`, `ocr-coverage.ts`)
returned nothing in either image. Running containers were still on the old image IDs at this point
(build does not affect running containers).

---

## 6. Deployment

Reconfirmed immediately before recreating: DB still 17 columns, new image IDs unchanged, old
rollback tags still valid, snapshot's 0056 file still byte-identical to the pinned commit.

```bash
docker compose -p eanhl-team-website --env-file /home/michal/projects/eanhl-team-website/.env \
  -f /tmp/eanhl-deploy-540777a-snapshot/docker-compose.yml \
  up -d --no-deps --force-recreate web worker
```

Exit code 0. `db` was not included in the target service list and was not recreated, restarted, or
stopped.

| container | before | after |
|---|---|---|
| `eanhl-team-website-web-1` | `291ae6fc472d` (image `145c0bde76cd`) | `fe2e820b92d4` (image `089f0b6938c1`), started 2026-08-15T21:15:37-06:00 |
| `eanhl-team-website-worker-1` | `26adac9fd504` (image `4b753d6cfdc2`) | `9aa856ee4b53` (image `1e0e30e63890`), started 2026-08-15T21:15:37-06:00 |
| `eanhl-team-website-db-1` | `9dacad8ce351` | **unchanged** — same container ID, `StartedAt` unchanged at `2026-08-15T16:46:13Z`, healthy throughout |

---

## 7. Smoke verification

### 7.1 Compose / container state

`docker compose ps` after redeploy: `db` healthy (unchanged container), `web` and `worker` both
`Up`. `RestartCount` 0 for both new containers.

### 7.2 HTTP

| check | result |
|---|---|
| `GET /` (web root) | **200** |
| `GET /games` | **200** |
| `GET /games/250` (reviewed sample) | **200** |
| `GET /games/253` (pending-only sample) | **200** |
| `GET :3001/health` (worker) | **503**, `{"status":"degraded","lastSuccessfulIngest":null,...,"message":"No successful ingestion recorded yet"}` — see §7.6, pre-existing and unrelated |

### 7.3 Database/query compatibility (read-only, `PGOPTIONS=-c default_transaction_read_only=on`, executed from inside the new web image)

`getMatchPeriodSummaries(250)` (reviewed sample) returned **4 rows**, matching the pre-deploy DB
capture exactly (goals/shots/faceoffs per period, all three family statuses `reviewed`).

`getMatchPeriodSummaries(253)` (pending-only sample) returned **0 rows** — correctly masked by the
per-family visibility gate, no `42703`, no exception.

### 7.4 Worker compatibility — `reconcile-periods --all --json`, read-only

```bash
docker exec -w /app/apps/worker eanhl-team-website-worker-1 sh -c \
  "PGOPTIONS='-c default_transaction_read_only=on' node dist/reconcile-periods-cli.js --all --json"
```

- **Exit 0.**
- Valid JSON: top-level `"promote": false`, 65 match outcomes (one per distinct match in
  `match_period_summaries`).
- **Zero `promotedPeriods`** summed across every outcome and every family — confirms no writes
  occurred.
- No `42703`, no `undefined_column`, no exception in stdout or stderr.

### 7.5 Logs

`docker logs` on both new containers, grepped for `42703`, `undefined_column`, "missing column",
unhandled exceptions, restart-loop indicators, failed DB queries, and worker cycle failures —
**all clean, zero matches**. Worker completed a normal ingest cycle post-redeploy
(`nhl26/gameType5|gameType10|club_private: found=5 new=0 failed=0 status=success`,
`Aggregates recomputed`, `10/10 members upserted`).

### 7.6 Worker `/health` — pre-existing, unrelated finding (non-blocking)

`GET :3001/health` returns `503 degraded` with `"lastSuccessfulIngest": null`, despite the worker
log showing successful ingest cycles and `ingestion_log` holding 81,314+ `status='success'` rows
with valid `finished_at` values.

**Root cause, verified in-container:** `apps/worker/src/health.ts` (unchanged since commit
`ad1af4c`, 2026-04-11) queries:

```sql
SELECT finished_at FROM ingestion_log WHERE status = 'success'
ORDER BY finished_at DESC LIMIT 1
```

PostgreSQL's default null-ordering for `DESC` is `NULLS FIRST`. Three historical rows carry
`status='success'` with `finished_at IS NULL` (ids 17468, 69577, 81472 — dated 2026-05-17,
2026-07-26, and 2026-08-11, all predating this session). Those NULL rows sort first under `DESC`,
so the query always returns a NULL `finished_at`, regardless of how many legitimate successful rows
exist.

**Why this is not a deployment regression:** `health.ts` is byte-identical between the old
(2026-06-01-built) and new (today's) worker images — verified via `git log` showing no changes since
April. The triggering DB rows are historical, not created by this session. The old image, if
redeployed, would exhibit the identical failure against the identical DB state. Rollback would not
fix it. Per the hard constraint "no source-code changes," this was documented, not fixed.

### 7.7 Database invariants — reconfirmed post-deploy

| check | pre-deploy | post-deploy |
|---|---|---|
| `match_period_summaries` columns | 17 | **17** |
| backfill mismatches | 0 | **0** |
| total rows | 259 | **259** |
| family distribution (each family) | 171 pending / 88 reviewed | **171 / 88 — unchanged** |
| `drizzle.__drizzle_migrations` | 47 rows, max id 49 | **47 rows, max id 49 — unchanged** |

---

## 8. Rollback status

**Not executed.** Deployment passed all checks except the pre-existing, unrelated worker-health
finding in §7.6, which does not meet the rollback trigger (it is not caused by this deployment and
rollback would not resolve it). Rollback tags (`pre-0056-deploy-20260815` on both images) remain in
place and valid for any future need.

---

## 9. What did NOT change

- No source-code change, no migration change. No manual migration, promotion, rescue, or
  smoke-test database write occurred — all explicit validation queries (§2, §7.3) and
  `reconcile-periods` checks (§7.4) ran under `default_transaction_read_only=on` or were pure
  reads.
- No `db` container restart, recreation, or stop — same container ID and `StartedAt` throughout.
- No rescue, OCR promotion, reprocessing, or manually invoked ingest command ran. Ordinary
  scheduled worker ingestion resumed after deployment: the redeployed worker container performed
  its normal, non-manual scheduled ingestion cycle, which by design writes application data
  (§7.5) — this is expected routine service activity, not a manual validation mutation, and is
  distinct from the "no manual database write" claim above.
- No commit or push.
- All pre-existing dirty and untracked files in the primary working tree were left untouched.

**Database state was not completely unchanged.** The verified 0056-related invariants (17
`match_period_summaries` columns, 0 backfill mismatches, 259 period-summary rows, 171/88 per-family
distribution, and the untouched 47-row Drizzle ledger — §7.7) held exactly steady across the
deploy, and no manual database write of any kind occurred. But the redeployed worker's normal
scheduled ingestion cycle (§7.5) performed the same routine application writes it always performs
between polls, so the database as a whole was not static during this session — only the invariants
this deployment is scoped to protect were verified unchanged.

**Repository files changed by this session:** exactly two — this file, and the current top entry of
`HANDOFF.md`.

---

## 10. Remaining website work

Unrelated to this deployment and untouched by this session: 3s lineup shaping, OCR coverage pills,
games-list polish work, `packages/db/src/queries/index.ts` drift, and the associated documentation
files — all still present as dirty/untracked working-tree state, exactly as they were before this
session began.

The worker `/health` NULL-ordering defect (§7.6) is a separate, pre-existing bug worth a future
fix (e.g. `WHERE finished_at IS NOT NULL` or `ORDER BY finished_at DESC NULLS LAST`) — out of scope
for this deployment session.
