# Player Cards, Badges, Build Locker v2 & Action Map — Design

> **Amended 2026-10-08:** progression is now per NHL title (one season card each, from NHL 27), with new ladders and tier bars. See [season cards](2026-10-08-season-cards-design.md); Part 1's inputs, ladders, tier bars, tier table and storage below are superseded where they differ.

**Status:** approved by the operator 2026-10-07, including the test-run amendment. Step 1 (badges) is next.
**Supersedes:** for these features only, the open questions in
[`docs/cards/card-system-brief.md`](../../cards/card-system-brief.md) and the
"Reality check" ladders in [`docs/cards/badge-catalog.md`](../../cards/badge-catalog.md).
Those files stay as background.

## Goal

Ship the operator's new Claude Design front-end work onto the live player page and the card surfaces:

1. Card progression redesign: 10 card themes across 6 tiers, with level pips and a front/back flip.
2. Badges: 21 career badges, each with 30 levels.
3. The card edit entry point and a locker drawer. **Read-only until member logins exist.**
4. A badge collection section on the player page.
5. Build Locker v2, replacing the loadout history strip.
6. A career Action Map, replacing the Career Shot Map.

**Success:** teammates see their earned tier and theme on every card and their badge progress on their page. They can browse what's left to unlock. The page does not get noticeably slower on phones.

## Design sources

| Design                | Source (repo root, git-ignored)     | Files                                                                                                                                                                                                           |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cards, locker, badges | `Card Customization Page.zip`       | `PlayerCard.dc.html`, `Card Locker.dc.html`, `Badge.dc.html`, `Player Badges.dc.html`, `Badge Leveling.dc.html` (reference only), `card-data.js`, `badge-levels.js`, `badge-shapes.js`, `README.md`, `assets/*` |
| Build Locker v2       | `Build Locker component design.zip` | `Build Locker v2.dc.html` (v1 and the wireframes are history only)                                                                                                                                              |
| Action Map            | `Player Action Map replacement.zip` | `Player Action Map.dc.html`, `ref/*`                                                                                                                                                                            |

The first implementation step copies the HTML/JS/MD reference files, but not the raw image assets, into `docs/design/handoffs/2026-10-cards/` so they live in git. The bundle `README.md` is the fidelity reference: match its colours, type, spacing and motion. `support.js` and `_ds/` are prototype runtime and are not ported.

## Decisions (operator, 2026-10-07)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **No equip/edit until member logins exist.** Cards, badges and the locker ship read-only. Logins stay disabled; re-enabling them is a separate, later project.                                                                                                                                                                                                                             |
| D2  | Badge totals come from **EA's season totals** (`ea_member_season_stats`). The three mode badges (3v3 GP, 6v6 GP, 6s with goalie) come from **site-recorded matches**, because EA doesn't split by mode.                                                                                                                                                                                    |
| D3  | **NHL 22–25 history counts** (reviewed `historical_club_member_season_stats` rows) for the stats it has.                                                                                                                                                                                                                                                                                   |
| D4  | The design's ladders were too easy on EA totals: 3–5 players would sit at Tier 6 on day one. **The ladders are re-tuned (table below)** and the operator approves the table. **Tier 6 is hand-awarded by the operator.** Stats can earn up to Tier 5.                                                                                                                                      |
| D5  | Tier is checked with the **skater pool and the goalie pool separately; the higher result wins.**                                                                                                                                                                                                                                                                                           |
| D6  | Approach A: **the worker precomputes** badge levels, tier and level into new tables, and pages only read them. This follows the "never compute on read" convention, gives the Progress-tab history, and guarantees tiers never downgrade.                                                                                                                                                  |
| D7  | One card component everywhere. **Flip only on the player page.** In lists, only the centre or hovered card animates.                                                                                                                                                                                                                                                                       |
| D8  | Mythic image assets are shrunk and loaded only when a mythic theme is on screen.                                                                                                                                                                                                                                                                                                           |
| D9  | **The player-page hero stays exactly as it is**, except the portrait card becomes the new card and an **EDIT button** sits under it. The design's identity column, Card Progress button and Last-10 strip are **not** adopted.                                                                                                                                                             |
| D10 | **EDIT is visible to everyone** and opens the locker read-only. Equip stays disabled until logins.                                                                                                                                                                                                                                                                                         |
| D11 | Build Locker v2 and the Action Map follow Parts 4–5 below.                                                                                                                                                                                                                                                                                                                                 |
| D12 | **The Dekes badge counts successful dekes** (EA `dekes_made`), not attempts (operator, 2026-10-07). Re-sized with the same rule; it fits the design's own ladder. No tier changes; Stick Menace L7 → L6.                                                                                                                                                                                   |
| D13 | **The Badges section goes toward the bottom of the player page** in the final version (operator, 2026-10-07). This supersedes "directly under the hero" in Part 3.                                                                                                                                                                                                                         |
| D14 | **The badge icons are placeholders.** The 21 lucide glyphs must be replaced with final icon art before the switch (operator, 2026-10-07). The operator designs them and delivers a zip. Format: one single-colour SVG per family, transparent background, square viewBox, named `<family id>.svg`. The badge skin tints each icon per theme, so multicolour art would break the 10 themes. |

