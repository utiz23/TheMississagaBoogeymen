# Fixture provenance — `screen_classifier/`

Consumed by `tests/test_classifier.py` (`NAMED_FIXTURES`),
`tests/test_cli_smoke.py` (reuses `Pre-Game Lobby State 1.png`), and
`tests/test_frame_pipeline_v2.py::TestRealRapidOCR` (reuses
`Player Loadout View.png`, opt-in via `RUN_CLASSIFIER_E2E=1`).

## Known

- All 9 files are `1920x1080` RGB PNG frames of specific, named NHL 26
  in-game screens — the filename identifies the screen type, matching
  the expected classifier label asserted against it in
  `test_classifier.py::NAMED_FIXTURES`.
- Prior to this fix they existed only as symlinks under
  `tools/game_ocr/ScreenShots/`, resolving into a separate, non-repo
  local project directory (`Game_Data_OCR`) on the maintainer's
  machine. This directory copies the real bytes those symlinks pointed
  to; it does not modify, replace, or remove the original symlinks or
  source tree.
- Several of these frames (loadout/lobby/summary/box-score screens)
  show real player gamertags, visible and **intentionally unredacted**,
  consistent with existing tracked fixtures elsewhere in this repo that
  already carry real, unredacted gamertags (e.g.
  `tools/game_ocr/calibration/extras/loadout/fixtures/fixture_match250_full_lobby/PROVENANCE.md`,
  `research/OCR-SS/Manual OCR benchmark match 968.md`). This was an
  explicit operator decision for this fixture set, not an inference
  from precedent alone.

## Not established

- The original capture tool, exact capture date, and source
  video/match identity for these 9 files are not recorded anywhere
  this investigation found, and are not asserted here.

## Integrity

SHA-256 and pixel dimensions for every file here are pinned in
`tests/test_fixtures_integrity.py`'s manifest and checked on every
test run.
