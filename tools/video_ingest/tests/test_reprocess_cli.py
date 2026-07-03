"""Task 9 — full reprocess flow tests.

Three layers:

1. **CLI surface** (Task 8 carry-over): the reprocess subcommand is
   registered with the expected flags. Cheap, no DB.

2. **Helper unit tests**: ``_file_sha256`` + ``_compute_hashes`` are pure
   functions over on-disk artifact bytes; testable with ``tmp_path`` +
   ``monkeypatch.setattr`` to swap REPO_ROOT.

3. **Integration smoke** (``--undo --dry-run`` against a real existing
   match): exercises the full Python → pnpm → decoder-runs-cli shell-out
   chain in read-only mode. Requires the local Docker stack + a built
   worker. Skipped when ``RUN_REPROCESS_INTEGRATION`` is unset because
   it depends on cluster state (existing decoder runs for match 250).

4. **Full E2E**: opt-in via ``RUN_REPROCESS_E2E=1``. Actually runs the
   3-5 minute create-ingest-promote-validate-activate flow against
   match 250 (the canonical pilot match). Documented but skipped by
   default.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from video_ingest import reprocess as reprocess_mod
from video_ingest.cli import app


# ─── CLI-surface tests (Task 8 carry-over) ───────────────────────────────────


def test_reprocess_subcommand_help_lists_required_args() -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--help"])
    assert result.exit_code == 0, result.stdout
    assert "--match-id" in result.stdout
    assert "--video" in result.stdout
    assert "--dry-run" in result.stdout
    assert "--undo" in result.stdout


def test_reprocess_subcommand_is_registered() -> None:
    runner = CliRunner()
    # `--match-id` is required; bare `reprocess` must error.
    result = runner.invoke(app, ["reprocess"])
    assert result.exit_code != 0


def test_reprocess_dry_run_includes_consolidate_and_backfill_steps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The dry-run payload must include the consolidate + backfill steps
    so operators can audit the full plan before committing to a real
    reprocess. These two steps (8 + 9 in the pipeline) run post-activate
    and are required for the match-quality CLI's class-G lineup check
    to see anchor snapshots.

    Pure CLI-surface test: stubs out the helpers that touch the DB +
    on-disk artifacts so the assertion focuses on the JSON shape that
    the dry-run branch emits.
    """
    fake_match = 250
    fake_run_id = 9999

    monkeypatch.setattr(
        reprocess_mod, "_compute_hashes",
        lambda version: ("a" * 64, "b" * 64),
    )
    monkeypatch.setattr(
        reprocess_mod, "_resolve_video_path",
        lambda match_id: (Path("/tmp/fake-video.mkv"), "c" * 64),
    )
    monkeypatch.setattr(
        reprocess_mod, "_run_decoder_runs_cli",
        lambda *args: {"run_id": fake_run_id, "is_active": False, "_exit": 0},
    )

    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--match-id", str(fake_match), "--dry-run"])
    assert result.exit_code == 0, (
        f"dry-run exited {result.exit_code}; exception={result.exception!r}\n"
        f"stdout:\n{result.stdout}"
    )
    assert "would_consolidate_loadouts_for_match" in result.stdout, (
        f"dry-run payload missing consolidate step, got:\n{result.stdout}"
    )
    assert "would_backfill_event_actor_resolution_for_match" in result.stdout, (
        f"dry-run payload missing backfill step, got:\n{result.stdout}"
    )
    # The two new keys should reference the match id (per-match scope),
    # not the run id — the worker CLIs accept --match, not --run-id.
    # The dry-run prints two JSON blobs: a create-candidate summary and
    # the dry-run plan. Grab the last one (containing dry_run: true).
    blobs = [
        json.loads(blob)
        for blob in result.stdout.replace("}\n{", "}|||{").split("|||")
        if blob.strip().startswith("{")
    ]
    dry_run_blob = next(b for b in blobs if b.get("dry_run") is True)
    assert dry_run_blob["would_consolidate_loadouts_for_match"] == fake_match
    assert dry_run_blob["would_backfill_event_actor_resolution_for_match"] == fake_match


# ─── helper unit tests ───────────────────────────────────────────────────────


def test_file_sha256_matches_hashlib(tmp_path: Path) -> None:
    payload = b"the quick brown fox jumps over the lazy decoder run\n"
    target = tmp_path / "sample.bin"
    target.write_bytes(payload)
    expected = hashlib.sha256(payload).hexdigest()
    assert reprocess_mod._file_sha256(target) == expected
    # sha256 hex strings are always 64 chars.
    assert len(reprocess_mod._file_sha256(target)) == 64


def _seed_fake_artifacts(
    repo_root: Path, version: str, *, weights_body: bytes, sm_body: bytes, priors_body: bytes
) -> None:
    """Lay out a fake REPO_ROOT/tools/game_ocr/... tree with the three
    artifact files _compute_hashes reads. Used by the unit tests below
    to swap REPO_ROOT via monkeypatch.setattr."""
    weights_dir = repo_root / "tools" / "game_ocr" / "game_ocr" / "weights"
    sm_dir = repo_root / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine"
    weights_dir.mkdir(parents=True)
    sm_dir.mkdir(parents=True)
    (weights_dir / f"{version}-screen-classifier-v2.json").write_bytes(weights_body)
    (sm_dir / f"{version}.yaml").write_bytes(sm_body)
    (sm_dir / f"{version}_regex_priors.yaml").write_bytes(priors_body)


