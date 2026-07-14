"""Unit tests for identity_probe — the per-reel identity assembler (Milestone ②).

Pure-function tests only (no ffmpeg, no GPU, no game_ocr): the actual box-score /
lobby frame OCR is done by the orchestrator behind existing Pass-2 read helpers
and its output is handed to ``build_identity`` as a plain ``ReelOcrReads``. Here
we pin the two pure surfaces the association step depends on:

  * ``parse_basename_epoch`` — recording-file wall-clock ("2026-05-20_18-15-59")
    → an absolute epoch, so it lines up with ``matches.played_at`` (EA's UTC
    epoch) that the Session-A scorer compares against.
  * ``build_identity`` — assembles the ``reel-<idx>-identity.json`` shape the
    ``resolve-match propose`` CLI reads: capture_epoch_s offset by the reel's
    start, plus score / opponent / de-duplicated personas.
"""

from __future__ import annotations

import calendar
import time

import json

from dataclasses import dataclass

from types import SimpleNamespace

from video_ingest.identity_probe import (
    ReelOcrReads,
    build_identity,
    make_pass2_persona_reader,
    parse_basename_epoch,
    read_box_score_goals,
    read_lobby_personas,
    resolve_bgm_side_scores,
    write_reel_identities,
)
from video_ingest.match_split import Reel


def _reel(start_s: float, reel_index: int = 0) -> Reel:
    """A minimal-but-real Reel; only ``start_s`` matters to build_identity."""
    return Reel(
        reel_index=reel_index,
        start_s=start_s,
        end_s=start_s + 600.0,
        segment_indices=[reel_index],
        screen_inventory={
            "has_lobby": True,
            "has_boxscore": True,
            "has_action_tracker": False,
            "has_events": False,
            "has_loadout": False,
        },
        completeness_flags=[],
        boundary_confidence=1.0,
    )


def test_parse_basename_epoch_localizes_operator_wall_clock() -> None:
    # The basename is the recording PC's LOCAL wall-clock (America/Edmonton =
    # Mountain); localizing it DST-correctly yields the true UTC epoch that lines
    # up with matches.played_at. 2026-05-22 19:07:03 MDT (UTC−6) = 2026-05-23
    # 01:07:03 UTC. Cross-checked via an INDEPENDENT path: the −6 h offset done by
    # hand, then a UTC-only timegm parse (no zoneinfo), so this pins both the
    # zone selection and the conversion direction.
    expected = calendar.timegm(time.strptime("2026-05-23 01:07:03", "%Y-%m-%d %H:%M:%S"))

    assert parse_basename_epoch("2026-05-22_19-07-03") == expected
    assert expected == 1779498423  # the on-box base epoch of the proven 5-reel block


def test_parse_basename_epoch_lines_up_with_api_played_at() -> None:
    # Regression anchor to real DB truth: the proven mapping (HANDOFF timestamp
    # fingerprint) puts reel 0 of 2026-05-22_19-07-03.mkv on match 971, whose
    # played_at is 1779498237. Reel 0's lobby starts ≈ +2 s into the recording,
    # so its calibrated capture epoch must sit within the scorer's σ=3h window of
    # played_at (pre-calibration it was ~5.9 h off — basename-as-UTC — which
    # ranked the wrong match top). Observed residual ≈ −3 min.
    reel0_capture = parse_basename_epoch("2026-05-22_19-07-03") + 2
    match_971_played_at = 1779498237

    assert abs(match_971_played_at - reel0_capture) < 15 * 60


def test_build_identity_offsets_epoch_by_reel_start_and_assembles_shape() -> None:
    basename = "2026-05-20_18-15-59"
    reel = _reel(start_s=798.0, reel_index=1)
    reads = ReelOcrReads(
        score_for=4,
        score_against=2,
        opponent_text="Rangers",
        personas=["Zubov", "Magroyne"],
    )

    identity = build_identity(reel, basename, reads)

    assert identity == {
        "capture_epoch_s": parse_basename_epoch(basename) + 798,
        "score_for": 4,
        "score_against": 2,
        "opponent_text": "Rangers",
        "personas": ["Zubov", "Magroyne"],
    }


