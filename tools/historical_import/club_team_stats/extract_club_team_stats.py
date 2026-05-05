"""
Club/team stats screenshot extractor.

Input:
  Two PNG screenshots of the in-game STATS → CLUB STATS view for one
  playlist (vertically scrolled).

Output:
  One JSON file in the exact shape the existing hand-keyed pilots use
  (`tools/historical_import/club_team_stats/nhl25_eashl_*_pilot.json`):
    - top-level `_comment` + `records: [...]`
    - per-record: titleSlug, playlist, importBatch, reviewStatus,
      confidenceScore, metrics, sources, rawExtract, notes.

NOT a one-click importer. The user is the final reviewer; this script's
job is to surface label/value pairs cleanly with raw evidence preserved.
`reviewStatus` is always `pending_review` on extractor output.

Design rules:
  * `metrics` only contains modelled canonical schema keys with parsed
    typed values. Unmodelled labels stay in `rawExtract` only.
  * `rawExtract.screenshot01` / `rawExtract.screenshot02` preserve verbatim
    label-as-typed → parsed-value pairs from each image.
  * Disagreements across the two screenshots are surfaced in the record's
    `notes` rather than silently flattened.
  * No reuse of the player-card video extractor or the club-member
    member-table extractor. Local helpers only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
from rapidocr_onnxruntime import RapidOCR


# ---------------------------------------------------------------------------
# Domain mapping: on-screen label → canonical schema key.
# A value of None means "label is visible on screen but not yet a typed
# column in `historical_club_team_stats`" — kept in rawExtract only.
# Keys are lowercased + whitespace-collapsed forms.
# ---------------------------------------------------------------------------
LABEL_TO_CANONICAL: dict[str, str | None] = {
    # Record / W-L
    "division titles": "division_titles",
    "club finals gp": "club_finals_gp",
    "games played": "games_played",
    "wins": "wins",
    "losses": "losses",
    "overtime losses": "otl",
    "did not finish %": "did_not_finish_pct",
    "did not finish": "did_not_finish_pct",
    "dnf wins": "dnf_wins",
    "win/loss streak": "win_loss_streak",
    # Goals
    "goals for": "goals_for",
    "goals against": "goals_against",
    "goal difference": "goal_difference",
    "avg goals for": "avg_goals_for",
    "avg goals against": "avg_goals_against",
    "avg win margin": "avg_win_margin",
    "avg loss margin": "avg_loss_margin",
    # Shots
    "shots per game": "shots_per_game",
    "avg shots against": "avg_shots_against",
    "shooting %": "shooting_pct",
    # Hits
    "hits": "hits",
    "hits per game": "hits_per_game",
    # Penalties / power play
    "penalty minutes": "pim",
    "avg penalty minutes": "avg_pim",
    "power plays": "power_plays",
    "power play goals": "power_play_goals",
    "power play %": "power_play_pct",
    "penalty kill %": "power_play_kill_pct",
    "times short handed": "times_shorthanded",
    "times shorthanded": "times_shorthanded",
    "short handed goals": "short_handed_goals",
    "shorthanded goals": "short_handed_goals",
    "power play goals against": "short_handed_goals_against",
    "shorthanded goals ag": "short_handed_goals_against",
    "shorthanded goals against": "short_handed_goals_against",
    # Faceoffs / passes / breakaways / one-timers / blocks
    "faceoffs won": "faceoffs_won",
    "faceoff %": "faceoff_pct",
    "breakaway %": "breakaway_pct",
    "one-timer goals": "one_timer_goals",
    "one timer goals": "one_timer_goals",
    "one-timer %": "one_timer_pct",
    "one timer %": "one_timer_pct",
    "passing %": "passing_pct",
    "blocked shots": "blocked_shots",
    # Time on attack
    "avg time on attack": "avg_time_on_attack",
    # Visible labels NOT promoted to a typed metric — captured in rawExtract only.
    "win differential": None,
    "faceoffs lost": None,
    "breakaway goals": None,
    "breakaways": None,
    "avg pass attempts": None,
    "penalty shot goals": None,
    "penalty shots": None,
    "shutouts": None,
    "club stats": None,  # tab label
    "club rank": None,
    "stat": None,
    "tot": None,
}


# Top-nav and footer tokens that should not be treated as stat labels.
# These are filtered before pairing.
NAV_BAD_TOKENS: set[str] = {
    "PLAY", "LOADOUTS", "CLUBS", "CUSTOMIZE", "BATTLE PASS", "BATTLEPASS",
    "STORE", "REWARDS", "STATS", "BACK", "LEADERBOARDS",
    "CLUB STATS", "CLUB RANK", "STAT", "TOT",
}

# Playlist title labels — present once at the top, but should never pair.
PLAYLIST_TITLE_RE = re.compile(
    r"^(EASHL\s*\d+V\d+|6\s*PLAYER\s*FULL\s*TEAM|THREES|3V3|6V6|CHEL)$",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# OCR primitives
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class Box:
    text: str
    conf: float
    x_left: float
    x_right: float
    x_centre: float
    y_top: float
    y_bottom: float
    y_centre: float
    height: float


def _from_rapid(raw_box: list[list[float]], text: Any, conf: Any) -> Box:
    xs = [pt[0] for pt in raw_box]
    ys = [pt[1] for pt in raw_box]
    x_l, x_r = min(xs), max(xs)
    y_t, y_b = min(ys), max(ys)
    return Box(
        text=str(text).strip(),
        conf=float(conf),
        x_left=float(x_l),
        x_right=float(x_r),
        x_centre=float((x_l + x_r) / 2),
        y_top=float(y_t),
        y_bottom=float(y_b),
        y_centre=float((y_t + y_b) / 2),
        height=float(y_b - y_t),
    )


def run_ocr(path: Path, ocr: RapidOCR | None = None) -> tuple[list[Box], RapidOCR]:
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    if ocr is None:
        ocr = RapidOCR()
    result, _ = ocr(img)
    boxes = [_from_rapid(b, t, c) for (b, t, c) in (result or [])]
    return boxes, ocr


def cluster_rows(boxes: list[Box], y_tol_factor: float = 0.6) -> list[list[Box]]:
    """Group boxes into y-rows. Tolerance scales with each box's height."""
    if not boxes:
        return []
    sorted_y = sorted(boxes, key=lambda b: b.y_centre)
    rows: list[list[Box]] = [[sorted_y[0]]]
    for b in sorted_y[1:]:
        ref = rows[-1][-1]
        tol = max(8.0, ref.height * y_tol_factor)
        if abs(b.y_centre - ref.y_centre) <= tol:
            rows[-1].append(b)
        else:
            rows.append([b])
    for row in rows:
        row.sort(key=lambda b: b.x_left)
    return rows


