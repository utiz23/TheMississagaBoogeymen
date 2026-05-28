"""video_ingest reprocess — Phase-A A3 reprocess CLI.

Orchestrates: create candidate run -> ingest into candidate -> promote
against candidate -> validate -> atomic activation + canonical rebuild.

Shells out to apps/worker's `decoder-runs` CLI for all DB-atomic
operations (Drizzle is the schema source of truth). The Python side
holds the high-level flow.

Task 9 wires the full create-ingest-promote-validate-activate body
on top of the Task 8 skeleton. The --undo escape valve still delegates
straight to ``decoder-runs-cli undo``.
"""
from __future__ import annotations

import hashlib
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

import typer


REPO_ROOT = Path(__file__).resolve().parents[3]

# Per-match video root on this machine. Phase-A convention: each match
# has its own subdir under K:\NHL\NHL26 (WSL: /mnt/k/NHL/NHL26).
DEFAULT_VIDEO_ROOT = Path("/mnt/k/NHL/NHL26")

# Where Pass-2 PNGs land during ingest. Re-used across reprocess runs;
# inside, the run_id-scoped subdir (pass2-run-<N>) keeps concurrent
# candidate runs from clobbering each other (see Task 7 + master-plan §1).
DEFAULT_INGEST_CACHE = Path("/tmp/ingest-cache")

# NHL 26 is game_title_id=1 in this repo's seed data; the only title
# currently flowing through OCR ingest. When NHL 27 ships we'll widen
# this to either a CLI flag or a lookup based on the match row.
NHL26_GAME_TITLE_ID = 1


# ─── hashing helpers ──────────────────────────────────────────────────────────


def _file_sha256(path: Path) -> str:
    """sha256 of the file at ``path`` (full read into memory — the v2
    artifact files are <10 MB, no streaming needed)."""
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _compute_hashes(version: str) -> tuple[str, str]:
    """Return ``(weights_hash, config_hash)`` for the named UI version.

    - ``weights_hash`` = sha256 of the v2 screen-classifier weights JSON.
    - ``config_hash`` = sha256 of (state-machine YAML || regex-priors YAML).

    Both files live under ``tools/game_ocr``; the path layout matches the
    proving-bench (S5.5) and is the canonical source for what the
    decoder will actually use at ingest time.
    """
    weights = (
        REPO_ROOT
        / "tools"
        / "game_ocr"
        / "game_ocr"
        / "weights"
        / f"{version}-screen-classifier-v2.json"
    )
    state_machine = (
        REPO_ROOT
        / "tools"
        / "game_ocr"
        / "game_ocr"
        / "configs"
        / "state_machine"
        / f"{version}.yaml"
    )
    regex_priors = (
        REPO_ROOT
        / "tools"
        / "game_ocr"
        / "game_ocr"
        / "configs"
        / "state_machine"
        / f"{version}_regex_priors.yaml"
    )

    for required in (weights, state_machine, regex_priors):
        if not required.exists():
            raise RuntimeError(
                f"required v2 artifact missing: {required} "
                f"(needed to compute weights_hash/config_hash for version={version!r})"
            )

    weights_hash = _file_sha256(weights)
    combined = hashlib.sha256()
    combined.update(state_machine.read_bytes())
    combined.update(regex_priors.read_bytes())
    config_hash = combined.hexdigest()
    return weights_hash, config_hash


# ─── video resolution ─────────────────────────────────────────────────────────


def _psql_query(sql: str) -> str:
    """Run a one-shot psql query inside the local Postgres container and
    return raw stdout (caller parses). Avoids adding a Python PG driver
    dep just for one lookup. Container name + creds are fixed per the
    repo's docker-compose service."""
    cmd = [
        "docker", "exec", "eanhl-team-website-db-1",
        "psql", "-U", "eanhl", "-d", "eanhl",
        "-t", "-A",  # tuples only, unaligned: easy to parse
        "-c", sql,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"psql query failed (exit {res.returncode}):\n"
            f"  sql: {sql}\n"
            f"  stderr: {res.stderr.strip()}"
        )
    return res.stdout.strip()


