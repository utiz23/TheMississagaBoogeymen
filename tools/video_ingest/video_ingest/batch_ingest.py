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
"""

from __future__ import annotations

import hashlib
import importlib
import pkgutil
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path


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


def dedup_by_sha(paths: list[Path], known_shas: set[str]) -> list[BatchTarget]:
    """Collapse byte-identical copies to one :class:`BatchTarget` per sha.

    A recording often exists as several containers with identical bytes (``.mkv``
    + ``.mp4`` remux, ``- Trim`` copy); those must ingest once. Paths are sorted
    first, so the lexicographically-first path wins each sha (deterministic,
    matching ``reprocess._disk_videos_by_sha``'s ``setdefault`` first-wins).

    ``already_ingested`` is ``True`` when the sha is in ``known_shas`` (the
    distinct ``ocr_capture_batches.video_sha256`` set). Result order follows the
    first-seen (sorted) path.
    """
    by_sha: dict[str, Path] = {}
    for p in sorted(paths, key=str):
        by_sha.setdefault(_file_sha256(p), p)

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
