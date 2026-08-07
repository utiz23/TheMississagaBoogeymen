"""Stage-B rescue executor — the safety gate in front of Stage A's pinned argv.

Every test here builds its windows through Stage A's own ``build_commands`` and
``manifest_to_dict``, so a faithful manifest is proven to pass untouched and the
rejections are proven to be rejections of real tampering rather than of a
hand-rolled fixture shape.

The three IO seams (``completion_facts``, ``run_command``, ``make_batch_dir``)
are recorders, so "nothing was executed" and "the database was never reached"
are assertions rather than hopes.

``completion_facts`` returns the rows a real ingest would leave behind, so the
completion predicate is exercised against the shape ``ingest-ocr`` actually
writes — including the shapes it writes when it fails and still exits 0.
"""

from __future__ import annotations

import dataclasses
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

import pytest

from video_ingest.rescue_allowlist import (
    ALLOWLIST_KIND,
    ALLOWLIST_SCHEMA_VERSION,
    Allowlist,
    AllowlistEntry,
)
from video_ingest.rescue_execute import (
    DRY_RUN_BANNER,
    EXECUTE_FLAG,
    OUTCOME_FAILED,
    OUTCOME_PROMOTED,
    REQUIRED_EXECUTION_ENV,
    RESCUE_DIR_MARKER,
    STEP_FFMPEG,
    STEP_INGEST_OCR,
    CommandResult,
    CompletionFact,
    ExecutionPlan,
    RescueAborted,
    WindowOutcome,
    argv_fingerprint,
    assert_executable,
    authorization_problems,
    build_receipt,
    command_problems,
    completion_problems,
    environment_problems,
    executable_windows,
    execute_plan,
    file_digest,
    list_output_files,
    prove_current_outputs,
    prove_staging_empty,
    expected_segment_key,
    load_manifest,
    plan_rescue,
    policy_problems,
    promotion_key,
    required_artifacts,
    run_rescue,
    validate_for_execution,
)
from video_ingest.rescue_manifest import (
    AUTO_ELIGIBLE_SCREENS,
    STAGING_DIRNAME,
    expected_output_names,
    rescue_output_pattern,
    rescue_staging_dir,
    DECISION_AUTO,
    DECISION_REVIEW,
    DECISION_SKIP,
    GROUP_MAX_GAP_S,
    REEL_CONTAINED,
    REEL_LOOKBACK_S,
    RESCUE_DECODER_VERSION,
    SCHEMA_VERSION,
    SEGMENT_INDEX_BASE,
    UNKNOWN_STATE,
    WINDOW_PAD_S,
    R_ALREADY_COVERED,
    R_SUMMARY_CATEGORY,
    Window,
    build_commands,
    manifest_to_dict,
    sampling_policy,
)
from video_ingest.rescue_sampling import (
    canonical_ffmpeg_argv,
    sampling_from_dict,
)

from rescue_sampling_helpers import GRID60, IDEAL_PROBE

SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64

RUN_ID = "rescue-b2-20260803T120000Z"
EXECUTED_AT = "2026-08-03T12:00:00+00:00"


# ─── Fixture construction (through Stage A's own builders) ───────────────────


def _complete_fact(window: Window, **overrides: Any) -> CompletionFact:
    """Exactly what a FULLY successful ingest of `window` leaves behind.

    Every field is derived from the window itself, so a test that wants to
    model a specific partial failure overrides one field and inherits a
    correct row for all the others.
    """
    fields: dict[str, Any] = {
        "video_sha256": window.video_sha256,
        "source_directory": window.commands["batch_dir"],
        "run_id": window.run_id,
        "batch_match_id": window.match_id,
        "segment_key": expected_segment_key(window),
        "segment_match_id": window.match_id,
        "segment_run_id": window.run_id,
        "state": window.target_screen,
        "t_start_sec": f"{window.t0:.3f}",
        "t_end_sec": f"{window.t1:.3f}",
        "decoder_version": RESCUE_DECODER_VERSION,
        "frame_count": 2,
        "observability_status": "observable",
        "extraction_count": 2,
        "extraction_success_count": 2,
    }
    fields.update(overrides)
    return CompletionFact(**fields)


def _batch_only_fact(window: Window, **overrides: Any) -> CompletionFact:
    """The row `ingest-ocr` writes BEFORE it processes a single result.

    This is the state the old existence predicate mistook for success: the
    capture batch is there, the segment and the extractions are not, and the
    process exited 0.
    """
    fields: dict[str, Any] = {
        "video_sha256": window.video_sha256,
        "source_directory": window.commands["batch_dir"],
        "run_id": window.run_id,
        "batch_match_id": window.match_id,
    }
    fields.update(overrides)
    return CompletionFact(**fields)


class FactProbe:
    """The database seam. Counts calls so ordering can be asserted.

    `after` models the database changing underneath the run: the first call is
    the plan-time read, every later call is a post-execution verification.
    """

    def __init__(
        self,
        facts: Sequence[CompletionFact] = (),
        *,
        after: Sequence[CompletionFact] | None = None,
    ) -> None:
        self.facts = list(facts)
        self.after = None if after is None else list(after)
        self.calls = 0

    @classmethod
    def completing(cls, *windows: Window) -> "FactProbe":
        """Empty at plan time; every window verifiably complete afterwards."""
        return cls([], after=[_complete_fact(w) for w in windows])

    def __call__(self) -> list[CompletionFact]:
        self.calls += 1
        if self.after is not None and self.calls > 1:
            return list(self.after)
        return list(self.facts)


class Recorder:
    """The subprocess seam. Records argv; optionally fails a named step.

    A successful ``ffmpeg`` call MATERIALISES the frames the pinned argv asked
    for, because the executor now counts them: a double that recorded the call
    but produced nothing would model an ffmpeg that silently found no matching
    source frame, which is a different (and separately tested) scenario.
    ``frames`` overrides the count to model exactly that shortfall.
    """

    def __init__(
        self,
        fail_on: str | None = None,
        returncode: int = 1,
        frames: int | None = None,
    ) -> None:
        self.calls: list[list[str]] = []
        self.fail_on = fail_on
        self.returncode = returncode
        self.frames = frames

    def __call__(self, argv: Sequence[str]) -> CommandResult:
        self.calls.append(list(argv))
        if self.fail_on is not None and argv[0] == self.fail_on:
            return CommandResult(returncode=self.returncode, stderr="boom")
        if argv[0] == "ffmpeg":
            self._write_frames(list(argv))
        return CommandResult(returncode=0)

    def _write_frames(self, argv: list[str]) -> None:
        asked = int(argv[argv.index("-frames:v") + 1])
        produced = asked if self.frames is None else self.frames
        out_dir = Path(argv[-1]).parent
        out_dir.mkdir(parents=True, exist_ok=True)
        for i in range(1, produced + 1):
            (out_dir / f"{i:05d}.png").write_bytes(b"\x89PNG\r\n\x1a\n")


def _make_window(
    *,
    cache_root: Path,
    video_path: Path,
    sha: str = SHA_A,
    segment_index: int = SEGMENT_INDEX_BASE,
    target_screen: str | None = "post_game_box_score_goals",
    t0: float = 100.0,
    t1: float = 101.5,
    match_id: int | None = 472,
    run_id: int | None = 55,
    decision: str = DECISION_AUTO,
    reason: str | None = None,
    with_commands: bool = True,
) -> Window:
    window = Window(
        video_sha256=sha,
        video_path=str(video_path),
        video_path_exists=True,
        segment_index=segment_index,
        target_screen=target_screen,
        t0=t0,
        t1=t1,
        reel_index=0,
        reel_mode=REEL_CONTAINED,
        match_id=match_id,
        run_id=run_id,
        decision=decision,
        reason=reason,
        frame_count=1,
        evidence=[
            {
                "t": t0 + WINDOW_PAD_S,
                "anchor_text": "lt goalsummary",
                "assigned_screen_type": UNKNOWN_STATE,
                "rule": "goal_summary",
            }
        ],
    )
    if with_commands:
        window.commands = build_commands(
            window,
            cache_root=str(cache_root),
            game_title_id=1,
            source_grid=GRID60,
            probe_frames=IDEAL_PROBE,
        )
    return window


def _manifest_doc(windows: Sequence[Window], *, cache_root: Path, **policy_overrides) -> dict:
    policy = {
        "decoder_version": RESCUE_DECODER_VERSION,
        "segment_index_base": SEGMENT_INDEX_BASE,
        "group_max_gap_s": GROUP_MAX_GAP_S,
        "window_pad_s": WINDOW_PAD_S,
        "reel_lookback_s": REEL_LOOKBACK_S,
        "auto_eligible_screens": list(AUTO_ELIGIBLE_SCREENS),
        "game_title_id": 1,
        "ui_version": "nhl26",
        **sampling_policy(
            source_grids={SHA_A: GRID60.rate.text},
            source_pts_origins={SHA_A: GRID60.origin_s},
        ),
    }
    policy.update(policy_overrides)
    return manifest_to_dict(
        windows,
        policy=policy,
        unrecoverable=[],
        generated_at="2026-08-03T00:00:00+00:00",
        cache_root=str(cache_root),
    )


def _seed_cache(cache_root: Path, *shas: str) -> None:
    for sha in shas:
        sha_dir = cache_root / sha
        sha_dir.mkdir(parents=True, exist_ok=True)
        (sha_dir / "segments.json").write_text("{}")


def _seed_video(tmp_path: Path, name: str = "match.mkv") -> Path:
    video = tmp_path / "videos" / name
    video.parent.mkdir(parents=True, exist_ok=True)
    video.write_bytes(b"\x00")
    return video


