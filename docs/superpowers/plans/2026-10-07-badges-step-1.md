# Badges (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute every player's 21 badge levels, card tier and card level in the worker. Show the Player Badges section on a parallel preview copy of the player page (`/preview/roster/3`), against a fresh local copy of the live data. Nothing is deployed.

**Architecture:**

- Pure rules and data live in a new `@eanhl/db/cards` module: catalog, ladders, tier/level rules and the career-totals merge. Both the worker and the web app import it.
- The worker loads totals with four SQL reads, applies the rules, and writes three new tables (migration 0060) in one transaction. Two CLIs drive it: `card-recompute` and `card-mythic`.
- The web app reads the tables through `getPlayerCardProgress` and renders a ported `Badge` and `PlayerBadges` UI on a dev-only preview route.

**Tech Stack:** TypeScript (strict), Drizzle ORM 0.45 + postgres-js, PostgreSQL 16, Next.js 15 App Router, React 19, `node:test`, lucide-react, ffmpeg (texture conversion).

**Spec:** `docs/superpowers/specs/2026-10-07-player-cards-badges-design.md` (Part 1, Part 3 "Badges section", "Test run", Build order step 1)

## Global Constraints

- **Branch:** all work happens on `feat/player-cards`. Never commit to `main` from this plan, and never push without the operator's OK. A new branch needs that OK.
- **Live is untouched:** no command in this plan touches Hotel-Echo except the read-only `scp` of the nightly dump in Task 4.
  - Every worker CLI run must print `database=eanhl_preview` before it writes.
  - The main PC's existing `eanhl` database (the frozen 2026-10-05 fallback) is never written.
- **Existing pages and components are not modified.** New files only, plus these exact edits: `packages/db/package.json`, `packages/db/src/schema/index.ts`, `packages/db/src/queries/index.ts`, `apps/worker/package.json`, `apps/worker/src/ingest.ts`, `apps/web/package.json`.
- **Never stage `apps/web/src/app/preview/archetypes/`** (the operator's own untracked file), `docs/cards/*` (the operator's untracked drafts), or any `*.zip`. Always `git add` exact paths.
- **Migrations:** 0046 and later are hand-written idempotent SQL applied with `psql`. Never run `drizzle-kit generate` or `migrate`.
- **Rebuild before consumers:** after editing `packages/db/src/`, run `pnpm --filter @eanhl/db build` before typechecking the worker or web.
- **Lint:** `pnpm lint` is red repo-wide from earlier problems. Lint new files in isolation with `pnpm --filter <pkg> exec eslint <paths>`. The green gates are typecheck, these unit tests, and prettier.
- **Dev server:** never run `pnpm --filter web build` while a dev server is running; it corrupts `apps/web/.next`.
- **Number formatting** in any UI text uses `toLocaleString('en-US')`, so the server and the browser render identical text.
- **Palette:** use the site palette: page `#1a1819`, accent `#e84131`. Not the design-system defaults `#09090b` / `#e11d48`.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A player with no computed rows** (a new member or a guest): the badges section shows 21 locked badges and `0 / 21`, and the query returns `standing: null` without throwing. Pinned by Task 9 `buildBadgeBoard([])` and checked by opening `/preview/roster/28` (Utiz23, 0 GP) in Task 10.
2. **A hand-awarded mythic must survive the worker:** a recompute, including one that races the `card-mythic` CLI, never overwrites `tier_pool='manual'`. Pinned by the Task 2 `applyStanding` test, the Task 5 `setWhere` guard, and the Task 6 award → recompute → still-T6 check.
3. **Lower totals** (an EA correction, or a future ladder change) never lower the tier or level and never emit "down" events. Pinned by the Task 2 `applyStanding` and `diffCardEvents` tests.
4. **The same title in EA and in history** is counted once. Pinned by the Task 3 "one source per title" test.
5. **Locked (level 0) and maxed (level 30) badges** show correct detail text: `0 / 1 goals` + `1 to LVL 1`, and `Maxed · 6,000 goals` with no remaining. Pinned by Task 9 `badge-board.test.ts`.

---

### Task 1: Branch, design references, badge catalog

**Files:**

- Create: `docs/design/handoffs/2026-10-cards/` (reference copies, listed in Step 2)
- Create: `packages/db/src/cards/badge-catalog.ts`
- Create: `packages/db/src/cards/index.ts`
- Test: `packages/db/src/cards/badge-catalog.test.ts`
- Modify: `packages/db/package.json` (the `exports` map)

**Interfaces:**

- Produces, from `@eanhl/db/cards`:
  - constants: `BADGE_FAMILY_IDS`, `BADGE_FAMILIES`, `BADGE_GROUPS`, `BADGE_LADDERS`, `BADGE_MAX_LEVEL` (30), `CARD_THEME_ORDER`, `CARD_THEME_NAMES`, `MYTHIC_THEMES`, `TIER_LABELS`, `TIER_THEME`
  - functions: `poolOf(family): TierPool`
  - types: `BadgeFamilyId`, `BadgeFamily`, `BadgeGroup`, `BadgeGroupId`, `BadgeShapeId`, `TierPool`, `CardThemeKey`, `MythicThemeKey`, `StatsTier`, `CardTier`

- [ ] **Step 1: Create the branch**

```bash
cd /home/michal/projects/eanhl-team-website
git status --short   # expect only: apps/web/src/app/preview/ (archetypes), docs/cards/badge-catalog.md, docs/cards/card-system-brief.md
git checkout -b feat/player-cards
```

- [ ] **Step 2: Copy the design references (no raw images, no prototype runtime)**

```bash
cd /home/michal/projects/eanhl-team-website
D=docs/design/handoffs/2026-10-cards
TMP=$(mktemp -d)
unzip -q "Card Customization Page.zip" -d "$TMP/cards"
unzip -q "Build Locker component design.zip" -d "$TMP/locker"
unzip -q "Player Action Map replacement.zip" -d "$TMP/map"
mkdir -p "$D"
C="$TMP/cards/design_handoff_player_cards_badges"
cp "$C"/README.md "$C"/*.dc.html "$C"/card-data.js "$C"/badge-levels.js "$C"/badge-shapes.js "$D"/
cp "$TMP/locker/Build Locker v2.dc.html" "$D"/
cp "$TMP/map/Player Action Map.dc.html" "$TMP/map/ref/rink.svg" "$D"/
ls "$D"   # README.md, 5 card/badge .dc.html, 3 .js, Build Locker v2.dc.html, Player Action Map.dc.html, rink.svg
```

Write `docs/design/handoffs/2026-10-cards/SOURCE.md`:

```markdown
# 2026-10 card / badge / build-locker / action-map handoffs

Reference copies from the operator's Claude Design exports (repo-root zips, git-ignored):
`Card Customization Page.zip`, `Build Locker component design.zip`,
`Player Action Map replacement.zip`. Raw image assets and the prototype runtime
(`support.js`, `_ds/`) are not copied. Optimised assets live under
`apps/web/public/images/`. Spec: `docs/superpowers/specs/2026-10-07-player-cards-badges-design.md`.
```

- [ ] **Step 3: Write the failing catalog test**

Create `packages/db/src/cards/badge-catalog.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BADGE_FAMILIES,
  BADGE_FAMILY_IDS,
  BADGE_GROUPS,
  BADGE_LADDERS,
  BADGE_MAX_LEVEL,
  poolOf,
} from './badge-catalog.js'

void test('21 families with unique ids, in BADGE_FAMILY_IDS order', () => {
  assert.equal(BADGE_FAMILIES.length, 21)
  assert.deepEqual(
    BADGE_FAMILIES.map((f) => f.id),
    [...BADGE_FAMILY_IDS],
  )
})

void test('every ladder has 30 strictly increasing positive thresholds', () => {
  for (const id of BADGE_FAMILY_IDS) {
    const ladder = BADGE_LADDERS[id]
    assert.equal(ladder.length, BADGE_MAX_LEVEL, id)
    assert.ok((ladder[0] ?? 0) > 0, id)
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(
        (ladder[i] ?? 0) > (ladder[i - 1] ?? 0),
        `${id} not increasing at level ${String(i + 1)}`,
      )
    }
  }
})

void test('every family sits in a listed group; the goalie group is the goalie pool', () => {
  const groupIds = new Set(BADGE_GROUPS.map((g) => g.id))
  for (const f of BADGE_FAMILIES) assert.ok(groupIds.has(f.group), f.id)
  assert.equal(BADGE_FAMILIES.filter((f) => poolOf(f) === 'skater').length, 15)
  assert.deepEqual(
    BADGE_FAMILIES.filter((f) => poolOf(f) === 'goalie').map((f) => f.id),
    ['gg', 'gw', 'gsv', 'gdsv', 'gpoke', 'gso'],
  )
})

void test('ladders match the approved spec table (spot checks)', () => {
  assert.deepEqual(BADGE_LADDERS.pgoals.slice(0, 5), [1, 4, 16, 65, 130])
  assert.equal(BADGE_LADDERS.pgoals[29], 5200)
  assert.deepEqual(BADGE_LADDERS.phits.slice(0, 5), [5, 23, 110, 500, 750])
  assert.equal(BADGE_LADDERS.phits[29], 20000)
  assert.deepEqual(BADGE_LADDERS.gsv.slice(0, 5), [15, 39, 100, 260, 350])
  assert.equal(BADGE_LADDERS.gso[29], 63)
  assert.equal(BADGE_LADDERS.p6g[29], 200)
})
```

- [ ] **Step 4: Run it and see it fail**

Run: `pnpm --filter @eanhl/db build`
Expected: FAIL. `tsc` reports `Cannot find module './badge-catalog.js'`.

- [ ] **Step 5: Write the catalog**

Create `packages/db/src/cards/badge-catalog.ts`. The ladders are the approved table from the spec:

```ts
/**
 * Badge catalog for the player-card progression system.
 *
 * Families, groups and the re-tuned 30-step ladders approved in
 * docs/superpowers/specs/2026-10-07-player-cards-badges-design.md (Part 1).
 * Pure data: imported by the worker (recompute) and the web app (badge UI),
 * so this module must never import the database client.
 */

export const BADGE_FAMILY_IDS = [
  'p3v3',
  'p6v6',
  'p6g',
  'pwins',
  'pgoals',
  'pasts',
  'pshots',
  'pdekes',
  'pht',
  'pbrk',
  'phits',
  'pfo',
  'ptka',
  'pblk',
  'pfight',
  'gg',
  'gw',
  'gsv',
  'gdsv',
  'gpoke',
  'gso',
] as const
export type BadgeFamilyId = (typeof BADGE_FAMILY_IDS)[number]

export type BadgeGroupId = 'games' | 'scoring' | 'physical' | 'defense' | 'goalie'
export type BadgeShapeId = 'hex' | 'round' | 'invtri' | 'square' | 'octagon'
export type TierPool = 'skater' | 'goalie'

export interface BadgeFamily {
  id: BadgeFamilyId
  name: string
  short: string
  /** lucide icon name (kebab-case). */
  glyph: string
  group: BadgeGroupId
  unit: string
}

export interface BadgeGroup {
  id: BadgeGroupId
  name: string
  shape: BadgeShapeId
}

export const BADGE_MAX_LEVEL = 30

export const BADGE_FAMILIES: readonly BadgeFamily[] = [
  {
    id: 'p3v3',
    name: '3v3 Games Completed',
    short: '3V3 GP',
    glyph: 'users',
    group: 'games',
    unit: '3v3 games',
  },
  {
    id: 'p6v6',
    name: '6v6 Games Completed',
    short: '6V6 GP',
    glyph: 'hexagon',
    group: 'games',
    unit: '6v6 games',
  },
  {
    id: 'p6g',
    name: "6's with Goalie",
    short: '6S + G',
    glyph: 'shield-check',
    group: 'games',
    unit: 'games with goalie',
  },
  { id: 'pwins', name: 'Wins', short: 'WINS', glyph: 'trophy', group: 'games', unit: 'wins' },
  { id: 'pgoals', name: 'Goals', short: 'GOALS', glyph: 'siren', group: 'scoring', unit: 'goals' },
  {
    id: 'pasts',
    name: 'Assists',
    short: 'ASSISTS',
    glyph: 'apple',
    group: 'scoring',
    unit: 'assists',
  },
  {
    id: 'pshots',
    name: 'Shots',
    short: 'SHOTS',
    glyph: 'crosshair',
    group: 'scoring',
    unit: 'shots',
  },
  {
    id: 'pdekes',
    name: 'Dekes',
    short: 'DEKES',
    glyph: 'traffic-cone',
    group: 'scoring',
    unit: 'dekes',
  },
  {
    id: 'pht',
    name: 'Hat-Tricks',
    short: 'HAT TRICKS',
    glyph: 'sparkles',
    group: 'scoring',
    unit: 'hat tricks',
  },
  {
    id: 'pbrk',
    name: 'Breakaways',
    short: 'BREAKAWAYS',
    glyph: 'unlink',
    group: 'scoring',
    unit: 'breakaways',
  },
  { id: 'phits', name: 'Hits', short: 'HITS', glyph: 'hammer', group: 'physical', unit: 'hits' },
  {
    id: 'pfo',
    name: 'Faceoffs Won',
    short: 'FACEOFFS',
    glyph: 'circle-dot',
    group: 'defense',
    unit: 'faceoffs won',
  },
  {
    id: 'ptka',
    name: 'Takeaways',
    short: 'TAKEAWAYS',
    glyph: 'magnet',
    group: 'defense',
    unit: 'takeaways',
  },
  {
    id: 'pblk',
    name: 'Blocked Shots',
    short: 'BLOCKS',
    glyph: 'shield',
    group: 'defense',
    unit: 'blocked shots',
  },
  {
    id: 'pfight',
    name: 'Fights Won',
    short: 'FIGHTS',
    glyph: 'swords',
    group: 'physical',
    unit: 'fights won',
  },
  {
    id: 'gg',
    name: 'Goalie Games Completed',
    short: 'STARTS',
    glyph: 'scan-face',
    group: 'goalie',
    unit: 'goalie games',
  },
  {
    id: 'gw',
    name: 'Goalie Wins',
    short: 'G WINS',
    glyph: 'award',
    group: 'goalie',
    unit: 'goalie wins',
  },
  { id: 'gsv', name: 'Saves', short: 'SAVES', glyph: 'hand', group: 'goalie', unit: 'saves' },
  {
    id: 'gdsv',
    name: 'Desperation Saves',
    short: 'DESPERATION',
    glyph: 'heart-pulse',
    group: 'goalie',
    unit: 'desperation saves',
  },
  {
    id: 'gpoke',
    name: 'Goalie Poke-Checks',
    short: 'POKE CHECKS',
    glyph: 'sword',
    group: 'goalie',
    unit: 'poke-checks',
  },
  {
    id: 'gso',
    name: 'Shutouts',
    short: 'SHUTOUTS',
    glyph: 'brick-wall',
    group: 'goalie',
    unit: 'shutouts',
  },
]

/** Display order of the grouped badge list. Shapes per the Badge Leveling sheet. */
export const BADGE_GROUPS: readonly BadgeGroup[] = [
  { id: 'games', name: 'Games & Wins', shape: 'hex' },
  { id: 'scoring', name: 'Scoring', shape: 'round' },
  { id: 'physical', name: 'Physical', shape: 'invtri' },
  { id: 'defense', name: 'Defense & Possession', shape: 'square' },
  { id: 'goalie', name: 'Goalie', shape: 'octagon' },
]

/** Goalie-group families form the goalie tier pool; every other family is skater. */
export function poolOf(family: BadgeFamily): TierPool {
  return family.group === 'goalie' ? 'goalie' : 'skater'
}

/** Thresholds for levels 1..30. Level = number of thresholds the total meets. */
// prettier-ignore
export const BADGE_LADDERS: Readonly<Record<BadgeFamilyId, readonly number[]>> = {
  p3v3: [5, 8, 13, 20, 25, 35, 40, 45, 50, 75, 100, 130, 150, 180, 200, 230, 250, 350, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000],
  p6v6: [5, 15, 42, 120, 150, 220, 250, 280, 310, 460, 620, 770, 920, 1100, 1200, 1400, 1500, 2200, 2800, 3100, 3400, 3700, 4000, 4300, 4600, 4900, 5200, 5500, 5800, 6200],
  p6g: [1, 2, 6, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
  pwins: [5, 13, 35, 93, 120, 140, 160, 190, 210, 230, 260, 280, 300, 320, 350, 370, 390, 420, 440, 460, 510, 560, 600, 650, 700, 740, 790, 840, 880, 930],
  pgoals: [1, 4, 16, 65, 130, 260, 390, 520, 650, 780, 920, 1000, 1200, 1300, 1400, 1600, 1800, 2100, 2400, 2600, 2900, 3100, 3400, 3700, 3900, 4200, 4400, 4700, 5000, 5200],
  pasts: [1, 5, 25, 120, 250, 370, 490, 740, 990, 1200, 1500, 1700, 2000, 2200, 2500, 3000, 3500, 3900, 4400, 4900, 5400, 5900, 6400, 6900, 7400, 7900, 8400, 8900, 9400, 9900],
  pshots: [5, 23, 110, 510, 760, 1000, 1300, 1500, 2000, 2500, 3100, 3600, 4100, 4600, 5100, 6100, 7100, 8100, 9200, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000],
  pdekes: [5, 12, 30, 74, 110, 150, 190, 220, 300, 370, 450, 520, 590, 670, 740, 890, 1000, 1200, 1300, 1500, 1600, 1800, 1900, 2100, 2200, 2400, 2500, 2700, 2800, 3000],
  pht: [1, 3, 6, 16, 20, 24, 28, 33, 37, 41, 45, 49, 53, 57, 61, 81, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 310, 330, 370, 410],
  pbrk: [1, 3, 8, 23, 30, 38, 45, 53, 61, 68, 76, 83, 91, 98, 110, 120, 130, 140, 150, 160, 170, 180, 200, 210, 230, 240, 260, 270, 290, 300],
  phits: [5, 23, 110, 500, 750, 1000, 1300, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000],
  pfo: [25, 40, 63, 100, 150, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1300, 1500, 1800, 2000, 2300, 2500, 2800, 3000, 3300, 3500, 3800, 4000, 4300, 4500, 4800, 5000],
  ptka: [5, 23, 110, 510, 770, 1000, 1300, 1500, 2100, 2600, 3100, 3600, 4100, 4600, 5100, 6200, 7200, 8200, 9200, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 21000],
  pblk: [1, 6, 37, 220, 290, 370, 440, 520, 590, 660, 740, 810, 880, 960, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500],
  pfight: [1, 2, 6, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
  gg: [1, 2, 4, 8, 12, 16, 20, 23, 27, 31, 35, 39, 43, 47, 51, 55, 59, 62, 66, 78, 98, 120, 140, 160, 180, 200, 210, 230, 310, 390],
  gw: [5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 19, 21, 22, 24, 25, 27, 29, 30, 32, 35, 38, 41, 44, 48, 51, 54, 57, 60, 63],
  gsv: [15, 39, 100, 260, 350, 520, 700, 870, 1000, 1400, 1700, 2100, 2800, 3500, 4400, 5200, 6100, 7000, 7800, 8700, 9600, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000],
  gdsv: [5, 6, 7, 9, 11, 14, 16, 18, 20, 23, 25, 27, 29, 32, 34, 36, 38, 41, 43, 45, 50, 54, 59, 63, 68, 72, 77, 81, 86, 90],
  gpoke: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 34, 36, 38],
  gso: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 25, 29, 33, 38, 42, 46, 50, 54, 58, 63],
}

export const CARD_THEME_ORDER = [
  'away',
  'home',
  'alternate',
  'carbon',
  'futureB',
  'frozen',
  'futureC',
  'inferno',
  'stormLive',
  'olympus',
] as const
export type CardThemeKey = (typeof CARD_THEME_ORDER)[number]

export const MYTHIC_THEMES = ['frozen', 'futureC', 'inferno', 'stormLive', 'olympus'] as const
export type MythicThemeKey = (typeof MYTHIC_THEMES)[number]

export const CARD_THEME_NAMES: Readonly<Record<CardThemeKey, string>> = {
  away: 'Away',
  home: 'Home',
  alternate: 'Alternate',
  carbon: 'Carbon-Fiber',
  futureB: 'Hardlight',
  frozen: 'Frozen',
  futureC: 'Cyber',
  inferno: 'Inferno',
  stormLive: 'Storm',
  olympus: 'Maximus',
}

export type StatsTier = 1 | 2 | 3 | 4 | 5
export type CardTier = StatsTier | 6

export const TIER_LABELS: Readonly<Record<CardTier, string>> = {
  1: 'Prospect',
  2: 'Rookie',
  3: 'Stud',
  4: 'Elite',
  5: 'Franchise',
  6: 'Legend',
}

export const TIER_THEME: Readonly<Record<StatsTier, CardThemeKey>> = {
  1: 'away',
  2: 'home',
  3: 'alternate',
  4: 'carbon',
  5: 'futureB',
}
```

