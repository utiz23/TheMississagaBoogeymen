"""Phase 2B-1: Operator crop-labeling CLI for the closed-vocab LR training corpus.

Walks PNG fixtures from the canonical loadout fixture directory AND any
user-supplied source directory.  For each PNG, extracts one or more image
crops from the known loadout regions, presents a numbered menu of canonical
names from the YAML dictionary, and saves the labeled crop to the corpus
directory.

Saved corpus path:
    tools/game_ocr/calibration/extras/loadout/crops/<family>/<canonical>/<stem>_<slot>.png

Usage
-----
# Label build_class crops from canonical fixtures:
    python tools/game_ocr/scripts/label_loadout_crops.py --family build_class

# Label x_factor_name crops from a match-250 run directory:
    python tools/game_ocr/scripts/label_loadout_crops.py \\
        --family x_factor_name \\
        --source /tmp/typed-v1-match250/.../pass2/seg-002-player_loadout_view

# Dry-run (no saves, prints what would happen):
    python tools/game_ocr/scripts/label_loadout_crops.py --family build_class --dry-run

Interactive keys
----------------
    1-N  : pick canonical label N
    s    : skip this crop
    q    : quit immediately
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

from game_ocr.loadout_extractors.closed_vocab import load_closed_vocab  # noqa: E402

# ---------------------------------------------------------------------------
# Canonical fixture root
# ---------------------------------------------------------------------------
FIXTURE_ROOT = GAME_OCR / "calibration" / "extras" / "loadout" / "fixtures"
CORPUS_ROOT = GAME_OCR / "calibration" / "extras" / "loadout" / "crops"

# ---------------------------------------------------------------------------
# Mapping from user-facing family name to the YAML file name used by
# load_closed_vocab().  The YAML files use plural forms (build_classes,
# x_factors), but the CLI exposes shorter singular keys for ergonomics.
# ---------------------------------------------------------------------------
FAMILY_TO_YAML: dict[str, str] = {
    "build_class": "build_classes",
    "x_factor_name": "x_factors",
}

# ---------------------------------------------------------------------------
# Image-region definitions per family
# ---------------------------------------------------------------------------
# build_class:  title bar strip — y=[110,175], x=[400,1100]
# x_factor_name: three icon-label strips below each X-Factor icon.
#
# X-Factor icon centroids from parsers.py:
#   _LOADOUT_XFACTOR_ICON_CENTROIDS = [(500, 340), (1000, 340), (1500, 340)]
#   Labels appear in the band ~60-90px below the X-FACTORS header (y≈254),
#   so the text label is at approximately y ∈ [314, 344] for each slot.
#   Validated from parsers.py lines 925-945.
#
# Each slot gets its own crop: slot 0 (cx=500), slot 1 (cx=1000), slot 2 (cx=1500).
# Crop width: ±200 px around cx; label height band: y=[305, 360].

FAMILY_REGIONS: dict[str, list[dict]] = {
    "build_class": [
        {
            "slot": 0,  # single region, no slot index needed for build_class
            "y1": 110,
            "y2": 175,
            "x1": 400,
            "x2": 1100,
            "label": "title_bar",
        },
    ],
    "x_factor_name": [
        # Slot 0: left icon at cx=500
        {
            "slot": 0,
            "y1": 305,
            "y2": 365,
            "x1": 300,
            "x2": 700,
            "label": "xf_slot0",
        },
        # Slot 1: center icon at cx=1000
        {
            "slot": 1,
            "y1": 305,
            "y2": 365,
            "x1": 800,
            "x2": 1200,
            "label": "xf_slot1",
        },
        # Slot 2: right icon at cx=1500
        {
            "slot": 2,
            "y1": 305,
            "y2": 365,
            "x1": 1300,
            "x2": 1700,
            "label": "xf_slot2",
        },
    ],
}


def _extract_crop(image_bgr: np.ndarray, region: dict) -> np.ndarray:
    """Extract a crop from a full-frame BGR image using the region dict."""
    h, w = image_bgr.shape[:2]
    y1 = max(0, region["y1"])
    y2 = min(h, region["y2"])
    x1 = max(0, region["x1"])
    x2 = min(w, region["x2"])
    return image_bgr[y1:y2, x1:x2].copy()


def _is_loadout_relevant_path(png_path: Path) -> bool:
    """True if the PNG path belongs to a player_loadout_view segment.

    Used to filter the source PNG queue so the labeler doesn't sweep in
    1000+ PNGs from non-loadout segments (post_game_*, etc.) when the
    operator passes --source pointing at a top-level Pass-2 output root.

    A path is loadout-relevant if any directory component contains
    `player_loadout_view` OR if it lives in a `frames` subdir of a fixture.
    """
    parts = [p.lower() for p in png_path.parts]
    if any("player_loadout_view" in p for p in parts):
        return True
    # Fixture convention: <fixture_name>/frames/<file>.png — the parent dir is `frames`
    if png_path.parent.name.lower() == "frames":
        return True
    return False


def _collect_pngs(*dirs: Path) -> list[Path]:
    """Walk one or more directories for .png files (non-recursive-flat)."""
    found: list[Path] = []
    for d in dirs:
        if not d.exists():
            continue
        for p in sorted(d.iterdir()):
            if p.is_file() and p.suffix.lower() == ".png":
                found.append(p)
            elif p.is_dir():
                # Walk one level down (frames/ subdirectory)
                for sub in sorted(p.rglob("*.png")):
                    found.append(sub)
    # Deduplicate while preserving order
    seen: set[Path] = set()
    deduped: list[Path] = []
    for p in found:
        if p not in seen:
            seen.add(p)
            deduped.append(p)
    return deduped


def _corpus_save_path(
    corpus_root: Path,
    family: str,
    canonical: str,
    source_stem: str,
    region_label: str,
) -> Path:
    """Return the target save path for a labeled crop."""
    return corpus_root / family / canonical / f"{source_stem}_{region_label}.png"


def _already_labeled(corpus_root: Path, family: str, source_stem: str, region_label: str) -> bool:
    """Return True if this (source, region) pair has already been labeled (any canonical)."""
    suffix = f"{source_stem}_{region_label}.png"
    family_root = corpus_root / family
    if not family_root.exists():
        return False
    for canon_dir in family_root.iterdir():
        if (canon_dir / suffix).exists():
            return True
    return False


def _resolve_live_view_path() -> Path:
    """Pick the best path for the live-view file.

    Windows Photos auto-refreshes reliably ONLY on local Windows files; on
    WSL UNC paths (\\wsl.localhost\\Ubuntu\\tmp\\*) the file watcher is
    flaky and Photos doesn't reload on overwrite.

    Order of preference:
      1. /mnt/c/Users/<user>/labelcrop-current.png   (writable Windows home)
      2. /tmp/labelcrop-current.png                  (fallback)
    """
    import os
    candidates_root = Path("/mnt/c/Users")
    if candidates_root.exists():
        # Prefer the env's USER if it matches a Windows user, else first non-system user
        for candidate in (os.environ.get("USER", ""), os.environ.get("USERNAME", "")):
            if candidate and (candidates_root / candidate).is_dir():
                target = candidates_root / candidate / "labelcrop-current.png"
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    return target
                except (OSError, PermissionError):
                    pass
        # Try to discover any usable user dir
        for child in candidates_root.iterdir():
            if child.is_dir() and child.name.lower() not in {"all users", "default", "default user", "public"}:
                target = child / "labelcrop-current.png"
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    # Write-test
                    target.touch()
                    return target
                except (OSError, PermissionError):
                    continue
    return Path("/tmp/labelcrop-current.png")


_LIVE_VIEW_PATH = _resolve_live_view_path()
# Per-family blank-crop stddev thresholds.
#
# Crops with pixel stddev below the threshold are considered "empty/transitional"
# and auto-skipped (no operator prompt).
#
# Calibration from match-250:
#   build_class title bar (large white text on black): std=113 when rendered,
#     std=54 during avatar-bleed pre-render frames. Threshold 80 cleanly separates.
#   x_factor_name (small white text next to colored icon): std=58-72 when rendered,
#     std<25 during pre-render. Threshold 40 cleanly separates.
_BLANK_STDDEV_THRESHOLDS: dict[str, float] = {
    "build_class": 80.0,
    "x_factor_name": 40.0,
}


def _crop_is_blank(crop: np.ndarray, family: str) -> bool:
    """True if the crop is empty, transitional, or showing pre-render content.

    Uses pixel stddev as the "is there content" heuristic. The threshold is
    calibrated per family because X-Factor label crops (small text on small
    region) have legitimately lower contrast than title-bar crops (large text
    on large region).
    """
    if crop.size == 0:
        return True
    threshold = _BLANK_STDDEV_THRESHOLDS.get(family, 80.0)
    return float(crop.std()) < threshold


def _show_crop_info(crop: np.ndarray, tmp_path: Path) -> None:
    """Save crop to a temp file + live-view file for operator inspection.

    The live-view file at /tmp/labelcrop-current.png is overwritten each
    prompt; the operator opens it ONCE in their image viewer and that
    viewer refreshes on file change.
    """
    cv2.imwrite(str(tmp_path), crop)
    cv2.imwrite(str(_LIVE_VIEW_PATH), crop)


def _wsl_windows_path(linux_path: Path) -> str:
    """Convert a Linux path to a Windows-readable UNC path via wslpath."""
    import subprocess
    try:
        result = subprocess.run(
            ["wslpath", "-w", str(linux_path)],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return str(linux_path)


def _print_viewer_instructions() -> None:
    """Print one-line instructions for opening the live-view file.

    We don't auto-launch — that opened multiple Photos windows on retry and
    didn't reliably refresh on file change. The operator opens the file
    manually ONCE; Windows Photos auto-refreshes when the file is overwritten.
    """
    import shutil
    win_path = _wsl_windows_path(_LIVE_VIEW_PATH) if shutil.which("wslpath") else str(_LIVE_VIEW_PATH)
    print("─" * 72)
    print(f"  Live crop preview file:")
    print(f"    Linux  : {_LIVE_VIEW_PATH}")
    print(f"    Windows: {win_path}")
    print(f"  Open the Windows path ONCE in your default image viewer (Photos).")
    print(f"  It refreshes automatically as you label each crop.")
    print(f"  Tip: blank/black crops (transitional frames) auto-skip — keep typing.")
    print("─" * 72)


def _present_menu(canonical_names: list[str]) -> None:
    """Print the numbered canonical-name menu."""
    for i, name in enumerate(canonical_names, start=1):
        print(f"  {i:>3}. {name}")
    print("  [s=skip, q=quit]")


def _prompt_operator(prompt: str) -> str:
    """Read one line from stdin, stripping whitespace."""
    try:
        return input(prompt).strip().lower()
    except EOFError:
        return "q"


def label_crops(
    family: str,
    *,
    extra_sources: list[Path],
    dry_run: bool = False,
    corpus_root: Path = CORPUS_ROOT,
) -> int:
    """Main labeling loop.  Returns number of crops saved."""
    yaml_family = FAMILY_TO_YAML.get(family, family)
    vocab = load_closed_vocab(yaml_family)
    canonical_names = [e.canonical for e in vocab.entries]

    # Collect source PNGs, then filter to player_loadout_view segments only.
    # Without the filter, --source /tmp/typed-v1-match250/ pulls in 1000+ PNGs
    # from 56 unrelated segment dirs.
    #
    # When the operator passes an explicit --source, we DO NOT also walk the
    # fixture frames — that would double-count the same PNGs (operator usually
    # points --source at the same data the fixtures hold). Use --source alone
    # for production data; omit it to label the committed fixture frames.
    if extra_sources:
        raw_pngs = _collect_pngs(*extra_sources)
    else:
        fixture_dirs = list(FIXTURE_ROOT.glob("*/frames")) + list(FIXTURE_ROOT.glob("*/seg_*/frames"))
        raw_pngs = _collect_pngs(*fixture_dirs)
    all_pngs = [p for p in raw_pngs if _is_loadout_relevant_path(p)]
    if extra_sources and not all_pngs:
        print(f"warn: no player_loadout_view PNGs found under {[str(s) for s in extra_sources]}", file=sys.stderr)
        print(f"      (filter looks for paths containing 'player_loadout_view' or under 'frames/' dirs)", file=sys.stderr)

    regions = FAMILY_REGIONS.get(family)
    if not regions:
        print(f"error: no region definition for family {family!r}. "
              f"Available: {sorted(FAMILY_REGIONS)}", file=sys.stderr)
        return 0

    # Build the queue: (png_path, region) pairs that are not yet labeled
    queue: list[tuple[Path, dict]] = []
    for png_path in all_pngs:
        stem = png_path.stem
        for region in regions:
            label_key = region["label"]
            if not _already_labeled(corpus_root, family, stem, label_key):
                queue.append((png_path, region))

    total = len(queue)
    if total == 0:
        print("Nothing to label — all crops already in corpus.")
        return 0

    print(f"\nFamily: {family}  |  {total} unlabeled crop(s) to process")
    print(f"Corpus: {corpus_root / family}")
    if not dry_run:
        _print_viewer_instructions()
    print()
    _present_menu(canonical_names)
    print()

    saved = 0
    skipped = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_crop_path = Path(tmpdir) / "current_crop.png"

        for idx, (png_path, region) in enumerate(queue, start=1):
            img = cv2.imread(str(png_path))
            if img is None:
                print(f"  warn: cv2.imread failed for {png_path}, skipping", file=sys.stderr)
                continue

            crop = _extract_crop(img, region)
            if crop.size == 0:
                continue

            stem = png_path.stem
            region_label = region["label"]

            # Auto-skip blank/transitional crops (UI not yet rendered, etc.)
            if _crop_is_blank(crop, family):
                print(f"[{idx}/{total}] {stem} / {region_label} — blank crop, auto-skipped")
                skipped += 1
                continue

            _show_crop_info(crop, tmp_crop_path)

            choice = _prompt_operator(
                f"[{idx}/{total}] {stem} / {region_label} — label (1-N, s=skip, q=quit) + Enter > "
            )

            if choice == "q":
                print("Quit.")
                break
            elif choice == "s":
                skipped += 1
                print("  skipped.")
                continue

            # Numeric choice
            try:
                choice_int = int(choice)
                if not (1 <= choice_int <= len(canonical_names)):
                    raise ValueError
                canonical = canonical_names[choice_int - 1]
            except ValueError:
                print(f"  invalid input {choice!r}, skipping.")
                skipped += 1
                continue

            dest = _corpus_save_path(corpus_root, family, canonical, stem, region_label)
            if dry_run:
                print(f"  [dry-run] would save → {dest}")
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(dest), crop)
                print(f"  saved → {dest}")
            saved += 1

    print(f"\nDone. Saved: {saved}  Skipped: {skipped}  Remaining unlabeled: {total - saved - skipped}")
    return saved


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Operator crop-labeling CLI for the closed-vocab LR training corpus.",
    )
    ap.add_argument(
        "--family",
        required=True,
        choices=list(FAMILY_REGIONS),
        help="Closed-vocab family to label.",
    )
    ap.add_argument(
        "--source",
        action="append",
        dest="sources",
        metavar="DIR",
        default=[],
        help="Additional directory to walk for PNG frames (may be repeated).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be saved without writing to disk.",
    )
    ap.add_argument(
        "--corpus-root",
        type=Path,
        default=CORPUS_ROOT,
        help=f"Corpus output root (default: {CORPUS_ROOT}).",
    )
    args = ap.parse_args()

    extra_sources = [Path(s) for s in args.sources]
    label_crops(
        args.family,
        extra_sources=extra_sources,
        dry_run=args.dry_run,
        corpus_root=args.corpus_root,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
