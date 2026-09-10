# EA/NHL Attribution Notice — Independent Review (E2F2)

> **Status: independent factual, structural, and public/internal-boundary
> review of `docs/planning/ea-nhl-attribution-notice-draft.md` as written at
> E2F.** This review is issue-spotting against `HANDOFF.md`, the repository,
> and the E2C3/E2C4 research and memo. **It is not legal advice, not counsel
> review, and not counsel sign-off.** It makes no finding about permission,
> infringement, fair use, ownership, or clearance for any asset; it does not
> reopen E2C5's asset-retention decision; and it recommends no asset change.
> The attribution notice draft was **not revised** in this session.

> **Correction — E2F2A (2026-09-09).** This review has been corrected in two
> places, and the corrected text below is the live version.
>
> 1. **A-02 (EA statement placement)** overstated EA's condition, asserting that
>    EA requires the statement "wherever EA game content is displayed" and that
>    the footer is the only surface capable of satisfying it. The reviewed EA
>    text says neither. A-02 is **reclassified from MATERIAL CORRECTION to
>    RECOMMENDATION**, and the underlying record
>    (`docs/planning/ea-content-usage-policy-research.md` §7 item 1) is corrected
>    to match. See also Q-C-1, corrected below.
> 2. **A-09/A-10 (flag derivation)** stated that "no repository evidence links
>    the deployed inline flags to those two files." That is false: the deployed
>    inline flags reproduce the same vector path data as
>    `docs/branding/flags/canada.svg` and `united-states.svg` (verified
>    mechanically). A-10 **remains a MATERIAL CORRECTION** — the public notice
>    still gives one flag family two unreconciled descriptions — but its evidence
>    and proposed wording are corrected.
>
> **Corrected counts: 1 BLOCKER, 9 MATERIAL CORRECTIONS, 8 RECOMMENDATIONS,
> 2 ACCEPTABLE AS WRITTEN (20 total).** No other finding changes class, and no
> finding is added or withdrawn.

---

## 1. Scope and method

**Reviewed:** `docs/planning/ea-nhl-attribution-notice-draft.md` (309 lines) —
the public notice (§§1–10), the short-form/footer drafting component, and the
internal drafting/publication-checks section.

**Read in full as authority:**

- `HANDOFF.md` — the Gate 2 checklist (lines 138–156) and the E2A, E2C2, E2C3,
  E2C4, E2C5, E2D–E2D5, E2E–E2E3, and E2F Active State entries.
- `docs/planning/ea-content-usage-policy-research.md` (581 lines), with §4
  (EA/third-party boundary), §6.2–6.3 (crest families), and §7 (conditions)
  read closely.
- `docs/planning/ea-asset-decision-memo.md` (605 lines) — read for its purpose
  and scope statement, its verified rendering-surface facts (§1 X-Factor
  consumers, §2.1–2.3 the crest chain and every production consumer), and its
  §6 boundary, together with HANDOFF's E2C4 summary of it.
- `docs/planning/privacy-policy-draft.md` and
  `docs/planning/data-collection-policy-draft.md` — identity, noncommercial
  posture, contact addresses, and source descriptions only.
- `docs/planning/privacy-policy-review.md` — for the established review format
  and for the P-01 publication-link failure mode, which recurs here.

**Repository facts verified directly in this session** (read-only; no asset,
code, configuration, or test touched):

- `apps/web/public` contains exactly two SVG files, both platform marks:
  `assets/platforms/playstation.svg` and `assets/platforms/xbox.svg`. Both
  carry embedded SVG Repo markers.
- No file under `apps/web/src` carries an SVG Repo marker.
- `docs/branding/flags/canada.svg` and `united-states.svg` carry **both** an
  SVG Repo marker **and** `class="iconify iconify--twemoji"`.
- The site's deployed flags are inline JSX paths in
  `apps/web/src/components/player-meta-icons.tsx:2`
  ("Twemoji-style emoji flags (viewBox 0 0 36 36)"), not the `docs/branding`
  files. **Corrected in E2F2A:** those inline paths nevertheless *reproduce the
  same vector artwork* as the two `docs/branding/flags` files. Verified
  mechanically by parsing every `d` attribute in each file into an explicit
  command/argument sequence and comparing: Canada 3 of 3 paths identical, United
  States 4 of 4 paths identical, `fill` values identical in both cases (the only
  differences are whitespace and elided implicit-`l` command letters). The
  deployed JSX carries **no** SVG Repo marker and **no** `iconify--twemoji`
  class marker; the two `docs/branding` source files carry both.
- `apps/web/src/components/ui/archetype-icons.tsx:4` states the deployed
  archetype icons are "Sourced from `docs/branding/icons/archetypes/`", with a
  per-icon `// Source:` comment on each.
- `docs/branding/icons/hockey/` holds six SVGs. **No reference to
  `icons/hockey` exists anywhere in `apps/web/src`.**
- Gate 2 line 150, "Draft an EA/NHL non-affiliation and third-party asset/data
  attribution notice appropriate to the final hosting posture", is `- [ ]` —
  unchecked, and unchanged by this review.

**Measured length** (`wc`): public notice §§1–10 = **150 lines / 1,193 words**;
footer drafting component = **15 lines / 144 words**; internal section =
**124 lines / 1,164 words**. Public per-section word counts: §1 114, §2 122,
§3 222, §4 155, §5 140, §6 91, §7 75, §8 117, §9 104, §10 33.

**Not done, by instruction:** no new external legal or rightsholder research;
no external account, provider, host, or database access; no execution of
`scripts/scrape_ea_xfactor_pngs.sh`; no Terms of Use drafting; no logging
inventory; no Gate 2 checkbox change; nothing staged, committed, pushed,
published, deployed, or tunnelled.

---

## 2. Finding counts

| Class | Count |
| --- | --- |
| BLOCKER | 1 |
| MATERIAL CORRECTION | 9 |
| RECOMMENDATION | 8 |
| ACCEPTABLE AS WRITTEN | 2 |
| **Total** | **20** |

*(Counts corrected in E2F2A: A-02 moved from MATERIAL CORRECTION to
RECOMMENDATION. No finding was added or withdrawn.)*

By destination (a finding may carry more than one label):

| Destination | Findings |
| --- | --- |
| [PUBLIC] | A-01, A-04, A-05, A-06, A-07, A-08, A-09, A-10, A-11, A-12, A-13, A-14, A-15, A-16, A-17, A-19, A-20 |
| [FOOTER] | A-02, A-03 |
| [INTERNAL] | A-01, A-07, A-08, A-11, A-18, A-20 |
| [TERMS] | A-15 |
| [GATE3] | A-02, A-15, A-16 |
| [COUNSEL] | A-04, A-06, A-11, A-14 |

### Index

| ID | Class | Destination | Subject |
| --- | --- | --- | --- |
| A-01 | BLOCKER | [PUBLIC] + [INTERNAL] | Public §6 points readers into the internal risk register |
| A-02 | RECOMMENDATION | [FOOTER] + [GATE3] | Footer drops "or its licensors" and does not carry EA's specified statement |
| A-03 | MATERIAL | [FOOTER] | Footer sweeps factual match data into a property claim |
| A-04 | MATERIAL | [PUBLIC] + [COUNSEL] | EA's bracketed placeholder is published literally |
| A-05 | MATERIAL | [PUBLIC] | "EA does not review, verify, or approve" is unsupported as a categorical claim |
| A-06 | MATERIAL | [PUBLIC] + [COUNSEL] | "EA's own materials cannot grant" is a legal conclusion, not the verified fact |
| A-07 | MATERIAL | [PUBLIC] → [INTERNAL] | Public §8 narrates an internal retention decision and will go stale |
| A-08 | MATERIAL | [PUBLIC] → [INTERNAL] | §7 publishes agent review methodology and breaks the notice's voice |
| A-09 | MATERIAL | [PUBLIC] | §5 attributes site icons to markers the deployed files do not carry |
| A-10 | MATERIAL | [PUBLIC] | One flag family is given two unreconciled descriptions in §5 and §6 |
| A-11 | MATERIAL | [PUBLIC] → [INTERNAL] + [COUNSEL] | Express no-permission/no-fair-use admissions published by default |
| A-12 | RECOMMENDATION | [PUBLIC] | §3 narrates unresolved research and retention voice |
| A-13 | RECOMMENDATION | [PUBLIC] | §4's "we do not know" paragraph is audit voice |
| A-14 | RECOMMENDATION | [PUBLIC] + [COUNSEL] | Three different ownership phrasings; one self-quotes a phrase never used |
| A-15 | RECOMMENDATION | [PUBLIC] + [TERMS] + [GATE3] | §9's Terms pointer publishes "not yet published" |
| A-16 | RECOMMENDATION | [PUBLIC] + [GATE3] | §6 announces work in progress instead of attributing |
| A-17 | RECOMMENDATION | [PUBLIC] | Flat "noncommercial" vs the privacy draft's qualified wording |
| A-18 | RECOMMENDATION | [INTERNAL] | Internal checklist has no cross-reference check |
| A-19 | ACCEPTABLE | [PUBLIC] | SPD tag, confidential expansion withheld; Claude Design placed downstream |
| A-20 | ACCEPTABLE | [PUBLIC] + [INTERNAL] | Contacts, non-affiliation list, data sourcing, blocker list, Gate 2 status |