Create `packages/db/src/cards/index.ts`. It re-exports the modules Tasks 2 and 3 add, so create it now with only the catalog line, and add the other two lines in those tasks:

```ts
export * from './badge-catalog.js'
```

In `packages/db/package.json`, add the subpath export after `"./schema"`:

```json
    "./cards": "./dist/cards/index.js",
```

- [ ] **Step 6: Run the test and see it pass**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/cards/badge-catalog.test.js`
Expected: `# pass 4`, `# fail 0`

- [ ] **Step 7: Commit**

```bash
git add docs/design/handoffs/2026-10-cards packages/db/src/cards/badge-catalog.ts packages/db/src/cards/badge-catalog.test.ts packages/db/src/cards/index.ts packages/db/package.json
git commit -m "feat(db): badge catalog and re-tuned ladders for card progression

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tier, level and event rules

**Files:**

- Create: `packages/db/src/cards/progression.ts`
- Test: `packages/db/src/cards/progression.test.ts`
- Modify: `packages/db/src/cards/index.ts` (add one export line)

**Interfaces:**

- Consumes: the Task 1 catalog.
- Produces, from `@eanhl/db/cards`:
  - `type BadgeValues = Record<BadgeFamilyId, number>`
  - `emptyBadgeValues(): BadgeValues`
  - `badgeLevel(ladder, value): number`
  - `badgeLevels(values): Record<BadgeFamilyId, number>`
  - `badgeProgress(ladder, value): BadgeProgress`, where `BadgeProgress = { level, value, prevThreshold, nextThreshold: number | null, pct, remaining: number | null }`
  - `tierBar(tier)`
  - `evaluatePool(pool, values): PoolStanding`
  - `computeStanding(values): CardStanding`, where `CardStanding = { tier: CardTier; level: number; pool: TierPool | 'manual'; mythicTheme: MythicThemeKey | null }`
  - `applyStanding(prev: CardStanding | null, computed): CardStanding`
  - `type CardEventKind`, `interface CardEvent { kind; familyId: BadgeFamilyId | null; fromValue; toValue }`
  - `diffCardEvents(prev | null, next): CardEvent[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/cards/progression.test.ts`. The fixture is the live 2026-10-07 career totals, and the expected table is the spec's tier table:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyStanding,
  badgeLevel,
  badgeProgress,
  computeStanding,
  diffCardEvents,
  emptyBadgeValues,
  tierBar,
  type BadgeValues,
  type CardStanding,
} from './progression.js'
import { BADGE_LADDERS } from './badge-catalog.js'

const values = (partial: Partial<BadgeValues>): BadgeValues => ({
  ...emptyBadgeValues(),
  ...partial,
})

void test('badgeLevel counts thresholds met', () => {
  const ladder = BADGE_LADDERS.pgoals
  assert.equal(badgeLevel(ladder, 0), 0)
  assert.equal(badgeLevel(ladder, 1), 1)
  assert.equal(badgeLevel(ladder, 15), 2)
  assert.equal(badgeLevel(ladder, 16), 3)
  assert.equal(badgeLevel(ladder, 5200), 30)
  assert.equal(badgeLevel(ladder, 999999), 30)
})

void test('badgeProgress: locked, mid-level and maxed', () => {
  assert.deepEqual(badgeProgress(BADGE_LADDERS.pgoals, 0), {
    level: 0,
    value: 0,
    prevThreshold: 0,
    nextThreshold: 1,
    pct: 0,
    remaining: 1,
  })
  const mid = badgeProgress(BADGE_LADDERS.pgoals, 40)
  assert.equal(mid.level, 3)
  assert.equal(mid.prevThreshold, 16)
  assert.equal(mid.nextThreshold, 65)
  assert.equal(mid.remaining, 25)
  assert.ok(Math.abs(mid.pct - 24 / 49) < 1e-9)
  const maxed = badgeProgress(BADGE_LADDERS.pgoals, 6000)
  assert.equal(maxed.level, 30)
  assert.equal(maxed.nextThreshold, null)
  assert.equal(maxed.remaining, null)
  assert.equal(maxed.pct, 1)
})

void test('tierBar is (N-1)*5+1', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(tierBar), [1, 6, 11, 16, 21, 26])
})

void test('a player with no stats is tier 1, level 1, skater pool', () => {
  assert.deepEqual(computeStanding(emptyBadgeValues()), {
    tier: 1,
    level: 1,
    pool: 'skater',
    mythicTheme: null,
  })
})

// Career totals from the live database on 2026-10-07 (EA NHL 26+27, reviewed
// NHL 22-25 history, site-recorded mode games). The spec's tier table.
// prettier-ignore
const LIVE_2026_10_07: { gamertag: string; values: BadgeValues }[] = [
  { gamertag: 'HenryTheBobJr', values: {p3v3: 12, p6v6: 1230, p6g: 24, pwins: 348, pgoals: 898, pasts: 2466, pshots: 5087, pdekes: 743, pht: 12, pbrk: 54, phits: 5017, pfo: 0, ptka: 5130, pblk: 1095, pfight: 1, gg: 0, gw: 0, gsv: 16, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'silkyjoker85', values: {p3v3: 57, p6v6: 1596, p6g: 30, pwins: 390, pgoals: 2107, pasts: 2969, pshots: 7813, pdekes: 732, pht: 61, pbrk: 106, phits: 5743, pfo: 4559, ptka: 5562, pblk: 1032, pfight: 4, gg: 21, gw: 8, gsv: 1185, gdsv: 21, gpoke: 4, gso: 3} },
  { gamertag: 'Stick Menace', values: {p3v3: 30, p6v6: 590, p6g: 29, pwins: 359, pgoals: 1438, pasts: 993, pshots: 4792, pdekes: 1431, pht: 110, pbrk: 285, phits: 4591, pfo: 2098, ptka: 2294, pblk: 328, pfight: 81, gg: 4, gw: 3, gsv: 484, gdsv: 0, gpoke: 1, gso: 1} },
  { gamertag: 'JoeyFlopfish', values: {p3v3: 65, p6v6: 1751, p6g: 28, pwins: 339, pgoals: 1961, pasts: 2857, pshots: 7212, pdekes: 493, pht: 29, pbrk: 65, phits: 5501, pfo: 972, ptka: 6313, pblk: 1291, pfight: 0, gg: 19, gw: 11, gsv: 2092, gdsv: 15, gpoke: 0, gso: 5} },
  { gamertag: 'camrazz', values: {p3v3: 23, p6v6: 476, p6g: 24, pwins: 210, pgoals: 909, pasts: 743, pshots: 3267, pdekes: 1772, pht: 69, pbrk: 121, phits: 2479, pfo: 352, ptka: 1763, pblk: 294, pfight: 8, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'Ordinary_Samich', values: {p3v3: 4, p6v6: 112, p6g: 11, pwins: 129, pgoals: 221, pasts: 203, pshots: 850, pdekes: 401, pht: 14, pbrk: 51, phits: 724, pfo: 29, ptka: 554, pblk: 115, pfight: 5, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'SCOOT BOY 42', values: {p3v3: 0, p6v6: 4, p6g: 0, pwins: 62, pgoals: 162, pasts: 104, pshots: 958, pdekes: 421, pht: 21, pbrk: 65, phits: 838, pfo: 388, ptka: 307, pblk: 54, pfight: 2, gg: 10, gw: 7, gsv: 129, gdsv: 7, gpoke: 3, gso: 1} },
  { gamertag: 'MrHomiecide', values: {p3v3: 0, p6v6: 419, p6g: 12, pwins: 88, pgoals: 336, pasts: 524, pshots: 2325, pdekes: 235, pht: 7, pbrk: 31, phits: 2612, pfo: 918, ptka: 1352, pblk: 295, pfight: 11, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'Pratt2016', values: {p3v3: 3, p6v6: 71, p6g: 15, pwins: 36, pgoals: 9, pasts: 27, pshots: 130, pdekes: 8, pht: 0, pbrk: 1, phits: 68, pfo: 31, ptka: 76, pblk: 32, pfight: 0, gg: 39, gw: 19, gsv: 736, gdsv: 27, gpoke: 1, gso: 4} },
  { gamertag: 'joseph4577', values: {p3v3: 0, p6v6: 226, p6g: 0, pwins: 15, pgoals: 346, pasts: 217, pshots: 1351, pdekes: 21, pht: 3, pbrk: 2, phits: 1773, pfo: 8, ptka: 622, pblk: 86, pfight: 0, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },]

void test('reproduces the approved 2026-10-07 tier table', () => {
  const got = Object.fromEntries(
    LIVE_2026_10_07.map((p) => {
      const s = computeStanding(p.values)
      return [p.gamertag, `T${String(s.tier)} L${String(s.level)} ${s.pool}`]
    }),
  )
  assert.deepEqual(got, {
    HenryTheBobJr: 'T3 L9 skater',
    silkyjoker85: 'T4 L5 skater',
    'Stick Menace': 'T4 L7 skater',
    JoeyFlopfish: 'T4 L3 skater',
    camrazz: 'T3 L7 skater',
    Ordinary_Samich: 'T1 L10 skater',
    'SCOOT BOY 42': 'T1 L10 skater',
    MrHomiecide: 'T2 L8 skater',
    Pratt2016: 'T2 L8 goalie',
    joseph4577: 'T2 L2 skater',
  })
})

void test('stats alone never exceed tier 5', () => {
  const huge = values(
    Object.fromEntries(
      Object.keys(emptyBadgeValues()).map((k) => [k, 1_000_000]),
    ) as Partial<BadgeValues>,
  )
  const s = computeStanding(huge)
  assert.equal(s.tier, 5)
  assert.equal(s.level, 10)
})

const standing = (
  tier: CardStanding['tier'],
  level: number,
  pool: CardStanding['pool'] = 'skater',
): CardStanding => ({
  tier,
  level,
  pool,
  mythicTheme: pool === 'manual' ? 'inferno' : null,
})

void test('applyStanding: first computation is taken as-is', () => {
  assert.deepEqual(applyStanding(null, standing(2, 4)), standing(2, 4))
})

void test('applyStanding: never downgrades tier or level', () => {
  assert.deepEqual(applyStanding(standing(3, 6), standing(2, 9)), standing(3, 6))
  assert.deepEqual(applyStanding(standing(3, 6), standing(3, 4)), standing(3, 6))
  assert.deepEqual(applyStanding(standing(3, 6), standing(3, 8)), standing(3, 8))
  assert.deepEqual(applyStanding(standing(3, 6), standing(4, 1)), standing(4, 1))
})

void test('applyStanding: a hand-awarded mythic survives recomputes', () => {
  assert.deepEqual(
    applyStanding(standing(6, 10, 'manual'), standing(5, 10)),
    standing(6, 10, 'manual'),
  )
})

void test('diffCardEvents: first computation emits nothing', () => {
  const levels = { ...emptyBadgeValues(), pgoals: 5 }
  assert.deepEqual(diffCardEvents(null, { standing: standing(2, 3), levels }), [])
})

void test('diffCardEvents: tier up beats level up; badge rises are listed; drops are silent', () => {
  const before = { ...emptyBadgeValues(), pgoals: 5, phits: 9 }
  const after = { ...emptyBadgeValues(), pgoals: 7, phits: 8 }
  assert.deepEqual(
    diffCardEvents(
      { standing: standing(2, 9), levels: before },
      { standing: standing(3, 1), levels: after },
    ),
    [
      { kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 },
      { kind: 'badge_level_up', familyId: 'pgoals', fromValue: 5, toValue: 7 },
    ],
  )
  assert.deepEqual(
    diffCardEvents(
      { standing: standing(2, 3), levels: before },
      { standing: standing(2, 5), levels: before },
    ),
    [{ kind: 'level_up', familyId: null, fromValue: 3, toValue: 5 }],
  )
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @eanhl/db build`
Expected: FAIL. `Cannot find module './progression.js'`.

- [ ] **Step 3: Implement**

Create `packages/db/src/cards/progression.ts`:

```ts
/**
 * Pure rules for badge levels, card tier and card level.
 * Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md, Part 1.
 */
import {
  BADGE_FAMILIES,
  BADGE_LADDERS,
  BADGE_MAX_LEVEL,
  poolOf,
  type BadgeFamilyId,
  type CardTier,
  type MythicThemeKey,
  type StatsTier,
  type TierPool,
} from './badge-catalog.js'

export type BadgeValues = Record<BadgeFamilyId, number>

export function emptyBadgeValues(): BadgeValues {
  return Object.fromEntries(BADGE_FAMILIES.map((f) => [f.id, 0])) as BadgeValues
}

/** Level 0–30 = number of ladder thresholds the total meets or exceeds. */
export function badgeLevel(ladder: readonly number[], value: number): number {
  let level = 0
  for (const threshold of ladder) {
    if (value >= threshold) level++
    else break
  }
  return level
}

export function badgeLevels(values: BadgeValues): Record<BadgeFamilyId, number> {
  return Object.fromEntries(
    BADGE_FAMILIES.map((f) => [f.id, badgeLevel(BADGE_LADDERS[f.id], values[f.id])]),
  ) as Record<BadgeFamilyId, number>
}

export interface BadgeProgress {
  level: number
  value: number
  /** Threshold of the current level (0 when locked). */
  prevThreshold: number
  /** Threshold of the next level, or null when maxed. */
  nextThreshold: number | null
  /** 0–1 progress from prevThreshold to nextThreshold (1 when maxed). */
  pct: number
  /** Amount still needed for the next level, or null when maxed. */
  remaining: number | null
}

export function badgeProgress(ladder: readonly number[], value: number): BadgeProgress {
  const level = badgeLevel(ladder, value)
  const prevThreshold = level > 0 ? (ladder[level - 1] ?? 0) : 0
  const nextThreshold = level < BADGE_MAX_LEVEL ? (ladder[level] ?? null) : null
  if (nextThreshold === null) {
    return { level, value, prevThreshold, nextThreshold, pct: 1, remaining: null }
  }
  const span = nextThreshold - prevThreshold
  const pct = span > 0 ? Math.min(1, Math.max(0, (value - prevThreshold) / span)) : 0
  return { level, value, prevThreshold, nextThreshold, pct, remaining: nextThreshold - value }
}

/** Badge level a family needs to count toward tier N: (N−1)×5+1. */
export function tierBar(tier: number): number {
  return (tier - 1) * 5 + 1
}

/** Families needed at a tier's bar to reach that tier. */
export const FAMILIES_PER_TIER = 4
export const MAX_STATS_TIER: StatsTier = 5

export interface PoolStanding {
  pool: TierPool
  tier: StatsTier
  /** Average fractional progress of the best 4 families toward the next tier (0–1). */
  avgProgress: number
  level: number
}

function familyProgress(familyId: BadgeFamilyId, value: number, tier: StatsTier): number {
  const ladder = BADGE_LADDERS[familyId]
  const from = ladder[tierBar(tier) - 1] ?? 0
  const to = ladder[tierBar(tier + 1) - 1] ?? from
  if (to <= from) return 0
  return Math.min(1, Math.max(0, (value - from) / (to - from)))
}

export function evaluatePool(pool: TierPool, values: BadgeValues): PoolStanding {
  const families = BADGE_FAMILIES.filter((f) => poolOf(f) === pool)
  const levels = families.map((f) => badgeLevel(BADGE_LADDERS[f.id], values[f.id]))
  let tier: StatsTier = 1
  for (let next = 2; next <= MAX_STATS_TIER; next++) {
    const bar = tierBar(next)
    if (levels.filter((l) => l >= bar).length >= FAMILIES_PER_TIER) tier = next as StatsTier
    else break
  }
  if (tier === MAX_STATS_TIER) return { pool, tier, avgProgress: 1, level: 10 }
  const progresses = families
    .map((f) => familyProgress(f.id, values[f.id], tier))
    .sort((a, b) => b - a)
    .slice(0, FAMILIES_PER_TIER)
  const avgProgress = progresses.reduce((s, p) => s + p, 0) / FAMILIES_PER_TIER
  const level = Math.min(10, Math.max(1, 1 + Math.floor(avgProgress * 10)))
  return { pool, tier, avgProgress, level }
}

export interface CardStanding {
  tier: CardTier
  level: number
  pool: TierPool | 'manual'
  mythicTheme: MythicThemeKey | null
}

/** Stats-only standing: the better of the skater and goalie pools (tie → higher progress). */
export function computeStanding(values: BadgeValues): CardStanding {
  const skater = evaluatePool('skater', values)
  const goalie = evaluatePool('goalie', values)
  const best =
    goalie.tier > skater.tier ||
    (goalie.tier === skater.tier && goalie.avgProgress > skater.avgProgress)
      ? goalie
      : skater
  return { tier: best.tier, level: best.level, pool: best.pool, mythicTheme: null }
}

/**
 * Never-downgrade merge of a freshly computed standing onto the stored one.
 * A manual (tier 6) standing is only changed by the card-mythic CLI.
 */
export function applyStanding(prev: CardStanding | null, computed: CardStanding): CardStanding {
  if (prev === null) return computed
  if (prev.pool === 'manual') return prev
  if (computed.tier > prev.tier) return computed
  if (computed.tier < prev.tier) return prev
  return { ...computed, level: Math.max(prev.level, computed.level) }
}

export type CardEventKind =
  | 'tier_up'
  | 'level_up'
  | 'badge_level_up'
  | 'mythic_awarded'
  | 'mythic_cleared'

export interface CardEvent {
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
}

/**
 * Events for one player's recompute. The first computation for a player
 * (prev === null) emits nothing, so the backfill does not invent history.
 */
export function diffCardEvents(
  prev: { standing: CardStanding; levels: Partial<Record<BadgeFamilyId, number>> } | null,
  next: { standing: CardStanding; levels: Record<BadgeFamilyId, number> },
): CardEvent[] {
  if (prev === null) return []
  const events: CardEvent[] = []
  if (next.standing.tier > prev.standing.tier) {
    events.push({
      kind: 'tier_up',
      familyId: null,
      fromValue: prev.standing.tier,
      toValue: next.standing.tier,
    })
  } else if (
    next.standing.tier === prev.standing.tier &&
    next.standing.level > prev.standing.level
  ) {
    events.push({
      kind: 'level_up',
      familyId: null,
      fromValue: prev.standing.level,
      toValue: next.standing.level,
    })
  }
  for (const f of BADGE_FAMILIES) {
    const before = prev.levels[f.id] ?? 0
    const after = next.levels[f.id]
    if (after > before)
      events.push({ kind: 'badge_level_up', familyId: f.id, fromValue: before, toValue: after })
  }
  return events
}
```

Add to `packages/db/src/cards/index.ts`:

```ts
export * from './progression.js'
```

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/cards/progression.test.js`
Expected: `# pass 11`, `# fail 0`. The "reproduces the approved 2026-10-07 tier table" test must pass. If it doesn't, stop: the rules disagree with what the operator approved.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/cards/progression.ts packages/db/src/cards/progression.test.ts packages/db/src/cards/index.ts
git commit -m "feat(db): card tier, level and event rules (never-downgrade, mythic-safe)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Career totals merge

**Files:**

- Create: `packages/db/src/cards/career-totals.ts`
- Test: `packages/db/src/cards/career-totals.test.ts`
- Modify: `packages/db/src/cards/index.ts` (add one export line)

**Interfaces:**

- Consumes: `emptyBadgeValues`, `BadgeValues` (Task 2).
- Produces, from `@eanhl/db/cards`:
  - row types: `EaTitleTotals`, `HistoryTitleTotals`, `RecordedModeGames { playerId; gameMode; gamesPlayed }`, `RecordedSixesWithGoalie { playerId; games }`
  - `CareerTotalsInput { ea; history; recordedModes; recordedSixesWithGoalie }`
  - `mergeCareerTotals(input): Map<number, BadgeValues>`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/cards/career-totals.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCareerTotals, type EaTitleTotals, type HistoryTitleTotals } from './career-totals.js'
