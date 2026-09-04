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
   create-ingest-promote-validate-activate flow against match 250 (the
   canonical pilot match). Decode-bound: ~1 hour, measured 1:06:43.
   Skipped by default, and fail-closed unless ``DATABASE_URL`` names a
   disposable clone.

5. **Isolation regressions**: the source-video lookup is bound to
   ``DATABASE_URL`` (never a hard-coded production container), and the
   writing E2E refuses the clone source / any production-shaped
   database. These run always — no DB, no opt-in.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

import pytest
from typer.testing import CliRunner

from video_ingest import reprocess as reprocess_mod
from video_ingest.cli import app


def _seeded_cache_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Redirect the decode cache root into ``tmp_path``, holding one cached video.

    Redirected so the test doesn't write to the real ``/tmp/ingest-cache`` shared
    with the operator's workstation; POPULATED because reprocess preflights the
    root and fails closed on one that holds no Pass-1 cache
    (:mod:`video_ingest.cache_root`) — these tests exercise the healthy path.
    """
    cache_dir = tmp_path / "ingest-cache"
    cached = cache_dir / ("e" * 64)
    cached.mkdir(parents=True)
    (cached / "segments.json").write_text("{}")
    monkeypatch.setattr(reprocess_mod, "DEFAULT_INGEST_CACHE", cache_dir)
    return cache_dir


# ─── CLI-surface tests (Task 8 carry-over) ───────────────────────────────────


def test_reprocess_subcommand_help_lists_required_args() -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--help"])
    assert result.exit_code == 0, result.stdout
    assert "--match-id" in result.stdout
    assert "--video" in result.stdout
    assert "--dry-run" in result.stdout
    assert "--undo" in result.stdout
    assert "--halt-before-activate" in result.stdout


def test_reprocess_subcommand_is_registered() -> None:
    runner = CliRunner()
    # `--match-id` is required; bare `reprocess` must error.
    result = runner.invoke(app, ["reprocess"])
    assert result.exit_code != 0


def test_reprocess_dry_run_includes_consolidate_and_backfill_steps(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
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

    _seeded_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(
        reprocess_mod, "_compute_hashes",
        lambda version: ("a" * 64, "b" * 64),
    )
    monkeypatch.setattr(
        reprocess_mod, "_resolve_video_paths",
        lambda match_id: [(Path("/tmp/fake-video.mkv"), "c" * 64)],
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


def test_reprocess_halt_before_activate_stops_after_validate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``--halt-before-activate`` (Phase G2) must run steps 1-6
    (create->ingest->promote->validate) then STOP before activate,
    printing the candidate run_id so the caller can score the pre-flip
    field-benchmark gate. It must NOT call ``activate`` (or the
    post-activate consolidate/backfill steps).

    Pure CLI-surface test: the DB-touching helpers are stubbed. The
    decoder-runs CLI stub records every subcommand it is asked to run so
    the test can assert ``activate`` was never reached.
    """
    fake_match = 250
    fake_run_id = 9999
    cli_calls: list[str] = []
    streaming_calls: list[str] = []

    _seeded_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(
        reprocess_mod, "_compute_hashes",
        lambda version: ("a" * 64, "b" * 64),
    )
    monkeypatch.setattr(
        reprocess_mod, "_resolve_video_paths",
        lambda match_id: [(Path("/tmp/fake-video.mkv"), "c" * 64)],
    )

    def fake_cli(*args: str) -> dict:
        cli_calls.append(args[0])
        if args[0] == "create-candidate":
            return {"run_id": fake_run_id, "is_active": False, "_exit": 0}
        if args[0] == "validate":
            return {"_exit": 0, "ok": True, "details": {}}
        return {"_exit": 0}

    monkeypatch.setattr(reprocess_mod, "_run_decoder_runs_cli", fake_cli)
    # Steps 4-5 (ingest + repromote) shell out via _run_streaming; no-op them.
    monkeypatch.setattr(
        reprocess_mod, "_run_streaming",
        lambda cmd, *, description: streaming_calls.append(description),
    )

    runner = CliRunner()
    result = runner.invoke(
        app, ["reprocess", "--match-id", str(fake_match), "--halt-before-activate"]
    )
    assert result.exit_code == 0, (
        f"halt exited {result.exit_code}; exception={result.exception!r}\n"
        f"stdout:\n{result.stdout}"
    )

    # It reached validate but stopped there — activate never ran.
    assert "create-candidate" in cli_calls
    assert "validate" in cli_calls
    assert "activate" not in cli_calls, (
        f"activate must not run under --halt-before-activate; cli_calls={cli_calls}"
    )

    # The halt payload carries the candidate run_id for the pre-flip gate.
    blobs = [
        json.loads(blob)
        for blob in result.stdout.replace("}\n{", "}|||{").split("|||")
        if blob.strip().startswith("{")
    ]
    halt_blob = next(b for b in blobs if b.get("step") == "halt-before-activate")
    assert halt_blob["halted"] is True
    assert halt_blob["candidate_run_id"] == fake_run_id
    assert halt_blob["match_id"] == fake_match


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
# The sha lookup is stubbed via _recorded_video_shas; these assert ONLY the
# folder resolution: no-space `match<id>` preferred, historical `match <id>`
# fallback, EXACT dir names (never a prefix glob that would grab
# `match<id>-label-frames`).


