# OCR Confidence Footers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse Lineup footer with granular field-completeness buckets and add a matching provenance footer to the Action Tracker, both rendered by one shared component.

**Architecture:** A new presentational `OcrProvenanceFooter` component renders the `Captured/Sources/Confidence` box for both sections. Lineup confidence becomes a pure function over the rendered rows (field-completeness "Approach A"); `getMatchLineupProvenance` is slimmed to capture-range + sources. A new `getMatchActionTrackerProvenance` query supplies the Action Tracker's extracted-range + sources, and the Action Tracker's existing position-extrapolation proxy becomes the always-shown headline.

**Tech Stack:** Next.js 15 (App Router, server + client components), TypeScript strict, Drizzle ORM, Tailwind 4. Web unit tests run with `node --test`. DB query tests run from `dist` after `pnpm --filter @eanhl/db build`.

**Spec:** `docs/superpowers/specs/2026-06-13-ocr-confidence-footers-design.md`

**Branch:** `feat/ocr-confidence-footers` (already created; spec committed at `19f4ff6`).

---

## File Structure

- **Create** `apps/web/src/components/matches/ocr-provenance-footer.tsx` — shared presentational footer + its small helpers (`FootKV`, `SrcBadge`, timestamp/percent/word formatters). One responsibility: render the provenance box.
- **Create** `apps/web/src/lib/lineup-confidence.ts` — pure `computeLineupConfidence(lineups)` field-completeness buckets.
- **Create** `apps/web/src/lib/lineup-confidence.test.ts` — `node --test` unit tests for the pure function.
- **Create** `packages/db/src/queries/__tests__/action-tracker-provenance.test.ts` — read-only assertion against canonical match 250.
- **Modify** `packages/db/src/queries/match-lineups.ts` — drop `confidence` from `MatchLineupProvenance` + `getMatchLineupProvenance`.
- **Modify** `packages/db/src/queries/match-events.ts` — add `getMatchActionTrackerProvenance` + `MatchActionTrackerProvenance`.
- **Modify** `apps/web/src/components/matches/lineup-section.tsx` — delete local footer/helpers, render shared footer via a new `LineupOcrFooter`.
- **Modify** `apps/web/src/components/matches/action-tracker-map.tsx` — accept `provenance` prop, remove gated OCR/Source KVs from the summary strip, render shared footer at section bottom.
- **Modify** `apps/web/src/app/games/[id]/page.tsx` — slim lineup-provenance default, fetch + pass Action Tracker provenance.

---

## Task 1: Shared `OcrProvenanceFooter` component

**Files:**
- Create: `apps/web/src/components/matches/ocr-provenance-footer.tsx`

- [ ] **Step 1: Write the component file**

Create `apps/web/src/components/matches/ocr-provenance-footer.tsx` with this exact content:

```tsx
/**
 * Shared OCR provenance footer — the `Captured / Sources / Confidence` box
 * rendered at the bottom of the Lineup & Loadouts and Action Tracker sections.
 *
 * Presentational only: callers compute the headline metric, badges, and source
 * labels and pass them in. The two sections deliberately label `Confidence`
 * differently (a blended completeness score for lineups, a position-extrapolation
 * proxy for the Action Tracker); the distinction lives in `headlineTooltip`.
 */

export interface ProvenanceBadge {
  label: string
  tone: 'ok' | 'warn'
  tooltip?: string
}

export interface OcrProvenanceFooterProps {
  capturedAt: { earliest: Date; latest: Date } | null
  /** Column label for the timestamp range: "Captured" (lineup) | "Extracted" (action tracker). */
  capturedLabel: string
  /** Pre-formatted, de-duplicated source-screen labels. */
  sources: string[]
  headline: { value: string; word: string; tone: 'ok' | 'neutral' | 'warn' }
  /** Tooltip on the `Confidence` label — the honesty/wording-audit copy. */
  headlineTooltip: string
  badges: ProvenanceBadge[]
}

export function OcrProvenanceFooter({
  capturedAt,
  capturedLabel,
  sources,
  headline,
  headlineTooltip,
  badges,
}: OcrProvenanceFooterProps) {
  if (capturedAt === null) return null
  const { earliest, latest } = capturedAt
  const sameInstant = earliest.getTime() === latest.getTime()
  const capturedValue = sameInstant
    ? formatProvenanceTimestamp(earliest)
    : `${formatProvenanceTimestamp(earliest)} → ${formatProvenanceTimestamp(latest)}`
  const sourcesValue = sources.length > 0 ? sources.join(' + ') : '—'
  const headlineTone =
    headline.tone === 'ok'
      ? 'text-[var(--color-win)]'
      : headline.tone === 'warn'
        ? 'text-[var(--color-otl)]'
        : 'text-[var(--color-fg-2)]'

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <FootKV k={capturedLabel} v={capturedValue} />
      <FootKV k="Sources" v={sourcesValue} />
      <div className="flex flex-col gap-[2px]">
        <span
          className="cursor-help font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]"
          title={headlineTooltip}
        >
          Confidence
        </span>
        <span className={`font-condensed text-[11px] font-bold tracking-[0.04em] ${headlineTone}`}>
          {headline.word} · {headline.value}
        </span>
      </div>
      {badges.length > 0 ? (
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {badges.map((b) => (
            <SrcBadge key={b.label} label={b.label} tone={b.tone} tooltip={b.tooltip} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function FootKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
        {k}
      </span>
      <span className="font-condensed text-[11px] font-bold tracking-[0.04em] text-[var(--color-fg-3)]">
        {v}
      </span>
    </div>
  )
}

function SrcBadge({ label, tone, tooltip }: ProvenanceBadge) {
  const cls =
    tone === 'ok'
      ? 'border-[var(--color-win-border)] bg-[var(--color-win-bg)] text-[var(--color-win)]'
      : 'border-[var(--color-otl-border)] bg-[var(--color-otl-bg)] text-[var(--color-otl)]'
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-condensed text-[9.5px] font-bold uppercase tracking-[0.18em] ${cls}`}
    >
      {label}
    </span>
  )
}

function formatProvenanceTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `0.84 → "84%"`, `null → "—"`. */
export function formatProvenancePercent(n: number | null): string {
  if (n === null) return '—'
  return `${String(Math.round(n * 100))}%`
}

/** Shared High/Solid/Partial/Low wording for a 0..1 score. */
export function confidenceWord(score: number): string {
  if (score >= 0.9) return 'High'
  if (score >= 0.7) return 'Solid'
  if (score >= 0.5) return 'Partial'
  return 'Low'
}

/** Shared tone mapping for a 0..1 score (ok ≥ 0.9, warn < 0.6, neutral between). */
export function confidenceTone(score: number): 'ok' | 'neutral' | 'warn' {
  if (score >= 0.9) return 'ok'
  if (score >= 0.6) return 'neutral'
  return 'warn'
}
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter web typecheck`
Expected: PASS (new file compiles; nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/matches/ocr-provenance-footer.tsx
git commit -m "feat(matches): add shared OcrProvenanceFooter component"
```

---

## Task 2: `computeLineupConfidence` pure function (TDD)

**Files:**
- Create: `apps/web/src/lib/lineup-confidence.ts`
- Test: `apps/web/src/lib/lineup-confidence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/lineup-confidence.test.ts`:

```ts
/**
 * Unit tests for computeLineupConfidence — field-completeness buckets over the
 * rendered lineup rows. Pure function, no DB/React.
 *
 * Run: node --test apps/web/src/lib/lineup-confidence.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { LineupRow, MatchLineups } from '@eanhl/db/queries'
import { computeLineupConfidence } from './lineup-confidence.ts'

// Minimal row builder — only the fields the buckets read. Cast through unknown
// because the buckets never touch the other LineupRow fields.
function row(overrides: Partial<LineupRow>): LineupRow {
  return {
    snapshotId: 1,
    gamertagSnapshot: 'PlayerOne',
    playerNameSnapshot: null,
    playerNamePersona: 'P. One',
    playerNumber: 11,
    isCaptain: false,
    position: 'C',
    buildClass: 'Sniper',
    buildClassCanonical: null,
    heightText: "6'0\"",
    weightLbs: 190,
    handedness: 'L',
    playerLevelNumber: null,
    playerLevelRaw: null,
    playerPrestigeNumber: null,
    platform: 'ps5',
    capturedAt: new Date('2026-05-12T00:00:00Z'),
    player: null,
    xFactors: [],
    attributes: { speed: { value: 88, delta: null } },
    ...overrides,
  } as LineupRow
}

function lineups(bgm: LineupRow[], opponent: LineupRow[] = []): MatchLineups {
  return { bgm, opponent } as MatchLineups
}

void test('empty lineups → all buckets null, overall 0', () => {
  const c = computeLineupConfidence(lineups([], []))
  assert.equal(c.identity, null)
  assert.equal(c.build, null)
  assert.equal(c.xfactor, null)
  assert.equal(c.tier, null)
  assert.equal(c.attribute, null)
  assert.equal(c.overall, 0)
})

void test('fully populated row → identity/build/attribute = 1', () => {
  const c = computeLineupConfidence(lineups([row({})]))
  assert.equal(c.identity, 1)
  assert.equal(c.build, 1)
  assert.equal(c.attribute, 1)
  // no x-factors detected → xfactor/tier are empty-denominator
  assert.equal(c.xfactor, null)
  assert.equal(c.tier, null)
})

void test('missing platform drops identity to 3/4', () => {
  const c = computeLineupConfidence(lineups([row({ platform: null })]))
  assert.equal(c.identity, 0.75)
})

void test('missing height + weight drops build to 1/3', () => {
  const c = computeLineupConfidence(lineups([row({ heightText: null, weightLbs: null })]))
  assert.ok(Math.abs((c.build ?? 0) - 1 / 3) < 1e-9)
})

void test('gamertag present via resolved player counts even when snapshot is null', () => {
  const c = computeLineupConfidence(
    lineups([row({ gamertagSnapshot: null, player: { id: 7, gamertag: 'Resolved' } })]),
  )
  assert.equal(c.identity, 1)
})

void test('x-factor canonical + tier rates over detected entries', () => {
  const c = computeLineupConfidence(
    lineups([
      row({
        xFactors: [
          { slotIndex: 0, name: 'a', canonicalName: 'Tape_to_Tape', tier: 'Elite' },
          { slotIndex: 1, name: 'b', canonicalName: 'PressurePlus', tier: null },
          { slotIndex: 2, name: 'c', canonicalName: null, tier: null },
        ],
      }),
    ]),
  )
  assert.ok(Math.abs((c.xfactor ?? 0) - 2 / 3) < 1e-9) // 2 of 3 canonical
  assert.ok(Math.abs((c.tier ?? 0) - 1 / 3) < 1e-9) // 1 of 3 tiered
})

void test('attribute bucket = share of rows carrying attributes', () => {
  const c = computeLineupConfidence(lineups([row({}), row({ attributes: null })]))
  assert.equal(c.attribute, 0.5)
})

void test('buckets average both sides (bgm + opponent)', () => {
  const c = computeLineupConfidence(
    lineups([row({ platform: 'ps5' })], [row({ platform: null })]),
  )
  // identity = (1 + 0.75) / 2
  assert.equal(c.identity, 0.875)
})

void test('overall excludes empty-denominator buckets', () => {
  // No x-factors anywhere → overall = mean(identity, build, attribute) = 1
  const c = computeLineupConfidence(lineups([row({})]))
  assert.equal(c.overall, 1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/src/lib/lineup-confidence.test.ts`
