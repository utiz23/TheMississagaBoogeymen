# Card Progression Deep Research — Round 1 Prompt

## Submission goal

Survey prior art and commission a structured report covering how to design a
collectible player-card progression system for a small private hockey team
site. We have a working blueprint built from first principles
([`card-design-and-progression-blueprint.md`](../../card-design-and-progression-blueprint.md))
and a draft badge catalog ([`Badges.md`](../../Badges.md)), but no external
survey yet. The report should pressure-test our blueprint against established
patterns, surface anti-patterns, and give concrete recommendations we can apply.

## Context (read before writing recommendations)

**Product:** EASHL Pro Clubs team stats website for a single hockey club
(~10-15 active members, club identity "Boogeymen / BGM"). Self-hosted; no
monetization, no F2P pressure, no microtransactions. Audience is the team
members themselves, not a wide public. Lifetime spans multiple NHL game
cycles (NHL 26 → NHL 27 → NHL 28 …); a player's career is multi-year.

**Existing card system (the baseline):** A vertical 264px card rendered on
the home-page carousel, roster grid, and depth chart. The current card shows:

- Jersey block (top-left): jersey number, position pill, W-L-OTL record, win %
- Portrait area: silhouette placeholder (no real photos yet)
- Name row: platform icon + gamertag
- 4-stat grid: GP / G / A / **PTS** for skaters (featured "lead" stat is
  accent-colored, larger); GP / SV% / GAA / **W** for goalies
- Identity row: nationality flag, team crest, one spare cell

The card is a clean baseline. **It is not yet differentiated by player
quality.** Every active roster member's card looks the same except for the
numbers and position pill color. The goal of the progression system is to
change that — to make a Tier 5 Franchise card _look_ and _feel_ meaningfully
different from a Tier 1 Prospect card, without turning the front into a
spreadsheet.

**Existing progression blueprint (the destination):**

- 6 tiers: Common Prospect → Uncommon Rookie → Rare Stud → Epic Elite →
  Legendary Franchise → Mythic Legend
- 4 progression layers, kept independent in data:
  - **Tier** (long-term card class, drives theme + frame)
  - **Level** (1-10 within a tier; based on participation + role
    production; never downgrades — lifetime progress)
  - **Badges** (permanent achievement evidence; 6 tiers × 5 levels per
    badge family = 30 progression steps per stat)
  - **Add-ons** (temporary enhancements like Hot Streak, or augmentations
    like Captain patch, Hat Trick marker, Club Record)
- Front-card budget: max 1 major + 2 minor augmentations
- Mythic Tier 6 is curated/manual not automatic
- Visual restraint rule: "the cards should feel dark, sharp, competitive,
  hockey-specific — not generic fantasy RPG"

