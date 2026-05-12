# Collectible Player Card Design and Progression Blueprint

## 0. Refined Working System

This document is now the working design direction for player-card progression.
The original ideas below remain useful, but the system should be built from the
rules in this section first.

The card system has one job: make a player feel like they are building a visible
club identity over time. The card should be readable as a stats object, but it
should also feel earned, customized, and collectible.

The current site cards are the bare-bones baseline. The progression system adds
layers on top of that baseline instead of replacing it with clutter.

Core rule:

```txt
Stats earn badges.
Badges influence card status.
Card status controls tier/theme.
Recent moments add enhancements.
Special achievements add augmentations.
Mythic cards are curated, not automatic.
```

### 0.1 Card Anatomy

Every card has the same stable anatomy so the design can scale:

| Zone | Purpose |
|---|---|
| Identity block | Number, position, record, win percentage, tier/status label |
| Portrait block | Silhouette, avatar, generated player render, or profile image |
| Name row | Platform icon, gamertag/display name, optional title |
| Stat row | Four role-aware stats, with one featured stat |
| Footer/meta row | Flag, team crest, and one priority status slot |
| Add-on layer | Badges, augmentations, enhancement markers, variant trim |
| Back/detail view | Full progression, badge progress, best games, card history |

The front card should never become a spreadsheet. If a detail does not help the
player understand identity in under two seconds, it belongs on the back/detail
view.

### 0.2 Progression Layers

Cards progress through four independent layers:

1. **Tier**: long-term card class and visual weight.
2. **Level**: steady activity/contribution progress inside the tier.
3. **Badges**: permanent achievement evidence from stat thresholds.
4. **Add-ons**: temporary or special overlays, split into enhancements and augmentations.

These layers should stay separate in data. Do not turn every hot streak or team
achievement into a card tier bump. That would make the system noisy and dumb.

### 0.3 Tier Ladder

The user-facing tier ladder should use the status/theme direction already defined
in this document.

| Tier | Rarity | Player Status | Default Theme | Meaning |
|---:|---|---|---|---|
| 1 | Common | Prospect | Away | New, depth, or early-contribution player |
| 2 | Uncommon | Rookie | Home | Regular contributor with basic proof |
| 3 | Rare | Stud | Alternate | Clear role identity and meaningful production |
| 4 | Epic | Elite | Carbon-Fiber | High-impact player with multiple strong badge families |
| 5 | Legendary | Franchise | Smoke | Club-history player or current pillar |
| 6 | Mythic | Legend / One of One | Curated Mythic | Manual showcase for true legacy cards |

The tier label may be shown as rarity, player status, or both depending on space.
The player-status label is usually better for the card face because it sounds
like hockey instead of a mobile loot table.

### 0.4 Card Level

Card level is not the same thing as tier.

Tier is status. Level is progress.

Recommended model:

```txt
Tier 3 Rare Stud
Card Level 7
```

Each tier can have 10 card levels. Level should be based on steady participation
and contribution:

- games played
- wins
- role-specific production
- active-season participation
- playoff or showcase participation when available
- goalie starts for goalies

Level should not downgrade. It is lifetime progress inside the current card era.
Recent performance should be represented by enhancements, not level loss.

### 0.5 Badge-To-Tier Logic

Badges provide the evidence for tier. A player should not jump to a premium card
because of one isolated counter.

Recommended rule:

```txt
Card tier = weighted result from the player's best relevant badge families
```

Skater tier inputs:

- Goals
- Assists
- Hits
- Faceoffs Won
- Takeaways
- Wins
- Games Completed
- Hat Tricks, when derived cleanly

Goalie tier inputs:

- Saves
- Shutouts
- Goalie Wins
- Goalie Games Completed

Team badges should not normally increase individual card tier. They can add
team augmentations, carousel priority, and showcase labels.

Tier guardrails:

- No Tier 4+ card without a meaningful games-played baseline.
- No goalie quality badge should count without enough goalie games or shot volume.
- No `future` or `manual` badge can affect automatic tier calculation.
- Tier 6 requires manual/admin approval even if the data says the player qualifies.
- Career and season cards should be clearly labeled if both are used.

### 0.6 Badge Display

The card front should display only the strongest badge story.

Front-card badge priority:

1. One-of-One / Mythic emblem
2. Club record badge
3. Highest weighted player badge
4. Role-defining badge
5. Active enhancement badge
6. Team/showcase augmentation

Badge display by tier:

| Tier | Front Badge Treatment |
|---:|---|
| 1 | Optional tiny badge or empty status slot |
| 2 | One small highest-badge marker |
| 3 | One featured badge plus optional mini strip of up to 3 |
| 4 | Signature badge plate and one progress hint |
| 5 | Legendary badge plate plus club-rank text |
| 6 | Curated emblem; best 3-5 badges only |

### 0.7 Enhancements

Enhancements are temporary states from recent performance. They should refresh
after new games are ingested.

Enhancements answer: what is happening right now?

Recommended enhancement families:

| Enhancement | Trigger Direction | Card Treatment |
|---|---|---|
| Hot Streak | point streak, goal streak, win streak | red glow, small HOT marker, stat pulse |
| Clutch | OT goal, GWG, close-game goalie win | stopwatch icon, clutch stamp |
| Heater | strong last 5 games | recent-form chip, mild animated trim |
| Lockdown | low goals against, takeaways, shutouts | shield/ice trim, defensive label |
| Stolen Game | goalie win under heavy shot pressure | save-counter emphasis, goalie plate |
| Ice Cold | slump state | use carefully; back/detail view first |

