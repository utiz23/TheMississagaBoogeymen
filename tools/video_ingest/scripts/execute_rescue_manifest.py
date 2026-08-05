"""Stage-B: execute the approved auto windows of a post-game rescue manifest.

DRY RUN BY DEFAULT. With no flags this validates the manifest, preflights every
artifact the auto set needs, reads (never writes) the database to find which
windows' output is verifiably already there, prints the plan, and exits having
run nothing.

Promotion requires the explicit ``--execute`` opt-in.

Three guarantees, stated exactly:

* **The artifact preflight is all-or-nothing.** One missing cache entry or
  source video aborts before any subprocess and before the database is read.
  Nothing runs and nothing is written.
* **The environment preflight runs before the first mutation.** ``--execute``
  aborts before creating a batch directory, before ffmpeg, before ingest-ocr and
  before any receipt if the environment those subprocesses will inherit is
  unusable. See ``REQUIRED_EXECUTION_ENV``.
* **Execution is fail-fast, not atomic.** Windows run in order and the run stops
  at the first failure — including a window whose commands exited 0 but whose
  output does not verify. Windows that completed *before* that point have really
  been written and are not rolled back; they are verified complete, so a rerun
  skips them and resumes at the failure.

This script is the IO shell only — the filesystem, ``docker exec psql`` and
``subprocess``. Every decision, guard and fingerprint check lives in
``video_ingest.rescue_execute`` so it is unit-testable without a cache, a video,
ffmpeg or a database. Nothing here recomputes Stage A: the manifest's
classification, identity, geometry, decisions and pinned argv are consumed
verbatim.

Run (the repo-root .venv-1 is the pytest/python runner; the GPU
tools/video_ingest/.venv has no pytest -- see [[reference_gpu_ocr_venv]]):

    # 1. Dry run. Needs no .env: it spawns nothing, and it is the right command
    #    to reach for when the environment itself is what you are diagnosing.
    cd tools/video_ingest && PYTHONPATH=.:../game_ocr \\
      ../../.venv-1/bin/python scripts/execute_rescue_manifest.py \\
      --manifest ~/ingest-cache/rescue-manifest.json

    # 2. Only after reading that plan. `--execute` spawns `pnpm --filter worker
    #    ingest-ocr`, which INHERITS this shell -- it needs DATABASE_URL (else
    #    @eanhl/db throws at import) and OCR_PYTHON (else ocr-cli-runner.ts
    #    silently falls back to a bare `python3` and writes the rescue batch
    #    from an interpreter nobody chose). Load the repository .env first:
    set -a && source /path/to/eanhl-team-website/.env && set +a
    cd tools/video_ingest && PYTHONPATH=.:../game_ocr \\
      ../../.venv-1/bin/python scripts/execute_rescue_manifest.py \\
      --manifest ~/ingest-cache/rescue-manifest.json --execute

The ``.env`` is sourced by the OPERATOR, never by this script. Stage B validates
its inputs; it does not resolve them -- the same rule the manifest's
``cache_root`` and ``video_ingest.cache_root`` already follow. A run that
silently repaired its own environment would be a run whose provenance depended
on a file nobody named.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from video_ingest.rescue_execute import (
    EXECUTE_FLAG,
    EXTRACTION_SUCCESS,
    RESCUE_DIR_MARKER,
    CommandResult,
    CompletionFact,
    RescueAborted,
    run_rescue,
)

DEFAULT_CONTAINER = "eanhl-team-website-db-1"

#: Appended to, never rewritten: one JSON object per executed window, carrying
#: the manifest digest, promotion key and per-command fingerprints. This is the
#: local half of the provenance trail; the durable half is the rescue tag on the
#: rows themselves.
RECEIPTS_FILENAME = "rescue-receipts.jsonl"


def run_psql(sql: str, *, container: str, user: str, db: str) -> list[dict[str, Any]]:
    """Run a SELECT via `docker exec psql` and parse its JSON output.

    Same read-only pattern as Stage A's generator.
    """
    wrapped = f"SELECT coalesce(json_agg(t), '[]'::json) FROM ({sql}) t"
    proc = subprocess.run(
        ["docker", "exec", container, "psql", "-U", user, "-d", db, "-At", "-c", wrapped],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RescueAborted(
            "database probe failed (needed to tell completed windows apart from "
            "unfinished ones):\n"
            f"  {proc.stderr.strip()}"
        )
    return json.loads(proc.stdout.strip() or "[]")


#: Every rescue capture batch, LEFT JOINed to its segment and carrying the two
#: extraction counts — the raw material for `completion_problems`.
#:
#: The join is LEFT on purpose. `ingest-ocr` writes the batch row before it
#: processes anything and only warns if the segment write fails, so a batch with
#: no segment is a real, reachable state — and the state that most needs
#: reporting. An INNER join would make it indistinguishable from "never ran".
#:
#: `t_start_sec`/`t_end_sec` are cast to text so the numeric(10,3) arrives with
#: its scale intact and compares exactly against the manifest's `%.3f` bounds.
COMPLETION_SQL = f"""
SELECT b.video_sha256,
       b.source_directory,
       b.run_id,
       b.match_id                                   AS batch_match_id,
       s.segment_key,
       s.match_id                                   AS segment_match_id,
       s.run_id                                     AS segment_run_id,
       s.state,
       s.t_start_sec::text                          AS t_start_sec,
       s.t_end_sec::text                            AS t_end_sec,
       s.decoder_version,
       s.frame_count,
       s.observability_status,
       (SELECT count(*) FROM ocr_extractions e
         WHERE e.batch_id = b.id)                   AS extraction_count,
       (SELECT count(*) FROM ocr_extractions e
         WHERE e.batch_id = b.id
           AND e.transform_status
             = '{EXTRACTION_SUCCESS}')              AS extraction_success_count
  FROM ocr_capture_batches b
  LEFT JOIN ocr_segments s ON s.capture_batch_id = b.id
 WHERE b.source_directory LIKE '%{RESCUE_DIR_MARKER}%'
