# Terms of Use — Independent Review (E2G2)

> **Scope: local factual and drafting issue-spotting only.** This review was
> produced by an AI review session against `HANDOFF.md`, the repository, and
> the three sibling Gate 2 drafts. **It is not legal advice, it is not legal
> review, and it is not legal clearance.** No external legal research was
> conducted, no external website, provider, account, host, or database was
> accessed, and no enforceability determination is made anywhere in this
> document. Questions that require a lawyer are routed to counsel and left
> open, not answered.
>
> **This review does not revise `docs/planning/terms-of-use-draft.md`.** That
> file is byte-for-byte unchanged by this session. No other planning draft,
> review, research, prototype, code, configuration, asset, test, dependency,
> or route was modified. No Gate 2 checkbox was changed. E2C5 is not reopened.
> Tunnel reopening remains separately unauthorized.

---

## 1. Executive verdict

**The draft is NOT ACCEPTED as a drafting-quality checkpoint.**

The Terms are structurally sound and, in most respects, unusually disciplined:
they carry no arbitration clause, no exclusive-venue clause, no jury-trial
waiver, no indemnity, no liquidated damages, no liability cap, no invented
route, no invented age threshold, no blanket intellectual-property claim, and
no permission/licence/fair-use/clearance claim. `alerts@boogeymen.app` is
absent. The public/internal boundary holds structurally as well as lexically.
Sections 11, 12, and 13 comply with the operator's recorded governing-terms
decision, and the archival/request language reuses wording already carried,
unflagged, by the two privacy drafts.

What blocks acceptance is a small number of concrete defects, not a general
weakness:

- **One internal contradiction in public text.** Section 4 offers to grant
  permission for conduct that section 5 flatly prohibits — including working
  around security, access-control, and rate-limiting measures. Read literally,
  the document tells a reader that circumvention is available on request.
- **Two public statements that narrow or exceed a recorded operator
  decision** — section 4's "in whole or in substantial part" dataset
  qualifier, and section 3's grant of saved pages and screenshots.
- **Three public formulations that repeat drafting errors already corrected
  in the sibling attribution notice** — a possessive framing of factual data
  (A-03/A-14), a legal-capacity conclusion (A-06), and the no-clearance
  vocabulary the operator's Q-E2F2-1 decision moved out of public text.
- **One unsupported factual assertion** — "Some of these measures are
  automatic," which the recorded provider evidence does not establish for the
  measures section 10 actually lists.
- **Three citation/status errors in the internal checklist and the E2G
  HANDOFF entry** — the wrong E2A decision number is cited as the authority
  for excluded clauses in two places in the draft and one in `HANDOFF.md`, and
  E2G's status line understates the review history of the other three drafts.

**No new unsupported legal claim was identified in the public text within this
review's stated factual and drafting scope**, with the single exception of
finding T-04 (section 4's "We cannot give you permission for third-party
material"), which is a legal-capacity conclusion of exactly the class the
E2F2/E2F2A review required be removed from the attribution notice. Every other
public sentence examined either restates a recorded operator decision, states a
verifiable repository/provider fact, or is a scope disclaimer.

Nine of the eleven required corrections are mechanical and can be applied
without any operator or counsel input. Two are held for an operator answer.

---

## 2. Finding counts

Counted by enumerating the finding bodies in §4, not estimated.

| Class | Count |
| --- | --- |
| BLOCKER | 1 |
| MATERIAL CORRECTION | 10 |
| RECOMMENDATION | 10 |
| ACCEPTABLE AS WRITTEN | 9 |
| **Total findings** | **30** |

**Required before the draft can be accepted as a drafting-quality checkpoint:
11** — T-01 through T-11.

- **Mechanical, no operator or counsel answer needed: 9** — T-01, T-02, T-03,
  T-04, T-05, T-07, T-08, T-09, T-10.
- **Held for an operator answer: 2** — T-06 (held for Q-E2G2-1) and T-11 (held
  for Q-E2G2-2).

Owner distribution (a finding may carry more than one owner):

| Owner | Findings |
| --- | --- |
| PUBLIC TERMS | T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-11, T-12, T-13, T-14, T-15, T-16, T-19, T-21, T-23, T-24, T-25, T-27, T-28, T-29, T-30 |
| INTERNAL CHECKLIST | T-08, T-17, T-18, T-20, T-26 |
| HANDOFF | T-09, T-10 |
| OPERATOR | T-02, T-06, T-11 |
| COUNSEL | T-04, T-16, T-22, T-25 |
| GATE 3 | T-07, T-13, T-20 |

Issue-type distribution:

| Type | Findings |
| --- | --- |
| Contradiction with an operator decision | T-02, T-06, T-11 |
| Unsupported factual assertion | T-07, T-10 |
| Drafting ambiguity | T-01, T-03, T-05, T-12, T-14, T-15, T-19, T-21 |
| Internal/public-boundary problem | T-08, T-09, T-18, T-20 (none in public text) |
| Counsel-dependent question | T-04, T-16, T-22 |
| Optional stylistic improvement | T-13, T-17 |

---

## 3. Indexed findings

| # | Class | Owner | Summary |
| --- | --- | --- | --- |
| T-01 | BLOCKER | [PUBLIC TERMS] | §4 offers permission for conduct §5 prohibits outright, including bypassing security and rate-limiting measures |
| T-02 | MATERIAL | [PUBLIC TERMS] + [OPERATOR] | §4's "in whole or in substantial part" narrows E2A decision 4's unqualified dataset-republication restriction |
| T-03 | MATERIAL | [PUBLIC TERMS] | §4's heading "Republishing **our** information" applies a possessive to factual match data, contrary to A-03/A-14 |
| T-04 | MATERIAL | [PUBLIC TERMS] + [COUNSEL] | §4's "We cannot give you permission for third-party material" is a legal-capacity conclusion — the A-06 error, inverted onto the project |
| T-05 | MATERIAL | [PUBLIC TERMS] | §3's personal-copy grant carries no third-party carve-out; §4's limiter is textually confined to §4 |
| T-06 | MATERIAL (held) | [PUBLIC TERMS] + [OPERATOR] | §7's "licensed, cleared, or used with permission" reuses the vocabulary Q-E2F2-1 moved out of public text |
| T-07 | MATERIAL | [PUBLIC TERMS] + [GATE 3] | §10's "Some of these measures are automatic" is not established by recorded provider evidence for the measures §10 lists |
| T-08 | MATERIAL | [INTERNAL CHECKLIST] | Internal blocker 4 and Q-E2G-5 cite "E2A decision 6" as authority for excluded clauses; decision 6 is Request outcomes |
| T-09 | MATERIAL | [HANDOFF] | The E2G HANDOFF entry carries the same wrong citation ("per E2A decision 6") |
| T-10 | MATERIAL | [HANDOFF] | E2G's "zero reviewed or publishable ones" is wrong — three of four drafts had independent drafting reviews |
| T-11 | MATERIAL (held) | [PUBLIC TERMS] + [OPERATOR] | §3 grants saved pages and screenshots; E2A decision 4 permits "personal/noncommercial viewing" |
| T-12 | RECOMMENDATION | [PUBLIC TERMS] | Linking and copying share a sentence; linking should stand alone and unconditioned |
| T-13 | RECOMMENDATION | [PUBLIC TERMS] + [GATE 3] | §3's "public pages" is broader than E1F's decided indexing set; "sort" is not one of E1F's named query variants |
| T-14 | RECOMMENDATION | [PUBLIC TERMS] | §7's non-affiliation sentence is a near-variant of EA's specified statement, minus "EA SPORTS" and "or its licensors" |
| T-15 | RECOMMENDATION | [PUBLIC TERMS] | §11's "beyond what is stated in these Terms" implies the Terms contain warranties |
| T-16 | RECOMMENDATION | [PUBLIC TERMS] + [COUNSEL] | §1's "please do not use the site" states a request where the acceptance mechanic needs a condition |
| T-17 | RECOMMENDATION | [INTERNAL CHECKLIST] | §10's "no accounts" statement goes stale if the dormant authentication feature is ever activated |
| T-18 | RECOMMENDATION | [INTERNAL CHECKLIST] | Internal blocker 12 cites "E2A decision 3 / E2D3 item 8" for a statement neither entry makes |
| T-19 | RECOMMENDATION | [PUBLIC TERMS] | §2's unqualified "identifiers" is broader than what is verified to be published |
| T-20 | RECOMMENDATION | [INTERNAL CHECKLIST] + [GATE 3] | Q-E2G-3 (AI/TDM crawlers) is tracked only as a question; it should also be a numbered pre-publication blocker |
| T-21 | RECOMMENDATION | [PUBLIC TERMS] | §9's "without notice" sits unreconciled against §14's change-notice commitment |
| T-22 | ACCEPTABLE | [PUBLIC TERMS] + [COUNSEL] | §6's "legitimate need to keep an accurate archival record" is consistent, verbatim, sibling-document language |
| T-23 | ACCEPTABLE | [PUBLIC TERMS] | §1's statement that appearing in match data is not agreement to the Terms |
| T-24 | ACCEPTABLE | [PUBLIC TERMS] | §2's age posture: no visitor threshold invented, membership not conflated with eligibility |
| T-25 | ACCEPTABLE | [PUBLIC TERMS] + [COUNSEL] | §13 complies with E2A decision 2 in full |
| T-26 | ACCEPTABLE | [INTERNAL CHECKLIST] | Public/internal boundary holds structurally as well as lexically |
| T-27 | ACCEPTABLE | [PUBLIC TERMS] | §10's requests-not-memberships framing matches the no-account posture |
| T-28 | ACCEPTABLE | [PUBLIC TERMS] | No prohibited clause appears anywhere in the public text |
| T-29 | ACCEPTABLE | [PUBLIC TERMS] | Contact split correct; `alerts@boogeymen.app` absent from the file |
| T-30 | ACCEPTABLE | [PUBLIC TERMS] | §12 identifies the operator without naming them, and carries no cap |

---

## 4. Detailed findings

### T-01 · BLOCKER · [PUBLIC TERMS] — Section 4 offers permission for conduct section 5 prohibits outright

**Exact draft passage** (lines 75–80, section 4, first bullet), under the
section lead-in at line 72, "Please ask us before you do any of the
following":

> - **Bulk collection that disrupts the site.** Automated collection at a
>   volume or rate that degrades, overloads, or interferes with this site or
>   the infrastructure it runs on, or that works around rate limits or other
>   protective measures. This is a restriction on disruptive bulk scraping. It
>   is not a general ban on automated access, and it is not directed at
>   ordinary search-engine crawling.

**Authoritative comparison.** Section 5 (lines 97–105) makes the same two
categories of conduct flatly impermissible:

> - interfere with, disrupt, overload, or attack this site or the
>   infrastructure it runs on, including through denial-of-service traffic or
>   malicious code;
> - attempt to gain access to non-public areas, accounts, systems, or data, or
>   to bypass, disable, or work around any security, access-control, or
>   rate-limiting measure;

E2A decision 4 authorizes a permission requirement for "disruptive bulk
scraping" — it does not authorize offering permission to circumvent protective
measures, and no operator decision anywhere in `HANDOFF.md` contemplates
granting that.

**Impact.** This is an internal contradiction in public text, and it runs in
the dangerous direction. Section 4's frame is explicitly "please ask us before
you do any of the following," which represents to the reader that permission is
obtainable for everything listed under it. Two of the three clauses in the
first bullet — degrading/overloading the site, and working around rate limits
or other protective measures — are also the subject of unconditional
prohibitions four paragraphs later. A reader applying the ordinary
specific-over-general reading would conclude that section 4 governs in the bulk
collection context, and that a scraper who emails `webmaster@boogeymen.app`
may be authorized to evade rate limiting. That reading undercuts the entire
anti-abuse section, and it is the one place in the draft where the public text
could be quoted against the project.

The overlap is not merely theoretical drafting tidiness: section 4's bullet and
section 5's second bullet use nearly identical verbs ("works around rate limits
or other protective measures" / "work around any security, access-control, or
rate-limiting measure"), so there is no textual signal that they are meant to
describe different conduct.

**Owner.** [PUBLIC TERMS].

**Precise proposed resolution.** Draw the boundary at *disruption and evasion*:
volume alone is the permission-required category; conduct that actually
degrades the site or defeats a protective measure belongs solely to section 5,
as prohibited. Replace the bullet with:

> - **Bulk automated collection.** Systematically collecting substantial
>   portions of this site's content by automated means, at high volume or at a
>   high request rate. This is a restriction on bulk scraping. It is not a
>   general ban on automated access, and it is not directed at ordinary
>   search-engine crawling. Conduct that actually degrades or overloads the
>   site, or that works around a protective measure, is not something we
>   permit on request — see section 5.

This keeps E2A decision 4's permission requirement for bulk scraping intact,
removes the implication that disruption or circumvention is available on
request, and leaves section 5 as the single home for both. Do not resolve the
contradiction in the other direction by softening section 5.

---

### T-02 · MATERIAL CORRECTION · [PUBLIC TERMS] + [OPERATOR] — "In whole or in substantial part" narrows the binding dataset-republication decision

**Exact draft passage** (lines 81–84, section 4, second bullet):

> - **Republishing our information as a dataset.** Redistributing the match,
>   statistics, roster, identifier, or related information published here — in
>   whole or in substantial part — as a dataset, data feed, API, database,
>   mirror, or comparable bulk compilation.

**Authoritative comparison.** E2A decision 4, verbatim: "Personal/noncommercial
viewing and normal search-engine indexing are permitted. Disruptive bulk
scraping, **dataset republication**, and commercial reuse require permission."
The decision carries no quantitative qualifier of any kind.

**Impact — this is a genuine narrowing, and yes, it silently permits smaller
dataset republication.** Dataset republication below the "substantial part"
threshold falls outside section 4 and therefore outside the permission
requirement. It is not picked up anywhere else: section 3's standing permission
runs only to "your own personal, noncommercial use," which republication is
not, and section 5 does not mention it. The result is a gap in which a
third party can build and publish, say, a season's worth of one player's game
log as a data feed and correctly observe that the Terms never asked them to
seek permission for it. The operator's decision required permission for dataset
republication as a category; the draft requires it only above an undefined
volume line.

The qualifier is also unnecessary. The drafting problem it appears to be
solving — preventing a single quoted stat line from counting as "republishing a
dataset" — is already solved by the bullet's own form requirement, which
restricts the conduct to redistribution "as a dataset, data feed, API,
database, mirror, or comparable bulk compilation." A quoted result is none of
those. Removing "in whole or in substantial part" therefore restores the
operator decision without creating any conflict with the personal-copy
permission in section 3.

**Owner.** [PUBLIC TERMS] to apply; [OPERATOR] only if the operator wants to
*keep* the narrowing, which would be a deliberate amendment to E2A decision 4
and should be recorded as one.

**Precise proposed resolution.** Delete the em-dashed qualifier. Combined with
T-03, the bullet becomes:

> - **Republishing information from this site as a dataset.** Redistributing
>   the match, statistics, roster, identifier, or related information published
>   here as a dataset, data feed, API, database, mirror, or comparable bulk
>   compilation.

---

### T-03 · MATERIAL CORRECTION · [PUBLIC TERMS] — "Our information" applies a possessive to factual match data

**Exact draft passage** (line 81, section 4, second bullet heading):

> - **Republishing our information as a dataset.**

**Authoritative comparison.** The attribution notice's A-03 (MATERIAL
CORRECTION, applied at E2F3) and A-14 (applied at E2F4) established the
governing rule for this project's public text: factual match and statistical
data is **source-attributed**, never described as anyone's property. A-03's
finding is directly on point — "the footer tells every visitor that the site's
factual match and statistical data is somebody else's property. That is a legal
conclusion the project has not reached." E2F4 recorded the settled outcome:
"**No ownership language is applied to factual match/statistical data** — the
footer continues to source-attribute that data rather than describe it as
anyone's property." The Terms draft's own internal blocker 10 states the same
intent: section 4 restricts "*what visitors may do with this site*" rather than
claiming ownership of match statistics.

