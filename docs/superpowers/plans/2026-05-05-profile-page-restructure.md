# Player Profile Page Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `/roster/[id]` from its current Phase 1 layout into a new IA: a richer hero with this-season + career-aggregate stat strips and an AKA line, a compact Last 5 form strip, a tabbed Stats Record card (Season-by-Season + Game Log), the existing 5-tab Club Stats, the existing Contribution donut, and a bottom "Charts & Visuals" zone with the real trend chart plus three wireframe placeholders (Shotmap / Overall Archetype / Awards). Goalie role gets a parallel layout — handled in a future plan; this plan only changes shared infrastructure and the skater-side experience.

**Architecture:** Extract the existing inline `HeroSection`, `TrendSection`, `ContributionSection`, `CurrentSeasonSection`, `CareerStatsTable`, and `EASeasonStatsTable` from the 1700-line page into focused component files under `apps/web/src/components/roster/`. Add a new `getPlayerCareerSeasons(playerId, role)` query that blends EA NHL 26 totals with historical reviewed legacy data into one row-per-title result. Build a tabbed `<StatsRecordCard>` that hosts the existing PlayerGameLogSection alongside the new career table. Add a `<ComingSoonCard>` primitive for the three wireframe sections. Page file ends up under 500 lines as orchestration only.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind 4, Drizzle ORM, pnpm workspaces. Server Components by default; only the tab containers (StatsRecord, existing ClubStatsTabs) are Client Components.

**Out of Scope:**
- Goalie-side parity (Goalie Career Seasons table, Goalie Club Stats Tabs 6-8, Goalie hero strip) — the role selector still works, but goalie role just shows a "goalie view coming soon" placeholder for the new sections that haven't been built. Existing Phase 1 goalie experience (current season grid, recent form, contribution) is preserved on the goalie side.
- Real implementations of Shotmap, Overall Archetype radar, Awards — these are wireframes.
- Backfilling missing historical reviewed data for any player whose history is incomplete in `historical_player_season_stats`.

---

## Page IA Target

```
┌─ HERO ──────────────────────────────────────────────────────────┐
│  ┌───────────────────────┐  ┌──────────────────────────────────┐│
│  │ JERSEY/AVATAR         │  │ THIS SEASON (NHL 26 EA totals)   ││
│  │ SILKYJOKER85          │  │ GP G A PTS PTS/GP +/- SOG SHT%   ││
│  │ #10 · C · CANADA      │  │ HITS                              ││
│  │ PLAYMAKER             │  │                                   ││
│  │ AKA: Utiz23           │  │ CAREER TOTALS (sum NHL 22-26)     ││
│  │ Bio: "Started as..."  │  │ GP G A PTS +/- SOG HITS          ││
│  │ [SKATER] [GOALIE]     │  │                                   ││
│  └───────────────────────┘  │ POSITION USAGE DONUT              ││
│                             └──────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌─ RECENT FORM (last 5) ──────────────────────────────────────────┐
│  W L W W L  · 3-1-0 · G/A · +/- · best-recent callout           │
└─────────────────────────────────────────────────────────────────┘

┌─ STATS RECORD (tabbed) ─────────────────────────────────────────┐
│  [Season-by-Season]  [Game Log]                                  │
│  ───── (Season tab default) ─────                                │
│  NHL 26 │ 545 │ 426 │ 691 │ 1117 │ +169 │ ... (EA source)       │
│  NHL 25 │ 122 │ 71  │ 139 │ 210  │ +23  │ ... (Historical)      │
│  NHL 24 │ ... (Historical)                                       │
│  NHL 23 │ ... (Historical)                                       │
│  NHL 22 │ ... (Historical)                                       │
└─────────────────────────────────────────────────────────────────┘

┌─ CLUB STATS (existing 5-tab thing) ─────────────────────────────┐
│  [Overview] [Scoring] [Playmaking] [Defense] [Faceoffs]         │
└─────────────────────────────────────────────────────────────────┘

┌─ CONTRIBUTION (existing donut + bars) ──────────────────────────┐
│  Donut · Scoring/Playmaking/Shooting/Physicality/Possession/... │
└─────────────────────────────────────────────────────────────────┘

┌─ CHARTS & VISUALS (mixed: 1 real + 3 wireframes) ───────────────┐
│  ┌─ Recent Form Trend ───────┐ ┌─ Shotmap ──────────────────┐   │
│  │ (existing 15-game bars)   │ │ ▸ Coming soon              │   │
│  │ POINTS PER GAME chart     │ │ Rink overlay placeholder   │   │
│  └───────────────────────────┘ └────────────────────────────┘   │
│  ┌─ Overall Archetype ───────┐ ┌─ Awards ───────────────────┐   │
│  │ ▸ Coming soon             │ │ ▸ Coming soon              │   │
│  │ Radar of player score     │ │ Trophy strip placeholder   │   │
│  └───────────────────────────┘ └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

**Create (new components):**
- `apps/web/src/components/roster/profile-hero.tsx` — new richer hero
- `apps/web/src/components/roster/recent-form-strip.tsx` — extracted last-5 panel
- `apps/web/src/components/roster/career-seasons-table.tsx` — unified career table (per-title rows, blended sources)
- `apps/web/src/components/roster/stats-record-card.tsx` — tabbed wrapper hosting career table + game log (Client Component)
- `apps/web/src/components/roster/coming-soon-card.tsx` — placeholder primitive
- `apps/web/src/components/roster/charts-visuals-section.tsx` — bottom zone wrapper combining real trend chart + 3 placeholders
- `apps/web/src/components/roster/trend-chart.tsx` — extracted from current `TrendSection` (the SVG bar chart only)

**Modify:**
- `packages/db/src/queries/players.ts` — add `getPlayerCareerSeasons(playerId, role)` query + types
- `apps/web/src/app/roster/[id]/page.tsx` — significant restructure; deletes inline section components after extraction; wires up new orchestration order

**Will be deleted from page.tsx (after extraction):**
- `function HeroSection(...)` (now in profile-hero.tsx)
- `function CurrentSeasonSection(...)` (folded into hero stat strip)
- `function TrendSection(...)` (split: chart → trend-chart.tsx, last-5 → recent-form-strip.tsx)
- `function ContributionSection(...)` (extracted into its own file too — keep behavior, just relocate)
- `function CareerStatsTable(...)` (replaced by career-seasons-table.tsx)
- `function EASeasonStatsTable(...)` (deleted — folds into career-seasons-table.tsx)
- `function PreviousSeasonStatsTable(...)` and `buildPreviousSeasonTotals(...)` (deleted — folds into career-seasons-table.tsx)
- The whole "Previous NHL Season" `<section>` (deleted)
- The whole "Gamertag History" rendering (collapsed into hero AKA)

**Goalie role fallback:** When `selectedRole === 'goalie'`, the new hero/stats-record/club-stats sections render placeholder messaging. Goalie keeps its existing experience in a separate render branch — minimal changes.

---

## Data Source Decisions (for reference)

| Section | Skater source | Goalie source |
|---|---|---|
| Hero "This Season" | `eaStats[0]` (NHL 26 EA totals) | `eaStats[0]` goalie fields |
| Hero "Career Totals" (aggregate) | sum across `getPlayerCareerSeasons` skater rows | sum across goalie rows |
| Career season-by-season — NHL 26 row | `eaStats[0]` skater fields | `eaStats[0]` goalie fields |
| Career season-by-season — NHL 22-25 rows | `getHistoricalSkaterStats(gameTitleId)` filtered to this player | `getHistoricalGoalieStats(gameTitleId)` filtered |
| Game Log | existing `PlayerGameLogSection` (local match data, role-aware) | existing |
| Club Stats Tabs | existing `<ClubStatsTabs>` (skater only) | placeholder ("goalie tabs coming soon") |
| Contribution | existing `<ContributionSection>` | existing |
| Trend chart | existing `<TrendChart>` (role-filtered) | existing |
| Position usage | existing `<PositionDonut>` | existing |

---

## Task 1: Add `getPlayerCareerSeasons` unified query

**Files:**
- Modify: `packages/db/src/queries/players.ts`

This query returns one row per game title for the requested role (skater or goalie), blending sources:
- For each title where the player has an EA member-season-stats row → use that
- For each title where the player has a historical reviewed row but no EA row → use historical
- Output sorted descending by gameTitleId

The row shape covers both skater and goalie columns; the consumer picks which to render.

- [ ] **Step 1: Add the query function**

Add after `getPlayerCareerStats` (around line 265) in `packages/db/src/queries/players.ts`:

```typescript
/**
 * Unified career-by-season view for the player profile page.
 *
 * Returns one row per game title (newest first) blending sources:
 *   - For the active title (NHL 26), use EA member-season-stats (authoritative).
 *   - For prior titles (NHL 22-25), use hand-reviewed historical_player_season_stats.
 *
 * Both skater and goalie columns are present on every row; rows where a role's
 * GP is 0 should be filtered/displayed by the consumer based on selectedRole.
 *
 * `mode` filter is intentionally omitted — career rows are always all-modes.
 */
