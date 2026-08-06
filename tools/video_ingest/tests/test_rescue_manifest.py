"""Stage-A / Phase-1 rescue manifest decision logic.

Covers the anchor rules, candidate selection, reel resolution and the
grouping/padding/clamping order -- including the plan's mandated case: two
same-screen candidate frames within the 2 s grouping gap but on opposite sides
of a reel boundary must produce TWO windows, each clamped to its own reel.
"""

from __future__ import annotations

import json

import pytest

from video_ingest.rescue_manifest import (
    AUTO_ELIGIBLE_SCREENS,
    CLASS_DECIDED_NO_ACTION,
    CLASS_EXPECTED_AMBIGUITY,
    CLASS_NOT_INGESTED,
    CLASS_OTHER,
    CLASS_UNCONFIRMED_LOOKBACK,
    CLASS_UNRESOLVED_IDENTITY,
    CONFIRMED_LOOKBACK_FRAMES,
    DECISION_AUTO,
    DECISION_DROP,
    DECISION_REVIEW,
    DECISION_SKIP,
    DROP_NO_BUMPER,
    DROP_SORT_SELECTOR,
    DUPLICATE_RECORDINGS,
    MATCHES_NEVER_INGESTED,
    PRE_DECLARED_REVIEW_REASONS,
    REASON_CLASSES,
    REEL_CONTAINED,
    REEL_LOOKBACK,
    REEL_UNRESOLVED,
    RESCUE_DECODER_VERSION,
    SCHEMA_VERSION,
    R_ALREADY_COVERED,
    R_DUPLICATE_SUPERSEDED,
    R_DUPLICATE_UNCOVERED,
    R_LOOKBACK,
    R_NEVER_INGESTED,
    R_NO_CONFIRMED_MATCH,
    R_SUMMARY_CATEGORY,
    SEGMENT_INDEX_BASE,
    UNKNOWN_STATE,
    CandidateFrame,
    Reel,
    ResolvedCandidate,
    build_commands,
    build_windows,
    classify_anchor,
    clamp_bounds,
    duplicate_verdict,
    is_confirmed_lookback,
    load_reels,
    manifest_to_dict,
    normalize_anchor,
    AutoWindowUnpinnable,
    expected_output_names,
    parse_windows,
    pin_or_drop,
    reason_class,
    rescue_output_pattern,
    rescue_staging_dir,
    resolve_reel,
    select_candidates,
    tally_dropped_anchors,
    validate_manifest,
)
from video_ingest.rescue_sampling import (
    SAMPLING_MODE,
    SamplingImpossible,
    SourceFrameRate,
    UnsupportedFrameRate,
    canonical_ffmpeg_argv,
    sampling_from_dict,
)

from rescue_sampling_helpers import GRID60, GRID60_OFFSET, IDEAL_PROBE, ideal_probe


# ─── Anchor classification ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "anchor,state",
    [
        # The real corpus reads, verbatim from cached segments.json files.
        ("lt goalsummary", "post_game_box_score_goals"),
        ("lt goal summary", "post_game_box_score_goals"),
        ("lt faceoffsummary", "post_game_box_score_faceoffs"),
        ("rm 10 .1 mer lt allevents rt 1st period", "post_game_action_tracker"),
        ("rm 10 - mer faceoff rt 1st period", "post_game_faceoff_map"),
        ("LT SHOT SUMMARY", "post_game_box_score_shots"),
        ("lt net chart", "post_game_net_chart"),
        ("rm 10 mer lt all rt 2nd period", "post_game_events"),
    ],
)
def test_auto_anchors_map_to_their_screen(anchor, state):
    verdict = classify_anchor(anchor)
    assert verdict is not None
    assert verdict.target_screen == state
    assert verdict.decision == DECISION_AUTO


def test_faceoff_summary_beats_bare_faceoff():
    """First match wins, so the more specific rule must be ordered first."""
    assert classify_anchor("faceoffsummary").target_screen == "post_game_box_score_faceoffs"
    assert classify_anchor("lt faceoff rt").target_screen == "post_game_faceoff_map"


def test_all_events_beats_bare_all():
    """`\\ball\\b` must not fire inside "allevents"."""
    assert classify_anchor("allevents").target_screen == "post_game_action_tracker"


def test_all_events_tolerates_a_dropped_plural():
    """Real read: 'rm .3 nn lt all event rt 2nd period' is the action tracker.

    Without the optional plural it falls through to the bare-`all` rule and is
    mislabelled as the scoring-summary events screen.
    """
    verdict = classify_anchor("rm .3 nn lt all event rt 2nd period")
    assert verdict.target_screen == "post_game_action_tracker"
    assert verdict.decision == DECISION_AUTO


