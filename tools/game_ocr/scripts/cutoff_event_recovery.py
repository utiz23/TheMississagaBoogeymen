"""Cutoff-event recovery — tier-3 OCR position recovery.

Runs AFTER:
  1. The action-tracker promoter spatial UPDATE (writes positions for events
     whose white panel underline was cleanly detected — clean tier 1).
  2. inventory_consensus_match.py (writes positions via cross-frame consensus
     of non-yellow rink markers — tier 2).

Handles the remaining case: captures where the parser failed to detect the
white panel underline (`selected_event_index = null`) but the yellow rink
marker WAS detected (`selected_event_x/y` present). These are "orphan
yellow markers" — known (x, y) with no attributed event.

Why this happens (per spatial.detect_selected_row_index):
  - Sub-case A: white-border peak not found at all (no_peak). Typically the
    selected row scrolled fully past the panel ROI edge between captures.
  - Sub-case B: peak found but no row's actor.y_center is within the
    [50, 90]px offset range (peak_no_row_match). Typically the selected row
    is the last visible row of the panel and its underline rendered just
    below the OCR'd actor band.

We currently can't distinguish A from B from raw_result_json alone, so this
tool relies on:
  (i)  Filename-timestamp scroll-order reconstruction (sort orphan captures
       by vlcsnap-YYYY-MM-DD-HHhMMmSSsmmm.png timestamp), and
  (ii) The set of events currently unpositioned in match_events (the orphan
       events).

For each orphan marker, the predicted event is:
  - Sub-case B preferred: the LAST event in panel(C).events, if that event
    is in the orphan-events set.
  - Sub-case A fallback: the event immediately AFTER prev_capture's
    selected event in the period's chronological order, AND/OR the event
    immediately BEFORE next_capture's selected event. Both candidates
    should agree.

If an orphan marker's predicted event is ALREADY positioned (sub-case C),
no UPDATE is emitted; a consistency check is logged instead.

Usage:
  docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \\
    "SELECT json_agg(json_build_object('id', id, 'source_path', source_path,
                                        'raw_result_json', raw_result_json))
     FROM ocr_extractions WHERE match_id=250
       AND screen_type='post_game_action_tracker'" \\
    | python3 tools/game_ocr/scripts/cutoff_event_recovery.py 250 \\
    | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl

Dry-run (no SQL emitted, predictions only on stderr):
  ... | python3 tools/game_ocr/scripts/cutoff_event_recovery.py 250 --dry-run
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass, field


# ---------- shared helpers -----------------------------------------------

VLCSNAP_TS_RE = re.compile(
    r"vlcsnap-(\d{4})-(\d{2})-(\d{2})-(\d{2})h(\d{2})m(\d{2})s(\d{3})\.png$"
)
# Video-pipeline (tools/video_ingest/pass2_extract.py) emits NNNNN.png
# zero-padded sequence numbers per segment dir. The integer value IS the
# chronological position within the segment.
SEQ_TS_RE = re.compile(r"(\d+)\.png$")


def parse_vlcsnap_timestamp(source_path: str) -> tuple[int, ...] | None:
    """Parse a sortable timestamp tuple from a capture filename.

    Accepts both:
      - legacy vlcsnap-YYYY-MM-DD-HHhMMmSSsmmm.png (manual screenshots),
        emits (Y, M, D, h, m, s, ms)
      - video-pipeline NNNNN.png (sequence within segment), emits a
        tuple prefixed with a sentinel year so it sorts deterministically
        relative to other sequence files in the same directory. The
        prefix doesn't collide with real vlcsnap years (we use 0).

    Returns None if neither pattern matches — those captures sort last.
    Within a single batch (one source_directory) only one format is
    expected, so cross-format comparison ambiguity doesn't bite.
    """
    norm = source_path.replace("\\", "/")
    m = VLCSNAP_TS_RE.search(norm)
    if m:
        return tuple(int(g) for g in m.groups())
    base = norm.rsplit("/", 1)[-1]
    seq = SEQ_TS_RE.fullmatch(base)
    if seq:
        # (0, 0, 0, 0, 0, 0, N) — zero-padded so it sorts purely on N
        # within the same dir.
        return (0, 0, 0, 0, 0, 0, int(seq.group(1)))
    return None


def period_from_path(source_path: str) -> int | None:
    """Derive period from parent directory name. Same logic as
    inventory_consensus_match.py:139-157 — copied to keep this script
    self-contained (it imports nothing from the package).
    """
    parts = source_path.replace("\\", "/").rstrip("/").rsplit("/", 2)
    folder = parts[-2] if len(parts) >= 2 else ""
    folder_lower = folder.lower()
    if "1st" in folder_lower:
        return 1
    if "2nd" in folder_lower:
        return 2
    if "3rd" in folder_lower:
        return 3
    if "ot" in folder_lower:
        return 4
    return None


def select_capture_period(raw: dict, source_path: str = "") -> int | None:
    events = raw.get("events", []) or []
    idx = raw.get("selected_event_index")
    if isinstance(idx, int) and 0 <= idx < len(events):
        p = events[idx].get("period_number")
        if isinstance(p, int) and p >= 1:
            return p
    if source_path:
        p = period_from_path(source_path)
        if p is not None:
            return p
    if events:
        p = events[0].get("period_number")
        if isinstance(p, int) and p >= 1:
            return p
    return None


def field_value(field_obj) -> str | None:
    """Extract `.value` from an ExtractionField dict, or return the field as
    a string. Mirrors apps/worker/src/ocr-promoters/action-tracker.ts:stringValue."""
    if field_obj is None:
        return None
    if isinstance(field_obj, str):
        return field_obj or None
    if isinstance(field_obj, dict):
        v = field_obj.get("value")
        return v if isinstance(v, str) and v else None
    return None


def hockey_zone(hx: float) -> str:
    if hx > 25:
        return "offensive"
    if hx < -25:
        return "defensive"
    return "neutral"


def clock_to_seconds(clock: str | None) -> int:
    """Convert MM:SS to seconds. Period clock counts down from 20:00 in
    regulation (so 19:42 happens BEFORE 0:42 in real time). We use the
    seconds value directly — higher = earlier in the period."""
    if not clock or ":" not in clock:
        return -1
    try:
        m, s = clock.split(":", 1)
        return int(m) * 60 + int(s)
    except ValueError:
        return -1


# ---------- DB fetch ------------------------------------------------------


def get_match_events(match_id: int) -> list[dict]:
    """Fetch all plottable OCR match_events for the match, both positioned
    and unpositioned. Returns dicts with id, period, type, side, clock,
    actor, x, y."""
    sql = (
        "SELECT json_agg(json_build_object("
        "'id', id, 'period_number', period_number, 'event_type', event_type, "
        "'team_side', team_side, 'clock', clock, "
        "'actor', actor_gamertag_snapshot, "
        "'x', x, 'y', y)) "
        f"FROM match_events WHERE match_id={match_id} "
        "AND source='ocr' "
        "AND event_type IN ('shot', 'hit', 'goal', 'penalty')"
    )
    res = subprocess.run(
        ["docker", "exec", "eanhl-team-website-db-1",
         "psql", "-U", "eanhl", "-d", "eanhl", "-tAc", sql],
        check=True, capture_output=True, text=True,
    )
    data = res.stdout.strip()
    return json.loads(data) if data and data != "null" else []


# ---------- domain types --------------------------------------------------


@dataclass
class CaptureView:
    """A single ocr_extraction's view of the Action Tracker, parsed into
    just the fields this script needs."""
    capture_id: int
    source_path: str
    period: int
    file_ts: tuple[int, ...] | None
    selected_idx: int | None
    selected_x: float | None
    selected_y: float | None
    # Panel events as a list of (event_type, clock, actor) tuples in the
    # order they appear in raw_result_json.events (top → bottom of panel).
    panel: list[tuple[str, str | None, str | None]] = field(default_factory=list)

    @property
    def is_clean_anchor(self) -> bool:
        """A capture that contributed a clean (event, position) anchor via
        the tier-1 spatial UPDATE."""
        return (
            self.selected_idx is not None
            and self.selected_x is not None
            and self.selected_y is not None
            and 0 <= self.selected_idx < len(self.panel)
        )

    @property
    def is_orphan_marker(self) -> bool:
        """A capture whose yellow position is known but selected event isn't."""
        return self.selected_idx is None and self.selected_x is not None and self.selected_y is not None

    def selected_event(self) -> tuple[str, str | None, str | None] | None:
        if not self.is_clean_anchor:
            return None
        return self.panel[self.selected_idx]  # type: ignore[index]


