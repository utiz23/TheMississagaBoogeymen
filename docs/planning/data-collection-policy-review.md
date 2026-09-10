# Data Collection Policy — Independent Legal/Factual Gap Review (E2D2)

> **Status: AI-assisted issue-spotting review. NOT legal advice, NOT a legal
> review sign-off, NOT clearance to publish.** This document was produced by an
> AI session working from the repository, `HANDOFF.md`, and official Alberta,
> Canadian, Massachusetts and regulator primary sources. It does not constitute
> advice from retained counsel, it does not certify compliance with any statute,
> and it does not satisfy the "Legal review of this entire draft is required and
> has not happened" blocker recorded inside
> `docs/planning/data-collection-policy-draft.md`. That blocker remains open.

> **Revision note (E2D2A).** This review has been corrected. Its first version
> overstated several legal conclusions — most importantly by treating
> operational duties as if they were duties to publish particular wording on the
> public policy page, and by closing questions that only counsel can close. §12
> lists every correction made and why. Where this version is less definite than
> the first, that is the correction, not an omission.

**Review date:** 2026-09-09 · **Corrected:** 2026-09-09 (E2D2A)
**Reviewed artifact:** `docs/planning/data-collection-policy-draft.md` (E2D initial draft)
**Baseline:** `main` at `65bcddb43145d2fcffaeafb4d97d0e1a2737c35f`
**Reviewer scope:** read-only as to the draft. The policy draft was not edited.
No code, asset, test, configuration, script, or dependency was modified. No
Cloudflare, Proton, GitHub, host, or database account was accessed. No Gate 2
checkbox was changed.

---

## 1. Executive verdict

**The draft is unusually honest and factually careful, and it is not
publishable in its current form.**

Its strengths are real and should be preserved: it separates intent from
current fact, it attributes provider claims to the provider rather than
adopting them, it declines to assume permission or clearance, and it carries
its own publication blockers visibly instead of hiding them. On raw factual
accuracy against the repository, it is close to clean — every repository-level
claim this review independently checked held up.

The problem is not accuracy. It is that the draft was written as a *disclosure*
document — an honest description of what the project holds — before the project
determined which statute governs it and what that statute actually requires it
to do, as opposed to requires it to publish. Three consequences follow.

1. **The applicable-law question is open, and the answer depends on facts
   nobody has recorded.** Alberta's *Personal Information Protection Act*
   applies to "every organization and in respect of all personal information"
   (s.4(1)) and is not gated on commerce. An unincorporated association is
   expressly an "organization" (s.1(1)(i)(ii)) and, if that is what Boogeymen
   is, it may be fully subject to the Act. Whether that is what Boogeymen is —
   as opposed to an individual acting in a personal or domestic capacity, or a
   body that qualifies for reduced application under s.56 — is not established
   anywhere in the repository or `HANDOFF.md`. **Working assumption for
   drafting purposes only: plan as though PIPA applies in full.** That is a
   planning posture chosen because it is the most demanding plausible branch,
   not a determination that it is correct.

2. **The draft does not explicitly map a lawful basis to each category of
   information it describes.** It is not the case that the draft does nothing
   here — §10's EA sentence, §11's opponent posture, and §2's conditional
   framing all reflect real care, and members and voluntary email
   correspondents sit in materially different positions from opponents. What is
   missing is an explicit, category-by-category statement of which consent
   provision, statutory exception, or reasonable-purposes analysis is being
   relied on. That mapping is primarily internal work; how much of it should
   appear in public text is a separate question. Consent that has not been
   documented is not inferred anywhere in this review.

3. **The draft's request section describes house practice without the
   statutory scaffolding behind it.** §10 says what the operator will *try* to
   do. Separately from what the policy page should say, PIPA ss.24–32 impose
   real duties on how a request is processed and what a response must contain —
   including, in a refusal, the s.46 review right. Those duties bind the
   operator's *responses and procedures* whether or not the policy page
   mentions them. Publishing a plain-language summary of the rights is a strong
   recommendation and good practice; it is not, on the sources reviewed here, a
   statutory requirement that this particular webpage carry each item.

There is also one **factual risk this draft does not address at all**:
`HANDOFF.md` records that "most team members are in Massachusetts, USA," while
the draft's treatment of recorded party voice chat rests entirely on the
proposition that a team member who is present authorized the recording. One
participant's authorization does not settle recording law in every jurisdiction
where the other participants sit. This review identifies the statute
(Massachusetts G.L. c. 272 §99) and the facts that would drive any analysis of
it, and **makes no Massachusetts and no conflicts-of-law conclusion** — see
F-30.

**Gate verdict.**

- **Gate 2 (draft acceptance):** NOT READY. Three BLOCKER findings and six
  OPERATOR INPUT REQUIRED findings — together raising twelve operator
  questions — must be resolved or consciously accepted before this draft is a
  defensible Gate 2 deliverable. The Gate 2 "Data Collection Policy" checkbox is
  correctly unchecked and this review does not change it.
- **Gate 3 (publication):** NOT READY. The draft's own six publication blockers
  remain live, and this review adds five more.

**Counts (47 findings):** 3 BLOCKER · 6 OPERATOR INPUT REQUIRED ·
22 MATERIAL CORRECTION · 8 RECOMMENDATION · 8 ACCEPTABLE AS WRITTEN.
Separately, **12 operator questions** (Q-1 to Q-12) require answers.
These counts supersede the first version's 5 / 5 / 20 / 9 / 8 and its ten
questions; §12 of this review explains every reclassification.

---

## 2. Official sources used

All sources are primary legislation, regulation, or guidance published by the
issuing government or regulator. No law-firm article, blog, commercial summary,
forum, or AI/search summary was relied on for any conclusion in this document.
All accessed **2026-09-09**.

| ID | Title | Issuing body | URL | Currency shown | Sections relied on |
|----|-------|--------------|-----|----------------|--------------------|
| S1 | *Personal Information Protection Act*, SA 2003 c P-6.5 (Office Consolidation) | Alberta King's Printer | https://kings-printer.alberta.ca/documents/Acts/P06P5.pdf | "Current as of September 1, 2025" | ss. 1(1)(i), 1(1)(k), 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 13.1, 14, 16, 17, 19, 20, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 34.1, 35, 36, 37.1, 46, 47, 56 |
| S2 | *Personal Information Protection Act Regulation*, Alta Reg 366/2003 | Alberta King's Printer | https://kings-printer.alberta.ca/documents/Regs/2003_366.pdf | "Consolidated up to 147/2026" | ss. 6, 7, 8, 19, 19.1 |
| S3 | *Personal Information Protection and Electronic Documents Act*, SC 2000 c 5 | Justice Laws Website (Dept. of Justice Canada) | https://laws-lois.justice.gc.ca/eng/acts/P-8.6/page-1.html | "Act current to 2026-06-21 and last amended on 2025-03-04" | ss. 2(1) ("commercial activity", "organization", "personal information"), 4(1), 4(2) |
| S4 | *Organizations in the Province of Alberta Exemption Order*, SOR/2004-219 | Justice Laws Website | https://laws-lois.justice.gc.ca/eng/regulations/SOR-2004-219/FullText.html | Registered 2004-10-12; "Regulations are current to 2026-06-21" | s. 1 |
| S5 | *Regulations Specifying Publicly Available Information*, SOR/2001-7 | Justice Laws Website | https://laws-lois.justice.gc.ca/eng/regulations/SOR-2001-7/FullText.html | Registered 2000-12-13; "current to 2026-06-21" | s. 1(a)–(e) |
| S6 | *Criminal Code*, RSC 1985 c C-46, s. 184 (Interception) | Justice Laws Website | https://laws-lois.justice.gc.ca/eng/acts/C-46/section-184.html | "current to 2026-06-21 and last amended on 2026-06-15" | s. 184(1), 184(2)(a) |
| S7 | *Criminal Code*, s. 193 (Disclosure of information) | Justice Laws Website | https://laws-lois.justice.gc.ca/eng/acts/C-46/section-193.html | Same consolidation as S6 | s. 193(1), 193(2) |
| S8 | *Guidelines for obtaining meaningful consent* | Office of the Privacy Commissioner of Canada, **jointly issued with** OIPC Alberta and OIPC British Columbia | https://www.priv.gc.ca/en/privacy-topics/collecting-personal-information/consent/gl_omc_201805/ | Page "Date modified: 2025-08-11"; URL slug indicates original issue May 2018 | "Consent and children"; "Appropriate purpose" |
| S9 | *Minor Sports Associations* (guidance) | Office of the Information and Privacy Commissioner of Alberta | https://oipc.ab.ca/resource/minor-sports-associations/ | **No publication or revision date displayed on the page as fetched** | PIPA application to sports organizations; s. 56 non-profit definition; what is / is not a commercial activity |
| S10 | *Personal information for non-profits and other organizations* | Government of Alberta (Alberta.ca) | https://www.alberta.ca/personal-information-for-non-profits-and-other-organizations | **No publication or revision date displayed on the page as fetched** | PIPA s. 56 application by incorporation form; donations are not a commercial activity |
| S11 | *General Laws* c. 272 §99 (Interception of wire and oral communications) | The 194th General Court of the Commonwealth of Massachusetts (malegislature.gov) | https://malegislature.gov/Laws/GeneralLaws/PartIV/TitleI/Chapter272/Section99 | Official General Laws publication as fetched | B(4) definition of "interception"; C(1) offence |

**Source limitations recorded rather than papered over.**

- S9 and S10 display no date. They are used only as regulator/government
  *interpretive* material that is consistent with the statutory text in S1/S2,
  never as the sole basis for a conclusion.
- S11 is cited to **identify the statute and the facts that would matter**
  under it. This review does **not** analyse Massachusetts law, does not decide
  whether it applies to any recording made by this project, and does not
  perform any conflicts-of-law analysis. See F-30.
- Cloudflare's and Proton's own documentation was **not** re-fetched. The draft
  already attributes those claims to the provider, which is the correct
  treatment, and E2B2 records the provider-documentation basis. No independent
  provider fact is asserted here.
- No provision quoted here has been read against case law. Statutory text can
  be qualified by judicial interpretation this review has not examined.

---

## 3. What kind of requirement is this? — the distinction the first version blurred

Almost every overstatement corrected in this revision came from collapsing six
different things into one. They are kept apart for the rest of this document,
and every finding is tagged with the categories it touches.

| Tag | Category | What it means | Who satisfies it, and where |
|-----|----------|---------------|-----------------------------|
| **[PUB]** | Public-policy wording | Text that should appear on the published Data Collection Policy page | The drafting session, in the public document |
| **[NOTICE]** | Collection notices | What must be said to an individual **at or before the point of collection** (PIPA s.13, s.13.1) | Wherever collection actually happens — a contact page, a mail footer, a form — not necessarily the policy page |
| **[RESP]** | Access/correction responses | What a **response to a particular request** must contain (PIPA ss.28–32, especially s.29) | The operator's reply to that individual, driven by an internal template |
| **[INT]** | Internal policies and procedures | Policies and practices the organization must **develop, follow, and hold** (PIPA s.6(1)–(2)), available on request (s.6(3)) | An internal document, not automatically a published one |
| **[COUNSEL]** | Counsel-dependent determination | A legal conclusion this review is not permitted and not competent to reach | Retained counsel, on facts the operator supplies |
| **[CHECK]** | Pre-publication factual check | A fact that must be re-verified against reality immediately before publishing | A Gate 3 verification session |

**The rule this review now applies:** a statutory duty is not treated as a duty
to publish particular wording on the public policy page unless the cited
provision expressly requires that publication. Several provisions the first
version treated as publication requirements are, on their own terms,
requirements about internal policies (s.6), about notices given at collection
(s.13, s.13.1), about the contents of a response to a request (s.29), or about
the contents of a breach report to the Commissioner (Reg s.19). Those duties are
real and are recorded here — they are simply recorded against the right target.

Two consequences worth stating plainly, because they cut in opposite
directions:

- Several items were **downgraded** as publication blockers (the privacy-contact
  role title, the Commissioner review right, the outside-Canada country list).
  They remain genuine obligations somewhere else, and in most cases they remain
  strong recommendations for the public page.
- Nothing was downgraded as an *obligation*. Moving the s.46 review right from
  "the policy page must say this" to "every applicable refusal response must say
  this" makes it harder to forget, not easier.

---

## 4. Applicable-law decision tree

This tree is **conditional**. It is not a determination that any statute
applies. Nodes marked **[OPERATOR FACT NEEDED]** cannot be resolved from the
repository or `HANDOFF.md`, and the branch that ultimately applies depends
entirely on facts that have never been recorded.

