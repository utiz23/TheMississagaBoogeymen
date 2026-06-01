"""WS2 Layer-3 wiring test: the orchestrator's viterbi_v2 Pass-1 loop must
actually SKIP OCR (swap in _NullOCRBackend) for gated frames and run the real
backend for non-gated frames. The proving bench only validates the decode-time
mask; this test covers the OCR-skip runtime path the bench can't reach.

RapidOCR is stubbed, so this runs without RUN_CLASSIFIER_E2E / a GPU.
"""

from __future__ import annotations

import unittest
from unittest import mock

import numpy as np

from video_ingest import pass1_classify
from video_ingest.orchestrator import _run_pass1
from video_ingest.pass1_classify import Pass1Config, SampledFrame
from video_ingest.visual_prefilter.pass1_policy import GateConfig

_BLACK_FRAME_GATE = GateConfig(
    enabled=True,
    require_all=True,
    max_brightness=0.06,
    max_edge_density=0.005,
    max_log_blur=2.0,
)


def _black_image() -> np.ndarray:
    return np.zeros((1080, 1920, 3), dtype=np.uint8)


def _high_edge_image() -> np.ndarray:
    # Bright fine checkerboard → high edge_density + high brightness → never
    # gated under the black-frame signature.
    img = np.zeros((1080, 1920, 3), dtype=np.uint8)
    img[::2, ::2] = 255
    img[1::2, 1::2] = 255
    return img


class _RecordingRapidOCR:
    """Stand-in for RapidOCRBackend. Records the mean brightness of every ROI
    it is asked to OCR (the real backend reads multiple ROIs per frame, so we
    key on brightness rather than call count: a black frame's ROIs are ~0, the
    checkerboard's are well above)."""

    name = "rapidocr_recording"
    read_means: list = []

    def __init__(self, *, use_gpu: bool = False) -> None:
        pass

    def read(self, image: np.ndarray):
        _RecordingRapidOCR.read_means.append(float(image.mean()))
        return []


def _fake_iter_sampled_frames(video_path, sample_fps, *, telemetry=None, **kwargs):
    frames = [
        SampledFrame(
            sample_index=0, source_pts=0, source_time_seconds=0.0,
            decode_order_index=0, image=_black_image(),
        ),
        SampledFrame(
            sample_index=1, source_pts=1, source_time_seconds=1.0,
            decode_order_index=1, image=_high_edge_image(),
        ),
    ]
    for f in frames:
        if telemetry is not None:
            telemetry.sampled_frame_count += 1
        yield f


class TestPass1GateWiring(unittest.TestCase):
    def setUp(self) -> None:
        _RecordingRapidOCR.read_means = []

    def _run(self, gate_cfg):
        p1cfg = Pass1Config(sample_fps=1.0, engine="viterbi_v2", pass1_gate=gate_cfg)
        with mock.patch.object(
            pass1_classify, "iter_sampled_frames", _fake_iter_sampled_frames
        ), mock.patch("game_ocr.ocr.RapidOCRBackend", _RecordingRapidOCR):
            cls_list, segments, decoder_version, telem = _run_pass1(
                video_path=None,  # unused: iter_sampled_frames is stubbed
                classifier_legacy=None,  # unused in viterbi_v2 branch
                p1cfg=p1cfg,
                version="nhl26",
                use_gpu=False,
            )
        return cls_list, telem

    def test_gated_frame_skips_ocr(self) -> None:
        cls_list, telem = self._run(_BLACK_FRAME_GATE)
        # Black frame gated → RapidOCR ran, but NEVER on the black frame's
        # ~0-mean ROIs (those went to the null backend).
        self.assertGreater(len(_RecordingRapidOCR.read_means), 0)
        self.assertTrue(all(m > 1.0 for m in _RecordingRapidOCR.read_means))
        self.assertEqual(telem.frames_gated, 1)
        self.assertEqual(telem.sampled_frame_count, 2)

    def test_gate_disabled_ocrs_every_frame(self) -> None:
        cls_list, telem = self._run(None)
        # No gate → both frames OCR'd, including the black frame's ~0-mean ROIs.
        self.assertEqual(telem.frames_gated, 0)
        self.assertTrue(any(m < 1.0 for m in _RecordingRapidOCR.read_means))


if __name__ == "__main__":
    unittest.main()
