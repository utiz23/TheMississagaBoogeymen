"""Tests for pass2.loadout_engine dispatch flag (Task 2A-10).

Verifies that:
  - The default engine ('legacy') keeps the existing pass-through path and
    does NOT write loadout_evidence.json.
  - The 'typed_v1' engine calls extract_loadout_evidence() and writes
    loadout_evidence.json to the segment directory.
  - An unknown engine name raises ValueError with the offending name in the
    message.
  - Explicitly setting loadout_engine: 'legacy' produces identical behaviour
    to the default (no file, legacy path invoked).

Pass-2 frame extraction (ffmpeg) is stubbed throughout so the tests run
without a real video file.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from video_ingest.pass1_classify import Segment
from video_ingest.pass2_extract import Pass2Config, extract_segments
import video_ingest.pass2_extract as pass2_module


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_loadout_segment() -> Segment:
    return Segment(
        start_index=0,
        end_index=4,
        start_seconds=5.0,
        end_seconds=10.0,
        screen_type="player_loadout_view",
        frame_count=5,
        mean_color_score=0.85,
    )


def _fake_ffmpeg(video_path, out_dir, start_seconds, end_seconds, fps):
    """Stub: creates one fake PNG so the segment dir is non-empty."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "00001.png").write_bytes(b"PNG")
    return 1


def _fake_field_evidence_records():
    """Return a minimal synthetic list of FieldEvidenceRecord dicts for
    testing JSON serialization without touching real extractors."""
    from game_ocr.loadout_evidence import FieldEvidenceRecord

    return [
        FieldEvidenceRecord(
            screen_state="player_loadout_view",
            field_key="gamertag",
            field_family="open_text",
            candidate_value="TestPlayer",
            candidate_rank=0,
            raw_confidence=0.9,
            calibrated_confidence=0.9,
            extractor_family="open_text",
            extractor_version="loadout-evidence-v1",
            observability_status="observable",
            normalization_status="normalized",
        )
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class DefaultEngineIsLegacyTest(unittest.TestCase):
    """test_default_engine_is_legacy: when loadout_engine is not set in the
    config (defaults to 'legacy'), no loadout_evidence.json is written."""

    def setUp(self) -> None:
        self._orig_ffmpeg = pass2_module._ffmpeg_extract
        pass2_module._ffmpeg_extract = _fake_ffmpeg

    def tearDown(self) -> None:
        pass2_module._ffmpeg_extract = self._orig_ffmpeg

    def test_default_engine_is_legacy(self, tmp_path: Path = None) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            pass2_root = tmp_path / "pass2"

            seg = _make_loadout_segment()
            # No loadout_engine in config — default is 'legacy'.
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"player_loadout_view": 1.0},
                extract_screens={"player_loadout_view"},
                # loadout_engine not set → defaults to 'legacy'
            )

            results = extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[seg],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=30.0,
                version="nhl26",
                segments_hash="sha256:test",
            )

            self.assertEqual(len(results), 1)
            seg_dir = results[0].directory
            evidence_path = seg_dir / "loadout_evidence.json"
            self.assertFalse(
                evidence_path.exists(),
                f"loadout_evidence.json must NOT exist for default (legacy) engine, "
                f"but found {evidence_path}",
            )


