"""video_ingest CLI — Typer entrypoint.

Subcommands:
  ingest         Full pipeline: probe → Pass 1 → Pass 2
  classify-only  Run Pass 1 only; emit segments.json
  extract-only   Re-run Pass 2 from a previously-cached segments.json

The CLI is designed so each phase can run independently for iteration.
The default `ingest` uses sha-keyed output directories — re-running on
the same video is idempotent.
"""

from __future__ import annotations

import sys
from datetime import date
from functools import wraps
from pathlib import Path
from typing import Optional

import typer

from video_ingest.annotate import annotate as run_annotate
from video_ingest.batch_ingest import run_batch, run_promote
from video_ingest.dispatch import ReelMapLookupError
from video_ingest.orchestrator import ingest as run_ingest
from video_ingest.pass1_classify import CacheMismatch, MissingPass1Cache
from video_ingest.reprocess import reprocess as run_reprocess


app = typer.Typer(add_completion=False, no_args_is_help=True)


def _with_cache_mismatch_exit(fn):
    """Catch user-fixable orchestrator errors at the CLI boundary and exit
    non-zero with the structured message — avoids printing a Python traceback
    for config drift (`CacheMismatch`), missing-Pass-1-cache states
    (`MissingPass1Cache`), or a required-but-unreadable confirmed reel map
    (`ReelMapLookupError`, only raised under --require-reel-map). The clean
    exit-1 is what the batch-promote subprocess wrapper turns into a loud
    per-video SKIP instead of a silent no-op drain."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (CacheMismatch, MissingPass1Cache, ReelMapLookupError) as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(code=1)
    return wrapper


@app.command()
@_with_cache_mismatch_exit
def ingest(
    video: Path = typer.Option(..., exists=True, readable=True, resolve_path=True),
    output_root: Path = typer.Option(..., resolve_path=True, help="Per-video sha root sits inside this dir."),
    version: str = typer.Option("nhl26", help="UI-config version (nhl26, nhl27, ...) or 'auto' to detect from sampled frames."),
    use_gpu: bool = typer.Option(True, help="Use CUDA EP for classifier OCR."),
    force_pass1: bool = typer.Option(False, help="Re-run Pass 1 even if segments.json cached."),
    force_pass2: bool = typer.Option(False, help="Re-extract Pass 2 frames even if dirs exist."),
    dispatch: bool = typer.Option(False, help="Fan out to ingest-ocr-cli per segment dir."),
    game_title_id: int = typer.Option(None, help="Required when --dispatch is set."),
    match_id: int = typer.Option(None, help="Optional match_id to pass to ingest-ocr-cli."),
    require_reel_map: bool = typer.Option(
        False,
        "--require-reel-map/--no-require-reel-map",
        help=(
            "Fail (exit 1) instead of silently deferring when the operator-"
            "confirmed reel→match map cannot be read OR comes back empty. Set by "
            "the batch-promote pass, which KNOWS the video is confirmed, so a "
            "failed/empty lookup surfaces as a loud per-video SKIP rather than a "
            "silent no-op drain (reels re-OCR'd, nothing promoted). Leave off for "
            "fresh Pass-1 / manual runs, where an unconfirmed video legitimately "
            "has no map."
        ),
    ),
    dispatch_dry_run: bool = typer.Option(False, help="Pass --dry-run to each ingest-ocr-cli subprocess."),
    run_id: int = typer.Option(
        None,
        help=(
            "Phase-A: ocr_decoder_runs.id this ingest belongs to. When set, every "
            "worker-side insert is tagged with this run. Typically created by the "
            "reprocess CLI before invoking this command; leave unset for legacy "
            "one-shot ingests (rows get run_id=NULL)."
        ),
    ),
    pass2_artifacts: bool = typer.Option(
        False,
        "--pass2-artifacts/--no-pass2-artifacts",
        help=(
            "Write PNG frames to disk per segment. Default (since Phase 3c) "
            "is no artifacts — typed_v1 segments stream in memory via the "
            "Phase 3b hot path and only evidence JSON is persisted. Pass "
            "--pass2-artifacts to opt into the legacy PNG-on-disk behavior "
            "(useful for review/debug). Switching this flag invalidates "
            "the pass2 cache for this video."
        ),
    ),
    prefilter: bool | None = typer.Option(
        None,
        "--prefilter/--no-prefilter",
        help=(
            "Visual Prefilter Phase 3: when enabled, per-segment Pass-2 "
            "frame selection drops near-duplicates (dHash) and caps each "
            "screen to its configured frame_budget before OCR. Default "
            "(omitted) = use the version YAML's `visual_prefilter.pass2_enabled` "
            "(currently false). Switching the effective state invalidates "
            "the pass2 cache for this video."
        ),
    ),
    pass1_gate: bool | None = typer.Option(
        None,
        "--pass1-gate/--no-pass1-gate",
        help=(
            "WS2 pre-OCR gate: when enabled, frames classified as "
            "unambiguously non-text (black/fade) skip the expensive Pass-1 "
            "OCR. Default (omitted) = use the version YAML's "
            "`pass1.pre_ocr_gate.enabled`. Use --no-pass1-gate for an OFF/ON "
            "A/B against --pass1-gate (each invalidates the Pass-1 cache). The "
            "env var OCR_PASS1_GATE_ENABLED=false force-disables regardless."
        ),
    ),
) -> None:
    """Run the full pipeline against a single video file. With
    `--dispatch`, fans out to the worker's ingest-ocr-cli to write
    extractions into the DB; otherwise stops at PNG extraction."""
    res = run_ingest(
        video_path=video,
        output_root=output_root,
        version=version,
        use_gpu=use_gpu,
        force_pass1=force_pass1,
        force_pass2=force_pass2,
        dispatch=dispatch,
        game_title_id=game_title_id,
        match_id=match_id,
        dispatch_dry_run=dispatch_dry_run,
        run_id=run_id,
        require_reel_map=require_reel_map,
        artifact_mode=pass2_artifacts,
        prefilter_enabled=prefilter,
        pass1_gate_enabled=pass1_gate,
    )
    typer.echo(f"\nsha:    {res.probe.sha256}")
    typer.echo(f"root:   {res.sha_root}")
    typer.echo(f"pass1:  {len(res.pass1_segments)} segments ({res.elapsed_pass1:.1f}s)")
    total_frames = sum(r.frame_count for r in res.pass2_results)
    typer.echo(
        f"pass2:  {len(res.pass2_results)} segment dirs, "
        f"{total_frames} frames ({res.elapsed_pass2:.1f}s)"
    )
    if res.dispatch_results is not None:
        ok = sum(1 for r in res.dispatch_results if r.returncode == 0)
        bad = sum(1 for r in res.dispatch_results if r.returncode != 0)
        typer.echo(
            f"dispatch: {ok}/{len(res.dispatch_results)} ok, {bad} failed ({res.elapsed_dispatch:.1f}s)"
        )


@app.command("classify-only")
@_with_cache_mismatch_exit
def classify_only(
    video: Path = typer.Option(..., exists=True, readable=True, resolve_path=True),
    output_root: Path = typer.Option(..., resolve_path=True),
    version: str = typer.Option("nhl26"),
    use_gpu: bool = typer.Option(True),
    force_pass1: bool = typer.Option(False, help="Re-run Pass 1 even if segments.json cached."),
    pass1_gate: bool | None = typer.Option(
        None,
        "--pass1-gate/--no-pass1-gate",
        help=(
            "WS2 pre-OCR gate override (OFF/ON A/B for Pass-1 wall). Default "
            "= version YAML. Each effective state has its own Pass-1 cache key."
        ),
    ),
) -> None:
    """Pass 1 only. Writes segments.json and never touches Pass 2 state.
    Useful for iterating on classifier thresholds. Respects the Pass 1 cache;
    pass --force-pass1 to invalidate."""
    res = run_ingest(
        video_path=video,
        output_root=output_root,
        version=version,
        use_gpu=use_gpu,
        force_pass1=force_pass1,
        skip_pass2=True,
        pass1_gate_enabled=pass1_gate,
    )
    typer.echo(f"\nsegments.json at {res.sha_root / 'segments.json'}")
    typer.echo(f"pass1: {len(res.pass1_segments)} segments ({res.elapsed_pass1:.1f}s)")


@app.command("extract-only")
@_with_cache_mismatch_exit
def extract_only(
    video: Path = typer.Option(..., exists=True, readable=True, resolve_path=True),
    output_root: Path = typer.Option(..., resolve_path=True),
    version: str = typer.Option("nhl26"),
    force_pass2: bool = typer.Option(False, help="Re-extract Pass 2 frames even if cached."),
    pass2_artifacts: bool = typer.Option(
        False,
        "--pass2-artifacts/--no-pass2-artifacts",
        help=(
            "Write PNG frames to disk per segment. Default (since Phase 3c) "
            "is no artifacts — typed_v1 segments stream in memory via the "
            "Phase 3b hot path and only evidence JSON is persisted. Pass "
            "--pass2-artifacts to opt into the legacy PNG-on-disk behavior "
            "(useful for review/debug). Switching this flag invalidates "
            "the pass2 cache for this video."
        ),
    ),
    prefilter: bool | None = typer.Option(
        None,
        "--prefilter/--no-prefilter",
        help=(
            "Visual Prefilter Phase 3 override. Default (omitted) defers to "
            "the version YAML's `visual_prefilter.pass2_enabled`. Switching "
            "the effective state invalidates the pass2 cache."
        ),
    ),
) -> None:
    """Pass 2 only. Requires a valid cached segments.json — fails fast with
    a clear remediation otherwise. Respects the Pass 2 cache; pass
    --force-pass2 to re-extract."""
    res = run_ingest(
        video_path=video,
        output_root=output_root,
        version=version,
        use_gpu=False,
        skip_pass1=True,
        force_pass2=force_pass2,
        artifact_mode=pass2_artifacts,
        prefilter_enabled=prefilter,
    )
    total_frames = sum(r.frame_count for r in res.pass2_results)
    typer.echo(f"\nextracted {total_frames} frames across {len(res.pass2_results)} segments")


@app.command()
def annotate(
    segments_json: Path = typer.Option(..., exists=True, readable=True, resolve_path=True,
        help="Path to segments.json from a prior Pass-1 run."),
    video: Path = typer.Option(None, exists=False, resolve_path=True,
        help="Source video. Defaults to segments.json's video_path field."),
    match_id: int = typer.Option(None, help="Match ID to embed in saved PNG filenames."),
    opp_slug: str = typer.Option("unknown", help="Opponent slug for the filename suffix."),
    top_n: int = typer.Option(10, help="Cap on candidate frames presented to the operator (5-min budget)."),
    extras_dir: Path = typer.Option(
        Path("tools/game_ocr/calibration/extras"),
        resolve_path=True,
        help="Directory where labeled PNGs land (existing calibration corpus).",
    ),
    tmp_dir: Path = typer.Option(
        Path("/tmp/annotate-segments"),
        resolve_path=True,
        help="Scratch dir for ffmpeg-extracted candidate PNGs.",
    ),
) -> None:
    """Walk operator through top-N ambiguous frames (HSV-voted as a screen
    type but anchor-gate-demoted to unknown_screen). For each, the operator
    confirms classifier rejection, relabels with a single key, or skips.
    Relabeled frames are saved into `extras_dir` using the canonical
    `<class>__match<id>_t<seconds>_vs_<opp>.png` naming convention so the
    next `calibrate_classifier` run picks them up."""
    run_annotate(
        segments_json=segments_json,
        video=video,
        match_id=match_id,
        opp_slug=opp_slug,
        top_n=top_n,
        extras_dir=extras_dir,
        tmp_dir=tmp_dir,
    )


app.command(name="reprocess")(run_reprocess)


@app.command("batch")
def batch(
    video_root: Path = typer.Option(
        ...,
        "--video-root",
        exists=True,
        file_okay=False,
        dir_okay=True,
        readable=True,
        help="Corpus root holding loose recordings + match<id>/ folders.",
    ),
    since: str = typer.Option(
        "2026-05-08",
        "--since",
        help="ISO date (YYYY-MM-DD); only recordings on/after this are ingested.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print the enumerated/deduped/prioritized plan without mutating.",
    ),
    limit: Optional[int] = typer.Option(
        None, "--limit", help="Process at most N targets (after prioritize)."
    ),
    jobs: int = typer.Option(
        1,
        "--jobs",
        "-j",
        min=1,
        help=(
            "Pass-1 concurrency. 1 (default) runs single-threaded with live "
            "terminal output. N>1 fans out N concurrent ingest passes on this "
            "12-core box, each logging to its own per-video file. WARNING: N "
            "workers share the GPU OCR closure — validate at low N (e.g. 2-3) "
            "before scaling, in case classify uses the CUDA EP and contends for "
            "GPU memory."
        ),
    ),
) -> None:
    """Unattended mass-ingest run loop over the video corpus.

    Preflights the GPU-venv closure once, then per target (priority order)
    fresh-ingests → proposes reel→match associations → STOPS at the
    operator-confirm gate. Nothing auto-promotes. See ``batch_ingest.run_batch``.

    ``--jobs N`` parallelizes Pass-1 across N worker threads (default 1 =
    sequential, unchanged). A ``--dry-run`` always prints the plan single-threaded.
    """
    run_batch(
        video_root,
        date.fromisoformat(since),
        dry_run=dry_run,
        limit=limit,
        jobs=jobs,
    )


@app.command("batch-promote")
def batch_promote(
    video_root: Path = typer.Option(
        ...,
        "--video-root",
        exists=True,
        file_okay=False,
        dir_okay=True,
        readable=True,
        help="Corpus root holding loose recordings + match<id>/ folders (same as `batch`).",
    ),
    since: str = typer.Option(
        "2026-05-08",
        "--since",
        help="ISO date (YYYY-MM-DD); only recordings on/after this are considered.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print the promote plan without re-ingesting, promoting, or grading.",
    ),
    limit: Optional[int] = typer.Option(
        None, "--limit", help="Promote at most N videos (after planning)."
    ),
) -> None:
    """Drain the operator-confirmed association backlog — `batch`'s second pass.

    `batch` stops every video at the operator-confirm gate and `resolve-match
    confirm` decides; nothing drains the result. This does. It finds each video
    with reels the operator CONFIRMED but never dispatched, re-ingests it
    (Pass-1/Pass-2 decode cache hit, then ~2.3h of worker OCR per video) so every
    confirmed reel dispatches under its own match_id — which auto-promotes that
    reel's box score inside the ingest transaction — then grades each promoted
    match with the 4.G L4 verdict and reports PASS / HOLD / OPERATOR_CONFIRM.

    The verdict is POST-promotion: it routes matches to the review queue, it does
    not prevent promotion. Confirm ALL of a video's reels before promoting it —
    the skip granularity is per-video, so a partially-confirmed video re-OCRs its
    already-drained reels. See ``batch_ingest.run_promote``.
    """
    run_promote(video_root, date.fromisoformat(since), dry_run=dry_run, limit=limit)


if __name__ == "__main__":
    app()
