# Event Map Implementation Report

Pilot: match 250. Final state: 72/72 non-faceoff events placed (100%), zero phantoms, zero out-of-range coords.

## Goal

Make `/games/[id]` display every non-faceoff event (goal/shot/hit/penalty) on a rink, anchored to its real on-ice location.

## Starting state

Of match 250's 95 events, only 20 had `(x, y)` coordinates when this work began, and the few markers that did render were "completely off, not a little bit." 13 of those 20 were faceoffs (hidden from the map by design). So only 7 markers showed on the rink, and they were wrong.

The data flow was:

1. **Python OCR pipeline** ([tools/game_ocr/](../../tools/game_ocr/)) parses Action Tracker screenshots, builds a JSONB blob per capture stored in `ocr_extractions.raw_result_json`, and promotes each parsed event into `match_events`.
2. **CVAT** (self-hosted web tool at `http://localhost:8080`) is where the operator clicks yellow markers on rink screenshots to create point annotations exported as XML.
3. **`import_cvat_labels.py`** ([tools/game_ocr/scripts/import_cvat_labels.py](../../tools/game_ocr/scripts/import_cvat_labels.py)) reads the CVAT XML, converts pixel → hockey coords via the rink calibration JSON, joins each label to a `match_events` row by `(period_number, event_type, clock, actor)`, and writes `x`, `y`, `rink_zone`.
4. **Web frontend** ([apps/web/src/components/matches/shot-map.tsx](../../apps/web/src/components/matches/shot-map.tsx)) reads `match_events` rows, applies `rinkX`/`rinkY` to convert hockey coords to SVG, and draws each marker on the rink illustration.

The CVAT-to-match-events join hinged on a single field in `raw_result_json`: **`selected_event_index`**. This is the row in the parsed events list that the CVAT-labelled yellow marker on the rink represents. Get that wrong and every label lands on the wrong event.

## Problems & fixes

### Problem 1 — `detect_selected_row_index` keyed on the wrong visual cue

**Symptom**: every detected `sel_idx` came back as a faceoff in P2/P3 (22/26 and 26/37 respectively). Zero goal/shot/hit/penalty selections.

**Root cause**: the old detector counted red pixels in each row's background band and picked the row with the highest count. But in this UI, **red is the team-color indicator for BGM-actor portraits and event-type pills** — every BGM row has red, regardless of selection. Selection itself was a totally different visual cue that the detector ignored.

**Real selection cue**: **a thin white border outlines the selected card on all four sides**. Other rows have no border, just a dark grey background. The portrait bg / event-pill carry team color always.

