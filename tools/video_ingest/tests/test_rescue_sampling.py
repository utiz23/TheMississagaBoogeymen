"""Exact-evidence sampling — the canonical source-PTS selection algorithm.

The first defect this replaces: every auto window pinned ``-vf fps=1``, which
samples on the OUTPUT timeline and therefore captures whatever frame the seek
happened to land near — not the frame the evidence was read from. In the failed
window (``4b8a77d091a9/seg9002``, evidence ``t=2088.000``) it produced 2087.733
and 2088.733, both transition/dropdown frames, and never the evidence frame.

The second defect, fixed here: the replacement modelled the source grid as
``n / fps`` — an origin of ZERO, assumed rather than measured. Equal
``r_frame_rate`` and ``avg_frame_rate`` prove a constant RATE and say nothing
about the grid's phase. ``test_a_nonzero_origin_source`` builds a real 60 fps
source whose two rates agree and whose frames sit at ``5.008 + n/60``, and runs
real ffmpeg against both models: the origin-zero one selects ZERO frames, the
measured one selects the evidence frame and its true neighbours, verified
byte-for-byte against an independent full decode.

Everything except the ffmpeg-backed section is pure arithmetic over the same
functions the manifest, the validator and the transform tool all use, so a drift
between what is pinned and what is checked is not expressible.
"""

from __future__ import annotations

import math
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

from video_ingest.rescue_sampling import (
    NEIGHBOUR_OFFSETS,
    SAMPLING_MODE,
    SamplingImpossible,
    SamplingPlan,
    SourceFrameRate,
    SourceGrid,
    UnsupportedFrameRate,
    canonical_ffmpeg_argv,
    frame_index,
    frame_rate_from_probe,
    frame_time,
    grid_from_probe,
    memoised_prober,
    observe_plan,
    parse_frame_rate,
    parse_origin,
    plan_sampling,
    probe_frame_pts,
    probe_source_grid,
    sampling_from_dict,
    sampling_problems,
    sampling_to_dict,
    selection_tolerance,
)

FPS60 = SourceFrameRate(60, 1)
GRID60 = SourceGrid(rate=FPS60, origin=Fraction(0))

#: The exact failed window, verbatim from the live manifest.
FAILED_T0 = 2087.250
FAILED_EVIDENCE = 2088.000
FAILED_T1 = 2088.750

#: The two frames the old fps=1 command actually produced. Both are
#: transition/dropdown frames; neither may ever be selected again.
OLD_PINNED_OUTPUT_TIMES = (2087.733, 2088.733)


def ideal_probe(grid: SourceGrid):
    """A frame probe for a source that is EXACTLY on ``grid``, forever.

    The production probe is ffprobe; this is its pure stand-in, so the pure
    tests exercise the same ``observe_plan`` contract the real one feeds. It
    deliberately does not round to milliseconds: quantisation is what the
    tolerance exists for and is exercised against real files below.
    """

    def probe(path: str, start: float, end: float) -> tuple[Fraction, ...]:
        lo = math.ceil((Fraction(str(start)) - grid.origin) / grid.frame_interval)
        hi = math.floor((Fraction(str(end)) - grid.origin) / grid.frame_interval)
        return tuple(grid.pts(i) for i in range(max(0, lo), hi + 1))

    return probe


def _plan(evidence, t0, t1, grid=GRID60) -> SamplingPlan:
    return plan_sampling(evidence_timestamps=evidence, t0=t0, t1=t1, grid=grid)


def _observed(evidence, t0, t1, grid=GRID60) -> SamplingPlan:
    return observe_plan(
        _plan(evidence, t0, t1, grid), video_path="/v.mkv", probe_frames=ideal_probe(grid)
    )


# ─── Frame-rate parsing: unavailable or unsupported must fail closed ─────────


def test_parses_a_rational_frame_rate():
    assert parse_frame_rate("60/1") == SourceFrameRate(60, 1)
    assert parse_frame_rate("30000/1001") == SourceFrameRate(30000, 1001)


@pytest.mark.parametrize(
    "text",
    ["", None, "0/0", "60/0", "0/1", "-60/1", "sixty", "60", "60/1/1", "60.0/1"],
)
def test_rejects_unusable_frame_rate_text(text):
    with pytest.raises(UnsupportedFrameRate):
        parse_frame_rate(text)


def test_probe_accepts_a_constant_frame_rate():
    rate = frame_rate_from_probe(r_frame_rate="60/1", avg_frame_rate="60/1")
    assert rate == FPS60
    assert rate.text == "60/1"


def test_probe_rejects_a_variable_frame_rate():
    """r != avg is VFR: no single grid exists, so neighbours are undefined."""
    with pytest.raises(UnsupportedFrameRate):
        frame_rate_from_probe(r_frame_rate="60/1", avg_frame_rate="59/1")


