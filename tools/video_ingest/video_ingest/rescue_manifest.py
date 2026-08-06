"""Stage-A / Phase-1 post-game rescue manifest — pure decision logic.

The ~190 selected-tab frames that Pass-1 read correctly but the ``viterbi_v2``
segmenter dropped or absorbed are still recoverable from the cached
``segments.json`` files: each frame keeps the verbatim top-bar OCR read in
``anchor_text``, so the screen it was showing is recoverable *without* any
re-decode.

This module holds every decision the rescue makes, as pure functions over
plain data, so the whole policy is unit-testable with no cache, no video and
no database. The IO shell — walking the cache, querying the DB, writing the
manifest — lives in ``scripts/rescue_postgame_from_cache.py``.

Phase 1 is strictly read-only: it emits a manifest and nothing else. Stage B's
executor consumes that manifest verbatim and never recomputes these decisions.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Iterable, Sequence

from video_ingest.rescue_sampling import (
    NEIGHBOUR_OFFSETS,
    SAMPLING_MODE,
    TOLERANCE_FRAME_FRACTION,
    FramePtsProbe,
    SamplingImpossible,
    SourceGrid,
    UnsupportedFrameRate,
    canonical_ffmpeg_argv,
    observe_plan,
    plan_sampling,
    sampling_to_dict,
)

#: v2 adds the three identity ledgers below, so `skip` now covers a second
#: meaning ("decided: nothing to execute") alongside `already_covered`, and
#: several new reasons exist.
#:
#: v3 replaces the command object's sampling contract. `commands.sample_fps` and
#: the `-vf fps=N` argv it described are GONE, replaced by `commands.sampling`
#: (see `video_ingest.rescue_sampling`) and a deterministic source-PTS select
#: expression. The bump is required rather than cosmetic: a schema-2 reader
#: would find `sample_fps` absent and an unfamiliar `sampling` block, and a
#: schema-2 *validator* would pass a v3 manifest while checking none of the new
#: contract — the exact shape of silent acceptance the version field exists to
#: prevent. It is a manifest-CONTRACT change, so it gets a version, and the
#: executor's `policy_problems` refuses anything else.
SCHEMA_VERSION = 3

#: Stamped on every rescued row so Stage B's rollback can find them.
RESCUE_DECODER_VERSION = "rescue-b2-anchor-v1"

#: Rescue segment indices start here so they can never collide with a real
#: Pass-2 segment index (the largest observed is in the low hundreds).
SEGMENT_INDEX_BASE = 9000

#: Two candidate frames further apart than this start separate windows. Pass-1
#: samples at 1 fps, so this tolerates a single dropped sample inside a run.
GROUP_MAX_GAP_S = 2.0

#: Symmetric pad applied to a window before clamping, so the re-extract has a
#: frame on either side of the evidence rather than landing exactly on it.
WINDOW_PAD_S = 0.75

#: A frame that falls outside every reel may attach to the reel that ended at
#: most this long before it (post-game tails run past the reel's last segment).
REEL_LOOKBACK_S = 120.0

UNKNOWN_STATE = "unknown_or_transition"

DECISION_AUTO = "auto"
DECISION_REVIEW = "review"
DECISION_SKIP = "skip"
#: Not a window at all -- the read is proven not to be a post-game tab. Kept as
#: an explicit verdict (rather than a silent `None`) so the report can tally it.
DECISION_DROP = "drop"

REEL_CONTAINED = "contained"
REEL_LOOKBACK = "lookback"
REEL_UNRESOLVED = "unresolved"

# ─── Reasons and their classes ──────────────────────────────────────────────

# Ambiguity that no amount of identity work removes -- the persisted evidence
# genuinely does not name the tab. This is legitimate human review work.
R_SUMMARY_CATEGORY = "summary_category_dropdown_occludes_tab"
R_PLAYER_SUMMARY = "player_summary_anchor_shared_with_end_of_game"
R_MIXED_ANCHOR = "ambiguous_mixed_anchor"
# Identity that is not settled -- a blocker, never hand-approvable.
R_NO_CONFIRMED_MATCH = "reel_has_no_confirmed_match"
R_OUTSIDE_EVERY_REEL = "frame_outside_every_reel"
R_SPANS_MULTIPLE_REELS = "window_spans_multiple_reels"
R_DUPLICATE_UNCOVERED = "duplicate_recording_adds_uncovered_screen"
# Attachment by inference rather than containment, not individually confirmed.
R_LOOKBACK = "frame_attached_to_reel_by_lookback"
# Decided states -- no execution, and nothing is lost.
R_ALREADY_COVERED = "already_covered"
R_DUPLICATE_SUPERSEDED = "duplicate_recording_superseded_by_primary"
# Pipeline preconditions.
R_NO_ACTIVE_RUN = "match_has_no_active_run"
R_VIDEO_PATH_MISSING = "video_path_missing"
R_NEVER_INGESTED = "match_never_ocr_ingested"

CLASS_EXPECTED_AMBIGUITY = "expected_ambiguity"
CLASS_UNRESOLVED_IDENTITY = "unresolved_identity"
CLASS_UNCONFIRMED_LOOKBACK = "unconfirmed_lookback"
CLASS_NOT_INGESTED = "not_ingested"
CLASS_PIPELINE_PRECONDITION = "pipeline_precondition"
CLASS_DECIDED_NO_ACTION = "decided_no_action"
CLASS_OTHER = "other"

#: Why a window is not auto, grouped so the gate can be judged by reason rather
#: than by a single headline rate: expected ambiguity is review work, unresolved
#: identity is a blocker, unconfirmed lookback stays review by policy.
REASON_CLASSES: dict[str, str] = {
    R_SUMMARY_CATEGORY: CLASS_EXPECTED_AMBIGUITY,
    R_PLAYER_SUMMARY: CLASS_EXPECTED_AMBIGUITY,
    R_MIXED_ANCHOR: CLASS_EXPECTED_AMBIGUITY,
    R_NO_CONFIRMED_MATCH: CLASS_UNRESOLVED_IDENTITY,
    R_OUTSIDE_EVERY_REEL: CLASS_UNRESOLVED_IDENTITY,
    R_SPANS_MULTIPLE_REELS: CLASS_UNRESOLVED_IDENTITY,
    R_DUPLICATE_UNCOVERED: CLASS_UNRESOLVED_IDENTITY,
    R_LOOKBACK: CLASS_UNCONFIRMED_LOOKBACK,
    R_NEVER_INGESTED: CLASS_NOT_INGESTED,
    R_NO_ACTIVE_RUN: CLASS_PIPELINE_PRECONDITION,
    R_VIDEO_PATH_MISSING: CLASS_PIPELINE_PRECONDITION,
    R_ALREADY_COVERED: CLASS_DECIDED_NO_ACTION,
    R_DUPLICATE_SUPERSEDED: CLASS_DECIDED_NO_ACTION,
}


def reason_class(reason: str | None) -> str:
    return REASON_CLASSES.get(reason or "", CLASS_OTHER)


# ─── Identity ledgers ────────────────────────────────────────────────────────
#
# Three hand-adjudicated ledgers, each enumerating *specific* evidence rather
# than relaxing a rule. Anything not enumerated keeps the strict default, so a
# new cache, a new reel or a shifted frame time fails closed back to review.

#: Lookback frames whose match identity was individually confirmed (2026-08-03).
#:
#: Lookback attachment stays review-only by policy -- match 977 proves a reel
#: boundary can be crossed. These entries are the exception, and each one had to
#: pass all five checks below before being listed. The key includes the frame's
#: exact second, so a re-decode that moves the frame drops it back to review.
#:
#:   C1  no `pre_game_lobby` / `loading_or_intro` / `in_game_clock` /
#:       `player_loadout` segment lies between the reel's end and the frame --
#:       no new game starts in the gap.
#:   C2  the post-game progression nav bar ("CLUB SEASONS PROGRESSION ... END OF
#:       GAME") is read within +-60 s of the frame, proving the post-game menu
#:       system is on screen (n=8..30 per window).
#:   C3  no `pause` token in the anchor. The mid-game PAUSE > GAME STATS screen
#:       carries the same tab bar as the post-game one; corpus-wide exactly one
#:       candidate frame reads it, and it is on the already-rejected reel
#:       `8f43caac:1`, not here.
#:   C4  the next reel starts >= 83 s after the last frame in the window.
#:   C5  an oracle fully independent of the OCR pipeline: EA's `matches.played_at`
#:       (game END) minus the recording's wall-clock basename gives the expected
#:       video time of the final whistle. Calibrated on the 84 contained auto
#:       windows, whose identity was never in question, the post-game browse
#:       lands at delta = +10..+213 s (median +66). All 19 frames below fall in
#:       that band for their assigned match (+24..+169), and every competing
#:       match on the same video is refuted by 519..6085 s -- the nearest rival
#:       is 4.5x outside the calibrated maximum.
CONFIRMED_LOOKBACK_FRAMES: frozenset[tuple[str, int, str, float]] = frozenset(
    (sha, reel, screen, seconds)
    for sha, reel, frames in (
        # match 472 (DNF 0-3; on-screen 0-2 at the quit) -- delta +38..+53 s
        ("b1283377121130c3c9d24799c201df47aa57a65edc0ad1b0bcd393daf47e99d1", 0, (
            ("post_game_faceoff_map", 1320.0),
            ("post_game_net_chart", 1324.0),
            ("post_game_box_score_shots", 1332.0),
            ("post_game_box_score_faceoffs", 1333.0),
            ("post_game_events", 1335.0),
        )),
        # match 563 -- delta +63..+68 s
        ("861ab2064150d2568eb3f8f4d3c5c268fe50a79aaf89a4d6abd308dd3d7cad8c", 0, (
            ("post_game_box_score_faceoffs", 1093.0),
            ("post_game_box_score_goals", 1095.0),
            ("post_game_events", 1098.0),
        )),
        # match 606 -- delta +169 s (longest post-game presentation in the set)
        ("392a991ee4017fae9ca1ffbfe4c2488b245c4763a13c305f712136a4a1e6574b", 0, (
            ("post_game_box_score_goals", 1695.0),
        )),
        # match 977 -- the reel-boundary case. Reel 1 ends at its last segment
        # (755 s) and its own post-game tail falls outside it; the tail is not
        # another match's, it is this reel's, cut off. delta +24..+45 s, and the
        # next match (978) is refuted by -519..-540 s.
        ("3be3a09324d88cd46ca422d806bbc2eb1d4569ea13b3a0084324d7103abd054f", 1, (
            ("post_game_net_chart", 759.0),
            ("post_game_box_score_goals", 774.0),
            ("post_game_box_score_shots", 775.0),
            ("post_game_events", 778.0),
            ("post_game_events", 779.0),
            ("post_game_box_score_goals", 780.0),
        )),
        # match 2402 -- delta +86 s
        ("ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b", 0, (
            ("post_game_box_score_goals", 1729.0),
        )),
        # match 2403 -- delta +37..+38 s; the same video's 2402 is +951 s away
        ("ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b", 1, (
            ("post_game_events", 2594.0),
            ("post_game_box_score_goals", 2595.0),
        )),
        # match 2682 -- delta +65 s
        ("6f010c2e9c1aba4ee7fc4ffada7b8595a8dd81e449510a36df834942060149db", 0, (
            ("post_game_box_score_goals", 1282.0),
        )),
    )
    for screen, seconds in frames
)


@dataclass(frozen=True)
class DuplicateRecording:
    """A second recording of a match whose primary reel is already confirmed."""

    match_id: int
    primary_video_sha256: str
    primary_offset_s: float
    note: str


#: Trimmed re-recordings that are deliberately NOT associated (2026-08-03).
#:
#: Each is a `- Trim*.mp4` cut of the SAME source recording as the match's
#: confirmed primary reel -- proven by aligning the two caches frame by frame on
#: verbatim anchor strings, which yields a single constant offset per pair. They
#: are therefore not independent footage: every moment they hold also exists on
#: the primary, at `t + primary_offset_s`.
#:
#: Associating them would mint a second reel identity for a match that already
#: has one, for zero new coverage -- verified per window, not assumed: the
#: generator still checks each target screen against the match's active-run
#: coverage and against what the primary's own rescue windows recover, and any
#: window that would add something falls back to review.
DUPLICATE_RECORDINGS: dict[str, DuplicateRecording] = {
    "02664c7d061e6fb9602cce1c7940937930136b73ca4b24e795566afa19ecb0b4": DuplicateRecording(
        match_id=2683,
        primary_video_sha256="6f010c2e9c1aba4ee7fc4ffada7b8595a8dd81e449510a36df834942060149db",
        primary_offset_s=1538.0,
        note="match2683/2026-06-20_16-04-36 - Trim.mp4; primary reel 6f010c2e9c1a:1",
    ),
    "2d13e4197a3b9b645645fe1da7d1933c3aad3f9cdb7dbf152ff37a294453e3a1": DuplicateRecording(
        match_id=2666,
        primary_video_sha256="1fb12c1f638e80c6e7585e6bbafa2cba1d66b5ddf284131653247bc3a8f037ce",
        primary_offset_s=3447.0,
        note="match2666/2026-06-12_19-44-56 - Trim2.mp4; primary reel 1fb12c1f638e:1",
    ),
    "bc4990a008c791c445885f0ac44f70c5f09027dd7b4a8a8a9572fca2ea1569fe": DuplicateRecording(
        match_id=2688,
        primary_video_sha256="f3c8a6e6102a75fff146bdfc7199c1695d1cfa6ba6a4f3753438121db0a54623",
        primary_offset_s=2391.0,
        note="match2688/2026-06-21_15-58-18 - Trim2.mp4; primary reel f3c8a6e6102a:2",
    ),
    "f5693db3e6fe685256fce0d0d4bf6f789b36c99946c22dc48e1f904b5d263f4c": DuplicateRecording(
        match_id=2687,
        primary_video_sha256="f3c8a6e6102a75fff146bdfc7199c1695d1cfa6ba6a4f3753438121db0a54623",
        primary_offset_s=1557.0,
        note="match2687/2026-06-21_15-58-18 - Trim.mp4; primary reel f3c8a6e6102a:1",
    ),
}

#: Cached videos whose match was never OCR-ingested at all (2026-08-03).
#:
#: Not an association gap: match 2400 has zero `ocr_decoder_runs`, zero
#: `ocr_capture_batches` and zero associations. Its identity is not in doubt --
#: the folder names it, the C5 timestamp oracle puts the final whistle at
#: t≈1527 s (the post-game browse starts at 1538 s, delta +11 s), and the
#: anchor at t=1539 reads the final score "3-0", which is the match's recorded
#: result. But a rescue attaches recovered segments to an existing run, and
#: there is no run to attach to. The fix is a normal ingest of the video, not a
#: rescue window, so these are reported honestly rather than left looking like
#: a backfill away from working.
MATCHES_NEVER_INGESTED: dict[str, int] = {
    "a05d536499241b734880b7fdc21a64b1f81b468ddd008433533597d0e739d30e": 2400,
}


def is_confirmed_lookback(
    video_sha256: str, reel_index: int | None, target_screen: str | None, seconds: float
) -> bool:
    """Whether this exact frame is in the individually-confirmed ledger."""
    if reel_index is None or target_screen is None:
        return False
    return (video_sha256, reel_index, target_screen, float(seconds)) in CONFIRMED_LOOKBACK_FRAMES


def duplicate_verdict(
    target_screen: str | None,
    covered_screens: frozenset[str] | set[str],
    primary_recovered_screens: frozenset[str] | set[str],
) -> tuple[str, str]:
    """What to do with a window on a deliberately unassociated duplicate.

    Skipping is only allowed once the screen is provably not lost: it is either
    review-only anyway (no concrete target), already in the match's active run,
    or already recovered by a rescue window on the primary recording. Anything
    else falls back to review rather than being silently dropped.
    """
    if (
        target_screen is None
        or target_screen in covered_screens
        or target_screen in primary_recovered_screens
    ):
        return DECISION_SKIP, R_DUPLICATE_SUPERSEDED
    return DECISION_REVIEW, R_DUPLICATE_UNCOVERED


# ─── Anchor rules ────────────────────────────────────────────────────────────

# (rule name, pattern, state). Order matters — first match wins, so the more
# specific patterns precede the broad ones. Same shape and same patterns as
# `tools/game_ocr/scripts/extract_postgame_training_frames.py:34-45`, which in
# turn mirrors the top-bar priors in `nhl26_regex_priors.yaml`. `\s*` survives
# OCR word-concatenation ("allevents", "goalsummary", "netchart"); `\b` keeps
# the bare-"all" scoring-summary filter from firing inside "allevents".
AUTO_RULES: tuple[tuple[str, str, str], ...] = (
    # `events?` tolerates the OCR dropping the plural ("lt all event rt 2nd
    # period" is the action tracker, not the scoring-summary ALL filter).
    ("all_events", r"all\s*events?\b", "post_game_action_tracker"),
    ("goal_summary", r"goals?\s*summary", "post_game_box_score_goals"),
    ("shot_summary", r"shots?\s*summary", "post_game_box_score_shots"),
    ("faceoff_summary", r"face\s*-?\s*off\s*summary", "post_game_box_score_faceoffs"),
    ("net_chart", r"net\s*chart", "post_game_net_chart"),
    ("faceoff_map", r"face\s*-?\s*off", "post_game_faceoff_map"),  # after faceoff-summary
    ("all_filter", r"\ball\b", "post_game_events"),  # bare "all" (scoring summary)
)

# (rule name, pattern, state or None, reason). These reads are ambiguous in the
# evidence that Pass-1 actually persisted, so they are recorded for a human and
# never auto-executed.
REVIEW_RULES: tuple[tuple[str, str, str | None, str], ...] = (
    # Only `top_bar_text` was persisted per frame (orchestrator.py:315-326) --
    # `side_strip_text` was never stored. The END OF GAME team-stats tab shares
    # the PLAYER SUMMARY top-bar read, and the side strip was the only thing
    # that told them apart, so the cache cannot prove which one was on screen.
    (
        "player_summary",
        r"player\s*summary",
        "post_game_player_summary",
        R_PLAYER_SUMMARY,
    ),
    # The category dropdown occludes the tab label. Corpus-wide these resolve
    # to goals (17), net_chart (7) and shots (1) -- genuinely ambiguous, so the
    # string is never mapped to a screen.
    (
        "summary_category",
        r"(?:summary|select)\s*category",
        None,
        R_SUMMARY_CATEGORY,
    ),
)

#: Review reasons that describe the *evidence*, not the pipeline. A frame in
#: this class is review-only whatever its identity turns out to be, so an
#: identity failure must not overwrite the reason -- otherwise the gate table
#: counts expected ambiguity as an identity blocker.
PRE_DECLARED_REVIEW_REASONS = frozenset({R_PLAYER_SUMMARY, R_SUMMARY_CATEGORY, R_MIXED_ANCHOR})

# Reads that name a screen with no state at all. Nothing to rescue, so these
# frames are not candidates. Order matters -- first match names the drop.
#
# The Club Seasons Progression nav bar is listed FIRST because it is the single
# largest confounder in the corpus (1959 frames) and it contains BOTH strings
# the plan flagged as ambiguous:
#   "CLUB SEASONS PROGRESSION | PLAYER RANK | PLAYER PROGRESSION |
#    CLUB PROGRESSION | PLAYER SUMMARY | END OF GAME"
# Attributing it to end_of_game would hide that it is a menu, not a tab.
NO_TARGET_RULES: tuple[tuple[str, str], ...] = (
    ("progression_menu", r"(?:club|player)\s*progression"),
    ("end_of_game", r"end\s*of\s*game"),
)

# Rules whose string is NOT self-identifying -- it also occurs away from the
# post-game tab bar, so on its own it proves nothing:
#   all_filter       "ALL CCM OUT." rink boards, "mark all as read" console
#                    chat overlays, "waiting for ALL users to resume"
#   faceoff_map      the in-game "LOST FACEOFF" banner
#   player_summary   the Club Seasons Progression nav bar, which reads
#                    "... CLUBPROGRESSION PLAYERSUMMARY ..."
#   summary_category the category dropdown label
# Measured over all 175 499 cached frames: every genuinely-distinctive tab read
# carries the LT/RT bumper cycler (shot summary 44/44, net chart 127/127, all
# events 1719/1720, goal summary 160/169), so requiring the bumper for these
# four rules is a cheap, high-precision corroboration. Without it the rules are
# badly polluted -- all 1961 "player summary" hits are the progression menu and
# carry NO bumper, which is why this guard drops the entire class.
BUMPER_REQUIRED_RULES = frozenset(
    {"all_filter", "faceoff_map", "player_summary", "summary_category"}
)
BUMPER_PATTERN = r"\b(?:lt|rt)\b"

# "LT ALL SKATERS <COLUMN>" is the box-score sort selector cycling its column
# names (PLAYER, MINUTES, PLUS/MINUS, FACEOFFS TAKEN, FACEOFF% ...). It carries
# a bumper but names no tab, so it must not satisfy the weak rules.
SORT_SELECTOR_PATTERN = r"all\s*skaters"

DROP_NO_BUMPER = "weak_anchor_without_postgame_bumper"
DROP_SORT_SELECTOR = "all_skaters_sort_selector"
DROP_NO_STATE = "screen_has_no_state"

#: The screens a window may be executed for without human review.
AUTO_ELIGIBLE_SCREENS: tuple[str, ...] = tuple(
    dict.fromkeys(state for _, _, state in AUTO_RULES)
)


def normalize_anchor(anchor: str) -> str:
    """Lowercase and collapse whitespace, matching the training extractor."""
    return re.sub(r"\s+", " ", (anchor or "").strip().lower())


@dataclass(frozen=True)
class AnchorVerdict:
    """What a single frame's persisted top-bar read proves."""

    rule: str
    target_screen: str | None
    decision: str
    reason: str | None


