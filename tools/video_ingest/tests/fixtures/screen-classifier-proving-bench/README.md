# Screen classifier v2 — proving bench fixture

Phase-A validation set. The S5 test
[test_screen_classifier_proving_bench.py](../../test_screen_classifier_proving_bench.py)
runs Pass-1 with the trained v2 weights and asserts per-frame
classification accuracy ≥ 90% on each clip listed in `labels.json`.

The bench's job is to **prove the minimum class split (`menu_world_of_chel`
plus tightened `player_loadout_view` and `pre_game_lobby_state_2`) actually
stops bad frames from reaching typed extractors**. If the bench passes AND
existing regression tests on matches 250/463 hold, Phase A is done.

> **Sparse-class deferral.** S5 only added `menu_world_of_chel` to the
> state machine; `menu_club_management` (3 PNGs) and `player_loadout_landing`
> (0 PNGs) are deferred until a future labeling round produces ~15-20 PNGs
> each. The proving-bench test treats those two labels as _relaxed_: a
> frame labeled `menu_club_management` or `player_loadout_landing` passes
> the gate when prediction matches OR when prediction is
> `unknown_or_transition`. See `labels.json`'s `deferred_classes_relaxed`.

## Current bench state — S5.5 prep (2026-05-27)

| Clip                            | Status                             | Frames | Notes                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match-250-lobby-loadout` (60s) | **labeled, gated**                 | 60     | Auto-converted from the existing match-250-clip-segments.json (hand-labeled 2026-05-13). First proving-bench run measured **66.7% accuracy** — below the 90% bar. See "v2 quality findings" below. |
| `match-968-menu-sequence` (60s) | **clip extracted, labels pending** | 60     | Operator must label per the workflow in `labels.json._operator_workflow`.                                                                                                                          |
| `match-967-misc`                | not extracted (optional)           | —      | Plan calls for ~30s cross-match coverage; skip until needed.                                                                                                                                       |

## v2 quality findings (S5.5 prep diagnostic on match-250)

Three distinct failure modes from the first end-to-end bench run (20 of
60 frames misclassified):

1. **First lobby segment (t=7..15s) → `unknown_or_transition`.** The same
   `pre_game_lobby_state_2` screen at t=29..50s classifies correctly. The
   early-frame failure is likely an interaction between the Viterbi initial
   prior (`unknown_or_transition: -1.0` strongly favored) and the
   `pre_game_lobby_state_2` minimum-duration enforcement (2.0s). The
   "GAME STARTS IN" countdown text in the early lobby may also produce
   different feature signals than the later (same-overlay) lobby.

2. **WORLD OF CHEL splash (t=51..52s) → `loading_or_intro`.** The
   `menu_world_of_chel.title` regex prior didn't fire — likely the
   splash's stylized text isn't OCR'd cleanly. The classifier defaulted
   to `loading_or_intro` based on visual similarity. Investigate: check
   the OCR output on those frames; consider expanding the regex to
   tolerate spacing/casing variants of the title.

3. **Post-game leaderboard (t=53..59s) → `loading_or_intro`.** The
   leaderboard reads "SEASON 4 ELITE CUP CHAMPIONS" — the
   `loading_or_intro` anchor `season` matches. The post-game leaderboard
   is OOD (no dedicated state), but it should not anchor into
   `loading_or_intro`. Fix: tighten `loading_or_intro` anchors (drop
   bare `season`; require `\bnow\s+loading\b` only, or add a more
   specific phrase).

Next session: tune the v2 model + anchors against this clip until ≥ 90%,
then label match-968 + run the full bench.

## Required clips

## Required clips

Authoritative source: `/home/michal/.claude/plans/multi-session-strategic-fix-for-misty-hamster.md`.
3-5 clips, 10-30 seconds each, covering:

1. **Match 968 first minute** — the original failure case. CLUB → PLAYER
   LOADOUTS → loadout-detail → WORLD OF CHEL sequence.
   Source: `/mnt/k/NHL/NHL26/match 968/2026-05-22_17-21-34.mkv` at t=0..60s.

2. **Real pre-game lobby** — two team panels visible + matchmaking
   countdown. Verifies legitimate lobby detection doesn't regress.
   Source: any video with a clean state_2 capture (TBD by operator).

3. **Loadout-detail alone** — HOME/AWAY left-strip + single-player right
   pane. Verifies the tightened `player_loadout_view` detection.

4. **Cross-match neighbor (optional)** — a clip from match 967 or 969 to
   confirm the fixes generalize beyond match 968's specific session.

## File layout

```
screen-classifier-proving-bench/
├── README.md                       (this file)
├── labels.json                     (frame-by-frame ground truth — manual)
├── clip-1-match968-menu-sequence.mkv
├── clip-2-real-lobby.mkv
├── clip-3-loadout-detail.mkv
└── clip-4-cross-match.mkv          (optional)
```

`labels.json` format (one entry per clip):

```jsonc
{
  "version": "v0.1",
  "fps": 1.0, // labels assume 1 fps sampling
  "clips": [
    {
      "filename": "clip-1-match968-menu-sequence.mkv",
      "description": "Match 968 first 60s: CLUB→loadouts→detail→splash",
      "labels": [
        // One entry per sampled frame (or one entry per run-length segment)
        { "t_start_sec": 0, "t_end_sec": 11, "expected": "menu_club_management" },
        { "t_start_sec": 11, "t_end_sec": 33, "expected": "player_loadout_landing" },
        { "t_start_sec": 33, "t_end_sec": 47, "expected": "player_loadout_view" },
        { "t_start_sec": 47, "t_end_sec": 57, "expected": "menu_world_of_chel" },
      ],
    },
    // ...
  ],
}
```

Hand-curate `labels.json` from a 1 fps walk through each clip. The bench's
acceptance threshold is ≥ 90% per-frame match — leaving a few mis-labeled
frames at transitional boundaries is fine.

## How clips are produced

The clips are short ffmpeg extracts from the source videos under
`/mnt/k/NHL/NHL26/`. Example for clip 1:

```bash
ffmpeg -ss 0 -t 60 -i "/mnt/k/NHL/NHL26/match 968/2026-05-22_17-21-34.mkv" \
    -c copy -y clip-1-match968-menu-sequence.mkv
```

Clips check into git directly (they're small — 60s at low-ish bitrate is
a few hundred KB to a few MB; check before adding).

## Versioning

Bumping the bench is a structural change; the S5 test name and accuracy
thresholds are tied to `v0.1`. Append v0.2 etc. to `labels.json.version`
when ground-truth labels change.
