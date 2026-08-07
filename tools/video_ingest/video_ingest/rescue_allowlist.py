"""Stage-B rescue execution allowlist -- an additional, SHA- and HEAD-bound gate
in front of Stage A's ``auto`` windows.

This module answers exactly one question, purely: given an allowlist document
and the manifest windows it claims to select, is the selection *exact* and
*safe*? It never touches a filesystem, a database or ``git`` -- those seams
(reading the allowlist bytes once, hashing them, calling the real
``git rev-parse HEAD``) live in :mod:`video_ingest.rescue_execute` and
``scripts/execute_rescue_manifest.py``, in the same "pure policy, injected IO"
split every other module in this package uses.

**What an allowlist is not.** It is not a second source of truth about a
window's identity, its screen, its match or its command. Every one of those
already lives in the manifest, validated by :mod:`video_ingest.rescue_manifest`
and :mod:`video_ingest.rescue_execute`. An allowlist is purely a SUBSET
operator: it may only ever narrow the manifest's own ``auto`` set down to the
windows an operator has explicitly approved, and every field it names must
match the manifest's own window byte-for-byte. It cannot invent a window, widen
a selection, override a decision, or authorise anything the manifest did not
already authorise. Selection is checked by :func:`selected_auto_windows`; if a
window is not selected there, it is not selected anywhere -- the executor's
plan and execution loop iterate the selection this module returns and nothing
else.

**Why "unknown top-level key" is a hard rejection, not a warning.** The
schema-3 rescue audit produced an ``allowlist_proposal.corrected.json`` with
``proposal_only: true`` and ``do_not_execute: true`` -- an explicit,
self-describing refusal to be executed. Rather than special-casing those two
keys and hoping no future proposal format invents a third way to say "do not
run this", the allowlist's top-level shape is a closed set
(:data:`ALLOWED_TOP_LEVEL_KEYS`): anything else present makes the document's
authorization intent ambiguous, and ambiguity here fails closed. This also
means the audit proposal is rejected for its *shape* even without special-
casing its two flags -- it lacks ``schema_version``, ``kind`` and a top-level
``manifest_sha256``/``repository_head`` altogether, carrying them nested under
``binding_metadata`` instead, which this format does not recognise at all.

**Why the join key is (video_sha256, segment_index), not the promotion key.**
The promotion key (``video_sha256``, ``batch_dir``, ``run_id``) is the
database's own uniqueness index and is verified independently (see
:func:`entry_manifest_problems`), but using it as the LOOKUP key would let a
wrong ``batch_dir`` masquerade as "no such window" instead of being named as
the mismatch it is. ``(video_sha256, segment_index)`` is the manifest's own
window identity -- :func:`~video_ingest.rescue_manifest.validate_manifest`
already refuses a manifest with a duplicate of that pair -- so it is the one
join key guaranteed to resolve to at most one window, and every other field
(``target_screen``, ``match_id``, ``run_id``, ``batch_dir``, the promotion key
itself) is then compared against that window and named individually when it
disagrees.
"""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from video_ingest.rescue_manifest import DECISION_AUTO, DECISION_REVIEW, DECISION_SKIP, Window

#: The only allowlist contract this executor understands. Bumped, never
#: silently reinterpreted -- see `video_ingest.rescue_manifest.SCHEMA_VERSION`
#: for the identical rationale on the manifest side.
ALLOWLIST_SCHEMA_VERSION = 1

#: Self-describing document type, checked independently of the version number
#: so a same-shaped-but-different-purpose JSON file (a proposal, a report, an
#: unrelated manifest) cannot be mistaken for an allowlist by coincidence.
ALLOWLIST_KIND = "rescue-execution-allowlist"

#: The allowlist's closed top-level shape. Anything else present is refused as
#: ambiguous authorization intent -- see the module docstring.
ALLOWED_TOP_LEVEL_KEYS = frozenset(
    {
        "schema_version",
        "kind",
        "manifest_sha256",
        "repository_head",
        "source_proposal_sha256",
        "windows",
    }
)

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")