**Existing badge catalog:** 19 player + 14 team badge families drafted in
`Badges.md`. Each family has 6 tiers × 5 levels (30 thresholds). Some are
`available` (computable now), some `derived` (needs query work), some
`manual` (admin-awarded), some `future` (need video tracking or data we
don't have). Each has a `cardWeight` 0-4 saying how strongly it should
influence card tier.

**Data we have, per player (and what scale of values to expect):**

- Career totals, broken by game-mode (3s vs 6s), broken by game title
  (NHL 26 separately from NHL 27): GP, G, A, PTS, hits, takeaways,
  faceoff wins, blocked shots, +/-, shots, save totals/percentage,
  shutouts, wins/losses/OTL/DNF, goalie GP, goalie wins, time-on-ice
- EA per-match ratings: rating_offense, rating_defense, rating_teamplay
  (0-100, decimal). Player rank tier asset IDs.
- Shot-location grids (where on the ice and where on the net) — opens
  the door to xG-like models
- Match events with positioned x/y (for the actor and target), so we
  know where on the rink hits/shots/goals happened
- Active roster is ~10 members. Career totals so far for top players are
  in the low hundreds of goals / few hundred wins. Goalies have far
  fewer games than skaters.

**Design direction (the brand brief — non-negotiable):**

- Dark, aggressive, esports-hockey aesthetic
- Charcoal + paper + accent-red palette (specific hex: `#1a1819` /
  `#ebebeb` / `#e84131`)
- Position color palette already defined (C red, LW green, RW blue, LD
  teal, RD yellow, G purple)
- Sharp borders, scoreboard-style stat panels
- "Broadcast strip" not "RPG card" not "corporate dashboard"

**Constraints unique to our situation:**

- Audience is ~10-15 people who know each other in real life. The
  card system must reward real performance without creating
  resentment when one player's card outclasses another's. No "pay to
  upgrade" lever exists — only "play more / play better."
- Small sample sizes: most players have GP in the low hundreds. Stat
  thresholds must work at that scale, not the millions-of-users scale
  big games operate on.
- Multi-year horizon: a player's card should keep evolving meaningfully
  across NHL 26 → 27 → 28, not max out in year one. But it also can't
  feel like a 10-year grind to reach the visually-interesting tiers.
- Self-hosted, no monetization, no engagement-farming pressure — we
  can pick patterns that are _good design_ rather than patterns that
  maximize retention metrics. We explicitly do not want gacha
  psychology. Loot-box mechanics are off-limits.

## Why we're commissioning this

The blueprint was built from first principles by one designer. It has a lot
of detail but it has not been pressure-tested against established patterns.
We want a Round-1 deep research that does the survey we don't have time to
do ourselves, surfaces what successful systems actually do, identifies the
parts of our blueprint that are likely good vs. risky, and gives concrete
recommendations we can act on. Subsequent rounds can drill in on specific
questions; this round should be broad.

## Core questions

Each question should get **concrete engagement** — a specific answer
grounded in named systems / sources, not a generic "it depends" paragraph.
When you cite a system, name it and say briefly how it solves the problem.

### Q1 — Stat-to-tier mapping math

We need to map continuous stats (goals, points, win%, save total, …) to
discrete tiers (Prospect → Legend) and to badge tiers within a family. Our
blueprint uses fixed numeric thresholds with 6 tiers × 5 levels.

- What approaches do real systems use to map continuous stats to discrete
  tiers? Fixed thresholds, percentile cohorts, hybrid (threshold floors
  with percentile gates), z-scores against a peer group?
- Survey the patterns from at least 4 of: FIFA Ultimate Team, NHL HUT,
  Madden Ultimate Team, NBA 2K MyTeam, MLB The Show Diamond Dynasty,
  Pokemon TCG Live, Marvel Snap, EAFC's player-rating system, Pokemon
  GO's CP system, Diablo / D4 item tiers, Destiny power level.
- What are the failure modes of each (e.g., percentile-based systems
  inflate over time; threshold systems calcify; hybrid systems are hard
  to explain).
- For our scale (10-15 active players, lifetime ~hundreds of games), which
  approach has the best signal-to-noise?
- Specifically: does the 6-tier-by-5-level structure (30 thresholds per
  badge family) have prior art at this scale? Or is it overengineered?

### Q2 — Position-adjusted and role-adjusted comparability

D vs F vs G have very different scoring profiles. A 0.5 PPG defenseman is
elite; the same number is mediocre for a center. Goalies don't score at all.

- How do FIFA UT / Madden UT / NBA 2K MyTeam handle cross-position
  comparability? They each have it; what's the math?
- Hockey-specific analytics work (NHL public analytics, evolving-hockey,
  hockey-graphs) — what's the canonical approach for role adjustment?
- For our system, should card tier be computed against an
  all-position pool, against a role-specific pool, or a hybrid?
- How do other systems handle role _within_ a position — e.g., a
  shutdown defenseman who never scores vs. a puck-moving D who racks
  up points. Do they use multiple parallel rating axes or a single
  composite?
- The blueprint proposes role-specific badge inputs (skaters: Goals,
  Assists, Hits, Faceoffs, Takeaways, Wins, GP, Hat Tricks; goalies:
  Saves, Shutouts, Wins, GP). Is that enough role differentiation?
  Should there be sub-role differentiation (sniper vs playmaker vs
  enforcer vs two-way) baked into the card-tier math, or kept as
  cosmetic archetype labels?

### Q3 — Earned vs cosmetic, and "felt-earned" progression

There's a spectrum from "every grain of progress feels earned" (Souls,
classic MMOs) to "rewards are mostly cosmetic frosting on flat gameplay"
(modern battle passes, Fortnite skins).

- What separates a progression system that _feels earned_ from one that
  _feels grindy_? Be specific — name patterns, not just principles.
- Anti-patterns we should explicitly avoid: which patterns make players
  resent the system? (e.g., FOMO mechanics, time-gated unlocks, currency
  laundering, achievement bloat.)
- The blueprint's split between Tier (slow, badge-driven) and Level (1-10
  within tier, participation-driven) — is this the right structural split?
  How do other systems separate "lifetime accomplishment" from "active
  participation"?
- Specifically for our audience (10-15 real people who know each other):
  what's the right pace? A player who plays 3 games a week should see
  _something_ change on their card monthly, but tier jumps should feel
  rare. What cadence does prior art point to?

