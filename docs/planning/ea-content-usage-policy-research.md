# EA Content-Usage Policy Research — E2C3

**Scope.** EA-controlled asset sources only, as used by this site: the 84 NHL 26
X-Factor PNGs under `apps/web/public/assets/x-factors/`, the EA-hosted opponent
crest images referenced from `media.contentapi.ea.com`, and the acquisition
history recorded by `scripts/scrape_ea_xfactor_pngs.sh`.

**Date of research:** 2026-09-09. All accessed dates below are 2026-09-09.
Provider policies change; re-verify before relying on this memo.

**Method.** Official EA-controlled sources only (`ea.com`, `help.ea.com`,
`tos.ea.com`). No EA account was accessed, no form submitted, no message sent,
no agreement accepted, no EA API called, and no asset file downloaded during
this research. Search-engine results were used only for discovery; every relied-
upon claim below was verified by reading the official page itself.

**This memo is research, not legal advice.** It does not clear any asset, does
not finalize attribution, drafts no legal language, and checks no Gate 2
checkbox. It advances — it does not complete — E2A decision 9.

**Standing rules preserved.** No fair-use, nominal-use, licence, or permission
assumption is made. Silence in EA's published text is recorded as silence, never
as permission. Public accessibility of an image is not treated as permission to
copy it. Attribution wording and non-affiliation wording are treated as
*conditions*, never as *permission*.

---

## 1. Verified repository facts (checked this session, 2026-09-09)

| Fact | Verification |
| --- | --- |
| 84 X-Factor PNGs present | `find apps/web/public/assets/x-factors -name '*.png' \| wc -l` → **84**, across **28** per-X-Factor folders (3 tier variants each) |
| Scraper identifies EA hub + CDN sources | `scripts/scrape_ea_xfactor_pngs.sh` sets `HUB='https://www.ea.com/games/nhl/nhl-26/nhl26-x-factors-hub'`, crawls 28 hard-coded detail-page slugs with a spoofed desktop-Firefox `User-Agent`, greps `drop-assets.ea.com/images/...` PNG URLs out of the server-rendered HTML, deduplicates, and `curl`-downloads each into `apps/web/public/assets/x-factors/<Name>/` |
| Crest component uses `next/image` | `apps/web/src/components/ui/opponent-crest.tsx` imports `Image` from `next/image`; no `unoptimized` prop |
| Two EA crest paths constructed | `apps/web/src/lib/format.ts:161-162` — base `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t<id>.png`, custom `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/custom-crests/<id>.png`; order flips on `useBaseAsset === '1'` |
| `next.config.ts` permits exactly those paths | `images.remotePatterns` allows `media.contentapi.ea.com` under `/content/dam/eacom/nhl/pro-clubs/custom-crests/**` and `/content/dam/eacom/nhl/pro-clubs/crests/**`; no custom loader, no `loaderFile` |
| No EA permission on record | E2C2 operator attestations 3 and 6: **none known** — no direct EA permission, no creator-program permission, no correspondence, no previously reviewed EA content-usage-policy basis, for either the X-Factor images or the crests |

**Material consequence of the `next/image` fact.** The repository configures
default Next.js image optimization for the crest paths (production runs
`next start`, `apps/web/Dockerfile:43`, and `next.config.ts` permits the two
crest `remotePatterns` with no `unoptimized` prop and no custom loader). Default
Next.js image optimization normally fetches and serves remote images through
the site, and may resize, transcode, or cache them. **Deployed behavior was not
runtime-tested in this session.** Whether that behavior legally constitutes
copying, modification, or distribution under S2 §2 is a legal-review question
(see LR-3), not a conclusion this memo draws. Every analysis below treats it as
unresolved.

---

## 2. Official-source matrix

