# Player Card Progression & Customization — Design Brief

**Status:** consolidated 2026-10-05 from `blueprint.md`, `badges.md`, the round-1
deep-research report, and the `player-card` specs. Where the research disagreed
with the blueprint, **this brief follows the research** and says so. This is a
design brief, not an implementation plan: **none of this is built yet**. The
site ships only the baseline card (§3).

Companion file: [`badge-catalog.md`](badge-catalog.md) (badge families,
threshold ladders, data-availability status). Read both.

---

## 1. What we are making

A collectible, progression-driven **player card** for a private hockey club
site. One job: make a player feel they are building a visible club identity
over time. The card must read as a stats object first, and feel earned,
customized and collectible second.

- **Club:** Boogeymen ("BGM"), EA NHL Pro Clubs (EASHL), ~10–15 active members
  who know each other. Audience is the team itself — no monetization, no
  FOMO timers, no daily/weekly chores, no public leaderboards pressure.
- **Lifespan:** multi-year across NHL 26 → 27 → 28. A player's career is the
  thing being celebrated.
- **Tone:** dark, aggressive, competitive esports-hockey. Hockey trading card
  crossed with esports player card. Not soft, corporate, playful, or generic
  fantasy-RPG.

### Core rule

```txt
Stats earn badges.
Badges influence card status.
Card status controls tier / theme.
Recent moments add enhancements.
Special achievements add augmentations.
Mythic cards are curated, not automatic.
```

Core loop: play games → stats update → milestones unlock → badges upgrade →
card evolves → player gets showcased.

## 2. Brand and visual constraints

Always-dark. No light mode. Red accent, sharp edges, high contrast, scoreboard
style panels, minimal decoration.

| Token              | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| Page background    | `#1a1819`                                                 |
| Panel / raised     | `#232122` / `#2a2829`                                     |
| Hairline border    | `#3a3839`                                                 |
| Brand red (accent) | `#e84131` (strong `#c2321f`, readable `#ef6a5e`)          |
| Charcoal / paper   | `#323031` / `#ebebeb`                                     |
| Text ramp          | fg-1 `#ebebeb` … fg-6 `#6e6b6c`                           |
| Result colours     | win `#10b981`, loss `#ef6a5e`, OTL `#f59e0b`              |
| Fonts              | Barlow (body), Barlow Semi Condensed (numerals, headings) |

Palette PDFs: `docs/branding/palettes/`. Logos/flags/icons/rink art:
`docs/branding/`. Skull + stick branding is part of the identity. Red is
used sparingly; keep it meaningful.

**Position colours** (pills, chips; vivid, use sparingly): C `#c0061c`,
LW `#23cf1d`, RW `#2659cf`, LD `#13dfc8`, RD `#ece335`, G `#6f00a5`.
Pill rule: text = base hex, border = base @ 40%, fill = base @ 10%.

**Archetype pills already exist** (11 skater archetypes, 3 sizes: Compact /
Flagship / Feature; goalies have none). Forwards: playmaker, sniper,
power-forward, grinder, two-way-fwd, enforcer. Defense: defensive-d,
offensive-d, two-way-d, enforcer-d, puckmover. Card archetype labels should
reuse these, not invent a second taxonomy. Source: `apps/web/src/components/ui/archetype-pill.tsx`.

## 3. The baseline card (what exists today)

Vertical card, **264px wide**, used in the home carousel, roster grid and depth
chart. Built from the design bundle (`components-card-carousel-v3.html`,
`components-player-card.html`). It is the stable shell; progression adds
layers on top and must never clutter it. Reference images:
`docs/design/mockups/PlayerCardBluePrint.png`, `PlayerCardBluePrint_2.png`,
`docs/design/card-examples/` (9 images).

Fixed anatomy — keep identical at every tier:

| Zone             | Contents                                                             |
| ---------------- | -------------------------------------------------------------------- |
| A Identity block | jersey number (largest element), position pill, W-L-OTL, win %       |
| B Portrait       | silhouette placeholder today (no player photos); avatar/render later |
| C+D Name row     | platform icon (PS/Xbox), gamertag (≤2 lines, truncates)              |
| E–H Stat row     | four role-aware stats; **H is the featured stat, ~33% larger**       |
| I–K Meta row     | I flag · J team crest · **K spare slot = the single status slot**    |
| Add-on layer     | badges, augmentations, enhancement chip, frame/variant trim          |
| Back / detail    | full progression and evidence (§9)                                   |

Default stat rows — skater **GP · G · A · PTS** (PTS featured); goalie
**GP · W · SV% · SO**. Role-aware swaps allowed from Tier 3 up: defense
**GP · Hits · Takeaways · PTS**, centre **GP · FO Won · A · PTS**, goalie
alternate **GP · W · Saves · SV%**. Top-tier cards swap in the player's
primary badge stat.

States: top red rule (grey at rest, red on hover/active), hover scale
1.02–1.05 with red border glow, skeleton loading, depth-chart "DEPTH" amber
outline. Mobile stacks A over B, stats go 2×2, meta row stays horizontal.

**The front never becomes a spreadsheet.** If a detail doesn't help someone
understand identity in under two seconds, it belongs on the back.

## 4. Progression model — four independent layers

Keep these separate. Never bump tier because of a hot streak or team award.

1. **Tier** (slow, badge-driven, lifetime status) — §5
2. **Level** (participation progress inside a tier) — §5
3. **Badges** (permanent achievement evidence) — §6
4. **Add-ons** — temporary **enhancements** (§7) and permanent/event
   **augmentations** (§8)

### Career card + season subcards (research-driven, new)

Do **not** reset yearly and do not add new top tiers each year.

- **Career card** holds permanent tier, level, all-time badges, club records,
  legacy honours.
- **Each NHL title** (NHL 26 / 27 / 28) gets a season variant/subcard or ribbon
  with its own recent-form layer, title-specific badges and context.
  Year 3 question becomes "what chapter was this season?", not "did the ladder
  go higher?". Legacy Mythic honours persist forever; the season card can be
  quiet. (Mental model: Destiny seals — base title permanent, gilding seasonal.)
- Open UI question for you: how to navigate season variants (year tabs,
  carousel variants, stacked mini-cards, back-card timeline).

## 5. Tiers and levels

| Tier | Rarity    | Status label    | Default theme  | Meaning                                    |
| ---: | --------- | --------------- | -------------- | ------------------------------------------ |
|    1 | Common    | Prospect        | Away           | New, depth, or early contributor           |
|    2 | Uncommon  | Rookie          | Home           | Regular contributor with basic proof       |
|    3 | Rare      | Stud            | Alternate      | Clear role identity, meaningful production |
|    4 | Epic      | Elite           | Carbon-Fiber   | High impact, several strong badge families |
|    5 | Legendary | Franchise       | Smoke          | Club-history player or current pillar      |
|    6 | Mythic    | Legend / 1-of-1 | Curated Mythic | Manual showcase of true legacy only        |

Ladder: Prospect → Rookie → Stud → Elite → Franchise → Legend. Show the
status label on the card face (sounds like hockey); rarity is secondary.

**Level** = 10 per tier, based on steady participation (GP, wins, role
production, active seasons, goalie starts). **Never downgrades.** Recent form
is shown by enhancements, not level loss. Display as pips/progress — at most
**one progress bar on the front**.

**Tier computation (rules, not final numbers):**

- Weighted result of the player's best role-relevant badge families.
- **Separate pools for forwards, defensemen, goalies** (defense is not a
  low-scoring forward). Fixed thresholds, frozen per title cycle — never live
  percentiles.
- Skater inputs: Goals, Assists, Hits, Faceoffs Won, Takeaways, Wins, Games
  Completed, Hat Tricks. Goalie inputs: Saves, Shutouts, Goalie Wins, Goalie
  Games. Team badges never raise individual tier.
