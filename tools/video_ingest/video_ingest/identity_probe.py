"""Per-reel identity probe (Milestone ② — ASSOCIATE).

Turns one reel of a multi-match recording into the cheap identity fingerprint the
Session-A association scorer needs: when the reel was captured, its final score,
the opponent name, and the personas seen in its lobby. The orchestrator OCRs a
handful of the reel's box-score / lobby frames (reusing the existing Pass-2 read
path — no full promotion) into a ``ReelOcrReads``; ``build_identity`` assembles
that plus the capture epoch into the ``reel-<idx>-identity.json`` shape that
``resolve-match propose`` consumes:

    { capture_epoch_s, score_for, score_against, opponent_text, personas[] }

``capture_epoch_s`` = the recording file's basename wall-clock + ``reel.start_s``,
so it lines up with ``matches.played_at`` (EA's UTC epoch) in the scorer's
timestamp-proximity signal.

Timezone note: the basename ("2026-05-20_18-15-59") is the recording PC's *local*
wall-clock. We interpret it in a fixed UTC frame so the epoch is deterministic
across machines (unit tests, CI, and the GPU box all agree). A constant
operator-timezone offset is uniform across every candidate, so it preserves the
relative ranking the scorer cares about within a session; if same-day
multi-session discrimination ever proves weak it becomes a batch-1 calibration
knob (spec §12) — thread the operator timezone through here at that point.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

BASENAME_TIME_FORMAT = "%Y-%m-%d_%H-%M-%S"


@dataclass
class ReelOcrReads:
    """Already-extracted OCR reads for one reel's box-score + lobby frames.

    Produced by the orchestrator's thin Pass-2 read helper (GPU-side) and handed
    to :func:`build_identity` (pure). Every field defaults to "absent" so a
    ``partial_no_boxscore`` / ``missing_lobby`` reel assembles cleanly.
    """

    score_for: int | None = None
    score_against: int | None = None
    opponent_text: str = ""
    personas: list[str] = field(default_factory=list)


def parse_basename_epoch(basename: str) -> int:
    """Parse a recording basename ("2026-05-20_18-15-59") to an integer epoch.

    Interpreted as UTC — see the module docstring for why the reference frame is
    fixed rather than the local machine's timezone.
    """
    dt = datetime.strptime(basename, BASENAME_TIME_FORMAT).replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _dedupe_preserving_order(personas: list[str]) -> list[str]:
    """First-seen order, blanks dropped — a lobby is OCR'd across many frames so
    the same persona is read repeatedly."""
    seen: set[str] = set()
    out: list[str] = []
    for p in personas:
        p = p.strip()
        if not p or p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def build_identity(reel: Any, basename: str, ocr_reads: ReelOcrReads) -> dict:
    """Assemble the ``reel-<idx>-identity.json`` dict for one reel.

    ``reel`` only needs a ``start_s`` (a :class:`~video_ingest.match_split.Reel`);
    sub-second slop is truncated since it is irrelevant against the scorer's
    σ≈3h timestamp Gaussian.
    """
    return {
        "capture_epoch_s": parse_basename_epoch(basename) + int(reel.start_s),
        "score_for": ocr_reads.score_for,
        "score_against": ocr_reads.score_against,
        "opponent_text": ocr_reads.opponent_text,
        "personas": _dedupe_preserving_order(ocr_reads.personas),
    }


def write_reel_identities(
    reels: list[Any],
    *,
    basename: str,
    sha_root: Path,
    read_reads: Callable[[Any], ReelOcrReads],
    log: Callable[[str], None] | None = None,
) -> list[Path]:
    """OCR each reel's identity and write ``sha_root/reel-<idx>-identity.json``.

    The orchestrator calls this for a multi-reel recording (``>1 reel``) so the
    Session-A ``resolve-match propose`` CLI has one identity file per reel to
    score. ``read_reads`` is dependency-injected — the orchestrator supplies the
    game_ocr box-score/lobby reader; tests supply a fake — so the file placement
    and best-effort behaviour here are unit-testable without a GPU.

    Best-effort per reel: this runs inside the live ingest dispatch block, so a
    read failure on one reel must not abort the run or the other reels. A failed
    read falls back to an empty ``ReelOcrReads`` (timestamp-only identity ⇒
    ``no_api_match`` on operator review), keeping every reel accounted for.
    """
    emit = log or (lambda _m: None)
    paths: list[Path] = []
    for reel in reels:
        try:
            reads = read_reads(reel)
        except Exception as exc:  # noqa: BLE001 — never let one reel's OCR break the run
            emit(f"[identity] reel {reel.reel_index} OCR read failed ({exc}); timestamp-only identity")
            reads = ReelOcrReads()
        path = Path(sha_root) / f"reel-{reel.reel_index}-identity.json"
        path.write_text(json.dumps(build_identity(reel, basename, reads), indent=2))
        paths.append(path)
    return paths