---

## Part 1 — Data & rules

### Badge families and sources

There are 21 player families, ported from `badge-levels.js` `PLAYER`. Team families are out of scope.

| Family                                               | Source                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `p3v3` 3v3 Games Completed                           | site-recorded: `player_game_title_stats` rows with `game_mode='3s'`, games_played                |
| `p6v6` 6v6 Games Completed                           | site-recorded `game_mode='6s'` games_played **+** history `game_mode='6s'` skater_gp + goalie_gp |
| `p6g` 6's with Goalie                                | site-recorded: distinct 6s matches the player appears in where any BGM player `is_goalie`        |
| `pwins` Wins                                         | EA `skater_wins + goalie_wins` + history `wins`                                                  |
| `pgoals`, `pasts`, `pshots`, `phits`, `ptka`, `pblk` | EA columns + history columns                                                                     |
| `pdekes`, `pht`, `pbrk`, `pfo`, `pfight`             | EA only (`dekes_made`, `hat_tricks`, `breakaways`, `faceoff_wins`, `fights_won`)                 |
| `gg` Goalie Games Completed                          | EA `goalie_games_completed`                                                                      |
| `gw`, `gdsv`, `gpoke`                                | EA `goalie_wins`, `goalie_desperation_saves`, `goalie_poke_checks`                               |
| `gsv` Saves, `gso` Shutouts                          | EA `goalie_saves`, `goalie_shutouts` + history `total_saves`, `shutouts`                         |

**One source per title, never both.** For each (player, game title), use the EA row if one exists, or else the reviewed history rows. This keeps an archived title from being counted twice if history is later imported for it.

Badge **level** = the number of thresholds in the ladder that the total meets or exceeds (0 = locked, 30 = max).

### Re-tuned ladders (operator to approve)

Method:

- Keep each design ladder's curve.
- Scale every skater family so the club's 3rd-best career sits at level 15. Never scale below the design.
- Scale goalie families (up or down) so the club's best goalie value sits at level 12.
- Smooth levels 1–3 geometrically from the design's first milestone, so "first goal" is still level 1.

Generated from live data on 2026-10-07. The single source of truth becomes `packages/db/src/cards/badge-ladders.ts`, imported by both the worker and the web app.

