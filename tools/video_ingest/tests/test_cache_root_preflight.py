"""Fail-closed preflight for the Pass-1 cache root.

``DEFAULT_INGEST_CACHE`` is ``/tmp/ingest-cache``, normally a symlink into a
durable store. ``/tmp`` does not survive a reboot. The dangerous state is not
the missing symlink -- it is a cache root that *exists* and holds no Pass-1
cache, because ``orchestrator.ingest`` mkdirs its per-sha subtree, finds no
``segments.json``, and silently re-decodes. At ~30-45 min per video over a
66-video corpus that is tens of hours of GPU time spent reproducing a cache
that was already on disk.

An empty root is legitimate exactly once (a genuinely fresh machine), so the
guard discriminates on CONTENT and takes an explicit per-invocation opt-in
rather than inferring intent.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from typer.testing import CliRunner

from video_ingest import batch_ingest as bi
from video_ingest import cli as cli_mod
from video_ingest import reprocess as reprocess_mod
from video_ingest.cli import app
from video_ingest.cache_root import (
    CacheRootUnusable,
    pass1_cache_entries,
    preflight_cache_root,
)


SHA_A = "a" * 64
SHA_B = "b" * 64

_SINCE = date(2026, 5, 8)


def _seed_cache(root: Path, *shas: str) -> Path:
    """A cache root holding a Pass-1 result for each of ``shas``."""
    for sha in shas:
        sha_dir = root / sha
        sha_dir.mkdir(parents=True, exist_ok=True)
        (sha_dir / "segments.json").write_text("{}")
    return root


# ─── pass1_cache_entries: the discriminator ──────────────────────────────────


def test_pass1_cache_entries_is_empty_for_a_missing_root(tmp_path: Path) -> None:
    assert pass1_cache_entries(tmp_path / "gone") == []


def test_pass1_cache_entries_is_empty_for_an_existing_but_empty_root(
    tmp_path: Path,
) -> None:
    """The reboot trap's exact shape: the root exists, so every existence
    check passes, but nothing in it saves a decode."""
    assert pass1_cache_entries(tmp_path) == []


def test_pass1_cache_entries_ignores_dirs_that_hold_no_pass1_result(
    tmp_path: Path,
) -> None:
    """``batch-logs-*`` dirs and half-written sha dirs are not a decode cache.
    Only ``segments.json`` -- the artifact whose absence triggers Pass 1 --
    counts."""
    (tmp_path / "batch-logs-20260803T000000Z").mkdir()
    (tmp_path / "sha-cache.json").write_text("{}")
    half = tmp_path / SHA_B
    half.mkdir()
    (half / "reels.json").write_text("[]")

    assert pass1_cache_entries(tmp_path) == []


def test_pass1_cache_entries_lists_populated_sha_dirs_sorted(tmp_path: Path) -> None:
    _seed_cache(tmp_path, SHA_B, SHA_A)
    (tmp_path / "batch-logs-20260803T000000Z").mkdir()

    assert pass1_cache_entries(tmp_path) == [tmp_path / SHA_A, tmp_path / SHA_B]


# ─── preflight_cache_root: fail closed ───────────────────────────────────────


def test_preflight_returns_the_entries_for_a_populated_root(tmp_path: Path) -> None:
    _seed_cache(tmp_path, SHA_A)

    assert preflight_cache_root(tmp_path, fallbacks=()) == [tmp_path / SHA_A]


def test_preflight_raises_when_the_root_does_not_exist(tmp_path: Path) -> None:
    with pytest.raises(CacheRootUnusable):
        preflight_cache_root(tmp_path / "gone", fallbacks=())


def test_preflight_raises_when_the_root_exists_but_holds_no_cache(
    tmp_path: Path,
) -> None:
    """The reboot trap. Existence is not the discriminator -- content is."""
    with pytest.raises(CacheRootUnusable):
        preflight_cache_root(tmp_path, fallbacks=())


def test_preflight_raises_when_the_root_holds_only_non_cache_entries(
    tmp_path: Path,
) -> None:
    (tmp_path / "batch-logs-20260803T000000Z").mkdir()
    (tmp_path / "sha-cache.json").write_text("{}")

    with pytest.raises(CacheRootUnusable):
        preflight_cache_root(tmp_path, fallbacks=())


def test_preflight_does_not_create_a_missing_root(tmp_path: Path) -> None:
    """Creating the root is how the trap gets laid -- an empty ``/tmp/ingest-cache``
    that every later existence check accepts. The guard must never do that."""
    missing = tmp_path / "gone"

    with pytest.raises(CacheRootUnusable):
        preflight_cache_root(missing, fallbacks=())

    assert not missing.exists()


# ─── the escape hatch ────────────────────────────────────────────────────────


def test_allow_empty_returns_no_entries_instead_of_raising(tmp_path: Path) -> None:
    """A genuinely fresh machine has no cache and must still be ingestable --
    but only under an explicit per-invocation opt-in."""
    assert preflight_cache_root(tmp_path, allow_empty=True, fallbacks=()) == []


def test_allow_empty_tolerates_a_root_that_does_not_exist_yet(tmp_path: Path) -> None:
    assert preflight_cache_root(tmp_path / "gone", allow_empty=True, fallbacks=()) == []


def test_the_diagnostic_names_the_escape_hatch(tmp_path: Path) -> None:
    """The operator has to be able to act on the failure without reading source."""
    with pytest.raises(CacheRootUnusable) as exc:
        preflight_cache_root(tmp_path, fallbacks=())

    assert "--allow-empty-cache" in str(exc.value)


def test_the_diagnostic_names_the_root_it_rejected(tmp_path: Path) -> None:
    with pytest.raises(CacheRootUnusable) as exc:
        preflight_cache_root(tmp_path, fallbacks=())

    assert str(tmp_path) in str(exc.value)


def test_the_diagnostic_points_at_a_fallback_that_holds_the_cache(
    tmp_path: Path,
) -> None:
    """The live failure mode is a lost ``/tmp`` symlink while the real store sits
    untouched under ``$HOME``. Say so, with the count, so the fix is obvious."""
    empty = tmp_path / "tmp-cache"
    empty.mkdir()
    home = _seed_cache(tmp_path / "home-cache", SHA_A, SHA_B)

    with pytest.raises(CacheRootUnusable) as exc:
        preflight_cache_root(empty, fallbacks=(home,))

    message = str(exc.value)
    assert str(home) in message
    assert "2" in message


def test_the_diagnostic_does_not_claim_a_fallback_that_is_also_empty(
    tmp_path: Path,
) -> None:
    """A false 'your cache is over here' would send the operator chasing a dir
    that cannot help."""
    empty = tmp_path / "tmp-cache"
    empty.mkdir()
    other = tmp_path / "home-cache"
    other.mkdir()

    with pytest.raises(CacheRootUnusable) as exc:
        preflight_cache_root(empty, fallbacks=(other,))

    assert str(other) not in str(exc.value)


def test_a_populated_fallback_does_not_silently_become_the_root(
    tmp_path: Path,
) -> None:
    """Reporting the fallback is a diagnostic, not a redirect. Auto-switching
    would split the run between two roots -- Pass-2 frames and the sidecars the
    caller reads back are addressed off the module constant, not off a return
    value."""
    empty = tmp_path / "tmp-cache"
    empty.mkdir()
    home = _seed_cache(tmp_path / "home-cache", SHA_A)

    with pytest.raises(CacheRootUnusable):
        preflight_cache_root(empty, fallbacks=(home,))


# ─── pipeline entry points ───────────────────────────────────────────────────
#
# The unit tests above prove the predicate. These prove the guard is actually
# WIRED -- that a lost cache root stops the run before it spends GPU time.


class _NoSubprocess:
    """Stands in for every mutating subprocess seam; records that it never ran."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def __call__(self, cmd, *, description=None, **kwargs):
        self.calls.append(list(cmd))
        return ""


