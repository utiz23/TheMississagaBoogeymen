# Data Collection Policy — DRAFT

> **Status: revised working draft. Unpublished. Not legally reviewed.** The
> AI-assisted review this draft was revised against (recorded in
> `data-collection-policy-review.md`) is issue-spotting, not legal advice or
> legal sign-off. **Do not publish, link, or route this document until the
> internal checks at the bottom of this file are all satisfied and
> independent review by counsel is complete.**

---

## Data Collection Policy

**Effective date:** [PLACEHOLDER — actual publication date, not yet set]
**Last updated:** [PLACEHOLDER — actual publication/revision date]

Boogeymen — a community gaming club — publishes this policy to explain what
information this website collects or maintains, where it comes from, why we
keep it, and how you can ask about or correct it.

### 1. Scope and launch posture

This is a public, read-only community gaming-club website. It publishes
statistics and history for our EA Sports NHL Pro Clubs team. The project is
currently operated by a single individual on a volunteer basis; that
describes who runs it day to day, not a conclusion about its legal form or
about which privacy law, if any, applies to it.

- No active public account system is offered at launch. Visitors cannot
  register or log in. Dormant authentication software and database schema
  for accounts exist in the underlying codebase but are disabled — see
  "Accounts and authentication" below.
- There is no on-site account, form, upload, comment, or submission
  feature at launch. You cannot submit content through this site, though
  you can still voluntarily send us information through project email —
  see the information categories below and "Accounts and authentication"
  below.
- There is no advertising.
- No monetization or other commercial activity exists on this site, and
  none is planned. If that changes, we intend to carry out a fresh privacy
  review before any commercial activity begins.
- Our intended posture at launch is **no analytics and no nonessential
  tracking**. Where that is not yet true on the day you are reading this
  (see "Cookies, browser storage, and analytics" below), we will say so
  plainly rather than describe the site as already meeting that posture.

### 2. Information we collect or maintain

We maintain the following categories of information, drawn mostly from EA's
game services and our own team members' review and correction of that data:

- **Gamertags and gamertag history.** Current and prior gamertags used to
  identify players across matches over time.
- **Approved display names and personas.** Where a player's profile name is
  entered manually by our team rather than pulled verbatim from EA, that
  name is an operator-attested, member-approved display name or alias
  chosen for identification purposes. We do not request or verify legal
  names for player-profile identification. This does not mean legal-name
  or other personally identifying information is impossible to encounter
  elsewhere in what we retain: email correspondence, attachments,
  recordings, screenshots, or other raw evidence a person sends us or that
  we capture could incidentally contain someone's name or other
  information they choose to provide. We have not inspected every retained
  item to confirm this, and do not claim it is absent.
- **Member agreement to publication.** Current members of our club have
  verbally agreed that their gamertags, profiles, and statistics may be
  published and used as described in this policy. This is a record of the
  verbal agreement our operator understands members to have given; it is
  not written consent, legal clearance, or a statement that this agreement
  is legally sufficient under any particular law.
- **Roster membership.** Which players belong to our club, and for what
  periods.
- **Match results and metadata.** Scores, dates, game mode, and related
  match details for games our club played.
- **Team and player statistics.** Skater and goalie statistics compiled from
  match data.
- **Derived hockey metrics, scores, summaries, and classifications.** Values
  we calculate from the underlying match and player statistics — for
  example, performance scores and summary classifications — are also
  maintained as part of the statistical record.
- **Opponent-club and opponent-player information.** Because Pro Clubs
  matches involve two teams, our records necessarily include the opposing
  club's name and the opposing players' gamertags and statistics for the
  matches they played against us. This includes an EA-provided stable
  persona identifier for each player, so our records can link the same
  opponent's appearances over time.
- **Raw EA-provided data.** We store the raw data returned by EA's game
  services verbatim before we process it, so that we can correct or
  reprocess it later without having lost the original source.
- **OCR (optical character recognition) extractions and related evidence.**
  For some matches, we extract additional statistics from screen recordings
  using automated image/text recognition. This includes the extracted text
  values, supporting evidence, confidence information, review status, and
  records of where each extracted value came from.
