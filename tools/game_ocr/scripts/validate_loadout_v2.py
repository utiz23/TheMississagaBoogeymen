"""Run the new loadout parser on every match-250 loadout capture and diff
against the V2 benchmark ground truth. Reports per-player + per-field
match rate.

V2 benchmark source:
  research/OCR-SS/Manual OCR benchmark for verification V2.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from game_ocr.extractor import Extractor

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CAP_DIR = REPO_ROOT / "research/OCR-SS/Pre-Game-Loadouts"

# Capture filename → V2 ground truth.
V2 = {
    "vlcsnap-2026-05-10-01h48m53s424.png": {
        "gamertag": "MrHomicide", "position": "C", "name_full": "Evgeni Wanhg", "number": 11,
        "level": 17, "build": "Playmaker", "height": "6'0\"", "weight": "160 lbs", "hand": "Right",
        "xfactors": [("Wheels", "All Star"), ("One T", "All Star"), ("Tape to Tape", "Specialist")],
        "attrs": {
            "wrist_shot_accuracy": 80, "slap_shot_accuracy": 80, "speed": 95, "balance": 82, "agility": 95,
            "wrist_shot_power": 79, "slap_shot_power": 81, "acceleration": 96, "puck_control": 89, "endurance": 94,
            "passing": 90, "offensive_awareness": 90, "body_checking": 72, "stick_checking": 85, "defensive_awareness": 88,
            "hand_eye": 94, "strength": 90, "durability": 80, "shot_blocking": 68,
            "deking": 94, "faceoffs": 90, "discipline": 80, "fighting_skill": 68,
        },
    },
    "vlcsnap-2026-05-10-01h48m58s965.png": {
        "gamertag": "Stick Menace", "position": "LW", "name_full": "Mikko Rantanen", "number": 96,
        "level": 34, "build": "Tage Thompson - PowerForward", "height": "6'6\"", "weight": "220 lbs", "hand": "Right",
        "xfactors": [("Big Rig", "Elite"), ("One T", "Elite"), ("Ankle Breaker", "Elite")],
        "attrs": {
            "wrist_shot_accuracy": 92, "slap_shot_accuracy": 90, "speed": 93, "balance": 90, "agility": 94,
            "wrist_shot_power": 93, "slap_shot_power": 95, "acceleration": 93, "puck_control": 93, "endurance": 90,
            "passing": 90, "offensive_awareness": 91, "body_checking": 82, "stick_checking": 80, "defensive_awareness": 84,
            "hand_eye": 93, "strength": 91, "durability": 97, "shot_blocking": 80,
            "deking": 93, "faceoffs": 90, "discipline": 82, "fighting_skill": 75,
        },
    },
    "vlcsnap-2026-05-10-01h49m12s913.png": {
        # The clean silkyjoker85 capture (the first one was mid-transition).
        "gamertag": "silkyjoker85", "position": "RW", "name_full": "-. Silky", "number": 10,
        "level": 41, "build": "Cole Caufield - Sniper", "height": "5'8\"", "weight": "175 lbs", "hand": "Left",
        "xfactors": [("Quick Release", "Elite"), ("One T", "All Star"), ("Pressure+", "All Star")],
        "attrs": {
            "wrist_shot_accuracy": 95, "slap_shot_accuracy": 94, "speed": 94, "balance": 82, "agility": 94,
            "wrist_shot_power": 93, "slap_shot_power": 93, "acceleration": 93, "puck_control": 89, "endurance": 90,
            "passing": 89, "offensive_awareness": 93, "body_checking": 83, "stick_checking": 82, "defensive_awareness": 84,
            "hand_eye": 93, "strength": 80, "durability": 88, "shot_blocking": 79,
            "deking": 89, "faceoffs": 90, "discipline": 86, "fighting_skill": 60,
        },
    },
    "vlcsnap-2026-05-10-01h49m17s363.png": {
        "gamertag": "HenryTheBobJr", "position": "LD", "name_full": "Hubert Jenkins", "number": 7,
        "level": 35, "build": "Puck Moving Defenseman", "height": "6'0\"", "weight": "160 lbs", "hand": "Right",
        "xfactors": [("Warrior", "All Star"), ("Wheels", "All Star"), ("Quick Release", "Specialist")],
        "attrs": {
            "wrist_shot_accuracy": 87, "slap_shot_accuracy": 77, "speed": 96, "balance": 86, "agility": 89,
            "wrist_shot_power": 87, "slap_shot_power": 75, "acceleration": 96, "puck_control": 90, "endurance": 91,
            "passing": 88, "offensive_awareness": 83, "body_checking": 84, "stick_checking": 88, "defensive_awareness": 90,
            "hand_eye": 92, "strength": 85, "durability": 79, "shot_blocking": 72,
            "deking": 92, "faceoffs": 75, "discipline": 92, "fighting_skill": 78,
        },
    },
    "vlcsnap-2026-05-10-01h49m20s173.png": {
        "gamertag": "JoeyFlopfish", "position": "RD", "name_full": "Lane Hutson", "number": 48,
        "level": 24, "build": "Puck Moving Defenseman", "height": "5'10\"", "weight": "160 lbs", "hand": None,
        "xfactors": [("Elite Edges", "Elite"), ("Tape to Tape", "Specialist"), ("Stick Em Up", "Specialist")],
        "attrs": {
            "wrist_shot_accuracy": 82, "slap_shot_accuracy": 79, "speed": 97, "balance": 82, "agility": 96,
            "wrist_shot_power": 81, "slap_shot_power": 83, "acceleration": 95, "puck_control": 92, "endurance": 93,
            "passing": 97, "offensive_awareness": 95, "body_checking": 75, "stick_checking": 85, "defensive_awareness": 88,
            "hand_eye": 88, "strength": 85, "durability": 83, "shot_blocking": 73,
            "deking": 92, "faceoffs": 75, "discipline": 92, "fighting_skill": 77,
        },
    },
}


def compare(captured, expected):
    matches, total = 0, 0
    misses: list[tuple[str, object, object]] = []
    for key, exp in expected.items():
        total += 1
        got = captured.get(key)
        if isinstance(got, dict):
            got = got.get("value")
        if got == exp:
            matches += 1
        else:
            misses.append((key, exp, got))
    return matches, total, misses


def main() -> int:
    extractor = Extractor()
    overall_matches = overall_total = 0
    print(f"{'capture':45s}  {'player':25s}  {'matches/total':>15s}")
    print("-" * 100)
    all_misses = []
    for cap_name, gt in V2.items():
        path = CAP_DIR / cap_name
        result = extractor.extract_path("player_loadout_view", path)
        d = result.model_dump(mode="json")

        # Flatten captured into expected-format dict
        attrs_captured = {}
        for group in d["attributes"].values():
            for k, v in group["values"].items():
                attrs_captured[k] = v.get("value")
        xf_names = [(x.get("value"), t.get("value")) for x, t in zip(d["x_factors"], d["x_factor_tiers"])]

        captured_attrs = attrs_captured
        attr_matches, attr_total, attr_misses = compare(captured_attrs, gt["attrs"])

        # Scalar comparisons
        scalar_expected = {
            "gamertag": gt["gamertag"], "player_position": gt["position"],
            "player_name_full": gt["name_full"], "player_number": gt["number"],
            "player_level": gt["level"], "build_class": gt["build"],
            "height": gt["height"], "weight": gt["weight"], "handedness": gt["hand"],
        }
        scalar_misses = []
        scalar_matches = scalar_total = 0
        for key, exp in scalar_expected.items():
            scalar_total += 1
            got = d[key].get("value")
            # Allow case/space variations for free-text fields
            def norm(v):
                return None if v is None else str(v).strip().lower().replace(" ", "")
            if norm(got) == norm(exp):
                scalar_matches += 1
            else:
                scalar_misses.append((key, exp, got))

        # X-Factor comparison (names fuzzy, tier exact)
        def norm_xf(s): return (s or "").upper().replace(" ", "")
        xf_matches = xf_total = 0
        for (got_name, got_tier), (exp_name, exp_tier) in zip(xf_names, gt["xfactors"]):
            xf_total += 2
            if norm_xf(got_name) == norm_xf(exp_name):
                xf_matches += 1
            else:
                scalar_misses.append((f"xf_name", exp_name, got_name))
            if got_tier == exp_tier:
                xf_matches += 1
            else:
                scalar_misses.append((f"xf_tier", exp_tier, got_tier))

        total = scalar_total + xf_total + attr_total
        matches = scalar_matches + xf_matches + attr_matches
        overall_matches += matches
        overall_total += total
        print(f"  {cap_name:43s}  {gt['gamertag']:25s}  {matches}/{total:3d}  ({100*matches//total}%)")
        if scalar_misses or attr_misses:
            for k, e, g in (scalar_misses + attr_misses):
                print(f"      MISS {k:25s} expected={repr(e):20s} got={repr(g)}")

    print("-" * 100)
    print(f"  OVERALL: {overall_matches}/{overall_total} = {100*overall_matches/overall_total:.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
