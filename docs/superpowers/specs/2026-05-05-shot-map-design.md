# Shot Map — Design Spec

**Status:** Approved (brainstorm 2026-05-05)
**Scope:** Per-player skater shot map on the player profile page, NHL 26 only.

## Goal

Visualize where each skater shoots from (and scores from) across the season, comparing their per-zone distribution to the team average. Replaces the placeholder "Shot Map" `ComingSoonCard` slot in `Charts & Visuals`.

Out of scope for v1: goalies, per-match shot maps (location data is not in match payloads), pre-NHL-26 game titles (EA does not return location fields for those).

## Data source

EA's `/members/stats` endpoint (already polled by the worker) returns 42 string-encoded fields per skater that we currently ignore via the `[key: string]: unknown` catch-all in `EaMemberStats`:

- `skShotsLocationOnIce1`–`skShotsLocationOnIce16` — 16 ice zones
- `skGoalsLocationOnIce1`–`skGoalsLocationOnIce16` — 16 ice zones
- `skShotsLocationOnNet1`–`skShotsLocationOnNet5` — 5 net zones
- `skGoalsLocationOnNet1`–`skGoalsLocationOnNet5` — 5 net zones

Sum invariant (verified against a real player payload): `sum(skShotsLocationOnIce*) === sum(skShotsLocationOnNet*)` — every shot is counted in both maps. Use this as a transform sanity check.

`stats.chelhead.com/members-stats` is a thin proxy of the same EA endpoint; ChelHead's heatmap is built from these exact fields.

## Schema change

Single new column on `ea_member_season_stats`:

```ts
shotLocations: jsonb('shot_locations').$type<ShotLocations | null>()
```

```ts
type ShotLocations = {
  shotsIce: number[]    // length 16
  goalsIce: number[]    // length 16
  shotsNet: number[]    // length 5
  goalsNet: number[]    // length 5
}
```

`null` for goalie rows (`favoritePosition === 'goalie'`) and any pre-NHL-26 ingestion (no source fields present).

Migration is additive — no backfill blocker. After the schema migrates and the worker transform updates, run `pnpm --filter worker reprocess` to populate existing rows from archived raw payloads. No re-fetch from EA.

## Worker transform

Extend the existing member-stats transform in `apps/worker` to:

1. Read the 42 shot-location fields from each member object.
2. Parse each to integer (EA returns strings).
3. Assemble the four arrays in index order.
4. Validate `sum(shotsIce) === sum(shotsNet)` and `sum(goalsIce) === sum(goalsNet)`; on mismatch, log a warning and skip writing `shotLocations` for that member (keep existing row otherwise).
5. Validate array lengths are exactly 16 / 5 / 16 / 5; on length drift, log a warning and skip.
6. Set `shotLocations = null` when `favoritePosition === 'goalie'` or when no source fields are present (pre-NHL-26 game titles).

Existing transform unit tests get one new fixture-based case asserting the four arrays are built and the integer parsing is correct.

## Zone numbering — discovery step

EA zone indices (1–16 ice, 1–5 net) are undocumented. Implementation must validate the mapping before any UI work:

1. Pick one ingested skater (e.g. `silkyjoker85`) and pull their numeric distribution from the DB.
2. Open the same player's profile on ChelHead, where zone counts render physically on the rink.
3. Match each EA index → physical zone by comparing counts (e.g. if `skShotsLocationOnIce7 = 37` and ChelHead's slot zone shows 37, then index 7 = slot).
4. Repeat with a second player to confirm consistency.
5. Bake the result into a frozen `ICE_ZONE_LAYOUT` / `NET_ZONE_LAYOUT` constant inside the component — each entry maps an EA index to an SVG path/rect position.

Net layout will almost certainly be `1=top-left, 2=top-right, 3=bottom-left, 4=bottom-right, 5=five-hole` (or a near-permutation, easy to validate from one player).

**Risk:** the rink may be mirrored for left- vs right-shot players. Step #4 surfaces this. If confirmed, the component flips horizontally based on `player.shotsHand` (or whatever EA exposes).

## Component

New file: `apps/web/src/components/roster/shot-map.tsx`. Client component (toggles need interactivity).

```ts
interface Props {
  player: { shotLocations: ShotLocations | null }
  teamAverage: ShotLocations
  hasData: boolean   // false on non-NHL-26 active title
}
```

Internal state:
- `view: 'ice' | 'net'`
- `mode: 'shots' | 'goals' | 'shootingPct'`

Layout (sized for the existing half-width slot in `lg:grid-cols-2`):

```
┌──────────────────────────────────────────────┐
│ SHOT MAP · NHL 26       [SOG][G][S%]         │  header + mode tabs
│ [ICE][NET]                                   │  view toggle
├──────────────────────────────────────────────┤
│ ┌──────────┐  ┌────────────────────────┐     │
│ │  SVG     │  │ 132   ALL LOCATIONS    │     │
│ │ rink/net │  │  37   HIGH DANGER      │     │  breakdown
│ │          │  │  61   MID RANGE        │     │
│ │          │  │   8   LONG RANGE       │     │
│ └──────────┘  └────────────────────────┘     │
│ Legend: ▌ below team avg  ▍ avg  ▎ above     │
└──────────────────────────────────────────────┘
```

When `view === 'net'`, the SVG swaps to a 5-zone net diagram and the breakdown panel summarizes upper / lower / 5-hole instead of high-danger / mid / long.

Hover tooltip on every zone:
- Shots / Goals modes: `count · team avg X · ±Y%`
- Shooting % mode: `count goals / count shots = X%`

## Color / heat math

**Shots and Goals modes** — color by deviation from team average:

```ts
const delta = (playerCount - teamAvg) / Math.max(teamAvg, 1)
```

| Delta range          | Bucket          | Color       |
| -------------------- | --------------- | ----------- |
| `delta ≥ +0.50`      | Well above avg  | `#c34353`   |
| `+0.15 ≤ delta < +0.50` | Above        | `#c3435399` |
| `-0.15 < delta < +0.15` | At average   | `#3f3f46`   |
| `-0.50 < delta ≤ -0.15` | Below        | `#656cbe66` |
| `delta ≤ -0.50`      | Well below      | `#656cbe`   |

Red is the BGM accent (canonical, see `docs/specs/position-colors.md`). Blue is the BGM right-wing color, repurposed here for "below" since it doesn't conflict with any position pill on the same surface.

**Shooting % mode** — different rule:

- Zones with `shots ≥ 5` → color on a green→red scale relative to the player's own zone distribution (low pct = cold green, high pct = hot red). Not vs team — small-sample variance is too noisy.
- Zones with `shots < 5` → gray hatching, count visible only on hover. Avoids displaying e.g. 100% from a single shot.

## Team average

New query in `packages/db/src/queries/shot-locations.ts`:

```ts
async function getTeamAverageShotLocations(gameTitleId: number): Promise<ShotLocations>
```

Computes the per-zone mean across all rows in `ea_member_season_stats` where:
- `gameTitleId` matches
- `shotLocations IS NOT NULL`
- `gamesPlayed >= 5` — keeps tryouts/one-game members from polluting the baseline
- `favoritePosition !== 'goalie'`

Result is cached per request via Next's RSC cache (no separate persistence layer).

## Wiring

`app/roster/[id]/page.tsx`:

1. If `player.favoritePosition === 'goalie'`, do not render the shot map slot at all (out of v1 scope).
2. Otherwise, fetch the player's `shotLocations` (already part of `ea_member_season_stats` row).
3. Fetch `teamAverage` via the new query.
4. Determine `hasData = (activeTitle === 'NHL 26' && shotLocations !== null)`. When `false`, the component still renders chrome + the NHL-26-only empty-state message.
5. Pass `player`, `teamAverage`, `hasData` to `ChartsVisualsSection`, which forwards to `ShotMap`.

`charts-visuals-section.tsx` swaps the `ComingSoonCard` for `<ShotMap … />` when the slot is shown. Skater profiles always show the slot (with empty-state copy on non-NHL-26 titles); goalie profiles omit it.

## Edge cases

- **No `shotLocations` row** (player has no NHL-26 stats yet): render framing chrome, body shows *"Shot location data is only collected for NHL 26."* No mode tabs.
- **Active title ≠ NHL 26**: same empty state, with the "NHL 26" tag visually emphasized so the constraint is obvious.
- **Goalie player profile**: card hidden entirely; the `Charts & Visuals` grid still renders the other slots.
- **`teamAverage[i] === 0`**: divide-by-zero floor (`max(teamAvg, 1)`) makes any non-zero player count read as "well above." Acceptable — these are vanishingly rare zones.
- **All zone counts are 0**: SVG renders all zones at neutral `#3f3f46`, breakdown panel shows `0 · ALL LOCATIONS`. No special copy.
- **Zone array length mismatch (data drift)**: component renders only known indices, ignores extras. Worker logs a warning at ingest (see Worker transform §4).

## Testing

- **Worker transform unit test** — fixture-based, asserts the four arrays build correctly and the integer parse is right.
- **Color bucket pure function** — unit test for `deltaToColorBucket(player, teamAvg)` covering all five buckets and the divide-by-zero floor.
- **Zone-mapping golden test** — once discovery lands, snapshot a known player's index→position assignment.
- **No Playwright/E2E** — matches existing chart test discipline.

## Files touched

| File                                                              | Change             |
| ----------------------------------------------------------------- | ------------------ |
| `packages/ea-client/src/types.ts`                                 | Add 42 typed fields |
| `packages/db/src/schema/ea-member-season-stats.ts`                | Add `shotLocations` jsonb column + migration |
| `packages/db/src/queries/shot-locations.ts`                       | New file — `getTeamAverageShotLocations` |
| `packages/db/src/queries/players.ts`                              | Include `shotLocations` in player profile fetch |
| `apps/worker/src/transform/...`                                   | Extract, validate, write the 4 arrays |
| `apps/web/src/components/roster/shot-map.tsx`                     | New component |
| `apps/web/src/components/roster/charts-visuals-section.tsx`       | Replace `ComingSoonCard` with `<ShotMap />` |
| `apps/web/src/app/roster/[id]/page.tsx`                           | Wire props |
| `docs/specs/position-colors.md`                                   | Add a note on blue (below-avg) usage |

## Future work (out of v1)

- **Goalie variant** — shots-against map, same component shape, different data source (`glShotsLocationOnIce*`, `glGoalsLocationOnIce*`).
- **Per-match shot map** — not currently possible (location data is not in match payloads). Would require EA exposing it on the match endpoint.
- **Multi-title comparison** — only relevant if EA starts emitting location data for a non-NHL-26 title.
