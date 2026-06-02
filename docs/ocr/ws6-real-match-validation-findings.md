# WS6 — Real Match Validation Findings

**Recording:** `K:\2026-05-31_16-09-36.mkv` (WSL `/mnt/k/2026-05-31_16-09-36.mkv`)
· sha256 `967ed784eb64a1c99326565412d8facf49a541ea453fcb4b9c1ae2152aceed2f`
· 2084.9 s, 1920×1080, h264 60 fps, 868 MB.

**Match:** **2582** (`ea_match_id 20570598020124`, `played_at 2026-05-31 22:40:15+00`, `game_title_id 1` = NHL 26).
Mapping **confirmed** (see §2). `http://localhost:3000/games/2582`.

**run_id:** none (no ingest committed). **game_title_id:** 1. **Date validated:** 2026-06-01.

Plan: `~/.claude/plans/plan-ws6-for-the-hidden-fog.md`. WS6 of the OCR/Video-Ingestion Pipeline Revamp.

---

> **✅ UPDATE — blocker FIXED (Tier B, branch `feat/post-game-classifier-fix`).** The post-game
> classification gap diagnosed below was root-caused (`docs/ocr/ws6-postgame-classifier-diagnosis.md`)
> and fixed: 8 restored `post_game_*` priors + a v2 retrain (`3fba4da`) + a post-game proving-bench arm
> (`3f29f1d`). A full-recording rerun now yields **12 post-game segments (was 0)** and 15 dispatching
> (was 4); all data-bearing post-game screens classify and route to promoters. The findings below stand
> as the original validation record. **Still pending for a clean WS6 acceptance:** the committed
> `reprocess` ingest of match 2582 (now unblocked) + ground-truth diff, and a *second* match for true
> generalization (this fix is trained/validated on match 2582 only).

## 1. Outcome

**FAIL — blocker found (this is the WS6 payoff, not a crash).** The video→OCR pipeline **cannot extract
post-game match data (events, rink positions, box score, action tracker) from this real recording**,
because the v2 screen classifier classifies **every post-game screen as `unknown_or_transition`** (and
one as `player_loadout_view`). Since dispatch routes on `screen_type`, **0 of the post-game screens reach
a promoter**. The plan's core acceptance criteria (≥1 scroll-past position recovered; events diffed vs
ground truth) **cannot be met from the video path as-is**.

Per the Phase-1 STOP gate ("if Pass-1 is visibly wrong, STOP and report — do not commit garbage"), the run
was halted **before** the committed `reprocess` write and before the 40-min gate-ON WS2 pass. **No DB rows
were written; no candidate run was created; match 2582 is untouched.**

What the video pipeline **can** extract here: pre-game **lobby + loadout** (correctly classified, see §4).
That is the only usable output, and it comes with a pollution risk (§6).

---

## 2. Match mapping — CONFIRMED

The recording's End-of-Game screen (t≈1900 s) reads **BM 3 – 2 RR** and its team stats match EA's
match-2582 row almost exactly:

| Stat | On-screen | EA API (match 2582) | Match |
|---|---|---|---|
| Result / score | BM 3 – 2 RR | WIN 3–2 | ✓ |
| Hits | 27 / 36 | 27 / 36 | ✓ |
| Time on attack | 5:19 / 11:23 | 319 s / 683 s | ✓ |
| Passing | 81.7% / 71.1% | 109/89, 128/91 | ✓ |
| Penalty minutes | 7:00 / 8:00 | 7 / 8 | ✓ |
| Powerplays | 1/4 / 0/2 | pp 1/4, 0/2 | ✓ |
| **Total shots** | **17 / 18** | **16 / 17** | **off-by-one** |

Opponent = **Roc River Rats** (`opponent_club_id 16645`). Local recording window (16:09–16:44) maps to
`played_at 22:40 UTC` at UTC-6. Max skater TOI 3742 s ≈ 62.4 min (game-clock) = regulation 60 + ~2.4 min →
**confirms OT** (EASHL accelerated clock: 35 min real-time = full game-clock game). The Total-Shots
off-by-one (screen 17/18 vs EA 16/17) is a **video↔EA disagreement** → GROUND-TRUTH AMBIGUITY (the
End-of-Game "Total Shots" likely counts differently than the EA `shots` field).

---

## 3. Version detection — `unknown_version` (WS3 gap, confirmed on real footage)