- **Source recordings, screenshots, and extracted video frames.** Underlying
  video recordings, screenshots, and individual frames used as OCR source
  material or as an evidentiary record for the statistics we publish.
- **Party voice chat captured in team recordings.** Our gameplay recordings
  may incidentally include in-game party voice chat. This audio is captured
  only as a by-product of recording gameplay for our statistics and
  evidentiary purposes — we do not currently analyze it, use it for any
  separate purpose, or publicly display it. Current participants in our
  recorded sessions know that gameplay may be recorded and have verbally
  agreed to that. We do not claim that every possible future participant
  has agreed, and we do not claim that an opponent or other third party can
  never be present in a recorded voice channel. We do not publish where any
  participant is located. Recordings and any incidental audio they contain
  are kept under the retention approach described in "How long we keep
  information" below. We have not inspected every recording's contents and
  do not claim to know what any specific recording does or does not
  contain.
- **Website access, operational, error, and security logs.** This site,
  its hosting stack, and its security providers may generate access,
  operational, error, and security records in the course of operating and
  securing the site. Our repository and configuration evidence does not
  establish that every such category of log is actually generated, what
  its exact fields are, or what retention each host or provider applies in
  practice. See "How long we keep information" below for how we treat logs
  under our control, and "Service providers and other parties" for logs
  controlled independently by our providers.
- **Email correspondence sent to our project addresses**, which may
  include the sender's email address, the sender's display name, message
  contents, attachments, and any evidence you provide to verify a request
  (for example, to establish that you control a gamertag you're asking us
  to correct or remove).
- **A limited set of authentic source fixtures retained in our private
  GitHub repository**, used for testing and development. See "Service
  providers and other parties" below.

### 3. Where this information comes from

- EA's Pro Clubs game and service interfaces, which return match, player,
  and club data.
- Recordings and screenshots captured by our own team members during our
  matches.
- Automated OCR processing of those recordings and screenshots.
- Manual review and correction by our team's operator(s) — for example,
  fixing a misread gamertag or approving a display name.
- Correspondence sent to our project email addresses.
- Ordinary requests made to our public website and the infrastructure and
  security processing that supports it.

This site is not affiliated with, endorsed by, or sponsored by Electronic
Arts, EA Sports, the NHL, the NHLPA, or their affiliates. It is an
independent, community-run project. A separate attribution and
non-affiliation notice covers EA-sourced content and third-party marks in
more detail; this policy is not that notice.

### 4. Why we use this information

We use the information described above only to:

- Operate this public website.
- Display our team's history, games, rosters, and statistics.
- Produce, verify, and correct derived hockey statistics.
- Maintain a historical and evidentiary archive of our team's matches.
- Diagnose errors and keep the site's infrastructure secure.
- Develop, test, validate, and maintain this website and its data and OCR
  processing pipeline, including using a limited set of authentic source
  fixtures for testing, provenance, and regression verification.
- Respond to privacy, correction, removal, and security-related requests.
- Maintain provenance and auditability — i.e., being able to show where a
  published number came from and correct it if it's wrong.

We do not use this information to measure website traffic or user behavior
as an approved purpose at launch. See "Cookies, browser storage, and
analytics" below for the current state of an analytics feature that
conflicts with that posture and must be resolved before publication.

### 5. Public display and search-engine indexing

The public site displays gamertags, approved display names/aliases, roster
membership, match information, statistics, opponent-club and
opponent-player information, and derived metrics described above.

Our indexing policy: canonical public pages (such as the home page, game
pages, roster pages, and stats pages) are meant to be indexable by normal
search engines. Filter, sort, pagination, and other query-variant URLs,
along with diagnostic or non-public surfaces, are not meant to be indexed
as separate content.

Public display of statistics is distinct from our retention of private raw
data and OCR evidence (recordings, screenshots, frames, confidence and
review-state information): the raw evidence is not published; only the
resulting statistics and match information are.

