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

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from video_ingest.pass2_extract import Pass2Result


class ReelMapLookupError(RuntimeError):
    """The confirmed reel→match map could NOT be read — a lookup FAILURE, which
    is distinct from a clean empty result.

    Raised on any failure to obtain the map: pnpm absent, ``resolve-match
    reel-map`` non-zero exit, a launch exception, or stdout that carries no
    parseable JSON object. A *genuine* empty map (clean exit, valid empty
    object) is ``{}`` — NOT this error. Callers use the distinction to tell
    "the operator has confirmed nothing yet" (``{}`` → defer) from "I could not
    read the map" (raise → the caller decides whether that is fatal). See
    :func:`resolve_confirmed_reel_match_ids` for the best-effort-vs-strict policy
    layered on top.
    """


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


def _parse_reel_map(stdout: str) -> dict[int, int]:
    """Parse the ``resolve-match reel-map`` stdout into ``{reel_index: match_id}``.

    The CLI prints one JSON object line (``{"0": 972, "1": 973}``); pnpm may
    prepend banner lines, so scan bottom-up for the last ``{``-line and parse it
    (mirrors ``reprocess._run_decoder_runs_cli``). Keys arrive as JSON strings →
    coerced to int. A clean, valid object (including an empty ``{}``) returns the
    parsed map. Raises :class:`ReelMapLookupError` when the payload could NOT be
    read as a map — a ``{``-line that is not valid JSON, or no JSON object line
    at all — so a garbled/banner-only stdout is never silently mistaken for "no
    confirmations yet". Per-key coercion stays lenient: one un-int-able entry is
    skipped, not fatal.
    """
    for line in stdout.strip().splitlines()[::-1]:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            raw = json.loads(line)
        except (ValueError, TypeError) as exc:
            raise ReelMapLookupError(
                f"reel-map stdout had a '{{'-line that is not valid JSON: "
                f"{line[:120]!r}"
            ) from exc
        out: dict[int, int] = {}
        for k, v in raw.items():
            try:
                out[int(k)] = int(v)
            except (ValueError, TypeError):
                continue
        return out
    raise ReelMapLookupError(
        f"reel-map stdout carried no JSON object line (got {stdout.strip()[:200]!r})"
    )


def load_confirmed_reel_map(
    video_sha256: str,
    *,
    repo_root: Path | None = None,
) -> dict[int, int]:
    """Read the operator-confirmed reel→match map for a video (Milestone ②
    step (3)) by shelling out to the worker ``resolve-match reel-map`` CLI — the
    cross-language delivery channel, the same subprocess-to-worker pattern as
    ``dispatch_segments`` / ``reprocess._run_decoder_runs_cli``.

    Returns ``{reel_index: match_id}`` for every reel the operator has CONFIRMED
    (via ``resolve-match propose``/``confirm`` over the identity files emitted on
    a prior pass). Returns ``{}`` ONLY on a clean lookup that found nothing
    confirmed yet. Raises :class:`ReelMapLookupError` on ANY lookup FAILURE (pnpm
    absent, non-zero exit, launch error, or unparseable stdout) — the failure is
    no longer swallowed as an empty map. The best-effort-vs-abort decision is the
    caller's: :func:`resolve_confirmed_reel_match_ids` defers on failure by
    default but can be told to treat a failure as fatal (the promote pass, which
    KNOWS a confirmed map is expected).
    """
    root = repo_root or find_repo_root()
    pnpm = shutil.which("pnpm")
    if not pnpm:
        raise ReelMapLookupError("pnpm not on PATH — cannot read confirmed reel map")
    cmd = [
        pnpm, "--filter", "worker", "resolve-match", "reel-map",
        "--video-sha256", video_sha256,
    ]
    try:
        proc = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True)
    except Exception as exc:  # noqa: BLE001 — reshaped into a typed lookup error
        raise ReelMapLookupError(f"reel-map lookup failed to launch: {exc}") from exc
    if proc.returncode != 0:
        raise ReelMapLookupError(
            f"reel-map lookup exited {proc.returncode} "
            f"(stderr: {proc.stderr.strip()[:200]})"
        )
    return _parse_reel_map(proc.stdout)


