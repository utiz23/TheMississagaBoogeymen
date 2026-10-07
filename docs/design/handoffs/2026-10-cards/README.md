# Handoff: Player Cards, Card Locker & Player Badges

## Overview
Collectible player-card system for the Mississauga Boogeymen stats site (`utiz23/TheMississagaBoogeymen`, `apps/web`):

- **PlayerCard**: a themable trading-card component (front + back, 10 unlockable themes, 6 tiers, level pips, animated effects).
- **Card Locker**: the player profile hero (`/roster/[id]`) with the card, an owner-only **EDIT** entry point, and a locker drawer for browsing/equipping themes and viewing tier progress.
- **Badge**: a parametric milestone badge (shape, frame, marker, theme skin).
- **Player Badges**: the profile "Badges" section. 21 career-milestone badges grouped by family, plus a detail panel with a 30-level ladder.
- **Badge Leveling**: spec sheet for how badge levels map to themes, sub-level markers, and family shapes. This is a reference sheet and does not ship as a page.

## About the design files
The files in this bundle are **design references built in HTML**. They show the intended look and behavior and are not production code to copy. Rebuild them in the existing `apps/web` codebase (Next.js 15 App Router, Tailwind CSS 4, shadcn/ui) using its established patterns.

To view a design, serve this folder over HTTP (for example `npx serve .`) and open any `*.dc.html` file. `support.js` is a runtime for the prototype only and should not be ported.

**Suggested target layout:**
```
apps/web/src/components/cards/
  player-card.tsx          ← replaces/extends components/home/player-card.tsx
  player-card.css          ← keyframes + per-theme layers (extends existing player-card.css)
  themes.ts                ← port of card-data.js THEMES / THEME_ORDER / TIERS
  card-locker.tsx          ← drawer + equip logic (client component)
apps/web/src/components/badges/
  badge.tsx
  badge-shapes.ts          ← port of badge-shapes.js
  badge-ladders.ts         ← port of badge-levels.js
  player-badges.tsx
apps/web/public/images/cards/  ← assets/* textures and FX
```
`card-data.js`, `badge-levels.js`, and `badge-shapes.js` are plain data plus pure helpers. Port them to typed TS modules almost one-to-one. They are the source of truth for every theme layer, color, ladder threshold, and clip-path.

## Fidelity
**High fidelity.** Colors, type, spacing, and motion are final. Every element is inline-styled in the HTML, so exact values can be read directly from the source. Match them pixel for pixel.

Note: these designs use the live site's palette from `apps/web/.../player-card.css` (page `#1a1819`, accent `#e84131`), not the design-system defaults (`#09090b` / `#e11d48`). Keep the site values.

---

## Screens / Views

### 1. PlayerCard (`PlayerCard.dc.html`)
- **Size:** 264×430 in the profile hero, with a 320×480 preview. The card scales with its container width, and the aspect ratio stays fixed.
- **Props:** `playerId` (key into `PLAYERS`), `cfg`:
  `{ tier 1–6, level 1–10, theme ('auto' | theme key), face 'front'|'back', pos ('LW'|'G'|…), stats [4 keys], badge {fam, level}, levelStyle 'back', active bool, motion {on, tilt, sweep, pulse, foil, smoke, frost, storm, inferno, flip} }`
- **Theme resolution:** `theme === 'auto'` or missing → `TIERS[tier].theme`.
- **Front:** a portrait/silhouette area with a theme texture, a jersey number block, the name, position, and a 4-stat row. The 4th stat is the "lead" stat: 23px in accent color, while the others are 19px. Below that sit a theme rule line (grey at rest, red `RED_RULE` gradient on hover) and 10 level pips (`pipOn` / `pipOff` per theme).
- **Back:** a ledger layout with header, career table (`career` rows), last-10 strip, and the equipped badge. Per-theme tokens are `backHead`, `ledgerBg`, `ledgerBorder`, and so on.
- **Stat defaults:** skater `GP G A PTS`, goalie `GP SV% GAA W`. Missing values render as `—`.
- **Hover:** the border becomes `rgba(232,65,49,0.45)` (except on gradient-rim themes). The shadow becomes `0 14px 32px rgba(0,0,0,.45), 0 0 32px rgba(232,65,49,.22)`. Tilt follows the pointer (`motion.tilt`) and a foil sweep runs (`motion.sweep`).
- **Flip:** 3D Y-rotate between faces, about 420ms.
- **Themes** (`THEME_ORDER`, unlock order):

