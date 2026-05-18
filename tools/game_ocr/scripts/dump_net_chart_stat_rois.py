"""Dump per-cell ROI crops + a labeled overlay for the post_game_net_chart screen.

Diagnostic for tuning the 14 `stats_<shot_type>_<side>` ROIs in
`tools/game_ocr/game_ocr/configs/roi/post_game_net_chart.yaml`. Run against
one of the canonical Net-Chart frames and visually inspect the overlay to
confirm each ROI tightly contains exactly one numeric cell with margin.

Usage:
    python3 tools/game_ocr/scripts/dump_net_chart_stat_rois.py \\
        --image research/OCR-SS/Action-Tracker/Net-Chart/<frame>.png \\
        [--output-dir /tmp/net-chart-rois/]

Outputs into <output-dir>:
    stats_<shot>_<side>.png               raw color crop, no preprocess
    stats_<shot>_<side>_preprocessed.png  what the OCR backend actually sees
    _overlay.png                          full source frame with each ROI
                                          outlined in red and labeled

Stdout: per-ROI OCR readout so misread `g`/`6`/etc. cases are visible
without opening every crop.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2

from game_ocr.config import load_screen_config
from game_ocr.image import crop_region, load_image, preprocess_image
from game_ocr.ocr import RapidOCRBackend


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, type=Path, help="Source PNG to crop.")
    parser.add_argument(
        "--screen-type",
        default="post_game_net_chart",
        help="Screen type (default: post_game_net_chart).",
    )
    parser.add_argument(
        "--output-dir",
        default=Path("/tmp/net-chart-rois"),
        type=Path,
        help="Where to write stats_*.png + _overlay.png (default: /tmp/net-chart-rois).",
    )
    args = parser.parse_args()

    if not args.image.is_file():
        raise SystemExit(f"--image not found: {args.image}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    config = load_screen_config(args.screen_type)
    image = load_image(str(args.image))
    height, width = image.shape[:2]
    backend = RapidOCRBackend()

    stat_regions = [
        (name, region)
        for name, region in config.regions.items()
        if name.startswith("stats_") and name != "stats_panel"
    ]
    if not stat_regions:
        raise SystemExit(
            f"No stats_<shot>_<side> regions found in {args.screen_type}.yaml"
        )

    print(f"Loaded image: {args.image} ({width}x{height})")
    print(f"Found {len(stat_regions)} per-cell regions. Writing to {args.output_dir}/")

    overlay = image.copy()

    for name, region in stat_regions:
        crop = crop_region(image, region)
        crop_h, crop_w = crop.shape[:2]
        raw_path = args.output_dir / f"{name}.png"
        cv2.imwrite(str(raw_path), crop)

        processed = preprocess_image(crop, region.preprocess)
        if processed.ndim == 2:
            processed_bgr = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR)
        else:
            processed_bgr = processed
        pp_path = args.output_dir / f"{name}_preprocessed.png"
        cv2.imwrite(str(pp_path), processed_bgr)

        lines = backend.read(processed)
        raw_text = " ".join(l.text for l in lines)
        confidences = [round(float(l.confidence), 2) for l in lines]
        print(
            f"  {name:<32}  raw={raw_text!r:<8}  conf={confidences}  "
            f"crop={crop_w}x{crop_h}"
        )

        # Draw the ROI rectangle on the overlay (full-frame pixel coords).
        x1 = int(region.x * width)
        y1 = int(region.y * height)
        x2 = int((region.x + region.width) * width)
        y2 = int((region.y + region.height) * height)
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 255), 2)
        label_y = max(y1 - 6, 14)
        cv2.putText(
            overlay,
            name.replace("stats_", "").replace("_shots", ""),
            (x1 + 2, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.40,
            (0, 0, 255),
            1,
            cv2.LINE_AA,
        )

    overlay_path = args.output_dir / "_overlay.png"
    cv2.imwrite(str(overlay_path), overlay)
    print(f"Wrote overlay: {overlay_path}")


if __name__ == "__main__":
    main()