### Q4 — Anti-pyramid: avoiding the "everyone Bronze" or "everyone Gold and stops" trap

Tiered systems have a known failure mode: either thresholds are too high
and 90% of users sit at Tier 1 forever, or too low and everyone hits the
top tier and the rarer tiers become uninteresting.

- How do real systems calibrate this? Specifically: how do they pick the
  numeric thresholds so the _distribution_ across tiers feels right?
- What's the right target distribution shape? Bell curve centered on
  Tier 2-3? Pareto with most players at Tier 1 and a long tail? Even
  distribution?
- The blueprint's tier guardrails (no Tier 4+ without a games-played
  baseline, no goalie quality without games threshold, Tier 6 requires
  manual approval) — are these the right guardrails? What others should
  be in place?
- For our specific scale, what target distribution makes sense? Roughly
  what fraction of the active roster should sit at each tier over a
  multi-year arc?

### Q5 — Visual hierarchy and information density on small card formats

The card is 264px wide. The blueprint says "max 1 major + 2 minor
augmentations on the front; everything else on the back."

- Survey of visual hierarchy patterns from sports trading cards (Topps,
  Upper Deck, Panini) and from digital card games (FIFA UT, NHL HUT,
  Pokemon TCG). What's the proven _information budget_ for a card face
  at ~250-300px?
- Front-card slot priority: when space is contested (a player has 4
  meaningful augmentations), which wins? Real systems must have
  precedence rules — what do they do?
- Specifically: card tier visual treatment (frame / theme / background)
  vs badge display vs current-form indicators (hot streak, slump) —
  how should these _visually_ coexist without competing for the same
  attention?
- The blueprint specifies "max 5 badges on any front card." Is that
  the right number? Established systems converge on what?
- Mythic Tier 6 is supposed to feel curated. What visual moves
  distinguish "curated and rare" from "Tier 5 with extra glow"?

### Q6 — Badge / sub-progression design

We have 19 player + 14 team badge families. Each has 6 tiers × 5 levels.

- Real systems use sub-progression too (FIFA UT objectives, NBA 2K
  badges, Destiny seals). Survey the patterns: what makes a badge
  feel like an _achievement_ vs feel like _bloat_?
- Our current catalog has families weighted 0-4 for card-tier
  influence. Is this the right granularity? Or too granular?
- Front-card badge display rules: the blueprint says strongest-badge-only
  for Tier 1-2, signature plate + progress hint for Tier 4, "best 3-5
  badges" for Tier 6. Compare against how other systems do this.
- For our 10-15 player audience: how many _distinct_ badge families
  is too many? At what point does the catalog become noise rather
  than identity? (Currently 19 + 14 = 33 families.)
- Should we have meta-badges (badges-of-badges)? Or does that fall into
  the "achievement bloat" anti-pattern?

### Q7 — Augmentations, enhancements, and editorial vs automated

The blueprint splits add-ons into Enhancements (temporary, recent-form
based — Hot Streak, Clutch, Heater) and Augmentations (permanent +
event-based — Captain patch, Hat Trick, Club Record, Playoff Hero).

- What patterns work for _temporary_ state on cards? The blueprint says
  enhancements should refresh after new games are ingested. How do
  real systems handle the half-life of a "Hot Streak" badge — does it
  decay sharply, decay smoothly, or simply expire?
- Editorial / manual override slots: the blueprint reserves Mythic
  Tier 6 for admin approval. What other slots benefit from human
  curation vs. automation? (E.g., Captain patch — automatic from
  EA-detected ★, or admin-assigned?)
- "Meme / Locker Room" augmentations (Penalty Box Resident, Almost Had
  It, Lag Warrior, Empty Net Specialist) — these are in our blueprint
  but feel risky. How do successful systems handle humor / personality
  without it reading as insulting to the player?

### Q8 — Multi-year longevity (NHL 26 → 27 → 28 …)

EA ships a new NHL game roughly yearly. Our team will keep playing
across game titles. The blueprint mentions "Season Variant" cards
(NHL 26 Season 1, NHL 27 Launch Edition) but doesn't deeply explain
how the progression carries forward.

- How do FIFA UT / Madden UT handle the year-over-year transition?
  Each new game resets cards — is that right for us, or do we want
  career-cumulative cards (no reset)?
- If career-cumulative: how do you keep the system interesting in
  year 3 when top players are already maxed? Real systems often add
  new tiers or new variants — what works and what doesn't?