# ─── Weak-rule corroboration guard ──────────────────────────────────────────


@pytest.mark.parametrize(
    "anchor,rule",
    [
        # Rink-board advertising and console overlays caught by bare `all`.
        ("vaughn vaughn all ccm out.", "all_filter"),
        ("chats 28,563 silkyjoker85 6:23 pm pal mark all as read view", "all_filter"),
        ("waiting for all users to resume", "all_filter"),
        ("bm 11 20:00 sog sports lap 13 3rd al all", "all_filter"),
        # The in-game "LOST FACEOFF" banner caught by bare `faceoff`.
        ("wet 8 5:37 jalapeno sog sports 8 3rd davis bm 18 lost faceoff", "faceoff_map"),
    ],
)
def test_weak_rules_without_a_bumper_are_dropped(anchor, rule):
    verdict = classify_anchor(anchor)
    assert verdict.decision == DECISION_DROP
    assert verdict.rule == rule
    assert verdict.reason == DROP_NO_BUMPER


@pytest.mark.parametrize(
    "anchor",
    [
        "clubseasonsprogression player rank playerprogression clubprogression playersummary endofgame",
        "clubseasonsprogression playerrank playerprogression clubprogression playersummary endofgame",
        "club finals player rank playerprogression clubprogression playersummary end ofgame",
        "za sports clubseasonsprogression player rank playerprogression clubprogression playersummary",
    ],
)
def test_progression_menu_is_dropped_and_named_as_a_menu(anchor):
    """The corpus's single largest confounder: 1959 frames of nav bar.

    It carries BOTH strings the plan flagged as ambiguous -- PLAYER SUMMARY and
    END OF GAME -- so it must be attributed to the menu rather than filed under
    either tab. These are the reason there is not one genuine player-summary
    tab read anywhere in the 175 499 cached frames.
    """
    verdict = classify_anchor(anchor)
    assert verdict.decision == DECISION_DROP
    assert verdict.rule == "progression_menu"
    assert verdict.target_screen is None


def test_all_skaters_sort_selector_is_dropped_despite_its_bumper():
    """'LT ALL SKATERS <COLUMN>' is the box-score sort selector, not a tab."""
    for anchor in ("lt allskaters faceoff%", "lt allskaters faceoffstaken",
                   "lt all skaters minutes"):
        verdict = classify_anchor(anchor)
        assert verdict.decision == DECISION_DROP
        assert verdict.reason == DROP_SORT_SELECTOR


def test_distinctive_rules_do_not_need_a_bumper():
    """9 of 169 real goal-summary reads lost the bumper to OCR -- keep them."""
    for anchor, state in [
        ("goalsummary", "post_game_box_score_goals"),
        ("goal summary 1st 2nn 3rn sn tot", "post_game_box_score_goals"),
        ("faceoff summary 1st 2no 3rd ot so tot", "post_game_box_score_faceoffs"),
        ("snr rm all events rt 2nd period 2.11 t", "post_game_action_tracker"),
    ]:
        verdict = classify_anchor(anchor)
        assert verdict.decision == DECISION_AUTO, anchor
        assert verdict.target_screen == state


def test_dropped_anchors_are_tallied_not_silent():
    frames = [
        _frame(1.0, "vaughn all ccm out.", UNKNOWN_STATE),
        _frame(2.0, "all ccm out.", UNKNOWN_STATE),
        _frame(3.0, "lt allskaters faceoff%", UNKNOWN_STATE),
        _frame(4.0, "lt end of game", UNKNOWN_STATE),
        _frame(5.0, "lt goalsummary", UNKNOWN_STATE),
    ]
    assert tally_dropped_anchors(frames) == {
        ("all_filter", DROP_NO_BUMPER): 2,
        ("faceoff_map", DROP_SORT_SELECTOR): 1,
        ("end_of_game", "screen_has_no_state"): 1,
    }
    assert len(select_candidates(frames)) == 1


@pytest.mark.parametrize(
    "anchor,reason",
    [
        ("lt summarycategory", "summary_category_dropdown_occludes_tab"),
        ("lt select category", "summary_category_dropdown_occludes_tab"),
        ("lt player summary", "player_summary_anchor_shared_with_end_of_game"),
    ],
)
def test_ambiguous_anchors_are_review_only(anchor, reason):
    verdict = classify_anchor(anchor)
    assert verdict.decision == DECISION_REVIEW
    assert verdict.reason == reason


