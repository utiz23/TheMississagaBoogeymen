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
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import typer


REPO_ROOT = Path(__file__).resolve().parents[3]

# Per-match video root on this machine. Phase-A convention: each match
# has its own subdir under K:\NHL\NHL26 (WSL: /mnt/k/NHL/NHL26).
DEFAULT_VIDEO_ROOT = Path("/mnt/k/NHL/NHL26")

# Where Pass-2 PNGs land during ingest. Re-used across reprocess runs;
# inside, the run_id-scoped subdir (pass2-run-<N>) keeps concurrent
# candidate runs from clobbering each other (see Task 7 + master-plan §1).
DEFAULT_INGEST_CACHE = Path("/tmp/ingest-cache")

# Decoder-version provenance tag stamped on every candidate run. Bumped when the
# decode output changes so a re-run mints a DISTINCT candidate rather than
# colliding with a prior run via ocr_decoder_runs_provenance_uniq
# (match_id, video_sha256, decoder_version, weights_hash).
#   v2           → HMM-viterbi screen classifier (v2 head)
#   v2-pg-robust → secondary post-game extractor robustness (authoritative
#                  bgm_was_home team-side + fuzzy period-label parsing)
#   v2-pregame-cdef → pre-game lobby/loadout extraction accuracy program:
#                  C (lobby grid-Y position fix), D (captain ★ visual detector),
#                  E (away-side persona parse), F (confidence-weighted
#                  consolidation). These are extractor/consolidation code
#                  changes invisible to weights_hash/config_hash (which hash the
#                  screen-classifier v2 artifacts, untouched), so the version
#                  string is the ONLY provenance lever for the re-ingest.
#   v2-pregame-cdef-wsb → WS-B lobby-scramble extractor fix (981e19b):
#                  extract_lobby_evidence now drops EA roster-slide TRANSITION
#                  frames (within-panel duplicate-gamertag signature) and does a
#                  per-slot MAJORITY vote over settled frames, with the captain ★
#                  MAX restricted to settled frames. Same weights/config as
#                  -cdef, so the version string is again the only provenance
#                  lever; re-ingesting at -cdef would collide with the active
#                  candidate (run 1954 for match 250) on the provenance uniq.
#   v2-pregame-cdef-wsb-toggle → lobby toggle-phase per-field merge (034c39d):
#                  _vote_slot_identity now returns a MERGED LobbySubjectIdentity
#                  instead of a single max-quality representative — each identity
#                  field (#NN, persona, build_class, level, H/W/H, ready) is
#                  filled from the highest-confidence obs IN THE WINNING gamertag
#                  group, reuniting state_2's two toggle phases (one carries
#                  #NN+persona, the other build-class) into one complete slot.
#                  Bleed-safe (iterates only the winning group). Same
#                  weights/config as -wsb, so the version string is again the
#                  only provenance lever; re-ingesting at -wsb would collide with
#                  preserved run 1975 (match 250) on the provenance uniq.
#   v2-pregame-cdef-wsb-toggle-lobby3fps → pre_game_lobby_state_2 Pass-2 sample
#                  rate 1→3 fps (nhl26.yaml). state_2 rolls each panel between
#                  build-class and #NN-persona (~1s stable #NN dwell, cascading
#                  top-to-bottom flip); at 1 fps for_RD (JoeyFlopfish #48) and
#                  for_RW (silkyjoker85 #10) landed ZERO #NN/persona evidence
#                  (their winning-group frames were all build-phase), so the
#                  -wsb-toggle per-field merge had nothing to fill. 3 fps samples
#                  the #NN roll for every row. Unlike the -cdef/-wsb/-toggle code
#                  bumps this is a CONFIG change (it invalidates the pass2 cache
#                  via the full-YAML hash in compute_pass2_cache_key), but the
#                  provenance uniq keys only on (…, decoder_version, weights_hash)
#                  — so the version string is again the lever; re-ingesting at
#                  -wsb-toggle would collide with preserved run 1977 (match 250).
#   v2-pregame-cdef-wsb-toggle-lobby3fps-fuzzymerge → _vote_slot_identity per-field
#                  merge now spans the winner's OCR glyph-drift variants, not only
#                  the exact-normalized winning gamertag group (lobby_evidence.py
#                  _gamertag_keys_mergeable: Levenshtein ≤2 on the 6-char prefix,
#                  mirroring loadout_bundle). Even at 3 fps for_RW stayed at ZERO
#                  #NN: its gamertag reads silkyjoker85→sillkyjoker85/sllkyjokerBn
#                  across frames, so every legible #NN read landed on a drifted-key
#                  frame the exact-group merge discarded (measured on run 1992).
#                  Fuzzy grouping reunites the drift variants while a cross-panel
#                  bleed (HenryTheBobJr, prefix-dist 5) stays excluded. Code change,
#                  same config/weights as -lobby3fps, so the version string is the
#                  only provenance lever; re-ingesting at -lobby3fps would collide
#                  with preserved run 1992 (match 250).
DECODER_VERSION = "hmm-viterbi-v2-pregame-cdef-wsb-toggle-lobby3fps-fuzzymerge"

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