def test_compute_hashes_returns_two_64char_hex_strings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_fake_artifacts(
        tmp_path, "nhltest",
        weights_body=b'{"weights": "v2"}\n',
        sm_body=b"sm: yaml\n",
        priors_body=b"priors: yaml\n",
    )
    monkeypatch.setattr(reprocess_mod, "REPO_ROOT", tmp_path)
    weights_hash, config_hash = reprocess_mod._compute_hashes("nhltest")
    assert len(weights_hash) == 64 and len(config_hash) == 64
    assert all(c in "0123456789abcdef" for c in weights_hash)
    assert all(c in "0123456789abcdef" for c in config_hash)


def test_compute_hashes_is_deterministic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_fake_artifacts(
        tmp_path, "nhltest",
        weights_body=b'{"x": 1}\n',
        sm_body=b"sm\n",
        priors_body=b"priors\n",
    )
    monkeypatch.setattr(reprocess_mod, "REPO_ROOT", tmp_path)
    first = reprocess_mod._compute_hashes("nhltest")
    second = reprocess_mod._compute_hashes("nhltest")
    assert first == second


def test_compute_hashes_changes_when_state_machine_yaml_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_fake_artifacts(
        tmp_path, "nhltest",
        weights_body=b'{"x": 1}\n',
        sm_body=b"sm: original\n",
        priors_body=b"priors\n",
    )
    monkeypatch.setattr(reprocess_mod, "REPO_ROOT", tmp_path)
    weights_hash_a, config_hash_a = reprocess_mod._compute_hashes("nhltest")

    # Mutate state-machine YAML; weights_hash should NOT change but
    # config_hash MUST change.
    sm_path = tmp_path / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine" / "nhltest.yaml"
    sm_path.write_bytes(b"sm: mutated\n")
    weights_hash_b, config_hash_b = reprocess_mod._compute_hashes("nhltest")
    assert weights_hash_a == weights_hash_b
    assert config_hash_a != config_hash_b


def test_compute_hashes_changes_when_regex_priors_yaml_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_fake_artifacts(
        tmp_path, "nhltest",
        weights_body=b'{"x": 1}\n',
        sm_body=b"sm\n",
        priors_body=b"priors: original\n",
    )
    monkeypatch.setattr(reprocess_mod, "REPO_ROOT", tmp_path)
    _, config_hash_a = reprocess_mod._compute_hashes("nhltest")

    priors_path = tmp_path / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine" / "nhltest_regex_priors.yaml"
    priors_path.write_bytes(b"priors: mutated\n")
    _, config_hash_b = reprocess_mod._compute_hashes("nhltest")
    assert config_hash_a != config_hash_b


def test_compute_hashes_raises_on_missing_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Lay out only the weights file; missing YAMLs should raise with a
    # clear message naming the missing path.
    weights_dir = tmp_path / "tools" / "game_ocr" / "game_ocr" / "weights"
    weights_dir.mkdir(parents=True)
    (weights_dir / "nhltest-screen-classifier-v2.json").write_bytes(b"{}")
    monkeypatch.setattr(reprocess_mod, "REPO_ROOT", tmp_path)
    with pytest.raises(RuntimeError, match=r"required v2 artifact missing"):
        reprocess_mod._compute_hashes("nhltest")


# ─── _resolve_video_path dir resolution (G0.1 landmine fix) ──────────────────
#
# The sha lookup is stubbed via _psql_query; these assert ONLY the folder
# resolution: no-space `match<id>` preferred, historical `match <id>` fallback,
# EXACT dir names (never a prefix glob that would grab `match<id>-label-frames`).


def _stub_sha(monkeypatch: pytest.MonkeyPatch, sha: str = "d" * 64) -> None:
    monkeypatch.setattr(reprocess_mod, "_psql_query", lambda _sql: sha)