import { emptyBadgeValues } from './progression.js'

const ea = (
  playerId: number,
  gameTitleId: number,
  partial: Partial<EaTitleTotals> = {},
): EaTitleTotals => ({
  playerId,
  gameTitleId,
  skaterWins: 0,
  goalieWins: 0,
  goals: 0,
  assists: 0,
  shots: 0,
  dekes: 0,
  hatTricks: 0,
  breakaways: 0,
  hits: 0,
  faceoffWins: 0,
  takeaways: 0,
  blockedShots: 0,
  fightsWon: 0,
  goalieGamesCompleted: 0,
  goalieSaves: 0,
  goalieDesperationSaves: 0,
  goaliePokeChecks: 0,
  goalieShutouts: 0,
  ...partial,
})

const hist = (
  playerId: number,
  gameTitleId: number,
  partial: Partial<HistoryTitleTotals> = {},
): HistoryTitleTotals => ({
  playerId,
  gameTitleId,
  gameMode: '6s',
  gamesPlayed: 0,
  wins: 0,
  goals: 0,
  assists: 0,
  shots: 0,
  hits: 0,
  takeaways: 0,
  blockedShots: 0,
  saves: 0,
  shutouts: 0,
  ...partial,
})

const none = { ea: [], history: [], recordedModes: [], recordedSixesWithGoalie: [] }

void test('EA columns map to their families; wins count skater + goalie wins', () => {
  const m = mergeCareerTotals({
    ...none,
    ea: [
      ea(1, 26, {
        skaterWins: 10,
        goalieWins: 2,
        goals: 3,
        assists: 4,
        shots: 5,
        dekes: 6,
        hatTricks: 7,
        breakaways: 8,
        hits: 9,
        faceoffWins: 11,
        takeaways: 12,
        blockedShots: 13,
        fightsWon: 14,
        goalieGamesCompleted: 15,
        goalieSaves: 16,
        goalieDesperationSaves: 17,
        goaliePokeChecks: 18,
        goalieShutouts: 19,
      }),
    ],
  })
  assert.deepEqual(m.get(1), {
    ...emptyBadgeValues(),
    pwins: 12,
    pgoals: 3,
    pasts: 4,
    pshots: 5,
    pdekes: 6,
    pht: 7,
    pbrk: 8,
    phits: 9,
    pfo: 11,
    ptka: 12,
    pblk: 13,
    pfight: 14,
    gg: 15,
    gw: 2,
    gsv: 16,
    gdsv: 17,
    gpoke: 18,
    gso: 19,
  })
})

void test('titles add up across EA and history; only 6s history games count toward 6v6', () => {
  const m = mergeCareerTotals({
    ...none,
    ea: [ea(1, 26, { goals: 10 }), ea(1, 27, { goals: 5 })],
    history: [
      hist(1, 25, { gameMode: '6s', gamesPlayed: 40, goals: 20, saves: 7, shutouts: 1 }),
      hist(1, 24, { gameMode: '3s', gamesPlayed: 9, goals: 2 }),
    ],
  })
  const v = m.get(1)
  assert.ok(v)
  assert.equal(v.pgoals, 37)
  assert.equal(v.p6v6, 40)
  assert.equal(v.p3v3, 0)
  assert.equal(v.gsv, 7)
  assert.equal(v.gso, 1)
})

void test('one source per title: history for a title EA already covers is ignored', () => {
  const m = mergeCareerTotals({
    ...none,
    ea: [ea(1, 26, { goals: 100 })],
    history: [hist(1, 26, { goals: 999, gamesPlayed: 50 }), hist(2, 26, { goals: 8 })],
  })
  assert.equal(m.get(1)?.pgoals, 100)
  assert.equal(m.get(1)?.p6v6, 0)
  assert.equal(m.get(2)?.pgoals, 8)
})

void test('site-recorded mode games and 6s-with-goalie games', () => {
  const m = mergeCareerTotals({
    ...none,
    history: [hist(1, 25, { gameMode: '6s', gamesPlayed: 100 })],
    recordedModes: [
      { playerId: 1, gameMode: '3s', gamesPlayed: 12 },
      { playerId: 1, gameMode: '6s', gamesPlayed: 30 },
    ],
    recordedSixesWithGoalie: [{ playerId: 1, games: 9 }],
  })
  const v = m.get(1)
  assert.ok(v)
  assert.equal(v.p3v3, 12)
  assert.equal(v.p6v6, 130)
  assert.equal(v.p6g, 9)
})

