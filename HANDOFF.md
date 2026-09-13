# Handoff

Compact current-state index (target 100-150 lines / max 200 / 12KB — see
`.claude/skills/handoff-update/SKILL.md`). This file summarizes; it does not
reproduce the linked documents.

- Full prior history through 2026-09-12:
  [`docs/archive/handoff-history-2026-09-12.md`](docs/archive/handoff-history-2026-09-12.md)
  (byte-identical snapshot of this file before compaction; its internal
  links resolve from the repo root, not from `docs/archive/` — see
  [`docs/archive/README.md`](docs/archive/README.md)).
- Full Gate 1-3 checklist, unchanged:
  [`docs/planning/operational-v1-roadmap.md`](docs/planning/operational-v1-roadmap.md).
- Dated work diary: [`docs/journal/2026-09.md`](docs/journal/2026-09.md)
  (create the next month's file as needed).
- Workflow policy (Plan Mode, delegation, HANDOFF lifecycle, etc.):
  [`docs/operations/agent-manager-workflow.md`](docs/operations/agent-manager-workflow.md).

## Current Objective / Status

Operational V1 launch readiness, target 2026-10-01. Gate 1 complete. Gate 2
in progress: hosting/domain/NHL 26-27 cutover decided; legal docs drafted
but unpublished; reliability/backup automation not started; product-
readiness audits not started. Gate 3 not started. Checkbox-level detail is
in the roadmap doc, not here.

## Latest Verified Checkpoint

**2026-09-13 — workflow/docs cleanup reviewed for local checkpoint.**
`HANDOFF.md` compacted and size-capped; byte-identical archive preserved;
roadmap extracted; `docs/journal/` introduced. Independent review passed:
12 hook fixtures (including symlink containment), live-link checks, and
roadmap preservation. See `docs/journal/2026-09.md` for verification and
checkpoint scope; no push was requested.

Before that: E3I (Proton scratch experiment) closed 2026-09-12 — protocol
completed to the extent CLI 0.8.0 supports, quota measurement not possible;
E3J1 architecture memo issued a GO for E3J2 (extraction). Full detail in the
archive.

## Essential Operational Constraints

- Domain `boogeymen.app` live (Cloudflare); `webmaster@boogeymen.app` works
  both directions.
- Cloudflare tunnel is **deliberately offline** on both hosts; reopening it
  needs its own separate authorization on top of closing the relevant Gate 2
  items, not just a status change. Auth is **deliberately disabled
  pre-launch** (the account system is removed from source, not just
  hidden) — both are decisions, not gaps.
- Main PC is still real production (web/worker/db); Hotel-Echo runs a
  parallel, not-yet-migrated deployment. Verify the actual deployed commit
  per host via `docker inspect`/`git log` — don't assume from this file.
- NHL 27 ingestion live on both hosts since 2026-09-05; NHL 26 fully
  preserved and untouched.
- **Main-PC secrets rotation (2026-09-03):** `POSTGRES_PASSWORD` and
  `BETTER_AUTH_SECRET` were exposed (a `docker compose config` tool
  transcript, plus an older `POSTGRES_PASSWORD` committed and pushed in
  plaintext since 2026-04-16) and rotated same-day; the old plaintext value
  stays in git history (dead, not erased). Hotel-Echo's own secrets were
  never touched by this.
- **Separate Hotel-Echo incident, same day:** an unauthenticated
  "bootstrap first admin" flow was briefly reachable (~7.5 min) while its
  database was empty; no account was created (tables verified empty), and
  it was fixed at source. This is unrelated to the secrets rotation above.
- **Separate again — Hotel-Echo network verification (2026-09-04, "Stage
  D"):** ports 3000/3001/5433 confirmed loopback-only from host/LAN/WAN/
  router vantages. This verified network port exposure only — it did not
  verify or reconfirm the secrets rotation or the bootstrap-admin incident
  above.
- Backup producer/acceptor exist, verified in isolation only — no
  production activation (see Immediate Blockers).

## Immediate Blockers

- **E3 (Proton cloud backup) unactivated.** No uploader/attestation/watcher
  exist. Open: a proven hard-containment mechanism, real monitoring, and
  unattended credential persistence (Hotel-Echo untested). Next step: E3J2
  extraction. Detail:
  [`docs/planning/proton-drive-cloud-transport-architecture.md`](docs/planning/proton-drive-cloud-transport-architecture.md),
  [`docs/planning/proton-drive-transport-feasibility.md`](docs/planning/proton-drive-transport-feasibility.md),
  [`docs/planning/proton-drive-scratch-experiment.md`](docs/planning/proton-drive-scratch-experiment.md).
- **Legal docs drafted, not published, not counsel-reviewed.** Privacy,
  data-collection, attribution, and Terms of Use each carry open publication
  blockers (placeholder URLs, indexing reverification, a notice-of-changes
  mechanism). Cloudflare Web Analytics is still enabled, contradicting the
  no-tracking decision. Drafts: `docs/planning/*-draft.md`.
- **NHL 26/27 title default & chronology bug** — decided at E1J, not
  implemented: `is_active` conflates ingestion eligibility with frontend
  default; `/` and `/games` lack the archive-fallback resolution
  `title-resolver.ts` already has; chronology sorts by id, which is already
  wrong (NHL 27's id > NHL 26's, breaking career-season ordering). As a
  mechanical side effect, NHL 27 is now the default title on `/`/`/games` on
  both hosts. Rollback (stops NHL 27 polling, reverts default, deletes
  nothing): `UPDATE game_titles SET is_active = false WHERE slug = 'nhl27';`.
  Full spec: archive, E1J entry.

## Next 1-3 Actions

1. If continuing backup work: **E3J2** — extract the shared artifact
   contract into `ops/backup/lib/backup-artifact-contract.mjs`
   (behaviour-preserving only).
2. Gate 2 reliability items: automated backups, restore drill, alerting,
   log retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural
stopping point, and log the milestone in `docs/journal/2026-09.md` — see
`agent-manager-workflow.md` §8 and the `handoff-update` skill.
