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
import json
import os
import sys
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


# ─── _parse_json_object (Task 4.4) ───────────────────────────────────────────
#
# `match-quality --json` prints PRETTY (JSON.stringify(out, null, 2)), so the
# payload spans many lines and pnpm prepends a banner ON STDOUT (verified
# on-box). The bottom-up single-`{`-line scan used by dispatch._parse_reel_map
# cannot work here — hence a parser of its own.

_PNPM_BANNER = (
    "\n> @eanhl/worker@0.0.1 match-quality /home/michal/projects/x/apps/worker\n"
    "> node dist/match-quality-cli.js --match 463 --json\n\n"
)


def test_parse_json_object_reads_pretty_json_after_a_pnpm_banner() -> None:
    out = _PNPM_BANNER + '{\n  "matchId": 463,\n  "gate": {\n    "decision": "PASS"\n  }\n}\n'

    assert bi._parse_json_object(out) == {"matchId": 463, "gate": {"decision": "PASS"}}


def test_parse_json_object_is_not_fooled_by_a_brace_inside_a_banner_line() -> None:
    # A banner mentioning `{` mid-line must not anchor the parse; only a line
    # that OPENS an object at column 0 counts.
    out = (
        "> node dist/cli.js --filter {worker} --json\n"
        + '{\n  "gate": {"decision": "HOLD"}\n}\n'
    )

    assert bi._parse_json_object(out) == {"gate": {"decision": "HOLD"}}


def test_parse_json_object_ignores_trailing_noise_after_the_object() -> None:
    out = '{\n  "a": 1\n}\nDone in 1.2s\n'

    assert bi._parse_json_object(out) == {"a": 1}


def test_parse_json_object_raises_when_there_is_no_object() -> None:
    with pytest.raises(RuntimeError, match="no JSON object"):
        bi._parse_json_object("> banner only\nDone in 0.3s\n")


# ─── _run_captured (Task 4.4) ────────────────────────────────────────────────


def test_run_captured_returns_stdout() -> None:
    out = bi._run_captured(
        [sys.executable, "-c", "print('hello-stdout')"], description="smoke"
    )

    assert "hello-stdout" in out


def test_run_captured_raises_naming_the_exit_code() -> None:
    with pytest.raises(RuntimeError, match="exit 3"):
        bi._run_captured([sys.executable, "-c", "raise SystemExit(3)"], description="boom")


# ─── _confirmed_associations (Task 4.4) ──────────────────────────────────────


def test_confirmed_associations_parses_the_pending_ledger() -> None:
    rows = "aaa|11|t\naaa|12|f\nbbb|13|t\n"

    got = bi._parse_confirmed_rows(rows)

    assert got == {"aaa": {11: True, 12: False}, "bbb": {13: True}}


def test_confirmed_associations_is_empty_when_nothing_is_confirmed() -> None:
    assert bi._parse_confirmed_rows("") == {}


def test_confirmed_associations_skips_a_malformed_line() -> None:
    got = bi._parse_confirmed_rows("aaa|11|t\ngarbage\nccc|x|t\nbbb|13|f\n")

    assert got == {"aaa": {11: True}, "bbb": {13: False}}


def test_confirmed_associations_query_uses_extractions_not_capture_batches(
    monkeypatch,
) -> None:
    """The stamp-bug guard.

    ``confirmAssociation`` stamps ocr_capture_batches by (video_sha256, run_id)
    with NO reel scoping, so confirming a second reel re-stamps the FIRST reel's
    batches. A predicate on that column would false-skip a pending reel — the
    worst failure available. ``ocr_extractions.match_id`` is write-once.
    """
    seen: list[str] = []
    monkeypatch.setattr(bi, "_psql_query", lambda sql: seen.append(sql) or "")

    bi._confirmed_associations()

    sql = seen[0]
    assert "ocr_extractions" in sql
    assert "status = 'confirmed'" in sql
    assert "b.match_id" not in sql, "must not read the re-stamped capture-batch column"


# ─── _promote_plan (Task 4.4) ────────────────────────────────────────────────


def _plan_root(tmp_path: Path) -> Path:
    root = tmp_path / "vids"
    _touch(root / "2026-05-22_19-07-03.mkv", content=b"aaa-bytes")
    _touch(root / "2026-05-23_20-01-01.mkv", content=b"bbb-bytes")
    return root


def _sha_of(root: Path, name: str) -> str:
    return bi._file_sha256(root / name)


def _patch_plan(monkeypatch, tmp_path: Path, confirmed: dict) -> None:
    monkeypatch.setattr(bi, "_sha_cache_path", lambda: tmp_path / "sha-cache.json")
    monkeypatch.setattr(bi, "_confirmed_associations", lambda: confirmed)
    monkeypatch.setattr(
        bi, "_known_shas", lambda: pytest.fail("promote must not use already_ingested")
    )


