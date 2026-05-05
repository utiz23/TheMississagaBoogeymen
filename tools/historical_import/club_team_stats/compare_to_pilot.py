"""
Compare an extractor output JSON to a hand-keyed pilot JSON.

Surfaces, per metric:
  - matched (same value)
  - mismatch (both present, different values)
  - extracted-only (in extractor output but missing from pilot — usually fine)
  - missed (in pilot but extractor failed to capture)

Run:
  python compare_to_pilot.py <pilot.json> <extract.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def load_record(path: Path) -> dict[str, Any]:
    j = json.loads(Path(path).read_text(encoding="utf-8"))
    return j["records"][0]


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: compare_to_pilot.py <pilot.json> <extract.json>", file=sys.stderr)
        return 1
    pilot_path, extract_path = Path(sys.argv[1]), Path(sys.argv[2])
    pilot = load_record(pilot_path)
    extr = load_record(extract_path)

    pm: dict[str, Any] = pilot["metrics"]
    em: dict[str, Any] = extr["metrics"]

    pilot_keys = set(pm.keys())
    extract_keys = set(em.keys())

    matches: list[tuple[str, Any]] = []
    mismatches: list[tuple[str, Any, Any]] = []
    missed: list[tuple[str, Any]] = []  # in pilot, not extracted
    extracted_only: list[tuple[str, Any]] = []

    for k in sorted(pilot_keys | extract_keys):
        pv = pm.get(k)
        ev = em.get(k)
        if k in pilot_keys and k in extract_keys:
            if str(pv) == str(ev):
                matches.append((k, pv))
            else:
                mismatches.append((k, pv, ev))
        elif k in pilot_keys:
            missed.append((k, pv))
        else:
            extracted_only.append((k, ev))

    n_pilot = len(pilot_keys)
    n_extr = len(extract_keys)
    n_match = len(matches)
    n_mismatch = len(mismatches)
    n_missed = len(missed)
    n_extra = len(extracted_only)

    print(f"=== Pilot:    {pilot_path.name} ({n_pilot} metrics)")
    print(f"=== Extract:  {extract_path.name} ({n_extr} metrics)")
    print()
    print(f"matches:        {n_match} / {n_pilot} pilot keys ({n_match/max(n_pilot,1)*100:.0f}% recall on values)")
    print(f"mismatches:     {n_mismatch}")
    print(f"missed (pilot key not in extract): {n_missed}")
    print(f"extracted-only (not in pilot): {n_extra}")
    print()
    if mismatches:
        print("=== mismatches (pilot ↔ extract) ===")
        for k, pv, ev in mismatches:
            print(f"  {k:30} pilot={pv!r}  extract={ev!r}")
        print()
    if missed:
        print("=== missed (pilot has, extractor lacks) ===")
        for k, pv in missed:
            print(f"  {k:30} pilot={pv!r}")
        print()
    if extracted_only:
        print("=== extracted-only ===")
        for k, ev in extracted_only:
            print(f"  {k:30} extract={ev!r}")
        print()

    print(f"=== Notes from extract: {extr.get('notes', '')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