Enhancements do not change tier. They can affect carousel ordering and temporary
front-card labels.

### 0.8 Augmentations

Augmentations are special add-ons tied to achievements, role, team context, or
editorial selection. They can be permanent or event-based.

Augmentation categories:

| Category | Examples |
|---|---|
| Badge augmentations | Hat Trick, Shutout, GWG, OT Winner, 30+ Saves |
| Role augmentations | Captain patch, Alternate patch, Goalie Spotlight |
| Event augmentations | Playoff Hero, Rivalry Game, Game Night Hero |
| Record augmentations | Club Record, Team Leader, Career High |
| Variant augmentations | Home, Away, Alternate, Throwback, Glitch, Playoff |
| Mythic augmentations | One-of-One serial, custom title, curated lore panel |

Front-card limit:

```txt
Maximum 1 major augmentation + 2 minor augmentations on the card face.
Everything else goes on the back/detail view.
```

Major augmentations:

- One-of-One
- Club Record
- Playoff Hero
- Captain patch
- Signature badge plate
- Record Breaker frame

Minor augmentations:

- Hat Trick marker
- GWG marker
- Hot Streak marker
- team leader chip
- recent-form chip
- small badge icon

### 0.9 Add-On Element Library

These are approved card add-ons. Do not use all of them at once.

Identity add-ons:

- tier label
- rarity label
- player-status label
- card level
- dynamic title
- archetype label
- club rank
- season/edition label
- One-of-One serial

Badge add-ons:

- highest badge slot
- featured badge plate
- signature badge overlay
- mini badge strip
- badge progress bar
- badge progress ring
- next badge preview

Stat add-ons:

- featured stat cell
- stat comparison arrow
- last-5-games chip
- team leader marker
- career high marker
- milestone countdown
- progress-to-next-milestone bar
- form sparkline on the back/detail view

Frame add-ons:

- steel frame
- carbon-fiber frame
- smoke frame
- ice frame
- cracked-glass frame
- playoff frame
- rivalry frame
- captain frame
- record-breaker frame
- mythic frame

Background add-ons:

- dark rink
- scoreboard panel
- carbon fiber
- red smoke
- black smoke
- cracked ice
- goalie crease
- goal light
- net mesh
- club crest watermark
- skull watermark
- old-card paper texture
- glitch HUD

Motion/effect add-ons:

- hover light sweep
- 3D tilt
- red trim pulse
- foil shimmer
- smoke drift
- scan lines
- RGB glitch split
- frost edge
- goal-light flash
- cracked-glass overlay
- stat pulse
- badge pulse

Goalie-specific add-ons:

- goalie mask icon
- glove icon
- blocker icon
- crease line overlay
- locked-net symbol
- save counter
- shutout plate
- red-light denial treatment
- frozen crease background

Skater-specific add-ons:

- puck icon
- stick icon
- crosshair/sniper icon
- passing-lane lines
- hit counter
- faceoff dot icon
- defensive shield icon
- takeaway marker
- shot-trail lines
- two-way split frame

### 0.10 Visual Restraint Rules

The cards should feel dark, sharp, competitive, and hockey-specific. They should
not feel like generic fantasy RPG cards.

Rules:

- Keep the card readable at carousel size.
- The featured stat must remain visually obvious.
- Do not put more than one progress bar on the front.
- Do not show more than 5 badges on any front card.
- Do not animate every surface at once.
- Avoid novelty labels that make the card look like a joke unless it is a deliberate locker-room variant.
- Mythic treatment should feel curated and rare, not like Tier 5 with extra glow.

### 0.11 Card Back / Detail View

The back/detail view is where the system can be dense.

It should include:

- full season and career stat tables
- current tier and level explanation
- badge progress by family
- next major milestone
- best games
- recent form
- unlocked variants
- augmentations earned
- card history
- manual/editorial title or lore for Mythic cards

The front card creates desire. The back card explains why it is deserved.

### 0.12 Recommended Build Order

Build this in layers:

1. Keep the existing baseline card shell stable.
2. Add card data model: tier, level, featured badge, enhancement, augmentations.
3. Seed reliable badge definitions from `Badges.md`.
4. Compute badge progress from stored aggregates.
5. Derive Tier 1-3 card status and render subtle visual differences.
6. Add one status slot to the card footer/meta row.
7. Add card back/detail progression panel.
8. Add enhancement engine from recent games.
9. Add augmentation rendering and priority rules.
10. Add Tier 4-5 premium frames and progress hints.
11. Add Mythic admin/manual approval flow.
12. Add animations and foil effects after the system is already useful.

V1 should prove the progression logic. Visual noise can wait.

---

## Source Concept Notes

The remaining sections preserve the original concept direction and provide the
theme, badge, variant, and layout ideas that feed the refined system above.

## 1. Purpose

This document defines the collectible player card system for the EASHL Stats Website. The goal is to turn basic player stat cards into a progression-driven collectible system with tiers, themes, badges, card variants, milestone unlocks, and special visual treatments.

The system should make roster cards feel alive. Players should be able to improve their card identity over time by playing games, earning stats, unlocking badges, reaching milestones, and appearing in special showcase variants.

Core loop:

```txt
Play games → Stats update → Milestones unlock → Badges upgrade → Cards evolve → Players get showcased
```

---

## 2. Brand Direction

The card system should follow the team brand:

- Dark, aggressive, esports-hockey style
- Black, charcoal, red, white, and gray palette
- High contrast
- Sharp borders and diagonal cuts
- Scoreboard-style stat panels
- Skull/stick branding
- Metallic, smoke, carbon-fiber, ice, and glitch effects
- Competitive, outlaw, intimidating tone

The cards should not feel soft, corporate, playful, or generic. They should feel like hockey trading cards mixed with esports player cards and RPG-style progression.

---

## 3. Base Card Categories

There are two primary card categories:

1. **Skater Cards**
2. **Goalie Cards**

These should share the same general layout, but goalies need their own stat logic and visual language.

---

## 4. Skater Cards

Skater cards are used for forwards and defensemen.

### Core skater stats

Possible front-card stats:

- Games played
- Goals
- Assists
- Points
- Points per game
- Plus/minus
- Shots
- Hits
- Takeaways
- Giveaways
- Faceoff wins
- Faceoff percentage
- Blocked shots, if available

### Skater card identities

Skater cards can earn different identities based on stat profile:

- Sniper
- Playmaker
- Enforcer
- Two-Way Beast
- Faceoff King
- Defensive Anchor
- Hitman
- Overtime Assassin
- Franchise Scorer
- Point Machine

---

## 5. Goalie Cards

Goalie cards should not feel like skater cards with different numbers. They should have their own visual identity.

### Core goalie stats

Possible front-card stats:

- Games played
- Wins
- Losses
- OTL
- Win percentage
- Saves
- Shots against
- Save percentage
- Goals-against average
- Shutouts

### Goalie visual language

Goalie cards can use:

- Crease lines
- Goalie mask graphics
- Blocker/glove icons
- Ice wall textures
- Frost effects
- Locked net symbols
- Save counter overlays
- Red goal-light denial effects

### Goalie card identities

- Brick Wall
- The Last Line
- The Wall
- The Crease Demon
- The Glove Thief
- The Shutout King
- The Bailout Machine
- The Shot Eater
- The Masked Menace
- Final Boss

---

## 6. Base Card Layout

The card is divided into three vertical zones:

```txt
[ TOP PANEL ]
A: Player info block
B: Profile image / player render

[ IDENTITY ROW ]
C: Platform logo
D: Player name

[ STATS + META PANEL ]
E-H: Main stat row
I-K: Meta row
```

---

## 7. Slot Breakdown

### A — Player Info Block

Purpose: quick identity and competitive context.

Contains:

- Player number
- Position
- Record: W-L-OTL
- Win percentage

Higher-tier additions:

- Tier label
- Rarity label
- Player archetype
- Card level
- One-of-One label for Mythic cards

---

### B — Profile Area

Purpose: visual anchor.

Contains:

- Player avatar
- Generated silhouette
- Player render
- Profile image

Higher-tier additions:

- Themed background
- Smoke, frost, electric, fire, or glitch effects
- Skull watermark
- Carbon-fiber frame
- Animated border

---

### C — Platform Logo

Purpose: identify platform.

Contains:

- PlayStation logo
- Xbox logo

This should remain small and consistent across all tiers.

---

### D — Player Name

Purpose: primary identity label.

Contains:

- Gamertag / player name

Higher-tier additions:

- Dynamic title
- Nickname
- Card name

Examples:

```txt
Player Name
THE MENACE
```

```txt
Player Name
FRANCHISE SNIPER
```

```txt
Player Name
OLYMPUS MAXIMUS
```

---

### E-H — Main Stats Row

Purpose: quick performance snapshot.

The fourth stat slot, H, should remain the featured stat and should be about 33% larger or visually stronger than E-G.

Default skater setup:

| Slot | Stat |
|---|---|
| E | GP |
| F | G |
| G | A |
| H | PTS |

Default goalie setup:

| Slot | Stat |
|---|---|
| E | GP |
| F | W |
| G | SV% |
| H | SO |

Alternative goalie setup:

| Slot | Stat |
|---|---|
| E | GP |
| F | W |
| G | Saves |
| H | SV% |

---

### I-K — Meta Row

Purpose: identity, branding, and collectible details.

| Slot | Purpose |
|---|---|
| I | Flag |
| J | Team logo |
| K | Extra slot |

K slot options:

- Highest badge
- Rarity icon
- Captain patch
- Alternate captain patch
- MVP badge
- Club rank
- One-of-One emblem
- Featured milestone

---

## 8. Front Card Information by Tier

Each tier should keep the same core layout but increase identity, context, and visual detail.

The main rule:

```txt
Higher tier ≠ more clutter.
Higher tier = better presentation, stronger identity, better badge treatment, and more meaningful stats.
```

---

## 9. Tier 1 — Common Prospect / Away

### Purpose

Basic roster card for new players or early milestones.

### Front-card info

A:

- Number
- Position
- Record
- Win percentage

B:

- Avatar or silhouette

C-D:

- Platform logo
- Player name

E-H skater:

- GP
- Goals
- Assists
- Points

E-H goalie:

- GP
- Wins
- Saves
- Save percentage

I-K:

- Flag
- Team logo
- Empty slot or Common/Prospect badge

### Visual style

- Away theme
- Clean frame
- Minimal effects
- Basic border
- Low visual complexity

---

## 10. Tier 2 — Uncommon Rookie / Home

### Purpose

Player is now a regular contributor.

### Added info

A:

- Add Rookie label
- Optional games played if not already displayed

K:

- Highest unlocked badge

Examples:

- Goals I
- Wins II
- Saves I
- Hits I

### Front-card stats

Skater:

- GP
- G
- A
- PTS

Goalie:

- GP
- W
- GAA
- SV%

### Visual style

- Home theme
- Darker background
- Red trim
- Better border
- Small hover glow

---

## 11. Tier 3 — Rare Stud / Alternate

### Purpose

Player has a defined identity and is a noticeable contributor.

### Added info

A:

- Player archetype label

Examples:

- Sniper
- Playmaker
- Enforcer
- Two-Way
- Faceoff King
- Brick Wall

D:

- Player name may include a smaller title line

K:

- Featured badge

Mini badge strip:

```txt
[Goals II] [Assists I] [Wins II]
```

Limit to 3 badges on the front.

### Position-sensitive stat options

Forward:

| Slot | Stat |
|---|---|
| E | GP |
| F | Goals |
| G | Assists |
| H | Points |

Defense:

| Slot | Stat |
|---|---|
| E | GP |
| F | Hits |
| G | Takeaways |
| H | Points |

Center:

| Slot | Stat |
|---|---|
| E | GP |
| F | Faceoff Wins |
| G | Assists |
| H | Points |

Goalie:

| Slot | Stat |
|---|---|
| E | GP |
| F | Wins |
| G | Saves |
| H | Save % |

### Visual style

- Alternate theme
- Stronger red/black contrast
- Silver badge frame
- Larger or more dynamic player image
- More aggressive diagonal cuts

---

## 12. Tier 4 — Epic Elite / Carbon-Fiber

### Purpose

High-performance premium card.

### Added info

A:

- Elite label
- Card level
- Optional milestone score

Example:

```txt
ELITE
Card Level 4
```

B:

- Carbon-fiber frame
- Signature badge overlay

D:

- Player name plus dynamic title

Examples:

```txt
Player Name
THE MENACE
```

```txt
Player Name
THE WALL
```

K:

- Signature badge

Examples:

- Hat Trick Hunter
- Brick Wall
- Enforcer
- Franchise Scorer
- Faceoff King

### Recommended front-card stats

General skater:

- GP
- G
- A
- PTS

Physical skater:

- GP
- Hits
- Takeaways
- PTS

Goalie:

- GP
- W
- SV%
- SO

### Extra front-card element

Show one progress item toward the next major milestone:

```txt
Next: Legendary Franchise
Progress: 642 / 700 Goals
```

Only show one progress bar on the front.

### Visual style

- Carbon-fiber texture
- Metallic border
- Red animated trim
- Signature badge slot
- Esports/HUD overlays

---

## 13. Tier 5 — Legendary Franchise / Smoke

### Purpose

Franchise-defining player card.

### Added info

A:

- Franchise label
- Career record
- Win percentage

B:

- Smoke background
- Skull watermark
- Larger player render
- Legendary border

D:

- Player name plus title

Examples:

```txt
Player Name
FRANCHISE SNIPER
```

```txt
Player Name
THE LAST LINE
```

K:

- Legendary badge

Footer text:

```txt
Highest Badge: Goals Tier 5
Club Rank: #1 in Goals
```

or:

```txt
Highest Badge: Saves Tier 5
Club Rank: #1 Goalie Wins
```

### Recommended front-card stats

Skater:

- GP
- Goals
- Points
- Primary badge stat

Primary badge stat examples:

- Hits for enforcer
- Assists for playmaker
- Faceoff wins for center
- Takeaways for defensive player

Goalie:

- GP
- Wins
- Saves
- Shutouts

### Badge display

Show up to 5 badges on the front.

### Visual style

- Smoke theme
- Black/red smoke
- Skull watermark
- Premium stat plate
- Legendary glow

---

## 14. Tier 6 — Mythic Legend / One of One

### Purpose

Final-form card. This is the rarest and should feel curated.

The system can detect eligibility, but Mythic One of One cards should ideally require manual/admin approval so they stay special.

### Added info

A:

- Legend label
- 1/1 mark
- Career record
- Win percentage

B:

- Full Mythic theme treatment

D:

- Player name plus Mythic title

Examples:

```txt
Player Name
OLYMPUS MAXIMUS
```

```txt
Player Name
SCORCHED EARTH
```

K:

- One-of-One emblem

Special labels:

```txt
ONE OF ONE
MYTHIC LEGEND
TIER 6 MAXED
```

### Recommended front-card stats

Skater:

- GP
- Goals
- Points
- Club Rank

Goalie:

- GP
- Wins
- Saves
- Shutouts

### Badge display

Show only the best 3-5 badges.

Example:

```txt
[Goals VI] [Points V] [Wins V] [Hat Tricks IV]
```

### Visual style

- Full-card animation
- Unique theme
- Mythic frame
- Large custom title
- Special card back/lore panel
- Numbered One-of-One styling

---

## 15. Card Leveling System

The card progression ladder is:

| Tier | Rarity | Player Status | Default Theme |
|---|---|---|---|
| 1 | Common | Prospect | Away |
| 2 | Uncommon | Rookie | Home |
| 3 | Rare | Stud | Alternate |
| 4 | Epic | Elite | Carbon-Fiber |
| 5 | Legendary | Franchise | Smoke |
| 6 | Mythic | Legend | One of One |

Progression should feel like both a sports-card rarity system and an RPG-style player evolution system.

Core ladder:

```txt
Prospect → Rookie → Stud → Elite → Franchise → Legend
Away → Home → Alternate → Carbon-Fiber → Smoke → One of One
```

