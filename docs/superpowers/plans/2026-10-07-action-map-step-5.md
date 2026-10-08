# Step 5: Career Action Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (operator's choice: Native/inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the dev preview page `/preview/roster/[id]`, replace the "Career Shot Map" with the Career Action Map design. It shows every reviewed event the player made (By) or received (On), plotted on one rink with every period turned so BGM attacks right, plus filters, pinning and a grouped event list.

**Architecture:**

- A pure direction helper in the db package decides, per (match, period), which way BGM attacked, and rotates positions.
- A query loads the player's events with match context and normalises them.
- A pure web view model builds the filter counts, markers and list groups.
- A client component renders the design.
- Live pages are not touched.

**Tech Stack:** Drizzle ORM (PostgreSQL), Next.js 15 / React 19, TypeScript strict, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-07-player-cards-badges-design.md` Part 5 and Test run. Design: `docs/design/handoffs/2026-10-cards/Player Action Map.dc.html`.

## Context

The live `CareerShotMap` (`apps/web/src/components/roster/career-shot-map.tsx`) plots raw positions:

- only events the player made;
- no direction normalisation, so a shot taken while attacking left lands on the wrong end;
- small coloured dots, and a type filter only.

**Preview data (`eanhl_preview`):**

- 2,442 reviewed events in 26 matches, all from game-sheet OCR. 1,714 have a position.
- Event counts by player: silkyjoker85 738 (464 By / 274 On); Stick Menace 356; JoeyFlopfish 193; Pratt2016 (goalie) 49.
- Direction evidence: all 60 periods with ≥ 3 positioned BGM shots/goals clear the 80% one-side bar. Match 250's three recorded directions (P2 right, P3 left, P4 right) agree with the shot-side rule. Match 250 P1 has no positioned BGM shots, so it is unknown.
- 101 reviewed events have no actor and no target. They never reach this map, because it needs the player as actor or target.

**Reused, not rebuilt** (all already used by the per-match tracker):

- `RinkSvg` (`components/branding/rink.tsx`, viewBox 2405×1025);
- `GoalMarker`, `ShotMarker`, `HitMarker`, `PenaltyMarker` (`components/branding/event-markers.tsx`). Use the `side="home"` three-layer treatment with `homeColor` = accent, `ink` = `#fff` for By, and `homeColor` = `#81878D`, `ink` = `#1A1819` for On. These are exactly the design's fills;
- the hockey→viewBox mapping from `components/matches/action-tracker/rink.tsx` (`1202.5 + x·12`, `512.5 − y·12`, clamped to ±100 / ±42.5);
- `computeMarkerOffsets` (`lib/marker-layout.ts`);
- `clockToSeconds` (`action-tracker/shared.ts`).

**Spec vs design vs live, for the operator's review:**

1. **Positioned faceoffs stay listed, not plotted.** The spec says faceoffs that carry a position are plotted. But the design and the live per-match tracker draw no faceoff marker (there is no faceoff glyph), and only 19 of 561 reviewed faceoffs have a position.
2. **Goals and shots the player receives** (the goalie case) read "Goal against" and "Shot against". The design only names hits ("Hit taken"), faceoffs ("Faceoff won/lost") and penalties ("Penalty drawn · …").
3. **Overtime:** the OT period segment covers every period ≥ 4. List and pin labels show OT, OT2, OT3 (EASHL has no shootout).
4. **Marker size** is the design's default of 56 viewBox units, smaller than the per-match tracker's 80–112, because career maps are denser. Pinned markers are ×1.5.
5. **Footer:** the design's "Sheet BGM/ATM/0010" flavour line is dropped. The source line is kept.
6. **Dates** use America/Edmonton, as in the locker and the Build Locker.
7. **`career-shot-map.tsx` is deleted at the switch**, not now, because the live page still uses it.

## Global Constraints

- **Test run:** only the preview route changes; it `notFound()`s in production. Live components and pages are not modified. At the switch this replaces `CareerShotMap` (`apps/web/src/app/roster/[id]/page.tsx:247`); the EA zone `ShotMap` stays.
- **Rows:** events where the player is the actor (By) or the target (On), including events with no position. Reviewed only (`review_status = 'reviewed'`, as `getPlayerCareerShots`).
- **Each row carries:**
  - actor and target names;
  - the penalty infraction (`match_penalty_events`);
  - opponent abbreviation (`opp_team_abbr`, else `opponent_name`), mode, result and score;
  - `period_number` (never `period_label`), clock, and position confidence.