```
START: Who is the collecting/publishing entity?
│
├─ (A) A single individual, acting alone, in a personal or domestic capacity?
│      PIPA s.1(1)(i): "organization" ... "does not include an individual
│      acting in a personal or domestic capacity."
│      PIPA s.4(3)(a): Act does not apply to collection/use/disclosure "for
│      personal or domestic purposes of the individual and for no other
│      purpose."
│      → PIPA may not apply.
│      ⚠ BUT: the exclusion requires personal/domestic purposes "and for no
│        other purpose." Operating a public website that publishes third
│        parties' (opponents') identifiers and statistics may be difficult to
│        characterise as personal/domestic-only. The draft is written in the
│        first-person plural throughout ("our team members", "our club", "our
│        operator(s)"), which reads as a collective — but drafting voice is not
│        evidence of legal form.  [OPERATOR FACT NEEDED — Q-1]
│
├─ (B) An unincorporated association / club (a natural reading of
│      "Boogeymen — a community gaming club")?
│      PIPA s.1(1)(i)(ii): "organization" includes "an unincorporated
│      association."
│      PIPA s.4(1): "this Act applies to every organization and in respect of
│      all personal information."  ← NOT gated on commercial activity.
│      PIPA s.56(1)(b): "non-profit organization" means an organization
│      (i) incorporated under the Societies Act or the Agricultural Societies
│      Act, or registered under Part 9 of the Companies Act, **or (ii) "that
│      meets the criteria established under the regulations to qualify as a
│      non-profit organization."**
│      → An unincorporated club that meets neither limb would not be a s.56
│        "non-profit organization", so the s.56(2) exclusion and the s.56(3)
│        commercial-activity limit would not apply to it, and PIPA would apply
│        to all personal information it holds.
│      OIPC Alberta (S9) states the same in terms: organizations that operate
│      on a non-profit basis but do not meet the s.56 definition "are fully
│      subject to PIPA", and in that case the Act "applies to all personal
│      information held by these organizations."
│      → PLAUSIBLE ON THE FACTS AS RECORDED, AND NOT ESTABLISHED.
│        [OPERATOR FACT NEEDED — Q-1]
│
└─ (C) A body that qualifies as a s.56 "non-profit organization" — whether by
       incorporation/registration under s.56(1)(b)(i) or by meeting
       regulation criteria under s.56(1)(b)(ii)?
       PIPA s.56(2): the Act does not apply to it, EXCEPT
       PIPA s.56(3): it does apply to personal information collected, used or
       disclosed "in connection with any commercial activity."
       → In that case, and only in that case, the recorded absence of
         monetization (E2C5 decision 1) becomes load-bearing: with no
         commercial activity, s.56(3) would not pull the handling back in, and
         PIPA's application to the project's non-commercial handling would be
         narrowed.
       ⚠ Stated precisely: **qualifying s.56 status may narrow PIPA's
         application to non-commercial handling.** This review makes no claim
         about whether pursuing that status would reduce the project's overall
         burden — that depends on the obligations any chosen legal form brings
         with it, which are outside this review's scope. Whether to pursue any
         legal form is a decision for the operator and counsel, and this review
         does not recommend one.  [COUNSEL]

────────────────────────────────────────────────────────────────────────────
SEPARATE QUESTION: does PIPEDA apply?

PIPEDA s.4(1)(a): applies to organizations in respect of personal information
they "collect, use or disclose in the course of commercial activities."
PIPEDA s.2(1): "commercial activity" means "any particular transaction, act or
conduct or any regular course of conduct that is of a commercial character."
PIPEDA s.4(2)(b): does not apply to an individual collecting/using/disclosing
for personal or domestic purposes.
PIPEDA s.4(2)(c): does not apply to an organization for journalistic, artistic
or literary purposes.

├─ No commercial activity (the recorded position: E2C5 decision 1, "No
│  monetization currently or planned for launch"; and per Alberta.ca (S10),
│  "Accepting donations for charitable purposes is not a commercial
│  activity"; per OIPC (S9), membership fees, team registration fees, rosters
│  and distribution lists, and website advertising *of the association's own
│  activities* are "not likely to be commercial")
│  → PIPEDA Part 1 likely does NOT apply.
│  **This is where "no monetization" does real work.** It is relevant to
│  PIPEDA's application and to PIPA s.56(3). It is not a universal exemption
│  from privacy law, and it does not answer the PIPA question in branch (B).
│
└─ Any commercial activity now or later (merchandise, sponsorship, paid
   access, advertising sold to third parties, licensing or sale of the
   dataset, sale/barter of a membership or contact list)
   → PIPEDA Part 1 may apply, AND
   → SOR/2004-219 s.1 exempts an Alberta PIPA-subject organization from
     PIPEDA Part 1 only "in respect of the collection, use and disclosure of
     personal information that occurs within the Province of Alberta."
   → Commercial handling that crosses a provincial or national border may fall
     outside that exemption. Where any given act of collection legally
     "occurs" for this purpose is a legal characterisation, not an operator
     preference; the operator supplies the locations and data flows (Q-9) and
     counsel characterises them.  [COUNSEL]
   [OPERATOR FACT NEEDED — Q-2, Q-9]

────────────────────────────────────────────────────────────────────────────
DOES ANY s.4(3) PIPA EXCLUSION APPLY?

s.4(3)(b) artistic or literary purposes "and for no other purpose" — unlikely
   on these facts, and not assessed further.
s.4(3)(c) journalistic purposes "and for no other purpose" — a statistics and
   provenance archive for a private club appears a poor fit, and the trailing
   words "and for no other purpose" would complicate a mixed-purpose claim.
   Do not plan around it.
s.4(3)(h)/(i) — deceased 20+ years / records 100+ years old — not applicable.
→ No exclusion is apparent to this review. That is an issue-spotting
  observation, not a determination; counsel may see arguments this review does
  not. Do not treat any of these as a planned defence, and do not treat their
  absence as settled.  [COUNSEL]
```

**Bottom line for the drafting team:** adopt branch (B) — PIPA applies in full
— as a **conditional working assumption for drafting**, because it is the most
demanding plausible branch and drafting to it wastes nothing if a lighter
branch turns out to apply. Replace the assumption with a determination once the
operator supplies the Q-1 facts and counsel characterises them.

---

## 5. Factual-accuracy matrix — all 13 public sections

Verdict key: **VERIFIED** = independently checked against repository or
`HANDOFF.md` this session · **CONSISTENT** = matches a recorded operator
decision, not independently re-derivable · **INCOMPLETE** = accurate but
omits something a duty elsewhere requires · **STALE-RISK** = accurate today,
will be false or misleading by publication.

| § | Section | Factual verdict | Notes / evidence |
|---|---------|-----------------|------------------|
| 1 | Scope and launch posture | **VERIFIED** + self-declared internal contradiction | No submission surface: the only routes under `apps/web/src/app` are `/`, `/games`, `/games/[id]`, `/roster`, `/roster/[id]`, `/stats`, two `/preview/*` pages, and the `/api/auth/[...all]` tombstone — no form, upload, or comment route exists. "No monetization" matches E2C5 decision 1. The "intended posture … no analytics" statement is contradicted by §6 by design; see F-34. |
| 2 | Information we collect or maintain | **VERIFIED**, one **INCOMPLETE** item | Category list matches the schema (`packages/db/src/schema/`: gamertags, rosters, matches, player/opponent match stats, raw payloads, OCR evidence/decoder runs/capture batches). Logging framed conditionally, matching E2A. **Understates opponent data** — see F-43. |
| 3 | Where this information comes from | **VERIFIED** | Sources match the worker/OCR pipeline and E2A. Non-affiliation paragraph is correct but misplaced — F-45. |
| 4 | Why we use this information | **CONSISTENT** | Purposes match E2A/E1G. **No explicit per-category lawful-basis mapping** — F-07. |
| 5 | Public display and search-engine indexing | **CONSISTENT** + **STALE-RISK** | Matches E1F. Confirmed no `robots.txt` or `sitemap` file exists under `apps/web`. Narrates internal gate status in a public document — F-42. |
| 6 | Cookies, browser storage, and analytics | **VERIFIED** + **STALE-RISK** | Independently re-ran the grep: zero matches for `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB` across `apps/web/src`, `apps/worker/src`, `packages/*/src`. Zero Cloudflare-beacon references in `apps/web/src` or `apps/web/public`. Analytics-enabled disclosure matches E2B2/E2B3. Will be stale on the day analytics is disabled — F-34. |
| 7 | Accounts and authentication | **VERIFIED** | `apps/web/src/app/api/auth/[...all]/route.ts` is a tombstone returning 404 for GET/POST/PATCH/PUT/DELETE/HEAD/OPTIONS and imports nothing. `packages/db/src/schema/accounts.ts` does contain `ip_address`, `user_agent`, `token`, `access_token`, `refresh_token`, `id_token`, `password`, and `token_hash` columns — the "capability, not contents" framing is accurate. |
| 8 | Service providers and other parties | **VERIFIED** / **INCOMPLETE** | Cloudflare/Proton/GitHub facts match E2B2, E1H, E1G. Font claim verified: `apps/web/src/app/layout.tsx:2` imports `Barlow` and `Barlow_Semi_Condensed` from `next/font/google`, which self-hosts at build time. `docker-compose.yml` confirms a `cloudflared` service. **Outside-Canada countries and authorized purposes are absent from the project's policies and practices** — F-24. |
| 9 | How long we keep information | **CONSISTENT** / **INCOMPLETE** | Matches E1G, E2B3, E1A. `docker-compose.yml` confirmed to set no `logging:`, `log-opt`, `max-size` or `max-file` — the "not enforced" admission is accurate. **Omits the ~12-month backup tail** (F-15); the 30-day log target needs a factual check (F-14). Framing tension with PIPA s.35(1) — F-13. |
| 10 | Requests and corrections | **CONSISTENT** / **INCOMPLETE** | 7-day / 30-day targets match the "LAUNCH POLICY + DOMAIN MAIL" entry and E2A. **Describes house practice without the statutory response mechanics behind it** — F-17 to F-22. This is the section needing most work. |
| 11 | Children and opponents | **CONSISTENT** / **INCOMPLETE** | Matches E2A decision 3 and the launch-policy entry exactly, and correctly invents no age threshold. **Does not address the absence of any recorded consent from opponents** — F-29. |
| 12 | Location and cross-border handling | **CONSISTENT** / **INCOMPLETE** | Matches E1I and the launch-policy entry; correctly does not publish individual member locations. Interacts with s.6(2) (F-24) and s.13.1 (F-25). The unpublished fact that most members are in Massachusetts drives F-30. |
| 13 | Security and changes to this policy | **CONSISTENT** / **INCOMPLETE** | Accurate. Breach handling (F-38), complaint route (F-18), withdrawal of consent (F-39), and accuracy (F-40) are not addressed. |

**No factual error was found in any of the 13 sections.** Every defect below is
an omission, a legal-structure gap, a staleness risk, or a framing issue.

---

## 6. Findings

Severity key — **BLOCKER** (a Gate 2 decision blocker; the draft cannot be
accepted until it is resolved or consciously accepted) · **OPERATOR INPUT
REQUIRED** (cannot be resolved by a drafting agent) · **MATERIAL CORRECTION**
(concrete change needed somewhere — the category tag says where) ·
**RECOMMENDATION** (quality/clarity) · **ACCEPTABLE AS WRITTEN**.

Category tags are those defined in §3: **[PUB]** public-policy wording ·
**[NOTICE]** collection notices · **[RESP]** access/correction responses ·
**[INT]** internal policies and procedures · **[COUNSEL]** counsel-dependent
determination · **[CHECK]** pre-publication factual check.

### Q1 — Applicable-law boundary

---

**F-01 · BLOCKER · [COUNSEL] [INT] · Gate 2**
**Draft section:** Whole document. The project has not determined which privacy
statute governs it.
**Repository/HANDOFF evidence:** E2A decision 2 records "Alberta law governs"
as a *governing-terms* choice for the legal drafts; no entry records a
determination of statutory applicability. E2C5 decision 1: "No monetization
currently or planned for launch."
**Official source:** S1 PIPA s.4(1) — "this Act applies to every organization
and in respect of all personal information"; s.1(1)(i)(ii) — "organization"
includes "an unincorporated association"; s.1(1)(i) — excludes "an individual
acting in a personal or domestic capacity"; s.56(1)(b)(i) and (ii), s.56(2),
s.56(3). S9 (OIPC Alberta): organizations operating on a non-profit basis that
do not meet the s.56 definition "are fully subject to PIPA."
**Why it matters:** Most other findings are downstream of this one, and the
answer is genuinely open. If PIPA applies in full, the project needs a
designated responsible individual (s.5(3)), policies and practices meeting
s.6(1)–(2), a consent-or-exception basis (s.7), response mechanics
(ss.28–32), and breach procedures (s.34.1). If a lighter branch applies, some
of those become good practice rather than duty. Drafting further without
settling it risks wasted work in either direction.
**Proposed resolution:** Obtain the operator facts in Q-1, Q-2 and Q-9, put
them to counsel, and record the resulting determination in a `HANDOFF.md`
entry. Until then, draft to the conditional working assumption in §4 (branch B)
because it is the most demanding plausible branch. Do **not** add a sentence to
the public policy asserting that a statute does or does not apply — the policy
should describe practices and rights, not adjudicate its own coverage.

---

**F-02 · MATERIAL CORRECTION · [INT] · Gate 2**
**Draft section:** §1 — "We do not currently use, and do not plan to use at
launch, any monetization on this site."
**Repository/HANDOFF evidence:** E2C5 decision 1.
**Official source:** S1 PIPA s.4(1) (application not gated on commerce);
s.56(2)–(3) (exclusion, and its commercial-activity limit, available to s.56
non-profit organizations); S3 PIPEDA s.4(1)(a) (commercial activities); S10
(donations are not a commercial activity).
**Why it matters:** The statement is true and worth keeping. The correction is
about what it is *for*. Absence of monetization is directly relevant to whether
PIPEDA applies, and to s.56(3) if the project is or becomes a s.56 non-profit
organization. It is not a general exemption from privacy law, and it does not
resolve PIPA's application under branch (B).
**Proposed resolution:** Keep the sentence in the public text unchanged. Record
internally: *"No monetization is relevant to PIPEDA's application and to PIPA
s.56(3). It does not by itself determine whether PIPA applies."* This is an
internal correction, not a public one.

---

**F-03 · RECOMMENDATION · [INT] · Neither gate**
**Draft section:** §12 — cross-border handling.
**Official source:** S3 PIPEDA s.4(1)(a), s.2(1); S4 SOR/2004-219 s.1
(exemption limited to handling "that occurs within the Province of Alberta").
**Why it matters:** If the project ever monetizes — merchandise, sponsorship,
paid access, or licensing the dataset — PIPEDA may attach to handling that
crosses a provincial or national border, notwithstanding the Alberta exemption
order. That is a foreseeable future state, not a hypothetical.
**Proposed resolution:** Do not add anything to the public policy. Record in
`HANDOFF.md` that introducing any commercial activity is a trigger for a fresh
privacy review, alongside the existing authentication-activation trigger
already recorded in §7 of the draft and in E1G.

---

**F-04 · OPERATOR INPUT REQUIRED · [COUNSEL] · Gate 2**
**Draft section:** N/A — missing facts.
**Why it matters:** The applicability tree cannot be closed without them.
**Proposed resolution:** Answer Q-1, Q-2, and Q-9 in §9 of this review. These questions
ask for facts and locations only; the legal characterisation of those facts is
reserved to counsel.

---

### Q2 — Identity and accountability

---