def test_the_live_match_2400_rates_are_still_rejected():
    """The one video in the corpus that has no grid, with its real numbers.

    ``r_frame_rate`` 60/1 against an ``avg_frame_rate`` of 839640000/13993843
    (59.99997 fps) — a trimmed mp4. It backs five REVIEW windows, which is why
    it must be refusable without refusing the whole corpus (see `pin_or_drop`),
    but refusable it must remain.
    """
    with pytest.raises(UnsupportedFrameRate):
        frame_rate_from_probe(
            r_frame_rate="60/1", avg_frame_rate="839640000/13993843"
        )


def test_probe_rejects_missing_frame_rate():
    with pytest.raises(UnsupportedFrameRate):
        frame_rate_from_probe(r_frame_rate=None, avg_frame_rate=None)


def test_no_universal_60_fps_assumption():
    """A non-60 CFR source plans on ITS OWN grid, not on a hardcoded 60."""
    grid = SourceGrid(rate=SourceFrameRate(30000, 1001), origin=Fraction(0))  # 29.97
    plan = _plan([100.0], 99.25, 100.75, grid)
    assert plan.grid == grid
    assert plan.selected_frame_indices == (2996, 2997, 2998)
    # 2997 / (30000/1001) = 99.999900 s — the nearest source frame to t=100.0,
    # which is NOT on a 60 fps grid.
    assert plan.selected_timestamps[1] == pytest.approx(99.9999, abs=1e-6)


# ─── The grid origin: measured, never assumed ────────────────────────────────


def test_a_grid_is_a_rate_AND_an_origin():
    """The type exists so a bare rate cannot be passed where a grid is needed."""
    grid = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    assert grid.origin_s == 5.008
    assert grid.pts(0) == Fraction("5.008")
    assert grid.pts(60) == Fraction("5.008") + 1


def test_equal_rates_do_not_imply_a_zero_origin():
    """The heart of the defect, stated as arithmetic.

    Both probes agree on 60/1 — a genuinely constant rate — yet the source's own
    leading frames start at 5.008. Deriving timestamps from the rate alone puts
    every band 8 ms off every real frame, which is nearly two full tolerance
    widths.
    """
    grid = grid_from_probe(
        r_frame_rate="60/1",
        avg_frame_rate="60/1",
        leading_pts=[Fraction("5.008"), Fraction("5.025"), Fraction("5.041")],
    )
    assert grid.rate == FPS60
    assert grid.origin_s == 5.008

    assumed = _plan([6.0], 5.9, 6.1, SourceGrid(rate=FPS60, origin=Fraction(0)))
    measured = _plan([6.0], 5.9, 6.1, grid)
    tol = measured.selection_tolerance_s
    for wrong in assumed.selected_timestamps:
        assert all(abs(wrong - real) > tol for real in measured.selected_timestamps)


def test_frame_indices_are_true_source_ordinals_on_an_offset_grid():
    grid = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    # 6.0 is 0.992 s after the first frame — 59.52 frames — so frame 60.
    assert grid.index(6.0) == 60
    assert frame_time(60, grid) == pytest.approx(6.008, abs=1e-6)


def test_a_source_whose_leading_frames_are_not_on_one_grid_is_refused():
    with pytest.raises(UnsupportedFrameRate):
        grid_from_probe(
            r_frame_rate="60/1",
            avg_frame_rate="60/1",
            leading_pts=[Fraction(0), Fraction("0.017"), Fraction("0.040")],
        )


def test_a_source_with_no_readable_frame_timestamps_is_refused():
    """Absent evidence of the origin is not evidence of a zero origin."""
    with pytest.raises(UnsupportedFrameRate):
        grid_from_probe(r_frame_rate="60/1", avg_frame_rate="60/1", leading_pts=[])


@pytest.mark.parametrize("value", [None, "", "abc", -1.0, True])
def test_an_unusable_pinned_origin_is_refused(value):
    with pytest.raises(UnsupportedFrameRate):
        parse_origin(value)


def test_a_pinned_origin_round_trips_exactly():
    """Through the DECIMAL text, so the band centres do not shift by a binary
    artefact and the argv comparison stays exact."""
    assert parse_origin(5.008) == Fraction("5.008")
    assert parse_origin("5.008") == Fraction("5.008")


# ─── The grid arithmetic ─────────────────────────────────────────────────────


def test_frame_index_is_the_nearest_source_frame():
    assert frame_index(2088.0, GRID60) == 125280
    assert frame_time(125280, GRID60) == 2088.0
    # Pass-1 read this frame at 1539.011; the true source frame is 1539.016667.
    assert frame_index(1539.011, GRID60) == 92341
    assert frame_time(92341, GRID60) == pytest.approx(1539.016667, abs=1e-6)