**Impact.** The bullet body is already correct — "the match, statistics,
roster, identifier, or related information **published here**" is locational
and neutral. The heading is not. "Our information" is a bare possessive applied
to the same factual data the attribution notice deliberately refuses to
characterize as property, and headings are the part of a bulleted list that
gets read. Two public documents will sit side by side saying opposite things
about the same data.

This is the mirror image of the A-03 problem rather than an identical
recurrence: A-03 assigned the data to third parties, this assigns it to
Boogeymen. Both are ownership characterizations the project has not reached and
does not need.

**Owner.** [PUBLIC TERMS].

**Precise proposed resolution.** Use the locational phrasing the bullet body
already uses. "Republishing information from this site as a dataset" — or
"Republishing information published on this site as a dataset," which the
review prompt proposes and which is equally safe. Either keeps section 4 framed
as site-use terms. Do not substitute a possessive elsewhere; section 4's
remaining possessives ("our permission," "this site's content") are about the
project's own act of permitting and about locating content on the site, not
about ownership of data, and are fine.

---

### T-04 · MATERIAL CORRECTION · [PUBLIC TERMS] + [COUNSEL] — "We cannot give you permission for third-party material" is a legal-capacity conclusion

**Exact draft passage** (lines 89–92, section 4, closing paragraph):

> If we do give permission, it covers only what we describe when we give it,
> and only the material we are actually in a position to permit. We cannot give
> you permission for third-party material — see "Third-party content, names,
> and marks" below.

**Authoritative comparison.** A-06 (MATERIAL CORRECTION, applied at E2F3)
addressed the identical construction pointed at EA: the draft notice said "EA's
own materials **cannot** grant … rights that belong to the NHL, the NHLPA …".
The review's reasoning: "'Cannot grant' is a conclusion about EA's legal
capacity, asserted publicly by a project that has expressly not obtained legal
review (internal blocker 1) and is instructed not to make legal findings. It is
also unnecessary … The draft's 'and do not purport to grant' half is already
the correct register; it is the 'cannot' half that overreaches." E2F3 applied
the correction and recorded: "No independent conclusion about EA's legal
capacity." Whether counsel later wants the stronger formulation restored is
preserved as Q-C-2, still open.

E2F3/E2F4 are consistent with this: the surviving public text says third-party
material "remains **subject to the rights of** their respective owners" and
that attribution "does not establish permission" — factual and scope
statements, never capacity conclusions.

**Impact.** The Terms make the same move about the project itself. "We cannot
give you permission" is a legal conclusion about Boogeymen's own capacity,
asserted publicly by a project whose internal blocker 1 records that it has
had no legal review. It is also not reliably true as a categorical statement:
some third-party material on a site is sublicensable by the site operator (a
font licence being the obvious example), and this project has expressly not
completed the provenance work that would establish which category anything
falls into — E2A decision 9, and the attribution notice's blockers 2, 6, 7 and
8, all remain open. The sentence therefore asserts publicly the one thing the
internal record says is unknown.

The preceding sentence already does the necessary work correctly: "only the
material we are actually in a position to permit" is the "do not purport to
grant" register, hedged and accurate. The "cannot" sentence adds nothing except
the overreach.

**Owner.** [PUBLIC TERMS] to apply; [COUNSEL] for the parallel to Q-C-2, since
counsel may later prefer the stronger formulation in both documents or in
neither, and they should move together.

**Precise proposed resolution.** Replace the capacity conclusion with a scope
statement about the permission being granted — the resolution the review prompt
identifies, which is also the A-06 shape:

> If we do give permission, it covers only what we describe when we give it,
> and only the material we are actually in a position to permit. Our permission
> is ours alone: it is not permission from anyone else who holds rights in
> material appearing on this site — see "Third-party content, names, and marks"
> below.

Record the counsel question additively rather than resolving it (see §9,
Q-C-E2G2-1).

---

### T-05 · MATERIAL CORRECTION · [PUBLIC TERMS] — Section 3's personal-copy grant carries no third-party carve-out

**Exact draft passage** (lines 55–58, section 3):

> You may read, view, and browse this site for your own personal,
> noncommercial purposes. You may link to our pages, and you may keep personal
> copies — a saved page, a screenshot, a quoted result — for your own personal,
> noncommercial use.

**Authoritative comparison.** Section 4's limiter — "only the material we are
actually in a position to permit" (line 90) — is textually confined to section
4: it is the closing paragraph of a section whose subject is permissions
granted on request, and it opens "If we do give permission." Nothing extends it
to section 3's standing grant. Section 7 (lines 137–141) does contain a general
disclaimer — "nothing in these Terms grants you any rights in that material" —
but it appears four sections later. E2C3's three classifications remain
unchanged and unresolved (X-Factor PNGs `NOT ADDRESSED / AMBIGUOUS`; base
crests `CONDITIONALLY SUPPORTED AT BEST, on unverified premises`; custom crests
`CONDITIONAL / FACTUAL NATURE UNRESOLVED`), and E2C5's retention decision is
expressly "not legal clearance."

**Impact.** A saved page or screenshot of this site necessarily reproduces
third-party material — X-Factor PNGs, crests, platform marks, flags, the
typefaces. Section 3, read alone, is an unqualified grant of the right to make
those copies. The project is not established to hold that right for any of that
material, and its own internal record says so.

This is a placement and salience defect rather than a flat contradiction:
section 7 does eventually disclaim it. But section 3 is where a reader stops
reading once they have their answer, and the sibling attribution notice was
required at A-01 to fix a structurally analogous problem — a correct statement
placed where readers would not connect it. The fix here is one clause.

**Owner.** [PUBLIC TERMS].

**Precise proposed resolution.** Carry the section 4 limiter forward into
section 3, as a short trailing sentence in the same paragraph:

> What we permit here is ours to permit. Material on this site that belongs to
> others stays subject to their rights — see "Third-party content, names, and
> marks" below.

This is a public-to-public reference of the kind already used elsewhere in the
draft (line 92) and in the attribution notice's §5→§6 pointer, so it does not
touch the internal boundary.

---

### T-06 · MATERIAL CORRECTION (held for Q-E2G2-1) · [PUBLIC TERMS] + [OPERATOR] — Section 7 reuses the no-clearance vocabulary the operator moved internal

**Exact draft passage** (lines 137–141, section 7):

> We do not claim to own everything that appears on this site. Third-party
> names, marks, logos, images, and other material remain subject to the rights
> of their respective owners, and nothing in these Terms grants you any rights
> in that material **or states that any particular material is licensed,
> cleared, or used with permission.**

**Authoritative comparison.** The operator's answer to Q-E2F2-1, recorded
verbatim at E2F3: "*Move the express no-permission, no-clearance, and
missing-evidence statements into the internal section. Delete public §8, 'Asset
retention is not legal clearance.' Keep factual source attribution and
non-affiliation public.*" Applied at E2F3 under A-11, which deleted from the
public notice, among others, "§5's blanket 'we do not claim… licensed, in the
public domain, legally cleared, or used with permission.'" E2F4's verification
confirms the outcome held: the public notice contains "no … missing-evidence,
no-permission, no-clearance, or asset-retention narration; **no positive
permission, licence, fair-use, ownership, or clearance claim**."

**Impact — this review does not treat the answer as obvious, and both readings
are real.**

*Reading A — proper document-scope disclaimer.* The clause is grammatically a
statement about what *this document* does, not about the status of the
material. "Nothing in these Terms … states that any particular material is
licensed" is the same species as "nothing in these Terms grants you any rights"
immediately before it. Q-E2F2-1 was directed at affirmative admissions in the
voice of the project ("we do not claim it is cleared"), which is a different
sentence. On this reading the clause is unobjectionable and arguably useful,
because it forecloses an argument that the Terms themselves conferred
something.

*Reading B — the admission reintroduced in another public document.* The clause
reproduces the operator-removed phrase almost word for word: the deleted notice
text was "licensed, in the public domain, legally cleared, or used with
permission"; the Terms say "licensed, cleared, or used with permission." The
two documents will be published together and read together, and a reader
encountering "nothing here says any of this is cleared" will take the practical
point that nothing anywhere says it is cleared — which is precisely the
inference Q-E2F2-1 chose to keep out of public view. The scope framing is a thin
membrane over the same content.

**This review's determination:** the clause is a scope disclaimer in *form* but
carries the removed admission in *substance*, and it is the only place in
either public document where that vocabulary now survives. Because the operator
made a deliberate, recorded choice about this exact wording in the sibling
document, the choice belongs to the operator and not to a drafting session —
which is why this finding is held rather than mechanical. However, the cost of
resolving it is zero: the first half of the clause does all the necessary work
on its own.

**Owner.** [OPERATOR] to decide; [PUBLIC TERMS] to apply.

