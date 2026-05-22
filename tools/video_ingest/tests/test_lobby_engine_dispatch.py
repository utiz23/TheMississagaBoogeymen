"""Pass-2 lobby_engine dispatch tests.

Mirrors the loadout_engine dispatch coverage. Verifies that
`extract_segments` calls `_run_typed_v1_lobby` for
`pre_game_lobby_state_2` segments when `lobby_engine='typed_v1'`, and
skips that branch when `'legacy'`.

Also verifies that `_run_typed_v1_lobby` lazy-imports the extractor and
writes `lobby_evidence.json`.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import video_ingest.pass2_extract as pass2_extract
from video_ingest.pass1_classify import Segment
from video_ingest.pass2_extract import Pass2Config, extract_segments


def _segment(screen_type: str, *, start_index: int = 7, end_index: int = 15) -> Segment:
    return Segment(
        start_index=start_index,
        end_index=end_index,
        start_seconds=float(start_index),
        end_seconds=float(end_index + 1),
        screen_type=screen_type,
        frame_count=end_index - start_index + 1,
        mean_color_score=0.95,
    )


def _config(*, lobby_engine: str = "legacy") -> Pass2Config:
    return Pass2Config(
        window_padding_seconds=0.0,
        sample_rates={"pre_game_lobby_state_2": 1.0, "player_loadout_view": 1.0},
        extract_screens={"pre_game_lobby_state_2", "player_loadout_view"},
        loadout_engine="legacy",
        lobby_engine=lobby_engine,
    )


class LobbyEngineDispatchTests(unittest.TestCase):
    def test_typed_v1_runs_typed_lobby(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            video = tmp_path / "fake.mkv"
            video.write_bytes(b"")
            pass2_root = tmp_path / "pass2"

            calls: list[Path] = []

            def fake_typed_lobby(seg_dir: Path, *, segment_index: int) -> None:
                calls.append(seg_dir)

            def fake_ffmpeg(video_path, out_dir, start, end, fps):
                out_dir.mkdir(parents=True, exist_ok=True)
                return 1

            with patch.object(pass2_extract, "_run_typed_v1_lobby", side_effect=fake_typed_lobby), \
                 patch.object(pass2_extract, "_ffmpeg_extract", side_effect=fake_ffmpeg), \
                 patch.object(pass2_extract, "write_pass2_manifest"):
                extract_segments(
                    video,
                    [_segment("pre_game_lobby_state_2")],
                    _config(lobby_engine="typed_v1"),
                    pass2_root,
                    version="nhl26",
                    segments_hash="x" * 64,
                )
            self.assertEqual(len(calls), 1)

    def test_legacy_does_not_run_typed_lobby(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            video = tmp_path / "fake.mkv"
            video.write_bytes(b"")
            pass2_root = tmp_path / "pass2"
            calls: list[Path] = []

            def fake_typed_lobby(seg_dir: Path, *, segment_index: int) -> None:
                calls.append(seg_dir)

            def fake_ffmpeg(video_path, out_dir, start, end, fps):
                out_dir.mkdir(parents=True, exist_ok=True)
                return 1

            with patch.object(pass2_extract, "_run_typed_v1_lobby", side_effect=fake_typed_lobby), \
                 patch.object(pass2_extract, "_ffmpeg_extract", side_effect=fake_ffmpeg), \
                 patch.object(pass2_extract, "write_pass2_manifest"):
                extract_segments(
                    video,
                    [_segment("pre_game_lobby_state_2")],
                    _config(lobby_engine="legacy"),
                    pass2_root,
                    version="nhl26",
                    segments_hash="x" * 64,
                )
            self.assertEqual(len(calls), 0)

    def test_unknown_lobby_engine_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            video = tmp_path / "fake.mkv"
            video.write_bytes(b"")
            pass2_root = tmp_path / "pass2"

            def fake_ffmpeg(video_path, out_dir, start, end, fps):
                out_dir.mkdir(parents=True, exist_ok=True)
                return 1

            with patch.object(pass2_extract, "_ffmpeg_extract", side_effect=fake_ffmpeg), \
                 patch.object(pass2_extract, "write_pass2_manifest"):
                with self.assertRaises(ValueError):
                    extract_segments(
                        video,
                        [_segment("pre_game_lobby_state_2")],
                        _config(lobby_engine="unknown"),
                        pass2_root,
                        version="nhl26",
                        segments_hash="x" * 64,
                    )

    def test_run_typed_v1_lobby_writes_evidence_json(self) -> None:
        """The internal _run_typed_v1_lobby wrapper lazily imports the extractor,
        invokes it, and writes lobby_evidence.json. We patch the extractor at
        module scope so the test doesn't need real OCR."""
        from game_ocr.loadout_evidence import FieldEvidenceRecord

        with tempfile.TemporaryDirectory() as tmp:
            seg_dir = Path(tmp)
            (seg_dir / "00001.png").write_bytes(b"")

            sample_record = FieldEvidenceRecord(
                screen_state="pre_game_lobby_state_2",
                field_key="position",
                field_family="closed_vocab",
                candidate_value="C",
                candidate_rank=0,
                raw_confidence=0.9,
                calibrated_confidence=0.9,
                extractor_family="closed_vocab",
                extractor_version="lobby-evidence-v1",
                observability_status="observable",
                normalization_status="normalized",
                subject_slot_key="lobby_for_C",
                support_frame_ids=(42,),
            )

            def fake_extract(*, bundle_dir, segment_index):
                return [sample_record]

            # Patch the lazy-import sentinel directly.
            with patch.object(pass2_extract, "extract_lobby_evidence", new=fake_extract):
                pass2_extract._run_typed_v1_lobby(seg_dir, segment_index=42)

            out = seg_dir / "lobby_evidence.json"
            self.assertTrue(out.exists())
            data = json.loads(out.read_text())
            self.assertIsInstance(data, list)
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["field_key"], "position")
            self.assertEqual(data[0]["subject_slot_key"], "lobby_for_C")


if __name__ == "__main__":
    unittest.main()