_ENTRY_REQUIRED_STR_FIELDS: tuple[str, ...] = ("video_sha256", "target_screen", "batch_dir")
_ENTRY_REQUIRED_INT_FIELDS: tuple[str, ...] = ("segment_index", "match_id", "run_id")


def is_sha256(value: Any) -> bool:
    """Whether ``value`` is a canonical lowercase 64-hex SHA-256 string."""
    return isinstance(value, str) and bool(_SHA256_RE.match(value))


def is_git_sha(value: Any) -> bool:
    """Whether ``value`` is a canonical lowercase 40-hex git commit sha."""
    return isinstance(value, str) and bool(_GIT_SHA_RE.match(value))


def _is_int(value: Any) -> bool:
    # bool is an int subclass; a JSON `true`/`false` must never satisfy an
    # integer field.
    return isinstance(value, int) and not isinstance(value, bool)


def _is_normalized_absolute_path(value: str) -> bool:
    """No relative paths, no ``..``, no ``.``, no doubled or trailing slashes.

    ``posixpath.normpath`` collapses every one of those; a path that survives
    unchanged carries no alternate spelling that a naive string compare
    elsewhere in the pipeline could be tricked by.
    """
    if not value.startswith("/"):
        return False
    return posixpath.normpath(value) == value


# ─── Parsed shape ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AllowlistEntry:
    """One manifest window an operator has explicitly approved for execution."""

    video_sha256: str
    segment_index: int
    target_screen: str
    match_id: int
    run_id: int
    batch_dir: str
    promotion_key: tuple[str, str, int]


@dataclass(frozen=True)
class Allowlist:
    """A validated execution allowlist. Construct only via :func:`parse_allowlist`,
    and only after :func:`allowlist_problems` returned an empty list -- this
    dataclass does not re-validate anything itself."""

    schema_version: int
    kind: str
    manifest_sha256: str
    repository_head: str
    source_proposal_sha256: str | None
    entries: tuple[AllowlistEntry, ...]


def parse_allowlist(doc: Mapping[str, Any]) -> Allowlist:
    """Rebuild the dataclass shape from an already-validated allowlist document."""
    entries = tuple(
        AllowlistEntry(
            video_sha256=raw["video_sha256"],
            segment_index=raw["segment_index"],
            target_screen=raw["target_screen"],
            match_id=raw["match_id"],
            run_id=raw["run_id"],
            batch_dir=raw["batch_dir"],
            promotion_key=tuple(raw["promotion_key"]),
        )
        for raw in doc["windows"]
    )
    return Allowlist(
        schema_version=doc["schema_version"],
        kind=doc["kind"],
        manifest_sha256=doc["manifest_sha256"],
        repository_head=doc["repository_head"],
        source_proposal_sha256=doc.get("source_proposal_sha256"),
        entries=entries,
    )


# ─── Structural validation (no manifest, no git needed) ───────────────────────


def top_level_authorization_problems(doc: Mapping[str, Any]) -> list[str]:
    """Whether this document's top-level shape unambiguously means "execute me".

    ``proposal_only``/``do_not_execute`` are named explicitly so a rejection for
    either reads as an intentional design decision rather than an obscure schema
    complaint; the closed-key check catches those two AND anything else that
    was never given execution semantics.
    """
    problems: list[str] = []
    if doc.get("proposal_only") is True:
        problems.append(
            "proposal_only: true -- this document is an audit PROPOSAL, not an "
            "execution allowlist, and must never be treated as executable"
        )
    if doc.get("do_not_execute") is True:
        problems.append(
            "do_not_execute: true -- this document explicitly marks itself as "
            "not executable"
        )
    unknown = sorted(set(doc.keys()) - ALLOWED_TOP_LEVEL_KEYS)
    if unknown:
        problems.append(
            "unknown top-level key(s) make authorization intent ambiguous: "
            + ", ".join(unknown)
            + " -- refusing rather than guessing what an unrecognised field means"
        )
    return problems


