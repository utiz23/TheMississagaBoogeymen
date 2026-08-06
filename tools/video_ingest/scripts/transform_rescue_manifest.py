"""One-off: transform a schema-2 rescue manifest to the schema-3 sampling contract.

READ-ONLY WITH RESPECT TO THE INPUT. This script opens the input manifest for
reading and never for writing. It writes exactly one file (the candidate) plus
an optional diff report, both at paths the caller names, and it refuses to
overwrite either.

It exists because the live manifest cannot be regenerated: it carries
hand-adjudicated identity decisions and 18 already-executed, already-receipted
auto windows. See ``video_ingest.rescue_transform`` for the full argument. All
the policy lives there; this is the IO shell — the digest gate, the ffprobe, the
refusal to overwrite.

Four gates, in order, before a single byte is written:

  1. the input's SHA-256 must equal ``--expect-sha256`` exactly. A manifest is
     an authorisation, and this tool must not transform one nobody approved;
  2. the output path must not exist;
  3. every source video behind an AUTO window must probe to a usable constant
     grid — a rate that ``r_frame_rate`` and ``avg_frame_rate`` agree on, plus a
     measured PTS origin its own leading frames sit on — and the real frames
     around each of that window's evidence timestamps must be there. One failure
     on an auto window refuses the whole transform: an auto window is executable
     and 18 of them are already receipted, so it must carry an executable command
     or the manifest must not claim it.

     A **review** or **skip** window is not executable, and refusing the entire
     repair over one would be disproportionate. Its command is dropped and the
     drop is enumerated in ``policy.sampling_unpinnable``; the semantic diff
     licenses the disappearance only for windows named there. This is the same
     :func:`~video_ingest.rescue_manifest.pin_or_drop` the generator uses, so the
     two tools cannot disagree about it. On the current corpus this is exactly
     the five review windows of the trimmed match-2400 recording, whose
     ``r_frame_rate`` (60/1) and ``avg_frame_rate`` (839640000/13993843) do not
     agree;
  4. the candidate must pass the executor's own whole-manifest validation, and
     the semantic diff must come back ``ok``.

Run (the repo-root .venv-1 is the pytest/python runner; the GPU
tools/video_ingest/.venv has no pytest -- see [[reference_gpu_ocr_venv]]):

    cd tools/video_ingest && PYTHONPATH=.:../game_ocr \\
      ../../.venv-1/bin/python scripts/transform_rescue_manifest.py \\
      --manifest ~/ingest-cache/rescue-manifest.json \\
      --expect-sha256 <the approved digest> \\
      --out /tmp/rescue-manifest.candidate.json \\
      --diff-out /tmp/rescue-manifest.diff.json

Nothing about this script promotes anything. The candidate it writes is an
input to a later approval gate, not a replacement for the live manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Sequence

from video_ingest.rescue_execute import validate_for_execution
from video_ingest.rescue_sampling import (
    UnsupportedFrameRate,
    memoised_prober,
    probe_frame_pts,
)
from video_ingest.rescue_transform import (
    TransformRefused,
    render_diff,
    semantic_diff,
    transform_document,
)


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--manifest", type=Path, required=True, help="schema-2 input; read only")
    ap.add_argument(
        "--expect-sha256",
        required=True,
        help="the approved SHA-256 of the input. A mismatch aborts before anything is read.",
    )
    ap.add_argument("--out", type=Path, required=True, help="candidate path; must not exist")
    ap.add_argument("--diff-out", type=Path, default=None, help="semantic diff JSON path")
    args = ap.parse_args(argv)

    out = print

    # Gate 1: the exact approved input.
    try:
        raw = args.manifest.read_bytes()
    except OSError as exc:
        out(f"input unreadable: {args.manifest}\n  {exc}")
        return 1
    digest = hashlib.sha256(raw).hexdigest()
    if digest != args.expect_sha256:
        out(
            "INPUT DIGEST MISMATCH — refusing to transform a manifest nobody approved.\n"
            f"  path     : {args.manifest}\n"
            f"  expected : {args.expect_sha256}\n"
            f"  actual   : {digest}\n"
            "  Nothing was read further and nothing was written."
        )
        return 1

    # Gate 2: never overwrite.
    for label, path in (("--out", args.out), ("--diff-out", args.diff_out)):
        if path is not None and path.exists():
            out(
                f"REFUSING TO OVERWRITE {label} {path}\n"
                "  This tool only ever creates. Choose a fresh path."
            )
            return 1

    doc = json.loads(raw)
    out(f"input      : {args.manifest}")
    out(f"sha256     : {digest}")
    out(f"schema     : {doc.get('schema_version')}")
    out("")
    out("── probing source grids (constant rate + measured PTS origin required) ──")

    prober = memoised_prober(
        on_probe=lambda path, grid: out(f"  probed {grid.text:>24s}  {path}")
    )
    try:
        candidate = transform_document(
            doc,
            grid_for=prober,
            probe_frames=probe_frame_pts,
            input_digest=digest,
        )
    except (TransformRefused, UnsupportedFrameRate) as exc:
        out("")
        out(f"TRANSFORM REFUSED: {exc}")
        out("  Nothing was written. The input manifest is untouched.")
        return 1

    # The drops this run made, before the diff that licenses them. Printed
    # unconditionally so "none" is a stated result rather than an absence.
    dropped = (candidate.get("policy") or {}).get("sampling_unpinnable") or []
    out("")
    out(f"── unpinnable sources ({len(dropped)} non-auto window(s) lost a command) ──")
    if not dropped:
        out("  none")
    for entry in dropped:
        out(
            f"  {str(entry.get('video_sha256') or '')[:12]}/seg{entry.get('segment_index')} "
            f"{entry.get('decision')}  {entry.get('reason')}"
        )
        out(f"      {entry.get('video_path')}")
        out(f"      {entry.get('detail')}")

    report = semantic_diff(doc, candidate)
    render_diff(report, out=out)

    problems = validate_for_execution(candidate)
    out("")
    out(f"candidate validates for execution : {len(problems)} problem(s)")
    for problem in problems[:20]:
        out(f"    - {problem}")

    if not report["ok"] or problems:
        out("")
        out("CANDIDATE REJECTED — not written.")
        return 1

    args.out.write_text(json.dumps(candidate, indent=1, sort_keys=False) + "\n")
    candidate_digest = hashlib.sha256(args.out.read_bytes()).hexdigest()
    report_full = dict(report)
    report_full["input_path"] = str(args.manifest)
    report_full["input_sha256"] = digest
    report_full["output_path"] = str(args.out)
    report_full["output_sha256"] = candidate_digest
    report_full["source_grids"] = {
        path: {"frame_rate": grid.rate.text, "pts_origin_s": grid.origin_s}
        for path, grid in sorted(prober.cache.items())
    }
    report_full["sampling_unpinnable"] = list(dropped)
    if args.diff_out is not None:
        args.diff_out.write_text(json.dumps(report_full, indent=1, sort_keys=True) + "\n")

    # The input is re-hashed AFTER writing, so "never modified" is a measurement
    # rather than a promise about code that could have changed since.
    after = hashlib.sha256(args.manifest.read_bytes()).hexdigest()
    out("")
    out(f"candidate written : {args.out}")
    out(f"candidate sha256  : {candidate_digest}")
    if args.diff_out is not None:
        out(f"diff written      : {args.diff_out}")
    out(f"input unchanged   : {after == digest} ({after})")
    return 0 if after == digest else 1


if __name__ == "__main__":
    raise SystemExit(main())
