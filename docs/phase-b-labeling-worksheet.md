# Phase B retrain — crop-labeling worksheet

Operator-gated corpus growth for the `build_class` + `x_factor_name` closed-vocab LR heads.
Goal: every build class ≥3 crops (≥2 hard floor; 1 crop = degenerate). Enforcer accepted thin (2, near-dup).
Recording clock = **Edmonton / Mountain = MDT (UTC-6)** in summer — confirmed.
All commands run from `tools/game_ocr/`.

## Status: PHASE B COMPLETE — sourcing · frame extraction · crop labeling · Gate 2 retrain · benchmark (2577) · gate (per-match floors) · manifest promote ALL DONE (2026-07-01)

Match_ids confirmed (opponents verified in the dev view). Clips filed into per-match folders:
`/mnt/k/NHL/NHL26/match<id>/<original-filename>` (matches the 250/463/967/968 convention).
The June-12 and June-21 sessions were each split into two clips (`- Trim` / `- Trim2`).

**Frame extraction is already done for all 12 clips** (2026-07-01). Candidate PNGs live in
`calibration/extras/_inbox_player_loadout_view/<video_stem>/` (120 frames per clip: 3s interval over the
first 360s pre-game window). The inbox dir name deliberately contains `player_loadout_view` — see the
⚠️ filter-gap note under Step 1. Spot-checked: the Enforcer clip's first content crop reads a clean
`ENFORCER` title bar, so the loadout-card carousel is captured and the crop region is aligned.
**You can skip Step 1 and go straight to Step 2 (crop labeling).**

### stem → match_id → --source-match (use the matching id per clip)

| inbox stem (`calibration/extras/_inbox_player_loadout_view/<stem>/`) | --source-match | target build        |
| -------------------------------------------------------------------- | -------------- | ------------------- |
| `2026-06-12_19-44-56_-_Trim`                                         | 2667           | Off-D ×2            |
| `2026-06-12_19-44-56_-_Trim2`                                        | 2666           | 2nd game (top-up)   |
| `2026-05-30_17-07-42_-_Trim`                                         | 2400           | Grinder             |
| `2026-06-20_16-04-36_-_Trim`                                         | 2683           | Grinder             |
| `2026-06-21_15-58-18_-_Trim`                                         | 2687           | Enforcer            |
| `2026-06-21_15-58-18_-_Trim2`                                        | 2688           | Enforcer (near-dup) |
| `2026-06-16_18-50-44`                                                | 2670           | TWD + Off-D         |
| `2026-06-16_19-57-14`                                                | 2673           | Def-D (Chara)       |
| `2026-06-17_17-28-27`                                                | 2674           | TWD (Dahlin)        |
| `2026-05-31_15-37-45`                                                | 2577           | 4×TWD + 2×Grinder   |
| `2026-05-31_16-09-36`                                                | 2582           | TWD                 |
| `2026-05-31_16-55-13`                                                | 2640           | TWD                 |

| clip (under `match<id>/`)       | --source-match | opponent (score)                    | target build               |
| ------------------------------- | -------------- | ----------------------------------- | -------------------------- |
| 2026-06-12_19-44-56 - Trim.mp4  | 2667           | Rink Roosters L2-4                  | Off-D ×2                   |
| 2026-06-12_19-44-56 - Trim2.mp4 | 2666           | Apparently 67ers L1-3               | 2nd game (optional top-up) |
| 2026-05-30_17-07-42 - Trim.mp4  | 2400           | Spryfield Shoremen W3-0             | Grinder                    |
| 2026-06-20_16-04-36 - Trim.mp4  | 2683           | Trashcans HC W3-2                   | Grinder                    |
| 2026-06-21_15-58-18 - Trim.mp4  | 2687           | Junior C Allstars W3-0 H (game 1/2) | Enforcer                   |
| 2026-06-21_15-58-18 - Trim2.mp4 | 2688           | Junior C Allstars W4-3 A (game 2/2) | Enforcer (near-dup)        |
| 2026-06-16_18-50-44.mkv         | 2670           | Golden Goals W5-1                   | TWD + Off-D                |
| 2026-06-16_19-57-14.mkv         | 2673           | Apparently 67ers W6-3               | Def-D (Chara)              |
| 2026-06-17_17-28-27.mkv         | 2674           | Mommys touch L0-1                   | TWD (Dahlin)               |
| 2026-05-31_15-37-45.mkv         | 2577           | Go Go Henny Guys W6-3               | 4×TWD + 2×Grinder          |
| 2026-05-31_16-09-36.mkv         | 2582           | Roc River Rats W3-2                 | TWD                        |
| 2026-05-31_16-55-13.mkv         | 2640           | CATEGORY 4 L2-5                     | TWD                        |

