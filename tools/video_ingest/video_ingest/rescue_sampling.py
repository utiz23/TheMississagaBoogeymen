"""Exact-evidence sampling for the Stage-B rescue — measured source-PTS selection.

**The original defect.** Every auto window in the schema-2 manifest pinned
``-vf fps=N``. The ``fps`` filter resamples onto its OWN grid, phase-locked to
whatever the input seek happened to land on, so the frames it emits are
unrelated to the frame the evidence was read from. Across all 97 auto windows,
not one command captured its own evidence timestamp. In the window that failed
(``4b8a77d091a9/seg9002``, ``t0=2087.250 evidence=2088.000 t1=2088.750``) it
produced 2087.733 and 2088.733 — both mid-transition frames with the category
dropdown open — while the evidence frame at 2088.000 was never decoded.

**The replacement.** Select by SOURCE presentation timestamp. For each evidence
timestamp take the exact source frame that carries it plus its two immediate
source neighbours, expressed as a ``select`` filter over ``-copyts`` timestamps
so the coordinates are the input's own, not a rebased output timeline.

**The second defect, and why this module now measures instead of deriving.**
The first version of this module modelled the source grid as ``n / fps`` — an
origin of zero, assumed rather than observed. Equal ``r_frame_rate`` and
``avg_frame_rate`` prove a CONSTANT rate; they prove nothing about the phase of
the grid. A perfectly constant-rate source may present ``origin + n / fps`` for
any origin — a trimmed, offset or remuxed recording routinely does. On such a
source every derived timestamp is off by the origin's fractional part, every
``between()`` band names an instant no frame occupies, and the command decodes
nothing while looking entirely well-formed. A 60 fps source offset by 8 ms
(half a frame) selects zero frames; this is reproduced end-to-end against real
ffmpeg in ``test_rescue_sampling.py``.

So the grid is now a MEASUREMENT, in two independent steps, and both are pinned:

* :func:`probe_source_grid` reads the source's real first frames and takes the
  origin from them — :class:`SourceGrid` carries ``origin`` alongside the rate,
  and every index/timestamp is computed as ``origin + n * interval``;
* :func:`observe_plan` then probes the actual frame PTS in the neighbourhood of
  each evidence timestamp and requires exactly one real source frame inside each
  selected band. The observed values are pinned into the manifest as
  ``observed_frame_pts``, so "this command names frames that exist" is a
  recorded measurement a reviewer can read, not a property of the arithmetic.

Three properties make the result safe to pin in a manifest:

* **Determinism.** Given a source, everything is rational arithmetic over
  ``(evidence, t0, t1, grid)``. The generator, the executor's validator and the
  transform tool all call :func:`plan_sampling` and :func:`canonical_ffmpeg_argv`,
  so "what was pinned" and "what is checked" are the same code, not two
  descriptions of it. ffprobe is deterministic on a fixed file, so a candidate
  reproduces byte for byte.
* **No fps assumption and no origin assumption.** The grid comes from the
  source. 60/1 at origin 0 is what the current 39 usable videos happen to be,
  not a constant here. Anything that is not a usable constant grid raises
  :class:`UnsupportedFrameRate` rather than defaulting.
* **Bounded decode.** The command carries an input-side duration as well as
  ``-frames:v``. ``-frames:v`` alone stops nothing when a selected timestamp is
  never matched — ffmpeg would decode to end of file looking for it. The input
  duration bounds the demux regardless of whether anything matches, and the
  shortfall is then caught by the executor's per-invocation output proof.

Neighbour choice is deliberately *source-adjacent*, never ±0.5 s: in the failed
window the ±0.5 s frames are precisely the transition frames the old command
already produced and the OCR could not read.

**One measured ffmpeg semantic the argv depends on.** Input ``-ss`` is counted
from the input's own start, NOT as an absolute presentation timestamp: on a
source whose first frame is at 5.008, ``-ss 0.5`` lands at 5.508.
``-seek_timestamp 1`` would make it absolute but is unsupported by the matroska
demuxer (measured: it yields zero frames). ``-copyts``, meanwhile, keeps the
filter's ``t`` in absolute source PTS. So the two halves of the command live in
two different timelines, and :attr:`SamplingPlan.decode_seek_s` — the value that
goes in the argv — is the start expressed relative to the grid origin, while
:attr:`SamplingPlan.decode_start_s` records the same instant absolutely for a
human reading the manifest.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
from dataclasses import dataclass, replace
from fractions import Fraction
from typing import Any, Callable, Iterable, Sequence

#: Names the contract in the manifest so a reader (and the validator) can tell a
#: sampling-metadata block apart from any future scheme without inspecting it.
#: ``_v2`` because the grid gained a measured origin and the block gained
#: ``observed_frame_pts`` and ``decode_seek_s``; a ``_v1`` block describes a
#: command built on the origin-zero assumption and is not executable.
SAMPLING_MODE = "source_pts_neighbourhood_v2"

#: The evidence frame and its immediate source neighbours. Relative to the
#: evidence's own frame index, so the spacing is one source frame — whatever
#: that is in seconds for this video.
NEIGHBOUR_OFFSETS: tuple[int, ...] = (-1, 0, 1)

#: Half-width of each ``between()`` term, as a fraction of one frame interval.
#: Bounded below by container timestamp quantisation (matroska stores PTS in
#: milliseconds, so up to 0.5 ms of rounding on the frame AND up to 0.5 ms on the
#: measured origin, 1 ms in the worst case) and above by half a frame, beyond
#: which two source frames could satisfy one term and the expected output count
#: would become unreachable. A quarter frame sits comfortably between the two at
#: every plausible rate: 4.17 ms at 60 fps, 8.3 ms at 30 fps.
TOLERANCE_FRAME_FRACTION = Fraction(1, 4)

#: Decimal places for timestamps in the manifest and in the select expression.
#: Six is finer than any real frame interval and coarser than double precision,
#: so the same value renders identically everywhere.
TIME_DECIMALS = 6

#: Decimal places for ``-ss`` / ``-t``. Milliseconds, matching the window bounds
#: the manifest already pins at ``%.3f``.
DECODE_DECIMALS = 3

#: How many leading frames :func:`probe_source_grid` reads to fix the origin.
#: More than one because ffprobe emits frames in DECODE order, so with B-frames
#: the first line is not necessarily the earliest presentation timestamp; the
#: origin is the minimum over this window, which covers any realistic reorder
#: depth.
ORIGIN_PROBE_FRAMES = 12

#: Slack, in frame intervals, added either side of a neighbourhood probe so the
#: probe demonstrably spans every band it is asked about.
#:
#: Twelve rather than two or three because ffprobe's ``-read_intervals`` end
#: bound is CONSERVATIVE by the stream's reorder depth: it stops on decode
#: order, so with B-frames the largest presentation timestamp it returns falls
#: short of the requested end. Measured on 2026-06-16_19-22-51.mkv, an end of
#: 1782.066667 returns nothing past 1782.017 — two frames short — and a 3-frame
#: pad left the last band's coverage check failing on a perfectly good source.
#: Twelve frames (0.2 s at 60 fps) clears any realistic reorder depth, and if it
#: ever did not, :func:`observe_plan` still fails closed rather than reading the
#: shortfall as an empty band.
NEIGHBOURHOOD_PAD_FRAMES = 12

_RATE_RE = re.compile(r"^(\d+)/(\d+)$")


class UnsupportedFrameRate(ValueError):
    """The source grid is absent, unparseable, variable or non-positive.

    Raised rather than defaulted. A guessed grid produces neighbour timestamps
    that name frames the video does not have, and the command would then decode
    the wrong frames while looking entirely well-formed.
    """


class SamplingImpossible(ValueError):
    """No selection satisfies this window's own evidence and bounds."""


