# Redesign scope audit — 2026-05-19

Every remaining failure mode in the OCR pipeline, classified into exactly one of four buckets per the plan at `/home/michal/.claude/plans/plan-a-thourough-fix-snappy-wave.md`. No subsequent phase ships work that isn't an entry in this doc.

## Bucket key

| Bucket | Definition |
|---|---|
| **A** — Structural recording gap | Source video does not contain the data. Pipeline cannot recover. Recording-protocol fix only. |
| **B** — Cheap fix exists | <2 hrs; no schema change OR purely additive migration with no read/write dependency cascade. Ships in Phase 2. |
| **C** — Heavyweight change justified | Cheap fix attempted (or trivially impossible) AND insufficient. Justification cites the cheap alternative's specific limit. Ships in Phase 3. |
| **D** — Unknown | Cannot classify without Phase 1 instrumentation. Re-classify after Phase 1. |

## Inputs

- Current `match-quality --match 250` flags: A×1 (P3 2:09 hit dup), C×3 (10:20/0:42 same-player same-spot; 17:41/17:43 cross-actor; 16:06 faceoff vs 19:34 hit at same dot).
- Current `match-quality --match 463` flags: A×1 (P2 11:07 faceoff dup), C×1 (P3 17:14/17:52 SILKY same-spot legitimate).
- Match 463 page residuals user QA'd directly: missing X-Factors (9/10 slots), missing attributes (9/10 slots), 2 NULL canonical builds, raw "PLY" rendering, 1 slot missing platform indicator, the action-tracker issues below.
- Match 463 P1/P2/P3 action-tracker issues from manual QA (34 total reported earlier in session).
- `docs/calibration/baseline-2026-05-19.md` failure-mode table.
- `docs/calibration/phase-5-plan-2026-05-19.md` deferred items.

---

## Per-failure-mode classification

### Lineup / loadout — match 463

| # | Failure mode | Evidence | Bucket | Notes |
|---|---|---|---:|---|
| L01 | 9/10 loadout slots have zero per-attribute data | `player_loadout_attributes` count = 23 (HenryTheBobJr only) instead of 230 expected | **A** | Source video frames classified as `player_loadout_view` = 2 of 1,680. Other 9 cards never dwelled on long enough for Pass-1 to emit a segment OR for the anchor-text gate to accept. Re-ingest produces the same data. Recording-protocol fix only. |
| L02 | 9/10 loadout slots have zero X-Factors | `player_loadout_x_factors` count = 3 (one slot) | **A** | Same root cause as L01 — X-Factors live only on `player_loadout_view`. |
| L03 | 2/10 slots have NULL `build_class_canonical` (ThickOoze, Orygoon-Ducks) | `match-quality --match 463` lineup table | **D** | Could be parser column-ROI misalignment (Phase 2 fix) OR a true OCR limit (Phase 0 bucket A). Phase 1a's extended benchmark won't help — these rows aren't in V2 ground truth. Phase 2 step: open the source frames for these two slots, inspect whether the build text is legible in the recording. If yes → fix is bucket B. If no → reclassify to bucket A. |
| L04 | Raw `build_class` rendering 18× on rendered page as "PLY" / "PWF" etc. | `curl -s http://localhost:3000/games/463 \| grep -c PLY` = 18 | **B** | UI component reads `build_class` (raw OCR) instead of `build_class_canonical`. One-line fix. T3 validation. |
| L05 | 1 of 10 slots missing platform indicator on rendered page | `curl /games/463 \| grep -c xbox.svg` = 7 + `playstation.svg` = 2, total 9/10 | **D** | Need to identify which player and trace the EA-API overlay join in `match-lineups.ts`. Almost certainly a data-join bug (bucket B). Held at D until traced. |

### Lineup / loadout — match 250

| # | Failure mode | Evidence | Bucket | Notes |
|---|---|---|---:|---|
| L06 | Match 250 lineup near-100% per V2 benchmark; tests already enforce | `match-250-benchmark.test.ts` passes 2/2 | **(no work)** | Baseline. T1 in Phase 1a extends this to attributes/events/period-summaries/etc. |

### Action Tracker — match 463 (user-reported, by class)

