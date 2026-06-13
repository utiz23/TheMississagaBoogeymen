# OCR Confidence Footers — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming → spec)
**Scope:** Match-detail page (`/games/[id]`) — Lineup & Loadouts footer + Action Tracker footer.

## Problem

Two queued TODOs in `HANDOFF.md`:

1. **Lineup & Loadouts footer breakout** (HANDOFF ~596–600): the current footer shows three
   coarse badges — `Canonical · X%`, `Tiered · X%`, `Attribute · X%`. This hides *which part* of
   the lineup card is actually weak. We want granular buckets: player-info (number/name/gamertag/
   platform), build-info (build type/height/weight), X-Factor presence/canonical (separate from
   tier), tier, and attributes.

2. **Action Tracker provenance footer** (HANDOFF ~193–201): the Action Tracker section only has a
   *hidden conditional* OCR-confidence proxy (suppressed when `≥ 0.99`) in its top summary strip,
   plus a bare `Source` label. It has no `Captured / Sources / Confidence` footer like the lineup
   section. TODO asks to (2) always show the proxy, (3) add the explicit footer treatment, and
   (4) audit the wording so it is clear the lineup `Confidence` is a *blended provenance/completeness*
   score while the Action Tracker `Confidence` is a *position-extrapolation proxy*.

## Key constraint: no trustworthy per-field OCR confidence

The codebase repeatedly documents that RapidOCR `overall_confidence` is poorly calibrated
(0.93–0.99 even on misreads) and is a whole-frame average, not per-field. There is **no reliable
per-field OCR certainty** wired to the lineup snapshot rows. Therefore the footer numbers are
defined as **field-completeness / recovery proxies** — the share of expected fields the OCR
recovered — and are labeled honestly as such (not as "OCR confidence per field"). This is the
chosen approach (Approach A from brainstorming); blending in `overall_confidence` (Approach B) was
rejected as adding miscalibrated noise.

## Design

### Component 1 — shared presentational footer (new)

New file: `apps/web/src/components/matches/ocr-provenance-footer.tsx`.

A single presentational component both sections render, eliminating duplication. Props:

```ts
interface OcrProvenanceFooterProps {
  capturedAt: { earliest: Date; latest: Date } | null
  /** Label for the timestamp column: "Captured" (lineup) | "Extracted" (action tracker). */
  capturedLabel: string
  /** Pre-formatted source-screen labels, e.g. ["Pre-game lobby", "Loadout view"]. */
  sources: string[]
  /** The blended headline metric. */
  headline: { value: string; word: string; tone: 'ok' | 'neutral' | 'warn' }
  /** Tooltip on the headline "Confidence" label — the wording-audit copy. */
  headlineTooltip: string
  badges: Array<{ label: string; tone: 'ok' | 'warn'; tooltip?: string }>
}
```

When `capturedAt === null` the component returns `null` (no footer). It owns the helpers currently
private to `lineup-section.tsx`: `FootKV`, `SrcBadge`, `formatProvenanceTimestamp`, `formatPercent`,
and the `High/Solid/Partial/Low` word/threshold logic. These move out of `lineup-section.tsx`.

Layout mirrors the current lineup footer exactly (bordered surface box, `Captured/Sources/Confidence`
KVs on the left, badge row on the right, `flex-wrap` so 5 badges wrap on narrow widths). The
`headline` tone maps to the existing colors (`ok` → win, `neutral` → fg-2, `warn` → otl). The
`Confidence` label carries `title={headlineTooltip}`.

### Component 2 — lineup confidence buckets (Approach A)

New file: `apps/web/src/lib/lineup-confidence.ts`. Pure function over the **rendered** lineup rows
(the `MatchLineups` object the page already has — `bgm` + `opponent` concatenated). Computing over
rendered rows (post-EA-platform-overlay) means the numbers match exactly what the user sees and the
platform bucket reflects the EA overlay, not the (always-null) snapshot column.

```ts
interface LineupConfidence {
  identity: number     // mean coverage of {number, persona, gamertag, platform}
  build: number        // mean coverage of {build type, height, weight}
  xfactor: number      // canonical-name resolution rate among detected X-Factors
  tier: number         // valid-tier rate among detected X-Factors
  attribute: number    // share of rows carrying a non-null attribute set
  overall: number      // mean of the five buckets (only buckets with a denominator)
}
export function computeLineupConfidence(lineups: MatchLineups): LineupConfidence
```

Definitions (denominator = rendered human rows; CPU placeholder slots are not in the row set):

- **identity** — for each row, count present of {`playerNumber`, `playerNamePersona`,
  `gamertagSnapshot`/`player`, `platform`} / 4; bucket = mean across rows.
- **build** — for each row, count present of {`buildClass`|`buildClassCanonical`, `heightText`,
  `weightLbs`} / 3; bucket = mean across rows.
- **xfactor** — `(# detected X-Factor entries with non-null canonicalName) / (# detected entries)`
  across all rows. Rows with zero X-Factors contribute nothing to the denominator.