---

## 3. Findings

### A-01 · BLOCKER · [PUBLIC] + [INTERNAL] — Public §6 points readers into the internal risk register, and the draft's own check 12 does not catch it

**Exact draft passage** (lines 119–121, inside the public notice):

> Rather than publish a guess, we are treating that attribution language as
> unresolved and are continuing to work on it — see "Internal drafting and
> publication checks" below.

**Evidence.** The draft's own internal check 12 (lines 258–263) requires that
"Final public wording must not expose internal research classifications or
drafting narration," and forbids "E2C3," "Gate 2," "NOT ADDRESSED /
AMBIGUOUS," and "references to specific HANDOFF entry names" in the public
text. It is a list of forbidden **terms**. It does not forbid a **structural
cross-reference**, so the one cross-reference in the document passes its own
checklist. Internal check heading (line 186) and lines 188–190 state the
internal section "must be removed, or this entire file must not be published
as-is, before this notice goes live." `docs/planning/privacy-policy-review.md`
finding P-01 logged the same class of defect ("Public links point at a file
that is explicitly unpublishable, and nothing on the checklist catches it").

**Why it matters.** This is not a wording preference. It is the specific
mechanism by which the internal risk register reaches the public: a reader of
the published §6 is told to go read a section that lists, verbatim, the
project's unresolved legal classifications, missing licence records, missing
Sony/Microsoft evidence, and the unread `drop-assets.ea.com/robots.txt`. If
the internal section is deleted at publication as instructed, the sentence
becomes a dangling pointer to nothing; if it is not deleted, the pointer
works. Both outcomes are wrong, and the checklist that is supposed to prevent
this passes the file.

**Proposed resolution (narrow).** Delete the clause `— see "Internal drafting
and publication checks" below` from line 120. Separately, add the missing
checklist item (see A-18). No other change to §6 is required by this finding;
A-16 addresses §6's remaining wording.

**Operator input required?** No. This is a mechanical correction.

---

### A-02 · RECOMMENDATION · [FOOTER] + [GATE3] — If a sitewide footer notice is used, it should carry EA's specified statement rather than a paraphrase that drops "or its licensors"

> **Reclassified in E2F2A.** As first written this finding was a MATERIAL
> CORRECTION resting on the claim that EA requires its statement "wherever EA
> game content is displayed," and therefore that the footer was the only surface
> capable of satisfying the condition. **The reviewed EA text supports neither
> claim.** Both are removed below, and the finding is now a recommendation.

**Exact draft passage** (lines 176–179):

> Boogeymen is an independent, noncommercial fan/community project. It is
> not affiliated with, endorsed by, or sponsored by EA, EA SPORTS, the NHL,
> the NHLPA, PlayStation, Xbox, Sony, Microsoft, or any team, club, or
> player.

**Evidence.** `docs/planning/ea-content-usage-policy-research.md` §7 item 1
records EA's wording verbatim: "If you have a website or other location where
you're displaying our game content, include the following statement: 'This
[project/website] is not endorsed by or affiliated with EA or its licensors.'"
Read precisely, that directs a website or other location displaying EA game
content to include the statement, and it is a **condition** if EA's content
policy is relied on — never permission. **It does not specify page-by-page
placement, does not specify a footer, and does not establish that any one
surface is the only compliant placement.** Where the statement sits within a
site is not addressed; `ea-content-usage-policy-research.md` LR-7 preserves
"where it must appear" as an open question. Separately and independently of
placement: the full notice's §1 (lines 31–33) does carry "or its licensors";
the footer does not.

**Why it matters.** The drop of "or its licensors" is a drafting-fidelity
point, not a compliance failure. That phrase is the half of EA's own wording
that reserves third-party rights, and it is the phrase §4 of the notice depends
on. The draft already contemplates a sitewide footer component; if that footer
is the surface the project chooses to carry the non-affiliation statement, it
should match EA's specified wording rather than paraphrase it, so the two
surfaces do not diverge. Nothing in the reviewed EA text makes the footer
mandatory, and nothing here says the full notice alone would be insufficient —
that is an open question for counsel (Q-C-1). Correcting the wording costs
nothing and preserves the option.

**Proposed resolution (recommended, not required).** If a sitewide footer notice
is used, replace the footer's second sentence with the resolved EA statement
plus the wider non-affiliation list, e.g.: "This website is not endorsed by or
affiliated with EA or its licensors. Boogeymen is also not affiliated with,
endorsed by, or sponsored by the NHL, the NHLPA, PlayStation, Xbox, Sony,
Microsoft, or any team, club, or player." Keep the sentence order so EA's
specified wording is not diluted by being folded into a longer list. See A-04
for resolving the bracket — that one **is** required, and it governs the full
public notice.

**Operator input required?** No, subject to the A-04 bracket choice.

---

### A-03 · MATERIAL CORRECTION · [FOOTER] — The footer sweeps factual match and statistical data into a property claim, contradicting §2

**Exact draft passage** (lines 179–181):

> Some data and imagery originate from EA's NHL game services and
> other third-party sources; all such material remains the property of its
> respective owners.

**Evidence.** The public notice's own §2 (lines 43–46) says "Boogeymen
organizes, compiles, and presents this information independently." E2C4 traced
the crest chain and recorded that the database stores an "opaque ID + flag
only, no image bytes stored"; the match and statistics data is stored, derived,
and in part produced by operator-run OCR (E2C2; data-collection policy draft
lines 49–94). Nothing in E2A, E2C2–E2C5, or E2C3 establishes who owns match or
statistical data, and E2C3 makes no finding on it.

**Why it matters.** "All such material" is a single quantifier applied to a
sentence whose subject is "data **and** imagery." As drafted, the footer tells
every visitor that the site's factual match and statistical data is somebody
else's property. That is a legal conclusion the project has not reached, it is
inconsistent with §2 four sections earlier, and it is the one sentence in the
draft most likely to be read as the project's own position because it appears
on every page. It also weakens the project's own position on its compiled
output for no benefit.

**Proposed resolution (narrow).** Split the sentence so data is
source-attributed and imagery is rights-attributed: "Match and statistics data
shown here originates primarily from EA's NHL game services and from our own
recording and review. Third-party names, marks, and imagery appearing on this
site remain subject to the rights of their respective owners." This also aligns
the footer with the phrasing standardized in A-14.

**Operator input required?** No.

---

### A-04 · MATERIAL CORRECTION · [PUBLIC] + [COUNSEL] — EA's bracketed placeholder is published literally

**Exact draft passage** (lines 31–33):

> Per the condition Electronic Arts specifies in its published content policy
> for fan sites displaying EA game content: **this project/website is not
> endorsed by or affiliated with EA or its licensors.**

**Evidence.** `docs/planning/ea-content-usage-policy-research.md:475-476`
quotes EA's wording as "This **[project/website]** is not endorsed by or
affiliated with EA or its licensors." The square brackets are a fill-in field
in EA's source text, and the research document reproduces them as such.

**Why it matters.** "this project/website" is not a phrase; it is an unresolved
placeholder, and publishing it reads as unedited boilerplate on the one
sentence in the notice whose wording is specified by a third party. The
sentence is also demoted to a colon-clause with a lowercase "this," so the
statement EA specifies never appears as a standalone sentence anywhere in the
public notice. Both are drafting defects, not substantive ones — but they are
on the highest-visibility line in the document.

**Proposed resolution (narrow).** Resolve the bracket to **"This website"** —
the notice is published on the website, §1's surrounding text already says
"this site," and the footer (A-02) attaches to the site. Publish it as its own
sentence: "**This website is not endorsed by or affiliated with EA or its
licensors.**" Retain a short lead-in that preserves the condition/evidence
distinction without asserting reliance, e.g. "Electronic Arts specifies the
following statement as a condition for fan sites that display EA game content;
we state it here. Saying it does not mean EA has given us permission." The
existing lead-in ("Per the condition Electronic Arts specifies…") is
acceptable in substance — it correctly frames the sentence as a condition, per
`ea-content-usage-policy-research.md:473` ("Every one of these is a
**condition on** permission, never evidence **of** it") — but it does not
currently say the second half out loud, and §3 separately disclaims relying on
the policy at all.

**Operator input required?** No for the bracket resolution. The residual
question — whether the notice should invoke EA's condition in §1 while §3
disclaims relying on EA's policy — is preserved as a counsel question (Q-C-1).

---

### A-05 · MATERIAL CORRECTION · [PUBLIC] — "EA does not review, verify, or approve" is a categorical present-tense claim about EA's conduct that no repository or operator evidence establishes

**Exact draft passage** (lines 43–46):

> Boogeymen organizes, compiles, and presents this information independently.
> EA does not review, verify, or approve the calculations, summaries, or
> derived statistics we publish, and this site is not an official EA data
> source.

**Evidence.** E2C2 attestation 3 (X-Factor images) records "**None known** — no
direct EA permission, no creator-program permission, no correspondence, and no
previously reviewed EA content-usage-policy basis"; attestation 6 (opponent
crests) records "**None known** — no direct EA permission, no correspondence,
and no previously documented content-usage-policy basis." Both are
absence-of-knowledge records on the project's side. Nothing in E2A,
E2C2–E2C5, E2C3, or the repository establishes anything about what EA does or
does not do with third-party fan sites. The nearest EA text found in E2C3 is
about UGC — "EA 'does not pre-screen all UGC and does not endorse or approve
any UGC'" (`ea-content-usage-policy-research.md`, §4 item 5) — which is EA
describing its own service, not this site.

**Why it matters.** The project cannot observe EA's internal conduct, and the
notice elsewhere is scrupulous about not asserting facts it has not verified
(§3's crest bullet, §7's authorship framing). This one sentence breaks that
discipline in the opposite direction from every other overstatement in the
draft — it is a claim *about a third party* rather than about the project. The
substantive point the reader needs (this is not official, and Boogeymen is
answerable for it) is better served by a project-side statement, which is both
verifiable and stronger.

**Proposed resolution (narrow).** Replace the second sentence with: "Boogeymen
is solely responsible for the calculations, summaries, and derived statistics
published here. This site is not an official EA data source, and we neither
claim nor know of any EA review, verification, or approval of what we
publish."

**Operator input required?** No.

---

### A-06 · MATERIAL CORRECTION · [PUBLIC] + [COUNSEL] — "EA's own materials cannot grant" states a legal conclusion where a narrower fact is directly attributable to EA

**Exact draft passage** (lines 80–85):

> EA's own materials cannot grant, and do not purport to grant, rights that
> belong to the NHL, the NHLPA, individual teams or clubs, individual players,
> Sony or PlayStation, Microsoft or Xbox, or other third parties.

**Evidence.** The verified EA text, quoted at
`docs/planning/ea-content-usage-policy-research.md` §4, is: "We do not provide
you with any permission to use third-party content from our games. You use our
game content at your own risk." The stronger formulation — "EA cannot and does
not purport to grant rights…" — appears in the research document's own
*analysis* (§4, consequence 1) and in HANDOFF's E2C3 summary, not in EA's
published text. Research analysis is internal characterization; the quotation
is the attributable fact.

**Why it matters.** "Cannot grant" is a conclusion about EA's legal capacity,
asserted publicly by a project that has expressly not obtained legal review
(internal blocker 1) and is instructed not to make legal findings. It is also
unnecessary: the narrower, directly attributable statement carries the same
practical warning to the reader and is verifiable from EA's own page. The
draft's "and do not purport to grant" half is already the correct register; it
is the "cannot" half that overreaches.

**Proposed resolution (narrow).** Attribute the fact to EA and drop the
capacity claim: "EA states that it does not provide permission to use
third-party content from its games. EA's materials therefore do not purport to
grant rights held by the NHL, the NHLPA, individual teams or clubs, individual
players, Sony or PlayStation, Microsoft or Xbox, or other third parties."

**Operator input required?** No. Whether counsel later wants the stronger
formulation restored is preserved as Q-C-2.

---

### A-07 · MATERIAL CORRECTION · [PUBLIC] → [INTERNAL] — Public §8 narrates an internal operator decision, will go stale on any asset change, and adds no attribution value

**Exact draft passage** (lines 135–146, the whole of public §8), including:

> **This notice does not recommend, and
> should not be read as recommending, removing, replacing, relocating,
> deduplicating, recolouring, regenerating, renaming, hiding, or switching any
> of it to a fallback.**

and:

> That every asset above is currently in use, and
> continues to be, is a statement of current fact about this site, not a
> statement that its use has been legally cleared. Retaining an asset is not
> the same thing as having permission to use it.

**Evidence.** This is E2C5 decisions 2–4 restated in public voice: "All
existing assets remain exactly unchanged… **Do not** remove, replace, relocate,
deduplicate, recolour, regenerate, rename, hide, or switch any asset to a
fallback." E2C5's own "Preserved limits" section states the boundary
internally, and the draft's internal check 13 (lines 264–271) already carries
the guardrail for future drafting passes. E2C5 decision 7 records that "the
operator will personally handle the legal implications" of retention.

**Why it matters.** Three separate problems. (1) **Audience.** The
remove/replace/relocate list is addressed to a future internal drafting or
engineering session, not to a visitor; no reader of a public attribution notice
needs to be told that the notice is not recommending deduplication. (2)
**Staleness.** "remains in use exactly as it currently exists" and "That every
asset above is currently in use, and continues to be" become false the moment
any asset changes for any reason — including reasons unrelated to this
decision — and a public legal notice that silently becomes inaccurate is worse
than one that never made the claim. (3) **Content.** "Retaining an asset is not
the same thing as having permission to use it" is a public statement about the
project's own permission posture with no attribution function (see A-11).

This finding does **not** reopen E2C5. E2C5 stays authoritative internally and
no asset changes; the point is only that the public notice does not need to
narrate the decision.

**Proposed resolution (narrow).** Delete public §8 in full and renumber §§9–10.
Move nothing to the public text. E2C5 in `HANDOFF.md` and internal check 13
already hold the record; if the drafting session wants belt-and-braces, add one
sentence to internal check 13 noting that the public notice deliberately does
not narrate the retention decision.

**Operator input required?** Yes, narrowly — see Q-E2F2-1. E2C5 decision 7 puts
the legal posture in the operator's hands, and deleting the public
"retention is not clearance" sentence is a change to what the site says about
that posture. The retention decision itself is untouched either way.

---

### A-08 · MATERIAL CORRECTION · [PUBLIC] → [INTERNAL] — §7 publishes agent review methodology and breaks the notice's own voice

**Exact draft passage** (lines 130–133):

> We have not independently inspected the operator's private original source
> files for this artwork; the statements above describe what our operator has
> told us about that artwork's creation, not the result of an independent
> review.

**Evidence.** E2C2 records exactly this as a *methodology* limit: "operator
authorship attested; private source files cited but **not inspected by any
agent session**." The privacy and data-collection drafts establish the public
voice: "Boogeymen is a community gaming-club project… currently operated by a
single individual on a volunteer basis" (`privacy-policy-draft.md:27-28`).

**Why it matters.** In a notice written in the project's own voice, "what our
operator has told us" has no coherent referent — the operator *is* the
project's single individual, so the sentence describes a project telling itself
something. What it actually records is that no AI drafting session inspected
private files, which is review methodology for the internal file, not public
attribution. A reader gains nothing and is invited to doubt the one
attribution statement in the notice that is entirely within the project's own
knowledge.

**Proposed resolution (narrow).** Delete the paragraph from public §7. Keep
public §7's two bullets exactly as written (they correctly credit the operator
and correctly place Claude Design downstream — see A-19). Add the
not-independently-inspected fact as an internal checklist item, or rely on
E2C2, which already records it. Ensure the public §7 continues to make no
independent-clearance claim; with the paragraph removed it makes no clearance
claim of any kind, which is the desired state.

