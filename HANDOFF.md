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

**2026-09-24 — E3J9B-doc: the option-A Hotel-Echo credential design is recorded
locally (documentation only, uncommitted). U1 and E3J9 remain open; E3 remains
unactivated.** Design (operator's option (a)):
[`proton-drive-hotel-echo-credential-design.md`](docs/planning/proton-drive-hotel-echo-credential-design.md)
— dedicated locked `eanhl-cloud` system identity (system services, no linger),
curated credential `PATH`, kernel `flock --close` credential lock, every credential
command started through `env -i` with twelve initial literals, operator-only PTY
login, fixed `ERROR` logging. Same-day review correction: pass's own `GPG_TTY`
(expected empty) and `GIT_CEILING_DIRECTORIES` exports are permitted with fixed
values; `/proc` observation is supplementary only. **E3J9B-doc installed or
configured none of the option-A components on Hotel-Echo** (it is a design only).
Sequence E3J9B-doc → **E3J9C** (needs separate authorization; not started) →
E3J9D (**D1** gates it only) → E3J9E (**D7** gates it only); D1 and D7 are
unresolved. **C1**
(literal `ERROR` in `buildChildEnv()` + tests) must merge before any E3J10 step that
executes the CLI or can contact Proton. Journal:
[`docs/journal/2026-09.md`](docs/journal/2026-09.md).

Previous — **2026-09-24 — E3J9A**, read-only Hotel-Echo inspection, complete only as
feasibility evidence ([memo](docs/planning/proton-drive-hotel-echo-credential-feasibility.md)):
no usable Proton credential mechanism or session for `utiz` in the inspected
default/current-session locations (universal absence not established); no TPM
device path or `crypt` layer evidenced by the named checks.

Before that — **2026-09-23 — E3J8A (local, non-activated Healthchecks freshness
export), verified. NOTHING IS MONITORED.** `ops/backup/eanhl-backup-monitor-export.mjs
--cloud-config <p> --monitor-config <p>`: `fresh` → success endpoint, else `/fail`,
one hosted Healthchecks.io check; one HTTPS request per invocation, no retry; no
shebang, exec bit, package script, timer, unit or cron entry. Pieces 4-5 (grace
timer, Pushover, `alerts@boogeymen.app`) are provider-side: **no local watcher or
notification code**. The monitor schema is exactly closed (7 keys); the ping key
sits in a `0600` operator file outside the repo. Only exact 200 + `OK` is
`accepted`; exit 0 means the ping was accepted, not that the backup is fresh;
monitor-side failure pings nothing (silence is the alarm). **The ping-key risk is
EXPLICITLY ACCEPTED** (bearer credential; a forged healthy ping is undetectable).
Full suite 1169 declared, 1168 passed, 1 root-only skipped, 0 failed; nothing
contacted an external host. Contract: memo §5.7 and the ops doc below.

Before that — **2026-09-21 — E3J7 (freshness evaluation, local-only)**:
`eanhl-backup-freshness.mjs` prints one `eanhl.cloud-freshness-signal` v1 line
(`monitored: false`; exit 0 = signal produced, not freshness); 8 h / 24 h bands;
**956/956**, 69/69 mutations. Rule detail: memo §5.3.

Before that — **2026-09-19, E3J6C (`97e62d4`, committed and pushed)** — the run
lock, collision-only bounded retry (T18), private signal ownership, and the
first executable entrypoint (`ops/backup/eanhl-backup-cloud.mjs`); **756/756**,
39/39 mutations caught. Contract detail: memo §4.7. Run the suite outside the
Codex bubblewrap sandbox (Node child stdout is lost there — an environment
limitation, not a regression).

**Known-unclosed, by design:** real-CLI schemas are hypotheses; path-based
lock, upload, enumeration and manifest-read TOCTOU windows are narrowed, not
closed (a swap-and-restore is undetected); SIGKILL/power loss or a second
signal leaves the lock (and possibly orphaned CLI children or an intent
without an attestation) for manual reconciliation; a retention reason is
durable only inside a written attestation; freshness depends on local
manifests, so a pruned manifest blocks its base from counting (E3J13); and
(E3J8A) a forged healthy ping is undetectable from this side, the live `OK`
response contract is documented but never observed, exactly-once ping delivery
is never claimed, and `internal/` is a convention rather than access control.

Detail (schemas, lock contract, reconciliation §4.7, ping contract §5.7,
correction history): the architecture memo linked under Immediate Blockers.
Milestones: [`docs/journal/2026-09.md`](docs/journal/2026-09.md).

Before that: E3J6B 2026-09-18, **637/637** (`bbcff5b`); E3J6A 2026-09-16,
495/495 (`70abb63`); E3J5 2026-09-16, 413/413 (`eea6ace`); E3J4 2026-09-14,
354/354 (`0fc9678`); E3J3 235/235 and E3J2 179/179 both 2026-09-13; E3I closed 09-12.

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

- **E3 (Proton cloud backup) unactivated, and NOTHING IS MONITORED.** The local
  chain through E3J8A exists — attestation writer, run lock, bounded retry, two
  executable entrypoints, a read-only freshness evaluator, and now an **emitter
  that would ping Healthchecks.io** — but **nothing schedules the emitter, no
  provider account, check, ping key or notification integration exists, and no
  human has received a test notification**. Code existing is not monitoring
  existing; `monitored` stays `false`, and activation (**E3J8B**) is blocked on
  backup scheduling, which does not exist. Also open: a proven hard-containment
  mechanism on the real host, unattended credential persistence (U1 open; the option-A
  design is recorded; E3J9B-doc installed nothing and nothing is proven), and real-CLI schema verification. U12-U14 remain unresolved (readback ceilings/containment proof,
  timeouts/retry values, remote root and the flat layout's ratification); U15 is
  **partly** resolved — format, transport, watcher and channels decided and the
  emitter built, but no provider object exists and the receipt test is unrun.
  Detail:
  [`docs/operations/backup-monitoring-export.md`](docs/operations/backup-monitoring-export.md),
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

1. If continuing backup work: E3J8A is committed and pushed
   (`9ea391ab9cb494688afcfab8b96ba544912efe19`); E3J2-E3J8A exhaust the local
   sessions. E3 stays unactivated and nothing is monitored; **E3J8B (activation)**
   is not actionable until backup scheduling exists (its steps: the ops doc above,
   §9; own authorization). After **E3J9B-doc** the next credential step is
   **E3J9C** (host foundation and local proof: package, `eanhl-cloud` identity,
   curated `PATH`, wrapper, pinned CLI install without execution, key, empty store),
   which **is not authorized or started** and needs its own authorization. Then
   E3J9D (operator ceremony; **D1** open) and E3J9E (lifecycle incl. a reboot;
   **D7** open), each separately authorized. **C1** must merge before any E3J10
   step that executes the CLI or can contact Proton.
2. Gate 2 reliability items: automated backups, restore drill, alerting,
   log retention, rollback docs — all unstarted and blocking Gate 2.
3. Disable and verify Cloudflare Web Analytics.

Pick one item per session. Update this file in place at the natural
stopping point, and log the milestone in `docs/journal/2026-09.md` — see
`agent-manager-workflow.md` §8 and the `handoff-update` skill.