# ---------------------------------------------------------------------------
# Value classification + parsing
# ---------------------------------------------------------------------------

TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
INT_RE = re.compile(r"^[-+]?\d{1,6}(?:,\d{3})*$")
DEC_RE = re.compile(r"^[-+]?\d+\.\d+%?$")
PCT_INT_RE = re.compile(r"^[-+]?\d+%$")
DASH_TOKENS = {"-", "—", "–"}


def is_value_token(text: str) -> bool:
    t = text.strip()
    if t in DASH_TOKENS:
        return True
    if not t:
        return False
    return bool(
        TIME_RE.match(t)
        or INT_RE.match(t)
        or DEC_RE.match(t)
        or PCT_INT_RE.match(t)
    )


def parse_value(text: str) -> Any:
    """Return int, float, str (for time MM:SS), or None for empty/dash."""
    t = text.strip()
    if t in DASH_TOKENS or t == "":
        return None
    if TIME_RE.match(t):
        return t
    pct = t.endswith("%")
    s = t.rstrip("%").replace(",", "")
    if INT_RE.match(t.rstrip("%")):
        try:
            return float(s) if pct else int(s)
        except ValueError:
            pass
    if DEC_RE.match(t.rstrip("%")) or DEC_RE.match(s):
        try:
            return float(s)
        except ValueError:
            pass
    return t


