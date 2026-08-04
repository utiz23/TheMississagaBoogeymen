"""Fail-closed preflight for the Pass-1 decode cache root.

``reprocess.DEFAULT_INGEST_CACHE`` is ``/tmp/ingest-cache``, normally a symlink
into a durable store under ``$HOME``. ``/tmp`` does not survive a reboot, and
the dangerous state is NOT the missing symlink — a missing root is loud the
moment anything tries to read it. The trap is a root that *exists* and holds no
Pass-1 cache: ``orchestrator.ingest`` mkdirs ``output_root/<sha>/``, finds no
``segments.json``, and re-decodes. Every existence check passes, no warning is
printed, and the only symptom is that a run which should have been a Pass-2
cache hit becomes ~30-45 min of GPU decode — times the whole corpus.

So the discriminator is CONTENT, not existence: does the root hold at least one
Pass-1 result? An empty root is legitimate exactly once, on a genuinely fresh
machine, which is not a state the pipeline can infer — so that case takes an
explicit per-invocation opt-in (``--allow-empty-cache``) rather than a guess.

This module VALIDATES; it deliberately does not RESOLVE. When a populated cache
turns up at a fallback location the diagnostic says so and prints the symlink
command, but the pipeline never switches roots on its own: the Pass-2 output
dir, the sha cache, the batch logs and the run-quality sidecars are all
addressed off the module-level ``DEFAULT_INGEST_CACHE`` in their own modules, so
a silent redirect here would split one run across two roots — a quieter bug
than the one being fixed.

The read-only ``scripts/rescue_postgame_from_cache.py`` carries its own copy of
this idea. It is deliberately not shared: the rescue reads reel geometry and so
requires ``reels.json`` too, while the pipeline's decode cache turns on
``segments.json`` alone.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence


#: The Pass-1 artifact whose absence makes ``orchestrator.ingest`` re-decode.
#: ``reels.json`` and the Pass-2 frame dirs are downstream of it, so this is the
#: one file that distinguishes "cached" from "about to cost 30-45 min".
PASS1_ARTIFACT = "segments.json"

#: Where a lost ``/tmp/ingest-cache`` symlink normally pointed. Consulted for
#: the diagnostic only — never adopted as the root. See the module docstring.
CACHE_ROOT_FALLBACKS: tuple[Path, ...] = (Path.home() / "ingest-cache",)

#: The opt-in that makes an empty root acceptable. Named here so the guard and
#: every CLI that exposes it cannot drift apart.
ALLOW_EMPTY_FLAG = "--allow-empty-cache"


class CacheRootUnusable(RuntimeError):
    """The Pass-1 cache root holds no cache and no opt-in was given.

    Carries an operator-actionable message; the CLI turns it into a clean
    exit 1 rather than a traceback.
    """


def pass1_cache_entries(root: Path) -> list[Path]:
    """The per-sha dirs under ``root`` that hold a Pass-1 result.

    A missing root, an unreadable root, and a root full of ``batch-logs-*`` /
    ``sha-cache.json`` / half-written sha dirs all come back empty — none of
    them save a decode.
    """
    if not root.is_dir():
        return []
    try:
        children = sorted(root.iterdir())
    except OSError:
        return []
    return [d for d in children if d.is_dir() and (d / PASS1_ARTIFACT).is_file()]


def _fallback_hits(
    root: Path, fallbacks: Iterable[Path]
) -> list[tuple[Path, list[Path]]]:
    """Fallback roots that actually hold a cache, excluding ``root`` itself.

    Only populated candidates are returned: naming an equally empty directory
    would send the operator chasing a dir that cannot help.
    """
    try:
        root_key = root.resolve()
    except OSError:  # pragma: no cover — resolve() is strict=False, near-total
        root_key = root
    hits: list[tuple[Path, list[Path]]] = []
    for candidate in fallbacks:
        try:
            if candidate.resolve() == root_key:
                continue
        except OSError:  # pragma: no cover
            pass
        entries = pass1_cache_entries(candidate)
        if entries:
            hits.append((candidate, entries))
    return hits


def _diagnostic(root: Path, fallbacks: Iterable[Path]) -> str:
    lines = [
        f"cache preflight FAILED: no Pass-1 cache under {root}",
        f"  a usable entry is <root>/<video-sha256>/{PASS1_ARTIFACT}; found 0.",
        "  Proceeding would re-decode every video from scratch (~30-45 min each)",
        "  instead of hitting the cache. Refusing to start.",
    ]
    for candidate, entries in _fallback_hits(root, fallbacks):
        lines += [
            f"  A usable cache IS present at {candidate} ({len(entries)} entries).",
            f"    Fix: ln -sfn {candidate} {root}",
        ]
    lines.append(
        f"  If this really is a first run with no cache yet, pass {ALLOW_EMPTY_FLAG}."
    )
    return "\n".join(lines)


def preflight_cache_root(
    root: Path,
    *,
    allow_empty: bool = False,
    fallbacks: Sequence[Path] | None = None,
) -> list[Path]:
    """Fail closed unless ``root`` holds at least one Pass-1 cache entry.

    Returns the entries (possibly empty under ``allow_empty``) so a caller can
    log what it found. Never creates ``root`` — mkdir-ing it is precisely how
    the trap gets laid.

    Raises:
      CacheRootUnusable: ``root`` holds no Pass-1 result and ``allow_empty`` is
        False. The message names the root, any populated fallback, and the
        opt-in.
    """
    entries = pass1_cache_entries(root)
    if entries or allow_empty:
        return entries
    if fallbacks is None:
        fallbacks = CACHE_ROOT_FALLBACKS
    raise CacheRootUnusable(_diagnostic(root, fallbacks))
