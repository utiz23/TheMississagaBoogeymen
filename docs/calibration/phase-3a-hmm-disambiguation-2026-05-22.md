# Phase 3a — HMM Disambiguation: Diagnostic Findings (NO ACTION NEEDED)

**Status:** Phase 3a as originally planned is closed without changes. The diagnostic data does not support the premise that `pre_game_lobby_state_1` frames are being mis-routed to `player_loadout_view`. The HMM/Viterbi classifier is doing its job on every recording inspected.

## Premise

The Phase 2B handoff (`docs/calibration/phase-2b-deferred-to-phase-3-2026-05-22.md`) and the regression-floor snapshots for matches 250 + 463 both show zero `pre_game_lobby_state_1` segments. The premise of Phase 3a was that state_1 ("class state" — build_class + position + h/w + level per player in a grid) was being absorbed into `player_loadout_view`, and an anchor-list patch would recover those frames.

## Method

Built [tools/game_ocr/scripts/diagnose_segments.py](../../tools/game_ocr/scripts/diagnose_segments.py) (Task 1, commit `62a4ee2`) — per-frame TSV dump of classifier signals, anchor flags, log-probs for `pre_game_lobby_state_1`, `_state_2`, and `player_loadout_view`, plus the production Viterbi screen_type from segments.json. Ran it against three recordings:

1. **Match 250** — frames 0-89 (pre-game window).
2. **Match 463** — full 59-frame recording.
3. **New clip** `2026-05-20_18-15-59.mkv` — first 180 frames (no segments.json; classifier-only signal).

## Findings

### What `pre_game_lobby_state_1` actually represents

The YAML defines its anchors as `[finding opponent, stay in div]` — i.e. the **matchmaking** screen, not the post-matchmaking class-state grid. In none of the three recordings does the operator's video dwell on a "FINDING OPPONENT" screen long enough to leave traces; instead the recordings begin from the EASHL menu dashboard (`PLAY LOADOUTS CLUBS CUSTOMIZE SEASON PASS STORE REWARDS STATS`) which is correctly rejected to `unknown_or_transition` via `reject_anchor_substrings` (`customize / seasonpass / rewards`).

### What the deferred-doc description maps to

The Phase 2B deferred doc described the lobby READY-UP screen as a "4-line block per player: gamertag / build_class+position / h/w / level". That content is observed in the diagnostic TSVs exclusively inside `player_loadout_view` frames — it's the right-pane detail card of the selected player on the loadouts navigation screen, **not** a separate state_1 grid. There is no third pre-game screen distinct from `state_2` and the loadout-detail view in the recordings inspected.

### Classifier behavior per recording

| Match | Lobby state_2 | Loadout view | State_1 frames | Misrouted |
|---|---|---|---|---|
| 250 (frames 0-89) | 39 (✓ clean — anchor `eashl 6v6`) | 13 (✓ clean — anchor `playerloadouts`) | 0 | none |
| 463 (full 59 frames) | 17 (✓ clean) | 26 (✓ clean) | 0 | none |
| new clip 2026-05-20 (frames 0-180) | 45 (✓ clean) | 14 (✓ clean) | 0 | none |

In every recording, `anchor_text` containing `eashl` correctly fires the state_2 anchor; `playerloadouts` correctly fires the loadout-view anchor. Classifier log-prob margins on confident frames:
- `lp[state_2] - lp[loadout] ≈ +2.4` nats on state_2 frames (state_2 winning by a comfortable margin)
- `lp[loadout] - lp[state_2] ≈ +1.4` nats on loadout frames (loadout winning)

These margins are large enough that no anchor patch is needed.

### Note on `post_game_faceoff_map` noise

The new-clip TSV shows ~100 frames classified as `post_game_faceoff_map` despite the sampled window being mid-game. Anchor text on those frames is empty; the HSV-histogram classifier alone is assigning that screen type to blank/transitional frames. This matches the known chronic misclassification documented in the regression floors (match 250 records 1576 faceoff_map frames with 1531 OCR errors). It's a separate issue from lobby/loadout disambiguation and is out of scope here.

## Conclusion

No anchor patch, no LR retrain, no regression test changes. The state machine + classifier are correctly handling the screens that actually appear in operator recordings. The "state_1 = 0 frames everywhere" observation is consistent with the operator's recordings simply not containing the matchmaking screen that state_1 was defined to capture.

`pre_game_lobby_state_1` could be removed from the state machine in a future cleanup pass, or repurposed if NHL 27 introduces a screen the current ontology doesn't model. Neither is urgent.

## Implications for Phase 3b

The real bottleneck blocking complete lineup data is the `pre_game_lobby_state_2` parser, not routing. Per [pre-game-extraction-research.md](../ocr/pre-game-extraction-research.md), the existing `_parse_lobby_row` produces concatenated-text garbage in `player_loadout_snapshots` rows it writes. Lobby segments **are** being detected (174 frames in match 250, 145 in match 463 per the regression floors) — they're just being parsed poorly.

Phase 3b (typed lobby extractor rebuild) should proceed with this in mind: the input data is available; the work is in the parser, not the segmenter.

## Artifacts

- Diagnostic script: [tools/game_ocr/scripts/diagnose_segments.py](../../tools/game_ocr/scripts/diagnose_segments.py)
- Test: [tools/game_ocr/tests/test_diagnose_segments.py](../../tools/game_ocr/tests/test_diagnose_segments.py)
- Per-frame TSVs (gitignored): `tools/game_ocr/diagnostics/phase-3a/match250.tsv`, `match463.tsv`, `newclip-20260520-1815.tsv`
- Plan file: `/home/michal/.claude/plans/plan-the-phase-3a-virtual-swan.md`
