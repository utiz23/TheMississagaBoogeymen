# Step 4: Build Locker v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (operator's choice: Native/inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. After approval this file is saved as `docs/superpowers/plans/2026-10-07-build-locker-step-4.md`.

**Goal:** On the dev preview page `/preview/roster/[id]`, replace the old "Loadout History" strip with the Build Locker v2 design: one slim tile per build (newest first), plus a detail panel showing the selected build's 23 attributes in 5 groups, with changes against the previous build.

**Architecture:**

- A pure grouping function in the db package turns reviewed game-sheet snapshots into builds.
- A query picks the title and feeds that function.
- A pure web view model formats tiles and details on the server.
- A small client component renders them and handles tile selection.
- Live pages are not touched. The preview page swaps the old strip for the new section.

**Tech Stack:** Drizzle ORM (PostgreSQL), Next.js 15 / React 19, TypeScript strict, `node --test` (type stripping).

**Spec:** `docs/superpowers/specs/2026-10-07-player-cards-badges-design.md`, Part 4 and Test run. Design: `docs/design/handoffs/2026-10-cards/Build Locker v2.dc.html`.

## Context

The spec's Part 4 says the Build Locker replaces `LoadoutHistoryStrip`. That strip shows the last 4 raw snapshots and labels them with a hard-coded "NHL 27".

A check of the preview data (`eanhl_preview`) changed two assumptions:

- **All 40 reviewed snapshots are NHL 26.** The page shows NHL 27, so scoping strictly to the page's title would hide the section for everyone.
- **Game-sheet reading is not exact.** Two examples:
  - Stick Menace's single build has weight 220 on one sheet and blank on another.
  - Henry's two Puck-Moving-D sheets differ by ±1–3 on ten attributes, and Faceoffs reads 92 on one and 26 on the other.

  The spec says to stop and ask in this case. I asked, and the operator decided the two points below.

**Operator decisions (this session):**

1. **Title: newest title with builds.** The section uses the title of the player's most recently played reviewed sheet (NHL 26 today) and shows that title's real name in the header. It switches to NHL 27 by itself once NHL 27 sheets are reviewed.
2. **Build = archetype + X-factors.** A new build starts only when the archetype or the set of 3 X-factors changes.
   - A sheet missing either one still joins the current build.
   - Values come from the build's newest sheet; blanks are filled from its older sheets.
   - Attribute differences never split a build.

**Other deviations, listed for the operator at the review:**

- **GP and W–L–OTL count only games with a reviewed game sheet.** The subtitle says "from game sheets", as in the design.
- **"Two-Way Defenseman" isn't in the site's 11-archetype list** (`buildClassToArchetype` in `apps/web/src/lib/match-recap.ts`, a live file). Such builds get a neutral pill showing the name's initials ("TWD"). Adding the mapping is a live-file change for the switch.
- **Hand is blank in all current data**, so it shows "—".
- **`deking` is blank on every reviewed sheet** and shows "—" with no bar.
- **Dates use America/Edmonton**, as in the locker.
- **Builds are computed when the page loads**, not precomputed. Each player has at most a few dozen sheets, and the old strip worked the same way.

## Global Constraints

- **Test run:** all work on `feat/player-cards`. Only the preview route changes; it `notFound()`s in production. **Live components and pages are not modified.** At the switch, the Build Locker replaces `LoadoutHistoryStrip` at `apps/web/src/app/roster/[id]/page.tsx:245`.
- **Snapshot gating, unchanged:** only `review_status = 'reviewed'`, `is_cpu = false`, with a `match_id`.
- Snapshots are ordered by `matches.played_at`, not `captured_at`. **If a match has several snapshots, the latest captured one wins.**
- **DNF counts as a loss**, as on the rest of the site.
- **Δ is measured against the next-older build. The oldest build has no Δ.** Defaults: `count=4`, deltas on, first tile open.
- **Hidden** when the player has no builds.
- **Design tokens:**
  - The site defines `--color-fg-1…6`, `--color-surface`, `--color-surface-raised`, `--color-background`, `--color-border`, `--color-border-subtle`, `--color-charcoal`, `--color-accent`, `--color-accent-line`, `--color-win` and `--color-loss`.
  - The design's `--inset-leader-rail` and `--bg-ticker-red` don't exist here. Use `inset 2px 0 0 var(--color-accent)` and `var(--color-accent)` instead.
- **X-factor tier colours** (design `TIER`): Elite `#e84131`, All Star `#3AB7FF`, Specialist `#f59e0b`, unknown → `var(--color-border)`.
- **Gates:**
  - typecheck (db, worker, web), db tests, web unit tests and prettier stay green;
  - eslint runs only on the touched files;
  - never run `next build` while the dev server (task `b4k2451xl`, `eanhl_preview`) runs.