def test_build_identity_dedupes_personas_preserving_first_seen_order() -> None:
    # A lobby is OCR'd across several frames, so the same persona is read many
    # times; the identity should carry each once, in first-seen order, no blanks.
    reads = ReelOcrReads(
        score_for=1,
        score_against=0,
        opponent_text="Bruins",
        personas=["Zubov", "Magroyne", "Zubov", "", "Magroyne", "Kane"],
    )

    identity = build_identity(_reel(start_s=0.0), "2026-05-20_18-15-59", reads)

    assert identity["personas"] == ["Zubov", "Magroyne", "Kane"]


def test_build_identity_tolerates_missing_boxscore_and_lobby() -> None:
    # A partial_no_boxscore / missing_lobby reel yields no score and no personas;
    # the JSON keys must still be present (null score, empty opponent/personas)
    # so the scorer treats them as absent rather than crashing on a missing key.
    reads = ReelOcrReads()

    identity = build_identity(_reel(start_s=120.5), "2026-05-20_18-15-59", reads)

    assert identity["score_for"] is None
    assert identity["score_against"] is None
    assert identity["opponent_text"] == ""
    assert identity["personas"] == []
    # start_s truncates to whole seconds (sub-second slop is irrelevant vs σ≈3h).
    assert identity["capture_epoch_s"] == parse_basename_epoch("2026-05-20_18-15-59") + 120


def test_write_reel_identities_writes_one_file_per_reel(tmp_path) -> None:
    basename = "2026-05-20_18-15-59"
    reels = [_reel(start_s=0.0, reel_index=0), _reel(start_s=798.0, reel_index=1)]
    reads = {
        0: ReelOcrReads(score_for=4, score_against=2, opponent_text="Rangers", personas=["Zubov"]),
        1: ReelOcrReads(score_for=1, score_against=3, opponent_text="Bruins", personas=["Kane"]),
    }

    paths = write_reel_identities(
        reels, basename=basename, sha_root=tmp_path, read_reads=lambda r: reads[r.reel_index]
    )

    assert [p.name for p in paths] == ["reel-0-identity.json", "reel-1-identity.json"]
    # Filename regex the resolve-match CLI matches: ^reel-\d+-identity\.json$ (no padding).
    assert json.loads((tmp_path / "reel-0-identity.json").read_text()) == build_identity(
        reels[0], basename, reads[0]
    )
    assert json.loads((tmp_path / "reel-1-identity.json").read_text())["opponent_text"] == "Bruins"


def test_write_reel_identities_is_best_effort_on_read_failure(tmp_path) -> None:
    # The emit runs inside the live ingest dispatch block; a GPU/OCR read failure
    # on one reel must NOT abort the run or the other reels. The failed reel still
    # gets a timestamp-only identity file (accounted for, ⇒ no_api_match on review).
    basename = "2026-05-20_18-15-59"
    reels = [_reel(start_s=0.0, reel_index=0), _reel(start_s=798.0, reel_index=1)]
    logs: list[str] = []

    def flaky_read(reel: Reel) -> ReelOcrReads:
        if reel.reel_index == 1:
            raise RuntimeError("OCR blew up")
        return ReelOcrReads(score_for=4, score_against=2, opponent_text="Rangers", personas=["Zubov"])

    paths = write_reel_identities(
        reels, basename=basename, sha_root=tmp_path, read_reads=flaky_read, log=logs.append
    )

    assert [p.name for p in paths] == ["reel-0-identity.json", "reel-1-identity.json"]
    failed = json.loads((tmp_path / "reel-1-identity.json").read_text())
    assert failed["capture_epoch_s"] == parse_basename_epoch(basename) + 798
    assert failed["score_for"] is None and failed["personas"] == []
    assert any("reel 1" in m for m in logs)


# ── the on-box reader: personas from lobby_evidence.json ──────────────────────
#
# These pin the real ``read_reads`` the orchestrator injects (Milestone ② on-box
# completion). Score/opponent box-score OCR is deliberately deferred — this reader
# supplies personas (our side) + timestamp, ~0.5 of the association scorer's
# weight, with no GPU at read time (lobby_evidence.json is already on disk when
# lobby_engine=typed_v1). The pure disk-read is testable against a fixture JSON.


def _persona_record(persona: str, slot_key: str, rank: int = 0) -> dict:
    """A minimal lobby_evidence.json record (mirrors FieldEvidenceRecord.to_dict)."""
    return {
        "field_key": "player_name_persona",
        "candidate_value": persona,
        "candidate_rank": rank,
        "subject_slot_key": slot_key,
    }


