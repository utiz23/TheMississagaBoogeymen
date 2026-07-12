"""Match-split: group Pass-1 segments into per-match reels.

A *reel* is one game's worth of contiguous Pass-1 segments. A multi-match
recording (~47 of our trapped games live inside 16 such files) produces one reel
per game; a single-match recording produces exactly one reel and keeps today's
behaviour. The grouping is pure — no I/O, no decode — so it is cheap to test
against synthetic Segment sequences (see tests/test_match_split.py).

Real state-machine vocabulary (tools/game_ocr/game_ocr/configs/state_machine/
nhl26.yaml) — NOT the design spec's simplified names:

  OPENERS  — a fresh match begins: pre_game_lobby_state_1, pre_game_lobby_state_2,
             loading_or_intro.
  POSTGAME — the box-score / summary burst that ends a match.
  TERMINAL — end_of_video.

Everything else (unknown_or_transition, in_game_*, player_loadout_view,
menu_world_of_chel) belongs to whichever open reel contains it.

Grouping rule: a reel opens at the first OPENER after the previous reel closed
(or, for a late-start recording, at the first match-content segment at video
start). It closes at the last contiguous POSTGAME before the *next* OPENER, or
at end_of_video / end-of-list. Segments stranded between one reel's post-game
and the next reel's opener are recorded as dropped-with-reason (flag-never-drop)
via the optional ``dropped`` out-parameter — never merged into a neighbour.
"""

from __future__ import annotations

from dataclasses import dataclass

from video_ingest.pass1_classify import Segment

OPENERS = frozenset(
    {
        "pre_game_lobby_state_1",
        "pre_game_lobby_state_2",
        "loading_or_intro",
    }
)
POSTGAME = frozenset(
    {
        "post_game_player_summary",
        "post_game_box_score_goals",
        "post_game_box_score_shots",
        "post_game_box_score_faceoffs",
        "post_game_events",
        "post_game_action_tracker",
        "post_game_faceoff_map",
        "post_game_net_chart",
    }
)
TERMINAL = "end_of_video"

LOBBY_SCREENS = frozenset({"pre_game_lobby_state_1", "pre_game_lobby_state_2"})
BOXSCORE_SCREENS = frozenset(
    {
        "post_game_box_score_goals",
        "post_game_box_score_shots",
        "post_game_box_score_faceoffs",
    }
)
LOADOUT_SCREEN = "player_loadout_view"


def _is_gameplay(screen_type: str) -> bool:
    return screen_type.startswith("in_game_")


@dataclass
class Reel:
    reel_index: int
    start_s: float
    end_s: float
    segment_indices: list[int]  # indices INTO the input segments list
    screen_inventory: dict[str, bool]  # has_lobby/boxscore/action_tracker/events/loadout
    completeness_flags: list[str]  # missing_lobby | partial_no_boxscore | incomplete | low_confidence_boundary
    boundary_confidence: float


def _finalize(
    indices: list[int],
    closed_by: str,
    segments: list[Segment],
    reel_index: int,
) -> Reel:
    """Build a Reel from its (contiguous) segment indices + how it closed.

    Completeness flags (all advisory — the reel is always emitted):
      missing_lobby          — no lobby screen captured (can't read the roster).
      partial_no_boxscore    — no box-score screen (nothing to grade / promote).
      incomplete             — neither an opener nor any post-game (barely a reel).
      low_confidence_boundary — closed by the next match's opener with only a
                               single post-game screen: weak game-end evidence.
    """
    indices = sorted(indices)
    screens = [segments[i].screen_type for i in indices]
    inventory = {
        "has_lobby": any(s in LOBBY_SCREENS for s in screens),
        "has_boxscore": any(s in BOXSCORE_SCREENS for s in screens),
        "has_action_tracker": "post_game_action_tracker" in screens,
        "has_events": "post_game_events" in screens,
        "has_loadout": LOADOUT_SCREEN in screens,
    }
    has_opener = any(s in OPENERS for s in screens)
    postgame_count = sum(1 for s in screens if s in POSTGAME)

    flags: list[str] = []
    if not inventory["has_lobby"]:
        flags.append("missing_lobby")
    if not inventory["has_boxscore"]:
        flags.append("partial_no_boxscore")
    if not has_opener and postgame_count == 0:
        flags.append("incomplete")
    low_confidence = closed_by == "opener" and postgame_count == 1
    if low_confidence:
        flags.append("low_confidence_boundary")

    return Reel(
        reel_index=reel_index,
        start_s=segments[indices[0]].start_seconds,
        end_s=segments[indices[-1]].end_seconds,
        segment_indices=indices,
        screen_inventory=inventory,
        completeness_flags=flags,
        boundary_confidence=0.5 if low_confidence else 1.0,
    )


