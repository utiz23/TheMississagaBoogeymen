"""Unit tests for dispatch.load_confirmed_reel_map — the cross-language read of
the operator-confirmed reel→match map (Milestone ② step (3)).

`load_confirmed_reel_map` shells out to the worker `resolve-match reel-map` CLI
(the same subprocess-to-worker pattern as `dispatch_segments` /
`reprocess._run_decoder_runs_cli`) and parses its one-line JSON payload
(`{"0": 972, "1": 973}`) into `{reel_index: match_id}`.

By contract it is BEST-EFFORT: any failure (pnpm missing, non-zero exit, launch
error, unparseable output, or simply no confirmations yet) returns `{}` so the
caller stays in the deferred branch (reels re-emitted, no collapse) rather than
aborting the live ingest run.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from video_ingest.dispatch import load_confirmed_reel_map


class _FakeProc:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    root.mkdir()
    (root / "pnpm-workspace.yaml").write_text("")
    return root


def test_parses_confirmed_map(tmp_path: Path) -> None:
    # `{"0": 972, "1": 973}` → int-keyed {0: 972, 1: 973}.
    captured: list[list[str]] = []

    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        captured.append(list(cmd))
        return _FakeProc(returncode=0, stdout='{"0": 972, "1": 973}\n')

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        out = load_confirmed_reel_map("f" * 64, repo_root=_repo(tmp_path))

    assert out == {0: 972, 1: 973}
    # It invokes the worker reel-map subcommand with the sha.
    cmd = captured[0]
    assert "resolve-match" in cmd and "reel-map" in cmd
    assert "--video-sha256" in cmd
    assert cmd[cmd.index("--video-sha256") + 1] == "f" * 64


def test_tolerates_pnpm_banner_lines(tmp_path: Path) -> None:
    # pnpm may prepend header lines; the JSON is the last '{'-line (mirrors
    # reprocess._run_decoder_runs_cli's bottom-up scan).
    stdout = "> worker@ resolve-match /repo/apps/worker\n> node dist/...\n{\"2\": 974}\n"

    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=0, stdout=stdout)

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        out = load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))

    assert out == {2: 974}


def test_empty_map_when_no_confirmations(tmp_path: Path) -> None:
    # No confirmed rows → the CLI prints `{}` → {}.
    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=0, stdout="{}\n")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        out = load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))

    assert out == {}


def test_nonzero_exit_returns_empty(tmp_path: Path) -> None:
    # A failing CLI must NOT raise — best-effort defers to {}.
    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=1, stdout="", stderr="boom")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        out = load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))

    assert out == {}


def test_unparseable_stdout_returns_empty(tmp_path: Path) -> None:
    # No JSON object line anywhere → {} (never raises).
    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=0, stdout="not json at all\n")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        out = load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))

    assert out == {}


def test_pnpm_missing_returns_empty(tmp_path: Path) -> None:
    # pnpm not on PATH → {} without ever invoking subprocess.run.
    with patch("video_ingest.dispatch.shutil.which", return_value=None):
        out = load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))

    assert out == {}


def test_launch_error_returns_empty(tmp_path: Path) -> None:
    # subprocess.run itself raising (e.g. OSError) is swallowed → {}.
    def boom(cmd, **kwargs):  # type: ignore[no-untyped-def]
        raise OSError("cannot spawn")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=boom), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        out = load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))

    assert out == {}