def test_tolerance_is_a_quarter_frame():
    """Wide enough to absorb container timestamp rounding on BOTH the frame and
    the measured origin, far narrower than half a frame, so exactly one source
    frame can satisfy each term."""
    tol = selection_tolerance(GRID60)
    assert tol == pytest.approx(1 / 240, abs=1e-6)  # reported at 6 decimals
    assert tol > 0.001  # 0.5 ms on the frame + 0.5 ms on the origin
    assert tol < 1 / 120  # strictly inside a half-frame


# ─── The failed case ─────────────────────────────────────────────────────────


def test_failed_case_selects_the_evidence_frame_and_its_two_neighbours():
    plan = _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    assert plan.mode == SAMPLING_MODE
    assert plan.selected_frame_indices == (125279, 125280, 125281)
    assert plan.selected_timestamps == (2087.983333, 2088.0, 2088.016667)
    assert plan.expected_frame_count == 3


def test_failed_case_never_selects_the_old_dropdown_frames():
    """±0.5 s neighbours are known transition frames here — they must be out of
    every selection term's tolerance band."""
    plan = _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    tol = plan.selection_tolerance_s
    for bad in OLD_PINNED_OUTPUT_TIMES:
        assert all(abs(bad - t) > tol for t in plan.selected_timestamps)


def test_failed_case_pins_the_exact_canonical_argv():
    plan = _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    argv = canonical_ffmpeg_argv(
        video_path="/mnt/k/NHL/NHL26/2026-06-07_18-59-11.mkv",
        output_pattern="/cache/rescue/seg-9002-post_game_faceoff_map/.staging/%05d.png",
        plan=plan,
    )
    assert argv == [
        "ffmpeg", "-v", "error", "-y",
        "-ss", "2087.233",
        "-t", "0.817",
        "-i", "/mnt/k/NHL/NHL26/2026-06-07_18-59-11.mkv",
        "-copyts",
        "-vf",
        "select=between(t\\,2087.979167\\,2087.987500)"
        "+between(t\\,2087.995833\\,2088.004167)"
        "+between(t\\,2088.012500\\,2088.020833)",
        "-fps_mode", "passthrough",
        "-frames:v", "3",
        "/cache/rescue/seg-9002-post_game_faceoff_map/.staging/%05d.png",
    ]


def test_no_fps_filter_survives_anywhere_in_the_canonical_argv():
    plan = _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    argv = canonical_ffmpeg_argv(
        video_path="/v.mkv", output_pattern="/b/.staging/%05d.png", plan=plan
    )
    assert not any(tok.startswith("fps=") for tok in argv)
    assert "-to" not in argv  # replaced by the bounded input duration


def test_the_seek_is_relative_to_the_grid_origin():
    """ffmpeg counts input ``-ss`` from the input's own start, but ``-copyts``
    puts the filter's ``t`` in absolute PTS. The plan carries both, and the argv
    must use the relative one or an offset source seeks past its own frames."""
    grid = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    plan = _plan([6.0], 5.9, 6.1, grid)
    argv = canonical_ffmpeg_argv(
        video_path="/v.mkv", output_pattern="/b/.staging/%05d.png", plan=plan
    )
    assert plan.decode_start_s > 5.008
    assert argv[argv.index("-ss") + 1] == f"{plan.decode_seek_s:.3f}"
    assert plan.decode_seek_s == pytest.approx(plan.decode_start_s - 5.008, abs=1e-6)
    # …while the bands stay absolute.
    assert "between(t\\,6.003833\\,6.012167)" in plan.select_expr


def test_a_zero_origin_seek_is_the_absolute_start():
    plan = _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    assert plan.decode_seek_s == plan.decode_start_s


# ─── Bounded decode ──────────────────────────────────────────────────────────


def test_decode_bound_absorbs_an_input_seek_that_lands_a_frame_early():
    """ffmpeg's accurate input seek keeps the source frame whose interval
    CONTAINS ``-ss``, so decoding can begin up to one frame interval BEFORE the
    requested time, and input ``-t`` is measured from that landing with an
    exclusive end. Measured on 2026-05-23_20-14-39.mkv, ``-ss 573.250`` begins at
    573.233."""
    plan = _plan([574.0], 573.25, 574.0)
    interval = 1 / 60
    worst_case_end = (plan.decode_start_s - interval) + plan.decode_duration_s
    assert worst_case_end > plan.selected_timestamps[-1]


def test_decode_start_leads_the_first_selected_frame_by_a_whole_interval():
    """The other landing direction, also measured: a seek can land on the first
    frame at or AFTER the request (offset fixture, request 5.900 -> 5.908). A
    window whose evidence sits on t0 has its first selected frame AT t0, so
    without a frame of lead that landing would skip it."""
    plan = _plan([2088.0], 2088.0, 2088.75)
    assert plan.decode_start_s <= plan.selected_timestamps[0] - 1 / 60