| ID | Exact title | Direct URL | Publisher | Effective / last updated | Document type | Supports |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | EA's content policy | https://help.ea.com/en/articles/security-and-rules/ea-content-policy/ | Electronic Arts (EA Help) | `lastUpdated` metadata **2026-08-03**; page label "Updated 1 month ago" | **Published policy statement delivered as help content.** Not listed among the documents incorporated by reference into the User Agreement | A (scope), B (third-party), C (conditions), D (data mining), E |
| S2 | ELECTRONIC ARTS USER AGREEMENT | https://www.ea.com/legal/user-agreement | Electronic Arts Inc. | **Last Updated: May 14, 2026** | **Contractual terms.** Same document is served at `https://tos.ea.com/legalapp/WEBTERMS/US/en/PC/` and `https://terms.ea.com/` redirects to it — i.e. EA has no separate website terms of use | A, B, C, D, E |
| S3 | Legal - Official EA Site (Legal & Privacy hub) | https://www.ea.com/legal | Electronic Arts | none displayed | Index page | Official EA legal index searched during this research; not proof that no other EA or game-specific terms exist |
| S4 | Legal Disclosures | https://www.ea.com/legal/legal-disclosures | Electronic Arts | none displayed | Disclosures | B (searched for NHL/NHLPA licensor notices — none found) |
| S5 | `www.ea.com/robots.txt` | https://www.ea.com/robots.txt | Electronic Arts Inc. | none displayed | **Machine-readable crawler-access file carrying a unilateral reservation-of-rights statement in comments.** Not contractual terms | D (acquisition method) |
| S6 | NHL 26 X-Factors Hub | https://www.ea.com/games/nhl/nhl-26/nhl26-x-factors-hub | Electronic Arts | none displayed | Marketing page — the scrape target | Asset identification; footer notices |
| S7 | EA SPORTS™ NHL 26 Legal Disclaimers | https://www.ea.com/games/nhl/nhl-26/game-disclaimers | Electronic Arts | none displayed | Promotional-offer disclaimers | B (searched for NHL/NHLPA trademark notice — none found) |
| S8 | NHL 26 Pro Clubs | https://www.ea.com/games/nhl/nhl-26/pro-clubs | Electronic Arts | none displayed | Marketing page — **this URL currently redirects to the NHL 27 Pro Clubs page**, so it did not establish an NHL-26-specific crest mechanism | B (searched for an official description of the crest-creation mechanic — none found; the redirect means no NHL 26-specific page was actually reviewed) |

### Sources sought and unavailable — recorded, not substituted

- **`legal.ea.com`** — does not resolve (`getaddrinfo ENOTFOUND`). EA's legal
  documents live under `www.ea.com/legal`, `tos.ea.com`, and `help.ea.com`.
- **`https://drop-assets.ea.com/robots.txt`** — HTTP **503**, Akamai "Service
  Unavailable - DNS failure", on two attempts. **The published crawler policy of
  the CDN host the 84 PNGs were actually downloaded from could not be read.**
  This is a real evidentiary gap for section 5 below.
- **`https://media.contentapi.ea.com/robots.txt`** — HTTP **404**. No robots
  policy is published for the crest CDN host.
- **`https://help.ea.com/in/help/faq/how-to-request-permission-for-ea-games-content/`**
  ("How to use EA content under EA's IP Policy") — resolves with HTTP 200 to a
  final URL of **S1**. EA's "IP Policy" and its "content policy" are therefore
  the same document; there is no separate, more permissive IP policy.
- **An NHL/NHLPA trademark or licensor attribution notice on any EA legal page**
  — searched S4, S6, S7 and the NHL 26 game landing page. Not found. The NHL 26
  pages carry NHL-shield and NHLPA logos in the footer linking to `nhl.com` and
  `nhlpa.com`, which evidences third-party licensors in the product, but EA
  publishes no textual notice there defining what those licensors' rights cover.

No unofficial summary, forum post, law-firm article, archived third-party copy,
or search snippet is relied on anywhere in this memo.

---

## 3. Exact policy findings

### 3.1 S1 — EA's content policy (help content, updated 2026-08-03)

Scope of the permission:

> "Our fans can use our game content, including gameplay and original
> characters, for personal uses or personal projects, including fan sites and
> videos, as long as they follow these principles:"

Commercial limits:

> "**Don't sell your content.** Don't use our game content for commercial
> purposes. This means don't sell your fan art or merchandise with our game
> content, or put your fansite, videos, or other content behind paywalls like
> Patreon."
>
> "**Exception:** Passive advertising, the monetization of videos via partner
> programs (like YouTube or Twitch), or the monetization of fan sites via
> passive banner ads is allowed."

