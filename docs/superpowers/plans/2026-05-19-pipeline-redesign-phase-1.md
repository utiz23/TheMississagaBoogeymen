# Pipeline Redesign — Phase 1 (HMM/Viterbi Pass-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-prototype HSV-cosine + run-length Pass-1 with a versioned multi-signal HMM/Viterbi state decoder that produces the same `Segment` output contract Pass-2 already consumes, while writing decoder-versioned `ocr_segments` rows for the evidence layer.

**Architecture:** Five new Python modules — state machine YAML + loader, per-frame feature extractor (HSV + anchor text + anchor templates + blur/quality), small learned multi-class classifier (scikit-learn LogisticRegression), emission combiner, and a log-space Viterbi decoder with minimum-duration post-filter. The new `pass1_segment.decode_segments()` is wired behind a `pass1.engine` config switch so the legacy `pass1_classify.build_segments()` survives as a fallback during transition. All segments tagged with `decoder_version="hmm-viterbi-v1"` so reports can filter; Pass-2 `extract_screens` is unchanged so the existing post-game extractors still drive canonical writes.

**Tech Stack:** Python 3.11+, `numpy`, `opencv-python`, `PyYAML`, `scikit-learn` (new dependency), `unittest`, `pytest`; TypeScript Node 20, Drizzle ORM, `node:test`.

---

## Background — what this replaces

Phase 0 (already merged) shipped the evidence-layer schema (`ocr_segments`, `ocr_field_evidence`, `ocr_promotions`), the extended match-250 V2 benchmark (397 assertions), and the orchestrator → dispatch → `writeSegmentForBatch` plumbing that already populates `ocr_segments` with `decoder_version="legacy-passthrough-v0-*"`. Phase 1 swaps the classifier + segmenter under that plumbing while the rest stays put.

The legacy path being replaced:

- `tools/game_ocr/game_ocr/classifier.py` — single-prototype HSV cosine + anchor-text gate per frame.
- `tools/video_ingest/video_ingest/pass1_classify.py::build_segments()` — N-consecutive-same-label run-length segmenter.

Both stay on disk during Phase 1 as a `pass1.engine=run_length` fallback; Phase 5 deletes them.

The new path being built:

- `tools/game_ocr/game_ocr/state_machine.py` — YAML-driven state set, legal transitions, min-duration priors.
- `tools/game_ocr/game_ocr/frame_features.py` — multi-signal per-frame feature extractor.
- `tools/game_ocr/game_ocr/screen_classifier.py` — small learned head (sklearn LogisticRegression over features).
- `tools/game_ocr/game_ocr/emissions.py` — combines features + learned logits into per-state log-likelihoods.
- `tools/game_ocr/game_ocr/viterbi.py` — pure-function log-space Viterbi decoder.
- `tools/video_ingest/video_ingest/pass1_segment.py` — new orchestrator entry point.

Round 4 §4 (`docs/calibration/redesign-round-4-codex-synthesis-2026-05-19.md`) is the architectural spec for everything below.

## File structure

```
tools/game_ocr/game_ocr/
├── classifier.py                          (kept; legacy fallback in Phase 1)
├── configs/
│   ├── classifier/nhl26.yaml              (kept; legacy fallback)
│   └── state_machine/
│       └── nhl26.yaml                     (NEW)
├── state_machine.py                       (NEW)
├── frame_features.py                      (NEW)
├── screen_classifier.py                   (NEW — sklearn LR head + weights I/O)
├── emissions.py                           (NEW)
├── viterbi.py                             (NEW)
└── weights/
    └── nhl26-screen-classifier.json       (NEW — trained LR weights, committed)

tools/game_ocr/scripts/
├── calibrate_classifier.py                (kept; legacy)
├── train_screen_classifier.py             (NEW — fits the LR head)
└── label_state_machine_corpus.py          (NEW — corpus expansion driver)

tools/game_ocr/calibration/extras/         (extended with per-state .png frames)

tools/video_ingest/video_ingest/
├── pass1_classify.py                      (kept; legacy fallback)
├── pass1_segment.py                       (NEW — HMM/Viterbi orchestrator)
├── orchestrator.py                        (MODIFIED — engine switch)
├── dispatch.py                            (MODIFIED — pass decoder_version)
└── configs/nhl26.yaml                     (MODIFIED — `pass1.engine`)

tools/video_ingest/tests/
├── test_pass1_segment.py                  (NEW — Viterbi integration)
├── test_state_machine.py                  (NEW)
├── test_frame_features.py                 (NEW)
├── test_viterbi.py                        (NEW)
├── test_emissions.py                      (NEW)
└── test_screen_classifier.py              (NEW)

apps/worker/src/
├── ingest-ocr.ts                          (MODIFIED — accept decoder_version)
├── ingest-ocr-cli.ts                      (MODIFIED — --decoder-version flag)
└── __tests__/
    ├── match-250-benchmark.test.ts        (EXTENDED — HMM-pass1 invariants)
    ├── match-463-loadout-segments.test.ts (NEW — committed Phase 1 T2 gate)
    └── ocr-segments-hmm-vs-legacy.test.ts (NEW — decoder_version distinguishes paths)

tools/video_ingest/tests/fixtures/
└── match-250-clip-segments.json           (kept; reused as Viterbi integration target)
```

Each file has one responsibility. The Viterbi decoder is a **pure function** so its tests are deterministic and need no fixtures. The state machine YAML is data, not code, so version upgrades touch one file. The learned classifier is a thin sklearn wrapper with a JSON weight artifact, so the training script can be re-run idempotently when the corpus grows.

---

### Task 1 — State machine YAML config + schema

**Files:**

- Create: `tools/game_ocr/game_ocr/configs/state_machine/nhl26.yaml`
- Test: none yet (just data)

- [ ] **Step 1: Author the YAML config**

Create `tools/game_ocr/game_ocr/configs/state_machine/nhl26.yaml`:

```yaml
# nhl26.yaml — Phase 1 HMM/Viterbi state machine config.
#
# Stable semantic ontology: state set and legal transitions are constant
# across NHL 26 → 27 (Round 4 §9). UI-specific assets (anchor templates,
# class dictionaries) live in per-version configs alongside this file.
#
# Probabilities are stored as natural-log values so the decoder uses log-space
# addition. -inf marks an illegal transition. Self-loops are not listed and
# default to log_self_loop_prior.

version: 'nhl26'
decoder_version: 'hmm-viterbi-v1'

# Sample rate the decoder expects. Mismatched sample_fps is a hard error.
sample_fps: 1.0

# Default self-loop prior (in nats). High value = decoder prefers to stay in
# the current state — UI screens are stable for many frames.
log_self_loop_prior: -0.05

# Default off-diagonal transition prior. Lower than self-loop by design.
log_transition_prior: -3.0

# Hard rejections at the emission stage — same as classifier.reject_anchor_substrings.
reject_anchor_substrings:
  - customize
  - seasonpass
  - rewards
  - waiting for

# Minimum duration in seconds. After Viterbi decode, runs shorter than the
# state's minimum are merged into the surrounding state (or unknown_or_transition
# if neighbors disagree). Calibrated from current run_length defaults + Round 4 §4.
min_duration_seconds:
  unknown_or_transition: 0.0
  pre_game_lobby_state_1: 2.0
  pre_game_lobby_state_2: 2.0
  player_loadout_view: 0.5 # Round 4 §4 — sub-second slot traversal
  loading_or_intro: 0.0
  in_game_clock: 5.0 # long gameplay dwell
  in_game_goal_state_1: 0.5 # transient overlay
  in_game_goal_state_2: 0.5
  post_game_player_summary: 1.5
  post_game_box_score_goals: 1.0
  post_game_box_score_shots: 1.0
  post_game_box_score_faceoffs: 1.0
  post_game_events: 1.5
  post_game_action_tracker: 1.5
  post_game_faceoff_map: 1.0
  post_game_net_chart: 1.0
  end_of_video: 0.0

# Anchor substrings per state — used as one signal in the emission combiner.
# Multiple states may share substrings; the learned head disambiguates.
anchor_substrings:
  pre_game_lobby_state_1: [finding opponent, stay in div]
  pre_game_lobby_state_2: [eashl]
  player_loadout_view: [player loadouts]
  loading_or_intro: [now loading, world chel, season]
  in_game_clock: [] # HUD scoreboard has no top-bar text anchor
  in_game_goal_state_1: [scores, goal]
  in_game_goal_state_2: [assist]
  post_game_player_summary: [player summary]
  post_game_box_score_goals: [goal summary]
  post_game_box_score_shots: [shot summary, shots summary]
  post_game_box_score_faceoffs: [faceoff summary, face-off summary]
  post_game_events: [all]
  post_game_action_tracker: [all events]
  post_game_faceoff_map: [faceoff]
  post_game_net_chart: [net chart]

# Legal transitions. Each row lists states reachable FROM the row's state
# besides the (implicit) self-loop. Anything NOT listed is illegal (-inf).
# Self-loops use log_self_loop_prior; listed transitions use log_transition_prior
# unless overridden per pair below.
legal_transitions:
  unknown_or_transition:
    - pre_game_lobby_state_1
    - pre_game_lobby_state_2
    - player_loadout_view
    - loading_or_intro
    - in_game_clock
    - post_game_player_summary
    - post_game_box_score_goals
    - post_game_box_score_shots
    - post_game_box_score_faceoffs
    - post_game_events
    - post_game_action_tracker
    - post_game_faceoff_map
    - post_game_net_chart
    - end_of_video
  pre_game_lobby_state_1:
    - unknown_or_transition
    - pre_game_lobby_state_2
    - player_loadout_view
    - loading_or_intro
  pre_game_lobby_state_2:
    - unknown_or_transition
    - pre_game_lobby_state_1
    - player_loadout_view
    - loading_or_intro
  player_loadout_view:
    - unknown_or_transition
    - pre_game_lobby_state_1
    - pre_game_lobby_state_2
    - loading_or_intro
  loading_or_intro:
    - unknown_or_transition
    - in_game_clock
    - pre_game_lobby_state_2
  in_game_clock:
    - unknown_or_transition
    - in_game_goal_state_1
    - post_game_player_summary
    - end_of_video
  in_game_goal_state_1:
    - unknown_or_transition
    - in_game_goal_state_2
    - in_game_clock
  in_game_goal_state_2:
    - unknown_or_transition
    - in_game_clock
  post_game_player_summary:
    - unknown_or_transition
    - post_game_box_score_goals
    - post_game_box_score_shots
    - post_game_box_score_faceoffs
    - post_game_events
    - post_game_action_tracker
    - post_game_faceoff_map
    - post_game_net_chart
    - end_of_video
  post_game_box_score_goals:
    - unknown_or_transition
    - post_game_box_score_shots
    - post_game_box_score_faceoffs
    - post_game_player_summary
    - post_game_events
    - post_game_action_tracker
    - post_game_faceoff_map
    - post_game_net_chart
    - end_of_video
  post_game_box_score_shots:
    - unknown_or_transition
    - post_game_box_score_goals
    - post_game_box_score_faceoffs
    - post_game_player_summary
    - post_game_events
    - post_game_action_tracker
    - post_game_faceoff_map
    - post_game_net_chart
    - end_of_video
  post_game_box_score_faceoffs:
    - unknown_or_transition
    - post_game_box_score_goals
    - post_game_box_score_shots
    - post_game_player_summary
    - post_game_events
    - post_game_action_tracker
    - post_game_faceoff_map
    - post_game_net_chart
    - end_of_video
  post_game_events:
    - unknown_or_transition
    - post_game_box_score_goals
    - post_game_box_score_shots
    - post_game_box_score_faceoffs
    - post_game_player_summary
    - post_game_action_tracker
    - post_game_faceoff_map
    - post_game_net_chart
    - end_of_video
  post_game_action_tracker:
    - unknown_or_transition
    - post_game_box_score_goals
    - post_game_box_score_shots
    - post_game_box_score_faceoffs
    - post_game_player_summary
    - post_game_events
    - post_game_faceoff_map
    - post_game_net_chart
    - end_of_video
  post_game_faceoff_map:
    - unknown_or_transition
    - post_game_box_score_goals
    - post_game_box_score_shots
    - post_game_box_score_faceoffs
    - post_game_player_summary
    - post_game_events
    - post_game_action_tracker
    - post_game_net_chart
    - end_of_video
  post_game_net_chart:
    - unknown_or_transition
    - post_game_box_score_goals
    - post_game_box_score_shots
    - post_game_box_score_faceoffs
    - post_game_player_summary
    - post_game_events
    - post_game_action_tracker
    - post_game_faceoff_map
    - end_of_video
  end_of_video: []

# Initial state distribution (log probs). Uniform over plausible openers;
# everything else is -inf (illegal as the first state).
initial_log_probs:
  unknown_or_transition: -1.0
  pre_game_lobby_state_1: -1.5
  pre_game_lobby_state_2: -1.5
  loading_or_intro: -2.0
```

- [ ] **Step 2: Commit**

```bash
git add tools/game_ocr/game_ocr/configs/state_machine/nhl26.yaml
git commit -m "feat(ocr): Phase 1 state machine YAML for HMM/Viterbi Pass-1"
```

---

### Task 2 — State machine loader

**Files:**

- Create: `tools/game_ocr/game_ocr/state_machine.py`
- Test: `tools/video_ingest/tests/test_state_machine.py`

- [ ] **Step 1: Write the failing test**

Create `tools/video_ingest/tests/test_state_machine.py`:

```python
"""Unit tests for the Phase 1 state machine loader."""

from __future__ import annotations

import math
import unittest

from game_ocr.state_machine import (
    StateMachine,
    StateMachineConfigError,
    load_state_machine,
)


class TestStateMachineLoader(unittest.TestCase):
    def test_loads_nhl26_config(self):
        sm = load_state_machine("nhl26")
        self.assertEqual(sm.version, "nhl26")
        self.assertEqual(sm.decoder_version, "hmm-viterbi-v1")
        self.assertIn("player_loadout_view", sm.states)
        self.assertIn("post_game_box_score_shots", sm.states)
        self.assertIn("end_of_video", sm.states)
        # All 17 states from Round 4 §4 present.
        self.assertEqual(len(sm.states), 17)

    def test_min_duration_lookup(self):
        sm = load_state_machine("nhl26")
        self.assertAlmostEqual(sm.min_duration_seconds("player_loadout_view"), 0.5)
        self.assertAlmostEqual(sm.min_duration_seconds("in_game_clock"), 5.0)

    def test_self_loop_log_prob(self):
        sm = load_state_machine("nhl26")
        # log_self_loop_prior = -0.05 in the YAML.
        self.assertAlmostEqual(sm.log_transition("player_loadout_view", "player_loadout_view"), -0.05)

    def test_illegal_transition_is_neg_inf(self):
        sm = load_state_machine("nhl26")
        # in_game_clock cannot directly transition to pre_game_lobby_state_2.
        lp = sm.log_transition("in_game_clock", "pre_game_lobby_state_2")
        self.assertTrue(math.isinf(lp) and lp < 0)

    def test_legal_transition_uses_default_prior(self):
        sm = load_state_machine("nhl26")
        # post_game_player_summary → post_game_box_score_goals is listed.
        self.assertAlmostEqual(
            sm.log_transition("post_game_player_summary", "post_game_box_score_goals"),
            -3.0,
        )

    def test_initial_log_prob_listed(self):
        sm = load_state_machine("nhl26")
        # pre_game_lobby_state_2 = -1.5 per YAML.
        self.assertAlmostEqual(sm.initial_log_prob("pre_game_lobby_state_2"), -1.5)

    def test_initial_log_prob_missing_is_neg_inf(self):
        sm = load_state_machine("nhl26")
        # post_game_action_tracker is not a legal opener.
        lp = sm.initial_log_prob("post_game_action_tracker")
        self.assertTrue(math.isinf(lp) and lp < 0)

    def test_anchor_substrings_lookup(self):
        sm = load_state_machine("nhl26")
        self.assertIn("player loadouts", sm.anchor_substrings("player_loadout_view"))
        self.assertEqual(sm.anchor_substrings("in_game_clock"), ())

    def test_unknown_state_raises(self):
        sm = load_state_machine("nhl26")
        with self.assertRaises(KeyError):
            sm.min_duration_seconds("nonexistent_state")

    def test_missing_config_raises(self):
        with self.assertRaises(FileNotFoundError):
            load_state_machine("not_a_real_version")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_state_machine.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'game_ocr.state_machine'"

- [ ] **Step 3: Implement the loader**

Create `tools/game_ocr/game_ocr/state_machine.py`:

```python
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
from dataclasses import dataclass
from pathlib import Path

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
    _min_duration: dict[str, float]
    _anchor_substrings: dict[str, tuple[str, ...]]
    _legal_transitions: dict[str, frozenset[str]]
    _initial_log_probs: dict[str, float]

    def state_index(self, state: str) -> int:
        return self.states.index(state)

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
        _min_duration={s: float(v) for s, v in raw["min_duration_seconds"].items()},
        _anchor_substrings=anchor_substrings,
        _legal_transitions=legal_transitions,
        _initial_log_probs=initial_log_probs,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_state_machine.py -v`
Expected: PASS — 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add tools/game_ocr/game_ocr/state_machine.py tools/video_ingest/tests/test_state_machine.py
git commit -m "feat(ocr): Phase 1 state machine loader + tests"
```

---

### Task 3 — Pure-function Viterbi decoder

**Files:**

- Create: `tools/game_ocr/game_ocr/viterbi.py`
- Test: `tools/video_ingest/tests/test_viterbi.py`

The Viterbi decoder is the math core of Phase 1. Pure function over numpy arrays — no I/O, no global state. Tests are deterministic.

- [ ] **Step 1: Write the failing test**

Create `tools/video_ingest/tests/test_viterbi.py`:

```python
"""Tests for the pure-function log-space Viterbi decoder."""

from __future__ import annotations

import math
import unittest

import numpy as np

from game_ocr.viterbi import viterbi_decode


class TestViterbiDecode(unittest.TestCase):
    def test_single_frame_picks_max_emission(self):
        # 1 frame, 3 states. State 1 has the highest emission → it wins.
        log_emit = np.array([[-2.0, -0.1, -3.0]])
        log_trans = np.full((3, 3), -1.0)
        log_init = np.array([0.0, 0.0, 0.0])
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [1])

    def test_self_loop_dominates_when_strong(self):
        # 5 frames. State 0 has slightly weaker emissions at frames 2,3 but
        # high self-loop and very negative cross-transition means decoder
        # stays in state 0.
        log_emit = np.array([
            [-0.1, -1.0, -3.0],
            [-0.1, -1.0, -3.0],
            [-0.3, -0.2, -3.0],  # frame 2: state 1 slightly better
            [-0.3, -0.2, -3.0],  # frame 3: state 1 slightly better
            [-0.1, -1.0, -3.0],
        ])
        log_trans = np.array([
            [-0.05, -5.0, -5.0],   # 0→0 high, 0→1 low
            [-5.0,  -0.05, -5.0],
            [-5.0,  -5.0,  -0.05],
        ])
        log_init = np.array([0.0, -10.0, -10.0])
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [0, 0, 0, 0, 0])

    def test_transition_through_states(self):
        # Three states, three frames. Emissions force 0 → 1 → 2.
        log_emit = np.array([
            [0.0, -5.0, -5.0],
            [-5.0, 0.0, -5.0],
            [-5.0, -5.0, 0.0],
        ])
        log_trans = np.array([
            [-0.05, -0.5, -10.0],
            [-10.0, -0.05, -0.5],
            [-10.0, -10.0, -0.05],
        ])
        log_init = np.array([0.0, -10.0, -10.0])
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [0, 1, 2])

    def test_illegal_transition_blocks_path(self):
        # Two states. State 1 has much better emission at frame 1 but
        # the transition 0→1 is illegal (-inf). Decoder must stay in 0.
        log_emit = np.array([
            [0.0, -5.0],
            [-5.0, 0.0],
            [-5.0, 0.0],
        ])
        log_trans = np.array([
            [-0.05, -math.inf],
            [-math.inf, -0.05],
        ])
        log_init = np.array([0.0, -math.inf])
        path = viterbi_decode(log_emit, log_trans, log_init)
        # State 1 unreachable from state 0; path stays in 0 the whole time.
        self.assertEqual(path.tolist(), [0, 0, 0])

    def test_returns_int_path(self):
        log_emit = np.array([[-1.0, -2.0]])
        log_trans = np.zeros((2, 2))
        log_init = np.zeros(2)
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.dtype, np.int64)

    def test_shape_mismatch_raises(self):
        log_emit = np.zeros((3, 4))         # 4 states
        log_trans = np.zeros((3, 3))        # 3 states — mismatch
        log_init = np.zeros(3)
        with self.assertRaises(ValueError):
            viterbi_decode(log_emit, log_trans, log_init)

    def test_empty_emissions_returns_empty(self):
        log_emit = np.zeros((0, 3))
        log_trans = np.zeros((3, 3))
        log_init = np.zeros(3)
        path = viterbi_decode(log_emit, log_trans, log_init)
        self.assertEqual(path.tolist(), [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_viterbi.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'game_ocr.viterbi'"

- [ ] **Step 3: Implement the decoder**

Create `tools/game_ocr/game_ocr/viterbi.py`:

```python
"""Pure-function log-space Viterbi decoder.

Given per-frame emission log-likelihoods, a transition log-prob matrix, and
initial-state log-probs, returns the most likely state sequence. Math only —
no I/O, no fixtures, no global state.

Shape contract:
  log_emit:  (T, N)  per-frame emission log-likelihood for each of N states
  log_trans: (N, N)  log P(dst | src); diagonal = self-loop
  log_init:  (N,)    log P(state at t=0)

Returns:
  path:      (T,) int64 — state index per frame
"""

from __future__ import annotations

import numpy as np


def viterbi_decode(
    log_emit: np.ndarray,
    log_trans: np.ndarray,
    log_init: np.ndarray,
) -> np.ndarray:
    if log_emit.ndim != 2:
        raise ValueError(f"log_emit must be 2-D, got shape {log_emit.shape}")
    T, N = log_emit.shape
    if log_trans.shape != (N, N):
        raise ValueError(f"log_trans shape {log_trans.shape} != expected ({N},{N})")
    if log_init.shape != (N,):
        raise ValueError(f"log_init shape {log_init.shape} != expected ({N},)")
    if T == 0:
        return np.zeros(0, dtype=np.int64)

    delta = np.full((T, N), -np.inf, dtype=np.float64)
    backptr = np.zeros((T, N), dtype=np.int64)

    delta[0] = log_init + log_emit[0]
    for t in range(1, T):
        # For each destination state, find the best (source, score).
        # scores[i, j] = delta[t-1, i] + log_trans[i, j]
        scores = delta[t - 1][:, None] + log_trans   # (N, N)
        backptr[t] = np.argmax(scores, axis=0)
        delta[t] = scores[backptr[t], np.arange(N)] + log_emit[t]

    path = np.zeros(T, dtype=np.int64)
    path[-1] = int(np.argmax(delta[-1]))
    for t in range(T - 1, 0, -1):
        path[t - 1] = backptr[t, path[t]]
    return path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_viterbi.py -v`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add tools/game_ocr/game_ocr/viterbi.py tools/video_ingest/tests/test_viterbi.py
git commit -m "feat(ocr): Phase 1 Viterbi decoder pure function + tests"
```

---

### Task 4 — Multi-signal frame feature extractor

**Files:**

- Create: `tools/game_ocr/game_ocr/frame_features.py`
- Test: `tools/video_ingest/tests/test_frame_features.py`

Per-frame features feeding the emission combiner: HSV histogram (kept from legacy), anchor-text presence flags per state, blur/quality score, brightness. Anchor templates are deferred to Task 5.

- [ ] **Step 1: Write the failing test**

Create `tools/video_ingest/tests/test_frame_features.py`:

```python
"""Tests for the per-frame multi-signal feature extractor."""

from __future__ import annotations

import unittest

import numpy as np

from game_ocr.frame_features import (
    FrameFeatures,
    blur_score,
    compute_frame_features,
)
from game_ocr.state_machine import load_state_machine


def _solid_frame(h: int, w: int, color_bgr: tuple[int, int, int]) -> np.ndarray:
    f = np.zeros((h, w, 3), dtype=np.uint8)
    f[:] = color_bgr
    return f


class TestBlurScore(unittest.TestCase):
    def test_solid_frame_is_blurry(self):
        # No edges → laplacian variance is ~0.
        f = _solid_frame(100, 100, (128, 128, 128))
        self.assertLess(blur_score(f), 5.0)

    def test_checkerboard_is_sharp(self):
        # High-contrast checkerboard → large laplacian variance.
        f = np.zeros((100, 100, 3), dtype=np.uint8)
        f[::2, ::2] = 255
        f[1::2, 1::2] = 255
        self.assertGreater(blur_score(f), 100.0)


class TestComputeFrameFeatures(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_hsv_histogram_shape(self):
        frame = _solid_frame(1080, 1920, (50, 100, 200))
        feats = compute_frame_features(frame, anchor_text="", state_machine=self.sm)
        # 12 * 4 * 4 = 192 bins.
        self.assertEqual(feats.hsv_histogram.shape, (192,))
        self.assertAlmostEqual(feats.hsv_histogram.sum(), 1.0, places=5)

    def test_anchor_flags_match_state_machine(self):
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="player loadouts header",
            state_machine=self.sm,
        )
        # 17 states in nhl26.yaml.
        self.assertEqual(feats.anchor_flags.shape, (17,))
        idx = self.sm.state_index("player_loadout_view")
        self.assertEqual(feats.anchor_flags[idx], 1.0)
        # No other state's anchor present.
        # Find another state whose substrings do not appear in the text.
        loadout_flag = feats.anchor_flags[idx]
        action_idx = self.sm.state_index("post_game_action_tracker")
        self.assertEqual(feats.anchor_flags[action_idx], 0.0)
        self.assertEqual(loadout_flag, 1.0)

    def test_anchor_fuzzy_match(self):
        # 1 character off — should still fire via fuzzy_contains in classifier.
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="player ioadouts",  # 'l' → 'i'
            state_machine=self.sm,
        )
        idx = self.sm.state_index("player_loadout_view")
        self.assertEqual(feats.anchor_flags[idx], 1.0)

    def test_reject_anchor_returns_features_with_flag(self):
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="customize roster",
            state_machine=self.sm,
        )
        # Reject anchors set a separate flag, do not zero out the per-state flags.
        self.assertTrue(feats.reject_anchor_present)

    def test_quality_signals_present(self):
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="",
            state_machine=self.sm,
        )
        self.assertGreaterEqual(feats.brightness, 0.0)
        self.assertLessEqual(feats.brightness, 1.0)
        self.assertGreaterEqual(feats.blur_score, 0.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_frame_features.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'game_ocr.frame_features'"

- [ ] **Step 3: Implement the extractor**

Create `tools/game_ocr/game_ocr/frame_features.py`:

```python
"""Multi-signal per-frame feature extractor for Phase 1.

Round 4 §4 mandates more signals than HSV cosine alone. This module produces:

  - HSV histogram (kept from classifier.py — proven discriminator for stable
    high-contrast screens like loadout/lobby).
  - Anchor-text presence flags per state (using fuzzy_contains, same edit
    tolerance as the legacy classifier).
  - Reject-anchor flag (e.g. matchmaking / intermission text patterns).
  - Brightness (mean V channel, normalised) — separates loading transitions
    from gameplay.
  - Blur score (Laplacian variance) — quality signal for frame-bundle
    selection downstream and emission down-weighting today.

The output FrameFeatures dataclass is the contract for emissions.py.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from game_ocr.classifier import fuzzy_contains, hsv_histogram
from game_ocr.state_machine import StateMachine


@dataclass(frozen=True)
class FrameFeatures:
    hsv_histogram: np.ndarray
    anchor_flags: np.ndarray
    anchor_text: str
    reject_anchor_present: bool
    brightness: float
    blur_score: float


def blur_score(image_bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _brightness(image_bgr: np.ndarray) -> float:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.float64)
    return float(v.mean() / 255.0)


def compute_frame_features(
    image_bgr: np.ndarray,
    *,
    anchor_text: str,
    state_machine: StateMachine,
    hist_bins: tuple[int, int, int] = (12, 4, 4),
    fuzzy_max_distance: int = 1,
) -> FrameFeatures:
    hist = hsv_histogram(image_bgr, hist_bins)

    anchor_text_lower = anchor_text.lower()
    flags = np.zeros(len(state_machine.states), dtype=np.float64)
    for i, state in enumerate(state_machine.states):
        for sub in state_machine.anchor_substrings(state):
            if fuzzy_contains(anchor_text_lower, sub, fuzzy_max_distance):
                flags[i] = 1.0
                break

    reject_present = any(
        fuzzy_contains(anchor_text_lower, sub, fuzzy_max_distance)
        for sub in state_machine.reject_anchor_substrings
    )

    return FrameFeatures(
        hsv_histogram=hist,
        anchor_flags=flags,
        anchor_text=anchor_text,
        reject_anchor_present=reject_present,
        brightness=_brightness(image_bgr),
        blur_score=blur_score(image_bgr),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_frame_features.py -v`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add tools/game_ocr/game_ocr/frame_features.py tools/video_ingest/tests/test_frame_features.py
git commit -m "feat(ocr): Phase 1 multi-signal frame feature extractor + tests"
```

---

### Task 5 — Small learned screen classifier (sklearn LR head)

**Files:**

- Create: `tools/game_ocr/game_ocr/screen_classifier.py`
- Create: `tools/game_ocr/game_ocr/weights/.gitkeep` (empty placeholder until Task 6)
- Test: `tools/video_ingest/tests/test_screen_classifier.py`

The learned head is a multinomial logistic regression over a fixed feature vector built from FrameFeatures. Weights persist as a JSON artifact so they're versioned in git and reload deterministically. Round 4 §1's adjudication: "use an HMM/Viterbi state decoder, but the per-frame emissions feeding that decoder should include a learned lightweight classifier rather than raw HSV cosine alone."

- [ ] **Step 1: Add scikit-learn dependency**

Edit `tools/video_ingest/pyproject.toml`:

```toml
dependencies = [
  "opencv-python",
  "numpy",
  "PyYAML",
  "typer",
  "scikit-learn>=1.3",
]
```

Then run `pip install -e tools/video_ingest`.

- [ ] **Step 2: Write the failing test**

Create `tools/video_ingest/tests/test_screen_classifier.py`:

```python
"""Tests for the small learned screen classifier."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from game_ocr.frame_features import FrameFeatures
from game_ocr.screen_classifier import (
    ScreenClassifier,
    ScreenClassifierWeights,
    feature_vector,
    load_screen_classifier,
    train_screen_classifier,
)
from game_ocr.state_machine import load_state_machine