def test_end_of_game_alone_is_not_a_candidate():
    """The END OF GAME team-stats tab has no state -- nothing to rescue."""
    verdict = classify_anchor("lt end of game")
    assert verdict.decision == DECISION_DROP
    assert verdict.target_screen is None
    assert select_candidates([_frame(10.0, "lt end of game", UNKNOWN_STATE)]) == []


def test_mixed_anchor_is_downgraded_to_review():
    """A mid-transition frame showing two tab labels proves neither."""
    verdict = classify_anchor("lt goalsummary rt end of game")
    assert verdict.decision == DECISION_REVIEW
    assert verdict.reason == "ambiguous_mixed_anchor"
    assert verdict.target_screen == "post_game_box_score_goals"


def test_normalize_collapses_whitespace_and_case():
    assert normalize_anchor("  LT   GOAL\tSUMMARY ") == "lt goal summary"


def test_unmatched_anchor_is_not_a_candidate():
    assert classify_anchor("clubseasonsprogression playerrank") is None
    assert classify_anchor("") is None


# ─── Candidate selection ────────────────────────────────────────────────────


def _frame(seconds, anchor, screen_type):
    return {
        "source_time_seconds": seconds,
        "anchor_text": anchor,
        "screen_type": screen_type,
    }


def test_agreement_is_not_a_candidate():
    frames = [_frame(10.0, "lt goal summary", "post_game_box_score_goals")]
    assert select_candidates(frames) == []


def test_unknown_labelled_frame_is_a_candidate():
    """The dropped-frame shape: OCR read it, the segmenter lost it."""
    frames = [_frame(1657.0, "lt goalsummary", UNKNOWN_STATE)]
    (cand,) = select_candidates(frames)
    assert cand.target_screen == "post_game_box_score_goals"
    assert cand.decision == DECISION_AUTO
    assert cand.rule == "goal_summary"


def test_absorbed_frame_is_a_candidate():
    """The absorbed shape: swallowed by a neighbouring post-game segment."""
    frames = [_frame(1200.0, "lt shot summary", "post_game_box_score_goals")]
    (cand,) = select_candidates(frames)
    assert cand.target_screen == "post_game_box_score_shots"


def test_ambiguous_anchor_inside_a_real_segment_is_dropped():
    """An ambiguous read cannot prove a concrete assignment wrong.

    Real corpus case: 'rm 10:1 mer selectcategory rt 1st perioo' assigned
    post_game_net_chart. That is a dropdown over a net-chart screen, not a
    coverage gap -- filing it as review would be pure noise.
    """
    frames = [_frame(900.0, "rm 10:1 mer selectcategory rt 1st perioo", "post_game_net_chart")]
    assert select_candidates(frames) == []


def test_ambiguous_anchor_in_unknown_is_kept_for_review():
    frames = [_frame(900.0, "lt summarycategory", UNKNOWN_STATE)]
    (cand,) = select_candidates(frames)
    assert cand.decision == DECISION_REVIEW
    assert cand.target_screen is None


def test_candidates_come_back_time_ordered():
    frames = [
        _frame(30.0, "lt goalsummary", UNKNOWN_STATE),
        _frame(10.0, "lt netchart", UNKNOWN_STATE),
    ]
    assert [c.seconds for c in select_candidates(frames)] == [10.0, 30.0]


def test_frame_without_a_timestamp_is_skipped():
    assert select_candidates([{"anchor_text": "lt goalsummary", "screen_type": UNKNOWN_STATE}]) == []


# ─── Reel resolution ────────────────────────────────────────────────────────


REELS = [Reel(0, 0.0, 1547.0), Reel(1, 1568.0, 1622.0)]


def test_load_reels_orders_by_start():
    doc = {
        "reels": [
            {"reel_index": 1, "start_s": 1568.0, "end_s": 1622.0},
            {"reel_index": 0, "start_s": 0.0, "end_s": 1547.0},
        ]
    }
    assert [r.reel_index for r in load_reels(doc)] == [0, 1]


def test_containment_wins():
    reel, mode = resolve_reel(REELS, 1500.0)
    assert (reel.reel_index, mode) == (0, REEL_CONTAINED)


def test_out_of_reel_frame_attaches_by_lookback():
    reel, mode = resolve_reel(REELS, 1560.0)
    assert (reel.reel_index, mode) == (0, REEL_LOOKBACK)


def test_out_of_reel_frame_beyond_lookback_is_unresolved():
    reel, mode = resolve_reel(REELS, 1622.0 + 500.0)
    assert (reel, mode) == (None, REEL_UNRESOLVED)