void test('a player seen only in recorded games gets a full zeroed record', () => {
  const m = mergeCareerTotals({ ...none, recordedSixesWithGoalie: [{ playerId: 7, games: 1 }] })
  assert.deepEqual(m.get(7), { ...emptyBadgeValues(), p6g: 1 })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @eanhl/db build`
Expected: FAIL. `Cannot find module './career-totals.js'`.

- [ ] **Step 3: Implement**

Create `packages/db/src/cards/career-totals.ts`:

```ts
/**
 * Merges the badge inputs into one career total per player and family.
 *
 * Sources (spec Part 1): EA season totals per title, reviewed NHL 22–25
 * history per title, site-recorded games per mode, and site-recorded 6s games
 * with a BGM goalie. One source per (player, title): when EA has a row for a
 * title, that title's history rows are ignored, so nothing is counted twice.
 */
import { emptyBadgeValues, type BadgeValues } from './progression.js'

export interface EaTitleTotals {
  playerId: number
  gameTitleId: number
  skaterWins: number
  goalieWins: number
  goals: number
  assists: number
  shots: number
  dekes: number
  hatTricks: number
  breakaways: number
  hits: number
  faceoffWins: number
  takeaways: number
  blockedShots: number
  fightsWon: number
  goalieGamesCompleted: number
  goalieSaves: number
  goalieDesperationSaves: number
  goaliePokeChecks: number
  goalieShutouts: number
}

export interface HistoryTitleTotals {
  playerId: number
  gameTitleId: number
  gameMode: string
  gamesPlayed: number
  wins: number
  goals: number
  assists: number
  shots: number
  hits: number
  takeaways: number
  blockedShots: number
  saves: number
  shutouts: number
}

export interface RecordedModeGames {
  playerId: number
  gameMode: string
  gamesPlayed: number
}

export interface RecordedSixesWithGoalie {
  playerId: number
  games: number
}

export interface CareerTotalsInput {
  ea: readonly EaTitleTotals[]
  history: readonly HistoryTitleTotals[]
  recordedModes: readonly RecordedModeGames[]
  recordedSixesWithGoalie: readonly RecordedSixesWithGoalie[]
}

export function mergeCareerTotals(input: CareerTotalsInput): Map<number, BadgeValues> {
  const out = new Map<number, BadgeValues>()
  const totalsFor = (playerId: number): BadgeValues => {
    let v = out.get(playerId)
    if (v === undefined) {
      v = emptyBadgeValues()
      out.set(playerId, v)
    }
    return v
  }

  const eaTitles = new Set<string>()
  for (const r of input.ea) {
    eaTitles.add(`${String(r.playerId)}:${String(r.gameTitleId)}`)
    const v = totalsFor(r.playerId)
    v.pwins += r.skaterWins + r.goalieWins
    v.pgoals += r.goals
    v.pasts += r.assists
    v.pshots += r.shots
    v.pdekes += r.dekes
    v.pht += r.hatTricks
    v.pbrk += r.breakaways
    v.phits += r.hits
    v.pfo += r.faceoffWins
    v.ptka += r.takeaways
    v.pblk += r.blockedShots
    v.pfight += r.fightsWon
    v.gg += r.goalieGamesCompleted
    v.gw += r.goalieWins
    v.gsv += r.goalieSaves
    v.gdsv += r.goalieDesperationSaves
    v.gpoke += r.goaliePokeChecks
    v.gso += r.goalieShutouts
  }

  for (const r of input.history) {
    if (eaTitles.has(`${String(r.playerId)}:${String(r.gameTitleId)}`)) continue
    const v = totalsFor(r.playerId)
    if (r.gameMode === '6s') v.p6v6 += r.gamesPlayed
    v.pwins += r.wins
    v.pgoals += r.goals
    v.pasts += r.assists
    v.pshots += r.shots
    v.phits += r.hits
    v.ptka += r.takeaways
    v.pblk += r.blockedShots
    v.gsv += r.saves
    v.gso += r.shutouts
  }

  for (const r of input.recordedModes) {
    const v = totalsFor(r.playerId)
    if (r.gameMode === '3s') v.p3v3 += r.gamesPlayed
    else if (r.gameMode === '6s') v.p6v6 += r.gamesPlayed
  }

  for (const r of input.recordedSixesWithGoalie) {
    totalsFor(r.playerId).p6g += r.games
  }

  return out
}
```

Add to `packages/db/src/cards/index.ts`:

```ts
export * from './career-totals.js'
```

- [ ] **Step 4: Run all card tests and see them pass**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/cards/*.test.js`
Expected: `# pass 20`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/cards/career-totals.ts packages/db/src/cards/career-totals.test.ts packages/db/src/cards/index.ts
git commit -m "feat(db): merge EA, history and recorded totals into badge career values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Preview database, migration 0060, Drizzle schema

**Files:**

- Create: `packages/db/migrations/0060_player_card_progression.sql`
- Create: `packages/db/src/schema/player-card-progression.ts`
- Modify: `packages/db/src/schema/index.ts` (add one export line)

**Interfaces:**

- Consumes: `BadgeFamilyId`, `CardTier`, `MythicThemeKey`, `TierPool`, `CardEventKind` (Tasks 1–2).
- Produces, from `@eanhl/db`: the tables `playerBadgeLevels`, `playerCardProgress` and `playerCardEvents`.
  - `playerBadgeLevels`: `playerId`, `familyId: BadgeFamilyId`, `value`, `level`, `computedAt`
  - `playerCardProgress`: `playerId`, `tier: CardTier`, `level`, `tierPool: TierPool | 'manual'`, `mythicTheme: MythicThemeKey | null`, `computedAt`, `updatedAt`
  - `playerCardEvents`: `id`, `playerId`, `kind: CardEventKind`, `familyId: BadgeFamilyId | null`, `fromValue`, `toValue`, `occurredAt`

- [ ] **Step 1: Restore last night's live backup into a separate local database `eanhl_preview`**

```bash
cd /home/michal/projects/eanhl-team-website
DUMP=$(ssh hotel-echo 'ls -1t ~/eanhl-backups/daily/*.dump | head -1')
echo "$DUMP"                       # e.g. /home/utiz/eanhl-backups/daily/eanhl-2026-10-07.dump
mkdir -p ~/eanhl-preview && scp "hotel-echo:$DUMP" ~/eanhl-preview/latest.dump
docker exec eanhl-team-website-db-1 dropdb -U eanhl --if-exists eanhl_preview
docker exec eanhl-team-website-db-1 createdb -U eanhl eanhl_preview
docker exec -i eanhl-team-website-db-1 pg_restore -U eanhl -d eanhl_preview --no-owner --no-privileges < ~/eanhl-preview/latest.dump
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -Atc "SELECT current_database(), (SELECT count(*) FROM matches), (SELECT count(*) FROM ea_member_season_stats)"
```

Expected: `eanhl_preview|<n>|18`, with `<n>` roughly the live match count after the quarantine (the record strip read 621 GP on 2026-10-06). `pg_restore` warnings about roles are fine; errors about missing tables are not. `dropdb` targets only `eanhl_preview`; never drop `eanhl`.

- [ ] **Step 2: Write the migration**

Create `packages/db/migrations/0060_player_card_progression.sql`:

```sql
-- Migration: player-card progression — badge levels, card standing, card history
-- Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md (Part 1).
--
-- Derived data, recomputed by the worker (`card-recompute`) from EA season totals,
-- reviewed NHL 22-25 history and site-recorded matches. Everything here can be
-- rebuilt EXCEPT hand-awarded mythics (tier_pool = 'manual', set by `card-mythic`)
-- and the event history in player_card_events.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0059):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0060_player_card_progression.sql
-- Test run: <database> = eanhl_preview. Live (Hotel-Echo) only at the switch, after a fresh backup.
-- Idempotent.
-- ROLLBACK: DROP TABLE IF EXISTS "player_card_events", "player_card_progress", "player_badge_levels";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "player_badge_levels" (
  "player_id"   integer NOT NULL REFERENCES "players" ("id") ON DELETE CASCADE,
  "family_id"   text NOT NULL,
  "value"       integer NOT NULL,
  "level"       smallint NOT NULL,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_badge_levels_pk" PRIMARY KEY ("player_id", "family_id"),
  CONSTRAINT "player_badge_levels_family_check" CHECK ("family_id" IN (
    'p3v3', 'p6v6', 'p6g', 'pwins', 'pgoals', 'pasts', 'pshots', 'pdekes', 'pht', 'pbrk',
    'phits', 'pfo', 'ptka', 'pblk', 'pfight', 'gg', 'gw', 'gsv', 'gdsv', 'gpoke', 'gso')),
  CONSTRAINT "player_badge_levels_level_check" CHECK ("level" BETWEEN 0 AND 30),
  CONSTRAINT "player_badge_levels_value_check" CHECK ("value" >= 0)
);

CREATE TABLE IF NOT EXISTS "player_card_progress" (
  "player_id"    integer PRIMARY KEY REFERENCES "players" ("id") ON DELETE CASCADE,
  "tier"         smallint NOT NULL,
  "level"        smallint NOT NULL,
  "tier_pool"    text NOT NULL,
  "mythic_theme" text,
  "computed_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_card_progress_tier_check" CHECK ("tier" BETWEEN 1 AND 6),
  CONSTRAINT "player_card_progress_level_check" CHECK ("level" BETWEEN 1 AND 10),
  CONSTRAINT "player_card_progress_pool_check" CHECK ("tier_pool" IN ('skater', 'goalie', 'manual')),
  CONSTRAINT "player_card_progress_mythic_check" CHECK (
    "mythic_theme" IS NULL OR "mythic_theme" IN ('frozen', 'futureC', 'inferno', 'stormLive', 'olympus')),
  CONSTRAINT "player_card_progress_manual_check" CHECK (
    ("tier" = 6) = ("tier_pool" = 'manual') AND ("tier_pool" = 'manual') = ("mythic_theme" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "player_card_events" (
  "id"          bigserial PRIMARY KEY,
  "player_id"   integer NOT NULL REFERENCES "players" ("id") ON DELETE CASCADE,
  "kind"        text NOT NULL,
  "family_id"   text,
  "from_value"  smallint NOT NULL,
  "to_value"    smallint NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_card_events_kind_check" CHECK ("kind" IN
    ('tier_up', 'level_up', 'badge_level_up', 'mythic_awarded', 'mythic_cleared')),
  CONSTRAINT "player_card_events_family_check" CHECK (("kind" = 'badge_level_up') = ("family_id" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "player_card_events_player_idx"
  ON "player_card_events" ("player_id", "occurred_at" DESC);

COMMIT;

SELECT 'player_badge_levels' AS "table", count(*) AS "rows" FROM "player_badge_levels"
UNION ALL SELECT 'player_card_progress', count(*) FROM "player_card_progress"
UNION ALL SELECT 'player_card_events', count(*) FROM "player_card_events";
```

- [ ] **Step 3: Apply it to `eanhl_preview`, twice (the second run proves it is idempotent)**

```bash
for i in 1 2; do
docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
  eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -v ON_ERROR_STOP=1 -f - \
  < packages/db/migrations/0060_player_card_progression.sql
done
```

Expected: both runs end with three `| 0` rows. The second run prints no errors; it may print `NOTICE: relation ... already exists, skipping`.

- [ ] **Step 4: Write the Drizzle schema mirror**

Create `packages/db/src/schema/player-card-progression.ts`:

```ts
import {
  bigserial,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { players } from './players.js'
import type { BadgeFamilyId, CardTier, MythicThemeKey, TierPool } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

/**
 * Player-card progression (migration 0060, hand-applied). Derived by the worker's
 * `card-recompute`; spec docs/superpowers/specs/2026-10-07-player-cards-badges-design.md.
 * CHECK constraints live in the SQL migration, not here.
 */
export const playerBadgeLevels = pgTable(
  'player_badge_levels',
  {
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    familyId: text('family_id').notNull().$type<BadgeFamilyId>(),
    value: integer('value').notNull(),
    level: smallint('level').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'player_badge_levels_pk', columns: [table.playerId, table.familyId] }),
  ],
)

export const playerCardProgress = pgTable('player_card_progress', {
  playerId: integer('player_id')
    .primaryKey()
    .references(() => players.id, { onDelete: 'cascade' }),
  tier: smallint('tier').notNull().$type<CardTier>(),
  level: smallint('level').notNull(),
  tierPool: text('tier_pool').notNull().$type<TierPool | 'manual'>(),
  mythicTheme: text('mythic_theme').$type<MythicThemeKey>(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const playerCardEvents = pgTable(
  'player_card_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<CardEventKind>(),
    familyId: text('family_id').$type<BadgeFamilyId>(),
    fromValue: smallint('from_value').notNull(),
    toValue: smallint('to_value').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('player_card_events_player_idx').on(table.playerId, table.occurredAt.desc())],
)
```

Add to the end of `packages/db/src/schema/index.ts`:

```ts
export * from './player-card-progression.js'
```

- [ ] **Step 5: Build and typecheck**

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/db typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0060_player_card_progression.sql packages/db/src/schema/player-card-progression.ts packages/db/src/schema/index.ts
git commit -m "feat(db): migration 0060 player card progression tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Worker recompute and the `card-recompute` CLI

**Files:**

- Create: `apps/worker/src/card-progression.ts`
- Create: `apps/worker/src/card-recompute-cli.ts`
- Modify: `apps/worker/package.json` (scripts)
- Modify: `apps/worker/src/ingest.ts:53-110` (`runIngestionCycle`)

**Interfaces:**

- Consumes: `mergeCareerTotals`, `badgeLevels`, `computeStanding`, `applyStanding`, `diffCardEvents`, `BADGE_FAMILIES` and their types (`@eanhl/db/cards`); the tables from Task 4 (`@eanhl/db`).
- Produces:
  - `loadCareerTotalsInput(): Promise<CareerTotalsInput>`
  - `recomputeCardProgression(opts: { dryRun: boolean }): Promise<RecomputeResult[]>`, where `RecomputeResult = { playerId: number; gamertag: string; standing: CardStanding; events: number; firstRun: boolean }`
  - `currentDatabase(): Promise<string>`

- [ ] **Step 1: Write the module**

Create `apps/worker/src/card-progression.ts`:

```ts
/**
 * Card progression recompute: loads every player's badge inputs, applies the
 * shared rules from @eanhl/db/cards, and writes badge levels, card standing and
 * card events (migration 0060) in one transaction.
 * Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md, Part 1.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db, playerBadgeLevels, playerCardEvents, playerCardProgress } from '@eanhl/db'
import {
  BADGE_FAMILIES,
  applyStanding,
  badgeLevels,
  computeStanding,
  diffCardEvents,
  mergeCareerTotals,
  type BadgeFamilyId,
  type CardStanding,
  type CareerTotalsInput,
  type EaTitleTotals,
  type HistoryTitleTotals,
  type RecordedModeGames,
  type RecordedSixesWithGoalie,
} from '@eanhl/db/cards'

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[]
}

export async function currentDatabase(): Promise<string> {
  const [row] = await rows<{ name: string }>(sql`SELECT current_database() AS name`)
  return row?.name ?? '?'
}

export async function loadCareerTotalsInput(): Promise<CareerTotalsInput> {
  const [ea, history, recordedModes, recordedSixesWithGoalie] = await Promise.all([
    rows<EaTitleTotals>(sql`
      SELECT player_id AS "playerId", game_title_id AS "gameTitleId",
        COALESCE(skater_wins, 0) AS "skaterWins", COALESCE(goalie_wins, 0) AS "goalieWins",
        COALESCE(goals, 0) AS "goals", COALESCE(assists, 0) AS "assists", COALESCE(shots, 0) AS "shots",
        COALESCE(dekes, 0) AS "dekes", COALESCE(hat_tricks, 0) AS "hatTricks",
        COALESCE(breakaways, 0) AS "breakaways", COALESCE(hits, 0) AS "hits",
        COALESCE(faceoff_wins, 0) AS "faceoffWins", COALESCE(takeaways, 0) AS "takeaways",
        COALESCE(blocked_shots, 0) AS "blockedShots", COALESCE(fights_won, 0) AS "fightsWon",
        COALESCE(goalie_games_completed, 0) AS "goalieGamesCompleted",
        COALESCE(goalie_saves, 0) AS "goalieSaves",
        COALESCE(goalie_desperation_saves, 0) AS "goalieDesperationSaves",
        COALESCE(goalie_poke_checks, 0) AS "goaliePokeChecks",
        COALESCE(goalie_shutouts, 0) AS "goalieShutouts"
      FROM ea_member_season_stats`),
    rows<HistoryTitleTotals>(sql`
      SELECT player_id AS "playerId", game_title_id AS "gameTitleId", game_mode AS "gameMode",
        (COALESCE(skater_gp, 0) + COALESCE(goalie_gp, 0))::int AS "gamesPlayed",
        COALESCE(wins, 0) AS "wins", COALESCE(goals, 0) AS "goals", COALESCE(assists, 0) AS "assists",
        COALESCE(shots, 0) AS "shots", COALESCE(hits, 0) AS "hits", COALESCE(takeaways, 0) AS "takeaways",
        COALESCE(blocked_shots, 0) AS "blockedShots", COALESCE(total_saves, 0) AS "saves",
        COALESCE(shutouts, 0) AS "shutouts"
      FROM historical_club_member_season_stats
      WHERE player_id IS NOT NULL AND review_status = 'reviewed'`),
    rows<RecordedModeGames>(sql`
      SELECT player_id AS "playerId", game_mode AS "gameMode", SUM(games_played)::int AS "gamesPlayed"
      FROM player_game_title_stats
      WHERE game_mode IN ('3s', '6s')
      GROUP BY player_id, game_mode`),
    rows<RecordedSixesWithGoalie>(sql`
      SELECT p.player_id AS "playerId", COUNT(DISTINCT p.match_id)::int AS "games"
      FROM player_match_stats p
      JOIN matches m ON m.id = p.match_id
      WHERE m.game_mode = '6s'
        AND EXISTS (SELECT 1 FROM player_match_stats g WHERE g.match_id = p.match_id AND g.is_goalie)
      GROUP BY p.player_id`),
  ])
  return { ea, history, recordedModes, recordedSixesWithGoalie }
}

export interface RecomputeResult {
  playerId: number
  gamertag: string
  standing: CardStanding
  events: number
  firstRun: boolean
}

export async function recomputeCardProgression(opts: {
  dryRun: boolean
}): Promise<RecomputeResult[]> {
  const totals = mergeCareerTotals(await loadCareerTotalsInput())
  const [storedProgress, storedLevels, names] = await Promise.all([
    db.select().from(playerCardProgress),
    db.select().from(playerBadgeLevels),
    rows<{ id: number; gamertag: string }>(sql`SELECT id, gamertag FROM players`),
  ])

  const prevStanding = new Map<number, CardStanding>(
    storedProgress.map((r) => [
      r.playerId,
      { tier: r.tier, level: r.level, pool: r.tierPool, mythicTheme: r.mythicTheme ?? null },
    ]),
  )
  const prevLevels = new Map<number, Partial<Record<BadgeFamilyId, number>>>()
  for (const r of storedLevels) {
    const levels = prevLevels.get(r.playerId) ?? {}
    levels[r.familyId] = r.level
    prevLevels.set(r.playerId, levels)
  }
  const gamertags = new Map(names.map((n) => [n.id, n.gamertag]))

  const now = new Date()
  const results: RecomputeResult[] = []
  const levelRows: (typeof playerBadgeLevels.$inferInsert)[] = []
  const progressRows: (typeof playerCardProgress.$inferInsert)[] = []
  const eventRows: (typeof playerCardEvents.$inferInsert)[] = []

  for (const [playerId, values] of totals) {
    const levels = badgeLevels(values)
    const prev = prevStanding.get(playerId) ?? null
    const standing = applyStanding(prev, computeStanding(values))
    const events = diffCardEvents(
      prev === null ? null : { standing: prev, levels: prevLevels.get(playerId) ?? {} },
      { standing, levels },
    )
    for (const f of BADGE_FAMILIES) {
      levelRows.push({
        playerId,
        familyId: f.id,
        value: values[f.id],
        level: levels[f.id],
        computedAt: now,
      })
    }
    progressRows.push({
      playerId,
      tier: standing.tier,
      level: standing.level,
      tierPool: standing.pool,
      mythicTheme: standing.mythicTheme,
      computedAt: now,
      updatedAt: now,
    })
    for (const e of events) eventRows.push({ playerId, ...e, occurredAt: now })
    results.push({
      playerId,
      gamertag: gamertags.get(playerId) ?? `#${String(playerId)}`,
      standing,
      events: events.length,
      firstRun: prev === null,
    })
  }

  if (!opts.dryRun) {
    await db.transaction(async (tx) => {
      if (levelRows.length > 0) {
        await tx
          .insert(playerBadgeLevels)
          .values(levelRows)
          .onConflictDoUpdate({
            target: [playerBadgeLevels.playerId, playerBadgeLevels.familyId],
            set: {
              value: sql`excluded.value`,
              level: sql`excluded.level`,
              computedAt: sql`excluded.computed_at`,
            },
          })
      }
      if (progressRows.length > 0) {
        await tx
          .insert(playerCardProgress)
          .values(progressRows)
          .onConflictDoUpdate({
            target: playerCardProgress.playerId,
            set: {
              tier: sql`excluded.tier`,
              level: sql`excluded.level`,
              tierPool: sql`excluded.tier_pool`,
              mythicTheme: sql`excluded.mythic_theme`,
              computedAt: sql`excluded.computed_at`,
              updatedAt: sql`excluded.updated_at`,
            },
            // A mythic awarded by `card-mythic` after this run read the table must survive.
            setWhere: sql`"player_card_progress"."tier_pool" <> 'manual'`,
          })
      }
      if (eventRows.length > 0) await tx.insert(playerCardEvents).values(eventRows)
    })
  }

  return results
}
```

- [ ] **Step 2: Write the CLI**

Create `apps/worker/src/card-recompute-cli.ts`:

```ts
/**
 * pnpm --filter @eanhl/worker card-recompute [--dry-run]
 *
 * Recomputes badge levels, card tier/level and card events for every player
 * (spec docs/superpowers/specs/2026-10-07-player-cards-badges-design.md, Part 1)
 * and prints the standing table. --dry-run computes and prints without writing.
 * Prints the connected database first — check it before trusting a write.
 */
