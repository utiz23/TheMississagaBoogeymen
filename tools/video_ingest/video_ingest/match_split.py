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

import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable

from video_ingest.pass1_classify import Segment

REELS_JSON_FILENAME = "reels.json"
REELS_JSON_SCHEMA_VERSION = 1

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


def write_reels_json(
    sha_root: Path,
    reels: list[Reel],
    *,
    dropped: list[tuple[int, str]] | None = None,
) -> Path:
    """Serialize the reel grouping to ``sha_root/reels.json`` and return its path.

    An additive evidence sidecar: the per-match reel plan (boundaries, screen
    inventory, completeness flags) plus any dropped-with-reason segments, so the
    association step (②) and operators can inspect how a video was split.
    """
    payload = {
        "schema_version": REELS_JSON_SCHEMA_VERSION,
        "reel_count": len(reels),
        "reels": [asdict(r) for r in reels],
        "dropped": [[idx, reason] for idx, reason in (dropped or [])],
    }
    path = Path(sha_root) / REELS_JSON_FILENAME
    path.write_text(json.dumps(payload, indent=2))
    return path


def _stderr_log(message: str) -> None:
    print(message, file=sys.stderr)


def dispatch_reels(
    segments: list[Segment],
    pass2_results: Iterable,
    *,
    sha_root: Path,
    dispatch_fn: Callable,
    match_id: int | None,
    reel_match_ids: dict[int, int] | None = None,
    emit_reel_identities: Callable[[list["Reel"]], None] | None = None,
    log: Callable[[str], None] | None = None,
    **dispatch_kwargs,
) -> list:
    """Group Pass-1 segments into reels, emit reels.json, and dispatch per the
    Milestone ① boundary contract (② association not built yet):

      * 1 reel (or 0)                     → dispatch ALL results under ``match_id``
                                            in one call — today's exact behaviour.
      * >1 reel and ``reel_match_ids`` None → write reels.json + per-reel identity
                                            files (via ``emit_reel_identities``),
                                            log "N reels need association", and SKIP
                                            dispatch. Keeps multi-match videos safe
                                            (no collapse/overwrite) until ② maps
                                            reels.
      * >1 reel and ``reel_match_ids`` set  → dispatch each reel's Pass-2 subset
                                            (by segment_index membership) under its
                                            mapped match_id — one call per reel.

    ``dispatch_fn`` is injected (the orchestrator passes
    ``video_ingest.dispatch.dispatch_segments``); it is called
    ``dispatch_fn(results, match_id=<id>, **dispatch_kwargs)``.
    ``emit_reel_identities`` is likewise injected (the orchestrator passes a
    closure over ``identity_probe.write_reel_identities`` + a Pass-2 persona
    reader); it fires only in the un-associated multi-reel branch, right beside
    reels.json, so the Session-A ``resolve-match propose`` CLI has one identity
    file per reel to score. Returns the concatenated dispatch results (empty when
    dispatch is skipped).
    """
    emit = log or _stderr_log
    results = list(pass2_results)

    drops: list[tuple[int, str]] = []
    reels = group_into_reels(segments, dropped=drops)
    write_reels_json(sha_root, reels, dropped=drops)
    for idx, reason in drops:
        emit(f"[reels] dropped Pass-1 segment {idx}: {reason}")

    # Single-match parity: fan every Pass-2 result out under the one match_id,
    # exactly as the pre-reel pipeline did (unfiltered, one call).
    if len(reels) <= 1:
        return list(dispatch_fn(results, match_id=match_id, **dispatch_kwargs))

    if reel_match_ids is None:
        if emit_reel_identities is not None:
            emit_reel_identities(reels)
        emit(
            f"[reels] {len(reels)} reels need association — reels.json written, "
            f"dispatch deferred to Milestone ② (no collapse)."
        )
        return []

    # Reels of DIFFERENT matches cannot share one ocr_decoder_runs row
    # (``match_id`` is NOT NULL), so a single shared ``run_id`` must never be
    # forwarded across them — each reel dispatches under ``run_id=None`` (the
    # fresh-ingest convention). Per-reel candidate runs (minted via
    # ``decoder-runs create-candidate --match-id <reel's match>``) are the
    # deferred promotion-path follow-up (see the step-2 plan's step-(3) note).
    per_reel_kwargs = {**dispatch_kwargs, "run_id": None}
    by_index = {r.segment_index: r for r in results}
    out: list = []
    for reel in reels:
        if reel.reel_index not in reel_match_ids:
            emit(
                f"[reels] reel {reel.reel_index} has no mapped match_id — skipped."
            )
            continue
        subset = [
            by_index[i] for i in reel.segment_indices if i in by_index
        ]
        out.extend(
            dispatch_fn(
                subset,
                match_id=reel_match_ids[reel.reel_index],
                **per_reel_kwargs,
            )
        )
    return out
