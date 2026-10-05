# Handoff

Short current-state index. Target 100–150 lines; hard ceiling 200 lines /
12KB (`.claude/skills/handoff-update/SKILL.md`). Detail lives in the linked
documents, not here.

- **Launch plan** (the active checklist):
  [`docs/planning/operational-v1-roadmap.md`](docs/planning/operational-v1-roadmap.md)
- Work diary: [`docs/journal/2026-10.md`](docs/journal/2026-10.md)
- Previous handoff, with the full Proton/E3 backup state, archived unchanged:
  [`docs/archive/handoff-history-2026-10-05.md`](docs/archive/handoff-history-2026-10-05.md)
  (archive links resolve from the repo root — see
  [`docs/archive/README.md`](docs/archive/README.md)).

## How We Work Now (2026-10-04 workflow review)

- Claude Code leads from the operator's plain-language requests. Codex is an
  optional second opinion through the official Codex plugin, for the riskiest
  changes only. If Codex is unavailable, work continues and the review is
  recorded as owed.
- Process scales with risk: UI/docs → build it and show it; database,
  ingestion or real data → short plan, backup first, review; secrets,
  network exposure or deletion → plan, and the operator approves each
  irreversible step.
- `AGENTS.md` and `docs/operations/agent-manager-workflow.md` still describe
  the old Codex-as-manager relay and are **outdated** until rewritten. Where
  they conflict with this section, this section wins.

## Current Objective / Status

Launch the site to teammates using the 7-item launch plan (adopted
2026-10-05). Item 1 (data safe) is nearly done; items 2–7 are open.

## Latest Verified Checkpoint

**2026-10-05 — nightly backup running; repo tidied; launch plan cut to 7
items.** Detail: [journal 2026-10-05](docs/journal/2026-10.md).

- Nightly backup (`ops/nightly-backup/`) runs on the main PC at 03:00
  America/Edmonton: dump → restore test → `K:\eanhl-backups` → Backblaze B2 →
  Healthchecks.io check-in. Restores from the local disk and from B2 matched
  (435 = 435 matches); down/up alert emails received. **Codex review of the backup is owed:** four attempts failed on tooling (latest: "Reviewer failed to output a response"). To run it: check out `feat/nightly-backup`, then `/codex:review --wait --base 0ec6989`.
- The main PC's website and worker were rebuilt from `main` (they had been
  running Aug 16 / Sep 2 builds): core pages, legal pages and footer load;
  login is gone; worker cycles cleanly; no web errors. Compose also recreated
  `db` once (clean ~1 s restart, data intact); the redeploy skill now uses
  `--no-deps`.
- `main` now matches GitHub plus the backup work and the 2026-10-03 launch
  reconciliation docs. 11 extra worktrees and 17 already-merged local branch
  names were removed. September leftovers are parked on the local branches
  `park/codex-claude-bridge` and `park/roster-stats-design-inputs` (not for
  merging; the second holds real player data).

## Essential Operational Constraints

- **Production is the main PC** (web, worker, db, backup via Docker Compose).
  Hotel-Echo runs a parallel, not-yet-migrated copy that also ingests NHL 27.
- Main PC web + worker run `main` at `fde8e20` (deployed 2026-10-05; images
  `ffb6c34a1b0f` / `c992dcccedc4`). Rollback images are tagged
  `eanhl-team-website-web:rollback-2026-08-16` and
  `eanhl-team-website-worker:rollback-2026-09-02` (steps: `docker-redeploy`
  skill).
- Domain `boogeymen.app` is on Cloudflare; `webmaster@boogeymen.app` works
  both ways.
- The Cloudflare tunnel is deliberately **off** on both hosts (the `public`
  Compose profile is not enabled). Turning it on is launch item 7 and needs
  the operator's approval. Login/auth was deliberately removed pre-launch.
- NHL 27 ingestion has been live since 2026-09-05; NHL 26 is preserved. Both
  titles are `is_active` on the main PC, and NHL 27 is the site default.
- Backups are enabled by `COMPOSE_PROFILES=backup` in `.env`. Setup, alerts
  and restore steps: [`ops/nightly-backup/README.md`](ops/nightly-backup/README.md).
  The B2 key is Backblaze's stock "Write Only" key, which can still delete
  inside the bucket — accepted by the operator.
- Live DB: container `eanhl-team-website-db-1`, host port 5433. Migrations
  0046+ are hand-written SQL applied with `psql`, not `drizzle-kit migrate`.
- `pnpm lint` is red repo-wide (pre-existing config drift); typecheck, tests
  and prettier are the gates.
- `git push` runs the ~20-minute verification suite only when the push
  touches video-stats code (rule: [`ops/README.md`](ops/README.md)). For
  video-stats work in files without "ocr" in the path, push with
  `EANHL_PRE_PUSH_FULL=1`.
- **Proton/E3 cloud backup is parked.** Hotel-Echo keeps E3's installed
  credential tooling and a logged-in Proton session from 2026-09-30; nothing
  is scheduled. Full E3 state: the archived handoff and the
  [credential memo](docs/planning/proton-drive-hotel-echo-credential-design.md).
- Main-PC secrets were rotated 2026-09-03; the dead old value remains in git
  history.

## Immediate Blockers

None. Open decisions:

- Whether to log out Hotel-Echo's retained Proton session (parked E3).

## Next 1-3 Actions

1. Launch item 2: review `feat/lpl-title-separation` (one commit on top of
   `main`, local only), take a fresh backup, apply migration 0057, check the
   pages.
2. Finish the workflow cleanup: rewrite `AGENTS.md` and the workflow doc for
   the new model (about one page).
3. Launch items 3–5.
