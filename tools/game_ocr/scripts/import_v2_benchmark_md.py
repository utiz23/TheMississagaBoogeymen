"""Convert a V2 manual-benchmark markdown into a per-field benchmark label JSON.

The V2 manual benchmark (research/OCR-SS/Manual OCR benchmark for verification
V2.md and friends) is the hand-recorded ground truth for a match's pre-game
lobby + loadouts. This one-shot converter parses the structured pre-game
sections into the JSON label contract consumed by score_field_benchmark.py:

    calibration/extras/loadout/benchmark/labels/<match_id>.json

It canonicalizes build-class and X-Factor names/tiers with the SAME closed-vocab
the extractor uses (game_ocr.loadout_extractors.closed_vocab.load_closed_vocab),
so labels and predictions normalize identically.

Two markdown regions are read and merged per (team_side, position) subject:
  - "## Pre-Game-Lobby" state-2 tables → is_captain (Leader?), persona, number,
    level, gamertag, platform, build, X-Factors+tiers, height, weight.
  - "## Pre-Game-Loadouts" per-position blocks → handedness (Shot Handness),
    full persona name, and the 23 attribute values (and deltas when present).

Usage (from repo root):
    tools/game_ocr/.venv/bin/python tools/game_ocr/scripts/import_v2_benchmark_md.py \
        --md "research/OCR-SS/Manual OCR benchmark for verification V2.md" \
        --match-id 250 --split validation \
        --out tools/game_ocr/calibration/extras/loadout/benchmark/labels/250.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Optional

from game_ocr.loadout_extractors.closed_vocab import load_closed_vocab

POSITION_LABELS = {
    "center": "C",
    "left wing": "LW",
    "right wing": "RW",
    "left defense": "LD",
    "right defense": "RD",
    "goalie": "G",
}

# Display attribute name (lowercased) → canonical snake_case key.
ATTR_DISPLAY_TO_KEY = {
    "wrist shot accuracy": "wrist_shot_accuracy",
    "slap shot accuracy": "slap_shot_accuracy",
    "speed": "speed",
    "balance": "balance",
    "agility": "agility",
    "wrist shot power": "wrist_shot_power",
    "slap shot power": "slap_shot_power",
    "acceleration": "acceleration",
    "puck control": "puck_control",
    "endurance": "endurance",
    "passing": "passing",
    "offensive awareness": "offensive_awareness",
    "body checking": "body_checking",
    "stick checking": "stick_checking",
    "defensive awareness": "defensive_awareness",
    "hand-eye": "hand_eye",
    "strength": "strength",
    "durability": "durability",
    "shot blocking": "shot_blocking",
    "deking": "deking",
    "faceoffs": "faceoffs",
    "discipline": "discipline",
    "fighting skill": "fighting_skill",
}

_BUILD_VOCAB = load_closed_vocab("build_classes")
_XF_VOCAB = load_closed_vocab("x_factors")
_TIER_VOCAB = load_closed_vocab("x_factor_tiers")

# Attribute-group table headers (col 0). Detection is by group name, not header
# arity, so both the 2-col (match-250) and 3-col (Δ|R) layouts are recognized.
ATTR_GROUP_NAMES = {"technique", "power", "playstyle", "tenacity", "tactics"}


def _canon(vocab, raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    hit = vocab.match_canonical(raw.strip())
    return hit[0] if hit else raw.strip()


def _split_row(line: str) -> list[str]:
    """Split a markdown table row into trimmed cells.

    Splits only on UNescaped pipes so an in-cell ``\\|`` (e.g. "P1 \\| Level 17")
    stays one cell; the escape is then removed.
    """
    inner = line.strip().strip("|")
    parts = re.split(r"(?<!\\)\|", inner)
    return [p.replace("\\|", "|").replace("<br>", "").strip() for p in parts]


def _is_table_row(line: str) -> bool:
    return line.strip().startswith("|") and line.strip().endswith("|")


def _is_separator(line: str) -> bool:
    return bool(re.fullmatch(r"\s*\|[\s:|-]+\|\s*", line))


def _parse_tables(block: list[str]) -> list[tuple[list[str], list[list[str]]]]:
    """Return [(headers, rows), ...] for every pipe table in a block of lines."""
    tables: list[tuple[list[str], list[list[str]]]] = []
    i = 0
    while i < len(block):
        if _is_table_row(block[i]) and i + 1 < len(block) and _is_separator(block[i + 1]):
            headers = _split_row(block[i])
            rows: list[list[str]] = []
            j = i + 2
            while j < len(block) and _is_table_row(block[j]) and not _is_separator(block[j]):
                rows.append(_split_row(block[j]))
                j += 1
            tables.append((headers, rows))
            i = j
        else:
            i += 1
    return tables


def _col(headers: list[str], *names: str) -> Optional[int]:
    low = [h.strip().lower() for h in headers]
    for name in names:
        if name.lower() in low:
            return low.index(name.lower())
    return None


def _level_int(raw: str) -> Optional[int]:
    m = re.search(r"level\s*(\d+)", raw, re.IGNORECASE)
    return int(m.group(1)) if m else None


def _number_int(raw: str) -> Optional[int]:
    m = re.search(r"(\d+)", raw)
    return int(m.group(1)) if m else None


def _weight_int(raw: str) -> Optional[int]:
    m = re.search(r"(\d+)", raw)
    return int(m.group(1)) if m else None


def _delta_int(raw: str) -> Optional[int]:
    """Parse an attribute delta chip ('+4', '-6', '', '-') → signed int or None."""
    s = raw.strip()
    if not s or s == "-":
        return None
    m = re.search(r"[+-]?\d+", s)
    return int(m.group()) if m else None


def _xfactor(cell: str) -> Optional[dict]:
    """Parse a 'Name - Tier' cell into {name, tier} (canonicalized).

    Some loadout transcriptions annotate the tier with its diamond colour
    (e.g. "Elite (Red)", "All Star (Blue)"); the colour is redundant with the
    tier name, so a trailing parenthetical is stripped before canonicalization.
    """
    if not cell or "-" not in cell:
        return None
    name_part, tier_part = cell.rsplit("-", 1)
    tier_clean = re.sub(r"\s*\([^)]*\)\s*$", "", tier_part).strip()
    return {
        "name": _canon(_XF_VOCAB, name_part.strip()),
        "tier": _canon(_TIER_VOCAB, tier_clean),
    }


def _section_bounds(lines: list[str], heading: str) -> tuple[int, int]:
    start = next(i for i, ln in enumerate(lines) if ln.strip() == heading)
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if re.match(r"^##\s", lines[i]) and lines[i].strip() != heading:
            end = i
            break
    return start, end


def parse_lobby(lines: list[str]) -> dict[tuple[str, str], dict]:
    """Parse '## Pre-Game-Lobby' state-2 tables → {(side, pos): fields}."""
    start, end = _section_bounds(lines, "## Pre-Game-Lobby")
    out: dict[tuple[str, str], dict] = {}
    # State-2 tables carry Player Number + Player Name; there is one per side,
    # in document order: first = BGM ('for'), second = opponent ('against').
    state2_tables = [
        (h, r)
        for (h, r) in _parse_tables(lines[start:end])
        if _col(h, "Player Number") is not None and _col(h, "Leader?") is not None
    ]
    for tindex, (headers, rows) in enumerate(state2_tables):
        side = "for" if tindex == 0 else "against"
        ci = {
            "pos": _col(headers, "Position"),
            "level": _col(headers, "Level"),
            "gamertag": _col(headers, "Gamertag", "GamerTag"),
            "platform": _col(headers, "Platform"),
            "height": _col(headers, "Height"),
            "weight": _col(headers, "Weight"),
            "number": _col(headers, "Player Number"),
            "persona": _col(headers, "Player Name"),
            "leader": _col(headers, "Leader?"),
            "xf1": _col(headers, "X-Factor_1"),
            "xf2": _col(headers, "X-Factor_2"),
            "xf3": _col(headers, "X-Factor_3"),
        }
        for row in rows:
            pos = POSITION_LABELS.get(row[ci["pos"]].strip().lower())
            if pos is None:
                continue
            level_cell = row[ci["level"]].strip() if ci["level"] is not None else ""
            gt_cell = row[ci["gamertag"]].strip() if ci["gamertag"] is not None else ""
            # CPU placeholder slots (e.g. a CPU goalie: "Goalie | CPU | - | ...")
            # are excluded — the pipeline filters them via is_cpu.
            if level_cell.upper() == "CPU" or gt_cell in ("", "-"):
                continue
            xfs = [
                _xfactor(row[ci[k]]) if ci[k] is not None else None
                for k in ("xf1", "xf2", "xf3")
            ]
            out[(side, pos)] = {
                "player_level": _level_int(row[ci["level"]]) if ci["level"] is not None else None,
                "gamertag": row[ci["gamertag"]].strip() if ci["gamertag"] is not None else None,
                "platform": row[ci["platform"]].strip() if ci["platform"] is not None else None,
                "height": row[ci["height"]].strip() if ci["height"] is not None else None,
                "weight_lbs": _weight_int(row[ci["weight"]]) if ci["weight"] is not None else None,
                "player_number": _number_int(row[ci["number"]]),
                "persona": row[ci["persona"]].strip() if ci["persona"] is not None else None,
                "is_captain": row[ci["leader"]].strip().lower().startswith("y"),
                "x_factors": [x for x in xfs if x is not None],
            }
    return out


def parse_loadouts(lines: list[str]) -> dict[tuple[str, str], dict]:
    """Parse '## Pre-Game-Loadouts' per-position blocks → {(side, pos): fields}."""
    start, end = _section_bounds(lines, "## Pre-Game-Loadouts")
    section = lines[start:end]
    out: dict[tuple[str, str], dict] = {}
    # Block boundaries are '### Home-Center' / '### Away-Left Defense' headings.
    heading_idxs = [i for i, ln in enumerate(section) if re.match(r"^###\s", ln)]
    heading_idxs.append(len(section))
    for h in range(len(heading_idxs) - 1):
        head = section[heading_idxs[h]].strip().lstrip("#").strip()
        m = re.match(r"(Home|Away)\s*-\s*(.+)", head)
        if not m:
            continue
        side = "for" if m.group(1) == "Home" else "against"
        pos = POSITION_LABELS.get(m.group(2).strip().lower())
        if pos is None:
            continue
        block = section[heading_idxs[h]:heading_idxs[h + 1]]
        tables = _parse_tables(block)
        fields: dict = {"attributes": {}}
        for headers, rows in tables:
            ci_hand = _col(headers, "Shot Handness", "Shot Handedness", "Handedness")
            ci_name = _col(headers, "Name")
            ci_pos = _col(headers, "Position")
            # X-Factors table (one row, cols X-Factor_1..3). Loadout cards show the
            # ability name + tier clearly, so this is the PREFERRED X-Factor source;
            # the lobby table is only a fallback (see build_labels). One card = one
            # row of up to three "Name - Tier" cells.
            ci_xf1 = _col(headers, "X-Factor_1")
            if ci_xf1 is not None and rows:
                xfs = [
                    _xfactor(rows[0][ci])
                    for ci in (
                        _col(headers, "X-Factor_1"),
                        _col(headers, "X-Factor_2"),
                        _col(headers, "X-Factor_3"),
                    )
                    if ci is not None and ci < len(rows[0])
                ]
                fields["x_factors"] = [x for x in xfs if x is not None]
                continue
            # Player Information table.
            if ci_pos is not None and rows:
                row = rows[0]
                if ci_hand is not None:
                    _hand = row[ci_hand].strip()
                    fields["handedness"] = _hand.title() if _hand else None
                if ci_name is not None:
                    fields["persona_full"] = row[ci_name].strip() or None
                ci_build = _col(headers, "Build_Class_Name")
                if ci_build is not None:
                    fields["build_class_canonical"] = _canon(
                        _BUILD_VOCAB, row[ci_build].strip().strip('"')
                    )
                continue
            # Attribute group table: header[0] is a group name. Two layouts:
            #   2-col  | Group | Δ \| R |  → value in col1, no delta (match-250 V2 md)
            #   3-col  | Group | Δ | R |   → delta in col1, value (R) in the last col
            if headers and headers[0].strip().lower() in ATTR_GROUP_NAMES:
                three_col = len(headers) >= 3
                for row in rows:
                    if len(row) < 2:
                        continue
                    key = ATTR_DISPLAY_TO_KEY.get(row[0].strip().lower())
                    if key is None:
                        continue
                    if three_col and len(row) >= 3:
                        val = _number_int(row[-1])
                        # A 3-col table has a delta column, so a blank delta cell
                        # means "no boost" → 0 (distinct from the 2-col case, which
                        # has no delta column at all → None / unknown).
                        delta = _delta_int(row[1])
                        if delta is None:
                            delta = 0
                    else:
                        val = _number_int(row[1])
                        delta = None
                    if val is not None:
                        fields["attributes"][key] = {"value": val, "delta": delta}
        out[(side, pos)] = fields
    return out


def build_labels(md_path: Path, match_id: int, split: str) -> dict:
    lines = md_path.read_text(encoding="utf-8").splitlines()
    lobby = parse_lobby(lines)
    loadouts = parse_loadouts(lines)
    subjects: dict[str, dict] = {}
    for key in sorted(set(lobby) | set(loadouts)):
        side, pos = key
        lb = lobby.get(key, {})
        ld = loadouts.get(key, {})
        subject = {
            "team_side": side,
            "position": pos,
            "gamertag": lb.get("gamertag"),
            "persona": ld.get("persona_full") or lb.get("persona"),
            "player_number": lb.get("player_number"),
            "player_level": lb.get("player_level"),
            "platform": lb.get("platform"),
            "handedness": ld.get("handedness"),
            "height": lb.get("height"),
            "weight_lbs": lb.get("weight_lbs"),
            "is_captain": lb.get("is_captain"),
            "build_class_canonical": ld.get("build_class_canonical")
            or lb.get("build_class_canonical"),
            # Loadout X-Factors are preferred (clearer name + tier on the card);
            # the lobby table is a fallback for when no loadout screen was recorded.
            "x_factors": ld.get("x_factors") or lb.get("x_factors", []),
            "attributes": ld.get("attributes", {}),
        }
        subjects[f"{side}_{pos}"] = subject
    return {
        "match_id": match_id,
        "schema_version": 1,
        "split": split,
        "source": str(md_path),
        "subjects": subjects,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--md", required=True, type=Path)
    ap.add_argument("--match-id", required=True, type=int)
    ap.add_argument("--split", default="held_out", choices=["validation", "held_out"])
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    labels = build_labels(args.md, args.match_id, args.split)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(labels, indent=2) + "\n", encoding="utf-8")
    n = len(labels["subjects"])
    print(f"wrote {args.out} — {n} subjects (match {args.match_id}, split={args.split})")


if __name__ == "__main__":
    main()