def _stub_sha(monkeypatch: pytest.MonkeyPatch, sha: str = "d" * 64) -> None:
    monkeypatch.setattr(reprocess_mod, "_recorded_video_shas", lambda _mid: [sha])


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
    monkeypatch.setattr(reprocess_mod, "_recorded_video_shas", lambda _mid: [sha])

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


# ─── _resolve_video_paths multi-video resolution ─────────────────────────────
#
# The plural resolver pairs EVERY recorded video_sha256 with its on-disk file
# (`.mkv` OR `.mp4`), skipping shas with no file, so a two-video match (463: a
# main `.mkv` + a separate loadout `.mp4`) re-ingests both sources.


def test_resolve_video_paths_pairs_all_recorded_shas_with_ondisk_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two recorded shas → two files (one .mkv, one .mp4). A third recorded sha
    with no on-disk file is skipped. Sibling `-label-frames` dir is never
    scanned (exact-dir landmine still holds via _resolve_match_dir)."""
    monkeypatch.setattr(reprocess_mod, "DEFAULT_VIDEO_ROOT", tmp_path)
    match_dir = tmp_path / "match463"
    match_dir.mkdir()
    mkv = match_dir / "main.mkv"
    mp4 = match_dir / "loadout.mp4"
    mkv.write_bytes(b"main-recording-463")
    mp4.write_bytes(b"loadout-cards-463")
    sha_mkv = reprocess_mod._file_sha256(mkv)
    sha_mp4 = reprocess_mod._file_sha256(mp4)
    # Decoy sibling a prefix glob would wrongly scan.
    decoy = tmp_path / "match463-label-frames"
    decoy.mkdir()
    (decoy / "decoy.mkv").write_bytes(b"decoy")

    # The lookup returns 3 recorded shas; the 3rd has no file on disk.
    recorded = [sha_mkv, sha_mp4, "e" * 64]
    monkeypatch.setattr(reprocess_mod, "_recorded_video_shas", lambda _mid: recorded)

    resolved = reprocess_mod._resolve_video_paths(463)
    assert {p for p, _ in resolved} == {mkv, mp4}
    assert dict((s, p) for p, s in resolved) == {sha_mkv: mkv, sha_mp4: mp4}
    # Off-disk sha absent; decoy never selected.
    assert all(s != "e" * 64 for _, s in resolved)
    assert all("label-frames" not in str(p) for p, _ in resolved)
    # Deterministic order: sorted by path.
    assert resolved == sorted(resolved, key=lambda pv: str(pv[0]))


def test_resolve_video_paths_raises_when_no_recorded_sha_on_disk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every recorded sha is off-disk → clear error naming what was recorded
    vs found (mirrors the single-resolver's fail-closed contract)."""
    monkeypatch.setattr(reprocess_mod, "DEFAULT_VIDEO_ROOT", tmp_path)
    match_dir = tmp_path / "match463"
    match_dir.mkdir()
    (match_dir / "main.mkv").write_bytes(b"present-but-unrecorded")
    monkeypatch.setattr(reprocess_mod, "_recorded_video_shas", lambda _mid: ["f" * 64])

    with pytest.raises(RuntimeError, match=r"none of the .* files in .* match a recorded"):
        reprocess_mod._resolve_video_paths(463)


