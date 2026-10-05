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
2026-10-05). Item 2 (correct data) is done; item 1 (data safe) needs two more
green nights; items 3–7 are open.

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
- Launch item 2 done: NHL 26/27 title separation merged and deployed with
  migration 0057 (rehearsed on a restored backup first, fresh backup taken
  before the live run). Review caught one bug (archive titles on `/` and
  `/games` showed empty pages), fixed in `538d956`. Career label now reads
  oldest→newest (e.g. "NHL 22–NHL 27").
- Launch item 3 code side done (`6f5d75b`, `e93e24a`): `/preview/*` removed
  (404), noindex meta + `X-Robots-Tag` on everything, `robots.txt`, no
  `X-Powered-By`; branded error page (shows only an opaque reference) and the
  operator's scoreboard 404 design. Forced-error test leaked nothing.
- `main` now matches GitHub plus the backup work and the 2026-10-03 launch
  reconciliation docs. 11 extra worktrees and 17 already-merged local branch
  names were removed. September leftovers are parked on the local branches
  `park/codex-claude-bridge` and `park/roster-stats-design-inputs` (not for
  merging; the second holds real player data).

## Essential Operational Constraints

- **Production is the main PC** (web, worker, db, backup via Docker Compose).
  Hotel-Echo runs a parallel, not-yet-migrated copy that also ingests NHL 27.
- Main PC web runs `main` at `e93e24a` (image `79e5190a1a30`), worker at `538d956`
  (`7c4f7054ea52`), deployed 2026-10-05. Web rollback images, newest first:
  `eanhl-team-website-web:rollback-2026-10-05-item3` (before the scoreboard
  404), `:rollback-2026-10-05-titles` (before item 3), `:rollback-2026-08-16`;
  worker: `eanhl-team-website-worker:rollback-2026-09-02`. Old code runs fine
  on the 0057 schema. Steps: `docker-redeploy` skill.
- Domain `boogeymen.app` is on Cloudflare; `webmaster@boogeymen.app` works
  both ways.
- The Cloudflare tunnel is deliberately **off** on both hosts (the `public`
  Compose profile is not enabled). Turning it on is launch item 7 and needs
  the operator's approval. Login/auth was deliberately removed pre-launch.
- NHL 27 ingestion has been live since 2026-09-05; NHL 26 is preserved. Since
  migration 0057 (applied 2026-10-05) three settings are separate:
  collection (`is_active`: NHL 26 and 27), site default (`is_default`: NHL 27)
  and order (`release_order`). Stopping NHL 26 collection later
  (`UPDATE game_titles SET is_active = false WHERE slug = 'nhl26';`) keeps its
  pages.
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

1. Finish launch item 3: the operator checks the Cloudflare tunnel's Public
   Hostname list (expect only `boogeymen.app` → `http://web:3000`).
2. Launch items 4–5 (legal pages live, analytics off; stale-ingestion alert,
   Docker log limits).
3. Finish the workflow cleanup: rewrite `AGENTS.md` and the workflow doc for
   the new model (about one page).