# ---------- core pipeline -------------------------------------------------


def load_captures(rows: list[dict]) -> list[CaptureView]:
    out: list[CaptureView] = []
    for row in rows:
        raw = row["raw_result_json"]
        source_path = row.get("source_path", "") or ""
        period = select_capture_period(raw, source_path)
        if period is None:
            continue

        # Extract panel events as plain tuples.
        panel: list[tuple[str, str | None, str | None]] = []
        for e in raw.get("events", []) or []:
            etype = e.get("event_type") or "unknown"
            clock = field_value(e.get("clock"))
            actor = field_value(e.get("actor_snapshot"))
            panel.append((etype, clock, actor))

        sel_x = raw.get("selected_event_x")
        sel_y = raw.get("selected_event_y")
        # JSON null for missing fields; treat sentinel "" as None too.
        if isinstance(sel_x, str) and not sel_x:
            sel_x = None
        if isinstance(sel_y, str) and not sel_y:
            sel_y = None

        cv = CaptureView(
            capture_id=row["id"],
            source_path=source_path,
            period=period,
            file_ts=parse_vlcsnap_timestamp(source_path),
            selected_idx=raw.get("selected_event_index"),
            selected_x=float(sel_x) if sel_x is not None else None,
            selected_y=float(sel_y) if sel_y is not None else None,
            panel=panel,
        )
        out.append(cv)
    return out