"""


def _int_or_none(value: Any) -> int | None:
    return int(value) if value is not None else None


def completion_facts(*, container: str, user: str, db: str) -> list[CompletionFact]:
    """What the database actually holds for every rescue batch.

    Read-only, and the ONLY database access Stage B performs — used both to
    partition the plan and to verify each window's postcondition, so the two
    can never diverge.
    """
    rows = run_psql(COMPLETION_SQL, container=container, user=user, db=db)
    return [
        CompletionFact(
            video_sha256=str(r["video_sha256"] or ""),
            source_directory=str(r["source_directory"] or ""),
            run_id=_int_or_none(r["run_id"]),
            batch_match_id=_int_or_none(r["batch_match_id"]),
            segment_key=r["segment_key"],
            segment_match_id=_int_or_none(r["segment_match_id"]),
            segment_run_id=_int_or_none(r["segment_run_id"]),
            state=r["state"],
            t_start_sec=r["t_start_sec"],
            t_end_sec=r["t_end_sec"],
            decoder_version=r["decoder_version"],
            frame_count=_int_or_none(r["frame_count"]),
            observability_status=r["observability_status"],
            extraction_count=int(r["extraction_count"] or 0),
            extraction_success_count=int(r["extraction_success_count"] or 0),
        )
        for r in rows
    ]


def make_runner(*, repo_root: Path):
    def run_command(argv: Sequence[str]) -> CommandResult:
        proc = subprocess.run(list(argv), cwd=str(repo_root), capture_output=True, text=True)
        return CommandResult(returncode=proc.returncode, stderr=proc.stderr)

    return run_command


def make_receipt_sink(path: Path):
    def sink(receipt: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(receipt, ensure_ascii=False) + "\n")

    return sink


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="Stage-A rescue manifest (schema_version 2).",
    )
    ap.add_argument(
        EXECUTE_FLAG,  # bound to the constant so the guard and the CLI cannot drift
        action="store_true",
        help=(
            "REQUIRED to run anything. Without it this is a dry run: no ffmpeg, "
            "no ingest-ocr, no database write. With it, source the repository "
            ".env first — the spawned ingest-ocr inherits this shell and needs "
            "DATABASE_URL and OCR_PYTHON."
        ),
    )
    ap.add_argument("--container", default=DEFAULT_CONTAINER)
    ap.add_argument("--db-user", default="eanhl")
    ap.add_argument("--db-name", default="eanhl")
    ap.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="Working directory for the pnpm ingest-ocr invocations.",
    )
    ap.add_argument(
        "--receipts",
        type=Path,
        default=None,
        help=f"Receipt ledger; defaults to {RECEIPTS_FILENAME} beside the manifest.",
    )
    args = ap.parse_args(argv)

    now = datetime.now(timezone.utc)
    rescue_run_id = f"rescue-b2-{now.strftime('%Y%m%dT%H%M%SZ')}"

    receipts_path = args.receipts or (args.manifest.resolve().parent / RECEIPTS_FILENAME)

    return run_rescue(
        manifest_path=args.manifest,
        execute=args.execute,
        completion_facts=lambda: completion_facts(
            container=args.container, user=args.db_user, db=args.db_name
        ),
        run_command=make_runner(repo_root=args.repo_root.resolve()),
        rescue_run_id=rescue_run_id,
        executed_at=now.isoformat(timespec="seconds"),
        receipt_sink=make_receipt_sink(receipts_path),
        make_batch_dir=lambda p: p.mkdir(parents=True, exist_ok=True),
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RescueAborted as exc:
        # Expected rejections are operator errors, not crashes. Clean exit 1,
        # no traceback -- same contract as `CacheRootUnusable` at the CLI edge.
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
