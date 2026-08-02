# WS6 post-game screen-classification — root-cause diagnosis

Branch: `feat/post-game-classifier-fix`. Companion to
`docs/ocr/ws6-real-match-validation-findings.md`.

> **✅ RESOLVED (Tier B landed).** Fix shipped on this branch: 8 `post_game_*` regex priors restored
> (`n_priors` 18→26) + v2 head retrained with 63 header-grounded match-2582 post-game frames
> (`fix(ocr)` `3fba4da`), plus a post-game proving-bench arm with a hard contamination rule
> (`test(ocr)` `3f29f1d`). **Verification:** per-frame diagnostic now classifies every data-bearing
> post-game screen; 3-arm proving bench green (pre-game **no regression** + post-game arm passes
> accuracy + hard rule); and a full-recording `classify-only` rerun on match 2582 turns the post-game
> window from **0 → 12 post-game segments** (15 dispatching, was 4). The diagnosis below is retained as
> the root-cause record.

Evidence reproduced from the preserved WS6 bundle
(`tools/video_ingest/tests/fixtures/ws6-match2582-postgame/`) — the 40-min full-video Pass-1 was **not**
re-run. The per-frame classifier was replayed on the 11 saved canonical post-game PNGs via
`tools/game_ocr/scripts/diagnose_postgame_classification.py` (raw output:
`…/ws6-match2582-postgame/diagnosis-perframe-output.txt`).

---

## TL;DR

The post-game screens fail **not** because the OCR can't read them or the classifier lacks the classes,
but because the **v2 migration dropped the post-game text anchors**: `nhl26_regex_priors.yaml` has **zero
priors for any `post_game_*` state**. With no text anchor, (a) the emission gets no anchor bonus for
post-game states and (b) the classifier has no post-game text _feature_ — so it must discriminate
post-game screens on **HSV color alone**, which is degenerate on the dark post-game UI. The classifier
is left weak and inconsistent; `unknown_or_transition` (+16 intercept) wins by default on ~half the
frames, and the Viterbi decoder smooths away the sparse frames the classifier _does_ get right.

It is a **combination**, with one dominant, cheap lever (the missing priors).

---

## Failure mechanism (layered)

### Layer 0 — reject-floor: RULED OUT