def test_resolve_video_paths_raises_when_no_recorded_sha_at_all(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No video_sha256 rows for the match → the re-ingest-first error, before
    any disk scan."""
    monkeypatch.setattr(reprocess_mod, "DEFAULT_VIDEO_ROOT", tmp_path)
    monkeypatch.setattr(reprocess_mod, "_recorded_video_shas", lambda _mid: [])
    with pytest.raises(RuntimeError, match=r"no video_sha256 recorded for match 463"):
        reprocess_mod._resolve_video_paths(463)


def test_reprocess_multiple_video_flags_ingest_each(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`--video A --video B` ingests BOTH into ONE candidate run: exactly one
    create-candidate, one ingest per source (`video 1/2`, `video 2/2`)."""
    fake_run_id = 4242
    cli_calls: list[str] = []
    streaming_descs: list[str] = []

    vid_a = tmp_path / "main.mkv"
    vid_b = tmp_path / "loadout.mp4"
    vid_a.write_bytes(b"aaa")
    vid_b.write_bytes(b"bbb")

    _seeded_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(
        reprocess_mod, "_compute_hashes", lambda version: ("a" * 64, "b" * 64)
    )

    def fake_cli(*args: str) -> dict:
        cli_calls.append(args[0])
        if args[0] == "create-candidate":
            return {"run_id": fake_run_id, "is_active": False, "_exit": 0}
        if args[0] == "validate":
            return {"_exit": 0, "ok": True, "details": {}}
        return {"_exit": 0}

    monkeypatch.setattr(reprocess_mod, "_run_decoder_runs_cli", fake_cli)
    monkeypatch.setattr(
        reprocess_mod, "_run_streaming",
        lambda cmd, *, description: streaming_descs.append(description),
    )

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "reprocess", "--match-id", "463",
            "--video", str(vid_a), "--video", str(vid_b),
            "--halt-before-activate",
        ],
    )
    assert result.exit_code == 0, (
        f"exit {result.exit_code}; exception={result.exception!r}\n{result.stdout}"
    )
    # Exactly one candidate run for both videos; activate never runs (halt).
    assert cli_calls.count("create-candidate") == 1
    assert "activate" not in cli_calls
    # One ingest per source video, correctly enumerated.
    ingest_descs = [d for d in streaming_descs if d.startswith("ingest match 463 video")]
    assert len(ingest_descs) == 2, streaming_descs
    assert any("video 1/2 (main.mkv)" in d for d in ingest_descs)
    assert any("video 2/2 (loadout.mp4)" in d for d in ingest_descs)


# ─── the source-video lookup is bound to DATABASE_URL ────────────────────────
#
# Regression cover for the verification-isolation defect: `_resolve_video_paths`
# used to read its rows with a hard-coded
# `docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl ...`, which
# ignores DATABASE_URL. Under the verification harness that meant the video
# lookup read PRODUCTION while every subsequent worker command wrote the
# disposable clone. The lookup now goes through `decoder-runs source-videos`,
# whose child inherits DATABASE_URL.

PROD_CONTAINER = "eanhl-team-website-db-1"


def _fake_completed(stdout: str, returncode: int = 0):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")