def test_decode_bound_does_not_depend_on_a_frame_being_matched():
    """The bound is arithmetic over the selection, not a consequence of a hit —
    so an unmatched timestamp still cannot decode to end-of-file."""
    plan = _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    assert plan.decode_duration_s == 0.817
    assert plan.decode_duration_s < (FAILED_T1 - FAILED_T0) + 1.0


def test_decode_bound_still_includes_a_frame_at_the_old_exclusive_t1():
    """Clamped window: evidence sits exactly ON t1, where `-to t1` was exclusive.
    The frame at t1 must be inside the bound."""
    plan = _plan([2088.0], 2087.25, 2088.0)
    assert plan.selected_timestamps[-1] == 2088.0
    assert (plan.decode_start_s - 1 / 60) + plan.decode_duration_s > 2088.0


def test_the_decode_never_seeks_before_the_source_starts():
    grid = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    plan = _plan([5.05], 5.008, 5.2, grid)
    assert plan.decode_seek_s >= 0.0
    assert plan.decode_start_s >= 5.008


# ─── Clamping ────────────────────────────────────────────────────────────────


def test_clamps_the_trailing_neighbour_at_t1():
    plan = _plan([2088.0], 2087.25, 2088.0)
    assert plan.selected_frame_indices == (125279, 125280)
    assert plan.expected_frame_count == 2


def test_clamps_the_leading_neighbour_at_t0():
    plan = _plan([2088.0], 2088.0, 2088.75)
    assert plan.selected_frame_indices == (125280, 125281)


def test_clamps_at_the_video_start():
    """No negative frame index can be selected."""
    plan = _plan([0.0], 0.0, 0.75)
    assert plan.selected_frame_indices == (0, 1)


def test_clamps_at_the_video_start_of_an_offset_source():
    grid = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    plan = _plan([5.008], 5.008, 5.758, grid)
    assert plan.selected_frame_indices == (0, 1)


def test_evidence_before_the_first_source_frame_is_refused():
    """An offset source simply does not present that instant."""
    grid = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    with pytest.raises(SamplingImpossible):
        _plan([1.0], 0.5, 1.5, grid)


def test_evidence_frame_itself_is_never_clamped_away():
    """A window so tight that the evidence frame falls outside it is not a
    window this sampler can honour — fail closed rather than emit a command
    that provably cannot capture its own evidence."""
    with pytest.raises(SamplingImpossible):
        _plan([2088.0], 2088.1, 2088.3)


def test_rejects_an_empty_window():
    with pytest.raises(SamplingImpossible):
        _plan([2088.0], 2088.0, 2088.0)


def test_rejects_a_window_with_no_evidence():
    with pytest.raises(SamplingImpossible):
        _plan([], 2087.25, 2088.75)


# ─── Deduplication ───────────────────────────────────────────────────────────


def test_two_distant_evidence_frames_select_two_disjoint_neighbourhoods():
    plan = _plan([2088.0, 2089.0], 2087.25, 2089.75)
    assert plan.selected_frame_indices == (125279, 125280, 125281, 125339, 125340, 125341)
    assert plan.expected_frame_count == 6


def test_adjacent_evidence_frames_deduplicate_their_shared_neighbours():
    """Evidence one source frame apart: the union is 4 frames, not 6."""
    plan = _plan([2088.0, 2088.016667], 2087.25, 2088.75)
    assert plan.selected_frame_indices == (125279, 125280, 125281, 125282)
    assert plan.expected_frame_count == 4


def test_duplicate_evidence_timestamps_collapse():
    plan = _plan([2088.0, 2088.0], 2087.25, 2088.75)
    assert plan.expected_frame_count == 3


def test_expected_count_always_equals_deduplicated_selected_timestamps():
    plan = _plan([2088.0, 2088.016667], 2087.25, 2088.75)
    assert plan.expected_frame_count == len(set(plan.selected_timestamps))
    assert len(plan.select_expr.split("+")) == plan.expected_frame_count


# ─── Observation: the plan must name frames the source really has ────────────


def test_an_observed_plan_records_one_real_frame_per_band():
    plan = _observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    assert plan.observed
    assert plan.observed_frame_pts == plan.selected_timestamps


def test_observation_absorbs_millisecond_container_quantisation():
    """Matroska stores PTS in ms, so a real frame is never exactly on the ideal
    grid. The band is a quarter frame; the quantisation is at most 1 ms."""

    def quantised(path, start, end):
        ideal = ideal_probe(GRID60)(path, start, end)
        return tuple(Fraction(round(p * 1000), 1000) for p in ideal)

    plan = observe_plan(
        _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1),
        video_path="/v.mkv",
        probe_frames=quantised,
    )
    assert plan.observed_frame_pts == (2087.983, 2088.0, 2088.017)