#### Class A — OCR-variant duplicate events

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| AT01 | P2 11:07 faceoff dup (current residual) | `match-quality --match 463` flag | **B** if a Levenshtein-≥2 SQL pass on opp-side faceoffs catches it; otherwise reclassify. Earlier Phase 5 Step C handled distance-2 opp-side; this one may be distance-3 or higher. |

#### Class B/F — Wrong actor / target attribution

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| AT02 | "8:13 stick menace shooting on henrythebobjr" (both BGM) — wrong target | User QA finding | **B** | Levenshtein floor on `resolveGamertagToPlayer` returns null instead of guessing wrong. Phase 2 fix. T2: assert this specific event's target_player_id IS NOT HenryTheBobJr's id. |
| AT03 | "6:01 phantom event credited to joey on henrythebob" — wrong actor | User QA finding | **B** | Same fix as AT02; Joey alias was already corrected to point to HenryTheBobJr in Phase 5a. After Levenshtein floor lands, this should resolve to null actor instead of wrong one. |

#### Class C — Marker / position collision

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| AT04 | P3 17:14/17:52 SILKY shots @ (65.38, -10.01) — current residual | `match-quality` flag | **(no work)** — legitimate. Same player, 38 sec apart, same spot is a real hockey play. Stays as WARN. |
| AT05 | Single-event wrong-location markers (P2 6:13 hit, P2 16:34 hit, P2 19:15 hit, P3 2:45 shot, P3 13:28 shot, P3 15:32 shot, P3 17:14 shot — per user QA) | User QA findings | **D** | Need Phase 1b's per-screen→table attribution to see whether the chevron extractor is plausibly picking the wrong chevron on a specific frame or whether it's a systematic spatial-calibration drift. Hold for re-classification after Phase 1b. |

#### Class D — Missing event extraction

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| AT06 | Missing 6:01 H.Jenkins shot (user reported P2) | User QA finding | **A** | The post_game_action_tracker screen scrolls; if the user didn't display this event during recording, it's not in the captured frames. Recording-protocol fix only. |
| AT07 | Missed penalties at 14:17, 0:06, 2:23, 16:51, 17:50 | User QA + match-quality before Phase 5c | **(fixed)** | Phase 5c penalty parser landed all 5. T1 should encode them as expected events. |

#### Class E — Phantom events

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| AT08 | Phantom 17:07 P2 faceoff (user reported) | User QA finding | **B** | Cross-frame consensus filter: drop AT rows present in <2 frames AND not corroborated by `post_game_events`. Phase 2 fix. T2: assert match 463 has zero P2 17:07 faceoff rows in `match_events`. |

#### Class G — Off-roster alias leak

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| AT09 | H.Jenkins → JoeyFlopfish (11 instances pre-fix) | match-quality before Phase 5a | **(fixed)** | Phase 5a fixed. T1 should encode the corrected `actor_player_id` mappings on the 250-side equivalents (L. HUTSON, H. JENKINS aliases). |

### Action Tracker — match 250 residuals

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| AT10 | P3 2:09 hit dup (Class A residual) | match-quality flag | **B** if a Levenshtein-≥2 pass catches it; same as AT01. |
| AT11 | P2 10:20/0:42 same-player same-spot Class C | match-quality flag | **(no work)** — legitimate same-spot repeat (same as AT04 SILKY/SILKY pattern). |
| AT12 | P3 17:41/17:43 P. MAGROYNE/TOEWS cross-actor Class C | match-quality flag | **D** | Two different actors 2 sec apart at same coord is suspicious. Could be: (a) one real hit with OCR misread of the actor on a duplicate row (then this is a dedup gap → bucket B); (b) two real hits in quick succession from different players. Need Phase 1a's extended benchmark to assert P3 17:41 hit's actor + Phase 1b's per-screen attribution to see frame count. Hold. |
| AT13 | P4 OT faceoff@16:06 vs hit@19:34 same coord, different types | match-quality flag | **(no work)** — different event types at same rink dot are legitimate; faceoff happens at a dot, a hit later occurs near the same dot. |

### Downstream — structural recording gaps

| # | Failure mode | Evidence | Bucket |
|---|---|---|---:|
| DS01 | `match_shot_type_summaries` 6/8 on match 463 (no P3 row) | match-quality `gaps: shot_type_summaries=6/8` | **A** | User never navigated to the P3 net_chart view during recording; the 2 unreadable frames don't contain the missing data. Recording-protocol fix only. |
| DS02 | `match_period_summaries` 4/4 on both matches | OK | **(no work)** |
| DS03 | `match_faceoff_dots` ≥ 18 on both matches | OK | **(no work)** |