def test_recorded_video_shas_routes_through_the_decoder_runs_cli(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The lookup is a `decoder-runs source-videos --match-id N` shell-out —
    the one channel in this module whose child inherits DATABASE_URL."""
    calls: list[tuple[str, ...]] = []

    def fake_cli(*args: str) -> dict:
        calls.append(args)
        return {"match_id": 250, "video_sha256": ["a" * 64, "b" * 64], "_exit": 0}

    monkeypatch.setattr(reprocess_mod, "_run_decoder_runs_cli", fake_cli)

    assert reprocess_mod._recorded_video_shas(250) == ["a" * 64, "b" * 64]
    assert calls == [("source-videos", "--match-id", "250")]


def test_recorded_video_shas_rejects_a_payload_without_the_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A malformed payload fails closed rather than silently resolving zero
    sources (which the caller would report as 're-ingest at least once')."""
    monkeypatch.setattr(
        reprocess_mod, "_run_decoder_runs_cli", lambda *_a: {"_exit": 0}
    )
    with pytest.raises(RuntimeError, match=r"returned no video_sha256 list"):
        reprocess_mod._recorded_video_shas(250)


def test_reprocess_video_lookup_never_addresses_the_production_container(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Drive the REAL `_recorded_video_shas` -> `_run_decoder_runs_cli` chain with
    only the process boundary faked, and assert on the argv that would have been
    executed: it is the worker CLI, and it names neither `docker` nor the
    production container/database."""
    spawned: list[list[str]] = []

    def fake_run(cmd, *_a, **kw):  # type: ignore[no-untyped-def]
        spawned.append(list(cmd))
        return _fake_completed(json.dumps({"match_id": 463, "video_sha256": ["c" * 64]}) + "\n")

    monkeypatch.setattr(reprocess_mod.subprocess, "run", fake_run)
    monkeypatch.setattr(reprocess_mod, "DEFAULT_VIDEO_ROOT", tmp_path)
    match_dir = tmp_path / "match463"
    match_dir.mkdir()
    real = match_dir / "main.mkv"
    real.write_bytes(b"payload-463")
    monkeypatch.setattr(reprocess_mod, "_file_sha256", lambda _p: "c" * 64)

    resolved = reprocess_mod._resolve_video_paths(463)
    assert resolved == [(real, "c" * 64)]

    assert len(spawned) == 1, spawned
    cmd = spawned[0]
    assert cmd[:4] == ["pnpm", "--filter", "@eanhl/worker", "decoder-runs"]
    assert "source-videos" in cmd
    flat = " ".join(cmd)
    assert "docker" not in flat, flat
    assert PROD_CONTAINER not in flat, flat
    # The hard-coded production psql credentials/database must not appear either.
    assert "psql" not in flat, flat
    assert "-d eanhl" not in flat, flat


def _install_recording_docker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Put a recording `docker` first on PATH. It appends its argv to a log and
    exits non-zero, so any invocation is both recorded AND fatal."""
    bindir = tmp_path / "fakebin"
    bindir.mkdir()
    log = tmp_path / "docker-invocations.log"
    shim = bindir / "docker"
    shim.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$*" >> "{log}"\n'
        'echo "docker must not be invoked by the reprocess video lookup" >&2\n'
        "exit 97\n"
    )
    shim.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}")
    return log


