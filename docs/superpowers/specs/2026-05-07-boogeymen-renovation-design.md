# Boogeymen Design System Renovation — Design Spec

**Goal:** Bring the entire `apps/web` frontend into alignment with the Boogeymen Design System (`docs/design/boogeymen-system/`). Apply cross-cutting design rules (voice, typography, color, spacing, broadcast-panel decoration) on every public route. Adopt IA changes selectively — only on `roster/[id]` (already in flight) and `home`. Keep games and stats as restyle-only.

**Architecture:** Bottom-up renovation. Extract a small set of shared UI primitives in a new `apps/web/src/components/ui/` directory. Rebuild pages in priority order using those primitives. The staged design system (README + 23 preview HTMLs + `colors_and_type.css`) is authoritative; staged source files are implementation reference only.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind CSS 4, server components by default, no new dependencies. Existing `apps/web/src/app/globals.css` already mirrors the design system's CSS variables 1:1, so tokens are not changing.

**Out of Scope:**
- Goalie-side IA parity (deferred — separate plan).
- New routes or new features (no head-to-head, no opponent stats, no season comparison).
- Shot map redesign (recently shipped — reframed in a `<BroadcastPanel>` only).
- Backend/data changes beyond the in-flight `0022_mature_paladin` migration.
- News-personalities and player-dossier feature implementations (specs exist; out of this renovation).
- Mobile-first redesign, light mode, print styles, RTL, i18n.
- Formal a11y audit and Lighthouse perf budget tracking.

---

## Decisions Locked

| # | Decision | Choice |
|---|---|---|
| 1 | Renovation depth | Hybrid — cross-cutting style everywhere; IA changes only on `roster/[id]` and `home` |
| 2 | Branch strategy | Commit + merge in-flight `feat/skater-stats-expansion` to `main` first; renovation lives on a fresh `feat/design-system-renovation` branch |
| 3 | Source treatment | Spec-driven rebuild — README + previews are authoritative; staged source is reference, not destination |
| 4 | Sequencing | Bottom-up — primitives first, then pages |
| 5 | Approach | B (Lean primitives + targeted IA) — extract only primitives that ≥3 pages clearly need; defer additional extractions |

---

## Phase Plan

### Phase 0 — Land in-flight work (`main` branch)
Land the existing `feat/skater-stats-expansion` work as focused commits and merge to `main`. The branch already contains design-aligned profile work that is coherent on its own; landing it keeps the renovation branch from carrying unrelated diff.

**Scope of Phase 0 commits (rough grouping):**
- `feat(db): 0022 player profile fields + new migration` (schema + journal + migration SQL)
- `feat(web): player meta icons + roster profile-hero polish` (`player-meta-icons.tsx`, profile-hero, branding SVGs)
- `feat(web): jersey number on home carousel + depth-chart` (already partly committed; collect remaining bits)
- `feat(web): position pill + position donut updates` (matches/position-pill, roster/position-donut)
- `feat(web): charts visuals section structure` (charts-visuals-section, shot-map-zones tweaks)
- `chore(web): app icon swap` (delete `icon.tsx`, add `icon.png`)
- `docs(spec): position colors note` (position-colors.md update)
- `docs(plans): profile page restructure plan + dossier specs + player-profile-template` (docs only)

**Phase 0 ends when:** `main` is clean, typecheck passes, dev server walks every route, in-flight tree is empty.

**Branch:** `feat/design-system-renovation` is then created from clean `main`.

### Phase 1 — Lean primitives layer
Extract 5 shared UI primitives into `apps/web/src/components/ui/`:

1. **`<Panel>`** — sharp 1px border surface (`tone="default" | "raised"`, optional `hoverable`)
2. **`<BroadcastPanel>`** — Panel + 1px red gradient strip on top + soft radial glow (`intensity="default" | "soft"`)
3. **`<SectionHeader>`** — UPPERCASE wide-tracking label + optional CTA arrow
4. **`<ResultPill>`** — W/L/OTL/DNF letter chip backed by a `getResultStyle(result)` helper in `apps/web/src/lib/result-colors.ts`
5. **`<StatStrip>`** — label/value pair layout with optional provenance row

