"""Integrity guard for the tracked OCR test fixtures.

Supplements (does not replace) the load-bearing functional tests
(test_classifier.py, test_cli_smoke.py, test_xfactor_icon_matcher.py,
test_frame_pipeline_v2.py::TestRealRapidOCR) that actually exercise
classification/OCR/icon-matching behavior against these images. This test
only proves the fixture files themselves are exactly what they're supposed
to be: a fixed, real, non-symlinked set of the correct bytes and shape.

Regression guard for the fresh-worktree defect: these 12 files were
previously only reachable via two gitignored, untracked source trees
(tools/game_ocr/ScreenShots/ — partly a symlink farm into a separate,
non-repo project directory — and research/OCR-SS/Pre-Game-Loadouts/).
A fresh clone/worktree had no fixtures, so three default-running
consumers failed outright: test_classifier.py and
test_xfactor_icon_matcher.py gate on RUN_*_E2E defaulting to "1" (on
unless explicitly disabled) and test_cli_smoke.py is ungated — all
three raised loudly on the missing path, none skipped. A fourth,
opt-in consumer (test_frame_pipeline_v2.py::TestRealRapidOCR,
RUN_CLASSIFIER_E2E defaulting to "0") stayed off by default and so
did not cause the default failure, but remained non-portable: it
would itself fail on the same missing fixture if enabled. All four
are now repointed at tools/game_ocr/tests/fixtures/, tracked directly
in this repo.

Ungated: always runs, no cv2/OCR dependency beyond Pillow for the
dimension/decode checks — Pillow is a declared direct dependency in
tools/game_ocr/pyproject.toml, not merely a transitive one.
"""

from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

from PIL import Image

TESTS_DIR = Path(__file__).resolve().parent
FIXTURES_DIR = TESTS_DIR / "fixtures"