- Guardrails: no Tier 4+ without a games-played floor and both a quality and a
  longevity signal; rate stats need minimum GP/TOI; goalies need goalie-games
  minimums; Tier 5+ needs multi-season evidence or one club-defining record;
  `future`/`manual` badges never affect tier; **Tier 6 requires admin
  approval**.
- Unlock sketch: T1 any milestone · T2 3+ T2 milestones · T3 3+ T3 · T4 2+ T4 ·
  T5 2+ T5 or a club record · T6 manual.

**Target distribution (managed pyramid centred on Tier 2–3)** for ~10–15
active players: 2–3 at T1, 3–4 at T2, 3–4 at T3, 1–2 at T4, 0–1 at T5, usually
0 at T6. Pacing: an active player (~3 games/week) should see **one visible
card change per month** (level pip, minor badge threshold, back-card unlock,
or enhancement) — rarely a tier jump. T2–T3 reachable in the first season for
regulars; T4 needs cross-season evidence; T5 is a year-two outcome for core
players.

> ⚠ **Thresholds are uncalibrated.** See `badge-catalog.md` §Reality check:
> with ~450 matches on record the top career goal total is 269, so most badge
> ladders above Tier 2 are currently unreachable. Design all six tiers, but
> don't bind any tier to specific numbers in the design.

## 6. Badges and the front-card budget

Badge = permanent evidence from stat thresholds
(`stat total → family → tier → level → card effect`). 36 families exist in data
(21 player/goalie, 15 team), each 6 tiers × 5 levels (team: 4 tiers). **Keep
the full catalog in data and on the back, but promote only 8–12 player families
and 4–6 team families as identity signals at launch.** Weights collapse to
three buckets: **core** (can move tier) / **supporting** (validates edge cases)
/ **flavor** (identity & back only). No meta-badges ("badges of badges").

Badge families (names to design icons/plates for): Scoring (First Blood,
Trigger Man, Hat Trick Hunter, Breakaway Menace, Goal Machine) · Playmaking
(Setup Artist, Tape-to-Tape, Hands Department, Dangle Merchant, Offensive
Engine) · Physical (Body Count, Glass Breaker, Enforcer, Fight Night, Penalty
Box Royalty) · Defensive (Pickpocket, Shot Eater, Faceoff King, Defensive
Anchor, Two-Way Demon) · Experience (Rookie Season, Roster Regular, Veteran,
Franchise Player, Club Legend) · Goalie Experience (Crease Rookie, Starting
Goalie, Workhorse, Franchise Netminder, Masked Legend) · Saves (Save Stacker,
Robbery Artist, Last Line, Poke Check Menace, Brick Wall) · Shutouts (Locked
Door, Clean Sheet, No Entry, Zero Tolerance, The Wall). Team families
(showcase-only, never raise individual tier): Club Experience (Club Founded,
Regulars, Full Squad, Built Different, Franchise Club) · Winning (Win Column,
Statement Win, Full-Squad Dub, Mercy Rule, Dynasty) · Team Offense (Goal
Factory, Red Light District, Power Play Unit, Special Teams Killer, Offensive
Machine) · Team Defense (Lockdown, No Easy Ice, Shutdown Crew, Perfect Kill,
Defensive Dynasty).

Badge tier meaning: 1 Rookie/Starter · 2 Regular · 3 Proven · 4 Veteran ·
5 Franchise · 6 Legend (rarity Common → Mythic).

**Front-card badge budget (supersedes the old "up to 5"):**

| Tier | Front treatment                                                              |
| ---: | ---------------------------------------------------------------------------- |
|  1–2 | At most one tiny badge, or empty status slot                                 |
|    3 | One featured badge if unusually strong (no strip)                            |
|  4–5 | One signature badge plate + one optional supporting chip + one progress hint |
|    6 | Curated emblem; best ≤3 badges, only if they tell one coherent story         |

