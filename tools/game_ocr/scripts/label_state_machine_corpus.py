"""Operator-driven corpus expansion for the Phase 1 state machine.

Three modes:

1. `--from-segments` (the legacy default — kept for back-compat).
   Reads a Pass-1 segments.json (legacy or HMM), picks the top-N frames where
   the decoder was unconfident, ffmpeg-extracts each, opens it in the OS image
   viewer, and accepts a numeric label.

2. `--from-inbox <dir>` (Phase-A v2 path).
   Walks a directory of pre-extracted PNG candidates (produced by
   `bulk_extract_label_candidates.py`), opens each in the OS image viewer,
   and accepts a numeric label. No ffmpeg or segments.json needed.

3. `--counts` (no interactive labeling).
   Scans the extras dir and prints per-class label counts so the operator
   can see which classes are still below the target (e.g. 20-30 frames for
   the Phase-A proving phase, 100+ for the full Phase-B push).

Output: a labeled PNG written to tools/game_ocr/calibration/extras/ using the
existing naming convention `<state>__match<N>_t<T>_vs_<opp>.png`. Re-run
train_screen_classifier.py to fold the new labels into the weights artifact.

Usage:
    # Legacy: label from unknown-frames of an HMM segments.json
    python3 tools/game_ocr/scripts/label_state_machine_corpus.py \\
        --segments /tmp/vi-canonical/<sha>/segments.json \\
        --video /mnt/k/NHL/NHL26/<file>.mkv \\
        --match-id 250 --opp 4thline

    # Phase-A: label from bulk-extracted PNGs
    python3 tools/game_ocr/scripts/bulk_extract_label_candidates.py \\
        --root /mnt/k/NHL/NHL26 --interval 30
    python3 tools/game_ocr/scripts/label_state_machine_corpus.py \\
        --from-inbox tools/game_ocr/calibration/extras/_inbox

    # See per-class counts
    python3 tools/game_ocr/scripts/label_state_machine_corpus.py --counts
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

from game_ocr.state_machine import load_state_machine  # noqa: E402


def _slugify(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9]+", "-", (s or "").strip().lower()).strip("-")
    return out or "unknown"


def _open_image(path: Path) -> None:
    for opener in ("xdg-open", "wslview", "explorer.exe"):
        if shutil.which(opener):
            subprocess.Popen(
                [opener, str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return


def _extract_frame(video: Path, seconds: float, out_path: Path) -> bool:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-ss", str(seconds), "-i", str(video),
            "-frames:v", "1",
            "-vf", "scale=1920:1080",
            "-y", str(out_path),
        ],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and out_path.exists()


def _print_counts(extras_dir: Path, sm_states: list[str], target: int) -> None:
    """Scan extras/ for labeled PNGs (per the naming convention) and print
    per-class counts vs the target."""
    counts: dict[str, int] = {s: 0 for s in sm_states}
    unknown_labels: dict[str, int] = {}
    if extras_dir.is_dir():
        for png in extras_dir.glob("*.png"):
            # Filename: `<state>__match<N>_t<T>_vs_<opp>.png`
            parts = png.stem.split("__", 1)
            klass = parts[0] if parts else ""
            if klass in counts:
                counts[klass] += 1
            elif klass:
                unknown_labels[klass] = unknown_labels.get(klass, 0) + 1

    total = sum(counts.values())
    below_target = 0
    print(f"\n  state{' ' * 35} count  vs target ({target})")
    print(f"  {'-' * 67}")
    for s in sm_states:
        n = counts[s]
        bar = "[OK]" if n >= target else f"[need +{target - n}]"
        print(f"  {s:<40} {n:>4}   {bar}")
        if n < target:
            below_target += 1
    print(f"  {'-' * 67}")
    print(f"  total labeled: {total}  ({below_target}/{len(sm_states)} classes below target)")
    if unknown_labels:
        print(f"\n  warning: {sum(unknown_labels.values())} files with unrecognized class prefix:")
        for k, n in sorted(unknown_labels.items()):
            print(f"    {k!r}: {n}")


def _label_one_png(
    png: Path,
    sm_states: list[str],
    match_id: int | None,
    opp: str,
    seconds: int,
    extras_dir: Path,
    target_class: str | None,
    prompt_label: str,
) -> tuple[bool, bool]:
    """Open one PNG in the viewer, prompt for a numeric label, write to
    extras/. Returns (labeled, quit_requested).
    """
    _open_image(png)
    print(prompt_label)
    if target_class is not None:
        # Suggested guess shown when bulk extractor's manifest implies it.
        try:
            suggested_idx = sm_states.index(target_class)
            print(f"  suggested: {suggested_idx} ({target_class})")
        except ValueError:
            pass
    choice = input("  label: ").strip().lower()
    if choice == "q":
        return False, True
    if choice == "s" or not choice:
        return False, False
    try:
        idx = int(choice)
    except ValueError:
        print("  not a number, skip")
        return False, False
    if idx < 0 or idx >= len(sm_states):
        print(f"  index {idx} out of range, skip")
        return False, False
    klass = sm_states[idx]
    match_part = f"match{match_id}" if match_id else "match-unknown"
    out_name = f"{klass}__{match_part}_t{seconds}_vs_{_slugify(opp)}.png"
    out_path = extras_dir / out_name
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(png, out_path)
    print(f"  → saved {out_name}")
    return True, False


def _print_state_menu(sm_states: list[str]) -> None:
    print(f"\nState menu:")
    for i, s in enumerate(sm_states):
        print(f"  {i:>2}  {s}")
    print(f"   s   skip   q   quit\n")


def _run_from_segments(args: argparse.Namespace, sm_states: list[str]) -> int:
    """Legacy mode: read segments.json, ffmpeg-extract candidates, label."""
    data = json.loads(args.segments.read_text())
    fc = data.get("frame_classifications", [])
    if not fc:
        print("no frame_classifications in segments.json", file=sys.stderr)
        return 1

    candidates = [
        f for f in fc if f.get("screen_type") in ("unknown_screen", "unknown_or_transition")
    ]
    candidates.sort(key=lambda f: -float(f.get("color_score", 0.0)))
    candidates = candidates[: args.top_n]

    _print_state_menu(sm_states)

    tmp_dir = Path("/tmp/label-corpus-tmp")
    tmp_dir.mkdir(exist_ok=True)
    labeled = skipped = 0
    for i, f in enumerate(candidates, 1):
        seconds = int(float(f["seconds"]))
        tmp_png = tmp_dir / f"cand-{seconds:05d}.png"
        if not _extract_frame(args.video, float(seconds), tmp_png):
            print(f"[{i}/{len(candidates)}] ffmpeg failed; skip")
            continue
        anchor = (f.get("anchor_text") or "")[:80]
        prompt = f"[{i}/{len(candidates)}] t={seconds}s  anchor={anchor!r}"
        ok, quit_req = _label_one_png(
            tmp_png,
            sm_states,
            args.match_id,
            args.opp,
            seconds,
            args.extras_dir,
            target_class=None,
            prompt_label=prompt,
        )
        if ok:
            labeled += 1
        else:
            skipped += 1
        if quit_req:
            break

    print(f"\nlabeled={labeled} skipped={skipped}")
    if labeled:
        print("Run train_screen_classifier.py to fold new labels into weights.")
    return 0


_INBOX_FN_RE = re.compile(r"cand-t(\d+)\.png$")


def _run_from_inbox(args: argparse.Namespace, sm_states: list[str]) -> int:
    """Phase-A mode: read pre-extracted PNGs from `_inbox/<video_stem>/*.png`
    plus its manifest.json (if present). Optionally filter by target_class."""
    inbox = args.from_inbox.resolve()
    if not inbox.is_dir():
        print(f"--from-inbox {inbox}: not a directory", file=sys.stderr)
        return 1

    pngs: list[tuple[Path, int]] = []  # (path, seconds-from-filename)
    for sub in sorted(inbox.iterdir()):
        if not sub.is_dir():
            continue
        for png in sorted(sub.glob("cand-t*.png")):
            m = _INBOX_FN_RE.search(png.name)
            if m is None:
                continue
            pngs.append((png, int(m.group(1))))
    if not pngs:
        print(f"no cand-t*.png candidates found under {inbox}", file=sys.stderr)
        return 1

    print(f"[label] {len(pngs)} candidate(s) under {inbox.relative_to(REPO_ROOT)}")
    if args.target_class:
        if args.target_class not in sm_states:
            print(f"--target-class {args.target_class!r} not in state list", file=sys.stderr)
            return 2
        print(f"[label] suggested default: {args.target_class}")

    _print_state_menu(sm_states)

    labeled = skipped = 0
    for i, (png, seconds) in enumerate(pngs, 1):
        prompt = f"[{i}/{len(pngs)}] {png.parent.name}/{png.name}  t={seconds}s"
        ok, quit_req = _label_one_png(
            png,
            sm_states,
            args.match_id,
            args.opp,
            seconds,
            args.extras_dir,
            target_class=args.target_class,
            prompt_label=prompt,
        )
        if ok:
            labeled += 1
        else:
            skipped += 1
        if quit_req:
            break

    print(f"\nlabeled={labeled} skipped={skipped}")
    if labeled:
        print("Run train_screen_classifier.py to fold new labels into weights.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    # Mode selectors (mutually exclusive in practice; if multiple set, --counts
    # wins, then --from-inbox, then legacy --segments).
    ap.add_argument(
        "--counts",
        action="store_true",
        help="Print per-class label counts and exit (no interactive labeling).",
    )
    ap.add_argument(
        "--from-inbox",
        type=Path,
        default=None,
        help="Directory of pre-extracted PNG candidates (from bulk_extract_label_candidates.py).",
    )
    ap.add_argument(
        "--target-class",
        type=str,
        default=None,
        help="Show this class as the suggested default when labeling (Phase-A bulk-by-class pass).",
    )
    # Legacy --segments mode args (still required for that path)
    ap.add_argument("--segments", type=Path, default=None)
    ap.add_argument("--video", type=Path, default=None)
    ap.add_argument("--top-n", type=int, default=20)

    # Shared
    ap.add_argument("--version", default="nhl26")
    ap.add_argument("--match-id", type=int, default=None)
    ap.add_argument("--opp", default="unknown")
    ap.add_argument(
        "--extras-dir",
        type=Path,
        default=GAME_OCR / "calibration" / "extras",
    )
    ap.add_argument(
        "--target",
        type=int,
        default=30,
        help="Per-class target count for --counts (default 30 = Phase-A proving minimum).",
    )
    args = ap.parse_args()

    sm = load_state_machine(args.version)

    if args.counts:
        _print_counts(args.extras_dir, sm.states, args.target)
        return 0

    if args.from_inbox is not None:
        return _run_from_inbox(args, sm.states)

    # Legacy mode requires both --segments and --video.
    if args.segments is None or args.video is None:
        ap.error("legacy mode requires --segments and --video (or use --from-inbox / --counts)")
    return _run_from_segments(args, sm.states)


if __name__ == "__main__":
    sys.exit(main())
