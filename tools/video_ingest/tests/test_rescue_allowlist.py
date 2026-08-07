"""Stage-B rescue execution allowlist -- pure schema, provenance and selection.

Every check here is against plain :class:`~video_ingest.rescue_manifest.Window`
objects and plain dicts, with no manifest file, no git process and no database
-- the same "pure policy, unit-testable in isolation" split every other module
in this package uses. The wiring that reads the allowlist file once, hashes it,
calls the real ``git rev-parse HEAD`` and folds the result into a
:class:`~video_ingest.rescue_execute.ExecutionPlan` is covered separately in
``test_rescue_execute.py``, where it can be exercised against a real manifest
file and a real (injected) git provenance seam.
"""

from __future__ import annotations

from typing import Any

import pytest

from video_ingest.rescue_allowlist import (
    ALLOWLIST_KIND,
    ALLOWLIST_SCHEMA_VERSION,
    Allowlist,
    AllowlistEntry,
    allowlist_problems,
    excluded_auto_windows,
    is_git_sha,
    is_sha256,
    parse_allowlist,
    selected_auto_windows,
)
from video_ingest.rescue_manifest import (
    DECISION_AUTO,
    DECISION_REVIEW,
    DECISION_SKIP,
    REEL_CONTAINED,
    UNKNOWN_STATE,
    R_ALREADY_COVERED,
    R_SUMMARY_CATEGORY,
    Window,
)

SHA_A = "a" * 64
SHA_B = "b" * 64
MANIFEST_SHA = "1" * 64
OTHER_MANIFEST_SHA = "2" * 64
HEAD = "3" * 40
OTHER_HEAD = "4" * 40


# ─── Fixture construction ─────────────────────────────────────────────────────


def _window(
    *,
    sha: str = SHA_A,
    segment_index: int = 9000,
    target_screen: str | None = "post_game_box_score_goals",
    match_id: int | None = 472,
    run_id: int | None = 55,
    decision: str = DECISION_AUTO,
    reason: str | None = None,
    batch_dir: str | None = None,
) -> Window:
    bd = batch_dir or f"/cache/{sha}/rescue/seg-{segment_index:03d}-{target_screen}"
    window = Window(
        video_sha256=sha,
        video_path="/videos/match.mkv",
        video_path_exists=True,
        segment_index=segment_index,
        target_screen=target_screen,
        t0=100.0,
        t1=101.5,
        reel_index=0,
        reel_mode=REEL_CONTAINED,
        match_id=match_id,
        run_id=run_id,
        decision=decision,
        reason=reason,
        frame_count=1,
        evidence=[
            {
                "t": 100.5,
                "anchor_text": "lt goalsummary",
                "assigned_screen_type": UNKNOWN_STATE,
                "rule": "goal_summary",
            }
        ],
    )
    if decision == DECISION_AUTO:
        window.commands = {"batch_dir": bd}
    return window


def _entry(window: Window, **overrides: Any) -> dict[str, Any]:
    batch_dir = window.commands["batch_dir"] if window.commands else None
    entry: dict[str, Any] = {
        "video_sha256": window.video_sha256,
        "segment_index": window.segment_index,
        "target_screen": window.target_screen,
        "match_id": window.match_id,
        "run_id": window.run_id,
        "batch_dir": batch_dir,
        "promotion_key": [window.video_sha256, batch_dir, window.run_id],
    }
    entry.update(overrides)
    return entry


def _doc(*entries: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "schema_version": ALLOWLIST_SCHEMA_VERSION,
        "kind": ALLOWLIST_KIND,
        "manifest_sha256": MANIFEST_SHA,
        "repository_head": HEAD,
        "source_proposal_sha256": None,
        "windows": list(entries),
    }
    doc.update(overrides)
    return doc


def _problems(doc: dict[str, Any], *, all_windows: list[Window]) -> list[str]:
    return allowlist_problems(
        doc, manifest_sha256=MANIFEST_SHA, repository_head=HEAD, all_windows=all_windows
    )


# ─── The happy path ────────────────────────────────────────────────────────────


def test_a_valid_minimal_allowlist_has_no_problems() -> None:
    window = _window()
    doc = _doc(_entry(window))
    assert _problems(doc, all_windows=[window]) == []