def build_period_event_chronology(
    all_events: list[dict],
) -> dict[int, list[dict]]:
    """Per-period real-time chronological order of match_events (earliest first).

    Hockey clocks count DOWN from 20:00 → 0:00. Higher clock_to_seconds =
    earlier in real time. The Action Tracker panel displays events
    newest-first (top of panel = most-recently-occurred event, lowest
    clock), which means the panel BOTTOM holds the OLDEST visible event
    (highest clock among visible). When the user scrolls "down" past the
    bottom, the cut-off event is OLDER than the panel's last visible row
    → has even HIGHER clock_to_seconds → is at a LOWER index in this
    descending-clock-sorted list (e.g. `anchor_idx - 1`)."""
    out: dict[int, list[dict]] = {}
    for e in all_events:
        p = e.get("period_number")
        if p is None:
            continue
        out.setdefault(p, []).append(e)
    for p in out:
        out[p].sort(key=lambda e: clock_to_seconds(e.get("clock")), reverse=True)
    return out


def event_key(e: dict | tuple) -> tuple[str, str | None, str | None]:
    """A canonical key for matching panel-event tuples to match_events rows.
    Uses (event_type, clock, actor) — same as the action-tracker promoter's
    dedup key, modulo period (which we handle as a separate dimension)."""
    if isinstance(e, dict):
        return (e.get("event_type"), e.get("clock"), e.get("actor"))
    return e  # already a tuple


def find_event_by_panel_key(
    period_events: list[dict],
    panel_key: tuple[str, str | None, str | None],
) -> dict | None:
    """Look up a match_events row by (event_type, clock, actor) within a
    period. Returns None when not found (e.g. faceoffs — we filter the
    match_events fetch to shot/hit/goal/penalty)."""
    for e in period_events:
        if event_key(e) == panel_key:
            return e
    return None


def neighbor_clean_anchor(
    captures_in_period: list[CaptureView],
    target_index: int,
    direction: int,
) -> CaptureView | None:
    """Walk captures_in_period in `direction` (+1 next, -1 prev) starting
    from `target_index + direction` until we find a clean anchor or run
    out. Returns the neighbor or None."""
    i = target_index + direction
    while 0 <= i < len(captures_in_period):
        c = captures_in_period[i]
        if c.is_clean_anchor:
            return c
        i += direction
    return None


def chronological_index(
    period_events: list[dict],
    target_key: tuple,
) -> int | None:
    for i, e in enumerate(period_events):
        if event_key(e) == target_key:
            return i
    return None


# ---------- prediction ----------------------------------------------------


@dataclass
class Prediction:
    capture_id: int
    period: int
    orphan_x: float
    orphan_y: float
    panel: list[tuple[str, str | None, str | None]]
    # Result fields:
    predicted_event: dict | None = None
    confidence: str | None = None  # 'interpolated' | 'extrapolated'
    rationale: list[str] = field(default_factory=list)
    status: str = "pending"  # 'matched' | 'positioned-already' | 'ambiguous' | 'no-candidate'