- **Cap:** newest 1,000 events.
- **Direction, per (match, period):**
  1. `match_period_summaries.bgm_attack_direction` when set.
  2. Otherwise, if ≥ 3 positioned BGM (`team_side='for'`) shots/goals in that period and ≥ 80% of them on one side of centre, BGM attacks that side.
  3. Otherwise unknown: the period's events are **listed but not plotted**.
  - "Left" periods are **rotated 180° (x → −x, y → −y)**, not mirrored.
- **Header:** "N reviewed games" = distinct matches in the result.
- **Kept from the live map:**
  - extrapolated positions dimmed;
  - overlapping markers spread with `lib/marker-layout.ts`;
  - the section hidden when the player has < 5 positioned events.
- **Filter counts:** the counts for each filter ignore that filter's own selection.
- **Gates:** typecheck (db, worker, web), db tests, web unit tests and prettier green; eslint per file; never run `next build` while the dev server (`b4k2451xl`) runs.

## Review Focus

1. **A period whose direction is unknown** (match 250 P1): its events appear in the list with the dashed "no position" glyph, count toward "N not plotted", and never draw a marker. Pinned by the direction test (Task 1) and the model's `notPlotted` test (Task 3).
2. **A goalie** (#12 Pratt2016, mostly On): the On markers are grey with dark glyphs, the labels are "Shot against" / "Goal against", and By/On counts are right. Pinned by a model label test (Task 3) and the browser check (Task 4).
3. **Filters narrowed to nothing:** "No events match these filters.", 0 markers, no crash. A pinned event that gets filtered out drops the pin bar. Pinned by the model tests (Task 3).
4. **Phone (390 px):** the rink and the list stack, no page-level sideways scroll, the filter bar wraps, the list scrolls inside a fixed height. Pinned by the 390 px browser check (Task 4).
5. **A player with < 5 positioned events** (e.g. a new member): no section at all. Pinned by the browser check on #28 (Task 4) and a model test (Task 3).

## File Structure

| File                                                                                           | Responsibility                                                              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/db/src/action-map/directions.ts` (new) + `.test.ts`                                  | Pure: period direction from recorded/shot-side evidence; rotate a position. |
| `packages/db/src/queries/match-events.ts` (modify)                                             | `getPlayerCareerActions(playerId, limit = 1000)`.                           |
| `apps/web/src/components/roster/action-map-model.ts` (new) + `.test.ts`                        | Pure: labels, filters and counts, markers, list groups, pin.                |
| `apps/web/src/components/roster/career-action-map.tsx` (new, client) + `career-action-map.css` | Renders the design.                                                         |
| `apps/web/src/app/preview/roster/[id]/page.tsx` (modify)                                       | Swaps `CareerShotMap` for `CareerActionMap` on the preview page only.       |

---

### Task 1: Period directions (pure, TDD)

**Produces:**

```ts
export type AttackDirection = 'left' | 'right'
export interface PeriodShotSides {
  matchId: number
  periodNumber: number
  total: number
  right: number
}
export interface RecordedDirection {
  matchId: number
  periodNumber: number
  direction: string | null
}
export function periodKey(matchId: number, periodNumber: number): string
export function resolvePeriodDirections(
  recorded: readonly RecordedDirection[],
  shots: readonly PeriodShotSides[],
): Map<string, AttackDirection> // only known periods
export function normalizePosition(
  x: number,
  y: number,
  dir: AttackDirection,
): { x: number; y: number } // left → (−x, −y)
export const MIN_DIRECTION_SHOTS = 3,
  DIRECTION_SHARE = 0.8
```

**Rules:**

- A recorded `'left'` or `'right'` wins; other strings and null are ignored.
- If two sources disagree for one period, it is unknown. (This doesn't happen today; it is a guard.)
- Shot sides apply only when `total >= 3`: `right/total >= 0.8` gives right, `(total−right)/total >= 0.8` gives left. Otherwise unknown.

**Tests:**

- **Match 250 fixture:**
  - recorded P2 right, P3 left, P4 right;
  - shots P2 9/9 right, P3 0/6, P4 9/9;
  - P1 has none.
  - Expect P2/P3/P4 known and P1 absent.
- Shot-side only: 4 of 5 right gives right; 3 of 5 gives unknown; 2 shots gives unknown.
- A recorded direction beats the shot side.
- Conflicting recorded rows give unknown.
- `normalizePosition(30, -10, 'left')` gives `{ x: -30, y: 10 }`; `'right'` returns the input unchanged.

**Steps:**

1. Write the tests and watch them fail (`pnpm --filter @eanhl/db build`).
2. Implement and watch them pass.
3. Run `pnpm --filter @eanhl/db test`, typecheck and eslint.
4. Commit `feat(db): normalise action-map periods so BGM attacks right`.

### Task 2: `getPlayerCareerActions` query

**Produces:**

```ts
export interface CareerActionRow {
  eventId: number
  matchId: number
  periodNumber: number
  clock: string | null
  eventType: string
  role: 'by' | 'on'
  actorName: string | null
  targetName: string | null
  infraction: string | null
  x: number | null
  y: number | null // normalised hockey units; null = not plotted
  hasPosition: boolean // raw x/y present (the < 5 rule counts these)
  positionConfidence: string | null
  opponent: string
  gameMode: GameMode | null
  result: MatchResult
  scoreFor: number
  scoreAgainst: number
  playedAt: Date
}
export function getPlayerCareerActions(playerId: number, limit = 1000): Promise<CareerActionRow[]>
```

**What it does:**

1. **Events:**
   - `match_events` with `review_status = 'reviewed'` and `(actor_player_id = id OR target_player_id = id)`;
   - joined to `matches`, left-joined to `match_penalty_events` and to `players` (aliased actor and target, the same pattern as `getMatchEvents`);
   - ordered `matches.played_at DESC, period_number, clock-seconds DESC`;
   - limit 1,000.
   - Names: `actor_p.gamertag ?? actor_gamertag_snapshot`, and the same for target.
2. **Direction data for those matches** (two small grouped selects):
   - recorded directions from `match_period_summaries`;
   - BGM shot sides: `count(*)` and `count(*) FILTER (WHERE x > 0)` over reviewed `team_side='for'` shots/goals with a position, `GROUP BY match_id, period_number`.

   Then `resolvePeriodDirections`.

3. **Map each row:**
   - `role` is `'by'` when `actor_player_id = id`, else `'on'`.
   - When the event has a position and its period's direction is known, normalise it; otherwise x/y = null.
4. Re-export the types from `queries/index.ts` (match-events is already exported).

**Smoke check on `eanhl_preview`** (preview `DATABASE_URL` guard, from `apps/worker`):

- #2: about 738 rows, distinct matches 26, By/On about 464/274.
- Every match-250 P1 event has `x === null`.
- No P2–P4 event of match 250 is `null` when it had a position.
- #12 rows are mostly `on`.
- #28 returns `[]`.

Commit `feat(db): getPlayerCareerActions — the player's events, direction-normalised`.

### Task 3: Action map view model (pure, TDD)

**File:** `apps/web/src/components/roster/action-map-model.ts`. It uses type-only imports from `@eanhl/db/queries`, plus `computeMarkerOffsets` from `../../lib/marker-layout.ts`; check that the module has no further runtime imports.

**Produces:**

```ts
export type ActionType = 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'
export type PeriodFilter = 'all' | 1 | 2 | 3 | 'ot'
export type RoleFilter = 'all' | 'by' | 'on'
export type SortMode = 'game' | 'newest' | 'type'
export interface ActionFilters {
  period: PeriodFilter
  role: RoleFilter
  types: Record<ActionType, boolean>
  isoMatchId: number | null
}
export function actionLabel(e: CareerActionRow): string
export function periodName(n: number): string // 1st period … OT, OT2, OT3
export function formatClock(clock: string | null): string
export function visibleEvents(events, filters): CareerActionRow[]
export function filterCounts(
  events,
  filters,
): {
  periods: Record<PeriodFilter, number>
  roles: Record<RoleFilter, number>
  types: Record<ActionType, number>
}
export function buildMarkers(visible, pinId: number | null): ActionMarker[]
export function buildGroups(visible, sort: SortMode, timeZone?: string): ActionGroup[]
export function shouldShowActionMap(events): boolean // ≥ 5 with hasPosition
```

**Details:**

- **Labels:**
  - Goal; Shot; Hit;
  - "Goal against", "Shot against", "Hit taken" when `role = 'on'`;
  - "Faceoff won" / "Faceoff lost";
  - "Penalty · <infraction>" / "Penalty drawn · <infraction>".
- **Period names:** `periodName` gives 1st / 2nd / 3rd period, OT (4), OT2 (5), OT3 (6+).
- **Counts** (design `match(e, skip)`): each filter's count applies every other active filter plus the isolated game, but not its own selection.
- **Markers:**
  - only plotted events (x/y non-null) whose type isn't faceoff;
  - viewBox `cx = 1202.5 + x·12`, `cy = 512.5 − y·12`, clamped inside the rink;
  - offsets from `computeMarkerOffsets(points by eventId)`;
  - `size` 56, ×1.5 when pinned;
  - opacity: 0.28 when another event is pinned, else 0.45 when `positionConfidence === 'extrapolated'`, else 1;
  - sorted so the pinned marker draws last and goals sit above shots, shots above penalties, penalties above hits.
- **Groups:**
  - **`game`:** one group per match, newest first. Label "vs ABC"; sub "Oct 4 · 6s"; result pill "W 4–2" (W/L/OTL, DNF shows "DNF"); rows by period, then clock descending. Clicking a header isolates the game.
  - **`newest`:** one group.
  - **`type`:** one group per type, with "n by · m on".
  - Each row: `id`, actor, target, label, clock, meta (period, plus "vs ABC · Oct 4" outside game sort), `role`, `plotted`.
- **Pin:** a pin whose event is not visible gives `null`.

**Tests:**

- labels for each type × role, and for periods 1, 4 and 6;
- counts ignore their own filter (period counts unchanged when the period filter is set);
- the isolated game restricts every count;
- markers skip unplotted events and faceoffs, and dim extrapolated ones;
- the pinned marker is last and 1.5×;
- `notPlotted` = visible events without x/y;
- an empty filter result gives no groups and no markers;
- game groups are newest first, with rows ordered by period and clock;
- `shouldShowActionMap` for 4 vs 5 positioned events.

**Steps:** tests first (watch them fail), implement, watch them pass, run the gates, commit `feat(web): career action map view model`.

### Task 4: Career Action Map UI on the preview page

**`career-action-map.tsx`** (`'use client'`) takes `{ events: CareerActionRow[]; gamertag: string }`.

**State:** `period`, `role`, `types`, `sort` ('game'), `pin`, `iso`.

**Layout (design):**

- **Header:** "Career Action Map", "All positioned events across reviewed matches", "{gamertag} · N reviewed games".
- **Panel head:** "▰ Action Tracker Map · Career", "Click a marker or card to pin it".
- **Filter bar:**
  - period segments with counts (a segment with 0 events is disabled, except All);
  - By / On / All;
  - the isolated-game chip with ✕;
  - type chips with the glyph icons (faceoff chip dashed, with the `FACEOFF_NOTE` title).
- **Rink column** (`flex: 999 1 560px`):
  - "Event map · all games · normalized" and "OPP ← defends · attacks → BGM";
  - `RinkSvg` with the marker overlay (`<g>` per marker, `<title>` tooltip, pinned dashed ring);
  - the pin bar;
  - the legend with "N not plotted".
- **Events column** (`flex: 1 1 340px`, `min-height: 440px`):
  - a sort `<select>`, "N shown";
  - a scrolling list with sticky game headers. Clicking a header isolates or un-isolates the game and clears the pin.
  - Each row: rail, avatar, actor › target, the label pill, clock, meta, then the dashed no-position glyph or the type dot.
  - Clicking a marker pins it and scrolls the list to its row (design `pinEv`, using `offsetTop` within the list); clicking a row pins it without scrolling.
- **Footer:** "Source action tracker · N reviewed games · all directions normalized to BGM attacking right".
- **Phone:** under 640 px the rink and list stack, and the list gets a fixed `height: 440px`.

**Styling:** `career-action-map.css` (`.am-*`) using the site tokens. Missing design tokens get literals: `--bg-broadcast-soft` → `var(--color-surface)`, `--bg-broadcast-strong` → `var(--color-background)`, `--color-accent-soft` → `rgba(232,65,49,0.10)`, `--color-otl` → `var(--color-fg-3)`.

**Accessibility:**

- filter controls are buttons with `aria-pressed`;
- list rows are buttons;
- markers get `role="button"`, `tabIndex={0}` and an `aria-label` = their tooltip, and Enter pins;
- the rink overlay has an `aria-label`.

**Preview page:**

- replace the `getPlayerCareerShots(id, 500)` fetch with `getPlayerCareerActions(id)` (try/catch → `[]`);
- render `{shouldShowActionMap(actions) && <CareerActionMap events={actions} gamertag={overview.player.gamertag} />}` where `CareerShotMap` was;
- live code is unchanged.

**Gates:** typecheck, eslint per file, prettier.

**Browser checks** (Playwright, `eanhl_preview`):

1. `/preview/roster/2?gallery=0` at 1280:
   - the header shows "26 reviewed games";
   - By/On/All counts add up;
   - every BGM goal/shot marker sits on the right half;
   - match 250 P1 events are listed with the dashed glyph, and the legend counts them.
   - Screenshot; compare with the design.
2. **Filters:** the 2nd segment narrows markers and list, and the other segments' counts don't change. Turning off every type gives "No events match these filters." and 0 markers.
3. **Pin:** a marker click shows the pin bar, fades the other markers to 0.28, and scrolls the list row into view. Clear pin works.
4. **Isolate:** clicking a game header shows the chip, and only that game's markers are drawn. ✕ restores.
5. **Sort:** "Newest first" gives one group; "By type" gives groups with "n by · m on".
6. `/preview/roster/12?role=goalie&gallery=0`: mostly grey On markers; "Shot against" labels.
7. `/preview/roster/28?gallery=0`: no section.
8. **390×844 on #2:** `scrollWidth <= 390`, stacked layout, the list scrolls inside 440 px. Screenshot.
9. **Console:** nothing new (the ContributionWheel warning is pre-existing). The live diff is empty.

Commit `feat(web): Career Action Map on the player preview page`.

### Task 5: Review and records

1. Run the full gates.
2. A fresh reviewer (opus) reviews the step-5 range against the spec, this plan and the design. Re-grade the findings by their effect; fix Critical and Important ones with a failing test or browser reproduction first; ledger the minors.
3. Append the execution record and run the handoff update.
4. Report: links, the deviations above, the deferred minors, and the switch as the next step.

## Verification (end to end)

- `pnpm --filter @eanhl/db test` (directions), `pnpm --filter web test:unit` (model), typecheck for db, worker and web.
- The query smoke check (Task 2); a read-only psql cross-check of #2's distinct matches and By/On counts.
- The Playwright checks from Task 4 at 1280 and 390 px; no live file changed.

## Execution record (2026-10-07)

Executed inline (Native) on `feat/player-cards`; one fresh reviewer (opus) at the end.

**Commits:** `561ac0a` plan · `e2898c9` directions · `bb6803b` query · `4d0c90a` view model · `c5d971e` opponent abbreviation fix · `5282e20` UI · `31df1d8` review fixes.

**Verification:**

- **Tests:** db 126/126 (directions 5/5); web unit 386/386 (action-map-model 13/13). Typecheck for db, worker and web, per-file eslint and prettier all green. No live file changed.
- **Preview smoke, #2:** 738 events in 26 games, By/On 464/274. All 103 plotted BGM shots and goals sit on the right half. Match 250 P1 is listed but not plotted.
- **Playwright:**
  - Filters: counts ignore their own selection. Turning every type off gives the empty state.
  - Pin: the pin bar shows, other markers fade, and the list scrolls to the row.
  - Isolate and sorts work. Goalie #12 is mostly On, labelled "Shot against" / "Goal against". #28 shows no section.
  - Phone: 390 px stacks. Keyboard: Enter pins a marker.

**Rulings:**

- **Task 3:** `buildPin` takes `(visible, pinId)`, and the game groups use a guard instead of a type assertion.
- **Task 4:**
  - **Opponent abbreviation:** opponents show `abbreviateTeamName(opponent_name)`, the site's convention, because the OCR `opp_team_abbr` is often one character on real data. A test pins this.
- **Final:**
  - **No content-visibility:** list groups don't use `content-visibility`, which would break pin-to-row scrolling.
  - **Declined items:** the reviewer's 12 "declined to judge" items stand.

**Review:** "With fixes": 0 Critical, 2 Important (both fixed, measured before and after), 8 Minor.

- **Fixed — tap speed:** pin taps went from 186–896 ms to 41–140 ms; sort from 495–762 ms to 204–237 ms (dev build).
- **Fixed — section weight:** 906 KB / 14.3k elements went to 579 KB / 10.5k.
- **Gone with the row rewrite:** the positioned-faceoff "No rink position" label.
- **Deferred minors:**
  - A non-numeric clock would hide the section.
  - A recorded-direction conflict blocks the shot fallback.
  - The < 5 hide rule counts positions, not markers.
  - Every marker is in the Tab order.
  - Goal glyphs sit about 3.75 units high.
  - Hitting the 1,000-row cap truncates the oldest game.
  - Duplicate clock parser.

**For the switch:**

- Replace `CareerShotMap` at `apps/web/src/app/roster/[id]/page.tsx:247`.
- Delete `career-shot-map.tsx`.
- Fix the stale "elapsed" `clock` comment in `schema/match-events.ts`; the data is time remaining.
- Measure the page on a real phone.
