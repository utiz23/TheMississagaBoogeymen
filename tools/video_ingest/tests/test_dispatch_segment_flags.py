"""Smoke test for Phase 0 evidence-layer wiring in dispatch.py.

Verifies that `dispatch_segments` invokes `ingest-ocr-cli` with the new
flags that populate `ocr_segments` rows with rich Pass-1 metadata:
  --video-segment-index, --video-segment-start-sec, --video-segment-end-sec,
  --ui-version.

These flags drive the segment_key + time bounds on the worker side, so
losing them silently would make video-pipeline ingests degrade to the
fallback `batch-${batchId}` segment_key. This test catches that regression.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from unittest.mock import patch

from video_ingest.dispatch import dispatch_segments
from video_ingest.pass1_classify import Segment
from video_ingest.pass2_extract import Pass2Result


@dataclass
class _FakeProc:
    returncode: int = 0
    stdout: str = ""
    stderr: str = ""


def _make_results(directory: Path) -> Iterable[Pass2Result]:
    seg = Segment(
        start_index=12,
        end_index=42,
        start_seconds=12.5,
        end_seconds=42.125,
        screen_type="post_game_player_summary",
        frame_count=30,
        mean_color_score=0.95,
    )
    yield Pass2Result(
        segment_index=7,
        segment=seg,
        directory=directory,
        frame_count=30,
        sample_fps=1.0,
        start_seconds=12.5,
        end_seconds=42.125,
    )


def test_dispatch_segments_passes_phase0_segment_flags(tmp_path: Path) -> None:
    seg_dir = tmp_path / "seg-007-post_game_player_summary"
    seg_dir.mkdir()
    repo_root = tmp_path / "repo"
    (repo_root / "pnpm-workspace.yaml").parent.mkdir(parents=True, exist_ok=True)
    (repo_root).mkdir(exist_ok=True)
    (repo_root / "pnpm-workspace.yaml").write_text("")

    captured: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs):  # type: ignore[no-untyped-def]
        captured.append(cmd)
        return _FakeProc(returncode=0, stdout="", stderr="")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        results = list(_make_results(seg_dir))
        out = dispatch_segments(
            results,
            game_title_id=1,
            match_id=250,
            video_sha256="a" * 64,
            ui_version="nhl26",
            repo_root=repo_root,
            dry_run=True,
        )

    assert len(out) == 1, "one segment → one dispatch"
    assert len(captured) == 1, "subprocess.run called once"
    cmd = captured[0]

    # Required Phase-0 evidence-layer flags must be present with correct values.
    assert "--video-segment-index" in cmd, f"missing --video-segment-index in {cmd}"
    assert cmd[cmd.index("--video-segment-index") + 1] == "7"
    assert "--video-segment-start-sec" in cmd
    assert cmd[cmd.index("--video-segment-start-sec") + 1] == "12.500"
    assert "--video-segment-end-sec" in cmd
    assert cmd[cmd.index("--video-segment-end-sec") + 1] == "42.125"
    assert "--ui-version" in cmd
    assert cmd[cmd.index("--ui-version") + 1] == "nhl26"
    # Existing required flags survive the change.
    assert "--video-sha256" in cmd
    assert cmd[cmd.index("--video-sha256") + 1] == "a" * 64
    assert "--match-id" in cmd
    assert cmd[cmd.index("--match-id") + 1] == "250"


def test_dispatch_passes_decoder_version_flag(monkeypatch, tmp_path):
    """Phase 1: dispatch threads decoder_version to ingest-ocr-cli."""
    from video_ingest.dispatch import dispatch_segments
    from video_ingest.pass2_extract import Pass2Result
    from video_ingest.pass1_classify import Segment

    captured: list[list[str]] = []

    class _FakeProc:
        returncode = 0
        stdout = ""
        stderr = ""

    def _fake_run(cmd, **kwargs):
        captured.append(list(cmd))
        return _FakeProc()

    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_run)
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")

    seg = Segment(
        start_index=0, end_index=4,
        start_seconds=10.0, end_seconds=15.0,
        screen_type="player_loadout_view",
        frame_count=5, mean_color_score=0.9,
    )
    pr = Pass2Result(
        segment_index=7, segment=seg,
        directory=tmp_path, frame_count=5,
        sample_fps=1.0,
        start_seconds=10.0, end_seconds=15.0,
    )

    dispatch_segments(
        [pr], game_title_id=1, match_id=250,
        video_sha256="a" * 64, ui_version="nhl26",
        decoder_version="hmm-viterbi-v1",
        repo_root=tmp_path,
    )
    assert len(captured) == 1
    cmd = captured[0]
    assert "--decoder-version" in cmd
    assert cmd[cmd.index("--decoder-version") + 1] == "hmm-viterbi-v1"


def test_dispatch_default_decoder_version_is_legacy(monkeypatch, tmp_path):
    """When decoder_version is omitted, the default legacy tag is emitted."""
    from video_ingest.dispatch import dispatch_segments
    from video_ingest.pass2_extract import Pass2Result
    from video_ingest.pass1_classify import Segment

    captured: list[list[str]] = []

    class _FakeProc:
        returncode = 0
        stdout = ""
        stderr = ""

    def _fake_run(cmd, **kwargs):
        captured.append(list(cmd))
        return _FakeProc()

    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_run)
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")

    seg = Segment(
        start_index=0, end_index=4,
        start_seconds=10.0, end_seconds=15.0,
        screen_type="player_loadout_view",
        frame_count=5, mean_color_score=0.9,
    )
    pr = Pass2Result(
        segment_index=7, segment=seg,
        directory=tmp_path, frame_count=5,
        sample_fps=1.0,
        start_seconds=10.0, end_seconds=15.0,
    )

    # No decoder_version kwarg — must default to "legacy-passthrough-v0-video".
    dispatch_segments(
        [pr], game_title_id=1, match_id=250,
        video_sha256="a" * 64, ui_version="nhl26",
        repo_root=tmp_path,
    )
    cmd = captured[0]
    assert cmd[cmd.index("--decoder-version") + 1] == "legacy-passthrough-v0-video"


# ---------------------------------------------------------------------------
# Task 2A-11: --loadout-engine + --loadout-evidence-json flag plumbing
# ---------------------------------------------------------------------------


def _make_loadout_results(directory: Path) -> list[Pass2Result]:
    """One player_loadout_view segment for loadout-flag tests."""
    seg = Segment(
        start_index=0,
        end_index=4,
        start_seconds=10.0,
        end_seconds=15.0,
        screen_type="player_loadout_view",
        frame_count=5,
        mean_color_score=0.9,
    )
    return [
        Pass2Result(
            segment_index=3,
            segment=seg,
            directory=directory,
            frame_count=5,
            sample_fps=1.0,
            start_seconds=10.0,
            end_seconds=15.0,
        )
    ]


def _fake_pnpm_run(captured: list[list[str]]):
    """Return a side-effect function that appends cmd to `captured`."""
    class _FakeProc:
        returncode = 0
        stdout = ""
        stderr = ""

    def _run(cmd, **kwargs):
        captured.append(list(cmd))
        return _FakeProc()

    return _run


def test_dispatch_passes_loadout_engine_flag(monkeypatch, tmp_path):
    """dispatch_segments always passes --loadout-engine to ingest-ocr-cli.

    typed_v1 → '--loadout-engine typed_v1'
    legacy   → '--loadout-engine legacy'
    """
    from video_ingest.dispatch import dispatch_segments

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    (repo_root / "pnpm-workspace.yaml").write_text("")
    seg_dir = tmp_path / "seg"
    seg_dir.mkdir()

    # --- typed_v1 case ---
    captured_v1: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_v1))
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")
    dispatch_segments(
        _make_loadout_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="b" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        loadout_engine="typed_v1",
    )
    assert len(captured_v1) == 1
    cmd_v1 = captured_v1[0]
    assert "--loadout-engine" in cmd_v1
    assert cmd_v1[cmd_v1.index("--loadout-engine") + 1] == "typed_v1"

    # --- legacy case ---
    captured_leg: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_leg))
    dispatch_segments(
        _make_loadout_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="b" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        loadout_engine="legacy",
    )
    assert len(captured_leg) == 1
    cmd_leg = captured_leg[0]
    assert "--loadout-engine" in cmd_leg
    assert cmd_leg[cmd_leg.index("--loadout-engine") + 1] == "legacy"


def test_dispatch_passes_loadout_evidence_json_path(monkeypatch, tmp_path):
    """When loadout_engine='typed_v1' AND loadout_evidence.json exists,
    --loadout-evidence-json <path> is included in the CLI invocation.
    When loadout_engine='legacy', the flag is omitted even if the file exists."""
    from video_ingest.dispatch import dispatch_segments

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    (repo_root / "pnpm-workspace.yaml").write_text("")
    seg_dir = tmp_path / "seg"
    seg_dir.mkdir()

    # Create the evidence file so the conditional is satisfied.
    evidence_path = seg_dir / "loadout_evidence.json"
    evidence_path.write_text("[]")

    # --- typed_v1 + file present → flag included ---
    captured_v1: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_v1))
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")
    dispatch_segments(
        _make_loadout_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="c" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        loadout_engine="typed_v1",
    )
    cmd_v1 = captured_v1[0]
    assert "--loadout-evidence-json" in cmd_v1, (
        "--loadout-evidence-json must be present when loadout_engine=typed_v1 and file exists"
    )
    assert cmd_v1[cmd_v1.index("--loadout-evidence-json") + 1] == str(evidence_path)

    # --- legacy + file present → flag omitted ---
    captured_leg: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_leg))
    dispatch_segments(
        _make_loadout_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="c" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        loadout_engine="legacy",
    )
    cmd_leg = captured_leg[0]
    assert "--loadout-evidence-json" not in cmd_leg, (
        "--loadout-evidence-json must NOT appear when loadout_engine=legacy"
    )


def test_dispatch_omits_loadout_evidence_json_when_file_missing(monkeypatch, tmp_path):
    """Even with loadout_engine='typed_v1', if loadout_evidence.json doesn't
    exist (e.g. non-loadout segment or extractor skipped), the flag is omitted."""
    from video_ingest.dispatch import dispatch_segments

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    (repo_root / "pnpm-workspace.yaml").write_text("")
    seg_dir = tmp_path / "seg"
    seg_dir.mkdir()
    # Deliberately do NOT create loadout_evidence.json.

    captured: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured))
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")
    dispatch_segments(
        _make_loadout_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="d" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        loadout_engine="typed_v1",
    )
    cmd = captured[0]
    assert "--loadout-evidence-json" not in cmd, (
        "--loadout-evidence-json must be omitted when the file is absent"
    )


# ---------------------------------------------------------------------------
# Task 3B-5: --lobby-engine + --lobby-evidence-json flag plumbing
# ---------------------------------------------------------------------------


def _make_lobby_results(directory: Path) -> list[Pass2Result]:
    """One pre_game_lobby_state_2 segment for lobby-flag tests."""
    seg = Segment(
        start_index=10,
        end_index=20,
        start_seconds=10.0,
        end_seconds=21.0,
        screen_type="pre_game_lobby_state_2",
        frame_count=11,
        mean_color_score=0.9,
    )
    return [
        Pass2Result(
            segment_index=4,
            segment=seg,
            directory=directory,
            frame_count=11,
            sample_fps=1.0,
            start_seconds=10.0,
            end_seconds=21.0,
        )
    ]


def test_dispatch_passes_lobby_engine_flag(monkeypatch, tmp_path):
    """dispatch_segments always passes --lobby-engine to ingest-ocr-cli."""
    from video_ingest.dispatch import dispatch_segments

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    (repo_root / "pnpm-workspace.yaml").write_text("")
    seg_dir = tmp_path / "seg"
    seg_dir.mkdir()

    # typed_v1
    captured_v1: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_v1))
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")
    dispatch_segments(
        _make_lobby_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="e" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        lobby_engine="typed_v1",
    )
    assert "--lobby-engine" in captured_v1[0]
    assert captured_v1[0][captured_v1[0].index("--lobby-engine") + 1] == "typed_v1"

    # legacy
    captured_leg: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_leg))
    dispatch_segments(
        _make_lobby_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="e" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        lobby_engine="legacy",
    )
    assert captured_leg[0][captured_leg[0].index("--lobby-engine") + 1] == "legacy"


def test_dispatch_passes_lobby_evidence_json_path(monkeypatch, tmp_path):
    """When lobby_engine='typed_v1' AND lobby_evidence.json exists, the path
    is included as --lobby-evidence-json. When 'legacy', the flag is omitted."""
    from video_ingest.dispatch import dispatch_segments

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    (repo_root / "pnpm-workspace.yaml").write_text("")
    seg_dir = tmp_path / "seg"
    seg_dir.mkdir()
    evidence_path = seg_dir / "lobby_evidence.json"
    evidence_path.write_text("[]")

    captured_v1: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_v1))
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")
    dispatch_segments(
        _make_lobby_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="f" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        lobby_engine="typed_v1",
    )
    cmd_v1 = captured_v1[0]
    assert "--lobby-evidence-json" in cmd_v1
    assert cmd_v1[cmd_v1.index("--lobby-evidence-json") + 1] == str(evidence_path)

    captured_leg: list[list[str]] = []
    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_pnpm_run(captured_leg))
    dispatch_segments(
        _make_lobby_results(seg_dir),
        game_title_id=1,
        match_id=250,
        video_sha256="f" * 64,
        ui_version="nhl26",
        repo_root=repo_root,
        lobby_engine="legacy",
    )
    assert "--lobby-evidence-json" not in captured_leg[0]