Coverage once labeled: Two-Way-D ~8 · Grinder ~4 · Off-D ~3 · Def-D 2 (m250+Chara) · Enforcer 2 (near-dup pair).
Parked in dev view, not in the batch: 2697 (Evil Eastons W9-5, 2026-06-25).
Leftover full un-split session files still in NHL26 root (redundant with the Trims, operator decision pending delete):
`2026-06-12_19-44-56.mkv` (2.2 GB), `2026-06-21_15-58-18.mkv` (2.2 GB).

## Step 1 — extract candidate frames (ALREADY DONE — re-run only if re-extracting)

```
python3 scripts/bulk_extract_label_candidates.py \
  --video /mnt/k/NHL/NHL26/match<id>/<clip> \
  --inbox calibration/extras/_inbox_player_loadout_view \
  --interval 3 --end-time 360
```

Writes PNGs to `<inbox>/<video_stem>/cand-t<sec>.png`. Loadout/lobby cards are in the **pre-game** portion
(early in each clip) — `--end-time 360` focuses on the first 6 min; `--interval 3` catches each card as the
carousel auto-advances. (Note: `--max-seconds` does not exist — the flags are `--start-time` / `--end-time`.)

⚠️ **Filter gap — this is why `--inbox` must end in `player_loadout_view`.** `label_loadout_crops.py`
(Step 2) only accepts source PNGs whose path contains `player_loadout_view` **or** whose parent dir is named
`frames`. The extractor's default `_inbox/<stem>/` satisfies neither, so labeling it prints
`warn: no player_loadout_view PNGs found` and labels nothing. Extracting into an inbox dir whose name contains
`player_loadout_view` makes every PNG's path pass the filter — no code change. (Verified 2026-07-01, both
directions.) The extractor's own docstring points at `label_state_machine_corpus.py --from-inbox` instead —
that is the _screen-type_ corpus labeler, a different tool; ignore it for loadout crop labeling.

⚠️ Use the real **no-space** clip paths (`match2687/…`); the script docstring's `match 968` example is the
outdated space convention (same naming split flagged in the Phase G landmine).

## Step 2 — crop + label (INTERACTIVE — operator only)

Per clip, substitute `<stem>` + `<id>` from the mapping table above:

```
IN=calibration/extras/_inbox_player_loadout_view/<stem>
python3 scripts/label_loadout_crops.py --family build_class   --source "$IN" --source-match <id>
python3 scripts/label_loadout_crops.py --family x_factor_name --source "$IN" --source-match <id>
```

**How the labeling loop works:** it opens each crop by overwriting a single live-preview file at
`/mnt/c/Users/micha/labelcrop-current.png` (a Windows path). Open that file **once** in Windows Photos before
you start — it auto-refreshes as you label. For each crop it prints `label (1-N, s=skip, q=quit)`; type the
menu number for the class you see, `s` to skip, `q` to stop. Blank/transitional frames auto-skip (no prompt).
Each clip has ~5–10 non-blank build-class crops; many are the same player across adjacent frames, so label a
couple of distinct ones per class and `q` out — you only need **≥3 crops per build class** (≥2 hard floor).

