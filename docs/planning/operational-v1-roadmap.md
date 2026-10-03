# Operational V1 Roadmap

Extracted verbatim from `HANDOFF.md` on 2026-09-12 as part of the handoff
compaction described in `docs/operations/agent-manager-workflow.md`. Gate
status and checkbox text below are unchanged from the source — this move
did not check, uncheck, or reword any item. Full prior session history is
in `docs/archive/handoff-history-2026-09-12.md`.

**Source-reference note:** the text below still says things like `see the
"STAGE D PASS" Active State entry` — those phrases refer to session
headings that lived in the same document before this compaction. They are
not clickable links. To find one, open
`docs/archive/handoff-history-2026-09-12.md` and search for the quoted
heading text verbatim (e.g. search for `STAGE D PASS`); headings there
aren't guaranteed stable anchor slugs across markdown renderers, so a
literal text search is the reliable way to locate them.

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

## Fast credible launch amendment — 2026-10-02

The October 1 target was missed. Finishing every unchecked item below before
allowing any public traffic is no longer the active critical path. This
amendment introduces an earlier milestone, **Limited Public Launch (LPL)**,
without relabelling it as completed Operational V1.

The original Gate 2 and Gate 3 checklists remain the definition of full
Operational V1 and remain auditable below. An unchecked item is not made true
by this amendment. Items explicitly deferred from LPL become dated post-launch
work; everything in the LPL gate is mandatory.

### LPL posture and assumptions

- Launch as a clearly described public beta: no account/login promise, no
  admin or diagnostic surface, no advertising, and no analytics or
  nonessential tracking.
- Keep the currently operating main-PC deployment as the initial production
  host unless preflight shows it is unsuitable. Migrating primary production
  to Hotel-Echo is post-launch work. A host change requires its own reviewed
  cutover plan and is not smuggled into this fast path.
- Keep public search indexing disabled for LPL with page-level `noindex` plus
  consistent robots/sitemap behavior. Deliberate indexing, canonical/OG
  polish, search-console ownership and structured data move to the full-V1
  follow-up.
- Proton/E3 remains valuable but is not the only acceptable way to satisfy the
  launch backup requirement. LPL instead requires a smaller interim backup
  path that is automated, encrypted, stored off the production host, monitored
  and proven by a restore drill. E3 continues independently after launch.
- No deadline overrides a failed safety check. If a mandatory LPL item cannot
  be proved, launch stops or the operator records a new explicit scope/risk
  decision; silence is not approval.

### LPL gate — all items mandatory

#### L0 — reconcile and freeze

- [ ] Reconcile this roadmap against actual repository and production state;
      close only items backed by current evidence.
- [ ] Freeze non-launch feature work and name the exact launch commit, current
      production host, deployment artifact/image, database, and rollback
      artifact.
- [ ] Finish or deliberately pause the active E3J9E branch at a safe local
      checkpoint. Its partial launcher must not be installed merely to meet the
      launch date.

#### L1 — data correctness and core product

- [ ] Implement and verify the decided NHL 26/27 separation: ingestion
      eligibility, frontend default and chronological ordering are independent;
      `/` and `/games` use the same resolver behavior.
- [ ] Prove one real NHL 27 match end to end through ingestion, association,
      OCR/review boundaries and public presentation.
- [ ] Verify NHL 26 remains reachable as history and that cross-title career
      totals retain their source/title labels without double counting.
- [ ] Production-smoke `/`, `/games`, one game detail, `/roster`, one player
      profile and `/stats`, including loading, empty, not-found and unavailable
      data behavior.

#### L2 — interim backup and recovery

- [ ] Schedule at least daily PostgreSQL backups to an operator-approved
      destination physically separate from the production host. Transfer and
      storage must be encrypted; files and credentials must be least-privilege
      and outside Git.
- [ ] Record integrity metadata, bounded retention, failure visibility and a
      clear owner. A successful command with no usable artifact is a failure.
- [ ] Restore a launch-candidate artifact into a disposable database and
      verify critical table counts plus representative application reads.
