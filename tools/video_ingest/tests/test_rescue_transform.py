"""The one-off schema-2 -> schema-3 rescue-manifest transform.

This tool exists because the live manifest is not regenerable: its 303 windows
encode hand-adjudicated identity decisions, and 18 of its auto windows have
already been executed and verified against the database. Regenerating would
re-derive all of that from a cache and a database that have both moved since,
and would renumber nothing but risk everything.

So the transform is deliberately narrow: it rewrites the sampling contract and
NOTHING else. Every test here is a statement of that narrowness — what must be
byte-identical afterwards, and what the tool must refuse to do.

The frame-rate probe is injected, so these run with no ffprobe and no video.
"""

from __future__ import annotations

import copy
import json

import pytest

from video_ingest.rescue_manifest import (
    AUTO_ELIGIBLE_SCREENS,
    DECISION_AUTO,
    DECISION_REVIEW,
    DECISION_SKIP,
    GROUP_MAX_GAP_S,
    REEL_CONTAINED,
    RESCUE_DECODER_VERSION,
    SCHEMA_VERSION,
    SEGMENT_INDEX_BASE,
    UNKNOWN_STATE,
    WINDOW_PAD_S,
)
from video_ingest.rescue_sampling import (
    SAMPLING_MODE,
    SourceGrid,
    UnsupportedFrameRate,
)
from rescue_sampling_helpers import GRID60, IDEAL_PROBE
from video_ingest.rescue_transform import (
    LEGACY_SCHEMA_VERSION,
    PRESERVED_COMMAND_FIELDS,
    PRESERVED_WINDOW_FIELDS,
    TransformRefused,
    semantic_diff,
    transform_document,
)

SHA_A = "a" * 64
SHA_B = "b" * 64
VIDEO_A = "/mnt/k/NHL/NHL26/a.mkv"
VIDEO_B = "/mnt/k/NHL/NHL26/b.mkv"
INPUT_DIGEST = "0" * 64


def _grids(_path: str) -> SourceGrid:
    return GRID60


def _legacy_window(
    *,
    sha: str = SHA_A,
    video_path: str = VIDEO_A,
    segment_index: int = SEGMENT_INDEX_BASE,
    target_screen: str | None = "post_game_faceoff_map",
    evidence_t: float = 2088.0,
    t0: float = 2087.25,
    t1: float = 2088.75,
    match_id: int | None = 2661,
    run_id: int | None = 2119,
    decision: str = DECISION_AUTO,
    reason: str | None = None,
    with_commands: bool = True,
) -> dict:
    """A window in the SCHEMA-2 shape, verbatim — including `-vf fps=1`.

    Hand-built rather than produced by `build_commands`, because `build_commands`
    no longer emits this shape. The input the transform must consume is the one
    on disk today, not one the current code can still make.
    """
    batch_dir = f"/home/michal/ingest-cache/{sha}/rescue/seg-{segment_index:03d}-{target_screen}"
    window: dict = {
        "video_sha256": sha,
        "video_path": video_path,
        "video_path_exists": True,
        "segment_index": segment_index,
        "target_screen": target_screen,
        "t0": t0,
        "t1": t1,
        "reel_index": 0,
        "reel_mode": REEL_CONTAINED,
        "match_id": match_id,
        "run_id": run_id,
        "decision": decision,
        "reason": reason,
        "frame_count": 1,
        "evidence": [
            {
                "t": evidence_t,
                "anchor_text": "rm 6-- 2 chi t faceoff rt 1st period",
                "assigned_screen_type": UNKNOWN_STATE,
                "rule": "faceoff_map",
            }
        ],
        "commands": None,
    }
    if with_commands:
        notes = f"rescue-b2:{sha[:12]}:seg{segment_index}:[{t0:.3f}..{t1:.3f}]s"
        window["commands"] = {
            "batch_dir": batch_dir,
            "notes": notes,
            "sample_fps": 1.0,
            "ffmpeg": [
                "ffmpeg", "-v", "error", "-y",
                "-ss", f"{t0:.3f}",
                "-to", f"{t1:.3f}",
                "-i", video_path,
                "-vf", "fps=1",
                "-fps_mode", "passthrough",
                f"{batch_dir}/%05d.png",
            ],
            "ingest_ocr": [
                "pnpm", "--filter", "worker", "ingest-ocr", "--",
                "--batch-dir", batch_dir,
                "--screen", str(target_screen),
                "--game-title-id", "1",
                "--match-id", str(match_id),
                "--capture-kind", "video_frames",
                "--video-sha256", sha,
                "--video-segment-index", str(segment_index),
                "--video-segment-start-sec", f"{t0:.3f}",
                "--video-segment-end-sec", f"{t1:.3f}",
                "--ui-version", "nhl26",
                "--decoder-version", RESCUE_DECODER_VERSION,
                "--notes", notes,
                "--run-id", str(run_id),
            ],
        }
    return window