def test_a_valid_allowlist_parses_into_the_dataclass() -> None:
    window = _window()
    doc = _doc(_entry(window))
    allowlist = parse_allowlist(doc)

    assert allowlist.schema_version == ALLOWLIST_SCHEMA_VERSION
    assert allowlist.kind == ALLOWLIST_KIND
    assert allowlist.manifest_sha256 == MANIFEST_SHA
    assert allowlist.repository_head == HEAD
    assert allowlist.source_proposal_sha256 is None
    assert len(allowlist.entries) == 1
    entry = allowlist.entries[0]
    assert isinstance(entry, AllowlistEntry)
    assert entry.video_sha256 == window.video_sha256
    assert entry.promotion_key == (window.video_sha256, window.commands["batch_dir"], window.run_id)


# ─── Schema / provenance ───────────────────────────────────────────────────────


def test_wrong_schema_version_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window), schema_version=2)
    assert any("schema_version" in p for p in _problems(doc, all_windows=[window]))


def test_wrong_kind_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window), kind="something-else")
    assert any("kind" in p for p in _problems(doc, all_windows=[window]))


@pytest.mark.parametrize("bad", ["", "not-a-sha", "a" * 63, "A" * 64, "a" * 65])
def test_a_malformed_manifest_hash_is_rejected(bad: str) -> None:
    window = _window()
    doc = _doc(_entry(window), manifest_sha256=bad)
    assert any("manifest_sha256" in p for p in _problems(doc, all_windows=[window]))


def test_a_manifest_sha_mismatch_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window), manifest_sha256=OTHER_MANIFEST_SHA)
    problems = _problems(doc, all_windows=[window])
    assert any("manifest_sha256" in p for p in problems)


@pytest.mark.parametrize("bad", ["", "not-a-sha", "a" * 39, "A" * 40, "a" * 41])
def test_a_malformed_repository_head_is_rejected(bad: str) -> None:
    window = _window()
    doc = _doc(_entry(window), repository_head=bad)
    assert any("repository_head" in p for p in _problems(doc, all_windows=[window]))


def test_a_repository_head_mismatch_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window), repository_head=OTHER_HEAD)
    problems = _problems(doc, all_windows=[window])
    assert any("repository_head" in p for p in problems)


def test_proposal_only_true_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window), proposal_only=True)
    problems = _problems(doc, all_windows=[window])
    assert any("proposal_only" in p for p in problems)


def test_do_not_execute_true_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window), do_not_execute=True)
    problems = _problems(doc, all_windows=[window])
    assert any("do_not_execute" in p for p in problems)


def test_an_unknown_top_level_key_is_rejected_as_ambiguous() -> None:
    window = _window()
    doc = _doc(_entry(window), binding_metadata={"whatever": True})
    problems = _problems(doc, all_windows=[window])
    assert any("unknown top-level" in p for p in problems)


def test_the_real_corrected_audit_proposal_shape_is_rejected_for_all_its_defects() -> None:
    """Replicates the exact shape of the audit's `allowlist_proposal.corrected.json`:
    `proposal_only`, `do_not_execute`, no `schema_version`/`kind`/`manifest_sha256`
    at the top level (they live nested under `binding_metadata` instead), and an
    unrecognised `binding_metadata` key. It must be rejected many times over, not
    almost-accepted."""
    window = _window()
    doc = {
        "proposal_only": True,
        "do_not_execute": True,
        "binding_metadata": {
            "candidate_manifest_sha256": MANIFEST_SHA,
            "repository_head": HEAD,
        },
        "windows": [_entry(window)],
    }
    problems = _problems(doc, all_windows=[window])
    assert any("proposal_only" in p for p in problems)
    assert any("do_not_execute" in p for p in problems)
    assert any("schema_version" in p for p in problems)
    assert any("kind" in p for p in problems)
    assert any("manifest_sha256" in p for p in problems)
    assert any("repository_head" in p for p in problems)
    assert any("unknown top-level" in p for p in problems)


# ─── Entries: structure and internal consistency ──────────────────────────────


def test_empty_windows_is_rejected() -> None:
    doc = _doc()
    assert any("empty" in p for p in _problems(doc, all_windows=[]))


