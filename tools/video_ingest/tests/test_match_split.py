"""Unit tests for match_split.group_into_reels() — the per-match reel grouper.

These tests use synthetic Segment sequences (mirroring test_build_segments.py)
so they need no ffmpeg, no classifier, no GPU. The goal is to pin the reel
grouping contract: a multi-match video's Pass-1 segments split into one reel per
game, single-match videos stay a single reel, and every input segment index is
accounted for (flag-never-drop).

Real state-machine vocabulary (tools/game_ocr/.../state_machine/nhl26.yaml):
  OPENERS  = pre_game_lobby_state_1/2, loading_or_intro
  POSTGAME = post_game_player_summary, post_game_box_score_{goals,shots,faceoffs},
             post_game_events, post_game_action_tracker, post_game_faceoff_map,
             post_game_net_chart
  TERMINAL = end_of_video
"""

from __future__ import annotations

import json

from video_ingest.match_split import (
    Reel,
    dispatch_reels,
    group_into_reels,
    write_reels_json,
)
from video_ingest.pass1_classify import Segment
from video_ingest.pass2_extract import Pass2Result


def _seg(i: int, screen_type: str, t0: float, t1: float) -> Segment:
    """One synthetic Segment at list position `i`.

    start_index/end_index carry the position so failures are legible; grouping
    keys off list position (the index into the input list), not these fields.
    """
    return Segment(
        start_index=i,
        end_index=i,
        start_seconds=t0,
        end_seconds=t1,
        screen_type=screen_type,
        frame_count=5,
        mean_color_score=0.95,
    )


def _segs(seq: list[str], *, dt: float = 5.0) -> list[Segment]:
    """Build contiguous 1-per-slot segments from a screen-type sequence."""
    return [_seg(i, s, i * dt, (i + 1) * dt) for i, s in enumerate(seq)]


def test_two_match_sequence_groups_into_two_reels() -> None:
    # Clean two-match session: two full pre-game→gameplay→post-game arcs, then
    # end_of_video. Each arc must become its own reel.
    seq = [
        "loading_or_intro",           # 0  opener
        "pre_game_lobby_state_1",     # 1  opener (still pre-game)
        "in_game_clock",              # 2  gameplay
        "post_game_box_score_goals",  # 3  post-game
        "post_game_box_score_shots",  # 4  post-game
        "pre_game_lobby_state_1",     # 5  opener → boundary
        "in_game_clock",              # 6  gameplay
        "post_game_box_score_goals",  # 7  post-game
        "end_of_video",               # 8  terminal
    ]
    reels = group_into_reels(_segs(seq))

    assert len(reels) == 2
    assert reels[0].reel_index == 0
    assert reels[1].reel_index == 1
    assert reels[0].segment_indices == [0, 1, 2, 3, 4]
    assert reels[1].segment_indices == [5, 6, 7, 8]
    assert reels[0].screen_inventory["has_boxscore"] is True
    assert reels[1].screen_inventory["has_boxscore"] is True
    # Clean path: no completeness concerns, full boundary confidence.
    assert reels[0].completeness_flags == []
    assert reels[1].completeness_flags == []
    assert reels[0].boundary_confidence == 1.0
    assert reels[1].boundary_confidence == 1.0
    # start_s/end_s track the reel's segment time bounds.
    assert reels[0].start_s == 0.0
    assert reels[0].end_s == 25.0
    assert isinstance(reels[0], Reel)


def _assert_partition(segments: list[Segment], reels: list[Reel], drops: list) -> None:
    """flag-never-drop invariant: every input segment index appears in exactly
    one reel OR is recorded once in ``drops`` — nothing lost, nothing double-counted."""
    from_reels = [i for r in reels for i in r.segment_indices]
    from_drops = [i for i, _reason in drops]
    covered = from_reels + from_drops
    assert sorted(covered) == list(range(len(segments)))
    assert len(covered) == len(set(covered)), "a segment index appears twice"


# ---------------------------------------------------------------------------
# Task 1.2: edge-case flagging (flag-never-drop)
# ---------------------------------------------------------------------------


def test_late_start_missing_lobby_flag() -> None:
    # Recording starts mid-post-game (the previous game's lobby was never
    # captured): a post-game screen precedes any opener.
    seq = [
        "post_game_box_score_goals",  # 0  post-game with no preceding opener
        "pre_game_lobby_state_1",     # 1  opener → boundary
        "in_game_clock",              # 2  gameplay
        "post_game_box_score_goals",  # 3  post-game
        "end_of_video",               # 4  terminal
    ]
    segs = _segs(seq)
    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segs, dropped=drops)

    assert len(reels) == 2  # the orphan post-game is still emitted, not dropped
    assert "missing_lobby" in reels[0].completeness_flags
    assert reels[0].screen_inventory["has_lobby"] is False
    assert reels[0].segment_indices == [0]
    # The proper second match is unflagged for lobby.
    assert "missing_lobby" not in reels[1].completeness_flags
    _assert_partition(segs, reels, drops)