def _weak_rule_corroborated(text: str) -> tuple[bool, str | None]:
    """Whether a non-self-identifying rule may fire on this read."""
    if re.search(SORT_SELECTOR_PATTERN, text):
        return False, DROP_SORT_SELECTOR
    if not re.search(BUMPER_PATTERN, text):
        return False, DROP_NO_BUMPER
    return True, None


def classify_anchor(anchor: str) -> AnchorVerdict | None:
    """Map a persisted ``anchor_text`` to the screen it proves.

    Returns ``None`` when no rule engages at all, a ``DECISION_DROP`` verdict
    when a rule engaged but the read is proven not to be a post-game tab, and
    an auto/review verdict otherwise.

    A read that fires both a distinctive rule and an ambiguous one is a
    mid-transition frame showing two tab labels at once — it is downgraded to
    review rather than trusted, since neither label is provably the selected
    one.
    """
    text = normalize_anchor(anchor)
    if not text:
        return None

    auto = next(((n, s) for n, p, s in AUTO_RULES if re.search(p, text)), None)
    review = next(((n, s, r) for n, p, s, r in REVIEW_RULES if re.search(p, text)), None)
    blocked = next((n for n, p in NO_TARGET_RULES if re.search(p, text)), None)

    # Weak rules need the post-game bumper cycler; distinctive ones stand alone.
    dropped_rule, drop_reason = None, None
    if auto and auto[0] in BUMPER_REQUIRED_RULES:
        ok, why = _weak_rule_corroborated(text)
        if not ok:
            dropped_rule, drop_reason, auto = auto[0], why, None
    if review and review[0] in BUMPER_REQUIRED_RULES:
        ok, why = _weak_rule_corroborated(text)
        if not ok:
            dropped_rule, drop_reason, review = review[0], why, None

    if auto and (review or blocked):
        return AnchorVerdict(
            rule=f"{auto[0]}+{review[0] if review else blocked}",
            target_screen=auto[1],
            decision=DECISION_REVIEW,
            reason=R_MIXED_ANCHOR,
        )
    if review:
        return AnchorVerdict(review[0], review[1], DECISION_REVIEW, review[2])
    if auto:
        return AnchorVerdict(auto[0], auto[1], DECISION_AUTO, None)
    if blocked:
        return AnchorVerdict(blocked, None, DECISION_DROP, DROP_NO_STATE)
    if dropped_rule:
        return AnchorVerdict(dropped_rule, None, DECISION_DROP, drop_reason)
    return None