export interface PlayerCareerSeasonRow {
  gameTitleId: number
  gameTitleName: string
  gameTitleSlug: string
  source: 'ea' | 'historical'
  // Skater
  skaterGp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  shots: number
  shotPct: string | null
  hits: number
  pim: number
  takeaways: number
  giveaways: number
  faceoffPct: string | null
  passPct: string | null
  // Goalie (nullable when goalieGp=0)
  goalieGp: number
  wins: number | null
  losses: number | null
  otl: number | null
  savePct: string | null
  gaa: string | null
  shutouts: number | null
}

export async function getPlayerCareerSeasons(
  playerId: number,
): Promise<PlayerCareerSeasonRow[]> {
  // 1. Fetch EA member-season-stats rows (one per active game title).
  const eaRows = await db
    .select({
      gameTitleId: eaMemberSeasonStats.gameTitleId,
      gameTitleName: gameTitles.name,
      gameTitleSlug: gameTitles.slug,
      skaterGp: eaMemberSeasonStats.skaterGp,
      goals: eaMemberSeasonStats.goals,
      assists: eaMemberSeasonStats.assists,
      points: eaMemberSeasonStats.points,
      plusMinus: eaMemberSeasonStats.plusMinus,
      shots: eaMemberSeasonStats.shots,
      shotPct: eaMemberSeasonStats.shotPct,
      hits: eaMemberSeasonStats.hits,
      pim: eaMemberSeasonStats.pim,
      takeaways: eaMemberSeasonStats.takeaways,
      giveaways: eaMemberSeasonStats.giveaways,
      faceoffPct: eaMemberSeasonStats.faceoffPct,
      passPct: eaMemberSeasonStats.passPct,
      goalieGp: eaMemberSeasonStats.goalieGp,
      wins: eaMemberSeasonStats.goalieWins,
      losses: eaMemberSeasonStats.goalieLosses,
      otl: eaMemberSeasonStats.goalieOtl,
      savePct: eaMemberSeasonStats.goalieSavePct,
      gaa: eaMemberSeasonStats.goalieGaa,
      shutouts: eaMemberSeasonStats.goalieShutouts,
    })
    .from(eaMemberSeasonStats)
    .innerJoin(gameTitles, eq(eaMemberSeasonStats.gameTitleId, gameTitles.id))
    .where(eq(eaMemberSeasonStats.playerId, playerId))

  // 2. Fetch historical reviewed rows where this player matches by player_id.
  //    Reuses the same join shape used by /stats archive surfaces.
  const histSkRows = await db
    .select({
      gameTitleId: historicalPlayerSeasonStats.gameTitleId,
      gameTitleName: gameTitles.name,
      gameTitleSlug: gameTitles.slug,
      skaterGp: historicalPlayerSeasonStats.gamesPlayed,
      goals: historicalPlayerSeasonStats.goals,
      assists: historicalPlayerSeasonStats.assists,
      points: historicalPlayerSeasonStats.points,
      plusMinus: historicalPlayerSeasonStats.plusMinus,
      shots: historicalPlayerSeasonStats.shots,
      shotPct: historicalPlayerSeasonStats.shotPct,
      hits: historicalPlayerSeasonStats.hits,
      pim: historicalPlayerSeasonStats.pim,
      takeaways: historicalPlayerSeasonStats.takeaways,
      giveaways: historicalPlayerSeasonStats.giveaways,
      faceoffPct: historicalPlayerSeasonStats.faceoffPct,
      passPct: historicalPlayerSeasonStats.passPct,
      goalieGp: historicalPlayerSeasonStats.goalieGp,
      wins: historicalPlayerSeasonStats.wins,
      losses: historicalPlayerSeasonStats.losses,
      otl: historicalPlayerSeasonStats.otl,
      savePct: historicalPlayerSeasonStats.savePct,
      gaa: historicalPlayerSeasonStats.gaa,
      shutouts: historicalPlayerSeasonStats.shutouts,
    })
    .from(historicalPlayerSeasonStats)
    .innerJoin(gameTitles, eq(historicalPlayerSeasonStats.gameTitleId, gameTitles.id))
    .where(
      and(
        eq(historicalPlayerSeasonStats.playerId, playerId),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
        isNull(historicalPlayerSeasonStats.gameMode),
      ),
    )

  // 3. Merge: EA rows take precedence over historical for any title that has both.
  const merged = new Map<number, PlayerCareerSeasonRow>()
  for (const row of histSkRows) {
    merged.set(row.gameTitleId, { ...row, source: 'historical' })
  }
  for (const row of eaRows) {
    merged.set(row.gameTitleId, { ...row, source: 'ea' })
  }

  // 4. Sort newest title first.
  return Array.from(merged.values()).sort((a, b) => b.gameTitleId - a.gameTitleId)
}
```

- [ ] **Step 2: Verify the historical schema columns exist**

Before relying on `historicalPlayerSeasonStats.shotPct`, etc., confirm column names match. Run:

```bash
grep -E "shotPct|gaa|savePct|faceoffPct|passPct|gameMode|reviewStatus" packages/db/src/schema/historical-player-season-stats.ts | head -20
```

If a column name is `shooting_pct` or `shot_pct` and the TS field is `shootingPct`, adjust the query to match. The schema is the source of truth — fix the query's field references, do not edit the schema.

- [ ] **Step 3: Build the db package**

```bash
pnpm --filter @eanhl/db build
```

Expected: clean. If TypeScript fails on a column-name mismatch, revisit Step 2 and align.

- [ ] **Step 4: Smoke-check via psql for silkyjoker85**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "
SELECT 'ea' as src, em.game_title_id, gt.name, em.skater_gp, em.goals, em.assists, em.points
FROM ea_member_season_stats em JOIN game_titles gt ON gt.id = em.game_title_id
WHERE em.player_id = 2
UNION ALL
SELECT 'hist' as src, h.game_title_id, gt.name, h.games_played, h.goals, h.assists, h.points
FROM historical_player_season_stats h JOIN game_titles gt ON gt.id = h.game_title_id
WHERE h.player_id = 2 AND h.review_status = 'reviewed' AND h.game_mode IS NULL
ORDER BY 2 DESC;
"
```