def test_an_empty_band_refuses_the_plan():
    """The origin-zero failure mode, caught before anything is pinned."""
    offset = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    with pytest.raises(SamplingImpossible, match="matched by 0 real source frame"):
        observe_plan(
            _plan([6.0], 5.9, 6.1, GRID60),  # planned on the WRONG grid
            video_path="/v.mkv",
            probe_frames=ideal_probe(offset),  # against the real one
        )


def test_two_frames_in_one_band_refuses_the_plan():
    """Ambiguity makes the expected count unreachable in the other direction."""

    def doubled(path, start, end):
        base = ideal_probe(GRID60)(path, start, end)
        return tuple(sorted(base + tuple(p + Fraction(1, 2000) for p in base)))

    with pytest.raises(SamplingImpossible, match="matched by 2 real source frame"):
        observe_plan(
            _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1),
            video_path="/v.mkv",
            probe_frames=doubled,
        )


def test_a_probe_that_stops_short_is_not_read_as_an_empty_band():
    def truncated(path, start, end):
        return ideal_probe(GRID60)(path, start, float(FAILED_EVIDENCE))

    with pytest.raises(SamplingImpossible, match="stopped at"):
        observe_plan(
            _plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1),
            video_path="/v.mkv",
            probe_frames=truncated,
        )


