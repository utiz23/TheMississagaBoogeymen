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


# ─── run_batch loop (Task 4.3) ───────────────────────────────────────────────


def _btarget(
    name: str,
    priority: int,
    *,
    already_ingested: bool = False,
) -> BatchTarget:
    """A fake deduped target — path/sha keyed on ``name`` so the recorder below
    can identify which target drove each subprocess call."""
    return BatchTarget(
        path=Path(f"/vids/{name}.mkv"),
        sha256=name,
        kind="loose",
        already_ingested=already_ingested,
        priority=priority,
    )


class _StreamRecorder:
    """Stand-in for ``_run_streaming`` — records every command and can raise for
    the target whose path fragment is ``raise_on`` (to exercise per-video
    isolation)."""

    def __init__(self, raise_on: str | None = None) -> None:
        self.cmds: list[list[str]] = []
        self.raise_on = raise_on

    def __call__(self, cmd: list[str], *, description: str) -> None:
        self.cmds.append(cmd)
        if self.raise_on is not None and self.raise_on in cmd:
            raise RuntimeError(f"boom: {self.raise_on}")

    def _flag(self, verb: str, flag: str) -> list[str]:
        """The value of ``flag`` for every recorded command that contains
        ``verb`` (e.g. every ``ingest`` call's ``--video``)."""
        out: list[str] = []
        for cmd in self.cmds:
            if verb in cmd and flag in cmd:
                out.append(cmd[cmd.index(flag) + 1])
        return out

    @property
    def ingest_videos(self) -> list[str]:
        return [Path(v).stem for v in self._flag("ingest", "--video")]

    @property
    def propose_shas(self) -> list[str]:
        return self._flag("propose", "--video-sha256")


def _patch_loop(
    monkeypatch,
    targets: list[BatchTarget],
    recorder: _StreamRecorder,
) -> dict[str, int]:
    """Wire run_batch's seams: a preflight counter, injected (unordered) targets
    via ``_collect_targets`` (so the real ``prioritize`` still runs), and the
    stream recorder in place of every mutating subprocess."""
    counters = {"preflight": 0}

    def _count_preflight() -> None:
        counters["preflight"] += 1

    monkeypatch.setattr(bi, "preflight", _count_preflight)
    monkeypatch.setattr(bi, "_collect_targets", lambda _root, _since: list(targets))
    monkeypatch.setattr(bi, "_run_streaming", recorder)
    return counters


def test_run_batch_preflights_once_and_processes_in_priority_order(
    monkeypatch, capsys
) -> None:
    # Injected out of priority order; the real prioritize must reorder to
    # api-missed(0) < covered(1) < partial(2).
    targets = [
        _btarget("p", bi.PRIORITY_PARTIAL),
        _btarget("m", bi.PRIORITY_API_MISSED),
        _btarget("c", bi.PRIORITY_API_COVERED),
    ]
    rec = _StreamRecorder()
    counters = _patch_loop(monkeypatch, targets, rec)

    bi.run_batch(Path("/vids"), SINCE)

    assert counters["preflight"] == 1
    # Each target ⇒ ingest then propose; ingest order == priority order.
    assert rec.ingest_videos == ["m", "c", "p"]
    assert rec.propose_shas == ["m", "c", "p"]


def test_run_batch_isolates_a_failing_target_and_continues(
    monkeypatch, capsys
) -> None:
    targets = [
        _btarget("m", bi.PRIORITY_API_MISSED),
        _btarget("c", bi.PRIORITY_API_COVERED),  # this one's ingest raises
        _btarget("p", bi.PRIORITY_PARTIAL),
    ]
    rec = _StreamRecorder(raise_on="/vids/c.mkv")
    _patch_loop(monkeypatch, targets, rec)

    bi.run_batch(Path("/vids"), SINCE)

    # All three ingests attempted (order preserved); c raised so its propose
    # never fires, but m and p complete fully.
    assert rec.ingest_videos == ["m", "c", "p"]
    assert rec.propose_shas == ["m", "p"]
    err = capsys.readouterr().err
    assert "SKIP" in err and "c" in err


def test_run_batch_dry_run_makes_zero_mutating_calls(monkeypatch, capsys) -> None:
    targets = [
        _btarget("m", bi.PRIORITY_API_MISSED),
        _btarget("c", bi.PRIORITY_API_COVERED),
    ]
    rec = _StreamRecorder()
    counters = _patch_loop(monkeypatch, targets, rec)

    bi.run_batch(Path("/vids"), SINCE, dry_run=True)

    assert counters["preflight"] == 1  # preflight still runs (cheap, safe)
    assert rec.cmds == []  # no ingest / no propose — nothing mutated
    assert "DRY-RUN" in capsys.readouterr().err


