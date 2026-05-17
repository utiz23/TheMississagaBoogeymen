# Card Progression Deep Research Round One

This report pressure-tests the current card-progression blueprint as described in your prompt. The linked internal files were not accessible in this chat context, so the analysis engages the blueprint through the detailed summary you supplied rather than through line-by-line redlining of the repository.

The strongest throughline from prior art is this: the best systems do **not** ask the player to understand a complicated formula. They use a simple visible layer, hide the noisy math underneath, and separate long-term identity from short-term heat. The systems that age badly either overfit to a giant live-service economy, or they let every layer compete for attention at once. Your blueprint is already pointed in the right direction on both counts; the main work is to simplify where it is over-specified, tighten role adjustment, and become more aggressive about what stays off the front card. citeturn9search2turn24search5turn16search0turn36search0turn13search0

## Progression math and role comparability

### Stat-to-tier mapping math

#### Survey

Across entity["video_game","EA SPORTS FC 25","football sim 2024"], entity["video_game","NHL 25","hockey sim 2024"], entity["video_game","Madden NFL 26","football sim 2025"], entity["video_game","NBA 2K25","basketball sim 2024"], and entity["video_game","MLB The Show 24","baseball sim 2024"], the dominant player-facing pattern is **fixed bands plus upgrade layers**, not live percentile ladders. NHL 25 explicitly redefined item bands so 74 OVR and below are Bronze, 75–79 are Silver, and 80+ are Gold; older official MUT documentation described Bronze → Silver → Gold → Elite → Legendary item tiers; and NBA 2K25’s year-long REP track uses 11 gem-color levels from Bronze through Dark Matter. In other words, major card systems overwhelmingly favor **named threshold bands** because they are legible, marketable, and stable. citeturn9search2turn6search2turn36search0

Those same systems then add a second layer for gradual progress. MLB The Show’s Parallel system is a clean example: cards earn Parallel XP through use and can be boosted five times for a permanent +5 across attributes. entity["video_game","Marvel Snap","digital card game"] uses a visible rarity ladder from Common to Infinity for card upgrades, and its Character Mastery system is a 30-level per-character progression track. These are not percentile systems either; they are **fixed-step ladders** that make small wins readable. citeturn24search5turn16search0turn34search1

When systems do use relative math, it is usually behind the curtain. urlEvolving-Hockeyturn13search1 centers z-scores around **positional means** and defines replacement levels separately for forwards and defensemen. That is a very strong hint for your case: percentiles and z-scores are excellent **calibration tools**, but they are usually too unstable, too opaque, or too socially awkward to expose directly as the player-facing ladder in a small club environment. citeturn13search0turn13search2turn13search5

Hybrid gating also shows up in adjacent progression systems. entity["video_game","Diablo IV","action rpg 2023"] unlocks harder difficulties through level and Pit clears rather than raw accumulation alone, and entity["video_game","Destiny 2","looter shooter 2017"] has long used soft caps, powerful caps, pinnacle caps, and seasonal gilding layers. These are not stat-to-tier systems in the sports-card sense, but they are relevant because they show a mature pattern: **a threshold is safer when paired with eligibility gates**. citeturn18search1turn30search8turn15search0

#### Anti-patterns

The main failure mode of **pure percentile** systems is drift. In a population of 10–15 players, one hot month or one new season can materially reshape the percentile map, which makes tiers feel political rather than earned. The main failure mode of **pure fixed thresholds** is calcification: if the thresholds are too low, everyone compresses upward; if they are too high, nobody moves. Hidden weighted formulas solve neither problem if they are never explainable. They simply convert “why isn’t my card higher?” into “the system is rigged.” citeturn13search2turn16search7turn9search2

A second anti-pattern is copying a giant live-service content ladder into a tiny community. A 30-step ladder can work when it is mostly backend accumulation or cosmetics, as Marvel Snap’s Character Mastery shows, but a 33-family × 30-threshold system quickly becomes enormous if every step is treated as a meaningful public-facing event. At your population size, that scale risks becoming accounting rather than prestige. citeturn34search1turn16search0

#### Recommendation for your case

For BGM, the highest-signal approach is a **hybrid with fixed visible thresholds and percentile-informed calibration**, where percentiles are used only offline to set the thresholds once or twice per year. Concretely: keep the six visible tiers, but compute their thresholds from your own historical distributions and then freeze them for the season or title cycle. Do **not** recalculate player-facing tiers from live percentiles after every ingest. Use live percentiles only as a designer’s tuning instrument. citeturn13search2turn24search5turn36search0

