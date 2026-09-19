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

**2026-09-18 — E3J6B (second of three E3J6 substeps) was implemented and
review-corrected on baseline `70abb63` (E3J6A, committed and pushed); the
637/637 verification below is retained.**

E3J6B adds the readback, the independent verdict, and the two durable records
— no lock, retry, signal ownership, or entrypoint (all E3J6C). Four audit
boundaries, each a thin production API over its own internal test seam, with
session registries private to each factory instance:

- `backup-cloud-attestation-records.mjs` — a `RecordSession` binds
  `attestation.dir` identity + `artifactBase`/`attemptId` and authorizes both
  `O_CREAT|O_EXCL|O_NOFOLLOW` 0600 records (intent before any provider call,
  then the attestation). Closed per-stage code vocabularies and cross-field
  invariants are enforced by membership; lock advice is derived; the writer
  returns the effective record it wrote.
- `backup-cloud-readback.mjs` — `establishReadbackSession({config,
artifactBase, attemptId, sourceEvidence})` SEALS the CLI, credentials,
  timeouts, canonical remote paths, and validated source evidence;
  `readBackAttemptTriple({session, signal})` reads nothing else. Workspace
  objects are tracked as each is authenticated; cleanup is exact and
  non-recursive and re-observes each file's full identity before unlink.
- `backup-cloud-attempt-verdict.mjs` — pure, independent re-derivation.
- `backup-cloud-attempt.mjs` — `runAttestedAttempt()` is total after
  `prepare`: exactly-once consumption, closed codes, one closed internal
  outcome, and a report copied from the durable attestation.

Verification (2026-09-18): `pnpm test:backup-producer` **637/637, 0 fail, 0
skipped** (495 + 142); five repeat runs of the subprocess files all green;
five targeted mutations caught. **Correction:** the earlier "593/593" was an
addition slip — the tree ran 596. An independent review's CLI/upload/
attempt/lifecycle failures reproduce only inside the Codex bubblewrap/seccomp
sandbox (Node child stdout on Node pipes is lost there); committed `70abb63`
fails the same tests there — an environment limitation, not a regression.
Run the suite outside that sandbox.

**Known-unclosed, by design:** real-CLI schemas are hypotheses; the path-based
upload TOCTOU is detected, not closed; the post-hash executable replacement is
open; the canary proves nothing about the Proton CLI or Hotel-Echo. E3J6C owes
the lock, bounded retry (T18), signal ownership, and the entrypoint.

Full correction history and the implemented schemas (memo §9): the architecture
memo (linked under Immediate Blockers). Milestones:
[`docs/journal/2026-09.md`](docs/journal/2026-09.md).

Before that: E3J6A 2026-09-16, **495/495** (`70abb63`); E3J5 2026-09-16,
413/413 (`eea6ace`); E3J4 2026-09-14, 354/354 (`0fc9678`); E3J3 2026-09-13,
235/235 (`a3681b0`); E3J2 2026-09-13, 179/179; E3I closed 2026-09-12.

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
  E3J2-E3J6A are committed (`70abb63`); E3J6B (readback, independent verdict,
  durable intent/attestation) is implemented and verified. E3J6C (lock,
  retry, signal ownership, entrypoint) is next. U12-U15 remain unresolved
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
   **E3J6B**, then **E3J6C**: the run lock spanning upload/readback/attestation,
   R1-only bounded retry (T18), signal ownership, and the executable
   entrypoint, which consumes each attempt's returned `lockAction`.
   See `docs/planning/proton-drive-cloud-transport-architecture.md` §12.
2. Gate 2 reliability items: automated backups, restore drill, alerting,
   log retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural
stopping point, and log the milestone in `docs/journal/2026-09.md` — see
`agent-manager-workflow.md` §8 and the `handoff-update` skill.