# Source-video containers. The main per-match recording is a ``.mkv``; a
# separate per-player loadout-card clip is often a ``.mp4`` (e.g. match 463's
# ``silkyjoker85_*.mp4``, which is the SOLE source of that match's loadout
# evidence). Both extensions must be discoverable so a multi-video match is
# re-ingested from every source its active run was built from.
_VIDEO_GLOBS: tuple[str, ...] = ("*.mkv", "*.mp4")


def _resolve_match_dir(match_id: int) -> Path:
    """Resolve the per-match source-video directory under ``DEFAULT_VIDEO_ROOT``.

    On disk the folders use the no-space form ``match<id>`` (e.g. ``match250``);
    the historical space form ``match <id>`` is accepted as a fallback. Both are
    resolved by EXACT directory name — never a prefix glob, so sibling dirs like
    ``match463-label-frames`` or ``match2577-bench-frames`` can't be selected by
    mistake (the G0.1 landmine fix). Raises if neither exact name exists.
    """
    dir_candidates = [
        DEFAULT_VIDEO_ROOT / f"match{match_id}",
        DEFAULT_VIDEO_ROOT / f"match {match_id}",
    ]
    match_dir = next((d for d in dir_candidates if d.is_dir()), None)
    if match_dir is None:
        tried = ", ".join(str(d) for d in dir_candidates)
        raise RuntimeError(
            f"source-video dir not found for match {match_id} "
            f"(tried exact dir names: {tried})"
        )
    return match_dir


def _disk_videos_by_sha(match_dir: Path) -> dict[str, Path]:
    """Map ``sha256 -> path`` for every ``.mkv``/``.mp4`` under ``match_dir``.

    Each file is hashed exactly once. On a byte-identical collision (same
    content under two names) the lexicographically-first path wins, for
    determinism.
    """
    by_sha: dict[str, Path] = {}
    files = sorted(f for glob in _VIDEO_GLOBS for f in match_dir.glob(glob))
    for f in files:
        by_sha.setdefault(_file_sha256(f), f)
    return by_sha