- [ ] Write the exact backup-failure, host-loss, database-restore and deployment
      rollback procedures. Exercise the rollback and database restore steps;
      prose alone does not pass.

#### L3 — exposure and security

- [ ] Verify the production domain, HTTPS enforcement, certificate renewal and
      deliberate apex/`www` redirect behavior against the chosen launch host.
- [ ] Prove PostgreSQL and worker/management endpoints are not publicly
      reachable; expose only the intended web surface through the approved
      edge/tunnel path.
- [ ] Verify production secrets are outside Git, images and browser bundles;
      run repository and built-artifact secret scans.
- [ ] Remove or deny production access to account, admin, diagnostic, preview
      and development-only routes. Review every remaining public input/API
      boundary and apply rate limits where abuse can cause material harm.
- [ ] Verify CSP, HSTS, frame-ancestor/frame protection, MIME-sniffing and
      referrer-policy headers. Run the dependency/security audit; unresolved
      critical findings block launch.
- [ ] Verify public 404/500 behavior exposes no stack trace, internal path,
      source map, secret or diagnostic payload.

#### L4 — legal and tracking

- [ ] Publish Privacy, Data Collection, Terms of Use and EA/NHL attribution /
      non-affiliation pages with final production URLs.
- [ ] Add the global footer with working policy links,
      `webmaster@boogeymen.app`, and an automatic current year.
- [ ] Disable Cloudflare Web Analytics and verify that the deployed product has
      no analytics, advertising or nonessential tracking. If this changes, stop
      and reassess consent and policy requirements before launch.
- [ ] Run a broken-link check across normal navigation, footer, contact and
      legal destinations.

#### L5 — monitoring and host safety

- [ ] Enable uptime/application-error monitoring and receive a real test
      notification at the operator-owned destination.
- [ ] Alert on stale worker state, ingestion gaps and accumulating
      `raw_match_payloads.transform_status='error'` rows; exercise each signal
      or a faithful non-production test of it.
- [ ] Configure log retention/rotation and verify database, container and
      application logs cannot silently exhaust the production disk.
- [ ] Monitor the interim backup schedule and artifact freshness. A website
      uptime check is not backup monitoring.

#### L6 — minimum UX and compatibility

- [ ] Verify core routes at 375 px and one representative desktop width with no
      page-level overflow, clipped primary controls or unusable dense tables.
- [ ] Verify navigation and every launch-critical control with touch, keyboard,
      Escape, visible focus and focus return. Correct critical labels, heading
      order, contrast and meaningful image alternatives.
- [ ] Test current Chrome and Firefox desktop plus one real mobile Safari
      device. Record noncritical browser defects with an owner and follow-up;
      broken core navigation or unreadable core data blocks launch.
- [ ] Run a production-mode performance pass on the core route set. Severe
      regressions, request waterfalls that prevent normal use, obvious N+1
      behavior or oversized assets that make mobile use impractical block
      launch; full route-by-route Lighthouse optimization is deferred.

#### L7 — release and observation

- [ ] Finish on a clean, reviewed and pushed `main`. Record commit and image
      identifiers, database migration state, exact deployment command,
      rollback criteria and rollback command.
- [ ] Deploy only the pinned launch artifact, rerun L1 smoke checks through the
      public domain, verify headers/exposure, and confirm monitoring and backup
      schedules remain healthy.
- [ ] Update `HANDOFF.md` and the dated journal with evidence, known defects,
      explicit deferrals, owners and calendar due dates.
- [ ] Start a 48-hour enhanced-observation window with named checks and an
      operator response path. Serious correctness, exposure, backup,
      monitoring or availability failures trigger rollback or public closure.

### LPL stop conditions

Launch does not proceed when any of these is true:

- no independently stored backup has passed a real restore drill;
- rollback cannot be performed from the recorded artifact and instructions;
- the public domain, TLS, port exposure or secret boundary is ambiguous;
- a critical/high reachable security finding remains without explicit operator
  acceptance and a containment that is already deployed;
- NHL 27 core data is materially wrong, NHL 26 history is lost, or core routes
  fail their public smoke checks;