**F-05 · MATERIAL CORRECTION · [INT] (required) + [NOTICE] + [RESP] + [PUB] (recommended) · Gate 3**
**Draft section:** Preamble — "Boogeymen — a community gaming club"; §10 and
§13 — `webmaster@boogeymen.app` as the only contact.
**Repository/HANDOFF evidence:** E2A decision 1 — "Publish as 'Boogeymen — a
community gaming club,' contactable through `webmaster@boogeymen.app`. No
operator legal name or postal address is published at this stage." E2A decision
13 — contact routing.
**Official source:** S1 PIPA s.5(3) — "An organization must designate one or
more individuals to be responsible for ensuring that the organization complies
with this Act." s.13(1)(b) — a **collection notice** must give "the name or
position name or title of a person who is able to answer on behalf of the
organization the individual's questions about the collection."
s.29(1)(c)(ii) — a **response refusing access** must give "the name of the
person who can answer on behalf of the organization the applicant's questions
about the refusal"; s.29(2)(b)(i) likewise for a refusal under s.24(1)(b). S2
Reg s.8(2)(a) — **if** an organization designates an office to receive access
and correction requests, it "must make public the address of that office and the
methods by which that office can receive requests" (Reg s.8(1) makes designating
such an office optional: an organization "may designate").
**What each provision actually requires — kept separate:**
- **[INT]** s.5(3) requires an internally designated responsible individual.
  This is a real, presently applicable duty if PIPA applies. It says nothing
  about publishing that person's identity.
- **[NOTICE]** s.13(1)(b) applies to a collection notice, and expressly permits
  "the name **or position name or title**" — so a role title suffices where
  that provision applies. Note s.13(4): s.13(1) does not apply to collection
  under s.8(2) (information volunteered for the purpose), which covers much of
  this project's direct-from-individual collection.
- **[RESP]** s.29 governs the contents of particular responses, not the policy
  page.
- **[PUB]** No provision reviewed here requires the general policy page to
  publish a role title. Doing so is nonetheless a sensible and cheap
  transparency measure.
**Why it matters:** The first version of this review treated an unattributed
mailbox as a defect on the policy page, and cited s.29 and the breach
regulations as proof. That was wrong as to target. The genuine gap is the
**internal** s.5(3) designation, which is not recorded anywhere. The public
role title is a good idea, not a proven statutory requirement for this page.
**Proposed resolution:** Record internally (not publicly) which individual holds
the s.5(3) designation — this is the required step. Separately, and as a
**recommendation**, publish a role rather than a person: for example *"Privacy
requests are handled by the Privacy Contact for Boogeymen, reachable at
`webmaster@boogeymen.app`."* "Privacy Contact for Boogeymen" is a sensible
proposed public role; it does not automatically satisfy every context in which a
name, position name, or title is required, and each such context (collection
notices, s.13.1 notices, individual responses, breach reports) should be checked
on its own terms. Whether a legal name, association form, or mailing address
must additionally be published is a question for counsel — see Q-3. Do **not**
invent or guess any operator identity detail. Note also that Reg s.8's
publish-the-address duty is triggered only by choosing to designate an office;
not designating one avoids it.

---

