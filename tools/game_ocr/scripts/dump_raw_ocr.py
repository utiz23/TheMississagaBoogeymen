"""Dump raw RapidOCR output on full-frame captures.

For diagnostic use against the pre-game parser failure modes. Prints each
detected text line with its bbox + confidence so we can see exactly what
the OCR backend returns BEFORE any ROI clipping or parser logic.

Optionally re-runs against the ROIs defined in the screen's YAML config.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml
from rapidocr_onnxruntime import RapidOCR

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
ROI_DIR = REPO_ROOT / 'tools/game_ocr/game_ocr/configs/roi'


def load_roi(screen_type: str) -> dict:
    p = ROI_DIR / f'{screen_type}.yaml'
    return yaml.safe_load(p.read_text())


def run_ocr_on_full(image_path: Path, engine: RapidOCR) -> list[dict]:
    img = cv2.imread(str(image_path))
    if img is None:
        raise SystemExit(f'failed to load {image_path}')
    result, _ = engine(img)
    lines = []
    if result:
        for box, text, confidence in result:
            xs = [pt[0] for pt in box]
            ys = [pt[1] for pt in box]
            lines.append({
                'text': text,
                'confidence': round(float(confidence), 3),
                'x1': int(min(xs)),
                'y1': int(min(ys)),
                'x2': int(max(xs)),
                'y2': int(max(ys)),
                'xcenter': int((min(xs) + max(xs)) / 2),
                'ycenter': int((min(ys) + max(ys)) / 2),
            })
    lines.sort(key=lambda r: (r['ycenter'], r['x1']))
    return lines


def run_ocr_on_rois(image_path: Path, engine: RapidOCR, roi_cfg: dict) -> dict:
    img = cv2.imread(str(image_path))
    h, w = img.shape[:2]
    out = {}
    for name, region in roi_cfg.get('regions', {}).items():
        rx = int(region['x'] * w)
        ry = int(region['y'] * h)
        rw = int(region['width'] * w)
        rh = int(region['height'] * h)
        crop = img[ry:ry + rh, rx:rx + rw]
        result, _ = engine(crop)
        lines = []
        if result:
            for box, text, confidence in result:
                xs = [pt[0] for pt in box]
                ys = [pt[1] for pt in box]
                lines.append({
                    'text': text,
                    'confidence': round(float(confidence), 3),
                    'rel_x1': int(min(xs)),
                    'rel_y1': int(min(ys)),
                    'rel_x2': int(max(xs)),
                    'rel_y2': int(max(ys)),
                })
        out[name] = {
            'roi_px': [rx, ry, rx + rw, ry + rh],
            'lines': sorted(lines, key=lambda r: (r['rel_y1'], r['rel_x1'])),
        }
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--image', required=True, help='Path to a 1920x1080 capture')
    p.add_argument('--mode', choices=['full', 'roi', 'both'], default='both')
    p.add_argument('--screen-type', help='Screen type for ROI mode (e.g. player_loadout_view)')
    p.add_argument('--output', help='Write JSON to this path instead of stdout')
    args = p.parse_args()

    engine = RapidOCR()
    image_path = Path(args.image)
    if not image_path.is_absolute():
        image_path = REPO_ROOT / image_path

    out = {'image': str(image_path), 'mode': args.mode}
    if args.mode in ('full', 'both'):
        out['full'] = run_ocr_on_full(image_path, engine)
    if args.mode in ('roi', 'both'):
        if not args.screen_type:
            print('--screen-type required for roi/both', file=sys.stderr)
            return 1
        roi_cfg = load_roi(args.screen_type)
        out['roi'] = run_ocr_on_rois(image_path, engine, roi_cfg)

    text = json.dumps(out, indent=2)
    if args.output:
        Path(args.output).write_text(text + '\n')
        print(f'Wrote {args.output}', file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
