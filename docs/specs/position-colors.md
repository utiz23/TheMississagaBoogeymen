# Position Color Reference

This file defines the canonical position color palette for all position indicators across the site — pills, donut charts, markers, and any future on-ice/event-map overlays.

## BGM / Home Side

| Position | Key | Hex |
|---|---|---|
| Center | `center` | `#c0061c` | #c0061c
| Left Wing | `leftWing` | `#23cf1d` | #23cf1d
| Right Wing | `rightWing` | `#2659cf` | #2659cf
| Left Defense / D1 | `defenseLeft` | `#13dfc8` | #13dfc8
| Right Defense / D2 | `defenseRight` | `#ece335` | #ece335
| Goaltender | `goalie` | `#6f00a5` | #6f00a5

## Opponent / Away Side

| Position | Key | Hex |
|---|---|---|
| Center | `center` | `#cdbf69` | #cdbf69
| Left Wing | `leftWing` | `#a8508c` | #a8508c
| Right Wing | `rightWing` | `#5c6959` | #5c6959
| Left Defense / D1 | `defenseLeft` | `#db8b67` | #db8b67
| Right Defense / D2 | `defenseRight` | `#d0d963` | #d0d963
| Goaltender | `goalie` | `#e8aee9` |

## Pill Rendering

Pills use three derived values from the base hex — applied via inline `style`:

| Role | Formula |
|---|---|
| `text` | Base hex (full opacity) |
| `border` | Base hex + `66` alpha suffix (40%) |
| `bg` | Base hex + `1a` alpha suffix (10%) |

Neutral/unknown position falls back to:
- `border: #3f3f46`, `bg: rgba(39,39,42,0.40)`, `text: #a1a1aa`

Implementation: [apps/web/src/components/matches/position-pill.tsx](../../../apps/web/src/components/matches/position-pill.tsx)

## Donut Chart

Single-player position breakdown donuts use the **BGM palette** (same hex values, no opponent variant needed). The `defenseMen` EA key maps to the D1/Left Defense color (`#74f2df`) as the generic fallback when left/right split is unknown.

Implementation: [apps/web/src/components/roster/position-donut.tsx](../../../apps/web/src/components/roster/position-donut.tsx)

## Shot Map (deviation from team average)

The shot map repurposes two BGM hex values for "below team average":

- `#656cbe` (BGM right wing) — well below team average
- `#656cbe66` — modestly below team average

This is the only surface that uses the right-wing color outside of position pills. There's no conflict because shot-map zones never overlap with player position pills on the same view.

Implementation: [apps/web/src/lib/shot-map-colors.ts](../../apps/web/src/lib/shot-map-colors.ts)

## Usage Notes

- `defenseMen` from EA data should be split visually into LD/D1 and RD/D2 where a `defenseSide` is available. When unknown, default to D1 (left defense) color.
- Match scoresheets use BGM colors for BGM rows, Opponent colors for opponent rows.
- Donut charts and single-player contexts always use BGM colors.
- This palette is intentionally vivid — use sparingly outside of pills, markers, or compact identity chips.
