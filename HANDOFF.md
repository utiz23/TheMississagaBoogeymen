# Handoff

Compact current-state index (target 100-150 lines / max 200 / 12KB — see
`.claude/skills/handoff-update/SKILL.md`). This file summarizes; it does not
reproduce the linked documents.

- Full prior history through 2026-09-12:
  [`docs/archive/handoff-history-2026-09-12.md`](docs/archive/handoff-history-2026-09-12.md)
  (byte-identical snapshot; its links resolve from the repo root — see
  [`docs/archive/README.md`](docs/archive/README.md)).
- Gate 1-3 checklist:
  [`docs/planning/operational-v1-roadmap.md`](docs/planning/operational-v1-roadmap.md).
- Dated work diary (per-milestone detail and test counts):
  [`docs/journal/2026-09.md`](docs/journal/2026-09.md).
- Workflow policy:
  [`docs/operations/agent-manager-workflow.md`](docs/operations/agent-manager-workflow.md).

## Current Objective / Status

Operational V1 launch readiness, target 2026-10-01. Gate 1 complete. Gate 2
in progress: hosting/domain/NHL 26-27 cutover decided; legal docs drafted but
unpublished; reliability/backup automation not started; product-readiness
audits not started. Gate 3 not started. Checkbox detail: the roadmap doc.

## Latest Verified Checkpoint

**2026-09-30 — E3J9D STOPPED before P0; credential revoked, removed and
rotated. E3J9D did not pass.** From `main` `8c76a2c`: the E3J9D-R launcher
(`0244f8ee…`), probe (`46b112c2…`) and `unit-publish` (`5acf4677…`) are
installed, and every same-session pre-ceremony proof passed (A1–A4, A7, A8,
A10, E1(a), `env-proof`, L2, one busy overlap, host formats, auth
preconditions). The operator's ceremony completed (it contacted Proton), but
the operator then accidentally pasted its URL and output to Codex, so the
session stopped: **P0 never attempted (`p0_attempt_count=0`)**, no
provider-probe unit ran, no provider contact after the ceremony. The operator
revoked that specific CLI session (no unexpected sessions, no password change).
Local cleanup and rotation, without running the CLI or contacting Proton:
`entry-remove`, CLI data/cache/log deleted, store recreated, old key deleted,
GNUPGHOME residue cleared, new key + `gpg.conf` + `pass-init`, staging removed;
`probe local` and owned-inventory pass. No credential material in the repo. Host now: foundation + fresh key + store with only
`.gpg-id`, no Proton session, nothing scheduled. Record:
[memo §21](docs/planning/proton-drive-hotel-echo-credential-design.md).