def resolve_confirmed_reel_match_ids(
    video_sha256: str,
    *,
    require_reel_map: bool = False,
    repo_root: Path | None = None,
) -> dict[int, int] | None:
    """The dispatch-facing reel→match map, with the best-effort-vs-strict policy
    that :func:`load_confirmed_reel_map` deliberately does not decide.

    Returns the confirmed ``{reel_index: match_id}`` map, or ``None`` when the
    caller should stay in the deferred branch (nothing to collapse).

    ``require_reel_map`` selects the policy for the two "no usable map" cases —
    a lookup FAILURE and a genuinely EMPTY map:

      * ``False`` (default — the fresh Pass-1 / manual ``--match-id`` paths, where
        an unconfirmed video legitimately has no map): a lookup failure is logged
        LOUDLY and folded into "defer" (``None``); an empty map is ``None`` too.
        A missing or failed map never aborts the run.
      * ``True`` (the promote pass, which has already read the confirmed
        associations from the DB and so EXPECTS a non-empty map): BOTH a lookup
        failure AND an empty map raise :class:`ReelMapLookupError`. An empty map
        under this flag means the association ledger and ``resolve-match
        reel-map`` disagree — a real fault, not "nothing confirmed". Raising turns
        what used to be a silent no-op drain (reels re-OCR'd for hours, nothing
        promoted, run summary falsely "promoted") into a loud, honest failure.
    """
    try:
        confirmed = load_confirmed_reel_map(video_sha256, repo_root=repo_root)
    except ReelMapLookupError as exc:
        if require_reel_map:
            raise
        print(
            f"[reels] confirmed reel-map lookup FAILED ({exc}) — deferring. "
            f"Harmless before association; a promote-pass drain if a confirmed "
            f"video reaches here.",
            file=sys.stderr,
        )
        return None
    if require_reel_map and not confirmed:
        raise ReelMapLookupError(
            f"--require-reel-map set but the confirmed reel-map for "
            f"{video_sha256[:12]} is EMPTY — the association ledger and "
            f"`resolve-match reel-map` disagree."
        )
    return confirmed or None


def dispatch_segments(
    results: Iterable[Pass2Result],
    *,
    game_title_id: int,
    match_id: int | None,
    video_sha256: str,
    ui_version: str = "nhl26",
    decoder_version: str = "legacy-passthrough-v0-video",
    loadout_engine: str = "legacy",
    lobby_engine: str = "legacy",
    repo_root: Path | None = None,
    dry_run: bool = False,
    run_id: int | None = None,
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
            # Pass-2-supplied frame count. The worker uses this directly for
            # typed_v1 segments (skipping the legacy game_ocr.cli subprocess +
            # PNG glob entirely); legacy segments still derive frame count
            # from `cli.results.length` and ignore this flag.
            "--frame-count", str(r.frame_count),
            "--ui-version", ui_version,
            "--decoder-version", decoder_version,
            "--notes",
            f"video_ingest:seg{r.segment_index:03d}:[{r.start_seconds:.1f}..{r.end_seconds:.1f}]s",
        ]
        if match_id is not None:
            cmd.extend(["--match-id", str(match_id)])
        # Phase-A: decoder-run scope. When the orchestrator was invoked
        # via `video_ingest reprocess --match-id N`, the reprocess CLI
        # creates a candidate ocr_decoder_runs row up front and passes
        # its id here. Every worker-side insert gets tagged with this
        # run_id; live-read queries gate on (is_active OR NULL).
        if run_id is not None:
            cmd.extend(["--run-id", str(run_id)])
        # Task 2A-11: loadout-engine flag (always present; default 'legacy').
        cmd.extend(["--loadout-engine", loadout_engine])
        # Task 2A-11: loadout-evidence-json flag (typed_v1 only, file must exist).
        if loadout_engine == "typed_v1":
            loadout_evidence_path = r.directory / "loadout_evidence.json"
            if loadout_evidence_path.exists():
                cmd.extend(["--loadout-evidence-json", str(loadout_evidence_path)])
        # Task 3B-5: lobby-engine flag (always present; default 'legacy').
        cmd.extend(["--lobby-engine", lobby_engine])
        # Task 3B-5: lobby-evidence-json flag (typed_v1 only, file must exist).
        if lobby_engine == "typed_v1":
            lobby_evidence_path = r.directory / "lobby_evidence.json"
            if lobby_evidence_path.exists():
                cmd.extend(["--lobby-evidence-json", str(lobby_evidence_path)])
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
