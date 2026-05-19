# Redesign Round 4 — Codex Synthesis (2026-05-19)

This document is Round 4 of the four-round OCR redesign process. It integrates:

- Round 1: `docs/calibration/redesign-round-1-internal-2026-05-19.md`
- Round 2: `docs/calibration/redesign-round-2-external-internet-2026-05-19.md`
- Round 3: `docs/calibration/redesign-round-3-deep-research-2026-05-19.md`
- The canonical inventory: `docs/ocr/source-screen-inventory.md`
- The canonical manual benchmark: `research/OCR-SS/Manual OCR benchmark for verification V2.md`

Round 1 is the most concrete source on the current codebase, failure modes, and schema constraints. Round 2 is the strongest source on external production analogues and on what the public evidence does not support. Round 3 is the cleanest architectural frame. This synthesis therefore uses Round 1 as the operational ground truth, Round 2 as the reality check, and Round 3 as the architectural scaffold.

The core conclusion is blunt: the redesign should remain a two-pass system, but Pass 1 must stop being a brittle gate and become a probabilistic segmenter, while Pass 2 must stop collapsing immediately to final rows and instead emit typed field evidence into a promotion gate. The product is not “OCR output.” The product is a constrained evidence system that promotes only when the evidence is good enough.

## 1. CONVERGENCES AND DISAGREEMENTS

The three rounds converge on the shape of the redesign more than they initially appear to.

The first convergence is the overall two-pass shape. Round 1 says the current two-pass architecture is not wrong in concept, but that it “conflates segmentation with classification” and silently drops real segments because hard labels are run-length compressed too early (Round 1, §2.1, §4.3). Round 2 explicitly says “don’t replace the two-pass shape; harden Pass 1” and treats two-pass as the consensus production pattern for this class of pipeline (Round 2, §2, §11). Round 3 independently reaches the same result: probe first, decode screen states, then run typed extraction on selected frames rather than on the whole video (Round 3, Executive summary; Round 3, “Recommended architecture for this pipeline”). There is no real disagreement here. The design issue is not whether there should be two passes. The design issue is that Pass 1 currently behaves like a brittle rejector instead of a probabilistic routing layer.

The second convergence is that VLMs should not be the primary runtime OCR path. Round 1 rejects an end-to-end VLM extractor on cost, debuggability, and numeric hallucination grounds (Round 1, §8). Round 2 is more explicit and harsher: the public benchmark evidence does not support end-to-end VLM OCR for a 98% per-field target, and Claude Opus 4.7’s reported 0.09% CC-OCR hallucination rate is good enough only to justify VLM use as an arbiter on low-confidence cases, not as the main extractor (Round 2, §3.6, §8, §11). Round 3 lands in the same place from the literature side: VLMs are useful for offline adjudication, calibration assistance, and template authoring, but not as the hot-path extractor for numerically dense, UI-drifting video OCR (Round 3, Executive summary; Round 3, “What I would not recommend”). This is a clean convergence. Claude-class vision is a candidate arbitration tool, not the backbone of production runtime.

The third convergence is confidence retention, calibrated abstention, and cross-frame consensus. Round 1 rejects a full schema-wide probabilistic rewrite, but still argues that the real wins are upstream classification fixes and downstream consensus across many frames of the same view rather than single-frame hard decisions (Round 1, §4.4, §4.7, §7.6). Round 2 is more explicit in schema terms and recommends emitting per-field value, confidence, and evidence frames, with promotion gated by confidence or consensus (Round 2, §4, §10). Round 3 goes further and makes this the center of the architecture: every extractor emits n-best hypotheses, calibrated confidence, provenance, and observability; promotion occurs only after temporal and cross-screen validation (Round 3, “Recommended architecture,” “The truth system”). The exact representation differs, but the operational idea is unanimous: stop collapsing too early, keep uncertainty, and abstain when observability is insufficient.

The first real disagreement is the role of the EA API. Round 1 calls EA-API anchoring the highest-leverage move because it shrinks the OCR success criterion from roughly 2,550 fields per match to roughly 1,000 OCR-unique fields, especially by removing base player stats from the OCR critical path (Round 1, §4.6, §4.7). Round 2 does not dispute the leverage today, but brings in the missing external reality: previous community projects died on EA API churn or decommissioning, and the public community evidence implies an empirical half-life on the order of 3 to 5 years (Round 2, §1.2 EASHL bullet list; Round 2, §6, §11). Round 3 barely mentions the API except as one weak-supervision or validation source because it frames the redesign more abstractly as a truth-and-evidence system (Round 3, “The truth system”). The right adjudication is not to “pick API” or “pick OCR.” The right adjudication is to separate authority from dependency. Round 1 wins on present-tense leverage: for NHL 26 operations, the EA API should be authoritative for the subset of fields it actually covers. Round 2 wins on architectural posture: the system must not be structurally dependent on the API existing forever. Therefore the redesign will use the EA API as a current authority source and validation source, but the OCR evidence layer will remain capable of representing the same semantic fields independently. That means the canonical authority map uses the API where available now, while the storage model and extractor contracts do not assume that availability is permanent.

The second disagreement is whether expanding match-250 V2 from 60 assertions to around 300 assertions is a prerequisite, or whether weak supervision is the real scaling path. Round 1 is right that the current benchmark is structurally inadequate: only the lineup subset is executable, while the remaining inventory sits inert in markdown, which means major regressions would not fail the build (Round 1, §2.8, §5). Round 3 is also right that full manual hand-keying is not the scalable answer, and that the long-run truth system must be Gold/Silver/Triage with weak supervision and disagreement-driven labeling rather than brute-force full-match annotation (Round 3, “The truth system”). This is not a real either-or. Round 1 wins for the immediate prerequisite. Round 3 wins for the long-term system. The concrete decision is: expand match 250 to a materially broader Gold executable benchmark before architectural migration, but do not expand by hand-keying many full matches. Use one expanded canonical Gold match, then use weak supervision plus selective annotation to scale.