def test_promote_plan_selects_only_videos_with_a_pending_confirmed_reel(
    tmp_path: Path, monkeypatch
) -> None:
    root = _plan_root(tmp_path)
    a, b = _sha_of(root, "2026-05-22_19-07-03.mkv"), _sha_of(root, "2026-05-23_20-01-01.mkv")
    # a has one drained + one pending reel; b is fully drained.
    _patch_plan(monkeypatch, tmp_path, {a: {11: False, 12: True}, b: {13: False}})

    plan = bi._promote_plan(root, SINCE)

    assert [t.sha256 for t in plan] == [a]
    assert plan[0].confirmed_match_ids == [11, 12]  # the GRADE set: every confirmed reel
    assert plan[0].pending_match_ids == [12]  # the reason to run


def test_promote_plan_is_empty_when_every_confirmed_reel_is_drained(
    tmp_path: Path, monkeypatch
) -> None:
    """Convergence: the drain must not loop forever on already-promoted videos.

    And it must reach that answer WITHOUT hashing the corpus — "nothing left to
    drain" is this pass's steady state, so the re-run that confirms it cannot
    cost a ~20-min 82 GB re-hash.
    """
    root = _plan_root(tmp_path)
    a = _sha_of(root, "2026-05-22_19-07-03.mkv")
    _patch_plan(monkeypatch, tmp_path, {a: {11: False}})
    monkeypatch.setattr(bi, "_file_sha256", lambda _p: pytest.fail("hashed a drained corpus"))

    assert bi._promote_plan(root, SINCE) == []


def test_promote_plan_is_empty_and_hits_no_disk_when_nothing_is_confirmed(
    tmp_path: Path, monkeypatch
) -> None:
    root = _plan_root(tmp_path)
    _patch_plan(monkeypatch, tmp_path, {})
    monkeypatch.setattr(bi, "_file_sha256", lambda _p: pytest.fail("hashed with no backlog"))

    assert bi._promote_plan(root, SINCE) == []


