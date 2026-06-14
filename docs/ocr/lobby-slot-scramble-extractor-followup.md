# Pre-game lobby slot scramble — extractor follow-up

Filed 2026-06-14 (Tier 1, plan `~/.claude/plans/sorry-forgot-to-put-steady-lemon.md`, WS-B).
Deferred by user decision; this records the verified root cause + the fix path so the work can be
picked up cold.

## Symptom (3 quarantined reds)

- `match 250: pre-game lobby BGM loadout fields match V2`
- `match 250: lobby typed_v1 hard-field accuracy ≥ 90%`
- `match 250: lobby typed_v1 soft-field accuracy ≥ 75%`

`pre_game_lobby_state_2` rows bind the right values to the wrong slots (wrong
gamertag↔position↔number), giving gamertag 7/10, player_number 2/10, height 5'9" vs 6'6". The
loadout_view-derived reviewed lineup is correct vs V2; only the lobby-sourced fields are scrambled.

## Root cause (verified read-only)

Lobby position is assigned by **anchor OCR text after a y-sort, with no grid re-lookup**:
- [lobby_extractors/row_grouping.py:299-330](../../tools/game_ocr/game_ocr/lobby_extractors/row_grouping.py)
  sorts anchors by `y_center` and takes `position = anchor.text` per row; a relabel pass
  ([row_grouping.py:130-186](../../tools/game_ocr/game_ocr/lobby_extractors/row_grouping.py)) tries
  to fix out-of-tolerance anchors but does not reorder/re-verify the row list.
- [lobby_extractors/slot_identity.py:519-656](../../tools/game_ocr/game_ocr/lobby_extractors/slot_identity.py)
  then takes `position = row.position` directly with no Y re-verification.

The **loadout** path does it correctly: it builds a `PositionGrid` and looks up position by
Y-coordinate via `position_for_row_y`
([loadout_extractors/slot_identity.py:391-425](../../tools/game_ocr/game_ocr/loadout_extractors/slot_identity.py)),
which is why the loadout-derived lineup is right.

The scramble is baked into the stored rows; the worker promoter
([ocr-promoters/lobby-v2.ts](../../apps/worker/src/ocr-promoters/lobby-v2.ts)) faithfully writes
whatever slot the Python extractor assigned, so it cannot be repaired downstream — it needs
re-segmentation/re-extraction.

## Correction to the earlier "re-OCR ineffective" framing

The original quarantine note lumped this with match 2582 ("same frame-segmentation defect class,
re-OCR ineffective"). That is **wrong for match 250**: 2582 was un-re-ingestable because its source
video wasn't in the per-match layout and an unchanged decoder collided on provenance. Match 250's
source video **is** present in the expected layout (`/mnt/k/NHL/NHL26/match250/...`), and a
`DECODER_VERSION` bump ([tools/video_ingest/video_ingest/reprocess.py:47](../../tools/video_ingest/video_ingest/reprocess.py))
mints a distinct candidate run, avoiding the `(match_id, video_sha256, decoder_version,
weights_hash)` collision. So a fixed segmenter + re-ingest is feasible.

## Fix path (deferred)

1. Port the loadout grid-based `position_for_row_y` contract into the lobby extractor
   (`identify_lobby_subjects`): build a `PositionGrid` from detected anchors and re-look-up each
   row's position by Y instead of trusting `row.position` from the y-sorted anchor text.
2. Validate against the proving bench + match-250 fixtures.
3. Bump `DECODER_VERSION`, re-ingest match 250 (reprocess → validate → activate through the Tier 0
   quality gate → re-consolidate). This is the DB-mutating step; back up first.

Do not lower the V2 lobby field expectations to make these pass.
