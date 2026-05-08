# Phase 1: Lean UI Primitives Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract 5 lean UI primitives + 1 color helper into `apps/web/src/components/ui/` and `apps/web/src/lib/`, render every variant in a temporary kitchen-sink dev page, with no consumer pages touched. Phase 1 ships infrastructure only — visible page changes start in Phase 2.

**Architecture:** Each primitive is a server component (no `'use client'`), styled entirely by props using existing Tailwind utility classes and the design tokens already in `apps/web/src/app/globals.css`. The kitchen-sink page at `apps/web/src/app/_kitchen-sink/page.tsx` is the visual verification harness; it renders every variant and is removed at end of Phase 6. No unit tests in this phase — apps/web has no test infra and the primitives have minimal logic; visual verification on the kitchen-sink page is the verification.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript strict, Tailwind CSS 4 (already configured with the design tokens via `@theme` block), no new dependencies.

**Working assumptions:**
- Current branch: `feat/design-system-renovation`. Created from clean `main` at the start of Phase 1.
- `apps/web/src/app/globals.css` already defines `--color-*` tokens, `.broadcast-panel`, `.broadcast-panel-soft`, `.tabular`, `--font-condensed`. These are pre-existing and unchanged by this phase.
- The renovation spec (`docs/superpowers/specs/2026-05-07-boogeymen-renovation-design.md`) is authoritative for primitive APIs; bundle previews under `docs/design/boogeymen-system/preview/*.html` are visual references for variants.
- Run all commands from the repo root: `/home/michal/projects/eanhl-team-website`.

**Out of scope:**
- Modifying any consumer page or component (no edits to `app/page.tsx`, `app/roster/[id]/page.tsx`, `components/home/*`, `components/matches/*`, `components/roster/*`).
- Setting up a test runner for apps/web.
- Adding new design tokens or CSS classes — globals.css is unchanged.
- Removing the kitchen-sink page (that happens at end of Phase 6).

---

## File Map

**New files this phase creates:**

| Path | Responsibility | Approx LOC |
|---|---|---|
| `apps/web/src/lib/result-colors.ts` | `ResultKind` type + `getResultStyle(result)` color-class mapping helper | 35 |
| `apps/web/src/components/ui/panel.tsx` | `<Panel>` — sharp 1px border surface, default/raised tone, optional hover | 45 |
| `apps/web/src/components/ui/broadcast-panel.tsx` | `<BroadcastPanel>` — Panel + ticker strip + radial glow via existing CSS classes | 40 |
| `apps/web/src/components/ui/section-header.tsx` | `<SectionHeader>` — UPPERCASE tracking-widest label + optional CTA arrow | 50 |
| `apps/web/src/components/ui/result-pill.tsx` | `<ResultPill>` — W/L/OTL/DNF chip (size sm) or pill (size md) | 60 |
| `apps/web/src/components/ui/stat-strip.tsx` | `<StatStrip>` — inline label/value pair runs with optional provenance | 65 |
| `apps/web/src/app/_kitchen-sink/page.tsx` | Dev-only page rendering every primitive variant | 220 |