def _legacy_doc(windows: list[dict] | None = None) -> dict:
    return {
        "schema_version": LEGACY_SCHEMA_VERSION,
        "generated_at": "2026-08-03T00:00:00+00:00",
        "cache_root": "/home/michal/ingest-cache",
        "policy": {
            "decoder_version": RESCUE_DECODER_VERSION,
            "segment_index_base": SEGMENT_INDEX_BASE,
            "group_max_gap_s": GROUP_MAX_GAP_S,
            "window_pad_s": WINDOW_PAD_S,
            "reel_lookback_s": 120.0,
            "auto_eligible_screens": list(AUTO_ELIGIBLE_SCREENS),
            "game_title_id": 1,
            "ui_version": "nhl26",
        },
        "windows": windows if windows is not None else [_legacy_window()],
        "unrecoverable": [
            {
                "match_id": 2400,
                "video_sha256": SHA_B,
                "reason": "match_never_ocr_ingested",
                "missing_screens": ["post_game_events"],
            }
        ],
    }


def _transform(doc, **kwargs):
    return transform_document(
        doc,
        grid_for=kwargs.pop("grid_for", _grids),
        probe_frames=kwargs.pop("probe_frames", IDEAL_PROBE),
        input_digest=kwargs.pop("input_digest", INPUT_DIGEST),
        **kwargs,
    )


# ─── The input is never touched ──────────────────────────────────────────────


def test_the_input_document_is_never_mutated():
    doc = _legacy_doc()
    before = copy.deepcopy(doc)
    _transform(doc)
    assert doc == before


def test_only_a_schema_two_manifest_is_accepted():
    doc = _legacy_doc()
    doc["schema_version"] = 3
    with pytest.raises(TransformRefused, match="schema"):
        _transform(doc)


def _refusing_probe(path: str) -> SourceGrid:
    raise UnsupportedFrameRate(f"variable frame rate: {path}")


def _probe_except(bad: str):
    def probe(path: str) -> SourceGrid:
        if path == bad:
            raise UnsupportedFrameRate(f"variable frame rate: {path}")
        return GRID60

    return probe


def test_an_unprobeable_video_under_an_auto_window_refuses_the_whole_transform():
    """Fail closed where it counts. Dropping an auto window's command would
    silently un-execute approved work, and pinning it to a guessed grid would
    name frames the video does not have."""
    with pytest.raises(UnsupportedFrameRate):
        _transform(_legacy_doc(), grid_for=_refusing_probe)


def test_an_unprobeable_video_under_a_non_auto_window_drops_that_command():
    """Fail SAFE, and visibly. A review window is not executable, so it is not
    worth refusing the whole repair over — but it must not keep a superseded
    fps command either, and the drop has to be enumerated rather than silent.

    This is the live corpus's real case: match 2400's trimmed mp4 carries frame
    PTS on an offset grid (1539.010517, not 1539.016667), so a command pinned to
    the naive n/60 grid would match no source frame and extract nothing.
    """
    doc = _legacy_doc([
        _legacy_window(segment_index=SEGMENT_INDEX_BASE),
        _legacy_window(
            sha=SHA_B,
            video_path=VIDEO_B,
            segment_index=SEGMENT_INDEX_BASE + 1,
            decision=DECISION_REVIEW,
            reason="match_never_ocr_ingested",
            run_id=None,
        ),
    ])
    out = _transform(doc, grid_for=_probe_except(VIDEO_B))

    assert out["windows"][0]["commands"]["sampling"]["mode"] == SAMPLING_MODE
    assert out["windows"][1]["commands"] is None

    (dropped,) = out["policy"]["sampling_unpinnable"]
    assert dropped["video_sha256"] == SHA_B
    assert dropped["segment_index"] == SEGMENT_INDEX_BASE + 1
    assert dropped["decision"] == DECISION_REVIEW
    assert "variable frame rate" in dropped["detail"]


def test_a_dropped_command_is_licensed_by_the_diff_only_when_enumerated():
    doc = _legacy_doc([
        _legacy_window(
            sha=SHA_B,
            video_path=VIDEO_B,
            decision=DECISION_REVIEW,
            reason="match_never_ocr_ingested",
        ),
    ])
    out = _transform(doc, grid_for=_probe_except(VIDEO_B))
    report = semantic_diff(doc, out)
    assert report["ok"] is True
    assert report["commands_dropped"] == 1

    # The same candidate, with the enumeration removed, is no longer licensed.
    out["policy"]["sampling_unpinnable"] = []
    assert semantic_diff(doc, out)["ok"] is False