def test_an_unobserved_plan_cannot_be_serialised():
    """The only way into a manifest is through a measurement."""
    with pytest.raises(SamplingImpossible, match="never observed"):
        sampling_to_dict(_plan([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))


# ─── Properties ──────────────────────────────────────────────────────────────

_CASES = [
    (evidence, t0, t1)
    for evidence in (12.0, 100.5, 1539.011, 2088.0, 3600.25)
    for t0, t1 in ((-0.75, 0.75), (-0.75, 0.0), (0.0, 0.75), (-0.25, 0.1))
]

_GRIDS = [
    ("zero", GRID60),
    ("offset", SourceGrid(rate=FPS60, origin=Fraction("5.008"))),
    ("2997", SourceGrid(rate=SourceFrameRate(30000, 1001), origin=Fraction("0.041"))),
]


@pytest.mark.parametrize("evidence,d0,d1", [(e, a, b) for e, a, b in _CASES])
@pytest.mark.parametrize("label,grid", _GRIDS, ids=[g[0] for g in _GRIDS])
def test_property_every_evidence_timestamp_is_explicitly_represented(
    evidence, d0, d1, label, grid
):
    t0, t1 = round(evidence + d0, 3), round(evidence + d1, 3)
    plan = _plan([evidence], t0, t1, grid)
    assert grid.index(evidence) in plan.selected_frame_indices


@pytest.mark.parametrize("evidence,d0,d1", [(e, a, b) for e, a, b in _CASES])
@pytest.mark.parametrize("label,grid", _GRIDS, ids=[g[0] for g in _GRIDS])
def test_property_evidence_is_represented_by_its_real_measured_frame(
    evidence, d0, d1, label, grid
):
    """The observed measurement for the evidence's own frame is within one
    tolerance of the evidence timestamp's nearest grid point — i.e. the pinned
    command names the frame that actually carries the evidence, not one derived
    from a rate."""
    t0, t1 = round(evidence + d0, 3), round(evidence + d1, 3)
    plan = observe_plan(
        _plan([evidence], t0, t1, grid),
        video_path="/v.mkv",
        probe_frames=ideal_probe(grid),
    )
    core = plan.selected_frame_indices.index(grid.index(evidence))
    assert plan.observed_frame_pts[core] == pytest.approx(
        float(grid.pts(grid.index(evidence))), abs=1e-6
    )


@pytest.mark.parametrize("evidence,d0,d1", [(e, a, b) for e, a, b in _CASES])
@pytest.mark.parametrize("label,grid", _GRIDS, ids=[g[0] for g in _GRIDS])
def test_property_selected_timestamps_stay_inside_the_window(
    evidence, d0, d1, label, grid
):
    """The permitted bound is the window inflated by half a source frame.

    A source frame is the sample that *represents* an instant, so the frames
    covering [t0, t1] are those within half a frame of it. The inflation is
    exactly what absorbs Pass-1 reading an off-grid evidence time (1539.011 for
    a frame whose true PTS is 1539.016667) — and it is strictly smaller than one
    frame, so a genuine neighbour outside the window is still clamped away.
    """
    t0, t1 = round(evidence + d0, 3), round(evidence + d1, 3)
    half = float(grid.frame_interval / 2)
    plan = _plan([evidence], t0, t1, grid)
    assert all(t0 - half <= t <= t1 + half for t in plan.selected_timestamps)
    assert all(i >= 0 for i in plan.selected_frame_indices)


def test_off_grid_evidence_on_t1_keeps_its_own_frame():
    """Pass-1 read this at 1539.011; the source frame is 1539.016667, 5.7 ms
    past a t1 that landed on the read. Half-frame coverage keeps it."""
    plan = _plan([1539.011], 1538.261, 1539.011)
    assert plan.selected_frame_indices == (92340, 92341)
    assert plan.selected_timestamps[-1] == pytest.approx(1539.016667, abs=1e-6)
    assert plan.decode_start_s + plan.decode_duration_s > 1539.016667


def test_a_full_neighbour_outside_the_window_is_still_clamped_away():
    """Half-frame coverage must not smuggle in a whole extra frame."""
    plan = _plan([2088.0], 2087.25, 2088.0)
    assert 2088.016667 not in plan.selected_timestamps


@pytest.mark.parametrize("evidence,d0,d1", [(e, a, b) for e, a, b in _CASES])
@pytest.mark.parametrize("label,grid", _GRIDS, ids=[g[0] for g in _GRIDS])
def test_property_counts_and_ordering_are_consistent(evidence, d0, d1, label, grid):
    t0, t1 = round(evidence + d0, 3), round(evidence + d1, 3)
    plan = _plan([evidence], t0, t1, grid)
    idx = plan.selected_frame_indices
    assert list(idx) == sorted(set(idx))
    assert plan.expected_frame_count == len(idx) == len(plan.selected_timestamps)
    assert 1 <= plan.expected_frame_count <= len(NEIGHBOUR_OFFSETS)


@pytest.mark.parametrize("evidence,d0,d1", [(e, a, b) for e, a, b in _CASES])
@pytest.mark.parametrize("label,grid", _GRIDS, ids=[g[0] for g in _GRIDS])
def test_property_selection_terms_never_overlap(evidence, d0, d1, label, grid):
    """Overlapping bands would let one source frame satisfy two terms and make
    the expected count unreachable."""
    t0, t1 = round(evidence + d0, 3), round(evidence + d1, 3)
    plan = _plan([evidence], t0, t1, grid)
    tol = plan.selection_tolerance_s
    times = plan.selected_timestamps
    assert all(b - a > 2 * tol for a, b in zip(times, times[1:]))


@pytest.mark.parametrize("evidence,d0,d1", [(e, a, b) for e, a, b in _CASES])
@pytest.mark.parametrize("label,grid", _GRIDS, ids=[g[0] for g in _GRIDS])
def test_property_decode_bound_covers_every_selected_timestamp(
    evidence, d0, d1, label, grid
):
    """Worst-case landing in EITHER direction, exclusive end."""
    t0, t1 = round(evidence + d0, 3), round(evidence + d1, 3)
    interval = float(grid.frame_interval)
    plan = _plan([evidence], t0, t1, grid)
    assert plan.decode_start_s <= plan.selected_timestamps[0] - interval + 1e-9
    assert (plan.decode_start_s - interval) + plan.decode_duration_s > plan.selected_timestamps[-1]
    assert plan.decode_seek_s >= 0.0


# ─── Round trip and validation ───────────────────────────────────────────────


def test_round_trips_through_the_manifest_dict():
    plan = _observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    assert sampling_from_dict(sampling_to_dict(plan)) == plan


def test_serialised_form_carries_the_canonical_inputs():
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    assert doc["mode"] == SAMPLING_MODE
    assert doc["source_frame_rate"] == "60/1"
    assert doc["source_pts_origin_s"] == 0.0
    assert doc["evidence_timestamps"] == [2088.0]
    assert doc["expected_frame_count"] == 3
    assert doc["selected_timestamps"] == [2087.983333, 2088.0, 2088.016667]
    assert doc["observed_frame_pts"] == [2087.983333, 2088.0, 2088.016667]
    assert doc["decode_seek_s"] == 2087.233
    assert doc["select_expr"].startswith("select=between(t\\,")


def test_faithful_metadata_has_no_problems():
    plan = _observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1)
    assert sampling_problems(
        sampling_to_dict(plan),
        evidence_timestamps=[FAILED_EVIDENCE],
        t0=FAILED_T0,
        t1=FAILED_T1,
    ) == []


def test_faithful_offset_grid_metadata_has_no_problems():
    grid = SourceGrid(rate=FPS60, origin=Fraction("5.008"))
    plan = _observed([6.0], 5.9, 6.1, grid)
    assert sampling_problems(
        sampling_to_dict(plan), evidence_timestamps=[6.0], t0=5.9, t1=6.1
    ) == []


def test_metadata_that_hides_an_evidence_timestamp_is_rejected():
    plan = _observed([2088.0, 2089.0], 2087.25, 2089.75)
    doc = sampling_to_dict(plan)
    doc["evidence_timestamps"] = [2088.0]  # the manifest's second frame vanished
    problems = sampling_problems(
        doc, evidence_timestamps=[2088.0, 2089.0], t0=2087.25, t1=2089.75
    )
    assert any("evidence_timestamps" in p for p in problems)


def test_metadata_with_a_tampered_frame_count_is_rejected():
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["expected_frame_count"] = 2
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert any("expected_frame_count" in p for p in problems)