def test_lookback_clamp_targets_the_gap_not_the_reel():
    """Clamping a lookback frame to its reel's own bounds would collapse it."""
    assert clamp_bounds(REELS, REELS[0], REEL_LOOKBACK, 2000.0) == (1547.0, 1568.0)
    assert clamp_bounds(REELS, REELS[0], REEL_CONTAINED, 2000.0) == (0.0, 1547.0)


# ─── Window construction ────────────────────────────────────────────────────


def _resolved(seconds, *, screen="post_game_box_score_goals", reel, match_id, run_id=77,
              mode=REEL_CONTAINED, decision=DECISION_AUTO, reason=None):
    return ResolvedCandidate(
        frame=CandidateFrame(
            seconds=seconds,
            anchor_text="lt goalsummary",
            assigned_screen_type=UNKNOWN_STATE,
            target_screen=screen,
            decision=DECISION_AUTO,
            rule="goal_summary",
            reason=None,
        ),
        reel=reel,
        reel_mode=mode,
        match_id=match_id,
        run_id=run_id,
        decision=decision,
        reason=reason,
    )


def _build(resolved, reels=REELS, video_end_s=2000.0):
    return build_windows(
        video_sha256="a" * 64,
        video_path="/mnt/k/x.mkv",
        video_path_exists=True,
        resolved=resolved,
        reels=reels,
        video_end_s=video_end_s,
    )


def test_reel_boundary_splits_windows_and_clamps_each_to_its_own_reel():
    """The plan's mandated case.

    Two same-screen frames 1.0 s apart -- comfortably inside the 2 s grouping
    gap -- but on opposite sides of a tight reel boundary. Everything else in
    the group key is held identical (same screen, same match, same run) so the
    ONLY thing that can split them is reel_index. Grouping is reel-scoped
    BEFORE padding, so they must never merge into one straddling window, and
    the ±0.75 s pad must not leak either window past the boundary.
    """
    reels = [Reel(0, 0.0, 1000.0), Reel(1, 1001.0, 2000.0)]
    resolved = [
        _resolved(1000.0, reel=reels[0], match_id=101, run_id=201),
        _resolved(1001.0, reel=reels[1], match_id=101, run_id=201),
    ]
    windows = _build(resolved, reels=reels)

    assert len(windows) == 2
    first, second = windows
    assert (first.reel_index, second.reel_index) == (0, 1)
    # Each clamped to its own reel -- neither leaks past the boundary, even
    # though the raw padded intervals (999.25..1000.75 and 1000.25..1001.75)
    # overlap it.
    assert (first.t0, first.t1) == (pytest.approx(999.25), pytest.approx(1000.0))
    assert (second.t0, second.t1) == (pytest.approx(1001.0), pytest.approx(1001.75))
    assert first.t1 <= second.t0
    assert all(w.decision == DECISION_AUTO for w in windows)
    assert all(w.frame_count == 1 for w in windows)


def test_adjacent_frames_in_one_reel_merge_into_one_window():
    resolved = [
        _resolved(1000.0, reel=REELS[0], match_id=101),
        _resolved(1002.0, reel=REELS[0], match_id=101),
    ]
    (win,) = _build(resolved)
    assert win.frame_count == 2
    assert (win.t0, win.t1) == (pytest.approx(999.25), pytest.approx(1002.75))


def test_gap_over_the_threshold_splits():
    resolved = [
        _resolved(1000.0, reel=REELS[0], match_id=101),
        _resolved(1002.5, reel=REELS[0], match_id=101),
    ]
    assert len(_build(resolved)) == 2


def test_different_screens_never_merge():
    resolved = [
        _resolved(1000.0, screen="post_game_box_score_goals", reel=REELS[0], match_id=101),
        _resolved(1001.0, screen="post_game_box_score_shots", reel=REELS[0], match_id=101),
    ]
    assert len(_build(resolved)) == 2


def test_auto_and_review_frames_never_share_a_window():
    resolved = [
        _resolved(1000.0, reel=REELS[0], match_id=101),
        _resolved(1001.0, reel=REELS[0], match_id=101, decision=DECISION_REVIEW, reason="x"),
    ]
    windows = _build(resolved)
    assert {w.decision for w in windows} == {DECISION_AUTO, DECISION_REVIEW}


def test_window_is_clamped_to_video_bounds():
    reels = [Reel(0, 0.0, 100.0)]
    (win,) = _build([_resolved(0.1, reel=reels[0], match_id=101)], reels=reels, video_end_s=100.0)
    assert win.t0 == pytest.approx(0.0)