**Operator input required?** No.

---

### A-09 · MATERIAL CORRECTION · [PUBLIC] — §5 attributes the site's flag and hockey icons to embedded markers the deployed files do not carry, and names an icon family that is not on the site

**Exact draft passage** (lines 101–105):

> - **Other SVG-derived icons.** Other icon assets on this site — including
>   flag, player-archetype, and hockey-related icons — were sourced online and
>   contain generic SVG Repo attribution markers embedded in the files
>   themselves.

**Evidence** (verified this session, read-only):

- `docs/branding/icons/hockey/` holds six SVGs and **no reference to
  `icons/hockey` exists anywhere in `apps/web/src`.** These icons are
  repository material, not "on this site."
- The site's flags are inline JSX paths in
  `apps/web/src/components/player-meta-icons.tsx:2` — "Twemoji-style emoji
  flags (viewBox 0 0 36 36)". Those inline paths **carry no SVG Repo marker and
  no `iconify--twemoji` class marker**; the markers live in
  `docs/branding/flags/canada.svg` and `united-states.svg`, which are not
  themselves deployed. **Corrected in E2F2A:** the deployed inline flags do
  nonetheless reproduce the same vector path data as those two files
  (mechanically verified — see §1), so repository evidence *does* link them.
  What is missing from the deployed JSX is the metadata, not the derivation.