How badge level looks: small badge (T1–2 — small icon by the stat, tooltip,
no layout change) → featured badge (T3–4 — under the name, border upgrade,
related stat highlighted; e.g. Hits T4 = cracked-glass border + Enforcer
label) → signature badge (T5 — in the art, foil background, larger stat
plate, unlocks a title, e.g. "Franchise Sniper") → mythic badge (T6 — full
variant, animated border, showcase slot, 1/1 commemorative).

## 7. Enhancements — temporary, "what's happening now"

Refresh on each ingest. **Hard-expire windows, no hidden decay curves** (e.g.
Hot Streak = trigger in last 5–8 club games or 14 days). Never change tier.
They may affect carousel order and one front chip.

| Enhancement | Trigger direction                    | Treatment                              |
| ----------- | ------------------------------------ | -------------------------------------- |
| Hot Streak  | point / goal / win streak            | red glow, small HOT marker, stat pulse |
| Clutch      | OT goal, GWG, close-game goalie win  | stopwatch icon, clutch stamp           |
| Heater      | strong last 5 games                  | recent-form chip, mild animated trim   |
| Lockdown    | low GA, takeaways, shutouts          | shield/ice trim, defensive label       |
| Stolen Game | goalie win under heavy shot pressure | save-counter emphasis, goalie plate    |

**No negative states on the card face, ever** (no "Ice Cold" front chip).

## 8. Augmentations — permanent or event add-ons

Categories: badge (Hat Trick, Shutout, GWG, OT Winner, 30+ Saves, 90% Save
Game) · role (Captain / Alternate patch, Goalie Spotlight) · event (Playoff
Hero, Rivalry Game, Game Night Hero) · record (Club Record, Team Leader, Career
High) · variant (Home, Away, Alternate, Throwback, Glitch, Playoff) · mythic
(1/1 serial, custom title, lore panel).

**Face limit: 1 major + 2 minor augmentations.** Major: One-of-One, Club
Record, Playoff Hero, Captain patch, signature badge plate, Record-Breaker
frame. Minor: Hat Trick / GWG / Hot Streak markers, team-leader chip,
recent-form chip, small badge icon. Everything else → back.

### Front-face precedence (when space is contested)

1. Frame / theme (tier treatment) — always wins
2. Lead stat and identity line
3. One signature badge / plate ("signature proof")
4. One temporary form chip
5. One club-duty patch (Captain/Alternate) — outranks the form chip if both compete
6. Everything else → back

Rarity must use a **different signal channel**, not amplified effects on the
same one: serial number, bespoke title plate, provenance/lore marker.

## 9. Tier visual treatments

Same layout at every tier. **Higher tier ≠ more clutter; higher tier = better
presentation, stronger identity, better badge treatment.**

| Tier | Added info                                                     | Visual style                                                                                               |
| ---: | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
|    1 | Baseline only                                                  | Away theme, clean frame, minimal effects, basic border                                                     |
|    2 | Rookie label; highest badge in K                               | Home theme, darker bg, red trim, small hover glow                                                          |
|    3 | Archetype label; optional title line                           | Alternate theme, stronger red/black contrast, silver badge frame, larger/more dynamic image, diagonal cuts |
|    4 | Elite label, card level, one progress item ("Next: … 642/700") | Carbon-fiber texture, metallic border, animated red trim, signature slot, HUD overlays                     |
|    5 | Franchise label, career record, club rank ("#1 in Goals")      | Black/red smoke, skull watermark, larger render, premium stat plate, legendary glow                        |
|    6 | Legend label, 1/1 mark, Mythic title                           | Unique theme, mythic frame, large custom title, lore panel, serial                                         |

**Mythic is curated provenance, not "Tier 5 + glow".** Five Mythic sub-themes
(Tier 6 only), each with identity/visuals/title ideas:

- **Electric** — speed/offence/flash. Red-white lightning, glitch sparks, neon
  stat lines. Titles: Voltage, Power Surge, Red Lightning.
