"""Stage-A / Phase-1: build the post-game rescue manifest. STRICTLY READ-ONLY.

Walks every cached ``segments.json``, finds frames whose persisted top-bar OCR
read (``anchor_text``) disagrees with the ``screen_type`` the ``viterbi_v2``
segmenter assigned, resolves each one to a reel -> match -> active run, and
emits a machine-readable manifest of re-extract windows.

This phase writes exactly one file (the manifest). It runs no ffmpeg, makes no
database writes, and has no ``--execute`` path -- that lands in Stage B, which
consumes this manifest verbatim and never recomputes these decisions.

All decision logic lives in ``video_ingest.rescue_manifest`` so it is unit
testable without a cache, a video or a database.

Run (the repo-root .venv-1 is the pytest/python runner; the GPU
tools/video_ingest/.venv has no pytest -- see [[reference_gpu_ocr_venv]]):

    cd tools/video_ingest && PYTHONPATH=.:../game_ocr \\
      ../../.venv-1/bin/python scripts/rescue_postgame_from_cache.py
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from video_ingest.reprocess import DEFAULT_INGEST_CACHE
from video_ingest.rescue_manifest import (
    AUTO_ELIGIBLE_SCREENS,
    CLASS_EXPECTED_AMBIGUITY,
    CLASS_UNRESOLVED_IDENTITY,
    CONFIRMED_LOOKBACK_FRAMES,
    DECISION_AUTO,
    DECISION_REVIEW,
    DECISION_SKIP,
    DUPLICATE_RECORDINGS,
    GROUP_MAX_GAP_S,
    MATCHES_NEVER_INGESTED,
    PRE_DECLARED_REVIEW_REASONS,
    REEL_LOOKBACK,
    REEL_LOOKBACK_S,
    RESCUE_DECODER_VERSION,
    R_ALREADY_COVERED,
    R_LOOKBACK,
    R_NEVER_INGESTED,
    R_NO_ACTIVE_RUN,
    R_NO_CONFIRMED_MATCH,
    R_OUTSIDE_EVERY_REEL,
    R_VIDEO_PATH_MISSING,
    SEGMENT_INDEX_BASE,
    WINDOW_PAD_S,
    ResolvedCandidate,
    build_commands,
    build_windows,
    duplicate_verdict,
    is_confirmed_lookback,
    load_reels,
    manifest_to_dict,
    parse_windows,
    pin_or_drop,
    reason_class,
    resolve_reel,
    sampling_policy,
    select_candidates,
    tally_dropped_anchors,
    validate_manifest,
)
from video_ingest.rescue_sampling import memoised_prober, probe_frame_pts

DEFAULT_CONTAINER = "eanhl-team-website-db-1"

HOME_INGEST_CACHE = Path.home() / "ingest-cache"


def complete_sha_dirs(root: Path) -> list[Path]:
    """Cache entries this rescue can actually read (both artefacts present)."""
    if not root.is_dir():
        return []
    return sorted(
        d
        for d in root.iterdir()
        if d.is_dir() and (d / "segments.json").exists() and (d / "reels.json").exists()
    )


#: `DEFAULT_INGEST_CACHE` is /tmp/ingest-cache, normally a symlink to the real
#: store under $HOME. /tmp does not survive a reboot, and the dangerous case is
#: not the missing symlink -- it is a /tmp/ingest-cache that *exists* and is
#: empty, because then every check passes and the run reports "nothing to do".
#: So choose on content, not existence, and let `preflight_cache_root` fail
#: closed when neither candidate holds a usable cache.
def default_cache_root() -> Path:
    if complete_sha_dirs(DEFAULT_INGEST_CACHE):
        return DEFAULT_INGEST_CACHE
    if complete_sha_dirs(HOME_INGEST_CACHE):
        return HOME_INGEST_CACHE
    return DEFAULT_INGEST_CACHE


def preflight_cache_root(root: Path) -> list[Path]:
    """Fail closed on an empty or unreadable cache instead of emitting nothing.

    An empty manifest is indistinguishable from "no work to do", which is the
    exact shape the reboot trap takes: /tmp/ingest-cache gets recreated as an
    empty directory and the run looks clean.
    """
    sha_dirs = complete_sha_dirs(root)
    if not sha_dirs:
        raise SystemExit(
            f"cache preflight FAILED: no usable Pass-1 cache under {root}\n"
            f"  (a cache dir needs both segments.json and reels.json)\n"
            f"  checked: {DEFAULT_INGEST_CACHE} and {HOME_INGEST_CACHE}\n"
            f"  refusing to emit an empty manifest -- pass --cache-root explicitly."
        )
    return sha_dirs


# ─── DB access (read-only, via the repo's docker-exec psql pattern) ──────────


def run_psql(sql: str, *, container: str, user: str, db: str) -> list[dict[str, Any]]:
    """Run a SELECT via `docker exec psql` and parse its JSON output."""
    wrapped = f"SELECT coalesce(json_agg(t), '[]'::json) FROM ({sql}) t"
    proc = subprocess.run(
        ["docker", "exec", container, "psql", "-U", user, "-d", db, "-At", "-c", wrapped],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout.strip() or "[]")


class DbFacts:
    """Every database fact the manifest pins, captured at generation time."""

    def __init__(self, *, container: str, user: str, db: str) -> None:
        q = lambda sql: run_psql(sql, container=container, user=user, db=db)  # noqa: E731

        # reel_identity is '<sha>:<reel_index>'. Only confirmed associations
        # are load-bearing; pending/rejected ones resolve to nothing.
        self.reel_to_match: dict[str, int] = {
            r["reel_identity"]: int(r["proposed_match_id"])
            for r in q(
                "SELECT reel_identity, proposed_match_id FROM ocr_match_associations "
                "WHERE status = 'confirmed' AND proposed_match_id IS NOT NULL"
            )
        }
        self.active_run: dict[int, int] = {}
        self.run_sha: dict[int, str | None] = {}
        for r in q(
            "SELECT match_id, id, video_sha256 FROM ocr_decoder_runs WHERE is_active"
        ):
            self.active_run[int(r["match_id"])] = int(r["id"])
            self.run_sha[int(r["match_id"])] = r["video_sha256"]

        self.coverage: dict[int, set[str]] = defaultdict(set)
        for r in q(
            "SELECT DISTINCT s.match_id, s.state FROM ocr_segments s "
            "JOIN ocr_decoder_runs dr ON dr.id = s.run_id AND dr.is_active "
            "WHERE s.match_id IS NOT NULL"
        ):
            self.coverage[int(r["match_id"])].add(str(r["state"]))

        self.rescue_batches: int = int(
            q(
                "SELECT count(*) AS n FROM ocr_capture_batches "
                "WHERE source_directory LIKE '%/rescue/%'"
            )[0]["n"]
        )
        self.rescue_runs: int = int(
            q(
                "SELECT count(*) AS n FROM ocr_decoder_runs "
                f"WHERE decoder_version = '{RESCUE_DECODER_VERSION}'"
            )[0]["n"]
        )


# ─── Per-sha processing ─────────────────────────────────────────────────────


def video_end_seconds(doc: dict[str, Any]) -> float:
    segs = doc.get("segments") or []
    frames = doc.get("frame_classifications") or []
    ends = [float(s["end_seconds"]) for s in segs]
    ends += [float(f.get("source_time_seconds", f.get("seconds", 0.0))) for f in frames]
    return max(ends) if ends else 0.0


def resolve_candidates(
    candidates, reels, sha: str, facts: DbFacts, *, used_ledger: set
) -> list[ResolvedCandidate]:
    """Attach reel -> match -> active run, and settle each frame's decision.

    The coverage precheck runs here, before the decision is finalised: a match
    that already has the target screen in its active run gains nothing from a
    re-ingest and carries needless promotion risk, so it is skipped.

    Windows on a declared duplicate recording are left for the second pass in
    ``main`` -- deciding them needs the primary's windows, which are not built
    until every sha has been walked.
    """
    duplicate = DUPLICATE_RECORDINGS.get(sha)
    never_ingested = MATCHES_NEVER_INGESTED.get(sha)

    resolved: list[ResolvedCandidate] = []
    for cand in candidates:
        reel, reel_mode = resolve_reel(reels, cand.seconds)
        match_id = (
            facts.reel_to_match.get(f"{sha}:{reel.reel_index}") if reel else None
        )
        run_id = facts.active_run.get(match_id) if match_id is not None else None

        decision, reason = cand.decision, cand.reason
        # An evidence-level review reason outranks every verdict below: the read
        # is ambiguous whatever match it belongs to, and relabelling it would
        # book expected ambiguity as an identity blocker in the gate table.
        pinned = decision == DECISION_REVIEW and reason in PRE_DECLARED_REVIEW_REASONS
        confirmed_lookback = reel is not None and is_confirmed_lookback(
            sha, reel.reel_index, cand.target_screen, cand.seconds
        )
        if confirmed_lookback and reel_mode == REEL_LOOKBACK:
            # Only a frame still resolving BY LOOKBACK consumes its ledger entry.
            # If one became contained, the entry is reported stale rather than
            # quietly satisfied -- the cache moved under the adjudication.
            used_ledger.add((sha, reel.reel_index, cand.target_screen, cand.seconds))

        verdict: tuple[str, str] | None = None
        if never_ingested is not None:
            # Identity is certain; there is simply no run to attach to.
            match_id, run_id = never_ingested, None
            verdict = (DECISION_REVIEW, R_NEVER_INGESTED)
        elif duplicate is not None:
            match_id = duplicate.match_id
            run_id = facts.active_run.get(match_id)
            # Verdict deferred to settle_duplicates (needs the primary's windows).
        elif reel is None:
            verdict = (DECISION_REVIEW, R_OUTSIDE_EVERY_REEL)
        elif match_id is None:
            verdict = (DECISION_REVIEW, R_NO_CONFIRMED_MATCH)
        elif reel_mode == REEL_LOOKBACK and not confirmed_lookback:
            # The frame sits past the reel's last segment; the attachment is an
            # inference, not containment, so it never runs unattended unless it
            # is individually listed in CONFIRMED_LOOKBACK_FRAMES.
            if decision == DECISION_AUTO:
                verdict = (DECISION_REVIEW, R_LOOKBACK)
        elif (
            cand.target_screen is not None
            and cand.target_screen in facts.coverage.get(match_id, set())
        ):
            verdict = (DECISION_SKIP, R_ALREADY_COVERED)
        elif run_id is None and decision == DECISION_AUTO:
            verdict = (DECISION_REVIEW, R_NO_ACTIVE_RUN)

        if verdict is not None and not pinned:
            decision, reason = verdict

        resolved.append(
            ResolvedCandidate(
                frame=cand,
                reel=reel,
                reel_mode=reel_mode,
                match_id=match_id,
                run_id=run_id,
                decision=decision,
                reason=reason,
            )
        )
    return resolved


def settle_duplicates(windows, facts: DbFacts) -> None:
    """Second pass: decide the deliberately unassociated duplicate recordings.

    A duplicate's window may only be skipped once the screen is provably not
    lost -- covered by the match's active run, or already recovered by a rescue
    window on the primary recording of the same footage.
    """
    recovered: dict[int, set[str]] = defaultdict(set)
    for win in windows:
        if (
            win.match_id is not None
            and win.target_screen is not None
            and win.video_sha256 not in DUPLICATE_RECORDINGS
            and win.decision in (DECISION_AUTO, DECISION_SKIP)
        ):
            recovered[win.match_id].add(win.target_screen)

    for win in windows:
        dup = DUPLICATE_RECORDINGS.get(win.video_sha256)
        if dup is None:
            continue
        win.decision, win.reason = duplicate_verdict(
            win.target_screen,
            facts.coverage.get(dup.match_id, set()),
            recovered.get(dup.match_id, set()),
        )
        # Drop the command fingerprint even though other skips keep theirs: it
        # names `--match-id` for a reel this rescue is deliberately NOT
        # associating, and a runnable command is the one artefact that could
        # turn that decision back into an ingest by accident.
        win.commands = None


def process_sha(
    sha_dir: Path,
    facts: DbFacts,
    *,
    cache_root: str,
    game_title_id: int,
    grid_for,
    probe_frames,
    used_ledger: set,
    unpinnable: list,
):
    sha = sha_dir.name
    doc = json.loads((sha_dir / "segments.json").read_text())
    reels = load_reels(json.loads((sha_dir / "reels.json").read_text()))
    video_path = str(doc.get("video_path") or "")

    candidates = select_candidates(doc.get("frame_classifications") or [])
    resolved = resolve_candidates(candidates, reels, sha, facts, used_ledger=used_ledger)
    windows = build_windows(
        video_sha256=sha,
        video_path=video_path,
        video_path_exists=bool(video_path) and Path(video_path).exists(),
        resolved=resolved,
        reels=reels,
        video_end_s=video_end_seconds(doc),
    )
    dropped = tally_dropped_anchors(doc.get("frame_classifications") or [])
    for win in windows:
        if not win.video_path_exists and win.decision == DECISION_AUTO:
            win.decision, win.reason = DECISION_REVIEW, R_VIDEO_PATH_MISSING

        # Sampling is planned on the SOURCE frame grid, so a video that is not
        # present cannot be probed and therefore cannot be pinned. Such a window
        # is already `review` (R_VIDEO_PATH_MISSING) and keeps no command rather
        # than carrying one built against a guessed grid.
        if not win.video_path_exists:
            win.commands = None
            continue

        # The probe is INSIDE the builder, and the builder runs under
        # `pin_or_drop`. Both facts matter:
        #
        #   * inside, because a window with no target screen or no resolved match
        #     gets no command at all, and probing its source would be spending an
        #     ffprobe (and a possible refusal) on a decision already made. The
        #     previous version probed every present video before the builder
        #     could say it had nothing to build, so a single unpinnable source —
        #     the trimmed match-2400 recording, whose r_frame_rate and
        #     avg_frame_rate disagree — aborted the whole corpus even though its
        #     five affected windows are review-only;
        #   * under `pin_or_drop`, because that is the SINGLE statement of the
        #     auto/non-auto asymmetry that the transform tool also obeys. An
        #     unpinnable AUTO window still aborts everything; a review or skip
        #     window loses its command and is written into
        #     `policy.sampling_unpinnable`.
        def build(win=win):
            if win.target_screen is None or win.match_id is None:
                return None
            return build_commands(
                win,
                cache_root=cache_root,
                game_title_id=game_title_id,
                source_grid=grid_for(win.video_path),
                probe_frames=probe_frames,
            )

        win.commands, entry = pin_or_drop(
            build=build,
            decision=win.decision,
            video_sha256=win.video_sha256,
            segment_index=win.segment_index,
            video_path=win.video_path,
            reason=win.reason,
            where=f"{win.video_sha256[:12]}/seg{win.segment_index}",
        )
        if entry is not None:
            unpinnable.append(entry)
    return windows, candidates, dropped


# ─── Unrecoverable inventory ────────────────────────────────────────────────


def unrecoverable_report(
    facts: DbFacts, windows, cached_shas: set[str]
) -> list[dict[str, Any]]:
    """Matches with a post-game gap that this rescue cannot close, and why.

    The gap universe is every match whose active run holds at least one
    post-game segment (so a post-game recording demonstrably exists) but is
    missing one or more auto-eligible screens -- plus the never-ingested
    matches, which the coverage query cannot see at all because they have no
    run, and which would otherwise vanish from the report entirely.
    """
    rescued = {w.match_id for w in windows if w.match_id is not None}
    out: list[dict[str, Any]] = []
    for sha, match_id in sorted(MATCHES_NEVER_INGESTED.items(), key=lambda kv: kv[1]):
        out.append(
            {
                "match_id": match_id,
                "video_sha256": sha,
                "reason": R_NEVER_INGESTED,
                "missing_screens": sorted(AUTO_ELIGIBLE_SCREENS),
            }
        )
    for match_id, states in sorted(facts.coverage.items()):
        post_game = {s for s in states if s.startswith("post_game_")}
        if not post_game:
            continue
        missing = sorted(set(AUTO_ELIGIBLE_SCREENS) - states)
        if not missing or match_id in rescued:
            continue
        sha = facts.run_sha.get(match_id)
        if not sha:
            reason = "no_video_sha_on_active_run"
        elif sha not in cached_shas:
            reason = "no_pass1_cache"
        else:
            reason = "no_candidate_frames_in_cache"
        out.append(
            {
                "match_id": match_id,
                "video_sha256": sha,
                "reason": reason,
                "missing_screens": missing,
            }
        )
    return out


# ─── Report ─────────────────────────────────────────────────────────────────


def print_report(
    manifest: dict[str, Any], candidate_rules: Counter, dropped: Counter
) -> None:
    windows = parse_windows(manifest)
    p = print

    p("")
    p("═══ RESCUE MANIFEST ═══")
    p(f"cache root : {manifest['cache_root']}")
    p(f"generated  : {manifest['generated_at']}")
    p(f"windows    : {len(windows)}")

    by_decision = Counter(w.decision for w in windows)
    p("")
    p("── decisions ──")
    for decision in (DECISION_AUTO, DECISION_REVIEW, DECISION_SKIP):
        n = by_decision.get(decision, 0)
        frames = sum(w.frame_count for w in windows if w.decision == decision)
        p(f"  {decision:8s} {n:5d} windows  {frames:5d} evidence frames")

    p("")
    p("── auto vs review, per target screen ──")
    p(f"  {'screen':32s} {'auto':>6s} {'review':>7s} {'skip':>6s} {'matches':>8s}")
    screens = sorted({w.target_screen or "(unresolved)" for w in windows})
    for screen in screens:
        rows = [w for w in windows if (w.target_screen or "(unresolved)") == screen]
        auto = [w for w in rows if w.decision == DECISION_AUTO]
        p(
            f"  {screen:32s} {len(auto):6d} "
            f"{sum(1 for w in rows if w.decision == DECISION_REVIEW):7d} "
            f"{sum(1 for w in rows if w.decision == DECISION_SKIP):6d} "
            f"{len({w.match_id for w in auto if w.match_id}):8d}"
        )

    p("")
    p("── review reasons ──")
    for reason, n in Counter(
        w.reason for w in windows if w.decision == DECISION_REVIEW
    ).most_common():
        p(f"  {n:5d}  {reason}")

    p("")
    p("── skip reasons ──")
    for reason, n in Counter(
        w.reason for w in windows if w.decision == DECISION_SKIP
    ).most_common():
        p(f"  {n:5d}  {reason}")

    # The gate is judged by reason class, not by one headline rate: expected
    # ambiguity is legitimate review work, unresolved identity is a blocker.
    review = [w for w in windows if w.decision == DECISION_REVIEW]
    resolvable = [w for w in windows if reason_class(w.reason) != CLASS_EXPECTED_AMBIGUITY]
    p("")
    p("── review rate BY REASON CLASS ──")
    p(f"  {'class':26s} {'windows':>8s} {'frames':>7s}  {'% of all windows':>16s}")
    for cls, n in Counter(reason_class(w.reason) for w in review).most_common():
        rows = [w for w in review if reason_class(w.reason) == cls]
        p(
            f"  {cls:26s} {n:8d} {sum(w.frame_count for w in rows):7d}  "
            f"{100.0 * n / max(len(windows), 1):15.1f}%"
        )
    blockers = [w for w in review if reason_class(w.reason) == CLASS_UNRESOLVED_IDENTITY]
    p(
        f"  {'ALL review':26s} {len(review):8d} "
        f"{sum(w.frame_count for w in review):7d}  "
        f"{100.0 * len(review) / max(len(windows), 1):15.1f}%"
    )
    p("")
    p(f"  resolution-failure review rate (excl. expected ambiguity): "
      f"{len([w for w in resolvable if w.decision == DECISION_REVIEW])}"
      f" / {len(resolvable)} resolvable windows = "
      f"{100.0 * len([w for w in resolvable if w.decision == DECISION_REVIEW]) / max(len(resolvable), 1):.1f}%")
    p(f"  unresolved-identity blockers                             : {len(blockers)}")

    p("")
    p("── anchor rules fired (candidate frames) ──")
    for rule, n in candidate_rules.most_common():
        p(f"  {n:5d}  {rule}")

    p("")
    p("── frames a corroboration guard discarded (never windowed) ──")
    for (rule, reason), n in dropped.most_common():
        p(f"  {n:5d}  {rule:18s} {reason}")

    auto_windows = [w for w in windows if w.decision == DECISION_AUTO]
    p("")
    p(f"── per-match auto windows ({len({w.match_id for w in auto_windows})} matches) ──")
    per_match: dict[int, Counter] = defaultdict(Counter)
    for win in auto_windows:
        per_match[win.match_id][win.target_screen] += 1
    short = {s: s.replace("post_game_", "").replace("box_score_", "bs_") for s in AUTO_ELIGIBLE_SCREENS}
    cols = [short[s] for s in AUTO_ELIGIBLE_SCREENS]
    p(f"  {'match':>7s}  " + "  ".join(f"{c:>13s}" for c in cols))
    for match_id in sorted(per_match):
        counts = per_match[match_id]
        p(
            f"  {match_id:7d}  "
            + "  ".join(f"{counts.get(s, 0) or '.':>13}" for s in AUTO_ELIGIBLE_SCREENS)
        )

    # Never silent. A dropped command is a real reduction in what the manifest
    # offers, and a reader who is not told about it would read `commands: null`
    # on a review window as "nothing was ever pinned here".
    unpinnable = (manifest.get("policy") or {}).get("sampling_unpinnable") or []
    p("")
    p(f"── unpinnable sources ({len(unpinnable)} windows lost their command) ──")
    if not unpinnable:
        p("  none — every window that would carry a command was pinned to a "
          "measured source grid")
    for entry in unpinnable:
        p(
            f"  {str(entry.get('video_sha256') or '')[:12]}/seg{entry.get('segment_index')} "
            f"{entry.get('decision')}  {entry.get('reason')}"
        )
        p(f"      {entry.get('video_path')}")
        p(f"      {entry.get('detail')}")

    unrec = manifest["unrecoverable"]
    p("")
    p(f"── unrecoverable ({len(unrec)} matches) ──")
    for reason, n in Counter(u["reason"] for u in unrec).most_common():
        p(f"  {n:5d}  {reason}")
    for row in unrec:
        missing = ", ".join(s.replace("post_game_", "") for s in row["missing_screens"])
        p(f"    match {row['match_id']:<6} {row['reason']:<28} missing: {missing}")


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cache-root", type=Path, default=default_cache_root())
    ap.add_argument("--out", type=Path, default=None, help="default <cache-root>/rescue-manifest.json")
    ap.add_argument("--container", default=DEFAULT_CONTAINER)
    ap.add_argument("--db-user", default="eanhl")
    ap.add_argument("--db-name", default="eanhl")
    ap.add_argument("--game-title-id", type=int, default=1)
    ap.add_argument("--version", default="nhl26")
    args = ap.parse_args()

    cache_root = args.cache_root.resolve()
    out_path = args.out or (cache_root / "rescue-manifest.json")
    # Preflight first: fail closed on an empty cache before touching the DB.
    sha_dirs = preflight_cache_root(cache_root)

    # Sampling is no longer an fps knob read from the pass-2 config: each window
    # is planned on its OWN source's measured grid — rate AND presentation-
    # timestamp origin — probed here and memoised per path, then verified against
    # the real frames around each evidence timestamp. `probe_source_grid` raises
    # on an absent, unparseable or variable rate and on leading frames that do
    # not sit on one grid.
    #
    # That refusal aborts the whole generation only for an AUTO window; see
    # `pin_or_drop`. A source that only ever backs review/skip windows — the
    # trimmed match-2400 recording is the live example — costs those windows
    # their commands and is written into `policy.sampling_unpinnable`.
    grid_for = memoised_prober()

    facts = DbFacts(container=args.container, user=args.db_user, db=args.db_name)

    skipped = sorted(
        d.name
        for d in cache_root.iterdir()
        if d.is_dir() and not ((d / "segments.json").exists() and (d / "reels.json").exists())
    )

    all_windows = []
    candidate_rules: Counter = Counter()
    dropped: Counter = Counter()
    used_ledger: set = set()
    unpinnable: list[dict[str, Any]] = []
    for sha_dir in sha_dirs:
        windows, candidates, sha_dropped = process_sha(
            sha_dir,
            facts,
            cache_root=str(cache_root),
            game_title_id=args.game_title_id,
            grid_for=grid_for,
            probe_frames=probe_frame_pts,
            used_ledger=used_ledger,
            unpinnable=unpinnable,
        )
        all_windows.extend(windows)
        candidate_rules.update(c.rule for c in candidates)
        dropped.update(sha_dropped)

    settle_duplicates(all_windows, facts)

    # A ledger entry that matches no candidate frame means the cache moved under
    # the hand-adjudicated evidence. Report it -- silence would let a stale
    # confirmation keep a window on `auto` after the frame it rested on changed.
    stale_ledger = sorted(
        f"{sha[:12]}:{reel}:{screen}@{seconds:g}"
        for sha, reel, screen, seconds in CONFIRMED_LOOKBACK_FRAMES - used_ledger
    )

    policy = {
        "decoder_version": RESCUE_DECODER_VERSION,
        "segment_index_base": SEGMENT_INDEX_BASE,
        "group_max_gap_s": GROUP_MAX_GAP_S,
        "window_pad_s": WINDOW_PAD_S,
        "reel_lookback_s": REEL_LOOKBACK_S,
        "auto_eligible_screens": list(AUTO_ELIGIBLE_SCREENS),
        **sampling_policy(
            source_grids={
                w.video_sha256: grid_for(w.video_path).rate.text
                for w in all_windows
                if w.commands is not None
            },
            source_pts_origins={
                w.video_sha256: grid_for(w.video_path).origin_s
                for w in all_windows
                if w.commands is not None
            },
            # Every window whose command was dropped because its source could
            # not be pinned, with the reason. The transform tool writes the same
            # key from the same builder, so a regenerated manifest and a
            # transformed one describe their drops identically.
            unpinnable=unpinnable,
        ),
        "game_title_id": args.game_title_id,
        "ui_version": args.version,
        "cached_shas_scanned": len(sha_dirs),
        "cache_dirs_skipped_incomplete": skipped,
        "confirmed_lookback_frames": len(CONFIRMED_LOOKBACK_FRAMES),
        "confirmed_lookback_frames_matched": len(used_ledger),
        "confirmed_lookback_frames_stale": stale_ledger,
        "duplicate_recordings_not_associated": {
            sha: {
                "match_id": d.match_id,
                "primary_video_sha256": d.primary_video_sha256,
                "primary_offset_s": d.primary_offset_s,
                "note": d.note,
            }
            for sha, d in DUPLICATE_RECORDINGS.items()
        },
        "matches_never_ocr_ingested": dict(MATCHES_NEVER_INGESTED),
    }
    manifest = manifest_to_dict(
        all_windows,
        policy=policy,
        unrecoverable=unrecoverable_report(
            facts, all_windows, {d.name for d in sha_dirs}
        ),
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        cache_root=str(cache_root),
    )

    problems = validate_manifest(manifest)
    out_path.write_text(json.dumps(manifest, indent=1, sort_keys=False) + "\n")

    # Round-trip: load -> parse -> identical re-emit.
    reloaded = json.loads(out_path.read_text())
    reemitted = manifest_to_dict(
        parse_windows(reloaded),
        policy=reloaded["policy"],
        unrecoverable=reloaded["unrecoverable"],
        generated_at=reloaded["generated_at"],
        cache_root=reloaded["cache_root"],
    )
    round_trip_ok = reemitted == reloaded

    print_report(manifest, candidate_rules, dropped)

    print("")
    print("── read-only proof ──")
    print(f"  ocr_capture_batches with source_directory LIKE '%/rescue/%' : {facts.rescue_batches}")
    print(f"  ocr_decoder_runs with decoder_version='{RESCUE_DECODER_VERSION}' : {facts.rescue_runs}")
    print(f"  manifest round-trips (load -> parse -> identical re-emit)     : {round_trip_ok}")
    print(f"  confirmed-lookback ledger entries matched                    : "
          f"{len(used_ledger)}/{len(CONFIRMED_LOOKBACK_FRAMES)}")
    print(f"  stale (unmatched) ledger entries                             : {len(stale_ledger)}")
    for entry in stale_ledger:
        print(f"      {entry}")
    print(f"  validation problems                                          : {len(problems)}")
    for problem in problems[:20]:
        print(f"      {problem}")
    if skipped:
        print(f"  cache dirs skipped (no segments.json/reels.json): {len(skipped)}")
        for name in skipped:
            print(f"      {name}")
    print("")
    print(f"manifest written: {out_path}")

    ok = (
        not problems
        and round_trip_ok
        and not stale_ledger
        and facts.rescue_batches == 0
        and facts.rescue_runs == 0
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