**2026-09-26 — E3J9C PASSED (credential foundation + local proof only).**
E3J9C-R is committed and pushed (`835b3ece`). On Hotel-Echo: `pass` + `tree`,
the locked `eanhl-cloud` identity, §2 directories and lock, 12 curated links,
wrapper, launcher, validation tools (kept until E3J9E), the pinned CLI at
`/opt/eanhl-cloud/bin/proton-drive` (**never executed**), the service key with
`gpg.conf`, and a store holding only `.gpg-id`. Two template defects found on
the host were corrected, reviewed and reinstalled (launcher/`lockhold`
working directory; the probe's digit-containing record name). M10 then passed
in full, one row at a time: A1–A10 (A6 by the operator's direct PTY
observation), E1–E3, L1–L2, K1–K6 and owned-inventory. `gpg-agent` lives only
inside a running unit. Staging removed. The E3J9C work since `835b3ece`
(corrected templates, harness, docs; branch `feat/e3j9c-credential-foundation`)
is in `main`: the `main` commit `ab05da38` contains it (via `671efb9`). Network: public
upstream/Ubuntu downloads only; no Proton/provider contact. Record:
[memo §19](docs/planning/proton-drive-hotel-echo-credential-design.md).

Earlier (detail in the journal): E3J9D-R 09-28/30 (provider runner,
`ef32c885`, merged into `main` by `1ec6c330`, memo §20); E3J9C-R 09-25 (exact `pass` acceptance rule,
template corrections, memo §18); E3J9C first run 09-24 (stopped after M1:
`pass` + `tree`, memo §17); E3J9B-doc 09-24 (`c99598e`, option-A design);
E3J9A 09-24 (read-only feasibility); E3J8A 09-23 (`9ea391a`, Healthchecks
export, non-activated, ping-key risk explicitly accepted); E3J7 09-21
(freshness evaluator); E3J6C 09-19 (`97e62d4`, run lock/retry/entrypoint);
E3J6B `bbcff5b`, E3J6A `70abb63`, E3J5 `eea6ace`, E3J4 `0fc9678`, E3J2-3, E3I.

**Known-unclosed, by design (backup chain):** real-CLI schemas are
hypotheses; lock/upload/enumeration/manifest-read TOCTOU windows are narrowed,
not closed; SIGKILL/power loss can leave the lock or an unattested intent for
manual reconciliation; freshness depends on local manifests (E3J13); a forged
healthy ping is undetectable and the live `OK` contract is unobserved. Run
backup suites outside the Codex bubblewrap sandbox (Node child stdout is lost
there). Detail: the architecture memo and ops docs under Immediate Blockers.

## Essential Operational Constraints

- Domain `boogeymen.app` live (Cloudflare); `webmaster@boogeymen.app` works
  both directions.
- Cloudflare tunnel **deliberately offline** on both hosts; reopening needs
  its own authorization on top of the relevant Gate 2 items. Auth is
  **deliberately disabled pre-launch** (removed from source). Both are
  decisions, not gaps.
- Main PC is still real production (web/worker/db); Hotel-Echo runs a
  parallel, not-yet-migrated deployment. Verify each host's deployed commit
  via `docker inspect`/`git log`.
- NHL 27 ingestion live on both hosts since 2026-09-05; NHL 26 preserved.
- Main-PC secrets rotation 2026-09-03 (`POSTGRES_PASSWORD`,
  `BETTER_AUTH_SECRET`); the dead old value stays in git history. Separate
  same-day Hotel-Echo incident: a bootstrap-admin flow was reachable ~7.5 min,
  no account created, fixed at source. Separate 2026-09-04 check: Hotel-Echo
  ports 3000/3001/5433 loopback-only (network exposure only).
- Backup producer/acceptor verified in isolation only — no activation.

## Immediate Blockers

- **E3 (Proton cloud backup) unactivated; NOTHING IS MONITORED.** The local
  chain through E3J8A exists, but nothing schedules the emitter, no provider
  account/check/ping key/notification exists, and no test notification was
  received. E3J8B (activation; steps in the monitoring ops doc §9, own
  authorization) is blocked on backup scheduling. Also open:
  hard containment on the real host; unattended credential persistence (U1
  open; E3J9C passed its local scope, lifecycle/reboot unproven); real-CLI schema verification; U12-U14
  (readback ceilings/containment, timeouts/retries, remote root and flat
  layout); U15 partly resolved (emitter built, no provider object, receipt
  test unrun). D1 is accepted; E3J9D-R is installed; E3J9D stopped before P0
  (URL disclosure, credential revoked and rotated) and needs a newly authorized
  ceremony; **D7** gates E3J9E; **C1** must merge
  before any E3J10 step that executes the CLI or can contact Proton. Detail:
  [credential memo](docs/planning/proton-drive-hotel-echo-credential-design.md),
  [`backup-monitoring-export.md`](docs/operations/backup-monitoring-export.md),
  [`proton-drive-cloud-transport-architecture.md`](docs/planning/proton-drive-cloud-transport-architecture.md),
  [`proton-drive-transport-feasibility.md`](docs/planning/proton-drive-transport-feasibility.md),
  [`proton-drive-scratch-experiment.md`](docs/planning/proton-drive-scratch-experiment.md).
- **Legal docs drafted, not published, not counsel-reviewed** (placeholder
  URLs, indexing reverification, notice-of-changes mechanism). Cloudflare Web
  Analytics is still enabled, contradicting the no-tracking decision. Drafts:
  `docs/planning/*-draft.md`.
- **NHL 26/27 title default & chronology bug** — decided at E1J, not
  implemented: `is_active` conflates ingestion eligibility with frontend
  default; `/` and `/games` lack `title-resolver.ts`'s archive fallback;
  chronology sorts by id (NHL 27's id > NHL 26's). NHL 27 is currently the
  default on `/`/`/games` on both hosts. Rollback (stops NHL 27 polling,
  deletes nothing): `UPDATE game_titles SET is_active = false WHERE slug = 'nhl27';`.
  Full spec: archive, E1J entry.

## Next 1-3 Actions

1. **Backup credential path:** a newly authorized E3J9D (memo §21): repeat the
   same-session pre-ceremony proofs (files already installed), a new operator
   ceremony whose output never reaches any agent, then exactly one P0 via
   `provider-probe run provider` and owned-inventory. E3J9E (lifecycle, reboot) needs
   **D7**; **C1** must merge before any E3J10 step that executes the CLI or can
   contact Proton.
2. Gate 2 reliability items: automated backups, restore drill, alerting, log
   retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural stopping
point and log the milestone in the journal — see `agent-manager-workflow.md`
§8 and the `handoff-update` skill.
