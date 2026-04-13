# Latest Result Scoreboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the home page Latest Result card into a large, symmetric three-column scoreboard that shows both team identities, the score prominently in the center, a result pill, and the top scorer for the match.

**Architecture:** The component stays a Server Component (receives all props from `page.tsx`). `page.tsx` derives the top scorer from an existing query (`getPlayerMatchStats`) already imported in the DB package. No schema changes required. The opponent logo uses a speculative EA CDN `<img>` with an SVG placeholder fallback.

**Tech Stack:** Next.js 15 App Router, Tailwind CSS 4, Drizzle ORM, `next/image` (our logo), plain `<img>` with `onError` (opponent logo).

---

## Part 1 — Analysis

### Current Weaknesses

1. **Not a scoreboard — left-aligned text layout.** The score is in a `flex-wrap` row with the opponent name at nearly the same font weight. The eye has nowhere obvious to land first.

2. **Score typography undersells the moment.** `text-5xl sm:text-6xl` is decent, but the score is horizontal with the opponent name. No visual separation makes it feel like a stat, not a result.

3. **No opponent identity.** Only the team name as plain text ("vs Le Duo Plus Mario"). No logo, no abbreviation, no visual column. It reads like a sentence, not a scoreboard.

4. **No club record in the card.** W-L-OTL lives in the `RecordStrip` above — not paired with the score. The spec wants records flanking the score on each side.

5. **Our logo is a 4%-opacity watermark.** It's technically present but visually invisible. The spec wants a prominent equal-weight logo on each side.

6. **Result badge is buried.** The small `ResultBadge` (11px, one letter "W") sits inline between the opponent name and shots stat. It's information density without visual impact.

7. **No featured scorer.** The spec calls out GWG/top scorer as a key secondary data point. Currently absent.

8. **Stats strip is an afterthought.** The strip (SOG, Hits, FO%, TOA) is fine data, but placed as a wrapped footer row with no visual separation. It should be a dedicated, clearly labelled bar.

9. **Accent left-border is asymmetric for a symmetric card.** A 4px left accent works for list items (MatchRow). For a hero scoreboard it looks like an afterthought.

---

### Recommended Card Structure