The third disagreement is the L1 segmentation/classification strategy. Round 1 argues for replacing the current HSV-plus-anchor gate with a small learned classifier such as a tiny CNN or CLIP-style head because the single-prototype HSV centroid is a dead end for visually multimodal classes like loadout cards (Round 1, §4.5, §7.8). Round 3 instead centers the design on HMM/Viterbi decoding over multiple per-frame signals, including color, anchor presence, quality cues, and possibly lightweight embeddings (Round 3, “Recommended architecture”). Round 2 effectively bridges the two by endorsing Snorkel-style weak supervision and classifier hardening, while also arguing that two-pass should survive but Pass 1 must become more robust (Round 2, §5, §9, §11). The correct adjudication is again synthesis, not menu selection: Round 3 wins on the segmenter, Round 1 wins on the emission model. The redesign should use an HMM/Viterbi state decoder, but the per-frame emissions feeding that decoder should include a learned lightweight classifier rather than raw HSV cosine alone. That lets the system keep temporal structure and legal transitions while discarding the current single-PNG-per-class shortcut.

Decision: preserve the two-pass shape; treat the EA API as current authority but not permanent infrastructure; expand match 250 into a true Gold benchmark before migration; and implement Pass 1 as an HMM/Viterbi segmenter whose emissions include a learned small classifier plus anchor and quality signals.

## 2. ARCHITECTURE SPEC

The architecture should be implemented as five explicit stages with typed contracts between them. The key correction relative to the current pipeline is that each stage must emit an inspectable artifact rather than pushing directly into the next step with hidden heuristics. Round 3 provides the best top-level scaffold for this layered shape, and Round 1 provides the concrete current failure cases this layering must eliminate (Round 3, “Recommended architecture”; Round 1, §2, §4, §7).

Stage A is video probing. Input is a match video plus match metadata already known outside OCR: source file path, capture resolution, inferred game version from the existing per-version config flow, and any EA-side match identifier already available from ingest. Output is a `probe_frame` collection containing frame timestamp, resized probe image reference, blur score, entropy score, anchor-text hits, lightweight image embedding, learned screen logits, and any screen-specific keypoint detector outputs. Sampling is variable by coarse phase, not globally constant: the pre-game window needs denser probing than the static post-game screens because Round 1 showed that 1 fps is intrinsically too sparse for loadout traversal (Round 1, §2.2, §4.7).

Stage B is state decoding and segmentation. Input is the ordered `probe_frame` stream. Output is a `decoded_segment` collection where each segment has `segment_id`, `state`, `t_start`, `t_end`, `frame_count`, `segment_confidence`, and `observability_status`. The decoder is an HMM/Viterbi sequence model over legal screen states. This stage is where the system stops making one-frame decisions. It sees weak per-frame evidence and emits the most likely legal state path over time. That directly addresses Round 1’s “1,230 frames looked like loadout by color but only 2 survived as accepted loadout segments” pathology, because the decoder can down-weight isolated or contradictory frames without discarding the whole sequence, and it addresses box-score tab reachability by decoding distinct tab states instead of one generic box-score class (Round 1, §2.1, §3.5, §4.3, §7.2).

Stage C is frame selection and registration for stable segments. Input is each non-HUD `decoded_segment`. Output is a `segment_frame_bundle` containing a small set of chosen frames, their per-frame quality scores, their registration transforms to a screen template, and a segment-level template assignment. Stable screens here include pre-game lobby, player loadout view, player summary, box-score tabs, post-game events, action-tracker list, faceoff map, and net chart. The contract is explicit: extraction downstream runs on bundles, not raw segments. The frame selector chooses the best few frames within each segment or sub-segment after filtering out motion blur, animated transitions, and obstructed anchors. Round 3 argues for best-frame selection plus multi-frame voting on stable screens; Round 1 shows why this is necessary, because the current parsers are doing rescue work that should have happened before extraction (Round 3, “Recommended architecture”; Round 1, §2.4).

Stage D is typed extraction. Input is either a `segment_frame_bundle` for stable states or a tracked ROI stream for the in-game HUD branch. Output is a normalized `field_evidence` collection. Each row in `field_evidence` is one claim about one semantic field from one extractor family against one frame or consensus bundle. Required columns are: `match_id`, `segment_id`, `screen_state`, `screen_instance_key`, `field_key`, `field_family`, `candidate_value`, `candidate_rank`, `raw_confidence`, `calibrated_confidence`, `support_frame_ids`, `roi_bbox`, `template_version`, `extractor_family`, `extractor_version`, `observability_status`, and `normalization_status`. For table-like extractions, there should also be `row_key` and `column_key`; for geometry-like extractions there should be `x_norm`, `y_norm`, and `shape_or_icon_class`; for entity-bearing rows there should be `subject_slot_key` when the field belongs to a player slot or event row. This contract is the heart of the redesign because it creates a durable layer between noisy extraction and canonical relational promotion. Round 2 and Round 3 both explicitly call for value-plus-confidence-plus-provenance emission; Round 1 provides the schema pain that justifies doing it (Round 2, §4; Round 3, “Recommended architecture”; Round 1, §7.7).

Stage E is validation, consensus, and promotion. Input is the `field_evidence` collection plus current authoritative side inputs: EA API payload where present, cross-screen invariants, and truth-system expectations. Output is a `promoted_fact` collection and then canonical Postgres writes. This stage groups evidence by semantic target, resolves competing candidates, checks invariants, and either promotes, abstains, or triages. Promotion contracts differ by field class. A one-of-N closed-vocabulary field such as position or build class requires one dominant candidate above threshold and no conflict with peer fields. A player-summary stat row can be promoted if row identity is resolved and the row passes numeric sanity against authoritative sources. An event can be promoted if its clock, period, type, and participants cohere across screens or if one screen is authoritative for missing attributes. The important point is that promotion is not “the parser returned JSON.” Promotion is an explicit gate.