Expected: 1 'ea' row (NHL 26) + N 'hist' rows (one per archived title where silky has reviewed data). If silky only has a historical NHL 25 row, that's fine — query design handles missing titles gracefully.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/players.ts
git commit -m "feat(db): add getPlayerCareerSeasons unified per-title query"
```

---

## Task 2: Extract `<ContributionSection>` into its own file

This is mechanical extraction — copy the existing function from `apps/web/src/app/roster/[id]/page.tsx` into a dedicated file with no behavior change.

**Files:**
- Create: `apps/web/src/components/roster/contribution-section.tsx`
- Modify: `apps/web/src/app/roster/[id]/page.tsx` (delete inline `function ContributionSection`, add import)

- [ ] **Step 1: Find the `function ContributionSection` block in the page**

```bash
grep -n "^function ContributionSection\|^function ContributionDonut\|^function MetricBar\|CONTRIBUTION_COLORS" apps/web/src/app/roster/[id]/page.tsx
```

Capture the line range (start of `function ContributionSection` through the end of `function MetricBar` or whichever comes last in this group). Also capture any helper consts they share (CONTRIBUTION_COLORS array, etc.).

- [ ] **Step 2: Create the new component file**

Move the captured block(s) into `apps/web/src/components/roster/contribution-section.tsx`. The file should:
- Add `'use client'` only if the section uses any client-only APIs (it doesn't currently — Server Component is fine)
- Import any types it needs from `@eanhl/db/queries` (probably `ProfileContributionSummary`)
- Export `ContributionSection` as a named export
- Include any helper types or constants that were inline in page.tsx and only used by ContributionSection

Verify dependencies it pulls from page.tsx — likely `SectionHeading` and `SurfaceCard`. If those are page-internal helpers, either:
- Move them to a shared util file too (`apps/web/src/components/roster/section-heading.tsx`)
- Or duplicate them inline in this component (only acceptable if used in 1-2 places)

The plan recommends moving `SectionHeading` to `apps/web/src/components/roster/section-heading.tsx` since multiple sections will need it after extraction.

- [ ] **Step 3: Update page.tsx**

Delete the inline function definitions and replace with:

```typescript
import { ContributionSection } from '@/components/roster/contribution-section'
```

The existing render call `<ContributionSection contribution={selectedContribution} selectedRole={selectedRole} />` stays in place.

- [ ] **Step 4: Build and lint**

```bash
pnpm --filter web lint
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/roster/[id]/page.tsx apps/web/src/components/roster/contribution-section.tsx apps/web/src/components/roster/section-heading.tsx
git commit -m "refactor(web): extract ContributionSection into roster/components"
```

---

## Task 3: Extract `<TrendChart>` (SVG only) and `<RecentFormStrip>` (Last 5 panel) into separate files

The current `TrendSection` does two things: renders a 15-game SVG bar chart AND renders a "LAST 5" sidebar panel. These are conceptually different and live in different parts of the new IA — split them.

**Files:**
- Create: `apps/web/src/components/roster/trend-chart.tsx` (the SVG bar chart only)
- Create: `apps/web/src/components/roster/recent-form-strip.tsx` (the LAST 5 panel, stand-alone, no chart)
- Modify: `apps/web/src/app/roster/[id]/page.tsx` (delete inline TrendSection, add imports)

- [ ] **Step 1: Locate the existing TrendSection**

```bash
grep -n "function TrendSection" apps/web/src/app/roster/[id]/page.tsx
```

Read the function body and identify two distinct render zones:
1. The SVG bar chart with axis, bars colored by result, dashed average line — extracts to `<TrendChart>`
2. The right-hand "LAST 5" panel showing form dots + record + G/A + +/- + best-recent callout — extracts to `<RecentFormStrip>`

- [ ] **Step 2: Create `trend-chart.tsx`**

Server Component. Props match what the chart needs: `trendGames: PlayerGameLogRow[]`, `selectedRole: 'skater' | 'goalie'`. The chart computes `stat` per game (goals+assists for skater, save% for goalie), max scale, average line, bar colors. No "LAST 5" rendering. The chart's section heading is included so it's a self-contained block.

The chart's section heading should be "RECENT FORM" with a subtitle like "Last N skater appearances · oldest to newest". Match existing styling.

- [ ] **Step 3: Create `recent-form-strip.tsx`**

Server Component. Props: `recentForm: ProfileRecentFormSkater | ProfileRecentFormGoalie | null`, `selectedRole: 'skater' | 'goalie'`. Renders ONLY the LAST 5 panel with:
- Form dots (color-coded by result, 5 max)
- Record W-L-OTL
- G/A (skater) or GA (goalie)
- +/- (skater)
- Best recent game callout

Rendering convention: a horizontal compact strip, no chart. Self-contained section header — "RECENT FORM" with subtitle "Last 5 appearances".

If `recentForm` is null or `recentForm.gamesAnalyzed === 0`, render nothing (caller handles fallback).

- [ ] **Step 4: Update page.tsx**

Replace the existing `{trendGames.length > 0 && <TrendSection ...>}` block with the new RecentFormStrip in its new location (above Stats Record, below Hero — see final orchestration in Task 9). The `<TrendChart>` will move to the bottom Charts & Visuals zone (Task 8).

For now, just import both new components. Final wiring happens in Task 9.

- [ ] **Step 5: Delete the old `function TrendSection`**

After verifying the two new components compile and the imports resolve.

- [ ] **Step 6: Lint, build, commit**

```bash
pnpm --filter web lint && pnpm build
git add apps/web/src/app/roster/[id]/page.tsx apps/web/src/components/roster/trend-chart.tsx apps/web/src/components/roster/recent-form-strip.tsx
git commit -m "refactor(web): split TrendSection into TrendChart and RecentFormStrip"
```

---

## Task 4: Create `<CareerSeasonsTable>` component

A new server component rendering the unified career-by-season table. Replaces both `CareerStatsTable` and `EASeasonStatsTable` (which become deletable after Task 9).

**Files:**
- Create: `apps/web/src/components/roster/career-seasons-table.tsx`

- [ ] **Step 1: Build the component**

Server Component (no `'use client'`). Single named export `CareerSeasonsTable`.

Props:
```typescript
interface Props {
  seasons: PlayerCareerSeasonRow[]  // from getPlayerCareerSeasons
  selectedRole: 'skater' | 'goalie'
}
```

Skater columns: Season · GP · G · A · PTS · P/GP · +/- · SOG · SHT% · HITS · PIM · TA · GV · Source
Goalie columns: Season · GP · W · L · OTL · SV% · GAA · SO · Source

The "Source" column shows a small badge: `EA` (accent color) or `Archive` (muted). This makes it clear which rows are authoritative-current vs historical-reviewed.

Filter `seasons` to only rows where `selectedRole === 'skater' ? skaterGp > 0 : goalieGp > 0`.

Empty state: if filtered list is empty, show `<EmptyPanel message="No career data for {role} yet." />`.

Cell rendering:
- Each `gameTitleName` is a link to `/stats?title={gameTitleSlug}`
- `+/-` colored: green positive, red negative, zinc zero
- `SHT%` rendered as `{value}%` only when not null; otherwise `—`
- `P/GP` computed: `gp > 0 ? (points / gp).toFixed(2) : '—'`
- All numeric cells use `font-condensed tabular-nums`

Styling: match existing tables in the codebase (see `apps/web/src/components/stats/skater-stats-table.tsx`). Same border/header/row patterns.

- [ ] **Step 2: Lint and commit**

```bash
pnpm --filter web lint
git add apps/web/src/components/roster/career-seasons-table.tsx
git commit -m "feat(web): add CareerSeasonsTable component (unified career view)"
```

---

## Task 5: Create `<StatsRecordCard>` tabbed wrapper

Client Component (uses `useState` for tab switching) that wraps `<CareerSeasonsTable>` and `<PlayerGameLogSection>` in a single tabbed card.

**Files:**
- Create: `apps/web/src/components/roster/stats-record-card.tsx`

- [ ] **Step 1: Build the component**

```typescript
'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