**F-06 · OPERATOR INPUT REQUIRED · [COUNSEL] · Gate 3**
**Draft section:** Preamble — the publishing entity is identified only by a
trade-style name with no legal form.
**Official source:** S1 PIPA s.5(1) ("An organization is responsible for
personal information that is in its custody or under its control"); S2 Reg
s.8(1)–(2) (optional designation of a request office; if designated, its address
must be made public).
**Why it matters:** An individual exercising an access or correction right, or
filing a complaint with the Commissioner, benefits from knowing who the
responsible organization is. "A community gaming club" names no legal person.
Whether more must be published is a legal question interacting with the
operator's decision not to publish a postal address.
**Proposed resolution:** Operator + counsel to decide (Q-3) whether to publish
(a) a legal or association name, (b) a mailing address, and (c) whether to
designate a request office under Reg s.8 — noting that (c) is optional and
carries the Reg s.8(2)(a) publication consequence if chosen. Until then the
draft's current minimal identification should be treated as provisional, not
settled. This review does not add or guess any private operator information.

---

### Q3 — Consent, exceptions, and reasonable purposes

---

**F-07 · BLOCKER · [INT] (required) + [COUNSEL] + [PUB] · Gate 2**
**Draft section:** §4 "Why we use this information" — lists purposes; the draft
does not explicitly map a consent provision, statutory exception, or
reasonable-purposes analysis to each category of information in §2.
**Repository/HANDOFF evidence:** E1G — "Opponent consent is not characterized
as known in either direction by this or any prior session." E2A decision 14 —
member display names are operator-attested member-approved aliases.
**Official source:** S1 PIPA s.7(1) — an organization "shall not" collect,
collect from another source, use, or disclose personal information without
consent "[e]xcept where this Act provides otherwise"; s.8(1) express consent;
s.8(2) deemed consent where the individual "voluntarily provides the
information … for that purpose" and it is reasonable that a person would;
s.8(3) opt-out consent with notice; s.14 / s.17 / s.20 the without-consent
exceptions; ss.11/16/19 the reasonableness limits; s.2 the reasonable-person
standard.
**Why it matters:** The precise defect is the absence of an explicit,
category-by-category basis mapping — not an absence of any lawful basis. The
categories are in materially different positions and must not be discussed as
one undifferentiated block:
- **Members** (gamertags, aliases, roster, stats, recordings they provide):
  s.8(1) express or s.8(2) deemed consent are the plausible routes. E2A decision
  14's operator attestation that display names are member-approved is evidence
  of member awareness. **No consent record is described anywhere, and this
  review does not infer consent that has not been documented.**
- **Voluntary email correspondents:** s.8(2) deemed consent for the purpose for
  which they wrote is the natural analysis, bounded by s.8(4). This is the
  strongest-positioned category.
- **Recordings / party voice chat:** see F-09 and F-30. Distinct issues:
  whether the recording was lawfully made, and whether retaining the audio is
  authorised.
- **Opponents:** see F-08. No basis is presently identified, and this is the
  weakest-positioned category.
Getting this mapping written down is a Gate 2 prerequisite because it may
change the project's design, not merely its text.
**Proposed resolution:** Record the mapping **internally first**, per category,
naming the provision relied on and what evidence supports it. Put the mapping to
counsel. Only then decide how much of it belongs in public text — a policy page
does not normally recite statutory subsections, and this review does not
recommend that it do so. Concretely and within the operator's control:
**collecting a short written consent from every current member before
publication** would move the largest category from undocumented to documented at
near-zero cost. Do not publish a bare assertion of "consent" for any category
where none was obtained.

---

**F-08 · BLOCKER · [COUNSEL] + [INT] + [PUB] · Gate 2 and Gate 3**
**Draft section:** §2 — "Opponent-club and opponent-player information …
our records necessarily include the opposing club's name and the opposing
players' gamertags and statistics"; §5 — those are publicly displayed; §9 —
retained indefinitely.
**Repository/HANDOFF evidence:** `packages/db/src/schema/opponent-player-match-stats.ts`
stores `ea_player_id` (`text('ea_player_id').notNull()` at line 44, documented
as the "EA Pro Clubs persona ID … **Stable across matches**") together with
`gamertag` (line 48) and a full per-match statistical row. **This repository
finding stands and is independently verified.** E1G: opponent consent unknown in
either direction.
**Official source:** S1 PIPA s.1(1)(k) — "personal information" means
"information about an identifiable individual"; s.7(1)(a),(b),(d) — consent
required to collect, to collect from a source other than the individual, and to
disclose; s.12 — collection from another source permitted only where s.14, 14.1,
15 or 22 allows; s.14(e) / s.17(e) / s.20(j) — "the information is publicly
available **as prescribed or otherwise determined by the regulations**". S2 Reg
s.7 — "personal information **does not come within** the meaning of … publicly
available **except** in the following circumstances", then **six** categories:
(a) a telephone directory entry meeting three conditions including an opt-out;
(b) a professional or business directory, listing or notice, available to the
public, where the collection/use/disclosure "relates directly to the purpose for
which the information appears"; (c) a Government or non-governmental registry,
used for the registry's established purpose; (d) a record of a quasi-judicial
body available to the public, used for the purpose the information appears
there for; (e) "the personal information is contained in a publication,
including, but not limited to, a magazine, book or newspaper, whether in printed
or electronic form, but only if (i) the publication is available to the public,
and (ii) it is reasonable to assume that the individual that the information is
about **provided that information**"; **(f) personal information under an
organization's control collected from outside Alberta that, if collected within
Alberta, would have fallen under (a)–(e).** Federally, S5 SOR/2001-7 s.1(a)–(e)
is comparable in structure.
**Why it matters:** This is the central legal exposure in the project, and it is
unresolved in both directions. The exception is defined restrictively and its
list is closed, so reliance on it cannot be assumed. Equally, **this review does
not conclude that EA-service visibility can never qualify** — that would require
a source-specific and field-by-field analysis this review has not performed and
is not competent to perform. The three data types in play are not alike and must
be assessed separately:
- **User-selected gamertags** — chosen and entered by the individual. The
  "provided that information" limb in Reg s.7(e) is at its most arguable here,
  and would turn on whether the EA surface in question is "a publication …
  available to the public" and on the purpose limb.
- **EA-assigned persona identifiers** (`ea_player_id`) — assigned by EA, not
  chosen or supplied by the individual. The "provided that information" limb
  looks materially harder for this field.
- **Gameplay-generated statistics** — produced by the operation of the game,
  not "provided" by the individual in any ordinary sense. Harder again.
The draft is to its credit careful *not* to assert the exception. It also does
not identify an alternative, while the schema shows the project maintains a
**persistent, cross-match identifier** for each opponent — materially more than
the draft's description conveys (F-43).
**Proposed resolution:** Two things, in order.
1. **Reliance on the publicly-available exception is not presently
   established.** Do not build the draft on it, and do not assert it in public
   text, unless and until counsel assesses it field-by-field and
   source-specifically and advises that it is available. Equally, **do not
   record a permanent rejection of the exception**: a future session must be
   free to act on counsel's assessment either way. What should be recorded is
   the current status — untested, not relied on.
2. Put the substantive options to the operator and counsel (Q-10): (a) proceed
   on a considered basis with counsel's assessment of the relevant exceptions
   and of ss.11/16/19 reasonableness; (b) de-identify or pseudonymise opponent
   players in the public display while retaining the raw payload privately for
   provenance (technically feasible — opponent identity is already isolated on a
   single table and is not linked into the `players` identity model); or
   (c) publish opponent *club* results without per-opponent-player rows. Option
   (b) is the smallest change that materially reduces exposure while preserving
   the archive and the "never discard raw data" convention. **This review does
   not choose among them and does not reopen any settled decision — no operator
   decision currently covers opponent-player publication.** Opponent-player
   collection and publication remains a serious unresolved Gate 2 issue.

---

**F-09 · OPERATOR INPUT REQUIRED · [INT] + [COUNSEL] · Gate 2 and Gate 3**
**Draft section:** §2 — "Party voice chat captured in team recordings. …
This audio is present only in recordings made and provided by our own team
members who authorize the recording."
**Repository/HANDOFF evidence:** E2A decision 7 — recordings stay under the
approved indefinite-until-manual-deletion retention policy; "Do not claim code
inspection proves recording contents." E1G — indefinite retention of raw OCR
source videos and screenshots.
**Official source:** S1 PIPA s.7(1) (consent to collect/use/disclose);
s.1(1)(k) (personal information); ss.11/16 (reasonable purposes and reasonable
extent); s.35(1) (retention only as long as reasonably required).
**Why it matters:** The recording team member's authorization covers that
member. Whether it supplies a basis for other voices captured in the same party
channel is not established. Separately, the audio serves none of §4's stated
purposes: statistics, provenance, verification, and OCR do not need speech.
Under PIPA s.11(2)/s.16(2) an organization may collect and use personal
information "only to the extent that is reasonable for meeting the purposes."
**Proposed resolution:** This engages a decision the operator already made
(E2A decision 7), so a drafting agent must not change it unilaterally. Put Q-5
to the operator: strip audio from retained recordings, apply a defined
retention limit to audio specifically, or knowingly retain it as-is with
counsel's advice. If the answer is "retain as-is," the public text should at
least state that the audio is not used for any purpose and is never published —
which §5 already implies but does not say about audio in particular.

---

**F-10 · MATERIAL CORRECTION · [PUB] + [INT] · Gate 3**
**Draft section:** §2 — "any evidence you provide to verify a request";
§10 — "We may ask for reasonable evidence that you control the gamertag."
**Official source:** S1 PIPA s.8(4) — deemed/opt-out consent is not to be
construed to authorize use "for any purpose other than the particular purposes
for which the information was collected"; s.35(1)–(2) retention and
destruction; ss.11(2)/16(2) reasonable extent.
**Why it matters:** Verification evidence is collected for one narrow purpose.
If it is retained under the general 24-month privacy-correspondence tier
alongside everything else, it outlives its purpose. Saying so plainly also
makes people more willing to supply verification.
**Proposed resolution:** Add to §10: *"Evidence you send to verify a request is
used only to verify that request. We delete it once the request is closed, and
we do not add it to the published record."* Reconcile with the E2B3 email tiers
in the same edit — this is a carve-out from the 24-month tier, not a
contradiction of it, and should be worded as such. Record the matching handling
step internally.

---

**F-11 · RECOMMENDATION · [INT] · Neither gate**
**Draft section:** §2 and §8 — "a limited set of authentic source fixtures
retained in our private GitHub repository"; §4 — development/testing purpose.
**Repository/HANDOFF evidence:** E2A decision 8; E1G — "Going forward, prefer
synthetic identities in new test fixtures unless authentic source provenance is
genuinely required"; E1H — repository now private; history not rewritten.
**Official source:** S1 PIPA ss.16(1)–(2) (use only for reasonable purposes,
only to the reasonable extent).
**Why it matters:** The disclosure is accurate and appropriately scoped. The
residual point is that "authentic fixtures" means real people's identifiers
sitting in a development corpus indefinitely.
**Proposed resolution:** No public text change required. Record internally the
E1G synthetic-identity preference as an ongoing practice, and consider whether
any existing fixture could be replaced with synthetic data without losing
provenance value. Not a publication blocker.

---

**F-12 · ACCEPTABLE AS WRITTEN · [PUB]**
**Draft section:** §10 — "The fact that information was previously published by
EA through its own game services is not, by itself, a reason for us to refuse a
request."
**Official source:** S2 Reg s.7 (closed list, six categories); S5 SOR/2001-7
s.1.
**Why it matters:** This sentence is one of the most legally significant lines
in the draft and it is well judged. It declines to treat prior EA visibility as
self-evidently decisive, which is the right posture while F-08 is unresolved,
and it does so without prejudging the exception in either direction.
**Preserve it verbatim.**

---

### Q4 — Retention

---

**F-13 · MATERIAL CORRECTION · [PUB] · Gate 2 and Gate 3**
**Draft section:** §9 — statistics, raw EA data, OCR evidence, and source
recordings "may be retained **indefinitely, until manually deleted or corrected
by our operator** … we do not apply an automatic expiry to this category."
**Repository/HANDOFF evidence:** E1G retention decision, reaffirmed at E2A
decision 7 and E2C5.
**Official source:** S1 PIPA s.35(1) — "An organization **may retain personal
information only for as long as** the organization reasonably requires the
personal information for legal or business purposes"; s.35(2) — within a
reasonable period after it is no longer reasonably required, the organization
"must" destroy the records **or** render the information non-identifying;
s.35(3) — s.35(1) applies notwithstanding withdrawal of consent under s.9.
**Why it matters:** PIPA does not impose a fixed maximum, and a genuine ongoing
archival purpose can support very long retention. But s.35(1) frames retention
as *purpose-bounded by default*, whereas the draft frames it as
*unbounded-by-default with manual exceptions*. That framing is the wrong way
round relative to the statute and is the aspect most likely to be criticised.
Note also s.35(2)(b): rendering information non-identifying is an express
alternative to destruction — the same de-identification option raised at F-08.
**Proposed resolution:** Keep the operator's substantive decision — **this
review does not reopen the approved retention decision** — and re-frame the
sentence to track s.35(1). Suggested shape: *"We keep this information for as
long as we reasonably need it for the purposes described in 'Why we use this
information' — principally maintaining an accurate, verifiable historical record
of our team's matches. We do not apply an automatic expiry to it."* The
de-identification alternative in s.35(2)(b) is worth recording internally as an
available option.
**Not imposed here:** the first version of this review silently added an annual
review commitment for the main archive to its suggested wording. That would have
been a new operational commitment, not a correction. It is **removed from the
suggested wording** and put to the operator instead as **Q-11**. If the operator
adopts a review cadence, the wording can carry it; if not, it must not appear.

---

**F-14 · OPERATOR INPUT REQUIRED · [CHECK] + [INT] · Gate 3**
**Draft section:** §9 — "an operator target of roughly 30 days … This is a
target we aim for manually; our infrastructure does not currently have
automated log rotation configured, so we cannot yet describe this as an enforced
or automated limit."
**Repository/HANDOFF evidence:** Independently re-verified — `docker-compose.yml`
contains no `logging:`, `log-opt`, `max-size`, or `max-file` key for any of the
four services (`db`, `worker`, `web`, `cloudflared`). E2A factual corrections;
E4 (NOT STARTED).
**Official source:** S1 PIPA s.6(1) — an organization "must develop and
**follow** policies and practices that are reasonable for the organization to
meet its obligations"; s.35(1).
**Why it matters — reclassified.** The first version of this review asserted
that publishing this manual target was worse than publishing nothing, and that
the operator could not keep the target because Docker automation is absent.
Neither assertion was established. **The absence of automated rotation does not
show that a manual practice does not happen**, and a manual practice honestly
described as manual is not inherently defective under s.6(1) — s.6(1) requires
that adopted policies be followed, which is a question of fact about what the
operator actually does. The real gap is that nobody has checked the underlying
facts. This is therefore operator/factual input, not a legal defect.
**Proposed resolution:** Establish the facts before deciding anything (Q-12):
(a) do the relevant logs actually exist, and which services produce them;
(b) does manual review or deletion of those logs actually occur, and at roughly
what interval; (c) is "roughly 30 days" an accurate description of current
practice. Then choose: keep the statement if it is factually accurate; reword it
if it is not. Implementing Docker log rotation as part of E4 remains
**preferable future operational work** and would let the limit be described as
enforced — but it is an improvement, not proof that the current statement is
false. Do not publish the sentence without completing the factual check.

---

**F-15 · MATERIAL CORRECTION · [PUB] + [CHECK] · Gate 3 (conditional on E3)**
**Draft section:** §9 — "we do not plan to individually rewrite already-created
encrypted backup copies, which will instead expire under our normal
backup-retention schedule over time."
**Repository/HANDOFF evidence:** E1A approved retention: "6-hourly recovery
points for 7 days; daily points for 30 days; **monthly points for 12 months**."
E3 status: producer and acceptor verified in isolation only; nothing active.
**Official source:** S1 PIPA s.35(1)–(2).
**Why it matters:** "Expire … over time" is doing a lot of work. The approved
schedule means a deletion the operator honours today can persist in a retained
monthly backup for up to roughly a year. A reader asking for removal benefits
from knowing that, and stating it costs nothing.
**Proposed resolution:** Once backups are active, state the outside figure:
*"Because we keep monthly backup copies for up to 12 months, information you
ask us to remove may remain inside an encrypted backup copy for up to about a
year after we remove it from the live site."* Until E3 activates, the draft's
"not active yet" framing is correct and should stay — this correction is
triggered by activation, and the draft's own internal blocker 5 already tracks
that trigger.

---

**F-16 · ACCEPTABLE AS WRITTEN · [PUB]**
**Draft section:** §9 — the tiered email retention schedule (30 days spam /
12 months routine / 24 months privacy and security / longer only while
reasonably necessary / reviewed at least annually).
**Repository/HANDOFF evidence:** Matches E2B3 decision 2 exactly, including the
"operator target, not automated" framing and the Proton Auto-delete-Off fact
from E2B2.
**Official source:** S1 PIPA s.35(1)–(2).
**Why it matters:** This is the strongest retention text in the document. It is
purpose-linked, time-bounded, has a review cadence the operator already agreed
at E2B3, and is honest that it is manual. Its review cadence is an **approved**
commitment for the email tier specifically — it is not a precedent this review
extends to the main archive without asking (see F-13 and Q-11). No change
needed.

---

### Q5 — Access, correction, deletion, and verification

The findings in this cluster share one correction. PIPA ss.24–32 impose duties
about **how a request is processed and what a response must contain**. On the
sources reviewed here, they do not impose a duty on the general policy page to
recite each item. Every finding below therefore separates the **[RESP]**
obligation (real, and binding regardless of what the page says) from the
**[PUB]** recommendation (worth doing, and not proven to be compulsory for this
page).

---

**F-17 · MATERIAL CORRECTION · [RESP] (required) + [PUB] (recommended) · Gate 3**
**Draft section:** §10 — "We aim to acknowledge requests within **7 days**. We
aim to resolve, or provide a substantive response to, requests within
**30 days**."
**Repository/HANDOFF evidence:** Matches the "LAUNCH POLICY + DOMAIN MAIL"
decision and E2A. Gate 2 records this item as already checked.
**Official source:** S1 PIPA s.28(1)(a) — an organization "must respond to an
applicant not later than **45 days** from the day that the organization
receives the applicant's written request"; s.28(2.1) — "The failure of an
organization to respond to a request in accordance with subsection (1) is to be
treated as a decision to refuse the request"; s.31(1) — the organization may
extend by "up to an additional 30 days" (or longer with the Commissioner's
permission) on specified grounds; s.31(2) — on extending, it must inform the
applicant of the reason, when a response can be expected, and that the
applicant may ask for a review under s.46.
**Why it matters:** **[RESP]** The 45-day duty, the deemed-refusal rule, and the
s.31(2) content requirements bind the operator's actual handling of a request
whether or not the policy page mentions them — and the operator would otherwise
never know the extension route exists. **[PUB]** The operator's 30-day target is
*stricter* than the statute, so it creates no conflict; presenting it as a bare
house target with no statutory floor is a clarity weakness rather than a breach.
**Proposed resolution:** **Required:** build the s.28/s.31 mechanics into the
internal response procedure and template. **Recommended:** keep the 7-day and
30-day commitments and add a short statutory frame to §10, for example: *"Where
the law sets a deadline for responding to a request about your own personal
information, we will meet it. Our own targets above are shorter than the
deadline that applies under Alberta's Personal Information Protection Act. If we
need more time — for example because a request covers a large amount of
information — we will tell you why, when you can expect an answer, and how to
ask the Commissioner to review that."*

---

**F-18 · MATERIAL CORRECTION · [RESP] (required, indisputable) + [PUB] (strongly recommended) · Gate 3**
**Draft section:** §10 — the entire request process, and §13 — contacts.
Neither mentions any right of complaint, review, or appeal.
**Official source:** S1 PIPA s.46(1) — "An individual who makes a request to an
organization respecting personal information about that individual **may ask
the Commissioner to review any decision, act or failure to act** of the
organization"; s.46(2) — right to initiate a complaint; s.47(1) — the request
for review or complaint must be delivered in writing to the Commissioner;
s.47(2)(a) — a request for review must be delivered "within 30 days from the day
that the individual asking for the review is notified of the decision", or
s.47(2)(b) "a longer period allowed by the Commissioner"; s.47(4) — that time
limit does not apply to a review about an organization's *failure to respond*
within a required time period; **s.29(1)(c)(iii) — where access is refused, the
response must inform the applicant "that the applicant may ask for a review
under section 46"; s.29(2)(b)(ii) and s.29(3)(c) — the equivalent duty on a
refusal under s.24(1)(b) and on a response to a correction request.**
**Why it matters — corrected.** The first version called this "the single
clearest defect in the document" and treated publication of the review right on
the policy page as a statutory requirement. That overstated the position.
Precisely:
- **[RESP] Indisputable:** in an applicable refusal or correction response,
  s.29 *requires* the operator to tell the applicant about the s.46 review
  right. There is no discretion about this, and it is the more important half.
- **[PUB] Strongly recommended, not proven compulsory for this page:** no
  provision reviewed here requires the general policy page to carry it. It
  remains a strong recommended public disclosure — a request process described
  without any mention of an external review route reads as a discretionary
  favour rather than an enforceable right, and the operator has to communicate
  the right in responses anyway.
**Proposed resolution:** **Required:** add the s.29 elements — reasons, the
provision relied on, the contact person, and the s.46 review notice — to the
internal response template so the operator's actual replies carry them.
**Recommended:** add a short subsection to §10 or §13: *"If you are not
satisfied with how we handle your request, you can ask the Office of the
Information and Privacy Commissioner of Alberta to review our decision. There is
a time limit for asking, so do not wait: see `oipc.ab.ca`."* Verify the OIPC
contact route and URL at publication time rather than hard-coding a phone
number or address that may change.

---

**F-19 · MATERIAL CORRECTION · [RESP] (required) + [PUB] (recommended) · Gate 3**
**Draft section:** §10 — silent on fees.
**Official source:** S1 PIPA s.32(1) — an organization "may charge an applicant
… a reasonable fee for access"; s.32(2) — an organization "**may not charge a
fee** in respect of a request made under section 25(1)" (correction);
s.32(3)(a) — if intending to charge, it "must give the applicant a written
estimate of the total fee **before** providing the service".
**Why it matters:** **[RESP]** The no-fee-for-corrections rule and the
written-estimate-first rule bind the operator's handling of requests regardless
of the policy text. **[PUB]** Publishing the operator's intention is a clarity
improvement — silence invites the assumption that a fee might appear — but is
not shown to be compulsory for this page.
**Proposed resolution:** **Required:** record the s.32 rules in the internal
request procedure. **Recommended:** state the operator's intention plainly. If
the operator does not intend to charge (the sensible position for a hobby
project), say: *"We do not charge for correction requests, and we do not
currently charge for access requests. If that ever changed, we would give you a
written estimate before doing any chargeable work."* Confirm the intention with
the operator (Q-7) rather than assuming it.

---

**F-20 · MATERIAL CORRECTION · [RESP] (required) + [PUB] (recommended) · Gate 3**
**Draft section:** §10 — "Whether we correct, de-identify, or remove
information is decided case-by-case."
**Official source:** S1 PIPA s.25(1) — right to request correction of an error
or omission; s.25(2)(a) — where there is an error or omission the organization
"must … correct the information as soon as reasonably possible";
s.25(2)(b) — where it has disclosed the incorrect information to other
organizations, send a notification with the correction "if it is reasonable to
do so"; **s.25(3) — "If an organization makes a determination not to make the
correction … the organization must annotate the personal information under its
control with the correction that was requested but not made"**; s.25(5) — an
organization "shall not correct or otherwise alter an opinion, including a
professional or expert opinion."
**Why it matters:** **[RESP]** s.25(3) is a hard duty on the operator's
handling of a refused correction, and it is *cheap to honour here* — this
project already models provenance and review state, so annotating a disputed
value is closer to a natural fit than an imposition. **[PUB]** The draft's
discretionary "case-by-case" framing is a public-wording weakness because it
understates what the operator must do; correcting it is recommended. s.25(5) is
separately interesting: derived performance scores and summary classifications
may be characterised as the operator's assessments rather than facts, which
would place them outside the correction duty. This review flags that as a
question for counsel, not a conclusion.
**Proposed resolution:** **Required:** build the s.25(3) annotation step into
the correction procedure. **Recommended:** add to §10: *"If we decide not to
make a correction you have asked for, we will note your requested correction
alongside the information we hold."* Separately raise s.25(5) with counsel — do
not assert in the public text that derived metrics are "opinions."

---

**F-21 · MATERIAL CORRECTION · [RESP] (required) + [PUB] (recommended) · Gate 3**
**Draft section:** §10 — no refusal grounds or severance expectations are
stated.
**Official source:** S1 PIPA s.24(2) — discretionary refusal grounds (legal
privilege; confidential commercial information; information collected for an
investigation or legal proceeding; mediation/arbitration records; prosecutorial
discretion); **s.24(3) — mandatory refusal: an organization "shall not" provide
access where disclosure could reasonably be expected to threaten another
individual's life or security, or where it "would reveal personal information
about another individual", or would reveal a confidential opinion-giver's
identity**; s.24(4) — duty to sever and give partial access where reasonably
able; s.27(1) duty to assist; s.27(2) duty to create a record from electronic
records where feasible.
**Why it matters:** s.24(3)(b) is structurally unavoidable in this project.
Every match record, every OCR frame, and every party recording contains more
than one person, so an access request from one player will routinely engage
another player's personal information and require severance rather than
refusal. **[RESP]** The operator must be able to do this correctly on demand.
**[PUB]** Saying nothing about it sets a reader expectation the operator cannot
meet, which is a recommendation-grade wording problem.
**Proposed resolution:** **Required:** record the severance approach in the
internal request procedure. **Recommended:** add to §10: *"Because our records
are about matches involving several people, some of what we hold about you is
mixed together with information about others. Where the law requires it, we will
give you the parts that are about you and hold back the parts that would reveal
someone else."*

---

**F-22 · MATERIAL CORRECTION · [PUB] · Gate 3**
**Draft section:** §10 — "To ask about, correct, or request **removal** of
information about you."
**Official source:** S1 PIPA s.24 (access), s.25 (correction), s.9 (withdrawal
or variation of consent), s.35(3) (retention limits apply notwithstanding
withdrawal of consent). PIPA contains no free-standing right of erasure.
**Why it matters:** The draft offers "removal" as though it sits alongside
access and correction as an equivalent request type. It does not: under PIPA,
correction is a right, whereas removal is discretionary for the organization and
informed by s.35. Framing them identically over-promises on one and under-states
the other. This is squarely a public-wording defect.
**Proposed resolution:** Distinguish the three in §10: correction as a right;
withdrawal of consent as a right with consequences the operator will explain
(s.9(2)); removal as something the operator will consider case-by-case against
its retention purposes. The draft's existing archival-integrity language then
attaches to the right item.

---

**F-23 · ACCEPTABLE AS WRITTEN · [PUB]**
**Draft section:** §10 — "We may ask for reasonable evidence that you control
the gamertag or identity in question. We do not request government-issued ID by
default."
**Repository/HANDOFF evidence:** E2A decision 5.
**Official source:** S1 PIPA ss.11(2)/16(2) (collect and use only to the extent
reasonable); s.26(1)(b) (request must include sufficient detail to identify the
record); s.27(1) (duty to assist).
**Why it matters:** Proportionate identity verification with an explicit
no-government-ID default is the right posture and is consistent with data
minimisation. Keep it. Pair it with F-10's purpose-limitation sentence.

---

### Q6 — Collection notices, policies and practices, and transparency

---

**F-24 · MATERIAL CORRECTION · [INT] (required if s.6(2) applies) + [PUB] (recommended) + [COUNSEL] · Gate 3**
**Draft section:** §12 — "We do not have verified information about the exact
physical storage locations each of these providers uses, and we do not claim
otherwise"; §8 — providers listed without jurisdictions.
**Repository/HANDOFF evidence:** E2B2 records Cloudflare and Proton settings but
no jurisdiction determination; E2A decision 10 requires conditional wording
until verified.
**Official source:** S1 PIPA **s.6(1)** — "An organization must develop and
follow policies and practices that are reasonable for the organization to meet
its obligations under this Act"; **s.6(2)** — "If an organization uses a service
provider outside Canada to collect, use, disclose or store personal information
for or on behalf of the organization, **the policies and practices referred to
in subsection (1)** must include information regarding (a) the countries outside
Canada in which the collection, use, disclosure or storage is occurring or may
occur, and (b) the purposes for which the service provider outside Canada has
been authorized to collect, use or disclose personal information for or on
behalf of the organization"; **s.6(3)** — "An organization must make written
information about the policies and practices referred to in subsections (1) and
(2) available on request."
**Why it matters — corrected on three points.**
1. **The duty attaches to the organization's policies and practices, not to
   this webpage.** s.6(2) requires the country list and the authorized purposes
   to be *in* the policies and practices; s.6(3) requires written information
   about those policies and practices to be *available on request*. Neither
   provision, on its terms, requires the complete country list to be published
   on the public Data Collection Policy page. The first version of this review
   said the draft's careful sentence breached s.6(2); that was wrong. **An
   unfinished public draft does not breach s.6(2)** — what would engage s.6(2)
   is the organization not holding compliant policies and practices at all,
   which is a separate and presently unmet requirement.
2. **The preserved substance stands:** if s.6(2) applies, the organization's
   policies and practices **must** include the countries where the handling "is
   occurring **or may occur**" and the authorized purposes, and under s.6(3)
   written information about them must be available on request. The statute does
   not demand verified datacentre addresses — "may occur" is expressly enough —
   so the operator's epistemic caution is not an obstacle to compliance.
3. **Whether these providers are "service providers … for or on behalf of" the
   organization is a factual and legal classification**, determined by what the
   contracts and arrangements actually are and how the law characterises them.
   It is **not an arbitrary operator label**, and the operator cannot make
   s.6(2) inapplicable by declining to apply the term. The draft correctly
   declines to make the classification itself; Q-4 collects the contract and
   service facts so counsel can make it.
**Proposed resolution:** **Required (if s.6(2) applies):** create the internal
policies-and-practices document containing the "may occur" country list and each
provider's authorized purposes, and be ready to supply written information about
it on request per s.6(3). Source the list from each provider's own official
documentation at drafting time and attribute it as such. **Recommended:**
publishing the same information on the policy page is likely the simplest way to
implement both the transparency and the s.6(3) availability obligation in one
place, and it avoids maintaining two documents. Shape: *"Cloudflare (network and
security processing; processing may occur in the United States and other
countries where Cloudflare operates); Proton Mail (email delivery and storage;
Switzerland); GitHub (private source-code and test-fixture hosting; United
States)."* Verify each against current provider documentation before publication
and attribute it to the provider — do **not** assert it as an independently
established fact, consistent with E2A decision 10. Confirm the s.6(2)
classification with counsel using the Q-4 facts.

