"""Regression tests for the Pass-1 cache-hit decoder_version stamp.

A cache hit skips `_run_pass1`, so `decoder_version` has to be re-derived from
the engine config. The pre-fix code stamped `legacy-passthrough-v0-video` for
`viterbi_v2` (the else-branch) and loaded the v2 state machine for `viterbi`.
That is how all 97 mass-ingest runs came to be labelled with the legacy
passthrough tag despite having run the v2 decoder — a provenance lie, not a
real engine.

These assertions read the real shipped state-machine YAMLs, so they also guard
against a decoder_version bump landing in only one of the two files.
"""

from __future__ import annotations

import unittest

from video_ingest.orchestrator import _decoder_version_for_cache_hit


class DecoderVersionForCacheHitTests(unittest.TestCase):
    def test_viterbi_v2_reports_the_v2_decoder_not_the_legacy_tag(self) -> None:
        self.assertEqual(_decoder_version_for_cache_hit("viterbi_v2", "nhl26"), "hmm-viterbi-v2")

    def test_viterbi_reads_the_v1_state_machine(self) -> None:
        # `_run_pass1` loads `<version>-v1` for this engine; the unversioned
        # YAML belongs to v2. Loading the wrong one here would silently stamp
        # v2's tag onto a v1 decode.
        self.assertEqual(_decoder_version_for_cache_hit("viterbi", "nhl26"), "hmm-viterbi-v1")

    def test_the_two_engines_do_not_collide(self) -> None:
        self.assertNotEqual(
            _decoder_version_for_cache_hit("viterbi", "nhl26"),
            _decoder_version_for_cache_hit("viterbi_v2", "nhl26"),
        )

    def test_run_length_keeps_the_legacy_passthrough_tag(self) -> None:
        # The legacy engine ships no state machine YAML, so there is nothing
        # to read a tag from.
        self.assertEqual(
            _decoder_version_for_cache_hit("run_length", "nhl26"),
            "legacy-passthrough-v0-video",
        )

    def test_unknown_engine_falls_back_to_the_legacy_tag(self) -> None:
        self.assertEqual(
            _decoder_version_for_cache_hit("something_new", "nhl26"),
            "legacy-passthrough-v0-video",
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
