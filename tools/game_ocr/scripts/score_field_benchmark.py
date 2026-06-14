"""Score pre-game lobby/loadout extraction against hand-labeled ground truth.

Produces a per-field precision/recall/F1 report (the accuracy contract for the
near-perfect-extraction program). It validates *which artifact*:

  --from-extractor <bundle_dir>   run the extractor pipeline on frames (no DB);
                                  validates RAW per-field extraction only.
  --evidence-json <path>          score a precomputed FieldEvidenceRecord list
                                  (e.g. a committed golden — the parity-locked
                                  current-main extractor output). Deterministic.
  --from-consolidated <json>      score the consolidated surface emitted by the
                                  read-only `validate-consolidated` dry-run
                                  (the true final artifact, pre-activation).
  --from-db (Phase G)             score the active run's canonical tables.

Usage (deterministic baseline against the committed match-250 golden):
    tools/game_ocr/.venv/bin/python tools/game_ocr/scripts/score_field_benchmark.py \
        --labels tools/game_ocr/calibration/extras/loadout/benchmark/labels/250.json \
        --evidence-json tools/game_ocr/calibration/extras/loadout/fixtures/fixture_match250_full_lobby/expected_loadout_evidence.json \
        --out tools/game_ocr/calibration/extras/loadout/benchmark/reports/250-baseline.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from game_ocr.benchmark.report import format_table, score_match


def _load_records(args) -> list:
    if args.evidence_json:
        return json.loads(Path(args.evidence_json).read_text(encoding="utf-8"))
    if args.from_consolidated:
        return json.loads(Path(args.from_consolidated).read_text(encoding="utf-8"))
    if args.from_extractor:
        from game_ocr.loadout_evidence import extract_loadout_evidence

        records, _ = extract_loadout_evidence(
            bundle_dir=Path(args.from_extractor), segment_index=args.segment_index
        )
        return [r.to_dict() for r in records]
    raise SystemExit("provide one of --evidence-json / --from-extractor / --from-consolidated")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--labels", required=True, type=Path)
    ap.add_argument("--evidence-json", type=Path)
    ap.add_argument("--from-extractor", type=Path, metavar="BUNDLE_DIR")
    ap.add_argument("--from-consolidated", type=Path, metavar="JSON")
    ap.add_argument("--segment-index", type=int, default=2)
    ap.add_argument("--out", type=Path, help="Write the report JSON here.")
    args = ap.parse_args()

    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    records = _load_records(args)
    report = score_match(labels, records)

    print(format_table(report))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