`build_log_emissions_v2` pins a frame to `unknown_or_transition` if a "reject" prior (owning state
`unknown_or_transition`) fires ([emissions.py:128-133](../../tools/game_ocr/game_ocr/emissions.py#L128)).
The diagnostic shows **`reject_fired=False` on every post-game frame** (the reject priors are
`customize/season_pass/rewards/waiting_for/leaderboard_cup` — none appear in post-game text). So the
reject path is **not** the cause.

### Layer 1 — missing post-game regex priors (PRIMARY, the wiring gap)

`nhl26_regex_priors.yaml` defines priors only for lobby / loadout / menu / loading / reject. **No
`post_game_*` priors exist.** Consequences, both real:

1. **Emission anchor bonus = 0 for post-game.** `build_log_emissions_v2` adds `anchor_bonus(3.0) ×
(#fired priors → state)` ([emissions.py:143-150](../../tools/game_ocr/game_ocr/emissions.py#L143)).
   No post-game prior ⇒ no bonus ⇒ the weak classifier signal is never reinforced.
2. **Classifier has no post-game text feature.** The only text-derived dims in the v2 feature vector are
   `regex_prior_flags(n_priors)`
   ([screen_classifier.py:300-308](../../tools/game_ocr/game_ocr/screen_classifier.py#L300)); everything
   else is HSV / brightness / blur / edge. So the perfectly-OCR'd `all events`, `goal summary`,
   `net chart`, `end of game` text is **discarded** for classification.

The state machine _does_ define post-game `anchor_substrings`
([nhl26.yaml:65-72](../../tools/game_ocr/game_ocr/configs/state_machine/nhl26.yaml#L65)) —
`all events`→action_tracker, `goal summary`→box_score, etc. **But those are dead in v2**:
`feature_vector_v2` is explicit — "v2 has no per-state anchor flags — regex priors replace that signal"
([screen_classifier.py:316-317](../../tools/game_ocr/game_ocr/screen_classifier.py#L316)). The v1→v2
port moved anchors from state-machine `anchor_substrings` to `regex_priors.yaml` and **never carried the
post-game entries over.**

### Layer 2 — classifier is visual-only and weak on the dark UI

Per-class trained weights (`nhl26-screen-classifier-v2.json`):

- `unknown_or_transition` intercept **+16.1**, `loading_or_intro` **+16.3** — huge defaults.
- Post-game classes carry low/negative intercepts (`post_game_events` −13.6, `post_game_player_summary`
  −3.9, `post_game_action_tracker` −0.36) and **low prior-coef norms** (0.28–0.77 vs 1.5–2.5 for
  lobby/loadout) — i.e. their decisions are almost entirely HSV-visual.

On the dark grey post-game UI (`color_score = 0.0` throughout) the HSV signal is weakly discriminative, so
on roughly half the post-game frames the correct class can't overcome unknown's +16 default:

| frame                | OCR text (correct)         | raw classifier PRED                    | want rank / logprob | unknown logprob |
| -------------------- | -------------------------- | -------------------------------------- | ------------------- | --------------- |
| action_tracker (2nd) | `…allevents…2nd period…`   | **post_game_action_tracker ✓**         | 0 / −0.61           | −1.49           |
| action_tracker (OT)  | `…allevents…ot…`           | **post_game_action_tracker ✓**         | 0 / −0.87           | −1.15           |
| faceoff_map          | `…faceoff…1st period…`     | **post_game_faceoff_map ✓**            | 0 / −0.92           | −0.97           |
| net_chart            | `…net chart…3rd…`          | unknown ✗                              | 1 / −2.26           | −0.31           |
| box_score (goals)    | `lt goalsummary`           | unknown ✗                              | 3 / −5.02           | −0.08           |
| box_score (faceoffs) | `lt faceoffsummary`        | unknown ✗                              | 5 / −4.97           | −0.15           |
| player_summary / end | `…playersummary endofgame` | unknown ✗                              | 8–11 / −5.5…−6.8    | ≈ −0.1          |
| scoring summary      | `lt all`                   | post_game_action_tracker (want events) | 1 / −1.64           | −1.85           |

So the classifier is **partially capable** (it nails action_tracker/faceoff_map) but **too weak and
inconsistent** to carry post-game alone — exactly what an anchor prior is supposed to backstop.

### Layer 3 — Viterbi erases the sparse correct predictions

`segments.json`'s per-frame `screen_type` is the **Viterbi-decoded** segment label (the orchestrator
seeds every frame `unknown_or_transition` then overwrites with the decoded segment,
[orchestrator.py:305-337](../../tools/video_ingest/video_ingest/orchestrator.py#L305)). The raw classifier
predicts `post_game_action_tracker` on the sampled action-tracker frames, yet the decoded span
(1902–1945 s) is **all `unknown_or_transition`**. With no anchor bonus, the thin per-frame margin
(~0.9 logit) can't overcome the unknown self-loop + the −3.0 transition penalty + the per-state min-dwell
([EmissionWeights](../../tools/game_ocr/game_ocr/emissions.py#L34), state-machine min-dwell
post_game_action_tracker 1.5 s) — especially as the operator tabs screens faster than the dwell. So the
sparse correct frames are smoothed into the surrounding unknown run.

**Net:** OCR reads the right text → it's discarded (Layer 1) → the unaided dark-UI classifier is weak and
loses to unknown's default (Layer 2) → and where it does win, Viterbi smooths it away (Layer 3).

---

## Smallest plausible fix

Two tiers. The missing priors (Layer 1) are the dominant, cheapest lever.

### Tier B — proper fix (recommended): add post-game priors + retrain

1. **Add `post_game_*` regex priors** to `nhl26_regex_priors.yaml`, porting the already-correct
   state-machine `anchor_substrings` (nhl26.yaml:65-72): `all events`→action_tracker,
   `goal summary`/`shot summary`/`faceoff summary`→box_score tabs, `net chart`→net_chart,
   `player summary`/`end of game`→player_summary, with disambiguation for `faceoff` (map vs box-score
   faceoffs) and `all` (events vs the action-tracker "all events").
2. **Retrain the v2 classifier** (`train_screen_classifier_v2`) with (a) the expanded prior set — note
   `n_priors` 18→~26 reshapes the feature vector, so a retrain is **mandatory**, not optional
   ([regex_priors.py:11-12](../../tools/game_ocr/game_ocr/regex_priors.py#L11)) — and (b) **real
   post-game frames from this match** (the saved clip/frames are the seed). This simultaneously fixes all
   three layers: gives the post-game text feature + anchor bonus (L1), teaches the dark-UI post-game
   visual features and rebalances the +16 unknown/loading intercepts (L2), and lets the consistent
   per-frame anchor carry the Viterbi span (L3).

### Tier A — no-retrain stopgap (only if an immediate unblock is needed)

Wire the **existing, currently-dead** state-machine post-game `anchor_substrings` into
`build_log_emissions_v2` as an emission anchor-bonus term **independent of the classifier feature
vector** (so `n_priors`/`coef` are unchanged → no retrain). Caveat from the numbers above: a flat
`anchor_bonus = 3.0` rescues action_tracker / faceoff_map / net_chart / events but **not** box_score
(−5) or player_summary (−6.8) — those sit too far below unknown's −0.1. A stopgap would need either a
larger post-game bonus or a **positive-anchor pin** (mirror the reject path: when a post-game anchor
fires, strongly bias that state). This is a band-aid and must be bench-validated; it does not fix the
dark-UI visual weakness.

**Recommendation:** Tier B. Tier A only buys time and risks over-pinning on OCR misreads.

---

## Proving-bench extension plan (the coverage gap that let this ship)

The bench is pre-game only (match-250 lobby/loadout, match-968 menu) — **post-game screen classification
on video was never tested.** Add a post-game arm so this can't silently regress:

1. **Clip:** regenerate the ~1868–1988 s post-game clip from the retained source (command in the bundle
   README) into `tools/video_ingest/tests/fixtures/screen-classifier-proving-bench/`
   (e.g. `clip-match2582-postgame.mkv`).
2. **Labels:** hand-label its seconds against the canonical PNGs + `segments-gate-off.json` anchor
   evidence — end-of-game / player_summary, action_tracker (per period filter), faceoff_map, net_chart,
   box_score goals/shots/faceoffs, events. Use canonical `source_time_seconds` (F7 — never index offsets).
3. **Assertions:** per-clip ≥90% per-frame accuracy **plus** a hard rule mirroring match-968's
   contamination gate — _no labeled post-game span may decode as `unknown_or_transition` or
   `player_loadout_view`_. This is exactly the failure WS6 hit.
4. **TDD order:** add the arm **first as a failing test** (current weights fail it), then land the Tier-B
   fix to turn it green. Because the bench runs the full `decode_segments_v2`, it validates the
   emission + Viterbi fix end-to-end, not just the classifier head.
5. Keep the existing pre-game arms green (no regression from the retrain).

---

## Evidence artifacts (in the bundle)

- `diagnose_postgame_classification.py` (`tools/game_ocr/scripts/`) — replays the per-frame decision on
  the saved PNGs; re-runnable in seconds.
- `diagnosis-perframe-output.txt` — its captured output (the table above).
- `segments-gate-off.json` — the decoded per-frame labels (Layer 3 evidence).
- `frames/canonical/*.png` — the inputs.
