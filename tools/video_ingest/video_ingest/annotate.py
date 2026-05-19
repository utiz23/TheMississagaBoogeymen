"""Annotate ambiguous frames from a Pass-1 segments.json.

Operator-confirmed fixture-corpus growth tool (Phase 3 v0 per
`docs/calibration/phase-5-plan-2026-05-19.md`).

Strategy (intentionally minimal — External review §3 said the proposed
5-min/match budget was already aspirational; this v0 strips active-learning
ranking to one criterion):

  1. Read segments.json's `frame_classifications`.
  2. Pick the top-N frames where the HSV color vote (`color_class`) was
     a specific screen type but the anchor-text gate demoted the frame to
     `unknown_screen`. These are the candidates the classifier *almost*
     accepted — the highest-information frames for corpus growth.
  3. For each candidate, extract the source frame as PNG via ffmpeg at
     1 fps (matching Pass-1's sampling cadence).
  4. Prompt the operator with a one-line summary + open the PNG via
     xdg-open. Accept a single-letter response:
        c   confirm the classifier was right (frame is junk / unknown)
        1-8 relabel as one of the 8 screen types listed in the prompt
        s   skip (ambiguous; don't include in corpus)
        q   quit
  5. For each relabel, save the PNG into the existing convention:
     `tools/game_ocr/calibration/extras/<class>__match<id>_t<seconds>_<opp>.png`

No labels manifest, no eval split, no DVC. Those land when corpus growth
proves the need (Phase-5-plan §"Things we explicitly are NOT doing").
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional

import typer

from video_ingest.pass1_classify import (
    UNKNOWN_SCREEN,
)


CLASS_KEYS = {
    "1": "pre_game_lobby_state_2",
    "2": "player_loadout_view",
    "3": "post_game_action_tracker",
    "4": "post_game_player_summary",
    "5": "post_game_events",
    "6": "post_game_box_score_goals",
    "7": "post_game_faceoff_map",
    "8": "post_game_net_chart",
}


def _slugify(s: str) -> str:
    """Match the existing calibration/extras naming convention: lowercase,
    alphanumeric + hyphens only. Empty input becomes 'unknown'."""
    out = re.sub(r"[^a-zA-Z0-9]+", "-", (s or "").strip().lower()).strip("-")
    return out or "unknown"


def _try_open_image(path: Path) -> None:
    """Best-effort: hand the PNG to the OS image viewer. Silent fall-through
    if xdg-open / start aren't available — the operator can still browse the
    directory directly."""
    for opener in ("xdg-open", "wslview", "explorer.exe"):
        if shutil.which(opener):
            subprocess.Popen(  # noqa: S603 - operator-invoked CLI
                [opener, str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return


def _extract_frame(video: Path, seconds: float, out_path: Path) -> bool:
    """Pull a single frame at `seconds` via ffmpeg. Returns True on success."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(  # noqa: S603 - operator-invoked CLI
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-ss",
            str(seconds),
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-vf",
            "scale=1920:1080",
            "-y",
            str(out_path),
        ],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and out_path.exists()


def annotate(
    segments_json: Path,
    video: Optional[Path],
    match_id: Optional[int],
    opp_slug: str,
    top_n: int,
    extras_dir: Path,
    tmp_dir: Path,
) -> None:
    """Walk the operator through the top-N ambiguous frames in a segments.json
    and let them label-or-skip each. Saves labeled PNGs into `extras_dir`
    using the canonical naming convention."""
    if not segments_json.exists():
        typer.echo(f"segments.json not found at {segments_json}", err=True)
        raise typer.Exit(code=1)
    data = json.loads(segments_json.read_text())
    fc = data.get("frame_classifications", [])
    if not fc:
        typer.echo("segments.json has no frame_classifications", err=True)
        raise typer.Exit(code=1)

    if video is None:
        video_path = Path(data.get("video_path", ""))
    else:
        video_path = video
    if not video_path.exists():
        typer.echo(
            f"Source video not found at {video_path}. Pass --video to override.",
            err=True,
        )
        raise typer.Exit(code=1)

    # Sampling rule: HSV vote was a specific screen but anchor gate demoted
    # the frame to unknown_screen. Sort by color_score descending, take top-N.
    candidates = [
        f
        for f in fc
        if f.get("screen_type") == UNKNOWN_SCREEN
        and (f.get("color_class") or UNKNOWN_SCREEN) != UNKNOWN_SCREEN
        and float(f.get("color_score", 0.0)) >= 0.7
    ]
    candidates.sort(key=lambda f: float(f.get("color_score", 0.0)), reverse=True)
    candidates = candidates[:top_n]

    if not candidates:
        typer.echo("No candidate frames (color_class != unknown_screen, score >= 0.7).")
        return

    tmp_dir.mkdir(parents=True, exist_ok=True)
    extras_dir.mkdir(parents=True, exist_ok=True)

    typer.echo("")
    typer.echo(f"Source: {video_path}")
    typer.echo(f"Candidates: {len(candidates)} (top {top_n}, color_score ≥ 0.7)")
    typer.echo(f"Saved corpus dir: {extras_dir}")
    typer.echo("")
    typer.echo("Per frame: choose a class key, [c]onfirm-rejection, [s]kip, [q]uit.")
    typer.echo(
        "  1=lobby_state_2  2=player_loadout_view  3=action_tracker  4=player_summary"
    )
    typer.echo(
        "  5=events  6=box_score_goals  7=faceoff_map  8=net_chart"
    )
    typer.echo("")

    labeled = 0
    skipped = 0
    confirmed = 0
    for i, f in enumerate(candidates, 1):
        seconds = float(f["seconds"])
        cc = f.get("color_class", "")
        score = float(f.get("color_score", 0.0))
        anchor = (f.get("anchor_text") or "")[:80]
        tmp_png = tmp_dir / f"candidate-{int(seconds):05d}.png"
        if not _extract_frame(video_path, seconds, tmp_png):
            typer.echo(f"[{i}/{len(candidates)}] ffmpeg extract failed at t={seconds}s — skip")
            continue
        typer.echo(
            f"[{i}/{len(candidates)}] t={seconds:.0f}s  color_class={cc} ({score:.2f})  anchor={anchor!r}"
        )
        _try_open_image(tmp_png)
        choice = (typer.prompt("  label", default="s", show_default=False) or "s").strip().lower()
        if choice == "q":
            typer.echo("  quit")
            break
        if choice == "c":
            confirmed += 1
            continue
        if choice == "s":
            skipped += 1
            continue
        klass = CLASS_KEYS.get(choice)
        if klass is None:
            typer.echo(f"  unknown choice {choice!r} — treating as skip")
            skipped += 1
            continue
        match_part = f"match{match_id}" if match_id else "match-unknown"
        out_name = f"{klass}__{match_part}_t{int(seconds)}_vs_{_slugify(opp_slug)}.png"
        out_path = extras_dir / out_name
        shutil.copy2(tmp_png, out_path)
        typer.echo(f"  → saved as {out_name}")
        labeled += 1

    typer.echo("")
    typer.echo(
        f"Summary: labeled={labeled} confirmed_unknown={confirmed} skipped={skipped}"
    )
    if labeled > 0:
        typer.echo(
            f"Run `python tools/game_ocr/scripts/calibrate_classifier.py` to fold the "
            f"new PNG(s) into nhl26.yaml after adding them to CLASSES['<screen>']['extras']."
        )
