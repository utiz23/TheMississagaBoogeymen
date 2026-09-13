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

**2026-09-13 — E3J3 (naming, remote paths, cloud config surface) done,
corrected same-day by E3J3B after independent review, uncommitted.** New
`ops/backup/lib/backup-cloud-naming.mjs`: safe remote-component validation,
canonical-remote-root validation, `assertValidArtifactBase()` (the exact
`<prefix>-<YYYYMMDDTHHMMSSZ>` identity shape, not just ordinary-component
safety), a self-validating `attemptId` construction/validation, the
immutable attempt namespace, the three published object paths, and the
attempt-scoped attestation filename — all pure, no
subprocess/network/filesystem. New `ops/backup/lib/backup-cloud-config.mjs`:
fail-closed cloud-transport config validator/loader (reusing
`backup-config.mjs`'s primitives), `verifyCliHashPin()` (a pure local
SHA-512 comparison guard), and now **canonical-path enforcement**: every
local path field must already be lexically canonical (no dot segments, no
repeated/trailing separators) before it is used or containment-compared —
lexical only, no claim about symlink/mount/filesystem-level aliasing. New,
explicitly non-production `ops/backup/eanhl-backup-cloud.example.json`.
`backup-artifact-contract.mjs` gained `publishedTripleNames()`
(plaintext-excluding accessor) and `ARTIFACT_PREFIX_PATTERN` (centralized
from the producer/acceptor configs' identical duplicate literal,
behaviour-preserving at both sites). Corrected the E3J1 memo's T22 test
intention: E3J3 proves the hash pin is required, well-formed, and compared
fail-closed; the assertion that verification runs before provider-command
construction is E3J4's, once that constructor exists.

**E3J3B (independent-review correction pass, same day) fixed four boundary
defects** before any of this was considered complete: (1) non-canonical
local paths (`../`, `//`) could alias into a directory the separation check
was supposed to keep separate — now rejected outright, never normalized;
(2) `buildPublishedObjectPaths()`/`buildAttestationFileName()` accepted an
arbitrary safe-looking `artifactBase`, and `formatAttemptId()` could return
a malformed id if its injected `randomToken` boundary misbehaved — both now
validate the constructed identity's exact shape; (3) the secret-shaped-key
rejection message echoed the untrusted key name — now fully generic; (4) a
non-null `capacity.backingVolume` result was nested inside a frozen object
without itself being frozen — now frozen. `pnpm test:backup-producer`:
**235/235, 0 fail** (179 E3J2 baseline + 56 new: 5 artifact-contract + 19
naming + 32 config), no existing assertion weakened. Nothing staged or
committed this session.

Before that: E3J2 (shared artifact-contract extraction) done 2026-09-13,
179/179; workflow/docs cleanup reviewed 2026-09-13 (HANDOFF compaction,
archive, roadmap extraction); E3I (Proton scratch experiment) closed
2026-09-12. Full detail in the archive and
`docs/journal/2026-09.md`.

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
  unattended credential persistence (Hotel-Echo untested). E3J2 (artifact-
  contract extraction) and E3J3 (naming/remote-paths/cloud config surface)
  are done; next step is E3J4 (subprocess boundary and fake CLI). U12-U15
  (readback ceilings/containment proof, timeouts/retry, remote-root/account
  namespace, independent-watcher design) remain unresolved. Detail:
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

1. If continuing backup work: **E3J4** — the subprocess boundary and a fake
   CLI (argv construction, the allowlisting projector, the error-code enum,
   the sanitiser, T3-T9), per
   `docs/planning/proton-drive-cloud-transport-architecture.md` §12.
2. Gate 2 reliability items: automated backups, restore drill, alerting,
   log retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural
stopping point, and log the milestone in `docs/journal/2026-09.md` — see
`agent-manager-workflow.md` §8 and the `handoff-update` skill.
