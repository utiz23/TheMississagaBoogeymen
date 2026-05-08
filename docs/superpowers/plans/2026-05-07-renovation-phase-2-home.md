# Phase 2: Home Page IA Reorder + Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the home page IA to put the design-system's 5 priority sections in the bundle's intended order, restyle every existing section to use the Phase 1 primitives + design-system voice/typography/spacing, and add a new RECORD STRIP section (the only structurally new piece). End state: the home page renders in the broadcast-strip aesthetic with sharp panels, UPPERCASE wide-tracked labels, tabular numerals, BroadcastPanel decoration on the hero + leaders, and the agreed 7-section IA.

**Architecture:** Component-internal restyle first (each home component refactored to use Phase 1 primitives + tightened visual), then page.tsx orchestration last (replace inline section headers with `<SectionHeader>`, wire in the new `<ClubRecordSection>`, reorder per the locked IA). RecentGamesStrip is extracted out of `page.tsx` to its own file as part of the restyle to keep the page file focused on orchestration. No data-shape changes — all existing queries (`getClubStats`, `getOfficialClubRecord`, `getRoster`, etc.) are reused as-is.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript strict, Tailwind CSS 4. Phase 1 primitives at `apps/web/src/components/ui/{panel,broadcast-panel,section-header,result-pill,stat-strip}.tsx` + the helper at `apps/web/src/lib/result-colors.ts` are the design surface. No new dependencies.

**Working assumptions:**
- Current branch: `feat/design-system-renovation`. Phase 1 primitives are landed (HEAD commit cluster 7218e4f..998a7bd).
- The renovation spec at `docs/superpowers/specs/2026-05-07-boogeymen-renovation-design.md` is authoritative for Phase 2 scope.
- Run all commands from the repo root: `/home/michal/projects/eanhl-team-website`.
- Locked IA decisions for Phase 2 (from brainstorm session 2026-05-07):
  - **Keep** Roster Spotlight carousel.
  - **Keep** Title Records cross-title comparison table.
  - **Final order:** Header → LATEST RESULT → ROSTER SPOTLIGHT → SCORING LEADERS → CLUB RECORD STRIP → SEASON RANK → RECENT RESULTS → TITLE RECORDS.