def _resolve_video_paths(match_id: int) -> list[tuple[Path, str]]:
    """Resolve EVERY source video the match's recorded evidence references.

    Multi-video matches (e.g. 463: a main ``.mkv`` + a separate loadout-card
    ``.mp4``) must be re-ingested from ALL of their sources — dropping one loses
    that source's evidence (for 463, the ``.mp4`` carries all loadout cards).

    Looks up the distinct non-null ``video_sha256``s in ``ocr_capture_batches``,
    hashes the ``.mkv``/``.mp4`` files in the per-match folder, and pairs each
    recorded sha with its on-disk file. A recorded sha with no matching file on
    disk (e.g. an original recording since removed) is skipped with a warning;
    at least one must resolve. Returns ``(path, sha)`` sorted by path so the
    first element is a stable "primary" (its sha tags the candidate run).
    """
    rows = _psql_query(
        f"SELECT DISTINCT video_sha256 FROM ocr_capture_batches "
        f"WHERE match_id = {int(match_id)} AND video_sha256 IS NOT NULL"
    )
    recorded = [s.strip() for s in rows.splitlines() if s.strip()]
    if not recorded:
        raise RuntimeError(
            f"no video_sha256 recorded for match {match_id} in "
            f"ocr_capture_batches — re-ingest at least once before reprocess"
        )

    match_dir = _resolve_match_dir(match_id)
    disk_by_sha = _disk_videos_by_sha(match_dir)
    if not disk_by_sha:
        raise RuntimeError(
            f"no {'/'.join(_VIDEO_GLOBS)} files under {match_dir} — "
            f"cannot resolve source video(s) for reprocess"
        )

    resolved = [(disk_by_sha[s], s) for s in recorded if s in disk_by_sha]
    skipped = [s for s in recorded if s not in disk_by_sha]
    if skipped:
        print(
            f"[reprocess] {len(skipped)} recorded video_sha256(s) for match "
            f"{match_id} have no on-disk file — skipped: "
            f"{', '.join(s[:12] + '...' for s in skipped)}",
            file=sys.stderr,
        )
    if not resolved:
        found = ", ".join(f"{p.name}={s[:12]}..." for s, p in disk_by_sha.items())
        want = ", ".join(s[:12] + "..." for s in recorded)
        raise RuntimeError(
            f"none of the {'/'.join(_VIDEO_GLOBS)} files in {match_dir} match a "
            f"recorded video_sha256 for match {match_id}. "
            f"Recorded: {want}. Found on disk: {found}"
        )

    resolved.sort(key=lambda pv: str(pv[0]))
    return resolved


