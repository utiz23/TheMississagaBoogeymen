"""Overlay rink-calibration landmarks onto an Action-Tracker screenshot.

For one input image, draws:
  - the `rink_pixel_box` rectangle (yellow) — what the calibration treats as
    the playable area between the boards
  - the three calibration `reference_points` (cyan dots labelled CENTRE,
    BL-LEFT, BL-RIGHT) — what the calibration says is centre ice and the
    blue lines
  - any CVAT-labelled selected_marker for this image (red dot, labelled CVAT)
  - reverse-projected NHL-standard landmarks (magenta crosses, labelled with
    the hockey-standard (x, y) they were derived from): centre dot, end-zone
    faceoff dots at (±69, ±22), neutral-zone faceoff dots at (±20, ±22)

If the magenta crosses land on the actual in-game faceoff dots, the
calibration is correct. If they're systematically off, the `rink_pixel_box`
needs adjustment.

Usage:
  python3 tools/game_ocr/scripts/verify_rink_calibration.py \\
    --image research/OCR-SS/Action-Tracker/OT-Events/vlcsnap-2026-05-10-01h51m37s739.png \\
    --xml /tmp/cvat-export/annotations.xml \\
    --output /tmp/rink-debug.png

Defaults: picks the first CVAT-annotated image and writes /tmp/rink-debug.png.
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CALIB_PATH = REPO_ROOT / 'tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json'

# BGR colour tuples for cv2.
YELLOW = (0, 255, 255)
CYAN = (255, 255, 0)
RED = (0, 0, 255)
MAGENTA = (255, 0, 255)
WHITE = (255, 255, 255)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', help='Absolute path to source screenshot. Defaults to the first labelled image.')
    parser.add_argument(
        '--xml',
        default='/tmp/cvat-export/annotations.xml',
        help='CVAT annotations.xml export',
    )
    parser.add_argument('--output', default='/tmp/rink-debug.png')
    parser.add_argument(
        '--crop',
        action='store_true',
        help='Crop the output to just the rink region for visual clarity.',
    )
    parser.add_argument(
        '--box',
        help='Override rink_pixel_box. Format: "x1,y1,x2,y2" e.g. "960,382,1793,832".',
    )
    args = parser.parse_args()

    calib = json.loads(CALIB_PATH.read_text())
    box = calib['rink_pixel_box']
    if args.box:
        parts = [int(p.strip()) for p in args.box.split(',')]
        if len(parts) != 4:
            print('--box must be x1,y1,x2,y2', file=sys.stderr)
            return 2
        box = {'x1': parts[0], 'y1': parts[1], 'x2': parts[2], 'y2': parts[3]}
        print(f'Override rink_pixel_box → {box}', file=sys.stderr)
    half_w_px = (box['x2'] - box['x1']) / 2
    half_h_px = (box['y2'] - box['y1']) / 2
    cx = (box['x1'] + box['x2']) / 2
    cy = (box['y1'] + box['y2']) / 2
    mirror = -1.0 if calib.get('bgm_attacks') == 'left' else 1.0

    # Load CVAT XML to find label for the chosen image.
    xml_path = Path(args.xml)
    tree = ET.parse(xml_path)
    image_node = None
    if args.image is None:
        # Find the first annotated image in the export.
        for image in tree.findall('.//image'):
            if image.find('points') is not None:
                image_node = image
                break
        if image_node is None:
            print('No annotated images found in CVAT export', file=sys.stderr)
            return 1
        name = image_node.get('name') or ''
        # Search likely folders.
        candidates = list(
            Path('/mnt/k/NHL/NHL26/OCR-SS/Action-Tracker').rglob(name)
        ) + list(Path(REPO_ROOT, 'research/OCR-SS/Action-Tracker').rglob(name))
        if not candidates:
            print(f'Could not locate image file {name}', file=sys.stderr)
            return 1
        image_path = candidates[0]
    else:
        image_path = Path(args.image)
        name = image_path.name
        for image in tree.findall(".//image"):
            if image.get('name') == name:
                image_node = image
                break

    print(f'Using image: {image_path}', file=sys.stderr)

    img = cv2.imread(str(image_path))
    if img is None:
        print(f'Failed to load image {image_path}', file=sys.stderr)
        return 1
    h, w = img.shape[:2]
    print(f'Image: {w}x{h}', file=sys.stderr)

    # 1) rink_pixel_box outline
    cv2.rectangle(img, (box['x1'], box['y1']), (box['x2'], box['y2']), YELLOW, 2)
    cv2.putText(img, 'rink_pixel_box', (box['x1'] + 5, box['y1'] + 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, YELLOW, 1, cv2.LINE_AA)

    # 2) calibration reference_points (what calibration claims they are)
    refs = calib.get('reference_points', {})
    for label, key in (('CENTRE', 'center_ice'), ('BL-LEFT', 'blue_line_left'), ('BL-RIGHT', 'blue_line_right')):
        if key not in refs:
            continue
        px, py = int(refs[key]['x']), int(refs[key]['y'])
        cv2.circle(img, (px, py), 6, CYAN, 2)
        cv2.putText(img, label, (px + 8, py + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, CYAN, 1, cv2.LINE_AA)

    # 3) reverse-projected NHL-standard landmarks (where the math predicts they should sit)
    def hockey_to_pixel(x_h: float, y_h: float) -> tuple[int, int]:
        x_norm = (mirror * x_h) / 100.0
        y_norm = -y_h / 42.5
        return int(cx + x_norm * half_w_px), int(cy + y_norm * half_h_px)

    nhl_points = [
        ('CENTRE (0,0)', 0.0, 0.0),
        ('BL-L (-25,0)', -25.0, 0.0),
        ('BL-R (+25,0)', 25.0, 0.0),
        ('NZ-FO (-20,-22)', -20.0, -22.0),
        ('NZ-FO (-20,+22)', -20.0, 22.0),
        ('NZ-FO (+20,-22)', 20.0, -22.0),
        ('NZ-FO (+20,+22)', 20.0, 22.0),
        ('EZ-FO (-69,-22)', -69.0, -22.0),
        ('EZ-FO (-69,+22)', -69.0, 22.0),
        ('EZ-FO (+69,-22)', 69.0, -22.0),
        ('EZ-FO (+69,+22)', 69.0, 22.0),
        ('GOAL-L (-89,0)', -89.0, 0.0),
        ('GOAL-R (+89,0)', 89.0, 0.0),
    ]
    for label, x_h, y_h in nhl_points:
        px, py = hockey_to_pixel(x_h, y_h)
        cv2.drawMarker(img, (px, py), MAGENTA, cv2.MARKER_CROSS, 16, 2)
        cv2.putText(img, label, (px + 10, py - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, MAGENTA, 1, cv2.LINE_AA)

    # 4) CVAT label for this image, if any
    if image_node is not None:
        point_el = image_node.find('points')
        if point_el is not None:
            pts = point_el.get('points') or ''
            if ',' in pts:
                px_s, py_s = pts.split(',')
                lpx, lpy = int(float(px_s)), int(float(py_s))
                cv2.circle(img, (lpx, lpy), 10, RED, 2)
                # what hockey coord does this map to?
                x_norm = (lpx - cx) / half_w_px
                y_norm = (lpy - cy) / half_h_px
                x_h = round(mirror * x_norm * 100.0, 1)
                y_h = round(-y_norm * 42.5, 1)
                cv2.putText(
                    img,
                    f'CVAT label -> hockey ({x_h:+}, {y_h:+})',
                    (lpx + 12, lpy + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, RED, 1, cv2.LINE_AA,
                )

    # Legend
    pad = 10
    legend_y = h - 130
    cv2.rectangle(img, (pad, legend_y), (480, legend_y + 110), (24, 24, 24), -1)
    cv2.putText(img, 'YELLOW: rink_pixel_box', (pad + 6, legend_y + 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, YELLOW, 1, cv2.LINE_AA)
    cv2.putText(img, 'CYAN: calibration reference_points', (pad + 6, legend_y + 44),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, CYAN, 1, cv2.LINE_AA)
    cv2.putText(img, 'MAGENTA: math-predicted NHL landmarks', (pad + 6, legend_y + 66),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, MAGENTA, 1, cv2.LINE_AA)
    cv2.putText(img, 'RED: CVAT label for this image', (pad + 6, legend_y + 88),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, RED, 1, cv2.LINE_AA)

    if args.crop:
        # Crop to a tight margin around the rink_pixel_box.
        margin = 80
        crop_x1 = max(0, box['x1'] - margin)
        crop_y1 = max(0, box['y1'] - margin)
        crop_x2 = min(w, box['x2'] + margin)
        crop_y2 = min(h, box['y2'] + margin)
        cropped = img[crop_y1:crop_y2, crop_x1:crop_x2]
        # 2x upscale for legibility
        cropped = cv2.resize(
            cropped,
            (cropped.shape[1] * 2, cropped.shape[0] * 2),
            interpolation=cv2.INTER_LANCZOS4,
        )
        out = Path(args.output)
        cv2.imwrite(str(out), cropped)
    else:
        out = Path(args.output)
        cv2.imwrite(str(out), img)
    print(f'Wrote {out}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
