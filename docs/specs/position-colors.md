# Position Color Reference

This file defines the canonical position color palette for match-page player indicators, pills, and any future on-ice/event-map player markers.

## BGM / Home Side

- `Center`: `#c34353`
- `Left Wing`: `#6ed565`
- `Right Wing`: `#656cbe`
- `Left Defense / D1`: `#74f2df`
- `Right Defense / D2`: `#ecef6d`
- `Goaltender`: `#a587cd`

## Opponent / Away Side

- `Center`: `#cdbf69`
- `Left Wing`: `#a8508c`
- `Right Wing`: `#5c6959`
- `Left Defense / D1`: `#db8b67`
- `Right Defense / D2`: `#d0d963`
- `Goaltender`: `#e8aee9`

## Usage Notes

- `defenseMen` from EA data should be split visually into:
  - `LD / D1`
  - `RD / D2`
- When exact left/right defense side is unknown, default to the generic defense color that best matches the rendered slot:
  - left-side defense UI uses `Left Defense / D1`
  - right-side defense UI uses `Right Defense / D2`
- Match-detail scoresheets should use:
  - BGM colors for BGM rows
  - Opponent colors for opponent rows
- This palette is intentionally vivid and should be used sparingly outside of pills, markers, or compact identity chips.
