"""Milestone ④ — unattended mass-ingest batch runner.

Task 4.1 (this file's first slice) is the pure corpus-planning front of the
run loop: enumerate the target videos on disk, dedup byte-identical copies by
sha, and prioritize the work queue. Tasks 4.2 (GPU-venv preflight) and 4.3
(the run loop + review-queue emission) build on top of these here and register
the ``batch`` Typer command in ``cli.py``.

Design notes:

- **Streaming sha (divergence from the plan's "reuse ``reprocess._file_sha256``").**
  ``reprocess._file_sha256`` reads the whole file into memory — fine for the
  <10 MB v2 artifacts it was written for, but the corpus this batch walks holds
  ``.mkv`` recordings up to ~22 GB. A full ``read_bytes()`` on those would OOM,
  so ``_file_sha256`` here hashes in fixed chunks. Same hex digest, bounded RAM.

- **``already_ingested`` only.** The DB-derived signals (``api_missed`` — "no
  ``matches`` row near the basename timestamp" — and the resulting ``priority``)
  are refined by the Task 4.3 run loop, which has the DB handle. Task 4.1 leaves
  them at neutral defaults (``api_missed=False``, ``priority=PRIORITY_API_COVERED``)
  so the pure layer stays DB-free and unit-testable. ``prioritize`` sorts on
  whatever ``priority`` the run loop has stamped.

- **Cached digests.** Planning hashes the whole corpus on every pass, so the
  digests are memoized on ``(path, size, mtime_ns)`` — see the sha-cache section.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import pkgutil
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import typer

from video_ingest.identity_probe import parse_basename_epoch
from video_ingest.reprocess import (
    DEFAULT_INGEST_CACHE,
    NHL26_GAME_TITLE_ID,
    _psql_query,
    _run_streaming,
)


# ─── constants ────────────────────────────────────────────────────────────────

# Source-video containers (mirror reprocess._VIDEO_GLOBS). ``Path.suffix`` is the
# LAST suffix only, so ".remuxed.mkv" → ".mkv" and "- Trim.mp4" → ".mp4" are both
# covered by this set.
VIDEO_SUFFIXES: tuple[str, ...] = (".mkv", ".mp4")

# Per-match folders are the EXACT ``match<digits>`` form. The trailing-``$`` anchor
# excludes the landmine siblings that share the prefix — ``match2577-bench-frames``,
# ``match463-label-frames`` — exactly as reprocess._resolve_match_dir guards against.
_MATCH_DIR_RE = re.compile(r"^match\d+$")

# Every recording basename leads with an ISO date ("2026-05-22_19-07-03",
# "2026-05-20 18-15-59" — underscore or space separator). We only need the leading
# YYYY-MM-DD for the ``since`` window, so parse just those 10 chars (separator-agnostic).
_DATE_PREFIX_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")

# Priority bands for the run queue (lower = run first).
PRIORITY_API_MISSED = 0  # no matching EA-API match row — the batch's reason to exist
PRIORITY_API_COVERED = 1  # an API match row already exists (verifiable, lower urgency)
PRIORITY_PARTIAL = 2  # short/partial recording (no full game) — run last

_SHA_CHUNK = 1 << 20  # 1 MiB streaming read


@dataclass
class BatchTarget:
    """One deduped video queued for ingest.

    ``already_ingested`` is set here (Task 4.1) from ``ocr_capture_batches``
    shas. ``api_missed`` / ``priority`` are refined by the Task 4.3 run loop
    (they need a DB handle); they default to the neutral "api-covered" band.
    """

    path: Path
    sha256: str
    kind: str  # 'match_folder' | 'loose'
    already_ingested: bool = False
    api_missed: bool = False
    priority: int = PRIORITY_API_COVERED


# ─── hashing (streaming; bounded RAM for multi-GB recordings) ─────────────────


def _file_sha256(path: Path) -> str:
    """sha256 of the file at ``path``, read in ``_SHA_CHUNK`` blocks.

    Streaming (not ``read_bytes()``) because the batch hashes ``.mkv`` files up
    to ~22 GB — reading one whole into memory would OOM the box.
    """
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(_SHA_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


# ─── sha cache ────────────────────────────────────────────────────────────────
#
# Planning streams every byte of the corpus through sha256 on EVERY pass — ~82 GB
# ⇒ ~20 min (this drive measures 59-79 MB/s) — and ``--limit`` does not bound it:
# the limit slices the plan AFTER dedup. Chunked runs are the normal mode
# (``already_ingested`` skipping, plus a full run measured in tens of hours that
# cannot happen in one sitting), so the plan is re-run many times and pays that
# cost each time. Keying each digest to ``(path, size, mtime_ns)`` makes a
# re-plan over an unchanged corpus near-instant.
#
# Every operation here is BEST-EFFORT by contract: a missing, corrupt, or
# unwritable cache costs a re-hash, never the run. The cache sits beside the
# Pass-2 frames in ``DEFAULT_INGEST_CACHE``, which the pipeline already treats as
# durable across runs — anything that wipes it loses the far more expensive
# decode cache first, next to which a re-hash is noise.

_SHA_CACHE_NAME = "sha-cache.json"


def _sha_cache_path() -> Path:
    return DEFAULT_INGEST_CACHE / _SHA_CACHE_NAME


def load_sha_cache(path: Path | None = None) -> dict[str, dict]:
    """The persisted ``{path: {size, mtime_ns, sha256}}`` map, or ``{}``.

    Absent (first run), unreadable, corrupt (a crash mid-write), or not a JSON
    object all degrade to an empty cache — i.e. a full re-hash, which is exactly
    the pre-cache behavior.
    """
    p = _sha_cache_path() if path is None else path
    try:
        payload = json.loads(p.read_text())
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def save_sha_cache(cache: dict[str, dict], path: Path | None = None) -> None:
    """Persist ``cache``, warning (never raising) if it cannot be written.

    Written to a sibling temp file and ``replace``d in, so a crash part-way
    through cannot leave a truncated cache behind: the live file is either the
    old complete one or the new complete one.

    Entries for files no longer on disk are NOT pruned. The file is tiny (the
    corpus is <100 recordings ⇒ ~10 KB) and a narrower ``--since`` window on one
    run must not evict digests a wider window still wants on the next.
    """
    p = _sha_cache_path() if path is None else path
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(f"{p.name}.tmp")
        tmp.write_text(json.dumps(cache, indent=2, sort_keys=True))
        tmp.replace(p)
    except OSError as exc:
        typer.echo(f"[batch] WARN: could not write the sha cache {p}: {exc}", err=True)


def _entry_is_current(entry: object, st: os.stat_result) -> bool:
    """Whether a cache entry still describes the file ``st`` was taken from.

    Defensive about shape as well as freshness: the cache is JSON on disk and may
    have been hand-edited or half-written, so a malformed entry reads as a miss
    rather than crashing the plan.
    """
    return (
        isinstance(entry, dict)
        and entry.get("size") == st.st_size
        and entry.get("mtime_ns") == st.st_mtime_ns
        and isinstance(entry.get("sha256"), str)
    )


def _cached_file_sha256(path: Path, cache: dict[str, dict] | None) -> str:
    """:func:`_file_sha256` memoized on ``(path, size, mtime_ns)``.

    ``cache=None`` bypasses memoization entirely (hash every call). On a miss the
    freshly computed digest is recorded into ``cache`` in place; the caller owns
    persisting it.

    Size AND mtime must both match: mtime alone would serve a stale digest for a
    still-growing recording, and size alone for an edit that preserved length.
    """
    if cache is None:
        return _file_sha256(path)

    st = path.stat()
    key = str(path)
    entry = cache.get(key)
    if _entry_is_current(entry, st):
        return entry["sha256"]  # type: ignore[index]

    sha = _file_sha256(path)
    cache[key] = {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "sha256": sha}
    return sha


# ─── enumerate ────────────────────────────────────────────────────────────────


def _basename_date(path: Path) -> date | None:
    """The leading ``YYYY-MM-DD`` of the recording basename, or ``None`` if the
    name does not start with a valid ISO date (e.g. a non-timestamped clip)."""
    m = _DATE_PREFIX_RE.match(path.name)
    if m is None:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _iter_videos(directory: Path) -> list[Path]:
    """The ``.mkv``/``.mp4`` files directly under ``directory`` (non-recursive),
    sorted for determinism."""
    return sorted(
        f
        for f in directory.iterdir()
        if f.is_file() and f.suffix in VIDEO_SUFFIXES
    )


def _in_window(path: Path, since: date) -> bool:
    d = _basename_date(path)
    return d is not None and d >= since


def enumerate_targets(video_root: Path, since: date) -> list[Path]:
    """Candidate video paths under ``video_root`` with basename date ``>= since``.

    Two sources, both non-recursive:
      - **loose** recordings directly under ``video_root``;
      - videos inside exact ``match<id>/`` folders (landmine siblings such as
        ``match2577-bench-frames`` are excluded by the anchored regex).

    A file whose basename does not lead with a parseable ISO date is dropped —
    we cannot place it in the ``since`` window (and non-timestamped clips are not
    full-game recordings the batch ingests). Deterministic, sorted order.
    """
    loose = [f for f in _iter_videos(video_root) if _in_window(f, since)]

    folder: list[Path] = []
    for sub in sorted(video_root.iterdir()):
        if sub.is_dir() and _MATCH_DIR_RE.match(sub.name):
            folder.extend(f for f in _iter_videos(sub) if _in_window(f, since))

    return sorted(loose + folder)


# ─── dedup ────────────────────────────────────────────────────────────────────


def _classify_kind(path: Path) -> str:
    """'match_folder' if the immediate parent is an exact ``match<id>`` dir,
    else 'loose'."""
    return "match_folder" if _MATCH_DIR_RE.match(path.parent.name) else "loose"


def dedup_by_sha(
    paths: list[Path],
    known_shas: set[str],
    *,
    cache: dict[str, dict] | None = None,
) -> list[BatchTarget]:
    """Collapse byte-identical copies to one :class:`BatchTarget` per sha.

    A recording often exists as several containers with identical bytes (``.mkv``
    + ``.mp4`` remux, ``- Trim`` copy); those must ingest once. Paths are sorted
    first, so the lexicographically-first path wins each sha (deterministic,
    matching ``reprocess._disk_videos_by_sha``'s ``setdefault`` first-wins).

    ``already_ingested`` is ``True`` when the sha is in ``known_shas`` (the
    distinct ``ocr_capture_batches.video_sha256`` set). Result order follows the
    first-seen (sorted) path.

    ``cache`` (optional) memoizes the digests — see :func:`_cached_file_sha256`;
    misses are recorded into it in place for the caller to persist.

    A file whose hash RAISES (an unreadable block on a crashed recording, a path
    that vanished mid-plan) is logged and dropped from the queue. Hashing needs
    the same per-file isolation :func:`run_batch` gives the ingest phase:
    unguarded, one bad file aborts the entire plan before any target runs.
    """
    by_sha: dict[str, Path] = {}
    for p in sorted(paths, key=str):
        try:
            sha = _cached_file_sha256(p, cache)
        except Exception as exc:  # noqa: BLE001 — per-file isolation, keep planning
            typer.echo(f"[batch] SKIP (hash failed) {p.name}: {exc}", err=True)
            continue
        by_sha.setdefault(sha, p)

    return [
        BatchTarget(
            path=p,
            sha256=sha,
            kind=_classify_kind(p),
            already_ingested=sha in known_shas,
        )
        for sha, p in by_sha.items()
    ]


# ─── prioritize ───────────────────────────────────────────────────────────────


def prioritize(targets: list[BatchTarget]) -> list[BatchTarget]:
    """Return a NEW list ordered by ``priority`` ascending (api-missed(0) <
    api-covered(1) < partial(2)).

    Stable within a priority band (``sorted`` is stable), so the run loop's
    incoming order is preserved for equal-priority targets. Input list is not
    mutated.
    """
    return sorted(targets, key=lambda t: t.priority)


# ─── preflight (GPU-venv closure smoke test) ──────────────────────────────────

# Third-party wheels the OCR closure needs at runtime. These are exactly the ones
# that vanish when an OCR venv is `uv sync`'d ([[reference_gpu_ocr_venv]]): pydantic
# (the extractor's data models), onnxruntime (the CUDA execution provider), and the
# rapidocr_onnxruntime backend. Listed before rapidocr so a lost onnxruntime is
# reported as onnxruntime rather than swallowed by rapidocr's transitive import.
_PREFLIGHT_THIRD_PARTY: tuple[str, ...] = (
    "pydantic",
    "onnxruntime",
    "rapidocr_onnxruntime",
)

# First-party packages whose EVERY submodule is walk-imported. Discovered at call
# time (not hand-listed) so a module added later can't silently escape the smoke —
# a stale hand-list is precisely the too-narrow-smoke that let a lost pydantic
# crash a re-ingest 37 min in ([[reference_gpu_ocr_venv]]).
_PREFLIGHT_PACKAGES: tuple[str, ...] = ("video_ingest", "game_ocr")


def _preflight_modules() -> list[str]:
    """The full import closure the run loop depends on: the critical third-party
    wheels followed by every ``video_ingest``/``game_ocr`` submodule.

    Submodules are discovered with ``pkgutil.iter_modules`` (a filesystem scan of
    each package's ``__path__`` — it does NOT import them), so the list stays in
    lockstep with the tree. Importing the package itself is a cheap ``__init__``
    (game_ocr's is a docstring; video_ingest's only bootstraps sys.path).
    """
    names: list[str] = list(_PREFLIGHT_THIRD_PARTY)
    for pkg_name in _PREFLIGHT_PACKAGES:
        pkg = importlib.import_module(pkg_name)
        names.extend(
            info.name
            for info in pkgutil.iter_modules(pkg.__path__, prefix=f"{pkg_name}.")
        )
    return names


def preflight() -> None:
    """Walk-import the full OCR closure, raising ``RuntimeError`` on the first gap.

    MANDATORY before the run loop (Task 4.3): an unattended corpus run spends
    ~30-45 min of GPU time per video, so a wheel missing deep in the closure (the
    lost-pydantic case above) must fail here — in under a second — rather than
    tens of minutes into a decode. Importing eagerly forces every lazy import to
    resolve up front.

    Raises ``RuntimeError`` naming the offending module on any ``ImportError``;
    the original error is chained as ``__cause__`` for the traceback.
    """
    for name in _preflight_modules():
        try:
            importlib.import_module(name)
        except ImportError as exc:
            raise RuntimeError(
                f"preflight: cannot import {name!r} — the OCR venv closure is "
                f"incomplete (see reference_gpu_ocr_venv): {exc}"
            ) from exc


# ─── run loop (Task 4.3) ──────────────────────────────────────────────────────
#
# ``run_batch`` is the unattended first pass over the corpus: preflight once,
# then per target (in priority order) fresh-ingest → propose associations →
# STOP at the operator-confirm gate. It never confirms or promotes — the
# operator-confirmed ② association is the hard promotion gate, and promotion of
# confirmed reels (per-reel Pass-2 + ``run-quality --emit-row`` carrying 4.G's
# coverage-aware L4) is a SEPARATE later pass, out of this first-pass loop.
#
# KEY DIVERGENCE from the plan's "create-candidate (mint run_id) → ingest" line:
# that predates ②'s on-box finding that a fresh multi-reel video ingests with
# ``run_id=NULL``. ``ocr_decoder_runs.match_id`` is NOT NULL, so no candidate run
# can be minted before the reel→match association is known — which is precisely
# what this batch is trying to discover. ``create-candidate`` is a
# reprocess-of-a-KNOWN-match operation; the fresh mass-ingest path is run_id=NULL
# (see HANDOFF ② learnings). Per-video try/except isolates a corrupt/oversized
# file (log + skip, keep going) so one bad recording can't abort the run.

# Leading recording stamp ("2026-05-22_19-07-03" or the older space form),
# normalized to the underscore form ``parse_basename_epoch`` (strict strptime)
# expects. A basename without one cannot be windowed against the API.
_STAMP_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})[ _](\d{2}-\d{2}-\d{2})")

# ±window around a recording's stamp within which an EA-API ``matches`` row counts
# as covering it — the ② association scorer's σ≈3h timestamp Gaussian.
_MATCH_WINDOW_S = 3 * 60 * 60


def _basename_stamp(path: Path) -> str | None:
    """The leading wall-clock stamp of ``path`` normalized to underscore form
    (``2026-05-22_19-07-03``), or ``None`` if the basename has no stamp."""
    m = _STAMP_RE.match(path.name)
    if m is None:
        return None
    return f"{m.group(1)}_{m.group(2)}"


def _known_shas() -> set[str]:
    """The distinct ``ocr_capture_batches.video_sha256`` set — videos already
    ingested at least once, so the batch can flag/skip them."""
    out = _psql_query(
        "SELECT DISTINCT video_sha256 FROM ocr_capture_batches "
        "WHERE video_sha256 IS NOT NULL"
    )
    return {line.strip() for line in out.splitlines() if line.strip()}


def _refine_target(target: BatchTarget) -> BatchTarget:
    """Stamp ``api_missed`` / ``priority`` from the DB (mutates + returns
    ``target``).

    ``api_missed`` is the batch's reason to exist: no EA-API ``matches`` row
    within ±:data:`_MATCH_WINDOW_S` of the recording stamp ⇒ the game was never
    captured by the API poller and OCR is the only source ⇒ run it first
    (priority 0). A covered recording is verifiable and lower urgency (1).
    A basename without a parseable stamp cannot be windowed, so it keeps the
    neutral band and never hits the DB.
    """
    stamp = _basename_stamp(target.path)
    if stamp is None:
        return target
    epoch = parse_basename_epoch(stamp)
    out = _psql_query(
        f"SELECT count(*) FROM matches "
        f"WHERE game_title_id = {NHL26_GAME_TITLE_ID} "
        f"AND abs(extract(epoch FROM played_at) - {epoch}) <= {_MATCH_WINDOW_S}"
    )
    covered = out.strip().isdigit() and int(out.strip()) > 0
    target.api_missed = not covered
    target.priority = PRIORITY_API_COVERED if covered else PRIORITY_API_MISSED
    return target


def _collect_targets(video_root: Path, since: date) -> list[BatchTarget]:
    """Enumerate → dedup → DB-refine the corpus into an (unordered) target list.

    Encapsulates every DB read of the planning phase; the run loop prioritizes
    the result. Split out so the loop is unit-testable by stubbing this one seam.

    The sha cache is loaded here and saved right after the dedup that fills it,
    so the digests survive even if a later phase throws.
    """
    known = _known_shas()
    paths = enumerate_targets(video_root, since)
    cache = load_sha_cache()
    targets = dedup_by_sha(paths, known, cache=cache)
    save_sha_cache(cache)
    return [_refine_target(t) for t in targets]


def _echo_plan(targets: list[BatchTarget], *, dry_run: bool) -> None:
    """Print the enumerated/deduped/prioritized work queue to stderr."""
    mode = "DRY-RUN plan" if dry_run else "run plan"
    typer.echo(f"\n[batch] {mode}: {len(targets)} target(s)", err=True)
    for i, t in enumerate(targets, 1):
        flag = " [already-ingested]" if t.already_ingested else ""
        typer.echo(
            f"  {i}. p{t.priority} {t.kind:12s} {t.path.name} "
            f"(sha {t.sha256[:12]}){flag}",
            err=True,
        )


def _process_target(target: BatchTarget, *, dry_run: bool) -> None:
    """Fresh-ingest one target then propose its associations, stopping at the
    operator-confirm gate. Raises propagate to :func:`run_batch`'s per-video
    isolation; nothing here confirms or promotes."""
    name = target.path.name
    if target.already_ingested:
        typer.echo(f"[batch] already ingested — skip: {name}", err=True)
        return
    if dry_run:
        typer.echo(
            f"[batch] DRY-RUN would ingest+propose: {name} "
            f"(sha {target.sha256[:12]}, priority {target.priority})",
            err=True,
        )
        return

    # Fresh ingest (run_id=NULL): Pass-1 → ① split → ② identity probe. A
    # multi-reel video writes reels.json + reel-<idx>-identity.json and DEFERS
    # dispatch; a single-match video dispatches inline.
    _run_streaming(
        [
            "python3", "-m", "video_ingest.cli", "ingest",
            "--video", str(target.path),
            "--output-root", str(DEFAULT_INGEST_CACHE),
            "--dispatch",
            "--game-title-id", str(NHL26_GAME_TITLE_ID),
        ],
        description=f"batch ingest (fresh, run_id=NULL): {name}",
    )

    # Propose reel→match associations off the emitted identity files (Phase-A
    # path: --video-sha256 + --game-title-id, no run row). This is the review
    # queue — the operator confirms with `resolve-match confirm`; nothing
    # auto-promotes. Tolerant of a video that emitted no reels (nothing proposed).
    identities_dir = DEFAULT_INGEST_CACHE / target.sha256
    _run_streaming(
        [
            "pnpm", "--filter", "@eanhl/worker", "resolve-match", "propose",
            "--identities", str(identities_dir),
            "--video-sha256", target.sha256,
            "--game-title-id", str(NHL26_GAME_TITLE_ID),
        ],
        description=f"batch propose associations: {name}",
    )


def run_batch(
    video_root: Path,
    since: date,
    dry_run: bool = False,
    limit: int | None = None,
) -> None:
    """Unattended first-pass mass-ingest over the corpus under ``video_root``.

    Preflights the GPU-venv closure ONCE up front (a lost wheel must fail in <1s,
    not tens of minutes into a decode), plans the work queue (enumerate → dedup →
    DB-refine → prioritize → ``limit``), then processes each target in priority
    order behind per-video try/except isolation. ``dry_run`` prints the plan and
    makes zero mutating calls. Stops every target at the operator-confirm gate.
    """
    preflight()
    targets = prioritize(_collect_targets(video_root, since))
    if limit is not None:
        targets = targets[:limit]
    _echo_plan(targets, dry_run=dry_run)
    for target in targets:
        try:
            _process_target(target, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001 — per-video isolation, keep going
            typer.echo(f"[batch] SKIP {target.path.name}: {exc}", err=True)
            continue