---

## 16. Suggested Tier Unlock Logic

This section is retained as concept background. The implementation should follow
the refined badge-to-tier guardrails in section 0.5. In practice, the "better
version" below is the baseline: use weighted badge families, role-specific
inputs, and minimum-game safeguards.

### Simple version

A player card tier equals the highest unlocked milestone tier.

Example:

```txt
Player has:
Goals Tier 4
Assists Tier 3
Hits Tier 2
Games Completed Tier 5

Card Tier = Tier 5 Legendary Franchise
Theme = Smoke
```

### Better version

A player card tier is based on the top 3 milestone categories.

Example:

```txt
Goals Tier 4
Assists Tier 4
Games Completed Tier 5

Average = 4.33
Card Tier = Tier 4 Epic Elite
```

This prevents one random stat from making a player look too overpowered.

---

## 17. Recommended Unlock Conditions

| Tier | Unlock Condition |
|---|---|
| Tier 1 Common Prospect | Any Tier 1 milestone |
| Tier 2 Uncommon Rookie | 3+ Tier 2 milestones or 1 major Tier 2 milestone |
| Tier 3 Rare Stud | 3+ Tier 3 milestones |
| Tier 4 Epic Elite | 2+ Tier 4 milestones |
| Tier 5 Legendary Franchise | 2+ Tier 5 milestones or 1 club record |
| Tier 6 Mythic Legend | Any Tier 6 milestone plus manual/admin approval for One of One |

---

## 18. Mythic One of One Themes

Mythic cards use special subthemes. These should only be used at Tier 6.

### Electric

Identity:

- Speed
- Offense
- Momentum
- Flashy skill

Best for:

- Goals
- Assists
- Points
- Breakaways
- Dekes
- Hot streaks

Visuals:

- Red/white lightning
- Glitch sparks
- Electric border pulse
- Neon stat lines

Possible card titles:

- Voltage
- Power Surge
- Shockwave
- Red Lightning
- The Circuit Breaker

---

### Frost

Identity:

- Cold
- Controlled
- Defensive
- Goalie-heavy

Best for:

- Goalies
- Shutouts
- Saves
- Blocked shots
- Low goals against
- Defensive milestones

Visuals:

- Frozen border
- Ice cracks
- Cold fog
- Frosted skull watermark
- Blue-white contrast with red highlights

Possible card titles:

- The Ice Wall
- Frostbite
- Sub-Zero
- Frozen Crease
- Cold Blooded

---

### Scorched

Identity:

- Scoring
- Violence
- Domination

Best for:

- Goals
- Hat tricks
- Hits
- Fights won
- Blowout wins
- Rivalry games

Visuals:

- Burnt edges
- Ember particles
- Red/orange smoke
- Goal-light glow
- Charred background

Possible card titles:

- Scorched Earth
- Red Inferno
- The Burner
- Ashmaker
- Firestarter

---

### Olympus Maximus

Identity:

- God-tier
- Club king
- Absolute peak
- All-time legacy

Best for:

- MVP
- All-time leader
- Team captain
- Record breaker
- Championship hero
- Multiple maxed Tier 6 badges

Visuals:

- Marble/stone texture
- Gold/red accents
- Statue-style player treatment
- Mythic crest
- God-card presentation

Possible card titles:

- Olympus Maximus
- The Immortal
- Club Deity
- The Final Form
- King of the Rink

---

### Future

Identity:

- Esports
- Glitch
- Cyber
- Next-gen

Best for:

- Young breakout players
- New records
- Technical/playmaking players
- Futuristic alternate cards
- Strong all-around stats

Visuals:

- Cyber grid
- Holographic HUD
- RGB glitching
- Scan lines
- Neon red interface overlays

Possible card titles:

- Future Shock
- Prototype
- Next Gen
- System Override
- Cyber Sniper

---

## 19. Badge Milestone System

The badge milestone system contains Player, Goalie, and Team milestones. Each milestone category has tier and level thresholds.

The badge thresholds and source-status decisions live in `Badges.md`. This
section describes how those badge definitions affect cards.

Each badge should be structured as:

```ts
Badge {
  id: string
  name: string
  scope: "player" | "team"
  role: "skater" | "goalie" | "any"
  statKey: string
  sourceStatus: "available" | "derived" | "manual" | "future"
  cardWeight: 0 | 1 | 2 | 3 | 4
  tier: 1 | 2 | 3 | 4 | 5 | 6
  level: 1 | 2 | 3 | 4 | 5
  threshold: number
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic"
  cardEffect: string
}
```

---

## 20. Badge Tier Meaning

| Badge Tier | Meaning | Rarity |
|---|---|---|
| Tier 1 | Rookie / Starter | Common |
| Tier 2 | Regular | Uncommon |
| Tier 3 | Proven | Rare |
| Tier 4 | Veteran | Epic |
| Tier 5 | Franchise | Legendary |
| Tier 6 | Legend | Mythic |

---

## 21. Badge Families

### Skater badge families

#### Scoring

Used for:

- Goals
- Shots
- Hat-tricks
- Breakaways

Badge names:

- First Blood
- Trigger Man
- Hat Trick Hunter
- Breakaway Menace
- Goal Machine

#### Playmaking

Used for:

- Assists
- Dekes

Badge names:

- Setup Artist
- Tape-to-Tape
- Hands Department
- Dangle Merchant
- Offensive Engine

#### Physical

Used for:

- Hits
- Fights won

