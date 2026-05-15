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
from pathlib import Path

import typer

from video_ingest.orchestrator import ingest as run_ingest


REPO_ROOT = Path(__file__).resolve().parents[3]
# Allow CLI to import game_ocr from sibling tools/ subtree.
sys.path.insert(0, str(REPO_ROOT / "tools" / "game_ocr"))


app = typer.Typer(add_completion=False, no_args_is_help=True)


@app.command()
def ingest(
    video: Path = typer.Option(..., exists=True, readable=True, resolve_path=True),
    output_root: Path = typer.Option(..., resolve_path=True, help="Per-video sha root sits inside this dir."),
    version: str = typer.Option("nhl26", help="UI-config version (nhl26, nhl27, ...)."),
    use_gpu: bool = typer.Option(True, help="Use CUDA EP for classifier OCR."),
    force_pass1: bool = typer.Option(False, help="Re-run Pass 1 even if segments.json cached."),
    force_pass2: bool = typer.Option(False, help="Re-extract Pass 2 frames even if dirs exist."),
    dispatch: bool = typer.Option(False, help="Fan out to ingest-ocr-cli per segment dir."),
    game_title_id: int = typer.Option(None, help="Required when --dispatch is set."),
    match_id: int = typer.Option(None, help="Optional match_id to pass to ingest-ocr-cli."),
    dispatch_dry_run: bool = typer.Option(False, help="Pass --dry-run to each ingest-ocr-cli subprocess."),
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
def classify_only(
    video: Path = typer.Option(..., exists=True, readable=True, resolve_path=True),
    output_root: Path = typer.Option(..., resolve_path=True),
    version: str = typer.Option("nhl26"),
    use_gpu: bool = typer.Option(True),
) -> None:
    """Pass 1 only. Useful for iterating on classifier thresholds without
    re-extracting PNGs."""
    res = run_ingest(
        video_path=video,
        output_root=output_root,
        version=version,
        use_gpu=use_gpu,
        force_pass1=True,
        force_pass2=False,
    )
    # Suppress Pass 2 by short-circuiting: re-running will fall through
    # the cached-Pass2 path. For pure Pass-1 iteration, callers usually
    # delete the pass2/ dir between runs.
    typer.echo(f"\nsegments.json at {res.sha_root / 'segments.json'}")


@app.command("extract-only")
def extract_only(
    video: Path = typer.Option(..., exists=True, readable=True, resolve_path=True),
    output_root: Path = typer.Option(..., resolve_path=True),
    version: str = typer.Option("nhl26"),
) -> None:
    """Pass 2 only (Pass 1 must have run; segments.json must be cached)."""
    res = run_ingest(
        video_path=video,
        output_root=output_root,
        version=version,
        use_gpu=False,  # classifier doesn't run; skip GPU init
        force_pass1=False,
        force_pass2=True,
    )
    total_frames = sum(r.frame_count for r in res.pass2_results)
    typer.echo(f"\nextracted {total_frames} frames across {len(res.pass2_results)} segments")


if __name__ == "__main__":
    app()
