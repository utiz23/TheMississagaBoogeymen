"""Tests for `FilteredFrameProvider` — visual-prefilter Phase 2 wrapper.

Contract:
  - inner provider iterated exactly once
  - yields only selector-picked frames in original order
  - preserves inner provider's frame_index (no renumbering)
  - de-duplicates selector output and sorts ascending
  - rejects out-of-range and non-integer selector returns
  - empty inner / empty selector return → no yields
"""

from __future__ import annotations

import unittest
from typing import Iterator

import numpy as np

from video_ingest.frame_provider import (
    FilteredFrameProvider,
    FrameProvider,
    FrameRecord,
)


class _ListProvider(FrameProvider):
    """Trivial provider wrapping a pre-built list. Tracks iteration count
    so tests can assert single-pass behavior."""

    def __init__(self, records: list[FrameRecord]) -> None:
        self._records = records
        self.iter_call_count = 0

    def iter_frames(self) -> Iterator[FrameRecord]:
        self.iter_call_count += 1
        for r in self._records:
            yield r


def _records(n: int) -> list[FrameRecord]:
    return [
        FrameRecord(
            image=np.zeros((4, 4, 3), dtype=np.uint8),
            source_time_seconds=float(i),
            source_pts=i,
            frame_index=i,
        )
        for i in range(n)
    ]


class TestSelectorBasic(unittest.TestCase):
    def test_yields_only_picked_frames(self) -> None:
        inner = _ListProvider(_records(5))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [1, 3])
        out = list(wrapper.iter_frames())
        self.assertEqual([r.frame_index for r in out], [1, 3])

    def test_empty_inner_yields_empty(self) -> None:
        inner = _ListProvider([])
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [0, 1])
        self.assertEqual(list(wrapper.iter_frames()), [])

    def test_empty_selector_yields_empty(self) -> None:
        inner = _ListProvider(_records(5))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [])
        self.assertEqual(list(wrapper.iter_frames()), [])


class TestInnerIteratedOnce(unittest.TestCase):
    def test_iter_frames_consumes_inner_exactly_once(self) -> None:
        inner = _ListProvider(_records(3))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [0, 2])
        list(wrapper.iter_frames())
        self.assertEqual(inner.iter_call_count, 1)


class TestPreservesFrameIndex(unittest.TestCase):
    def test_yielded_records_carry_inner_frame_index(self) -> None:
        inner = _ListProvider(_records(6))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [0, 4])
        out = list(wrapper.iter_frames())
        # No renumbering: frame_index matches inner provider's emit ordinal.
        self.assertEqual(out[0].frame_index, 0)
        self.assertEqual(out[1].frame_index, 4)


class TestSelectorNormalization(unittest.TestCase):
    def test_duplicate_indices_collapsed(self) -> None:
        inner = _ListProvider(_records(3))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [1, 1, 2, 1])
        out = list(wrapper.iter_frames())
        self.assertEqual([r.frame_index for r in out], [1, 2])

    def test_unsorted_indices_yield_in_ascending_order(self) -> None:
        inner = _ListProvider(_records(4))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [3, 0, 2])
        out = list(wrapper.iter_frames())
        self.assertEqual([r.frame_index for r in out], [0, 2, 3])

    def test_accepts_numpy_integer_indices(self) -> None:
        inner = _ListProvider(_records(3))
        wrapper = FilteredFrameProvider(
            inner, selector=lambda rs: [np.int64(0), np.int64(2)]
        )
        out = list(wrapper.iter_frames())
        self.assertEqual([r.frame_index for r in out], [0, 2])


class TestSelectorValidation(unittest.TestCase):
    def test_out_of_range_index_raises(self) -> None:
        inner = _ListProvider(_records(3))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [0, 99])
        with self.assertRaises(ValueError):
            list(wrapper.iter_frames())

    def test_negative_index_raises(self) -> None:
        inner = _ListProvider(_records(3))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [-1, 0])
        with self.assertRaises(ValueError):
            list(wrapper.iter_frames())

    def test_non_integer_index_raises(self) -> None:
        inner = _ListProvider(_records(3))
        wrapper = FilteredFrameProvider(inner, selector=lambda rs: [0, "1"])
        with self.assertRaises(ValueError):
            list(wrapper.iter_frames())


class TestSelectorSeesRecords(unittest.TestCase):
    def test_selector_receives_inner_records(self) -> None:
        captured: list[list[FrameRecord]] = []

        def spy_selector(rs: list[FrameRecord]) -> list[int]:
            captured.append(rs)
            return [0]

        inner = _ListProvider(_records(3))
        wrapper = FilteredFrameProvider(inner, selector=spy_selector)
        list(wrapper.iter_frames())
        self.assertEqual(len(captured), 1)
        self.assertEqual(len(captured[0]), 3)
        self.assertEqual([r.frame_index for r in captured[0]], [0, 1, 2])


if __name__ == "__main__":
    unittest.main()
