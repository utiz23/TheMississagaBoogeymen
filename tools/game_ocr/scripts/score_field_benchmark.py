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
  --from-db --match-id N          score the ACTIVE run's committed canonical
                                  surface. Resolves the active decoder run for
                                  match N, shells to `decoder-runs
                                  validate-consolidated --run-id <active>
                                  --active`, and scores its JSON. Reuses the one
                                  TS serializer (no second Python serializer to
                                  drift). Post-flip confirmation for Phase G.

Usage (deterministic baseline against the committed match-250 golden):
    tools/game_ocr/.venv/bin/python tools/game_ocr/scripts/score_field_benchmark.py \
        --labels tools/game_ocr/calibration/extras/loadout/benchmark/labels/250.json \
        --evidence-json tools/game_ocr/calibration/extras/loadout/fixtures/fixture_match250_full_lobby/expected_loadout_evidence.json \
        --out tools/game_ocr/calibration/extras/loadout/benchmark/reports/250-baseline.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from game_ocr.benchmark.report import format_table, score_match

# repo root = tools/game_ocr/scripts/score_field_benchmark.py → parents[3].
REPO_ROOT = Path(__file__).resolve().parents[3]

# Local Postgres container (mirrors reprocess.py). Used only to resolve the
# active run id for --from-db; the surface itself comes from the TS serializer.
_DB_CONTAINER = "eanhl-team-website-db-1"


def _resolve_active_run_id(match_id: int) -> int:
    """Return the active ``ocr_decoder_runs.id`` for ``match_id`` via psql."""
    res = subprocess.run(
        [
            "docker", "exec", _DB_CONTAINER,
            "psql", "-U", "eanhl", "-d", "eanhl", "-t", "-A", "-c",
            f"SELECT id FROM ocr_decoder_runs "
            f"WHERE match_id = {int(match_id)} AND is_active = true LIMIT 1",
        ],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise SystemExit(
            f"--from-db: failed to resolve active run for match {match_id}: "
            f"{res.stderr.strip()}"
        )
    run_id = res.stdout.strip()
    if not run_id:
        raise SystemExit(f"--from-db: no active decoder run for match {match_id}")
    return int(run_id)


def _records_from_db(match_id: int) -> list:
    """Score the committed active surface: resolve the active run, then shell to
    the shared TS serializer (`decoder-runs validate-consolidated --active`)."""
    run_id = _resolve_active_run_id(match_id)
    res = subprocess.run(
        [
            "pnpm", "--filter", "@eanhl/worker", "decoder-runs",
            "validate-consolidated", "--run-id", str(run_id), "--active",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise SystemExit(
            f"--from-db: validate-consolidated --run-id {run_id} --active "
            f"exited {res.returncode}:\n{res.stderr}"
        )
    # The CLI prints one JSON array on stdout; pnpm may prepend header lines,
    # so walk bottom-up and take the last line starting with '['.
    for line in res.stdout.strip().splitlines()[::-1]:
        stripped = line.strip()
        if stripped.startswith("["):
            return json.loads(stripped)
    raise SystemExit(
        f"--from-db: no JSON payload in validate-consolidated output:\n{res.stdout}"
    )


def _load_records(args) -> list:
    if args.evidence_json:
        return json.loads(Path(args.evidence_json).read_text(encoding="utf-8"))
    if args.from_consolidated:
        return json.loads(Path(args.from_consolidated).read_text(encoding="utf-8"))
    if args.from_db:
        if not args.match_id:
            raise SystemExit("--from-db requires --match-id N")
        return _records_from_db(args.match_id)
    if args.from_extractor:
        from game_ocr.loadout_evidence import extract_loadout_evidence

        records, _ = extract_loadout_evidence(
            bundle_dir=Path(args.from_extractor), segment_index=args.segment_index
        )
        return [r.to_dict() for r in records]
    raise SystemExit(
        "provide one of --evidence-json / --from-extractor / --from-consolidated / --from-db"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--labels", required=True, type=Path)
    ap.add_argument("--evidence-json", type=Path)
    ap.add_argument("--from-extractor", type=Path, metavar="BUNDLE_DIR")
    ap.add_argument("--from-consolidated", type=Path, metavar="JSON")
    ap.add_argument(
        "--from-db",
        action="store_true",
        help="Score the active run's committed canonical surface (needs --match-id).",
    )
    ap.add_argument("--match-id", type=int, help="Match id for --from-db.")
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