Conduct conditions, including the data-mining clause:

> "**Follow the rules.** Don't use our games to engage in or promote conduct
> that's prohibited under our User Agreement or Positive Play Charter. For
> example, don't show hacks or cheats, promote the sale of in-game currency,
> display offensive or inappropriate content, obtain assets through 'data
> mining', or distribute our games and content on file-sharing websites or
> torrents."

Endorsement and branding conditions:

> "**Don't imply endorsement or affiliation.** Don't use our brands, studios, or
> games to make it seem like your project is endorsed by or affiliated with us
> including, for example, by using our logos or game art on your website. If you
> have a website or other location where you're displaying our game content,
> include the following statement: 'This [project/website] is not endorsed by or
> affiliated with EA or its licensors.'"
>
> "**Don't merge our brand with yours.** Our company, studio and game logos
> should not be combined with your own branding."
>
> "**Be original.** … Don't combine our game content with other third-party
> products, services, or brands."

Third-party exclusion — the single most important sentence in this memo:

> "**Don't use licensed content.** Many of our games include content that we
> license from third parties or that may otherwise have usage restrictions (for
> example, talent, brands, voices, music). Those third parties may have their
> own guidelines for how you can use their content. **We do not provide you with
> any permission to use third-party content from our games. You use our game
> content at your own risk.**"

Fair use — EA declines to opine:

> "**Fair use.** Some uses of our games outside of this policy for editorial or
> educational purposes may be permissible under applicable 'fair use' or similar
> laws. You may wish to consult an intellectual property attorney if you have
> questions about whether your particular use of our game content qualifies for
> fair use."

Reservation and revocation:

> "Any use of our game content outside of this Policy is prohibited and **we
> reserve the right to update this policy at any time without notice.** We
> reserve the right to address any use of our game content that violates this
> policy or that we find objectionable. **Our decision to not enforce specific
> provisions of this policy against a party does not prevent us from enforcing
> this policy in the future.**"

Permission-request routes exist only for entities using EA games "in books,
films, TV series, or other productions," EA business partners, vendors, and
former employees. There is no route for a community website, and EA states:
"We will only respond if we are interested in pursuing the opportunity. Don't
interpret our lack of response as an approval."

The policy contains **no** territorial limitation, **no** age condition, **no**
required copyright or trademark notice beyond the non-affiliation statement,
**no** statement about linking, embedding, caching, proxying, or hot-linking,
**no** statement about standalone asset libraries, and **no** statement about
recolouring, cropping, or otherwise altering EA artwork.

### 3.2 S2 — EA User Agreement (contractual, Last Updated 2026-05-14)

Definition of EA Services — websites are inside it:

> "This Agreement governs your access and use of products, content and services
> offered by EA and its subsidiaries ('EA'), such as game software and related
> updates, upgrades and features, and **all online and mobile services,
> platforms, websites, and live events hosted by or associated with EA**
> (collectively 'EA Services')."

Section 2, License — the operative prohibition:

> "The EA Services are licensed to you, not sold. EA grants you a personal,
> limited, non-transferable (i.e., not for sharing), revocable and non-exclusive
> license to use the EA Services to which you have access **for your
> non-commercial use**, subject to your compliance with this Agreement. **You
> may not access, copy, modify or distribute any EA Service, Content or
> Entitlements (as those terms are defined below), unless expressly authorized
> by EA or permitted by law.** You may not reverse engineer or attempt to
> extract or otherwise use source code or other data from EA Services, unless
> expressly authorized by EA or permitted by law. EA or its licensors own and
> reserve all other rights…"

Section 3, definition of Content — broad enough to capture every asset at issue:

> "Content is the software, technology, text, forum posts, chat posts, profiles,
> widgets, messages, links, emails, music, sound, **graphics, pictures**, video,
> code, and all audio visual or other material **appearing on or coming from EA
> Services, as well as the design and appearance of our websites.** Content also
> includes user-generated Content ('UGC'). UGC includes EA Account personas,
> forum posts, profile content, a player's voice or other audio transmitted as
> part of social features available in or through EA Services, **images or other
> visual material submitted or otherwise contributed to or through EA
> Services**, and other Content contributed by users to EA Services. All Content
> is either owned by EA or its licensors, or is licensed to EA and its licensors
> pursuant to Section 5 below."