There should also be a parallel HUD branch rather than trying to force the HUD into stable-screen logic. That branch takes the decoded in-game interval, tracks the clock scoreboard ROI across gameplay frames, and emits typed evidence for clock, score, shots, and power-play or empty-net timer. Goal overlays become separate short-lived segments inside or adjacent to the gameplay interval and use their own typed extractors. Round 1 is explicit that in-game clock and goal overlays are completely unimplemented today; the redesign must not hide that under generic extraction language (Round 1, §1, §3.3, §7.2).

Decision: implement the redesign as five explicit artifact-producing stages: probe frames, decoded segments, frame bundles, typed field evidence, and promotion outputs, with a separate in-game HUD branch rather than a single generic OCR path.

## 3. AUTHORITY MODEL

Round 1 correctly identifies the authority model as the highest-leverage architectural move because it changes what OCR is actually required to prove (Round 1, §4.6). The mistake would be to overcorrect and make the OCR system conceptually subordinate to the API. The right model is per-field authority, not per-pipeline authority.

The EA API should be authoritative for match metadata and player aggregate stats when it provides those fields. That includes match identity, club identity, known roster identities on the EA side, and player-level totals such as goals, assists, shots, hits, PIM, and similar aggregates that the current data model already stores from EA-side ingestion. This follows Round 1’s leverage argument and Round 2’s observation that the EASHL community is universally API-anchored for the fields the API exposes (Round 1, §4.6; Round 2, §1.2 EASHL bullet list; Round 2, §6). In these cases OCR is not the primary source of truth. OCR acts as reconciliation, augmentation, and future contingency.

OCR should be authoritative for everything the EA API does not supply in the current system of record. That includes loadout-specific data such as build class, handedness, X-Factors, attribute values, attribute delta chips, and the full player-loadout snapshot structure; chart geometry such as action-tracker x-y event locations, faceoff-dot breakdowns, and net-chart shot-type breakdowns; screen-local textual structures such as post-game event rows when they contain attributes absent from the API; and in-game overlays such as the gameplay scoreboard state at a specific timestamp. Round 1 is explicit that these are the hard fields remaining after EA reduction, and Round 2 confirms that the community API does not solve them (Round 1, §4.6, §5; Round 2, §6).

Manual truth should be authoritative for calibration and override, not for regular production ingestion. That means Gold benchmark rows, adjudicated Triage items, and deliberate manual corrections all outrank OCR and EA when they exist. Round 3’s Gold/Silver/Triage system provides the right framing here: manual truth is not a batch fallback for whole seasons; it is the top of the authority stack for benchmark and override records (Round 3, “The truth system”).

The subtle but important decision is how to handle fields that can be inferred from multiple sources but are not equally reliable. Goal events are the best example. EA aggregate stats may tell you that a player had two goals and one assist, but they do not replace the event timeline. The post-game events screen contains scorer and assist rows, but can omit penalties in some matches or require remaining-time conversion. The action tracker has better event-to-geometry links but weaker infraction text. The in-game goal overlay is temporally precise but only transiently observable. Therefore the authority model must be field-specific inside an event record. For a canonical match event:

- `period_number` and `clock_elapsed` are authoritative from the consensus event model built across OCR sources, with the HUD branch serving as the highest-timestamp-precision source when present.
- `event_type` is authoritative from OCR because the API does not provide event rows.
- `scorer_player` and `assist_players` are authoritative from post-game event screens, with in-game goal overlay as corroborating evidence, and action tracker as fallback where it carries the same actor.
- `x_norm` and `y_norm` are authoritative from action-tracker geometry only.
- Aggregate totals derived from events are checked against EA, but EA does not own the event row itself.

The same field-specific model applies to player identity. Round 2 is explicit that gamertag is the only stable practical identity anchor in this ecosystem and that blazeId-style identifiers are unreliable in public workflows (Round 2, §6). Therefore gamertag is the cross-source joining key at OCR time. EA-side identifiers remain valuable when present but are not the first join key in OCR evidence resolution.

The authority map also resolves an architectural tension in Round 1. Round 1 notes that player-summary rows are currently captured but intentionally dropped because EA already has the same data (Round 1, §3.4). That is sensible for canonical stat tables, but it is still useful to retain player-summary extraction evidence in the evidence layer, because it can validate EA ingest, detect API drift, and provide continuity if the API disappears. Therefore the redesign keeps those OCR claims in evidence storage even when they are not promoted as authoritative canonical aggregates.

Decision: use a three-level authority map where manual adjudication outranks all, the EA API is authoritative for the aggregate fields it currently covers, OCR is authoritative for all OCR-unique fields and event-local structures, and OCR evidence for EA-covered fields is still retained for validation and contingency rather than discarded.

## 4. STATE MACHINE + HMM/VITERBI SEGMENTER

The segmenter should model the UI as a legal state machine, not as isolated frame labels. Round 1 names the exact current failure modes this is meant to fix: loadout cards missed because 1 fps undersamples brief states, gameplay frames mis-scored as loadout by color alone, box-score tabs collapsed into one class, and state decisions depending on folder names or parser rescues instead of explicit temporal logic (Round 1, §2.1, §2.2, §3.5, §7.2, §7.3). Round 3 provides the right method: HMM/Viterbi over per-frame evidence with legal transition priors and minimum durations (Round 3, “Recommended architecture”).

The state set should be explicit and versioned. For NHL 26 the production state graph should include at least:

- `unknown_or_transition`
- `pre_game_lobby_state_1`
- `pre_game_lobby_state_2`
- `player_loadout_view`
- `loading_or_intro`
- `in_game_clock`
- `in_game_goal_state_1`
- `in_game_goal_state_2`
- `post_game_player_summary`
- `post_game_box_score_goals`
- `post_game_box_score_shots`
- `post_game_box_score_faceoffs`
- `post_game_events`
- `post_game_action_tracker`
- `post_game_faceoff_map`
- `post_game_net_chart`
- `end_of_video`

The legal transitions should be constrained, not fully connected. `pre_game_lobby_state_1` and `pre_game_lobby_state_2` can alternate or self-loop. Either can transition to `player_loadout_view`. `player_loadout_view` can self-loop across slot changes and return briefly to a lobby state. Pre-game states can transition to `loading_or_intro`, which transitions into `in_game_clock`. `in_game_clock` can self-loop for long stretches and briefly transition into `in_game_goal_state_1`, which can transition to `in_game_goal_state_2` and then back to `in_game_clock`. After gameplay, `in_game_clock` can transition to `post_game_player_summary`, then into any post-game navigation state. The box-score tabs, events, action tracker, faceoff map, and net chart should be mutually reachable through post-game navigation with strong self-loop priors and moderate cross-tab priors. `unknown_or_transition` is allowed between any neighboring legal states but should carry a strong short-duration prior.

Minimum-duration priors should be encoded per state and versioned in YAML. These are not truths about hockey; they are decoder knobs and should stay configurable. The NHL 26 initial priors should be:

- `unknown_or_transition`: very short, typically less than 0.5 seconds
- `player_loadout_view`: short but real, starting around 0.4 to 1.0 seconds to reflect the sub-second slot traversal problem Round 1 identified
- lobby states: moderate, typically multiple seconds
- box-score tabs and player summary: moderate to long, typically several seconds
- action tracker / faceoff map / net chart: moderate to long, with self-loop strength high because the operator often dwells
- goal overlays: very short, with state-1 then state-2 succession preferred
- gameplay HUD: very long self-loop prior

The key is not the exact initial number. The key is that these priors are explicit, inspectable, and recalibratable per version rather than hidden in ad hoc parser fallback logic.

Per-frame emissions should be multi-signal. Round 1 is right that raw HSV cosine is not enough; Round 3 is right that the decoder needs richer emissions than one learned label (Round 1, §4.5; Round 3, “Recommended architecture”). Each frame should therefore contribute:

- lightweight learned screen logits from a small classifier
- anchor-text presence scores
- anchor-template match scores
- screen-specific keypoint or logo detections where useful
- blur / compression / occlusion quality scores
- optional low-dimensional image embeddings for nearest-template similarity

These signals should not be combined by hard rules before decoding. They should be normalized into emission likelihoods per state and passed into Viterbi.

This state machine also solves current known defects directly. The loadout problem is addressed by denser pre-game probing plus short-duration loadout priors. The gameplay-vs-loadout false positives are handled because the learned classifier and anchor signals will disagree with the color-only signal, and the long gameplay self-loop makes the decoder stay in `in_game_clock` unless the evidence really changes. Box-score tab reachability is fixed because the state graph contains the three tabs separately. Folder-name period determination is de-emphasized because period becomes a field extracted in downstream typed extraction, not an implicit state label or path assumption.

Decision: implement Pass 1 as a versioned HMM/Viterbi decoder over explicit NHL UI states, using learned classifier logits plus anchor and quality features as emissions, with configurable minimum-duration priors and legal transition constraints.

## 5. TYPED EXTRACTOR STACK

The redesign should use five extractor families and stop pretending that everything visible on screen is “text plus regex.” Round 3 makes the strongest architectural case for typed extractors, and Round 1 provides the empirical reason: the current parsers are overloaded with rescue heuristics because too many different perceptual tasks were forced through the same OCR path (Round 3, “Recommended architecture”; Round 1, §2.4).

The first family is open text. This covers unconstrained or weakly constrained strings such as club names, gamertags, persona names, and event actor names. The specific approach should be a modern sequence recognizer such as PARSeq-class decoding over template-aligned crops, with n-best output retained rather than collapsed immediately. Round 3 specifically names PARSeq and TrOCR-class recognizers for open text; Round 2 is aligned that RapidOCR-style OCR remains the production core, not a VLM (Round 3, “Recommended architecture”; Round 2, §3, §11). The design choice here is to use open-text OCR only where the value space is genuinely open.

The second family is closed vocabulary. This covers position, platform, build class where the roster of possible classes is finite, X-Factor names, X-Factor tier labels, post-game category labels, period labels, and special-teams state labels. The specific approach should be constrained classification, not OCR. For position, use a small softmax classifier over the known position set after template alignment. For platform, classify the icon or label directly. For build class and X-Factor name, use per-crop closed-set classifiers keyed off the known NHL 26 vocabulary. For tier labels such as All Star, Elite, and Specialist, use small crop classifiers or closed-set text recognition rather than full open OCR. This is directly responsive to Round 1’s concern that lobby and loadout parsers are doing too much brittle regex and color rescue work, and it follows Round 3’s recommendation to formulate closed-vocabulary problems as constrained classifiers instead of OCR-plus-regex (Round 1, §2.4; Round 3, “Recommended architecture”).

The third family is tabular numerics. This covers the loadout attributes grid, delta chips, player-summary stat rows, box-score period cells, faceoff-zone summaries, and net-chart numeric summaries. The specific approach should be anchor-aligned cell extraction with per-cell numeric OCR plus cross-cell constraints. For pure digits, use a recognizer specialized for short numeric strings rather than a general text model. For delta chips, do not rely on tiny full-frame OCR rescans the way the current parser does; align the cell, crop the chip, classify sign separately if needed, then OCR the magnitude. Round 1’s `_rescan_delta_chip` example is the exact anti-pattern to retire here (Round 1, §2.4). Promotion from this family should also use arithmetic checks: box-score period totals must sum correctly, faceoff dot totals must reconcile with faceoff summary, and net-chart shot-type totals must reconcile with total shots when the screen is observable.

