"""Milestone ④ Task 4.1 — batch enumerate / dedup / prioritize (pure).

These three functions are the corpus-planning front of the unattended
mass-ingest run loop (Task 4.3). They are pure (filesystem-only for
enumerate/dedup; in-memory for prioritize) so they are fully testable
with ``tmp_path`` fixtures — no DB, no GPU, mirroring
``test_reprocess_cli.py``'s helper-unit layer.

Task 4.1 scope:
  - ``enumerate_targets(video_root, since)`` — list candidate video paths
    (loose top-level recordings + exact ``match<id>/`` folders), filtered
    by basename date ``>= since``; landmine sibling dirs excluded.
  - ``dedup_by_sha(paths, known_shas)`` — collapse byte-identical copies
    to one ``BatchTarget`` (first path wins), flag ``already_ingested``.
  - ``prioritize(targets)`` — stable order api-missed(0) < covered(1)
    < partial(2).
"""

from __future__ import annotations

import importlib
import os
from datetime import date
from pathlib import Path

import pytest

from video_ingest import batch_ingest as bi
from video_ingest.batch_ingest import BatchTarget


SINCE = date(2026, 5, 8)


# ─── enumerate_targets ───────────────────────────────────────────────────────


def _touch(path: Path, content: bytes = b"x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def test_enumerate_finds_loose_and_match_folder_videos(tmp_path: Path) -> None:
    root = tmp_path
    loose_in = _touch(root / "2026-05-22_19-07-03.mkv")
    folder_in = _touch(root / "match250" / "2026-05-08_18-25-42.mkv")

    found = bi.enumerate_targets(root, SINCE)

    assert loose_in in found
    assert folder_in in found


def test_enumerate_excludes_pre_since_recordings(tmp_path: Path) -> None:
    root = tmp_path
    _touch(root / "2026-05-01_10-00-00.mkv")  # before since → dropped
    keep = _touch(root / "2026-05-08_00-00-01.mkv")  # boundary day → kept

    found = bi.enumerate_targets(root, SINCE)

    assert found == [keep]


def test_enumerate_excludes_landmine_and_non_match_dirs(tmp_path: Path) -> None:
    root = tmp_path
    real = _touch(root / "match2577" / "2026-05-22_12-19-16.mkv")
    _touch(root / "match2577-bench-frames" / "2026-05-22_12-19-16.mkv")  # landmine
    _touch(root / "Clips" / "2026-05-22_12-19-16.mkv")  # non-match dir

    found = bi.enumerate_targets(root, SINCE)

    assert found == [real]


def test_enumerate_ignores_non_video_files(tmp_path: Path) -> None:
    root = tmp_path
    keep = _touch(root / "2026-05-22_19-07-03.mkv")
    _touch(root / "2026-05-22_19-07-03.txt")  # not a video
    _touch(root / "notes.md")  # no date, not a video

    found = bi.enumerate_targets(root, SINCE)

    assert found == [keep]


def test_enumerate_accepts_mp4_and_remuxed_variants(tmp_path: Path) -> None:
    root = tmp_path
    a = _touch(root / "2026-05-11_18-17-06.mp4")
    b = _touch(root / "2026-05-06_22-48-50.remuxed.mkv", content=b"old")  # pre-since
    c = _touch(root / "2026-05-22_19-07-03.remuxed.mkv")

    found = bi.enumerate_targets(root, SINCE)

    assert a in found
    assert c in found
    assert b not in found  # 2026-05-06 < since


# ─── dedup_by_sha ────────────────────────────────────────────────────────────


def test_dedup_collapses_byte_identical_copies(tmp_path: Path) -> None:
    # Two byte-identical files (e.g. a .mkv and its .mp4 remux copy) must
    # collapse to ONE target; the lexicographically-first path wins.
    p_mp4 = _touch(tmp_path / "2026-05-22_19-07-03.mp4", content=b"same-bytes")
    p_mkv = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"same-bytes")

    targets = bi.dedup_by_sha([p_mp4, p_mkv], known_shas=set())

    assert len(targets) == 1
    assert targets[0].path == p_mkv  # ".mkv" sorts before ".mp4"


def test_dedup_keeps_distinct_content_separate(tmp_path: Path) -> None:
    a = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"aaa")
    b = _touch(tmp_path / "2026-05-22_20-53-59.mkv", content=b"bbb")

    targets = bi.dedup_by_sha([a, b], known_shas=set())

    assert len(targets) == 2
    assert {t.path for t in targets} == {a, b}


def test_dedup_flags_already_ingested_from_known_shas(tmp_path: Path) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"ingested")
    sha = bi._file_sha256(p)

    targets = bi.dedup_by_sha([p], known_shas={sha})

    assert len(targets) == 1
    assert targets[0].already_ingested is True
    assert targets[0].sha256 == sha