**Fix** ([spatial.py:331-429](../../tools/game_ocr/game_ocr/spatial.py#L331-L429)):

- Crop a vertical sample strip down the panel, excluding the portrait (~20% left) and event-pill (~15% right).
- HSV mask for **near-pure-white** pixels (V ≥ 220, S ≤ 40).
- Per-pixel-row density → find narrow (≤ 8 px tall) peaks with density ≥ 250.
- A real border peak hits density ~425; text rows top out at ~200, and span 20+ px tall. The narrow-peak filter cleanly separates them.
- Match the strongest narrow peak to the row whose actor.y_center sits 50–90 px above it (empirically ~67 px because the card is ~95 px tall and the actor text sits near the top).

**Result**: 6/6 ground-truth captures passed on first run, 32/37 P3 captures got a selection, 53/56 P2+OT captures got a selection.

### Problem 2 — Importer silently fell back to `events[0]` on NULL sel_idx

**Symptom**: a few captures detected nothing, but coords still appeared on the wrong events.

**Root cause**: `import_cvat_labels.py` had `COALESCE((sel_idx)::int, 0)`. When the detector returned NULL (no border found — often the bottom of the list scrolled off the screen), the importer assumed `events[0]` = topmost row was selected. That re-introduced the original bug.

**Fix**: strict null-check ([import_cvat_labels.py:143-170](../../tools/game_ocr/scripts/import_cvat_labels.py#L143-L170)). NULL sel_idx → skip that label entirely, surface as needing manual override.

### Problem 3 — Rink calibration was off-centre and too narrow

**Symptom**: "everything is too far to the left", "squished toward the middle." Some events even fell outside ±100 hockey ft (off the rink mathematically).

**Root cause**: the original `rink_pixel_box` was `(947, 342, 1797, 830)` with non-uniform px/ft scaling — 4.25 on x, 5.74 on y (a 35 % mismatch). The centre at (1372, 586) was also offset 60-some px from the actual rink centre in the art.

**Fix**: measured the visible rink edges directly in Photoshop. New box `(836, 403, 1783, 812)`, centre (1309.5, 607.5), uniform-ish scaling 4.74 × 4.81 px/ft. Built [recalibrate_rink.py](../../tools/game_ocr/scripts/recalibrate_rink.py) so any future re-calibration takes 30 seconds with measured landmarks.

**Side discovery**: the in-game art is **stylized**, not NHL-proportional. Blue lines are drawn 13% further from centre than NHL, faceoff dots 4% closer. There's no single linear calibration that makes every feature line up. We picked the boards/end-walls as the anchor because rink edges define the playable area — events at the boards correctly map to ±100/±42.5.

### Problem 4 — Some events couldn't be placed via the standard import

Several captures fell into edge cases that the join couldn't handle:

- **`event_type = 'unknown'`** (parser couldn't classify the event icon) — match_events row had the correct type from another capture, so the join failed on type mismatch.
- **Cutoff captures** — bottom of the list scrolled off-screen, the selected event was visible only partially and wasn't in the parsed `events[]` array at all.
- **NULL clock** — parser failed to OCR the timestamp on the selected row; the `(clock, actor)` join missed.

**Fix**: a layered fallback per case:

1. **Type-mismatch / NULL clock**: manual override SQL — look up the capture's CVAT pixel coords, apply the calibration math directly to the known target event ID. Bypasses the join.
2. **Cutoff captures** (selected event not in parsed list): manual override against a hardcoded `(capture filename → event ID)` mapping, since the operator knows which event each frame represents.
3. **OCR auto-detected coords**: spatial.py's `find_selected_marker` already extracts the yellow marker's pixel position at OCR time and writes hockey coords into `raw_result_json.selected_event_x/y`. For captures with no CVAT label, we back-converted those (under old calibration) → pixel → new calibration → hockey.
4. **Operator-supplied pixel coords**: for the final stragglers, open the screenshot in Photoshop, hover the marker, read `(X, Y)`. SQL update directly.

### Problem 5 — Phantom rows from OCR misreads

**Symptom**: `id 117 SILKY SHOT 1:10` existed in match_events but the game ended on the OT winning goal at 2:37, so nothing can happen at 1:10.

**Root cause**: in `vlcsnap-2026-05-10-01h52m34s477.png`, the parser misread `S 11:10 SHOT` as `S 71:10 SHOT` then normalised that to clock `1:10`. The event-promoter created a new `match_events` row from this phantom parse. The selected event in that capture was correctly the WHOOSAH 16:14 shot (id 95); the phantom came from a non-selected row in the events array.

**Fix**: deleted id 117 directly. The phantom doesn't recur because the same `(period, type, clock, actor)` parse from other captures gets deduped into the same row.

### Problem 6 — `team_side` misclassification

**Symptom**: 7 M. RANTANEN events were tagged `team_side='against'` (rendered as opponent on the map) even though M. RANTANEN is BGM. So 3 BGM events showed instead of the real 6.

**Root cause**: the event promoter sets `team_side` based on whether the actor's gamertag resolves to a BGM `players.id` via `player_display_aliases`. The alias for `M. RANTANEN` → MrHomiecide hadn't been created.

**Fix**: SQL `UPDATE match_events SET team_side='for'` for all M. RANTANEN rows in match 250; added `player_display_aliases` rows (`M. RANTANEN → MrHomiecide`, `SIlKY → silkyjoker85`) so future ingestions resolve correctly.

### Problem 7 — Frontend rendering issues

Smaller fixes in [shot-map.tsx](../../apps/web/src/components/matches/shot-map.tsx):

- **Off-rink markers disappeared** — events at hockey x = -105.99 mapped to SVG x = -69 (outside the 0..2405 viewBox). Added `Math.max/min` clamp at `rinkX`/`rinkY` so events past the boards render flush against the edge.
- **Tooltips never fired** — the SVG had `pointer-events-none`, blocking hover events to the `<title>` elements. Removed that, kept the `<title>` content (event type · actor · clock · period).
- **Chip counts were match-wide instead of period-scoped** — `counts` was computed from `positioned` before applying the period filter. Moved the calculation downstream of the period filter so chips read "P3 has 4 goals" not "match has 5 goals" when you click a period.
- **Markers at the boards got clipped** — an 80-px hit marker centred at SVG y = 2.5 (hockey y = +42.5) had its top 40 px outside the viewBox. Added a final clamp in `PlacedMarker` that pins each marker so its bounding box stays inside the rink.
- **New event-list panel** ([shot-map.tsx:125-191](../../apps/web/src/components/matches/shot-map.tsx#L125-L191)) — scrollable list to the right of the rink. Each row shows clock, period, event-type badge (red for BGM, grey for opp), actor → target. Same filter state as the rink markers.

## Final pipeline (how it works now)

### Ingestion

1. Game video → operator navigates the in-game post-game Action Tracker → screenshots each event with its row highlighted.
2. Each PNG goes into `research/OCR-SS/Action-Tracker/<period>-Events/`.
3. Python OCR (`game_ocr`) parses each PNG → writes a JSON blob into `ocr_extractions.raw_result_json` containing:
   - All visible event rows (clock, actor, type, target).
   - **`selected_event_index`** = the index of the row with the white border — found by the bottom-border detector in `spatial.py`.
   - **`selected_event_x/y`** = the yellow marker's hockey coords from `find_selected_marker` (independent of the row detector).
4. The worker promoter inserts/updates one `match_events` row per parsed event, resolving actor → player via `player_display_aliases` to set `team_side`.

### Spatial labelling

1. The PNGs get uploaded to a self-hosted CVAT task. Operator adds a point annotation on the yellow marker per frame, labelled `selected_marker`.
2. Export as CVAT-for-images-1.1 XML.
3. `import_cvat_labels.py` reads the XML and for each labelled image:
   - Look up the matching `ocr_extractions` row by `source_path LIKE '%/' || filename`.
   - Get `events[selected_event_index]`. Skip if NULL.
   - Convert the CVAT pixel coords → hockey via `rink_pixel_box` calibration.
   - Join to `match_events` by `(match_id, period_number, event_type, clock, lower(actor_gamertag_snapshot))`. Skip mismatches silently — those become manual-override candidates.
4. Manual overrides handle the long tail: cutoff captures (selected row not in parsed list), `event_type='unknown'` parses, NULL clocks, and OCR-typo duplicates.

### Calibration

- Single JSON: [post_game_action_tracker.json](../../tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json) defines the `rink_pixel_box` that maps to hockey [-100, +100] × [-42.5, +42.5].
- Re-calibrate with [recalibrate_rink.py](../../tools/game_ocr/scripts/recalibrate_rink.py) by feeding measured landmark pixel positions; the script least-squares fits and writes the new box.

### Rendering

- Web rink SVG is NHL-standard 2.35:1 at viewBox 0..2405 × 0..1025, 12 SVG units per foot.
- `rinkX`/`rinkY` ([shot-map.tsx:298-311](../../apps/web/src/components/matches/shot-map.tsx#L298-L311)) clamp to ±100 / ±42.5 before scaling.
- `PlacedMarker` clamps each marker's bounding box to keep the entire icon inside the rink.
- `EventList` on the right mirrors filter state and lists the visible markers.

## Numbers

| period | goal | shot | hit | total placed | % |
|---|---|---|---|---|---|
| P2 | 2/2 | 11/11 | 13/13 | 26/26 | **100 %** |
| P3 | 4/4 | 11/11 | 13/13 | 28/28 | **100 %** |
| OT | 1/1 | 10/10 | 7/7  | 18/18 | **100 %** |
| **match** | **7/7** | **32/32** | **33/33** | **72/72** | **100 %** |

Zero out-of-range coords. Zero phantom rows. Zero misclassified team-sides.

## What this gives us generalizable to future matches

1. **A working detector** that doesn't need re-tuning per match — selection is signalled by the same white border every game.
2. **An importer that fails loud, not silent** — when a label can't be matched, it's surfaced rather than smeared onto the wrong event.
3. **A reusable calibration tool** — `recalibrate_rink.py` works for any Action Tracker screen layout you point it at.
4. **A short list of edge cases** to expect from future matches: cutoff captures, unknown event types, phantom OCR rows, missing team_side aliases. Each has a known fix recipe.

## What's still rough / future work

- **Per-period BGM-attack direction**: we noticed teams switch ends each period, but the calibration's `bgm_attacks` is a single value. The current setup happens to render coherent visuals across all periods for match 250 because the in-game rink shows events at their pixel positions regardless of which net BGM defends — but if a future match has events whose hockey x signs feel inverted, the convention may need a per-period mirror flag.
- **Stylized rink art**: blue lines and faceoff dots don't perfectly align with NHL-standard positions under the boards-anchored calibration. Visible only in the calibration debug overlay, not on the rendered shot map. Not worth fixing unless a feature-overlay UI is desired.
- **No automatic team_side alias detection**: relies on a human noticing misclassified actors and adding to `player_display_aliases`.
- **OCR misreads**: still create phantom rows occasionally. Today we delete them by hand. A future tightening would have the promoter validate `(clock, actor)` consistency across multiple captures of the same event before inserting.
- **Capture procedure**: a slow scroll + audio commentary suggestion would eliminate the cutoff/unknown/NULL-clock edge cases at the source.