The fourth family is icons and symbols. This covers X-Factor icons, captain/leader markers, CPU or empty-slot markers, and possibly some event marker chips where the semantics are iconographic. The specific approach should be small CNN classifiers on template-aligned crops. Round 1 explicitly floated a small learned classifier as the right kind of replacement for the brittle current gate, and the same logic applies at the icon level (Round 1, §4.5). These symbols are not text. Treating them as text is unnecessary damage.

The fifth family is chart geometry. This covers action-tracker event markers on the rink map, faceoff-dot map counts after map alignment, and net-chart shot markers if those are later brought into scope. The specific approach should be anchor-aligned geometric reading. First detect and align the rink or map template. Then detect marker centroids, color or fill state, and shape class. For action tracker, resolve the selected orange event marker as the authoritative `x_norm` and `y_norm` for the highlighted event row, while also storing the full set of detected markers for cross-checking. For faceoff map, read the numeric cells and use geometry only for dot localization if needed. For net chart shot locations, Round 1 and the manual benchmark are both clear that this area is currently under-instrumented and even the manual V2 left X/Y blank, so only the stat rows belong in minimum viable scope; shot-dot geometry should be phase two if pursued (Round 1, §1, §3.9; Manual OCR benchmark V2, Net Chart sections).

This typed stack implies screen-by-screen extractor combinations. Lobby uses closed-vocab plus open text plus icons. Loadout uses closed-vocab, open text, tabular numerics, and icons. Events list uses open text plus tabular numerics under row structure. Action tracker uses open text, tabular numerics, and chart geometry. Faceoff map uses tabular numerics and limited geometry. Net chart in minimum scope uses tabular numerics only.

Decision: adopt a five-family extractor stack: PARSeq-class open text, constrained classifiers for closed vocabulary, anchor-aligned numeric cell OCR for tables, small CNNs for icons, and anchor-aligned geometry reading for maps and marker screens.

## 6. FIELD EVIDENCE RECORD + PROMOTION GATE

The redesign needs an intermediate schema between extraction and canonical Postgres tables. Round 2 and Round 3 both say this explicitly, and Round 1 shows why the current promoter-layer dedup is too late and too fragile (Round 2, §4; Round 3, “Recommended architecture”; Round 1, §7.7).

The minimum schema should include three new tables or table families.

The first is `ocr_segments`. This stores the output of Pass 1 decoding: one row per decoded screen segment or HUD interval, with state, timestamps, segment confidence, version, and observability flags. This turns “what screen did the system think it was looking at?” into a queryable fact.

The second is `ocr_field_evidence`. This is the main intermediate record. One row represents one candidate claim about one semantic field from one extractor invocation. It stores segment reference, screen state, semantic field key, screen instance key, subject slot or row key where applicable, candidate rank, normalized candidate value, raw and calibrated confidence, provenance frames, ROI, extractor family, extractor version, and observability. This table is append-only for a run. It is where competing hypotheses and multiple source screens coexist.

The third is `ocr_promotions`. This stores the result of consensus and promotion: promotion target table, target semantic key, winning candidate, winning confidence, evidence count, conflicts detected, blocking reason if not promoted, and the chosen authority source. This table exists because “not promoted” is itself a result that must be inspectable.

Promotion should fire per semantic entity, not per screen dump. A player-loadout snapshot promotion fires when enough evidence exists to resolve one slot identity and its associated attributes from the loadout screen bundle. An event-row promotion fires when event identity is resolved and required fields reach threshold. A faceoff summary row promotion fires per period per side. This is materially different from the current pattern where a screen parser emits a large JSON object and a promoter does table writes directly.

Promotion should be blocked by four classes of conditions:

- insufficient observability: required screen not captured, too brief, occluded, or unreadable
- insufficient consensus: no dominant candidate or conflicting high-confidence candidates
- violated invariants: period totals do not reconcile, impossible transitions, row identity collision
- authority conflict: an OCR claim contradicts a stronger authoritative source without meeting override rules

The existing `player_loadout_snapshots.source_extraction_id` versus `ocr_extraction_id` inconsistency has to be handled here deliberately. Round 1 confirms this mismatch and calls out the cost of keeping it (Round 1, §2.7, §7.1). The redesign decision should be to standardize on `ocr_extraction_id` semantically across the evidence and promotion layers, while keeping an adapter in the loadout promoter until a migration renames `source_extraction_id`. Do not infect the new evidence schema with the old inconsistency. Keep the inconsistency isolated at the final write boundary until a DB migration resolves it.

This section also resolves where cross-screen dedup belongs. It should not live only inside the event promoters. Event identity matching should happen in the promotion gate against evidence groups, where period, clock normalization, actor candidates, and geometry can all participate before a canonical row exists. That is the architectural fix for Round 1’s complaint that dedup currently happens too late and is sensitive to insertion order (Round 1, §7.7).

Decision: insert a first-class intermediate layer with `ocr_segments`, `ocr_field_evidence`, and `ocr_promotions`; standardize new audit references on `ocr_extraction_id`; and move cross-screen identity resolution into the promotion gate rather than burying it inside downstream per-table promoters.

## 7. IN-GAME HUD BRANCH

Round 1 is unequivocal that the in-game clock and goal overlays are completely unimplemented today, despite representing roughly 600 fields per match in the inventory (Round 1, §1, §3.3, §7.2). The redesign should not treat this as a later nice-to-have. It requires a separate branch because it is a different problem from stable post-game screens.