type Tab = 'season' | 'game-log'

interface Props {
  seasonTable: ReactNode  // pre-rendered <CareerSeasonsTable>
  gameLog: ReactNode       // pre-rendered <PlayerGameLogSection>
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'season', label: 'Season-by-Season' },
  { key: 'game-log', label: 'Game Log' },
]

export function StatsRecordCard({ seasonTable, gameLog }: Props) {
  const [active, setActive] = useState<Tab>('season')

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-[0.2em] text-zinc-100">
          Stats Record
        </h2>
        <p className="text-[11px] text-zinc-500">
          Career history and per-game appearances.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.map((t) => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setActive(t.key) }}
              className={[
                'border-b-2 px-3 py-2 font-condensed text-xs font-bold uppercase tracking-[0.16em] transition-colors',
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {active === 'season' && seasonTable}
      {active === 'game-log' && gameLog}
    </section>
  )
}
```

The `seasonTable` and `gameLog` props receive **already-rendered** Server Components. This is the standard Next.js pattern for a Client Component that wraps Server Components — pass them as `ReactNode` children/slots, do not import them inside the Client Component.

- [ ] **Step 2: Lint and commit**

```bash
pnpm --filter web lint
git add apps/web/src/components/roster/stats-record-card.tsx
git commit -m "feat(web): add StatsRecordCard tabbed wrapper"
```

---

## Task 6: Create `<ComingSoonCard>` placeholder primitive

**Files:**
- Create: `apps/web/src/components/roster/coming-soon-card.tsx`

- [ ] **Step 1: Build the component**

```typescript
import type { ReactNode } from 'react'