#### Desktop (≥ sm, 640px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  LATEST RESULT                                         Apr 12, 2026  │  ← header row
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌───────────┐     ┌─────────────────┐     ┌───────────┐           │
│   │ [BGM Logo]│     │   7   –   3     │     │ [Shield]  │           │  ← main row
│   │           │     │                 │     │           │           │
│   │   BGM     │     │   [WIN pill]    │     │  OPPNAME  │           │
│   │ 8–3–1     │     │   Top Scorer    │     │  (no rec) │           │
│   │           │     │   Gamertag      │     │           │           │
│   └───────────┘     └─────────────────┘     └───────────┘           │
│                                                                        │
├──────────────────────────────────────────────────────────────────────┤
│  SOG  32–21  ·  Hits  45–38  ·  FO%  54.3%  ·  TOA  12:34          │  ← stats strip
└──────────────────────────────────────────────────────────────────────┘
```

- Three-column `grid-cols-[1fr_auto_1fr]` — left/right flex, center shrinks to content
- Center column is `min-w-[180px]` to give the score breathing room
- Left and right columns are `items-center` vertically and horizontally
- The card has `border-t-2 border-t-accent` (symmetrical top treatment) instead of left accent bar

#### Mobile (< sm)

Stack vertically, center-aligned:

```
┌──────────────────────┐
│  LATEST RESULT / date│
├──────────────────────┤
│   [BGM Logo]         │  ← our team
│   BGM  ·  8–3–1      │
│─────────────────────│
│      7   –   3       │  ← score
│     [WIN pill]       │
│   Top Scorer: Name   │
│─────────────────────│
│   [Shield] OPPNAME   │  ← opponent (logo + name inline)
├──────────────────────┤
│  SOG · Hits · FO%    │  ← stats strip (abbreviated)
└──────────────────────┘
```

---

### Section-by-Section Content Layout

#### Header Row

- Left: `LATEST RESULT` — `font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500`
- Right: date string — `text-xs text-zinc-600`
- Separated by `border-b border-zinc-800/60`

#### Left Column — Our Team

| Element      | Content                          | Typography                                                   |
| ------------ | -------------------------------- | ------------------------------------------------------------ |
| Logo         | `/images/bgm-logo.png`           | `h-16 w-16 object-contain` (64px)                            |
| Abbreviation | `"BGM"` (hardcoded constant)     | `font-condensed text-2xl font-black uppercase text-zinc-100` |
| Record       | `W–L–OTL` from `clubRecord` prop | `font-condensed text-sm font-semibold text-zinc-500`         |

Stacked vertically with `items-center gap-2`.

#### Center Column — Score + Result

| Element     | Content                    | Typography                                                                      |
| ----------- | -------------------------- | ------------------------------------------------------------------------------- |
| Our score   | `match.scoreFor`           | `font-condensed text-7xl font-black` — accent on WIN, `text-zinc-100` otherwise |
| Separator   | `–` (en-dash)              | `font-condensed text-4xl font-black text-zinc-700 mx-2`                         |
| Their score | `match.scoreAgainst`       | `font-condensed text-7xl font-black text-zinc-500`                              |
| Result pill | WIN / LOSS / OT LOSS / DNF | see Result Pill spec below                                                      |

Score numbers sit in a `flex items-baseline` row. Result pill is directly below the score row. No top scorer section.

**Result Pill (new, larger than existing `ResultBadge`):**

```
WIN     → border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 — "WIN"
LOSS    → border border-red-500/40    bg-red-500/10    text-red-400     — "LOSS"
OTL     → border border-orange-500/40 bg-orange-500/10 text-orange-400  — "OT LOSS"
DNF     → border border-zinc-600/40   bg-zinc-800/40   text-zinc-500    — "DNF"
```

Sizing: `inline-flex items-center px-3 py-1 font-condensed text-sm font-bold uppercase tracking-wider`

#### Right Column — Opponent

| Element      | Content                                  | Typography                                                   |
| ------------ | ---------------------------------------- | ------------------------------------------------------------ |
| Logo         | EA CDN attempt → SVG placeholder         | `h-16 w-16 object-contain`                                   |
| Abbreviation | `abbreviateTeamName(match.opponentName)` | `font-condensed text-2xl font-black uppercase text-zinc-100` |
| Record       | **Not available** — omit entirely        | —                                                            |

Note: showing a blank or "–-–-–" for opponent record is actively misleading. Better to simply not show it and let the asymmetry stand — users understand we can't know opponent records.

#### Footer Stats Strip

Unchanged from current content (SOG, Hits, FO%, TOA) but placed in a dedicated `border-t border-zinc-800/60 px-5 py-3` row.

On mobile: abbreviate labels to `SOG` / `HIT` / `FO%` / `TOA`, display inline with `·` separators.

---

### Data Feasibility Assessment

| UI Element            | Status          | Source                                                                                         | Notes                                                         |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Score                 | ✓ Available     | `match.scoreFor / scoreAgainst`                                                                | Already in component                                          |
| Result                | ✓ Available     | `match.result`                                                                                 | WIN / LOSS / OTL / DNF                                        |
| Date                  | ✓ Available     | `match.playedAt`                                                                               | Already in component                                          |
| Link to game detail   | ✓ Available     | `match.id`                                                                                     | Already in component                                          |
| Opponent name         | ✓ Available     | `match.opponentName`                                                                           | Already in component                                          |
| Opponent club ID      | ✓ Available     | `match.opponentClubId`                                                                         | Stored in DB, needed for logo URL                             |
| Our logo              | ✓ Available     | `/images/bgm-logo.png`                                                                         | Public asset, already used                                    |
| Our abbreviation      | ✓ Hardcode      | `"BGM"` constant                                                                               | Not in DB — hardcode in component                             |
| Our season record     | ✓ Available     | `clubStats.wins/losses/otl`                                                                    | Fetched in `page.tsx`, not currently passed to component      |
| Top scorer (by goals) | ✗ Skipped       | `getPlayerMatchStats` exists but GWG proxy omitted                                             | See GWG section below                                         |
| Opponent logo         | ✓ Available     | EA CDN: `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t{clubId}.png` | Confirmed URL pattern from DevTools inspection                |
| Opponent abbreviation | ⚠ Derived       | `abbreviateTeamName()` utility                                                                 | Best-effort from opponentName string                          |
| Opponent record       | ✗ Not available | Would need EA opponent club stats API                                                          | Not worth implementing; omit                                  |
| GWG / Top Scorer      | ✗ Skipped       | Would need goal-by-goal breakdown or extra query                                               | EA API returns per-game totals only; omitted from this design |
| OT vs SO distinction  | ✗ Not tracked   | Both stored as `'OTL'`                                                                         | Show "OT LOSS" for all OTL results                            |

---

### Placeholder Strategy for Missing Data

#### Opponent Logo

**Confirmed EA CDN pattern** (verified via DevTools on the EA Pro Clubs overview page):

```
https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t{clubId}.png
```

Where `{clubId}` is the numeric `opponentClubId` stored in our `matches` table (e.g., club 348 → `t348.png`).

Clubs that haven't set a custom crest serve the default NHL shield logo from the same URL — it never 404s. This means the `<img>` always loads; the SVG placeholder is a belt-and-suspenders safety net.

**Implementation**: plain `<img>` (not `next/image`) — no `remotePatterns` config change needed, `onError` fallback is simpler with a regular img tag.

```tsx
<img
  src={`https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t${clubId}.png`}
  alt={clubName}
  className="absolute inset-0 h-full w-full object-contain"
  onError={(e) => {
    e.currentTarget.style.display = 'none'
  }}