def test_read_lobby_personas_returns_our_side_only(tmp_path) -> None:
    # Slot keys are prefixed lobby_for_<POS> (our team) / lobby_against_<POS>
    # (opponent). The scorer matches personas against OUR club roster, so only
    # our-side personas belong in the identity; opponents are noise.
    seg_dir = tmp_path / "seg"
    seg_dir.mkdir()
    (seg_dir / "lobby_evidence.json").write_text(
        json.dumps(
            [
                _persona_record("Zubov", "lobby_for_C"),
                _persona_record("Magroyne", "lobby_against_LW"),  # opponent — excluded
                _persona_record("Kane", "lobby_for_RW"),
                _persona_record("  ", "lobby_for_LW"),  # blank — dropped
                # a non-persona record must be ignored entirely
                {"field_key": "player_number", "candidate_value": 11, "candidate_rank": 0,
                 "subject_slot_key": "lobby_for_C"},
            ]
        )
    )

    assert read_lobby_personas(seg_dir) == ["Zubov", "Kane"]


def test_read_lobby_personas_missing_file_is_empty(tmp_path) -> None:
    # A missing_lobby reel (or state_1-only seg dir) has no persona evidence file;
    # the reader returns [] rather than raising, so the reel still gets an identity.
    assert read_lobby_personas(tmp_path / "seg") == []


@dataclass
class _FakeSegment:
    screen_type: str


@dataclass
class _FakePass2Result:
    """Duck-typed Pass2Result: the reader only touches .segment.screen_type and .directory."""

    segment_index: int
    segment: _FakeSegment
    directory: object


def _write_lobby(seg_dir, personas_for_side: list[str]) -> None:
    seg_dir.mkdir(parents=True, exist_ok=True)
    (seg_dir / "lobby_evidence.json").write_text(
        json.dumps([_persona_record(p, f"lobby_for_{i}") for i, p in enumerate(personas_for_side)])
    )


def test_make_pass2_persona_reader_collects_from_lobby_segdirs_only(tmp_path) -> None:
    # A reel spans a lobby segment, a box-score segment, and a gameplay segment.
    # The reader must read personas ONLY from the reel's lobby seg dir(s).
    lobby_dir = tmp_path / "seg0_lobby"
    boxscore_dir = tmp_path / "seg1_box"
    _write_lobby(lobby_dir, ["Zubov", "Kane"])
    # box-score dir has no lobby_evidence.json — must contribute nothing.
    boxscore_dir.mkdir()

    results_by_index = {
        0: _FakePass2Result(0, _FakeSegment("pre_game_lobby_state_2"), lobby_dir),
        1: _FakePass2Result(1, _FakeSegment("post_game_box_score_goals"), boxscore_dir),
        2: _FakePass2Result(2, _FakeSegment("in_game_play"), tmp_path / "nope"),
    }
    reel = _reel(start_s=0.0)
    reel.segment_indices = [0, 1, 2]

    # Inject a fake extractor returning no gradable goals frames so the box-score
    # branch is exercised hermetically (no GPU); score/opponent stay absent.
    reader = make_pass2_persona_reader(results_by_index, extractor=_FakeExtractor([]))
    reads = reader(reel)

    assert isinstance(reads, ReelOcrReads)
    assert reads.personas == ["Zubov", "Kane"]
    # No gradable goals frame → score/opponent absent; scorer falls back to timestamp.
    assert reads.score_for is None and reads.score_against is None and reads.opponent_text == ""


# ── BGM side resolution + box-score OCR reader (Phase B) ──────────────────────


def _field(value=None, raw_text=None) -> SimpleNamespace:
    return SimpleNamespace(value=value, raw_text=raw_text)


def _box_score_result(
    *,
    away_name: str,
    home_name: str,
    away_goals,
    home_goals,
    confidence: float,
    success: bool = True,
    with_tot: bool = True,
) -> SimpleNamespace:
    """A duck-typed PostGameBoxScoreResult (only the attrs the reader touches)."""
    periods = [SimpleNamespace(period_number=1, away_value=_field(1), home_value=_field(0))]
    if with_tot:
        periods.append(
            SimpleNamespace(
                period_number=-1,
                away_value=_field(away_goals),
                home_value=_field(home_goals),
            )
        )
    return SimpleNamespace(
        success=success,
        meta=SimpleNamespace(overall_confidence=confidence),
        away_team=_field(value=away_name),
        home_team=_field(value=home_name),
        periods=periods,
    )