- Archetype icons *are* deployed and *are* traceable:
  `apps/web/src/components/ui/archetype-icons.tsx:4` says "Sourced from
  `docs/branding/icons/archetypes/`" with a per-icon `// Source:` comment, and
  E2C2 counts 15 SVG Repo markers in that directory. But the deployed form is
  inline paths, which carry no markers.
- Only `apps/web/public/assets/platforms/{playstation,xbox}.svg` are files on
  the site that literally contain the markers — and those are covered by §5's
  *first* bullet, not this one. E2C2's count is "**29 repository SVG files
  total**", explicitly a repository count.

**Why it matters.** The sentence makes a checkable claim about the site's own
files that a reader could test and find false, in the one section whose entire
purpose is accurate sourcing. It also over-claims scope (hockey icons) and
under-explains the archetype chain (derived-from, not marker-carrying), which
is the part actually supported by evidence.

**Proposed resolution (narrow).** Replace the bullet with what the repository
supports: "**Other icons.** Our player-archetype icons were drawn from SVG
files obtained through SVG Repo and are reproduced on this site as inline
vector paths. Other icons used in this project's design work were obtained the
same way." Drop "hockey-related" from the public text unless a hockey icon is
later shipped, and drop the claim that the site's files carry embedded
markers. Handle the flags per A-10.

**Operator input required?** No. This is a factual correction against verified
repository state.

---

### A-10 · MATERIAL CORRECTION · [PUBLIC] — One flag family is given two unreconciled descriptions in §5 and §6, and the notice never reconciles them

> **Evidence corrected in E2F2A.** As first written this finding asserted that
> "no repository evidence links the deployed inline flags" to the two local SVG
> files. **That was false** — the path data is identical. The finding **remains a
> MATERIAL CORRECTION**, because the defect it identifies is unchanged: the
> public notice still gives one flag family two unreconciled descriptions. The
> evidence and the proposed public wording are corrected below.

**Exact draft passages.** §5 (lines 101–103): "Other icon assets on this site —
including **flag**, player-archetype, and hockey-related icons — were sourced
online and contain generic SVG Repo attribution markers…" §6 (lines 114–116):
"This site also uses other third-party visual and typographic elements,
including **flag icons in a Twemoji-derived visual style**…"

**Evidence.** There is **one** flag family, and repository path-data identity
links its two halves. The deployed inline flags in
`apps/web/src/components/player-meta-icons.tsx` reproduce the same vector path
data as `docs/branding/flags/canada.svg` and
`docs/branding/flags/united-states.svg` — verified mechanically this session by
parsing every `d` attribute into an explicit command/argument sequence and
comparing (Canada 3 of 3 paths identical, United States 4 of 4 identical,
`fill` values identical; the only differences are whitespace and elided
implicit-`l` command letters). The two local SVG files carry **both** an SVG
Repo generator/source marker and `class="iconify iconify--twemoji"` — consistent
with E2C2, which lists the same two files under *both* the "SVG Repo-derived
flags" family and the "Twemoji-style flag SVGs" family. **The deployed JSX does
not itself retain the metadata comments or the class marker.** What remains
unresolved is upstream of the local files: the original upstream source, the
exact source-page URL, whether these are genuine Twemoji assets, and which
licence and version apply — E2C2 records "whether they are genuine Twemoji
assets and which licence version applies is **unverified**." The draft's own
internal table (lines 283–284) lists flags under §5 *and* under §6 without
noting they are the same family.

**Why it matters.** A public attribution notice that describes one asset family
two different ways in consecutive sections is not attributing; it is
reproducing the project's internal uncertainty as if it were two facts. A
reader cannot tell whether there are two flag families or one, and neither
section says the upstream origin is unsettled. The two descriptions are not
evidence of two origins — the repository shows a single family whose local
source files carry two markers.

**Proposed resolution (narrow).** Attribute the flags once, in one place, and
state the actual position: "**The country flags rendered by the site reproduce
vector artwork from the project's local Canada and United States SVG source
files. Those local files carry both SVG Repo and Twemoji-style metadata; the
original upstream source and applicable licence have not been established.**"
Remove "flag" from §5's list. Do not name a Twemoji licence or version — E2C2
records both as unverified and the draft is correct not to guess (see A-16).
This wording asserts no upstream licence, permission, or clearance.

**Operator input required?** No.

---

### A-11 · MATERIAL CORRECTION · [PUBLIC] → [INTERNAL] + [COUNSEL] — Express no-permission, no-licence, and no-fair-use admissions are published by default, with no attribution function

**Exact draft passages.**

§3 (lines 72–76):

> **This notice does not claim that any EA policy, help-content page, or
> fan-content guidance legally clears our copying, caching, transforming,
> rehosting, or displaying of any specific asset described above.** We do not
> state or imply that we have permission, a licence, fair use, authorization,
> or legal clearance for any EA-sourced visual material on this site.

§5 (lines 97–100 and 107–110):

> We do not hold, or
> separately retain, any Sony or Microsoft permission, licence, or
> brand-guideline evidence for these marks.

> We do not claim that any of the assets described in this section are
> licensed, in the public domain, legally cleared, or used with permission.
> This section states what we know about where these files came from, not a
> conclusion about their legal status.

Plus §5's "We have not retained the exact per-asset source-page URLs or
per-asset licence records for these files" (lines 104–105).

**Evidence.** Each of these restates an internal audit fact already recorded and
already carried by the draft's own internal blockers: blocker 2 (no family
cleared), blocker 3 (EA policy ambiguous), blocker 6 (SVG Repo source pages and
licence records missing, E2C2), blocker 7 (no Sony/Microsoft evidence, E2C2
item 5). E2C2's framing of these is explicitly a *verification-status* record:
"These describe verification status only."

**Why it matters — and where the line falls.** The test applied here is whether
a fact helps a public reader understand attribution or non-affiliation. Applied
item by item:

- **Naming SVG Repo as the source of the platform marks and the archetype
  icons: keep public.** That is attribution in the ordinary sense, it is the
  most specific true statement the project can make, and a source-site
  attribution may itself be a condition of the (unverified) licence.
- **Naming the third parties whose marks appear, and saying those marks remain
  subject to their owners' rights: keep public.** That is a genuinely needed
  public attribution and A-14 standardizes its wording.
- **"We do not hold any Sony or Microsoft permission… evidence": internal.**
  This is an inventory statement about the project's evidence file. It tells a
  reader nothing about who owns the marks or where the files came from.
- **"We have not retained the exact per-asset source-page URLs or licence
  records": internal.** Same. It is E2C2's open work item, published.
- **"We do not claim… licensed, public domain, legally cleared, or used with
  permission" and §3's equivalent: internal.** These are the project's legal
  posture, not attribution. Publishing them converts a notice into a standing
  admission on the highest-risk asset families, on a site whose operator has
  taken personal responsibility for exactly that question (E2C5 decision 7) and
  where counsel has not yet been engaged (internal blocker 1).

The distinction the notice should hold is: **say where things came from; do not
publish the audit's conclusions about what the project lacks.** Nothing here
proposes hiding a source. Every source named in §§3, 5, 6 stays named.

**Proposed resolution (narrow).** Move the four passages listed above into the
internal section, where blockers 2, 3, 6, and 7 already state them. Keep §5's
first-bullet SVG Repo attribution and §3's factual sourcing sentences. Retain
one short, non-admissive public sentence covering the point a reader actually
needs — that attribution is not permission — for which §4's existing closing
clause already suffices: "nothing in this notice should be read as claiming
that providing this attribution, by itself, creates or establishes permission
to use any such content."

