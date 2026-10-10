# Handoff

Short current-state index. Target 100–150 lines; hard ceiling 200 lines /
12KB (`.claude/skills/handoff-update/SKILL.md`). Detail lives in the linked
documents, not here.

- **Launch plan** (the active checklist):
  [`docs/planning/operational-v1-roadmap.md`](docs/planning/operational-v1-roadmap.md)
- Work diary: [`docs/journal/2026-10.md`](docs/journal/2026-10.md)
- Previous handoffs, archived unchanged: full Proton/E3 backup state in
  [`handoff-history-2026-10-05.md`](docs/archive/handoff-history-2026-10-05.md);
  the full 10-05 launch checkpoint in
  [`handoff-history-2026-10-09.md`](docs/archive/handoff-history-2026-10-09.md)
  (archive links resolve from the repo root — see
  [`docs/archive/README.md`](docs/archive/README.md)).

## How We Work

The operator decides; Claude Code leads; Codex is an optional second-opinion
reviewer. Process is sized to risk. One page:
[`docs/operations/agent-manager-workflow.md`](docs/operations/agent-manager-workflow.md);
commit/push rules in `CLAUDE.md`.

## Current Objective / Status

**The site is live at https://boogeymen.app** (2026-10-05 ~15:15 MDT) for
teammates, by link — unlisted (`noindex` everywhere), no analytics.
Served from Hotel-Echo through the `hotel-echo-web` Cloudflare
tunnel. **The launch plan is closed** (all 8 items ✅ 2026-10-09; four green
unattended backup nights 10-06 → 10-09). Next: post-launch work (polish,
video-stats OCR).

**Member logins are live** (2026-10-09, `7b76804`): Discord-only, invite-only sign-in; the operator (Silky, player 2) is the one admin and invites teammates on `/admin/accounts`. **Live for members:** Card Locker EQUIP (own card; admin any), Discord picture in the nav, and **EDIT PROFILE** on the player page (`7aa6599`: member edits name, jersey, nationality, bio; admin also position, archetype, club role, on any player). **Admin tools are live** (`/admin`, [plan](docs/superpowers/plans/2026-10-09-admin-tools.md)): accounts, roster pins, sign-everyone-out, titles (view only), mythic cards, and the trophy case editor — **trophies/banners now live in the database** (migration 0066), not `club-awards.ts`. Detail: [journal 2026-10-09](docs/journal/2026-10.md).

**Discord poster: live in DRY RUN** (2026-10-10, `df27251`, 0067; web rollback `:rollback-he-2026-10-10-pre-discord`). Posts nothing until `DISCORD_WEBHOOK_URL` + `DISCORD_DRY_RUN=0`; off = `docker compose stop discord`. [Journal](docs/journal/2026-10.md).

**Awards trophy case is live** (2026-10-08); add trophies/banners (3s/6s/arcade) on `/admin/awards`. Awards rank ALL SKATERS totals (operator choice).

**Responsive sizes are live** (2026-10-09): Medium/Small/Micro tiers, compact cards on phones, side rail on wide screens.

**Member-only player pages are live** (2026-10-09, `fafeefb`; rollback `:rollback-he-2026-10-09-pre-members`): only team members, present and past (EA member list for any title, member archive, pinned, AI goalies — 18 of 92) have a `/roster/[id]` page; guests 404 and show as plain text elsewhere (`PlayerLink` + `MemberLinks`), and the home carousel shows members only.

**Also live 2026-10-09** (`3d62b8a`; rollback `:rollback-he-2026-10-09-pre-locker-v3`): stats-table size tiers, Build Locker v3 (persona name from OCR), Action Map clocks, short-code build names. Detail: [journal 2026-10-09](docs/journal/2026-10.md).

**Player cards are live** (2026-10-08): season cards (one per NHL title, from NHL 27), badges, the EDIT locker, Build Locker v2 and the Career Action Map. Spec: [`2026-10-07-player-cards-badges-design.md`](docs/superpowers/specs/2026-10-07-player-cards-badges-design.md), amended by [season cards](docs/superpowers/specs/2026-10-08-season-cards-design.md).

## Latest Verified Checkpoint