**Out of scope:**
- Goalie-side roster spotlight changes (carousel cards already restyled in Phase 0).
- Any `apps/web/src/components/matches/*` changes (that's Phase 4).
- Any roster profile (`/roster/[id]`) changes (that's Phase 3).
- Mode filter relocation beyond what's needed for the RECORD STRIP section header (it stays controlling all mode-dependent data on the page; visual placement moves to RECORD STRIP per staged bundle).
- New data queries / schema migrations.
- Removing the kitchen-sink page (that's Phase 6).

---

## File Map

**New files this phase creates:**

| Path | Responsibility | Approx LOC |
|---|---|---|
| `apps/web/src/components/home/club-record-section.tsx` | New `<ClubRecordSection>` — section header + mode filter + record strip variants. Wraps StatStrip primitive. | 130 |
| `apps/web/src/components/home/recent-games-strip.tsx` | Extracted recent-games-strip; `<RecentGamesStrip>` — uses ResultPill primitive | 70 |
| `apps/web/src/components/home/record-mode-filter.tsx` | Extracted `<RecordModeFilter>` — segmented pill filter (All / 6s / 3s) shared between RECORD STRIP and ROSTER SPOTLIGHT sections | 50 |

**Files modified:**
- `apps/web/src/app/page.tsx` — orchestrator only after Task 8: replace inline section headers with `<SectionHeader>`, replace inline `RecentGamesStrip`/`RecordGameModeFilter` with extracted components, wire in `<ClubRecordSection>`, reorder per locked IA. Will end up around 280–320 lines (down from 487).
- `apps/web/src/components/home/latest-result.tsx` — replace inline `ResultPill` + hand-rolled CSS panel with the `BroadcastPanel` + `ResultPill` + `SectionHeader` primitives. Drop the local pill helper.
- `apps/web/src/components/home/leaders-section.tsx` — replace inline `.broadcast-panel` class + inline header markup with `BroadcastPanel` + `SectionHeader` primitives. Tighten visual to match `components-leaders.html` (spotlight border, row hover/selected states, value typography). Structure (4-column grid) stays.
- `apps/web/src/components/home/season-rank-widget.tsx` — wrap in `Panel`, swap inline labels to UPPERCASE/tabular treatment per design system.

**Files unchanged:**
- `apps/web/src/components/home/player-card.tsx`, `player-carousel.tsx`, `title-records-table.tsx` — Phase 0 work + restyling here would be out of scope; light header swap on the carousel + table sections happens in `page.tsx`.
- All Phase 1 primitives.

---

## Task 1: Extract `<RecordModeFilter>` segmented pill

The current `RecordGameModeFilter` is defined inline in `page.tsx` (lines 313–355). The new `<ClubRecordSection>` (Task 2) needs it; the existing roster-spotlight callsite will use it too. Extract first so both consumers can import a stable component.

**Files:**
- Create: `apps/web/src/components/home/record-mode-filter.tsx`

- [ ] **Step 1: Create the component**

Write to `apps/web/src/components/home/record-mode-filter.tsx`:

```tsx
import Link from 'next/link'
import type { GameMode } from '@eanhl/db'

const RECORD_MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function recordModeHref(mode: GameMode | null, titleSlug: string | undefined): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (mode !== null) qs.set('mode', mode)
  const s = qs.toString()
  return `/${s ? `?${s}` : ''}`
}

interface RecordModeFilterProps {
  titleSlug: string | undefined
  activeMode: GameMode | null
}

/**
 * Segmented pill filter — All / 6s / 3s. Drives the page's `?mode=` param,
 * which in turn filters the roster, leaders, and club-record aggregates.
 * Active pill: accent border + accent/10 fill + accent text.
 */
export function RecordModeFilter({ titleSlug, activeMode }: RecordModeFilterProps) {
  return (
    <div className="flex gap-1">
      {RECORD_MODE_LABELS.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={recordModeHref(mode, titleSlug)}
            className={[
              'rounded border px-3 py-1 font-condensed text-xs font-semibold uppercase tracking-wider transition-colors',
              isActive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-zinc-700 bg-transparent text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (no consumer yet).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/home/record-mode-filter.tsx
git commit -m "$(cat <<'EOF'
feat(web): extract RecordModeFilter segmented pill component

Pulls the All / 6s / 3s mode filter out of page.tsx into its own home
component. Will be consumed by the new ClubRecordSection in the next
task and (in Task 8) re-wired into the existing roster-spotlight
header callsite.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): extract RecordModeFilter ...` is HEAD.

---

## Task 2: Add `<ClubRecordSection>` — the new RECORD STRIP

This is the only structurally new piece on the home page in Phase 2. Wraps a `<SectionHeader>` + `<RecordModeFilter>` + a `<StatStrip>`-driven record strip with three variants (all-modes EA-official, all-modes-fallback when official is missing, mode-filtered local).

**Files:**
- Create: `apps/web/src/components/home/club-record-section.tsx`

- [ ] **Step 1: Create the component**

Write to `apps/web/src/components/home/club-record-section.tsx`:

```tsx
import type { ClubGameTitleStats, ClubSeasonalStats, GameMode } from '@eanhl/db'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { StatStrip, type StatStripItem } from '@/components/ui/stat-strip'
import { RecordModeFilter } from './record-mode-filter'

/** Win% as "78.3". Returns "—" when no games played. */
function winPctValue(wins: number, losses: number, otl: number): string {
  const total = wins + losses + otl
  if (total === 0) return '—'
  return ((wins / total) * 100).toFixed(1)
}

interface ClubRecordSectionProps {
  gameMode: GameMode | null
  titleSlug: string | undefined
  /** EA-official seasonal record for the all-modes view. Null when not yet fetched / unavailable. */
  officialRecord: ClubSeasonalStats | null
  /** Local aggregate; used for GF/GA in all-modes view, and as the full source for mode-filtered views. */
  localStats: ClubGameTitleStats | null
}

/**
 * CLUB RECORD strip — section header (with mode filter on the right) + a
 * StatStrip rendering W / L / OTL / Win% / GP / GF / GA.
 *
 * Three variants based on (gameMode, officialRecord, localStats):
 * - all-modes + EA-official available: WIN/L/OTL/Win%/GP from official, GF/GA from local. Provenance: "EA official".
 * - all-modes + EA-official unavailable: empty state with optional local GF/GA. Provenance: "Official record not yet available".
 * - mode-filtered: full strip from local aggregate. Provenance: "local · {mode} only".
 */
export function ClubRecordSection({
  gameMode,
  titleSlug,
  officialRecord,
  localStats,
}: ClubRecordSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader label="Club Record" />
        <RecordModeFilter titleSlug={titleSlug} activeMode={gameMode} />
      </div>

      {gameMode === null ? (
        officialRecord !== null ? (
          <RecordStrip officialRecord={officialRecord} localStats={localStats} />
        ) : (
          <UnavailableRecordStrip localStats={localStats} />
        )
      ) : localStats !== null && localStats.gamesPlayed > 0 ? (
        <LocalModeRecordStrip stats={localStats} gameMode={gameMode} />
      ) : (
        <Panel className="flex items-center justify-center py-5">
          <p className="text-sm text-zinc-500">No {gameMode} games recorded yet.</p>
        </Panel>
      )}
    </section>
  )
}

function RecordStrip({
  officialRecord,
  localStats,
}: {
  officialRecord: ClubSeasonalStats
  localStats: ClubGameTitleStats | null
}) {
  const items: StatStripItem[] = [
    { label: 'W', value: officialRecord.wins.toString(), accent: true },
    { label: 'L', value: officialRecord.losses.toString() },
    { label: 'OTL', value: officialRecord.otl.toString(), dim: officialRecord.otl === 0 },
    {
      label: 'Win%',
      value: winPctValue(officialRecord.wins, officialRecord.losses, officialRecord.otl),
      accent: true,
    },
    { label: 'GP', value: officialRecord.gamesPlayed.toString() },
  ]

  if (localStats !== null && localStats.gamesPlayed > 0) {
    items.push(
      { label: 'GF', value: localStats.goalsFor.toString() },
      { label: 'GA', value: localStats.goalsAgainst.toString() },
    )
  }

  if (officialRecord.rankingPoints !== null) {
    items.push({ label: 'Pts', value: officialRecord.rankingPoints.toString() })
  }

  return (
    <Panel className="px-5 py-4">
      <StatStrip items={items} provenance="EA official" />
    </Panel>
  )
}

function UnavailableRecordStrip({ localStats }: { localStats: ClubGameTitleStats | null }) {
  const items: StatStripItem[] = []
  if (localStats !== null && localStats.gamesPlayed > 0) {
    items.push(
      { label: 'GF', value: localStats.goalsFor.toString(), dim: true },
      { label: 'GA', value: localStats.goalsAgainst.toString(), dim: true },
      { label: 'Ingested GP', value: localStats.gamesPlayed.toString(), dim: true },
    )
  }

  return (
    <Panel className="px-5 py-4">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
        Official record not yet available
      </p>
      {items.length > 0 ? <StatStrip className="mt-3" items={items} /> : null}
    </Panel>
  )
}

function LocalModeRecordStrip({
  stats,
  gameMode,
}: {
  stats: ClubGameTitleStats
  gameMode: GameMode
}) {
  const items: StatStripItem[] = [
    { label: 'W', value: stats.wins.toString(), accent: true },
    { label: 'L', value: stats.losses.toString() },
    { label: 'OTL', value: stats.otl.toString(), dim: stats.otl === 0 },
    {
      label: 'Win%',
      value: winPctValue(stats.wins, stats.losses, stats.otl),
      accent: true,
    },
    { label: 'GP', value: stats.gamesPlayed.toString() },
    { label: 'GF', value: stats.goalsFor.toString() },
    { label: 'GA', value: stats.goalsAgainst.toString() },
  ]

  return (
    <Panel className="px-5 py-4">
      <StatStrip items={items} provenance={`local · ${gameMode} only`} />
    </Panel>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (consumer wiring happens in Task 8).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/home/club-record-section.tsx
git commit -m "$(cat <<'EOF'
feat(web): add ClubRecordSection — RECORD STRIP for the home page

New section combining a SectionHeader, the extracted RecordModeFilter,
and a StatStrip-driven record line with three variants: EA-official
(all-modes), unavailable fallback, and mode-filtered local. Wires the
Phase 1 StatStrip + Panel + SectionHeader primitives into the design-
system's record-strip pattern.

Consumer wiring into page.tsx happens in Task 8.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add ClubRecordSection ...` is HEAD.

---

## Task 3: Restyle `<LatestResult>` — BroadcastPanel + ResultPill primitives

Replace the hand-rolled `.broadcast-panel`-style CSS literal + the inline result pill helper with Phase 1 primitives. Visual output should be ~unchanged; the diff is structural.

**Files:**
- Modify: `apps/web/src/components/home/latest-result.tsx`

- [ ] **Step 1: Replace the file**

Write the entire new contents to `apps/web/src/components/home/latest-result.tsx`:

```tsx
import Link from 'next/link'
import type { Match } from '@eanhl/db'
import Image from 'next/image'
import { formatMatchDate, formatRecord, abbreviateTeamName, formatTOA, opponentFaceoffPct } from '@/lib/format'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { ResultPill } from '@/components/ui/result-pill'

const OUR_NAME = 'Boogeymen'

interface LatestResultProps {
  match: Match
  clubRecord: { wins: number; losses: number; otl: number } | null
  /** EA crest asset ID for the opponent club. Null falls back to initial badge. */
  opponentCrestAssetId: string | null
  /** EA customKit.useBaseAsset flag for the opponent crest. */
  opponentCrestUseBaseAsset: string | null
}

function SnapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
        {label}
      </span>
      <span className="font-condensed text-sm font-bold tabular-nums text-zinc-300">{value}</span>
    </div>
  )
}

function MatchSnapshot({ match }: { match: Match }) {
  const foOurs =
    match.faceoffPct !== null ? Math.round(parseFloat(match.faceoffPct)).toString() : null
  const foOpponent = opponentFaceoffPct(match.faceoffPct)
  const foTheirs =
    foOpponent !== null ? Math.round(parseFloat(foOpponent)).toString() : null
  const toa = match.timeOnAttack !== null ? formatTOA(match.timeOnAttack) : null
  const showFO = foOurs !== null && foTheirs !== null

  return (
    <div className="border-t border-zinc-800/60 px-5 py-3 sm:px-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <SnapStat
          label="Shots"
          value={`${match.shotsFor.toString()} – ${match.shotsAgainst.toString()}`}
        />
        <SnapStat
          label="Hits"
          value={`${match.hitsFor.toString()} – ${match.hitsAgainst.toString()}`}
        />
        {showFO && <SnapStat label="FO%" value={`${foOurs} – ${foTheirs}`} />}
        {toa !== null && <SnapStat label="TOA" value={toa} />}
        <span className="ml-auto hidden font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-700 sm:inline">
          Boogeymen – Opp
        </span>
      </div>
    </div>
  )
}

export function LatestResult({
  match,
  clubRecord,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
}: LatestResultProps) {
  const opponentAbbrev = abbreviateTeamName(match.opponentName)
  const ourScoreColor = match.result === 'WIN' ? 'text-accent' : 'text-zinc-100'
  const opponentScoreColor =
    match.result === 'LOSS' || match.result === 'OTL' ? 'text-red-300' : 'text-zinc-500'

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block transition-[border-color,transform,background-color] hover:[&>div]:border-zinc-700"
    >
      <BroadcastPanel className="group-hover:bg-surface-raised">
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
          <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Latest Result
          </span>
          <span className="font-condensed text-xs uppercase tracking-wider text-zinc-600">
            {formatMatchDate(match.playedAt)}
          </span>
        </div>

        <div className="grid gap-5 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          {/* Our side */}
          <div className="flex flex-col items-center justify-center gap-3 border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[18.5rem]">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-zinc-800 bg-black/20 sm:h-28 sm:w-28">
              <Image
                src="/images/bgm-logo.png"
                alt="Boogeymen"
                width={96}
                height={96}
                className="h-20 w-20 object-contain sm:h-24 sm:w-24"
              />
            </div>
            <span className="font-condensed text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
              {OUR_NAME}
            </span>
            {clubRecord !== null ? (
              <span className="font-condensed text-base font-semibold tabular-nums tracking-[0.12em] text-zinc-400">
                {formatRecord(clubRecord.wins, clubRecord.losses, clubRecord.otl)}
              </span>
            ) : null}
          </div>

          {/* Score */}
          <div className="flex min-w-0 flex-col items-center justify-center gap-4 px-2 py-2 text-center lg:min-w-[18rem]">
            <div className="font-condensed text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-600">
              Featured Scoreboard
            </div>
            <div className="flex items-center justify-center gap-2 font-condensed font-black tabular-nums leading-none sm:gap-3">
              <span className={`text-[4.5rem] sm:text-[5.75rem] ${ourScoreColor}`}>
                {match.scoreFor.toString()}
              </span>
              <span className="text-3xl text-zinc-700 sm:text-5xl">–</span>
              <span className={`text-[4.5rem] sm:text-[5.75rem] ${opponentScoreColor}`}>
                {match.scoreAgainst.toString()}
              </span>
            </div>
            <ResultPill result={match.result} size="md" />
            <div className="font-condensed text-xs font-medium uppercase tracking-[0.18em] text-zinc-600">
              Final
            </div>
          </div>

          {/* Opponent side */}
          <div className="flex flex-col items-center justify-center gap-3 border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[18.5rem]">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 sm:h-28 sm:w-28">
              <OpponentCrest
                crestAssetId={opponentCrestAssetId}
                useBaseAsset={opponentCrestUseBaseAsset}
                alt={match.opponentName}
                width={96}
                height={96}
                className="h-20 w-20 object-contain sm:h-24 sm:w-24"
                fallback={
                  <span
                    aria-hidden
                    className="font-condensed text-3xl font-black uppercase tracking-tight text-zinc-400 sm:text-4xl"
                  >
                    {opponentAbbrev.slice(0, 2)}
                  </span>
                }
              />
            </div>
            <span className="font-condensed text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
              {opponentAbbrev}
            </span>
          </div>
        </div>

        <MatchSnapshot match={match} />
      </BroadcastPanel>
    </Link>
  )
}
```

Key changes from previous version:
- Removes the local `RESULT_PILL_CONFIG` and `ResultPill` helper — uses the new `ResultPill` from `@/components/ui/result-pill` at `size="md"`.
- Removes the hand-rolled radial-gradient + linear-gradient inline `className` literal — uses `<BroadcastPanel>` (which carries the same gradients via the `.broadcast-panel` CSS class + ticker).
- Drops the old hand-rolled top ticker bar (`<div className="h-1 w-full bg-gradient-to-r from-red-900 via-red-600 to-red-900" />`) — `BroadcastPanel` renders its own ticker.
- Inner side panels lose `rounded-xl` to align with the design system's "no soft cards" rule (they were corner-radius-12; design system says `rounded-none`). The 1px border + dark fill stays.
- Em-dash separator between scores changed from `-` to `–` (en-dash) per design system: en-dash for numeric splits.
- Date pill on the section header gets `font-condensed uppercase tracking-wider` to match the system's voice.
- Imports `MatchResult` is no longer needed (the helper was removed).

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/home/latest-result.tsx
git commit -m "$(cat <<'EOF'
refactor(web): rebuild LatestResult with Phase 1 primitives

Swaps the hand-rolled .broadcast-panel-style CSS literal + inline
ResultPill helper for the BroadcastPanel and ResultPill primitives.
Drops rounded-xl on the team-side panels (per design-system "no soft
cards" rule), changes the score separator from "-" to en-dash, and
tightens date label voice to match the system. Visual output should
be near-identical; structural diff only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): rebuild LatestResult ...` is HEAD.

---

## Task 4: Restyle `<ScoringLeadersPanel>` — primitives + spotlight tightening

Replace the inline `.broadcast-panel` markup + hand-rolled header with `BroadcastPanel` + `SectionHeader`. The 4-column grid structure (Points hero | Points list | Goals hero | Goals list) stays — it already matches the bundle's "hero #1 + list" pattern. Tighten visual details: spotlight border, row hover/selected states, value typography per `components-leaders.html`.

**Files:**
- Modify: `apps/web/src/components/home/leaders-section.tsx`

- [ ] **Step 1: Replace the file**

Write the entire new contents to `apps/web/src/components/home/leaders-section.tsx`:

```tsx
import Link from 'next/link'
import type { GameMode } from '@eanhl/db'
import type { RosterRow } from './player-card'
import { PlayerSilhouette } from './player-card'
import { formatPosition } from '@/lib/format'
import { PositionPill } from '@/components/matches/position-pill'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { SectionHeader } from '@/components/ui/section-header'

interface ScoringLeadersPanelProps {
  pointsLeaders: RosterRow[]
  goalsLeaders: RosterRow[]
  gameMode?: GameMode | null
  source?: string
}

/**
 * Scoring Leaders panel — home page stats showcase.
 *
 * Layout: 4 equal columns — Points hero | Points list | Goals hero | Goals list.
 * On mobile (< sm) the two hero columns stack on top, lists below (grid-cols-2).
 *
 * Design decision: the #1 player appears in BOTH the hero block and as the
 * first row of the ranked list. The hero provides visual emphasis; the full
 * list (starting from #1) shows the gaps to #2, #3, etc. without ambiguity.
 */
export function ScoringLeadersPanel({
  pointsLeaders,
  goalsLeaders,
  gameMode,
  source,
}: ScoringLeadersPanelProps) {
  if (pointsLeaders.length === 0 && goalsLeaders.length === 0) return null

  const pointsFeature = pointsLeaders[0] ?? null
  const goalsFeature = goalsLeaders[0] ?? null
  const sectionLabel = gameMode != null ? `${gameMode} Scoring Leaders` : 'Scoring Leaders'
  const ctaHref = gameMode != null ? `/stats?mode=${gameMode}` : '/stats'

  return (
    <BroadcastPanel>
      <div className="flex flex-col gap-1 border-b border-zinc-800/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <SectionHeader label={sectionLabel} />
          {source ? (
            <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
              {source}
            </span>
          ) : null}
        </div>
        {/* CTA renders manually here — SectionHeader's CTA can't co-exist with the source line. */}
        <Link
          href={ctaHref}
          className="font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-100"
        >
          View all stats <span aria-hidden>→</span>
        </Link>
      </div>

      {/* 4-column grid: Points hero | Points list | Goals hero | Goals list */}
      <div className="grid grid-cols-2 divide-x divide-zinc-800/60 bg-[linear-gradient(180deg,rgba(24,24,27,0.88),rgba(9,9,11,1))] sm:grid-cols-4">
        <div className="p-4">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Points
          </h3>
          {pointsFeature === null ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <FeaturedPlayerBlock player={pointsFeature} statLabel="Points" statKey="points" />
          )}
        </div>

        <div className="p-4">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            &nbsp;
          </h3>
          <ol className="flex flex-col gap-1" aria-label="Points leaderboard">
            {pointsLeaders.map((player, idx) => (
              <LeaderRow
                key={player.playerId}
                rank={idx + 1}
                player={player}
                statKey="points"
                isFirst={idx === 0}
              />
            ))}
          </ol>
        </div>

        <div className="border-t border-zinc-800/60 p-4 sm:border-t-0">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Goals
          </h3>
          {goalsFeature === null ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <FeaturedPlayerBlock player={goalsFeature} statLabel="Goals" statKey="goals" />
          )}
        </div>

        <div className="border-t border-zinc-800/60 p-4 sm:border-t-0">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            &nbsp;
          </h3>
          <ol className="flex flex-col gap-1" aria-label="Goals leaderboard">
            {goalsLeaders.map((player, idx) => (
              <LeaderRow
                key={player.playerId}
                rank={idx + 1}
                player={player}
                statKey="goals"
                isFirst={idx === 0}
              />
            ))}
          </ol>
        </div>
      </div>
    </BroadcastPanel>
  )
}

function FeaturedPlayerBlock({
  player,
  statLabel,
  statKey,
}: {
  player: RosterRow
  statLabel: string
  statKey: 'points' | 'goals'
}) {
  const pos = player.position ? formatPosition(player.position) : null

  return (
    <Link
      href={`/roster/${player.playerId.toString()}`}
      className="group flex w-full flex-col items-center gap-1.5"
      aria-label={`${statLabel} leader: ${player.gamertag}, ${player[statKey].toString()} ${statLabel.toLowerCase()}`}
    >
      <div className="relative flex h-20 w-full items-end justify-center overflow-hidden border border-accent/30 bg-[radial-gradient(circle_at_top,rgba(225,29,72,0.20),transparent_55%),linear-gradient(180deg,rgba(24,24,27,0.9),rgba(9,9,11,1))]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <PlayerSilhouette className="text-zinc-700" sizeClass="h-[82px] w-[82px]" />
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <span className="line-clamp-2 max-w-full font-condensed text-xs font-black uppercase leading-tight tracking-wide text-zinc-100 transition-colors group-hover:text-accent">
          {player.gamertag}
        </span>
        {pos !== null && (
          <PositionPill label={pos} position={player.position} isGoalie={player.position === 'goalie'} />
        )}
      </div>

      <div className="mt-1 flex flex-col items-center gap-0.5">
        <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/70">
          {statLabel}
        </span>
        <span className="font-condensed text-5xl font-black leading-none tabular-nums text-zinc-50 drop-shadow-[0_0_14px_rgba(225,29,72,0.18)]">
          {player[statKey].toString()}
        </span>
      </div>
    </Link>
  )
}

function LeaderRow({
  rank,
  player,
  statKey,
  isFirst,
}: {
  rank: number
  player: RosterRow
  statKey: 'points' | 'goals'
  isFirst: boolean
}) {
  return (
    <li>
      <Link
        href={`/roster/${player.playerId.toString()}`}
        className={[
          'flex items-center gap-2 border px-2 py-1.5 transition-colors',
          isFirst
            ? 'border-accent/55 bg-accent/8 shadow-[inset_2px_0_0_var(--color-accent)] hover:border-accent/70'
            : 'border-zinc-800/70 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-800/60',
        ].join(' ')}
        aria-label={`Rank ${rank.toString()}, ${player.gamertag}, ${player[statKey].toString()} ${statKey}`}
      >
        <span
          className={`w-5 shrink-0 font-condensed text-xs font-bold tabular-nums ${isFirst ? 'text-accent' : 'text-zinc-500'}`}
        >
          {rank.toString()}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-condensed text-xs font-semibold ${isFirst ? 'text-zinc-100' : 'text-zinc-200'}`}
        >
          {player.gamertag}
        </span>
        <span
          className={`shrink-0 font-condensed text-xs font-bold tabular-nums ${isFirst ? 'text-zinc-100' : 'text-zinc-500'}`}
        >
          {player[statKey].toString()}
        </span>
      </Link>
    </li>
  )
}
```

Key changes:
- Wraps the panel in `<BroadcastPanel>` (replaces the `.broadcast-panel` class + hand-rolled ticker).
- Header uses `<SectionHeader>` for the label; the source line + CTA are rendered alongside (not via SectionHeader's `cta` prop, since the source line wouldn't fit cleanly).
- Inner column heading `text-xs` → `text-[10px]` to match the system's stat-label size.
- LeaderRow loses `rounded-sm` (per "rounded-none on panels" rule), gains stronger isFirst treatment (accent border at /55, accent/8 fill).
- FeaturedPlayerBlock loses `rounded-sm`. Featured-stat label color tightened to `text-accent/70`.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/home/leaders-section.tsx
git commit -m "$(cat <<'EOF'
refactor(web): rebuild ScoringLeadersPanel with Phase 1 primitives

Swaps the inline .broadcast-panel literal + hand-rolled header for
BroadcastPanel + SectionHeader. Tightens leader-row treatment for the
#1 row (accent /55 border + accent /8 fill + inset accent shadow) and
drops rounded corners per the design-system "no soft cards" rule. The
4-column grid structure (Points hero / Points list / Goals hero /
Goals list) is unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): rebuild ScoringLeadersPanel ...` is HEAD.

---

## Task 5: Restyle `<SeasonRankWidget>` — light Panel + voice pass

Wrap the widget body in `<Panel>`, replace inline soft labels with UPPERCASE wide-tracked treatment, drop any rounding.

**Files:**
- Modify: `apps/web/src/components/home/season-rank-widget.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,200p' apps/web/src/components/home/season-rank-widget.tsx
```

- [ ] **Step 2: Edit per design-system voice**

Apply the following transformations using the Edit tool:
1. Add import: `import { Panel } from '@/components/ui/panel'` at the top.
2. Replace the outermost `<div className="border border-zinc-800 bg-surface ...">` (or equivalent panel wrapper) with `<Panel className="...">`.
3. Replace any `rounded-xl` / `rounded-md` / `rounded-lg` on panel-like elements with no rounding (drop the class).
4. Replace any sentence-case labels (e.g. "Division Standing", "Rank") with UPPERCASE: change the label JSX text and add `font-condensed uppercase tracking-widest` if not already present.
5. Ensure all numeric values have `tabular-nums` class.

Edit each change one at a time. After all edits, the file should be ~115 lines (same as before, just refactored) and use `Panel` as its outer wrapper.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/home/season-rank-widget.tsx
git commit -m "$(cat <<'EOF'
refactor(web): apply design-system voice to SeasonRankWidget

Wraps the widget in Panel primitive, drops corner rounding, and tightens
all labels to UPPERCASE wide-tracked font-condensed. Numeric values get
explicit tabular-nums. No structural change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): apply design-system voice to SeasonRankWidget` is HEAD.

---

## Task 6: Extract + restyle `<RecentGamesStrip>` from page.tsx

The current `RecentGamesStrip` lives inline in `page.tsx` (lines 263–309). Extract it to its own file and restyle to use `<ResultPill>` + `<Panel>`.

**Files:**
- Create: `apps/web/src/components/home/recent-games-strip.tsx`

- [ ] **Step 1: Create the new component**

Write to `apps/web/src/components/home/recent-games-strip.tsx`:

```tsx
import Link from 'next/link'
import type { Match } from '@eanhl/db'
import { Panel } from '@/components/ui/panel'
import { ResultPill } from '@/components/ui/result-pill'
import { formatMatchDate } from '@/lib/format'

interface RecentGamesStripProps {
  matches: Match[]
}

/**
 * Compact strip of recent results — used below the LATEST RESULT hero
 * to provide a quick-scan trend over the last few games. Each row links
 * to the game detail page; result is shown as a small ResultPill chip.
 */
export function RecentGamesStrip({ matches }: RecentGamesStripProps) {
  if (matches.length === 0) return null

  return (
    <Panel className="divide-y divide-zinc-800/60">
      {matches.map((match) => (
        <Link
          key={match.id}
          href={`/games/${match.id.toString()}`}
          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/30"
        >
          <ResultPill result={match.result} size="sm" />
          <span className="flex-1 truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200">
            vs {match.opponentName}
          </span>
          <span className="shrink-0 font-condensed text-sm font-bold tabular-nums text-zinc-400">
            {match.scoreFor.toString()}–{match.scoreAgainst.toString()}
          </span>
          {match.gameMode !== null && (
            <span className="hidden shrink-0 border border-zinc-700/60 bg-zinc-800 px-1.5 py-0.5 font-condensed text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:inline">
              {match.gameMode}
            </span>
          )}
          <span className="hidden shrink-0 font-condensed text-xs uppercase tracking-wider text-zinc-600 sm:inline">
            {formatMatchDate(match.playedAt)}
          </span>
        </Link>
      ))}
    </Panel>
  )
}
```

Key changes from the inline version:
- Uses `<Panel>` instead of the hand-rolled `border border-zinc-800 bg-surface`.
- Uses `<ResultPill size="sm">` instead of the inline `RECENT_RESULT_CONFIG` letter chip (which used different en-dash + colors).
- Drops `rounded` on the game-mode pill (per design-system rules).
- Adds `font-condensed uppercase tracking-wide` to opponent name + game mode + date for voice consistency.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (the inline `RecentGamesStrip` in `page.tsx` is still in place; both exist temporarily until Task 8 wires the import).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/home/recent-games-strip.tsx
git commit -m "$(cat <<'EOF'
feat(web): extract RecentGamesStrip and restyle with Phase 1 primitives

Pulls RecentGamesStrip out of page.tsx into its own home component,
restyled to use Panel + ResultPill primitives. The inline copy in
page.tsx is removed in Task 8 when the import is wired in.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): extract RecentGamesStrip ...` is HEAD.

---

## Task 7: Light voice pass on `<TitleRecordsTable>`

Wrap the table in `<Panel>`, ensure column headers and labels use UPPERCASE/tabular treatment.

**Files:**
- Modify: `apps/web/src/components/home/title-records-table.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,200p' apps/web/src/components/home/title-records-table.tsx
```

- [ ] **Step 2: Edit per design-system voice**

Apply the following transformations using the Edit tool:
1. Add import: `import { Panel } from '@/components/ui/panel'` at the top.
2. Replace the outermost wrapper (likely `<div className="border border-zinc-800 bg-surface ...">` or similar) with `<Panel className="overflow-x-auto">`.
3. Add `font-condensed uppercase tracking-widest text-zinc-500` to all `<th>` cells if not already present.
4. Add `tabular-nums` to all `<td>` cells containing numbers.
5. Drop any `rounded-*` classes on the table or the wrapper.

The table structure (rows, columns, mode-pill controls) is unchanged.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/home/title-records-table.tsx
git commit -m "$(cat <<'EOF'
refactor(web): apply design-system voice to TitleRecordsTable

Wraps the table in Panel; UPPERCASE wide-tracked headers, tabular
numerals, no rounded corners. Structure unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): apply design-system voice to TitleRecordsTable` is HEAD.

---

## Task 8: Reorganize `page.tsx` — section headers, RecordStrip wiring, IA reorder

The orchestration commit. Replace inline section headers with `<SectionHeader>`, swap inline `RecordGameModeFilter` and `RecentGamesStrip` for the extracted components, wire in `<ClubRecordSection>`, and reorder all sections per the locked Phase 2 IA.

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Replace the file**

Write the entire new contents to `apps/web/src/app/page.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ClubGameTitleStats } from '@eanhl/db'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import {
  listGameTitles,
  listArchiveGameTitles,
  getActiveGameTitleBySlug,
  getClubStats,
  getClubSeasonRank,
  getOfficialClubRecord,
  getOpponentClub,
  getRecentMatches,
  getRoster,
  getEARoster,
  getHistoricalClubTeamStatsBatch,
  type HistoricalClubTeamBatchRow,
} from '@eanhl/db/queries'
import { redirect } from 'next/navigation'
import { LatestResult } from '@/components/home/latest-result'
import { PlayerCarousel } from '@/components/home/player-carousel'
import { ScoringLeadersPanel } from '@/components/home/leaders-section'
import { SeasonRankWidget } from '@/components/home/season-rank-widget'
import { ClubRecordSection } from '@/components/home/club-record-section'
import { RecentGamesStrip } from '@/components/home/recent-games-strip'
import {
  TitleRecordsTable,
  type TitleRecordData,
  type RecordModeStats,
} from '@/components/home/title-records-table'
import type { RosterRow } from '@/components/home/player-card'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

export const metadata: Metadata = { title: 'Club Stats' }

export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function resolveGameTitle(titleSlug: string | undefined) {
  try {
    if (titleSlug) {
      const found = await getActiveGameTitleBySlug(titleSlug)
      if (found) return { gameTitle: found, invalidRequested: false }
    }
    const all = await listGameTitles()
    return { gameTitle: all[0] ?? null, invalidRequested: Boolean(titleSlug) }
  } catch {
    return { gameTitle: null, invalidRequested: Boolean(titleSlug) }
  }
}

/**
 * Top players by points descending for the featured carousel.
 * Goalies sort naturally to the back (0 points). Returns up to 8.
 */
function selectFeaturedPlayers(roster: RosterRow[]): RosterRow[] {
  return [...roster]
    .sort((a, b) => b.points - a.points || b.gamesPlayed - a.gamesPlayed)
    .slice(0, 8)
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const { gameTitle, invalidRequested } = await resolveGameTitle(titleSlug)

  if (invalidRequested) {
    const qs = new URLSearchParams()
    if (gameMode !== null) qs.set('mode', gameMode)
    redirect(qs.size > 0 ? `/?${qs.toString()}` : '/')
  }

  if (!gameTitle) {
    return (
      <Panel className="flex min-h-[12rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          No game titles are configured yet.
        </p>
      </Panel>
    )
  }

  // All mode sources from EA full-season totals; 6s/3s modes source from local tracked stats.
  const rosterSource = gameMode === null ? 'EA season totals' : `local tracked ${gameMode}`

  const fetched = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id, gameMode),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 6 }),
        gameMode === null ? getEARoster(gameTitle.id) : getRoster(gameTitle.id, gameMode),
        getOfficialClubRecord(gameTitle.id),
        getClubSeasonRank(gameTitle.id),
        listArchiveGameTitles(),
        getClubStats(gameTitle.id, null),
        getClubStats(gameTitle.id, '6s'),
        getClubStats(gameTitle.id, '3s'),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return (
      <Panel className="flex min-h-[12rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          Unable to load data right now.
        </p>
      </Panel>
    )
  }

  const [
    clubStats,
    recentMatches,
    roster,
    officialRecord,
    seasonRank,
    archiveTitles,
    liveAll,
    live6s,
    live3s,
  ] = fetched

  const archiveHistRows: HistoricalClubTeamBatchRow[] =
    archiveTitles.length > 0
      ? await getHistoricalClubTeamStatsBatch(archiveTitles.map((t) => t.id)).catch(() => [])
      : []

  const titleRecords = buildTitleRecords(
    gameTitle,
    liveAll,
    live6s,
    live3s,
    archiveTitles,
    archiveHistRows,
  )
  const lastMatch = recentMatches[0] ?? null
  const latestClubRecord = officialRecord ?? null

  let lastMatchOpponent = null
  if (lastMatch !== null) {
    try {
      lastMatchOpponent = await getOpponentClub(lastMatch.opponentClubId)
    } catch {
      // Logo display degrades gracefully to initial badge
    }
  }

  const featuredPlayers = selectFeaturedPlayers(roster)
  const skaters = roster.filter((r) => r.position !== 'goalie')
  const pointsLeaders = skaters.slice(0, 10)
  const goalsLeaders = [...skaters]
    .sort((a, b) => b.goals - a.goals || b.points - a.points)
    .slice(0, 10)

  return (
    <div className="space-y-8">
      {/* Page header — team identity first */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
          Boogeymen
        </h1>
        <span className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          {gameTitle.name}
        </span>
      </div>

      {/* 1. LATEST RESULT */}
      {lastMatch !== null && (
        <section>
          <LatestResult
            match={lastMatch}
            clubRecord={latestClubRecord}
            opponentCrestAssetId={lastMatchOpponent?.crestAssetId ?? null}
            opponentCrestUseBaseAsset={lastMatchOpponent?.useBaseAsset ?? null}
          />
        </section>
      )}

      {/* 2. ROSTER SPOTLIGHT */}
      {featuredPlayers.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <SectionHeader label="Roster Spotlight" />
            <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
              {rosterSource}
            </span>
          </div>
          <PlayerCarousel players={featuredPlayers} />
        </section>
      )}

      {/* 3. SCORING LEADERS */}
      {pointsLeaders.length > 0 && (
        <section>
          <ScoringLeadersPanel
            pointsLeaders={pointsLeaders}
            goalsLeaders={goalsLeaders}
            gameMode={gameMode}
            source={rosterSource}
          />
        </section>
      )}

      {/* 4. CLUB RECORD STRIP */}
      <ClubRecordSection
        gameMode={gameMode}
        titleSlug={titleSlug}
        officialRecord={officialRecord}
        localStats={clubStats}
      />

      {/* 5. SEASON RANK / DIVISION STANDING */}
      {seasonRank !== null && (
        <section className="space-y-3">
          <SectionHeader label="Division Standing" />
          <SeasonRankWidget rank={seasonRank} />
        </section>
      )}

      {/* 6. RECENT RESULTS */}
      {recentMatches.length > 1 && (
        <section className="space-y-3">
          <SectionHeader label="Recent Results" />
          <RecentGamesStrip matches={recentMatches.slice(1)} />
        </section>
      )}

      {/* 7. TITLE RECORDS — cross-title comparison */}
      <section className="space-y-3">
        <SectionHeader label="Title Records" />
        <TitleRecordsTable titles={titleRecords} />
      </section>

      {/* Empty state when no data at all */}
      {clubStats !== null &&
        clubStats.gamesPlayed === 0 &&
        lastMatch === null &&
        roster.length === 0 && (
          <Panel className="flex min-h-[12rem] items-center justify-center">
            <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
              No games recorded for {gameTitle.name} yet.
            </p>
          </Panel>
        )}
    </div>
  )
}

// ─── Cross-title records data builder ────────────────────────────────────────

const HIST_PLAYLISTS_6S = new Set(['eashl_6v6', 'clubs_6v6'])
const HIST_PLAYLISTS_6SG = new Set(['6_player_full_team', 'clubs_6_players'])
const HIST_PLAYLISTS_3S = new Set(['eashl_3v3', 'clubs_3v3'])

function liveToRecord(stats: ClubGameTitleStats | null): RecordModeStats | null {
  if (!stats || stats.gamesPlayed === 0) return null
  const gfg =
    stats.gamesPlayed > 0 ? (stats.goalsFor / stats.gamesPlayed).toFixed(2) : null
  const gag =
    stats.gamesPlayed > 0 ? (stats.goalsAgainst / stats.gamesPlayed).toFixed(2) : null
  return {
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    otl: stats.otl,
    avgGoalsFor: gfg,
    avgGoalsAgainst: gag,
    avgTimeOnAttack: null,
    powerPlayPct: null,
    powerPlayKillPct: null,
  }
}

function histSingleRecord(
  rows: HistoricalClubTeamBatchRow[],
  titleId: number,
  playlists: Set<string>,
): RecordModeStats | null {
  const row = rows.find((r) => r.gameTitleId === titleId && playlists.has(r.playlist))
  if (!row?.gamesPlayed) return null
  return {
    gamesPlayed: row.gamesPlayed,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    otl: row.otl ?? 0,
    avgGoalsFor: row.avgGoalsFor ?? null,
    avgGoalsAgainst: row.avgGoalsAgainst ?? null,
    avgTimeOnAttack: row.avgTimeOnAttack ?? null,
    powerPlayPct: row.powerPlayPct ?? null,
    powerPlayKillPct: row.powerPlayKillPct ?? null,
  }
}

function histAllRecord(
  rows: HistoricalClubTeamBatchRow[],
  titleId: number,
): RecordModeStats | null {
  const titleRows = rows.filter((r) => r.gameTitleId === titleId && (r.gamesPlayed ?? 0) > 0)
  if (titleRows.length === 0) return null

  let gp = 0
  let w = 0
  let l = 0
  let otl = 0
  let gfgWeighted = 0
  let gagWeighted = 0
  let gpForRates = 0

  for (const r of titleRows) {
    const rGp = r.gamesPlayed ?? 0
    gp += rGp
    w += r.wins ?? 0
    l += r.losses ?? 0
    otl += r.otl ?? 0
    if (r.avgGoalsFor !== null && rGp > 0) {
      gfgWeighted += parseFloat(r.avgGoalsFor) * rGp
      gagWeighted += parseFloat(r.avgGoalsAgainst ?? '0') * rGp
      gpForRates += rGp
    }
  }

  return {
    gamesPlayed: gp,
    wins: w,
    losses: l,
    otl,
    avgGoalsFor: gpForRates > 0 ? (gfgWeighted / gpForRates).toFixed(2) : null,
    avgGoalsAgainst: gpForRates > 0 ? (gagWeighted / gpForRates).toFixed(2) : null,
    avgTimeOnAttack: null,
    powerPlayPct: null,
    powerPlayKillPct: null,
  }
}

function buildTitleRecords(
  liveTitle: { name: string; slug: string },
  liveAll: ClubGameTitleStats | null,
  live6s: ClubGameTitleStats | null,
  live3s: ClubGameTitleStats | null,
  archiveTitles: { id: number; name: string; slug: string }[],
  archiveHistRows: HistoricalClubTeamBatchRow[],
): TitleRecordData[] {
  const liveRow: TitleRecordData = {
    name: liveTitle.name,
    slug: liveTitle.slug,
    isLive: true,
    all: liveToRecord(liveAll),
    sixs: liveToRecord(live6s),
    sixsg: null,
    threes: liveToRecord(live3s),
  }

  const archiveRows: TitleRecordData[] = archiveTitles.map((t) => ({
    name: t.name,
    slug: t.slug,
    isLive: false,
    all: histAllRecord(archiveHistRows, t.id),
    sixs: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_6S),
    sixsg: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_6SG),
    threes: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_3S),
  }))

  return [liveRow, ...archiveRows]
}
```

Key changes from the previous version:
- Reorders sections to: Header → LATEST RESULT → ROSTER SPOTLIGHT → SCORING LEADERS → CLUB RECORD STRIP → SEASON RANK → RECENT RESULTS → TITLE RECORDS.
- Wires in `<ClubRecordSection>` (new section).
- Replaces inline section header markup with `<SectionHeader>` primitive.
- Replaces inline `RecentGamesStrip` (~50 lines + RECENT_RESULT_CONFIG) and `RecordGameModeFilter` (~50 lines) with imports of the extracted components.
- Replaces empty-state divs with `<Panel>` primitive.
- Removes the now-unused `Match` and `MatchResult` type imports + `Link` import (no longer used directly in the page).
- Mode filter is no longer rendered inline with Roster Spotlight — it's the responsibility of the `ClubRecordSection`. The Roster Spotlight section just gets a `SectionHeader` + the source line.
- Page file drops from 487 lines to ~330 lines.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): reorder home IA + wire Phase 1 primitives into page.tsx