All component files: server components (no `'use client'`), `export function ComponentName(...)` style, `interface Props` typed, `forwardRef` not used (server components don't need refs).

---

## Task 1: Add `result-colors.ts` helper

The helper is a pure mapping function consumed by `<ResultPill>`. Extracting it first lets the pill component import a stable signature.

**Files:**
- Create: `apps/web/src/lib/result-colors.ts`

- [ ] **Step 1: Create the helper file**

Write to `apps/web/src/lib/result-colors.ts`:

```ts
export type ResultKind = 'WIN' | 'LOSS' | 'OTL' | 'DNF'

interface ResultStyle {
  /** Tailwind classes for the chip/pill container — bg + border + text. */
  container: string
  /** Single-letter glyph used in the small "chip" variant (size=sm). */
  glyph: string
  /** Full-word label used in the medium "pill" variant (size=md). */
  label: string
}

const STYLES: Record<ResultKind, ResultStyle> = {
  WIN: {
    container: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
    glyph: 'W',
    label: 'WIN',
  },
  LOSS: {
    container: 'bg-rose-500/10 border-rose-500/40 text-rose-400',
    glyph: 'L',
    label: 'LOSS',
  },
  OTL: {
    container: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
    glyph: 'OT',
    label: 'OT LOSS',
  },
  DNF: {
    container: 'bg-zinc-700/40 border-zinc-600/40 text-zinc-400',
    glyph: '—',
    label: 'DNF',
  },
}

export function getResultStyle(result: ResultKind): ResultStyle {
  return STYLES[result]
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (helper is internally consistent; no consumers yet).

- [ ] **Step 3: Stage + commit**

```bash
git add apps/web/src/lib/result-colors.ts
git commit -m "$(cat <<'EOF'
feat(web): add result-colors helper for design-system primitives

ResultKind type ('WIN' | 'LOSS' | 'OTL' | 'DNF') plus getResultStyle()
returning {container, glyph, label} for each. Container classes match
the design system spec (emerald / rose / amber / zinc on /10 fill +
/40 border). Consumed by the upcoming ResultPill primitive.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add result-colors helper ...` is HEAD.

---

## Task 2: Add `<Panel>` primitive

The structural workhorse. Sharp 1px border surface, two tones, optional hover lift. Used by every other primitive directly or indirectly.

**Files:**
- Create: `apps/web/src/components/ui/panel.tsx`

- [ ] **Step 1: Create the component file**

Write to `apps/web/src/components/ui/panel.tsx`:

```tsx
import type { ReactNode } from 'react'

interface PanelProps {
  /** Surface fill. `default` = #18181b (--color-surface), `raised` = #1f1f22 (--color-surface-raised). */
  tone?: 'default' | 'raised'
  /** Adds hover state: border lightens, surface steps up to raised. Default false. */
  hoverable?: boolean
  className?: string
  children?: ReactNode
}

/**
 * Sharp 1px border panel — the workhorse container of the broadcast-strip
 * design system. No corner radius, no drop shadow.
 */
export function Panel({
  tone = 'default',
  hoverable = false,
  className = '',
  children,
}: PanelProps) {
  const surface = tone === 'raised' ? 'bg-surface-raised' : 'bg-surface'
  const hover = hoverable
    ? 'transition-[border-color,background-color] hover:border-zinc-700 hover:bg-surface-raised'
    : ''
  return (
    <div className={`rounded-none border border-zinc-800 ${surface} ${hover} ${className}`}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/panel.tsx
git commit -m "$(cat <<'EOF'
feat(web): add Panel primitive — sharp-edge border surface

Server component, two tones (default surface vs raised), optional
hoverable variant that lifts the border + steps the fill on :hover.
Backbone of the design-system primitives layer; all higher-level
primitives compose from this or its variants.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add Panel primitive ...` is HEAD.

---

## Task 3: Add `<BroadcastPanel>` primitive

Panel + the broadcast-strip decoration: a 1px red ticker on top + a soft radial red glow at the top of the surface. The radial glow lives in the existing `.broadcast-panel` / `.broadcast-panel-soft` CSS classes in `globals.css` (no new CSS in this phase). The ticker is rendered as a child div.

**Files:**
- Create: `apps/web/src/components/ui/broadcast-panel.tsx`

- [ ] **Step 1: Create the component file**

Write to `apps/web/src/components/ui/broadcast-panel.tsx`:

```tsx
import type { ReactNode } from 'react'

interface BroadcastPanelProps {
  /** Decoration intensity. `default` = full glow + ticker. `soft` = dimmed glow + ticker. */
  intensity?: 'default' | 'soft'
  /** Render the 1px red top ticker. Default true. */
  ticker?: boolean
  className?: string
  children?: ReactNode
}

/**
 * The broadcast-strip surface — Panel with a 1px red top ticker and a
 * soft red radial glow at the top. Used for hero scoreboards, leaders
 * panels, featured leader rows, and any element that wants a TV-broadcast
 * accent. The radial glow comes from the existing .broadcast-panel /
 * .broadcast-panel-soft CSS classes in globals.css.
 */
export function BroadcastPanel({
  intensity = 'default',
  ticker = true,
  className = '',
  children,
}: BroadcastPanelProps) {
  const surfaceClass = intensity === 'soft' ? 'broadcast-panel-soft' : 'broadcast-panel'
  return (
    <div className={`relative overflow-hidden rounded-none ${surfaceClass} ${className}`}>
      {ticker ? (
        <div
          aria-hidden
          className="h-[3px] w-full bg-gradient-to-r from-rose-900 via-accent to-rose-900"
        />
      ) : null}
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/broadcast-panel.tsx
git commit -m "$(cat <<'EOF'
feat(web): add BroadcastPanel primitive — broadcast-strip surface

Sharp panel + 1px red top ticker + soft red radial glow. Backed by the
existing .broadcast-panel / .broadcast-panel-soft CSS classes in
globals.css; this component just wraps those classes with the ticker
child element so consumers don't reach for raw CSS class names.

Two intensities (default and soft) for hero vs supporting placements.
Ticker can be disabled when the consumer wants only the glow.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add BroadcastPanel primitive ...` is HEAD.

---

## Task 4: Add `<SectionHeader>` primitive

The UPPERCASE tracking-widest label that sits above every section, with an optional `→` CTA on the right. The two are vertically baseline-aligned with horizontal space-between.

**Files:**
- Create: `apps/web/src/components/ui/section-header.tsx`

- [ ] **Step 1: Create the component file**

Write to `apps/web/src/components/ui/section-header.tsx`:

```tsx
import Link from 'next/link'

interface SectionHeaderProps {
  /** The section label, rendered UPPERCASE. */
  label: string
  /** Optional right-side call-to-action with arrow. */
  cta?: {
    href: string
    label: string
  }
  /**
   * Heading level for accessibility. Defaults to h2.
   * Use h1 only on the page hero.
   */
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}

/**
 * Section header — the "LATEST RESULT", "SCORING LEADERS" rule that
 * runs above every page section. Uppercase wide-tracking label in
 * font-condensed, dim zinc-500 on the label, lifting to zinc-100 on
 * the optional CTA arrow.
 */
export function SectionHeader({
  label,
  cta,
  as: Heading = 'h2',
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-baseline justify-between ${className}`}>
      <Heading className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:text-sm">
        {label}
      </Heading>
      {cta ? (
        <Link
          href={cta.href}
          className="font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-100"
        >
          {cta.label} <span aria-hidden>→</span>
        </Link>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/section-header.tsx
git commit -m "$(cat <<'EOF'
feat(web): add SectionHeader primitive

UPPERCASE tracking-widest font-condensed label that runs above every
section, with an optional right-aligned CTA arrow ("All games →").
Heading level prop (h1 | h2 | h3) for a11y; defaults to h2 since h1
belongs only on the page hero.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add SectionHeader primitive` is HEAD.

---

## Task 5: Add `<ResultPill>` primitive

W/L/OTL/DNF chip (sm) or pill (md). The small chip uses a single-letter glyph (W/L/OT/—); the medium pill uses the full word (WIN/LOSS/OT LOSS/DNF). Backed by `getResultStyle()` from Task 1.

**Files:**
- Create: `apps/web/src/components/ui/result-pill.tsx`

- [ ] **Step 1: Create the component file**

Write to `apps/web/src/components/ui/result-pill.tsx`:

```tsx
import { getResultStyle, type ResultKind } from '@/lib/result-colors'

interface ResultPillProps {
  result: ResultKind
  /**
   * Variant size. `sm` is the 24px-tall chip used inside dense rows
   * (game lists, recent-form strips); `md` is the 42px-tall pill used
   * in heroes and featured contexts.
   */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Result pill — the W/L/OT/DNF marker. Letter glyph at sm, full word
 * at md. Color via getResultStyle: emerald (WIN), rose (LOSS), amber
 * (OTL), zinc (DNF).
 */
export function ResultPill({ result, size = 'sm', className = '' }: ResultPillProps) {
  const style = getResultStyle(result)
  const sizeClasses =
    size === 'md'
      ? 'h-[42px] min-w-[88px] px-4 text-sm tracking-[0.22em]'
      : 'h-6 min-w-[32px] px-2 text-[11px] tracking-[0.20em]'
  const text = size === 'md' ? style.label : style.glyph
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border font-condensed font-bold uppercase ${sizeClasses} ${style.container} ${className}`}
    >
      {text}
    </span>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (depends on Task 1's `result-colors.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/result-pill.tsx
git commit -m "$(cat <<'EOF'
feat(web): add ResultPill primitive — W/L/OT/DNF chip + pill

Two sizes: sm renders the letter glyph (W / L / OT / —) inside a 24px
chip for dense rows; md renders the full word (WIN / LOSS / OT LOSS /
DNF) inside a 42px pill for heroes. Color mapping comes from
getResultStyle() — emerald / rose / amber / zinc on /10 fill + /40
border. Letter glyphs over icon glyphs is intentional per the design
system: at scoreboard density, letters scan faster than pictograms.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add ResultPill primitive ...` is HEAD.

---

## Task 6: Add `<StatStrip>` primitive

Inline horizontal label/value pair runs. Each item has tiny uppercase label above a tabular condensed-bold value. Optional `accent` flag tints the value rose-400 (used for the WIN column in record strips). Optional bottom provenance row with a red dot + dim text.

**Files:**
- Create: `apps/web/src/components/ui/stat-strip.tsx`

- [ ] **Step 1: Create the component file**

Write to `apps/web/src/components/ui/stat-strip.tsx`:

```tsx
import type { ReactNode } from 'react'

export interface StatStripItem {
  label: string
  value: ReactNode
  /** Tint the value rose-400. Use for the headline column (WIN, Win%). */
  accent?: boolean
  /** Render the value dimmer (zinc-500). Use for muted columns (OTL when low). */
  dim?: boolean
}

interface StatStripProps {
  items: StatStripItem[]
  /** Optional provenance tag rendered below the strip (e.g. "EA official", "local · 6s only"). */
  provenance?: string
  /** Spacing variant. `default` = gap-x-6 gap-y-2. `tight` = gap-x-4 gap-y-1. */
  density?: 'default' | 'tight'
  className?: string
}

/**
 * Inline label/value pair runs — record strips, hero stat lines, game
 * cards, etc. Tabular numerals globally; condensed-bold values with
 * tiny dim-uppercase labels. Optional provenance row at the bottom
 * with a small accent-red dot.
 */
export function StatStrip({
  items,
  provenance,
  density = 'default',
  className = '',
}: StatStripProps) {
  const gapX = density === 'tight' ? 'gap-x-4' : 'gap-x-6'
  const gapY = density === 'tight' ? 'gap-y-1' : 'gap-y-2'
  return (
    <div className={`flex flex-col ${className}`}>
      <dl className={`tabular flex flex-wrap ${gapX} ${gapY}`}>
        {items.map((item) => {
          const valueColor = item.accent
            ? 'text-rose-400'
            : item.dim
              ? 'text-zinc-500'
              : 'text-zinc-100'
          return (
            <div key={item.label} className="flex flex-col">
              <dt className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                {item.label}
              </dt>
              <dd
                className={`font-condensed text-2xl font-bold leading-none ${valueColor}`}
              >
                {item.value}
              </dd>
            </div>
          )
        })}
      </dl>
      {provenance ? (
        <p className="mt-3 flex items-center gap-2 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {provenance}
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/stat-strip.tsx
git commit -m "$(cat <<'EOF'
feat(web): add StatStrip primitive — inline label/value runs

Renders an array of {label, value, accent?, dim?} items as a flex-wrap
horizontal run with tiny uppercase labels above tabular condensed-bold
values. Accent tints rose-400 (used for WIN / Win% columns); dim tints
zinc-500 (used for muted OTL). Optional provenance row at the bottom
with the accent red dot — "EA official", "local · 6s only", etc.

Two density variants for hero (default gap-x-6) vs dense card runs
(tight gap-x-4).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add StatStrip primitive ...` is HEAD.

---

## Task 7: Add the kitchen-sink dev page

Renders every primitive variant on a single route at `/_kitchen-sink`. The leading underscore in the segment name is a convention for "internal / not user-facing"; Next.js still serves it. Removed at end of Phase 6.

**Files:**
- Create: `apps/web/src/app/_kitchen-sink/page.tsx`

- [ ] **Step 1: Create the page file**

Write to `apps/web/src/app/_kitchen-sink/page.tsx`:

```tsx
import { Panel } from '@/components/ui/panel'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { SectionHeader } from '@/components/ui/section-header'
import { ResultPill } from '@/components/ui/result-pill'
import { StatStrip } from '@/components/ui/stat-strip'

export const metadata = {
  title: 'Kitchen Sink — Boogeymen UI Primitives',
}

export default function KitchenSinkPage() {
  return (
    <main className="mx-auto max-w-screen-xl space-y-12 px-4 py-10">
      <header>
        <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
          Internal · Phase 1
        </p>
        <h1 className="mt-1 font-condensed text-3xl font-black uppercase tracking-[0.06em] text-zinc-50">
          Boogeymen UI Primitives
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Visual verification harness for the design-system primitives. Compare each
          variant against{' '}
          <code className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-300">
            docs/design/boogeymen-system/preview/*.html
          </code>
          . Removed at end of Phase 6.
        </p>
      </header>

      {/* Panel ------------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="Panel" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Panel className="p-6">
            <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
              tone=default
            </p>
            <p className="mt-2 text-sm text-zinc-200">Surface = #18181b</p>
          </Panel>
          <Panel tone="raised" className="p-6">
            <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
              tone=raised
            </p>
            <p className="mt-2 text-sm text-zinc-200">Surface = #1f1f22</p>
          </Panel>
          <Panel hoverable className="p-6">
            <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
              hoverable
            </p>
            <p className="mt-2 text-sm text-zinc-200">Hover me</p>
          </Panel>
        </div>
      </section>

      {/* BroadcastPanel ---------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="BroadcastPanel" />
        <div className="grid gap-4 sm:grid-cols-2">
          <BroadcastPanel>
            <div className="p-6">
              <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
                intensity=default
              </p>
              <p className="mt-2 text-sm text-zinc-200">Full glow + ticker</p>
            </div>
          </BroadcastPanel>
          <BroadcastPanel intensity="soft">
            <div className="p-6">
              <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
                intensity=soft
              </p>
              <p className="mt-2 text-sm text-zinc-200">Dimmed glow + ticker</p>
            </div>
          </BroadcastPanel>
          <BroadcastPanel ticker={false}>
            <div className="p-6">
              <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
                ticker=false
              </p>
              <p className="mt-2 text-sm text-zinc-200">Glow only, no top strip</p>
            </div>
          </BroadcastPanel>
        </div>
      </section>

      {/* SectionHeader ----------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="SectionHeader" />
        <Panel className="space-y-6 p-6">
          <SectionHeader label="Latest Result" />
          <SectionHeader
            label="Scoring Leaders"
            cta={{ href: '/stats', label: 'All stats' }}
          />
          <SectionHeader label="Page Title (h1)" as="h1" />
        </Panel>
      </section>

      {/* ResultPill -------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="ResultPill" />
        <Panel className="space-y-6 p-6">
          <div>
            <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              size=sm (chip · letter glyph)
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ResultPill result="WIN" size="sm" />
              <ResultPill result="LOSS" size="sm" />
              <ResultPill result="OTL" size="sm" />
              <ResultPill result="DNF" size="sm" />
            </div>
          </div>
          <div>
            <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              size=md (pill · full word)
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ResultPill result="WIN" size="md" />
              <ResultPill result="LOSS" size="md" />
              <ResultPill result="OTL" size="md" />
              <ResultPill result="DNF" size="md" />
            </div>
          </div>
        </Panel>
      </section>

      {/* StatStrip --------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="StatStrip" />
        <BroadcastPanel>
          <div className="space-y-6 p-6">
            <div>
              <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Default density · with provenance
              </p>
              <StatStrip
                items={[
                  { label: 'GP', value: '22' },
                  { label: 'W', value: '14', accent: true },
                  { label: 'L', value: '6' },
                  { label: 'OTL', value: '2', dim: true },
                  { label: 'Win%', value: '70.0', accent: true },
                  { label: 'GF', value: '78' },
                  { label: 'GA', value: '52' },
                ]}
                provenance="EA official"
              />
            </div>
            <div>
              <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Tight density · no provenance
              </p>
              <StatStrip
                density="tight"
                items={[
                  { label: 'G', value: '3' },
                  { label: 'A', value: '5' },
                  { label: 'PTS', value: '8', accent: true },
                  { label: '+/-', value: '+2' },
                  { label: 'SOG', value: '12' },
                ]}
              />
            </div>
            <div>
              <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Em-dash placeholder for missing data
              </p>
              <StatStrip
                items={[
                  { label: 'FO%', value: '—', dim: true },
                  { label: 'TOA', value: '—', dim: true },
                  { label: 'BLK', value: '—', dim: true },
                ]}
                provenance="local · 6s only"
              />
            </div>
          </div>
        </BroadcastPanel>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (consumes all 5 primitives + the helper).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/_kitchen-sink/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): add kitchen-sink dev page for design-system primitives

Renders every variant of Panel, BroadcastPanel, SectionHeader,
ResultPill, and StatStrip on a single internal route at /_kitchen-sink.
Used as the visual-verification harness for Phase 1 and as a reference
when wiring primitives into Phase 2+ pages. Removed at end of Phase 6.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add kitchen-sink dev page ...` is HEAD.

---

## Task 8: Visual verification + final typecheck

Phase 1 ends when every primitive variant renders correctly in the kitchen-sink page and the full repo typechecks clean.

- [ ] **Step 1: Full-repo typecheck**

```bash
pnpm typecheck
```
Expected: 6 successful tasks across @eanhl/db, @eanhl/web, @eanhl/worker.

- [ ] **Step 2: Start dev server**

```bash
pnpm --filter web dev
```
Wait for "Ready in" line (Next picks port 3000 or next free port).

- [ ] **Step 3: Walk the kitchen-sink route**

Open `http://localhost:<port>/_kitchen-sink` in a browser and confirm:

**Panel section:**
- Three panels in a row. Default = darker fill, raised = lighter fill, hoverable = lifts on hover.
- All panels have sharp corners (no rounding) and a 1px zinc-800 border.

**BroadcastPanel section:**
- Three panels. First two have a 1px red ticker on top + soft red radial glow at top.
- `intensity=soft` glow is dimmer than default.
- `ticker=false` shows the radial glow alone, no top strip.

**SectionHeader section:**
- "LATEST RESULT" — UPPERCASE wide-tracked, dim zinc-500.
- "SCORING LEADERS" with "All stats →" CTA right-aligned, lifts to zinc-100 on hover.
- "PAGE TITLE (H1)" rendered with `as="h1"` — same look, semantic h1.

**ResultPill section:**
- sm row: four small chips — green W, rose L, amber OT, zinc —. Letter glyphs only.
- md row: four pills — green WIN, rose LOSS, amber OT LOSS, zinc DNF. Full words.
- All pills are `rounded-full` and use `font-condensed font-bold uppercase`.

**StatStrip section:**
- First strip: GP / W / L / OTL / Win% / GF / GA with EA official provenance dot. W and Win% values are rose-400 (accent); OTL value is dim zinc-500.
- Second strip: tight density, G / A / PTS / +/- / SOG. PTS is rose-400.
- Third strip: three em-dash placeholders, all dim, with "local · 6s only" provenance.

If anything renders wrong, stop and surface to the user. Otherwise stop the dev server.

- [ ] **Step 4: Format pass — only the new files**

The repo-wide `pnpm format` reformats unrelated files (Phase 0 surfaced this). For Phase 1, format only the 7 new files:

```bash
pnpm exec prettier --write \
  apps/web/src/lib/result-colors.ts \
  apps/web/src/components/ui/panel.tsx \
  apps/web/src/components/ui/broadcast-panel.tsx \
  apps/web/src/components/ui/section-header.tsx \
  apps/web/src/components/ui/result-pill.tsx \
  apps/web/src/components/ui/stat-strip.tsx \
  apps/web/src/app/_kitchen-sink/page.tsx
git status --short
```

If any of those files are reformatted (modified after the prettier run), stage them and amend each into its respective task commit OR create a single targeted style commit:

```bash
# Only if files changed after the targeted prettier run:
git add apps/web/src/lib/result-colors.ts \
        apps/web/src/components/ui/*.tsx \
        apps/web/src/app/_kitchen-sink/page.tsx
git commit -m "$(cat <<'EOF'
style(web): prettier pass on Phase 1 primitives

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If nothing changed (files were already prettier-clean from initial write), skip this step.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/design-system-renovation
```
Expected: branch is now tracked at origin so the work is recoverable.

- [ ] **Step 6: Final state check**

```bash
git status
git log --oneline main..HEAD | head -10
```
Expected: clean tree on `feat/design-system-renovation`; 7 commits ahead of `main` (one per Task 1-7, plus optional style commit from Task 8 Step 4).

---

## Recovery if something goes wrong mid-plan

- **Typecheck fails after creating a primitive:** the component file has a TS error. Read the error, fix the file, re-typecheck, then continue with the commit step. Do NOT commit a broken state.
- **Kitchen-sink render mismatch (Task 8 Step 3):** identify which primitive is wrong. Compare its file against the spec snippet in the corresponding Task. Fix the primitive file, re-typecheck, then either amend the primitive's commit (`git commit --amend`) if it hasn't been pushed, or create a follow-up `fix(web): ...` commit if it has.
- **A primitive needs an additional prop you discover during kitchen-sink review:** that's a Phase 2 concern — adding props on contact. Note the gap and surface to the user; Phase 1 ships only the 5 primitives as specified.
- **Phase 2 implementation later finds the API wrong:** Phase 2 plan adjusts the primitive API and updates the kitchen-sink page in the same commit cluster. Don't pre-emptively over-engineer the API in Phase 1.
