# Handoff

Short current-state index. Target 100–150 lines; hard ceiling 200 lines /
12KB (`.claude/skills/handoff-update/SKILL.md`). Detail lives in the linked
documents, not here.

- **Launch plan** (the active checklist):
  [`docs/planning/operational-v1-roadmap.md`](docs/planning/operational-v1-roadmap.md)
- Work diary: [`docs/journal/2026-11.md`](docs/journal/2026-11.md) (October: [`2026-10.md`](docs/journal/2026-10.md))
- Previous handoffs, archived unchanged: full Proton/E3 backup state in
  [`handoff-history-2026-10-05.md`](docs/archive/handoff-history-2026-10-05.md);
  the full 10-05 launch checkpoint in
  [`handoff-history-2026-10-09.md`](docs/archive/handoff-history-2026-10-09.md)
  (archive links resolve from the repo root — see
  [`docs/archive/README.md`](docs/archive/README.md)).

## How We Work

**Workflow v2 since 2026-11-09** (adapted from the sister repo): one Lead chat, one task file and one
`work/<slug>` branch per piece of work, lanes, only the Lead merges, deploys and live writes are
always the operator's OK. Guide [`workflow-v2.md`](docs/operations/workflow-v2.md); board
[`docs/board.md`](docs/board.md); **operator's live page [`docs/decisions.md`](docs/decisions.md)**;
commit/push rules in `CLAUDE.md`.

**Press bots LIVE in the game channel** (since 2026-11-13; 9 reporter bots, `PRESS_MODE=live`, news cap
$100, `PRESS_TYPED_ANSWERS=1`, `PRESS_WIRE_REPLIES=1`, coach `PRESS_COACH_USER_IDS`). Live (migrations
0072–0078): typed answers, one thread per player, 3-reporter panels, `/gm ask|note|interview|testscrum`,
interviews + Q&A articles, Discord replies, hard lines, relationships (open war ↔ glazing; Father Rink
never feuds), bench voices from the call, free test scrums. Tasks T1–T10 in `docs/tasks/`. **E1** live
events merged (deploy = D2); **Press Box** L1 running, then L2–L4 (`/admin/press-box`).

## Current Objective / Status

**The site is live at https://boogeymen.app** (2026-10-05 ~15:15 MDT) for
teammates, by link — unlisted (`noindex` everywhere), no analytics.
Served from Hotel-Echo through the `hotel-echo-web` Cloudflare
tunnel. **The launch plan is closed** (all 8 items ✅ 2026-10-09; four green
unattended backup nights 10-06 → 10-09). Next: post-launch polish.
**All OCR work is in the sister repo** `eanhl-live-engine` (operator, 10-21).

**Member logins are live** (2026-10-09, `7b76804`): Discord-only, invite-only sign-in; the operator (Silky, player 2) is the one admin and invites teammates on `/admin/accounts`. **Live for members:** Card Locker EQUIP (own card; admin any), Discord picture in the nav, and **EDIT PROFILE** on the player page (`7aa6599`: member edits name, jersey, nationality, bio; admin also position, archetype, club role, on any player). **Admin tools are live** (`/admin`, [plan](docs/superpowers/plans/2026-10-09-admin-tools.md)): accounts, roster pins, sign-everyone-out, titles (view only), mythic cards, and the trophy case editor — **trophies/banners now live in the database** (migration 0066), not `club-awards.ts`.

**Discord poster: live to the real channel** (2026-10-24, `c41b915`): game posts + one message per card unlock (migration 0069). New-card pings live (migration 0070; IDs on `/admin` → Discord pings). Deploy `web` before `discord`; roll back both together (`:rollback-he-2026-10-24-pre-unlocks`). Off = `docker compose stop discord`. [Journal](docs/journal/2026-10.md).

**Awards trophy case is live** (2026-10-08); add trophies/banners (3s/6s/arcade) on `/admin/awards`. Awards rank ALL SKATERS totals (operator choice).

**Member-only player pages are live** (2026-10-09, `fafeefb`; rollback `:rollback-he-2026-10-09-pre-members`): only team members, present and past (EA member list for any title, member archive, pinned, AI goalies — 18 of 92) have a `/roster/[id]` page; guests 404 and show as plain text elsewhere (`PlayerLink` + `MemberLinks`), and the home carousel shows members only.

**Player cards are live** (2026-10-08): season cards (one per NHL title, from NHL 27), badges, the EDIT locker, Build Locker v2 and the Career Action Map. Spec: [`2026-10-07-player-cards-badges-design.md`](docs/superpowers/specs/2026-10-07-player-cards-badges-design.md), amended by [season cards](docs/superpowers/specs/2026-10-08-season-cards-design.md).

## Latest Verified Checkpoint

**Latest deploys 2026-11-14:** T3–T10 on Hotel-Echo (rollback tags `:rollback-he-2026-11-14-pre-*`;
backups `~/eanhl-backups/manual/eanhl-pre-00{74..78}*-2026-11-14.dump`); 03:42 backup hardening
(`backup` only; `:rollback-he-2026-11-14-pre-hardening`; lock proven live). Earlier: journal.