def test_unresolved_frames_spanning_reels_are_flagged():
    """No reel to clamp to, so the padded window can straddle -- reject it."""
    reels = [Reel(0, 0.0, 10.0), Reel(1, 10.5, 20.0)]
    resolved = [
        _resolved(10.2, reel=None, match_id=None, run_id=None, mode=REEL_UNRESOLVED,
                  decision=DECISION_REVIEW, reason="frame_outside_every_reel")
    ]
    (win,) = _build(resolved, reels=reels, video_end_s=20.0)
    assert win.decision == DECISION_REVIEW
    assert win.reason == "window_spans_multiple_reels"


def test_segment_indices_are_9000_plus_in_time_order():
    resolved = [
        _resolved(1200.0, reel=REELS[0], match_id=101),
        _resolved(1000.0, reel=REELS[0], match_id=101),
        _resolved(1100.0, reel=REELS[0], match_id=101),
    ]
    windows = _build(resolved)
    assert [w.segment_index for w in windows] == [
        SEGMENT_INDEX_BASE,
        SEGMENT_INDEX_BASE + 1,
        SEGMENT_INDEX_BASE + 2,
    ]
    assert [w.t0 for w in windows] == sorted(w.t0 for w in windows)


# ─── Commands ───────────────────────────────────────────────────────────────


def test_commands_carry_the_rescue_fingerprint():
    (win,) = _build([_resolved(1000.0, reel=REELS[0], match_id=101, run_id=77)])
    cmd = build_commands(
        win, cache_root="/home/michal/ingest-cache", game_title_id=1, source_grid=GRID60, probe_frames=IDEAL_PROBE
    )

    assert cmd["batch_dir"].endswith("/rescue/seg-9000-post_game_box_score_goals")
    assert "/rescue/" in cmd["batch_dir"]
    assert cmd["notes"] == "rescue-b2:aaaaaaaaaaaa:seg9000:[999.250..1000.750]s"
    assert cmd["ffmpeg"][:4] == ["ffmpeg", "-v", "error", "-y"]
    # ffmpeg writes into staging, INSIDE the batch dir but never the batch dir
    # itself — that is what lets Stage B prove which files one invocation made.
    assert cmd["ffmpeg"][-1] == f"{cmd['batch_dir']}/.staging/%05d.png"
    # …while ingest-ocr still reads the batch dir, which is half the promotion key.
    ingest_batch = cmd["ingest_ocr"][cmd["ingest_ocr"].index("--batch-dir") + 1]
    assert ingest_batch == cmd["batch_dir"]

    ingest = cmd["ingest_ocr"]
    assert ingest[:6] == ["pnpm", "--filter", "worker", "ingest-ocr", "--", "--batch-dir"]
    for flag, value in [
        ("--screen", "post_game_box_score_goals"),
        ("--match-id", "101"),
        ("--run-id", "77"),
        ("--decoder-version", RESCUE_DECODER_VERSION),
        ("--video-segment-index", "9000"),
        ("--capture-kind", "video_frames"),
    ]:
        assert ingest[ingest.index(flag) + 1] == value


def test_no_commands_without_a_resolved_match():
    (win,) = _build(
        [_resolved(1000.0, reel=REELS[0], match_id=None, run_id=None,
                   decision=DECISION_REVIEW, reason="reel_has_no_confirmed_match")]
    )
    assert build_commands(win, cache_root="/c", game_title_id=1, source_grid=GRID60, probe_frames=IDEAL_PROBE) is None


# ─── Exact-evidence sampling is what the commands pin ───────────────────────


def test_commands_pin_source_pts_selection_and_never_an_fps_filter():
    """The schema-2 defect, closed at the source: no auto command may resample."""
    (win,) = _build([_resolved(1000.0, reel=REELS[0], match_id=101, run_id=77)])
    cmd = build_commands(win, cache_root="/c", game_title_id=1, source_grid=GRID60, probe_frames=IDEAL_PROBE)

    assert "sample_fps" not in cmd
    assert not any(tok.startswith("fps=") for tok in cmd["ffmpeg"])
    assert "-copyts" in cmd["ffmpeg"]
    assert "-frames:v" in cmd["ffmpeg"]
    assert "-t" in cmd["ffmpeg"] and "-to" not in cmd["ffmpeg"]

    sampling = cmd["sampling"]
    assert sampling["mode"] == SAMPLING_MODE
    assert sampling["source_frame_rate"] == "60/1"
    assert sampling["evidence_timestamps"] == [1000.0]
    assert sampling["expected_frame_count"] == 3