The HUD branch begins when the segmenter enters `in_game_clock`. From that point, the system tracks a small HUD ROI rather than doing full-frame OCR. The tracked ROI should include away abbreviation, home abbreviation, away score, home score, away shots, home shots, game clock, period, and special timer if present, exactly matching the source inventory (source-screen-inventory.md, In Game Clock section). The extraction cadence should be materially higher than the stable-screen branch because the data is truly changing over time. The exact runtime rate can be tuned later, but the architecture must assume continuous temporal evidence, not one still per segment.

Goal overlays should be modeled as transient sub-states with their own ROI definitions and extractors. State 1 contains team logo, scorer, stat, amount, time, and period. State 2 contains team logo, primary assist, secondary assist, stat, time, and period (source-screen-inventory.md, In Game Goal sections). These overlays should produce event-local evidence rows keyed by approximate timestamp and then reconcile with post-game Events and Action Tracker in the promotion gate.

The HUD branch should also own temporal smoothing rules. Score cannot decrease. Shots should not decrease absent a hard reset at state transition. Period follows a legal sequence. Power-play or empty-net timer can appear and disappear. Goal overlays imply score changes and can be used to anchor event timing even if later event screens are partially missing. This is exactly the kind of constrained temporal logic Round 2 surfaced from broadcast-scoreboard practice and that Round 3 framed as the natural home of typed HUD extraction (Round 2, §1.1, §10; Round 3, “Recommended architecture”).

This branch must also emit observability. If the gameplay recording omits some overlays or uses cuts where the HUD is absent, the result should be explicit `not_observable_from_source`, not a guessed timeline. Round 3 is emphatic that observability needs to be first class, and the HUD branch is where that matters most because the raw field count is large and the temptation to interpolate is high (Round 3, Executive summary; Round 3, “The truth system”).

Minimum viable scope for the HUD branch is the clock scoreboard and the goal overlay text payload. It does not need to solve every possible gameplay overlay before the redesign proves itself. But it does need to exist as a branch with its own tracked ROI contracts from the start, because pretending that the stable-screen branch will absorb it later is how it stayed unimplemented.

Decision: create a dedicated in-game HUD branch that tracks a scoreboard ROI continuously during gameplay, extracts clock/score/shots/period/timers at gameplay cadence, treats goal overlays as transient dedicated states, and emits explicit observability rather than inferred completeness.

## 8. TRUTH SYSTEM

Round 3’s Gold/Silver/Triage model is the right long-run truth system, but Round 1 is right that the current benchmark foundation is too weak to support a safe migration (Round 3, “The truth system”; Round 1, §2.8, §5). The redesign should therefore operationalize a three-tier truth system with one immediate benchmark expansion and then a hard pivot away from full-manual scaling.

Gold should store three things, not one. First, promoted match-level truth for benchmark matches. Second, frame-interval observability truth by screen family. Third, ROI-localized field truth for hard extractor families such as build class, X-Factors, event rows, and geometry-linked screens. Gold is not just “the final correct spreadsheet.” It is the set of labeled artifacts needed to diagnose where a redesign fails. This is directly aligned with Round 3’s recommendation that Gold include segment boundaries, observability, and ROI-localized truth, not only final values (Round 3, “The truth system”).

Silver should store machine-constructed labels backed by weak supervision. Sources for Silver include cross-frame consensus, agreement between extractor families, agreement with EA aggregates where applicable, legality constraints, arithmetic invariants, and high-confidence stable OCR reads. Round 2 explicitly recommends a Snorkel-style label model with EA cross-checks and structural rules as labeling functions (Round 2, §5, §11). Round 3 provides the broader weak-supervision rationale. Silver is the scaling layer, not Gold.

Triage should store uncertain or high-value disagreements only. The unit of triage is a crop, row, segment boundary, or small evidence cluster, not a whole match. That is again straight from Round 3, and it is the only operationally sane path for a single maintainer (Round 3, “The truth system”).

The active-learning queue should be fed by disagreement, not by coverage gaps alone. The highest-value queue items are:

- high-confidence disagreements between two extractor families
- OCR evidence that conflicts with EA authority on an aggregate-backed field
- low-consensus closed-vocabulary classifications such as build class or X-Factor
- segment boundaries where the HMM and anchor evidence disagree
- event rows where Actions and Events screens fail to reconcile
- geometry-linked action-tracker rows whose selected orange marker does not map cleanly

Disagreement detection should be formalized in the evidence layer. If two candidate values for the same semantic field both exceed a calibrated confidence floor and neither dominates, the field is triaged. If a canonical aggregate implied by promoted events contradicts an authoritative EA total, the relevant upstream evidence cluster is triaged. If a state expected from workflow never appears in the decoded segment sequence, the absence itself enters the triage queue as an observability or recording-protocol issue.

This is the place to adjudicate the match-250 expansion question concretely. The correct modification to Round 1’s claim is: yes, expand match 250 well beyond 60 assertions before migration, but do not chase “full V2 as executable truth for every match.” The best target is one expanded Gold benchmark match with roughly 300 or more executable assertions spanning the major screen families that currently lack automated protection: events, box score, faceoff map, net-chart numeric rows, and a meaningful slice of action tracker. Round 1’s number is directionally correct as a prerequisite benchmark broadening. Round 3 is correct that the scaling system after that must be Silver and Triage, not more full-match hand-keying.

Tooling requirements are therefore concrete:

- a truth store separate from canonical stats tables
- a review UI for triage items at crop, row, and segment granularity
- benchmark scoring that separates observable, unobservable, and wrong
- a queue generator driven by evidence disagreement and invariant failure

Decision: operationalize a three-tier truth system where Gold is a small but much richer executable benchmark set, Silver is weakly supervised at scale, Triage is disagreement-driven at crop or row granularity, and match 250 is expanded once as a prerequisite Gold anchor rather than as the template for all future labeling.