def _resolve_video_path(match_id: int) -> tuple[Path, str]:
    """Resolve the source video file + its sha256 for ``match_id``.

    Looks up the latest non-null ``video_sha256`` in ``ocr_capture_batches``
    for the match, then scans ``/mnt/k/NHL/NHL26/match <id>/*.mkv`` for a
    file whose sha matches. The recorded ``source_directory`` often points
    at the sha-rooted ingest cache (which doesn't contain the raw video),
    so we glob the per-match folder instead.
    """
    sha = _psql_query(
        f"SELECT video_sha256 FROM ocr_capture_batches "
        f"WHERE match_id = {int(match_id)} AND video_sha256 IS NOT NULL "
        f"ORDER BY id DESC LIMIT 1"
    )
    if not sha:
        raise RuntimeError(
            f"no video_sha256 recorded for match {match_id} in "
            f"ocr_capture_batches — re-ingest at least once before reprocess"
        )

    match_dir = DEFAULT_VIDEO_ROOT / f"match {match_id}"
    if not match_dir.exists():
        raise RuntimeError(
            f"source-video dir not found: {match_dir} "
            f"(expected layout: {DEFAULT_VIDEO_ROOT}/match <id>/*.mkv)"
        )

    candidates = sorted(match_dir.glob("*.mkv"))
    if not candidates:
        raise RuntimeError(
            f"no .mkv files under {match_dir} — "
            f"cannot resolve source video for reprocess"
        )

    for candidate in candidates:
        if _file_sha256(candidate) == sha:
            return candidate, sha

    raise RuntimeError(
        f"none of the .mkv files in {match_dir} match the recorded "
        f"video_sha256 ({sha[:12]}...). Found: "
        f"{', '.join(c.name for c in candidates)}"
    )


# ─── subprocess helpers ───────────────────────────────────────────────────────


def _run_decoder_runs_cli(*args: str) -> dict:
    """Invoke ``pnpm --filter @eanhl/worker decoder-runs <args>`` and parse
    the JSON payload it prints on stdout.

    Returns the parsed payload with an extra ``_exit`` key carrying the
    underlying CLI exit code (0 for success, 2 for ``validate`` fail-soft).
    Raises ``RuntimeError`` on any other non-zero exit so the caller sees
    a stack trace + stderr verbatim.
    """
    cmd = ["pnpm", "--filter", "@eanhl/worker", "decoder-runs", *args]
    res = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    if res.returncode not in (0, 2):
        raise RuntimeError(
            f"decoder-runs {shlex.join(args)} exited {res.returncode}:\n{res.stderr}"
        )
    # The CLI prints one JSON line on stdout; pnpm may prepend header
    # lines, so walk stdout bottom-up and pick the last line starting
    # with '{'.
    for line in res.stdout.strip().splitlines()[::-1]:
        if line.startswith("{"):
            return {**json.loads(line), "_exit": res.returncode}
    raise RuntimeError(f"no JSON payload found in decoder-runs output:\n{res.stdout}")


def _run_streaming(cmd: list[str], *, description: str) -> None:
    """Run a long-lived subprocess, inheriting stdout/stderr so the user
    sees ingest/promote progress live. Raises with a clear message on
    non-zero exit. Used for the heavy ingest step + the two repromote
    CLIs (each can run several minutes)."""
    typer.echo(f"\n>>> {description}", err=True)
    typer.echo(f"    $ {shlex.join(cmd)}", err=True)
    res = subprocess.run(cmd, cwd=REPO_ROOT)
    if res.returncode != 0:
        raise RuntimeError(
            f"{description} failed (exit {res.returncode}): {shlex.join(cmd)}"
        )


