"""Integration test for the Phase 3b C4 gating behavior.

Verifies that running ``extract_segments`` over the same synthetic source
twice — once with ``artifact_mode=True`` and once with ``artifact_mode=False``
— yields:

  1. PNG files only in the True (legacy) mode and zero PNGs in the False
     (in-memory) mode (for typed_v1 segments).
  2. A structurally identical ``loadout_evidence.json`` between modes.

The structural-parity check rides on top of Phase 3a's
``TestPngVsInMemoryParity`` (in ``test_frame_provider.py``), which already
proves that ``PngFrameProvider`` and ``InMemoryFrameProvider`` emit frames
in agreeing order with matching ``frame_index`` sequences. C4's job is to
prove the dispatch glue inside ``extract_segments`` actually produces the
same evidence records regardless of which provider was used.

Run:
    PYTHONPATH=tools/game_ocr:tools/video_ingest \
        python3 -m pytest tools/video_ingest/tests/test_pass2_artifact_mode_gating.py -v
"""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from video_ingest.pass1_classify import Segment
from video_ingest.pass2_extract import Pass2Config, extract_segments
from video_ingest import pass2_extract as p2_module


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _pyav_available() -> bool:
    try:
        import av  # noqa: F401
        return True
    except ImportError:
        return False


def _synthesize_cfr(out_path: Path, duration_s: int, fps: int) -> None:
    """A tiny CFR video — 192x108 black frames — so ``InMemoryFrameProvider``'s
    PyAV decode path has a real container to read."""
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi",
        "-i", f"color=color=black:size=192x108:rate={fps}:duration={duration_s}",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _loadout_segment(start: float, end: float, fps: int) -> Segment:
    return Segment(
        start_index=int(start),
        end_index=int(end),
        start_seconds=start,
        end_seconds=end,
        screen_type="player_loadout_view",
        frame_count=int((end - start) * fps),
        mean_color_score=0.95,
    )


def _config(artifact_mode: bool, fps: float = 4.0) -> Pass2Config:
    return Pass2Config(
        window_padding_seconds=0.0,
        sample_rates={"player_loadout_view": fps},
        extract_screens={"player_loadout_view"},
        loadout_engine="typed_v1",
        artifact_mode=artifact_mode,
    )


@unittest.skipUnless(_ffmpeg_available() and _pyav_available(),
                     "needs ffmpeg + PyAV")
class TestPass2ArtifactModeGating(unittest.TestCase):
    """C4 gating: PNG side-effect inverts on artifact_mode, evidence is identical."""

    @staticmethod
    def _stub_extractor(records, frame_count, captured):
        """Build a patched ``extract_loadout_evidence`` that records how it
        was called (provider class, frame count) and returns the same canned
        records both times so the parity check can compare what extract_segments
        wrote, not what the extractor returned."""
        def _stub(*, frame_provider, segment_index):
            captured.append({
                "provider_class": frame_provider.__class__.__name__,
                "frame_count_observed": len(list(frame_provider.iter_frames())),
            })
            return records, frame_count
        return _stub

    def test_no_pass2_artifacts_skips_ffmpeg_and_emits_identical_evidence(self) -> None:
        """artifact_mode=False under typed_v1 must:
          - skip _ffmpeg_extract (no PNGs land in seg_dir),
          - drive extract_loadout_evidence via InMemoryFrameProvider,
          - write a loadout_evidence.json structurally identical to artifact_mode=True.
        """
        from game_ocr.loadout_evidence import FieldEvidenceRecord

        # A canned non-empty record list so we can assert evidence JSON parity
        # without depending on the extractor's behavior on a blank synthetic
        # video (which has no OCR-readable content).
        canned_records = [
            FieldEvidenceRecord(
                screen_state="player_loadout_view",
                field_key="gamertag",
                field_family="open_text",
                candidate_value="TestPlayer",
                candidate_rank=0,
                raw_confidence=0.9,
                calibrated_confidence=0.9,
                extractor_family="open_text",
                extractor_version="loadout-evidence-v2",
                observability_status="observable",
                normalization_status="normalized",
                subject_slot_key="loadout_slot_seg0000_subject00",
                support_frame_ids=(0,),
            ),
        ]

        with TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            video = tmp / "cfr.mp4"
            _synthesize_cfr(video, duration_s=3, fps=30)

            # One typed_v1 loadout segment spanning the full synthetic video.
            seg = _loadout_segment(0.0, 3.0, fps=30)

            # Same segment, twice, into separate roots.
            png_root = tmp / "pass2_png"
            mem_root = tmp / "pass2_mem"

            png_captured: list[dict] = []
            mem_captured: list[dict] = []

            with mock.patch.object(
                p2_module,
                "extract_loadout_evidence",
                side_effect=self._stub_extractor(
                    canned_records, frame_count=12, captured=png_captured,
                ),
            ):
                png_results = extract_segments(
                    video_path=video,
                    segments=[seg],
                    config=_config(artifact_mode=True),
                    pass2_root=png_root,
                    version="nhl26",
                    segments_hash="x" * 64,
                )

            with mock.patch.object(
                p2_module,
                "extract_loadout_evidence",
                side_effect=self._stub_extractor(
                    canned_records, frame_count=12, captured=mem_captured,
                ),
            ):
                mem_results = extract_segments(
                    video_path=video,
                    segments=[seg],
                    config=_config(artifact_mode=False),
                    pass2_root=mem_root,
                    version="nhl26",
                    segments_hash="x" * 64,
                )

            # --- 1. Provider type inversion -----------------------------------
            self.assertEqual(len(png_captured), 1)
            self.assertEqual(len(mem_captured), 1)
            self.assertEqual(png_captured[0]["provider_class"], "PngFrameProvider")
            self.assertEqual(mem_captured[0]["provider_class"], "InMemoryFrameProvider")

            # --- 2. PNG side-effect inversion ---------------------------------
            png_seg_dir = png_results[0].directory
            mem_seg_dir = mem_results[0].directory
            png_files_legacy = sorted(png_seg_dir.glob("[0-9]*.png"))
            png_files_memory = sorted(mem_seg_dir.glob("[0-9]*.png"))
            self.assertGreater(
                len(png_files_legacy), 0,
                "artifact_mode=True must materialize PNGs to disk",
            )
            self.assertEqual(
                len(png_files_memory), 0,
                "artifact_mode=False must skip PNG writes for typed_v1 segments; "
                f"found {len(png_files_memory)} unexpected PNG(s)",
            )

            # --- 3. loadout_evidence.json parity ------------------------------
            legacy_json = json.loads((png_seg_dir / "loadout_evidence.json").read_text())
            memory_json = json.loads((mem_seg_dir / "loadout_evidence.json").read_text())
            self.assertEqual(
                legacy_json, memory_json,
                "loadout_evidence.json must be byte-identical between modes",
            )

            # --- 4. Pass2Result.frame_count populated in BOTH modes ----------
            self.assertEqual(png_results[0].frame_count, 12)
            self.assertEqual(
                mem_results[0].frame_count, 12,
                "frame_count must come from the typed_v1 extractor's "
                "(records, frame_count) return tuple when ffmpeg is skipped",
            )


if __name__ == "__main__":
    unittest.main()