**Operator input required?** Yes — see Q-E2F2-1. This is a change to what the site
publicly says about its own permission posture, and E2C5 decision 7 assigns
that to the operator. Also preserved as Q-C-3 for counsel.

---

### A-12 · RECOMMENDATION · [PUBLIC] — §3 narrates unresolved research and carries retention voice; the reader-useful attribution is shorter

**Exact draft passage** (lines 63–70):

> - **Base versus custom crests.** Opposing clubs' crests fall into two
>   families EA's own data distinguishes — a "base" crest family and a
>   "custom" crest family. **The factual ownership and origin of the custom
>   crest family — specifically, whether a given custom crest is content a
>   club's own players selected or contributed, or content EA otherwise
>   supplies or renders — has not been established and is not stated here
>   either way.** We do not describe custom crests categorically as
>   user-generated content or as EA-created content.

Also line 59: X-Factor icons "are **retained as part of this project**."

**Assessment.** The substance is right and must be preserved: E2C3 §6.3 records
"CONDITIONAL / FACTUAL NATURE UNRESOLVED", and internal blocker 5 instructs
"Do not resolve this by guessing in a future drafting pass — carry the
unresolved framing forward." The draft obeys that instruction. But the final
sentence ("We do not describe custom crests categorically as…") is drafting
procedure — it describes the choice the drafter made rather than stating a
fact — and the bolded middle clause reads as an internal research abstract.
"Retained as part of this project" is E2C5 retention vocabulary where the
plain fact is that the images are stored and served by this site.

**Proposed resolution.** Compress without resolving anything: "**Opponent
crests.** Crests shown for opposing clubs are retrieved from EA's media
services using identifiers EA returns for each club. EA's data distinguishes a
standard crest family from a club-specific one. We do not state here who
created or owns any particular crest." Change line 59's "are retained as part
of this project" to "are stored and served by this site." Approximate saving:
70 words, with the unresolved framing intact.

---

### A-13 · RECOMMENDATION · [PUBLIC] — §4's "we do not know" paragraph is audit voice

**Exact draft passage** (lines 87–93):

> We do not know, and do not state here, the exact scope of any trademark
> registration or the exact ownership chain for any specific third-party mark
> or asset shown on or through this site.

**Assessment.** The instruction behind this — do not invent an ownership chain
(E2C3 §4 item 2: EA "does not publish a list", so per-asset third-party
exposure is "unresolved") — is correct and should be preserved. The execution
publishes the project's ignorance where a neutral statement would do the same
work. The remainder of the paragraph (attribution is not permission) is good and
should stay.

**Proposed resolution.** Replace with: "This notice does not identify the
specific owner of any individual third-party mark or asset, and does not state
the scope of any trademark right." Then keep the existing closing clause about
attribution not creating permission. Saving: roughly 40 words.

---

### A-14 · RECOMMENDATION · [PUBLIC] + [COUNSEL] — Three ownership phrasings, one of which self-quotes a phrase the notice never uses

**The three variants:**

| Location | Wording | Assessment |
| --- | --- | --- |
| §4 line 85, §9 lines 153–154 | "remain subject to the rights of their respective owners" | **Best.** Does not assert that ownership exists, does not describe its shape, does not treat attribution as permission. |
| §4 lines 90–91 | "Nothing in this notice should be read as asserting a specific ownership claim beyond 'belongs to its respective owner(s)'" | **Weakest of the three.** Asserts, item by item, that each thing *belongs* to someone — and it does so inside a sentence disclaiming ownership claims. It also quotes a phrase in quotation marks that appears nowhere else in the notice. |
| Footer line 180 | "all such material remains the property of its respective owners" | **Worst.** "Property" is the strongest of the three, and "all such material" extends it to factual data — see A-03. |

**Proposed resolution.** Standardize on "subject to the rights of their
respective owners" in all three places. In §4, drop the quotation marks and the
quoted phrase, leaving: "Nothing in this notice asserts a specific ownership
claim, and nothing in it should be read as claiming that providing this
attribution, by itself, creates or establishes permission to use any such
content." In §9, drop the trailing "whatever those rights turn out to be" — it
adds hedging without adding meaning. In the footer, apply A-03.

Whether counsel prefers a different standard formula is preserved as Q-C-4.

---

### A-15 · RECOMMENDATION · [PUBLIC] + [TERMS] + [GATE3] — §9 correctly defers to Terms, but publishes "which is not yet published"

**Exact draft passage** (lines 155–157):

> Detailed rules about how visitors may or may not use content on
> this site are addressed by our Terms of Use, which is not yet published —
> [PLACEHOLDER — Terms of Use link/route, not yet decided].

**Assessment of §9 overall — this is the section that gets the boundary right.**
It grants nothing, invents no ownership, and does **not** duplicate E2A
decision 4 (personal/noncommercial viewing and normal search-engine indexing
permitted; disruptive bulk scraping, dataset republication, and commercial
reuse require permission). That boundary belongs in Terms, and §9 correctly
leaves it there. The concise boundary that belongs *here* is exactly the two
things §9 already says: this notice grants you nothing, and third-party
material stays with its rights holders. Nothing should be added.

**The defect is the sequencing sentence.** Terms of Use is one of the four Gate
2 drafts (`HANDOFF.md:152`, unchecked) and is expected to be published
alongside the other policies at Gate 3 (`HANDOFF.md` E2 section: a global
footer linking "privacy, data-collection, Terms of Use, and attribution/
non-affiliation pages"). Publishing an attribution notice that tells visitors
the Terms of Use does not exist yet is a statement that should be false by the
time anything is published.

**Proposed resolution.** At the drafting stage, keep the placeholder but change
the surrounding prose so it does not hard-code the pre-publication state:
"Detailed rules about how visitors may use content on this site are set out in
our Terms of Use — [PLACEHOLDER — Terms of Use link/route]." Add an internal
check: if Terms of Use is not published at the same time as this notice, delete
the sentence rather than publish "not yet published." The route decision itself
is already tracked as Q-E2E2-1 and internal blocker 9; this review does not
duplicate it.

---

### A-16 · RECOMMENDATION · [PUBLIC] + [GATE3] — §6 announces work in progress where it should attribute what is known

**Exact draft passage** (lines 116–121):

> We are not in a position to state, with confidence
> sufficient for public attribution, the exact source pages, licence texts, or
> licence versions that apply to these specific elements. Rather than publish a
> guess, we are treating that attribution language as unresolved and are
> continuing to work on it — see "Internal drafting and publication checks"
> below.

**Assessment.** The underlying discipline is correct and matches internal
blocker 8 and E2C2: "Do not invent a source page, a licence name, or a licence
version for either family." Not guessing is the right call and this review does
not ask for a guess. But the section currently publishes a status report on the
project's own drafting instead of the attribution it does have. The known,
publishable facts are: the flags reproduce the project's local Canada and
United States SVG source files, which carry both SVG Repo and Twemoji-style
metadata, with the upstream source and licence unestablished (A-10); the fonts
are Barlow and Barlow Semi Condensed, self-hosted at build time rather than
fetched from Google by the visitor's browser (already stated publicly in
`data-collection-policy-draft.md` lines 268–271).

**Proposed resolution.** State what is known and stop there: "This site also
uses the Barlow and Barlow Semi Condensed typefaces, which are downloaded and
self-hosted as part of our build process, and country flags in a
Twemoji-derived visual style. We have not confirmed the applicable licence
terms for these elements, and we do not state them here." Delete the internal
cross-reference (A-01, the blocker). Completing the actual source/licence
verification, and adding the resulting attribution, remains Gate 3
prerequisite work tracked by internal blocker 8 — not something this notice
should narrate.

---

### A-17 · RECOMMENDATION · [PUBLIC] — Flat "noncommercial" against the privacy draft's qualified wording

**Exact draft passage** (lines 22–23): "Boogeymen is an independent,
individually operated, **noncommercial** community gaming-club and fan project…"

**Assessment.** Supported: E2C5 decision 1 records "No monetization currently or
planned for launch," resolving E2C3/E2C4's U10. But
`privacy-policy-draft.md:33-35` publishes it with a temporal qualifier: "There
is no advertising, monetization, or other commercial activity on this site now,
and none is planned. If that changes, we intend to carry out a fresh privacy
review before any commercial activity begins." E2C3 §7 condition 4 makes the
commercial/noncommercial state load-bearing if EA's policy is ever relied on.
A flat adjective in one document and a qualified sentence in another is a
drift risk, not an error today.