def _write(doc: dict, tmp_path: Path, name: str = "rescue-manifest.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(doc, indent=1) + "\n")
    return path


#: Fixed stand-ins for `git rev-parse HEAD`. Real provenance reading is
#: exercised separately, against the real script and the real repository, in
#: section (10)'s CLI wiring tests -- everywhere else, `--execute` needs SOME
#: allowlist bound to SOME HEAD, and what value that is does not matter.
REPO_HEAD = "f" * 40
OTHER_REPO_HEAD = "e" * 40


def _repo_head(head: str = REPO_HEAD):
    return lambda: head


def _manifest_sha(manifest_path: Path) -> str:
    return hashlib.sha256(manifest_path.read_bytes()).hexdigest()


def _allowlist_entry_for(window: Window) -> dict[str, Any]:
    batch_dir = window.commands["batch_dir"]
    return {
        "video_sha256": window.video_sha256,
        "segment_index": window.segment_index,
        "target_screen": window.target_screen,
        "match_id": window.match_id,
        "run_id": window.run_id,
        "batch_dir": batch_dir,
        "promotion_key": [window.video_sha256, batch_dir, window.run_id],
    }


def _allowlist_doc(
    *windows: Window,
    manifest_sha256: str,
    repository_head: str = REPO_HEAD,
    source_proposal_sha256: str | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": ALLOWLIST_SCHEMA_VERSION,
        "kind": ALLOWLIST_KIND,
        "manifest_sha256": manifest_sha256,
        "repository_head": repository_head,
        "source_proposal_sha256": source_proposal_sha256,
        "windows": [_allowlist_entry_for(w) for w in windows],
    }


def _write_allowlist(doc: dict[str, Any], tmp_path: Path, name: str = "allowlist.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(doc, indent=1) + "\n")
    return path


def _two_window_plan(env, *, both_selected: bool = True) -> tuple[ExecutionPlan, list[Window]]:
    """Two auto windows on one manifest, with a validated allowlist selecting
    either both (the default) or just the first. Used by the mutation-boundary
    tests below as the KNOWN-GOOD plan they then corrupt with
    `dataclasses.replace` -- `plan_rescue` itself never produces the corrupted
    shapes those tests need."""
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(2)
    ]
    manifest = _write(
        _manifest_doc(windows, cache_root=cache_root), env["tmp"], "mutation-two.json"
    )
    selected = windows if both_selected else windows[:1]
    allow = _write_allowlist(
        _allowlist_doc(*selected, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    return plan, windows


#: A syntactically valid execution environment. The values are placeholders on
#: purpose: the gate checks presence and non-emptiness only — it never connects,
#: never stats and never resolves, so no value here needs to be real.
VALID_ENVIRON: dict[str, str] = {
    "DATABASE_URL": "postgres://eanhl@localhost:5433/eanhl",
    "OCR_PYTHON": "/opt/venv/bin/python",
}


@pytest.fixture(autouse=True)
def _operator_sourced_the_dotenv(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every OTHER test runs as if the operator had sourced the repo `.env`.

    The environment preflight defaults to the real `os.environ`, which in a test
    process holds neither variable. Without this the whole suite would be
    re-asserting the gate instead of the behaviour each test is actually about.
    Section (5b) overrides it explicitly — that is where the gate is proven.
    """
    for name, value in VALID_ENVIRON.items():
        monkeypatch.setenv(name, value)


@pytest.fixture()
def env(tmp_path: Path):
    """A minimal but FAITHFUL one-auto-window manifest with its artifacts present."""
    cache_root = tmp_path / "ingest-cache"
    video = _seed_video(tmp_path)
    _seed_cache(cache_root, SHA_A)
    window = _make_window(cache_root=cache_root, video_path=video)
    manifest = _write(_manifest_doc([window], cache_root=cache_root), tmp_path)
    return {
        "cache_root": cache_root,
        "video": video,
        "window": window,
        "manifest": manifest,
        "tmp": tmp_path,
    }


# ─── The happy path: a faithful Stage A manifest passes untouched ────────────


def test_a_faithful_stage_a_manifest_validates_clean(env) -> None:
    doc = load_manifest(env["manifest"])
    assert validate_for_execution(doc) == []


def test_plan_selects_the_auto_window(env) -> None:
    probe = FactProbe()
    plan = plan_rescue(manifest_path=env["manifest"], completion_facts=probe)

    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]
    assert plan.verified_complete == ()
    assert plan.cache_root == env["cache_root"]
    assert probe.calls == 1


# ─── (1) Manifest rejection ─────────────────────────────────────────────────


def test_unreadable_manifest_is_a_clean_abort(tmp_path: Path) -> None:
    with pytest.raises(RescueAborted, match="manifest unreadable"):
        load_manifest(tmp_path / "nope.json")


def test_unparseable_manifest_is_a_clean_abort(tmp_path: Path) -> None:
    path = tmp_path / "m.json"
    path.write_text("{not json")
    with pytest.raises(RescueAborted, match="not valid JSON"):
        load_manifest(path)


def test_non_object_manifest_root_is_a_clean_abort(tmp_path: Path) -> None:
    path = tmp_path / "m.json"
    path.write_text("[]")
    with pytest.raises(RescueAborted, match="must be a JSON object"):
        load_manifest(path)


def test_a_v1_schema_manifest_is_rejected(env) -> None:
    doc = load_manifest(env["manifest"])
    doc["schema_version"] = 1
    assert any("schema_version" in p for p in validate_for_execution(doc))


@pytest.mark.parametrize(
    "override,needle",
    [
        ({"decoder_version": "rescue-b1-anchor-v0"}, "policy.decoder_version"),
        ({"segment_index_base": 100}, "policy.segment_index_base"),
        ({"auto_eligible_screens": ["post_game_events"]}, "policy.auto_eligible_screens"),
    ],
)
def test_a_manifest_from_a_different_policy_is_rejected(env, override, needle) -> None:
    """A drifted policy is not merely older -- its windows encode rollback and
    idempotency keys this executor does not describe."""
    doc = _manifest_doc([env["window"]], cache_root=env["cache_root"], **override)
    assert any(needle in p for p in policy_problems(doc))


def test_a_manifest_with_no_policy_is_rejected(env) -> None:
    doc = load_manifest(env["manifest"])
    del doc["policy"]
    assert any("policy" in p for p in validate_for_execution(doc))


def test_an_auto_window_without_commands_is_rejected(env) -> None:
    """Condition: auto windows must carry valid, NON-NULL commands."""
    window = _make_window(
        cache_root=env["cache_root"], video_path=env["video"], with_commands=False
    )
    doc = _manifest_doc([window], cache_root=env["cache_root"])
    problems = validate_for_execution(doc)
    assert any("commands" in p for p in problems)


@pytest.mark.parametrize(
    "flag,tampered,needle",
    [
        ("--screen", "post_game_events", "commands.ingest_ocr --screen"),
        ("--match-id", "999", "commands.ingest_ocr --match-id"),
        ("--video-sha256", SHA_B, "commands.ingest_ocr --video-sha256"),
        ("--video-segment-index", "12", "commands.ingest_ocr --video-segment-index"),
        ("--run-id", "9999", "commands.ingest_ocr --run-id"),
        ("--decoder-version", "hmm-viterbi-v2", "commands.ingest_ocr --decoder-version"),
        ("--capture-kind", "manual_screenshots", "commands.ingest_ocr --capture-kind"),
    ],
)
def test_a_tampered_ingest_flag_is_rejected(env, flag, tampered, needle) -> None:
    """The command fingerprint is verified against the window's own fields, so a
    hand-edited or cross-manifest argv cannot execute."""
    window = env["window"]
    argv = list(window.commands["ingest_ocr"])
    argv[argv.index(flag) + 1] = tampered
    window.commands["ingest_ocr"] = argv

    problems = command_problems(window, cache_root=str(env["cache_root"]))
    assert any(needle in p for p in problems), problems


def test_stripping_the_rescue_decoder_tag_is_rejected(env) -> None:
    """That tag is the segment-layer rollback handle; without it rescued rows
    are indistinguishable from natively decoded ones."""
    window = env["window"]
    argv = [t for t in window.commands["ingest_ocr"] if t != RESCUE_DECODER_VERSION]
    argv.remove("--decoder-version")
    window.commands["ingest_ocr"] = argv

    assert any("--decoder-version" in p for p in command_problems(
        window, cache_root=str(env["cache_root"])
    ))


def test_stripping_the_run_id_is_rejected(env) -> None:
    """run_id is half the promotion key -- an untagged rescue batch would be a
    second, unkeyed row that no rerun could recognise."""
    window = env["window"]
    argv = list(window.commands["ingest_ocr"])
    i = argv.index("--run-id")
    del argv[i : i + 2]
    window.commands["ingest_ocr"] = argv

    assert any("--run-id" in p for p in command_problems(
        window, cache_root=str(env["cache_root"])
    ))


def test_a_batch_dir_moved_outside_the_rescue_tree_is_rejected(env) -> None:
    """`source_directory LIKE '%/rescue/%'` is how rollback finds these batches."""
    window = env["window"]
    window.commands["batch_dir"] = str(env["cache_root"] / SHA_A / "seg-9000-goals")

    problems = command_problems(window, cache_root=str(env["cache_root"]))
    assert any("batch_dir" in p for p in problems)
    assert RESCUE_DIR_MARKER not in window.commands["batch_dir"]


def test_ffmpeg_geometry_must_match_the_window(env) -> None:
    """Stage B does not recompute geometry -- but it does refuse argv that
    disagrees with the geometry the manifest itself published."""
    window = env["window"]
    argv = list(window.commands["ffmpeg"])
    argv[argv.index("-ss") + 1] = "999.000"
    window.commands["ffmpeg"] = argv

    assert any("commands.ffmpeg" in p for p in command_problems(
        window, cache_root=str(env["cache_root"])
    ))


# ─── The exact-evidence sampling contract ───────────────────────────────────


def test_a_faithful_sampling_command_passes_untouched(env) -> None:
    assert command_problems(env["window"], cache_root=str(env["cache_root"])) == []


def test_the_old_fps_based_auto_command_is_rejected(env) -> None:
    """The schema-2 shape, verbatim: an `fps=N` filter and a `sample_fps` key.

    This is the command that produced two dropdown frames and never the
    evidence frame. It must not be executable under any circumstances.
    """
    window = env["window"]
    window.commands["sample_fps"] = 1.0
    window.commands["ffmpeg"] = [
        "ffmpeg", "-v", "error", "-y",
        "-ss", f"{window.t0:.3f}",
        "-to", f"{window.t1:.3f}",
        "-i", window.video_path,
        "-vf", "fps=1",
        "-fps_mode", "passthrough",
        f"{window.commands['batch_dir']}/%05d.png",
    ]

    problems = command_problems(window, cache_root=str(env["cache_root"]))
    assert any("sample_fps" in p for p in problems)
    assert any("commands.ffmpeg" in p for p in problems)


def test_an_auto_command_without_sampling_metadata_is_rejected(env) -> None:
    window = env["window"]
    del window.commands["sampling"]
    assert any(
        "sampling" in p
        for p in command_problems(window, cache_root=str(env["cache_root"]))
    )


def test_sampling_metadata_that_omits_an_evidence_timestamp_is_rejected(env) -> None:
    """The whole point of the repair: every evidence timestamp is represented."""
    window = env["window"]
    window.evidence.append(
        {
            "t": window.t0 + 0.25,
            "anchor_text": "lt goalsummary",
            "assigned_screen_type": UNKNOWN_STATE,
            "rule": "goal_summary",
        }
    )
    problems = command_problems(window, cache_root=str(env["cache_root"]))
    assert any("evidence_timestamps" in p for p in problems)


def test_argv_that_disagrees_with_its_own_sampling_metadata_is_rejected(env) -> None:
    """Metadata and argv are checked against each other by RECONSTRUCTION, so a
    plausible hand-edit of either one cannot pass."""
    window = env["window"]
    argv = list(window.commands["ffmpeg"])
    argv[argv.index("-frames:v") + 1] = "9"
    window.commands["ffmpeg"] = argv

    assert any(
        "does not match the canonical" in p
        for p in command_problems(window, cache_root=str(env["cache_root"]))
    )


def test_a_rewritten_select_expression_is_rejected_without_being_parsed(env) -> None:
    window = env["window"]
    argv = list(window.commands["ffmpeg"])
    argv[argv.index("-vf") + 1] = "select=between(t\\,0\\,999999)"
    window.commands["ffmpeg"] = argv

    assert command_problems(window, cache_root=str(env["cache_root"]))


def test_a_tampered_source_frame_rate_is_rejected(env) -> None:
    window = env["window"]
    window.commands["sampling"]["source_frame_rate"] = "0/0"
    assert any(
        "source grid" in p
        for p in command_problems(window, cache_root=str(env["cache_root"]))
    )


def test_a_tampered_source_pts_origin_is_rejected(env) -> None:
    """The origin is half the grid, so tampering with it must be as fatal as
    tampering with the rate: every derived band moves with it."""
    window = env["window"]
    window.commands["sampling"]["source_pts_origin_s"] = 0.004
    assert command_problems(window, cache_root=str(env["cache_root"]))


def test_pinned_observations_that_contradict_the_pinned_grid_are_rejected(env) -> None:
    window = env["window"]
    observed = list(window.commands["sampling"]["observed_frame_pts"])
    observed[0] += 0.05
    window.commands["sampling"]["observed_frame_pts"] = observed
    assert any(
        "observed_frame_pts" in p
        for p in command_problems(window, cache_root=str(env["cache_root"]))
    )


def test_the_pinned_argv_is_exactly_the_canonical_one(env) -> None:
    window = env["window"]
    assert window.commands["ffmpeg"] == canonical_ffmpeg_argv(
        video_path=window.video_path,
        output_pattern=rescue_output_pattern(window.commands["batch_dir"]),
        plan=sampling_from_dict(window.commands["sampling"]),
    )


def test_the_policy_must_declare_the_sampling_mode(env) -> None:
    doc = _manifest_doc([env["window"]], cache_root=env["cache_root"])
    doc["policy"].pop("sampling_mode")
    assert any("sampling_mode" in p for p in policy_problems(doc))

    doc["policy"]["sampling_mode"] = "fps"
    assert any("sampling_mode" in p for p in policy_problems(doc))


def test_a_schema_two_manifest_is_refused(env) -> None:
    doc = _manifest_doc([env["window"]], cache_root=env["cache_root"])
    doc["schema_version"] = 2
    assert any("schema_version" in p for p in policy_problems(doc))


@pytest.mark.parametrize(
    "output",
    [
        "/tmp/elsewhere/%05d.png",
        # The batch dir ITSELF is not acceptable: writing there is exactly what
        # makes "which files did this invocation produce" unanswerable.
        "{batch_dir}/%05d.png",
        "{batch_dir}/.staging/frame-%05d.png",
    ],
)
def test_an_ffmpeg_output_outside_the_staging_directory_is_rejected(env, output) -> None:
    window = env["window"]
    argv = list(window.commands["ffmpeg"])
    argv[-1] = output.format(batch_dir=window.commands["batch_dir"])
    window.commands["ffmpeg"] = argv

    assert any("staging" in p for p in command_problems(
        window, cache_root=str(env["cache_root"])
    ))


def test_a_malformed_review_window_still_aborts_the_run(env) -> None:
    """Validation is whole-manifest. A manifest that is broken anywhere is one
    whose auto windows cannot be trusted either."""
    good = env["window"]
    broken = _make_window(
        cache_root=env["cache_root"],
        video_path=env["video"],
        segment_index=SEGMENT_INDEX_BASE + 1,
        decision=DECISION_REVIEW,
        reason=None,  # a review window MUST carry a reason
    )
    doc = _manifest_doc([good, broken], cache_root=env["cache_root"])
    manifest = _write(doc, env["tmp"], "broken.json")

    probe = FactProbe()
    with pytest.raises(RescueAborted, match="manifest REJECTED"):
        plan_rescue(manifest_path=manifest, completion_facts=probe)
    assert probe.calls == 0


def test_rejection_message_names_every_problem_not_just_the_first(env) -> None:
    window = env["window"]
    window.commands["ingest_ocr"] = ["pnpm"]  # loses every required flag
    doc = _manifest_doc([window], cache_root=env["cache_root"])
    manifest = _write(doc, env["tmp"], "bad.json")

    with pytest.raises(RescueAborted) as excinfo:
        plan_rescue(manifest_path=manifest, completion_facts=FactProbe())
    message = str(excinfo.value)
    assert "--screen" in message and "--run-id" in message and "--decoder-version" in message


# ─── (2) Exact cache-artifact preflight ─────────────────────────────────────


def test_required_artifacts_are_exactly_the_auto_sets_segments_json(env) -> None:
    window = env["window"]
    checks = required_artifacts([window], env["cache_root"])
    cache = [c for c in checks if c.kind == "pass1_cache"]

    assert [c.path for c in cache] == [env["cache_root"] / SHA_A / "segments.json"]


def test_artifact_preflight_ignores_shas_only_reached_by_review_windows(
    tmp_path: Path,
) -> None:
    """The preflight is scoped to the AUTO set. A review-only video whose cache
    entry is absent is not this run's problem and must not abort it."""
    cache_root = tmp_path / "ingest-cache"
    video = _seed_video(tmp_path)
    _seed_cache(cache_root, SHA_A)  # SHA_B deliberately NOT seeded

    auto = _make_window(cache_root=cache_root, video_path=video, sha=SHA_A)
    review = _make_window(
        cache_root=cache_root,
        video_path=video,
        sha=SHA_B,
        segment_index=SEGMENT_INDEX_BASE + 1,
        decision=DECISION_REVIEW,
        reason=R_SUMMARY_CATEGORY,
    )
    skip = _make_window(
        cache_root=cache_root,
        video_path=video,
        sha=SHA_C,
        segment_index=SEGMENT_INDEX_BASE + 2,
        decision=DECISION_SKIP,
        reason=R_ALREADY_COVERED,
    )
    manifest = _write(_manifest_doc([auto, review, skip], cache_root=cache_root), tmp_path)

    plan = plan_rescue(manifest_path=manifest, completion_facts=FactProbe())

    assert [c.path for c in plan.artifacts if c.kind == "pass1_cache"] == [
        cache_root / SHA_A / "segments.json"
    ]
    assert [w.video_sha256 for w in plan.pending] == [SHA_A]


def test_a_missing_segments_json_for_an_auto_window_aborts(tmp_path: Path) -> None:
    cache_root = tmp_path / "ingest-cache"
    video = _seed_video(tmp_path)
    cache_root.mkdir()  # the root exists but holds no Pass-1 result for SHA_A
    window = _make_window(cache_root=cache_root, video_path=video)
    manifest = _write(_manifest_doc([window], cache_root=cache_root), tmp_path)

    with pytest.raises(RescueAborted, match="artifact preflight FAILED") as excinfo:
        plan_rescue(manifest_path=manifest, completion_facts=FactProbe())
    assert "segments.json" in str(excinfo.value)


def test_a_missing_source_video_aborts(tmp_path: Path) -> None:
    cache_root = tmp_path / "ingest-cache"
    _seed_cache(cache_root, SHA_A)
    window = _make_window(cache_root=cache_root, video_path=tmp_path / "videos" / "gone.mkv")
    manifest = _write(_manifest_doc([window], cache_root=cache_root), tmp_path)

    with pytest.raises(RescueAborted, match="artifact preflight FAILED") as excinfo:
        plan_rescue(manifest_path=manifest, completion_facts=FactProbe())
    assert "gone.mkv" in str(excinfo.value)


# ─── (3) All-or-nothing failure ─────────────────────────────────────────────


def test_one_missing_artifact_aborts_the_whole_run_before_any_io(tmp_path: Path) -> None:
    """Not "skip the affected window" and not "fall back to decoding": the run
    stops before the database is read and before a subprocess exists."""
    cache_root = tmp_path / "ingest-cache"
    video = _seed_video(tmp_path)
    _seed_cache(cache_root, SHA_A, SHA_B)  # SHA_C missing

    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            sha=sha,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i, sha in enumerate((SHA_A, SHA_B, SHA_C))
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), tmp_path)
    allow = _write_allowlist(
        _allowlist_doc(*windows, manifest_sha256=_manifest_sha(manifest)), tmp_path
    )

    probe, recorder = FactProbe(), Recorder()
    with pytest.raises(RescueAborted) as excinfo:
        run_rescue(
            manifest_path=manifest,
            execute=True,
            completion_facts=probe,
            run_command=recorder,
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            allowlist_path=allow,
            repository_head=_repo_head(),
            out=lambda _: None,
        )

    message = str(excinfo.value)
    assert "all-or-nothing" in message
    assert SHA_C in message
    # The two healthy windows are NOT executed, and the DB is never touched.
    assert recorder.calls == []
    assert probe.calls == 0


def test_the_abort_message_counts_missing_against_the_whole_artifact_set(
    tmp_path: Path,
) -> None:
    cache_root = tmp_path / "ingest-cache"
    video = _seed_video(tmp_path)
    cache_root.mkdir()
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            sha=sha,
            segment_index=SEGMENT_INDEX_BASE + i,
        )
        for i, sha in enumerate((SHA_A, SHA_B))
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), tmp_path)

    with pytest.raises(RescueAborted) as excinfo:
        plan_rescue(manifest_path=manifest, completion_facts=FactProbe())
    # 2 cache entries missing out of 3 checks (2 caches + 1 shared video).
    assert "2 of 3" in str(excinfo.value)