interface Props {
  title: string
  description: string
  icon?: ReactNode
}

export function ComingSoonCard({ title, description, icon }: Props) {
  return (
    <section
      className="space-y-3 rounded border border-dashed border-zinc-700/60 bg-zinc-900/30 p-6"
      aria-label={`${title} (coming soon)`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">
          {title}
        </h2>
        <span className="rounded border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Coming soon
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        {icon !== undefined ? (
          <div className="text-zinc-700" aria-hidden>
            {icon}
          </div>
        ) : null}
        <p className="max-w-md text-xs text-zinc-500">{description}</p>
      </div>
    </section>
  )
}
```

The dashed border + faded background + "Coming soon" pill clearly distinguishes wireframes from real cards. The `icon` slot is optional (so awards card can show a 🏆 placeholder or simply skip).

- [ ] **Step 2: Lint and commit**

```bash
pnpm --filter web lint
git add apps/web/src/components/roster/coming-soon-card.tsx
git commit -m "feat(web): add ComingSoonCard placeholder primitive"
```

---

## Task 7: Build the new `<ProfileHero>` component

The big design task. Replaces `HeroSection` with a richer two-column layout.

**Files:**
- Create: `apps/web/src/components/roster/profile-hero.tsx`

- [ ] **Step 1: Define the contract**

```typescript
import Image from 'next/image'
import Link from 'next/link'
import type { PlayerProfileOverview } from '@eanhl/db/queries'
import type { PlayerGamertagHistoryRow } from '@eanhl/db/queries' // if exported
import type { PlayerCareerSeasonRow } from '@eanhl/db/queries'
import type { PositionUsageRow } from '@eanhl/db/queries'
import { PositionDonut } from '@/components/roster/position-donut' // extracted in Task 7 sub-step
// or re-implement inline if PositionDonut isn't extracted yet

interface Props {
  overview: PlayerProfileOverview
  positionUsage: PositionUsageRow[]
  career: PlayerCareerSeasonRow[]
  history: PlayerGamertagHistoryRow[]
  selectedRole: 'skater' | 'goalie'
  hasSkaterData: boolean
  hasGoalieData: boolean
  gameMode: GameMode | null  // for role-toggle href construction
}
```

- [ ] **Step 2: Build the layout**

Two-column responsive layout. On mobile: stacked. On lg+: 60/40 left/right split.

**Left column — Identity:**
- Optional jersey number background (huge, faded, like the existing hero)
- Player gamertag (5xl, font-condensed, uppercase)
- Pills row: Position abbrev (C/D/LW/RW), Archetype (PLAYMAKER), Country flag/name
- Bio text (3-4 lines max, muted gray)
- AKA strip: `AKA: oldname1, oldname2` — only render if `history.length > 1` (history includes current name + at least one prior). Strip current name; show only prior gamertags. Dim text, small.
- Role selector pills (SKATER / GOALIE), accent-colored when active. Hide if only one role has data.

**Right column — Stats:**

Two stacked stat strips, each with its own sub-header:

1. **THIS SEASON** sub-header. Then a horizontal stat strip:
   - Skater: GP · G · A · PTS · P/GP · +/- · SOG · SHT% · HITS
   - Goalie: GP · W-L-OTL · SV% · GAA · SO · SAVES
   - Source: `currentEaSeason` from overview (NHL 26)
   - PTS column highlighted with accent color (matches existing pattern)

2. **CAREER TOTALS** sub-header with subtitle "Across NHL 22-26". Then a horizontal stat strip:
   - Skater: GP · G · A · PTS · +/- · SOG · HITS · PIM
   - Goalie: GP · W · L · OTL · SV% · GAA · SO · SAVES (note: career SV%/GAA must be re-aggregated, not averaged)
   - Source: aggregate `career` rows where role-relevant GP > 0
   - Aggregate logic:
     - Sums (GP, G, A, PTS, +/-, SOG, HITS, PIM, W, L, OTL, SO, SAVES, total_shots_against, total_goals_against): straight sum across rows
     - Career SV%: `total_saves / total_shots_against * 100` (re-aggregate from totals; do NOT average)
     - Career GAA: requires TOI; if TOI not in career rows, fall back to `total_goals_against / sum(goalieGp) * 60` (60-min normalization). If GAA can't be computed, show `—`.
   - SHT% (skater career): `goals / shots * 100` if shots > 0

3. **POSITION USAGE DONUT** (lg+ only): existing `<PositionDonut>` component, smaller (h-[120px]). Position pills below the donut with their colors from `POSITION_COLORS`.

- [ ] **Step 3: Helper for career aggregation**

Implement a pure helper inside the component file:

```typescript
function aggregateCareer(rows: PlayerCareerSeasonRow[], role: 'skater' | 'goalie') {
  if (role === 'skater') {
    const filtered = rows.filter((r) => r.skaterGp > 0)
    const sum = filtered.reduce(
      (acc, r) => ({
        gp: acc.gp + r.skaterGp,
        g: acc.g + r.goals,
        a: acc.a + r.assists,
        pts: acc.pts + r.points,
        plusMinus: acc.plusMinus + r.plusMinus,
        shots: acc.shots + r.shots,
        hits: acc.hits + r.hits,
        pim: acc.pim + r.pim,
      }),
      { gp: 0, g: 0, a: 0, pts: 0, plusMinus: 0, shots: 0, hits: 0, pim: 0 },
    )
    const sht = sum.shots > 0 ? ((sum.g / sum.shots) * 100).toFixed(1) : null
    return { ...sum, shtPct: sht }
  }

  // goalie
  const filtered = rows.filter((r) => r.goalieGp > 0)
  const sum = filtered.reduce(
    (acc, r) => ({
      gp: acc.gp + r.goalieGp,
      w: acc.w + (r.wins ?? 0),
      l: acc.l + (r.losses ?? 0),
      otl: acc.otl + (r.otl ?? 0),
      so: acc.so + (r.shutouts ?? 0),
    }),
    { gp: 0, w: 0, l: 0, otl: 0, so: 0 },
  )
  // SV% and GAA: not summable from this query shape; show '—' for career
  // (future: extend the query to include total_saves/total_shots_against)
  return { ...sum, savePct: null as string | null, gaa: null as string | null }
}
```

Note: career SV%/GAA show `—` for now since the unified career query doesn't carry total_saves/total_shots_against from historical rows. Acceptable — the per-season tab still shows them per-row.

- [ ] **Step 4: Lint and commit**

```bash
pnpm --filter web lint
git add apps/web/src/components/roster/profile-hero.tsx
git commit -m "feat(web): add ProfileHero component (richer two-column hero)"
```

---

## Task 8: Build `<ChartsVisualsSection>` (real trend chart + 3 wireframes)

**Files:**
- Create: `apps/web/src/components/roster/charts-visuals-section.tsx`

- [ ] **Step 1: Build the wrapper**

```typescript
import type { ReactNode } from 'react'
import { ComingSoonCard } from '@/components/roster/coming-soon-card'

interface Props {
  trendChart: ReactNode  // pre-rendered <TrendChart>
}

export function ChartsVisualsSection({ trendChart }: Props) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-[0.2em] text-zinc-100">
          Charts & Visuals
        </h2>
        <p className="text-[11px] text-zinc-500">
          Trend analysis, shot maps, archetype radar, and awards.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {trendChart}
        <ComingSoonCard
          title="Shot Map"
          description="Goal and shot location heatmap by zone. Data is captured but not yet visualized."
        />
        <ComingSoonCard
          title="Overall Archetype"
          description="Radar visualization of player score across all six contribution dimensions."
        />
        <ComingSoonCard
          title="Awards & Achievements"
          description="Notable career milestones, hat tricks, and team awards."
        />
      </div>
    </section>
  )
}
```

The trend chart component (already extracted in Task 3) is passed as a slot. The 3 placeholder cards use `<ComingSoonCard>`.

- [ ] **Step 2: Lint and commit**

```bash
pnpm --filter web lint
git add apps/web/src/components/roster/charts-visuals-section.tsx
git commit -m "feat(web): add ChartsVisualsSection wrapper (trend + 3 wireframes)"
```

---

## Task 9: Restructure `apps/web/src/app/roster/[id]/page.tsx`

This is the orchestration task. Pull together all the new components and remove the deleted/folded ones.

**Files:**
- Modify: `apps/web/src/app/roster/[id]/page.tsx`

- [ ] **Step 1: Update data fetching**

Add `getPlayerCareerSeasons` to the imports and Promise.all block:

```typescript
import {
  getPlayerProfileOverview,
  getPlayerCareerSeasons,  // NEW
  // ... remove getPlayerCareerStats (no longer used by this page)
  getPlayerGamertagHistory,
  getPlayerGameLog,
  countPlayerGameLog,
  getPlayerEASeasonStats,
  getPlayerPositionUsage,
} from '@eanhl/db/queries'
```

In the `Promise.all`:
```typescript
;[overview, careerSeasons, eaStats, history, gameLog, gameLogTotal] = await Promise.all([
  getPlayerProfileOverview(id),
  getPlayerCareerSeasons(id),  // replaces getPlayerCareerStats
  getPlayerEASeasonStats(id),
  getPlayerGamertagHistory(id),
  getPlayerGameLog(id, gameMode, LOG_PAGE_SIZE, logOffset),
  countPlayerGameLog(id, gameMode),
])
```

Remove the existing logic that builds `previousSeasonTotals` from `getHistoricalSkaterStatsAllModes`/`getHistoricalGoalieStatsAllModes` — it's no longer needed (data folds into careerSeasons).

Remove the `getGameTitleBySlug(previousSeasonSlug)` lookup and the `previousTitleSlug()` helper (no longer used).

- [ ] **Step 2: Update imports**

Add:
```typescript
import { ProfileHero } from '@/components/roster/profile-hero'
import { RecentFormStrip } from '@/components/roster/recent-form-strip'
import { TrendChart } from '@/components/roster/trend-chart'
import { CareerSeasonsTable } from '@/components/roster/career-seasons-table'
import { StatsRecordCard } from '@/components/roster/stats-record-card'
import { ContributionSection } from '@/components/roster/contribution-section'
import { ChartsVisualsSection } from '@/components/roster/charts-visuals-section'
import { ClubStatsTabs } from '@/components/roster/club-stats-tabs'
```

Remove imports of components that are deleted: `HeroSection` (now ProfileHero), `TrendSection`, `CareerStatsTable`, `EASeasonStatsTable`, `PreviousSeasonStatsTable`.

- [ ] **Step 3: Replace the JSX render block**

The new `return` shape from line 174 onward:

```tsx
return (
  <div className="space-y-8">
    <Link
      href="/roster"
      className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
    >
      <span aria-hidden>←</span> Roster
    </Link>

    <ProfileHero
      overview={overview}
      positionUsage={positionUsage}
      career={careerSeasons}
      history={history}
      selectedRole={selectedRole}
      hasSkaterData={hasSkaterData}
      hasGoalieData={hasGoalieData}
      gameMode={gameMode}
    />

    {hasNoLocalData && (
      <div className="rounded border border-zinc-700 bg-zinc-900 px-4 py-3">
        <p className="text-sm text-zinc-400">
          <span className="font-semibold text-zinc-300">No local match history yet.</span> This
          player is registered but has not appeared in a tracked match. EA season totals may still
          show while local sections stay empty.
        </p>
      </div>
    )}

    <RecentFormStrip recentForm={selectedRecentForm} selectedRole={selectedRole} />

    <StatsRecordCard
      seasonTable={<CareerSeasonsTable seasons={careerSeasons} selectedRole={selectedRole} />}
      gameLog={
        <PlayerGameLogSection
          rows={gameLog}
          total={gameLogTotal}
          page={logPage}
          pageSize={LOG_PAGE_SIZE}
          gameMode={gameMode}
        />
      }
    />

    {selectedRole === 'skater' && eaStats[0] && <ClubStatsTabs season={eaStats[0]} />}
    {selectedRole === 'goalie' && (
      <ComingSoonCard
        title="Goalie Club Stats"
        description="Goalie Overview, Saves, and Situations tabs (matching ChelHead Tabs 6-8) coming in a future update."
      />
    )}

    <ContributionSection contribution={selectedContribution} selectedRole={selectedRole} />

    <ChartsVisualsSection
      trendChart={
        trendGames.length > 0 ? (
          <TrendChart trendGames={trendGames} selectedRole={selectedRole} />
        ) : (
          <ComingSoonCard
            title="Recent Form Trend"
            description="Per-game performance bars for the last 15 appearances. Will populate once enough game data is available."
          />
        )
      }
    />
  </div>
)
```

- [ ] **Step 4: Delete now-unused inline code**

After the render block change, delete:
- The whole `function HeroSection(...)` block
- `function CurrentSeasonSection(...)`
- `function TrendSection(...)`
- `function ContributionSection(...)`, `function ContributionDonut(...)`, `function MetricBar(...)`, `CONTRIBUTION_COLORS` const (already extracted in Task 2 — confirm gone)
- `function CareerStatsTable(...)`
- `function EASeasonStatsTable(...)`
- `function PreviousSeasonStatsTable(...)`
- `function buildPreviousSeasonTotals(...)`
- `interface PreviousSeasonTotalsRow`
- `function PositionDonut(...)` and `POSITION_COLORS` (re-locate to its own file `apps/web/src/components/roster/position-donut.tsx` so ProfileHero can import it)
- `function previousTitleSlug(...)` (was used to derive prior-season slug)
- The "Gamertag History" rendering block (now in hero AKA)

The page should end up under 500 lines.

- [ ] **Step 5: Lint and build**

```bash
pnpm --filter web lint
pnpm build
```

Both must be clean. Common breakage points:
- Unused imports lint error → remove imports for deleted components
- Type errors on `careerSeasons` → confirm `PlayerCareerSeasonRow` is exported from `@eanhl/db/queries` (Task 1)
- `PositionDonut` import broken → file was inline in page.tsx; extract first then import

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/roster/[id]/page.tsx apps/web/src/components/roster/position-donut.tsx
git commit -m "refactor(web): restructure player profile page with new IA"
```