# ─── Candidate frames ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CandidateFrame:
    """A cached frame whose anchor disagrees with the segmenter's label."""

    seconds: float
    anchor_text: str
    assigned_screen_type: str
    target_screen: str | None
    decision: str
    rule: str
    reason: str | None


def select_candidates(
    frame_classifications: Iterable[dict[str, Any]],
) -> list[CandidateFrame]:
    """Frames whose anchor-derived state differs from the assigned one.

    Catches both failure shapes: frames left at ``unknown_or_transition``
    (the segmenter dropped them) and frames absorbed into a neighbouring
    post-game segment.

    An ambiguous (review-class) anchor is only taken as evidence when the frame
    landed in ``unknown_or_transition``. Such a read cannot prove a concrete
    assignment wrong — it is ambiguous by construction — so a review-class
    frame sitting inside a real post-game segment is not a coverage gap and is
    dropped rather than filed as review noise.
    """
    out: list[CandidateFrame] = []
    for fc in frame_classifications:
        verdict = classify_anchor(fc.get("anchor_text") or "")
        if verdict is None or verdict.decision == DECISION_DROP:
            continue
        assigned = str(fc.get("screen_type") or "")
        if verdict.target_screen is not None and verdict.target_screen == assigned:
            continue
        if verdict.decision == DECISION_REVIEW and assigned != UNKNOWN_STATE:
            continue
        seconds = fc.get("source_time_seconds", fc.get("seconds"))
        if seconds is None:
            continue
        out.append(
            CandidateFrame(
                seconds=float(seconds),
                anchor_text=str(fc.get("anchor_text") or ""),
                assigned_screen_type=assigned,
                target_screen=verdict.target_screen,
                decision=verdict.decision,
                rule=verdict.rule,
                reason=verdict.reason,
            )
        )
    out.sort(key=lambda c: c.seconds)
    return out