def test_a_mid_run_failure_stops_and_reports_the_untouched_remainder(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(3)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "three.json")
    allow = _write_allowlist(
        _allowlist_doc(*windows, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    recorder = Recorder(fail_on="pnpm")
    report = execute_plan(
        plan,
        run_command=recorder,
        completion_facts=FactProbe(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
    )

    assert report.promoted == []
    assert len(report.failed) == 1
    assert report.failed[0].status == OUTCOME_FAILED
    assert len(report.not_attempted) == 2
    assert not report.ok
    # ffmpeg + the failing pnpm for window 1, then nothing.
    assert [c[0] for c in recorder.calls] == ["ffmpeg", "pnpm"]


# ─── (4) Decision filtering ─────────────────────────────────────────────────


def test_only_auto_windows_are_executable(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    auto = _make_window(cache_root=cache_root, video_path=video)
    review = _make_window(
        cache_root=cache_root,
        video_path=video,
        segment_index=SEGMENT_INDEX_BASE + 1,
        decision=DECISION_REVIEW,
        reason=R_SUMMARY_CATEGORY,
    )
    skip = _make_window(
        cache_root=cache_root,
        video_path=video,
        segment_index=SEGMENT_INDEX_BASE + 2,
        decision=DECISION_SKIP,
        reason=R_ALREADY_COVERED,
    )

    # Review and skip windows keep runnable-looking commands; that must not
    # make them executable.
    assert review.commands is not None and skip.commands is not None
    assert executable_windows([auto, review, skip]) == [auto]


def test_a_review_window_never_reaches_a_subprocess(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    auto = _make_window(cache_root=cache_root, video_path=video)
    review = _make_window(
        cache_root=cache_root,
        video_path=video,
        segment_index=SEGMENT_INDEX_BASE + 1,
        match_id=999,
        decision=DECISION_REVIEW,
        reason=R_SUMMARY_CATEGORY,
    )
    manifest = _write(_manifest_doc([auto, review], cache_root=cache_root), env["tmp"], "mix.json")
    allow = _write_allowlist(_allowlist_doc(auto, manifest_sha256=_manifest_sha(manifest)), env["tmp"])

    recorder = Recorder()
    run_rescue(
        manifest_path=manifest,
        execute=True,
        completion_facts=FactProbe.completing(auto),
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lambda _: None,
    )

    assert len(recorder.calls) == 2  # exactly one window: ffmpeg + ingest-ocr
    assert not any("999" in tok for call in recorder.calls for tok in call)


@pytest.mark.parametrize("decision", [DECISION_REVIEW, DECISION_SKIP])
def test_the_execution_guard_refuses_a_hand_built_non_auto_window(env, decision) -> None:
    """Defence in depth: `executable_windows` already filtered, so reaching the
    guard means a caller assembled a plan by hand."""
    window = _make_window(
        cache_root=env["cache_root"],
        video_path=env["video"],
        decision=decision,
        reason=R_SUMMARY_CATEGORY,
    )
    with pytest.raises(RescueAborted, match="refusing to execute"):
        assert_executable(window)


def test_a_manifest_with_zero_auto_windows_aborts_rather_than_reporting_success(
    env,
) -> None:
    """"Nothing to do" is the exact shape the cache-root reboot trap took, so it
    is never reported as a clean run."""
    review = _make_window(
        cache_root=env["cache_root"],
        video_path=env["video"],
        decision=DECISION_REVIEW,
        reason=R_SUMMARY_CATEGORY,
    )
    manifest = _write(
        _manifest_doc([review], cache_root=env["cache_root"]), env["tmp"], "noauto.json"
    )

    with pytest.raises(RescueAborted, match="no 'auto' windows"):
        plan_rescue(manifest_path=manifest, completion_facts=FactProbe())


# ─── (5) Explicit execution opt-in ──────────────────────────────────────────


def test_the_default_is_a_dry_run_that_executes_nothing(env) -> None:
    recorder, probe, made = Recorder(), FactProbe(), []
    lines: list[str] = []

    code = run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=probe,
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        make_batch_dir=made.append,
        out=lines.append,
    )

    assert code == 0
    assert recorder.calls == []
    assert made == []  # not even a directory is created
    assert DRY_RUN_BANNER in "\n".join(lines)


def test_the_dry_run_creates_no_batch_directory_on_disk(env) -> None:
    run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=FactProbe(),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        make_batch_dir=lambda p: p.mkdir(parents=True, exist_ok=True),
        out=lambda _: None,
    )
    assert not (env["cache_root"] / SHA_A / "rescue").exists()


def test_the_dry_run_writes_no_receipt(env) -> None:
    receipts: list[dict] = []
    run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=FactProbe(),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        receipt_sink=receipts.append,
        out=lambda _: None,
    )
    assert receipts == []


def test_the_explicit_opt_in_runs_the_pinned_argv_verbatim(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    recorder = Recorder()
    code = run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lambda _: None,
    )

    assert code == 0
    assert recorder.calls == [
        env["window"].commands["ffmpeg"],
        env["window"].commands["ingest_ocr"],
    ]


def test_the_opt_in_flag_name_is_the_one_the_banner_advertises() -> None:
    assert EXECUTE_FLAG == "--execute"
    assert EXECUTE_FLAG in DRY_RUN_BANNER


# ─── (5b) Execution-environment preflight ───────────────────────────────────
#
# Regression cover for rescue-b2-20260805T031634Z. That run passed every gate
# Stage B had — faithful manifest, artifacts present, window genuinely pending —
# created the batch dir, ran ffmpeg to completion, and only THEN discovered that
# `pnpm --filter worker ingest-ocr` could not start, because `DATABASE_URL` was
# unset in the shell Stage B inherited. It left a failed receipt behind.
#
# The pinned argv is not self-contained. `make_runner` passes no `env` to
# `subprocess.run`, so the child inherits Stage B's environment, and two
# variables in it decide whether the child can work:
#
#   * DATABASE_URL — packages/db/src/client.ts throws at import when unset, so
#     ingest-ocr dies before it connects. LOUD, and the demonstrated failure.
#   * OCR_PYTHON — apps/worker/src/ocr-cli-runner.ts:74 falls back to bare
#     `python3` SILENTLY. That is the dangerous one: the fallback imports fine
#     on the ingest box, and `runOcrCli` runs BEFORE the ocr_capture_batches
#     insert, so an unset OCR_PYTHON does not fail the run — it writes a whole
#     batch under the rescue decoder tag from an interpreter nobody chose, which
#     `completion_problems` would then bless and skip forever.
#
# Nothing else in .env is read anywhere on this path, so nothing else is
# required: over-requiring would make Stage B refuse runs it can complete.


def _execute_env(env, *, environ, **kwargs):
    """Drive the real execution path with an injected environment.

    ``--execute`` now requires an allowlist (that is the very rule most of
    section (5b) and the output-proving section below exist to hold constant
    while they exercise something else), so this always supplies one bound to
    ``env["window"]`` unless the caller overrides it.
    """
    kwargs.setdefault(
        "allowlist_path",
        _write_allowlist(
            _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])),
            env["tmp"],
            name="default-allowlist.json",
        ),
    )
    kwargs.setdefault("repository_head", _repo_head())
    return run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        environ=environ,
        out=lambda _: None,
        **kwargs,
    )


def test_a_missing_database_url_aborts_before_any_mutation(env) -> None:
    """The demonstrated defect: no batch dir, no ffmpeg, no receipt."""
    recorder, made, receipts = Recorder(), [], []

    with pytest.raises(RescueAborted) as excinfo:
        _execute_env(
            env,
            environ={"OCR_PYTHON": "/opt/venv/bin/python"},
            completion_facts=FactProbe.completing(env["window"]),
            run_command=recorder,
            make_batch_dir=made.append,
            receipt_sink=receipts.append,
        )

    assert "DATABASE_URL" in str(excinfo.value)
    assert made == []  # (1) not even a directory
    assert recorder.calls == []  # (2) no ffmpeg, no ingest-ocr
    assert receipts == []  # (3) no receipt


def test_a_missing_ocr_python_aborts_before_any_mutation(env) -> None:
    """The silent one. An unset OCR_PYTHON does not crash ingest-ocr — it makes
    it write the rescue batch from the wrong interpreter."""
    recorder, made, receipts = Recorder(), [], []

    with pytest.raises(RescueAborted) as excinfo:
        _execute_env(
            env,
            environ={"DATABASE_URL": "postgres://eanhl@localhost:5433/eanhl"},
            completion_facts=FactProbe.completing(env["window"]),
            run_command=recorder,
            make_batch_dir=made.append,
            receipt_sink=receipts.append,
        )

    assert "OCR_PYTHON" in str(excinfo.value)
    assert made == []
    assert recorder.calls == []
    assert receipts == []


