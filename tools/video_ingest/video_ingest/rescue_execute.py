"""Stage-B post-game rescue executor — consumes the Stage-A manifest verbatim.

Stage A (``rescue_manifest`` + ``scripts/rescue_postgame_from_cache.py``) did all
the thinking: it classified every cached anchor read, resolved each frame to a
reel → match → active run, adjudicated the identity ledgers, and pinned the exact
``ffmpeg`` + ``ingest-ocr`` argv for every window it was willing to approve.

Stage B does **none** of that again. It re-derives no classification, no
identity, no window geometry and no decision. Its entire job is to be a careful
gate in front of argv that already exists:

  1. validate the COMPLETE manifest — every window, not just the ones it wants;
  2. take only ``decision == "auto"`` windows whose pinned commands are
     self-consistent;
  3. preflight the exact cache and video artifacts that set depends on;
  4. abort the whole run if anything is missing — never skip a window, never
     fall back to decoding;
  5. refuse to start if the *environment* those pinned commands will inherit
     cannot support them — the argv is not self-contained;
  6. drop windows whose output the database *verifiably* already holds, so a
     rerun cannot duplicate real rescue data — and, just as importantly, cannot
     mistake a half-written batch for a finished one;
  7. prove, per invocation, that the frames ``ingest-ocr`` is about to read were
     produced by THIS ffmpeg call — by staging them in a directory verified
     empty a moment earlier, never by counting what happens to be on disk;
  8. re-check that same predicate after every window it runs, so a subprocess
     that exits 0 without producing the output is a failure and not a promotion;
  9. and do all of the above without executing anything unless the operator
     passed the explicit opt-in.

Everything here is a pure function over plain data plus injected IO seams
(``completion_facts``, ``run_command``, ``receipt_sink``, ``list_files``,
``publish_outputs``), so the whole policy is unit-testable with no cache, no
video, no ffmpeg and no database.

**Why ffmpeg does not write into the batch directory.** Counting the PNGs in the
batch directory after ffmpeg returns cannot distinguish this invocation's output
from a previous one's. A batch directory already holding a complete stale set
keeps its count when the current command writes nothing, and the count-based
gate passed — handing ``ingest-ocr`` frames the manifest's current command never
produced. Every window therefore runs as a small transaction: ffmpeg writes into
``<batch_dir>/.staging``, which is proven EMPTY immediately beforehand; the exact
expected ``%05d.png`` set (no shortfall, no surplus, no foreign name) is proven
there afterwards; and only then are those files moved into the batch directory,
which is itself proven to hold nothing this run did not produce. See
:func:`execute_plan` and the ``prove_*`` functions. Nothing in that chain relies
on a total count, a content hash or a filesystem mtime.

The rollback story is inherited from Stage A and must not drift:

  * a rescue capture batch is identifiable by ``source_directory LIKE
    '%/rescue/%'`` — enforced by :func:`command_problems`;
  * a rescue segment is identifiable by ``decoder_version =
    'rescue-b2-anchor-v1'`` — enforced by :func:`command_problems`.

**Why the capture-batch row is not the completion signal.** ``ocr_capture_batches``
is unique on ``(video_sha256, source_directory, run_id)`` and ``ingest-ocr``
upserts that row *before* it processes a single result
(``apps/worker/src/ingest-ocr.ts``, the ``db.insert(ocrCaptureBatches)`` block
that runs ahead of the ``for (const result of cli.results)`` loop). Everything
after that point is failure-tolerant:

  * each result is persisted inside ``try { … } catch { failed++ }`` — a
    rolled-back result leaves no ``ocr_extractions`` row and does not throw;
  * ``writeSegmentForBatch`` is wrapped in its own ``try/catch`` that only
    ``console.warn``s, so the batch row can exist with **no** ``ocr_segments``
    row at all;
  * when the OCR CLI returns zero results the segment is still written, with
    ``frame_count = 0`` and ``observability_status='not_observable_from_source'``;
  * ``ingest-ocr-cli.ts`` never inspects ``summary.failed`` — ``process.exitCode``
    is set only from the top-level ``.catch``, so every case above exits **0**.

So "the key exists" proves only that the process started. Keying idempotency on
it means a retry classifies a half-written batch as done and skips it forever —
permanent, silent data loss. :func:`completion_problems` is the corrected
predicate; see it for the exact columns and for why an ``ocr_segments`` row on
its own is still not enough.

The manifest's own ``cache_root`` is authoritative and there is deliberately no
override: the pinned ``batch_dir`` in every command was built against it, so
substituting a different root would split a run between the path Stage B checks
and the path ``ingest-ocr`` writes. If the cache moved, regenerate the manifest.
This module VALIDATES; like :mod:`video_ingest.cache_root`, it never RESOLVES.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from video_ingest.cache_root import PASS1_ARTIFACT
from video_ingest.rescue_manifest import (
    AUTO_ELIGIBLE_SCREENS,
    DECISION_AUTO,
    RESCUE_DECODER_VERSION,
    SCHEMA_VERSION,
    SEGMENT_INDEX_BASE,
    STAGING_DIRNAME,
    UNPINNABLE_LEDGER_KEY,
    Window,
    expected_output_names,
    parse_windows,
    rescue_batch_dir,
    rescue_output_pattern,
    rescue_staging_dir,
    validate_manifest,
    window_evidence_timestamps,
)
from video_ingest.rescue_sampling import (
    SAMPLING_MODE,
    SamplingImpossible,
    canonical_ffmpeg_argv,
    sampling_from_dict,
    sampling_problems,
)

#: The opt-in that turns planning into promotion. Named once so the guard, the
#: CLI and the dry-run banner cannot drift apart.
EXECUTE_FLAG = "--execute"

#: The path component that makes a capture batch identifiable as a rescue in
#: `ocr_capture_batches.source_directory`. Rollback keys on it, so a window
#: whose batch dir lost it is not executable.
RESCUE_DIR_MARKER = "/rescue/"

#: The two commands each window runs, in order.
STEP_FFMPEG = "ffmpeg"
STEP_INGEST_OCR = "ingest_ocr"
STEP_ORDER: tuple[str, ...] = (STEP_FFMPEG, STEP_INGEST_OCR)

OUTCOME_PROMOTED = "promoted"
OUTCOME_FAILED = "failed"
OUTCOME_NOT_ATTEMPTED = "not_attempted"


class RescueAborted(RuntimeError):
    """Stage B refused to run. Carries an operator-facing message.

    The CLI turns this into a clean exit 1. Every expected rejection — an
    unreadable manifest, a schema mismatch, a tampered command, a missing cache
    artifact — arrives as one of these rather than as a traceback.
    """


# ─── Manifest loading ────────────────────────────────────────────────────────


def file_digest(path: Path) -> str:
    """SHA-256 of the manifest bytes, recorded on every receipt.

    Provenance: it ties a promoted row back to the exact manifest revision that
    authorised it, which a regenerated manifest cannot forge.
    """
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_manifest(path: Path) -> dict[str, Any]:
    """Read and JSON-parse the manifest, or abort with a clean message."""
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise RescueAborted(f"manifest unreadable: {path}\n  {exc}") from exc
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RescueAborted(f"manifest is not valid JSON: {path}\n  {exc}") from exc
    if not isinstance(doc, dict):
        raise RescueAborted(
            f"manifest root must be a JSON object, got {type(doc).__name__}: {path}"
        )
    return doc


# ─── Validation ──────────────────────────────────────────────────────────────


def policy_problems(doc: dict[str, Any]) -> list[str]:
    """Whether the manifest was produced by the Stage A this executor pairs with.

    A manifest from a different schema, decoder tag, segment base or
    auto-eligible screen set is not merely older — its windows encode a policy
    this executor's rollback and idempotency keys do not describe.
    """
    problems: list[str] = []

    if doc.get("schema_version") != SCHEMA_VERSION:
        problems.append(
            f"schema_version: expected {SCHEMA_VERSION}, got {doc.get('schema_version')!r}"
        )

    cache_root = doc.get("cache_root")
    if not isinstance(cache_root, str) or not cache_root.strip():
        problems.append("cache_root: missing or empty")

    policy = doc.get("policy")
    if not isinstance(policy, dict):
        problems.append("policy: missing or not an object")
        return problems

    if policy.get("decoder_version") != RESCUE_DECODER_VERSION:
        problems.append(
            f"policy.decoder_version: expected {RESCUE_DECODER_VERSION!r}, "
            f"got {policy.get('decoder_version')!r}"
        )
    if policy.get("segment_index_base") != SEGMENT_INDEX_BASE:
        problems.append(
            f"policy.segment_index_base: expected {SEGMENT_INDEX_BASE}, "
            f"got {policy.get('segment_index_base')!r}"
        )
    screens = policy.get("auto_eligible_screens")
    if list(screens or []) != list(AUTO_ELIGIBLE_SCREENS):
        problems.append(
            "policy.auto_eligible_screens: does not match this executor's "
            f"{list(AUTO_ELIGIBLE_SCREENS)}"
        )
    # Schema 3's substance. A manifest can carry the version number without
    # carrying the contract — a hand-edited `schema_version` is one keystroke —
    # so the sampling mode is checked as its own claim.
    if policy.get("sampling_mode") != SAMPLING_MODE:
        problems.append(
            f"policy.sampling_mode: expected {SAMPLING_MODE!r}, got "
            f"{policy.get('sampling_mode')!r} — this executor only runs commands "
            "pinned to deterministic source-PTS selection, never fps resampling"
        )

    # The unpinnable ledger. A window may lose its command only if the manifest
    # SAYS SO, and only if it was never executable. Requiring the key even when
    # nothing was dropped is the point: an absent ledger would make "no window
    # was dropped" and "the producer does not record drops" the same document.
    ledger = policy.get(UNPINNABLE_LEDGER_KEY)
    if not isinstance(ledger, list):
        problems.append(
            f"policy.{UNPINNABLE_LEDGER_KEY}: missing or not a list — a schema-3 "
            "manifest must state, even as an empty list, which windows could not be "
            "pinned to a source grid"
        )
    else:
        for i, entry in enumerate(ledger):
            if not isinstance(entry, dict):
                problems.append(f"policy.{UNPINNABLE_LEDGER_KEY}[{i}]: not an object")
                continue
            if entry.get("decision") == DECISION_AUTO:
                problems.append(
                    f"policy.{UNPINNABLE_LEDGER_KEY}[{i}]: names an AUTO window "
                    f"({str(entry.get('video_sha256') or '')[:12]}/"
                    f"seg{entry.get('segment_index')}) — an executable window may never "
                    "have its command dropped; it must be pinned or the whole manifest "
                    "must be refused"
                )
    return problems


def flag_value(argv: Sequence[str], flag: str) -> str | None:
    """The token after ``flag``, or ``None`` if absent or trailing."""
    for i, token in enumerate(argv):
        if token == flag:
            return argv[i + 1] if i + 1 < len(argv) else None
    return None


def _argv_problems(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        return [f"commands.{label}: missing or empty"]
    if not all(isinstance(tok, str) for tok in value):
        return [f"commands.{label}: contains a non-string token"]
    return []


def command_problems(window: Window, *, cache_root: str) -> list[str]:
    """Whether an auto window's pinned commands are self-consistent.

    This VERIFIES the fingerprint Stage A wrote; it does not recompute it. Every
    check compares the manifest's own window fields against the manifest's own
    argv, so a hand-edited, half-regenerated or cross-manifest command set
    cannot execute — while a faithful Stage A manifest passes untouched.

    The batch dir is checked for exact equality against Stage A's own
    :func:`rescue_batch_dir` because that path is the rollback handle: it is
    what lands in ``ocr_capture_batches.source_directory`` and what the
    ``'%/rescue/%'`` sweep finds.
    """
    commands = window.commands
    if not isinstance(commands, dict):
        return ["commands: null (nothing pinned to execute)"]

    problems: list[str] = []

    batch_dir = commands.get("batch_dir")
    if not isinstance(batch_dir, str) or not batch_dir:
        problems.append("commands.batch_dir: missing or empty")
        batch_dir = ""
    else:
        expected_dir = rescue_batch_dir(cache_root, window)
        if batch_dir != expected_dir:
            problems.append(
                f"commands.batch_dir: {batch_dir!r} does not match this window's "
                f"pinned location {expected_dir!r}"
            )
        if RESCUE_DIR_MARKER not in batch_dir:
            problems.append(
                f"commands.batch_dir: {batch_dir!r} lacks the {RESCUE_DIR_MARKER!r} "
                "marker that rollback keys on"
            )

    # Schema 2's `sample_fps` described an `-vf fps=N` filter that sampled on the
    # OUTPUT timeline and provably never captured its own evidence timestamp.
    # Its presence is named explicitly rather than left to the argv comparison,
    # because "your command is from the superseded contract" is the useful
    # diagnosis and a 15-token argv diff is not.
    if "sample_fps" in commands:
        problems.append(
            "commands.sample_fps: this is a schema-2 fps-resampled command. That "
            "sampling captured whatever frame the seek landed near, not the "
            "evidence frame, and is not executable — regenerate or transform the "
            "manifest to the source-PTS contract"
        )

    # The sampling metadata is recomputed from the window's own evidence and
    # bounds, so this covers evidence representation, window/video clamping,
    # deduplication and the expected count in one place.
    sampling = commands.get("sampling")
    sampling_faults = sampling_problems(
        sampling,
        evidence_timestamps=window_evidence_timestamps(window),
        t0=window.t0,
        t1=window.t1,
    )
    problems += sampling_faults

    ffmpeg = commands.get("ffmpeg")
    ffmpeg_problems = _argv_problems(ffmpeg, STEP_FFMPEG)
    problems += ffmpeg_problems
    if not ffmpeg_problems:
        assert isinstance(ffmpeg, list)  # narrowed by _argv_problems
        if ffmpeg[0] != "ffmpeg":
            problems.append(f"commands.ffmpeg: argv[0] is {ffmpeg[0]!r}, not 'ffmpeg'")
        # ffmpeg must write into the window's STAGING directory, never straight
        # into the batch dir: that is what lets the executor prove which files
        # the current invocation produced. A command aimed at the batch dir is
        # not merely unconventional, it is unverifiable.
        if batch_dir and ffmpeg[-1] != rescue_output_pattern(batch_dir):
            problems.append(
                f"commands.ffmpeg: output {ffmpeg[-1]!r} is not this window's staging "
                f"pattern {rescue_output_pattern(batch_dir)!r} — outputs must land in "
                f"{STAGING_DIRNAME!r} so the executor can prove they are this "
                "invocation's"
            )
        # Exact equality against the argv rebuilt from the metadata — NOT a
        # scan for expected flags, and emphatically not a parse of the filter
        # expression. Nothing here interprets `select=...`; it is regenerated
        # and compared as a string, so an argv that is merely plausible, or a
        # filter that is merely valid, still fails.
        if not sampling_faults and batch_dir:
            try:
                plan = sampling_from_dict(sampling)
            except (SamplingImpossible, ValueError) as exc:  # pragma: no cover
                problems.append(f"commands.sampling: unreadable ({exc})")
            else:
                canonical = canonical_ffmpeg_argv(
                    video_path=window.video_path,
                    output_pattern=rescue_output_pattern(batch_dir),
                    plan=plan,
                )
                if list(ffmpeg) != canonical:
                    problems.append(
                        "commands.ffmpeg: argv does not match the canonical command "
                        f"derived from commands.sampling.\n      pinned    : {ffmpeg}\n"
                        f"      canonical : {canonical}"
                    )

    ingest = commands.get("ingest_ocr")
    ingest_problems = _argv_problems(ingest, STEP_INGEST_OCR)
    problems += ingest_problems
    if not ingest_problems:
        assert isinstance(ingest, list)  # narrowed by _argv_problems
        expectations: list[tuple[str, str | None]] = [
            ("--batch-dir", batch_dir or None),
            ("--screen", window.target_screen),
            ("--match-id", str(window.match_id) if window.match_id is not None else None),
            ("--video-sha256", window.video_sha256),
            ("--video-segment-index", str(window.segment_index)),
            ("--video-segment-start-sec", f"{window.t0:.3f}"),
            ("--video-segment-end-sec", f"{window.t1:.3f}"),
            ("--capture-kind", "video_frames"),
            # The rescue tag is the segment-layer rollback handle. Losing it
            # would publish rescued rows indistinguishable from native ones.
            ("--decoder-version", RESCUE_DECODER_VERSION),
            # An auto window always resolved to an active run (Stage A routes a
            # runless match to review), and the run is half of the promotion
            # key — an untagged rescue batch would be a second, unkeyed row.
            ("--run-id", str(window.run_id) if window.run_id is not None else None),
        ]
        for flag, expected in expectations:
            got = flag_value(ingest, flag)
            if expected is None:
                problems.append(f"commands.ingest_ocr {flag}: window has no value to pin")
            elif got != expected:
                problems.append(
                    f"commands.ingest_ocr {flag}: {got!r} does not match the window's "
                    f"{expected!r}"
                )

    return problems


def validate_for_execution(doc: dict[str, Any]) -> list[str]:
    """Every problem that must be zero before Stage B may run anything.

    Deliberately whole-manifest: Stage A's structural pass runs over EVERY
    window, auto or not. A manifest that is malformed anywhere is a manifest
    whose auto windows cannot be trusted either, so a broken review window
    aborts the run rather than being quietly stepped over.
    """
    problems = list(validate_manifest(doc))
    problems += policy_problems(doc)

    cache_root = doc.get("cache_root")
    cache_root_str = cache_root if isinstance(cache_root, str) else ""

    for i, raw in enumerate(doc.get("windows") or []):
        if not isinstance(raw, dict):
            continue  # already reported by validate_manifest
        try:
            window = Window(**raw)
        except TypeError:
            continue  # already reported by validate_manifest
        if window.decision != DECISION_AUTO:
            continue
        where = f"window[{i}] {window.video_sha256[:12]}/seg{window.segment_index}"
        problems += [f"{where}: {p}" for p in command_problems(window, cache_root=cache_root_str)]

    return problems


def _render_problems(problems: Sequence[str], *, source: Path, limit: int = 40) -> str:
    lines = [
        f"manifest REJECTED: {source}",
        f"  {len(problems)} problem(s); Stage B will not execute a partially valid manifest.",
    ]
    lines += [f"    - {p}" for p in problems[:limit]]
    if len(problems) > limit:
        lines.append(f"    ... and {len(problems) - limit} more")
    return "\n".join(lines)


def require_valid_manifest(doc: dict[str, Any], *, source: Path) -> None:
    problems = validate_for_execution(doc)
    if problems:
        raise RescueAborted(_render_problems(problems, source=source))


# ─── Decision filtering ──────────────────────────────────────────────────────


def executable_windows(windows: Iterable[Window]) -> list[Window]:
    """Only ``auto``.

    ``review`` means a human has not resolved it and ``skip`` means there is
    provably nothing to gain; neither is executable, and neither becomes
    executable because it happens to carry a command fingerprint (most skips
    keep theirs — only the unassociated duplicates have theirs nulled).
    """
    return [w for w in windows if w.decision == DECISION_AUTO]


def assert_executable(window: Window) -> None:
    """Last-line guard, re-checked at the moment of execution.

    :func:`executable_windows` already filtered, so reaching this with a
    non-auto window means a caller hand-built a plan. Fail closed rather than
    trust the earlier filter.
    """
    if window.decision != DECISION_AUTO:
        raise RescueAborted(
            f"refusing to execute a {window.decision!r} window "
            f"({window.video_sha256[:12]}/seg{window.segment_index}, "
            f"reason={window.reason!r}) — only {DECISION_AUTO!r} windows are executable"
        )
    if not isinstance(window.commands, dict):
        raise RescueAborted(
            f"refusing to execute {window.video_sha256[:12]}/seg{window.segment_index}: "
            "no pinned commands"
        )


# ─── Artifact preflight ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class ArtifactCheck:
    """One manifest-referenced path the auto set cannot run without."""

    kind: str
    path: Path
    windows: int


def required_artifacts(windows: Sequence[Window], cache_root: Path) -> list[ArtifactCheck]:
    """Exactly the artifacts the AUTO set depends on — nothing wider.

    Two kinds, both referenced by the manifest itself:

    * ``pass1_cache`` — ``<cache-root>/<sha>/segments.json``, one per distinct
      sha in the auto set. This is the evidence the manifest's decisions rest
      on; if it is gone, the manifest is describing a cache that no longer
      exists and its geometry cannot be trusted.
    * ``video`` — the source file each ffmpeg invocation reads.

    Windows the manifest routed to review or skip contribute nothing: their
    shas are not in the auto set, so a missing cache entry for a review-only
    video is not this run's problem and must not abort it.
    """
    cache_counts: dict[Path, int] = {}
    video_counts: dict[Path, int] = {}
    for window in windows:
        cache_path = cache_root / window.video_sha256 / PASS1_ARTIFACT
        cache_counts[cache_path] = cache_counts.get(cache_path, 0) + 1
        if window.video_path:
            video_path = Path(window.video_path)
            video_counts[video_path] = video_counts.get(video_path, 0) + 1

    checks = [ArtifactCheck("pass1_cache", p, n) for p, n in sorted(cache_counts.items())]
    checks += [ArtifactCheck("video", p, n) for p, n in sorted(video_counts.items())]
    return checks


def missing_artifacts(checks: Iterable[ArtifactCheck]) -> list[ArtifactCheck]:
    return [c for c in checks if not c.path.is_file()]


def _render_missing(missing: Sequence[ArtifactCheck], total: int) -> str:
    lines = [
        "artifact preflight FAILED: "
        f"{len(missing)} of {total} manifest-referenced artifact(s) are missing.",
        "  Stage B is all-or-nothing: it will NOT skip the affected windows and it",
        "  will NOT fall back to decoding. Nothing was executed and no row was written.",
    ]
    for check in missing:
        lines.append(f"    - [{check.kind}] {check.path}  ({check.windows} auto window(s))")
    lines.append(
        "  Restore the artifacts, or regenerate the manifest against the cache that "
        "actually exists."
    )
    return "\n".join(lines)


# ─── Completion ──────────────────────────────────────────────────────────────

#: ``(video_sha256, source_directory, run_id)`` — a verbatim mirror of the
#: ``ocr_capture_batches_video_sha_dir_run_uniq`` index. This identifies the
#: capture batch a window's output must hang off. It is the JOIN key, **not**
#: the completion test: see the module docstring for why its mere existence
#: proves nothing.
PromotionKey = tuple[str, str, int | None]

#: How ``ingest-ocr`` builds ``ocr_segments.segment_key`` for a video-backed
#: batch: ``vsha-<first 12 of sha>:seg<index padded to 4>``. Mirrored here so a
#: window can name the exact row it must have produced.
SEGMENT_KEY_SHA_CHARS = 12
SEGMENT_KEY_INDEX_WIDTH = 4

#: ``ocr_segments.observability_status`` for a segment that actually saw frames.
#: ``ingest-ocr`` writes ``'not_observable_from_source'`` instead whenever
#: ``frame_count == 0``, which is exactly the exits-0-with-no-output case.
SEGMENT_OBSERVABLE = "observable"

#: ``ocr_extractions.transform_status`` after a promoter ran without throwing.
#: Every screen Stage B may execute has a registered promoter, so this is the
#: pipeline's own signal that downstream promotion committed for that frame.
EXTRACTION_SUCCESS = "success"


def promotion_key(window: Window) -> PromotionKey:
    batch_dir = ""
    if isinstance(window.commands, dict):
        batch_dir = str(window.commands.get("batch_dir") or "")
    return (window.video_sha256, batch_dir, window.run_id)


def expected_segment_key(window: Window) -> str:
    """The ``ocr_segments.segment_key`` this window's ingest must have written."""
    return (
        f"vsha-{window.video_sha256[:SEGMENT_KEY_SHA_CHARS]}"
        f":seg{window.segment_index:0{SEGMENT_KEY_INDEX_WIDTH}d}"
    )