def test_reprocess_video_lookup_does_not_execute_any_docker_binary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With a recording `docker` shim first on PATH, the lookup completes and the
    shim is never executed. This catches a re-introduced `docker exec` that an
    argv assertion on a faked boundary could miss."""
    log = _install_recording_docker(tmp_path, monkeypatch)

    monkeypatch.setattr(
        reprocess_mod,
        "_run_decoder_runs_cli",
        lambda *_a: {"match_id": 250, "video_sha256": ["d" * 64], "_exit": 0},
    )
    assert reprocess_mod._recorded_video_shas(250) == ["d" * 64]
    assert not log.exists(), f"docker was invoked: {log.read_text()}"


def test_recorded_video_shas_reads_the_database_named_by_database_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rows come from the database DATABASE_URL selects.

    A `pnpm` shim first on PATH answers with a sha derived from the DATABASE_URL
    it was handed. Two different DSNs therefore yield two different results
    through the unmodified production code path — which is exactly the property
    the old hard-coded `docker exec` did not have (it returned production's rows
    whatever DATABASE_URL said). A recording `docker` shim is installed at the
    same time and must stay unused."""
    docker_log = _install_recording_docker(tmp_path, monkeypatch)
    bindir = tmp_path / "fakebin"
    shim = bindir / "pnpm"
    # Echo one JSON line whose sha encodes the database name from DATABASE_URL.
    shim.write_text(
        "#!/bin/sh\n"
        'db="${DATABASE_URL##*/}"\n'
        'printf \'{"match_id": 250, "video_sha256": ["%s"]}\\n\' "$db"\n'
    )
    shim.chmod(0o755)

    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5433/eanhl_test_777_abc")
    assert reprocess_mod._recorded_video_shas(250) == ["eanhl_test_777_abc"]

    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5433/eanhl_test_888_def")
    assert reprocess_mod._recorded_video_shas(250) == ["eanhl_test_888_def"]

    assert not docker_log.exists(), f"docker was invoked: {docker_log.read_text()}"


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
#
# This E2E WRITES. Two hazards it must survive, both found by review:
#
#  1. It must write only to a disposable clone. `_require_disposable_clone_dsn`
#     fails closed unless DATABASE_URL names `eanhl_test_<pid>_<base36ms>` — the
#     shape `apps/worker/scripts/lib/test-db-session.mjs` mints per run — on a
#     loopback host. The clone SOURCE (`eanhl_test`), anything production-shaped,
#     and any remote host are refused, so the test cannot be pointed at a
#     database that outlives it. This is DEFENCE IN DEPTH, not proof: the
#     authoritative evidence that the wrapper really provisioned the clone is
#     with-test-db.mjs's own attestation (system ID + container identity). A DSN
#     is self-asserted text; this guard only makes the obvious misfires — a
#     hand-set production DSN, a remote host — fail before anything is written.
#
#  2. It must stay repeatable. The seeded source database already holds the exact
#     NORMAL provenance tuple for match 250 (match_id, video_sha256,
#     DECODER_VERSION, weights_hash) as run 1993, and the clone inherits it. The
#     real command is SUPPOSED to collide there — `ocr_decoder_runs_provenance_uniq`
#     is the guarantee that an unchanged decoder cannot mint a second candidate,
#     and nothing here weakens it, reuses run 1993, or frees its tuple.
#     Instead the E2E mints its OWN provenance by replacing the module's
#     decoder-version constant, in-process, with a stable verification-only tag.
#
# Why in-process rather than a CLI flag or an env var: a flag/env override would
# put a provenance-forging affordance into the production command, where an
# operator could stamp a run with a version the decoder never had. Patching the
# module constant inside the test keeps that lever entirely out of production
# code — `reprocess()` reads DECODER_VERSION as a module global at call time, and
# it is the only reader (the ingest child is scoped by --run-id, not by version).
# The tag is honest: it is the real decoder version plus an explicit
# "-verification-e2e" marker, so a row it writes is self-describing rather than
# masquerading as a production run.

#: Suffix appended to DECODER_VERSION for E2E-minted runs. Stable across runs —
#: repeatability comes from the clone being fresh, not from a unique tag.
VERIFICATION_DECODER_SUFFIX = "-verification-e2e"

#: The disposable clone names test-db-session.mjs generates: eanhl_test_<pid>_<base36 ms>.
_DISPOSABLE_CLONE_NAME = re.compile(r"^eanhl_test_[0-9]+_[0-9a-z]+$")

