#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from common import ManifestRow, VIDEO_EXTENSIONS, normalize_title_slug, write_manifest


def infer_row(path: Path) -> ManifestRow:
    title_slug = normalize_title_slug(str(path))
    stem = path.stem
    parts = [part.strip() for part in stem.split("__") if part.strip()]

    gamertag = parts[1] if len(parts) > 1 else ""
    game_mode = parts[2] if len(parts) > 2 else ""
    position_scope = parts[3] if len(parts) > 3 else ""

    source_game_mode_label = "CAREER EASHL 6V6" if game_mode == "6s" else ""
    source_position_label = position_scope.replace("_", " ").upper() if position_scope else ""

    return ManifestRow(
        title_slug=title_slug,
        gamertag=gamertag,
        game_mode=game_mode,
        position_scope=position_scope,
        role_group="skater",
        source_game_mode_label=source_game_mode_label,
        source_position_label=source_position_label,
        asset_path=str(path.resolve()),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Inventory historical stat videos into a manifest.")
    parser.add_argument("input_root", type=Path, help="Directory containing historical stat videos.")
    parser.add_argument("output_csv", type=Path, help="Where to write the starter manifest CSV.")
    args = parser.parse_args()

    rows: list[ManifestRow] = []
    for path in sorted(args.input_root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        rows.append(infer_row(path))

    if not rows:
        raise SystemExit(f"No video files found under {args.input_root}")

    write_manifest(args.output_csv, rows)
    print(f"Wrote {len(rows)} rows to {args.output_csv}")


if __name__ == "__main__":
    main()