Section 5, UGC — the downstream licence and its hard boundary:

> "When you contribute UGC, you grant to EA, its licensors and licensees a
> non-exclusive, perpetual, transferable, worldwide, sublicensable license to
> use, host, store, reproduce, modify, create derivative works, publicly
> perform, publicly display or otherwise transmit and communicate the UGC…
> **You also grant to all other users who can access and use your UGC on an EA
> Service the right to use, copy, modify, display, perform, create derivative
> works from, and otherwise communicate and distribute your UGC on or through
> the relevant EA Service** without further notice, attribution or compensation
> to you."

Section 6, Rules of Conduct, on infringing material:

> "Do not upload or distribute any material that infringes another's
> intellectual property rights (including copyrighted characters, individual
> names or likenesses, or protected logos or designs)."

Section 13(A), Entire Agreement:

> "This Agreement, together with any other EA terms that govern your use of EA
> Services, constitutes the entire agreement between you and EA. **The Agreement
> may not be amended or modified unless made in writing and signed by EA.**"

Section 13(B), Governing Law — for an operator in Alberta, Canada:

> "If you live in the United States, Canada or Japan, (i) this Agreement is
> between you and Electronic Arts Inc., 209 Redwood Shores Parkway, Redwood
> City, CA 94065, USA; (ii) **the laws of the State of California**, excluding
> its conflicts-of-law rules, govern this Agreement and your use of EA
> Services…" — with San Mateo County courts for non-arbitrable claims, and the
> Section 15 binding-arbitration agreement and class-action waiver applying.

Documents **expressly incorporated by reference** into the User Agreement: the
Terms of Sale (§1), the Positive Play Charter (§6), and the Privacy and Cookie
Policy (§6). **EA's content policy (S1) is not among them.**

**No clause expressly naming scraping, robots, spiders, crawlers, or bots was
found** in the User Agreement. A full-text search for `scrap`, `robot`,
`spider`, `automat`, `crawl`, `mining`, `harvest`, and `bot` returns no such
named prohibition. **User Agreement §2's general access, copying, and
extraction restrictions remain relevant**: its bar on accessing or copying
Content without express authorization, and its bar on reverse engineering or
extracting source code or other data from EA Services.

### 3.3 S5 — `www.ea.com/robots.txt` reservation of rights

The file's `User-agent: *` group disallows only `/results` and several The Sims 4
store paths. **`/games/nhl/…` is not disallowed for general crawlers**, and a
`Sitemap:` directive is published. A named block list disallows several AI
crawlers (AI2Bot, Bytespider, FriendlyCrawler, ICC-Crawler, cohere-ai,
cohere-training-data-crawler, Meta-ExternalAgent). Below those directives, in
comments, EA publishes:

> "#Electronic Arts Inc. and its affiliated companies explicitly reserve all
> their rights in any content made available, including on websites, social
> media pages and any other platforms. Electronic Arts content includes without
> limitation, video games, visual displays of video games, characters, brands,
> **artworks, images**, videos, music, dialogue, story, and any Electronic Arts
> works or data. **Any use of such content for the development, training,
> programming, improvement and/or enhancement of artificial intelligence
> (including, but not limited to, generative AI systems), web scraping, machine
> learning, or any form of text or data mining, is prohibited, unless
> specifically and explicitly authorized in writing by Electronic Arts.**"
>
> "#This statement is a reservation of rights with respect to text and data
> mining under Article 4 (3) of Directive (EU) 2019/790 and any analogous
> statutes worldwide."

**Context and limitations.** This is a unilateral rights-reservation statement
placed in comments in a machine-readable crawler file, not contractual terms and
not part of the User Agreement. Its scope is genuinely ambiguous on the face of
the text and both readings must be preserved:

- **Reading 1 (plain series).** "web scraping" is a coordinate item in the list
  of prohibited uses, alongside AI development and text/data mining. On this
  reading EA prohibits web scraping of its website content generally, absent
  written authorization.
- **Reading 2 (contextual).** The sentence sits inside an AI/TDM reservation
  that expressly invokes EU DSM Directive Article 4(3), and every neighbouring
  directive targets AI crawlers. On this reading the prohibition reaches
  scraping *for AI/TDM purposes*, and asset retrieval for a fan site is outside
  its target.

This memo does not choose between them. See section 5.

---

## 4. EA-owned versus third-party-rights boundary

**EA's permission covers only what EA controls.** S1 says so in terms: "We do
not provide you with any permission to use third-party content from our games.
You use our game content at your own risk." S2 §2 reinforces it — "EA **or its
licensors** own and reserve all other rights" — and the required non-affiliation
statement itself names "EA **or its licensors**."

Consequences that must not be softened:

1. **EA cannot and does not purport to grant rights in NHL or NHLPA marks,
   team or league branding, or player likenesses.** These are exactly the
   categories S1 enumerates ("talent, brands, voices, music"). The NHL and NHLPA
   logos in EA's own NHL 26 page footers, linking to `nhl.com` and `nhlpa.com`,
   are consistent with these being licensed third-party rights.
2. **No EA page found in this research defines which specific NHL 26 assets are
   third-party licensed.** EA states the exclusion exists but does not publish a
   list. **Whether any individual X-Factor icon or base crest falls inside the
   exclusion is therefore not answerable from official EA text — it is
   unresolved.**
3. **The X-Factor icons are not visibly NHL/NHLPA-branded.** EA's own alt text
   on S6 labels them e.g. "SPECIALIST ANKLE BREAKER X-Factor Icon"; they are
   ability icons, not team or player marks. But the file names EA assigns embed
   "NHL_26" (the NHL word mark), and "X-Factor" / "EA SPORTS" are EA marks.
   **Absence of a visible third-party logo is not evidence that the asset is
   free of third-party rights**, and no EA document says the icons are wholly
   EA-owned. Unresolved.
4. **If a custom crest is contributed UGC**, S2 §5 grants other users rights
   only on or through the relevant EA Service and identifies no off-service
   user licence. **Because the factual nature of these crests is unresolved, do
   not apply that limitation categorically to the entire custom-crest family.**
   No official EA language provides a downstream permission either way, and
   none is inferred.
5. **UGC carries an independent infringement risk.** S2 §6 forbids users from
   uploading infringing material, and S2 §5 states EA "does not pre-screen all
   UGC and does not endorse or approve any UGC." A custom club crest may itself
   reproduce a real-world logo. Rehosting it transfers that risk to this site
   regardless of EA's position.
6. **Sony and Microsoft marks are out of scope** for this memo by instruction
   and remain open from E2C2.

---

## 5. Acquisition-method analysis (kept separate from permission to display)

Three distinct questions, deliberately not merged:

**(a) Was the retrieval method compliant?** The script performed automated
retrieval of 28 `www.ea.com` pages and then automated download of ~84 PNGs from
`drop-assets.ea.com`, using a spoofed desktop-browser `User-Agent`. Findings:

- `www.ea.com/robots.txt` does **not** disallow `/games/nhl/…` for general
  crawlers, and this project's agent is not among the named blocked bots.
- **No clause expressly naming scraping, robots, spiders, crawlers, or bots was
  found** in the User Agreement. **User Agreement §2's general access,
  copying, and extraction restrictions remain relevant** to this question.
- The **`www.ea.com/robots.txt` rights reservation prohibits "web scraping" of
  EA content without written authorization on its plain reading** (Reading 1,
  §3.3), and this project has no written EA authorization. On Reading 2 the
  clause does not reach this use. **The ambiguity is unresolved and material.**
- S1's "obtain assets through 'data mining'" prohibition sits among examples of
  User Agreement / Positive Play misconduct. Whether harvesting images from a
  public marketing page is "data mining" in EA's intended sense — as opposed to
  extracting assets from shipped game files — **is not defined anywhere in EA's
  published text.** Unresolved.