def tally_dropped_anchors(
    frame_classifications: Iterable[dict[str, Any]],
) -> dict[tuple[str, str], int]:
    """(rule, drop reason) -> frame count, for reads a guard discarded.

    Nothing this rescue discards is allowed to vanish silently: the report
    prints this table so the size and shape of every suppressed class is
    visible at the approval gate.
    """
    tally: dict[tuple[str, str], int] = {}
    for fc in frame_classifications:
        verdict = classify_anchor(fc.get("anchor_text") or "")
        if verdict is not None and verdict.decision == DECISION_DROP:
            key = (verdict.rule, verdict.reason or "")
            tally[key] = tally.get(key, 0) + 1
    return tally


# ─── Reels ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Reel:
    reel_index: int
    start_s: float
    end_s: float


def load_reels(doc: dict[str, Any]) -> list[Reel]:
    """Parse an on-disk ``reels.json`` into time-ordered reels.

    The on-disk file is authoritative here, not a recomputation: the DB's
    ``ocr_match_associations.reel_identity`` values were stamped as
    ``'<sha>:<reel_index>'`` against exactly these indices.
    """
    return sorted(
        (
            Reel(int(r["reel_index"]), float(r["start_s"]), float(r["end_s"]))
            for r in (doc.get("reels") or [])
        ),
        key=lambda r: r.start_s,
    )


