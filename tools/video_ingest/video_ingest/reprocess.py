"""video_ingest reprocess — Phase-A A3 reprocess CLI.

Orchestrates: create candidate run -> ingest into candidate -> promote
against candidate -> validate -> atomic activation + canonical rebuild.

Shells out to apps/worker's `decoder-runs` CLI for all DB-atomic
operations (Drizzle is the schema source of truth). The Python side
holds the high-level flow.

For Task 8, this is the SKELETON: --undo path works end-to-end (shells
to decoder-runs-cli undo). Full reprocess body (the create-ingest-
promote-validate-activate flow) lands in Task 9.
"""
from __future__ import annotations

import json
import shlex
import subprocess
from pathlib import Path

import typer


REPO_ROOT = Path(__file__).resolve().parents[3]


def _run_decoder_runs_cli(*args: str) -> dict:
    """Invoke `pnpm --filter @eanhl/worker decoder-runs <args>` and parse the
    JSON payload it prints on stdout. Raises on non-zero exit (except for
    validate's exit 2, which is propagated)."""
    cmd = ["pnpm", "--filter", "@eanhl/worker", "decoder-runs", *args]
    res = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    if res.returncode not in (0, 2):
        raise RuntimeError(
            f"decoder-runs {shlex.join(args)} exited {res.returncode}:\n{res.stderr}"
        )
    # Last line of stdout starting with { is the JSON payload (tolerate pnpm header lines)
    for line in res.stdout.strip().splitlines()[::-1]:
        if line.startswith("{"):
            return {**json.loads(line), "_exit": res.returncode}
    raise RuntimeError(f"no JSON payload found in decoder-runs output:\n{res.stdout}")


def reprocess(
    match_id: int = typer.Option(..., "--match-id", help="Match id to reprocess."),
    video: Path = typer.Option(
        None, "--video", exists=True, readable=True, resolve_path=True,
        help="Override the video path; otherwise resolved via ocr_capture_batches.video_sha256.",
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print what would happen without committing."),
    undo: bool = typer.Option(False, "--undo", help="Reverse the most recent activation for this match."),
    version: str = typer.Option("nhl26", "--version", help="UI-config version (nhl26, nhl27, ...)."),
) -> None:
    """Reprocess a match's video against the current v2 weights.

    --undo: reverse the most recent activation via decoder-runs-cli undo.
    --dry-run with --undo: print would-be flip without committing.

    Default reprocess flow (without --undo) is TBD in Task 9.
    """
    if undo:
        flags = ["undo", "--match-id", str(match_id)]
        if dry_run:
            flags.append("--dry-run")
        result = _run_decoder_runs_cli(*flags)
        typer.echo(json.dumps(result, indent=2))
        return

    typer.echo("reprocess (full flow) not yet implemented — see Task 9", err=True)
    raise typer.Exit(code=0)