`python -m video_ingest.version_detect … --samples 7` → **`unknown_version`, confidence 0.00**, hits
`{nhl26:0, nhl27:0}`. All 7 samples landed on **in-game HUD** (scoreboard `bm`/`rr`, periods, SOG); the
nhl26 anchors are *menu* tokens ("world of chel", "loadouts", …) that never appear in gameplay. This is
the **WS3 text-anchor-only fragility** the plan flagged — it fails on a gameplay-heavy capture.

- **Bucket:** MODEL WEAKNESS (known-deferred WS3 visual-anchor gap), now empirically confirmed on real
  video. **Severity:** medium (a `--version auto` ingest would be **blocked** — the orchestrator stops on
  `unknown_version`). **Mitigation in use:** pin `--version nhl26` explicitly (the plan does this), which
  bypasses detection. **Defer:** WS3 visual-anchor discriminator.

---

## 4. Pass-1 segment audit (gate-OFF, `--force-pass1`, 2085 frames → 65 segments, 2397 s)

Real-time structure recovered correctly **except** post-game:

| Window | Pass-1 result | Reality | Verdict |
|---|---|---|---|
| 0–73 s | unknown_or_transition (black) | intro/black | ok |
| 73–121 s | **pre_game_lobby_state_2** + **player_loadout_view** (86–108) | pre-game lobby + loadout | **correct** |
| 160–1832 s | **in_game_clock** (27 segs, interleaved w/ transitions) | gameplay incl. OT | **correct** |
| **1832–1972 s** | **unknown_or_transition (140 fr)** | **End-of-Game + Action Tracker + Box Score + Net Chart + Faceoff Map + Scoring Summary** | **WRONG — see §5** |
| 1972–1979 s | **player_loadout_view** | Scoring Summary ("ALL") | **WRONG (misroute)** |
| 2001–2079 s | loading_or_intro | WoC lobby return | ~ok |

Pre-game and in-game classification are solid. The failure is **specific to post-game screens**.

---

## 5. ROOT FINDING — post-game screens classify as `unknown_or_transition`

The OCR **reads the disambiguating text correctly on every post-game frame**, but the classifier assigns
none of them to their `post_game_*` class:

| t (s) | OCR `anchor_text` (read correctly) | assigned | should be |
|---|---|---|---|
| 1884–1900 | `clubseasonsprogression … playersummary endofgame` | unknown_or_transition | post_game_player_summary / end-of-game |
| 1902–1945 | `rm rr allevents rt {1st/2nd/3rd/ot} period 3-2` | unknown_or_transition | **post_game_action_tracker** |
| 1947 | `rm rr faceoff rt 1st period 3-2` | unknown_or_transition | post_game_faceoff_map |
| 1953–1957 | `rm rr netchart rt … period 3-2` | unknown_or_transition | post_game_net_chart |
| 1967–1971 | `lt goalsummary / shotsummary / faceoffsummary` | unknown_or_transition | **post_game_box_score_{goals,shots,faceoffs}** |
| 1972–1978 | `lt all` (Scoring Summary) | **player_loadout_view** | post_game_events |

Facts:
- **Not a config gap.** `nhl26.yaml` defines all post-game classes in `extract_screens` and the pass-2
  budgets (`post_game_action_tracker`, `post_game_box_score_{goals,shots,faceoffs}`, `post_game_events`,
  `post_game_player_summary`, `post_game_faceoff_map`, `post_game_net_chart`).
- **`color_score = 0.0` across the entire post-game** (dark-grey UI). The classifier appears to lean on
  color/HSV features that are starved on these screens, defaulting to the reject/unknown floor — while the
  regex/anchor priors that *should* fire on `endofgame`/`goalsummary`/`allevents…period` do not override
  it.
- **No bench coverage.** The proving bench is two pre-game clips (match-250 lobby/loadout, match-968
  menu). **Post-game screen classification on video was never validated** — so this gap shipped silently.
  This is precisely what WS6 existed to catch.

**Dispatch consequence (computed from `segments.json`): only 4 of 65 segments would dispatch** —
2× `pre_game_lobby_state_2` + 1× real `player_loadout_view` (correct) + **1× misrouted Scoring-Summary→
`player_loadout_view`**. **Zero** post-game segments. So reconcile + WS4 identity recovery have nothing to
act on; no events, positions, or box-score are extracted.

