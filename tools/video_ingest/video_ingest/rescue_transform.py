"""The one-off schema-2 -> schema-3 rescue-manifest transform, and its diff.

**Why a transform and not a regeneration.** The live manifest is not a derived
artefact any more. Its 303 windows carry hand-adjudicated identity decisions —
19 individually confirmed lookback frames, four deliberately unassociated
duplicate recordings, one never-ingested match — and 18 of its 97 auto windows
have already been executed, verified against the database and receipted against
that file's exact SHA-256. Regenerating would re-derive every one of those
decisions from a cache and a database that have both moved since, and would
silently renumber segment indices if any window count shifted. The only change
actually required is the sampling contract, so the only change made is the
sampling contract.

**What that costs, and how it is paid.** A transform can lie in ways a
regeneration cannot: it can quietly alter a field nobody re-derives. So the
transform is paired with :func:`semantic_diff`, which is not a narration of what
happened but a CHECK — it recomputes the promotion key and the completion-gate
fields on both sides and reports ``ok: False`` if any of them moved. The tool's
own output is therefore verifiable independently of the tool.

The safety properties, stated exactly:

* the input document is deep-copied before anything is read out of it, and is
  never mutated (:func:`transform_document` is pure);
* only a schema-2 document is accepted — running it twice is refused, not
  silently idempotent;
* an unpinnable source is handled ASYMMETRICALLY, by the same
  :func:`~video_ingest.rescue_manifest.pin_or_drop` the generator uses: an
  **auto** window that cannot be pinned refuses the whole transform, because an
  auto window is executable and may already have been executed; a **review** or
  **skip** window — never executable — has its command dropped and the drop
  recorded in ``policy.sampling_unpinnable``, and :func:`semantic_diff` licenses
  the disappearance only for windows named there. An earlier draft of this
  docstring claimed every unprobeable command refused the whole transform; that
  was never what the code did, and it is not what the generator does either;
* it is deterministic: no timestamp, no ordering that depends on iteration
  order, so a reviewer can reproduce the candidate digest byte for byte.

The IO shell — the digest gate, the refusal to overwrite, the ffprobe — lives in
``scripts/transform_rescue_manifest.py``. Everything here is pure.
"""

from __future__ import annotations

import copy
from typing import Any, Callable, Mapping, Sequence

from video_ingest.rescue_manifest import (
    DECISION_AUTO,
    SCHEMA_VERSION,
    UNPINNABLE_LEDGER_KEY,
    pin_or_drop,
    rescue_output_pattern,
    sampling_policy,
)
from video_ingest.rescue_sampling import (
    FramePtsProbe,
    SourceGrid,
    canonical_ffmpeg_argv,
    observe_plan,
    plan_sampling,
    sampling_to_dict,
)

#: The only input schema this one-off understands.
LEGACY_SCHEMA_VERSION = 2

#: The command key schema 2 used to describe its sampling. Its presence anywhere
#: in a candidate is a transform failure.
LEGACY_SAMPLING_KEY = "sample_fps"

#: Window fields the transform has no licence to touch. Between them they carry
#: every window's identity, its decision, its geometry and its evidence.
PRESERVED_WINDOW_FIELDS: tuple[str, ...] = (
    "video_sha256",
    "video_path",
    "video_path_exists",
    "segment_index",
    "target_screen",
    "t0",
    "t1",
    "reel_index",
    "reel_mode",
    "match_id",
    "run_id",
    "decision",
    "reason",
    "frame_count",
    "evidence",
)

#: Command fields likewise. ``batch_dir`` is half the promotion key and the
#: rollback handle; ``ingest_ocr`` carries the run id, the segment index, the
#: bounds and the decoder tag that the completion gate compares against.
PRESERVED_COMMAND_FIELDS: tuple[str, ...] = ("batch_dir", "notes", "ingest_ocr")

#: The fields :func:`video_ingest.rescue_execute.completion_problems` compares a
#: database row against. If any of these moved, an already-promoted window would
#: stop verifying and be re-run — or, worse, a different window's rows would
#: satisfy it.
COMPLETION_GATE_FIELDS: tuple[str, ...] = (
    "video_sha256",
    "segment_index",
    "target_screen",
    "match_id",
    "run_id",
    "t0",
    "t1",
)

#: ``grid_for(video_path) -> SourceGrid``. Injected so the transform is testable
#: with no ffprobe and no video, and so the probe's failure mode is the caller's
#: to define.
GridLookup = Callable[[str], SourceGrid]