def test_run_batch_honors_limit(monkeypatch, capsys) -> None:
    targets = [
        _btarget("p", bi.PRIORITY_PARTIAL),
        _btarget("m", bi.PRIORITY_API_MISSED),
        _btarget("c", bi.PRIORITY_API_COVERED),
    ]
    rec = _StreamRecorder()
    _patch_loop(monkeypatch, targets, rec)

    bi.run_batch(Path("/vids"), SINCE, limit=2)

    # After prioritize [m, c, p], limit=2 keeps only m and c.
    assert rec.ingest_videos == ["m", "c"]


def test_run_batch_skips_already_ingested_without_mutating(
    monkeypatch, capsys
) -> None:
    targets = [
        _btarget("done", bi.PRIORITY_API_MISSED, already_ingested=True),
        _btarget("fresh", bi.PRIORITY_API_COVERED),
    ]
    rec = _StreamRecorder()
    _patch_loop(monkeypatch, targets, rec)

    bi.run_batch(Path("/vids"), SINCE)

    assert rec.ingest_videos == ["fresh"]  # 'done' skipped, no re-ingest
    assert "already ingested" in capsys.readouterr().err


# ─── _collect_targets DB helpers (Task 4.3) ──────────────────────────────────


def test_known_shas_parses_distinct_psql_output(monkeypatch) -> None:
    monkeypatch.setattr(
        bi, "_psql_query", lambda _sql: "aaa\nbbb\n\nccc\n"
    )
    assert bi._known_shas() == {"aaa", "bbb", "ccc"}


def _stamped_target(priority: int) -> BatchTarget:
    """A target whose basename is a real recording stamp, so the real
    ``parse_basename_epoch`` resolves it (only ``_psql_query`` is stubbed)."""
    return BatchTarget(
        path=Path("/vids/2026-05-22_19-07-03.mkv"),
        sha256="x",
        kind="loose",
        priority=priority,
    )


def test_refine_target_flags_api_missed_when_no_match_row(monkeypatch) -> None:
    seen: list[str] = []
    monkeypatch.setattr(bi, "_psql_query", lambda sql: seen.append(sql) or "0")

    refined = bi._refine_target(_stamped_target(bi.PRIORITY_API_COVERED))

    assert refined.api_missed is True
    assert refined.priority == bi.PRIORITY_API_MISSED
    assert seen, "the matches-near-ts DB lookup must run"


def test_refine_target_marks_covered_when_match_row_exists(monkeypatch) -> None:
    monkeypatch.setattr(bi, "_psql_query", lambda _sql: "2")

    refined = bi._refine_target(_stamped_target(bi.PRIORITY_API_MISSED))

    assert refined.api_missed is False
    assert refined.priority == bi.PRIORITY_API_COVERED


def test_refine_target_stays_neutral_when_basename_has_no_stamp(monkeypatch) -> None:
    # A basename without a wall-clock stamp cannot be placed in the API window —
    # refine leaves the neutral band and must NOT hit the DB.
    monkeypatch.setattr(
        bi, "_psql_query", lambda _sql: pytest.fail("psql should not run")
    )
    t = BatchTarget(
        path=Path("/vids/random-clip.mkv"),
        sha256="x",
        kind="loose",
        priority=bi.PRIORITY_API_COVERED,
    )

    refined = bi._refine_target(t)

    assert refined.api_missed is False
    assert refined.priority == bi.PRIORITY_API_COVERED  # unchanged neutral band


# ─── sha cache load/save ─────────────────────────────────────────────────────
#
# Planning re-hashes the WHOLE corpus every pass (~82 GB / ~17 min at the
# measured ~79 MB/s), and chunked runs are the normal mode — so the cache is
# what makes a re-plan near-instant. Every failure mode here degrades to a
# re-hash, never to an abort.


def test_load_sha_cache_returns_empty_when_file_absent(tmp_path: Path) -> None:
    assert bi.load_sha_cache(tmp_path / "never-written.json") == {}


def test_load_sha_cache_returns_empty_on_corrupt_json(tmp_path: Path) -> None:
    # A crash mid-write (or a hand-edit) must cost a re-hash, not the run.
    p = _touch(tmp_path / "sha-cache.json", content=b"{not valid json")

    assert bi.load_sha_cache(p) == {}


def test_load_sha_cache_returns_empty_when_payload_is_not_a_mapping(
    tmp_path: Path,
) -> None:
    p = _touch(tmp_path / "sha-cache.json", content=b'["a", "b"]')

    assert bi.load_sha_cache(p) == {}


def test_save_then_load_sha_cache_roundtrips(tmp_path: Path) -> None:
    p = tmp_path / "made" / "up" / "sha-cache.json"  # parents created by save
    cache = {"/vids/a.mkv": {"size": 5, "mtime_ns": 7, "sha256": "abc"}}

    bi.save_sha_cache(cache, p)

    assert bi.load_sha_cache(p) == cache