@dataclass(frozen=True)
class SourceFrameRate:
    """A constant source frame rate as an exact rational.

    Kept as ``num/den`` rather than a float because the frame grid is derived
    from it by division: ``30000/1001`` must stay exact or frame 2997 lands a
    hair off its true PTS and the tolerance band starts drifting.
    """

    num: int
    den: int

    def __post_init__(self) -> None:
        if not isinstance(self.num, int) or not isinstance(self.den, int):
            raise UnsupportedFrameRate(f"frame rate must be integral: {self.num}/{self.den}")
        if self.num <= 0 or self.den <= 0:
            raise UnsupportedFrameRate(f"frame rate must be positive: {self.num}/{self.den}")

    @property
    def fraction(self) -> Fraction:
        return Fraction(self.num, self.den)

    @property
    def text(self) -> str:
        return f"{self.num}/{self.den}"

    @property
    def frame_interval(self) -> Fraction:
        return Fraction(self.den, self.num)


@dataclass(frozen=True)
class SourceGrid:
    """A source's measured presentation-timestamp grid: ``origin + n * interval``.

    ``origin`` is the PTS of source frame index 0 — the file's first frame, as
    ffprobe reports it — so frame indices in a plan are true source frame
    ordinals and ``origin`` doubles as the base that input ``-ss`` is counted
    from. It is exact: a :class:`~fractions.Fraction` built from the DECIMAL text
    of the measurement, never from a binary float.

    A rate alone is not a grid. This type exists so that no call site can
    accidentally pass one where the other is needed.
    """

    rate: SourceFrameRate
    origin: Fraction

    def __post_init__(self) -> None:
        if not isinstance(self.origin, Fraction):
            raise UnsupportedFrameRate(
                f"grid origin must be an exact Fraction, got {self.origin!r}"
            )
        if self.origin < 0:
            raise UnsupportedFrameRate(f"grid origin must not be negative: {self.origin}")

    @property
    def frame_interval(self) -> Fraction:
        return self.rate.frame_interval

    @property
    def origin_s(self) -> float:
        """The origin as it is written to (and read back from) the manifest."""
        return round(float(self.origin), TIME_DECIMALS)

    @property
    def text(self) -> str:
        return f"{self.rate.text}@{self.origin_s:.{TIME_DECIMALS}f}"

    def pts(self, index: int) -> Fraction:
        """The exact presentation timestamp of source frame ``index``."""
        return self.origin + Fraction(index) * self.frame_interval

    def index(self, t: float | int | Fraction) -> int:
        """The index of the source frame nearest ``t`` (ties round up)."""
        return math.floor((_exact(t) - self.origin) / self.frame_interval + Fraction(1, 2))


