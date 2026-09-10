# Privacy Policy — Independent Review (E2E2)

> **Status: independent factual, structural, and cross-document review of
> `docs/planning/privacy-policy-draft.md` as written at E2E.** This review is
> issue-spotting against `HANDOFF.md`, the repository, and the Data Collection
> Policy draft/review. **It is not legal advice, not counsel review, and not
> counsel sign-off.** It resolves no counsel-dependent question and manufactures
> no operator decision. The Privacy Policy draft was **not revised** in this
> session.

> **E2E2A revision note (2026-09-09).** This review was corrected in place for
> several overstatements by a follow-up narrow correction session (E2E2A);
> `HANDOFF.md`'s E2E2A entry supersedes the affected E2E2 conclusions without
> rewriting the historical E2E2 entry. Corrected here: the legal-exposure
> conclusion in §5 (no AI review can establish the absence of legal exposure);
> the treatment of duplication against E2D3 item 10's actual (narrower) document
> boundary rather than F-44(b)'s original proposal, in P-05, P-14, and §4.5;
> P-07's classification, downgraded from MATERIAL CORRECTION to RECOMMENDATION
> because §6 already states the substantive point elsewhere; the required-
> correction count and list in §6/§10; and Q-E2E2-2 and Q-E2E2-3, resolved from
> existing authority (E2D3 item 10, the Gate 2 checklist) rather than left open
> as operator questions in §8. §9's counsel-question list is unchanged — the
> §7 drafting-preference issue raised in P-10 is not added as a new standalone
> counsel-only question. No policy draft, and no other conclusion of this
> review, was touched by the E2E2A pass.

---

## 1. Scope and method

**Reviewed:** `docs/planning/privacy-policy-draft.md` (334 lines) — public
sections §1–§14 and the internal drafting/publication-checks section.

**Read in full as authority:**

- `HANDOFF.md` — Gate 2 checklist, E1G/E1F/E1I context, and E2A, E2B2, E2B3,
  E2C2–E2C5, E2D, E2D2/E2D2A, E2D3, E2D4, E2D5, E2E.
- `docs/planning/data-collection-policy-draft.md` (605 lines).
- `docs/planning/data-collection-policy-review.md` (2,017 lines), with F-41 and
  F-44 read closely, plus F-34, F-42, F-43, F-45, F-46 and the Q-8 entry.
- `docs/planning/launch-page-design-prototypes.md` — read **only** for the
  established visual-reference / content-boundary rule.

**Method.** Every public sentence in the Privacy Policy draft was checked
against (a) the recorded operator decisions, (b) the Data Collection Policy's
corresponding text, and (c) the repository where a repository fact was
asserted. Duplication between the two drafts was measured mechanically
(sentence-level exact and near-match comparison of the two public bodies), not
estimated. The corrected E2D2A review is used as the existing legal
issue-spotting baseline; **no new legal research was performed.**

**Deliberately not done in this session:** the logging inventory; any contact
with or routing to counsel; any Terms of Use or EA/NHL notice drafting; any
access to providers, accounts, hosts, or the database; any provider-setting
change; any staging, commit, push, publish, deploy, or tunnel action; any
Gate 2 checkbox change.

**Baseline confirmed at session start and unchanged at session end:** branch
`main`; HEAD and `origin/main` both
`65bcddb43145d2fcffaeafb4d97d0e1a2737c35f`; nothing staged; the expected dirty
set exactly. E2 is IN PROGRESS; both policy checkboxes remain `[ ]`; counsel
review is deferred and incomplete; Cloudflare Web Analytics remains enabled;
tunnel reopening remains separately unauthorized.

---

## 2. Finding counts

| Classification | Count |
| --- | --- |
| BLOCKER | 1 |
| MATERIAL CORRECTION | 6 |
| RECOMMENDATION | 10 |
| ACCEPTABLE AS WRITTEN (explicit confirmations) | 15 |
| **Total findings** | **17** (plus 15 confirmations) |

*(Counts corrected by E2E2A: P-07 moved from MATERIAL CORRECTION to
RECOMMENDATION, changing 7/9 to 6/10. The total of 17 findings is unchanged.)*

Ownership labels used on every finding:

- **[PUB]** — belongs to the public Privacy Policy text.
- **[CHECK]** — belongs to the Privacy Policy's internal publication checklist.
- **[DCP]** — belongs to the Data Collection Policy instead.
- **[GATE3]** — later Gate 3 implementation work.
- **[COUNSEL]** — counsel/legal review.

### Index

| ID | Class | Owner | Subject |
| --- | --- | --- | --- |
| P-01 | BLOCKER | [PUB] + [CHECK] | Five public links target a repository draft path; no checklist item covers replacement |
| P-02 | MATERIAL | [PUB] + [CHECK] | §6 written in pre-publication voice; the F-34 analytics variant swap is not a blocker here |
| P-03 | MATERIAL | [PUB] | §8 conflates the country-fact gap with the provider-classification question |
| P-04 | MATERIAL | [PUB] | Cookie disclosure gap: Cloudflare strictly-necessary cookies and the no-banner posture are absent |
| P-05 | MATERIAL | [CHECK] | Two internal statements misdescribe the draft they govern |
| P-06 | MATERIAL | [PUB] | §5 drops "access" from the log-category list, in the visitor-facing section |
| P-07 | RECOMMENDATION | [PUB] | §6's cookie-free sentence is clumsily worded, though the paragraph's substantive point is already made elsewhere in §6 |
| P-08 | MATERIAL | [CHECK] | Blocker 9 collapses two separately-tracked DCP blockers into one |
| P-09 | RECOMMENDATION | [PUB] | Five cross-references to the same document; §14 restates the intro |
| P-10 | RECOMMENDATION | [PUB] + [COUNSEL] | Document-about-the-document register consumes a large share of a concise policy |
| P-11 | RECOMMENDATION | [PUB] | Opponent stable-persona identifier (F-43) not summarized where opponents will read |
| P-12 | RECOMMENDATION | [PUB] | §3 names recordings but omits incidental party voice chat |
| P-13 | RECOMMENDATION | [DCP] | No reciprocal link back to the Privacy Policy |
| P-14 | RECOMMENDATION | [DCP] + [PUB] | Verbatim duplication across both documents is a maintenance-drift risk worth reducing, within E2D3 item 10's boundary |
| P-15 | RECOMMENDATION | [GATE3] | Third-party marks named with no non-affiliation pointer |
| P-16 | RECOMMENDATION | [PUB] | "private GitHub storage" is a fact label, not a provider name |
| P-17 | RECOMMENDATION | [CHECK] | HANDOFF's E2D5 note cites the wrong E2D3 item number for the structure decision |