Each primitive ≤80 lines, server component, fully styled by props. Each gets a test only if it has logic worth testing (`ResultPill` color mapping, `StatStrip` optional fields).

A temporary kitchen-sink dev page at `apps/web/src/app/_kitchen-sink/page.tsx` renders every primitive variant for visual review. Removed at end of Phase 6.

**Phase 1 ends when:** primitives render correctly in kitchen-sink, no consumer pages have been touched yet, typecheck clean.

### Phase 2 — Home (`/`) — IA touch + restyle
Reorder per design-system bundle:
1. **LATEST RESULT** — broadcast-hero scoreboard
2. **SCORING LEADERS** — hero #1 + 4-row pattern across both Goals and Points
3. **RECORD STRIP** — W/L/OTL · Win% · GP, with provenance tag
4. **SEASON RANK** — existing widget restyled
5. **SCROLLER** — recent results carousel (existing, restyled card)

Apply UPPERCASE labels, tabular numerals, sharp `rounded-none` panels, broadcast-panel decoration on hero + leaders.

### Phase 3 — Roster profile (`/roster/[id]`) — IA reconcile + voice audit
The in-flight 2026-05-05 restructure is already structurally aligned. Phase 3 is reconciliation:
- Confirm AKA placement matches spec
- Add provenance tags on every stat strip
- Replace inline result pills with `<ResultPill>`
- Apply `<StatStrip>` and `<SectionHeader>` primitives throughout
- Voice audit: every label UPPERCASE, en-dash for splits, em-dash for missing data
- Tighten spacing rhythm to bundle (`px-5 py-3` rows / `px-8 py-10` hero)

No structural rework expected. If reconciliation surfaces real IA gaps, flag and discuss before changing structure.

### Phase 4 — Games (`/games` + `/games/[id]`) — restyle only
**`/games` (list):** Each row becomes `<Panel hoverable>` with date · BGM crest + score · `<ResultPill>` · opponent crest + abbrev · provenance. Filter pills (`All / 6s / 3s`) get the design-system pill treatment (transparent border → `border-accent bg-accent/10 text-accent` on active). Page header `text-2xl semibold uppercase tracking-widest`.

**`/games/[id]` (detail):** Hero scoreboard becomes `<BroadcastPanel>` with the 3-column us/score/them grid. Score numbers → 5.75rem black tabular condensed. Per-player tables get UPPERCASE column headers, tabular nums, hairline dividers (`divide-zinc-800/60`). Top performers strip uses the leaders pattern.

If detail page proves heavy, split into 4a (scoreboard hero) + 4b (player tables).

### Phase 5 — Roster list (`/roster`) + Stats (`/stats`) — restyle only
**`/roster`:** Cards become `<Panel hoverable>`. Jersey number in red accent, name in condensed black uppercase, position pill via `<ResultPill>`-style mapping (already done in flight). `<SectionHeader>` on top.

**`/stats`:** Tables get the same UPPERCASE/tabular treatment as games-detail. Team shot map kept structurally; reframed in `<BroadcastPanel>` with `<SectionHeader>`. No layout changes to the shot map itself.

### Phase 6 — Cross-cutting cleanup
**Top nav:** `bg-surface/95 backdrop-blur-sm` (only blur in the system), `border-b border-accent/15` (brand fingerprint), active link gets 2-px accent under-bar, links UPPERCASE condensed tracking-widest. Game-title switcher → segmented pill treatment.

**Voice/casing audit grep:**
```bash
rg -n '"(record|leaders?|standings?|stats|games?|roster)"' apps/web/src
```
Fix any remaining sentence-case labels found.