def find_panel_anchor_in_chronology(
    panel: list[tuple[str, str | None, str | None]],
    period_events: list[dict],
) -> tuple[int, dict] | None:
    """Walk the panel from BOTTOM to TOP and return the (chronological_index,
    event) of the latest panel row that matches a plottable match_events row.
    Faceoffs and unknown-type rows are skipped because period_events doesn't
    contain them. Returns None if no panel row maps to a known event."""
    for row in reversed(panel):
        ev = find_event_by_panel_key(period_events, row)
        if ev is None:
            continue
        idx = chronological_index(period_events, event_key(ev))
        if idx is not None:
            return (idx, ev)
    return None


def predict_orphan(
    cap: CaptureView,
    period_events: list[dict],
    orphan_event_keys: set[tuple],
) -> Prediction:
    """Predict the selected event for an orphan-marker capture.

    Strategy (single-direction forward-scroll heuristic):

    1. Sub-case B (last panel row IS an orphan event):
       The user's selected row is the panel's last visible row; its
       underline rendered just below the OCR'd actor band, so the parser
       missed it. Match the orphan marker to the last panel row.

    2. Sub-case A (last panel row is positioned or not in match_events):
       Walk panel from bottom to find the latest row that maps to a known
       plottable event. The selected row is the chronologically-NEXT event
       after that anchor. If that next event is orphan → match. If
       positioned → sub-case C (spatial consistency check). Faceoff or
       'unknown' rows in panel are skipped because match_events doesn't
       track them.

    The two cases can collide when the last panel row is an orphan AND the
    chronologically-next event is also an orphan. Default to sub-case B
    (last-row preferred) since empirically that matches the observed user
    scroll behaviour: when a row is visible AND highlighted, the panel
    typically scrolled so that row is at the bottom.
    """
    p = Prediction(
        capture_id=cap.capture_id,
        period=cap.period,
        orphan_x=cap.selected_x or 0.0,
        orphan_y=cap.selected_y or 0.0,
        panel=list(cap.panel),
    )

    if not cap.panel:
        p.status = "no-candidate"
        p.rationale.append("panel is empty; cannot infer")
        return p

    # Step 1: find the anchor — the latest panel row that maps to a known
    # plottable event in the chronological list.
    anchor = find_panel_anchor_in_chronology(cap.panel, period_events)
    if anchor is None:
        p.status = "no-candidate"
        p.rationale.append(
            "no panel row maps to a plottable match_events row (period may be empty)"
        )
        return p

    anchor_idx, anchor_event = anchor
    anchor_key = event_key(anchor_event)

    # Sub-case B: the anchor (last plottable panel row) is itself an orphan.
    if anchor_key in orphan_event_keys:
        p.predicted_event = anchor_event
        p.confidence = "interpolated"
        p.rationale.append(
            f"sub-case B: last plottable panel row {anchor_key} is an orphan event"
        )
        p.status = "matched"
        return p

    # Sub-case A: scroll-just-past the last visible row. The cut-off row
    # is OLDER than the anchor — i.e. at a LOWER index in the
    # descending-clock-sorted list (higher clock value = earlier).
    if anchor_idx - 1 < 0:
        p.status = "no-candidate"
        p.rationale.append(
            f"anchor {anchor_key} is the earliest event of period; "
            f"no older candidate exists"
        )
        return p

    cand = period_events[anchor_idx - 1]
    cand_key = event_key(cand)
    if cand_key in orphan_event_keys:
        p.predicted_event = cand
        p.confidence = "interpolated"
        p.rationale.append(
            f"sub-case A: anchor {anchor_key} (panel-last plottable row); "
            f"next chronological event {cand_key} is an orphan → MATCH"
        )
        p.status = "matched"
        return p

    # Sub-case C: predicted event is already positioned. Consistency check
    # only; no UPDATE emitted.
    p.predicted_event = cand
    p.status = "positioned-already"
    p.rationale.append(
        f"sub-case C: anchor {anchor_key}; next chronological event "
        f"{cand_key} is already positioned (redundant capture)"
    )
    return p


# ---------- main ----------------------------------------------------------