---

## 3. Findings

### P-01 · BLOCKER · [PUB] + [CHECK] — Public links point at a file that is explicitly unpublishable, and nothing on the checklist catches it

**Where:** lines 21, 55, 135, 172, 198 — five occurrences of
`[Data Collection Policy](./data-collection-policy-draft.md)`.

**Evidence.** The link target's own header reads: *"Do not publish, link, or
route this document until the internal checks at the bottom of this file are
all satisfied and independent review by counsel is complete."* The Privacy
Policy therefore ships five live links to a document that forbids being linked.
The path is also a repository path, not a route: no legal page exists in the
application (verified — the only routes under `apps/web/src/app` are `/`,
`/games`, `/games/[id]`, `/roster`, `/roster/[id]`, `/stats`, two `/preview/*`
pages, and the `/api/auth/[...all]` tombstone), and `HANDOFF.md` records **no
decision on what URL or path either policy will have**.

**Why it is a blocker rather than a correction.** Publication blockers 1–11
cover analytics, dates, hosting, cookies, legal review, applicable law,
opponent data, recording law, provider classification, the logging inventory,
and internal-status narration. **None mentions links.** Every other unfinished
element in this draft either fails loudly (the `[PLACEHOLDER — …]` dates) or is
tracked on the checklist. This one does neither: `./data-collection-policy-draft.md`
reads like a working link, and if the file's public half is lifted into a page
it either 404s or — worse, if the draft file is ever served — routes readers to
a document marked "not legally reviewed." It is the single defect in this draft
that can cause the wrong artifact to be published.

**Required resolution (see §4.1 for the full reasoning):** replace the five
link targets with a non-resolving, greppable placeholder consistent with the
file's existing convention, and add a publication blocker requiring their
replacement with the final public route. Do **not** invent `/privacy`,
`/legal/data-collection-policy`, or any other path — no such route decision
exists.

---

### P-02 · MATERIAL CORRECTION · [PUB] + [CHECK] — §6 is written in pre-publication voice, and the F-34 variant swap is not on this document's checklist

**Where:** §6, lines 82–87 — *"**We intend to disable Cloudflare Web Analytics,
and confirm from our live Cloudflare dashboard that it is off, before this site
is published.**"*

