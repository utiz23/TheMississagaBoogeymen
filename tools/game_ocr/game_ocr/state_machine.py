"""Phase 1 state machine loader for the HMM/Viterbi Pass-1 decoder.

Reads YAML at configs/state_machine/<version>.yaml. Exposes a StateMachine
whose `log_transition(src, dst)`, `initial_log_prob(state)`,
`min_duration_seconds(state)`, and `anchor_substrings(state)` calls are the
contract the Viterbi decoder + emission combiner consume.

YAML schema is documented inline in the config file. Decoder version is
required so ocr_segments rows can be filtered by decoder_version.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

import yaml


CONFIGS_DIR = Path(__file__).resolve().parent / "configs" / "state_machine"


class StateMachineConfigError(ValueError):
    """Raised when the YAML is structurally invalid."""


@dataclass(frozen=True)
class StateMachine:
    version: str
    decoder_version: str
    sample_fps: float
    states: tuple[str, ...]
    reject_anchor_substrings: tuple[str, ...]
    _log_self_loop_prior: float
    _log_transition_prior: float
    _min_duration: Mapping[str, float]
    _anchor_substrings: Mapping[str, tuple[str, ...]]
    _legal_transitions: Mapping[str, frozenset[str]]
    _initial_log_probs: Mapping[str, float]

    def state_index(self, state: str) -> int:
        try:
            return self.states.index(state)
        except ValueError as e:
            raise KeyError(state) from e

    def log_transition(self, src: str, dst: str) -> float:
        if src not in self._legal_transitions:
            raise KeyError(src)
        if src == dst:
            return self._log_self_loop_prior
        if dst in self._legal_transitions[src]:
            return self._log_transition_prior
        return -math.inf

    def initial_log_prob(self, state: str) -> float:
        return self._initial_log_probs.get(state, -math.inf)

    def min_duration_seconds(self, state: str) -> float:
        if state not in self._min_duration:
            raise KeyError(state)
        return self._min_duration[state]

    def anchor_substrings(self, state: str) -> tuple[str, ...]:
        return self._anchor_substrings.get(state, ())


def load_state_machine(version: str) -> StateMachine:
    path = CONFIGS_DIR / f"{version}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"state machine config missing for {version!r}: {path}")
    raw = yaml.safe_load(path.read_text())

    required_top = ("version", "decoder_version", "sample_fps", "min_duration_seconds",
                    "legal_transitions", "initial_log_probs", "anchor_substrings")
    for key in required_top:
        if key not in raw:
            raise StateMachineConfigError(f"missing top-level key {key!r} in {path}")

    states = tuple(raw["min_duration_seconds"].keys())
    if len(states) != len(set(states)):
        raise StateMachineConfigError("duplicate state name in min_duration_seconds")

    legal_transitions: dict[str, frozenset[str]] = {}
    for s, dsts in raw["legal_transitions"].items():
        if s not in states:
            raise StateMachineConfigError(f"legal_transitions has unknown state {s!r}")
        legal_transitions[s] = frozenset(dsts or [])
    # Phase 1 ships with all 17 states named correctly; a typo in a destination
    # would silently make a transition unreachable. Validate before storing.
    for src, dst_set in legal_transitions.items():
        for dst in dst_set:
            if dst not in states:
                raise StateMachineConfigError(
                    f"legal_transitions[{src!r}] references unknown state {dst!r}"
                )
    # Any state without a row gets an empty out-set.
    for s in states:
        legal_transitions.setdefault(s, frozenset())

    anchor_substrings: dict[str, tuple[str, ...]] = {}
    for s, subs in raw["anchor_substrings"].items():
        if s not in states:
            raise StateMachineConfigError(f"anchor_substrings has unknown state {s!r}")
        anchor_substrings[s] = tuple(str(x).lower() for x in (subs or []))

    initial_log_probs: dict[str, float] = {}
    for s, lp in raw["initial_log_probs"].items():
        if s not in states:
            raise StateMachineConfigError(f"initial_log_probs has unknown state {s!r}")
        initial_log_probs[s] = float(lp)

    return StateMachine(
        version=str(raw["version"]),
        decoder_version=str(raw["decoder_version"]),
        sample_fps=float(raw["sample_fps"]),
        states=states,
        reject_anchor_substrings=tuple(str(s).lower() for s in raw.get("reject_anchor_substrings", [])),
        _log_self_loop_prior=float(raw.get("log_self_loop_prior", -0.05)),
        _log_transition_prior=float(raw.get("log_transition_prior", -3.0)),
        _min_duration=MappingProxyType({s: float(v) for s, v in raw["min_duration_seconds"].items()}),
        _anchor_substrings=MappingProxyType(anchor_substrings),
        _legal_transitions=MappingProxyType(legal_transitions),
        _initial_log_probs=MappingProxyType(initial_log_probs),
    )