**2026-10-09 — member logins + admin tools deployed** (web `86a902b`, worker `3616aab`; migrations 0065 + 0066 on live/test/preview). Steps: logins `7b76804`, EQUIP `f24507f`, Discord picture `354f2da`, profile edit `7aa6599`, admin hub `7984070`, mythics `3616aab`, trophy editor `86a902b`. Rollback tags `:rollback-he-2026-10-09-pre-{logins,equip,avatar,profile-edit,admin-hub,mythics,awards-db}`; server `.env.bak-2026-10-09`; 0066 rollback = drop the two award tables. Each release operator-verified on localhost; security review clean. Detail: [journal 2026-10-09](docs/journal/2026-10.md).

**2026-10-09 — responsive sizes, side rail, compact carousel deployed** (`fb40008`, web only; rollback image `eanhl-team-website-web:rollback-he-2026-10-09-pre-responsive`). Medium ≤1100 / Small ≤720 / Micro ≤480 tiers for the player, roster and home components; `PlayerCardCompact`; player-page side rail at ≥1680px; Charts & Visuals and Recent Form removed (`4095e49`, rollback `:rollback-he-2026-10-09-pre-no-form`). Detail: [journal 2026-10-09](docs/journal/2026-10.md).

**2026-10-08 — Awards + migration 0064** (`d038b36`; rollback `:rollback-he-2026-10-08-pre-awards`; 0064 rollback `DELETE … WHERE import_batch = '0064-derived-all-skaters'`). [Journal](docs/journal/2026-10.md).

**2026-10-08 — player cards, AI goalies, position filter deployed** (`29ee6a2`; migrations 0060–0063; rollbacks `:rollback-he-2026-10-08-pre-{cards,ai-goalies,positions}`, dumps `~/eanhl-backups/pre-*-2026-10-08-*.dump`). Lehmann / Wagner (AI goalies) and pinned Jimmy Cap are players. [Journal](docs/journal/2026-10.md), [AI goalies spec](docs/superpowers/specs/2026-10-08-ai-goalies-design.md).

**2026-10-06 — NHL 26 contamination cleaned up** (worker `3f35733`; rollback `:rollback-2026-10-05-quarantine`; dump `~/eanhl-backups/pre-quarantine-2026-10-05/`): club 19224 is "Chipstuttar" since 2026-09-07; its 172 matches are out. [Plan](docs/planning/2026-10-05-nhl26-club-19224-quarantine.md), [journal](docs/journal/2026-10.md).

**2026-10-06 — performance pass deployed** (`351354d`; rollback `:rollback-he-2026-10-06-pre-perf`). Detail: [journal 2026-10-06](docs/journal/2026-10.md).

**2026-10-05 — launched; security update + polish deployed** (`67ff9c4`; public checks all passed). Full checkpoint: [archive 2026-10-09](docs/archive/handoff-history-2026-10-09.md), [journal 2026-10-05](docs/journal/2026-10.md).

- **Codex review of the nightly backup done** (2026-10-09): four P2s, none
  affecting live today; open, operator to decide on fixes (journal 10-09).
- Parked, local-only branches: `park/codex-claude-bridge`,
  `park/roster-stats-design-inputs` (real player data; not for merging).

## Essential Operational Constraints

- **Production is Hotel-Echo** since 2026-10-05 14:25 (`ssh hotel-echo`,
  Tailscale `100.98.29.119`, repo `~/eanhl-team-website`): web, worker, db
  and nightly backup (web at `86a902b`, worker at `3616aab`), web and worker as the non-root
  `node` user (container logs capped at
  3 × 10 MB; worker heartbeat pinging the "eanhl collector" Healthchecks
  check via `HC_WORKER_PING_URL` in its `.env`). Its live DB holds 277 matches (449-match union minus the 172 quarantined). Older rollback images (`:rollback-he-2026-10-05-*`, `:rollback-he-2026-09-04`) and the old Hotel-Echo DB `eanhl_he_old` are kept; the main-PC fallback below.
- **Main PC = stopped fallback + video-OCR box.** Its web, worker and backup
  are stopped and its `COMPOSE_PROFILES=backup` line is commented out; its db
  still runs, frozen at 435 matches. **Do not `docker compose up -d` there**
  — it would restart a second collector. Restart it only as a deliberate
  fallback (copy back any games Hotel-Echo collected meanwhile).
