"""Dump per-dot ROI crops + a labeled overlay for the post_game_faceoff_map screen.

Diagnostic for tuning the 9 `dot_*` ROIs in
`tools/game_ocr/game_ocr/configs/roi/post_game_faceoff_map.yaml`. Run against
one of the reference frames and visually inspect the crops to confirm each
ROI fully covers its red (away) + dark (home) flag pair.

Usage:
    python3 tools/game_ocr/scripts/dump_faceoff_dot_rois.py \
        --image research/OCR-SS/Action-Tracker/Faceoff-Map/<frame>.png \
        [--output-dir /tmp/faceoff-dot-rois/]

Outputs into <output-dir>:
    dot_<id>.png               raw color crop, no preprocess
    dot_<id>_preprocessed.png  same crop after invert-threshold (what OCR sees)
    _overlay.png               full source frame with each dot ROI outlined
                               in red and labeled

Stdout: per-ROI summary with detected glyph bboxes for cross-reference.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from game_ocr.config import load_screen_config
from game_ocr.image import crop_region, load_image, preprocess_image
from game_ocr.ocr import RapidOCRBackend


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, type=Path, help="Source PNG to crop.")
    parser.add_argument(
        "--screen-type",
        default="post_game_faceoff_map",
        help="Screen type (default: post_game_faceoff_map).",
    )
    parser.add_argument(
        "--output-dir",
        default=Path("/tmp/faceoff-dot-rois"),
        type=Path,
        help="Where to write dot_*.png + _overlay.png (default: /tmp/faceoff-dot-rois).",
    )
    args = parser.parse_args()

    if not args.image.is_file():
        raise SystemExit(f"--image not found: {args.image}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    config = load_screen_config(args.screen_type)
    image = load_image(str(args.image))
    height, width = image.shape[:2]
    backend = RapidOCRBackend()

    # Pull dot_* regions (works for both the legacy single-ROI naming
    # `dot_<id>` and the post-color-split naming `dot_<id>_away` /
    # `dot_<id>_home`).
    dot_regions = [
        (name, region)
        for name, region in config.regions.items()
        if name.startswith("dot_")
    ]
    if not dot_regions:
        raise SystemExit(f"No dot_* regions found in {args.screen_type}.yaml")

    print(f"Loaded image: {args.image} ({width}x{height})")
    print(f"Found {len(dot_regions)} dot_* regions. Writing to {args.output_dir}/")

    overlay = image.copy()

    for name, region in dot_regions:
        crop = crop_region(image, region)
        crop_h, crop_w = crop.shape[:2]
        raw_path = args.output_dir / f"{name}.png"
        cv2.imwrite(str(raw_path), crop)

        # Preprocess what the parser actually sees.
        processed = preprocess_image(crop, region.preprocess)
        if processed.ndim == 2:
            processed_bgr = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR)
        else:
            processed_bgr = processed
        pp_path = args.output_dir / f"{name}_preprocessed.png"
        cv2.imwrite(str(pp_path), processed_bgr)

        # Run OCR on the processed crop so we know what RapidOCR sees.
        lines = backend.read(processed)
        raw_text = " ".join(l.text for l in lines)
        x_centers = [int(l.x_center) for l in lines]
        confidences = [round(float(l.confidence), 2) for l in lines]
        print(
            f"  {name:<10}  raw={raw_text!r:<24}  conf={confidences}  "
            f"x_centers={x_centers}  crop={crop_w}x{crop_h}  ocr_w={crop_w * 2}"
        )

        # Draw the ROI rectangle on the overlay (full-frame pixel coords).
        x1 = int(region.x * width)
        y1 = int(region.y * height)
        x2 = int((region.x + region.width) * width)
        y2 = int((region.y + region.height) * height)
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 255), 2)
        # Label slightly above the box; clamp to frame.
        label_y = max(y1 - 6, 14)
        cv2.putText(
            overlay,
            name.replace("dot_", ""),
            (x1 + 2, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 0, 255),
            1,
            cv2.LINE_AA,
        )

    overlay_path = args.output_dir / "_overlay.png"
    cv2.imwrite(str(overlay_path), overlay)
    print(f"Wrote overlay: {overlay_path}")


if __name__ == "__main__":
    main()
