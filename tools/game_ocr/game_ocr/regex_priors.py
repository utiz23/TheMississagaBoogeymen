"""Regex priors loader for the v2 screen classifier.

Reads `configs/state_machine/<version>_regex_priors.yaml`. Returns a
RegexPriorsConfig that `compute_frame_features_v2` consumes to produce
per-prior flag bits for the feature vector.

Each regex fires against OCR text from one of the named ROIs (typically
`top_bar` for the screen header and `side_strip` for the HOME/AWAY column
in the loadout-detail view). When a regex matches, a 1.0 lands at that
prior's position in the v2 feature vector. The flat ordering of
`priors_flat` defines the feature-vector position contract — DO NOT
reorder without also retraining the v2 weights.

YAML schema:

```yaml
version: "v0.1"
roi_definitions:
  top_bar:
    description: "..."
    bbox: [x, y, w, h]   # 1920x1080 native coords
  side_strip:
    description: "..."
    bbox: [x, y, w, h]

# Per-state lists of regexes. ROI defaults to "top_bar" when omitted.
menu_club_management:
  - { name: club_word, pattern: '\\bclub\\b', roi: top_bar }
  - { name: clubs_tab, pattern: '\\bclubs\\b' }
```

Validation:
  - All ROI references must exist in roi_definitions.
  - Patterns are compiled at load time; invalid regex raises immediately.
  - Per-state prior names must be unique within their state (to keep
    flag debugging readable).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

import yaml


CONFIGS_DIR = Path(__file__).resolve().parent / "configs" / "state_machine"
DEFAULT_ROI_NAME = "top_bar"


class RegexPriorsConfigError(ValueError):
    """Raised when the regex-priors YAML is structurally invalid."""


@dataclass(frozen=True)
class RoiBbox:
    """A rectangular OCR region in 1920x1080 native coords."""
    name: str
    x: int
    y: int
    w: int
    h: int

    def crop(self, image) -> "np.ndarray":  # noqa: F821 — numpy imported lazily
        """Slice the [x:x+w, y:y+h] region from a 1080p-equivalent image.

        Caller is responsible for image scaling (we assume 1920x1080).
        """
        return image[self.y:self.y + self.h, self.x:self.x + self.w]


@dataclass(frozen=True)
class RegexPrior:
    """One regex prior contributing flag evidence to a state."""
    state: str
    name: str
    pattern: str
    compiled: re.Pattern
    roi: str

    def matches(self, text: str) -> bool:
        return self.compiled.search(text) is not None


@dataclass(frozen=True)
class RegexPriorsConfig:
    """Parsed regex-priors YAML.

    `priors_flat` is the canonical ordering used by `compute_frame_features_v2`
    to build the per-prior flag slice of the feature vector. Ordering is
    stable across runs because the YAML loader preserves insertion order
    (PyYAML uses dict, Python 3.7+ preserves insertion order).
    """
    version: str
    rois: Mapping[str, RoiBbox]
    priors_by_state: Mapping[str, tuple[RegexPrior, ...]]
    priors_flat: tuple[RegexPrior, ...]

    def n_priors(self) -> int:
        return len(self.priors_flat)

    def priors_for_state(self, state: str) -> tuple[RegexPrior, ...]:
        return self.priors_by_state.get(state, ())


_BBOX_LEN = 4


def _parse_roi(name: str, raw: object) -> RoiBbox:
    if not isinstance(raw, Mapping):
        raise RegexPriorsConfigError(f"roi_definitions[{name!r}] must be a mapping")
    bbox = raw.get("bbox")
    if not isinstance(bbox, (list, tuple)) or len(bbox) != _BBOX_LEN:
        raise RegexPriorsConfigError(
            f"roi_definitions[{name!r}].bbox must be a 4-element list [x, y, w, h]"
        )
    try:
        x, y, w, h = [int(v) for v in bbox]
    except (TypeError, ValueError) as e:
        raise RegexPriorsConfigError(
            f"roi_definitions[{name!r}].bbox values must be integers: {bbox!r}"
        ) from e
    if w <= 0 or h <= 0:
        raise RegexPriorsConfigError(
            f"roi_definitions[{name!r}].bbox width and height must be positive: {bbox!r}"
        )
    return RoiBbox(name=name, x=x, y=y, w=w, h=h)


def _parse_prior(state: str, raw: object, roi_names: set[str]) -> RegexPrior:
    if not isinstance(raw, Mapping):
        raise RegexPriorsConfigError(
            f"{state!r} entry must be a mapping (got {type(raw).__name__})"
        )
    name = raw.get("name")
    pattern = raw.get("pattern")
    roi = raw.get("roi", DEFAULT_ROI_NAME)
    if not isinstance(name, str) or not name:
        raise RegexPriorsConfigError(f"{state!r} entry missing/empty 'name': {raw!r}")
    if not isinstance(pattern, str) or not pattern:
        raise RegexPriorsConfigError(f"{state!r} entry missing/empty 'pattern': {raw!r}")
    if roi not in roi_names:
        raise RegexPriorsConfigError(
            f"{state!r}.{name!r} references unknown roi {roi!r}; "
            f"known: {sorted(roi_names)}"
        )
    try:
        compiled = re.compile(pattern, re.IGNORECASE)
    except re.error as e:
        raise RegexPriorsConfigError(
            f"{state!r}.{name!r} pattern is not a valid regex: {pattern!r} ({e})"
        ) from e
    return RegexPrior(
        state=state,
        name=name,
        pattern=pattern,
        compiled=compiled,
        roi=roi,
    )


# Top-level YAML keys that are NOT state names.
_RESERVED_TOP_KEYS = frozenset({"version", "roi_definitions"})


def load_regex_priors(version: str) -> RegexPriorsConfig:
    """Load and validate the regex-priors YAML for `<version>`."""
    path = CONFIGS_DIR / f"{version}_regex_priors.yaml"
    if not path.exists():
        raise FileNotFoundError(f"regex priors config missing for {version!r}: {path}")
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, Mapping):
        raise RegexPriorsConfigError(f"{path}: top-level must be a mapping")

    ver = raw.get("version")
    if not isinstance(ver, str) or not ver:
        raise RegexPriorsConfigError(f"{path}: missing/invalid top-level 'version'")

    roi_defs = raw.get("roi_definitions") or {}
    if not isinstance(roi_defs, Mapping):
        raise RegexPriorsConfigError(f"{path}: 'roi_definitions' must be a mapping")
    rois: dict[str, RoiBbox] = {
        name: _parse_roi(name, defn) for name, defn in roi_defs.items()
    }
    roi_names = set(rois.keys())
    if not roi_names:
        raise RegexPriorsConfigError(f"{path}: at least one roi_definitions entry required")
    if DEFAULT_ROI_NAME not in roi_names:
        raise RegexPriorsConfigError(
            f"{path}: roi_definitions must include {DEFAULT_ROI_NAME!r} "
            f"(default for priors that omit `roi`)"
        )

    priors_by_state: dict[str, tuple[RegexPrior, ...]] = {}
    priors_flat: list[RegexPrior] = []
    for state, entries in raw.items():
        if state in _RESERVED_TOP_KEYS:
            continue
        if not isinstance(state, str):
            raise RegexPriorsConfigError(f"{path}: non-string top-level key {state!r}")
        if entries is None:
            continue
        if not isinstance(entries, list):
            raise RegexPriorsConfigError(
                f"{path}: {state!r} value must be a list of priors"
            )
        state_priors: list[RegexPrior] = []
        seen_names: set[str] = set()
        for entry in entries:
            p = _parse_prior(state, entry, roi_names)
            if p.name in seen_names:
                raise RegexPriorsConfigError(
                    f"{path}: duplicate prior name {p.name!r} in state {state!r}"
                )
            seen_names.add(p.name)
            state_priors.append(p)
            priors_flat.append(p)
        priors_by_state[state] = tuple(state_priors)

    if not priors_flat:
        raise RegexPriorsConfigError(f"{path}: no per-state priors defined")

    return RegexPriorsConfig(
        version=ver,
        rois=MappingProxyType(rois),
        priors_by_state=MappingProxyType(priors_by_state),
        priors_flat=tuple(priors_flat),
    )