Expected: FAIL — cannot find module `./lineup-confidence.ts` / `computeLineupConfidence` not exported.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/lineup-confidence.ts`:

```ts
/**
 * Field-completeness confidence buckets for the Lineup & Loadouts footer.
 *
 * We have no trustworthy per-field OCR certainty (RapidOCR's overall_confidence
 * is a poorly-calibrated whole-frame average). So each bucket is a *recovery*
 * proxy: the share of expected fields the OCR actually produced, computed over
 * the RENDERED lineup rows (post-EA-platform-overlay) so the numbers match what
 * the user sees on the cards. The footer labels this honestly as a completeness
 * score, not a per-field OCR confidence.
 */

import type { LineupRow, MatchLineups } from '@eanhl/db/queries'

export interface LineupConfidence {
  /** Mean coverage of {number, persona, gamertag, platform} across rows. */
  identity: number | null
  /** Mean coverage of {build type, height, weight} across rows. */
  build: number | null
  /** Canonical-name resolution rate among detected X-Factor entries. */
  xfactor: number | null
  /** Valid-tier rate among detected X-Factor entries. */
  tier: number | null
  /** Share of rows carrying a non-null attribute set. */
  attribute: number | null
  /** Mean of the buckets that have a non-zero denominator. 0 when no rows. */
  overall: number
}

function gamertagPresent(r: LineupRow): boolean {
  if (r.player) return true
  return (r.gamertagSnapshot ?? '').trim().length > 0
}

