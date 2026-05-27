"""S5.5 offline simulator — replay the v2 Viterbi decode against cached
diagnostic data, tweaking knobs without re-running OCR.

Reads the JSON dumped by `diagnose_v2_proving_bench.py` (per-frame classifier
log_probs + fired regex priors), reconstructs the v2 emissions + Viterbi
decode using the real state machine YAML, and prints per-clip accuracy +
per-frame predict-vs-expected.

Knobs (override via --kv NAME=VALUE NAME=VALUE …):
  anchor_bonus            (default 2.0)
  classifier_weight       (default 1.0)
  reject_floor            (default -20.0)
  transition_penalty_default     (overrides log_transition_prior globally)
  transition_penalty_from_unknown (overrides UNKNOWN→X only, if set)
  unknown_initial_log_prob       (overrides initial[unknown_or_transition])
  enforce_min_duration   1|0 (default 1)

Examples:
  python3 sim_v2_viterbi.py --in match-250.json --kv anchor_bonus=3.0
  python3 sim_v2_viterbi.py --in match-250.json \
      --kv transition_penalty_from_unknown=-1.5 anchor_bonus=2.5
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml


_REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_state_machine_yaml(version: str) -> dict:
    p = _REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine" / f"{version}.yaml"
    return yaml.safe_load(p.read_text())


def _load_regex_priors_yaml(version: str) -> dict:
    p = _REPO_ROOT / "tools" / "game_ocr" / "game_ocr" / "configs" / "state_machine" / f"{version}_regex_priors.yaml"
    return yaml.safe_load(p.read_text())


def _flatten_regex_priors(priors_yaml: dict) -> list[tuple[str, str]]:
    """Return [(prior_name, owning_state), …] in the same order as priors_flat."""
    skip_keys = {"version", "roi_definitions"}
    out: list[tuple[str, str]] = []
    for state, items in priors_yaml.items():
        if state in skip_keys:
            continue
        for item in items:
            out.append((item["name"], state))
    return out


def _build_log_transitions(states: list[str], sm: dict, penalty_default: float,
                           penalty_from_unknown: float | None) -> np.ndarray:
    n = len(states)
    self_loop = float(sm.get("log_self_loop_prior", -0.05))
    state_idx = {s: i for i, s in enumerate(states)}
    legal = sm.get("legal_transitions", {})
    log_trans = np.full((n, n), -np.inf, dtype=np.float64)
    for i, src in enumerate(states):
        log_trans[i, i] = self_loop  # self-loop
        for dst in legal.get(src, []):
            j = state_idx[dst]
            if src == "unknown_or_transition" and penalty_from_unknown is not None:
                log_trans[i, j] = penalty_from_unknown
            else:
                log_trans[i, j] = penalty_default
    return log_trans


def _build_log_initial(states: list[str], sm: dict, unknown_init_override: float | None) -> np.ndarray:
    init = sm.get("initial_log_probs", {})
    out = np.full(len(states), -np.inf, dtype=np.float64)
    for i, s in enumerate(states):
        if s in init:
            v = float(init[s])
            if s == "unknown_or_transition" and unknown_init_override is not None:
                v = unknown_init_override
            out[i] = v
    return out


def _viterbi(log_emit: np.ndarray, log_trans: np.ndarray, log_init: np.ndarray) -> np.ndarray:
    T, N = log_emit.shape
    delta = np.full((T, N), -np.inf, dtype=np.float64)
    backptr = np.zeros((T, N), dtype=np.int64)
    delta[0] = log_init + log_emit[0]
    for t in range(1, T):
        scores = delta[t - 1][:, None] + log_trans
        backptr[t] = np.argmax(scores, axis=0)
        delta[t] = scores[backptr[t], np.arange(N)] + log_emit[t]
    path = np.zeros(T, dtype=np.int64)
    path[-1] = int(np.argmax(delta[-1]))
    for t in range(T - 1, 0, -1):
        path[t - 1] = backptr[t, path[t]]
    return path


def _collapse_and_enforce_min(path: np.ndarray, states: list[str], sample_fps: float,
                              min_durations: dict, enforce_min: bool) -> list[str]:
    """Return per-frame decoded state names (after min-duration drop)."""
    if len(path) == 0:
        return []
    per_frame = ["unknown_or_transition"] * len(path)
    period = 1.0 / sample_fps
    run_start = 0
    runs = []
    for t in range(1, len(path) + 1):
        if t == len(path) or path[t] != path[run_start]:
            runs.append((run_start, t - 1, int(path[run_start])))
            run_start = t
    for s, e, idx in runs:
        state_name = states[idx]
        duration = (e + 1) * period - s * period
        min_sec = float(min_durations.get(state_name, 0.0))
        if enforce_min and duration + 1e-6 < min_sec:
            continue  # dropped runs default to "unknown_or_transition"
        for i in range(s, e + 1):
            per_frame[i] = state_name
    return per_frame


def simulate(data: dict, knobs: dict) -> dict:
    states = list(data["states"])
    n = len(states)
    state_idx = {s: i for i, s in enumerate(states)}

    sm = _load_state_machine_yaml(data["version"])
    priors_yaml = _load_regex_priors_yaml(data["version"])
    priors_flat = _flatten_regex_priors(priors_yaml)
    name_to_pos = {name: i for i, (name, _) in enumerate(priors_flat)}

    anchor_bonus = float(knobs.get("anchor_bonus", 2.0))
    classifier_weight = float(knobs.get("classifier_weight", 1.0))
    reject_floor = float(knobs.get("reject_floor", -20.0))
    penalty_default = float(knobs.get("transition_penalty_default", sm.get("log_transition_prior", -3.0)))
    penalty_from_unknown = knobs.get("transition_penalty_from_unknown", None)
    if penalty_from_unknown is not None:
        penalty_from_unknown = float(penalty_from_unknown)
    unknown_init_override = knobs.get("unknown_initial_log_prob", None)
    if unknown_init_override is not None:
        unknown_init_override = float(unknown_init_override)
    enforce_min = bool(int(knobs.get("enforce_min_duration", 1)))

    log_trans = _build_log_transitions(states, sm, penalty_default, penalty_from_unknown)
    log_init = _build_log_initial(states, sm, unknown_init_override)

    T = data["n_frames"]
    log_emit = np.full((T, n), 0.0, dtype=np.float64)

    unk_idx = state_idx["unknown_or_transition"]
    # Group prior positions by owning state.
    state_to_positions: dict[str, list[int]] = {}
    for i, (_name, owner) in enumerate(priors_flat):
        state_to_positions.setdefault(owner, []).append(i)
    reject_positions = state_to_positions.get("unknown_or_transition", [])

    for t, row in enumerate(data["frames"]):
        # Reconstruct regex_prior_flags from the fired list.
        fired_positions = set()
        for p in row["fired_priors"]:
            if p["prior_name"] in name_to_pos:
                fired_positions.add(name_to_pos[p["prior_name"]])
        # Reject path.
        if reject_positions and any(i in fired_positions for i in reject_positions):
            log_emit[t, :] = reject_floor
            log_emit[t, unk_idx] = reject_floor + 1.0
            continue
        cl = row["classifier_log_probs"]
        lp = np.array([cl[s] for s in states], dtype=np.float64)
        anchor = np.zeros(n, dtype=np.float64)
        for owner, positions in state_to_positions.items():
            if owner == "unknown_or_transition" or owner not in state_idx:
                continue
            anchor[state_idx[owner]] = float(sum(1 for i in positions if i in fired_positions))
        log_emit[t, :] = classifier_weight * lp + anchor_bonus * anchor

    path = _viterbi(log_emit, log_trans, log_init)
    sample_fps = float(sm.get("sample_fps", 1.0))
    per_frame = _collapse_and_enforce_min(
        path, states, sample_fps, sm.get("min_duration_seconds", {}), enforce_min,
    )
    return {"per_frame": per_frame, "log_emit": log_emit}


DEFERRED_RELAX = {"menu_club_management", "player_loadout_landing"}
HARD_ZERO_EXPECTED = {"menu_club_management", "player_loadout_landing",
                      "player_loadout_view", "menu_world_of_chel"}
CONTAMINATION = "pre_game_lobby_state_2"


def _score(per_frame: list[str], data: dict) -> dict:
    # Pull expected from saved diagnostic rows.
    expected_per_frame = [r["expected"] for r in data["frames"]]
    matches = 0
    total = 0
    wrong = []
    contamination = []
    for t, (got, exp) in enumerate(zip(per_frame, expected_per_frame)):
        if exp is None:
            continue
        total += 1
        if got == exp or (exp in DEFERRED_RELAX and got == "unknown_or_transition"):
            matches += 1
        else:
            wrong.append((t, exp, got))
        if exp in HARD_ZERO_EXPECTED and got == CONTAMINATION:
            contamination.append((t, exp))
    return {
        "matches": matches, "total": total,
        "accuracy": matches / total if total else 0.0,
        "wrong": wrong,
        "contamination": contamination,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True, help="Diagnostic JSON.")
    ap.add_argument("--kv", nargs="*", default=[], help="knob=value pairs.")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    knobs = {}
    for kv in args.kv:
        k, _, v = kv.partition("=")
        knobs[k.strip()] = v.strip()

    data = json.loads(Path(args.in_path).read_text())
    result = simulate(data, knobs)
    score = _score(result["per_frame"], data)
    print(f"clip={data['clip']}  knobs={knobs}")
    print(f"  accuracy={score['accuracy']:.1%}  matches={score['matches']}/{score['total']}")
    print(f"  contamination={len(score['contamination'])} frames into pre_game_lobby_state_2")
    if not args.quiet and score["wrong"]:
        print("  wrong:")
        for t, exp, got in score["wrong"]:
            print(f"    t={t:2}  exp={exp:<25}  got={got:<25}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