#: The only hosts a disposable clone is ever reachable on. `with-test-db.mjs`
#: provisions the clone inside the local verification container and injects a
#: loopback DSN, so any other host — DNS name, non-loopback IPv4/IPv6, or an
#: absent host — is by construction not that clone. Strict membership, not a
#: prefix or range test: 127.0.0.2 and 10.0.0.9 are as remote as anything else
#: for this purpose, because the wrapper never emits them.
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _require_disposable_clone_dsn(database_url: Optional[str]) -> str:
    """Return the database name from ``database_url``, or raise.

    Fail-closed: accepts ONLY a `eanhl_test_<pid>_<timestamp>` clone reached over
    a loopback host (127.0.0.1, localhost, ::1). The clone source `eanhl_test`,
    the production database, any other database name, and every remote host —
    DNS, non-loopback IPv4, non-loopback IPv6, or no host at all — are refused,
    so this writing E2E cannot be run against a database that survives it.

    DEFENCE IN DEPTH, not proof. A DSN is text the caller supplies; matching the
    clone's name shape and a loopback host proves nothing cryptographically and
    does not establish that `with-test-db.mjs` ran. That proof is the wrapper's
    own attestation (system ID and container identity), which remains
    authoritative. This check exists so the cheap, plausible misfires — a
    hand-exported production DSN, a tunnel to a remote database, a stale shell
    still holding `.env` — are refused before the first write, instead of relying
    on the operator having gone through the wrapper.

    Diagnostics deliberately carry the DATABASE NAME ONLY — never the DSN, host,
    port, user or password. A refusal is printed by pytest and can end up in logs.
    """
    if not database_url or not database_url.strip():
        raise RuntimeError(
            "DATABASE_URL is not set. This E2E writes; run it through "
            "apps/worker/scripts/with-test-db.mjs, which provisions a disposable "
            "clone and injects its DATABASE_URL."
        )
    from urllib.parse import unquote, urlsplit

    try:
        parts = urlsplit(database_url.strip())
    except ValueError:
        raise RuntimeError("DATABASE_URL is not a valid URL.") from None
    if parts.scheme not in ("postgres", "postgresql"):
        raise RuntimeError("DATABASE_URL must be a postgres:// or postgresql:// DSN.")
    name = unquote(parts.path.lstrip("/"))
    if not name:
        raise RuntimeError("DATABASE_URL names no database.")
    if not _DISPOSABLE_CLONE_NAME.match(name):
        raise RuntimeError(
            f"refusing to run the writing reprocess E2E against database {name!r}: "
            f"only a disposable clone named eanhl_test_<pid>_<timestamp> is accepted "
            f"(the clone SOURCE eanhl_test and any production-shaped name are refused). "
            f"Run it through apps/worker/scripts/with-test-db.mjs."
        )
    # `.hostname` is lowercased and has IPv6 brackets stripped, so `[::1]` and
    # `LocalHost` both normalise into the set. A DSN with no host at all (unix
    # socket, or `postgresql:///name`) yields None and is refused: the wrapper
    # always injects an explicit loopback host.
    host = parts.hostname
    if host not in _LOOPBACK_HOSTS:
        raise RuntimeError(
            f"refusing to run the writing reprocess E2E against database {name!r}: "
            f"its DSN names no host or a non-loopback host, and a disposable clone "
            f"only ever lives on 127.0.0.1, localhost or ::1. "
            f"Run it through apps/worker/scripts/with-test-db.mjs."
        )
    return name


@pytest.mark.skipif(
    os.environ.get("RUN_REPROCESS_E2E") != "1",
    reason="set RUN_REPROCESS_E2E=1 to enable; heavy — ~1h decode-bound against match 250",
)
def test_reprocess_full_flow_against_match_250(monkeypatch: pytest.MonkeyPatch) -> None:
    """Opt-in full reprocess against match 250, on a disposable clone.

    Runs the real 9-step pipeline:
      create → ingest → repromote-loadout → repromote-lobby → validate
      → activate → consolidate-loadouts → backfill-event-actor-resolution.

    Every DB access in that pipeline — the source-video lookup included — resolves
    through DATABASE_URL, which `with-test-db.mjs` has pointed at the clone. The
    run is stamped with verification-only provenance so it does not collide with
    the normal production tuple the clone already carries.

    Decode-bound: `--force-pass1/--force-pass2` re-decode match 250's 32-minute
    1080p60 source, so budget ~1 hour (measured 1:06:43), not the few minutes an
    earlier note claimed. It writes freely — a new decoder run, an activation
    flip, consolidated snapshots, re-resolved event actors — all of which die
    with the clone.

    No assertions on intermediate state — it exits 0 only if the whole pipeline
    runs cleanly end-to-end.
    """
    clone = _require_disposable_clone_dsn(os.environ.get("DATABASE_URL"))
    verification_version = reprocess_mod.DECODER_VERSION + VERIFICATION_DECODER_SUFFIX
    monkeypatch.setattr(reprocess_mod, "DECODER_VERSION", verification_version)

    # ABSOLUTE PYTHONPATH for the ingest grandchild. `_run_streaming` spawns
    # `python3 -m video_ingest.cli ingest` with cwd=REPO_ROOT, so the relative
    # `PYTHONPATH=.:../game_ocr` the harness runs pytest under (relative to
    # tools/video_ingest) does not resolve there. The previous subprocess form of
    # this test built the same absolute value for its child env; running the
    # command in-process makes it this test's job instead.
    repo_root = Path(__file__).resolve().parents[3]
    monkeypatch.setenv(
        "PYTHONPATH",
        f"{repo_root / 'tools' / 'video_ingest'}:{repo_root / 'tools' / 'game_ocr'}",
    )

    print(
        f"[e2e] clone={clone} decoder_version={verification_version}",
        file=sys.stderr,
    )

    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--match-id", "250"])

    # Echo the command's own output. CliRunner captures `typer.echo`, so without
    # this the per-step JSON payloads (create-candidate, validate, activate)
    # would be visible only on failure — the previous subprocess form streamed
    # them live, and they are the operational record of the run. The heavy
    # ingest/promote stages are unaffected either way: `_run_streaming` inherits
    # the real stdout/stderr and never passes through CliRunner.
    print(result.output, file=sys.stderr)

    assert result.exit_code == 0, (
        f"reprocess exited {result.exit_code}; exception={result.exception!r}\n"
        f"{result.output}"
    )