The 6-tier-by-5-level structure **does have prior art**, but only when most of those steps stay off the main surface. MLB’s five Parallel levels, Marvel Snap’s seven visual rarities plus 30-level mastery, and Destiny’s permanent base title plus seasonal gilding all show that layered progression is normal. What is **not** normal for a 10–15-person private site is exposing all of that complexity equally. My recommendation is to keep the 30-step badge ladders in data if they help cadence and threshold spacing, but expose them publicly mostly as **tier bands**, not as 30 equally legible milestones. citeturn24search5turn34search1turn30search8

#### Open questions for future rounds

The unresolved design question is not whether a 30-step ladder is possible. It is whether your existing badge thresholds in `badges.md` are too dense for your actual stat distributions across NHL 26 and likely NHL 27. That needs a follow-up round using your real historical player data, with simulated tier distributions and “time to next visible change” outputs.

### Position-adjusted and role-adjusted comparability

#### Survey

The public-facing sports-game pattern is clear: cross-position comparability is only partial. EA SPORTS FC’s ratings database exposes one OVR, two or three positions, and a rich sub-attribute profile, while PlayStyles give role-specific identity beyond the OVR itself. Official NHL guidance is even more direct: the game tells players to prioritize different attributes by position, with centers leaning on faceoffs, passing, puck control, and defensive awareness; wingers on speed and wrist-shot accuracy; defensemen on defensive awareness, stick checking, shot blocking, passing, and body checking; and goalies on angles, rebound control, shot recovery, and vision. That is effectively an admission that **the same headline rating does not mean the same thing across jobs**. citeturn10search0turn11search4turn38view0

Madden and NBA 2K solve the same problem with **position and archetype restrictions**, not one universal value metric. Official Madden ratings pages foreground position and archetype, while community documentation around MUT’s secondary positions makes clear that role compatibility and chemistry matter independently of raw ratings. In NBA 2K MyTEAM, badges can only be added or upgraded in ways that respect the player’s position and play style, and the game distinguishes long-term REP from seasonal levels. These systems preserve a single headline number, but the real comparability lives in the **role filters, archetypes, badge slots, and attribute emphasis**, not in the headline number alone. citeturn12search0turn12search2turn7search4turn31search3turn36search0

Public hockey analytics is stronger and more explicit than sports games here. Evolving-Hockey separates replacement level for forwards and defensemen, centers z-scores on positional means, and splits GAR into offense and defense components. Hockey Graphs likewise separates forward and defense contexts and uses different TOI thresholds and context adjustments when evaluating players. The canonical lesson from hockey analytics is that **forwards, defensemen, and goalies should not be ranked on one raw scoring axis**, and that defensive value needs its own lane rather than being treated as “offense minus a little.” citeturn13search0turn13search2turn13search5turn14search8turn14search6

#### Anti-patterns

The biggest anti-pattern is an **all-position pool**. In your environment, that would guarantee that forwards dominate early visible progression because goals and points are loud, defensemen get graded as “forwards with fewer points,” and goalies become incomparable edge cases. A second anti-pattern is forcing sub-roles like sniper, playmaker, enforcer, shutdown D, or puck-mover directly into the tier formula before you have a defensible role model. That makes the math look smart while actually importing subjectivity into the most sensitive layer. citeturn38view0turn13search0turn14search3

#### Recommendation for your case

Your card tier should be computed against **three primary pools**: forwards, defensemen, and goalies. That is the cleanest compromise between fairness and data sufficiency. Within those pools, use a two-axis composite: **production/impact** and **longevity/participation**, with minimum GP or TOI gates before a player can clear the upper tiers. Defensemen should get an explicitly different weight mix than forwards, using blocked shots, takeaways, passing-related contribution, win rate, and perhaps role-adjusted point rates rather than raw points alone. Goalies should remain on a separate track entirely. citeturn38view0turn13search0turn13search5

Your proposed badge inputs are enough for a V1, but not enough for a truly fair final tier model if they remain the only role expression. For defensemen, blocked shots should matter more than they currently seem to in the summary, and that importance should appear in both badge logic and any defenseman tier composite. For forwards, faceoff-driven center value should be recognized for centers without forcing every forward archetype into the main tier formula. My recommendation is: keep sniper/playmaker/enforcer/two-way as **archetype labels and badge signatures**, not as direct tier-math categories, until you have more seasons of data. citeturn38view0turn13search2turn14search3

#### Open questions for future rounds

Future work should test whether one forward pool is sufficient, or whether centers and wings need different baseline expectations once your club has enough multi-season data. My guess is that F versus D versus G is enough for V1 and V2, but that is a modeling question, not a philosophy question.

## Reward pacing and tier distribution