- **Frost** — cold, defensive, goalie-heavy. Frozen border, ice cracks, frosted
  skull, blue-white with red highlights. Titles: The Ice Wall, Sub-Zero.
- **Scorched** — scoring/violence/domination. Burnt edges, embers, red-orange
  smoke, goal-light glow. Titles: Scorched Earth, Firestarter.
- **Olympus Maximus** — club king, all-time peak. Marble/stone, gold-red,
  statue-style render, mythic crest. Titles: Olympus Maximus, The Immortal.
- **Future** — esports/glitch/cyber. Cyber grid, holographic HUD, RGB split,
  scan lines. Titles: Future Shock, System Override.

**Skater vs goalie.** Same layout, different visual language. Goalie: crease
lines, mask, blocker/glove, ice-wall/frost, locked-net, save counter,
red-goal-light denial. Skater: puck/stick, crosshair, passing-lane lines, hit
counter, faceoff dot, shield, shot trails, two-way split frame.
Identity titles — skater: Sniper, Playmaker, Enforcer, Two-Way Beast, Faceoff
King, Defensive Anchor, Overtime Assassin, Franchise Scorer; goalie: Brick
Wall, The Last Line, The Wall, Crease Demon, Shutout King, Shot Eater,
Masked Menace, Final Boss.

## 10. Customization

What belongs to the **system** (earned, automatic) vs the **player** (chosen)
vs the **editor/admin** (curated):

| Layer                                                                                          | Who decides                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Tier, level, badges, enhancements, record chips                                                | System (stats)                                                                                   |
| Season variants (Home/Away/Alternate/Playoff…)                                                 | System, per title/event                                                                          |
| Captain / Alternate patch, club-record callouts                                                | Admin (EA data messy)                                                                            |
| Mythic approval, 1/1 serial, title, lore blurb                                                 | Admin only                                                                                       |
| Playoff-hero / rivalry moments                                                                 | Admin-pinned                                                                                     |
| Locker-room / meme tags                                                                        | **Player opt-in only**, back-of-card by default; never auto-assigned, never negative on the face |
| _(proposal)_ Equipped title, pinned signature badge among earned ones, preferred featured stat | Player                                                                                           |
| _(later)_ Portrait: silhouette → avatar → render                                               | Player/admin                                                                                     |

Locker-room set (opt-in examples): Penalty Box Resident, Post Magnet, Almost
Had It, Lag Warrior, Certified Pylon, Empty Net Specialist.

**Variants** (each a distinct visual direction): Season edition (NHL 26 S1,
Launch Edition, Winter Classic…), Home (black/red, skull) vs Away
(white/silver, icy), Playoff (trophy, bracket texture, red slash per win),
Rivalry (warning-tape border, cracked ice, H2H badge), Milestone (auto on
100 goals, 250 pts, 500 hits, 50 wins, 10 shutouts, 1000 saves, first hat
trick/GWG), Throwback (old-card paper, print dots, "Archive Series"), Glitch/
Esports (RGB split, scan lines), Captain (big C/A patch, command frame).

**Special sets** (carousel/showcase content, not tiers): Team Leaders (goals,
assists, points, hits, +/-, saves, wins, SV%), Game Night Heroes (three
stars, GWG, best goalie…), Record Breakers, Playoff Heroes.

**Card condition** (Mint, Battle-Worn…) — optional flavour; no "Scuffed"/"Ice
Cold" on the face.

## 11. Back / detail view

The front creates desire; the back explains why it is deserved. It answers
five questions **in this order**:

1. Why is this card this tier? (tier + level explanation)
2. What changed recently? (recent form)
3. What is this player best at? (badge progress by family, next milestone —
   e.g. "Goals: 642 · Tier 4 L1 · next L2 at 700")
4. What moments define this card? (best games; signature highlights)
5. What is left to chase? (next unlocks)

