# Event-position Recovery & Manual Corrections (Action Tracker)

Workflow for fixing `match_events` rows when the spatial extractor
missed an event. There are TWO mechanisms, in order of preference:

1. **`inventory_consensus_match.py`** — the ABC/123 system. The
   `detected_markers` payload on every action_tracker capture lists
   ALL markers the rink renders (not just the yellow-highlighted one).
   The script clusters those markers across captures, votes shape +
   colour, and assigns each cluster to an unpositioned `match_events`
   row by panel-text frequency. Run this FIRST whenever any P-period
   event lacks `(x, y)`.

2. **Direct SQL with `position_confidence = 'manual'`** — only when
   step 1 leaves the event unpositioned. That means no detected
   marker matched the event across ALL captures, typically because
   the event never appeared on the rink in any frame the OCR saw.

## 1. Inventory consensus matcher (the default path)

Run the cross-frame consensus pass:

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc "
  SELECT json_agg(json_build_object('id', id, 'source_path', source_path,
                                    'raw_result_json', raw_result_json))
  FROM ocr_extractions
  WHERE match_id = <MATCH_ID>
    AND screen_type = 'post_game_action_tracker'" \
  | python3 tools/game_ocr/scripts/inventory_consensus_match.py <MATCH_ID> \
  | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl
```

The script prints diagnostic comments (cluster counts per period, how
many unpositioned events were resolved, bucket-level matching) and a
SQL transaction that updates the matched rows. Inspect the output
before piping it back to psql if you want to dry-run.

A successful run reports:

```
-- summary: matched N of M unpositioned events
```

If `N < M`, the remaining events go to step 2.

## 2. Manual override (the fallback path)

Each correction below is keyed to a specific known failure mode the
consensus matcher CAN'T resolve:

| Symptom on `/games/[id]` | Root cause | Override |
|---|---|---|
| Card shows on the rink in the wrong zone | Spatial extractor misread the yellow-selected marker for that event (typical near the boards / corners where the convex hull breaks). | Set `x`, `y`, `rink_zone` directly; mark `position_confidence='manual'`. |
| Two adjacent cards share one marker | Spatial extractor reused the previous frame's yellow position (the scroll happened between captures). | Clear `(x, y)` on the duplicated event OR set a manual position. |
| Card has no marker on the rink at all | Event was never the yellow-selected row in any captured frame. | Set a manual `(x, y)` from review of the in-game footage. |
| Card paints in the wrong team's color | Actor and target both unaliased — `parse_post_game_action_tracker` defaulted to `team_side='against'`. Fix the alias rather than the row when possible. | Last resort: `UPDATE match_events SET team_side = …` after adding the proper `player_display_aliases` row. |

## Identifying the event card

The user reports the event by **period + clock + actor**:

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "
  SELECT id, period_number, clock, event_type, team_side, x, y,
         actor_gamertag_snapshot AS actor, target_gamertag_snapshot AS target
  FROM match_events
  WHERE match_id = <MATCH_ID>
    AND period_number = <PERIOD>
    AND clock = '<MM:SS>'
"
```

On the live page that event corresponds to the card with
`data-event-id="<id>"` in the DOM. Confirm the actor / target snapshot
matches the user's description before editing.

## Picking an (x, y)

The rink coordinate system is documented in
[`tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json`](../../tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json):

- `x ∈ [-100, 100]` — `-100` is the LEFT boards, `+100` is the RIGHT boards.
- `y ∈ [-42.5, 42.5]` — `-42.5` is the BOTTOM boards, `+42.5` is the TOP boards.
- Center ice is `(0, 0)`. Blue lines are at `x = ±25`.

For BGM matches we set `bgm_attacks: right`, so the BGM offensive zone
is `x > 25` and the BGM defensive zone is `x < -25`.

Common reference positions:

| Description | `(x, y)` |
|---|---|
| Center ice | `0, 0` |
| Right side of center ice circle | `15, 0` |
| BGM blue line, top boards | `25, 40` |
| BGM blue line, bottom boards | `25, -40` |
| BGM offensive faceoff dot, top | `69, 22` |
| BGM offensive faceoff dot, bottom | `69, -22` |
| Opp goal crease (BGM attacking) | `89, 0` |
| BGM goal crease | `-89, 0` |

## Applying the override

```sql
UPDATE match_events
SET x = <X>, y = <Y>,
    rink_zone = '<neutral|offensive|defensive>',
    position_confidence = 'manual'
WHERE id = <EVENT_ID>;
```

`rink_zone` matches the value the spatial extractor would have written:

- `defensive` when `x < -25` (BGM defends LEFT).
- `neutral` when `-25 ≤ x ≤ 25`.
- `offensive` when `x > 25`.

`position_confidence = 'manual'` (added in migration 0040) is the
trust marker — the UI treats these the same as `'interpolated'`
(solid marker, not the muted `extrapolated` dotted style).

## Reverting

```sql
UPDATE match_events
SET x = NULL, y = NULL, rink_zone = NULL, position_confidence = NULL
WHERE id = <EVENT_ID>;
```

The card will surface in the list with a `No marker` chip on the
right column instead of plotting on the rink.

## Logged corrections

Append a one-line entry here whenever you apply an override so future
calibration work can reference real failure modes.

| Date | Match | Event ID | Period · Clock | Symptom | Override |
|---|---|---|---|---|---|
| 2026-05-16 | 250 | 288 | P2 · 19:43 | Hit by TOEWS → E. WANHG, no yellow marker captured | `(x, y) = (15, 0)` — right side of center ice circle |
| 2026-05-16 | 250 | 256 | P2 · 11:23 | SILKY shot positioned in neutral zone | `(x, y) = (30, -38)` |
| 2026-05-16 | 250 | 268 | P2 · 0:01 | SILKY shot positioned in neutral zone | `(x, y) = (25, 40)` |
| 2026-05-16 | 250 | 281 | P3 · 8:03 | E. WANHG shot shared marker with 7:39 | `(x, y) = (-81.45, -8.79)` via `inventory_consensus_match.py` (cluster matched, not manual) |
