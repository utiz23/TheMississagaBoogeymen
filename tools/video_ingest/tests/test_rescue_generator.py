"""The generator's own pin-or-drop behaviour — the match-2400 regression.

``process_sha`` used to call the frame-rate probe for EVERY window whose video
was present, before ``build_commands`` could say it had nothing to build. One
unpinnable source therefore aborted the whole corpus even when every window it
backed was review-only — while the transform tool, given the same manifest,
dropped those commands and enumerated them and carried on. Two tools, two
behaviours, one corpus.

The live shape: ``a05d53649924`` is match 2400's trimmed mp4. Its
``r_frame_rate`` is 60/1 and its ``avg_frame_rate`` is 839640000/13993843, so it
has no constant grid and is correctly refused. It backs seven windows, all
``review``; five of them carry commands. Refusing it must cost those five their
commands and nothing else.

These tests drive the real ``process_sha`` over a synthetic Pass-1 cache with an
injected grid probe, so no ffprobe, no video, no database and no docker.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import pytest

from video_ingest.rescue_manifest import (
    AutoWindowUnpinnable,
    DECISION_AUTO,
    DECISION_REVIEW,
    RESCUE_DECODER_VERSION,
    SEGMENT_INDEX_BASE,
    UNPINNABLE_LEDGER_KEY,
    UNKNOWN_STATE,
    manifest_to_dict,
    sampling_policy,
    validate_manifest,
)
from video_ingest.rescue_execute import policy_problems, validate_for_execution
from video_ingest.rescue_sampling import UnsupportedFrameRate

from rescue_sampling_helpers import GRID60, IDEAL_PROBE

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from rescue_postgame_from_cache import process_sha  # noqa: E402

GOOD_SHA = "a" * 64
BAD_SHA = "b" * 64

#: The real numbers from match 2400's trimmed recording.
TRIMMED_RATES = "variable frame rate: r_frame_rate=60/1 != avg_frame_rate=839640000/13993843"


class FakeFacts:
    """Only the three attributes ``resolve_candidates`` reads."""

    def __init__(self, *, reel_to_match, active_run, coverage=None):
        self.reel_to_match = dict(reel_to_match)
        self.active_run = dict(active_run)
        self.coverage = defaultdict(set, coverage or {})
        self.run_sha: dict = {}


def _write_cache(root: Path, sha: str, *, video_path: str, anchors) -> Path:
    """A minimal but FAITHFUL Pass-1 cache entry: segments.json + reels.json."""
    sha_dir = root / sha
    sha_dir.mkdir(parents=True, exist_ok=True)
    (sha_dir / "segments.json").write_text(
        json.dumps(
            {
                "video_path": video_path,
                "segments": [
                    {"start_seconds": 0.0, "end_seconds": 2000.0, "state": UNKNOWN_STATE}
                ],
                "frame_classifications": [
                    {
                        "source_time_seconds": seconds,
                        "anchor_text": anchor,
                        "screen_type": UNKNOWN_STATE,
                    }
                    for seconds, anchor in anchors
                ],
            }
        )
    )
    (sha_dir / "reels.json").write_text(
        json.dumps({"reels": [{"reel_index": 0, "start_s": 0.0, "end_s": 2000.0}]})
    )
    return sha_dir


@pytest.fixture()
def cache(tmp_path: Path) -> dict:
    root = tmp_path / "ingest-cache"
    videos = tmp_path / "videos"
    videos.mkdir()
    # The files must EXIST: a window whose source is missing is routed to review
    # with no command at all, which would mask the behaviour under test.
    good_video, bad_video = videos / "good.mkv", videos / "trimmed.mp4"
    good_video.write_bytes(b"\x00")
    bad_video.write_bytes(b"\x00")
    good = _write_cache(
        root, GOOD_SHA, video_path=str(good_video), anchors=[(1000.0, "lt goalsummary")]
    )
    bad = _write_cache(
        root, BAD_SHA, video_path=str(bad_video), anchors=[(1200.0, "lt faceoffsummary")]
    )
    return {
        "root": root,
        "good": good,
        "bad": bad,
        "good_video": str(good_video),
        "bad_video": str(bad_video),
    }


def _grid_for(bad_path: str | None):
    def lookup(path: str):
        if path == bad_path:
            raise UnsupportedFrameRate(f"{path}: {TRIMMED_RATES}")
        return GRID60

    return lookup


def _run(sha_dir: Path, facts, *, cache_root: Path, bad_path: str | None):
    unpinnable: list = []
    windows, _candidates, _dropped = process_sha(
        sha_dir,
        facts,
        cache_root=str(cache_root),
        game_title_id=1,
        grid_for=_grid_for(bad_path),
        probe_frames=IDEAL_PROBE,
        used_ledger=set(),
        unpinnable=unpinnable,
    )
    return windows, unpinnable


# ─── The regression ─────────────────────────────────────────────────────────


def test_an_unpinnable_source_behind_review_only_windows_does_not_abort(cache):
    """The exact failure. Before the fix this raised and the generator produced
    nothing at all — for a video whose windows were never executable.

    The window is REVIEW but still carries an identity, which is the shape that
    matters: it resolves to a match, so it would carry a command, so it reaches
    the probe. (Match 2400's real windows are review-with-a-match for a different
    reason — ``match_never_ocr_ingested`` — but the path through ``process_sha``
    is the same: a resolved match, no active run, and a command to build.)
    """
    facts = FakeFacts(reel_to_match={f"{BAD_SHA}:0": 2400}, active_run={})

    windows, unpinnable = _run(
        cache["bad"], facts, cache_root=cache["root"], bad_path=cache["bad_video"]
    )

    assert windows, "the generator must still emit the windows"
    assert all(w.decision == DECISION_REVIEW for w in windows)
    assert all(w.commands is None for w in windows)

    (entry,) = unpinnable
    assert entry["video_sha256"] == BAD_SHA
    assert entry["decision"] == DECISION_REVIEW
    assert entry["video_path"] == cache["bad_video"]
    assert "839640000/13993843" in entry["detail"]


def test_an_unpinnable_source_behind_an_auto_window_still_refuses_everything(cache):
    """The other half of the asymmetry. An auto window is executable and may
    already have been executed; it must be pinnable or nothing may be emitted."""
    facts = FakeFacts(reel_to_match={f"{BAD_SHA}:0": 2400}, active_run={2400: 9001})

    with pytest.raises(AutoWindowUnpinnable) as exc:
        _run(cache["bad"], facts, cache_root=cache["root"], bad_path=cache["bad_video"])

    assert "839640000/13993843" in str(exc.value)
    assert cache["bad_video"] in str(exc.value)


def test_a_pinnable_source_is_unaffected(cache):
    facts = FakeFacts(reel_to_match={f"{GOOD_SHA}:0": 471}, active_run={471: 55})

    windows, unpinnable = _run(
        cache["good"], facts, cache_root=cache["root"], bad_path=cache["bad_video"]
    )

    (win,) = windows
    assert win.decision == DECISION_AUTO
    assert win.commands is not None
    assert win.commands["sampling"]["source_pts_origin_s"] == 0.0
    assert unpinnable == []


def test_the_probe_is_not_called_for_a_window_that_would_carry_no_command(cache):
    """A window with no resolved match gets no command at all, so probing its
    source spends an ffprobe — and risks a refusal — on a decision already made.
    That is the mechanism the whole regression turned on.
    """
    probed: list[str] = []

    def counting(path: str):
        probed.append(path)
        return GRID60

    facts = FakeFacts(reel_to_match={}, active_run={})  # nothing resolves
    unpinnable: list = []
    windows, _c, _d = process_sha(
        cache["good"],
        facts,
        cache_root=str(cache["root"]),
        game_title_id=1,
        grid_for=counting,
        probe_frames=IDEAL_PROBE,
        used_ledger=set(),
        unpinnable=unpinnable,
    )

    assert all(w.match_id is None for w in windows)
    assert all(w.commands is None for w in windows)
    assert probed == []


# ─── Generator and transform agree, and the executor can read the result ────


def test_the_generators_ledger_is_the_shape_the_executor_requires(cache):
    """Same key, same entry shape, and a manifest carrying it validates."""
    good_facts = FakeFacts(reel_to_match={f"{GOOD_SHA}:0": 471}, active_run={471: 55})
    bad_facts = FakeFacts(reel_to_match={}, active_run={})

    windows, unpinnable = _run(
        cache["good"], good_facts, cache_root=cache["root"], bad_path=cache["bad_video"]
    )
    more, more_unpinnable = _run(
        cache["bad"], bad_facts, cache_root=cache["root"], bad_path=cache["bad_video"]
    )
    windows += more
    unpinnable += more_unpinnable

    doc = manifest_to_dict(
        windows,
        policy={
            "decoder_version": RESCUE_DECODER_VERSION,
            "segment_index_base": SEGMENT_INDEX_BASE,
            "auto_eligible_screens": list(
                __import__("video_ingest.rescue_manifest", fromlist=["x"]).AUTO_ELIGIBLE_SCREENS
            ),
            **sampling_policy(
                source_grids={GOOD_SHA: GRID60.rate.text},
                source_pts_origins={GOOD_SHA: GRID60.origin_s},
                unpinnable=unpinnable,
            ),
        },
        unrecoverable=[],
        generated_at="2026-08-05T00:00:00+00:00",
        cache_root=str(cache["root"]),
    )

    assert doc["policy"][UNPINNABLE_LEDGER_KEY] == unpinnable
    assert validate_manifest(doc) == []
    assert policy_problems(doc) == []
    assert validate_for_execution(doc) == []


def test_a_manifest_without_the_ledger_key_is_refused_by_the_executor(cache):
    """An absent ledger would make "nothing was dropped" and "this producer does
    not record drops" the same document."""
    facts = FakeFacts(reel_to_match={f"{GOOD_SHA}:0": 471}, active_run={471: 55})
    windows, unpinnable = _run(
        cache["good"], facts, cache_root=cache["root"], bad_path=None
    )
    policy = sampling_policy(
        source_grids={GOOD_SHA: GRID60.rate.text},
        source_pts_origins={GOOD_SHA: GRID60.origin_s},
        unpinnable=unpinnable,
    )
    policy.pop(UNPINNABLE_LEDGER_KEY)
    doc = manifest_to_dict(
        windows,
        policy={"decoder_version": RESCUE_DECODER_VERSION, **policy},
        unrecoverable=[],
        generated_at="2026-08-05T00:00:00+00:00",
        cache_root=str(cache["root"]),
    )
    assert any(UNPINNABLE_LEDGER_KEY in p for p in policy_problems(doc))


def test_the_executor_refuses_a_ledger_that_names_an_auto_window(cache):
    facts = FakeFacts(reel_to_match={f"{GOOD_SHA}:0": 471}, active_run={471: 55})
    windows, _ = _run(cache["good"], facts, cache_root=cache["root"], bad_path=None)
    doc = manifest_to_dict(
        windows,
        policy={
            "decoder_version": RESCUE_DECODER_VERSION,
            **sampling_policy(
                source_grids={GOOD_SHA: GRID60.rate.text},
                source_pts_origins={GOOD_SHA: GRID60.origin_s},
                unpinnable=[
                    {
                        "video_sha256": GOOD_SHA,
                        "segment_index": SEGMENT_INDEX_BASE,
                        "video_path": cache["good_video"],
                        "decision": DECISION_AUTO,
                        "reason": None,
                        "detail": "hand-inserted",
                    }
                ],
            ),
        },
        unrecoverable=[],
        generated_at="2026-08-05T00:00:00+00:00",
        cache_root=str(cache["root"]),
    )
    assert any("AUTO window" in p for p in policy_problems(doc))