Badge names:

- Body Count
- Glass Breaker
- Enforcer
- Fight Night
- Penalty Box Royalty

#### Defensive

Used for:

- Takeaways
- Blocked shots
- Faceoffs won

Badge names:

- Pickpocket
- Shot Eater
- Faceoff King
- Defensive Anchor
- Two-Way Demon

#### Experience

Used for:

- 3v3 games completed
- 6v6 games completed
- 6's with goalie
- Wins

Badge names:

- Rookie Season
- Roster Regular
- Veteran
- Franchise Player
- Club Legend

---

### Goalie badge families

#### Goalie Experience

Used for:

- Goalie games completed
- Goalie wins

Badge names:

- Crease Rookie
- Starting Goalie
- Workhorse
- Franchise Netminder
- Masked Legend

#### Saves

Used for:

- Saves
- Desperation saves
- Goalie poke-checks

Badge names:

- Save Stacker
- Robbery Artist
- Last Line
- Poke Check Menace
- Brick Wall

#### Shutouts

Used for:

- Shutouts

Badge names:

- Locked Door
- Clean Sheet
- No Entry
- Zero Tolerance
- The Wall

---

### Team badge families

#### Club Experience

Used for:

- 3v3 games completed
- 6v6 games completed
- Total games completed
- 6-player games completed
- 6's with goalie

Badge names:

- Club Founded
- Regulars
- Full Squad
- Built Different
- Franchise Club

#### Winning

Used for:

- Wins
- Wins with goalie
- Wins with 6 players
- Blowout wins

Badge names:

- Win Column
- Statement Win
- Full-Squad Dub
- Mercy Rule
- Dynasty

#### Team Offense

Used for:

- Goals
- Power-play goals

Badge names:

- Goal Factory
- Red Light District
- Power Play Unit
- Special Teams Killer
- Offensive Machine

#### Team Defense

Used for:

- Shutouts
- 1 goal or fewer
- 2 goals or fewer
- Perfect PK

Badge names:

- Lockdown
- No Easy Ice
- Shutdown Crew
- Perfect Kill
- Defensive Dynasty

---

## 22. How Badges Modify Cards

### Small Badge

Used for Tier 1-2 milestones.

Card effect:

- Small icon near stat row
- Tooltip on hover
- No layout change

Example:

```txt
Goals Tier 1 Level 1: small goal-light icon beside Goals
```

---

### Featured Badge

Used for Tier 3-4 milestones.

Card effect:

- Badge displayed under player name
- Slight card border upgrade
- Related stat highlighted

Example:

```txt
Hits Tier 4: cracked-glass border and Enforcer label
```

---

### Signature Badge

Used for Tier 5 milestones.

Card effect:

- Badge shown in main card art
- Foil background
- Larger stat panel
- Special title unlocked

Example:

```txt
1500 goals unlocks Franchise Sniper
```

---

### Mythic Badge

Used for Tier 6 milestones.

Card effect:

- Full variant card unlock
- Animated border
- Profile showcase slot
- Legend label
- Possible 1/1 commemorative version

Example:

```txt
2000 goals unlocks Mythic Goal Machine card
```

---

## 23. Card Variants

### Season Variant

Each EA NHL game or club season can have its own edition.

Examples:

- NHL 26 Season 1
- NHL 26 Playoffs
- NHL 27 Launch Edition
- Winter Classic Edition
- Championship Run Edition

---

### Home / Away Variant

Home:

- Dark black/red
- Team logo dominant
- Aggressive skull background

Away:

- White/silver
- Cleaner icy background
- Red accents

---

### Playoff Variant

Visual ideas:

- Trophy icon
- Playoff bracket texture
- Road to the Cup tag
- Red slash marks for each playoff win
- Championship badge if applicable

---

### Rivalry Variant

Unlocked against specific opponents.

Visual ideas:

- Rivalry Game label
- Enemy team silhouette
- Cracked ice background
- Red warning-tape border
- Head-to-head record badge

---

### Milestone Variant

Automatically generated when a player hits major milestones.

Examples:

- 100 Goals
- 250 Points
- 500 Hits
- 50 Wins
- 10 Shutouts
- 1000 Saves
- First Hat Trick
- First Game-Winning Goal

---

### Throwback Variant

Visual ideas:

- Old hockey card texture
- Faded print dots
- Cream/gray background
- Old-school stat box
- Archive Series label

---

### Glitch / Esports Variant

Visual ideas:

- Pixel distortion
- RGB split effect
- HUD overlays
- Console platform badge
- Animated scan lines
- System Override card title

---

### Captain / Alternate Captain Variant

Visual ideas:

- Big C or A patch
- Command-style frame
- Team crest background
- Locker Room Leader tag

---

## 24. Performance-Based Enhancements

### Hot Streak

Possible rules:

- 3-game point streak
- 5-game win streak
- Goals in 3 straight games
- Goalie wins 3 straight starts

Visual treatment:

- Red glow
- Flame/heat shimmer
- Hot Streak banner
- Animated stat pulse

---

### Clutch

Possible rules:

- Game-winning goal
- Overtime goal
- Comeback goal
- Goalie wins by one goal
- High save percentage in a close game

Visual treatment:

- Stopwatch icon
- Red final-minute overlay
- Clutch stamp
- Scoreboard-style timestamp

---

### Enforcer

Possible rules:

- Team hits leader
- 10+ hits in a game
- High PIM and hit total
- Multiple big defensive games

Visual treatment:

- Cracked glass
- Heavy steel border
- Hit counter badge
- Enforcer title

---

### Sniper

Possible rules:

- Hat trick
- Goals-per-game leader
- High shooting percentage
- Multi-goal game

Visual treatment:

- Crosshair icon
- Red target rings
- Goal light effect
- Sniper title

---

### Playmaker

Possible rules:

- 3+ assists in a game
- Team assist leader
- High assists-per-game
- Creates most points without scoring

Visual treatment:

- Passing lane lines
- White/red motion trails
- Playmaker badge

---

### Two-Way Beast

Possible rules:

- Points + hits + takeaways
- Positive plus/minus
- Strong defensive and offensive output

Visual treatment:

- Split offensive/defensive frame
- Stick + shield icons
- 200 FT Game label

---

### Brick Wall

Goalie-specific.

Possible rules:

- Shutout
- 90%+ save percentage
- 30+ saves
- Win despite being outshot

Visual treatment:

- Concrete/ice wall background
- Crease glow
- Brick Wall badge
- Save counter emphasis

---

### Robbery

Goalie-specific.

Possible rules:

- Very high saves
- Low goals against
- Team wins with poor shot differential

Visual treatment:

- Glove icon
- Robbed stamp
- Mask graphic
- Flashing red goal-light denial effect

---

## 25. Special Card Sets

### Team Leaders Set

Automatically generated for stat leaders.

Cards:

- Goals Leader
- Assists Leader
- Points Leader
- Hits Leader
- Plus/Minus Leader
- Saves Leader
- Wins Leader
- Save Percentage Leader

These can appear on the homepage leading scorers panel and roster carousel.

---

### Game Night Heroes Set

Generated after each game.

Cards:

- First Star
- Second Star
- Third Star
- Game-Winning Goal
- Best Goalie
- Biggest Hit Machine
- Most Points
- Best Defensive Game

---

### Record Breaker Set

For club history.

Cards:

- Most goals in one game
- Most assists in one game
- Most points in one game
- Most saves in one game
- Longest point streak
- Longest win streak
- Best single-game save percentage
- Biggest blowout win

---

### Playoff Heroes Set

For postseason moments.

Cards:

- Elimination Game Hero
- Series Closer
- Overtime Winner
- Championship Goalie
- Playoff MVP
- Final Boss

---

### Meme / Locker Room Set

Less serious team-personality cards.

Examples:

- Penalty Box Resident
- Post Magnet
- Almost Had It
- Lag Warrior
- Controller Disconnect
- Certified Pylon
- Garbage Time Merchant
- Empty Net Specialist

These should be used carefully so the site feels fun without becoming insulting unless that is part of the team culture.

---

## 26. Card Augmentations

### Badge augmentations

Examples:

- Hat Trick
- GWG
- OT Winner
- Shutout
- 3-Point Night
- 5-Point Night
- 10+ Hits
- 30+ Saves
- 90% Save Game
- Playoff Win
- Rivalry Win

---

### Stat boost labels

These are visual labels, not gameplay boosts.

Examples:

- +12% Goals/Game
- Top 3 Scorer
- Team Leader
- Career High
- Season Best
- Hot Last 5 Games

---

### Foil effects

Examples:

- Silver Foil
- Red Foil
- Ice Foil
- Skull Foil
- Holographic
- Blood Ice
- Glitch Foil
- Championship Gold

---

### Borders

Examples:

- Standard Frame
- Steel Frame
- Playoff Frame
- Captain Frame
- Rivalry Frame
- Record Breaker Frame
- Legendary Frame
- One-of-One Frame

---

### Backgrounds

Examples:

- Dark Rink
- Frozen Skull
- Red Smoke
- Cracked Ice
- Scoreboard
- Penalty Box
- Clubhouse
- Playoff Bracket
- Goalie Crease
- Goal Light

---

## 27. Card Conditions

Digital card condition can be based on performance.

### Mint

Great recent performance.

Possible rules:

- High points per game
- Positive plus/minus
- Strong win percentage

### Scuffed

Funny negative variant.

Possible rules:

- Bad plus/minus
- Long goal drought
- High penalty minutes
- Low save percentage stretch

### Battle-Worn

For physical players.

Possible rules:

- High hits
- High blocked shots
- High PIM
- Lots of games played

### Ice Cold

For slumps.

Possible rules:

- No points in several games
- Losing streak
- Low shooting percentage

---

## 28. Back of Card

The front should stay clean. Deeper stats should go on the back.

### Back-card identity section

- Player name
- Platform
- Position
- Handedness, if tracked
- Country
- Team
- Card tier
- Card theme

### Back-card skater stats

- GP
- W-L-OTL
- Win %
- Goals
- Assists
- Points
- Points per game
- Shots
- Shooting percentage
- Hits
- Takeaways
- Giveaways
- Faceoff wins
- Faceoff losses
- Faceoff percentage

### Back-card goalie stats

- GP
- W-L-OTL
- Win %
- Saves
- Shots against
- Save percentage
- Goals-against average
- Shutouts

### Badge progress

Example:

```txt
Goals
Current: 642
Unlocked: Tier 4 Level 1
Next: Tier 4 Level 2 at 700
Progress: 642 / 700
```

### Best games

- Most goals in one game
- Most assists in one game
- Most points in one game
- Most hits in one game
- Most saves in one game for goalies

---

## 29. Homepage and Carousel Usage

The card carousel should not rotate random players only. It should showcase meaningful cards.