def _resolve_video_path(match_id: int) -> tuple[Path, str]:
    """Single-video resolver (latest recorded sha), retained for callers/tests
    that assume exactly one source. Multi-video matches use
    ``_resolve_video_paths``. Shares the landmine-protected dir resolution.
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

    match_dir = _resolve_match_dir(match_id)
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


# ─── stage timing helper ──────────────────────────────────────────────────────


class _StageTimer:
    """Context manager that records elapsed wall time (ms) into a shared
    ``stages`` dict under ``key``.

    Built on ``time.monotonic()`` (not ``time.perf_counter()``) because
    we're timing across subprocess boundaries — ``monotonic`` is what
    ``subprocess.run`` itself uses internally, so the numbers stay
    consistent end-to-end. ``perf_counter`` is intended for sub-call
    timing and offers no real benefit at the seconds-to-minutes scales
    we report here.
    """

    def __init__(self, stages: dict[str, float], key: str) -> None:
        self._stages = stages
        self._key = key
        self._t0 = 0.0

    def __enter__(self) -> "_StageTimer":
        self._t0 = time.monotonic()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stages[self._key] = (time.monotonic() - self._t0) * 1000.0


# ─── Typer command ────────────────────────────────────────────────────────────


def reprocess(
    match_id: int = typer.Option(..., "--match-id", help="Match id to reprocess."),
    video: Optional[List[Path]] = typer.Option(
        None, "--video", exists=True, readable=True, resolve_path=True,
        help=(
            "Override the source video(s); repeatable (--video A --video B) for a "
            "multi-video match. Otherwise every source is resolved via "
            "ocr_capture_batches.video_sha256."
        ),
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print what would happen without committing."),
    undo: bool = typer.Option(False, "--undo", help="Reverse the most recent activation for this match."),
    halt_before_activate: bool = typer.Option(
        False,
        "--halt-before-activate",
        help=(
            "Run create->ingest->promote->validate (steps 1-6) then STOP before "
            "activate (step 7), printing the candidate run_id. Inserts the "
            "field-benchmark pre-flip gate between the structural validate and the "
            "live flip (Phase G2). Activate the run manually once the gate passes."
        ),
    ),
    version: str = typer.Option("nhl26", "--version", help="UI-config version (nhl26, nhl27, ...)."),
) -> None:
    """Reprocess a match's video against the current v2 weights.

    Default flow (no ``--undo``):

      1. Compute ``weights_hash`` + ``config_hash`` from the v2 artifact files.
      2. Resolve the source video(s) (``--video`` overrides, repeatable;
         else EVERY on-disk source is resolved via
         ``ocr_capture_batches.video_sha256``). A multi-video match (e.g.
         463: main ``.mkv`` + loadout ``.mp4``) resolves to >1 source.
      3. ``decoder-runs-cli create-candidate`` — insert a new
         ``ocr_decoder_runs`` row with ``is_active=false`` (tagged with the
         primary/first video's sha).
      4. (skipped on ``--dry-run``) Run the Pass-1/Pass-2 ingest against
         the candidate run, scoped via ``--run-id`` — once PER source video,
         so all sources land in the same candidate run.
      5. (skipped on ``--dry-run``) Repromote loadout + lobby against
         the candidate run.
      6. (skipped on ``--dry-run``) ``decoder-runs-cli validate``.
         Exit 2 + ``failureReasons`` on failure. With
         ``--halt-before-activate`` the flow STOPS here after a passing
         validate, printing the candidate ``run_id`` so the caller can
         run the Phase-G2 field-benchmark pre-flip gate before flipping.
      7. (skipped on ``--dry-run``) ``decoder-runs-cli activate``.
      8. (skipped on ``--dry-run``) ``consolidate-loadouts`` —
         sets ``review_status='reviewed'`` on the anchor snapshot per
         (team_side, position) via cross-frame consensus. Without this
         the match-quality lineup check is empty and class-G fires on
         every resolved actor.
      9. (skipped on ``--dry-run``) ``backfill-event-actor-resolution``
         — re-resolves actor/target on existing ``match_events`` using
         the new match-scoped resolver. Idempotent; runs OUTSIDE the
         activate transaction.

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

    # Per-stage wall-time accumulator. Populated by ``_StageTimer``
    # below; consumed at end-of-pipeline to emit the run-quality row.
    stages: dict[str, float] = {}

    # 2. Resolve the source video(s) + sha256. `--video` is repeatable; when
    #    absent, resolve every on-disk source the match's evidence references
    #    (a multi-video match re-ingests all of them). `videos[0]` is the
    #    primary — its sha tags the candidate run.
    if video:
        videos = [(v, _file_sha256(v)) for v in video]
    else:
        videos = _resolve_video_paths(match_id)
    primary_path, primary_sha = videos[0]

    # 3. Create the candidate run (tagged with the primary video's sha).
    with _StageTimer(stages, "create_candidate_ms"):
        create_result = _run_decoder_runs_cli(
            "create-candidate",
            "--match-id", str(match_id),
            "--video-sha256", primary_sha,
            "--decoder-version", DECODER_VERSION,
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
                "video_path": str(primary_path),
                "video_sha256": primary_sha,
                "videos": [
                    {"path": str(p), "video_sha256": s} for p, s in videos
                ],
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
                    "would_ingest_video": str(primary_path),
                    "would_ingest_videos": [str(p) for p, _ in videos],
                    "would_repromote_loadout_for_run_id": new_run_id,
                    "would_repromote_lobby_for_run_id": new_run_id,
                    "would_validate_run_id": new_run_id,
                    "would_activate_run_id": new_run_id,
                    "would_consolidate_loadouts_for_match": match_id,
                    "would_backfill_event_actor_resolution_for_match": match_id,
                },
                indent=2,
            )
        )
        return

    # 4. Ingest EACH source into the same candidate run. Long-running
    #    (~30-45 min for a full-length match .mkv; a short loadout .mp4 is
    #    ~1-2 min). One timer spans the whole set so `ingest_ms` is total.
    with _StageTimer(stages, "ingest_ms"):
        for idx, (vpath, _vsha) in enumerate(videos):
            _run_streaming(
                [
                    "python3", "-m", "video_ingest.cli", "ingest",
                    "--video", str(vpath),
                    "--output-root", str(DEFAULT_INGEST_CACHE),
                    "--version", version,
                    "--force-pass1", "--force-pass2",
                    "--dispatch",
                    "--match-id", str(match_id),
                    "--run-id", str(new_run_id),
                    "--game-title-id", str(NHL26_GAME_TITLE_ID),
                ],
                description=(
                    f"ingest match {match_id} video {idx + 1}/{len(videos)} "
                    f"({vpath.name}) into candidate run {new_run_id}"
                ),
            )

    # 5. Promote loadout + lobby against the candidate run.
    #    Unrolled (was a 2-iter loop) so each stage gets its own timer
    #    keyed for the Phase-4 run-quality report.
    with _StageTimer(stages, "repromote_loadout_ms"):
        _run_streaming(
            [
                "pnpm", "--filter", "@eanhl/worker", "repromote-loadout",
                "--",
                "--match", str(match_id),
                "--run-id", str(new_run_id),
            ],
            description=f"repromote-loadout for match {match_id} run {new_run_id}",
        )
    with _StageTimer(stages, "repromote_lobby_ms"):
        _run_streaming(
            [
                "pnpm", "--filter", "@eanhl/worker", "repromote-lobby",
                "--",
                "--match", str(match_id),
                "--run-id", str(new_run_id),
            ],
            description=f"repromote-lobby for match {match_id} run {new_run_id}",
        )

    # 6. Validate. exit 2 = fail-soft from the worker side.
    with _StageTimer(stages, "validate_ms"):
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

    # Surface non-fatal extractor warnings explicitly on the success path. These
    # are recorded with transform_status='error' (audit) but classified
    # non-blocking by the validate gate (e.g. unreadable period labels on
    # secondary post-game screens). `**val` already carries them inside
    # `details`, but make them visible so the operator sees what was skipped.
    warnings = (val.get("details", {}) or {}).get("warningExtractorErrors", []) or []
    if warnings:
        total = sum(int(w.get("count", 0)) for w in warnings)
        summary = ", ".join(f"{w.get('kind')}={w.get('count')}" for w in warnings)
        typer.echo(
            f"validate passed with {total} non-fatal extractor warning(s): {summary}",
            err=True,
        )

    # 6b. Phase-G2 pre-flip halt. Stop after a passing structural validate,
    #     before the atomic activate, so the caller can score the candidate's
    #     TRUE consolidated surface against the per-field benchmark
    #     (`validate-consolidated --run-id K` -> `score_field_benchmark.py
    #     --from-consolidated`). The field-benchmark gate is fail-closed:
    #     activate only on a pass. The candidate run persists (is_active=false)
    #     until the operator flips it with `decoder-runs activate --run-id K`.
    if halt_before_activate:
        typer.echo(
            json.dumps(
                {
                    "step": "halt-before-activate",
                    "halted": True,
                    "match_id": match_id,
                    "candidate_run_id": new_run_id,
                    "next": (
                        "score the pre-flip gate on this candidate run, then "
                        f"`decoder-runs activate --run-id {new_run_id}` if it passes"
                    ),
                },
                indent=2,
            )
        )
        return

    # 7. Activate. Flips is_active, rebuilds canonicals, recomputes
    # match colours — all atomic on the TS side.
    with _StageTimer(stages, "activate_ms"):
        act = _run_decoder_runs_cli("activate", "--run-id", str(new_run_id))
    typer.echo(json.dumps({"step": "activate", **act}, indent=2))

    # 8. consolidate-loadouts — sets review_status='reviewed' on the
    #    anchor snapshot per (team_side, position) via cross-frame
    #    consensus. Required because the match-quality CLI's class-G
    #    lineup check (apps/worker/src/match-quality-cli.ts) filters
    #    to reviewed-only snapshots; without consolidate the lineup
    #    subquery is empty and every resolved actor trips the leak
    #    flag. Runs OUTSIDE the activate transaction — idempotent.
    with _StageTimer(stages, "consolidate_loadouts_ms"):
        _run_streaming(
            [
                "pnpm", "--filter", "@eanhl/worker", "consolidate-loadouts",
                "--",
                "--match", str(match_id),
            ],
            description=f"consolidate-loadouts for match {match_id}",
        )

    # 9. backfill-event-actor-resolution — re-resolves actor/target on
    #    existing match_events using the new match-scoped resolver
    #    (Commit 1 — resolveActorForMatch). Nulls out wrong-roster
    #    hits, binds previously-unresolved actors that now appear in
    #    lineup. Symmetric on match_goal_events + match_penalty_events.
    #    Idempotent — safe to re-run.
    with _StageTimer(stages, "backfill_event_actor_resolution_ms"):
        _run_streaming(
            [
                "pnpm", "--filter", "@eanhl/worker", "backfill-event-actor-resolution",
                "--",
                "--match", str(match_id),
            ],
            description=f"backfill-event-actor-resolution for match {match_id}",
        )

    # 10. Best-effort run-quality row emission. Writes the per-stage
    #     wall-time accumulator to a tempfile, then shells out to the
    #     Phase-3 worker CLI to persist a row into ocr_run_quality_reports.
    #     Failures are logged to stderr and the row is skipped, but the
    #     reprocess still exits 0. A failed file write short-circuits past
    #     the TS CLI emit (no point calling the CLI with a non-existent
    #     path); a failed TS CLI exit similarly leaves no row but doesn't
    #     propagate. The operator can later run `pnpm --filter
    #     @eanhl/worker run-quality --run-id N --emit-row --stage-runtimes
    #     <path>` manually if the file is still on disk, or `--all-runs
    #     --emit-row` for a content-only retroactive report.
    #
    #     --force is always passed: completed_at gets stamped during the
    #     activate step (step 7) so a concurrent `--all-runs --emit-row`
    #     can sneak in and write a content-only backfill row during steps
    #     8-10. Without --force, our final emit (the real source-of-truth
    #     path — we have the actual --stage-runtimes) would conflict and
    #     the best-effort try/except would swallow it, permanently leaving
    #     the backfill row behind. With --force, reprocess always wins.
    #     This is safe because (a) reprocess.py IS the source-of-truth
    #     path for this run's quality report, and (b) the writer's
    #     ON CONFLICT DO UPDATE preserves existing runtime fields when
    #     fed nulls (see upsertRunQualityReport in
    #     packages/db/src/queries/run-quality.ts), so a backfill row
    #     written between activate and this emit can't destroy our
    #     measured runtime even if it landed first.
    total_wall_ms = int(sum(stages.values()))
    stage_runtimes_path = (
        DEFAULT_INGEST_CACHE / f"run-{new_run_id}-stage-runtimes.json"
    )

    # Phase 4 Part B: read the per-run sidecar the orchestrator wrote at
    # the end of the `ingest` subprocess. Path is run-scoped to avoid
    # cross-run overwrite when two reprocesses race on the same video
    # sha. Missing file (older orchestrator, write failure, or non-ingest
    # path) → all new keys land as null in the persisted row; the TS
    # loader accepts null/missing.
    ingest_timings_path = (
        DEFAULT_INGEST_CACHE / video_sha256 / f"ingest-run-{new_run_id}-timings.json"
    )
    ingest_timings: dict | None = None
    if ingest_timings_path.exists():
        try:
            ingest_timings = json.loads(ingest_timings_path.read_text())
        except Exception as e:  # noqa: BLE001 — best-effort
            typer.echo(
                f"[run-quality] ingest_timings parse failed (treating as missing): {e}",
                err=True,
            )

    stage_runtimes_payload = {
        "stages": {
            # Coerce float ms → int ms for the persisted row (DB column
            # is integer-typed). The TS-side validator accepts both.
            **{k: int(v) for k, v in stages.items()},
            # The emit's own wall time would belong here, but we cannot
            # record it in the file we're about to write (it's the wall
            # time of writing this file + the shell-out itself). Leave
            # null for v1; the validator accepts null/missing.
            "run_quality_emit_ms": None,
            # Phase 4 Part B: five new Pass-1 sub-phase + Pass-2 keys.
            # All null when the sidecar is missing so downstream analytics
            # can distinguish "didn't measure" from "measured zero."
            "pass1_ms": (
                int(ingest_timings["pass1_ms"]) if ingest_timings else None
            ),
            "pass2_ms": (
                int(ingest_timings["pass2_ms"]) if ingest_timings else None
            ),
            "pass1_decode_ms": (
                int(ingest_timings["pass1_decode_ms"]) if ingest_timings else None
            ),
            "pass1_classify_ms": (
                int(ingest_timings["pass1_classify_ms"]) if ingest_timings else None
            ),
            "pass1_viterbi_ms": (
                int(ingest_timings["pass1_viterbi_ms"]) if ingest_timings else None
            ),
            # WS1b: Visual-Prefilter Pass-2 selection telemetry. Unlike the
            # Phase-4 keys above, these can be null WITHIN a present sidecar
            # (prefilter disabled → orchestrator writes null), so guard on the
            # value, not just sidecar presence, before coercing to int.
            "prefilter_frames_scanned": (
                int(ingest_timings["prefilter_frames_scanned"])
                if ingest_timings
                and ingest_timings.get("prefilter_frames_scanned") is not None
                else None
            ),
            "prefilter_frames_selected": (
                int(ingest_timings["prefilter_frames_selected"])
                if ingest_timings
                and ingest_timings.get("prefilter_frames_selected") is not None
                else None
            ),
            "prefilter_selection_ms": (
                int(ingest_timings["prefilter_selection_ms"])
                if ingest_timings
                and ingest_timings.get("prefilter_selection_ms") is not None
                else None
            ),
        },
        "total_wall_ms": total_wall_ms,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "captured_from": "reprocess.py",
        # Phase 4 Part B: top-level (NOT in stages) — boolean, follows the
        # TS-side schema where stages is timing-only and pass1_cache_hit
        # lands at the same level as total_wall_ms / captured_at.
        "pass1_cache_hit": (
            ingest_timings["pass1_cache_hit"] if ingest_timings else None
        ),
    }
    try:
        stage_runtimes_path.parent.mkdir(parents=True, exist_ok=True)
        stage_runtimes_path.write_text(json.dumps(stage_runtimes_payload, indent=2))
    except Exception as e:  # noqa: BLE001 — best-effort
        typer.echo(
            f"[run-quality] stage-runtimes file write failed: {e}", err=True
        )
        return

    try:
        emit_t0 = time.monotonic()
        emit_result = subprocess.run(
            [
                "pnpm", "--filter", "@eanhl/worker", "run-quality",
                "--run-id", str(new_run_id),
                "--emit-row",
                "--force",
                "--stage-runtimes", str(stage_runtimes_path),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        emit_wall_ms = int((time.monotonic() - emit_t0) * 1000.0)
        if emit_result.returncode == 0:
            # NOTE: emit_wall_ms is the wall time of the emit itself.
            # It's NOT recorded into the row (would require re-emit).
            # Logged to stderr only for operator visibility.
            typer.echo(
                f"[run-quality] row emitted (emit_wall_ms={emit_wall_ms})",
                err=True,
            )
            if emit_result.stdout.strip():
                typer.echo(emit_result.stdout, err=True)
        else:
            typer.echo(
                f"[run-quality] emit failed (exit {emit_result.returncode})\n"
                f"  stdout: {emit_result.stdout.strip()}\n"
                f"  stderr: {emit_result.stderr.strip()}",
                err=True,
            )
    except Exception as e:  # noqa: BLE001 — best-effort
        typer.echo(f"[run-quality] emit threw: {e}", err=True)