### 6. Cookies, browser storage, and analytics

Our website's own application source code does not directly use
`localStorage`, `sessionStorage`, browser cookies, or `indexedDB`. This
describes our own code; it is not a claim that no browser storage of any
kind is ever used by any underlying framework, dependency, or
infrastructure component.

Our hosting/security provider (Cloudflare) may, under some circumstances,
use strictly necessary cookies or similar mechanisms as part of its edge
security or challenge processing. We do not currently have specific,
verified information about any individual cookie Cloudflare may set, so we
are not naming one here.

**Cloudflare Web Analytics is currently enabled on this site's Cloudflare
configuration.** Cloudflare describes its Web Analytics product as
cookie-free — it says the product does not use cookies or client-side
storage to collect metrics. However, having any analytics feature enabled
does not match the no-analytics posture described in "Scope and launch
posture" above. **We intend to disable Cloudflare Web Analytics before this
site is published, and this policy will not claim "no analytics" as a
current fact until that has been verified from our live Cloudflare
dashboard.** See the internal checklist below.

We do not plan to show a cookie-consent banner while our posture is "no
nonessential tracking," but whether a banner is legally required in any
particular jurisdiction is a legal-review question, not one this policy
resolves for itself.

### 7. Accounts and authentication

No active public account system is offered at launch: this site does not
currently offer account creation or login. There is also no on-site form,
upload, comment, or other submission feature — see "Scope and launch
posture" above, including for how you can still reach us voluntarily by
email. Dormant authentication software is present in the underlying
codebase but is deliberately disabled: the reachable authentication API
refuses every request, and no login or account page is served.

Our database structure is *capable* of storing account information,
session details (including IP address and browser/user-agent information),
authentication tokens, and credentials — because the underlying software
includes an authentication feature we have chosen not to activate. This is
a statement about database *capability*, not about current *contents*; we
are not asserting these fields are currently populated with visitor data,
because no accounts can currently be created.

If we activate authentication in the future, we will conduct a fresh
privacy review and update this policy before doing so.

### 8. Service providers and other parties

We use the following third-party services to operate this site. This
section describes their role for us; it is not a formal legal
classification of any provider as a "processor," "controller," or similar
term, which remains a legal-review question.

- **Cloudflare** — our domain registrar and DNS provider, and the proxied
  edge/network layer (including our Cloudflare Tunnel) that routes traffic
  to our server and provides security processing (such as its managed
  security ruleset). Cloudflare's own edge-level log retention is not
  something we have independently verified; we describe it only in general
  terms until we do.
- **Proton Mail** — our email provider. All of our project addresses
  (`webmaster@boogeymen.app`, `security@boogeymen.app`, and an internal-only
  address) deliver into a single Proton mailbox under one operator account.
  We do not use mail forwarding, a catch-all address, Proton Mail Bridge, a
  third-party mail client, or any export or separate backup of this
  mailbox's contents.
- **GitHub** — hosts our private source-code repository, which also
  contains a limited set of authentic data fixtures used for testing. This
  repository was public for part of its history; copies made by others
  during that period cannot be recalled by us.
- **Electronic Arts (EA)** — the source of the underlying game data and
  some visual assets referenced by this site. EA does not endorse, and is
  not affiliated with, this project.
- **Our hosting infrastructure** is community-operated from Alberta,
  Canada. We do not claim that every service we use stores or processes
  information only in Canada — see "Location and cross-border handling"
  below.

Fonts used by this site (Barlow and Barlow Semi Condensed) are downloaded
and self-hosted as part of our build process rather than requested by your
browser from Google at page-load time, based on how our font loading is
currently configured.

### 9. How long we keep information

- We keep gamertags, approved display names/aliases, match and statistics
  data, raw EA-provided data, structured database records, OCR evidence,
  and source recordings/screenshots/frames for as long as we reasonably
  need them for the purposes described in "Why we use this information"
  above — principally to maintain an accurate, verifiable historical and
  evidentiary archive of our team's matches, and for the other purposes
  listed there. We do not apply an automatic expiry to this category. This
  does not mean deletion is impossible, and it does not mean every item
  must always be kept: removal happens by manual operator action, including
  in response to a request (see "Requests and corrections" below). We have
  not adopted a scheduled periodic review of this archive. Describing
  retention this way is a description of our current practice, not a
  statement that indefinite retention has been legally reviewed or
  approved.