def main() -> int:
    apply = True
    args = list(sys.argv[1:])
    if "--dry-run" in args:
        apply = False
        args.remove("--dry-run")
    if not args:
        print("usage: cutoff_event_recovery.py <match_id> [--dry-run]", file=sys.stderr)
        return 2
    match_id = int(args[0])

    payload = sys.stdin.read().strip()
    if not payload or payload == "null":
        print("-- no input", file=sys.stderr)
        return 0
    rows = json.loads(payload)
    print(
        f"-- cutoff_event_recovery: match_id={match_id} captures={len(rows)} "
        f"apply={apply}",
        file=sys.stderr,
    )

    captures = load_captures(rows)

    # Bucket by period; sort within each period by file timestamp (then id
    # for determinism when ts is missing).
    by_period: dict[int, list[CaptureView]] = {}
    for c in captures:
        by_period.setdefault(c.period, []).append(c)
    for p, lst in by_period.items():
        lst.sort(key=lambda c: (c.file_ts or (9999,), c.capture_id))

    all_events = get_match_events(match_id)
    period_events = build_period_event_chronology(all_events)

    # Orphan events = unpositioned match_events.
    orphan_event_keys: set[tuple] = {
        event_key(e) for e in all_events if e.get("x") is None
    }
    print(
        f"-- {len(orphan_event_keys)} orphan events; "
        f"{sum(1 for c in captures if c.is_orphan_marker)} orphan markers",
        file=sys.stderr,
    )

    print("BEGIN;")
    matched = 0
    positioned_already = 0
    ambiguous = 0
    no_candidate = 0

    for p in sorted(by_period.keys()):
        caps = by_period[p]
        p_events = period_events.get(p, [])
        for i, cap in enumerate(caps):
            if not cap.is_orphan_marker:
                continue

            pred = predict_orphan(cap, p_events, orphan_event_keys)

            file_tail = cap.source_path.rsplit("/", 1)[-1]
            print(
                f"\n== orphan marker cap {cap.capture_id} ({file_tail}) "
                f"period={cap.period} yellow=({pred.orphan_x:.2f}, {pred.orphan_y:.2f}) ==",
                file=sys.stderr,
            )
            print(
                f"  panel ({len(cap.panel)} rows): "
                f"{[(t, c, a) for t, c, a in cap.panel]}",
                file=sys.stderr,
            )
            for r in pred.rationale:
                print(f"  - {r}", file=sys.stderr)

            if pred.status == "matched" and pred.predicted_event is not None:
                ev = pred.predicted_event
                # Sub-case C — predicted but already positioned — handled below
                # in the status branch, not here.
                if event_key(ev) not in orphan_event_keys:
                    # Defensive: shouldn't happen since predict_orphan splits.
                    positioned_already += 1
                    continue
                hx, hy = pred.orphan_x, pred.orphan_y
                zone = hockey_zone(hx)
                conf = pred.confidence or "extrapolated"
                print(
                    f"  ⇒ MATCH event_id={ev['id']} {event_key(ev)} "
                    f"({conf})",
                    file=sys.stderr,
                )
                if apply:
                    print(
                        f"UPDATE match_events SET x='{hx:.2f}', y='{hy:.2f}', "
                        f"rink_zone='{zone}', position_confidence='{conf}' "
                        f"WHERE id={ev['id']};"
                    )
                # Consume the orphan event so a later capture can't re-claim it.
                orphan_event_keys.discard(event_key(ev))
                matched += 1

            elif pred.status == "positioned-already" and pred.predicted_event is not None:
                ev = pred.predicted_event
                ex = ev.get("x")
                ey = ev.get("y")
                try:
                    dx = float(ex) - pred.orphan_x
                    dy = float(ey) - pred.orphan_y
                    dist = (dx * dx + dy * dy) ** 0.5
                except (TypeError, ValueError):
                    dist = -1.0
                ok = "OK" if 0 <= dist < 5.0 else "MISMATCH"
                print(
                    f"  ⇒ already-positioned event_id={ev['id']} "
                    f"{event_key(ev)}; consistency: {ok} "
                    f"(existing=({ex}, {ey}), orphan=({pred.orphan_x:.2f}, "
                    f"{pred.orphan_y:.2f}), dist={dist:.2f})",
                    file=sys.stderr,
                )
                positioned_already += 1

            elif pred.status == "ambiguous":
                print("  ⇒ AMBIGUOUS — skipped", file=sys.stderr)
                ambiguous += 1
            else:
                print("  ⇒ NO CANDIDATE — skipped", file=sys.stderr)
                no_candidate += 1

    print("COMMIT;")
    print(
        f"\n-- summary: matched={matched} positioned_already={positioned_already} "
        f"ambiguous={ambiguous} no_candidate={no_candidate}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