### Earned versus cosmetic and felt-earned progression

#### Survey

Progression feels earned when the reward is tightly coupled to something the player just did, and when the next rung is visible without becoming mandatory homework. MLB The Show’s Parallel system is strong on both counts: you use a card, it accumulates Parallel XP, and the boost is permanent and carries with the card even if ownership changes. NHL 19’s objectives-versus-milestones split is also instructive: daily objectives offered short-term tasks, while milestones persisted and paid out larger rewards across the mode’s lifespan. Those are two very different but compatible patterns: **small frequent progress** plus **slow permanent progress**. citeturn24search5turn29search1

The systems that feel grindy tend to rely on expiration pressure or opaque reward gaps. EA SPORTS FC’s current objective structure includes daily, weekly, dynamic, and season objectives, with daily tasks expiring after 24 hours, weekly objectives disappearing if missed, and dynamic objectives arriving as limited-time campaigns. Marvel Snap’s team publicly acknowledged that Collection Level past 1000 “feels… not so great” because reward gaps become long and mystery rewards lack adequate protection. Those are exactly the kinds of live-service rhythms you do **not** want on a private club site. citeturn29search0turn16search7turn26search0

NBA 2K’s badge progression adds one more useful pattern. In 2K24, badge levels trended toward how often a badge actually fired in your play, but they also had a floor and faster re-climb if you had been there before. The important design lesson is not the exact system. It is that **use-based progression feels more earned than attendance-only chores**, and floors matter because they prevent the emotional cliff of public regression. citeturn31search9turn31search2

#### Anti-patterns

Your prompt already names several anti-patterns, and prior art strongly supports avoiding them: FOMO timers, time-gated unlocks, multiple currencies, achievement bloat, and systems that mainly reward compliance with the designer’s task list rather than hockey contribution. FC’s daily/weekly/dynamic objective structure is the clearest “do not import this” case for your environment. Missed-time pressure is a retention lever that works against the spirit of a small friend-group site. citeturn29search0turn26search0

Another anti-pattern is allowing the cosmetic layer to outgrow the earned layer. If frame flourishes, foil treatments, novelty tags, or variant clutter change more often than meaningful hockey evidence, the system starts to feel ornamental rather than deserved. Physical trading cards and the best digital card systems avoid that by keeping prestige tied either to scarcity markers, permanent history, or highly legible use-based progress. citeturn24search5turn37search6turn22search7

#### Recommendation for your case

Your split between **Tier** as slow, badge-driven, lifetime accomplishment and **Level** as faster, participation-driven, non-downgrading progress is the right structural split. It resembles the best parts of MLB’s permanent Parallel boosts, NHL’s milestone structure, and 2K’s “floor plus trend” thinking without importing the expiry pressure of UT season chores. I would keep the split, but tighten the pacing rule: an active player at roughly three games per week should usually see **one visible card change per month**, but that should usually be a level pip, a minor badge threshold, a new back-card unlock, or a temporary enhancement—not a tier jump. citeturn24search5turn29search1turn31search9

A good practical cadence for your scale is: visible level progress monthly, badge-tier improvements every one to two months for active contributors, Tier 2 and Tier 3 reachable in the first season for regulars, Tier 4 usually requiring sustained cross-season evidence, Tier 5 generally a year-two outcome for true core players, and Tier 6 remaining editorial. That keeps the front of the card alive without making the tier ladder cheap. citeturn24search5turn36search0turn30search8

#### Open questions for future rounds

The open tuning question is not philosophy but cadence math: how many games, points, wins, or role events should map to a “monthly visible movement” for your actual roster? That needs simulation against your historical ingest data.

### Anti-pyramid calibration and target distributions

#### Survey

Live-service card systems manage distribution in three main ways: they widen the mid-tiers, they use unlock gates, and they introduce new prestige layers only when the ecosystem is ready. NHL 25’s “reworked card tiering system” explicitly widened Gold to 80+ OVR to represent more leagues and stars. Diablo IV unlocks Torment difficulties only after specific milestones. Destiny separates permanent title ownership from temporary seasonal gilding. NBA 2K25 separates year-long REP from seasonal 40-level resets. All four are different forms of “don’t let a single ladder do all the work.” citeturn9search2turn18search1turn30search8turn36search0

MLB The Show’s 2023–2024 Sets/Seasons experiment is also relevant, even though your site should not copy it directly. SDS tried to keep lineups fresh by making some modes season-restricted while leaving Core cards and Wild Cards to preserve continuity. That reflects a real industry problem: if nothing is gated, old progress crowds out new interest; if everything is reset, legacy value vanishes. citeturn25search0turn25search3turn25search7