def test_commands_are_the_canonical_argv_for_their_own_sampling_metadata():
    (win,) = _build([_resolved(1000.0, reel=REELS[0], match_id=101, run_id=77)])
    cmd = build_commands(win, cache_root="/c", game_title_id=1, source_grid=GRID60, probe_frames=IDEAL_PROBE)
    assert cmd["ffmpeg"] == canonical_ffmpeg_argv(
        video_path=win.video_path,
        output_pattern=rescue_output_pattern(cmd["batch_dir"]),
        plan=sampling_from_dict(cmd["sampling"]),
    )


@pytest.mark.parametrize("rate", [None, "60/1", 60.0, SourceFrameRate(60, 1)])
def test_generator_refuses_anything_that_is_not_a_measured_grid(rate):
    """No default, no guess — and a bare RATE is not a grid.

    ``SourceFrameRate(60, 1)`` is in this list on purpose: it is exactly what the
    previous version accepted, and accepting it is what let a source's PTS origin
    go unmeasured and be assumed to be zero.
    """
    (win,) = _build([_resolved(1000.0, reel=REELS[0], match_id=101, run_id=77)])
    with pytest.raises(UnsupportedFrameRate):
        build_commands(win, cache_root="/c", game_title_id=1, source_grid=rate, probe_frames=IDEAL_PROBE)


def test_commands_pin_the_measured_origin_of_an_offset_source():
    (win,) = _build([_resolved(1000.0, reel=REELS[0], match_id=101, run_id=77)])
    cmd = build_commands(
        win,
        cache_root="/c",
        game_title_id=1,
        source_grid=GRID60_OFFSET,
        probe_frames=ideal_probe(GRID60_OFFSET),
    )
    assert cmd["sampling"]["source_pts_origin_s"] == 5.008
    # The seek is relative to that origin; the bands stay absolute.
    assert cmd["sampling"]["decode_seek_s"] == pytest.approx(
        cmd["sampling"]["decode_start_s"] - 5.008, abs=1e-6
    )


def test_a_command_is_never_pinned_without_measuring_its_own_source():
    """The probe is not optional and its refusal is not swallowed."""
    (win,) = _build([_resolved(1000.0, reel=REELS[0], match_id=101, run_id=77)])
    with pytest.raises(SamplingImpossible):
        build_commands(
            win,
            cache_root="/c",
            game_title_id=1,
            source_grid=GRID60,
            probe_frames=ideal_probe(GRID60_OFFSET),  # the file is NOT on GRID60
        )


# ─── The staged output contract ─────────────────────────────────────────────


def test_the_output_names_are_exactly_what_the_pattern_produces():
    assert expected_output_names(3) == ("00001.png", "00002.png", "00003.png")
    assert expected_output_names(1) == ("00001.png",)
    assert expected_output_names(0) == ()


def test_staging_is_a_subdirectory_of_the_batch_dir():
    """Subdirectory, not sibling: `game_ocr.cli` enumerates a batch with
    `iterdir()` filtered on `is_file()`, so a directory is invisible to it —
    while a sibling *file* tree would not be covered by the batch dir's own
    rollback handle."""
    assert rescue_staging_dir("/c/sha/rescue/seg-9000-x") == "/c/sha/rescue/seg-9000-x/.staging"
    assert rescue_output_pattern("/c/sha/rescue/seg-9000-x").startswith(
        "/c/sha/rescue/seg-9000-x/"
    )


# ─── The pin-or-drop asymmetry (shared with the transform tool) ─────────────


def _pin(decision, build):
    return pin_or_drop(
        build=build,
        decision=decision,
        video_sha256="a" * 64,
        segment_index=9000,
        video_path="/v.mkv",
        reason="summary_category_dropdown_occludes_tab",
        where="aaaaaaaaaaaa/seg9000",
    )


def _unpinnable():
    raise UnsupportedFrameRate("variable frame rate: 60/1 != 839640000/13993843")


def test_an_unpinnable_auto_window_refuses_everything():
    with pytest.raises(AutoWindowUnpinnable) as exc:
        _pin(DECISION_AUTO, _unpinnable)
    assert "aaaaaaaaaaaa/seg9000" in str(exc.value)
    assert "839640000/13993843" in str(exc.value)


@pytest.mark.parametrize("decision", [DECISION_REVIEW, DECISION_SKIP])
def test_an_unpinnable_non_auto_window_is_dropped_and_enumerated(decision):
    """The match-2400 shape: not executable, so one bad source must not cost the
    whole corpus — but the drop is a recorded fact, never a silent absence."""
    commands, entry = _pin(decision, _unpinnable)
    assert commands is None
    assert entry["video_sha256"] == "a" * 64
    assert entry["segment_index"] == 9000
    assert entry["decision"] == decision
    assert entry["reason"] == "summary_category_dropdown_occludes_tab"
    assert "variable frame rate" in entry["detail"]