def test_a_duplicate_full_entry_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window), _entry(window))
    assert any("duplicate entry" in p for p in _problems(doc, all_windows=[window]))


def test_a_duplicate_promotion_key_with_a_different_entry_shape_is_rejected() -> None:
    """Two entries that disagree on some field but share a promotion_key -- the
    key alone, not full-entry equality, is what the database's unique index
    keys on, so a key collision must be caught even when the entries differ."""
    window = _window()
    entry_a = _entry(window)
    entry_b = _entry(window, target_screen="post_game_events")  # same key, different screen
    doc = _doc(entry_a, entry_b)
    assert any("duplicate promotion_key" in p for p in _problems(doc, all_windows=[window]))


@pytest.mark.parametrize("truncate_to", [0, 8, 12, 40, 63])
def test_a_truncated_video_sha_is_rejected(truncate_to: int) -> None:
    window = _window()
    entry = _entry(window, video_sha256=window.video_sha256[:truncate_to])
    doc = _doc(entry)
    problems = _problems(doc, all_windows=[window])
    assert any("video_sha256" in p for p in problems)


@pytest.mark.parametrize("index,label", [(0, "video_sha256"), (1, "batch_dir"), (2, "run_id")])
def test_an_internally_inconsistent_promotion_key_is_rejected(index: int, label: str) -> None:
    window = _window()
    entry = _entry(window)
    key = list(entry["promotion_key"])
    key[index] = "TAMPERED" if index != 2 else 999999
    entry["promotion_key"] = key
    doc = _doc(entry)
    problems = _problems(doc, all_windows=[window])
    assert any(f"promotion_key[{index}]" in p for p in problems)


@pytest.mark.parametrize(
    "bad_batch_dir",
    [
        "relative/path/is/not/absolute",
        f"/cache/{SHA_A}/rescue/../../../etc/passwd",
        f"/cache/{SHA_A}//rescue//double-slash",
        f"/cache/{SHA_A}/rescue/trailing-slash/",
    ],
)
def test_a_non_normalized_or_relative_batch_dir_is_rejected(bad_batch_dir: str) -> None:
    window = _window()
    entry = _entry(window, batch_dir=bad_batch_dir)
    entry["promotion_key"] = [window.video_sha256, bad_batch_dir, window.run_id]
    doc = _doc(entry)
    problems = _problems(doc, all_windows=[window])
    assert any("batch_dir" in p for p in problems)


# ─── Entries: exact equality against the manifest's own auto windows ──────────


def test_an_unknown_window_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window, segment_index=9999))
    problems = _problems(doc, all_windows=[window])
    assert any("unknown window" in p for p in problems)
    assert any("segment_index" in p for p in problems)


def test_a_review_window_is_rejected() -> None:
    window = _window(decision=DECISION_REVIEW, reason=R_SUMMARY_CATEGORY)
    # A review window keeps no commands, so the entry is built by hand against
    # what an operator might mistakenly point at.
    entry = {
        "video_sha256": window.video_sha256,
        "segment_index": window.segment_index,
        "target_screen": "post_game_events",
        "match_id": window.match_id,
        "run_id": window.run_id,
        "batch_dir": f"/cache/{window.video_sha256}/rescue/seg-{window.segment_index:03d}-x",
        "promotion_key": [
            window.video_sha256,
            f"/cache/{window.video_sha256}/rescue/seg-{window.segment_index:03d}-x",
            window.run_id,
        ],
    }
    doc = _doc(entry)
    problems = _problems(doc, all_windows=[window])
    assert any("REVIEW window" in p for p in problems)


def test_a_skip_window_is_rejected() -> None:
    window = _window(decision=DECISION_SKIP, reason=R_ALREADY_COVERED)
    entry = {
        "video_sha256": window.video_sha256,
        "segment_index": window.segment_index,
        "target_screen": "post_game_events",
        "match_id": window.match_id,
        "run_id": window.run_id,
        "batch_dir": f"/cache/{window.video_sha256}/rescue/seg-{window.segment_index:03d}-x",
        "promotion_key": [
            window.video_sha256,
            f"/cache/{window.video_sha256}/rescue/seg-{window.segment_index:03d}-x",
            window.run_id,
        ],
    }
    doc = _doc(entry)
    problems = _problems(doc, all_windows=[window])
    assert any("SKIP window" in p for p in problems)


