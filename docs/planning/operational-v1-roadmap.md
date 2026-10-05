# Launch Plan

**Adopted 2026-10-05.** This replaces the 33-item Limited Public Launch gate
(2026-10-02) and the Gate 1–3 Operational V1 checklist (2026-09-02). Both were
sized for a much bigger site than one a handful of club members use. They are
archived unchanged in
[`docs/archive/operational-v1-roadmap-2026-10-05.md`](../archive/operational-v1-roadmap-2026-10-05.md).

## What "launched" means

Teammates can open `boogeymen.app`, the stats they see are right, and the
data is safe.

## The list

An item is done when its proof is written in the journal.

**Host decision (operator, 2026-10-05):** the site launches from
**Hotel-Echo**, the always-on server, not the main PC. This replaces the
2026-10-02 "launch from the main PC, move later" assumption, which had been
carried into this list without being re-asked.

1. **Data safe.** The nightly backup
   ([`ops/nightly-backup/`](../../ops/nightly-backup/README.md)) runs on the
   production host with three green unattended nights on Healthchecks.io.
   It ran on the main PC on 2026-10-05 (restores from the local disk and
   from Backblaze B2 tested) and on Hotel-Echo from 2026-10-05 14:28 (first
   run green; local copies in `~/eanhl-backups`). Count nights from 2026-10-06.
2. **Correct data.** ✅ Done 2026-10-05. Which title is collected, which
   title the site shows by default, and the order titles are listed in are now
   three separate settings (before, one `is_active` flag did all three, so
   NHL 27 became the default by accident). Migration 0057 is on the live
   database; `/`, `/games`, `/stats` and player pages default to NHL 27, NHL 26
   is still reachable, career labels run oldest→newest. Proof: journal
   2026-10-05.
3. **Nothing private exposed.** Only the website goes through the tunnel
   (database and worker stay on loopback); no admin, dev or preview pages are
   reachable; error pages show no internals; search engines are told not to
   index the site (`noindex` and `robots.txt`). Proof: checks against the
   public URL.
   _2026-10-05: code side done (preview pages gone, noindex everywhere,
   `robots.txt`, no framework header, error pages leak nothing, scoreboard
   404). Cloudflare: no CIDR routes; Published application routes are exactly
   `boogeymen.app` and `www.boogeymen.app` → `http://web:3000`, catch-all 404.
   Open: re-checking against the public URL at item 8._
4. **Legal pages live, no tracking.** The legal pages switch from Draft to
   Published with their final URLs, footer links work, and Cloudflare Web
   Analytics is turned off.
   _2026-10-05: all four pages published (`225a4e9`) after factual updates
   (indexing, analytics, logs, backups, providers); the operator owns the
   legal-review questions and they do not block. Open: the operator turns
   Cloudflare Web Analytics off (dashboard → Analytics & Logs → Web
   Analytics → boogeymen.app → Manage site); verify no beacon at item 8._
5. **Move production to Hotel-Echo.** ✅ Done 2026-10-05 (449 matches =
   both hosts' union; backup green on Hotel-Echo; journal 2026-10-05). One database holding everything: the
   main PC's (full history and video stats) plus the 14 games only Hotel-Echo
   collected (13 NHL 26 on 2026-09-07/13, 1 NHL 27 on 2026-09-17; titles
   matched by slug, not id). Hotel-Echo runs current `main`; the nightly
   backup moves there; the main PC stops collecting and serving but keeps its
   database as a fallback and keeps doing video-stats processing. Proof: match
   counts equal the union of both hosts, core pages load, the worker cycles,
   a backup run is green.
6. **Safety nets (on Hotel-Echo).** An email if no new game has been
   collected for too long or failed transforms pile up (a missed EA window
   loses games for good), and size limits on Docker's log files. Proof: one
   test alert received.
   _2026-10-05: log limits live on Hotel-Echo (3 × 10 MB per service); the
   worker heartbeat (`HC_WORKER_PING_URL`, `3b9dd32`) is deployed and waits
   with its Healthchecks check live (period 5 min, grace 20 min); a
   deliberate test failure was sent 2026-10-05 14:51. "No new games" itself
   is not alerted — gaps
   between sessions are normal; the alert fires when the collector stops
   working or transforms fail._
7. **Looks right.** The operator checks the core pages on a phone and on a
   desktop and signs off.
8. **Open it up.** The operator approves, then on Hotel-Echo: move the
   `hotel-echo-web` tunnel token from `.env` into the token file the current
   compose file expects, add `public` to `COMPOSE_PROFILES`, start
   `cloudflared`, check the public URL, send teammates the link. Rollback:
   `docker compose stop cloudflared` makes the site private again; nothing is
   lost.

Order: 1–4 (any order, 2 done) → 5 → 6 → 7 → 8.

## After launch (maybe — no dates)

- Proton Drive cloud backup (E3) is **parked** (2026-10-05); Backblaze B2
  covers off-site copies. Hotel-Echo still holds E3's installed tooling and a
  logged-in Proton session from 2026-09-30 testing — and Hotel-Echo becomes
  the internet-facing host: decide before item 8 whether to log it out.
- Video-stats processing on the main PC writing to Hotel-Echo's database
  over Tailscale (needs the database opened to the tailnet; decide when OCR
  work resumes).
- Security-header tuning, rate limits, search indexing and link previews,
  full accessibility and performance audits, a lawyer's review of the legal
  pages.
- Anything else from the archived checklist, only when there is a concrete
  reason.