- **Logs under our control** do not currently have a fixed automatic
  deletion period. We retain them only for as long as reasonably needed to
  operate, secure, troubleshoot, or protect the website, or to meet
  applicable legal obligations. We delete them when they are no longer
  reasonably needed for those purposes.
- **Logs controlled independently by service providers** are subject to
  those providers' practices and retention periods.
- **Correspondence sent to our project email addresses** is retained under
  the following operator targets, reviewed at least annually:
  - Obvious spam or junk: approximately 30 days.
  - Routine correspondence: up to 12 months after the last action needed on
    it.
  - Privacy, correction, security, and incident-related correspondence
    (including evidence sent to verify a request — see "Requests and
    corrections" below): up to 24 months after the matter is closed.
  - Any of the above may be kept longer only while reasonably necessary for
    an active legal, dispute, investigation, or security purpose.
  These are our own manually-applied targets, not settings automatically
  enforced by our email provider.
- Our email provider's own internal retention behavior (for example,
  anything it retains independently of our mailbox) is not something we
  have independently verified.
- We plan to keep periodic encrypted backups of our data. **That backup
  system is not active yet**, and this policy will not describe backup
  retention as a current fact until it is implemented and verified. Once
  backups are active, we expect corrections you request to be reflected in
  new backups going forward; we do not plan to individually rewrite
  already-created encrypted backup copies, which will instead expire under
  our normal backup-retention schedule over time.

### 10. Requests and corrections

To ask about, correct, or otherwise raise a question about information we
hold about you, contact the **Privacy Contact for Boogeymen** at
**`webmaster@boogeymen.app`**.

- We aim to acknowledge requests within **7 days**.
- We aim to resolve, or provide a substantive response to, requests within
  **30 days**. Where a privacy law that applies to us sets its own deadline
  for a request, we intend to meet that deadline as well; our own targets
  above are meant to be at least as fast.
- We do not charge a fee for access or correction requests.
- We may ask for reasonable evidence that you control the gamertag or
  identity in question. We do not request government-issued ID by default.
- **Access, correction, withdrawal, and removal are different things, and
  we treat them differently:**
  - *Access* means asking what we hold about you.
  - *Correction* means asking us to fix an error or omission in information
    we hold about you. Where correcting information you raised is
    something we're required to do under a law that applies to us, we'll
    do it; if we decide not to make a correction you've asked for, and the
    law requires it, we will note your requested correction alongside the
    information we hold.
  - *Withdrawal* means telling us you no longer agree to something you
    previously agreed to (for example, a member withdrawing agreement to
    have new statistics published going forward). If you do this, we will
    explain what it means in practice, stop what we are required to stop,
    and tell you what we keep and why.
  - *Removal* is considered case-by-case, not automatic. Whether we remove,
    de-identify, or otherwise change information depends on applicable law
    and on our legitimate need to keep an accurate archival record of our
    team's history. We do not promise removal in every case, and we do not
    rule out that applicable law may require it in a given case. The fact
    that information was previously published by EA through its own game
    services is not, by itself, a reason for us to refuse a request.
- Because our records are about matches involving several people, some of
  what we hold about you may be mixed together with information about
  others. Where applicable law requires it, we will give you the parts
  that are about you and hold back the parts that would reveal someone
  else's information.
- Evidence you send us to verify a request is used only to verify and
  handle that request. We do not add it to our published statistics
  record. We do not promise to delete it immediately; where we keep it, it
  is kept under the same privacy/correction-correspondence retention
  category described in "How long we keep information" below.
- If a copy of our data (including from a period when our source repository
  was public) has already been taken by someone else, we cannot recall or
  delete that copy — our removal only affects what we ourselves publish and
  retain going forward.
