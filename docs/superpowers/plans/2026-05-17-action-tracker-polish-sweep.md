# Action Tracker Polish Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Burn six UI-review polish items off the Action Tracker section in one focused sweep — six commits, all touching `action-tracker-map.tsx`, addressing OCR-confidence noise, the FACEOFFS parenthetical jargon, the marker-letter legend, the summary-strip hierarchy + GOALS-chip promotion, sticky-rink-during-scroll, and keyboard navigation through the event list.

**Architecture:** Multi-commit sweep, one commit per fix (except the SummaryStrip hierarchy + GOALS-chip promotion which share the same JSX rewrite and land together). All edits in a single file — `apps/web/src/components/matches/action-tracker-map.tsx`. Most fixes reuse the `SummaryKV` `title?` tooltip pattern just established by the OFF RINK fix and the page-wide emerald/rose convention for "positive" vs "warning" tones.

**Tech Stack:** Next.js 15 App Router, React Client Component (Action Tracker is `'use client'` for filter/selection state), Tailwind CSS 4 with CSS-var tokens. No new dependencies.

---

## Context

After today's bar/color sweep + Scoresheet polish + Action Tracker OFF RINK rename, seven Action Tracker UI-review items remain. They cluster naturally into a single-file sweep:

| #   | Item                                                 | UI review § | Type            |
| --- | ---------------------------------------------------- | ----------- | --------------- |
| 1   | Hide `OCR CONFIDENCE 1.00` when ≥ 0.99               | §8 #2       | Noise reduction |
| 2   | `FACEOFFS (LIST ONLY)` parenthetical → tooltip + `ⓘ` | §8 #4       | UX polish       |
| 3   | Summary strip hierarchy reorganization               | §8 #5       | Layout          |
| 4   | Marker letter legend (S/H/G/P)                       | §8 #8       | Discoverability |
| 5   | Sticky rink during long list scrolls                 | §8 #11      | Interaction     |
| 6   | Keyboard navigation through event list               | §8 #12      | A11y            |
| 7   | GOALS chip typography promotion                      | §8 #6       | Hierarchy       |

Items 3 and 7 share the same `SummaryStrip` JSX rewrite — bundled into Task 4 below. The remaining 5 stay individual.

The intended outcome: the Action Tracker section reads as the page's most polished surface — no noise (OCR 1.00 hidden), no jargon (LIST ONLY → tooltip), visible legend (S/H/G/P), clear hierarchy (GOALS prominent), rink stays in view during list scrolls, and keyboard users can navigate events with arrow keys.

---

## File Map

| Touched in | File                                                     | Why           |
| ---------- | -------------------------------------------------------- | ------------- |
| Tasks 1-6  | `apps/web/src/components/matches/action-tracker-map.tsx` | All six fixes |

Six commits, single file. Each task is line-disjoint from the others except Task 4 (which bundles items 3 + 7 by necessity).

**Existing patterns to reuse:**