def test_metadata_with_a_timestamp_outside_the_window_is_rejected():
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["selected_timestamps"] = [2087.983333, 2088.0, 2099.0]
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert problems


def test_metadata_with_an_unsupported_frame_rate_is_rejected():
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["source_frame_rate"] = "0/0"
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert any("source grid" in p for p in problems)


def test_a_tampered_origin_is_rejected_by_recomputation():
    """Shifting the pinned origin shifts every derived timestamp with it, so the
    block stops matching what the window's own evidence and bounds imply."""
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["source_pts_origin_s"] = 0.004
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert any("selected_timestamps" in p or "select_expr" in p for p in problems)


def test_observations_that_contradict_the_pinned_grid_are_rejected():
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["observed_frame_pts"] = [2087.983333, 2088.05, 2088.016667]
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert any("observed_frame_pts[1]" in p for p in problems)


def test_a_short_observation_list_is_rejected():
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["observed_frame_pts"] = [2088.0]
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert any("observed_frame_pts" in p for p in problems)


def test_metadata_with_a_hand_edited_select_expression_is_rejected():
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["select_expr"] = "select=between(t\\,0\\,99999)"
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert any("select_expr" in p for p in problems)


def test_missing_sampling_metadata_is_rejected():
    assert sampling_problems(
        None, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert sampling_problems(
        {}, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )


def test_a_schema_v1_sampling_block_is_rejected():
    """A block from the origin-zero contract must not execute under this one."""
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["mode"] = "source_pts_neighbourhood_v1"
    problems = sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )
    assert any("mode" in p for p in problems)


def test_recomputation_is_the_check_not_expression_parsing():
    """The validator rebuilds the canonical expression and compares; it never
    interprets the recorded one. A syntactically valid but different expression
    is therefore still rejected."""
    doc = sampling_to_dict(_observed([FAILED_EVIDENCE], FAILED_T0, FAILED_T1))
    doc["select_expr"] = doc["select_expr"].replace("between", "lte")
    assert sampling_problems(
        doc, evidence_timestamps=[FAILED_EVIDENCE], t0=FAILED_T0, t1=FAILED_T1
    )


def test_frame_rate_fraction_is_exact():
    assert SourceFrameRate(30000, 1001).fraction == Fraction(30000, 1001)


# ─── The ffprobe edge ────────────────────────────────────────────────────────


def test_probing_a_missing_video_fails_closed(tmp_path):
    with pytest.raises(UnsupportedFrameRate):
        probe_source_grid(str(tmp_path / "not-a-video.mkv"))


def test_the_prober_probes_each_path_once():
    calls: list[str] = []

    def probe(path: str) -> SourceGrid:
        calls.append(path)
        return GRID60

    lookup = memoised_prober(probe=probe)
    assert lookup("/a.mkv") == GRID60
    assert lookup("/a.mkv") == GRID60
    assert lookup("/b.mkv") == GRID60
    assert calls == ["/a.mkv", "/b.mkv"]
    assert lookup.cache == {"/a.mkv": GRID60, "/b.mkv": GRID60}


def test_a_failing_probe_propagates_rather_than_defaulting():
    def probe(path: str) -> SourceGrid:
        raise UnsupportedFrameRate("variable frame rate")

    with pytest.raises(UnsupportedFrameRate):
        memoised_prober(probe=probe)("/vfr.mkv")


# ─── Against real ffmpeg ─────────────────────────────────────────────────────
#
# The section that makes the origin claim a measurement rather than an argument.
# Two synthetic 60 fps sources, identical except for the phase of their grid.

_HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
requires_ffmpeg = pytest.mark.skipif(_HAVE_FFMPEG is False, reason="ffmpeg/ffprobe absent")

#: Half a frame at 60 fps. Chosen so the offset is NOT a multiple of the frame
#: interval: an offset of a whole number of frames would leave the origin-zero
#: grid coincidentally correct and prove nothing.
OFFSET_S = "5.008333"


def _encode(path: Path, *, offset: str | None) -> None:
    argv = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=60:duration=3",
        "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv420p",
    ]
    if offset is not None:
        argv += ["-output_ts_offset", offset, "-muxpreload", "0", "-muxdelay", "0"]
    subprocess.run(argv + [str(path)], check=True, capture_output=True)


@pytest.fixture(scope="module")
def sources(tmp_path_factory) -> dict:
    """A zero-origin source, an offset-origin source, and a reference decode.

    The reference is every frame of the offset source decoded in order with
    ``-fps_mode passthrough``, so file ``k`` (1-based) IS source frame ``k-1``.
    Comparing bytes against it is an independent check of *which* frame a
    selection produced — it does not go through this module's arithmetic at all.
    """
    if not _HAVE_FFMPEG:
        pytest.skip("ffmpeg/ffprobe absent")
    root = tmp_path_factory.mktemp("pts")
    zero, offset = root / "zero.mkv", root / "offset.mkv"
    _encode(zero, offset=None)
    _encode(offset, offset=OFFSET_S)
    ref = root / "ref"
    ref.mkdir()
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(offset), "-fps_mode", "passthrough",
         str(ref / "%05d.png")],
        check=True, capture_output=True,
    )
    return {"root": root, "zero": zero, "offset": offset, "ref": ref}