/>
```

Wrap in a `div` that renders `<ShieldPlaceholder />` behind the `<img>`. If the `<img>` loads, it covers the SVG.

**ShieldPlaceholder SVG**: A generic shield outline in `text-zinc-700` — shown only if `onError` fires.

#### Opponent Abbreviation

`abbreviateTeamName(name: string): string`:

- Single word: first 4 chars uppercase → `"Samurai"` → `"SAMU"`
- Multi-word: initials capped at 4 → `"Le Duo Plus Mario"` → `"LDPM"`

This is a frontend-only best-effort. It's consistently wrong in the same predictable way, which users learn quickly. No DB change needed.

#### GWG / Top Scorer

**Omitted entirely.** True GWG requires goal-by-goal breakdown which EA's API doesn't provide. Deriving a proxy "top scorer" introduces noise and an extra query for minimal gain. The card reads cleanly without it — score + result pill + stats strip is enough.

---

### Mobile Behavior

- Remove the 3-column grid on mobile
- Stack: header → our logo/abbrev/record → score row → result pill → top scorer → opponent logo+name → stats strip
- Score numerals stay large: `text-6xl` (slightly smaller than desktop `text-7xl`)
- Result pill same size
- Stats strip: single overflow-x-auto row; label abbreviation optional
- Opponent: show logo (48px) + abbreviation inline on mobile to save vertical space

---

### Open Questions That Matter Before Build

1. **Accent top bar vs left bar**: The new symmetric card uses `border-t-2 border-t-accent` instead of the `border-l-4` pattern on MatchRow. This is appropriate — this is a hero card, not a list item. Confirm this is intentional before starting Task 3.

2. **Stats strip keep or drop**: The SOG/Hits/FO%/TOA strip is present in the current design. The reference image doesn't include it. The plan keeps it as a footer row. Confirm you want it retained.

---

## Part 2 — Implementation Tasks

### File Map

| File                                             | Action    | Purpose                                                    |
| ------------------------------------------------ | --------- | ---------------------------------------------------------- |
| `apps/web/src/lib/format.ts`                     | Modify    | Add `formatRecord`, `abbreviateTeamName`                   |
| `apps/web/src/components/home/latest-result.tsx` | Rewrite   | New 3-col scoreboard layout                                |
| `apps/web/src/app/page.tsx`                      | Modify    | Pass `clubRecord` + `topScorer` props; fetch top scorer    |
| `packages/db/src/queries/matches.ts`             | No change | `getPlayerMatchStats` already in players.ts and sufficient |

---

### Task 1: Add format helpers to `format.ts`

**Files:**

- Modify: `apps/web/src/lib/format.ts`

- [ ] **Step 1: Add `formatRecord` and `abbreviateTeamName` to `format.ts`**

Append to the bottom of `apps/web/src/lib/format.ts`:

```typescript
/**
 * Format a W-L-OTL record as "8–3–1".
 */
