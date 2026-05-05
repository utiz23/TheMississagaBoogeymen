"""
Build NHL 24 reviewed artifact from _merged_review.json with manual cleanup:
  - drop 4 fake all-zero goalie rows
  - multiply save_pct by 100 (NHL 24 displays save_pct as a fraction; our
    schema stores percentages)
  - patch JoeyFlopfish.total_saves = 633 (OCR returned 89; math derives 633
    from 0.77 = SV/(SV+GA) with GA=189)
  - keep 4 real goalie rows (multi-goalie title — different from NHL 25)
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCREENSHOT_DIR = ROOT / "research" / "Previous_NHL_Stats" / "NHL_24"
MERGED = SCREENSHOT_DIR / "_merged_review.json"
OUT = SCREENSHOT_DIR / "nhl24_club_members_reviewed.json"

CLEANUP: dict[tuple[str, str], dict[str, object]] = {
    # 4 all-zero goalie rows: drop entirely (skater members on a goalie view).
    ("goalie", "boshbandrews"): {"action": "drop"},
    ("goalie", "camrazz"): {"action": "drop"},
    ("goalie", "joseph4577"): {"action": "drop"},
    ("goalie", "mrhomiecide"): {"action": "drop"},
    # JoeyFlopfish goalie row — fix OCR-bad total_saves.
    ("goalie", "joeyflopfish"): {
        "action": "patch",
        "overrides": {
            "total_saves": {
                "value": 633,
                "reason": "screenshot 04 OCR returned 89; math derives 633 from save_pct=0.77 = 633/(633+189) with GA=189",
            },
        },
    },
}


def main() -> int:
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

        metrics: dict[str, object] = {}
        for metric_name, cell in r["metrics"].items():
            if cell["value"] is None:
                continue
            metrics[metric_name] = cell["value"]

        # NHL 24 quirk: save_pct is captured as a fraction; convert to %.
        if role == "goalie" and "save_pct" in metrics:
            sp = float(metrics["save_pct"])
            metrics["save_pct"] = round(sp * 100, 2)
            review_notes.append(
                f"{role}/{r['gamertagSnapshot']}.save_pct: {sp} → {metrics['save_pct']} (NHL 24 displays save_pct as a fraction; schema stores percent)"
            )

        applied_overrides: list[str] = []
        if decision["action"] == "patch":
            for metric_name, override in decision["overrides"].items():
                metrics[metric_name] = override["value"]
                applied_overrides.append(
                    f"{role}/{r['gamertagSnapshot']}.{metric_name} = {override['value']} ({override['reason']})"
                )
        review_notes.extend(applied_overrides)

        record = {
            "titleSlug": j["titleSlug"],
            "gameMode": j["gameMode"],
            "roleGroup": role,
            "gamertagSnapshot": r["gamertagSnapshot"],
            "playerNameSnapshot": r["playerNameSnapshot"],
            "importBatch": "nhl24-club-members-reviewed-v1",
            "reviewStatus": "reviewed",
            "metrics": metrics,
            "sources": [
                {
                    "sourceAssetPath": str(MERGED.relative_to(ROOT)),
                    "sortedByMetricLabel": "Reviewed merge of NHL 24 club-members screenshots (4 source PNGs)",
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
            "NHL 24 club-member reviewed artifact. Built from _merged_review.json "
            "via build_nhl24_reviewed.py. Save_pct values are converted from "
            "NHL-24-display fraction to percent. The full per-screenshot trail "
            "is preserved in _merged_review.json."
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