export function computeLineupConfidence(lineups: MatchLineups): LineupConfidence {
  const rows: LineupRow[] = [...lineups.bgm, ...lineups.opponent]
  if (rows.length === 0) {
    return { identity: null, build: null, xfactor: null, tier: null, attribute: null, overall: 0 }
  }

  let identitySum = 0
  let buildSum = 0
  let rowsWithAttrs = 0
  let xfTotal = 0
  let xfCanon = 0
  let xfTier = 0

  for (const r of rows) {
    const idPresent =
      (r.playerNumber !== null ? 1 : 0) +
      (r.playerNamePersona !== null ? 1 : 0) +
      (gamertagPresent(r) ? 1 : 0) +
      (r.platform !== null ? 1 : 0)
    identitySum += idPresent / 4

    const buildPresent =
      (r.buildClass !== null || r.buildClassCanonical !== null ? 1 : 0) +
      (r.heightText !== null ? 1 : 0) +
      (r.weightLbs !== null ? 1 : 0)
    buildSum += buildPresent / 3

    if (r.attributes !== null && Object.keys(r.attributes).length > 0) rowsWithAttrs++

    for (const xf of r.xFactors) {
      xfTotal++
      if (xf.canonicalName !== null) xfCanon++
      if (xf.tier !== null) xfTier++
    }
  }

  const identity = identitySum / rows.length
  const build = buildSum / rows.length
  const attribute = rowsWithAttrs / rows.length
  const xfactor = xfTotal > 0 ? xfCanon / xfTotal : null
  const tier = xfTotal > 0 ? xfTier / xfTotal : null

  const denominated = [identity, build, xfactor, tier, attribute].filter(
    (b): b is number => b !== null,
  )
  const overall =
    denominated.length > 0 ? denominated.reduce((a, b) => a + b, 0) / denominated.length : 0

  return { identity, build, xfactor, tier, attribute, overall }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test apps/web/src/lib/lineup-confidence.test.ts`
Expected: PASS — all 9 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/lineup-confidence.ts apps/web/src/lib/lineup-confidence.test.ts
git commit -m "feat(matches): add computeLineupConfidence field-completeness buckets"
```

---

## Task 3: DB query changes (slim lineup provenance + add action-tracker provenance)

**Files:**
- Modify: `packages/db/src/queries/match-lineups.ts`
- Modify: `packages/db/src/queries/match-events.ts`
- Test: `packages/db/src/queries/__tests__/action-tracker-provenance.test.ts`

- [ ] **Step 1: Slim `MatchLineupProvenance` interface**

In `packages/db/src/queries/match-lineups.ts`, replace the interface (currently lines ~537-548) so the `confidence` block is removed:

```ts
export interface MatchLineupProvenance {
  capturedAt: { earliest: Date; latest: Date } | null
  sources: Array<{ screenType: string; snapshotCount: number }>
}
```

Also update the doc comment directly above it: delete the two sentences describing `confidence.canonical` / `tiered` (they no longer apply); keep the `sources` description.

- [ ] **Step 2: Slim `getMatchLineupProvenance` body**

In the same file, replace the whole `getMatchLineupProvenance` function body so it computes only capture-range + sources. The new function:

```ts
export async function getMatchLineupProvenance(matchId: number): Promise<MatchLineupProvenance> {
  const snapshotMeta = await db
    .select({
      capturedAt: playerLoadoutSnapshots.capturedAt,
      screenType: ocrExtractions.screenType,
    })
    .from(playerLoadoutSnapshots)
    .innerJoin(ocrExtractions, eq(ocrExtractions.id, playerLoadoutSnapshots.ocrExtractionId))
    .where(eq(playerLoadoutSnapshots.matchId, matchId))

  if (snapshotMeta.length === 0) {
    return { capturedAt: null, sources: [] }
  }

  let earliest = snapshotMeta[0]!.capturedAt
  let latest = snapshotMeta[0]!.capturedAt
  const screenCounts = new Map<string, number>()
  for (const s of snapshotMeta) {
    if (s.capturedAt < earliest) earliest = s.capturedAt
    if (s.capturedAt > latest) latest = s.capturedAt
    screenCounts.set(s.screenType, (screenCounts.get(s.screenType) ?? 0) + 1)
  }

  return {
    capturedAt: { earliest, latest },
    sources: [...screenCounts.entries()]
      .map(([screenType, snapshotCount]) => ({ screenType, snapshotCount }))
      .sort((a, b) => b.snapshotCount - a.snapshotCount),
  }
}
```

This removes the X-Factor + attribute aggregate queries. Note: `playerLoadoutXFactors`, `playerLoadoutAttributes`, and `isXFactorTier` are still imported and used by `getMatchLineups` above — leave the imports alone.

- [ ] **Step 3: Add `getMatchActionTrackerProvenance` to match-events.ts**

In `packages/db/src/queries/match-events.ts`, add `ocrExtractions` to the schema import block (currently imports `matchEvents, matchGoalEvents, matchPenaltyEvents, matches, players`):

```ts
import {
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  matches,
  ocrExtractions,
  players,
} from '../schema/index.js'
```

Then append to the end of the file:

```ts
/**
 * OCR provenance for the Action Tracker section of a match — drives the
 * `Extracted / Sources / Confidence` footer.
 *
 * Joins the visible OCR event rows (source='ocr', reviewed — matching
 * getMatchEvents' visibility rule) to their source extraction. The only time
 * signal on event rows is `ocr_extractions.extracted_at` (OCR-run time, NOT a
 * capture time), so the footer labels this range "Extracted"; it can span
 * reprocess runs.
 */
export interface MatchActionTrackerProvenance {
  extractedAt: { earliest: Date; latest: Date } | null
  sources: Array<{ screenType: string; eventCount: number }>
}

export async function getMatchActionTrackerProvenance(
  matchId: number,
): Promise<MatchActionTrackerProvenance> {
  const rows = await db
    .select({
      screenType: ocrExtractions.screenType,
      extractedAt: ocrExtractions.extractedAt,
    })
    .from(matchEvents)
    .innerJoin(ocrExtractions, eq(ocrExtractions.id, matchEvents.ocrExtractionId))
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        eq(matchEvents.source, 'ocr'),
        eq(matchEvents.reviewStatus, 'reviewed'),
      ),
    )

  if (rows.length === 0) {
    return { extractedAt: null, sources: [] }
  }

  let earliest = rows[0]!.extractedAt
  let latest = rows[0]!.extractedAt
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.extractedAt < earliest) earliest = r.extractedAt
    if (r.extractedAt > latest) latest = r.extractedAt
    counts.set(r.screenType, (counts.get(r.screenType) ?? 0) + 1)
  }

  return {
    extractedAt: { earliest, latest },
    sources: [...counts.entries()]
      .map(([screenType, eventCount]) => ({ screenType, eventCount }))
      .sort((a, b) => b.eventCount - a.eventCount),
  }
}
```

(`and` and `eq` are already imported at the top of match-events.ts.)

- [ ] **Step 4: Write the read-only provenance test**

Create `packages/db/src/queries/__tests__/action-tracker-provenance.test.ts`:

```ts
/**
 * Read-only assertions for getMatchActionTrackerProvenance against the canonical
 * match 250 (the only OCR-ingested match) and a guaranteed-empty match id.
 * No writes, no cleanup.
 *
 * Build + run:
 *   pnpm --filter @eanhl/db build
 *   set -a && source .env && set +a
 *   node --test packages/db/dist/queries/__tests__/action-tracker-provenance.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { getMatchActionTrackerProvenance } from '../match-events.js'

void test('match 250 has an extracted-at range and action-tracker sources', async () => {
  const p = await getMatchActionTrackerProvenance(250)
  assert.notEqual(p.extractedAt, null)
  assert.ok(p.extractedAt!.earliest instanceof Date)
  assert.ok(p.extractedAt!.latest.getTime() >= p.extractedAt!.earliest.getTime())
  assert.ok(p.sources.length > 0)
  assert.ok(p.sources.some((s) => s.screenType === 'post_game_action_tracker'))
  assert.ok(p.sources.every((s) => s.eventCount > 0))
})

void test('a match with no OCR events returns nulls', async () => {
  const p = await getMatchActionTrackerProvenance(0)
  assert.equal(p.extractedAt, null)
  assert.deepEqual(p.sources, [])
})
```

- [ ] **Step 5: Build the db package**

Run: `pnpm --filter @eanhl/db build`
Expected: PASS (TypeScript compiles; new export emitted to `dist`).

- [ ] **Step 6: Run the provenance test against the live DB**

Run:
```bash
set -a && source .env && set +a
node --test packages/db/dist/queries/__tests__/action-tracker-provenance.test.js
```
Expected: PASS — 2 tests. (Requires the local Postgres container running on port 5433.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/queries/match-lineups.ts packages/db/src/queries/match-events.ts packages/db/src/queries/__tests__/action-tracker-provenance.test.ts
git commit -m "feat(db): slim lineup provenance; add action-tracker provenance query"
```

---

## Task 4: Wire the Lineup footer to the shared component

**Files:**
- Modify: `apps/web/src/components/matches/lineup-section.tsx`
- Modify: `apps/web/src/app/games/[id]/page.tsx`

- [ ] **Step 1: Replace the lineup imports**

In `apps/web/src/components/matches/lineup-section.tsx`, the top imports currently include `MatchLineupProvenance`. Add the shared footer + confidence imports. After the existing `import { colorForPosition } from '@/lib/position-colors'` line, add:

```tsx
import {
  OcrProvenanceFooter,
  type ProvenanceBadge,
  confidenceTone,
  confidenceWord,
  formatProvenancePercent,
} from '@/components/matches/ocr-provenance-footer'
import { computeLineupConfidence } from '@/lib/lineup-confidence'
```

- [ ] **Step 2: Replace the footer call site**

In `LineupSection`, change the render line (currently `<OcrProvenanceFooter provenance={provenance} />`) to pass the full lineups:

```tsx
      <LineupOcrFooter lineups={lineups} provenance={provenance} />
```

- [ ] **Step 3: Delete the old local footer + its now-shared helpers**

Delete these definitions from `lineup-section.tsx` (the entire `// ─── OCR provenance footer ───` block down to `formatPercent`):
- `function OcrProvenanceFooter(...)`
- `function FootKV(...)`
- `function SrcBadge(...)`
- `function formatProvenanceTimestamp(...)`
- `function overallConfidenceWord(...)`
- `function formatPercent(...)`

Keep `SCREEN_TYPE_LABELS` and `formatSourcesLabel` — they become helpers for the new wrapper, but change `formatSourcesLabel` to return a `string[]` (de-duplicated labels) instead of a joined string:

```tsx
function lineupSourceLabels(sources: MatchLineupProvenance['sources']): string[] {
  const names = new Set<string>()
  for (const s of sources) names.add(SCREEN_TYPE_LABELS[s.screenType] ?? s.screenType)
  return [...names]
}
```

(Delete the old `formatSourcesLabel`; `SCREEN_TYPE_LABELS` stays as-is.)

- [ ] **Step 4: Add the `LineupOcrFooter` wrapper**

Add this new component where the old footer used to live:

```tsx
// ─── OCR provenance footer ──────────────────────────────────────────────────

const LINEUP_CONFIDENCE_TOOLTIP =
  'Blended completeness score — the share of expected lineup fields the OCR recovered. Not a per-field OCR certainty.'

function LineupOcrFooter({
  lineups,
  provenance,
}: {
  lineups: MatchLineups
  provenance: MatchLineupProvenance
}) {
  const c = computeLineupConfidence(lineups)
  const badges: ProvenanceBadge[] = [
    { key: 'Identity', value: c.identity },
    { key: 'Build', value: c.build },
    { key: 'X-Factor', value: c.xfactor },
    { key: 'Tier', value: c.tier },
    { key: 'Attributes', value: c.attribute },
  ].map(({ key, value }) => ({
    label: `${key} · ${formatProvenancePercent(value)}`,
    tone: value !== null && value >= 0.9 ? 'ok' : 'warn',
  }))

  return (
    <OcrProvenanceFooter
      capturedAt={provenance.capturedAt}
      capturedLabel="Captured"
      sources={lineupSourceLabels(provenance.sources)}
      headline={{
        value: c.overall.toFixed(2),
        word: confidenceWord(c.overall),
        tone: confidenceTone(c.overall),
      }}
      headlineTooltip={LINEUP_CONFIDENCE_TOOLTIP}
      badges={badges}
    />
  )
}
```

- [ ] **Step 5: Page lineup-provenance default — LEAVE UNCHANGED**

> **DECISION (Task 3 revision):** `getMatchLineupProvenance().confidence` was NOT slimmed — it is consumed by `apps/worker/src/match-quality-cli.ts` and locked by the match-463 regression baseline. So `MatchLineupProvenance` still has its `confidence` block. **Do NOT change** the existing `safe()` default in `page.tsx` (it must keep `confidence: { canonical: 0, tiered: 0, attribute: 0 }`). The web footer simply ignores `provenance.confidence` and uses `computeLineupConfidence(lineups)` instead. No page edit in this step.

- [ ] **Step 6: Rebuild db, then typecheck web**

The web typecheck needs the rebuilt `@eanhl/db` types from Task 3 (already built in Task 3 Step 5, but rebuild to be safe):

Run:
```bash
pnpm --filter @eanhl/db build
pnpm --filter web typecheck
```
Expected: PASS. (If you see "Module has no exported member 'confidence'" it means the db rebuild was skipped — rerun the build.)

- [ ] **Step 7: Re-run the lineup-confidence unit test (regression)**

Run: `node --test apps/web/src/lib/lineup-confidence.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/matches/lineup-section.tsx apps/web/src/app/games/[id]/page.tsx
git commit -m "feat(matches): granular lineup confidence footer via shared component"
```

---

## Task 5: Wire the Action Tracker footer

**Files:**
- Modify: `apps/web/src/components/matches/action-tracker-map.tsx`
- Modify: `apps/web/src/app/games/[id]/page.tsx`

- [ ] **Step 1: Import the shared footer + provenance type**

In `apps/web/src/components/matches/action-tracker-map.tsx`, add near the other component imports:

```tsx
import {
  OcrProvenanceFooter,
  type ProvenanceBadge,
  confidenceTone,
  confidenceWord,
  formatProvenancePercent,
} from '@/components/matches/ocr-provenance-footer'
import type { MatchActionTrackerProvenance } from '@eanhl/db/queries'
```

- [ ] **Step 2: Add the `provenance` prop**

In `interface ActionTrackerMapProps` (line ~58), add the prop after `faceoffZones`:

```tsx
  /** OCR provenance for the section footer (extracted range + source screens). */
  provenance?: MatchActionTrackerProvenance
}
```

Then in the `ActionTrackerMap({ ... })` destructure (line ~121), add a default:

```tsx
  faceoffDots = [],
  faceoffZones = [],
  provenance = { extractedAt: null, sources: [] },
}: ActionTrackerMapProps) {
```

- [ ] **Step 3: Compute extrapolated count alongside the proxy**

The proxy `ocrConfidence` is computed at line ~261. Right after that `useMemo`, add a sibling memo for the badge counts:

```tsx
  const positionStats = useMemo(() => {
    const positioned = tracked.filter((e) => e.x !== null && e.y !== null)
    const extrapolated = positioned.filter((e) => e.positionConfidence === 'extrapolated').length
    return { positioned: positioned.length, extrapolated }
  }, [tracked])
```

- [ ] **Step 4: Remove the gated OCR-confidence + Source KVs from the SummaryStrip**

In the `SummaryStrip`'s secondary row (the `<div className="ml-auto flex items-center gap-x-4">` block, around lines 738-757), delete the entire `ml-auto` wrapper including the gated `ocrConfidence` `SummaryKV` and the `Source` `SummaryKV`. The secondary row keeps only the `SummaryGroup` with Visible / On rink / Off rink.

After deletion, that secondary row is just:

```tsx
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] px-3.5 py-1.5">
            <SummaryGroup>
              <SummaryKV k="Visible" v={String(visible)} small />
              <SummaryKV k="On rink" v={String(onRink)} dim small />
              {offRink > 0 ? (
                <SummaryKV
                  k="Off rink"
                  v={String(offRink)}
                  dim
                  small
                  title="Events that occurred but couldn't be plotted on the rink (typically faceoffs, which are shown in the Faceoff Map below)."
                />
              ) : null}
            </SummaryGroup>
          </div>
```

Then remove the now-unused `ocrConfidence` prop from the `SummaryStrip` component signature and from its call site (line ~326 `ocrConfidence={ocrConfidence}`). Leave the top-level `ocrConfidence` memo in place — it now feeds the footer instead.

- [ ] **Step 5: Render the shared footer at the bottom of the section**

In the `ActionTrackerMap` return, the section closes at the `</section>` near line 363 (right after the `events`/`faceoffs` view ternary, inside the `TeamPaletteContext.Provider`). Insert the footer just before `</section>`:

```tsx
        )}

        <ActionTrackerOcrFooter
          provenance={provenance}
          ocrConfidence={ocrConfidence}
          positionStats={positionStats}
        />
      </section>
```

- [ ] **Step 6: Add the `ActionTrackerOcrFooter` component**

Add this component near the bottom of the file (e.g., just after the `ActionTrackerMap` function, before `ViewModeToggle`):

```tsx
const AT_CONFIDENCE_TOOLTIP =
  'Position proxy — the share of plotted events whose rink position was read directly, not extrapolated. Not an OCR text-confidence.'

const AT_SCREEN_LABELS: Readonly<Record<string, string>> = {
  post_game_action_tracker: 'Action Tracker',
  post_game_events: 'Post-game events',
}

function ActionTrackerOcrFooter({
  provenance,
  ocrConfidence,
  positionStats,
}: {
  provenance: MatchActionTrackerProvenance
  ocrConfidence: number | null
  positionStats: { positioned: number; extrapolated: number }
}) {
  const score = ocrConfidence ?? 0
  const sources = [...new Set(provenance.sources.map((s) => AT_SCREEN_LABELS[s.screenType] ?? s.screenType))]
  const readDirectly = positionStats.positioned - positionStats.extrapolated
  const extrapShare =
    positionStats.positioned > 0 ? positionStats.extrapolated / positionStats.positioned : 0
  const badges: ProvenanceBadge[] = [
    {
      label: `Plotted · ${String(readDirectly)}/${String(positionStats.positioned)}`,
      tone: ocrConfidence !== null && ocrConfidence >= 0.9 ? 'ok' : 'warn',
    },
    {
      label: `Extrapolated · ${formatProvenancePercent(extrapShare)}`,
      tone: positionStats.extrapolated === 0 ? 'ok' : 'warn',
    },
  ]

  return (
    <OcrProvenanceFooter
      capturedAt={provenance.extractedAt}
      capturedLabel="Extracted"
      sources={sources}
      headline={{
        value: ocrConfidence === null ? '—' : ocrConfidence.toFixed(2),
        word: ocrConfidence === null ? 'No data' : confidenceWord(score),
        tone: ocrConfidence === null ? 'neutral' : confidenceTone(score),
      }}
      headlineTooltip={AT_CONFIDENCE_TOOLTIP}
      badges={badges}
    />
  )
}
```

- [ ] **Step 7: Plumb provenance through the page**

In `apps/web/src/app/games/[id]/page.tsx`:

(a) Add `getMatchActionTrackerProvenance` to the `@eanhl/db/queries` import block (after `getMatchEvents`):

```tsx
  getMatchEvents,
  getMatchActionTrackerProvenance,
```

(b) Add a fetch to the `Promise.all([...])` block (alongside the other `safe(...)` calls, e.g. right after the `getMatchEvents` line) and capture it in the destructured results array. Add this line to the array:

```tsx
    safe(() => getMatchActionTrackerProvenance(m.id), { extractedAt: null, sources: [] }),
```

and add a matching binding name (e.g. `actionTrackerProvenance`) to the destructuring `const [ ... ] = await Promise.all([...])` in the SAME position as the new `safe()` call.

(c) Pass it to the component (line ~244):

```tsx
      <ActionTrackerMap
        events={matchEventRows}
        opponentLabel={match.opponentName}
        opponentColor={opponentPrimaryColor}
        bgmWasHome={match.bgmWasHome}
        bgmColor={match.bgmColorHex}
        oppColor={match.oppColorHex}
        faceoffDots={faceoffDots}
        faceoffZones={faceoffZones}
        provenance={actionTrackerProvenance}
      />
```

> NOTE on ordering: the `Promise.all` result array is positional — the binding name you add in step (b) must sit at the exact index where you inserted the `safe()` call. Insert the `safe()` call and its binding name at the same position (recommended: immediately after the `getMatchEvents` entry, which is `matchEventRows`).

- [ ] **Step 8: Rebuild db (for the new export), typecheck web**

Run:
```bash
pnpm --filter @eanhl/db build
pnpm --filter web typecheck
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/matches/action-tracker-map.tsx apps/web/src/app/games/[id]/page.tsx
git commit -m "feat(matches): add Action Tracker OCR provenance footer (always-shown proxy)"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + format**

Run: `pnpm format && pnpm --filter web lint`
Expected: PASS (format may rewrite whitespace — that's fine).

- [ ] **Step 2: Full web typecheck + db build**

Run:
```bash
pnpm --filter @eanhl/db build
pnpm --filter web typecheck
```
Expected: PASS.

- [ ] **Step 3: Re-run all touched unit tests**

Run:
```bash
node --test apps/web/src/lib/lineup-confidence.test.ts
set -a && source .env && set +a
node --test packages/db/dist/queries/__tests__/action-tracker-provenance.test.js
```
Expected: PASS for both.

- [ ] **Step 4: Visual check on match 250**

Start the web dev server (`pnpm --filter web dev`) and open `/games/250`. Confirm:
- **Lineup footer:** `Captured` range, `Sources` = `Pre-game lobby + Loadout view`, headline `Confidence <word> · <0.xx>`, and five badges: `Identity · X%`, `Build · X%`, `X-Factor · X%`, `Tier · X%`, `Attributes · X%`.
- **Action Tracker footer (section bottom):** `Extracted 2026-05-11 → 2026-05-31`, `Sources Action Tracker + Post-game events`, headline `Confidence High · 1.00` (now visible — previously hidden), badges `Plotted · 74/74` and `Extrapolated · 0%`.
- The Action Tracker top summary strip no longer shows an `OCR confidence` or `Source` KV in its secondary row.

If you cannot run the dev server, fall back to: `curl -s http://localhost:3000/games/250 | grep -c "Confidence"` should be ≥ 2.

- [ ] **Step 5: Commit any format-only changes**

```bash
git add -A
git commit -m "chore(matches): format pass for OCR confidence footers" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** shared footer (Task 1) ✓; lineup buckets Approach A (Task 2) ✓; slim provenance (Task 3) ✓; AT provenance query (Task 3) ✓; lineup wiring + wording tooltip (Task 4) ✓; AT footer always-shown + "Extracted" label + wording tooltip + strip cleanup (Task 5) ✓; tests (Tasks 2,3) ✓; visual check (Task 6) ✓.
- **Type consistency:** `LineupConfidence` fields (`identity/build/xfactor/tier/attribute/overall`) used identically in Task 2 and Task 4. `MatchActionTrackerProvenance` (`extractedAt`, `sources[].screenType/eventCount`) consistent across Tasks 3 and 5. `ProvenanceBadge` (`label/tone/tooltip`) and footer props consistent across Tasks 1, 4, 5. `confidenceTone` returns `'ok'|'neutral'|'warn'` matching the footer `headline.tone` union.
- **db-rebuild gotcha** called out in Tasks 3-5 (CLAUDE.md: rebuild `@eanhl/db` before consumer typecheck).