def resolve_reel(
    reels: Sequence[Reel], seconds: float, lookback_s: float = REEL_LOOKBACK_S
) -> tuple[Reel | None, str]:
    """Containment first; else the reel that ended at most ``lookback_s`` before."""
    for reel in reels:
        if reel.start_s <= seconds <= reel.end_s:
            return reel, REEL_CONTAINED
    prior = [r for r in reels if r.end_s <= seconds and seconds - r.end_s <= lookback_s]
    if prior:
        return max(prior, key=lambda r: r.end_s), REEL_LOOKBACK
    return None, REEL_UNRESOLVED


def clamp_bounds(
    reels: Sequence[Reel], reel: Reel | None, reel_mode: str, video_end_s: float
) -> tuple[float, float]:
    """The interval a window resolved to ``reel`` is allowed to occupy."""
    if reel is None:
        return 0.0, video_end_s
    if reel_mode == REEL_CONTAINED:
        return reel.start_s, reel.end_s
    # Lookback: the frame lives in the gap *after* the reel, so clamping to the
    # reel's own bounds would collapse the window to zero length. Clamp into
    # the gap instead — up to the next reel's start.
    later = [r.start_s for r in reels if r.start_s > reel.end_s]
    return reel.end_s, (min(later) if later else video_end_s)