def _blank_cache_root(monkeypatch, tmp_path: Path) -> Path:
    """Point the pipeline at an existing-but-empty root and cut the fallbacks,
    so the test never consults the operator's real ``~/ingest-cache``."""
    root = tmp_path / "ingest-cache"
    root.mkdir()
    monkeypatch.setattr(bi, "DEFAULT_INGEST_CACHE", root)
    monkeypatch.setattr(reprocess_mod, "DEFAULT_INGEST_CACHE", root)
    monkeypatch.setattr("video_ingest.cache_root.CACHE_ROOT_FALLBACKS", ())
    return root


def test_run_batch_refuses_to_ingest_when_the_cache_root_is_unusable(
    monkeypatch, tmp_path: Path
) -> None:
    _blank_cache_root(monkeypatch, tmp_path)
    rec = _NoSubprocess()
    monkeypatch.setattr(bi, "preflight", lambda: None)
    monkeypatch.setattr(bi, "_run_streaming", rec)
    monkeypatch.setattr(
        bi,
        "_collect_targets",
        lambda _root, _since: pytest.fail("planned before the cache preflight"),
    )

    with pytest.raises(CacheRootUnusable):
        bi.run_batch(Path("/vids"), _SINCE)

    assert rec.calls == []


def test_run_batch_dry_run_refuses_too(monkeypatch, tmp_path: Path) -> None:
    """A dry-run that prints a plan against a phantom root is the misleading
    output the guard exists to prevent."""
    _blank_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(bi, "preflight", lambda: None)

    with pytest.raises(CacheRootUnusable):
        bi.run_batch(Path("/vids"), _SINCE, dry_run=True)


