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
  [`docs/journal/2026-09.md`](docs/journal/2026-09.md),
  [`docs/journal/2026-10.md`](docs/journal/2026-10.md).
- Workflow policy:
  [`docs/operations/agent-manager-workflow.md`](docs/operations/agent-manager-workflow.md).

## Current Objective / Status

Limited Public Launch preparation under the 2026-10-02 Fast Credible Launch
amendment. L0 repository reconciliation is recorded, but L0 remains open
pending a read-only main-PC production inventory and an explicit safe-pause
statement from the separate E3 conversation. L1-L7 are not complete. Full
Operational V1 remains a later milestone. Checkbox detail: the roadmap doc.

## Latest Verified Checkpoint

**2026-10-03 — LPL L0 repository reconciliation and isolated control baseline.**
The refreshed baseline is
`b8fb23ffea64dff7c5521a06a7194341a380ee7a` on
`integrate/lpl-2026-10-02`, in the separate `lpl-control` worktree. The
roadmap amendment was preserved byte-for-byte at SHA-256
`3f5626f85462bdf9777efbb6a367be221653a0ece05e79c02a1d787c2b61dd58`.
The dirty primary checkout was not modified. No production, Hotel-Echo,
provider, credential or database access occurred. Launch remains stopped.
Evidence: [L0 reconciliation](docs/planning/lpl-l0-reconciliation-2026-10-03.md).

**2026-10-01 — E3J9E stopped at N3; E3J9E-R correction implemented (G1),
awaiting review.** N3 was refused before any CLI execution: its precondition
key listing needed the lock the attested `lockhold-long` holder owns. Branch
`fix/e3j9e-r-n3-lock-preflight` (base `51650dc`; launcher, harness and docs
only) makes `n3-busy` lock-free, refuses a stale holder, requires a live holder
process and lock state 75. Static harness: 625 passed, 84 mutations killed. G2
is complete; three byte-identical full runs each passed 629 with 84 mutations
killed, accepted-delta regeneration and both input-hash checks. External
review, commit, merge and the Hotel-Echo install are not done. Ledger
`p1a p1b p2 e4 n3` (4 of 9 CLI executions). Record:
[memo §23](docs/planning/proton-drive-hotel-echo-credential-design.md).

- E3J9E run4 evidence: 11 of the 18 files recovered hash-exact after a reboot (recovered bundle, not an original snapshot); 7 were not reconstructed; P1b/P2/E4 survive only as reported results; reduced evidence boundary accepted (OD-1).

**2026-09-30 — E3J9D PASSED for the ceremony + single-P0 scope only.** From
`7b3a379` (worktree `integrate/e3j9d-r-2026-09-30`), with the E3J9D-R launcher
(`0244f8ee…`), probe (`46b112c2…`) and `unit-publish` (`5acf4677…`) already
installed: every same-session pre-ceremony proof passed, one row at a time
(A1–A4, A7, A8, A10, E1(a), `env-proof`, L2, busy overlap, host formats, auth
preconditions); a new operator ceremony completed (`ssh_rc=0`,
`auth_login_unit_rc=0`); **exactly one P0** (`provider-probe run provider`,
metadata-only `/my-files` info) gave `provider_run_result=pass`,
`provider_result=ok` (`p0_attempt_count=1`), with clean binding, cleanup,
vocabulary and postconditions; owned-inventory match. The encrypted session
entry and CLI state are **retained for E3J9E**; nothing scheduled. Record:
[memo §22](docs/planning/proton-drive-hotel-echo-credential-design.md).

Same day, first attempt (memo §21): the ceremony completed but its URL was
pasted to Codex; stopped before P0, the session revoked by the operator, local
state removed and the key/store rotated without running the CLI.

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
  open; E3J9C and E3J9D passed their scopes, E3J9E stopped at N3, lifecycle/reboot unproven); real-CLI schema verification; U12-U14
  (readback ceilings/containment, timeouts/retries, remote root and flat
  layout); U15 partly resolved (emitter built, no provider object, receipt
  test unrun). D1 is accepted; E3J9D passed (ceremony + one P0; session
  retained for E3J9E); **D7 is accepted** for one controlled reboot under the
  credential memo §15 conditions, but E3J9E still needs separate authorization;
  **C1** must merge before any E3J10 step that executes the CLI or can contact
  Proton. Detail:
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

1. Complete L0 with an authorized read-only main-PC production inventory and
   an explicit safe-pause statement from the separate E3 conversation.
2. Implement the L1 title-control split on its isolated branch: independent
   ingestion/default/chronology, one resolver, NHL 26 history and correct
   cross-title labels/precedence.
3. Select the physically separate interim-backup destination, then implement
   and prove the non-E3 L2 recovery path and its L5 freshness/failure signal.

Pick one item per session. Update this file in place at the natural stopping
point and log the milestone in the journal — see `agent-manager-workflow.md`
§8 and the `handoff-update` skill.