def count_intersecting_reels(reels: Sequence[Reel], t0: float, t1: float) -> int:
    return sum(1 for r in reels if r.start_s <= t1 and r.end_s >= t0)


# ─── Windows ─────────────────────────────────────────────────────────────────


@dataclass
class ResolvedCandidate:
    """A candidate frame with its reel/match/run resolution and final decision."""

    frame: CandidateFrame
    reel: Reel | None
    reel_mode: str
    match_id: int | None
    run_id: int | None
    decision: str
    reason: str | None


@dataclass
class Window:
    """One re-extract window. Field names are the manifest's JSON keys."""

    video_sha256: str
    video_path: str
    video_path_exists: bool
    segment_index: int
    target_screen: str | None
    t0: float
    t1: float
    reel_index: int | None
    reel_mode: str
    match_id: int | None
    run_id: int | None
    decision: str
    reason: str | None
    frame_count: int
    evidence: list[dict[str, Any]] = field(default_factory=list)
    commands: dict[str, Any] | None = None


def _group_key(rc: ResolvedCandidate) -> tuple:
    # The full tuple from the plan, plus decision/reason so an auto frame and a
    # review frame never merge into one window.
    return (
        rc.frame.target_screen,
        rc.reel.reel_index if rc.reel else None,
        rc.match_id,
        rc.run_id,
        rc.decision,
        rc.reason,
    )


def build_windows(
    *,
    video_sha256: str,
    video_path: str,
    video_path_exists: bool,
    resolved: Sequence[ResolvedCandidate],
    reels: Sequence[Reel],
    video_end_s: float,
) -> list[Window]:
    """Group, pad and clamp candidates into re-extract windows.

    Order matters and is the corrected one from the plan: reel-scoped grouping
    happens *before* padding, so two same-screen frames on opposite sides of a
    reel boundary land in different windows by construction rather than being
    merged and then split.
    """
    runs: dict[tuple, list[list[ResolvedCandidate]]] = {}
    for rc in sorted(resolved, key=lambda r: r.frame.seconds):
        buckets = runs.setdefault(_group_key(rc), [])
        if buckets and rc.frame.seconds - buckets[-1][-1].frame.seconds <= GROUP_MAX_GAP_S:
            buckets[-1].append(rc)
        else:
            buckets.append([rc])

    windows: list[Window] = []
    for run in (r for buckets in runs.values() for r in buckets):
        head = run[0]
        lo, hi = clamp_bounds(reels, head.reel, head.reel_mode, video_end_s)
        lo, hi = max(0.0, lo), min(video_end_s, hi)
        t0 = min(max(run[0].frame.seconds - WINDOW_PAD_S, lo), hi)
        t1 = max(min(run[-1].frame.seconds + WINDOW_PAD_S, hi), lo)

        decision, reason = head.decision, head.reason
        if count_intersecting_reels(reels, t0, t1) > 1:
            decision, reason = DECISION_REVIEW, R_SPANS_MULTIPLE_REELS

        windows.append(
            Window(
                video_sha256=video_sha256,
                video_path=video_path,
                video_path_exists=video_path_exists,
                segment_index=-1,  # assigned by assign_segment_indices
                target_screen=head.frame.target_screen,
                t0=round(t0, 3),
                t1=round(t1, 3),
                reel_index=head.reel.reel_index if head.reel else None,
                reel_mode=head.reel_mode,
                match_id=head.match_id,
                run_id=head.run_id,
                decision=decision,
                reason=reason,
                frame_count=len(run),
                evidence=[
                    {
                        "t": round(rc.frame.seconds, 3),
                        "anchor_text": rc.frame.anchor_text,
                        "assigned_screen_type": rc.frame.assigned_screen_type,
                        "rule": rc.frame.rule,
                    }
                    for rc in run
                ],
            )
        )

    return assign_segment_indices(windows)


def assign_segment_indices(windows: list[Window]) -> list[Window]:
    """Number windows 9000+ in time order within the sha."""
    ordered = sorted(windows, key=lambda w: (w.t0, w.t1, w.target_screen or ""))
    for offset, win in enumerate(ordered):
        win.segment_index = SEGMENT_INDEX_BASE + offset
    return ordered


# ─── Command fingerprints ────────────────────────────────────────────────────


def rescue_batch_dir(cache_root: str, window: Window) -> str:
    return (
        f"{cache_root.rstrip('/')}/{window.video_sha256}/rescue/"
        f"seg-{window.segment_index:03d}-{window.target_screen}"
    )


#: ffmpeg writes HERE, never straight into the batch dir. It is a subdirectory
#: rather than a sibling so one path still identifies the whole window, and it is
#: dot-prefixed and a DIRECTORY so the OCR CLI cannot see it: `game_ocr.cli`
#: enumerates a batch with `input.iterdir()` filtered on `p.is_file()`, which a
#: directory never satisfies at any name.
#:
#: The reason for staging at all is that a count of PNGs in the batch dir cannot
#: tell an output of THIS ffmpeg invocation from an output of a previous one. A
#: directory that already held a complete stale set would keep its count when the
#: current command wrote nothing, and the gate would pass frames the current
#: command never produced. Writing into a directory that was verified EMPTY
#: immediately beforehand makes every file found afterwards provably this
#: invocation's — see `video_ingest.rescue_execute.execute_plan`.
STAGING_DIRNAME = ".staging"