def test_save_sha_cache_never_raises_on_an_unwritable_path(
    tmp_path: Path, capsys
) -> None:
    # Parent is a FILE ⇒ mkdir/write raise OSError. A cache we cannot persist is
    # a lost optimization, not a failed plan.
    blocker = _touch(tmp_path / "blocker")

    bi.save_sha_cache({"x": {"size": 1, "mtime_ns": 1, "sha256": "y"}}, blocker / "c.json")

    assert "sha cache" in capsys.readouterr().err


# ─── _cached_file_sha256 (the (path, size, mtime) → sha key) ─────────────────


def test_cached_file_sha256_serves_a_hit_without_rehashing(
    tmp_path: Path, monkeypatch
) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"payload")
    st = p.stat()
    cache = {
        str(p): {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "sha256": "cached-sha"}
    }
    monkeypatch.setattr(bi, "_file_sha256", lambda _p: pytest.fail("must not re-hash"))

    assert bi._cached_file_sha256(p, cache) == "cached-sha"


def test_cached_file_sha256_records_a_miss(tmp_path: Path) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"payload")
    cache: dict = {}

    sha = bi._cached_file_sha256(p, cache)

    st = p.stat()
    assert sha == bi._file_sha256(p)
    assert cache[str(p)] == {
        "size": st.st_size,
        "mtime_ns": st.st_mtime_ns,
        "sha256": sha,
    }


def test_cached_file_sha256_rehashes_when_the_size_moved(tmp_path: Path) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"one")
    st = p.stat()
    cache = {str(p): {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "sha256": "stale"}}

    p.write_bytes(b"different bytes entirely")  # e.g. a re-trimmed recording

    assert bi._cached_file_sha256(p, cache) == bi._file_sha256(p)
    assert cache[str(p)]["sha256"] != "stale"


def test_cached_file_sha256_rehashes_when_only_the_mtime_moved(tmp_path: Path) -> None:
    # Same size, touched mtime — the digest must not be trusted on mtime alone.
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"one")
    st = p.stat()
    cache = {str(p): {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "sha256": "stale"}}
    os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 10**9))

    assert bi._cached_file_sha256(p, cache) == bi._file_sha256(p)


def test_cached_file_sha256_ignores_a_malformed_entry(tmp_path: Path) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"payload")
    cache = {str(p): "not-a-dict"}

    assert bi._cached_file_sha256(p, cache) == bi._file_sha256(p)


def test_cached_file_sha256_without_a_cache_hashes_directly(tmp_path: Path) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"payload")

    assert bi._cached_file_sha256(p, None) == bi._file_sha256(p)


# ─── dedup_by_sha hash isolation + cache wiring ──────────────────────────────


def test_dedup_isolates_an_unreadable_file_and_keeps_going(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    # The class of bug the deleted 54.5 GB crashed recording exposed: an OSError
    # while HASHING must not take down the whole plan before any target runs
    # (_process_target's per-video isolation only covers the ingest phase).
    good_a = _touch(tmp_path / "2026-05-22_18-00-00.mkv", content=b"aaa")
    bad = _touch(tmp_path / "2026-05-22_19-00-00.mkv", content=b"bbb")
    good_b = _touch(tmp_path / "2026-05-22_20-00-00.mkv", content=b"ccc")
    real_sha = bi._file_sha256

    def flaky(path: Path) -> str:
        if path == bad:
            raise OSError("Input/output error")
        return real_sha(path)

    monkeypatch.setattr(bi, "_file_sha256", flaky)

    targets = bi.dedup_by_sha([good_a, bad, good_b], known_shas=set())

    assert [t.path for t in targets] == [good_a, good_b]
    err = capsys.readouterr().err
    assert "SKIP" in err and bad.name in err


def test_dedup_uses_the_cache_and_fills_it(tmp_path: Path) -> None:
    p = _touch(tmp_path / "2026-05-22_19-07-03.mkv", content=b"payload")
    cache: dict = {}

    targets = bi.dedup_by_sha([p], known_shas=set(), cache=cache)

    assert targets[0].sha256 == bi._file_sha256(p)
    assert cache[str(p)]["sha256"] == targets[0].sha256


def test_collect_targets_saves_the_cache_so_a_replan_skips_hashing(
    tmp_path: Path, monkeypatch
) -> None:
    """The whole point: the SECOND plan over an unchanged corpus re-hashes nothing."""
    root = tmp_path / "vids"
    p = _touch(root / "2026-05-22_19-07-03.mkv", content=b"payload")
    cache_path = tmp_path / "sha-cache.json"
    monkeypatch.setattr(bi, "_sha_cache_path", lambda: cache_path)
    monkeypatch.setattr(bi, "_known_shas", set)
    monkeypatch.setattr(bi, "_refine_target", lambda t: t)

    first = bi._collect_targets(root, SINCE)

    assert bi.load_sha_cache(cache_path)[str(p)]["sha256"] == first[0].sha256

    monkeypatch.setattr(bi, "_file_sha256", lambda _p: pytest.fail("re-hashed a replan"))
    second = bi._collect_targets(root, SINCE)

    assert [t.sha256 for t in second] == [t.sha256 for t in first]