def group_into_reels(
    segments: list[Segment],
    *,
    dropped: list[tuple[int, str]] | None = None,
) -> list[Reel]:
    """Group Pass-1 segments into per-match reels.

    ``dropped`` (optional) receives ``(segment_index, reason)`` tuples for every
    input segment that lands in no reel, guaranteeing the flag-never-drop
    invariant: each input index appears in exactly one reel OR in ``dropped``.
    """
    drops = dropped if dropped is not None else []
    finished: list[tuple[list[int], str]] = []  # (indices, closed_by)

    cur: dict | None = None
    pending_gap: list[int] = []  # 'other' segments seen after a reel's post-game

    for i, seg in enumerate(segments):
        st = seg.screen_type
        is_opener = st in OPENERS
        is_post = st in POSTGAME
        is_term = st == TERMINAL
        is_gp = _is_gameplay(st)

        if cur is None:
            if is_opener:
                cur = {"indices": [i], "seen_gp": False, "last_pg_pos": None}
            elif is_post or is_gp or st == LOADOUT_SCREEN:
                # Late start: match content appears before any opener — the reel
                # opens at video start on this segment.
                cur = {
                    "indices": [i],
                    "seen_gp": is_post or is_gp,
                    "last_pg_pos": i if is_post else None,
                }
            else:
                # unknown_or_transition / menu_world_of_chel / stray terminal with
                # no reel to attach to — pre-roll noise between matches.
                drops.append((i, f"no_open_reel:{st}"))
            continue

        if is_opener:
            if cur["seen_gp"]:
                # Boundary: the previous reel has already played — close it at its
                # last post-game, strand the inter-match gap, start a fresh reel.
                finished.append((cur["indices"], "opener"))
                for g in pending_gap:
                    drops.append((g, "between_reels_gap"))
                pending_gap = []
                cur = {"indices": [i], "seen_gp": False, "last_pg_pos": None}
            else:
                # Still pre-game (contiguous opener run) — same reel.
                cur["indices"].append(i)
        elif is_post:
            # Any 'other' segments between two post-game screens are interior.
            cur["indices"].extend(pending_gap)
            pending_gap = []
            cur["indices"].append(i)
            cur["last_pg_pos"] = i
            cur["seen_gp"] = True
        elif is_term:
            cur["indices"].extend(pending_gap)
            pending_gap = []
            cur["indices"].append(i)
            finished.append((cur["indices"], "terminal"))
            cur = None
        else:
            # 'other': gameplay / unknown_or_transition / loadout / world-of-chel.
            if cur["last_pg_pos"] is not None:
                # After the reel's post-game — hold; dropped if a new opener
                # arrives, absorbed if another post-game / terminal / EOL follows.
                pending_gap.append(i)
            else:
                cur["indices"].append(i)
            if is_gp:
                cur["seen_gp"] = True

    if cur is not None:
        cur["indices"].extend(pending_gap)
        finished.append((cur["indices"], "eol"))
    else:
        for g in pending_gap:
            drops.append((g, "trailing_gap_no_reel"))

    return [
        _finalize(indices, closed_by, segments, ri)
        for ri, (indices, closed_by) in enumerate(finished)
    ]