#### Anti-patterns

For your club, both extremes are wrong. A pure Pareto where almost everyone sits at Tier 1 forever will feel insulting and socially toxic. A flat distribution where everyone reaches Epic or Legendary quickly destroys the symbolic value of the frame system. The most dangerous error is to set thresholds once from first-principles intuition and never re-check how the roster actually distributes across seasons. That is how “everyone Bronze” and “everyone Gold” both happen. citeturn9search2turn36search0turn16search7

#### Recommendation for your case

The right target is a **managed pyramid centered on Tier 2 and Tier 3**, not a bell curve and not a harsh Pareto tail. Over a multi-year arc for 10–15 active players, I would target something like this among active cards: Tier 1 for new or irregular members only; Tier 2 and Tier 3 as the main body; Tier 4 as a small inner circle; Tier 5 as occasional and hard-earned; Tier 6 as manual and often zero active cards at a time. Translated to your actual roster, that usually means **2–3 players at Tier 1, 3–4 at Tier 2, 3–4 at Tier 3, 1–2 at Tier 4, 0–1 at Tier 5, and 0 active Tier 6 most of the time**. citeturn36search0turn18search1turn30search8

Your existing guardrails are directionally correct: no high tier without a games-played floor, no goalie quality without a goalie-games threshold, and Mythic by manual approval. I would add three more. First, upper tiers should require success on **both** a quality axis and a longevity axis. Second, rate-based badges should have minimum GP or TOI before they can materially move tier. Third, Tier 5 and above should require either multi-season evidence or one genuinely club-defining record, not just a spike season. That makes the ladder robust to small-sample noise. citeturn13search0turn13search5turn18search1

#### Open questions for future rounds

A future round should run a Monte Carlo or backtest against your actual career totals to see how many players would have landed in each tier under several threshold sets. That is the fastest way to de-risk the anti-pyramid problem before implementation.

## Card face and sub-progression

### Visual hierarchy and information density on small card formats

#### Survey

Physical sports cards have been remarkably consistent for decades about what belongs on the front and what belongs on the back. urlBeckettturn28search0 describes 1970–71 Topps hockey cards as front-first identity objects with name, team, and position on the face while biography and full statistics live on the back; 1968–69 Topps backs carried biography, last-season stats, career stats, and even a cartoon fact; and 1991–92 Pinnacle used a premium black front with strong photography while pushing biography, profile, and statistics to the reverse. The durable physical-card rule is simple: **front for instant identity and desire, back for proof and density**. citeturn28search0turn28search3turn28search7

Digital card games behave the same way under stricter space constraints. A Pokémon TCG card front already has to fit a name, HP, type, illustrator/set/rarity markers, one Ability, one or more attacks, weakness, resistance, and retreat cost. Marvel Snap cards compress even harder: the face fundamentally communicates cost, power, art, and one text block, while cosmetic upgrades mostly work through the frame and finish rather than through extra front-face widgets. Those systems survive because they do **not** keep adding equally loud front-face tokens every time a new progression layer exists in data. citeturn35search7turn35search8turn35search0turn16search0

Sports-card prestige treatments also suggest how to distinguish rare from merely shiny. urlToppshttps://www.topps.com, urlUpper Deckhttps://www.upperdeck.com, and urlPaninihttps://www.paniniamerica.net all lean on **serial numbering, discrete parallel names, special materials, or provenance cues**, not just “more glow.” Upper Deck product pages foreground jersey-numbered parallels, /10 auto patches, and 1-of-1 shield/logo cards; Panini’s official previews similarly ladder rarity down through numbered parallels to 1/1. The principle is that true rarity needs a **different signal channel**, not just amplified effects on the same channel. citeturn37search6turn37search4turn37search0turn22search7

#### Anti-patterns

The face of a 264px card breaks when multiple layers all compete for “important.” A tier frame, a hot-streak chip, three badge icons, a captain patch, a club-record marker, and a variant border can each be a good idea individually and still form an unreadable whole together. The cognitive failure mode is icon soup. The aesthetic failure mode is that earned proof, current form, and rarity all try to dominate the same visual channel. citeturn35search7turn16search0turn28search3

That is why “max 5 badges on the front” reads too high for regular cards. Five is plausible only on a deliberately expanded, ceremonial, or detail-focused surface. It is not where strong small-card precedents converge. On standard faces, the frontier is closer to **one major proof and one or two supporting signals**. citeturn35search7turn35search8turn16search0

#### Recommendation for your case