---

## Task 10: Smoke check and verify the new layout end-to-end

**Files:** none modified — verification only

- [ ] **Step 1: Start dev server**

```bash
rm -rf apps/web/.next
pnpm --filter web dev &> /tmp/web-dev-restructure.log &
sleep 8 && grep -E "Ready in|Local:" /tmp/web-dev-restructure.log
```

Note the port (likely 3000-3010 range).

- [ ] **Step 2: Skater profile smoke check**

In a Chrome DevTools MCP session:
1. Navigate to `/roster/2` (silkyjoker85). Resize to 1440×900.
2. Take a full-page screenshot.
3. Verify visually:
   - Hero shows: SILKYJOKER85, #10, C+PLAYMAKER+CANADA pills, bio, AKA: Utiz23, SKATER role active
   - Right column: THIS SEASON strip with GP 545, G 426, A 691, PTS 1117 (red), P/GP, +/-, etc.
   - CAREER TOTALS strip: GP higher than 545 (NHL 22-26 sum), G higher than 426, etc.
   - Position donut visible on lg+
4. Recent Form strip below hero — 5 dots, record, G/A, +/-, best recent
5. Stats Record card with two tabs: "Season-by-Season" (default) and "Game Log"
   - Season tab: rows for NHL 26 (EA badge), NHL 25, NHL 24, NHL 23, NHL 22 (Archive badges)
   - Game Log tab: existing PlayerGameLogSection content
   - Click both tabs and verify content switches