---

**F-25 · MATERIAL CORRECTION · [NOTICE] + [PUB] · Gate 3**
**Draft section:** §12 — no notice mechanism for outside-Canada handling.
**Official source:** S1 PIPA **s.13.1** — an organization that uses a service
provider outside Canada to collect personal information **with the consent of
the individual** (s.13.1(1)), or that transfers to such a provider personal
information **that was collected with the individual's consent** (s.13.1(2)),
"must notify the individual in accordance with subsection (3)"; s.13.1(3)
requires (a) "the way in which the individual may obtain access to written
information about the organization's policies and practices with respect to
service providers outside Canada" and (b) "the name or position name or title of
a person who is able to answer … the individual's questions about the
collection, use, disclosure or storage of personal information by service
providers outside Canada"; s.13.1(4) — this notice is "in addition to" the s.13
notice.
**Why it matters:** s.13.1 is a distinct obligation from s.6(2), it is a
**notice to the individual** rather than policy-page content, and it is
**conditional on consent-based collection or transfer** — so its application
depends on the F-07 basis mapping and on the Q-4 classification. Where it
applies, it again permits "the name **or position name or title**", reinforcing
that a role title is an available route (F-05). Note also that s.13.1(3)(a)
points at exactly the s.6(3) availability mechanism, which is why implementing
the two together is efficient.
**Proposed resolution:** Once F-07 and Q-4 are settled, add a notice where the
relevant collection or transfer occurs. A single sentence can cover both limbs,
and §12 is a reasonable place for it: *"You can ask us at any time for written
information about how we use service providers outside Canada — email the
Privacy Contact at `webmaster@boogeymen.app`, who can also answer questions
about how those providers handle information."* Do not treat this as satisfied
until the conditions in s.13.1(1)/(2) are known to apply or not.

---

**F-26 · RECOMMENDATION · [NOTICE] · Gate 3**
**Draft section:** §1 and §7 — "you can still voluntarily send us information
through project email"; §10 and §13 publish the addresses.
**Official source:** S1 PIPA s.13(1) — notice of purposes and of a contact
person must be given "**[b]efore or at the time of** collecting personal
information about an individual from the individual"; **s.13(4) — "Subsection
(1) does not apply to the collection of personal information that is carried
out pursuant to section 8(2)"** (voluntarily provided for that purpose).
**Why it matters:** Someone emailing `webmaster@` about a correction is
volunteering their information for that purpose, so s.8(2) deemed consent
applies and s.13(4) removes the strict s.13(1) notice duty. **This is therefore
a recommendation, not a requirement** — the draft is not in breach. But a
general policy page is weak notice for a collection event that happens in a mail
client, and a one-line notice next to each published address is trivially cheap.
**Proposed resolution:** Wherever a contact address is published (footer,
contact page, §10, §13), add a short adjacent line: *"If you email us, we keep
your message, address, and anything you attach — see our Data Collection
Policy."* Do not restructure the policy around this.

---

**F-27 · RECOMMENDATION · [RESP] + [INT] + [PUB] · Gate 3**
**Draft section:** §8 — describes each provider's role but not what personal
information each receives.
**Official source:** S1 PIPA s.24(1)(b) — an individual may request "information
about the use or disclosure of personal information about the individual";
s.29(2)(a)(ii) — the response must give "the names of the persons to whom and
circumstances in which the personal information has been and is being
disclosed."
**Why it matters:** **[RESP]** The operator must be able to answer this on
demand. **[INT]/[PUB]** Writing it down once is easier than reconstructing it
per request, and the policy page is a convenient place for it.
**Proposed resolution:** Add one clause per provider describing what it
receives (for example: Cloudflare receives the request metadata of anyone who
visits the site; Proton receives the contents of email sent to project
addresses; GitHub holds the test fixtures; EA is a source, not a recipient).
Keep it short and non-technical.

---

### Q7 — Children and opponents

---

**F-28 · ACCEPTABLE AS WRITTEN · [PUB]**
**Draft section:** §11 — adult-only membership; opponents' ages unknown,
unverifiable, not collected; no age threshold asserted.
**Repository/HANDOFF evidence:** E2A decision 3 — "No under-13-specific
threshold is introduced"; launch-policy entry — "Revisit this posture before
publishing anyone under 18."
**Official source:** S8 (OPC, jointly with OIPC-AB and OIPC-BC) — the OPC takes
the position that, "in all but exceptional circumstances", a person under 13
cannot meaningfully consent and consent must come from a parent or guardian;
**the same guidance records that OIPC-AB (and OIPC-BC and the Quebec CAI) "do
not set a specific age threshold, but rather consider whether the individual
understands the nature and consequences of the exercise of the right or power in
question."**
**Why it matters:** The draft's refusal to import a US-style under-13 threshold
is defensible and consistent with the Alberta regulator's capacity-based
approach as recorded in the joint guidance. The operator's instruction and the
applicable guidance agree. No change.

---

**F-29 · MATERIAL CORRECTION · [PUB] · Gate 3 (dependent on F-08)**
**Draft section:** §11 — "Some of the opponents we play against in matches may
include minors. We do not know their ages, cannot verify them, do not collect
them, and have no way to determine them."
**Repository/HANDOFF evidence:** E1G — opponent consent unknown in either
direction.
**Official source:** S8 (capacity-based approach in Alberta); S1 PIPA s.7(1)
(consent required absent an exception).
**Why it matters:** Section 11 answers a narrower question than the one that
matters. The issue is not primarily whether the operator knows an opponent's
age; it is that no consent from any opponent, of any age, is recorded, and age
would change *who* would have to give it. As written, §11 reads as a reason the
operator cannot act, when the underlying position is that consent is not
currently being relied on (F-08). A minor's inability to consent makes the F-08
question sharper, not softer.
**Proposed resolution:** Do not expand §11 into an age-verification or COPPA
section — the operator's posture is sound and E2A decision 3 stands. Instead,
once F-08's basis question is resolved, make §11 consistent with whatever answer
that produces. Until F-08 is answered, §11 cannot be finalised.

---

### Q8 — Recordings and voice chat

The issues are deliberately separated below, because conflating them is the
specific error this section is most prone to: the lawfulness of *making* a
recording, the authority to *retain and use* the audio, and *responding to a
request* about it are three different questions.

---

**F-30 · OPERATOR INPUT REQUIRED / UNRESOLVED · [COUNSEL] + [INT] · Gate 2 and Gate 3**
**Issue: recording law where participants are in different jurisdictions.**
**Draft section:** §2 — "This audio is present only in recordings made and
provided by our own team members who authorize the recording."
**Repository/HANDOFF evidence:** "LAUNCH POLICY + DOMAIN MAIL" Active State
entry (2026-09-03): "The main PC and Hotel-Echo are physically in Alberta;
**most team members are in Massachusetts, USA.**" The draft's §12 correctly does
not publish member locations, consistent with the same entry's instruction, so
this fact is not visible in the policy text — but it is a recorded project fact
and it bears directly on this section.
**Official sources:** S6 *Criminal Code* s.184(1) — it is an offence to
knowingly intercept a private communication by device; s.184(2)(a) — subsection
(1) "does not apply to … a person who has the consent to intercept, express or
implied, of the originator of the private communication or of the person
intended by the originator thereof to receive it." S7 s.193(1) — restricts use
or disclosure of a private communication intercepted **without** consent.
S11 Massachusetts G.L. c. 272 §99 B(4) — "interception" means "to secretly hear,
secretly record, or aid another to secretly hear or secretly record the contents
of any wire or oral communication through the use of any intercepting device by
any person other than a person given prior authority by all parties to such
communication"; §99 C(1) creates the offence of wilfully committing an
interception.
**Why it matters:** The draft's justification for retaining party audio is that
a team member authorized the recording. Canadian criminal law contains a
one-party-consent route in s.184(2)(a). The Massachusetts statute is framed
differently: its definition turns on both an "all parties" authorisation limb
**and** a "secretly" limb, so the facts that matter there include not only who
consented but whether the recording was secret — that is, whether the other
participants knew it was happening. **This review makes no Massachusetts
conclusion and no conflicts-of-law conclusion.** It does not decide which
jurisdiction's law applies to any recording, whether §99 reaches these
recordings, or whether the "secretly" limb is satisfied or defeated on these
facts. Those are counsel questions on facts nobody has yet gathered.
**Proposed resolution:** **Mark unresolved and escalate.** Put **Q-6** to the
operator to establish the facts, then put the resulting fact pattern to counsel
who can advise on the relevant jurisdictions' law. The facts needed are:
 a. **whose voices can be captured** in the recorded party channels — team
    members only, or opponents and other third parties as well;
 b. **whether every participant was told before recording began** that the
    session was being or might be recorded;
 c. **whether each participant expressly or implicitly agreed** to the
    recording, and what that agreement consisted of;
 d. **whether the platform displays a recording indicator** visible to
    participants while recording is in progress;
 e. **where each participant was physically located** at the time of recording.
Do not add any statement to the public policy asserting that recordings are
lawful, and do not remove the existing careful framing.

---

**F-31 · OPERATOR INPUT REQUIRED · [INT] + [COUNSEL] · Gate 3**
**Issue: privacy collection/use/disclosure and retention of the audio, as
distinct from the legality of making the recording.**
See **F-09** for the analysis and the proposed operator question (Q-5). The
point restated for this section: lawfulness of capture is a different question
from authority to *retain* the audio indefinitely under PIPA s.35(1) when no
stated purpose in §4 requires speech. A favourable answer on F-30 would not by
itself answer F-09, and vice versa.