**Precise proposed resolution (recommended, pending the operator's answer).**
Delete the second half of the clause and keep the first:

> … remain subject to the rights of their respective owners, and nothing in
> these Terms grants you any rights in that material.

This preserves the scope disclaimer, removes the clearance vocabulary, and
matches the public posture the attribution notice now carries. Nothing in the
shortened form implies the material *is* cleared — silence makes no claim
either way, and section 7's surviving sentences ("we do not claim to own
everything"; "remain subject to the rights of their respective owners") already
prevent that reading. If the operator prefers to keep the full clause, record
that as an explicit extension of the Q-E2F2-1 decision to the Terms so a later
session does not delete it as an oversight.

---

### T-07 · MATERIAL CORRECTION · [PUBLIC TERMS] + [GATE 3] — "Some of these measures are automatic" is not established by the recorded evidence

**Exact draft passage** (lines 167–170, section 10):

> If conduct disrupts the site or breaks these Terms, we may take proportionate
> technical measures in response: rate-limiting, blocking or filtering
> requests, or otherwise restricting access. **Some of these measures are
> automatic**, and some may be temporary.

**Authoritative comparison — the recorded provider evidence, E2B2 (operator-read
Cloudflare zone dashboard, 2026-09-08):**

> Security posture: Bot Fight Mode Off. The Free Managed Ruleset is
> always-active/default protection; 0 additional operator-deployed managed
> rules … **Custom rules: 0 of 5, none enabled. Rate-limiting rules: 0 of 1, no
> actions/characteristics configured.**

Repository evidence, verified this session: no inbound rate limiting exists in
the application. `apps/web` has no `middleware.ts` at either
`apps/web/middleware.ts` or `apps/web/src/middleware.ts`. Every `throttle`
symbol in `apps/worker` and `packages/ea-client` is the *outbound*
inter-request delay to EA's API (`packages/ea-client/src/client.ts:124`,
governed by `EA_REQUEST_DELAY_MS`) — it governs the project's own requests to
EA, not visitors' requests to the site. `docker-compose.yml` configures no
rate-limiting or filtering layer.

**Impact — distinguishing the three categories the review prompt asks for:**

- **Verified current configuration.** Zero rate-limiting rules and zero custom
  rules are configured on the Cloudflare zone, and Bot Fight Mode is off.
  **Automatic rate limiting does not exist.** The one automatic mechanism in
  the record is Cloudflare's Free Managed Ruleset, described by E2B2 as
  "always-active/default protection" — which supports *some* automatic
  filtering at the edge, but its actual actions (block, challenge, log) were
  not recorded, and E2B2's evidence is operator-attested dashboard reading, not
  agent-verified.
- **Technical capability.** Cloudflare's Free plan offers one rate-limiting
  rule and five custom rules. The capability exists; none is deployed.
- **Possible future behavior.** Any of these could be configured at or after
  Gate 3. Nothing in `HANDOFF.md` records a decision to do so.

There is a further factual problem: the site is not published and the tunnel is
offline, so no enforcement measure of any kind is presently operating on public
traffic. A present-tense assertion about what happens to visitors is, today, an
assertion about a site that has no visitors.

Section 10 lists three measures and then says "some of these" are automatic.
Because rate-limiting leads that list and is definitively not automatic, the
sentence as written points the reader at the one thing the evidence excludes.
The draft's own internal blocker 10 already concedes the adjacent point —
"whether 'disruptive' volume is a workable standard **without a published rate
limit**" — so the internal record and the public text disagree.

**Owner.** [PUBLIC TERMS] to correct; [GATE 3] because the accurate wording
depends on what is actually deployed at launch, and a Gate 3 pass should
re-verify it.

**Precise proposed resolution.** Either delete the clause, or restate it as
capability rather than current fact. The narrower fix:

> … or otherwise restricting access. Some of these measures may be applied
> automatically by the network and hosting services we use, and some may be
> temporary.

This is supportable from E2B2's always-active managed ruleset without asserting
an automatic rate limiter this project has not configured. Add an internal
checklist item requiring the sentence to be re-verified against the deployed
Cloudflare configuration before publication, and do not infer an automatic rate
limiter from zero configured custom rate-limiting rules at any later pass.

---

### T-08 · MATERIAL CORRECTION · [INTERNAL CHECKLIST] — Internal blocker 4 and Q-E2G-5 cite the wrong E2A decision

**Exact draft passages.** Two locations.

Location 1 — internal publication blocker 4 (lines 280–284):

> The mandatory-law carve-outs in sections 11 and 12 were written deliberately
> and must not be removed to "tighten" the language; **per E2A decision 6**, no
> arbitration clause, exclusive-venue clause, jury-trial waiver, indemnity, or
> liquidated-damages provision may be added without a fresh operator decision
> **and** counsel review.

Location 2 — Q-E2G-5 (lines 389–393):

> Whether these Terms need any provision the operator has excluded — indemnity,
> arbitration, exclusive venue, liquidated damages, a liability cap — is left
> open for counsel to raise, but **per E2A decision 6** and the operator's E2G
> instructions none may be added without a fresh operator decision.

**Authoritative comparison — the actual E2A numbering** (`HANDOFF.md`, E2A
entry, verified by reading the enumerated list):

- **E2A decision 2 — "Governing terms."** "Alberta law governs. **No
  exclusive-venue clause**; any mandatory statutory consumer/user rights are
  preserved regardless of venue or law-selection language."
- **E2A decision 6 — "Request outcomes."** "Correction, de-identification, or
  removal is decided case-by-case under applicable law and archival-integrity
  needs. Prior publication by EA is not automatic grounds to refuse a request."

**Impact.** Decision 6 says nothing about clause exclusion. It is the authority
for section 6 of the public Terms, where the draft cites it correctly (the
revision-provenance list at line 237 includes decision 6, and section 6's
case-by-case language tracks it). Using it as the authority for the excluded
clauses sends any later session to the wrong entry, and — more consequentially —
obscures the fact that **only one of the five excluded provisions has an E2A
basis at all**. The exclusion breaks down as:

| Excluded provision | Actual recorded authority |
| --- | --- |
| Exclusive-venue clause | **E2A decision 2**, express |
| Governing law = Alberta | **E2A decision 2**, express |
| Preservation of mandatory rights | **E2A decision 2**, express |
| Arbitration requirement | **No E2A decision.** The operator's E2G session-scope instruction only |
| Jury-trial waiver | **No E2A decision.** E2G session-scope instruction only |
| Indemnity | **No E2A decision.** E2G session-scope instruction only |
| Liquidated damages | **No E2A decision.** E2G session-scope instruction only |
| Liability cap | **No E2A decision.** E2G session-scope instruction only |

This is the same error class the Privacy Policy session recorded as P-17 —
`HANDOFF.md`'s E2D5 entry cited "E2D3 item 8" where item 10 was the authority —
and it should be handled the same way: corrected additively, with the
historical text left alone.

**Owner.** [INTERNAL CHECKLIST] for the two draft locations.

**Precise proposed resolution.** In both locations, replace "per E2A decision 6"
with an accurate split. Blocker 4:

> … must not be removed to "tighten" the language. **Per E2A decision 2**,
> Alberta law governs, there is no exclusive-venue clause, and mandatory
> statutory rights are preserved; **no E2A decision addresses arbitration,
> jury-trial waiver, indemnity, liquidated damages, or a liability cap — their
> exclusion rests on the operator's E2G session-scope instruction**, and none
> may be added without a fresh operator decision **and** counsel review.

Q-E2G-5 takes the same substitution: "per E2A decision 2 (governing law and no
exclusive venue) and the operator's E2G instructions (the remainder)."

Do not rewrite the E2G HANDOFF entry to match — see T-09.

---

### T-09 · MATERIAL CORRECTION · [HANDOFF] — The E2G entry carries the same wrong citation

**Exact passage** (`HANDOFF.md`, E2G entry):

> **Deliberately absent, per E2A decision 6 and this session's scope:** no
> indemnity clause, no arbitration clause, no exclusive-venue clause, no
> jury-trial waiver, no liquidated damages, no liability cap figure, no blanket
> intellectual-property ownership claim, no blanket prohibition on automated
> access, and no age threshold …

**Authoritative comparison.** As T-08: E2A decision 6 is Request outcomes;
decision 2 carries the governing-law and no-exclusive-venue instructions; the
remaining exclusions have no E2A basis and rest on the E2G session scope.

**Impact.** A third location for the same misattribution, in the file that is
treated as the authoritative project record. Left uncorrected it will propagate:
the next session that reads E2G before touching the Terms will inherit it.

**Owner.** [HANDOFF].

**Precise proposed resolution.** **Do not edit the E2G entry.** The established
convention in this repository — set at E2D3 item 12, applied at E2E2A, E2F2A,
E2F3, E2F4, and E2E3's P-17 — is that historical entries stay byte-for-byte
and are superseded additively by a later entry. Record the correction in the
E2G2 entry, in the same shape P-17 used: name the entry, name the wrong
citation, name the correct authority, and state that the historical entry is
deliberately not rewritten.

---

### T-10 · MATERIAL CORRECTION · [HANDOFF] — "Zero reviewed or publishable ones" understates the review history

**Exact passage** (`HANDOFF.md`, E2G entry, Status paragraph):

> **Status.** Gate 2 now has four written legal drafts and **zero** reviewed or
> publishable ones.

**Authoritative comparison.** Three of the four drafts have had an independent
review, and `HANDOFF.md` records each:

| Draft | Independent review | Correction pass | Later pass |
| --- | --- | --- | --- |
| Data Collection Policy | **E2D2** — "DATA COLLECTION POLICY INDEPENDENT REVIEW RECORDED" | E2D2A (review corrected), E2D4 (draft revised) | E2D5 verify-and-polish |
| Privacy Policy | **E2E2** — "PRIVACY POLICY INDEPENDENT REVIEW RECORDED" | E2E2A (review corrected), E2E3 (draft corrected) | — |
| EA/NHL attribution notice | **E2F2** — "ATTRIBUTION NOTICE INDEPENDENTLY REVIEWED" | E2F2A (review corrected), E2F3 (draft corrected) | E2F4, accepted as a **drafting-quality checkpoint** |
| Terms of Use | **none until this review** | — | — |

The draft's own internal blocker 1 states this correctly — "the Privacy Policy,
Data Collection Policy, and attribution notice each had one (E2D2/E2D2A,
E2E2/E2E2A, E2F2/E2F2A); these Terms have not" — and E2G's own blocker-1
summary repeats it. Only the Status line contradicts the rest of the entry.

**Impact.** As written the Status line erases three completed review cycles and
one accepted drafting-quality checkpoint. It is also self-inconsistent with the
same entry's blocker 1 gloss. The line is otherwise correct in the sense
presumably intended — none of the four has had *legal* review, and none is
publishable — which is exactly why the fix is a two-word narrowing rather than
a rewrite.

**Owner.** [HANDOFF].

**Precise proposed resolution.** Record additively in E2G2 (do not edit E2G):

> Gate 2 has four written legal drafts and **zero legally reviewed or
> publishable** ones. Three of the four — the Privacy Policy, the Data
> Collection Policy, and the EA/NHL attribution notice — have had independent
> drafting-quality reviews (E2D2/E2D2A, E2E2/E2E2A, E2F2/E2F2A) and subsequent
> correction passes; the attribution notice was accepted at E2F4 as a
> drafting-quality checkpoint. The Terms of Use had none until E2G2. Counsel
> review remains deferred and not completed for all four.

---

### T-11 · MATERIAL CORRECTION (held for Q-E2G2-2) · [PUBLIC TERMS] + [OPERATOR] — The personal-copy grant exceeds "personal/noncommercial viewing"

**Exact draft passage** (lines 55–58, section 3) — as quoted at T-05.

**Authoritative comparison.** E2A decision 4 permits "**Personal/noncommercial
viewing** and normal search-engine indexing." Viewing is what the decision
names. Saving a page, taking a screenshot, and quoting a result are
reproductions; they are downstream of viewing, not instances of it.

**Impact.** On a strict reading this is a public grant broader than any recorded
operator decision — and grants, unlike restrictions, cannot be walked back
quietly once published. On an ordinary reading, "personal, noncommercial use"
plainly encompasses saving a page for yourself, the extension is trivially
small, and refusing it would make the Terms unusual and slightly absurd for a
volunteer team-stats site.

This review does not think the wording is wrong. It thinks the wording is a
decision the operator has not made, and the honest resolution is ratification
rather than deletion — but the choice is not a drafting session's to assume,
which is why it is held rather than mechanical. Note that it also interacts with
Q-E2G-4 (community sharing): a screenshot permitted "for your own personal use"
is arguably *not* permitted to be posted in the team's Discord, which is
narrower than the project's evident purpose. The two are best answered together.