def test_a_window_whose_own_geometry_is_unsamplable_is_dropped_the_same_way():
    """`SamplingImpossible` is handled identically to `UnsupportedFrameRate`:
    both mean "no executable command exists for this window"."""

    def build():
        raise SamplingImpossible("evidence t=1.0 lies outside its own window")

    commands, entry = _pin(DECISION_SKIP, build)
    assert commands is None and "outside its own window" in entry["detail"]
    with pytest.raises(AutoWindowUnpinnable):
        _pin(DECISION_AUTO, build)


def test_a_pinnable_window_yields_commands_and_no_ledger_entry():
    commands, entry = _pin(DECISION_AUTO, lambda: {"batch_dir": "/b"})
    assert commands == {"batch_dir": "/b"} and entry is None


def test_a_window_with_nothing_to_build_is_not_a_drop():
    """`build_commands` returns None for a window with no target screen. That is
    a decision, not a failure, and must not appear in the unpinnable ledger."""
    commands, entry = _pin(DECISION_REVIEW, lambda: None)
    assert commands is None and entry is None


# ─── Manifest ───────────────────────────────────────────────────────────────


def test_schema_version_is_three():
    """The command object changed shape, so a schema-2 consumer must not read
    a schema-3 manifest as if it understood it."""
    assert SCHEMA_VERSION == 3


def _manifest(windows):
    for win in windows:
        win.commands = build_commands(
            win, cache_root="/c", game_title_id=1, source_grid=GRID60, probe_frames=IDEAL_PROBE
        )
    return manifest_to_dict(
        windows,
        policy={"decoder_version": RESCUE_DECODER_VERSION},
        unrecoverable=[{"match_id": 249, "video_sha256": None, "reason": "no_pass1_cache",
                        "missing_screens": ["post_game_box_score_goals"]}],
        generated_at="2026-08-02T00:00:00+00:00",
        cache_root="/c",
    )


def test_manifest_round_trips():
    doc = _manifest(_build([_resolved(1000.0, reel=REELS[0], match_id=101)]))
    serialized = json.loads(json.dumps(doc))
    reemitted = manifest_to_dict(
        parse_windows(serialized),
        policy=serialized["policy"],
        unrecoverable=serialized["unrecoverable"],
        generated_at=serialized["generated_at"],
        cache_root=serialized["cache_root"],
    )
    assert reemitted == serialized


def test_valid_manifest_has_no_problems():
    assert validate_manifest(_manifest(_build([_resolved(1000.0, reel=REELS[0], match_id=101)]))) == []


def test_validation_rejects_auto_without_a_match():
    doc = _manifest(_build([_resolved(1000.0, reel=REELS[0], match_id=101)]))
    doc["windows"][0]["match_id"] = None
    assert any("auto without a resolved match" in p for p in validate_manifest(doc))


def test_validation_rejects_auto_on_a_review_only_screen():
    doc = _manifest(_build([_resolved(1000.0, reel=REELS[0], match_id=101)]))
    doc["windows"][0]["target_screen"] = "post_game_player_summary"
    assert any("non-eligible" in p for p in validate_manifest(doc))


def test_validation_rejects_empty_intervals_and_duplicates():
    doc = _manifest(
        _build([
            _resolved(1000.0, reel=REELS[0], match_id=101),
            _resolved(1100.0, reel=REELS[0], match_id=101),
        ])
    )
    doc["windows"][0]["t1"] = doc["windows"][0]["t0"]
    doc["windows"][1]["segment_index"] = doc["windows"][0]["segment_index"]
    problems = validate_manifest(doc)
    assert any("empty interval" in p for p in problems)
    assert any("duplicate" in p for p in problems)


def test_player_summary_is_never_auto_eligible():
    assert "post_game_player_summary" not in AUTO_ELIGIBLE_SCREENS
    assert set(AUTO_ELIGIBLE_SCREENS) == {
        "post_game_action_tracker",
        "post_game_box_score_goals",
        "post_game_box_score_shots",
        "post_game_box_score_faceoffs",
        "post_game_net_chart",
        "post_game_faceoff_map",
        "post_game_events",
    }


# ─── Reason classes ─────────────────────────────────────────────────────────