@dataclass(frozen=True)
class CompletionFact:
    """One rescue capture batch as the database actually holds it.

    A LEFT JOIN of ``ocr_capture_batches`` onto ``ocr_segments`` plus the two
    ``ocr_extractions`` counts for the batch. The join is left, deliberately: a
    batch that produced no segment must still surface as a *fact*, because
    "started and produced nothing" is the failure this module exists to catch,
    and reporting it is more useful than its absence.
    """

    video_sha256: str
    source_directory: str
    run_id: int | None
    batch_match_id: int | None
    #: Segment columns are ``None`` when the batch has no ``ocr_segments`` row.
    segment_key: str | None = None
    segment_match_id: int | None = None
    segment_run_id: int | None = None
    state: str | None = None
    t_start_sec: Any = None
    t_end_sec: Any = None
    decoder_version: str | None = None
    frame_count: int | None = None
    observability_status: str | None = None
    #: Rows in ``ocr_extractions`` for this batch, and how many reached
    #: ``transform_status='success'``.
    extraction_count: int = 0
    extraction_success_count: int = 0

    @property
    def key(self) -> PromotionKey:
        return (self.video_sha256, self.source_directory, self.run_id)

    @property
    def has_segment(self) -> bool:
        return self.segment_key is not None


#: ``completion_facts() -> Sequence[CompletionFact]``. One read-only query over
#: every rescue capture batch. Injected so the predicate below is unit-testable
#: with no database, and so plan-time and post-execution verification are
#: provably the same code path against the same shape of data.
CompletionProbe = Callable[[], Sequence[CompletionFact]]