| Badge                         | Lvl 1–5           | Lvl 6–10                 | Lvl 11–15                | Lvl 16–20                 | Lvl 21–25                     | Lvl 26–30                     |
| ----------------------------- | ----------------- | ------------------------ | ------------------------ | ------------------------- | ----------------------------- | ----------------------------- |
| 3v3 Games Completed (`p3v3`)  | 5 8 13 20 25      | 35 40 45 50 75           | 100 130 150 180 200      | 230 250 350 450 500       | 550 600 650 700 750           | 800 850 900 950 1000          |
| 6v6 Games Completed (`p6v6`)  | 5 15 42 120 150   | 220 250 280 310 460      | 620 770 920 1100 1200    | 1400 1500 2200 2800 3100  | 3400 3700 4000 4300 4600      | 4900 5200 5500 5800 6200      |
| 6's with Goalie (`p6g`)       | 1 2 6 15 20       | 25 30 35 40 45           | 50 55 60 65 70           | 75 80 85 90 100           | 110 120 130 140 150           | 160 170 180 190 200           |
| Wins (`pwins`)                | 5 13 35 93 120    | 140 160 190 210 230      | 260 280 300 320 350      | 370 390 420 440 460       | 510 560 600 650 700           | 740 790 840 880 930           |
| Goals (`pgoals`)              | 1 4 16 65 130     | 260 390 520 650 780      | 920 1000 1200 1300 1400  | 1600 1800 2100 2400 2600  | 2900 3100 3400 3700 3900      | 4200 4400 4700 5000 5200      |
| Assists (`pasts`)             | 1 5 25 120 250    | 370 490 740 990 1200     | 1500 1700 2000 2200 2500 | 3000 3500 3900 4400 4900  | 5400 5900 6400 6900 7400      | 7900 8400 8900 9400 9900      |
| Shots (`pshots`)              | 5 23 110 510 760  | 1000 1300 1500 2000 2500 | 3100 3600 4100 4600 5100 | 6100 7100 8100 9200 10000 | 11000 12000 13000 14000 15000 | 16000 17000 18000 19000 20000 |
| Dekes (`pdekes`)              | 5 11 23 50 75     | 100 130 150 200 250      | 300 350 400 450 500      | 600 700 800 900 1000      | 1100 1200 1300 1400 1500      | 1600 1700 1800 1900 2000      |
| Hat-Tricks (`pht`)            | 1 3 6 16 20       | 24 28 33 37 41           | 45 49 53 57 61           | 81 100 120 140 160        | 180 200 220 240 260           | 280 310 330 370 410           |
| Breakaways (`pbrk`)           | 1 3 8 23 30       | 38 45 53 61 68           | 76 83 91 98 110          | 120 130 140 150 160       | 170 180 200 210 230           | 240 260 270 290 300           |
| Hits (`phits`)                | 5 23 110 500 750  | 1000 1300 1500 2000 2500 | 3000 3500 4000 4500 5000 | 6000 7000 8000 9000 10000 | 11000 12000 13000 14000 15000 | 16000 17000 18000 19000 20000 |
| Faceoffs Won (`pfo`)          | 25 40 63 100 150  | 200 300 400 500 600      | 700 800 900 1000 1300    | 1500 1800 2000 2300 2500  | 2800 3000 3300 3500 3800      | 4000 4300 4500 4800 5000      |
| Takeaways (`ptka`)            | 5 23 110 510 770  | 1000 1300 1500 2100 2600 | 3100 3600 4100 4600 5100 | 6200 7200 8200 9200 10000 | 11000 12000 13000 14000 15000 | 16000 17000 18000 19000 21000 |
| Blocked Shots (`pblk`)        | 1 6 37 220 290    | 370 440 520 590 660      | 740 810 880 960 1000     | 1100 1200 1300 1400 1500  | 1600 1700 1800 1900 2000      | 2100 2200 2300 2400 2500      |
| Fights Won (`pfight`)         | 1 2 6 15 20       | 25 30 35 40 45           | 50 55 60 65 70           | 75 80 85 90 100           | 110 120 130 140 150           | 160 170 180 190 200           |
| Goalie Games Completed (`gg`) | 1 2 4 8 12        | 16 20 23 27 31           | 35 39 43 47 51           | 55 59 62 66 78            | 98 120 140 160 180            | 200 210 230 310 390           |
| Goalie Wins (`gw`)            | 5 6 7 8 9         | 10 11 13 14 16           | 17 19 21 22 24           | 25 27 29 30 32            | 35 38 41 44 48                | 51 54 57 60 63                |
| Saves (`gsv`)                 | 15 39 100 260 350 | 520 700 870 1000 1400    | 1700 2100 2800 3500 4400 | 5200 6100 7000 7800 8700  | 9600 10000 11000 12000 13000  | 14000 15000 16000 17000 18000 |
| Desperation Saves (`gdsv`)    | 5 6 7 9 11        | 14 16 18 20 23           | 25 27 29 32 34           | 36 38 41 43 45            | 50 54 59 63 68                | 72 77 81 86 90                |
| Goalie Poke-Checks (`gpoke`)  | 5 6 7 8 9         | 10 11 12 13 14           | 15 16 17 18 19           | 20 21 22 23 24            | 25 26 27 28 29                | 30 32 34 36 38                |
| Shutouts (`gso`)              | 1 2 3 4 5         | 6 7 8 9 10               | 11 12 13 14 15           | 16 17 18 19 21            | 25 29 33 38 42                | 46 50 54 58 63                |

Resulting tiers on 2026-10-07 live data (unchanged by D12):