def test_a_match_id_mismatch_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window, match_id=999))
    problems = _problems(doc, all_windows=[window])
    assert any("match_id" in p for p in problems)


def test_a_run_id_mismatch_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window, run_id=999))
    problems = _problems(doc, all_windows=[window])
    assert any("run_id" in p for p in problems)


def test_a_target_screen_mismatch_is_rejected() -> None:
    window = _window()
    doc = _doc(_entry(window, target_screen="post_game_events"))
    problems = _problems(doc, all_windows=[window])
    assert any("target_screen" in p for p in problems)


def test_a_segment_index_mismatch_is_rejected() -> None:
    """The (sha, segment_index) pair is the manifest join key, so a wrong
    segment_index with everything else copied from a real window still fails to
    resolve to any manifest window -- named as such rather than fuzzy-matched."""
    window = _window()
    doc = _doc(_entry(window, segment_index=window.segment_index + 1))
    problems = _problems(doc, all_windows=[window])
    assert any("segment_index" in p for p in problems)


def test_a_batch_dir_mismatch_is_rejected() -> None:
    window = _window()
    other = "/cache/somewhere/else/entirely"
    entry = _entry(window, batch_dir=other)
    entry["promotion_key"] = [window.video_sha256, other, window.run_id]
    doc = _doc(entry)
    problems = _problems(doc, all_windows=[window])
    assert any("batch_dir" in p for p in problems)


def test_a_correct_entry_among_review_and_skip_siblings_is_still_accepted() -> None:
    """The exact-match rule does not over-reject: a faithful entry for the auto
    window in a mixed manifest passes cleanly."""
    auto = _window()
    review = _window(
        segment_index=9001, decision=DECISION_REVIEW, reason=R_SUMMARY_CATEGORY
    )
    skip = _window(segment_index=9002, decision=DECISION_SKIP, reason=R_ALREADY_COVERED)
    doc = _doc(_entry(auto))
    assert _problems(doc, all_windows=[auto, review, skip]) == []


# ─── Selection: exact, order-preserving, complementary ────────────────────────


def test_selection_preserves_manifest_order_regardless_of_allowlist_json_order() -> None:
    w0 = _window(segment_index=9000)
    w1 = _window(segment_index=9001)
    w2 = _window(segment_index=9002)
    auto_windows = [w0, w1, w2]  # manifest order

    doc = _doc(_entry(w2), _entry(w0))  # allowlist JSON lists them reversed, and skips w1
    allowlist = parse_allowlist(doc)

    selected = selected_auto_windows(auto_windows, allowlist)
    assert [w.segment_index for w in selected] == [9000, 9002]


def test_excluded_is_the_exact_complement_of_selected() -> None:
    w0 = _window(segment_index=9000)
    w1 = _window(segment_index=9001)
    w2 = _window(segment_index=9002)
    auto_windows = [w0, w1, w2]

    doc = _doc(_entry(w0))
    allowlist = parse_allowlist(doc)

    selected = selected_auto_windows(auto_windows, allowlist)
    excluded = excluded_auto_windows(auto_windows, allowlist)
    assert [w.segment_index for w in selected] == [9000]
    assert [w.segment_index for w in excluded] == [9001, 9002]
    assert set(id(w) for w in selected) | set(id(w) for w in excluded) == set(
        id(w) for w in auto_windows
    )


# ─── Format predicates, directly ───────────────────────────────────────────────


def test_is_sha256_accepts_only_64_lowercase_hex() -> None:
    assert is_sha256("a" * 64)
    assert not is_sha256("A" * 64)
    assert not is_sha256("a" * 63)
    assert not is_sha256("g" * 64)
    assert not is_sha256(None)
    assert not is_sha256(64)


def test_is_git_sha_accepts_only_40_lowercase_hex() -> None:
    assert is_git_sha("a" * 40)
    assert not is_git_sha("A" * 40)
    assert not is_git_sha("a" * 39)
    assert not is_git_sha(None)