def schema_and_kind_problems(doc: Mapping[str, Any]) -> list[str]:
    problems: list[str] = []
    schema_version = doc.get("schema_version")
    if schema_version != ALLOWLIST_SCHEMA_VERSION:
        problems.append(
            f"schema_version: expected {ALLOWLIST_SCHEMA_VERSION}, got {schema_version!r}"
        )
    kind = doc.get("kind")
    if kind != ALLOWLIST_KIND:
        problems.append(f"kind: expected {ALLOWLIST_KIND!r}, got {kind!r}")
    return problems


def hash_and_head_format_problems(doc: Mapping[str, Any]) -> list[str]:
    problems: list[str] = []
    manifest_sha256 = doc.get("manifest_sha256")
    if not is_sha256(manifest_sha256):
        problems.append(
            f"manifest_sha256: not a 64-char lowercase hex sha256: {manifest_sha256!r}"
        )
    repository_head = doc.get("repository_head")
    if not is_git_sha(repository_head):
        problems.append(
            f"repository_head: not a 40-char lowercase hex commit sha: {repository_head!r}"
        )
    source_proposal_sha256 = doc.get("source_proposal_sha256")
    if source_proposal_sha256 is not None and not is_sha256(source_proposal_sha256):
        problems.append(
            "source_proposal_sha256: not null and not a 64-char lowercase hex "
            f"sha256: {source_proposal_sha256!r}"
        )
    return problems


def entry_field_problems(raw: Any, where: str) -> list[str]:
    """Structural shape of one entry -- types, formats and internal consistency.

    Internal consistency means the entry does not contradict ITSELF: its own
    ``promotion_key`` must equal ``(video_sha256, batch_dir, run_id)`` built from
    its own other fields. Whether that key -- or anything else about the entry
    -- matches the MANIFEST is a separate question, answered by
    :func:`entry_manifest_problems` once every entry here is structurally sound.
    """
    if not isinstance(raw, dict):
        return [f"{where}: not an object"]

    problems: list[str] = []
    for field in _ENTRY_REQUIRED_STR_FIELDS:
        value = raw.get(field)
        if not isinstance(value, str) or not value:
            problems.append(f"{where}.{field}: missing or not a non-empty string")

    video_sha256 = raw.get("video_sha256")
    if isinstance(video_sha256, str) and video_sha256 and not is_sha256(video_sha256):
        problems.append(
            f"{where}.video_sha256: not a full 64-char lowercase hex sha256 "
            f"({len(video_sha256)} char(s)): {video_sha256!r}"
        )

    for field in _ENTRY_REQUIRED_INT_FIELDS:
        value = raw.get(field)
        if not _is_int(value):
            problems.append(f"{where}.{field}: missing or not an integer")

    batch_dir = raw.get("batch_dir")
    if isinstance(batch_dir, str) and batch_dir and not _is_normalized_absolute_path(batch_dir):
        problems.append(
            f"{where}.batch_dir: not an absolute, normalized path -- no relative "
            f"path, '..', doubled or trailing slash is accepted: {batch_dir!r}"
        )

    promotion_key = raw.get("promotion_key")
    if not (isinstance(promotion_key, list) and len(promotion_key) == 3):
        problems.append(f"{where}.promotion_key: must be an array of exactly 3 elements")
    else:
        run_id = raw.get("run_id")
        if promotion_key[0] != video_sha256:
            problems.append(
                f"{where}.promotion_key[0]: {promotion_key[0]!r} != "
                f"video_sha256 {video_sha256!r}"
            )
        if promotion_key[1] != batch_dir:
            problems.append(
                f"{where}.promotion_key[1]: {promotion_key[1]!r} != batch_dir {batch_dir!r}"
            )
        if promotion_key[2] != run_id:
            problems.append(
                f"{where}.promotion_key[2]: {promotion_key[2]!r} != run_id {run_id!r}"
            )
    return problems