- **The crawler policy of `drop-assets.ea.com`, the host the files were actually
  taken from, could not be read** (HTTP 503 on both attempts). That gap should
  be closed before any conclusion about the download step is treated as settled.
- The spoofed `User-Agent` was not addressed by any EA text located. It is
  recorded as a fact about the method, not characterized.

**No finding of wrongdoing is made.** EA's published text does not clearly and
unambiguously apply to this retrieval, and this memo will not manufacture a
verdict either way.

**(b) Is there permission to display the content?** Analysed in section 6. It is
a separate question, and a favourable answer to (a) would not answer it.

**(c) Is there permission to keep and redistribute the downloaded files?**
Distinct again, and the weakest of the three. Serving 84 PNGs from
`apps/web/public/` is redistribution of copies from our origin, not display of
EA's copies. S2 §2 bars copying and distributing Content "unless expressly
authorized by EA," and nothing in S1 expressly authorizes rehosting standalone
EA artwork files as a self-hosted asset set. **Even if (a) and (b) resolved
favourably, (c) would remain open.**

**Retroactivity note.** S1 states EA "reserve[s] the right to update this policy
at any time without notice." Which version of the policy was in force when the
scrape ran is not established by this research, and the current version is the
only one verified. Any reliance argument based on an earlier version would need
that version evidenced, not assumed.

---

## 6. Asset-family result matrix

Classifications describe **verification status against official EA text only**.
None is a legal conclusion, and **no family below is legally cleared.**

### 6.1 The 84 NHL 26 X-Factor PNGs (`apps/web/public/assets/x-factors/`)

**Result: NOT ADDRESSED / AMBIGUOUS → LEGAL REVIEW REQUIRED; REPLACEMENT
CANDIDATE.**

Supporting for a conditional reading: S1 expressly names "fan sites" as a
permitted personal project, expressly contemplates "displaying our game content"
on a website, and expressly permits fan sites monetized only by passive banner
ads.

Against, and unresolved:

- S1's grant is for "**our game content**, including gameplay and original
  characters." These files are **standalone marketing artwork copied off EA's
  website and CDN**, then rehosted as a self-contained asset library. S1 never
  addresses that act, and S2 §3 separately defines Content to include "the
  design and appearance of our websites."
- EA's official content policy is a published permission for qualifying
  fan-site uses of "our game content." **The unresolved question here is
  whether separately published website/CDN marketing artwork, copied and
  self-hosted as an asset set, falls within that permission.**
- Third-party rights in the icons are undetermined (§4.3).
- Acquisition method is unresolved (§5(a)); retention/redistribution is the
  weakest leg (§5(c)).

### 6.2 EA base crests (`…/pro-clubs/crests/t<id>.png`)

**Result: CONDITIONALLY SUPPORTED AT BEST, ON UNVERIFIED PREMISES → LEGAL REVIEW
REQUIRED; REPLACEMENT CANDIDATE.**

- These are EA-supplied crest artwork inside an EA Service, so they sit closer
  to "game content" than the marketing PNGs do, and displaying game content on a
  fan site is what S1 addresses most directly.
- The repository configures default Next.js image optimization for these
  paths, which normally fetches and serves remote images through the site and
  may resize, transcode, or cache them; **deployed behavior was not
  runtime-tested**. S1 says nothing about caching or proxying; S2 §2 bars
  copy/modify/distribute without express authorization. **EA publishes no
  statement on embedding, hot-linking, caching, or proxying at all.** Whether
  the `next/image` pipeline's actual behavior constitutes copying,
  modification, or distribution under S2 §2 is a legal-review question (LR-3),
  not settled here.
- **Whether any base crest in the EASHL library reproduces a real NHL club or
  other third-party mark is unverified.** If any does, S1's third-party
  exclusion applies with full force and EA's permission does not reach it.
- All S1 conditions in §7 would have to be satisfied.

### 6.3 Custom / user-created opponent crests (`…/pro-clubs/custom-crests/<id>.png`)

**Result: CONDITIONAL / FACTUAL NATURE UNRESOLVED → LEGAL REVIEW REQUIRED;
REPLACEMENT CANDIDATE.**