def _fixed3(value: Any) -> str | None:
    """A ``numeric(10,3)`` rendered the way the manifest pins its bounds.

    Accepts whatever the probe hands over — ``Decimal``, ``float`` or the
    ``::text`` form — so the comparison is on value, not on representation. An
    unparseable value is returned verbatim so it is *reported* as a mismatch
    rather than silently collapsing to "absent".
    """
    if value is None:
        return None
    try:
        return f"{float(value):.3f}"
    except (TypeError, ValueError):
        return str(value)


def _fact_problems(window: Window, fact: CompletionFact) -> list[str]:
    """Every way this batch row falls short of being the window's output."""
    problems: list[str] = []

    # The batch's sha, directory and run id matched by construction (they are
    # the join key). Its match id did not.
    if fact.batch_match_id != window.match_id:
        problems.append(
            f"ocr_capture_batches.match_id {fact.batch_match_id!r} != window's {window.match_id!r}"
        )

    if not fact.has_segment:
        problems.append(
            "capture batch exists but carries NO ocr_segments row — ingest-ocr's "
            "writeSegmentForBatch failure is caught and only warned about, so this "
            "batch exited 0 without producing its segment"
        )
    else:
        expected_key = expected_segment_key(window)
        for label, got, expected in (
            ("segment_key", fact.segment_key, expected_key),
            ("state", fact.state, window.target_screen),
            ("match_id", fact.segment_match_id, window.match_id),
            ("run_id", fact.segment_run_id, window.run_id),
            ("t_start_sec", _fixed3(fact.t_start_sec), f"{window.t0:.3f}"),
            ("t_end_sec", _fixed3(fact.t_end_sec), f"{window.t1:.3f}"),
            ("decoder_version", fact.decoder_version, RESCUE_DECODER_VERSION),
        ):
            if got != expected:
                problems.append(
                    f"ocr_segments.{label} {got!r} != window's {expected!r}"
                )
        if not fact.frame_count:
            problems.append(
                f"ocr_segments.frame_count is {fact.frame_count!r} — the ingest "
                "recorded a segment that saw no frames"
            )
        if fact.observability_status != SEGMENT_OBSERVABLE:
            problems.append(
                f"ocr_segments.observability_status {fact.observability_status!r} != "
                f"{SEGMENT_OBSERVABLE!r}"
            )

    # The segment row is written whatever the results loop did, so it cannot
    # speak for the extractions. These two counts can.
    if fact.extraction_count == 0:
        problems.append(
            "0 ocr_extractions rows for this batch — every result's persistence "
            "transaction was rolled back, or the OCR CLI returned nothing"
        )
    elif fact.has_segment and fact.frame_count and fact.extraction_count != fact.frame_count:
        # EXACT equality, in both directions. `frame_count` is what the ingest
        # said it processed and each processed result upserts exactly one
        # extraction row, so the counts match iff this window's batch holds
        # exactly its own output.
        #
        # A SHORTFALL means a per-result transaction rolled back and `failed++`
        # swallowed it.
        #
        # A SURPLUS is not benign and is deliberately NOT tolerated. The extra
        # rows come from an earlier, wider extraction into the same batch dir,
        # and they carry that older run's `transform_status` — including
        # 'success'. Tolerating the surplus would let stale success from a
        # superseded extraction satisfy `extraction_success_count >= 1` and
        # authorise completion while the CURRENT window's frames failed. A
        # surplus is operator-repair state: clear the stale rows (or the batch
        # dir) and re-run. Stage B fails closed on it rather than deciding
        # automatically which rows were this window's.
        if fact.extraction_count < fact.frame_count:
            why = "a per-result persistence failure was swallowed"
        else:
            why = (
                "surplus rows — stale output from an earlier, wider extraction into "
                "the same batch dir, whose successes must not authorise this window; "
                "clear them and re-run"
            )
        problems.append(
            f"ocr_extractions rows {fact.extraction_count} != ocr_segments.frame_count "
            f"{fact.frame_count} — {why}"
        )
    if fact.extraction_success_count == 0:
        problems.append(
            f"no ocr_extractions row reached transform_status={EXTRACTION_SUCCESS!r} — "
            "no promoter committed anything for this window"
        )

    return problems