def entries_problems(raw_windows: Any) -> list[str]:
    """Shape of the whole ``windows`` array: non-empty, no duplicates, and every
    entry structurally sound on its own."""
    if not isinstance(raw_windows, list):
        return ["windows: missing or not an array"]

    problems: list[str] = []
    if not raw_windows:
        problems.append("windows: empty -- an allowlist must select at least one window")

    seen_full: set[tuple[Any, ...]] = set()
    seen_promotion_keys: set[tuple[Any, ...]] = set()
    for i, raw in enumerate(raw_windows):
        where = f"windows[{i}]"
        problems += entry_field_problems(raw, where)
        if not isinstance(raw, dict):
            continue

        full = (
            raw.get("video_sha256"),
            raw.get("segment_index"),
            raw.get("target_screen"),
            raw.get("match_id"),
            raw.get("run_id"),
            raw.get("batch_dir"),
        )
        if full in seen_full:
            problems.append(f"{where}: duplicate entry (identical to an earlier entry)")
        seen_full.add(full)

        promotion_key = raw.get("promotion_key")
        if isinstance(promotion_key, list) and len(promotion_key) == 3:
            key = tuple(promotion_key)
            if key in seen_promotion_keys:
                problems.append(f"{where}: duplicate promotion_key {list(key)!r}")
            seen_promotion_keys.add(key)

    return problems


# ─── Binding against the manifest actually loaded and the repository's HEAD ──


def manifest_binding_problems(doc: Mapping[str, Any], *, manifest_sha256: str) -> list[str]:
    """Whether this allowlist is bound to the EXACT manifest bytes this run loaded."""
    bound = doc.get("manifest_sha256")
    if bound != manifest_sha256:
        return [
            f"manifest_sha256: allowlist is bound to {bound!r} but the manifest "
            f"loaded for this run hashes to {manifest_sha256!r} -- refusing before "
            "any database probe or artifact check"
        ]
    return []


def repository_binding_problems(doc: Mapping[str, Any], *, repository_head: str) -> list[str]:
    """Whether this allowlist is bound to the repository's CURRENT commit."""
    bound = doc.get("repository_head")
    if bound != repository_head:
        return [
            f"repository_head: allowlist is bound to {bound!r} but this "
            f"repository's current HEAD is {repository_head!r} -- a superseded "
            "commit must not authorise execution against a different tree"
        ]
    return []


# ─── Entries vs. the manifest's own windows ───────────────────────────────────


