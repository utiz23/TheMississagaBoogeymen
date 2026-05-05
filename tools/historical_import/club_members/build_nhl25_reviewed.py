"""
Build the import-ready reviewed artifact for the NHL 25 club-member slice
from the merged review artifact, applying:
  - drop fake all-zero goalie rows
  - resolve conflict cells with documented reasoning
  - fill Pratt2016 goalie save_pct from manual screenshot 08 read
  - keep Pratt2016 skater cameo row (single-source but internally consistent)

Writes nhl25_club_members_reviewed.json next to the merged review file.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCREENSHOT_DIR = ROOT / "research" / "Previous_NHL_Stats" / "NHL_25"
MERGED = SCREENSHOT_DIR / "_merged_review.json"
OUT = SCREENSHOT_DIR / "nhl25_club_members_reviewed.json"

# Manual cleanup decisions, keyed by (role_group, lower(gamertag)).
# 'drop' removes the row entirely.
# 'override' patches specific cells with the chosen value + reason.
CLEANUP: dict[tuple[str, str], dict[str, object]] = {
    # 8 all-zero goalie rows: drop entirely (skater members on a goalie view).
    ("goalie", "silkyjoker85"): {"action": "drop"},
    ("goalie", "joeyflopfish"): {"action": "drop"},
    ("goalie", "henrythebobjr"): {"action": "drop"},
    ("goalie", "camrazz"): {"action": "drop"},
    ("goalie", "stick menace"): {"action": "drop"},
    ("goalie", "ordinary_samich"): {"action": "drop"},
    ("goalie", "joseph4577"): {"action": "drop"},
    ("goalie", "mrhomiecide"): {"action": "drop"},
    ("goalie", "mjw501"): {"action": "drop"},
    # The real goalie row: fill missing save_pct from manual read of screenshot 08.
    ("goalie", "pratt2016"): {
        "action": "patch",
        "overrides": {
            "save_pct": {
                "value": 70.0,
                "reason": "manual read of team_leaderboard__08.png — visible '70.0...' for Pratt2016 row; per-cell OCR variants all returned None",
            },
        },
    },
    # Skater conflict resolutions.
    ("skater", "mrhomiecide"): {
        "action": "patch",
        "overrides": {
            "plus_minus": {
                "value": 11,
                "reason": "screenshot 02 says 11, screenshot 06 says 71; with 20 GP a +71 (3.55/gp) is implausible vs the player's other low stats — picking 11",
            },
        },
    },
    ("skater", "mjw501"): {
        "action": "patch",
        "overrides": {
            "plus_minus": {
                "value": -2,
                "reason": "screenshot 02 says 2, screenshot 06 says -2; close inspection of 06 shows the leading minus stroke",
            },
        },
    },
}


def gamertag_to_player_name(g: str) -> str | None:
    # Carry forward the snapshot player names from the prior hand-keyed pilots.
    return None  # use whatever the merged artifact already captured


def main() -> int:
    if not MERGED.exists():
        raise SystemExit(f"missing {MERGED}")
    j = json.loads(MERGED.read_text(encoding="utf-8"))

    records: list[dict[str, object]] = []
    review_notes: list[str] = []
    dropped: list[str] = []

    for r in j["rows"]:
        role = r["roleGroup"]
        identity = r["identityKey"]
        key = (role, identity)
        decision = CLEANUP.get(key, {"action": "keep"})

        if decision["action"] == "drop":
            dropped.append(f"{role}/{r['gamertagSnapshot']}")
            continue

        # Build canonical metrics dict from the merged value field (which
        # is None on conflict cells).
        metrics: dict[str, object] = {}
        for metric_name, cell in r["metrics"].items():
            if cell["value"] is not None:
                metrics[metric_name] = cell["value"]

        applied_overrides: list[str] = []
        if decision["action"] == "patch":
            for metric_name, override in decision["overrides"].items():
                metrics[metric_name] = override["value"]
                applied_overrides.append(
                    f"{role}/{r['gamertagSnapshot']}.{metric_name} = {override['value']} ({override['reason']})"
                )
        review_notes.extend(applied_overrides)

        # Sources — collapse to one composite source pointing at the merged
        # review artifact. The full per-screenshot trail lives in that file.
        # Contributed metrics = the metrics actually populated on this row.
        record = {
            "titleSlug": j["titleSlug"],
            "gameMode": j["gameMode"],
            "roleGroup": role,
            "gamertagSnapshot": r["gamertagSnapshot"],
            "playerNameSnapshot": r["playerNameSnapshot"],
            "importBatch": "nhl25-club-members-reviewed-v3",
            "reviewStatus": "reviewed",
            "metrics": metrics,
            "sources": [
                {
                    "sourceAssetPath": str(MERGED.relative_to(ROOT)),
                    "sortedByMetricLabel": "Reviewed merge of NHL 25 club-members screenshots (8 source PNGs)",
                    "contributedMetrics": sorted(metrics.keys()),
                    "rawExtract": {
                        "contributingScreenshots": r["sourceAssetPaths"],
                        "perScreenshotSortLabels": r["sortedByMetricLabels"],
                    },
                    "reviewStatus": "reviewed",
                    "confidenceScore": 0.9,
                }
            ],
        }
        records.append(record)

    artifact = {
        "_comment": (
            "NHL 25 club-member reviewed artifact. Built from _merged_review.json "
            "via build_nhl25_reviewed.py with manual cleanup decisions. The full "
            "per-screenshot provenance is preserved in _merged_review.json."
        ),
        "_cleanup": {
            "droppedRows": dropped,
            "appliedOverrides": review_notes,
        },
        "records": records,
    }
    OUT.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(f"records: {len(records)}")
    print(f"dropped: {len(dropped)}")
    print(f"overrides applied: {len(review_notes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