| # | key | Name | Tier |
|---|---|---|---|
| 1 | away | Away | T1 |
| 2 | home | Home | T2 |
| 3 | alternate | Alternate | T3 |
| 4 | carbon | Carbon-Fiber | T4 |
| 5 | futureB | Hardlight | T5 |
| 6 | frozen | Frozen | T6 mythic |
| 7 | futureC | Cyber | T6 mythic |
| 8 | inferno | Inferno | T6 mythic |
| 9 | stormLive | Storm | T6 mythic |
| 10 | olympus | Maximus | T6 mythic |

  Each theme's `desc` in `card-data.js` describes its look. `THEMES` also contains exploration variants (`throwback`, `glitch`, `futureA`, `infernoB`, `frozenBefore`, `stormV1–V6`) that are **not shipping**. Port only the 10 keys above.
- **Animated effects:** all are CSS keyframes in the `<helmet><style>` of `PlayerCard.dc.html` (`hpcFoil`, `hpcSnowA/B`, `hpcFrostBreath`, `hpcStrike`, `hpcRain`, `hpcEmber`, `hpcFlame`, `hpcMolten`, `hpcRays`, `hpcMotes`, `hpcGridRun`, `hpcScan`, `hpcTrace`, `hpcCurrent`, `hpcSpin`, and more). Port them to `player-card.css`. The **Storm** theme uses a JS loop: rain plays for a random 6–16s, then the lightning footage (`tex-storm-live.webp`) plays for 1–2s, and the cycle repeats. See `stormLoop()`.
- Respect `prefers-reduced-motion`: set `motion.on = false`, which shows static layers only.

### 2. Card Locker (`Card Locker.dc.html`): profile hero + locker drawer
**Page shell:** background `#1a1819`.
- **Sticky nav:** 56px tall, `rgba(31,29,30,.95)` with `backdrop-filter: blur(4px)` and a `1px rgba(232,65,49,.15)` bottom border. It shows the logo at 30px and `BOOGEYMEN` (16px/800, tracking .14em). Nav links are 13px/600 with tracking .16em. The active link uses `inset 0 -2px 0 #e84131`.
- **Main column:** `max-width 1180px`, padding `28px 20px 64px`, gap 24px. It starts with a `← ROSTER` crumb (12px/600, tracking .2em, `#71717a`).

**Hero section:** grid `auto | minmax(0,1fr)`, gap 40px, padding 32px, border `1px #2a2829`.
- Background: `radial-gradient(60% 80% at 15% 0%, rgba(232,65,49,.08), transparent 70%), linear-gradient(180deg,#1f1d1e,#161415)`.
- A 1px top strip runs `linear-gradient(90deg,#7f1d1d,#e84131,#7f1d1d)`.
- **Left column (264px):**
  - PlayerCard. Clicking it flips the card.
  - **EDIT** button, shown only when `owner`. Full width, padding `10px 12px`, border `1px #e84131`, background `#1a1819`, text `#ef6a5e` 12px/700 with tracking .16em, plus a lucide `pencil` icon at 14px. Hover fills the button `#e84131` with white text over 150ms.
  - A 10px red "new" dot sits at the top-right of EDIT when a new theme has unlocked and the locker hasn't been opened yet.
- **Right column:**
  - Identity row: number (22px/900), position chip (`LW`, green `#23cf1d` on `rgba(35,207,29,.08)` with a `.45` border, radius 3px), record `35-30-3`, `·`, `51% WIN`.
  - Name: H1 at 56px/900, line-height .95, uppercase.
  - Role line: `PLAYER · SKATER · LEFT WING · SNIPER`, 12px/600, tracking .22em, `#71717a`.
  - Stat row: gap 32px, with a top border. Labels are 11px `#6e6b6c` and values are 34px/900 tabular. PTS is shown in `#e84131`.
  - **Card Progress button:** contains the tier chip `T3 STUD · LVL 6/10`, a 10-pip bar (14×4px, gap 3px; on `#e84131` with a glow, off `#2a2829`), and `CARD PROGRESS →`. Clicking it opens the locker on the Progress tab.
- Below the hero sits the **LAST 10 GAMES** strip (see source).