def entry_manifest_problems(
    raw_windows: Sequence[Mapping[str, Any]], *, all_windows: Sequence[Window]
) -> list[str]:
    """Every entry must equal exactly one ``auto`` manifest window.

    Looked up by ``(video_sha256, segment_index)`` -- the manifest's own window
    identity, unique by construction (see the module docstring) -- and then
    compared field by field against that window, so a mismatch on any single
    field is named rather than folded into an undifferentiated "no match".
    """
    by_key: dict[tuple[Any, Any], Window] = {
        (w.video_sha256, w.segment_index): w for w in all_windows
    }

    problems: list[str] = []
    for i, raw in enumerate(raw_windows):
        where = f"windows[{i}]"
        key = (raw.get("video_sha256"), raw.get("segment_index"))
        window = by_key.get(key)
        if window is None:
            problems.append(
                f"{where}: unknown window -- no manifest window matches "
                f"video_sha256={raw.get('video_sha256')!r}, "
                f"segment_index={raw.get('segment_index')!r}"
            )
            continue
        if window.decision == DECISION_REVIEW:
            problems.append(
                f"{where}: refers to a REVIEW window -- only {DECISION_AUTO!r} "
                "windows are executable"
            )
            continue
        if window.decision == DECISION_SKIP:
            problems.append(
                f"{where}: refers to a SKIP window -- only {DECISION_AUTO!r} "
                "windows are executable"
            )
            continue
        if window.decision != DECISION_AUTO:
            problems.append(
                f"{where}: refers to a {window.decision!r} window -- only "
                f"{DECISION_AUTO!r} windows are executable"
            )
            continue

        manifest_batch_dir = (window.commands or {}).get("batch_dir")
        manifest_promotion_key = (window.video_sha256, manifest_batch_dir, window.run_id)

        mismatches: list[str] = []
        if raw.get("target_screen") != window.target_screen:
            mismatches.append(
                f"target_screen: {raw.get('target_screen')!r} != {window.target_screen!r}"
            )
        if raw.get("match_id") != window.match_id:
            mismatches.append(f"match_id: {raw.get('match_id')!r} != {window.match_id!r}")
        if raw.get("run_id") != window.run_id:
            mismatches.append(f"run_id: {raw.get('run_id')!r} != {window.run_id!r}")
        if raw.get("batch_dir") != manifest_batch_dir:
            mismatches.append(
                f"batch_dir: {raw.get('batch_dir')!r} != {manifest_batch_dir!r}"
            )
        entry_promotion_key = tuple(raw.get("promotion_key") or ())
        if entry_promotion_key != manifest_promotion_key:
            mismatches.append(
                f"promotion_key: {list(entry_promotion_key)!r} != "
                f"{list(manifest_promotion_key)!r}"
            )
        if mismatches:
            problems.append(
                f"{where}: does not exactly match manifest window: " + "; ".join(mismatches)
            )

    return problems


# ─── The one entry point the executor calls ───────────────────────────────────


def allowlist_problems(
    doc: Any,
    *,
    manifest_sha256: str,
    repository_head: str,
    all_windows: Sequence[Window],
) -> list[str]:
    """Every problem that must be zero before this allowlist may select anything.

    Structural problems (schema, kind, hash/head formats, entry shapes) are
    checked first and, if any exist, checked ALONE: comparing a structurally
    broken entry against the manifest cannot produce a meaningful diagnosis, and
    would risk masking the real defect behind a confusing "unknown window".
    Manifest- and repository-binding are checked next, and finally every entry
    is compared against the manifest's own ``auto`` windows.
    """
    if not isinstance(doc, dict):
        return [f"allowlist root must be a JSON object, got {type(doc).__name__}"]

    problems = top_level_authorization_problems(doc)
    problems += schema_and_kind_problems(doc)
    problems += hash_and_head_format_problems(doc)
    problems += entries_problems(doc.get("windows"))
    if problems:
        return problems

    problems += manifest_binding_problems(doc, manifest_sha256=manifest_sha256)
    problems += repository_binding_problems(doc, repository_head=repository_head)
    problems += entry_manifest_problems(doc["windows"], all_windows=all_windows)
    return problems


# ─── Selection ─────────────────────────────────────────────────────────────────


def _entry_window_keys(allowlist: Allowlist) -> frozenset[tuple[str, int]]:
    return frozenset((entry.video_sha256, entry.segment_index) for entry in allowlist.entries)


def selected_auto_windows(auto_windows: Sequence[Window], allowlist: Allowlist) -> list[Window]:
    """The manifest's ``auto`` windows the allowlist selects, in MANIFEST order.

    Manifest order, not allowlist JSON order: ``auto_windows`` is already
    iterated in the order the manifest declared, and this only filters it --
    it never re-sorts by anything the allowlist file itself said, so the
    allowlist cannot reorder execution even if its own entries are shuffled.
    """
    keys = _entry_window_keys(allowlist)
    return [w for w in auto_windows if (w.video_sha256, w.segment_index) in keys]


def excluded_auto_windows(auto_windows: Sequence[Window], allowlist: Allowlist) -> list[Window]:
    """The exact complement of :func:`selected_auto_windows` over the same set."""
    keys = _entry_window_keys(allowlist)
    return [w for w in auto_windows if (w.video_sha256, w.segment_index) not in keys]
