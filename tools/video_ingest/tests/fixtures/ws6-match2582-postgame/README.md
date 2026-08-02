# WS6 evidence bundle — match 2582 post-game (classifier blocker)

Durable artifacts from the WS6 real-match validation pass (2026-06-01). WS6 **stopped at the Phase-1
gate**: the v2 screen classifier classifies **every post-game screen as `unknown_or_transition`** (one as
`player_loadout_view`), so the video pipeline extracts **zero** post-game data (events / positions / box
score / action tracker). Full writeup: [`docs/ocr/ws6-real-match-validation-findings.md`](../../../../../docs/ocr/ws6-real-match-validation-findings.md).

This bundle exists so the **post-game-classifier fix** workstream + the WS6 re-run don't have to recreate
the evidence (especially the 40-minute Pass-1 classification).

## Source recording (retained — do NOT delete)

- **Path:** `K:\2026-05-31_16-09-36.mkv` (WSL `/mnt/k/2026-05-31_16-09-36.mkv`)
- **sha256:** `967ed784eb64a1c99326565412d8facf49a541ea453fcb4b9c1ae2152aceed2f`
- **Format:** 2084.9 s, 1920×1080, h264 60 fps, 868 MB
- **Match:** 2582 (BGM 3–2 Roc River Rats, OT win; `ea_match_id 20570598020124`)

## The blocker in one table

OCR reads the disambiguating text correctly on every post-game frame, but the classifier assigns the
wrong class. (`anchor_text` + assigned class are from `segments-gate-off.json`.)

| Source time | Screen (observed)                      | OCR `anchor_text` (read correctly)               | Pass-1 assigned                       | Correct class                                  |
| ----------- | -------------------------------------- | ------------------------------------------------ | ------------------------------------- | ---------------------------------------------- |
| 1832–1883 s | game→post transition / black           | (sparse)                                         | unknown_or_transition                 | (transition) — ok                              |
| 1884–1900 s | End-of-Game team summary               | `…playersummary endofgame`                       | unknown_or_transition                 | post_game_player_summary / end                 |
| 1902–1945 s | **Action Tracker** (1st→OT filters)    | `rm rr allevents rt {1st/2nd/3rd/ot} period 3-2` | unknown_or_transition                 | **post_game_action_tracker**                   |
| 1947 s      | Faceoff map                            | `rm rr faceoff rt 1st period 3-2`                | unknown_or_transition                 | post_game_faceoff_map                          |
| 1953–1957 s | Net chart                              | `rm rr netchart rt … period 3-2`                 | unknown_or_transition                 | post_game_net_chart                            |
| 1959–1965 s | Player summary / end-of-game           | `…playersummary endofgame`                       | unknown_or_transition                 | post_game_player_summary                       |
| 1967–1971 s | **Box Score** (goal/shot/faceoff tabs) | `lt goalsummary / shotsummary / faceoffsummary`  | unknown_or_transition                 | **post*game_box_score*{goals,shots,faceoffs}** |
| 1972–1978 s | **Scoring Summary** ("ALL")            | `lt all`                                         | **player_loadout_view** ❌ (misroute) | post_game_events                               |
| ~1985 s     | black fade transition                  | (none)                                           | unknown_or_transition                 | (fade — WS2 gate candidate)                    |
| 2001–2079 s | WoC lobby return                       | —                                                | loading_or_intro                      | ~ok                                            |

Pre-game lobby (73–121 s) + loadout (86–108 s) and in-game (160–1832 s) classify **correctly**. Only the
post-game screens fail. `color_score = 0.0` across the dark post-game UI is the suspected trigger (color
features starved; anchor priors don't override the reject floor) — to be confirmed in the diagnosis step.

## Contents

- `segments-gate-off.json` — **the expensive artifact**: full Pass-1 classification of the whole recording
  (2085 frames → 65 segments, ~40 min GPU, gate-OFF / `--no-pass1-gate`). Carries per-frame `screen_type`,
  `anchor_text`, `color_score`, canonical `source_time_seconds`. Re-use this instead of re-classifying.
- `ingest-timings.json` — Pass-1 timing sidecar for the same run.
- `frames/canonical/*.png` — **decode-accurate** stills (seek-after-input) of each distinct post-game
  screen, named `t<sec>_<screen>.png`. The reference evidence for the diagnosis + the bench arm.
- `frames/strip/*.jpg` — the working 1875–1985 s strip (fast-seek JPGs) showing the scroll/filter states
  read during hand-keying (e.g. Action Tracker per-period, Scoring Summary scroll).

## Regenerating the post-game clip (for the future proving-bench arm)

A clip was intentionally **not** committed (≈45 MB; trivially regenerable from the retained source). To
build the bench-arm clip, keyframe-copy the post-game window:

```bash
ffmpeg -ss 1868 -i /mnt/k/2026-05-31_16-09-36.mkv -t 120 -c copy -map 0:v:0 -map 0:a:0 \
  clip-match2582-postgame.mkv
```

`-ss` before `-i` with `-c copy` = fast keyframe seek preserving PTS (same method as the existing
`screen-classifier-proving-bench` clips). The window 1868–1988 s covers End-of-Game → Action Tracker →
Faceoff/Net → Box Score → Scoring Summary → the black fade.

## How the next workstream uses this

1. **Diagnose** (read-only): walk `segments-gate-off.json` over 1884–1979 s; for each frame compare the
   fired anchor/regex priors vs the classifier log-probs vs the reject floor. Determine whether the
   post-game text priors are (a) not wired to force the class, (b) wired but out-voted by the
   color/reject path on `color_score=0`, or (c) absent from the trained weights. (Use
   `diagnose_segments.py` / `diagnose_v2_proving_bench.py`.)
2. **Bench arm:** extract the clip (above), hand-label its post-game seconds against the canonical PNGs
   here, and add a `post_game` clip to `tools/video_ingest/tests/fixtures/screen-classifier-proving-bench/`
   so the proving bench finally covers post-game (it never has — the gap that let this ship).
3. **Fix/retrain**, re-run the bench (both pre-game and the new post-game arm green).
4. **Re-run WS6** on this same recording: mapping is already confirmed (match 2582), the EA box score is
   the authoritative gamertag-level truth, and §8 of the findings doc has a partial event/lineup scaffold.