Then card history/lore, unlocked variants, earned augmentations, and finally
the full season + career stat warehouse. Best games = hybrid: one automated
"best by context" (biggest delta above the player's own baseline, or biggest
contribution to a dominant win/comeback), one highest box-score game, one
editor-pinned club-memory slot. Mythic cards get a lore/provenance panel.

## 12. Carousel and showcase

Home carousel shouldn't rotate random players. Slots: Featured Player, Latest
Game Hero, Current Hot Streak, Team Scoring Leader, Goalie Spotlight, New
Variant Unlocked, Record Breaker, Playoff Hero, Rivalry MVP. Small labels:
NEW · HOT · RARE · PLAYOFF · MILESTONE · LEGENDARY · MYTHIC.

## 13. Add-on element library (approved vocabulary — never all at once)

- **Frames:** steel, carbon-fiber, smoke, ice, cracked-glass, playoff, rivalry,
  captain, record-breaker, mythic
- **Backgrounds:** dark rink, scoreboard panel, carbon fiber, red/black smoke,
  cracked ice, goalie crease, goal light, net mesh, club-crest/skull
  watermark, old-card paper, glitch HUD
- **Foils:** silver, red, ice, skull, holographic, blood ice, glitch, championship gold
- **Motion:** hover light sweep, 3D tilt, red trim pulse, foil shimmer, smoke
  drift, scan lines, RGB split, frost edge, goal-light flash, stat/badge pulse
- **Progress UI:** badge progress bar/ring, next-badge preview, milestone
  countdown, form sparkline (back only)

Restraint rules: readable at carousel size; featured stat always obvious; one
progress bar max on the front; don't animate every surface at once; no
novelty labels on the face; Mythic must feel curated, not just brighter.

## 14. Scope for V1 (what to design first)

Research verdict: V1 must have a **visible front-face payoff** — otherwise it
reads as "stats with more words". _Foil can wait; hierarchy cannot._

**V1 = Tier 1–3 calculator + clearly different Tier 1–3 frames + one signature
badge slot + one temporary status slot (footer K) + non-regressing level
track + a back panel that explains the why.**

Later (design the language now, ship after): Tier 4–5 premium frames,
animations/foil, augmentation rendering rules, enhancement engine visuals,
Mythic admin flow and themes, season-variant navigation.

## 15. Data reality (so designs don't promise what we can't show)

- Stats are ingested from EA's undocumented API every 5 min, stored, and
  aggregated per game title. Cards render from stored aggregates — never live
  EA calls.
- **Reliable:** GP, W/L/OTL, goals, assists, points, shots, hits, takeaways,
  faceoff wins, blocked shots, goalie saves/SV%/GAA/shutouts.
- **Not available from EA — do not design a slot around them:** faceoff %,
  shot coordinates, a stable player ID (gamertag is identity).
- **Need confirmation / manual:** dekes, breakaways, fights won, power-play
  goals, perfect PK. (Some goalie columns — desperation saves, poke checks —
  now exist in the DB; see catalog before treating them as `future`.)
- **Goalies are rare and low-sample** (the most goalie games any member has is 15).
  Goalie cards must look great at small numbers.
- No real portraits yet — silhouettes. Design must hold up with them.
- Platform icons: PlayStation / Xbox. Flags: country.

## 16. What to deliver (asks for the design pass)

1. Tier 1–3 skater card + goalie card (front), at 264px, showing the status
   slot, signature badge slot and level indicator.
2. One mockup each of Tier 4, Tier 5, and a Mythic example per sub-theme
   direction (at least two of the five).
3. Front-face precedence demo: a card with four competing signals, resolved
   per §8.
4. Back/detail view per §11.
5. Customization surface: how a player equips a title / pins a badge / opts
   into a locker-room tag.
6. Season-variant navigation (career card + NHL 26/27/28 subcards).
7. Carousel with label chips (§12).

Open design questions: micro-layout of the precedence ladder at 264px and
hover states; season-variant navigation pattern; how a level indicator reads
at a glance without becoming a second progress bar.