- **If these are contributed UGC**, S2 §5 identifies no off-service user
  licence — it grants other users rights only "on or through the relevant EA
  Service." Republishing them on `boogeymen.app` is neither. **There is no
  downstream licence, and none is inferred.**
- **If instead they are EA-rendered from EA-supplied components** (assembled by
  users in an EA editor from EA-owned parts), they are EA Content and the §6.2
  EA game-content-policy analysis applies.
- **Repository names do not determine which is true.** The directory name
  `custom-crests` is a code label, not evidence of legal character. **No
  official EA page found in this research describes the NHL Pro Clubs
  crest-creation mechanic**, and the one EA page found under an NHL 26 URL
  (S8) redirects to the NHL 27 page and so does not resolve it either. Which of
  the two the crests are is **unresolved** — and it is a question that changes
  the answer.
- Either way, the crest may itself infringe a third party (§4.5), and rehosting
  moves that exposure onto this site.
- These crests also depict **other clubs' chosen identities**, i.e. third-party
  UGC belonging to people who are not this project's members.

---

## 7. Conditions EA imposes, if any permission is relied on at all

Every one of these is a **condition on** permission, never evidence **of** it.

> **Correction — E2F2A (2026-09-09).** Item 1 below previously read "Required
> wherever EA game content is displayed." That phrasing overstated the reviewed
> EA text, which addresses the website or other location displaying EA game
> content and says nothing about placement within it. Item 1 has been corrected
> to match the quoted wording exactly. The quoted EA statement, the
> condition-not-permission framing, and every other conclusion in this memo are
> unchanged.

1. **Non-affiliation statement, wording specified by EA:** "This
   [project/website] is not endorsed by or affiliated with EA or its licensors."
   S1 states: "If you have a website or other location where you're displaying
   our game content, include the following statement" — so EA directs that a
   website or other location displaying its game content include the statement.
   **The reviewed text does not specify page-by-page placement, does not specify
   a sitewide footer, and does not state that any single surface is the only
   compliant placement.** Where the statement sits within a site is not
   addressed by S1 at all; see LR-7, which preserves "where it must appear" as
   an open question.
2. **No implication of endorsement or affiliation**, including via use of EA
   logos or game art on the site.
3. **No merging of EA branding with ours** — the BGM/SPD marks must not
   incorporate or be combined with EA, EA SPORTS, or NHL logos or trademarks.
4. **No commercial use; no paywalls.** Passive banner ads and partner-program
   video monetization are the only permitted monetization. **Donations,
   sponsorship, and subscriptions are not named in EA's exception and are
   therefore not covered** — treat them as outside the exception unless EA says
   otherwise. *Action: the operator must confirm and record the site's actual
   monetization state; E2A decision 4 records a personal/noncommercial reuse
   posture but no monetization audit has been performed.*
5. **No combining EA game content with other third-party products, services, or
   brands** — directly relevant, since this site already renders EA content
   alongside PlayStation/Xbox marks and other third-party icon families
   (E2C2 open items).
6. **Positive Play Charter and User Agreement conduct rules apply** (the Charter
   is contractually incorporated by S2 §6).
7. **Revocable at will.** S1: policy may be updated "at any time without
   notice"; non-enforcement is not waiver. S2 §2: the licence is expressly
   "revocable." **Any reliance on S1 is therefore inherently unstable and can be
   withdrawn unilaterally.**
8. **Governing law for a Canadian operator:** Electronic Arts Inc., California
   law, San Mateo County courts, plus S2 §15 binding arbitration and class-action
   waiver. Age: 13+ for an EA Account. No territorial limit is stated in S1.
9. **The reviewed EA policy (S1) specifies the non-affiliation statement**
   (item 1). No additional EA-authored attribution or copyright-notice
   requirement was found in the reviewed sources. **Third-party rights may
   impose independent requirements** not addressed by S1. Do not invent an
   attribution requirement — and note that satisfying item 1 does not itself
   create permission.
10. **Alteration, recolouring, cropping, resale, and standalone asset libraries
    are not addressed in S1.** S2 §2's bar on modification cuts against
    alteration. Unresolved.

---

## 8. Unresolved questions

