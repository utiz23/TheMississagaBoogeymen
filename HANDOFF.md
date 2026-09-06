# Handoff

## Operational V1 Terminal Roadmap — target 2026-10-01

**Approved scope, 2026-09-02.** This is the working definition of "done" for
Operational V1. It is a terminal scope for the current delivery cycle, not a
claim that the product can never receive another feature. After this gate
passes, the project moves to maintenance and separately approved enhancements.

### Terminal definition

Operational V1 is complete only when the product is:

- accurate across its current and historical team-data surfaces;
- proven end-to-end for NHL 27 while preserving the NHL 26 archive boundary;
- securely hosted under its production domain;
- usable on supported mobile and desktop sizes;
- accessible, legally documented, observable, backed up, and recoverable;
- deployed from a clean, synchronized `main` with current rollback and handoff
  instructions.

The launch/access posture (public, members-only, or mixed) must be decided by
the September 14 gate. That decision controls indexing, authentication,
analytics, cookie, and privacy requirements; it must not be left implicit.

### Gate 1 — stable source baseline by Friday, 2026-09-04

No new feature work belongs in this gate.

- [x] Implement the source-level decoder-run provenance refresh and the final
      parent-before-child lock ordering in the working tree.
- [x] Independently review the final provenance patch and its symmetric
      two-writer regression.
- [x] Run the focused concurrency, worker, database, lint-delta, formatting,
      and relevant regression checks.
- [x] Prove by mutation that removing/moving the pre-insert run lock breaks the
      symmetric concurrency gate for the intended reason.
- [x] Commit only the three provenance-fix files as one focused checkpoint —
      `765aecf`, followed by the roadmap doc `2143974`.
- [x] A later independent production read-only review found the review above
      was incomplete: the derive-from-children rule was not scoped to
      synthetic runs, mismatching 9/114 live runs. Corrected in `03b7f12`
      (`fix(db): scope decoder-run provenance refresh to synthetic runs only`)
      with new production-shaped regression coverage and a mutation check;
      see the "CORRECTED, NOT DEPLOYED" Active State entry.
- [x] Update the active handoff state with the final verification and commit.
- [x] Push through the normal pre-push verification hook; finish with clean,
      synchronized `main`.
- [x] If separately authorized, deploy worker-only and smoke-test ingestion and
      `/health`. Deployment is a separate operation, not implied by this list.
      Done 2026-09-02 — see the "DEPLOYED" Active State entry at the top of
      this file.

### Gate 2 — operational and launch readiness by 2026-09-14

#### Reliability, recovery, and visibility

- [ ] Configure automated daily PostgreSQL backups to storage independent of
      the production database host.
- [ ] Complete a restore drill into a disposable database and verify critical
      table counts and representative application reads.
- [ ] Add stale-worker alerting.
- [ ] Add visibility/alerting for accumulating
      `raw_match_payloads.transform_status='error'` rows.
- [ ] Add ingestion-gap visibility so "worker alive but capturing nothing" is
      detectable before data is lost.
- [ ] Define log retention/rotation and confirm production logs cannot exhaust
      the host disk.
- [ ] Record production rollback and disaster-recovery procedures.

#### Domain, hosting, and exposure decisions

- [ ] Select and purchase the production domain; document owner, registrar,
      renewal date, billing owner, recovery contact, and MFA status.
- [ ] Select the hosting solution and record expected monthly cost.
- [ ] Document where the Next.js web app, worker, PostgreSQL database,
      persistent storage, backups, DNS, and TLS terminate.
- [x] Decide whether the production site is public, members-only, or mixed.
      **Decided 2026-09-03: fully public, no login gate.** See the "CONTAINED"
      Active State entry.
- [x] Confirm the database port and worker health endpoint will not be exposed
      directly to the public internet. Published ports bind to loopback by
      default (`852c6d7`) and DEPLOY.md carries the verification procedure.
      **Stage D PASS (2026-09-04):** host-side (loopback-only, no IPv6
      listener, tunnel stopped), a genuine on-LAN probe, a genuine
      off-network WAN probe (IPv4 and IPv6, phone hotspot vantage — all
      timeouts, consistent with the loopback finding), the router's admin UI
      (no port-forward rule, DMZ disabled, IPv6 firewall default-deny with no
      exception), and a live read-only UPnP mapping query sourced from
      Hotel-Echo's own LAN address (no mapping for any of this gate's ports;
      one unrelated Tailscale mapping exists on a different port) all
      converge on no exposure for the three required ports. See the
      "STAGE D PASS" Active State entry for the full evidence, the scope of
      each vantage, and one documented protocol-level limitation (no generic
      IPv6 pinhole listing call exists).
- [ ] Define secret storage, environment separation, deployment mechanism,
      staging strategy, and rollback ownership.

#### Privacy, data collection, and legal drafts

- [ ] Draft the privacy policy.
- [ ] Draft the data-collection policy, explicitly covering gamertags, player
      statistics, accounts, server/IP logs, analytics, cookies, retention, and
      third-party processors actually used.
- [x] Define a data correction/deletion request and webmaster contact process.
      **Decided 2026-09-03:** requests go to
      `webmaster@boogeymen.app`; acknowledge within 7 days and resolve or
      provide a substantive response within 30 days. See the "LAUNCH POLICY +
      DOMAIN MAIL" Active State entry.
- [ ] Draft an EA/NHL non-affiliation and third-party asset/data attribution
      notice appropriate to the final hosting posture.
- [x] Decide whether analytics are needed. **Decided 2026-09-03:** no analytics
      or advertising at launch and no nonessential tracking/cookies. A consent
      banner is therefore not planned unless the implementation changes.

#### NHL 27 readiness

- [ ] Produce a per-parser NHL 27 beta compatibility matrix; do not accept
      "screens look the same" as proof.