class TransformRefused(RuntimeError):
    """The transform will not run on this input. Carries an operator message."""


def _rebuild_commands(
    window: Mapping[str, Any],
    commands: Mapping[str, Any],
    grid: SourceGrid,
    probe_frames: FramePtsProbe,
) -> dict[str, Any]:
    """One window's command object under the new contract.

    Everything except the sampling block and the ffmpeg argv is copied through
    verbatim, key order preserved, so a diff of the result names exactly the two
    things that were allowed to move (plus the one that was removed).

    The plan is OBSERVED against the real source before it is serialised, so a
    transformed command carries the same measurement a freshly generated one
    does — there is no cheaper path to a pinned command through this tool than
    through the generator.
    """
    plan = observe_plan(
        plan_sampling(
            evidence_timestamps=[float(e["t"]) for e in window["evidence"]],
            t0=float(window["t0"]),
            t1=float(window["t1"]),
            grid=grid,
        ),
        video_path=str(window["video_path"]),
        probe_frames=probe_frames,
    )
    batch_dir = str(commands["batch_dir"])
    rebuilt: dict[str, Any] = {}
    for key, value in commands.items():
        if key == LEGACY_SAMPLING_KEY:
            rebuilt["sampling"] = sampling_to_dict(plan)
        elif key == "ffmpeg":
            rebuilt["ffmpeg"] = canonical_ffmpeg_argv(
                video_path=str(window["video_path"]),
                output_pattern=rescue_output_pattern(batch_dir),
                plan=plan,
            )
        else:
            rebuilt[key] = copy.deepcopy(value)
    if "sampling" not in rebuilt:
        rebuilt["sampling"] = sampling_to_dict(plan)
    return rebuilt


def transform_document(
    doc: Mapping[str, Any],
    *,
    grid_for: GridLookup,
    probe_frames: FramePtsProbe,
    input_digest: str,
) -> dict[str, Any]:
    """A schema-3 candidate for a schema-2 manifest. Pure; never mutates ``doc``.

    Raises :class:`TransformRefused` on a document this one-off does not
    describe, and
    :class:`~video_ingest.rescue_manifest.AutoWindowUnpinnable` when an
    EXECUTABLE window's source cannot be pinned — all-or-nothing, so a partially
    transformed candidate is never produced. A non-executable window's command is
    dropped and enumerated instead; see
    :func:`~video_ingest.rescue_manifest.pin_or_drop` for the single statement of
    that asymmetry, which the generator shares.
    """
    if doc.get("schema_version") != LEGACY_SCHEMA_VERSION:
        raise TransformRefused(
            f"this transform consumes schema_version {LEGACY_SCHEMA_VERSION} only; "
            f"got {doc.get('schema_version')!r}. It is a one-off, not an idempotent "
            "migration — re-running it on its own output is a mistake, not a no-op."
        )

    out = copy.deepcopy(dict(doc))
    out["schema_version"] = SCHEMA_VERSION

    grids: dict[str, SourceGrid] = {}
    unpinnable: list[dict[str, Any]] = []

    for window in out.get("windows") or []:
        commands = window.get("commands")
        if not isinstance(commands, dict):
            continue  # nothing pinned; nothing to re-pin
        path = str(window["video_path"])

        def build(window=window, commands=commands, path=path) -> dict[str, Any]:
            if path not in grids:
                grids[path] = grid_for(path)
            return _rebuild_commands(window, commands, grids[path], probe_frames)

        rebuilt, entry = pin_or_drop(
            build=build,
            decision=window.get("decision"),
            video_sha256=window.get("video_sha256"),
            segment_index=window.get("segment_index"),
            video_path=path,
            reason=window.get("reason"),
            where=f"{str(window.get('video_sha256') or '')[:12]}/seg{window.get('segment_index')}",
        )
        window["commands"] = rebuilt
        if entry is not None:
            unpinnable.append(entry)

    policy = dict(out.get("policy") or {})
    pinned = [w for w in (out.get("windows") or []) if isinstance(w.get("commands"), dict)]
    policy.update(
        sampling_policy(
            source_grids={
                str(w["video_sha256"]): grids[str(w["video_path"])].rate.text for w in pinned
            },
            source_pts_origins={
                str(w["video_sha256"]): grids[str(w["video_path"])].origin_s for w in pinned
            },
            unpinnable=unpinnable,
        )
    )
    # Provenance, and deterministic: the digest of the exact bytes this candidate
    # was derived from. No timestamp — a timestamp would make the candidate
    # irreproducible and its digest unverifiable by a second pair of eyes.
    policy["transformed_from_manifest_sha256"] = input_digest
    out["policy"] = policy
    return out