def rescue_staging_dir(batch_dir: str) -> str:
    return f"{batch_dir.rstrip('/')}/{STAGING_DIRNAME}"


def rescue_output_pattern(batch_dir: str) -> str:
    """The ffmpeg output pattern for a window — inside the staging directory."""
    return f"{rescue_staging_dir(batch_dir)}/%05d.png"


def expected_output_names(frame_count: int) -> tuple[str, ...]:
    """Exactly the filenames ``%05d.png`` produces for ``frame_count`` frames.

    ffmpeg's image2 muxer numbers from 1 and never skips, so the produced set is
    fully determined by the count. Naming it here means the executor compares
    against a SET rather than a total, which is what makes a surplus file and a
    misnamed file failures rather than arithmetic coincidences.
    """
    return tuple(f"{i:05d}.png" for i in range(1, int(frame_count) + 1))


def window_evidence_timestamps(window: Window) -> list[float]:
    """The evidence times this window must be able to capture, in order.

    The single source of truth for what sampling is planned against — the
    generator, the executor's validator and the transform tool all read the
    evidence through here, so none of them can disagree about which timestamps
    a window is obliged to represent.
    """
    return [float(e["t"]) for e in window.evidence]


def build_commands(
    window: Window,
    *,
    cache_root: str,
    game_title_id: int,
    source_grid: SourceGrid,
    probe_frames: FramePtsProbe,
) -> dict[str, Any] | None:
    """The exact ffmpeg + ingest-ocr invocation Stage B will run, verbatim.

    ``None`` when the window has no concrete target screen — there is nothing
    to extract until a human resolves it.

    ``source_grid`` has no default and is not a float or a bare rate. The
    sampling grid is ``origin + n / rate`` with BOTH halves measured from the
    source, so a video whose grid could not be probed — an unknown rate, a
    variable rate, or leading frames that do not sit on one grid — raises
    :class:`~video_ingest.rescue_sampling.UnsupportedFrameRate` here rather than
    being pinned against a guessed grid.

    ``probe_frames`` is likewise mandatory: a command is only pinned after the
    real source frames behind every selected band have been measured, so it is
    impossible to write a manifest whose commands were never checked against the
    file they will read. It raises
    :class:`~video_ingest.rescue_sampling.SamplingImpossible` when a band is
    empty or ambiguous.
    """
    if not isinstance(source_grid, SourceGrid):
        raise UnsupportedFrameRate(
            "build_commands needs a probed SourceGrid (rate AND measured PTS origin), "
            f"got {source_grid!r} — no default grid is assumed"
        )
    if window.target_screen is None or window.match_id is None:
        return None

    batch_dir = rescue_batch_dir(cache_root, window)
    notes = (
        f"rescue-b2:{window.video_sha256[:12]}:seg{window.segment_index}:"
        f"[{window.t0:.3f}..{window.t1:.3f}]s"
    )
    plan = observe_plan(
        plan_sampling(
            evidence_timestamps=window_evidence_timestamps(window),
            t0=window.t0,
            t1=window.t1,
            grid=source_grid,
        ),
        video_path=window.video_path,
        probe_frames=probe_frames,
    )
    ffmpeg = canonical_ffmpeg_argv(
        video_path=window.video_path,
        output_pattern=rescue_output_pattern(batch_dir),
        plan=plan,
    )
    ingest_ocr = [
        "pnpm", "--filter", "worker", "ingest-ocr", "--",
        "--batch-dir", batch_dir,
        "--screen", window.target_screen,
        "--game-title-id", str(game_title_id),
        "--match-id", str(window.match_id),
        "--capture-kind", "video_frames",
        "--video-sha256", window.video_sha256,
        "--video-segment-index", str(window.segment_index),
        "--video-segment-start-sec", f"{window.t0:.3f}",
        "--video-segment-end-sec", f"{window.t1:.3f}",
        "--ui-version", "nhl26",
        "--decoder-version", RESCUE_DECODER_VERSION,
        "--notes", notes,
    ]
    if window.run_id is not None:
        ingest_ocr += ["--run-id", str(window.run_id)]

    return {
        "batch_dir": batch_dir,
        "notes": notes,
        "sampling": sampling_to_dict(plan),
        "ffmpeg": ffmpeg,
        "ingest_ocr": ingest_ocr,
    }


# ─── The pin-or-ledger policy (shared by the generator and the transform) ────

#: The policy key holding every window whose command was dropped because its
#: source could not be pinned to a grid. Written UNCONDITIONALLY — an empty list
#: when nothing was dropped — so its absence is a malformed manifest rather than
#: an implicit "none".
UNPINNABLE_LEDGER_KEY = "sampling_unpinnable"


class AutoWindowUnpinnable(UnsupportedFrameRate):
    """An executable window's source admits no grid. Refuses the whole operation.

    A subclass of :class:`~video_ingest.rescue_sampling.UnsupportedFrameRate`
    so existing ``except UnsupportedFrameRate`` handlers at the CLI edges keep
    catching it, but nameable on its own where the asymmetry is the point.
    """


def unpinnable_entry(
    *,
    video_sha256: Any,
    segment_index: Any,
    video_path: str,
    decision: Any,
    reason: Any,
    detail: str,
) -> dict[str, Any]:
    """One row of the unpinnable ledger. One shape, one writer."""
    return {
        "video_sha256": video_sha256,
        "segment_index": segment_index,
        "video_path": video_path,
        "decision": decision,
        "reason": reason,
        "detail": detail,
    }


