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

**2026-09-19 — E3J6C (last of the three E3J6 substeps) implemented and
verified in the working tree on baseline `bbcff5b` (E3J6B, committed and
pushed). Not yet committed. E3 remains unactivated.**

E3J6C adds the run lock, collision-only bounded retry (T18), private signal
ownership, and the first executable entrypoint:

- `backup-cloud-run-lock.mjs` — one immutable `O_EXCL` 0600 lock (acquisition
  metadata only) in an operator-provisioned trusted directory; a
  factory-private handle is the only release authority. `refused` = filesystem
  unchanged; `uncertain` = possible residue, never a handle, never removed.
  Pre-unlink refusals leave the path untouched; post-unlink failures report
  `release_durability_unconfirmed`/`release_replaced` and touch nothing.
  Retaining writes nothing; no lock is ever reclaimed automatically.
- `backup-cloud-run.mjs` — one locked run: fixed one-turn pre-lock checkpoint
  and cancellation recheck, ONE containment proof reused per run, strict
  validation of containment results and attempt reports, retry ONLY for R1
  (the derived `retryDisposition`: a zero-transfer namespace/object collision
  or an anchored upload `name_conflict`), both `retry.*` ceilings,
  abort-aware backoff, and a deeply frozen closed summary.
- `ops/backup/eanhl-backup-cloud.mjs` (no shebang, executable bit, or package
  script) over a private entrypoint core that alone owns SIGINT/SIGTERM:
  exits 0/1/2/3/4, and 130/143 when cancellation settles; a second signal
  exits 4 and leaves the lock. **Review correction:** the run summary is
  untrusted there — only a strict, fresh, prototype-free projection is ever
  printed; anything else prints one fixed line and exits 4.

Verification (2026-09-19, after the review correction): `pnpm
test:backup-producer` **756/756, 0 fail, 0 skipped** (637 + 119); five repeat
runs of the eight subprocess/concurrency suites all green; 39/39 targeted
mutations caught, each file restored byte-identically. Attestation schema v1 unchanged. Run the suite outside the
Codex bubblewrap sandbox (Node child stdout is lost there — an environment
limitation, not a regression).

**Known-unclosed, by design:** real-CLI schemas are hypotheses; path-based
lock and upload TOCTOU windows are narrowed, not closed; SIGKILL/power loss or
a second signal leaves the lock (and possibly orphaned CLI children or an
intent without an attestation) for manual reconciliation; a retention reason
is durable only inside a written attestation.

Detail (schemas, lock contract, reconciliation §4.7, correction history): the
architecture memo linked under Immediate Blockers. Milestones:
[`docs/journal/2026-09.md`](docs/journal/2026-09.md).

Before that: E3J6B 2026-09-18, **637/637** (`bbcff5b`); E3J6A 2026-09-16,
495/495 (`70abb63`); E3J5 2026-09-16, 413/413 (`eea6ace`); E3J4 2026-09-14,
354/354 (`0fc9678`); E3J3 2026-09-13, 235/235 (`a3681b0`); E3J2 2026-09-13,
179/179; E3I closed 2026-09-12.

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

- **E3 (Proton cloud backup) unactivated.** The local chain through E3J6C
  exists — attestation writer, run lock, bounded retry, and an executable
  entrypoint — but nothing invokes, schedules, or deploys it, and no watcher
  exists. Open: a proven hard-containment mechanism on the real host, real
  monitoring, unattended credential persistence (Hotel-Echo untested), and
  real-CLI schema verification. U12-U15 remain unresolved (readback
  ceilings/containment proof, timeouts/retry values, remote root and the flat
  layout's ratification, independent-watcher design). Detail:
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

1. If continuing backup work: E3J6C is uncommitted — review and, if
   authorized, checkpoint it. The next local stage is **E3J7**: freshness
   export and evaluation (attestation reader,
   `validateCloudAttestationBinding()`, the freshness number, T21). See
   `docs/planning/proton-drive-cloud-transport-architecture.md` §12.
2. Gate 2 reliability items: automated backups, restore drill, alerting,
   log retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural
stopping point, and log the milestone in `docs/journal/2026-09.md` — see
`agent-manager-workflow.md` §8 and the `handoff-update` skill.
