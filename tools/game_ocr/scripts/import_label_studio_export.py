"""Convert a Label Studio JSON export into the trainer's filename convention.

Reads the JSON export from the screen-classifier-v2 project, walks each
labeled task, and copies the source PNG from `_inbox/<video_stem>/cand-tN.png`
into `tools/game_ocr/calibration/extras/<class>__match<N>_t<T>_vs_<opp>.png`.

The trainer ([train_screen_classifier.py]) walks `extras/` and pulls the
class label from the filename prefix.

Usage:
    python3 tools/game_ocr/scripts/import_label_studio_export.py path/to/export.json
    # dry-run (preview without copying):
    python3 tools/game_ocr/scripts/import_label_studio_export.py path/to/export.json --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
INBOX_DIR = GAME_OCR / "calibration" / "extras" / "_inbox"
EXTRAS_DIR = GAME_OCR / "calibration" / "extras"

# Video-stem → (match_id, opp) when we know it. Stem is the directory name
# under _inbox/. Update when the bulk extractor ingests new matches.
KNOWN_MATCHES: dict[str, tuple[int, str]] = {
    "2026-05-08_18-25-42": (250, "4thline"),
    "2026-05-11_18-17-06": (463, "thickooze"),
    "silkyjoker85_NHL26XboxSeriesXS_20260512_00-45-27": (463, "thickooze"),
    "2026-05-22_16-41-18": (967, "unknown"),
    "2026-05-22_17-21-34": (968, "unknown"),
}

# Filenames look like `cand-tNNNNN.png` — the `NNNNN` is seconds-into-video.
_FN_RE = re.compile(r"cand-t(\d+)\.png$")


def _parse_image_path(image_url: str) -> Path | None:
    """LS exports `data.image` as e.g.
    '/data/local-files/?d=inbox/2026-05-22_17-21-34/cand-t01230.png'.
    The `d=` value is relative to LOCAL_FILES_DOCUMENT_ROOT (which we set to
    /label-studio/files), but the bind-mounted host inbox is one level
    deeper at /label-studio/files/inbox. Strip the leading "inbox/" segment
    so the result is relative to the host's _inbox/ directory.
    """
    parsed = urlparse(image_url)
    qs = parsed.query
    if not qs.startswith("d="):
        # Fallback: maybe it's a direct URL — try the path portion.
        candidate = unquote(parsed.path).lstrip("/")
        if candidate.startswith("data/local-files/"):
            return None
        return Path(candidate) if candidate else None
    rel = unquote(qs[2:])
    if "?" in rel:
        rel = rel.split("?", 1)[0]
    # Strip the LOCAL_FILES_DOCUMENT_ROOT-relative "inbox/" prefix.
    if rel.startswith("inbox/"):
        rel = rel[len("inbox/"):]
    return Path(rel)


def _extract_class(annotations: list[dict]) -> str | None:
    """Return the chosen class from the first non-cancelled annotation.

    LS annotation shape:
      {"result": [{"value": {"choices": ["menu_club_management"]}, ...}], ...}
    """
    for ann in annotations:
        if ann.get("was_cancelled"):
            continue
        for r in ann.get("result", []):
            if r.get("type") != "choices":
                continue
            choices = r.get("value", {}).get("choices", [])
            if choices:
                return str(choices[0])
    return None


def _slug_opp(opp: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", opp.lower()).strip("-") or "unknown"


def _outname(klass: str, match_id: int | None, seconds: int, opp: str) -> str:
    mp = f"match{match_id}" if match_id else "match-unknown"
    return f"{klass}__{mp}_t{seconds}_vs_{_slug_opp(opp)}.png"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("export", type=Path, help="Label Studio JSON export file.")
    ap.add_argument("--dry-run", action="store_true", help="Preview, don't copy.")
    ap.add_argument(
        "--extras-dir",
        type=Path,
        default=EXTRAS_DIR,
        help=f"Destination dir (default: {EXTRAS_DIR.relative_to(REPO_ROOT)}).",
    )
    args = ap.parse_args()

    if not args.export.is_file():
        print(f"error: export file not found: {args.export}", file=sys.stderr)
        return 2

    data = json.loads(args.export.read_text())
    if not isinstance(data, list):
        print(f"error: expected a JSON list of tasks, got {type(data).__name__}", file=sys.stderr)
        return 2

    args.extras_dir.mkdir(parents=True, exist_ok=True)

    n_copied = n_skipped_unlabeled = n_skipped_missing = n_skipped_unparseable = 0
    per_class: dict[str, int] = {}

    for task in data:
        annotations = task.get("annotations", [])
        klass = _extract_class(annotations)
        if klass is None:
            n_skipped_unlabeled += 1
            continue

        image_url = task.get("data", {}).get("image", "")
        rel = _parse_image_path(image_url)
        if rel is None:
            print(f"warn: could not parse image url {image_url!r}", file=sys.stderr)
            n_skipped_unparseable += 1
            continue

        src = INBOX_DIR / rel
        if not src.is_file():
            print(f"warn: source PNG not found: {src}", file=sys.stderr)
            n_skipped_missing += 1
            continue

        m = _FN_RE.search(src.name)
        seconds = int(m.group(1)) if m else 0

        stem = src.parent.name
        match_id, opp = KNOWN_MATCHES.get(stem, (None, "unknown"))

        dst_name = _outname(klass, match_id, seconds, opp)
        dst = args.extras_dir / dst_name

        action = "would copy" if args.dry_run else "copy"
        print(f"[{action}] {src.relative_to(REPO_ROOT)} → extras/{dst_name}")
        if not args.dry_run:
            shutil.copy2(src, dst)
        per_class[klass] = per_class.get(klass, 0) + 1
        n_copied += 1

    print("")
    print(f"copied={n_copied}  skipped_unlabeled={n_skipped_unlabeled}  "
          f"skipped_missing={n_skipped_missing}  skipped_unparseable={n_skipped_unparseable}")
    if per_class:
        print("per-class:")
        for k, n in sorted(per_class.items(), key=lambda x: -x[1]):
            print(f"  {k:<40} {n:>3}")
    if not args.dry_run and n_copied:
        print("\nRun --counts to verify the targets:")
        print("  python3 tools/game_ocr/scripts/label_state_machine_corpus.py \\")
        print("      --counts --target 30 \\")
        print("      --extra-states menu_club_management,player_loadout_landing,menu_world_of_chel")
    return 0


if __name__ == "__main__":
    sys.exit(main())
