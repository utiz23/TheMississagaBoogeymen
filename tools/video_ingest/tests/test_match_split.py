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
