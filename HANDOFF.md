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
- [ ] Draft the Terms of Use.
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
      the *default* title on `/` and `/games` on any host with no `?title=`
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

## Active State

### 🟡 E2A OPERATOR DECISIONS RECORDED — E2 now IN PROGRESS; none of the four Gate 2 legal drafts is written (2026-09-08)

The operator reviewed the open E2 legal/policy questions and made the
following decisions. **This entry documents those decisions only — it drafts
no legal document, checks no Gate 2 legal-draft checkbox, and implements no
route, footer, metadata, cookie, logging, or asset change.** E2 moves from
**NOT STARTED** to **IN PROGRESS** on the strength of these decisions alone;
the privacy policy, data-collection policy, EA/NHL non-affiliation/attribution
notice, and Terms of Use drafts themselves remain unwritten.

1. **Public identity.** Publish as "Boogeymen — a community gaming club,"
   contactable through `webmaster@boogeymen.app`. No operator legal name or
   postal address is published at this stage. Legal review of the drafts
   remains required before publication.
2. **Governing terms.** Alberta law governs. No exclusive-venue clause; any
   mandatory statutory consumer/user rights are preserved regardless of venue
   or law-selection language.
3. **Children and age.** Retains the approved E1 posture unchanged: team
   membership is adult-only, no children are involved or planned. Opponents
   may be minors — their ages are unknown, unverifiable, not collected, and
   the project has no means to determine them. No under-13-specific threshold
   is introduced.
4. **Reuse.** Personal/noncommercial viewing and normal search-engine
   indexing are permitted. Disruptive bulk scraping, dataset republication,
   and commercial reuse require permission.
5. **Request verification.** Correction/deletion requesters must show
   reasonable evidence of gamertag control. Government ID is not requested by
   default.
6. **Request outcomes.** Correction, de-identification, or removal is
   decided case-by-case under applicable law and archival-integrity needs.
   Prior publication by EA is not automatic grounds to refuse a request.
7. **Recordings.** Source recordings contain party voice chat from team
   members who authorize recording. These recordings and derived frames stay
   under the already-approved indefinite-until-manual-deletion retention
   policy (see the "E1G PRIVACY/RETENTION POLICY" Active State entry) — this
   decision does not change retention. **Do not claim code inspection proves
   recording contents, or that the recordings contain no audio** — no such
   inspection has been performed.
8. **GitHub.** The detailed Data Collection Policy will disclose that the
   repository privately stores a limited set of authentic source fixtures,
   and that copies made during the repository's prior public period cannot be
   recalled.
9. **Assets.** A provenance/permission audit must be completed before
   attribution is finalized; unverifiable assets are replaced where
   necessary. **Do not assume fair use, nominal use, licence, or permission**
   for any third-party asset absent that audit.
10. **Cloudflare and Proton.** Any drafted language must be based on
    authoritative provider material and operator-supplied settings, using
    explicitly conditional wording until each fact is verified. **No external
    Cloudflare or Proton account was accessed in this session.**
11. **Effective date.** Drafts use the actual Gate 3 publication date as
    their effective date, not the drafting date.
12. **Revision notice.** Each published policy shows a "Last updated" date
    and the site carries an on-site notice for material changes.
13. **Contacts.** `webmaster@boogeymen.app` handles privacy, data,
    correction, and general requests; `security@boogeymen.app` handles
    vulnerability reports; `alerts@boogeymen.app` remains internal-only and is
    not published as a public contact.
14. **Player names.** Current manually entered `player_profiles.player_name`
    values are member-approved display names/aliases, not real names. This is
    recorded as an operator-attested fact, not independently verified per row.
    A fresh review is required if that entry practice changes.

**Factual corrections recorded alongside these decisions** (none imply new
behavior — they correct or narrow prior assumptions so future drafts don't
overstate verified fact):

- Active application source (`apps/web/src`, `apps/worker/src`,
  `packages/*/src`) contains no direct use of `localStorage`,
  `sessionStorage`, `document.cookie`, or `indexedDB` (grep-verified, zero
  matches, 2026-09-08). **This is not "no browser storage of any kind"** —
  framework/dependency internals, edge behavior, and deployed HTTP behavior
  were not verified and may still set cookies or use storage.
- `docker-compose.yml` configures no per-service logging driver, `log-opt`,
  or size/retention limit (grep-verified, zero matches). The effective
  logging driver and retention on both hosts is unknown until each host's
  Docker daemon configuration is inspected. **Do not call current logs
  bounded, unbounded, or indefinitely retained** — none of those claims is
  verified yet; this remains E4 work.
- The repository does not set `NEXT_TELEMETRY_DISABLED` anywhere
  (grep-verified across env files, Dockerfiles, and Compose). Effective
  Next.js telemetry state in the deployed app was not directly verified.
- The public static asset inventory is **87 files, including 84 X-Factor
  PNGs** (recounted and verified 2026-09-08 against `apps/web/public`) — not
  91 and 90 as previously assumed. Any asset-provenance work (decision 9
  above) should use these verified counts.