**Kitchen-sink page removed.** Dev-server walkthrough on every route end-to-end. Final typecheck + format pass.

---

## Verification

**Every phase:**
- `pnpm --filter @eanhl/db build` (if any DB query touched)
- `pnpm typecheck` from repo root
- `pnpm format` (write)
- `pnpm --filter web dev` — visit changed routes + adjacent routes; no console errors

**Phase 1:** Kitchen-sink page eyeball check against `docs/design/boogeymen-system/preview/*.html` mockups.

**Phases 2-5:** For each rebuilt page:
1. Visit at `localhost:3000`
2. Compare against bundle preview HTML and source rewrite
3. Click every interactive element (filter pills, tabs, nav, hover states)
4. No broken images, no `undefined` text leaking, no missing data shape
5. Mobile viewport sanity check

**Phase 6:** End-to-end walkthrough; voice/casing grep audit; typecheck + format.

**Commit boundaries:** Each phase = one focused commit (or small commit cluster — Phase 1 may be 5 commits, one per primitive). Conventional `feat(web): …` / `style(web): …` per CLAUDE.md. No "WIP"/"checkpoint" commits.

**Not verified:**
- Automated visual regression (no Storybook/Chromatic infra)
- Cross-browser parity (modern browsers assumed)
- Lighthouse/perf budgets (renovation is roughly perf-neutral)

---

## Risks

1. **Phase 1 has no visible page change.** Two-three commits of pure infrastructure before anything renders differently. Easy to lose momentum mid-phase. Mitigation: kitchen-sink page provides visible artifact.
2. **Roster profile reconciliation (Phase 3) is least defined.** "Voice audit" is fuzzy until we sit on the page; could surface more rework than expected. Mitigation: timebox; if rework grows, split off as Phase 3b.
3. **Games detail page (Phase 4) is the heaviest restyle.** Tables + scoreboard + per-player breakdown all touched at once. Mitigation: pre-split into 4a + 4b at plan time if needed.
4. **Phase 0 commits could include unrelated dirty work.** The current branch has 13 modified files spanning multiple concerns. Mitigation: run `git status --short` before each Phase 0 commit and verify the staged set matches the commit's stated scope.

---

## Deferred Design Decisions (before final ship)

Items the user wants reconsidered before the renovation is declared done. Address in Phase 6 (cross-cutting cleanup) or a Phase 7 polish pass.

1. **Restore result-based card glows on ScoreCard + HeroCard.** Phase 4 dropped the result-based card-background tinting (emerald glow for WIN, rose for LOSS, amber for OTL, etc.) per the design-system literal "cards are flat panels with hairline borders, never softly rounded with drop shadows." The user prefers the glows visually and wants them back. Options to consider:
   - Add a `tone="resultGlow"` variant to `<Panel>` that takes a `MatchResult` and applies the emerald/rose/amber gradient as a top-radial overlay (composes with sharp borders — keeps the design-system "no soft cards" rule for shape, restores the tinting only as a coloring layer).
   - Or add a `<ResultGlow>` decorator component that wraps a `<Panel>` and applies the radial gradient via a positioned absolute child.
   - Decide: glows on both ScoreCard (list cards) AND HeroCard (detail hero), or just one.
2. **`<ResultPill>` final-version labels — full words instead of letter glyphs at sm.** Current Phase 1 implementation uses letter glyphs at `size="sm"` (W / L / OT / —) per the design-system spec ("at the scoreboard density the system runs at, letters scan faster than pictograms"). User wants full words ("WIN" / "LOSS" / "OT LOSS" / "DNF") on every ResultPill, not just `size="md"`. Options:
   - Drop the `sm` variant entirely; standardize on full-word pills with size variants only changing height/padding.
   - Add a `glyph={true}` opt-in for the rare scoreboard-density places that genuinely need single letters.
   - Verify against spacing constraints (game log table, recent-form strip, footer) — full words may need wider columns.