## 9. CALIBRATION LOOP FOR NHL 26 → 27

The redesign should preserve the existing per-version YAML approach, but move more of the visually unstable system into versioned config and less into hard-coded parser logic. Round 1 already points at the current version-specific config structure and argues that NHL 27 must be a config refresh rather than a code rewrite (Round 1, §6, §8). Round 2 adds the critical warning that there is no published version-bump playbook for game-CV pipelines, which means this project has to be explicit and disciplined about its own one (Round 2, §7, §11). Round 3 provides the strongest conceptual model: stable semantic ontology plus versioned visual realizations (Round 3, “The calibration loop”).

The stable layer should include semantic field identities, canonical database schema, invariants, authority rules, evidence schema, and promotion logic. “Build class,” “goal scorer,” and “faceoff-dot count” do not become different concepts in NHL 27 just because the UI moves them.

The versioned visual layer should include:

- state graph priors and any changed menu-flow transitions
- anchor templates
- screen templates
- ROI maps
- closed-vocabulary class dictionaries where the visible label set changes
- icon atlases
- calibration thresholds for confidence and observability

These should live in per-version YAML or adjacent config artifacts rather than inside parser code. That is the direct continuation of the current version YAML approach, but with much more moved out of code.

A UI bump should trigger a defined recalibration workflow:

1. ingest 2 to 3 representative NHL 27 matches in permissive capture mode
2. run the NHL 26 decoder and collect over-inclusive candidate segments
3. cluster candidate frames by embedding and anchor signals to find changed screen families
4. approve or update anchors and ROI maps in NHL 27 config
5. run benchmark Gold matches or Gold-like NHL 27 fixtures through the pipeline
6. inspect confidence and disagreement concentrations
7. only retrain or fine-tune recognizers where drift is materially concentrated

What gets reused by default is the ontology, the evidence schema, the promotion logic, most open-text recognizer weights, and the truth-system tooling. What gets re-keyed by default is anchor geometry, screen templates, and the closed-set icon or label dictionaries that visibly changed. Round 3 is explicit that open-text recognizers usually should not be retrained from scratch every year; collect disagreement and low-confidence cases first, then adapt surgically if necessary (Round 3, “The calibration loop”).

This section also matters for observability and audit. Every evidence row and every decoded segment should carry `ui_version`. Round 1 notes that version is in the segments artifact flow today but not fully surfaced in the DB row model; the redesign should fix that as part of the new evidence schema rather than later (Round 1, §6).

Decision: keep a stable semantic ontology and canonical schema across versions, version all visually unstable assets in per-version YAML-driven config, and treat NHL 27 recalibration as an anchor-and-template refresh with targeted recognizer adaptation rather than a parser rewrite.

## 10. MIGRATION PLAN

The migration plan has to respect two realities from Round 1. First, the current pipeline produces real data today. Second, match 250 and match 463 already matter as calibration anchors, and future matches cannot be sacrificed while the redesign is being built (Round 1, §1, §5). The redesign therefore has to land incrementally beside the current path, not by ripping it out.

Phase 0 is benchmark and schema preparation. Expand match 250 into a broader executable Gold benchmark. Create the new evidence-layer tables without changing canonical table writes. Add adapters so the current pipeline can, where feasible, backfill some evidence rows or at least populate segment metadata. This phase changes almost nothing in production behavior, but it creates the yardstick and storage the migration depends on.

Phase 1 is Pass 1 replacement only. Replace the current hard-label plus run-length Pass 1 with the HMM/Viterbi segmenter, but keep existing Pass 2 parsers and promoters. This is the smallest meaningful architecture cut because Round 1 shows that the biggest current systematic failure is segment capture, especially for loadout and box-score tab reachability (Round 1, §2.1, §2.2, §3.5). Success criteria for Phase 1 are: better loadout capture on unattended videos, distinct box-score tab routing, and no regression on match 250 post-game screens.

Phase 2 is evidence-layer insertion for one screen family. The minimum viable redesign slice should be player loadout view, not the whole pipeline. That is the right proof slice because it is both high-value and where the current architecture is most obviously broken by capture rate rather than OCR recognition quality (Round 1, §3.2). Build frame bundles, typed extractors, and promotion gate just for loadout snapshots. Write canonical loadout rows from the new path while the rest of the pipeline still uses legacy promoters. This proves the architecture on the screen family that most needs it.

Phase 3 is post-game stable screens through the new evidence layer. Migrate box score, events, player summary evidence retention, faceoff map, and net-chart numeric summaries one family at a time. Keep canonical table contracts stable where possible. Use the new promotion gate for cross-screen event identity instead of the legacy promoter-level dedup once both Events and Action Tracker have been migrated.

Phase 4 is the in-game HUD branch. This should come after the stable evidence path is proven, because it is a separate branch and should not delay the core architecture. But it must still be part of the redesign, not a deferred forever item.

Phase 5 is decommissioning. Retire legacy run-length segmentation, HSV-cosine gating, and screen-family parsers that are now duplicated by typed extractors. Keep only the legacy components still needed as fallback until their replacements match or exceed performance.

The minimum viable redesign is therefore very specific: HMM/Viterbi Pass 1 plus the player-loadout evidence path from segment selection through promotion. That slice proves the architecture on the most notorious current failure mode, exercises the new evidence schema, touches the authority model because loadout is OCR-only, and does not require solving the HUD branch first.

Match preservation during migration should work like this:

- match 250 remains the primary Gold benchmark and should be rerunnable through both pipelines
- match 463 remains the primary unattended-ingest stress case, with observability-aware scoring
- future matches continue to ingest through the current production path until each new screen family path is proven
- backfill into the new evidence store can happen without overwriting canonical data until confidence is sufficient