**Locker drawer**
- Opens from EDIT on the Theme tab, or from Card Progress on the Progress tab.
- It is a modal overlay. Clicking the backdrop or pressing `Esc` closes it.
- **Header:** `CARD LOCKER`, then a sub-line `IGOR ORLOV · T3 STUD · LVL 6/10 · 7 / 10 THEMES`.
- **Tabs:** `THEME` / `PROGRESS`. The active tab is `#fafafa` with `inset 0 -2px 0 #e84131`. Inactive tabs are `#71717a`.
- **Theme tab:**
  - Large preview of the browsed theme. Locked themes preview at tier 1, level 1, with `saturate(.55) brightness(.8)` applied.
  - Prev/next arrows. Keyboard ←/→ also works.
  - Theme name, `desc`, and a status tag:
    - Locked: `T6 · LOCKED · PREVIEW` in `#71717a`
    - Equipped: `T3 · EQUIPPED (AUTO)` in `#e84131`
    - Unlocked: `T4 · UNLOCKED` in `#10b981`
  - Locked themes show a requirement block (see the Progress tab).
  - **Swatch rail:** all 10 themes, each a mini swatch using that theme's layers and rim plus its short label (`AWAY, HOME, ALT, CARBON, HARDLIGHT, FROZEN, CYBER, INFERNO, STORM, MAXIMUS`).
    - Selected swatch: ring `0 0 0 2px #1f1d1e, 0 0 0 3px #e84131`.
    - Locked swatch: opacity .45 with `grayscale(.85) brightness(.7)`.
    - The equipped theme gets a red dot, and the newest unlocked theme gets a `NEW` tag.
    - Rail captions: `T1–T5 · ONE THEME PER TIER`, `T6 · FIVE MYTHICS`.
  - Footer:
    - `AUTO · FOLLOW TIER` checkbox-pill (on: border `#e84131`, bg `rgba(232,65,49,.10)`, text `#ef6a5e`).
    - `CANCEL`.
    - Primary button `EQUIP <NAME>` (bg/border `#e84131`, white). When disabled it reads `LOCKED` or `EQUIPPED`, with a transparent background, border `#3a3839`, text `#52525b`, and the `not-allowed` cursor.
- **Progress tab:**
  - `LEVEL · STUD 6 / 10` with the note "Participation progress: GP, wins, role production. Never downgrades."
  - **Next-tier requirement:** `NEXT · T4 ELITE`, `n / 4 BADGES`, a progress bar, and the note `4 role badges at Tier IV (LVL 16+).` The threshold is `(nextTier−1)×5+1`, counting non-goalie badge families.
  - The top 6 families are listed as rows, each with a 28px badge, short name, bar, and value. Completed rows show `DONE` with a green `#10b981` bar. Incomplete rows show `LVL x/y` with a red bar.
  - **TIER TRACK:** T1–T6 chips with tier label and theme name, where T6 shows `5 MYTHICS`. The current tier is red-tinted, completed tiers are `#262425`, and future tiers are outlined.
  - **HISTORY:** a list of dated events (`OCT 04 Level 6 reached`, …).
- **Equip flow:**
  1. The drawer closes and the hero card flips to its back.
  2. After 420ms, the new theme is applied and the card flips to its front.
  3. A toast appears, for example `CARBON EQUIPPED`, with an **UNDO** action. It auto-dismisses after 6s. UNDO restores the previous `equipped` value.
- **Non-owner view** (`owner=false`): no EDIT button and no new-dot. Card Progress stays visible, read-only.

### 3. Badge (`Badge.dc.html`)
Parametric badge. Props: `shape`, `tier 1–6`, `family`, `size` (px width; height = width × shape aspect ratio), `frame`, `marker`, `label`, `glow`. Advanced `cfg` fields are `skin` (theme overrides), `fam` (a family object), `pips`, `levelText`, `labelSize`, and `labelColor`.
- **Shapes:** hex, shield, round, octagon, diamond, chamfer, triangle, square, invtri, banner. These are CSS `clip-path` polygons with rounded corners, generated in `badge-shapes.js`.
- **Frame:** `single` / `double` (outer ring + gap + inner ring) / `heavy` (rim ×2.4) / `bevel`.
- **Marker:** none / roman / pips / tab / bars (chevrons) / stars.
- **Label:** below / ribbon / none.
- **Icon:** a lucide glyph masked in the theme `icon` color.
- **Base tiers:** `BADGE_TIERS` (Rookie, Regular, Proven, Veteran, Franchise, Legend). Theme skins come from `BGM_LEVELS.skinFor(themeKey)`.

### 4. Player Badges (`Player Badges.dc.html`): profile section
- **Header:** `▌ Badges`, with the sub-line `Career milestones · player · <archetype>` and `{unlocked} / 21 Unlocked · {levels} / 630 Levels`.
- **Left: grouped list** (`GROUP_LIST`: Games & Wins, Scoring, Physical, Defense & Possession, Goalie). Each group header shows `unlocked/count`.
- **Each row:** 30px badge, short name, theme label (e.g. `Carbon-Fiber II`), and `lvl /30`.
  - Selected row: bg `#2a2829`, `inset 2px 0 0 #e84131`, name `#fafafa`, level `#e84131`.
  - Locked row: dimmed (see props).
- **Right: detail panel.**
  - 76px badge, name, `LVL x / 30`, theme label.
  - Progress (`val / next unit`), remaining (`n to LVL x+1`), and a % bar.
  - **30-cell ladder:** 10 themes × 3 steps. Hovering a cell previews that level, and clicking pins it, which adds a white inset ring.
  - Footer: `Source EA NHL · Boogeymen`.
- **Level → visual:**
  - Theme index = `ceil(lvl/3)−1` into `THEME_ORDER`.
  - Step inside the theme = `(lvl−1)%3+1`, shown by frame `single/double/heavy` (the default `marker=frame`).