class TypedV1EngineWritesJsonTest(unittest.TestCase):
    """test_typed_v1_engine_writes_loadout_evidence_json: when
    loadout_engine='typed_v1', the extract step writes loadout_evidence.json
    to the segment directory."""

    def setUp(self) -> None:
        self._orig_ffmpeg = pass2_module._ffmpeg_extract
        pass2_module._ffmpeg_extract = _fake_ffmpeg

    def tearDown(self) -> None:
        pass2_module._ffmpeg_extract = self._orig_ffmpeg

    def test_typed_v1_engine_writes_loadout_evidence_json(self) -> None:
        import tempfile

        fake_records = _fake_field_evidence_records()

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            pass2_root = tmp_path / "pass2"

            seg = _make_loadout_segment()
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"player_loadout_view": 1.0},
                extract_screens={"player_loadout_view"},
                loadout_engine="typed_v1",
            )

            with patch(
                "video_ingest.pass2_extract.extract_loadout_evidence",
                return_value=fake_records,
            ) as mock_extract:
                results = extract_segments(
                    video_path=Path("/fake/video.mkv"),
                    segments=[seg],
                    config=cfg,
                    pass2_root=pass2_root,
                    video_duration_seconds=30.0,
                    version="nhl26",
                    segments_hash="sha256:test",
                )

            self.assertEqual(len(results), 1)
            seg_dir = results[0].directory
            evidence_path = seg_dir / "loadout_evidence.json"
            self.assertTrue(
                evidence_path.exists(),
                f"loadout_evidence.json must exist when loadout_engine='typed_v1', "
                f"but not found at {evidence_path}",
            )

            # Verify JSON content is the serialized records.
            data = json.loads(evidence_path.read_text())
            self.assertIsInstance(data, list)
            self.assertEqual(len(data), len(fake_records))
            self.assertEqual(data[0]["field_key"], "gamertag")
            self.assertEqual(data[0]["screen_state"], "player_loadout_view")

            # Verify extract_loadout_evidence was called with the right args.
            mock_extract.assert_called_once()
            call_kwargs = mock_extract.call_args
            self.assertEqual(call_kwargs.kwargs["segment_index"], 0)


class UnknownEngineRaisesValueErrorTest(unittest.TestCase):
    """test_unknown_loadout_engine_raises_value_error: an unrecognised
    loadout_engine value raises ValueError with the name in the message."""

    def setUp(self) -> None:
        self._orig_ffmpeg = pass2_module._ffmpeg_extract
        pass2_module._ffmpeg_extract = _fake_ffmpeg

    def tearDown(self) -> None:
        pass2_module._ffmpeg_extract = self._orig_ffmpeg

    def test_unknown_loadout_engine_raises_value_error(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            pass2_root = tmp_path / "pass2"

            seg = _make_loadout_segment()
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"player_loadout_view": 1.0},
                extract_screens={"player_loadout_view"},
                loadout_engine="bogus",
            )

            with self.assertRaises(ValueError) as ctx:
                extract_segments(
                    video_path=Path("/fake/video.mkv"),
                    segments=[seg],
                    config=cfg,
                    pass2_root=pass2_root,
                    video_duration_seconds=30.0,
                    version="nhl26",
                    segments_hash="sha256:test",
                )

            self.assertIn(
                "bogus",
                str(ctx.exception),
                f"ValueError message must contain the engine name 'bogus'; got: {ctx.exception}",
            )


class LegacyExplicitMatchesDefaultTest(unittest.TestCase):
    """test_legacy_path_unchanged_when_typed_v1_disabled: explicit
    loadout_engine='legacy' must be identical to the default — no
    loadout_evidence.json, same pass-through behaviour."""

    def setUp(self) -> None:
        self._orig_ffmpeg = pass2_module._ffmpeg_extract
        pass2_module._ffmpeg_extract = _fake_ffmpeg

    def tearDown(self) -> None:
        pass2_module._ffmpeg_extract = self._orig_ffmpeg

    def test_legacy_explicit_matches_default(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            seg = _make_loadout_segment()

            def _run(loadout_engine_kwarg: dict) -> Path:
                pass2_root = tmp_path / f"pass2_{loadout_engine_kwarg.get('loadout_engine', 'default')}"
                cfg = Pass2Config(
                    window_padding_seconds=0.0,
                    sample_rates={"player_loadout_view": 1.0},
                    extract_screens={"player_loadout_view"},
                    **loadout_engine_kwarg,
                )
                results = extract_segments(
                    video_path=Path("/fake/video.mkv"),
                    segments=[seg],
                    config=cfg,
                    pass2_root=pass2_root,
                    video_duration_seconds=30.0,
                    version="nhl26",
                    segments_hash="sha256:test",
                )
                return results[0].directory

            dir_default = _run({})
            dir_explicit = _run({"loadout_engine": "legacy"})

            # Neither should have written loadout_evidence.json.
            self.assertFalse(
                (dir_default / "loadout_evidence.json").exists(),
                "default engine must not write loadout_evidence.json",
            )
            self.assertFalse(
                (dir_explicit / "loadout_evidence.json").exists(),
                "explicit legacy engine must not write loadout_evidence.json",
            )


if __name__ == "__main__":
    unittest.main()