6. Club Stats Tabs (5 tabs, existing) — verify still works
7. Contribution donut + metric bars — existing
8. Charts & Visuals section: real trend chart + 3 dashed-border "Coming soon" cards (Shot Map, Overall Archetype, Awards)

- [ ] **Step 3: Goalie profile smoke check (silkyjoker85 has goalie GP)**

1. Navigate to `/roster/2?role=goalie`
2. Verify:
   - Hero stats column shows goalie THIS SEASON (W-L-OTL, SV%, GAA, SO)
   - Hero CAREER TOTALS shows goalie aggregate (or `—` for SV%/GAA per spec)
   - Stats Record → Season-by-Season tab shows goalie columns (W L OTL SV% GAA SO)
   - Club Stats Tabs replaced with "Goalie Club Stats coming soon" placeholder
   - Contribution still renders (goalie contribution)
   - Charts & Visuals section unchanged (trend chart role-filters to goalie SV% bars)

- [ ] **Step 4: Mobile/tablet smoke check**

Resize to 768×1024 and verify hero stacks (identity column above stats column), Charts grid collapses to 1 column, all sections remain readable.

- [ ] **Step 5: Update HANDOFF.md**

Append a new session summary to `HANDOFF.md`:

```markdown
## Session Summary — 2026-05-XX (player profile restructure)

### Restructured /roster/[id] into the v2 IA

[Full description following the existing HANDOFF format]
```