def test_dedup_not_ingested_when_sha_absent(tmp_path: Path) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"fresh")

    targets = bi.dedup_by_sha([p], known_shas={"deadbeef"})

    assert targets[0].already_ingested is False


def test_dedup_classifies_kind_from_parent(tmp_path: Path) -> None:
    loose = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"loose")
    folder = _touch(tmp_path / "match250" / "2026-05-08_18-25-42.mkv", content=b"fld")

    targets = {t.path: t for t in bi.dedup_by_sha([loose, folder], known_shas=set())}

    assert targets[loose].kind == "loose"
    assert targets[folder].kind == "match_folder"


# ─── prioritize ──────────────────────────────────────────────────────────────


def _target(priority: int, name: str) -> BatchTarget:
    return BatchTarget(
        path=Path(f"/vids/{name}.mkv"),
        sha256=name,
        kind="loose",
        priority=priority,
    )


def test_prioritize_orders_api_missed_first(tmp_path: Path) -> None:
    partial = _target(bi.PRIORITY_PARTIAL, "partial")
    missed = _target(bi.PRIORITY_API_MISSED, "missed")
    covered = _target(bi.PRIORITY_API_COVERED, "covered")

    ordered = bi.prioritize([partial, covered, missed])

    assert [t.priority for t in ordered] == [0, 1, 2]
    assert [t.sha256 for t in ordered] == ["missed", "covered", "partial"]


def test_prioritize_is_stable_within_a_priority(tmp_path: Path) -> None:
    first = _target(bi.PRIORITY_API_MISSED, "a")
    second = _target(bi.PRIORITY_API_MISSED, "b")

    ordered = bi.prioritize([first, second])

    assert [t.sha256 for t in ordered] == ["a", "b"]


def test_prioritize_does_not_mutate_input(tmp_path: Path) -> None:
    targets = [_target(bi.PRIORITY_PARTIAL, "p"), _target(bi.PRIORITY_API_MISSED, "m")]
    original = list(targets)

    bi.prioritize(targets)

    assert targets == original  # returns a new list, input untouched


# ─── preflight (Task 4.2) ────────────────────────────────────────────────────


def test_preflight_modules_covers_third_party_and_first_party_closure() -> None:
    """The closure the run loop imports = the critical third-party wheels plus
    every ``video_ingest``/``game_ocr`` submodule (discovered, not hand-listed)."""
    modules = bi._preflight_modules()

    # The wheels that historically vanish on a venv uv-sync must be smoke-tested.
    for wheel in ("pydantic", "onnxruntime", "rapidocr_onnxruntime"):
        assert wheel in modules, f"{wheel} missing from preflight closure"

    # Both first-party packages are walk-discovered, incl. heavy leaf modules.
    assert "video_ingest.orchestrator" in modules
    assert "video_ingest.batch_ingest" in modules
    assert "game_ocr.ocr" in modules
    assert "game_ocr.extractor" in modules

    # No package base names or duplicates leak into the import list.
    assert "video_ingest" not in modules
    assert "game_ocr" not in modules
    assert len(modules) == len(set(modules))


def test_preflight_raises_runtimeerror_naming_the_broken_import(monkeypatch) -> None:
    """A module in the closure that fails to import surfaces as a RuntimeError
    naming that module, with the ImportError preserved as the cause."""
    real_import = importlib.import_module

    def broken(name, *args, **kwargs):
        if name == "pydantic":
            raise ModuleNotFoundError("No module named 'pydantic'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(bi.importlib, "import_module", broken)

    with pytest.raises(RuntimeError) as excinfo:
        bi.preflight()

    assert "pydantic" in str(excinfo.value)
    assert isinstance(excinfo.value.__cause__, ImportError)


def test_preflight_raises_on_a_genuinely_missing_module(monkeypatch) -> None:
    """The real importer is exercised: an absent module name in the list makes
    preflight raise a RuntimeError that names it (no monkeypatched importer)."""
    missing = "video_ingest._preflight_no_such_module_zzz"
    monkeypatch.setattr(bi, "_preflight_modules", lambda: ["video_ingest", missing])

    with pytest.raises(RuntimeError) as excinfo:
        bi.preflight()

    assert missing in str(excinfo.value)


@pytest.mark.skipif(
    os.environ.get("RUN_BATCH_INTEGRATION") != "1",
    reason="set RUN_BATCH_INTEGRATION=1 to enable (requires the real OCR venv closure)",
)
def test_preflight_succeeds_in_the_real_venv() -> None:
    """In an environment with the full OCR closure installed, preflight is a
    no-op that returns None (mirrors test_reprocess_cli.py's gated integration)."""
    assert bi.preflight() is None