---

**F-32 · MATERIAL CORRECTION · [RESP] + [INT] · Gate 3**
**Issue: access requests touching recordings.**
**Draft section:** §10 — request process; §5 — "the raw evidence is not
published."
**Official source:** S1 PIPA s.24(1.1) (access to the applicant's own personal
information in records under the organization's control); s.24(3)(b) (must not
provide access that "would reveal personal information about another
individual"); s.24(4) (duty to sever where reasonably able); s.27(2) (duty to
create a record from electronic records using normal hardware, software and
technical expertise, where doing so would not unreasonably interfere with
operations).
**Why it matters:** A party recording is a hard severance case: a multi-party
audio track cannot be meaningfully redacted with normal tooling. s.27(2)'s
"would not unreasonably interfere" qualifier is the relevant limit, but the
operator should understand the position before receiving such a request, not
after.
**Proposed resolution:** Covered on the public side by F-21's proposed §10
sentence about mixed records. **Required internally:** record that a request for
access to recorded audio is expected to be handled by severance-infeasibility
under s.24(3)(b) and s.27(2), with a written explanation to the applicant plus
the s.29 elements including the s.46 review notice — not by silence.

---

**Issue: cross-border team-member considerations (privacy, as opposed to
recording law).** No separate finding. PIPA s.6(2) and s.13.1 concern *service
providers* outside Canada, not members who happen to live elsewhere, so member
location does not itself trigger those provisions. The member-location fact
matters for F-30 (recording law) and, potentially, for the SOR/2004-219 s.1
analysis if PIPEDA is ever engaged (F-03, Q-9).

---

### Q9 — Providers, logging, cookies, and analytics

---

**F-33 · MATERIAL CORRECTION · [PUB] · Gate 3 (moot if analytics is disabled first)**
**Draft section:** §6 — "Our website's own application source code does not
directly use `localStorage`, `sessionStorage`, browser cookies, or `indexedDB`."
**Repository/HANDOFF evidence:** Independently re-verified this session: zero
matches across `apps/web/src`, `apps/worker/src`, `packages/*/src`, and zero
Cloudflare-beacon references anywhere in `apps/web/src` or `apps/web/public`.
E2B2 records that Web Analytics for this proxied zone "uses Cloudflare's
automatic setup."
**Official source:** S1 PIPA s.6(1) (reasonable policies and practices).
**Why it matters:** Both statements in the draft are true, and together they can
still mislead. A reader may infer that "not in our source code" means "not on
the page." For an automatically-injected edge beacon, the source grep is
*structurally incapable* of detecting it — worth one sentence, because it is
exactly the kind of gap the draft elsewhere goes out of its way to name.
**Proposed resolution:** If any version were ever published while analytics
remained enabled, add after the existing hedge: *"While Cloudflare Web Analytics
is enabled, its measurement script is added by Cloudflare at the network edge
rather than by our own code, so it would not appear in our source code at all."*
Since analytics must be disabled before publication (F-34), the practical
outcome is that this sentence is deleted along with the rest of the
analytics-enabled text.

---