- required legal pages are absent, analytics contradicts the approved policy,
  or the webmaster path fails;
- monitoring cannot deliver a test notification or host disk exhaustion is
  unbounded.

### Explicit LPL deferrals

These items remain required for full Operational V1 but do not block LPL once
L0-L7 pass. At launch, replace each relative deadline with a calendar date in
`HANDOFF.md`; the project operator owns all items until another owner is named.

| Deferred work | Reason for LPL deferral | Follow-up deadline |
|---|---|---|
| Complete Proton/E3 lifecycle, real-CLI/schema validation, retention and monitored cloud backup | Interim independent backup plus restore provides the immediate recovery control; unfinished E3 code is not installed | 14 days after LPL |
| Migrate sole production from the main PC to Hotel-Echo | Avoid combining host migration with an already-late public cutover | 14 days after LPL |
| Full per-parser NHL 27 matrix and retained labeled benchmark | LPL requires one real end-to-end proof and is explicitly beta; broader regression evidence follows | 7 days after LPL |
| Full width/browser/accessibility matrix and route-by-route Lighthouse targets | LPL retains minimum real-device, keyboard, mobile and performance blockers | 14 days after LPL |
| Search indexing, canonical/OG polish, search-console ownership, structured data and AI-crawler policy | LPL is `noindex`; discovery work cannot block safe public access | 14 days after LPL |
| Historical club/team review-queue completion | Not required to keep current NHL 27 data correct or NHL 26 history available | 30 days after LPL |
| Noncritical performance and visual polish | Only defects that prevent normal core-route use block LPL | 30 days after LPL |

### Fast critical path

1. Reconcile evidence and freeze the launch candidate (L0).
2. Complete L1, L2, L4 and L5 without allowing one stream to waive another.
3. Run L3 and L6 against the frozen candidate; fix only launch-blocking
   findings and rerun affected checks.
4. Execute L7 deployment, public-domain smoke and evidence capture.
5. Begin the 48-hour observation window and the dated post-launch backlog.

Passing LPL authorizes the limited public beta described here. It does **not**
authorize calling the project Operational V1 complete; that claim still
requires the original gates below.

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

- [x] Select and purchase the production domain; document owner, registrar,
      renewal date, billing owner, recovery contact, and MFA status.
      **Decided/documented 2026-09-07:** `boogeymen.app`, registrar/DNS =
      Cloudflare, status Active, owner and billing owner = the project
      operator, expiration 2027-09-03, auto-renew enabled (scheduled
      2027-08-04 for one year, CAD $14.20/yr), MFA enabled, recovery
      contact enabled and operator-owned. Evidence is operator-supplied from
      the Cloudflare dashboard, not independently inspected by this agent.
      No sensitive account identifier, payment-instrument detail, MFA
      secret, recovery code, or private contact detail is stored in this
      repository. See the "E1B DOMAIN REGISTRATION DOCUMENTED" Active State
      entry.
- [x] Select the hosting solution and record expected monthly cost.
      **Decided/documented 2026-09-08:** Hotel-Echo (per E1A), with an
      operator-approved provisional planning estimate of **CAD $6.58–$22.78/
      month** (domain $1.18 + electricity $5.40–$21.60), round-number planning
      ceiling **CAD $25/month**. Electricity is an assumed-rate estimate, not
      a measured wall-power figure; precise measurement is deferred
      indefinitely and does not block this checkbox per operator approval.
      See the "E1I HOSTING COST + SYSTEM TERMINATION MAP DOCUMENTED" Active
      State entry, and E1A/E1C/E1D for the underlying decisions this refines.
