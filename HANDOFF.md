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

**2026-09-14 — E3J4: the Proton Drive CLI subprocess boundary is implemented
in the working tree, hardened by three same-day independent security review
passes (E3J4A/B/C). Baseline commit: `a3681b0` (E3J3).**

`ops/backup/lib/backup-cloud-cli.mjs` is a thin production API over
`internal/backup-cloud-cli-core.mjs`, with `testdoubles/fake-proton-drive.mjs`
and `backup-cloud-cli.test.mjs`. What it guarantees today:

- a closed ten-name export surface; four fixed operations only — no arbitrary
  operation name, argv builder, or command string anywhere;
- **no dependency injection on any production route** — the four operations
  accept no hash, spawn, environment, stat, or capture-bound override, and a
  `deps` property handed to one is inert. The injectable factory is an
  internal test seam, not an access-control boundary; a static regression
  blocks any other `ops/**` importer;
- ordering: local inputs and cancellation, then the real SHA-512 hash gate,
  then operands/argv/spawn;
- every operand a validated canonical path or component (no `-`-leading value
  reaches the CLI's parser), rejected with generic non-echoing errors;
  `shell:false` no-TTY capture over a POSITIVE environment allowlist; stream
  failures terminate through the same bounded path as timeout/overflow;
- anchored classification bound to the queried path's / uploaded file's own
  identity — never a substring match, never an unrelated identity;
- upload cross-checks the provider byte count against caller-supplied
  `expectedLocalSizeBytes` and never promotes a skipped item to success;
  download binds its evidence to the immediate child of `localDir` named by
  the queried remote basename, proves it absent before spawning, and accepts
  only a regular file afterwards (`lstat`, never `stat`);
- every provider-derived byte count validated as a SAFE integer; results are
  frozen, from a closed error-code enum, carrying no provider-authored text.

Verification: `pnpm test:backup-producer` **354/354, 0 fail** (235 E3J3B
baseline + 119 cloud-CLI); no existing assertion weakened or deleted.

**Known-unclosed, by design:** the raw provider-response schemas are design
contracts, not verified real-CLI behaviour (needs a separately authorized
provider session); the post-hash executable-replacement TOCTOU gap; local-file
TOCTOU around upload's caller-supplied size (E3J5 owes its safe derivation for
all three artifacts); and the gap between download's absence check and its
readback, plus hard containment, descriptor ownership, and content
verification (E3J6). Full correction history and itemized defect lists: the
architecture memo, linked under Immediate Blockers; dated milestones:
[`docs/journal/2026-09.md`](docs/journal/2026-09.md).

Before that: E3J3 (naming/paths/cloud config, corrected by E3J3B) 2026-09-13,
**235/235**, committed as `a3681b0`; E3J2 (artifact contract) 2026-09-13,
179/179; E3I (Proton scratch) closed 2026-09-12.

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
  contract extraction), E3J3 (naming/remote-paths/cloud config surface), and
  E3J4 (subprocess boundary and fake CLI) are done; next step is E3J5
  (uploader orchestration: preflight, create-folder, ordered uploads,
  partial-failure handling, cancellation, T10-T12/T19-T20). U12-U15
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

1. If continuing backup work: **E3J5** — uploader orchestration (preflight
   collision checks, create-folder, the ordered ciphertext→sidecar→manifest
   upload, partial-failure handling, cancellation, T10-T12/T19-T20), per
   `docs/planning/proton-drive-cloud-transport-architecture.md` §12.
2. Gate 2 reliability items: automated backups, restore drill, alerting,
   log retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural
stopping point, and log the milestone in `docs/journal/2026-09.md` — see
`agent-manager-workflow.md` §8 and the `handoff-update` skill.