def completion_problems(window: Window, facts: Sequence[CompletionFact]) -> list[str]:
    """Empty ⇔ this window's rescue output is verifiably present and correct.

    This is THE predicate: it gates the plan's partition *and* the
    post-execution postcondition, so a window can never be skipped on evidence
    weaker than the evidence required to call it promoted in the first place.

    An ``ocr_segments`` row alone is deliberately not sufficient. In
    ``apps/worker/src/ingest-ocr.ts`` that row is written after the results
    loop and outside it, gated on nothing — not on ``succeeded``, not on
    ``failed``. A batch whose every result rolled back still gets one, and a
    batch whose OCR CLI returned nothing gets one with ``frame_count = 0``. So
    completion additionally requires that the extractions the segment claims
    are actually there (``extraction_count == frame_count``) and that at least
    one of them cleared its promoter (``transform_status='success'``).

    That count comparison is EXACT, not a lower bound. A surplus of extraction
    rows means the batch dir also holds output from an earlier, wider
    extraction, whose ``transform_status='success'`` rows would otherwise
    satisfy the promoter check on behalf of a current window that actually
    failed. Stale success must not authorise completion, so a surplus fails
    closed and is left for an operator to clear.

    Promoter *output* is checked through that status rather than by reading the
    per-screen domain tables: ``persistOneResult`` swallows a throwing promoter
    and records it as ``transform_status='error'`` on the extraction row, which
    makes the status the pipeline's own promotion verdict — and keeps Stage B
    from having to know the output table of all seven auto-eligible screens.

    When several batch rows share the key (a LEFT JOIN can fan out over
    segments) the closest match wins, so the report names the real discrepancy
    rather than an unrelated sibling row.
    """
    key = promotion_key(window)
    mine = [f for f in facts if f.key == key]
    if not mine:
        return [
            "no ocr_capture_batches row for this window's "
            f"(video_sha256, source_directory, run_id) = {list(key)!r}"
        ]

    best: list[str] | None = None
    for fact in mine:
        problems = _fact_problems(window, fact)
        if not problems:
            return []
        if best is None or len(problems) < len(best):
            best = problems
    return best or []


@dataclass(frozen=True)
class WindowCompletion:
    """One window's verdict against the database, with the reasons."""

    window: Window
    problems: tuple[str, ...]
    #: A capture batch row exists for this window's key. With ``complete``
    #: false this is the dangerous case the old predicate silently skipped.
    attempted: bool

    @property
    def complete(self) -> bool:
        return not self.problems


def assess_completion(
    windows: Sequence[Window], facts: Sequence[CompletionFact]
) -> list[WindowCompletion]:
    keys = {f.key for f in facts}
    return [
        WindowCompletion(
            window=w,
            problems=tuple(completion_problems(w, facts)),
            attempted=promotion_key(w) in keys,
        )
        for w in windows
    ]


