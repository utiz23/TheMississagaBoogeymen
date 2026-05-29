"""Phase 4 — reprocess stage timing + run-quality emit tests.

Unit tests for the ``_StageTimer`` context manager + the end-of-pipeline
stage-runtimes file write + best-effort shell-out to the worker
``run-quality --emit-row`` CLI.

All tests stub out the heavy subprocess shell-outs
(``_run_streaming`` + ``_run_decoder_runs_cli`` + ``subprocess.run``)
so the focus stays on the wiring: timer accumulation, JSON shape,
file location, and the best-effort/no-throw contract.

Style mirrors ``test_reprocess_cli.py`` (pytest + typer's ``CliRunner``
+ ``monkeypatch``).
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import pytest
from typer.testing import CliRunner

from video_ingest import reprocess as reprocess_mod
from video_ingest.cli import app


# ─── _StageTimer unit tests ──────────────────────────────────────────────────


def test_stage_timer_records_elapsed_milliseconds() -> None:
    """Single timer: enter, sleep ~10ms, exit; expect a positive ms
    reading within a generous tolerance band (CI noise can push the
    upper bound surprisingly high)."""
    stages: dict[str, float] = {}
    with reprocess_mod._StageTimer(stages, "demo_ms"):
        time.sleep(0.010)  # 10ms
    assert "demo_ms" in stages
    # Generous band — sleep granularity is OS-dependent and CI is noisy.
    assert 5.0 <= stages["demo_ms"] <= 500.0, (
        f"expected ~10ms wall time, got {stages['demo_ms']:.2f}ms"
    )


def test_stage_timer_accumulates_multiple_keys_independently() -> None:
    """Three sequential timers under three distinct keys produce three
    independent entries in the shared stages dict."""
    stages: dict[str, float] = {}
    with reprocess_mod._StageTimer(stages, "alpha_ms"):
        time.sleep(0.005)
    with reprocess_mod._StageTimer(stages, "beta_ms"):
        time.sleep(0.005)
    with reprocess_mod._StageTimer(stages, "gamma_ms"):
        time.sleep(0.005)

    assert set(stages.keys()) == {"alpha_ms", "beta_ms", "gamma_ms"}
    for k, v in stages.items():
        assert v > 0.0, f"{k} should record a positive elapsed time, got {v}"


def test_stage_timer_uses_monotonic_clock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sanity check: ``_StageTimer`` reads ``time.monotonic`` (not
    ``time.perf_counter``). Patching ``time.monotonic`` in the
    reprocess module should change the recorded value; patching
    ``time.perf_counter`` should not."""
    stages: dict[str, float] = {}

    fake_now = [100.0]

    def fake_monotonic() -> float:
        return fake_now[0]

    monkeypatch.setattr(reprocess_mod.time, "monotonic", fake_monotonic)

    with reprocess_mod._StageTimer(stages, "fake_ms"):
        fake_now[0] = 100.250  # advance "monotonic" by 250ms inside the block

    # 0.250 sec * 1000 = 250.0 ms; exact because we control the clock.
    assert stages["fake_ms"] == pytest.approx(250.0)


# ─── end-of-pipeline integration (monkeypatched) ─────────────────────────────


