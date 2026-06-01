"""WS2 Pass-1 pre-OCR gate policy.

Pass-1 OCRs every sampled frame to build classifier text-features, which is
~36% of ingest wall time. This module decides, from cheap full-frame visual
signals (no OCR), whether a frame is *unambiguously* non-text — a black/fade/
loading frame — so the orchestrator can skip the expensive RapidOCR ROI reads
for it (slotting in `_NullOCRBackend`) and pin it to `unknown_or_transition`.

Posture is CONSERVATIVE: gate only when every configured criterion agrees
(`require_all=True`). The launch configuration gates a black-frame signature
only (low brightness AND low edge-density AND low blur); `max_edge_density` is
the primary discriminator since text/UI chrome produces many Canny edges while
a flat fade has ~none, and the AND on it protects in-game gameplay (its clock
overlay carries edges).

`parse_gate_config` is the single YAML→GateConfig path shared by the
orchestrator and the proving-bench acceptance test, so the test can never drift
from shipped thresholds. `gate_cache_fingerprint` feeds the Pass-1 cache-key
salt so runtime overrides (env kill switch / CLI) stay cache-correct.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from video_ingest.visual_prefilter.signals import VisualSignals


@dataclass(frozen=True)
class GateConfig:
    """Pre-OCR gate thresholds. Thresholds are UPPER BOUNDS: a frame qualifies
    as non-text when its signal is `<=` the bound. `None` disables that
    criterion. `require_all=True` (conservative AND) gates only when every
    configured criterion agrees; `require_all=False` (OR) is reserved and must
    not ship without proving-bench re-validation."""

    enabled: bool = False
    require_all: bool = True
    max_brightness: float | None = None
    max_edge_density: float | None = None
    max_log_blur: float | None = None


def gate(signals: VisualSignals, cfg: GateConfig) -> str:
    """Return "skip" only when the frame is unambiguously non-text, else "ocr"."""
    if not cfg.enabled:
        return "ocr"
    votes: list[bool] = []
    if cfg.max_brightness is not None:
        votes.append(signals.brightness <= cfg.max_brightness)
    if cfg.max_edge_density is not None:
        votes.append(signals.edge_density <= cfg.max_edge_density)
    if cfg.max_log_blur is not None:
        votes.append(signals.log_blur <= cfg.max_log_blur)
    if not votes:
        return "ocr"  # no criteria configured → never gate
    skip = all(votes) if cfg.require_all else any(votes)
    return "skip" if skip else "ocr"


def pass1_emissions_bias(
    *, reject_floor: float, unk_idx: int, n_states: int
) -> np.ndarray:
    """One emission row that pins a frame to `unknown_or_transition`: every
    state at `reject_floor`, the unknown state one above. Mirrors the existing
    reject path in `game_ocr.emissions.build_log_emissions_v2` so the gate and
    that reject path share one definition."""
    row = np.full((n_states,), reject_floor, dtype=np.float64)
    row[unk_idx] = reject_floor + 1.0
    return row


def parse_gate_config(p1_raw: dict) -> GateConfig | None:
    """Single parse path from a `pass1:` YAML dict to a GateConfig. Absent
    `pre_ocr_gate` block ⇒ None ⇒ gate disabled. Shared by the orchestrator and
    the proving bench so thresholds never diverge."""
    raw = p1_raw.get("pre_ocr_gate")
    if raw is None:
        return None
    return GateConfig(
        enabled=bool(raw.get("enabled", False)),
        require_all=bool(raw.get("require_all", True)),
        max_brightness=raw.get("max_brightness"),
        max_edge_density=raw.get("max_edge_density"),
        max_log_blur=raw.get("max_log_blur"),
    )


def resolve_effective_gate(
    parsed: GateConfig | None,
    *,
    cli_enabled: bool | None,
    env_disabled: bool,
) -> GateConfig | None:
    """Resolve the effective gate from YAML + runtime overrides.

    Precedence is **env-disable > CLI > YAML**: the env switch is a disable-only
    kill switch that wins absolutely; the CLI override (when set) replaces the
    YAML `enabled` value and can force ON or OFF; otherwise the YAML config
    stands.

    - `parsed`: GateConfig from YAML, or None when the `pre_ocr_gate` block is
      absent.
    - `cli_enabled`: the `pass1_gate_enabled` CLI override; None when not given.
    - `env_disabled`: True when `OCR_PASS1_GATE_ENABLED` is set to a falsey value.
    """
    effective = parsed
    if cli_enabled is not None:
        base = parsed if parsed is not None else GateConfig()
        effective = replace(base, enabled=cli_enabled)
    if env_disabled and effective is not None:
        effective = replace(effective, enabled=False)
    return effective


def gate_cache_fingerprint(cfg: GateConfig | None) -> str | None:
    """Canonical fingerprint of the *effective* gate for the Pass-1 cache-key
    salt. None when the gate is effectively disabled (byte-identical cache key
    to a no-gate build); a stable string otherwise, distinct per threshold
    tuning so re-tuning correctly invalidates cached segments.json."""
    if cfg is None or not cfg.enabled:
        return None
    return (
        f"gate:b={cfg.max_brightness},e={cfg.max_edge_density},"
        f"lb={cfg.max_log_blur},all={int(cfg.require_all)}"
    )