**Evidence.** The framing is correct **today** and is exactly what E2B3
decision 1 requires of an interim draft ("analytics is currently enabled and
scheduled for disablement before launch, not yet disabled"). The problem is
what it becomes at publication: a published page that says "before this site is
published" is self-falsifying, and by then blocker 1 will have been satisfied,
making the whole paragraph false in the opposite direction.

E2D2A **F-34** anticipated exactly this and required a deliberate variant swap
at publication. The Data Collection Policy carries that requirement explicitly
(its blocker 13: *"…and the section 6 analytics variant swap (E2D2A F-34) must
be executed as a deliberate publication step once analytics is disabled and
dashboard-verified off"*). The Privacy Policy's blocker 11 covers only Gate
vocabulary; blocker 1 forbids *changing* §6's framing prematurely but never
requires changing it at the right time. The obligation is asymmetric across the
two documents, which is precisely the drift F-44 warned about.

**Required resolution:** extend blocker 1 or 11 to require the §6 variant swap
at publication, in the same terms the Data Collection Policy uses. **[CHECK]
only** — the public §6 text must not change until analytics is dashboard-verified
off.

---

### P-03 · MATERIAL CORRECTION · [PUB] — §8 attaches a factual gap to a legal question

**Where:** §8, lines 114–119 — *"We do not have verified information about the
exact countries involved, and we do not publish a list of them here — see
'Providers' above for why that classification work is not yet complete."*

**Evidence.** These are two distinct uncertainties, tracked separately in the
Data Collection Policy's own checklist:

- **Blocker 12** — the outside-Canada country list is *an internal completion
  item*: "source it from each provider's own current documentation." It is a
  **factual** gap; the information exists and has not been gathered.
- **Blocker 11** — processor / controller / service-provider **classification**
  is UNRESOLVED and reserved for counsel (E2D2A F-24; E2D3 item 4, Q-4).

The two are sequenced (blocker 12 says to source the list "only once the
s.6(2) applicability and classification questions above are resolved"), so the
link is not invented — but the sentence as written tells a public reader that
the reason no countries are listed is that *classification work* is incomplete.
That is not the reason. The reason is that nobody has looked them up.

There is a second, smaller problem in the same clause: *"why that classification
work is not yet complete"* is internal-work framing in public text — the same
species of narration F-42 required removed, and the same species blocker 11
promises to keep out.

**Required resolution:** separate the two, and drop the internal cross-reference.
The Data Collection Policy's §12 already shows the clean form: *"We do not have
verified information about the exact physical storage locations each of these
providers uses, and we do not claim otherwise."* A two-sentence public
replacement that preserves both hedges without conflating them:

> We do not have verified information about the exact countries involved, and
> we do not publish a list of them here. We also do not state what legal role
> any of these providers has in relation to your information — see "Service
> providers" above.

(Wording is illustrative; the required change is the separation, not this
phrasing. Any replacement must still assert no country and no classification.)

---

### P-04 · MATERIAL CORRECTION · [PUB] — The one affirmative cookie disclosure the project has is missing from the document readers check for cookies

**Where:** §5 (lines 69–72) and §6 (lines 80–94).

**Evidence.** E2D3 item 10 assigns **visitor privacy** to the Privacy Policy
and **information categories / sources / purposes / public display / retention /
request handling** to the Data Collection Policy. Cookies and browser storage
are visitor privacy. The Privacy Policy currently says only what *our own code*
does not do, correctly hedged. It omits two things the Data Collection Policy
§6 does carry:

1. *"Our hosting/security provider (Cloudflare) may, under some circumstances,
   use strictly necessary cookies or similar mechanisms as part of its edge
   security or challenge processing. We do not currently have specific,
   verified information about any individual cookie Cloudflare may set, so we
   are not naming one here."* — traceable to E2B2's correction bullet, which
   directs future drafting to distinguish the cookie-free Web Analytics beacon
   from feature-dependent Cloudflare security cookies.
2. *"We do not plan to show a cookie-consent banner while our posture is 'no
   nonessential tracking'…"* — the E1 launch decision (Gate 2 checklist,
   "Decide whether analytics are needed", decided 2026-09-03).

This is **not a contradiction** — the Privacy Policy's hedge ("not a claim that
no browser storage of any kind is ever used by any … infrastructure component
we rely on") is compatible with both. But it is a material omission of privacy
overview content: a reader who opens the short policy looking for the cookie
answer is told only that our own source code has no `localStorage` call, which
is the least useful true statement available on the subject.

**Required resolution — one of:**

- **(a)** add the Cloudflare strictly-necessary-cookie sentence and the
  no-banner sentence to §5/§6, worded identically to the Data Collection
  Policy so the two cannot drift apart; **or**
- **(b)** scope §5 explicitly ("for cookies and browser storage in detail, see
  the Data Collection Policy") so the omission is visible rather than silent.

(a) is the better fit for E2D3 item 10's boundary; (b) is acceptable and
cheaper. Either way, do not name a specific Cloudflare cookie — none has been
documented or observed (E2B2; Data Collection Policy's factual-uncertainties
list).

---

### P-05 · MATERIAL CORRECTION · [CHECK] — Two internal statements misdescribe the draft they govern

**Where:** blocker 8 (lines 257–260) and the factual-uncertainties list
(lines 305–307), plus the split section (lines 286–296).

**(a) "does not mention recordings … at all" is false.** Blocker 8 states
*"This Privacy Policy does not mention recordings or voice chat directly."* The
factual-uncertainties list goes further: recording law is *"not discussed in
this document at all."* But §3 (lines 46–51) says the project maintains *"the
source recordings and screenshots that evidence is drawn from."* Recordings are
mentioned. What is absent is **voice chat** and any statement about recording
**legality** — which is the substantively correct posture (E2D3 item 6; F-30),
but the checklist does not say that. An internal instruction that misstates the
public text is a live hazard: a later session trusting blocker 8 could edit §3
believing it contains no recording reference.

**(b) The internal split section should accurately acknowledge how much text is
shared, rather than imply everything is either left-to-the-other-document or
summarized.** The split section asserts that drift-prone facts are *"stated
consistently with the Data Collection Policy's current text … and each full
elaboration is left to that document rather than duplicated here."*
Sentence-level comparison of the two public bodies:

- **15 of 60** public sentences in the Privacy Policy are **byte-identical** to
  a sentence in the Data Collection Policy.
- **12 more** match at ≥0.75 similarity.
- Combined, roughly **45%** of the Privacy Policy's public sentences are
  duplicated or near-duplicated text.

Exact duplicates include the entire safeguards/incident-notification passage,
the log-retention rule, the no-fee and gamertag-evidence bullets, the
prior-EA-publication sentence, the full OIPC paragraph, and both
opponent-minors sentences. Under E2D3 item 10's actual boundary, essential
high-level privacy facts are allowed to appear in both documents when needed
for a useful Privacy Policy summary — that boundary asks only that *detailed*
category inventories, retention schedules, and provider facts have one
authoritative home. So this is **not**, by itself, a decision violation; the
internal statement is inaccurate because it claims elaboration was "left to
that document," when for these sentences it plainly was not — the same words
appear in both. That inaccuracy, and the maintenance-drift risk the repeated
exact sentences create if one document is edited and the other is not, are
what the split section should say plainly. See P-14 for the substantive
follow-up.

**Required resolution:** correct both internal statements to describe what the
draft actually does. Blocker 8 should say the Privacy Policy references
recordings only as a maintained category and makes no statement about voice
chat or recording legality. The split section should say plainly which facts
are duplicated verbatim (a maintenance-risk observation, not a boundary
violation) and which are genuinely summarized — an accurate inventory is what
makes the drift risk manageable.

---

### P-06 · MATERIAL CORRECTION · [PUB] — §5 drops "access" from the log categories, in the section titled "Information about your visit"

**Where:** §5, lines 74–76 — *"This site's hosting and security infrastructure
may generate operational, error, and security logs…"*

**Evidence.** The Data Collection Policy §2 reads *"access, operational, error,
and security records."* The Privacy Policy drops **access**. Access logs are
the category most likely to concern a visitor and the one a visitor's own
request would be about; dropping it in the visitor-facing summary understates
in the direction that matters, and creates a wording difference between two
documents describing one fact. This is the same class of defect F-43 identified
in the Data Collection Policy's opponent bullet: not inaccurate, incomplete
downward.

**Required resolution:** restore "access" so both documents use the same list.
This asserts nothing new — the sentence is already conditional ("may generate")
and the logging inventory (blocker 10) remains open either way.

---

### P-07 · RECOMMENDATION · [PUB] — §6's cookie-free sentence is clumsy, but does not lose the paragraph's point

**Where:** §6, lines 89–94 — *"We attribute that claim to Cloudflare; it does
not by itself mean no analytics feature is enabled, and it does not resolve
whether a cookie-consent banner is legally required…"*

**Evidence.** "Cookie-free does not mean no analytics feature is enabled" reads
as an awkward, redundant clause. But §6's *first* paragraph already states the
point this review originally claimed was lost: *"This conflicts with our
intended 'no analytics' launch posture"* (lines 82–83). The paragraph as a
whole does not fail to disclose that enabled analytics conflicts with the
approved posture — it says so explicitly, just earlier in the section. E2E2's
original claim that this sentence "loses the point" and required a MATERIAL
CORRECTION was an overstatement, corrected by E2E2A. The attribution clause and
the consent-banner reservation are both correct and should survive regardless.

**Recommended resolution (optional polish, not required for the checkpoint):**
tighten the sentence so it does not read as a non sequitur — for example, by
echoing the first paragraph's "conflicts with the no-analytics posture" point
directly rather than the indirect "does not by itself mean" phrasing. Keep the
attribution to Cloudflare and the consent-banner reservation.

---

### P-08 · MATERIAL CORRECTION · [CHECK] — Blocker 9 collapses two separately-tracked blockers into one

**Where:** blocker 9, lines 261–265.

**Evidence.** The Privacy Policy's blocker 9 covers *"Provider
processor/controller/service-provider classification **and** the outside-Canada
country list."* The Data Collection Policy tracks these as **blocker 11**
(classification — counsel) and **blocker 12** (country list — internal
completion item, sourced from provider documentation). Merging them means
either one can be silently treated as closed when the other is. This is the
checklist-side twin of P-03.

**Required resolution:** split blocker 9 into two, matching the Data Collection
Policy's blocker 11 and blocker 12 numbering in the cross-reference so the
alignment is checkable.

---

### P-09 · RECOMMENDATION · [PUB] — Five pointers to one document; §14 restates the intro

**Where:** intro (lines 17–23), §3 (54–55), §10 (134–136), §11 (171–174), §14
(193–198).

The intro already says *"It is a short overview. For the detailed inventory …
see our Data Collection Policy — that document is the authoritative, detailed
source, and this policy does not repeat its full contents."* §14 says the same
thing again with a longer list, 180 lines later, and adds nothing. §3, §10 and
§11's pointers are each doing real work (they mark the boundary at the point a
reader hits it). Dropping §14 removes ~40 words of pure restatement from a
document whose entire purpose is being short.

---

### P-10 · RECOMMENDATION · [PUB] + [COUNSEL] — A large share of a concise policy is about the document rather than about the information

The draft's hedging discipline is its main strength and most of it must survive.
But a meaningful fraction of the public word count is sentences describing what
the policy declines to claim:

| Where | Sentence | Assessment |
| --- | --- | --- |
| §1, 31–34 | "That describes who runs it day to day — it is not a statement about the project's legal form…" | **Keep.** Directly guards the unresolved s.56 / legal-form question (F-01/F-02, Q-1). |
| §5, 70–72 | "That describes our own code — it is not a claim that no browser storage of any kind…" | **Keep.** Guards a grep-scoped fact against over-reading. |
| §5, 76–78 | "We do not claim that any particular log exists, or describe its exact contents, without evidence that it does" | **Candidate to cut.** Describes the drafting standard, not the practice. The conditional "may generate" already carries the caution. |
| §6, 87–88 | "This policy does not claim analytics is already disabled, and will not do so until that has been verified." | **Candidate to cut at publication.** Meaningful in a draft; meaningless once §6 is swapped per P-02. |
| §7, 104–110 | "We do not describe any provider here as a 'processor,' 'controller,' 'service provider,' or similar legal term — that determination has not been made." | **[COUNSEL].** The substantive half ("we do not claim a DPA, contractual term, retention period, or storage country") is a real disclosure and should stay. Whether to publish the sentence announcing that no legal classification has been made is a judgment for counsel — it may be protective, or it may invite the question. Do not decide it here. |
| §8, 118–119 | "see 'Providers' above for why that classification work is not yet complete" | **Cut** — see P-03. |
| §9, 127–128 | "This policy does not set out our internal incident-response procedure." | **Keep** — conventional and duplicated in the Data Collection Policy; see P-14. |
| §14 | whole section | **Cut** — see P-09. |

Nothing here is inaccurate. The recommendation is that a concise overview
should spend its length on how information is handled, and let the internal
checklist carry the record of what the drafters deliberately did not assert.

---

### P-11 · RECOMMENDATION · [PUB] — The stable persona identifier is disclosed only in the document opponents are least likely to read

**Where:** §3, lines 46–51.

E2D2A **F-43** established that `opponent_player_match_stats` stores
`ea_player_id`, documented "Stable across matches", and reasoned that the
difference between per-match snapshots and a persistent per-person identifier
*"matters to anyone deciding whether to make a request."* E2D5 applied that to
the Data Collection Policy ("an EA-provided stable persona identifier"). The
Privacy Policy summarizes only "opponent-club and opponent-player information."

The draft is defensible — it declares itself a summary and links out — and
this is **not** a contradiction. But the audience most affected by F-43's
reasoning is the opponent, and the opponent will land on the short policy. One
clause ("…including an EA-provided identifier that stays the same across
matches") would close the gap without importing the inventory. Note this
interacts with the unresolved opponent-data basis (F-07/F-08); disclosing more
plainly does not resolve or prejudge it.

---

### P-12 · RECOMMENDATION · [PUB] — §3 names recordings but not the incidental voice audio in them

The Data Collection Policy carries a full bullet on party voice chat captured
incidentally in gameplay recordings. The Privacy Policy names the recordings
themselves (§3) but not the audio. Since the recordings are already mentioned,
a reader gets the less sensitive half of the fact and not the more sensitive
half. Either add a clause noting recordings may incidentally include in-game
party voice chat (with the Data Collection Policy carrying every qualification),
or — if the deliberate choice is to keep voice chat entirely in the detailed
document — say so in the internal checklist, which currently claims the topic is
absent altogether (P-05a). **No statement about recording legality may be added
either way** (F-30; E2D3 item 6).

---

### P-13 · RECOMMENDATION · [DCP] — The link is one-directional

E2D3 item 10: *"Each document should link to the other."* The Privacy Policy
links to the Data Collection Policy five times. The Data Collection Policy
contains no link to the Privacy Policy. **Not fixable in this session** — the
Data Collection Policy is untouchable here and was not edited. Recorded so the
next Data Collection Policy pass closes it, subject to the same link-safety rule
as P-01.

---

### P-14 · RECOMMENDATION · [DCP] + [PUB] — Verbatim duplication is a maintenance-drift risk worth reducing, not a boundary violation

F-44 originally proposed making "each fact live in **exactly one document**"
(option (b) of its proposed resolution). **E2D3 item 10 is the binding operator
decision, and it recorded a narrower boundary than F-44's proposal:** the
Privacy Policy is a concise public overview and the Data Collection Policy is
the detailed inventory, each document should link to the other, and *detailed
category inventories, retention schedules, and provider facts* should have one
authoritative home rather than being duplicated inconsistently. Item 10 does
**not** say every fact, sentence, or high-level statement must live in exactly
one document — essential high-level privacy facts (safeguards, the breach
commitment, change notices, the no-fee and removal posture) may appear in both
documents when needed for a useful Privacy Policy summary. E2E2's original
framing of this finding as measured against F-44(b) — and P-05(b)'s original
"against F-44(b)" framing — overstated what E2D3 item 10 actually requires;
corrected by E2E2A.

The measurement in P-05(b) is still accurate as a measurement: 15 of 60 public
sentences are byte-identical to a Data Collection Policy sentence, and 12 more
are near-matches. Two blocks of **exact, sentence-for-sentence** duplication run
in opposite directions:

- **Assigned to the Privacy Policy by item 10, and also duplicated verbatim in
  the Data Collection Policy:** safeguards / incident-notification (Privacy
  Policy §9 ≡ Data Collection Policy §13, verbatim) and the change-notice
  sentence (§13 ≡ §13, verbatim).
- **Assigned to the Data Collection Policy by item 10, and also duplicated
  verbatim in the Privacy Policy:** the no-fee bullet, the gamertag-evidence /
  no-government-ID bullet, the prior-EA-publication sentence, the case-by-case
  removal paragraph, and the full OIPC paragraph (Privacy Policy §11 ≡ Data
  Collection Policy §10).

Neither block is, by itself, a violation of E2D3 item 10 — the *subject matter*
is exactly where item 10 puts it in both cases (safeguards/changes in the
Privacy Policy; request handling in the Data Collection Policy). The finding is
narrower: these are the same sentences, word-for-word, in two files with two
independent edit histories, which is a real drift risk if one is later revised
and the other is not — the concern F-44 was originally raised to address, even
though its specific "exactly one document" prescription was not adopted.

**Recommended (not a required correction):** where verbatim duplication can be
safely replaced with a concise Privacy Policy summary plus a cross-reference to
the Data Collection Policy's authoritative detailed text, do so — this reduces
drift risk without losing the boundary item 10 already sets. This does **not**
require picking one exclusive home for every duplicated sentence, and does
**not** require editing the Data Collection Policy in the same session. See §7
and §8 for how this is now handled as implementation guidance rather than an
operator question.

---

### P-15 · RECOMMENDATION · [GATE3] — Third-party marks appear with no non-affiliation pointer

§1 names "EA Sports NHL Pro Clubs"; §3, §7 and §11 name "EA's game services."
The Data Collection Policy §3 carries a one-line non-affiliation paragraph; the
Privacy Policy carries none, and its internal section states that assets and
EA/NHL attribution are deliberately absent (correct per E2A decision 9 and
E2C2–E2C5 — attribution finalization is still blocked, and E2C5 is retention,
not clearance).

The absence is defensible: F-45 recommends letting the dedicated notice and the
global footer carry the substance. Recorded only so the still-unwritten
attribution/non-affiliation notice and the Gate 3 footer work account for the
Privacy Policy page too. **Nothing is drafted here and no asset classification
is reopened.**

---

### P-16 · RECOMMENDATION · [PUB] — "private GitHub storage" names a fact, not a provider

§7 lists *"**private GitHub storage** (source code and a limited set of test
fixtures)"* in a list whose other entries are provider names (Cloudflare,
Proton Mail, EA). The provider is GitHub. Separately, the Privacy Policy omits
the prior-public-repository caveat the Data Collection Policy carries in §8 and
§10 ("copies made by others during that period cannot be recalled by us") —
correctly, since E2A decision 8 assigns that disclosure to the Data Collection
Policy, but the effect is that "private GitHub storage" may read as
always-private. Naming GitHub plainly and relying on the link is the low-cost
fix; adding the caveat here would duplicate against E2A decision 8 and P-14.

---

### P-17 · RECOMMENDATION · [CHECK] — A HANDOFF pointer names the wrong E2D3 item

`HANDOFF.md`'s E2D5 "next session recommendation" cites *"E2D3 item 8's
document-structure boundary."* The document-structure decision is **item 10**;
item 8 is the opponent-player display decision. The Privacy Policy draft's own
internal section cites item 10 correctly, so no drafting error followed from it.
Historical HANDOFF entries are not rewritten (E2D3 item 12 establishes that
convention), and this review does not rewrite one. Recorded so a later session
following that pointer lands on the right decision.

---

## 4. The four focus questions

### 4.1 Publication-link safety (focus item 1)

**How a planning draft should represent the eventual public link.**

Three properties are needed. The representation must (i) be impossible to
mistake for a working route, (ii) fail visibly rather than silently if the text
is published unchanged, and (iii) be findable by a single mechanical check
before publication. `./data-collection-policy-draft.md` has none of them: it
looks like a working relative link, it resolves to a real file inside the
repository, and nothing on the checklist looks for it.

**What is known and not known:**

- No public route exists for either policy (verified against
  `apps/web/src/app`).
- `HANDOFF.md` records **no decision** on a URL or path for either document.
  Choosing one here would manufacture an operator decision.
- The Gate 3 checklist already contains the gate that would catch a leftover
  token: *"Run a broken-link and missing-asset scan covering internal
  navigation, game/player/context links, and **every footer/legal
  destination**."*

**Recommended safe placeholder.** Use the convention the file already
establishes for its dates:

```
[Data Collection Policy](PLACEHOLDER-DATA-COLLECTION-POLICY-URL)
```

It cannot resolve; it is one grep target across all five occurrences; it is
visually consistent with `[PLACEHOLDER — actual publication date, not yet set]`;
and it commits to no route. A plain-text alternative ("see our Data Collection
Policy", unlinked) is also acceptable and slightly safer, at the cost of losing
the marker that a link is intended.

**Required publication-time replacement — add as a new blocker:**

> **Replace every `PLACEHOLDER-…-URL` token with the Data Collection Policy's
> final published route before this page goes live.** The route is not decided:
> no legal page route exists in the application and `HANDOFF.md` records no URL
> decision. Confirm each link resolves to the **published** Data Collection
> Policy, not to `docs/planning/data-collection-policy-draft.md`, and that the
> Gate 3 footer/legal-destination link scan covers this page.

The same rule applies in reverse when P-13 is addressed in the Data Collection
Policy.

### 4.2 Section 8's two uncertainties (focus item 2)

**Yes — the wording should be separated.** Full reasoning in P-03. In short: the
absent country list is a factual gap (Data Collection Policy blocker 12, an
internal completion item sourced from provider documentation); the absent
provider classification is a counsel question (blocker 11; E2D2A F-24; E2D3
item 4, Q-4). §8 currently gives the second as the reason for the first, which
is inaccurate, and does so in internal-work vocabulary in public text. Separate
into two sentences, drop "why that classification work is not yet complete", and
mirror the Data Collection Policy §12's cleaner construction. Split the
corresponding checklist item too (P-08).

### 4.3 Consistency with the Data Collection Policy (focus item 3)

| Topic | Verdict | Basis |
| --- | --- | --- |
| Information categories and sources | **Consistent**, one gap | §3 is a declared summary of Data Collection Policy §2/§3 with a pointer; no category is described differently. Two summary omissions noted as recommendations, not contradictions: the opponent stable persona identifier (P-11) and incidental party voice chat (P-12). |
| Public indexing | **Consistent** | Privacy Policy §4 ("intended to be found through normal search-engine indexing"; private evidence not published, not intended to be indexed) matches Data Collection Policy §5 and E1F. "Intended" avoids the F-42 staleness trap — indexing controls (`robots.txt`, sitemap, per-page metadata) are still undeployed, and neither document claims otherwise. |
| Analytics and browser storage | **Consistent on analytics; incomplete on cookies** | Both say Web Analytics is currently enabled, conflicts with the approved posture, must be disabled and dashboard-verified first, with cookie-free attributed to Cloudflare. Matches E2B3 decision 1's mandated interim framing. Gaps: no Cloudflare strictly-necessary-cookie disclosure and no consent-banner posture (P-04); the cookie-free sentence is clumsily worded, though its substantive point is made elsewhere in §6 (P-07); the pre-publication voice is untracked (P-02). |
| Provider facts | **Consistent** | Same five providers, same roles, no classification, no DPA, no contract term, no retention period, no storage country in either. Privacy Policy omits the Cloudflare Tunnel, the single-mailbox/no-forwarding detail, the prior-public-repository caveat and the self-hosted-fonts fact — all correctly left to the detailed document. Labeling nit at P-16. |
| Retention and logs | **Consistent** | E2D3 item 12's purpose-based log rule appears substantially verbatim in both; no fixed period, no automated deletion, no claim about which logs exist; provider-controlled logs carved out in both. Main-archive retention summarized as purpose-based with manual removal, matching Data Collection Policy §9. No 30-day target anywhere (grep-verified). The "no scheduled periodic review" statement matches E2D3 item 11 in both. |
| Request verification and removal | **Consistent** | No fee (E2D3 item 9); reasonable gamertag-control evidence, no government ID by default (E2A decision 5); case-by-case correction/de-identification/removal with no promise either way, prior EA publication not automatic grounds to refuse (E2A decision 6; F-12 wording preserved); OIPC route with the "not conclusively covered" hedge. Response targets (7/30 days) and the four request types are correctly left to the detailed document, which the closing pointer names. Duplication concern at P-14, not a consistency defect. |
| Minors / opponents | **Consistent** | Adult-only membership; opponents may include minors, ages unknown, unverifiable, not collected, undeterminable from EA data — verbatim across both, matching E2A decision 3. No under-13 threshold introduced. |
| Incident handling and change notices | **Consistent (verbatim)** | Reasonable-steps / no-absolute-guarantee / real-risk-of-harm notification / no internal procedure disclosed, and the on-site material-change notice with a visible "Last updated" date (E2A decision 12), are byte-identical across both documents. Ownership question at P-14. |

**No contradiction between the two documents was found on any of the eight
topics.** The defects are omissions, imprecision, and duplication — not conflict.

### 4.4 Things the draft must not do (focus item 4)

| Prohibition | Result | Evidence |
| --- | --- | --- |
| Imply PIPA/PIPEDA applicability determined | **Clear** | §1 states operation "is not a statement about which privacy law, if any, applies"; §11's OIPC paragraph is framed as the applicable route "where … PIPA governs a request" and says explicitly this is "not a statement that this project's activities are conclusively covered by that Act." Internal blocker 6 and the uncertainties list keep F-01/F-02 UNRESOLVED. |
| Imply opponent-data or recording legality established | **Clear** | No lawful-basis claim anywhere; §12 states only unknowability of opponent ages. Recordings appear once, as a maintained category, with no legality statement (F-30 preserved). Blockers 7 and 8 keep both open. Internal wording about recordings needs correcting (P-05a), but the public text asserts nothing. |
| Claim provider contracts, classifications, retention periods, or storage countries | **Clear** | §7 disclaims all four explicitly; §8 asserts no country list. |
| Claim Web Analytics is disabled | **Clear** | §6 states it is **currently enabled**, conflicts with the approved posture, and that the policy "does not claim analytics is already disabled." Matches E2B3 decision 1 exactly. Publication-time framing is the P-02 gap, not a present false claim. |
| Publish `alerts@boogeymen.app` | **Clear** | Grep: zero occurrences in the file. Only `webmaster@boogeymen.app` (privacy contact) and `security@boogeymen.app` (vulnerability reports only) appear — E2A decision 13. |
| Restore a 30-day log-retention target | **Clear** | Grep: no "30" appears anywhere except in finding references to F-30. §10 states no fixed automatic deletion period, purpose-based retention, per E2D3 item 12. |
| Copy legal wording from the design prototype | **Clear** | Grep: no `boogeymen.gg`, no `privacy@`. No traffic-measurement claim, no prototype browser-storage assertion, no prototype minors posture. The prototype's conflicting content is exactly what `launch-page-design-prototypes.md`'s content-boundary section warns about, and none of it is present. |
| Treat asset retention as legal clearance | **Clear** | No asset, artwork, crest, mark, or attribution content in the public sections at all. The internal section states E2C5 is retention, not clearance, and reopens nothing. |

### 4.5 Conciseness relative to the Data Collection Policy (focus item 5)

**Measured:** 1,458 public words (Privacy Policy §1–§14) versus 3,571 public
words (Data Collection Policy §1–§13) — **41%**. The Privacy Policy genuinely
does not restate the category-by-category inventory, the tiered email-retention
schedule, the accounts/dormant-authentication disclosure, the full provider
fact set, the response-time targets, or the four request-type mechanics. On the
structural test, **E2D3 item 10's boundary — the actual, binding operator
decision — is respected**: detailed inventories, schedules, and provider facts
stay in the Data Collection Policy. (F-44's own "exactly one document"
proposal was not the boundary the operator adopted; see P-14.)

**Material verbosity worth removing** — only these, and only P-09 and P-10 are
recommended for action:

1. **§14 (~40 words)** restates the intro's pointer verbatim in substance
   (P-09).
2. **Meta-commentary** — of 60 public sentences, roughly a dozen describe what
   the document declines to claim rather than how information is handled. Most
   must stay; four are candidates to cut, one is for counsel (P-10 table).

**Verbatim duplication worth reducing where safe** — 15 byte-identical sentences
plus 12 near-matches, listed in P-14. This is the drift risk F-44 originally
flagged, now scoped to E2D3 item 10's narrower boundary: it is a maintenance
observation and implementation guidance (§7, §8), not a decision the operator
needs to make.

Everything else in the draft's length is doing work.

---

## 5. Overall verdict

**The Privacy Policy initial draft is factually sound, decision-compliant, and
structurally correct — but it is NOT yet acceptable as the E2E drafting
checkpoint.**

What the draft gets right is the hard part. Every recorded operator decision
that bears on it is honored: the interim analytics framing is verbatim what
E2B3 decision 1 requires; the log-retention rule is E2D3 item 12 substantially
verbatim; the no-fee, verification, removal, minors, contact, and change-notice
positions all trace to specific decisions; the four E2D2A UNRESOLVED questions
are preserved as unresolved in both the public text and the checklist; the
prototype's conflicting content is absent; and nothing treats E2C5's
asset-retention decision as clearance. No contradiction with the Data Collection
Policy was found on any of the eight topics checked. **No new unsupported legal
claim was identified within this review's stated factual and issue-spotting
scope.** *(E2E2A correction: E2E2 originally concluded the draft introduces "no
new legal exposure." An issue-spotting review of this kind — no new legal
research, no counsel sign-off — cannot establish the absence of legal exposure;
it can only report that it did not find an unsupported claim within the scope
it checked. That narrower finding is what stands.)*

What blocks acceptance is narrower and mostly mechanical. One defect (P-01) can
cause the wrong document to be published or linked and is caught by nothing on
the checklist. Six material corrections tighten public accuracy (P-03, P-04,
P-06) or repair a checklist that currently misdescribes and under-covers
the draft it governs (P-02, P-05, P-08). None requires a new operator decision;
none requires counsel; none reopens settled ground. *(P-07 was reclassified
from MATERIAL CORRECTION to RECOMMENDATION by E2E2A — see §2 and the P-07
finding.)*

**Gate 2 remains unchecked either way.** Counsel review is deferred and
incomplete (E2D3 item 14), Web Analytics remains enabled, and both policy
checkboxes stay `[ ]`. Accepting the drafting checkpoint means accepting the
draft as a complete first draft — not as publishable text.

---

## 6. Exact corrections required before the drafting checkpoint can be accepted

Seven items (corrected by E2E2A — P-07 is no longer required; see §7). All are
within the Privacy Policy draft; none needs an operator decision or counsel.

1. **P-01** — Replace all five `](./data-collection-policy-draft.md)` targets
   (lines 21, 55, 135, 172, 198) with a non-resolving placeholder such as
   `PLACEHOLDER-DATA-COLLECTION-POLICY-URL`, and **add a publication blocker**
   requiring replacement with the final published route (text drafted in §4.1).
   Do not invent a route.
2. **P-02** — Extend blocker 1 or 11 to require the F-34 §6 analytics variant
   swap at publication, matching the Data Collection Policy's blocker 13. Do
   not change §6's public text now.
3. **P-03** — Split §8's final sentence so the unverified country list and the
   unresolved provider classification are stated as two separate facts, and
   delete "see 'Providers' above for why that classification work is not yet
   complete."
4. **P-04** — Close the cookie gap. Prescribed resolution (per §8's Q-E2E2-2
   analysis): the Privacy Policy carries a concise cookie summary — the
   Cloudflare strictly-necessary-cookie sentence and the no-consent-banner
   posture, in §5/§6 — plus a link to the Data Collection Policy for the
   detailed treatment; the Data Collection Policy's existing disclosure is not
   removed. Name no specific cookie.
5. **P-05** — Correct blocker 8 and the recording bullet in the
   factual-uncertainties list (§3 *does* mention recordings; voice chat and
   recording legality are what is absent), and correct the split section so it
   accurately acknowledges that some essential privacy facts are repeated
   verbatim across both documents — a maintenance-risk observation, not a
   decision violation — while detailed inventories, schedules, and complete
   provider facts remain in the Data Collection Policy.
6. **P-06** — Restore "access" to §5's log-category list so both documents read
   "access, operational, error, and security."
7. **P-08** — Split blocker 9 into two items mirroring the Data Collection
   Policy's blocker 11 (classification, counsel) and blocker 12 (country list,
   internal completion).

---

## 7. Optional improvements

- **P-07** *(moved here from §6 by E2E2A — no longer a required correction)* —
  Tighten §6's cookie-free sentence so it reads less like a non sequitur, for
  example by echoing the "conflicts with the no-analytics posture" point from
  §6's first paragraph directly. Polish only: the paragraph already makes its
  substantive point without this change.
- **P-09** — Delete §14; the intro already carries the pointer.
- **P-10** — Trim the four cut-candidate meta-sentences (§5's drafting-standard
  sentence, §6's "does not claim analytics is already disabled" at publication
  time, §8's cross-reference per P-03, §14 per P-09). Keep §1's, §5's and §11's
  hedges. Refer §7's "no legal term" sentence to counsel.
- **P-11** — Add one clause on the EA-provided stable persona identifier to §3.
- **P-12** — Add or explicitly scope out incidental party voice chat in §3.
- **P-15** — Account for the Privacy Policy page in the attribution notice and
  Gate 3 footer work.
- **P-16** — Name GitHub plainly instead of "private GitHub storage."
- **P-17** — Note the E2D3 item-number slip in HANDOFF's E2D5 entry so a later
  session does not follow it.
- **P-13** — Data Collection Policy work; see §8 for the decisions it depends
  on. Not for the coming Privacy Policy correction session (do not edit the
  Data Collection Policy there).
- **P-14** — Implementation guidance, not an operator decision (see §8):
  preserve essential high-level overlap where useful; avoid copying complete
  detailed inventories, schedules, or provider facts; shorten verbatim
  duplication when it can be safely replaced by a concise summary and
  cross-reference. Do not edit the Data Collection Policy in the coming Privacy
  Policy correction session.

---

## 8. Questions requiring operator input

One. *(E2E2A correction: E2E2 originally listed three questions here. Two of
them — the cookies boundary and duplication homes — are resolved below from
existing authority rather than left open; only the route question remains.)*

- **Q-E2E2-1 (route).** What public URL or path will the Privacy Policy and the
  Data Collection Policy have? No route exists and no decision is recorded. The
  P-01 placeholder is safe indefinitely, but the link cannot be finalized
  without this. **Gate 3 routing decision, not a legal question. It does not
  block use of the visibly non-resolving placeholder now, and it does not
  require an answer before accepting the drafting checkpoint.**

**Resolved from existing authority, not operator questions:**

- **Cookies boundary (was Q-E2E2-2).** Not a new operator question — it
  resolves from decisions already on record. E2D3 item 10 assigns
  visitor-facing cookie/browser-storage information to the concise Privacy
  Policy overview; the Data Collection Policy remains the authoritative
  detailed treatment. The Gate 2 checklist independently requires the Data
  Collection Policy to cover analytics and cookies. Therefore: the Privacy
  Policy should carry a concise cookie summary (the Cloudflare
  strictly-necessary-cookie sentence and the no-consent-banner posture) and
  link to the Data Collection Policy, **without** removing the Data Collection
  Policy's existing detailed disclosure. This is the prescribed resolution for
  P-04, which remains a MATERIAL CORRECTION. No operator answer is needed.
- **Duplication homes (was Q-E2E2-3).** Not an operator question — converted to
  implementation guidance for P-14: preserve essential high-level overlap where
  useful (E2D3 item 10 permits this); avoid copying complete detailed
  inventories, retention schedules, or provider facts into the Privacy Policy;
  shorten verbatim duplication when it can be safely replaced by a concise
  summary and cross-reference; do not edit the Data Collection Policy in the
  coming Privacy Policy correction session. No single exclusive home needs to be
  chosen for every safeguards, request, complaint, or change-notice sentence.

---

## 9. Questions remaining exclusively for counsel

Unchanged from the corrected E2D2A baseline; this review resolves none of them
and adds no new legal research.

- **Applicable law** — whether Alberta PIPA, PIPEDA, both, or neither governs
  this project, including the s.56 non-profit analysis and the legal-form facts
  Q-1 asked for (E2D2A F-01/F-02; E2D3 item 1). *Related observation, not a new
  question:* both drafts describe the project as run "on a volunteer basis."
  The phrasing is hedged in both ("not a statement about the project's legal
  form") and is **acceptable as written**, but it sits adjacent to the s.56
  question and must not be allowed to harden into a non-profit claim in any
  later edit.
- **Opponent-player basis** — collection, publication and retention; whether the
  PIPA Reg 366/2003 s.7 "publicly available" exception applies, on a
  field-by-field assessment. Neither relied on nor rejected in this draft
  (F-07/F-08; E2D3 item 8). P-11 does not prejudge it.
- **Recording law** — the Alberta / Ontario / Massachusetts fact pattern and any
  conflicts-of-law question (F-30; E2D3 item 6). The Privacy Policy asserts
  nothing about it and must continue not to.
- **Provider classification** — processor / controller / service provider under
  PIPA s.6(2)/s.13.1, and any resulting outside-Canada notice obligation
  (F-24; E2D3 item 4, Q-4).
- **Consent banner** — whether one is legally required in any relevant
  jurisdiction, given cookie-free analytics and possible strictly-necessary
  edge cookies. Left open in both drafts; P-04 does not change that.

These five are the complete, unchanged set of counsel-only questions.
*(E2E2A correction: E2E2 originally added a sixth, standalone item here — whether
§7's sentence announcing that no processor/controller/service-provider
classification has been made should be published at all. That drafting-strategy
judgment, raised in P-10, is not added as a new standalone counsel-only
question by this review. It may be reviewed together with the complete policy
during eventual legal review, but it does not join the five established
unresolved counsel issues above.)*

---

## 10. Recommended next single session

**A narrow Session 3 correction pass on `docs/planning/privacy-policy-draft.md`
only**, applying §6's seven required corrections (P-01 through P-06 and P-08)
and, at the operator's option, P-07, P-09, P-11, P-12, and P-16 where they
improve clarity without increasing duplication. It is one document, one
objective, bounded, and needs neither new facts nor counsel. Q-E2E2-1 (route)
can be answered before or after it and does not change what that session
writes. The cookies boundary and duplication-homes questions are no longer
open operator questions (see §8) — P-04's prescribed resolution and P-14's
implementation guidance already tell that session what to do.

**Do not combine that session with:** the read-only logging inventory (still
required by both drafts' blocker 10), routing the Q-1/Q-4/Q-6 fact patterns and
counsel-dependent findings to counsel, any Data Collection Policy edit
(including P-13 and P-14), the Terms of Use, or the EA/NHL attribution notice.
Each is its own session.

**After the correction pass**, the two remaining E2 fact-gathering items —
the logging inventory and the counsel routing — are the critical path to
publication; neither policy can go live until blocker 10 and the legal-review
blocker close.

---

## 11. What this review did not touch

- `docs/planning/privacy-policy-draft.md` — **byte-for-byte unchanged**
  (md5 `2ef791081e8b6d4449587ff79b9cd63a` before and after).
- `docs/planning/data-collection-policy-draft.md` — **byte-for-byte unchanged**
  (md5 `1a6e962ddb39cde1726e049090a1829a`).
- `docs/planning/data-collection-policy-review.md` — **byte-for-byte unchanged**
  (md5 `40cb0f335704cd7741cf34e19abdbe08`).
- `docs/planning/launch-page-design-prototypes.md`,
  `docs/planning/ea-asset-decision-memo.md`,
  `docs/planning/ea-content-usage-policy-research.md` — read only, unchanged.
- No code, configuration, asset, test, or dependency changed.
- No external provider, account, host, or database accessed; no provider
  setting changed.
- No Gate 2 checkbox changed — the Privacy Policy and Data Collection Policy
  checkboxes both remain `[ ]`.
- Nothing staged, committed, pushed, published, deployed; the tunnel was not
  reopened.
- No logging inventory performed; nothing routed to counsel; no Terms of Use or
  EA/NHL notice drafted; no new legal research conducted.
- `HANDOFF.md` edited only to add one E2E2 Active State entry (this session),
  plus one further E2E2A Active State entry recording the corrections applied
  to this document (a later, narrowly-scoped correction session). The
  historical E2E2 entry is not rewritten.

**E2 remains IN PROGRESS.** Counsel review remains deferred, not completed.
Cloudflare Web Analytics remains enabled. Tunnel reopening remains separately
unauthorized.