# ---------------------------------------------------------------------------
# Label classification + pairing
# ---------------------------------------------------------------------------

def normalise_label(label: str) -> str:
    s = re.sub(r"\s+", " ", label.strip()).rstrip(".:;")
    return s.lower()


# Sorted by length-desc so greedy matching prefers the longest canonical
# label first ('avg goals for' before 'goals for', etc.). Built lazily.
_CANONICAL_LABELS_SORTED: list[str] | None = None


def _canonical_labels_sorted() -> list[str]:
    global _CANONICAL_LABELS_SORTED
    if _CANONICAL_LABELS_SORTED is None:
        _CANONICAL_LABELS_SORTED = sorted(LABEL_TO_CANONICAL.keys(), key=len, reverse=True)
    return _CANONICAL_LABELS_SORTED


def split_glued_labels(label_text: str) -> list[str]:
    """OCR sometimes merges label boxes from adjacent columns within the
    same y-row, producing strings like 'Division Titles g Club Finals GP
    Games Played'. Greedy longest-prefix-match against the known canonical
    label dictionary recovers the constituent labels. Single-character
    junk between labels (typically a misread one-digit value from the
    column whose value was eaten by the merge) is skipped."""
    s = label_text.strip()
    out: list[str] = []
    canonical_keys = _canonical_labels_sorted()
    while s:
        s_low = s.lower()
        match: str | None = None
        for key in canonical_keys:
            # Match canonical label as a prefix; require a non-letter
            # boundary after it so 'goal difference' doesn't eat 'goal'.
            if s_low == key or (s_low.startswith(key) and not s_low[len(key) : len(key) + 1].isalpha()):
                match = key
                break
        if match is None:
            # No further canonical match — append remainder verbatim and stop.
            out.append(s)
            break
        out.append(s[: len(match)])
        s = s[len(match):].strip()
        # Skip any orphan 1-2 char OCR garbage between labels (often a
        # misread single-digit value of the previous column whose label
        # we just emitted but whose value box was merged into the labels).
        while s and len(s.split(None, 1)[0]) <= 2 and not is_value_token(s.split(None, 1)[0]):
            parts = s.split(None, 1)
            s = parts[1] if len(parts) > 1 else ""
    return [p for p in out if p]


def is_label_token(text: str) -> bool:
    if is_value_token(text):
        return False
    upper = text.strip().upper()
    if upper in NAV_BAD_TOKENS:
        return False
    if PLAYLIST_TITLE_RE.match(text.strip()):
        return False
    return bool(re.search(r"[A-Za-z]", text))


def pair_row(row: list[Box]) -> list[tuple[str, str, float]]:
    """Walk left-to-right. Concatenate consecutive label tokens until we
    hit a value token; emit (label, value, mean_conf) and reset.

    Multi-word labels split by RapidOCR (e.g. 'Avg Goals' + 'For') are
    handled by the running label buffer; single-token labels work too.

    When the buffered label string contains multiple known canonical
    labels concatenated (cross-column OCR merge — frequent at the top of
    the body where columns are tighter), greedy split via known-label
    prefix matching recovers the constituent labels and pairs the value
    with the LAST piece. Earlier pieces are emitted as label-only entries
    with empty values; if those metrics also appear in the other
    screenshot they recover there.
    """
    pairs: list[tuple[str, str, float]] = []
    label_buf: list[Box] = []
    for b in row:
        if is_value_token(b.text):
            if label_buf:
                label_text = " ".join(x.text for x in label_buf)
                conf = sum(x.conf for x in label_buf + [b]) / (len(label_buf) + 1)
                splits = split_glued_labels(label_text)
                if len(splits) > 1:
                    # Pair value with the rightmost split piece; emit the
                    # earlier pieces as orphan labels (no value paired here).
                    for orphan in splits[:-1]:
                        pairs.append((orphan, "", conf))
                    pairs.append((splits[-1], b.text, conf))
                else:
                    pairs.append((label_text, b.text, conf))
                label_buf = []
        elif is_label_token(b.text):
            label_buf.append(b)
        # else: orphan/footer/title token — ignore
    return pairs