- **Props:**
  - `marker`: frame | pips | roman | tab
  - `locked`: dim (`grayscale(1) brightness(.55)`, opacity .35) or silhouette (`brightness(.25)`, opacity .7)
  - `levels`: number[21]

### 5. Badge Leveling (`Badge Leveling.dc.html`): spec reference
- Shows 6 sub-level marker options. **Frame step** (option F) is the chosen one, and Player Badges uses it.
- Shows the 10-theme ladder for a chosen family, with each level's threshold, and the family-to-shape mapping:

| Group | Shape |
|---|---|
| Games & Wins | hex |
| Scoring | round |
| Physical | invtri |
| Defense & Possession | square |
| Goalie | octagon |
| Team | banner |

- The "OPEN ITEMS" list on this sheet lists unresolved decisions.

---

## State management
- **Card Locker:** `{ equipped: 'auto' | themeKey, seen: bool, open, tab: 'theme'|'progress', browse: themeKey, face: 'front'|'back', toast: {text, prev} | null }`.
  - The prototype persists `equipped` and `seen` to localStorage under `bgm-card-locker-v1`. In production, persist them per player on the server (for example a `player_card_prefs` table: `player_id`, `equipped_theme`, `seen_tier`).
- **Unlocks:** a theme is unlocked when `themeTier(k) <= playerTier`. Mythics count as tier 6.
- **Player tier and level:** derived server-side. Tiers never downgrade. The next tier needs 4 non-goalie badge families at level ≥ `(next−1)×5+1`.
- **Badges:** a player's level per family comes from career stat totals against `ladder[]`. Level = the count of thresholds met (0 = locked, max 30).
- **Owner check:** EDIT shows only when the signed-in user is this player.

## Design tokens (used across these screens)
- **Surfaces:** page `#1a1819`, panel `#1f1d1e` → `#161415`, raised `#262425`, line `#2a2829`, strong line `#3a3839`.
- **Accent:** `#e84131`, light `#ef6a5e`, deep `#c2321f`, dark `#7f1d1d`. Success `#10b981`. Position green `#23cf1d`.
- **Text:** `#fafafa`, `#e4e4e7`, `#d4d4d8`, `#a1a1aa`, `#71717a`, `#6e6b6c`, `#52525b`.
- **Tier chips:** see `TIERS[n].chip` in `card-data.js`.
- **Type:** Barlow (body) and Barlow Semi Condensed (`--font-condensed`; every label, number, and name). Labels are uppercase with tracking .14–.22em. All numbers use `tabular-nums`.
- **Radii:** panels are sharp (0). Chips 3px, dots and avatars round.
- **Shadows:** none on page panels. Card shadows are defined in the theme data.
- **Motion:** 150ms color/border transitions, 420ms card flip, 6s toast.

## Assets
- `assets/bgm-logo.png`: already in the repo at `public/images/bgm-logo.png`.
- `assets/xbox.svg`, `flag-us.svg`: card back platform and nationality marks.
- **Theme textures and FX:** `tex-ice-glacier.png`, `ice-cracks.avif`, `tex-storm-clouds.png`, `tex-storm-live.webp` (lightning footage), `fx-storm-rain.gif`, `fx-storm-bolt(-2).png`, `tex-olympus-temple.png`, `fx-future-mask.png`, `tex-future-circuit.webp`, `tex-inferno-gate.webp`, `tex-inferno-cracks.webp`, `fx-inferno-fire.gif`, `fx-inferno-embers-slow.gif`. Move them to `public/images/cards/` and update the paths in the ported theme data.
- **Icons:** lucide (`lucide-react` in production). Badge glyph names are in `badge-levels.js` (`glyph` field).

## Files
- `PlayerCard.dc.html`: card component, all theme rendering and keyframes.
- `Card Locker.dc.html`: profile hero and locker drawer.
- `Badge.dc.html`: badge component.
- `Player Badges.dc.html`: badges section.
- `Badge Leveling.dc.html`: leveling spec sheet.
- `card-data.js` → `window.BGM_CARD`: `THEMES`, `THEME_ORDER`, `TIERS`, `BADGE_TIERS`, `FAMILIES`, `PLAYERS` (demo data), `DEFAULT_STATS`, `STAT_LABELS`.
- `badge-levels.js` → `window.BGM_LEVELS`: `PLAYER` / `TEAM` families with 30-step ladders, `GROUPS`, `GROUP_LIST`, `THEME_ORDER`, `SKINS` / `skinFor()`.
- `badge-shapes.js` → `window.BGM_BADGE`: `SHAPES` (clip-paths and aspect ratios), `FRAMES`, `MARKERS`, `LABELS`.
- `support.js` and `_ds/`: prototype runtime and design-system CSS. They are only needed to view the files.
