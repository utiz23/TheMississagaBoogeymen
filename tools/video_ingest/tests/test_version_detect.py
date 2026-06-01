"""WS3: version-detection evidence capture + fail-closed preservation.

These tests stub frame decode and OCR so they run without a real video or
GPU. They assert the additive WS3 delta — per-frame audit evidence on
VersionGuess — and confirm the existing fail-closed `unknown_version`
behavior is preserved (a foreign clip with no NHL anchors must NOT be
guessed into a known version).

Note: robust NHL-26-vs-27 *visual* discrimination (the plan's "resolves a
gameplay-only known-version clip" case) is gated on version-specific visual
references (NHL 27 anchors / centroid reconciliation) and is intentionally
NOT implemented here; see HANDOFF.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import numpy as np
import pytest

from video_ingest import version_detect
from video_ingest.version_detect import UNKNOWN_VERSION, detect_version


class _FakeLine:
    def __init__(self, text: str) -> None:
        self.text = text


class _FakeOCR:
    """Returns a fixed set of OCR lines regardless of the ROI passed in.
    The text is supplied per-test via the class attribute `_lines`."""

    _lines: list[str] = []

    def __init__(self, *args, **kwargs) -> None:  # noqa: D401 — match real ctor
        pass

    def read(self, _image):
        return [_FakeLine(t) for t in type(self)._lines]


def _install_fake_ocr(monkeypatch: pytest.MonkeyPatch, lines: list[str]) -> None:
    """Patch game_ocr.ocr.RapidOCRBackend (detect_version imports it lazily
    from there at call time) with a fake returning `lines`."""
    # Ensure game_ocr is importable the same way detect_version arranges it.
    repo_root = Path(version_detect.__file__).resolve().parents[3]
    sys.path.insert(0, str(repo_root / "tools" / "game_ocr"))
    import game_ocr.ocr as ocr_mod

    fake_cls = type("_FakeOCR", (_FakeOCR,), {"_lines": list(lines)})
    monkeypatch.setattr(ocr_mod, "RapidOCRBackend", fake_cls)


def _install_fake_frames(
    monkeypatch: pytest.MonkeyPatch, n: int, *, empty: bool = False
) -> None:
    """Patch _grab_frames to return `n` synthetic (ts, frame) pairs (or none
    when `empty`), avoiding any ffmpeg/video dependency."""
    def _fake(_video, timestamps, width=1920, height=1080):
        if empty:
            return []
        # small black frames — compute_visual_signals runs on these for real
        return [
            (float(ts), np.zeros((64, 64, 3), dtype=np.uint8))
            for ts in timestamps[:n]
        ]

    monkeypatch.setattr(version_detect, "_grab_frames", _fake)


def test_known_version_resolves_and_captures_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A clip whose sampled frames OCR the NHL 26 menu anchors resolves to
    nhl26 AND attaches one FrameEvidence per decoded frame (with the OCR text
    the matcher saw + finite visual signals)."""
    _install_fake_frames(monkeypatch, n=3)
    _install_fake_ocr(monkeypatch, ["WORLD OF CHEL", "LOADOUTS", "REWARDS"])

    guess = detect_version(
        Path("/nonexistent.mkv"),
        duration_seconds=600.0,
        sample_count=3,
        use_gpu=False,
    )

    assert guess.version == "nhl26"
    assert guess.confidence >= 0.20
    assert len(guess.frame_evidence) == 3
    ev = guess.frame_evidence[0]
    assert "world of chel" in ev.ocr_text
    # visual signals are finite numbers (computed on the synthetic frame)
    assert np.isfinite(ev.brightness)
    assert np.isfinite(ev.edge_density)
    assert np.isfinite(ev.log_blur)


def test_foreign_clip_fails_closed_with_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A clip with NO NHL anchors must return unknown_version (fail-closed,
    not guessed into a known version) — and STILL capture the per-frame OCR
    text so an operator can see exactly what was rejected."""
    _install_fake_frames(monkeypatch, n=2)
    _install_fake_ocr(monkeypatch, ["TOTALLY UNRELATED MENU", "PRESS START"])

    guess = detect_version(
        Path("/nonexistent.mkv"),
        duration_seconds=600.0,
        sample_count=2,
        use_gpu=False,
    )

    assert guess.version == UNKNOWN_VERSION
    assert len(guess.frame_evidence) == 2
    assert "totally unrelated menu" in guess.frame_evidence[0].ocr_text


def test_no_decoded_frames_returns_unknown_with_empty_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When no frame decodes, detection bails to unknown_version with empty
    evidence (and does not crash on the missing OCR pass)."""
    _install_fake_frames(monkeypatch, n=0, empty=True)
    # OCR is never constructed on the empty path, but patch it anyway so a
    # regression that DID construct it wouldn't hit the real GPU backend.
    _install_fake_ocr(monkeypatch, [])

    guess = detect_version(
        Path("/nonexistent.mkv"),
        duration_seconds=600.0,
        sample_count=3,
        use_gpu=False,
    )

    assert guess.version == UNKNOWN_VERSION
    assert guess.frame_evidence == ()