def partition_complete(
    windows: Sequence[Window], facts: Sequence[CompletionFact]
) -> tuple[list[WindowCompletion], list[WindowCompletion]]:
    """(still pending, verified complete).

    A window with a capture batch but unverified output lands in *pending* —
    that is the whole point of the corrected predicate. It is carried as a
    :class:`WindowCompletion` so the plan can say why it is being re-run.
    """
    assessed = assess_completion(windows, facts)
    pending = [a for a in assessed if not a.complete]
    complete = [a for a in assessed if a.complete]
    return pending, complete


# ─── Plan ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ExecutionPlan:
    manifest_path: Path
    manifest_digest: str
    cache_root: Path
    total_windows: int
    decision_counts: dict[str, int]
    pending: tuple[Window, ...]
    verified_complete: tuple[Window, ...]
    artifacts: tuple[ArtifactCheck, ...]
    #: Pending windows that already have a capture batch row whose output did
    #: not verify. Under the old existence predicate these were skipped as
    #: "promoted"; they are now re-run, and named here with the reasons.
    retrying: tuple[WindowCompletion, ...] = ()
    #: The schema the manifest ACTUALLY declared, read from the document rather
    #: than assumed from this module's constant. Receipts record it, so a
    #: receipt names the contract that authorised it instead of the contract the
    #: binary happened to be compiled with.
    manifest_schema_version: int | None = SCHEMA_VERSION
    #: `policy.sampling_unpinnable`, verbatim: the non-auto windows the producer
    #: recorded as carrying no command because their source has no measurable
    #: grid. Surfaced in the plan so a `commands: null` an operator meets in the
    #: file is a stated refusal rather than an unexplained gap.
    unpinnable: tuple[dict[str, Any], ...] = ()

    @property
    def auto_total(self) -> int:
        return len(self.pending) + len(self.verified_complete)


def plan_rescue(
    *,
    manifest_path: Path,
    completion_facts: CompletionProbe,
) -> ExecutionPlan:
    """Everything that must succeed before a single subprocess may start.

    The order is load-bearing:

      1. parse the manifest,
      2. validate it COMPLETELY,
      3. filter to ``auto``,
      4. preflight that set's exact artifacts and abort the whole run if any is
         missing — this happens BEFORE ``completion_facts`` is called, so a
         broken manifest never reaches the database at all,
      5. only then read the database, to drop windows whose output is verifiably
         already there.
    """
    doc = load_manifest(manifest_path)
    digest = file_digest(manifest_path)
    require_valid_manifest(doc, source=manifest_path)

    windows = parse_windows(doc)
    decision_counts: dict[str, int] = {}
    for window in windows:
        decision_counts[window.decision] = decision_counts.get(window.decision, 0) + 1

    auto = executable_windows(windows)
    if not auto:
        # "Nothing to do" is the exact shape the cache-root reboot trap took, so
        # it is never reported as success. A manifest with zero auto windows is
        # not something Stage B can act on — the operator pointed at the wrong
        # file, or at a manifest whose whole auto set needs regenerating.
        raise RescueAborted(
            f"manifest holds no {DECISION_AUTO!r} windows: {manifest_path}\n"
            f"  {len(windows)} window(s) total "
            f"({', '.join(f'{k}={v}' for k, v in sorted(decision_counts.items())) or 'none'}).\n"
            "  There is nothing Stage B is permitted to execute. Refusing to report "
            "an empty run as success."
        )

    cache_root = Path(str(doc["cache_root"]))
    artifacts = required_artifacts(auto, cache_root)
    missing = missing_artifacts(artifacts)
    if missing:
        raise RescueAborted(_render_missing(missing, len(artifacts)))

    pending, complete = partition_complete(auto, list(completion_facts()))

    return ExecutionPlan(
        manifest_path=manifest_path,
        manifest_digest=digest,
        cache_root=cache_root,
        total_windows=len(windows),
        decision_counts=decision_counts,
        pending=tuple(a.window for a in pending),
        verified_complete=tuple(a.window for a in complete),
        artifacts=tuple(artifacts),
        retrying=tuple(a for a in pending if a.attempted),
        manifest_schema_version=doc.get("schema_version"),
        unpinnable=tuple((doc.get("policy") or {}).get(UNPINNABLE_LEDGER_KEY) or ()),
    )


# ─── Execution-environment preflight ─────────────────────────────────────────

#: The variables the pinned commands cannot run CORRECTLY without, each paired
#: with the reason it is required.
#:
#: The manifest pins argv, not an environment. ``subprocess.run`` in the CLI's
#: ``make_runner`` passes no ``env``, so ``pnpm --filter worker ingest-ocr``
#: inherits whatever shell Stage B was launched from — which makes that shell a
#: precondition exactly as real as the source video, and, until this gate, the
#: one precondition nothing checked.
#:
#: This list is deliberately SHORT. It is not "the keys in ``.env``"; it is the
#: keys this rescue's two subprocesses actually read. ``EA_CLUB_ID``,
#: ``POSTGRES_PASSWORD``, ``BETTER_AUTH_SECRET``, ``POLL_INTERVAL_MS`` and the
#: rest are never consulted on the ingest-ocr path, and requiring them would
#: turn this gate into superstition that refuses runs Stage B can finish.
#:
#: The two entries fail in opposite ways, which is why both are here:
#:
#: * ``DATABASE_URL`` fails LOUDLY. ``packages/db/src/client.ts`` throws at
#:   module import, so ingest-ocr dies before it connects and the window is
#:   correctly recorded as failed. The cost is wasted work and a spurious
#:   receipt — this is the defect that rescue-b2-20260805T031634Z demonstrated.
#: * ``OCR_PYTHON`` fails SILENTLY, which is worse. ``ocr-cli-runner.ts``
#:   resolves ``process.env.OCR_PYTHON ?? 'python3'``, and on the ingest box
#:   that bare fallback imports ``game_ocr`` and runs. Because ``runOcrCli``
#:   executes BEFORE the ``ocr_capture_batches`` insert, an unset value does not
#:   abort anything: it writes a complete batch — segment, extractions, the
#:   ``rescue-b2-anchor-v1`` tag and all — produced by an interpreter nobody
#:   chose. :func:`completion_problems` would then find that batch faultless and
#:   skip the window forever. A rescue whose entire premise is provenance cannot
#:   let the interpreter be decided by a fallback.
REQUIRED_EXECUTION_ENV: tuple[tuple[str, str], ...] = (
    (
        "DATABASE_URL",
        "packages/db/src/client.ts throws 'DATABASE_URL environment variable is "
        "required' at import, so ingest-ocr dies before it connects — after ffmpeg "
        "has already decoded the window",
    ),
    (
        "OCR_PYTHON",
        "apps/worker/src/ocr-cli-runner.ts falls back to bare 'python3' SILENTLY, and "
        "that fallback runs BEFORE the ocr_capture_batches insert — so an unset value "
        f"does not fail the run, it writes a {RESCUE_DECODER_VERSION!r} batch from an "
        "interpreter nobody chose",
    ),
)


def environment_problems(environ: Mapping[str, str]) -> list[str]:
    """Every required variable that is absent or blank. **Names only.**

    A value is never echoed, never logged and never compared against anything
    but emptiness. ``DATABASE_URL`` carries the database password, and a
    diagnostic that gets printed to a terminal, piped into a log or pasted into
    a handoff note must not carry it too.

    Presence and non-emptiness are the whole claim. This gate does not connect,
    does not stat the interpreter and does not resolve anything — consistent
    with :mod:`video_ingest.cache_root`, this module VALIDATES, it never
    RESOLVES. Blank is treated as absent because set-but-whitespace is a
    misconfiguration, not a configuration: ``packages/db`` would read a
    whitespace URL as truthy and fail later, deeper and far less legibly.
    """
    problems: list[str] = []
    for name, why in REQUIRED_EXECUTION_ENV:
        value = environ.get(name)
        if value is None:
            problems.append(f"{name}: not set — {why}")
        elif not value.strip():
            problems.append(f"{name}: set but empty — {why}")
    return problems