@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n"])
@pytest.mark.parametrize("name", ["DATABASE_URL", "OCR_PYTHON"])
def test_a_present_but_empty_value_is_rejected(env, name, blank) -> None:
    """Set-but-blank is a misconfiguration, not a configuration. `packages/db`
    would take a whitespace URL as truthy and fail later, deeper and dirtier."""
    recorder, made, receipts = Recorder(), [], []
    environ = dict(VALID_ENVIRON, **{name: blank})

    with pytest.raises(RescueAborted) as excinfo:
        _execute_env(
            env,
            environ=environ,
            completion_facts=FactProbe.completing(env["window"]),
            run_command=recorder,
            make_batch_dir=made.append,
            receipt_sink=receipts.append,
        )

    message = str(excinfo.value)
    assert f"{name}: set but empty" in message
    assert made == [] and recorder.calls == [] and receipts == []


def test_a_valid_execution_environment_reaches_the_execution_path(env) -> None:
    """The gate must not become a new way to refuse a good run."""
    recorder, made, receipts = Recorder(), [], []

    code = _execute_env(
        env,
        environ=dict(VALID_ENVIRON),
        completion_facts=FactProbe.completing(env["window"]),
        run_command=recorder,
        make_batch_dir=made.append,
        receipt_sink=receipts.append,
    )

    assert code == 0
    assert recorder.calls == [
        env["window"].commands["ffmpeg"],
        env["window"].commands["ingest_ocr"],
    ]
    batch_dir = Path(env["window"].commands["batch_dir"])
    assert made == [batch_dir, batch_dir / STAGING_DIRNAME]
    assert len(receipts) == 1 and receipts[0]["status"] == OUTCOME_PROMOTED


def test_the_dry_run_is_permitted_with_no_execution_environment_at_all(env) -> None:
    """Requirement: a dry run still works without DATABASE_URL. It spawns
    nothing, so it needs nothing — and refusing it would take away the very
    command an operator runs to diagnose a broken environment."""
    recorder, made, receipts = Recorder(), [], []
    lines: list[str] = []

    code = run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=FactProbe(),
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        receipt_sink=receipts.append,
        make_batch_dir=made.append,
        environ={},
        out=lines.append,
    )

    assert code == 0
    assert DRY_RUN_BANNER in "\n".join(lines)
    assert recorder.calls == [] and made == [] and receipts == []


def test_the_diagnostic_names_the_missing_keys_but_never_a_value(env) -> None:
    """DATABASE_URL carries the database password. A message that names it must
    not also carry it — not for the missing key, and not for the present one."""
    secret = "postgres://eanhl:sup3r-s3cret-pw@localhost:5433/eanhl"

    with pytest.raises(RescueAborted) as excinfo:
        _execute_env(
            env,
            environ={"DATABASE_URL": secret},  # present; OCR_PYTHON is not
            completion_facts=FactProbe.completing(env["window"]),
            run_command=Recorder(),
        )

    message = str(excinfo.value)
    assert "OCR_PYTHON" in message  # the missing key is named ...
    assert secret not in message  # ... and no value is echoed
    assert "sup3r-s3cret-pw" not in message
    assert "localhost:5433" not in message


def test_only_the_two_justified_variables_are_required(env) -> None:
    """`.env` also holds EA_CLUB_ID, POSTGRES_PASSWORD, BETTER_AUTH_SECRET and
    the rest. None is read on the ingest-ocr path, so requiring them would be
    superstition that blocks runs Stage B can complete."""
    assert [name for name, _ in REQUIRED_EXECUTION_ENV] == ["DATABASE_URL", "OCR_PYTHON"]
    assert environment_problems(VALID_ENVIRON) == []

    code = _execute_env(
        env,
        environ=dict(VALID_ENVIRON),  # and nothing else whatsoever
        completion_facts=FactProbe.completing(env["window"]),
        run_command=Recorder(),
    )
    assert code == 0


def test_the_gate_defaults_to_the_real_process_environment(
    env, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`environ=None` must mean os.environ — the environment the child actually
    inherits. A gate that defaulted to "assume fine" would not have caught this."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    recorder, made = Recorder(), []

    with pytest.raises(RescueAborted) as excinfo:
        run_rescue(
            manifest_path=env["manifest"],
            execute=True,
            completion_facts=FactProbe.completing(env["window"]),
            run_command=recorder,
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            allowlist_path=allow,
            repository_head=_repo_head(),
            make_batch_dir=made.append,
            out=lambda _: None,
        )

    assert "DATABASE_URL" in str(excinfo.value)
    assert recorder.calls == [] and made == []


def test_the_gate_creates_no_rescue_directory_on_the_real_filesystem(env) -> None:
    """`make_batch_dir` recorded nothing above; here the real mkdir is wired in,
    so "before make_batch_dir" is checked against the disk, not against a list."""
    with pytest.raises(RescueAborted):
        _execute_env(
            env,
            environ={},
            completion_facts=FactProbe.completing(env["window"]),
            run_command=Recorder(),
            make_batch_dir=lambda p: p.mkdir(parents=True, exist_ok=True),
        )

    assert not (env["cache_root"] / SHA_A / "rescue").exists()


def test_the_gate_sits_on_execute_plan_itself_not_only_on_the_cli(env) -> None:
    """Placement matters: the guard is the first statement of the ONLY function
    that mutates anything, so no caller can route around it.

    Authorized here (a valid allowlist + repository HEAD) so this specifically
    re-proves the ENVIRONMENT gate's placement -- the newer allowlist-
    authorization gate in front of it is covered on its own in the "Mutation
    boundary" section below."""
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    recorder, made, receipts = Recorder(), [], []

    with pytest.raises(RescueAborted, match="DATABASE_URL"):
        execute_plan(
            plan,
            run_command=recorder,
            completion_facts=FactProbe.completing(env["window"]),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
            receipt_sink=receipts.append,
            make_batch_dir=made.append,
            environ={},
        )

    assert recorder.calls == [] and made == [] and receipts == []


def test_a_run_with_nothing_pending_does_not_require_the_environment(env) -> None:
    """No window will be executed, so no subprocess environment is needed. The
    gate is scoped to actual execution, not to the `--execute` flag."""
    code = _execute_env(
        env,
        environ={},
        completion_facts=FactProbe([_complete_fact(env["window"])]),
        run_command=Recorder(),
    )
    assert code == 0


def test_manifest_and_artifact_validation_are_unchanged_by_the_new_gate(
    tmp_path: Path,
) -> None:
    """The artifact preflight must still be what aborts a manifest whose video
    is gone — the environment gate runs later and must not displace it."""
    cache_root = tmp_path / "ingest-cache"
    _seed_cache(cache_root, SHA_A)
    window = _make_window(cache_root=cache_root, video_path=tmp_path / "gone.mkv")
    manifest = _write(_manifest_doc([window], cache_root=cache_root), tmp_path)
    allow = _write_allowlist(
        _allowlist_doc(window, manifest_sha256=_manifest_sha(manifest)), tmp_path
    )

    with pytest.raises(RescueAborted) as excinfo:
        run_rescue(
            manifest_path=manifest,
            execute=True,
            completion_facts=FactProbe(),
            run_command=Recorder(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            allowlist_path=allow,
            repository_head=_repo_head(),
            environ={},  # also unusable — but not what should be reported
            out=lambda _: None,
        )

    message = str(excinfo.value)
    assert "artifact preflight FAILED" in message
    assert "DATABASE_URL" not in message


# ─── (6) Idempotency ────────────────────────────────────────────────────────


def test_the_promotion_key_mirrors_the_capture_batch_unique_index(env) -> None:
    """`ocr_capture_batches_video_sha_dir_run_uniq` is (video_sha256,
    source_directory, run_id) -- the key must be that tuple, verbatim."""
    window = env["window"]
    assert promotion_key(window) == (
        window.video_sha256,
        window.commands["batch_dir"],
        window.run_id,
    )


def test_a_verified_complete_window_is_excluded_and_reported(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    probe = FactProbe([_complete_fact(env["window"])])
    recorder = Recorder()
    lines: list[str] = []

    code = run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=probe,
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lines.append,
    )

    assert code == 0
    assert recorder.calls == []  # not silently re-run
    output = "\n".join(lines)
    assert "verified complete  : 1" in output
    assert "NOTHING TO EXECUTE" in output


def test_rerunning_after_a_successful_run_promotes_nothing(env) -> None:
    """The second pass sees the first pass's VERIFIED output and has no work left."""
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    first = Recorder()
    run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=first,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lambda _: None,
    )
    assert len(first.calls) == 2

    # The database now holds the batch the first run created. SAME allowlist.
    second = Recorder()
    run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe([_complete_fact(env["window"])]),
        run_command=second,
        rescue_run_id="rescue-b2-20260803T130000Z",
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lambda _: None,
    )
    assert second.calls == []


def test_a_partial_run_resumes_only_the_windows_that_did_not_land(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(3)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "three.json")

    # First run: window 0 landed, then everything stopped.
    plan = plan_rescue(manifest_path=manifest, completion_facts=FactProbe())
    assert len(plan.pending) == 3

    resumed = plan_rescue(
        manifest_path=manifest, completion_facts=FactProbe([_complete_fact(windows[0])])
    )
    assert [w.segment_index for w in resumed.pending] == [
        SEGMENT_INDEX_BASE + 1,
        SEGMENT_INDEX_BASE + 2,
    ]
    assert [w.segment_index for w in resumed.verified_complete] == [SEGMENT_INDEX_BASE]


def test_two_windows_on_one_video_have_distinct_promotion_keys(env) -> None:
    """The batch dir carries the segment index, so same sha + same run does not
    collapse two windows into one key."""
    a = _make_window(cache_root=env["cache_root"], video_path=env["video"])
    b = _make_window(
        cache_root=env["cache_root"],
        video_path=env["video"],
        segment_index=SEGMENT_INDEX_BASE + 1,
    )
    assert promotion_key(a) != promotion_key(b)


# ─── (6b) Completion is VERIFIED, never inferred from the batch row ─────────
#
# `ingest-ocr` upserts ocr_capture_batches BEFORE it processes anything, then
# swallows per-result persistence failures AND segment-write failures, and
# exits 0 regardless. So the batch row proves only that the process started.
# Every test below pins one shape that used to be mistaken for success.


def test_a_capture_batch_with_no_segment_row_is_not_complete(env) -> None:
    """The exact defect: batch row present, segment write failed and was only
    warned about, exit 0. This must stay PENDING, not be skipped forever."""
    window = env["window"]
    facts = [_batch_only_fact(window)]

    problems = completion_problems(window, facts)
    assert problems
    assert any("NO ocr_segments row" in p for p in problems)

    plan = plan_rescue(manifest_path=env["manifest"], completion_facts=FactProbe(facts))
    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]
    assert plan.verified_complete == ()


def test_an_incomplete_batch_is_reported_as_a_re_run_not_silently_retried(env) -> None:
    """A window that started but did not finish is named in the plan, with the
    reason -- the old predicate skipped it silently."""
    lines: list[str] = []
    run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=FactProbe([_batch_only_fact(env["window"])]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        out=lines.append,
    )
    output = "\n".join(lines)
    assert "incomplete, RE-RUN : 1" in output
    assert "NO ocr_segments row" in output


@pytest.mark.parametrize(
    "override,needle",
    [
        ({"segment_key": "vsha-deadbeefdead:seg0007"}, "segment_key"),
        ({"state": "post_game_events"}, "state"),
        ({"segment_match_id": 999}, "match_id"),
        ({"segment_run_id": 9999}, "run_id"),
        ({"t_start_sec": "12.000"}, "t_start_sec"),
        ({"t_end_sec": "999.000"}, "t_end_sec"),
        ({"decoder_version": "hmm-viterbi-v2"}, "decoder_version"),
        ({"batch_match_id": 999}, "ocr_capture_batches.match_id"),
    ],
)
def test_a_wrong_segment_on_the_right_batch_is_not_complete(env, override, needle) -> None:
    """Every field the predicate joins on. A segment row that belongs to some
    OTHER window must not satisfy this one."""
    window = env["window"]
    facts = [_complete_fact(window, **override)]

    problems = completion_problems(window, facts)
    assert any(needle in p for p in problems), problems

    plan = plan_rescue(manifest_path=env["manifest"], completion_facts=FactProbe(facts))
    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]


@pytest.mark.parametrize(
    "override,needle",
    [
        # runOcrCli returned nothing: the segment is still written, with
        # frame_count 0 and observability_status='not_observable_from_source'.
        (
            {
                "frame_count": 0,
                "observability_status": "not_observable_from_source",
                "extraction_count": 0,
                "extraction_success_count": 0,
            },
            "frame_count",
        ),
        # A per-result persistence transaction rolled back: `failed++`, exit 0,
        # and one fewer ocr_extractions row than the segment claims frames.
        ({"extraction_count": 1}, "!= ocr_segments.frame_count"),
        # Every promoter threw: rows exist, all of them transform_status='error'.
        ({"extraction_success_count": 0}, "transform_status='success'"),
    ],
)
def test_a_segment_row_alone_does_not_prove_the_output_landed(env, override, needle) -> None:
    """An ocr_segments row is written after the results loop and gated on
    nothing -- not on `succeeded`, not on `failed`. So it cannot speak for the
    extractions, and the predicate checks them separately."""
    window = env["window"]
    problems = completion_problems(window, [_complete_fact(window, **override)])
    assert any(needle in p for p in problems), problems