import { sql as dbSql } from '@eanhl/db'
import { TIER_LABELS } from '@eanhl/db/cards'
import { currentDatabase, recomputeCardProgression } from './card-progression.js'

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run')
  const database = await currentDatabase()
  console.log(
    `[card-recompute] database=${database} mode=${dryRun ? 'dry-run (no writes)' : 'write'}`,
  )

  const results = await recomputeCardProgression({ dryRun })
  const notable = results
    .filter((r) => r.standing.tier > 1 || r.standing.level > 1)
    .sort(
      (a, b) =>
        b.standing.tier - a.standing.tier ||
        b.standing.level - a.standing.level ||
        a.gamertag.localeCompare(b.gamertag),
    )
  for (const r of notable) {
    const s = r.standing
    const events = r.firstRun ? 'first run' : `${String(r.events)} events`
    console.log(
      `  T${String(s.tier)} ${TIER_LABELS[s.tier].padEnd(9)} L${String(s.level).padEnd(3)} ${s.pool.padEnd(7)} ${r.gamertag.padEnd(18)} ${events}`,
    )
  }
  const events = results.reduce((sum, r) => sum + r.events, 0)
  console.log(
    `[card-recompute] players=${String(results.length)} shown=${String(notable.length)} (others T1 L1) events=${String(events)}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`card-recompute: ${msg}\n`)
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
```

In `apps/worker/package.json` `scripts`, add after `"run-quality"`:

```json
    "card-recompute": "node dist/card-recompute-cli.js",
```

- [ ] **Step 3: Hook it into the ingestion cycle**

In `apps/worker/src/ingest.ts`, add the import next to `import { recomputeAggregates } from './aggregate.js'`:

```ts
import { recomputeCardProgression } from './card-progression.js'
```

At the end of `runIngestionCycle()`, after the closing `}` of `for (const title of activeGameTitles) { ... }` and before the function's closing `}`, add:

```ts
// Card progression (badge levels, tier, level) reads EA totals, history and
// recorded matches across all titles, so it runs once per cycle, after them.
// Non-fatal: never blocks match ingestion. Needs migration 0060 applied first.
try {
  const results = await recomputeCardProgression({ dryRun: false })
  console.log(`[ingest] Card progression recomputed for ${String(results.length)} players`)
} catch (err) {
  console.error('[ingest] Card progression recompute failed:', err)
}
```

- [ ] **Step 4: Build and typecheck**

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && pnpm --filter @eanhl/worker typecheck`
Expected: exit 0.

- [ ] **Step 5: Dry run against `eanhl_preview` and check it reproduces the spec's tier table**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's#/eanhl$#/eanhl_preview#')"
case "$DATABASE_URL" in */eanhl_preview) echo OK ;; *) echo "WRONG DATABASE — stop"; exit 1 ;; esac
pnpm --filter @eanhl/worker card-recompute --dry-run
```

Expected: the first line is `database=eanhl_preview mode=dry-run (no writes)`, and every row says `first run`. These rows match the spec exactly:

```
T4 Elite     L7  skater  Stick Menace       first run
T4 Elite     L5  skater  silkyjoker85       first run
T4 Elite     L3  skater  JoeyFlopfish       first run
T3 Stud      L9  skater  HenryTheBobJr      first run
T3 Stud      L7  skater  camrazz            first run
T2 Rookie    L8  skater  MrHomiecide        first run
T2 Rookie    L8  goalie  Pratt2016          first run
T2 Rookie    L2  skater  joseph4577         first run
T1 Prospect  L10 skater  Ordinary_Samich    first run
T1 Prospect  L10 skater  SCOOT BOY 42       first run
```

Data newer than 2026-10-07 may move a level by one or two. That's fine. Extra rows at **T1** with L2+ are also fine; members with only NHL 22–25 history show up there. **Any tier that differs, or any extra non-member at T2+**, means stop and investigate before writing. Check the club's NHL 26 EA rows first; this covers the spec's open item.

- [ ] **Step 6: Write, then rerun to prove it is idempotent**

```bash
pnpm --filter @eanhl/worker card-recompute
pnpm --filter @eanhl/worker card-recompute
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -Atc \
  "SELECT (SELECT count(*) FROM player_card_progress), (SELECT count(*) FROM player_badge_levels), (SELECT count(*) FROM player_card_events)"
```

Expected:

- The first run lists `first run`.
- The second run lists `0 events` for everyone, with `events=0`.
- The query prints `<P>|<P×21>|0`: every player has 21 badge rows, and there are no events.

- [ ] **Step 7: Lint the new files and commit**

```bash
pnpm --filter @eanhl/worker exec eslint src/card-progression.ts src/card-recompute-cli.ts src/ingest.ts
git add apps/worker/src/card-progression.ts apps/worker/src/card-recompute-cli.ts apps/worker/src/ingest.ts apps/worker/package.json
git commit -m "feat(worker): recompute card progression each cycle + card-recompute CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `card-mythic` CLI

**Files:**

- Create: `apps/worker/src/lib/card-mythic-args.ts`
- Test: `apps/worker/src/lib/card-mythic-args.test.ts`
- Create: `apps/worker/src/card-mythic-cli.ts`
- Modify: `apps/worker/package.json` (scripts)

**Interfaces:**

- Consumes: `MYTHIC_THEMES`, `MythicThemeKey`, `computeStanding`, `emptyBadgeValues`, `mergeCareerTotals` (`@eanhl/db/cards`); `loadCareerTotalsInput`, `currentDatabase` (Task 5).
- Produces:
  - `parseMythicArgs(argv: readonly string[]): MythicCommand`, where `MythicCommand = { player: string; action: 'award'; theme: MythicThemeKey } | { player: string; action: 'clear' }`. It throws `Error` with the usage text.
  - the CLI `pnpm --filter @eanhl/worker card-mythic --player "<gamertag>" (--theme <key> | --clear)`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/lib/card-mythic-args.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMythicArgs } from './card-mythic-args.js'

void test('award with a theme', () => {
  assert.deepEqual(parseMythicArgs(['--player', 'Stick Menace', '--theme', 'inferno']), {
    player: 'Stick Menace',
    action: 'award',
    theme: 'inferno',
  })
})

void test('clear', () => {
  assert.deepEqual(parseMythicArgs(['--player', 'Stick Menace', '--clear']), {
    player: 'Stick Menace',
    action: 'clear',
  })
})

void test('rejects a missing player, an unknown theme, and both or neither actions', () => {
  assert.throws(() => parseMythicArgs(['--theme', 'inferno']), /--player/)
  assert.throws(
    () => parseMythicArgs(['--player', 'X', '--theme', 'carbon']),
    /theme must be one of/,
  )
  assert.throws(
    () => parseMythicArgs(['--player', 'X', '--theme', 'inferno', '--clear']),
    /exactly one/,
  )
  assert.throws(() => parseMythicArgs(['--player', 'X']), /exactly one/)
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @eanhl/worker build`
Expected: FAIL. `Cannot find module './card-mythic-args.js'`.

- [ ] **Step 3: Implement the parser and the CLI**

Create `apps/worker/src/lib/card-mythic-args.ts`:

```ts
import { MYTHIC_THEMES, type MythicThemeKey } from '@eanhl/db/cards'

export type MythicCommand =
  | { player: string; action: 'award'; theme: MythicThemeKey }
  | { player: string; action: 'clear' }

export const MYTHIC_USAGE =
  'usage: card-mythic --player "<gamertag>" (--theme <' + MYTHIC_THEMES.join('|') + '> | --clear)'

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

export function parseMythicArgs(argv: readonly string[]): MythicCommand {
  const player = flag(argv, 'player')
  if (player === undefined || player.trim() === '')
    throw new Error(`--player is required\n${MYTHIC_USAGE}`)
  const theme = flag(argv, 'theme')
  const clear = argv.includes('--clear')
  if ((theme === undefined) === !clear)
    throw new Error(`pass exactly one of --theme or --clear\n${MYTHIC_USAGE}`)
  if (clear) return { player, action: 'clear' }
  if (!(MYTHIC_THEMES as readonly string[]).includes(theme ?? '')) {
    throw new Error(`theme must be one of ${MYTHIC_THEMES.join(', ')}\n${MYTHIC_USAGE}`)
  }
  return { player, action: 'award', theme: theme as MythicThemeKey }
}
```

Create `apps/worker/src/card-mythic-cli.ts`:

```ts
/**
 * pnpm --filter @eanhl/worker card-mythic --player "<gamertag>" (--theme <key> | --clear)
 *
 * Tier 6 is hand-awarded (spec Part 1). --theme sets the player's card to
 * tier 6 with that mythic theme; --clear returns them to their stats standing.
 * The worker's recompute never overwrites a manual (tier 6) row.
 */
import { eq, sql } from 'drizzle-orm'
import { db, sql as dbSql, playerCardEvents, playerCardProgress } from '@eanhl/db'
import { computeStanding, emptyBadgeValues, mergeCareerTotals } from '@eanhl/db/cards'
import { currentDatabase, loadCareerTotalsInput } from './card-progression.js'
import { parseMythicArgs } from './lib/card-mythic-args.js'

async function main(): Promise<void> {
  const cmd = parseMythicArgs(process.argv.slice(2))
  console.log(`[card-mythic] database=${await currentDatabase()}`)

  const found = (await db.execute(
    sql`SELECT id, gamertag FROM players WHERE lower(gamertag) = lower(${cmd.player})`,
  )) as unknown as { id: number; gamertag: string }[]
  const player = found[0]
  if (player === undefined || found.length !== 1) {
    throw new Error(
      `no unique player with gamertag "${cmd.player}" (matches: ${String(found.length)})`,
    )
  }

  const statsStanding =
    cmd.action === 'clear'
      ? computeStanding(
          mergeCareerTotals(await loadCareerTotalsInput()).get(player.id) ?? emptyBadgeValues(),
        )
      : null

  await db.transaction(async (tx) => {
    const [prev] = await tx
      .select()
      .from(playerCardProgress)
      .where(eq(playerCardProgress.playerId, player.id))
    const now = new Date()
    if (cmd.action === 'award') {
      const row = {
        tier: 6 as const,
        level: 10,
        tierPool: 'manual' as const,
        mythicTheme: cmd.theme,
        updatedAt: now,
      }
      await tx
        .insert(playerCardProgress)
        .values({ playerId: player.id, ...row, computedAt: now })
        .onConflictDoUpdate({ target: playerCardProgress.playerId, set: row })
      await tx.insert(playerCardEvents).values({
        playerId: player.id,
        kind: 'mythic_awarded',
        familyId: null,
        fromValue: prev?.tier ?? 1,
        toValue: 6,
        occurredAt: now,
      })
      console.log(`[card-mythic] ${player.gamertag}: T${String(prev?.tier ?? 1)} → T6 ${cmd.theme}`)
      return
    }
    if (prev?.tierPool !== 'manual' || statsStanding === null) {
      throw new Error(`${player.gamertag} has no hand-awarded mythic to clear`)
    }
    await tx
      .update(playerCardProgress)
      .set({
        tier: statsStanding.tier,
        level: statsStanding.level,
        tierPool: statsStanding.pool,
        mythicTheme: null,
        updatedAt: now,
      })
      .where(eq(playerCardProgress.playerId, player.id))
    await tx.insert(playerCardEvents).values({
      playerId: player.id,
      kind: 'mythic_cleared',
      familyId: null,
      fromValue: 6,
      toValue: statsStanding.tier,
      occurredAt: now,
    })
    console.log(`[card-mythic] ${player.gamertag}: T6 → T${String(statsStanding.tier)} (stats)`)
  })
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`card-mythic: ${msg}\n`)
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
```

In `apps/worker/package.json` `scripts`, add after `"card-recompute"`:

```json
    "card-mythic": "node dist/card-mythic-cli.js",
```

- [ ] **Step 4: Run the parser test and see it pass**

Run: `pnpm --filter @eanhl/worker build && node --test apps/worker/dist/lib/card-mythic-args.test.js`
Expected: `# pass 3`, `# fail 0`

- [ ] **Step 5: Check on `eanhl_preview` that award → recompute → clear leaves no mythic behind (Review Focus #2)**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's#/eanhl$#/eanhl_preview#')"
case "$DATABASE_URL" in */eanhl_preview) echo OK ;; *) echo "WRONG DATABASE — stop"; exit 1 ;; esac
pnpm --filter @eanhl/worker card-mythic --player "stick menace" --theme inferno
pnpm --filter @eanhl/worker card-recompute | grep "Stick Menace"
pnpm --filter @eanhl/worker card-mythic --player "Stick Menace" --clear
pnpm --filter @eanhl/worker card-recompute | grep "Stick Menace"
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -Atc \
  "SELECT kind, from_value, to_value FROM player_card_events WHERE player_id = 3 ORDER BY id"
```

Expected:

- The first recompute line shows `T6 Legend L10 manual Stick Menace 0 events`: the mythic survived.
- After `--clear`, it shows `T4 Elite L7 skater Stick Menace 0 events`.
- The events are `mythic_awarded|4|6` and `mythic_cleared|6|4`.
- The test ends with no mythic left on the preview database.

- [ ] **Step 6: Lint the new files and commit**

```bash
pnpm --filter @eanhl/worker exec eslint src/card-mythic-cli.ts src/lib/card-mythic-args.ts src/lib/card-mythic-args.test.ts
git add apps/worker/src/card-mythic-cli.ts apps/worker/src/lib/card-mythic-args.ts apps/worker/src/lib/card-mythic-args.test.ts apps/worker/package.json
git commit -m "feat(worker): card-mythic CLI for hand-awarded tier 6

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `getPlayerCardProgress` query

**Files:**

- Create: `packages/db/src/queries/cards.ts`
- Modify: `packages/db/src/queries/index.ts` (add one export line)

**Interfaces:**

- Consumes: the Task 4 tables.
- Produces, from `@eanhl/db/queries`: `getPlayerCardProgress(playerId: number, eventLimit = 20): Promise<PlayerCardProgress>`, where

```ts
PlayerCardProgress = {
  standing: { tier; level; pool; mythicTheme; computedAt: Date } | null
  badges: { familyId: BadgeFamilyId; value: number; level: number }[]
  events: { kind; familyId; fromValue; toValue; occurredAt: Date }[]
}
```

- [ ] **Step 1: Write the query**

Create `packages/db/src/queries/cards.ts`:

```ts
import { desc, eq } from 'drizzle-orm'
import { db } from '../client.js'
import { playerBadgeLevels, playerCardEvents, playerCardProgress } from '../schema/index.js'
import type { BadgeFamilyId, CardTier, MythicThemeKey, TierPool } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

export interface PlayerCardProgress {
  /** null until the worker's first recompute has seen this player. */
  standing: {
    tier: CardTier
    level: number
    pool: TierPool | 'manual'
    mythicTheme: MythicThemeKey | null
    computedAt: Date
  } | null
  badges: { familyId: BadgeFamilyId; value: number; level: number }[]
  events: {
    kind: CardEventKind
    familyId: BadgeFamilyId | null
    fromValue: number
    toValue: number
    occurredAt: Date
  }[]
}

/** Card standing, the 21 badge rows and the newest card events for one player. */
export async function getPlayerCardProgress(
  playerId: number,
  eventLimit = 20,
): Promise<PlayerCardProgress> {
  const [standingRows, badges, events] = await Promise.all([
    db.select().from(playerCardProgress).where(eq(playerCardProgress.playerId, playerId)).limit(1),
    db
      .select({
        familyId: playerBadgeLevels.familyId,
        value: playerBadgeLevels.value,
        level: playerBadgeLevels.level,
      })
      .from(playerBadgeLevels)
      .where(eq(playerBadgeLevels.playerId, playerId)),
    db
      .select({
        kind: playerCardEvents.kind,
        familyId: playerCardEvents.familyId,
        fromValue: playerCardEvents.fromValue,
        toValue: playerCardEvents.toValue,
        occurredAt: playerCardEvents.occurredAt,
      })
      .from(playerCardEvents)
      .where(eq(playerCardEvents.playerId, playerId))
      .orderBy(desc(playerCardEvents.occurredAt), desc(playerCardEvents.id))
      .limit(eventLimit),
  ])
  const s = standingRows[0]
  return {
    standing:
      s === undefined
        ? null
        : {
            tier: s.tier,
            level: s.level,
            pool: s.tierPool,
            mythicTheme: s.mythicTheme ?? null,
            computedAt: s.computedAt,
          },
    badges,
    events,
  }
}
```

Add to `packages/db/src/queries/index.ts`, after `export * from './player-loadouts.js'`:

```ts
export * from './cards.js'
```

- [ ] **Step 2: Build, typecheck, and smoke-test against `eanhl_preview`**

```bash
pnpm --filter @eanhl/db build && pnpm --filter @eanhl/db typecheck
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's#/eanhl$#/eanhl_preview#')"
(cd apps/worker && node --input-type=module -e "
import { getPlayerCardProgress } from '@eanhl/db/queries'
import { sql } from '@eanhl/db'
const a = await getPlayerCardProgress(3); const b = await getPlayerCardProgress(999999)
console.log(JSON.stringify(a.standing), a.badges.length, a.events.length, '|', JSON.stringify(b))
await sql.end()" 2>&1 | tail -1)
```

The `node` line runs inside `apps/worker`, which depends on `@eanhl/db`, so the package import resolves.

Expected:

- `{"tier":4,"level":7,"pool":"skater","mythicTheme":null,...} 21 2`. The two events are Task 6's mythic award and clear.
- Then `| {"standing":null,"badges":[],"events":[]}`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/queries/cards.ts packages/db/src/queries/index.ts
git commit -m "feat(db): getPlayerCardProgress query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Badge primitives (shapes, skins, textures, glyphs, layout, `Badge`)

**Files:**

- Modify: `apps/web/package.json` (dependency `lucide-react`)
- Create: `docs/design/handoffs/2026-10-cards/port-badge-skins.mjs`
- Create (generated): `apps/web/src/components/badges/badge-skins.ts`
- Create: `apps/web/public/images/badges/tex-{ice-glacier,future-circuit,inferno-gate,olympus-temple,storm-clouds}.webp`
- Create: `apps/web/src/components/badges/badge-shapes.ts`
- Create: `apps/web/src/components/badges/badge-layout.ts`
- Test: `apps/web/src/components/badges/badge-layout.test.ts`
- Create: `apps/web/src/components/badges/badge-glyphs.ts`
- Create: `apps/web/src/components/badges/badge.tsx`
- Create: `apps/web/src/components/badges/badge.css`

**Interfaces:**

- Consumes: `BadgeShapeId`, `BadgeFamilyId`, `CardThemeKey` (`@eanhl/db/cards`), and the type `BadgeFrame` from Task 9's `badge-board.ts`. Task 9 creates that file. To keep this task self-contained, Step 6 creates `badge-board.ts` with just the `BadgeFrame` type; Task 9 replaces the whole file.
- Produces:
  - `BADGE_SHAPES: Record<BadgeShapeId, BadgeShape>`
  - `BADGE_SKINS`, `BADGE_BASE_SKIN`, `type BadgeSkin`
  - `computeBadgeLayout(shape, skin, frame, size): BadgeLayout`
  - `BADGE_GLYPHS: Record<BadgeFamilyId, LucideIcon>`
  - `resolveBadgeSkin(theme): BadgeSkin`
  - `<Badge familyId shape theme frame size title? />`

- [ ] **Step 1: Add lucide-react**

```bash
pnpm --filter web add lucide-react
```

Expected: `apps/web/package.json` gains `"lucide-react": "^0.<x>"`.

- [ ] **Step 2: Generate `badge-skins.ts` from the design file**

Create `docs/design/handoffs/2026-10-cards/port-badge-skins.mjs`:

```js
// One-off port: reads the design bundle's badge-levels.js + card-data.js and
// writes apps/web/src/components/badges/badge-skins.ts (default skin per theme).
// Usage: node docs/design/handoffs/2026-10-cards/port-badge-skins.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out =
  process.argv[2] ?? join(here, '../../../../apps/web/src/components/badges/badge-skins.ts')
globalThis.window = {}
// eslint-disable-next-line no-eval
;(0, eval)(readFileSync(join(here, 'card-data.js'), 'utf8'))
;(0, eval)(readFileSync(join(here, 'badge-levels.js'), 'utf8'))
const L = globalThis.window.BGM_LEVELS
const D = globalThis.window.BGM_CARD
const fixAsset = (s) =>
  typeof s === 'string'
    ? s.replace(/url\('assets\/(tex-[a-z-]+)\.(png|webp|avif)'\)/g, "url('/images/badges/$1.webp')")
    : s
const skins = {}
const textures = new Set()
for (const theme of L.THEME_ORDER) {
  const skin = L.skinFor(theme)
  const fixed = Object.fromEntries(Object.entries(skin).map(([k, v]) => [k, fixAsset(v)]))
  for (const v of Object.values(skin)) {
    if (typeof v === 'string')
      for (const m of v.matchAll(/assets\/(tex-[a-z-]+\.(?:png|webp|avif))/g)) textures.add(m[1])
  }
  skins[theme] = fixed
}
const base = { ...D.BADGE_TIERS[3] }
const ts = `// GENERATED by docs/design/handoffs/2026-10-cards/port-badge-skins.mjs — do not edit by hand.
// Default badge skin per card theme (badge-levels.js SKINS/skinFor) and the
// base tier the Player Badges design merges them onto (card-data.js BADGE_TIERS[3]).
import type { CardThemeKey } from '@eanhl/db/cards'

export interface BadgeSkin {
  outer: string
  fill: string
  icon: string
  label: string
  inset: number
  filter: string
  gap?: string
  inner?: string
  gloss?: boolean
}

export const BADGE_BASE_SKIN: BadgeSkin = ${JSON.stringify(
  {
    outer: base.outer,
    fill: base.fill,
    icon: base.icon,
    label: base.label,
    inset: base.inset,
    filter: base.filter,
  },
  null,
  2,
)}

export const BADGE_SKINS: Readonly<Record<CardThemeKey, BadgeSkin>> = ${JSON.stringify(skins, null, 2)}
`
writeFileSync(out, ts)
console.log(`wrote ${out}`)
console.log(`textures referenced: ${[...textures].sort().join(' ')}`)
```

Run:

```bash
node docs/design/handoffs/2026-10-cards/port-badge-skins.mjs
npx prettier --write apps/web/src/components/badges/badge-skins.ts
```

Expected:

- `wrote …/apps/web/src/components/badges/badge-skins.ts`
- `textures referenced: tex-future-circuit.webp tex-ice-glacier.png tex-inferno-gate.webp tex-olympus-temple.png tex-storm-clouds.png`

- [ ] **Step 3: Make the five badge textures (256 px WebP, ~85 KB total instead of ~9 MB)**

```bash
TMP=$(mktemp -d); unzip -q "Card Customization Page.zip" -d "$TMP"
A="$TMP/design_handoff_player_cards_badges/assets"; OUT=apps/web/public/images/badges
mkdir -p "$OUT"
for f in tex-ice-glacier.png tex-future-circuit.webp tex-inferno-gate.webp tex-olympus-temple.png tex-storm-clouds.png; do
  ffmpeg -v error -y -i "$A/$f" -vf "scale=256:-2" -frames:v 1 -c:v libwebp -quality 78 "$OUT/${f%.*}.webp"
done
ls -l "$OUT"   # five .webp files, each < 40 KB
```

- [ ] **Step 4: Write the failing layout test**

Create `apps/web/src/components/badges/badge-layout.test.ts`:

```ts
/**
 * Run: node --test apps/web/src/components/badges/badge-layout.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeBadgeLayout } from './badge-layout.ts'
import type { BadgeShape } from './badge-shapes'
import type { BadgeSkin } from './badge-skins'

const HEX: BadgeShape = {
  clip: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
  ar: 42 / 38,
  ic: 0.47,
  pad: 0,
  padTop: 0,
}
const SKIN: BadgeSkin = {
  outer: 'OUTER',
  fill: 'FILL',
  icon: '#fff',
  label: '#ccc',
  inset: 2,
  filter: 'none',
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

void test('single frame at the design base size (38px)', () => {
  const l = computeBadgeLayout(HEX, SKIN, 'single', 38)
  assert.equal(l.width, 38)
  assert.ok(close(l.height, 42))
  assert.deepEqual(
    l.layers.map((x) => [x.inset, x.background]),
    [
      [0, 'OUTER'],
      [2, 'FILL'],
      [2, 'FILL'],
      [2, 'FILL'],
    ],
  )
  assert.ok(close(l.iconSize, 38 * 0.47))
  assert.equal(l.bevel, false)
  assert.equal(l.filter, 'none')
})

void test('double frame opens a gap ring between two rims', () => {
  const l = computeBadgeLayout(HEX, SKIN, 'double', 38)
  assert.deepEqual(
    l.layers.map((x) => x.background),
    ['OUTER', '#070606', 'OUTER', 'FILL'],
  )
  const [, gap, ring, face] = l.layers
  assert.ok(gap && ring && face)
  assert.ok(close(gap.inset, 2))
  assert.ok(close(ring.inset, 3.5))
  assert.ok(close(face.inset, 5.1))
  assert.equal(
    computeBadgeLayout(HEX, { ...SKIN, gap: 'GAP' }, 'double', 38).layers[1]?.background,
    'GAP',
  )
})

void test('heavy frame thickens the rim 2.4x and scales with size', () => {
  assert.ok(close(computeBadgeLayout(HEX, SKIN, 'heavy', 38).layers[1]?.inset ?? 0, 4.8))
  assert.ok(close(computeBadgeLayout(HEX, SKIN, 'single', 76).layers[1]?.inset ?? 0, 4))
})

void test('an inner hairline adds a fifth layer; gloss turns on the bevel', () => {
  const l = computeBadgeLayout(HEX, { ...SKIN, inner: 'INNER', gloss: true }, 'single', 38)
  assert.deepEqual(
    l.layers.map((x) => x.background),
    ['OUTER', 'FILL', 'FILL', 'INNER', 'FILL'],
  )
  assert.ok(close(l.layers[4]?.inset ?? 0, 3))
  assert.equal(l.bevel, true)
})
```

- [ ] **Step 5: Run it and see it fail**

Run: `cd apps/web && node --test src/components/badges/badge-layout.test.ts`
Expected: FAIL. `Cannot find module …/badge-layout.ts`.

- [ ] **Step 6: Implement shapes, layout, glyphs and `Badge`**

Create `apps/web/src/components/badges/badge-board.ts` with only the type. Task 9 replaces this file completely:

```ts
export type BadgeFrame = 'single' | 'double' | 'heavy'
```

Create `apps/web/src/components/badges/badge-shapes.ts`:

```ts
/**
 * Badge silhouettes, ported from the design bundle's badge-shapes.js.
 * Only the five shapes the badge groups use are kept.
 */
import type { BadgeShapeId } from '@eanhl/db/cards'

export interface BadgeShape {
  /** CSS clip-path. */
  clip: string
  /** Height / width. */
  ar: number
  /** Icon size as a fraction of the badge width. */
  ic: number
  /** Icon bottom padding as a fraction of the height. */
  pad: number
  /** Icon top padding as a fraction of the height. */
  padTop: number
}

type Point = readonly [number, number]

/** Polygon with rounded corners as a percentage clip-path (badge-shapes.js roundedPoly). */
function roundedPoly(vertices: readonly Point[], r: number, steps: number): string {
  const n = vertices.length
  const at = (i: number): Point => vertices[((i % n) + n) % n] as Point
  const pts: Point[] = []
  for (let i = 0; i < n; i++) {
    const [px, py] = at(i)
    const [ax0, ay0] = at(i - 1)
    const [cx0, cy0] = at(i + 1)
    let ax = ax0 - px
    let ay = ay0 - py
    let cx = cx0 - px
    let cy = cy0 - py
    const la = Math.hypot(ax, ay)
    const lc = Math.hypot(cx, cy)
    ax /= la
    ay /= la
    cx /= lc
    cy /= lc
    const th = Math.acos(ax * cx + ay * cy)
    const d = r / Math.tan(th / 2)
    const h = r / Math.sin(th / 2)
    let bx = ax + cx
    let by = ay + cy
    const lb = Math.hypot(bx, by)
    bx /= lb
    by /= lb
    const ox = px + bx * h
    const oy = py + by * h
    const a1 = Math.atan2(py + ay * d - oy, px + ax * d - ox)
    const a2 = Math.atan2(py + cy * d - oy, px + cx * d - ox)
    let da = a2 - a1
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    for (let s = 0; s <= steps; s++) {
      const a = a1 + (da * s) / steps
      pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r])
    }
  }
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const pct = (v: number, lo: number, hi: number) => (((v - lo) / (hi - lo)) * 100).toFixed(2)
  return `polygon(${pts.map((p) => `${pct(p[0], x0, x1)}% ${pct(p[1], y0, y1)}%`).join(', ')})`
}

const TRI_AR = 0.92

export const BADGE_SHAPES: Readonly<Record<BadgeShapeId, BadgeShape>> = {
  hex: {
    clip: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
    ar: 42 / 38,
    ic: 0.47,
    pad: 0,
    padTop: 0,
  },
  round: { clip: 'circle(50% at 50% 50%)', ar: 1, ic: 0.46, pad: 0, padTop: 0 },
  octagon: {
    clip: 'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)',
    ar: 1,
    ic: 0.46,
    pad: 0,
    padTop: 0,
  },
  square: { clip: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', ar: 1, ic: 0.5, pad: 0, padTop: 0 },
  invtri: {
    clip: roundedPoly(
      [
        [0, 0],
        [100, 0],
        [50, 100 * TRI_AR],
      ],
      12,
      8,
    ),
    ar: TRI_AR,
    ic: 0.36,
    pad: 0.2,
    padTop: 0,
  },
}
```

Create `apps/web/src/components/badges/badge-layout.ts`:

```ts
/**
 * Pure geometry for one badge, ported from Badge.dc.html (frames single /
 * double / heavy, optional inner hairline and gloss; no markers or labels —
 * the Player Badges design uses none). Type-only imports keep this file
 * runnable under `node --test` without a bundler.
 */
import type { BadgeShape } from './badge-shapes'
import type { BadgeSkin } from './badge-skins'
import type { BadgeFrame } from './badge-board'

export interface BadgeLayer {
  inset: number
  background: string
}

export interface BadgeLayout {
  width: number
  height: number
  clip: string
  layers: BadgeLayer[]
  bevel: boolean
  filter: string
  iconSize: number
  iconColor: string
  iconInset: number
  iconPadBottom: number
  iconPadTop: number
}

export function computeBadgeLayout(
  shape: BadgeShape,
  skin: BadgeSkin,
  frame: BadgeFrame,
  size: number,
): BadgeLayout {
  const width = size
  const height = width * shape.ar
  const s = width / 38
  const rim = skin.inset * s * (frame === 'heavy' ? 2.4 : 1)
  let gap = skin.fill
  let ring = skin.fill
  let i2 = rim
  let i3 = rim
  if (frame === 'double') {
    const g = Math.max(1.5, 1.3 * s)
    gap = skin.gap ?? '#070606'
    ring = skin.outer
    i2 = rim + g
    i3 = i2 + Math.max(1, rim * 0.8)
  }
  const layers: BadgeLayer[] = [
    { inset: 0, background: skin.outer },
    { inset: rim, background: gap },
    { inset: i2, background: ring },
    { inset: i3, background: skin.inner ?? skin.fill },
  ]
  if (skin.inner !== undefined) {
    layers.push({ inset: i3 + Math.max(1, s * 0.9), background: skin.fill })
  }
  return {
    width,
    height,
    clip: shape.clip,
    layers,
    bevel: skin.gloss === true,
    filter: skin.filter,
    iconSize: width * shape.ic,
    iconColor: skin.icon,
    iconInset: i3,
    iconPadBottom: height * shape.pad,
    iconPadTop: height * shape.padTop,
  }
}
```