def _render_env_problems(problems: Sequence[str]) -> str:
    lines = [
        f"execution environment UNUSABLE: {len(problems)} required variable(s) "
        "missing or empty.",
        "  Stage B aborted BEFORE it created a batch directory, BEFORE ffmpeg, BEFORE",
        "  ingest-ocr and BEFORE any receipt was written. Nothing ran, nothing was",
        "  written, and the run remains fully resumable.",
    ]
    lines += [f"    - {p}" for p in problems]
    lines += [
        "  Load the repository environment into the shell, then re-run:",
        "      set -a && source /path/to/eanhl-team-website/.env && set +a",
        "  (Only variable NAMES appear above — no value is read into this message.)",
    ]
    return "\n".join(lines)


def require_execution_env(environ: Mapping[str, str] | None = None) -> None:
    """Abort unless the subprocesses about to be spawned can actually work.

    ``None`` means :data:`os.environ` — the real environment the children will
    inherit, so the gate checks exactly what they get rather than a copy of it.
    A mapping is injected in tests, keeping this as unit-testable as every other
    policy function here.
    """
    problems = environment_problems(os.environ if environ is None else environ)
    if problems:
        raise RescueAborted(_render_env_problems(problems))


# ─── Execution ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stderr: str = ""


#: ``run_command(argv) -> CommandResult``. Injected so every test in this
#: module's suite runs the real gate against a recorder rather than ffmpeg.
RunCommand = Callable[[Sequence[str]], CommandResult]

#: ``list_files(directory) -> tuple[str, ...]``. The names of the FILES in a
#: directory, sorted; subdirectories are excluded (the staging directory lives
#: inside the batch directory and is not an output). Injected for the same
#: reason as ``run_command``; the default is the real filesystem.
DirLister = Callable[[Path], "tuple[str, ...]"]

#: ``publish(staging, batch_dir, names) -> None``. Moves the verified outputs of
#: one ffmpeg invocation out of staging and into the batch directory the pinned
#: ``ingest-ocr`` will read.
OutputPublisher = Callable[[Path, Path, Sequence[str]], None]


def list_output_files(directory: Path) -> tuple[str, ...]:
    """The file names in a directory, sorted. A missing directory is empty.

    A missing directory is ``()`` rather than an error: "ffmpeg produced
    nothing" and "ffmpeg produced nothing and did not even create the tree" are
    the same failure and are both caught by comparing against the expected set.
    """
    try:
        return tuple(sorted(p.name for p in directory.iterdir() if p.is_file()))
    except OSError:
        return ()


def publish_staged_outputs(staging: Path, batch_dir: Path, names: Sequence[str]) -> None:
    """Move this invocation's verified outputs into the batch directory.

    ``os.replace`` per file: staging is a subdirectory of the batch dir, so this
    is always a same-filesystem rename and never a copy. The set is not published
    atomically — nothing on a POSIX filesystem makes a multi-file publish atomic —
    but it does not need to be, because the caller re-lists the batch directory
    afterwards and requires the exact expected set. A publish interrupted halfway
    therefore fails the window rather than feeding ``ingest-ocr`` a partial batch.
    """
    batch_dir.mkdir(parents=True, exist_ok=True)
    for name in names:
        os.replace(staging / name, batch_dir / name)


def expected_output_frames(window: Window) -> int | None:
    """How many frames this window's pinned selection must produce.

    ``None`` only when the metadata is absent or malformed — which
    :func:`command_problems` has already refused, so a window that reaches
    execution always has a number.
    """
    commands = window.commands if isinstance(window.commands, dict) else {}
    sampling = commands.get("sampling")
    if not isinstance(sampling, dict):
        return None
    try:
        return int(sampling["expected_frame_count"])
    except (KeyError, TypeError, ValueError):
        return None


def _render_set(names: Sequence[str], limit: int = 8) -> str:
    shown = ", ".join(names[:limit])
    if len(names) > limit:
        shown += f", … (+{len(names) - limit})"
    return shown or "<empty>"


@dataclass(frozen=True)
class OutputProof:
    """The verdict of proving one ffmpeg invocation's outputs, and why.

    ``ok`` means: the staging directory was EMPTY immediately before ffmpeg ran,
    and immediately afterwards it held exactly the expected numbered files and
    nothing else. Under those two facts every published frame is provably a
    product of this invocation — which a count of the batch directory can never
    establish, because a complete stale set keeps its count when the current
    command writes nothing.
    """

    ok: bool
    staged: tuple[str, ...] = ()
    error: str | None = None


def prove_staging_empty(staging: Path, *, list_files: DirLister) -> OutputProof:
    """Precondition: nothing may be in staging before ffmpeg runs.

    A non-empty staging directory is residue from an interrupted run. It is
    reported, never cleaned: this executor does not delete rescue artefacts, and
    a directory it silently emptied would be one whose previous contents nobody
    got to look at.
    """
    present = list_files(staging)
    if present:
        return OutputProof(
            ok=False,
            error=(
                f"the staging directory {staging} is not empty before ffmpeg runs — it "
                f"holds {len(present)} file(s) [{_render_set(present)}] left by an "
                "interrupted run. Outputs of the CURRENT invocation cannot be told "
                "apart from those, so nothing was executed for this window. Inspect "
                "and remove that directory, then re-run."
            ),
        )
    return OutputProof(ok=True)


def prove_current_outputs(
    staging: Path, *, expected: Sequence[str], list_files: DirLister
) -> OutputProof:
    """Postcondition: staging holds EXACTLY the expected files and nothing else.

    Set equality, not a count, and not a hash or an mtime:

    * **missing** — ``-frames:v N`` is a CEILING, not a floor. When a selected
      source timestamp matches nothing (a moved cache, a re-encoded video, a
      window planned against the wrong grid) the bounded decode simply ends and
      ffmpeg exits 0 having written fewer files;
    * **surplus** — an extra file means the invocation produced something the
      pinned selection does not name, and ``ingest-ocr`` would OCR it as if the
      manifest had authorised it;
    * **misnamed** — a file that is neither missing nor surplus by count but not
      one of ``%05d.png``'s outputs did not come from this pattern at all.
    """
    produced = list_files(staging)
    want = tuple(expected)
    if produced == want:
        return OutputProof(ok=True, staged=produced)

    missing = [n for n in want if n not in set(produced)]
    surplus = [n for n in produced if n not in set(want)]
    return OutputProof(
        ok=False,
        staged=produced,
        error=(
            f"ffmpeg exited 0 but the frames it wrote into {staging} are not the "
            f"{len(want)} its pinned selection names.\n"
            f"      expected : {_render_set(want)}\n"
            f"      produced : {_render_set(produced)}\n"
            f"      missing  : {_render_set(missing)}\n"
            f"      surplus  : {_render_set(surplus)}\n"
            "      Staging was verified empty immediately before this invocation, so "
            "this is what the CURRENT command produced — not what an earlier run left "
            "behind. Nothing was published and nothing was ingested."
        ),
    )


def prove_publishable(
    batch_dir: Path, *, expected: Sequence[str], list_files: DirLister
) -> OutputProof:
    """Precondition for publishing: the batch dir holds nothing foreign.

    Every file already in the batch directory must be one of the names this
    invocation is about to publish over. Those are replaced — their prior content
    is irrelevant, because the frames replacing them were just proven to be this
    invocation's — which is what keeps a retry of an incomplete window working
    without any deletion.

    Anything else (a stray file, a leftover from a differently-sized selection)
    would survive the publish and end up in the batch that ``ingest-ocr`` reads,
    so it fails closed and names the files.
    """
    present = list_files(batch_dir)
    foreign = [n for n in present if n not in set(expected)]
    if foreign:
        return OutputProof(
            ok=False,
            error=(
                f"the batch directory {batch_dir} holds {len(foreign)} file(s) this run "
                f"did not produce [{_render_set(foreign)}]. Publishing over them would "
                "hand ingest-ocr a batch mixing this invocation's frames with an earlier "
                "one's. Nothing was published. Inspect that directory and remove the "
                "stale files, then re-run."
            ),
        )
    return OutputProof(ok=True)


def prove_published(
    batch_dir: Path, *, expected: Sequence[str], list_files: DirLister
) -> OutputProof:
    """Postcondition for publishing: the batch dir is exactly the expected set."""
    present = list_files(batch_dir)
    if present == tuple(expected):
        return OutputProof(ok=True, staged=present)
    return OutputProof(
        ok=False,
        staged=present,
        error=(
            f"after publishing, {batch_dir} holds {_render_set(present)} rather than "
            f"the expected {_render_set(tuple(expected))}. The batch ingest-ocr would "
            "read is not the one the manifest authorised. Nothing was ingested."
        ),
    )