# ─── The semantic diff ───────────────────────────────────────────────────────


def _window_key(window: Mapping[str, Any]) -> list[Any]:
    return [window.get("video_sha256"), window.get("segment_index")]


def _promotion_key(window: Mapping[str, Any]) -> list[Any]:
    commands = window.get("commands")
    batch_dir = commands.get("batch_dir") if isinstance(commands, dict) else None
    return [window.get("video_sha256"), batch_dir, window.get("run_id")]


def _completion_gate(window: Mapping[str, Any]) -> list[Any]:
    return [window.get(f) for f in COMPLETION_GATE_FIELDS]


def _key_diff(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "added": sorted(set(after) - set(before)),
        "removed": sorted(set(before) - set(after)),
        "changed": sorted(k for k in set(before) & set(after) if before[k] != after[k]),
    }


def semantic_diff(
    before: Mapping[str, Any], after: Mapping[str, Any]
) -> dict[str, Any]:
    """A machine-checkable statement of what moved between two manifests.

    ``ok`` is the whole verdict and it is conservative: it is true only when the
    window count, the window order, every preserved window field, every
    preserved command field, every promotion key and every completion-gate field
    are identical, and the only command keys that moved are the three this
    transform is licensed to move. Anything else lands in ``violations``.
    """
    violations: list[str] = []

    b_windows: Sequence[Mapping[str, Any]] = list(before.get("windows") or [])
    a_windows: Sequence[Mapping[str, Any]] = list(after.get("windows") or [])

    count = {"before": len(b_windows), "after": len(a_windows)}
    if count["before"] != count["after"]:
        violations.append(
            f"window count changed: {count['before']} -> {count['after']}"
        )

    b_order = [_window_key(w) for w in b_windows]
    a_order = [_window_key(w) for w in a_windows]
    order_identical = b_order == a_order
    if not order_identical:
        violations.append("window identity/ordering changed")

    top = _key_diff(before, after)
    if top["added"] or top["removed"]:
        violations.append(f"top-level keys moved: +{top['added']} -{top['removed']}")
    for key in top["changed"]:
        if key not in ("schema_version", "policy", "windows"):
            violations.append(f"top-level {key!r} changed")

    policy = _key_diff(before.get("policy") or {}, after.get("policy") or {})
    if policy["removed"]:
        violations.append(f"policy keys removed: {policy['removed']}")
    for key in policy["changed"]:
        violations.append(f"policy.{key} changed")

    # Windows the candidate itself declares it could not pin. A command may
    # disappear only if it is named here — and only if it was never executable.
    ledger = (after.get("policy") or {}).get(UNPINNABLE_LEDGER_KEY)
    licensed_drops: set[tuple[Any, Any]] = set()
    if isinstance(ledger, list):
        for entry in ledger:
            if not isinstance(entry, dict):
                violations.append("policy.sampling_unpinnable holds a non-object entry")
                continue
            if entry.get("decision") == DECISION_AUTO:
                violations.append(
                    "policy.sampling_unpinnable names an auto window "
                    f"({entry.get('video_sha256', '')[:12]}/seg{entry.get('segment_index')}) "
                    "— an executable window may never have its command dropped"
                )
            licensed_drops.add((entry.get("video_sha256"), entry.get("segment_index")))

    command_keys: dict[str, dict[str, int]] = {"added": {}, "removed": {}, "changed": {}}
    changed_windows = 0
    commands_dropped = 0
    pairs = list(zip(b_windows, a_windows)) if order_identical else []

    for b, a in pairs:
        where = f"{b.get('video_sha256', '')[:12]}/seg{b.get('segment_index')}"
        for field in PRESERVED_WINDOW_FIELDS:
            if b.get(field) != a.get(field):
                violations.append(f"{where}: window field {field!r} changed")

        b_cmd, a_cmd = b.get("commands"), a.get("commands")
        if isinstance(b_cmd, dict) and a_cmd is None:
            if (b.get("video_sha256"), b.get("segment_index")) in licensed_drops:
                commands_dropped += 1
            else:
                violations.append(
                    f"{where}: commands vanished without being enumerated in "
                    "policy.sampling_unpinnable"
                )
            changed_windows += 1
            continue
        if isinstance(b_cmd, dict) != isinstance(a_cmd, dict):
            violations.append(f"{where}: commands appeared or vanished")
            changed_windows += 1
            continue
        if not isinstance(b_cmd, dict) or not isinstance(a_cmd, dict):
            continue

        for field in PRESERVED_COMMAND_FIELDS:
            if b_cmd.get(field) != a_cmd.get(field):
                violations.append(f"{where}: commands.{field} changed")

        if LEGACY_SAMPLING_KEY in a_cmd:
            violations.append(
                f"{where}: commands.{LEGACY_SAMPLING_KEY} survived the transform"
            )

        diff = _key_diff(b_cmd, a_cmd)
        moved = False
        for bucket in ("added", "removed", "changed"):
            for key in diff[bucket]:
                command_keys[bucket][key] = command_keys[bucket].get(key, 0) + 1
                moved = True
        if moved:
            changed_windows += 1

    licensed = {"added": {"sampling"}, "removed": {LEGACY_SAMPLING_KEY}, "changed": {"ffmpeg"}}
    for bucket, allowed in licensed.items():
        for key in command_keys[bucket]:
            if key not in allowed:
                violations.append(f"unlicensed command key {bucket}: {key!r}")

    # A licensed drop has no command and therefore no promotion key; comparing
    # one would be comparing a key against its own absence. Every OTHER window —
    # including all 97 auto ones — is compared, and that is the claim that
    # matters: no already-promoted window's key moved.
    compared = [
        (b, a)
        for b, a in pairs
        if (b.get("video_sha256"), b.get("segment_index")) not in licensed_drops
    ]
    promotion_identical = order_identical and all(
        _promotion_key(b) == _promotion_key(a) for b, a in compared
    )
    # Completion-gate fields are pure window fields, so every window is compared
    # regardless of what happened to its command object.
    completion_identical = order_identical and all(
        _completion_gate(b) == _completion_gate(a) for b, a in pairs
    )

    return {
        "schema_version": {
            "before": before.get("schema_version"),
            "after": after.get("schema_version"),
        },
        "window_count": count,
        "window_order_identical": order_identical,
        "windows_changed": changed_windows,
        "windows_unchanged": len(pairs) - changed_windows,
        "commands_dropped": commands_dropped,
        "top_level": top,
        "policy": policy,
        "command_keys": command_keys,
        "promotion_keys_identical": promotion_identical,
        "completion_gate_identical": completion_identical,
        "preserved_window_fields": list(PRESERVED_WINDOW_FIELDS),
        "preserved_command_fields": list(PRESERVED_COMMAND_FIELDS),
        "violations": violations,
        "ok": not violations and promotion_identical and completion_identical,
    }