# ─── E2E guard regressions (run always; no DB, no opt-in) ────────────────────


# Each negative case below is pinned to the ONE rule it exercises. The database
# name cases all use a loopback host, so they can only fail on the name; the host
# cases all use a perfectly valid clone name, so they can only fail on the host.
# (An earlier remote-host case paired 10.0.0.9 with the invalid name
# `eanhl_test_x_y` — it passed on the name rule and proved nothing about hosts.)
@pytest.mark.parametrize(
    "dsn",
    [
        None,
        "",
        "   ",
        # ── database name: loopback host, so only the name can be at fault ──
        "postgresql://u:s3cret@127.0.0.1:5433/eanhl",           # production
        "postgresql://u:s3cret@127.0.0.1:5433/eanhl_test",      # the clone SOURCE
        "postgresql://u:s3cret@127.0.0.1:5433/eanhl_prod",
        "postgresql://u:s3cret@127.0.0.1:5433/eanhl_test_x_y",  # non-numeric pid
        "postgresql://u:s3cret@127.0.0.1:5433/eanhl_test_12",   # no timestamp part
        "postgresql://u:s3cret@127.0.0.1:5433/eanhl_test_1_A1", # uppercase base36
        "postgresql://u:s3cret@127.0.0.1:5433/",
        "mysql://u:s3cret@127.0.0.1:3306/eanhl_test_1_a",
    ],
)
def test_e2e_guard_refuses_anything_that_is_not_a_disposable_clone(dsn) -> None:
    """The writing E2E is not directly runnable against the clone source or a
    production-shaped database."""
    with pytest.raises(RuntimeError):
        _require_disposable_clone_dsn(dsn)


@pytest.mark.parametrize(
    "dsn",
    [
        # Every one of these carries a database name that WOULD be accepted on a
        # loopback host, so the only thing that can refuse them is the host rule.
        "postgresql://u:s3cret@production.example:5432/eanhl_test_123_abc",
        "postgresql://u:s3cret@db.internal.example:5432/eanhl_test_1234_mk3x2p1q",
        "postgresql://u:s3cret@10.0.0.9:5432/eanhl_test_123_abc",
        "postgresql://u:s3cret@192.168.1.20:5432/eanhl_test_9_0",
        "postgresql://u:s3cret@127.0.0.2:5433/eanhl_test_123_abc",   # loopback /8, not the literal
        "postgresql://u:s3cret@[2001:db8::1]:5432/eanhl_test_123_abc",
        "postgresql://u:s3cret@[fd00::1]:5432/eanhl_test_9_0",
        "postgresql:///eanhl_test_123_abc",                          # no host at all
        "postgresql://u:s3cret@/eanhl_test_123_abc",                 # empty host
    ],
)
def test_e2e_guard_refuses_a_valid_clone_name_on_a_non_loopback_host(dsn: str) -> None:
    """A clone name alone is not enough: the DSN must also point at loopback.

    Without this rule `postgresql://u:p@production.example:5432/eanhl_test_123_abc`
    — a remote, production-shaped endpoint wearing a disposable clone's name —
    was accepted, and the writing E2E would have run against it.
    """
    with pytest.raises(RuntimeError):
        _require_disposable_clone_dsn(dsn)