Distinct from T-05: T-05 is about third-party material inside the copy and is
mechanical; this is about the scope of the grant itself.

**Owner.** [OPERATOR] to ratify or narrow; [PUBLIC TERMS] to apply.

**Precise proposed resolution.** Ask the operator (Q-E2G2-2). If ratified — the
expected outcome — no text change is needed, but the internal
revision-provenance entry should record that section 3's personal-copy
permission is an operator-ratified extension of E2A decision 4 rather than a
restatement of it, so a later consistency pass does not read it as drift. If
the operator prefers to hold to the decision as recorded, narrow section 3 to
viewing and linking and move personal copies to a permission-required or
expressly-unaddressed status.

---

### T-12 · RECOMMENDATION · [PUBLIC TERMS] — Linking should be separated from copying

**Exact draft passage** (lines 56–58): "You may link to our pages, and you may
keep personal copies … for your own personal, noncommercial use."

**Analysis.** Grammatically, the "personal, noncommercial" qualifier attaches to
the personal copies, not to the linking — so the draft is technically correct
already. But the two permissions share a sentence inside a paragraph whose
opening line establishes a personal/noncommercial frame, and a reader can
reasonably carry the qualifier across the conjunction. That would imply that a
commercial site may not link to this one, which is not the intent, is not
anything E2A decided, and is a materially different kind of restriction from
the rest of section 4.

Linking is also categorically different from copying: it reproduces nothing, it
raises none of the third-party issues in T-05, and it is the one permission in
the section that has no interaction with sections 4, 5, or 7.

**Proposed resolution.** Give linking its own sentence, unqualified: "You may
link to any page on this site." Keep the personal-copy permission in a separate
sentence with its qualifier intact.

---

### T-13 · RECOMMENDATION · [PUBLIC TERMS] + [GATE 3] — Indexing wording is broader than the decided policy, and names a variant that policy does not

**Exact draft passage** (lines 60–64, section 3):

> **Normal search-engine indexing is permitted.** Ordinary search-engine
> crawlers are welcome to crawl and index this site's public pages in the usual
> way. Where we publish machine-readable indexing instructions, we ask that
> crawlers follow them; some URL variants, such as filter, **sort**, and
> pagination URLs, are not intended to be indexed as separate content.

**Authoritative comparison.** E1F decided the indexing policy:

- Canonical routes intended for indexing: `/`, `/games`, `/games/[id]`,
  `/roster`, `/roster/[id]`, `/stats`, plus finished legal/contact pages "once
  implemented and published — not before."
- Query variants to be `noindex, follow`: "**Filter, mode, role, view,
  opponent, title, and pagination** variants."
- `/preview/carousel` and `/preview/archetypes` are approved for removal but
  **not yet removed**; until then they "must be `noindex` and omitted from the
  sitemap." Both still exist — `apps/web/src/app/preview` is present in the
  route tree, verified this session.
- "robots.txt is crawl guidance, never authorization."

Verified this session: no `robots.txt`, no `sitemap`, and no legal-page route
exist anywhere under `apps/web`.

**Analysis.** Two small precision gaps, neither of them an error of substance:

1. "this site's public pages" is broader than the set E1F actually intends to
   be indexed. `/preview/*` is a public route today and is expressly excluded
   from indexing. The conditional second sentence partly rescues this, but it is
   conditional on instructions that do not yet exist.
2. "sort" is not among E1F's seven named query variants, and sorting in this
   application is a Client Component interaction rather than a URL variant, so
   a `?sort=` URL family is not established to exist. It is a plausible
   invention rather than a recorded one.

The conditional framing itself — "**Where** we publish machine-readable
indexing instructions" — is correctly hedged and should be preserved exactly.
It asserts nothing about a `robots.txt` that does not exist, and "we ask that
crawlers follow them" correctly treats robots directives as guidance rather
than authorization, matching E1F's reaffirmed boundary. That part is right.

**Proposed resolution.** Replace "this site's public pages" with "the pages we
make available for indexing," and align the variant list with E1F's — "such as
filter and pagination URLs" is sufficient and accurate; drop "sort." Add an
internal checklist item requiring this paragraph to be re-verified against the
deployed `robots.txt`/sitemap at Gate 3, since the sentence is written for a
state the site has not reached.

---

### T-14 · RECOMMENDATION · [PUBLIC TERMS] — The non-affiliation sentence is a near-variant of EA's specified statement

**Exact draft passage** (lines 141–144, section 7):

> Boogeymen is an independent fan project and is not endorsed by, affiliated
> with, or sponsored by EA, the NHL, the NHLPA, PlayStation, Xbox, Sony,
> Microsoft, or any team, club, or player.

**Authoritative comparison.** The attribution notice deliberately separates two
things. EA's specified statement is carried standalone and verbatim — "**This
website is not endorsed by or affiliated with EA or its licensors.**" — under a
lead-in framing it as a condition EA specifies (A-04, applied E2F3; A-02,
applied E2F3). The broader list is a separate sentence: "Boogeymen is also not
affiliated with, endorsed by, or sponsored by the NHL, the NHLPA, PlayStation,
Xbox, Sony, Microsoft, or any team, club, or player." E2F2A established that
EA's text does **not** require page-by-page or footer placement, so the Terms
are under no obligation to carry EA's sentence at all.

**Analysis.** The Terms merge the two into one sentence and, in doing so,
produce something that reads like EA's specified statement but is not: it drops
"or its licensors" and omits "EA SPORTS," both of which the notice carries. No
placement obligation is breached — that question is closed by E2F2A — and the
recorded cross-document boundary expressly allows the Terms to carry "only a
short non-affiliation sentence and a pointer." So this is a consistency and
precision point, not a compliance one.

The risk is small but real: two public documents carrying two different
near-identical EA non-affiliation formulations invites the reader (or a rights
holder) to ask which one the project considers operative.

**Proposed resolution.** Either (a) carry EA's specified sentence separately and
verbatim here as well, followed by the broader list, mirroring the notice's
structure; or (b) keep one merged sentence but make it clearly the Terms'
own generic statement and let the pointer to the attribution notice carry EA's
specified wording. Option (b) is lighter and is consistent with the recorded
boundary. Do not leave a formulation that is neither.

---

### T-15 · RECOMMENDATION · [PUBLIC TERMS] — "Beyond what is stated in these Terms" implies the Terms contain warranties

**Exact draft passage** (lines 179–182, section 11):

> We do not warrant that it will be accurate, complete, current, uninterrupted,
> error-free, or secure, and we make no warranties or representations about it
> **beyond what is stated in these Terms**.