def test_an_auto_window_may_never_appear_in_the_unpinnable_ledger():
    doc = _legacy_doc()
    out = _transform(doc)
    out["policy"]["sampling_unpinnable"] = [
        {
            "video_sha256": SHA_A,
            "segment_index": SEGMENT_INDEX_BASE,
            "video_path": VIDEO_A,
            "decision": DECISION_AUTO,
            "reason": None,
            "detail": "hand-inserted",
        }
    ]
    report = semantic_diff(doc, out)
    assert report["ok"] is False
    assert any("auto" in v for v in report["violations"])


# ─── What changes ────────────────────────────────────────────────────────────


def test_the_candidate_is_schema_three_with_the_sampling_policy():
    out = _transform(_legacy_doc())
    assert out["schema_version"] == SCHEMA_VERSION
    assert out["policy"]["sampling_mode"] == SAMPLING_MODE
    assert out["policy"]["source_frame_rates"] == {SHA_A: "60/1"}
    assert out["policy"]["source_pts_origins"] == {SHA_A: 0.0}
    assert out["policy"]["sampling_unpinnable"] == []
    assert out["policy"]["transformed_from_manifest_sha256"] == INPUT_DIGEST


def test_every_command_loses_sample_fps_and_gains_sampling():
    out = _transform(_legacy_doc())
    commands = out["windows"][0]["commands"]
    assert "sample_fps" not in commands
    assert commands["sampling"]["mode"] == SAMPLING_MODE
    assert commands["sampling"]["evidence_timestamps"] == [2088.0]
    assert commands["sampling"]["expected_frame_count"] == 3


def test_the_ffmpeg_argv_becomes_the_canonical_source_pts_command():
    out = _transform(_legacy_doc())
    argv = out["windows"][0]["commands"]["ffmpeg"]
    assert "-copyts" in argv
    assert "-frames:v" in argv
    assert "-to" not in argv
    assert not any(t.startswith("fps=") for t in argv)
    # The seek leads the first selected frame by one interval and is expressed
    # relative to the measured grid origin (zero here).
    assert argv[argv.index("-ss") + 1] == "2087.233"
    assert argv[argv.index("-t") + 1] == "0.817"
    # ffmpeg writes into staging; ingest-ocr still reads the batch dir.
    assert argv[-1].endswith("/.staging/%05d.png")


def test_review_and_skip_windows_that_carry_commands_are_transformed_too():
    """They are not executable, but a review window that is later approved must
    not carry a superseded command — and a stale `fps=1` anywhere in the file
    would make 'no fps commands remain' unprovable."""
    doc = _legacy_doc([
        _legacy_window(segment_index=SEGMENT_INDEX_BASE, decision=DECISION_AUTO),
        _legacy_window(
            segment_index=SEGMENT_INDEX_BASE + 1,
            decision=DECISION_REVIEW,
            reason="ambiguous_mixed_anchor",
        ),
        _legacy_window(
            segment_index=SEGMENT_INDEX_BASE + 2,
            decision=DECISION_SKIP,
            reason="already_covered",
        ),
    ])
    out = _transform(doc)
    assert all("sample_fps" not in w["commands"] for w in out["windows"])
    assert all("sampling" in w["commands"] for w in out["windows"])


def test_a_window_with_no_commands_stays_at_null():
    doc = _legacy_doc([_legacy_window(with_commands=False, decision=DECISION_REVIEW,
                                      reason="reel_has_no_confirmed_match")])
    out = _transform(doc)
    assert out["windows"][0]["commands"] is None


# ─── What must not change ────────────────────────────────────────────────────


def test_window_identity_and_ordering_survive_exactly():
    doc = _legacy_doc([
        _legacy_window(segment_index=SEGMENT_INDEX_BASE + 2),
        _legacy_window(segment_index=SEGMENT_INDEX_BASE),
        _legacy_window(sha=SHA_B, video_path=VIDEO_B, segment_index=SEGMENT_INDEX_BASE + 1),
    ])
    out = _transform(doc)
    assert [(w["video_sha256"], w["segment_index"]) for w in out["windows"]] == [
        (SHA_A, SEGMENT_INDEX_BASE + 2),
        (SHA_A, SEGMENT_INDEX_BASE),
        (SHA_B, SEGMENT_INDEX_BASE + 1),
    ]


