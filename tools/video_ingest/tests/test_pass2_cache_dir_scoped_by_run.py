"""Pass-2 cache dir naming contract (master-plan §1, A3 Task 7).

When `ingest()` is invoked with `run_id=N`, Pass-2 PNG output lands at
`<root>/<sha>/pass2-run-N/...` so concurrent reprocesses against the same
video can't clobber each other's per-segment frame directories. When
`run_id` is omitted (legacy single-run ingest), the directory name stays
`pass2` for backwards compatibility.

Pass-1 outputs are versioned by the engine cache key (S5.4 —
``compute_pass1_cache_key``) so they don't need analogous scoping; only
Pass-2's extracted PNGs lack a cache-key-based path, hence the explicit
``run_id`` scoping.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from video_ingest.orchestrator import compute_pass2_cache_dir


class Pass2CacheDirNamingTests(unittest.TestCase):
    def test_default_uses_unscoped_pass2_name(self) -> None:
        out = compute_pass2_cache_dir(root=Path("/tmp/ingest"), sha="abc123", run_id=None)
        self.assertEqual(out.name, "pass2")
        self.assertEqual(out.parent.name, "abc123")
        self.assertEqual(out, Path("/tmp/ingest/abc123/pass2"))

    def test_with_run_id_appends_run_suffix(self) -> None:
        out = compute_pass2_cache_dir(root=Path("/tmp/ingest"), sha="abc123", run_id=42)
        self.assertEqual(out.name, "pass2-run-42")
        self.assertEqual(out.parent.name, "abc123")
        self.assertEqual(out, Path("/tmp/ingest/abc123/pass2-run-42"))

    def test_run_id_zero_is_distinct_from_none(self) -> None:
        # run_id=0 is a valid (if unusual) DB id — must not collapse to "pass2".
        out = compute_pass2_cache_dir(root=Path("/tmp/ingest"), sha="abc123", run_id=0)
        self.assertEqual(out.name, "pass2-run-0")


if __name__ == "__main__":
    unittest.main()
