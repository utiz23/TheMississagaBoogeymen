"""
Post-process `_review_index.json` to add per-entry comparison stats
against the hand-keyed pilot file (where one exists). Adds:

  - `pilotComparison.{matches,mismatches,missed,extractedOnly}` counts
  - `pilotComparison.mismatchDetails` list of (key, pilot, extract)

Hand-keyed pilots are at `<title>_<playlist>_pilot.json` in this directory.
Extractor outputs use a distinct pattern (`<title>__<playlist>.extract.json`).
Run after `run_review_queue.py`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DIR = Path(__file__).resolve().parent
INDEX = DIR / "_review_index.json"


def find_pilot(title_slug: str, playlist: str) -> Path | None:
    candidate = DIR / f"{title_slug}_{playlist}_pilot.json"
    return candidate if candidate.exists() else None


def compare(pilot_metrics: dict[str, Any], extract_metrics: dict[str, Any]) -> dict[str, Any]:
    pk = set(pilot_metrics.keys())
    ek = set(extract_metrics.keys())
    matches = 0
    mismatches: list[dict[str, Any]] = []
    for k in pk & ek:
        if str(pilot_metrics[k]) == str(extract_metrics[k]):
            matches += 1
        else:
            mismatches.append({
                "key": k,
                "pilot": pilot_metrics[k],
                "extract": extract_metrics[k],
            })
    missed = sorted(pk - ek)
    extracted_only = sorted(ek - pk)
    return {
        "matches": matches,
        "mismatches": len(mismatches),
        "missed": len(missed),
        "extractedOnly": len(extracted_only),
        "missedKeys": missed,
        "extractedOnlyKeys": extracted_only,
        "mismatchDetails": mismatches,
    }


def main() -> int:
    if not INDEX.exists():
        print(f"Missing {INDEX}. Run run_review_queue.py first.")
        return 1
    idx = json.loads(INDEX.read_text(encoding="utf-8"))
    augmented = 0
    for entry in idx["queue"]:
        pilot_path = find_pilot(entry["titleSlug"], entry["playlist"])
        if not pilot_path:
            continue
        pilot = json.loads(pilot_path.read_text(encoding="utf-8"))
        extract = json.loads((DIR / entry["outputFile"]).read_text(encoding="utf-8"))
        pm = pilot["records"][0]["metrics"]
        em = extract["records"][0]["metrics"]
        cmp_result = compare(pm, em)
        cmp_result["pilotFile"] = pilot_path.name
        entry["pilotComparison"] = cmp_result
        augmented += 1
    INDEX.write_text(json.dumps(idx, indent=2), encoding="utf-8")
    print(f"Augmented {augmented} entries with pilot comparison data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
