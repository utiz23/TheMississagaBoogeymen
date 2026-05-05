"""
Build NHL 22 reviewed artifact from _merged_review.json.

Cleanup decisions:
  - drop 6 fake all-zero goalie rows (skater members on goalie views)
  - multiply save_pct by 100 (NHL 22 displays save_pct as a fraction)
  - resolve camrazz.assists conflict (98 vs 86) → 98 (matches G+A=PTS:
    85 + 98 = 183 = points, while 85 + 86 = 171 ≠ 183)
  - mark unmatched-by-design players with needs_identity_match:
      * adolph151 (no current player record; old Boogeymen member)
      * Flopfish8015 (known JoeyFlopfish alt — same handling as NHL 23)
      * Utiz23 (the club captain in NHL 22; not in current players —
        all-zero stats indicate he was a roster member who never played
        a game in this title)
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCREENSHOT_DIR = ROOT / "research" / "Previous_NHL_Stats" / "NHL_22"
MERGED = SCREENSHOT_DIR / "_merged_review.json"
OUT = SCREENSHOT_DIR / "nhl22_club_members_reviewed.json"

CLEANUP: dict[tuple[str, str], dict[str, object]] = {
    # 6 fake all-zero goalie rows (skater members on goalie views).
    ("goalie", "adolph151"): {"action": "drop"},
    ("goalie", "camrazz"): {"action": "drop"},
    ("goalie", "flopfish8015"): {"action": "drop"},
    ("goalie", "henrythebobjr"): {"action": "drop"},
    ("goalie", "mrhomiecide"): {"action": "drop"},
    ("goalie", "utiz23"): {"action": "drop"},
    # Resolve camrazz.assists conflict (math validates 98 over 86).
    ("skater", "camrazz"): {
        "action": "patch",
        "overrides": {
            "assists": {
                "value": 98,
                "reason": "screenshot 01 says 98, screenshot 02 says 86; G+A=PTS check (85+98=183=points) selects 98",
            },
        },
    },
    # Utiz23 is silkyjoker85's alt; all-zero stats — drop entirely.
    # Historical truth preserved via player_gamertag_history entry.
    ("skater", "utiz23"): {"action": "drop"},
    # Flopfish8015 is JoeyFlopfish's alt; additively merge into JoeyFlopfish skater.
    ("skater", "flopfish8015"): {
        "action": "merge_into",
        "target_identity_key": "joeyflopfish",
    },
    # adolph151 now has a retired-member players row (id=25). Importer
    # will auto-match via gamertag history. Marked reviewed (was previously
    # needs_identity_match before player record existed).
}


# Integer count metrics that should sum on additive merge.
ADDITIVE_INT_METRICS = {
    "skater_gp", "goalie_gp", "goals", "assists", "points", "plus_minus",
    "pim", "pp_goals", "sh_goals", "hits", "blocked_shots", "giveaways",
    "takeaways", "interceptions", "shots", "wins", "losses", "otl",
    "shutouts", "shutout_periods", "total_saves", "total_goals_against",
}
# Rate metrics — recomputed exactly from underlying counts where possible.
RECOMPUTABLE_RATES = {
    # save_pct = total_saves / (total_saves + total_goals_against)
    "save_pct": ("total_saves", "total_goals_against"),
}


def additive_merge(target: dict, addition: dict) -> dict:
    """Sum integer-count metrics; recompute save_pct exactly from sums.
    Other rate metrics (gaa, pass_pct, dnf_pct, shooting_pct) preserve
    the target's value — Flopfish8015 is small relative to JoeyFlopfish
    and weighting differences are negligible vs OCR noise."""
    out = dict(target)
    for k, v in addition.items():
        if k in ADDITIVE_INT_METRICS:
            out[k] = (out.get(k) or 0) + (v or 0)
        elif k not in out:
            # If target lacks the metric but addition has it, take it.
            out[k] = v
    # Recompute save_pct exactly when both underlying counts are present.
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
    pending_merges: dict[tuple[str, str], dict] = {}  # target_key -> addition stats

    # First pass — handle merge_into decisions.
    for r in j["rows"]:
        role = r["roleGroup"]
        identity = r["identityKey"]
        key = (role, identity)
        decision = CLEANUP.get(key, {"action": "keep"})
        if decision.get("action") == "merge_into":
            target = (role, decision["target_identity_key"])
            metrics = {k: cell["value"] for k, cell in r["metrics"].items() if cell["value"] is not None}
            pending_merges[target] = metrics
            review_notes.append(
                f"{role}/{r['gamertagSnapshot']}: additive-merged into {target[1]} (alt account); merged metrics={sorted(metrics.keys())}"
            )

    for r in j["rows"]:
        role = r["roleGroup"]
        identity = r["identityKey"]
        key = (role, identity)
        decision = CLEANUP.get(key, {"action": "keep"})

        if decision.get("action") == "merge_into":
            # Already accumulated into pending_merges for the target row.
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

        # NHL 22 quirk: save_pct as fraction.
        if role == "goalie" and "save_pct" in metrics:
            sp = float(metrics["save_pct"])
            metrics["save_pct"] = round(sp * 100, 2)
            review_notes.append(
                f"{role}/{r['gamertagSnapshot']}.save_pct: {sp} → {metrics['save_pct']} (NHL 22 fraction → percent)"
            )

        # Apply any pending additive merge from an alt account (e.g. Flopfish8015).
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
            "importBatch": "nhl22-club-members-reviewed-v1",
            "reviewStatus": review_status,
            "metrics": metrics,
            "sources": [
                {
                    "sourceAssetPath": str(MERGED.relative_to(ROOT)),
                    "sortedByMetricLabel": "Reviewed merge of NHL 22 club-members screenshots (4 source PNGs)",
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
            "NHL 22 club-member reviewed artifact. Built from _merged_review.json. "
            "Save_pct converted from fraction to percent. Per-screenshot trail "
            "preserved in _merged_review.json."
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