def test_surplus_extraction_rows_fail_closed(env) -> None:
    """The count comparison is EXACT, not a lower bound.

    A surplus means the batch dir also holds rows from an earlier, wider
    extraction. Those rows carry the OLDER run's transform_status, so tolerating
    the surplus lets stale success stand in for this window's own frames. Stage
    B refuses: a surplus is operator-repair state, not something to absorb.
    """
    window = env["window"]
    problems = completion_problems(window, [_complete_fact(window, extraction_count=5)])
    assert any("!= ocr_segments.frame_count" in p for p in problems), problems
    assert any("surplus" in p for p in problems), problems


def test_a_surplus_of_successful_rows_does_not_authorise_completion(env) -> None:
    """The precise defect the strict predicate closes: every extraction row in
    the batch is transform_status='success', so `extraction_success_count >= 1`
    passes — but the successes belong to a superseded wider extraction, and this
    window's own frames may be entirely absent. The count mismatch is the only
    thing that catches it, so it must reject rather than promote."""
    window = env["window"]
    stale_success = _complete_fact(window, extraction_count=9, extraction_success_count=9)

    assert completion_problems(window, [stale_success]) != []

    # ... and the window therefore stays pending rather than being skipped.
    plan = plan_rescue(
        manifest_path=env["manifest"], completion_facts=FactProbe([stale_success])
    )
    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]
    assert plan.verified_complete == ()
    assert len(plan.retrying) == 1


def test_completion_requires_a_successful_extraction_even_when_counts_match(env) -> None:
    """`extraction_success_count >= 1` is retained alongside the strict count
    equality: matching counts with every promoter failed is still not done."""
    window = env["window"]
    problems = completion_problems(
        window, [_complete_fact(window, extraction_count=2, extraction_success_count=0)]
    )
    assert any("transform_status='success'" in p for p in problems), problems


def test_the_exact_expected_output_is_skipped_as_complete(env) -> None:
    """The positive case: a fully successful ingest verifies clean and is not
    re-run."""
    window = env["window"]
    assert completion_problems(window, [_complete_fact(window)]) == []
    allow = _write_allowlist(
        _allowlist_doc(window, manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )

    recorder = Recorder()
    code = run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe([_complete_fact(window)]),
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lambda _: None,
    )
    assert code == 0
    assert recorder.calls == []


def test_the_segment_key_matches_what_ingest_ocr_builds(env) -> None:
    """`vsha-<sha[:12]>:seg<index padded to 4>` -- mirrored from
    writeSegmentForBatch in apps/worker/src/ingest-ocr.ts."""
    assert expected_segment_key(env["window"]) == f"vsha-{'a' * 12}:seg9000"


def test_a_sibling_batch_row_cannot_satisfy_another_window(env) -> None:
    """Facts are matched on the promotion key first, so another window's
    completed output never counts as this one's."""
    other = _make_window(
        cache_root=env["cache_root"],
        video_path=env["video"],
        segment_index=SEGMENT_INDEX_BASE + 1,
    )
    problems = completion_problems(env["window"], [_complete_fact(other)])
    assert any("no ocr_capture_batches row" in p for p in problems)


# ─── (6c) The post-execution postcondition ──────────────────────────────────