- **Bucket:** MODEL WEAKNESS (classifier weights / anchor-prior wiring). **Severity:** HIGH — it blocks the
  entire post-game extraction path on real video. A focused diagnosis (deferred) is needed to decide
  whether the fix is (a) retrain with post-game frames, (b) wire/strengthen the anchor-prior override so
  the clearly-read `endofgame`/`*summary`/`allevents…period` tokens force the class, or (c) reduce the
  color-feature dependence on dark screens. If the anchor priors are *supposed* to force these classes and
  a bug prevents it, the bucket shifts to PIPELINE BUG.

---

## 6. Secondary finding — misrouted Scoring-Summary → loadout (pollution risk)

The Scoring-Summary frames (1972–1979 s, anchor `lt all`) classify as `player_loadout_view`, which **is**
in `extract_screens`. A committed `reprocess` would therefore dispatch them to the **loadout promoter**
(`loadout_engine=typed_v1` → `extract_loadout_evidence` on a scoring-summary image), producing either junk
loadout evidence or a rejected extraction, and potentially polluting the loadout/lineup canonicals that
`consolidate-loadouts` + `validate` consume. **This is the concrete reason NOT to commit the run as-is.**

- **Bucket:** MODEL WEAKNESS (misclassification) with a PIPELINE consequence (bad data into the loadout
  path). **Severity:** medium.

---

## 7. WS2 (pre-OCR gate) — correctness NOT verified this run

The gate-ON `classify-only` (WS2 A/B) was **skipped** (the STOP gate fired first; a second 40-min GPU pass
was not justified before reporting). So **WS2 ON≡OFF correctness is unverified on this footage** — record
as a gap, to be closed on the post-fix re-run.

**Wall-saving note (new vs the bench clips):** this footage **does contain near-black fade frames** (e.g.,
t≈1985 s between Scoring Summary and lobby; segments at 0–73 s and 2079–2085 s show `color=0.00`). Unlike
the bench clips (which had ~0 gateable frames), a future gate-ON run here **could** produce a measurable
`frames_gated > 0` → a real wall-saving measurement. Worth doing on the re-run.

---

## 8. Partial ground truth captured (for the post-fix re-run)

Read directly off decode-accurate post-game frames (not yet a full hand-key — the run stopped at the
classifier blocker). Useful as a head-start benchmark later. **Names below are in-game PERSONAS**, not
gamertags — the persona↔gamertag mapping is unresolved and is itself a hard problem (F9): even by eye, the
footage alone does not cleanly map e.g. "H. Jenkins" → a BGM gamertag, and apparent team/jersey cues
conflict. **EA box score is authoritative for the gamertag-level truth.**

**Final:** BM 3 – 2 RR (BGM win in OT).

**EA box score (authoritative, BGM skaters):** HenryTheBobJr LW 2G/1A · Ordinary_Samich RW 1G/1A ·
silkyjoker85 C 0G/2A · EuronKrak D 0/0 · JoeyFlopfish D 0/0 · CPU goalie.

**Lineup (WoC lobby, t≈2000 s) — matches EA positions:** RW Ordinary_Samich (Playmaker) · C silkyjoker85
(Grinder) · LW HenryTheBobJr (Mikko Rantanen-SNP, captain) · RD JoeyFlopfish (Two-Way Defenseman) · LD
EuronKrak (Grinder) · 6th slot CPU.

**Scoring Summary (t≈1975 s, partial — 1st period scrolled off top, OT goal cut off bottom; PERSONAS):**
- 2nd: **BM goal 15:31 — H. Jenkins (1), assist P. Beav** · RR penalty Charging (Minor) [13:34] L. Stinkkpit
- 3rd: **RR goal 09:27 — L. Stinkkpit (1), assist C. Yoseff** · RR penalty Tripping (Minor) [16:26] -. Martel
  · RR penalty Delay of Game (Minor) [17:42] U. Mailman
- OT: **BGM game-winner — H. Jenkins, on goalie M. Lehmann** (Action Tracker OT filter, t≈1942 s). Since
  EA credits HenryTheBobJr with 2 goals, this pins **persona "H. Jenkins" = gamertag HenryTheBobJr** — a
  concrete data point for the persona↔gamertag mapping, established by cross-referencing the screen
  against the authoritative EA box score (the method the re-run must use).

