# Deploy: worker `/health` NULL `finished_at` fix — commit a97ce87 (2026-08-16)

## Summary

Deployed the worker-only fix for the `/health` endpoint 503 defect (commit
`a97ce87c655e9ce7145653837f18df5c7b1eba9c`, parent `540777a`) to the running
worker container. Built from an isolated `git archive` snapshot of the exact
commit — not the dirty primary working tree. `web` and `db` were not
rebuilt, restarted, or recreated at any point.

## Commit and snapshot

- Commit: `a97ce87c655e9ce7145653837f18df5c7b1eba9c` (HEAD at start and end of session, on `main`)
- Commit contains exactly two files: `apps/worker/src/health.ts`, `apps/worker/src/__tests__/health-endpoint.test.ts`
- Isolated snapshot: `/tmp/eanhl-a97ce87-snapshot-8336`, populated via `git archive a97ce87c655e9ce7145653837f18df5c7b1eba9c`
- Verified: snapshot's `health.ts` and `health-endpoint.test.ts` are byte-identical to their committed blobs (`git show <sha>:<path> | diff`)
- Verified: snapshot contains no `.env` (only the tracked `.env.example`)
- Verified: snapshot excludes all dirty/untracked working-tree files (`ocr-pill.tsx`, `lineup-shape.ts`, `ocr-coverage.ts`, modified `apps/web/*`, etc.) — none present anywhere under the snapshot
- The primary repository's `.env` was used only as an explicit `--env-file` argument to `docker compose`; its contents were never printed or copied

## Preflight discrepancy — container restart (resolved before deployment)

Independent inspection during the deployment gate found all three running
containers (`worker`, `web`, `db`) sharing `FinishedAt≈2026-08-16T16:24:46Z`
/ `StartedAt≈2026-08-16T16:24:48Z`, `RestartCount=0`, unchanged container
IDs. This is consistent with a single simultaneous daemon/host-level restart
(host `uptime` showed ~13 minutes at the time of the check, consistent with
a WSL2 host reboot), not per-container restart-policy activity.

This session's own Phase 1 baseline had already recorded `db StartedAt =
2026-08-16T16:24:48.863557839Z` — identical to the value re-read later —
proving the restart predates or is exactly contemporaneous with this
session's earliest evidence. Nothing changed between the Phase 1 baseline
and the deployment gate. The exact cause of the restart and its timing
relative to session start could not be independently proven (no surviving
`docker events` history across the restart) and is not claimed as fact —
only that it occurred no later than this session's baseline and involved no
change this session caused.

## Images and containers

| | Before | After |
|---|---|---|
| worker container ID | `9aa856ee4b53` | `cd2878079a38` |
| worker image ID | `1e0e30e63890` | `062f9343ab4d` |
| web container ID | `fe2e820b92d4` | `fe2e820b92d4` (unchanged) |
| web image ID | `089f0b6938c1` | `089f0b6938c1` (unchanged) |
| db container ID | `9dacad8ce351` | `9dacad8ce351` (unchanged) |
| db image ID | `20edbde7749f` | `20edbde7749f` (unchanged) |
| db `StartedAt` | `2026-08-16T16:24:48.863557839Z` | `2026-08-16T16:24:48.863557839Z` (unchanged) |

Rollback tag created before build: `eanhl-team-website-worker:pre-health-fix-a97ce87` → `sha256:1e0e30e638904f35073d68dc5ce030601f6caafc89a464ab104dff10204835f1`, verified to resolve to the pre-fix image.

## Build

```
docker compose -p eanhl-team-website -f /tmp/eanhl-a97ce87-snapshot-8336/docker-compose.yml \
  --env-file /home/michal/projects/eanhl-team-website/.env build worker
```

Exit code 0. New image `062f9343ab4d`, confirmed to contain the fix
(`isNotNull(ingestionLog.finishedAt)` present in `dist/health.js`) and
confirmed to contain no dirty/untracked website files, before the running
worker was touched.

## Authorization

Operator supplied the exact required phrase in-session: `DEPLOY WORKER HEALTH A97CE87`. Deployment did not proceed on the earlier task prompt alone, per protocol.

## Deployment command (executed)

```
docker compose -p eanhl-team-website -f /tmp/eanhl-a97ce87-snapshot-8336/docker-compose.yml \
  --env-file /home/michal/projects/eanhl-team-website/.env \
  up -d --no-deps --force-recreate worker
```

Result: `Container eanhl-team-website-worker-1 Recreated / Started`. Exit code 0. `web` and `db` were not targeted and were not recreated, restarted, or rebuilt.

## Rollback command (prepared, not executed — deployment succeeded)

```
docker tag eanhl-team-website-worker:pre-health-fix-a97ce87 eanhl-team-website-worker:latest
docker compose -p eanhl-team-website -f /tmp/eanhl-a97ce87-snapshot-8336/docker-compose.yml \
  --env-file /home/michal/projects/eanhl-team-website/.env \
  up -d --no-deps --force-recreate worker
```

## `/health` before / after

**Before:**
```json
{"status":"degraded","lastSuccessfulIngest":null,"secondsSinceLastIngest":null,"message":"No successful ingestion recorded yet"}
```
HTTP 503

**After:**
```json
{"status":"ok","lastSuccessfulIngest":"2026-08-16T16:44:03.659Z","secondsSinceLastIngest":0}
```
HTTP 200

## Latest completed ingestion comparison

Read-only query (`PGOPTIONS='-c default_transaction_read_only=on'`) against `ingestion_log`:

```sql
SELECT finished_at FROM ingestion_log
WHERE status='success' AND finished_at IS NOT NULL
ORDER BY finished_at DESC LIMIT 1;
```

Returned `2026-08-16 16:44:03.659+00` — matches the deployed `/health` response's `lastSuccessfulIngest` exactly.

## Historical NULL-`finished_at` rows

Same three rows present before and after deployment, untouched (read-only, no UPDATE or DELETE issued against `ingestion_log` at any point):

| id | status | finished_at |
|---|---|---|
| 17468 | success | NULL |
| 69577 | success | NULL |
| 81472 | success | NULL |

## Logs and stability

- `docker logs eanhl-team-website-worker-1` post-recreate: clean startup (`[worker] Starting polling loop`, `[health] Listening on http://0.0.0.0:3001/health`), one normal ingestion cycle completed with no errors.
- Grep for `error|exception|invariant` in worker logs: no matches.
- `RestartCount=0` after deployment. No restart loop.

## Routine worker-write disclosure

The worker resumed its normal scheduled polling loop immediately after
recreation and completed a normal ingestion cycle (`nhl26` gameType5/10/club_private
found=5 new=0, aggregates recomputed, members upserted, seasonal/season-rank
updated). **This is expected, ordinary worker operation, not something invoked
by this deployment session** — it is the same behavior the worker performs
every 5 minutes under normal `POLL_INTERVAL_MS` operation, and it is the
source of the new `finished_at` row (`2026-08-16 16:44:03.659+00`) that
`/health` now reports. All explicit verification queries in this deployment
(preflight, smoke) were issued read-only via `PGOPTIONS='-c
default_transaction_read_only=on'`.

## System invariants after deployment

- Web route `GET /` → HTTP 200 (web untouched, confirmed still serving)
- `match_period_summaries`: 17 columns (unchanged, matches migration 0056 post-state)
- `drizzle.__drizzle_migrations` ledger tail unchanged (latest id=49, same hash)
- No migration or ledger write performed

## Rollback status

**Not invoked.** Deployment succeeded on the first attempt; all Phase 7 smoke checks passed.

## Result

**PASS.**