def test_exit_zero_without_the_output_fails_the_window_and_stops_the_run(env) -> None:
    """The headline guarantee: both commands exit 0, the database does not hold
    the output, so the window FAILS, writes no success receipt, and the windows
    after it are never attempted."""
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(3)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "three.json")
    allow = _write_allowlist(
        _allowlist_doc(*windows, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    receipts: list[dict] = []
    recorder = Recorder()  # every command "succeeds"
    # ... but the ingest left only the batch row behind.
    probe = FactProbe([], after=[_batch_only_fact(windows[0])])

    code = run_rescue(
        manifest_path=manifest,
        execute=True,
        completion_facts=probe,
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )

    assert code == 1
    # Window 0 ran both steps and both returned 0 ...
    assert [c[0] for c in recorder.calls] == ["ffmpeg", "pnpm"]
    # ... and is still a failure, on the postcondition alone.
    assert len(receipts) == 1
    assert receipts[0]["status"] == OUTCOME_FAILED
    assert receipts[0]["completion_verified"] is False
    assert any("NO ocr_segments row" in p for p in receipts[0]["completion_problems"])
    assert not any(r["status"] == OUTCOME_PROMOTED for r in receipts)


def test_a_failed_postcondition_leaves_the_later_windows_untouched(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(3)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "three.json")
    allow = _write_allowlist(
        _allowlist_doc(*windows, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    report = execute_plan(
        plan,
        run_command=Recorder(),
        completion_facts=FactProbe(),  # the database never gains anything
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
    )

    assert report.promoted == []
    assert len(report.failed) == 1
    assert report.failed[0].status == OUTCOME_FAILED
    assert "postcondition unsatisfied" in (report.failed[0].error or "")
    assert len(report.not_attempted) == 2
    assert not report.ok


def test_a_satisfied_postcondition_promotes_and_continues(env) -> None:
    """The positive counterpart: verification passes, the receipt records the
    verified promotion, and the run moves on to the next window."""
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(2)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "two.json")
    allow = _write_allowlist(
        _allowlist_doc(*windows, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    receipts: list[dict] = []
    recorder = Recorder()
    code = run_rescue(
        manifest_path=manifest,
        execute=True,
        completion_facts=FactProbe.completing(*windows),
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )

    assert code == 0
    assert [r["status"] for r in receipts] == [OUTCOME_PROMOTED, OUTCOME_PROMOTED]
    assert all(r["completion_verified"] is True for r in receipts)
    assert all(r["completion_problems"] == [] for r in receipts)
    # Both windows ran to completion: 2 windows x (ffmpeg + ingest-ocr).
    assert [c[0] for c in recorder.calls] == ["ffmpeg", "pnpm", "ffmpeg", "pnpm"]


def test_the_postcondition_is_checked_before_the_receipt_is_written(env) -> None:
    """Ordering matters: a receipt must never assert a promotion that was not
    verified first."""
    receipts: list[dict] = []
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    execute_plan(
        plan,
        run_command=Recorder(),
        completion_facts=FactProbe(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
    )
    assert len(receipts) == 1
    assert receipts[0]["status"] == OUTCOME_FAILED
    assert receipts[0]["completion_verified"] is False


def test_the_plan_and_the_postcondition_use_the_same_predicate(env) -> None:
    """A window verified complete post-execution is exactly a window the next
    plan skips -- otherwise a run could promote something a rerun re-runs."""
    window = env["window"]
    fact = _complete_fact(window)
    allow = _write_allowlist(
        _allowlist_doc(window, manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )

    probe = FactProbe([], after=[fact])
    code = run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=probe,
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lambda _: None,
    )
    assert code == 0

    # Same facts, fresh plan: nothing left to do.
    replan = plan_rescue(manifest_path=env["manifest"], completion_facts=FactProbe([fact]))
    assert replan.pending == ()
    assert len(replan.verified_complete) == 1


def test_a_step_failure_skips_verification_and_reports_the_step(env) -> None:
    """When ffmpeg already failed, the postcondition adds nothing -- the error
    must name the real cause."""
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    probe = FactProbe()
    report = execute_plan(
        plan,
        run_command=Recorder(fail_on="ffmpeg"),
        completion_facts=probe,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
    )
    assert probe.calls == 0  # never asked
    assert "ffmpeg exited 1" in (report.failed[0].error or "")


def test_the_dry_run_never_verifies_because_it_never_executes(env) -> None:
    """The plan-time read happens exactly once; no postcondition probe follows,
    because no command ran."""
    probe = FactProbe()
    run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=probe,
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        out=lambda _: None,
    )
    assert probe.calls == 1


def test_the_report_does_not_claim_the_run_was_atomic(env) -> None:
    """Guarantee accuracy: preflight is all-or-nothing, execution is not."""
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(2)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "two.json")
    allow = _write_allowlist(
        _allowlist_doc(*windows, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    lines: list[str] = []
    # Window 0 lands; window 1 exits 0 with nothing to show for it.
    run_rescue(
        manifest_path=manifest,
        execute=True,
        completion_facts=FactProbe([], after=[_complete_fact(windows[0])]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lines.append,
    )
    output = "\n".join(lines)
    assert "promoted      : 1" in output
    assert "fail-fast, NOT all-or-nothing" in output
    assert "all-or-nothing" in output  # the preflight line still says so


# ─── Provenance ─────────────────────────────────────────────────────────────


def test_the_receipt_carries_every_rollback_handle(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    receipts: list[dict] = []
    run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )

    assert len(receipts) == 1
    receipt = receipts[0]
    assert receipt["schema_version"] == SCHEMA_VERSION
    assert receipt["decoder_version"] == RESCUE_DECODER_VERSION
    assert receipt["rescue_run_id"] == RUN_ID
    assert receipt["run_id"] == env["window"].run_id
    assert receipt["match_id"] == env["window"].match_id
    assert RESCUE_DIR_MARKER in receipt["batch_dir"]
    assert receipt["promotion_key"] == list(promotion_key(env["window"]))
    assert receipt["status"] == OUTCOME_PROMOTED
    assert [s["step"] for s in receipt["steps"]] == [STEP_FFMPEG, STEP_INGEST_OCR]


def test_the_receipt_pins_the_manifest_digest(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    receipts: list[dict] = []
    run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )
    assert receipts[0]["manifest_sha256"] == hashlib.sha256(
        env["manifest"].read_bytes()
    ).hexdigest()


def test_the_receipt_records_the_schema_that_actually_authorised_it(env) -> None:
    """Not the executor's own constant: the manifest's. A receipt is provenance,
    and provenance that reports a version it did not read is a fabrication.
    Historical schema-2 receipts stay in the ledger untouched and stay valid;
    what a NEW receipt must never do is claim a schema the run did not consume.
    """
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    receipts: list[dict] = []
    run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )
    doc = load_manifest(env["manifest"])
    assert receipts[0]["schema_version"] == doc["schema_version"] == SCHEMA_VERSION


# ─── Proving which files THIS ffmpeg invocation produced ────────────────────
#
# The defect this section exists for: the executor used to count the PNGs in the
# batch directory after ffmpeg returned. A batch directory already holding a
# complete stale set keeps its count when the current command writes NOTHING, so
# the gate passed and ingest-ocr consumed frames the current command never made.
#
# The replacement is a transaction — staging proven empty, then proven to hold
# exactly the expected set, then published — so every fixture below can seed a
# complete stale set in the batch directory and the proof still holds.


def _seed_stale_batch(window: Window, count: int = 3) -> Path:
    """A COMPLETE, correctly-named, plausible set of outputs from an EARLIER run.

    Same filenames the current selection expects, same count, already on disk.
    This is precisely the state that counterfeited success before.
    """
    batch_dir = Path(window.commands["batch_dir"])
    batch_dir.mkdir(parents=True, exist_ok=True)
    for name in expected_output_names(count):
        (batch_dir / name).write_bytes(b"\x89PNG\r\n\x1a\nSTALE")
    return batch_dir


def _run_window(env, recorder, receipts) -> int:
    return _execute_env(
        env,
        environ=VALID_ENVIRON,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=recorder,
        make_batch_dir=lambda p: p.mkdir(parents=True, exist_ok=True),
        receipt_sink=receipts.append,
    )


def test_a_complete_stale_set_cannot_stand_in_for_a_zero_frame_ffmpeg(env) -> None:
    """THE regression. Three stale files, a selection expecting three, and an
    ffmpeg that writes nothing. The old count-based gate passed this."""
    stale = _seed_stale_batch(env["window"])
    recorder, receipts = Recorder(frames=0), []

    code = _run_window(env, recorder, receipts)

    assert code == 1
    assert receipts[0]["status"] == OUTCOME_FAILED
    assert [c[0] for c in recorder.calls] == ["ffmpeg"]  # never reached ingest-ocr
    assert receipts[0]["steps"][0]["staged_output_names"] == []
    assert "not the 3 its pinned selection names" in receipts[0]["error"]
    assert "Staging was verified empty" in receipts[0]["error"]
    # The database was never consulted for this window's postcondition, so the
    # reason has to live on the receipt itself.
    assert receipts[0]["completion_problems"] == []
    # The stale files are still there, untouched: this executor never deletes.
    assert sorted(p.name for p in stale.iterdir() if p.is_file()) == list(
        expected_output_names(3)
    )
    assert (stale / "00001.png").read_bytes().endswith(b"STALE")


def test_a_complete_stale_set_cannot_stand_in_for_a_partial_ffmpeg(env) -> None:
    """Same shape, one frame short. The count would have read 3 either way."""
    _seed_stale_batch(env["window"])
    recorder, receipts = Recorder(frames=1), []

    code = _run_window(env, recorder, receipts)

    assert code == 1
    assert [c[0] for c in recorder.calls] == ["ffmpeg"]
    step = receipts[0]["steps"][0]
    assert step["returncode"] == 0  # ffmpeg claimed success
    assert step["expected_frames"] == 3
    assert step["staged_output_names"] == ["00001.png"]
    assert "missing" in (receipts[0]["error"] or "")


def test_the_exact_current_output_set_proceeds(env) -> None:
    recorder, receipts = Recorder(), []
    code = _run_window(env, recorder, receipts)

    assert code == 0
    assert receipts[0]["status"] == OUTCOME_PROMOTED
    step = receipts[0]["steps"][0]
    assert step["staged_output_names"] == list(expected_output_names(3))
    assert step["published_output_names"] == list(expected_output_names(3))
    assert [c[0] for c in recorder.calls] == ["ffmpeg", "pnpm"]

    # Published: the batch dir ingest-ocr reads holds exactly the expected set,
    # and staging is empty again.
    batch_dir = Path(env["window"].commands["batch_dir"])
    assert sorted(p.name for p in batch_dir.iterdir() if p.is_file()) == list(
        expected_output_names(3)
    )
    assert list(Path(rescue_staging_dir(str(batch_dir))).iterdir()) == []


def test_a_surplus_output_fails_the_window(env) -> None:
    """An extra file is a frame the pinned selection does not name; ingest-ocr
    would OCR it as if the manifest had authorised it."""

    class Surplus(Recorder):
        def _write_frames(self, argv):
            super()._write_frames(argv)
            Path(argv[-1]).parent.joinpath("00004.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    recorder, receipts = Surplus(), []
    code = _run_window(env, recorder, receipts)

    assert code == 1
    assert [c[0] for c in recorder.calls] == ["ffmpeg"]
    assert receipts[0]["steps"][0]["staged_output_names"] == [
        *expected_output_names(3),
        "00004.png",
    ]
    assert "surplus" in (receipts[0]["error"] or "")


def test_a_misnamed_output_fails_the_window(env) -> None:
    """Right count, wrong names: not what `%05d.png` produces, so not this
    invocation's authorised output."""

    class Misnamed(Recorder):
        def _write_frames(self, argv):
            out = Path(argv[-1]).parent
            out.mkdir(parents=True, exist_ok=True)
            for i in range(3):
                (out / f"frame{i}.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    receipts: list = []
    assert _run_window(env, Misnamed(), receipts) == 1
    assert "surplus" in (receipts[0]["error"] or "")


def test_residue_in_staging_refuses_the_window_before_ffmpeg_runs(env) -> None:
    """A non-empty staging directory means an earlier run was interrupted. The
    executor cannot tell that residue from its own output, and it does not delete
    rescue artefacts — so it stops and says so."""
    staging = Path(rescue_staging_dir(env["window"].commands["batch_dir"]))
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "00001.png").write_bytes(b"\x89PNG\r\n\x1a\nRESIDUE")

    recorder, receipts = Recorder(), []
    code = _run_window(env, recorder, receipts)

    assert code == 1
    assert recorder.calls == []  # ffmpeg never ran
    assert "not empty before ffmpeg runs" in (receipts[0]["error"] or "")
    assert (staging / "00001.png").read_bytes().endswith(b"RESIDUE")


def test_a_foreign_file_in_the_batch_dir_refuses_the_publish(env) -> None:
    """Publishing over it would hand ingest-ocr a mixed batch."""
    batch_dir = Path(env["window"].commands["batch_dir"])
    batch_dir.mkdir(parents=True, exist_ok=True)
    (batch_dir / "00009.png").write_bytes(b"\x89PNG\r\n\x1a\nFOREIGN")

    recorder, receipts = Recorder(), []
    code = _run_window(env, recorder, receipts)

    assert code == 1
    assert [c[0] for c in recorder.calls] == ["ffmpeg"]  # never reached ingest-ocr
    assert "did not produce" in (receipts[0]["error"] or "")


def test_a_retry_publishes_over_its_own_previous_output(env) -> None:
    """The one incomplete window in the live plan must stay re-runnable without
    anybody deleting anything: the stale files carry the SAME names this run is
    about to publish, and they are replaced by frames just proven to be this
    invocation's."""
    stale = _seed_stale_batch(env["window"])
    recorder, receipts = Recorder(), []

    code = _run_window(env, recorder, receipts)

    assert code == 0
    assert receipts[0]["status"] == OUTCOME_PROMOTED
    assert not (stale / "00001.png").read_bytes().endswith(b"STALE")


def test_the_proof_never_consults_mtimes_or_content(env) -> None:
    """Stated as a property: the stale files are byte-identical to what a fresh
    run writes and can be given any timestamp; the verdict is unchanged, because
    it rests only on staging having been empty."""
    batch_dir = Path(env["window"].commands["batch_dir"])
    batch_dir.mkdir(parents=True, exist_ok=True)
    for name in expected_output_names(3):
        (batch_dir / name).write_bytes(b"\x89PNG\r\n\x1a\n")  # identical bytes
        os.utime(batch_dir / name, (2**31 - 1, 2**31 - 1))  # far-future mtime

    receipts: list = []
    assert _run_window(env, Recorder(frames=0), receipts) == 1


def test_the_receipt_records_the_exact_set_that_was_proven(env) -> None:
    receipts: list = []
    _run_window(env, Recorder(), receipts)
    step = receipts[0]["steps"][0]
    assert step["expected_output_names"] == list(expected_output_names(3))
    assert step["staged_output_names"] == step["expected_output_names"]
    assert step["output_frames"] == 3


# ─── The proof functions, directly ──────────────────────────────────────────


def test_prove_current_outputs_is_set_equality_not_a_count() -> None:
    expected = expected_output_names(3)
    listing = {"ok": expected, "short": expected[:2], "swapped": ("00001.png", "00002.png", "00009.png")}
    assert prove_current_outputs(
        Path("/s"), expected=expected, list_files=lambda _: listing["ok"]
    ).ok
    for case in ("short", "swapped"):
        proof = prove_current_outputs(
            Path("/s"), expected=expected, list_files=lambda _, c=case: listing[c]
        )
        assert not proof.ok and proof.error


@pytest.mark.parametrize("count", [0, None])
def test_an_unprovable_frame_count_refuses_before_ffmpeg(env, count) -> None:
    """Zero is the one value that would make the produced-set proof vacuously
    true against an empty staging directory.

    Driven through ``execute_plan`` directly and deliberately: ``sampling_problems``
    recomputes the count from the window's own evidence, so a manifest carrying
    this could never load. That is the point — this is the second line, checked
    at the mutation boundary rather than at the door.
    """
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    plan.pending[0].commands["sampling"]["expected_frame_count"] = count
    recorder, receipts = Recorder(), []

    report = execute_plan(
        plan,
        run_command=recorder,
        completion_facts=FactProbe.completing(env["window"]),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        environ=VALID_ENVIRON,
        make_batch_dir=lambda p: p.mkdir(parents=True, exist_ok=True),
    )

    assert not report.ok
    assert recorder.calls == []
    assert "cannot be proven" in receipts[0]["error"]


def test_a_missing_staging_directory_is_empty_not_an_error(tmp_path: Path) -> None:
    assert list_output_files(tmp_path / "nope") == ()
    assert prove_staging_empty(tmp_path / "nope", list_files=list_output_files).ok


def test_list_output_files_ignores_subdirectories(tmp_path: Path) -> None:
    """The staging directory lives inside the batch directory and is not an
    output; if it were counted, every batch would look surplus."""
    (tmp_path / STAGING_DIRNAME).mkdir()
    (tmp_path / "00001.png").write_bytes(b"")
    assert list_output_files(tmp_path) == ("00001.png",)


def test_step_fingerprints_are_stable_and_argv_sensitive() -> None:
    argv = ["ffmpeg", "-ss", "1.000"]
    assert argv_fingerprint(argv) == argv_fingerprint(list(argv))
    assert argv_fingerprint(argv) != argv_fingerprint(["ffmpeg", "-ss", "1.001"])


def test_a_failed_window_still_writes_a_receipt(env) -> None:
    receipts: list[dict] = []
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    execute_plan(
        plan,
        run_command=Recorder(fail_on="ffmpeg"),
        completion_facts=FactProbe(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
    )

    assert len(receipts) == 1
    assert receipts[0]["status"] == OUTCOME_FAILED
    assert [s["step"] for s in receipts[0]["steps"]] == [STEP_FFMPEG]


def test_a_failing_run_exits_non_zero(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    code = run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe(),
        run_command=Recorder(fail_on="ffmpeg"),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lambda _: None,
    )
    assert code == 1


# ─── (9) Clean CLI errors, not tracebacks ───────────────────────────────────

_TOOL_ROOT = Path(__file__).resolve().parents[1]
_SCRIPT = _TOOL_ROOT / "scripts" / "execute_rescue_manifest.py"


def test_the_script_renders_a_rejection_as_a_clean_exit_not_a_traceback(
    tmp_path: Path,
) -> None:
    """End-to-end at the CLI edge. The manifest is invalid, so the run aborts
    long before the database probe -- this never reaches Docker."""
    bad = tmp_path / "rescue-manifest.json"
    bad.write_text("{not json")

    proc = subprocess.run(
        [sys.executable, str(_SCRIPT), "--manifest", str(bad)],
        capture_output=True,
        text=True,
        cwd=str(_TOOL_ROOT),
        env={
            "PATH": "/usr/bin:/bin",
            "PYTHONPATH": f"{_TOOL_ROOT}:{_TOOL_ROOT.parent / 'game_ocr'}",
        },
    )

    assert proc.returncode == 1
    assert "Traceback" not in proc.stderr
    assert "not valid JSON" in proc.stderr


def test_the_script_requires_the_manifest_argument() -> None:
    proc = subprocess.run(
        [sys.executable, str(_SCRIPT)],
        capture_output=True,
        text=True,
        cwd=str(_TOOL_ROOT),
        env={
            "PATH": "/usr/bin:/bin",
            "PYTHONPATH": f"{_TOOL_ROOT}:{_TOOL_ROOT.parent / 'game_ocr'}",
        },
    )

    assert proc.returncode == 2
    assert "Traceback" not in proc.stderr
    assert "--manifest" in proc.stderr


# ─── (10) Execution allowlist ────────────────────────────────────────────────
#
# The allowlist is an ADDITIONAL gate in front of the auto set, not a
# replacement for anything above: manifest validation, artifact preflight,
# environment validation, the database completion probe and per-window
# postcondition verification all still run exactly as before. These tests
# cover the wiring -- selection, ordering, resumability, receipts, the CLI
# safety rules and the TOCTOU guarantee. Schema-level and per-field rejection
# of a malformed or non-matching allowlist is covered exhaustively in
# `test_rescue_allowlist.py`; nothing here re-tests that ground.
#
# (`REPO_HEAD`, `_repo_head`, `_manifest_sha`, `_allowlist_doc` and
# `_write_allowlist` live up near the other shared fixture builders -- section
# (5b) onward now needs a valid allowlist to reach `execute=True` at all, since
# that is exactly the new rule under test.)


# ─── Dry run without an allowlist is unaffected ────────────────────────────


def test_a_dry_run_with_no_allowlist_keeps_the_existing_full_manifest_behaviour(env) -> None:
    probe = FactProbe()
    plan = plan_rescue(manifest_path=env["manifest"], completion_facts=probe)

    assert plan.allowlist is None
    assert plan.excluded_by_allowlist == ()
    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]


# ─── Selection ──────────────────────────────────────────────────────────────


def test_a_valid_allowlist_selects_exactly_its_windows_and_reports_the_rest_excluded(
    env,
) -> None:
    cache_root, video = env["cache_root"], env["video"]
    selected = env["window"]
    other = _make_window(
        cache_root=cache_root,
        video_path=video,
        segment_index=SEGMENT_INDEX_BASE + 1,
        match_id=473,
    )
    manifest = _write(_manifest_doc([selected, other], cache_root=cache_root), env["tmp"], "two.json")
    allow = _write_allowlist(
        _allowlist_doc(selected, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    plan = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    assert plan.manifest_auto_total == 2
    assert len(plan.allowlist.entries) == 1
    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]
    assert [w.segment_index for w in plan.excluded_by_allowlist] == [SEGMENT_INDEX_BASE + 1]


def test_artifact_preflight_is_scoped_to_the_selected_set_when_an_allowlist_is_given(
    tmp_path: Path,
) -> None:
    """An excluded auto window's missing video must not abort a run that never
    intends to touch it."""
    cache_root = tmp_path / "ingest-cache"
    video = _seed_video(tmp_path)
    _seed_cache(cache_root, SHA_A, SHA_B)
    selected = _make_window(cache_root=cache_root, video_path=video, sha=SHA_A)
    excluded = _make_window(
        cache_root=cache_root,
        video_path=tmp_path / "videos" / "gone.mkv",  # missing on purpose
        sha=SHA_B,
        segment_index=SEGMENT_INDEX_BASE + 1,
        match_id=999,
    )
    manifest = _write(_manifest_doc([selected, excluded], cache_root=cache_root), tmp_path)
    allow = _write_allowlist(
        _allowlist_doc(selected, manifest_sha256=_manifest_sha(manifest)), tmp_path
    )

    plan = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]
    assert [w.segment_index for w in plan.excluded_by_allowlist] == [SEGMENT_INDEX_BASE + 1]


def test_selected_windows_preserve_manifest_order_regardless_of_allowlist_json_order(
    env,
) -> None:
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(3)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "three.json")
    # Reversed, and window 1 omitted entirely.
    allow = _write_allowlist(
        _allowlist_doc(windows[2], windows[0], manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    plan = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    assert [w.segment_index for w in plan.pending] == [
        SEGMENT_INDEX_BASE,
        SEGMENT_INDEX_BASE + 2,
    ]


def test_plan_counts_distinguish_selected_excluded_complete_retry_and_pending(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(4)
    ]
    # 0: selected & already verified complete. 1: selected & incomplete
    # (retrying). 2: selected & untouched (fresh pending). 3: excluded.
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "four.json")
    allow = _write_allowlist(
        _allowlist_doc(windows[0], windows[1], windows[2], manifest_sha256=_manifest_sha(manifest)),
        env["tmp"],
    )

    facts = [_complete_fact(windows[0]), _batch_only_fact(windows[1])]
    plan = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(facts),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    assert plan.manifest_auto_total == 4
    assert len(plan.allowlist.entries) == 3
    assert [w.segment_index for w in plan.excluded_by_allowlist] == [SEGMENT_INDEX_BASE + 3]
    assert [w.segment_index for w in plan.verified_complete] == [SEGMENT_INDEX_BASE]
    assert len(plan.retrying) == 1
    assert plan.retrying[0].window.segment_index == SEGMENT_INDEX_BASE + 1
    assert sorted(w.segment_index for w in plan.pending) == [
        SEGMENT_INDEX_BASE + 1,
        SEGMENT_INDEX_BASE + 2,
    ]


# ─── Binding rejections fail before the database is read ──────────────────


def test_a_manifest_sha_mismatch_allowlist_is_rejected_before_the_database_is_read(env) -> None:
    allow = _write_allowlist(_allowlist_doc(env["window"], manifest_sha256="0" * 64), env["tmp"])
    probe = FactProbe()

    with pytest.raises(RescueAborted, match="manifest_sha256"):
        plan_rescue(
            manifest_path=env["manifest"],
            completion_facts=probe,
            allowlist_path=allow,
            repository_head=_repo_head(),
        )
    assert probe.calls == 0


def test_a_repository_head_mismatch_allowlist_is_rejected_before_the_database_is_read(
    env,
) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    probe = FactProbe()

    with pytest.raises(RescueAborted, match="repository_head"):
        plan_rescue(
            manifest_path=env["manifest"],
            completion_facts=probe,
            allowlist_path=allow,
            repository_head=_repo_head(OTHER_REPO_HEAD),
        )
    assert probe.calls == 0


def test_a_proposal_only_allowlist_is_rejected_and_never_probes_completion(env) -> None:
    doc = _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"]))
    doc["proposal_only"] = True
    allow = _write_allowlist(doc, env["tmp"])
    probe = FactProbe()

    with pytest.raises(RescueAborted, match="proposal_only"):
        plan_rescue(
            manifest_path=env["manifest"],
            completion_facts=probe,
            allowlist_path=allow,
            repository_head=_repo_head(),
        )
    assert probe.calls == 0


def test_a_git_provenance_failure_aborts_before_the_database_is_read(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    probe = FactProbe()

    def _boom() -> str:
        raise RescueAborted("git provenance unavailable: not a git repository")

    with pytest.raises(RescueAborted, match="git provenance"):
        plan_rescue(
            manifest_path=env["manifest"],
            completion_facts=probe,
            allowlist_path=allow,
            repository_head=_boom,
        )
    assert probe.calls == 0


# ─── Resumability ───────────────────────────────────────────────────────────


def test_a_selected_verified_complete_window_is_skipped_not_an_error(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )

    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe([_complete_fact(env["window"])]),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    assert plan.pending == ()
    assert [w.segment_index for w in plan.verified_complete] == [SEGMENT_INDEX_BASE]


def test_a_selected_incomplete_window_is_retried(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )

    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe([_batch_only_fact(env["window"])]),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]
    assert len(plan.retrying) == 1


def test_an_immutable_allowlist_resumes_after_partial_completion_without_editing(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    windows = [
        _make_window(
            cache_root=cache_root,
            video_path=video,
            segment_index=SEGMENT_INDEX_BASE + i,
            match_id=470 + i,
        )
        for i in range(2)
    ]
    manifest = _write(_manifest_doc(windows, cache_root=cache_root), env["tmp"], "two.json")
    allow = _write_allowlist(
        _allowlist_doc(*windows, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    first = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    assert [w.segment_index for w in first.pending] == [
        SEGMENT_INDEX_BASE,
        SEGMENT_INDEX_BASE + 1,
    ]

    # SAME allowlist file, byte for byte -- only the database changed.
    second = plan_rescue(
        manifest_path=manifest,
        completion_facts=FactProbe([_complete_fact(windows[0])]),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    assert [w.segment_index for w in second.pending] == [SEGMENT_INDEX_BASE + 1]
    assert [w.segment_index for w in second.verified_complete] == [SEGMENT_INDEX_BASE]


# ─── CLI safety rules ───────────────────────────────────────────────────────


def test_execute_without_an_allowlist_fails_closed(env) -> None:
    recorder, made, receipts = Recorder(), [], []

    with pytest.raises(RescueAborted, match="--allowlist"):
        run_rescue(
            manifest_path=env["manifest"],
            execute=True,
            completion_facts=FactProbe(),
            run_command=recorder,
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            make_batch_dir=made.append,
            receipt_sink=receipts.append,
            out=lambda _: None,
        )

    assert recorder.calls == [] and made == [] and receipts == []


def test_dry_run_without_an_allowlist_is_unaffected_by_the_new_guard(env) -> None:
    code = run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=FactProbe(),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        out=lambda _: None,
    )
    assert code == 0


def test_execute_with_an_invalid_allowlist_fails_before_the_environment_gate(env) -> None:
    """The primary validation error (a mismatched manifest binding) must not be
    obscured by a secondary DATABASE_URL/OCR_PYTHON complaint."""
    allow = _write_allowlist(_allowlist_doc(env["window"], manifest_sha256="0" * 64), env["tmp"])
    recorder, made, receipts = Recorder(), [], []

    with pytest.raises(RescueAborted) as excinfo:
        run_rescue(
            manifest_path=env["manifest"],
            execute=True,
            completion_facts=FactProbe.completing(env["window"]),
            run_command=recorder,
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            allowlist_path=allow,
            repository_head=_repo_head(),
            environ={},  # would ALSO fail the environment gate
            make_batch_dir=made.append,
            receipt_sink=receipts.append,
            out=lambda _: None,
        )

    message = str(excinfo.value)
    assert "manifest_sha256" in message
    assert "DATABASE_URL" not in message
    assert recorder.calls == [] and made == [] and receipts == []


def test_dry_run_with_an_allowlist_invokes_no_mutating_runner(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    recorder, made, receipts = Recorder(), [], []

    code = run_rescue(
        manifest_path=env["manifest"],
        execute=False,
        completion_facts=FactProbe(),
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        make_batch_dir=made.append,
        receipt_sink=receipts.append,
        out=lambda _: None,
    )

    assert code == 0
    assert recorder.calls == [] and made == [] and receipts == []


def test_only_selected_pending_windows_reach_the_runner_and_receipt_sink(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    selected = env["window"]
    excluded = _make_window(
        cache_root=cache_root,
        video_path=video,
        segment_index=SEGMENT_INDEX_BASE + 1,
        match_id=999,
    )
    manifest = _write(_manifest_doc([selected, excluded], cache_root=cache_root), env["tmp"], "two.json")
    allow = _write_allowlist(
        _allowlist_doc(selected, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    recorder, receipts = Recorder(), []
    code = run_rescue(
        manifest_path=manifest,
        execute=True,
        completion_facts=FactProbe.completing(selected),
        run_command=recorder,
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )

    assert code == 0
    assert not any("999" in tok for call in recorder.calls for tok in call)
    assert len(receipts) == 1
    assert receipts[0]["match_id"] == selected.match_id


# ─── Receipts carry the allowlist identity ─────────────────────────────────


def test_receipts_carry_the_allowlist_identity_when_one_was_used(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    receipts: list[dict] = []

    run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )

    assert len(receipts) == 1
    receipt = receipts[0]
    assert receipt["allowlist_sha256"] == hashlib.sha256(allow.read_bytes()).hexdigest()
    assert receipt["allowlist_schema_version"] == ALLOWLIST_SCHEMA_VERSION
    assert receipt["allowlist_manifest_sha256"] == _manifest_sha(env["manifest"])
    assert receipt["allowlist_repository_head"] == REPO_HEAD
    assert receipt["promotion_key"] == list(promotion_key(env["window"]))


def test_execute_plan_refuses_a_plan_with_no_allowlist_at_all(env) -> None:
    """`run_rescue` already refuses `--execute` without an allowlist (see the
    CLI safety rules above) -- but this drives the lower-level `plan_rescue` +
    `execute_plan` primitives directly, the exact route that used to bypass
    that CLI-level rule entirely: a plan built with no allowlist at all was
    still ACCEPTED by `execute_plan`, which ran ffmpeg/ingest-ocr and wrote a
    receipt whose four allowlist fields were merely null. That receipt shape
    is still what an old, pre-allowlist row looks like -- this package has no
    receipt reader, so those historical JSONL rows stay valid by construction
    (the fields are additive) -- but `execute_plan` producing a NEW one from an
    unauthorized plan is exactly the bypass this fix closes. It must now raise
    before anything mutates, not degrade into a null-provenance receipt."""
    receipts: list[dict] = []
    recorder = Recorder()
    plan = plan_rescue(manifest_path=env["manifest"], completion_facts=FactProbe())
    assert plan.allowlist is None

    with pytest.raises(RescueAborted, match="allowlist"):
        execute_plan(
            plan,
            run_command=recorder,
            completion_facts=FactProbe([_complete_fact(env["window"])]),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
            receipt_sink=receipts.append,
        )

    assert recorder.calls == []
    assert receipts == []


# ─── Mutation-boundary authorization ────────────────────────────────────────
#
# `plan_rescue` validates an allowlist once and narrows the plan to exactly its
# selection -- but `ExecutionPlan` is a plain dataclass and `execute_plan` is a
# public function. These tests attack the boundary directly: genuine,
# `plan_rescue`-produced plans corrupted afterwards with `dataclasses.replace`,
# the way a bug (or a hand-built plan) could. Each proves the SAME thing
# `test_execute_plan_refuses_a_plan_with_no_allowlist_at_all` proved for the
# "no allowlist" case: `authorization_problems` -- not a bare
# `plan.allowlist is not None` check -- is what execute_plan trusts.


def test_a_window_outside_the_allowlist_is_refused(env) -> None:
    plan, windows = _two_window_plan(env, both_selected=False)
    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]
    outside = windows[1]  # a real, auto, commands-bearing window -- just never allowlisted

    corrupted = dataclasses.replace(plan, pending=plan.pending + (outside,))
    recorder, made, receipts = Recorder(), [], []
    probe = FactProbe()

    with pytest.raises(RescueAborted, match="outside its allowlist"):
        execute_plan(
            corrupted,
            run_command=recorder,
            completion_facts=probe,
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
            receipt_sink=receipts.append,
            make_batch_dir=made.append,
        )
    assert recorder.calls == [] and made == [] and receipts == []
    assert probe.calls == 0


def test_an_allowlist_entry_missing_from_the_selection_is_refused(env) -> None:
    plan, _ = _two_window_plan(env, both_selected=True)
    assert len(plan.pending) == 2

    corrupted = dataclasses.replace(plan, pending=plan.pending[:1])
    with pytest.raises(RescueAborted, match="not present in the plan's selection"):
        execute_plan(
            corrupted,
            run_command=Recorder(),
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
        )


def test_a_plan_allowlist_manifest_digest_mismatch_is_refused(env) -> None:
    plan, _ = _two_window_plan(env)
    corrupted = dataclasses.replace(plan, manifest_digest="0" * 64)
    with pytest.raises(RescueAborted, match="manifest_digest"):
        execute_plan(
            corrupted,
            run_command=Recorder(),
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
        )


@pytest.mark.parametrize(
    "bad_sha",
    [None, "not-a-sha", "0" * 63, ("f" * 64).upper()],
    ids=["missing", "non-hex", "too-short", "uppercase"],
)
def test_a_missing_or_malformed_allowlist_sha_is_refused(env, bad_sha) -> None:
    plan, _ = _two_window_plan(env)
    corrupted = dataclasses.replace(plan, allowlist_sha256=bad_sha)
    with pytest.raises(RescueAborted, match="allowlist_sha256"):
        execute_plan(
            corrupted,
            run_command=Recorder(),
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
        )


def test_a_missing_allowlist_path_is_refused(env) -> None:
    plan, _ = _two_window_plan(env)
    corrupted = dataclasses.replace(plan, allowlist_path=None)
    with pytest.raises(RescueAborted, match="allowlist_path"):
        execute_plan(
            corrupted,
            run_command=Recorder(),
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
        )


def test_a_duplicated_selected_window_is_refused(env) -> None:
    plan, _ = _two_window_plan(env)
    corrupted = dataclasses.replace(plan, pending=plan.pending + (plan.pending[0],))
    with pytest.raises(RescueAborted, match="duplicate selected window identity"):
        execute_plan(
            corrupted,
            run_command=Recorder(),
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
        )


@pytest.mark.parametrize(
    "field", ["target_screen", "match_id", "run_id", "batch_dir", "promotion_key"]
)
def test_an_allowlist_entry_disagreeing_with_its_window_is_refused(env, field) -> None:
    """Full-identity comparison, not a lookup by (video_sha256, segment_index):
    an allowlist entry that still names the right window but disagrees with it
    on any OTHER field must not authorise that window either."""
    plan, _ = _two_window_plan(env)
    assert plan.allowlist is not None
    entry = plan.allowlist.entries[0]
    overrides = {
        "target_screen": "some_other_screen",
        "match_id": entry.match_id + 1,
        "run_id": entry.run_id + 1,
        "batch_dir": entry.batch_dir + "-tampered",
        "promotion_key": (entry.video_sha256, entry.batch_dir, entry.run_id + 1),
    }
    tampered_entry = dataclasses.replace(entry, **{field: overrides[field]})
    tampered_allowlist = dataclasses.replace(
        plan.allowlist, entries=(tampered_entry,) + plan.allowlist.entries[1:]
    )
    corrupted = dataclasses.replace(plan, allowlist=tampered_allowlist)

    with pytest.raises(RescueAborted) as excinfo:
        execute_plan(
            corrupted,
            run_command=Recorder(),
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(),
        )
    message = str(excinfo.value)
    assert "outside its allowlist" in message
    assert "not present in the plan's selection" in message


def test_valid_allowlisted_execute_plan_behaviour_is_unchanged(env) -> None:
    """The control: an UNCORRUPTED, fully authorised plan still runs exactly as
    it did before this guard existed."""
    plan, windows = _two_window_plan(env)
    recorder, receipts = Recorder(), []
    # `plan` was already built (above) against an empty, plan-time-only probe,
    # so the fresh probe given to `execute_plan` here only needs to answer its
    # OWN (single) call per window with the completed facts directly -- unlike
    # `run_rescue`, which threads one `FactProbe.completing(...)` through both
    # calls itself.
    report = execute_plan(
        plan,
        run_command=recorder,
        completion_facts=FactProbe([_complete_fact(w) for w in windows]),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
    )
    assert report.ok
    assert len(report.promoted) == 2
    assert [c[0] for c in recorder.calls] == ["ffmpeg", "pnpm", "ffmpeg", "pnpm"]
    assert len(receipts) == 2


# ─── Repository-HEAD TOCTOU (mutation-time recheck) ─────────────────────────
#
# `plan_rescue` already checks the allowlist's `repository_head` binding once,
# but HEAD can change between planning and execution -- a checkout, a rebase,
# another operator's commit. These are the checks AT `execute_plan`,
# independent of -- and never re-reading -- the allowlist file `plan_rescue`
# already consumed; the comparison is always against `plan.allowlist`'s
# already-bound value.


def test_head_changing_between_plan_and_execute_is_refused(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(REPO_HEAD),
    )
    recorder, made, receipts = Recorder(), [], []
    probe = FactProbe.completing(env["window"])

    with pytest.raises(RescueAborted, match="repository HEAD changed"):
        execute_plan(
            plan,
            run_command=recorder,
            completion_facts=probe,
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_repo_head(OTHER_REPO_HEAD),  # HEAD moved after planning
            receipt_sink=receipts.append,
            make_batch_dir=made.append,
        )

    assert recorder.calls == [] and made == [] and receipts == []
    assert probe.calls == 0  # the completion probe is never reached either


def test_execute_plan_fails_closed_with_no_repository_head_probe(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    recorder, receipts = Recorder(), []

    with pytest.raises(RescueAborted, match="no repository-HEAD probe"):
        execute_plan(
            plan,
            run_command=recorder,
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            # repository_head omitted entirely -- must fail closed, not default
            # to trusting the plan-time binding.
            receipt_sink=receipts.append,
        )
    assert recorder.calls == [] and receipts == []


def test_a_repository_head_probe_exception_fails_closed(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    def _boom() -> str:
        raise RuntimeError("git binary not found")

    recorder = Recorder()
    with pytest.raises(RescueAborted, match="probe failed"):
        execute_plan(
            plan,
            run_command=recorder,
            completion_facts=FactProbe(),
            rescue_run_id=RUN_ID,
            executed_at=EXECUTED_AT,
            repository_head=_boom,
        )
    assert recorder.calls == []


def test_a_stable_matching_head_proceeds(env) -> None:
    """The positive case: the same probe value at plan time and at execution
    time authorises the run exactly as before."""
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    recorder = Recorder()
    report = execute_plan(
        plan,
        run_command=recorder,
        completion_facts=FactProbe([_complete_fact(env["window"])]),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
    )
    assert report.ok
    assert [c[0] for c in recorder.calls] == ["ffmpeg", "pnpm"]


# ─── Receipt provenance is fail-closed too ──────────────────────────────────
#
# This package has no receipt READER -- nothing parses `rescue-receipts.jsonl`
# back in, anywhere in this tree (see `scripts/execute_rescue_manifest.py`,
# which only appends). So the historical-compatibility story for the four
# allowlist fields is exactly what the `build_receipt` docstring says: they are
# additive, and an old row simply predates them -- there is no reader whose
# behaviour on an old row needs a test. What DOES need a test is that no new
# code path can produce a fresh receipt without them.


def test_build_receipt_rejects_a_plan_with_no_allowlist(env) -> None:
    plan = plan_rescue(manifest_path=env["manifest"], completion_facts=FactProbe())
    outcome = WindowOutcome(window=env["window"], status=OUTCOME_PROMOTED, verified=True)
    with pytest.raises(RescueAborted, match="allowlist"):
        build_receipt(plan, outcome, rescue_run_id=RUN_ID, executed_at=EXECUTED_AT)


def test_a_successful_mocked_execution_always_records_non_null_allowlist_provenance(
    env,
) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    receipts: list[dict] = []
    code = run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
        out=lambda _: None,
    )
    assert code == 0
    assert len(receipts) == 1
    for field in (
        "allowlist_sha256",
        "allowlist_schema_version",
        "allowlist_manifest_sha256",
        "allowlist_repository_head",
    ):
        assert receipts[0][field] is not None


# ─── TOCTOU resistance ──────────────────────────────────────────────────────


def test_the_allowlist_file_is_never_reread_after_planning(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )
    assert [w.segment_index for w in plan.pending] == [SEGMENT_INDEX_BASE]

    allow.unlink()  # gone -- execution must not care, it never reopens this path

    recorder = Recorder()
    report = execute_plan(
        plan,
        run_command=recorder,
        completion_facts=FactProbe([_complete_fact(env["window"])]),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
    )
    assert report.ok
    assert [c[0] for c in recorder.calls] == ["ffmpeg", "pnpm"]


def test_the_receipts_allowlist_hash_reflects_the_bytes_read_at_plan_time_not_a_later_edit(
    env,
) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    original_bytes = allow.read_bytes()
    plan = plan_rescue(
        manifest_path=env["manifest"],
        completion_facts=FactProbe(),
        allowlist_path=allow,
        repository_head=_repo_head(),
    )

    # Mutated on disk AFTER planning -- must have zero effect on this run.
    allow.write_text(
        json.dumps(_allowlist_doc(env["window"], manifest_sha256="0" * 64))
    )

    receipts: list[dict] = []
    execute_plan(
        plan,
        run_command=Recorder(),
        completion_facts=FactProbe.completing(env["window"]),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        repository_head=_repo_head(),
        receipt_sink=receipts.append,
    )
    assert receipts[0]["allowlist_sha256"] == hashlib.sha256(original_bytes).hexdigest()
    assert receipts[0]["allowlist_manifest_sha256"] == _manifest_sha(env["manifest"])


# ─── Dry-run rendering ──────────────────────────────────────────────────────


def test_the_dry_run_render_shows_the_allowlist_identity_and_counts(env) -> None:
    cache_root, video = env["cache_root"], env["video"]
    selected = env["window"]
    excluded = _make_window(
        cache_root=cache_root,
        video_path=video,
        segment_index=SEGMENT_INDEX_BASE + 1,
        match_id=999,
    )
    manifest = _write(_manifest_doc([selected, excluded], cache_root=cache_root), env["tmp"], "two.json")
    allow = _write_allowlist(
        _allowlist_doc(selected, manifest_sha256=_manifest_sha(manifest)), env["tmp"]
    )

    lines: list[str] = []
    run_rescue(
        manifest_path=manifest,
        execute=False,
        completion_facts=FactProbe(),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lines.append,
    )
    output = "\n".join(lines)

    assert _manifest_sha(manifest) in output
    assert hashlib.sha256(allow.read_bytes()).hexdigest() in output
    assert REPO_HEAD in output
    assert "manifest auto total" in output
    assert "excluded" in output
    assert "cannot execute" in output.lower()


def test_the_execution_report_retains_the_allowlist_identity(env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    lines: list[str] = []

    run_rescue(
        manifest_path=env["manifest"],
        execute=True,
        completion_facts=FactProbe.completing(env["window"]),
        run_command=Recorder(),
        rescue_run_id=RUN_ID,
        executed_at=EXECUTED_AT,
        allowlist_path=allow,
        repository_head=_repo_head(),
        out=lines.append,
    )
    output = "\n".join(lines)
    assert hashlib.sha256(allow.read_bytes()).hexdigest() in output


# ─── The real corrected audit proposal is rejected, not treated as executable ─

_REAL_CANDIDATE_MANIFEST = Path("/tmp/rescue-schema3-2026-08-05/rescue-manifest.candidate.json")
_REAL_CANDIDATE_MANIFEST_SHA256 = (
    "f0727066aa6b4f04cd6c095015b9d683532dd6b6686c357c4a41b2fdf1d33397"
)
_REAL_CORRECTED_PROPOSAL = Path(
    "/tmp/rescue-audit-20260806-sem-v3/allowlist_proposal.corrected.json"
)
_REAL_CORRECTED_PROPOSAL_SHA256 = (
    "be7e93591ab30195d57d5e8c7b6aa0547731ea21466321438d506a9212b3128b"
)
_REAL_ARTIFACTS_PRESENT = (
    _REAL_CANDIDATE_MANIFEST.is_file() and _REAL_CORRECTED_PROPOSAL.is_file()
)


@pytest.mark.skipif(
    not _REAL_ARTIFACTS_PRESENT,
    reason="real schema-3 candidate manifest / corrected audit proposal not present on this machine",
)
def test_the_real_corrected_audit_proposal_is_rejected_as_non_executable() -> None:
    """The proposal this implementation session was handed is explicitly NOT an
    execution allowlist (`proposal_only`, `do_not_execute`) and is bound to the
    HEAD this implementation supersedes. Proved here as a DRY RUN, against the
    real candidate manifest, before any completion probe -- never transformed
    or relabelled into something executable."""
    assert file_digest(_REAL_CANDIDATE_MANIFEST) == _REAL_CANDIDATE_MANIFEST_SHA256
    assert (
        hashlib.sha256(_REAL_CORRECTED_PROPOSAL.read_bytes()).hexdigest()
        == _REAL_CORRECTED_PROPOSAL_SHA256
    )

    probe = FactProbe()
    with pytest.raises(RescueAborted) as excinfo:
        plan_rescue(
            manifest_path=_REAL_CANDIDATE_MANIFEST,
            completion_facts=probe,
            allowlist_path=_REAL_CORRECTED_PROPOSAL,
            repository_head=lambda: "2d88bb4b94bf59b763fd2508432124d5dccc3b26",
        )

    message = str(excinfo.value)
    assert "proposal_only" in message
    assert "do_not_execute" in message
    assert probe.calls == 0


# ─── CLI wiring: --allowlist, the execute guard, and git provenance ────────


def _load_cli_module():
    """Import the script as a module without executing its `__main__` block, so
    `read_repository_head` can be exercised directly."""
    spec = importlib.util.spec_from_file_location("_execute_rescue_manifest_cli", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_read_repository_head_matches_git_rev_parse_head_despite_a_dirty_tree() -> None:
    """Exercised against THIS checkout, whose own git status has uncommitted
    changes -- proving dirty files do not perturb the binding."""
    repo_root = _TOOL_ROOT.parents[1]  # the eanhl-team-website checkout
    expected = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    cli = _load_cli_module()
    assert cli.read_repository_head(repo_root) == expected


def test_the_script_refuses_execute_without_allowlist(tmp_path: Path) -> None:
    """The guard fires before the manifest is even read -- deliberately
    invalid JSON here proves the rejection is not a manifest complaint."""
    bad = tmp_path / "rescue-manifest.json"
    bad.write_text("{not json")

    proc = subprocess.run(
        [sys.executable, str(_SCRIPT), "--manifest", str(bad), "--execute"],
        capture_output=True,
        text=True,
        cwd=str(_TOOL_ROOT),
        env={
            "PATH": "/usr/bin:/bin",
            "PYTHONPATH": f"{_TOOL_ROOT}:{_TOOL_ROOT.parent / 'game_ocr'}",
        },
    )

    assert proc.returncode == 1
    assert "Traceback" not in proc.stderr
    assert "--allowlist" in proc.stderr
    assert "not valid JSON" not in proc.stderr


def test_the_script_reports_a_git_provenance_failure_cleanly(tmp_path: Path, env) -> None:
    allow = _write_allowlist(
        _allowlist_doc(env["window"], manifest_sha256=_manifest_sha(env["manifest"])), env["tmp"]
    )
    non_git_root = tmp_path / "not-a-repo"
    non_git_root.mkdir()

    proc = subprocess.run(
        [
            sys.executable,
            str(_SCRIPT),
            "--manifest",
            str(env["manifest"]),
            "--allowlist",
            str(allow),
            "--repo-root",
            str(non_git_root),
        ],
        capture_output=True,
        text=True,
        cwd=str(_TOOL_ROOT),
        env={
            "PATH": "/usr/bin:/bin",
            "PYTHONPATH": f"{_TOOL_ROOT}:{_TOOL_ROOT.parent / 'game_ocr'}",
        },
    )

    assert proc.returncode == 1
    assert "Traceback" not in proc.stderr
    assert "git provenance" in proc.stderr
