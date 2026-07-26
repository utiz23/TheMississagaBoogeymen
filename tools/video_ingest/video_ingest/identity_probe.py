"""Per-reel identity probe (Milestone ② — ASSOCIATE).

Turns one reel of a multi-match recording into the cheap identity fingerprint the
Session-A association scorer needs: when the reel was captured, its final score,
the opponent name, and the personas seen in its lobby. The orchestrator OCRs a
handful of the reel's box-score / lobby frames (reusing the existing Pass-2 read
path — no full promotion) into a ``ReelOcrReads``; ``build_identity`` assembles
that plus the capture epoch into the ``reel-<idx>-identity.json`` shape that
``resolve-match propose`` consumes:

    { capture_epoch_s, score_for, score_against, opponent_text, personas[] }

``capture_epoch_s`` = the recording file's basename wall-clock + ``reel.end_s``,
so it lines up with ``matches.played_at`` (EA's UTC epoch) in the scorer's
timestamp-proximity signal. Reel END, not start: ``played_at`` is the game's
END (verified against pilot reel geometry — match 970's played_at sits 97 s
before its reel's end, inside the boxscore-viewing tail), and a reel STARTS in
the lobby/queue right after the PREVIOUS game's end. Start-semantics made every
timestamp-only proposal (no boxscore signals) rank the previous match top —
frame-verified off-by-ones on proposals 28→253, 29→252, 30→464 (2026-07-25).

Timezone calibration: the basename ("2026-05-20_18-15-59") is the recording PC's
*local* wall-clock, but ``matches.played_at`` is a true UTC epoch. Stamping the
basename as UTC left ``capture_epoch_s`` ~6 h early — ~2σ of the scorer's σ≈3 h
Gaussian — which pushed the correct match out of the timestamp window and a wrong
one in (proven on the 2026-05-22_19-07-03 5-reel block: reels 0–4 → matches
971–975, a constant ~+5.93 h offset). We localize the basename in the operator's
timezone (:data:`OPERATOR_TZ`) via ``zoneinfo`` so the conversion is DST-correct
across a multi-month batch — a whole-hour constant would misfire either side of a
DST boundary. ``America/Edmonton`` (Mountain) lands reel 0 within ~3 min of match
971's ``played_at``. It is a module-level default + per-call override so a
different recording PC is a one-line change (spec §12 calibration knob).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from video_ingest.match_split import BOXSCORE_SCREENS, LOBBY_SCREENS

# Only the goals tab's TOT column carries the final score; the shots/faceoffs
# tabs OCR'd through the goals parser would read the wrong digits. Keep this
# consistent with match_split's BOXSCORE_SCREENS set.
BOXSCORE_GOALS_SCREEN = "post_game_box_score_goals"
assert BOXSCORE_GOALS_SCREEN in BOXSCORE_SCREENS

BASENAME_TIME_FORMAT = "%Y-%m-%d_%H-%M-%S"

# The recording PC's wall-clock timezone. Basenames carry no offset, so we must
# supply the operator's zone to recover a true UTC epoch. IANA zone (not a fixed
# hour) so DST is handled per recording date across the whole batch.
OPERATOR_TZ = ZoneInfo("America/Edmonton")

# Slot keys in lobby_evidence.json are prefixed lobby_for_<POS> for our team and
# lobby_against_<POS> for the opponent (game_ocr.lobby_extractors.slot_identity
# .slot_key_for). The association scorer matches personas against OUR club roster
# (getMatchLineups), so only our-side personas belong in a reel identity.
_OUR_SIDE_SLOT_PREFIX = "lobby_for_"
_PERSONA_FIELD_KEY = "player_name_persona"
LOBBY_EVIDENCE_FILENAME = "lobby_evidence.json"


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


def parse_basename_epoch(basename: str, tz: ZoneInfo = OPERATOR_TZ) -> int:
    """Parse a recording basename ("2026-05-20_18-15-59") to an integer UTC epoch.

    The basename is the recording PC's *local* wall-clock; localizing it in
    ``tz`` (default :data:`OPERATOR_TZ`, DST-correct via ``zoneinfo``) yields the
    true UTC epoch that lines up with ``matches.played_at`` — see the module
    docstring for the calibration evidence. Raises ``ValueError`` on a basename
    that is not a wall-clock stamp (the orchestrator guards on this).
    """
    dt = datetime.strptime(basename, BASENAME_TIME_FORMAT).replace(tzinfo=tz)
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

    ``reel`` only needs an ``end_s`` (a :class:`~video_ingest.match_split.Reel`);
    the reel END approximates the game's END, which is what ``matches.played_at``
    records (see the module docstring). Sub-second slop is truncated since it is
    irrelevant against the scorer's σ≈3h timestamp Gaussian.
    """
    return {
        "capture_epoch_s": parse_basename_epoch(basename) + int(reel.end_s),
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


# ── The on-box reader: personas (from Pass-2 lobby evidence) + score/opponent ──
#
# Personas are already on disk once Pass-2 ran with lobby_engine=typed_v1
# (``<seg_dir>/lobby_evidence.json``), so reading them needs no GPU. Score and
# opponent are OCR'd on-box (Milestone ② step 2 Phase B) from the reel's goals
# box-score frames via :func:`read_box_score_goals` — a real GPU pass, since the
# box score (unlike personas) is never extracted in Python Pass-2. A reel with no
# gradable goals frame (``partial_no_boxscore``) leaves them absent and the
# scorer falls back to timestamp + personas, exactly as before.


def read_lobby_personas(seg_dir: Path) -> list[str]:
    """Our-side personas from one lobby segment's ``lobby_evidence.json``.

    Reads the flat ``FieldEvidenceRecord`` list Pass-2 wrote for a
    ``pre_game_lobby_state_*`` segment, keeps the ``player_name_persona`` records
    whose slot is on our team, and returns their persona strings (rank-0, blanks
    dropped). Missing file (a ``missing_lobby`` reel, or a state_1-only dir with
    no persona field) ⇒ ``[]``, never raises — the reel still gets an identity.
    """
    path = Path(seg_dir) / LOBBY_EVIDENCE_FILENAME
    if not path.exists():
        return []
    try:
        records = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    personas: list[str] = []
    for rec in records if isinstance(records, list) else []:
        if not isinstance(rec, dict):
            continue
        if rec.get("field_key") != _PERSONA_FIELD_KEY:
            continue
        if rec.get("candidate_rank", 0) != 0:
            continue
        slot = rec.get("subject_slot_key") or ""
        if not slot.startswith(_OUR_SIDE_SLOT_PREFIX):
            continue
        value = rec.get("candidate_value")
        if isinstance(value, str) and value.strip():
            personas.append(value)
    return personas


# ── BGM side resolution (ported from resolve-bgm-side.ts) ─────────────────────
#
# Post-game box-score screens show team names neutrally as Away (top) / Home
# (bottom), but the association scorer needs BGM-perspective score_for/against.
# The authoritative matches.bgm_was_home flag is UNAVAILABLE pre-association
# (finding the match is the whole point), so only the OCR team-name alias
# soft-match path ports here. When neither or both sides match a BGM alias the
# side is unresolved and we leave score/opponent ABSENT (⇒ the scorer's score +
# opponent signals stay 0, exactly like a partial_no_boxscore reel) rather than
# guess and risk flipping for/against on the whole reel.

# Lowercased name fragments (after stripping non-alphanumerics) that mark the BGM
# side. "bm" is the short Net-Chart/Action-Tracker header; "bgm"/"boogeymen" the
# longer renderings. Mirrors BGM_ALIASES in resolve-bgm-side.ts.
_BGM_ALIASES = ("bgm", "boogeymen", "the boogeymen", "bm")


def _normalize_team_name(name: str) -> str:
    """Lowercase, collapse any non-alphanumeric run to a single space, trim.

    Mirrors ``normalize`` in resolve-bgm-side.ts so "BM(A)" → "bm a" and
    substring checks against multi-word aliases behave sensibly.
    """
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def _matches_bgm(name: str | None) -> bool:
    """True when an OCR'd team name is the BGM (our) side. Mirrors ``matchesBgm``.

    The team identifier is always the first token; later tokens are home/away
    markers ("a"/"h") or descriptive words. Falls back to an exact alias match
    against the full normalized string.
    """
    if not name:
        return False
    tokens = _normalize_team_name(name).split()
    if not tokens:
        return False
    if tokens[0] in _BGM_ALIASES:
        return True
    full = " ".join(tokens)
    return any(alias == full for alias in _BGM_ALIASES)


def resolve_bgm_side_scores(
    away_name: str | None,
    home_name: str | None,
    away_total: int | None,
    home_total: int | None,
) -> tuple[int | None, int | None, str]:
    """Map neutral Away/Home box-score totals to BGM-perspective
    ``(score_for, score_against, opponent_text)`` via the team-name alias match.

    The side whose name matches a BGM alias is "for"; the other is the opponent.
    Unresolved side (neither or both names alias-match) ⇒ ``(None, None, "")`` so
    the reel's score/opponent stay absent rather than risk a flipped side — the
    scorer then leans on timestamp + personas, exactly as today.
    """
    away_bgm = _matches_bgm(away_name)
    home_bgm = _matches_bgm(home_name)
    if away_bgm and not home_bgm:
        return away_total, home_total, (home_name or "").strip()
    if home_bgm and not away_bgm:
        return home_total, away_total, (away_name or "").strip()
    return None, None, ""


# ── Box-score OCR reader (Milestone ② step 2 Phase B) ─────────────────────────
#
# Genuinely new GPU/OCR work: unlike personas (pre-extracted to
# lobby_evidence.json), the box score is never OCR'd in Python Pass-2. We run
# game_ocr's post_game_box_score_goals extractor over the reel's goals seg-dir
# frames, take the highest-confidence read, and resolve its TOT-row goals + team
# names into BGM-perspective score/opponent. This lifts the scorer's max
# confidence off the 0.35 timestamp-only ceiling (score 0.30 + opponent 0.20).


def _field_text(field_obj: Any) -> str | None:
    """Best available string from an ExtractionField-like object (value → raw_text)."""
    value = getattr(field_obj, "value", None)
    if isinstance(value, str) and value.strip():
        return value
    raw = getattr(field_obj, "raw_text", None)
    if isinstance(raw, str) and raw.strip():
        return raw
    return None


def _field_int(field_obj: Any) -> int | None:
    """Integer value of an ExtractionField-like object, else None."""
    value = getattr(field_obj, "value", None)
    return value if isinstance(value, int) else None


def _tot_cell(result: Any) -> Any | None:
    """The TOT (``period_number == -1``) cell of a box-score result, or None."""
    for cell in getattr(result, "periods", None) or []:
        if getattr(cell, "period_number", None) == -1:
            return cell
    return None


def read_box_score_goals(
    seg_dirs: list[Any],
    extractor: Any,
) -> tuple[int | None, int | None, str]:
    """OCR the reel's goals box-score frames → BGM-perspective (for, against, opponent).

    Runs ``extractor.extract_input("post_game_box_score_goals", seg_dir)`` over
    every goals seg dir the reel spans, keeps the highest-``overall_confidence``
    result that has a TOT row, reads the away/home final goals + team names, and
    resolves the BGM side. No gradable goals frame (a ``partial_no_boxscore``
    reel) ⇒ ``(None, None, "")``.
    """
    best: Any | None = None
    best_conf = -1.0
    for seg_dir in seg_dirs:
        for result in extractor.extract_input(BOXSCORE_GOALS_SCREEN, seg_dir):
            if not getattr(result, "success", False):
                continue
            if _tot_cell(result) is None:
                continue
            conf = getattr(getattr(result, "meta", None), "overall_confidence", None) or 0.0
            if conf > best_conf:
                best_conf = conf
                best = result
    if best is None:
        return None, None, ""
    tot = _tot_cell(best)
    return resolve_bgm_side_scores(
        _field_text(best.away_team),
        _field_text(best.home_team),
        _field_int(tot.away_value),
        _field_int(tot.home_value),
    )


def make_pass2_persona_reader(
    results_by_index: dict[int, Any],
    extractor: Any | None = None,
) -> Callable[[Any], ReelOcrReads]:
    """Build the ``read_reads`` the orchestrator injects into
    :func:`write_reel_identities`.

    ``results_by_index`` maps ``segment_index`` → Pass2Result (duck-typed: only
    ``.segment.screen_type`` and ``.directory`` are touched). For a reel it reads
    personas from every lobby seg dir the reel spans (GPU-free — already on disk)
    and OCRs the score/opponent from the reel's goals box-score seg dir(s) via
    :func:`read_box_score_goals`.

    ``extractor`` is dependency-injected so tests supply a fake and only the GPU
    orchestrator constructs the real (RapidOCR-backed) one. Left ``None``, it is
    lazily constructed the first time a reel actually has a goals seg dir — so the
    heavy backend never loads during a GPU-free unit test or a reel with no box
    score. Kept a closure so identity emission composes with the existing
    dependency-injected reader seam.
    """
    holder: dict[str, Any] = {"extractor": extractor}

    def _get_extractor() -> Any:
        if holder["extractor"] is None:
            # Deferred import: keeps this module (and its unit tests) importable
            # without game_ocr's RapidOCR backend on the path.
            from game_ocr.extractor import Extractor

            holder["extractor"] = Extractor()
        return holder["extractor"]

    def read(reel: Any) -> ReelOcrReads:
        personas: list[str] = []
        goals_dirs: list[Any] = []
        for idx in reel.segment_indices:
            result = results_by_index.get(idx)
            if result is None:
                continue
            screen_type = result.segment.screen_type
            if screen_type in LOBBY_SCREENS:
                personas.extend(read_lobby_personas(result.directory))
            elif screen_type == BOXSCORE_GOALS_SCREEN:
                goals_dirs.append(result.directory)
        score_for, score_against, opponent_text = (None, None, "")
        if goals_dirs:
            score_for, score_against, opponent_text = read_box_score_goals(
                goals_dirs, _get_extractor()
            )
        return ReelOcrReads(
            score_for=score_for,
            score_against=score_against,
            opponent_text=opponent_text,
            personas=personas,
        )

    return read