@dataclass
class WindowOutcome:
    window: Window
    status: str
    steps: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    #: True only once :func:`completion_problems` came back empty *after* the
    #: commands ran. A window is never reported promoted without this.
    verified: bool = False
    #: Why verification failed, when it did.
    completion_problems: list[str] = field(default_factory=list)


@dataclass
class ExecutionReport:
    executed: bool
    rescue_run_id: str
    promoted: list[WindowOutcome] = field(default_factory=list)
    failed: list[WindowOutcome] = field(default_factory=list)
    not_attempted: list[Window] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failed and not self.not_attempted


def argv_fingerprint(argv: Sequence[str]) -> str:
    """SHA-256 over the argv exactly as the manifest pinned it.

    Recorded per step so a receipt proves *which* command produced a row, not
    merely that some rescue ran.
    """
    return hashlib.sha256(
        json.dumps(list(argv), ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def build_receipt(
    plan: ExecutionPlan,
    outcome: WindowOutcome,
    *,
    rescue_run_id: str,
    executed_at: str,
) -> dict[str, Any]:
    """The durable provenance row for one executed window.

    Carries every handle the rollback design depends on: the schema and decoder
    versions, the rescue batch dir and run id that together form the promotion
    key, the manifest digest that authorised it, and a fingerprint per command.

    ``schema_version`` is the MANIFEST's, not this module's constant. The ledger
    is append-only and already holds schema-2 receipts from runs authorised by
    the schema-2 manifest; those stay exactly as written and stay valid. What a
    new receipt must not do is stamp a version it did not read — so the value
    comes from the document the plan was built from, and a reader can tell which
    sampling contract produced any given row.
    """
    window = outcome.window
    commands = window.commands or {}
    return {
        "schema_version": plan.manifest_schema_version,
        "decoder_version": RESCUE_DECODER_VERSION,
        "rescue_run_id": rescue_run_id,
        "executed_at": executed_at,
        "manifest_path": str(plan.manifest_path),
        "manifest_sha256": plan.manifest_digest,
        "cache_root": str(plan.cache_root),
        "video_sha256": window.video_sha256,
        "segment_index": window.segment_index,
        "target_screen": window.target_screen,
        "match_id": window.match_id,
        "run_id": window.run_id,
        "batch_dir": commands.get("batch_dir"),
        "t0": window.t0,
        "t1": window.t1,
        "promotion_key": list(promotion_key(window)),
        "segment_key": expected_segment_key(window),
        "status": outcome.status,
        # Why it failed, durably. A window can fail before the database is ever
        # consulted — an unprovable output set stops the run between ffmpeg and
        # ingest-ocr — and `completion_problems` is empty in exactly that case,
        # so without this the ledger would record a failure with no reason.
        "error": outcome.error,
        # A receipt asserts nothing it did not check: this is the verdict of
        # `completion_problems` re-run against the database after the commands.
        "completion_verified": outcome.verified,
        "completion_problems": outcome.completion_problems,
        "steps": outcome.steps,
    }


def execute_plan(
    plan: ExecutionPlan,
    *,
    run_command: RunCommand,
    completion_facts: CompletionProbe,
    rescue_run_id: str,
    executed_at: str,
    receipt_sink: Callable[[dict[str, Any]], None] | None = None,
    make_batch_dir: Callable[[Path], None] | None = None,
    environ: Mapping[str, str] | None = None,
    list_files: DirLister = list_output_files,
    publish_outputs: OutputPublisher = publish_staged_outputs,
) -> ExecutionReport:
    """Run the pending windows' pinned argv, in order, failing fast.

    The environment preflight is the FIRST statement, ahead of the loop and
    therefore ahead of every mutation this module is capable of: the batch
    directory, ffmpeg, ingest-ocr and the receipt sink are all reached from
    inside that loop. Placing it here rather than in :func:`run_rescue` means no
    caller can route around it — the guard lives at the mutation boundary, in
    the same spirit as :func:`assert_executable`.

    Between ffmpeg and ingest-ocr sits a TRANSACTION, and it is the reason
    ffmpeg never writes into the batch directory itself:

      a. staging (``<batch_dir>/.staging``) is proven EMPTY;
      b. ffmpeg runs, writing only there;
      c. staging is proven to hold exactly the expected ``%05d.png`` set;
      d. the batch directory is proven to hold nothing foreign;
      e. the files are moved across and the batch directory is re-proven;
      f. only then does ``ingest-ocr`` see anything.

    (a) plus (c) is the per-invocation proof. A count of the batch directory
    cannot make that claim: a directory already holding a complete stale set
    keeps its count when the current ffmpeg writes nothing, and the old gate
    passed on exactly that. Nothing here depends on mtimes, inode reuse or file
    content — only on the fact that a directory verified empty and then written
    to by one process contains that process's output and nothing else.

    Every window is verified against the database *after* its commands return,
    with the same :func:`completion_problems` predicate that decided it was
    pending. A zero exit is treated as a claim, not as proof: ``ingest-ocr``
    exits 0 whether it wrote everything, some of it or none of it, so the
    postcondition — not the return code — is what promotes a window.

    Fail-fast rather than best-effort: a window that dies mid-way leaves a
    partially populated batch dir, and continuing would pile more of those up
    before anyone reads the error. Stopping keeps the blast radius at one
    window, and the run is resumable precisely because every window that DID
    complete now satisfies the predicate and will be filtered out of the next
    plan by :func:`partition_complete` — while one that merely *started* will
    not be, and gets re-run.
    """
    require_execution_env(environ)

    report = ExecutionReport(executed=True, rescue_run_id=rescue_run_id)
    pending = list(plan.pending)

    for i, window in enumerate(pending):
        assert_executable(window)
        commands = window.commands or {}
        outcome = WindowOutcome(window=window, status=OUTCOME_PROMOTED)

        batch_dir = Path(str(commands["batch_dir"]))
        staging = Path(rescue_staging_dir(str(commands["batch_dir"])))
        frame_count = expected_output_frames(window)
        expected_names = (
            expected_output_names(frame_count) if frame_count is not None else ()
        )

        # (a) Staging must be empty BEFORE ffmpeg, and it is proven so before
        #     the directory is even created — a directory this run creates is
        #     empty by construction, and one that already existed is the case
        #     that has to be caught.
        proof = prove_staging_empty(staging, list_files=list_files)
        if not proof.ok:
            outcome.status = OUTCOME_FAILED
            outcome.error = proof.error
        elif frame_count is None or frame_count < 1:
            # Zero is refused as loudly as absent: an empty expected set would
            # make the produced-set proof vacuously true against an empty staging
            # directory, which is the one way this gate could pass without
            # proving anything. `plan_sampling` cannot produce it and
            # `command_problems` recomputes it, so reaching here means the
            # metadata was hand-edited.
            outcome.status = OUTCOME_FAILED
            outcome.error = (
                f"the pinned commands declare expected_frame_count={frame_count!r}, so "
                "the outputs of this invocation cannot be proven. Nothing was executed."
            )

        if outcome.status != OUTCOME_FAILED and make_batch_dir is not None:
            make_batch_dir(batch_dir)
            make_batch_dir(staging)

        for step in STEP_ORDER:
            if outcome.status == OUTCOME_FAILED:
                break
            argv = list(commands[step])
            result = run_command(argv)
            entry: dict[str, Any] = {
                "step": step,
                "argv": argv,
                "fingerprint": argv_fingerprint(argv),
                "returncode": result.returncode,
            }
            outcome.steps.append(entry)
            if result.returncode != 0:
                outcome.status = OUTCOME_FAILED
                outcome.error = (
                    f"{step} exited {result.returncode}"
                    + (f": {result.stderr.strip()}" if result.stderr.strip() else "")
                )
                break

            if step != STEP_FFMPEG:
                continue

            # (c) What THIS invocation produced, proven against an empty start.
            produced = prove_current_outputs(
                staging, expected=expected_names, list_files=list_files
            )
            entry["expected_frames"] = frame_count
            entry["expected_output_names"] = list(expected_names)
            entry["staged_output_names"] = list(produced.staged)
            entry["output_frames"] = len(produced.staged)
            if not produced.ok:
                outcome.status = OUTCOME_FAILED
                outcome.error = produced.error
                break

            # (d) and (e): publish, with the batch dir proven clean either side.
            publishable = prove_publishable(
                batch_dir, expected=expected_names, list_files=list_files
            )
            if not publishable.ok:
                outcome.status = OUTCOME_FAILED
                outcome.error = publishable.error
                break
            publish_outputs(staging, batch_dir, expected_names)
            published = prove_published(
                batch_dir, expected=expected_names, list_files=list_files
            )
            entry["published_output_names"] = list(published.staged)
            if not published.ok:
                outcome.status = OUTCOME_FAILED
                outcome.error = published.error
                break

        # The postcondition. Runs before the window is called promoted, before
        # a receipt is written and before the next window is touched — because
        # every one of those would otherwise record a success nobody checked.
        if outcome.status != OUTCOME_FAILED:
            problems = completion_problems(window, list(completion_facts()))
            outcome.completion_problems = problems
            outcome.verified = not problems
            if problems:
                outcome.status = OUTCOME_FAILED
                outcome.error = (
                    "both commands exited 0 but the window's output is NOT in the "
                    "database — postcondition unsatisfied: " + "; ".join(problems)
                )

        if receipt_sink is not None:
            receipt_sink(
                build_receipt(
                    plan, outcome, rescue_run_id=rescue_run_id, executed_at=executed_at
                )
            )

        if outcome.status == OUTCOME_FAILED:
            report.failed.append(outcome)
            report.not_attempted = pending[i + 1 :]
            return report
        report.promoted.append(outcome)

    return report


# ─── Rendering ───────────────────────────────────────────────────────────────

DRY_RUN_BANNER = (
    "\n"
    "╔══════════════════════════════════════════════════════════════════════════╗\n"
    "║  DRY RUN — NOTHING WAS EXECUTED AND NO DATABASE ROW WAS WRITTEN.         ║\n"
    "║  0 ffmpeg invocations · 0 ingest-ocr invocations · 0 rows.               ║\n"
    f"║  Pass {EXECUTE_FLAG} to promote the window(s) listed above.                    ║\n"
    "╚══════════════════════════════════════════════════════════════════════════╝"
)


def render_plan(plan: ExecutionPlan, *, out: Callable[[str], None]) -> None:
    out("")
    out("═══ RESCUE EXECUTION PLAN (Stage B) ═══")
    out(f"manifest    : {plan.manifest_path}")
    out(f"sha256      : {plan.manifest_digest}")
    out(f"cache root  : {plan.cache_root}")
    out(f"decoder tag : {RESCUE_DECODER_VERSION}")
    out("")
    out(f"manifest windows : {plan.total_windows}")
    for decision, n in sorted(plan.decision_counts.items()):
        marker = "  <- executable" if decision == DECISION_AUTO else "  (never executed)"
        out(f"  {decision:8s} {n:5d}{marker}")
    if plan.unpinnable:
        # Never silent: these windows carry no command because their source has
        # no measurable grid. They are all non-auto (the validator refuses a
        # ledger that names an auto window), so they were never executable — but
        # an operator reading `commands: null` deserves to know it is a recorded
        # refusal rather than a window nobody ever pinned.
        out("")
        out(
            f"unpinnable sources : {len(plan.unpinnable)} non-auto window(s) carry no "
            "command (policy.sampling_unpinnable)"
        )
        for entry in plan.unpinnable:
            out(
                f"    · {str(entry.get('video_sha256') or '')[:12]}/"
                f"seg{entry.get('segment_index')} {entry.get('decision')} "
                f"{entry.get('reason')}"
            )
    out("")
    out(
        f"artifact preflight : {len(plan.artifacts)} path(s) present "
        "(all-or-nothing — one missing aborts the whole run)"
    )
    out(f"verified complete  : {len(plan.verified_complete)} auto window(s) — skipped")
    for window in plan.verified_complete:
        out(
            f"    · {window.video_sha256[:12]}/seg{window.segment_index} "
            f"match {window.match_id} run {window.run_id} {window.target_screen}"
        )
    if plan.retrying:
        out(
            f"incomplete, RE-RUN : {len(plan.retrying)} auto window(s) have a capture "
            "batch whose output does not verify"
        )
        for assessed in plan.retrying:
            window = assessed.window
            out(
                f"    · {window.video_sha256[:12]}/seg{window.segment_index} "
                f"match {window.match_id} run {window.run_id} {window.target_screen}"
            )
            for problem in assessed.problems:
                out(f"        - {problem}")
    out(f"to execute         : {len(plan.pending)} auto window(s)")
    for window in plan.pending:
        out(
            f"    · {window.video_sha256[:12]}/seg{window.segment_index} "
            f"match {window.match_id} run {window.run_id} {window.target_screen} "
            f"[{window.t0:.3f}..{window.t1:.3f}]s"
        )


def render_report(report: ExecutionReport, *, out: Callable[[str], None]) -> None:
    out("")
    out("═══ RESCUE EXECUTION REPORT ═══")
    out(f"rescue run id : {report.rescue_run_id}")
    out(f"promoted      : {len(report.promoted)} (each verified in the database, not assumed)")
    out(f"failed        : {len(report.failed)}")
    out(f"not attempted : {len(report.not_attempted)} (run stopped at the first failure)")
    for outcome in report.failed:
        window = outcome.window
        out(
            f"  FAILED {window.video_sha256[:12]}/seg{window.segment_index} "
            f"match {window.match_id}: {outcome.error}"
        )
    if not report.ok:
        out("")
        out(
            "  Execution is fail-fast, NOT all-or-nothing: the "
            f"{len(report.promoted)} window(s) listed as promoted above ran before the "
            "failure and their rows are in the database. They are verified complete, so "
            "re-running this manifest will skip them and resume at the failure."
        )
    out("")
    out(
        f"Rollback handles: ocr_capture_batches.source_directory LIKE '%{RESCUE_DIR_MARKER}%' "
        f"· ocr_segments.decoder_version = '{RESCUE_DECODER_VERSION}'"
    )


def run_rescue(
    *,
    manifest_path: Path,
    execute: bool,
    completion_facts: CompletionProbe,
    run_command: RunCommand,
    rescue_run_id: str,
    executed_at: str,
    receipt_sink: Callable[[dict[str, Any]], None] | None = None,
    make_batch_dir: Callable[[Path], None] | None = None,
    environ: Mapping[str, str] | None = None,
    list_files: DirLister = list_output_files,
    publish_outputs: OutputPublisher = publish_staged_outputs,
    out: Callable[[str], None] = print,
) -> int:
    """Plan always; execute only under the explicit opt-in. Returns an exit code.

    ``execute=False`` is the default everywhere it is exposed, and on that path
    ``run_command`` is never called — not for a probe, not for a dry ffmpeg, not
    for anything. ``completion_facts`` IS called: it is a read-only SELECT, and
    without it the dry run could not tell a finished window from a half-written
    one, which is the entire point of reading the plan before opting in.

    A dry run therefore needs no execution environment and is never gated on
    one. It spawns nothing, and refusing it would confiscate the very command an
    operator reaches for when the environment is what is broken. The gate lives
    in :func:`execute_plan`, which a dry run does not reach — and neither does a
    run whose windows are all verified complete, since it will execute nothing
    either. The scope is actual execution, not the ``--execute`` flag.
    """
    plan = plan_rescue(manifest_path=manifest_path, completion_facts=completion_facts)
    render_plan(plan, out=out)

    if not execute:
        out(DRY_RUN_BANNER)
        return 0

    if not plan.pending:
        out("")
        out(
            f"NOTHING TO EXECUTE: all {plan.auto_total} auto window(s) are already "
            "VERIFIED COMPLETE in the database. No command was run."
        )
        return 0

    report = execute_plan(
        plan,
        run_command=run_command,
        completion_facts=completion_facts,
        rescue_run_id=rescue_run_id,
        executed_at=executed_at,
        receipt_sink=receipt_sink,
        make_batch_dir=make_batch_dir,
        environ=environ,
        list_files=list_files,
        publish_outputs=publish_outputs,
    )
    render_report(report, out=out)
    return 0 if report.ok else 1