# Manifest: pinned SHA-256 + expected dimensions for every tracked fixture.
# Computed directly from the approved source files before they were copied
# into this tracked location — see the sibling PROVENANCE.md files in each
# fixture directory for capture provenance. Any change to this table without
# re-verifying against a known-good source is itself a defect.
MANIFEST: dict[str, dict[str, tuple[str, tuple[int, int]]]] = {
    "screen_classifier": {
        "Player Loadout View.png": (
            "182fe8363a7329679961f65cdf206477e667b348851c16156e3c01bd446005db",
            (1920, 1080),
        ),
        "Pre-Game Lobby State 1.png": (
            "09c5af7f035dfa49390a6885601615345b1e5051a8d8df379c5188da4ba01471",
            (1920, 1080),
        ),
        "Pre-Game Lobby State 2.png": (
            "6dd0ab174c1fb6efb5243c8301412ff96f1d87afab592bd640f4ae6922f537b9",
            (1920, 1080),
        ),
        "Post Game Player Summary.png": (
            "61bdd4858f9f35987d4171fa3b5e9aa375b3bf89cfdfd48e9418ea662e1c8519",
            (1920, 1080),
        ),
        "Post Game Box Score.png": (
            "8abd74df1cc2a9b7faf0068cf0fdd5b6c5ae2e830356500557f2bc0e5f1a018b",
            (1920, 1080),
        ),
        "Post Game Events.png": (
            "ec71055cb05c497881cc5d7140181430362291c6ca9392612f42fadd9990dd3b",
            (1920, 1080),
        ),
        "Post Game Action tracker (All-Goals + Hits + Shots + Penalties + Faceoffs).png": (
            "c5ede981c33e5dfbfedd667a09ed6ae72c15f7a4a92ca288dcd0fa30f8d145f3",
            (1920, 1080),
        ),
        "Post Game Event Map Faceoffs.png": (
            "f20bc54a46bb5ae1081050273400e9a31f373b1e8c3dbf3704f8a128e3d8500e",
            (1920, 1080),
        ),
        "Post Game Event Map Net-Chart.png": (
            "4ca777d753cb95de3162ca0e5155582aef8faebcda86490978a32b46f18e8a13",
            (1920, 1080),
        ),
    },
    "xfactor_icon_matcher": {
        "vlcsnap-2026-05-10-01h49m12s913.png": (
            "2403b0cd27752ce3025775cbd112d6ac0b81803a382222264d7a10cac1afaf12",
            (1920, 1080),
        ),
        "vlcsnap-2026-05-10-01h49m17s363.png": (
            "428ed79c55b0039be76e450fd564b59248219843fd75170d9bb1201b9e1960e5",
            (1920, 1080),
        ),
        "vlcsnap-2026-05-10-01h49m20s173.png": (
            "88687b0efbee380efe8be0c7f6574cae59f22fd03e3c1efeced6eb9cfab4b6ac",
            (1920, 1080),
        ),
    },
}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class TestFixtureIntegrity(unittest.TestCase):
    def test_fixture_directories_exist(self) -> None:
        for subdir in MANIFEST:
            d = FIXTURES_DIR / subdir
            self.assertTrue(d.is_dir(), f"missing fixture directory: {d}")

    def test_exact_png_filename_set_per_directory(self) -> None:
        # Scoped to *.png specifically (not every entry) so PROVENANCE.md
        # living alongside the images in the same directory does not trip
        # this assertion.
        for subdir, files in MANIFEST.items():
            d = FIXTURES_DIR / subdir
            if not d.is_dir():
                self.fail(f"missing fixture directory: {d}")
            actual = {p.name for p in d.glob("*.png")}
            expected = set(files.keys())
            self.assertEqual(
                actual,
                expected,
                f"{subdir}: tracked *.png set does not match the manifest "
                f"(missing={expected - actual}, unexpected={actual - expected})",
            )

    def test_each_fixture_is_a_regular_nonsymlink_file(self) -> None:
        misses: list[str] = []
        for subdir, files in MANIFEST.items():
            for fname in files:
                path = FIXTURES_DIR / subdir / fname
                if path.is_symlink():
                    misses.append(f"{subdir}/{fname}: is a symlink (must be a real copy)")
                elif not path.is_file():
                    misses.append(f"{subdir}/{fname}: missing or not a regular file")
        self.assertEqual(misses, [], "\n" + "\n".join(misses))

    def test_each_fixture_matches_pinned_sha256(self) -> None:
        misses: list[str] = []
        for subdir, files in MANIFEST.items():
            for fname, (expected_sha, _dims) in files.items():
                path = FIXTURES_DIR / subdir / fname
                if not path.is_file():
                    misses.append(f"{subdir}/{fname}: missing, cannot hash")
                    continue
                actual_sha = _sha256(path)
                if actual_sha != expected_sha:
                    misses.append(
                        f"{subdir}/{fname}: sha256 mismatch "
                        f"(expected {expected_sha}, got {actual_sha})"
                    )
        self.assertEqual(misses, [], "\n" + "\n".join(misses))

    def test_each_fixture_matches_pinned_dimensions_and_decodes(self) -> None:
        misses: list[str] = []
        for subdir, files in MANIFEST.items():
            for fname, (_sha, expected_dims) in files.items():
                path = FIXTURES_DIR / subdir / fname
                if not path.is_file():
                    misses.append(f"{subdir}/{fname}: missing, cannot decode")
                    continue
                try:
                    with Image.open(path) as img:
                        img.verify()
                    with Image.open(path) as img:
                        actual_dims = img.size
                except Exception as exc:  # noqa: BLE001 - report, don't hide, the failure
                    misses.append(f"{subdir}/{fname}: failed to decode ({exc!r})")
                    continue
                if actual_dims != expected_dims:
                    misses.append(
                        f"{subdir}/{fname}: dimension mismatch "
                        f"(expected {expected_dims}, got {actual_dims})"
                    )
        self.assertEqual(misses, [], "\n" + "\n".join(misses))


if __name__ == "__main__":
    unittest.main()