Both items are out of Phase 4 scope by user direction. Track here so they don't slip; surface during Phase 6 planning.

---

## File Touch Map

**New files (Phase 1):**
- `apps/web/src/components/ui/panel.tsx`
- `apps/web/src/components/ui/broadcast-panel.tsx`
- `apps/web/src/components/ui/section-header.tsx`
- `apps/web/src/components/ui/result-pill.tsx`
- `apps/web/src/components/ui/stat-strip.tsx`
- `apps/web/src/lib/result-colors.ts` (color mapping helper)
- `apps/web/src/app/_kitchen-sink/page.tsx` (temporary, removed in Phase 6)

**Files modified by phase:**
- Phase 2 (Home): `apps/web/src/app/page.tsx`, `apps/web/src/components/home/*`
- Phase 3 (Roster profile): `apps/web/src/app/roster/[id]/page.tsx`, `apps/web/src/components/roster/{profile-hero,recent-form-strip,stats-record-card,club-stats-tabs,charts-visuals-section}.tsx`
- Phase 4a (Games list): `apps/web/src/app/games/page.tsx`, `apps/web/src/components/matches/match-row.tsx`
- Phase 4b (Games detail): `apps/web/src/app/games/[id]/page.tsx`, `apps/web/src/components/matches/{score-card,hero-card,top-performers}.tsx`
- Phase 5 (Roster list + Stats): `apps/web/src/app/roster/page.tsx`, `apps/web/src/app/stats/page.tsx`
- Phase 6 (Nav/chrome): `apps/web/src/components/nav/{top-nav,nav-links,game-title-switcher}.tsx`, `apps/web/src/app/layout.tsx`

---

## Decomposition into Implementation Plans

This spec describes the **whole renovation arc** but is too large to execute as a single implementation plan. Each phase becomes its own implementation plan via the `writing-plans` skill, executed sequentially:

| Implementation plan | Covers | Branch |
|---|---|---|
| `2026-05-XX-renovation-phase-0-land-in-flight.md` | Phase 0 (commit + merge in-flight) | `feat/skater-stats-expansion` → `main` |
| `2026-05-XX-renovation-phase-1-primitives.md` | Phase 1 (5 primitives + kitchen-sink) | `feat/design-system-renovation` |
| `2026-05-XX-renovation-phase-2-home.md` | Phase 2 (home IA + restyle) | `feat/design-system-renovation` |
| `2026-05-XX-renovation-phase-3-roster-profile.md` | Phase 3 (roster reconcile + voice audit) | `feat/design-system-renovation` |
| `2026-05-XX-renovation-phase-4-games.md` | Phase 4a + 4b (games list + detail) | `feat/design-system-renovation` |
| `2026-05-XX-renovation-phase-5-roster-stats.md` | Phase 5 (roster list + stats restyle) | `feat/design-system-renovation` |
| `2026-05-XX-renovation-phase-6-cleanup.md` | Phase 6 (nav + voice audit + kitchen-sink removal) | `feat/design-system-renovation` |

After each phase ships, decide whether to merge `feat/design-system-renovation` to `main` immediately or batch multiple phases per merge. Default: merge after Phase 2 (first user-visible win) and again at the end of Phase 6. Phases 3-5 ride along on the same branch.

The next concrete action after this spec is approved: brainstorm + plan **Phase 0** (the in-flight commit/merge work), then execute it.

---

## Reference Material

- **Spec source of truth:** `docs/design/boogeymen-system/README.md`
- **Visual previews:** `docs/design/boogeymen-system/preview/*.html` (23 files)
- **CSS variables (already in `globals.css`):** `docs/design/boogeymen-system/colors_and_type.css`
- **In-flight roster plan (already partially implemented):** `docs/superpowers/plans/2026-05-05-profile-page-restructure.md`
- **Implementation reference (use, don't lift):** `docs/design/boogeymen-system/apps/web/src/...` and `docs/design/boogeymen-system/ui_kits/stats-site/`
