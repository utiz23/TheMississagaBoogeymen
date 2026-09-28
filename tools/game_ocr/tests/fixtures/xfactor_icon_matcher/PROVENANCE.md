# Fixture provenance — `xfactor_icon_matcher/`

Consumed by `tests/test_xfactor_icon_matcher.py::TestMatchIcon` (`GROUND_TRUTH`) —
pixel-accurate X-Factor perk icon template matching at fixed screen-space
centroids.

## Known

- All 3 files are `1920x1080` RGB PNG frames captured with VLC's
  "snapshot" feature — the filename format
  (`vlcsnap-YYYY-MM-DD-HHhMMmSSsMMMs.png`) is VLC's own auto-generated
  naming convention, giving a known capture timestamp of
  **2026-05-10, ~01:49 local time**.
- Ground-truth X-Factor perk labels for the fixed icon-slot centroids in
  each frame are hand-verified in
  `tests/test_xfactor_icon_matcher.py::GROUND_TRUTH`.
- Prior to this fix these files were real (non-symlinked) files under
  `research/OCR-SS/Pre-Game-Loadouts/`, a gitignored, untracked source
  tree. This directory copies those bytes; it does not modify, replace,
  or remove the original source files or directory.
- These are full 1920×1080 game screens; gamertags are not the focus of
  the cropped regions these tests read, but are present in the full
  frame, consistent with this repo's existing precedent of tracking
  unredacted gameplay captures (see the sibling
  `screen_classifier/PROVENANCE.md`).

## Not established

- This capture timestamp (2026-05-10) does **not** match the match-250
  canonical reference video's date (2026-05-08) — these frames are
  **not** confirmed to be match-250 frames. The exact source video file
  and match identity are not established in this investigation.

## Integrity

SHA-256 and pixel dimensions for every file here are pinned in
`tests/test_fixtures_integrity.py`'s manifest and checked on every
test run.