@pytest.mark.parametrize(
    "dsn,expected",
    [
        ("postgresql://u:s3cret@127.0.0.1:5433/eanhl_test_1234_mk3x2p1q", "eanhl_test_1234_mk3x2p1q"),
        ("postgres://u:s3cret@localhost:5433/eanhl_test_9_0", "eanhl_test_9_0"),
        ("postgresql://u:s3cret@[::1]:5433/eanhl_test_778258_mtmkmje6", "eanhl_test_778258_mtmkmje6"),
        # Host comparison is case-insensitive (urlsplit lowercases `.hostname`),
        # and the port is not part of the rule.
        ("postgresql://u:s3cret@LocalHost/eanhl_test_1_a", "eanhl_test_1_a"),
    ],
)
def test_e2e_guard_accepts_a_disposable_clone(dsn: str, expected: str) -> None:
    assert _require_disposable_clone_dsn(dsn) == expected


def test_e2e_guard_host_refusal_leaks_no_host_or_credential() -> None:
    """The host refusal must not echo back the host it rejected.

    The rejected DSN is frequently the interesting one — a real remote endpoint —
    and pytest prints the message. It may name the database and nothing else.
    """
    dsn = "postgresql://eanhl_admin:sup3r-s3cret@production.example:5432/eanhl_test_123_abc"
    with pytest.raises(RuntimeError) as exc:
        _require_disposable_clone_dsn(dsn)
    msg = str(exc.value)
    for secret in ("sup3r-s3cret", "eanhl_admin", "production.example", "5432", dsn):
        assert secret not in msg, f"diagnostic leaked {secret!r}: {msg}"
    assert "eanhl_test_123_abc" in msg  # the database name itself is fair game


def test_e2e_guard_diagnostics_leak_no_credential_or_dsn() -> None:
    """A refusal names the database and nothing else — no password, user, host,
    port, or full DSN."""
    dsn = "postgresql://eanhl_admin:sup3r-s3cret@db.internal.example:5432/eanhl"
    with pytest.raises(RuntimeError) as exc:
        _require_disposable_clone_dsn(dsn)
    msg = str(exc.value)
    for secret in ("sup3r-s3cret", "eanhl_admin", "db.internal.example", "5432", dsn):
        assert secret not in msg, f"diagnostic leaked {secret!r}: {msg}"
    assert "eanhl" in msg  # the database name itself is fair game


def test_e2e_provenance_is_distinct_from_the_normal_production_tag() -> None:
    """The E2E's decoder version is the production one plus an explicit
    verification marker: distinct from the normal tuple the seeded clone already
    holds (so create-candidate does not collide), and honest about what it is."""
    verification_version = reprocess_mod.DECODER_VERSION + VERIFICATION_DECODER_SUFFIX
    assert verification_version != reprocess_mod.DECODER_VERSION
    assert verification_version.startswith(reprocess_mod.DECODER_VERSION)
    assert verification_version.endswith("-verification-e2e")
    # Stable, not random: repeatability comes from the disposable clone, and a
    # random tag would litter provenance with unreproducible versions.
    assert VERIFICATION_DECODER_SUFFIX == "-verification-e2e"


def test_e2e_provenance_override_is_not_reachable_from_the_production_cli() -> None:
    """The verification tag lives in the test module, not in the shipped command:
    `reprocess` exposes no decoder-version flag, and the module constant is the
    single source of the production tag."""
    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--help"])
    assert result.exit_code == 0
    assert "--decoder-version" not in result.stdout
    assert "verification" not in result.stdout.lower()
    src = (
        Path(reprocess_mod.__file__).read_text()  # type: ignore[arg-type]
    )
    assert VERIFICATION_DECODER_SUFFIX not in src