---

## Cross-cutting summary by bucket

| Bucket | Count | Items |
|---|---:|---|
| **A — Recording-protocol structural** | 4 | L01, L02, AT06, DS01 |
| **B — Cheap fix, ships Phase 2** | 6 | L04, AT01, AT02, AT03, AT08, AT10 (and likely L05 once traced) |
| **C — Heavyweight, ships Phase 3 if justified** | 0 | None pre-committed. Phase 3 entries open only if Phase 2's cheap attempts fail. |
| **D — Unknown, needs Phase 1 instrumentation** | 4 | L03 (build NULL — needs source-frame inspection), L05 (platform — needs join trace), AT05 (single-event wrong locations — needs per-screen attribution), AT12 (cross-actor Class C on 250 — needs both T1 + per-screen attribution) |
| **(fixed)** | 2 | AT07 (penalties), AT09 (Joey leak) |
| **(no work)** | 6 | L06, AT04 / AT11 / AT13 (legitimate same-spot or different-type rink collisions), DS02, DS03 |

---

## Recording-protocol companion doc (bucket A items)

These won't be fixed by Phase 2/3. They need an operator-facing document so future matches don't inherit the same gaps. Out of scope for THIS plan, but tracked here for future reference:

- Dwell ≥2 seconds per loadout card (10 cards × 2s = 20s in pre-game). Currently ~0.5s/card on match 463.
- Step through all period views on net_chart (P1, P2, P3, OT, totals).
- Scroll the full Action Tracker list during navigation.
- Don't navigate during transition animations.

Companion doc to be authored separately as `docs/calibration/recording-protocol.md` when the user wants to prevent these gaps on future matches.

---

## Phase 1 prerequisites — what each bucket-D item needs before re-classification

| Item | What Phase 1 needs to provide |
|---|---|
| L03 (NULL builds) | Source-frame inspection (manual; can be done as part of Phase 2 investigation entry). Not strictly a Phase 1 prerequisite but documented here. |
| L05 (missing platform) | Same — manual join trace; can be part of Phase 2. |
| AT05 (wrong locations) | **Phase 1b** per-screen → table attribution: for each wrong-location event, see whether that event's `match_events.ocr_extraction_id` traces to a single frame with a confident position vs many low-confidence frames. |
| AT12 (cross-actor Class C 250) | **Phase 1a** extended benchmark asserts P3 17:41 / 17:43 actor identities + **Phase 1b** attribution counts. If both events trace to a single frame, it's a dedup miss (bucket B). |

---

## Decisions gated by this doc

- Phase 1a builds the V2 verifier for L06's lineup baseline + AT07/AT09's now-fixed assertions + AT12's two-row actor identity. **6 of the bucket-D items don't actually need new T1 assertions — they're either match-463 (no V2 ground truth) or already covered by the existing lineup benchmark.**
- Phase 1b's per-screen → table attribution unblocks AT05 and AT12 classification.
- Phase 2's bucket-B list is now concretely L04 + AT01 + AT02 + AT03 + AT08 + AT10 (+ L05 once traced). All others either A (recording-protocol) or D (instrument first).
- Phase 3 has zero pre-committed entries. It opens only if a Phase 2 cheap fix attempt fails AND the V2 verifier / T2 test confirms the gap is unresolved.

---

## Honest residuals after Phase 2

If every bucket-B fix lands successfully:

| Match | L2 actor | L2 lineup | L3 | Flags |
|---|---:|---:|---:|---|
| 250 | 97.9% → ~98–100% | 100% | 100% | A=0, C=2 (legitimate same-spot / different-type) |
| 463 | 98.0% → ~98–100% | 95% → ~100% if L03 + L05 fix (bucket B); 95% if L03 reclassifies to A | 84.2% (structural ceiling from bucket A) | A=0, C=1 (legitimate SILKY/SILKY) |

Match 463's L3 ceiling at 84.2% is **structural and cannot be improved by code changes**. The missing data (`player_loadout_attributes`, `player_loadout_x_factors`, `match_shot_type_summaries` P3 row) requires re-recording with the recording protocol followed.