- [ ] Capture and retain a small labeled NHL 27 benchmark.
- [ ] Decide the NHL 26/27 dual-active and cutover rules: worker polling,
      `game_titles.is_active`, title resolution, URL behavior, and what the UI
      calls "current" during overlap. **Now live, not hypothetical, as of
      2026-09-05:** NHL 27 ingestion was enabled on both hosts (see the "NHL 27
      ENABLED" Active State entry) and — as a mechanical consequence of
      `game_titles.is_active` being shared between the worker's poll filter and
      the frontend's `listGameTitles()`/title-resolver default — NHL 27 is now
      the *default* title on `/` and `/games` on any host with no `?title=`
      param, on both databases, ahead of this decision actually being made.
      This was not a frontend change made this session; it is the existing
      shared `is_active` behavior reacting to the new row. Decide explicitly
      whether that default is acceptable pre-cutover or needs a code-level fix
      (e.g. ordering `listGameTitles()`/resolving the default by something
      other than newest-active-id) before the September 14 gate.
- [ ] Verify the planned NHL 26 -> NHL 27 career-stat stitching rules before
      production cutover.

#### Product-readiness audits and decisions

- [ ] Audit the existing mobile drawer/menu; fix rather than duplicate it.
- [ ] Audit every core route at 320, 375, 390, and 768 CSS pixels plus desktop.
- [ ] Record production performance baselines for all core routes.
- [ ] Define public/private indexing rules and identify every route that must
      be excluded from search engines.
- [ ] Audit page titles and descriptions; the root metadata exists, but a
      title-only page does not satisfy the per-page description requirement.
- [ ] Decide by this date whether the externally built game-sheet frontend is
      accepted and ready for October integration. Missing this decision makes
      that integration non-blocking and deferred.
- [ ] Resolve or explicitly defer the remaining small correctness/polish
      items: opponent player-score completeness, Top Performers contrast, and
      navbar subtitle.

### Gate 3 — Operational V1 product-ready by 2026-10-01

#### Domain and hosting live

- [ ] Production domain resolves correctly.
- [ ] HTTPS is enforced and certificate renewal is automatic.
- [ ] Apex/`www` canonical redirect behavior is deliberate and tested.
- [ ] Production secrets are outside the repository and follow the documented
      storage/rotation process.
- [ ] Database and worker-management/health ports are private or explicitly
      access-controlled.
- [ ] Deployment and rollback have each been exercised from documented steps.
- [ ] Backup automation is healthy and the successful restore drill remains
      reproducible.

#### Legal surface and global footer

- [ ] Publish the privacy policy.
- [ ] Publish the data-collection policy.
- [ ] Add a global footer containing a working webmaster contact.
- [ ] Render the current copyright year automatically.
- [ ] Link privacy, data-collection, attribution/non-affiliation, and contact
      information from every normal page.
- [ ] Show cookie consent only if the deployed product uses nonessential
      cookies/tracking that require it.

#### Error handling, metadata, and discovery

- [ ] Add and verify a branded custom 404 page.
- [ ] Add and verify a useful production error/500 experience.
- [ ] Add useful page-specific titles and meta descriptions.
- [ ] Configure canonical URLs.
- [ ] Add Open Graph/social-preview metadata and a production preview image.
- [ ] Add/verify favicon and application icons.
- [ ] Configure `robots.txt` and sitemap behavior for the chosen access model.
- [ ] Ensure account, admin, diagnostic, preview, and other private routes are
      not indexed.
- [ ] Verify search-engine ownership only if public indexing is intended.

#### Mobile, browser, and accessibility gate

- [ ] Existing mobile navigation works with touch, keyboard, Escape, focus
      trapping, focus return, and route changes.
- [ ] Core routes have no horizontal page overflow, clipped controls,
      unreadable tables, or inaccessible dialogs at supported widths.
- [ ] Dense stats tables and match modules remain usable on small screens.
- [ ] Verify semantic heading order, form/control labels, visible focus,
      contrast, reduced-motion behavior, and keyboard-only navigation.
- [ ] Test current Chrome, Firefox, Safari, and mobile Safari; record any
      explicitly unsupported browser rather than silently ignoring it.
- [ ] Verify loading, empty, unavailable-data, not-found, and server-error
      states on representative routes.

#### Performance optimization run

- [ ] Run production-mode Lighthouse checks on every core route.
- [ ] Target Lighthouse Performance >= 85, Accessibility >= 95, Best
      Practices >= 95, and SEO >= 90 on public pages. Any accepted exception
      must be written down with evidence and an owner.
- [ ] Check cold load, cached load, and mobile-throttled behavior.
- [ ] Optimize oversized images, fonts, and client bundles.
- [ ] Remove avoidable client-side JavaScript and obvious request waterfalls.
- [ ] Inspect slow database queries and prove core pages avoid obvious N+1
      behavior.
- [ ] Confirm no serious Core Web Vitals regression on launch candidates.

#### Security and operational hardening

- [ ] Configure and verify appropriate CSP, HSTS, frame-ancestor/frame
      protection, MIME-sniffing protection, and referrer-policy headers.
- [ ] Review production access control for account, admin, diagnostic, and
      preview routes.
- [ ] Rate-limit authentication, access-request, contact, and public API
      surfaces where applicable.
- [ ] Run a dependency/security audit and resolve critical findings or record a
      signed-off exception.
- [ ] Enable uptime and application-error monitoring with a tested notification
      destination.
- [ ] Run a broken-link and missing-asset scan.
- [x] Configure a working domain-based webmaster address such as
      `webmaster@<production-domain>`. `webmaster@boogeymen.app` was proven in
      both sending and receiving directions on 2026-09-03; see the "LAUNCH
      POLICY + DOMAIN MAIL" Active State entry.

#### NHL 27 and core-product release gate

- [ ] Configure the NHL 27 title/cutover behavior decided at the September 14
      gate.
- [ ] Prove at least one real NHL 27 match end-to-end: API ingest, association,
      OCR processing, review/canonical boundary, and website presentation.
- [ ] Smoke-test `/`, `/games`, representative game detail pages, `/roster`, a
      representative player profile, and `/stats` in production.
- [ ] Verify NHL 26 remains accessible as history and career totals cross the
      NHL 26/27 boundary without source conflation.
- [ ] Import the historical club/team review queue or close it with an exact,
      documented remainder and rationale.
- [ ] Integrate the external game-sheet frontend only if it passed the
      September 14 acceptance decision; otherwise record it as deferred.
- [ ] Complete final content/proofreading and verify contact/policy links.
- [ ] Finish with clean, pushed, deployed `main`, current `HANDOFF.md`, known
      image/commit identifiers, rollback criteria, and a 48-hour post-launch
      monitoring plan.

### Explicit non-goals for Operational V1

The following do **not** block October 1 unless the operator explicitly changes
the terminal scope:

- the 22 unauthorized/blocked rescue windows;
- faceoff-map ROI/OCR remediation;
- chemistry heatmap and speculative advanced analytics;
- player locker/build-history and card-progression features;
- public request-access/auth expansion beyond the access posture selected for
  launch;
- shot-location features without a trustworthy source;
- the external game-sheet redesign if it misses the September 14 acceptance
  gate.

### Completion rule

"Code complete" is not Operational V1 complete. The October 1 gate passes only
when every required checkbox above is either checked with evidence or explicitly
waived by the operator with a written reason, owner, and follow-up date. A
blocked non-goal stays documented and blocked; it is not silently promoted into
launch scope and it is not allowed to hold the terminal gate hostage.

## Active State

### 🟡 BACKUP PRODUCER + DESTINATION ACCEPTANCE VERIFIED IN ISOLATION — NOT ACTIVATED, NOT DEPLOYED (2026-09-05)

Source-only checkpoint for the Gate 2 backup work. Two components exist and are
verified against real temporary filesystems: the **producer** (snapshot, dump,
validate, encrypt, bounded staging, run lock) and the **destination acceptor**
(the thing that decides, at the receiving end, whether an artifact that arrived
is real). Nothing was installed, scheduled, deployed, or executed against
production. **The Gate 2 backup and restore-drill items above stay unchecked.**

**Four acceptance boundaries were found wrong in review and corrected.** All
four shared one root cause: a fact established about a _path_, or about a
_moment_, was later relied on as a fact about the _object actually used_.

| Boundary                     | Corrected behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Descriptor-bound copying** | Each inbox source is opened once `O_NOFOLLOW`; all payload bytes are read only from the held descriptor, and type and size come from `fstat`. The path is deliberately re-resolved after the open to re-prove containment and to compare the resolved path's device+inode against the descriptor. `O_NOFOLLOW` atomically refuses a final-component symlink; ancestor resolution remains a documented non-atomic limitation bounded by deployment. |
| **Per-role size ceilings**   | Enforced at `open`, by a running byte count _during_ the copy that stops before writing the breaching byte, and again on the finished work copy before any parse or hash. Previously read once from a pre-copy `lstat` and never re-checked, so a swapped-in larger triple was accepted.                                                                                                                                                           |
| **Receipt before mutation**  | Any existing receipt is inspected _before_ the archive is touched. A receipt whose archive is missing or does not verify is `rejected_archive_damaged` regardless of how many archive files remain — it no longer publishes conflicting bytes first and objects afterwards.                                                                                                                                                                        |
| **Capacity reservation**     | Work capacity reserves the sum of the **configured role ceilings** before any inbox byte is read (inbox `lstat` sizes bound nothing, since the source is mutable). Archive capacity reserves the **actual trusted work-copy bytes** immediately before publication.                                                                                                                                                                                |

**Verification (this tree, independent run root `/tmp/eanhl-backup-suite-Qsirdh`):**

- Acceptance suite **56/56**.
- Complete backup suite **165/165** — `backup-config` 15, `backup-producer` 54,
  `backup-boundaries` 9, `backup-acceptance` 56, `backup-lifecycle` 31.
- The `Qsirdh` run was executed directly as `node ops/backup/run-suite.mjs`.
  `pnpm test:backup-producer` is a script alias exposing that same command. No
  network, no database, no Docker, no key material.

The suite establishes what an operator would find on disk — which files exist,
what the receipt says, which outcome came back, whether the archive changed,
whether anything in the inbox was read. It establishes **nothing about a real
deployment**.

**Remaining filesystem and deployment assumptions — all unproven, because none
of the deployment exists yet:**

- The transport key can write **only** the inbox, and cannot write archive,
  receipts, work or quarantine. Enforced here only as _configuration_ refusal;
  the real uid/gid, mode and restricted `authorized_keys` entries are unverified.
- The inbox's **parent** is not writable by the transport identity. This is what
  makes the residual ancestor-symlink window small; Node exposes no
  `openat`/`O_PATH`, so that window is closed by deployment, not by code.
- `st_dev`/`st_ino` are stable and truthful on the destination volume (true on
  ext4, unverified elsewhere). A filesystem reporting them inconsistently fails
  loudly; one reporting them as constant zero fails silently.
- Hard links inside the inbox to files elsewhere on the same device would pass
  containment. Bounded by the transport-key restriction, not by this component.
- The destination filesystem preserves the modes the acceptor sets (`0700`
  dirs, `0600`/`0644` files); `rename()` atomicity is **not** assumed anywhere.
- A single declared `capacity.backingVolume` describes the volume beneath both
  `work.dir` and `archive.dir`; `receipts.dir` free space is not measured.
- Producer side: `age` is still not installed on either host, no keypair exists,
  and **no artifact has ever been decrypted**. Acceptance verifies integrity and
  binding, not decryptability. Only the Phase 2 restore drill proves recovery.

**NOT ACTIVATED, NOT DEPLOYED.** There is no transport, no timer, no systemd
unit, no CLI entry point for the acceptor, no inbox on any host, and no artifact
has ever been produced or accepted. Only the tests call the sweep. Also not
started: producer-side receipt consumption, the freshness evaluator, alerting,
pruning, the weekly re-hash sweep, and the restore-drill runner. No key-custody
decision, production activation, recovery target or cutover is approved by this
work.

**Transport is deliberately out of scope and remains a later, separately scoped
session.** Do not treat this checkpoint as authorization to start it.

Detail: [`docs/operations/backup-producer.md`](docs/operations/backup-producer.md)
and [`docs/operations/backup-acceptance.md`](docs/operations/backup-acceptance.md).
Both documents are reconciled against the tree as it stands: the acceptance
doc's §4.1/§4.2 counts read `56/56` and `165/165`, §4.1 attributes twelve tests
to the two review correction passes (five descriptor/ceiling/receipt, seven
capacity), §4.4 records the capacity pass as its own labelled correction, and
the descriptor description in §2.2/§4.4, in `backup-acceptance.mjs` and in the
table above states the same thing: opened once `O_NOFOLLOW`, payload bytes read
only from the held descriptor, type and size from `fstat`, the path re-resolved
after the open to re-prove containment by device+inode, and ancestor resolution
still non-atomic. Wall-clock timings were removed as non-evidence.

### 🟢 NHL 27 ENABLED — ingestion live on both hosts, NHL 26 preserved; site-default side effect flagged, not fixed (2026-09-05)

Scoped ingestion session. Enabled NHL 27 match collection (club #1650, "The
Boogeymen", platform `common-gen5`) on both the main host and Hotel-Echo by
seeding a new `nhl27` `game_titles` row and activating it — no worker rebuild,
no worker restart, no web deploy, no commit/push. `nhl26` was left completely
untouched on both hosts (row and data).

**Baseline recorded before any change:**

| Host        | `nhl26` id | `nhl26` matches (gameType5/10/club_private) | notes                        |
| ----------- | ---------- | -------------------------------------------- | ----------------------------- |
| main        | 1          | 134 / 65 / 5 = 204 total, all `transform_status=success` | active, club 19224, launched 2025-10-01 |
| Hotel-Echo  | 4          | 0 / 0 / 0                                     | active, club 19224, fresh DB per Stage B/C — no historical matches, as expected |

Title numeric IDs already differed across hosts before this session (main's
`nhl26`=1, Hotel-Echo's `nhl26`=4) — confirms the existing "resolve by slug,
never by id" rule is load-bearing, not theoretical.

**Raw capture preserved (durable, in-repo):**
`research/ea-api/nhl27-club1650/matches-gametype5-2026-09-04.json`
(sha256 `4bf8490f24f709166e9c4059b8c018869ec06be5dab3b6669cad5c582e864b2a`,
50413 bytes; not committed during this session — subsequently committed at
`86afbfe` ("feat(db): add guarded NHL 27 title seed"), see the checkpoint
note below). Source:
`https://proclubs.ea.com/api/nhl/clubs/matches?clubIds=1650&platform=common-gen5&matchType=gameType5`.
Host `curl` got HTTP 403 (missing EA's required spoofed headers); re-fetched
from inside the `worker` container using `packages/ea-client`'s existing
header set — HTTP 200, byte-identical to the original `/tmp` capture handed
off at session start, confirming EA's recent-match window still held the same
4 matches at re-check time (2026-09-04 20:34 local, ~7 min after the original
20:27 capture). No fixture/reprocess fallback was needed — normal polling
picked up all 4 matches live (see below).

**Configuration applied — new file, idempotent, guarded:**
`packages/db/seed/game_titles_nhl27.sql` (not committed during this session
— subsequently committed at `86afbfe`, see the checkpoint note below). A `DO`
block that resolves purely by `slug='nhl27'`: inserts the row if absent
(`ea_platform='common-gen5'`, `ea_club_id='1650'`,
`api_base_url='https://proclubs.ea.com/api/nhl'`, `is_active=true`,
`launched_at=NULL` — **no launch date invented**, matching the still-open Gate
2 decision above); if a `nhl27` row already exists with matching
club/platform/base-URL it activates it (no-op if already active); if one
exists with a *different* club/platform/base-URL it `RAISE EXCEPTION`s instead
of overwriting. Verified idempotent by re-running it immediately after first
apply on both hosts (second run: no-op, no error). Applied via
`docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl < packages/db/seed/game_titles_nhl27.sql`
on main, and the same file copied over the existing Tailscale SSH session and
applied identically on Hotel-Echo. Result: main `nhl27` id=7, Hotel-Echo
`nhl27` id=5 — different ids, as expected; both `is_active=true`,
`launched_at=NULL`.

**No worker rebuild or restart on either host.** `ingest.ts` re-queries
`WHERE is_active=true` every cycle with no caching, so the next scheduled poll
(≤5 min later, `POLL_INTERVAL_MS` default) picked up `nhl27` automatically.
Confirmed via `docker inspect`: both `worker` containers show
`RestartCount=0` with `StartedAt` predating this session (main since
2026-09-03T23:03Z, Hotel-Echo since 2026-09-04T23:17Z) — the containers were
never touched.

**Transform-path compatibility verified offline first, no DB writes:** replayed
the built `transformMatch()` (from `apps/worker/dist/transform.js`, pure
function, `DATABASE_URL` set to a deliberately non-resolving dummy value since
the module's DB client import throws without one but never actually connects
for a pure call) against all 4 captured payloads. All 4 transformed cleanly:

| `ea_match_id` | opponent | result | score | `game_mode` (from `cNhlOnlineGameType`) |
| --- | --- | --- | --- | --- |
| 158709960284 | East West Beatdown (3034) | LOSS | 2-4 | `6s` (5) |
| 160255970075 | Ottawa Blue Cats (8963) | LOSS | 2-4 | `6s` (5) |
| 152899960345 | Baddest Mother Puckers (759) | LOSS | 0-6 | `3s` (200) |
| 154709210467 | **"7641"** (club 7641) | WIN | 4-1 | `3s` (200) |

Confirms the task's warning that game mode must not be inferred from the
endpoint's `matchType` param — all 4 came from the same `gameType5` endpoint
call, but split 2×`6s`/2×`3s` correctly via the existing
`deriveGameMode(cNhlOnlineGameType)` logic, no code change needed.

**Known, real data gap — not a defect, not fixed this session:** match
`154709210467`'s opponent (club 7641) has `clubs["7641"].details = null` in
the raw payload and no top-level `name` field either, so
`transform.ts`'s existing fallback chain
(`opponentDetails.name → opponentClub.name → opponentClubId`) resolves
`opponent_name` to the literal string `"7641"` instead of a human club name.
The transform does **not** crash (the `clubs` key itself is present, just its
`details` is null) — this is a pre-existing, already-defensive code path
doing exactly what it was written to do; NHL 27 just exercised it for the
first time. No display fix was made (frontend work is out of scope this
session). Also notable, not a defect: this same match's `result` code is
`16385` ("WIN by opponent forfeit" per the code's own comment) with
`winnerByDnf=1`, yet the score (4-1) is a genuine-looking scoreline — the
existing `deriveResult()` correctly returns `WIN` either way (score-derived
and code-derived agree here), so no discrepancy reached the DB.

**Live ingestion, both hosts, first cycle after activation:**

| Host | cycle start (UTC) | `gameType5` found/new/failed | `gameType10` | `club_private` |
| --- | --- | --- | --- | --- |
| Hotel-Echo | 02:37:15 | 4 / 4 / 0 | 0/0/0 | 0/0/0 |
| main | 02:40:33 | 4 / 4 / 0 | 0/0/0 | 0/0/0 |

`gameType10` and `club_private` returning empty on both hosts matches the
task's own finding; not investigated further as it wasn't in scope. All 4
`matches` rows landed on **both** hosts with the exact scores/opponents/results
specified, `raw_match_payloads.transform_status='success'` for all 4 on both,
zero `transform_error`. Per-match player counts (`player_match_stats` /
`opponent_player_match_stats`) matched the offline pure-function replay
exactly: 5/4, 5/3, 3/3, 3/2 across the 4 matches, both hosts. `club_game_title_stats`
recomputed for `nhl27` in the same null/`3s`/`6s` shape as `nhl26`
(1W-3L overall as of this snapshot) — no aggregate code needed changes.

**Idempotency + live proof of ongoing polling, second cycle:** Hotel-Echo's
next cycle (02:42:15) showed `gameType5` found=4/new=0/failed=0 — no
duplicates. Main's next cycle (02:45:40) showed found=5/new=**1**/failed=0: a
genuinely new 5th match, `172208220110` (3-2 WIN vs Milwaukee B33rs, club 389,
played 2026-09-05 02:42:55), had appeared in EA's live window between the two
polls and was ingested and transformed cleanly with no manual intervention —
real end-to-end proof the polling pipeline works for NHL 27 going forward, not
just for the 4 backfilled matches. Confirmed zero rows with a duplicate
`(game_title_id, ea_match_id)` across `nhl26`+`nhl27` combined on main.

**NHL 26 confirmed unchanged, both hosts, after all of the above:** main still
exactly 204 matches (134/65/5 split unchanged); Hotel-Echo still 0 matches.
The `nhl26` row itself (id, `ea_club_id=19224`, `is_active=true`,
`launched_at=2025-10-01`) is byte-identical to the pre-session baseline on
both hosts. `/health` on both hosts returns `{"status":"ok", ...}` throughout,
`secondsSinceLastIngest` low, consistent with normal 5-minute polling — no
stale/degraded state introduced.

**Consequential side effect found, flagged, deliberately NOT fixed (out of
scope — "do not silently expand into frontend work"):**
`packages/db/src/queries/game-titles.ts`'s `listGameTitles()` returns all
`is_active=true` titles ordered `desc(id)`, and both
`apps/web/src/lib/title-resolver.ts` and the homepage/`games` page
(`apps/web/src/app/page.tsx`, `apps/web/src/app/games/page.tsx`) fall back to
`all[0]` as the default title whenever no `?title=` slug is present.
`nhl27`'s id is higher than `nhl26`'s **on both hosts** (7 > 1 on main, 5 > 4
on Hotel-Echo), so as of this change **NHL 27 is now the default title shown
on `/` and `/games`** wherever no explicit `?title=nhl26` is passed, on both
databases — a real, live, unrequested-this-session change to site defaults,
purely mechanical from `is_active` being shared between the worker's poll
filter and the frontend's default-resolution logic.
`components/nav/game-title-switcher.tsx`'s doc-comment ("in practice only the
one-title branch renders today") is now stale on both hosts too — the
multi-title wrapping-pill branch will render instead. Practical exposure is
low right now (Stage D confirmed loopback-only ports, no tunnel, on both
hosts — see the "STAGE D PASS" entry below), but this is a genuine pre-cutover
default change, not a hypothetical one, and it directly overlaps the still-open
Gate 2 item above. **No frontend or query code was changed to address this** —
flagging it is this session's whole obligation here; deciding/fixing it is
explicitly out of scope ("Archiving NHL 26 and changing website defaults are
separate work").

**Rollback (stops NHL 27 polling and reverts the site default; deletes
nothing):**

```bash
docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl \
  -c "UPDATE game_titles SET is_active = false WHERE slug = 'nhl27';"
```

Run on either/both hosts as needed. This does not delete `matches`,
`raw_match_payloads`, `player_match_stats`, `opponent_player_match_stats`, or
`club_game_title_stats` rows already ingested for `nhl27` — they stay in place
for later reactivation. The next worker cycle stops polling `nhl27`
(`ingest.ts`'s `WHERE is_active=true` filter excludes it again), and
`listGameTitles()` reverts to `nhl26`-only, restoring the pre-session default
and the single-title switcher branch. The preserved raw capture under
`research/ea-api/nhl27-club1650/` and the seed file
`packages/db/seed/game_titles_nhl27.sql` are untouched by rollback.

**Remaining limitations, reported honestly:** only 5 NHL 27 matches exist in
either database as of this entry — a real backfill/compatibility gap, not
closed by this session (a genuine "per-parser NHL 27 beta compatibility
matrix" per the Gate 2 checklist above is still open — this session verified
the *match/player/aggregate* transform path only, not OCR/game-sheet parsers,
which never ran against NHL 27 footage). The opponent-name-as-clubId gap for
matches against clubs with `details=null` is real and will recur for any
future opponent EA doesn't return details for. Neither host's web app was
redeployed or restarted this session; the default-title side effect above is
already live on whatever `web` build is currently running on each host purely
because it reads `game_titles` at request time.

**Checkpoint note (2026-09-06):** the seed file and raw capture above were
untracked for the duration of the original activation session (nothing was
committed or pushed then — this remains historically accurate). They were
subsequently committed, unmodified, in a separate narrowly-scoped checkpoint
session as `86afbfe` ("feat(db): add guarded NHL 27 title seed"). The
recorded sha256 above is unchanged and was reverified byte-identical against
the committed blob before that commit was made.

### 🟢 STAGE D PASS — host, LAN, external WAN, and router evidence all converge on no exposure (2026-09-04, updated)

Read-only network verification session against Hotel-Echo, over Tailscale SSH
(`utiz@100.98.29.119`, repo at `~/eanhl-team-website`), plus a genuine LAN
vantage found via WSL interop on this session's own host. **Nothing was
deployed, restarted, rebuilt, migrated, or rotated; no router/firewall
setting was touched; the tunnel was not started.** The only repository
change is this file. Scope was strictly the Gate 2 port-exposure checkbox —
the on-host / LAN / WAN / router verification that Stage C explicitly left
open.

**Host identity — reconfirmed a second time this session, unchanged:**

| item         | value                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| host `HEAD`  | `00742e4b5578b21ce205eda71ca2350808fe1147` (matches Stage C)                                                            |
| working tree | clean                                                                                                                   |
| LAN address  | `192.168.1.107` on `enp3s0` — still current                                                                             |
| WAN IPv4     | `104.205.57.177` (via `curl -4 ifconfig.me`/`icanhazip.com` from the host)                                              |
| Global IPv6  | `2001:56a:78c6:e00:96de:80ff:fe6c:e23a/64`, `scope global dynamic` on `enp3s0` — genuinely routable, not link-local/ULA |

**Step 1 — host bindings (independent, completed, reconfirmed twice):**

```
ss -tlnp | grep -E ':(3000|3001|5433)\b'
  127.0.0.1:5433   127.0.0.1:3001   127.0.0.1:3000     # no 0.0.0.0, no [::], no wildcard
docker compose ps --format 'table {{.Service}}\t{{.Ports}}'
  db      127.0.0.1:5433->5432/tcp
  web     127.0.0.1:3000->3000/tcp
  worker  127.0.0.1:3001->3001/tcp
```

All three published ports bind to IPv4 loopback only. `ss` shows no listener
at all on the global IPv6 address for these ports. **This proves the host
does not listen on IPv6 — it does not by itself prove the router's IPv6
inbound policy is closed**, since IPv6 typically bypasses NAT; the router's
IPv6 firewall posture is still separately required (see Step 5/6 below).

**Tunnel — reconfirmed stopped, identical to Stage C:** no `cloudflared`
container in any state (`docker ps -a`), no process (`pgrep -a` rc 1), no
outbound `:7844`, `./secrets/` absent, `docker compose config --services` →
`db`/`web`/`worker` only, `--profile public` additionally lists `cloudflared`
(profile gate confirmed working, not engaged).

**Step 2 — genuine LAN test: DONE, clean.** The prior session's blocker
(Sierra-November's only visible interface being its 172.x WSL2 NAT address)
was resolved, not accepted: WSL interop (`powershell.exe`/`ipconfig.exe`
called directly from the WSL shell) reached Sierra-November's underlying
**Windows host**, which has its own physical Ethernet adapter
(`Ethernet 3`, `192.168.1.83/24`, gateway `192.168.1.254`) — genuinely on
Hotel-Echo's `192.168.1.0/24` segment, confirmed with
`Find-NetRoute -RemoteIPAddress 192.168.1.107` returning an on-link route via
that adapter (`NextHop 0.0.0.0`, `InterfaceAlias Ethernet 3`), not through the
WSL NAT gateway and not through the host's active ProtonVPN WireGuard tunnel
(a separate `10.2.0.2` interface with its own default route at a much lower
priority for this destination). The WSL 172.x address was a red herring, not
proof of an invalid vantage — the physical host underneath it was on-LAN the
whole time.

Bounded TCP connect probes (3s timeout each, `System.Net.Sockets.TcpClient`,
async connect/wait so a non-response can't hang) from that interface:

| Timestamp (UTC)     | Source                                                    | Target        | Port | Family | Outcome                   |
| ------------------- | --------------------------------------------------------- | ------------- | ---- | ------ | ------------------------- |
| 2026-09-04 23:47:47 | Sierra-November physical LAN (192.168.1.83, `Ethernet 3`) | 192.168.1.107 | 3000 | IPv4   | timeout/filtered (3112ms) |
| 2026-09-04 23:47:47 | same                                                      | 192.168.1.107 | 3001 | IPv4   | timeout/filtered (3001ms) |
| 2026-09-04 23:47:47 | same                                                      | 192.168.1.107 | 5433 | IPv4   | timeout/filtered (3000ms) |

All three timed out rather than refused — consistent with Docker's loopback
binding (no listener reachable on the LAN interface at all, so nothing sends
a RST) and with Step 1's independent host-side evidence. Timeout is recorded
as timeout, not asserted as "refused" — a distinct outcome per this task's
evidence rules; it does not by itself distinguish a filtered port from a
silently-dropped one, but it matches the expected behavior for a loopback-only
bind exactly, and corroborates Step 1 from an entirely independent host and
interface.

**Step 3-4 — WAN test (IPv4 and IPv6): DONE, genuinely off-network, both
address families probed, all timeouts.** Sierra-November's Windows host was
correctly excluded from this role (same-premises NAT hairpin/loopback, plus
an active ProtonVPN tunnel that would have made any result ambiguous). The
operator ran the requested commands from a MacBook tethered to an iPhone
Personal Hotspot, Wi-Fi/VPN/Tailscale off on both devices, timestamps
2026-09-05T00:10Z–00:13Z UTC (2026-09-04 evening, MDT local — the same
calendar day as this Stage D session's host-side WAN/IPv6 address capture
above; there is no staleness gap between when the addresses were read from
the host and when they were probed from off-network).

**Vantage confirmed genuinely external:** default route via `en0` →
`172.20.10.1` (iPhone hotspot `/28`), no VPN/utun carrying the default
route, ProtonVPN inactive. Source public addresses (3 independent echo
services agreed): IPv4 `24.114.24.4` (Rogers Communications, wireless
block), IPv6 `2605:8d80:5b40:ef1:43f:6970:8e5d:1799` (Rogers). Neither
matches Hotel-Echo's `104.205.57.177` (TELUS) or IPv6 prefix (also TELUS) —
confirmed off-net, not a loopback artifact.

**Controls, both passed:** outbound IPv4 TCP works from the hotspot
(`1.1.1.1:443` succeeded <1s — carrier does not block outbound); IPv6 is
live end-to-end on the hotspot (external echo matched the interface's own
global address, `nc -6 -z 2606:4700:4700::1111 443` succeeded <1s). The
vantage point is sound for both families.

**Probe results — all 7 timed out, zero refusals, zero unreachables:**

| Target                                  | Port | Outcome                          |
| --------------------------------------- | ---- | -------------------------------- |
| `104.205.57.177` (IPv4)                 | 3000 | timed out (5s, and again at 12s) |
| `104.205.57.177` (IPv4)                 | 3001 | timed out (5s)                   |
| `104.205.57.177` (IPv4)                 | 5433 | timed out (5s)                   |
| `2001:56a:78c6:e00:96de:80ff:fe6c:e23a` | 3000 | timed out (5s)                   |
| `2001:56a:78c6:e00:96de:80ff:fe6c:e23a` | 3001 | timed out (5s)                   |
| `2001:56a:78c6:e00:96de:80ff:fe6c:e23a` | 5433 | timed out (5s)                   |

Supplementary controls on the IPv4 target: ports 22/80/443 also all timed
out (5s each — no port on the host answered anything); ICMP echo 0/3
received; ICMPv6 echo 0/3 received; IPv4 traceroute reached TELUS's backbone
(~hop 11–13) then went silent to hop 15; IPv6 traceroute reached TELUS's v6
backbone (hop 9) then likewise silent.

**What this establishes and does not.** The vantage is valid and external,
both IP families work outbound from it, and packets route correctly into
TELUS's network on both — but every probe against both destination
addresses, on every port tested including 22/80/443, came back as a silent
timeout, never a refusal (RST) and never an unreachable. Per this task's
evidence rules, a timeout is recorded as a timeout: it does not by itself
distinguish a router DROP rule, a powered-off/non-listening host, or a
stale address (WAN IP rotation or IPv6 `/64` re-delegation) from one
another, and it is not treated here as proof of a down server, a stale
address, or any specific filtering location. It is consistent with — and
does not contradict — Step 1/2's independent host-side and LAN findings
that nothing listens on any non-loopback interface for these ports.

Address freshness itself is not in question: the WAN IPv4 and IPv6 values
probed here are the same ones captured directly from the host earlier in
this same Stage D session, on the same calendar day. There is no year-scale
gap to account for.

**Step 5 — router port-forward/DMZ/UPnP/IPv6-policy inspection: DONE.**
Operator supplied read-only screenshots of the router admin UI (TELUS/
Arcadyan gateway, `192.168.1.254`), plus this session independently queried
the router's live UPnP IGD API for a live cross-check — see below.

**Address match, confirmed from the router's own connected-devices table:**
`hotel-echo` / `192.168.1.107` / MAC `94:DE:80:6C:E2:3A`, IPv6 GUA
`2001:56a:78c6:e00:96de:80ff:fe6c:e23a` — identical to every address used in
Steps 1-4 above (the IPv6 host portion `96de:80ff:fe6c:e23a` is the EUI-64
form of that exact MAC). No ambiguity about which device was tested.

**Admin UI findings:**

| Check                 | Result                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Port forwarding table | Empty — "No any Port-Forwarding Rule" (max limit 32, 0 used)                                                                                                                                                       |
| DMZ                   | Disabled — `DMZ Function` unchecked, no client IP configured                                                                                                                                                       |
| UPnP                  | **Service enabled** (`UPnP function` checked) — the admin page shows only the on/off toggle, not a live mapping list, so it cannot by itself confirm whether any mapping currently exists                          |
| IPv6 firewall         | `Firewall features: High` — every listed service's `Traffic IN` box unchecked, **including `All Other Ports`**; only `Traffic OUT` is checked throughout — a default-deny inbound policy with no visible exception |

**Live UPnP API cross-check (this session, read-only, no settings
changed):** the admin UI's UPnP page only shows the feature toggle, not
active mappings, so — per the operator's ask to try enumerating mappings
read-only from the already-verified physical LAN vantage (Sierra-November's
`Ethernet 3`, `192.168.1.83`, the same interface used for Step 2) — this
session ran SSDP discovery (`M-SEARCH`) and queried the discovered IGD
directly:

- Router identifies itself as `Arcadyan`/`Telus` running `MiniUPnPd`
  (`urn:schemas-upnp-org:device:InternetGatewayDevice:2`), UPnP control
  endpoint `http://192.168.1.254:33073/`. The router's own `rootDesc.xml`
  and the `WANIPCn.xml` SCPD were fetched and checked against the calls
  below: service type `urn:schemas-upnp-org:service:WANIPConnection:2`,
  control URL `/ctl/IPConn`, action name `GetGenericPortMappingEntry`, and
  its `NewPortMappingIndex` input argument all match the router's
  advertised contract exactly.
- **Re-verified this session (2026-09-04), correcting a prior evidence
  gap:** the earlier write-up described `GetGenericPortMappingEntry`
  (read-only SOAP `POST` — not a `GET`; UPnP SOAP calls are always POSTs,
  see the correction below) at index `0` as returning "HTTP 500, empty
  body." That description was wrong. The original script did capture the
  fault body correctly (via `GetResponseStream`), and re-running the same
  call with a lower-level `HttpWebRequest` that logs the raw status line,
  `Content-Length` header, and raw byte count shows the response is **410
  bytes, not empty**: a well-formed SOAP `Fault` with UPnP `errorCode 713`
  / `errorDescription SpecifiedArrayIndexInvalid`. That is the standard IGD
  signal for "no entry at this index" — for a table queried from index 0
  upward, a fault at index 0 means the table has zero entries — but it is
  an inference from an error code, not a direct list, so it was
  independently cross-checked with a second, non-fault-based call:
  `GetListOfPortMappings` (also part of `WANIPConnection:2`, confirmed
  present in the SCPD) was queried for the full port range (0-65535),
  `Manage=1`, separately for `TCP` and for `UDP`, from the LAN vantage
  (`192.168.1.83`, a machine other than Hotel-Echo). Both returned
  `HTTP 200` with an explicitly empty `<p:PortMappingList>` element — a
  direct listing from that vantage, not an error-code inference. **This
  does not by itself establish unrestricted, router-wide visibility**:
  `WANIPConnection:2` §2.5.21.3 permits the service to filter
  `GetGenericPortMappingEntry`/`GetListOfPortMappings` results by
  requesting client, `NewManage` does not override that access control,
  and the absence of an ACL-scoped argument in the SCPD does not prove no
  such filtering exists server-side — the SCPD documents argument shapes,
  not the server's internal authorization logic. A same-session
  `GetExternalIPAddress` call on the same service returned `HTTP 200` with
  the expected WAN IPv4 (`104.205.57.177`, matching Step 4's
  independently-captured address), confirming the service itself responds
  normally to non-fault calls and the 500/713 result is specific to the
  empty-table condition (from that vantage), not a broken transport or
  malformed request.
- **Hotel-Echo-origin mapping check (this session, 2026-09-04, read-only,
  no settings changed) — the narrowly-scoped follow-up to the filtering
  concern above.** The same enumeration was repeated a second time, now
  sourced directly from Hotel-Echo itself over the existing Tailscale SSH
  session, to see whatever the router is willing to show the exact device
  in question rather than a different LAN host. Source route/address
  confirmed with `ip route get 192.168.1.254` → `dev enp3s0 src
  192.168.1.107` (Hotel-Echo's physical LAN interface, not `docker0`,
  `br-*`, or `tailscale0`); `curl --interface enp3s0` was used for every
  call to pin the same source. Same actions, same full port range:
  - `GetGenericPortMappingEntry` index `0`: **`HTTP 200`** (not a fault
    from this vantage) — `NewExternalPort 6272`, `NewProtocol UDP`,
    `NewInternalPort 41641`, `NewInternalClient 192.168.1.107`,
    `NewEnabled 1`, `NewPortMappingDescription tailscale-portmap`,
    `NewLeaseDuration 7184`.
  - `GetListOfPortMappings`, port range `0`-`65535`, `NewManage=1`, `TCP`:
    `HTTP 200`, empty `<p:PortMappingList>` — no TCP mapping of any kind,
    any port, visible from this vantage.
  - `GetListOfPortMappings`, same range, `NewManage=1`, `UDP`: `HTTP 200`,
    `<p:PortMappingList>` containing exactly the one entry above
    (`6272`→`41641/UDP`, `tailscale-portmap`) and nothing else.
  - `GetExternalIPAddress`: `HTTP 200`, `104.205.57.177` — same WAN
    address as every other vantage this task has captured.

  **This confirms the filtering concern was correct** — the router does
  show Hotel-Echo a mapping (the one above) that a different LAN host's
  query did not surface, so visibility is genuinely client-scoped here,
  not merely SCPD-silent. **It also directly answers the question Gate 2
  cares about**: across the full TCP and UDP port range, as seen from
  Hotel-Echo's own vantage — the strictest and most relevant vantage
  available for "is Hotel-Echo's traffic being forwarded" — the only
  mapping that exists is UDP `6272`→`41641`, described by the router
  itself as `tailscale-portmap`. That is Tailscale's own outbound
  NAT-traversal mapping for the Tailscale client already running on this
  host (the same client this SSH session runs over); it is not one of
  this task's three ports (`3000`/`3001`/`5433`), is not attacker-created,
  and its existence is expected background behavior of a Tailscale node
  behind NAT, not a Gate 2 concern. No mapping exists for `3000`, `3001`,
  or `5433`, TCP or UDP, from either vantage tested.
- `GetFirewallStatus` (read-only) against `WANIPv6FirewallControl:1`
  returned `FirewallEnabled=1`, `InboundPinholeAllowed=1`. These are
  capability flags (the IPv6 firewall is on; the API is _permitted_ to
  open inbound pinholes if asked), not a report of any pinhole actually
  existing — the UPnP IGD spec has no generic "list all active pinholes"
  call, only a `CheckPinholeWorking` lookup keyed by a pinhole's own
  `UniqueID`, which is only known if one was created and recorded. This is
  a protocol-level ceiling, not a skipped check: the value here is
  corroborating the admin UI's independent finding (default-deny, no
  configured exception) from a second, live data source, not proving the
  negative of "zero pinholes have ever been opened."
- No mapping or pinhole was added, deleted, or modified; no router setting
  was changed; nothing was installed — every call used was a read-only
  UPnP SOAP `POST` (`Invoke-WebRequest`/`HttpWebRequest`/`UdpClient` already
  available on the Windows host); none of them are `GET` requests, and
  none write state.

**Verdict: Stage D is PASS, scoped to Hotel-Echo's three required-exposure
ports (`3000`/`3001`/`5433`, TCP, IPv4 and IPv6).** Every independent
method this task's evidence rules called for — host-side bindings
(loopback-only, no IPv6 listener), a genuine on-LAN probe, a genuine
off-network WAN probe on both IPv4 and IPv6, the router's static
configuration (no port-forward, no DMZ), and a live UPnP mapping query
sourced from Hotel-Echo's own LAN address (the vantage the router actually
grants visibility to, per the filtering finding above) across the full TCP
and UDP port range — converge on the same answer: nothing forwards or
exposes ports `3000`, `3001`, or `5433` from the public internet to
Hotel-Echo, on either IP family. This is **not** a router-wide
zero-mapping claim — one UPnP mapping exists (Tailscale's own, on an
unrelated port, see above) — and it is scoped to the ports this gate
requires; it says nothing about any other port on the router. The Gate 2
port-exposure checkbox for Hotel-Echo can now be checked off on that
scope.

**One residual, non-blocking limitation, recorded for completeness:** the
UPnP protocol itself has no call that enumerates _all_ active IPv6
pinholes by listing — only `GetFirewallStatus`'s aggregate flags and a
per-`UniqueID` lookup exist. If a pinhole were ever opened by some other
device/app on the LAN without this session's knowledge of its `UniqueID`,
neither the admin UI nor this API walk would surface it. The admin UI's
`IPv6 firewall: High, all Traffic IN unchecked including All Other Ports`
is the operator-facing control for this and shows no configured exception;
that, plus the Hotel-Echo-origin IPv4 UPnP result above (the one mapping
that exists is accounted for and is not one of this gate's ports), is the
strongest evidence obtainable read-only and is treated here as sufficient
for PASS on this gate's scope.

**Step 6 — IPv6 applicability: APPLICABLE, closed on every leg tested** (see
the router IPv6 firewall finding below — `High`, default-deny inbound, no
exception — which is what actually closes this; host-side silence and
external-probe timeouts on their own do not, since IPv6 typically bypasses
NAT). Hotel-Echo has a genuinely globally-routable IPv6 address
(`2001:56a:...`, SLAAC, `scope global`) on its LAN interface — reconfirmed
this session via `ip -6 addr show enp3s0` and `curl -6 icanhazip.com`
returning that exact address, unchanged from the prior session. `ss` shows
no service listening on that address for any of the three ports, and
Step 3-4's external IPv6 probe against that same address timed out on all
three ports with a working IPv6 vantage.

**Step 7 — tunnel remains stopped: reconfirmed** again this session via
SSH, identical to every prior check.

### 🟢 STAGE B COMPLETE — Hotel-Echo deployed to `00742e4`; tunnel still offline (2026-09-04)

Authorized single-purpose deployment session. Hotel-Echo now runs the verified
`main` baseline. **`cloudflared` was never started and remains absent from the
host.** No migrations, restores, ingestion/reprocessing jobs, or Docker pruning
were run. The `db` container was not recreated and volume
`eanhl-team-website_postgres_data` was not recreated, restored, migrated, or
subjected to any manual data operation. It was **not** frozen, and should not be
described as untouched: normal worker ingestion kept writing to it throughout,
exactly as it does on every five-minute cycle.

**Before → after:**

|                | before                                      | after                                                         |
| -------------- | ------------------------------------------- | ------------------------------------------------------------- |
| commit         | `d7f645c`                                   | `00742e4`                                                     |
| `web` image    | `sha256:941f4150389e…`                      | `sha256:2cb63040ba79…`                                        |
| `worker` image | `sha256:9bdf5fd37c2b…`                      | `sha256:1058d0515cf5…`                                        |
| `db` image     | `postgres:16-alpine` `sha256:cf78e76683b9…` | unchanged — container not recreated (`Up 22 hours (healthy)`) |

Volume `eanhl-team-website_postgres_data` was neither recreated nor restored,
and no migration or manual data operation ran against it; ordinary worker writes
continued. The 20-commit range
`d7f645c..00742e4` changes **no** migration files (verified before deploying),
so the already-applied 56-migration set remains correct — this is why no
migration step was needed or run.

**Compose reconciliation (the Stage B caveat).** The host-local modification
turned out to be _only_ the hardening pass's three hard-coded loopback bindings
(`"127.0.0.1:5433:5432"`, `"127.0.0.1:${HEALTH_PORT}:…"`, `"127.0.0.1:3000:3000"`);
the inline-token `cloudflared` service had already been removed relative to the
tracked file, so it did not appear in the diff. The tracked `00742e4` file
expresses the same posture parameterised — `${DB_BIND_ADDR:-127.0.0.1}`,
`${HEALTH_BIND_ADDR:-127.0.0.1}`, `${WEB_BIND_ADDR:-127.0.0.1}` — and Hotel-Echo's
`.env` sets none of those three, so the effective binding is identical. The
host edit was therefore **superseded, not overridden**. It was preserved two
ways rather than discarded:

- `git stash` on the host — `stash@{0}`, exact object id
  **`79582514b570f33b92582e7165ca3a1002fe60df`**, "hotel-echo host-local
  loopback bindings (pre-Stage-B, superseded by 00742e4)". Verified still
  present and still the only stash entry on 2026-09-04 during Stage C
  (read only — not applied, not dropped).
- a file copy at `~/hardening-backups/docker-compose.yml.host-local.d7f645c.20260904T230945Z`

Then `git pull --ff-only origin main` (fast-forward confirmed in advance). The
host working tree is now **clean** at `00742e4` — there is no longer an
intentional Compose difference to carry forward.

**Rollback (prepared before building, still available).** The pre-deploy images
were tagged so a `build` could not orphan them:

```bash
# on Hotel-Echo, in ~/eanhl-team-website
docker tag eanhl-team-website-web:rollback-d7f645c    eanhl-team-website-web:latest
docker tag eanhl-team-website-worker:rollback-d7f645c eanhl-team-website-worker:latest
git checkout d7f645c
# Restore the host-local compose file by EXACT object id, and apply — never pop.
# `pop` drops the stash on success and would destroy the only git-side copy if
# the rollback then went wrong; `apply` leaves it in place. The id is stable
# even if the stash stack ever gains another entry.
git stash apply 79582514b570f33b92582e7165ca3a1002fe60df
docker compose up -d web worker           # NO --build: reuses the restored images
```

**Verification performed (2026-09-04, all on the host unless noted):**

- `docker compose config --services` → `db`, `web`, `worker` only, rc=0, no
  warning. `--profile public` additionally lists `cloudflared`, confirming the
  profile gate works and that the default path excludes it. `docker ps` shows
  exactly three containers.
- `curl localhost:3001/health` → `200` `{"status":"ok","lastSuccessfulIngest":"2026-09-04T23:17:08.584Z",…}`
- `curl localhost:3000` → `200`; `/roster`, `/games`, `/stats` → `200`.
- Worker completed a real cycle in 6792 ms: `nhl26` gameType5/gameType10/club_private
  all `status=success`; `Aggregates recomputed for nhl26`; 10/10 club members
  upserted. **No `23502` error** — the `583c076` empty-club-aggregate fix is now
  live on this host (it previously logged that error every cycle).
- `web` log: `Next.js 15.5.15 … ✓ Ready in 667ms`.
- `ss -tlnp` → `127.0.0.1:3000`, `127.0.0.1:3001`, `127.0.0.1:5433`. No
  `0.0.0.0`, no `*`, no `[::]` wildcard on any of the three.

**Tunnel state — measured, not inferred from the 530.** The Cloudflare 530 alone
proves only that the edge has no origin; it was corroborated on the host:

- no container named `cloudflared` and none from `ancestor=cloudflare/cloudflared`,
  in **any** state (`docker ps -a`)
- `pgrep -a cloudflared` → none; no `cloudflared` systemd unit; no `cloudflared`
  binary installed on the host
- no outbound `:7844` connections (`ss -tn`)
- `./secrets/` does not exist, so the `public` profile could not start even if
  invoked
- from the main PC: `https://boogeymen.app/` → **530** via `104.21.2.16`
- Supporting only — this was not the Stage D test: at the time, a LAN probe of
  `192.168.1.107` ports 3000/3001/5433 from the main PC refused/timed out on
  all three. Stage D was subsequently completed and passed; see the committed
  "STAGE D PASS" entry.

**Remaining host differences and follow-ups — not addressed here:**

- **Hotel-Echo's `.env` still contains a `TUNNEL_TOKEN` variable**, left over
  from the pre-`852c6d7` inline-token approach. Nothing reads it any more — the
  tracked Compose file takes the token from a mounted `TUNNEL_TOKEN_FILE`
  secret — but it is a live tunnel credential sitting in a file on disk. It
  should be rotated in Cloudflare and removed from `.env` before, or as part of,
  any reopening decision. `.env` is mode `0600`; its value was never read or
  printed in this session.
- An unpinned `cloudflare/cloudflared:latest` image is still cached on the host.
  Unused (no container references it), but it is not the digest-pinned image the
  tracked Compose file specifies. Harmless while the tunnel is down; do not
  start anything from that tag.
- Hotel-Echo's database is still the fresh, empty-history one from provisioning.
  The production data migration, automated backups, and the restore drill remain
  open.
- ~~The deployed build's disabled-account-surface was **not** audited here —
  that is Stage C and is deliberately left for its own session.~~ **Done —
  Stage C ran on 2026-09-04 against this exact deployment and passed; see the
  "STAGE C COMPLETE" entry above.**

### 🟢 LAUNCH POLICY + DOMAIN MAIL DECIDED AND WORKING — Proton Mail on `boogeymen.app` (2026-09-03)

Operator-approved launch-policy decisions and operator-run Proton/Cloudflare
mail setup. This records decisions and mail evidence; it does **not** claim the
privacy/legal pages, indexing controls, or other website changes have been
implemented.

**Working domain mail:**

- `boogeymen.app` is verified as a Proton Mail custom domain under the
  operator's Proton Unlimited account.
- `webmaster@boogeymen.app`, `security@boogeymen.app`, and
  `alerts@boogeymen.app` are enabled and deliver to the operator's Proton
  inbox. Catch-all mail is disabled.
- `webmaster@boogeymen.app` was functionally tested in both directions with an
  external mailbox. The operator subsequently confirmed that `security@` and
  `alerts@` work as well.
- Public DNS was independently checked without exposing record contents: two
  Proton MX records, one SPF record, three DKIM CNAMEs, and one DMARC record
  were visible. DMARC uses the Proton-recommended quarantine posture.
- Proton, not Cloudflare Email Routing, handles sending and receiving.
  Cloudflare remains the registrar/DNS provider. This mail work did not start
  the Cloudflare Tunnel; the website remains offline publicly.
- The Proton account holding both mail and the Hotel-Echo break-glass-key
  escrow is operator-attested as protected with a unique password, MFA, and
  recovery measures. No credential, recovery code, private key, or DNS
  verification value is stored in this repository.

**Approved launch policy:**

- The launch site is fully public and read-only, with the account system
  disabled. It has no analytics or advertising and uses no nonessential
  cookies/tracking; a consent banner is not planned unless that changes.
- Normal public content may be indexed. APIs, diagnostics, previews, error
  routes, and dormant/private/auth/admin surfaces must not be indexed. The
  route-by-route inventory and `robots.txt`/sitemap implementation remain open
  roadmap work.
- Published team data consists of gamertags, roster membership, match results,
  statistics, and derived hockey metrics. Historical match/statistical data is
  retained as the site's archive; raw source/OCR evidence is retained as
  needed for accuracy, auditing, and corrections.
- Ordinary access/security logs have a 30-day retention target unless an
  active incident requires longer retention. The production log-rotation and
  disk-exhaustion controls remain unimplemented and unchecked above.
- Correction/deletion requests go to `webmaster@boogeymen.app`, with an
  operator target to acknowledge within 7 days and resolve or provide a
  substantive response within 30 days. There is no contact form at launch.
- The site is an adult gaming-club site: no current member is under 18 and
  there are no plans to admit or publish under-18 members. It does not
  knowingly solicit information from children and has no age-verification
  system because accounts and user submissions are disabled. Revisit this
  posture before publishing anyone under 18.
- The site is community-operated from Alberta, Canada. The main PC and
  Hotel-Echo are physically in Alberta; most team members are in Massachusetts,
  USA. Individual member locations are not published. The policies must
  disclose cross-border handling through Cloudflare and Proton without
  implying every member lives in Massachusetts.
- The legal surface must state that the site is community-operated and is not
  affiliated with or endorsed by Electronic Arts, EA Sports, the NHL, the
  NHLPA, or their affiliates.
- The planned recovery posture remains encrypted backups every six hours to
  storage independent of the production DB host, followed later by an off-site
  third copy. This is a policy decision only: backup automation and the restore
  drill are still open and must not be marked complete.

**Still open:** draft and publish the privacy/data-collection and
non-affiliation/attribution pages; add the global footer links; implement the
route-level indexing rules; verify the deployed site's actual cookies; document
the domain renewal date and billing owner; and finish backup, monitoring,
deployment, and public-launch gates.

### 🟢 HOTEL-ECHO HARDENED — network exposure, SSH, secrets; tunnel still offline (2026-09-03)

Operator-run infrastructure hardening pass on the Hotel-Echo host, carried out
directly on that machine (not through this repo's source). Distinct from the
"NEW HOST STOOD UP" provisioning entry and the "CONTAINED" tunnel-shutdown
entry below — this closes out several loose ends those left open.

**Completed:**

- `db`, `web`, and `worker` on Hotel-Echo now publish only to `127.0.0.1` —
  matches the main-PC posture recorded in "POST-ROTATION LOOSE ENDS CLOSED"
  below.
- `ufw` is active on Hotel-Echo; the only inbound path is SSH, and only over
  Tailscale.
- `sshd` hardened: password auth, keyboard-interactive auth, and root login are
  all disabled. A break-glass SSH private key was generated and escrowed in
  Proton Pass, then removed from the main PC once recovery access through it
  was verified to work.
- Hotel-Echo's `.env` is mode `0600`; the old environment backup is stored
  outside the working tree, not inside the repo checkout.
- The old inline-token `cloudflared` container was stopped and its service
  definition removed from Hotel-Echo's operational Compose file (Hotel-Echo
  had been running an inline-token variant predating the
  `TUNNEL_TOKEN_FILE`/`public`-profile approach from `852c6d7`).
- Cloudflare and GitHub account MFA and recovery contacts were set up.
  **This is operator-attested, not independently verified from this session**
  — no dashboard check was performed as part of this work.

**Still true, unchanged by this pass:**

- The tunnel remains offline. `boogeymen.app` still returns Cloudflare 530.
- ~~Hotel-Echo is still running its original source checkout and images from
  provisioning — **not** the account-system-disabled build, **not** the
  club-aggregate fix recorded below. Deployment is separate, unauthorized-here
  work; see Next Session Stage B.~~ **Stale — Hotel-Echo was deployed to
  `00742e4` on 2026-09-04; see the "STAGE B COMPLETE" entry at the top of
  Active State.**
- ~~Hotel-Echo's operational `docker-compose.yml` is now intentionally different
  from this repo's tracked version (the hardening above edited it locally,
  e.g. removing the cloudflared service). A future `git pull`/deploy on that
  host must reconcile this file rather than silently overwrite it — see the
  caveat added to Next Session Stage B.~~ **Resolved — the difference was only
  the hard-coded loopback bindings, which the tracked file now expresses as
  `${*_BIND_ADDR:-127.0.0.1}` defaults. Reconciled and stashed on 2026-09-04;
  the host tree is clean at `00742e4`.**
- ~~Automated backups, a restore drill, deploying current source, applying the
  56-migration set against it, and the production-data migration are all
  still open.~~ **Partly stale — corrected 2026-09-04.** Current source **is**
  deployed (`00742e4`, Stage B) and verified (Stage C). There is **no pending
  schema initialization on Hotel-Echo**: all 56 migrations were applied when the
  host was provisioned, and the `d7f645c..00742e4` range changes no migration
  file, so the applied set is still the correct one. **Still open: automated
  backups, the restore drill, and the production-data migration** — none of
  which the deployment closed, and none of which closes the Gate 2
  backup/recovery items.
- ~~**Gate 2's on-host/LAN/WAN port-exposure checkbox stays unchecked.** This
  entry confirms host-level loopback binding and firewall posture on
  Hotel-Echo; it is not the documented external `nc`/`curl` test from that
  checklist item (Next Session Stage D), and that external test has not been
  run.~~ **Stale, corrected 2026-09-06 — Stage D subsequently ran and PASSED
  for Hotel-Echo (2026-09-04); see the "STAGE D PASS" Active State entry.**
  The Gate 2 port-exposure checkbox is now checked, scoped to Hotel-Echo's
  three required ports (`3000`/`3001`/`5433`). This does not claim every
  service or every port was tested, and it says nothing about the main PC.

**Unrelated, same day, same session:** `fix(worker): skip empty club aggregate
rows` (`583c076`) fixes a `recomputeClubStats` NOT NULL violation (Postgres
error `23502`) for a game title/mode with zero matches — see
`apps/worker/src/aggregate.ts`. ~~**Fixed in source only.** It is not deployed
anywhere — not the main PC, not Hotel-Echo. Hotel-Echo will keep producing the
`23502` error in its worker logs for any game title/mode combination with zero
matches until a later, separately authorized deployment carries this fix.~~
**Partly stale — deployed to Hotel-Echo on 2026-09-04 (`00742e4`), whose worker
now completes a cycle with no `23502`. Still NOT deployed on the main PC.**

### 🟢 AUTHENTICATION DELIBERATELY DISABLED FOR PRE-LAUNCH — deferred to a post-launch review (2026-09-03)

**This is the authoritative statement of the product's auth posture.** It
supersedes every earlier plan in this file for initializing an admin account,
signing in on the host, or issuing invites. Those steps no longer exist.

**Still in force, and not changed by this work:**

- **The Cloudflare Tunnel on Hotel-Echo stays OFFLINE.** `boogeymen.app` returns
  530 and must keep returning 530 until Gate 2 items are closed and reopening is
  separately authorized. See the "CONTAINED" entry below.
- **Main-PC `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` have now been
  rotated** (2026-09-03, own authorized session). See the "ROTATION COMPLETE"
  entry below. The exposed values are dead; the historical exposure record is
  kept there deliberately.

> **⚠️ Source vs. deployed state — read this before citing this section as
> "what the site does."** Everything below describes **committed source**,
> pushed through `0b3a519`. **Nothing here has been deployed.** The main-PC
> `web` container still runs image `sha256:00a401fd31e3…` (see the "DEPLOYED —
> website Workstreams A/B/C" entry further down) and still serves the older,
> auth-enabled application — login page, Server Actions, and all. That
> container is currently reachable only through loopback (see "POST-ROTATION
> LOOSE ENDS CLOSED" below), which is what keeps the still-live bootstrap/login
> surface from being publicly reachable — not the source change described
> here. ~~Hotel-Echo has likewise not received this build~~ — **Hotel-Echo
> received this build on 2026-09-04 (`00742e4`); its tunnel remains offline per
> the entry above, for the same reason it was taken offline originally.**
> Deploying this source (main-PC and/or Hotel-Echo) is separate,
> unauthorized-here work.

**The decision.** Authentication is deferred until after launch. Once this
source is deployed, the pre-launch site will be public and read-only, with no
login, account, invitation, session, administration, or initial-admin
functionality — not disabled by configuration, not hidden behind a flag, but
absent from the source that becomes the running application on deploy. As of
this writing the _actually running_ main-PC and Hotel-Echo instances still
contain the account system described in the "CONTAINED" entry below.

**What the source does** (all measured against a local build run on a loopback
port for verification purposes, `44aed29` — **not** the deployed main-PC
container, which is still the older image referenced above):

| Path                                        | Method                        | Status |
| ------------------------------------------- | ----------------------------- | ------ |
| `/`                                         | GET                           | 200    |
| `/login`                                    | GET                           | 404    |
| `/login?token=<invite>`                     | GET                           | 404    |
| `/account`                                  | GET                           | 404    |
| `/me`                                       | GET                           | 404    |
| `/admin`, `/admin/accounts`, any `/admin/*` | GET                           | 404    |
| `/api/auth/session`                         | GET                           | 404    |
| `/api/auth/sign-in/email`                   | POST                          | 404    |
| `/api/auth/*`                               | PATCH/PUT/DELETE/HEAD/OPTIONS | 404    |

- **Pages have no module at all.** `/login`, `/account`, `/me` and
  `/admin/accounts` are as absent as a URL this site never had.
- **Server Actions hard-refuse.** `src/app/account-actions.ts` keeps all seven
  export names and each rejects on its first statement. A Server Action is
  reachable by its action id whether or not a form renders it, so deleting the
  page would not have been enough on its own.
- **`init-admin` fails closed.** `pnpm --filter worker init-admin` runs a shim
  that imports nothing and exits non-zero on every argument combination. It
  cannot connect to a database, read `users`, or prompt for a password.
- **Nothing active constructs Better Auth.** `lib/ocr-diagnostics.ts` used to
  call `isCurrentUserAdmin()` from `/games/[id]`, a public page; that was the
  last active route initialising Better Auth on every request. It now reads
  `OCR_DIAGNOSTICS` only.
- **No environment switch.** There is deliberately no env var that re-enables
  any of this — an accidental setting on Hotel-Echo would republish the whole
  account surface with no review. Re-enabling is a reviewed source change.

**Deferred, not deleted.** The implementation is parked in
`apps/web/src/deferred/auth/` and `apps/worker/src/deferred-auth/`, non-routable
and imported by nothing. Account tables, migrations, existing account data, and
the `@eanhl/db` account queries are untouched; `better-auth` remains a
dependency. The post-launch account feature starts from that code, reviewed on
its own merits. `apps/web/src/deferred/auth/README.md` is the restoration
procedure.

**⚠️ WHAT THIS DOES NOT CLOSE.** Disabling authentication removes one exposure
class. It closes **no other gate**, and none of the following became less
urgent:

- **Privacy and legal** — the privacy policy, the data-collection policy
  (gamertags, statistics, server/IP logs, retention, processors), the
  correction/deletion request process, and the EA/NHL non-affiliation notice are
  all still required. A public read-only site still publishes named individuals'
  personal statistics and still keeps server logs.
- **Backups and restore** — still unproven. A public site must be a recoverable
  one.
- **MFA and recovery** — still required on the domain/Cloudflare account. That
  is account security for the _infrastructure_, and it never depended on the
  site having its own login.
- **Public exposure** — security response headers, the indexing decision and
  `robots.txt` are all still open. Host port exposure is now loopback-only on
  the **main PC** (3000/3001/3002/5433, measured — see the entry below), but
  ~~Hotel-Echo is still unverified, so the Gate 2 checkbox stays unchecked.~~
  **Stale, corrected 2026-09-06 — Hotel-Echo was subsequently verified: Stage D
  ran and PASSED (2026-09-04) for its three required ports (`3000`/`3001`/
  `5433`); the Gate 2 checkbox is now checked on that scope. See the "STAGE D
  PASS" Active State entry. The main-PC port set above was not part of Stage D
  and remains as measured here.**
- **Secret rotation** — now done; see the "ROTATION COMPLETE" entry below.
  It closed the exposed-credential problem and nothing else on this list.

**Test evidence.** `pnpm --filter web test` → 130 unit + 11 behavioural + 6
end-to-end HTTP, 147/147. `node apps/worker/scripts/with-test-db.mjs
init-admin-cli` → 12/12 against a disposable `eanhl_test_*` clone. The
boundary was mutation-tested twice: re-exporting the dormant login page at
`/login` fails the structural guard and the HTTP suite; removing one action's
refusal fails the behavioural suite. Both mutations were reverted.

**Known, pre-existing, NOT introduced here and NOT fixed here:** `notFound()`
called from a _page_ returns **200** with 404 content in this app, because the
root `src/app/loading.tsx` puts every page inside a Suspense boundary whose
shell is flushed before the page component runs. Measured: `/games/999999999`
and `/roster/999999999` both answer 200. This is why the disabled pages were
deleted rather than turned into 404-returning tombstones. Fixing the general
case is separate work.

### 🟢 ROTATION COMPLETE — main-PC `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` were exposed, and have now been rotated (2026-09-03)

**No secret value may ever be copied into this repository — not into source,
docs, commit messages, test fixtures, or command output.** One already had
been; see "Second exposure" below.

**First exposure — tool transcript.** During the Codex review of the Compose
changes, `docker compose config` was run in the repository root. That command
interpolates `.env`, so it printed the main PC's `POSTGRES_PASSWORD` (inside the
rendered `DATABASE_URL`) and its `BETTER_AUTH_SECRET` in full into the private
tool transcript. The transcript is not public and was not committed, but the
values left the `.env` file that was their only intended home, into a store with
a different retention and access model than the operator chose for them.

**Second exposure — committed and pushed, and older. Found while verifying the
first.** The main PC's `POSTGRES_PASSWORD` was in PLAINTEXT in two tracked
files, and had been since 2026-04-16:

- `.claude/skills/docker-redeploy/SKILL.md` — inside a sample `DATABASE_URL`
- `research/investigations/mcp-and-tooling-setup.md` — as a `DB_PASSWORD=` line

Both are redacted in the working tree by the follow-up commit that added this
entry. **That is not a fix.** The value is in git history and on `origin/main`,
where it has been for months and where anyone with repository read access could
have found it. It cannot be removed without rewriting published history, which
is not authorized here and would not retrieve any copy already cloned. Rotation
was the only real remedy, and it is why `POSTGRES_PASSWORD` was the
higher-priority of the two. It has since been rotated — see below.

`BETTER_AUTH_SECRET` was NOT found in any tracked file; its only known exposure
is the tool transcript.

**Both were rotated on 2026-09-03 in their own authorized session, and both
rotations succeeded.** The values recorded in the two exposures above are dead.
They no longer authenticate anything, so the fact that the old
`POSTGRES_PASSWORD` remains in published git history is now a historical record
rather than a live credential. **Keep the exposure record above** — it is the
evidence of what happened and why the rotation was needed; do not delete it
because the remedy has landed.

- `POSTGRES_PASSWORD` — the PostgreSQL role password and root `.env` were
  changed together, and every consumer of `DATABASE_URL` was moved in the same
  window: web, worker, host-side migration/psql tooling, the OCR/video-ingest
  pipeline, and the separate `apps/web/.env.local` web-development copy.
- `BETTER_AUTH_SECRET` — rotated as well. Invalidating sessions cost nothing
  here, but not because the account system was absent from the running
  application — at rotation time the running application still had (and
  still has) the account system live; see the "Source vs. deployed state"
  note in the "AUTHENTICATION DELIBERATELY DISABLED" entry above. The reason
  nothing broke is that a database check at rotation time found **zero rows**
  in `users`, `accounts`, and `sessions` on the main-PC database, so there
  were no real accounts or live sessions for the old secret to have been
  protecting in the first place.

**Rotation insurance — a protected same-host dump.** Before the rotation a
custom-format dump was taken to
`/home/michal/backups/pre-rotation-20260903/eanhl-pre-rotation.dump`
(27,300,096 B, file mode `0600`, directory mode `0700`, owner `michal`).

> ⚠️ **This dump is rotation insurance ONLY. It does NOT satisfy the off-host
> backup gate.** It lives on the same machine as the database it was taken
> from, so it survives a bad rotation and nothing else — not disk failure, not
> theft, not ransomware, not host loss. The Gate 2 backup item ("automated
> backups to storage independent of the host") and the restore drill both stay
> **unchecked**. Do not cite this file as backup evidence.

**Not affected.** Hotel-Echo's `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` are
independently generated and were never rendered; they were not part of this
rotation and were not touched. The Cloudflare tunnel token was not exposed
either: it is delivered as a mounted file and never interpolated into the
rendered Compose config — see the "CONTAINED" entry and `852c6d7`.

**Avoiding a repeat.**

- `docker compose config` is a secret-printing command in this repository. When
  its output is needed as evidence, render it with `--format json` and extract
  only the fields in question, or pipe it through a redaction filter — never
  paste the raw output. The verification commands recorded in this file and in
  DEPLOY.md follow that rule.
- Before any commit, grep the tree for the live `.env` values, not just for
  patterns that look secret-shaped. The second exposure above sat in the repo
  through many reviews precisely because nobody searched for the actual string:

  ```bash
  # from the repo root, with the values NOT echoed
  set -a && source .env && set +a
  git grep -I -F -l -- "$POSTGRES_PASSWORD" && echo "LEAK" || echo "clean"
  git grep -I -F -l -- "$BETTER_AUTH_SECRET" && echo "LEAK" || echo "clean"
  ```

### 🟢 POST-ROTATION LOOSE ENDS CLOSED — main-PC listeners are loopback-only, stale MCP processes retired (2026-09-03)

Follow-up to the rotation entry above. Two items were left open by that session
and are now closed.

**1. Every main-PC listener binds to loopback.** The Compose services already
did (`852c6d7`); the outlier was the operator's own Next.js development server,
which `next dev` had bound to **every interface** (`*:3002`) — reachable from
the LAN, and from the internet had anything forwarded to it. `apps/web`'s `dev`
script now passes `--hostname 127.0.0.1`, and the 3002 server was restarted on
the updated command.

Measured on the main PC after the restart (`ss -ltn`):

| Port | Service            | Binding     |
| ---- | ------------------ | ----------- |
| 3000 | web (docker)       | `127.0.0.1` |
| 3001 | worker health      | `127.0.0.1` |
| 5433 | db (docker)        | `127.0.0.1` |
| 3002 | web dev (operator) | `127.0.0.1` |

No wildcard, `0.0.0.0`, or IPv6-wide listener remains on any of the four.
`/`, `/games`, `/roster`, and `/stats` all answer **200** on
`http://127.0.0.1:3002` after the change.

> This is the **main PC only**. It is not the Gate 2 port-exposure evidence:
> that item asks for on-host / LAN / WAN verification on **Hotel-Echo**, ~~which
> has not been done. Stage D below still stands, and the checkbox stays
> unchecked.~~ **Stale, corrected 2026-09-06 — that verification has since been
> done: Stage D ran and PASSED for Hotel-Echo (2026-09-04), scoped to its three
> required ports. See the "STAGE D PASS" Active State entry. This does not
> extend Stage D's scope to the main PC — the main-PC measurement above stands
> on its own.**

**2. The stale MCP processes from the rotation session are gone.** PIDs
`547827`, `547860`, and `547861` — left running by that session — were confirmed
retired. Nothing was killed here; they had already exited.

### 🔴 CONTAINED — DOMAIN REGISTERED, TUNNEL OFFLINE — public bootstrap-admin exposure on Hotel-Echo (2026-09-03)

> **Update, later the same day:** the exposure class is now closed at a wider
> boundary than the fix described here. The entire account system is disabled
> for pre-launch — there is no `/login` page to bootstrap, no Server Action to
> POST to, and no `init-admin` CLI. See "AUTHENTICATION DELIBERATELY DISABLED"
> at the top of Active State. **The tunnel-offline status below still stands and
> is unchanged:** `cloudflared` is stopped and reopening it remains its own
> authorization.

Supersedes the Stage C "complete" claim below. Stage C is **not** complete: the
domain is registered and the tunnel is built, but the tunnel is stopped and the
site is not serving.

**What happened.** The `/login` page treated an empty `users` table as
authorization. With no accounts in the database it rendered a "Bootstrap Admin"
form to any anonymous visitor, and the `bootstrapAdmin` Server Action behind it
would create the site's first admin — user, credential, `admin` role, and player
claim — for whoever submitted it first. Hotel-Echo was stood up with a fresh,
empty database and then published at `boogeymen.app`, so for the time the tunnel
was up, the admin account was available to the first stranger who loaded the
page. Removing the form alone would not have been enough: a Server Action is
reachable by its action id whether or not any form renders it.

**Exposure and containment.**

- Public exposure window: **~7.5 minutes**, from the tunnel coming up to
  `cloudflared` being stopped on Hotel-Echo.
- `cloudflared` is stopped. `boogeymen.app`, `www.boogeymen.app`, and
  `/login` all return Cloudflare **530** (origin unreachable). The domain and
  DNS records still exist; only the tunnel connector is down.
- **No account was created.** Hotel-Echo's `users`, `accounts`, and
  `user_player_claims` tables were checked and are empty, so no admin was taken
  and no account takeover occurred.
- **Page access cannot be disproven.** Nothing retained request logs for that
  window, so whether anyone loaded `/login` and saw the form is unknown and
  unknowable. The tables being empty rules out a successful account creation;
  it does not rule out someone having seen the page.
- The main-PC production instance was never touched by this and has accounts
  already, so the empty-table condition never applied there.

**Fixed at source.** ~~(local commits, not pushed, not deployed)~~ **Superseded
— these three commits have since been pushed to `origin/main`** (they are
ancestors of the current `HEAD`); **they are still not deployed.** Kept as
originally written below for the historical record of what each commit did:

- `9ac237f` — `fix(web)`: the bootstrap form, the `bootstrapAdmin` Server
  Action, and the login page's user-count read are all gone. `/login` no longer
  consults the user count at all, so an empty database is indistinguishable from
  a populated one to an anonymous visitor; it also no longer leaks the
  claimable-player roster.
- `5008ee4` — `feat(worker)`: initial admin creation moves to an operator CLI,
  `pnpm --filter worker init-admin`, which requires shell + database access on
  the host. The password is read from stdin only (non-echoing prompt on a TTY,
  or a pipe); `--password` is refused because argv is visible in `ps`. The user,
  credential, `admin` role, and player claim are written in one transaction that
  refuses if any user already exists. 7/7 integration tests against a disposable
  `eanhl_test_*` clone.
- `852c6d7` — `fix(deploy)`: `cloudflared` moves behind a `public` compose
  profile (hosts without a tunnel get the unchanged default stack, no warning,
  no failing container); the tunnel token is delivered as a mounted file via
  `TUNNEL_TOKEN_FILE` instead of being interpolated into `command:`; the image
  is pinned to `cloudflare/cloudflared:2026.8.3@sha256:51c9cefc…` with a
  documented update procedure; and published ports (web 3000, worker health
  3001, db 5433) bind to `127.0.0.1` instead of `0.0.0.0`.

- A follow-up commit adds the behavioural test evidence and corrects the
  staged order below (see "Next Session").

Invite-only account creation is unchanged and remains the only in-app path to a
new account after the first.

**Test evidence, described accurately.** Three files, covering different
things. None of them touches a real database.

> **Two of the three no longer exist.** `login-page-render.test.ts` and
> `no-public-admin-bootstrap.test.ts` asserted a contract this project has since
> abandoned — "/login must still offer sign-in", "invite acceptance must remain"
> — and were replaced when the account system was disabled entirely. Their
> successors are `apps/web/src/lib/account-system-disabled.test.ts`,
> `apps/web/test/auth-routes-disabled.test.ts`, and
> `apps/web/test/disabled-routes-http.test.ts`. `db-queries-not-stubbed.test.ts`
> is unchanged and still passing. The description below is kept as the record of
> what was verified at the time.

- **Behavioural (simulated answers) — the strongest local evidence.**
  `apps/web/test/login-page-render.test.ts` imports the real
  `src/app/login/page.tsx` module, awaits it as the async Server Component it
  is, and renders the result to HTML with `react-dom/server`. It runs with
  `@eanhl/db/queries` substituted by a stub that **simulates** the dangerous
  answers — `hasAccountUsers()` returns **false** and the claimable roster is
  non-empty. **It does not create or query an empty database**, and must not be
  cited as if it did; those are precisely the answers under which the old page
  rendered the bootstrap form and the player picker, which is what makes the
  simulation the right one. 5 tests assert the rendered HTML contains the
  sign-in form and contains no "Bootstrap"/"Create Admin" copy, no `playerId`
  field, and no roster gamertag; that the page never _calls_ `hasAccountUsers`
  or `listClaimablePlayers` (this one does not depend on the simulated answers
  at all — a page that never asks cannot branch on what a real database would
  have said); that the three retired `bootstrap_*` error codes fall through to
  the generic message; and that the invite-acceptance branch still renders, so
  the suite cannot pass by the page having been gutted. A 6th test asserts the
  stub substitution is actually live in that process, so the five negatives are
  real negatives. **Mutation-proved:** reintroducing the bootstrap render branch
  fails all of them.
- **Structural — a tripwire, not proof.**
  `apps/web/src/lib/no-public-admin-bootstrap.test.ts` greps source text. It
  cannot execute the app and a rename or dynamic import would slip past it. It
  is retained for the one property rendering cannot observe at all: a Next.js
  Server Action is reachable by its action id whether or not any form renders
  it, so "no bootstrap form in the HTML" says nothing about whether
  `bootstrapAdmin` still exists and is still invocable by a crafted POST. Its
  4 tests assert that action's absence and that no shipped file under
  `apps/web/src` references the operator-only `createInitialAdmin` query. Also
  mutation-proved.
- **Harness integrity.** `apps/web/src/lib/db-queries-not-stubbed.test.ts`
  fails if the render harness's module substitution ever leaks into the normal
  unit suite. It briefly did: the loader was installed for the whole `src/**`
  glob, which would have let a future test silently receive a stub whose
  `hasAccountUsers()` always answers false. The two suites now run in separate
  processes and this test enforces that.

**The real-database behavioural proof is Stage C below**, not any of the above:
`curl -s localhost:3000/login` against the deployed response on the host, after
the fix is deployed. Nothing in this repo's test suite can establish what a real
empty production database renders.

**Historical — this split no longer exists.** `test:login-render` and the
`login-page-render.test.ts` suite it ran were deleted when the account system
was disabled (see the callout above); `apps/web/package.json`'s `test` script
now runs `test:unit`, `test:auth-disabled`, and `test:http-404` instead. Kept
below as the record of what was verified at the time — test processes were
deliberately split:

| Script                                | What it ran                                                    |
| ------------------------------------- | -------------------------------------------------------------- |
| `pnpm --filter web test:unit`         | `src/**/*.test.ts`, NO module substitution — 122 tests         |
| `pnpm --filter web test:login-render` | the render suite in its own process, with the loader — 6 tests |
| `pnpm --filter web test`              | both, in that order — 128 tests                                |

**Still open — none of this is done:**

- **Nothing is deployed.** ~~Nothing is pushed.~~ **Superseded — these commits
  have since been pushed to `origin/main`; deployment is still outstanding.**
  Hotel-Echo still runs the vulnerable image; it is only safe because the
  tunnel is off.
- ~~**The tunnel stays offline** until the fixed image is deployed and the
  external checks below pass.~~ **Stale, corrected 2026-09-06 — the fixed
  image is deployed and Stage D's external checks have passed for Hotel-Echo
  (2026-09-04; see the "STAGE D PASS" Active State entry). The tunnel
  nevertheless remains offline: Stage E's prerequisites (MFA/recovery contact,
  security response headers, indexing decision, privacy/legal drafts, backups
  and a restore drill) are still incomplete, and reopening the tunnel requires
  its own separate explicit authorization regardless of gate completion.**
- ~~**Port exposure is unverified on every host.** Loopback binding is now the
  default in source, but no on-host / LAN / WAN check has been run anywhere, and
  Docker's published ports bypass host firewall rules — so nothing is proven yet.
  The Gate 2 checkbox stays unchecked.~~ **Stale, corrected 2026-09-06 — Stage D
  subsequently ran and PASSED for Hotel-Echo (2026-09-04), scoped to its three
  required ports (`3000`/`3001`/`5433`); the Gate 2 checkbox is now checked on
  that scope. See the "STAGE D PASS" Active State entry. The main PC was not
  covered by Stage D and remains as separately measured elsewhere in this
  file.**
- **MFA status and the recovery contact for the domain account are still
  undocumented.** Gate 2 asks for them explicitly; that checkbox stays unchecked.
- Security response headers, `robots.txt`/indexing policy, backups, the
  production data migration, and the retire-vs-keep-both cutover decision are all
  untouched. Every one of those Gate 2 and Gate 3 items stays unchecked.
- The site was public for those minutes with no privacy policy, no
  data-collection notice, and no EA/NHL non-affiliation notice. Those drafts
  remain open Gate 2 items.

**Do not** re-open the tunnel, create an admin, restart Hotel-Echo, push, or
touch the main-PC production instance without the explicit staged authorization
in "Next Session" below.

### 🟡 SUPERSEDED (see "CONTAINED — DOMAIN REGISTERED, TUNNEL OFFLINE" above) — Stage C domain + tunnel work on Hotel-Echo (2026-09-03)

**This entry claimed Stage C was complete. It was not.** The site it put on
the public internet shipped a first-visitor bootstrap-admin vulnerability, and
the tunnel has since been taken offline. Read the "CONTAINED" entry above
before acting on anything below. Kept otherwise as written — apart from this
note, the heading, one redacted account identifier, and one struck-through
stale claim — because the factual record of what was built is still needed to
re-open the tunnel later.

Advances the Gate 2 "Domain, hosting, and exposure decisions" checklist.
Supersedes the two now-stale bullets in the "NEW HOST STOOD UP" entry below
(struck through there, not deleted). Committed as `5bdf442`
(`feat(deploy): add Cloudflare Tunnel service for public domain routing`) —
since corrected by `852c6d7`. Still the parallel, not-yet-production
instance — see that entry's caveats, which are otherwise unchanged.

**What was done:**

- Registered `boogeymen.app` via Cloudflare Registrar (~$14/yr, no markup
  over wholesale). Cloudflare account created via GitHub SSO; the owning
  account is recorded outside this repo, not here. `.gg` was considered first
  but is not on Cloudflare
  Registrar's supported TLD list at all (confirmed against their published
  TLD policy page) — not a cost tradeoff, simply unavailable there.
- Created a named Cloudflare Tunnel (`hotel-echo-web`, tunnel id
  `03eab4e9-bdfc-46fd-951c-f63b58d228e8`) via the Cloudflare API, using a
  scoped API token (`Zone:DNS:Edit` + `Account:Cloudflare Tunnel:Edit`,
  restricted to this zone/account — token value not stored anywhere in the
  repo).
- Tunnel ingress: `boogeymen.app` and `www.boogeymen.app` →
  `http://web:3000` (the compose network's internal DNS name), catch-all
  `404` for anything else. **Only the `web` service is routed through the
  tunnel** — `db` (5433) and the worker health port (3001) are not in the
  ingress config and have no DNS record pointing at them.
- Two proxied CNAME records created (`boogeymen.app`, `www.boogeymen.app`)
  → `<tunnel-id>.cfargotunnel.com`.
- Added a `cloudflared` service to `docker-compose.yml`, referencing
  `${TUNNEL_TOKEN}` (never the literal token — matches the existing
  `POSTGRES_PASSWORD`/`BETTER_AUTH_SECRET` pattern). Documented in
  `.env.example`. Deployed to Hotel-Echo: `docker-compose.yml` copied over,
  `TUNNEL_TOKEN` added to its `.env` (old `.env` backed up first as
  `.env.bak-pre-tunnel-<timestamp>`), `BETTER_AUTH_URL`/`APP_BASE_URL`
  flipped from the `http://localhost:3000` placeholders to
  `https://boogeymen.app`.
- **Public/members-only decision resolved:** fully public, no Cloudflare
  Access gate. Answers the Gate 2 roadmap item directly — checked off in
  the roadmap list above.
- **Verified from outside the LAN** (external `curl`, not a LAN/Tailscale
  shortcut): `https://boogeymen.app` and `https://www.boogeymen.app` both
  return HTTP 200 with valid Cloudflare-terminated TLS (HTTP/2,
  `server: cloudflare`, real `cf-ray`). Confirmed the `web` container
  actually has the new env vars loaded (`docker exec ... printenv`).
  Confirmed the better-auth route mounts and responds correctly at the new
  URL (`/api/auth/get-session` → `200 null`, `/api/auth/ok` →
  `200 {"ok":true}`) — auth is wired to the real public URL, not stale
  localhost config. `cloudflared` logs show 4 registered edge connections
  and a clean connectivity pre-check (DNS/UDP/TCP/API all PASS).

**Not done / still open:**

- **MFA status and recovery contact on the new Cloudflare account are
  undocumented.** The Gate 2 domain checklist item asks for these
  explicitly; only registrar, owner, and rough renewal cost are recorded
  here, so that checklist item stays unchecked pending that.
- ~~**No external port-scan was run** to positively confirm `db`/worker-health
  aren't reachable from the internet by some other path (e.g. a stray
  router port-forward on Hotel-Echo's network) — this session only
  confirmed the tunnel itself doesn't route to them. The Gate 2 "confirm
  db/health ports not exposed" checkbox stays unchecked pending that.~~
  **Stale, corrected 2026-09-06 — that external verification has since been
  run: Stage D PASSED for Hotel-Echo (2026-09-04), including a genuine
  off-network WAN probe (IPv4 and IPv6) and a live router port-forward/DMZ/UPnP
  check, and found no exposure of `3000`/`3001`/`5433` through the tested
  host, LAN, WAN, static-forward, DMZ, and UPnP paths; no relevant router
  forward was found. The Gate 2 "confirm db/health ports not exposed"
  checkbox is now checked on that scope. See the "STAGE D PASS" Active State
  entry.**
- Backups, staging/rollback ownership, and secret-rotation process are
  untouched — separate Gate 2 items.
- **Hotel-Echo is still not production.** No data migration has happened;
  its database is the same fresh/empty one from the prior session.
  ~~`boogeymen.app` is a real, working, internet-reachable _parallel_
  instance, not the site members currently use.~~ **Stale — the tunnel was
  stopped the same day; `boogeymen.app` now returns Cloudflare 530. See the
  "CONTAINED" entry above.**

### 🟡 NEW HOST STOOD UP, NOT YET PRODUCTION — Hotel-Echo dedicated deployment box provisioned (2026-09-03)

This is a **new, independent, parallel deployment**, not a migration of the
existing production instance. The production system referenced throughout the
rest of this file continues to run unchanged on the current host
(`eanhl-team-website-db-1` created 4 months ago, `db`/`web` up continuously,
`worker` up 3h after its own restart) — none of it was touched by this
session.

**What was done**, addressing the Gate 2 "Domain, hosting, and exposure
decisions" checklist:

- Repurposed a second physical machine ("Hotel-Echo": i5-4670, 8GB RAM, 224GB
  SSD + 3.64TB HDD) as a dedicated Docker host. Windows 10 wiped; Ubuntu
  Server 26.04.1 LTS installed on the SSD only — the HDD (former Plex media
  drive) was physically disconnected during install and remains
  untouched/unused.
- Installed Docker Engine 29.7.2 + Compose plugin, Node.js 22.23.2, pnpm
  10.33.0 (pinned, matches `packageManager`), `postgresql-client`.
- Joined Hotel-Echo to the existing Tailscale tailnet (`utiz23.github`) as
  `hotel-echo` / `100.98.29.119`, alongside the main PC (`sierra-november` /
  `100.119.187.119`). Intended to let the main PC's OCR/video-ingest pipeline
  reach Hotel-Echo's Postgres over Tailscale once that migration happens.
- Repo cloned to Hotel-Echo via a dedicated **read-only** GitHub deploy key
  (title `hotel-echo-deploy`, key id `162148527`) — not the operator's
  personal credentials.
- Ran the full `DEPLOY.md` sequence against a **fresh, empty database**: `db`
  healthy, all 56 migrations applied (cosmetic
  `NOTICE: identifier will be truncated` messages only, no errors),
  `game_titles` seeded, `db`/`worker`/`web` built and started. Verified:
  worker completed a real ingestion cycle against the live EA API (10 club
  members upserted for club 19224), `/health` returns `{"status":"ok",...}`,
  `web` returns `200` both on the host and from elsewhere on the LAN
  (`http://192.168.1.107:3000`).
- Granted `utiz` passwordless sudo on Hotel-Echo
  (`/etc/sudoers.d/utiz-nopasswd`) to allow this kind of remote-driven setup;
  BIOS `AC BACK` set to Always On for unattended reboot after power loss.

**Explicitly NOT done — do not treat this as production-ready:**

- **No data migration.** Hotel-Echo's database is brand new — it does not
  contain any of the historical matches, OCR extractions, decoder-run
  provenance, or review-queue state that lives in the current production
  database. Cutting over would require a `pg_dump`/`pg_restore` from the real
  production DB, not just standing the schema up.
- ~~**Not exposed to the public internet.** No domain purchased, no Cloudflare
  Tunnel configured. Reachable only via LAN (`192.168.1.107`) and Tailscale
  (`100.98.29.119`) right now.~~ **Stale — domain purchased and Cloudflare
  Tunnel configured same day, then taken offline; see the "CONTAINED"
  entry above.**
- ~~`.env` on Hotel-Echo has `BETTER_AUTH_URL`/`APP_BASE_URL` still at the
  `http://localhost:3000` placeholder default — must be updated to the real
  public URL once domain/tunnel exist, then `docker compose restart web`.~~
  **Stale — both updated to `https://boogeymen.app` and `web` restarted; see
  the "CONTAINED" entry above.**
- `POSTGRES_PASSWORD`/`BETTER_AUTH_SECRET` on Hotel-Echo were freshly
  generated for this host; they are independent of whatever secrets the
  current production `.env` uses.
- The HDD is still disconnected/unused — no decision yet on repurposing it
  for archive storage.

**Relevant to Gate 2 checklist:** partially advances "Select the hosting
solution" (Hotel-Echo, self-hosted, is now a working candidate) and "Document
where the... app, worker, PostgreSQL... terminate" (now: Hotel-Echo,
LAN+Tailscale only). ~~Domain purchase, Cloudflare Tunnel/Access, the
production data migration, and the cutover decision (retire current host vs.
keep both) are all still open and unstarted.~~ **Stale — domain purchase,
Cloudflare Tunnel, and the public/members-only Access decision were
completed the same day, and the tunnel has since been taken offline; see
the "CONTAINED" entry above. The
production data migration and the retire-vs-keep-both cutover decision
remain open and unstarted.**

### 🟢 DEPLOYED — decoder-run provenance eligibility fix, worker-only at `f456740` (2026-09-02)

Supersedes the "CORRECTED, NOT DEPLOYED" entry below (kept, not deleted, for
history): the worker-only deployment recommended there was carried out the
same day and is now live and verified. Deployed source commit
`f456740dee63acaf03daaa02a15c610865d8811b`, built from an isolated snapshot
(`/tmp/eanhl-f456740-snapshot-preflight`), new worker image
`sha256:267d27a5d5739b54705e1eb4a83e714dd26a3a5976a7b5469e41132a96f7950c`,
new worker container
`9e67594744f326010ae19900ab5cf45fa773cccaf6a89dc644b6eb7bf6523256`,
`StartedAt=2026-09-03T04:17:35.563709239Z`, `RestartCount=0`. Rollback tag
`eanhl-team-website-worker:pre-provenance-fix-f456740`
(`sha256:062f9343ab4d6d41caad6b7c6f618a39660412fc35f7abc7c31e8b49b1a1c184`)
was prepared but never needed — **no rollback was required.** `web`
(`dc582e0c782127b14c1ec68b307cd1cb5e9dedcb35e4af830ccfbe5292f940b3`) and `db`
(`9dacad8ce351629fd07cf640559e5d61fb1bc4d998a74feea28dbd12fd39b417`) were
confirmed unchanged before and after. Acceptance evidence: independently
observed successful ingest at `2026-09-03T04:34:21.383Z` (normal polling
resumed post-recreate); live synthetic-run invariant
`synthetic_runs=100, mismatches=0, single=60, mixed=40, legacy_mixed=40`;
and all nine intentionally non-synthetic `ocr_decoder_runs` rows (the ones
the pre-fix unconditional rule would have overwritten — see below) confirmed
unchanged in production. Full record:
[`docs/operations/deploy-f456740-worker-provenance-2026-09-02.md`](docs/operations/deploy-f456740-worker-provenance-2026-09-02.md).

### 🟡 CORRECTED, NOT DEPLOYED (SUPERSEDED — deployed 2026-09-02, see the "DEPLOYED" entry above) — decoder-run provenance eligibility boundary (2026-09-02)

Supersedes the "LOCAL-ONLY PASS" entry directly below: `765aecf` (the provenance
refresh) and `2143974` (the roadmap doc) are **committed on `main` and pushed to
`origin/main`** — that part of the entry below was accurate at the time and is
now stale only in saying "not yet committed, pushed". ~~They were **not**
deployed, and deployment is still not authorized here.~~ **Stale — deployed
worker-only on 2026-09-02, see the "DEPLOYED" entry above.**

An independent, read-only production review of the live `ocr_decoder_runs`
table (114 runs) found `765aecf`'s `refreshDecoderRunProvenance` had a real
defect: it derived `decoder_version` from child `ocr_segments` for **every**
run, not only synthetic/backfill ones. 9/114 runs mismatched under that rule —
all non-synthetic `decoder-runs-cli create-candidate` / reprocess runs (e.g.
run 1993: parent `hmm-viterbi-v2-pregame-cdef-wsb-toggle-lobby3fps-fuzzymerge`,
single child `hmm-viterbi-v2`). Those runs carry an intentionally more specific,
operator-chosen `decoder_version` (`tools/video_ingest/video_ingest/reprocess.py`
`DECODER_VERSION`) that is the run's own provenance/uniqueness lever
(`ocr_decoder_runs_provenance_uniq`); the unconditional rule would have
overwritten it on the next write to one of those 9 runs and could have hit a
uniqueness collision between sibling candidate runs.

- Migration 0048, `ensureSyntheticActiveRunForMatch`, and the pre-existing
  `ocr-decoder-runs-backfill.test.ts` already scope this rule to runs whose
  `notes` start with `'synthetic backfill'`. Correction commit `03b7f12`
  (`fix(db): scope decoder-run provenance refresh to synthetic runs only`)
  brings `refreshDecoderRunProvenance` in line with that existing boundary —
  non-synthetic runs now come back from a refresh completely untouched.
  Parent-before-child locking and the symmetric two-writer concurrency
  behavior are unchanged.
- Two new production-shaped regression tests were added (non-synthetic parent
  and generic child decoder, including a repeated/idempotent write; two
  sibling candidate runs sharing `(match_id, video_sha256, weights_hash)`),
  plus a mutation check: reverting the eligibility guard reproduces both
  failures, including the exact uniqueness-constraint collision the fix
  prevents.
- Verification: focused file (5/5), `ocr-decoder-runs-backfill.test.ts`
  (4/4), the **full worker suite twice** (630 passed / 0 failed / 4 skipped,
  identical both runs), `@eanhl/db` (39/39), `@eanhl/db` + `@eanhl/worker`
  build and typecheck, ESLint clean on both changed files (the pre-existing
  `ocr-decoder-runs.ts` baseline errors are unchanged and out of the diff
  range), Prettier clean, `git diff --check` clean.
- **The 9 live mismatched rows were left exactly as they are.** This was a
  read-only investigation of production; no `ocr_decoder_runs` row was
  repaired, normalized, or otherwise written.
- **Deployment preflight recommendation:** safe to deploy worker-only once
  authorized — the fix only narrows an already-narrow write path, all
  regressions are green, and no production data was touched. ~~Still requires
  the normal explicit deploy authorization; not performed here.~~ **Stale —
  deployed worker-only on 2026-09-02 under explicit authorization; see the
  "DEPLOYED" entry above.**

### 🟡 LOCAL-ONLY PASS — decoder-run provenance recurrence prevention (2026-09-02)

The source-level follow-up from the 2026-08-16 38-row production repair is now
implemented and independently reviewed in the working tree. The exact parent
`ocr_decoder_runs` row is locked `FOR UPDATE` before its child `ocr_segments`
upsert; the child write and run-scoped provenance refresh then commit in the
same transaction. This prevents both stale mixed-decoder metadata and the
lock-upgrade deadlock exposed by two concurrent writers.

- The symmetric regression drives two real `writeSegmentForBatch` calls for
  the same run, proves both are concurrently blocked before the gate opens,
  then requires both to commit with truthful child tags and a `legacy-mixed`
  parent disclosure.
- Claude's reviewed mutation removed the pre-insert lock: the symmetric test
  alone failed on PostgreSQL `40P01 deadlock detected` (2/3 passed). Restoring
  the lock returned the focused file to 3/3 repeatedly.
- Independent management verification: **26 tests passed, 0 failed, 0 skipped**
  across the provenance, association/linkage, backfill, period-family lock,
  typed-v1 carve-out, and live-run-filter selections. `@eanhl/db` and
  `@eanhl/worker` build and typecheck all passed. The new test has zero ESLint
  errors; the 10 `ingest-ocr.ts` and 5 `ocr-decoder-runs.ts` errors are the
  documented pre-existing baseline only. Focused Prettier and
  `git diff --check` pass.
- Source files in the focused implementation: `apps/worker/src/ingest-ocr.ts`,
  `packages/db/src/queries/ocr-decoder-runs.ts`, and
  `apps/worker/src/__tests__/decoder-run-provenance-refresh.test.ts`.
- ~~Not yet committed, pushed, or deployed.~~ **Stale — see the "CORRECTED,
  NOT DEPLOYED" entry above.** This was committed as `765aecf` and pushed to
  `origin/main` shortly after this entry was written, but the patch it
  describes had a real defect (the derive-from-children rule was not scoped
  to synthetic runs) found by a later independent production review and fixed
  in `03b7f12`. Still not deployed.
- No production data operation, rescue execution, migration, deployment, or
  service restart occurred during implementation or review.

### 🟢 DEPLOYED — website Workstreams A/B/C at `36764a` (2026-08-16)

The five-commit checkpoint through `36764a6` (Workstreams B, A, C, D, and the
documentation-integrity correction) was successfully fast-forward pushed to
`origin/main`; the pre-push `verify-ocr` hook passed all five stages. In a
separate, later session, Workstreams A/B/C were deployed web-only after
explicit operator authorization (`DEPLOY WEB WORKSTREAMS 36764A`), built from
an isolated `git archive 36764a6` snapshot — not the mutable working tree.
Full record: [`docs/operations/deploy-36764a-web-workstreams-2026-08-16.md`](docs/operations/deploy-36764a-web-workstreams-2026-08-16.md).

- **Commits (in order):**
  - **Workstream B:** `4a38395016c57e89c8f070b4fe1139f2abef135f` — `feat(web): add family-aware OCR coverage pills`
  - **Workstream A:** `3227b34fa098e71f2999ea1e1ed3159e1fad6ced` — `feat(web): shape 3s lineups by game mode`
  - **Workstream C:** `4f980adfb17f136357334627546b34393499e771` — `fix(web): polish box score and lineup borders`
  - **Workstream D:** `234947bcbdf3038984b1f9f61ab26413a345b73d` — `docs: reorganize docs and consolidate handoff`
  - **Documentation-integrity correction:** `36764a621ae0e583d03c692899c6627696ffe59a` — fixed the Active State entry going stale immediately after D, and ~206 unrebased repository-relative links in the archived `docs/archive/handoff-history-2026-08-03.md`.
- **Web now runs image `00a401fd31e3` in container `dc582e0c7821`** (was image `089f0b6938c1` in container `fe2e820b92d4`). Rollback tag `eanhl-team-website-web:pre-workstreams-36764a` points to the old image `089f0b6938c1`. **Rollback was not needed.**
- **Worker and database were unchanged** — same containers/images/`StartedAt` throughout; neither was recreated or restarted.
- **OCR fixtures 250 (Full) / 563 (Partial) / 249 (Minimal) / 231 (no pill) all passed.** 3s match 563 passed its C/W/D/G check (`silkyjoker85`/`camrazz`/`JoeyFlopfish`/AI-no-human-G) and its duplicate-collapse check (ten raw `JoeyFlopfish` LD/RW rows collapsed to one D row, no LD/RD slot labels in shaped output).
- **All required routes returned 200:** `/`, `/games`, `/games/250`, `/games/253`, `/games/563`, `/games/249`.
- No database migration or production data operation was part of A/B/C/D or the correction. Workstream B's database integration tests wrote only to disposable `eanhl_test_*` test clones, never to production. This deployment did not apply migration 0056 — it was already live (see the 0056-APPLIED entry below); deployment preflight only confirmed the three family review-status columns were present.

This entry supersedes the prior "LOCAL-ONLY ... 5 ahead / 0 behind, not
pushed, not deployed" language — those five commits are now pushed and
A/B/C are now deployed. (This documentation update itself, recorded
separately below, puts local `main` one commit ahead of `origin/main` again
until it is pushed — check `git status`/`git rev-list` for the current
ahead/behind rather than trusting a hard-coded count here.)

### 🟢 SYNCED — decoder-provenance repair (38 rows) and `main`→`origin/main` push (2026-08-16)

**Historical, as of this push session:** `main` was synchronized with `origin/main` at `a97ce87c655e9ce7145653837f18df5c7b1eba9c` (0/0 ahead/behind at that point), pushed by fast-forward (81 commits, no force, no `--no-verify`). **This is no longer the current state — see the top Active State entry for the current local/remote position.** An initial push attempt was correctly blocked by the pre-push `verify-ocr` hook on a real worker test failure caused by 38 `ocr_decoder_runs` rows left stale (`legacy-passthrough-v0-video`) after the Stage-B rescue attached a second decoder's segments to them without refreshing parent provenance. An authorized, read/write-scoped repair updated exactly those 38 rows to `legacy-mixed` in one transaction (backup + repair + rollback SQL all hashed and preserved); the retried push then passed all five verify-ocr stages and went through. Full record, including the exact 38 run IDs, before/after counts, and the still-open source-level follow-up (no code path yet refreshes parent-run provenance on attachment): [`docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md`](docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md).

### 🟢 DEPLOYED — worker `/health` NULL `finished_at` bug (2026-08-16, fixed and deployed same day)

- **Root cause confirmed:** `fetchLatestCompletedSuccess` in `apps/worker/src/health.ts` selected `status = 'success'` rows ordered by `finished_at DESC` with no NULL filter. Postgres sorts NULL first under `DESC`, so any successful-but-unfinished row (three exist in prod's `ingestion_log` history) always won `ORDER BY ... LIMIT 1`, ahead of real completed ingestions — `/health` returned 503 despite recent healthy runs.
- **Source fix and regression tests are implemented and now deployed**, committed as `a97ce87c655e9ce7145653837f18df5c7b1eba9c` on `main` (parent `540777a`). `and(eq(status, 'success'), isNotNull(finishedAt))` added to the query; `health.ts` split into `fetchLatestCompletedSuccess` (DB query) + `buildHealthPayload` (pure status shaping) + `getHealthPayload` (unchanged public entry point) so both halves are independently testable.
- **Correction pass (same day) fixed two test-quality problems in the initial checkpoint:**
  - 15 ESLint errors in the new test file (`consistent-generic-constructors`, `dot-notation` ×6, `array-type`, `no-unnecessary-type-conversion`, `no-floating-promises` ×7) — all fixed with no `eslint-disable`. `pnpm --filter worker exec eslint src/health.ts src/__tests__/health-endpoint.test.ts` exits **0**, verified directly, not inferred.
  - The "only NULL-finished_at successes never surface as the winner" test was a no-op — the cloned test DB always carries real completed rows, so it passed regardless of whether the fix was applied. Replaced with a transaction-isolated regression: opens `db.transaction`, flips every real completed success's `status` to `'error'` (a status update, not a delete — `raw_match_payloads` FKs to `ingestion_log.id` with no `ON DELETE` clause), inserts two NULL-`finished_at` successes, asserts the query-visible success set really is NULL-only, calls `fetchLatestCompletedSuccess(tx)` and `buildHealthPayload`, asserts the full 503-degraded/`lastSuccessfulIngest: null` shape, then deliberately rolls back via `tx.rollback()` (caught as `TransactionRollbackError` — the cloned fixture is provably unchanged).
  - `fetchLatestCompletedSuccess` gained one small addition beyond the accepted WHERE-clause fix: it now accepts `executor: HealthQueryExecutor = db` (a `Pick<typeof db, 'select'>`, mirroring the existing `DbConn` pattern in `ingest.ts`) so tests can pass a `tx` in place of `db`. It also throws instead of silently falling back to `null` if a selected row ever has `finished_at === null` — that branch is unreachable while the accepted filter is intact, so this changes no current behavior, but it was necessary: the prior silent fallback made the new isolated test pass even with `isNotNull` removed, which the task required it to catch. Verified by mutation: removing `isNotNull` now fails 3/7 tests (including the new isolated one) with the explicit invariant-violation message; restoring it returns all 7 to green.
- **Deployment (2026-08-16, separate session from the fix):** built worker-only from an isolated `git archive a97ce87` snapshot (`/tmp/eanhl-a97ce87-snapshot-8336`), never from the dirty primary working tree (which, at the time, carried unrelated lineup/OCR-coverage/games-list/db-query drift, untouched throughout that build — that drift was later committed as workstreams A/B/C on 2026-08-16; see the top entry of Active State). Old image `1e0e30e63890` rollback-tagged `eanhl-team-website-worker:pre-health-fix-a97ce87`. New image `062f9343ab4d` built, verified to contain the fix, deployed worker-only (`--no-deps --force-recreate worker`) after explicit operator authorization (`DEPLOY WORKER HEALTH A97CE87`). `web` and `db` containers/images were never touched (container IDs, image IDs, and db `StartedAt` all confirmed unchanged before/after). Full record: [`docs/operations/deploy-a97ce87-worker-health-2026-08-16.md`](docs/operations/deploy-a97ce87-worker-health-2026-08-16.md).
- **`/health` now returns HTTP 200** (`{"status":"ok","lastSuccessfulIngest":"2026-08-16T16:44:03.659Z","secondsSinceLastIngest":0}`), matching the DB's actual latest completed `ingestion_log` row exactly. The three historical NULL-`finished_at` success rows (ids 17468, 69577, 81472) remain present and untouched — read-only verification only, no repair performed. Worker logs clean, `RestartCount=0`, no restart loop, one normal ingestion cycle completed post-deploy (routine scheduled worker write, not manually invoked).

### 🟢 RECONCILED — 97-window rescue: 75 promoted, 1 failed, 21 not-attempted-by-design; promotion-key reconciliation and decoder-version questions are CLOSED (2026-08-15)

**Read this first on a cold start. This entry supersedes the 2026-08-03 "STAGE B IMPLEMENTED... nothing executed, nothing is committed" entry immediately below.** That entry's "uncommitted" claims and its "next session: execute the 97 windows" instruction are stale and must not be followed as written. It also supersedes this same day's earlier "up to ~20 un-receipted" reconciliation pass — that estimate is now replaced by exact, receipt-proven totals below.

#### Proven by git/source (HEAD = `540777a` on `main`, history `47c1ecd..540777a` inspected)

- Everything the 2026-08-03 entry called uncommitted is committed: the Stage B executor (`rescue_execute.py`, `scripts/execute_rescue_manifest.py`, `tests/test_rescue_execute.py` — `f55a58d`, `d32b50b`), the pipeline-wide cache-root preflight (`video_ingest/cache_root.py` — `b863ebb`), the rescue sampling/manifest/transform modules (`9ec9df0`), and a SHA-bound rescue execution allowlist added **after** Stage B (`rescue_allowlist.py` — `8627fae`, `06b1986`).
- A second, unrelated workstream landed in the same window and is **not documented anywhere else in this file**: per-family period review-gating/locking (`ab8dd28` → `3038821`, 2026-08-07 to 2026-08-09) — migration `0056_period_family_review_status.sql`, `packages/db/src/lib/period-reconciliation.ts`, and review-cascade/promotion-authorization/lock-ordering changes across `apps/worker` and `packages/db`.
- `540777a` (HEAD, 2026-08-09) is a 4-file lint cleanup on top of the period-family commits. **It has already passed independent management review and is accepted — do not revisit or change it.**
- `main` was synchronized with `origin/main` on 2026-08-16, through `a97ce87c655e9ce7145653837f18df5c7b1eba9c` (81 commits, fast-forward push), and was 0/0 against `origin/main` at that point in the session. **Workstreams A/B/C were committed after that push — see the top Active State entry for the current local/remote position.** See the "SYNCED" entry and [`docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md`](docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md) for the push, the blocking test failure, and the decoder-provenance repair that unblocked it.
- This reconciliation session touched only `HANDOFF.md`. The rest of the dirty/untracked working tree (`apps/web`, `packages/db/src/queries/index.ts`, `docs/`, the deleted assets, the OCR-pill/lineup-shape/ocr-coverage additions) was unrelated in-progress drift and was left untouched **at that time; it was later committed as workstreams A/B/C on 2026-08-16 (see the top entry of Active State) and is no longer dirty/untracked.**

#### Verified final state of the 97-window auto rescue (read-only reconciliation, `audit-v3-REPORT.md` + `RUN-METADATA.json` for `rescue-b2-20260807T031344Z`, exact promotion-key matching — see 2026-08-15 rescue-reconciliation session)

97 unique auto-window promotion keys in the manifest, exhaustively classified by exact 3-tuple key match (`video_sha256`, `batch_dir`/`source_directory`, `run_id`):

| classification       |  count |
| -------------------- | -----: |
| promoted             |     75 |
| attempted and failed |      1 |
| not attempted        |     21 |
| ambiguous            |      0 |
| **total**            | **97** |

- **77 receipt lines represent 76 unique promotion keys.** The one duplicate is match 2398 / seg 9004 / `box_score_faceoffs` / run 2103: `failed` in the `rescue-b2-20260805T031634Z` run, `promoted` on retry in `rescue-b2-20260805T040226Z` — a legitimate failed-then-promoted retry, correctly counted once as promoted.
- **The sole failed-only window is match 2661, `post_game_faceoff_map`, segment 9002, run 2119** (video sha `4b8a77d091a9…`). DB batch **5051** was created for this window and holds **2 extraction rows, both `transform_status='error'`, both caused by `PERIOD_LABEL_UNRECOGNIZED`** — 0 successes. `ingest-ocr`'s ffmpeg/OCR subprocess steps exited 0 (so the batch row exists), but the rescue executor's own completion check requires at least one extraction to reach `transform_status='success'`, which never happened — hence the receipt correctly reads `failed` even though a DB row exists.
- **76 rescue batches = 75 promoted batches + this 1 failed-but-batch-created window.** The 76-vs-75 gap is fully explained by batch 5051 and nothing else.
- **211 `ocr_extractions` rows** join to the 76 rescue batches.
- **22 total non-promoted windows (1 failed + 21 not attempted), split into two disjoint groups:**
  - **8 total are `post_game_faceoff_map` windows** — 1 attempted and failed (match 2661, above) plus **7 not attempted** — withheld pending ROI/OCR remediation. `audit-v3-REPORT.md` (§2–5) traces the root cause: the classifier had no screen-specific branch for `post_game_faceoff_map`, so faceoff-map windows fell through to a generic `wrote_anything` check that a partial/geometrically-unreliable read could satisfy. Under the corrected contract, 6 of the 8 recover 0/9 dot-map cells (`WITHHOLD-FALSE-SUCCESS`) and 2 recover a partial 5/9 or 6/9 under ROI geometry independently confirmed broken (`NEEDS-REMEDIATION`) — 0 of the 8 reach a trustworthy 9/9. None qualify for execution until the faceoff-map ROI/OCR pipeline is fixed.
  - **The other 14 windows are non-faceoff-map, all not attempted** (a mix of `box_score_goals`, `box_score_shots`, `box_score_faceoffs`, `net_chart` windows). The archived audit-v3 semantic audit **deliberately excluded all 14 as a group**; it states only in aggregate that their reasons were unchanged from the v2 audit (`audit-v3-REPORT.md` §5) and never enumerates them individually. **The original per-window labels (`NEEDS-REMEDIATION` / `WITHHOLD-FALSE-SUCCESS` / `NO-OP`) and the per-window gate OCR payloads are gone** — they lived under `/tmp` and were deleted. The follow-up read-only semantic review has now been done and returned **PARTIAL** — see the [2026-08-15 durable audit](docs/calibration/rescue-non-faceoff-exclusion-audit-2026-08-15.md). It independently verified the 14 promotion keys, their non-execution (no receipts, no database batches), the present database coverage each exclusion left behind, and the promoter write semantics — but **all 14 individual archived labels remain UNVERIFIED**, and no exact label may be attributed to any single window. Present coverage: **6 windows have complete expected-period coverage today** (they are not, however, proven payload-level execution no-ops — the promoter inserts a new row for any payload period that does not already exist, and the payloads are unrecoverable); **1 window has a known fillable existing-period cell** (2404 P2 `shots_for`); **7 target expected-period coverage that is still empty**. These must **not** be re-added to any execution allowlist on the strength of the archived aggregate audit.
  - So: **21 not attempted = 7 faceoff-map + 14 non-faceoff; 22 non-promoted = 8 faceoff-map (7 not-attempted + the 1 failed) + 14 non-faceoff.** All 22 are enumerated exactly (match/screen/segment/run, with full promotion keys) in the 22-window reconciliation table in [`docs/calibration/rescue-non-faceoff-exclusion-audit-2026-08-15.md`](docs/calibration/rescue-non-faceoff-exclusion-audit-2026-08-15.md) §2 — `audit-v3-REPORT.md` itself enumerates and analyzes only the 8 faceoff-map windows and states that the 14 non-faceoff exclusions are unchanged from the v2 audit; it does not contain the 22-window table.

#### Reconciliation completeness and the two rescue rollback handles — now resolved

- **Promotion-key reconciliation is complete across all 97 auto keys, not receipt coverage.** Every one of the 97 resolves to exactly one of: promoted (75), failed (1), or knowingly-excluded-not-attempted (21). The 77 receipt lines cover 76 unique keys; the remaining 21 exact keys have neither receipts nor matching database batches — they were deliberately excluded from execution, not lost. There is no unaccounted gap — the prior "up to ~20 un-receipted" language reflected an incomplete search pass, not a real coverage hole.
- **`rescue-b2-anchor-v1` is present in the database, on the segment layer.** The executor (`tools/video_ingest/video_ingest/rescue_execute.py`) documents two rollback handles at two different layers: `ocr_capture_batches.source_directory LIKE '%/rescue/%'` (batch layer) and `ocr_segments.decoder_version = 'rescue-b2-anchor-v1'` (segment layer) — see its module docstring and the `Rollback handles:` line in `scripts/execute_rescue_manifest.py`'s `COMPLETION_SQL`/report output. Independent read-only verification confirms both: all 76 `ocr_segments` rows tied to the 76 rescue capture batches carry `decoder_version='rescue-b2-anchor-v1'` (zero rows with any other value), while the 38 distinct `ocr_decoder_runs` rows those batches reuse were, at the time this paragraph was first written, still tagged `legacy-passthrough-v0-video`. **That is no longer current: on 2026-08-16 those 38 parent runs were repaired to `legacy-mixed`** (see the "SYNCED" entry at the top of Active State and [`docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md`](docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md) for the exact 38 run IDs and before/after counts). The 76 segment-level `rescue-b2-anchor-v1` tags described below were never touched by that repair and remain unchanged and valid. These facts were compatible, not contradictory, even before the repair: `ocr_decoder_runs` records the pre-existing parent decoder runs the rescue batches attach to, while `ocr_segments` records the rescue-produced segments themselves and correctly carries the rescue decoder tag. **Both `source_directory LIKE '%/rescue/%'` and `ocr_segments.decoder_version='rescue-b2-anchor-v1'` are real, valid rollback/audit handles** — a rollback filtered on either would correctly select the 76 rescue rows, not zero.

#### Next-action ruling (documentation-only; does not authorize execution)

- **Do not rerun any of the 22 outstanding windows** (1 failed + 21 not-attempted) as a blind resume batch.
- **Faceoff-map work (8 windows) requires ROI/OCR remediation first** — no window in the current dataset produces geometrically trustworthy evidence for that screen; this includes match 2661's failed window, which needs a period-label OCR/ROI fix, not a re-run of the existing pinned command (it will reproduce the identical `PERIOD_LABEL_UNRECOGNIZED` rejection).
- **The 14 non-faceoff-map exclusions have now had their separate read-only semantic review, and it returned PARTIAL** ([`docs/calibration/rescue-non-faceoff-exclusion-audit-2026-08-15.md`](docs/calibration/rescue-non-faceoff-exclusion-audit-2026-08-15.md)). All 14 archived labels are UNVERIFIED and unrecoverable. The 8 information-bearing windows (the 7 with empty expected-period coverage, plus 2404 shots seg9017) require **fresh read-only re-capture + OCR and re-simulation inside an audit harness** — not a production execution — before any of them could be reconsidered. The other 6 are reasonable to deprioritize as coverage-recovery targets because their expected coverage already exists, which is _not_ the same as proving their execution inert. **None of the 14 is authorized for execution.**
- **That re-capture + re-simulation of the 8 information-bearing windows has now been done, read-only, and returned PARTIAL** — [`docs/calibration/rescue-non-faceoff-resimulation-2026-08-15.md`](docs/calibration/rescue-non-faceoff-resimulation-2026-08-15.md). Frames were regenerated with the manifest's own ffmpeg argv (sole difference: output redirected to `/tmp`), OCR'd through the DB-free `game_ocr.cli extract` path, and replayed against a pure in-memory mirror of the current promoters. **It is a new current-code audit and explicitly does NOT reproduce or corroborate the deleted audit-v2 labels, which remain UNVERIFIED.** Current-audit dispositions: **SAFE-TO-PROPOSE 1 · WITHHOLD-INVALID 4 · WITHHOLD-REDUNDANT 1 · NEEDS-REMEDIATION 2 · UNVERIFIED 0 = 8.** Only **2676 goals seg9003** is SAFE-TO-PROPOSE (payload reconciles exactly with the EA 3–2 final in both directions, fills 8 empty goals cells, no phantom period, no overwrite). Three findings generalize beyond these eight windows: (a) the schema-2 and schema-3 manifests specify **different frame selection** and run 3 executed schema 3 — four of the eight windows produce materially different payloads depending on which is used; (b) `net-chart.ts`'s ALL PERIODS recompute is a **last-writer-wins unconditional overwrite** that propagated a `71` header misread into match 1090's game total (EA: 8); (c) a box-score payload whose period headers all fail to normalize writes nothing yet still records `transform_status='success'` — the same false-success shape audit-v3 found on the faceoff-map screen. **No allowlist was created and no window is authorized for execution**; SAFE-TO-PROPOSE is a recommendation for later management review only.
- **This documentation session does not authorize rescue execution.** Deciding whether/when to resume any of the 22 windows is a separate approval decision.

#### 🔴 BLOCKED — live schema drift audit: migration 0056 is entirely unapplied (read-only, 2026-08-15) — ✅ **RESOLVED the same day; see "0056 APPLIED" below, which supersedes this subsection's drift findings**

A separate read-only schema audit has now run — [`docs/calibration/live-schema-drift-audit-2026-08-15.md`](docs/calibration/live-schema-drift-audit-2026-08-15.md). Verdict **BLOCKED**. Nothing was written: no migration applied, no schema/data change, no container touched, no rescue executed, no allowlist created.

- **`0056_period_family_review_status.sql` is entirely absent from the live DB — 0 of 11 artifacts.** Missing: `goals_review_status`, `shots_review_status`, `faceoffs_review_status`, their three CHECK constraints, all three backfills, and all four column comments. `match_period_summaries` is live at **14 columns** vs **17** expected. Not partially applied.
- **Drift is limited to 0056.** Every artifact of migrations **0046–0055 is present and correct**, verified object-by-object against `pg_catalog`/`information_schema`. (One cosmetic item: 0046's 64-char FK name is truncated by Postgres to 63 chars — the constraint is correct, only the literal name differs.)
- **`drizzle.__drizzle_migrations` DOES exist** — in the **`drizzle`** schema, not `public`; the earlier "missing ledger" reading looked in the wrong schema. **It is not trustworthy**: 47 rows, journal frozen at 0045, and of the hand-written migrations only **0048** has a (manual) row. Trusting it would have produced **nine false negatives**. Migration state here must always be proven by direct schema inspection.
- **⚠️ `pnpm --filter db generate` is a live hazard** — the newest snapshot is `0045_snapshot.json`, so generate would diff against it and emit a migration re-creating the already-applied 0046–0055 objects. **`pnpm --filter db migrate` is a no-op today only by timestamp accident**, and would split 0056 at its `statement-breakpoint` markers, forfeiting atomicity. **The `schema-change` skill still prescribes both — it is stale and must be corrected.** 0056 must be applied by hand, unchanged, per the 0046–0055 convention: `docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - < packages/db/migrations/0056_period_family_review_status.sql`. **Migration 0056 owns its own transaction** via its internal `BEGIN` (line 63) / `COMMIT` (line 144), so no external wrapper is needed — `ON_ERROR_STOP=1` is required (a failure before the file's `COMMIT` stops psql and the uncommitted transaction rolls back), and **`-1` / `--single-transaction` must NOT be added** on top of the file's own transaction control (verified: it produces `WARNING: there is already a transaction in progress` … `WARNING: there is no transaction in progress`). Do not strip `BEGIN`/`COMMIT` from the migration.
- **Deployed containers are NOT broken** (confirmed, not assumed): web image built 2026-08-02, worker 2026-06-01, both predating the period-family commits (2026-08-07→09); in-container `grep` finds **zero** references to the family columns. Both services healthy. **The real present-day footgun is the host build** — `packages/db/dist` and `apps/worker/dist` were rebuilt 2026-08-09 **with** the 0056 code, so `reconcile-periods` / `auto-drain` / `ingest-ocr-review` fail with `42703` against the live DB **right now**.
- **Where `HEAD` breaks:** `getMatchPeriodSummaries` throws 42703 and — behind `safe(…, [])` in [games/[id]/page.tsx](apps/web/src/app/games/[id]/page.tsx#L115) — **silently degrades the match page to zero period summaries** with no error and no log. Also broken: `promoteOcrPeriodFamily`, `periodFamilyRejectionBarrier`, `countPendingOcrPeriodFamilies`, the worker review cascade, and the box-score promoter's **INSERT** path (Drizzle emits all 17 column names, proven via `.toSQL()`; the UPDATE path is unaffected).
- **Migration impact is small and safe when authorized:** 259 rows / 65 matches / 112 kB; backfill = **777 row updates** (3 × 259); `ADD COLUMN … NOT NULL DEFAULT` is metadata-only on PG16 (no rewrite); ACCESS EXCLUSIVE held for a sub-second transaction; `pg_stat_activity` clean. **Visibility parity verified: 88 rows exposed before, 88 after** — no row changes visibility. No CHECK conflicts (only `pending_review` 171 / `reviewed` 88 exist), no triggers, rules, or dependent views.
- **Ordering ruling: migrate → rebuild → redeploy.** Applying 0056 first is safe for the running containers. **Redeploying `HEAD` before applying 0056 would silently empty the match page's period summaries.** A verified `pg_dump` and a written rollback script are prerequisites; rollback stops being lossless once per-family review begins.

#### ✅ 0056 APPLIED — schema-drift blocker REMOVED; deployment drift now inverted (2026-08-15)

**Migration `0056_period_family_review_status.sql` was applied to the live `eanhl` database and PASSED all verification.** Full record: [`docs/operations/migration-0056-application-2026-08-15.md`](docs/operations/migration-0056-application-2026-08-15.md). This supersedes the drift findings of the BLOCKED subsection immediately above (that audit was correct when written).

- **Authorized** by explicit operator confirmation at a hard gate, after read-only preflight and a verified backup. Applied by hand, file unchanged (SHA-256 `c94a0498…4baa8`), `ON_ERROR_STOP=1`, the file's own `BEGIN`/`COMMIT` owning the transaction — **no `-1`/`--single-transaction`, no `drizzle-kit`**. `psql` exit **0**, stderr empty: `BEGIN · DO×4 · COMMENT×4 · COMMIT`. Atomic — all 11 artifacts landed together.
- **Verified post-migration** in fresh read-only sessions: **17 columns** (was 14); the three family columns are `text NOT NULL DEFAULT 'pending_review'`; all **3 CHECK constraints** present with the correct union; all **4 column comments** present; **259 rows / 65 matches unchanged**; **backfill fidelity exact — 0 mismatches** (`goals_ = shots_ = faceoffs_review_status = review_status` on every row); each family **171 `pending_review` / 88 `reviewed` / 0 `rejected`**; **visibility parity holds — 88 rows before and after**. Indexes, PK, unique constraint and both FKs unchanged; still 0 triggers / 0 rules / 0 dependent views. A post-migration CSV of all 14 pre-existing fields is **byte-identical** (same SHA-256) to the pre-migration snapshot.
- **`drizzle.__drizzle_migrations` was deliberately NOT touched** — 47 rows, ids 1–49, fingerprint `120b92b2…` identical before and after. No ledger row was inserted for 0056. **The ledger-policy question (only 0048 has a manual row) remains open and undecided.**
- **Durable backup outside the repo:** `/home/michal/backups/eanhl/20260816T025127Z-migration-0056/` — verified custom-format `eanhl-pre-0056.dump` (27,227,434 B, `69882d2d…`), pre-migration CSV of all 259 rows (`33f404bc…`), and a reviewed-but-**unexecuted** `rollback-0056.sql` (`59f24540…`). Dump readability was proven before applying: `pg_restore --list` exit 0 **and** a full `pg_restore -f /dev/null` archive read exit 0, decoding **319,326,074 bytes** of SQL. ⚠️ **Rollback is lossless only until per-family review diverges from `review_status`** — the script carries the divergence gate to run first.
- **⚠️ Deployed images still contain the OLD whole-row behavior.** No rebuild, no redeploy, no container restart or recreation happened. `eanhl-team-website-web-1` (image built 2026-08-02) and `eanhl-team-website-worker-1` (2026-06-01) both predate the period-family commits and still gate on whole-row `review_status`. **The drift is now inverted: the database is ahead of the deployment.** That is the safe direction — 0056 is additive and visibility-neutral, and neither container references the family columns — but nothing about the running system's behavior changed today.
- **Next session (separate): rebuild → redeploy → smoke test.** `pnpm --filter @eanhl/db build`, then `pnpm --filter @eanhl/worker build`, then `docker compose build web worker` per the `docker-redeploy` skill; then load a match page with `reviewed` rows and confirm period summaries render, and run `reconcile-periods --all --json` (read-only) to confirm no `42703`. **None of that was done or authorized here.** The host `dist` build (rebuilt 2026-08-09 with the 0056 code) should now work against the migrated DB, but this was **not exercised** — do not assume it until verified.
- **Still stale and still dangerous:** the `schema-change` skill (§1) continues to prescribe `pnpm --filter db generate` + `pnpm --filter db migrate`, both hazards under the frozen-journal convention. It was **not** followed for this migration and remains uncorrected — fixing it was outside this session's scope.
- **Not done, deliberately:** no `VACUUM ANALYZE` (a write, and unnecessary to accept the migration — the table has still never been analyzed); no worker review, promotion, rescue, ingest, auto-drain or reconciliation command; no application source change; no commit, push or stash. HEAD is still `540777a`; all pre-existing dirty/untracked files preserved. **Repository files changed by that session: exactly two** — the new `docs/operations/migration-0056-application-2026-08-15.md` and this HANDOFF top entry.
- **🔴 RESCUE REMAINS BLOCKED.** Applying 0056 removed only ground (2), and only at the schema layer. **Ground (1) — authorization — stands untouched: the resimulation's PARTIAL result is unchanged, SAFE-TO-PROPOSE is not execution authority, and NO ALLOWLIST EXISTS OR WAS CREATED.** The 8 faceoff-map windows remain independently blocked on ROI/OCR remediation. Match 2676 goals seg9003 run 2131 is still not authorized. No rescue command of any kind ran.

**Operational ruling — rescue execution REMAINS BLOCKED, now on two independent grounds:** (1) **authorization** — the resimulation's PARTIAL result stands, SAFE-TO-PROPOSE is not execution authority, and no allowlist exists; (2) **technical incapacity** — the read boundary, the per-family promotion path, the rejection barrier, the review cascade, and the promoter INSERT are all `42703` against the live schema. The one SAFE-TO-PROPOSE window (**2676 goals seg9003 run 2131**) would take the promoter's **UPDATE** path — all four period rows exist with NULL goals — so it would _not_ hit the INSERT failure; **this does not unblock it**, because it is unauthorized, its surrounding review machinery is broken, writing it under whole-row `review_status` semantics would reintroduce the exact defect 0056 closes, and its payload is sampling-mode dependent. The 8 faceoff-map windows remain independently blocked on ROI/OCR remediation. **Applying 0056 is a separate, separately-authorized session; doing so removes only ground (2) and still leaves the authorization decision open.**

#### ✅ DEPLOYED — web/worker rebuilt and redeployed from exact HEAD `540777a`; smoke-tested PASS (2026-08-15)

**`eanhl-team-website-web-1` and `eanhl-team-website-worker-1` now run images built from an isolated snapshot of `540777a`, deployed after explicit operator authorization (`DEPLOY CLEAN HEAD 540777A`).** Full record: [`docs/operations/deploy-540777a-period-family-2026-08-15.md`](docs/operations/deploy-540777a-period-family-2026-08-15.md). This supersedes the "deployed images still contain the OLD whole-row behavior" caveat in the 0056-APPLIED subsection above.

- **Built from `git archive 540777a…` into `/tmp/eanhl-deploy-540777a-snapshot`, never from the dirty primary working tree.** Verified the snapshot excludes the OCR-pill/lineup-shape/ocr-coverage untracked additions (later committed as workstreams A/B on 2026-08-16) and contains no `.env`, while it does contain the 0056 migration and family-column query code.
- **Old images tagged for rollback** (`eanhl-team-website-web:pre-0056-deploy-20260815` = `145c0bde76cd`, `…-worker:…` = `4b753d6cfdc2`) before building. New images: web `089f0b6938c1`, worker `1e0e30e63890` — both confirmed to reference `goalsReviewStatus`/family-column code, neither containing what were then the dirty untracked files.
- **Deployed with `--no-deps --force-recreate web worker` only.** `db` was never restarted or recreated — same container ID (`9dacad8ce351`) and `StartedAt` throughout.
- **Smoke tests: PASS.** `/`, `/games`, `/games/250` (reviewed sample), `/games/253` (pending-only sample) all **200**. `getMatchPeriodSummaries(250)` returns 4 rows matching the exact pre-deploy DB values (all three families `reviewed`); `getMatchPeriodSummaries(253)` returns **0 rows** — correctly masked, no `42703`. Read-only `reconcile-periods --all --json` on the new worker image: exit 0, valid JSON, 65 outcomes, **zero `promotedPeriods`**, no schema errors. Logs on both new containers clean of `42703`/`undefined_column`/restart-loop signs; worker completed a normal post-redeploy ingest cycle. DB invariants unchanged post-deploy: 17 columns, 0 backfill mismatches, 259 rows, 171/88 per-family distribution, Drizzle ledger untouched (47 rows).
- **One pre-existing, unrelated finding, not fixed (no source change authorized this session):** worker `GET /health` returns `503 degraded` because `apps/worker/src/health.ts` (unchanged since 2026-04-11) orders by `finished_at DESC` without excluding NULLs, and 3 historical `ingestion_log` rows (dated 2026-05-17, 2026-07-26, 2026-08-11 — all pre-dating this session) carry `status='success'` with `finished_at IS NULL`, which Postgres's `DESC`→`NULLS FIRST` default sorts first. Confirmed identical in the old (pre-redeploy) image code — not a deployment regression, rollback would not fix it. Left as a documented follow-up (e.g. `ORDER BY finished_at DESC NULLS LAST`).
- **Not done, deliberately:** no rollback (not triggered — the one health finding is proven pre-existing/unrelated), no `VACUUM ANALYZE`, no rescue/OCR/ingest/promotion work, no `--promote` on the reconcile CLI, no source-code or migration change, no commit or push. All pre-existing dirty/untracked working-tree files (3s lineup shaping, OCR coverage pills, games-list polish, `packages/db/src/queries/index.ts` drift) preserved byte-identical **at that time — this drift was later committed as workstreams A/B/C on 2026-08-16; see the top entry of Active State.** **Repository files changed by this session: exactly two** — the new `docs/operations/deploy-540777a-period-family-2026-08-15.md` and this HANDOFF top entry.
- **Rescue status unchanged** — still BLOCKED on both grounds from the subsection above; this deployment session did not touch rescue authorization or execution in any way.

---

### ✅ STAGE B IMPLEMENTED AND VERIFIED — the executor exists, nothing was executed, nothing is committed (SUPERSEDED — see the 2026-08-15 entry above) (2026-08-03)

**Read this first on a cold start.** Stage B is code-complete and green. **No rescue command has run, no DB row was written, no commit was made.** The read-only proof still reads 0 rescue batches / 0 rescue runs. The next session executes; this one only built the gate.

#### What exists now (3 new files, all uncommitted)

| file                                                    | lines | role                                                                                                               |
| ------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------ |
| `tools/video_ingest/video_ingest/rescue_execute.py`     |   773 | All Stage B policy. Pure over plain data + 3 injected IO seams (`promoted_keys`, `run_command`, `make_batch_dir`). |
| `tools/video_ingest/scripts/execute_rescue_manifest.py` |   179 | IO shell only — argparse, `docker exec psql`, `subprocess`.                                                        |
| `tools/video_ingest/tests/test_rescue_execute.py`       |   962 | 54 tests.                                                                                                          |

Same split as Stage A and for the same reason: `tests/` can import the `video_ingest` package but not `scripts/`, so all policy must live in the package to be testable.

**Stage B consumes the manifest verbatim.** It re-derives no classification, no identity, no window geometry and no decision. Where it appears to check Stage A's work it is _verifying a fingerprint_ — comparing the manifest's own window fields against the manifest's own argv — never recomputing a value.

#### Invocation

```bash
cd tools/video_ingest && PYTHONPATH=.:../game_ocr \
  ../../.venv-1/bin/python scripts/execute_rescue_manifest.py \
  --manifest ~/ingest-cache/rescue-manifest.json          # DRY RUN — default, safe
  # ... and only after reading that plan:  --execute
```

#### The nine approved gate conditions, and where each lives

1. **Complete-manifest validation** before anything — `validate_for_execution` runs Stage A's structural pass over _every_ window plus a policy check (schema 2, decoder tag, segment base, auto-eligible screens). A malformed **review** window aborts the run.
2. **Auto-only, valid non-null commands** — `command_problems` verifies each pinned argv against the window: screen, match, sha, segment index, geometry, capture kind, `--decoder-version`, `--run-id`, and exact `batch_dir` equality.
3. **Review/skip never execute** — filtered in `executable_windows`, re-checked at the moment of execution by `assert_executable`. Most skips legitimately keep runnable commands; that must not make them runnable.
4. **Exact artifact preflight** — `<cache-root>/<sha>/segments.json` for the distinct shas of the **auto set only**, plus each source video.
5. **All-or-nothing** — one missing artifact aborts before any subprocess _and_ before `promoted_keys` is called, so a broken manifest never reaches the DB. Never skips the window, never falls back to decoding.
6. **Provenance preserved** — receipts carry schema version, decoder version, rescue run id, manifest sha256, promotion key and a per-command fingerprint. Rollback handles unchanged: `source_directory LIKE '%/rescue/%'` and `decoder_version='rescue-b2-anchor-v1'`.
7. **Explicit opt-in** — dry run is the default and creates not even a directory. `--execute` is bound to the `EXECUTE_FLAG` constant the banner advertises.
8. **Idempotency** — `promotion_key` is a verbatim mirror of `ocr_capture_batches_video_sha_dir_run_uniq` = `(video_sha256, source_directory, run_id)`. Already-promoted windows are excluded **and reported**, never silently redone.
9. **Clean CLI errors** — every expected rejection is a `RescueAborted` the script turns into exit 1 with no traceback, same contract as `CacheRootUnusable`.

#### Verification

- video_ingest suite **822 passed, 5 skipped, 38 subtests, 0 failed** — baseline 768 re-run and confirmed this session, delta exactly +54 (the new tests). Zero regressions.
- **Mutation-tested, so the gates are known load-bearing:** disabling the decision filter broke 4 tests, the artifact preflight 4, the dry-run guard 3, the idempotency partition 3. Restoring each returned to green.
- **Stage B accepts the real approved manifest** (read-only: JSON parse + `stat`, no DB, no subprocess) — schema 2, 303 windows, **auto 97 / review 132 / skip 74** matching the v2 gate table; **validation problems 0**; 64 required artifacts (32 `segments.json` + 32 videos), **0 missing**; promotion keys **97/97 unique**, all carry `run_id`, all batch dirs carry `/rescue/`.

#### Five judgement calls, flagged for a ruling

There is **no separate Stage B plan document in this repo** — searched `docs/`, `research/` and git history. The documented constraints were this file's gate ruling plus the Stage A module contract, and neither conflicts with the nine conditions. These five go slightly beyond the literal wording:

1. Preflight covers **source videos too**, not just `segments.json` (condition 5 says "any referenced artifact"; better than an ffmpeg failure mid-run).
2. A manifest with **zero auto windows aborts** rather than reporting success — "nothing to do" is the exact shape the cache-root reboot trap took.
3. **No `--cache-root` override.** The manifest's `cache_root` is authoritative; substituting one would split a run between the path Stage B checks and the path `ingest-ocr` writes. Validates, never resolves — same stance as `cache_root.py`.
4. Fingerprint verification includes **exact `batch_dir` equality** against Stage A's own `rescue_batch_dir`, because that path is the rollback handle.
5. **Fail-fast** mid-run, resumable precisely because completed windows are then filtered out by the promotion key.

#### ⚠️ Repo state the next session must not rediscover

**Two complete, verified, UNCOMMITTED workstreams sit in `tools/video_ingest/`:**

- the pipeline cache-root preflight — `video_ingest/cache_root.py`, `tests/test_cache_root_preflight.py` (new), and `cli.py` / `reprocess.py` / `batch_ingest.py` (modified). Its tests are inside the 768 baseline.
- Stage B — the three files above.

The dirty `apps/web` and `packages/db` files are **unrelated drift** and must stay out of any rescue commit.

#### ⬜ NEXT SESSION

Execute the 97 auto windows. Start with a real dry run against the live DB (`--manifest ~/ingest-cache/rescue-manifest.json`, no `--execute`) and read the plan before opting in. Committing the two workstreams above is a separate approval decision that has not been made.

---

### ✅ STAGE A PASSES · manifest v2 APPROVED as Stage B's input — Stage B still blocked on the pipeline cache preflight (2026-08-03)

**Gate ruling by the user, 2026-08-03.** Stage A passes; the revised manifest is approved as the input to Stage B. Cited: resolution-failure review fell to **3.4 %**, below the 10 % gate; lookbacks were proven individually while the global safety rule stayed intact; ledger keys fail closed on drift; duplicate recordings cannot execute accidentally; all 41 changed decisions reconcile with **zero lost auto windows**; final verification 740 / 5 skipped / 38 subtests / 0 failures.

**Stage B execution remains BLOCKED by one prerequisite: the cache-root behaviour must be fixed and proven fail-closed in the actual `video-ingest` pipeline. The rescue script's local fix is explicitly NOT sufficient.**

Approved sequence:

1. ✅ Focused checkpoint of the three rescue files — `9314e8d` (code only; no unrelated files).
2. ✅ HANDOFF.md committed separately as docs.
3. ✅ Pipeline-wide cache preflight fixed and tested — `video_ingest/cache_root.py`, wired into `cli.py` / `reprocess.py` / `batch_ingest.py`. **Uncommitted.**
4. ✅ Stage B implemented and verified — see the top entry. **Uncommitted. Nothing executed.**
5. ⬜ **Next session: execute the 97 approved auto windows.**

The 126 expected-ambiguity windows, the five match-2400 windows and the one unresolved window **remain non-executable, and that is correct.**

The PAUSE → GAME STATS contamination is filed as a **separate high-priority Stage C issue** (see its own entry below). It does not invalidate this manifest and must not expand the rescue sessions.

---

### 🟢 IDENTITY RESOLVED · manifest v2 regenerated — review is now 3.4 % resolution-failure, 1 blocker left (2026-08-03)

**Remediation of Phase 1's inputs, not a numbered phase. Nothing executed: no ffmpeg, no DB writes, no Stage B.** The read-only proof still reads 0 rescue batches / 0 rescue runs. Manifest regenerated at `~/ingest-cache/rescue-manifest.json` (**schema_version 2**), 303 windows — the same 303 keys as v1, with identical `t0/t1/target_screen/match_id/run_id` everywhere. Only decisions moved.

#### Revised gate table

| decision |  v1 |  **v2** |   Δ |
| -------- | --: | ------: | --: |
| **auto** |  84 |  **97** | +13 |
| review   | 166 | **132** | −34 |
| skip     |  53 |  **74** | +21 |

**Review broken down by reason class** — the thing the gate asked for:

| class                 | windows | % of 303 | what it is                                                                     |
| --------------------- | ------: | -------: | ------------------------------------------------------------------------------ |
| `expected_ambiguity`  |     126 |   41.6 % | SUMMARY-CATEGORY dropdown. Legitimate review work; no identity fix touches it. |
| `not_ingested`        |       5 |    1.7 % | Match 2400 only. Deferred by decision (below), not blocked.                    |
| `unresolved_identity` |   **1** |    0.3 % | `8f43caac:1` — correctly `rejected`, left alone as ruled.                      |

**Resolution-failure review rate: 6 / 177 resolvable windows = 3.4 %** (was 42 / 179 = 23.5 %). The denominator moved by 2 because match 2400's two summary-category windows now keep their own reason instead of being relabelled by the identity failure.

New coverage if auto executes: shots **+30 win / 27 matches** (was 28/25) · faceoffs **+21/19** (19/17) · goals **+17/9** (14/8) · events **+12/12** (9/9) · net_chart **+9/9** (7/7) · faceoff_map **+8/8** (7/7) · action_tracker +0.

#### The 18 lookback windows — all 18 individually confirmed, 13 → auto, 5 → skip

Not a global relaxation: the lookback rule is unchanged and still routes to review by default. A new ledger `CONFIRMED_LOOKBACK_FRAMES` (19 frames / 18 windows) enumerates the exceptions, keyed on `(sha, reel_index, target_screen, exact second)` so any drift falls back to review. Each entry passed five checks:

- **C1** no `pre_game_lobby` / `loading_or_intro` / `in_game_clock` / `player_loadout` segment between the reel's end and the frame — no game restarts in the gap. 18/18.
- **C2** the post-game progression nav bar is read within ±60 s (n=8..30 per window) — the post-game menu system is demonstrably on screen. 18/18.
- **C3** no `pause` token in the anchor (see the defect below). 18/18.
- **C4** the next reel starts ≥ 83 s after the window. 18/18.
- **C5 — an oracle independent of the OCR pipeline.** EA's `matches.played_at` (game END) minus the recording's wall-clock basename gives the expected video time of the final whistle. **Calibrated on the 84 contained auto windows** (identity never in question): the post-game browse lands at Δ = **+10..+213 s, median +66**. All 19 frames fall in that band for their assigned match (**+24..+169**), and **every competing match on the same video is refuted by 519..6085 s** — the nearest rival (2402 vs 2403) is 4.5× outside the calibrated maximum.

**Match 977's reel-boundary defect is real but is not a mis-attribution.** Reel 1 ends at its own last segment (755 s) and its post-game tail at 759..780 s falls outside it. The tail belongs to 977 — the reel bound is short, it is not another match's footage. C5 puts 977 at +24..+45 s and the next match (978) at −519..−540 s.

Of the 18: **13 become auto** (472 ×5, 977 ×5, 563 ×2, 2403 ×1 — all genuinely uncovered screens) and **5 become `skip/already_covered`** (563 goals, 606 goals, 2402 goals, 2403 events, 2682 goals) — the coverage precheck had been shadowed by the lookback branch, so these were never new coverage in the first place.

#### The 4 duplicate recordings — NOT associated, and that costs nothing

Each `- Trim*.mp4` is a cut of the **same source recording** as the match's confirmed primary reel. Proven, not assumed: aligning each duplicate's cache to its primary on verbatim anchor strings yields one constant offset per pair — `02664c7d`→`6f010c2e9c1a` +1538 s (2683), `2d13e419`→`1fb12c1f638e` +3447 s (2666), `bc4990a0`→`f3c8a6e6102a` +2391 s (2688), `f5693db3`→`f3c8a6e6102a` +1557 s (2687).

Every one of their 16 windows maps to a primary moment that is already produced natively in the match's active run, or already recovered by the primary's own rescue window. The only screen a duplicate could have added — 2687 `box_score_shots` at t=790 — is the **same frame** the primary already rescues as auto at t=2347. So: **all 16 → `skip/duplicate_recording_superseded_by_primary`**, decided rather than blocked. The generator re-verifies this every run and falls back to `review/duplicate_recording_adds_uncovered_screen` if a duplicate would ever add a screen; their command fingerprints are nulled so an unassociated `--match-id` can never be executed by accident.

#### Match 2400 — do NOT ingest as part of this rescue

Identity is not in doubt: the folder names it, C5 puts the final whistle at t≈1527 s (post-game browse starts 1538 s, Δ +11 s), and the anchor at t=1539 reads `3-0`, which is the recorded result. The problem is that it has **zero runs, zero batches, zero associations** — a rescue attaches to an existing run and there is none.

**Recommendation, applied to the manifest: defer it.** Reasons: (1) it is a normal ingest, not a rescue; (2) it is blocked on the fail-closed cache preflight, which is Stage-B pipeline work; (3) ingesting it now under the _current_ decoder reproduces exactly the defects Stage C exists to fix, so it would need its own rescue afterwards — ingesting after Stage C gets full native coverage for one decode instead of decode + rescue + re-ingest; (4) the whole prize is ≤5 auto windows for one match that Stage D's corpus campaign covers anyway. Its 7 windows are now `review/match_never_ocr_ingested` (5) + `summary_category` (2), and **2400 is listed in the unrecoverable report with that honest reason** — it was previously invisible there, because the report's universe is built from active-run coverage and 2400 has no run. Unrecoverable list is now **20**.

#### ⚠️ Found here, tracked separately: PAUSE → GAME STATS contamination

Discovered while confirming the lookback windows. Filed as its own high-priority **Stage C** issue — see the dedicated entry below. It does not invalidate this manifest: exactly one candidate frame in the whole manifest reads a pause menu, and it is the already-`rejected` `8f43caac:1` window.

#### Cache preflight — fixed for this script, still open for the pipeline

`DEFAULT_INGEST_CACHE` is still `/tmp/ingest-cache`, which is still gone. The rescue script now (a) chooses its root by **content, not existence**, and (b) **fails closed** — `preflight_cache_root()` exits with a diagnostic rather than emitting an empty manifest, and runs before the DB is touched. The dangerous case was never the missing symlink; it was a recreated _empty_ `/tmp/ingest-cache`, where every check passes and the run reports "nothing to do". **The `video-ingest` pipeline itself is unchanged and still carries the reboot trap** — gate decision (5) stays open for Stage B.

#### Verification

- video_ingest suite **740 passed, 5 skipped, 38 subtests, 0 failed** (baseline 729 + 11 new tests covering reason classes, ledger exactness/drift, duplicate supersession and ledger disjointness).
- Generator exit 0. Read-only proof: rescue batches **0**, rescue runs **0**, round-trip **True**, validation problems **0**, confirmed-lookback ledger **19/19 matched, 0 stale**.
- v1→v2 diff is exactly 41 windows, all accounted for: 16 duplicate→skip, 13 lookback→auto, 5 lookback→skip, 5 →`match_never_ocr_ingested`, 2 →`summary_category`. **Auto lost: 0.** No window's geometry, target, match or run changed.

#### ✅ NEXT SESSION — DONE, superseded by the top entry

Per the gate ruling above: the pipeline-wide cache preflight fix, in its own session. Stage B follows it; execution of the 97 auto windows follows that. **Both the preflight and Stage B are now complete and verified (both uncommitted); only the execution remains.**

---

### 🟠 STAGE C ISSUE (high priority, NOT part of the rescue): the mid-game PAUSE → GAME STATS screen wears the post-game tab bar (2026-08-03)

**Five promoted segments already rest on it, so this is not theoretical.** Found while confirming the rescue's lookback windows; recorded here so it is worked separately and does not expand a rescue session.

The in-game pause menu's stats view reads e.g. `00:18 youhavenopausesleft ... pauseactiontracker rm scr allevents rt 2nd period` — the **same tab-bar shape** as the post-game action tracker, but showing **partial, mid-game numbers**. Pass-1 labels those frames `post_game_*`.

Measured over the 66 cached `segments.json`:

- **672 frames across 7 videos** carry a `pause` token yet are labelled `post_game_*` (668 `action_tracker`, 4 `faceoff_map`).
- **5 active-run segments are built on them** and are therefore mid-game reads published as post-game data:

| match | segment                                   | window      | pause frames |
| ----: | ----------------------------------------- | ----------- | -----------: |
|   472 | `vsha-b12833771211:seg0036`               | 1246–1263 s |           15 |
|   603 | `vsha-612dff4093d7:seg0020`               | 498–505 s   |            2 |
|  1042 | `vsha-f84af43aecab:seg0023` (faceoff_map) | 580–584 s   |            4 |
|  1042 | `vsha-f84af43aecab:seg0024`               | 582–588 s   |            5 |
|   475 | `vsha-7cad01ec7909:seg0114`               | 3184–3191 s |            5 |

Match 472's case is fully traced: the pause menu at t=1240 reads `07:16 / 2nd period`, the stats browse runs 1247–1262, play resumes at 1265, and the **real** post-game only begins at ~1285 (progression nav bar). The promoted segment is the mid-game one.

**Why it belongs in Stage C:** the fix is a decoder/prior change — the `pause`/`nopausesleft` token is a clean, high-precision negative discriminator, and Stage C is already touching priors and pins. Pair it with a bench negative label, exactly as END OF GAME is handled. Retiring or re-reading the 5 promoted segments is a separate data-repair step.

**Not a rescue concern:** the rescue's own guard already excludes the only pause-menu candidate frame in the manifest.

---

### 🔴 POST-GAME COVERAGE GAP — root-caused end-to-end; the master 9-phase plan (2026-08-02, status refreshed 2026-08-03)

**The 77-vs-55 screen-coverage gap (action tracker 77 matches; box_score_goals 55, shots 10, faceoffs 24, events 55, net_chart 56, faceoff_map 48, player_summary 0) is NOT a capture gap.** The 55 are a strict subset of the 77; the per-frame Pass-1 classifications retained in `/home/michal/ingest-cache/<sha>/segments.json` prove OCR read every screen correctly (`goalsummary`/`shotsummary`/`faceoffsummary`/`netchart`/`lt all`) while the `viterbi_v2` segmenter dropped or absorbed the frames. ~190 selected-tab frames across 41/66 cached videos are directly recoverable; 8 matches are genuinely unrecoverable (249/252/464/976 no cache; 969/978/981/2694 no candidate frames).

**Root cause (three compounding defects):** (1) the ingest-YAML per-screen min-duration overrides are dead under viterbi_v2 (legacy-engine-only — the match-463 fix never applied); (2) `_enforce_min_duration` reads the state-machine YAML where events/action_tracker/player_summary = 1.5 s, killing 1-sample (~1.0 s) views; (3) a single-frame Viterbi excursion costs 5.9 nats and the flat +3.0 anchor bonus can't clear it when the LR head is weak on the dark post-game UI. Also found: commit `8c2f40b` (prettier, 2026-08-02) reformatted `weights/nhl26-screen-classifier-v2.json` and **broke the Pass-1 cache key for all 66 cached videos** (stored `a6ffc7c6…` vs computed `5e257477…`); and the `legacy-passthrough-v0-video` tag on all 97 mass-ingest runs is a cache-hit mis-stamping bug at `orchestrator.py:623-627`, not the real engine.

**The plan (v2, externally reviewed twice, all findings verified against source and incorporated) lives at `/home/michal/.claude/plans/make-a-plan-for-unified-tower.md`.** It is structured as **four approval stages — only Stage A is approved**:

- **Stage A (APPROVED):** Phase 0 substrate repair (restore pre-prettier weights bytes; fix BOTH format scripts to add `--ignore-path .prettierignore` — a bare `.prettierignore` is dead config because `package.json` overrides Prettier's ignore list with `--ignore-path .gitignore`; fix the `orchestrator.py:623-627` decoder_version cache-hit mis-stamp) + Phase 1 **read-only** rescue manifest (reel-scoped-before-padding grouping, coverage precheck → `skip/already_covered`, player_summary and SUMMARY-CATEGORY review-only — the cache never stored side_strip_text and END OF GAME shares the top-bar read, run_id pinned per window, 3-column batch-key semantics). Exit gate: manifest summary presented before any execution is built.
- **Stage B (needs own approval):** rollback tooling proven on pilot #1 → pilots → full rescue + honest report (8 unrecoverable matches named).
- **Stage C (needs own approval):** sim sweep + bench labels v0.3 with **mandatory END OF GAME negative labels** → ONE atomic pipeline-fix commit (min_durations 0.9; `distinctive_anchor_pin` on FIVE priors — player_summary excluded, its pin would force the END OF GAME confounder into the state; versioned `cache_fingerprint()` salt, not repr; DECODER_VERSION `-pgpin`) → guardrails.
- **Stage D (NOT approved):** reprocess safety (candidate-reels gate derived from fresh segments — on-disk reels.json only regenerates inside the dispatch branch, so comparing it is inert; mandatory negative live smoke) → chunked corpus re-ingest, cohort/runtime from the driver's dry-run, `--jobs 1` start on the single 3060.

Key review-verified traps recorded for implementers: reels.json regeneration is dispatch-branch-only (`orchestrator.py:776,837` → `match_split.py:316-317`); only `top_bar_text` is persisted per frame (`orchestrator.py:315-326`); batch uniq is `(video_sha256, source_directory, run_id)` NULLS NOT DISTINCT; Pass-2 is run-scoped (`pass2-run-<id>`) so sibling-match reprocess cost must be measured, never assumed.

**STATUS as of 2026-08-03:** Phase 0 shipped (`47c1ecd`), Phase 1's manifest is at v2 and approved (`9314e8d` + uncommitted work), and Stage B's executor is built and verified but has executed nothing. Stage C and Stage D still need their own approvals. The four top entries carry the current state; this entry is kept for the root cause, the stage structure and the implementer traps.

---

### 🔴 THE viterbi_v2 BOX-SCORE MISS IS POSITIONAL, NOT LR-HEAD WEAKNESS — and the 757 is really 527 2026-08-02

**Investigation only — no code changed, nothing drained.** Refines **defect (3)** of the entry above ("a single-frame Viterbi excursion costs 5.9 nats and the flat +3.0 anchor bonus can't clear it **when the LR head is weak**"). The measured cause is not LR-head weakness. It is the frame's **position in the decoded path**, and it is deterministic.

#### Root cause: the bonus is per-frame, the penalty is per-run

There are **two** barriers, and +3.00 sits between them:

| position of the goal-summary frame               | marginal cost | max bonus | outcome             |
| ------------------------------------------------ | ------------: | --------: | ------------------- |
| isolated inside an `unknown_or_transition` block |     **−5.90** |     +3.00 | collapses, −2.90    |
| adjacent to a state change the path made anyway  |     **−2.95** |     +3.00 | survives, **+0.05** |

A solo visit pays two −3.0 transitions and forgoes two −0.05 self-loops; a visit next to a real state change pays only the extra entry. `post_game_box_score_goals` has exactly **one** regex prior (`nhl26_regex_priors.yaml:94`) and the bonus sums fired priors (`emissions.py:143-150`), so its ceiling is +3.00. **An unambiguous `lt goalsummary` read sitting alone in an unknown block can never be labelled, however clean the OCR is.**

The +3.0 was tuned against the one-sided barrier only — `emissions.py:39-43` reasons about "the −3.0 transition penalty out of `unknown_or_transition`", singular. It clears that by **0.05** and misses the round trip by 2.90. The 2.0 → 3.0 bump bought exactly the case it was tested on.

#### Evidence

- **Path scoring** against the real state machine + real `EmissionWeights`: isolated **−2.90**, adjacent **+0.05**. At bonus 6.0 both become positive (+0.10 / +3.05).
- **Corpus-wide** across 66 cached `segments.json`, 125 isolated goal-summary frames: predicting _hit ⟺ NOT(both neighbours unknown)_ is **97.6 % accurate with ZERO false positives** — 64/64 predicted hits hit, 58/61 predicted misses missed. The 3 stragglers won the round trip on visual confidence alone, which is the residual the model predicts.
- **Sharpest case** — sha `0ece002a`: t=1657 `lt goalsummary` → MISS, t=1660 `lt goal summary` → HIT. Same video, 3 s apart, both isolated single frames. Only the surrounding path differs. This supersedes the cross-match `ed827491` example, which conflated run length with position.

#### ⚠️ The 757 splits — this defect is worth 527

| failure mode                                        | matches                                |  events |
| --------------------------------------------------- | -------------------------------------- | ------: |
| Transition-cost defect (goal prior fires, isolated) | 476, 977, 2403, 2404, 2577, 2672, 2676 | **527** |
| **Different defect — no prior fires at all**        | 465 (147), 472 (83)                    | **230** |

On **465** (t=1633) and **472** (t=1331) the box-score frame's top bar reads `lt summarycategory`, which matches **no prior**. There is no bonus to outweigh, so a decoder-cost fix does nothing for them. Per-match counts sum to 757 exactly, so the split is exhaustive. 472 and 977 still additionally need the reel-boundary fix.

This supports the Stage-A decision to keep SUMMARY-CATEGORY **review-only**: of 94 such frames corpus-wide, 69 are unknown but 17 already resolve to goals, **7 to net_chart**, 1 to shots. The string is genuinely ambiguous — do not map it to goals.

#### Two candidates refuted

- **Not the reject-pin path** (`emissions.py:128`) — no `unknown_or_transition` prior fires on these texts.
- **Not `_enforce_min_duration`** for box-score-goals: its min is 1.0 s, PTS gaps are exactly 1.000 s, and a **1-frame `post_game_faceoff_map` segment survives** at t=1703 in `ed827491`. No conflict with defect (2) above — that one bites `events`/`action_tracker`/`player_summary` at 1.5 s, which box_score_goals is not subject to.

⚠️ **Trap for implementers:** `orchestrator.py:341-355` relabels frames only from **surviving** segments, so a min-duration drop leaves frames reading `unknown_or_transition` — byte-identical to a classifier miss. "Frames labelled unknown" is NOT by itself evidence of a classifier miss.

#### ⬜ Next

Raising `anchor_bonus` 3.0 → 6.0 is one line and verified to flip both positions, **but it scales every state's bonus** — including `post_game_events`'s very loose `\ball\b` and `pre_game_lobby_state_2`'s three priors (→ +18). It needs the proving bench before it goes near a gate; Stage C's `distinctive_anchor_pin` is the more targeted lever. Either way the corpus supplies a ready-made regression set: **64 frames that must keep hitting, 58 that should flip.** Re-ingest still costs a ~30–45 min decode per match, and the fix must land first.

---

## Open Threads (details archived)

Condensed from the 2026-08-01/02 investigation entries, now in
[docs/archive/handoff-history-2026-08-03.md](docs/archive/handoff-history-2026-08-03.md). Each
bullet is the durable conclusion — open the archive only if you need the evidence behind one.

### Feeds Stage C (the decoder/prior fix)

- **The classifier-miss set is 15 matches, and the ruling is DO NOT DOWNGRADE them** (2026-08-02).
  9 matches (465, 472, 476, 977, 2403, 2404, 2577, 2672, 2676 — **757 pending events**) recorded a
  fully legible box-score screen that reads the API final exactly; the segmenter dropped it, so they
  stay on `HOLD`. 2 (565, 2680 — 109 events) are a genuine coverage gap where the class-D downgrade
  is legitimate. 4 (249, 252, 464, 976 — 335 events) are undetermined: pass-1 cache lost to `/tmp`,
  video survives — resolving them is an `ffmpeg -ss` past the last surviving segment's `t_end_sec`,
  minutes rather than a decode. Cheapest open item in the whole workstream.
- **The 757 splits 527 / 230.** 527 (476, 977, 2403, 2404, 2577, 2672, 2676) are the transition-cost
  defect that Stage C's `distinctive_anchor_pin` targets. 230 (465, 472) read `lt summarycategory`,
  which matches **no prior at all** — no decoder-cost fix reaches them. 472 and 977 additionally need
  the reel-boundary close fixed, or a classifier fix strands them anyway.
- **`SUMMARY-CATEGORY` must stay review-only:** of 94 such frames corpus-wide, 17 resolve to goals,
  **7 to net_chart**, 1 to shots. The string is genuinely ambiguous; do not map it to goals.
- **`period_label` is the #1 blocker in the corpus**, well ahead of the events screen it was found on.
- **Trap:** `orchestrator.py:341-355` relabels frames only from _surviving_ segments, so a
  min-duration drop leaves frames reading `unknown_or_transition` — byte-identical to a classifier
  miss. "Frames labelled unknown" is not by itself evidence of a classifier miss.

### Data repair, not decoder work

- **TOT-sum repair shipped (`3508d40`).** 618 flipped HOLD → PASS (85 events). **2666 did not** — its
  real defect is frame _selection_: the consolidator prefers a wrong-table frame whose TOT is null
  over the right-table frame that reads correctly, so a TOT repair alone cannot flip it. 968 needs a
  full re-decode (167 events) and is only worth it if a decode is being run anyway.
- **The review backlog was never a wiring gap.** The auto-drain is shipped and has been run; all
  4,247 still-pending event rows sit behind real blockers. Ranked remaining wins: re-ingest the
  transition-cost 7 after the classifier fix (527 events) → 2666 frame selection → 968 → class-A
  re-weighting (7 matches / 756 events).
- **Two quality detectors were phantoms and are already handled:** class G was circular (fixed in
  `apps/worker/src/lib/quality-inputs.ts`), class C is presentation-only (excluded from the gate).
  Classes A and D are real. See [[feedback_phantom_quality_detectors]] before trusting any new class.
- **The faceoff-map period-label ROI is NOT defective** — closed 2026-08-01. Do not spend a session
  moving that region.

### Frontend

The game-sheet revamp (12 phases) and the site-wide navbar port are **complete and committed**; no
frontend phase is queued. One open thread: the nav's `LOGIN` CTA is a placeholder, and making it
session-aware is a real decision (client session vs `getCurrentUser()` in the root layout) — full
options in the archive. Independent of the OCR work; its own session if ever picked up.

## Repo State

> **SUPERSEDED (2026-08-03 snapshot, kept for history — see the 2026-08-15 "RECONCILED" entry at the
> top of Active State for current facts):** at the time this was written, the cache-root preflight and
> Stage B were believed uncommitted and nothing had executed. Both are now confirmed committed
> (`b863ebb`, `f55a58d`, `d32b50b`, plus `9ec9df0`/`8627fae`/`06b1986`), and read-only DB/filesystem
> evidence shows the rescue **did** partially execute (75 promoted, 2 failed, ~20 unaccounted-for of
> 97 auto windows). Do not rely on the "0 rescue batches, 0 rescue runs" claim below.
>
> **CURRENT (2026-08-03, end of the Stage B implementation session):** branch `main`. **Two
> complete, verified, UNCOMMITTED workstreams sit in `tools/video_ingest/`** — (1) the pipeline
> cache-root preflight: `video_ingest/cache_root.py` + `tests/test_cache_root_preflight.py` (new),
> `cli.py` / `reprocess.py` / `batch_ingest.py` (modified); (2) Stage B:
> `video_ingest/rescue_execute.py`, `scripts/execute_rescue_manifest.py`,
> `tests/test_rescue_execute.py` (new). Committing them is a separate approval decision that has not
> been made. **Nothing has been executed:** the read-only proof still reads 0 rescue batches, 0
> rescue runs. Suite at 822 passed / 5 skipped / 38 subtests / 0 failed.
>
> **Unrelated drift in the same tree — keep it out of any rescue commit:** the OCR coverage-pill work
> (`apps/web/src/components/ui/ocr-pill.tsx`, `lib/ocr-coverage.ts` + test, `lib/lineup-shape.ts` +
> test, `packages/db/src/queries/ocr-coverage.ts` + `index.ts`), the assorted `apps/web` game-sheet
> files, and `docs/runbook/ocr-corpus-mass-ingest.md`.

Durable traps, carried forward — these keep biting:

- **The OCR cache is `~/ingest-cache`, not `/tmp/ingest-cache`.** `/tmp/ingest-cache` is gone (a
  reboot cleared `/tmp`) while `DEFAULT_INGEST_CACHE` still points there, so an unguarded
  `video-ingest` run creates an empty dir and re-decodes all 66 cached videos (~30–45 min each).
  The dangerous case is a recreated _empty_ dir, where every check passes and the run reports
  "nothing to do". The uncommitted `cache_root.py` preflight is the fail-closed fix.
- **`pnpm format` is repo-wide and unusable as a gate:** it reformats ~50 committed files (prettier
  drift) and exits 2 on malformed JSON under `docs/calibration/`. Format only touched files
  (`npx prettier --write <files>`) and verify with `--check`. `pnpm lint` is pre-existing-red
  repo-wide — see [[project_lint_state]].
- **Dev/build share `apps/web/.next`:** the operator's dev server is on **3002**, docker holds
  3000/3001. A second dev server against the same `.next` desyncs chunk manifests into a silent
  no-hydration state, and `next build` needs the dev server stopped first. Never `rm -rf .next`
  while a server is running. **The dev server is loopback-only:** `apps/web` `dev` passes
  `--hostname 127.0.0.1`, because `next dev` otherwise binds every interface. Start it with
  `PORT=3002 pnpm --filter web dev` and confirm with
  `ss -ltn | grep ':3002'` → `127.0.0.1:3002`, never `*:3002`.
- **`Game sheet prototype layout (1)/` is untracked at repo root and has never been tracked.** It is
  the design of record for the game sheet and the nav; keep it out of focused commits.
- **`git push` runs `scripts/verify-ocr.sh` first** (~20 min) — background the push and let the
  hook finish. **The hook is mandatory; do not bypass it.** It has caught a real defect before
  (see the 2026-08-16 decoder-provenance entry). If it fails, fix the failure — a bypassed push
  is not a verified push. See [[project_prepush_verify_hook]].
- **Migrations are hand-written idempotent SQL applied via psql**, journal frozen at 0045 — see
  [[project_migration_drift]].
- **`notFound()` from a PAGE returns 200 in this app.** The root
  `src/app/loading.tsx` puts every page inside a Suspense boundary whose shell is
  flushed before the page component runs, so a status already sent cannot be
  changed. Measured: `/games/999999999` → 200 with 404 content.
  `dynamic = 'force-dynamic'` does not help. Deleting the page module does (the
  router 404s before rendering). Never take a module-level "it throws the 404
  fallback" test as evidence about a status code — read the code off a socket.
- **Two env files, different jobs — do not conflate them.** There is no
  `.env.local` at the repo root.
  - **Root `.env`** is the environment file for Docker Compose, the pre-push
    `verify-ocr` hook, and the host-side test harness and worker CLIs. This is
    the one `set -a && source .env && set +a` means, and the one `CLAUDE.md`,
    `DEPLOY.md`, and `README.md` correctly refer to.
  - **`apps/web/.env.local`** is a separate, web-development-only file holding
    its own `DATABASE_URL` copy. Next.js loads it for `next dev` / `next start`
    in `apps/web`. Because it is a _copy_, a `DATABASE_URL` change (a password
    rotation, a host-port move) has to be applied to both files or web silently
    keeps the stale one.
- **Commit rule:** do not auto-commit. `AGENTS.md` controls.

## Next Session

**Current objective: the staged authorization sequence below. One stage per
session.** **Stages A, B, C and D are all COMPLETE (D on 2026-09-04, PASS,
scoped to Hotel-Echo's three required ports — see the "STAGE D PASS" Active
State entry). The next session is Stage E — close the remaining gates, then
separately authorize reopening the tunnel.** **Stage E is NOT authorized yet**
and this correction does not authorize it: closing Stage E's checklist is not
itself permission to reopen the tunnel, which remains its own separate
authorization per Stage E's own text below. The order remains load-bearing:
exposure must stay verified before anything is published. The old rationale
("the fix must be on the host before an admin account exists on it") no longer
applies — there is no admin account and no way to create one; see the
"AUTHENTICATION DELIBERATELY DISABLED" entry at the top of Active State.

**The pre-push `verify-ocr` hook is mandatory. Do not use `--no-verify`.**
Background the push and let all five stages run; see
[[project_prepush_verify_hook]].

### A. ✅ COMPLETE (2026-09-04) — Verify and push the reviewed commits, normally

**Done.** `main` was verified and pushed at `00742e4`; the pre-push
`verify-ocr` hook ran in full (2,645 passed, 0 failures, 11 documented skips)
and the push was confirmed against the remote ref. Retained below as the
record of what was run.

```bash
pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
pnpm --filter web build         # test:http-404 needs a build; run it first
pnpm --filter web test          # 147/147 across three processes:
                                #   test:unit          130 (incl. 12 structural)
                                #   test:auth-disabled  11 (API route + 7 refusing actions)
                                #   test:http-404        6 (real server, real status codes)
pnpm typecheck
set -a && source .env && set +a
node apps/worker/scripts/with-test-db.mjs init-admin-cli    # 12/12 — fails-closed contract
docker compose config --services                            # db, web, worker only
```

`test:http-404` starts the built app on 127.0.0.1:34571 and reads real status
codes. It SKIPS if `.next/BUILD_ID` is absent, so build before testing or that
coverage is silently absent. The harness env file is the root `.env`;
`apps/web/.env.local` is the separate web-development `DATABASE_URL` copy.

Then push in the background and let `verify-ocr.sh` finish (~20 min, 5 stages).
If it fails, fix the failure — a bypassed push is not a verified push. Confirm
the push landed against the remote ref (`git ls-remote origin -h main`), not
just the exit code.

### B. ✅ COMPLETE (2026-09-04) — Deploy the corrected web / worker / Compose to Hotel-Echo

**Done — see the "STAGE B COMPLETE" entry at the top of Active State for the
before/after commits and image ids, the Compose reconciliation, the rollback
handles, and the verification evidence.** Hotel-Echo runs `00742e4`;
`cloudflared` was never started and is absent from the host; all four checks
below passed. The Compose caveat is resolved — the host tree is now clean.
Retained below as the record of what was required.

Requires: A complete. **`cloudflared` stays stopped for this entire stage and
the next two.**

**Caveat added 2026-09-03 (see the "HOTEL-ECHO HARDENED" entry above):**
Hotel-Echo's operational `docker-compose.yml` is now intentionally, locally
modified from this repo's tracked version (the hardening pass removed the
inline-token cloudflared service from it directly on the host). Check
`git status`/`git diff` on Hotel-Echo before pulling and reconcile by hand —
do not let a plain `git pull` silently overwrite or conflict-fail on that
file.

1. Pull on Hotel-Echo, then **rebuild** — `docker compose up -d` alone reuses
   the old image. See the `docker-redeploy` skill.
2. `docker compose config --services` → `db`, `worker`, `web` only; no
   cloudflared, no warning.
3. `ss -tlnp | grep -E ':(3000|3001|5433)\s'` → `127.0.0.1` on all three.
   `http://192.168.1.107:3000` will stop answering. That is intended.
4. Confirm the tunnel is still down: `boogeymen.app` should still return 530.

### C. Verify the disabled account surface on the host

Requires: B complete. **There is no admin account to create, and no CLI that
would create one.** The previous version of this stage said "verify /login, then
initialize the admin"; both halves are obsolete — see the "AUTHENTICATION
DELIBERATELY DISABLED" entry at the top of Active State.

What replaces it is a check that the deployed build really is the disabled one.
Read the status codes, not the page bodies: a 200 carrying 404 content is
exactly the failure mode this had to be written around.

```bash
# Every one of these must print 404.
for p in /login "/login?token=test" /account /me /admin /admin/accounts \
         /api/auth/session; do
  printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "localhost:3000$p")"
done
curl -s -o /dev/null -w 'POST sign-in %{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{"email":"a@b.test","password":"password123"}' \
  localhost:3000/api/auth/sign-in/email          # expect 404

# The public site must still serve — a site that 404s everything also passes
# the checks above.
curl -s -o /dev/null -w '/ %{http_code}\n' localhost:3000/     # expect 200

# The CLI must refuse and exit non-zero, having connected to nothing.
docker compose exec worker node dist/init-admin-cli.js ; echo "exit=$?"   # expect exit=1
```

Record the results. If any page path returns 200, the deployed image predates
`44aed29` — rebuild, do not "fix" it on the host.

### D. ✅ COMPLETE (2026-09-04) — On-host / LAN / WAN port-exposure verification

**Done — see the "STAGE D PASS" Active State entry near the top of this file
for the full evidence.** Host bindings, a genuine on-LAN probe, a genuine
off-network WAN probe (IPv4 and IPv6), and the router's port-forward/DMZ/UPnP/
IPv6-policy posture all converged on no exposure for Hotel-Echo's three
required ports (`3000`/`3001`/`5433`). The Gate 2 port-exposure checkbox for
Hotel-Echo is checked on that scope. This did not test every service or every
port, and it did not test the main PC — see the "STAGE D PASS" entry for the
documented limitations. The commands below are kept as the **retained
historical procedure** that was followed, not as unfinished instructions for a
future session.

Required: C complete — **it was (2026-09-04)**. The procedure ran with the
tunnel still down, so it measured the host itself rather than the tunnel.
Stage C had already recorded the on-host half (`127.0.0.1:3000`,
`127.0.0.1:3001`, `127.0.0.1:5433`, no wildcard listener); the LAN test, the
WAN test, and the router check were the remaining checks, and their recorded
results (see the "STAGE D PASS" Active State entry) closed the Gate 2
checkbox.

- On the host: `ss -tlnp | grep -E ':(3000|3001|5433)\s'` — expect `127.0.0.1`.
- From another LAN machine: `nc -zv <host-lan-ip> 3000 3001 5433` — expect
  refused/timeout on all three.
- From outside the network, against the **WAN address**, not the domain:
  `nc -zv <wan-ip> 3000 3001 5433` — expect refused/timeout on all three. The
  domain resolves to Cloudflare, so testing it proves nothing about this host.
- Check the router for port-forwards and UPnP mappings to Hotel-Echo.

The date and results were recorded; that evidence is what closed the Gate 2
"database port and worker health endpoint not exposed" item — ~~until then it
stays unchecked~~ **done, 2026-09-04 — see the "STAGE D PASS" Active State
entry.** Full procedure in DEPLOY.md, "Host port exposure".

### E. Close the remaining gates, then separately authorize reopening the tunnel

Requires: D complete and recorded. **These gates are prerequisites, not
paperwork to follow the reopening.** The site was previously public with none of
them in place. **Disabling authentication closed none of them** — a public
read-only site still publishes named individuals' statistics, still keeps server
logs, and still needs to be backed up and recoverable.

- MFA and a documented recovery contact on the domain/Cloudflare account.
- Security response headers on the web app.
- An indexing decision and a matching `robots.txt`.
- The privacy policy, the data-collection policy (gamertags, statistics,
  accounts, server/IP logs, retention, processors), the correction/deletion
  request process, and the EA/NHL non-affiliation notice.
- Backups and a restore drill, so a public site is a recoverable one.

Reopening the tunnel is then its **own** authorization, not an automatic
consequence of finishing the list:

1. Write the tunnel token to `./secrets/cloudflared-tunnel-token` on Hotel-Echo,
   mode 600, token only, no newline or prefix. It is not in the repo and must
   not be pasted into a doc, a commit, or a chat.
2. `docker compose --profile public up -d` — and remember `--profile public` on
   every later compose command that should include the tunnel.
3. `docker compose --profile public logs cloudflared --tail 50` — expect
   registered edge connections.
4. From outside the LAN: `curl -sSI https://boogeymen.app | head -1` → expect
   `HTTP/2 200`; then repeat Stage C's status loop against the public origin and
   confirm every disabled path still answers **404** through the tunnel.
5. Confirm the domain still routes only `web` — no ingress rule and no DNS
   record for the database or the worker health endpoint.

---

**SUPERSEDED — see the 2026-08-15 "RECONCILED" entry at the top of Active State.** The block below
("execute the 97 approved auto windows") is stale: read-only evidence now shows a rescue execution
already ran on 2026-08-05 and 2026-08-07 (75 promoted, 2 failed, up to ~20 of the 97 auto windows
with no receipt found). **Do not run the command below blind.**

**Current one task: read-only reconciliation.** Diff the 97 auto promotion keys in
`~/ingest-cache/rescue-manifest.json` against the 76 `ocr_capture_batches` rows and the 77 receipts
in `~/ingest-cache/rescue-receipts.jsonl` + `~/ingest-cache/rescue-runs/rescue-b2-20260807T031344Z/rescue-receipts.execution.jsonl`,
and report exactly which auto windows are un-attempted vs. failed. Resuming execution for any gap is
a separate, later approval decision.

```bash
cd tools/video_ingest && PYTHONPATH=.:../game_ocr \
  ../../.venv-1/bin/python scripts/execute_rescue_manifest.py \
  --manifest ~/ingest-cache/rescue-manifest.json          # DRY RUN — default, safe
  # ... and only after reading that plan, AND after the reconciliation above:  --execute
```

Rollback handles are `source_directory LIKE '%/rescue/%'` and `decoder_version='rescue-b2-anchor-v1'`.

After that, in their own sessions: the honest post-execution report (with the 20 unrecoverable
matches named), then **Stage C** — the decoder/prior fix, which must also carry the PAUSE → GAME
STATS discriminator and a bench negative label for it. **Stage D (corpus re-ingest) is not
approved.** The 126 expected-ambiguity windows, the five match-2400 windows and the one unresolved
window remain non-executable, and that is correct.

## Archive

- [docs/archive/handoff-history-2026-08-03.md](docs/archive/handoff-history-2026-08-03.md) —
  Active State 2026-07-25 → 2026-08-02 (the completed frontend port, the review-backlog drain and
  its detector audits, the box-score/TOT investigations, the mass-ingest and corpus-run history),
  the Phase B–G "What Is Already Done" log, superseded Next Session lists, and the Repo State
  provenance entries.
- [docs/archive/handoff-history-2026-06-14.md](docs/archive/handoff-history-2026-06-14.md) — the
  prior OCR revamp history, older session summaries, and superseded roadmap items.
