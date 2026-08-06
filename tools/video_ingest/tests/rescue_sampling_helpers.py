"""Shared test doubles for the rescue sampling contract.

``build_commands`` now takes a measured :class:`SourceGrid` AND a frame probe,
because a command may only be pinned after the real source frames behind every
selected band have been measured. Tests that are not about the probe still have
to supply one, so it lives here rather than being re-implemented (differently)
in three test modules.

The double models a PERFECT source: one that presents exactly ``origin + n *
interval``, forever. Real container quantisation, empty bands and ambiguous
bands are exercised against real files in ``test_rescue_sampling.py``.
"""

from __future__ import annotations

import math
from fractions import Fraction

from video_ingest.rescue_sampling import SourceFrameRate, SourceGrid

FPS60 = SourceFrameRate(60, 1)

#: The grid the whole live corpus actually has: 60 fps starting at zero.
GRID60 = SourceGrid(rate=FPS60, origin=Fraction(0))

#: A constant-rate grid whose origin is HALF A FRAME off zero — the shape that
#: the origin-zero model gets silently wrong.
GRID60_OFFSET = SourceGrid(rate=FPS60, origin=Fraction("5.008"))


def ideal_probe(grid: SourceGrid = GRID60):
    """A frame probe for a source that is exactly on ``grid``."""

    def probe(path: str, start: float, end: float) -> tuple[Fraction, ...]:
        lo = math.ceil((Fraction(str(start)) - grid.origin) / grid.frame_interval)
        hi = math.floor((Fraction(str(end)) - grid.origin) / grid.frame_interval)
        return tuple(grid.pts(i) for i in range(max(0, lo), hi + 1))

    return probe


IDEAL_PROBE = ideal_probe(GRID60)
