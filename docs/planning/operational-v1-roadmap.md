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

1. **Data safe.** The nightly backup
   ([`ops/nightly-backup/`](../../ops/nightly-backup/README.md)) is merged
   to `main` and its first three unattended nights are green on
   Healthchecks.io. A restore from both the local disk and Backblaze B2 was
   already tested on 2026-10-05.
2. **Correct data.** Which title is collected, which title the site shows by
   default, and the order titles are listed in become three separate
   settings (today one `is_active` flag does all three, so NHL 27 became the
   default by accident). Built on branch `feat/lpl-title-separation`
   (2026-10-04): needs review, a fresh backup, then migration 0057 on the
   live database. Proof: `/`, `/games`, `/stats` and a player page default to
   the intended title, NHL 26 is still reachable, career totals are not
   double-counted.
3. **Nothing private exposed.** Only the website goes through the tunnel
   (database and worker stay on loopback); no admin, dev or preview pages are
   reachable; error pages show no internals; search engines are told not to
   index the site (`noindex` and `robots.txt`). Proof: checks against the
   public URL.
4. **Legal pages live, no tracking.** The legal pages switch from Draft to
   Published with their final URLs, footer links work, and Cloudflare Web
   Analytics is turned off.
5. **Safety nets.** An email if no new game has been collected for too long
   or failed transforms pile up (a missed EA window loses games for good),
   and size limits on Docker's log files (the main PC's C: drive is nearly
   full). Proof: one test alert received.
6. **Looks right.** The operator checks the core pages on a phone and on a
   desktop and signs off.
7. **Open it up.** The operator approves, then: add `public` to
   `COMPOSE_PROFILES` in `.env`, start `cloudflared`, check the public URL,
   send teammates the link. Rollback: `docker compose stop cloudflared` makes
   the site private again; nothing is lost.

Order: 1 → 2 → 3, 4, 5 (any order) → 6 → 7.

## After launch (maybe — no dates)

- Proton Drive cloud backup (E3) is **parked** (2026-10-05); Backblaze B2
  covers off-site copies. Hotel-Echo still holds E3's installed tooling and a
  logged-in Proton session from 2026-09-30 testing: decide whether to log it
  out or keep it.
- Moving production from the main PC to Hotel-Echo.
- Security-header tuning, rate limits, search indexing and link previews,
  full accessibility and performance audits, a lawyer's review of the legal
  pages.
- Anything else from the archived checklist, only when there is a concrete
  reason.
