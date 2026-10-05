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

Launch the site to teammates from Hotel-Echo using the 8-item launch plan
(adopted 2026-10-05, host pivot same day). Items 2 (correct data) and 5 (move
to Hotel-Echo) are done; item 1 needs three green nights on Hotel-Echo;
item 3 needs only the Cloudflare routes check; items 4, 6–8 are open.

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
- Launch item 5 done: production moved to Hotel-Echo with a merged database
  (main PC's 435 + 14 games only Hotel-Echo had = 449, verified as the exact
  union), rehearsed first; nightly backup moved there (first run green).
- `main` now matches GitHub plus the backup work and the 2026-10-03 launch
  reconciliation docs. 11 extra worktrees and 17 already-merged local branch
  names were removed. September leftovers are parked on the local branches
  `park/codex-claude-bridge` and `park/roster-stats-design-inputs` (not for
  merging; the second holds real player data).

## Essential Operational Constraints

- **Production is Hotel-Echo** since 2026-10-05 14:25 (`ssh hotel-echo`,
  Tailscale `100.98.29.119`, repo `~/eanhl-team-website`): web, worker, db
  and nightly backup on `main` at `3b9dd32` (container logs capped at
  3 × 10 MB; worker heartbeat built in, inactive until `HC_WORKER_PING_URL`
  is set in its `.env`). Its live DB holds 449
  matches = both hosts' union. Rollback: images
  `:rollback-he-2026-10-05-pre-logs` / `:rollback-he-2026-09-04` and the old
  Hotel-Echo database kept as
  `eanhl_he_old`; the main-PC fallback below.
- **Main PC = stopped fallback + video-OCR box.** Its web, worker and backup
  are stopped and its `COMPOSE_PROFILES=backup` line is commented out; its db
  still runs, frozen at 435 matches. **Do not `docker compose up -d` there**
  — it would restart a second collector. Restart it only as a deliberate
  fallback (copy back any games Hotel-Echo collected meanwhile).
- To view Hotel-Echo's site from the main PC:
  `ssh -N -L 127.0.0.1:3100:127.0.0.1:3000 hotel-echo`, then
  `http://localhost:3100`. Hotel-Echo's ports are loopback-only.
- Domain `boogeymen.app` is on Cloudflare; `webmaster@boogeymen.app` works
  both ways.
- The Cloudflare tunnel is deliberately **off** on both hosts (the `public`
  Compose profile is not enabled). The only tunnel is `hotel-echo-web`
  (status Down, no CIDR routes); `boogeymen.app` and `www` point at it. The
  main PC has no tunnel token. Turning it on is launch item 8 and needs the
  operator's approval; Hotel-Echo keeps the token as `TUNNEL_TOKEN` in `.env`
  (old style) — current compose expects a token file. Login/auth was deliberately removed pre-launch.
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
  credential tooling; its Proton session was logged out locally on
  2026-10-05 (`auth-logout`, entry proven absent). Remote revocation in
  Proton's session settings is the operator's step. Nothing is scheduled. Full E3 state: the archived handoff and the
  [credential memo](docs/planning/proton-drive-hotel-echo-credential-design.md).
- Main-PC secrets were rotated 2026-09-03; the dead old value remains in git
  history.

## Immediate Blockers

None. Open operator steps:

- Revoke the Sept 30 Proton CLI session in Proton's web settings.
- Turn off Cloudflare Web Analytics (item 4).
- Create the collector's Healthchecks check and supply its ping URL (item 6).
- Decide how the legal pages go live (item 4).

## Next 1-3 Actions

1. Operator looks at Hotel-Echo's site (`http://localhost:3100` via the
   tunnel above) — doubles as the start of item 7.
2. Finish item 3 (operator: the tunnel's Published application routes) and
   item 4 (legal pages live, analytics off), then item 6 on Hotel-Echo.
3. Finish the workflow cleanup: rewrite `AGENTS.md` and the workflow doc for
   the new model (about one page).