| Tier        | Players                                          |
| ----------- | ------------------------------------------------ |
| T4 Elite    | silkyjoker85, Stick Menace, JoeyFlopfish         |
| T3 Stud     | HenryTheBobJr, camrazz                           |
| T2 Rookie   | MrHomiecide, joseph4577, Pratt2016 (goalie pool) |
| T1 Prospect | Ordinary_Samich, SCOOT BOY 42                    |

This matches the brief's pyramid: most players at T2–3, the top 3 at T4, nobody at T5 yet, and T6 hand-awarded. The worker's first live run must reproduce this table. Any difference is investigated before deploy.

### Tier

- A **tier bar** is the badge level a family needs to count toward tier N:
  - T2 needs level 6, T3 level 11, T4 level 16, T5 level 21. In general, `(N−1)×5+1`.
  - Tier N is reached when **4 families in a pool** meet tier N's bar, and every lower tier is also met.
- **Skater pool:** the 15 non-goalie families. **Goalie pool:** the 6 goalie families (`gg gw gsv gdsv gpoke gso`). Tier = max(skater-pool tier, goalie-pool tier). Stats cap at **T5**.
- **T6 (mythic)** is set only by the operator. Worker CLI:
  - `pnpm --filter worker card-mythic --player "<gamertag>" --theme <frozen|futureC|inferno|stormLive|olympus>`
  - `pnpm --filter worker card-mythic --player "<gamertag>" --clear`
  - Clearing returns the player to the stats tier.
- **Never downgrades.** Stored tier = max(stored, computed), unless the operator `--clear`s a mythic.

### Level (1–10 pips)

- Level is progress toward the next tier: the **average** of the best 4 eligible families' fractional progress from the current tier's bar to the next tier's bar. Fractional progress is based on value, not just level count:
  - `(value − threshold at the current bar) / (threshold at the next bar − threshold at the current bar)`
  - clamped to 0–1. A family below the current bar counts as 0.
- Level = `clamp(1 + floor(avg × 10), 1, 10)`. The pool that set the tier is used; on a tie between pools, the pool with the higher average wins.
- **Never downgrades within a tier.** It resets to the computed level when the tier rises. At T5 (the stats cap) and T6, the level shows 10.

### Theme

| Tier | Theme                      |
| ---- | -------------------------- |
| T1   | `away`                     |
| T2   | `home`                     |
| T3   | `alternate`                |
| T4   | `carbon`                   |
| T5   | `futureB` (Hardlight)      |
| T6   | the operator-chosen mythic |

- A theme is **unlocked** when `themeTier ≤ tier`. Mythics count as tier 6.
- The equipped theme is always "auto" (follows tier) until logins exist (D1).

### Storage — migration `0060_player_card_progression.sql`

This migration is hand-written, idempotent SQL, applied via `psql`. Migrations 0046 and later do not use `drizzle-kit migrate`. It is also mirrored in the Drizzle schema.

- `player_badge_levels`: `player_id` FK, `family_id text`, `value integer`, `level smallint` (CHECK 0–30), `computed_at timestamptz`. PK `(player_id, family_id)`.
- `player_card_progress`:
  - `player_id` PK FK
  - `tier smallint` (CHECK 1–6), `level smallint` (CHECK 1–10)
  - `tier_pool text` (`'skater' | 'goalie' | 'manual'`)
  - `mythic_theme text NULL`, with a CHECK on the 5 keys
  - `computed_at`, `updated_at`
- `player_card_events`:
  - `id bigserial`, `player_id` FK
  - `kind text` (`'tier_up' | 'level_up' | 'badge_level_up' | 'mythic_awarded' | 'mythic_cleared'`)
  - `family_id text NULL`, `from_value smallint`, `to_value smallint`, `occurred_at timestamptz`
  - Index on `(player_id, occurred_at DESC)`.
- `player_card_prefs` (equipped theme) is **not** created now. It arrives with logins.

### Worker step

- **Trigger:** after each ingestion cycle that touched member stats, matches, or history, run `recomputeCardProgression(db)`. It also runs once at startup.
- **Steps:**
  1. Read all totals with set-based queries.
  2. Compute levels and tiers with pure functions from `packages/db/src/cards/`.
  3. Upsert the three tables in **one transaction**.
  4. Write events only on increases.