export function formatRecord(wins: number, losses: number, otl: number): string {
  return `${wins.toString()}–${losses.toString()}–${otl.toString()}`
}

/**
 * Derive a short team code from a full club name.
 * Single word: first 4 chars uppercase.
 * Multi-word: initials (first char of each word), capped at 4 chars.
 * Examples: "Samurai" → "SAMU", "Le Duo Plus Mario" → "LDPM", "BGM" → "BGM"
 */
export function abbreviateTeamName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return name.slice(0, 4).toUpperCase()
  return words
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 4)
    .toUpperCase()
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @eanhl/web typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/format.ts
git commit -m "feat: add formatRecord and abbreviateTeamName helpers"
```

---

### Task 2: Update `page.tsx` to pass `clubRecord` prop

**Files:**

- Modify: `apps/web/src/app/page.tsx`

No new imports or queries needed. `clubStats` is already fetched in the parallel `Promise.all`. We just pass it through to `LatestResult` as a plain object.

- [ ] **Step 1: Pass `clubRecord` to `LatestResult`**

Find the `LatestResult` usage in `page.tsx` (line ~116):

```typescript
      {lastMatch !== null && (
        <section>
          <LatestResult match={lastMatch} />
        </section>
      )}
```

Replace with:

```typescript
      {lastMatch !== null && (
        <section>
          <LatestResult
            match={lastMatch}
            clubRecord={
              clubStats !== null
                ? { wins: clubStats.wins, losses: clubStats.losses, otl: clubStats.otl }
                : null
            }
          />
        </section>
      )}
```

- [ ] **Step 2: Verify typecheck + lint pass (run after Task 3)**

```bash
pnpm --filter @eanhl/web typecheck && pnpm --filter @eanhl/web lint
```

Expected: no errors.

- [ ] **Step 3: Commit (hold until after Task 3)**

Hold this commit until after Task 3 updates the component interface.

---

### Task 3: Rewrite `latest-result.tsx`

**Files:**

- Rewrite: `apps/web/src/components/home/latest-result.tsx`

- [ ] **Step 1: Write the new component**

Replace the entire contents of `apps/web/src/components/home/latest-result.tsx`:

```typescript
import Image from 'next/image'
import Link from 'next/link'
import type { Match, MatchResult } from '@eanhl/db'
import {
  formatMatchDate,
  formatScore,
  formatTOA,
  formatPct,
  formatRecord,
  abbreviateTeamName,
} from '@/lib/format'

/** Our club's fixed abbreviation. Not in the DB — hardcoded here. */
const OUR_ABBREV = 'BGM'

interface LatestResultProps {
  match: Match
  /**
   * Our club's season W-L-OTL record. Shown below our abbreviation.
   * Null when no games have been played or club stats are unavailable.
   */
  clubRecord: { wins: number; losses: number; otl: number } | null
}

/**
 * Symmetric three-column scoreboard card for the most recent match result.
 *
 * Desktop: [Our Team] | [Score + Result] | [Opponent]
 * Mobile:  stacked vertically, centered.
 *
 * Data notes:
 * - Opponent logo: EA CDN at media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t{clubId}.png
 *   Clubs without a custom crest serve the default NHL shield from the same URL (never 404s).
 *   SVG placeholder shown via onError as a belt-and-suspenders fallback.
 * - Opponent record: not available in our DB — intentionally omitted.
 */
