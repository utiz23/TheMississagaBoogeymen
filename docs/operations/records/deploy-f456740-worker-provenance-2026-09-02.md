# Deploy: decoder-run provenance eligibility fix — commit f456740 (2026-09-02)

## Summary

Deployed the worker-only, synthetic-scoped `refreshDecoderRunProvenance` fix
(commit `f456740dee63acaf03daaa02a15c610865d8811b`, correcting `765aecf` per
`03b7f12`) to the running worker container. Built from an isolated source
snapshot, not the primary working tree. `web` and `db` were not rebuilt,
restarted, or recreated. This entry closes out the "CORRECTED, NOT DEPLOYED"
Active State item — the fix is now live and independently confirmed correct
against production data.

## Commit and snapshot

- Deployed commit: `f456740dee63acaf03daaa02a15c610865d8811b`
- Isolated source snapshot: `/tmp/eanhl-f456740-snapshot-preflight`

## Build

```bash
docker compose -p eanhl-team-website -f /tmp/eanhl-f456740-snapshot-preflight/docker-compose.yml \
  --env-file /home/michal/projects/eanhl-team-website/.env build worker
```

## Rollback tag (created before recreate)

```bash
docker tag eanhl-team-website-worker:latest eanhl-team-website-worker:pre-provenance-fix-f456740
```

- Rollback tag: `eanhl-team-website-worker:pre-provenance-fix-f456740`
- Rollback image: `sha256:062f9343ab4d6d41caad6b7c6f618a39660412fc35f7abc7c31e8b49b1a1c184`
- This rollback image is the same worker image deployed on 2026-08-16 for the
  `/health` fix (commit `a97ce87`; see
  [`deploy-a97ce87-worker-health-2026-08-16.md`](deploy-a97ce87-worker-health-2026-08-16.md)),
  confirming continuity: the worker ran that image, unchanged, up until this
  deployment.

## Deployment command (executed)

```bash
docker compose -p eanhl-team-website -f /tmp/eanhl-f456740-snapshot-preflight/docker-compose.yml \
  --env-file /home/michal/projects/eanhl-team-website/.env \
  up -d --no-deps --force-recreate worker
```

## Before / after identities

|                       | Before                                                                    | After                                                                          |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| worker image          | `sha256:062f9343ab4d6d41caad6b7c6f618a39660412fc35f7abc7c31e8b49b1a1c184` | `sha256:267d27a5d5739b54705e1eb4a83e714dd26a3a5976a7b5469e41132a96f7950c`      |
| worker container      | (previous, recreated)                                                     | `9e67594744f326010ae19900ab5cf45fa773cccaf6a89dc644b6eb7bf6523256`             |
| worker `StartedAt`    | —                                                                         | `2026-09-03T04:17:35.563709239Z`                                               |
| worker `RestartCount` | —                                                                         | `0` (no crash loop)                                                            |
| web container         | `dc582e0c782127b14c1ec68b307cd1cb5e9dedcb35e4af830ccfbe5292f940b3`        | `dc582e0c782127b14c1ec68b307cd1cb5e9dedcb35e4af830ccfbe5292f940b3` (unchanged) |
| db container          | `9dacad8ce351629fd07cf640559e5d61fb1bc4d998a74feea28dbd12fd39b417`        | `9dacad8ce351629fd07cf640559e5d61fb1bc4d998a74feea28dbd12fd39b417` (unchanged) |

`web` and `db` container and image identities were confirmed unchanged before
and after — neither was targeted by `--no-deps --force-recreate worker`.

## Acceptance evidence

- **Ingestion resumed normally:** latest independently observed successful
  ingest at `2026-09-03T04:34:21.383Z`, after the new `StartedAt`, confirming
  the worker resumed its normal polling loop post-recreate with no errors.
- **Synthetic-run invariant (live data):** `synthetic_runs=100, mismatches=0,
single=60, mixed=40, legacy_mixed=40` — the derive-from-children provenance
  refresh continues to behave correctly across all synthetic/backfill runs.
- **Non-synthetic rows untouched:** all nine intentionally non-synthetic
  `ocr_decoder_runs` rows that the pre-fix (`765aecf`) unconditional rule
  would have overwritten (see the "CORRECTED, NOT DEPLOYED" Active State
  entry for the full defect description, e.g. run 1993) remained unchanged —
  confirming the synthetic-only eligibility boundary from `03b7f12` holds in
  production, not just in the regression suite.
- No `ocr_decoder_runs` row was repaired, normalized, or otherwise written by
  this deployment session; all verification was read-only.

## Rollback command (prepared, not executed — deployment succeeded)

```bash
docker tag eanhl-team-website-worker:pre-provenance-fix-f456740 eanhl-team-website-worker:latest
docker compose -p eanhl-team-website -f /tmp/eanhl-f456740-snapshot-preflight/docker-compose.yml \
  --env-file /home/michal/projects/eanhl-team-website/.env \
  up -d --no-deps --force-recreate worker
```

**Not invoked.** No rollback was required.

## Result

**PASS.** Worker-only deployment of `f456740` succeeded on the first attempt;
`web` and `db` were untouched throughout.