**2026-10-26: club-only badges** (web, worker, discord `06992a2`; rollback `:rollback-he-2026-10-26-pre-club-badges`; card dump `~/eanhl-backups/manual/cards-pre-rebase-2026-10-26-1600.dump`). Badges count club games only; NHL 27 card history reset once (`card-recompute --rebase`). [Spec](docs/superpowers/specs/2026-10-26-club-only-badges-design.md).

**2026-10-09 — member logins + admin tools deployed** (web `86a902b`, worker `3616aab`; migrations 0065 + 0066 on live/test/preview). Steps: logins `7b76804`, EQUIP `f24507f`, Discord picture `354f2da`, profile edit `7aa6599`, admin hub `7984070`, mythics `3616aab`, trophy editor `86a902b`. Rollback tags `:rollback-he-2026-10-09-pre-{logins,equip,avatar,profile-edit,admin-hub,mythics,awards-db}`; server `.env.bak-2026-10-09`; 0066 rollback = drop the two award tables. Each release operator-verified on localhost; security review clean.

**2026-10-09 responsive sizes** (`fb40008`, `:rollback-he-2026-10-09-pre-responsive`). **2026-10-08 Awards + 0064** (`d038b36`; `:rollback-he-2026-10-08-pre-awards`; 0064 rollback `DELETE … WHERE import_batch = '0064-derived-all-skaters'`).

**2026-10-08 — player cards, AI goalies, position filter deployed** (`29ee6a2`; migrations 0060–0063; rollbacks `:rollback-he-2026-10-08-pre-{cards,ai-goalies,positions}`, dumps `~/eanhl-backups/pre-*-2026-10-08-*.dump`). Lehmann / Wagner (AI goalies) and pinned Jimmy Cap are players. [Journal](docs/journal/2026-10.md), [AI goalies spec](docs/superpowers/specs/2026-10-08-ai-goalies-design.md).

**2026-10-06 — NHL 26 contamination cleaned up** (worker `3f35733`; rollback `:rollback-2026-10-05-quarantine`; dump `~/eanhl-backups/pre-quarantine-2026-10-05/`): club 19224 is "Chipstuttar" since 2026-09-07; its 172 matches are out. [Plan](docs/planning/2026-10-05-nhl26-club-19224-quarantine.md), [journal](docs/journal/2026-10.md).

**2026-10-05 — launched; security update + polish deployed** (`67ff9c4`; public checks all passed). Full checkpoint: [archive 2026-10-09](docs/archive/handoff-history-2026-10-09.md), [journal 2026-10-05](docs/journal/2026-10.md).

- Nightly backup Codex P2s (10-09): items 2–4 fixed and live 2026-11-14; item 1 (blank
  `HC_PING_URL` silences alerts) open, live has it set.
- Parked, local-only branches: `park/codex-claude-bridge`,
  `park/roster-stats-design-inputs` (real player data; not for merging).

## Essential Operational Constraints

- **Production is Hotel-Echo** since 2026-10-05 14:25 (`ssh hotel-echo`,
  Tailscale `100.98.29.119`, repo `~/eanhl-team-website`): web, worker, db
  and nightly backup (web at `6745609`, worker at `3616aab`), web and worker as the non-root
  `node` user (container logs capped at
  3 × 10 MB; worker heartbeat pinging the "eanhl collector" Healthchecks
  check via `HC_WORKER_PING_URL` in its `.env`). Its live DB holds 277 matches (449-match union minus the 172 quarantined). Older rollback images (`:rollback-he-2026-10-05-*`, `:rollback-he-2026-09-04`) and the old Hotel-Echo DB `eanhl_he_old` are kept; the main-PC fallback below.
- **Main PC = stopped fallback.** Its web, worker and backup
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
  `EANHL_PRE_PUSH_FULL=1`. The main PC has no Docker (10-21), so that suite
  cannot run; OCR changes belong in the sister repo.
- **Proton/E3 cloud backup is parked** (HE session logged out + revoked 10-05; nothing scheduled). State: the archived handoff and the [credential memo](docs/planning/proton-drive-hotel-echo-credential-design.md).
- Main-PC secrets were rotated 2026-09-03; the dead old value remains in git
  history.

## Immediate Blockers

None.

## Next 1-3 Actions

1. **D2 — deploy E1** (merged `314854ad`): Codex second opinion first (secrets + a new way in), then
   runbook §6 (`docs/operations/runbooks/live-events.md`): 0079, two `.env` secrets, `web` + `worker`,
   `tailscale serve` 3100 (no Docker port on the Tailscale address: Docker does not wait for tailscaled).
   Engine E2 sender waits for OBS-EC (engine Lead `[LEAD4]`).
2. **Press Box L1** (Lead2's task agent; screenshots to the operator before merge), then L2–L4.
3. Check the 11-15 03:00 backup (5/5); watch the next game night; small: Contribution Wheel warning,
   prettier red on 8 old files, card pace at mid-season.