def render_diff(report: Mapping[str, Any], *, out: Callable[[str], None]) -> None:
    out("")
    out("═══ SEMANTIC DIFF (input -> candidate) ═══")
    out(
        f"schema_version      : {report['schema_version']['before']} -> "
        f"{report['schema_version']['after']}"
    )
    out(
        f"windows             : {report['window_count']['before']} -> "
        f"{report['window_count']['after']}  "
        f"(order identical: {report['window_order_identical']})"
    )
    out(f"windows changed     : {report['windows_changed']}")
    out(f"windows unchanged   : {report['windows_unchanged']}")
    out(
        f"commands dropped    : {report['commands_dropped']} "
        "(non-auto only, each enumerated in policy.sampling_unpinnable)"
    )
    out(f"command keys added  : {report['command_keys']['added']}")
    out(f"command keys removed: {report['command_keys']['removed']}")
    out(f"command keys changed: {report['command_keys']['changed']}")
    out(f"policy keys added   : {report['policy']['added']}")
    out(f"policy keys changed : {report['policy']['changed']}")
    out("")
    out(f"promotion keys identical      : {report['promotion_keys_identical']}")
    out(f"completion-gate fields identical: {report['completion_gate_identical']}")
    out(f"preserved window fields       : {', '.join(report['preserved_window_fields'])}")
    out(f"preserved command fields      : {', '.join(report['preserved_command_fields'])}")
    out("")
    out(f"violations : {len(report['violations'])}")
    for violation in report["violations"][:40]:
        out(f"    - {violation}")
    if len(report["violations"]) > 40:
        out(f"    ... and {len(report['violations']) - 40} more")
    out(f"VERDICT    : {'OK' if report['ok'] else 'REJECTED'}")