def test_run_batch_allow_empty_cache_proceeds(monkeypatch, tmp_path: Path) -> None:
    _blank_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(bi, "preflight", lambda: None)
    monkeypatch.setattr(bi, "_collect_targets", lambda _root, _since: [])

    bi.run_batch(Path("/vids"), _SINCE, allow_empty_cache=True)


def test_run_promote_refuses_to_reingest_when_the_cache_root_is_unusable(
    monkeypatch, tmp_path: Path
) -> None:
    """``run_promote`` is the 66-video path: it re-ingests WITHOUT --force-pass1
    and its own docstring calls the decode a cache hit. An empty root turns
    every one of those into a full re-decode."""
    _blank_cache_root(monkeypatch, tmp_path)
    rec = _NoSubprocess()
    monkeypatch.setattr(bi, "preflight", lambda: None)
    monkeypatch.setattr(bi, "_run_streaming", rec)
    monkeypatch.setattr(
        bi,
        "_promote_plan",
        lambda _root, _since: pytest.fail("planned before the cache preflight"),
    )

    with pytest.raises(CacheRootUnusable):
        bi.run_promote(Path("/vids"), _SINCE)

    assert rec.calls == []


def test_run_promote_allow_empty_cache_proceeds(monkeypatch, tmp_path: Path) -> None:
    _blank_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(bi, "preflight", lambda: None)
    monkeypatch.setattr(bi, "_promote_plan", lambda _root, _since: [])
    monkeypatch.setattr(
        bi, "_promote_summary_path", lambda _started: tmp_path / "summary.json"
    )

    bi.run_promote(Path("/vids"), _SINCE, allow_empty_cache=True)


def test_reprocess_refuses_when_the_cache_root_is_unusable(
    monkeypatch, tmp_path: Path
) -> None:
    """``reprocess`` force-decodes, so it loses no cache hit -- but it WRITES its
    Pass-2 output and the run-quality sidecars into the root. Against a phantom
    root that output lands somewhere the corpus cache will never see."""
    root = _blank_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(
        reprocess_mod,
        "_compute_hashes",
        lambda _version: pytest.fail("hashed before the cache preflight"),
    )
    monkeypatch.setattr(
        reprocess_mod,
        "_run_decoder_runs_cli",
        lambda *a, **k: pytest.fail("touched the DB before the cache preflight"),
    )

    result = CliRunner().invoke(app, ["reprocess", "--match-id", "250", "--dry-run"])

    assert result.exit_code == 1
    assert "cache preflight FAILED" in result.output
    assert str(root) in result.output