Create `apps/web/src/components/badges/badge-glyphs.ts`:

```ts
import {
  Apple,
  Award,
  BrickWall,
  CircleDot,
  Crosshair,
  Hammer,
  Hand,
  HeartPulse,
  Hexagon,
  Magnet,
  ScanFace,
  Shield,
  ShieldCheck,
  Siren,
  Sparkles,
  Sword,
  Swords,
  TrafficCone,
  Trophy,
  Unlink,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { BadgeFamilyId } from '@eanhl/db/cards'

/** Badge glyphs (badge-levels.js `glyph` names) as lucide-react components. */
export const BADGE_GLYPHS: Readonly<Record<BadgeFamilyId, LucideIcon>> = {
  p3v3: Users,
  p6v6: Hexagon,
  p6g: ShieldCheck,
  pwins: Trophy,
  pgoals: Siren,
  pasts: Apple,
  pshots: Crosshair,
  pdekes: TrafficCone,
  pht: Sparkles,
  pbrk: Unlink,
  phits: Hammer,
  pfo: CircleDot,
  ptka: Magnet,
  pblk: Shield,
  pfight: Swords,
  gg: ScanFace,
  gw: Award,
  gsv: Hand,
  gdsv: HeartPulse,
  gpoke: Sword,
  gso: BrickWall,
}
```

Create `apps/web/src/components/badges/badge.css`:

```css
.bdg {
  position: relative;
  display: block;
  flex: none;
}
.bdg-layer {
  position: absolute;
}
.bdg-icon {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
```

Create `apps/web/src/components/badges/badge.tsx`:

```tsx
import type { CSSProperties } from 'react'
import type { BadgeFamilyId, BadgeShapeId, CardThemeKey } from '@eanhl/db/cards'
import { BADGE_SHAPES } from './badge-shapes'
import { BADGE_BASE_SKIN, BADGE_SKINS, type BadgeSkin } from './badge-skins'
import { computeBadgeLayout } from './badge-layout'
import { BADGE_GLYPHS } from './badge-glyphs'
import type { BadgeFrame } from './badge-board'
import './badge.css'

const BEVEL =
  'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 46%, transparent 50%, rgba(0,0,0,0.28))'

const px = (n: number): string => `${String(Math.round(n * 10) / 10)}px`

/** Player Badges merges each theme's default skin onto the base tier (Badge.dc.html). */
export function resolveBadgeSkin(theme: CardThemeKey): BadgeSkin {
  return { ...BADGE_BASE_SKIN, ...BADGE_SKINS[theme] }
}

interface BadgeProps {
  familyId: BadgeFamilyId
  shape: BadgeShapeId
  theme: CardThemeKey
  frame: BadgeFrame
  /** Width in px; height follows the shape's aspect ratio. */
  size: number
  title?: string
}

export function Badge({ familyId, shape, theme, frame, size, title }: BadgeProps) {
  const layout = computeBadgeLayout(BADGE_SHAPES[shape], resolveBadgeSkin(theme), frame, size)
  const Icon = BADGE_GLYPHS[familyId]
  const clip: CSSProperties = { clipPath: layout.clip, WebkitClipPath: layout.clip }
  return (
    <span
      className="bdg"
      title={title}
      style={{ width: px(layout.width), height: px(layout.height), filter: layout.filter }}
    >
      {layout.layers.map((layer, i) => (
        <span
          key={i}
          className="bdg-layer"
          style={{ ...clip, inset: px(layer.inset), background: layer.background }}
        />
      ))}
      {layout.bevel && (
        <span className="bdg-layer" style={{ ...clip, inset: 0, background: BEVEL }} />
      )}
      <span
        className="bdg-icon"
        style={{
          inset: px(layout.iconInset),
          paddingBottom: px(layout.iconPadBottom),
          paddingTop: px(layout.iconPadTop),
        }}
      >
        <Icon aria-hidden size={layout.iconSize} color={layout.iconColor} strokeWidth={2} />
      </span>
    </span>
  )
}
```

- [ ] **Step 7: Run the layout test and typecheck**

Run: `cd apps/web && node --test src/components/badges/badge-layout.test.ts && cd ../.. && pnpm --filter @eanhl/db build && pnpm --filter web typecheck`
Expected: `# pass 4`, `# fail 0`; typecheck exit 0. If a lucide icon name doesn't exist in the installed version, typecheck names it. Swap in the closest lucide icon and note it in the commit message.

- [ ] **Step 8: Lint the new files and commit**

```bash
pnpm --filter web exec eslint src/components/badges
git add apps/web/package.json pnpm-lock.yaml docs/design/handoffs/2026-10-cards/port-badge-skins.mjs apps/web/public/images/badges apps/web/src/components/badges
git commit -m "feat(web): badge primitives — shapes, skins, textures, glyphs, Badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Player Badges section

**Files:**

- Modify (replace entire file): `apps/web/src/components/badges/badge-board.ts`
- Test: `apps/web/src/components/badges/badge-board.test.ts`
- Create: `apps/web/src/components/badges/player-badges.tsx`
- Create: `apps/web/src/components/badges/player-badges.css`

**Interfaces:**

- Consumes:
  - from `@eanhl/db/cards`: `BADGE_FAMILIES`, `BADGE_GROUPS`, `BADGE_LADDERS`, `BADGE_MAX_LEVEL`, `CARD_THEME_NAMES`, `CARD_THEME_ORDER`, `badgeProgress`
  - `Badge` (Task 8)
- Produces:
  - `type BadgeFrame`
  - `badgeVisual(level): BadgeVisual`
  - `themeLabel(level): string`
  - `formatCount(n): string`
  - `buildBadgeBoard(rows: readonly BadgeRowInput[]): BadgeBoardView`
  - `defaultSelection(board): BadgeFamilyId`
  - `<PlayerBadges gamertag rows />`, where `rows: readonly { familyId: BadgeFamilyId; value: number }[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/badges/badge-board.test.ts`:

```ts
/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/badges/badge-board.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeVisual, buildBadgeBoard, defaultSelection, themeLabel } from './badge-board.ts'

void test('level → theme and frame step', () => {
  const v = (l: number) => {
    const x = badgeVisual(l)
    return `${x.theme} ${x.frame} ${x.roman}`
  }
  assert.equal(v(0), 'away single I')
  assert.equal(v(1), 'away single I')
  assert.equal(v(3), 'away heavy III')
  assert.equal(v(4), 'home single I')
  assert.equal(v(16), 'frozen single I')
  assert.equal(v(30), 'olympus heavy III')
})

void test('theme labels', () => {
  assert.equal(themeLabel(0), 'Locked')
  assert.equal(themeLabel(5), 'Home II')
  assert.equal(themeLabel(17), 'Frozen II')
})

void test('a player with no badge rows: 21 locked badges in 5 groups', () => {
  const b = buildBadgeBoard([])
  assert.equal(b.total, 21)
  assert.equal(b.unlocked, 0)
  assert.equal(b.levels, 0)
  assert.equal(b.maxLevels, 630)
  assert.deepEqual(
    b.groups.map((g) => [g.group.id, g.members.length, g.unlocked]),
    [
      ['games', 4, 0],
      ['scoring', 6, 0],
      ['physical', 2, 0],
      ['defense', 3, 0],
      ['goalie', 6, 0],
    ],
  )
  const goals = b.rows.find((r) => r.family.id === 'pgoals')
  assert.ok(goals)
  assert.equal(goals.locked, true)
  assert.equal(goals.themeLabel, 'Locked')
  assert.equal(goals.progressText, '0 / 1 goals')
  assert.equal(goals.remainingText, '1 to LVL 1')
  assert.equal(goals.shape, 'round')
})

void test('mid-ladder and maxed badges', () => {
  const b = buildBadgeBoard([
    { familyId: 'phits', value: 1234 },
    { familyId: 'pgoals', value: 6000 },
  ])
  const hits = b.rows.find((r) => r.family.id === 'phits')
  const goals = b.rows.find((r) => r.family.id === 'pgoals')
  assert.ok(hits && goals)
  assert.equal(hits.progress.level, 6)
  assert.equal(hits.themeLabel, 'Home III')
  assert.equal(hits.progressText, '1,234 / 1,300 hits')
  assert.equal(hits.remainingText, '66 to LVL 7')
  assert.equal(goals.progressText, 'Maxed · 6,000 goals')
  assert.equal(goals.remainingText, '')
  assert.equal(b.unlocked, 2)
  assert.equal(b.levels, 36)
  assert.equal(defaultSelection(b), 'pgoals')
})