**Proposed resolution.** Keep "noncommercial" in §1 and add one sentence
matching the privacy draft: "There is no advertising, monetization, or other
commercial activity on this site now, and none is planned."

---

### A-18 · RECOMMENDATION · [INTERNAL] — The internal checklist has no cross-reference check, which is why A-01 passed it

**Assessment.** Internal check 12 (lines 258–263) enumerates forbidden *terms*.
A-01 is a forbidden *structure*, and it survives the checklist unflagged. The
same class of defect was already recorded once in this project, at
`docs/planning/privacy-policy-review.md` P-01.

**Proposed resolution.** Add one item to the internal checks: "**No public
section may cross-reference the internal section, or any unpublished planning
document.** Before publication, search the public text for 'below', 'above',
'see', and any internal section title, and confirm every surviving
cross-reference resolves inside the published text." Optionally, note in
internal check 12 that the term list is not exhaustive.

---

### A-19 · ACCEPTABLE AS WRITTEN · [PUBLIC] — Operator-created material is credited correctly, and the confidential expansion is not published

**Passage** (lines 125–128):

> - **BGM/SPD logo artwork** is original artwork created by our operator.
> - **Rink and event-marker artwork** was created from scratch by our
>   operator and later incorporated into the site's design with the
>   assistance of Claude Design.

**Assessment.** Both bullets match E2C2 attestations 1 and 2 precisely. The
"SPD" tag is named; its expansion — which E2C2 marks confidential and says
"**must not be published** in any draft, page, or commit" — is not. Claude
Design is placed downstream of the operator's original work, which is exactly
what E2C2 requires ("Claude Design is therefore **not** the original source of
this artwork and must not be described as such"). No independent-clearance
claim is made. With A-08's methodology paragraph removed, public §7 is correct
and complete as it stands.

---

### A-20 · ACCEPTABLE AS WRITTEN · [PUBLIC] + [INTERNAL] — Contacts, the non-affiliation list, data sourcing, the internal blocker list, and Gate 2 status

**Assessment.**

- **§10 contacts** (lines 159–164) use `webmaster@boogeymen.app` for
  attribution/correction/rights-holder inquiries and `security@boogeymen.app`
  for vulnerability reports, matching E2A decision 13 exactly.
  `alerts@boogeymen.app` is correctly absent. Consistent with
  `privacy-policy-draft.md:172,196` and
  `data-collection-policy-draft.md:425-426`.
- **§1's non-affiliation list** (lines 25–29) matches the drafts' identity
  wording and E2A decision 1's "Boogeymen — a community gaming club."
- **§2's data sourcing** (lines 37–41) — EA's NHL game services plus
  operator-run OCR and manual review of recordings and screenshots — matches
  `data-collection-policy-draft.md:132-138` and E2C2. §2's error/correction
  invitation is a useful public statement and duplicates nothing improperly.
- **Internal blockers 1–13** accurately reproduce E2C2, E2C3, E2C4, and E2C5:
  the three classification strings are verbatim, the "29 repository SVG files"
  count matches E2C2, and blockers 5 and 8 correctly carry forward the
  do-not-guess instructions. Blocker 4's warning ("Do not treat the absence of
  a visible team/player mark on a given asset as evidence that it carries no
  third-party rights") matches E2C3 §4 item 3.
- **Gate 2 status** (lines 301–309): "Not checked." Verified — `HANDOFF.md:150`
  is `- [ ]` and is unchanged by this review.
- The document-level status banner (lines 3–11) is correctly placed above the
  public notice and does not need to move.

---

## 4. The twelve review questions, answered directly

**4.1 Public notice versus internal risk record (Q1).** Six public passages are
internal risk record: §3's closing no-clearance paragraph (A-11); §5's
"no Sony or Microsoft… evidence" and "we have not retained the exact per-asset
source-page URLs" and closing no-claim paragraph (A-11); §6's "not in a
position to state… continuing to work on it" (A-01, A-16); §7's
not-independently-inspected paragraph (A-08); and all of §8 (A-07). §4's "we do
not know… ownership chain" is a milder case (A-13). What genuinely helps a
public reader: who the project is and who it is not affiliated with (§1); where
the data comes from and who is answerable for it (§2); which visual material
comes from EA and from which kind of source (§3, trimmed); that third-party
names and marks are not the project's and remain with their rights holders
(§4); that platform marks and other icons came through SVG Repo (§5, first
bullet); which typefaces and flag style are used (§6, trimmed); that the logo
and rink artwork are the operator's own (§7, trimmed); that the notice grants
visitors nothing (§9); and how to reach the project (§10).

**4.2 EA disclaimer wording (Q2).** See A-04. Publishing "this project/website"
literally is not appropriate; resolve it to "**This website**" and publish it
as a standalone sentence. The condition-not-evidence framing must survive the
edit, and the current lead-in does most of that work already — but the
"saying it is not evidence of permission" half should be said out loud, and
the tension with §3 is preserved as Q-C-1.

**4.3 EA verification statement (Q3).** See A-05. Repository and operator
evidence establishes only the project's own absence of knowledge (E2C2
attestations 3 and 6). It does not establish what EA does. Restate as a
project-side responsibility statement plus "we neither claim nor know of any EA
review, verification, or approval."

**4.4 Third-party-rights statement (Q4).** See A-06. "Cannot grant" is an
unnecessary legal conclusion. The verified source says EA "does not provide you
with any permission to use third-party content from our games" — attribute that
narrower fact to EA directly and keep the "do not purport to grant" half.

**4.5 Generic ownership language (Q5).** See A-14. "Subject to the rights of
their respective owners" is the wording that avoids all three failure modes.
"Belongs to its respective owners" invents an ownership chain by asserting
ownership item by item. "Property of their respective owners" does the same and,
in the footer, extends it to factual data (A-03). None of the three treats
attribution as permission on its own, but only the §4/§9 formulation is safe to
standardize on — and §4 already carries the explicit "attribution is not
permission" sentence that keeps it that way.

**4.6 Public licence admissions (Q6).** See A-11 for the item-by-item split.
Short answer: a useful public attribution notice should **not** enumerate that
no Sony/Microsoft permission is retained, that SVG Repo licence records are
missing, or that no EA permission/fair-use/clearance claim is made. It
**should** keep naming SVG Repo as the source, name the third parties whose
marks appear, and say those marks remain subject to their owners' rights. The
Twemoji/Barlow uncertainty is the one genuine borderline case: the draft is
right not to guess, but the public form should state what is known and stop,
rather than publish a status report (A-16).

**4.7 Operator-created material (Q7).** See A-08 and A-19. The public notice
does not need to say an agent did not inspect private source files. Everything
that must be preserved — operator-created BGM/SPD branding, operator-created
rink/event-marker artwork, Claude Design as downstream, the confidential SPD
expansion unpublished, and no independent-clearance claim — survives the
deletion. With the paragraph gone, §7 makes no clearance claim at all, which is
the intended posture.

**4.8 Asset-retention section (Q8).** See A-07. Public §8 does not belong in a
public legal notice. It restates an internal operator decision, is addressed to
future internal sessions, will become stale on any asset change for any reason,
and contains a public admission with no attribution value. E2C5 remains
authoritative internally and no asset changes; internal check 13 already holds
the guardrail. This is the single largest available public-length reduction
(117 words) and the one with the least attribution cost.

**4.9 Visitor-reuse section (Q9).** See A-15. §9 is the draft's best-behaved
section on this axis: it grants nothing, invents no ownership, and does not
pre-empt Terms of Use. The concise boundary that belongs here is what it
already says — no rights granted, third-party material stays with its rights
holders — and nothing more. E2A decision 4's reuse rules (personal/noncommercial
viewing and normal indexing permitted; disruptive bulk scraping, dataset
republication, and commercial reuse require permission) belong in Terms. The
only fix needed is the "not yet published" sequencing sentence.

**4.10 Footer notice (Q10).** Assessed against the six criteria:

| Criterion | Verdict |
| --- | --- |
| Accurately describes the site | Yes — "independent, noncommercial fan/community project" matches E2A decision 1 and E2C5 decision 1. |
| Uses the appropriate EA disclaimer wording | **Not as drafted** — it drops "or its licensors" and paraphrases the statement EA specifies. Recommended, not required: if the footer is used to carry the statement, match EA's wording (A-02). EA's text does not itself dictate which surface carries it. |
| Avoids claiming ownership of factual data | **No** — "all such material remains the property of its respective owners" covers "data and imagery" (A-03). |
| Avoids implying every listed third party owns every referenced item | Marginal — the non-affiliation list is fine, but "its respective owners" trailing an eight-party list invites exactly that reading; A-03's split fixes it. |
| Remains useful and short | Yes — 144 words is appropriate for a sitewide footer, and A-03's required correction plus A-02's recommended polish add roughly 15. |
| Clearly requires a future full-notice route without inventing one | Yes — "[PLACEHOLDER — link to the published version of this page]" invents nothing, and internal blocker 10 tracks the dependency. |

**4.11 Scope and conciseness (Q11).** Public 150 lines / 1,193 words; footer 15
lines / 144 words; internal 124 lines / 1,164 words. The 309-line document is
**structurally divided correctly** — `---` separators, an explicit "not part of
the public notice" heading, and an explicit removal instruction — but the
division is only as strong as the checklist enforcing it, and A-01 shows one
live leak the checklist does not catch. The public half is materially
shortenable without concealing any source attribution: deleting §8 (117 words),
compressing §3's crest bullet (~70), trimming §4 (~40 via A-13, plus A-14's
quotation), condensing §5's admissions (~55 via A-11), and rewriting §6 (~35)
brings the public notice to roughly **800 words** while every source named in
the current draft stays named and every unresolved rights question stays
unresolved — it moves to the internal section rather than disappearing. §§1, 2,
9, and 10 need no shortening.

**4.12 Cross-document consistency (Q12).**

| Item | Attribution draft | Other authority | Verdict |
| --- | --- | --- | --- |
| Project identity | "independent, individually operated, noncommercial community gaming-club and fan project" (§1) | E2A decision 1 "Boogeymen — a community gaming club"; `privacy-policy-draft.md:27-28`; `data-collection-policy-draft.md:17` | Consistent. "fan project" is an added self-description, benign but note it aligns the project with EA's fan-site category while §3 disclaims relying on that policy — folded into Q-C-1. |
| Noncommercial posture | Flat adjective (§1) | E2C5 decision 1; `privacy-policy-draft.md:33-35` qualified wording | Consistent in substance; A-17 recommends matching the qualifier. |
| Contact addresses | `webmaster@`, `security@` (§2, §10) | E2A decision 13; both other drafts | Consistent. `alerts@` correctly absent. |
| Source descriptions | EA game services + operator OCR/manual review (§2) | `data-collection-policy-draft.md:132-138`; E2C2 | Consistent. |
| Non-affiliation statement | §1 and footer | `data-collection-policy-draft.md:143-147` ("not affiliated with, endorsed by, or sponsored by Electronic Arts, EA Sports, the NHL, the NHLPA"); `:260-262` ("EA does not endorse, and is not affiliated with, this project") | Consistent in substance. Note the DCP makes the same class of third-party-conduct assertion flagged in A-05, in milder form; **out of scope for this review and not proposed for change here.** |
| Opponent-crest uncertainty | §3 leaves base/custom factual nature unresolved | E2C3 §6.3 `CONDITIONAL / FACTUAL NATURE UNRESOLVED`; internal blocker 5 | Consistent, and correctly non-committal. A-12 shortens without resolving. |
| Asset-retention boundary | §8 states retention ≠ clearance | E2C5 decisions 2–7 and "Preserved limits" | Consistent, and A-07 does not change the boundary — only where it is recorded. |
| Font handling | §6 names Barlow / Barlow Semi Condensed | `data-collection-policy-draft.md:268-271` (self-hosted at build, not fetched by the browser) | Consistent; A-16 recommends the attribution notice state the self-hosting fact too. |

No cross-document contradiction was found. The one drift risk is A-17.

---

## 5. Overall verdict

**NOT ACCEPTED as a drafting checkpoint in its current form.** (Verdict
unchanged by E2F2A. The corrected finding counts are **1 BLOCKER, 9 MATERIAL
CORRECTIONS, 8 RECOMMENDATIONS, 2 ACCEPTABLE AS WRITTEN — 20 total** — and
**10** corrections are required before acceptance: A-01 and A-03 through A-11.
A-01 remains the blocker on its own.)

The draft is substantively sound in the places that matter most and are hardest
to get right: it does not resolve the base/custom crest question by guessing, it
does not invent a Twemoji or Barlow licence, it does not describe Claude Design
as the source of the operator's artwork, it does not publish the confidential
SPD expansion, it does not check a Gate 2 checkbox, and it does not treat E2C5's
retention decision as clearance. The internal blocker list is an accurate,
complete reproduction of E2C2–E2C5. Those are the failure modes the E2A/E2C
rules were written to prevent, and the draft avoids all of them.

The defect is one of **register and boundary, not of fact**. Roughly a third of
the public notice is the project's internal audit file written in public voice:
what evidence is missing, what has not been verified, what the drafter chose not
to say, what the notice is not recommending, and what an agent did not inspect.
That material is already recorded — correctly and in more detail — in the
internal section and in `HANDOFF.md`. Publishing it a second time in the public
notice adds nothing a reader can use and, in §3, §5, and §8, publishes the
project's permission posture as a standing public statement on a site whose
counsel review has not begun.

Three claims are also stated more strongly than the evidence supports — "EA does
not review, verify, or approve" (about a third party the project cannot
observe), "EA's own materials cannot grant" (a legal conclusion where a
quotation would do), and §5's attribution of embedded SVG Repo markers to files
on the site that do not carry them. And one structural defect, A-01, is a live
route from the public text into the internal risk register that the draft's own
checklist cannot catch.

Separately, the flag family is described two different ways in consecutive
sections (A-10). That is a reconciliation defect, not evidence of two origins:
the deployed inline flags reproduce the project's own local Canada and United
States SVG source files, and those local files carry both markers. What is
genuinely unresolved sits upstream of the repository — the original source, the
exact source page, genuine Twemoji status, and the applicable licence and
version. The corrected public wording states the derivation and stops there; it
asserts no upstream licence or permission.

None of this requires reopening any decision. Every correction below is a
deletion, a move to the internal section, or a narrowing of an overstatement.
No asset changes, no classification changes, no route is decided, and E2C5
stands exactly as recorded.

---

## 6. Exact corrections required before the drafting checkpoint can be accepted

**Ten corrections are required: A-01 and A-03 through A-11.** *(Corrected in
E2F2A — A-02 was previously listed here as item 2 and is now a recommendation;
see §7.)*

1. **A-01** — Delete `— see "Internal drafting and publication checks" below`
   from public §6 (line 120).
2. **A-03** — Split the footer's data/imagery sentence so factual match and
   statistics data is source-attributed, not property-attributed.
3. **A-04** — Resolve "this project/website" to "This website" and publish the
   statement as a standalone sentence in §1.
4. **A-05** — Replace "EA does not review, verify, or approve…" with a
   project-side responsibility statement plus "we neither claim nor know of any
   EA review, verification, or approval."