export function LatestResult({ match, clubRecord }: LatestResultProps) {
  const isWin = match.result === 'WIN'
  const ourScoreColor = isWin ? 'text-accent' : 'text-zinc-100'
  const opponentAbbrev = abbreviateTeamName(match.opponentName)

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block overflow-hidden border border-zinc-800 border-t-2 border-t-accent bg-surface transition-colors hover:bg-surface-raised"
    >
      {/* ── Header row ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
        <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Latest Result
        </span>
        <span className="text-xs text-zinc-600">{formatMatchDate(match.playedAt)}</span>
      </div>

      {/* ── Main scoreboard — three-column grid ──────────────────────── */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-8 sm:gap-8 sm:px-8">

        {/* Left: Our team */}
        <div className="flex flex-col items-center gap-2 text-center">
          <Image
            src="/images/bgm-logo.png"
            alt="BGM"
            width={64}
            height={64}
            className="h-14 w-14 object-contain sm:h-16 sm:w-16"
          />
          <span className="font-condensed text-2xl font-black uppercase leading-none text-zinc-100">
            {OUR_ABBREV}
          </span>
          {clubRecord !== null && (
            <span className="font-condensed text-sm font-semibold leading-none text-zinc-500">
              {formatRecord(clubRecord.wins, clubRecord.losses, clubRecord.otl)}
            </span>
          )}
        </div>

        {/* Center: Score + result pill */}
        <div className="flex min-w-[160px] flex-col items-center gap-3 sm:min-w-[200px]">
          {/* Score numerals */}
          <div className="flex items-baseline font-condensed font-black tabular leading-none">
            <span className={`text-6xl sm:text-7xl ${ourScoreColor}`}>
              {match.scoreFor.toString()}
            </span>
            <span className="mx-2 text-3xl text-zinc-700 sm:text-4xl">–</span>
            <span className="text-6xl text-zinc-500 sm:text-7xl">
              {match.scoreAgainst.toString()}
            </span>
          </div>

          {/* Result pill */}
          <ResultPill result={match.result} />
        </div>

        {/* Right: Opponent */}
        <div className="flex flex-col items-center gap-2 text-center">
          <OpponentLogo clubId={match.opponentClubId} clubName={match.opponentName} />
          <span className="font-condensed text-2xl font-black uppercase leading-none text-zinc-100">
            {opponentAbbrev}
          </span>
          {/* Opponent record intentionally omitted — not tracked in our DB */}
        </div>
      </div>

      {/* ── Stats strip ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-zinc-800/60 px-5 py-3 text-xs text-zinc-500">
        <StripStat label="SOG" value={formatScore(match.shotsFor, match.shotsAgainst)} />
        <StripStat label="Hits" value={formatScore(match.hitsFor, match.hitsAgainst)} />
        {match.faceoffPct !== null && (
          <StripStat label="FO%" value={formatPct(match.faceoffPct)} />
        )}
        {match.timeOnAttack !== null && (
          <StripStat label="TOA" value={formatTOA(match.timeOnAttack)} />
        )}
      </div>
    </Link>
  )
}

// ─── Result Pill ──────────────────────────────────────────────────────────────

const RESULT_PILL_CONFIG: Record<MatchResult, { label: string; className: string }> = {
  WIN: {
    label: 'WIN',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  },
  LOSS: {
    label: 'LOSS',
    className: 'border-red-500/40 bg-red-500/10 text-red-400',
  },
  OTL: {
    label: 'OT LOSS',
    className: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  },
  DNF: {
    label: 'DNF',
    className: 'border-zinc-600/40 bg-zinc-800/40 text-zinc-500',
  },
}

function ResultPill({ result }: { result: MatchResult }) {
  const { label, className } = RESULT_PILL_CONFIG[result]
  return (
    <span
      className={`inline-flex items-center border px-3 py-1 font-condensed text-sm font-bold uppercase tracking-wider ${className}`}
    >
      {label}
    </span>
  )
}

// ─── Opponent Logo ────────────────────────────────────────────────────────────

/**
 * Opponent club logo from the EA content CDN.
 *
 * URL pattern confirmed via DevTools inspection of the EA Pro Clubs overview page:
 *   https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t{clubId}.png
 *
 * Clubs without a custom crest serve the default NHL shield logo from the same URL —
 * the endpoint never 404s. The ShieldPlaceholder is a belt-and-suspenders onError fallback.
 *
 * Uses plain <img> (not next/image) to avoid adding media.contentapi.ea.com to
 * remotePatterns. onError is simpler and more reliable with native img elements.
 */
function OpponentLogo({ clubId, clubName }: { clubId: string; clubName: string }) {
  const logoUrl = `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t${clubId}.png`

  return (
    <div className="relative flex h-14 w-14 items-center justify-center sm:h-16 sm:w-16">
      {/* Placeholder — always rendered, visually replaced when <img> loads */}
      <ShieldPlaceholder />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt={clubName}
        className="absolute inset-0 h-full w-full object-contain"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    </div>
  )
}

function ShieldPlaceholder() {
  return (
    <svg
      viewBox="0 0 48 56"
      fill="none"
      className="h-12 w-12 sm:h-14 sm:w-14"
      aria-hidden
    >
      <path
        d="M24 3L4 11v16c0 12.2 8.5 23.6 20 27 11.5-3.4 20-14.8 20-27V11L24 3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        className="text-zinc-700"
      />
    </svg>
  )
}

// ─── Stats strip helper ───────────────────────────────────────────────────────

function StripStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-semibold uppercase tracking-wider text-zinc-600">{label}</span>{' '}
      <span className="tabular text-zinc-400">{value}</span>
    </span>
  )
}
```

- [ ] **Step 2: Verify typecheck + lint + format**

```bash
pnpm --filter @eanhl/web typecheck && pnpm --filter @eanhl/web lint && pnpm prettier --check apps/web/src/components/home/latest-result.tsx apps/web/src/app/page.tsx apps/web/src/lib/format.ts
```

Expected: all pass. If prettier fails: `pnpm prettier --write apps/web/src/components/home/latest-result.tsx apps/web/src/app/page.tsx apps/web/src/lib/format.ts`

- [ ] **Step 3: Commit all three files**

```bash
git add apps/web/src/lib/format.ts apps/web/src/components/home/latest-result.tsx apps/web/src/app/page.tsx
git commit -m "feat: redesign latest result card as symmetric scoreboard"
```

---

### Task 5: Visual Verification

- [ ] **Step 1: Start dev server**

```bash
pnpm --filter web dev
```

- [ ] **Step 2: Verify desktop layout**

Open `http://localhost:3000`. The Latest Result card should show:

- Three clearly distinct columns
- BGM logo (64px) on the left
- Large score numerals in the center (`text-7xl` on desktop)
- Shield placeholder on the right (or actual logo if EA URL works)
- Colored result pill below the score
- Top scorer section if the latest result is a WIN with goals scored
- Stats strip at the bottom

- [ ] **Step 3: Verify mobile layout**

Resize to 375px width (Chrome DevTools device toolbar → iPhone SE).
Expected:

- Columns stack vertically
- Score numerals are `text-6xl` (slightly smaller)
- No layout overflow or truncation

- [ ] **Step 4: Verify edge cases**

- Result = LOSS → pill is red, no top scorer section shown
- Result = OTL → pill is orange, labeled "OT LOSS"
- Long opponent name (e.g. "Le Duo Plus Mario") → abbreviation is "LDPM", no overflow
- Short opponent name (e.g. "BGM") → abbreviation is "BGM", renders same size

- [ ] **Step 5: Update HANDOFF.md**

Add a section "Latest Result Scoreboard Redesign ✓ complete" with the change summary.

---

## Self-Review

**Spec coverage check:**

- ✓ Our logo — shown prominently (left column, 64px)
- ✓ Opponent logo — attempted via EA CDN with placeholder fallback
- ✓ Team abbreviations — BGM hardcoded, opponent derived
- ✓ Our season record — from `clubRecord` prop
- ✓ Opponent record — explicitly omitted (not available, not faked)
- ✓ Score in large centered type — `text-7xl font-condensed font-black`
- ✓ Result pill: green WIN / red LOSS / orange OTL — `ResultPill` component
- ✓ GWG / top scorer — intentionally omitted (not derivable from available data)
- ✓ Click navigates to game detail — Link wraps entire card
- ✓ Mobile behavior — stacked layout via grid → flex collapse
- ✓ Stats strip preserved — SOG, Hits, FO%, TOA

**Type consistency check:**

- `formatRecord`, `abbreviateTeamName` defined in Task 1, used in Task 3 ✓
- `LatestResultProps` interface updated before Task 2 page.tsx changes ✓
- `Match` and `MatchResult` types imported from `@eanhl/db` ✓
- `clubRecord` shape `{ wins, losses, otl } | null` consistent between page.tsx and component ✓

**Placeholder scan:** No TBDs, no "implement later", no missing code blocks.