# ─── Typer command ────────────────────────────────────────────────────────────


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

    Default flow (no ``--undo``):

      1. Compute ``weights_hash`` + ``config_hash`` from the v2 artifact files.
      2. Resolve the source video path (``--video`` overrides, else
         look up via ``ocr_capture_batches.video_sha256``).
      3. ``decoder-runs-cli create-candidate`` — insert a new
         ``ocr_decoder_runs`` row with ``is_active=false``.
      4. (skipped on ``--dry-run``) Run the Pass-1/Pass-2 ingest against
         the candidate run, scoped via ``--run-id``.
      5. (skipped on ``--dry-run``) Repromote loadout + lobby against
         the candidate run.
      6. (skipped on ``--dry-run``) ``decoder-runs-cli validate``.
         Exit 2 + ``failureReasons`` on failure.
      7. (skipped on ``--dry-run``) ``decoder-runs-cli activate``.

    With ``--undo``: shells through ``decoder-runs-cli undo --match-id N``;
    ``--dry-run`` is forwarded so the operator can preview the flip.
    """
    if undo:
        flags = ["undo", "--match-id", str(match_id)]
        if dry_run:
            flags.append("--dry-run")
        result = _run_decoder_runs_cli(*flags)
        typer.echo(json.dumps(result, indent=2))
        return

    # 1. Hashes from the on-disk v2 artifacts.
    weights_hash, config_hash = _compute_hashes(version)

    # 2. Resolve the source video path + sha256.
    if video is not None:
        video_path = video
        video_sha256 = _file_sha256(video_path)
    else:
        video_path, video_sha256 = _resolve_video_path(match_id)

    # 3. Create the candidate run.
    create_result = _run_decoder_runs_cli(
        "create-candidate",
        "--match-id", str(match_id),
        "--video-sha256", video_sha256,
        "--decoder-version", "hmm-viterbi-v2",
        "--weights-hash", weights_hash,
        "--config-hash", config_hash,
    )
    new_run_id = create_result["run_id"]
    typer.echo(
        json.dumps(
            {
                "step": "create-candidate",
                "match_id": match_id,
                "new_run_id": new_run_id,
                "video_path": str(video_path),
                "video_sha256": video_sha256,
                "weights_hash": weights_hash,
                "config_hash": config_hash,
            },
            indent=2,
        )
    )

    if dry_run:
        typer.echo(
            json.dumps(
                {
                    "dry_run": True,
                    "would_ingest_video": str(video_path),
                    "would_repromote_loadout_for_run_id": new_run_id,
                    "would_repromote_lobby_for_run_id": new_run_id,
                    "would_validate_run_id": new_run_id,
                    "would_activate_run_id": new_run_id,
                },
                indent=2,
            )
        )
        return

    # 4. Ingest into the candidate. Long-running (3-5 min on match 250).
    _run_streaming(
        [
            "python3", "-m", "video_ingest.cli", "ingest",
            "--video", str(video_path),
            "--output-root", str(DEFAULT_INGEST_CACHE),
            "--version", version,
            "--force-pass1", "--force-pass2",
            "--dispatch",
            "--match-id", str(match_id),
            "--run-id", str(new_run_id),
            "--game-title-id", str(NHL26_GAME_TITLE_ID),
        ],
        description=f"ingest match {match_id} into candidate run {new_run_id}",
    )

    # 5. Promote loadout + lobby against the candidate run.
    for cli_script in ("repromote-loadout", "repromote-lobby"):
        _run_streaming(
            [
                "pnpm", "--filter", "@eanhl/worker", cli_script,
                "--",
                "--match", str(match_id),
                "--run-id", str(new_run_id),
            ],
            description=f"{cli_script} for match {match_id} run {new_run_id}",
        )

    # 6. Validate. exit 2 = fail-soft from the worker side.
    val = _run_decoder_runs_cli("validate", "--run-id", str(new_run_id))
    if val.get("_exit") == 2:
        typer.echo(
            json.dumps(
                {
                    "step": "validate",
                    "ok": False,
                    "failure_reasons": val.get("details", {}).get("failureReasons", []),
                    "details": val.get("details"),
                },
                indent=2,
            ),
            err=True,
        )
        raise typer.Exit(code=2)

    typer.echo(json.dumps({"step": "validate", "ok": True, **val}, indent=2))

    # 7. Activate. Flips is_active, rebuilds canonicals, recomputes
    # match colours — all atomic on the TS side.
    act = _run_decoder_runs_cli("activate", "--run-id", str(new_run_id))
    typer.echo(json.dumps({"step": "activate", **act}, indent=2))