**F-34 · MATERIAL CORRECTION · [PUB] + [CHECK] · Gate 3 (publication blocker, already tracked)**
**Draft section:** §1 ("Our intended posture at launch is **no analytics and no
nonessential tracking**") versus §6 ("**Cloudflare Web Analytics is currently
enabled** … We intend to disable [it] before this site is published").
**Repository/HANDOFF evidence:** E2B2 (enabled, "Enable, excluding visitor data
in the EU"); E2B3 decision 1 (preserve the no-analytics decision; disabling is a
required launch precondition; not yet done; "no draft, page, or status note may
state 'no analytics' … as a current operational fact" until dashboard-verified);
E2C5 (still undone as of 2026-09-09).
**Official source:** S1 PIPA s.6(1) — must develop and **follow** reasonable
policies and practices.
**Why it matters:** The draft handles this correctly *as a draft*. But the two
sections are mutually inconsistent as published text, and the inconsistency
resolves in only one direction: once analytics is disabled and verified, §6's
entire "currently enabled" passage becomes false and must be replaced, not
merely left standing. The risk is a stale paragraph shipping because it was
"already reviewed."
**Proposed resolution:** Treat §6 as having two prepared variants and make the
swap an explicit publication step. Variant A (analytics disabled and
dashboard-verified) states the no-analytics posture as current fact and deletes
the enabled disclosure and F-33's sentence. Variant B (still enabled) must not
be published at all, because publishing it would contradict §1 and E2B3.
Restated plainly: **there is no publishable version of this policy in which
analytics is still enabled.** Cloudflare Web Analytics remains enabled as of
this review and nothing in this session changed it.

---

**F-35 · ACCEPTABLE AS WRITTEN · [PUB]**
**Draft section:** §6 — "Cloudflare **describes** its Web Analytics product as
cookie-free — **it says** the product does not use cookies or client-side
storage to collect metrics."
**Repository/HANDOFF evidence:** E2B2's recorded correction, which cites
Cloudflare's own documentation and expressly warns against broadening it into an
independent conclusion; E2A decision 10.
**Why it matters:** Attributing a provider's claim to the provider, rather than
adopting it as the operator's own assertion, is exactly right and should be the
model for the F-24 jurisdiction list. No change.

---

**F-36 · ACCEPTABLE AS WRITTEN · [PUB] + [CHECK]**
**Draft section:** §8 — fonts "downloaded and self-hosted as part of our build
process rather than requested by your browser from Google at page-load time,
based on how our font loading is currently configured."
**Repository/HANDOFF evidence:** Independently verified —
`apps/web/src/app/layout.tsx:2` imports `Barlow` and `Barlow_Semi_Condensed`
from `next/font/google`, which self-hosts font files at build time; no other
font mechanism appears in the app source.
**Why it matters:** Accurate, correctly hedged, and materially relevant (it
means no third-party font request leaks visitor IP addresses to Google). No
change. A live-site check at publication (already the draft's internal blocker
4) will confirm it.

---

**F-37 · ACCEPTABLE AS WRITTEN · [PUB]**
**Draft section:** §8 — Proton mailbox facts; GitHub private-with-prior-public
history; §13 — repository now private, earlier copies not recallable.
**Repository/HANDOFF evidence:** Matches E2B2 (three addresses into one
mailbox, no forwarding, no catch-all, no Bridge, no third-party client, no
export or separate backup) and E1H/E1G (visibility changed and verified; no
history rewrite authorized; prior copies not retractable) precisely, including
the deliberate non-naming of `alerts@` as a public contact per E2A decision 13.
**Why it matters:** These are the sections most likely to drift from recorded
fact in later edits. They currently do not. No change; re-verify at publication
only if a provider setting changes.

---

### Q10 — Safeguards, incidents, and complaints

---

**F-38 · MATERIAL CORRECTION · [INT] (required) + [PUB] (recommended) · Gate 3**
**Draft section:** §13 — "We take reasonable steps to protect the information
we maintain, but no website or storage system can guarantee absolute security."
No breach or incident language anywhere.
**Official source:** S1 PIPA s.34 — an organization "must protect personal
information … by making reasonable security arrangements"; **s.34.1(1) — an
organization "must, without unreasonable delay, provide notice to the
Commissioner of any incident involving the loss of or unauthorized access to or
disclosure of the personal information where a reasonable person would consider
that there exists a real risk of significant harm to an individual"**;
s.34.1(2) with S2 Reg s.19 — required contents of **that report to the
Commissioner**, including s.19(h) "the name of and contact information for a
person who can answer, on behalf of the organization, the Commissioner's
questions about the loss or unauthorized access or disclosure"; s.37.1(1) — the
Commissioner may require the organization to notify affected individuals; S2 Reg
s.19.1 — required contents of **that individual notification**, and that it "be
given directly to the individual".
**Why it matters:** Alberta's mandatory breach-report duty is one of PIPA's
sharpest edges and the draft does not acknowledge it exists. **Correction:** the
first version cited Reg s.19(h) and s.19.1(b)(v) as a "third independent
reinforcement" of a duty to publish a role title in the general policy. They are
not. Reg s.19(h) governs the contents of an incident report **to the
Commissioner**, and Reg s.19.1 governs the contents of a notification **to
affected individuals**. Both are incident-response documents. Neither says
anything about the general policy page.
**Proposed resolution:** Split required from recommended.
- *Required, internal (do not publish):* an incident procedure recording the
  s.34.1 threshold, the Reg s.19 report contents including the s.19(h) contact,
  the Reg s.19.1 notification contents, who holds the s.5(3) designation, and
  the existing `security@boogeymen.app` intake. This belongs with E4, not in the
  policy.
- *Recommended, public (add to §13, two sentences):* *"If personal information
  we hold is lost or accessed without authorisation and there is a real risk of
  significant harm to you, we will report it to the Alberta Information and
  Privacy Commissioner as the law requires, and we will tell you directly where
  we are required to."*

---

**F-39 · MATERIAL CORRECTION · [PUB] + [RESP] · Gate 3**
**Draft section:** No withdrawal-of-consent language anywhere.
**Official source:** S1 PIPA s.9(1) — "on giving reasonable notice to an
organization, an individual may at any time withdraw or vary consent";
s.9(2) — the organization "must … inform the individual of the likely
consequences" of withdrawing; s.9(3) — unless those consequences would be
reasonably obvious; s.9(4) — on withdrawal the organization must stop
collecting, using or disclosing, except where the Act permits that handling
without consent; s.35(3) — retention under s.35(1) applies notwithstanding
withdrawal.
**Why it matters:** **[RESP]** s.9(2)'s duty to explain consequences binds the
operator's handling of a withdrawal whether or not the page mentions it.
**[PUB]** Withdrawal is a distinct right from correction and removal, and it is
the one most likely to be exercised by a **member** (who may have consented)
rather than an opponent (whose position is unresolved). The draft offers members
no route to it.
**Proposed resolution:** Add to §10: *"If you previously agreed to our using
information about you, you can tell us you no longer agree. We will explain what
that means in practice, stop what we are required to stop, and tell you what we
must keep and why."* The s.35(3) qualifier is what makes this honest rather than
an over-promise.

---

**F-40 · RECOMMENDATION · [PUB] · Gate 3**
**Draft section:** §4 — "Produce, verify, and correct derived hockey
statistics"; §5 — provenance framing.
**Official source:** S1 PIPA s.33 — "An organization must make a reasonable
effort to ensure that any personal information collected, used or disclosed …
is accurate and complete to the extent that is reasonable for the
organization's purposes."
**Why it matters:** This is a rare case where the project substantially exceeds
the statutory standard and gets no credit for it. The OCR review pipeline,
provenance model, and correction workflow are precisely a s.33 accuracy
programme.
**Proposed resolution:** Add one sentence to §4 or §13: *"We make a reasonable
effort to keep what we publish accurate, and we correct it when we find or are
told it is wrong."* Low cost, and it frames the request process as part of an
accuracy practice rather than a concession.

---

**F-41 · MATERIAL CORRECTION · [INT] + [PUB] · Gate 2**
**Issue: what belongs in the public policy versus a collection notice, a
response template, or an internal procedure.**
**Official source:** S1 PIPA s.6(1) (develop and follow reasonable policies and
practices) and s.6(3) (make written information about them available **on
request**) — s.6 requires the policies to *exist and be followed*, and requires
written information about them to be *available on request*, not published in
full. s.13/s.13.1 attach to notices at collection; s.29 attaches to responses;
Reg s.19/s.19.1 attach to incident documents.
**Why it matters:** This is the organising correction of this revision. Getting
the target wrong produces two opposite failures: publishing statutory recitals
the page does not need, and failing to build the procedures that actually carry
the duties. Recording the split once prevents each of the three remaining legal
drafts from re-deciding it — and re-deciding it differently.
**Proposed resolution:** Record the split in `HANDOFF.md`, in these four
buckets.
- **Publish [PUB]:** identity and privacy-contact role; categories and sources;
  purposes; public display and indexing; providers, and (recommended) the
  outside-Canada countries and authorized purposes; retention; a plain-language
  summary of access, correction, withdrawal and complaint rights; the breach
  commitment; the accuracy commitment; change notices.
- **Place at the point of collection [NOTICE]:** the s.13(1) purpose-and-contact
  notice where s.13(4) does not remove it; the s.13.1 outside-Canada notice
  where s.13.1(1)/(2) apply.
- **Build into response templates [RESP]:** the s.29 elements (reasons, the
  provision relied on, the contact person, the s.46 review notice); the s.28/31
  deadline and extension mechanics; the s.25(3) annotation step; s.32 fee
  rules; the s.24(3)/(4) severance approach.
- **Keep internal [INT]:** the s.6(1)–(2) policies-and-practices document (with
  the country list and authorized purposes), available on request under s.6(3);
  the s.5(3) designation holder; the incident runbook and severity thresholds;
  verification-evidence handling; log-handling procedure; retention-review
  practice and evidence.

---

### Q11 — Draft quality

---

**F-42 · MATERIAL CORRECTION · [PUB] + [CHECK] · Gate 3**
**Draft section:** §5 — "**The technical implementation of this indexing
policy — `robots.txt`, sitemap, and per-page metadata — is separate Gate 3 work
and is not yet complete as of this draft.**" Similar internal-status narration
appears in §6, §9, and §1.
**Repository/HANDOFF evidence:** Verified — no `robots.txt` or sitemap file
exists anywhere under `apps/web`. E1F decided the policy; implementation is
open.
**Why it matters:** These statements are accurate and appropriate *in a working
draft*. In a published policy they expose the project's internal gate
vocabulary ("Gate 3 work") to readers for whom it is meaningless, and they
guarantee staleness the moment the work lands. The draft's transparency
instinct is right; the target audience is wrong.
**Proposed resolution:** Before publication, convert every internal-status
sentence into either (a) a plain statement of the current user-visible fact, or
(b) nothing. Move the tracking value into the internal section, which already
exists for exactly this purpose. Never publish the words "Gate 2", "Gate 3", or
"as of this draft."

---

**F-43 · MATERIAL CORRECTION · [PUB] · Gate 3**
**Draft section:** §2 — "our records necessarily include the opposing club's
name and the opposing players' gamertags and statistics for the matches they
played against us."
**Repository/HANDOFF evidence:** `packages/db/src/schema/opponent-player-match-stats.ts:44`
stores `ea_player_id`, documented at lines 24–25 as the "EA Pro Clubs persona
ID … **Stable across matches**", alongside `gamertag` (line 48) and the full
statistical row. The file's header comment states opponents are "not tracked
across the BGM identity model" — true of the *application's* identity model, but
the stable persona identifier is nonetheless stored on every row. **This
repository finding is preserved unchanged and was independently verified.**
**Official source:** S1 PIPA s.1(1)(k) ("information about an identifiable
individual"); s.13(1)(a) (notice of purposes); s.24(1) (access rights attach to
what is actually held).
**Why it matters:** "Gamertags and statistics for the matches they played
against us" reads as a set of disconnected per-match snapshots. What is actually
held is a stable per-person identifier that links every appearance by the same
opponent across the archive. That is a meaningfully stronger form of personal
information, it is the field for which the publicly-available analysis looks
hardest (F-08), and the difference matters to anyone deciding whether to make a
request. The draft is not inaccurate; it is incomplete in a direction that
understates.
**Proposed resolution:** Amend §2's opponent bullet to add: *"This includes an
identifier EA uses for each player, which stays the same across matches, so our
records can link the same opponent's appearances over time."* Keep the wording
plain. If F-08 resolves toward de-identification, revise both together.

---

**F-44 · RECOMMENDATION · [PUB] + [INT] · Gate 2**
**Draft section:** §6 (cookies), §12 (cross-border), §13 (security, change
notices) — all of which are conventional *privacy policy* content, and the
privacy policy is a separate, still-unwritten Gate 2 draft.
**Repository/HANDOFF evidence:** E2 roadmap section — four required drafts:
privacy policy, data-collection policy, EA/NHL attribution notice, Terms of
Use. Three remain unwritten.
**Why it matters:** Four separate legal documents with overlapping content and
one operator is a maintenance trap: the day one is updated and another is not,
the project publishes two inconsistent statements about the same fact. This is
a real, near-term risk given the number of "reverify before publication" items
already tracked.
**Proposed resolution:** Decide the structure **before** drafting the privacy
policy (Q-8). Either (a) merge the privacy policy and data-collection policy
into one document — the more sensible option at this project's scale, since the
draft already covers most of what a privacy policy needs — or (b) keep them
separate with a written boundary and cross-references, and make each fact live
in exactly one document. Record the decision in `HANDOFF.md`.

---

**F-45 · RECOMMENDATION · [PUB] · Gate 3**
**Draft section:** §3 — the EA/NHL non-affiliation paragraph, placed inside
"Where this information comes from."
**Repository/HANDOFF evidence:** E2C5 (assets retained as-is; retention is not
clearance); the attribution/non-affiliation notice is a separate unwritten
Gate 2 draft. The draft correctly says "this policy is not that notice."
**Why it matters:** Placement only. A non-affiliation disclaimer buried in a
sources section is easy to miss and duplicates what the dedicated notice and
the global footer will carry.
**Proposed resolution:** Keep a one-line pointer in §3 and let the dedicated
notice and footer carry the substance. **Do not** restate or alter any E2C3 /
E2C4 / E2C5 asset classification — this review does not reopen the
asset-retention decision and neither should the next drafting session.

---

**F-46 · RECOMMENDATION · [PUB] · Gate 3**
**Draft section:** §2 ("confidence information, review status", "OCR
extractions and related evidence"), §6 (`localStorage`, `sessionStorage`,
`indexedDB`), §7 ("Dormant authentication software", "database structure is
*capable* of storing"), §9 ("Docker log rotation is not configured in our
tracked Compose files").
**Why it matters:** The register is that of an engineering note, not a public
notice. Some of it is genuinely valuable transparency and should survive; some
of it will simply not parse for the audience. Separately, no defined terms are
given for "gamertag", "persona", "derived metrics", "de-identify", or
"operator", all of which carry weight in the document.
**Proposed resolution:** Keep every substantive disclosure; translate the
implementation nouns. Add a short "Words we use" list at the top defining
gamertag, persona/display name, derived metric, de-identify, and operator. Do
not cut §7's dormant-authentication disclosure — it is unusual, honest, and
directly relevant to what the database can hold.

---

**F-47 · ACCEPTABLE AS WRITTEN · [PUB] + [CHECK]**
**Draft section:** The status banner; the placeholder effective/last-updated
dates; and the entire "Internal drafting and publication checks" section,
including its instruction that the section "must be removed, or this entire
file must not be published as-is."
**Why it matters:** The internal section is the best-constructed part of the
document. It records blockers, deliberate current-versus-target discrepancies,
and preserved factual uncertainties instead of smoothing them away, and it
explicitly declines to check the Gate 2 checkbox. Keep the practice for the
remaining three legal drafts. The only requirement is the one it already states:
it must not ship.

---

## 7. Publication-blocker list

**What belongs here.** Only items that must be resolved before the public page
can go live. Items that are genuine obligations aimed at internal procedures,
collection notices, or individual responses are in §8 instead — they are not
less important, they simply do not gate this webpage. Items that would merely
improve the published text are recommendations inside the findings.

The draft's own six blockers remain live and are **not** superseded by this
review.

**Carried forward from the draft's internal section:**

1. Cloudflare Web Analytics disabled and dashboard-verified off (E2B3
   decision 1; still undone as of E2C5, 2026-09-09).
2. Both placeholder dates replaced with the actual publication date.
3. Hosting/cutover facts reverified against whatever is actually serving
   traffic at publication (E1I: cutover has not happened).
4. Live-site cookie audit of the deployed pages performed.
5. §9 backup language reconciled with E3's actual state at publication.
6. Independent legal review completed. **This document does not satisfy that
   blocker.**

**Added by this review (five):**

7. **F-01** — applicability determination recorded (which statute, on what
   facts), or an explicit, recorded operator decision to publish without one.
8. **F-07 / F-08** — a decided basis for opponent-player collection,
   publication, and retention. Reliance on the publicly-available exception is
   not presently established and must not be assumed either way without
   counsel's field-by-field assessment.
9. **F-30** — the recording-law fact pattern (a–e) gathered and put to counsel,
   and either answered or knowingly accepted by the operator in writing.
10. **F-14** — the §9 log statement factually checked (Q-12): confirm the logs
    exist and that the described manual practice actually occurs, then keep or
    reword the sentence accordingly.
11. **F-42 / F-34** — all internal-status narration and the internal
    drafting-and-publication-checks section removed, and the F-34 §6 variant
    swap executed as a deliberate publication step.

**Total: 11 publication blockers.** This supersedes the first version's list
of 13. Three items it listed as publication blockers were reclassified, because
the provisions cited do not require this webpage to carry them:

- the **privacy-contact role title** (F-05) — the required duty is the internal
  s.5(3) designation (§8 item 1); publishing a role title is a recommendation;
- the **Commissioner review right** (F-18) — the required duty is that
  applicable refusal and correction responses carry it (§8 item 3); publishing
  it is a strong recommendation;
- the **s.6(2) outside-Canada information** (F-24) — the required duty is that
  the organization's policies and practices contain it and that written
  information is available on request (§8 item 2); publishing it is the simplest
  implementation and is recommended.

**Also required, though not blockers of this page:** the tunnel must be reopened
under its own separate authorization, which remains **NOT AUTHORIZED** and is
untouched by this review.

---

## 8. Internal compliance requirements (not publication blockers)

These are obligations if PIPA applies. None of them gates the public page, and
all of them would survive a decision never to publish the page at all. They are
listed separately so that reclassifying them out of §7 does not lose them.

| # | Requirement | Source | Finding |
|---|-------------|--------|---------|
| 1 | Designate one or more individuals responsible for compliance, and record who | S1 s.5(3) | F-05 |
| 2 | Develop, follow and hold policies and practices; if outside-Canada service providers are used, include the "may occur" country list and each authorized purpose; make written information about them available **on request** | S1 s.6(1), s.6(2), s.6(3) | F-24, F-41 |
| 3 | Response template carrying the s.29 elements — reasons, provision relied on, contact person, and the s.46 review notice — plus the s.28 deadline and s.31 extension mechanics | S1 ss.28, 29, 31, 46 | F-17, F-18 |
| 4 | Correction procedure including the s.25(3) duty to annotate a correction requested but not made | S1 s.25 | F-20 |
| 5 | Fee handling: no fee for correction requests; written estimate before any chargeable access work | S1 s.32 | F-19 |
| 6 | Severance approach for mixed records, including the recordings case | S1 ss.24(3), 24(4), 27 | F-21, F-32 |
| 7 | Incident procedure: s.34.1 threshold, Reg s.19 report contents (incl. the s.19(h) contact), Reg s.19.1 individual-notification contents | S1 s.34.1, s.37.1; S2 Reg ss.19, 19.1 | F-38 |
| 8 | Verification-evidence handling: use only for the request, delete on closure | S1 s.8(4), s.35 | F-10 |
| 9 | Per-category lawful-basis mapping, recorded and put to counsel | S1 ss.7, 8, 14, 17, 20, 11/16/19 | F-07 |
| 10 | Withdrawal-of-consent handling, including the s.9(2) consequences explanation | S1 s.9 | F-39 |
| 11 | Collection notices where s.13(1) applies and s.13(4) does not remove it, and s.13.1 notices where those conditions apply | S1 ss.13, 13.1 | F-25, F-26 |
| 12 | Record the internal notes at F-02 (what "no monetization" does and does not establish), F-03 (commercial activity triggers a fresh review) and F-11 (synthetic-fixture preference) | — | F-02, F-03, F-11 |

---

## 9. Operator questions that genuinely require answers

Only questions that cannot be resolved from the repository, `HANDOFF.md`, or
official legal sources are listed. **Every question below asks for a fact or an
operator choice. None asks the operator to reach a legal conclusion** — where a
legal characterisation is needed, the question gathers the underlying facts and
the characterisation is reserved to counsel. There are **twelve**; the first
version had ten, and the count is recomputed rather than preserved.

| ID | Question | Type | Blocks | Why it cannot be answered here |
|----|----------|------|--------|--------------------------------|
| **Q-1** | Factually: does Boogeymen have any written constitution, bylaws, or membership rules? Is there a membership list, are there officers or an elected committee, is there a shared bank account or treasury? Has any incorporation or registration ever been filed under the *Societies Act*, the *Agricultural Societies Act*, or Part 9 of the *Companies Act* — and if so, is it current? Does anyone other than the operator have authority to decide what the site publishes? | Facts | F-01, F-06, the whole applicability tree | These facts determine which branch of §4 applies. Nothing in the repository establishes them. **The legal characterisation of the entity is for counsel, not the operator or this review.** |
| **Q-2** | Is there any commercial activity now, or planned — merchandise, sponsorship, paid access, third-party advertising, dataset licensing, or sale/barter of any member or contact list? | Facts | F-01, F-03 | E2C5 decision 1 says no monetization at launch. PIPEDA and PIPA s.56(3) turn on commerciality; "at launch" is not "never." |
| **Q-3** | Will the operator publish (a) a privacy-contact **role title**, (b) a legal or association name, and/or (c) a mailing address? Separately, does the operator want to designate a request office under Reg s.8 — noting that doing so is optional and triggers a duty to make that office's address public? | Operator choice | F-05, F-06 | (a) is recommended; (b) and (c) engage E2A decision 1, which the operator set. Not a drafting-agent decision. |
| **Q-4** | For Cloudflare, Proton and GitHub: what agreement, plan or terms is each account on; is there a written data-processing agreement or equivalent; what did the operator instruct or configure each provider to do with the data; does the operator control what each provider does with it, or does the provider use it for its own purposes; and what does each provider's own documentation say about where it processes data? | Facts | F-24, F-25 | PIPA s.6(2) and s.13.1 apply only if these are service providers acting **for or on behalf of** the organization. That is a factual and legal classification, **not a label the operator can choose**. Collect the contract and service facts here; counsel characterises them. |
| **Q-5** | For party voice chat specifically: strip audio from retained recordings, apply a defined retention limit to audio, or knowingly retain as-is? | Operator choice | F-09, F-31 | E2A decision 7 fixed retention for recordings. Only the operator can revisit it. PIPA s.35(1)/s.11(2)/s.16(2) create the tension; the operator resolves it. |
| **Q-6** | For the recorded party channels: (a) whose voices can be captured — team members only, or opponents and other third parties too; (b) was every participant told before recording began that the session was being or might be recorded; (c) did each participant expressly or implicitly agree, and what did that agreement consist of; (d) does the platform display a recording indicator visible to participants while recording; (e) where was each participant physically located at the time of recording? | Facts | F-30 | These are the facts any recording-law analysis would turn on, including the "secretly" and "all parties" limbs of Massachusetts G.L. c. 272 §99. Not derivable from the repository, and E2A decision 7 forbids claiming code inspection proves recording contents. **The legal analysis is for counsel; this review makes no Massachusetts or conflicts-of-law conclusion.** |
| **Q-7** | Does the operator intend to charge any fee for access requests? | Operator choice | F-19 | PIPA s.32(1) permits a reasonable access fee; s.32(2) forbids one for corrections. The policy should state the intention rather than leave it open. |
| **Q-8** | Are the Data Collection Policy and Privacy Policy one document or two, and if two, where is the boundary? | Operator choice | F-44 | Structural decision affecting three further unwritten drafts. Should be made before the privacy policy is drafted, not after. |
| **Q-9** | Where is each of the following physically located: the server(s) serving the site, the database, the OCR/recording workstation, the backup copies, the operator when operating the site, and each member? Through which providers does site traffic and email pass? | Facts | F-01, F-03 | Relevant if PIPEDA is engaged, because SOR/2004-219 s.1 exempts handling "within the Province of Alberta." **Where any act of collection legally "occurs" is a characterisation for counsel; this question gathers only the locations and data flows.** |
| **Q-10** | For opponent players: proceed on a considered basis with counsel's assessment, de-identify/pseudonymise in the public display, or publish club-level results only? | Operator choice | F-08, F-29 | The single largest design question in the review. No existing operator decision covers opponent-player publication, so nothing is being reopened — but this is squarely an operator + counsel choice, not a drafting one. |
| **Q-11** | Does the operator want to commit to a periodic review of the **main archive** (statistics, raw EA data, OCR evidence, source recordings) — and if so, at what cadence? Annual would mirror the email-tier cadence already approved at E2B3 decision 2. | Operator choice | F-13 | The first version of this review inserted an annual review of the main archive into its suggested wording without asking. That would be a **new operational commitment**, not a correction, so it is put here as an explicit decision. **Answering "no" is a valid answer and reopens nothing** — the approved retention decision stands either way. |
| **Q-12** | For the logs described in §9: do they actually exist, and which services produce them? Does manual review or deletion actually happen, and roughly how often? Is "roughly 30 days" an accurate description of current practice? | Facts | F-14 | The absence of Docker log rotation is verified, but it does not establish whether a manual practice exists. Only the operator knows what is actually done. |

---

## 10. Numbered correction plan for a later session

Sequenced by dependency. **Do not attempt this in one session** — steps 1–2 are
decision work, 3–7 are drafting and procedure-building, 8 is verification. Per
the project's session workflow, expect four or five short sessions.

**Phase A — decisions (operator + counsel; no drafting)**

1. Answer **Q-1, Q-2, Q-9, Q-12** — all fact-gathering. Put Q-1/Q-2/Q-9 to
   counsel and record the resulting applicability determination in a
   `HANDOFF.md` entry (E2D3 or later). This unblocks F-01 to F-04 and F-14.
2. Answer **Q-3, Q-4, Q-5, Q-6, Q-7, Q-8, Q-10, Q-11**. Record each as an
   operator decision in the same style as E2A/E2B3/E2C5 — decision, basis, and
   what it expressly does *not* establish. Q-4 and Q-6 are fact-gathering
   feeding counsel; the rest are operator choices.

**Phase B — structural (one drafting session)**

3. Apply the Q-8 outcome: either merge the data-collection and privacy policies
   or record the boundary. Do this **before** any further wording work, because
   it determines where F-38, F-39, F-40, and the §6/§12/§13 material live.
4. Record the F-41 four-bucket split (publish / collection notice / response
   template / internal) in `HANDOFF.md`, so the three remaining legal drafts
   inherit it rather than each re-deciding it.

**Phase C — internal procedures (one session; independent of the public text)**

5. Build the internal compliance items in §8 of this review — most importantly the s.5(3)
   designation, the s.6(1)–(2) policies-and-practices document, the s.29
   response template, and the incident procedure. **This work does not depend on
   the public page and can proceed in parallel with Phase D.**

**Phase D — public text corrections (one or two drafting sessions, in this order)**

6. **Rights and mechanics** — §10 and §13: F-22 (distinguish correction /
   withdrawal / removal), F-39 (withdrawal of consent), F-18 (Commissioner
   review right, recommended), F-17 (statutory deadline frame, recommended),
   F-20 (annotation, recommended), F-21 (mixed-record severance, recommended),
   F-19 (fees), F-10 (verification-evidence purpose limit), F-38 (breach
   commitment), F-40 (accuracy commitment).
7. **Providers, cross-border, categories and retention** — §2, §8, §9, §12:
   F-24 (countries and authorized purposes), F-25 (s.13.1 notice, if it
   applies), F-27 (what each provider receives), F-05 (role title), F-43
   (opponent persona identifier), F-13 (purpose-bounded retention framing, plus
   the Q-11 outcome if any), F-14 (log statement, per Q-12), F-15 (backup tail,
   once E3 activates), F-29 (align §11 with the Q-10 outcome), F-33
   (edge-injected beacon, if still relevant), F-42 (remove internal gate
   narration), F-46 (definitions and plain register), F-45 (non-affiliation
   pointer), F-26 (contact-point notices).

**Phase E — pre-publication verification (separate session, at Gate 3)**

8. Work the 11-item publication-blocker list in §7 of this review, including
   the F-34 variant swap for the draft's §6, removal of the internal section and
   status banner, the Q-12 log check, and the live-site cookie audit. Then, and
   only then, legal review.

**Explicitly out of scope for every step above:** reopening the E2C5 asset
decision; reopening the approved retention decision; drafting the Privacy
Policy, Terms of Use, or attribution notice (except as required by step 3's
structural decision); disabling analytics; reopening the tunnel; touching code,
assets, tests, configuration, scripts, dependencies, or any external account.

---

## 11. What can remain unchanged

The following are correct as written and should survive every subsequent
revision. Re-listed so a later session does not "improve" them by accident.

1. **§10's EA-publication sentence** — "The fact that information was previously
   published by EA through its own game services is not, by itself, a reason for
   us to refuse a request." It declines to treat prior EA visibility as
   self-evidently decisive without prejudging the exception either way (F-12).
2. **§6's attribution of the cookie-free claim to Cloudflare** rather than
   adopting it (F-35).
3. **§8's font statement**, verified against `layout.tsx:2` and correctly
   hedged (F-36).
4. **§8 and §13's Proton and GitHub facts**, which match E2B2/E1H/E1G exactly,
   including the deliberate non-naming of `alerts@` (F-37).
5. **§11's refusal to invent an age threshold** — consistent with the Alberta
   capacity-based approach recorded in the OPC/OIPC joint guidance (F-28).
6. **§9's tiered email-retention schedule**, including its already-approved
   annual review cadence for that tier (F-16).
7. **§10's proportionate verification posture** with no government ID by
   default (F-23).
8. **§7's dormant-authentication disclosure**, verified accurate against the
   route tombstone and the `accounts.ts` schema — unusual, honest, and worth
   keeping despite its technical register.
9. **§2's conditional framing of logging** ("may generate… our repository and
   configuration evidence does not establish…"), which is exactly the standard
   E2A decision 10 requires.
10. **The entire internal drafting-and-publication-checks section and the status
    banner** — as a practice. They must not ship, but they should be replicated
    in the three remaining legal drafts (F-47).

---

## 12. Corrections made to the first version of this review (E2D2A)

The first version of this review was itself a claim requiring checking, not
approved legal analysis. The following corrections were made against the primary
sources in §2. Each is recorded so the change is auditable and so the same
overstatements are not reintroduced.

**Structural**

1. **Six categories of requirement are now separated** (§3) — public-policy
   wording, collection notices, individual access/correction responses, internal
   policies and procedures, counsel-dependent determinations, and
   pre-publication factual checks. The first version treated operational duties
   as if they were duties to publish specific wording on the public page. No
   duty is now claimed as a publication requirement unless the cited provision
   expressly requires publication.

**Legal framing**

2. **Applicable law.** "PIPA very likely applies to this project in full" is
   replaced by a **conditional working assumption for drafting**, because the
   outcome turns on legal-form facts nobody has recorded (Q-1). Preserved: an
   unincorporated association is an "organization" under s.1(1)(i)(ii) and may
   be fully subject to PIPA.
3. **s.56.** The claim that incorporation would reduce the project's statutory
   burden is removed. It rested on an incomplete reading: s.56(1)(b)(ii) also
   admits an organization "that meets the criteria established under the
   regulations", so the s.56 route is not limited to incorporated bodies. The
   narrower and accurate point is retained — **qualifying s.56 status may narrow
   PIPA's application to non-commercial handling**. No claim is made about
   overall burden, and no legal form is recommended.
4. **"No monetization"** is kept where it does work — PIPEDA's application and
   PIPA s.56(3) commercial activity — and is not treated as a universal
   exemption.
5. **Publicly available information (F-08).** Every categorical claim that
   EA-service visibility cannot qualify is removed. The corrected position: the
   exception is defined restrictively by a closed list, reliance on it **is not
   presently established**, and determining whether it is available requires a
   field-by-field and source-specific legal assessment. **A factual error is
   also corrected: Reg 366/2003 s.7 contains six categories, (a) through (f),
   not five** — the first version omitted (f), which covers information
   collected from outside Alberta that would have fallen within (a)–(e) if
   collected within it. User-selected gamertags, EA-assigned persona IDs, and
   gameplay-generated statistics are now distinguished, because the "provided
   that information" limb in s.7(e) reads differently for each. The instruction
   to permanently reject the exception is removed; a future session must be free
   to act on counsel's assessment either way. The stable `ea_player_id`
   repository finding is preserved unchanged, and opponent-player collection and
   publication remains a serious unresolved Gate 2 issue.
6. **Lawful basis (F-07).** "The draft states no lawful basis for anything it
   does" is removed as a blanket claim. Corrected: the draft does not explicitly
   map consent provisions, exceptions, or reasonable-purposes analysis to each
   category. Members, voluntary email correspondents, recordings and opponent
   data are now treated as distinct positions. No consent is inferred that has
   not been documented.
7. **s.6 (F-24).** The claim that the draft breaches s.6(2) is removed. s.6(2)
   requires the **organization's policies and practices** to include the country
   list and authorized purposes, and s.6(3) requires written information about
   them to be **available on request** — neither requires this webpage to
   publish the complete list, and an unfinished public draft does not breach
   s.6(2). Preserved: the s.6(2) content requirement itself, the s.6(3)
   availability duty, and the point that "is occurring or may occur" does not
   demand verified datacentre addresses. Added: publishing the information is
   likely the simplest way to implement both duties at once. Also corrected:
   service-provider status is a factual and legal classification, not a label
   the operator may choose or decline.
8. **Requests and complaints (ss.24–32, s.46).** The claim that the Commissioner
   review right is a statutory requirement for the public policy page is
   corrected. It is **indisputably required in applicable refusal and correction
   responses** under s.29(1)(c)(iii), s.29(2)(b)(ii) and s.29(3)(c), and remains
   a **strong recommended public disclosure**. The same distinction is applied
   to fees (s.32), severance (s.24(3)–(4)), annotation (s.25(3)), withdrawal
   (s.9) and breach handling (s.34.1). The "single clearest defect" framing is
   withdrawn. No obligation is weakened — each moves to the target that actually
   carries it.
9. **Contact identity (F-05).** Preserved: s.5(3) requires an internally
   designated responsible individual, and collection and outside-Canada notices
   may use a name, position name, or title. Removed: the use of s.29 and the
   breach regulations (Reg s.19(h), s.19.1) as proof that a role title must
   appear in the general policy — those provisions govern particular responses
   and incident documents. "Privacy Contact for Boogeymen" is retained as a
   sensible proposed public role, without the claim that it automatically
   resolves every context. F-05 is downgraded from BLOCKER to MATERIAL
   CORRECTION and removed from the publication-blocker list; the internal
   designation moves to §8.
10. **Logs (F-14).** The assertions that publishing a manual 30-day target is
    worse than publishing nothing, and that the operator cannot keep the target
    because Docker automation is absent, are both removed as unestablished.
    Reclassified from MATERIAL CORRECTION to OPERATOR INPUT REQUIRED and turned
    into a factual check (Q-12). Automation remains preferable future
    operational work, not proof that the current statement is false.
11. **Retention (F-13).** The s.35 purpose-bounded framing concern is preserved.
    The annual review of the main archive, which the first version silently
    inserted into its suggested public wording, is removed from that wording and
    put to the operator as **Q-11**. The already-approved retention decision is
    not reopened, and E2B3's approved annual cadence for the *email* tier is not
    extended to the archive by implication.
12. **Recordings (F-30).** The unresolved cross-jurisdiction risk is preserved
    and the Massachusetts statute is now cited (S11). The factual question is
    expanded from two limbs to five (a–e), adding whether participants were told
    before recording, whether each agreed, and whether a recording indicator is
    displayed — because G.L. c. 272 §99 B(4) turns on a "secretly" limb as well
    as an all-parties limb. **No Massachusetts conclusion and no
    conflicts-of-law conclusion is drawn.**
13. **Operator questions (§9).** Rewritten to ask facts and operator choices
    only. Q-1 now asks for the underlying organisational facts instead of the
    entity's legal characterisation. Q-9 no longer asks "where does the operator
    consider collection to occur" — a legal conclusion — and instead asks for
    locations and data flows. Q-4 now collects contract and service facts before
    any legal characterisation. Q-11 (archive review cadence) and Q-12 (log
    facts) are added. The count is recomputed from ten to **twelve** rather than
    held at ten.
14. **Counts and classifications (§1, §6).** Recomputed from 5 / 5 / 20 / 9 / 8
    to **3 / 6 / 22 / 8 / 8** across the same 47 findings. Gate 2 decision
    blockers are separated from Gate 3 publication improvements and from
    internal compliance procedures, and the publication-blocker list is rebuilt
    from 13 to **11** with three items reclassified into §8. The draft remains
    **not accepted and not publishable** — for accurately stated reasons.
15. **Line count.** The first version's self-report was wrong: that file was
    **1,562 lines**, not 1,559. This corrected version is **2,017 lines**. Both
    figures were measured with `wc -l`, not estimated.

---

## 13. Limits of this review — read before acting on it

- **This is AI-assisted issue-spotting, not legal advice.** No statement here is
  a legal conclusion, and nothing here is a substitute for review by someone
  qualified to give advice on Alberta and Canadian privacy law. The draft's
  internal blocker 6 remains fully open.
- **This review is itself correctable.** Its first version contained the
  overstatements listed in §12. Treat this version the same way: as issue
  spotting to be checked, not as a finding to be relied on.
- **"Legal review completed" is NOT marked, and the Gate 2 "Data Collection
  Policy" checkbox was NOT checked.**
- **The policy draft was not edited.** It is byte-for-byte unchanged.
- **No conclusion is offered on Massachusetts law or on conflicts of law.**
  F-30 identifies the statute and the facts that would matter, and stops there.
- **The E2C5 asset-retention decision is not reopened**, and no E2C3/E2C4/E2C5
  classification is restated or altered. **The approved retention decision is
  not reopened either.**
- **Where official sources did not establish an answer, this review says so**
  rather than filling the gap: whether the publicly-available exception is
  available for any given field or source (F-08, Q-10); the legal form of the
  publishing entity (Q-1); the service-provider characterisation of Cloudflare,
  Proton and GitHub (Q-4); whether derived metrics are "opinions" under PIPA
  s.25(5); whether any s.4(3) PIPA exclusion could be argued; the legal effect
  of cookie-free analytics on any consent-banner requirement; and recording law
  where participants are in different jurisdictions (F-30).
- **No provision cited here was read against case law.** Statutory text can be
  qualified by judicial interpretation this review has not examined.
- **Cloudflare Web Analytics remains enabled**, and disabling and verifying it
  remains a required precondition to publication. Nothing in this session
  changed it.
- **Tunnel reopening remains separately unauthorized** and untouched.
- **E2 remains IN PROGRESS.**