Reorders sections per the design-system spec: Header → LATEST RESULT →
ROSTER SPOTLIGHT → SCORING LEADERS → CLUB RECORD STRIP → SEASON RANK
→ RECENT RESULTS → TITLE RECORDS. Wires in the new ClubRecordSection,
swaps inline section headers for the SectionHeader primitive, and
replaces inline RecentGamesStrip + RecordGameModeFilter with their
extracted component imports. Mode filter visually moves from Roster
Spotlight to Club Record Strip per the staged bundle's placement —
the URL ?mode= behaviour is unchanged.

Page file: 487 → ~330 lines.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1 && wc -l apps/web/src/app/page.tsx
```
Expected: `feat(web): reorder home IA ...` is HEAD; `page.tsx` is ~330 lines.

---

## Task 9: Visual verification + targeted format + push

Phase 2 ends when the home page renders correctly with the new IA + restyle, full repo typechecks clean, and the branch is pushed.

- [ ] **Step 1: Full-repo typecheck**

```bash
pnpm typecheck
```
Expected: 6 successful tasks.

- [ ] **Step 2: Start dev server**

```bash
pnpm --filter web dev
```
Wait for "Ready in" line.

- [ ] **Step 3: Walk the home page and kitchen-sink**

Open `http://localhost:<port>/` and confirm sections appear in the agreed order:
1. Page header (Boogeymen + game title) — UPPERCASE wide-tracked.
2. **LATEST RESULT** — broadcast hero with red ticker on top, soft red glow, scoreboard, ResultPill (md size with full word).
3. **ROSTER SPOTLIGHT** — section header + source line (right-aligned, dim) + carousel.
4. **SCORING LEADERS** — broadcast panel with 4-column grid; row #1 has accent border + accent fill + inset accent shadow; "View all stats →" CTA top-right.
5. **CLUB RECORD STRIP** — section header on left, mode filter (All/6s/3s) on right; record strip with W (accent), L, OTL (dim if zero), Win% (accent), GP, GF, GA, with "EA official" provenance dot on the bottom.
6. **DIVISION STANDING** — section header + restyled SeasonRankWidget.
7. **RECENT RESULTS** — section header + Panel-wrapped strip; each row has a small ResultPill (sm size, letter glyph) on the left.
8. **TITLE RECORDS** — section header + cross-title table.