def split_inline_label_value(text: str) -> tuple[str, str] | None:
    """OCR sometimes glues a label and its value into one box (e.g.
    'Wins 313'). Try to split on the first numeric/time suffix."""
    m = re.match(r"^(.*?[A-Za-z%])\s+([-+]?\d{1,6}(?:,\d{3})*(?:\.\d+)?%?|\d{1,2}:\d{2})$", text.strip())
    if not m:
        return None
    label, value = m.group(1).strip(), m.group(2).strip()
    if not is_label_token(label):
        return None
    return label, value


# ---------------------------------------------------------------------------
# Per-image extraction
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ScreenshotExtract:
    image_path: Path
    raw_pairs: list[tuple[str, str, float]]
    detected_playlist: str | None
    avg_conf: float
    box_count: int


def detect_playlist_label(rows: list[list[Box]]) -> str | None:
    for row in rows[:8]:
        for b in row:
            if PLAYLIST_TITLE_RE.match(b.text.strip()):
                return re.sub(r"\s+", " ", b.text.strip()).upper()
    return None


def extract_screenshot(path: Path, ocr: RapidOCR | None) -> tuple[ScreenshotExtract, RapidOCR]:
    boxes, ocr = run_ocr(path, ocr)
    rows = cluster_rows(boxes)
    detected = detect_playlist_label(rows)

    pairs: list[tuple[str, str, float]] = []
    for row in rows:
        # Primary: row-level label/value pairing.
        row_pairs = pair_row(row)
        pairs.extend(row_pairs)
        # Fallback: try in-line splits on remaining unpaired label tokens
        # that look like 'Label NN' glued together.
        for b in row:
            if not is_label_token(b.text):
                continue
            split = split_inline_label_value(b.text)
            if split is None:
                continue
            label, value = split
            normalised = normalise_label(label)
            already = any(normalise_label(lbl) == normalised for lbl, _, _ in pairs)
            if not already:
                pairs.append((label, value, b.conf))

    confs = [c for _, _, c in pairs]
    avg = round(sum(confs) / len(confs), 3) if confs else 0.0
    return (
        ScreenshotExtract(
            image_path=path,
            raw_pairs=pairs,
            detected_playlist=detected,
            avg_conf=avg,
            box_count=len(boxes),
        ),
        ocr,
    )


# ---------------------------------------------------------------------------
# Output assembly
# ---------------------------------------------------------------------------

def to_raw_extract_dict(extract: ScreenshotExtract) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for label_raw, value_raw, _ in extract.raw_pairs:
        key = re.sub(r"\s+", " ", label_raw.strip())
        if value_raw == "":
            # Orphan label from a glued-label split — keep the key with null
            # so the reviewer can see the label was detected even though no
            # value was paired locally.
            if key not in out:
                out[key] = None
            continue
        parsed = parse_value(value_raw)
        if parsed is None:
            parsed = value_raw
        if key not in out:
            out[key] = parsed
    return out


def to_metrics_and_warnings(
    s01: ScreenshotExtract, s02: ScreenshotExtract,
) -> tuple[dict[str, Any], list[str]]:
    """Map known labels → canonical keys, parse values. Surface disagreements."""
    metrics: dict[str, Any] = {}
    warnings: list[str] = []

    by_canonical: dict[str, list[tuple[Any, int]]] = {}
    for idx, extract in enumerate((s01, s02), start=1):
        for label_raw, value_raw, _ in extract.raw_pairs:
            if value_raw == "":
                continue  # orphan label from glued-label split — no value here
            normalised = normalise_label(label_raw)
            if normalised not in LABEL_TO_CANONICAL:
                continue
            canonical = LABEL_TO_CANONICAL[normalised]
            if canonical is None:
                continue
            parsed = parse_value(value_raw)
            if parsed is None:
                continue
            by_canonical.setdefault(canonical, []).append((parsed, idx))

    for canonical, values in by_canonical.items():
        unique_vals = list({v for v, _ in values})
        if len(unique_vals) == 1:
            metrics[canonical] = unique_vals[0]
        else:
            chosen = values[0][0]
            metrics[canonical] = chosen
            details = ", ".join(f"screenshot{i}={v!r}" for v, i in values)
            warnings.append(
                f"{canonical}: cross-screenshot disagreement ({details}); chose {chosen!r}"
            )

    return metrics, warnings


