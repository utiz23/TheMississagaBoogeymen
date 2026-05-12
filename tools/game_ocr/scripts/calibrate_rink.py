"""Visual sanity-check helper for rink calibration.

Usage:
    python3 -m tools.game_ocr.scripts.calibrate_rink \\
        path/to/screenshot.png \\
        --screen post_game_action_tracker \\
        --output /tmp/calibration_check.png

Loads the calibration JSON for the given screen type, draws the rink_pixel_box
and reference points on top of the input image, and saves the result. Use this
to bootstrap calibration values or to verify that the game UI hasn't shifted
between game updates.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

# Allow running this script directly: add tools/game_ocr/ to sys.path.
_THIS = Path(__file__).resolve()
_GAME_OCR_DIR = _THIS.parent.parent
sys.path.insert(0, str(_GAME_OCR_DIR))

from game_ocr.image import load_image  # noqa: E402
from game_ocr.spatial import (  # noqa: E402
    detect_rink_markers,
    extract_selected_event_position,
    load_rink_calibration,
)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("image", help="Path to a sample screenshot")
    p.add_argument(
        "--screen",
        default="post_game_action_tracker",
        help="Screen type (matches configs/rink/<screen>.json)",
    )
    p.add_argument(
        "--output", default="/tmp/calibration_check.png", help="Output overlay image"
    )
    args = p.parse_args()

    cal = load_rink_calibration(args.screen)
    img = load_image(args.image)

    print(f"Image: {Path(args.image).name}  ({img.shape[1]}x{img.shape[0]})")
    print(f"Calibration: {cal.screen_type}")
    print(f"  rink_pixel_box: {cal.rink_pixel_box}")
    print(f"  bgm_attacks: {cal.bgm_attacks}")
    print(f"  reference_points: {cal.reference_points}")

    overlay = img.copy()
    box = cal.rink_pixel_box
    cv2.rectangle(overlay, (box.x1, box.y1), (box.x2, box.y2), (0, 255, 0), 2)
    cv2.line(
        overlay,
        (int(box.center_x), box.y1),
        (int(box.center_x), box.y2),
        (0, 255, 0),
        1,
    )
    cv2.line(
        overlay,
        (box.x1, int(box.center_y)),
        (box.x2, int(box.center_y)),
        (0, 255, 0),
        1,
    )

    for name, (x, y) in cal.reference_points.items():
        cv2.drawMarker(overlay, (x, y), (255, 255, 0), cv2.MARKER_CROSS, 20, 2)
        cv2.putText(
            overlay,
            name,
            (x + 10, y - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 0),
            1,
            cv2.LINE_AA,
        )

    markers = detect_rink_markers(img, cal)
    for m in markers:
        if m.color == "yellow":
            color = (0, 255, 255)
            radius = 18
        elif m.color == "red":
            color = (0, 0, 255)
            radius = 12
        else:
            color = (255, 255, 255)
            radius = 12
        cv2.circle(overlay, (int(m.pixel_x), int(m.pixel_y)), radius, color, 2)

    result = extract_selected_event_position(img, cal)
    coord = result.selected_coordinate
    summary_lines = [
        f"markers detected: {result.detected_marker_count}",
        f"yellow markers: {result.yellow_marker_count}",
    ]
    if coord is not None:
        summary_lines.append(
            f"selected: x={coord.x:+.2f} y={coord.y:+.2f} zone={coord.rink_zone}"
        )
    else:
        summary_lines.append("selected: <none>")
    if result.warnings:
        summary_lines.append("warnings: " + "; ".join(result.warnings))

    for i, line in enumerate(summary_lines):
        cv2.putText(
            overlay,
            line,
            (20, 30 + 24 * i),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), overlay)
    print()
    for line in summary_lines:
        print(f"  {line}")
    print(f"\nWrote overlay: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