- **First run (backfill):** writes the current state with no historical events. The history list starts empty and fills from then on, so there's no fake "level reached" spam.
- **Failure:** logged. It must never fail or block match ingestion.
- **CLI:** `pnpm --filter worker card-recompute [--dry-run]` prints the per-player tier/level table. It's used for the live verification above and after any ladder change.

### Queries (`packages/db/src/queries/cards.ts`)

- `getPlayerCardProgress(playerId)` returns tier, level, pool, mythic theme, the 21 badge rows, and the last 20 events.
- `getCardProgressForPlayers(playerIds)` returns tier, level, theme and best badge, for the carousel and depth chart. It runs one query, not one per card.

---

## Part 2 — The card

- **Files** (per the bundle README):
  - `components/cards/player-card.tsx`, `player-card.css` (keyframes and per-theme layers)
  - `components/cards/themes.ts`: typed port of `card-data.js` with only the 10 shipping keys `away home alternate carbon futureB frozen futureC inferno stormLive olympus`, plus `TIERS`
  - The exploration variants are not ported.
  - `PlayerSilhouette` keeps its current export path, because the lineup and action-tracker components import it.
- **Front:**
  - silhouette/portrait with the theme texture, jersey number block, name, position, 4-stat row, theme rule, and 10 level pips;
  - lead stat 23px in the accent colour, others 19px;
  - skater stats `GP G A PTS`, goalie `GP SV% GAA W`; a missing value shows `—`.
- **Back:** ledger header, career table (one row per title), last-10 strip, and the **best badge**. Best badge = highest level, with ties broken by family order. It stands in for an "equipped badge" until logins.
- **Used on:**
  - the home carousel and the roster depth chart: front only, still a link, `active` = centre card;
  - the player-page hero: replaces `PortraitCard`, click to flip, 420 ms Y-rotate.
- **Hover:** red border and glow, pointer tilt, and foil sweep, per the README. Gradient-rim themes keep their rim.
- **Motion budget:**
  - In lists, only the active or hovered card runs animations.
  - The Storm JS loop (6–16 s of rain, then 1–2 s of lightning) runs only while the card is on screen (IntersectionObserver).
  - `prefers-reduced-motion` shows static layers only.
- **Assets:**
  - T1–T5 are CSS-only. All images belong to the 5 mythics: about 21 MB raw, budget **≤ 3 MB total, ≤ 800 KB per mythic**.
  - Textures are converted to WebP at 2× card size. GIF and animated-WebP loops become short muted looping video (WebM/MP4), or animated WebP if video can't layer correctly.
  - Files go to `apps/web/public/images/cards/`.
  - Mythic layers load only when that theme renders. Locker swatches use small static thumbnails.
  - `xbox.svg` and `flag-us.svg` are dropped: the site already has platform and flag components.

## Part 3 — Player page

- **Hero (D9):** today's `ProfileHero` is unchanged except:
  - the `PortraitCard` slot becomes the new card at 264 px, flippable;
  - an **EDIT** button goes under it, styled per the README with a lucide `pencil` icon. It's shown to everyone (D10) and has no "new" dot (that needs per-member seen-state).
- **Locker drawer** (`components/cards/card-locker.tsx`, client):
  - Behaviour: modal; closes on Esc or backdrop click; focus is trapped; header and sub-line per the design.
  - **Theme tab** (opened by EDIT):
    - a large preview; locked themes preview at T1/L1, desaturated;
    - ←/→ arrows and keys; name, desc and status tag (LOCKED · PREVIEW / EQUIPPED (AUTO) / UNLOCKED);
    - a requirement block for locked themes; a 10-swatch rail with captions.
    - Footer: the AUTO · FOLLOW TIER pill is shown on and disabled. The primary button is disabled: it reads `EQUIPPED` on the current theme, `LOCKED` on locked ones, and `EQUIP` (disabled) with the caption "Equipping arrives with member logins" on unlocked ones.
    - No toast or undo.
  - **Progress tab:**
    - `LEVEL · <TIER> n / 10` with the note;
    - the next-tier requirement (`n / 4 BADGES`, bar, note), using the pool that set the tier;
    - the top 6 families as rows (28 px badge, bar, DONE / LVL x/y);
    - the T1–T6 tier track, where T6 shows "5 MYTHICS · AWARDED";
    - HISTORY from `player_card_events`, with an empty state "History starts <date>".