def _run(plan: SamplingPlan, video: Path, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        canonical_ffmpeg_argv(
            video_path=str(video),
            output_pattern=str(out_dir / "%05d.png"),
            plan=plan,
        ),
        check=True,
        capture_output=True,
    )
    return sorted(out_dir.iterdir())


@requires_ffmpeg
def test_the_offset_fixture_reports_equal_rates(sources):
    """The premise. If the two rates disagreed, the old rate check would already
    have refused this source and the origin would never come up."""
    grid = probe_source_grid(str(sources["offset"]))
    assert grid.rate == FPS60
    assert grid.origin_s == 5.008  # the container quantises to ms


@requires_ffmpeg
def test_the_zero_fixture_measures_a_zero_origin(sources):
    grid = probe_source_grid(str(sources["zero"]))
    assert grid == GRID60


@requires_ffmpeg
def test_the_origin_zero_model_selects_nothing_on_an_offset_source(sources, tmp_path):
    """The corrected implementation must be REQUIRED, not merely equivalent.

    Planning t=6.0 on the assumed zero-origin grid names 5.983333 / 6.000000 /
    6.016667. The real frames are at 5.991 / 6.008 / 6.025 — 8 ms away, which is
    nearly two tolerance widths. ffmpeg exits 0 and writes nothing.
    """
    plan = _plan([6.0], 5.9, 6.1, GRID60)
    assert _run(plan, sources["offset"], tmp_path / "wrong") == []


@requires_ffmpeg
def test_the_measured_grid_selects_the_real_evidence_frame_and_neighbours(
    sources, tmp_path
):
    """…and the same plan, on the measured grid, produces exactly the right
    three frames — identified by BYTES against an independent full decode."""
    grid = probe_source_grid(str(sources["offset"]))
    plan = observe_plan(
        _plan([6.0], 5.9, 6.1, grid),
        video_path=str(sources["offset"]),
        probe_frames=probe_frame_pts,
    )
    # Frame 60 of the file is 5.008 + 1.000 = 6.008, the frame nearest 6.0.
    assert plan.selected_frame_indices == (59, 60, 61)
    assert plan.observed_frame_pts == (5.991, 6.008, 6.025)

    produced = _run(plan, sources["offset"], tmp_path / "right")
    assert len(produced) == 3
    for path, index in zip(produced, plan.selected_frame_indices):
        reference = sources["ref"] / f"{index + 1:05d}.png"
        assert path.read_bytes() == reference.read_bytes(), (
            f"selected index {index} did not produce source frame {index}"
        )


@requires_ffmpeg
def test_the_measured_grid_is_still_right_on_a_zero_origin_source(sources, tmp_path):
    """No regression on the shape the whole live corpus actually has."""
    grid = probe_source_grid(str(sources["zero"]))
    plan = observe_plan(
        _plan([1.0], 0.9, 1.1, grid),
        video_path=str(sources["zero"]),
        probe_frames=probe_frame_pts,
    )
    assert plan.selected_frame_indices == (59, 60, 61)
    assert len(_run(plan, sources["zero"], tmp_path / "zero")) == 3


@requires_ffmpeg
def test_a_selection_that_matches_nothing_still_terminates_quickly(sources, tmp_path):
    """The bounded-decode claim, measured. A band naming an instant no frame
    occupies must not send ffmpeg scanning to end of file: the input duration
    bounds the demux whether or not anything matches."""
    plan = _plan([6.0], 5.9, 6.1, GRID60)  # wrong grid for this source
    argv = canonical_ffmpeg_argv(
        video_path=str(sources["offset"]),
        output_pattern=str((tmp_path / "none").as_posix()) + "/%05d.png",
        plan=plan,
    )
    (tmp_path / "none").mkdir()
    proc = subprocess.run(argv, capture_output=True, timeout=30)
    assert proc.returncode == 0
    assert list((tmp_path / "none").iterdir()) == []
    assert float(argv[argv.index("-t") + 1]) < 0.5


@requires_ffmpeg
def test_probe_frame_pts_reads_the_absolute_timeline(sources):
    """``-read_intervals`` is absolute PTS, which is what makes it usable as the
    same coordinates the select bands are written in."""
    pts = probe_frame_pts(str(sources["offset"]), 5.95, 6.05)
    assert any(abs(float(p) - 6.008) < 1e-6 for p in pts)
    assert min(float(p) for p in pts) >= 5.0