- [ ] **Step 6: Commit HANDOFF**

```bash
git add HANDOFF.md
git commit -m "docs(handoff): record player profile restructure completion"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `pnpm --filter web lint` clean
- [ ] `pnpm build` 4/4 tasks succeed
- [ ] `/roster/2` (skater) renders new layout end-to-end with real silkyjoker85 data
- [ ] `/roster/2?role=goalie` renders goalie variant
- [ ] No console errors in browser dev tools
- [ ] Page file (`apps/web/src/app/roster/[id]/page.tsx`) is under 500 lines
- [ ] No regressions: existing Club Stats Tabs, Contribution donut, Position donut, Game Log all functional
- [ ] HANDOFF.md updated

---

## Risks and Mitigations

**Risk:** Historical reviewed data uses different column names than EA stats (e.g., `shooting_pct` vs `shot_pct`)  
**Mitigation:** Task 1 Step 2 explicitly checks the historical schema. Adjust query field references to match the schema, never edit the schema.

**Risk:** Career SV%/GAA can't be computed without total_saves/total_shots_against in historical rows  
**Mitigation:** Plan documents the fallback (show `—`). Acceptable per user spec; per-season tab still shows them per row. Can extend the unified query in a follow-up if better aggregation is needed.

**Risk:** Page restructure breaks existing role-toggle URL behavior  
**Mitigation:** `selectedRole` and `urlRole` parsing logic is preserved in Task 9 — only the JSX changes. The role pill in the hero still flips `?role=` URL param.

**Risk:** Server Component → Client Component pass-through (StatsRecordCard receiving pre-rendered children) doesn't work with current Next.js 15 patterns  
**Mitigation:** This is the documented Next.js pattern. If hot reload breaks during dev, the production build's still correct — we verified the same pattern works in ClubStatsTabs.

**Risk:** Goalie role shows the new layout sections that haven't been built (no goalie career table support, no goalie hero stat strip)  
**Mitigation:** ProfileHero handles goalie role internally — same component, different stat strip selection. Career table component handles `selectedRole==='goalie'` filter. The only goalie-specific placeholder is the Club Stats one (covered in Task 9 Step 3 with a `<ComingSoonCard>`).

**Risk:** Refactor accidentally breaks an unrelated page that consumed `getPlayerCareerStats`  
**Mitigation:** Before deleting `getPlayerCareerStats` from imports, grep for other consumers:  
```bash
grep -rn "getPlayerCareerStats\|PlayerCareerRow" apps/ packages/ | grep -v "queries/players.ts" | grep -v ".d.ts"
```
If consumers exist, keep `getPlayerCareerStats` as-is (just stop importing it on this page).

---

## Out of Scope (Future Plans)

1. **Goalie Club Stats Tabs (Tabs 6-8)** — separate plan, parallel to skater Club Stats. Adds ~30 goalie columns to `ea_member_season_stats` plus a `<GoalieClubStatsTabs>` component.
2. **Real Shot Map** — separate plan: ingest the spatial location fields (`skGoalsLocationOnIce1-16`, `skShotsLocationOnIce1-16`) into a new column or table, build a rink-overlay heatmap component.
3. **Real Overall Archetype radar** — separate plan: define the 6-axis archetype score using existing contribution data, render an SVG radar chart (similar pattern to PositionDonut).
4. **Real Awards** — separate plan: define award triggers (career milestones, hat tricks, best season records) as derived data, build a trophy-strip UI.
5. **Career SV%/GAA aggregation** — would require extending `getPlayerCareerSeasons` to include `total_saves`, `total_shots_against`, `total_goals_against` per row, then computing properly weighted career rates.
6. **Backfilling player_id matches in historical_player_season_stats** — some legacy rows may have null player_id; those silently won't show in career view.
