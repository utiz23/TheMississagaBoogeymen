"""Unit tests for dispatch.load_confirmed_reel_map + resolve_confirmed_reel_match_ids
— the cross-language read of the operator-confirmed reel→match map (Milestone ②
step (3)) and the best-effort-vs-strict policy layered on top (GAP (2)).

`load_confirmed_reel_map` shells out to the worker `resolve-match reel-map` CLI
(the same subprocess-to-worker pattern as `dispatch_segments` /
`reprocess._run_decoder_runs_cli`) and parses its one-line JSON payload
(`{"0": 972, "1": 973}`) into `{reel_index: match_id}`.

Contract (post-GAP-(2)): a CLEAN lookup returns the parsed map — including an
empty `{}` when the operator has confirmed nothing yet. A lookup FAILURE (pnpm
missing, non-zero exit, launch error, or stdout carrying no parseable JSON
object) RAISES `ReelMapLookupError` — it is no longer swallowed as `{}`, so the
"could not read" case is distinguishable from "nothing confirmed".

`resolve_confirmed_reel_match_ids` chooses what to DO with those two cases:
`require_reel_map=False` (Pass-1 / manual) defers on both; `require_reel_map=True`
(the promote pass, which knows the video is confirmed) raises on both.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from video_ingest.dispatch import (
    ReelMapLookupError,
    load_confirmed_reel_map,
    resolve_confirmed_reel_match_ids,
)


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


# ─── load_confirmed_reel_map: clean reads return the parsed map ────────────────


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
    # A CLEAN exit with a valid empty object → {}: genuinely nothing confirmed
    # yet. This is the ONE empty result that is NOT an error.
    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=0, stdout="{}\n")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        out = load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))

    assert out == {}


# ─── load_confirmed_reel_map: lookup FAILURES raise (no longer swallowed) ───────


def test_nonzero_exit_raises(tmp_path: Path) -> None:
    # A failing CLI is a lookup failure, NOT an empty map — raise so the caller
    # can distinguish it from "nothing confirmed".
    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=1, stdout="", stderr="boom")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        with pytest.raises(ReelMapLookupError):
            load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))


def test_no_json_line_raises(tmp_path: Path) -> None:
    # No JSON object line anywhere (e.g. banner-only stdout) is unreadable, not
    # empty → raise. This is the classic silent-drain trap: a '{'-less stdout
    # used to parse to {} and look exactly like "no confirmations".
    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=0, stdout="not json at all\n")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        with pytest.raises(ReelMapLookupError):
            load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))


def test_malformed_json_line_raises(tmp_path: Path) -> None:
    # A line that OPENS an object but is not valid JSON → raise (truncated /
    # corrupt payload must not read as empty).
    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        return _FakeProc(returncode=0, stdout='{"0": 972,\n')

    with patch("video_ingest.dispatch.subprocess.run", side_effect=fake_run), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        with pytest.raises(ReelMapLookupError):
            load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))


def test_pnpm_missing_raises(tmp_path: Path) -> None:
    # pnpm not on PATH → raise without ever invoking subprocess.run.
    with patch("video_ingest.dispatch.shutil.which", return_value=None):
        with pytest.raises(ReelMapLookupError):
            load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))


def test_launch_error_raises(tmp_path: Path) -> None:
    # subprocess.run itself raising (e.g. OSError) is reshaped into a typed
    # lookup error, not swallowed.
    def boom(cmd, **kwargs):  # type: ignore[no-untyped-def]
        raise OSError("cannot spawn")

    with patch("video_ingest.dispatch.subprocess.run", side_effect=boom), \
         patch("video_ingest.dispatch.shutil.which", return_value="/usr/bin/pnpm"):
        with pytest.raises(ReelMapLookupError):
            load_confirmed_reel_map("a" * 64, repo_root=_repo(tmp_path))


# ─── resolve_confirmed_reel_match_ids: best-effort (default) vs strict (flag) ───


def test_resolve_defers_on_failure_without_flag() -> None:
    # Default policy: a lookup failure is logged and folded into "defer" (None) —
    # the fresh Pass-1 / manual path never aborts on a missing map.
    with patch(
        "video_ingest.dispatch.load_confirmed_reel_map",
        side_effect=ReelMapLookupError("boom"),
    ):
        out = resolve_confirmed_reel_match_ids("a" * 64, require_reel_map=False)
    assert out is None


def test_resolve_raises_on_failure_with_flag() -> None:
    # Strict policy (promote pass): a lookup failure must abort, not silently
    # drain the confirmed video into the deferred branch.
    with patch(
        "video_ingest.dispatch.load_confirmed_reel_map",
        side_effect=ReelMapLookupError("boom"),
    ):
        with pytest.raises(ReelMapLookupError):
            resolve_confirmed_reel_match_ids("a" * 64, require_reel_map=True)


def test_resolve_empty_is_defer_without_flag() -> None:
    # Genuinely empty + no flag → defer (nothing to collapse).
    with patch("video_ingest.dispatch.load_confirmed_reel_map", return_value={}):
        out = resolve_confirmed_reel_match_ids("a" * 64, require_reel_map=False)
    assert out is None


def test_resolve_empty_raises_with_flag() -> None:
    # Under the flag, an EMPTY map is also a fault: the association ledger says
    # this video is confirmed, so an empty reel-map means the two disagree.
    with patch("video_ingest.dispatch.load_confirmed_reel_map", return_value={}):
        with pytest.raises(ReelMapLookupError):
            resolve_confirmed_reel_match_ids("a" * 64, require_reel_map=True)


def test_resolve_returns_map_with_flag() -> None:
    with patch(
        "video_ingest.dispatch.load_confirmed_reel_map",
        return_value={0: 972, 1: 973},
    ):
        out = resolve_confirmed_reel_match_ids("a" * 64, require_reel_map=True)
    assert out == {0: 972, 1: 973}


def test_resolve_returns_map_without_flag() -> None:
    with patch("video_ingest.dispatch.load_confirmed_reel_map", return_value={2: 974}):
        out = resolve_confirmed_reel_match_ids("a" * 64, require_reel_map=False)
    assert out == {2: 974}
