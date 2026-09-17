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

**2026-09-16 — E3J6A (first of three E3J6 substeps) is implemented in the
working tree, unstaged and uncommitted, awaiting review. Baseline: `eea6ace`
(E3J5, committed and pushed).**

E3J6A adds boundary extensions only — no readback workflow, attestation, lock,
retry, or entrypoint:

- `backup-cloud-cli.mjs`: the uncontained `runDownload` is removed (11
  exports). `runContainedDownload` hash-gates the CLI, then the pinned
  `readback.rlimitWrapper`, and runs `prlimit --fsize=C:C --` with C the exact
  inclusive role ceiling. A killed child counts as ended only when `close`
  is observed (a known exit status is not enough); otherwise the result is
  `provider_termination_unconfirmed`.
- `backup-cloud-containment.mjs`: a fixed-purpose canary. It checks the
  readback directory's trust itself, uses an empty environment, and requires
  a probe of exactly L, confirmed termination, and identity-checked cleanup.
  Proofs are unforgeable and bound to the config and the directory's identity.
  `quota_mount` is refused at runtime, as are configs that can't be canaried
  (an unrepresentable overshoot, or a path argv refuses): a closed refusal
  with nothing created.
- `backup-cloud-upload.mjs`: one-shot `prepareUploadAttempt` /
  `executeUploadAttempt`. No-follow descriptor SHA-256 and byte evidence is
  captured for all three roles before any boundary call. Identity outcomes are
  closed, and the outcome is v2.

Verification: `pnpm test:backup-producer` **495/495, 0 fail, 0 skipped**
(413 + 82). The real-`prlimit` tests ran against disposable local Node probes
only. All 8 mutation checks were caught, and the 6 regressions from the
in-place review corrections failed before those fixes.

**Known-unclosed, by design:** real-CLI schemas are hypotheses; the path-based
upload TOCTOU is detected, not closed (an in-place same-size rewrite is left to
readback); the post-hash executable replacement is open; the canary proves
nothing about the Proton CLI or Hotel-Echo. E3J6B owes readback, the verdict,
intents for every attempt identity, and attestations (T13-T17 plus the written
halves of T8/T11/T12). E3J6C owes the lock, retry (T18), and the entrypoint.

Full correction history: the architecture memo (linked under Immediate
Blockers). Milestones: [`docs/journal/2026-09.md`](docs/journal/2026-09.md).

Before that: E3J5 (single-attempt upload) 2026-09-16, **413/413** (`eea6ace`);
E3J4 2026-09-14, 354/354 (`0fc9678`); E3J3 2026-09-13, 235/235 (`a3681b0`);
E3J2 2026-09-13, 179/179; E3I (Proton scratch) closed 2026-09-12.

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

- **E3 (Proton cloud backup) unactivated.** No attestation writer, entrypoint,
  or watcher exists. Open: a proven hard-containment mechanism, real
  monitoring, and unattended credential persistence (Hotel-Echo untested).
  E3J2-E3J5 are committed; E3J6A (contained download, canary, one-shot
  prepare with source evidence) is in the working tree awaiting review. Next
  are E3J6B (readback, verdict, intent/attestation) and E3J6C (lock, retry,
  entrypoint). U12-U15 remain unresolved
  (readback ceilings/containment proof, timeouts/retry, remote root and the
  flat layout's ratification, independent-watcher design). Detail:
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

1. If continuing backup work: review and (if authorized) checkpoint
   **E3J6A**, then **E3J6B**: readback, independent verdict, and
   intent/attestation, consuming `verifyContainmentProof` and the v2
   `sourceEvidence`. Then **E3J6C**: lock, R1-only retry, and entrypoint.
   See `docs/planning/proton-drive-cloud-transport-architecture.md` §12.
2. Gate 2 reliability items: automated backups, restore drill, alerting,
   log retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural
stopping point, and log the milestone in `docs/journal/2026-09.md` — see
`agent-manager-workflow.md` §8 and the `handoff-update` skill.
