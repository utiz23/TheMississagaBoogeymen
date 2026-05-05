"""
Merge per-screenshot extracts under research/Previous_NHL_Stats/NHL_25/
into one reviewable club-member artifact.

Grain of the merged artifact: one row per (title, mode, role_group,
identity-key). identity-key = lower(gamertag). Each metric value is
recorded with its provenance (which source screenshots contributed) and
its consensus state (single-source / agree / conflict).

The artifact is intentionally NOT auto-imported. It is meant for human
review: rows are tagged 'clean' or 'needs_review' so a reviewer can
focus on the latter.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]

TITLE_DIRS: dict[str, str] = {
    "nhl25": "NHL_25",
    "nhl24": "NHL_24",
    "nhl23": "NHL_23",
    "nhl22": "NHL_22",
}


# Token-level mapping: known on-screen header tokens → canonical snake_case
# metric names. Used by the merger to normalise per-screenshot extracts
# even when the in-extractor canonical mapping wasn't applied (e.g. when
# the sort-label pill was missed by OCR but the metric headers were not).
TOKEN_TO_CANONICAL: dict[str, str] = {
    "SGP": "skater_gp",
    "GGP": "goalie_gp",
    "G": "goals",
    "A": "assists",
    "PTS": "points",
    "+/-": "plus_minus",
    "DNF%": "dnf_pct",
    "PIM": "pim",
    "PPG": "pp_goals",
    "SHG": "sh_goals",
    "HITS": "hits",
    "PASS%": "pass_pct",
    "BS": "blocked_shots",
    "GV": "giveaways",
    "TK": "takeaways",
    "INT": "interceptions",
    "S": "shots",
    "S%": "shooting_pct",
    "GAA": "gaa",
    "GA": "total_goals_against",
    "SV": "total_saves",
    "SV%": "save_pct",
    "SO": "shutouts",
    "SOP": "shutout_periods",
}

# Each canonical metric belongs to exactly one role family. Used by the
# role-aware filter so a screenshot whose role_group resolves to skater
# never bleeds goalie metrics onto skater rows (and vice versa).
SKATER_METRICS: set[str] = {
    "skater_gp", "goalie_gp", "goals", "assists", "points", "plus_minus",
    "dnf_pct", "pim", "pp_goals", "sh_goals", "hits", "pass_pct",
    "blocked_shots", "giveaways", "takeaways", "interceptions",
    "shots", "shooting_pct",
}
GOALIE_METRICS: set[str] = {
    "wins", "losses", "otl", "save_pct", "gaa", "shutouts",
    "shutout_periods", "total_saves", "total_goals_against",
}


# Heuristic: which role_group a screenshot's row data belongs to, based
# on the sorted metric tokens visible. When a screenshot's view family
# could not be inferred, the merger emits the row under an "unknown"
# bucket (review-flagged), never silently misroutes it.
GOALIE_TOKENS: set[str] = {"GAA", "GA", "SV", "SV%", "SO", "SOP"}
SKATER_TOKENS: set[str] = {
    "SGP", "GGP", "G", "A", "PTS", "+/-", "DNF%",
    "PIM", "PPG", "SHG", "HITS", "PASS%",
    "BS", "GV", "TK", "INT", "S", "S%",
}
# Strong goalie tokens — when any of these appear, goalie wins ties.
# This breaks the NHL 22/23 mixed-window bug where one skater token (e.g.
# PASS%) tied with one goalie token (GAA) and the merger defaulted to
# skater, bleeding GAA onto skater rows.
STRONG_GOALIE_TOKENS: set[str] = {"GAA", "GA", "SV", "SV%", "SO"}


def infer_role_from_visible_tokens(tokens: list[str]) -> str:
    """Pick role_group by majority vote over the screenshot's visible tokens.
    Strong goalie tokens win ties (per the NHL 22/23 fix)."""
    sk = sum(1 for t in tokens if t in SKATER_TOKENS)
    go = sum(1 for t in tokens if t in GOALIE_TOKENS)
    if go > sk:
        return "goalie"
    if go == sk and any(t in STRONG_GOALIE_TOKENS for t in tokens):
        return "goalie"
    return "skater"


VIEW_SKELETONS: list[tuple[list[str], list[str | None]]] = [
    # ("Skater Games Played" view) raw cols → canonical metric per slot.
    # When extract sees [SGP, GGP, col_1, col_2] (single-letter G/A headers
    # OCR-dropped), we know col_1=goals and col_2=assists from the view's
    # known left-to-right column order.
    (
        ["SGP", "GGP", "col_1", "col_2"],
        ["skater_gp", "goalie_gp", "goals", "assists"],
    ),
]


def filter_metrics_by_role(stats: dict[str, Any], role: str) -> dict[str, Any]:
    """Drop metrics whose canonical role doesn't match the row's role.
    Without this filter, mixed-column screenshots (e.g. NHL 22/23 pass-pct
    + GAA window) would write goalie metrics onto skater rows."""
    if role == "skater":
        forbidden = GOALIE_METRICS
    elif role == "goalie":
        forbidden = SKATER_METRICS
    else:
        return stats
    return {k: v for k, v in stats.items() if k not in forbidden}


def normalise_row_stats(
    row_stats: dict[str, Any],
    raw_metric_columns: list[str],
    canonical_metrics: list[str],
    canonical_mapping_applied: bool,
    role: str | None = None,
) -> dict[str, Any]:
    """
    Translate a per-screenshot row.stats dict into canonical snake_case
    keys. If the extractor already applied canonical mapping, trust it.
    Otherwise, walk raw_metric_columns and map known OCR-token headers via
    TOKEN_TO_CANONICAL. Synthetic 'col_N' values are mapped via known
    view skeletons when the raw column order matches; otherwise dropped.
    Also derives `points = goals + assists` when both are present and
    `points` is absent.
    """
    if canonical_mapping_applied:
        out = {k: v for k, v in row_stats.items() if v is not None}
    else:
        out = {}
        # Try view-skeleton mapping first.
        for skeleton, slots in VIEW_SKELETONS:
            if raw_metric_columns == skeleton:
                for raw_key, canonical in zip(skeleton, slots):
                    if canonical is None:
                        continue
                    val = row_stats.get(raw_key)
                    if val is None:
                        continue
                    out[canonical] = val
                break
        else:
            # Fall back to per-token mapping.
            for raw_key in raw_metric_columns:
                if raw_key not in row_stats:
                    continue
                value = row_stats[raw_key]
                if value is None:
                    continue
                canonical = TOKEN_TO_CANONICAL.get(raw_key)
                if canonical is None:
                    continue
                out[canonical] = value

    # Derive points = goals + assists when both present and points missing.
    if "goals" in out and "assists" in out and "points" not in out:
        try:
            g = int(out["goals"])
            a = int(out["assists"])
            out["points"] = g + a
        except (TypeError, ValueError):
            pass

    # Role-aware filter — drop metrics whose canonical role doesn't match
    # the row's role. Eliminates the NHL 22/23 GAA-bleed-onto-skater bug
    # without depending on the role-inference heuristic alone.
    if role:
        out = filter_metrics_by_role(out, role)

    return out


def load_extracts(screenshot_dir: Path) -> list[dict[str, Any]]:
    extracts: list[dict[str, Any]] = []
    for path in sorted(screenshot_dir.glob("team_leaderboard__*.extract.json")):
        extracts.append(json.loads(path.read_text(encoding="utf-8")))
    return extracts


def make_identity_key(gamertag: str) -> str:
    return gamertag.strip().lower()


def is_zero_only_goalie_row(stats: dict[str, Any]) -> bool:
    """A goalie-view row contributed by a non-goalie member typically has
    everything zero. We surface zero rows in review but flag them so the
    reviewer can drop them quickly."""
    if not stats:
        return False
    return all((isinstance(v, (int, float)) and v == 0) for v in stats.values())


def consensus(values: list[Any]) -> str:
    if len(values) == 1:
        return "single_source"
    if all(v == values[0] for v in values):
        return "agree"
    return "conflict"


def merge(extracts: list[dict[str, Any]], title_slug: str) -> dict[str, Any]:
    # Bucket every row by (role_group, identity_key).
    # For each metric, store list of (value, source_path) so we can detect
    # conflicts.
    buckets: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "gamertagSnapshot": None,
            "playerNameSnapshot": None,
            "playerLevelSnapshot": None,
            "metricSources": defaultdict(list),  # metric -> [(value, path), ...]
            "sourceAssetPaths": set(),
            "sortedByMetricLabels": set(),
            "rowWarnings": [],
        }
    )

    for ex in extracts:
        src = ex["sourceAssetPath"]
        sort_label = ex.get("sortedByMetricLabel")
        canonical_applied = bool(ex.get("canonicalMappingApplied"))
        raw_metric_cols: list[str] = ex.get("rawMetricColumns") or ex.get("visibleMetricNames", [])
        canonical_metrics: list[str] = ex.get("visibleMetricNames", [])
        # Decide role for this screenshot. If extractor stamped a non-default
        # role via canonical mapping, use it. Otherwise infer from tokens.
        if canonical_applied:
            role = ex["roleGroup"]
        else:
            role = infer_role_from_visible_tokens(raw_metric_cols)
        for row in ex["rows"]:
            tag = row["gamertagSnapshot"]
            if not tag:
                continue
            key = (role, make_identity_key(tag))
            bucket = buckets[key]
            bucket["gamertagSnapshot"] = bucket["gamertagSnapshot"] or tag
            bucket["playerNameSnapshot"] = (
                bucket["playerNameSnapshot"] or row.get("playerNameSnapshot")
            )
            bucket["playerLevelSnapshot"] = (
                bucket["playerLevelSnapshot"] or row.get("playerLevelSnapshot")
            )
            bucket["sourceAssetPaths"].add(src)
            if sort_label:
                bucket["sortedByMetricLabels"].add(sort_label)
            normalised = normalise_row_stats(
                row.get("stats") or {},
                raw_metric_cols,
                canonical_metrics,
                canonical_applied,
                role=role,
            )
            for metric, value in normalised.items():
                if value is None:
                    continue
                bucket["metricSources"][metric].append((value, Path(src).name))
            for w in row.get("warnings") or []:
                bucket["rowWarnings"].append({"sourceFile": Path(src).name, "warning": w})

    # Assemble the merged rows.
    merged_rows: list[dict[str, Any]] = []
    for (role, identity_key), bucket in buckets.items():
        metrics: dict[str, dict[str, Any]] = {}
        warnings: list[str] = []
        conflicts: list[str] = []
        for metric, contributions in sorted(bucket["metricSources"].items()):
            values = [v for v, _ in contributions]
            cons = consensus(values)
            if cons == "conflict":
                conflicts.append(metric)
            metrics[metric] = {
                "value": values[0]
                if cons in {"single_source", "agree"}
                else None,  # leave null on conflict so reviewer must resolve
                "consensus": cons,
                "contributions": [
                    {"value": v, "sourceFile": s} for (v, s) in contributions
                ],
            }
        if conflicts:
            warnings.append(f"conflicts on metrics: {sorted(conflicts)}")

        # Goalie rows that are all-zero (skater members appearing on goalie
        # views) are flagged so reviewer can drop them quickly.
        if role == "goalie":
            non_meta_values = [m["value"] for m in metrics.values() if m["value"] is not None]
            if non_meta_values and all(v == 0 for v in non_meta_values):
                warnings.append("all-zero goalie row — likely a skater member on a goalie view")

        if not metrics:
            warnings.append("no canonical metrics captured")

        review_state = "needs_review" if (warnings or conflicts) else "clean"

        merged_rows.append(
            {
                "roleGroup": role,
                "identityKey": identity_key,
                "gamertagSnapshot": bucket["gamertagSnapshot"],
                "playerNameSnapshot": bucket["playerNameSnapshot"],
                "playerLevelSnapshot": bucket["playerLevelSnapshot"],
                "metrics": metrics,
                "sortedByMetricLabels": sorted(bucket["sortedByMetricLabels"]),
                "sourceAssetPaths": sorted(bucket["sourceAssetPaths"]),
                "warnings": warnings,
                "rowWarnings": bucket["rowWarnings"],
                "reviewState": review_state,
            }
        )

    merged_rows.sort(key=lambda r: (r["roleGroup"], r["identityKey"]))

    # Summary.
    extracts_no_canonical_mapping = [
        Path(e["sourceAssetPath"]).name
        for e in extracts
        if not e.get("canonicalMappingApplied")
    ]
    counts = {
        "totalRows": len(merged_rows),
        "cleanRows": sum(1 for r in merged_rows if r["reviewState"] == "clean"),
        "needsReviewRows": sum(1 for r in merged_rows if r["reviewState"] == "needs_review"),
        "skaterRows": sum(1 for r in merged_rows if r["roleGroup"] == "skater"),
        "goalieRows": sum(1 for r in merged_rows if r["roleGroup"] == "goalie"),
        "totalCellsCaptured": sum(len(r["metrics"]) for r in merged_rows),
        "cellsWithConflict": sum(
            1
            for r in merged_rows
            for m in r["metrics"].values()
            if m["consensus"] == "conflict"
        ),
        "cellsAgreedAcrossSources": sum(
            1
            for r in merged_rows
            for m in r["metrics"].values()
            if m["consensus"] == "agree"
        ),
        "cellsSingleSource": sum(
            1
            for r in merged_rows
            for m in r["metrics"].values()
            if m["consensus"] == "single_source"
        ),
        "extractsNormalisedFromTokens": extracts_no_canonical_mapping,
    }

    return {
        "titleSlug": title_slug,
        "gameMode": "6s",
        "rows": merged_rows,
        "reviewSummary": counts,
    }


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="nhl25", choices=sorted(TITLE_DIRS))
    args = parser.parse_args()
    screenshot_dir = ROOT / "research" / "Previous_NHL_Stats" / TITLE_DIRS[args.title]
    extracts = load_extracts(screenshot_dir)
    if not extracts:
        print(f"No extract artifacts found under {screenshot_dir}. Run sweep first.", file=sys.stderr)
        return 1
    artifact = merge(extracts, args.title)
    out_path = screenshot_dir / "_merged_review.json"
    out_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    summary = artifact["reviewSummary"]
    print(f"Wrote merged review artifact: {out_path}")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