def _fake_features(hist_value: float, brightness: float, blur: float, anchor_idx: int | None, n_states: int) -> FrameFeatures:
    hist = np.full(192, hist_value, dtype=np.float64)
    flags = np.zeros(n_states, dtype=np.float64)
    if anchor_idx is not None:
        flags[anchor_idx] = 1.0
    return FrameFeatures(
        hsv_histogram=hist,
        anchor_flags=flags,
        anchor_text="",
        reject_anchor_present=False,
        brightness=brightness,
        blur_score=blur,
    )


class TestFeatureVector(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_vector_concatenates_signals(self):
        feats = _fake_features(0.01, 0.5, 50.0, anchor_idx=2, n_states=len(self.sm.states))
        vec = feature_vector(feats, self.sm)
        # 192 hist + 17 anchor flags + 1 brightness + 1 log-blur + 1 reject = 212.
        self.assertEqual(vec.shape, (192 + len(self.sm.states) + 3,))
        # First 192 entries are the histogram.
        self.assertAlmostEqual(float(vec[0]), 0.01)


class TestScreenClassifierTrainAndPredict(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_trains_and_predicts_top_class(self):
        # Synthetic training data: per state, one feature vector with the
        # anchor flag set for that state. Trivially separable.
        feats_train = []
        labels_train = []
        for i, state in enumerate(self.sm.states):
            feats_train.append(
                _fake_features(0.001, 0.4, 20.0, anchor_idx=i, n_states=len(self.sm.states))
            )
            labels_train.append(state)

        clf = train_screen_classifier(feats_train, labels_train, self.sm)
        # Predict on the same point — must recover the state.
        target_idx = self.sm.state_index("player_loadout_view")
        test_feats = _fake_features(0.001, 0.4, 20.0, anchor_idx=target_idx, n_states=len(self.sm.states))
        logits = clf.predict_log_probs(test_feats)
        self.assertEqual(logits.shape, (len(self.sm.states),))
        self.assertEqual(int(np.argmax(logits)), target_idx)


class TestScreenClassifierIO(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_save_and_load_weights_roundtrip(self):
        feats_train = []
        labels_train = []
        for i, state in enumerate(self.sm.states):
            feats_train.append(
                _fake_features(0.001, 0.4, 20.0, anchor_idx=i, n_states=len(self.sm.states))
            )
            labels_train.append(state)
        clf = train_screen_classifier(feats_train, labels_train, self.sm)

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "weights.json"
            clf.save(path)
            self.assertTrue(path.exists())
            loaded = load_screen_classifier(path, self.sm)
            # Same prediction on the same input.
            test_feats = _fake_features(0.001, 0.4, 20.0, anchor_idx=3, n_states=len(self.sm.states))
            np.testing.assert_allclose(
                clf.predict_log_probs(test_feats),
                loaded.predict_log_probs(test_feats),
                atol=1e-9,
            )
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_screen_classifier.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'game_ocr.screen_classifier'"

- [ ] **Step 4: Implement the classifier**

Create `tools/game_ocr/game_ocr/screen_classifier.py`:

```python
"""Phase 1 learned screen classifier — a multinomial logistic regression
over a compact feature vector. Replaces the single-prototype HSV-cosine
classifier as the primary per-frame signal feeding the Viterbi decoder
(Round 4 §1 disagreement-3 adjudication, §12 — HSV-cosine demoted).

Why sklearn LR rather than a CNN: Phase 1's effort budget is 40-80 hours and
the calibration corpus has ~12-30 fixtures, not thousands. A linear model
over hand-engineered features is appropriate at this corpus scale, trains
in seconds, and exports to a stable JSON artifact that's reviewable in git.
Phase 5 can swap for a CNN/CLIP head behind the same `predict_log_probs`
interface if the corpus grows enough to justify it.

Weights artifact format (JSON):
  {
    "schema_version": 1,
    "version": "nhl26",
    "decoder_version": "hmm-viterbi-v1",
    "classes": [<state names in row order>],
    "intercept": [...],
    "coef": [[...], [...]]   # shape (n_states, n_features)
  }
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from sklearn.linear_model import LogisticRegression

from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import StateMachine


WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"


@dataclass(frozen=True)
class ScreenClassifierWeights:
    version: str
    decoder_version: str
    classes: tuple[str, ...]
    intercept: np.ndarray
    coef: np.ndarray


def feature_vector(features: FrameFeatures, state_machine: StateMachine) -> np.ndarray:
    """Concatenate signals into a single 1-D vector.

    Layout: [hsv_histogram(192) || anchor_flags(N) || brightness || log1p(blur) || reject_flag]
    Length: 192 + N + 3.
    """
    n = len(state_machine.states)
    out = np.empty(192 + n + 3, dtype=np.float64)
    out[:192] = features.hsv_histogram
    out[192:192 + n] = features.anchor_flags
    out[192 + n + 0] = features.brightness
    out[192 + n + 1] = math.log1p(max(0.0, features.blur_score))
    out[192 + n + 2] = 1.0 if features.reject_anchor_present else 0.0
    return out


class ScreenClassifier:
    """Wrapper around sklearn LR exposing predict_log_probs over the state set."""

    def __init__(self, weights: ScreenClassifierWeights, state_machine: StateMachine) -> None:
        if weights.version != state_machine.version:
            raise ValueError(
                f"weights version {weights.version!r} != state machine {state_machine.version!r}"
            )
        if weights.classes != state_machine.states:
            raise ValueError(
                "weights.classes do not match state machine.states ordering"
            )
        self.weights = weights
        self.state_machine = state_machine

    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray:
        x = feature_vector(features, self.state_machine)
        # logits = coef @ x + intercept, then log-softmax.
        logits = self.weights.coef @ x + self.weights.intercept
        # log-softmax for numerical stability.
        m = float(logits.max())
        log_sum_exp = m + math.log(float(np.exp(logits - m).sum()))
        return logits - log_sum_exp

    def save(self, path: Path) -> None:
        payload = {
            "schema_version": 1,
            "version": self.weights.version,
            "decoder_version": self.weights.decoder_version,
            "classes": list(self.weights.classes),
            "intercept": self.weights.intercept.tolist(),
            "coef": self.weights.coef.tolist(),
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2))


def train_screen_classifier(
    features: Iterable[FrameFeatures],
    labels: Iterable[str],
    state_machine: StateMachine,
) -> ScreenClassifier:
    features_list = list(features)
    labels_list = list(labels)
    if len(features_list) != len(labels_list):
        raise ValueError("features and labels length mismatch")
    if len(features_list) == 0:
        raise ValueError("cannot train on empty corpus")

    X = np.stack([feature_vector(f, state_machine) for f in features_list])
    # Map labels to ordered class indices to keep the row ordering aligned
    # with state_machine.states.
    label_to_idx = {s: i for i, s in enumerate(state_machine.states)}
    for lbl in labels_list:
        if lbl not in label_to_idx:
            raise ValueError(f"unknown label {lbl!r} not in state machine")
    y = np.array([label_to_idx[lbl] for lbl in labels_list], dtype=np.int64)

    # Build a matrix in state-machine order so coef rows align with states.
    # sklearn fits classes by sorted unique label values; we sort indices,
    # then re-order coef/intercept back to state-machine order below.
    lr = LogisticRegression(
        multi_class="multinomial",
        solver="lbfgs",
        max_iter=1000,
        C=1.0,
    )
    lr.fit(X, y)

    # sklearn returns coef/intercept ordered by lr.classes_; re-order so
    # row i corresponds to state_machine.states[i].
    sklearn_order = list(lr.classes_)
    coef_full = np.zeros((len(state_machine.states), X.shape[1]), dtype=np.float64)
    intercept_full = np.zeros(len(state_machine.states), dtype=np.float64)
    for row, cls in enumerate(sklearn_order):
        coef_full[cls] = lr.coef_[row]
        intercept_full[cls] = lr.intercept_[row]

    weights = ScreenClassifierWeights(
        version=state_machine.version,
        decoder_version=state_machine.decoder_version,
        classes=state_machine.states,
        intercept=intercept_full,
        coef=coef_full,
    )
    return ScreenClassifier(weights, state_machine)


def load_screen_classifier(path: Path, state_machine: StateMachine) -> ScreenClassifier:
    raw = json.loads(Path(path).read_text())
    if int(raw.get("schema_version", 0)) != 1:
        raise ValueError(f"unsupported screen_classifier schema_version: {raw.get('schema_version')}")
    weights = ScreenClassifierWeights(
        version=str(raw["version"]),
        decoder_version=str(raw["decoder_version"]),
        classes=tuple(raw["classes"]),
        intercept=np.asarray(raw["intercept"], dtype=np.float64),
        coef=np.asarray(raw["coef"], dtype=np.float64),
    )
    return ScreenClassifier(weights, state_machine)
```

Create the empty weights directory marker:

```bash
mkdir -p tools/game_ocr/game_ocr/weights
touch tools/game_ocr/game_ocr/weights/.gitkeep
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_screen_classifier.py -v`
Expected: PASS — 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add tools/video_ingest/pyproject.toml tools/game_ocr/game_ocr/screen_classifier.py \
        tools/game_ocr/game_ocr/weights/.gitkeep tools/video_ingest/tests/test_screen_classifier.py
git commit -m "feat(ocr): Phase 1 learned screen classifier (sklearn LR head) + tests"
```

---

### Task 6 — Training script + corpus expansion driver

**Files:**

- Create: `tools/game_ocr/scripts/train_screen_classifier.py`
- Create: `tools/game_ocr/scripts/label_state_machine_corpus.py`

The training script reads labeled fixtures (canonical ScreenShots + `calibration/extras/`), runs the OCR backend once per fixture to grab anchor text, computes FrameFeatures, fits `train_screen_classifier`, and writes `tools/game_ocr/game_ocr/weights/nhl26-screen-classifier.json`. The corpus expansion driver extends `annotate.py` with the three new states from Round 4 §4 (`unknown_or_transition`, `loading_or_intro`, plus the box-score tab variants).

- [ ] **Step 1: Author the training script**

Create `tools/game_ocr/scripts/train_screen_classifier.py`:

```python
"""Train the Phase 1 learned screen classifier from labeled fixtures.

Walks the canonical ScreenShots/ and calibration/extras/ corpora, runs the
RapidOCR backend once per fixture to compute the anchor-text region, builds
FrameFeatures, fits sklearn LogisticRegression, and writes the JSON weights
artifact at tools/game_ocr/game_ocr/weights/<version>-screen-classifier.json.

Idempotent: re-running overwrites the weights file. Commit the regenerated
weights as part of the same change.

Usage:
    set -a && source .env && set +a  # not needed; no DB access
    python3 tools/game_ocr/scripts/train_screen_classifier.py [--version nhl26]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

from game_ocr.classifier import _scale_roi  # noqa: E402 -- internal helper
from game_ocr.frame_features import compute_frame_features  # noqa: E402
from game_ocr.ocr import RapidOCRBackend  # noqa: E402
from game_ocr.screen_classifier import train_screen_classifier  # noqa: E402
from game_ocr.state_machine import load_state_machine  # noqa: E402
from game_ocr.utils import normalize_text  # noqa: E402


SCREENSHOTS = GAME_OCR / "ScreenShots"
EXTRAS = GAME_OCR / "calibration" / "extras"

# Map fixture filename → state label. The canonical fixture set is small;
# extras grows via label_state_machine_corpus.py.
CANONICAL: dict[str, str] = {
    "Pre-Game Lobby State 1.png": "pre_game_lobby_state_1",
    "Pre-Game Lobby State 2.png": "pre_game_lobby_state_2",
    "Player Loadout View.png": "player_loadout_view",
    "Post Game Player Summary.png": "post_game_player_summary",
    "Post Game Box Score.png": "post_game_box_score_goals",
    "Post Game Events.png": "post_game_events",
    "Post Game Action tracker (All-Goals + Hits + Shots + Penalties + Faceoffs).png": "post_game_action_tracker",
    "Post Game Event Map Faceoffs.png": "post_game_faceoff_map",
    "Post Game Event Map Net-Chart.png": "post_game_net_chart",
    "In Game Clock.png": "in_game_clock",
    "In Game Goal Part 1.png": "in_game_goal_state_1",
    "In Game Goal Part 2.png": "in_game_goal_state_2",
}


def _read_image(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"cv2.imread failed: {path}")
    if img.shape[0] != 1080 or img.shape[1] != 1920:
        img = cv2.resize(img, (1920, 1080), interpolation=cv2.INTER_AREA)
    return img


def _read_anchor_text(img: np.ndarray, ocr: RapidOCRBackend, roi: tuple[int, int, int, int]) -> str:
    rx1, ry1, rx2, ry2 = _scale_roi(roi, img.shape[:2])
    crop = img[ry1:ry2, rx1:rx2]
    lines = ocr.read(crop)
    return " ".join(normalize_text(line.text) for line in lines if line.text).lower()


def _extras_label(filename: str) -> str | None:
    """Filename convention: <state>__match<N>_t<T>_vs_<opp>.png — leading state slug."""
    head = filename.split("__", 1)[0]
    return head or None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="nhl26")
    ap.add_argument("--anchor-roi", type=int, nargs=4, default=[0, 0, 1920, 200])
    args = ap.parse_args()

    sm = load_state_machine(args.version)
    ocr = RapidOCRBackend(use_gpu=False)

    feats = []
    labels = []
    skipped: list[str] = []

    for fname, label in CANONICAL.items():
        path = SCREENSHOTS / fname
        if not path.exists():
            skipped.append(str(path))
            continue
        if label not in sm.states:
            print(f"warn: canonical label {label!r} not in state machine, skipping", file=sys.stderr)
            continue
        img = _read_image(path)
        anchor = _read_anchor_text(img, ocr, tuple(args.anchor_roi))
        feats.append(compute_frame_features(img, anchor_text=anchor, state_machine=sm))
        labels.append(label)
        print(f"  + canonical {label}  ←  {fname}", file=sys.stderr)

    for path in sorted(EXTRAS.glob("*.png")):
        lbl = _extras_label(path.name)
        if lbl is None or lbl not in sm.states:
            print(f"warn: extras file {path.name} has unrecognised label, skipping", file=sys.stderr)
            continue
        img = _read_image(path)
        anchor = _read_anchor_text(img, ocr, tuple(args.anchor_roi))
        feats.append(compute_frame_features(img, anchor_text=anchor, state_machine=sm))
        labels.append(lbl)
        print(f"  + extra {lbl}  ←  {path.name}", file=sys.stderr)

    if not feats:
        print("error: no training data found", file=sys.stderr)
        return 1

    clf = train_screen_classifier(feats, labels, sm)
    out_path = GAME_OCR / "game_ocr" / "weights" / f"{args.version}-screen-classifier.json"
    clf.save(out_path)
    print(f"\ntrained on {len(feats)} samples covering {len(set(labels))} states", file=sys.stderr)
    print(f"wrote {out_path}")
    if skipped:
        print(f"\nskipped {len(skipped)} missing fixtures:")
        for s in skipped:
            print(f"  - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run training script once to materialise weights**

```bash
cd /home/michal/projects/eanhl-team-website
PYTHONPATH=tools/game_ocr python3 tools/game_ocr/scripts/train_screen_classifier.py --version nhl26
```

Expected: stderr lists labeled fixtures (canonical + extras), final `wrote tools/game_ocr/game_ocr/weights/nhl26-screen-classifier.json`. Open the JSON and sanity-check `schema_version: 1`, `classes` array contains all 17 states, `coef` shape (17, 212).

- [ ] **Step 3: Author the corpus expansion driver**

Create `tools/game_ocr/scripts/label_state_machine_corpus.py`:

```python
"""Operator-driven corpus expansion for the Phase 1 state machine.

Like video_ingest/annotate.py but covers all 17 states (annotate.py only knew
the legacy 8). Reads a Pass-1 segments.json (legacy or HMM), picks the top-N
frames where the decoder was unconfident, opens each frame in the OS image
viewer, and accepts a numeric label that maps to one of the 17 states.

Output: a labeled PNG written to tools/game_ocr/calibration/extras/ using the
existing naming convention `<state>__match<N>_t<T>_vs_<opp>.png`. Re-run
train_screen_classifier.py to fold the new labels into the weights artifact.

Usage:
    python3 tools/game_ocr/scripts/label_state_machine_corpus.py \\
        --segments /tmp/vi-canonical/<sha>/segments.json \\
        --video /mnt/k/NHL/NHL26/<file>.mkv \\
        --match-id 250 \\
        --opp 4thline
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
sys.path.insert(0, str(GAME_OCR))

from game_ocr.state_machine import load_state_machine  # noqa: E402


def _slugify(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9]+", "-", (s or "").strip().lower()).strip("-")
    return out or "unknown"


def _open_image(path: Path) -> None:
    for opener in ("xdg-open", "wslview", "explorer.exe"):
        if shutil.which(opener):
            subprocess.Popen(
                [opener, str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return


def _extract_frame(video: Path, seconds: float, out_path: Path) -> bool:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-ss", str(seconds), "-i", str(video),
            "-frames:v", "1",
            "-vf", "scale=1920:1080",
            "-y", str(out_path),
        ],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and out_path.exists()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--segments", type=Path, required=True)
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--version", default="nhl26")
    ap.add_argument("--match-id", type=int, default=None)
    ap.add_argument("--opp", default="unknown")
    ap.add_argument("--top-n", type=int, default=20)
    ap.add_argument(
        "--extras-dir",
        type=Path,
        default=GAME_OCR / "calibration" / "extras",
    )
    args = ap.parse_args()

    sm = load_state_machine(args.version)
    data = json.loads(args.segments.read_text())
    fc = data.get("frame_classifications", [])
    if not fc:
        print("no frame_classifications in segments.json", file=sys.stderr)
        return 1

    # Candidate selection: frames marked unknown OR low-confidence anchored.
    candidates = [f for f in fc if f.get("screen_type") in ("unknown_screen", "unknown_or_transition")]
    candidates.sort(key=lambda f: -float(f.get("color_score", 0.0)))
    candidates = candidates[: args.top_n]

    print(f"\nState menu:")
    for i, s in enumerate(sm.states):
        print(f"  {i:>2}  {s}")
    print(f"   s   skip   q   quit\n")

    tmp_dir = Path("/tmp/label-corpus-tmp")
    tmp_dir.mkdir(exist_ok=True)
    labeled = skipped = 0
    for i, f in enumerate(candidates, 1):
        seconds = float(f["seconds"])
        tmp_png = tmp_dir / f"cand-{int(seconds):05d}.png"
        if not _extract_frame(args.video, seconds, tmp_png):
            print(f"[{i}/{len(candidates)}] ffmpeg failed; skip"); continue
        anchor = (f.get("anchor_text") or "")[:80]
        print(f"[{i}/{len(candidates)}] t={seconds:.0f}s  anchor={anchor!r}")
        _open_image(tmp_png)
        choice = input("  label: ").strip().lower()
        if choice == "q":
            break
        if choice == "s" or not choice:
            skipped += 1
            continue
        try:
            idx = int(choice)
        except ValueError:
            skipped += 1
            print("  not a number, skip"); continue
        if idx < 0 or idx >= len(sm.states):
            skipped += 1
            print(f"  index {idx} out of range, skip"); continue
        klass = sm.states[idx]
        match_part = f"match{args.match_id}" if args.match_id else "match-unknown"
        out_name = f"{klass}__{match_part}_t{int(seconds)}_vs_{_slugify(args.opp)}.png"
        out_path = args.extras_dir / out_name
        out_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tmp_png, out_path)
        print(f"  → saved {out_name}")
        labeled += 1

    print(f"\nlabeled={labeled} skipped={skipped}")
    if labeled:
        print(f"Run train_screen_classifier.py to fold new labels into weights.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Commit weights + scripts**

```bash
git add tools/game_ocr/scripts/train_screen_classifier.py \
        tools/game_ocr/scripts/label_state_machine_corpus.py \
        tools/game_ocr/game_ocr/weights/nhl26-screen-classifier.json
git commit -m "feat(ocr): Phase 1 LR-head training + corpus expansion scripts; initial nhl26 weights"
```

---

### Task 7 — Emission combiner

**Files:**

- Create: `tools/game_ocr/game_ocr/emissions.py`
- Test: `tools/video_ingest/tests/test_emissions.py`

The emission combiner turns per-frame `FrameFeatures` + screen classifier output into a `(T, N)` log-emission matrix the Viterbi decoder consumes. It also applies the reject-anchor hard rejection: when a reject anchor fires, only `unknown_or_transition` has nonzero emission.

- [ ] **Step 1: Write the failing test**

Create `tools/video_ingest/tests/test_emissions.py`:

```python
"""Tests for the Phase 1 emission combiner."""

from __future__ import annotations

import math
import unittest

import numpy as np

from game_ocr.emissions import EmissionWeights, build_log_emissions
from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import load_state_machine


def _feats(n_states: int, *, anchor_idx: int | None, brightness: float = 0.4,
           blur: float = 50.0, reject: bool = False) -> FrameFeatures:
    flags = np.zeros(n_states, dtype=np.float64)
    if anchor_idx is not None:
        flags[anchor_idx] = 1.0
    return FrameFeatures(
        hsv_histogram=np.full(192, 1.0 / 192, dtype=np.float64),
        anchor_flags=flags,
        anchor_text="",
        reject_anchor_present=reject,
        brightness=brightness,
        blur_score=blur,
    )


class _MockClassifier:
    """Stub for testing emissions without invoking sklearn."""

    def __init__(self, log_probs_for: dict[int, np.ndarray]):
        self.log_probs_for = log_probs_for
        self.calls = 0

    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray:
        out = self.log_probs_for.get(self.calls, np.full(17, -math.log(17)))
        self.calls += 1
        return out


class TestBuildLogEmissions(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")
        self.weights = EmissionWeights(
            classifier_weight=1.0,
            anchor_bonus=2.0,
            reject_floor=-20.0,
        )

    def test_shape(self):
        feats = [_feats(17, anchor_idx=2) for _ in range(5)]
        clf = _MockClassifier({})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        self.assertEqual(em.shape, (5, 17))

    def test_anchor_bonus_lifts_matching_state(self):
        feats = [_feats(17, anchor_idx=self.sm.state_index("player_loadout_view"))]
        clf = _MockClassifier({0: np.full(17, -math.log(17))})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        target = self.sm.state_index("player_loadout_view")
        # All other states get the classifier baseline; target gets baseline + anchor_bonus.
        for i in range(17):
            if i == target:
                self.assertGreater(em[0, i], em[0, (i + 1) % 17])

    def test_reject_anchor_pins_unknown(self):
        feats = [_feats(17, anchor_idx=None, reject=True)]
        clf = _MockClassifier({0: np.full(17, -math.log(17))})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        unk = self.sm.state_index("unknown_or_transition")
        # All non-unknown states clamped at reject_floor.
        for i in range(17):
            if i != unk:
                self.assertLessEqual(em[0, i], -20.0 + 1e-9)
        # Unknown is the highest.
        self.assertEqual(int(np.argmax(em[0])), unk)

    def test_classifier_weight_scales_logits(self):
        feats = [_feats(17, anchor_idx=None)]
        # Classifier strongly prefers state 3.
        lp = np.full(17, -10.0)
        lp[3] = 0.0
        clf = _MockClassifier({0: lp})
        em = build_log_emissions(feats, clf, self.sm, self.weights)
        # State 3 should win because the classifier weight is positive.
        self.assertEqual(int(np.argmax(em[0])), 3)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_emissions.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'game_ocr.emissions'"

- [ ] **Step 3: Implement the combiner**

Create `tools/game_ocr/game_ocr/emissions.py`:

```python
"""Emission combiner: per-frame FrameFeatures + screen classifier → (T, N) log emissions.

Round 4 §4 — emissions feeding the Viterbi decoder are a weighted sum of
several signals. Here the recipe is:

  log_emit[t, s] =
      classifier_weight * classifier.predict_log_probs(features_t)[s]
    + anchor_bonus      * features_t.anchor_flags[s]

When features_t.reject_anchor_present is True, log_emit[t, s] is clamped to
reject_floor for every state except unknown_or_transition (which gets a
small positive bump so it strictly wins).

Quality signals (blur, brightness) are already inside the classifier's
feature vector, so they don't enter twice here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Protocol

import numpy as np

from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import StateMachine


class _ClassifierProto(Protocol):
    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray: ...


@dataclass(frozen=True)
class EmissionWeights:
    classifier_weight: float = 1.0
    anchor_bonus: float = 2.0
    reject_floor: float = -20.0


def build_log_emissions(
    features: Iterable[FrameFeatures],
    classifier: _ClassifierProto,
    state_machine: StateMachine,
    weights: EmissionWeights,
) -> np.ndarray:
    feats_list = list(features)
    n = len(state_machine.states)
    T = len(feats_list)
    out = np.full((T, n), 0.0, dtype=np.float64)
    unk_idx = state_machine.state_index("unknown_or_transition")
    for t, f in enumerate(feats_list):
        if f.reject_anchor_present:
            out[t, :] = weights.reject_floor
            out[t, unk_idx] = weights.reject_floor + 1.0
            continue
        lp = classifier.predict_log_probs(f)
        if lp.shape != (n,):
            raise ValueError(
                f"classifier returned shape {lp.shape}, expected ({n},)"
            )
        out[t, :] = weights.classifier_weight * lp + weights.anchor_bonus * f.anchor_flags
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_emissions.py -v`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add tools/game_ocr/game_ocr/emissions.py tools/video_ingest/tests/test_emissions.py
git commit -m "feat(ocr): Phase 1 emission combiner + tests"
```

---

### Task 8 — `pass1_segment.decode_segments()` top-level decoder

**Files:**

- Create: `tools/video_ingest/video_ingest/pass1_segment.py`
- Test: `tools/video_ingest/tests/test_pass1_segment.py`

This is the new module the orchestrator calls instead of `pass1_classify.build_segments()`. It chains: read frames → compute features → build emissions → Viterbi → minimum-duration filter → emit `Segment` list compatible with the legacy output contract.

- [ ] **Step 1: Write the failing test**

Create `tools/video_ingest/tests/test_pass1_segment.py`:

```python
"""Integration tests for pass1_segment.decode_segments(), the HMM/Viterbi
top-level Pass-1 decoder."""

from __future__ import annotations

import math
import unittest

import numpy as np

from game_ocr.emissions import EmissionWeights
from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import load_state_machine
from video_ingest.pass1_classify import Segment
from video_ingest.pass1_segment import decode_segments


class _FixedClassifier:
    """Returns canned log-probs per state index in a sequence."""

    def __init__(self, per_frame_state_idx: list[int], n_states: int):
        self.seq = per_frame_state_idx
        self.calls = 0
        self.n = n_states

    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray:
        out = np.full(self.n, -10.0, dtype=np.float64)
        out[self.seq[self.calls]] = 0.0
        self.calls += 1
        return out


def _stub_feats(n_states: int, anchor_idx: int | None) -> FrameFeatures:
    flags = np.zeros(n_states, dtype=np.float64)
    if anchor_idx is not None:
        flags[anchor_idx] = 1.0
    return FrameFeatures(
        hsv_histogram=np.full(192, 1.0 / 192, dtype=np.float64),
        anchor_flags=flags,
        anchor_text="",
        reject_anchor_present=False,
        brightness=0.4,
        blur_score=50.0,
    )


class TestDecodeSegments(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")
        self.weights = EmissionWeights()

    def test_single_long_run_emits_one_segment(self):
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        feats = [_stub_feats(n, anchor_idx=lobby) for _ in range(10)]
        clf = _FixedClassifier([lobby] * 10, n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].screen_type, "pre_game_lobby_state_2")
        self.assertEqual(segments[0].frame_count, 10)
        self.assertEqual(segments[0].start_index, 0)
        self.assertEqual(segments[0].end_index, 9)

    def test_min_duration_drops_short_segment(self):
        # Loadout view's min duration is 0.5s; at sample_fps=1.0 that's 1 frame.
        # Force a 1-frame post_game_player_summary (min 1.5s = 2 frames) to be dropped.
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        summary = self.sm.state_index("post_game_player_summary")
        loadout = self.sm.state_index("player_loadout_view")
        # Lobby 4 frames, summary 1 frame, lobby 4 frames.
        # NOTE: summary's min is 1.5s = 2 frames at sample_fps=1; a 1-frame summary
        # must be merged away. The result here is that the decoder will likely
        # never pick summary alone because of the strong self-loop on lobby AND
        # the illegal transition lobby→summary (lobby_state_2 can only go to
        # state_1, loadout, loading, or unknown). Use loadout instead which is
        # reachable from lobby_state_2.
        anchors = [lobby, lobby, lobby, lobby, loadout, lobby, lobby, lobby, lobby]
        feats = [_stub_feats(n, anchor_idx=a) for a in anchors]
        clf = _FixedClassifier(anchors, n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        # The single-frame loadout (0.5s min duration = 1 frame at 1 fps; KEPT)
        # — assert all kept segments meet their min duration.
        for seg in segments:
            min_sec = self.sm.min_duration_seconds(seg.screen_type)
            self.assertGreaterEqual(seg.end_seconds - seg.start_seconds, min_sec - 1e-6)

    def test_legal_transitions_respected(self):
        # Try to force lobby → action_tracker which is ILLEGAL.
        # The decoder should refuse to take that path and emit different states.
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        at = self.sm.state_index("post_game_action_tracker")
        feats = [_stub_feats(n, anchor_idx=lobby) for _ in range(3)] + \
                [_stub_feats(n, anchor_idx=at) for _ in range(3)]
        clf = _FixedClassifier([lobby, lobby, lobby, at, at, at], n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        # The legal pathway is lobby → (loadout|loading|lobby_1) → ... → AT.
        # The decoder cannot jump directly; if AT wins later, there must be an
        # intermediate non-lobby state recorded.
        types = [s.screen_type for s in segments]
        if "post_game_action_tracker" in types:
            self.assertNotEqual(types[0], "post_game_action_tracker")

    def test_output_segments_carry_seconds_at_sample_fps(self):
        n = len(self.sm.states)
        lobby = self.sm.state_index("pre_game_lobby_state_2")
        feats = [_stub_feats(n, anchor_idx=lobby) for _ in range(5)]
        clf = _FixedClassifier([lobby] * 5, n)
        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=self.sm,
            weights=self.weights,
        )
        # sample_fps=1.0 → 1 frame = 1 second.
        self.assertEqual(segments[0].start_seconds, 0.0)
        # end_seconds is exclusive in the legacy contract.
        self.assertEqual(segments[0].end_seconds, 5.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_pass1_segment.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'video_ingest.pass1_segment'"

- [ ] **Step 3: Implement decode_segments + min-duration filter**

Create `tools/video_ingest/video_ingest/pass1_segment.py`:

```python
"""HMM/Viterbi Pass-1 decoder — Phase 1 of the OCR pipeline redesign.

Replaces pass1_classify.build_segments() with a sequence model. Pass 1's
output contract (a list of Segment objects compatible with Pass 2 dispatch)
is unchanged so the orchestrator + dispatch wiring stay put. The internal
algorithm is:

  1. For each Pass-1 sampled frame, compute multi-signal features
     (frame_features.compute_frame_features).
  2. Feed those features to the learned screen classifier
     (screen_classifier.predict_log_probs) for per-state log-probs.
  3. Combine classifier output + anchor flags into a (T, N) log emission
     matrix (emissions.build_log_emissions).
  4. Build the (N, N) log transition matrix from the StateMachine.
  5. Decode the best state sequence (viterbi.viterbi_decode).
  6. Collapse runs of identical states into segments and drop runs shorter
     than the per-state minimum duration.

Frames belonging to non-extracted states (unknown_or_transition, in_game_*,
loading_or_intro, end_of_video) still produce Segment objects with the new
screen_type; pass2_extract filters them via the extract_screens config.
"""

from __future__ import annotations

from typing import Iterable, Protocol

import numpy as np

from game_ocr.emissions import EmissionWeights, build_log_emissions
from game_ocr.frame_features import FrameFeatures
from game_ocr.state_machine import StateMachine
from game_ocr.viterbi import viterbi_decode
from video_ingest.pass1_classify import Segment


class _ClassifierProto(Protocol):
    def predict_log_probs(self, features: FrameFeatures) -> np.ndarray: ...


def _build_log_transitions(state_machine: StateMachine) -> np.ndarray:
    n = len(state_machine.states)
    log_trans = np.full((n, n), 0.0, dtype=np.float64)
    for i, src in enumerate(state_machine.states):
        for j, dst in enumerate(state_machine.states):
            log_trans[i, j] = state_machine.log_transition(src, dst)
    return log_trans


def _build_log_initial(state_machine: StateMachine) -> np.ndarray:
    n = len(state_machine.states)
    out = np.full(n, 0.0, dtype=np.float64)
    for i, s in enumerate(state_machine.states):
        out[i] = state_machine.initial_log_prob(s)
    return out


def _collapse_to_segments(
    path: np.ndarray,
    state_machine: StateMachine,
    emissions: np.ndarray,
) -> list[Segment]:
    if len(path) == 0:
        return []
    period = 1.0 / state_machine.sample_fps
    segments: list[Segment] = []
    run_start = 0
    for t in range(1, len(path) + 1):
        if t == len(path) or path[t] != path[run_start]:
            state_idx = int(path[run_start])
            state_name = state_machine.states[state_idx]
            end = t - 1
            # Mean per-frame posterior over the assigned state (proxy: emission
            # value normalised against the row max). For the legacy Segment
            # contract we just store the mean emission magnitude on the assigned
            # state, scaled into [0, 1] via a sigmoid-style squash.
            block = emissions[run_start:end + 1, state_idx]
            mean_score = float(1.0 / (1.0 + np.exp(-block.mean())))
            segments.append(Segment(
                start_index=run_start,
                end_index=end,
                start_seconds=run_start * period,
                end_seconds=(end + 1) * period,
                screen_type=state_name,
                frame_count=end - run_start + 1,
                mean_color_score=mean_score,
            ))
            run_start = t
    return segments


def _enforce_min_duration(
    segments: list[Segment],
    state_machine: StateMachine,
) -> list[Segment]:
    out: list[Segment] = []
    for seg in segments:
        min_sec = state_machine.min_duration_seconds(seg.screen_type)
        duration = seg.end_seconds - seg.start_seconds
        if duration + 1e-6 < min_sec:
            continue
        out.append(seg)
    return out


def decode_segments(
    *,
    features: Iterable[FrameFeatures],
    classifier: _ClassifierProto,
    state_machine: StateMachine,
    weights: EmissionWeights,
) -> list[Segment]:
    feats_list = list(features)
    if not feats_list:
        return []
    log_emit = build_log_emissions(feats_list, classifier, state_machine, weights)
    log_trans = _build_log_transitions(state_machine)
    log_init = _build_log_initial(state_machine)
    path = viterbi_decode(log_emit, log_trans, log_init)
    segments = _collapse_to_segments(path, state_machine, log_emit)
    return _enforce_min_duration(segments, state_machine)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_pass1_segment.py -v`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add tools/video_ingest/video_ingest/pass1_segment.py tools/video_ingest/tests/test_pass1_segment.py
git commit -m "feat(ocr): Phase 1 HMM/Viterbi decode_segments() + integration tests"
```

---

### Task 9 — Wire `pass1_segment` into the orchestrator behind a `pass1.engine` flag

**Files:**

- Modify: `tools/video_ingest/video_ingest/configs/nhl26.yaml`
- Modify: `tools/video_ingest/video_ingest/orchestrator.py`
- Modify: `tools/video_ingest/video_ingest/pass1_classify.py` (extend `Pass1Config` only)
- Test: extend `tools/video_ingest/tests/test_cache_invalidation.py` for engine drift

- [ ] **Step 1: Extend Pass1Config with the engine selector**

Edit `tools/video_ingest/video_ingest/pass1_classify.py` lines 72-83 (replace the `Pass1Config` dataclass):

```python
@dataclass
class Pass1Config:
    sample_fps: float = 1.0
    min_run_to_open: int = 3
    max_outliers_within: int = 1
    min_segment_seconds: float = 3.0
    # Per-screen overrides for short, briefly-viewed post-game screens. When a
    # screen type appears here, its threshold replaces the global default for
    # that screen only. Mirrors the per-screen Pass-2 sample_rates pattern.
    min_segment_seconds_by_screen: dict[str, float] = field(default_factory=dict)
    min_run_to_open_by_screen: dict[str, int] = field(default_factory=dict)
    # Phase 1: which Pass-1 engine to use. "run_length" = legacy classifier +
    # build_segments() path; "viterbi" = pass1_segment.decode_segments() HMM
    # path. Default stays run_length until weights ship; switch per-version in
    # configs/<version>.yaml.
    engine: str = "run_length"
```

- [ ] **Step 2: Update nhl26 orchestrator config to use the new engine**

Edit `tools/video_ingest/video_ingest/configs/nhl26.yaml`. Add to the `pass1:` block:

```yaml
pass1:
  # ... existing fields ...
  engine: viterbi
```

- [ ] **Step 3: Update the orchestrator to dispatch on engine**

In `tools/video_ingest/video_ingest/orchestrator.py`, find the block that constructs `Pass1Config` (around lines 157-171) and add `engine=str(p1_raw.get("engine", "run_length"))` to the constructor:

```python
    p1cfg = Pass1Config(
        sample_fps=float(p1_raw["sample_fps"]),
        min_run_to_open=int(p1_raw["min_run_to_open"]),
        max_outliers_within=int(p1_raw["max_outliers_within"]),
        min_segment_seconds=float(p1_raw["min_segment_seconds"]),
        min_segment_seconds_by_screen={
            str(k): float(v)
            for k, v in (p1_raw.get("min_segment_seconds_by_screen") or {}).items()
        },
        min_run_to_open_by_screen={
            str(k): int(v) for k, v in (p1_raw.get("min_run_to_open_by_screen") or {}).items()
        },
        engine=str(p1_raw.get("engine", "run_length")),
    )
```

Then add a helper function above `ingest()` and use it where Pass 1 is run (the `if not cache_hit_pass1:` block ~line 222):

```python
def _run_pass1(
    video_path: Path,
    classifier_legacy,
    p1cfg: Pass1Config,
    version: str,
) -> tuple[list, list[Segment]]:
    """Engine dispatch: returns (frame_classifications, segments)."""
    if p1cfg.engine == "viterbi":
        from game_ocr.emissions import EmissionWeights
        from game_ocr.frame_features import compute_frame_features
        from game_ocr.screen_classifier import load_screen_classifier
        from game_ocr.state_machine import load_state_machine
        from video_ingest.pass1_segment import decode_segments
        sm = load_state_machine(version)
        if sm.sample_fps != p1cfg.sample_fps:
            raise RuntimeError(
                f"state machine sample_fps={sm.sample_fps} != Pass-1 config sample_fps={p1cfg.sample_fps}"
            )
        weights_path = (
            Path(__file__).resolve().parents[2] / "game_ocr" / "game_ocr" / "weights"
            / f"{version}-screen-classifier.json"
        )
        if not weights_path.exists():
            raise FileNotFoundError(
                f"missing learned screen classifier weights for {version}: {weights_path}\n"
                f"  Fix: run `python3 tools/game_ocr/scripts/train_screen_classifier.py --version {version}`"
            )
        clf = load_screen_classifier(weights_path, sm)
        cls_list: list = []
        feats_list = []
        # Reuse legacy classifier ONLY for the anchor-text crop — it already
        # owns the ROI scaling + OCR backend warmup.
        from video_ingest.pass1_classify import _iter_raw_bgr_frames, FrameClassification
        from game_ocr.utils import normalize_text
        # We need anchor text and HSV per frame. The legacy classifier already
        # computes both; reuse its helper methods.
        for idx, frame in enumerate(_iter_raw_bgr_frames(video_path, p1cfg.sample_fps)):
            anchor_text = classifier_legacy._read_anchor(frame)
            feats = compute_frame_features(frame, anchor_text=anchor_text, state_machine=sm)
            feats_list.append(feats)
            # For audit / annotate.py compatibility, emit a FrameClassification
            # carrying the raw signals. screen_type stays UNKNOWN_SCREEN until
            # the Viterbi pass assigns it below.
            cls_list.append(FrameClassification(
                index=idx,
                seconds=idx / p1cfg.sample_fps,
                screen_type="unknown_or_transition",
                color_score=0.0,
                color_class="",
                anchor_text=anchor_text,
            ))
        segments = decode_segments(
            features=feats_list,
            classifier=clf,
            state_machine=sm,
            weights=EmissionWeights(),
        )
        # Stamp the decoded state back onto the per-frame audit table.
        for seg in segments:
            for i in range(seg.start_index, seg.end_index + 1):
                cls_list[i] = FrameClassification(
                    index=cls_list[i].index,
                    seconds=cls_list[i].seconds,
                    screen_type=seg.screen_type,
                    color_score=cls_list[i].color_score,
                    color_class=cls_list[i].color_class,
                    anchor_text=cls_list[i].anchor_text,
                )
        return cls_list, segments
    else:
        cls_list = classify_video(video_path, classifier_legacy, p1cfg)
        segments = build_segments(cls_list, p1cfg)
        return cls_list, segments
```

Replace the existing Pass-1 invocation site (the lines that today are):

```python
        classifier = _build_classifier(version, use_gpu=use_gpu)
        t0 = time.perf_counter()
        cls_list = classify_video(video_path, classifier, p1cfg)
        segments = build_segments(cls_list, p1cfg)
        elapsed_pass1 = time.perf_counter() - t0
```

with:

```python
        classifier = _build_classifier(version, use_gpu=use_gpu)
        t0 = time.perf_counter()
        cls_list, segments = _run_pass1(video_path, classifier, p1cfg, version)
        elapsed_pass1 = time.perf_counter() - t0
```

- [ ] **Step 4: Update cache key to include the engine + weights hash**

In `tools/video_ingest/video_ingest/pass1_classify.py`, edit `compute_pass1_cache_key()`:

```python
def compute_pass1_cache_key(version: str) -> str:
    """Hash of the orchestrator-side version YAML + the game_ocr classifier
    YAML + the Phase-1 state machine YAML + the Phase-1 weights artifact
    (when present). Captures everything that demonstrably changes Pass 1
    output."""
    version_yaml = VIDEO_INGEST_CONFIGS_DIR / f"{version}.yaml"
    classifier_yaml = _CLASSIFIER_CONFIGS_DIR / f"{version}.yaml"
    parts: list[bytes] = [version_yaml.read_bytes(), b"\x00", classifier_yaml.read_bytes()]
    # Phase 1: include state machine + weights so engine swaps invalidate.
    from game_ocr.state_machine import CONFIGS_DIR as _SM_DIR
    sm_yaml = _SM_DIR / f"{version}.yaml"
    if sm_yaml.exists():
        parts.append(b"\x00")
        parts.append(sm_yaml.read_bytes())
    weights_json = _CLASSIFIER_CONFIGS_DIR.parent.parent / "weights" / f"{version}-screen-classifier.json"
    if weights_json.exists():
        parts.append(b"\x00")
        parts.append(weights_json.read_bytes())
    return _sha256_of(b"".join(parts))
```

- [ ] **Step 5: Extend the existing cache-invalidation test for engine drift**

In `tools/video_ingest/tests/test_cache_invalidation.py`, add a test (don't replace existing ones):

```python
def test_state_machine_drift_invalidates_pass1(tmp_path, monkeypatch):
    """Phase 1: editing state machine YAML cascades to a Pass-1 cache mismatch."""
    from video_ingest.pass1_classify import compute_pass1_cache_key
    base = compute_pass1_cache_key("nhl26")
    # Touch the state machine YAML in a copy and confirm the cache key changes.
    from game_ocr.state_machine import CONFIGS_DIR as SM_DIR
    sm_path = SM_DIR / "nhl26.yaml"
    original = sm_path.read_bytes()
    try:
        sm_path.write_bytes(original + b"\n# touched\n")
        after = compute_pass1_cache_key("nhl26")
        assert after != base
    finally:
        sm_path.write_bytes(original)
```

- [ ] **Step 6: Run all video_ingest tests**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/ -v`
Expected: PASS — all previous tests + the new engine-drift test pass.

- [ ] **Step 7: Commit**

```bash
git add tools/video_ingest/video_ingest/orchestrator.py \
        tools/video_ingest/video_ingest/pass1_classify.py \
        tools/video_ingest/video_ingest/configs/nhl26.yaml \
        tools/video_ingest/tests/test_cache_invalidation.py
git commit -m "feat(ocr): Phase 1 wire Viterbi engine into orchestrator behind pass1.engine flag"
```

---

### Task 10 — Thread `decoder_version` from orchestrator → dispatch → ingest-ocr-cli

**Files:**

- Modify: `tools/video_ingest/video_ingest/dispatch.py`
- Modify: `apps/worker/src/ingest-ocr-cli.ts`
- Modify: `apps/worker/src/ingest-ocr.ts`
- Test: extend `tools/video_ingest/tests/test_dispatch_segment_flags.py`

Phase 0 already wires `--video-segment-index`, `--video-segment-start-sec`, `--video-segment-end-sec`, `--ui-version` through dispatch. Phase 1 adds `--decoder-version` so `ocr_segments` rows from the HMM path are distinguishable from legacy passthrough rows.

- [ ] **Step 1: Write the failing test (Python side)**

In `tools/video_ingest/tests/test_dispatch_segment_flags.py`, add (don't replace existing tests):

```python
def test_dispatch_passes_decoder_version_flag(monkeypatch, tmp_path):
    """Phase 1: dispatch threads decoder_version to ingest-ocr-cli."""
    from video_ingest.dispatch import dispatch_segments
    from video_ingest.pass2_extract import Pass2Result
    from video_ingest.pass1_classify import Segment

    captured: list[list[str]] = []

    class _FakeProc:
        returncode = 0
        stdout = ""
        stderr = ""

    def _fake_run(cmd, **kwargs):
        captured.append(list(cmd))
        return _FakeProc()

    monkeypatch.setattr("video_ingest.dispatch.subprocess.run", _fake_run)
    monkeypatch.setattr("video_ingest.dispatch.shutil.which", lambda _: "/usr/bin/pnpm")

    seg = Segment(
        start_index=0, end_index=4,
        start_seconds=10.0, end_seconds=15.0,
        screen_type="player_loadout_view",
        frame_count=5, mean_color_score=0.9,
    )
    pr = Pass2Result(
        segment_index=7, segment=seg,
        directory=tmp_path, frame_count=5,
        start_seconds=10.0, end_seconds=15.0,
    )

    dispatch_segments(
        [pr], game_title_id=1, match_id=250,
        video_sha256="a" * 64, ui_version="nhl26",
        decoder_version="hmm-viterbi-v1",
        repo_root=tmp_path,
    )
    assert any("--decoder-version" in c and "hmm-viterbi-v1" in c for c in captured)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_dispatch_segment_flags.py -v -k decoder_version`
Expected: FAIL — `decoder_version` is an unexpected keyword argument.

- [ ] **Step 3: Add the `decoder_version` parameter to dispatch_segments**

Edit `tools/video_ingest/video_ingest/dispatch.py`:

```python
def dispatch_segments(
    results: Iterable[Pass2Result],
    *,
    game_title_id: int,
    match_id: int | None,
    video_sha256: str,
    ui_version: str = "nhl26",
    decoder_version: str = "legacy-passthrough-v0-video",
    repo_root: Path | None = None,
    dry_run: bool = False,
) -> list[DispatchResult]:
    # ... existing body ...
```

Inside the loop that builds `cmd`, add the flag right after `--ui-version`:

```python
        cmd = [
            # ... existing prefix ...
            "--ui-version", ui_version,
            "--decoder-version", decoder_version,
            "--notes",
            # ... rest ...
        ]
```

- [ ] **Step 4: Update the orchestrator caller**

Edit `tools/video_ingest/video_ingest/orchestrator.py`. In the dispatch block (~line 333), pass the decoder_version:

```python
        # Read decoder_version from state machine YAML when engine=viterbi;
        # otherwise tag as legacy passthrough.
        if p1cfg.engine == "viterbi":
            from game_ocr.state_machine import load_state_machine
            decoder_version = load_state_machine(version).decoder_version
        else:
            decoder_version = "legacy-passthrough-v0-video"
        dispatch_results = dispatch_segments(
            pass2_results,
            game_title_id=game_title_id,
            match_id=match_id,
            video_sha256=probe.sha256,
            ui_version=version,
            decoder_version=decoder_version,
            dry_run=dispatch_dry_run,
        )
```

- [ ] **Step 5: Add the CLI flag on the TypeScript side**

Edit `apps/worker/src/ingest-ocr-cli.ts`. Add to the `CliArgs` interface and the parser (mirror the existing `uiVersion` handling):

```typescript
interface CliArgs {
  // ... existing fields ...
  uiVersion: string | null
  /** Pass-1 decoder version tag; lands in ocr_segments.decoder_version. */
  decoderVersion: string | null
}
```

Inside `parseArgs()` after the `uiVersion` parse:

```typescript
const decoderVersion = getFlag('decoder-version') ?? null
```

Add `decoderVersion` to the returned object and pass it through the call to `ingestOcrBatch` in the same file (mirroring `uiVersion`).

- [ ] **Step 6: Plumb it through `ingestOcrBatch` and `writeSegmentForBatch`**

Edit `apps/worker/src/ingest-ocr.ts`:

1. Add `decoderVersion: string | null` to the `IngestOcrInput` interface (or whatever the input type is named — search for `videoSegmentIndex` to find the existing spot, around lines 130-180).
2. Pass it into `writeSegmentForBatch({ ..., decoderVersion: input.decoderVersion ?? null })`.
3. In `writeSegmentForBatch`, replace the existing decoderVersion derivation logic:

```typescript
    decoderVersion: input.decoderVersion
      ?? (hasVideoMeta ? 'legacy-passthrough-v0-video' : 'legacy-passthrough-v0-manual'),
```

- [ ] **Step 7: Add the `decoderVersion` field to the `writeSegmentForBatch` input type**

In the input type for `writeSegmentForBatch` (around lines 227-237):

```typescript
async function writeSegmentForBatch(input: {
  // ... existing fields ...
  uiVersion: string | null
  decoderVersion: string | null
}): Promise<void> {
```

- [ ] **Step 8: Run all relevant tests**

```bash
cd /home/michal/projects/eanhl-team-website
pnpm --filter @eanhl/db build
pnpm --filter worker build
PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/test_dispatch_segment_flags.py -v
```

Expected: PASS — all dispatch tests including the new decoder_version test.

- [ ] **Step 9: Commit**

```bash
git add tools/video_ingest/video_ingest/dispatch.py \
        tools/video_ingest/video_ingest/orchestrator.py \
        tools/video_ingest/tests/test_dispatch_segment_flags.py \
        apps/worker/src/ingest-ocr-cli.ts apps/worker/src/ingest-ocr.ts
git commit -m "feat(ocr): Phase 1 thread decoder_version through dispatch + ingest-ocr"
```

---

### Task 11 — `ocr_segments` decoder_version distinction test (TS)

**Files:**

- Create: `apps/worker/src/__tests__/ocr-segments-hmm-vs-legacy.test.ts`

Locks in that legacy-emitted and HMM-emitted segments are distinguishable in the database.

- [ ] **Step 1: Write the test**

Create `apps/worker/src/__tests__/ocr-segments-hmm-vs-legacy.test.ts`:

```typescript
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { db, ocrSegments } from '@eanhl/db'
import { eq, sql, inArray } from 'drizzle-orm'

const TEST_MATCH_ID = 250

test('ocr_segments decoder_version distinguishes HMM from legacy passthrough', async () => {
  // Phase 0 deepening already inserted legacy-passthrough rows for match 250.
  // Phase 1 re-ingests overwrite the same (match_id, segment_key) and stamp the
  // HMM tag. Both should be queryable independently by decoder_version.
  const rows = await db
    .select({
      decoderVersion: ocrSegments.decoderVersion,
      count: sql<number>`count(*)::int`,
    })
    .from(ocrSegments)
    .where(eq(ocrSegments.matchId, TEST_MATCH_ID))
    .groupBy(ocrSegments.decoderVersion)

  // At minimum the rows must have a non-null decoder_version after Phase 1
  // and the value must be one of the known tags.
  const versions = new Set(rows.map((r) => r.decoderVersion))
  for (const v of versions) {
    assert.ok(
      v.startsWith('hmm-viterbi-') || v.startsWith('legacy-passthrough-'),
      `unexpected decoder_version: ${v}`,
    )
  }
  assert.ok(versions.size >= 1, 'expected at least one ocr_segments row for match 250')
})

test('ocr_segments distinct HMM-tagged rows exist after Phase 1 re-ingest', async () => {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ocrSegments)
    .where(sql`${ocrSegments.decoderVersion} = 'hmm-viterbi-v1'`)
  // After Phase 1 re-ingest of match 250, HMM rows must exist.
  assert.ok(rows[0].count > 0, 'no hmm-viterbi-v1 rows; did Phase 1 re-ingest run?')
})
```

- [ ] **Step 2: Build + run the test (skip the second assertion until re-ingest runs in Task 14)**

The second test will fail until match 250 is re-ingested through the HMM path. That's intentional — it gates Task 14 acceptance. For now mark it `test.skip` until Task 14:

```typescript
test.skip('ocr_segments distinct HMM-tagged rows exist after Phase 1 re-ingest', async () => {
```

Run: `pnpm --filter @eanhl/db build && pnpm --filter worker test -- ocr-segments-hmm-vs-legacy`
Expected: PASS — first test passes (versions are well-formed).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/__tests__/ocr-segments-hmm-vs-legacy.test.ts
git commit -m "test(ocr): Phase 1 ocr_segments HMM vs legacy decoder_version test"
```

---

### Task 12 — Box-score tab fixtures

**Files:**

- Add fixtures: `tools/game_ocr/calibration/extras/post_game_box_score_shots__match250_t<T>_vs_4thline.png`, `post_game_box_score_faceoffs__match250_t<T>_vs_4thline.png`
- Run: `train_screen_classifier.py`

The Phase 1 T3 gate requires the decoder to be able to surface `post_game_box_score_shots` and `post_game_box_score_faceoffs` segments when an operator-navigated video contains those tabs. Match 250's video may not include them; if so, we extract from any candidate match where those tabs were viewed. If none currently exist, leave a TODO in `tools/game_ocr/calibration/extras/PENDING_BOX_SCORE_TABS.md` listing exactly which match recordings would resolve it.

- [ ] **Step 1: Check whether match 250 video has those tabs**

Walk the segment manifest:

```bash
cat /tmp/vi-canonical/*/segments.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('Segment screen_types:', sorted({s['screen_type'] for s in data['segments']}))
"
```

If `post_game_box_score_shots` / `post_game_box_score_faceoffs` do not appear, fall through to Step 2.

- [ ] **Step 2a: Extract candidate frames from any available match recording**

Look for matches where the operator navigated the shots/faceoffs tabs. Inspect `/mnt/k/NHL/NHL26/*.mkv` candidates and use `tools/game_ocr/scripts/label_state_machine_corpus.py` (from Task 6) to label them. If no recording has them, do Step 2b instead.

- [ ] **Step 2b: Document the gap and exit T3 gate as conditional**

Create `tools/game_ocr/calibration/extras/PENDING_BOX_SCORE_TABS.md`:

```markdown
# Pending — box-score shots/faceoffs tab fixtures

Phase 1 T3 acceptance gate ("at least one `post_game_box_score_shots` segment
and one `post_game_box_score_faceoffs` segment in `ocr_segments` for matches
where the operator navigated those tabs") requires fixture coverage of those
two screens.

As of Phase 1 commit, neither match 250 nor match 463 contain those tabs
in the recorded gameplay. The gate stays conditional: when the next operator
captures a recording that tabs through Shot Summary / Faceoff Summary, run:

python3 tools/game_ocr/scripts/label_state_machine_corpus.py \
 --segments /tmp/vi-canonical/<sha>/segments.json \
 --video /mnt/k/NHL/NHL26/<file>.mkv \
 --match-id <N> --opp <slug>

python3 tools/game_ocr/scripts/train_screen_classifier.py --version nhl26

Then commit the resulting weights JSON. The state machine YAML already
encodes both states; the gate becomes verifiable as soon as the corpus has
at least one labeled frame per state.
```

- [ ] **Step 3: Re-train weights with any new fixtures**

```bash
PYTHONPATH=tools/game_ocr python3 tools/game_ocr/scripts/train_screen_classifier.py --version nhl26
```

- [ ] **Step 4: Commit**

```bash
git add tools/game_ocr/calibration/extras/ tools/game_ocr/game_ocr/weights/nhl26-screen-classifier.json
git commit -m "feat(ocr): Phase 1 box-score tab fixtures (or pending marker)"
```

---

### Task 13 — Match 463 loadout segment count regression test

**Files:**

- Create: `apps/worker/src/__tests__/match-463-loadout-segments.test.ts`

Phase 1 T2 gate per the redesign plan: match 463 loadout segment count goes from 2 → ≥7 of 10 slots captured.

- [ ] **Step 1: Write the test**

Create `apps/worker/src/__tests__/match-463-loadout-segments.test.ts`:

```typescript
/**
 * Phase 1 acceptance gate T2: match 463's player_loadout_view segments.
 *
 * Before Phase 1 the legacy run-length segmenter captured only 2 of ~10
 * loadout slots from the unattended match 463 capture, because brief
 * sub-second slot traversals fell below `min_run_to_open=2 frames @ 1 fps`.
 *
 * The HMM/Viterbi decoder with `player_loadout_view.min_duration=0.5s`
 * (Round 4 §4) recovers those segments. This test locks the post-Phase-1
 * floor so a regression that re-loses them is caught immediately.
 *
 * Skips when match 463 isn't in the DB (e.g. on a fresh checkout); CI runs
 * with a populated DB.
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { db, ocrSegments } from '@eanhl/db'
import { and, eq, sql } from 'drizzle-orm'

const MATCH_ID = 463
const TARGET_FLOOR = 7

test('match 463 has ≥7 player_loadout_view segments under HMM decoder', async () => {
  const matchRows = await db.execute(sql`SELECT 1 FROM matches WHERE id = ${MATCH_ID} LIMIT 1`)
  if ((matchRows as { rows: unknown[] }).rows.length === 0) {
    console.log('[skip] match 463 not in DB')
    return
  }
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ocrSegments)
    .where(
      and(
        eq(ocrSegments.matchId, MATCH_ID),
        eq(ocrSegments.state, 'player_loadout_view' as const),
        eq(ocrSegments.decoderVersion, 'hmm-viterbi-v1'),
      ),
    )
  assert.ok(
    rows[0].count >= TARGET_FLOOR,
    `expected ≥${TARGET_FLOOR} loadout segments under HMM decoder for match 463, got ${rows[0].count}`,
  )
})
```

- [ ] **Step 2: Mark test.skip until Task 14 re-ingests**

Use `test.skip(...)` until the re-ingest in Task 14 produces the rows. Convert to `test(...)` in Task 14 once the data exists.

- [ ] **Step 3: Build + run**

```bash
pnpm --filter @eanhl/db build && pnpm --filter worker test -- match-463-loadout-segments
```

Expected: skipped test, no failure.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/__tests__/match-463-loadout-segments.test.ts
git commit -m "test(ocr): Phase 1 match-463 loadout segment floor regression test (skipped pending re-ingest)"
```

---

### Task 14 — Re-ingest match 250 + match 463 through the HMM path

**Files:** none new — runs the pipeline against the live database

- [ ] **Step 1: Load env + build worker**

```bash
cd /home/michal/projects/eanhl-team-website
set -a && source .env && set +a
pnpm --filter @eanhl/db build
pnpm --filter worker build
```

- [ ] **Step 2: Re-ingest match 250**

Match 250's canonical video lives at `/mnt/k/NHL/NHL26/2026-05-08_18-25-42.mkv` (per the reference-memory). Force Pass 1 to re-run under the new engine:

```bash
PYTHONPATH=tools/video_ingest:tools/game_ocr python3 -m video_ingest.cli ingest \
  --video /mnt/k/2026-05-08_18-25-42.mkv \
  --output-root /tmp/vi-canonical \
  --version nhl26 \
  --dispatch --game-title-id 1 --match-id 250 \
  --force-pass1 --force-pass2
```

Expected stderr output:

```
[pass1] N frames classified, M segments emitted in T.Ts
  seg ...
[pass2] ...
[dispatch] K ok, 0 failed
```

- [ ] **Step 3: Verify HMM-tagged rows in `ocr_segments`**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "
  SELECT decoder_version, state, count(*)
  FROM ocr_segments
  WHERE match_id = 250
  GROUP BY decoder_version, state
  ORDER BY decoder_version, state;
"
```

Expected: rows tagged `hmm-viterbi-v1` covering at least the same screen types Phase 0 captured (`legacy-passthrough-v0-video` rows may still be present from earlier re-ingests; both are acceptable).

- [ ] **Step 4: Re-ingest match 463**

If match 463's video source is accessible (check `matches.video_path` or recording inventory):

```bash
PYTHONPATH=tools/video_ingest:tools/game_ocr python3 -m video_ingest.cli ingest \
  --video <match-463-path>.mkv \
  --output-root /tmp/vi-canonical \
  --version nhl26 \
  --dispatch --game-title-id 1 --match-id 463 \
  --force-pass1 --force-pass2
```

If match 463's source video is no longer accessible, document the gap in HANDOFF and rely on whatever 250 numbers prove. The T2 gate then becomes "verifiable on next match 463 ingest".

- [ ] **Step 5: Unskip the gate tests**

In `apps/worker/src/__tests__/match-463-loadout-segments.test.ts` change `test.skip(...)` back to `test(...)`. Same for `apps/worker/src/__tests__/ocr-segments-hmm-vs-legacy.test.ts` second test block.

```bash
pnpm --filter worker test -- ocr-segments-hmm-vs-legacy
pnpm --filter worker test -- match-463-loadout-segments
```

Expected: PASS — both tests now find HMM-tagged rows. If T2 floor is missed because match 463 source is missing, leave the test skipped and document why in HANDOFF.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/__tests__/match-463-loadout-segments.test.ts \
        apps/worker/src/__tests__/ocr-segments-hmm-vs-legacy.test.ts
git commit -m "test(ocr): Phase 1 enable HMM-tagged ocr_segments + match-463 loadout floor"
```

---

### Task 15 — Match 250 V2 benchmark still green (T1 gate)

**Files:**

- Extend: `apps/worker/src/__tests__/match-250-benchmark.test.ts`

Round 4 §10 + plan T1 gate: every Phase that touches a 250-covered field must keep T1 green. Phase 1 should not break the existing 397 assertions, AND should let previously-skipped assertions become enforceable (e.g. anything gated on the HMM decoder running).

- [ ] **Step 1: Run the benchmark before HMM data has landed**

```bash
pnpm --filter worker build
node --test apps/worker/dist/__tests__/match-250-benchmark.test.js
```

Expected: PASS — current 397 assertions still green from Phase 0 baseline.

- [ ] **Step 2: Add Phase-1-specific invariants**

In `apps/worker/src/__tests__/match-250-benchmark.test.ts`, append a new `test.describe` block (find the existing `describe`s and add at the bottom):

```typescript
test.describe('Phase 1 HMM Pass-1 invariants', () => {
  test('match 250 has at least one HMM-decoded segment', async () => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ocrSegments)
      .where(and(eq(ocrSegments.matchId, 250), eq(ocrSegments.decoderVersion, 'hmm-viterbi-v1')))
    assert.ok(rows[0].count >= 1, 'expected at least one hmm-viterbi-v1 segment for match 250')
  })

  test('match 250 segment time bounds are non-NULL under HMM', async () => {
    const rows = await db
      .select({ tStart: ocrSegments.tStartSec, tEnd: ocrSegments.tEndSec })
      .from(ocrSegments)
      .where(and(eq(ocrSegments.matchId, 250), eq(ocrSegments.decoderVersion, 'hmm-viterbi-v1')))
      .limit(5)
    for (const r of rows) {
      assert.ok(r.tStart !== null, 't_start_sec must be populated by HMM decoder')
      assert.ok(r.tEnd !== null, 't_end_sec must be populated by HMM decoder')
    }
  })
})
```

Make sure the imports at the top of the file include `ocrSegments`, `db`, `eq`, `and`, `sql` (mirror the pattern of the existing test blocks).

- [ ] **Step 3: Build + run**

```bash
pnpm --filter worker build
node --test apps/worker/dist/__tests__/match-250-benchmark.test.js
```

Expected: PASS — 397 + 2 = 399 assertions across 17 test groups.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/__tests__/match-250-benchmark.test.ts
git commit -m "test(ocr): Phase 1 add HMM-decoder invariants to match-250 V2 benchmark"
```

---

### Task 16 — Update `ocr-segments-report` CLI to surface decoder_version

**Files:**

- Modify: `apps/worker/src/ocr-segments-report-cli.ts` (or wherever the existing CLI lives)

Phase 0 shipped this CLI. Phase 1 makes the report distinguish HMM vs legacy rows so the operator can verify the migration end-to-end.

- [ ] **Step 1: Locate the CLI source**

```bash
grep -rn "ocr-segments-report" apps/worker/ --include="*.ts" | head
```

- [ ] **Step 2: Extend the verbose output to include decoder_version**

In the file printed by the grep above, find the per-segment row printer and add the decoder_version column. The non-verbose output should also include a per-decoder-version summary line at the top:

```typescript
const byDecoder = await db
  .select({
    decoderVersion: ocrSegments.decoderVersion,
    count: sql<number>`count(*)::int`,
  })
  .from(ocrSegments)
  .where(eq(ocrSegments.matchId, matchId))
  .groupBy(ocrSegments.decoderVersion)

console.log(`\nMatch ${matchId} — segments by decoder_version:`)
for (const r of byDecoder) {
  console.log(`  ${r.decoderVersion.padEnd(34)} ${r.count} segment(s)`)
}
```

- [ ] **Step 3: Smoke-test**

```bash
pnpm --filter worker build
pnpm --filter worker ocr-segments-report -- --match 250
pnpm --filter worker ocr-segments-report -- --match 250 --verbose
```

Expected stdout includes a `segments by decoder_version` block before the per-segment dump.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/ocr-segments-report-cli.ts
git commit -m "feat(worker): Phase 1 ocr-segments-report shows decoder_version distribution"
```

---

### Task 17 — Legacy fallback documentation + deprecation marker

**Files:**

- Modify: `tools/video_ingest/video_ingest/pass1_classify.py` (module docstring)
- Modify: `tools/game_ocr/game_ocr/classifier.py` (module docstring)

The plan keeps both as fallback during Phase 1; Phase 5 deletes them. Mark them clearly so future contributors don't extend them.

- [ ] **Step 1: Prepend deprecation note to `pass1_classify.py`**

Edit the top docstring of `tools/video_ingest/video_ingest/pass1_classify.py`:

```python
"""Pass 1 (LEGACY — run-length engine): segment a video into screen-type windows.

NOTE: As of Phase 1 of the OCR pipeline redesign (2026-05-19), this module is
the legacy fallback path. The default engine is pass1_segment.decode_segments()
(HMM/Viterbi). This module survives only while `pass1.engine=run_length` is a
supported option. Phase 5 deletes this file.

When extending Pass 1 going forward, change the HMM path in
`tools/video_ingest/video_ingest/pass1_segment.py`, not here.

Decodes the input video at a coarse 1 fps via ffmpeg ...
"""
```

- [ ] **Step 2: Prepend deprecation note to `classifier.py`**

Edit the top docstring of `tools/game_ocr/game_ocr/classifier.py`:

```python
"""Hybrid screen-type classifier (LEGACY — single-prototype HSV + anchor).

NOTE: As of Phase 1 of the OCR pipeline redesign (2026-05-19), this classifier
is demoted to a fallback signal and its primary role (frame-level screen
discrimination) is replaced by game_ocr.screen_classifier.ScreenClassifier
(learned LR head) fed into game_ocr.viterbi via game_ocr.emissions.

This module survives because the legacy `pass1.engine=run_length` path still
imports it, and because `classify_video` is the anchor-text source for the
HMM engine's frame_features call. Phase 5 deletes the legacy engine path; the
anchor-text helpers in this module may be refactored out at that time.

Two signals per frame ...
"""
```

- [ ] **Step 3: Commit**

```bash
git add tools/video_ingest/video_ingest/pass1_classify.py tools/game_ocr/game_ocr/classifier.py
git commit -m "docs(ocr): Phase 1 mark legacy Pass-1 modules as fallback-only"
```

---

### Task 18 — End-to-end smoke test against the 60s clip fixture

**Files:**

- Extend: `tools/video_ingest/tests/test_pass1_segment.py`

The repo has a labeled 60s clip at `tools/video_ingest/tests/fixtures/match-250-clip.mkv` with ground-truth segments in `match-250-clip-segments.json`. Phase 1's decoder must produce something close to the labels.

- [ ] **Step 1: Write the failing integration test**

Append to `tools/video_ingest/tests/test_pass1_segment.py`:

```python
import json
import shutil
import subprocess
import unittest
from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
CLIP = FIXTURE_DIR / "match-250-clip.mkv"
LABELS = FIXTURE_DIR / "match-250-clip-segments.json"


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not on PATH")
@unittest.skipUnless(CLIP.exists(), "test clip not present")
class TestEndToEndOnLabeledClip(unittest.TestCase):
    """The 60-second labeled clip should decode into segments that match
    the ground-truth labels at most-frames-wise."""

    def test_majority_of_frames_match_labels(self):
        from game_ocr.classifier import Classifier, load_classifier_config
        from game_ocr.emissions import EmissionWeights
        from game_ocr.frame_features import compute_frame_features
        from game_ocr.screen_classifier import load_screen_classifier
        from game_ocr.state_machine import load_state_machine
        from video_ingest.pass1_classify import _iter_raw_bgr_frames
        from video_ingest.pass1_segment import decode_segments

        sm = load_state_machine("nhl26")
        legacy = Classifier(load_classifier_config("nhl26"), use_gpu=False)
        weights = (
            Path(__file__).resolve().parents[2] / "game_ocr" / "game_ocr"
            / "weights" / "nhl26-screen-classifier.json"
        )
        if not weights.exists():
            self.skipTest("Phase 1 weights not yet trained")
        clf = load_screen_classifier(weights, sm)

        feats = []
        for frame in _iter_raw_bgr_frames(CLIP, 1.0):
            anchor = legacy._read_anchor(frame)
            feats.append(compute_frame_features(frame, anchor_text=anchor, state_machine=sm))

        segments = decode_segments(
            features=feats,
            classifier=clf,
            state_machine=sm,
            weights=EmissionWeights(),
        )

        # Build per-frame decoded labels.
        decoded = ["unknown_or_transition"] * len(feats)
        for seg in segments:
            for i in range(seg.start_index, seg.end_index + 1):
                decoded[i] = seg.screen_type

        # Compare against ground truth. Labels file uses `unknown_screen`;
        # decoder uses `unknown_or_transition`. Both map to "not extracted".
        gt_raw = json.loads(LABELS.read_text())
        gt = ["unknown_or_transition"] * gt_raw["frame_count"]
        for entry in gt_raw["segments"]:
            label = entry["screen_type"]
            if label == "unknown_screen":
                label = "unknown_or_transition"
            for i in range(entry["start_frame"], entry["end_frame"] + 1):
                if i < len(gt):
                    gt[i] = label

        matches = sum(1 for a, b in zip(decoded, gt) if a == b)
        # 60 frames; require ≥45/60 = 75% per-frame match.
        self.assertGreaterEqual(matches, 45, f"per-frame match {matches}/60 below 45")
```

- [ ] **Step 2: Run**

```bash
cd tools/video_ingest && PYTHONPATH=../game_ocr:. python -m pytest tests/test_pass1_segment.py::TestEndToEndOnLabeledClip -v
```

Expected: PASS at ≥45/60 frame match. If below, regenerate weights with more extras (`label_state_machine_corpus.py` against the clip first) and re-run.

- [ ] **Step 3: Commit**

```bash
git add tools/video_ingest/tests/test_pass1_segment.py
git commit -m "test(ocr): Phase 1 end-to-end Viterbi against the 60s labeled clip fixture"
```

---

### Task 19 — HANDOFF + Phase-1 checkpoint commit

**Files:**

- Modify: `HANDOFF.md`

Per the project Commit Protocol + the redesign plan's "checkpoint every phase" rule.

- [ ] **Step 1: Update HANDOFF.md**

Insert a new section at the top of `HANDOFF.md`, above the existing "Current Status" block. Use the existing format (headlines, key file list, acceptance gates):

```markdown
## Session Summary — 2026-05-XX (Phase 1 — HMM/Viterbi Pass-1 shipped)

### What was done

Replaced the legacy single-prototype HSV-cosine + run-length Pass-1 with a
versioned multi-signal HMM/Viterbi state decoder. The 17-state machine,
learned LR head (sklearn LogisticRegression over HSV + anchor-flags + quality
features), Viterbi decoder (pure log-space function), and emission combiner
ship as five new Python modules under `tools/game_ocr/game_ocr/`. The
orchestrator now selects the engine via `pass1.engine: viterbi` in
`tools/video_ingest/video_ingest/configs/nhl26.yaml`; the legacy `run_length`
engine survives as fallback until Phase 5 deletes it. Dispatch threads a new
`--decoder-version` flag through ingest-ocr-cli into
`ocr_segments.decoder_version`; HMM rows carry `hmm-viterbi-v1`, legacy rows
keep `legacy-passthrough-v0-*`. The match-quality report CLI surfaces the
distribution. Match 250 + match 463 re-ingested through the new path.

### Acceptance gates

- T1 (match-250 V2 benchmark): 399 assertions across 17 test groups (added 2
  HMM invariants); previously-green 397 stay green.
- T2 (match 463 loadout segments ≥7 of 10): <state of gate — fill in once
  re-ingest completes>.
- T3 (box-score tabs distinguished): state machine + anchors support both
  tabs; pending real-video fixture (see
  `tools/game_ocr/calibration/extras/PENDING_BOX_SCORE_TABS.md`) when one
  exists, gate is hot.
- T4 (HMM segments visible in match-quality CLI): green —
  `pnpm --filter worker ocr-segments-report --match 250` shows the by-decoder
  distribution block.
- Phase-6 CI gate (`apps/worker/src/__tests__/match-quality-regression.test.ts`)
  stays green.

### Key files added / modified

| New                                                            | What                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `tools/game_ocr/game_ocr/configs/state_machine/nhl26.yaml`     | 17-state machine + transition matrix + min-duration priors      |
| `tools/game_ocr/game_ocr/state_machine.py`                     | YAML loader + log-prob accessors                                |
| `tools/game_ocr/game_ocr/frame_features.py`                    | Per-frame HSV + anchor flags + blur + brightness extractor      |
| `tools/game_ocr/game_ocr/screen_classifier.py`                 | sklearn LR head + JSON weights I/O                              |
| `tools/game_ocr/game_ocr/emissions.py`                         | Combines features + classifier output into (T, N) log emissions |
| `tools/game_ocr/game_ocr/viterbi.py`                           | Pure-function log-space decoder                                 |
| `tools/game_ocr/game_ocr/weights/nhl26-screen-classifier.json` | Trained LR weights (committed)                                  |
| `tools/game_ocr/scripts/train_screen_classifier.py`            | Idempotent training driver                                      |
| `tools/game_ocr/scripts/label_state_machine_corpus.py`         | Operator-driven corpus expansion across 17 states               |
| `tools/video_ingest/video_ingest/pass1_segment.py`             | HMM/Viterbi top-level Pass-1 decoder                            |

| Modified                                                       | Why                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `tools/video_ingest/video_ingest/orchestrator.py`              | `pass1.engine` dispatch + decoder_version plumbing               |
| `tools/video_ingest/video_ingest/dispatch.py`                  | `--decoder-version` CLI flag                                     |
| `tools/video_ingest/video_ingest/pass1_classify.py`            | `Pass1Config.engine`, cache-key includes state-machine + weights |
| `tools/video_ingest/video_ingest/configs/nhl26.yaml`           | `pass1.engine: viterbi`                                          |
| `apps/worker/src/ingest-ocr-cli.ts`                            | `--decoder-version` flag                                         |
| `apps/worker/src/ingest-ocr.ts`                                | Pass-through to `writeSegmentForBatch.decoderVersion`            |
| `apps/worker/src/__tests__/match-250-benchmark.test.ts`        | +2 HMM invariants                                                |
| `apps/worker/src/__tests__/match-463-loadout-segments.test.ts` | NEW                                                              |
| `apps/worker/src/__tests__/ocr-segments-hmm-vs-legacy.test.ts` | NEW                                                              |

### Next

Phase 2 — Loadout-view evidence-layer MVR. Build the typed extractor stack

- promotion gate for `player_loadout_view`. The HMM decoder from Phase 1 is
  already capturing the brief loadout segments that Phase 2 will extract from.
  Plan reference: `.claude/plans/plan-redesign-ocr-pipeline-2026-05-19.md`
  Phase 2.
```

- [ ] **Step 2: Run all gates one final time**

```bash
pnpm --filter @eanhl/db build
pnpm --filter worker build
node --test apps/worker/dist/__tests__/match-250-benchmark.test.js
node --test apps/worker/dist/__tests__/match-463-loadout-segments.test.js
node --test apps/worker/dist/__tests__/ocr-segments-hmm-vs-legacy.test.js
node --test apps/worker/dist/__tests__/ocr-evidence-schema.test.js
node --test apps/worker/dist/__tests__/match-quality-regression.test.js
PYTHONPATH=tools/game_ocr python3 -m pytest tools/video_ingest/tests/ -v
```

Expected: all green.

- [ ] **Step 3: Phase-1 checkpoint commit**

```bash
git add HANDOFF.md
git commit -m "$(cat <<'EOF'
feat(ocr): Phase 1 HMM/Viterbi Pass-1 — sequence decoder + learned head + ocr_segments distinction

Replaces single-prototype HSV cosine + run-length segmenter with a 17-state HMM/Viterbi
decoder fed by a sklearn LR head over HSV + anchor flags + blur/brightness features.
ocr_segments rows carry decoder_version=hmm-viterbi-v1; legacy passthrough rows stay
distinguishable. Match-250 V2 benchmark stays green with +2 HMM invariants; match-463
loadout segment floor enforced.

Plan: .claude/plans/plan-redesign-ocr-pipeline-2026-05-19.md Phase 1.
Architecture: docs/calibration/redesign-round-4-codex-synthesis-2026-05-19.md §4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (writing-plans checklist)

**Spec coverage** — every Phase 1 deliverable from the redesign plan + Round 4 §4 maps to a task:

- State machine + transition matrix in versioned YAML → Task 1
- Min-duration priors per state → Task 1 (embedded in YAML), Task 8 (enforcement)
- Multi-signal emission model → Tasks 4, 5, 7
- Lightweight learned screen logits → Tasks 5, 6
- Anchor-text presence scores → Task 4 (`anchor_flags`)
- Anchor-template match scores → folded into anchor-text fuzzy matching; full template matching deferred to Phase 2 frame selection per Round 4 §2 (where it belongs as part of stable-segment registration, not Pass-1 routing)
- Blur/compression quality scores → Task 4 (`blur_score`)
- Optional low-dim image embeddings → not in Phase 1 MVR (Round 4 §4 says "optional"); revisit in Phase 5 if HMM accuracy is the bottleneck
- Viterbi decoder → Task 3
- HSV cosine demoted to one weak emission feature → Task 4 (kept as `hsv_histogram` feature vector entry), Task 5 (LR head consumes it as one of 192+N+3 features, not as primary signal)
- Output contract matches existing `segments.json` shape → Task 8
- Rows in `ocr_segments` → Tasks 10, 11
- Trained classifier weights versioned alongside YAML → Tasks 5, 6
- Calibration corpus from `tools/game_ocr/calibration/extras/` + annotated frames → Task 6
- Match 250 extended benchmark still green → Task 15
- Match 463 loadout segment count goes from 2 → ≥7 → Task 13, 14
- Box-score tabs distinguished → Task 12 (state machine + anchors), Task 1 (YAML), Task 14 (acceptance gate via re-ingest)
- HMM-decoded segments visible in match-quality CLI → Task 16
- HANDOFF + checkpoint commit → Task 19

**Placeholder scan** — every code step has the actual code to write. The only `<placeholder>` text is the `<match-463-path>.mkv` in Task 14 step 4 where the actual video path depends on what's accessible at execution time; this is explicit and the engineer is told to look it up. All other paths, function names, command lines, and assertions are concrete.

**Type consistency** — `FrameFeatures`, `StateMachine`, `ScreenClassifier`, `EmissionWeights`, `Segment`, and `decode_segments()` keep the same signatures across Tasks 2–8. `decoder_version` flows from YAML → `StateMachine.decoder_version` → `orchestrator` → `dispatch_segments(decoder_version=...)` → `ingest-ocr-cli --decoder-version` → `writeSegmentForBatch.decoderVersion` → `ocr_segments.decoder_version`. The TS-side `ocr_segments.decoderVersion` field already exists in Phase 0's schema (`packages/db/src/schema/ocr-evidence.ts:107`); no schema change needed.

**Dependencies between tasks** — each task ships in isolation behind tests; Task 9 cannot ship until Tasks 1–8 land because it imports them, but each prior task is independently committable. Tasks 10–11 depend on Task 9. Tasks 12–14 depend on Task 9. Tasks 15–18 depend on the data Task 14 produces. Task 19 is the final checkpoint.

**What's deliberately NOT in Phase 1** — extracting in-game HUD content (Phase 4), evidence-layer extractors for any screen (Phase 2), promotion gate (Phase 2), template-relative ROI registration (Phase 2), shot-dot geometry (deferred per Round 4 §5), Snorkel/Silver label model (Phase 5). The plan stays strict to the redesign plan's Phase 1 scope.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-pipeline-redesign-phase-1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