Decision: migrate in phases beside the current pipeline, starting with benchmark broadening and Pass 1 replacement, then proving the new architecture on player loadout view as the minimum viable redesign before moving stable post-game families and finally the HUD branch.

## 11. EFFORT ESTIMATE

Round 3 estimates roughly 275 to 620 hours for the full redesign stack it proposes (Round 3, “Honest tradeoffs against the current design”). That number is directionally useful, but it should be adjusted upward modestly for two reasons surfaced elsewhere in the rounds.

The first upward adjustment comes from Round 1’s accidental complexity inventory. The current system does not merely lack models. It contains scattered rescue heuristics, schema inconsistencies, unreachable code paths, and dedup logic in the wrong layer. Untangling that while preserving current production behavior will take real integration time that a greenfield architecture table does not fully price in (Round 1, §2, §3.5, §7.1, §7.7).

The second upward adjustment comes from Round 2’s caveat that there is effectively no published version-bump playbook for this exact class of game-CV system, and no public benchmark that truly matches stylized game-UI digit OCR at this target accuracy (Round 2, §7, §11). That means calibration tooling and evaluation discipline are not optional polish; they are first-party engineering work.

The estimate should also be rebalanced internally. Some elements in Round 3 are probably too broad for the first successful architecture cut, while others are underpriced because they require migration-safe integration with the existing worker and schema.

My adjusted estimate is:

- 40 to 70 hours for benchmark expansion, evidence schema, and migration scaffolding
- 40 to 80 hours for HMM/Viterbi Pass 1 with learned-emission integration and versioned priors
- 50 to 90 hours for player-loadout typed extraction and promotion
- 80 to 150 hours for stable post-game screen-family migration through the evidence layer
- 40 to 80 hours for the HUD branch minimum viable implementation
- 50 to 110 hours for truth tooling, disagreement queueing, and calibration reporting
- 30 to 70 hours for decommissioning, cleanup, and regression hardening

That yields a practical total of roughly 330 to 650 hours for a serious implementation if the scope is kept disciplined around the architecture specified here. If the project also attempts full net-chart shot-dot geometry extraction, aggressive closed-set model training for many icon families, or a polished human review UI from the start, the range moves higher, into roughly 400 to 750 hours.

The lower end assumes tactical reuse of current ROI knowledge and that the minimum viable redesign stops short of every long-tail screen nuance. The upper end assumes the real migration tax and truth tooling tax are both paid properly. Given the current codebase condition described in Round 1, quoting the bottom of Round 3’s original range as the likely total would be dishonest.

Decision: budget the redesign at roughly 330 to 650 hours for the disciplined architecture described here, with 400 to 750 hours as the realistic range if truth tooling and hard long-tail extractors are pursued in the same push.

## 12. WHAT GETS DROPPED

Some things should be explicitly retired rather than “kept around just in case.”

The single-prototype HSV-cosine classifier should be dropped as the primary screen discriminator. Round 1 is explicit that calibrating one centroid from one PNG per class is structurally wrong for multimodal classes like loadout cards, and Match 463 demonstrates the failure mode (Round 1, §2.3, §7.8). Color can remain as one weak emission feature in Pass 1, but the current classifier design should not survive as a first-class decision maker.

The hard per-frame label plus run-length segmenter should be dropped. It is the wrong abstraction for noisy screen transitions and the direct cause of silent segment loss. Replace it with HMM/Viterbi sequence decoding. Keep no sentimental attachment to the old run-length thresholds.

Pixel-coordinate-only ROIs hard-coded in parser code should be dropped as the long-term calibration model. Round 1 and Round 3 converge on this: version-specific YAML and anchor-relative geometry are the path to surviving annual UI drift (Round 1, §6, §8; Round 3, “The calibration loop”). Absolute coordinates may still exist inside a per-version template definition, but not as scattered parser constants.

Parser-level rescue hacks that exist only because upstream routing is weak should be dropped as upstream replacements land. That includes the current style of tiny-chip full-frame rescans and layered sign inference around delta chips, plus the parser burden of rediscovering state or row structure that Pass 1 and frame bundling should already have resolved (Round 1, §2.4).

Promoter-layer cross-screen dedup as the primary event identity mechanism should be dropped. Cross-screen matching belongs in the promotion gate over evidence groups, not as insertion-order-sensitive logic split across event promoters (Round 1, §7.7).

Folder-path-derived period resolution should be dropped as a core assumption. Period should be extracted and validated as a semantic field. Path hints can remain as manual-ingest metadata, but they should not be the canonical determinant in a video pipeline (Round 1, §7.3).

The idea that player-summary OCR for EA-covered aggregate fields should be promoted directly into canonical stat tables should stay dropped, but the stronger correction is that captured-but-non-authoritative OCR evidence should no longer be discarded. Keep it in the evidence layer; do not promote it as authority when EA already owns the field.

The idea of using a general VLM as primary runtime OCR should be dropped. Round 2 and Round 3 are aligned that the public evidence does not justify it at this accuracy target, and Round 2’s Claude hallucination note only supports arbiter duty, not hot-path dependence (Round 2, §3.6, §8; Round 3, “What I would not recommend”).

Finally, the idea that full-match manual truthing is the scaling answer should be dropped. Keep Gold manual truth for a small benchmark core, then scale with Silver and Triage. That is the direct adjudication of Round 1 versus Round 3 on truth-system scale.

Decision: drop the HSV-cosine classifier as primary routing, drop run-length segmentation, drop code-hard-coded ROI ownership as the calibration model, drop parser rescue hacks that upstream stages should replace, drop promoter-layer event dedup as the main identity resolver, drop folder-path period assumptions, and drop both end-to-end VLM runtime OCR and full-match manual truthing as primary strategies.
