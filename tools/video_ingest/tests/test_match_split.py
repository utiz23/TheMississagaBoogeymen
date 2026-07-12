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

from video_ingest.match_split import Reel, group_into_reels
from video_ingest.pass1_classify import Segment


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