Your stated “max 1 major + 2 minor augmentations” rule is excellent and should become the core precedence rule for the whole face. When space is contested, the hierarchy should be: **tier treatment first, signature proof second, current-form state third**. Everything else loses to those three and moves to the back. Concretely, on a normal front card I would prioritize in this order: frame/theme; lead stat and identity line; one signature badge or plate; one temporary form chip; one club-duty patch such as captain/alternate if it outranks the form chip. Everything else goes to the detail view. citeturn28search0turn16search0turn24search3

I would change the blueprint’s “max 5 badges on any front card” to a stricter rule: **0–1 front badges at Tier 1–3, 1 at Tier 4–5, and at most 3 on Tier 6**. The rest should be represented through the frame, the signature plate, and the back/detail view. If you want a Tier 6 card to feel packed, do it through a bespoke title plate, legacy banner, and provenance/lore marker rather than through five equal-size icons. citeturn37search6turn37search0turn35search7

Mythic should be distinguished by **curation and provenance**, not by escalating every existing effect. Use one-off naming, a lore plate, year ribboning, special matte/foil logic, or a finite issuance marker in the style of serial-numbered parallels. “Tier 5 with extra glow” is a weak signal; “the only card ever granted this club-history crown” is a strong one. citeturn37search4turn37search0turn22search7

#### Open questions for future rounds

A later visual round should test two or three front-face precedence mockups at actual 264px and hover states. The blueprint is close here conceptually; the unresolved question is micro-layout, not system direction.

### Badge and sub-progression design

#### Survey

The clearest digital precedents for badge systems split into two camps. NBA 2K uses many badge families, but it constrains them through tiering and eligibility: badge cards upgrade Bronze to Silver to Gold to Hall of Fame, some players are restricted by position and play style, and the strongest badges are not uniformly available. Destiny uses a different pattern: a base Seal/Title proves a large enduring accomplishment, while gilding adds a temporary seasonal overlay that resets. Marvel Snap’s Character Mastery is a third type again: a 30-level per-character cosmetics track whose underlying accumulation is large, but whose presentation remains structured and gated. citeturn31search3turn31search5turn30search8turn34search1

EA’s sports-card modes also distinguish between short-term objective ladders and longer-term milestone ladders. FC separates daily, weekly, seasonal, dynamic, foundation, and milestone objectives. NHL 19 similarly split objectives from milestones. The practical lesson is that sub-progression feels legible when families are grouped by **time horizon and role**, not when everything is simply another badge with another threshold table. citeturn29search0turn29search1

#### Anti-patterns

Achievement bloat happens when a player can no longer answer a simple question: “what is this card known for?” Thirty-three badge families are not automatically too many in data, but they are almost certainly too many as **equally promoted identity signals** for a 10–15 person club. Precision can also become fake sophistication. A `cardWeight` scale of 0–4 looks nuanced, but unless you have a model that genuinely distinguishes the difference between 2 and 3 with confidence, it may simply create tuning anxiety. citeturn34search1turn29search0turn31search3

Meta-badges are the clearest trap. Once the system starts rewarding the accumulation of badges rather than hockey evidence itself, it drifts toward the “achievement page about the achievement page” problem that players perceive as paperwork. Destiny’s base-title-plus-gilding model works because the extra layer is sparse and socially legible. A badge-of-badges stack on your site probably would not be. citeturn30search8turn29search1

#### Recommendation for your case

Keep the full badge catalog in the data model if it is useful for future-proofing and back-card richness, but cut the **player-facing identity layer** down aggressively for V1 and probably V2. I would launch with around **8–12 player-facing badge families** plus **4–6 club/team-context families**, and hide or de-emphasize the rest until they prove their value. That is enough variety to let players feel distinct without creating noise. citeturn31search3turn34search1turn29search1

I would also simplify `cardWeight` from 0–4 to three buckets: **core**, **supporting**, and **flavor**. In practice that can still be encoded numerically, but the design language should not pretend to more precision than your club-scale data supports. Core families may influence tier meaningfully; supporting families should strengthen or validate edge cases; flavor families should mostly affect identity, add-ons, or the back. citeturn13search0turn34search1

Your front-card display rules are directionally strong: strongest-only at lower tiers, signature plate at higher tiers, broader spread only at Mythic. I would sharpen them further: Tier 1–2 gets at most one visible badge family; Tier 3 gets one if it is unusually strong; Tier 4–5 gets one signature family plate and one optional supporting chip; Tier 6 gets the best three if—and only if—they tell a coherent story. Do not add meta-badges in V1. If you want summary identity, use an **archetype subtitle** derived from the strongest two families instead. citeturn31search3turn30search8turn34search1

#### Open questions for future rounds

