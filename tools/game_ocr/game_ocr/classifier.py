"""Hybrid screen-type classifier for Pass-1 video segmentation.

Two signals per frame:

  1. Coarse color signature — a coarse HSV histogram (12×4×4 bins) is
     computed once. Cosine similarity against per-class reference
     histograms gives a `color_score` in [0, 1]. A class is a *candidate*
     if its color_score ≥ `color_threshold`.

  2. Anchor-text confirmation — one OCR pass over a shared top-of-screen
     ROI (the title/tab bar). For each candidate class, we check whether
     any of its `anchor_substrings` appears in the OCR text, with
     Levenshtein-1 fuzzy matching to tolerate single-character noise
     (a common failure mode for stylized game fonts).

A frame's screen_type is the highest-color_score candidate whose anchor
text matches. If no class passes both gates → `unknown_screen` — the
out-of-distribution signal that the orchestrator uses to skip a
segment. Silent misclassification is the failure we're guarding
against; failing closed to `unknown_screen` is the safe direction.

Config schema (YAML at configs/classifier/<version>.yaml):

    version: "nhl26"
    hist_bins: [12, 4, 4]
    anchor_roi: [x1, y1, x2, y2]   # 1920x1080 coordinate space
    color_threshold: 0.70
    classes:
      pre_game_lobby_state_1:
        anchor_substrings: ["finding opponent", "stay in div"]
        centroid: [<192 floats>]
      ...
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np
import yaml

from game_ocr.ocr import OCRBackend, RapidOCRBackend
from game_ocr.signal_utils import _levenshtein, fuzzy_contains, hsv_histogram
from game_ocr.utils import normalize_text


UNKNOWN_SCREEN = "unknown_screen"

CONFIGS_DIR = Path(__file__).resolve().parent / "configs" / "classifier"


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


@dataclass(frozen=True)
class ClassDef:
    name: str
    centroid: np.ndarray
    anchor_substrings: tuple[str, ...]


@dataclass(frozen=True)
class ClassifierConfig:
    version: str
    hist_bins: tuple[int, int, int]
    anchor_roi: tuple[int, int, int, int]  # x1, y1, x2, y2 at 1920x1080
    color_threshold: float
    fuzzy_max_distance: int
    classes: tuple[ClassDef, ...]
    # If any of these substrings appears in the anchor OCR, return
    # UNKNOWN immediately. Used to suppress visually-similar screens
    # that aren't worth processing (main-menu tab bar, etc.).
    reject_anchor_substrings: tuple[str, ...] = ()


@dataclass(frozen=True)
class ClassifyResult:
    screen_type: str
    color_class: str
    color_score: float
    anchor_text: str
    matched_class: str
    confidence: float


def load_classifier_config(version: str) -> ClassifierConfig:
    path = CONFIGS_DIR / f"{version}.yaml"
    if not path.exists():
        raise FileNotFoundError(
            f"classifier config missing for version='{version}' at {path}"
        )
    raw = yaml.safe_load(path.read_text())
    bins = tuple(int(b) for b in raw["hist_bins"])
    if len(bins) != 3:
        raise ValueError(f"hist_bins must be 3-tuple, got {bins}")
    roi = tuple(int(v) for v in raw["anchor_roi"])
    if len(roi) != 4:
        raise ValueError(f"anchor_roi must be 4-tuple, got {roi}")
    expected_dims = bins[0] * bins[1] * bins[2]
    classes: list[ClassDef] = []
    for name, body in raw["classes"].items():
        centroid = np.asarray(body["centroid"], dtype=np.float64)
        if centroid.shape != (expected_dims,):
            raise ValueError(
                f"class {name!r} centroid shape {centroid.shape} != "
                f"expected ({expected_dims},)"
            )
        anchors = tuple(str(s) for s in body.get("anchor_substrings", []))
        classes.append(ClassDef(name=name, centroid=centroid, anchor_substrings=anchors))
    return ClassifierConfig(
        version=str(raw["version"]),
        hist_bins=bins,  # type: ignore[arg-type]
        anchor_roi=roi,  # type: ignore[arg-type]
        color_threshold=float(raw.get("color_threshold", 0.70)),
        fuzzy_max_distance=int(raw.get("fuzzy_max_distance", 1)),
        classes=tuple(classes),
        reject_anchor_substrings=tuple(
            str(s) for s in raw.get("reject_anchor_substrings", [])
        ),
    )


def _scale_roi(
    roi: tuple[int, int, int, int],
    image_shape: tuple[int, int],
) -> tuple[int, int, int, int]:
    """Map a 1920x1080 ROI onto the input frame's actual dimensions.
    Centroids and ROIs are calibrated at 1080p; OBS or PC captures at
    other resolutions get linearly rescaled. Defensive clamps included."""
    h, w = image_shape
    sx = w / 1920.0
    sy = h / 1080.0
    x1, y1, x2, y2 = roi
    rx1 = max(0, min(w - 1, int(round(x1 * sx))))
    rx2 = max(0, min(w, int(round(x2 * sx))))
    ry1 = max(0, min(h - 1, int(round(y1 * sy))))
    ry2 = max(0, min(h, int(round(y2 * sy))))
    if rx2 <= rx1 or ry2 <= ry1:
        raise ValueError(f"degenerate ROI after scale: {(rx1, ry1, rx2, ry2)}")
    return rx1, ry1, rx2, ry2


class Classifier:
    """Single-process classifier. Holds the OCR backend (recommended GPU)
    and the version config. `classify()` is safe to call repeatedly."""

    def __init__(
        self,
        config: ClassifierConfig,
        ocr_backend: OCRBackend | None = None,
        *,
        use_gpu: bool = True,
    ) -> None:
        self.config = config
        self.ocr = ocr_backend or RapidOCRBackend(use_gpu=use_gpu)

    def _color_scores(self, image_bgr: np.ndarray) -> list[tuple[str, float]]:
        h = hsv_histogram(image_bgr, self.config.hist_bins)
        scores: list[tuple[str, float]] = []
        for cls in self.config.classes:
            scores.append((cls.name, cosine_similarity(h, cls.centroid)))
        scores.sort(key=lambda t: t[1], reverse=True)
        return scores

    def _read_anchor(self, image_bgr: np.ndarray) -> str:
        rx1, ry1, rx2, ry2 = _scale_roi(self.config.anchor_roi, image_bgr.shape[:2])
        crop = image_bgr[ry1:ry2, rx1:rx2]
        lines = self.ocr.read(crop)
        return " ".join(normalize_text(line.text) for line in lines if line.text).lower()

    def classify(self, image_bgr: np.ndarray) -> ClassifyResult:
        color_scores = self._color_scores(image_bgr)
        if not color_scores:
            return ClassifyResult(
                screen_type=UNKNOWN_SCREEN,
                color_class=UNKNOWN_SCREEN,
                color_score=0.0,
                anchor_text="",
                matched_class=UNKNOWN_SCREEN,
                confidence=0.0,
            )
        best_color_class, best_color_score = color_scores[0]
        anchor_text = self._read_anchor(image_bgr)

        # Hard reject: anchor text contains an explicit rejection marker
        # (e.g. main-menu tab labels). Returns immediately with the best
        # color class recorded for debuggability.
        if self.config.reject_anchor_substrings and any(
            fuzzy_contains(anchor_text, sub, self.config.fuzzy_max_distance)
            for sub in self.config.reject_anchor_substrings
        ):
            return ClassifyResult(
                screen_type=UNKNOWN_SCREEN,
                color_class=best_color_class,
                color_score=best_color_score,
                anchor_text=anchor_text,
                matched_class=UNKNOWN_SCREEN,
                confidence=0.0,
            )

        # Two-tier matching:
        #
        # Tier 1 — anchor priority. Among classes that declare anchors,
        # walk them in DESCENDING max-anchor-length order so the most
        # specific text discriminator wins. Empirically the color
        # signature is non-discriminative for dark post-game tabs (every
        # tab scores 0.95-0.99 against every centroid), so color alone
        # cannot pick the right class — but the screen-title text reliably
        # can. We still gate on color ≥ threshold to defend against
        # OCR hallucinations leaking through.
        #
        # Tier 2 — color-only fallback. Classes that declare NO anchors
        # are pure-color (today: lobby, before we tightened that). They
        # participate only if no anchored class matched.
        #
        # No below-threshold fallback: silent misclassification is the
        # failure mode we're guarding against.
        anchored = [c for c in self.config.classes if c.anchor_substrings]
        color_only = [c for c in self.config.classes if not c.anchor_substrings]
        score_by_name = {n: s for n, s in color_scores}

        # Anchor-tier color floor is intentionally MUCH looser than
        # `color_threshold` (which gates color-only classes). When a
        # specific screen-title anchor matches, the text is the
        # discriminator — color is just a sanity check against truly
        # garbage frames where the OCR hallucinated. Single-fixture
        # centroid calibration produces high variance (a different
        # player viewing a different sub-state of player_summary scores
        # ~0.52 against the centroid), so a tight color floor blocks
        # legitimate anchor matches.
        anchor_color_floor = 0.30

        anchored.sort(
            key=lambda c: -max(len(s) for s in c.anchor_substrings),
        )
        matched: str | None = None
        match_score = 0.0
        for cls in anchored:
            score = score_by_name.get(cls.name, 0.0)
            if score < anchor_color_floor:
                continue
            if any(
                fuzzy_contains(anchor_text, sub, self.config.fuzzy_max_distance)
                for sub in cls.anchor_substrings
            ):
                matched = cls.name
                match_score = score
                break

        if matched is None:
            color_only_ranked = sorted(
                color_only,
                key=lambda c: -score_by_name.get(c.name, 0.0),
            )
            for cls in color_only_ranked:
                score = score_by_name.get(cls.name, 0.0)
                if score < self.config.color_threshold:
                    break
                matched = cls.name
                match_score = score
                break

        if matched is None:
            screen_type = UNKNOWN_SCREEN
            confidence = best_color_score * 0.5  # downweight: no anchor confirm
        else:
            screen_type = matched
            confidence = match_score

        return ClassifyResult(
            screen_type=screen_type,
            color_class=best_color_class,
            color_score=best_color_score,
            anchor_text=anchor_text,
            matched_class=matched or UNKNOWN_SCREEN,
            confidence=confidence,
        )


def classify_image(
    image_bgr: np.ndarray,
    version: str = "nhl26",
    classifier: Classifier | None = None,
) -> ClassifyResult:
    """Convenience one-shot. Prefer the Classifier class in hot loops to
    amortize the OCR backend cold start."""
    if classifier is None:
        classifier = Classifier(load_classifier_config(version))
    return classifier.classify(image_bgr)


if __name__ == "__main__":  # pragma: no cover
    # `python3 -m game_ocr.classifier <image> [--version nhl26]` smoke runner.
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("--version", default="nhl26")
    args = ap.parse_args()
    img = cv2.imread(str(args.image))
    if img is None:
        print(f"cv2.imread failed: {args.image}", file=sys.stderr)
        raise SystemExit(2)
    res = classify_image(img, version=args.version)
    print(
        f"screen_type     = {res.screen_type}\n"
        f"color_class     = {res.color_class}\n"
        f"color_score     = {res.color_score:.3f}\n"
        f"anchor_text     = {res.anchor_text[:200]!r}\n"
        f"confidence      = {res.confidence:.3f}"
    )