- If a privacy law that applies to us gives you a right to ask a regulator
  to review how we handled your request, we want you to be able to use it.
  In Alberta, that regulator is the Office of the Information and Privacy
  Commissioner of Alberta (`oipc.ab.ca`). We mention this as the applicable
  route where Alberta's *Personal Information Protection Act* governs a
  request; mentioning it is not a statement that this project's activities
  are conclusively covered by that Act.

### 11. Children and opponents

Team membership on this site is adult-only. No children are, or are
planned to be, members of our club.

Some of the opponents we play against in matches may include minors. We do
not know their ages, cannot verify them, do not collect them, and have no
way to determine them from the information EA's game services provide. This
site does not ask any visitor or opponent for age information, and does not
offer user accounts or submissions at launch.

### 12. Location and cross-border handling

Our club is community-operated from Alberta, Canada. We do not claim that
every team member lives in Alberta, or in any other specific place — team
members are located in various places, and we do not publish individual
member locations.

Because we use Cloudflare, Proton Mail, GitHub, EA's services, and the
ordinary infrastructure of the internet, information may be processed or
transmitted outside Alberta or Canada as part of how those services work.
We do not have verified information about the exact physical storage
locations each of these providers uses, and we do not claim otherwise.

### 13. Accuracy, security, incidents, and changes to this policy

We make a reasonable effort to keep the information we publish accurate,
and we investigate and correct it, where appropriate, when an error is
reported to us or that we otherwise notice.

We take reasonable steps to protect the information we maintain, but no
website or storage system can guarantee absolute security. If personal
information we hold is lost, or accessed or disclosed without
authorization, in a way that creates a real risk of harm to someone, we
will carry out any incident reporting or notification that applicable law
requires of us. This policy does not set out our internal incident-response
procedure.

Our source code repository is now private, but copies made during any
earlier public period cannot be recalled — see "Service providers and
other parties" above.

We will post an on-site notice when we make a material change to this
policy, and this page will always show the date it was last updated at the
top.

**Contact:**

- General, privacy, data, and correction requests: **Privacy Contact for
  Boogeymen**, `webmaster@boogeymen.app`
- Security vulnerability reports only: `security@boogeymen.app`

---

## Internal drafting and publication checks — not part of the public policy

This section is for our own use while finishing this draft. **It must be
removed, or this entire file must not be published as-is, before this
policy goes live.**

**Revision provenance.** This draft was revised at HANDOFF's E2D4 against
the corrected E2D2A independent review
(`docs/planning/data-collection-policy-review.md`) and the E2D3
operator-decisions entry. E2D2A's findings and E2D3's decisions are treated
as authoritative for this pass; this revision does not itself constitute
independent factual/legal review and does not resolve any of the
still-open questions listed below.

### Publication blockers (must all be true before this policy is published)

1. **Cloudflare Web Analytics must be disabled and dashboard-verified off.**
   As of the most recent recorded check (HANDOFF.md, "E2B2"/"E2B3" entries,
   2026-09-08), Web Analytics ("Enable, excluding visitor data in the EU")
   is **enabled**, contradicting the site's approved no-analytics posture.
   Do not publish this policy — or change section 6's framing to a flat "we
   use no analytics" — until an operator session confirms from the live
   Cloudflare dashboard that Web Analytics is off.
2. **Replace both placeholder dates** ("Effective date" and "Last updated")
   with the actual Gate 3 publication date before this page goes live.
3. **Reverify hosting/cutover facts for the actual publication
   environment.** This draft describes the *intended* architecture per
   HANDOFF's E1 decisions (Hotel-Echo as eventual sole production host;
   Alberta-based infrastructure). Confirm which host is actually serving
   traffic at the time of publication and that section 8/12's framing still
   matches reality — HANDOFF records that migration/cutover had not
   happened as of this draft's writing (E1I termination map, 2026-09-08).