- `SummaryKV` with `title?: string | undefined` prop + `ⓘ` glyph — pattern established by the just-shipped OFF RINK fix ([action-tracker-map.tsx:631-678](apps/web/src/components/matches/action-tracker-map.tsx#L631)).
- `text-emerald-400` / `text-rose-400` / amber for tone states — already in `SummaryKV` via the `tone='win'` prop.
- `data-event-id` attribute for scroll/keyboard targeting — already on `EventCard` ([line 1031](apps/web/src/components/matches/action-tracker-map.tsx#L1031)).
- `selectedId` state + `useEffect` scroll-into-view — already in `EventList` ([lines 840-846](apps/web/src/components/matches/action-tracker-map.tsx#L840)).

---

### Task 1: Hide OCR CONFIDENCE when ≥ 0.99

**Files:**

- Modify: `apps/web/src/components/matches/action-tracker-map.tsx` (lines 620-627 inside `SummaryStrip`)

- [ ] **Step 1: Replace the OCR confidence render with a perfect-score gate**

Currently lines 620-627:

```tsx
{
  ocrConfidence !== null && ocrConfidence >= 0.75 ? (
    <SummaryKV k="OCR confidence" v={ocrConfidence.toFixed(2)} tone="win" />
  ) : (
    <SummaryKV k="OCR confidence" v={ocrConfidence === null ? '—' : ocrConfidence.toFixed(2)} />
  )
}
```

Replace with (hide entirely when ≥ 0.99 — perfect score is uninformative noise; show with `tone='win'` for 0.75-0.98, plain when sub-0.75; explainer tooltip explains the metric):

```tsx
{
  ocrConfidence !== null && ocrConfidence < 0.99 ? (
    <SummaryKV
      k="OCR confidence"
      v={ocrConfidence.toFixed(2)}
      tone={ocrConfidence >= 0.75 ? 'win' : undefined}
      title="OCR confidence in this match's extracted events. ≥0.99 hidden as uninformative noise; 0.75-0.98 highlighted as 'good'; below 0.75 plain to draw attention."
    />
  ) : null
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. `tone={... ? 'win' : undefined}` matches the optional union type on `SummaryKV`'s `tone?: 'win'` prop under `exactOptionalPropertyTypes` (a value of `undefined` is allowed because `undefined` is implicit in optional props in this codebase's TS config — but if a strict-mode error appears, widen to `tone?: 'win' | undefined` on `SummaryKV` like the `title` prop).

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250` (where `ocrConfidence` is 1.00 for the Action Tracker source per prior reads). Summary strip's provenance group should now show only `SOURCE: Action Tracker OCR · v2` — the OCR confidence kv is hidden entirely.

Curl sanity:

```bash
curl -s http://localhost:3000/games/250 | grep -c "OCR confidence"
```

Expected: `0` (was 2 — once in DOM, once in RSC payload).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/action-tracker-map.tsx
git commit -m "$(cat <<'EOF'
fix(matches/action-tracker): hide OCR CONFIDENCE when ≥0.99

A perfect 1.00 OCR confidence is uninformative noise — it tells the
reader nothing they didn't already assume from the data being present.
The kv only carries signal when the extractor is uncertain.

Gate the render with `ocrConfidence < 0.99`. Sub-0.99 still shows
with `tone='win'` for 0.75-0.98 (good) and plain styling for <0.75
(draws attention). Tooltip explains the metric for readers who see
the variable rendering.

Resolves UI review §8 issue #2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: FACEOFFS "(LIST ONLY)" parenthetical → tooltip + `ⓘ`

**Files:**

- Modify: `apps/web/src/components/matches/action-tracker-map.tsx` (lines 529-532 inside `TypeToggle`)

- [ ] **Step 1: Replace the "List only" `<span>` with a tooltip glyph**

Currently lines 529-532:

```tsx
{
  isFaceoff ? (
    <span className="font-condensed text-[8.5px] font-semibold tracking-[0.18em] text-[var(--color-fg-5)]">
      List only
    </span>
  ) : null
}
```

Replace with a small `ⓘ` glyph that carries the explainer in a native `title=` tooltip (matches the `SummaryKV` pattern):

```tsx
{
  isFaceoff ? (
    <span
      className="ml-1 text-[var(--color-fg-6)]"
      aria-hidden
      title="Faceoffs are tracked but not plotted on the rink — see the Faceoff Map section below for per-dot positions."
    >
      ⓘ
    </span>
  ) : null
}
```

The chip header now reads `FACEOFFS 7 ⓘ` (with hover-tooltip) instead of `FACEOFFS 7 (LIST ONLY)`. The same explainer that's now on the OFF RINK kv (Task 5 of the prior sweep) shows up here too — natural duplication, since both kv values count the same events.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Filter row's FACEOFFS chip should now read `FACEOFFS 7 ⓘ` (with the count + glyph). Hovering surfaces "Faceoffs are tracked but not plotted on the rink — see the Faceoff Map section below for per-dot positions." Other type chips (GOALS / SHOTS / HITS / PENALTIES) unchanged.

Curl sanity:

```bash
curl -s http://localhost:3000/games/250 | grep -c "List only"
```

Expected: `0` (was 2).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/action-tracker-map.tsx
git commit -m "$(cat <<'EOF'
fix(matches/action-tracker): FACEOFFS chip parenthetical → tooltip glyph

The "(LIST ONLY)" parenthetical after the FACEOFFS chip count
required the reader to know what "LIST ONLY" meant. Replaced with a
small ⓘ glyph that carries the explainer in a native title=
tooltip: "Faceoffs are tracked but not plotted on the rink — see
the Faceoff Map section below for per-dot positions."

Same idiom just shipped on OFF RINK in the previous Action Tracker
fix. Resolves UI review §8 issue #4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Marker letter legend (S/H/G/P)

**Files:**

- Modify: `apps/web/src/components/matches/action-tracker-map.tsx` (line 716, append a new legend strip under the RinkPanel header)

- [ ] **Step 1: Add a small legend strip under the rink header**

The `RinkPanel` header (lines 708-716) currently reads:

```tsx
<div className="mb-2.5 flex items-center gap-3.5">
  <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-4)]">
    Event map · 5-on-5 ice
  </span>
  <div className="ml-auto flex items-center gap-3.5 font-condensed text-[10px] font-bold uppercase tracking-[0.18em]">
    <span className="text-[var(--color-fg-3)]">{oppAbbrev} ←</span>
    <span className="text-[var(--color-fg-6)]">defends · attacks</span>
    <span className="text-[var(--color-accent)]">→ BGM</span>
  </div>
</div>
```

After this `<div>`, add a second small legend strip explaining the marker letters:

```tsx
      <div className="mb-2.5 flex items-center gap-3.5">
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-4)]">
          Event map · 5-on-5 ice
        </span>
        <div className="ml-auto flex items-center gap-3.5 font-condensed text-[10px] font-bold uppercase tracking-[0.18em]">
          <span className="text-[var(--color-fg-3)]">{oppAbbrev} ←</span>
          <span className="text-[var(--color-fg-6)]">defends · attacks</span>
          <span className="text-[var(--color-accent)]">→ BGM</span>
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-condensed text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
        <span className="text-[var(--color-fg-4)]">Legend</span>
        <span><b className="font-black text-[var(--color-fg-2)]">S</b> shot</span>
        <span><b className="font-black text-[var(--color-fg-2)]">H</b> hit</span>
        <span><b className="font-black text-[var(--color-fg-2)]">G</b> goal</span>
        <span><b className="font-black text-[var(--color-fg-2)]">P</b> penalty</span>
      </div>
```

Tiny font, matches the surrounding typography. The letter inside each entry is bold-bright (`text-fg-2`) so it mirrors the visual weight of the markers on the rink.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. RinkPanel header now has two rows: "Event map · 5-on-5 ice ... [direction indicators]" and below it a tiny "LEGEND: **S** shot · **H** hit · **G** goal · **P** penalty" strip.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/action-tracker-map.tsx
git commit -m "$(cat <<'EOF'
feat(matches/action-tracker): inline marker-letter legend (S/H/G/P)

First-time viewers see "S" in a circle on the rink and have to
infer "shot". Added a small Legend strip beneath the rink header
that spells out each marker letter: S shot · H hit · G goal · P
penalty. Tiny tracked-uppercase typography matches the surrounding
header tokens.

Resolves UI review §8 issue #8.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Summary strip hierarchy reorganization + GOALS chip promotion

**Why bundled:** Items 3 (hierarchy) and 7 (GOALS promotion) both rewrite the same `SummaryStrip` JSX block. Splitting them produces a no-op intermediate commit that would just be reverted by the second commit. One commit covers both.

**Files:**

- Modify: `apps/web/src/components/matches/action-tracker-map.tsx` (lines 596-625 — `SummaryStrip` JSX); may extend `SummaryKV` if a `large?` size prop is needed

- [ ] **Step 1: Restructure SummaryStrip into a two-row hierarchy**

The current SummaryStrip flattens three concerns into one wrap-row at equal visual weight. Replace the JSX body (lines 596-624) with a top row for the headline event breakdown (with GOALS promoted) and a smaller secondary row for filter scope + provenance:

```tsx
  return (
    <div className="border border-t-0 border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Top row — event breakdown, with GOALS promoted */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 px-3.5 pt-2.5 pb-2">
        <SummaryKV k="Goals · BGM" v={String(totals.goalsBgm)} accent large />
        <SummaryKV k={oppAbbrev} v={String(totals.goalsOpp)} large />
        <div className="h-7 w-px bg-[var(--color-border)]" aria-hidden />
        <SummaryKV k="Shots" v={String(totals.shots)} />
        <SummaryKV k="Hits" v={String(totals.hits)} />
        <SummaryKV k="Penalties" v={String(totals.penalties)} />
      </div>

      {/* Secondary row — filter scope + provenance, smaller */}
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
        <div className="ml-auto flex items-center gap-x-4">
          {ocrConfidence !== null && ocrConfidence < 0.99 ? (
            <SummaryKV
              k="OCR confidence"
              v={ocrConfidence.toFixed(2)}
              tone={ocrConfidence >= 0.75 ? 'win' : undefined}
              small
              title="OCR confidence in this match's extracted events. ≥0.99 hidden as uninformative noise; 0.75-0.98 highlighted as 'good'; below 0.75 plain to draw attention."
            />
          ) : null}
          <SummaryKV k="Source" v="Action Tracker OCR · v2" small />
        </div>
      </div>
    </div>
  )
}
```

Notes:

- GOALS · BGM + opp goals are the headline at `large` size (new prop, see Step 2). Shots / Hits / Penalties stay at default size as the secondary breakdown on the same row.
- The OFF RINK kv (with its tooltip) and OCR confidence kv (with its sub-0.99 gate from Task 1) both move into the smaller secondary row as `small`. They're filter scope + provenance, demoted accordingly.
- The flex layout uses `items-baseline` on the top row so the big numbers and labels align cleanly across the GOALS / Shots / Hits / Penalties chips.

- [ ] **Step 2: Add the `large` size prop to `SummaryKV`**

`SummaryKV` (lines 631-678) currently has `small?: boolean` which switches to `text-[11px] font-bold` (the secondary-row size). Add a parallel `large?: boolean` that bumps to `text-[24px]`:

```tsx
function SummaryKV({
  k,
  v,
  accent,
  dim,
  tone,
  small,
  large,
  title,
}: {
  k: string
  v: string
  accent?: boolean
  dim?: boolean
  tone?: 'win'
  small?: boolean
  large?: boolean
  title?: string | undefined
}) {
  const colorClass =
    accent === true
      ? 'text-[var(--color-accent)]'
      : tone === 'win'
        ? 'text-[var(--color-win,#3fb27f)]'
        : dim === true
          ? 'text-[var(--color-fg-4)]'
          : small === true
            ? 'text-[var(--color-fg-3)]'
            : 'text-[var(--color-fg-1)]'
  const sizeClass =
    large === true
      ? 'text-[24px] font-black tabular-nums'
      : small === true
        ? 'text-[11px] font-bold'
        : 'text-[18px] font-black tabular-nums'
  return (
    <div className="flex flex-col gap-[1px]" title={title}>
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        {k}
        {title ? (
          <span className="ml-1 text-[var(--color-fg-6)]" aria-hidden>
            ⓘ
          </span>
        ) : null}
      </span>
      <span className={`font-condensed leading-none ${sizeClass} ${colorClass}`}>{v}</span>
    </div>
  )
}
```

The `large` and `small` props are mutually exclusive — `large` wins. (The TypeScript prop signature allows both, but the runtime branches on `large` first.) `large` adds `text-[24px]` — about 33% bigger than the default 18px, enough to make GOALS visibly dominant without breaking the row layout.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 4: Manual browser verification**

Navigate to `/games/250`. The Action Tracker summary strip should now show:

- **Top row (bigger):** `GOALS · BGM **4**` / `4L **3**` (24px, accent on BGM) | divider | `SHOTS 29` / `HITS 35` / `PENALTIES 0` (18px)
- **Bottom row (smaller):** `VISIBLE 34 / ON RINK 27 / OFF RINK 7 ⓘ` (11px, left-aligned) | gap | `SOURCE Action Tracker OCR · v2` (right-aligned, no OCR confidence since 1.00 is hidden)

GOALS reads as the clear hero number; everything else recedes.

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/action-tracker-map.tsx
git commit -m "$(cat <<'EOF'
feat(matches/action-tracker): two-row summary hierarchy + GOALS chip promotion

The summary strip flattened three concepts (filter scope, event
breakdown, provenance) at equal visual weight — readers had no cue
that the GOALS count is the most important number on the page.

Restructured into two rows:
- Top row at 24px (new `large` prop on SummaryKV) for the headline:
  GOALS·BGM / opp / Shots / Hits / Penalties. GOALS visually
  dominates as the hero number.
- Bottom row at 11px (`small`) for filter scope + provenance:
  Visible / On rink / Off rink / OCR confidence (when sub-0.99) /
  Source. Demoted to where the reader expects metadata.

Resolves UI review §8 issues #5 (hierarchy) and #6 (GOALS chip
promotion). Coexists with the Task 1 OCR-confidence gate (sub-0.99
shows in the secondary row).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Sticky rink during long list scrolls

**Files:**

- Modify: `apps/web/src/components/matches/action-tracker-map.tsx` (line 707 — the RinkPanel outer wrapper)

- [ ] **Step 1: Add sticky positioning to the RinkPanel wrapper**

The RinkPanel outer wrapper (line 707) is currently:

```tsx
    <div className="border border-[var(--color-border)] broadcast-panel-strong px-3.5 pb-2 pt-3.5">
```

Replace with (adds `xl:sticky xl:top-4 xl:self-start` — only sticky at xl breakpoint where the two-pane grid kicks in):

```tsx
    <div className="border border-[var(--color-border)] broadcast-panel-strong px-3.5 pb-2 pt-3.5 xl:sticky xl:top-4 xl:self-start">
```

Notes:

- `xl:sticky` activates only at xl breakpoint where the grid is `xl:grid-cols-[380px_1fr]` (line 296). At narrower breakpoints the panes stack vertically and sticky doesn't apply (and would be wrong anyway).
- `xl:top-4` gives 16px clearance below the page top when stuck. If the site has a top nav that's also sticky, this may need to be `xl:top-16` or similar — calibrate by eye after the change lands.
- `xl:self-start` is required for sticky to work in a grid item: without it, the grid item stretches to fill the column height and there's no overflow for sticky to engage on.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. (Tailwind class change only.)

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250` at desktop width (≥1280px). Scroll the page down past the start of the Action Tracker — the rink should remain visible on the right while the event list scrolls underneath. If the rink is cut off at the top by a sticky page nav, bump `xl:top-4` to a value that matches the nav height.

At mobile width (<1280px) panes stack vertically and sticky doesn't apply — the rink scrolls with the page as before.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/action-tracker-map.tsx
git commit -m "$(cat <<'EOF'
feat(matches/action-tracker): sticky rink during long list scrolls

The two-pane layout has the rink on the right and the event list
on the left, but on long event lists (~30+ rows) the rink would
scroll off-screen as the user dug through events. Added
`xl:sticky xl:top-4 xl:self-start` to the RinkPanel wrapper so the
rink stays in view while the list scrolls beneath it.

Only applies at xl breakpoint where the two-pane grid is active;
at mobile widths the panes stack vertically and sticky doesn't
engage.

Resolves UI review §8 issue #11.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Keyboard navigation through the event list

**Files:**

- Modify: `apps/web/src/components/matches/action-tracker-map.tsx` (lines 820-915 — `EventList` component)

- [ ] **Step 1: Add an `onClearSelected` prop to `EventList` for the Escape handler**

`EventList`'s current props signature (lines 826-836) doesn't carry `onClearSelected` (that callback is wired to RinkPanel only at line 314). For Escape to clear selection from the list side, EventList needs it too. Update the signature + the parent call site at line 297-306:

In `EventList`'s props (insert after `onSelect`):

```tsx
  onSelect: (id: number) => void
  onClearSelected: () => void
  bgmIsHome: boolean
}) {
```

In the parent `<EventList>` JSX (line 297-306), add the prop:

```tsx
<EventList
  events={visibleCards}
  sortMode={sortMode}
  setSortMode={setSortMode}
  selectedId={selectedId}
  hoveredId={hoveredId}
  onHover={setHoveredId}
  onSelect={toggleSelected}
  onClearSelected={clearSelected}
  bgmIsHome={bgmIsHome}
/>
```

- [ ] **Step 2: Wire arrow-key + Escape navigation on the scroll container**

EventList's scroll container (line 915) is currently:

```tsx
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
```

Replace with a keyboard handler that computes the prev/next event id from the currently-sorted events and calls `onSelect`:

```tsx
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto focus:outline-none"
        tabIndex={0}
        role="listbox"
        aria-label="Event list — use arrow keys to navigate, Enter to select, Escape to clear"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (sorted.length === 0) return
            const currentIdx = sorted.findIndex((ev) => ev.id === selectedId)
            // ArrowDown: move toward end of list; ArrowUp: move toward start.
            // If no selection yet, ArrowDown picks index 0, ArrowUp picks last.
            const nextIdx =
              currentIdx === -1
                ? e.key === 'ArrowDown'
                  ? 0
                  : sorted.length - 1
                : e.key === 'ArrowDown'
                  ? Math.min(currentIdx + 1, sorted.length - 1)
                  : Math.max(currentIdx - 1, 0)
            const next = sorted[nextIdx]
            if (next) onSelect(next.id)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClearSelected()
          }
        }}
      >
```

The existing `selectedId`-change effect at line 840-846 will handle scroll-into-view automatically when `onSelect` changes the selection. The scroll container's `tabIndex={0}` makes it focusable so users can Tab into the list, then use arrow keys.

Note: `sorted` is the local variable computed at lines 862-870 from `events` + `sortMode`. It's already in scope within the same function — the keyboard handler references it directly.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. The new prop on `EventList` matches the parent call site at line 297-306.

- [ ] **Step 4: Manual browser verification**

Navigate to `/games/250`, Action Tracker section. Click into the event list (or Tab into it). Press ↓: the first event row should highlight (and the matching rink marker should halo via the existing wiring). Press ↓ again: moves to next event. Press ↑: moves back. Press Escape: clears selection. Verify the rink marker follows along.

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/action-tracker-map.tsx
git commit -m "$(cat <<'EOF'
feat(matches/action-tracker): arrow-key navigation through event list

Tab into the event list, then use arrow keys to walk through
events — selection updates, rink marker halos, scroll-into-view
follows the existing selectedId pipeline. Escape clears.

EventList's scroll container becomes focusable (tabIndex={0}),
gets role="listbox" + aria-label for screen readers, and an
onKeyDown handler that computes next/prev event id from the
already-sorted events array.

Added `onClearSelected` to EventList's props (parent already
passes `clearSelected` to RinkPanel for click-outside; same
callback now wired through to the list for Escape).

Resolves UI review §8 issue #12.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (end-to-end, after all 6 commits)

1. **Typecheck:** `pnpm typecheck` — 0 errors.
2. **Format:** `pnpm format` — clean.
3. **Browser at `/games/250`** — full Action Tracker walkthrough:
   - **Filter row:** FACEOFFS chip reads `FACEOFFS 7 ⓘ` (no LIST ONLY); hover tooltip explains.
   - **Summary strip top row (large):** `GOALS · BGM 4 / 4L 3` dominates, then `SHOTS 29 / HITS 35 / PENALTIES 0`.
   - **Summary strip bottom row (small):** `VISIBLE 34 / ON RINK 27 / OFF RINK 7 ⓘ` left, `SOURCE Action Tracker OCR · v2` right. OCR confidence hidden (1.00 is the gate trigger).
   - **Rink panel header:** "Event map · 5-on-5 ice" + direction strip + new legend strip `LEGEND: S shot · H hit · G goal · P penalty`.
   - **Scroll down past Action Tracker (desktop):** rink stays visible on the right while the event list scrolls.
   - **Keyboard:** Tab into event list, ↓/↑ moves selection, rink marker follows, Escape clears.
4. **Curl sanity:**
   - `grep -c "OCR confidence" → 0` (was 2)
   - `grep -c "List only" → 0` (was 2)
   - `grep -c "Legend" → ≥2` (new legend strip rendered)
5. **Git log review:** `git log --oneline -6` — six commits, each scoped to one issue.

## Out of Scope (follow-ups)

- **Two untracked plan files** (`docs/superpowers/plans/2026-05-17-bar-color-sweep.md` + `2026-05-17-scoresheet-polish.md`) — still uncommitted; separate cleanup commit when convenient.
- **Other Action Tracker items closed by today's work** — UI review §8 #1 (UNPLACED → OFF RINK, done), #3 (event-list ↔ rink-marker integration, marked Resolved). All major polish items now closed; Action Tracker should drop off the open-section list after this sweep.
- **Marker clustering at the net** (UI review §8 #7) — non-trivial fix (jitter / dodge layout) deferred to a separate spike.
- **Rink orientation flip between periods** (UI review §8 #10) — data-correctness item, not polish. Separate investigation.