def test_promote_plan_skips_a_confirmed_sha_with_no_on_disk_video(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    root = _plan_root(tmp_path)
    _patch_plan(monkeypatch, tmp_path, {"sha-not-on-disk": {11: True}})

    plan = bi._promote_plan(root, SINCE)

    assert plan == []
    err = capsys.readouterr().err
    assert "SKIP" in err and "sha-not-on-disk"[:12] in err


def test_promote_plan_orders_chronologically_by_basename(
    tmp_path: Path, monkeypatch
) -> None:
    root = _plan_root(tmp_path)
    a, b = _sha_of(root, "2026-05-22_19-07-03.mkv"), _sha_of(root, "2026-05-23_20-01-01.mkv")
    _patch_plan(monkeypatch, tmp_path, {b: {13: True}, a: {11: True}})

    plan = bi._promote_plan(root, SINCE)

    assert [t.path.name for t in plan] == [
        "2026-05-22_19-07-03.mkv",
        "2026-05-23_20-01-01.mkv",
    ]


# ─── _grade_match (Task 4.4) ─────────────────────────────────────────────────


def _grade_stdout(decision: str = "PASS", *, with_gate: bool = True) -> str:
    payload = {
        "matchId": 463,
        "layers": {
            "l4": {
                "score": 0.98,
                "gradable": True,
                "finalAccuracy": 1,
                "periodCoverage": 1.0,
                "periodAccuracy": 1.0,
            }
        },
    }
    if with_gate:
        payload["gate"] = {"decision": decision, "reason": "TOT-row final matches API truth"}
    return _PNPM_BANNER + json.dumps(payload, indent=2) + "\n"


def test_grade_match_reads_the_gate_verdict(monkeypatch) -> None:
    monkeypatch.setattr(bi, "_run_captured", lambda cmd, *, description: _grade_stdout("HOLD"))

    got = bi._grade_match(463)

    assert got["match_id"] == 463
    assert got["decision"] == "HOLD"
    assert got["finalAccuracy"] == 1
    assert got["gradable"] is True


def test_grade_match_reports_error_when_the_payload_has_no_gate(monkeypatch) -> None:
    """A stale apps/worker/dist/ predates the gate field — say so, don't KeyError."""
    monkeypatch.setattr(
        bi, "_run_captured", lambda cmd, *, description: _grade_stdout(with_gate=False)
    )

    got = bi._grade_match(463)

    assert got["decision"] == "ERROR"
    assert "gate" in got["reason"]


def test_grade_match_shells_out_to_the_match_quality_cli(monkeypatch) -> None:
    seen: list[list[str]] = []

    def _cap(cmd, *, description):
        seen.append(cmd)
        return _grade_stdout()

    monkeypatch.setattr(bi, "_run_captured", _cap)

    bi._grade_match(972)

    assert seen[0] == [
        "pnpm", "--filter", "@eanhl/worker", "match-quality",
        "--match", "972", "--json",
    ]


# ─── run_promote loop (Task 4.4) ─────────────────────────────────────────────


def _ptarget(name: str, confirmed: list[int], pending: list[int] | None = None):
    """A fake promote target — path/sha keyed on ``name`` (mirrors ``_btarget``)."""
    return bi.PromoteTarget(
        path=Path(f"/vids/{name}.mkv"),
        sha256=name,
        confirmed_match_ids=confirmed,
        pending_match_ids=pending if pending is not None else confirmed,
    )


def _patch_promote(monkeypatch, tmp_path: Path, targets, recorder, *, grade_raises=()):
    """Wire run_promote's seams, mirroring ``_patch_loop``."""
    counters = {"preflight": 0}

    def _count_preflight() -> None:
        counters["preflight"] += 1

    def _cap(cmd, *, description):
        match_id = int(cmd[cmd.index("--match") + 1])
        if match_id in grade_raises:
            raise RuntimeError(f"grade boom: {match_id}")
        return _grade_stdout()

    monkeypatch.setattr(bi, "preflight", _count_preflight)
    monkeypatch.setattr(bi, "_promote_plan", lambda _root, _since: list(targets))
    monkeypatch.setattr(bi, "_run_streaming", recorder)
    monkeypatch.setattr(bi, "_run_captured", _cap)
    monkeypatch.setattr(bi, "_promote_summary_path", lambda _started: tmp_path / "summary.json")
    return counters


def test_run_promote_preflights_once_and_reingests_each_confirmed_video(
    tmp_path: Path, monkeypatch
) -> None:
    targets = [_ptarget("a", [11]), _ptarget("b", [12])]
    rec = _StreamRecorder()
    counters = _patch_promote(monkeypatch, tmp_path, targets, rec)

    bi.run_promote(Path("/vids"), SINCE)

    assert counters["preflight"] == 1
    assert rec.ingest_videos == ["a", "b"]


def test_run_promote_passes_the_same_cache_key_flags_as_the_first_pass_and_no_run_id(
    tmp_path: Path, monkeypatch
) -> None:
    """The CacheMismatch guard, plus the GAP (2) strict-gate flag.

    Pass 2 MUST re-issue Pass 1's CACHE-KEY flags byte-identically: --version /
    --pass2-artifacts / --prefilter / --pass1-gate feed the cache keys and any
    drift is a hard CacheMismatch exit-1, not a silent re-decode. --run-id would
    additionally move the Pass-2 cache dir (pass2 → pass2-run-<id>).

    --require-reel-map IS added here (and is NOT on the Pass-1 command): it feeds
    no cache key, only the post-decode dispatch decision, so it makes a failed OR
    empty reel-map lookup exit 1 rather than silently deferring the confirmed
    video.
    """
    rec = _StreamRecorder()
    _patch_promote(monkeypatch, tmp_path, [_ptarget("a", [11])], rec)

    bi.run_promote(Path("/vids"), SINCE)

    ingest = [c for c in rec.cmds if "ingest" in c][0]
    assert "--run-id" not in ingest
    assert ingest == [
        "python3", "-m", "video_ingest.cli", "ingest",
        "--video", "/vids/a.mkv",
        "--output-root", str(bi.DEFAULT_INGEST_CACHE),
        "--dispatch",
        "--require-reel-map",
        "--game-title-id", "1",
    ]


def test_run_promote_grades_every_confirmed_match_not_just_the_pending_ones(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    # Re-dispatch re-promotes every confirmed reel, so every one gets re-graded.
    targets = [_ptarget("a", [11, 12], pending=[12])]
    _patch_promote(monkeypatch, tmp_path, targets, _StreamRecorder())

    bi.run_promote(Path("/vids"), SINCE)

    summary = json.loads((tmp_path / "summary.json").read_text())
    assert [g["match_id"] for g in summary["videos"][0]["grades"]] == [11, 12]


def test_run_promote_isolates_a_failing_video_and_continues(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    targets = [_ptarget("a", [11]), _ptarget("b", [12]), _ptarget("c", [13])]
    rec = _StreamRecorder(raise_on="/vids/b.mkv")
    _patch_promote(monkeypatch, tmp_path, targets, rec)

    bi.run_promote(Path("/vids"), SINCE)

    assert rec.ingest_videos == ["a", "b", "c"]
    err = capsys.readouterr().err
    assert "SKIP" in err and "b" in err
    summary = json.loads((tmp_path / "summary.json").read_text())
    assert [v["status"] for v in summary["videos"]] == ["promoted", "failed", "promoted"]
    assert summary["totals"]["failed"] == 1


def test_run_promote_records_a_failed_grade_without_losing_the_promotion(
    tmp_path: Path, monkeypatch
) -> None:
    """The promotion already happened inside the ingest tx — a grade that blows
    up must not erase it from the record."""
    targets = [_ptarget("a", [11, 12])]
    _patch_promote(monkeypatch, tmp_path, targets, _StreamRecorder(), grade_raises=(11,))

    bi.run_promote(Path("/vids"), SINCE)

    summary = json.loads((tmp_path / "summary.json").read_text())
    video = summary["videos"][0]
    assert video["status"] == "promoted"
    decisions = {g["match_id"]: g["decision"] for g in video["grades"]}
    assert decisions == {11: "ERROR", 12: "PASS"}


def test_run_promote_dry_run_makes_zero_mutating_calls_and_writes_no_summary(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    rec = _StreamRecorder()
    _patch_promote(monkeypatch, tmp_path, [_ptarget("a", [11])], rec)

    bi.run_promote(Path("/vids"), SINCE, dry_run=True)

    assert rec.cmds == []
    assert not (tmp_path / "summary.json").exists()
    assert "DRY-RUN" in capsys.readouterr().err


def test_run_promote_limit_slices_the_plan(tmp_path: Path, monkeypatch) -> None:
    targets = [_ptarget("a", [11]), _ptarget("b", [12])]
    rec = _StreamRecorder()
    _patch_promote(monkeypatch, tmp_path, targets, rec)

    bi.run_promote(Path("/vids"), SINCE, limit=1)

    assert rec.ingest_videos == ["a"]


# ─── promote run-summary (Task 4.4) ──────────────────────────────────────────


def test_promote_summary_survives_a_crash_mid_run(tmp_path: Path, monkeypatch) -> None:
    """A 40h run must not lose the videos it already finished.

    KeyboardInterrupt (Ctrl-C / an OOM kill) is a BaseException, so it escapes
    run_promote's `except Exception` isolation entirely — the realistic hard-stop.
    """
    targets = [_ptarget("a", [11]), _ptarget("b", [12])]

    class _KillOnSecond(_StreamRecorder):
        def __call__(self, cmd, *, description):
            if "/vids/b.mkv" in cmd:
                raise KeyboardInterrupt
            return super().__call__(cmd, description=description)

    _patch_promote(monkeypatch, tmp_path, targets, _KillOnSecond())

    with pytest.raises(KeyboardInterrupt):
        bi.run_promote(Path("/vids"), SINCE)

    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["completed"] is False
    assert [v["sha256"] for v in summary["videos"]] == ["a"]
    assert summary["totals"]["promoted"] == 1


def test_promote_summary_marks_completed_on_a_clean_run(
    tmp_path: Path, monkeypatch
) -> None:
    _patch_promote(monkeypatch, tmp_path, [_ptarget("a", [11])], _StreamRecorder())

    bi.run_promote(Path("/vids"), SINCE)

    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["completed"] is True
    assert summary["schema"] == "promote-summary/v1"
    assert summary["totals"] == {
        "videos": 1, "promoted": 1, "failed": 0,
        "PASS": 1, "HOLD": 0, "OPERATOR_CONFIRM": 0, "ERROR": 0,
    }


def test_promote_summary_never_raises_on_an_unwritable_path(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    """Mirrors save_sha_cache: a summary records the work, it must not destroy it."""
    unwritable = tmp_path / "nope" / "summary.json"
    unwritable.parent.mkdir()
    unwritable.parent.chmod(0o500)
    try:
        _patch_promote(monkeypatch, tmp_path, [_ptarget("a", [11])], _StreamRecorder())
        monkeypatch.setattr(bi, "_promote_summary_path", lambda _started: unwritable)

        bi.run_promote(Path("/vids"), SINCE)

        assert "WARN" in capsys.readouterr().err
    finally:
        unwritable.parent.chmod(0o700)


def test_promote_totals_counts_decisions_across_videos() -> None:
    videos = [
        {"status": "promoted", "grades": [{"decision": "PASS"}, {"decision": "HOLD"}]},
        {"status": "failed", "grades": []},
        {"status": "promoted", "grades": [{"decision": "OPERATOR_CONFIRM"}]},
    ]

    assert bi._promote_totals(videos) == {
        "videos": 3, "promoted": 2, "failed": 1,
        "PASS": 1, "HOLD": 1, "OPERATOR_CONFIRM": 1, "ERROR": 0,
    }
