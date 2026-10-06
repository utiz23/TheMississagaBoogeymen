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

## How We Work

The operator decides; Claude Code leads; Codex is an optional second-opinion
reviewer. Process is sized to risk. One page:
[`docs/operations/agent-manager-workflow.md`](docs/operations/agent-manager-workflow.md);
commit/push rules in `CLAUDE.md`.

## Current Objective / Status

**The site is live at https://boogeymen.app** (2026-10-05 ~15:15 MDT) for
teammates, by link — unlisted (`noindex` everywhere), no analytics, no
logins. Served from Hotel-Echo through the `hotel-echo-web` Cloudflare
tunnel. Launch plan items 2–8 are done; item 1 counts three green nightly
backups on Hotel-Echo from 2026-10-06. Next: observe for a few days, then
post-launch work (rulebook rewrite, Codex review owed, video-stats OCR).

## Latest Verified Checkpoint

**2026-10-06 — performance pass on `main` (`bb466c2`..`e2b04ac`), verified
locally, NOT deployed.** No route loading screens, full link preloading,
7-day image cache, small favicon. Phone benchmark: content ~0.6 s → ~0.27 s;
preloaded taps make no network request. Web suite 358/358. Detail:
[journal 2026-10-06](docs/journal/2026-10.md).

**2026-10-05 — launched; security update + polish deployed.** Detail:
[journal 2026-10-05](docs/journal/2026-10.md).

- Evening deploy to Hotel-Echo at `67ff9c4` (web + worker rebuilt with
  `--no-deps`; db, backup, cloudflared untouched): web and worker run as
  `node`; Next 15.5.27; all 7 security headers present once; image optimizer
  200 `image/webp` and writes its cache as `node`; no `EACCES`/`EPERM`; no
  `.env*` in the web image; worker cycle succeeded for both titles, `/health`
  200, heartbeat URL set. Polish fixes live (NHL 27 zone maps, goalie rank).

- Public checks via `https://boogeymen.app`: core and legal pages 200
  (~0.5 s); `/preview/*`, `/login`, `/admin`, `/api/auth/session`, `/health`
  and unknown paths 404 (branded scoreboard 404, no internals); `www` 200;
  `http://` → 301 `https://` (Always Use HTTPS on); `X-Robots-Tag: noindex,
nofollow` and robots meta; no `X-Powered-By`, no cookies, no Cloudflare
  analytics beacon (Web Analytics RUM set to Disable).
- Same day, before launch: backups automated and moved to Hotel-Echo; NHL
  26/27 title separation (migration 0057); public-surface hardening; legal
  pages published with current facts; production moved to Hotel-Echo with a
  merged 449-match database (main PC 435 + 14 games only Hotel-Echo had);
  log caps and a collector heartbeat (test alert received); repo tidied.
- **Codex review of the nightly backup is still owed** (four tooling
  failures). To run it: check out `feat/nightly-backup`, then
  `/codex:review --wait --base 0ec6989`.
- Parked, local-only branches: `park/codex-claude-bridge`,
  `park/roster-stats-design-inputs` (real player data; not for merging).

## Essential Operational Constraints

- **Production is Hotel-Echo** since 2026-10-05 14:25 (`ssh hotel-echo`,
  Tailscale `100.98.29.119`, repo `~/eanhl-team-website`): web, worker, db
  and nightly backup on `main` at `67ff9c4`, web and worker as the non-root
  `node` user (container logs capped at
  3 × 10 MB; worker heartbeat pinging the "eanhl collector" Healthchecks
  check via `HC_WORKER_PING_URL` in its `.env`). Its live DB holds 449
  matches = both hosts' union. Rollback: images
  `:rollback-he-2026-10-05-pre-sec-polish` (web + worker at `225a4e9`; retag
  as `:latest`, `up -d --no-deps web worker`) /
  `:rollback-he-2026-10-05-pre-logs` / `:rollback-he-2026-09-04` and the old
  Hotel-Echo database kept as
  `eanhl_he_old`; the main-PC fallback below.
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
  pre-launch `.env` (still holding the old `TUNNEL_TOKEN` line) is at
  `~/eanhl-moved-aside/env-before-launch-2026-10-05` (600) — delete once the
  launch is settled. The main PC has no tunnel. Login/auth is removed.
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
  2026-10-05 (`auth-logout`, entry proven absent) and revoked by the
  operator in Proton's session settings. Nothing is scheduled. Full E3 state: the archived handoff and the
  [credential memo](docs/planning/proton-drive-hotel-echo-credential-design.md).
- Main-PC secrets were rotated 2026-09-03; the dead old value remains in git
  history.

## Immediate Blockers

None.

## Next 1-3 Actions

1. **Deploy the performance pass** (awaiting the operator's OK): rebuild
   web only on Hotel-Echo (`docker-redeploy` skill). Then check live:
   `/games/999999999` → 404; `/_next/image` sends `max-age=604800` and a
   repeat request is `x-nextjs-cache: HIT`; the 20 KB `/icon.png`; a phone
   trace of `/`, where content arrives with the first paint.
2. Polish continues from [`docs/POLISH_BACKLOG.md`](docs/POLISH_BACKLOG.md)
   (next: honest numbers — real "Updated" dates, one SV% format, readable
   time deltas). The security review is closed (journal 10-06).
3. Observe the launch: Healthchecks (backup + collector) emails, nightly
   backups (item 1 closes after three green nights), teammates' feedback.
   Run the owed Codex review of the nightly backup when Codex is available.
   Decide how video-stats OCR (main PC) writes to Hotel-Echo's database,
   over Tailscale, which means opening the database to the tailnet.