def parse_frame_rate(text: Any) -> SourceFrameRate:
    """``"60/1"`` -> :class:`SourceFrameRate`. Anything else fails closed.

    ``0/0`` is ffprobe's "unknown", and it is the shape that matters most: it
    must never be read as a rate.
    """
    if not isinstance(text, str) or not text.strip():
        raise UnsupportedFrameRate(f"source frame rate unavailable: {text!r}")
    match = _RATE_RE.match(text.strip())
    if match is None:
        raise UnsupportedFrameRate(
            f"source frame rate {text!r} is not an integral num/den rational"
        )
    return SourceFrameRate(int(match.group(1)), int(match.group(2)))


def parse_origin(value: Any) -> Fraction:
    """A pinned ``source_pts_origin_s`` back to the exact number that was written.

    ``Fraction(str(value))`` rather than ``Fraction(value)``: the latter would
    carry the binary artefact of the float and shift every derived band by a
    few attoseconds, which then fails an exact string comparison of the argv.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise UnsupportedFrameRate(f"source PTS origin must be a number, got {value!r}")
    try:
        origin = Fraction(str(value))
    except (ValueError, ZeroDivisionError) as exc:
        raise UnsupportedFrameRate(f"source PTS origin {value!r} is not a number") from exc
    if origin < 0:
        raise UnsupportedFrameRate(f"source PTS origin must not be negative: {value!r}")
    return origin


def frame_rate_from_probe(*, r_frame_rate: Any, avg_frame_rate: Any) -> SourceFrameRate:
    """The pinned rate for a source, or :class:`UnsupportedFrameRate`.

    Both ffprobe rates must be present and must AGREE. Disagreement means
    variable frame rate: there is no single grid, so "the frame before" and
    "the frame after" an instant are not computable from a rate at all, and any
    neighbour this module named would be a fabrication.
    """
    base = parse_frame_rate(r_frame_rate)
    average = parse_frame_rate(avg_frame_rate)
    if base.fraction != average.fraction:
        raise UnsupportedFrameRate(
            f"variable frame rate: r_frame_rate={base.text} != avg_frame_rate={average.text}; "
            "source-neighbour sampling needs a constant grid"
        )
    return base


def grid_from_probe(
    *, r_frame_rate: Any, avg_frame_rate: Any, leading_pts: Sequence[Fraction]
) -> SourceGrid:
    """A :class:`SourceGrid` from a constant rate plus the source's first frames.

    Pure, so the whole grid-derivation policy is testable without ffprobe. The
    leading frames do two jobs: they fix the ORIGIN (their minimum — ffprobe
    emits decode order, so the first line need not be the earliest PTS), and
    they CHECK it, because every one of them must then land on the resulting
    grid within the container's own quantisation. A source whose leading frames
    are not evenly spaced has no grid to pin and is refused here rather than
    producing a plan whose bands drift.
    """
    rate = frame_rate_from_probe(r_frame_rate=r_frame_rate, avg_frame_rate=avg_frame_rate)
    if not leading_pts:
        raise UnsupportedFrameRate(
            "no frame presentation timestamps were readable; the PTS origin cannot "
            "be measured and must not be assumed to be zero"
        )
    interval = rate.frame_interval
    origin = min(leading_pts)
    tolerance = TOLERANCE_FRAME_FRACTION * interval
    for pts in sorted(leading_pts):
        offset = (pts - origin) / interval
        residual = (pts - origin) - round(offset) * interval
        if abs(residual) > tolerance:
            raise UnsupportedFrameRate(
                f"leading frame at {float(pts):.6f} is {float(residual) * 1000:.3f} ms off "
                f"the {rate.text} grid anchored at {float(origin):.6f} — the source does "
                "not present a single constant grid"
            )
    return SourceGrid(rate=rate, origin=origin)


# ─── The IO edge ─────────────────────────────────────────────────────────────
#
# Everything else in this module is arithmetic. These three reach ffprobe, and
# they live here rather than in the two scripts that need them precisely because
# fail-closed logic duplicated across callers is fail-closed logic that drifts:
# the generator and the transform tool must reject exactly the same videos.

#: ``probe_frames(path, start_s, end_s) -> tuple[Fraction, ...]`` — the exact
#: presentation timestamps of the source frames in an absolute-PTS interval.
#: Injected wherever a neighbourhood is verified so the policy is testable
#: without a video.
FramePtsProbe = Callable[[str, float, float], "tuple[Fraction, ...]"]


def _run_ffprobe(args: Sequence[str], *, path: str) -> str:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", *args, path],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise UnsupportedFrameRate(
            f"ffprobe failed for {path}: {proc.stderr.strip() or 'no stderr'}"
        )
    return proc.stdout or ""


def _parse_pts_lines(text: str) -> tuple[Fraction, ...]:
    """ffprobe's ``csv=p=0`` frame output -> exact timestamps, sorted.

    Exact because the value is parsed from its DECIMAL text. ``N/A`` lines are
    dropped rather than guessed at: a frame with no readable timestamp is a
    frame this module must not claim to have located.
    """
    values: list[Fraction] = []
    for line in text.splitlines():
        token = line.strip().rstrip(",").strip()
        if not token or token == "N/A":
            continue
        try:
            values.append(Fraction(token))
        except (ValueError, ZeroDivisionError):
            continue
    return tuple(sorted(values))


def probe_frame_pts(path: str, start_s: float, end_s: float) -> tuple[Fraction, ...]:
    """The real presentation timestamps of the source frames in ``[start, end]``.

    ``-read_intervals`` is in the input's ABSOLUTE timeline (measured: on a
    source whose first frame is 5.008, ``5.950%6.050`` returns 5.925…6.041), so
    the bounds here are the same coordinates the ``select`` bands use. ffprobe
    starts from the keyframe at or before ``start_s``, so the returned set is a
    superset of the interval — which is exactly what a neighbourhood check
    wants.
    """
    start = max(0.0, float(start_s))
    return _parse_pts_lines(
        _run_ffprobe(
            [
                "-show_entries", "frame=pts_time",
                "-of", "csv=p=0",
                "-read_intervals", f"{start:.6f}%{max(start, float(end_s)):.6f}",
            ],
            path=path,
        )
    )


def probe_source_grid(path: str) -> SourceGrid:
    """The source's measured constant grid — rate AND origin. Fails closed.

    Two probes: the stream's ``r_frame_rate``/``avg_frame_rate`` (which must
    agree, or the source is variable-rate and has no grid), and the file's first
    frames (which fix the origin instead of assuming it is zero). ffprobe
    reports ``0/0`` for an unknown rate; that is refused, never defaulted.
    """
    try:
        streams = json.loads(
            _run_ffprobe(
                [
                    "-show_entries", "stream=r_frame_rate,avg_frame_rate",
                    "-of", "json",
                ],
                path=path,
            )
            or "{}"
        ).get("streams") or []
    except json.JSONDecodeError as exc:
        raise UnsupportedFrameRate(f"ffprobe output for {path} is not JSON: {exc}") from exc
    if not streams:
        raise UnsupportedFrameRate(f"{path} has no video stream")

    leading = _parse_pts_lines(
        _run_ffprobe(
            [
                "-show_entries", "frame=pts_time",
                "-of", "csv=p=0",
                "-read_intervals", f"%+#{ORIGIN_PROBE_FRAMES}",
            ],
            path=path,
        )
    )
    try:
        return grid_from_probe(
            r_frame_rate=streams[0].get("r_frame_rate"),
            avg_frame_rate=streams[0].get("avg_frame_rate"),
            leading_pts=leading,
        )
    except UnsupportedFrameRate as exc:
        # The path is the whole diagnosis when a sweep of 40 videos rejects one.
        raise UnsupportedFrameRate(f"{path}: {exc}") from exc


def memoised_prober(
    *,
    probe: Callable[[str], SourceGrid] = probe_source_grid,
    on_probe: Callable[[str, SourceGrid], None] | None = None,
) -> Any:
    """A per-path memoised grid lookup, with the results kept on ``.cache``.

    Memoised because a corpus has many windows per video and ffprobe is not
    free; the cache is exposed so the caller can report exactly which grids the
    manifest was planned on.
    """
    cache: dict[str, SourceGrid] = {}

    def lookup(path: str) -> SourceGrid:
        if path not in cache:
            grid = probe(path)
            cache[path] = grid
            if on_probe is not None:
                on_probe(path, grid)
        return cache[path]

    lookup.cache = cache  # type: ignore[attr-defined]
    return lookup


# ─── The grid ────────────────────────────────────────────────────────────────


def _exact(value: float | int | Fraction) -> Fraction:
    """A float's decimal form, exactly. ``Fraction(2088.75)`` would carry the
    binary artefact; ``Fraction("2088.75")`` is the number that was written."""
    if isinstance(value, Fraction):
        return value
    return Fraction(str(value))


def frame_index(t: float, grid: SourceGrid) -> int:
    """The index of the source frame nearest ``t`` (ties round up)."""
    return grid.index(t)


def frame_time(index: int, grid: SourceGrid) -> float:
    """The presentation timestamp of source frame ``index``."""
    return round(float(grid.pts(index)), TIME_DECIMALS)


def selection_tolerance(grid: SourceGrid) -> float:
    """Half-width of one ``between()`` term."""
    return round(float(TOLERANCE_FRAME_FRACTION * grid.frame_interval), TIME_DECIMALS)


def _ceil_ms(value: Fraction) -> float:
    return float(Fraction(math.ceil(value * 1000), 1000))


def _floor_ms(value: Fraction) -> float:
    return float(Fraction(math.floor(value * 1000), 1000))


# ─── The plan ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SamplingPlan:
    """Everything needed to reproduce one window's ffmpeg command.

    Every field except :attr:`observed_frame_pts` is recomputable from
    ``(evidence, t0, t1, grid)``; that one is the MEASUREMENT that the grid this
    plan was computed on actually holds the frames it names.
    """

    mode: str
    grid: SourceGrid
    evidence_timestamps: tuple[float, ...]
    selected_frame_indices: tuple[int, ...]
    selected_timestamps: tuple[float, ...]
    observed_frame_pts: tuple[float, ...]
    selection_tolerance_s: float
    expected_frame_count: int
    decode_start_s: float
    decode_seek_s: float
    decode_duration_s: float
    select_expr: str

    @property
    def observed(self) -> bool:
        return len(self.observed_frame_pts) == len(self.selected_frame_indices)


def build_select_expr(indices: Sequence[int], grid: SourceGrid) -> str:
    """The full ``-vf`` value: one ``between()`` term per selected frame index.

    Each band is centred on the frame's EXACT rational PTS on the measured grid
    and is a quarter frame wide either side — computed from the rationals rather
    than from the 6-decimal reported timestamps, so the band never drifts off
    centre by a rounding step.

    ``+`` is arithmetic OR here: the terms are disjoint by construction (one
    frame apart, each a half frame wide in total), so the sum is 1 for a
    selected frame and 0 otherwise. The commas are escaped because ffmpeg's
    filtergraph parser is what reads them — this string is passed as a single
    argv token and is never handed to a shell.
    """
    tol = TOLERANCE_FRAME_FRACTION * grid.frame_interval
    terms = [
        "between(t\\,{lo}\\,{hi})".format(
            lo=f"{float(grid.pts(i) - tol):.{TIME_DECIMALS}f}",
            hi=f"{float(grid.pts(i) + tol):.{TIME_DECIMALS}f}",
        )
        for i in indices
    ]
    return "select=" + "+".join(terms)


def plan_sampling(
    *,
    evidence_timestamps: Iterable[float],
    t0: float,
    t1: float,
    grid: SourceGrid,
) -> SamplingPlan:
    """The canonical selection for one window, before it has been observed.

    Coverage bound: a source frame belongs to ``[t0, t1]`` when its PTS is
    within half a frame interval of the interval. That is the honest reading —
    a frame is a sample representing an instant, and Pass-1's own evidence times
    are themselves rounded reads of source PTS (it recorded 1539.011 for a frame
    whose true PTS is 1539.016667). The inflation is strictly under one frame,
    so a genuine neighbour lying outside the window is still clamped away.

    Fails closed rather than emitting a command that cannot capture its own
    evidence: an empty window, an evidence timestamp outside its own window, an
    evidence timestamp that precedes the source's own first frame, or an
    evidence frame that clamping would discard all raise.

    The returned plan carries no observations. :func:`observe_plan` supplies
    those, and nothing may be pinned into a manifest without them.
    """
    interval = grid.frame_interval
    half = interval / 2

    lo_bound = _exact(t0) - half
    hi_bound = _exact(t1) + half

    if _exact(t1) <= _exact(t0):
        raise SamplingImpossible(f"empty window [{t0}..{t1}]")

    evidence = sorted({float(e) for e in evidence_timestamps})
    if not evidence:
        raise SamplingImpossible("window carries no evidence timestamp to sample")

    indices: set[int] = set()
    for value in evidence:
        exact = _exact(value)
        if not (_exact(t0) <= exact <= _exact(t1)):
            raise SamplingImpossible(
                f"evidence t={value} lies outside its own window [{t0}..{t1}]"
            )
        core = grid.index(value)
        if core < 0:
            raise SamplingImpossible(
                f"evidence t={value} precedes the first source frame "
                f"(grid origin {grid.origin_s})"
            )
        core_pts = grid.pts(core)
        if not (lo_bound <= core_pts <= hi_bound):
            raise SamplingImpossible(
                f"the source frame carrying evidence t={value} (index {core}, "
                f"pts {float(core_pts):.6f}) falls outside [{t0}..{t1}]"
            )
        indices.add(core)
        for offset in NEIGHBOUR_OFFSETS:
            neighbour = core + offset
            if neighbour < 0:
                continue
            pts = grid.pts(neighbour)
            if lo_bound <= pts <= hi_bound:
                indices.add(neighbour)

    selected = tuple(sorted(indices))
    times = tuple(frame_time(i, grid) for i in selected)

    # The decode bound, sized against ffmpeg's ACTUAL input-seek semantics
    # rather than its nominal ones. Three measured facts drive it:
    #
    #   * `-ss` is counted from the input's own start, so the argv value is
    #     `decode_start - origin`, never the absolute PTS;
    #   * the landing is not guaranteed to be at or before the requested time —
    #     an accurate `-ss` may retain the frame whose interval CONTAINS the
    #     request (measured: `-ss 573.250` began at 573.233) or the first frame
    #     at or after it (measured on the offset fixture: a request landing on
    #     5.900 began at 5.908). One full frame interval of lead clears both,
    #     and matters because a window whose evidence sits on `t0` has its first
    #     selected frame AT `decode_start`;
    #   * input `-t` is counted from that landing and its end is EXCLUSIVE, so
    #     the naive "one frame past the last selected timestamp" is one frame
    #     short in the worst case — it failed that way on the two real clamped
    #     windows whose evidence sits on `t1`.
    #
    # Two intervals of tail and one of lead cost three extra decoded frames.
    first_pts = grid.pts(selected[0])
    last_pts = grid.pts(selected[-1])
    decode_start = max(
        grid.origin_s, _floor_ms(min(_exact(t0), first_pts) - interval)
    )
    decode_seek = max(0.0, _floor_ms(_exact(decode_start) - grid.origin))
    decode_duration = _ceil_ms(last_pts + 2 * interval - _exact(decode_start))

    return SamplingPlan(
        mode=SAMPLING_MODE,
        grid=grid,
        evidence_timestamps=tuple(evidence),
        selected_frame_indices=selected,
        selected_timestamps=times,
        observed_frame_pts=(),
        selection_tolerance_s=selection_tolerance(grid),
        expected_frame_count=len(selected),
        decode_start_s=decode_start,
        decode_seek_s=decode_seek,
        decode_duration_s=decode_duration,
        select_expr=build_select_expr(selected, grid),
    )


def observe_plan(
    plan: SamplingPlan, *, video_path: str, probe_frames: FramePtsProbe
) -> SamplingPlan:
    """The same plan, with the real source frames behind each band attached.

    This is the check the origin-zero model never made. Every selected band must
    contain EXACTLY ONE real source frame:

    * zero means the band names an instant this source does not present — a
      wrong rate, a wrong origin, a moved or re-encoded file — and the command
      would decode short while exiting 0;
    * two would make :attr:`expected_frame_count` unreachable in the other
      direction, since one band would supply two outputs.

    The probe is required to demonstrably SPAN the selection: if its latest
    frame falls short of the last band, "no frame matched" is indistinguishable
    from "the probe stopped early", so that is refused too.

    Raises :class:`SamplingImpossible`; the caller decides whether that refuses
    the window or the whole run.
    """
    interval = plan.grid.frame_interval
    tol = TOLERANCE_FRAME_FRACTION * interval
    pad = NEIGHBOURHOOD_PAD_FRAMES * interval

    first = plan.grid.pts(plan.selected_frame_indices[0])
    last = plan.grid.pts(plan.selected_frame_indices[-1])
    probed = tuple(sorted(probe_frames(video_path, float(first - pad), float(last + pad))))

    if not probed:
        raise SamplingImpossible(
            f"no source frames were readable in [{float(first - pad):.3f}.."
            f"{float(last + pad):.3f}]s of {video_path}"
        )
    if max(probed) < last + tol:
        raise SamplingImpossible(
            f"the frame probe of {video_path} stopped at {float(max(probed)):.6f}, short of "
            f"the last selected band ending {float(last + tol):.6f} — the neighbourhood "
            "was not demonstrably covered, so an empty band cannot be distinguished "
            "from an unread one"
        )

    observed: list[float] = []
    for index in plan.selected_frame_indices:
        centre = plan.grid.pts(index)
        hits = [p for p in probed if centre - tol <= p <= centre + tol]
        if len(hits) != 1:
            raise SamplingImpossible(
                f"source frame index {index} (pts {float(centre):.6f} on grid "
                f"{plan.grid.text}) is matched by {len(hits)} real source frame(s) in "
                f"[{float(centre - tol):.6f}..{float(centre + tol):.6f}] of {video_path}; "
                "exactly one is required"
            )
        observed.append(round(float(hits[0]), TIME_DECIMALS))

    return replace(plan, observed_frame_pts=tuple(observed))


def canonical_ffmpeg_argv(
    *, video_path: str, output_pattern: str, plan: SamplingPlan
) -> list[str]:
    """The one and only ffmpeg argv a sampling plan may be executed as.

    ``-ss`` and ``-t`` are INPUT options: they bound demuxing itself, so the
    decode stops at the window's edge whether or not a selected timestamp is
    ever matched. ``-ss`` carries :attr:`SamplingPlan.decode_seek_s`, which is
    relative to the source's own start — that is what ffmpeg counts it from.
    ``-copyts`` keeps the filter's ``t`` in the input's ABSOLUTE timeline, which
    is what makes the pinned band timestamps mean source PTS. ``-frames:v`` is
    the second, independent bound on the output side.
    """
    return [
        "ffmpeg", "-v", "error", "-y",
        "-ss", f"{plan.decode_seek_s:.{DECODE_DECIMALS}f}",
        "-t", f"{plan.decode_duration_s:.{DECODE_DECIMALS}f}",
        "-i", video_path,
        "-copyts",
        "-vf", plan.select_expr,
        "-fps_mode", "passthrough",
        "-frames:v", str(plan.expected_frame_count),
        output_pattern,
    ]


# ─── Serialisation ───────────────────────────────────────────────────────────

#: Every key a sampling block must carry. Listed so a block that is missing one
#: is reported as malformed rather than silently comparing equal on the rest.
SAMPLING_KEYS: tuple[str, ...] = (
    "mode",
    "source_frame_rate",
    "source_pts_origin_s",
    "evidence_timestamps",
    "selected_frame_indices",
    "selected_timestamps",
    "observed_frame_pts",
    "selection_tolerance_s",
    "expected_frame_count",
    "decode_start_s",
    "decode_seek_s",
    "decode_duration_s",
    "select_expr",
)


def sampling_to_dict(plan: SamplingPlan) -> dict[str, Any]:
    if not plan.observed:
        raise SamplingImpossible(
            "refusing to serialise a sampling plan that was never observed against "
            "its source — a pinned command must carry the real frame timestamps it "
            "was verified against (see observe_plan)"
        )
    return {
        "mode": plan.mode,
        "source_frame_rate": plan.grid.rate.text,
        "source_pts_origin_s": plan.grid.origin_s,
        "evidence_timestamps": list(plan.evidence_timestamps),
        "selected_frame_indices": list(plan.selected_frame_indices),
        "selected_timestamps": list(plan.selected_timestamps),
        "observed_frame_pts": list(plan.observed_frame_pts),
        "selection_tolerance_s": plan.selection_tolerance_s,
        "expected_frame_count": plan.expected_frame_count,
        "decode_start_s": plan.decode_start_s,
        "decode_seek_s": plan.decode_seek_s,
        "decode_duration_s": plan.decode_duration_s,
        "select_expr": plan.select_expr,
    }


def sampling_from_dict(doc: Any) -> SamplingPlan:
    if not isinstance(doc, dict):
        raise SamplingImpossible(f"sampling metadata must be an object, got {type(doc).__name__}")
    missing = [k for k in SAMPLING_KEYS if k not in doc]
    if missing:
        raise SamplingImpossible(f"sampling metadata missing {missing}")
    return SamplingPlan(
        mode=str(doc["mode"]),
        grid=SourceGrid(
            rate=parse_frame_rate(doc["source_frame_rate"]),
            origin=parse_origin(doc["source_pts_origin_s"]),
        ),
        evidence_timestamps=tuple(float(v) for v in doc["evidence_timestamps"]),
        selected_frame_indices=tuple(int(v) for v in doc["selected_frame_indices"]),
        selected_timestamps=tuple(float(v) for v in doc["selected_timestamps"]),
        observed_frame_pts=tuple(float(v) for v in doc["observed_frame_pts"]),
        selection_tolerance_s=float(doc["selection_tolerance_s"]),
        expected_frame_count=int(doc["expected_frame_count"]),
        decode_start_s=float(doc["decode_start_s"]),
        decode_seek_s=float(doc["decode_seek_s"]),
        decode_duration_s=float(doc["decode_duration_s"]),
        select_expr=str(doc["select_expr"]),
    )


# ─── Validation ──────────────────────────────────────────────────────────────


def _observation_problems(recorded: Any, canonical: dict[str, Any]) -> list[str]:
    """Whether the pinned measurement is internally consistent with the pinned grid.

    The executor has no video at validation time, so it cannot re-measure. What
    it CAN do — and what makes ``observed_frame_pts`` more than decoration — is
    require the recorded measurement to be one that would have been accepted:
    one value per selected frame, in order, each inside its own band. A block
    whose observations were invented to satisfy the schema has to be invented
    consistently with the grid it also pins, and the grid is what the argv is
    rebuilt from.
    """
    observed = recorded.get("observed_frame_pts")
    expected_times = canonical["selected_timestamps"]
    tolerance = canonical["selection_tolerance_s"]

    if not isinstance(observed, list) or not all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in observed
    ):
        return ["commands.sampling.observed_frame_pts: missing or not a list of numbers"]
    if len(observed) != len(expected_times):
        return [
            f"commands.sampling.observed_frame_pts: {len(observed)} measurement(s) for "
            f"{len(expected_times)} selected frame(s) — every selected band must carry "
            "the real source frame it was verified against"
        ]
    problems: list[str] = []
    if list(observed) != sorted(observed):
        problems.append(
            "commands.sampling.observed_frame_pts: not in ascending order, so it cannot "
            "correspond to the selected frames"
        )
    for i, (value, centre) in enumerate(zip(observed, expected_times)):
        if abs(float(value) - float(centre)) > tolerance:
            problems.append(
                f"commands.sampling.observed_frame_pts[{i}]: {value!r} lies outside the "
                f"±{tolerance} band around selected timestamp {centre!r} — the pinned "
                "measurement contradicts the pinned grid"
            )
    return problems


def sampling_problems(
    recorded: Any, *, evidence_timestamps: Sequence[float], t0: float, t1: float
) -> list[str]:
    """Every way a recorded sampling block fails to be this window's own.

    The check is RECOMPUTATION, not interpretation. The window's evidence, its
    bounds and the block's own declared grid (rate AND origin) are fed back
    through :func:`plan_sampling`, and the result is compared field by field.
    Nothing here parses ``select_expr`` — it is rebuilt and compared as a string,
    so a hand-written expression cannot be argued into looking equivalent, and no
    arbitrary filter syntax is ever interpreted by this validator.

    ``observed_frame_pts`` is the one field that cannot be recomputed without the
    video; it is checked for internal consistency against the grid instead.
    """
    if not isinstance(recorded, dict):
        return ["commands.sampling: missing or not an object"]

    problems: list[str] = []
    missing = [k for k in SAMPLING_KEYS if k not in recorded]
    if missing:
        return [f"commands.sampling: missing key(s) {missing}"]

    if recorded.get("mode") != SAMPLING_MODE:
        problems.append(
            f"commands.sampling.mode: {recorded.get('mode')!r} is not {SAMPLING_MODE!r}"
        )

    try:
        grid = SourceGrid(
            rate=parse_frame_rate(recorded.get("source_frame_rate")),
            origin=parse_origin(recorded.get("source_pts_origin_s")),
        )
    except UnsupportedFrameRate as exc:
        return problems + [f"commands.sampling: unusable source grid ({exc})"]

    try:
        expected = plan_sampling(
            evidence_timestamps=evidence_timestamps, t0=t0, t1=t1, grid=grid
        )
    except SamplingImpossible as exc:
        return problems + [
            f"commands.sampling: this window admits no valid selection on grid "
            f"{grid.text} ({exc})"
        ]

    canonical = sampling_to_dict(replace(expected, observed_frame_pts=expected.selected_timestamps))
    for key in SAMPLING_KEYS:
        if key in ("mode", "observed_frame_pts"):
            continue  # reported above / checked separately against the grid
        if recorded.get(key) != canonical[key]:
            problems.append(
                f"commands.sampling.{key}: {recorded.get(key)!r} does not match the "
                f"value derived from this window's evidence and bounds {canonical[key]!r}"
            )
    return problems + _observation_problems(recorded, canonical)