- Hotel-Echo's ports are loopback-only; the public path is the tunnel. To
  bypass Cloudflare from the main PC:
  `ssh -N -L 127.0.0.1:3100:127.0.0.1:3000 hotel-echo` → `http://localhost:3100`.
- Domain `boogeymen.app` is on Cloudflare; `webmaster@boogeymen.app` works
  both ways.
- **The Cloudflare tunnel is ON** on Hotel-Echo (`COMPOSE_PROFILES=backup,public`;
  tunnel `hotel-echo-web`; routes `boogeymen.app` and `www` → `http://web:3000`
  only, catch-all 404). Token in `secrets/cloudflared-tunnel-token`, `600`,
  owned by uid `65532` (the image's user — see `DEPLOY.md`). **Take the site
  offline:** `docker compose stop cloudflared` on Hotel-Echo. A copy of the
  pre-launch `.env` (still holding the old `TUNNEL_TOKEN` line) was deleted by 2026-10-06. The main PC has no tunnel.
- **Member logins** (Discord, invite-only): Discord apps "Boogeymen" (prod,
  creds in Hotel-Echo `.env`) and "Boogeymen Dev" (local `.env`,
  `localhost:3000` only). Settings, first-admin command, checks and the
  sign-everyone-out lever (`DELETE FROM sessions`): `DEPLOY.md` §7. Legal
  footer notice ends 2026-11-09 (`LEGAL_CHANGE_NOTICE`).
- NHL 27 ingestion has been live since 2026-09-05. Since migration 0057
  three settings are separate: collection (`is_active`: **NHL 27 only** —
  NHL 26 was switched off 2026-10-06; its pages remain), site default
  (`is_default`: NHL 27) and order (`release_order`). **Never re-enable NHL
  26 collection:** club 19224 now belongs to another club.
- **Club identity guard** (migration 0058): the worker refuses any match where
  the club under our ID isn't named `game_titles.ea_club_name` ('The
  Boogeymen' for nhl26/nhl27). Refusals land as `error` rows and turn the
  heartbeat red, which is intended. If the team renames its club, update
  `ea_club_name`, then `reprocess`. Refused-on-purpose payloads live verbatim in
  `quarantined_raw_match_payloads` (0059), outside monitoring and reprocess.
  The club record, member stats and season rank are not guarded yet (plan
  step 3, optional).
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
- **Proton/E3 cloud backup is parked** (HE session logged out + revoked 10-05; nothing scheduled). State: the archived handoff and the [credential memo](docs/planning/proton-drive-hotel-echo-credential-design.md).
- Main-PC secrets were rotated 2026-09-03; the dead old value remains in git
  history.

## Immediate Blockers

None.

## Next 1-3 Actions

0. Discord poster: operator makes a `#bot-test` webhook → set it + `DISCORD_DRY_RUN=0`, restart `discord`; then the real channel.
   Logins/admin open choices: club role display, more flags, a 6v6 banner.
1. Watch teammates' reactions to the 10-09 batch (Build Locker v3, persona names from OCR). Cards: re-check the season pace at mid-season and re-tune before NHL 28 (AI-goalie ladders too). Still open: a pre-existing Contribution Wheel hydration warning. Jimmy Cap stays RW (vanity card, operator 10-09). Local `eanhl_preview` was rebuilt 10-09 from that night's backup (285 matches). New migrations must also go to `eanhl_test` (verify-ocr seed).
2. Polish: cross-cutting + by-surface passes **deployed 2026-10-09** (`5269fbe`, web only; rollback `eanhl-team-website-web:rollback-he-2026-10-09-pre-polish` = `fafeefb`), incl. the live UTC-dates fix, the operator's four answers and the goalie Contribution Wheel. Every backlog entry has an outcome ([`docs/POLISH_BACKLOG.md`](docs/POLISH_BACKLOG.md), journal 10-09).
3. Backup hardening from the Codex review (optional, small): weekly/monthly
   copies after a missed Sunday/1st, and a run lock for manual + scheduled
   overlap. Watch teammates' feedback (including on speed). Video-stats OCR
   writing to Hotel-Echo's database is on hold (operator, 10-09).