@pytest.fixture
def _fake_artifacts(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub out the on-disk artifact + DB lookups the real reprocess()
    needs before the pipeline starts. Returns nothing — used as a setup
    fixture only."""
    monkeypatch.setattr(
        reprocess_mod, "_compute_hashes",
        lambda version: ("a" * 64, "b" * 64),
    )
    monkeypatch.setattr(
        reprocess_mod, "_resolve_video_path",
        lambda match_id: (Path("/tmp/fake-video.mkv"), "c" * 64),
    )


def _make_decoder_runs_stub(fake_run_id: int):
    """Return a stub for ``_run_decoder_runs_cli`` whose return value
    differs by subcommand:

    - ``create-candidate`` → ``{"run_id": fake_run_id, ...}``
    - ``validate`` → ``{"_exit": 0, "ok": True}``
    - ``activate`` → ``{"_exit": 0, "is_active": True}``
    """

    def stub(*args: str) -> dict:
        if args and args[0] == "create-candidate":
            return {
                "run_id": fake_run_id,
                "is_active": False,
                "_exit": 0,
            }
        if args and args[0] == "validate":
            return {"_exit": 0, "ok": True, "details": {}}
        if args and args[0] == "activate":
            return {"_exit": 0, "is_active": True}
        return {"_exit": 0}

    return stub


def test_full_pipeline_writes_stage_runtimes_file_and_invokes_emit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _fake_artifacts: None,
) -> None:
    """Full non-dry, non-undo pipeline stubbed end-to-end. Assert:

    1. The stage-runtimes JSON lands at
       ``DEFAULT_INGEST_CACHE/run-{id}-stage-runtimes.json`` with the
       expected top-level shape.
    2. The ``subprocess.run`` mock was invoked with the run-quality CLI
       arg list (``pnpm --filter @eanhl/worker run-quality --run-id ...
       --emit-row --stage-runtimes <path>``).
    3. The CLI exited normally (no exception, exit 0).
    """
    fake_run_id = 4242

    # Redirect the cache dir into tmp_path so the test doesn't write to
    # the real /tmp/ingest-cache shared with the operator's workstation.
    cache_dir = tmp_path / "ingest-cache"
    monkeypatch.setattr(reprocess_mod, "DEFAULT_INGEST_CACHE", cache_dir)

    monkeypatch.setattr(
        reprocess_mod, "_run_decoder_runs_cli",
        _make_decoder_runs_stub(fake_run_id),
    )
    # ``_run_streaming`` swallows the call entirely — the heavy ingest +
    # pnpm shell-outs are exactly the wall time we're measuring, so we
    # don't need them to actually do anything for this test.
    monkeypatch.setattr(
        reprocess_mod, "_run_streaming",
        lambda cmd, *, description: None,
    )

    # Record every subprocess.run invocation so we can assert the
    # run-quality emit shape after the fact.
    recorded_calls: list[list[str]] = []

    def fake_subprocess_run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
        recorded_calls.append(list(cmd))
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=0,
            stdout='{"run_id":4242,"written":true}\n',
            stderr="",
        )

    monkeypatch.setattr(reprocess_mod.subprocess, "run", fake_subprocess_run)

    runner = CliRunner()
    result = runner.invoke(
        app,
        ["reprocess", "--match-id", "250"],
    )
    assert result.exit_code == 0, (
        f"reprocess exited {result.exit_code}; exception={result.exception!r}\n"
        f"stdout:\n{result.stdout}"
    )

    # 1. File written.
    expected_path = cache_dir / f"run-{fake_run_id}-stage-runtimes.json"
    assert expected_path.exists(), (
        f"expected stage-runtimes file at {expected_path}, "
        f"got cache_dir contents: {list(cache_dir.iterdir()) if cache_dir.exists() else '(no dir)'}"
    )
    payload = json.loads(expected_path.read_text())
    assert set(payload.keys()) == {
        "stages", "total_wall_ms", "captured_at", "captured_from",
    }, f"unexpected top-level keys: {sorted(payload.keys())}"
    assert payload["captured_from"] == "reprocess.py"
    assert isinstance(payload["total_wall_ms"], int)
    assert isinstance(payload["captured_at"], str) and payload["captured_at"]
    # stages should contain at least the 8 timed pipeline keys (run_quality_emit_ms is null).
    expected_stage_keys = {
        "create_candidate_ms",
        "ingest_ms",
        "repromote_loadout_ms",
        "repromote_lobby_ms",
        "validate_ms",
        "activate_ms",
        "consolidate_loadouts_ms",
        "backfill_event_actor_resolution_ms",
    }
    assert expected_stage_keys.issubset(set(payload["stages"].keys())), (
        f"missing stage keys: {expected_stage_keys - set(payload['stages'].keys())}"
    )
    # run_quality_emit_ms is intentionally null in the file (v1 — see code).
    assert payload["stages"].get("run_quality_emit_ms") is None

    # 2. subprocess.run invoked with the run-quality emit args.
    emit_calls = [
        c for c in recorded_calls
        if len(c) >= 4 and c[:4] == ["pnpm", "--filter", "@eanhl/worker", "run-quality"]
    ]
    assert len(emit_calls) == 1, (
        f"expected exactly one run-quality emit call, got: {recorded_calls}"
    )
    emit_cmd = emit_calls[0]
    assert "--emit-row" in emit_cmd
    assert "--run-id" in emit_cmd
    run_id_idx = emit_cmd.index("--run-id")
    assert emit_cmd[run_id_idx + 1] == str(fake_run_id)
    assert "--stage-runtimes" in emit_cmd
    sr_idx = emit_cmd.index("--stage-runtimes")
    assert emit_cmd[sr_idx + 1] == str(expected_path)
    # --force is required: completed_at is stamped during activate (step 7)
    # so a concurrent `--all-runs --emit-row` can write a backfill row
    # during steps 8-10. Without --force, our source-of-truth emit would
    # conflict and the best-effort try/except would swallow it, leaving
    # the backfill row in place. See reprocess.py docstring + Codex R2 P1.
    assert "--force" in emit_cmd, (
        "reprocess.py must pass --force on the final emit to win race "
        "against backfill (Codex R2 P1). See reprocess.py step 10."
    )


def test_emit_subprocess_failure_does_not_propagate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    _fake_artifacts: None,
) -> None:
    """If the TS run-quality CLI raises (or exits non-zero), reprocess
    must still return cleanly — the upstream activate + consolidate +
    backfill steps already succeeded. The error gets logged to stderr."""
    fake_run_id = 8001
    cache_dir = tmp_path / "ingest-cache"
    monkeypatch.setattr(reprocess_mod, "DEFAULT_INGEST_CACHE", cache_dir)
    monkeypatch.setattr(
        reprocess_mod, "_run_decoder_runs_cli",
        _make_decoder_runs_stub(fake_run_id),
    )
    monkeypatch.setattr(
        reprocess_mod, "_run_streaming",
        lambda cmd, *, description: None,
    )

    def raising_subprocess_run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
        raise RuntimeError("simulated TS CLI crash")

    monkeypatch.setattr(reprocess_mod.subprocess, "run", raising_subprocess_run)

    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--match-id", "250"])

    # Best-effort: reprocess still exits 0 even though the emit failed.
    assert result.exit_code == 0, (
        f"reprocess should swallow emit failures but got exit {result.exit_code}; "
        f"exception={result.exception!r}\nstdout:\n{result.stdout}"
    )
    # The stage-runtimes file was still written (only the emit failed).
    expected_path = cache_dir / f"run-{fake_run_id}-stage-runtimes.json"
    assert expected_path.exists()
    # Error landed on stderr (captured by CliRunner into result.stderr/output).
    combined = (result.stdout or "") + "\n" + (getattr(result, "stderr", "") or "")
    assert "run-quality" in combined and "emit" in combined, (
        f"expected stderr to mention the run-quality emit failure, got:\n{combined}"
    )


def test_emit_nonzero_exit_does_not_propagate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _fake_artifacts: None,
) -> None:
    """Mirror of the raising-subprocess test but with a returncode != 0.
    Reprocess must still return cleanly."""
    fake_run_id = 8002
    cache_dir = tmp_path / "ingest-cache"
    monkeypatch.setattr(reprocess_mod, "DEFAULT_INGEST_CACHE", cache_dir)
    monkeypatch.setattr(
        reprocess_mod, "_run_decoder_runs_cli",
        _make_decoder_runs_stub(fake_run_id),
    )
    monkeypatch.setattr(
        reprocess_mod, "_run_streaming",
        lambda cmd, *, description: None,
    )

    def failing_subprocess_run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
        return subprocess.CompletedProcess(
            args=cmd, returncode=1, stdout="", stderr="boom\n",
        )

    monkeypatch.setattr(reprocess_mod.subprocess, "run", failing_subprocess_run)

    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--match-id", "250"])

    assert result.exit_code == 0, (
        f"reprocess should swallow non-zero emit exits, got {result.exit_code}; "
        f"exception={result.exception!r}\nstdout:\n{result.stdout}"
    )


def test_dry_run_skips_stage_runtimes_file_and_emit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _fake_artifacts: None,
) -> None:
    """--dry-run must NOT write the stage-runtimes file and must NOT
    invoke the run-quality emit."""
    fake_run_id = 9999
    cache_dir = tmp_path / "ingest-cache"
    monkeypatch.setattr(reprocess_mod, "DEFAULT_INGEST_CACHE", cache_dir)
    monkeypatch.setattr(
        reprocess_mod, "_run_decoder_runs_cli",
        _make_decoder_runs_stub(fake_run_id),
    )

    # If _run_streaming were called under --dry-run, that'd be a bug —
    # set a tripwire so the test fails loudly.
    def streaming_tripwire(cmd, *, description):
        raise AssertionError(
            f"_run_streaming called during --dry-run (should be skipped): {cmd}"
        )

    monkeypatch.setattr(reprocess_mod, "_run_streaming", streaming_tripwire)

    # subprocess.run tripwire — same idea.
    recorded_calls: list[list[str]] = []

    def fake_subprocess_run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
        recorded_calls.append(list(cmd))
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(reprocess_mod.subprocess, "run", fake_subprocess_run)

    runner = CliRunner()
    result = runner.invoke(
        app, ["reprocess", "--match-id", "250", "--dry-run"],
    )
    assert result.exit_code == 0, (
        f"dry-run exited {result.exit_code}; exception={result.exception!r}\n"
        f"stdout:\n{result.stdout}"
    )

    # No file written.
    expected_path = cache_dir / f"run-{fake_run_id}-stage-runtimes.json"
    assert not expected_path.exists(), (
        f"--dry-run should not write a stage-runtimes file; found {expected_path}"
    )

    # No run-quality subprocess calls.
    emit_calls = [
        c for c in recorded_calls
        if any("run-quality" in str(arg) for arg in c)
    ]
    assert emit_calls == [], (
        f"--dry-run should not invoke run-quality, got: {emit_calls}"
    )


def test_undo_skips_stage_runtimes_file_and_emit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """--undo returns early from the very top of reprocess() — none of
    the Phase-4 wiring should execute."""
    fake_run_id = 7777
    cache_dir = tmp_path / "ingest-cache"
    monkeypatch.setattr(reprocess_mod, "DEFAULT_INGEST_CACHE", cache_dir)

    # The undo branch calls _run_decoder_runs_cli once and returns.
    monkeypatch.setattr(
        reprocess_mod, "_run_decoder_runs_cli",
        lambda *args: {"_exit": 0, "undone": True},
    )

    def streaming_tripwire(cmd, *, description):
        raise AssertionError(
            f"_run_streaming should not be called during --undo: {cmd}"
        )

    monkeypatch.setattr(reprocess_mod, "_run_streaming", streaming_tripwire)

    recorded_calls: list[list[str]] = []

    def fake_subprocess_run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
        recorded_calls.append(list(cmd))
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(reprocess_mod.subprocess, "run", fake_subprocess_run)

    runner = CliRunner()
    result = runner.invoke(
        app, ["reprocess", "--match-id", "250", "--undo"],
    )
    assert result.exit_code == 0, (
        f"undo exited {result.exit_code}; exception={result.exception!r}\n"
        f"stdout:\n{result.stdout}"
    )

    # No file written.
    expected_path = cache_dir / f"run-{fake_run_id}-stage-runtimes.json"
    assert not expected_path.exists()
    # No run-quality emit.
    assert not any(
        any("run-quality" in str(arg) for arg in c) for c in recorded_calls
    ), f"--undo should not invoke run-quality, got: {recorded_calls}"