`--source-match <id>` writes the `m<id>_` provenance prefix (keeps the held-out guard + future
`--strict-provenance` clean). Prioritize the 4 previously-missing build classes (Enforcer/Grinder/Off-D/TWD);
also grab X-Factors. Crops land under `calibration/extras/loadout/crops/<family>/<class>/`.

## Labeling results — build_class DONE (2026-07-01)

**36 build_class crops written; corpus 11 → 47, all 10 classes now ≥3 (balanced 3–6).**
Method: candidate frames read directly off the title-bar crops (they show the literal class text,
e.g. `ENFORCER`, or `NAME - ABBREV` like `RASMUS DAHLIN - TWD`) rather than the interactive Photos loop.
Balanced selection (not all ~92 readable crops) pulled from 11 different matches to avoid overfitting one
match's rendering; graphic/jersey false-positives and out-of-vocab reads were skipped.

Per-class total after: Enforcer 3 · Grinder 4 · Offensive D 4 · Two-Way D 4 · Two-Way F 4 · Defensive D 4 ·
Power Forward 6 · Puck Moving D 6 · Playmaker 6 · Sniper 6. **All four previously-missing classes filled.**

⚠️ **Vocab gap found (flag for Gate 2, NOT fixed here):** two build classes appear in-game that are **absent
from `build_classes.yaml`** — **`Dangler`** (forward, seen in m2670) and **`Enforcer Defenseman`** (seen in
m2673). Both read as clean centered title bars, not transition artifacts. The extractor can never classify
these until the vocab is expanded + the head retrained. Their crops are still on disk in the scratch dump
(un-applied) if you decide to add the vocab entries at Gate 2. Decision deferred by operator 2026-07-01.

## Labeling results — x_factor_name DONE (2026-07-01)

**40 x_factor_name crops written; corpus 33 → 73, 11 → 20 classes (18 of 20 now ≥3).**
Method: for each of the 36 settled `build_class` frames the same frame's 3 X-Factor slot bands
(`FAMILY_REGIONS` y=[305,365]; slots x=[300,700]/[800,1200]/[1300,1700]) were extracted as native
60×400 crops → 108 candidates, upscaled 3× with burned-in `IDX N mXXXX cand-tXXXXX sN` headers and
montaged 9/tile. Claude read the montages directly (text crisp at 3×; all 108 legible) and a balanced
subset of native crops was copied into `crops/x_factor_name/<class>/` keeping the `m<id>_` provenance
prefix. Selection favored match diversity (crops pulled from 12 different matches) and capped common
classes at 5–6 to avoid overfitting one match's rendering. Held-out guard clean: 0 crops from
463/967/968; all 40 additions from the 12 fresh training clips; existing 33-crop seed is all m250.

Per-class total after (added this session in parens):
Wheels 6 (+2) · One_T 6 (+0) · Elite_Edges 5 (+3) · Quick_Release 5 (+1) · Tape_to_Tape 5 (+2) ·
Warrior 5 (+1) · Big_Rig 4 (+0) · Rocket 4 (+2) · Ankle_Breaker 3 (+1) · Backhand_Beauty 3 (+3) ·
Big_Tipper 3 (+3) · No_Contest 3 (+3) · Quickpick 3 (+2) · Second_Wind 3 (+3) · Send_It 3 (+3) ·
Stick_Em_Up 3 (+3) · Truculence 3 (+3) · Unstoppable 3 (+3) · PressurePlus 2 (+1) · Born_Leader 1 (+1).

⚠️ **Thin classes / vocab gaps (flag for Gate 2, NOT fixed here):** all 108 reads mapped cleanly to the
28-name `x_factors.yaml` vocab — **no out-of-vocab reads**. But coverage is uneven:

- **Born_Leader — 1 crop total** (below the ≥2 hard floor). Only one instance (m2400 t00051 s2) appeared
  across all 12 clips; cannot reach the floor without new footage.
- **PressurePlus — 2 crops total** (at hard floor, below the ≥3 target). Only one new instance
  (m2666 t00018 s2) available; the other is the m250 seed.
- **8 vocab classes have ZERO crops anywhere** (never appeared in these 12 clips):
  Dialed_In, Hipster, Post_to_Post, Quick_Draw, Recharge, Show_Stopper, Spark_Plug, Sponge.
  These stay unclassifiable until footage containing them is captured + labeled.

Both Gate 1 heads (`build_class`, `x_factor_name`) are now grown. Next is Gate 2 retrain (Step 3, separate session).

## Step 3 — retrain (Gate 2) — COMPLETE 2026-07-01 (retrain + strict-provenance + benchmark + gate + promote)

1. ✅ **DONE** — `train_loadout_closed_vocab.py --all --evaluate --strict-provenance --cv-report calibration/extras/loadout/benchmark/reports`.
   `build_class` trains 10 classes (was 6); `x_factor_name` trains 18 (was 9; `Born_Leader`/`PressurePlus` auto-excluded < min_class_size=3). CV baselines written: build mean **0.297**, x-factor **0.143** — LOW (HSV features ignore glyphs; the LR head is a rank-1 fallback behind the text path). Weights overwritten, uncommitted.
2. ✅ **DONE (match 2577, 2026-07-01)** — first fresh-NHL26 validation match labeled (`benchmark/labels/2577.json` + manifest entry committed `57afcd2`) + benchmarked via a hand-built ffmpeg frame bundle over the real game's settled loadout window (t88–107; the clip has a **cancelled first game** before it). `--from-extractor` + `score_match`: **10/10 subjects**, `build_class_canonical` **0.90**, `x_factor_name` **0.867** / `tier` **0.90**, `attribute_value` **0.748**. **Confirmed the text path generalizes to fresh footage → the image LR head still should NOT be wired in.** Two findings surfaced (both OUT of Phase B scope): away-side persona not read (home 5/5, away 0/5); `against_RW` card blank / subject-split phantom (the sole build miss + captain fn). **Golden now committed** at t76–116 @3fps (`fixtures/fixture_match2577_loadout/`, 905 records; a superset window that reproduced the numbers exactly and lifted `position` to 1.00) + `reports/2577-baseline.json`. Frames off-repo at `/mnt/k/NHL/NHL26/match2577-bench-frames/`.
3. ✅ **DONE (as a per-match gate, not an m250 ratchet)** — `tests/test_field_benchmark.py` is now parametrized over `MATCHES = {250, 2577}` with per-match floors; 2577 gates at its measured values (build 0.90 / x_factor_name 0.86 / tier 0.90 / attribute_value 0.74 / position 1.00 / gamertag 0.90 / persona 0.50). The **m250 0.80 floors are intentionally unchanged** — the retrain only touched the (unwired) image heads, so the static m250 golden and its floors don't move. "Ratcheting" m250 requires a real extractor improvement + golden regen, which Phase B did not produce.
4. ✅ **DONE** — `--strict-provenance` flag + refuse-unprefixed test. Ran as a clean no-op on the retrain (all 120 crops `m<id>_`-prefixed, 0 refused). +2 tests.
5. ✅ **DONE** — `2577` promoted into `benchmark/manifest.json` `splits.validation` (now `[250, 2577]`), with a new `matches.2577` entry (golden + report paths, coverage note) and `planned.new_validation.status: promoted`, `next: none`.

**Vocab-gap decisions (settled by operator 2026-07-01):** `Dangler` / `Enforcer Defenseman` → deferred, left out of `build_classes.yaml`. Thin (`Born_Leader`/`PressurePlus`) + 8 zero-coverage x-factor names → kept in vocab (text path), out of the LR head until footage lands.