- [x] Document where the Next.js web app, worker, PostgreSQL database,
      persistent storage, backups, DNS, and TLS terminate.
      **Decided/documented 2026-09-08:** a current-state-versus-approved-
      target termination map is now recorded. Current: the main PC remains
      the real production web/worker/database/storage; Hotel-Echo runs a real
      parallel deployment with its own separate, not-yet-migrated database;
      no production backup-pipeline activation has been recorded (E1I did
      not recheck either host); DNS records exist at Cloudflare
      but the tunnel is offline. Target: Hotel-Echo becomes sole production
      host, Proton Drive/main-PC become backup destinations, Cloudflare
      remains DNS/edge-TLS in front of the (currently offline) tunnel. This
      checkbox closes on the strength of the documentation existing, not on
      any claim that migration, cutover, backup activation, or tunnel
      reopening has occurred. See the "E1I HOSTING COST + SYSTEM TERMINATION
      MAP DOCUMENTED" Active State entry.
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
- [x] Define secret storage, environment separation, deployment mechanism,
      staging strategy, and rollback ownership. **Decided 2026-09-07:**
      Hotel-Echo-only production with no permanent staging server, deploy
      only from a clean pushed `main` commit built on Hotel-Echo in a
      controlled window, independent per-host secrets outside git (mode
      `0600` where enforceable), the Cloudflare tunnel token as a mounted
      secret file (never committed or rendered into Compose), and
      operator-owned rollback authorization. Definition only — see the
      "E1E DEPLOYMENT/STAGING/SECRETS/ROLLBACK MODEL DECIDED" Active State
      entry. Implementation, credential rotation, Proton integration,
      production cutover, and rollback exercise remain open.

#### Privacy, data collection, and legal drafts

- [x] Draft the privacy policy. **Completed 2026-09-10 (drafting-quality
      checkpoint only, not legal review/clearance/publication).** See the
      "E2H GATE 2 DRAFTING CHECKPOINTS AND FUTURE LEGAL ROUTES APPROVED"
      Active State entry.
- [x] Draft the data-collection policy, explicitly covering gamertags, player
      statistics, accounts, server/IP logs, analytics, cookies, retention, and
      third-party processors actually used. **Completed 2026-09-10
      (drafting-quality checkpoint only, not legal review/clearance/
      publication).** See the "E2H GATE 2 DRAFTING CHECKPOINTS AND FUTURE
      LEGAL ROUTES APPROVED" Active State entry.
- [x] Define a data correction/deletion request and webmaster contact process.
      **Decided 2026-09-03:** requests go to
      `webmaster@boogeymen.app`; acknowledge within 7 days and resolve or
      provide a substantive response within 30 days. See the "LAUNCH POLICY +
      DOMAIN MAIL" Active State entry.
- [x] Draft an EA/NHL non-affiliation and third-party asset/data attribution
      notice appropriate to the final hosting posture. **Completed 2026-09-10
      (drafting-quality checkpoint only, not legal review/clearance/
      publication).** See the "E2H GATE 2 DRAFTING CHECKPOINTS AND FUTURE
      LEGAL ROUTES APPROVED" Active State entry.
- [x] Draft the Terms of Use. **Completed 2026-09-10 (drafting-quality
      checkpoint only, not legal review/clearance/publication).** See the
      "E2H GATE 2 DRAFTING CHECKPOINTS AND FUTURE LEGAL ROUTES APPROVED"
      Active State entry.
- [x] Decide whether analytics are needed. **Decided 2026-09-03:** no analytics
      or advertising at launch and no nonessential tracking/cookies. A consent
      banner is therefore not planned unless the implementation changes.

#### NHL 27 readiness

- [ ] Produce a per-parser NHL 27 beta compatibility matrix; do not accept
      "screens look the same" as proof.