def test_reprocess_undo_does_not_need_a_cache(monkeypatch, tmp_path: Path) -> None:
    """``--undo`` reverses an activation in the DB; it neither reads nor writes
    the cache, so gating it would be a false positive."""
    _blank_cache_root(monkeypatch, tmp_path)
    seen: list[tuple] = []
    monkeypatch.setattr(
        reprocess_mod,
        "_run_decoder_runs_cli",
        lambda *a, **k: (seen.append(a), {"ok": True})[1],
    )

    result = CliRunner().invoke(app, ["reprocess", "--match-id", "250", "--undo"])

    assert result.exit_code == 0
    assert seen and seen[0][0] == "undo"


# ─── CLI surface: the escape hatch has to be reachable ───────────────────────


def test_reprocess_cli_exposes_the_escape_hatch(monkeypatch, tmp_path: Path) -> None:
    _blank_cache_root(monkeypatch, tmp_path)
    reached: list[str] = []
    monkeypatch.setattr(
        reprocess_mod,
        "_compute_hashes",
        lambda _version: (reached.append("hashes"), ("w", "c"))[1],
    )
    monkeypatch.setattr(reprocess_mod, "_resolve_video_paths", lambda _m: [])

    CliRunner().invoke(
        app, ["reprocess", "--match-id", "250", "--dry-run", "--allow-empty-cache"]
    )

    assert reached == ["hashes"]


def test_batch_cli_exposes_the_escape_hatch(monkeypatch, tmp_path: Path) -> None:
    seen: dict = {}
    monkeypatch.setattr(
        cli_mod,
        "run_batch",
        lambda *a, **k: seen.update(k),
    )
    video_root = tmp_path / "vids"
    video_root.mkdir()

    result = CliRunner().invoke(
        app, ["batch", "--video-root", str(video_root), "--allow-empty-cache"]
    )

    assert result.exit_code == 0
    assert seen["allow_empty_cache"] is True


def test_batch_promote_cli_exposes_the_escape_hatch(
    monkeypatch, tmp_path: Path
) -> None:
    seen: dict = {}
    monkeypatch.setattr(
        cli_mod,
        "run_promote",
        lambda *a, **k: seen.update(k),
    )
    video_root = tmp_path / "vids"
    video_root.mkdir()

    result = CliRunner().invoke(
        app, ["batch-promote", "--video-root", str(video_root), "--allow-empty-cache"]
    )

    assert result.exit_code == 0
    assert seen["allow_empty_cache"] is True


def test_batch_cli_defaults_the_escape_hatch_off(monkeypatch, tmp_path: Path) -> None:
    """The guard is only worth anything if the default is the safe one."""
    seen: dict = {}
    monkeypatch.setattr(cli_mod, "run_batch", lambda *a, **k: seen.update(k))
    video_root = tmp_path / "vids"
    video_root.mkdir()

    CliRunner().invoke(app, ["batch", "--video-root", str(video_root)])

    assert seen["allow_empty_cache"] is False


def test_batch_cli_reports_an_unusable_cache_as_a_clean_exit_1(
    monkeypatch, tmp_path: Path
) -> None:
    """A traceback would read as a crash; this is an operator-fixable state."""
    _blank_cache_root(monkeypatch, tmp_path)
    monkeypatch.setattr(bi, "preflight", lambda: None)
    video_root = tmp_path / "vids"
    video_root.mkdir()

    result = CliRunner().invoke(app, ["batch", "--video-root", str(video_root)])

    assert result.exit_code == 1
    assert "cache preflight FAILED" in result.output
    assert "Traceback" not in result.output