The main follow-up question is which 8–12 badge families should be “front-layer” families for your club. That should be answered empirically by checking which drafted families most cleanly separate your real players into recognizable identities without redundancy.

## Enhancements and multi-year structure

### Augmentations, enhancements, and editorial versus automated state

#### Survey

Temporary card state works well when it is either clearly time-bound or clearly event-bound. MLB The Show’s Supercharged cards are a strong example: a real-life feat triggers a temporary Supercharged Boost and unique border art, and that bonus stacks with the card’s permanent Parallel boosts. NHL HUT has long used event-based dynamic items similarly, including All-Star and Playoff items that gained boosts from real-world performance; older HUT playoff items even hard-expired with the playoffs. Destiny’s gilded titles are a softer analogue: the base title remains, the gilded overlay is seasonal and temporary. citeturn24search3turn23search0turn23search4turn23search2turn30search8

Permanent upgrades are a different lane. EA SPORTS FC’s Evolutions are explicit permanent upgrades earned through gameplay challenges once a player is submitted to an Evolution slot. That separation between a **lasting identity layer** and a **temporary state layer** is healthy. It prevents the player from wondering whether everything on the card is ephemeral. citeturn23search7

#### Anti-patterns

The anti-pattern is trying to model temporary heat with too much hidden math. If “Hot Streak” slowly decays behind the curtain, players cannot predict it, and your admin will eventually have to explain edge cases. Hard-expire windows are usually easier to understand socially. Another anti-pattern is putting negative social labels on the main surface. Locker-room humor works when it is voluntary, contextual, or private. It often lands badly when the system publicly tags a real teammate with a mocking label they did not choose. citeturn24search3turn23search2turn30search8

#### Recommendation for your case

Use **hard-expire or hard-refresh windows**, not smooth decay curves, for temporary enhancements. For example: Hot Streak could require a trigger event in the player’s last 5–8 club games or last 14 days; Clutch could require a recent sequence of decisive goals/wins in a defined recent window; Heater could expire cleanly after the next ingest if the condition is no longer met. This is much easier to explain than a hidden score that drifts. citeturn24search3turn23search0turn30search8

Reserve human curation for the places where **club meaning** exceeds raw computation: Mythic approval, captain/alternate patch assignment if your source-of-truth is messy, club-record callouts when tie-breaks or historical edge cases matter, playoff-hero moments, lore blurbs, and legacy honors. Everything mundane should be automated; everything sacred should be curated. That is also how physical-card culture handles prestige—automation for the base structure, editorial discretion for the truly special inserts and commemoratives. citeturn37search6turn22search7turn23search4

For “Meme / Locker Room” augmentations, make them **opt-in, positive, and secondary**. Best practice for your environment is not to auto-assign public joke labels. Put them on the back, in history, or behind a player-equip toggle. If a player thinks “Empty Net Specialist” is funny, let them pin it. If they do not, the system should not pin it for them. citeturn34search0turn30search8

#### Open questions for future rounds

You still need explicit trigger windows for each temporary enhancement, plus a decision on whether negative recent-form states should exist anywhere. My recommendation is no negative front-face states at all.

### Multi-year longevity across NHL titles

#### Survey

Yearly Ultimate Team ecosystems mostly reset. FC’s official carry-over guidance talks about transferring **FC Points** from FC 25 to FC 26, which is telling because it implies the broader club economy does not carry over in the same way. FC objectives and reward levels also reset by season. HUT is similarly built as a contained yearly mode with fresh progression, rotating rulesets, and title-specific economies. That structure serves commercial UT ecosystems well, but it is not a requirement for your site. citeturn27search0turn29search0turn25search9

The more interesting precedent for you is the hybrid model. MLB The Show 24’s Seasons design says everyone starts fresh each season, but it also preserves continuity through Core cards and Wild Card slots. NBA 2K25’s MyTEAM REP system goes further by making REP a year-long success measure that does not reset like season levels. Destiny’s legacy seals give a second useful lesson: seasonal gilding can reset while the original title remains permanently visible and equippable. citeturn25search0turn25search3turn36search0turn30search8turn15search0

#### Anti-patterns

A full yearly reset would be a bad cultural fit for BGM. It would erase the very thing your cards are supposed to celebrate: a multi-year club career. But a single monolithic forever-card also risks flattening future excitement if the same few cards reach a symbolic ceiling too early and then stop changing. The anti-patterns are therefore **amnesia** on one side and **stagnation** on the other. citeturn25search0turn36search0turn15search0

#### Recommendation for your case