def test_resolve_video_path_prefers_no_space_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`match250` (no space) is resolved; sibling `match250-label-frames` is
    NOT selected (exact dir name, not a prefix glob)."""
    _stub_sha(monkeypatch)
    monkeypatch.setattr(reprocess_mod, "DEFAULT_VIDEO_ROOT", tmp_path)
    (tmp_path / "match250").mkdir()
    (tmp_path / "match250" / "clip.mkv").write_bytes(b"real")
    # Decoy sibling that a prefix glob would wrongly match.
    (tmp_path / "match250-label-frames").mkdir()
    (tmp_path / "match250-label-frames" / "decoy.mkv").write_bytes(b"decoy")

    # sha won't match either file → error names the resolved dir; assert it's the
    # no-space one and never mentions the label-frames decoy.
    with pytest.raises(RuntimeError, match=r"none of the \.mkv files") as exc:
        reprocess_mod._resolve_video_path(250)
    assert "match250/" in str(exc.value) or str(tmp_path / "match250") in str(exc.value)
    assert "label-frames" not in str(exc.value)
    assert "decoy.mkv" not in str(exc.value)


def test_resolve_video_path_falls_back_to_space_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When only the historical `match <id>` (space) form exists, it resolves."""
    _stub_sha(monkeypatch)
    monkeypatch.setattr(reprocess_mod, "DEFAULT_VIDEO_ROOT", tmp_path)
    space_dir = tmp_path / "match 463"
    space_dir.mkdir()
    real = space_dir / "clip.mkv"
    real.write_bytes(b"payload-463")
    sha = reprocess_mod._file_sha256(real)
    monkeypatch.setattr(reprocess_mod, "_psql_query", lambda _sql: sha)

    resolved, got_sha = reprocess_mod._resolve_video_path(463)
    assert resolved == real
    assert got_sha == sha


def test_resolve_video_path_raises_when_no_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Neither `match<id>` nor `match <id>` present → a clear error listing the
    exact dir names tried."""
    _stub_sha(monkeypatch)
    monkeypatch.setattr(reprocess_mod, "DEFAULT_VIDEO_ROOT", tmp_path)
    with pytest.raises(RuntimeError, match=r"source-video dir not found for match 968") as exc:
        reprocess_mod._resolve_video_path(968)
    assert "tried exact dir names" in str(exc.value)


# ─── integration: --undo --dry-run smoke test ────────────────────────────────


def _integration_enabled() -> bool:
    return os.environ.get("RUN_REPROCESS_INTEGRATION") == "1"


@pytest.mark.skipif(
    not _integration_enabled(),
    reason="set RUN_REPROCESS_INTEGRATION=1 to enable (requires local DB + built worker)",
)
def test_reprocess_undo_dry_run_against_match_250() -> None:
    """Run the real CLI with --undo --dry-run against match 250.

    Read-only — no DB writes. Requires the local docker stack to be up
    and the worker dist/ to be built.

    Two valid outcomes (both exercise the Python → pnpm → decoder-runs-cli
    shell chain end-to-end):

      a. A prior inactive+completed run exists for match 250: CLI exits 0
         and prints an activate dry-run JSON payload with
         ``would_activate_run_id`` / ``would_deactivate_run_id``.
      b. No prior inactive+completed run exists (the typical state after
         only the first ingest): the underlying decoder-runs-cli errors
         out with ``undo: no prior inactive run found``. The Python
         orchestrator surfaces that as a non-zero exit with the message
         in stderr.

    We accept either case — the test's purpose is to prove the
    orchestration plumbing works, not to assert a specific DB state.
    """
    repo_root = Path(__file__).resolve().parents[3]
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{repo_root / 'tools' / 'video_ingest'}:{repo_root / 'tools' / 'game_ocr'}"
    cmd = [
        sys.executable, "-m", "video_ingest.cli",
        "reprocess", "--match-id", "250", "--undo", "--dry-run",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=repo_root)
    combined = res.stdout + "\n" + res.stderr
    if res.returncode == 0:
        # Case (a): activate dry-run payload landed on stdout.
        assert (
            "would_activate_run_id" in res.stdout
            or "would_deactivate_run_id" in res.stdout
        ), f"expected dry-run payload in stdout, got:\n{combined}"
    else:
        # Case (b): orchestrator propagated decoder-runs-cli's "no prior
        # inactive run" error. Any other failure mode (DB unreachable,
        # worker not built, schema drift) is a real bug.
        assert "no prior inactive run" in combined, (
            f"unexpected failure mode (exit {res.returncode}):\n{combined}"
        )


# ─── opt-in full E2E ─────────────────────────────────────────────────────────


@pytest.mark.skipif(
    os.environ.get("RUN_REPROCESS_E2E") != "1",
    reason="set RUN_REPROCESS_E2E=1 to enable; heavy — 3-5 minutes against match 250",
)
def test_reprocess_full_flow_against_match_250() -> None:
    """Opt-in full reprocess against match 250.

    Runs the real 9-step pipeline:
      create → ingest → repromote-loadout → repromote-lobby → validate
      → activate → consolidate-loadouts → backfill-event-actor-resolution.

    Takes 3-5 minutes and modifies the DB (creates a new
    ocr_decoder_runs row, flips activation, consolidates loadout
    snapshots, re-resolves event actors). Use only when validating
    the operational flow before Task 10/11 manual runs.

    No assertions on intermediate state — just exits 0 if the full
    pipeline runs cleanly end-to-end.
    """
    repo_root = Path(__file__).resolve().parents[3]
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{repo_root / 'tools' / 'video_ingest'}:{repo_root / 'tools' / 'game_ocr'}"
    cmd = [
        sys.executable, "-m", "video_ingest.cli",
        "reprocess", "--match-id", "250",
    ]
    res = subprocess.run(cmd, env=env, cwd=repo_root)
    assert res.returncode == 0, f"reprocess exited {res.returncode}"