- **tier** — `(# detected entries with a valid tier) / (# detected entries)`.
- **attribute** — `(# rows with non-null attributes) / (# rows)`.
- **overall** — mean of the buckets that have a non-zero denominator (so a section with no detected
  X-Factors doesn't get dragged to 0 by an undefined xfactor/tier bucket). When no rows at all,
  return all zeros.

Empty-denominator buckets render as `—` (not `0%`) in the badge.

The lineup section builds the footer props from this:
- headline value = `overall.toFixed(2)`, word via existing thresholds, tone by threshold.
- headlineTooltip = `"Blended completeness score — the share of expected lineup fields the OCR recovered. Not a per-field OCR certainty."`
- badges (in order): `Identity`, `Build`, `X-Factor`, `Tier`, `Attributes`, each
  `tone: value >= 0.9 ? 'ok' : 'warn'`, label `"<Name> · <pct|—>"`.

### Component 3 — `getMatchLineupProvenance` slimmed

`packages/db/src/queries/match-lineups.ts`: drop the `confidence` block from
`MatchLineupProvenance` and `getMatchLineupProvenance` (the X-Factor + attribute aggregate queries
inside it are removed — that work now lives in the pure fn over rendered rows). Keep `capturedAt`
and `sources`. Update the page's `safe(() => getMatchLineupProvenance(...), <default>)` default to
the slimmed shape. Rebuild `@eanhl/db` before typechecking consumers.

### Component 4 — Action Tracker provenance query (new)

`packages/db/src/queries/match-events.ts`: new `getMatchActionTrackerProvenance(matchId)`.

Join `match_events` (filtered to `source = 'ocr' AND review_status = 'reviewed'`, matching the
`getMatchEvents` visibility rule) → `ocr_extractions` via `ocr_extraction_id`. Return:

```ts
interface MatchActionTrackerProvenance {
  extractedAt: { earliest: Date; latest: Date } | null   // min/max ocr_extractions.extracted_at
  sources: Array<{ screenType: string; eventCount: number }>
}
```

`extracted_at` (not a capture timestamp) is the only time signal available on event rows; it is
labeled **"Extracted"** in the footer and may span reprocess runs (match 250 = 2026-05-11 →
2026-05-31). We surface the honest range rather than hiding it. Screen labels reuse a small map:
`post_game_action_tracker` → "Action Tracker", `post_game_events` → "Post-game events".

### Component 5 — Action Tracker footer wiring

- Page: `safe(() => getMatchActionTrackerProvenance(m.id), { extractedAt: null, sources: [] })`,
  passed as `provenance` prop to `<ActionTrackerMap>`.
- `action-tracker-map.tsx`:
  - Keep the existing client-side `ocrConfidence` proxy computation (fraction of positioned events
    whose `positionConfidence !== 'extrapolated'`).
  - **Remove** the gated `OCR confidence` KV and the `Source` KV from the top `SummaryStrip`
    secondary row (they move to the footer). The strip keeps Visible / On rink / Off rink.
  - Render the shared `OcrProvenanceFooter` at the **bottom of the section** (after the
    events/faceoff content, inside `<section>`), in both view modes:
    - headline value = `ocrConfidence === null ? '—' : ocrConfidence.toFixed(2)`, **always shown**
      (no `< 0.99` gate). Word/tone via the same thresholds; tone `warn` when `< 0.75`.
    - headlineTooltip = `"Position proxy — the share of plotted events whose rink position was read directly, not extrapolated. Not an OCR text-confidence."`
    - badges: `Plotted · N/M` (positioned / tracked-with-coords), and `Extrapolated · X%`
      (tone `warn` when any extrapolated, else `ok`). Source screens go in the `Sources` column.
  - `capturedLabel = "Extracted"`, `capturedAt = provenance.extractedAt`,
    `sources = provenance.sources.map(label)`.

## Data flow

```
page.tsx
 ├─ getMatchLineups(id) ─────────────► lineups ─┐
 ├─ getMatchLineupProvenance(id) ────► {captured, sources}
 │                                              │
 │   LineupSection(lineups, provenance)         │
 │     computeLineupConfidence(lineups) ────────┘──► OcrProvenanceFooter
 │
 ├─ getMatchEvents(id) ──────────────► events ─┐
 └─ getMatchActionTrackerProvenance ─► {extracted, sources}
     ActionTrackerMap(events, provenance)
       client proxy from events ──────────────►──► OcrProvenanceFooter
```

## Testing

- `apps/web/src/lib/__tests__/lineup-confidence.test.ts` — pure-fn unit tests: full coverage → all
  1.0; a row missing height/weight drops build bucket; a row with no platform drops identity; a
  section with no X-Factors → xfactor/tier are empty-denominator (`—`, excluded from overall);
  empty lineups → all zeros; mixed canonical/tier counts produce expected fractions.
- Provenance query: a shape/smoke assertion for `getMatchActionTrackerProvenance` following the
  existing query-test conventions (extractedAt null on a match with no OCR events; populated range
  + per-screen counts on match 250).
- Manual visual check on `/games/250`: lineup footer shows 5 badges; AT footer shows headline
  `Confidence 1.00` (now visible), `Extracted 2026-05-11 → 2026-05-31`, sources `Action Tracker +
  Post-game events`, `Plotted 74/74`, `Extrapolated 0%`.

## Decisions / non-goals

- **No new DB columns or migration.** All signals come from existing columns.
- **AT timestamp is `extracted_at` labeled "Extracted"** — deliberately distinct from the lineup's
  "Captured" (snapshot capture time). We do not invent a capture time for events.
- **5 lineup badges** wrap on narrow widths; no responsive collapse beyond `flex-wrap`.
- We do **not** blend `ocr_extractions.overall_confidence` into the buckets (rejected: miscalibrated,
  whole-frame).
- Out of scope: the other HANDOFF lineup polish items (X-Factor tierless icon fallback, etc.) —
  this spec is footers only.
