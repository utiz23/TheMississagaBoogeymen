# Screen classifier v2 — proving bench fixture

Phase-A validation set. The S5 test
`test_screen_classifier_proving_bench.py` (built in the A2 session) runs
Pass-1 with the freshly-trained v2 weights and asserts per-frame
classification accuracy ≥ 90% on each clip listed in `labels.json`.

The bench's job is to **prove the minimum class split (`menu_club_management`,
`player_loadout_landing`, `menu_world_of_chel`, plus tightened
`player_loadout_view` and `pre_game_lobby_state_2`) actually stops bad
frames from reaching typed extractors**. If the bench passes AND existing
regression tests on matches 250/463 hold, Phase A is done.

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
  "fps": 1.0,                       // labels assume 1 fps sampling
  "clips": [
    {
      "filename": "clip-1-match968-menu-sequence.mkv",
      "description": "Match 968 first 60s: CLUB→loadouts→detail→splash",
      "labels": [
        // One entry per sampled frame (or one entry per run-length segment)
        { "t_start_sec": 0,   "t_end_sec": 11,  "expected": "menu_club_management" },
        { "t_start_sec": 11,  "t_end_sec": 33,  "expected": "player_loadout_landing" },
        { "t_start_sec": 33,  "t_end_sec": 47,  "expected": "player_loadout_view" },
        { "t_start_sec": 47,  "t_end_sec": 57,  "expected": "menu_world_of_chel" }
      ]
    }
    // ...
  ]
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
