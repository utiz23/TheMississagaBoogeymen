# Step 3: Card Locker (EDIT button + read-only drawer) Implementation Plan

> **Update 2026-10-09:** the locker is no longer read-only — member logins step 1 ([plan](2026-10-09-member-logins-step-1.md)) made EQUIP and AUTO live. Deviation #9 is resolved: under AUTO the shown theme reads EQUIP (it pins it). #5 (NEW tag / new-dot) and #6 (CLOSE, no CANCEL) stand.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the dev preview page `/preview/roster/[id]`, put an **EDIT** button under the hero card that opens a read-only **Card Locker** drawer with a Theme tab (browse all 10 themes) and a Progress tab (level, next-tier requirement, tier track, history).

**Architecture:** A pure view-model builder (`locker-model.ts`) turns the card and the stored progress into display strings on the server, so the client components only render and handle open/close, tabs and browsing. The drawer is a client component portalled to `<body>`, following the site's nav-drawer pattern for focus trap, Esc and scroll lock. One small schema addition (`player_card_progress.created_at`, folded into the not-yet-live migration 0060) dates the empty history ("History starts …").

**Tech Stack:** Next.js 15 App Router / React 19, TypeScript strict, Drizzle ORM + hand-written SQL migration, `node --test` (type stripping), lucide-react 1.52, ffmpeg (thumbnails), Playwright MCP for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-07-player-cards-badges-design.md` — Part 3 ("Locker drawer"), D1, D9, D10, Test run. Design source: `docs/design/handoffs/2026-10-cards/Card Locker.dc.html` and `README.md` §2.

## Context

Steps 1 (badges) and 2 (cards, all 10 themes) are done on the local branch `feat/player-cards`. The preview hero already shows the new card through `ProfileHero`'s `portrait` prop. Step 3 adds the EDIT entry point and the locker. Nothing is deployed; the live pages are not touched.

**Spec vs prototype — follow the prototype unless noted, and list these for the operator at the review:**

1. **Locked themes preview at their own tier, level 1** (prototype `previewCfg`), not tier 1 as the README text says. A locked mythic therefore shows mythic chip styling.
2. **Theme `desc` is not shown.** The prototype computes it but never renders it, and the texts are designer notes ("The current site card: …").
3. **The level note describes the real formula** ("Average progress of the best 4 skater badges toward T5 Franchise. Never goes down."), not the design's "Participation progress: GP, wins, role production."
4. **At T5 the next-tier block says T6 is awarded by the club** (D4) and shows no badge rows. The prototype would ask for "4 badges at Tier VI".
5. **No NEW tag on the rail and no new-dot on EDIT**: both need per-member "seen" state (out of scope).
6. **CLOSE instead of CANCEL**: nothing can be changed, so there is nothing to cancel.
7. **The Progress tab hides its small card on phones**: next to the card, the content column would shrink to about 80 px.
8. **History dates use the operator's zone, America/Edmonton** (the backup config's zone), formatted on the server.
9. **The primary button reads EQUIPPED on the current theme even with AUTO on** (spec); the prototype would offer "EQUIP" to pin it.
10. **New column `player_card_progress.created_at`**, folded into migration 0060 (not on live yet), so the empty history can say "History starts Oct 7, 2026."

## Global Constraints

- D1: **No equip/edit until member logins exist.** The locker ships read-only.
- D10: **EDIT is visible to everyone** and opens the locker read-only. Equip stays disabled until logins.
- D9: **The player-page hero stays exactly as it is**, except the portrait card becomes the new card and an EDIT button sits under it. The design's identity column, Card Progress button and Last-10 strip are **not** adopted.
- Spec Part 3 footer: the AUTO · FOLLOW TIER pill is shown on and disabled. The primary button is disabled: `EQUIPPED` on the current theme, `LOCKED` on locked ones, `EQUIP <NAME>` (disabled) with the caption "Equipping arrives with member logins" on unlocked ones. No toast or undo.
- Out of scope: member logins; equip/save; `player_card_prefs`; the EDIT "new" dot; equip toast/undo.
- Test run: all work on `feat/player-cards`; only the preview route `/preview/roster/[id]` changes (it `notFound()`s in production). **Live components and pages are not modified.**
- Migrations are hand-written idempotent SQL applied with `psql`; the test run uses database `eanhl_preview`; live (Hotel-Echo) only at the switch, after a fresh backup.
- Spec Part 2: "Mythic layers load only when that theme renders. Locker swatches use small static thumbnails."
- `prefers-reduced-motion`: static layers only (`PlayerCard` already enforces this).
- Design tokens (README): surfaces `#1a1819` `#1f1d1e` `#262425`, lines `#2a2829` `#3a3839`; accent `#e84131`, light `#ef6a5e`, dark `#7f1d1d`; success `#10b981`; text `#fafafa` `#d4d4d8` `#a1a1aa` `#71717a` `#6e6b6c` `#52525b`. Labels in Barlow Semi Condensed (`var(--font-condensed)`), uppercase, tracking .14–.22em; numbers `tabular-nums`; panels have radius 0; 150 ms colour/border transitions.
- Gates: typecheck (db, worker, web), web unit tests, db tests, prettier stay green. `pnpm lint` is pre-existing-red: run eslint on the touched files only.
- Never run `next build` while the dev server runs (it corrupts `apps/web/.next`). The dev server is already running on `eanhl_preview` (background task `b4k2451xl`, http://localhost:3000).

## Review Focus

1. **A player the worker has not computed yet** (no standing, no badges, no events): EDIT still opens; the locker shows T1, "0 / 4 BADGES", six locked rows and "No card history yet." — pinned by the `no standing yet` test in Task 2.
2. **A goalie-pool player** (#12 Pratt2016): the requirement and rows use the 6 goalie families, never skater totals — pinned by the `goalie pool` test in Task 2.
3. **T5 and T6 players**: no "4 badges at Tier VI" requirement, no badge rows, and no duplicated "awarded" note on locked mythics — pinned by the `T5 and T6` test in Task 2.
4. **Phone width (390 px)**: the drawer fits without sideways page scroll, the swatch rail scrolls inside itself, the footer wraps — pinned by the 390 px browser check in Tasks 4 and 5.
5. **Keyboard only**: Esc closes and focus returns to EDIT; Tab never leaves the drawer; ←/→ browse themes; the page scrolls again after closing — pinned by the keyboard browser check in Task 4.

---

## File Structure

| File                                                               | Responsibility                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/db/migrations/0060_player_card_progression.sql` (modify) | Adds `created_at` to `player_card_progress` (in the CREATE and as an idempotent ALTER). |
| `packages/db/src/schema/player-card-progression.ts` (modify)       | Drizzle mirror of `created_at`.                                                         |
| `packages/db/src/queries/cards.ts` (modify)                        | `standing.trackedSince` in `getPlayerCardProgress`.                                     |
| `apps/web/src/components/cards/locker-model.ts` (create)           | Pure locker view model: themes, requirement, rows, track, history, preview card.        |
| `apps/web/src/components/cards/locker-model.test.ts` (create)      | Its tests.                                                                              |
| `docs/design/handoffs/2026-10-cards/make-card-thumbs.sh` (create)  | Builds the 5 swatch thumbnails from the shipped textures.                               |
| `docs/design/handoffs/2026-10-cards/make-card-assets.sh` (modify)  | Calls the thumbnail script at the end.                                                  |
| `apps/web/public/images/cards/thumb-*.webp` (create, 5 files)      | Swatch thumbnails.                                                                      |
| `apps/web/src/components/cards/card-assets.ts` (modify)            | `thumb` per mythic, `swatchThumb()`.                                                    |
| `apps/web/src/components/cards/card-assets.test.ts` (modify)       | Thumbnails listed, budgeted and small.                                                  |
| `apps/web/src/components/cards/card-style.ts` (modify)             | `swatchStyle()`.                                                                        |
| `apps/web/src/components/cards/card-style.test.ts` (modify)        | Swatch tests.                                                                           |
| `apps/web/src/components/cards/hero-card.tsx` (create)             | Client: hero card + EDIT button + locker open state.                                    |
| `apps/web/src/components/cards/card-locker.tsx` (create)           | Client: drawer shell (portal, header, tabs, keys, focus, scroll lock).                  |
| `apps/web/src/components/cards/locker-theme-tab.tsx` (create)      | Client: Theme tab (preview, info, requirement, rail) and its footer.                    |
| `apps/web/src/components/cards/locker-progress-tab.tsx` (create)   | Progress tab (level, requirement + rows, tier track, history).                          |
| `apps/web/src/components/cards/card-locker.css` (create)           | All locker and EDIT styles (`.clk-*`).                                                  |
| `apps/web/src/app/preview/roster/[id]/page.tsx` (modify)           | Builds the locker view; passes `<HeroCard>` as the portrait.                            |

---

### Task 1: When each player's card history starts

**Files:**

- Modify: `packages/db/migrations/0060_player_card_progression.sql`
- Modify: `packages/db/src/schema/player-card-progression.ts`
- Modify: `packages/db/src/queries/cards.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `PlayerCardProgress['standing']` gains `trackedSince: Date` (the row's `created_at`). The worker and `card-mythic` upserts never set or update it, so it keeps the first-computed time.

- [ ] **Step 1: Add the column to migration 0060**

In `packages/db/migrations/0060_player_card_progression.sql`, inside `CREATE TABLE IF NOT EXISTS "player_card_progress"`, after the `"updated_at"` line add:

```sql
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
```

Directly after that `CREATE TABLE … ;` statement add:

```sql
-- created_at: when this player's card history began (the locker's "History starts …").
-- Set once by the DEFAULT; the worker and card-mythic upserts never update it.
-- Added during the test run (step 3): a no-op where the CREATE above already made it.
ALTER TABLE "player_card_progress"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();
```

- [ ] **Step 2: Mirror it in Drizzle**

In `packages/db/src/schema/player-card-progression.ts`, in `playerCardProgress`, after `updatedAt` add:

```ts
  /** When this player's card history began; never updated after the first insert. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 3: Return it from the query**

In `packages/db/src/queries/cards.ts`, add to the `standing` type (after `computedAt: Date`):

```ts
/** When the worker first computed this player: the card history starts here. */
trackedSince: Date
```

and in the returned object (after `computedAt: s.computedAt,`):

```ts
            trackedSince: s.createdAt,
```

- [ ] **Step 4: Build and typecheck**

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/db typecheck && pnpm --filter @eanhl/worker typecheck && pnpm --filter web typecheck`
Expected: all exit 0.

- [ ] **Step 5: Apply to the preview database**

Run:

```bash
docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
  eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -v ON_ERROR_STOP=1 -f - \
  < packages/db/migrations/0060_player_card_progression.sql
```

Expected: `BEGIN … ALTER TABLE … COMMIT` and the row-count table (progress rows unchanged).

- [ ] **Step 6: Prove a recompute leaves `created_at` alone**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' apps/web/.env.local | cut -d= -f2- | sed 's#/eanhl$#/eanhl_preview#')"
case "$DATABASE_URL" in */eanhl_preview) echo OK-preview-db ;; *) echo "WRONG DATABASE"; exit 1 ;; esac
pnpm --filter @eanhl/worker build && pnpm --filter worker card-recompute
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -c \
  "SELECT count(*) AS rows, count(*) FILTER (WHERE created_at < computed_at) AS older FROM player_card_progress;"
```

Expected: `OK-preview-db`; the recompute prints the tier table with 0 events; `rows` = `older` (every `created_at` predates the new `computed_at`).

- [ ] **Step 7: Run the db tests and commit**

Run: `pnpm --filter @eanhl/db test` — expected PASS (the `dist/queries/__tests__` gap is known; no card query tests live there).

```bash
git add packages/db/migrations/0060_player_card_progression.sql packages/db/src/schema/player-card-progression.ts packages/db/src/queries/cards.ts
git commit -m "feat(db): record when each player's card history starts"
```

---

### Task 2: Locker view model

**Files:**

- Create: `apps/web/src/components/cards/locker-model.ts`
- Test: `apps/web/src/components/cards/locker-model.test.ts`

**Interfaces:**

- Consumes: `@eanhl/db/cards` (`BADGE_FAMILIES`, `BADGE_GROUPS`, `CARD_THEME_NAMES`, `CARD_THEME_ORDER`, `FAMILIES_PER_TIER`, `TIER_LABELS`, `TIER_THEME`, `poolOf`, `themeTier`, `tierBar`, types); `badgeVisual` from `../badges/badge-board.ts`; type `CardViewModel` from `./card-model`.
- Produces (used by Tasks 4–5 and the page):
  - `LOCKER_TIME_ZONE = 'America/Edmonton'`
  - `interface LockerInput { name: string; tier: CardTier; level: number; equipped: CardThemeKey; pool: TierPool | 'manual' | null; badges: readonly { familyId: BadgeFamilyId; level: number }[]; events: readonly LockerEventInput[]; trackedSince: Date | null }`
  - `type ThemeStatus = 'locked' | 'equipped' | 'unlocked'`
  - `interface LockerTheme { key; name; short; tier: CardTier; status: ThemeStatus; tag: string; action: string; unlockNote: string | null }`
  - `interface LockerRequirement { title: string; count: string; pct: number | null; note: string }`
  - `interface LockerBadgeRow { familyId; short; shape: BadgeShapeId; theme: CardThemeKey; locked: boolean; done: boolean; pct: number; value: string }`
  - `interface LockerTrackStep { tier: CardTier; label: string; theme: string; note: string | null; state: 'done' | 'now' | 'next' }`
  - `interface LockerHistoryItem { date: string; text: string }`
  - `interface LockerView { subline; tierLabel; level; levelNote; unlockedCount; themes; requirement; rows; track; history; historyEmpty }`
  - `buildLockerView(input: LockerInput, timeZone?: string): LockerView`
  - `lockerPreviewCard(card: CardViewModel, theme: LockerTheme): CardViewModel`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/cards/locker-model.test.ts`:

```ts
/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/cards/locker-model.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { BadgeFamilyId } from '@eanhl/db/cards'
import { buildLockerView, lockerPreviewCard, type LockerInput } from './locker-model.ts'
import type { CardViewModel } from './card-model.ts'

const levels = (l: Partial<Record<BadgeFamilyId, number>>) =>
  Object.entries(l).map(([familyId, level]) => ({ familyId: familyId as BadgeFamilyId, level }))

/** #3 Stick Menace on the preview database: T4 L6, skater pool. */
const igor: LockerInput = {
  name: 'Igor Orlov',
  tier: 4,
  level: 6,
  equipped: 'carbon',
  pool: 'skater',
  badges: levels({
    pbrk: 28,
    pfo: 18,
    pfight: 17,
    pdekes: 17,
    pht: 17,
    pgoals: 15,
    pwins: 15,
    pshots: 14,
  }),
  events: [],
  trackedSince: new Date('2026-10-07T18:00:00Z'),
}

void test('themes: equipped, unlocked and locked tags and actions', () => {
  const v = buildLockerView(igor)
  const byKey = Object.fromEntries(v.themes.map((t) => [t.key, t]))
  assert.equal(v.themes.length, 10)
  assert.deepEqual([byKey.away?.tag, byKey.away?.action], ['T1 · UNLOCKED', 'EQUIP AWAY'])
  assert.deepEqual(
    [byKey.carbon?.tag, byKey.carbon?.action, byKey.carbon?.status],
    ['T4 · EQUIPPED (AUTO)', 'EQUIPPED', 'equipped'],
  )
  assert.deepEqual(
    [byKey.futureB?.tag, byKey.futureB?.action, byKey.futureB?.unlockNote],
    ['T5 · LOCKED · PREVIEW', 'LOCKED', null],
  )
  assert.equal(byKey.frozen?.unlockNote, 'Frozen is a T6 mythic, awarded by the club.')
  assert.equal(byKey.stormLive?.short, 'STORM')
  assert.equal(v.unlockedCount, 4)
})

void test('a locked theme two or more tiers away names its tier', () => {
  const v = buildLockerView({ ...igor, tier: 2, equipped: 'home' })
  const byKey = Object.fromEntries(v.themes.map((t) => [t.key, t]))
  assert.equal(byKey.alternate?.unlockNote, null)
  assert.equal(byKey.carbon?.unlockNote, 'Carbon-Fiber unlocks at T4 Elite.')
})

void test('skater pool: requirement counts families at the next bar', () => {
  const v = buildLockerView(igor)
  assert.deepEqual(v.requirement, {
    title: 'NEXT · T5 FRANCHISE',
    count: '1 / 4 BADGES',
    pct: 25,
    note: '4 skater badges at Tier V (LVL 21+).',
  })
})

void test('rows: top 6 of the pool by level, catalog order on ties, DONE at the bar', () => {
  const v = buildLockerView(igor)
  assert.deepEqual(
    v.rows.map((r) => r.short),
    ['BREAKAWAYS', 'FACEOFFS', 'DEKES', 'HAT TRICKS', 'FIGHTS', 'WINS'],
  )
  assert.deepEqual(
    v.rows.map((r) => r.value),
    ['DONE', 'LVL 18/21', 'LVL 17/21', 'LVL 17/21', 'LVL 17/21', 'LVL 15/21'],
  )
  assert.deepEqual(
    v.rows.map((r) => r.pct),
    [100, 86, 81, 81, 81, 71],
  )
  assert.equal(v.rows[0]?.done, true)
  assert.equal(v.rows[0]?.shape, 'round')
  assert.equal(v.rows[0]?.theme, 'olympus') // level 28 → theme index ceil(28/3)−1 = 9
})

void test('goalie pool: requirement and rows use the 6 goalie families only', () => {
  const v = buildLockerView({
    ...igor,
    tier: 2,
    level: 8,
    equipped: 'home',
    pool: 'goalie',
    badges: levels({ gg: 12, gw: 11, gsv: 15, gdsv: 3, gso: 2, gpoke: 0, pgoals: 30, pbrk: 30 }),
  })
  assert.deepEqual(v.requirement, {
    title: 'NEXT · T3 STUD',
    count: '3 / 4 BADGES',
    pct: 75,
    note: '4 goalie badges at Tier III (LVL 11+).',
  })
  assert.deepEqual(
    v.rows.map((r) => [r.short, r.value]),
    [
      ['SAVES', 'DONE'],
      ['STARTS', 'DONE'],
      ['G WINS', 'DONE'],
      ['DESPERATION', 'LVL 3/11'],
      ['SHUTOUTS', 'LVL 2/11'],
      ['POKE CHECKS', 'LVL 0/11'],
    ],
  )
  assert.equal(v.rows[5]?.locked, true)
})

void test('T5 and T6: no stat requirement, no rows, no repeated awarded note', () => {
  const t5 = buildLockerView({ ...igor, tier: 5, level: 10, equipped: 'futureB' })
  assert.deepEqual(t5.requirement, {
    title: 'NEXT · T6 LEGEND',
    count: 'AWARDED',
    pct: null,
    note: 'T6 mythic cards are awarded by the club, not earned from stats.',
  })
  assert.deepEqual(t5.rows, [])
  assert.equal(t5.themes.find((t) => t.key === 'inferno')?.unlockNote, null)
  assert.equal(t5.levelNote, 'Top tier from stats. Level stays full.')

  const t6 = buildLockerView({ ...igor, tier: 6, level: 10, equipped: 'stormLive', pool: 'manual' })
  assert.deepEqual(t6.requirement, {
    title: 'T6 LEGEND · MAX TIER',
    count: 'COMPLETE',
    pct: 100,
    note: 'All themes unlocked.',
  })
  assert.deepEqual(t6.rows, [])
  assert.equal(t6.unlockedCount, 10)
  assert.equal(t6.themes.filter((t) => t.status === 'locked').length, 0)
  assert.equal(t6.themes.find((t) => t.key === 'stormLive')?.status, 'equipped')
})

void test('no standing yet: T1, nothing earned, no history', () => {
  const v = buildLockerView({
    name: 'Utiz23',
    tier: 1,
    level: 1,
    equipped: 'away',
    pool: null,
    badges: [],
    events: [],
    trackedSince: null,
  })
  assert.equal(v.requirement.count, '0 / 4 BADGES')
  assert.equal(v.requirement.note, '4 skater badges at Tier II (LVL 6+).')
  assert.equal(v.rows.length, 6)
  assert.ok(v.rows.every((r) => r.locked && r.value === 'LVL 0/6'))
  assert.deepEqual(v.history, [])
  assert.equal(v.historyEmpty, 'No card history yet.')
  assert.equal(v.unlockedCount, 1)
})

void test('history: newest-first lines with dates in the operator zone', () => {
  const v = buildLockerView({
    ...igor,
    events: [
      {
        kind: 'mythic_cleared',
        familyId: null,
        fromValue: 6,
        toValue: 4,
        occurredAt: new Date('2026-10-06T18:00:00Z'),
      },
      {
        kind: 'mythic_awarded',
        familyId: null,
        fromValue: 4,
        toValue: 6,
        occurredAt: new Date('2026-10-05T18:00:00Z'),
      },
      {
        kind: 'tier_up',
        familyId: null,
        fromValue: 3,
        toValue: 4,
        occurredAt: new Date('2026-10-04T03:00:00Z'),
      },
      {
        kind: 'level_up',
        familyId: null,
        fromValue: 5,
        toValue: 6,
        occurredAt: new Date('2026-09-28T18:00:00Z'),
      },
      {
        kind: 'badge_level_up',
        familyId: 'pgoals',
        fromValue: 15,
        toValue: 16,
        occurredAt: new Date('2026-09-02T18:00:00Z'),
      },
    ],
  })
  assert.deepEqual(v.history, [
    { date: 'OCT 06', text: 'Mythic cleared · back to T4' },
    { date: 'OCT 05', text: 'T6 Legend · Mythic card awarded' },
    { date: 'OCT 03', text: 'T4 Elite · Carbon-Fiber unlocked' }, // 03:00 UTC = Oct 3, 21:00 in Edmonton
    { date: 'SEP 28', text: 'Level 6 reached' },
    { date: 'SEP 02', text: 'Goals · Level 16' },
  ])
  assert.equal(buildLockerView(igor).historyEmpty, 'History starts Oct 7, 2026.')
})

void test('header strings, level note and tier track', () => {
  const v = buildLockerView(igor)
  assert.equal(v.subline, 'IGOR ORLOV · T4 ELITE · LVL 6/10 · 4 / 10 THEMES')
  assert.equal(v.tierLabel, 'ELITE')
  assert.equal(v.level, 6)
  assert.equal(
    v.levelNote,
    'Average progress of the best 4 skater badges toward T5 Franchise. Never goes down.',
  )
  assert.deepEqual(
    v.track.map((s) => [s.tier, s.label, s.theme, s.note, s.state]),
    [
      [1, 'PROSPECT', 'AWAY', null, 'done'],
      [2, 'ROOKIE', 'HOME', null, 'done'],
      [3, 'STUD', 'ALTERNATE', null, 'done'],
      [4, 'ELITE', 'CARBON-FIBER', null, 'now'],
      [5, 'FRANCHISE', 'HARDLIGHT', null, 'next'],
      [6, 'LEGEND', '5 MYTHICS', 'AWARDED', 'next'],
    ],
  )
})

void test('preview card: locked themes at their own tier and level 1, front only', () => {
  const card = {
    front: { tier: 4, level: 6, theme: 'carbon' },
    back: { source: 'x' },
  } as unknown as CardViewModel
  const v = buildLockerView(igor)
  const frozen = v.themes.find((t) => t.key === 'frozen')
  const away = v.themes.find((t) => t.key === 'away')
  assert.ok(frozen && away)
  const locked = lockerPreviewCard(card, frozen)
  assert.deepEqual([locked.front.theme, locked.front.tier, locked.front.level], ['frozen', 6, 1])
  assert.equal(locked.back, null)
  const open = lockerPreviewCard(card, away)
  assert.deepEqual([open.front.theme, open.front.tier, open.front.level], ['away', 4, 6])
})
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `pnpm --filter @eanhl/db build && node --test apps/web/src/components/cards/locker-model.test.ts`
Expected: FAIL — cannot find module `./locker-model.ts`.

- [ ] **Step 3: Implement the model**

Create `apps/web/src/components/cards/locker-model.ts`:

```ts
/**
 * Card Locker view model (Card Locker.dc.html renderVals; spec Part 3). Pure:
 * the page builds it on the server, so dates are formatted once with a fixed
 * zone and locale and the client renders strings only. Read-only until member
 * logins exist (D1/D10): every theme's action is shown but never enabled.
 */
import {
  BADGE_FAMILIES,
  BADGE_GROUPS,
  CARD_THEME_NAMES,
  CARD_THEME_ORDER,
  FAMILIES_PER_TIER,
  TIER_LABELS,
  TIER_THEME,
  poolOf,
  themeTier,
  tierBar,
} from '@eanhl/db/cards'
import type {
  BadgeFamilyId,
  BadgeShapeId,
  CardEventKind,
  CardThemeKey,
  CardTier,
  StatsTier,
  TierPool,
} from '@eanhl/db/cards'
import { badgeVisual } from '../badges/badge-board.ts'
import type { CardViewModel } from './card-model'

/** The operator's zone (docker-compose BACKUP_TZ default): history dates read as local days. */
export const LOCKER_TIME_ZONE = 'America/Edmonton'

/** Rail labels (Card Locker.dc.html SHORT). */
const THEME_SHORT: Readonly<Record<CardThemeKey, string>> = {
  away: 'AWAY',
  home: 'HOME',
  alternate: 'ALT',
  carbon: 'CARBON',
  futureB: 'HARDLIGHT',
  frozen: 'FROZEN',
  futureC: 'CYBER',
  inferno: 'INFERNO',
  stormLive: 'STORM',
  olympus: 'MAXIMUS',
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const
const ROW_COUNT = 6
const TIERS: readonly CardTier[] = [1, 2, 3, 4, 5, 6]

export interface LockerEventInput {
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
  occurredAt: Date
}

export interface LockerInput {
  /** Card name (real name, else gamertag). */
  name: string
  /** What the card shows (the preview's URL params may override the stored standing). */
  tier: CardTier
  level: number
  equipped: CardThemeKey
  /** Pool that set the tier; null before the worker's first recompute. */
  pool: TierPool | 'manual' | null
  badges: readonly { familyId: BadgeFamilyId; level: number }[]
  /** Newest first (getPlayerCardProgress order). */
  events: readonly LockerEventInput[]
  /** When the card history began; null before the first recompute. */
  trackedSince: Date | null
}

export type ThemeStatus = 'locked' | 'equipped' | 'unlocked'

export interface LockerTheme {
  key: CardThemeKey
  name: string
  short: string
  tier: CardTier
  status: ThemeStatus
  /** 'T6 · LOCKED · PREVIEW' | 'T4 · EQUIPPED (AUTO)' | 'T2 · UNLOCKED' */
  tag: string
  /** Primary button label; the button stays disabled until logins. */
  action: string
  /** Extra sentence for a locked theme's requirement block, or null. */
  unlockNote: string | null
}

export interface LockerRequirement {
  title: string
  count: string
  /** Bar fill 0–100, or null when no bar applies (T6 is awarded, not earned). */
  pct: number | null
  note: string
}

export interface LockerBadgeRow {
  familyId: BadgeFamilyId
  short: string
  shape: BadgeShapeId
  /** Badge look by level (level 0 drawn as level 1 and dimmed by the caller). */
  theme: CardThemeKey
  locked: boolean
  done: boolean
  pct: number
  value: string
}

export interface LockerTrackStep {
  tier: CardTier
  label: string
  theme: string
  note: string | null
  state: 'done' | 'now' | 'next'
}

export interface LockerHistoryItem {
  date: string
  text: string
}

export interface LockerView {
  /** 'IGOR ORLOV · T4 ELITE · LVL 6/10 · 4 / 10 THEMES' */
  subline: string
  tierLabel: string
  level: number
  levelNote: string
  unlockedCount: number
  themes: LockerTheme[]
  requirement: LockerRequirement
  rows: LockerBadgeRow[]
  track: LockerTrackStep[]
  history: LockerHistoryItem[]
  /** Shown when history is empty. */
  historyEmpty: string
}

const upper = (s: string) => s.toUpperCase()
const tierName = (t: CardTier) => `T${String(t)} ${TIER_LABELS[t]}`
const clampTier = (n: number) => Math.min(6, Math.max(1, Math.round(n))) as CardTier

function poolFamilies(pool: TierPool) {
  return BADGE_FAMILIES.filter((f) => poolOf(f) === pool)
}

function buildRequirement(
  tier: CardTier,
  pool: TierPool,
  levels: ReadonlyMap<BadgeFamilyId, number>,
): LockerRequirement {
  if (tier === 6) {
    return {
      title: `T6 ${upper(TIER_LABELS[6])} · MAX TIER`,
      count: 'COMPLETE',
      pct: 100,
      note: 'All themes unlocked.',
    }
  }
  if (tier === 5) {
    return {
      title: `NEXT · T6 ${upper(TIER_LABELS[6])}`,
      count: 'AWARDED',
      pct: null,
      note: 'T6 mythic cards are awarded by the club, not earned from stats.',
    }
  }
  const next = clampTier(tier + 1)
  const bar = tierBar(next)
  const met = poolFamilies(pool).filter((f) => (levels.get(f.id) ?? 0) >= bar).length
  const shown = Math.min(met, FAMILIES_PER_TIER)
  return {
    title: `NEXT · ${upper(tierName(next))}`,
    count: `${String(shown)} / ${String(FAMILIES_PER_TIER)} BADGES`,
    pct: Math.round((shown / FAMILIES_PER_TIER) * 100),
    note: `${String(FAMILIES_PER_TIER)} ${pool} badges at Tier ${ROMAN[next - 1] ?? ''} (LVL ${String(bar)}+).`,
  }
}

function buildRows(
  tier: CardTier,
  pool: TierPool,
  levels: ReadonlyMap<BadgeFamilyId, number>,
): LockerBadgeRow[] {
  if (tier >= 5) return []
  const bar = tierBar(tier + 1)
  // BADGE_FAMILIES is in catalog order and sort is stable, so ties keep catalog order.
  return poolFamilies(pool)
    .map((f) => ({ f, level: levels.get(f.id) ?? 0 }))
    .sort((a, b) => b.level - a.level)
    .slice(0, ROW_COUNT)
    .map(({ f, level }) => {
      const done = level >= bar
      return {
        familyId: f.id,
        short: f.short,
        shape: BADGE_GROUPS.find((g) => g.id === f.group)?.shape ?? 'hex',
        theme: badgeVisual(level).theme,
        locked: level === 0,
        done,
        pct: Math.min(100, Math.round((level / bar) * 100)),
        value: done ? 'DONE' : `LVL ${String(level)}/${String(bar)}`,
      }
    })
}

function unlockNote(name: string, themeT: CardTier, tier: CardTier): string | null {
  if (themeT === 6) return tier === 5 ? null : `${name} is a T6 mythic, awarded by the club.`
  return themeT > tier + 1 ? `${name} unlocks at ${tierName(themeT)}.` : null
}

function buildThemes(tier: CardTier, equipped: CardThemeKey): LockerTheme[] {
  return CARD_THEME_ORDER.map((key) => {
    const t = themeTier(key)
    const name = CARD_THEME_NAMES[key]
    const status: ThemeStatus = key === equipped ? 'equipped' : t > tier ? 'locked' : 'unlocked'
    const state =
      status === 'locked'
        ? 'LOCKED · PREVIEW'
        : status === 'equipped'
          ? 'EQUIPPED (AUTO)'
          : 'UNLOCKED'
    return {
      key,
      name,
      short: THEME_SHORT[key],
      tier: t,
      status,
      tag: `T${String(t)} · ${state}`,
      action:
        status === 'locked'
          ? 'LOCKED'
          : status === 'equipped'
            ? 'EQUIPPED'
            : `EQUIP ${upper(name)}`,
      unlockNote: status === 'locked' ? unlockNote(name, t, tier) : null,
    }
  })
}

function describeEvent(e: LockerEventInput): string {
  switch (e.kind) {
    case 'tier_up': {
      const to = clampTier(e.toValue)
      const theme = to === 6 ? 'Mythic' : CARD_THEME_NAMES[TIER_THEME[to as StatsTier]]
      return `${tierName(to)} · ${theme} unlocked`
    }
    case 'level_up':
      return `Level ${String(e.toValue)} reached`
    case 'badge_level_up': {
      const family = BADGE_FAMILIES.find((f) => f.id === e.familyId)
      return `${family?.name ?? 'Badge'} · Level ${String(e.toValue)}`
    }
    case 'mythic_awarded':
      return `${tierName(6)} · Mythic card awarded`
    case 'mythic_cleared':
      return `Mythic cleared · back to T${String(e.toValue)}`
  }
}

export function buildLockerView(input: LockerInput, timeZone = LOCKER_TIME_ZONE): LockerView {
  const { tier, level } = input
  const pool: TierPool = input.pool === 'goalie' ? 'goalie' : 'skater'
  const levels = new Map(input.badges.map((b) => [b.familyId, b.level]))
  const themes = buildThemes(tier, input.equipped)
  const unlockedCount = CARD_THEME_ORDER.filter((k) => themeTier(k) <= tier).length
  const chip = `${upper(tierName(tier))} · LVL ${String(level)}/10`
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone })
  const longFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  })
  const next = clampTier(tier + 1)
  return {
    subline: `${upper(input.name)} · ${chip} · ${String(unlockedCount)} / 10 THEMES`,
    tierLabel: upper(TIER_LABELS[tier]),
    level,
    levelNote:
      tier === 6
        ? 'Top tier. Level stays full.'
        : tier === 5
          ? 'Top tier from stats. Level stays full.'
          : `Average progress of the best ${String(FAMILIES_PER_TIER)} ${pool} badges toward ${tierName(next)}. Never goes down.`,
    unlockedCount,
    themes,
    requirement: buildRequirement(tier, pool, levels),
    rows: buildRows(tier, pool, levels),
    track: TIERS.map((n) => ({
      tier: n,
      label: upper(TIER_LABELS[n]),
      theme: n === 6 ? '5 MYTHICS' : upper(CARD_THEME_NAMES[TIER_THEME[n as StatsTier]]),
      note: n === 6 ? 'AWARDED' : null,
      state: n < tier ? 'done' : n === tier ? 'now' : 'next',
    })),
    history: input.events.map((e) => ({
      date: upper(dayFmt.format(e.occurredAt)),
      text: describeEvent(e),
    })),
    historyEmpty:
      input.trackedSince === null
        ? 'No card history yet.'
        : `History starts ${longFmt.format(input.trackedSince)}.`,
  }
}

