"""
Build NHL 23 reviewed artifact from _merged_review.json.

Cleanup decisions:
  - drop 3 fake all-zero goalie rows (skater members on goalie views)
  - multiply save_pct by 100 (NHL 23 displays save_pct as a fraction)
  - patch Flopfish8015 goalie total_saves = 9 (OCR returned 6;
    math derives 9 from save_pct=0.643 = 9/(9+5) with GA=5)
  - leave Flopfish8015 with player_id=NULL (review_status='needs_identity_match');
    Flopfish8015 is a known JoeyFlopfish alt-account but the schema's partial
    unique index forbids two skater rows with player_id=5 in the same slice;
    keep the snapshot row unmatched so the historical truth is preserved
    and a future reviewer can decide whether to additive-merge into the
    JoeyFlopfish row.
  - AwesomeLion50 should auto-match to player_id=20 via the gamertag-history
    entry added during the NHL 24 task.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCREENSHOT_DIR = ROOT / "research" / "Previous_NHL_Stats" / "NHL_23"
MERGED = SCREENSHOT_DIR / "_merged_review.json"
OUT = SCREENSHOT_DIR / "nhl23_club_members_reviewed.json"

CLEANUP: dict[tuple[str, str], dict[str, object]] = {
    # 3 all-zero goalie rows: drop entirely.
    ("goalie", "awesomelion50"): {"action": "drop"},
    ("goalie", "henrythebobjr"): {"action": "drop"},
    ("goalie", "mrhomiecide"): {"action": "drop"},
    # Flopfish8015 is JoeyFlopfish's alt — additively merge BOTH skater and
    # goalie rows into JoeyFlopfish.
    # First fix Flopfish8015 goalie's OCR-bad total_saves before the merge.
    ("goalie", "flopfish8015"): {
        "action": "patch_then_merge",
        "target_identity_key": "joeyflopfish",
        "overrides": {
            "total_saves": {
                "value": 9,
                "reason": "screenshot 04 OCR returned 6; math derives 9 from save_pct=0.643 = 9/(9+5) with GA=5",
            },
        },
    },
    ("skater", "flopfish8015"): {
        "action": "merge_into",
        "target_identity_key": "joeyflopfish",
    },
}


# Integer count metrics that should sum on additive merge.
ADDITIVE_INT_METRICS = {
    "skater_gp", "goalie_gp", "goals", "assists", "points", "plus_minus",
    "pim", "pp_goals", "sh_goals", "hits", "blocked_shots", "giveaways",
    "takeaways", "interceptions", "shots", "wins", "losses", "otl",
    "shutouts", "shutout_periods", "total_saves", "total_goals_against",
}


def additive_merge(target: dict, addition: dict) -> dict:
    """Sum integer-count metrics; recompute save_pct exactly from sums."""
    out = dict(target)
    for k, v in addition.items():
        if k in ADDITIVE_INT_METRICS:
            out[k] = (out.get(k) or 0) + (v or 0)
        elif k not in out:
            out[k] = v
    sv = out.get("total_saves")
    ga = out.get("total_goals_against")
    if sv is not None and ga is not None and (sv + ga) > 0:
        out["save_pct"] = round(sv / (sv + ga) * 100, 2)
    return out


def main() -> int:
    j = json.loads(MERGED.read_text(encoding="utf-8"))

    records: list[dict[str, object]] = []
    review_notes: list[str] = []
    dropped: list[str] = []
    pending_merges: dict[tuple[str, str], dict] = {}

    # First pass — collect merge_into / patch_then_merge metrics.
    for r in j["rows"]:
        role = r["roleGroup"]
        key = (role, r["identityKey"])
        decision = CLEANUP.get(key, {"action": "keep"})
        if decision.get("action") not in ("merge_into", "patch_then_merge"):
            continue
        metrics = {k: cell["value"] for k, cell in r["metrics"].items() if cell["value"] is not None}
        # Apply patch overrides (e.g. Flopfish8015 goalie total_saves) before merging.
        for metric_name, override in decision.get("overrides", {}).items():
            metrics[metric_name] = override["value"]
            review_notes.append(
                f"{role}/{r['gamertagSnapshot']}.{metric_name} = {override['value']} ({override['reason']}) [pre-merge]"
            )
        # NHL 23 fraction → percent for save_pct, before merge.
        if role == "goalie" and "save_pct" in metrics and isinstance(metrics["save_pct"], (int, float)):
            sp = float(metrics["save_pct"])
            if sp <= 1.5:  # fraction form
                metrics["save_pct"] = round(sp * 100, 2)
        target = (role, decision["target_identity_key"])
        pending_merges[target] = metrics
        review_notes.append(
            f"{role}/{r['gamertagSnapshot']}: additive-merged into {target[1]} (alt account); merged metrics={sorted(metrics.keys())}"
        )

    for r in j["rows"]:
        role = r["roleGroup"]
        identity = r["identityKey"]
        key = (role, identity)
        decision = CLEANUP.get(key, {"action": "keep"})

        if decision.get("action") in ("merge_into", "patch_then_merge"):
            dropped.append(f"{role}/{r['gamertagSnapshot']} (merged into {decision['target_identity_key']})")
            continue

        if decision["action"] == "drop":
            dropped.append(f"{role}/{r['gamertagSnapshot']}")
            continue

        metrics: dict[str, object] = {}
        for metric_name, cell in r["metrics"].items():
            if cell["value"] is None:
                continue
            metrics[metric_name] = cell["value"]

        # NHL 23 quirk: save_pct is captured as a fraction; convert to %.
        if role == "goalie" and "save_pct" in metrics:
            sp = float(metrics["save_pct"])
            metrics["save_pct"] = round(sp * 100, 2)
            review_notes.append(
                f"{role}/{r['gamertagSnapshot']}.save_pct: {sp} → {metrics['save_pct']} (NHL 23 fraction → percent)"
            )

        # Apply pending additive merge if this row is a merge target.
        merge_addition = pending_merges.pop(key, None)
        if merge_addition:
            before_keys = sorted(metrics.keys())
            metrics = additive_merge(metrics, merge_addition)
            review_notes.append(
                f"{role}/{r['gamertagSnapshot']}: additively-merged alt-account values; before keys={before_keys}, after keys={sorted(metrics.keys())}"
            )

        review_status = "reviewed"
        if decision["action"] in ("patch", "patch_and_mark"):
            for metric_name, override in decision.get("overrides", {}).items():
                metrics[metric_name] = override["value"]
                review_notes.append(
                    f"{role}/{r['gamertagSnapshot']}.{metric_name} = {override['value']} ({override['reason']})"
                )
        if decision["action"] in ("mark", "patch_and_mark"):
            review_status = decision.get("review_status_override", "reviewed")
            note = decision.get("note")
            if note:
                review_notes.append(f"{role}/{r['gamertagSnapshot']}: {note}")

        record = {
            "titleSlug": j["titleSlug"],
            "gameMode": j["gameMode"],
            "roleGroup": role,
            "gamertagSnapshot": r["gamertagSnapshot"],
            "playerNameSnapshot": r["playerNameSnapshot"],
            "importBatch": "nhl23-club-members-reviewed-v1",
            "reviewStatus": review_status,
            "metrics": metrics,
            "sources": [
                {
                    "sourceAssetPath": str(MERGED.relative_to(ROOT)),
                    "sortedByMetricLabel": "Reviewed merge of NHL 23 club-members screenshots (4 source PNGs)",
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
            "NHL 23 club-member reviewed artifact. Built from _merged_review.json. "
            "save_pct values converted from NHL-23-display fraction to percent. "
            "Per-screenshot trail in _merged_review.json."
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