def relativise(p: Path, repo_root: Path) -> str:
    try:
        return str(p.resolve().relative_to(repo_root))
    except ValueError:
        return str(p)


def build_output(
    title_slug: str,
    playlist: str,
    s01: ScreenshotExtract,
    s02: ScreenshotExtract,
    image_paths: tuple[Path, Path],
    repo_root: Path,
) -> dict[str, Any]:
    metrics, warnings = to_metrics_and_warnings(s01, s02)
    raw01 = to_raw_extract_dict(s01)
    raw02 = to_raw_extract_dict(s02)

    confs = [c for c in (s01.avg_conf, s02.avg_conf) if c]
    confidence = round(sum(confs) / len(confs), 3) if confs else 0.0

    detected = (s01.detected_playlist or s02.detected_playlist) or ""
    detected_norm = re.sub(r"[^A-Z0-9]", "", detected.upper())
    user_norm = re.sub(r"[^A-Z0-9]", "", playlist.upper())
    if detected and user_norm not in detected_norm and detected_norm not in user_norm:
        warnings.append(
            f"Detected on-screen playlist '{detected}' may not match --playlist '{playlist}'"
        )

    record = {
        "titleSlug": title_slug,
        "playlist": playlist,
        "importBatch": f"{title_slug}-club-team-stats-extractor-v1",
        "reviewStatus": "pending_review",
        "confidenceScore": confidence,
        "metrics": metrics,
        "sources": [relativise(p, repo_root) for p in image_paths],
        "rawExtract": {
            "screenshot01": raw01,
            "screenshot02": raw02,
        },
        "notes": (
            "Extractor output (extract_club_team_stats.py). Pending review. "
            + ("; ".join(warnings) if warnings else "No warnings emitted.")
        ),
    }

    return {
        "_comment": (
            "Auto-extracted club/team stats from CLUBS → CLUB STATS captures via "
            "extract_club_team_stats.py. metrics maps known labels to canonical "
            "schema keys. rawExtract preserves verbatim per-screenshot label/value "
            "reads (including labels not yet in the schema). ALL VALUES SHOULD BE "
            "REVIEWED BEFORE IMPORT."
        ),
        "records": [record],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Club/team stats screenshot extractor")
    parser.add_argument("image_01", type=Path, help="First screenshot (top portion)")
    parser.add_argument("image_02", type=Path, help="Second screenshot (scrolled portion)")
    parser.add_argument("--title-slug", required=True, help="e.g. nhl25")
    parser.add_argument("--playlist", required=True, help="e.g. eashl_6v6")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output JSON path. Default: <title>_<playlist>.extract.json next to image_01",
    )
    args = parser.parse_args(argv)

    if not args.image_01.exists():
        print(f"Image not found: {args.image_01}", file=sys.stderr)
        return 1
    if not args.image_02.exists():
        print(f"Image not found: {args.image_02}", file=sys.stderr)
        return 1

    repo_root = Path(__file__).resolve().parents[3]

    s01, ocr = extract_screenshot(args.image_01, None)
    s02, _ = extract_screenshot(args.image_02, ocr)

    output = build_output(
        args.title_slug,
        args.playlist,
        s01,
        s02,
        (args.image_01, args.image_02),
        repo_root,
    )

    out_path = args.output or args.image_01.parent / f"{args.title_slug}_{args.playlist}.extract.json"
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")

    rec = output["records"][0]
    print(f"Wrote {out_path}")
    print(json.dumps({
        "title": args.title_slug,
        "playlist": args.playlist,
        "metrics_count": len(rec["metrics"]),
        "raw_screenshot01_pairs": len(rec["rawExtract"]["screenshot01"]),
        "raw_screenshot02_pairs": len(rec["rawExtract"]["screenshot02"]),
        "confidenceScore": rec["confidenceScore"],
        "notes": rec["notes"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