**Analysis.** The carve-out reserves whatever warranties the Terms themselves
state — but the Terms state none. Section 6 is an accuracy *disclaimer*
("errors, gaps, and delays are possible … nothing here should be relied on as
an authoritative record"), section 9 disclaims availability, and section 12
limits liability. The clause therefore points at an empty set while suggesting
to the reader that a set exists. That is the opposite of what the section is
trying to do, and it invites an argument that some other sentence in the
document is a warranty.

Drafting ambiguity only; no operator decision is affected.

**Proposed resolution.** "…and we make no other warranties or representations
about it." Leave the mandatory-law paragraph that follows exactly as written —
internal blocker 4 is right that it must not be trimmed.

---

### T-16 · RECOMMENDATION · [PUBLIC TERMS] + [COUNSEL] — "Please do not use the site" states a request where a condition is intended

**Exact draft passage** (lines 25–27, section 1):

> By using the site, you agree to these Terms. If you do not agree with them,
> **please do not use the site.**

**Analysis, kept at issue-spotting level.** This review makes **no
enforceability determination** — that is squarely counsel's, and internal
blocker 12 already reserves it. Two drafting observations that counsel would
want on the table:

1. The two sentences are in different registers. The first states a legal
   consequence ("you agree"); the second states a courtesy ("please do not").
   Browse-wrap acceptance normally pairs the consequence with a condition ("if
   you do not agree, do not use the site"), so that the second sentence
   reinforces the first rather than softening it. As written, "please" invites
   the reading that continued use despite disagreement is merely impolite.
2. The acceptance sentence appears before any statement of how a visitor would
   encounter the Terms. Browse-wrap notice questions turn substantially on
   placement and conspicuousness — a Gate 3 footer-link matter that is not yet
   decided (Q-E2E2-1, Q-E2G-1). The draft cannot resolve that, but the internal
   checklist should connect the acceptance mechanic to the routing decision, not
   only to the counsel-review blocker.

The corresponding change mechanic in section 14 ("Changes apply going forward
from the date they are posted") is internally consistent with section 1 and
matches E2A decision 12's on-site material-change notice. Note that section 14
does **not** say continued use constitutes acceptance of changes; that omission
is protective rather than harmful, and this review does not recommend adding
it — but counsel should be told it is absent by choice, not oversight.

**Proposed resolution.** Change "please do not use the site" to "do not use the
site," or keep the courtesy register and add the condition explicitly. Route
the enforceability question to counsel unchanged (see §9). Preserve section 1's
second paragraph exactly (see T-23).

---

### T-17 · RECOMMENDATION · [INTERNAL CHECKLIST] — The "no accounts" statement will go stale if authentication is ever activated

**Exact draft passages** (lines 44–46, section 2; lines 172–174, section 10):

> There is no public account system: you cannot register, log in, upload,
> comment, or submit content through this site.

> Because this site has no accounts, there is nothing to suspend, cancel, or
> terminate — these measures apply to requests, not to memberships.

**Authoritative comparison.** Both are accurate today. The Data Collection
Policy records the fuller picture: the database "is *capable* of storing account
information, session details … authentication tokens, and credentials — because
the underlying software includes an authentication feature we have chosen not
to activate," and "no accounts can currently be created"; it also hedges the
public-facing statement as "does not offer user accounts or submissions **at
launch**," and commits that "if we activate authentication in the future, we
will conduct a fresh privacy review and update this policy before doing so."
The "AUTHENTICATION DELIBERATELY DISABLED FOR PRE-LAUNCH" Active State entry
records the same posture as deferred to a post-launch review.

**Analysis.** The Terms state the present fact flatly and correctly, and the
"public account system" qualifier in section 2 is precisely right — it does not
deny that a dormant capability exists. No correction is needed. What is missing
is the maintenance hook: two Terms sections would become false on the day
authentication is activated, and the DCP's fresh-review commitment currently
names only the privacy documents.

**Proposed resolution.** Add an internal checklist item: if authentication is
ever activated, sections 2 and 10 of the Terms must be revised in the same pass
as the Data Collection Policy's fresh privacy review. This is a checklist
addition only; do not add "at launch" hedging to the public Terms, which would
weaken a currently accurate statement.

---

### T-18 · RECOMMENDATION · [INTERNAL CHECKLIST] — Internal blocker 12 cites entries that do not say what it attributes to them

**Exact draft passage** (lines 358–360, internal blocker 12):

> Section 1's statement that appearing in match data is not agreement to these
> Terms **(E2A decision 3 / E2D3 item 8 posture)** must be preserved in any
> rewrite.

**Authoritative comparison.** E2A decision 3 is "Children and age" — adult-only
membership, opponents possibly minors, ages unknown/unverifiable/not collected,
no under-13 threshold. E2D3 item 8 is "Opponent-player display (Q-10)" —
opponent gamertags and statistics stay published as implemented, and the entry
expressly states this "does **not** establish that a legal basis has been
established." Neither entry says anything about whether opponents accept the
Terms.

**Analysis.** Weaker than T-08: the word "posture" signals "consistent with"
rather than "authorized by," and the sentence in section 1 is a sound,
protective drafting addition that follows naturally from the recorded posture.
But it is the same species of pointer error, and the P-17 precedent exists
because these pointers get followed.

**Proposed resolution.** Reword the parenthetical to describe the relationship
accurately: "(a drafting-originated protective statement, consistent with — but
not required by — E2A decision 3 and E2D3 item 8; no operator decision addresses
whether opponents accept the Terms)." Keep the preservation instruction; it is
correct (see T-23).

---

### T-19 · RECOMMENDATION · [PUBLIC TERMS] — "Identifiers" is unqualified and broader than what is verified to be published

**Exact draft passage** (lines 34–37, section 2):

> This is a public, read-only website that publishes match history, rosters,
> statistics, **identifiers**, and related information for our EA Sports NHL
> Pro Clubs team.

**Authoritative comparison.** The Privacy Policy describes what is *maintained*:
"team-member and opponent match information — including gamertags, statistics,
roster and match history, opponent-club and opponent-player information
(including an EA-provided identifier that stays the same for each opponent
across matches, so our records can link that opponent's appearances over
time)". It describes retention and linkage, not publication.

Repository check performed this session: `opponentClubId` / `eaClubId` appear
in `apps/web/src/app/page.tsx`, `apps/web/src/app/games/page.tsx`, and
`apps/web/src/app/games/[id]/page.tsx` as **lookup keys** for
`getOpponentClub()` and `getMatchSeriesContext()`. **This review did not verify
whether any raw EA identifier is rendered as visible text or exposed in a URL**
— establishing that would require rendering the pages, which is out of scope
here. Gamertags are unambiguously published and are themselves identifiers, so
the sentence is not false; it is just imprecise.

**Analysis.** A public sentence describing the site's subject matter can be
broad without being wrong, and "identifiers" is defensible on the gamertag
reading alone. The concern is that section 4's dataset bullet uses the same word
in a restriction, and a reader comparing the two may infer that the site
publishes EA-internal identifiers as such.

**Proposed resolution.** "…statistics, gamertags and related identifiers, and
related information." Alternatively, align the phrasing with the Privacy
Policy's summary sentence. Optional; state it as a precision improvement, not
a defect.

---

### T-20 · RECOMMENDATION · [INTERNAL CHECKLIST] + [GATE 3] — Q-E2G-3 (AI/TDM crawlers) should also be a numbered pre-publication blocker

**Authoritative comparison.** Q-E2G-3 is recorded only in the "Unresolved
operator and counsel questions" list, not among the twelve numbered publication
blockers. The blockers are the list a publication pass will work through.

**Analysis.** Of the four open operator questions, this is the only one whose
*current unresolved state* leaves a substantive gap in the public text rather
than merely an unmade promise. As drafted, an AI-training or TDM crawler reads
section 3 ("automated access is not prohibited as such"; "normal search-engine
indexing is permitted") and section 4 (dataset republication and disruptive
volume need permission) and lands in the permitted-by-default space, because
ingesting for model training is not obviously "republishing as a dataset."
Publishing in that state is a choice — a defensible one — but it should be a
choice made deliberately by the operator, not one that survives because it sat
in a different list.

It is also coupled to Gate 3 work: whatever the operator decides has to be
expressed both in the Terms and in the machine-readable indexing instructions
E1F has not yet implemented, and section 3 already forward-references those
instructions.

The draft's parallel to EA's own ambiguous `robots.txt` AI/TDM reservation
(E2C3 U5/LR-5) is well made and should be kept.

**Proposed resolution.** Add a numbered internal publication blocker requiring
Q-E2G-3 to be answered before publication, cross-referenced to Q-E2G-3 and to
the Gate 3 indexing implementation, and recount the blocker total by
enumeration afterwards. Keep the question itself in the questions list as well;
the blocker is the enforcement hook, not a replacement.

---

### T-21 · RECOMMENDATION · [PUBLIC TERMS] — Section 9's "without notice" sits unreconciled against section 14's notice commitment

**Exact draft passages** (lines 158–162, section 9; section 14):

> …we may change, suspend, or discontinue any part of it — or all of it — at
> any time, **without notice**.

> We may update these Terms from time to time. This page always shows the date
> it was last updated at the top, and **we will post an on-site notice when we
> make a material change**. Changes apply going forward from the date they are
> posted.

**Analysis.** These do not actually conflict — section 9 is about the *site's
availability*, section 14 about *changes to the Terms*, and section 14's
commitment traces directly to E2A decision 12. But "change … any part of it …
without notice" is broad enough on a quick read to appear to swallow section
14's promise, and the on-site material-change notice is one of the few
affirmative commitments in the document.

Section 9 is otherwise consistent with the recorded posture: "a volunteer
project running on modest infrastructure" matches E2D3 item 1's individually
operated characterization and the no-monetization decisions, and no availability
commitment exists anywhere in `HANDOFF.md` that this would contradict.

**Proposed resolution.** Optional clarifier in section 9: "This does not affect
the notice we give for material changes to these Terms — see section 14."
Purely a readability improvement; no decision is at stake.

---

### T-22 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] + [COUNSEL] — "Legitimate need to keep an accurate archival record"

**Exact draft passage** (lines 123–128, section 6):

> …you want to ask about correction, de-identification, or removal of
> information about you, please write to `webmaster@boogeymen.app`. Those
> requests are handled case-by-case, under applicable law and **our legitimate
> need to keep an accurate archival record**, through the process described in
> our Privacy Policy and Data Collection Policy. These Terms do not change,
> replace, or limit that process.

**Authoritative comparison.** The phrase is not new here. It appears verbatim in
both sibling drafts:

- `privacy-policy-draft.md:177–178` — "Correction, de-identification, or
  removal is considered case-by-case, under applicable law and **our legitimate
  need to keep an accurate archival record**."
- `data-collection-policy-draft.md:347–349` — "*Removal* is considered
  case-by-case, not automatic. Whether we remove … [depends] on **our
  legitimate need to keep an accurate archival record** of our…"

E2A decision 6: "Correction, de-identification, or removal is decided
case-by-case under applicable law and archival-integrity needs."

Both sibling documents went through independent drafting reviews (E2D2/E2D2A
and E2E2/E2E2A) and subsequent correction passes (E2D4/E2D5, E2E3). Grep across
all four planning drafts and both completed reviews shows the phrase appears
**only** in those two drafts plus this one, and **neither review raised it**.

**Assessment — does "legitimate need" risk implying a resolved lawful basis?**
On this review's reading, no, for three reasons. First, it is a plain-English
statement of *why the project wants to keep records*, not a lawful-basis label;
it is not "legitimate interests" in the GDPR Article 6(1)(f) sense, and the
sentence does not use that phrase or claim any basis. Second, it is expressly
subordinated to "under applicable law," which is the same conditional framing
E2A decision 6 uses and which reserves rather than resolves the legal question.
Third, and decisively for consistency, the surrounding sentence points the
reader to the Privacy Policy and Data Collection Policy as the governing
process, and both of those documents leave F-07/F-08 (opponent-player
publication basis) expressly UNRESOLVED — the Terms neither restate nor resolve
them, and assert no lawful basis for anything.

**Counsel routing (not a correction).** Because the identical phrase now
appears in three drafts, any counsel change to it must be applied to all three
in one pass, or the documents will diverge. Flag it that way in the internal
checklist rather than changing it now. The Terms' consistency check (internal
blocker 6) should name this phrase explicitly as one of the shared facts to
re-verify.

**Verdict: acceptable as written, consistent summary language.**

---

### T-23 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] — Opponents are expressly not treated as accepting the Terms

**Exact draft passage** (lines 28–31, section 1):

> These Terms apply to you as a visitor to this website. Appearing in the match
> information published here — for example, as an opposing player in a game we
> recorded — is not agreement to these Terms, and we do not treat it as
> agreement to them.

**Assessment.** This is the right statement, correctly scoped, and it should
survive any rewrite. It does three things well: it limits the Terms' personal
scope to visitors; it forecloses the argument that a published opponent has
somehow assented; and — importantly — it does so **without** asserting any basis
for publishing opponent data. E2D3 item 8 expressly records that no legal basis
is established for opponent-player publication and that F-07/F-08 remain
UNRESOLVED; this sentence neither fills that gap nor implies it is filled.

The only issue attached to it is the internal citation at T-18, which does not
affect the public text.

---

### T-24 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] — Age posture

**Exact draft passage** (lines 48–52, section 2):

> Membership of our club is adult-only. Some of the opponents we play against
> in matches may include minors; we do not know their ages, cannot verify them,
> and do not collect them. This site does not ask any visitor for age
> information.

**Verification against the three points the review was asked to confirm:**

1. **No visitor-age threshold was invented.** Confirmed. No minimum viewing age
   appears anywhere in the file, and no affirmative statement that no age
   requirement applies appears either — the draft deliberately says only what it
   does not do. This matches E2A decision 3 ("No under-13-specific threshold is
   introduced") and internal blocker 11.
2. **Adult-only membership is not confused with site eligibility.** Confirmed.
   The sentence is about *membership of the club*, and the visitor-facing
   sentence is a separate statement about not asking for age information. No
   sentence conditions site access on adulthood.
3. **No opponent-data lawful basis is inferred.** Confirmed. The passage states
   only what the project does not know and does not collect, matching E2A
   decision 3 and the Data Collection Policy's §11 almost word for word ("We do
   not know their ages, cannot verify them, do not collect them, and have no way
   to determine them"). The Terms drop the "have no way to determine them from
   the information EA's game services provide" clause, which is a permissible
   shortening for a summary document and asserts nothing new.

---

### T-25 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] + [COUNSEL] — Section 13 complies with E2A decision 2

**Exact draft passage** (lines 205–213, section 13):

> These Terms are governed by the laws of the Province of Alberta and the
> federal laws of Canada that apply there.
>
> We do not require you to bring any claim in a particular court. These Terms
> contain no exclusive-venue clause, no arbitration requirement, and no waiver
> of a jury trial where one would otherwise be available to you. If the law of
> the place where you live gives you mandatory rights, or access to a court or
> regulator there, this section does not take that away.

**Compliance check against E2A decision 2** ("Alberta law governs. No
exclusive-venue clause; any mandatory statutory consumer/user rights are
preserved regardless of venue or law-selection language"):

| Requirement | Status |
| --- | --- |
| Alberta law governs | ✅ stated |
| No exclusive-venue clause | ✅ absent, and expressly negated |
| Mandatory rights preserved regardless of venue/law selection | ✅ final sentence, plus the carve-outs in §§11 and 12 |
| No arbitration requirement | ✅ absent, expressly negated (E2G scope, not E2A) |
| No jury-trial waiver | ✅ absent, expressly negated (E2G scope, not E2A) |
| No indemnity | ✅ absent from the whole document |
| No liquidated damages | ✅ absent |
| No liability cap | ✅ absent; §12 carries no figure |

**Enforceability is not assessed and is not assessable here.** Whether an
Alberta choice-of-law clause binds a reader elsewhere, whether the §11/§12
carve-outs are drafted broadly enough, and whether affirmatively advertising the
absence of arbitration and jury waiver is wise are all counsel questions. They
are routed unchanged in §9 and are already reserved by internal blocker 4. The
only correction attached to this section is the citation error at T-08, which is
internal.

---

### T-26 · ACCEPTABLE AS WRITTEN · [INTERNAL CHECKLIST] — The public/internal boundary holds

See §5 for the full assessment. Summarized here for the count: no public
section points into the internal section; the only inward pointer is in the
status blockquote, which follows the identical convention already used by the
Privacy Policy and the attribution notice drafts; and the structural check the
A-01 precedent demands was performed, not just a term search.

---

### T-27 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] — Requests, not memberships

**Exact draft passage** (lines 172–175, section 10):

> Because this site has no accounts, there is nothing to suspend, cancel, or
> terminate — these measures apply to requests, not to memberships. If you
> think your access has been restricted in error, write to
> `webmaster@boogeymen.app`.

**Assessment.** Correct and well-judged. It matches the no-account posture in
section 2 and in both privacy drafts, it avoids the standard
account-termination boilerplate that would be meaningless here, and it gives a
recourse route to the correct address (E2A decision 13). "Proportionate" in the
preceding sentence is a self-imposed limit on the project's own conduct rather
than a claim about the reader, so it creates no unsupported assertion; the
review notes it and takes no issue with it. The maintenance risk is captured at
T-17, and the unsupported "automatic" clause is T-07.

---

### T-28 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] — No prohibited clause is present

**Verification method.** Case-insensitive grep of the whole file for
`arbitrat|indemnif|indemnit|jury|liquidated|exclusive|cap |venue|class action`,
then manual inspection of every hit.

**Result.** Seven hits. Line 87 is "revenue-generating" (a false positive on
`venue`). Lines 209–210 are section 13's express negations. Lines 282–283 and
390–393 are the internal blocker 4 and Q-E2G-5 statements that these clauses
must not be added — the same two locations carrying the T-08 citation error.
**No operative arbitration, indemnity, exclusive-venue, jury-waiver,
liquidated-damages, class-action-waiver, or liability-cap provision appears
anywhere in the public text**, and no liability cap figure appears anywhere in
the file. E2G's claim on this point is accurate and is independently confirmed
here.

---

### T-29 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] — Contacts

**Verification.** `grep -c 'alerts@' docs/planning/terms-of-use-draft.md`
returns **0**. `webmaster@boogeymen.app` is used for permission requests
(section 4), corrections and removal requests (section 6), rights-holder
inquiries (section 7), restriction appeals (section 10), and general contact
(section 15). `security@boogeymen.app` is used for vulnerability reports only
(sections 5 and 15).

This matches E2A decision 13 exactly, including the requirement that
`alerts@boogeymen.app` "remains internal-only and is not published as a public
contact," and matches the split used in both privacy drafts and the attribution
notice.

---

### T-30 · ACCEPTABLE AS WRITTEN · [PUBLIC TERMS] — The operator is identified without being named

**Exact draft passage** (lines 191–196, section 12):

> To the fullest extent applicable law allows, **Boogeymen and the individual
> who operates it** are not liable for any indirect, incidental, special, or
> consequential loss, or for lost data, lost profits, or loss arising from your
> reliance on information published on this site or from the site being
> unavailable.

**Assessment.** Consistent with E2A decision 1 ("No operator legal name or
postal address is published at this stage") and with E2D3 item 1's
"individually operated" characterization, which is expressly a factual
characterization and not a legal-form determination. The formulation extends the
limitation to the natural person without identifying them, which is the correct
outcome given the no-name decision.

Note for completeness, not as a defect: section 12 limits only indirect and
consequential categories and carries no cap, so direct loss is not addressed.
That is a deliberate consequence of the no-cap decision and is a counsel
question (routed in §9), not a drafting error.

---

## 5. Public/internal boundary assessment

**Verdict: the boundary holds.** No BLOCKER-class boundary defect of the A-01
kind was found. This was checked structurally as well as lexically, because
internal blocker 9 is explicit that "a forbidden *structure* passes a forbidden-
term search."

**Lexical check.** Searching the public portion of the file (everything above
the `## Internal drafting and publication checks` heading at line 232) for
`E2[A-Z]`, `Gate 2`, `Gate 3`, `blocker`, `HANDOFF`, `internal`, `below`, and
`above` returns four hits:

| Line | Text | Assessment |
| --- | --- | --- |
| 4 | "produced by an AI drafting session (E2G) against `HANDOFF.md`" | **In the status blockquote**, not in the Terms. Established convention. |
| 10 | "until the internal checks at the bottom of this file are all satisfied" | **In the status blockquote.** Established convention — see below. |
| 46 | "see 'Contact' below" | Public §2 → public §15. Public-to-public. Fine. |
| 92 | "see 'Third-party content, names, and marks' below" | Public §4 → public §7. Public-to-public. Fine. |

**The status blockquote is not a public section.** Both sibling drafts carry an
identical inward pointer in the same position:

- `privacy-policy-draft.md:6–8` — "**Do not publish, link, or route this
  document until the internal checks at the bottom of this file are all
  satisfied** and independent review by counsel is complete."
- `ea-nhl-attribution-notice-draft.md:12–14` — the same sentence, word for word.

The attribution notice survived the E2F2 review, the E2F2A correction, the E2F3
correction pass (which fixed A-01, the public-pointer blocker), and E2F4's
explicit end-to-end boundary verification with that blockquote intact. The
convention is settled: the blockquote is drafting metadata that is removed with
the internal section, and the public Terms begin at the `## Terms of Use`
heading on line 17. Internal blocker 9's own formulation — "**No public section
above** points into this section" — is satisfied.

**Structural check.** The three things A-01 taught this project to look for:

1. *A public sentence whose meaning depends on internal content.* None found.
   Every public statement is self-contained. Section 6's pointer goes to the
   Privacy Policy and Data Collection Policy (external, public documents), not
   to the internal section.
2. *A public heading or list that implies a continuation below.* None found. The
   public Terms end at section 15 (Contact), followed by a horizontal rule and
   an unambiguous internal heading — "Internal drafting and publication checks
   — not part of the public Terms."
3. *Internal narration leaking into public voice.* None found. This is the class
   of error A-05, A-08, A-13, and A-16 corrected in the attribution notice
   ("EA does not review…", "no agent independently inspected…", "we do not
   know…", "we are continuing to work on it"). The Terms carry no audit voice,
   no drafting-status narration, no missing-evidence statements, and no
   retention narration. Section 6's accuracy disclaimer is written as a plain
   caveat about data quality, not as a report on internal processes.

**One residual, tracked at T-06.** Section 7's "licensed, cleared, or used with
permission" is not a boundary *structure* problem — it does not point inward —
but it is the only place in the public text that carries vocabulary the operator
deliberately moved into an internal section of a sibling document. It is
assessed as a MATERIAL CORRECTION held for the operator rather than as a
boundary breach.

**Placeholders.** Three route tokens appear in public text —
`PLACEHOLDER-PRIVACY-POLICY-URL` (line 154),
`PLACEHOLDER-DATA-COLLECTION-POLICY-URL` (line 155), and
`PLACEHOLDER-ATTRIBUTION-NOTICE-URL` (line 146) — plus two bracketed date
placeholders (lines 19–20). All are greppable and non-resolving. **No `.md`
link and no invented route appears in public text**: every `.md` occurrence in
the file is at line 4 or lines 237–272, all inside the status blockquote or the
internal section. `grep -n 'http'` returns nothing. Verified this session that
no legal-page route exists under `apps/web/src/app` (directory listing:
`account-actions.ts`, `api`, `games`, `globals.css`, `icon.png`, `layout.tsx`,
`loading.tsx`, `page.tsx`, `preview`, `roster`, `stats`), so internal blocker
3's factual claim is correct.

---

## 6. Cross-document consistency matrix

Verified against `privacy-policy-draft.md`, `data-collection-policy-draft.md`,
`ea-nhl-attribution-notice-draft.md`, and the recorded operator decisions.

| Shared fact | Terms | Privacy Policy | Data Collection Policy | Attribution notice | Verdict |
| --- | --- | --- | --- | --- | --- |
| No monetization now or planned | §2: "no advertising, monetization, or other commercial activity on this site now, and none is planned" | line 33, same wording | recorded | §1 and footer, same wording (A-17) | ✅ verbatim across all four |
| Future-commerce review trigger | §2: "we intend to review these Terms and our privacy documents before any commercial activity begins" | — | — | — | ✅ consistent with E2D3 item 2 ("Any future commercial activity triggers a fresh privacy review"); Terms-only addition, softly worded |
| No accounts / no submissions | §2, §10 | line 39 "cannot register, log in, upload" | line 232 "no accounts can currently be created"; line 385 "does not offer user accounts or submissions at launch" | — | ✅ consistent; DCP's dormant-capability hedge is the fuller statement (see T-17) |
| Adult-only membership | §2 | line 200 | line 378 | — | ✅ verbatim posture |
| Opponent ages unknown/unverifiable/not collected | §2 | lines 201–203 | lines 381–384 | — | ✅ consistent; Terms shortens without adding |
| No visitor-age threshold | §2, silent by design | silent | line 384 "does not ask any visitor or opponent for age information" | — | ✅ E2A decision 3 respected in all |
| Archival retention posture | §6 "we generally keep past match information" | case-by-case correction/de-identification/removal | removal "considered case-by-case, not automatic" | — | ✅ |
| "Legitimate need to keep an accurate archival record" | §6 | line 178, verbatim | line 349, verbatim | — | ✅ identical phrase in all three (T-22) |
| Request process ownership | §6 explicitly points to Privacy Policy and DCP and disclaims changing them | authoritative overview | authoritative detail | — | ✅ boundary respected (E2D3 item 10) |
| `webmaster@` / `security@` split | §4, §5, §6, §7, §10, §15 | line 172, line 196 | recorded | present | ✅ E2A decision 13 |
| `alerts@` absent | 0 occurrences | absent | absent | absent | ✅ |
| Change notice | §14 on-site notice for material change + Last-updated date | lines 208–210 | lines 418–420 | — | ✅ E2A decision 12 |
| Effective/Last-updated placeholders | lines 19–20 | line 15 | line 15 | lines 20–21 | ✅ all four use placeholders (E2A decision 11) |
| Data source description | §6 "EA's NHL game services, together with our own OCR processing and manual review" | recorded | recorded | §2 "originates primarily from EA's NHL game services… our own operator-run OCR" | ✅ consistent |
| Non-affiliation | §7 single merged sentence | — | — | §1 EA's specified statement standalone + broader list | ⚠️ consistent in substance; formulation differs (T-14) |
| Third-party rights language | §7 "remain subject to the rights of their respective owners" | — | — | "subject to the rights of their respective owners" (A-14 standard) | ✅ standardized phrase used correctly |
| Factual data not claimed as property | §4 bullet body ✅ / §4 bullet heading ❌ | — | — | source-attributed, never property (A-03/A-14) | ⚠️ heading breaks it (T-03) |
| No clearance/permission claim | §7 makes none | — | — | none (E2F3 A-11, E2F4) | ✅ no positive claim in either |
| No-clearance *admission* kept internal | §7 carries "licensed, cleared, or used with permission" | — | — | removed from public text per Q-E2F2-1 | ⚠️ divergence (T-06) |
| E2C5 asset retention not reopened | internal blocker 5 preserves it verbatim | — | — | preserved | ✅ |
| E2C3 classifications | restated internally only, unchanged | — | — | unchanged | ✅ |
| Attribution audit not duplicated | §7 carries one sentence + pointer | — | — | authoritative per-family detail | ✅ boundary respected |
| Analytics | Terms silent by design (internal blocker 7) | §6 interim wording, blocker 1 | blocker 13 | — | ✅ correctly left to the privacy documents |
| Cross-reference to Terms | — | — | — | §8 `PLACEHOLDER-TERMS-OF-USE-URL`, blocker 15 | ✅ dependency correctly recorded in both directions |

**Reopened decisions: none.** E2C5, E2C3, E2C4, E2A, E2B3, E2D3, and the
Q-E2F2-1 decision are all left intact by the draft. The one place the draft
touches Q-E2F2-1's territory is §7 (T-06), and it does so by reusing vocabulary,
not by reopening the decision.

---

## 7. Direct answers to the seventeen concerns

**1. Dataset republication threshold — YES, it narrows the operator decision.**
E2A decision 4 requires permission for "dataset republication" with no
qualifier. "In whole or in substantial part" creates a threshold below which
dataset republication requires nothing, and nothing else in the draft picks up
the remainder. The qualifier is also redundant: the bullet's form list
("dataset, data feed, API, database, mirror, or comparable bulk compilation")
already excludes a quoted stat line, which appears to be what the qualifier was
protecting. **Delete it.** See T-02.

**2. Section 4 versus section 5 — YES, the draft implies Boogeymen might
authorize bypass and disruption, and this is the review's single BLOCKER.**
Section 4's lead-in is "please ask us before you do any of the following," and
its first bullet covers both degrading/overloading the site and working around
rate limits or other protective measures — both of which section 5 prohibits
outright in near-identical verbs. **Precise correction boundary: volume is
permission-required; disruption and evasion are prohibited, full stop.** Section
4 should restrict high-volume bulk automated collection and expressly say that
conduct which actually degrades the site or circumvents a protective measure is
not available on request, cross-referencing section 5. Do not fix it by
softening section 5. See T-01.

**3. Personal-copy permission — four sub-answers.**
- *Does it exceed "personal/noncommercial viewing"?* On a strict reading, yes —
  saving and screenshotting are reproductions, not viewing. On an ordinary
  reading the extension is trivial and sensible. Either way it is a grant the
  operator has not recorded, so **ratify it rather than assume it** (T-11,
  Q-E2G2-2).
- *Does it need qualification for third-party material?* **Yes.** Section 4's
  "only the material we are actually in a position to permit" limiter is
  textually confined to section 4, and a screenshot of this site necessarily
  reproduces material in E2C3's three unresolved classifications. Add a
  one-sentence carve-out to section 3 (T-05).
- *Does it conflict with section 7 or the attribution notice?* **No flat
  conflict.** Section 7's "nothing in these Terms grants you any rights in that
  material" does cover section 3, and the attribution notice makes no
  inconsistent statement. The problem is placement and salience, not
  contradiction — which is why the fix is a cross-reference rather than a
  rewrite.
- *Should linking be treated separately from copying?* **Yes.** Grammatically it
  already is, but sharing a sentence with the personal-copy grant invites the
  personal/noncommercial qualifier to be read across the conjunction, which
  would restrict commercial linking — something no decision contemplates (T-12).

**4. Third-party permission conclusion — YES, it is an unsupported
legal-capacity conclusion, and yes, it should be restated as a scope
limitation.** "We cannot give you permission for third-party material" is
structurally identical to the "EA's own materials cannot grant…" formulation
that A-06 required be removed, with the capacity claim pointed at Boogeymen
instead of EA. It is also not categorically verifiable: the project has not
completed the provenance work (E2A decision 9; attribution blockers 2, 6, 7, 8)
that would establish which third-party material it might or might not be able to
sublicense. The preceding sentence already carries the correct, hedged register.
**Replace with: "Our permission is ours alone: it is not permission from anyone
else who holds rights in material appearing on this site."** See T-04.

**5. Public no-clearance wording — the honest answer is "both, and it should be
narrowed."** In *form* it is a proper document-scope disclaimer: "nothing in
these Terms … states that any particular material is licensed, cleared, or used
with permission" describes the document, not the material, and is a different
sentence from the affirmative "we do not claim it is cleared" that Q-E2F2-1
removed. In *substance* it reproduces the removed phrase almost verbatim
("licensed, in the public domain, legally cleared, or used with permission" →
"licensed, cleared, or used with permission"), in a public document that will
be read alongside the notice, and a reader takes the same practical inference
from it. This review does not treat that as settled by the operator's earlier
answer, because the operator answered a question about the notice, not about the
Terms. **Determination: it sits on the line, the cost of removing it is zero,
and the operator should decide.** The recommended resolution keeps "nothing in
these Terms grants you any rights in that material" and drops the clearance
half — which preserves every protective function of the sentence and removes the
divergence. Held as Q-E2G2-1. See T-06.

**6. Dataset ownership implication — the heading is the problem; the body is
fine; "information published on this site" is safer; and section 4 does remain
framed as site-use terms.** The bullet body's "information published here" is
correctly locational, and section 4 as a whole restricts visitor conduct rather
than asserting rights — internal blocker 10 states that intent and the text
delivers it. The heading "Republishing **our** information as a dataset" is the
single possessive, and it collides directly with the A-03/A-14 rule that factual
match and statistical data is source-attributed rather than owned. Use
"Republishing information from this site as a dataset" or "Republishing
information published on this site as a dataset." See T-03.

**7. Automatic enforcement claim — NOT established, and the distinction
matters.**
- *Verified current configuration:* E2B2's operator-read Cloudflare dashboard
  records **Rate-limiting rules: 0 of 1**, **Custom rules: 0 of 5**, **Bot Fight
  Mode Off**. The application has no `middleware.ts` and no inbound rate
  limiter; the only `throttle` in the codebase is the outbound EA API delay in
  `packages/ea-client/src/client.ts`. The single automatic mechanism in the
  record is Cloudflare's **Free Managed Ruleset**, described as
  "always-active/default protection," whose actions were not recorded. The site
  is also unpublished and the tunnel is offline, so nothing is currently
  operating on public traffic at all.
- *Technical capability:* the Cloudflare Free plan offers one rate-limiting rule
  and five custom rules. Capability exists; nothing is deployed.
- *Possible future behavior:* any of this could change at Gate 3; no decision to
  do so is recorded.

**No automatic rate limiter was inferred from zero configured rules — the
opposite conclusion was drawn.** Because section 10 lists rate-limiting first
and then says "some of these are automatic," the sentence points at the one
measure the evidence excludes. Restate as capability ("may be applied
automatically by the network and hosting services we use") or delete. See T-07.

**8. Archival/legal-basis wording — consistent summary language; ACCEPTABLE.**
"Our legitimate need to keep an accurate archival record" is not new drafting:
it appears verbatim at `privacy-policy-draft.md:178` and
`data-collection-policy-draft.md:349`, both of which have been through
independent drafting reviews that did not flag it. It tracks E2A decision 6
("case-by-case under applicable law and archival-integrity needs"), it is
expressly subordinated to "under applicable law," and it is a plain-English
statement of motive rather than a lawful-basis label — it does not use, and
should not be read as, GDPR-style "legitimate interests." F-07/F-08 remain
untouched: the Terms assert no basis for opponent-player publication. The one
follow-up is procedural — the phrase now appears in three drafts, so any counsel
change to it must be applied to all three in one pass. See T-22.

**9. Incorrect E2A citation — confirmed, three affected locations.** E2A
decision 6 is **"Request outcomes"**; the governing-law and no-exclusive-venue
instructions are **E2A decision 2 ("Governing terms")**. Arbitration, jury-trial
waiver, indemnity, liquidated damages, and a liability cap are addressed by **no
E2A decision at all** — their exclusion rests on the operator's E2G session-scope
instruction. Affected locations:

| # | Location | Current text | Correct attribution |
| --- | --- | --- | --- |
| 1 | `terms-of-use-draft.md`, internal blocker 4 (lines 281–284) | "per E2A decision 6, no arbitration clause, exclusive-venue clause…" | E2A decision 2 for governing law + no exclusive venue; E2G session scope for the rest |
| 2 | `terms-of-use-draft.md`, Q-E2G-5 (lines 389–393) | "per E2A decision 6 and the operator's E2G instructions" | same split, made explicit |
| 3 | `HANDOFF.md`, E2G entry, "Deliberately absent" paragraph | "per E2A decision 6 and this session's scope" | same split |

The draft's revision-provenance list (line 237, "E2A decisions 1–4, 6, 7, 11,
12, 13") is **correct** and should not be changed — decision 6 genuinely
underpins section 6. **Do not rewrite history:** locations 1 and 2 are in a
working draft and can be corrected in the next revision pass; location 3 is a
historical HANDOFF entry and must be corrected additively in E2G2, following the
E2E3/P-17 precedent exactly. See T-08, T-09.

**10. Incorrect review-status statement — confirmed.** The Privacy Policy
(E2E2/E2E2A, corrected at E2E3), the Data Collection Policy (E2D2/E2D2A, revised
at E2D4, polished at E2D5), and the attribution notice (E2F2/E2F2A, corrected at
E2F3, accepted as a drafting-quality checkpoint at E2F4) each had an independent
drafting review. The exact correction is **"zero legally reviewed or publishable
ones"**, plus a sentence recording that three of the four have had independent
drafting reviews and that the Terms had none until E2G2. The draft's own
internal blocker 1 already states this correctly; only E2G's Status line is
wrong, and it is self-inconsistent with the rest of the same entry. See T-10.

**11. Acceptance and change mechanics — issue-spotted, not decided.** No
enforceability conclusion is offered. Three drafting observations: (a) "please
do not use the site" states a courtesy where browse-wrap normally states a
condition, and the register mismatch invites the reading that using the site
while disagreeing is merely impolite; (b) the acceptance sentence precedes any
account of how a visitor encounters the Terms, and notice/conspicuousness turns
on the Gate 3 routing decision that is still open (Q-E2E2-1, Q-E2G-1), so the
internal checklist should link blocker 12 to blocker 3; (c) section 14 does
**not** state that continued use constitutes acceptance of changes — that
omission is protective, and this review does not recommend adding one, but
counsel should know it is deliberate. Internal blocker 12 correctly reserves the
whole area. See T-16.

**12. Availability and access restrictions.**
- *Discontinuation "at any time, without notice"* — no operator decision
  contradicted, consistent with the volunteer/modest-infrastructure posture; the
  only issue is that it reads as though it might swallow section 14's
  material-change notice, which an optional clause would fix (T-21).
- *Restriction of requests rather than accounts* — correct and well-judged;
  matches the no-account posture across all documents (T-27).
- *"Proportionate"* — a self-imposed limit on the project's own conduct, not a
  claim about the reader or about deployed capability. Acceptable as written; no
  correction proposed.
- *Unsupported claims about automatic enforcement* — the one defect in section
  10 (T-07).
- *Consistency with the no-active-account posture* — consistent today. The
  maintenance risk is that sections 2 and 10 both go stale if the dormant
  authentication feature is activated; the Data Collection Policy's
  fresh-review commitment currently names only the privacy documents, so add
  the Terms to it (T-17).

**13. Age and affected opponents — all four confirmed.** No visitor-age
threshold was invented and none is implied; adult-only membership is stated as a
club-membership fact and is never converted into a site-eligibility condition;
section 1 expressly states that appearing in match records is not agreement to
the Terms and that the project does not treat it as agreement; and no lawful
basis for opponent data is asserted or implied anywhere — F-07/F-08 are neither
relied on nor resolved. See T-23, T-24.

**14. Indexing and automated access — confirmed, with two precision points.**
"**Normal search-engine indexing is permitted**" is present as a bolded
standalone statement (line 60), and "Automated access is not prohibited as such"
(line 66) forecloses any blanket automation ban — both matching E2A decision 4.
The conditional reference to machine-readable indexing instructions is correctly
hedged ("**Where** we publish…"), which is the right posture given that no
`robots.txt` and no sitemap exist under `apps/web` (verified this session) and
E1F's indexing policy is decided but unimplemented. It also correctly treats
robots directives as a request rather than authorization, matching E1F's
reaffirmed boundary. Two precision gaps: "this site's public pages" is broader
than the set E1F intends to be indexed (`/preview/*` is public and expressly
excluded, and still present in the route tree), and "sort" is not one of E1F's
seven named query variants. See T-13. Separately, the treatment of AI/TDM
crawlers is genuinely unresolved and should be promoted to a numbered blocker
(T-20).

**15. Warranties, liability, and governing law — internally consistent and
compliant with every operator decision checked; enforceability not assessed.**
Alberta law ✅; no exclusive venue ✅ (absent and expressly negated); mandatory
rights preserved ✅ (sections 11, 12, and 13 all carry carve-outs); no
arbitration, indemnity, jury waiver, liquidated damages, or liability cap ✅
(grep-verified, T-28). Two drafting notes: section 11's "beyond what is stated
in these Terms" implies warranties that do not exist (T-15), and section 12
addresses only indirect/consequential categories, leaving direct loss unlimited
— a deliberate consequence of the no-cap decision, routed to counsel rather than
treated as a defect (T-30). All enforceability questions are routed to counsel
in §9 and none is answered here.

**16. Cross-document boundary — all seven checks pass.**

| Check | Result |
| --- | --- |
| Does not replace privacy/data request mechanics | ✅ §6: "through the process described in our Privacy Policy and Data Collection Policy. These Terms do not change, replace, or limit that process." §8: "Those documents govern that subject, and these Terms do not change or replace them." |
| Does not duplicate the attribution audit | ✅ §7 carries one non-affiliation sentence plus a pointer; no per-family attribution, no audit history |
| Does not reopen E2C5 | ✅ internal blocker 5 preserves it verbatim; no asset statement anywhere in public text |
| Does not claim asset clearance | ✅ no permission, licence, fair-use, endorsement, or clearance claim (the residual issue at T-06 is an *admission*, not a claim) |
| Uses only route placeholders | ✅ three greppable tokens, two date placeholders, no `.md` link and no `http` anywhere in public text; no legal route exists to invent |
| No public pointer into the internal section | ✅ structural and lexical checks both pass — see §5 |
| Does not publish `alerts@boogeymen.app` | ✅ zero occurrences in the file |

**17. Operator questions — all four are genuine; none blocks the drafting
checkpoint.**

| Question | Genuine operator question? | Blocks the drafting checkpoint? | Assessment |
| --- | --- | --- | --- |
| Q-E2G-2 — response timing for reuse-permission requests | **Yes.** Extending the approved 7-day/30-day targets to a new request category is a new commitment only the operator can make | **No** | The draft promises nothing, which is the correct default. A permission-request address with no stated turnaround is ordinary. Can remain unresolved indefinitely; it is a completeness improvement, not a gap. |
| Q-E2G-3 — AI/TDM crawler treatment | **Yes**, and it is the most consequential of the four; it is also part counsel | **No, but it should block publication** | Left as drafted, AI/TDM crawlers fall into a permitted-by-default gap: §3 permits automated access as such, and training ingestion is not obviously "republishing as a dataset." That may be the operator's preferred outcome, but it should be chosen, not defaulted into. It is coupled to the Gate 3 indexing implementation (E1F), which is unbuilt. **Promote to a numbered publication blocker (T-20).** The parallel to EA's ambiguous `robots.txt` reservation (E2C3 U5/LR-5) is apt and should be kept. |
| Q-E2G-4 — noncommercial community sharing | **Yes** | **No** | Worth flagging that the current default is *narrower* than the project's evident purpose: a screenshot permitted "for your own personal, noncommercial use" arguably does not cover posting it in the team Discord or quoting a stat line on a forum. For a community team site, that is probably not intended. Best answered together with Q-E2G2-2 (T-11), since both concern the scope of §3's grant. |
| Q-E2G-1 — routing | **Yes**, but it is a Gate 3 decision, not a legal one | **No** for the checkpoint; **yes** for publication | Already correctly tracked as internal blocker 3 and cross-referenced to Q-E2E2-1 and the notice's blockers 9 and 15. Nothing to add. |

---

## 8. Operator questions

Two new questions arise from this review. Neither is answered here.

**Q-E2G2-1 (operator) — Does the Q-E2F2-1 decision extend to section 7 of the
Terms?** The operator decided at E2F3 to move express no-permission,
no-clearance, and missing-evidence statements out of the attribution notice's
public text. Section 7 of the Terms carries "nothing in these Terms grants you
any rights in that material **or states that any particular material is
licensed, cleared, or used with permission**." That is a document-scope
disclaimer in form, but it reuses the removed vocabulary in a public document
that will be read alongside the notice. Options: **(a)** delete the clearance
half and keep "nothing in these Terms grants you any rights in that material"
(this review's recommendation — it costs nothing and aligns the two documents);
**(b)** keep the full clause and record it as a deliberate extension of
Q-E2F2-1 to the Terms, so a later session does not remove it as drift. See T-06.

**Q-E2G2-2 (operator) — Ratify or narrow section 3's personal-copy
permission?** E2A decision 4 permits "personal/noncommercial viewing." Section 3
also permits saved pages, screenshots, and quoted results. Options: **(a)**
ratify the extension and record it as such in the draft's revision provenance
(this review's expectation — the extension is small and sensible); **(b)**
narrow section 3 to viewing and linking only. Best answered together with the
operator's existing Q-E2G-4 on community sharing, since both define the outer
edge of the same grant. See T-11.

**Carried forward from E2G, unresolved and not answered here:** Q-E2G-1
(routing), Q-E2G-2 (reuse-request response targets), Q-E2G-3 (AI/TDM crawlers —
this review recommends promoting it to a numbered blocker), Q-E2G-4
(noncommercial community sharing). Assessments in §7 concern 17.

---

## 9. Counsel-only questions

Routed, not answered. This review makes no legal determination.

**New from this review:**

- **Q-C-E2G2-1.** Section 4's third-party permission sentence is being corrected
  from a capacity claim ("we cannot give you permission") to a scope limitation
  ("our permission is ours alone"), mirroring A-06's treatment of the parallel
  EA sentence. Does counsel want the stronger capacity formulation in either
  document, both, or neither? This should move together with the attribution
  notice's open **Q-C-2**. See T-04.
- **Q-C-E2G2-2.** Section 12 limits indirect and consequential loss and carries
  no cap, so direct loss is unaddressed. Is that the intended posture given the
  operator's exclusion of a liability cap? See T-30.
- **Q-C-E2G2-3.** "Our legitimate need to keep an accurate archival record" now
  appears verbatim in three drafts. If counsel wants it changed, it must be
  changed in all three in a single pass. Does the phrasing carry any unintended
  lawful-basis implication in any jurisdiction where a reader may be located?
  See T-22.

**Already reserved by the draft's internal blockers, and unchanged:**

- Enforceability and mis-scoping of sections 11, 12, and 13 against mandatory
  consumer-protection law in a reader's own jurisdiction (blocker 4).
- Whether section 4's reuse restrictions are properly characterized as
  contractual site-use terms rather than an assertion of rights in the
  underlying data, and whether "disruptive" volume is a workable standard with
  no published rate limit (blocker 10).
- Whether a visitor-age threshold is required (blocker 11).
- Browse-wrap acceptance and change mechanics (blocker 12; see T-16).
- Whether any excluded provision — indemnity, arbitration, exclusive venue,
  liquidated damages, a liability cap — should be added (Q-E2G-5, with the
  citation corrected per T-08).

**Carried from the other drafts, untouched, unresolved, and neither relied on
nor contradicted by the Terms:** applicable-law characterization (E2D2A
F-01/F-02); opponent-player publication basis (F-07/F-08); recording law across
Alberta, Ontario, and Massachusetts (F-30); provider processor/controller
classification (F-24); whether a cookie-consent banner is required; and the
attribution notice's Q-C-1 through Q-C-4.

---

## 10. Exact corrections required before checkpoint acceptance

**Eleven corrections are required: T-01 through T-11.** Nine are mechanical;
two are held for an operator answer.

**Mechanical — apply in the next Terms revision session (9):**

1. **T-01 (BLOCKER)** — Rewrite section 4's first bullet so that permission is
   required for high-volume bulk automated collection only, and disruption and
   circumvention are stated to be prohibited outright with a cross-reference to
   section 5. Do not soften section 5.
2. **T-02** — Delete "— in whole or in substantial part —" from section 4's
   dataset bullet.
3. **T-03** — Change the dataset bullet's heading from "Republishing our
   information as a dataset" to "Republishing information from this site as a
   dataset."
4. **T-04** — Replace "We cannot give you permission for third-party material"
   with "Our permission is ours alone: it is not permission from anyone else who
   holds rights in material appearing on this site."
5. **T-05** — Add a third-party carve-out sentence to section 3, with a
   public-to-public pointer to section 7.
6. **T-07** — Restate or delete "Some of these measures are automatic." If
   restated, use capability wording covering the network and hosting services,
   and add an internal checklist item requiring re-verification against the
   deployed Cloudflare configuration before publication.
7. **T-08** — Correct the E2A citation in internal blocker 4 and in Q-E2G-5:
   E2A decision 2 for governing law and no exclusive venue; the operator's E2G
   session-scope instruction for arbitration, jury waiver, indemnity,
   liquidated damages, and a liability cap; no E2A decision covers the latter
   group.
8. **T-09** — Record the same citation correction for the `HANDOFF.md` E2G entry
   **additively in E2G2**. Do not rewrite E2G.
9. **T-10** — Record the review-status correction ("zero **legally reviewed** or
   publishable ones," plus the three-of-four drafting-review history)
   **additively in E2G2**. Do not rewrite E2G.

**Held for an operator answer (2):**

10. **T-06** — Held for Q-E2G2-1. Recommended: delete "or states that any
    particular material is licensed, cleared, or used with permission" from
    section 7.
11. **T-11** — Held for Q-E2G2-2. Recommended: ratify the personal-copy
    permission and record it in the draft's revision provenance as an
    operator-ratified extension of E2A decision 4.

**After applying any of these, recount the internal publication blockers by
enumeration rather than assuming the total.** T-07, T-13, T-17, and T-20 each
propose an internal checklist addition; the current count is twelve.

---

## 11. Optional recommendations

Not required for checkpoint acceptance. T-12 through T-21, summarized:

- **T-12** — Give linking its own unqualified sentence in section 3.
- **T-13** — Narrow "this site's public pages" to the pages actually made
  available for indexing; drop "sort" from the query-variant list; add a Gate 3
  re-verification item.
- **T-14** — Resolve the non-affiliation formulation: either carry EA's
  specified sentence verbatim and separately, or make the Terms' sentence
  clearly the project's own generic statement.
- **T-15** — "…and we make no other warranties or representations about it."
- **T-16** — "Do not use the site" rather than "please do not use the site";
  link internal blocker 12 to blocker 3 (routing).
- **T-17** — Internal checklist: revise sections 2 and 10 if authentication is
  ever activated.
- **T-18** — Reword internal blocker 12's "(E2A decision 3 / E2D3 item 8
  posture)" parenthetical to describe the relationship accurately.
- **T-19** — "gamertags and related identifiers" in section 2.
- **T-20** — Promote Q-E2G-3 (AI/TDM crawlers) to a numbered publication
  blocker.
- **T-21** — Optional clause in section 9 preserving section 14's change notice.

---

## 12. Recommended next single session

**E2G3 — apply the nine mechanical corrections to
`docs/planning/terms-of-use-draft.md` only.**

Scope: T-01 through T-05 and T-07 in the public text; T-08 in the internal
checklist; T-09 and T-10 are HANDOFF corrections already recorded additively by
this session's E2G2 entry and need no further action in E2G3. Hold T-06 and
T-11 for the operator's answers to Q-E2G2-1 and Q-E2G2-2, exactly as E2F3 held
A-07 and A-11 for Q-E2F2-1. Bundle the optional items T-12 through T-21 only if
the operator asks; otherwise leave them for a later polish pass in the shape of
E2F4.

Recount the publication blockers by enumeration afterwards. Do not revise any
other draft, do not resolve any public route, do not check a Gate 2 checkbox, do
not reopen E2C5 or any E2C3/E2C4 classification, do not conduct external legal
research, and do not reopen the tunnel.

If the operator prefers to answer Q-E2G2-1 and Q-E2G2-2 first, that is a
decision-recording session and should not be combined with the revision pass.

---

## 13. Verification and scope limits

**What was read in full.**

- `docs/planning/terms-of-use-draft.md` — all 442 lines, public sections 1–15,
  the status blockquote, and the entire internal section.
- `AGENTS.md` — complete.
- `HANDOFF.md` — E2A (all fourteen decisions and the four factual corrections),
  E2B2, E2B3 (partial), E2C5, E2D3 (all fourteen items), E2E3, E2F2A, E2F3,
  E2F4, E2G, E1F, and the Gate 2 "Privacy, data collection, and legal drafts"
  checklist.
- `docs/planning/ea-nhl-attribution-notice-review.md` — findings A-03 and A-06
  in full, plus the index, count tables, and required-correction lists.
- `docs/planning/ea-nhl-attribution-notice-draft.md` — public §1, §2, and the
  footer drafting component; targeted reads elsewhere.
- `docs/planning/privacy-policy-draft.md` and
  `docs/planning/data-collection-policy-draft.md` — the status blockquotes and
  every passage carrying a fact shared with the Terms (targeted, grep-driven
  reads, not end-to-end).
- This review, read back in full after writing.

**Repository facts verified this session.**

- No `middleware.ts` at `apps/web/middleware.ts` or `apps/web/src/middleware.ts`.
- Every `throttle` symbol in the workspace is the outbound EA API delay
  (`packages/ea-client/src/client.ts:124`, `EA_REQUEST_DELAY_MS`); no inbound
  rate limiter exists in `apps/web`, `apps/worker`, `packages/*`, or
  `docker-compose.yml`.
- No legal-page route exists: `apps/web/src/app` contains
  `account-actions.ts`, `api`, `games`, `globals.css`, `icon.png`, `layout.tsx`,
  `loading.tsx`, `page.tsx`, `preview`, `roster`, `stats`. No file matching
  `*terms*`, `*privacy*`, or `*legal*`.
- No `robots.txt` and no sitemap file exist under `apps/web`.
- `/preview` is still present in the route tree (E1F approved removal; not done).
- `opponentClubId` / `eaClubId` appear in `apps/web/src/app/page.tsx`,
  `games/page.tsx`, and `games/[id]/page.tsx` as lookup keys.
- `grep -c 'alerts@'` on the Terms draft returns 0.
- Grep for `arbitrat|indemnif|indemnit|jury|liquidated|exclusive|cap |venue|class action`
  returns seven hits, all inspected: one false positive, two express negations
  in §13, four internal-section prohibitions.
- Gate 2 line 152, "Draft the Terms of Use.", confirmed still `- [ ]`; no other
  Gate 2 checkbox inspected as changed.

**Scope limits — what this review did NOT do.**

- **No legal advice, no legal review, no legal clearance.** Every enforceability
  question is routed to counsel and left open. No conclusion is drawn about
  whether any clause is valid, whether any use is permitted by law, whether any
  asset is cleared, or whether any lawful basis exists.
- **No external research.** No website, provider, account, host, database, EA
  page, Cloudflare dashboard, Proton account, or GitHub API was accessed. All
  provider facts come from `HANDOFF.md`'s recorded operator-attested evidence.
- **No rendering verification.** Whether any raw EA identifier is displayed as
  visible text or appears in a URL was not determined (T-19); doing so would
  require running the application.
- **No end-to-end read of the privacy and data-collection drafts.** Those were
  read by targeted, grep-driven passages for the shared facts in §6's matrix.
  A full four-way consistency read remains the draft's own internal blocker 6
  and is a pre-publication task.
- **Provider evidence is second-hand.** E2B2's Cloudflare and Proton settings
  are operator-attested dashboard readings from 2026-09-08, not independently
  verified, and may have changed. T-07's correction should be re-verified
  against the deployed configuration at Gate 3.
- **No file was modified except this new review and one additive `HANDOFF.md`
  entry.** `docs/planning/terms-of-use-draft.md` is byte-for-byte unchanged. No
  Gate 2 checkbox changed. E2C5, E2C3, E2C4, and every operator decision remain
  unreopened. Nothing was staged, committed, pushed, published, or deployed.
  Tunnel reopening remains separately unauthorized. **E2 remains IN PROGRESS.**