| # | Question | Why it matters |
| --- | --- | --- |
| U1 | Are the standalone X-Factor marketing PNGs "our game content" within S1, and does S1 cover copying and self-hosting them from EA's website/CDN? | Determines the policy basis for the X-Factor family; it does not gate unrelated asset families |
| U2 | Does S1's fan-site permission extend to copying standalone marketing artwork off EA's website/CDN and rehosting it as an asset library? | The whole X-Factor question |
| U3 | Are any X-Factor icons or base crests third-party licensed content within S1's exclusion? | EA cannot grant what it does not own; unanswerable from EA's published text |
| U4 | Are NHL Pro Clubs custom crests UGC or EA-supplied artwork? | Selects between two different and materially different analyses |
| U5 | Does the `robots.txt` "web scraping" prohibition reach non-AI scraping (Reading 1) or only AI/TDM scraping (Reading 2)? | The acquisition-method question |
| U6 | What does `drop-assets.ea.com` publish as its crawler policy? | Could not be read — HTTP 503 |
| U7 | Does S1's "data mining" prohibition cover harvesting images from public marketing pages? | Undefined in EA's text |
| U8 | What legal characterization applies to the deployed Next.js image path, whose configured default optimizer normally fetches and serves remote images through the site and may resize, transcode, or cache them? | Decides the crest families |
| U9 | Which version of S1 was in force when the scrape ran? | Any reliance argument depends on it; only the current version is verified |
| U10 | Does this project have or plan any monetization beyond passive banner ads? | Donations/sponsorship/subscriptions are outside EA's stated exception |

---

## 9. Legal-review flags

- **LR-1.** EA's official content policy (S1) is a published permission
  expressly covering qualifying personal fan sites' use of "our game content."
  It is not expressly incorporated into the User Agreement (S2), but S2 §13(A)
  does not establish that separate EA permission is ineffective. The
  unresolved issues are asset scope, particular use, rehosting/acquisition, and
  third-party rights.
- **LR-2.** Whether copying and self-hosting 84 EA marketing PNGs is within S1's
  fan-site permission, or outside it and therefore prohibited by S1's own
  reservation of rights.
- **LR-3.** Whether the `next/image` server-side pipeline is display or
  reproduction/distribution under S2 §2, in the applicable jurisdictions.
- **LR-4.** Third-party (NHL / NHLPA / player likeness) exposure in EA-sourced
  artwork that EA expressly refuses to warrant.
- **LR-5.** The `robots.txt` scraping reservation's scope, its legal effect as a
  non-contractual unilateral statement, and its interaction with the Alberta
  operator / California-governing-law posture.
- **LR-6.** If custom crests are contributed UGC, §5 identifies no off-service
  user licence; if they are EA-rendered from EA-supplied components, the EA
  game-content analysis applies. Their factual nature remains unresolved.
- **LR-7.** Whether the required non-affiliation statement is sufficient, and
  where it must appear, if any EA content is retained.

---

## 10. Recommended next action

**Nothing in this memo authorizes retention, replacement, or modification of any
asset.** The evidence supports exactly one conclusion at this stage: **no EA
asset family can be treated as cleared**, and the X-Factor PNGs and custom
crests are the weakest of the three.

Recommended sequence:

1. **Next session (narrow):** produce an EA-asset decision memo that lays out,
   for each of the three families, the concrete replacement or removal option
   and its product cost — with the X-Factor PNGs and custom crests treated as
   the leading replacement candidates and the base crests as the closest call.
   Documentation only; no asset touched, no code changed.
2. **Then:** operator decision on retain-pending-legal-review versus
   replace-now, per family.
3. **Then, if anything is retained:** conditional attribution/non-affiliation
   drafting (permitted by E2C2), still subject to legal review.
4. **Independently:** close U6 by re-reading `drop-assets.ea.com/robots.txt`
   when the host responds, and close U10 by recording the monetization state.

**Attribution finalization remains blocked** under E2A decision 9. This research
advances that audit for the EA-controlled families; it does not complete it, and
the Sony, Microsoft, SVG Repo, Twemoji, and font families from E2C2 remain
untouched and open.