**Action Tracker (t≈1925 s, 2nd-period filter; positioned markers present):** hits (e.g. U. Mailman ON
H. Jenkins 15:24; Martel ON V. Greyjoy 16:19; P. Beav ON L. Stinkkpit 19:10), a BGM shot (Silky ON
M. Lehmann 17:04), faceoffs (Fella vs Silky), and one goal marker — each plotted on the rink. This is the
WS4 position/identity surface, and it is exactly what the classifier currently drops.

**All artifacts preserved in-repo** at `tools/video_ingest/tests/fixtures/ws6-match2582-postgame/`
(decode-accurate canonical screen PNGs, the working frame strip, the full gate-OFF `segments.json`, and a
README mapping every timestamp→screen + clip-regeneration command). See §11.

---

## 9. Findings (classified)

| # | Description | Bucket | Severity | Fix-now / Defer |
|---|---|---|---|---|
| 1 | Post-game screens (action-tracker, box-score×3, events, player-summary, net-chart, faceoff-map) all classify as `unknown_or_transition` despite correct OCR text → 0 post-game dispatch | MODEL WEAKNESS (poss. anchor-prior wiring → PIPELINE) | **HIGH** | **Defer** (needs retrain/anchor-prior fix + focused diagnosis) |
| 2 | Scoring Summary misclassified as `player_loadout_view` → would feed the loadout promoter garbage | MODEL WEAKNESS + PIPELINE consequence | Medium | Defer (same fix family as #1) |
| 3 | `version_detect` → `unknown_version` on gameplay-only sampling window | MODEL WEAKNESS (WS3 known gap) | Medium | Defer (WS3 visual anchor) |
| 4 | End-of-Game "Total Shots" 17/18 vs EA 16/17 | GROUND-TRUTH AMBIGUITY | Low | Defer (note only) |
| 5 | WS2 gate ON≡OFF correctness unverified (gate-ON run skipped) | (verification gap) | Low | Re-run on post-fix pass |
| 6 | Persona↔gamertag mapping unresolved; no per-match seed | GROUND-TRUTH AMBIGUITY (F9) | Medium | Defer (operator mapping needed before identity scoring) |

No **fix-now** items: the dominant finding needs a model/anchor change + diagnosis, which is out of WS6's
report-only scope.

---

## 10. Disposition

- **No prod write.** No `reprocess` run, no candidate `ocr_decoder_runs` row, no `match_events`, no loadout
  rows. Match 2582 is byte-unchanged; match 250 untouched.
- **No code change** (WS6 is report-only; the fix is a follow-up workstream).
- **Recommended next workstream (new, ~WS7 / "post-game classifier"):** (1) diagnose why post-game frames
  lose to `unknown` (anchor-prior override vs reject-floor vs color-feature starvation vs training-data
  gap) on the 1832–1979 s window; (2) add post-game frames from this recording (+ others) to the screen
  classifier's training/bench data — **the proving bench must gain a post-game arm** so this can never
  silently regress again; (3) fix (retrain and/or anchor-prior wiring); (4) re-run WS6 end-to-end on this
  same recording (mapping + ground-truth scaffolding already done here).
- **Deferred (unchanged):** WS4 Stage 3 (clock re-OCR); WS3 visual-anchor discriminator; WS2 ON≡OFF
  re-verify + wall measurement on the re-run; persona↔gamertag operator mapping for match 2582.

## 11. Reusable artifacts produced

Durable evidence bundle: **`tools/video_ingest/tests/fixtures/ws6-match2582-postgame/`** (see its README
for the full timestamp→screen manifest and clip-regeneration command):

- `segments-gate-off.json` — full Pass-1 classification incl. the post-game `anchor_text` evidence (the
  expensive 40-min GPU artifact; re-use, don't re-run).
- `ingest-timings.json` — Pass-1 timing sidecar.
- `frames/canonical/*.png` — decode-accurate stills of each distinct post-game screen.
- `frames/strip/*.jpg` — the 1875–1985 s working strip (scroll/filter states).
- This report + the confirmed mapping recording↔match 2582 + EA-vs-screen cross-check (§2) + partial
  ground-truth scaffold (§8).

Source recording retained at `K:\2026-05-31_16-09-36.mkv` (sha256 `967ed784…aceed2f`) — the post-game
clip for the future bench arm regenerates from it in one `ffmpeg -c copy` (command in the bundle README).