def test_every_preserved_window_field_is_byte_identical():
    doc = _legacy_doc()
    out = _transform(doc)
    for field in PRESERVED_WINDOW_FIELDS:
        assert out["windows"][0][field] == doc["windows"][0][field], field


def test_batch_dir_notes_and_ingest_ocr_argv_are_byte_identical():
    doc = _legacy_doc()
    out = _transform(doc)
    for field in PRESERVED_COMMAND_FIELDS:
        assert out["windows"][0]["commands"][field] == doc["windows"][0]["commands"][field]


def test_the_unrecoverable_inventory_and_cache_root_are_untouched():
    doc = _legacy_doc()
    out = _transform(doc)
    assert out["unrecoverable"] == doc["unrecoverable"]
    assert out["cache_root"] == doc["cache_root"]
    assert out["generated_at"] == doc["generated_at"]


def test_the_existing_policy_keys_are_carried_over_unchanged():
    doc = _legacy_doc()
    out = _transform(doc)
    for key, value in doc["policy"].items():
        assert out["policy"][key] == value, key


def test_the_transform_is_deterministic():
    """Same input, same bytes — no timestamp, no ordering nondeterminism. This
    is what lets a reviewer reproduce the candidate digest independently."""
    doc = _legacy_doc()
    a = json.dumps(_transform(doc), sort_keys=False)
    b = json.dumps(_transform(doc), sort_keys=False)
    assert a == b


# ─── The semantic diff ───────────────────────────────────────────────────────


def test_the_diff_reports_the_schema_and_policy_change():
    doc = _legacy_doc()
    report = semantic_diff(doc, _transform(doc))
    assert report["schema_version"] == {"before": 2, "after": 3}
    assert "sampling_mode" in report["policy"]["added"]
    assert report["policy"]["changed"] == []
    assert report["policy"]["removed"] == []


def test_the_diff_proves_promotion_keys_are_unchanged():
    doc = _legacy_doc([
        _legacy_window(segment_index=SEGMENT_INDEX_BASE),
        _legacy_window(segment_index=SEGMENT_INDEX_BASE + 1, run_id=None,
                       decision=DECISION_SKIP, reason="already_covered"),
    ])
    report = semantic_diff(doc, _transform(doc))
    assert report["promotion_keys_identical"] is True
    assert report["completion_gate_identical"] is True
    assert report["window_order_identical"] is True


def test_the_diff_names_exactly_the_command_keys_that_moved():
    doc = _legacy_doc()
    report = semantic_diff(doc, _transform(doc))
    assert report["command_keys"]["added"] == {"sampling": 1}
    assert report["command_keys"]["removed"] == {"sample_fps": 1}
    assert report["command_keys"]["changed"] == {"ffmpeg": 1}
    assert report["windows_changed"] == 1
    assert report["windows_unchanged"] == 0


def test_the_diff_is_machine_checkable_and_json_serialisable():
    doc = _legacy_doc()
    report = semantic_diff(doc, _transform(doc))
    assert report["ok"] is True
    assert report["violations"] == []
    assert json.loads(json.dumps(report)) == json.loads(json.dumps(report))


def test_the_diff_catches_a_tampered_candidate():
    """The report is a check, not a narration: it must fail on a candidate that
    changed something it had no licence to change."""
    doc = _legacy_doc()
    out = _transform(doc)
    out["windows"][0]["run_id"] = 999

    report = semantic_diff(doc, out)
    assert report["ok"] is False
    assert report["promotion_keys_identical"] is False
    assert any("run_id" in v for v in report["violations"])


def test_the_diff_catches_a_reordered_candidate():
    doc = _legacy_doc([
        _legacy_window(segment_index=SEGMENT_INDEX_BASE),
        _legacy_window(segment_index=SEGMENT_INDEX_BASE + 1),
    ])
    out = _transform(doc)
    out["windows"].reverse()

    report = semantic_diff(doc, out)
    assert report["ok"] is False
    assert report["window_order_identical"] is False


def test_the_diff_catches_a_dropped_window():
    doc = _legacy_doc([
        _legacy_window(segment_index=SEGMENT_INDEX_BASE),
        _legacy_window(segment_index=SEGMENT_INDEX_BASE + 1),
    ])
    out = _transform(doc)
    out["windows"].pop()

    report = semantic_diff(doc, out)
    assert report["ok"] is False
    assert report["window_count"] == {"before": 2, "after": 1}


def test_the_diff_catches_a_surviving_fps_command():
    doc = _legacy_doc()
    out = _transform(doc)
    out["windows"][0]["commands"]["sample_fps"] = 1.0

    report = semantic_diff(doc, out)
    assert report["ok"] is False
    assert any("sample_fps" in v for v in report["violations"])