5. **A-06** — Replace "EA's own materials cannot grant" with the attributable
   EA fact ("EA states that it does not provide permission to use third-party
   content from its games"), keeping "do not purport to grant."
6. **A-07** — Delete public §8 in full and renumber §§9–10. *(Operator
   confirmation: Q-E2F2-1.)*
7. **A-08** — Delete the not-independently-inspected paragraph from public §7.
8. **A-09** — Correct §5's "other SVG-derived icons" bullet: drop
   "hockey-related," drop the claim that the site's files carry embedded
   markers, and describe the archetype icons as reproduced inline from SVG
   Repo-sourced files.
9. **A-10** — Attribute the flags once, in §6 only, using the wording in A-10:
   "The country flags rendered by the site reproduce vector artwork from the
   project's local Canada and United States SVG source files. Those local files
   carry both SVG Repo and Twemoji-style metadata; the original upstream source
   and applicable licence have not been established." Remove "flag" from §5.
10. **A-11** — Move §3's closing no-clearance paragraph and §5's three
    missing-evidence/no-claim passages into the internal section. Keep every
    source attribution. *(Operator confirmation: Q-E2F2-1.)*

Items 6 and 10 (A-07 and A-11) are the only two that need the operator's word
before they are applied; **the other eight — A-01, A-03, A-04, A-05, A-06,
A-08, A-09, A-10 — are mechanical and can be applied in one pass.**

---

## 7. Optional improvements

- **A-02** *(reclassified here in E2F2A)* — Recommended footer polish. EA's
  reviewed text does not dictate placement, so this is not required; but if a
  sitewide footer notice is used, matching EA's specified statement — including
  "or its licensors" — is the safer and more consistent drafting choice, and it
  keeps the footer and the full notice from diverging.
- **A-12** — Compress §3's crest bullet and change "retained as part of this
  project" to "stored and served by this site."
- **A-13** — Replace §4's "we do not know… ownership chain" with a neutral
  statement.
- **A-14** — Standardize on "subject to the rights of their respective owners";
  drop the §4 self-quotation and §9's "whatever those rights turn out to be."
- **A-15** — Reword §9's Terms pointer so it does not hard-code
  "not yet published," and add an internal check for the publication-order
  dependency.
- **A-16** — Rewrite §6 to state what is known (Barlow / Barlow Semi Condensed,
  self-hosted at build; the flag derivation per A-10's corrected wording) and
  stop.
- **A-17** — Add the privacy draft's "now, and none is planned" qualifier to
  §1's noncommercial statement.
- **A-18** — Add a cross-reference check to the internal checklist.
- **Optional, not recommended either way:** §3 could note that opponent crests
  are fetched and served through this site rather than loaded directly by the
  visitor's browser (E2C2's correction; E2C4's chain trace). It is accurate and
  mildly informative for attribution, but it is primarily a data-flow fact and
  the Data Collection Policy is its natural home.

---

## 8. Questions requiring operator input

**Q-E2F2-1 — Should the public notice keep its express no-permission /
no-clearance / no-evidence statements, or move them to the internal section?**
This covers A-07 (public §8's "Retaining an asset is not the same thing as
having permission to use it") and A-11 (§3's "We do not state or imply that we
have permission, a licence, fair use, authorization, or legal clearance…";
§5's "We do not hold… any Sony or Microsoft permission… evidence", "We have not
retained the exact per-asset source-page URLs or per-asset licence records", and
"We do not claim that any of the assets described in this section are licensed,
in the public domain, legally cleared, or used with permission").

This review recommends moving all of them internal, because none of them helps a
reader understand attribution or non-affiliation and all of them are already
recorded in the internal blockers and in `HANDOFF.md`. But E2C5 decision 7
records that **the operator will personally handle the legal implications** of
the retention decision, and what the site publicly says about its own permission
posture is part of that. The operator's answer is genuinely required before
these two items are applied. **Nothing about asset retention changes either
way**, and every source attribution stays public either way.

No other operator question is raised. **Q-E2F2-1 remains unanswered as of E2F2A
and no answer to it is recorded anywhere in the repository.** The route
decisions (this notice's public route, and the Terms of Use link) are already
tracked as internal blocker 9 and HANDOFF's Q-E2E2-1 and are not re-asked here.
The A-04 bracket resolution, the A-17 qualifier, and every other item above are
drafting decisions this review resolves on existing authority. **A-02 is not an
operator question either** — after its E2F2A reclassification it is recommended
footer polish, and whether a sitewide footer is used at all is a Gate 3
implementation decision, not a condition EA's reviewed text imposes.

---

## 9. Questions remaining exclusively for counsel — preserved as unresolved

**Q-C-1.** Should the notice invoke EA's specified non-affiliation statement in
§1 (framed as a condition) while §3 simultaneously disclaims relying on EA's
content policy? Stating a condition without asserting the permission is
internally coherent, but the two sections currently read in opposite
directions, and §1's "fan project" self-description leans toward the policy's
fan-site category. Related, and **corrected in E2F2A**: whether the statement
should appear sitewide (the footer) as well as in the full notice. EA's reviewed
text directs a website or other location displaying EA game content to include
the statement; it does **not** specify page-by-page placement, does not specify
a footer, and does not make any one surface the only compliant placement.
Whether a single full-notice route suffices, or a sitewide surface is prudent
anyway, is a judgment for counsel — `ea-content-usage-policy-research.md` LR-7
preserves "where it must appear" as an open question, and this review does not
answer it.

**Q-C-2.** Whether the stronger formulation "EA cannot grant rights that belong
to third parties" should be restored in place of A-06's narrower attributable
statement. This review declines to make that call; it is a legal conclusion.

**Q-C-3.** Whether an attribution notice should, as a matter of position,
contain express statements that no permission, licence, fair use, or clearance
is claimed — and if so, in what form. This is the substantive half of Q-E2F2-1 and
is the reason Q-E2F2-1 is framed as a choice rather than a correction.

**Q-C-4.** Whether "subject to the rights of their respective owners" is the
right standard formula, and what specific acknowledgement wording (if any)
should be used for named platform and league marks. This review deliberately
does not propose a per-mark trademark acknowledgement, because naming a
specific registrant for any mark would require external research this session
is instructed not to conduct and would risk inventing an ownership chain.

**Carried forward unresolved from E2C3, unchanged by this review:** whether
EA's content policy covers the X-Factor and crest uses (U1, U2, U8, LR-2,
LR-3); the `robots.txt` scraping-reservation ambiguity (U5, LR-5) and the
unread `drop-assets.ea.com/robots.txt` (U6); per-asset third-party exposure
(U3, LR-4); and the base/custom crest factual nature (U4, LR-6).

---

## 10. Recommended next single session

**E2F3 — apply the eight mechanical corrections to
`docs/planning/ea-nhl-attribution-notice-draft.md`.** *(Count corrected in
E2F2A: nine → eight, because A-02 is no longer a required correction.)* One
task, one file. **A-01, A-03, A-04, A-05, A-06, A-08, A-09, and A-10** — items
1–5 and 7–9 from §6 above — plus the A-18 internal checklist item, are all
deletions or narrow rewrites with no decision content; they can be applied
without operator input and without touching any other document.

Items 6 and 10 of §6 — A-07 (public §8) and A-11 (the no-clearance admissions) —
should be **held for the operator's Q-E2F2-1 answer** and applied in a second
short pass, either in E2F3 if the answer arrives first, or in a follow-on E2F4.
Do not bundle the optional improvements listed in §7 of this review into the
same session unless the operator asks; they are drafting polish and belong after
the required corrections land. **A-02 now sits in that optional set** — it is
recommended footer polish, not a required correction.

**Do not** in that session: revise any other planning draft, resolve any public
route, check a Gate 2 checkbox, conduct external licence research, or reopen
E2C5.

---

## 11. What this review did not touch

*(Scope note — E2F2A. The list below records the E2F2 review session. The E2F2A
correction session that followed edited exactly three files:
`docs/planning/ea-content-usage-policy-research.md` (§7 item 1 placement
wording, plus a visible correction note), this review, and one additive
`HANDOFF.md` entry. Everything else below remains true of both sessions.)*

- `docs/planning/ea-nhl-attribution-notice-draft.md` — **not revised**, in E2F2
  or in E2F2A.
- `docs/planning/privacy-policy-draft.md`,
  `docs/planning/privacy-policy-review.md`,
  `docs/planning/data-collection-policy-draft.md`,
  `docs/planning/data-collection-policy-review.md`,
  `docs/planning/ea-asset-decision-memo.md` — all read only, none modified.
- `docs/planning/ea-content-usage-policy-research.md` — read only in E2F2;
  corrected in E2F2A as described above, with the quoted EA wording, the
  condition-not-permission distinction, and every other research conclusion
  preserved unchanged.
- `docs/planning/launch-page-design-prototypes.md` — not opened in this
  session and not modified; it is already dirty in the working tree from
  earlier E2 work and is unrelated to this review.
- No code, configuration, asset, test, route, dependency, or style file was
  read for modification or changed. Repository reads were read-only greps and
  directory listings. E2F2A additionally read
  `apps/web/src/components/player-meta-icons.tsx`,
  `docs/branding/flags/canada.svg`, and `docs/branding/flags/united-states.svg`
  read-only and compared their path data with a throwaway script outside the
  repository; **none of those three files was modified.**
- No Gate 2 checkbox changed; `HANDOFF.md:150` remains `- [ ]`.
- No external account, provider, host, or database accessed. No EA page
  fetched. `scripts/scrape_ea_xfactor_pngs.sh` not executed.
- No Terms of Use drafted or edited. No logging inventory performed.
- Nothing staged, committed, pushed, published, or deployed; the tunnel remains
  closed and separately unauthorized.
- `HANDOFF.md` edited only to append one E2F2 Active State entry; E2F2A appended
  one further correction entry and rewrote nothing in the historical E2F2 entry.
- **No answer to Q-E2F2-1 was recorded in E2F2 or in E2F2A.** It remains open.