See `docs/planning/launch-page-design-prototypes.md` for the related,
separately-tracked cataloguing of the operator's local Claude Design ZIP
exports (unchanged by this entry's decisions; those exports remain visual
references only, per that file's content-boundary section).

### 🟡 E2B2 CLOUDFLARE/PROTON PROVIDER SETTINGS RECORDED — Web Analytics contradicts the E1 no-tracking decision; operator choice required (2026-09-08)

Documentation-only session, following on from E2A. The operator read the
settings below directly from the live Cloudflare zone dashboard and Proton
account dashboard and reported them for the record. **No external Cloudflare,
Proton, GitHub, host, or database account was accessed by this agent session**
— everything below is operator-attested dashboard evidence, the same basis
already accepted for the E1B registrar facts and the E2A decisions. **This
entry drafts no legal language, checks no Gate 2 checkbox, implements no
route, and changes no provider setting.** Gate 2/E2 status is unchanged from
E2A: **IN PROGRESS**, all four legal drafts still unwritten.

**Cloudflare zone (`boogeymen.app`), as of 2026-09-08:**

- Zone plan: Free.
- DNS: apex `boogeymen.app` and `www.boogeymen.app` are both Tunnel records,
  Proxied. No other website-serving hostname was identified. Mail records
  (MX/SPF/DKIM/DMARC — see the "LAUNCH POLICY + DOMAIN MAIL" entry) are
  separate and DNS-only.
- TLS: encryption mode is **Full** (not Full (strict); no authenticated
  origin-pull or per-hop encryption claim follows from this). Universal SSL
  is Active. Always Use HTTPS is **Off** — do not infer that plain HTTP is
  reachable or that no other redirect exists; runtime behavior was not
  tested.
- Web Analytics: **listed and enabled**, using the exact option "Enable,
  excluding visitor data in the EU." Cloudflare states its Web Analytics JS
  snippet is not injected for EU visitors; for this proxied site, collection
  outside the EU uses Cloudflare's automatic setup. This exclusion concerns
  only the Web Analytics snippet — **do not broaden it into "Cloudflare does
  not process EU traffic"** (the proxy itself still handles all EU requests).
- Security posture: Bot Fight Mode Off. The Free Managed Ruleset is
  always-active/default protection; 0 additional operator-deployed managed
  rules (the dashboard offers a plan upgrade for more). Custom rules: 0 of 5,
  none enabled. Rate-limiting rules: 0 of 1, no actions/characteristics
  configured. Always Online: Off (no Internet Archive integration enabled
  through that feature). Load Balancing: page available, not enabled, zero
  configured balancers. Waiting Room: not enabled, zero configured rooms,
  requires a Business-plan upgrade.
- "Replace insecure JavaScript libraries" is **On** — it may rewrite
  applicable `polyfill.io` references to Cloudflare-hosted alternatives. This
  does not prove the application currently requests such a library.
- Logs: no Logs, Logpush, Log Explorer, or Instant Logs menu/product was
  visible in the zone dashboard, and no operator-configured detailed-log job,
  dataset, destination, or retention setting was found. The built-in
  aggregate HTTP Traffic dashboard (request statistics) is available and is
  **not** the same thing as operator-accessible raw request logs. **Do not
  claim Cloudflare keeps no internal edge logs, and do not assign an
  unverified retention duration** to whatever it keeps internally.

**Proton account, as of 2026-09-08:**

- Account Monitor: On, with detailed events On and displayed. Proton states
  detailed account events can include the operator's IP address and the
  Proton application used — this is operator-account security telemetry, not
  website-visitor data, and its contents are not recorded here.
- Auto-delete unwanted messages: **Off** — the optional automatic 30-day
  deletion of Spam/Trash is not enabled. This is a technical mail-client
  setting, not a retention policy for `webmaster@`/privacy correspondence;
  see the open question below. Do not claim messages are retained forever
  either — manual deletion and Proton's own lifecycle behavior are separate
  from this toggle.
- Addresses: `webmaster@boogeymen.app`, `security@boogeymen.app`, and
  `alerts@boogeymen.app` are all present, enabled, and deliver into the same
  Proton mailbox under one account's My Addresses list (consistent with the
  "LAUNCH POLICY + DOMAIN MAIL" entry). Active forwarding rules: 0. Catch-all:
  disabled; catch-all destination not applicable (dashboard action reads "Set
  catch-all").
- Mail access footprint: web browser only. No official desktop app, no
  official mobile app, no Proton Mail Bridge, no third-party mail client, no
  project-mail MBOX/EML/PDF export, and no separate project-mail backup or
  sync exists. **Do not broaden this into "the browser stores nothing"** —
  browser-side caching/storage was not inspected.
- Alternative routing: not applicable to the current web-only usage — Proton
  states this feature applies to its mobile/desktop apps and is unavailable
  for its websites. Revisit if client usage changes.
- Proton Drive: not currently used for this project and not previously used
  for this project; the operator reports it is empty. This is
  operator-attested, not independently inspected. It does not cancel Proton
  Drive as the approved future E3 backup destination (E3 backup integration
  and uploads have not started — see the "E3" roadmap entry).

**Required unresolved findings — operator decisions still needed, not made by
this entry:**

- **Web Analytics vs. the E1 no-tracking decision.** Cloudflare Web Analytics
  being enabled directly conflicts with the approved "LAUNCH POLICY + DOMAIN
  MAIL" decision that the launch site "has no analytics or advertising and
  uses no nonessential cookies/tracking; a consent banner is not planned
  unless that changes." This session does **not** resolve the conflict and
  does **not** change any Cloudflare setting. The operator must choose one
  of: **(a)** disable Cloudflare Web Analytics before launch, preserving the
  existing no-analytics decision as-is, or **(b)** amend the launch decision
  and have the data-collection policy draft accurately disclose the
  analytics collection described above. Do not assert a consent banner is
  legally required merely from this dashboard setting — that determination
  is part of the still-required legal review of the Gate 2 drafts.
- **Contact-email retention.** Proton Auto-delete being Off is a mailbox
  technical setting, not a retention policy. The operator still needs to
  decide (and the data-collection policy still needs to state) how long
  `webmaster@`/`security@`/`alerts@` correspondence — including
  correction/deletion requests — is retained.
- **Retention durations remain unverified.** Neither Cloudflare's internal
  edge-log retention nor its Web Analytics data retention duration is known
  from this session; any future draft language must use
  conditional/provider-controlled wording rather than a specific duration.
- **Asset provenance/permission audit remains open**, per E2A decision 9 —
  unaffected by this entry; attribution still cannot be finalized and no
  fair-use assumption is permitted.
- **Correction (this session): Web Analytics is cookie-free; a narrower
  cookie question remains.** The prior version of this bullet incorrectly
  listed Web Analytics among Cloudflare features that may issue cookies
  conditionally. Per Cloudflare's own documentation
  (https://developers.cloudflare.com/web-analytics/about/,
  https://www.cloudflare.com/web-analytics/), Cloudflare Web Analytics does
  not use cookies, `localStorage`, or other client-side state to collect
  metrics, and Cloudflare states it does not fingerprint individuals for
  analytics. The enabled Web Analytics setting still conflicts with E1's
  explicit "no analytics" decision, per the bullet above — that conflict is
  unchanged and still requires an operator choice. But being cookie-free
  means Web Analytics does **not**, by itself, conflict with E1's separate
  "no nonessential cookies" decision, and does not by itself establish that a
  consent banner is required. A broader claim that Cloudflare never sets
  cookies is still unsupported — Cloudflare's edge security/challenge
  mechanisms (e.g. the Free Managed Ruleset, or a future Bot Fight Mode or
  challenge) may still issue strictly-necessary cookies conditionally,
  independent of Web Analytics. Future legal drafting must distinguish the
  cookie-free Web Analytics beacon from feature-dependent Cloudflare security
  cookies, and must not list any specific cookie without documentation or
  deployed-site observation supporting it. These are Cloudflare's own
  privacy/documentation claims, attributed to Cloudflare — recording them
  here is not an independent legal conclusion that no personal information is
  processed by Web Analytics or by Cloudflare generally; that determination
  remains part of the still-required legal review.

**What this does not establish.** It does not authorize or imply any
Cloudflare/Proton configuration change, tunnel reopening (still separately
unauthorized — see "Tunnel reopening" below), production migration, or
backup activation. It does not draft or approve any Gate 2 legal language and
does not check any Gate 2 checkbox — E2A's fourteen decisions remain the only
checked-off E2 decisions, and all four legal drafts (privacy policy,
data-collection policy, EA/NHL attribution notice, Terms of Use) remain
unwritten. See the "E2A OPERATOR DECISIONS RECORDED" entry above, decision 10,
for the standing rule this entry supplies evidence for (conditional wording,
authoritative provider material, operator-supplied settings).

### 🟡 E2B3 ANALYTICS AND EMAIL-RETENTION DECISIONS RECORDED — Web Analytics must be disabled before publication, not yet done; contact-email retention set as targets, not automated (2026-09-08)

Documentation-only session, resolving the two operator questions the "E2B2
CLOUDFLARE/PROTON PROVIDER SETTINGS RECORDED" entry left open. **This entry
drafts no legal language, checks no Gate 2 checkbox, implements no route, and
changes no provider setting — no external Cloudflare, Proton, GitHub, host, or
database account was accessed in this session.** Gate 2/E2 status is
unchanged: **IN PROGRESS**, all four legal drafts still unwritten.

**Decision 1 — Cloudflare Web Analytics vs. the E1 no-analytics decision.**
The operator chose to **preserve the E1 "no analytics or advertising, no
nonessential tracking/cookies" launch decision unchanged**, over amending it
to accommodate Web Analytics.

- Cloudflare Web Analytics ("Enable, excluding visitor data in the EU") is
  **currently enabled** on the `boogeymen.app` zone, per the "E2B2
  CLOUDFLARE/PROTON PROVIDER SETTINGS RECORDED" entry. **That has not changed
  in this session.**
- **Disabling Web Analytics before publication is now a required launch
  precondition.** It is not done. Turning it off in the Cloudflare dashboard
  is separately authorized future work — **it was not performed in this
  session** and this entry does not authorize performing it.
- Until an operator session confirms, from the live dashboard, that Web
  Analytics is off, **no draft, page, or status note may state "no analytics"
  or "analytics disabled" as a current operational fact.** The correct
  interim framing is: analytics is currently enabled and scheduled for
  disablement before launch, not yet disabled.
- This resolves the E2B2 "Web Analytics vs. the E1 no-tracking decision" open
  bullet by choosing its option (a) (disable before launch, preserve the
  existing decision) over option (b) (amend the decision). E2B2's cookie-free
  correction (Web Analytics itself is not a cookie-consent trigger) is
  unaffected and still stands.
- **Not resolved by this decision, and not addressed here:** Cloudflare's own
  internal edge-log or Web Analytics data-retention duration. That remains
  open exactly as E2B2 left it — any future draft language must still use
  conditional, provider-attributed wording rather than a specific duration.

**Decision 2 — contact-email retention.** The operator adopted a **tiered
retention schedule** as the project's contact-email retention target for
`webmaster@boogeymen.app`, `security@boogeymen.app`, and `alerts@boogeymen.app`
correspondence (all of which deliver into one Proton mailbox, per E2B2, with
Proton's optional Spam/Trash auto-delete Off):

- Obvious spam/junk: deleted manually as soon as practical, targeting within
  30 days.
- Routine `webmaster@`/general correspondence and routine internal `alerts@`
  traffic: retained up to 12 months after the last necessary action.
- Privacy requests, correction/de-identification/removal requests,
  vulnerability reports, and security-incident correspondence: retained up to
  24 months after final closure.
- Any of the above may be retained longer only while reasonably necessary for
  an active request, dispute, investigation, security incident,
  archival-integrity issue, or legal obligation.
- Extended retention is reviewed at least annually and deleted once the
  reason for keeping it ends.

**This is an operator retention target and manual policy, not a technical
control and not proof of automated enforcement.** Proton's Spam/Trash
auto-delete remains Off (per E2B2) and this decision does not turn it on or
otherwise configure Proton. No forwarding, export, Bridge, or backup exists
(per E2B2) to apply the schedule to beyond the single live mailbox. Future
drafts must describe this as the operator's stated retention target/practice,
not as something Proton automatically enforces. This resolves the E2B2
"Contact-email retention" open bullet.

**Explicitly out of scope for this entry, per operator instruction:**
Cloudflare's own provider-side retention duration (left open, see above), the
asset-provenance/permission audit (E2A decision 9, untouched), any Gate 2
legal-document text or checkbox, and the tunnel (reopening remains separately
unauthorized).

**What this does not establish.** It does not authorize or imply any
Cloudflare or Proton configuration change, tunnel reopening, production
migration, or backup activation. It does not draft or approve any Gate 2
legal language and does not check any Gate 2 checkbox — E2A's fourteen
decisions remain the only checked-off E2 decisions, and all four legal drafts
(privacy policy, data-collection policy, EA/NHL attribution notice, Terms of
Use) remain unwritten. See the "E2A OPERATOR DECISIONS RECORDED" and "E2B2
CLOUDFLARE/PROTON PROVIDER SETTINGS RECORDED" entries above for the decisions
and open questions this entry builds on and resolves.

### 🟡 E2C2 ASSET PROVENANCE INTERVIEW RECORDED — operator attestations plus corrected local findings; no asset is legally cleared (2026-09-08)

Documentation-only session advancing E2A decision 9 (asset provenance/permission
audit). **This entry drafts no legal language, checks no Gate 2 checkbox,
changes no code, configuration, or asset, and replaces nothing.** No external
network, provider account, or repository account was accessed. Gate 2/E2 status
is unchanged: **IN PROGRESS**, all four legal drafts still unwritten. The
audit itself is **not complete** — this entry records interview answers and
locally verified repository facts only. **Attribution still cannot be
finalized, and no fair-use, nominal-use, licence, or permission assumption is
permitted for any asset below.** Tunnel reopening remains separately
unauthorized.

**Corrections to the prior (unrecorded) E2C1 working report.** That report was
not adopted wholesale; the following corrections were verified against the
repository in this session and supersede it.

- **EA opponent crests are server-side optimized, not direct browser fetches.**
  `apps/web/src/components/ui/opponent-crest.tsx` renders through `next/image`
  with no `unoptimized` prop; `apps/web/next.config.ts` configures only
  `images.remotePatterns` for the two `media.contentapi.ea.com` crest paths,
  with no custom loader or `loaderFile`; production runs `next start`
  (`apps/web/Dockerfile:43`). **Repository evidence therefore does not
  establish a direct visitor-browser request to EA, nor disclosure of each
  visitor's IP or user-agent to EA.** Treat the crests as an **external
  asset/IP and server-fetch dependency**, not an established visitor-privacy
  disclosure gap. **Live behavior was not runtime-tested in this session** —
  no claim about deployed request flow is made either way.
- **"Replacement likely required" is withdrawn.** The correct standing
  framing for every unverified family is **"permission/licence basis
  unverified; research or replacement required."**
- **E2A decision 9 blocks finalizing attribution before the audit. It does not
  prohibit creating conditional legal drafts.** Draft work may proceed with
  explicitly conditional asset language.
- **The absence of a repository `LICENSE` file does not itself block Gate 2**
  and does not require the Terms of Use to reference one. (Verified: no
  `LICENSE*` at repo root.) A third-party notices file remains a *possible*
  later requirement depending on which licences verification actually turns up.
- **`scripts/scrape_ea_xfactor_pngs.sh` is evidence of acquisition/source
  history**, neutrally recorded: it fetches 28 detail pages under
  `ea.com/games/nhl/nhl-26/nhl26-x-factors-hub` and downloads the referenced
  `drop-assets.ea.com` PNGs into `apps/web/public/assets/x-factors/`. It is
  **not** characterized as "evidence against the project."
- **The `docs/branding/README.md` naming rule is a provenance-process
  weakness, not intentional provenance destruction.** The rule reads "Drop
  source-site suffixes like `svgrepo-com`," and commit `22faa4c` renamed eight
  `*-svgrepo-com.*` files accordingly. The effect is that filenames no longer
  carry source hints; no intent to destroy provenance is claimed or implied.
- **Scope distinction preserved.** `apps/web/public` holds **87 files** (84
  X-Factor PNGs + `assets/platforms/{playstation,xbox}.svg` +
  `images/bgm-logo.png`), confirming the E2A recount. The **wider production
  visual surface is larger** and additionally includes
  `apps/web/src/app/icon.png`, inline SVG paths in
  `components/ui/archetype-icons.tsx` (its own comment: "Sourced from
  `docs/branding/icons/archetypes/`"), `components/branding/rink.tsx` and
  `event-markers.tsx`, `components/player-meta-icons.tsx` ("Twemoji-style
  emoji flags"), build-produced Barlow / Barlow Semi Condensed served via
  `next/font/google` from `apps/web/src/app/layout.tsx`, and the remote EA
  crest sources. Asset work must address the wider surface, not the 87-file
  count alone.
- **`docs/Branding/spd_logo_final_3.png` is not a current fourth file.** It is
  absent from the working tree, recoverable from Git history (added `0ab776b`,
  case-renamed `e21c336` as R100, deleted in `22faa4c` — the same commit that
  introduced `docs/branding/logos/team/spd-logo-mark.png`), and its historical
  content hashes identically (sha256 `13f08949…2203d2a8`) to the three current
  files `docs/branding/logos/team/spd-logo-mark.png`,
  `apps/web/public/images/bgm-logo.png`, and `apps/web/src/app/icon.png`.
  Three current byte-identical copies, one historical path.

**Operator attestations (recorded as operator-attested facts, not
independently verified and not legal clearance).**

1. **BGM/SPD logo.** The operator created the `spd_logo_final_*` artwork
   themselves. "SPD" was an old private clan tag; **its expansion is
   confidential and must not be published** in any draft, page, or commit.
   Supporting evidence is the original project source files retained privately
   on the operator's computer; those files are deliberately **not** added to
   the repository, and no contract or personal information was copied here.
   Recorded as operator-attested authorship.
2. **Rink and event-marker artwork.** The operator created the rink map and
   event markers **from scratch**; no third-party artwork was incorporated.
   The operator supplied that original work to Claude Design, which
   incorporated it into the Concept B / Action Tracker design and from there
   into the site. **Claude Design is therefore not the original source of this
   artwork** and must not be described as such. Recorded as operator-attested
   authorship.
3. **NHL 26 X-Factor images.** **None known** — no direct EA permission, no
   creator-program permission, no correspondence, and no previously reviewed
   EA content-usage-policy basis.
4. **SVG-derived icons** (flags, archetypes, hockey icons, platform marks).
   Found online through SVG sites, including the SVG Repo-derived files that
   repository evidence identifies. **No exact per-asset source-page URLs and
   no saved per-asset licence records are retained.** Licences and permission
   basis remain unverified. *Independently checked this session and
   corrected:* `docs/branding/` contains no licence file, no attribution
   file, and no exact per-asset source-page URLs — but embedded SVG Repo
   generator markers (`<!-- Uploaded to: SVG Repo -->`, `www.svgrepo.com`,
   `SVG Repo Mixer Tools`) are present in **27 files** across
   `docs/branding/` (`flags`: 2, `icons/archetypes`: 15, `icons/hockey`: 6,
   `icons/archive` duplicates: 2, `logos/platforms`: 2, `rink-event-map`: 0),
   plus both deployed copies under `apps/web/public/assets/platforms/`, for
   **29 repository SVG files total** carrying these markers.
   `icons/archetypes/defensive-defenseman.svg` also carries an Affinity/Serif
   XML namespace declaration in addition to the SVG Repo comment — additional
   generator metadata, not its only marker, and not a source URL or licence,
   and not evidence of authorship. The generic `www.svgrepo.com` site marker
   is not an exact per-asset source-page URL and does not identify the
   applicable licence.
5. **PlayStation and Xbox marks.** Obtained through SVG Repo. **No separately
   retained Sony or Microsoft permission or brand-guideline evidence is
   known.** Note that a third-party SVG Repo licence, whatever it turns out to
   be, would not by itself address the platform holders' own trademark/brand
   rights.
6. **EA opponent crests.** **None known** — no direct EA permission, no
   correspondence, and no previously documented content-usage-policy basis.

**Corrected asset-family classifications.** These describe verification status
only. **No family below is legally cleared**, and operator recollection of a
source is expressly not treated as clearance.

- **BGM/SPD logo** (`logos/team/spd-logo-*.png`, `public/images/bgm-logo.png`,
  `app/icon.png`) — **operator-created/permission evidence identified**
  (operator authorship attested; private source files cited but not inspected
  by any agent session). Not independently verified.
- **Rink + event markers** (`components/branding/rink.tsx`,
  `event-markers.tsx`, `docs/branding/rink-event-map/`) — **operator-created/
  permission evidence identified** (operator authorship attested; Claude
  Design was downstream, not the source). Not independently verified.
- **NHL 26 X-Factor images** (84 PNGs, `public/assets/x-factors/`) —
  **official-source research required**; **replacement candidate if research
  fails.** Permission/licence basis unverified.
- **EA opponent crests** (remote, `media.contentapi.ea.com`) — **official-source
  research required**; **replacement candidate if research fails.** External
  asset/IP and server-fetch dependency. Permission/licence basis unverified.
- **PlayStation and Xbox marks** (`public/assets/platforms/*.svg`) —
  **official-source research required** (Sony and Microsoft brand/trademark
  guidance) **plus source-page/licence recovery required** (SVG Repo terms);
  **replacement candidate if research fails.**
- **SVG Repo-derived flags, archetype icons, hockey icons** (`docs/branding/
  flags/`, `icons/archetypes/`, `icons/hockey/`, and the inline paths in
  `components/ui/archetype-icons.tsx`) — **source-page/licence recovery
  required**; **replacement candidate if recovery fails.**
- **Twemoji-style flag SVGs** (`docs/branding/flags/canada.svg`,
  `united-states.svg`, and the inline flags in
  `components/player-meta-icons.tsx`) — **official-source research required**
  (Twemoji licence terms and their attribution conditions). The files carry
  `class="iconify iconify--twemoji"`; whether they are genuine Twemoji assets
  and which licence version applies is **unverified**.
- **Barlow / Barlow Semi Condensed** (via `next/font/google`, build-produced) —
  **official-source research required** (font licence and any redistribution/
  attribution condition arising from self-hosting at build time).

**What remains open after this entry.**

- Official-source research into EA, Sony, Microsoft, Twemoji, SVG Repo, and
  font licence requirements. **Not started.**
- Any asset replacement work that research turns out to require. **Not
  started; nothing was replaced.**
- Final attribution language and whatever Terms of Use wording it affects.
  **Still blocked from finalization by E2A decision 9** (conditional drafts
  are permitted).
- Whether a third-party notices file is needed. Undetermined.
- Disabling Cloudflare Web Analytics and verifying it from the live dashboard
  before publication (per E2B3 decision 1). **Still not done.**
- Legal review of all Gate 2 drafts. **Still required.**

**What this does not establish.** It does not clear any asset for use, does not
finalize attribution, and does not authorize replacing, editing, or removing
any asset. It does not authorize any Cloudflare/Proton configuration change,
tunnel reopening, production migration, or backup activation. It does not draft
or approve any Gate 2 legal language and does not check any Gate 2 checkbox —
E2A's fourteen decisions remain the only checked-off E2 decisions, and all four
legal drafts (privacy policy, data-collection policy, EA/NHL attribution
notice, Terms of Use) remain unwritten. See the "E2A OPERATOR DECISIONS
RECORDED" entry (decision 9) for the standing rule this entry advances, and
"E2B3 ANALYTICS AND EMAIL-RETENTION DECISIONS RECORDED" for the launch
preconditions it leaves untouched.

### 🟡 E2C3 EA CONTENT-USAGE POLICY RESEARCH RECORDED — no EA asset family is cleared; attribution still blocked (2026-09-09)

Public-web research session advancing E2A decision 9 for the **EA-controlled
asset families only**. Official EA sources only (`ea.com`, `help.ea.com`,
`tos.ea.com`); no EA account accessed, no form submitted, no message sent, no
agreement accepted, no EA API called, no asset file downloaded, no asset or
code changed, no provider setting touched. **This entry drafts no legal
language and checks no Gate 2 checkbox.** Gate 2/E2 status unchanged: **IN
PROGRESS**, all four legal drafts still unwritten. Tunnel reopening remains
separately unauthorized.

**Full evidence, exact quotations, source matrix, and unresolved questions:**
`docs/planning/ea-content-usage-policy-research.md`. **This is research, not
legal advice, and clears nothing.**

**Evidence-backed findings (each verified on the official EA page itself).**

- **EA does publish a fan-content permission** — "EA's content policy",
  `help.ea.com/en/articles/security-and-rules/ea-content-policy/`, last updated
  **2026-08-03**. It expressly names **fan sites** as a permitted personal
  project. It is **help content and is not incorporated by reference** into the
  User Agreement (only the Terms of Sale, Positive Play Charter, and Privacy and
  Cookie Policy are). EA's separately-titled "IP Policy" URL resolves to this
  same article — there is no more permissive second document.
- **The EA User Agreement (contractual, Last Updated 2026-05-14) governs EA's
  websites** and, at §2, bars users from "access, copy, modify or distribute[ing]
  any EA Service, Content or Entitlements … unless expressly authorized by EA or
  permitted by law." §3 defines Content to include graphics and pictures
  "appearing on or coming from EA Services, as well as the design and appearance
  of our websites." §13(A) says the Agreement may be amended only in writing
  signed by EA. **EA's official content policy is a published permission
  expressly covering qualifying personal fan sites' use of "our game content."
  It is not expressly incorporated into the User Agreement, but §13(A) does not
  establish that separate EA permission is ineffective. The unresolved issues
  are asset scope, particular use, rehosting/acquisition, and third-party
  rights** — not incorporation-by-reference alone.
- **EA expressly grants no third-party rights:** "We do not provide you with any
  permission to use third-party content from our games. You use our game content
  at your own risk." **EA cannot and does not purport to license NHL, NHLPA,
  team/league branding, or player likenesses.** No EA page found publishes a list
  of which NHL 26 assets are third-party licensed, so per-asset third-party
  exposure is **unresolved**.
- **Custom crests' pass-through status depends on their unresolved factual
  nature.** If a custom crest is contributed UGC, User Agreement §5 identifies
  no off-service user licence — it grants other users rights only "**on or
  through the relevant EA Service**." If it is EA-rendered from EA-supplied
  components, the EA game-content-policy analysis applies instead. **Which of
  the two applies is unresolved.**
- **Conditions if any permission is relied on:** the verbatim non-affiliation
  statement EA specifies; no implied endorsement; no merging EA branding with
  ours; no commercial use or paywalls (passive banner ads and partner-program
  video monetization are the only stated exception — **donations, sponsorship,
  and subscriptions are not named and are therefore not covered**); no combining
  EA content with other third-party brands. **The reviewed EA policy specifies
  the non-affiliation statement. No additional EA-authored attribution or
  copyright-notice requirement was found in the reviewed sources. Third-party
  rights may impose independent requirements**, and the non-affiliation
  statement is a condition on permission, never evidence of it.
- **Permission is revocable at will.** EA reserves the right to update the policy
  "at any time without notice," non-enforcement is not waiver, and the User
  Agreement licence is expressly "revocable."
- **Acquisition method, kept separate from permission to display.** **No clause
  expressly naming scraping, robots, spiders, crawlers, or bots was found** in
  the User Agreement (full-text verified). User Agreement §2's general access,
  copying, and extraction restrictions remain relevant. `www.ea.com/robots.txt`
  does **not** disallow `/games/nhl/…` for general crawlers, but carries a
  unilateral reservation-of-rights comment prohibiting "web scraping" of EA
  content "unless specifically and explicitly authorized in writing." **Its scope
  is genuinely ambiguous** — the plain series reads as a general scraping ban,
  the surrounding context is an AI/TDM reservation invoking EU DSM Art. 4(3).
  **No finding of wrongdoing is made**; EA's text does not clearly apply either
  way. `drop-assets.ea.com/robots.txt` — the host the 84 PNGs were actually
  downloaded from — **could not be read (HTTP 503 on two attempts)**; that gap is
  open. `media.contentapi.ea.com` publishes no robots.txt (404). `legal.ea.com`
  does not resolve.
- **Repository facts re-verified this session:** 84 PNGs across 28 folders;
  `scripts/scrape_ea_xfactor_pngs.sh` targets the `ea.com` NHL 26 X-Factors hub
  and `drop-assets.ea.com`; `opponent-crest.tsx` uses `next/image`;
  `format.ts:161-162` builds the two crest paths; `next.config.ts` permits
  exactly those two `media.contentapi.ea.com` paths. **Material consequence:**
  the repository configures default Next.js image optimization for those paths,
  which normally fetches and serves remote images through the site and may
  resize, transcode, or cache them. Deployed behavior was not runtime-tested.
  Legal characterization remains for legal review.
- **Official EA legal index searched during this research; not proof that no
  other EA or game-specific terms exist.** The NHL 26 Pro Clubs marketing URL
  (`ea.com/games/nhl/nhl-26/pro-clubs`) currently redirects to the NHL 27 page,
  so it did not establish an NHL-26-specific crest-creation mechanism.

**Status by EA asset family. No family is legally cleared.**

- **84 NHL 26 X-Factor PNGs** (`apps/web/public/assets/x-factors/`) —
  **NOT ADDRESSED / AMBIGUOUS → legal review required; replacement candidate.**
  EA's policy permits fan sites but never addresses copying standalone marketing
  artwork off EA's website and rehosting it as a self-contained asset library.
- **EA base crests** (`…/pro-clubs/crests/t<id>.png`) — **CONDITIONALLY
  SUPPORTED AT BEST, on unverified premises → legal review required; replacement
  candidate.** Closest of the three to "game content," but EA publishes nothing
  on embedding, linking, caching, or proxying, and whether any base crest
  reproduces a real-world mark is unverified.
- **Custom / user-created opponent crests** (`…/pro-clubs/custom-crests/<id>.png`)
  — **CONDITIONAL / FACTUAL NATURE UNRESOLVED → legal review required;
  replacement candidate.** If contributed UGC, §5 identifies no off-service
  user licence. If EA-rendered from EA-supplied components, the EA
  game-content-policy analysis applies (as for the base crests, above).
  Repository names (e.g. `custom-crests`) do not determine which is true. No
  official EA page found describes the crest-creation mechanic, and the one
  page found under an NHL 26 URL (S8) redirects to the NHL 27 page, so it does
  not resolve the question either.

**Still blocked.** **Attribution finalization remains blocked** under E2A
decision 9; this session advances the audit for the EA families only and does not
complete it. The Sony, Microsoft, SVG Repo, Twemoji, and font families recorded
in E2C2 are untouched and still open, as are the operator-created BGM/SPD and
rink/event-marker attestations. Legal review of all Gate 2 drafts is still
required.

**Recommended next session (one task).** Produce an EA-asset decision memo
covering, per family, the concrete replacement or removal option and its product
cost — documentation only, no asset touched, no code changed. See the research
document's section 10 for the sequence after that, and the "E2C2 ASSET
PROVENANCE INTERVIEW RECORDED" and "E2A OPERATOR DECISIONS RECORDED" entries for
the standing rules this entry advances.

### 🟡 E2C4 EA ASSET PRODUCT-IMPACT DECISION MEMO RECORDED — options and recommendation only; no asset, code, or legal classification changed (2026-09-09)

Repository-based product/engineering analysis session, following E2C3.
**No asset, code, test, configuration, dependency, or provider setting
changed. No database, host, Cloudflare, Proton, or GitHub account accessed.
No legal draft written, no Gate 2 checkbox checked, no E2C3 legal
classification altered.** Tunnel reopening remains separately unauthorized.
E2/Gate 2 status unchanged: **IN PROGRESS**.

**Full analysis, per-option cost tables, and the recommendation:**
`docs/planning/ea-asset-decision-memo.md`. **This is decision support, not
legal advice, and does not clear any asset.**

**Verified rendering surfaces and technical dependencies (repository facts,
this session).**

- **X-Factor PNGs:** 84 files, 71 MB, under `apps/web/public/assets/x-factors/`.
  **A second, byte-for-byte identical 71 MB copy exists at
  `docs/branding/icons/x-factors/`** (`diff -qr` confirmed) — it has no
  application, worker, or OCR runtime-code dependency, but it is actively
  referenced by two tracked Markdown documents (`research/OCR-SS/apx.md`
  and `research/OCR-SS/Manual OCR benchmark match 463.md`, 28 inline `<img>`
  references each, **56 total**): a runtime-code-unused duplicate, not an
  unreferenced one. Repository storage across both copies is ~142 MB; only
  the primary 71 MB tree is copied into the web Docker image
  (`apps/web/Dockerfile` does not copy `docs/branding/`). Exactly one
  production visual consumer: `XFactorTiles` in
  `components/matches/lineup/lineup-row.tsx` via `lib/xfactor-asset.ts`. A
  tier-coloured dot fallback is **implemented in current source** for
  missing icons (not runtime-tested or deployment-verified this session).
  **A second, separate, non-decorative consumer exists outside the
  website:** `tools/game_ocr/game_ocr/xfactor_icon_matcher.py` loads the
  same 84 PNGs as OpenCV template-matching references for the video-ingestion
  OCR pipeline (wired into `parsers.py` / `loadout_extractors/icon.py`, with
  its own tests) — **removing the files would break OCR icon matching unless
  they are relocated first**, not merely deleted. The Node worker's text
  normalization/DB storage/backfill (`apps/worker/src/lib/normalize-xfactor.ts`,
  `player_loadout_x_factors`: name/canonical-name/tier, all text) is
  independent of the artwork; **the video-ingestion OCR icon-matching path
  is not** — that distinction was not made precisely in E2C4's first draft.
  This session did not verify whether/when the OCR path runs in deployed
  production operations.
- **Opponent crests:** full chain traced — EA `customKit.crestAssetId`/
  `useBaseAsset` → `ingest-opponents.ts` → `opponent_clubs.crest_asset_id`/
  `use_base_asset` (opaque ID + flag only, no image bytes stored) →
  `opponentCrestUrls()` in `lib/format.ts` (builds base/custom CDN URLs,
  order set by `useBaseAsset`) → `OpponentCrest` component (`next/image`
  with preferred/alternate retry via `onError`, then a caller-supplied
  `fallback`). **Exactly four production consumers** (`score-card.tsx`,
  `lineup-module.tsx`, `hero-card.tsx`, `latest-result.tsx`), **all four
  already implement a 2-letter club-abbreviation monogram fallback in
  current source** (`abbreviateTeamName()`; not runtime-tested or
  deployment-verified this session). Base and custom crests already have
  independent `next.config.ts` `remotePatterns` entries and can be disabled
  separately and reliably by changing `opponentCrestUrls()` alone, with no
  changes needed to any of the four calling components. No existing test
  covers `opponentCrestUrls()` or `OpponentCrest`. No live database was
  queried and no deployed request behavior was tested — this is a static
  code trace only.

**Options and recommendation per family (see the memo for the full
12-dimension comparison per option).**

- **X-Factor PNGs — leading removal/replacement candidate**, per E2C3's
  weakest classification. Recommended path: relocate the OCR templates out
  of the public web tree, then let the dot fallback already implemented in
  current source become the only rendering (Option 2); purpose-built
  neutral badges (Option 3) are optional later polish, not a prerequisite.
- **Custom opponent crests — the other leading removal/replacement
  candidate**, per E2C3's unresolved UGC-vs-EA-rendered classification.
  Disabling just this family via `opponentCrestUrls()` is small and
  isolated, with a fallback already implemented in current source.
- **EA base crests — the closest call, not cleared.** Retention pending
  legal review (Option 1) is defensible specifically for this family;
  disabling it later is equally cheap if the operator prefers a uniform
  posture across both crest families instead of a split one.
- **One shared neutral fallback could replace both crest families** if
  both are disabled — they already funnel through the same component and
  fallback contract.
- **Smallest reversible sequence:** (1) relocate X-Factor OCR templates,
  (2) decide the fate of the `docs/branding/icons/x-factors/` duplicate —
  zero application/OCR runtime dependency and independent of every other
  decision, but its 56 inline documentation references (see above) need an
  explicit repoint/retain/replace/remove choice first, not a bare deletion,
  (3) drop the X-Factor `<Image>` branch in favour of the existing dot, (4) stop
  `opponentCrestUrls()` from returning URLs for whichever crest family/
  families are disabled, (5) optionally prune the matching
  `next.config.ts` `remotePatterns` entry. Each step is independently
  revertible.
- Immediate pre-publication work is the removal/disable step per family;
  original replacement artwork (Option 3) is optional later enhancement.
- **The final per-family choice — and whether to treat both crest families
  uniformly or split them — is left explicit to the operator; this memo
  does not select one.**

**Unresolved operator inputs (not resolved by assumption).**

- **Monetization posture (E2C3 U10)** — still unanswered: whether the site
  has or plans any monetization beyond passive banner ads. E2A decision 4
  covers third-party reuse of *this site's* content, not the site's own
  monetization state; no monetization audit has been performed.
- Uniform vs. split posture across the two crest families.
- Option 2 vs. Option 3 timing for the X-Factor family.
- Whether to remove the `docs/branding/icons/x-factors/` duplicate
  independently/immediately or bundle it with the X-Factor relocation work
  — and which documentation choice to make for its 56 inline references
  first (repoint, retain, replace, or intentionally remove).
- Disposition of `scripts/scrape_ea_xfactor_pngs.sh` (delete, archive, or
  leave as historical record).

**Still unchanged.** All three E2C3 legal classifications stand exactly as
recorded (X-Factor PNGs: `NOT ADDRESSED / AMBIGUOUS`; base crests:
`CONDITIONALLY SUPPORTED AT BEST, on unverified premises`; custom crests:
`CONDITIONAL / FACTUAL NATURE UNRESOLVED`) — **no family is legally
cleared.** The Sony, Microsoft, SVG Repo, Twemoji, and font families from
E2C2 remain untouched and unresolved. Disabling Cloudflare Web Analytics
(E2B3 decision 1) remains separate and undone. Attribution finalization
remains blocked under E2A decision 9. Legal review of all Gate 2 drafts is
still required.

### 🟡 E2C5 FINAL ASSET-RETENTION OPERATOR DECISIONS RECORDED — all assets kept exactly as-is; this is retention, not legal clearance (2026-09-09)

The operator reviewed E2C4's options/recommendation memo and made the
following final decisions, closing the "unresolved operator inputs" left
open by E2C4. **This entry documents those decisions only. No asset, code,
test, configuration, dependency, or provider setting changed. No database,
host, Cloudflare, Proton, or GitHub account accessed. No legal draft
written, no Gate 2 checkbox checked, no E2C3 legal classification altered.**

1. **No monetization currently or planned for launch.** This resolves the
   E2C3/E2C4 "Monetization posture (U10)" open question.
2. **All existing assets remain exactly unchanged.**
3. This includes every EA asset, X-Factor copy/use, opponent crest, platform
   mark, SVG Repo-derived asset, Twemoji-style flag, font, BGM/SPD asset,
   rink, and event marker.
4. **Do not** remove, replace, relocate, deduplicate, recolour, regenerate,
   rename, hide, or switch any asset to a fallback.
5. **Keep** the X-Factor documentation duplicate
   (`docs/branding/icons/x-factors/`) and all 56 references to it in
   `research/OCR-SS/apx.md` and `research/OCR-SS/Manual OCR benchmark match
   463.md`.
6. **Keep** `scripts/scrape_ea_xfactor_pngs.sh` unchanged. Retaining it is
   **not** authorization to execute it.
7. **The operator will personally handle the legal implications** of this
   retention decision.

This settles E2C4's per-family options in favor of uniform retention across
both crest families and the X-Factor family — none of E2C4's
removal/replacement/fallback options (2 or 3) are being taken at this time.

**Preserved limits — read before acting on this entry.**

- **This is a retention decision, not legal clearance.** No asset is
  legally cleared by this entry.
- E2C3's legal classifications remain unchanged exactly as recorded
  (X-Factor PNGs: `NOT ADDRESSED / AMBIGUOUS`; base crests: `CONDITIONALLY
  SUPPORTED AT BEST, on unverified premises`; custom crests: `CONDITIONAL /
  FACTUAL NATURE UNRESOLVED`).
- Do not infer permission, licence, fair use, endorsement, or sufficient
  attribution for any retained asset from this decision.
- Further research may continue only as needed to produce accurate legal
  wording — not to reopen this asset-retention decision.
- Legal review of all Gate 2 drafts remains required.
- Disabling Cloudflare Web Analytics (E2B3 decision 1) still must happen
  and be verified off before publication — unchanged and still undone.
- **E2 remains IN PROGRESS.** No Gate 2 checkbox is checked by this entry.
- Tunnel reopening remains separately unauthorized.

### 🟡 E2D DATA COLLECTION POLICY INITIAL DRAFT WRITTEN — not reviewed, not published, no Gate 2 checkbox checked (2026-09-09)

Narrowly-scoped drafting session. Produced
`docs/planning/data-collection-policy-draft.md`: a publication-oriented Data
Collection Policy draft plus a clearly separated internal
drafting/publication-checks section. **No code, asset, test, configuration,
dependency, or provider setting was changed. No external system (Cloudflare,
Proton, GitHub, host, database) was accessed. Nothing was staged, committed,
pushed, or published as a live route.** The draft was built from AGENTS.md,
this file, `docs/planning/ea-content-usage-policy-research.md`, and
`docs/planning/ea-asset-decision-memo.md` — design prototypes were treated as
visual references only, and no legal wording was copied from them.

**What the draft covers:** scope/launch posture (no active public account
system at launch — dormant authentication capability disabled, not "no
account system"; no on-site submission feature, with project email
remaining an off-site voluntary submission channel; no monetization, no
advertising, intended no-analytics posture); the information categories
maintained (gamertags/history, player-profile alias framing —
operator-attested, member-approved display names/aliases, not verified
legal names, alongside acknowledgment that incidental personal information
may still appear elsewhere in retained evidence we have not exhaustively
inspected, roster, match/stat data, derived metrics, opponent data, raw EA
payloads, OCR evidence/provenance, source recordings/screenshots/frames,
team-member-authorized party voice chat, access/security logging framed as
conditional — records the site/hosting stack/providers may generate, not a
definite claim, against verified repository facts only, email
correspondence, private-repo fixtures); sources; purposes (including
development/testing/validation of the site and its OCR pipeline using
authentic fixtures, and explicitly excluding traffic measurement as an
approved launch purpose); public display/indexing (Gate 3 implementation
not yet done); cookies/
browser storage/analytics; dormant authentication and schema capability vs.
current contents; service providers (Cloudflare, Proton, GitHub, EA,
Alberta infrastructure) without inventing a processor/controller
classification; retention (including the approved tiered email schedule and
the unautomated 30-day log target); requests/corrections; children/
opponents; cross-border handling; and security/changes.

**Publication blockers preserved inside the draft's internal section, not
hidden:**

- Cloudflare Web Analytics is still enabled (per the E2B2/E2B3 entries
  above) and must be dashboard-verified off before this policy is published
  or before section 6 can claim "no analytics" as current fact.
- Both `Effective date` and `Last updated` are placeholders pending the
  actual Gate 3 publication date.
- Hosting/cutover facts must be reverified against whatever is actually
  serving traffic at publication time (per E1I, cutover has not happened as
  of this draft).
- Actual cookie behavior on the deployed site has not been audited; the
  draft relies on a source grep plus Cloudflare's own published Web
  Analytics description only.
- Section 9's backup language must be reconciled with whatever E3 has
  actually implemented by publication time (currently: producer/acceptor
  verified only in isolation, nothing active on a real host).
- Independent factual/legal review of the entire draft has not happened and
  is required before publication.

**Asset boundary respected.** E2C5's retain-everything-as-is decision is not
reopened; the draft's section 3 gives only a short pointer to a separate
attribution/non-affiliation notice and does not restate or alter any E2C3/
E2C4/E2C5 asset classification.

**What this does not do.** It does not check the Gate 2 "Data Collection
Policy" checkbox — this is an initial draft still requiring independent
review. It does not draft the Privacy Policy, Terms of Use, or attribution/
non-affiliation notice. It does not disable Cloudflare Web Analytics, reopen
the tunnel, or touch any live route/footer. **E2 remains IN PROGRESS.**

### 🟡 E2D2 DATA COLLECTION POLICY INDEPENDENT REVIEW RECORDED — draft NOT accepted; applicable law UNRESOLVED; 3 blockers, 12 operator questions (2026-09-09; corrected E2D2A 2026-09-09)

Read-only review session against `docs/planning/data-collection-policy-draft.md`
(E2D). Produced `docs/planning/data-collection-policy-review.md`. **No code,
asset, test, configuration, script, or dependency changed. No Cloudflare,
Proton, GitHub, host, or database account accessed. The policy draft is
byte-for-byte unchanged. Nothing staged, committed, pushed, published, or
deployed. No Gate 2 checkbox changed.** Only `HANDOFF.md` and the review file
were touched.

**Corrected at E2D2A (same day).** The first version of the review overstated
several legal conclusions. A correction pass rewrote the review and this entry.
The most important structural fix: the first version treated operational duties
as duties to publish particular wording on the public policy page. Corrected
counts and reasoning are below; §12 of the review lists every change. **The
correction did not weaken any obligation** — items moved from "the policy page
must say this" to "the response template / internal procedure / collection
notice must carry this", which is a harder target to forget, not an easier one.
The draft remains **not accepted and not publishable**, for accurately stated
reasons.

**This is AI-assisted issue-spotting, not legal advice.** It does **not**
satisfy the draft's own internal blocker 6 ("Legal review of this entire draft
is required and has not happened"). That blocker stays open. The review is
itself correctable and should be treated as issue spotting to be checked.

**Verdict: the draft is factually accurate and not publishable.** Every
repository-level claim independently rechecked this session held up (no
submission routes; auth tombstone returns 404; `accounts.ts` does carry
`ip_address`/`user_agent`/token/`password` columns; zero
`localStorage`/`sessionStorage`/`document.cookie`/`indexedDB` matches in app
source; zero Cloudflare-beacon references in `apps/web`; no `robots.txt` or
sitemap; `docker-compose.yml` sets no logging/rotation key; fonts self-hosted
via `next/font/google` at `apps/web/src/app/layout.tsx:2`). **No factual error
was found in any of the 13 public sections.** The defects are legal structure,
omissions, and staleness risk.

**Counts (47 findings, corrected):** 3 BLOCKER · 6 OPERATOR INPUT REQUIRED ·
22 MATERIAL CORRECTION · 8 RECOMMENDATION · 8 ACCEPTABLE AS WRITTEN. Separately,
**12 operator questions** (Q-1 to Q-12). These supersede the first version's
5 / 5 / 20 / 9 / 8 and its ten questions.

**Six categories of requirement are now kept apart** throughout the review, and
every finding is tagged with the ones it touches: public-policy wording
**[PUB]**; collection notices **[NOTICE]**; individual access/correction
responses **[RESP]**; internal policies and operational procedures **[INT]**;
counsel-dependent legal determinations **[COUNSEL]**; pre-publication factual
checks **[CHECK]**. The rule applied: a statutory duty is not treated as a duty
to publish particular wording on the public policy page unless the cited
provision expressly requires that publication.

**Highest-risk findings, as corrected.**

1. **Applicable law is UNRESOLVED and depends on unanswered legal-form facts**
   (F-01/F-02). PIPA s.4(1) applies to "every organization and in respect of all
   personal information" and is not commerce-gated; s.1(1)(i)(ii) expressly
   includes "an unincorporated association", so if that is what Boogeymen is it
   **may be fully subject** to the Act. Whether that is what it is — as opposed
   to an individual acting in a personal or domestic capacity, or a body
   qualifying under s.56 — is established nowhere. **Working assumption for
   drafting only: plan as though PIPA applies in full**, because it is the most
   demanding plausible branch. That is a planning posture, not a determination.
   Correction: s.56 is **not** limited to incorporated bodies —
   s.56(1)(b)(ii) also admits an organization "that meets the criteria
   established under the regulations". The accurate narrow point is that
   **qualifying s.56 status may narrow PIPA's application to non-commercial
   handling**; no claim is made about overall burden and no legal form is
   recommended. E2C5 decision 1 (no monetization) is relevant to PIPEDA and to
   PIPA s.56(3), not as a universal exemption.
2. **Opponent-player data: the lawful basis is undecided and remains a serious
   unresolved Gate 2 issue** (F-07/F-08). The draft correctly never asserts the
   "publicly available" exception. **Reliance on that exception is not presently
   established, and it is equally not established that it can never apply** —
   determining that requires a field-by-field, source-specific legal assessment
   this review did not and could not perform. PIPA Reg 366/2003 s.7 says
   personal information "does not come within" that meaning **except** in a
   closed list of **six** categories (a)–(f) — the first version of this review
   miscounted it as five, omitting (f), which covers information collected from
   outside Alberta that would have fallen within (a)–(e) if collected within it.
   The three data types must be assessed separately: **user-selected gamertags**
   (the s.7(e) "provided that information" limb is most arguable),
   **EA-assigned persona IDs** (harder), and **gameplay-generated statistics**
   (harder again). **Preserved repository finding:**
   `opponent-player-match-stats.ts:44` stores `ea_player_id`, an EA persona ID
   documented as "Stable across matches", linking every appearance by the same
   opponent (F-43, which the draft's §2 understates). Options put to the
   operator, none chosen: considered basis with counsel's assessment,
   de-identify in the public display, or club-level results only. **No future
   session should record a permanent rejection of the exception before counsel
   assesses it.**
3. **Recorded party voice chat rests on an untested assumption** (F-30,
   **UNRESOLVED**). The draft's whole justification is that a team member
   authorized the recording. `HANDOFF.md` ("LAUNCH POLICY + DOMAIN MAIL",
   2026-09-03) records that **most team members are in Massachusetts, USA.**
   Criminal Code s.184(2)(a) provides a one-party-consent route for the Canadian
   interception offence. Massachusetts G.L. c. 272 §99 B(4) is framed
   differently: it turns on a "**secretly**" limb as well as an "all parties"
   authorisation limb. **No Massachusetts conclusion and no conflicts-of-law
   conclusion is drawn.** The factual question was expanded from two limbs to
   five, and is now Q-6: (a) whose voices can be captured; (b) whether every
   participant was told before recording began; (c) whether each expressly or
   implicitly agreed; (d) whether the platform displays a recording indicator;
   (e) where each participant was located. Escalated to operator + counsel.
4. **The request section describes house practice without the statutory
   mechanics behind it** (F-17 to F-22, F-38, F-39). PIPA ss.24–32 impose real
   duties on **how a request is processed and what a response must contain** —
   the s.28(1)(a) 45-day deadline and s.28(2.1) deemed-refusal rule; the s.31
   extension route; s.32 fees (no fee for a correction; written estimate first);
   the s.25(3) duty to **annotate** a correction refused; s.24(3)(b) mandatory
   refusal where access would reveal another individual's information
   (structurally unavoidable here); s.9 withdrawal of consent; s.34.1 breach
   notice to the Commissioner. **Correction:** these bind the operator's
   responses and procedures whether or not the policy page mentions them. The
   **s.46 review right** is *indisputably required in applicable refusal and
   correction responses* (s.29(1)(c)(iii), s.29(2)(b)(ii), s.29(3)(c)) and is a
   **strong recommended public disclosure** — it is **not** established as a
   statutory requirement for the general policy page. The first version's
   "single clearest defect in the document" framing is withdrawn.
5. **PIPA s.6 — the duty is about the organization's policies, not this
   webpage** (F-24). The first version said the draft breached s.6(2); that was
   wrong, and **an unfinished public draft does not breach s.6(2)**. Preserved:
   if s.6(2) applies, the organization's **policies and practices** must include
   the countries outside Canada where handling "is occurring **or may occur**"
   and each service provider's authorized purposes; and **s.6(3)** requires
   written information about those policies and practices to be **available on
   request**. Neither requires the complete country list to be published on this
   page — though publishing it may well be the simplest way to implement both
   the transparency and the s.6(3) availability duty in one place, and is
   recommended. Provider **service-provider status is a factual and legal
   classification, not an arbitrary operator label**; Q-4 now collects contract
   and service facts so counsel can characterise them.
6. **Accountability: the required duty is internal** (F-05). Preserved: PIPA
   s.5(3) requires an internally designated responsible individual, and
   collection notices (s.13(1)(b)) and outside-Canada notices (s.13.1(3)(b)) may
   use "the name **or position name or title**". **Correction:** s.29 and the
   breach regulations (Reg s.19(h), s.19.1) were wrongly cited as proof that a
   role title must appear in the general policy — s.19 governs the contents of a
   report **to the Commissioner** and s.19.1 a notification **to affected
   individuals**; s.29 governs particular responses. "Privacy Contact for
   Boogeymen" remains a sensible proposed public role, without the claim that it
   automatically resolves every context. F-05 is downgraded from BLOCKER to
   MATERIAL CORRECTION and off the publication-blocker list; the s.5(3)
   designation moves to the internal-requirements list. E2A decision 1 is not
   reopened. Note also Reg s.8: designating a request office is **optional**, and
   only choosing to do so triggers the duty to make its address public.
7. **Logs — reclassified to a factual question** (F-14). The assertions that
   publishing a manual 30-day target is worse than publishing nothing, and that
   the operator cannot keep it because Docker automation is absent, are both
   **removed as unestablished**. The absence of automated rotation does not show
   that a manual practice does not happen. Now **OPERATOR INPUT REQUIRED** via
   Q-12: do the logs exist, which services produce them, does manual review or
   deletion actually occur, and is "roughly 30 days" accurate? Docker log
   rotation under E4 remains **preferable future operational work**, not proof
   that the current statement is false.
8. **Retention — no new commitment imposed** (F-13). The s.35(1)
   purpose-bounded framing concern is preserved: the draft frames retention as
   unbounded-by-default with manual exceptions, which is the wrong way round
   relative to the statute. **Correction:** the first version silently inserted
   an annual review of the main archive into its suggested public wording. That
   would be a new operational commitment, so it is removed from the wording and
   put to the operator as **Q-11** (answering "no" is valid and reopens
   nothing). **The approved retention decision is not reopened**, and E2B3's
   approved annual cadence for the *email* tier is not extended to the archive
   by implication.

**Publication blockers: now 11** (was 13). The draft's own six stand unchanged
(analytics disabled and dashboard-verified; placeholder dates; hosting/cutover
reverified; live-site cookie audit; §9 backup reconciliation; legal review).
Five added: applicability determination recorded (F-01); opponent-data basis
decided (F-07/F-08); recording-law fact pattern gathered and answered or
knowingly accepted (F-30); the §9 log statement factually checked (F-14/Q-12);
and all internal-status narration removed plus the §6 analytics variant swap
executed (F-42/F-34). **Three items were reclassified off this list** because
the provisions cited do not require this webpage to carry them — the
privacy-contact role title (F-05), the Commissioner review right (F-18), and the
s.6(2) outside-Canada information (F-24). All three remain genuine obligations
elsewhere, and two of the three remain strong public recommendations. Also
flagged: **there is no publishable version of this policy in which Cloudflare
Web Analytics is still enabled** — §1 and §6 contradict each other by design,
and that resolves in only one direction.

**Internal compliance requirements (12) are now listed separately** in §8 of the
review — obligations that do not gate the public page and would survive a
decision never to publish it: the s.5(3) designation; the s.6(1)–(2)
policies-and-practices document with the country list and authorized purposes,
available on request under s.6(3); the s.29 response template carrying the s.46
review notice; the s.25(3) annotation step; s.32 fee handling; the
s.24(3)/(4)/s.27 severance approach; the s.34.1 / Reg s.19 / s.19.1 incident
procedure; verification-evidence handling; the per-category lawful-basis
mapping; s.9 withdrawal handling; s.13/s.13.1 collection notices; and the
internal notes at F-02/F-03/F-11.

**Lawful basis — corrected wording** (F-07). The claim that the draft "states no
lawful basis for anything it does" is withdrawn as a blanket assertion. The
accurate defect: the draft **does not explicitly map consent provisions,
exceptions, or reasonable-purposes analysis to each category**. The categories
sit in materially different positions and are now treated separately —
**members** (s.8(1)/s.8(2) plausible; E2A decision 14's operator attestation is
evidence of awareness but no consent record is described), **voluntary email
correspondents** (s.8(2) deemed consent, the strongest-positioned category),
**recordings** (F-09/F-30), and **opponents** (F-08, the weakest). **No consent
is inferred that has not been documented.** Recommended concrete step within the
operator's control: collect a short written consent from every current member
before publication.

**Twelve operator questions (Q-1 to Q-12)**, rewritten to ask **facts and
operator choices only** — none asks the operator to reach a legal conclusion.
Q-1 now asks for the underlying organisational facts (bylaws, membership,
officers, treasury, any filed incorporation/registration) instead of the
entity's legal characterisation. **Q-9 no longer asks where the operator
considers collection to legally occur** — that is a characterisation for counsel
— and instead asks for physical locations and data flows. Q-4 collects provider
contract and service facts before any legal characterisation. Q-6 is the
five-part recording fact pattern. **Q-11 (archive review cadence)** and **Q-12
(log facts)** are new. Q-5 would revisit E2A decision 7 — **flagged, not
reopened**. Q-10 — no existing operator decision covers opponent-player
publication, so nothing is being reopened.

**Confirmed correct and to be preserved verbatim across future edits** (F-12,
F-16, F-23, F-28, F-35, F-36, F-37, F-47): §10's "prior EA publication is not
by itself a reason to refuse a request" line (it declines to treat prior EA
visibility as self-evidently decisive **without prejudging the exception either
way**, which is the right posture while F-08 is open); the cookie-free claim
attributed to Cloudflare rather than adopted; the verified font statement; the
Proton/GitHub facts matching E2B2/E1H/E1G including the deliberate non-naming of
`alerts@`; §11's refusal to invent an age threshold (consistent with the Alberta
capacity-based approach recorded in the OPC/OIPC-AB/OIPC-BC joint guidance);
§9's tiered email schedule including its already-approved annual cadence; §10's
no-government-ID-by-default posture; §7's dormant-authentication disclosure; and
the internal-checks section as a practice to replicate in the three remaining
legal drafts.

**Official sources used** (11, all primary/government, accessed 2026-09-09,
recorded with currency dates in §2 of the review): Alberta PIPA (King's Printer,
current as of 2025-09-01); PIPA Regulation 366/2003 (consolidated up to
147/2026); PIPEDA and the Alberta Exemption Order SOR/2004-219 and SOR/2001-7
(Justice Laws, current to 2026-06-21); Criminal Code ss.184 and 193; the
OPC/OIPC-AB/OIPC-BC joint meaningful-consent guidance; OIPC Alberta's *Minor
Sports Associations* guidance; Alberta.ca's non-profit PIPA page; and — added at
E2D2A — **Massachusetts G.L. c. 272 §99 (malegislature.gov)**, cited only to
identify the statute and the facts that would matter under it. No law-firm
article, blog, commercial summary, forum, or search/AI summary was relied on. No
provision was read against case law.

**Structural recommendation (F-44):** decide whether the Privacy Policy and Data
Collection Policy are one document or two **before** drafting the privacy
policy. Four overlapping legal documents maintained by one operator is a
divergence trap given how many "reverify before publication" items already
exist. Record the F-41 four-bucket split (publish / collection notice / response
template / internal) at the same time so the remaining drafts inherit it.

**Asset boundary respected.** E2C5's retain-everything-as-is decision is not
reopened, and no E2C3/E2C4/E2C5 classification is restated or altered. The
review's only asset-adjacent note is that §3's non-affiliation paragraph is
misplaced and should stay a pointer to the separate attribution notice.

**Next session:** Phase A of the review's §10 correction plan — gather the
factual answers (Q-1, Q-2, Q-9, Q-12), put Q-1/Q-2/Q-9 and the Q-4/Q-6 fact
patterns to counsel, and record the operator choices (Q-3, Q-5, Q-7, Q-8, Q-10,
Q-11) as a decisions entry. Do not begin public text corrections until the
applicability determination and the opponent-data approach are settled; the
wording depends on both. Note that **Phase C (internal procedures) does not
depend on the public page** and can proceed in parallel. **E2 remains IN
PROGRESS.** Cloudflare Web Analytics remains enabled. Tunnel reopening remains
separately unauthorized.

### 🟡 E2D3 OPERATOR DECISIONS RECORDED — E2D2's operator questions substantially answered; applicable law and provider classification still UNRESOLVED; log-retention target superseded (2026-09-09)

The operator reviewed the corrected E2D2 review and recorded the fourteen
facts/decisions below. **This is a decision-recording entry only. It drafts
no legal language, revises neither `docs/planning/data-collection-policy-draft.md`
nor `docs/planning/data-collection-policy-review.md` (both remain byte-for-byte
unchanged), checks no Gate 2 checkbox, and changes no code, configuration,
asset, analytics setting, or tunnel state. No external Cloudflare, Proton,
GitHub, host, or database account was accessed.**

1. **Project operation and legal form.** The website/project is individually
   operated — recorded as an operator factual characterization only. This
   does **not** establish whether Boogeymen has or lacks bylaws, incorporation
   filings, officers, a treasury, or any other organizational feature (Q-1
   asked for these; none is answered here). It does **not** establish that the
   project qualifies for any PIPA personal/domestic exclusion, and does
   **not** establish that PIPA applies or does not apply. Applicable-law
   characterization (F-01/F-02) remains **UNRESOLVED**. Per E2D2, conservative
   drafting continues to assume the most demanding plausible privacy
   obligations until the question is legally resolved.
2. **Commercial activity (Q-2).** No monetization or other commercial
   activity exists now or is planned — no merchandise, sponsorship, paid
   access, third-party advertising, dataset licensing, or sale/barter of any
   member or contact list. This is operator intent, not a universal exemption
   from PIPEDA or PIPA s.56(3) (E2D2 finding 1). Any future commercial
   activity triggers a fresh privacy review.
3. **Public privacy contact (Q-3).** Approved public wording: "Privacy
   Contact for Boogeymen", `webmaster@boogeymen.app`. The operator remains
   the internally designated person responsible for privacy handling (PIPA
   s.5(3); E2A decision 1 not reopened). No operator legal name, mailing
   address, or formal legal-entity name is published or invented by this
   entry. No PIPA Reg s.8 request office is designated by this decision.
4. **Providers (Q-4, partial).** Cloudflare, Proton, and GitHub are used
   specifically to support this project — that is the only fact supplied.
   No facts were given about data-processing agreements, account-plan
   contractual terms beyond what E2B2 already recorded, each provider's
   independent processing purposes, or processor/controller/service-provider
   classification. Those classifications remain **unresolved**; this entry
   does not turn the operator's usage-purpose answer into a legal
   characterization.
5. **Member approval.** Current members verbally agreed to publication/use of
   their gamertags, profiles, and statistics. This is operator-attested; no
   written consent record was identified. It is **not** legal clearance and
   is **not** a conclusion about the legal sufficiency or scope of that
   consent (see E2D2's "Lawful basis — corrected wording").
6. **Recordings and incidental voice audio (Q-6).** Operator facts: voice
   audio is captured incidentally as a by-product of recording gameplay and
   is not currently used for a separate purpose; participants know gameplay
   sessions may be recorded and are verbally okay with it; no visible
   platform recording indicator is present; participants may be located in
   Alberta, Ontario, and Massachusetts. As before (E2A decision 7), this does
   **not** claim code or repository inspection proves the contents of any
   individual recording. It does **not** claim every possible future
   participant has consented, does **not** claim opponents or unrelated
   third parties are necessarily absent, does **not** claim compliance with
   Canadian, Ontario, or Massachusetts recording law, and draws **no**
   conflicts-of-law conclusion. If an opponent, guest, or other new
   participant joins recorded voice chat, their awareness or agreement must
   not be assumed.
7. **Recording retention (Q-5).** Recordings and incidental audio are
   retained under the existing approved retention posture (E1G / E2A
   decision 7) — knowingly retained as-is. Audio is **not** stripped, no
   audio-specific expiry is added, and no existing files are altered. This is
   an operator retention decision, not legal clearance; the applicable
   recording/privacy questions in item 6 remain unresolved.
8. **Opponent-player display (Q-10).** Opponent-player gamertags and
   individual statistics remain publicly displayed as currently implemented.
   They are **not** de-identified or pseudonymized, publication is **not**
   reduced to club-level results, and no code or data is changed. This does
   **not** establish that a legal basis has been established, and does
   **not** claim the PIPA Reg 366/2003 s.7 "publicly available" exception
   either applies or cannot apply (E2D2 finding 2, F-07/F-08 remain
   **UNRESOLVED**). This is a product/display decision; its legal basis
   remains open, and any future legal review may require revisiting the
   policy or implementation.
9. **Request fees (Q-7).** No fee will be charged for access or correction
   requests. This does not waive or replace any other verification,
   severance, or response procedure already recorded (PIPA s.24(3)/(4),
   s.27, s.32(2)).
10. **Document structure (Q-8).** The Privacy Policy and Data Collection
    Policy remain **two separate** Gate 2 drafts — HANDOFF's Gate 2 and
    Gate 3 checklists explicitly require both. Boundary recorded: **Privacy
    Policy** is a concise public overview (visitor privacy, providers,
    cross-border handling, safeguards, privacy contact, rights/complaints,
    changes); **Data Collection Policy** is the detailed inventory
    (information categories, sources, purposes, public display, retention,
    request handling). Each document should link to the other; detailed
    category inventories, retention schedules, and provider facts should
    have one authoritative home rather than being duplicated inconsistently
    (E2D2 finding F-44). This records structure only — the Privacy Policy is
    not drafted and the Data Collection Policy is not refactored by this
    entry.
11. **Main-archive review cadence (Q-11).** The operator does not adopt an
    annual or other periodic review commitment for the main historical
    archive. The approved retention posture is preserved unchanged (E2A
    decision 7 / E2C5). No periodic-review promise may be inserted into
    future public wording without a new operator decision. This does not
    establish that indefinite retention is legally compliant.
12. **Log retention — superseding decision (Q-12).** This explicitly
    **SUPERSEDES the earlier approximate 30-day log target** recorded at the
    "LAUNCH POLICY + DOMAIN MAIL" (2026-09-03) and "E1G PRIVACY/RETENTION
    POLICY" (2026-09-07) Active State entries and reflected in §9/§13 of the
    current draft. **Both of those earlier entries stay byte-for-byte
    unchanged** — this entry supersedes their log-retention statement
    going forward without rewriting the historical record. New operator
    policy, verbatim:

    > Logs under our control do not currently have a fixed automatic
    > deletion period. We retain them only for as long as reasonably needed
    > to operate, secure, troubleshoot, or protect the website, or to meet
    > applicable legal obligations. We delete them when they are no longer
    > reasonably needed for those purposes.

    Recorded separately:

    > Logs controlled independently by service providers are subject to
    > those providers' practices and retention periods.

    This is **purpose-based retention, not a 30-day schedule**. It does
    **not** claim automated deletion exists, does **not** establish which
    logs currently exist, and does **not** claim any logs have already been
    deleted. **No log deletion is authorized or performed by this session.**
    A later read-only inventory is still needed to identify actual Docker,
    web, worker, database, tunnel, and provider-controlled logging. **Docker
    logging configuration is not altered by this session.**
13. **Physical/data-flow facts (Q-9, partial).** Recorded facts only,
    nothing beyond what HANDOFF and this operator response already
    establish: the operator/project is based in Alberta; current recording
    participants may be in Alberta, Ontario, and Massachusetts (item 6); the
    current/target server, database, OCR workstation, and backup facts
    remain exactly as previously recorded (see the "E1I HOSTING COST +
    SYSTEM TERMINATION MAP DOCUMENTED" and "E1A HOSTING + BACKUP POLICY
    DECIDED" Active State entries); backups remain **inactive** — no
    production backup-pipeline activation has been recorded by any later
    entry; site traffic and email use the already-recorded Cloudflare and
    Proton paths (E2B2). This entry does **not** determine where collection
    legally "occurs" — Q-9 explicitly reserves that characterization for
    counsel.
14. **Counsel/legal review posture.** The operator does not consider the
    project serious enough to retain counsel at this stage. Recorded as:
    counsel review is **DEFERRED, not completed**; nothing in this entry is
    legal clearance; no unresolved privacy or recording-law question from
    E2D2 (blocker 6, F-01/F-02, F-07/F-08, F-30, the Massachusetts question)
    is waived by that deferral. Conservative drafting may continue. **The
    existing legal-review publication blocker (E2D2 blocker 6, "Legal review
    of this entire draft is required and has not happened") remains open**
    unless the operator later explicitly changes it. "Legal review complete"
    is **not** recorded by this entry.

**What this does and does not change.** This entry substantially addresses
Q-2, Q-3, Q-5, Q-6, Q-7, Q-8, Q-9 (partial), Q-10, Q-11, and Q-12 of E2D2's
twelve operator questions, and records the item-1 organizational fact
relevant to Q-1. **Q-1's full applicability/legal-form determination and
Q-4's provider contract/DPA/classification detail remain UNRESOLVED** and are
for counsel, not this entry. No Gate 2 checkbox is checked — the Data
Collection Policy draft checkbox in the "Privacy, data collection, and legal
drafts" checklist above stays `[ ]`; no other checkbox is changed. E2C5's
asset-retention decisions are not reopened and no E2C3/E2C4/E2C5
classification is restated or altered. Cloudflare Web Analytics remains
enabled. Tunnel reopening remains separately unauthorized. **E2 remains IN
PROGRESS** — none of the four Gate 2 legal drafts is complete or reviewed by
counsel, and `data-collection-policy-draft.md` itself is not yet revised to
reflect these decisions.

**Next session:** apply these fourteen decisions — most consequentially the
item-12 log-retention supersession and the item-10 document-structure
boundary — in a revision pass on `docs/planning/data-collection-policy-draft.md`,
then route the still-open Q-1 and Q-4 facts plus the E2D2 counsel-dependent
findings (F-01/F-02, F-07/F-08, F-30) to counsel per item 14. Do not begin
that revision pass in the same session as further decision-recording.

### 🟡 E2D4 DATA COLLECTION POLICY REVISED AGAINST E2D2A/E2D3 — draft text updated; applicability, provider-classification, opponent-data, and recording-law issues remain UNRESOLVED; no Gate 2 checkbox changed (2026-09-09)

Narrowly-scoped drafting session. Revised
`docs/planning/data-collection-policy-draft.md` in place, applying the
corrected E2D2A independent review and the fourteen E2D3 operator decisions
to the draft's text. **This is a text-only revision of the Data Collection
Policy draft.** It does not draft the Privacy Policy, Terms of Use, or
attribution notice; does not constitute independent factual/legal review;
changes no code, asset, test, configuration, dependency, or provider
setting; accesses no external system; and stages, commits, pushes, or
publishes nothing. `docs/planning/data-collection-policy-review.md` is
byte-for-byte unchanged.

**Public sections changed:** preamble (effective-date placeholder reworded
to drop "Gate 3" language); §1 Scope and launch posture (added an
individually-operated statement that draws no legal-form conclusion;
broadened the monetization statement from "at launch" to "no monetization
or other commercial activity exists … and none is planned," with a
fresh-privacy-review trigger if that changes); §2 Information we collect
(added a "Member agreement to publication" bullet recording current
members' verbal agreement — explicitly not written consent or legal
clearance; added the EA-assigned stable persona-identifier disclosure to
the opponent-data bullet; rewrote the party-voice-chat bullet to state the
audio is an incidental by-product, is not analyzed/used separately/
displayed, and that current participants know sessions may be recorded and
have verbally agreed, without claiming a recording indicator exists, that
every future participant has agreed, or that opponents/third parties can
never be present; simplified the logs bullet to cross-reference retention
rather than state a target); §5 Public display and indexing (removed
"Gate 3" narration in favor of a plain user-facing statement); §9 How long
we keep information (reframed main-archive retention as purpose-based per
E2D2A F-13, with an explicit "not a statement that indefinite retention has
been legally reviewed or approved" disclaimer and no periodic-review
promise per E2D3 item 11; **replaced the ~30-day log-retention target with
the E2D3 item 12 purpose-based policy, substantially verbatim**, plus a
separate sentence on provider-controlled logs); §10 Requests and
corrections (added the "Privacy Contact for Boogeymen" role label; added a
firm no-fee statement for access and correction requests per E2D3 item 9;
distinguished access / correction / withdrawal / removal as different
request types; added mixed-record/severance handling and a conditional
correction-annotation commitment; clarified verification-evidence handling
— used only to verify/handle the request, not added to the published
record, no immediate-deletion promise, retained under the existing
privacy/correction-correspondence tier; added a plain-language pointer to
the Alberta OIPC review route, explicitly framed as the applicable route
rather than proof of statutory coverage); §13 (retitled "Accuracy,
security, incidents, and changes to this policy"; added concise accuracy
and incident-reporting commitments per E2D2A F-40/F-38 without detailing
internal procedure; added the Privacy Contact label to the contact block).

**Exact log-retention replacement (E2D3 item 12, substantially verbatim):**
"Logs under our control do not currently have a fixed automatic deletion
period. We retain them only for as long as reasonably needed to operate,
secure, troubleshoot, or protect the website, or to meet applicable legal
obligations. We delete them when they are no longer reasonably needed for
those purposes." Recorded separately: "Logs controlled independently by
service providers are subject to those providers' practices and retention
periods." No automated deletion is claimed, no claim is made about which
logs currently exist, and no log deletion or Docker/logging configuration
change occurred in this session. The internal section's publication-blocker
list was expanded to require a read-only logging inventory (Docker, web,
worker, database, tunnel, provider-controlled) before publication, per
E2D3 item 12 / review Q-12 — this supersedes proving a 30-day schedule.

**Internal section also updated** (still not part of the public policy;
must not ship): added a revision-provenance note citing E2D2A and E2D3;
expanded the publication-blocker list from 6 to 13, folding in the review's
five additional blockers (applicability, opponent-data, recording-law, the
logging inventory, and the internal-narration/analytics-variant swap) plus
two new items for provider-classification and the outside-Canada country
list; updated the "current-vs-target discrepancies" and "factual
uncertainties" lists to match the new log wording and to flag provider
service-provider classification as unresolved; updated the "Gate 2 status"
note to describe this session as a drafting pass, not review.

**Unresolved matters retained, none closed by this session:**

- **Applicable-law characterization (E2D2A F-01/F-02; E2D3 item 1)** —
  UNRESOLVED. Conservative drafting continues to assume the most demanding
  plausible obligations.
- **Opponent-player collection/publication/retention basis (E2D2A F-07/
  F-08; E2D3 item 8)** — UNRESOLVED. The "publicly available" exception is
  neither relied on nor rejected; §2's new persona-identifier disclosure
  makes the existing data flow more visible, it does not change it.
- **Recording law across jurisdictions (E2D2A F-30; E2D3 item 6)** —
  UNRESOLVED. E2D3's recorded facts are reflected in §2's rewritten
  bullet; no Massachusetts or conflicts-of-law conclusion is drawn, and
  none is claimed.
- **Provider processor/controller/service-provider classification and the
  outside-Canada country list (E2D2A F-24; E2D3 item 4, Q-4)** —
  UNRESOLVED. No classification or country list was invented.
- **Independent legal/counsel review** — still DEFERRED, not completed
  (E2D3 item 14). Nothing in this session is legal advice or legal review.

**What this does not do.** The **Privacy Policy remains a separate,
unwritten draft** (E2D3 item 10 boundary preserved — this document stays
the detailed source for categories, sources, purposes, public display,
accounts/schema capability, operational/provider data flows, retention,
and request handling). No legal review occurred. **No Gate 2 checkbox was
changed** — the Data Collection Policy checkbox stays `[ ]`. Nothing was
staged, committed, pushed, published, or deployed. Cloudflare Web
Analytics remains enabled. Tunnel reopening remains separately
unauthorized. **E2 remains IN PROGRESS.**

**Next session:** either route the outstanding Q-1/Q-4/Q-6 fact patterns
and E2D2A counsel-dependent findings to counsel, or perform the read-only
logging inventory now required by publication blocker 10 — do not combine
that fact-gathering with further public-text drafting in the same session.

### 🟡 E2D5 DATA COLLECTION POLICY VERIFIED AND POLISHED — narrow drafting-quality pass on E2D4's text; applicability, provider-classification, opponent-data, and recording-law issues remain UNRESOLVED; no Gate 2 checkbox changed (2026-09-09)

Narrowly-scoped Session 3 verification/polish pass over
`docs/planning/data-collection-policy-draft.md` as revised at E2D4. Read the
full draft, the full review (`docs/planning/data-collection-policy-review.md`),
and the E2D/E2D2A/E2D3/E2D4 entries above before editing. **This session
performed no logging inventory, no new legal or provider research, and no
access to Cloudflare, Proton, GitHub, hosts, or the database; changed no
code, configuration, asset, test, or dependency; changed no provider
setting; did not reopen the asset-retention decision; checked no Gate 2
checkbox; and staged, committed, pushed, published, deployed, or reopened
nothing.** `docs/planning/data-collection-policy-review.md` is byte-for-byte
unchanged.

**Corrections applied (all narrow, text-only, no substance reopened):**

1. **Header/status block.** Retitled to the stage-neutral "Data Collection
   Policy — DRAFT" (dropped the "(E2D)" session-stage suffix) and reworded
   the status line from "initial draft" to "revised working draft.
   Unpublished. Not legally reviewed," with an explicit sentence that the
   E2D2/E2D2A AI-assisted review is issue-spotting, not legal advice or
   legal sign-off — the prior wording risked reading as though that review
   satisfied the "independent … review has signed off" condition.
2. **Removed both public-section pointers to the internal drafting notes.**
   §1's legal-form sentence and §10's OIPC paragraph each ended with "see
   the internal notes at the end of this document"; both now end as
   self-contained sentences. The internal section itself is untouched and
   still records the same open questions.
3. **Replaced §10's "Removal is not a right our records automatically owe
   you"** with neutral plain language: removal/de-identification is
   considered case-by-case; governed by applicable law and the legitimate
   need to keep an accurate archival record; the policy does not promise
   removal in every case and does not rule out that applicable law may
   require it. The adjacent "prior EA publication is not, by itself, a
   reason to refuse a request" sentence (E2D2A F-12, confirmed-correct,
   preserved verbatim) is unchanged.
4. **Cleaned up §5.** Restated the approved public indexing policy plainly
   (canonical pages indexable; query-variant/diagnostic surfaces excluded)
   and removed the public enumeration of unfinished implementation work
   (`robots.txt`, sitemap, per-page metadata) per review finding F-42, which
   named exactly this pattern as internal-status narration that shouldn't
   ship. The missing implementation work is now recorded only in the
   internal section's "Current-vs-target discrepancies" list (new
   "Indexing implementation" bullet), which is explicit that indexing
   controls are **not yet deployed** — §5 no longer claims or implies
   otherwise either way.
5. **§2's opponent-data bullet** now reads "an EA-provided stable persona
   identifier" instead of "an identifier EA assigns to each player" — the
   repository/HANDOFF evidence (E2D2A F-43: `ea_player_id`, documented
   "Stable across matches") establishes that EA provides a stable
   identifier, not how EA created or assigned it, and the review's own
   proposed wording ("an identifier EA uses for each player") did not claim
   "assigns" either.
6. **General re-read.** No other factual contradiction, stale internal
   narration, or E2D2A/E2D3-inconsistent wording was found in the public
   sections (§1–§13). No awkward wording was judged to materially affect
   clarity enough to warrant a change beyond the five items above.

**Preserved without reopening (verified unchanged):** individually
operated/no-legal-form framing; no monetization now or planned; verbal
member-approval framing; voice chat as incidental capture, current
participant awareness/agreement, no recording-indicator claim, and the
unresolved Alberta/Ontario/Massachusetts jurisdictional question; public
opponent display with its legal basis still unresolved; no request fees;
Privacy Policy and Data Collection Policy remaining two separate documents;
no periodic main-archive review commitment; the E2D3 item 12 purpose-based
log-retention wording, substantially verbatim; provider-controlled-log
uncertainty; Cloudflare Web Analytics still enabled versus the
pre-publication disablement requirement; backups not active; all E2C5
asset-retention decisions; and every unresolved counsel question and
publication blocker (now 13, unrenumbered and untouched) in the internal
section.

**Verification run this session:** `git diff --check` clean (no whitespace
errors); no trailing whitespace in the policy file; both public references
to "internal notes" confirmed removed; the "Removal is not a right … "
sentence confirmed removed; public §5 confirmed to no longer inventory
`robots.txt`/sitemap/metadata; the purpose-based log-retention paragraph
confirmed unchanged; the Gate 2 "Draft the data-collection policy." checkbox
(line 142 of this file) confirmed still `[ ]`; `git status --short` matched
the expected dirty set exactly, with nothing staged; HEAD and `origin/main`
both confirmed at `65bcddb43145d2fcffaeafb4d97d0e1a2737c35f` before and
after editing.

**What this does not do.** No independent factual/legal review occurred —
this was drafting-quality polish, not review. Counsel review remains
**deferred, not completed** (E2D3 item 14). None of E2D2A's four
UNRESOLVED items (applicable law F-01/F-02, opponent-data basis F-07/F-08,
recording law F-30, provider classification F-24) is resolved by this
session. The Privacy Policy remains a separate, unwritten draft. Cloudflare
Web Analytics remains enabled. Tunnel reopening remains separately
unauthorized. **E2 remains IN PROGRESS.**

**Next session recommendation:** a fresh session for the separate Privacy
Policy first draft (per E2D3 item 8's document-structure boundary), treating
this revised/polished Data Collection Policy draft as the authoritative
source for categories, sources, purposes, public display, retention, and
request handling that the Privacy Policy should cross-reference rather than
duplicate. Do not combine that drafting session with any further Data
Collection Policy edits, the outstanding logging inventory, or routing facts
to counsel.

### 🟡 E2E PRIVACY POLICY INITIAL DRAFT WRITTEN — not reviewed, not published, no Gate 2 checkbox checked (2026-09-09)

Narrowly-scoped drafting session. Produced
`docs/planning/privacy-policy-draft.md`: a concise, plain-language Privacy
Policy working draft plus a clearly separated internal drafting/publication-
checks section, matching the pattern used for the Data Collection Policy.
**No code, asset, test, configuration, dependency, or provider setting was
changed. No external system (Cloudflare, Proton, GitHub, host, database) was
accessed. Nothing was staged, committed, pushed, or published as a live
route.** The draft was built from `HANDOFF.md` (E1G, E2A–E2D5) and
`docs/planning/data-collection-policy-draft.md`/`-review.md` (especially
F-41 and F-44); `docs/planning/launch-page-design-prototypes.md` was read
only for the prototype content-boundary warning — its saved Privacy Policy
prototype (`privacy@boogeymen.gg`, its own analytics/browser-storage claims,
its own minors posture) was used for visual/layout reference only, and none
of its wording, mailbox, domain, analytics, browser-storage, or retention
claims was copied.

**Structure applied (per E2D3 item 10 / E2D2A F-41/F-44).** The Privacy
Policy is a concise overview — who operates the project, visitor privacy,
providers, cross-border handling, safeguards, privacy contact,
requests/complaints, and policy changes — that links to the Data Collection
Policy for the full category inventory, sources, purposes, public-display/
indexing rules, provider/operational-flow detail, complete retention
schedule, and complete request-handling mechanics. The complete category
inventory, the tiered email-retention schedule, and the full provider fact
set were deliberately **not** duplicated; the draft summarizes and
cross-references instead.

**What the draft covers:** draft/unpublished status with placeholder dates;
Boogeymen as an individually-operated, volunteer community gaming-club
project with no legal-form or governing-statute assertion; no monetization/
advertising now or planned; public read-only posture with no accounts,
uploads, comments, or on-site submission forms (voluntary email preserved);
a concise summary of maintained information categories pointing to the Data
Collection Policy for detail; canonical public pages intended for normal
search indexing versus unpublished private evidence; visitor/device
information (no direct browser-storage use in application source; possible
infrastructure logs stated conditionally, no specific log asserted);
analytics (Cloudflare Web Analytics accurately disclosed as **currently
enabled**, stated as conflicting with the approved no-analytics posture,
required to be disabled and dashboard-verified before publication, with the
cookie-free claim attributed to Cloudflare and no claim that analytics is
already disabled); providers (Cloudflare, Proton Mail, private GitHub
storage, EA, community-operated Alberta hosting, with no processor/
controller/service-provider classification and no invented DPA, contract,
retention period, or storage country); cross-border handling (stated
generally, no country list manufactured); retention (purpose-based summary
linking to the Data Collection Policy, preserving the E2D3 item 12 no-fixed-
period log-retention rule verbatim in substance, no 30-day promise, no
periodic-archive-review promise); requests (Privacy Contact
`webmaster@boogeymen.app`, no fees, reasonable evidence of gamertag control
with no government-ID default, case-by-case correction/de-identification/
removal, prior EA publication not automatic grounds for refusal, a
conditionally-framed OIPC pointer); a `security@boogeymen.app`-only
vulnerability-reporting line, with `alerts@boogeymen.app` never mentioned;
adult-only team membership alongside the unverifiable-opponent-minors
posture with no under-13 threshold; reasonable security, incident
notification, and on-site change-notice commitments; and a closing
cross-reference back to the Data Collection Policy. A final internal
section records the same publication blockers and UNRESOLVED items as the
Data Collection Policy (applicable law, opponent-data basis, recording law,
provider classification, the logging inventory, and counsel review), and
explicitly states it must not ship.

**What this does not do.** It does not check the Gate 2 "Privacy Policy"
checkbox — this is an initial draft still requiring independent review. It
does not draft the Terms of Use or the EA/NHL attribution/non-affiliation
notice, does not perform new legal research or the logging inventory, does
not access any external account/host/database, does not touch any live
route/footer, does not disable Cloudflare Web Analytics, and does not reopen
the tunnel. Counsel review remains deferred, not completed (E2D3 item 14).
**E2 remains IN PROGRESS.**

**Next session recommendation:** a fresh session to either (a) route the
outstanding Q-1/Q-4/Q-6 fact patterns and E2D2A counsel-dependent findings
(F-01/F-02, F-07/F-08, F-30, F-24) to counsel, or (b) perform the read-only
logging inventory required by both drafts' publication-blocker lists (E2D2A
F-14; E2D3 item 12, Q-12). Do not combine either with further public-text
drafting of the Privacy Policy, the Data Collection Policy, the Terms of
Use, or the EA/NHL attribution notice in the same session.

### 🟡 E2E2 PRIVACY POLICY INDEPENDENT REVIEW RECORDED — draft NOT accepted; 1 blocker, 7 material corrections; no Gate 2 checkbox checked (2026-09-09)

Narrowly-scoped independent factual, structural, and cross-document review of
`docs/planning/privacy-policy-draft.md` as written at E2E. Produced
`docs/planning/privacy-policy-review.md`. **The Privacy Policy draft was not
revised in this session and is byte-for-byte unchanged, as are
`docs/planning/data-collection-policy-draft.md` and
`docs/planning/data-collection-policy-review.md`.** No code, configuration,
asset, test, or dependency changed; no external Cloudflare, Proton, GitHub,
host, or database account was accessed; no provider setting changed; nothing
was staged, committed, pushed, published, deployed, or reopened. **This review
is issue-spotting, not legal advice and not counsel sign-off**; it performed no
new legal research and used the corrected E2D2A review as the existing legal
issue-spotting baseline.

**Verdict: factually sound and decision-compliant, but NOT yet acceptable as
the E2E drafting checkpoint.** Findings: **1 BLOCKER, 7 MATERIAL CORRECTIONS,
9 RECOMMENDATIONS, 15 explicit ACCEPTABLE-AS-WRITTEN confirmations.** Every
finding is labeled by owner (public policy / internal publication checklist /
Data Collection Policy / Gate 3 / counsel).

**The blocker (P-01).** The draft's five public links target the repository
path `./data-collection-policy-draft.md` — a file whose own header forbids
being linked or routed — and **no publication blocker covers link
replacement**. No public route exists for either policy (verified against
`apps/web/src/app`) and HANDOFF records no URL decision. Required: a
non-resolving, greppable placeholder (e.g.
`PLACEHOLDER-DATA-COLLECTION-POLICY-URL`), matching the file's existing
date-placeholder convention, plus a new publication blocker requiring
replacement with the final published route. **No route was invented.**

**The seven material corrections.** §6 is written in pre-publication voice and
the E2D2A F-34 analytics variant swap is absent from this document's blocker
list (the Data Collection Policy's blocker 13 has it); §8 gives the unresolved
provider *classification* as the reason no *country list* is published,
conflating a counsel question with an internal completion item and leaking
internal-work framing into public text; the Cloudflare strictly-necessary-cookie
disclosure and the no-consent-banner posture are missing from the document that
E2D3 item 10 assigns visitor privacy to; two internal statements misdescribe
the draft (blocker 8 says recordings are not mentioned, but §3 mentions them —
voice chat and recording *legality* are what is absent; and the
no-duplication claim is contradicted by measurement); §5 drops "access" from
the log-category list in the visitor-facing section; §6's cookie-free sentence
is a non sequitur that loses the point the paragraph exists to make; and
blocker 9 collapses the Data Collection Policy's separately-tracked blockers 11
and 12. **None requires a new operator decision or counsel.**

**Confirmed clean.** No contradiction with the Data Collection Policy was found
on any of the eight topics checked (categories/sources, public indexing,
analytics/browser storage, provider facts, retention/logs, request
verification/removal, minors/opponents, incident handling/change notices). The
draft does not imply PIPA/PIPEDA applicability is determined, does not imply
opponent-data or recording legality is established, claims no provider
contract/classification/retention period/storage country, does not claim Web
Analytics is disabled (it discloses it as currently enabled, matching E2B3
decision 1's mandated interim framing), never publishes `alerts@boogeymen.app`,
restores no 30-day log target (E2D3 item 12 wording preserved substantially
verbatim), copies no wording from the design prototype (no `boogeymen.gg`, no
`privacy@`, none of its analytics/browser-storage/minors claims), and treats no
asset retention as legal clearance. All "Gate 2"/"Gate 3" vocabulary is
confined to the internal section.

**Conciseness measured, not estimated.** 1,458 public words versus the Data
Collection Policy's 3,571 (41%); the category inventory, email-retention tiers,
accounts/schema capability, provider fact set, response targets, and request
mechanics are not restated. But **15 of 60 public sentences are byte-identical
to the Data Collection Policy and 12 more match at ≥0.75** — roughly 45%
duplicated or near-duplicated, against F-44(b)'s "each fact lives in exactly one
document." Two duplications cross E2D3 item 10's boundary in opposite
directions (safeguards/incident and change notices toward the Privacy Policy;
request-handling bullets and the OIPC paragraph toward the Data Collection
Policy).

**Three operator questions raised, none resolved here and none required to
accept the checkpoint:** the public route/URL for each policy (Gate 3 routing,
not legal); whether the Privacy Policy or the Data Collection Policy owns the
cookie disclosure; and which document owns each duplicated fact. **No operator
decision was manufactured.**

**Counsel-only questions unchanged** from the corrected E2D2A baseline —
applicable law (F-01/F-02, including the s.56 analysis), opponent-data basis
(F-07/F-08), recording law (F-30), provider classification (F-24/Q-4), and the
consent-banner question — plus one new drafting-strategy judgment: whether §7's
sentence announcing that no provider classification has been made should be
published at all. **None is resolved by this review.**

**What this does not do.** It checks no Gate 2 checkbox — the Privacy Policy and
Data Collection Policy checkboxes both remain `[ ]`. It performed no logging
inventory, routed nothing to counsel, drafted no Terms of Use or EA/NHL
attribution notice, reopened no E2C3/E2C4/E2C5 asset classification, and
revised no policy text. Counsel review remains **deferred, not completed**
(E2D3 item 14). Cloudflare Web Analytics remains enabled. Tunnel reopening
remains separately unauthorized. **E2 remains IN PROGRESS.**

**Next session recommendation:** a narrow Session 3 correction pass on
`docs/planning/privacy-policy-draft.md` only, applying the review's eight
required corrections (and optionally the decision-free improvements P-09, P-11,
P-12, P-16). Do not combine it with the still-required read-only logging
inventory, routing facts to counsel, any Data Collection Policy edit (the
review's P-13 reciprocal-link and P-14 duplication-ownership items), the Terms
of Use, or the EA/NHL attribution notice.

### 🟡 E2E2A PRIVACY POLICY REVIEW CORRECTED — several E2E2 overstatements fixed in place; supersedes the affected E2E2 conclusions; historical E2E2 entry above not rewritten (2026-09-09)

Narrowly-scoped correction session on `docs/planning/privacy-policy-review.md`
only. **This entry supersedes the E2E2 entry above wherever the two disagree;
the E2E2 entry itself is left byte-for-byte unrewritten**, per the convention
E2D3 item 12 established for historical entries. Neither policy draft was
touched: `docs/planning/privacy-policy-draft.md`,
`docs/planning/data-collection-policy-draft.md`, and
`docs/planning/data-collection-policy-review.md` remain byte-for-byte
unchanged. No code, configuration, asset, test, or dependency changed; no
external Cloudflare, Proton, GitHub, host, or database account was accessed;
nothing staged, committed, pushed, published, deployed, or reopened; no Gate 2
checkbox changed.

**What was overstated in E2E2, and the correction:**

1. **Legal-exposure conclusion.** E2E2's verdict claimed the draft "introduces
   no new legal exposure." An AI issue-spotting review cannot establish the
   absence of legal exposure. Corrected to: "No new unsupported legal claim
   was identified within this review's stated factual and issue-spotting
   scope."
2. **Duplication versus the approved document boundary.** E2E2 measured
   duplication against F-44(b)'s original proposal ("each fact lives in
   exactly one document"), not against E2D3 item 10 — the actual, binding
   operator decision, which sets a narrower boundary: detailed category
   inventories, retention schedules, and provider facts have one authoritative
   home; essential high-level facts (safeguards, change notices, the no-fee
   and removal posture) may appear in both documents when useful for a concise
   Privacy Policy summary. P-05(b) and P-14 are corrected to measure against
   item 10, not F-44(b): the 15 byte-identical / 12 near-match sentence count
   stands as a measurement and a maintenance-drift risk, but is no longer
   characterized as a decision violation.
3. **P-07 reclassified MATERIAL CORRECTION → RECOMMENDATION.** §6's first
   paragraph already states the point ("conflicts with our intended 'no
   analytics' launch posture") that E2E2 claimed the cookie-free sentence
   "loses." The sentence is clumsy, not substantively wrong. Required-
   correction count therefore changes from 8 to 7 items (P-01–P-06, P-08);
   P-07 moves to optional polish (§7).
4. **Q-E2E2-2 (cookies boundary) and Q-E2E2-3 (duplication homes) removed as
   operator questions.** Both resolve from existing authority without a new
   operator decision: E2D3 item 10 plus the Gate 2 checklist's requirement
   that the Data Collection Policy cover analytics/cookies fixes the cookie
   boundary (Privacy Policy carries a concise cookie summary and links to the
   Data Collection Policy; the Data Collection Policy's detailed disclosure is
   not removed — the prescribed resolution for P-04, which remains a MATERIAL
   CORRECTION). Duplication homes becomes implementation guidance for P-14:
   preserve essential high-level overlap; avoid copying full inventories,
   schedules, or provider facts; shorten verbatim duplication where it can be
   safely replaced by a summary and cross-reference; do not edit the Data
   Collection Policy in the Privacy Policy correction session. **Only
   Q-E2E2-1 (the future public route for each policy) remains an open
   operator/Gate-3 question**, unchanged from E2E2 — it does not block
   accepting the drafting checkpoint.
5. **No new standalone counsel-only question added.** E2E2 added a sixth
   counsel item (whether §7's "no classification made" sentence should be
   published). That judgment call, raised in P-10, is not added as a
   standalone counsel-only question here. The five established E2D2A-baseline
   counsel questions (applicable law, opponent-data basis, recording law,
   provider classification, consent-banner requirements) are unchanged.

**Corrected finding counts:** 1 BLOCKER, 6 MATERIAL CORRECTIONS (was 7),
10 RECOMMENDATIONS (was 9), 15 explicit acceptable-as-written confirmations,
17 numbered findings plus 15 confirmations (totals unchanged). The subsequent
Privacy Policy correction session now has **seven** required items
(P-01–P-06, P-08); P-07 is optional polish.

**Verdict unchanged in substance:** the initial Privacy Policy draft is still
**not yet accepted** as the completed E2E drafting checkpoint — P-01 and the
six material corrections remain outstanding. `docs/planning/privacy-policy-review.md`
itself now carries a visible E2E2A revision note at the top and inline
corrections throughout (§2, §3 P-05/P-07/P-14, §4.5, §5, §6, §7, §8, §9, §10).

**What this does not do.** No new legal research; no logging inventory; no
access to providers, accounts, hosts, or the database; nothing routed to
counsel; no Terms of Use or EA/NHL attribution notice drafted; no Gate 2
checkbox changed. Counsel review remains **deferred, not completed** (E2D3
item 14). Cloudflare Web Analytics remains enabled. Tunnel reopening remains
separately unauthorized. **E2 remains IN PROGRESS.**

**Next session recommendation:** the narrow Session 3 correction pass on
`docs/planning/privacy-policy-draft.md` only, applying P-01 through P-06 and
P-08 (required), and optionally P-07, P-09, P-11, P-12, and P-16 where they
improve clarity without increasing duplication — per the corrected review's
§10. Do not combine it with the still-required read-only logging inventory,
routing facts to counsel, any Data Collection Policy edit (P-13, P-14), the
Terms of Use, or the EA/NHL attribution notice.

### 🟡 E2E3 PRIVACY POLICY CORRECTED AGAINST E2E2A — required corrections and decision-free polish applied; blocker count now 13; no Gate 2 checkbox changed (2026-09-09)

Narrowly-scoped Session 3 correction pass on
`docs/planning/privacy-policy-draft.md` only, applying the E2E2A-corrected
independent review's seven required items (P-01 through P-06, P-08) and five
of the decision-free polish recommendations (P-07, P-09, P-11, P-12, P-16).
**No operator decision was reopened and no new legal or factual research was
performed.** `docs/planning/privacy-policy-review.md`,
`docs/planning/data-collection-policy-draft.md`, and
`docs/planning/data-collection-policy-review.md` remain byte-for-byte
unchanged (md5-verified against the values `privacy-policy-review.md` itself
records). No code, configuration, asset, test, or dependency changed; no
external Cloudflare, Proton, GitHub, host, or database account was accessed;
no provider setting changed; nothing staged, committed, pushed, published,
deployed, or reopened; no Gate 2 checkbox changed (the "Draft the privacy
policy" checkbox stays `[ ]`).

**Required corrections applied:**

1. **P-01.** Replaced all five public `./data-collection-policy-draft.md`
   link targets with the greppable placeholder
   `PLACEHOLDER-DATA-COLLECTION-POLICY-URL`, and added a new publication
   blocker (13) requiring every occurrence to be replaced with the final
   published Data Collection Policy route, verified before publication. No
   route was invented.
2. **P-02.** Left §6's public analytics wording untouched. Extended blocker 1
   to require, once Web Analytics is disabled and dashboard-verified off, a
   deliberate replacement of §6's interim "currently enabled / before
   publication" wording with the final no-analytics publication variant
   (E2D2A F-34), matching the Data Collection Policy's blocker 13.
3. **P-03.** Rewrote §8 to state the unverified country list and the
   unresolved provider-classification question as two separate sentences,
   and removed the internal-work narration ("see 'Providers' above for why
   that classification work is not yet complete"). No country or
   classification was invented.
4. **P-04.** Added a concise cookie summary to §5: Cloudflare may use
   strictly necessary cookies for edge security/challenge processing with no
   specific cookie named, no consent banner is planned while the posture is
   "no nonessential tracking," whether a banner is legally required remains
   a legal-review question, and the Data Collection Policy is the
   authoritative detailed source. The Data Collection Policy's own cookie
   disclosure was not touched.
5. **P-05.** Corrected internal blocker 8 and the recording bullet in the
   factual-uncertainties list — §3 does mention recordings (and, after P-12,
   incidental voice chat); what is absent is detail and any legality
   assertion. Corrected the "How this document stays separate" section to
   say plainly that essential high-level facts are repeated verbatim across
   both documents where useful (permitted by E2D3 item 10, not a violation),
   flagged as a maintenance-drift risk to check on future revisions, while
   detailed inventories/schedules/provider facts stay exclusively in the
   Data Collection Policy.
6. **P-06.** Restored "access" to §5's log-category list: "access,
   operational, error, and security" logs, matching the Data Collection
   Policy. No claim that every category is actually generated; the logging
   inventory (blocker 11) remains open.
7. **P-08.** Split the combined blocker into two: blocker 9
   (provider processor/controller/service-provider classification,
   counsel-dependent) and blocker 10 (outside-Canada country list, an
   internal factual-completion item), sequenced and cross-referenced to the
   Data Collection Policy's blocker 11/12 numbering.

**Decision-free polish applied:**

- **P-07.** Rewrote §6's cookie-free paragraph to state plainly that
  cookie-free is Cloudflare's attributed claim, that Web Analytics is
  nonetheless an analytics feature that conflicts with the approved
  no-analytics posture regardless of cookie use, and that the consent-banner
  question remains unresolved. §6's "currently enabled" framing itself was
  not changed (that stays gated behind blocker 1/P-02).
- **P-09.** Removed the redundant §14 ("More detail"); the introduction and
  the §3/§10/§11 pointers already carry that function.
- **P-11.** Added a clause to §3 noting opponent information includes an
  EA-provided identifier that stays the same across matches. No lawful basis
  or clearance is asserted.
- **P-12.** Added a clause to §3 noting source gameplay recordings may
  incidentally include in-game party voice chat, pointing to the Data
  Collection Policy for the detailed factual treatment. No recording-legality
  claim is made.
- **P-16.** Replaced "private GitHub storage" with "GitHub" as the provider
  name in §7, describing the repository as private and holding source code
  plus a limited set of test fixtures. The prior-public-repository caveat
  (E2A decision 8) was deliberately not duplicated here — it remains the Data
  Collection Policy's disclosure.

**Status and provenance.** Changed "initial working draft" to "revised
working draft" and updated the internal revision-provenance paragraph to
record the E2E → E2E2 → E2E2A → E2E3 chain.

**Blocker count.** Recalculated, not assumed: the original 11 blockers, plus
the new P-01 link-replacement blocker, plus the P-08 split (one blocker
becoming two), give **13** publication blockers. Verified by reading the
renumbered list back after editing.

**P-17 (historical pointer, not corrected in place).** The review's P-17
observes that `HANDOFF.md`'s E2D5 "next session recommendation" entry
(2026-09-09) cites "E2D3 item 8" for the document-structure decision; the
correct authority is **E2D3 item 10** (item 8 is the opponent-player display
decision). Per the established convention (E2D3 item 12), the historical
E2D5 entry is **not** rewritten here. This entry records the correction so a
later session does not follow the E2D5 pointer to the wrong item.

**What this does not do.** Does not edit
`docs/planning/data-collection-policy-draft.md` or
`docs/planning/data-collection-policy-review.md` (P-13, P-14 remain for a
future Data Collection Policy session). Does not edit
`docs/planning/privacy-policy-review.md`. Does not perform the read-only
logging inventory, route anything to counsel, draft the Terms of Use or the
EA/NHL attribution notice, implement routes/styling, or change code,
configuration, assets, tests, or dependencies. Does not decide a final public
route for either policy (Q-E2E2-1 remains open — Gate 3 routing, not legal).
Does not check any Gate 2 checkbox. Counsel review remains **deferred, not
completed** (E2D3 item 14); the five established counsel-only questions
(applicable law, opponent-data basis, recording law, provider classification,
consent-banner requirement) are unchanged. Cloudflare Web Analytics remains
enabled. Tunnel reopening remains separately unauthorized. **E2 remains IN
PROGRESS.**

**Next session recommendation:** a fresh session for either the read-only
logging inventory (blocker 11 on both drafts; E2D2A F-14, E2D3 item 12,
Q-12) or routing the outstanding Q-1/Q-4/Q-6 fact patterns and counsel-
dependent findings to counsel. Do not combine either with further public-text
drafting of the Privacy Policy, the Data Collection Policy, the Terms of Use,
or the EA/NHL attribution notice in the same session.

### 🟡 E2F EA/NHL ATTRIBUTION NOTICE INITIAL DRAFT WRITTEN — not reviewed, not published, no Gate 2 checkbox checked (2026-09-09)

Narrowly-scoped drafting session. Produced
`docs/planning/ea-nhl-attribution-notice-draft.md`: a first working draft of
the required EA/NHL non-affiliation and third-party asset/data attribution
notice, with a clearly separated public-notice section and an internal
drafting/publication-checks section. **No code, asset, test, configuration,
dependency, or provider setting was changed. No external system (EA,
Cloudflare, Proton, GitHub, host, database) was accessed. Nothing was
staged, committed, pushed, published, or deployed, and the tunnel remains
separately unauthorized.** The draft was built from `HANDOFF.md` (E2A,
E2C2–E2C5) and `docs/planning/ea-content-usage-policy-research.md`,
`docs/planning/ea-asset-decision-memo.md`, `docs/planning/data-collection-policy-draft.md`,
and `docs/planning/privacy-policy-draft.md` for consistent project identity
and contact wording; `docs/planning/launch-page-design-prototypes.md` was
consulted only for its established prototype-content boundary.

**What the draft covers:** project identity and non-affiliation (including
EA's own specified non-affiliation wording); data attribution to EA's game
services plus operator-run OCR; EA-sourced visual material (X-Factor images,
opponent crests, and the base-versus-custom crest ownership question left
explicitly unresolved, with custom crests not characterized as either
user-generated or EA-created); NHL/NHLPA/third-party rights using neutral
ownership wording; PlayStation/Xbox marks and other SVG Repo-derived assets
(factual sourcing only, no licence/clearance claim); Twemoji-style flags and
Barlow fonts (uncertainty preserved rather than guessed at); operator-created
material (BGM/SPD logo and rink/event-marker artwork, without publishing the
confidential "SPD" expansion or claiming independent inspection of private
source files); an explicit asset-retention-is-not-clearance section
preserving E2C5 exactly as-is; a visitor reuse boundary pointing to the
not-yet-drafted Terms of Use; and a contact section using
`webmaster@boogeymen.app`/`security@boogeymen.app` only. A short sitewide/
footer-length notice is included as a clearly labelled drafting component for
later Gate 3 implementation — **not implemented in code.**

**Publication blockers preserved inside the draft's internal section, not
hidden:** counsel/legal review is incomplete; no asset family from
E2C3/E2C4/E2C5 is legally cleared (X-Factor PNGs `NOT ADDRESSED /
AMBIGUOUS`; base crests `CONDITIONALLY SUPPORTED AT BEST, on unverified
premises`; custom crests `CONDITIONAL / FACTUAL NATURE UNRESOLVED`); EA's
content-policy research remains ambiguous and does not establish
authorization for these specific uses; NHL/NHLPA/team/player third-party
rights remain unresolved; base/custom crest factual ownership remains
unresolved; exact SVG Repo per-asset source pages and licence records are
missing; separate Sony/Microsoft evidence is missing; Twemoji/Barlow
attribution wording remains subject to accurate source verification; the
Terms of Use cross-reference and final public routes remain undecided; and
the footer notice must later link to the full notice once one is published.

**Asset boundary respected.** E2C5's retain-everything-as-is decision is not
reopened — the draft's section 8 states plainly that retention is not legal
clearance and does not recommend removing, replacing, relocating,
deduplicating, recolouring, regenerating, renaming, hiding, or falling back
any asset.

**What this does not do.** It does not check the Gate 2 "EA/NHL
non-affiliation and third-party asset/data attribution notice" checkbox —
this is a first draft still requiring independent review. It does not draft
the Terms of Use, revise the Privacy Policy or Data Collection Policy
drafts, decide any public route, conduct new external legal or rightsholder
research, or touch any live route/footer/asset/code. Cloudflare Web
Analytics remains enabled and undone (E2B3). **E2 remains IN PROGRESS.**

### 🟡 E2F2 EA/NHL ATTRIBUTION NOTICE INDEPENDENTLY REVIEWED — draft NOT accepted; 1 blocker, 10 material corrections; no Gate 2 checkbox checked (2026-09-09)

Narrowly-scoped independent review session following E2F. Produced
`docs/planning/ea-nhl-attribution-notice-review.md`: a factual, structural,
and public/internal-boundary review of
`docs/planning/ea-nhl-attribution-notice-draft.md`. **The attribution notice
draft was NOT revised. No other planning draft or review was modified. No
code, asset, test, configuration, dependency, route, or provider setting was
changed. No external system (EA, Cloudflare, Proton, GitHub, host, database)
was accessed and `scripts/scrape_ea_xfactor_pngs.sh` was not executed.
Nothing was staged, committed, pushed, published, or deployed; the tunnel
remains separately unauthorized.** This is issue-spotting, not legal advice
and not counsel review; it makes **no** finding about permission,
infringement, fair use, ownership, or clearance for any asset.

**Verdict: NOT ACCEPTED as a drafting checkpoint.** Findings: **1 BLOCKER, 10
MATERIAL CORRECTIONS, 7 RECOMMENDATIONS, 2 ACCEPTABLE AS WRITTEN** (20 total).

**BLOCKER (A-01).** Public §6 contains a live cross-reference into the
internal risk register — `— see "Internal drafting and publication checks"
below`. The draft's own internal check 12 forbids internal *terms* in public
text but not a structural *cross-reference*, so the leak passes the
checklist. Publishing with the internal section intact routes readers to the
unresolved-classification list; publishing with it deleted leaves a dangling
pointer. Same class of defect as `privacy-policy-review.md` P-01.

**Material corrections (summary).** Footer omits "or its licensors" and
paraphrases rather than carries the statement EA specifies, although the
footer is the only sitewide surface where EA content is displayed (A-02);
footer's "all such material remains the property of its respective owners"
sweeps factual match/statistics data into a property claim and contradicts
public §2 (A-03); EA's bracketed placeholder is published literally as "this
project/website" — resolve to "This website" as a standalone sentence (A-04);
"EA does not review, verify, or approve…" is a categorical claim about a
third party's conduct that no repository or operator evidence establishes —
restate as project-side responsibility plus "we neither claim nor know of any
EA review, verification, or approval" (A-05); "EA's own materials cannot
grant" is a legal conclusion where the verified EA quotation ("We do not
provide you with any permission to use third-party content from our games")
is directly attributable (A-06); public §8 narrates E2C5's retention decision
in public voice, is addressed to future internal sessions, and goes stale on
any asset change (A-07); public §7 publishes agent review methodology ("what
our operator has told us") (A-08); public §5 attributes embedded SVG Repo
markers to site files that do not carry them and names hockey icons that are
not deployed at all (A-09); flags are given two unreconciled origins across
§5 and §6 (A-10); and §§3 and 5 publish express no-permission /
no-licence / no-fair-use / no-evidence admissions with no attribution
function (A-11).

**Repository facts verified read-only in this session.** `apps/web/public`
holds exactly two SVGs (`assets/platforms/{playstation,xbox}.svg`), both
carrying SVG Repo markers; **no file under `apps/web/src` carries an SVG Repo
marker**; `docs/branding/flags/{canada,united-states}.svg` carry **both** an
SVG Repo marker and `class="iconify iconify--twemoji"`; the site's deployed
flags are inline JSX in `components/player-meta-icons.tsx`; archetype icons
are deployed as inline paths sourced from `docs/branding/icons/archetypes/`;
and **`docs/branding/icons/hockey/` is referenced nowhere in `apps/web/src`.**

**Boundaries preserved.** E2C5's retain-everything-as-is decision is **not
reopened** — A-07 moves where the retention record lives, not the decision,
and no asset change is recommended anywhere in the review. E2C3's three legal
classifications are unchanged. E2A decision 4's reuse rules are left for the
Terms of Use, not duplicated into the notice. The confidential SPD expansion
remains unpublished. Gate 2 line 150 ("Draft an EA/NHL non-affiliation and
third-party asset/data attribution notice…") remains `- [ ]` — **no Gate 2
checkbox changed.**

**Operator question (one).** **Q-E2F2-1:** should the public notice keep its
express no-permission / no-clearance / no-evidence statements (public §8's
"Retaining an asset is not the same thing as having permission to use it",
§3's no-clearance paragraph, and §5's three missing-evidence/no-claim
passages), or move them to the internal section? The review recommends moving
them internal — none helps a reader understand attribution or non-affiliation
and all are already recorded in the internal blockers and here — but E2C5
decision 7 puts the legal posture in the operator's hands. Corrections A-07
and A-11 are held pending this answer. **Asset retention is unaffected either
way, and every source attribution stays public either way.**

**Counsel-only questions preserved unresolved:** whether to invoke EA's
condition in §1 while §3 disclaims relying on EA's policy (Q-C-1); whether to
restore the stronger "EA cannot grant" formulation (Q-C-2); whether an
attribution notice should contain express no-permission statements at all
(Q-C-3); and the standard ownership formula plus any per-mark trademark
acknowledgement (Q-C-4). E2C3's U1–U8 and LR-2–LR-6 remain unresolved and
untouched.

**Recommended next session (one task).** **E2F3 —** apply the nine mechanical
corrections (A-01 through A-06, A-08 through A-10) plus the A-18 internal
checklist item to `docs/planning/ea-nhl-attribution-notice-draft.md`. Hold
A-07 and A-11 for the Q-E2F2-1 answer. Do not revise any other draft, resolve
any public route, check a Gate 2 checkbox, conduct external licence research,
or reopen E2C5. **E2 remains IN PROGRESS.**

### 🟡 E2F2A E2F2 REVIEW CORRECTED — two overstatements removed; counts now 1 blocker / 9 material / 8 recommendations; no Gate 2 checkbox changed (2026-09-09)

Narrow documentation-correction session following E2F2. **The E2F2 entry above
is left exactly as written and is superseded, not rewritten, by this entry on
the three points listed below.** Two factual overstatements in E2F2's review
were corrected before its findings drive E2F3. **The attribution notice draft
was NOT edited — it is byte-for-byte identical to its E2F state
(sha256 `2752bd57…fae279`, verified before and after). No other planning draft
or review was modified. No code, asset, configuration, test, route, or
dependency was changed. No external system (EA, Cloudflare, Proton, GitHub,
host, database) was accessed, no external research was conducted, and
`scripts/scrape_ea_xfactor_pngs.sh` was not executed. Nothing was staged,
committed, pushed, published, or deployed; the tunnel remains separately
unauthorized.** Files edited: `docs/planning/ea-content-usage-policy-research.md`,
`docs/planning/ea-nhl-attribution-notice-review.md`, and this one additive
`HANDOFF.md` entry.

**Correction 1 — EA disclaimer placement. Supersedes E2F2's A-02
classification and its page-by-page/footer-placement claim.** The locally saved
official EA quotation is: "If you have a website or other location where you're
displaying our game content, include the following statement: 'This
[project/website] is not endorsed by or affiliated with EA or its licensors.'"
That supports including the statement on the website or other location
displaying EA game content, and treating it as a **condition** if EA's content
policy is relied on. It does **not** establish that the statement must appear on
every page containing EA content, that it must appear in a sitewide footer, or
that the footer is the only compliant placement. E2F2 asserted all three.
`ea-content-usage-policy-research.md` §7 item 1 previously read "Required
wherever EA game content is displayed"; it now states EA's direction precisely
and records explicitly that the reviewed text specifies neither page-by-page nor
footer placement, with a visible E2F2A correction note above it. The exact EA
quotation and the condition-not-permission distinction are preserved verbatim,
and no unrelated research conclusion was rewritten. In the review, **A-02 is
reclassified from MATERIAL CORRECTION to RECOMMENDATION**; its heading,
evidence, analysis, and proposed resolution are corrected; the "only sitewide
surface" claim is removed; and the practical recommendation is kept — if a
sitewide footer notice is used, matching EA's specified statement including "or
its licensors" is the safer and more consistent drafting choice. Counsel
question Q-C-1 was carrying the same overstatement and is corrected too.
`ea-content-usage-policy-research.md` LR-7 already preserved "where it must
appear" as open, and still does. **A-04 is unchanged and remains a MATERIAL
CORRECTION:** the public full notice must resolve `[project/website]` naturally
as "This website."

**Correction 2 — flag derivation evidence. Supersedes E2F2's claim that no
repository evidence links the deployed inline flags to the local SVG files.**
That claim is **false.** Verified mechanically this session by parsing every `d`
attribute in each file into an explicit command/argument sequence and comparing:
the inline flags in `apps/web/src/components/player-meta-icons.tsx` reproduce
the same vector path data as `docs/branding/flags/canada.svg` (3 of 3 paths
identical) and `docs/branding/flags/united-states.svg` (4 of 4 identical), with
identical `fill` values in both; the only differences are whitespace and elided
implicit-`l` command letters. The two local SVG files carry **both** an SVG Repo
generator/source marker and `class="iconify iconify--twemoji"`; the deployed JSX
retains **neither** the metadata comments nor the class marker. So there is one
flag family, linked by path-data identity — **not two unrelated origins.** What
remains unresolved sits upstream of the repository: the original upstream
source, the exact source-page URL, genuine Twemoji status, and the applicable
licence and version. **A-10 remains a MATERIAL CORRECTION**, because the current
public notice still gives that single family two unreconciled descriptions; its
evidence and proposed wording are corrected, and the proposed E2F3 public
wording is now: "The country flags rendered by the site reproduce vector artwork
from the project's local Canada and United States SVG source files. Those local
files carry both SVG Repo and Twemoji-style metadata; the original upstream
source and applicable licence have not been established." **No upstream licence
or permission is asserted.** A-09's flag evidence bullet is corrected the same
way; A-09's other content (hockey icons not deployed, archetype icons inline,
site files carrying no markers) is unchanged.

**Corrected counts. Supersede E2F2's counts and its required/mechanical
correction counts.** **1 BLOCKER, 9 MATERIAL CORRECTIONS, 8 RECOMMENDATIONS,
2 ACCEPTABLE AS WRITTEN — 20 total** (E2F2 recorded 1/10/7/2). No finding was
added or withdrawn; only A-02 changed class. **Required before the draft can be
accepted: 10 — A-01 and A-03 through A-11** (E2F2 recorded eleven, including
A-02). **A-07 and A-11 remain held for Q-E2F2-1.** **Eight required corrections
are mechanical without that answer: A-01, A-03, A-04, A-05, A-06, A-08, A-09,
A-10** (E2F2 recorded nine). **A-02 is now optional but recommended footer
polish**, and **A-18 remains a recommended internal checklist improvement.**
Updated consistently across the review: the finding-count table, the index, the
finding bodies for A-02/A-09/A-10, §4.10's footer table, the §5 overall verdict,
the §6 required-correction list, §7's optional improvements, §8's operator
question, §9's Q-C-1, §10's recommended next session, and §11's untouched/scope
section.

**Boundaries preserved.** **Q-E2F2-1 remains unanswered — no operator answer was
supplied in this session and none is recorded anywhere in the repository.** E2C5's
retain-everything-as-is decision is **not reopened** and no asset changed. E2C3's
three legal classifications are unchanged. No permission, licence, fair use,
ownership, or clearance is inferred anywhere in this correction. Counsel review
remains deferred and Q-C-1 through Q-C-4 stay unresolved. Gate 2 line 150 remains
`- [ ]` — **no Gate 2 checkbox changed.** No Terms drafted, no logging inventory
performed, no public route resolved.

**Recommended next session (one task). E2F3 —** apply the **eight** mechanical
corrections (A-01, A-03, A-04, A-05, A-06, A-08, A-09, A-10) plus the A-18
internal checklist item to `docs/planning/ea-nhl-attribution-notice-draft.md`,
using the corrected A-10 wording above. Hold A-07 and A-11 for the Q-E2F2-1
answer. A-02 is optional polish; bundle it only if the operator asks. Do not
revise any other draft, resolve any public route, check a Gate 2 checkbox,
conduct external licence research, or reopen E2C5. **E2 remains IN PROGRESS.**

### 🟡 E2F3 ATTRIBUTION NOTICE CORRECTED AGAINST E2F2A + OPERATOR Q-E2F2-1 DECISION — all ten required corrections applied; 14 publication blockers remain open; no Gate 2 checkbox changed (2026-09-09)

Narrowly-scoped correction session following E2F2A. Revised
`docs/planning/ea-nhl-attribution-notice-draft.md` against the E2F2A-corrected
review and the operator's answer to Q-E2F2-1. **No asset, code, test,
configuration, dependency, route, styling, or provider setting was changed. No
external system (EA, Cloudflare, Proton, GitHub, host, database) was accessed,
no new legal or rightsholder research was conducted, and
`scripts/scrape_ea_xfactor_pngs.sh` was not executed. The review, the EA
content-usage-policy research, the asset decision memo, and the privacy and
data-collection drafts were not edited and remain byte-for-byte unchanged.
Nothing was staged, committed, pushed, published, or deployed; the tunnel
remains separately unauthorized.** Files edited: the attribution notice draft
and this one additive `HANDOFF.md` entry. Historical E2F/E2F2/E2F2A entries are
**not** rewritten.

**Operator decision recorded — Q-E2F2-1 is now ANSWERED.** *Move the express
no-permission, no-clearance, and missing-evidence statements into the internal
section. Delete public §8, "Asset retention is not legal clearance." Keep
factual source attribution and non-affiliation public.* The operator recorded
that this **changes no asset and does not reopen E2C5.** This supersedes E2F2's
and E2F2A's record that Q-E2F2-1 was unanswered; A-07 and A-11, previously
held, were applied in this session.

**All ten required corrections applied (A-01, A-03 through A-11).**

1. **A-01 (BLOCKER) —** the public cross-reference `— see "Internal drafting and
   publication checks" below` is deleted from public §6. No public text points
   into the internal section.
2. **A-03 —** the footer's single "all such material remains the property of its
   respective owners" sentence is split: match/statistics data is
   source-attributed to EA's NHL game services and the project's own recording
   and review; third-party names, marks, and imagery remain **subject to the
   rights of** their respective owners. Factual data is no longer described as
   anyone's property and no ownership chain is invented.
3. **A-04 —** EA's bracketed placeholder is resolved. Public §1 now carries
   **"This website is not endorsed by or affiliated with EA or its licensors."**
   as its own bolded standalone sentence, visibly separate from the broader
   non-affiliation list, under a lead-in that frames it as a **condition** EA
   specifies — not as evidence of permission.
4. **A-05 —** "EA does not review, verify, or approve…" is gone. Replaced with
   project-side wording: Boogeymen independently prepares, organizes, and
   presents its calculations, summaries, and derived statistics and is solely
   responsible for them, and **neither claims nor knows of** any EA review,
   verification, or approval. No claim about EA's conduct beyond recorded
   evidence.
5. **A-06 —** "EA's own materials cannot grant…" is gone. Replaced with the
   attributable fact: "EA states that it does not provide permission to use
   third-party content from its games. EA's materials therefore do not purport
   to grant rights held by the NHL, the NHLPA, individual teams or clubs,
   individual players, Sony or PlayStation, Microsoft or Xbox, or other third
   parties." No independent conclusion about EA's legal capacity.
6. **A-07 (operator decision) —** public §8, "Asset retention is not legal
   clearance," is **deleted in full**; former §9 → §8 and §10 → §9, and internal
   blocker 9's Terms-of-Use section reference is updated to match. **E2C5 is
   preserved internally and here:** every asset remains unchanged; no removal,
   replacement, relocation, deduplication, recolouring, regeneration, renaming,
   hiding, or fallback switch is authorized; retention remains distinct from
   legal clearance. Internal blocker 13 is rewritten to carry all three points
   and to record that **the public notice deliberately does not narrate the
   internal asset-retention decision.**
7. **A-08 —** the paragraph stating that no agent independently inspected the
   operator's private source files is deleted from public §7. The factual public
   attribution is kept exactly: BGM/SPD artwork created by the operator;
   rink/event-marker artwork created by the operator and later incorporated with
   Claude Design assistance. **The confidential SPD expansion remains
   unpublished.** The not-independently-verified fact stays internal via E2C2 and
   the internal family table.
8. **A-09 —** public §5 now describes only supported deployed usage:
   player-archetype icons **reproduced as inline vector paths** from local SVG
   files obtained through SVG Repo, with the deployed inline paths noted as **not
   themselves containing** the SVG Repo metadata. Hockey-related icons are
   removed from the deployed public attribution and are no longer described as
   being "on this site" (they are referenced nowhere in `apps/web/src`); they are
   tracked internally as repository-only.
9. **A-10 —** the single flag family is attributed **once**, in §6 only, using
   the E2F2A-corrected evidence: "The country flags rendered by the site
   reproduce vector artwork from the project's local Canada and United States SVG
   source files. Those local files carry both SVG Repo and Twemoji-style
   metadata; the original upstream source and applicable licence have not been
   established." Flags are removed from §5's list (§5 now points to §6, a
   public-to-public reference). **No two unrelated origins are claimed and no
   Twemoji or SVG Repo licence is invented.**
10. **A-11 (operator decision) —** removed from the public notice: §3's express
    no-permission/no-clearance/fair-use paragraph; §5's "we do not hold… any Sony
    or Microsoft permission, licence, or brand-guideline evidence"; §5's "we have
    not retained the exact per-asset source-page URLs or per-asset licence
    records"; and §5's blanket "we do not claim… licensed, in the public domain,
    legally cleared, or used with permission." **Every factual public source
    attribution is preserved** — EA game services and operator OCR (§2), EA CDN/
    media sourcing for X-Factor images and crests (§3), SVG Repo for the
    PlayStation/Xbox marks and archetype icons (§5), the flag derivation (§6),
    Barlow/Barlow Semi Condensed (§6), operator-created artwork (§7). These facts
    remain recorded internally through **existing** blockers 2 (no family
    cleared), 3 (ambiguous EA policy scope), 6 (missing SVG Repo source/licence
    records), 7 (missing separate Sony/Microsoft evidence), and 8 (unresolved
    Twemoji/Barlow attribution) — **not duplicated**, since those blockers already
    state them completely.

**Two recommendations applied in the same pass.** **A-02 —** the footer now
carries EA's specified statement exactly and separately ("This website is not
endorsed by or affiliated with EA or its licensors."), followed by a separate
concise sentence covering the broader NHL/NHLPA/platform/team/player
non-affiliation list. **No page-by-page or footer placement requirement is
asserted anywhere** — consistent with E2F2A's correction to
`ea-content-usage-policy-research.md` §7 item 1 and with LR-7, which still
preserves "where it must appear" as open. **A-18 —** a new internal checklist
item (14) requires pre-publication verification that no publishable text points
into the internal section, every placeholder link is replaced with a valid
published route, the footer/full-notice relationship resolves correctly, and no
internal section is shipped.

**Deliberately not applied. A-12 through A-17 remain optional polish** for a
later review: §3 crest-bullet compression and "retained as part of this project"
(A-12); §4's "we do not know… ownership chain" audit voice (A-13); the three
ownership phrasings and the §4 self-quotation (A-14); §8's "which is not yet
published" Terms pointer (A-15); §6's work-in-progress framing (A-16); §1's
noncommercial qualifier (A-17). The task was not broadened.

**Status and provenance.** The draft's status line now reads **"revised working
draft"** (was "first working draft"). A new internal **Revision provenance**
subsection records E2F, E2F2, E2F2A with its corrected counts, the operator's
Q-E2F2-1 decision, and E2F3 with the corrections applied and withheld.
**Publication-blocker count recalculated: 14** (was 13 — blocker 13 rewritten,
blocker 14 added for A-18; no blocker removed). Internal Gate 2 status rewritten
to note that E2F2 was issue-spotting, not counsel review.

**Preserved unchanged.** All factual source attribution; EA's exact
condition-not-permission boundary; the base/custom crest ownership question left
explicitly unresolved and uncharacterized either way; no monetization now or
planned (E2C5 decision 1); operator-created artwork attribution; the
confidential SPD expansion, still unpublished; E2C3's three legal
classifications verbatim; E2C5's asset retention in full; the unresolved Terms
of Use cross-reference and public-route placeholders (blocker 9, Q-E2E2-1); and
the counsel-review requirement (blocker 1). `webmaster@boogeymen.app` and
`security@boogeymen.app` remain the only contacts; `alerts@boogeymen.app` is
absent.

**Unresolved and carried forward.** Counsel review is still deferred and
**Q-C-1 through Q-C-4 remain open** (invoking EA's condition while §3 no longer
disclaims reliance; whether to restore the stronger "EA cannot grant"
formulation; whether an attribution notice should contain express no-permission
statements at all; the standard ownership formula). **No asset is legally
cleared.** E2C3's U1–U8 and LR-2–LR-7 are untouched. The notice's own public
route and the Terms of Use link are undecided. Terms of Use is not drafted.
Cloudflare Web Analytics remains enabled and undone (E2B3 decision 1). Gate 2
line 150 remains `- [ ]` — **no Gate 2 checkbox changed.** **E2 remains IN
PROGRESS.**

**Recommended next session (one task). E2F4 —** a narrowly scoped final
verification and polish pass over
`docs/planning/ea-nhl-attribution-notice-draft.md` only: re-read the public
notice, footer component, and internal section end to end for internal
consistency after the renumbering; confirm the public/internal boundary holds;
and decide whether to apply any of A-12 through A-17. Do not revise any other
draft, resolve any public route, check a Gate 2 checkbox, conduct external
licence research, or reopen E2C5.

### 🟡 E2F4 ATTRIBUTION NOTICE FINAL DRAFTING-QUALITY PASS — A-12 through A-17 applied; drafting-quality checkpoint only; 15 publication blockers now open; no Gate 2 checkbox changed (2026-09-09)

Narrowly-scoped final drafting-quality verification and polish session
following E2F3. Revised `docs/planning/ea-nhl-attribution-notice-draft.md`
only. **No asset, code, test, configuration, dependency, route, styling, or
provider setting was changed. No external system (EA, Cloudflare, Proton,
GitHub, any host, any database) was accessed, no new legal or rightsholder
research was conducted, and `scripts/scrape_ea_xfactor_pngs.sh` was not
executed. The review, the EA content-usage-policy research, the asset decision
memo, and the privacy and data-collection drafts were not edited and remain
byte-for-byte unchanged. Nothing was staged, committed, pushed, published, or
deployed; the tunnel remains separately unauthorized.** Files edited: the
attribution notice draft and this one additive `HANDOFF.md` entry. Historical
E2F/E2F2/E2F2A/E2F3 entries are **not** rewritten.

**All six remaining recommendations applied (A-12 through A-17).**

1. **A-12 — EA visual-material narration compressed.** §3's X-Factor bullet
   keeps its factual EA web/CDN source attribution; "retained as part of this
   project" is replaced with **"stored and served by this site."** The two
   crest bullets are merged into one that keeps the factual attribution
   (retrieved from EA's media/game-data sources using identifiers EA's game
   services return) and preserves that **EA's own data distinguishes a base
   crest family from a club-specific custom crest family**, closing with "We do
   not state here who created or owns any particular crest." **Custom crests
   are still not classified as EA-created or as user-generated**, and the
   drafting-procedure sentence that narrated that choice is gone.
2. **A-13 — audit voice removed from third-party-rights text.** §4's paragraph
   beginning "We do not know, and do not state here…" is deleted. Replacement:
   references to third parties identify a source or provide context; they do
   not imply affiliation, do not identify the specific owner of any individual
   mark or asset, and do not state the scope of any trademark right. The
   attribution-is-not-permission clause is preserved. **No trademark
   registration or ownership chain is invented.**
3. **A-14 — ownership language standardized** on **"subject to the rights of
   their respective owners"** across §4, §8, and the footer. Removed: the
   self-quoted "belongs to its respective owner(s)"; the trailing "whatever
   those rights turn out to be"; categorical "property of" wording (already
   absent since E2F3's A-03). **No ownership language is applied to factual
   match/statistical data** — the footer continues to source-attribute that
   data rather than describe it as anyone's property.
4. **A-15 — Terms pointer made publication-safe.** "which is not yet
   published" is removed from public text. §8 now reads "Detailed rules about
   how visitors may use content on this site are set out in our Terms of Use —
   `PLACEHOLDER-TERMS-OF-USE-URL`." **No route was invented or decided.** A new
   internal **blocker 15** requires all three of: the Terms of Use published
   before or at the same time as this notice; every occurrence of
   `PLACEHOLDER-TERMS-OF-USE-URL` replaced with the final published route; and
   the resulting link verified to resolve — with the instruction to delete the
   sentence rather than publish a pointer to a nonexistent document. Blocker 9
   is updated to name the placeholder and to point at blocker 15.
5. **A-16 — work-in-progress attribution narration replaced.** *Flags:* §6 now
   states only the known fact — the rendered inline vectors reproduce the
   project's local Canada and United States SVG files, and the metadata in
   those files refers to SVG Repo and to a Twemoji-derived visual style. The
   upstream-source and licence uncertainty is moved **entirely internal** to
   blocker 8; **no Twemoji or SVG Repo licence is claimed.** *Typefaces:* §6
   states that the site uses Barlow and Barlow Semi Condensed and that the
   site's current source loads them through Next.js font tooling, which
   retrieves the files at build time and self-hosts them as part of the build
   output (verified against `apps/web/src/app/layout.tsx`, which imports
   `Barlow` and `Barlow_Semi_Condensed` from `next/font/google`). "We are
   continuing to work on it" and the rest of the status narration are gone.
   **No licence, designer, source page, or attribution requirement is
   invented.**
6. **A-17 — noncommercial wording aligned with the privacy drafts.** §1 and the
   footer now carry "There is no advertising, monetization, or other commercial
   activity on this site now, and none is planned," matching
   `privacy-policy-draft.md` lines 33–35. **Nothing promises this can never
   change**, and the footer's flat "noncommercial" adjective is replaced by the
   qualified formulation.

**Final public/internal/footer verification.** The full notice, the footer
drafting component, and the internal section were re-read end to end. **No
section was added or removed, so the public numbering 1–9 is unchanged and §5's
public-to-public pointer to section 6 still resolves.** Verified: the public
text contains **no internal-section cross-reference**; no "continuing to work,"
"we do not know," missing-evidence, no-permission, no-clearance, or
asset-retention narration; **no positive permission, licence, fair-use,
ownership, or clearance claim**; ownership language standardized and not
applied to factual data; `PLACEHOLDER-TERMS-OF-USE-URL` present in public §8
and tracked by internal blockers 9 and 15; **EA's specified standalone
statement — "This website is not endorsed by or affiliated with EA or its
licensors." — present in both the full notice (§1) and the footer**, with **no
page-by-page or footer placement requirement asserted anywhere**; custom crests
still factually unresolved; the confidential SPD expansion and
`alerts@boogeymen.app` both still absent (`webmaster@boogeymen.app` and
`security@boogeymen.app` remain the only contacts). `git diff --check` clean,
no trailing whitespace introduced, and `git status --short` shows only the
attribution notice draft and this `HANDOFF.md` entry as changed by this
session — **no other document, asset, code, or configuration was touched.**

**Result — drafting-quality checkpoint only.** The notice is accepted as a
**drafting-quality checkpoint**: the public text now reads as a public
attribution/non-affiliation notice rather than an audit report, and all
internal evidence gaps and legal uncertainty live in the internal section.
**This is explicitly not legal clearance and explicitly not publishable text**,
and that statement is now recorded in the draft's status blockquote, its E2F4
revision-provenance entry, and its internal Gate 2 status.

**Status and blockers.** The draft's status line still reads **"revised working
draft."** Revision provenance now records E2F, E2F2, E2F2A, the operator's
Q-E2F2-1 decision, E2F3, and E2F4. **Publication-blocker count recalculated by
counting the enumerated items, not assumed: 15** (was 14). Blocker 15 is new,
for A-15's Terms publication/link dependency; blocker 8 was reworded to absorb
the flag/typeface upstream-source and licence uncertainty removed from public
§6, and to forbid reintroducing drafting-status narration; blocker 9 was
updated to name the placeholder; **no blocker was removed.** The internal Gate 2
status now reads "all fifteen publication blockers."

**Preserved unchanged.** Every E2F3 correction and operator decision. All
factual source attribution — EA game services and operator OCR (§2), EA web/CDN
and media sourcing for X-Factor images and crests (§3), SVG Repo for the
PlayStation/Xbox marks and archetype icons (§5), the flag derivation and
Barlow/Barlow Semi Condensed (§6), operator-created artwork (§7). EA's
condition-not-permission framing. The Q-E2F2-1 outcome: the express
no-permission, no-clearance, and missing-evidence statements stay internal and
public §8 ("Asset retention is not legal clearance") stays deleted. **E2C5
asset retention is unchanged and was not reopened — every asset remains
unchanged, and no removal, replacement, relocation, deduplication,
recolouring, regeneration, renaming, hiding, or fallback switch is
authorized.** E2C3's three legal classifications remain verbatim.

**Unresolved and carried forward.** **Counsel review remains deferred and Q-C-1
through Q-C-4 remain open** (invoking EA's condition while §3 no longer
disclaims reliance; whether to restore the stronger "EA cannot grant"
formulation; whether an attribution notice should contain express no-permission
statements at all; the standard ownership formula). **No asset is legally
cleared.** E2C3's U1–U8 and LR-2–LR-7 are untouched. **Routing remains
undecided:** this notice's own public route, the footer's "Full notice" link,
and the Terms of Use route (Q-E2E2-1, blockers 9 and 15). **Terms of Use is
still not drafted.** The effective/last-updated date placeholders remain
unresolved (blocker 11). Cloudflare Web Analytics remains enabled and undone
(E2B3 decision 1). Gate 2 line 150 remains `- [ ]` — **no Gate 2 checkbox
changed.** **E2 remains IN PROGRESS.**

**Recommended next session (one task). Terms of Use first draft —** the last
undrafted Gate 2 policy, and now a hard dependency of this notice via blocker
15. Draft `docs/planning/terms-of-use-draft.md` only, against E2A decision 4
(personal/noncommercial viewing and normal search-engine indexing permitted;
disruptive bulk scraping, dataset republication, and commercial reuse require
permission) and the existing privacy/data-collection/attribution drafts. Do not
revise this notice or any other draft, resolve any public route, check a Gate 2
checkbox, conduct external licence research, reopen E2C5, or reopen the tunnel.

### 🟡 E2G TERMS OF USE INITIAL DRAFT WRITTEN — the last undrafted Gate 2 legal document now exists as a working draft; not reviewed, not published, no Gate 2 checkbox changed (2026-09-09)

Narrowly-scoped drafting session following E2F4. Created
`docs/planning/terms-of-use-draft.md` — the fourth and last of the Gate 2
legal drafts, and a hard publication dependency of the attribution notice's
blocker 15. **Files changed by this session: the new Terms draft and this one
additive `HANDOFF.md` entry — nothing else.** No other draft, review,
research, or prototype document was edited; the privacy, data-collection, and
attribution drafts and their reviews are byte-for-byte unchanged. No new legal
research was conducted; no external website, provider, account, host, or
database was accessed; Cloudflare settings were not inspected or changed; the
logging inventory was not performed; no prototype ZIP was extracted — the
local `Boogeymen Terms of Use.zip` was **not** opened and none of its wording
was used, per its recorded content boundary; no code, configuration, asset,
test, dependency, or route changed; nothing was staged, committed, pushed,
published, or deployed; the tunnel remains separately unauthorized. Historical
E2A–E2F4 entries are **not** rewritten.

**Public sections drafted (15).** 1 About these Terms (browse-wrap acceptance;
express statement that appearing in match data is **not** agreement to the
Terms); 2 What this site is (public read-only informational/archival project,
individually operated, free; no advertising/monetization now or planned; no
accounts, no login, no on-site submissions, email contact only; adult-only
membership with opponents' ages unknown, unverifiable, and not collected, and
no visitor-age threshold introduced); 3 How you may use this site (personal
noncommercial viewing, linking, personal copies; **normal search-engine
indexing permitted**; automated access not prohibited as such); 4 Uses that
need permission first (disruptive bulk collection, dataset republication,
commercial reuse — requests to `webmaster@boogeymen.app`, with an express
limit that permission covers only material the project is in a position to
permit); 5 Things you must not do (disruption/attack, access-control and
rate-limit bypass, impersonation, unlawful use, with `security@boogeymen.app`
named for vulnerability reports); 6 Accuracy and archival character (EA game
services plus operator OCR/manual review; errors, gaps, and delays possible;
nothing official or authoritative; correction/de-identification/removal
handled case-by-case under applicable law and archival need **through the
privacy documents' process, which these Terms do not change or replace**);
7 Third-party content, names, and marks (no blanket ownership claim; material
remains subject to the rights of its respective owners; no licence,
permission, fair-use, endorsement, or clearance claim; short non-affiliation
sentence plus attribution-notice pointer; rights-holder contact); 8 Privacy
(pointers only); 9 Availability of the site; 10 Restricting access
(proportionate rate-limiting/blocking/filtering, some automatic or temporary,
with an express statement that there are no accounts to suspend, cancel, or
terminate); 11 No warranties; 12 Limits on liability; 13 Governing law;
14 Changes to these Terms; 15 Contact.

**Exact permitted-use wording.** "You may read, view, and browse this site for
your own personal, noncommercial purposes. You may link to our pages, and you
may keep personal copies — a saved page, a screenshot, a quoted result — for
your own personal, noncommercial use." Indexing: "**Normal search-engine
indexing is permitted.** Ordinary search-engine crawlers are welcome to crawl
and index this site's public pages in the usual way." Followed by: "Automated
access is not prohibited as such. The limits in the next two sections are
about disruptive volume, evasion, and downstream reuse — not about whether a
request comes from a person or from a program."

**Exact restricted-use wording (section 4, permission-required, not
prohibited).** "**Bulk collection that disrupts the site.** Automated
collection at a volume or rate that degrades, overloads, or interferes with
this site or the infrastructure it runs on, or that works around rate limits
or other protective measures. This is a restriction on disruptive bulk
scraping. It is not a general ban on automated access, and it is not directed
at ordinary search-engine crawling." · "**Republishing our information as a
dataset.** Redistributing the match, statistics, roster, identifier, or
related information published here — in whole or in substantial part — as a
dataset, data feed, API, database, mirror, or comparable bulk compilation." ·
"**Commercial reuse.** Using this site's content for commercial purposes,
including in a paid, advertising-supported, sponsored, or otherwise
revenue-generating product or service."

**Deliberately absent, per E2A decision 6 and this session's scope:** no
indemnity clause, no arbitration clause, no exclusive-venue clause, no
jury-trial waiver, no liquidated damages, no liability cap figure, no blanket
intellectual-property ownership claim, no blanket prohibition on automated
access, and no age threshold beyond the already-approved adult-only membership
posture. Sections 11 and 12 carry explicit mandatory-law carve-outs
("applicable law — including consumer protection law — does not permit us to
exclude, restrict, or modify … this section applies only to the extent
applicable law allows"); section 13 states Alberta and applicable Canadian
federal law with **no exclusive venue** and an express preservation of
mandatory rights and access to a court or regulator where the reader lives.
`alerts@boogeymen.app` is absent from the file entirely.

**Cross-document boundaries recorded in the draft.** The Terms cover website
*use* only. The Privacy Policy stays the concise privacy overview; the Data
Collection Policy stays the authoritative detailed source for categories,
sources, purposes, public display/indexing, provider detail, retention, and
the full access/correction/withdrawal/removal mechanics — the Terms point at
that process and never restate or override it; the attribution notice stays
the authoritative public source for per-family asset attribution and the full
non-affiliation statement, including EA's specified wording, and the Terms
carry only a short non-affiliation sentence and a pointer rather than
duplicating the notice's audit history. E2C5 asset retention is preserved and
not reopened, and E2C3's three classifications are restated only internally,
unchanged.

**Placeholders used (non-resolving and greppable; no route invented).**
`PLACEHOLDER-PRIVACY-POLICY-URL`, `PLACEHOLDER-DATA-COLLECTION-POLICY-URL`,
`PLACEHOLDER-ATTRIBUTION-NOTICE-URL`, plus the two bracketed publication-date
placeholders for Effective date and Last updated. **No `.md` link and no
invented route appears anywhere in the public text.**

**Unresolved operator/counsel questions recorded (Q-E2G-1 … Q-E2G-5).**
(1) this document's own published route and the three placeholder routes —
undecided Gate 3 routing, same open item as Q-E2E2-1 and the notice's blockers
9/15; (2) whether the approved 7-day/30-day correction-request response
targets should extend to section 4 reuse-permission requests — the draft
deliberately promises nothing; (3) **whether AI-training, text-and-data-mining,
and dataset-building crawlers fall inside E2A decision 4's permitted "normal
search-engine indexing" or inside section 4's dataset-republication
restriction — undecided, and deliberately not resolved either way**, with the
parallel to EA's own genuinely ambiguous `robots.txt` AI/TDM reservation
(E2C3 U5/LR-5) recorded; (4) whether noncommercial community reuse (Discord
embed, forum quote, fan video screenshot) should be expressly permitted beyond
personal viewing; (5) whether counsel wants any of the excluded provisions —
none may be added without a fresh operator decision. The counsel questions
carried from the other drafts (applicable law F-01/F-02, opponent-data basis
F-07/F-08, recording law F-30, provider classification F-24, cookie-banner
requirement, and the notice's Q-C-1 through Q-C-4) are untouched, unresolved,
and neither relied on nor contradicted.

**Publication blockers — twelve, all open** (counted by enumerating the
internal list, not assumed): 1 legal/counsel review incomplete and deferred,
**and no independent review of this draft of any kind** — unlike the other
three drafts, which each had one; 2 replace both publication-date
placeholders; 3 replace all three route placeholders and verify each link
resolves to the published document; 4 sections 11/12/13 (warranty, liability,
governing law) require counsel review, with the mandatory-law carve-outs not
to be removed and no arbitration/venue/jury-waiver/indemnity/liquidated-damages
addition without a fresh operator decision; 5 asset retention is not legal
clearance — no asset family is cleared, E2C5 and E2C3's classifications
unchanged, and no ownership/licence/clearance claim or retention narration may
be added to public text; 6 a pre-publication consistency re-read against the
other three drafts on the shared facts; 7 **Cloudflare Web Analytics
disablement is a separate publication dependency, not a Terms provision** —
resolve it in the privacy documents, add no analytics wording here; 8 the
attribution notice's blocker 15 requires the Terms to be *published* before or
with the notice — existing as a draft does not satisfy it; 9 no internal
narration in public text and no public pointer into the internal section
(structure as well as terms, per the A-01 precedent); 10 section 4's reuse
restrictions are contractual site-use terms, **not** an assertion of rights in
the underlying data, and counsel must confirm the characterization and the
workability of a "disruptive" standard with no published rate limit; 11 no
visitor-age threshold introduced, and whether one is required is a
legal-review question; 12 the browse-wrap acceptance and change-notice
mechanics need review, with section 1's "appearing in match data is not
agreement" statement to be preserved in any rewrite.

**This is an initial working draft, not legal clearance and not publishable
text.** That statement is recorded in the draft's status blockquote, its E2G
revision-provenance entry, and its internal Gate 2 status. It has had no
independent review; the E2D2/E2D2A, E2E2/E2E2A, and E2F2/E2F2A reviews were
issue-spotting on other documents and none of them covers this one.

**Verification run this session.** Read the complete Terms draft end to end
and the complete new HANDOFF entry in context. `git diff --check` clean (no
whitespace errors); no trailing whitespace in `terms-of-use-draft.md`;
`git status --short` showed exactly the pre-existing dirty set plus the new
untracked `docs/planning/terms-of-use-draft.md`, with `HANDOFF.md` the only
other file this session modified; `git diff --cached --stat` empty (nothing
staged); HEAD and `origin/main` both confirmed at
`65bcddb43145d2fcffaeafb4d97d0e1a2737c35f` before and after editing. Confirmed
in the Terms file: `alerts@boogeymen.app` absent; no `.md` policy link in
public text; "Normal search-engine indexing is permitted" present; the
scraping restriction limited to disruptive bulk collection with the express
"not a general ban on automated access" sentence; and no arbitration,
exclusive venue, indemnity, liquidated damages, liability cap, invented age
threshold, or blanket ownership/clearance claim. Gate 2 line 152 ("Draft the
Terms of Use.") confirmed still `- [ ]`, and no other Gate 2 checkbox changed.

**Status.** Gate 2 now has four written legal drafts and **zero** reviewed or
publishable ones. **No Gate 2 checkbox changed. E2 remains IN PROGRESS.**
Counsel review remains deferred and not completed. Cloudflare Web Analytics
remains enabled and undone (E2B3 decision 1). Tunnel reopening remains
separately unauthorized.

**Recommended next session (one task). E2G2 —** a fresh, independent review
session over `docs/planning/terms-of-use-draft.md` only, in the same shape as
E2D2/E2E2/E2F2: verify every factual claim against `HANDOFF.md` and the
repository, check the public/internal boundary and that no public text points
into the internal section, check consistency against the privacy,
data-collection, and attribution drafts, and confirm no prohibited clause,
invented route, invented age threshold, or ownership/clearance claim crept in.
Do not revise the draft in that session, do not resolve any public route, do
not check a Gate 2 checkbox, do not reopen E2C5, and do not reopen the tunnel.

### 🟡 E2G2 TERMS OF USE INDEPENDENTLY REVIEWED — draft NOT accepted; 1 blocker, 10 material corrections; two E2G inaccuracies corrected additively; no Gate 2 checkbox changed (2026-09-09)

Narrowly-scoped independent review session following E2G, in the same shape as
E2D2/E2E2/E2F2. Created `docs/planning/terms-of-use-review.md`. **Files changed
by this session: the new review and this one additive `HANDOFF.md` entry —
nothing else.** `docs/planning/terms-of-use-draft.md` was **not** revised and is
byte-for-byte unchanged; the privacy, data-collection, and attribution drafts,
their reviews, the EA content-usage research, the asset decision memo, and the
launch-page prototypes are all unchanged. No external legal research was
conducted; no external website, provider, account, host, or database was
accessed; no code, configuration, asset, test, dependency, or route changed;
nothing was staged, committed, pushed, published, or deployed; the tunnel
remains separately unauthorized. E2C5, E2C3, E2C4, and every operator decision
remain unreopened. Historical E2A–E2G entries are **not** rewritten.

**Verdict. The draft is NOT ACCEPTED as a drafting-quality checkpoint.** The
Terms are structurally sound and unusually disciplined — no arbitration,
exclusive-venue, jury-waiver, indemnity, liquidated-damages, or liability-cap
provision; no invented route, age threshold, or ownership/clearance claim;
`alerts@boogeymen.app` absent; the public/internal boundary holding structurally
as well as lexically. What blocks acceptance is a small set of concrete defects,
not general weakness. **No new unsupported legal claim was identified in the
public text within the review's stated factual and drafting scope**, with the
single exception of finding T-04.

**Counts, by enumeration: 1 BLOCKER, 10 MATERIAL CORRECTIONS, 10
RECOMMENDATIONS, 9 ACCEPTABLE AS WRITTEN — 30 total.** Required before
acceptance: **11** (T-01 … T-11). **Nine are mechanical** (T-01, T-02, T-03,
T-04, T-05, T-07, T-08, T-09, T-10); **two are held for an operator answer**
(T-06 for Q-E2G2-1, T-11 for Q-E2G2-2) — the same hold pattern E2F2A used for
A-07/A-11.

**T-01 (the one BLOCKER) — section 4 offers permission for conduct section 5
prohibits.** Section 4's lead-in is "please ask us before you do any of the
following," and its first bullet covers automated collection that "degrades,
overloads, or interferes with this site … or that works around rate limits or
other protective measures" — both of which section 5 prohibits outright in
near-identical verbs. Read literally, the public text tells a reader that
disruption and circumvention are available on request. Correction boundary:
**volume is permission-required; disruption and evasion are prohibited, full
stop**, with section 4 cross-referencing section 5. Do not fix it by softening
section 5.

**The ten material corrections.** T-02 section 4's "in whole or in substantial
part" narrows E2A decision 4's unqualified dataset-republication requirement and
does silently permit smaller dataset republication (the bullet's form list
already excludes a quoted stat line, so the qualifier is redundant as well as
narrowing) · T-03 the bullet heading "Republishing **our** information" applies
a possessive to factual match data, against the A-03/A-14 rule that such data is
source-attributed, never owned — "information from this site" is the safer
heading · T-04 "We cannot give you permission for third-party material" is a
legal-capacity conclusion, structurally identical to the "EA's own materials
cannot grant…" formulation A-06 required removed, and should become "our
permission is ours alone: it is not permission from anyone else who holds rights
in material appearing on this site" · T-05 section 3's personal-copy grant
carries no third-party carve-out, because section 4's "only the material we are
actually in a position to permit" limiter is textually confined to section 4 ·
**T-06 (held)** section 7's "licensed, cleared, or used with permission" reuses
almost verbatim the vocabulary the operator's Q-E2F2-1 decision moved out of the
attribution notice's public text — a scope disclaimer in form, the removed
admission in substance; recommended fix is to keep "nothing in these Terms
grants you any rights in that material" and drop the clearance half · T-07
section 10's "Some of these measures are automatic" is not established (see
below) · T-08/T-09 the wrong E2A decision is cited in three places (see below) ·
T-10 E2G's "zero reviewed" status line (see below) · **T-11 (held)** section 3's
saved-pages/screenshots/quoted-results grant exceeds E2A decision 4's
"personal/noncommercial **viewing**" and should be operator-ratified rather than
assumed.

**T-07 — the automatic-enforcement claim is not supported, and the opposite
inference was drawn.** Distinguishing the three categories: *verified current
configuration* — E2B2 records **Rate-limiting rules: 0 of 1**, **Custom rules:
0 of 5**, **Bot Fight Mode Off**; the application has no `middleware.ts` and no
inbound rate limiter (every `throttle` in the workspace is the outbound EA API
delay in `packages/ea-client/src/client.ts`); the site is unpublished and the
tunnel offline, so nothing is operating on public traffic at all. The only
automatic mechanism in the record is Cloudflare's **Free Managed Ruleset**
("always-active/default protection"), whose actions were never recorded and
whose evidence is operator-attested, not agent-verified. *Technical capability*
— the Free plan offers one rate-limiting rule and five custom rules; none is
deployed. *Possible future behavior* — no decision to deploy any is recorded.
**No automatic rate limiter was inferred from zero configured rules.** Because
section 10 lists rate-limiting first, the sentence points at the one measure the
evidence excludes; restate as capability ("may be applied automatically by the
network and hosting services we use") or delete, and re-verify at Gate 3.

**Correction to E2G — wrong E2A citation (three locations). E2G is NOT rewritten;
this entry supersedes it on this point**, following the E2D3-item-12 convention
and the E2E3/P-17 precedent. **E2A decision 6 is "Request outcomes"**
(case-by-case correction/de-identification/removal). **E2A decision 2 is
"Governing terms"** — Alberta law, no exclusive-venue clause, mandatory
statutory rights preserved. **No E2A decision addresses arbitration, jury-trial
waiver, indemnity, liquidated damages, or a liability cap**; their exclusion
rests solely on the operator's E2G session-scope instruction. Affected: (1)
`terms-of-use-draft.md` internal blocker 4 — "per E2A decision 6, no arbitration
clause, exclusive-venue clause…"; (2) `terms-of-use-draft.md` Q-E2G-5 — "per E2A
decision 6 and the operator's E2G instructions"; (3) this file's E2G entry —
"Deliberately absent, **per E2A decision 6** and this session's scope." Correct
attribution in all three: **E2A decision 2** for governing law and no exclusive
venue; **the operator's E2G session-scope instruction** for the remainder. The
draft's revision-provenance list ("E2A decisions 1–4, 6, 7, 11, 12, 13") is
**correct** and must not be changed — decision 6 genuinely underpins public
section 6. A fourth, weaker instance is recorded as T-18: internal blocker 12
cites "E2A decision 3 / E2D3 item 8 posture" for the appearing-in-match-data-is-
not-agreement sentence, which neither entry states; it is a drafting-originated
protective statement consistent with — but not required by — those entries.

**Correction to E2G — review-status statement. E2G is NOT rewritten; this entry
supersedes it on this point.** E2G's Status line reads "Gate 2 now has four
written legal drafts and **zero** reviewed or publishable ones." That is wrong
and self-inconsistent with the same entry's own blocker-1 gloss. Corrected
statement: **Gate 2 has four written legal drafts and zero *legally reviewed* or
publishable ones.** Three of the four have had independent drafting-quality
reviews and subsequent correction passes — the Data Collection Policy
(E2D2/E2D2A → E2D4 → E2D5), the Privacy Policy (E2E2/E2E2A → E2E3), and the
EA/NHL attribution notice (E2F2/E2F2A → E2F3 → E2F4, accepted at E2F4 as a
drafting-quality checkpoint). **The Terms of Use had none until this E2G2
review.** Counsel review remains deferred and not completed for all four
(E2D3 item 14), and none of the four is publishable.

**Confirmed correct in the draft** (verified, not assumed): E2A decision 2
compliance in section 13 — Alberta law, no exclusive venue, mandatory rights
preserved — with no arbitration, indemnity, jury-waiver, liquidated-damages, or
liability-cap provision anywhere (grep-verified; seven hits, all inspected: one
false positive on "revenue", two express negations in §13, four internal
prohibitions) · no visitor-age threshold invented, adult-only membership never
converted into site eligibility, opponents expressly not treated as accepting
the Terms, and no opponent-data lawful basis inferred · "Normal search-engine
indexing is permitted" present as a bolded standalone statement, "automated
access is not prohibited as such" present, and the machine-readable-indexing
reference correctly conditional given that no `robots.txt` and no sitemap exist
under `apps/web` · public/internal boundary intact both lexically and
structurally, with the only inward pointer sitting in the status blockquote —
the identical convention already used by `privacy-policy-draft.md` and
`ea-nhl-attribution-notice-draft.md`, which survived E2F2/E2F2A/E2F3/E2F4 ·
three greppable route placeholders, two date placeholders, no `.md` link and no
`http` in public text, and no legal-page route exists under
`apps/web/src/app` to invent · `alerts@boogeymen.app` absent (0 occurrences),
`webmaster@`/`security@` split matching E2A decision 13 · section 6's "our
legitimate need to keep an accurate archival record" is **verbatim** sibling
language (`privacy-policy-draft.md:178`, `data-collection-policy-draft.md:349`),
unflagged by either of those documents' reviews, subordinated to "under
applicable law", and asserts no lawful basis — F-07/F-08 untouched · the
cross-document boundary holds on all seven checks: the Terms do not replace the
privacy/data request mechanics, do not duplicate the attribution audit, do not
reopen E2C5, claim no asset clearance, use only route placeholders, contain no
public pointer into the internal section, and do not publish
`alerts@boogeymen.app`.

**New operator questions (2).** **Q-E2G2-1** — does the Q-E2F2-1 decision (keep
express no-permission/no-clearance/missing-evidence admissions internal) extend
to section 7 of the Terms? Options: delete the clearance half of the clause
(recommended, costs nothing), or keep it and record it as a deliberate extension
so a later session does not remove it as drift. **Q-E2G2-2** — ratify or narrow
section 3's personal-copy permission relative to E2A decision 4's
"personal/noncommercial viewing"? Ratification is the expected outcome; it
should be recorded in the draft's revision provenance rather than left implicit.
Best answered together with the operator's existing Q-E2G-4.

**E2G's own four questions assessed — all genuine, none blocking the drafting
checkpoint.** Q-E2G-2 (response timing for reuse-permission requests): a real
new-commitment question, but promising nothing is the correct default and it can
stay unresolved indefinitely. Q-E2G-3 (AI/TDM crawlers): the most consequential
of the four — as drafted, training/TDM crawlers land in a permitted-by-default
gap, which may be the operator's preference but should be chosen rather than
defaulted into; it is coupled to the unbuilt Gate 3 indexing implementation
(E1F), so **the review recommends promoting it from a question to a numbered
publication blocker** (T-20). Q-E2G-4 (noncommercial community sharing): genuine,
and worth noting that the current default is *narrower* than the project's
evident purpose — a screenshot permitted "for your own personal use" arguably
does not cover posting it in the team Discord. Q-E2G-1 (routing): already tracked
as internal blocker 3 and cross-referenced to Q-E2E2-1 and the notice's blockers
9 and 15; nothing to add.

**New counsel-only questions (3), routed and not answered.** **Q-C-E2G2-1** —
does counsel want the stronger capacity formulation ("cannot grant") in the
Terms, the attribution notice, both, or neither? Moves together with the
notice's open Q-C-2. **Q-C-E2G2-2** — section 12 limits indirect/consequential
loss and carries no cap, leaving direct loss unaddressed; is that the intended
posture? **Q-C-E2G2-3** — "our legitimate need to keep an accurate archival
record" now appears verbatim in three drafts; any counsel change must be applied
to all three in one pass. The counsel questions carried from the other drafts
(applicable law F-01/F-02, opponent-data basis F-07/F-08, recording law F-30,
provider classification F-24, cookie-banner requirement, and the notice's Q-C-1
through Q-C-4) are untouched, unresolved, and neither relied on nor contradicted.
**No enforceability determination is made anywhere in the review**, and no legal
advice or legal clearance is given or implied.

**Files changed.** `docs/planning/terms-of-use-review.md` (new, 1927 lines) and
this one additive `HANDOFF.md` entry.

**Documents verified unchanged by this session.**
`docs/planning/terms-of-use-draft.md` (byte-for-byte; sha256 recorded below),
`privacy-policy-draft.md`, `privacy-policy-review.md`,
`data-collection-policy-draft.md`, `data-collection-policy-review.md`,
`ea-nhl-attribution-notice-draft.md`, `ea-nhl-attribution-notice-review.md`,
`ea-content-usage-policy-research.md`, `ea-asset-decision-memo.md`, and
`launch-page-design-prototypes.md`. No code, configuration, asset, test,
dependency, or route was touched.

**Verification run this session.** Read the complete Terms draft end to end, the
complete new review, and the complete E2G2 entry in context, plus every cited
authoritative passage (E2A in full, E2B2, E2C5, E2D3 in full, E2E3, E2F2A, E2F3,
E2F4, E2G, E1F, the Gate 2 legal-drafts checklist, attribution-review findings
A-03 and A-06, and the shared-fact passages of the privacy and data-collection
drafts). `git diff --check` clean; no trailing whitespace and no tab characters
in `terms-of-use-review.md`; `git status --short` shows exactly the pre-existing
dirty set plus the new untracked `docs/planning/terms-of-use-review.md`, with
`HANDOFF.md` the only other file this session modified; `git diff --cached
--stat` empty (nothing staged); HEAD and `origin/main` both confirmed at
`65bcddb43145d2fcffaeafb4d97d0e1a2737c35f` before and after editing;
`terms-of-use-draft.md` sha256 confirmed identical before and after
(`0027854099bde4c69f15c853843f92fe826ff6a28ea77d17f6ea6571a264e705`). Gate 2 line 152
("Draft the Terms of Use.") confirmed still `- [ ]`, and **no Gate 2 checkbox
changed.**

**Status.** **No Gate 2 checkbox changed. E2 remains IN PROGRESS.** The Terms
draft remains an initial, unpublished, legally unreviewed working draft with
twelve open publication blockers; it is now independently reviewed but **not
accepted**. Counsel review remains deferred and not completed (E2D3 item 14).
Cloudflare Web Analytics remains enabled and undone (E2B3 decision 1). Tunnel
reopening remains separately unauthorized.

**Recommended next session (one task). E2G3 —** apply the nine mechanical
corrections to `docs/planning/terms-of-use-draft.md` only: T-01 through T-05 and
T-07 in the public text, T-08 in the internal checklist. T-09 and T-10 are
HANDOFF corrections already recorded additively above and need no further action.
Hold T-06 and T-11 for the operator's answers to Q-E2G2-1 and Q-E2G2-2, exactly
as E2F3 held A-07 and A-11 for Q-E2F2-1. Bundle the optional items T-12 through
T-21 only if the operator asks; otherwise leave them for a later polish pass in
the shape of E2F4. Recount the publication blockers by enumeration afterwards.
Do not revise any other draft, resolve any public route, check a Gate 2
checkbox, conduct external legal research, reopen E2C5, or reopen the tunnel. If
the operator prefers to answer Q-E2G2-1 and Q-E2G2-2 first, that is a
decision-recording session and must not be combined with the revision pass.

### 🟡 E2G2A OPERATOR DECISIONS RECORDED — Q-E2G2-1 and Q-E2G2-2 answered; T-06 and T-11 released for the E2G3 correction pass; Terms draft still NOT accepted; no Gate 2 checkbox changed (2026-09-09)

Decision-recording session only, in the same shape as E2D3 and the Q-E2F2-1
recording inside E2F3. The operator answered the two questions E2G2 raised and
held. **Files changed by this session: this one additive `HANDOFF.md` entry —
nothing else.** `docs/planning/terms-of-use-draft.md` and
`docs/planning/terms-of-use-review.md` are **byte-for-byte unchanged**; no other
policy, review, research, memo, or prototype document was touched; no code,
configuration, asset, test, dependency, or route changed; no external research
was conducted and no external website, provider, account, host, or database was
accessed; nothing was staged, committed, pushed, published, or deployed; the
tunnel remains separately unauthorized. E2C5, E2C3, E2C4, and every prior
operator decision remain unreopened. Historical E2A–E2G2 entries are **not**
rewritten. **E2G2's verdict and counts are unchanged: the draft is still NOT
ACCEPTED; 1 BLOCKER, 10 MATERIAL CORRECTIONS, 10 RECOMMENDATIONS, 9 ACCEPTABLE
AS WRITTEN — 30 total; 11 required before acceptance (T-01 … T-11).** What
changes is only that the two held items now have operator answers and become
actionable in E2G3.

**1. Q-E2G2-1 — public clearance wording. ANSWERED: apply the Q-E2F2-1
public/internal boundary consistently to the Terms of Use.**

- In the future E2G3 correction pass, **delete this clause from public section
  7**: "or states that any particular material is licensed, cleared, or used
  with permission".
- **Keep** the preceding visitor-rights boundary: "nothing in these Terms grants
  you any rights in that material."
- This is E2G2's recommended fix for **T-06**, which is therefore no longer held
  and is now a required correction for E2G3.

Meaning of the decision:

- Express no-permission, no-clearance, and missing-evidence admissions **remain
  internal**.
- Public text **may still** state factual source attribution, non-affiliation,
  that third-party material remains subject to third-party rights, and that the
  Terms grant visitors no third-party rights.
- **Silence does not claim that anything is cleared.**
- This **changes no asset** and **does not reopen E2C5**.
- It establishes **no licence, permission, fair use, ownership, endorsement, or
  legal clearance**.

**2. Q-E2G2-2 — personal copies and limited community sharing. ANSWERED: ratify
and modestly extend E2A decision 4.** E2A decision 4 read "Personal/noncommercial
viewing and normal search-engine indexing are permitted. Disruptive bulk
scraping, dataset republication, and commercial reuse require permission."
E2G2's T-11 flagged that public section 3's saved-pages/screenshots/quoted-results
grant exceeded "viewing". The operator ratifies that grant and extends it to
ordinary community sharing. **T-11 is therefore no longer held.**

The future E2G3 public Terms **may permit**:

- private personal saved pages;
- personal screenshots;
- short quoted results or excerpts;
- ordinary limited noncommercial sharing in community contexts, such as a team
  Discord, a forum post, or a fan video;
- ordinary links to public Boogeymen pages.

A link or reasonable source credit **should be encouraged where practical, but
it is not a mandatory condition** of this permission.

Boundaries on that permission:

- It covers **limited, ordinary sharing — not republication as a dataset, data
  feed, API, database, mirror, or comparable structured compilation**.
- **Dataset republication remains permission-required regardless of whether the
  proposed dataset is commercial or noncommercial.**
- **Commercial reuse remains permission-required.**
- **Disruptive bulk scraping remains permission-required.**
- **Disruption, attacks, and circumvention of security or protective measures
  remain prohibited outright and are not available by asking permission.** (This
  is consistent with, and does not displace, E2G2's blocker **T-01**, which
  remains a required correction on its own terms.)
- **Any Boogeymen permission applies only to material Boogeymen is in a position
  to permit.** It does **not** grant rights held by EA, NHL, NHLPA, Sony,
  Microsoft, platform owners, players, teams, creators, or other third parties.
  Third-party material remains subject to third-party rights.
- **This decision does not legally clear any existing asset.**
- **E2C5 remains unchanged:** no asset removal, replacement, relocation,
  deduplication, recolouring, regeneration, renaming, hiding, or fallback switch
  is authorized.

**Q-E2G-4 is now ANSWERED by decision 2.** E2G's open question on noncommercial
community sharing — and E2G2's observation that a screenshot permitted "for your
own personal use" arguably did not cover posting it in the team Discord — is
resolved by the permission and boundaries recorded above.

**Still unresolved after this session (no answer is recorded and none may be
inferred).**

- **Q-E2G-2** — response times for reuse-permission requests. **No response
  deadline is adopted.** Promising nothing remains the default.
- **Q-E2G-3** — AI-training / TDM / dataset-building crawlers. Unresolved. E2G2's
  recommendation to promote it to a numbered publication blocker (T-20) is
  neither adopted nor rejected here.
- **Q-E2G-1** — public routes for the legal pages. Unresolved; still tracked as
  the draft's internal blocker 3 and cross-referenced to Q-E2E2-1.
- **Q-E2G-5** and all counsel-only questions — **Q-C-E2G2-1, Q-C-E2G2-2,
  Q-C-E2G2-3**, plus the counsel questions carried from the other drafts
  (applicable law F-01/F-02, opponent-data basis F-07/F-08, recording law F-30,
  provider classification F-24, the cookie-banner requirement, and the notice's
  Q-C-1 through Q-C-4) — remain unresolved, untouched, and neither relied on nor
  contradicted. Counsel review remains deferred and not completed (E2D3 item 14).

**Status.** **No Gate 2 checkbox changed. E2 remains IN PROGRESS.** The Terms
draft **remains byte-for-byte unchanged and is not accepted**; it will not be
accepted until E2G3 applies the required corrections. It is still an
unpublished, legally unreviewed working draft with twelve open publication
blockers. Cloudflare Web Analytics remains enabled and undone (E2B3 decision 1).
Tunnel reopening remains separately unauthorized. **No legal advice, licence,
permission, fair use, ownership, endorsement, or legal clearance is given or
implied by this entry.**

**Verification run this session.** Read `AGENTS.md`, the complete E2G2 entry,
E2G's question set, E2A decision 4, and the complete new E2G2A entry in context.
`git diff --check` clean; `git status --short` shows exactly the pre-existing
dirty set with `HANDOFF.md` the only file this session modified; `git diff
--cached --stat` empty (nothing staged); HEAD and `origin/main` both confirmed at
`65bcddb43145d2fcffaeafb4d97d0e1a2737c35f` before and after editing;
`terms-of-use-draft.md` sha256 confirmed identical before and after
(`0027854099bde4c69f15c853843f92fe826ff6a28ea77d17f6ea6571a264e705`) and
`terms-of-use-review.md` likewise
(`becb43efac383aee2bef66f9bf6138c38d92c826de320a27c1411018adfa5f61`). Gate 2 line
152 ("Draft the Terms of Use.") confirmed still `- [ ]`, and **no Gate 2
checkbox changed** — all 95 `- [ ]`/`- [x]` checklist lines in this file are
byte-identical to HEAD (the only `[ ]` token this entry adds is the quoted one
in the sentence above).

**Recommended next session (one task). E2G3 —** the correction pass on
`docs/planning/terms-of-use-draft.md` only, now covering **eleven** required
items rather than nine: T-01 through T-05 and T-07 in the public text, T-08 in
the internal checklist, **T-06** applying decision 1 above (delete the
"licensed, cleared, or used with permission" clause from public section 7, keep
the visitor-rights sentence), and **T-11** applying decision 2 above (ratify the
personal-copy grant and extend it to ordinary limited noncommercial community
sharing, with the dataset/commercial/scraping/disruption boundaries and the
third-party-rights limiter stated in the public text). T-09 and T-10 are HANDOFF
corrections already recorded additively in E2G2 and need no further action.
Record decisions 1 and 2 in the draft's revision provenance. Bundle the optional
items T-12 through T-21 only if the operator asks. Recount the publication
blockers by enumeration afterwards. Do not revise any other draft, resolve any
public route, check a Gate 2 checkbox, conduct external legal research, reopen
E2C5, or reopen the tunnel.

### 🟡 E2G3 TERMS OF USE CORRECTED — nine remaining draft corrections applied; drafting-quality checkpoint accepted; blocker count unchanged at twelve; no Gate 2 checkbox changed (2026-09-09)

Correction-pass session following E2G2/E2G2A, in the same shape as E2D4,
E2E3, and E2F3. **Files changed by this session:
`docs/planning/terms-of-use-draft.md` and this one additive `HANDOFF.md`
entry — nothing else.** `docs/planning/terms-of-use-review.md` is
byte-for-byte unchanged (sha256 confirmed identical to the hash recorded at
E2G2/E2G2A:
`becb43efac383aee2bef66f9bf6138c38d92c826de320a27c1411018adfa5f61`); the
privacy, data-collection, and attribution drafts and reviews, the EA
content-usage research, the asset decision memo, and the launch-page
prototypes are all unchanged (sha256-verified against this session's own
read). No external legal research was conducted; no external website,
provider, account, host, or database was accessed; no code, configuration,
asset, test, dependency, or route changed; nothing was staged, committed,
pushed, published, or deployed; the tunnel remains separately unauthorized.
E2C5, E2C3, and E2C4 remain unreopened. Historical E2G, E2G2, and E2G2A
entries are **not** rewritten.

**Correction-count accounting (correcting E2G2A's inaccurate wording
additively, without rewriting it).** E2G2 originally identified eleven
required findings, T-01 through T-11. Of those: **T-09 and T-10** were
HANDOFF-only corrections (the wrong-E2A-citation fix and the "zero reviewed"
status-line fix) already completed additively by E2G2 itself and needed no
further action. **E2G2A** then released the two held items, **T-06** (per
Q-E2G2-1) and **T-11** (per Q-E2G2-2), for this session. That leaves exactly
**nine** remaining Terms-draft corrections for E2G3: **T-01, T-02, T-03,
T-04, T-05, T-06, T-07, T-08, and T-11.** E2G2A's recommended-next-session
sentence said E2G3 would cover "eleven required items rather than nine" —
that arithmetic is wrong (11 total − 2 already done = 9, not 11), and this
entry corrects it here rather than by editing E2G2A's text.

**All nine corrections applied to `docs/planning/terms-of-use-draft.md`.**

- **T-01** (section 4, first bullet) — rewritten to separate
  permission-required volume from prohibited conduct. The bullet now reads
  "Systematic or high-volume bulk automated collection," states this is not
  a blanket ban on automation and does not touch ordinary search-engine
  crawling (permitted under section 3), and states explicitly that conduct
  which actually degrades, overloads, disrupts, or circumvents rate limits
  or protective measures is prohibited outright under section 5 and is
  **not** available by asking permission. Section 5 itself was not touched
  or softened.
- **T-02** (section 4, second bullet) — deleted "— in whole or in
  substantial part —". Dataset/feed/API/database/mirror/comparable
  structured-compilation republication now requires permission regardless
  of amount, and the bullet states it applies "whether the republication is
  commercial or noncommercial" and does not cover the personal use, quoting,
  and limited community sharing permitted in section 3.
- **T-03** (same bullet's heading) — renamed "Republishing our information
  as a dataset" to "Republishing information from this site as a dataset,"
  removing the possessive/ownership implication over factual match data.
- **T-04** (section 4, closing paragraph) — replaced "We cannot give you
  permission for third-party material" with the scope formulation "Our
  permission is ours alone: it is not permission from anyone else who holds
  rights in material appearing on this site," preserving the preceding "only
  the material we are actually in a position to permit" limiter.
- **T-05** (section 3, new "Third-party rights" paragraph) — added beside
  the use permission: Boogeymen grants the section 3 permissions only to the
  extent it is actually in a position to do so; third-party material remains
  subject to third-party rights; the permission does not grant rights held
  by EA, NHL, NHLPA, Sony, Microsoft, platform owners, players, teams,
  creators, or other third parties; and a public-to-public cross-reference
  to section 7 (never a pointer into the internal section).
- **T-06** (section 7, applying E2G2A decision 1) — deleted "or states that
  any particular material is licensed, cleared, or used with permission"
  from the third-party paragraph. Kept "nothing in these Terms grants you
  any rights in that material." Express no-permission/no-clearance/
  missing-evidence admissions remain internal; the public text makes no
  positive clearance claim and none was added.
- **T-07** (section 10) — deleted "Some of these measures are automatic";
  the sentence now reads only "These measures may be temporary," per the
  review's preferred resolution. No automatic rate limiter, automatic
  blocking, or deployed behavior is claimed. No new blocker was added — the
  claim was simply removed, exactly as directed.
- **T-08** (internal blocker 4 and Q-E2G-5) — corrected the authority
  citations. Both now state that **E2A decision 2** ("Governing terms")
  supports Alberta governing law and the absence of an exclusive-venue
  clause, and that **the operator's E2G session-scope instruction** — not
  E2A decision 6 — excluded arbitration, jury-trial waiver, indemnity,
  liquidated damages, and a liability-cap figure, with no E2A decision
  covering that group. E2A decision 6 ("Request outcomes") is noted as
  correctly supporting section 6 and was left in the revision-provenance
  list, unremoved.
- **T-11** (section 3, applying E2G2A decision 2) — section 3 rewritten
  into labeled parts: **Linking** (its own sentence, not limited to
  personal/noncommercial actors — this is also as much of **T-12** as this
  session applies, per the task's scope); **Personal copies and quotes**
  (saved pages, screenshots, short quoted results/excerpts, personal/
  noncommercial); **Limited community sharing** (ordinary, limited,
  noncommercial sharing such as a team Discord, a forum post, or a fan
  video, with a link or credit "encouraged where practical" but stated as
  **not** a condition); and a boundary paragraph restating that none of
  this permits dataset/feed/API/database/mirror/comparable
  structured-compilation republication, commercial reuse, or systematic/
  high-volume bulk collection (section 4), and that disruption/circumvention
  remains prohibited outright under section 5 "regardless of purpose or
  permission." The **Third-party rights** paragraph (T-05) sits directly
  beside this. E2C5 was not reopened and no asset was touched or implied
  cleared.

**Bookkeeping also completed, as required.** Added an **E2G2A** entry and an
**E2G3** entry to the draft's Revision provenance, the E2G3 entry listing all
nine active corrections by number and noting T-09/T-10 needed no action and
T-13–T-21 remain optional and unapplied. Updated the document's status line
and Gate 2 status wording from "initial working draft" to **"revised working
draft"** / **drafting-quality checkpoint**, while leaving the historical E2G
(2026-09-09) provenance entry's own "initial working draft" description of
what E2G produced unchanged. Updated the internal review-history sentence in
blocker 1: it now states plainly that E2G2 performed independent, non-legal
issue-spotting, E2G2A recorded operator decisions, and E2G3 applied the
required corrections — and that **neither E2G2 nor E2G3 is a legal review**.
Recounted the twelve publication blockers by enumeration (1 through 12, all
still present and open — items 1 and 4 revised for accuracy, none added or
removed); the bolded "twelve" count needed no change. Updated the internal
Gate 2 status paragraph consistently with the above.

**Drafting-quality checkpoint: ACCEPTED, not legally reviewed, not
publishable.** All eleven of E2G2's originally required findings (T-01
through T-11) are now applied — T-09/T-10 by E2G2, the remaining nine by
E2G2A's release and this session's correction pass — and no new defect was
found while applying them. Following the same pattern E2F4 used for the
attribution notice, the draft is accepted here as a **drafting-quality
checkpoint only**: not legal clearance, not legal advice, not publishable
text, and not a Gate 2 checkbox change. All twelve publication blockers
remain open, counsel review remains deferred and not completed (E2D3 item
14), and Cloudflare Web Analytics remains enabled and undone (E2B3 decision
1).

**Section 3's final permission and boundaries (public text).** Personal/
noncommercial reading, viewing, and browsing; linking to public Boogeymen
pages (unqualified); personal saved pages, screenshots, and short quoted
results/excerpts; ordinary limited noncommercial community sharing (team
Discord, forum post, fan video), with link/credit encouraged but not
mandatory; explicitly **not** covering dataset/feed/API/database/mirror/
comparable structured-compilation republication, commercial reuse, or
systematic/high-volume bulk collection (all section 4, permission-required);
explicitly **not** covering disruption, attacks, or circumvention of
security/rate-limiting/protective measures (section 5, prohibited outright,
no exception for permission); and a third-party-rights limiter naming EA,
NHL, NHLPA, Sony, Microsoft, platform owners, players, teams, and creators,
cross-referencing public section 7. Normal search-engine indexing remains
permitted, restated unchanged from the prior draft.

**Section 4/section 5 boundary (public text), corrected.** Section 4 no
longer offers permission for conduct section 5 prohibits: its first bullet
now covers only permission-required *volume* (systematic/high-volume bulk
automated collection), and states twice — once in the bullet, once by
cross-reference from section 3 — that actual disruption, overload, or
circumvention of rate limits/protective measures is prohibited outright
under section 5 and is not curable by asking permission. Section 5's text
itself is untouched.

**E2A authority attribution (internal text), corrected.** Internal blocker 4
and Q-E2G-5 now correctly cite **E2A decision 2** for Alberta governing law
and the absence of an exclusive-venue clause, and **the operator's E2G
session-scope instruction** (not E2A decision 6) for excluding arbitration,
jury-trial waiver, indemnity, liquidated damages, and a liability-cap
figure — with E2A decision 6 left correctly attributed to section 6 in the
revision-provenance list, per the review's finding. The parallel citation in
this file's own historical E2G2 entry is not rewritten; E2G2 already
superseded the original E2G entry on this point without rewriting it, and
that correction stands independently of this session.

**Resulting blocker count: twelve, unchanged.** No blocker was added or
removed by this pass; items 1 and 4 were revised for accuracy (review
history and authority citation respectively), and the bolded "twelve" in
the draft's own text needed no correction.

**Not applied, left for later.** T-12 was applied only to the extent needed
to give linking its own unqualified sentence in section 3, per the task's
explicit scope; the rest of T-12 and all of **T-13 through T-21** remain
unapplied, left for an optional E2G4 polish session. **Note for that
session:** the draft's own Q-E2G-4 text still reads "undecided" — it was not
touched this session because it fell outside the nine required corrections
— but it is now stale, since section 3's new community-sharing permission
(T-11) substantively answers it, matching what E2G2A already recorded at the
HANDOFF level ("Q-E2G-4 is now ANSWERED by decision 2"). Updating that
sentence in the draft is in-scope for a future polish pass, not this one.

**Unresolved questions, untouched.** **Q-E2G-1** (routing), **Q-E2G-2**
(response timing), **Q-E2G-3** (AI/TDM crawlers), and **Q-E2G-5** (counsel,
now correctly attributed per T-08 but still otherwise open) remain
unresolved. All counsel-only questions — **Q-C-E2G2-1, Q-C-E2G2-2,
Q-C-E2G2-3**, plus those carried from the other drafts (applicable law
F-01/F-02, opponent-data basis F-07/F-08, recording law F-30, provider
classification F-24, the cookie-banner requirement, and the attribution
notice's Q-C-1 through Q-C-4) — remain unresolved, untouched, and neither
relied on nor contradicted. Counsel review remains deferred and not
completed (E2D3 item 14). **No legal advice, licence, permission, fair use,
ownership, endorsement, or legal clearance is given or implied by this
entry or by the draft it describes.**

**No Gate 2 checkbox changed.** Gate 2 line 152 ("Draft the Terms of Use.")
confirmed still `- [ ]` before and after this session; no other Gate 2
checkbox was touched.

**Verification run this session.** Read the complete revised Terms draft
end to end, and the complete new E2G3 entry in context, plus `AGENTS.md` in
full, the complete E2G2 and E2G2A entries, and the Gate 2 legal-drafts
checklist. `git diff --check` clean; zero trailing-whitespace lines and zero
tab characters in `terms-of-use-draft.md`; `git status --short` shows
exactly the pre-existing dirty set (`HANDOFF.md` modified,
`launch-page-design-prototypes.md` modified, the nine other `docs/planning/`
files untracked) with `terms-of-use-draft.md` remaining untracked as at
session start and `HANDOFF.md` the only tracked file this session modified;
`git diff --cached --stat` empty (nothing staged); HEAD and `origin/main`
both confirmed at `65bcddb43145d2fcffaeafb4d97d0e1a2737c35f` before and after
editing. `docs/planning/terms-of-use-review.md` sha256 confirmed identical
to the E2G2/E2G2A hash
(`becb43efac383aee2bef66f9bf6138c38d92c826de320a27c1411018adfa5f61`); the
privacy, data-collection, and attribution drafts/reviews, the EA
content-usage research, the asset decision memo, and the launch-page
prototypes were all confirmed unchanged. Forbidden-phrase checks against the
public Terms text (everything above the "Internal drafting and publication
checks" heading) confirm zero occurrences of "in whole or in substantial
part", "Republishing our information", "We cannot give you permission",
"licensed, cleared, or used with permission", "Some of these measures are
automatic", and `alerts@boogeymen.app`; the removed phrases appear only
inside the internal Revision provenance entry describing what was removed.
Confirmed no public section points into the internal section, and that
section 3's new cross-reference to section 7 is public-to-public. Confirmed
no arbitration, exclusive-venue, indemnity, jury-waiver, liquidated-damages,
liability-cap, invented route, age threshold, or blanket ownership/clearance
provision was added anywhere in the public text.

**Status.** **No Gate 2 checkbox changed. E2 remains IN PROGRESS.** The
Terms draft is now a revised working draft, independently reviewed and
corrected, **accepted as a drafting-quality checkpoint only** — not legally
reviewed and not publishable. Counsel review remains deferred and not
completed (E2D3 item 14). Cloudflare Web Analytics remains enabled and
undone (E2B3 decision 1). Tunnel reopening remains separately unauthorized.

**Recommended next session (one task, optional). E2G4 —** a final
drafting-quality polish pass on `docs/planning/terms-of-use-draft.md`, in
the shape of E2F4: consider T-13 through T-21 and the rest of T-12, and
update the now-stale Q-E2G-4 "undecided" text to reflect that E2G2A already
answered it. Not required before any other Gate 2 work proceeds. Do not
combine it with resolving Q-E2G-1/Q-E2G-3, with Gate 3 routing work, or with
any other draft.

### 🟡 E2G4 TERMS OF USE FINAL DRAFTING-QUALITY POLISH — decision-free optional findings applied; blocker count now fourteen; no Gate 2 checkbox changed (2026-09-09)

Final, optional drafting-quality polish session following E2G3, in the same
shape as E2F4 for the attribution notice. **Files changed by this session:
`docs/planning/terms-of-use-draft.md` and this one additive `HANDOFF.md`
entry — nothing else.** `docs/planning/terms-of-use-review.md` is
byte-for-byte unchanged (sha256 confirmed identical to the hash recorded at
E2G2/E2G2A/E2G3:
`becb43efac383aee2bef66f9bf6138c38d92c826de320a27c1411018adfa5f61`); the
privacy, data-collection, and attribution drafts and reviews, the EA
content-usage research, the asset decision memo, and the launch-page
prototypes are all unchanged (confirmed this session by re-reading and, for
the untracked planning files, by hashing). No external legal research was
conducted; no external website, provider, account, host, or database was
accessed; no Cloudflare inspection or change; no logging inventory; no
prototype ZIP extraction; no code, configuration, asset, test, dependency,
or route changed; nothing was staged, committed, pushed, published, or
deployed; the tunnel remains separately unauthorized. E2C5, E2C3, and E2C4
remain unreopened. Historical E2G, E2G2, E2G2A, and E2G3 entries are **not**
rewritten.

**Findings applied (all decision-free, per the task's explicit scope).**

- **T-12 — confirmed already complete, not re-applied.** E2G3 already gave
  linking its own unqualified sentence in section 3 ("**Linking.** You may
  link to our public pages."). This session made no further edit to it and
  recorded, in the draft's own revision provenance, that it is reviewed and
  needs no change — avoiding pure churn.
- **T-13 (section 3, indexing paragraph).** "This site's public pages"
  replaced with "the pages we make available for indexing"; the invented
  "sort" URL-variant example removed, leaving the accurate "filter and
  pagination URLs"; the conditional "where we publish machine-readable
  indexing instructions" framing preserved unchanged, since no `robots.txt`
  or sitemap is deployed. Added new publication **blocker 13**, requiring
  this paragraph to be re-verified against the deployed `robots.txt`,
  sitemap, canonical metadata, `noindex` behavior, and the E1F indexing
  decisions before publication.
- **T-14 — reviewed and accepted without edit.** Section 7's non-affiliation
  sentence is already unmistakably Boogeymen's own generic statement (the
  review's option (b)) and already points to the attribution notice for
  EA's specified wording. No duplicate of EA's standalone statement was
  added anywhere in this draft; the sentence is unchanged.
- **T-15 (section 11).** "…beyond what is stated in these Terms" replaced
  with "…and we make no other warranties or representations about it." The
  following mandatory-law paragraph is untouched.
- **T-16 (section 1).** "please do not use the site" changed to "do not use
  the site." The second paragraph (appearing in match data is not
  acceptance) is untouched. Browse-wrap enforceability remains a
  counsel/Gate 3 question; internal blocker 12 now connects that review to
  the still-undecided Gate 3 footer/route placement (Q-E2G-1) rather than
  treating it as a pure text question.
- **T-17 (authentication maintenance condition).** Added to internal blocker
  6 (the cross-document-consistency blocker, per the task's stated
  preference for an auditable addition over a new blocker number): if
  authentication is ever activated, public sections 2 and 10 must be
  reviewed and revised in the same coordinated pass as the Data Collection
  Policy's required fresh privacy review. The currently accurate public
  no-account wording in sections 2 and 10 is untouched.
- **T-18 (internal blocker 12's citation).** Corrected so it no longer
  claims E2A decision 3 and E2D3 item 8 directly require section 1's
  "appearing in match data is not agreement" sentence. That sentence is now
  described as a drafting-originated protective statement, consistent with
  — but not required by — E2A decision 3 and E2D3 item 8; not itself the
  subject of a separate operator decision; preserved unless a later
  operator or counsel review changes it.
- **T-19 (section 2).** "Identifiers" replaced with "gamertags and related
  identifiers," so the sentence no longer implies raw EA-internal
  identifiers are necessarily displayed publicly.
- **T-20 (AI/TDM publication blocker).** Added new publication **blocker
  14**, requiring an explicit operator decision before publication on
  whether AI-training, text-and-data-mining, and dataset-building crawlers
  are permitted normal indexing, permission-required, or prohibited, and
  requiring the eventual decision to be expressed consistently in the
  public Terms, `robots.txt`/crawler instructions, and sitemap/indexing
  controls. **Q-E2G-3 itself was left unresolved**, as instructed, and now
  cross-references blocker 14.
- **T-21 (section 9).** Added: "This does not affect the notice we give for
  material changes to these Terms — see section 14." A public-to-public
  pointer; section 14's material-change-notice commitment is unweakened.

**Stale Q-E2G-4 corrected.** The internal Q-E2G-4 paragraph no longer reads
"undecided." It is moved out of the unresolved-question list into a new
"Resolved questions" subsection and marked **ANSWERED**: **E2G2A decision
2** ratified and extended section 3's permission to ordinary limited
noncommercial community sharing, and **E2G3** applied that decision
publicly. The corrected text states that ordinary limited noncommercial
community sharing is permitted; that a link or reasonable credit is
encouraged where practical but not mandatory; that dataset republication,
commercial reuse, and systematic/high-volume bulk collection remain
permission-required; that disruption, attacks, and circumvention remain
prohibited; and that third-party rights are unaffected.

**Bookkeeping also completed, as required.** Added an **E2G4** entry to the
draft's Revision provenance, listing every finding applied by number. Added
the header's mention of E2G4 to the document's status blockquote and to
internal blocker 1's review-chain sentence, consistent with the pattern
E2F4 used for the attribution notice. Recounted the publication blockers by
enumeration (1 through 14): blocker 6 gained the T-17 authentication-
maintenance addition and blocker 12 was reworded for T-16/T-18 — neither is
a new blocker number; blockers 13 and 14 are new (T-13, T-20); no blocker
was removed. Updated the "There are **fourteen** publication blockers"
intro line and the Gate 2 status paragraph consistently. Preserved the
drafting-quality-checkpoint status throughout; no legal clearance or
publication readiness is claimed anywhere in this pass.

**Resulting blocker count: fourteen, up from twelve.** Two blockers were
added — **13** (T-13's indexing-paragraph re-verification against deployed
`robots.txt`/sitemap/canonical/`noindex`/E1F decisions) and **14** (T-20's
required operator decision on AI/TDM crawler treatment, expressed
consistently across the Terms, `robots.txt`, and sitemap/indexing
controls). No blocker was removed. Blockers 6 and 12 were revised in place
(T-17 and T-16/T-18 respectively) without changing the count.

**Remaining operator questions.** **Q-E2G-1** (Gate 3 routing), **Q-E2G-2**
(response timing for section 4 permission requests), and **Q-E2G-3**
(AI/TDM crawler treatment, now also publication blocker 14) remain
unresolved and untouched by this session, exactly as instructed.

**Remaining counsel questions.** **Q-E2G-5** and all counsel-only questions
carried from the other drafts (applicable law F-01/F-02, opponent-data
basis F-07/F-08, recording law F-30, provider classification F-24, the
cookie-banner requirement, and the attribution notice's Q-C-1 through Q-C-4)
remain unresolved, untouched, and neither relied on nor contradicted.
Counsel review remains deferred and not completed (E2D3 item 14). **No
legal advice, licence, permission, fair use, ownership, endorsement, or
legal clearance is given or implied by this entry or by the draft it
describes.**

**No Gate 2 checkbox changed.** Gate 2 line 152 ("Draft the Terms of Use.")
confirmed still `- [ ]` before and after this session; no other Gate 2
checkbox was touched.

**Verification run this session.** Read the complete revised Terms draft end
to end, and this complete E2G4 entry in context, plus `AGENTS.md` in full,
and the E2G2/E2G2A/E2G3 entries and Gate 2 legal-drafts checklist for
baseline context. `git diff --check` clean (exit 0); zero trailing-whitespace
lines and zero tab characters in `terms-of-use-draft.md`; `git status
--short` shows exactly the pre-existing dirty set (`HANDOFF.md` modified,
`launch-page-design-prototypes.md` modified, the ten other `docs/planning/`
files untracked, including `terms-of-use-draft.md` and
`terms-of-use-review.md` as at session start) with `HANDOFF.md` the only
tracked file this session modified; `git diff --cached --stat` empty
(nothing staged); HEAD and `origin/main` both confirmed at
`65bcddb43145d2fcffaeafb4d97d0e1a2737c35f` before and after editing.
`docs/planning/terms-of-use-review.md` sha256 confirmed identical to the
E2G2/E2G2A/E2G3 hash
(`becb43efac383aee2bef66f9bf6138c38d92c826de320a27c1411018adfa5f61`); every
other planning document was confirmed unchanged this session. The Gate 1/
Gate 2 checklist block of `HANDOFF.md` (the 95 checklist lines referenced by
this task) was diffed against `git show HEAD:HANDOFF.md` and found
byte-identical, and the Gate 2 "Draft the Terms of Use" checkbox is
confirmed `- [ ]` in both. Forbidden-phrase checks against the public Terms
text confirm zero occurrences of "please do not use the site", "beyond what
is stated in these Terms", and `alerts@boogeymen.app`; "sort" appears only
inside the internal E2G4 provenance narration describing its removal, not
in the public indexing paragraph. Confirmed "Normal search-engine indexing
is permitted" is preserved, "gamertags and related identifiers" is present
in section 2, and section 9 now contains "…see section 14." Confirmed no
public section points into the internal section, and that no arbitration,
exclusive-venue, indemnity, jury-waiver, liquidated-damages, liability-cap,
invented age threshold, route, ownership, permission, or clearance claim was
added anywhere in the public text (the pre-existing "under-13" language in
blocker 11 is unchanged internal guardrail text, not a new public
threshold).

**Status.** **No Gate 2 checkbox changed. E2 remains IN PROGRESS.** The
Terms draft carries all applicable optional E2G2 findings (T-12 through
T-21) resolved — eight applied as edits (T-13, T-15 through T-21), one
confirmed already complete without re-edit (T-12), and one reviewed and
accepted without edit (T-14) — and remains **accepted as a drafting-quality
checkpoint only**, not legally reviewed and not publishable. Fourteen
publication blockers remain open, counsel review remains deferred and not
completed (E2D3 item 14), and Cloudflare Web Analytics remains enabled and
undone (E2B3 decision 1). Tunnel reopening remains separately unauthorized.

**Recommended next session.** A fresh Stage E2 reconciliation/status-review
session: with all four Gate 2 legal drafts (Data Collection Policy, Privacy
Policy, attribution notice, Terms of Use) now through their respective
independent-review-and-polish passes, the next session should take stock of
E2 as a whole — current blocker counts across all four documents, the
outstanding operator questions (routing, response timing, AI/TDM posture),
and what remains before counsel review — rather than opening new drafting
work on any single document. Do not combine it with resolving Q-E2G-1/
Q-E2G-3, with Gate 3 routing work, or with reopening the tunnel.

### 🟢 E1K FINAL OPERATOR DECISIONS RECORDED — E1 COMPLETE; E2 requires a fresh Codex session (2026-09-08)

A read-only audit session (this one's immediate predecessor) reviewed the two
remaining open E1 items — the external game-sheet frontend and the three
small polish items — and reported findings with evidence for each. The
operator reviewed that audit and approved the four decisions below. **This
entry documents those decisions only; it does not implement any of them.**

**1. External game-sheet frontend — accepted as already integrated.**

- The only repository artifact matching "externally built game-sheet
  frontend" is the ignored/untracked `Game sheet prototype layout (1)/`
  Claude Design export at repo root (never tracked, not touched by this
  entry).
- Production code explicitly cites this folder/design as its source — e.g.
  `top-nav.tsx`'s doc-comment names
  `Game sheet prototype layout (1)/Game Sheet copy.dc.html` directly.
- The matching implementation landed through the July/August game-sheet
  revamp commits, including: the header, the navbar, the lineup module, the
  head-to-head drawer behavior, Top Performers, the DtW gauge, the box
  score, the event timeline, the action tracker, and a dedicated
  responsive/accessibility/contrast pass.
- HANDOFF's own Frontend section already states the 12-phase game-sheet
  revamp is complete and committed (see "## Repo State" → "### Frontend"
  below).
- **Therefore there is no separate October integration decision or
  duplicate port remaining**, unless the operator later identifies a
  genuinely different artifact not represented in this repository.
- This closes as **accepted / already integrated** — E1K did not newly
  implement, port, or modify any game-sheet code. The ignored prototype
  directory remains untouched and untracked.

**2. Opponent player-score completeness — explicitly deferred as "no known
defect."**

- The tracked `opponent_player_match_stats` schema contains the scoring
  inputs the formula needs.
- The query layer does not intentionally discard those inputs.
- The shared score-building path (`buildAllTeamScores` / `toEntry` /
  `skaterBreakdown` / `goalieBreakdown`) applies the identical scoring
  formula to both BGM and opponent rows.
- Opponent performer rows render the same score breakdown BGM rows do.
- Two differences remain, both intentional: no opponent roster-profile link
  (opponents have no profile page), and no opponent season-average
  comparison (opponent season history is not stored).
- No reproducible missing-score defect, failing test, TODO, or documented
  failing match was found in tracked code or in HANDOFF.
- **This is not a claim of exhaustive runtime proof** — it is a
  documentation-review finding. Reopen only if a concrete failing
  match/screen is identified.

**3. Top Performers contrast — the specific recorded defect is closed as
already resolved.**

- The prototype's review recorded the old `--fg-5` value `#514E4F` at
  approximately 2.15:1 contrast — a real WCAG AA failure at the time it was
  written.
- The live global tokens are now `--color-fg-4: #8e8b8c` (~5.6:1) and
  `--color-fg-5: #7f7c7d` (~4.6:1) (`apps/web/src/app/globals.css`), shipped
  as part of the game-sheet revamp's accessibility/contrast pass.
- This closes the **specific recorded defect** only. It does not claim every
  dynamic opponent/team color combination (e.g. per-club `--opp`/`--opp-soft`
  pairings) has received a complete visual contrast audit — that remains an
  optional later spot-check, not an E1 blocker.

**4. Navbar/masthead game-title label — decided to be removed, as later UI
work.**

- The audited element is the repeated `gameTitle.name` title-context label
  displayed beside/under the "Boogeymen" masthead heading on top-level
  pages (`/`, `/games`, `/roster`, `/stats`) — **not** a component literally
  named "navbar subtitle"; no such component exists.
- Decision: remove this label during later UI implementation work.
- Boogeymen remains the site/product identity; NHL 27 remains the approved
  default data context (see the "E1J" entry above). Title context stays
  available through the existing title filters and each page's own content
  — removing this one repeated label does not remove the site's ability to
  show or filter by game title.
- **The actual UI removal is not performed by this entry** and remains open
  implementation work (tracked under later product-readiness polish, not a
  new E1/E2/E3/E4/E5 subsection of its own).

**E1 status: COMPLETE.** E1A through E1K have now recorded every operator
decision E1 required (hosting/backup, domain, cost accounting, Proton
capacity, deployment/staging/secrets/rollback model, indexing policy,
privacy/retention/repository visibility, GitHub privacy execution, hosting
cost + termination map, NHL 26/27 cutover + career-stitching policy, and now
the game-sheet frontend + three polish items above). **Completing E1 does
not complete Gate 2 and does not launch the site** — Gate 2 still has
multiple unrelated unchecked items (product-readiness audits, Gate 1
verification carry-forwards already checked above, etc.), and Gate 3 has not
started. E2 (legal drafts, plus optional early Gate 3 web work) is the next
phase and remains **NOT STARTED**. **Per operator instruction, E2 must begin
in a fresh Codex session** — not a continuation of this one.

### 🟢 E1J NHL 26/27 CUTOVER + CAREER-STITCHING POLICY DECIDED — implementation and E5 verification remain open (2026-09-08)

Policy/decision session only, following a read-only E1 audit of NHL 26/NHL 27
title selection, ingestion overlap, cutover behavior, URLs, and career-stat
stitching. **No SQL was run, no title was activated or deactivated, no
worker/frontend code or schema changed, and no host, EA, or live database was
accessed.** This entry records operator-approved decisions; it does not
implement them.

**Baseline this decision was made against:** the last recorded database state
(see the "NHL 27 ENABLED" Active State entry, 2026-09-05/06) — both `nhl26`
and `nhl27` rows are `is_active=true` on both hosts, and `nhl27`'s numeric id
is higher than `nhl26`'s on both (main: 7>1, Hotel-Echo: 5>4). Because
`game_titles.is_active` currently drives both the worker's poll filter
(`apps/worker/src/ingest.ts:44`) and the frontend's default-title selection
(`packages/db/src/queries/game-titles.ts:10-16`, taken as `[0]` by
`apps/web/src/app/page.tsx`, `apps/web/src/app/games/page.tsx`, and
`apps/web/src/lib/title-resolver.ts`), this baseline mechanically makes NHL 27
the current frontend default. **This entry does not change that state** — no
`is_active` update is authorized or proposed here, because flipping it off for
`nhl27` alone would also stop NHL 27 ingestion (the same column controls
both), and flipping it off for `nhl26` before the resolver fixes below exist
would break archive selection unevenly across the four surfaces: `/stats` and
`/roster` go through `apps/web/src/lib/title-resolver.ts`, which checks
active titles and then falls back to archive titles via
`getArchiveGameTitleBySlug()`, so explicit `?title=nhl26` selection there
should keep working once `nhl26` is inactive; but `/`
(`apps/web/src/app/page.tsx`) and `/games` (`apps/web/src/app/games/page.tsx`)
each resolve titles locally against *active* titles only, with no archive
fallback, so `nhl26` would stop resolving/being selectable there the moment
it goes inactive. Implementation must consolidate/fix `/` and `/games`
specifically (see §2's resolver-gap note) before `nhl26` is deactivated for
ingestion — not all four routes, since `/stats`/`/roster` already handle this
correctly.

**1. Title lifecycle and ingestion — approved:**

- NHL 26 is **deprecated for automatic ingestion**: no new NHL 26 matches
  should be collected by the worker's automatic polling going forward.
- NHL 27 is the only title intended for automatic (worker-polled) ingestion
  going forward.
- NHL 26 remains available as **historical/archive content** on the site — it
  is not being deleted, hidden, or dropped from the schema.
- The operator continues collecting final, manually reviewed NHL 26 data
  through the existing historical workflow already used for NHL 19–25
  (hand-reviewed historical season/team stats import, not automatic EA
  polling).
- This is a policy decision only. The current recorded database state still
  has both `nhl26` and `nhl27` at `is_active=true`; nothing was run to change
  that. Do not treat this entry as evidence that NHL 26 has stopped polling —
  it has not, pending the implementation work in §3.

**2. Default website behavior and branding — approved:**

- NHL 27 games and statistics are the **approved default content** when no
  title filter is selected on `/`, `/games`, `/stats`, and `/roster`.
- The website and navbar remain branded as the **Boogeymen** site. The
  site/navbar must not be renamed or prominently rebranded as "NHL 27" — the
  game title is content-scoped, not the product identity.
- Existing `?title=` filters remain the mechanism for distinguishing NHL 26,
  NHL 27, and historical (NHL 19–25) titles; no new selector concept is
  required by this decision.
- NHL 26 must remain **selectable as archive/history** on all four surfaces
  above.
- **Known implementation gap, not fixed by this entry:** `/`
  (`apps/web/src/app/page.tsx:46-57`) and `/games`
  (`apps/web/src/app/games/page.tsx:53-65`) each implement their own local
  title-resolution logic that only checks *active* titles by slug and does
  not fall back to archive titles the way the shared
  `apps/web/src/lib/title-resolver.ts` (used by `/stats`, `/roster`) does.
  Concretely, `?title=nhl24` today resolves correctly on `/stats`/`/roster`
  but not on `/` or `/games`. This must be consolidated/fixed before NHL 26 is
  deactivated for ingestion, or NHL 26 would stop being reliably selectable as
  archive on two of the four required surfaces.

**3. Separate control concepts — approved as an implementation requirement:**

Three concerns must be represented independently, not as one shared signal:

- **Ingestion eligibility** — should the worker poll a title's EA endpoint.
- **Frontend default selection** — which title a visitor with no `?title=`
  sees.
- **Chronological display ordering** — the order titles/seasons render in,
  independent of which is default.

Implementation direction (design only, not locked to a specific schema):

- `is_active` may continue to represent ingestion eligibility only, or be
  renamed/replaced during implementation for clarity — either is acceptable
  as long as it no longer also drives the frontend default.
- Add an explicit, operator-controlled default-title mechanism (e.g.
  `is_default`) that the worker's poll filter does not read.
- Add or use a reliable chronological-ordering rule or field, independent of
  the default flag. **A default flag alone does not solve chronological
  ordering** — it answers "which title is shown by default," not "what order
  do titles/seasons sort in."
- **Never use auto-increment database ids as title chronology.** This is not
  hypothetical: `packages/db/src/queries/game-titles.ts:14` orders active
  titles `desc(id)` ("newest first"), while
  `packages/db/src/queries/players.ts:1150-1152` sorts a player's
  career-season rows `asc(id)` on the hardcoded comment "NHL 26 = id 1, NHL 22
  = id 6" — two contradictory conventions in the same codebase. NHL 27 was
  seeded with the *highest* id on both hosts, which happens to work under the
  first convention and silently breaks the second: a player's per-title
  career-season table (`apps/web/src/components/roster/career-seasons-table.tsx`)
  now sorts NHL 27 last instead of first, and the career-range subtitle built
  in `apps/web/src/components/roster/profile-hero.tsx:147-156` (e.g. "NHL
  22-26 · sum") mislabels once NHL 27 data is present, since it derives the
  label's endpoints from the same wrongly-ordered array.
- Consolidate the duplicated title-default-resolution logic currently spread
  across `apps/web/src/lib/title-resolver.ts`, `apps/web/src/app/page.tsx`,
  and `apps/web/src/app/games/page.tsx` into one implementation, so a future
  fix only has to be made once.

No precise migration design is locked in by this entry beyond these required
invariants (ingestion/default/chronology must be independently controllable,
and any default-title field needs a database invariant enforcing at
most/exactly one default). Schema design and review are implementation work,
not decided here.

**4. NHL 26 manual-data precedence — approved source precedence:**

- Once comprehensive, manually reviewed NHL 26 totals are reviewed and
  accepted (via the existing NHL 19–25 historical workflow), those **manually
  reviewed totals become authoritative** for displayed NHL 26 cumulative
  season/career values.
- Existing EA-derived totals and raw EA payloads already ingested for NHL 26
  are **preserved unchanged** as provenance — nothing is deleted or
  overwritten at the source-data layer.
- EA-only fields (i.e. fields the manual/historical source has no equivalent
  for) may continue to **supplement** the display, but only for fields the
  manual source does not cover.
- **Overlapping EA cumulative totals must never be added on top of
  comprehensive manual cumulative totals** for the same statistic — this
  would double count. Any importer/precedence implementation must select a
  source per-field (or per-row), never combine sources additively for the
  same counter.
- The chosen source for each displayed value must be **recorded**
  (provenance/source-selection metadata) so a future reader — human or code —
  can tell which source controls a given number.
- This is policy only. **E1J does not import, transform, or alter any NHL 26
  data.** The import/precedence implementation itself remains future work.

**5. Player career behavior — approved:**

- Preserve **both** existing presentations on a player's page — this was
  clarified during review, not newly designed:
  - a **combined, cross-title career total**, currently computed by
    `aggregateCareer()` in
    `apps/web/src/components/roster/profile-hero.tsx:813-847` by summing
    every row `getPlayerCareerSeasons()` returns; and
  - a **per-title season-by-season table**
    (`apps/web/src/components/roster/career-seasons-table.tsx`), fed by the
    same underlying rows.
- Combined totals must be **clearly labeled as spanning multiple NHL titles**
  (not presented as if they were a single season/title's numbers).
- **Require a manual cross-title identity review before a new title's
  statistics are folded into a player's combined career total.** The current
  global, unscoped gamertag-fallback match (`apps/worker/src/ingest.ts:437,462-463`;
  `players` has no `game_title_id` — `packages/db/src/schema/players.ts:12-29`)
  is **not sufficient proof of identity by itself** to safely combine totals
  across a title boundary — a reused gamertag belonging to a different real
  person would otherwise silently inflate one visible "career" number.
- Fix the existing NHL 27 season-order and reversed career-range-label
  defects (see §3) using explicit chronology, not numeric ids, as part of
  implementation.

**6. Team records — approved:**

- Keep NHL 26 and NHL 27 team/club win-loss records **separate** — this
  matches current behavior (`club_game_title_stats` is unique per
  `game_title_id`; the homepage's Title Records section already renders each
  title as its own row, `apps/web/src/app/page.tsx:362-391`) and is approved
  to continue.
- Do **not** combine them into a single franchise record as part of this
  policy.
- A future, separately designed all-time-franchise aggregate feature could
  combine them later — **no such feature is approved or implemented by this
  entry.**

**7. URLs — approved:**

- Continue using title slugs (`?title=nhl26`, `?title=nhl27`, etc.) as the
  URL mechanism for explicit title selection.
- Default-title changes must not break an explicit `?title=` filter URL — a
  visitor who already has `?title=nhl26` bookmarked or shared must keep
  seeing NHL 26 regardless of what the no-filter default is.
- Numeric match/player links (`/games/[id]`, `/roster/[id]`) are unaffected
  by changing the default title on a single running database — they resolve
  by surrogate primary key, not by title. This is **not** a claim that those
  numeric ids are portable across independently provisioned hosts or across a
  migration/restore: `game_titles.id` values are already confirmed to differ
  across hosts for the same slug (main `nhl26`=1 vs Hotel-Echo `nhl26`=4 —
  see the "NHL 27 ENABLED" Active State entry), and nothing in the schema
  guarantees `matches.id`/`players.id` stay aligned across environments.

**Closes, on the strength of this decision alone (policy/design, not
implementation):** the two Gate 2 "NHL 27 readiness" checklist items on
cutover rules and career-stat stitching rules — see the updated checklist
above. **Does not close:** the NHL 27 compatibility matrix or labeled
benchmark (E5 work, unaffected by this entry), nor any of the implementation
work listed in §§1–6 above, none of which has been done.

### 🟢 E1I HOSTING COST + SYSTEM TERMINATION MAP DOCUMENTED — migration and activation remain open (2026-09-08)

Documentation-only session, following a read-only E1 hosting-cost and
system-termination reconciliation. The operator approved a provisional
hosting-cost estimate in place of measured wall-power consumption, and
approved recording a precise current-versus-target system termination map.
One operator-authorized, read-only SSH hardware inventory of Hotel-Echo was
performed by Codex on 2026-09-08 to obtain the motherboard, CPU, GPU, RAM,
SSD, and SMBIOS PSU results recorded below; that inventory made no host
changes. **The Claude documentation session that wrote this entry did not
itself access Hotel-Echo or any other external system.** Beyond that one
read-only inventory, **no power consumption was measured, and nothing was
physically inspected, implemented, installed, migrated, activated,
deployed, restarted, or backed up** — no power measurement or physical
inspection occurred, no GitHub,
Cloudflare, or Proton account was accessed during E1I, and the tunnel was
not touched (reopening remains separately unauthorized).

**1. Hosting-cost estimate — operator-approved planning figure, not a
measurement:**

Read-only Hotel-Echo hardware evidence, supplied by Codex:

- Gigabyte Z87M-D3H desktop
- Intel Core i5-4670
- NVIDIA GTX 760
- Approximately 8 GB RAM
- One ADATA SU630 SATA SSD
- PSU model/capacity could not be identified — SMBIOS Type 39 returned OEM
  placeholders and an unknown maximum capacity

No machine ID, boot ID, serial number, or other private host identifier is
recorded here or elsewhere in this entry.

Approved planning assumptions and arithmetic:

- Average draw assumption: 50–100 W
- Continuous 30-day month: 720 hours
- Energy estimate: 36–72 kWh/month (50 W × 720 h = 36 kWh; 100 W × 720 h =
  72 kWh)
- Assumed marginal electricity price: CAD $0.15–$0.30/kWh
- Estimated electricity cost: CAD $5.40–$21.60/month (36 kWh × $0.15 = $5.40;
  72 kWh × $0.30 = $21.60)
- Domain: approximately CAD $1.18/month (per E1B)
- Cloudflare DNS/Tunnel, household internet, and Proton Unlimited remain
  existing shared costs with no current incremental site-specific charge —
  not free services, per E1C
- **Provisional total incremental hosting cost: CAD $6.58–$22.78/month**
  ($5.40 + $1.18 = $6.58; $21.60 + $1.18 = $22.78)
- **Temporary round-number planning ceiling: CAD $25/month**

Explicitly:

- This is an operator-approved planning estimate, not measured wall
  consumption.
- The electricity rate is assumed, not taken from a utility bill.
- Actual consumption and cost can fall outside the range above.
- CAD $25/month is a planning ceiling, not a billing guarantee or a
  technical limit.
- Precise wall-power measurement is deferred indefinitely and no longer
  blocks E1 — see the superseded annotations added to the "E1C HOSTING COST
  ACCOUNTING APPROVED" and "E1D PROTON CAPACITY PROVISIONALLY SUFFICIENT"
  entries below.
- Re-estimate if hardware, workload, tariffs, or shared-service pricing
  materially changes.
- Proton's reported 510 GB free capacity remains only provisionally
  sufficient under E1D's conservative design-time model; E3 still owns the
  real production ceiling and ongoing capacity monitoring. This entry adds
  no new Proton evidence.

**2. Current-versus-approved-target system termination map:**

| Component | Current documented state | Approved final state | Implemented or policy-only | Remaining action |
| --- | --- | --- | --- | --- |
| Next.js web app | Real historical production instance runs unchanged on the main PC; Hotel-Echo separately runs a real parallel deployment (Stage B/D, commit `00742e4`, loopback-bound) | Hotel-Echo becomes sole production host | Hotel-Echo deployment is real; cutover is policy-only (E1A) | Migration, cutover, validation, main-PC retirement — not started, separately authorized |
| Worker | Main PC's worker is the real production ingestion process; Hotel-Echo runs its own worker against its own database | Hotel-Echo becomes sole production worker | Same as above | Same as above |
| PostgreSQL | Main PC holds the real historical database (all matches, OCR data, decoder-run provenance); Hotel-Echo's database is separate, stood up 2026-09-03, and does **not** contain the migrated historical production dataset | Hotel-Echo's PostgreSQL becomes sole production database | Policy-only for the cutover; Hotel-Echo's own instance is real but uncutover | `pg_dump`/`pg_restore` from the real production DB and cutover validation — not performed |
| Persistent application storage | Independent `postgres_data` volumes on each host; Hotel-Echo's HDD remains physically disconnected/unused with no repurposing decision | Hotel-Echo's storage becomes canonical | Policy-only for host designation; HDD role undecided even as policy | Data migration not done; HDD role undecided |
| Backup source | No production backup pipeline has been recorded as running anywhere; the latest recorded evidence (2026-09-05) has the producer/acceptor passing their suite only against disposable temp filesystems — E1I did not recheck either host | Hotel-Echo becomes the production backup source | Policy-only (E1A) | Transport, scheduling, activation — E3, not started |
| Primary backup destination | No production upload or activation has been recorded. The latest recorded installation evidence (2026-09-05) reported no `age`, no keypair, and no Proton authentication on either host; E1I did not recheck that installation state | Proton Drive, age-encrypted ciphertext only | Policy-only (E1A); capacity provisionally addressed (E1D) | Proton integration, key generation, transport, acceptance verification — E3, not started |
| Secondary backup destination | No secondary-backup implementation or activation has been recorded; E1I did not recheck either host | Main PC, opportunistic only; availability must never gate the primary backup pass/fail | Policy-only (E1A) | E3 owns implementation; not started |
| DNS | `boogeymen.app` records live at Cloudflare (registrar+DNS), currently pointed at a stopped tunnel | Same records, routing to Hotel-Echo `web` once cutover and tunnel reopening are both separately authorized | Records implemented; routing target is policy-only pending cutover | Tunnel reopening is separately unauthorized, not part of E0–E6 |
| Edge TLS | Cloudflare-terminated edge TLS was proven working transiently (~7.5 min) on 2026-09-03, then the tunnel was stopped; not currently live | Cloudflare edge TLS in front of the tunnel to Hotel-Echo `web`, post-cutover | Verified once, transiently; currently dormant | Re-verification required whenever the tunnel is reauthorized |
| Cloudflare Tunnel / origin connection | `cloudflared` absent from Hotel-Echo's running containers (confirmed Stage D, 2026-09-04); config exists behind the `public` compose profile, not engaged | Cloudflare edge/Tunnel to Hotel-Echo's loopback-bound `web` service | Config implemented and dormant; not authorized to run | Reopening requires its own separate authorization — not part of E0–E6 and not granted here |
| Main PC rollback role | Main PC is currently the live production system, not yet a rollback source in practice (no cutover has happened for it to roll back from) | Temporary rollback source only, until migration/cutover/validation succeed, then retires from production | Policy-only (E1A) | Cutover has not happened; retirement criteria undefined in detail |
| Main PC OCR role | Main PC is the established OCR/video-ingest machine; that work runs only when the operator explicitly chooses. E1I does not claim an OCR job was running during this documentation session | Continues post-retirement, only when the operator explicitly chooses | Already the established role; approved to continue unchanged | None — current and target already match |

This map documents the approved target architecture; it does not claim any
of the target-state cells are the current deployed reality. Migration,
cutover, validation, main-PC retirement, backup activation, and tunnel
reopening are not performed or authorized by this documentation update.

**3. Gate 2 impact:** the "select the hosting solution and record expected
monthly cost" and "document where the... app, worker, PostgreSQL database,
persistent storage, backups, DNS, and TLS terminate" checkboxes are now
checked on the strength of the estimate and map above — see the roadmap
items under "Domain, hosting, and exposure decisions." No other Gate 2 or
Gate 3 checkbox changed. Closing these two checkboxes does not imply
migration, cutover, backup activation, or tunnel reopening — each remains
open and separately authorized, as detailed in the map above and in E3/E4.

**What this does not do.** A read-only operating-system hardware inventory
was obtained over SSH by Codex on 2026-09-08 — this is the source of the
motherboard/CPU/GPU/RAM/SSD facts above, and it made no host or
external-system mutation. Beyond that inventory: no physical PSU inspection
or wall-power measurement occurred, and the PSU model/capacity remained
unidentified (SMBIOS Type 39 returned OEM placeholders); no hardware was
purchased; no electricity meter was read; no Proton, Cloudflare, or GitHub
account was accessed; and no backup, migration, deployment, installation,
activation, restart, or tunnel action occurred. This entry records a
planning estimate and a documentation map only. See the "E1C HOSTING COST ACCOUNTING APPROVED" and "E1D PROTON
CAPACITY PROVISIONALLY SUFFICIENT" Active State entries below for the
superseded annotations this entry's approval triggers, and the E1 umbrella
section above for the corresponding reconciliation.

### 🟢 E1H GITHUB REPOSITORY MADE PRIVATE — Hotel-Echo read access preserved (2026-09-08)

Authorized, narrowly-scoped session executing the GitHub repository-visibility
decision approved in the "E1G PRIVACY/RETENTION POLICY + REPOSITORY
VISIBILITY DECIDED" Active State entry below. Only repository visibility was
changed; nothing else was touched.

**What changed:**

- Repository visibility for `utiz23/TheMississagaBoogeymen` was changed from
  public to private through the GitHub CLI (`gh repo edit --visibility
  private`).
- GitHub was queried afterward and reported the repository as `private`
  (`isPrivate: true`).

**Deploy key — unchanged, verified before and after:**

- The existing read-only deploy key `hotel-echo-deploy` (id `162148527`)
  remained enabled, verified, and `read_only: true` both before and after
  the visibility change.
- No deploy key was created, replaced, rotated, or modified. This entry
  uses the deploy key that already existed; it does not introduce a new
  credential mechanism.

**Hotel-Echo read access — verified before and after, externally:**

- Before the change: Hotel-Echo was online and SSH-accessible; from
  `/home/utiz/eanhl-team-website`, `git ls-remote origin refs/heads/main`
  returned `db85d1cc744b4824201fc013126935dfabf47a5c refs/heads/main`.
- After the change: the same command, from the same host and path, returned
  the identical commit — `db85d1cc744b4824201fc013126935dfabf47a5c
  refs/heads/main`.
- Both the pre-change and post-change Hotel-Echo checks were performed and
  reported through independent external verification supplied to this
  Claude session (via the operator, sourced from Codex); this session did
  not itself run or directly observe those SSH checks. This entry records
  that evidence — it does not claim Claude executed the Hotel-Echo checks.

**What this does not do.** Existing public clones, forks, downloads, caches,
and previously exposed git history cannot be retracted by this or any future
visibility change — going private stops new public access, it does not
retract copies already taken. Making the repository private does not make
the production website private and does not replace or complete the
still-open E2 privacy-policy/data-collection-policy/Terms-of-Use drafts. No
collaborator, branch-protection, Actions, secrets, Pages, deployment,
migration, tunnel, or other repository or infrastructure setting was
changed. See the "E1G PRIVACY/RETENTION POLICY + REPOSITORY VISIBILITY
DECIDED" Active State entry below for the original decision, and the
corresponding E1 umbrella bullet for what remains open.

### 🟡 E1G PRIVACY/RETENTION POLICY + REPOSITORY VISIBILITY DECIDED — historical policy decision; visibility status superseded 2026-09-08 (see E1H) (2026-09-07)

Documentation-only session, following a read-only E1 privacy/data-flow
inventory (and its corrected reissue) that traced what the repository,
schema, and worker code actually collect, derive, log, and could expose.
The operator approved the policy below. **Nothing was implemented, changed,
or accessed externally by this entry** — repository visibility was **not**
changed, no GitHub account was accessed, no credentials were created, and
no code or configuration was modified.

**Data interpretation — decided:**

- `player_name_snapshot` is treated as an in-game display/persona field —
  another form of game identity alongside gamertags and short personas —
  not a verified legal-name or real-world-identity field. A player could
  unusually choose a real name as their in-game identity; the system
  neither verifies nor asserts that any captured value is or is not a real
  name.
- Opponent consent is not characterized as known in either direction by
  this or any prior session.

**Retention — decided:**

- Gamertags, personas, `player_name_snapshot` values, match/stat data, raw
  EA payloads, structured database data, and OCR evidence may be retained
  indefinitely until the project operator manually deletes or corrects
  them.
- Raw OCR source videos and screenshots may also be retained indefinitely
  until manual operator deletion.
- "Indefinitely until manual deletion" is the approved policy — not a claim
  that deletion is impossible, nor that every item must always be
  retained.
- Correction/deletion requests remain manual, through
  `webmaster@boogeymen.app`, under the already-approved
  acknowledgement/response targets (7-day acknowledge / 30-day resolve —
  see the "LAUNCH POLICY + DOMAIN MAIL" Active State entry).
- A database correction/deletion flows into new backups going forward;
  older encrypted backups expire naturally through the approved
  backup-retention schedule (7-day 6-hourly / 30-day daily / 12-month
  monthly — see the "E1A HOSTING + BACKUP POLICY DECIDED" entry). Surgical
  rewriting of already-retained backup artifacts is not planned.
- Authentication is dormant and the reachable auth API refuses every
  request. The schema contains fields capable of storing session
  IP/user-agent and account credentials/tokens (`sessions`/`accounts`
  columns: ip_address, user_agent, tokens, password). The latest recorded
  provisioning evidence reported no accounts, but E1G did not inspect the
  live database and does not independently claim current table contents.
  A fresh privacy review remains mandatory before authentication
  activation, regardless of current table contents.

**GitHub — decided:**

- The operator confirmed on 2026-09-07 that the repository is **currently
  public**. (Accurate as of that date. **Superseded 2026-09-08** — see
  below.)
- The operator decided on 2026-09-07 to make it **private**. **The
  visibility change has not happened during this documentation session** —
  the repository remains public until a separate, later session changes
  and verifies it. **Superseded 2026-09-08 — the "E1H GITHUB REPOSITORY
  MADE PRIVATE" Active State entry above records that a separate,
  authorized session changed the repository to private and verified the
  change; this E1G entry did not perform that change itself.**
- Existing committed fixtures and research captures (identified in the
  read-only E1 privacy inventory) remain in current git history. No
  history rewrite is authorized or planned.
- Prior clones, caches, forks, or downloads cannot be guaranteed
  retractable after any future visibility change — going private stops new
  public access; it does not retract copies already taken.
- Going forward, prefer synthetic identities in new test fixtures unless
  authentic source provenance is genuinely required.
- Making the repository private does not make the public website private,
  and does not replace the still-open privacy/data-use disclosures (E2
  drafts).
- Before visibility is actually changed, a future separately-authorized
  session must account for the authenticated read access Hotel-Echo
  deployments need against a private repository. **The exact credential
  mechanism is not decided here** — a deploy key was recommended during
  discussion but is not yet operator-approved or implemented. **Correction
  (established by later read-only verification, recorded 2026-09-08): this
  claim was based on incomplete/unverified knowledge, not an accurate
  historical fact — E1G had not inspected or established the actual
  existing credential state.** The repository-specific `hotel-echo-deploy`
  deploy key already existed at the time E1G was written, created
  2026-09-03. Later verification found it enabled, verified, and
  read-only. No new key or credential was created for the visibility
  change — the pre-existing key was reused as-is. Hotel-Echo's read access
  (`git ls-remote`) was verified working both before and after the
  visibility change. This entry does not establish when or how operator
  approval for that pre-existing key was originally granted. See the "E1H
  GITHUB REPOSITORY MADE PRIVATE" Active State entry.

**Other approved policy — decided, not implemented:**

- Disable Next.js build-time telemetry (`NEXT_TELEMETRY_DISABLED`) in a
  later implementation session.
- Docker log retention/rotation, and reducing or suppressing routine
  gamertag-bearing log output, remain E4 implementation work.
- Cloudflare's and Proton's own logging/retention behavior must be
  reviewed before E2 drafts make factual claims about them — neither was
  inspected by this or the prior inventory session.

**What this does not do.** This entry records policy decisions only. It
does not change GitHub repository visibility, create or approve any
credential mechanism, disable Next.js telemetry, configure Docker log
rotation, review Cloudflare/Proton settings, or draft/publish the privacy
policy, data-collection policy, attribution notice, or Terms of Use — all of
that is separately-authorized future work (E2 drafts, E4, and a later
visibility-change session). This entry records only that a Terms of Use is
now a required launch deliverable (added to the Gate 2/Gate 3 checklists as
new unchecked items) — it does not draft, review, or approve any Terms of
Use content. It does not reopen the tunnel (still separately unauthorized)
and checks no Gate 2 or Gate 3 checkbox. See the corresponding E1 umbrella
bullet below for what remains open.

### 🟡 E1F INDEXING POLICY DECIDED — implementation remains Gate 3 (2026-09-07)

Documentation-only session, following a read-only route inventory of
`apps/web/src/app`. The inventory itself made no decision. The operator
approved the indexing policy below for the Gate 2 "define public/private
indexing rules and identify every route that must be excluded from search
engines" checklist item. **Nothing was implemented** — no `robots.txt`, no
sitemap, no canonical/OG metadata, no per-page descriptions, and no route
was added, removed, or modified by this entry.

**Canonical public routes intended for indexing — decided:**

- `/`, `/games`, `/games/[id]`, `/roster`, `/roster/[id]`, `/stats`.
- Finished legal/contact pages, once implemented and published — not before.

**Sitemap policy — decided:**

- Include only deliberate canonical public URLs, including canonical
  game-detail and player-detail URLs.
- Exclude preview, API, diagnostic, auth/admin, error, development-only, and
  query-variant URLs.

**Query variants — decided:**

- Filter, mode, role, view, opponent, title, and pagination variants are not
  separate search results; mark them `noindex, follow`.
- Add canonical links only where the content is genuinely duplicative — do
  not falsely canonicalize materially different pagination content (e.g. a
  later `/games` page of different matches) to page one merely because it
  shares a route.
- Exact metadata mechanics (which tag on which route, `generateMetadata`
  wiring) remain implementation work, not decided here.

**Preview/development artifacts — decided:**

- `/preview/carousel` and `/preview/archetypes` are approved for removal
  from the production route tree, to be done in a later implementation
  session — **not removed by this entry.**
- Until removed, they must be `noindex` and omitted from the sitemap.
  robots `Disallow` must not be combined with `noindex` in a way that
  prevents crawlers from seeing the `noindex` directive.
- The public `Dev` filter and `/games?mode=dev` behavior are approved for
  removal from the production `/games` surface — **not removed by this
  entry.** The underlying benchmark IDs/data may remain in test or
  development-only tooling, but not as a public production filter.

**Robots/security boundary — reaffirmed, unchanged:**

- robots.txt is crawl guidance, never authorization.
- `/api/auth/**` already returns real 404 responses regardless of any
  robots/indexing configuration.
- `/login`, `/account`, `/me`, and `/admin/**` are absent routes — nothing
  to index or exclude.
- Worker `/health` is outside the Next.js web route surface entirely and is
  protected by network exposure controls (see the "STAGE D PASS" Active
  State entry), not by robots.txt.
- Sensitive/private/diagnostic routes must remain inaccessible regardless of
  indexing configuration — indexing policy is presentation, not access
  control.

**What this does not do.** This entry decides the policy only. It does not
implement `robots.txt`, a sitemap, canonical metadata, per-page
descriptions, Open Graph metadata, or route removal — each is Gate 3 web
implementation work, tracked in the E2 umbrella entry below. Legal/contact
pages become indexable only after they are completed and intentionally
published, not on the strength of this decision. It does not reopen the
tunnel (still separately unauthorized). **Gate 2 impact:** the "define
public/private indexing rules and identify every route that must be
excluded from search engines" checkbox is now checked on the strength of
this decision — see the roadmap item above and the corresponding E1 bullet
below. No other Gate 2 or Gate 3 checkbox changed.

### 🟡 E1E DEPLOYMENT/STAGING/SECRETS/ROLLBACK MODEL DECIDED — definition only, nothing deployed, migrated, rotated, or exercised (2026-09-07)

Documentation-only session. The operator approved the deployment, staging,
secrets/environment-separation, and rollback-ownership model below for the
Gate 2 "define secret storage, environment separation, deployment mechanism,
staging strategy, and rollback ownership" checklist item. **Nothing was
deployed, migrated, restarted, authenticated, installed, or rotated by this
entry, and the tunnel was not reopened (still separately unauthorized).**

**Production and staging — decided:**

- Hotel-Echo is the only intended production host; there will be no permanent
  staging server.
- A deployment candidate must be a clean, pushed `main` commit with an exact
  recorded commit hash.
- Verification uses the mandatory full repository suite and disposable
  databases.
- The exact commit is built on Hotel-Echo in a controlled deployment window.
- Smoke verification occurs through host loopback/Tailscale before public
  cutover/verification.
- This decision does not authorize a deployment or tunnel action.

**Deployment — decided:**

- Deploy only from clean, pushed `main`.
- Record the deployed commit and resulting image identifiers.
- Database migrations are reviewed and applied deliberately, and must never
  be hidden inside automatic container startup.
- Production exact commands and exercising deployment remain later
  documentation/Gate 3 work where not already covered by DEPLOY.md.

**Secrets and environment separation — decided:**

- Each host has independent configuration and credentials outside git.
- Sensitive configuration files use mode `0600` where the filesystem enforces
  Unix permissions.
- Production credentials must never enter disposable test databases or test
  environments.
- The Cloudflare tunnel token's approved target form is a mounted secret
  file, not a value committed to git or rendered into Compose configuration.
- The latest recorded Hotel-Echo host evidence says its `.env` contained a
  stale `TUNNEL_TOKEN` variable. E1E did not recheck the host. If it remains
  present, it must be rotated in Cloudflare and removed before any
  reopening. **This session did not inspect, rotate, remove, or expose it.**
- Proton CLI authentication must use a protected operating-system credential
  store; the exact unattended, service-compatible mechanism remains E3
  design work.
- Hotel-Echo stores only the public age recipient, never the private
  identity.
- After cutover, the main PC has no persistent production services; its
  roles are operator-triggered OCR and opportunistic secondary backup
  reception.

**Rollback — decided:**

- Rollback owner: the project operator. An agent may execute rollback only
  under explicit operator authorization.
- Preserve the prior known-good application commit/image identifiers.
- Application rollback means returning web/worker to a known-good
  image/commit and verifying health.
- A backup is a recovery prerequisite, not authorization to blindly reverse
  database migrations. Database recovery/rollback requires its own reviewed
  procedure and compatibility decision — down-migrations are not assumed
  safe.
- Exercising deployment and rollback remains an open Gate 3 requirement.

**What this does not do.** This entry defines the model only. It does not
implement, deploy, migrate, rotate credentials, integrate Proton, cut over
production, exercise rollback, or establish a DR/restore procedure — each
remains open and separately authorized. It does not reopen the tunnel
(still separately unauthorized). **Gate 2 impact:** the "define secret
storage, environment separation, deployment mechanism, staging strategy, and
rollback ownership" checkbox is now checked on the strength of this
decision — see the roadmap item above and the corresponding E1 bullet below.
No other Gate 2 or Gate 3 checkbox changed.

### 🟡 E1D PROTON CAPACITY PROVISIONALLY SUFFICIENT — electricity estimate deferred (2026-09-07)

Documentation-only session. The operator reported Proton Drive's current
free-space figure and approved deferring the electricity measurement.
**Neither Proton, Cloudflare, any billing dashboard, nor either host was
accessed by this agent** — the capacity figure is operator-supplied evidence,
and the arithmetic below is a documentation-only estimate derived from it,
not a live capacity check.

**Capacity arithmetic (conservative, worst-case counting):**

- Approved retention holds at most approximately 28 six-hourly points (7
  days), 30 daily points, and 12 monthly points — about 70 retained recovery
  points if counted conservatively as fully separate points (no dedup credit
  for a point that satisfies more than one retention tier).
- The current proposed producer example configuration sets
  `staging.maxStagingBytes = 5 GiB`. Treating every one of those ~70 retained
  points as a full 5 GiB ciphertext gives **~350 GiB** total under this
  worst-case model.
- Proton Drive currently reports **510 GB free** (decimal) ≈ **475 GiB**
  (510 × 10⁹ ÷ 2³⁰). Against the ~350 GiB worst-case figure, that leaves
  roughly **125 GiB** of theoretical headroom under this conservative model.
- Current real database dumps are much smaller than 5 GiB, which is why the
  worst-case total is likely a significant overestimate in practice — **but
  that observation is not treated here as a permanent capacity guarantee**,
  since the dataset will grow over time.

**What this does and does not establish:**

- **Provisional conclusion:** 510 GB is provisionally sufficient for E3
  design purposes under the conservative model above. This is a design-time
  estimate, not a completed E3 capacity proof and not a permanent guarantee.
- The `5 GiB` staging figure belongs to the current **proposed/example**
  producer configuration, not a finalized Hotel-Echo production
  configuration — a different production ceiling could change this
  arithmetic in either direction.
- This entry does **not** claim every future backup will be 5 GiB. It also
  does not claim that future non-backup Proton usage competing for the same
  quota has been forecast, or that Proton's deletion, trash,
  version-retention, and quota-reporting behavior is already understood.
- **E3 must still**: establish the real production staging/artifact ceiling;
  characterize Proton's actual deletion/trash/version-retention behavior and
  any non-backup usage sharing the same quota; preserve operational headroom
  rather than assuming full utilization; and continuously monitor available
  capacity rather than relying on a one-time figure.
- **No additional Proton storage cost is currently expected**, subject to E3
  confirming the production design and actual available capacity — this is
  not a final cost determination.

**Electricity — deferred, not zero, not waived:**

- Hotel-Echo's electricity draw remains a real, currently unmeasured
  recurring hosting cost.
- The operator has deferred measuring it long-term: it is not considered
  important at this time. **No follow-up date has been approved for this
  deferral.**
- Per the roadmap's Completion Rule (a waiver requires a written reason,
  owner, and follow-up date), **this deferral is not yet a formal waiver** —
  it is an operator decision to postpone measurement, recorded here for
  transparency, not a closed or excepted item.
- The Gate 2 "select the hosting solution and record expected monthly cost"
  checkbox **remains unchecked and open** — this entry does not complete it.
  **Superseded 2026-09-08:** the operator subsequently approved a
  provisional electricity-cost estimate (assumed 50–100 W draw, CAD
  $0.15–$0.30/kWh) in place of a measured figure, and approved treating the
  deferral as non-blocking for E1 rather than waiting for a formal
  Completion Rule waiver. That later decision is recorded in the "E1I
  HOSTING COST + SYSTEM TERMINATION MAP DOCUMENTED" Active State entry and
  closes this checkbox on that basis. This entry's original conclusion is
  preserved above as the accurate historical record of what was true on
  2026-09-07 — the approval described here did not exist yet at that time.

See the "E1C HOSTING COST ACCOUNTING APPROVED" entry below for the rest of
the cost accounting this refines.

### 🟡 E1C HOSTING COST ACCOUNTING APPROVED — final estimate still open (2026-09-07)

Documentation-only session. The operator approved the following cost
accounting for the Hotel-Echo hosting decision recorded in the "E1A HOSTING +
BACKUP POLICY DECIDED" entry below. **No infrastructure, billing,
subscription, deployment, backup, or tunnel action was authorized or
performed by this entry** — it records a cost breakdown only.

**Cost accounting, as approved 2026-09-07:**

- Selected production host: Hotel-Echo (per E1A).
- Domain renewal: CAD $14.20/year, approximately CAD $1.18/month (per E1B).
- Hotel-Echo hardware was already owned — no new capital purchase is
  attributed to hosting.
- Current Cloudflare DNS/Tunnel posture carries no incremental monthly charge
  attributed to hosting under present usage. This is a statement about
  current usage, not a claim that Cloudflare can never introduce a cost.
- Household internet is an existing shared service. It carries no
  incremental site-specific charge, but it is a real recurring cost the
  household already pays — it is not free.
- Proton Unlimited is an existing shared subscription. It carries no
  incremental site-specific charge **if** existing Drive capacity is
  sufficient for the E3 backup design. **Updated 2026-09-07 — no longer
  wholly unknown:** see the "E1D PROTON CAPACITY PROVISIONALLY SUFFICIENT"
  Active State entry above. Proton Drive's reported free space is
  provisionally sufficient under a conservative design-time model — this is
  not a confirmed, permanent, or production-verified capacity fact; E3 must
  still establish the real production ceiling and monitor capacity on an
  ongoing basis.
- Hotel-Echo's electricity draw is a real recurring hosting cost and is
  currently unmeasured — this entry does not claim it is zero. **Updated
  2026-09-07:** the operator has deferred this measurement long-term with no
  approved follow-up date, which is a deferral, not a formal Completion Rule
  waiver — see the "E1D PROTON CAPACITY PROVISIONALLY SUFFICIENT" entry.

**Currently known incremental fixed cost: CAD $1.18/month (domain renewal)
plus Hotel-Echo electricity (amount not yet measured, measurement deferred
long-term).** This is not a complete expected-monthly-cost figure — Proton
Drive capacity is now provisionally addressed (see E1D above) but electricity
remains an open, deferred unknown with no approved follow-up date, so no
formal waiver exists. The Gate 2 "select the hosting solution and record
expected monthly cost" checkbox stays unchecked until a complete figure
exists. **Superseded 2026-09-08:** the operator approved a provisional
planning estimate for electricity (CAD $5.40–$21.60/month, from a read-only
Hotel-Echo hardware inventory collected by Codex and supplied to the Claude
documentation session, combined with assumed draw/rate figures — not a
utility-bill measurement) and approved a CAD $25/month planning ceiling,
making the deferral explicitly non-blocking for E1 rather than a gap
awaiting a formal waiver. See the "E1I HOSTING COST + SYSTEM TERMINATION MAP
DOCUMENTED" Active State entry, which checks this Gate 2 checkbox on that
basis. This entry's "stays unchecked" conclusion is preserved above as the
accurate historical record of 2026-09-07 — it is not being rewritten as if
the later approval already existed then.

### 🟢 E1B DOMAIN REGISTRATION DOCUMENTED — operator-supplied Cloudflare Registrar evidence, not independently inspected (2026-09-07)

Documentation-only session. The operator read the following facts directly
from the Cloudflare Registrar dashboard and reported them for the record.
**This agent session did not access Cloudflare or any other external
account** — nothing below was independently verified against a live
Cloudflare session; it is recorded as operator-attested evidence, the same
basis already accepted for the MFA-status item under the Gate 2 checklist.

**Domain registration facts, as of 2026-09-07 (operator-supplied, non-sensitive):**

- Domain: `boogeymen.app`.
- Status: Active.
- Registrar and DNS provider: Cloudflare.
- Domain owner: the project operator. Billing owner: the project operator.
- Expiration date: September 3, 2027.
- Renewal price: CAD $14.20/year.
- Auto-renew: enabled, with a scheduled auto-renewal date of August 4, 2027,
  for one further year.
- MFA: enabled on the account.
- Recovery measures/contact: enabled, owned by the project operator.

**Deliberately not recorded here:** any personal name, email address,
account identifier, payment instrument detail, MFA secret/recovery code, or
private recovery-contact detail. Those stay outside the repository by
design, not by oversight — the Gate 2 item only requires that their
existence and ownership be documented, not their contents.

**What this does not establish.** Auto-renew being enabled does not
guarantee that the September 2027 renewal will actually succeed — payment
failure, card expiry, or a Cloudflare-side account issue could still cause a
missed renewal; this entry records the current configuration, not a
guarantee of future outcome. This entry does not authorize or imply
production migration, main-PC retirement, backup activation, or tunnel
reopening — each remains separately unauthorized. It also does not claim any
independent, agent-run inspection of the Cloudflare account occurred.

**Gate 2 impact:** the "select and purchase the production domain; document
owner, registrar, renewal date, billing owner, recovery contact, and MFA
status" checkbox is now checked on the strength of this operator-attested
evidence — see the roadmap item above. No other Gate 2 or Gate 3 checkbox
changed.

### 🟡 E1A HOSTING + BACKUP POLICY DECIDED — nothing implemented, installed, activated, migrated, or deployed (2026-09-07)

Documentation-only session. The operator approved the E1 hosting-posture and
backup-topology/retention/key-custody decisions below. **E1A authorized and
performed no implementation, installation, activation, migration,
deployment, restart, authentication, key generation, backup production, or
tunnel action.** The documentation update itself is the only repository-
content change for E1A, and may subsequently be reviewed, committed, and
pushed normally like any other documentation change. Tunnel reopening
remains separately unauthorized.

**Production hosting — decided:**

- Hotel-Echo becomes the sole production host for the website, worker,
  PostgreSQL database, and persistent application data.
- The main PC remains a temporary production rollback source only until data
  migration, cutover, and validation succeed.
- After a successful cutover, the main PC is retired from production
  services. "Retired from production" does not mean it must stay powered on.
- Post-retirement, the main PC continues to run OCR only when the operator
  explicitly chooses, and separately acts as a secondary, opportunistic
  backup destination when available.

**Backup topology — decided:**

- Hotel-Echo is the production backup source.
- Proton Drive is the primary off-host destination. Its availability does not
  depend on the main PC being powered on. This is not a claim that Proton or
  network connectivity can never be unavailable; failed transfers queue and
  retry, and freshness thresholds (below) exist to detect prolonged failure.
- The main PC is a secondary, opportunistic destination; its availability
  must never determine whether the daily independent-backup gate passes.
- Backup artifacts are age-encrypted before leaving Hotel-Echo; only
  ciphertext plus the integrity/binding metadata the reviewed artifact
  contract requires may ever be uploaded — never plaintext dumps. Proton's
  own encryption is additional protection, not a substitute for age
  encryption.
- Failed cloud transfers stay queued locally and retry safely; a transport
  must never delete the last accepted copy.
- A successful upload command alone does not prove acceptance — cloud
  acceptance must be verified through a design established during E3.
- Main-PC replication runs whenever the main PC is available and must not
  block the primary Proton path.

**Recovery and retention targets — approved:**

- Backup production/upload cadence: every 6 hours. RPO 6 hours, RTO 8 hours.
- Retention: 6-hourly recovery points for 7 days; daily points for 30 days;
  monthly points for 12 months.
- Warning when no verified Proton copy is newer than 8 hours; critical alert
  when no verified Proton copy is newer than 24 hours.

**Key-custody constraints — approved:**

- Hotel-Echo receives only the age public recipient needed for encryption,
  never the private identity.
- One encrypted offline private-key copy plus one separately protected
  recovery copy must be maintained.
- The Proton account must never be the sole custodian of both the backup
  archive and every usable copy of its decryption key.
- Exact media/location, responsible owner, Proton CLI credential storage, and
  the recovery procedure are implementation/documentation details still to be
  settled before activation. No credentials, tokens, private keys, or
  recovery material are recorded in this file, in git, in command output, or
  in chat.

**What this does not do.** No backup transport or scheduler was implemented;
no Proton Drive CLI or `age` was installed; no keys were generated; no
account was authenticated; nothing was migrated, deployed, or restarted; the
tunnel was not reopened (still separately unauthorized). This is a policy
decision, not a repository-content claim — it does not say the documentation
recording it will remain uncommitted or unpushed. Production migration,
main-PC retirement, and backup activation each still require their own
separate authorization when their turn comes, distinct from this policy
decision. **The Gate 2 backup/
restore-drill checkbox and the Gate 2 domain/hosting-documentation checkboxes
stay unchecked** — this decision supplies the policy that evidence will
eventually be produced against, not the evidence itself. **Superseded
2026-09-08 for the hosting-solution/monthly-cost and termination-map
checkboxes only** (the backup/restore-drill checkbox is unaffected and
remains correctly unchecked): see the "E1I HOSTING COST + SYSTEM TERMINATION
MAP DOCUMENTED" Active State entry, which checks those two on the strength
of the cost estimate and termination map it documents — not on any claim
that migration, cutover, or backup activation occurred. This entry's
original statement is preserved above as accurate for 2026-09-07. See the
updated E1 and E3 sections for what this resolves and what it deliberately
leaves open.

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

### 🟢 STAGE C COMPLETE — the deployed disabled account surface is verified on Hotel-Echo (2026-09-04)

Read-only verification session against the **running** Hotel-Echo deployment,
over Tailscale SSH (`utiz@100.98.29.119`, repo at `~/eanhl-team-website`).
**Nothing was deployed, rebuilt, restarted, migrated, or rotated. No account was
created, no credential was changed, and the tunnel was not started. No direct
database inspection was performed — no psql, no database tooling — though the
four public-page requests below exercised their ordinary application-level
database reads.** The only repository change is this file. This is the
deployed-application behavioural proof that the "CONTAINED" entry below
deferred to Stage C — the earlier evidence was all local builds and test
doubles.

**Deployment identity — confirmed against Stage B, full ids, not truncated:**

| item              | value                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| host `HEAD`       | `00742e4b5578b21ce205eda71ca2350808fe1147` (branch `main`)                                       |
| host working tree | clean — `git status --porcelain` empty, checked before and after                                 |
| `web` image       | `sha256:2cb63040ba797131cb6047d3bd3d08e41af379767b928e5386af596e6f035bba`                        |
| `worker` image    | `sha256:1058d0515cf5958e21931264f36559202eb7ea557d3931bbf5181f2af4f90d30`                        |
| `db` image        | `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685` (`postgres:16-alpine`) |

Both application image ids match Stage B's recorded prefixes exactly. All three
containers show `RestartCount` 0; `web`/`worker` started `2026-09-04T23:17:05Z`
(the Stage B recreation), `db` started `2026-09-04T01:11:54Z` and was not
recreated. Listeners: `127.0.0.1:3000`, `127.0.0.1:3001`, `127.0.0.1:5433` —
no wildcard on any of the three.

**Tunnel state — measured before the checks and again after them, identical
both times:** no container named `cloudflared` and none from
`ancestor=cloudflare/cloudflared` in **any** state (`docker ps -a`); no
`cloudflared` process (`pgrep -a` → rc 1), no `cloudflared` systemd unit, no
`cloudflared` binary on the host; zero outbound `:7844` connections;
`./secrets/` still does not exist, so the `public` profile could not start even
if invoked; `docker compose config --services` → `db`, `web`, `worker`.

**HTTP results.** All against host loopback `http://127.0.0.1:3000`, status
codes read directly (`-o /dev/null -w '%{http_code}'`), **no redirect
following** (no `-L`), bounded (`--connect-timeout 5`, `--max-time 10` for the
404 set, `20` for the page set).

| Method | Path                      | Expected | Actual  |
| ------ | ------------------------- | -------- | ------- |
| GET    | `/login`                  | 404      | **404** |
| GET    | `/login?token=test`       | 404      | **404** |
| GET    | `/account`                | 404      | **404** |
| GET    | `/me`                     | 404      | **404** |
| GET    | `/admin`                  | 404      | **404** |
| GET    | `/admin/accounts`         | 404      | **404** |
| GET    | `/api/auth/session`       | 404      | **404** |
| POST   | `/api/auth/sign-in/email` | 404      | **404** |
| GET    | `/`                       | 200      | **200** |
| GET    | `/games`                  | 200      | **200** |
| GET    | `/roster`                 | 200      | **200** |
| GET    | `/stats`                  | 200      | **200** |

The POST carried `content-type: application/json` and the literal dummy body
`{"email":"a@b.test","password":"password123"}`. None was created by it — the
route has no module to reach, so it could not have written to the database
regardless of prior contents. (That the database held no account beforehand is
not this session's finding — Stage C performed no direct database inspection,
per above — it is Stage B's provisioning observation: "Hotel-Echo's database is
still the fresh, empty-history one from provisioning.")

**The four 200s are real pages, not 404 bodies served with a 200.** This
mattered specifically because of the known `loading.tsx` Suspense defect
recorded further down, where `notFound()` from a page yields 200 + 404 content.
A naive grep finds the string `404` twice in each of the four bodies, and both
occurrences are **inside `<script>` tags** — they are Next.js's own default
`notFound` template (`"404: This page could not be found."` and the `children:404`
digit) serialised into the RSC flight payload, which every page of a healthy
Next.js app carries. Stripping `<script>…</script>` leaves **zero** occurrences
of `404` in the rendered HTML of `/games`. The rendered pages are correct and
populated: `<title>` values `Club Stats`, `Scores — Club Stats`,
`Roster — Club Stats`, `Stats — Club Stats`; `<h1>` values `Boogeymen`,
`Scores`, `Roster`, `Stats`; body sizes 87,010 / 27,951 / 228,500 / 85,477 bytes.

**The deployed `init-admin` CLI was inspected before it was executed.**
`dist/init-admin-cli.js` inside the running `worker` container is 1,871 bytes,
`sha256:24c0b4e44c9f0ce6e93d17143998fd0c5f6f9d06587181fceabf6aa0bb8cf857`. Its
entire executable content is one `console.error(...)` followed by
`process.exit(1)` and `export {}`. **It contains no `import` or `require` of any
kind** — no `@eanhl/db`, no `better-auth`, no database client — and no
account-creation logic, so executing it could not connect to, read, or write the
production database. Only then was it run:

```
docker compose exec -T worker node dist/init-admin-cli.js
EXIT_CODE=1        # captured from the command itself, before any echo or pipe
stdout: (empty)
stderr: [init-admin] refusing: the account system is disabled before launch.
        Authentication is deferred until after launch, so there is no initial
        admin to create and no page to sign in on. Nothing was read, connected
        to, or written. Re-enabling requires a reviewed source change — see
        apps/web/src/deferred/auth/README.md.
```

**Verdict: Stage C PASSES.** The image running on Hotel-Echo is the
account-system-disabled build. Every required check returned its required value;
none was waived, inferred, or substituted.

**Still open — Stage C closed none of these:**

- ~~**Stage D** — the on-host / LAN / WAN port-exposure test. The loopback-only
  listeners recorded above are host-side evidence only; they are not the
  external `nc`/`curl` test, and the Gate 2 port-exposure checkbox stays
  unchecked until Stage D runs.~~ **Stale, corrected 2026-09-06 — Stage D
  subsequently ran and PASSED for Hotel-Echo (2026-09-04), scoped to its three
  required ports; the Gate 2 checkbox is now checked on that scope. See the
  "STAGE D PASS" Active State entry.**
- **Hotel-Echo's `.env` still contains a stale `TUNNEL_TOKEN` variable.**
  Nothing reads it, but it is a live tunnel credential on disk. It must be
  rotated in Cloudflare and removed from `.env` before, or as part of, any
  reopening decision. Not read, printed, or modified in this session.
- **The production data migration, automated backups, and the restore drill
  remain open.** Hotel-Echo's database still holds no historical production
  data.
- **The main PC is unchanged and still older.** Its running `web` container
  still serves the auth-enabled application. Nothing in this session touched it,
  and Stage C's findings say nothing about it.

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
> pushed through `0b3a519`. ~~**Nothing here has been deployed.**~~ **Corrected
> 2026-09-04 — this remains undeployed on the main PC only; Hotel-Echo received
> this build on 2026-09-04 (`00742e4`), with its deployed-surface verification
> recorded in the Stage C material below.** The main-PC
> `web` container still runs image `sha256:00a401fd31e3…` (see the "DEPLOYED —
> website Workstreams A/B/C" entry further down) and still serves the older,
> auth-enabled application — login page, Server Actions, and all. That
> container is currently reachable only through loopback (see "POST-ROTATION
> LOOSE ENDS CLOSED" below), which is what keeps the still-live bootstrap/login
> surface from being publicly reachable — not the source change described
> here. ~~Hotel-Echo has likewise not received this build~~ — **Hotel-Echo
> received this build on 2026-09-04 (`00742e4`); its tunnel remains offline per
> the entry above, for the same reason it was taken offline originally.**
> ~~The deployed surface has not yet been audited — that is Stage C.~~ **The
> deployed surface HAS now been audited: Stage C passed on 2026-09-04 against
> the running `00742e4` build — all seven account paths and the sign-in POST
> answer 404, the four public pages answer 200 with real content, and the
> deployed `init-admin` CLI is the import-free refusal shim, exiting 1. See the
> "STAGE C COMPLETE" entry at the top of Active State. Deploying this source to
> the main PC is still separate, unauthorized-here work, and the main PC still
> runs the older, auth-enabled image.**

**The decision.** Authentication is deferred until after launch. Once this
source is deployed, the pre-launch site will be public and read-only, with no
login, account, invitation, session, administration, or initial-admin
functionality — not disabled by configuration, not hidden behind a flag, but
absent from the source that becomes the running application on deploy. As of
this writing the _actually running_ main-PC and Hotel-Echo instances still
contain the account system described in the "CONTAINED" entry below.
**Corrected 2026-09-04 — this is now true of the main PC only.** Hotel-Echo runs
`00742e4`, and Stage C measured its deployed surface directly rather than
inferring it from source: the account system is absent from the running
Hotel-Echo instance. The main-PC `web` container is unchanged and still serves
the older, auth-enabled application.

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

**The deployed-host behavioural proof is Stage C below**, not any of the above:
`curl -s localhost:3000/login` against the deployed response on the host, after
the fix is deployed. Nothing in this repo's test suite can establish what a real
empty production database renders. **That proof has now been run — Stage C,
2026-09-04, against Hotel-Echo's deployed `00742e4` build: `/login` returns
**404** over host loopback, as do `/login?token=test`, `/account`, `/me`,
`/admin`, `/admin/accounts`, `/api/auth/session` and the `POST
/api/auth/sign-in/email`. See the "STAGE C COMPLETE" entry at the top of Active
State.**

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

- ~~**Nothing is deployed.** Nothing is pushed.~~ **Superseded twice.** These
  commits were pushed to `origin/main`, and on 2026-09-04 they were deployed to
  Hotel-Echo at `00742e4` and verified there (Stage B, then Stage C). **Hotel-Echo
  no longer runs the vulnerable image** — its safety no longer rests on the
  tunnel alone, though the tunnel is still off and stays off. **The main PC has
  still not received this build** and still runs the older, auth-enabled image;
  it is safe only because it is loopback-only.
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
State entry). Stage E is an umbrella sequence (E0-E6) covering the remaining
Gate 2 work, not a single stage** — a prior version of this section presented
five bullets as "the remaining gates," but a 2026-09-06 read-only scope
reconciliation found that list covered only a fraction of Gate 2's unchecked
items, understated several it did list, and pulled in Gate 3 items Gate 2 does
not require. **That reconciliation is E0, and it is complete; it is recorded
below along with the corrected E1-E6 breakdown it produced. No E1-E6 substage
is authorized to start yet, no Gate 2 or Gate 3 checkbox changed, and no
decision or waiver was made or invented by that session.** The next actionable
substage was **E1 — operator decisions and operational documentation**, at
the time this paragraph was written (2026-09-06). **Update 2026-09-08: E1 is
now ✅ COMPLETE (E1A-E1K) — see "## Operational V1 Terminal Roadmap" → "### E1"
and the "E1K FINAL OPERATOR DECISIONS RECORDED" Active State entry. The next
actionable substage is now E2, which per operator instruction must begin in a
fresh Codex session. Update 2026-09-08 (E2A): E2 is now **IN PROGRESS** —
fourteen operator policy decisions were recorded (see the "E2A OPERATOR
DECISIONS RECORDED" Active State entry) — but **none of the four Gate 2 legal
drafts (privacy policy, data-collection policy, EA/NHL attribution notice,
Terms of Use) has been written yet.** Update 2026-09-08 (E2B2): operator-
supplied Cloudflare/Proton dashboard evidence was recorded, and it surfaced
an unresolved conflict between Cloudflare Web Analytics being enabled and
the approved no-analytics launch decision — see the "E2B2 CLOUDFLARE/PROTON
PROVIDER SETTINGS RECORDED" Active State entry. Update 2026-09-08 (E2B3): the
operator resolved that conflict (E1's no-analytics decision stands; Cloudflare
Web Analytics is enabled today and must be verified off before publication —
not yet done) and set a tiered contact-email retention target (30 days spam,
12 months routine, 24 months privacy/security), recorded as operator policy,
not automated Proton enforcement — see the "E2B3 ANALYTICS AND
EMAIL-RETENTION DECISIONS RECORDED" Active State entry. **E2 remains IN
PROGRESS; still none of the four legal drafts is written.**
Finishing E0-E6 is not itself permission to reopen the tunnel, which remains
its own separate, later authorization — see "Tunnel reopening" below. The
order remains load-bearing: exposure must stay verified before anything is
published. The old rationale ("the fix must be on the host before an admin
account exists on it") no longer applies — there is no admin account and no
way to create one; see the "AUTHENTICATION DELIBERATELY DISABLED" entry at the
top of Active State.

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

### C. ✅ COMPLETE (2026-09-04) — Verify the disabled account surface on the host

**Done — Stage C PASSED. See the "STAGE C COMPLETE" entry at the top of Active
State** for the verified host commit, the full image ids, the method/path/status
table, the deployed-CLI inspection, and the before/after tunnel state. Every
required check returned its required value: all seven account paths and the
sign-in POST returned 404, `/`, `/games`, `/roster` and `/stats` returned 200
with real page content (the only `404` strings in those bodies are inside
`<script>` — Next.js's own serialised `notFound` template), and the deployed
`dist/init-admin-cli.js` was confirmed to be the import-free refusal shim
**before** it was executed, then exited 1 with its refusal message. The session
was read-only apart from this file. Retained below as the record of what was
required.

Requires: B complete — **it is (2026-09-04)**. Run this against Hotel-Echo over
SSH/Tailscale (`utiz@100.98.29.119`, repo at `~/eanhl-team-website`), with the
tunnel still stopped. **There is no admin account to create, and no CLI that
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

### E0. ✅ COMPLETE (2026-09-06) — Read-only scope reconciliation

**Done.** A read-only session audited HANDOFF.md's Gate 2 checklist against
the (then) five-bullet Stage E list and found the list covered only a
fraction of Gate 2's unchecked items, understated several of the ones it did
list, and pulled in Gate 3 items not required by Gate 2. This edit is that
session's correction, applied below. **No Gate 2 or Gate 3 checkbox changed;
no evidence was invented; no waiver was granted; no decision listed under E1
was made.** The remaining work is now organized as E1-E6, an umbrella
sequence, followed by its own separate tunnel-reopening authorization — see
below.

### E1. Operator decisions and operational documentation — ✅ COMPLETE (2026-09-08)

Requires: E0 complete (it is). **E0 itself made no decisions — it was a
read-only scope reconciliation.** E1A through E1K (below) have since
recorded every operator-approved decision E1 required — hosting/backup
posture, domain registration, cost accounting, Proton capacity, the
deployment/staging/secrets/rollback model, indexing policy,
privacy/retention/repository-visibility policy (plus its execution), the
hosting-cost + system-termination map, the NHL 26/27 cutover +
career-stitching policy, and finally (E1K, 2026-09-08) the external
game-sheet frontend and the three remaining small polish items — each
explicitly marked "decided"/"documented" with a date and an Active State
entry below. **E1 is now complete: every bullet below is a closed decision,
not an open one.** Completing E1 does **not** complete Gate 2 (other Gate 2
items — product-readiness audits, etc. — remain unchecked) and does not
launch the site; it only closes the operator-decision phase. The next phase,
E2, was **NOT STARTED** at the time this entry was written, and per operator
instruction was to begin in a fresh Codex session rather than continuing this
one. **Update 2026-09-08 (E2A, that fresh session): E2 is now IN PROGRESS —
fourteen operator policy decisions were recorded, but none of the four Gate 2
legal drafts has been written.** See the "E2A OPERATOR DECISIONS RECORDED"
Active State entry and the "### E2." subsection below.

- Domain owner, registrar, renewal date, billing owner, recovery contact, and
  MFA status — **documented 2026-09-07**, from operator-supplied Cloudflare
  Registrar dashboard evidence, not independently inspected by this agent.
  See the "E1B DOMAIN REGISTRATION DOCUMENTED" Active State entry and the
  corresponding Gate 2 checklist item above.
- Production hosting posture — **decided 2026-09-07:** Hotel-Echo becomes the
  sole production host for the website, worker, PostgreSQL database, and
  persistent application data; the main PC is a temporary rollback source
  only until migration/cutover/validation succeed, then retires from
  production services (it may still run OCR when explicitly chosen, and can
  act as a secondary, opportunistic backup destination). See the "E1A
  HOSTING + BACKUP POLICY DECIDED" Active State entry. **Cost accounting
  approved 2026-09-07** (see the "E1C HOSTING COST ACCOUNTING APPROVED"
  Active State entry): Hotel-Echo hardware is already owned (no new capital
  purchase); domain renewal is a known CAD $1.18/month; Cloudflare
  DNS/Tunnel, household internet, and Proton Unlimited are treated as
  existing shared costs with no incremental site-specific charge under
  present usage, not as free services; Hotel-Echo electricity is a real,
  currently unmeasured recurring cost; and Proton Drive's available capacity
  for the E3 backup design was found **provisionally sufficient** by E1D
  under its conservative design-time model (see the "E1D PROTON CAPACITY
  PROVISIONALLY SUFFICIENT" Active State entry) — not a final,
  production-verified figure, and E3 still owns the real production ceiling
  and ongoing monitoring. **Updated 2026-09-08 (see the "E1I HOSTING COST +
  SYSTEM TERMINATION MAP DOCUMENTED" Active State entry):** the operator
  approved a provisional planning estimate in place of measured wall-power
  consumption — CAD $6.58–$22.78/month total incremental cost (domain $1.18
  + electricity $5.40–$21.60 at an assumed 50–100 W draw, CAD $0.15–$0.30/
  kWh), with a CAD $25/month round-number planning ceiling. Precise
  electricity measurement is now explicitly deferred indefinitely and does
  **not** block E1 or the Gate 2 cost checkbox, which is now checked on that
  basis. **Still open:** the migration/cutover/retirement itself, which is
  not authorized or performed by this decision or by E1I — it requires its
  own separate authorization when its turn comes — and a future re-estimate
  if hardware, workload, tariffs, or shared-service pricing materially
  changes.
- A system termination map: where the web app, worker, database, and
  persistent storage terminate is now answered by the hosting decision above
  (Hotel-Echo). DNS and TLS termination is not a blank unknown — existing
  HANDOFF evidence already records Cloudflare as the domain registrar/DNS
  provider (see the "LAUNCH POLICY + DOMAIN MAIL" Active State entry) and a
  previously tested public HTTPS connection to `boogeymen.app` used
  Cloudflare-terminated edge TLS reached via a Cloudflare Tunnel to the `web`
  service (see the "NEW HOST STOOD UP" Active State entry, `server:
  cloudflare` / valid TLS over HTTP/2). **Updated 2026-09-08 — documentation
  complete:** a precise current-state-versus-approved-target termination map
  is now recorded, consolidating those facts alongside Hotel-Echo, storage,
  and backups under the hosting posture approved above. See the "E1I HOSTING
  COST + SYSTEM TERMINATION MAP DOCUMENTED" Active State entry. **The Gate 2
  hosting-documentation checkbox is now checked** on the strength of that
  map existing — this is a documentation closure only; no live
  re-verification of DNS/TLS occurred, and the map explicitly preserves that
  the approved target architecture (Hotel-Echo as sole production host) is
  not yet the current deployed reality. Backup destination topology and key custody are now decided
  (Proton Drive primary, main PC secondary opportunistic, age-encryption
  boundary, recovery/retention targets — see the "E1A HOSTING + BACKUP POLICY DECIDED"
  Active State entry); the transport, scheduling, and acceptance-verification
  design that would actually realize that topology is E3 work and has not
  started. Exact media/location, responsible owner, Proton CLI credential
  storage, and the recovery procedure remain open implementation details to
  settle before activation.
- Secret storage, environment separation, deployment mechanism, staging
  strategy, and named rollback ownership — **decided 2026-09-07:** see the
  "E1E DEPLOYMENT/STAGING/SECRETS/ROLLBACK MODEL DECIDED" Active State entry
  and the corresponding Gate 2 checklist item above. Definition only —
  implementation, migrations, credential setup/rotation, Proton integration,
  production cutover, rollback exercise, and the DR/restore procedure remain
  open and separately authorized.
- The indexing policy (what is indexed, what is excluded) and the resulting
  excluded-route inventory — **decided 2026-09-07:** see the "E1F INDEXING
  POLICY DECIDED" Active State entry and the corresponding Gate 2 checklist
  item above. Definition only — `robots.txt`, sitemap, canonical/OG
  metadata, per-page descriptions, removing `/preview/carousel` and
  `/preview/archetypes` from the production route tree, and removing the
  public `/games?mode=dev` filter remain open Gate 3 implementation work.
- Privacy/data-use/retention decisions — **decided 2026-09-07:** see the
  "E1G PRIVACY/RETENTION POLICY + REPOSITORY VISIBILITY DECIDED" Active
  State entry. Approved: retention policy (indefinite until manual operator
  deletion/correction, across gamertags, personas, `player_name_snapshot`,
  match/stat data, raw EA payloads, structured database data, OCR evidence,
  and raw video/screenshots) and the GitHub repository-visibility decision
  (approved to make private). **Done and verified 2026-09-08:** the
  repository is now private (GitHub queried after the change reported
  `private`/`isPrivate: true`), and Hotel-Echo's authenticated read-access
  prerequisite is resolved through the already-existing read-only
  `hotel-echo-deploy` deploy key (id 162148527) — verified
  enabled/verified/read-only, and Hotel-Echo's `git ls-remote` verified
  working, both before and after the change. See the "E1H GITHUB
  REPOSITORY MADE PRIVATE" Active State entry. **Still open:** disabling
  Next.js build telemetry; Docker log retention/rotation and
  gamertag-bearing log suppression (E4 work); reviewing Cloudflare's and
  Proton's own logging/retention behavior; and drafting the privacy
  policy, data-collection policy, EA/NHL attribution notice, and Terms of
  Use (E2 work) — none of which this decision implements, drafts,
  reviews, or completes.
- The NHL 27 default-title behavior (NHL 27 has mechanically become the
  default on `/` and `/games` on both hosts — see the "NHL 27 ENABLED" Active
  State entry), the NHL 26/27 cutover rules, and the career-stat stitching
  rules across the title boundary — **policy decided 2026-09-08:** see the
  "E1J NHL 26/27 CUTOVER + CAREER-STITCHING POLICY DECIDED" Active State
  entry and the corresponding Gate 2 "NHL 27 readiness" checklist items
  above. Approved: NHL 26 deprecated for automatic ingestion (manual
  historical review continues), NHL 27 sole go-forward ingestion target and
  approved site default, Boogeymen branding unchanged, manual NHL 26 totals
  authoritative once reviewed with EA data preserved as provenance and no
  double counting, both combined-career and per-title displays kept with
  mandatory cross-title labeling and a manual identity-review safeguard
  before combining a new title into a career total, and team/club records
  kept separate per title. Definition only — **still open:** implementing the
  independent ingestion-eligibility/frontend-default/chronological-ordering
  controls, actually stopping NHL 26 automatic polling, consolidating the
  duplicated `/`, `/games`, and shared title resolvers, fixing the NHL 27
  season-order and career-range-label defects, the manual NHL 26 import and
  source-precedence implementation, the identity-review safeguard itself, and
  the E5 NHL 27 compatibility matrix and labeled benchmark (unaffected by
  this decision). **At the time this paragraph was written (2026-09-08,
  before E1K), this was not a claim that E1 was complete** — external
  game-sheet-frontend acceptance and the remaining small polish decisions
  were still open. **Superseded the same day by E1K, below: both are now
  decided and E1 is complete.**
- The external game-sheet frontend — **decided 2026-09-08: accepted as
  already integrated.** The only matching repository artifact (the
  untracked `Game sheet prototype layout (1)/` design export) was already
  ported into production through the July/August 12-phase game-sheet
  revamp — header, navbar, lineup, head-to-head drawer, Top Performers,
  DtW, box score, event timeline, action tracker, and an
  accessibility/contrast pass — which HANDOFF's own Frontend section
  already records as complete and committed. There is no separate October
  integration or duplicate port remaining. See the "E1K FINAL OPERATOR
  DECISIONS RECORDED" Active State entry for full evidence.
- The remaining small polish items — **decided 2026-09-08:** opponent
  player-score completeness is explicitly deferred as no known defect (the
  scoring pipeline and rendering are at parity with BGM; no reproducible
  failure was found); the specific recorded Top Performers contrast defect
  (the old `--fg-5` value) is closed as already fixed by the shipped color
  tokens, with a full dynamic-color audit left as an optional, non-blocking
  later spot-check; and the repeated `gameTitle.name` label beside the
  "Boogeymen" masthead (not a literally named "navbar subtitle" component)
  is decided to be removed, with the actual removal deferred to later UI
  implementation work. See the "E1K FINAL OPERATOR DECISIONS RECORDED"
  Active State entry for full evidence.

### E2. Gate 2 legal drafts, plus optional early Gate 3 web work — IN PROGRESS

Requires: the relevant E1 decisions (at minimum the privacy/data-use
disclosures) — **satisfied, E1 is complete.** **Update 2026-09-08 (E2A):** the
operator recorded the fourteen outstanding policy decisions this phase needed
(public identity, governing law/venue, children/age posture, reuse terms,
request verification/outcomes, recordings, GitHub disclosure, asset
provenance, Cloudflare/Proton conditional wording, effective date, revision
notice, contacts, and the player-name operator-attestation) — see the "E2A
OPERATOR DECISIONS RECORDED" Active State entry. **This moves E2 from NOT
STARTED to IN PROGRESS. None of the four Gate 2 legal drafts below has been
written** — E2A recorded decisions to inform the drafts, it did not draft,
review, or approve any of them. **Update 2026-09-08 (E2B2):** operator-
supplied Cloudflare and Proton dashboard settings were recorded as evidence
for decision 10's conditional wording — see the "E2B2 CLOUDFLARE/PROTON
PROVIDER SETTINGS RECORDED" Active State entry. That entry surfaced an
unresolved conflict (Cloudflare Web Analytics is enabled on the zone, which
contradicts the approved no-analytics launch decision) and an open question
(contact-email retention policy) that must be settled by the operator before
the privacy policy and data-collection policy drafts can be finalized. **This
does not add a fifth Gate 2 draft or check any checkbox; the same four drafts
below remain unwritten.** **Update 2026-09-08 (E2B3):** the operator resolved
both open questions — see the "E2B3 ANALYTICS AND EMAIL-RETENTION DECISIONS
RECORDED" Active State entry. The E1 no-analytics decision is preserved;
Cloudflare Web Analytics remains enabled today and must be verified off
before publication (not yet done, and not performed by that session). A
tiered contact-email retention target (30 days spam, 12 months routine, 24
months privacy/security) was adopted as operator policy, not as an automated
Proton control. **Still no fifth Gate 2 draft, no checked checkbox; the same
four drafts below remain unwritten.**

**Gate 2 requires only drafts**, informed by E1 (and now E2A/E2B2):

- privacy policy draft;
- data-collection policy draft (gamertags, statistics, accounts, server/IP
  logs, retention, third-party processors actually used);
- EA/NHL non-affiliation and third-party asset/data attribution notice draft;
- Terms of Use draft. **Not drafted, reviewed, or approved by this entry** —
  added to scope only; no substantive terms are proposed here.

**Publishing and the surrounding web surface are Gate 3 items, not Gate 2**,
listed here only because they may be started early if desired: publishing the
drafted pages as live routes (including the Terms of Use once drafted), a
global footer with a working webmaster contact that links privacy,
data-collection, Terms of Use, and attribution/non-affiliation pages,
security response headers, and the indexing/discovery
implementation approved by the "E1F INDEXING POLICY DECIDED" Active State
entry — specifically `robots.txt`, a sitemap containing only the approved
canonical URLs (including canonical game-detail and player-detail URLs),
canonical/OG metadata, per-page descriptions, `noindex, follow` on
query-driven (filter/mode/role/view/opponent/title/pagination) variants,
removing `/preview/carousel` and `/preview/archetypes` from the production
route tree, and removing the public `Dev` filter/`/games?mode=dev` behavior
from `/games`. **None of this is implemented yet** — E1F decided the policy,
not the code. If any of it is done during E2, label it explicitly as early
Gate 3 work in the Active State entry that records it — do not count it
against Gate 2, and do not describe Gate 2 as requiring published pages.

The correction/deletion request process is already decided (`webmaster@
boogeymen.app`, 7-day acknowledgement, 30-day resolution — see the "LAUNCH
POLICY + DOMAIN MAIL" Active State entry); publishing it on the site is the
Gate 3 half of that item.

### E3. Backup and restore — PRODUCER + ACCEPTANCE VERIFIED IN ISOLATION ONLY

Requires: the relevant E1 decisions (destination, key custody) — **decided
2026-09-07.** See the "E1A HOSTING + BACKUP POLICY DECIDED" Active State
entry for the approved topology (Hotel-Echo as backup source; Proton Drive as
the primary off-host destination, whose availability does not depend on the
main PC being powered on — not a claim that Proton or network connectivity
can never be unavailable, since failed transfers queue/retry and freshness
thresholds detect prolonged failure; the main PC as a secondary, opportunistic
destination whose availability must never gate the daily independent-backup
check), the age-encryption-before-upload and
ciphertext-only-upload requirements, the approved recovery/retention targets
(6-hour production cadence, 6-hour RPO, 8-hour RTO, 7-day 6-hourly / 30-day
daily / 12-month monthly retention, 8-hour warning / 24-hour critical
staleness thresholds on verified Proton copies), and the approved
key-custody constraints (Hotel-Echo holds only the age public recipient;
one encrypted offline private-key copy plus one separately protected
recovery copy; Proton must never be sole custodian of both the archive and
every usable key copy). **This is policy only — none of it is implemented.**
See also the "E1D PROTON CAPACITY PROVISIONALLY SUFFICIENT" Active State
entry (2026-09-07): Proton's reported 510 GB free is provisionally
sufficient for design purposes against a conservative ~350 GiB worst-case
retention estimate (~70 retained points at the current example
`staging.maxStagingBytes = 5 GiB`), leaving ~125 GiB of theoretical headroom
— a design-time estimate only, not a completed E3 capacity proof, a
permanent guarantee, or evidence of Proton's actual deletion/trash/version
behavior. The bullets below are otherwise unchanged by either decision and
still describe what remains to design and build in E3:

**Already implemented and verified, but only in isolation** — see the
"BACKUP PRODUCER + DESTINATION ACCEPTANCE VERIFIED IN ISOLATION" Active State
entry: the producer (snapshot, dump, validate, encrypt, bounded staging, run
lock) and the destination acceptor both pass their full suites (56/56
acceptance, 165/165 overall) against disposable temp filesystems. **The
remaining work below is incomplete/unactivated — none of it has been run
against a real host, and none of it is implied by the E1A policy decision:**

- transport (how an artifact actually leaves Hotel-Echo for Proton Drive and,
  opportunistically, the main PC) — not designed, not implemented;
- key-custody implementation specifics — topology and constraints are
  decided (see above), but exact media/location, responsible owner, Proton
  CLI credential storage, and the recovery procedure remain open
  implementation/documentation details to settle before activation; no key
  has been generated;
- real production capacity ceiling and ongoing monitoring — the `5 GiB`
  `staging.maxStagingBytes` figure is the current proposed/example
  configuration only, not a finalized production value; E3 must set the real
  ceiling, characterize Proton's actual deletion/trash/version-retention
  behavior and any non-backup usage sharing the quota, preserve operational
  headroom, and add continuous capacity monitoring — none of this exists yet,
  and the E1D provisional-sufficiency conclusion above does not substitute
  for it;
- Proton Drive integration and account authentication — not started. The
  2026-09-05 Active State record reported that `age` was absent and no
  keypair existed on either host, and that no Proton integration had been
  implemented in the repository. E1A performed no installation,
  authentication, or key generation, but it also did not recheck either
  host — current host installation state was not reverified during this
  local-only, documentation-only session;
- scheduling/activation: the producer has a CLI (`ops/backup/eanhl-backup.mjs`);
  the destination acceptor has no CLI/entry point; neither side has a
  deployed systemd unit or timer, and nothing is installed, configured, or
  activated on a real host;
- production of a real artifact and its acceptance by the real destination;
- cloud-acceptance verification design: per the E1A decision, a successful
  upload command alone will not be treated as sufficient — proving Proton
  actually accepted and retains the artifact requires its own verification
  design, not yet started;
- freshness evaluation, retention/pruning (6-hourly/daily/monthly per the
  approved targets above), and alerting on backup health — not implemented;
- the restore drill itself: recover into a disposable database and verify
  critical table counts and representative application reads.

### E4. Monitoring, logging, rollback, and disaster recovery — NOT STARTED

Requires: the relevant E1 decisions (notification destination, rollback
ownership).

- Stale-worker alerting: `apps/worker/src/health.ts` already computes and
  exposes staleness (`GET /health`); nothing currently polls it externally or
  notifies anyone.
- Transform-error visibility: alerting on accumulating
  `raw_match_payloads.transform_status='error'` rows — not implemented.
- Ingestion-gap visibility: detecting "worker alive, capturing nothing"
  (distinct from staleness) before data is lost — not implemented.
- A configured notification destination for all of the above.
- Bounded log retention/rotation: the tracked `docker-compose.yml` sets no
  per-service `logging:` size/file limit, so effective retention depends on
  each host's Docker daemon configuration. Neither host's daemon logging
  configuration was inspected during E0 — host configuration must be
  inspected before claiming whether logs are actually bounded or unbounded.
- Recorded production rollback and disaster-recovery procedures, beyond the
  existing redeploy/rebuild steps in DEPLOY.md and the `docker-redeploy`
  skill.

### E5. NHL 27 and product-readiness audits — NOT STARTED

Requires: the relevant E1 decisions (cutover rules, stitching rules).

- Per-parser NHL 27 beta compatibility matrix. Only the match/player/
  aggregate transform path has been verified against real NHL 27 data (5
  matches so far — see the "NHL 27 ENABLED" entry); OCR/game-sheet parsers
  have not yet run against any NHL 27 footage.
- A small labeled NHL 27 benchmark. This does not necessarily require waiting
  for new matches — if suitable NHL 27 footage already exists, it can be
  labeled now; if it doesn't, capture is a separate, elapsed-time-bound step.
- Verification of the NHL 26/27 career-stat stitching rules decided in E1,
  before production cutover.
- Mobile drawer/menu audit; core-route viewport audit at 320/375/390/768 and
  desktop; production performance baselines; page title/description audit.
- Any remaining product decisions or polish not already resolved in E1.

### E6. Final Gate 2 reconciliation — NOT STARTED

Requires: E1-E5, to whatever extent each is actually going to close before
the gate date.

Every Gate 2 checkbox above must end this stage either checked with recorded
evidence, or explicitly waived by the operator with a written reason, owner,
and follow-up date, per the existing Completion Rule. **No waiver has been
granted by this edit or any prior session** — E6 is where that determination
gets made and recorded, not before.

---

## Tunnel reopening — separate authorization, not part of E0-E6, NOT AUTHORIZED

Reopening the tunnel is not a stage of E0-E6 and does not happen automatically
when E0-E6 close. It requires its own explicit authorization, decided
separately, after the applicable gates have passed. **It is not authorized by
this document.** The procedure below is retained as the record of what it
requires when that authorization is eventually given — it is not a to-do list
for the current or next session:

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