/**
 * The browsed theme on this player's card (prototype previewCfg): a locked
 * theme shows at its own tier and level 1; an unlocked one at the player's.
 * Front only: the preview never flips.
 */
export function lockerPreviewCard(card: CardViewModel, theme: LockerTheme): CardViewModel {
  const locked = theme.status === 'locked'
  return {
    back: null,
    front: {
      ...card.front,
      theme: theme.key,
      tier: locked ? theme.tier : card.front.tier,
      level: locked ? 1 : card.front.level,
    },
  }
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --test apps/web/src/components/cards/locker-model.test.ts`
Expected: PASS, 10/10.

- [ ] **Step 5: Typecheck, lint, format**

Run:

```bash
pnpm --filter web typecheck
pnpm --filter web exec eslint src/components/cards/locker-model.ts src/components/cards/locker-model.test.ts
pnpm exec prettier --write apps/web/src/components/cards/locker-model.ts apps/web/src/components/cards/locker-model.test.ts
```

Expected: typecheck and eslint exit 0; prettier only reflows (rerun the test if it changed anything).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/cards/locker-model.ts apps/web/src/components/cards/locker-model.test.ts
git commit -m "feat(web): card locker view model"
```

---

### Task 3: Swatch thumbnails and swatch style

**Files:**

- Create: `docs/design/handoffs/2026-10-cards/make-card-thumbs.sh`
- Modify: `docs/design/handoffs/2026-10-cards/make-card-assets.sh` (last lines)
- Create: `apps/web/public/images/cards/thumb-{frozen,futureC,inferno,stormLive,olympus}.webp`
- Modify: `apps/web/src/components/cards/card-assets.ts`, `card-assets.test.ts`
- Modify: `apps/web/src/components/cards/card-style.ts`, `card-style.test.ts`

**Interfaces:**

- Consumes: `CARD_THEMES` (`card-themes.ts`), `CardTheme` type.
- Produces:
  - `MythicAssets.thumb: string` (file name)
  - `swatchThumb(theme: CardThemeKey): string | null` in `card-assets.ts` — public URL, null for the CSS-only themes
  - `swatchStyle(th: CardTheme, thumb: string | null): { background: string; border: string }` in `card-style.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/cards/card-assets.test.ts`:

- change the import to `import { CARD_ASSET_DIR, MYTHIC_ASSETS, VIDEO_FORMATS, swatchThumb } from './card-assets.ts'` and add `import type { MythicThemeKey } from '@eanhl/db/cards'`;
- in the first test, build `listed` from `[...a.stills, a.thumb, ...a.videos.flatMap(videoFiles)]`;
- in the budget test, add `size(a.thumb) +` to `bytes`;
- append:

```ts
void test('locker swatch thumbnails are small and resolve to their files', () => {
  for (const [theme, a] of Object.entries(MYTHIC_ASSETS)) {
    assert.ok(size(a.thumb) <= 8 * 1024, `${theme}: ${String(size(a.thumb))} bytes`)
    assert.equal(swatchThumb(theme as MythicThemeKey), `${CARD_ASSET_DIR}/${a.thumb}`)
  }
  assert.equal(swatchThumb('home'), null)
})
```

In `apps/web/src/components/cards/card-style.test.ts`, change the imports to

```ts
import { MYTHIC_THEMES } from '@eanhl/db/cards'
import { CARD_THEMES } from './card-themes.ts'
import { cardLook, resolveFx, swatchStyle } from './card-style.ts'
import { swatchThumb } from './card-assets.ts'
```

and append:

```ts
void test('swatches: rims keep their boxes, plain themes their border', () => {
  const frozen = swatchStyle(CARD_THEMES.frozen, '/images/cards/thumb-frozen.webp')
  assert.ok(frozen.background.endsWith(`${String(CARD_THEMES.frozen.grad)} border-box`))
  assert.equal(frozen.border, '1px solid transparent')
  const home = swatchStyle(CARD_THEMES.home, null)
  assert.equal(home.background, CARD_THEMES.home.layers.join(', '))
  assert.equal(home.border, `1px solid ${String(CARD_THEMES.home.border)}`)
})

void test('mythic swatches load only their thumbnail, never the full still', () => {
  for (const key of MYTHIC_THEMES) {
    const s = swatchStyle(CARD_THEMES[key], swatchThumb(key))
    assert.deepEqual(s.background.match(/\/images\/cards\/[\w.-]+/g), [
      `/images/cards/thumb-${key}.webp`,
    ])
  }
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test apps/web/src/components/cards/card-assets.test.ts apps/web/src/components/cards/card-style.test.ts`
Expected: FAIL — `swatchThumb` / `swatchStyle` are not exported.

- [ ] **Step 3: Write the thumbnail script and build the thumbnails**

Create `docs/design/handoffs/2026-10-cards/make-card-thumbs.sh`:

```bash
#!/usr/bin/env bash
# Card Locker swatch thumbnails (spec Part 2: "Locker swatches use small static
# thumbnails"): each mythic's main texture at 2× the 50×68 swatch. Aspect is
# kept, so the swatch's own cover/position crop matches the card's.
# Usage (repo root; reads the textures make-card-assets.sh already shipped):
#   bash docs/design/handoffs/2026-10-cards/make-card-thumbs.sh
set -euo pipefail

OUT=apps/web/public/images/cards
while read -r key tex; do
  ffmpeg -v error -y -i "$OUT/$tex" \
    -vf "scale=100:136:force_original_aspect_ratio=increase:flags=lanczos" \
    -frames:v 1 -c:v libwebp -quality 70 "$OUT/thumb-$key.webp"
done <<'EOF'
frozen tex-ice-glacier.webp
futureC tex-future-circuit.webp
inferno tex-inferno-gate.webp
stormLive tex-storm-clouds.webp
olympus tex-olympus-temple.webp
EOF
ls -l "$OUT"/thumb-*.webp
```

In `make-card-assets.sh`, replace the final `ls -l "$OUT"` with:

```bash
bash "$(dirname "$0")/make-card-thumbs.sh"
ls -l "$OUT"
```

Run: `bash docs/design/handoffs/2026-10-cards/make-card-thumbs.sh`
Expected: five `thumb-*.webp` files, each a few KB.

- [ ] **Step 4: Implement `thumb`, `swatchThumb` and `swatchStyle`**

In `apps/web/src/components/cards/card-assets.ts`:

- change the type import to `import type { CardThemeKey, MythicThemeKey } from '@eanhl/db/cards'`;
- add to `MythicAssets`:

```ts
/** Locker swatch thumbnail of the main texture (make-card-thumbs.sh). */
thumb: string
```

- add `thumb: 'thumb-<key>.webp'` to each entry, e.g. `frozen: { stills: […], videos: [], thumb: 'thumb-frozen.webp' }` (keys `frozen`, `futureC`, `inferno`, `stormLive`, `olympus`);
- append:

```ts
/** Locker swatch thumbnail URL; null for the CSS-only themes (T1–T5). */
export function swatchThumb(theme: CardThemeKey): string | null {
  const assets = (MYTHIC_ASSETS as Partial<Record<CardThemeKey, MythicAssets>>)[theme]
  return assets === undefined ? null : cardAsset(assets.thumb)
}
```

In `apps/web/src/components/cards/card-style.ts`, append:

```ts
const CARD_URL = /url\('\/images\/cards\/[^']+'\)/

/**
 * Locker rail swatch (Card Locker.dc.html rail): the theme's background layers
 * and rim on a 50×68 tile. A mythic's texture layer swaps to its thumbnail, so
 * opening the locker never pulls the full-size stills.
 */
export function swatchStyle(
  th: CardTheme,
  thumb: string | null,
): { background: string; border: string } {
  const layers =
    thumb === null ? th.layers : th.layers.map((l) => l.replace(CARD_URL, `url('${thumb}')`))
  if (th.grad !== null) {
    return {
      background: [...layers.map((l) => `${l} padding-box`), `${th.grad} border-box`].join(', '),
      border: '1px solid transparent',
    }
  }
  return { background: layers.join(', '), border: `1px solid ${th.border ?? '#3a3839'}` }
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `node --test apps/web/src/components/cards/card-assets.test.ts apps/web/src/components/cards/card-style.test.ts`
Expected: PASS (card-assets 5/5, card-style all green).

- [ ] **Step 6: Gates and commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec eslint src/components/cards/card-assets.ts src/components/cards/card-assets.test.ts src/components/cards/card-style.ts src/components/cards/card-style.test.ts
pnpm exec prettier --write apps/web/src/components/cards/card-assets.ts apps/web/src/components/cards/card-assets.test.ts apps/web/src/components/cards/card-style.ts apps/web/src/components/cards/card-style.test.ts
pnpm --filter web test:unit
git add docs/design/handoffs/2026-10-cards/make-card-thumbs.sh docs/design/handoffs/2026-10-cards/make-card-assets.sh apps/web/public/images/cards/thumb-*.webp apps/web/src/components/cards/card-assets.ts apps/web/src/components/cards/card-assets.test.ts apps/web/src/components/cards/card-style.ts apps/web/src/components/cards/card-style.test.ts
git commit -m "feat(web): locker swatch thumbnails and swatch style"
```

Expected: every command exits 0.

---

### Task 4: EDIT button, drawer shell and Theme tab

**Files:**

- Create: `apps/web/src/components/cards/card-locker.css`
- Create: `apps/web/src/components/cards/locker-theme-tab.tsx`
- Create: `apps/web/src/components/cards/card-locker.tsx`
- Create: `apps/web/src/components/cards/hero-card.tsx`
- Modify: `apps/web/src/app/preview/roster/[id]/page.tsx`

**Interfaces:**

- Consumes: `buildLockerView`, `lockerPreviewCard`, `LockerView`, `LockerTheme`, `LockerRequirement` (Task 2); `swatchStyle` (Task 3); `swatchThumb` (Task 3); `PlayerCard`; `CARD_THEMES`; `PlayerCardProgress['standing']['trackedSince']` (Task 1).
- Produces:
  - `HeroCard({ card: CardViewModel; locker: LockerView; initialFace?: 'front' | 'back' })`
  - `CardLocker({ card: CardViewModel; view: LockerView; onClose: () => void })`
  - `LockerThemeTab({ card, view, index: number, onSelect: (i: number) => void, onStep: (delta: number) => void })` and `LockerThemeFooter({ theme: LockerTheme; onClose: () => void })`
  - CSS classes `.clk-*` (Task 5 appends Progress-tab classes to the same file).

UI components are not unit-tested in this repo; the deliverable is checked in the browser (Step 7).

- [ ] **Step 1: Styles**

Create `apps/web/src/components/cards/card-locker.css`:

```css
/*
 * Card Locker (Card Locker.dc.html; spec Part 3): the EDIT button under the
 * hero card and the read-only drawer. Values follow the design handoff README.
 */

.clk-hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 264px;
}
.clk-edit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e84131;
  background: #1a1819;
  color: #ef6a5e;
  cursor: pointer;
  font-family: var(--font-condensed);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  transition:
    background-color 150ms,
    color 150ms;
}
.clk-edit:hover {
  background: #e84131;
  color: #ffffff;
}
.clk-edit:focus-visible,
.clk-panel button:focus-visible {
  outline: 2px solid #ef6a5e;
  outline-offset: 2px;
}

/* ── Overlay ─────────────────────────────────────────────────────────── */
.clk-overlay {
  position: fixed;
  inset: 0;
  z-index: 70; /* above the sticky header (50) and the nav drawer (60) */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.clk-scrim {
  position: absolute;
  inset: 0;
  background: rgba(9, 9, 11, 0.78);
}
.clk-panel {
  position: relative;
  width: 820px;
  max-width: 100%;
  max-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
  border: 1px solid #3a3839;
  background: #1f1d1e;
  overflow: hidden;
  font-family: var(--font-condensed);
  color: #fafafa;
}
.clk-topline {
  height: 1px;
  flex: none;
  background: linear-gradient(90deg, #7f1d1d, #e84131, #7f1d1d);
}
.clk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  border-bottom: 1px solid #2a2829;
}
.clk-head-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.clk-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.12em;
  line-height: 1;
  color: #fafafa;
}
.clk-sub {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2em;
  line-height: 1.3;
  color: #6e6b6c;
}
.clk-icon-btn {
  flex: none;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid #3a3839;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  transition:
    border-color 150ms,
    color 150ms;
}
.clk-icon-btn:hover {
  border-color: #71717a;
  color: #fafafa;
}
.clk-arrow {
  width: 40px;
  height: 40px;
}
.clk-tabs {
  display: flex;
  gap: 26px;
  padding: 0 22px;
  border-bottom: 1px solid #2a2829;
}
.clk-tab {
  padding: 13px 0 11px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #71717a;
}
.clk-tab[aria-pressed='true'] {
  color: #fafafa;
  box-shadow: inset 0 -2px 0 #e84131;
}
.clk-body {
  flex: 1;
  overflow-y: auto;
}
.clk-note {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.45;
  color: #71717a;
}
.clk-bar {
  display: block;
  height: 4px;
  background: #2a2829;
}
.clk-bar > span {
  display: block;
  height: 100%;
  background: #e84131;
}

/* ── Theme tab ───────────────────────────────────────────────────────── */
.clk-stage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 20px 36px;
  padding: 22px 22px 18px;
  background: radial-gradient(50% 60% at 50% 30%, rgba(232, 65, 49, 0.07), transparent 70%);
}
.clk-viewer {
  display: flex;
  align-items: center;
  gap: 28px;
}
.clk-preview {
  zoom: 0.9;
}
.clk-preview[data-locked='true'] {
  filter: saturate(0.55) brightness(0.8);
}
.clk-info {
  flex: 1;
  min-width: 240px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.clk-info-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.clk-name {
  margin: 0;
  font-size: 32px;
  font-weight: 900;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
  color: #fafafa;
}
.clk-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
}
.clk-tag[data-status='locked'] {
  color: #71717a;
}
.clk-tag[data-status='equipped'] {
  color: #e84131;
}
.clk-tag[data-status='unlocked'] {
  color: #10b981;
}
.clk-req {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(232, 65, 49, 0.35);
  background: rgba(232, 65, 49, 0.05);
}
.clk-req-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.clk-req-title {
  color: #ef6a5e;
}
.clk-req-count {
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.clk-railwrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 22px 18px;
  border-top: 1px solid #2a2829;
}
.clk-rail {
  position: relative; /* offsetLeft of each swatch is measured against the rail */
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 2px 6px;
}
.clk-swatch {
  flex: none;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
}
.clk-swatch-tile {
  display: block;
  width: 50px;
  height: 68px;
  border-radius: 5px;
}
.clk-swatch[aria-pressed='true'] .clk-swatch-tile {
  box-shadow:
    0 0 0 2px #1f1d1e,
    0 0 0 3px #e84131;
}
.clk-swatch[data-locked='true'] .clk-swatch-tile {
  opacity: 0.45;
  filter: grayscale(0.85) brightness(0.7);
}
.clk-swatch-lock {
  position: absolute;
  top: 27px;
  left: 18px;
  color: #d4d4d8;
}
.clk-swatch-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  white-space: nowrap;
  color: #a1a1aa;
}
.clk-swatch[data-locked='true'] .clk-swatch-label {
  color: #52525b;
}
.clk-swatch[aria-pressed='true'] .clk-swatch-label {
  color: #fafafa;
}
.clk-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
}
.clk-dot[data-on='true'] {
  background: #e84131;
}
.clk-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: #52525b;
}
.clk-legend-eq {
  display: flex;
  align-items: center;
  gap: 6px;
}
.clk-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 22px;
  border-top: 1px solid #2a2829;
}
.clk-auto {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid #e84131;
  background: rgba(232, 65, 49, 0.1);
  color: #ef6a5e;
  cursor: not-allowed;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.clk-auto-box {
  width: 12px;
  height: 12px;
  border: 1px solid #e84131;
  background: #e84131;
}
.clk-actions {
  display: flex;
  gap: 8px;
}
.clk-btn,
.clk-primary {
  padding: 10px 16px;
  border: 1px solid #3a3839;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  transition:
    border-color 150ms,
    color 150ms;
}
.clk-btn:hover {
  border-color: #71717a;
  color: #fafafa;
}
.clk-primary {
  padding: 10px 18px;
  font-weight: 800;
}
.clk-primary:disabled {
  color: #52525b;
  cursor: not-allowed;
}

/* ── Phones ──────────────────────────────────────────────────────────── */
@media (max-width: 639px) {
  .clk-overlay {
    padding: 12px;
  }
  .clk-panel {
    max-height: calc(100dvh - 24px);
  }
  .clk-head,
  .clk-tabs,
  .clk-railwrap,
  .clk-foot {
    padding-left: 16px;
    padding-right: 16px;
  }
  .clk-stage {
    padding: 16px;
  }
  .clk-viewer {
    gap: 8px;
  }
  .clk-arrow {
    width: 34px;
    height: 34px;
  }
  .clk-preview {
    zoom: 0.8;
  }
  .clk-info {
    min-width: 0;
    max-width: none;
    flex-basis: 100%;
  }
}
```

- [ ] **Step 2: Theme tab and footer**

Create `apps/web/src/components/cards/locker-theme-tab.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { PlayerCard } from './player-card'
import { CARD_THEMES } from './card-themes'
import { swatchStyle } from './card-style'
import { swatchThumb } from './card-assets'
import type { CardViewModel } from './card-model'
import {
  lockerPreviewCard,
  type LockerRequirement,
  type LockerTheme,
  type LockerView,
} from './locker-model'

/** Theme tab: browse all 10 themes on this player's card (read-only). */
export function LockerThemeTab({
  card,
  view,
  index,
  onSelect,
  onStep,
}: {
  card: CardViewModel
  view: LockerView
  index: number
  onSelect: (i: number) => void
  onStep: (delta: number) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)

  // Keep the selected swatch centred in the rail (a phone shows about 5 of the 10).
  useEffect(() => {
    const rail = railRef.current
    const el = rail?.children[index]
    if (!rail || !(el instanceof HTMLElement)) return
    rail.scrollTo({ left: el.offsetLeft - (rail.clientWidth - el.offsetWidth) / 2 })
  }, [index])

  const browse = view.themes[index] ?? view.themes[0]
  if (browse === undefined) return null
  const locked = browse.status === 'locked'

  return (
    <>
      <div className="clk-stage">
        <div className="clk-viewer">
          <button
            type="button"
            className="clk-icon-btn clk-arrow"
            aria-label="Previous theme"
            onClick={() => {
              onStep(-1)
            }}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
          <div className="clk-preview" data-locked={locked}>
            {/* 'hero' animates while on screen; with no back face it never flips. */}
            <PlayerCard key={browse.key} card={lockerPreviewCard(card, browse)} context="hero" />
          </div>
          <button
            type="button"
            className="clk-icon-btn clk-arrow"
            aria-label="Next theme"
            onClick={() => {
              onStep(1)
            }}
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
        <div className="clk-info" aria-live="polite">
          <div className="clk-info-head">
            <h3 className="clk-name">{browse.name}</h3>
            <span className="clk-tag" data-status={browse.status}>
              {browse.tag}
            </span>
          </div>
          {locked && <RequirementBlock req={view.requirement} extra={browse.unlockNote} />}
          {browse.status === 'unlocked' && (
            <p className="clk-note">Equipping arrives with member logins.</p>
          )}
        </div>
      </div>
      <div className="clk-railwrap">
        <div ref={railRef} className="clk-rail" role="group" aria-label="Themes">
          {view.themes.map((t, i) => {
            const label = `${t.name} · T${String(t.tier)}${t.status === 'locked' ? ' · locked' : ''}`
            return (
              <button
                key={t.key}
                type="button"
                className="clk-swatch"
                aria-pressed={i === index}
                aria-label={label}
                title={label}
                data-locked={t.status === 'locked'}
                onClick={() => {
                  onSelect(i)
                }}
              >
                <span
                  className="clk-swatch-tile"
                  style={swatchStyle(CARD_THEMES[t.key], swatchThumb(t.key))}
                />
                {t.status === 'locked' && (
                  <Lock className="clk-swatch-lock" size={14} aria-hidden />
                )}
                <span className="clk-swatch-label">{t.short}</span>
                <span className="clk-dot" data-on={t.status === 'equipped'} aria-hidden />
              </button>
            )
          })}
        </div>
        <div className="clk-legend">
          <span className="clk-legend-eq">
            <span className="clk-dot" data-on="true" aria-hidden />
            EQUIPPED
          </span>
          <span>T1–T5 · ONE THEME PER TIER</span>
          <span>T6 · FIVE MYTHICS</span>
        </div>
      </div>
    </>
  )
}

function RequirementBlock({ req, extra }: { req: LockerRequirement; extra: string | null }) {
  return (
    <div className="clk-req">
      <div className="clk-req-head">
        <span className="clk-req-title">{req.title}</span>
        <span className="clk-req-count">{req.count}</span>
      </div>
      {req.pct !== null && (
        <span className="clk-bar">
          <span style={{ width: `${String(req.pct)}%` }} />
        </span>
      )}
      <p className="clk-note">{extra === null ? req.note : `${req.note} ${extra}`}</p>
    </div>
  )
}

/** Footer: everything shown, nothing enabled until member logins (D1/D10). */
export function LockerThemeFooter({ theme, onClose }: { theme: LockerTheme; onClose: () => void }) {
  return (
    <div className="clk-foot">
      <button
        type="button"
        className="clk-auto"
        aria-pressed="true"
        disabled
        title="Equipping arrives with member logins"
      >
        <span className="clk-auto-box" aria-hidden />
        AUTO · FOLLOW TIER
      </button>
      <div className="clk-actions">
        <button type="button" className="clk-btn" onClick={onClose}>
          CLOSE
        </button>
        <button
          type="button"
          className="clk-primary"
          disabled
          title={theme.status === 'unlocked' ? 'Equipping arrives with member logins' : undefined}
        >
          {theme.action}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Drawer shell**

Create `apps/web/src/components/cards/card-locker.tsx`:

```tsx
'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'
import { LockerThemeFooter, LockerThemeTab } from './locker-theme-tab'
import './card-locker.css'

type LockerTab = 'theme' | 'progress'

const TABS: readonly { id: LockerTab; label: string }[] = [{ id: 'theme', label: 'THEME' }]

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The Card Locker drawer (Card Locker.dc.html; spec Part 3). Read-only until
 * member logins exist (D1/D10): browsing works, equipping is disabled.
 * Portalled to <body> (see nav-drawer.tsx: an ancestor filter or transform
 * would otherwise trap `position: fixed`). Esc or the scrim closes it, Tab
 * stays inside, and ←/→ browse themes on the Theme tab.
 */
export function CardLocker({
  card,
  view,
  onClose,
}: {
  card: CardViewModel
  view: LockerView
  onClose: () => void
}) {
  const [tab, setTab] = useState<LockerTab>('theme')
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      view.themes.findIndex((t) => t.status === 'equipped'),
    ),
  )
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const count = view.themes.length

  // Focus the close button and lock page scroll while open.
  useEffect(() => {
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (tab === 'theme' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        const delta = event.key === 'ArrowLeft' ? -1 : 1
        setIndex((i) => (i + delta + count) % count)
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)
      if (event.shiftKey ? !inside || active === first : !inside || active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [tab, onClose, count])

  const browse = view.themes[index] ?? view.themes[0]
  if (browse === undefined) return null

  return createPortal(
    <div className="clk-overlay">
      {/* Click-to-dismiss only; Esc and the × button are the keyboard routes out. */}
      <div className="clk-scrim" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="clk-panel"
      >
        <div className="clk-topline" aria-hidden />
        <div className="clk-head">
          <div className="clk-head-text">
            <h2 id={titleId} className="clk-title">
              CARD LOCKER
            </h2>
            <span className="clk-sub">{view.subline}</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="clk-icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="clk-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="clk-tab"
              aria-pressed={tab === t.id}
              onClick={() => {
                setTab(t.id)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="clk-body">
          {tab === 'theme' && (
            <LockerThemeTab
              card={card}
              view={view}
              index={index}
              onSelect={setIndex}
              onStep={(delta) => {
                setIndex((i) => (i + delta + count) % count)
              }}
            />
          )}
        </div>
        {tab === 'theme' && <LockerThemeFooter theme={browse} onClose={onClose} />}
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 4: Hero card with the EDIT button**

Create `apps/web/src/components/cards/hero-card.tsx`:

```tsx
'use client'

import { useCallback, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { PlayerCard } from './player-card'
import { CardLocker } from './card-locker'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'
import './card-locker.css'

/**
 * The player-page hero slot (spec D9/D10): the flippable card with an EDIT
 * button under it, shown to everyone, opening the read-only Card Locker.
 */
export function HeroCard({
  card,
  locker,
  initialFace,
}: {
  card: CardViewModel
  locker: LockerView
  initialFace?: 'front' | 'back'
}) {
  const [open, setOpen] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    editRef.current?.focus()
  }, [])
  return (
    <div className="clk-hero">
      <PlayerCard card={card} context="hero" initialFace={initialFace ?? 'front'} />
      <button
        ref={editRef}
        type="button"
        className="clk-edit"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true)
        }}
      >
        <Pencil size={14} aria-hidden />
        EDIT
      </button>
      {open && <CardLocker card={card} view={locker} onClose={close} />}
    </div>
  )
}
```

(`initialFace ?? 'front'` because `exactOptionalPropertyTypes` is on: `PlayerCard`'s optional prop does not accept an explicit `undefined`.)

- [ ] **Step 5: Wire it into the preview page**

In `apps/web/src/app/preview/roster/[id]/page.tsx`:

- add imports:

```ts
import { HeroCard } from '@/components/cards/hero-card'
import { buildLockerView } from '@/components/cards/locker-model'
```

- after the `const heroCard = applyCardOverrides(…)` statement add:

```ts
// Locker (spec Part 3): built here so its dates format once, on the server.
const lockerView = buildLockerView({
  name: heroCard.front.name,
  tier: heroCard.front.tier,
  level: heroCard.front.level,
  equipped: heroCard.front.theme,
  pool: cardProgress?.standing?.pool ?? null,
  badges: cardProgress?.badges ?? [],
  events: cardProgress?.events ?? [],
  trackedSince: cardProgress?.standing?.trackedSince ?? null,
})
```

- replace the `portrait={…}` prop value with:

```tsx
        portrait={
          <HeroCard card={heroCard} locker={lockerView} initialFace={cardParams.face} />
        }
```

`PlayerCard` stays imported (the depth strip still uses it).

- [ ] **Step 6: Gates**

```bash
pnpm --filter web typecheck
pnpm --filter web exec eslint src/components/cards/card-locker.tsx src/components/cards/locker-theme-tab.tsx src/components/cards/hero-card.tsx "src/app/preview/roster/[id]/page.tsx"
pnpm exec prettier --write apps/web/src/components/cards/card-locker.tsx apps/web/src/components/cards/locker-theme-tab.tsx apps/web/src/components/cards/hero-card.tsx apps/web/src/components/cards/card-locker.css "apps/web/src/app/preview/roster/[id]/page.tsx"
```

Expected: all exit 0.

- [ ] **Step 7: Check it in the browser (Playwright MCP, dev server already on `eanhl_preview`)**

1. `http://localhost:3000/preview/roster/3?gallery=0` at 1280×900. EDIT sits under the card, full card width; the rest of the hero is unchanged from `/roster/3`. Screenshot.
2. Click EDIT. The drawer opens on THEME with **Carbon-Fiber** selected, tag `T4 · EQUIPPED (AUTO)`, primary `EQUIPPED` (disabled), AUTO pill on and disabled. Screenshot. Compare with the prototype (`Card Locker.dc.html` served from the zip on :8765, owner on, tier 4, level 6).
3. Click the Away swatch: tag `T1 · UNLOCKED`, `EQUIP AWAY` disabled, the "Equipping arrives…" caption. Press → until Frozen: the preview is desaturated at T6 chip styling, the requirement block reads `NEXT · T5 FRANCHISE · 1 / 4 BADGES` + "Frozen is a T6 mythic, awarded by the club." Screenshot Storm too.
4. **Network:** reload, clear the log, open EDIT. `/images/cards/` requests must be only `thumb-*.webp` (5) while Carbon is shown. Browsing to Storm then loads its stills and the strike footage; closing removes all `<video>` elements (`document.querySelectorAll('.clk-overlay video').length === 0` after close).
5. **Keyboard (Review Focus 5):** Tab from the page to EDIT, press Enter → focus is on the × button. Press Tab 30 times: `document.activeElement` stays inside `.clk-panel`. Press ← and →: the selected swatch moves. Press Esc: the drawer is gone, `document.activeElement` is the EDIT button, and `document.body.style.overflow === ''`.
6. Click the dark scrim outside the panel: the drawer closes.
7. **390×844 (Review Focus 4):** open EDIT: `document.documentElement.scrollWidth <= 390`; the rail scrolls sideways inside itself and the selected swatch is centred; the footer wraps without overflow. Screenshot.
8. **Goalie:** `/preview/roster/12?role=goalie&gallery=0` (T2, goalie pool; preview levels gg 12, gw 12, gdsv 12, gsv 7, gso 4, gpoke 0): Home is equipped; browsing Alternate shows `NEXT · T3 STUD` `3 / 4 BADGES` and "4 goalie badges at Tier III (LVL 11+)."
9. **Reduced motion:** emulate `prefers-reduced-motion: reduce`, open EDIT on Storm: `document.querySelectorAll('.clk-overlay video').length === 0` and no running animations inside `.clk-overlay`.
10. Console: no new errors or hydration warnings (the ContributionWheel warning is pre-existing).

Fix anything that fails before committing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/cards/card-locker.css apps/web/src/components/cards/locker-theme-tab.tsx apps/web/src/components/cards/card-locker.tsx apps/web/src/components/cards/hero-card.tsx "apps/web/src/app/preview/roster/[id]/page.tsx"
git commit -m "feat(web): EDIT button and card locker theme tab (preview)"
```

---

### Task 5: Progress tab

**Files:**

- Create: `apps/web/src/components/cards/locker-progress-tab.tsx`
- Modify: `apps/web/src/components/cards/card-locker.tsx` (tabs + body)
- Modify: `apps/web/src/components/cards/card-locker.css` (append)

**Interfaces:**

- Consumes: `LockerView` (`level`, `tierLabel`, `levelNote`, `requirement`, `rows`, `track`, `history`, `historyEmpty`) from Task 2; `Badge` from `@/components/badges/badge`; `PlayerCard`.
- Produces: `LockerProgressTab({ card: CardViewModel; view: LockerView })`.

- [ ] **Step 1: Styles**

Append to `apps/web/src/components/cards/card-locker.css` (before the `/* ── Phones` block), then add the phone rules shown below inside the existing `@media (max-width: 639px)` block:

```css
/* ── Progress tab ────────────────────────────────────────────────────── */
.clk-progress {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 28px;
  padding: 22px;
}
.clk-progress-card {
  zoom: 0.72;
}
.clk-stack {
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
}
.clk-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.clk-spread {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.clk-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.24em;
  color: #71717a;
}
.clk-level {
  font-size: 22px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #fafafa;
}
.clk-level small {
  font-size: 13px;
  color: #6e6b6c;
}
.clk-count {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #ef6a5e;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.clk-pips {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 3px;
}
.clk-pip {
  height: 8px;
  background: #2a2829;
}
.clk-pip[data-on='true'] {
  background: #e84131;
  box-shadow: 0 0 6px rgba(232, 65, 49, 0.45);
}
.clk-row {
  display: grid;
  grid-template-columns: 30px 110px minmax(0, 1fr) 54px;
  gap: 12px;
  align-items: center;
}
.clk-row-badge {
  display: flex;
  justify-content: center;
}
.clk-row[data-locked='true'] .clk-row-badge {
  opacity: 0.35;
  filter: grayscale(1) brightness(0.55);
}
.clk-row-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #d4d4d8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clk-row-val {
  font-size: 12px;
  font-weight: 700;
  text-align: right;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
}
.clk-row[data-done='true'] .clk-row-name {
  color: #fafafa;
}
.clk-row[data-done='true'] .clk-row-val {
  color: #10b981;
}
.clk-row[data-done='true'] .clk-bar > span {
  background: #10b981;
}
.clk-track {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 3px;
}
.clk-step {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 8px 8px 7px;
  border-top: 2px solid #2a2829;
}
.clk-step-n {
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
  color: #52525b;
}
.clk-step-label,
.clk-step-theme {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: #52525b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clk-step-label {
  font-weight: 700;
  letter-spacing: 0.14em;
}
.clk-step-theme {
  font-weight: 600;
}
.clk-step[data-state='done'] {
  background: #262425;
  border-top-color: #71717a;
}
.clk-step[data-state='done'] .clk-step-n {
  color: #fafafa;
}
.clk-step[data-state='done'] .clk-step-label {
  color: #a1a1aa;
}
.clk-step[data-state='now'] {
  background: rgba(232, 65, 49, 0.1);
  border-top-color: #e84131;
}
.clk-step[data-state='now'] .clk-step-n {
  color: #e84131;
}
.clk-step[data-state='now'] .clk-step-label {
  color: #ef6a5e;
}
.clk-hist-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.clk-hist {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #2a2829;
  font-size: 12px;
}
.clk-hist-date {
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #52525b;
  font-variant-numeric: tabular-nums;
}
.clk-hist-text {
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #d4d4d8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Inside the existing `@media (max-width: 639px)` block, add:

```css
.clk-progress {
  grid-template-columns: minmax(0, 1fr);
  padding: 16px;
}
.clk-progress-card {
  display: none;
}
.clk-row {
  grid-template-columns: 30px 96px minmax(0, 1fr) 54px;
  gap: 10px;
}
.clk-track {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
```

- [ ] **Step 2: The tab component**

Create `apps/web/src/components/cards/locker-progress-tab.tsx`:

```tsx
import { Badge } from '@/components/badges/badge'
import { PlayerCard } from './player-card'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'

/** Progress tab: level, next-tier requirement, tier track and card history. */
export function LockerProgressTab({ card, view }: { card: CardViewModel; view: LockerView }) {
  const req = view.requirement
  return (
    <div className="clk-progress">
      <div className="clk-progress-card">
        <PlayerCard card={{ ...card, back: null }} context="hero" />
      </div>
      <div className="clk-stack">
        <section className="clk-block" aria-label="Level">
          <div className="clk-spread">
            <span className="clk-label">LEVEL · {view.tierLabel}</span>
            <span className="clk-level">
              {view.level}
              <small> / 10</small>
            </span>
          </div>
          <div className="clk-pips" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="clk-pip" data-on={i < view.level} />
            ))}
          </div>
          <p className="clk-note">{view.levelNote}</p>
        </section>

        <section className="clk-block" aria-label="Next tier">
          <div className="clk-spread">
            <span className="clk-label">{req.title}</span>
            <span className="clk-count">{req.count}</span>
          </div>
          {req.pct !== null && (
            <span className="clk-bar">
              <span style={{ width: `${String(req.pct)}%` }} />
            </span>
          )}
          <p className="clk-note">{req.note}</p>
          {view.rows.map((r) => (
            <div key={r.familyId} className="clk-row" data-done={r.done} data-locked={r.locked}>
              <span className="clk-row-badge">
                <Badge
                  familyId={r.familyId}
                  shape={r.shape}
                  theme={r.theme}
                  frame="single"
                  size={28}
                />
              </span>
              <span className="clk-row-name">{r.short}</span>
              <span className="clk-bar">
                <span style={{ width: `${String(r.pct)}%` }} />
              </span>
              <span className="clk-row-val">{r.value}</span>
            </div>
          ))}
        </section>

        <section className="clk-block" aria-label="Tier track">
          <span className="clk-label">TIER TRACK</span>
          <div className="clk-track">
            {view.track.map((s) => (
              <div key={s.tier} className="clk-step" data-state={s.state}>
                <span className="clk-step-n">T{s.tier}</span>
                <span className="clk-step-label">{s.label}</span>
                <span className="clk-step-theme">{s.theme}</span>
                {s.note !== null && <span className="clk-step-theme">{s.note}</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="clk-block" aria-label="History">
          <span className="clk-label">HISTORY</span>
          {view.history.length === 0 ? (
            <p className="clk-note">{view.historyEmpty}</p>
          ) : (
            <ol className="clk-hist-list">
              {view.history.map((h, i) => (
                <li key={`${h.date}-${String(i)}`} className="clk-hist">
                  <span className="clk-hist-date">{h.date}</span>
                  <span className="clk-hist-text">{h.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add the tab to the shell**

In `apps/web/src/components/cards/card-locker.tsx`:

- add `import { LockerProgressTab } from './locker-progress-tab'`;
- replace the `TABS` constant with:

```ts
const TABS: readonly { id: LockerTab; label: string }[] = [
  { id: 'theme', label: 'THEME' },
  { id: 'progress', label: 'PROGRESS' },
]
```

- inside `<div className="clk-body">`, after the theme-tab expression, add:

```tsx
{
  tab === 'progress' && <LockerProgressTab card={card} view={view} />
}
```

- [ ] **Step 4: Gates**

```bash
pnpm --filter web typecheck
pnpm --filter web exec eslint src/components/cards/locker-progress-tab.tsx src/components/cards/card-locker.tsx
pnpm exec prettier --write apps/web/src/components/cards/locker-progress-tab.tsx apps/web/src/components/cards/card-locker.tsx apps/web/src/components/cards/card-locker.css
pnpm --filter web test:unit
```

Expected: all exit 0.

- [ ] **Step 5: Check it in the browser, with sample history**

The preview database has no card events yet (the backfill writes none). Add three sample events for #3, check, then remove them:

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -c "INSERT INTO player_card_events (player_id, kind, family_id, from_value, to_value, occurred_at) VALUES (3, 'level_up', NULL, 5, 6, '2026-10-04 18:00+00'), (3, 'badge_level_up', 'pgoals', 14, 15, '2026-09-28 18:00+00'), (3, 'tier_up', NULL, 3, 4, '2026-09-22 18:00+00');"
```

1. `/preview/roster/3?gallery=0` at 1280: EDIT → PROGRESS. Check: `LEVEL · ELITE 6 / 10`, 6 pips lit; `NEXT · T5 FRANCHISE` `1 / 4 BADGES` with a 25% bar and "4 skater badges at Tier V (LVL 21+)."; rows BREAKAWAYS DONE (green), FACEOFFS LVL 18/21, DEKES, HAT TRICKS, FIGHTS, WINS; tier track T1–T3 done, T4 red, T6 "5 MYTHICS / AWARDED"; history `OCT 04 LEVEL 6 REACHED`, `SEP 28 GOALS · LEVEL 15`, `SEP 22 T4 ELITE · CARBON-FIBER UNLOCKED`. Screenshot; compare with the prototype's Progress tab.
2. Remove the samples and confirm the empty state:

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -c "DELETE FROM player_card_events WHERE player_id = 3 AND occurred_at IN ('2026-10-04 18:00+00', '2026-09-28 18:00+00', '2026-09-22 18:00+00');"
```

Reload: HISTORY shows "History starts <the created_at date from Task 1>." 3. `/preview/roster/12?role=goalie&gallery=0` → PROGRESS: rows STARTS DONE, G WINS DONE, DESPERATION DONE, SAVES LVL 7/11, SHUTOUTS LVL 4/11, POKE CHECKS LVL 0/11 (dimmed); the note says "4 goalie badges at Tier III (LVL 11+)." 4. `?cardTier=5&cardTheme=futureB` and `?cardTier=6&cardTheme=stormLive`: no rows; T5 shows `AWARDED` with no bar; T6 shows `MAX TIER · COMPLETE`. 5. 390×844: no card in the Progress tab, rows fit (`scrollWidth <= 390`), the tier track is 3×2. Screenshot. 6. Console: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/cards/locker-progress-tab.tsx apps/web/src/components/cards/card-locker.tsx apps/web/src/components/cards/card-locker.css
git commit -m "feat(web): card locker progress tab (preview)"
```

---

### Task 6: Review and records

**Files:**

- Modify: `docs/superpowers/plans/2026-10-07-locker-step-3.md` (execution record)
- Ledger: `.superpowers/sdd/2026-10-07-locker-step-3/progress.md`
- Via the `handoff-update` skill: `HANDOFF.md`, `docs/journal/2026-10.md`

- [ ] **Step 1: Confirm live code is untouched**

Run: `git diff --stat d62d856..HEAD -- apps/web/src/app/roster apps/web/src/components/roster apps/web/src/app/page.tsx apps/web/src/components/home`
Expected: empty output.

- [ ] **Step 2: Full gates**

```bash
pnpm --filter @eanhl/db test
pnpm --filter web test:unit
pnpm --filter @eanhl/db typecheck && pnpm --filter @eanhl/worker typecheck && pnpm --filter web typecheck
pnpm exec prettier --check $(git diff --name-only d62d856..HEAD -- '*.ts' '*.tsx' '*.css' '*.md')
```

Expected: all green.

- [ ] **Step 3: Fresh review**

Dispatch one fresh reviewer (most capable model) on `git diff d62d856..HEAD`, with the spec (Part 3, D1/D9/D10), this plan and `Card Locker.dc.html`. Ask for Critical / Important / Minor findings with file:line. Rule on each in the ledger, fix the ones worth fixing with a test where one fits, commit as `fix(web): card locker review fixes`.

- [ ] **Step 4: Records**

Append an "Execution record (date)" section to this plan (commits, test counts, rulings, deferred items). Then run the `handoff-update` skill.

- [ ] **Step 5: Report to the operator**

Links (`/preview/roster/3`, `/preview/roster/12?role=goalie`), the 10 prototype/spec deviations from Context for approval, and the next choice: Build Locker v2 (step 4) or the Action Map (step 5).

## Execution record (2026-10-07)

Executed inline (Native) on `feat/player-cards`; one fresh reviewer (opus) at the end.

**Commits:** `1fb54d7` plan · `4e4b45c` created_at (db) · `c09ed7e` locker view model · `5bdf68a` swatch thumbnails · `c832917` EDIT + Theme tab · `8045971` Progress tab · `47aed42` review fix.

**Verification:** db tests 111/111; web unit 362/362 (locker-model 10/10, card-assets 5/5, card-style green); typecheck db/worker/web, isolated eslint and prettier green; no live file changed (`git diff --stat d62d856..HEAD` over roster/home is empty). Migration 0060 (with `created_at`) re-applied to `eanhl_preview`; a recompute kept `created_at` on 89/89 rows. Playwright at 1280 and 390 px: every Review Focus item passed (focus on ×, Tab trap 0/30 escapes, Esc returns focus to EDIT and restores scroll, scrim closes, only `thumb-*.webp` load on open, mythic files load only when browsed, reduced motion → no video/animations, goalie #12 uses goalie families, T5 "AWARDED", T6 "MAX TIER", empty history "History starts Oct 7, 2026."). Sample history events were inserted into `eanhl_preview` for the check and deleted afterwards (0 left).

**Rulings:**

- Task 2: dropped the plan's `as StatsTier` casts and two optional chains in the test (eslint: TS already narrows) — behaviour identical.
- Task 3: `make-card-thumbs.sh` runs ffmpeg with `-nostdin`; inside the `while read` loop ffmpeg ate the here-doc and truncated names. Misnamed files deleted and rebuilt.
- Task 4: focus follows the selected swatch when ←/→ are pressed while a swatch has focus (the ring was stranded on the old swatch).
- Task 5: the phone CSS block (de-indented by prettier inside the plan) was re-indented into the media query.
- Final: ten reviewer "declined to judge" items stand as built (year-less history dates, README grey tokens, two-tier jump names one theme, "Never goes down" wording, `100dvh`, nav-drawer scroll lock quirks, sticky hover on iOS, Edmonton zone, landscape phones, pool that set the tier).

**Review:** "With fixes" — 0 Critical, 1 Important (fixed: switching tabs kept the scroll offset, so Progress opened mid-way on phones; reproduced at 390×664, fixed with `key={tab}` on the scroller), 5 Minor deferred:

- the hero card keeps animating behind the scrim (doubles mythic effects for T6 players; decide with the Storm phone pass);
- the keyboard focus ring is clipped on the first/last swatch;
- on short phones (≈664 px tall) the theme name and requirement start below the fold;
- ←/→ also swallow Alt/Cmd+← (browser back) while the locker is open;
- tabs use `aria-pressed` instead of `role="tab"`; EDIT's accessible name is just "EDIT".

**For the switch:** load `CardLocker` with `next/dynamic` on first open and measure player-page transfer size; check once on live a member with no standing yet and the first awarded mythic (the preview data has neither).