4. **Check actual cookie behavior on the deployed site** before finalizing
   section 6. This draft relies on (a) a source-code grep showing no direct
   `localStorage`/`sessionStorage`/`document.cookie`/`indexedDB` use in our
   own application code, and (b) Cloudflare's own published description of
   Web Analytics as cookie-free. Neither is a live-site cookie audit of the
   deployed, publicly served pages. Do that audit before publication.
5. **Reconcile section 9's backup language with whatever E3 has actually
   implemented** by publication time. As of this draft, per HANDOFF's E3
   section, backups are "producer + acceptance verified in isolation only"
   — no transport, scheduling, activation, or real-host backup exists yet.
   If that has changed by publication, update section 9 accordingly (and if
   it hasn't changed, leave the "not active yet" framing as-is — do not let
   it silently go stale in the other direction either).
6. **Legal review of this entire draft is required and has not happened.**
   This document was produced by AI drafting sessions against repository
   and HANDOFF evidence, including an AI-assisted independent review
   (E2D2/E2D2A). Neither is legal advice, and neither has been reviewed by
   anyone with legal expertise. Per E2D3 item 14, counsel review is
   **deferred, not completed**. Do not publish, and do not check the
   Gate 2 "Data Collection Policy" checkbox, until that review is complete.
7. **Applicable-law determination remains UNRESOLVED (E2D2A F-01/F-02;
   E2D3 item 1).** Which privacy statute, if any, governs this project has
   not been established — it depends on legal-form facts (E2D2A Q-1) that
   have not been recorded. Per E2D3, conservative drafting continues to
   assume the most demanding plausible obligations until this is resolved.
8. **Opponent-player collection, publication, and retention basis remains
   UNRESOLVED (E2D2A F-07/F-08; E2D3 item 8).** No operator decision covers
   the legal basis for opponent-player publication. Reliance on the PIPA
   Reg 366/2003 s.7 "publicly available" exception is not presently
   established, and it is equally not established that it can never apply
   — that determination requires counsel's field-by-field assessment. Do
   not record a permanent rejection or acceptance of the exception in any
   future session.
9. **Recording-law fact pattern remains UNRESOLVED (E2D2A F-30; E2D3
   item 6).** E2D3 recorded the underlying facts (who may be captured,
   participant awareness/agreement, absence of a visible recording
   indicator, participant locations in Alberta/Ontario/Massachusetts), but
   those facts have not been put to counsel and no jurisdiction or
   conflicts-of-law conclusion has been drawn. Do not add any statement to
   the public policy asserting that any recording is lawful.
10. **Actual logging inventory required before publication (E2D2A F-14;
    E2D3 item 12, Q-12).** Section 9's log-retention wording is now
    purpose-based rather than a 30-day target, but nobody has verified
    which logs actually exist across Docker, the web app, the worker, the
    database, the tunnel, and provider-controlled systems, or whether the
    described manual practice actually occurs. Do that read-only inventory
    before publication rather than treating the new wording as
    self-verifying.
11. **Provider processor/controller/service-provider classification
    remains UNRESOLVED (E2D2A F-24; E2D3 item 4, Q-4).** Cloudflare,
    Proton, and GitHub are used to support this project — that is the only
    fact recorded. No data-processing agreement, contractual term, or
    processor/controller/service-provider classification has been
    established. Do not assign one in a future drafting session without
    counsel.
12. **Outside-Canada country list remains an internal completion item
    (E2D2A F-24; E2D3 item 4).** Do not manufacture a list of countries or
    purposes for outside-Canada handling in any drafting session; source it
    from each provider's own current documentation only once the s.6(2)
    applicability and classification questions above are resolved.
13. **All internal-status narration, including "Gate 2"/"Gate 3" wording,
    must be removed from every public section before publication**, and
    the section 6 analytics variant swap (E2D2A F-34) must be executed as
    a deliberate publication step once analytics is disabled and
    dashboard-verified off.

### Current-vs-target discrepancies deliberately left visible in the draft above

These are called out explicitly rather than smoothed over, per instruction:

- **Analytics.** The draft's section 1 states the *intended* launch posture
  ("no analytics and no nonessential tracking") while section 6 discloses
  that Cloudflare Web Analytics is *currently* enabled. This is intentional
  — the draft does not claim the intended posture is already true.
- **Hosting/cutover.** Section 8 describes Alberta-based infrastructure
  generally, without asserting that Hotel-Echo is currently the live
  production host — per HANDOFF's E1I termination map, that cutover has
  not happened as of this draft.
- **Indexing implementation.** Section 5 now states the approved public
  indexing policy plainly (canonical pages indexable; query-variant and
  non-public surfaces excluded) without inventorying implementation status.
  The technical pieces that carry it out — `robots.txt`, a sitemap, and
  per-page metadata — are **not yet in place** as of this draft (E2D2A
  F-42). Do not read section 5 as evidence that indexing controls have
  already been deployed; complete and verify this work before publication.
- **Backups.** Section 9 explicitly states the backup system is "not active
  yet," reflecting E3's current isolated-verification-only status rather
  than the target state.
- **Log retention.** Section 9 now states purpose-based retention for logs
  under our control, superseding the earlier ~30-day target per HANDOFF
  E2D3 item 12. This wording does not claim automated deletion exists,
  does not claim which logs currently exist, and does not claim any logs
  have already been deleted. `docker-compose.yml` still configures no
  per-service logging driver or retention limit (HANDOFF, E2A
  factual-corrections bullet and E4 section) and neither host's Docker
  daemon configuration has been inspected — see publication blocker 10.
- **Fonts.** Section 8's Google Fonts framing relies on `next/font/google`
  self-hosting fonts at build time rather than serving them from Google at
  request time — this is standard Next.js `next/font` behavior and matches
  the "build-produced" framing already used in HANDOFF's E2C2 asset entry,
  but it has not been independently re-verified in this drafting session
  beyond that prior repository finding.

### Factual uncertainties this draft deliberately preserves (not resolved by assumption)

- Cloudflare's own internal edge-log retention duration — unverified
  (HANDOFF, E2B2/E2B3).
- Cloudflare Web Analytics' own data-retention duration — unverified.
- The exact legal effect of "cookie-free" analytics on any consent-banner
  requirement — left to legal review, not asserted either way.
- Whether any Cloudflare security/challenge mechanism issues a cookie in
  practice — not named specifically, because no specific cookie has been
  documented or observed on the deployed site.
- Whether party voice chat is actually present in any specific recording —
  not claimed either way; only that recordings may contain it and current
  participants are aware and have verbally agreed.
- Opponent-minor status — explicitly stated as unknown/unverifiable/not
  collected, per operator instruction, with no age threshold invented.
- Exact provider-side physical storage locations (Cloudflare, Proton,
  GitHub, EA) — not asserted as Canada-only or otherwise pinned down.
- Whether Cloudflare, Proton, and GitHub qualify as "service providers"
  under PIPA s.6(2)/s.13.1 — not established; a factual and legal
  classification question, not an operator label (E2D2A F-24, Q-4).

### Asset/attribution boundary (per E2C5 — do not reopen here)

E2C5 (HANDOFF, 2026-09-09) settled that all existing visual assets (EA
X-Factor artwork, EA opponent crests, platform marks, SVG-derived icons,
fonts, BGM/SPD branding) remain retained exactly as-is; that is a retention
decision, not legal clearance, and none of it is reopened, reclassified, or
described as "cleared" by this draft. Section 3 above gives only a short
pointer to a separate attribution/non-affiliation notice — this draft does
not attempt to be that notice, and does not restate or alter any E2C3/E2C4/
E2C5 asset classification.

### Gate 2 status

**Not checked.** This revision (E2D4) applies the E2D3 operator decisions
to the draft's public text. It is a drafting pass, not independent
factual/legal review, and it does not resolve the unresolved
applicable-law (F-01/F-02), opponent-data (F-07/F-08), recording-law
(F-30), or provider-classification (F-24/Q-4) questions. The Gate 2 "Data
Collection Policy" checkbox remains intentionally unchecked pending
counsel review.