class _FakeExtractor:
    """Duck-typed game_ocr Extractor: returns preset results for any seg dir."""

    def __init__(self, results: list) -> None:
        self._results = results
        self.calls: list = []

    def extract_input(self, screen_type: str, input_path) -> list:
        self.calls.append((screen_type, input_path))
        assert screen_type == "post_game_box_score_goals"  # only the goals tab
        return list(self._results)


def test_resolve_bgm_side_away_is_bgm() -> None:
    # Away name aliases to BGM → away is "for"; home goals are "against" and the
    # home name is the opponent.
    assert resolve_bgm_side_scores("BGM", "Rangers", 4, 1) == (4, 1, "Rangers")


def test_resolve_bgm_side_home_is_bgm() -> None:
    assert resolve_bgm_side_scores("Rangers", "The Boogeymen", 1, 5) == (5, 1, "Rangers")


def test_resolve_bgm_side_handles_header_markers() -> None:
    # Real OCR headers carry an (A)/(H) side marker ("BM(A)" → "bm a"); the first
    # token still aliases to the short BM header.
    assert resolve_bgm_side_scores("BM(A)", "Halsey Fan Club", 7, 3) == (7, 3, "Halsey Fan Club")


def test_resolve_bgm_side_unresolved_when_neither_matches() -> None:
    # Neither side aliases (opponent tie-break needs matches.opponentName, which
    # is unavailable pre-association) → absent; the scorer leans on timestamp.
    assert resolve_bgm_side_scores("Rangers", "Bruins", 3, 2) == (None, None, "")


def test_resolve_bgm_side_unresolved_when_both_match() -> None:
    assert resolve_bgm_side_scores("BGM", "Boogeymen", 3, 2) == (None, None, "")


def test_resolve_bgm_side_preserves_none_totals() -> None:
    # A missed digit leaves the total None, but the side/opponent still resolve —
    # the opponent signal (0.20) can fire even when the score (0.30) can't.
    assert resolve_bgm_side_scores("BGM", "Rangers", None, 1) == (None, 1, "Rangers")


def test_read_box_score_goals_picks_highest_confidence_and_resolves_side() -> None:
    # extract_input returns one result per frame; the reader must take the
    # highest-overall-confidence read (RapidOCR misreads low-confidence digits).
    low = _box_score_result(
        away_name="BGM", home_name="Rangers", away_goals=9, home_goals=9, confidence=0.40
    )
    high = _box_score_result(
        away_name="BGM", home_name="Rangers", away_goals=4, home_goals=1, confidence=0.88
    )
    assert read_box_score_goals(["segdir"], _FakeExtractor([low, high])) == (4, 1, "Rangers")


def test_read_box_score_goals_skips_results_without_tot() -> None:
    no_tot = _box_score_result(
        away_name="BGM", home_name="Rangers", away_goals=4, home_goals=1, confidence=0.9, with_tot=False
    )
    assert read_box_score_goals(["segdir"], _FakeExtractor([no_tot])) == (None, None, "")


def test_read_box_score_goals_empty_when_no_frames() -> None:
    assert read_box_score_goals(["segdir"], _FakeExtractor([])) == (None, None, "")


def test_make_pass2_persona_reader_fills_score_and_personas(tmp_path) -> None:
    # The reel spans a lobby seg (personas, GPU-free) and a goals box-score seg
    # (score/opponent, OCR'd via the injected extractor).
    lobby_dir = tmp_path / "seg0_lobby"
    goals_dir = tmp_path / "seg1_goals"
    _write_lobby(lobby_dir, ["Zubov", "Kane"])
    goals_dir.mkdir()
    results_by_index = {
        0: _FakePass2Result(0, _FakeSegment("pre_game_lobby_state_2"), lobby_dir),
        1: _FakePass2Result(1, _FakeSegment("post_game_box_score_goals"), goals_dir),
    }
    reel = _reel(start_s=0.0)
    reel.segment_indices = [0, 1]
    box = _box_score_result(
        away_name="BGM", home_name="Halsey Fan Club", away_goals=7, home_goals=3, confidence=0.9
    )
    extractor = _FakeExtractor([box])

    reads = make_pass2_persona_reader(results_by_index, extractor=extractor)(reel)

    assert reads.personas == ["Zubov", "Kane"]
    assert (reads.score_for, reads.score_against, reads.opponent_text) == (7, 3, "Halsey Fan Club")
    # Only the goals seg dir was OCR'd (lobby personas come from disk, not the OCR).
    assert extractor.calls == [("post_game_box_score_goals", goals_dir)]
