# Fixture Provenance — fixture_match250_full_lobby

## Structure (current — Phase 2A T1A real-data restructure)

```
fixture_match250_full_lobby/
├── frames/                           # 15 PNGs from real Pass-2 run (T1A gate)
│   ├── 00001.png … 00015.png
├── expected_loadout_evidence.json    # Real extractor output, 602 records × 9 subjects
├── expected_canonical.sql            # V2-verified canonical rows, sentinel match 9001
├── seg_bgm/                          # Hand-authored evidence JSON (T6A/T2A/T8A Node tests)
│   ├── expected_loadout_evidence.json
│   └── frames/                       # Empty — T1A for seg_bgm skips silently
├── seg_opp/                          # Hand-authored evidence JSON (T6A/T2A/T8A Node tests)
│   ├── expected_loadout_evidence.json
│   └── frames/                       # Empty — T1A for seg_opp skips silently
└── PROVENANCE.md
```

The root-level `expected_loadout_evidence.json` and `frames/` are used by the
**Python T1A gate** (`test_loadout_evidence_fixture_parity.py::test_match250_parity`).

The `seg_bgm/` and `seg_opp/` hand-authored JSONs are used by the **Node T6A/T2A/T8A
gates** via `loadFixture('fixture_match250_full_lobby')` in
`apps/worker/src/__tests__/fixtures/loadout-fixture-loader.ts`.

---

## Source of truth — frames/

**Source video:** `/mnt/k/NHL/NHL26/2026-05-08_18-25-42.mkv`
(WSL: `/mnt/k/2026-05-08_18-25-42.mkv`)

**Pipeline run:** Phase 2A typed_v1 OCR pipeline, Pass-2 extraction.

**Content hash:** `a55b2ebfd01fc51e5ab825b779357b1367ed904c081558e79bc2903cb49f6088`

**Segment:** `seg-002-player_loadout_view` (15 frames: `00001.png` — `00015.png`)

**Run timestamp:** 2026-05-20 (approximate; frames from `/tmp/typed-v1-match250/`)

**segment_index used:** 2 (subject*slot_key prefix: `loadout_slot_seg0002*\*`)

---

## Source of truth — expected_loadout_evidence.json

**Authoring strategy (Option B):** Real extractor output used as the starting template.
Field values cross-checked against V2 benchmark (`apps/worker/src/__tests__/match-250-benchmark.test.ts`)
and production canonical DB rows for the fields V2 asserts. The extractor output
is the fixture — this test LOCKS the current extractor behavior.

**Total records:** 602 across 9 subjects.
**Extractor version stamped:** `loadout-evidence-v2`

### Subjects extracted (subject00–subject08)

| subject_slot_key               | gamertag        | position | jersey | V2-match                                        |
| ------------------------------ | --------------- | -------- | ------ | ----------------------------------------------- |
| loadout_slot_seg0002_subject00 | MrHomiecide     | —        | —      | V2: C, #11, captain                             |
| loadout_slot_seg0002_subject01 | StickMenace     | LW       | 96     | V2: "Stick Menace" (space — known OCR artifact) |
| loadout_slot_seg0002_subject02 | HenryTheBobJr   | LD       | 7      | V2: LD, #7 ✓                                    |
| loadout_slot_seg0002_subject03 | XZ4RKY          | C        | 19     | V2: C, #19, captain ✓                           |
| loadout_slot_seg0002_subject04 | RAIDERSG7       | RW       | 7      | V2: RW, #7 ✓                                    |
| loadout_slot_seg0002_subject05 | shadowassault20 | RD       | 56     | V2: RD, #56 ✓                                   |
| loadout_slot_seg0002_subject06 | silkyjoker85    | RW       | 10     | V2: RW, #10 ✓                                   |
| loadout_slot_seg0002_subject07 | Duh Pope        | LW       | 95     | V2: "DuhPope" (no space — known OCR artifact)   |
| loadout_slot_seg0002_subject08 | MuttButt        | LD       | 23     | V2: LD, #23 ✓                                   |