Click the mode filter (All/6s/3s) — it should change the URL `?mode=` and re-fetch with the filter applied to the roster + leaders + record strip.

Open `http://localhost:<port>/_kitchen-sink` — verify the primitives still render correctly (no regressions from Phase 1).

If anything is broken, stop and surface to the user.

- [ ] **Step 4: Targeted format pass**

```bash
pnpm exec prettier --write \
  apps/web/src/app/page.tsx \
  apps/web/src/components/home/club-record-section.tsx \
  apps/web/src/components/home/record-mode-filter.tsx \
  apps/web/src/components/home/recent-games-strip.tsx \
  apps/web/src/components/home/latest-result.tsx \
  apps/web/src/components/home/leaders-section.tsx \
  apps/web/src/components/home/season-rank-widget.tsx \
  apps/web/src/components/home/title-records-table.tsx
git status --short
```

If any files are reformatted (i.e. show as modified after the run), stage and commit them as a single style commit:

```bash
git add apps/web/src/app/page.tsx \
        apps/web/src/components/home/*.tsx
git commit -m "$(cat <<'EOF'
style(web): prettier pass on phase 2 home work

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If nothing changed (all files were prettier-clean from initial writes), skip this step.

- [ ] **Step 5: Stop dev server**

```bash
pkill -f "next-server" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1
pgrep -af "next-server|next dev" || echo "(stopped)"
```

- [ ] **Step 6: Push the branch**

```bash
git push origin feat/design-system-renovation
```
Expected: branch pushes cleanly to origin (it already tracks origin from Phase 1 push).

- [ ] **Step 7: Final state check**

```bash
git status
git log --oneline main..HEAD | head -20
```
Expected: clean tree on `feat/design-system-renovation`; ~9 new commits ahead of `main` from Phase 2 (one per Task 1-8, optional style commit from Task 9 Step 4).

---

## Recovery if something goes wrong mid-plan

- **Typecheck fails after a component restyle:** revert the component to HEAD via `git checkout HEAD -- <file>`, re-read the original, apply changes more carefully. Do NOT commit a broken state.
- **A primitive's API doesn't fit a use case in Task 4 (leaders) or Task 8 (page.tsx):** flag it. Do NOT widen the primitive in this phase — bend the consumer first; primitive widening is a Phase 3+ concern when a third consumer needs the same shape.
- **Roster Spotlight section header looks wrong without the mode filter inline:** confirm with the user whether the mode filter visual placement should stay with Roster Spotlight (live-style) or move to Club Record Strip (staged-style, locked decision). If the user reverses the locked decision, update Tasks 2 + 8 to render the filter alongside the carousel header.
- **Visual regression on the home page (Task 9 Step 3):** identify the responsible component, revert just that component's commit (`git revert <sha>`) or amend if not yet pushed. Don't push until visuals are right.
- **Prettier reformats unrelated files (Task 9 Step 4):** the targeted prettier list MUST stay focused on Phase 2 files only. If `pnpm exec prettier --write apps/...` somehow expanded scope, revert via `git checkout HEAD -- <unrelated>` and use the explicit file list above.