def test_early_stop_partial_no_boxscore_flag() -> None:
    # First arc opens + plays but the recording cuts to the next lobby before
    # any post-game screen — no box score for that game.
    seq = [
        "pre_game_lobby_state_1",     # 0  opener
        "in_game_clock",              # 1  gameplay
        "pre_game_lobby_state_1",     # 2  opener → boundary (arc 0 had no post-game)
        "in_game_clock",              # 3  gameplay
        "post_game_box_score_goals",  # 4  post-game
        "end_of_video",               # 5  terminal
    ]
    segs = _segs(seq)
    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segs, dropped=drops)

    assert len(reels) == 2
    assert "partial_no_boxscore" in reels[0].completeness_flags
    assert reels[0].screen_inventory["has_boxscore"] is False
    assert reels[0].segment_indices == [0, 1]
    assert "partial_no_boxscore" not in reels[1].completeness_flags
    _assert_partition(segs, reels, drops)


def test_lone_unknown_fragment_drops_to_zero_reels() -> None:
    # A short run of pure transition frames with no opener, gameplay, or
    # post-game is not a match — 0 reels, both indices dropped-with-reason,
    # never merged into any neighbour (there is none here).
    seq = ["unknown_or_transition", "unknown_or_transition"]
    segs = _segs(seq)
    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segs, dropped=drops)

    assert len(reels) == 0
    assert len(drops) == 2
    assert {i for i, _ in drops} == {0, 1}
    _assert_partition(segs, reels, drops)


def test_gameplay_only_fragment_flagged_incomplete() -> None:
    # Gameplay with no opener and no post-game: kept as one reel (flag-never-drop
    # favours retention) but marked `incomplete`.
    seq = ["in_game_clock", "in_game_clock"]
    segs = _segs(seq)
    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segs, dropped=drops)

    assert len(reels) == 1
    assert "incomplete" in reels[0].completeness_flags
    assert reels[0].segment_indices == [0, 1]
    _assert_partition(segs, reels, drops)


def test_back_to_back_low_confidence_boundary_flag() -> None:
    # A lone post-game screen immediately followed by the next match's opener is
    # weak evidence of a true game-end boundary — flag it and lower confidence.
    seq = [
        "pre_game_lobby_state_1",     # 0  opener
        "in_game_clock",              # 1  gameplay
        "post_game_box_score_goals",  # 2  single post-game screen
        "pre_game_lobby_state_1",     # 3  opener → tight boundary
        "in_game_clock",              # 4  gameplay
        "post_game_box_score_goals",  # 5  post-game
        "post_game_box_score_shots",  # 6  post-game (rich → confident end)
        "end_of_video",               # 7  terminal
    ]
    segs = _segs(seq)
    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segs, dropped=drops)

    assert len(reels) == 2
    assert "low_confidence_boundary" in reels[0].completeness_flags
    assert reels[0].boundary_confidence < 1.0
    # The rich-post-game second reel keeps full confidence and no flags.
    assert reels[1].boundary_confidence == 1.0
    assert reels[1].completeness_flags == []
    _assert_partition(segs, reels, drops)


def test_match_463_style_single_reel_burst() -> None:
    # Real match-463 emitted-segment shape (mirrors test_build_segments.py:137):
    # a loadout view at the start, then the post-game burst, with no lobby
    # opener captured. It is ONE game → one reel, box score present.
    seq = [
        "player_loadout_view",         # 0  pre-game loadout (no lobby captured)
        "post_game_action_tracker",    # 1
        "post_game_faceoff_map",       # 2
        "post_game_net_chart",         # 3
        "post_game_box_score_goals",   # 4
    ]
    segs = _segs(seq)
    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segs, dropped=drops)

    assert len(reels) == 1
    assert reels[0].segment_indices == [0, 1, 2, 3, 4]
    assert reels[0].screen_inventory["has_boxscore"] is True
    assert reels[0].screen_inventory["has_loadout"] is True
    assert reels[0].screen_inventory["has_action_tracker"] is True
    assert "missing_lobby" in reels[0].completeness_flags  # no lobby opener
    assert drops == []
    _assert_partition(segs, reels, drops)