void test('default selection falls back to the first badge when all are locked', () => {
  assert.equal(defaultSelection(buildBadgeBoard([])), 'p3v3')
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd apps/web && node --test src/components/badges/badge-board.test.ts`
Expected: FAIL. `badgeVisual` (and the other functions) aren't exported yet.

- [ ] **Step 3: Implement the view model**

Replace `apps/web/src/components/badges/badge-board.ts` entirely:

```ts
/**
 * View model for the Player Badges section (Player Badges.dc.html): rows,
 * groups, totals, and the level → look mapping. Pure; no React.
 */
import {
  BADGE_FAMILIES,
  BADGE_GROUPS,
  BADGE_LADDERS,
  BADGE_MAX_LEVEL,
  CARD_THEME_NAMES,
  CARD_THEME_ORDER,
  badgeProgress,
} from '@eanhl/db/cards'
import type {
  BadgeFamily,
  BadgeFamilyId,
  BadgeGroup,
  BadgeProgress,
  BadgeShapeId,
  CardThemeKey,
} from '@eanhl/db/cards'

export type BadgeFrame = 'single' | 'double' | 'heavy'
type Step = 1 | 2 | 3

const FRAME_BY_STEP = { 1: 'single', 2: 'double', 3: 'heavy' } as const
const ROMAN_BY_STEP = { 1: 'I', 2: 'II', 3: 'III' } as const

export interface BadgeVisual {
  theme: CardThemeKey
  step: Step
  frame: BadgeFrame
  roman: (typeof ROMAN_BY_STEP)[Step]
}

/**
 * Level → look: theme index ceil(lvl/3)−1 into the card theme order, step
 * (lvl−1)%3+1 shown as the frame. A locked badge (level 0) is drawn as level 1
 * and dimmed by the caller.
 */
export function badgeVisual(level: number): BadgeVisual {
  const l = Math.min(BADGE_MAX_LEVEL, Math.max(1, Math.floor(level)))
  const theme = CARD_THEME_ORDER[Math.ceil(l / 3) - 1] ?? 'away'
  const step = (((l - 1) % 3) + 1) as Step
  return { theme, step, frame: FRAME_BY_STEP[step], roman: ROMAN_BY_STEP[step] }
}

export function themeLabel(level: number): string {
  if (level <= 0) return 'Locked'
  const v = badgeVisual(level)
  return `${CARD_THEME_NAMES[v.theme]} ${v.roman}`
}

/** Fixed locale so server and browser render identical text (no hydration mismatch). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export interface BadgeRowInput {
  familyId: BadgeFamilyId
  value: number
}

export interface BadgeRowView {
  family: BadgeFamily
  shape: BadgeShapeId
  progress: BadgeProgress
  locked: boolean
  themeLabel: string
  progressText: string
  remainingText: string
}

export interface BadgeGroupView {
  group: BadgeGroup
  members: BadgeRowView[]
  unlocked: number
}

export interface BadgeBoardView {
  groups: BadgeGroupView[]
  rows: BadgeRowView[]
  unlocked: number
  total: number
  levels: number
  maxLevels: number
}

export function buildBadgeBoard(input: readonly BadgeRowInput[]): BadgeBoardView {
  const valueById = new Map(input.map((r) => [r.familyId, r.value]))
  const shapeByGroup = new Map(BADGE_GROUPS.map((g) => [g.id, g.shape]))
  const rows: BadgeRowView[] = BADGE_FAMILIES.map((family) => {
    const progress = badgeProgress(BADGE_LADDERS[family.id], valueById.get(family.id) ?? 0)
    return {
      family,
      shape: shapeByGroup.get(family.group) ?? 'hex',
      progress,
      locked: progress.level === 0,
      themeLabel: themeLabel(progress.level),
      progressText:
        progress.nextThreshold === null
          ? `Maxed · ${formatCount(progress.value)} ${family.unit}`
          : `${formatCount(progress.value)} / ${formatCount(progress.nextThreshold)} ${family.unit}`,
      remainingText:
        progress.remaining === null
          ? ''
          : `${formatCount(progress.remaining)} to LVL ${String(progress.level + 1)}`,
    }
  })
  const groups = BADGE_GROUPS.map((group) => {
    const members = rows.filter((r) => r.family.group === group.id)
    return { group, members, unlocked: members.filter((m) => !m.locked).length }
  })
  return {
    groups,
    rows,
    unlocked: rows.filter((r) => !r.locked).length,
    total: rows.length,
    levels: rows.reduce((sum, r) => sum + r.progress.level, 0),
    maxLevels: rows.length * BADGE_MAX_LEVEL,
  }
}

/** Initially selected badge: the highest level (ties → catalog order). */
export function defaultSelection(board: BadgeBoardView): BadgeFamilyId {
  let best: BadgeRowView | undefined
  for (const r of board.rows)
    if (best === undefined || r.progress.level > best.progress.level) best = r
  return best?.family.id ?? 'p3v3'
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `cd apps/web && node --test src/components/badges/badge-board.test.ts src/components/badges/badge-layout.test.ts`
Expected: `# pass 9`, `# fail 0`

- [ ] **Step 5: Write the section component**

Create `apps/web/src/components/badges/player-badges.css`. Values come from `Player Badges.dc.html`:

```css
.pb {
  border: 1px solid #2a2829;
  background: #1f1d1e;
  display: flex;
  flex-direction: column;
  font-family: var(--font-condensed);
}
.pb-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  padding: 18px 22px 14px;
}
.pb-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #fafafa;
  line-height: 1;
}
.pb-title-mark {
  color: #e84131;
  margin-right: 6px;
}
.pb-sub,
.pb-totals {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #71717a;
}
.pb-totals {
  display: flex;
  align-items: baseline;
  gap: 10px;
  letter-spacing: 0.16em;
}
.pb-totals b {
  color: #fafafa;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.pb-dot {
  color: #52525b;
}
.pb-rule {
  height: 1px;
  background: linear-gradient(90deg, #7a1a10, #e84131, #7a1a10);
}
.pb-body {
  display: grid;
  grid-template-columns: minmax(220px, 272px) minmax(0, 1fr);
  height: 640px;
}
.pb-list {
  border-right: 1px solid #2a2829;
  overflow-y: auto;
}
.pb-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #71717a;
}
.pb-group-line {
  flex: 1;
  height: 1px;
  background: #2a2829;
}
.pb-group-count {
  color: #52525b;
  font-variant-numeric: tabular-nums;
}
.pb-row {
  width: 100%;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 6px 16px;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-condensed);
  background: transparent;
}
.pb-row:hover {
  background: #262425;
}
.pb-row[data-selected='true'] {
  background: #2a2829;
  box-shadow: inset 2px 0 0 #e84131;
}
.pb-row-badge {
  display: grid;
  place-items: center;
}
.pb-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pb-row-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #d4d4d8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pb-row[data-locked='true'] .pb-row-name {
  color: #71717a;
}
.pb-row[data-selected='true'] .pb-row-name {
  color: #fafafa;
}
.pb-row-theme {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #52525b;
}
.pb-row-lvl {
  font-size: 12px;
  font-weight: 700;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
}
.pb-row[data-locked='true'] .pb-row-lvl {
  color: #52525b;
}
.pb-row[data-selected='true'] .pb-row-lvl {
  color: #e84131;
}
.pb-row-lvl span {
  color: #52525b;
}
.pb-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.pb-detail-head {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 18px 24px;
  border-bottom: 1px solid #2a2829;
  background: radial-gradient(60% 120% at 0% 0%, rgba(232, 65, 49, 0.08), transparent 70%);
}
.pb-detail-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pb-detail-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.pb-detail-name {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fafafa;
  line-height: 1;
}
.pb-detail-lvl {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #71717a;
  white-space: nowrap;
}
.pb-detail-lvl b {
  color: #fafafa;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.pb-detail-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #e84131;
}
.pb-bar {
  height: 4px;
  background: #2a2829;
}
.pb-bar > div {
  height: 100%;
  background: #e84131;
}
.pb-detail-progress {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #71717a;
  font-variant-numeric: tabular-nums;
}
.pb-detail-progress span:last-child {
  color: #a1a1aa;
}
.pb-ladder {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 20px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: space-between;
  gap: 8px 20px;
}
.pb-theme {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.pb-cell {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 7px 0 6px;
  border: none;
  background: transparent;
  font-family: var(--font-condensed);
}
.pb-cell[data-current='true'] {
  background: rgba(232, 65, 49, 0.08);
  box-shadow: inset 0 0 0 1px rgba(232, 65, 49, 0.6);
}
.pb-cell[aria-pressed='true'] {
  box-shadow: inset 0 0 0 1px #fafafa;
}
.pb-cell-at {
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.pb-foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 22px;
  border-top: 1px solid #2a2829;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #52525b;
}
@media (max-width: 767px) {
  .pb-body {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }
  .pb-list {
    border-right: none;
    border-bottom: 1px solid #2a2829;
    max-height: 320px;
  }
  .pb-detail-head {
    padding: 16px;
  }
  .pb-ladder {
    grid-template-columns: minmax(0, 1fr);
    padding: 12px 16px 16px;
  }
}
```

Create `apps/web/src/components/badges/player-badges.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { BADGE_LADDERS, BADGE_MAX_LEVEL } from '@eanhl/db/cards'
import type { BadgeFamilyId } from '@eanhl/db/cards'
import { Badge } from './badge'
import {
  badgeVisual,
  buildBadgeBoard,
  defaultSelection,
  formatCount,
  themeLabel,
  type BadgeRowInput,
  type BadgeRowView,
} from './badge-board'
import './player-badges.css'

const LOCK_FILTER = 'grayscale(1) brightness(0.55)'
const LOCK_OPACITY = 0.35
const LEVELS = Array.from({ length: BADGE_MAX_LEVEL }, (_, i) => i + 1)
const THEME_CHUNKS = Array.from({ length: BADGE_MAX_LEVEL / 3 }, (_, t) =>
  LEVELS.slice(t * 3, t * 3 + 3),
)

function BadgeAt({ row, level, size }: { row: BadgeRowView; level: number; size: number }) {
  const v = badgeVisual(level)
  return (
    <Badge familyId={row.family.id} shape={row.shape} theme={v.theme} frame={v.frame} size={size} />
  )
}

interface PlayerBadgesProps {
  gamertag: string
  rows: readonly BadgeRowInput[]
}

/** Profile "Badges" section — port of Player Badges.dc.html (marker = frame step, locked = dim). */
export function PlayerBadges({ gamertag, rows }: PlayerBadgesProps) {
  const board = useMemo(() => buildBadgeBoard(rows), [rows])
  const [selId, setSelId] = useState<BadgeFamilyId>(() => defaultSelection(board))
  const [hover, setHover] = useState<number | null>(null)
  const [pin, setPin] = useState<number | null>(null)

  const sel = board.rows.find((r) => r.family.id === selId) ?? board.rows[0]
  if (sel === undefined) return null

  const ladder = BADGE_LADDERS[sel.family.id]
  const level = sel.progress.level
  const focus = hover ?? pin
  const focusAt = focus === null ? 0 : (ladder[focus - 1] ?? 0)
  const headLabel =
    focus === null
      ? sel.themeLabel
      : `${themeLabel(focus)} · LVL ${String(focus)} · ${formatCount(focusAt)} ${sel.family.unit} · ${focus <= level ? 'Unlocked' : 'Locked'}`
  const headDim = focus === null && sel.locked

  const pick = (id: BadgeFamilyId) => {
    setSelId(id)
    setPin(null)
    setHover(null)
  }

  return (
    <section className="pb" aria-label="Badges">
      <header className="pb-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="pb-title">
            <span className="pb-title-mark">▌</span>Badges
          </h2>
          <span className="pb-sub">Career milestones · player · {gamertag}</span>
        </div>
        <div className="pb-totals">
          <span>
            <b>{board.unlocked}</b> / {board.total} Unlocked
          </span>
          <span className="pb-dot">·</span>
          <span>
            <b>{board.levels}</b> / {board.maxLevels} Levels
          </span>
        </div>
      </header>
      <div className="pb-rule" />
      <div className="pb-body">
        <div className="pb-list">
          {board.groups.map((g) => (
            <div key={g.group.id}>
              <div className="pb-group">
                <span>{g.group.name}</span>
                <span className="pb-group-line" />
                <span className="pb-group-count">
                  {g.unlocked}/{g.members.length}
                </span>
              </div>
              {g.members.map((r) => (
                <button
                  key={r.family.id}
                  type="button"
                  className="pb-row"
                  data-selected={r.family.id === sel.family.id}
                  data-locked={r.locked}
                  onClick={() => pick(r.family.id)}
                >
                  <span
                    className="pb-row-badge"
                    style={r.locked ? { opacity: LOCK_OPACITY, filter: LOCK_FILTER } : undefined}
                  >
                    <BadgeAt row={r} level={r.progress.level} size={30} />
                  </span>
                  <span className="pb-row-text">
                    <span className="pb-row-name">{r.family.short}</span>
                    <span className="pb-row-theme">{r.themeLabel}</span>
                  </span>
                  <span className="pb-row-lvl">
                    {r.progress.level}
                    <span>/30</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="pb-detail">
          <div className="pb-detail-head">
            <div
              style={
                headDim
                  ? { flex: 'none', opacity: LOCK_OPACITY, filter: LOCK_FILTER }
                  : { flex: 'none' }
              }
            >
              <BadgeAt row={sel} level={focus ?? level} size={76} />
            </div>
            <div className="pb-detail-info">
              <div className="pb-detail-top">
                <span className="pb-detail-name">{sel.family.name}</span>
                <span className="pb-detail-lvl">
                  LVL <b>{level}</b> / 30
                </span>
              </div>
              <span className="pb-detail-label">{headLabel}</span>
              <div className="pb-bar">
                <div style={{ width: `${(sel.progress.pct * 100).toFixed(1)}%` }} />
              </div>
              <div className="pb-detail-progress">
                <span>{sel.progressText}</span>
                <span>{sel.remainingText}</span>
              </div>
            </div>
          </div>
          <div className="pb-ladder">
            {THEME_CHUNKS.map((chunk) => (
              <div key={chunk[0]} className="pb-theme">
                {chunk.map((n) => {
                  const done = n <= level
                  const current = n === level + 1
                  const at = ladder[n - 1] ?? 0
                  return (
                    <button
                      key={n}
                      type="button"
                      className="pb-cell"
                      data-current={current}
                      aria-pressed={pin === n}
                      title={`LVL ${String(n)} · ${themeLabel(n)} · ${formatCount(at)} ${sel.family.unit}`}
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setPin((p) => (p === n ? null : n))}
                    >
                      <span
                        style={{
                          opacity: done ? 1 : current ? 0.6 : LOCK_OPACITY,
                          filter: done ? 'none' : current ? 'grayscale(0.6)' : LOCK_FILTER,
                        }}
                      >
                        <BadgeAt row={sel} level={n} size={52} />
                      </span>
                      <span
                        className="pb-cell-at"
                        style={{ color: done ? '#fafafa' : current ? '#e84131' : '#52525b' }}
                      >
                        {formatCount(at)}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="pb-foot">
        <span>Source EA NHL · Boogeymen</span>
        <span>Sheet BGM/BDG/0028</span>
      </footer>
    </section>
  )
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web exec eslint src/components/badges`
Expected: exit 0 for both.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/badges
git commit -m "feat(web): Player Badges section (grouped list, detail, 30-step ladder)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Preview route, then side-by-side visual check

**Files:**

- Create: `apps/web/src/app/preview/roster/[id]/page.tsx` (a copy of `apps/web/src/app/roster/[id]/page.tsx` plus the edits below)

**Interfaces:**

- Consumes: `getPlayerCardProgress` (Task 7), `<PlayerBadges>` (Task 9).
- Produces: `/preview/roster/[id]`. Outside production it renders the player page with the Badges section right under the hero; in production it returns 404.

- [ ] **Step 1: Copy the page**

```bash
mkdir -p "apps/web/src/app/preview/roster/[id]"
cp "apps/web/src/app/roster/[id]/page.tsx" "apps/web/src/app/preview/roster/[id]/page.tsx"
```

- [ ] **Step 2: Make five edits to the copy**

1. In the `@eanhl/db/queries` import list, after `getPlayerCareerShots,`, add:

```ts
  getPlayerCardProgress,
```

2. After `import { Panel } from '@/components/ui/panel'`, add:

```ts
import { PlayerBadges } from '@/components/badges/player-badges'
```

3. Mark the metadata title as a preview: replace ``return { title: `${overview.player.gamertag} — Club Stats` }`` with:

```ts
return { title: `PREVIEW · ${overview.player.gamertag} — Club Stats` }
```

4. Rename `export default async function PlayerPage({ params, searchParams }: Props) {` to `PreviewPlayerPage`, and make its first statement the production guard:

```ts
export default async function PreviewPlayerPage({ params, searchParams }: Props) {
  // Test-run page (spec "Test run"): never served in production. Deleted at the switch.
  if (process.env.NODE_ENV === 'production') notFound()
```

5. After the `careerShots` `try { … } catch { … }` block, add:

```ts
let cardProgress: Awaited<ReturnType<typeof getPlayerCardProgress>> | null = null
try {
  cardProgress = await getPlayerCardProgress(id)
} catch {
  cardProgress = null
}
```

Then, directly after the closing `/>` of `<ProfileHero … />`, add:

```tsx
<PlayerBadges gamertag={overview.player.gamertag} rows={cardProgress?.badges ?? []} />
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web exec eslint "src/app/preview/roster/[id]/page.tsx"`
Expected: exit 0 for both.

- [ ] **Step 4: Start the dev server on `eanhl_preview`**

Check first that nothing is already running on port 3000 (`ss -ltnp | grep :3000`). Then start it in the background:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' apps/web/.env.local | cut -d= -f2- | sed 's#/eanhl$#/eanhl_preview#')"
case "$DATABASE_URL" in */eanhl_preview) echo OK ;; *) echo "WRONG DATABASE — stop"; exit 1 ;; esac
pnpm --filter web dev
```

Expected: `Ready` on `http://127.0.0.1:3000`. An exported `DATABASE_URL` takes precedence over `.env.local`. If a background-process start is denied, stop and ask the operator to approve it.

- [ ] **Step 5: Visual check against the prototype (Playwright MCP)**

1. **Stick Menace, desktop:** serve the prototype unless something is already on port 8765:

   ```bash
   PROTO=$(mktemp -d) && unzip -q "Card Customization Page.zip" -d "$PROTO"
   python3 -m http.server 8765 --bind 127.0.0.1 --directory "$PROTO"   # background
   ```

   At 1280×900, screenshot `http://127.0.0.1:3000/preview/roster/3` (Badges section) and `http://localhost:8765/design_handoff_player_cards_badges/Player%20Badges.dc.html`.
   - Compare: header, red rule, group headers, row grid, selected-row rail, detail header, the 2×3 ladder grid, and the footer.
   - Differences must be data only. The prototype uses demo levels; the preview uses Stick Menace's real ones.

2. **Interaction:** hover a ladder cell and the big badge and label preview that level. Click a cell and it pins with a white ring; click again to unpin. Click a different row and the pin clears.
3. **Phone width:** at 390×844, the list stacks above the detail, the ladder is one theme per row, and there's no sideways page scroll.
4. **Unchanged pages:** open `http://127.0.0.1:3000/roster/3`. It must be the unchanged live design with no Badges section.
5. **Review Focus #1:** open `/preview/roster/28` (Utiz23, never computed or 0 GP). Expect 21 dim badges, `0 / 21 Unlocked · 0 / 630 Levels`, and the detail `0 / 5 3v3 games` · `5 to LVL 1`. No error.
6. **Goalie:** open `/preview/roster/12` (Pratt2016). The goalie group shows unlocked badges.
7. **Console:** check the browser console on each page. No hydration warnings, no 404s for `/images/badges/*.webp`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/preview/roster/[id]/page.tsx"
git status --short   # confirm apps/web/src/app/preview/archetypes/ is still untracked and NOT staged
git commit -m "feat(web): dev-only /preview/roster/[id] with the Badges section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand over to the operator**

Send the operator three links:

- `http://localhost:3000/preview/roster/3` next to `http://localhost:3000/roster/3`;
- the goalie view, `/preview/roster/12`.

Ask for tweaks. Leave the dev server running. Do not push the branch without the operator's OK.

---

## Execution record (2026-10-07)

Executed inline on `feat/player-cards` (`bd6f6ed..c0c214d`). All 10 tasks complete.

- **`card-recompute --dry-run` on `eanhl_preview`** reproduced the approved tier table exactly.
  - The preview database was restored from `eanhl-2026-10-06.dump`: 277 matches, which is 449 minus the 172 quarantined.
  - Write plus rerun was idempotent: 89 players, 1,869 badge rows, 0 events.
- **Final whole-branch review** (fresh reviewer) found 0 Critical and 1 Important issue.
  - **Fixed in `c0c214d`:** a recompute racing `card-mythic --clear` re-wrote the stale tier-6 row.
  - The fix adds `planCardRecompute`, with a RED→GREEN test that was mutation-checked.
- **Spec open item resolved:**
  - The 11 NHL 26 `ea_member_season_stats` rows were all fetched 2026-09-07 15:01 UTC.
  - All of them are BGM members.

**Rulings:**

- Branch in the main checkout, not a worktree. The dev server and CLIs need `.env` / `.env.local`.
- `docs/design/handoffs/` was added to `.prettierignore`, so the verbatim reference copies stay byte-identical.
- `roundedPoly` uses `?? [0, 0]`, because ESLint forbids both the cast and `!`. The output is identical.
- `eslint --fix` added braces to 4 void arrow handlers. Behavior is identical.
- The race fix skips manual rows rather than adding an advisory lock. The cost: overlapping write-mode recomputes can still log duplicate events.
- The Dekes badge counts EA `dekes` (attempts), not `dekes_made`, as the spec names it. **Operator decided: count successful dekes. Done in `e21e1b5` (spec D12).**

**Deferred follow-ups**, to settle before or at the switch:

1. **Before the switch:**
   - Relabel the Badges footer "Source EA NHL · Boogeymen". The values blend EA totals, NHL 22–25 history and site-recorded games.
   - Downscale the badge textures to about 160 px. All 5 (about 85 KB) load on every player page, because levels 16–30 always render.
   - Gate ladder hover on `pointerType === 'mouse'`. On touch, hover sticks after tapping.
2. **Step-2 plan:**
   - Add `getCardProgressForPlayers` (spec Part 1 queries).
   - Consider an automated test for the `setWhere` guard.
3. **Operator decisions:**
   - Badge-level high-water mark. Today a drop and recovery re-logs `badge_level_up`, and an easier ladder change floods the history.
   - Contrast of the prototype's accent `#e84131` and `#52525b` small text, both below 4.5:1.
4. **Latent or minor:**
   - An advisory lock against duplicate events from overlapping recomputes.
   - `RecordedModeGames` has no title, so `p6v6` could double-count if history is ever imported for a recorded title with no EA row.
   - Every cycle rewrites every row, and the single INSERT hits the 65,535-parameter limit at about 624 players.
   - The early return in `runIngestionCycle` skips the recompute when no title is active.
   - A mythic awarded before a player's first recompute makes the next run log every unlocked family as a badge level-up.
   - The preview route's `generateMetadata` still queries the database before its production `notFound()`. The route is deleted at the switch.

**Follow-up decisions (2026-10-07):** Dekes counts successful dekes (`e21e1b5`, D12). The Badges section moved to the bottom of the page (D13). The badge icons are placeholders to be replaced (D14). Branch kept local as-is.