**JoeyFlopfish is absent:** only 9 subjects appear in the 15-frame bundle. JoeyFlopfish
(BGM RD, #48) was not navigated to in this recording segment.

### Known extractor artifacts vs V2 ground truth

| Field                         | Subject             | Extractor value        | V2 / DB canonical    | Action                                                         |
| ----------------------------- | ------------------- | ---------------------- | -------------------- | -------------------------------------------------------------- |
| gamertag                      | subject01           | `StickMenace`          | `Stick Menace`       | Fixture locks extractor behavior; PROVENANCE notes discrepancy |
| gamertag                      | subject07           | `Duh Pope`             | `DuhPope`            | Same — OCR added space                                         |
| is_captain                    | subject00           | `null` (low_quality)   | `true` (V2)          | Extractor cannot read captain icon in this frame set           |
| is_captain                    | subject03           | `null` (low_quality)   | `true` (XZ4RKY, V2)  | Same                                                           |
| position, jersey, persona_raw | subject00           | all null (low_quality) | V2: C, #11, E. WANHG | Extractor limitation for subject00 frames                      |
| persona_raw                   | subject03–05, 07–08 | null                   | V2: various          | Persona not captured for opp subjects                          |

### Per-field provenance

| Field category               | V2-verified?           | Notes                                                                |
| ---------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `gamertag` (candidate_value) | Mostly yes             | subject01/subject07 have known space artifacts                       |
| `position`                   | Yes (where observable) | subject00 is low_quality                                             |
| `jersey_number`              | Yes (where observable) | subject00 is low_quality                                             |
| `is_captain`                 | Not captured           | All null (low_quality) — this frame set does not expose captain icon |
| `build_class`                | Yes (canonical value)  | build_class_raw may differ from canonical                            |
| `x_factor_name_*`            | Yes (where observable) | Many subjects have initial null then observable in later ranks       |
| `x_factor_tier_*`            | Extractor-as-correct   | Tiers not V2-asserted; locked from extractor output                  |
| Attribute values (23 keys)   | Partial                | Values match canonical SQL for visible rows                          |
| Attribute deltas             | Extractor-as-correct   | Many null due to frame visibility; locked from extractor output      |
| `player_level_raw`           | Extractor-as-correct   | V2 asserts player_level_number (int), not raw string                 |
| `persona_raw`                | Partial                | V2 asserts canonical persona form; extractor captures raw OCR        |

### Attribute row notes

For ALL 9 subjects, `attribute_deking_value` is `null` (low_quality). This appears to be a
consistent OCR limitation with this frame set — the deking row is not reliably readable.
Consequently, `attribute_faceoffs_value`, `attribute_discipline_value`, and
`attribute_fighting_skill_value` extracted by the extractor reflect what is ACTUALLY at
those fixed pixel positions — they are NOT shifted from deking. The values differ from the
canonical DB rows (which were ingested via a different pipeline run / older extractor).

These differences are locked in the fixture as extractor-currently-correct for this frame set.

---

## Source of truth — expected_canonical.sql

- **Canonical rows** (`expected_canonical.sql`): copied verbatim from production
  `player_loadout_snapshots` + `player_loadout_x_factors` + `player_loadout_attributes`
  for `match_id=250` with `review_status='reviewed'`. Snapshot taken at git SHA
  `475b05b3295136333658dbe7fb1f6cef468db3cb` (2026-05-21). Ten rows: IDs 1445–1455,
  x_factors IDs 329–361, attributes IDs 2257–2509.

  These rows are V2-benchmark-verified — the 70 V2 assertions in
  `apps/worker/src/__tests__/match-250-benchmark.test.ts` lock all categorical
  fields + canonical X-Factor / build_class values for all 10 slots:
  - gamertag_snapshot (lineup test Family 1)
  - position (lineup test)
  - is_captain (lineup test — XZ4RKY=captain; DuhPope=NOT captain per V2)
  - build_class_canonical (lineup test)
  - x_factor_name_canonical[0,1,2] (lineup test)
  - height_text, weight_lbs, player_level_number (lobby fields Family 7)
  - player_name_persona (persona Family 1)

  Cross-checked 2026-05-21: queried DB directly, compared each field against
  the benchmark assertions, confirmed exact matches.

  **Note:** The canonical SQL covers 10 slots including JoeyFlopfish (BGM RD),
  even though JoeyFlopfish does not appear in the T1A fixture. The canonical SQL
  is used by the T6A Node test, which uses the hand-authored `seg_bgm/` and
  `seg_opp/` evidence JSONs that DO include all 10 slots.

---

## Fixture serves acceptance gates

- **T1A** (Python extractor parity): `test_match250_parity` runs extractor against
  `frames/`; compares output to `expected_loadout_evidence.json` (root level).
  Gate is ACTIVE when frames/ is populated (602 records, 9 subjects).

- **T6A** (Node promoter parity): `loadout-canonical-row-fixture.test.ts` promotes
  `seg_bgm/expected_loadout_evidence.json` + `seg_opp/expected_loadout_evidence.json`
  (hand-authored, 610 records, 10 slots) and asserts against `expected_canonical.sql`.

---

## Regeneration recipe

To regenerate `expected_loadout_evidence.json` and `frames/` after a pipeline change:

```bash
# 1. Re-run Pass-2 on the canonical test recording
python tools/video_ingest/cli.py ingest /mnt/k/NHL/NHL26/2026-05-08_18-25-42.mkv \
    --force-pass2 --out /tmp/typed-v1-match250-new/

# 2. Find the seg-002-player_loadout_view output
SEG=/tmp/typed-v1-match250-new/<hash>/pass2/seg-002-player_loadout_view

# 3. Copy frames
cp $SEG/*.png tools/game_ocr/calibration/extras/loadout/fixtures/fixture_match250_full_lobby/frames/

# 4. Replace expected JSON
cp $SEG/loadout_evidence.json \
   tools/game_ocr/calibration/extras/loadout/fixtures/fixture_match250_full_lobby/expected_loadout_evidence.json

# 5. Cross-check gamertags / positions against V2 benchmark and update PROVENANCE.md
# 6. Run T1A to confirm the new fixture passes:
source .venv-1/bin/activate
PYTHONPATH=tools/game_ocr:tools/video_ingest python -m pytest \
    tools/video_ingest/tests/test_loadout_evidence_fixture_parity.py::TestLoadoutEvidenceFixtureParity::test_match250_parity -v
```

---

## Sentinel IDs used (canonical SQL / Node tests)

| Sentinel            | Range       | Purpose                                             |
| ------------------- | ----------- | --------------------------------------------------- |
| `match_id`          | 9001        | Sentinel match to avoid FK conflicts with real data |
| `player_id` (BGM)   | 99001–99005 | Sentinel players (BGM side)                         |
| `snapshot.id`       | 90001–90010 | 10 loadout snapshot sentinel rows                   |
| `x_factor.id`       | 90100–90129 | 30 x_factor child rows                              |
| `attribute.id`      | 90200–90429 | 230 attribute child rows                            |
| `ocr_extraction_id` | 99999       | Placeholder (no FK enforcement in test DB)          |