- **Badges section** (`components/badges/*`):
  - A new section **toward the bottom of the player page** (D13; it sat directly under the hero during the first preview): `badge.tsx`, `badge-shapes.ts` (port of `badge-shapes.js`) and `player-badges.tsx`.
  - Layout: header with `{unlocked} / 21 Unlocked · {levels} / 630 Levels`; a list grouped by family with the group→shape mapping; and a detail panel with a 76 px badge, progress, "n to LVL x+1", and the 30-cell ladder (hover previews, click pins).
  - Marker = frame step (`single/double/heavy`). Locked badges use the `dim` treatment.
  - Visual level → theme index `ceil(lvl/3)−1`, step `(lvl−1)%3+1`.
  - Badge skins come from `badge-levels.js` `SKINS`/`skinFor()`, ported into `badge-skins.ts`.
  - On mobile the list stacks above the detail panel.

## Part 4 — Build Locker v2

It replaces `LoadoutHistoryStrip` at `apps/web/src/app/roster/[id]/page.tsx:245`.

- **Build** = a run of consecutive games with the identical setup: archetype canonical, the 3 X-factor canonical names with tiers, height, weight, hand, and all 23 attribute values.
  - Snapshots are ordered by `matches.played_at`, not `captured_at`.
  - If a match has several snapshots, the latest captured one wins.
  - Only reviewed, non-CPU snapshots are used (the current gating).
- **Per build:**
  - distinct match count (GP) and W–L–OTL from `matches.result`. **DNF counts as a loss**, as on the rest of the site.
  - first and last played date, and whether it is the current build (newest).
- **Query:** `getPlayerBuilds(playerId, gameTitleId, limit = 4)` in `queries/player-loadouts.ts`, scoped to the title the page is showing. The header shows that title's real name, replacing the hard-coded "NHL 27".
- **UI:** per the v2 design.
  - Slim tiles in a row, scrolling sideways on mobile. Each tile has an archetype pill, a Current/date tag, 3 X-factor boxes (border = tier colour), Ht/Wt, Hand, GP and record.
  - One shared detail panel shows the 5 groups. Each group has its average, Δ, and one row per attribute with value, Δ and a bar.
  - Δ is measured against the next-older build; the oldest build has no Δ.
  - Defaults: `count=4`, deltas on, first tile open.
- **Hidden** when the player has no builds, as today.
- **Risk to verify:** reviewed OCR values should be exact. If real data still fragments one real build into several (single-value noise), the plan stops and asks rather than inventing a tolerance.

## Part 5 — Career Action Map

It replaces `CareerShotMap` (`page.tsx:247`) only. The EA zone heat map (`ShotMap`) stays.

- **Query:** `getPlayerCareerActions(playerId)` in `queries/match-events.ts`, extending `getPlayerCareerShots`' review gating.
  - **Rows:** events where the player is the **actor (By)** or the **target (On)**, including events with no position.
  - **Each row carries:**
    - actor and target names;
    - the penalty infraction (from `match_penalty_events`);
    - opponent abbreviation, mode, result and score;
    - `period_number` (never the OCR `period_label`), clock, and position confidence.
  - Cap: newest 1,000 events.
- **Direction normalisation** (pure helper in `packages/db`, unit-tested). Each (match, period) is turned so BGM attacks right:
  1. If `match_period_summaries.bgm_attack_direction` is set, use it.
  2. Otherwise, if the period has ≥ 3 BGM (`team_side='for'`) shots/goals with positions and ≥ 80% of them on one side of centre, BGM attacks that side.
  3. Otherwise the direction is unknown, and the period's events are **listed but not plotted**.
  - "Left" periods are rotated 180° (x → −x, y → −y), not mirrored, so a left-wing play stays on the attacker's left.
  - Evidence (live, 2026-10-07): 147 of 153 periods with ≥ 3 BGM shots clear the 80% bar, and all 3 recorded directions (match 250, P2–P4) agree with the shot-side rule.
- **UI:** per the design.
  - Filters: period segments with counts; By / On / All; type chips (Goal, Shot, Hit, Penalty, Faceoff); an isolated-game chip. The counts for each filter ignore that filter's own selection.
  - The rink with shape markers: accent colour for By, grey for On. Pinning a marker fades the others and scrolls the list.
  - Pin bar, legend with "N not plotted", and an event list sorted by game (default) / newest / type. Sticky game headers isolate a game.
  - Header "N reviewed games" = distinct matches in the result.