- If yearly reset: how do you handle "legacy" recognition for past
  Mythic cards without devaluing them?
- The blueprint is silent on this explicitly. What's the recommended
  architecture? (Career card + per-season subcards? Single career
  card that gains "year banners"? Something else?)

### Q9 — Card backs and detail views

The blueprint says "the front creates desire, the back explains why
it's deserved." The back/detail view has: full stats, badge progress,
best games, recent form, unlocked variants, augmentations earned,
card history, manual lore (for Mythic).

- What patterns work for a card _back_ vs a card _front_? Sports cards
  have a long tradition here — what's the canonical division of
  information?
- For digital card games: do players actually look at the back? What
  patterns drive engagement with the detail view vs treating it as
  vestigial?
- Best-games / highlight-moment sections — how do real systems pick
  what to surface? (Top 3 by points? Top 1 with biggest delta from
  baseline? "Most memorable" by editorial pick?)

### Q10 — Implementation order and shippable V1

The blueprint has a recommended build order (section 0.12). We want a
sanity check.

- What's the smallest shippable V1 that _feels_ like progression,
  not just "stats with extra labels"? Real systems have shipped V1
  versions — what was their MVP scope?
- The blueprint's V1 scope is roughly: data model + reliable badges +
  Tier 1-3 status changes + back/detail panel + one footer status slot.
  Is that ambitious enough to feel different from the current baseline,
  or is it underpowered?
- The blueprint defers animations, foil effects, and Tier 4-6 premium
  treatment to later phases. Is that right, or are the visual moments
  what make people care about the system in the first place?

## Out of scope

The report should not cover:

- MMORPG progression / leveling design — too different a context
- Monetization / microtransaction design — we have no monetization
- Engagement metrics / DAU / MAU optimization — wrong incentives for us
- General gamification literature on "extrinsic vs intrinsic motivation" —
  too broad; we want specific applied patterns
- Non-card-based reward systems (achievement lists, lockers, gear) —
  unless used as comparison to highlight what's specific to cards
- Detailed visual / typography prescriptions — handle in a separate
  research round if needed (see `docs/planning/research-queue.md`,
  "Broadcast-strip / sports overlay UI design")
- Hockey analytics / rating model math — separate research item (also
  in the research queue)

## Output format

Deliver as a single markdown report, structured with one section per
question (Q1-Q10). For each section:

1. **Survey** — name 3-5 specific systems you analyzed and how each one
   solves the problem (be concrete: don't say "FIFA UT uses tiers,"
   say "FIFA UT uses Bronze/Silver/Gold/Special with a rating-cutoff
   approach where Bronze = 64 OVR or under, Silver = 65-74, Gold = 75+,
   and Special cards layer on top using upgrade events").
2. **Anti-patterns** — what to avoid, with named examples
3. **Recommendation for our case** — concrete advice given our
   constraints (10-15 players, multi-year, no monetization, hockey-specific)
4. **Open questions for future rounds** — anything you couldn't
   answer with high confidence; tag for a follow-up research round

End the report with a **summary of recommended changes to our
blueprint** — a numbered list of specific edits we should make to
`card-design-and-progression-blueprint.md` based on the survey.

Length budget: depth over brevity. ~30-50 page report is fine.
Citations to specific games / sources expected throughout. If you
draw on academic work (game studies, behavioral economics), cite it.

## Reference material (read these first)

The following internal documents define the existing system. Treat them
as the _current state_ the research should engage with, not as gospel.

1. [`card-design-and-progression-blueprint.md`](../../card-design-and-progression-blueprint.md)
   — the full working blueprint (2500+ lines), including tier ladder,
   layer separation, badge-to-tier rules, augmentation budget,
   visual restraint rules, and stage-by-stage build order
2. [`Badges.md`](../../Badges.md) — the draft badge catalog with
   thresholds (19 player + 14 team families, 6 tiers × 5 levels)
3. [`docs/specs/player-card.md`](../specs/player-card.md) — the current
   player card UI spec (slot anatomy, data mapping, responsive rules)
4. [`apps/web/src/components/home/player-card.tsx`](../../apps/web/src/components/home/player-card.tsx)
   - [`apps/web/src/components/home/player-card.css`](../../apps/web/src/components/home/player-card.css)
     — the actual baseline component that ships today
5. [`docs/design/Mockups/PlayerCardBluePrint.png`](../design/Mockups/PlayerCardBluePrint.png)
   and [`PlayerCardBluePrint_2.png`](../design/Mockups/PlayerCardBluePrint_2.png)
   — original visual mockups
