# Fixture Provenance — fixture_match250_full_lobby

## Structure (current — Phase 2A T1A real-data restructure)

```
fixture_match250_full_lobby/
├── frames/                           # 15 PNGs from real Pass-2 run (T1A gate)
│   ├── 00001.png … 00015.png
├── expected_loadout_evidence.json    # Real extractor output, 625 records × 11 subjects (loadout-evidence-v3)
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
The Python parity test lives at
`tools/video_ingest/tests/test_loadout_evidence_fixture_parity.py`.

> **Tier 0 re-baseline (2026-06-13).** The committed golden was regenerated from
> the current `loadout-evidence-v3` extractor (was a stale `loadout-evidence-v2`
> capture of **698 records / 25 subjects** with no `is_cpu` records). The fresh
> golden is **625 records / 11 subjects**, each subject now carrying an `is_cpu`
> field. Two behavioural deltas vs the old "9 subjects" description below were
> verified against the V2 benchmark before locking:
>
> - **subject09 `JoeyFlopfish` (BGM RD #48) is now captured.** The v2 note "JoeyFlopfish
>   is absent" is obsolete — the v3 extractor reads this slot (gamertag/position/jersey
>   all match V2: RD #48, persona "Lane Hutson"). This is a correctness _improvement_.
> - **subject10 `sikyjoker85` (LW, no jersey) is a known phantom.** This is a
>   mis-segmented duplicate of subject06 `silkyjoker85` (RW #10) — gamertag is one
>   character off, jersey/persona unreadable (`low_quality`). It is NOT in the V2
>   10-slot ground truth. The parity test does an exact key-set diff, so the golden
>   must include it to stay green; it is locked here as a _documented_ raw-extractor
>   artifact (same treatment as the StickMenace/DuhPope space artifacts below).
>   The promoter layer (junk-gamertag / hard-field blocks) is what keeps this phantom
>   out of canonical `player_loadout_snapshots`; suppressing it at the extractor /
>   frame-segmentation layer is Tier 1+ work, not Tier 0.
>
> The golden is regenerated via the canonical pipeline serializer
> (`json.dump([r.to_dict() for r in records], fp, indent=2)`, `pass2_extract.py:562`).

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

**Total records:** 625 across 11 subjects.
**Extractor version stamped:** `loadout-evidence-v3`

### Subjects extracted (subject00–subject10)

| subject_slot_key               | gamertag        | position | jersey | V2-match                                        |
| ------------------------------ | --------------- | -------- | ------ | ----------------------------------------------- |
| loadout_slot_seg0002_subject00 | MrHomiecide     | C        | 11     | V2: C, #11, captain ✓                           |
| loadout_slot_seg0002_subject01 | StickMenace     | LW       | 96     | V2: "Stick Menace" (space — known OCR artifact) |
| loadout_slot_seg0002_subject02 | HenryTheBobJr   | LD       | 7      | V2: LD, #7 ✓                                    |
| loadout_slot_seg0002_subject03 | XZ4RKY          | C        | 19     | V2: C, #19, captain ✓                           |
| loadout_slot_seg0002_subject04 | RAIDERSG7       | RW       | 7      | V2: RW, #7 ✓                                    |
| loadout_slot_seg0002_subject05 | shadowassault20 | RD       | 56     | V2: RD, #56 ✓                                   |
| loadout_slot_seg0002_subject06 | silkyjoker85    | RW       | 10     | V2: RW, #10 ✓                                   |
| loadout_slot_seg0002_subject07 | Duh Pope        | LW       | 95     | V2: "DuhPope" (no space — known OCR artifact)   |
| loadout_slot_seg0002_subject08 | MuttButt        | LD       | 23     | V2: LD, #23 ✓                                   |
| loadout_slot_seg0002_subject09 | JoeyFlopfish    | RD       | 48     | V2: BGM RD, #48 ✓ (v3 now captures this slot)   |
| loadout_slot_seg0002_subject10 | sikyjoker85     | LW       | —      | PHANTOM — mis-seg dup of subject06 (not in V2)  |

**JoeyFlopfish is now captured (subject09):** the v3 extractor reads this BGM RD #48
slot (the v2 capture missed it). All categorical fields match the V2 benchmark.

**subject10 `sikyjoker85` is a phantom:** a mis-segmented duplicate of subject06
`silkyjoker85` (RW #10) — the gamertag is one character off and jersey/persona are
unreadable. It is not part of the V2 10-slot ground truth and is excluded from the
canonical SQL. It is locked in the golden as a documented raw-extractor artifact
(the parity test is an exact-key regression lock); the promoter layer keeps it out
of canonical data. Suppressing it at the segmentation layer is Tier 1+ work.

### Known extractor artifacts vs V2 ground truth

| Field      | Subject   | Extractor value (v3) | V2 / DB canonical   | Action                                                              |
| ---------- | --------- | -------------------- | ------------------- | ------------------------------------------------------------------- |
| gamertag   | subject01 | `StickMenace`        | `Stick Menace`      | Fixture locks extractor behavior; PROVENANCE notes discrepancy      |
| gamertag   | subject07 | `Duh Pope`           | `DuhPope`           | Same — OCR added space                                              |
| gamertag   | subject10 | `sikyjoker85`        | (phantom)           | Mis-seg duplicate of subject06 `silkyjoker85` — locked + documented |
| is_captain | subject00 | `null` (low_quality) | `true` (V2)         | Extractor still cannot read the captain icon in this frame set      |
| is_captain | subject03 | `null` (low_quality) | `true` (XZ4RKY, V2) | Same                                                                |

> **v3 note:** subject00 `position`/`jersey`/`persona_raw` are now read (`C`, `#11`,
> `Evgeni Wanhg` — all `observable`), where the v2 capture had them `null`. Persona is
> likewise now captured for several opp subjects (e.g. subject03 `Toews`). Only the
> captain icon (`is_captain`) remains unread for subject00/subject03.

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

For most subjects, `attribute_deking_value` is `null` (low_quality). This appears to be a
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

  **Note:** The canonical SQL covers 10 slots including JoeyFlopfish (BGM RD).
  As of the v3 re-baseline the T1A fixture also captures JoeyFlopfish (subject09);
  the canonical SQL still excludes the subject10 `sikyjoker85` phantom. The canonical
  SQL is used by the T6A Node test, which uses the hand-authored `seg_bgm/` and
  `seg_opp/` evidence JSONs that include all 10 real slots.

---

## Fixture serves acceptance gates

- **T1A** (Python extractor parity): `test_match250_parity` runs extractor against
  `frames/`; compares output to `expected_loadout_evidence.json` (root level).
  Gate is ACTIVE when frames/ is populated (625 records, 11 subjects).

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