The best architecture for your site is a **career card with season variants/subcards**. The career card should hold permanent tier, level, all-time badges, club records, and legacy honors. Each NHL title—NHL 26, NHL 27, NHL 28—should then generate a season-specific variant or subcard with its own recent-form layer, title-specific badges, and current-year context. That gives you UT-style freshness without UT-style amnesia. citeturn25search0turn36search0turn30search8

This also solves the “what happens in year three?” problem. You do **not** need to add new main tiers every year. Instead, you add new season banners, title ribbons, launch-edition variants, milestone overlays, and fresh season-specific achievements while keeping the career frame alive. If a player is already a long-term Franchise or Legend card, the interesting new question each year becomes: “what chapter was this season?” rather than “did the tier ladder go higher?” citeturn25search3turn36search0turn34search1

Legacy Mythic recognition should persist permanently once granted, but current-season hotness should not be forced to match it. A retired or semi-active player can still have a career-level Mythic honor while a current-season subcard is quieter. Destiny’s legacy-seal approach is the right mental model here: preserve earned history, reset only the temporary overlay. citeturn30search8turn15search0

#### Open questions for future rounds

The follow-up question is how season variants should be displayed in navigation: year tabs, carousel variants, stacked mini-cards, or a back-card timeline. That is more of a UI study than a progression study.

## Detail views and shipping scope

### Card backs and detail views

#### Survey

Physical sports cards have already solved the front-versus-back split. Beckett’s hockey set descriptions repeatedly describe the front as photo plus identity and the back as the place for biography, player profile, year-by-year statistics, and career context. That tradition is not accidental. It exists because the front is for recognition and desire, while the reverse is for evidence and memory. citeturn28search0turn28search3turn28search7

Digital card games use detail views more selectively, but they still matter. Pokémon support documentation explicitly points users to enlarged screens when they want variant or rarity detail, and Marvel Snap’s Character Mastery and Custom Card flows assume that players will inspect a deeper card surface when they want to understand cosmetics, progression, or customization. The pattern is that players do **not** read the back constantly; they open it when they need an explanation, a comparison, or a brag screen. That is exactly the role your back/detail view should serve. citeturn35search1turn34search0turn34search1

#### Anti-patterns

The biggest mistake is turning the back into a junk drawer. If the front is “identity” and the back is “everything else,” the back stops being useful because it has no hierarchy of its own. A second mistake is surfacing “best games” by the loudest raw box score only. In a small private league, the most meaningful game is not always the one with the most points; it may be the game that best exceeded the player’s baseline, broke a record, or earned internal club legend status. citeturn28search0turn24search5

#### Recommendation for your case

The back should answer five questions, in this order: **Why is this card this tier? What changed recently? What is this player best at? What moments define this card? What is left to chase?** If a detail screen does not answer those questions quickly, it is not doing its job. This means the back should prioritize tier explanation, badge progress, recent-form evidence, one or two signature highlights, then card history/lore. The full stat warehouse can still exist lower on the page. citeturn28search0turn34search1turn24search5

For “best games,” use a hybrid selector: one automated “best game by context” card, one highest box-score game, and one editorially pinned club-memory slot. The automated contextual pick should be something like highest performance delta above the player’s own baseline or biggest contribution to a dominant win or comeback, rather than raw points alone. That matches your “front creates desire, back explains why it is deserved” principle much better than a simple top-three-by-PTS list. citeturn24search5turn24search3turn28search6

#### Open questions for future rounds

A later round should define the exact “best game” score and whether it should be role-adjusted for goalie and defenseman performances.

### Implementation order and the smallest shippable V1

#### Survey

Most mature card ecosystems do not launch with every prestige layer firing at once. HUT’s official onboarding emphasizes starter lineups, a captain choice, and one unified XP path. Diamond Dynasty starts with a simple tutorial flow, an automatically chosen initial team, and then a few strong progression hooks such as XP reward paths, Captain boosts, and Parallel boosts. Marvel Snap’s earliest progression is incredibly small-scope—just upgrading a card’s rarity and frame—but it feels real immediately because the visual change is inseparable from the progression event. citeturn9search2turn9search5turn24search3turn24search5turn16search0

The common MVP pattern is therefore: **one obvious front-face difference, one obvious longer track, and one place to inspect detail**. Systems add premium ornament later. They do not wait to make the first version feel visually different. citeturn9search2turn24search5turn16search0

#### Anti-patterns

The V1 failure mode is shipping a technically correct data model with no visceral front-face payoff. If users see new labels, hidden scores, and back-card data but their carousel card still basically looks like the old carousel card, they will read the whole system as “stats with more words.” The opposite failure mode is trying to launch Tier 1–6 premium treatments, animations, and every badge family before the underlying evidence layer is reliable. citeturn16search0turn24search5turn9search2