Possible carousel slots:

- Featured Player
- Latest Game Hero
- Current Hot Streak
- Team Scoring Leader
- Goalie Spotlight
- New Variant Unlocked
- Record Breaker
- Playoff Hero
- Rivalry MVP

Each carousel card can have a small label:

- NEW
- HOT
- RARE
- PLAYOFF
- MILESTONE
- LEGENDARY
- MYTHIC

---

## 30. MVP Front Card Specification

### Skater MVP

```txt
A: Number / Position / Record / Win%
B: Player image
C: Platform logo
D: Player name
E: GP
F: Goals
G: Assists
H: Points
I: Flag
J: Team logo
K: Highest badge
```

### Goalie MVP

```txt
A: Number / Position / Record / Win%
B: Player image
C: Platform logo
D: Player name
E: GP
F: Wins
G: Save %
H: Shutouts
I: Flag
J: Team logo
K: Highest badge
```

---

## 31. MVP Tier Upgrades

Implement tier upgrades in stages:

```txt
Tier 1: Base card
Tier 2: Rarity label
Tier 3: Dynamic title / archetype
Tier 4: Progress to next milestone
Tier 5: Club rank
Tier 6: One-of-One theme + Mythic title
```

---

## 32. Data and Implementation Notes

### Data should come from stored stats

The website should not calculate cards directly from live EA API calls at request time. Stats should be ingested, stored, normalized, and aggregated locally.

### Badges should be computed from stored aggregates

Badge progress should be computed from player season/career stats and team stats stored in the database.

Badge definitions should come from the refined threshold catalog in `Badges.md`.
Only `available` badges should be automated immediately. `derived` badges need
query validation. `manual` and `future` badges must not affect automatic card
tier calculation.

### Raw payloads should be preserved

Because EA data can be unstable, raw match payloads should be archived so future changes can be reprocessed.

### MVP-safe stats

Prioritize stats that are likely to be reliable:

Skater:

- Games played
- Wins
- Goals
- Assists
- Points
- Shots
- Hits
- Faceoff wins
- Takeaways

Goalie:

- Games played
- Wins
- Saves
- Save percentage
- GAA
- Shutouts

Team:

- Games completed
- Wins
- Goals
- Blowout wins
- Shutouts
- Low-goals-against games

### Future/manual/video-tracking stats

Some milestones should be marked as future or manual until confirmed in the data source:

- Dekes
- Breakaways
- Desperation saves
- Goalie poke-checks
- Fights won
- Perfect PK, unless power-play opportunity data is reliable

---

## 33. Cleanup Notes from the Milestone Tables

These cleanup decisions have already been applied to `Badges.md`. Before turning
the badge catalog into a database seed file, verify them again:

1. Rename `6' Games Completed` to `6v6 Games Completed`.
2. Change `5 wins` under games completed to just `5` because the category is games completed.
3. Remove or resolve the duplicate Team `Games with 2 goals or Fewer` table.
4. Confirm which advanced stats are actually available from EA data.
5. Mark uncertain stats as future/manual/video-tracking badges.

---

## 34. Example Card Concepts

### Skater Example — Overtime Assassin

Category: Skater  
Rarity: Epic  
Tier: 4  
Theme: Carbon-Fiber  
Trigger: Scores overtime game-winning goal

Visuals:

- Red goal light
- Dark rink background
- Skull watermark
- Animated red border

Highlighted stats:

- Goals
- Game-winning goals
- Points
- Shots

Badge:

- Clutch

---

### Skater Example — The Menace

Category: Skater  
Rarity: Rare  
Tier: 3  
Theme: Alternate  
Trigger: 10+ hits and at least 1 point

Visuals:

- Cracked glass
- Steel frame
- Red hit counter

Highlighted stats:

- Hits
- Points
- Plus/minus

Badge:

- Enforcer

---

### Goalie Example — Brick Wall

Category: Goalie  
Rarity: Epic  
Tier: 4  
Theme: Carbon-Fiber or Frost  
Trigger: 30+ saves and win

Visuals:

- Ice wall background
- Crease glow
- Large save total

Highlighted stats:

- Saves
- Save percentage
- Goals against

Badge:

- Stolen Game

---

### Goalie Example — The Last Line

Category: Goalie  
Rarity: Legendary  
Tier: 5  
Theme: Smoke  
Trigger: Shutout in playoff/championship game

Visuals:

- Locked net
- Red/black holographic border
- Skull mask graphic

Highlighted stats:

- Shutout
- Saves
- Save percentage
- Win

Badge:

- Playoff Hero

---

## 35. Recommended Build Order

The implementation order in section 0.12 is authoritative. This older build
order is kept as a concept checklist, but the real sequence should be:

1. Keep the current card shell stable.
2. Add progression data fields.
3. Seed reliable badges from `Badges.md`.
4. Compute badge progress from stored aggregates.
5. Render Tier 1-3 status changes first.
6. Add the card back/detail progression panel.
7. Add enhancements and augmentations after the progression math works.
8. Add Tier 4-6 premium treatment and Mythic curation last.

---

## 36. Final Design Principle

The card system should reward players visually without turning every card into a dense stat sheet.

Low-tier cards should be clean and readable. High-tier cards should be more dramatic, more personalized, and more collectible.

The best version of the system is:

```txt
Stats determine milestones.
Milestones unlock badges.
Badges influence card tier.
Card tier controls theme.
Special achievements unlock variants.
Mythic cards are curated legacy pieces.
```
