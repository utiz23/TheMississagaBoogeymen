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

from video_ingest.identity_probe import (
    ReelOcrReads,
    build_identity,
    parse_basename_epoch,
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


def test_parse_basename_epoch_reads_walltime_as_utc() -> None:
    # The recording basename is a naive wall-clock stamp; we interpret it in a
    # fixed (UTC) reference frame so the result is deterministic across machines.
    # Cross-checked here via an independent parse path (time.strptime + timegm).
    expected = calendar.timegm(time.strptime("2026-05-20 18:15:59", "%Y-%m-%d %H:%M:%S"))

    assert parse_basename_epoch("2026-05-20_18-15-59") == expected


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
