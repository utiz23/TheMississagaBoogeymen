# Pending — box-score shots/faceoffs tab fixtures

## Status (Phase 1 commit)

Both `post_game_box_score_shots` and `post_game_box_score_faceoffs` are now
covered by corpus fixtures extracted from the match 250 recording (VLC
snapshots taken 2026-05-10 from the 2026-05-08_18-25-42.mkv recording):

- `post_game_box_score_shots__match250_t7708_vs_4thline.png`
- `post_game_box_score_faceoffs__match250_t7712_vs_4thline.png`

The classifier was retrained and now covers **16 of 17 states**.

Missing states after Phase 1 retraining:

```
missing states (using fallback intercept): ['end_of_video']
```

`end_of_video` is a deliberate sentinel state — it is never expected in a
real recording and intentionally uses `MISSING_STATE_INTERCEPT = -10.0`.
No fixture is needed for it.

## Phase 1 T3 acceptance gate

The gate ("at least one `post_game_box_score_shots` segment and one
`post_game_box_score_faceoffs` segment in `ocr_segments` for matches where
the operator navigated those tabs") is now **verifiable** — the classifier
has real signal for both states.

The state machine YAML already encodes both states; `anchor_substrings`
(`shot summary` / `faceoff summary`) provide a secondary surface path even
if the classifier score is marginal.

## If additional fixtures are needed in the future

When the next operator captures a recording that tabs through Shot Summary /
Faceoff Summary on a different match:

```bash
python3 tools/game_ocr/scripts/label_state_machine_corpus.py \
  --segments /tmp/vi-canonical/<sha>/segments.json \
  --video /mnt/k/NHL/NHL26/<file>.mkv \
  --match-id <N> --opp <slug>

python3 tools/game_ocr/scripts/train_screen_classifier.py --version nhl26
```

Then commit the resulting fixtures and updated weights JSON.