- **Kept from the live map** (the design is silent on these):
  - extrapolated positions dimmed;
  - overlapping markers spread with `lib/marker-layout.ts`;
  - the section hidden when the player has < 5 positioned events.
  - Faceoffs that do carry positions are plotted; the rest are listed.
- `career-shot-map.tsx` is deleted once replaced.

---

## Test run (operator, 2026-10-07)

Everything is first built **side by side** on a parallel preview page, so the operator can compare before and after and ask for tweaks:

- **Branch:** all work happens on `feat/player-cards`. New components are added next to the old ones, and existing pages and components are not modified during the test run.
- **Preview route:** `/preview/roster/[id]` is a copy of the player page using the new pieces, plus a gallery of all 10 themes and a home-style card row. The reference player is **#3 Stick Menace (Igor Orlov)**; a goalie (#12 Pratt2016) is the second check.
  - The route renders only outside production: `notFound()` when `NODE_ENV === 'production'`. It is never deployed.
- **Data:**
  - Last night's Hotel-Echo backup is restored into a **separate local database `eanhl_preview`** in the main PC's db container. The frozen 2026-10-05 fallback database `eanhl` is not touched.
  - The dev server and the worker CLIs point at `eanhl_preview` for the test run.
  - Migration 0060 and the recompute run there first.
- **Viewing:** the dev server on the main PC, `localhost:3000/preview/roster/3` next to `/roster/3`. From the phone, use the same paths over Tailscale.
- **Live is untouched** until the final switch. **Switch:**
  1. Move the new components into the real pages (hero, home carousel, depth chart, Build Locker, Action Map).
  2. Delete the preview route and the replaced components.
  3. Apply migration 0060 on Hotel-Echo after a fresh backup.
  4. Deploy web + worker.
  5. Verify `card-recompute --dry-run` on live reproduces the tier table.

## Build order

Each step gets its own implementation plan, verification and commit on `feat/player-cards`. Nothing is deployed until the switch.

1. **Badges (Part 1 + the badges section of Part 3)**
   - copy the design references into `docs/design/handoffs/2026-10-cards/`;
   - set up the `eanhl_preview` database;
   - shared ladders/rules module with unit tests;
   - migration 0060 on `eanhl_preview`;
   - worker step and both CLIs; queries;
   - the preview route scaffold;
   - the Badge component and the Player Badges section.
   - **Check:** `card-recompute --dry-run` reproduces the tier table above.
2. **Card (Part 2):** themes, CSS, optimised assets, shown on the preview page (hero slot, gallery, card row).
3. **Locker (rest of Part 3):** EDIT button and drawer on the preview page.
4. **Build Locker v2 (Part 4).** Independent.
5. **Action Map (Part 5).** Independent.
6. **Switch** (see Test run).

## Testing

- **Unit:**
  - ladder→level; tier for both pools, the T5 cap and the T6 override; never-downgrade; the level formula;
  - one-source-per-title merging; theme resolution and unlocks;
  - build grouping (including several snapshots per match and the DNF→loss rule);
  - direction normalisation (fixture from match 250's recorded periods, unclear periods → unplotted).
- **DB/worker:** the recompute is idempotent (two runs produce identical rows and no duplicate events); events are written only on increases.
- **Visual:** screenshots of the new card (every tier), locker, badges section, Build Locker and Action Map at desktop and 390 px, compared side by side with the prototypes. Reduced-motion is checked.
- **Performance:** home and player-page transfer size and the phone benchmark from the 2026-10-06 perf pass must not regress beyond noise for a player without a mythic.
- **Gates:** typecheck, the worker test suite, and prettier stay green. `pnpm lint` is pre-existing-red, so new files are checked in isolation.

## Out of scope

- Member logins; equip/save; `player_card_prefs`; the EDIT "new" dot; equip toast/undo.
- Team badges; season sub-cards; enhancements and augmentations; card condition; locker-room tags.
- Any change to the zone heat map, the per-game action tracker, or ingestion behaviour beyond the recompute step.

## Open items to verify during step 1

- **NHL 26 EA totals:** confirm when they were last refreshed relative to the 2026-09-07 club-ID takeover, and that they contain only Boogeymen members. NHL 26 member ingestion must stay off.
- **History `wins` is 0 on every reviewed row** (not captured). The Wins badge therefore counts NHL 26 onward unless history wins are imported later.
- **Nobody has a Goalie Poke-Checks level yet** (best career is 4; level 1 = 5). This is accepted.
