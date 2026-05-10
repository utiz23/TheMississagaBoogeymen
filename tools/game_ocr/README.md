# Game Data OCR

`game-ocr` is a screenshot-first CLI for extracting structured data from fixed-layout NHL menu and postgame screens.

## Run

```bash
python3 -m game_ocr.cli extract \
  --screen pre_game_lobby_state_1 \
  --input "ScreenShots/Pre-Game Lobby State 1.png" \
  --output /tmp/pre_game_state_1.json
```

Supported screens:
- `pre_game_lobby_state_1`
- `pre_game_lobby_state_2`
- `player_loadout_view`
- `post_game_player_summary`

## Add a New Screen

1. Add a ROI config under `game_ocr/configs/roi/<screen_type>.yaml`.
2. Add a parser function in `game_ocr/parsers.py`.
3. Register the screen in `game_ocr/extractor.py`.
4. Add at least one smoke test or parser test under `tests/`.

The app expects stable screen layouts. If the UI shifts, fix the ROI YAML before touching parser code.