# ---------------------------------------------------------------------------
# Task 1.3: write_reels_json + per-reel dispatch decision (milestone boundary)
# ---------------------------------------------------------------------------


def _p2(segment_index: int, screen_type: str) -> Pass2Result:
    """A minimal Pass2Result whose .segment_index maps it to a reel."""
    seg = _seg(segment_index, screen_type, segment_index * 5.0, (segment_index + 1) * 5.0)
    return Pass2Result(
        segment_index=segment_index,
        segment=seg,
        directory=None,  # unused by the dispatch decision
        frame_count=5,
        sample_fps=1.0,
        start_seconds=seg.start_seconds,
        end_seconds=seg.end_seconds,
    )


class _RecordingDispatch:
    """Stub for dispatch_segments: records each call's (results, match_id).

    Mirrors the monkeypatch-on-dispatch_segments pattern of
    test_dispatch_segment_flags.py, injected via dispatch_fn.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[list[Pass2Result], int | None]] = []
        self.kwargs: list[dict] = []  # each call's forwarded dispatch_kwargs

    def __call__(self, results, *, match_id, **kwargs):  # type: ignore[no-untyped-def]
        results = list(results)
        self.calls.append((results, match_id))
        self.kwargs.append(kwargs)
        return []  # no DispatchResult rows needed for these assertions


_SINGLE_MATCH = [
    "loading_or_intro",           # 0
    "pre_game_lobby_state_1",     # 1
    "in_game_clock",              # 2
    "post_game_box_score_goals",  # 3
    "post_game_box_score_shots",  # 4
    "end_of_video",               # 5
]

_TWO_MATCH = [
    "pre_game_lobby_state_1",     # 0  reel 0
    "in_game_clock",              # 1
    "post_game_box_score_goals",  # 2
    "post_game_box_score_shots",  # 3
    "pre_game_lobby_state_1",     # 4  reel 1
    "in_game_clock",              # 5
    "post_game_box_score_goals",  # 6
    "end_of_video",               # 7
]


def test_single_reel_dispatches_all_under_match_id(tmp_path) -> None:
    # Parity: a single-match video still fans every segment out under the one
    # match_id in exactly one dispatch call (today's behaviour, unchanged).
    segs = _segs(_SINGLE_MATCH)
    results = [_p2(i, s) for i, s in enumerate(_SINGLE_MATCH)]
    stub = _RecordingDispatch()

    out = dispatch_reels(
        segs,
        results,
        sha_root=tmp_path,
        dispatch_fn=stub,
        match_id=250,
        reel_match_ids=None,
        game_title_id=1,
        video_sha256="a" * 64,
    )

    assert len(stub.calls) == 1
    dispatched_results, mid = stub.calls[0]
    assert mid == 250
    assert [r.segment_index for r in dispatched_results] == [0, 1, 2, 3, 4, 5]
    assert out == []


def test_multi_reel_without_ids_skips_dispatch_and_writes_reels_json(tmp_path) -> None:
    # Safety: a multi-match video with no association map must NOT dispatch
    # (no overwrite/collapse). It writes reels.json and defers to Milestone ②.
    segs = _segs(_TWO_MATCH)
    results = [_p2(i, s) for i, s in enumerate(_TWO_MATCH)]
    stub = _RecordingDispatch()
    logs: list[str] = []

    dispatch_reels(
        segs,
        results,
        sha_root=tmp_path,
        dispatch_fn=stub,
        match_id=250,
        reel_match_ids=None,
        log=logs.append,
        game_title_id=1,
        video_sha256="a" * 64,
    )

    assert stub.calls == []  # zero dispatch calls — deferred to association
    reels_json = tmp_path / "reels.json"
    assert reels_json.exists()
    body = json.loads(reels_json.read_text())
    assert body["reel_count"] == 2
    assert [r["segment_indices"] for r in body["reels"]] == [[0, 1, 2, 3], [4, 5, 6, 7]]
    assert any("2 reels need association" in m for m in logs)


def test_multi_reel_with_ids_dispatches_each_subset_under_mapped_id(tmp_path) -> None:
    # Once ② supplies reel→match_id, each reel's Pass-2 subset dispatches under
    # its own match_id — one dispatch call per reel.
    segs = _segs(_TWO_MATCH)
    results = [_p2(i, s) for i, s in enumerate(_TWO_MATCH)]
    stub = _RecordingDispatch()

    dispatch_reels(
        segs,
        results,
        sha_root=tmp_path,
        dispatch_fn=stub,
        match_id=None,
        reel_match_ids={0: 400, 1: 401},
        game_title_id=1,
        video_sha256="a" * 64,
    )

    assert len(stub.calls) == 2
    (r0, m0), (r1, m1) = stub.calls
    assert m0 == 400 and [r.segment_index for r in r0] == [0, 1, 2, 3]
    assert m1 == 401 and [r.segment_index for r in r1] == [4, 5, 6, 7]


def test_multi_reel_with_ids_forces_per_reel_run_id_none(tmp_path) -> None:
    # Milestone ② step (3): reels of DIFFERENT matches cannot share one
    # ocr_decoder_runs row (match_id is NOT NULL), so a single shared run_id
    # must NEVER be forwarded across them. Branch (c) overrides run_id=None
    # (the fresh-ingest convention) even when the orchestrator passed one.
    segs = _segs(_TWO_MATCH)
    results = [_p2(i, s) for i, s in enumerate(_TWO_MATCH)]
    stub = _RecordingDispatch()

    dispatch_reels(
        segs,
        results,
        sha_root=tmp_path,
        dispatch_fn=stub,
        match_id=None,
        reel_match_ids={0: 400, 1: 401},
        game_title_id=1,
        video_sha256="a" * 64,
        run_id=999,  # a stray shared run_id must not leak onto per-reel dispatch
    )

    assert len(stub.kwargs) == 2
    assert all(kw.get("run_id") is None for kw in stub.kwargs), (
        "per-reel dispatch must force run_id=None (a shared run can't span "
        "reels of different matches)"
    )


def test_multi_reel_without_ids_emits_reel_identities(tmp_path) -> None:
    # Milestone ②: the un-associated multi-reel branch also emits per-reel
    # identity files (so resolve-match propose has one to score), right beside
    # reels.json — via the injected emit_reel_identities hook.
    segs = _segs(_TWO_MATCH)
    results = [_p2(i, s) for i, s in enumerate(_TWO_MATCH)]
    stub = _RecordingDispatch()
    emitted: list[list] = []

    dispatch_reels(
        segs,
        results,
        sha_root=tmp_path,
        dispatch_fn=stub,
        match_id=250,
        reel_match_ids=None,
        emit_reel_identities=emitted.append,
        game_title_id=1,
        video_sha256="a" * 64,
    )

    assert stub.calls == []  # still no dispatch (deferred to association)
    assert len(emitted) == 1  # hook fired once
    assert [r.reel_index for r in emitted[0]] == [0, 1]  # with the grouped reels


def test_single_reel_does_not_emit_reel_identities(tmp_path) -> None:
    # A single-match video dispatches directly; there is nothing to associate, so
    # the identity hook must NOT fire.
    segs = _segs(_SINGLE_MATCH)
    results = [_p2(i, s) for i, s in enumerate(_SINGLE_MATCH)]
    emitted: list[list] = []

    dispatch_reels(
        segs,
        results,
        sha_root=tmp_path,
        dispatch_fn=_RecordingDispatch(),
        match_id=250,
        reel_match_ids=None,
        emit_reel_identities=emitted.append,
        game_title_id=1,
        video_sha256="a" * 64,
    )

    assert emitted == []


def test_multi_reel_with_ids_does_not_emit_reel_identities(tmp_path) -> None:
    # Once reels are associated (reel_match_ids set), they dispatch per reel and
    # need no identity files — the hook must NOT fire.
    segs = _segs(_TWO_MATCH)
    results = [_p2(i, s) for i, s in enumerate(_TWO_MATCH)]
    emitted: list[list] = []

    dispatch_reels(
        segs,
        results,
        sha_root=tmp_path,
        dispatch_fn=_RecordingDispatch(),
        match_id=None,
        reel_match_ids={0: 400, 1: 401},
        emit_reel_identities=emitted.append,
        game_title_id=1,
        video_sha256="a" * 64,
    )

    assert emitted == []


def test_write_reels_json_round_trip(tmp_path) -> None:
    segs = _segs(_TWO_MATCH)
    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segs, dropped=drops)

    path = write_reels_json(tmp_path, reels, dropped=drops)
    assert path == tmp_path / "reels.json"

    body = json.loads(path.read_text())
    assert body["reel_count"] == 2
    assert body["dropped"] == []
    assert body["reels"][0]["reel_index"] == 0
    assert body["reels"][0]["segment_indices"] == [0, 1, 2, 3]
    assert body["reels"][1]["segment_indices"] == [4, 5, 6, 7]
    assert set(body["reels"][0]["screen_inventory"].keys()) == {
        "has_lobby",
        "has_boxscore",
        "has_action_tracker",
        "has_events",
        "has_loadout",
    }
    assert body["reels"][0]["boundary_confidence"] == 1.0
