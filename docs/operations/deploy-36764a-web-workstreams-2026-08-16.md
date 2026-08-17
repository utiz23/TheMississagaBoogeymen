# Deploy: web Workstreams A/B/C — commit 36764a (2026-08-16)

## Summary and verdict

**Result: PASS.** Web-only deployment succeeded.

Deployed Workstreams A (3s lineup shaping), B (family-aware OCR coverage
pills), and C (box-score/lineup visual polish) to the running web container,
built from an isolated `git archive` snapshot of commit `36764a6` (the
five-commit checkpoint, HEAD on `main`) — not the mutable primary working
tree. `worker` and `db` were not rebuilt, restarted, or recreated at any
point.

- Authorization phrase received: `DEPLOY WEB WORKSTREAMS 36764A`
- Deployment commit: `36764a621ae0e583d03c692899c6627696ffe59a`
- Deployment snapshot: `/tmp/eanhl-deploy-36764a-snapshot-1786932470-140146`
- Build and deployment used the isolated git archive snapshot of `36764a6`,
  not mutable working-tree contents.

## Delivered runtime work

**Workstream B — family-aware OCR coverage pills** (`4a38395`):

- Periods stream uses the migration-0056 family review columns
  (`goals_review_status`, `shots_review_status`, `faceoffs_review_status`)
  instead of legacy whole-row `review_status`.
- Full / Partial / Minimal / no-pill behavior reflects per-family coverage
  rather than a single row-level flag.

**Workstream A — mode-aware 3s lineup shaping** (`3227b34`):

- 3s lineups shaped by game mode.
- C/W/D/G ladder applied to the shaped roster.
- Identity-tier duplicate collapse: repeated raw OCR rows for the same
  player/position family collapse to one row rather than surfacing every
  raw duplicate.

**Workstream C — box score and lineup border polish** (`4f980ad`):

- 12px / higher-contrast box-score headers.
- Bottom-only lineup border color specificity.

Workstream D (`234947b`, docs reorganization) and the documentation
correction (`36764a6` itself) were included in the synchronized git
checkpoint but had no runtime effect on the deployed application.

## Image/container transition

| | Before | After |
|---|---|---|
| web container ID | `fe2e820b92d4` | `dc582e0c7821` |
| web image ID | `089f0b6938c1` | `00a401fd31e3` |
| web RestartCount | — | `0` |
| worker container ID | `cd2878079a38` | `cd2878079a38` (unchanged) |
| worker image ID | `062f9343ab4d` | `062f9343ab4d` (unchanged) |
| db container ID | `9dacad8ce351` | `9dacad8ce351` (unchanged) |
| db image ID | `20edbde7749f` | `20edbde7749f` (unchanged) |

Rollback tag created before build: `eanhl-team-website-web:pre-workstreams-36764a`,
verified by read-only inspection (this documentation session, and per the
deployment session's own record) to resolve to the old image
`089f0b6938c15f099da194d17d559be4b6d7cd5bb1018218055788e43ec935a2`
(`089f0b6938c1`).

**Rollback was not invoked.** Deployment succeeded; all smoke checks passed.

## Worker/database non-impact

Read-only inspection (this documentation session) confirms, unchanged from
the deployment session's own record:

- worker container `cd2878079a386296a1a2e3280aaf565ca2325654748cee3e3b5cba9e458ab50e`,
  image `062f9343ab4d6d41caad6b7c6f618a39660412fc35f7abc7c31e8b49b1a1c184`,
  `StartedAt 2026-08-16T16:43:56.907345291Z`, `RestartCount 0`.
- db container `9dacad8ce351629fd07cf640559e5d61fb1bc4d998a74feea28dbd12fd39b417`,
  image `20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416`,
  `StartedAt 2026-08-16T16:24:48.863557839Z`, `RestartCount 0`, health `healthy`.

Neither the worker nor the database container was recreated or restarted by
this deployment. This is scoped to container/runtime deployment state —
it is not a claim that all database *data* was globally unchanged (see
Mutation disclosure below).

## Schema prerequisite

Deployment preflight used read-only verification and confirmed the
migration-0056 family review columns were present on `match_period_summaries`
before this deployment: `goals_review_status`, `shots_review_status`,
`faceoffs_review_status`. This deployment did **not** apply migration 0056 —
it was already applied in a separate, earlier, separately-authorized session
(see [`migration-0056-application-2026-08-15.md`](migration-0056-application-2026-08-15.md)).
This deployment only shipped the web code (Workstream B) that reads those
already-present columns.

## Live fixture verification

Per the deployment session's own record, verified against live data:

- match 250 → Full OCR
- match 563 → Partial OCR
- match 249 → Minimal OCR
- match 231 → no OCR pill

3s match-563 lineup verification:

- C: `silkyjoker85`
- W: `camrazz`
- D: `JoeyFlopfish`
- G: no human row / AI
- `JoeyFlopfish`'s ten raw duplicate OCR rows carrying LD/RW labels collapsed
  to one D row.
- No LD/RD slot labels appeared in the shaped output.

## Route verification

Re-verified by this documentation session (read-only HTTP checks against the
running deployment):

| route | status |
|---|---|
| `/` | 200 |
| `/games` | 200 |
| `/games/250` | 200 |
| `/games/253` | 200 |
| `/games/563` | 200 |
| `/games/249` | 200 |

## Visual/build verification

Per the deployment session's own record:

- `text-[12px]` and `text-fg-4` box-score header classes verified present in
  the built output.
- `border-b-border-subtle` lineup-row class verified present in the built
  output.
- No rendering or runtime failure resulted from either change.

## Logs and stability

Per the deployment session's own record, confirmed consistent with this
documentation session's read-only re-inspection (`RestartCount 0`, container
`Up` and stable):

- Clean startup.
- Ready in approximately 2 seconds.
- No errors, exceptions, PostgreSQL `42703`, or restart-loop signs in web
  container logs.
- `RestartCount` remained `0`.

## Mutation disclosure

- No manually invoked production database write occurred during deployment
  verification.
- Explicit production database access was read-only.
- No migration, rescue, OCR promotion, ingestion, reprocessing, repair, or
  rollback was manually invoked.
- Independently scheduled worker activity was not disabled or exhaustively
  audited and is not being claimed absent — the worker continues its normal
  polling loop independent of this deployment.
- Docker state did change intentionally: the web container was recreated and
  now runs the new image (`00a401fd31e3` in container `dc582e0c7821`).
- Worker and database containers were unchanged.

## Repository state

Immediately after deployment (verified by the deployment session and
re-confirmed read-only by this documentation session):

- `HEAD` and `origin/main` both equaled `36764a621ae0e583d03c692899c6627696ffe59a`.
- Ahead/behind was `0/0`.
- Working tree and staging were clean.
- No repository file was changed by the deployment session itself.

This report and the accompanying `HANDOFF.md` update were produced in a
separate, later, documentation-only session and are not part of the
deployment session's own changes.