def pin_or_drop(
    *,
    build: Callable[[], dict[str, Any] | None],
    decision: Any,
    video_sha256: Any,
    segment_index: Any,
    video_path: str,
    reason: Any,
    where: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Pin a window's commands, or record why they had to be dropped.

    Returns ``(commands, ledger_entry)``; at most one of them is non-``None``.

    **The asymmetry, in one place.** It lives here rather than in the generator
    and again in the transform because those two produced DIFFERENT behaviour
    the last time it was written twice: the transform enumerated a non-auto
    window it could not pin and carried on, while the generator aborted the whole
    corpus on the same video. Both now call this.

    * An **auto** window is executable and may already have been executed, so a
      command it cannot be pinned to is a hard stop: dropping it would silently
      un-execute approved work, and keeping a superseded command would leave an
      unexecutable argv in a file whose whole claim is that none remain.
    * A **review** or **skip** window is not executable by construction
      (``executable_windows`` takes only ``auto``). Refusing an entire
      regeneration or repair over one is disproportionate; keeping a command
      built on a grid that was never verified is not acceptable either. So the
      command is dropped and the drop is ENUMERATED — which is what lets
      ``semantic_diff`` license it. An unenumerated disappearance stays a
      violation.
    """
    try:
        return build(), None
    except (UnsupportedFrameRate, SamplingImpossible) as exc:
        detail = str(exc)

    if decision == DECISION_AUTO:
        raise AutoWindowUnpinnable(
            f"auto window {where} cannot be pinned to a source grid: {detail}\n"
            f"  {video_path}\n"
            "  Refusing — an auto window must carry an executable command or the "
            "manifest must not claim it."
        )
    return None, unpinnable_entry(
        video_sha256=video_sha256,
        segment_index=segment_index,
        video_path=video_path,
        decision=decision,
        reason=reason,
        detail=detail,
    )


# ─── Manifest ────────────────────────────────────────────────────────────────


def sampling_policy(
    *,
    source_grids: dict[str, str],
    source_pts_origins: dict[str, float],
    unpinnable: Sequence[dict[str, Any]] = (),
) -> dict[str, Any]:
    """The schema-3 policy block describing how every command was sampled.

    ``sampling_mode`` is the executor's gate: a manifest that declares schema 3
    without it is not one this contract produced. The rest is provenance a
    reader needs and the executor does not — each window's own command already
    pins the grid it was planned against, and that is what
    :func:`~video_ingest.rescue_sampling.sampling_problems` recomputes from.

    ``source_grids`` maps ``video_sha256`` to the probed rate and
    ``source_pts_origins`` to the probed PTS origin, so the approval gate can see
    at a glance which grid each video was planned on — and, in particular, which
    videos do NOT start at zero — rather than having to unpick 300 command
    objects.
    """
    return {
        "sampling_mode": SAMPLING_MODE,
        "selection_neighbour_offsets": list(NEIGHBOUR_OFFSETS),
        "selection_tolerance_frame_fraction": [
            TOLERANCE_FRAME_FRACTION.numerator,
            TOLERANCE_FRAME_FRACTION.denominator,
        ],
        "source_frame_rates": dict(sorted(source_grids.items())),
        "source_pts_origins": dict(sorted(source_pts_origins.items())),
        UNPINNABLE_LEDGER_KEY: [dict(u) for u in unpinnable],
    }


def manifest_to_dict(
    windows: Sequence[Window],
    *,
    policy: dict[str, Any],
    unrecoverable: Sequence[dict[str, Any]],
    generated_at: str,
    cache_root: str,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "cache_root": cache_root,
        "policy": policy,
        "windows": [asdict(w) for w in windows],
        "unrecoverable": [dict(u) for u in unrecoverable],
    }


def parse_windows(doc: dict[str, Any]) -> list[Window]:
    """Rebuild Window objects from a manifest dict (round-trip inverse)."""
    return [Window(**w) for w in doc.get("windows") or []]


def validate_manifest(doc: dict[str, Any]) -> list[str]:
    """Structural problems that must be zero before Stage B consumes this."""
    problems: list[str] = []
    if doc.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"schema_version != {SCHEMA_VERSION}")

    seen: set[tuple[str, int]] = set()
    for i, raw in enumerate(doc.get("windows") or []):
        try:
            win = Window(**raw)
        except TypeError as exc:
            problems.append(f"window[{i}]: not parseable ({exc})")
            continue
        where = f"window[{i}] {win.video_sha256[:12]}/seg{win.segment_index}"
        if win.t1 <= win.t0:
            problems.append(f"{where}: empty interval {win.t0}..{win.t1}")
        if win.segment_index < SEGMENT_INDEX_BASE:
            problems.append(f"{where}: segment_index below {SEGMENT_INDEX_BASE}")
        key = (win.video_sha256, win.segment_index)
        if key in seen:
            problems.append(f"{where}: duplicate (sha, segment_index)")
        seen.add(key)
        if win.decision not in (DECISION_AUTO, DECISION_REVIEW, DECISION_SKIP):
            problems.append(f"{where}: unknown decision {win.decision!r}")
        if win.decision == DECISION_AUTO:
            if win.target_screen not in AUTO_ELIGIBLE_SCREENS:
                problems.append(f"{where}: auto on non-eligible {win.target_screen!r}")
            if win.match_id is None:
                problems.append(f"{where}: auto without a resolved match")
            if not win.video_path_exists:
                problems.append(f"{where}: auto on a missing video path")
            if win.commands is None:
                problems.append(f"{where}: auto without commands")
        if win.decision != DECISION_AUTO and win.reason is None:
            problems.append(f"{where}: {win.decision} without a reason")
        if not win.evidence:
            problems.append(f"{where}: no evidence frames")
    return problems