#### Recommendation for your case

Your proposed V1 is **close**, but it needs one stronger visual promise on the front. The minimum V1 that will actually feel like progression is: reliable tier calculator for Tier 1–3; visibly different frame treatments for those tiers; one permanent signature badge slot; one temporary footer/status slot; a back/detail panel that explains the why; and a non-regressing level track. That is the smallest version that turns the card from “baseline stats tile” into “progression object.” citeturn24search5turn16search0turn9search2

So yes, deferring animations, foil effects, and elite premium polish is the right call. But do **not** defer the first clear visual differentiation. Frame treatment, signature proof, and one state slot must land in V1 or the rest of the system will not emotionally register. Put differently: foil can wait; **hierarchy cannot**. citeturn16search0turn37search6turn28search3

#### Open questions for future rounds

The main follow-up is whether V1 should include only player badges or one or two team-context badges as well. My view is that one team-context slot is enough if it supports club identity without crowding the face.

## Recommended blueprint changes

1. **Make fixed thresholds the player-facing rule, and use percentiles only as an offline calibration tool.** Do not use live percentile cohorts to compute visible tiers after each ingest. Tune thresholds from your historical club data, then freeze them for the season/title cycle. citeturn13search2turn24search5

2. **Compute Tier separately for forwards, defensemen, and goalies.** Do not use an all-position pool. Add explicit defense-value support so defensemen are not graded as low-scoring forwards. citeturn13search0turn38view0

3. **Keep sub-role identity out of the main tier math for now.** Sniper/playmaker/enforcer/two-way should be badge/archetype outcomes, not first-class tier categories, until you have more seasons of club data. citeturn11search4turn31search3

4. **Add hard eligibility gates to upper tiers.** Upper tiers should require both quality and longevity, with minimum GP/TOI floors for rate-based inputs and stricter goalie minimums. citeturn13search5turn18search1

5. **Target a managed pyramid centered on Tier 2–3.** For a 10–15-player club, design for most active players to sit in Tier 2–3, very few in Tier 4, occasional Tier 5, and manual Tier 6. citeturn36search0turn30search8

6. **Reduce the front-face badge budget.** Change “max 5 badges on any front card” to a stricter rule: 0–1 at Tier 1–3, 1 at Tier 4–5, and at most 3 at Tier 6. citeturn35search7turn16search0

7. **Keep the 6×5 badge ladders in data if you want, but stop treating all 30 steps as equally visible.** Expose badge families mostly as banded milestones and signature plates rather than as a constant stream of front-card events. citeturn34search1turn24search5

8. **Collapse `cardWeight` from 0–4 into three design buckets.** Use something like core / supporting / flavor rather than pretending to more precision than your dataset can support. citeturn13search0turn31search3

9. **Launch with fewer front-layer badge families than exist in the full catalog.** Keep the whole catalog in the database, but make only 8–12 player families and 4–6 team/context families part of the identity layer initially. citeturn34search1turn29search1

10. **Use clean hard-refresh windows for temporary enhancements.** Hot Streak, Clutch, and similar states should turn on and off by recent-game windows, not by hidden decay curves. citeturn24search3turn23search0

11. **Do not put negative joke tags on the front automatically.** Locker-room or meme augmentations should be opt-in, back-card only, or player-equipped. citeturn34search0turn30search8

12. **Formalize a front-card precedence ladder.** Frame/theme always wins; signature proof is next; current-form state is third; all other markers lose to those channels and move to the back. citeturn28search0turn16search0

13. **Define Mythic as curated provenance, not amplified ornament.** Mythic cards should gain a bespoke title plate, legacy banner, lore/provenance marker, and/or finite issuance signal—never just “more glow.” citeturn37search6turn37search0turn22search7

14. **Adopt a career-card plus season-variant architecture.** Keep lifetime tier/badges/records on the career card and move title-specific form and season achievements into NHL 26 / NHL 27 / NHL 28 subcards or ribbons. citeturn25search0turn36search0turn30search8

15. **Design the back/detail view around explanation, not storage.** Put tier reasons, next unlocks, recent form, and signature moments above the full-stat archive. citeturn28search0turn34search1

16. **Strengthen V1 visually rather than mechanically.** Keep premium animation and foil for later, but ship V1 with clearly differentiated Tier 1–3 frames, one signature badge slot, one status slot, and a back that explains the evidence. citeturn16search0turn24search5turn9search2

17. **Run a threshold backtest before locking the ladder.** The next research round should use your actual historical club data to simulate tier distributions, time-to-next-visible-change, and edge cases for defensemen and goalies. citeturn13search2turn13search5