def test_every_reason_class_is_named():
    assert reason_class(R_SUMMARY_CATEGORY) == CLASS_EXPECTED_AMBIGUITY
    assert reason_class(R_NO_CONFIRMED_MATCH) == CLASS_UNRESOLVED_IDENTITY
    assert reason_class(R_DUPLICATE_UNCOVERED) == CLASS_UNRESOLVED_IDENTITY
    assert reason_class(R_LOOKBACK) == CLASS_UNCONFIRMED_LOOKBACK
    assert reason_class(R_NEVER_INGESTED) == CLASS_NOT_INGESTED
    assert reason_class(R_ALREADY_COVERED) == CLASS_DECIDED_NO_ACTION
    assert reason_class(R_DUPLICATE_SUPERSEDED) == CLASS_DECIDED_NO_ACTION


def test_unknown_reason_is_not_silently_classed():
    assert reason_class("something_new") == CLASS_OTHER
    assert reason_class(None) == CLASS_OTHER


def test_expected_ambiguity_reasons_are_exactly_the_pre_declared_ones():
    """The gate's 'expected ambiguity' bucket must not quietly absorb others."""
    ambiguous = {r for r, c in REASON_CLASSES.items() if c == CLASS_EXPECTED_AMBIGUITY}
    assert ambiguous == set(PRE_DECLARED_REVIEW_REASONS)


# ─── Confirmed-lookback ledger ──────────────────────────────────────────────


def test_lookback_ledger_matches_only_the_exact_frame():
    sha, reel, screen, seconds = next(iter(sorted(CONFIRMED_LOOKBACK_FRAMES)))
    assert is_confirmed_lookback(sha, reel, screen, seconds)
    # Any drift in reel, screen or time falls back to review by construction.
    assert not is_confirmed_lookback(sha, reel + 1, screen, seconds)
    assert not is_confirmed_lookback(sha, reel, "post_game_events", seconds + 1000)
    assert not is_confirmed_lookback(sha, reel, screen, seconds + 1.0)
    assert not is_confirmed_lookback("0" * 64, reel, screen, seconds)


def test_lookback_ledger_needs_a_reel_and_a_screen():
    sha, reel, screen, seconds = next(iter(sorted(CONFIRMED_LOOKBACK_FRAMES)))
    assert not is_confirmed_lookback(sha, None, screen, seconds)
    assert not is_confirmed_lookback(sha, reel, None, seconds)


def test_lookback_ledger_only_names_auto_eligible_screens():
    """A confirmed lookback may still only rescue a screen auto may rescue."""
    for _, _, screen, _ in CONFIRMED_LOOKBACK_FRAMES:
        assert screen in AUTO_ELIGIBLE_SCREENS


def test_lookback_ledger_entries_are_well_formed():
    for sha, reel, screen, seconds in CONFIRMED_LOOKBACK_FRAMES:
        assert len(sha) == 64 and sha == sha.lower()
        assert isinstance(reel, int) and reel >= 0
        assert isinstance(seconds, float) and seconds > 0


# ─── Duplicate recordings ───────────────────────────────────────────────────


def test_duplicate_is_skipped_only_when_nothing_is_lost():
    covered = {"post_game_events"}
    recovered = {"post_game_box_score_goals"}
    assert duplicate_verdict("post_game_events", covered, recovered) == (
        DECISION_SKIP,
        R_DUPLICATE_SUPERSEDED,
    )
    assert duplicate_verdict("post_game_box_score_goals", covered, recovered) == (
        DECISION_SKIP,
        R_DUPLICATE_SUPERSEDED,
    )
    # No concrete target: review-only whatever its identity, nothing to lose.
    assert duplicate_verdict(None, covered, recovered) == (
        DECISION_SKIP,
        R_DUPLICATE_SUPERSEDED,
    )


def test_duplicate_that_would_add_a_screen_falls_back_to_review():
    verdict = duplicate_verdict("post_game_box_score_shots", set(), set())
    assert verdict == (DECISION_REVIEW, R_DUPLICATE_UNCOVERED)
    assert reason_class(verdict[1]) == CLASS_UNRESOLVED_IDENTITY


def test_duplicate_ledger_never_points_at_itself():
    for sha, dup in DUPLICATE_RECORDINGS.items():
        assert dup.primary_video_sha256 != sha
        assert len(sha) == 64 and len(dup.primary_video_sha256) == 64
        assert dup.primary_offset_s > 0


def test_ledgers_do_not_overlap():
    """A video is a duplicate, or never ingested, or ordinary -- not two."""
    assert not set(DUPLICATE_RECORDINGS) & set(MATCHES_NEVER_INGESTED)
    ledgered = set(DUPLICATE_RECORDINGS) | set(MATCHES_NEVER_INGESTED)
    assert not {sha for sha, _, _, _ in CONFIRMED_LOOKBACK_FRAMES} & ledgered