## Review Focus

1. **A player with no reviewed sheets** (#28 Utiz23): the section renders nothing, with no empty panel. Pinned by the query smoke check (Task 2) and the browser check (Task 4).
2. **A player with one build** (#12 Pratt2016): one tile, no Δ, an empty note. Pinned by the `single build has no delta` test (Task 3).
3. **Missing height, weight, hand or tier:** shows "—" or a neutral border, never "null lb" or "undefined". Pinned by the `blanks render as dashes` test (Task 3).
4. **An attribute blank on every sheet** (`deking`): "—", no bar, left out of the group average, no Δ. Pinned by the `null attribute` test (Task 3).
5. **Phone width (390 px):** tiles scroll sideways inside the panel with no page-level sideways scroll, and the detail groups stack. Pinned by the 390 px browser check (Task 4).

## File Structure

| File                                                                                 | Responsibility                                                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/db/src/loadouts/build-runs.ts` (new) + `.test.ts`                          | Pure: sheets → builds (one sheet per match, identity, fill-down, record).               |
| `packages/db/src/queries/player-loadouts.ts` (modify)                                | `getPlayerBuilds(playerId, limit = 4)`: picks the title, loads the sheets, groups them. |
| `apps/web/src/components/roster/build-locker-model.ts` (new) + `.test.ts`            | Pure: builds → tile and detail strings, deltas, bars.                                   |
| `apps/web/src/components/roster/build-locker.tsx` (new, client) + `build-locker.css` | Renders the design and handles tile selection.                                          |
| `apps/web/src/app/preview/roster/[id]/page.tsx` (modify)                             | Swaps `LoadoutHistoryStrip` for `BuildLocker` on the preview page only.                 |

---

### Task 1: Group game sheets into builds (pure, TDD)

**Produces:**

```ts
export interface LoadoutSheet {
  snapshotId: number
  matchId: number
  playedAt: Date
  capturedAt: Date
  result: MatchResult
  archetype: string | null // build_class_canonical ?? build_class
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  xFactors: { name: string; tier: XFactorTier | null }[] // slot order; name = canonical ?? raw
  attributes: Record<string, number | null>
}
export interface PlayerBuild {
  archetype: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  xFactors: { name: string; tier: XFactorTier | null }[]
  attributes: Record<string, number | null>
  gp: number
  wins: number
  losses: number
  otl: number // DNF → losses
  firstPlayed: Date
  lastPlayed: Date
}
export function groupBuilds(sheets: readonly LoadoutSheet[]): PlayerBuild[] // newest build first
```

**Rules** (in this order):

1. Drop empty sheets: no archetype and no X-factors.
2. Keep one sheet per match: the latest `capturedAt` (ties go to the higher `snapshotId`).
3. Sort by `playedAt`, oldest first (ties by `matchId`).
4. Walk the sheets.
   - **Identity key** = archetype + the **sorted** X-factor names.
   - A sheet joins the current build when, for both archetype and the X-factor set, either side is unknown or the two are equal. Otherwise it starts a new build.
   - A build that started with an unknown part takes it from the first sheet that knows it.
5. **Per build:**
   - Each field comes from the newest sheet that has it. This covers height, weight, hand, each attribute key, the X-factor list (newest sheet with any) and each X-factor tier (matched by name).
   - `gp` = number of sheets (one per match). W / L+DNF / OTL counted from `result`.
   - First and last played dates.
6. Return the builds newest first.

**Tests** (`packages/db/src/loadouts/build-runs.test.ts`, with fixtures copied from the preview data):

- **One sheet per match:** the latest captured wins, and an empty later sheet doesn't hide a full one.
- **Stick Menace:** sheets 9405 (wt 220) and 9252 (wt blank), plus the empty 9171. Result: 1 build, GP 2, wt 220, record 2–0–0.
- **Henry:**
  - two Puck-Moving-D sheets (Faceoffs 92 then 26) give 1 build with Faceoffs 26 (newest);
  - then a Sniper sheet gives a 2nd build;
  - the result is `[Sniper, PMD]`, newest first.
- **The same X-factors in a different slot order** stay one build.
- **A sheet with a blank tier** takes the tier from an older sheet of the same build.
- **Record:** WIN, LOSS, DNF, OTL gives `1–2–1`.
- **No sheets** gives `[]`.

**Steps:**

1. Write the tests.
2. Run them and watch them fail: `pnpm --filter @eanhl/db build && node --test packages/db/dist/loadouts/build-runs.test.js`.
3. Implement.
4. Watch them pass.
5. Run `pnpm --filter @eanhl/db test`, typecheck, and eslint/prettier on the two files.
6. Commit: `feat(db): group loadout game sheets into builds`.

### Task 2: `getPlayerBuilds` query

**Produces:**

```ts
getPlayerBuilds(playerId: number, limit = 4): Promise<PlayerBuilds | null>
interface PlayerBuilds { gameTitleId: number; gameTitleName: string; builds: PlayerBuild[]; older: PlayerBuild | null }
```

Re-export `PlayerBuild` / `PlayerBuilds` types from `queries/index.ts`.

**What it does:**

1. **Title:** select `game_title_id` from the player's gated snapshots joined to `matches`, ordered by `matches.played_at DESC`, limit 1. No row returns `null`.
2. **Sheets:** load all gated snapshots for that player and title, joined to `matches` (`played_at`, `result`) and `game_titles.name`. Load their X-factors and attributes with the existing `IN (…)` pattern from `getPlayerLoadoutSnapshots`, and map them to `LoadoutSheet`.
3. **Group:**
   - `groupBuilds(sheets)`;
   - `builds` = first `limit`;
   - `older` = the next one (gives the Δ for the oldest shown build) or `null`.

Use the Drizzle builder with qualified columns. No correlated `sql` subqueries (memory: unqualified-column trap).

**Smoke check** on `eanhl_preview`:

- Command: `node --input-type=module -e "…import { getPlayerBuilds } from '@eanhl/db/queries'…"`, run from `apps/worker` with the preview `DATABASE_URL` guard used in step 3.
- Players: #3, #1, #2, #12 and #28.
- Expected:
  - #3: 1 build (Power Forward, GP 2, wt 220), title "NHL 26".
  - #1: 2 builds, Sniper current.
  - #2: 3 builds (Grinder, Power Forward, Sniper with GP 2).
  - #12: 1 build.
  - #28: `null`.

Commit: `feat(db): getPlayerBuilds — builds from reviewed game sheets`.

### Task 3: Build Locker view model (pure, TDD)

**File:** `apps/web/src/components/roster/build-locker-model.ts`. It uses type-only imports from `@eanhl/db/queries`, so it runs under `node --test`.

**Produces:**

- `BUILD_ATTRIBUTE_GROUPS`: the 5 groups and 23 `{ key, label }`. Keys come from the old strip's `ATTRIBUTE_GROUPS`; labels from the design ("Wrist Shot Acc", "Off. Awareness", "Hand-Eye", …).
- `buildLockerView(data: PlayerBuilds, timeZone = 'America/Edmonton'): BuildLockerView`, where `BuildLockerView = { titleName, count, tiles, details }`.

**Tile fields:**

- `archetypeRaw` (for the client's `buildClassToArchetype`);
- `arcName`: the part after " - ", e.g. "Cole Caufield - Sniper" gives "Sniper";
- `arcInitials`: the fallback pill, e.g. "TWD";
- `tag`: "Current" for index 0, else the last-played date, e.g. "Oct 4";
- `current`;
- `xf[]`: `{ abbr, title, tier }`. `abbr` is the initials of the words (underscores become spaces), at most 2, per the design: "Quick Release" gives "QR". `title` is "Quick Release — Elite", or "— tier unknown";
- `htwt`: `6'6" · 220 lb`, dropping missing parts, "—" if both are missing;
- `hand`: "Right"/"Left" from "SHOOTS RIGHT"/"R" and so on, else "—";
- `gp` and `record` (`4–2–0`, en dashes).

**Detail fields** (one per tile, prebuilt):

- `name`;
- `meta`: "Current · 6 GP · 4–2–0" or "Last used Sep 28 · …";
- `note`: "Δ vs previous build", or "" when there is no previous build;
- `groups[]`:
  - `{ name, avg ('—' if none), dTxt, dSign }` per group;
  - `attrs[] { label, v ('—' if null), dTxt, dSign, baseW, segL, segW }` per attribute.

**Previous build** for tile _i_ = `builds[i+1]`; for the last tile it is `older`.

**Δ and bar rules:**

- Δ needs both values. `dTxt` is "+3" / "-2" / "" (as in the design's `dTxt`).
- The group average is the rounded mean of the known values. The group Δ is the difference of the rounded averages.
- Bars (design):
  - `d > 0`: base `v−d`, then a green segment of `d` from there;
  - `d < 0`: base `v`, then a red segment of `|d|`;
  - all clamped to 0–100;
  - a null value has no bar.

**Tests:**

- Stick Menace single build: "Current", GP 2, `220 lb`, no Δ, note "".
- Henry: tile 0 Sniper "Current", tile 1 PMD tag = its last-played date in Edmonton. Tile 0 deltas against PMD, e.g. the Faceoffs Δ sign and bar segments.
- The `older` build supplies the Δ for the last tile.
- **Blanks render as dashes:** missing height and weight give "—", hand gives "—", an unknown tier gives `tier: null` and the "tier unknown" title.
- **Null attribute** (`deking`): "—", no bar, left out of the group average, no Δ.
- **Single build has no delta.**
- Record formatting.
- X-factor abbreviations: "Quick_Release" gives "QR", "PressurePlus" gives "P".
- `arcName` and `arcInitials` for "Two-Way Defenseman" give "Two-Way Defenseman" and "TWD".

**Steps:** tests first, run them and watch them fail (`pnpm --filter @eanhl/db build && node --test apps/web/src/components/roster/build-locker-model.test.ts`), implement, watch them pass, run the gates, commit `feat(web): build locker view model`.

### Task 4: Build Locker UI on the preview page

**`build-locker.tsx`** (`'use client'`) takes `{ view: BuildLockerView }`. State `sel` starts at 0 (first tile open); clicking a tile toggles it, as in the design's `select`. Layout, per the design:

- **Header:** "▰ Build Locker", "Last {count} builds · newest first · from game sheets", and the title name on the right.
- **Panel:** a grid row of tile `<button aria-pressed>` elements (`grid-auto-flow: column; grid-auto-columns: minmax(200px, 1fr); overflow-x: auto`). Each tile has:
  - the current build's 2px top strip;
  - the archetype pill: `ArchetypePillCompact` when `buildClassToArchetype(archetypeRaw)` maps, else a neutral initials pill;
  - the tag, the name, the 3 X-factor boxes (40×40, border by `data-tier`), Ht/Wt, Hand, GP and record.
- **Detail panel** (when a tile is selected): the left accent rail, name/meta/note, then the 5 group cards (`repeat(auto-fit, minmax(180px, 1fr))`) with average, Δ and per-attribute rows with bars.

**`build-locker.css`:** `.bl-*` classes using the site tokens above; selected tile: `--color-surface-raised`, `--color-accent-line` border and the inset rail.

**Preview page:**

- Replace the `getPlayerLoadoutSnapshots(id, 4)` fetch with `getPlayerBuilds(id)`, in a try/catch that yields `null`.
- Render `{builds && <BuildLocker view={buildLockerView(builds)} />}` where `LoadoutHistoryStrip` was.
- The live `/roster/[id]` page and `LoadoutHistoryStrip` stay as they are.

**Gates:** typecheck, isolated eslint, prettier.

**Browser checks** (Playwright, dev server on `eanhl_preview`):

1. `/preview/roster/3?gallery=0` at 1280:
   - 1 tile "Current", Power Forward pill, Big Rig / One T / Ankle Breaker in Elite red, GP 2, `2–0–0`;
   - the detail is open with 5 groups, Deking "—", no Δ note;
   - header "NHL 26". Screenshot and compare with the design.
2. `/preview/roster/2?gallery=0`: 3 tiles. Clicking tile 2 swaps the detail. Clicking the selected tile closes it. Δ colours are green/red with bar segments.
3. `/preview/roster/5?gallery=0`: the Two-Way Defenseman tile shows the "TWD" neutral pill.
4. `/preview/roster/28?gallery=0`: no Build Locker section in the DOM.
5. 390×844 on #2: `scrollWidth <= 390`, the tile row scrolls inside the panel, the groups stack in one column. Screenshot.
6. Keyboard: Tab reaches the tiles, Enter/Space toggles, `aria-pressed` follows.
7. Console: nothing new (the ContributionWheel warning is pre-existing).
8. `git diff --stat` over live roster/home code is empty.

Commit: `feat(web): Build Locker v2 on the player preview page`.

### Task 5: Review and records

1. Run the full gates.
2. A fresh reviewer (opus) reviews the step-4 range against the spec, this plan and the design. Re-grade the findings by their effect; fix Critical and Important ones (TDD or a browser reproduction first); ledger the minors.
3. Append the execution record to the plan, and update HANDOFF/journal (handoff-update skill). That update also corrects HANDOFF/journal: the branch was pushed to GitHub on 2026-10-07.
4. Report to the operator: the links, the deviations above, the deferred minors, and the next choice (the Action Map, step 5).

## Verification (end to end)

- `pnpm --filter @eanhl/db test` (includes build-runs), `pnpm --filter web test:unit` (includes build-locker-model), and typecheck for db, worker and web.
- Query smoke on `eanhl_preview` (Task 2 expectations). Cross-check one build's GP and record against `matches` with a read-only psql query.
- Playwright checks from Task 4 at 1280 and 390 px.
- `/roster/3` (live page code) still renders the old strip: no live file changed.
