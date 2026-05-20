"""Subprocess fan-out: dispatch the existing worker ingest-ocr-cli for
each Pass-2 segment directory.

Subprocess-based to keep the Python/TypeScript boundary clean. The
~5-10 spawns per video amortize the cold start (~600 ms each).

Each invocation:
  pnpm --filter worker ingest-ocr -- \
    --batch-dir <segment_dir> \
    --screen <screen_type> \
    --game-title-id <id> \
    [--match-id <id>] \
    --capture-kind video_frames \
    --video-sha256 <sha> \
    --notes "video_ingest:<segment_index>:[start..end]s"

The video_sha256 + source_directory combination makes the batch upsert
idempotent at the worker side.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from video_ingest.pass2_extract import Pass2Result


@dataclass
class DispatchResult:
    segment_index: int
    screen_type: str
    directory: Path
    returncode: int
    stdout_tail: str
    stderr_tail: str


def find_repo_root(start: Path | None = None) -> Path:
    """Walk up from `start` until we find a pnpm-workspace.yaml. Allows
    the dispatch to work whether invoked from inside tools/video_ingest
    or from the repo root."""
    p = (start or Path(__file__)).resolve()
    for ancestor in [p, *p.parents]:
        if (ancestor / "pnpm-workspace.yaml").exists():
            return ancestor
    raise FileNotFoundError("could not locate pnpm-workspace.yaml ancestor")


def dispatch_segments(
    results: Iterable[Pass2Result],
    *,
    game_title_id: int,
    match_id: int | None,
    video_sha256: str,
    ui_version: str = "nhl26",
    repo_root: Path | None = None,
    dry_run: bool = False,
) -> list[DispatchResult]:
    """Run ingest-ocr-cli once per segment dir. Returns per-segment
    return codes + tail of stdout/stderr for debug.

    Non-zero returncode does NOT abort the whole batch — each segment
    is reported independently so partial failure surfaces a usable
    set of ingested screens.
    """
    root = repo_root or find_repo_root()
    pnpm = shutil.which("pnpm")
    if not pnpm:
        raise FileNotFoundError("pnpm not on PATH")

    out: list[DispatchResult] = []
    for r in results:
        if r.frame_count == 0:
            continue
        cmd = [
            pnpm, "--filter", "worker", "ingest-ocr", "--",
            "--batch-dir", str(r.directory),
            "--screen", r.segment.screen_type,
            "--game-title-id", str(game_title_id),
            "--capture-kind", "video_frames",
            "--video-sha256", video_sha256,
            # Pass-1 segment metadata for the ocr_segments adapter (Phase 0
            # evidence-layer). The segment_key on the worker side becomes
            # `vsha-<sha-prefix>:seg<NNNN>` — stable across re-ingests.
            "--video-segment-index", str(r.segment_index),
            "--video-segment-start-sec", f"{r.start_seconds:.3f}",
            "--video-segment-end-sec", f"{r.end_seconds:.3f}",
            "--ui-version", ui_version,
            "--notes",
            f"video_ingest:seg{r.segment_index:03d}:[{r.start_seconds:.1f}..{r.end_seconds:.1f}]s",
        ]
        if match_id is not None:
            cmd.extend(["--match-id", str(match_id)])
        if dry_run:
            cmd.append("--dry-run")

        print(f"[dispatch] seg {r.segment_index:03d} ({r.segment.screen_type}) → ingest-ocr-cli", file=sys.stderr)
        proc = subprocess.run(
            cmd, cwd=str(root), capture_output=True, text=True,
        )
        # Show last few lines so the user sees real-time progress in the
        # orchestrator console even though we buffer.
        for line in proc.stdout.splitlines()[-3:]:
            print(f"  {line}", file=sys.stderr)
        if proc.returncode != 0:
            print(f"  [stderr tail]", file=sys.stderr)
            for line in proc.stderr.splitlines()[-5:]:
                print(f"  {line}", file=sys.stderr)
        out.append(DispatchResult(
            segment_index=r.segment_index,
            screen_type=r.segment.screen_type,
            directory=r.directory,
            returncode=proc.returncode,
            stdout_tail="\n".join(proc.stdout.splitlines()[-5:]),
            stderr_tail="\n".join(proc.stderr.splitlines()[-5:]),
        ))
    return out