- [ ] Capture and retain a small labeled NHL 27 benchmark.
- [x] Decide the NHL 26/27 dual-active and cutover rules: worker polling,
      `game_titles.is_active`, title resolution, URL behavior, and what the UI
      calls "current" during overlap. **Now live, not hypothetical, as of
      2026-09-05:** NHL 27 ingestion was enabled on both hosts (see the "NHL 27
      ENABLED" Active State entry) and — as a mechanical consequence of
      `game_titles.is_active` being shared between the worker's poll filter and
      the frontend's `listGameTitles()`/title-resolver default — NHL 27 is now
      the _default_ title on `/` and `/games` on any host with no `?title=`
      param, on both databases, ahead of this decision actually being made.
      This was not a frontend change made this session; it is the existing
      shared `is_active` behavior reacting to the new row. **Decided
      2026-09-08:** see the "E1J NHL 26/27 CUTOVER + CAREER-STITCHING POLICY
      DECIDED" Active State entry — NHL 26 is deprecated for automatic
      ingestion, NHL 27 is the sole go-forward ingestion target and approved
      site default, and ingestion eligibility/frontend default/chronological
      ordering must become three independent controls. This closes as a
      policy/design decision supported by static code and schema review only
      — **no worker configuration, database row, schema, frontend code, or
      data was changed.** Actual implementation (the independent controls,
      resolver consolidation, stopping NHL 26 polling, and the chronology/
      range-label fixes) remains open, tracked under E1J and the E1 umbrella
      section below.
- [x] Verify the planned NHL 26 -> NHL 27 career-stat stitching rules before
      production cutover. **Decided 2026-09-08:** see the "E1J NHL 26/27
      CUTOVER + CAREER-STITCHING POLICY DECIDED" Active State entry — approved
      source precedence (manually reviewed NHL 26 totals authoritative once
      accepted, EA payloads preserved as provenance, no additive double
      counting), the combined-career-total-plus-per-title-table model is kept
      with mandatory cross-title labeling, and a manual identity review is
      required before combining a new title's stats into a player's career
      total (global gamertag matching alone is not sufficient proof of
      identity). Policy/design only, supported by static review — **no
      import, migration, or data change was performed.** The NHL 27 beta
      compatibility matrix and labeled benchmark immediately below remain
      unchecked E5 work; this decision does not touch or substitute for
      either.

#### Product-readiness audits and decisions

- [ ] Audit the existing mobile drawer/menu; fix rather than duplicate it.
- [ ] Audit every core route at 320, 375, 390, and 768 CSS pixels plus desktop.
- [ ] Record production performance baselines for all core routes.
- [x] Define public/private indexing rules and identify every route that must
      be excluded from search engines. **Decided 2026-09-07:** index `/`,
      `/games`, `/games/[id]`, `/roster`, `/roster/[id]`, `/stats`, and
      finished/published legal-contact pages; exclude preview, API,
      diagnostic, auth/admin, error, development-only, and query-variant
      URLs from the sitemap; mark query-driven variants `noindex, follow`
      rather than treating them as separate search results; remove the
      `/preview/**` routes and the public `/games?mode=dev` filter from
      production (approved, not yet done). Definition only — see the
      "E1F INDEXING POLICY DECIDED" Active State entry. `robots.txt`,
      sitemap, and canonical/OG metadata implementation remain Gate 3.
- [ ] Audit page titles and descriptions; the root metadata exists, but a
      title-only page does not satisfy the per-page description requirement.
- [x] Decide by this date whether the externally built game-sheet frontend is
      accepted and ready for October integration. Missing this decision makes
      that integration non-blocking and deferred. **Decided 2026-09-08:**
      accepted as already integrated — the matching prototype was ported
      through the July/August game-sheet revamp, already complete and
      committed; no separate October integration or duplicate port remains.
      See the "E1K FINAL OPERATOR DECISIONS RECORDED" Active State entry.
- [x] Resolve or explicitly defer the remaining small correctness/polish
      items: opponent player-score completeness, Top Performers contrast, and
      navbar subtitle. **Resolved 2026-09-08:** opponent player-score
      completeness deferred as no known defect; the specific recorded Top
      Performers contrast defect (old `--fg-5`) is closed as already fixed by
      the shipped token ramp; the navbar/masthead game-title label is decided
      to be removed as later UI implementation work (not done by this
      decision). See the "E1K FINAL OPERATOR DECISIONS RECORDED" Active State
      entry.

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
- [ ] Publish the Terms of Use.
- [ ] Publish the EA/NHL attribution and non-affiliation notice at
      `/legal/attribution`.
- [ ] Add a global footer containing a working webmaster contact.
- [ ] Render the current copyright year automatically.
- [ ] Link privacy, data-collection, Terms of Use, attribution/non-affiliation,
      and contact information from every normal page.
- [ ] Show cookie consent only if the deployed product uses nonessential
      cookies/tracking that require it.

#### Error handling, metadata, and discovery

- [ ] Add and verify a branded custom 404 page.
- [ ] Add and verify a useful production error/500 experience; confirm public
      responses expose no stack trace, internal path, secret, or other
      diagnostic detail, and confirm production browser source maps are not
      publicly served unless deliberately approved.
- [ ] Add useful page-specific titles and meta descriptions.
- [ ] Configure canonical URLs.
- [ ] Add Open Graph/social-preview metadata and a production preview image.
- [ ] Add/verify favicon and application icons.
- [ ] Configure `robots.txt` and sitemap behavior for the chosen access model.
- [ ] Ensure account, admin, diagnostic, preview, and other private routes are
      not indexed.
- [ ] Verify search-engine ownership only if public indexing is intended.
- [ ] Evaluate accurate `WebSite`/`SportsTeam` structured data and either
      implement it or explicitly defer it; do not publish `LocalBusiness` or
      other schema whose facts do not match this project.
- [ ] Decide whether known AI-training crawlers need separate `robots.txt`
      guidance and either implement that policy or explicitly defer it;
      crawler directives are advisory and never an access-control boundary.

#### Mobile, browser, and accessibility gate

- [ ] Existing mobile navigation works with touch, keyboard, Escape, focus
      trapping, focus return, and route changes.
- [ ] Core routes have no horizontal page overflow, clipped controls,
      unreadable tables, or inaccessible dialogs at supported widths.
- [ ] Dense stats tables and match modules remain usable on small screens.
- [ ] Verify semantic heading order, form/control labels, visible focus,
      meaningful image alternative text (with empty alt text retained for
      genuinely decorative images), contrast, reduced-motion behavior, and
      keyboard-only navigation.
- [ ] Exercise every interactive control on representative routes — navigation,
      mobile drawer, title switcher, filters, tabs, pagination and contextual
      links — and finish with no broken buttons or unexpected browser-console
      errors.
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
- [ ] Run a focused application-security review over every externally
      controlled input boundary: server-side path/query validation, EA/API
      payload validation, parameterized SQL (including every `sql.raw` use),
      unsafe/raw HTML, CORS behavior, request-body storage, predictable-ID
      authorization assumptions, and the dormant authentication/admin code.
      Record concrete findings; do not convert generic scanner warnings into
      defects without a reachable code path.
- [ ] Run a repository and built-artifact secret scan; confirm no real `.env`,
      credential, token, private key, or production secret is tracked, embedded
      in an image, or exposed to the browser. Example environment files may
      contain placeholders only.
- [ ] Rate-limit authentication, access-request, contact, and public API
      surfaces where applicable.
- [ ] Run a dependency/security audit and resolve critical findings or record a
      signed-off exception.
- [ ] Enable uptime and application-error monitoring with a tested notification
      destination.
- [ ] Run a broken-link and missing-asset scan covering internal navigation,
      game/player/context links, and every footer/legal destination.
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
- [x] Integrate the external game-sheet frontend only if it passed the
      September 14 acceptance decision; otherwise record it as deferred.
      **Already complete, 2026-09-08:** the matching prototype was already
      integrated through the completed July/August 12-phase game-sheet
      revamp. E1K accepted/reconciled that existing work on 2026-09-08 — it
      did not perform a new integration. No separate October integration
      remains unless a genuinely different artifact is later identified. See
      the "E1K FINAL OPERATOR DECISIONS RECORDED" Active State entry.
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
  gate. **Superseded by E1K (2026-09-08): the matching prototype passed —
  it was already integrated via the completed July/August revamp — so this
  non-goal did not trigger.** The rest of this non-goals list is unaffected.

### Completion rule

"Code complete" is not Operational V1 complete. The October 1 gate passes only
when every required checkbox above is either checked with evidence or explicitly
waived by the operator with a written reason, owner, and follow-up date. A
blocked non-goal stays documented and blocked; it is not silently promoted into
launch scope and it is not allowed to hold the terminal gate hostage.
