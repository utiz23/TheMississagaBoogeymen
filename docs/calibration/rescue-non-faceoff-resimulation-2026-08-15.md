# Rescue re-capture and semantic re-simulation — the 8 information-bearing non-faceoff windows (2026-08-15)

**Non-production audit.** Nothing was ingested, promoted, executed, or written. No
`--execute`, no `ingest-ocr`, no `reprocess`, no production promoter invocation, no database
write, no change under `/home/michal/ingest-cache`, no source-code change, no allowlist.
All generated frames, OCR JSON and simulation artifacts live under
`/tmp/rescue-resim-20260815/`.

**This is a NEW current-code audit.** It does **not** reproduce, recover, or corroborate the
deleted 2026-08-05 audit-v2 per-window labels. Those remain UNVERIFIED and unrecoverable
(see [`rescue-non-faceoff-exclusion-audit-2026-08-15.md`](rescue-non-faceoff-exclusion-audit-2026-08-15.md) §5).
Current-code OCR output may differ from the deleted 2026-08-05 outputs for any reason —
different repository HEAD, different ROI configs, different RapidOCR/onnxruntime versions,
different GPU/CPU execution provider. No claim of equivalence is made anywhere in this
document.

**Verdict: PARTIAL.** All eight windows were freshly captured, OCR'd and simulated end to end.
Seven produce a decisive current-code disposition; the eighth (2683) is decisive only about
the *pinned command*, not about the underlying frame content. One window is SAFE-TO-PROPOSE.

---

## 1. Scope, HEAD, configuration hashes, safety boundaries

### Repository and toolchain

| item | identity |
| --- | --- |
| repository HEAD | `540777a17daa9f5df428cf0ffab141a02314748b` (`main`), unchanged before and after |
| OCR interpreter | `tools/game_ocr/.venv/bin/python` — the exact `OCR_PYTHON` value in `.env`, i.e. the interpreter a production `ingest-ocr` would use |
| OCR entry point | `python -m game_ocr.cli extract --screen … --input … --output …` |
| `rapidocr_onnxruntime` | 1.4.4 |
| `onnxruntime-gpu` | 1.26.0 |
| det model | `models/ch_PP-OCRv4_det_infer.onnx` sha256 `d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9` |
| rec model | `models/ch_PP-OCRv4_rec_infer.onnx` sha256 `48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b` |
| cls model | `models/ch_ppocr_mobile_v2.0_cls_infer.onnx` sha256 `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c` |
| ROI `post_game_box_score_goals.yaml` | sha256 `781e9a9efc32976f23fc19eb84b56bb855adbce5e27b575b21db03c4d5fe9495` |
| ROI `post_game_box_score_shots.yaml` | sha256 `9d7deebf0281754d8868feede2313fa5fcc1c0328e1516018ba77702fee10cb3` |
| ROI `post_game_net_chart.yaml` | sha256 `45725ff7e489181fa292d3236f52edd4031dc25c8d4af0c0c95e8b4037785351` |
| ffmpeg | 6.1.1-3ubuntu5 |
| decoder version (declared by the manifest, **not** applied here) | `rescue-b2-anchor-v1` |

### Immutable inputs

| input | sha256 | role |
| --- | --- | --- |
| `/home/michal/ingest-cache/rescue-manifest.json` | `70b5bfbb…78ecc8` (schema 2, 303 windows, 97 auto) | promotion-key source of truth |
| `…/rescue-runs/rescue-b2-20260807T031344Z/rescue-manifest.schema3.json` | `f0727066…d33397` (schema 3, 303 windows) | **the manifest run 3 actually executed** — every run-3 receipt carries `manifest_sha256 = f0727066…` |
| `…/rescue-execution-allowlist.json` | `0219ab68…73562` (pre-existing archive artifact; not created, modified or used here) | binds `repository_head = 06b19867…`, ≠ current HEAD |
| `…/audit-v3-REPORT.md` | `84e085e1…0317e30` | narrative audit (faceoff-map only) |

### Proof the OCR path is non-mutating

`game_ocr.cli extract` is a pure image→JSON transform:

- `tools/game_ocr/game_ocr/cli.py:29-33` — constructs `Extractor`, calls `extract_input`,
  writes exactly one file: the `--output` path.
- `tools/game_ocr/game_ocr/extractor.py:110-177` — reads images, crops ROIs, runs the OCR
  backend, calls the parser. The only filesystem interaction with the input directory is a
  **read** of the optional `selected_frames.json` sidecar (`extractor.py:157-165`). It never
  writes into the input directory.
- Grep over `tools/game_ocr/game_ocr/**.py` for `psycopg|postgres|sqlalchemy|asyncpg|DATABASE_URL|psql|requests\.|urllib|httpx|socket\.` returns **only two comment lines** in
  `loadout_evidence.py` mentioning Postgres column naming. There is no database client, no
  network client, and no import of `@eanhl/db` anywhere in the package.
- The promoter chain (`apps/worker/src/ingest-ocr.ts:823`) is what writes rows; it was never
  invoked. `runOcrCli` (`apps/worker/src/ocr-cli-runner.ts:82-105`) runs the same subprocess
  this audit ran directly, *before* any `ocr_capture_batches` insert.

A safely separable OCR-only entry point therefore exists; no improvisation with `ingest-ocr`
was needed.

### Database safety

Every database session ran through `docker exec -e PGOPTIONS='-c default_transaction_read_only=on'`,
and **every query group was prefixed with a guard statement** whose output is recorded in the
transcript and in `/tmp/rescue-resim-20260815/db-*.txt`:

```
SELECT 'READ_ONLY=' || current_setting('default_transaction_read_only');  →  READ_ONLY=on
```

All statements were `SELECT`. No transaction contained an attempted write of any kind, not
even one intended to roll back. Snapshots: `db-matches.txt`, `db-matches-extra.txt`,
`db-period-rows.txt`, `db-batch-guard.BEFORE.txt`.

### Capture safety

- Every window was resolved from the manifest by **exact promotion key**
  `(video_sha256, batch_dir, run_id)` plus `(match_id, target_screen, segment_index)`; each
  matched exactly one manifest entry in both schema 2 and schema 3.
- All frames were written under `/tmp/rescue-resim-20260815/frames/` (schema-2 sampling) and
  `/tmp/rescue-resim-20260815/frames-s3/` (schema-3 sampling).
- Nothing was written into any `batch_dir`, any `.staging/` directory, `/home/michal/ingest-cache`,
  or any rescue-run archive. Verified by a full before/after mtime snapshot (§9).

---

## 2. The eight windows — exact promotion keys

Promotion key = `(video_sha256, source_directory, run_id)`, a verbatim mirror of
`ocr_capture_batches_video_sha_dir_run_uniq`. `source_directory` is shown relative to the
cache root `/home/michal/ingest-cache/`. All eight keys are **free**: zero receipts, zero
`ocr_capture_batches` rows, no directory on disk.

| # | match | screen | seg | run | video_sha256 (full) | batch_dir (below cache root) |
| --: | --: | --- | --: | --: | --- | --- |
| 1 | 1090 | `post_game_net_chart` | 9002 | 2098 | `4f189ffc394ed9e6991a4bbe920d0463a78a6de5fa2e905c1b6d5a5c56588b80` | `4f189ffc…88b80/rescue/seg-9002-post_game_net_chart` |
| 2 | 2683 | `post_game_box_score_shots` | 9010 | 2138 | `6f010c2e9c1aba4ee7fc4ffada7b8595a8dd81e449510a36df834942060149db` | `6f010c2e…149db/rescue/seg-9010-post_game_box_score_shots` |
| 3 | 2672 | `post_game_box_score_goals` | 9003 | 2128 | `c85aee95b02f5c147706e2ca75796cdc4d1f0bc7503e6fdabafba78578f6d54a` | `c85aee95…6d54a/rescue/seg-9003-post_game_box_score_goals` |
| 4 | 2672 | `post_game_box_score_goals` | 9007 | 2128 | `c85aee95b02f5c147706e2ca75796cdc4d1f0bc7503e6fdabafba78578f6d54a` | `c85aee95…6d54a/rescue/seg-9007-post_game_box_score_goals` |
| 5 | 2676 | `post_game_box_score_goals` | 9003 | 2131 | `ca5d5da61f61d232bac69804672f910bb6e14cdce93e97a8fb0f0d4e6b4c572d` | `ca5d5da6…c572d/rescue/seg-9003-post_game_box_score_goals` |
| 6 | 2403 | `post_game_box_score_goals` | 9005 | 2107 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9005-post_game_box_score_goals` |
| 7 | 2403 | `post_game_box_score_goals` | 9010 | 2107 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9010-post_game_box_score_goals` |
| 8 | 2404 | `post_game_box_score_shots` | 9017 | 2108 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9017-post_game_box_score_shots` |

These are exactly windows #1, #2, #4, #5, #6, #8, #9 and #10 of the 14-window exclusion audit
— its Group W (7) plus #10 (2404 shots). Each appears exactly once; no window is duplicated
or omitted.

Timing, verbatim from the manifest (identical in schema 2 and schema 3):

| # | source video | t0 | t1 | reel | declared `frame_count` |
| --: | --- | --: | --: | --- | --: |
| 1 | `/mnt/k/NHL/NHL26/2026-05-26_16-59-54.mkv` | 971.250 | 972.750 | 0 contained | 1 |
| 2 | `/mnt/k/NHL/NHL26/2026-06-20_16-04-36.mkv` | 3080.250 | 3081.750 | 1 contained | 1 |
| 3 | `/mnt/k/NHL/NHL26/2026-06-16_19-54-05.mkv` | 153.250 | 154.750 | 0 contained | 1 |
| 4 | `/mnt/k/NHL/NHL26/2026-06-16_19-54-05.mkv` | 158.250 | 159.750 | 0 contained | 1 |
| 5 | `/mnt/k/NHL/NHL26/2026-06-18_18-04-16.mkv` | 2160.250 | 2161.750 | 0 contained | 1 |
| 6 | `/mnt/k/NHL/NHL26/2026-05-30_19-51-38.mkv` | 2583.250 | 2584.750 | 1 contained | 1 |
| 7 | `/mnt/k/NHL/NHL26/2026-05-30_19-51-38.mkv` | 2594.250 | 2595.750 | 1 **lookback** | 1 |
| 8 | `/mnt/k/NHL/NHL26/2026-05-30_19-51-38.mkv` | 4270.250 | 4271.750 | 2 contained | 1 |

All 5 distinct source videos exist on disk and were readable.

---

## 3. Capture and OCR provenance

### 3.1 The two manifests specify *different* frame selection — both were captured

This is the single most consequential methodological finding of the session and it was not
anticipated by the exclusion audit.

| | schema 2 (`rescue-manifest.json`) | schema 3 (`rescue-manifest.schema3.json`) |
| --- | --- | --- |
| seeking | `-ss <t0> -to <t1>` | `-ss <t0-0.017> -t <dur>` + `-copyts` |
| frame selection | `-vf fps=1` | `-vf select=between(t,…)+between(t,…)+between(t,…)` with `-frames:v 3` |
| output | `<batch_dir>/%05d.png` | `<batch_dir>/.staging/%05d.png` |
| frames actually produced (all 8 windows) | **2** | **3** |

Run 3 — the run that promoted 57 windows on 2026-08-07 — executed **schema 3**: every one of
its 57 receipts carries `manifest_sha256 = f0727066aa6b4f04cd6c095015b9d683532dd6b6686c357c4a41b2fdf1d33397`,
`schema_version: 3`, and `manifest_path: /tmp/rescue-schema3-2026-08-05/rescue-manifest.candidate.json`.
The schema-3 sampling is therefore the **execution-faithful** one, and **all dispositions in
this document are based on the schema-3 capture.** The schema-2 capture is reported alongside
it as a control, because the two disagree materially for four of the eight windows (§4.9).

Note also that the manifest's declared `frame_count: 1` is the count of *classifier evidence
anchors*, not the ffmpeg yield. Both sampling modes yield more than one frame, and the
2-frame schema-2 yield matches what promoted rescue batches of the same window length hold on
disk (e.g. `3934777a…/rescue/seg-9007-post_game_box_score_shots` → 2 files).

### 3.2 Exact capture command and the sole intentional difference

Example, window #1, schema 3. The audit command is the manifest argv **verbatim** except for
the final output path template:

```
# MANIFEST (schema 3) — NOT RUN
ffmpeg -v error -y -ss 971.233 -t 0.817 -i /mnt/k/NHL/NHL26/2026-05-26_16-59-54.mkv \
  -copyts -vf 'select=between(t\,971.979167\,971.987500)+between(t\,971.995833\,972.004167)+between(t\,972.012500\,972.020833)' \
  -fps_mode passthrough -frames:v 3 \
  /home/michal/ingest-cache/4f189ffc…88b80/rescue/seg-9002-post_game_net_chart/.staging/%05d.png

# AUDIT — RUN
ffmpeg -v error -y -ss 971.233 -t 0.817 -i /mnt/k/NHL/NHL26/2026-05-26_16-59-54.mkv \
  -copyts -vf 'select=between(t\,971.979167\,971.987500)+between(t\,971.995833\,972.004167)+between(t\,972.012500\,972.020833)' \
  -fps_mode passthrough -frames:v 3 \
  /tmp/rescue-resim-20260815/frames-s3/m1090-seg9002-post_game_net_chart/%05d.png
```

**The sole intentional difference is the output destination.** Every other token — binary,
verbosity, overwrite flag, seek, duration, input path, `-copyts`, the entire `select` filter
expression, `-fps_mode`, `-frames:v` — is byte-identical to the manifest. The same holds for
all eight windows in both sampling modes; the full argv pairs are recorded in
`/tmp/rescue-resim-20260815/capture.json` and `capture-s3.json`. Every `ffmpeg` invocation
exited 0 with empty stderr.

### 3.3 Frame hashes — schema 3 (execution-faithful, 24 frames)

| window | frame | bytes | sha256 |
| --- | --- | --: | --- |
| 1090 seg9002 net_chart | 00001.png | 1349058 | `8ee9663e1ce7111f22b5cf80f5a50a5d6bf4d15e7a45bbcb072d476162a01874` |
| | 00002.png | 1340413 | `ea7a9d140c4e8e16567a3eb53ab05b782de45f52d3cd325fe2ecc757e9363158` |
| | 00003.png | 1350770 | `991fe4cd20e4804bb7811235496a61d5150ceabb17a913028fe8c325dfaa2a6a` |
| 2683 seg9010 shots | 00001.png | 195236 | `67721cc67f5c9e9ce455339510d7a08e78d68dba33bf73ac7cb552e89de4e672` |
| | 00002.png | 195687 | `7681e3b518628d04672e0b7387eb159aebacfee3924aa0535ac63be8dcee128a` |
| | 00003.png | 196281 | `6e9ed69daa1785ca224f717ad2945f80bbb8f355b9eb527fcf257895f7397b56` |
| 2672 seg9003 goals | 00001.png | 1456599 | `f3ad10156931c0011a83ba317af07163c08e844c50a5b978b02bcfe37f52162a` |
| | 00002.png | 1460735 | `da242be6f1fa55379dc707df5b159bc8deea5ed355613fdb659eb788dda5c3d7` |
| | 00003.png | 1457204 | `b00beaa8e220aa7369706de81bab6cc5eee1be88874f77fa54ece7bf448c8dc5` |
| 2672 seg9007 goals | 00001.png | 1120942 | `cbfce32ac93c551f50b722fed2098c7fb77fcec4ad4fa5789545f5e7e73ea333` |
| | 00002.png | 1118440 | `a5f769ed11d55ac643903b6197c7e9a84154a628d6d162640d5cf24451814b46` |
| | 00003.png | 1118588 | `d8e7628a3f780f7bad8a2d7db8e3d4f5dd15256d67a901d8fd89d8d94fc243eb` |
| 2676 seg9003 goals | 00001.png | 1126563 | `1a2abf3420909fc43a0eb714c26389df9d379ecd17702cdf2cca7cbaab6b4bb4` |
| | 00002.png | 1134984 | `424be0a0bd612c2239a853a02c8fb86104b0c82c2ca827d82a0c5ae842ff1765` |
| | 00003.png | 1137211 | `682efd7d12e16993e1a8fd6d999fa5ab9592f8b880d83a201615013cb6f6c04a` |
| 2403 seg9005 goals | 00001.png | 1161167 | `098ed4e3d10458f7cfc3a81f4972b3ee8add279ff61d2fcf6df9cc8fb8f74fc5` |
| | 00002.png | 1161238 | `0c8217bafd8e75812dfc6ff8c05c2152c7de148326fd92b2a68c446692e9da45` |
| | 00003.png | 1161021 | `363370749e8c08dd5fdf4762eabc9934ac11cdfc6b3ecdb4f05323762043bda6` |
| 2403 seg9010 goals | 00001.png | 1323295 | `bd63390e430047e5b750f06c4a3b180e4f99c02c9d02c547fbc28f83866b5a35` |
| | 00002.png | 1323195 | `63afc78636f2624c34cb0a46129558274c1cabfebf834032a7fff7492fb78c92` |
| | 00003.png | 1331345 | `3fa0c9ddc5cf1ca20e8724d36655698aca5f81667fb6eaa19faebeb8bd3d26b2` |
| 2404 seg9017 shots | 00001.png | 527101 | `22debf8d5e0f9643742f8747c2c0f2d4818909bb53422ee1d9be7685b9a9a4e5` |
| | 00002.png | 572463 | `adddf1e1ffe6a1b33a48dbd394e93bf5fa0b5123f2cbad40480fe59af1bf67b4` |
| | 00003.png | 572561 | `ed7203c4823394ac37d33cf0bd708f27ea5ca47726955f87df16207911f45f6b` |

Schema-2 control capture: 16 frames, hashes in `/tmp/rescue-resim-20260815/capture.json`.

### 3.4 OCR result hashes

| window | schema-3 OCR JSON sha256 | schema-2 OCR JSON sha256 |
| --- | --- | --- |
| 1090 seg9002 net_chart | `d39553126503b5b411c85253574b75960645bacdc5e847b65fe2f79a2f61d35a` | `9ecc66593ca790f285f8ea8f86e5570db36499bfb650c5acb157d298c04c8d81` |
| 2683 seg9010 shots | `a171968d9e55c3f0548aaf7181c4b493650ccf9722a8746c2098f8badee86031` | `ce1b278bb541b3819f943fcf1961e8fdaa8cc0f988f5125c0941583b58b00cf6` |
| 2672 seg9003 goals | `c97bfa190831fb20ca6d78d4e5496f2120100a477c8594583b8d496e5878bfbc` | `f8bf284602f35653a417c851f2e527ebfee185db5af8400b6430aaa72594dc18` |
| 2672 seg9007 goals | `16eaa3ac2b98f74e390c6616b3b7be3f9316116c9ad71e4f770a596a3e88f2ad` | `8cf51219d93e4344c98c4f1d4c6bc052d5500f238ecd082c46425d29ecd5cd8e` |
| 2676 seg9003 goals | `0b020ec651563fadf07c4fa5367a37220efb96163c0ac54eaeff8ac34766a49a` | `febd0003d4f8aa1262953b4984bec2bd16a380815192517008b6b513d8b33b80` |
| 2403 seg9005 goals | `76d05e9728ac0788429c07c05c98cbbf4e67f14e28e51640d4cff52813029b4d` | `2a9749b180e1209e588e8df5bddb363ffe9800ca0aa0091d5ea13afb48f992fc` |
| 2403 seg9010 goals | `c7dc1dce115bd92a7a912fb835115fb529719a69a04e8197515cf01d18823448` | `6584d21f437ef3950d156f25b6cb39e327c47afcd6da818cfac908c499f72109` |
| 2404 seg9017 shots | `fcd56acbed4fd0c560c75f7270fdbb8db18bc7959efae9c40cbb63303c1ac811` | `b36c1781d48fa23c8c04f4bf0603236eb58a9a9c588607911f77dc0632bd58a0` |

Every extraction returned `success: true` with zero `errors`. Only 2404 produced parser
warnings (the TOT repair, §4.8).

---

## 4. Per-window extracted payload summary (schema-3 capture)

### 4.0 Current database state and EA anchors (read-only snapshot)

| match | EA result | EA score for–against | EA shots for–against | `bgm_was_home` | opponent on file | TOA (s) |
| --: | --- | --- | --- | --- | --- | --: |
| 1090 | DNF | 0–3 | 5–8 | false → away = `for` | AXHL Anaheim Ducks | 268 |
| 2403 | DNF | 0–3 | 0–3 | false → away = `for` | Oil Pink Pony Club | 35 |
| 2404 | WIN | 8–1 | 20–18 | true → home = `for` | tOSU Buckeyes | 522 |
| 2672 | WIN | 3–0 | 1–1 | true → home = `for` | Texas ICE | 25 |
| 2676 | WIN | 3–2 | 15–9 | true → home = `for` | we womp out HC | 731 |
| 2683 | WIN | 3–2 | 22–8 | true → home = `for` | Trashcans HC | 671 |

`bgm_was_home` is non-null for all six, so `resolveBgmSide` takes its authoritative path
(`resolve-bgm-side.ts:61-63`) and the garbled-team-name failure mode cannot occur. Every
window's OCR'd team labels independently corroborate the flag.

`match_period_summaries` (all rows `source='ocr'`), goals/shots/faceoffs, before:

| match | P1 | P2 | P3 | P4 | goals coverage | shots coverage | `review_status` |
| --: | --- | --- | --- | --- | --- | --- | --- |
| 1090 | g 0–1, s 3–5, f 3–5 | g 0–2, s 3–1, f 3–1 | g 0–0, s 0–0, f 0–0 | g 0–0, s 0–0, f 0–0 | complete (Σ 0–3 = EA ✓) | complete | **reviewed** |
| 2403 | g NULL, s 0–3, f 2–1 | g NULL, s 0–0, f 0–0 | g NULL, s 0–0, f 0–0 | g NULL, s 0–0, f 0–0 | **empty** | complete | pending_review |
| 2404 | g 1–0, s 5–8, f 6–2 | g 5–1, s **NULL**–6, f 5–6 | g 2–0, s 6–8, f 3–2 | g 0–0, s 0–0, f 0–0 | complete (Σ 8–1 = EA ✓) | **P2 `shots_for` NULL** | pending_review |
| 2672 | g NULL, s 1–1, f NULL | g NULL, s 0–0, f NULL | g NULL, s 0–0, f NULL | g NULL, s 0–0, f NULL | **empty** | complete | pending_review |
| 2676 | g NULL, s 4–1, f 3–2 | g NULL, s 6–2, f 3–3 | g NULL, s 7–7, f 6–4 | g NULL, s 1–1, f 1–2 | **empty** | complete | pending_review |
| 2683 | g NULL, s NULL, f 2–3 | g NULL, s NULL, f 7–2 | g NULL, s NULL, f 3–6 | g NULL, s NULL, f 0–0 | **empty** | **empty** | pending_review |

`match_shot_type_summaries`: **match 1090 has zero rows** (confirming the exclusion audit).
The live schema carries a single `review_status` column defaulting to `'pending_review'`; the
per-family `*_review_status` columns of migration `0056` are **not** on this database.
`packages/db/src/queries/match-enrichments.ts:145-146` filters OCR shot-type rows to
`review_status = 'reviewed'`, so newly-inserted rows are quarantined from the frontend.

### 4.1 Window 1 — match 1090, `post_game_net_chart`, seg 9002, run 2098

3 frames, all `success`, overall confidence 0.9539 / 0.9443 / 0.9341, no duplicates.

| field | f1 | f2 | f3 |
| --- | --- | --- | --- |
| `period_label` | `'RT 2ND PERIOD'` → `2ND PERIOD` **ok** | same | same |
| `period_number` | **2** | **2** | **2** |
| `away_label` | `'BM(A)'` ok | `'IM'` ok | `'D IM'` ok |
| `home_label` | `'ANA( A(H)'` ok | missing | missing |
| `away_header_total_shots` | `'5 SHOTS'` → **5** | `'5 SIOHS'` → **5** | `'5 SHOTS 一'` → **5** |
| `home_header_total_shots` | `'11 1 SHOTS'` → **11** | `'11 1 SHOTS'` → **11** | `'71 SHOTS'` → **71** |
| away block (total/wrist/slap/backhand/snap/defl/pp) | 1/0/1/0/0/0/0 all ok | identical | identical |
| home block | 2/0/0/0/2/0/0 all ok | identical | identical |

Empty / malformed / low-confidence: `home_label` missing on f2 and f3; the opponent header
total is read three different ways across three frames of the same 25 ms span
(**11, 11, 71**) — a 6.5× swing on a field the promoter treats as authoritative for the
whole-game total.

Identity: `BM(A)` = BGM, `ANA(…)` = AXHL Anaheim Ducks, and `bgm_was_home = false` → away is
`for`. Consistent.

### 4.2 Window 2 — match 2683, `post_game_box_score_shots`, seg 9010, run 2138

3 frames, all `success`, confidence 0.8908 / 0.8757 / 0.8537.

`tab_label` reads `'LT SHOT SUMMARY'` on all three (the tab is confirmed), `home_team` reads
`'THE BOOGEYMEN'` on all three, `away_team` is garbled on all three
(`'NUI OUIVIVIAnI Inrnrr ciHiAanV'` etc.).

**Every period header fails to normalize on every frame:**

| frame | header labels read | resulting `period_number` |
| --- | --- | --- |
| f1 | `TT`, `20`, `310`, `10`, `s0` | 0, 0, 0, 0, 0 |
| f2 | `UT`, `200`, `310`, `01`, `s0`, `IUT` | 0, 0, 0, 0, 0, 0 |
| f3 | `18T`, `3H0`, `$0`, `nUT` | 0, 0, 0, 0 |

The *values* are largely legible and mutually consistent (away 1, 3, 5, 0 and TOT 9; home 2,
9, `'1 4'`, 0 and TOT `'2 5'`), but `_normalize_period_label` (`parsers.py:1095-1105`) cannot
recover `TT`/`20`/`310`/`UT`/`18T`/`3H0` to `1ST`/`2ND`/`3RD`/`OT`, so
`_BOX_SCORE_PERIOD_NUMBER.get(label, 0)` yields 0 for every cell.

Low-confidence / malformed fields: 4 of 20 numeric cells parse to `None` (`'1 4'`, `'0 9'`,
`'0 2 5'`, `'2 5'` — space-separated digit runs that `parse_int` refuses); all 20 period
labels are unrecognized.

**Control (schema-2 sampling, `fps=1`):** its second frame reads the header row cleanly
(`1ST 2ND 3RD OT S0 TOT`) with away `TRASHCANS HC` / home `THE BOOGEYMEN` and values
away 1/3/5/0 (TOT 9, = its own period sum ✓), home 2/9/`'1 4'`→None/0 (TOT `'2 5'`→None).
The frame content is therefore readable; the pinned schema-3 frame selection just does not
land on a readable instant.

### 4.3 Window 3 — match 2672, `post_game_box_score_goals`, seg 9003, run 2128

3 frames, all `success`, confidence 0.9507 / 0.9504 / 0.9506. All three frames are
**identical** in every parsed field.

`tab_label` `'LT GOAL SUMMARY'` ok (tab confirmed) · `away_team` `'TEXASICE'` ok ·
`home_team` `'THE BOOGEYMEN'` ok.

| header | `period_number` | away (`against`) | home (`for`) |
| --- | --: | --- | --- |
| `1ST` | 1 | `'0'` → 0 ok | `'1'` → 1 ok |
| `2ND` | 2 | `'0'` → 0 ok | `'0'` → 0 ok |
| `3RD` | 3 | `'0'` → 0 ok | `'0'` → 0 ok |
| `OT` | 4 | `'0'` → 0 ok | `'0'` → 0 ok |
| `S0` | **0** (skipped) | `'0'` → 0 ok | `'0'` → 0 ok |
| `TOT` | **-1** (skipped) | `'0'` → 0 ok | `'1'` → 1 ok |

No empty, malformed or low-confidence cells. No phantom period. **Goals reconciliation:**
`for` Σ P1–P4 = **1**, EA `score_for` = **3** → **FAIL** (Δ −2). `against` Σ = **0** =
EA `score_against` **0** ✓. The screen's own TOT row (0–1) agrees with its own period row, so
the payload is *internally* consistent and *externally* wrong.

### 4.4 Window 4 — match 2672, `post_game_box_score_goals`, seg 9007, run 2128

3 frames, all `success`, confidence 0.9435 / 0.9413 / 0.9413. Payload is **cell-for-cell
identical to window 3** (`away_team` reads `'TEXAS ICE'` on f1, `'TEXASICE'` on f2/f3;
`SO` vs `S0` on the skipped column). Same reconciliation outcome: `for` 1 vs EA 3 → **FAIL**;
`against` 0 = 0 ✓.

**Control (schema-2 sampling):** produced *nothing* — f1 yielded zero period cells (promoter
would throw), f2 yielded a single `period_number = 0` cell. The two sampling modes disagree
completely on this window.

### 4.5 Window 5 — match 2676, `post_game_box_score_goals`, seg 9003, run 2131

3 frames, all `success`, confidence 0.9436 / 0.9452 / 0.9480. All three identical.

`tab_label` `'LT GOAL SUMMARY'` ok · `away_team` `'WE WOMP OUT HC'` ok (= opponent on file
`we womp out HC`) · `home_team` `'THE BOOGEYMEN'` ok.

| header | `period_number` | away (`against`) | home (`for`) |
| --- | --: | --- | --- |
| `1ST` | 1 | `'0'` → 0 ok | `'1'` → 1 ok |
| `2ND` | 2 | `'0'` → 0 ok | `'1'` → 1 ok |
| `3RD` | 3 | `'2'` → 2 ok | `'0'` → 0 ok |
| `OT` | 4 | `'0'` → 0 ok | `'1'` → 1 ok |
| `SO`/`S0` | **0** (skipped) | `'0'` → 0 ok | `'0'` → 0 ok |
| `TOT` | **-1** (skipped) | `'2'` → 2 ok | `'3'` → 3 ok |

Zero empty, malformed or low-confidence cells across all three frames. No phantom period.
**Goals reconciliation:** `for` Σ P1–P4 = 1+1+0+1 = **3** = EA `score_for` **3** ✓;
`against` Σ = 0+0+2+0 = **2** = EA `score_against` **2** ✓. The screen's own TOT row (2–3)
agrees with both. The OT goal is consistent with `result = WIN` on a 3–2 game and with the
existing OT shot/faceoff rows — and with the standing project fact that EASHL has no
shootout, so P4 = OT is a real period, not a shootout column.

### 4.6 / 4.7 Windows 6 and 7 — match 2403, `post_game_box_score_goals`, seg 9005 and seg 9010, run 2107

Both windows, all 6 frames, `success`, confidence 0.9486–0.9558. **All six frames are
cell-for-cell identical** (the only difference is `S0` vs `SO` on the skipped column).

`tab_label` `'LT GOAL SUMMARY'` ok · `away_team` `'THE BOOGEYMEN'` ok · `home_team`
`'OIL PINK PONY CLUB'` ok.

| header | `period_number` | away (`for`) | home (`against`) |
| --- | --: | --- | --- |
| `1ST` | 1 | `'0'` → 0 ok | `'2'` → 2 ok |
| `2ND` | 2 | `'0'` → 0 ok | `'0'` → 0 ok |
| `3RD` | 3 | `'0'` → 0 ok | `'0'` → 0 ok |
| `OT` | 4 | `'0'` → 0 ok | `'0'` → 0 ok |
| `S0`/`SO` | **0** (skipped) | `'0'` → 0 ok | `'0'` → 0 ok |
| `TOT` | **-1** (skipped) | `'0'` → 0 ok | `'2'` → 2 ok |

Zero empty/malformed cells; no phantom period. **Goals reconciliation:** `for` Σ = **0** =
EA `score_for` **0** ✓; `against` Σ = **2**, EA `score_against` = **3** → **FAIL** (Δ −1).
Internally consistent (TOT 0–2 = period sum), externally short by one goal.

### 4.8 Window 8 — match 2404, `post_game_box_score_shots`, seg 9017, run 2108

3 frames, all `success`, confidence 0.9584 / 0.9597 / 0.9598, all identical. Each frame
carries one parser warning: `shots away TOT repaired from period sum: TOT unread (raw '2 2'), periods sum to 22`.

`tab_label` `'LT SHOT SUMMARY'` ok · `away_team` `'TOSU BUCKEYES'` ok · `home_team`
`'THE BOOGEYMEN'` ok. `bgm_was_home = true` → home is `for`.

| header | `period_number` | away (`against`) | home (`for`) |
| --- | --: | --- | --- |
| `1ST` | 1 | `'8'` → 8 ok | `'5'` → 5 ok |
| `2ND` | 2 | `'6'` → 6 ok | `'1 0'` → **None, uncertain** |
| `3RD` | 3 | `'8'` → 8 ok | `'6'` → 6 ok |
| `OT` | 4 | `'0'` → 0 ok | `'0'` → 0 ok |
| `SO` | **0** (skipped) | `'0'` → 0 ok | `'0'` → 0 ok |
| `TOT` | **-1** (skipped) | `'2 2'` → **22 (parser-repaired from period sum)** | `'2 1'` → **None, uncertain** |

Empty/malformed/low-confidence: the `for` side's P2 and TOT cells both read as
space-separated digit runs that `parse_int` refuses.

**Answering the specific question: does this payload supply the known missing 2404 P2
`shots_for` cell? No.** The one cell the exclusion audit identified as fillable is precisely
the cell this payload cannot read. Every other expected-period cell is already populated and
protected by `COALESCE`, so the payload introduces **no period and no value**. Internal
consistency: `against` 8+6+8+0 = 22 = its repaired TOT ✓; `for` incomplete, so unverifiable.
(EA game totals are 20–18 against the screen's 21?–22; per this audit's charter no
per-period EA shot truth is invented, and the game-total divergence is recorded as an
observation, not a reconciliation test.)

### 4.9 Sampling sensitivity — schema 2 vs schema 3

| # | window | schema-3 (execution-faithful) outcome | schema-2 (`fps=1`) control outcome | agree? |
| --: | --- | --- | --- | --- |
| 1 | 1090 net_chart | 3 usable period-2 frames; header total 11/11/**71** | 1 usable frame (header 11) + 1 unreadable frame that throws | partial |
| 2 | 2683 shots | **all period labels unreadable → zero writes** | one clean frame → 7 cells filled | **no** |
| 3 | 2672 goals 9003 | clean 1–0 read | clean 1–0 read | yes |
| 4 | 2672 goals 9007 | clean 1–0 read | **empty — promoter throws** | **no** |
| 5 | 2676 goals 9003 | **clean 3–2 read, reconciles** | **empty — promoter throws** | **no** |
| 6 | 2403 goals 9005 | clean 0–2 read | clean 0–2 read | yes |
| 7 | 2403 goals 9010 | clean 0–2 read | clean 0–2 read | yes |
| 8 | 2404 shots 9017 | no writes (P2 `for` unreadable) | no writes (P2 `for` unreadable) | yes |

Four of eight windows disagree. This is a first-order caveat on **any** conclusion drawn from
a single sampling mode — including the deleted audit-v2 and audit-v3 conclusions, whose
sampling mode cannot now be established for the schema-2-era runs.

---

## 5. Independent and combined-order simulations — matches 2672 and 2403

The simulation is a pure, in-memory Python re-implementation of `box-score.ts` and
`net-chart.ts` (`/tmp/rescue-resim-20260815/simulate.py`, run over the schema-3 payloads as
`simulate_s3.py`). It mirrors, and does not import or execute, the production promoters:
update-first with per-column `COALESCE(existing, incoming)`, plain INSERT when no row exists
for that `period_number`, skip `period_number < 1`, throw on zero period cells, throw on
net-chart `period_number ∈ {0, non-numeric}`, and the unconditional ALL PERIODS recompute.
BEFORE state is the read-only snapshot in §4.0. **No production promoter was called and no
database connection was opened by the simulator.**

Frame-level failure isolation is modelled as production behaves it
(`ingest-ocr.ts:836-844`): a throwing promoter marks that one extraction
`transform_status = 'error'` and does **not** abort the batch.

### 5.1 Match 2672 — seg 9003 and seg 9007

| scenario | resulting `match_period_summaries` delta |
| --- | --- |
| seg 9003 alone | P1 `goals_for` NULL→1, `goals_against` NULL→0; P2/P3/P4 both columns NULL→0 |
| seg 9007 alone | **identical** |
| seg 9003 **then** seg 9007 | identical to either alone; seg 9007's writes are absorbed entirely by `COALESCE` |
| seg 9007 **then** seg 9003 | identical to either alone; seg 9003's writes are absorbed entirely by `COALESCE` |

**Order-independent, and mutually redundant.** The two windows carry identical values, so
whichever runs first supplies every cell and the second is a pure no-op on numeric columns
(it would still create its own batch/segment/extraction rows). The exclusion audit's
order-dependence hypothesis for 2672 is therefore **not reproduced under current code**: no
execution order changes the outcome, and no combination rescues the failed reconciliation.

Reconciliation in every scenario: `for` Σ = 1 vs EA 3 → **FAIL**; `against` Σ = 0 = 0 ✓.
Zero new period rows; zero phantom periods; zero existing values altered.

### 5.2 Match 2403 — seg 9005 and seg 9010

| scenario | resulting `match_period_summaries` delta |
| --- | --- |
| seg 9005 alone | P1 `goals_for` NULL→0, `goals_against` NULL→2; P2/P3/P4 both columns NULL→0 |
| seg 9010 alone | **identical** |
| seg 9005 **then** seg 9010 | identical |
| seg 9010 **then** seg 9005 | identical |

**Order-independent, and mutually redundant** — same structure as 2672. Reconciliation in
every scenario: `for` Σ = 0 = 0 ✓; `against` Σ = 2 vs EA 3 → **FAIL**. Zero new period rows;
zero phantom periods; zero existing values altered.

### 5.3 Why both matches fail reconciliation — structural, not OCR

Both failing matches are EA short/abandoned games whose recorded final is almost certainly an
*awarded* score rather than the played score:

| match | EA result | EA score | EA shots | time on attack | pass attempts | screen's own TOT |
| --: | --- | --- | --- | --: | --: | --- |
| 2672 | WIN | 3–0 | 1–1 | 25 s | 6 | 0–1 |
| 2403 | DNF | 0–3 | 0–3 | 35 s | 8 | 0–2 |

A 3–0 win on one shot for and one against, in 25 seconds of attack time, is not a played
scoreline. The OCR reads are internally consistent, high-confidence, tab-confirmed and
identity-confirmed; the disagreement is between the screen and EA's award, not within the
payload. **This audit still applies the stated criterion and fails them** — but the cause is
recorded here explicitly, because a management ruling that DNF/forfeit EA finals are not a
valid reconciliation anchor would move all four windows from WITHHOLD-INVALID to
NEEDS-REMEDIATION. That ruling is not made here.

---

## 6. Net-chart aggregate analysis — match 1090

Match 1090 has **zero** `match_shot_type_summaries` rows today, so every write is an INSERT.
All three frames parse as `period_number = 2`, so the promoter runs three times, and each
per-period write triggers `recomputeAllPeriodsAggregate` (`net-chart.ts:138-146`) for each of
the two sides.

Simulated sequence (`simulation-output-s3.txt`, scenario W1):

```
f1  INSERT      m1090 for      P2  total=1 wrist=0 slap=1 backhand=0 snap=0 defl=0 pp=0
f1  INSERT      m1090 for      P-1 ALL PERIODS total=5  wrist=0 slap=1 backhand=0 snap=0 defl=0 pp=0
f1  INSERT      m1090 against  P2  total=2 wrist=0 slap=0 backhand=0 snap=2 defl=0 pp=0
f1  INSERT      m1090 against  P-1 ALL PERIODS total=11 wrist=0 slap=0 backhand=0 snap=2 defl=0 pp=0
f2  (per-period merge is a no-op; recompute re-runs)
f2  OVERWRITE   m1090 for      P-1 total=5
f2  OVERWRITE   m1090 against  P-1 total=11
f3  OVERWRITE   m1090 for      P-1 total=5
f3  OVERWRITE   m1090 against  P-1 total=71      ← last frame wins
```

**Answering the specific question — publish, throw, or remain safe: it publishes a partial
aggregate, and it does so with a corrupted total.** Concretely:

1. **It does not throw.** All three frames yield `period_number = 2`, so
   `PERIOD_LABEL_UNRECOGNIZED` never fires under schema-3 sampling. (Under the schema-2
   control, the second frame *does* throw — another sampling-sensitivity data point.)
2. **The ALL PERIODS row is a single period's breakdown labelled as the whole game.** Every
   breakdown column (`wrist/slap/backhand/snap/deflections/power_play`) is the P2 value,
   because P2 is the only contributing per-period row. For the `for` side the aggregate reads
   `total_shots = 5` (from the score-strip header) while its own breakdown sums to **1** — an
   internally contradictory row.
3. **The final overwrite carries a grossly wrong total.** `recomputeAllPeriodsAggregate`
   prefers `headerTotalShots` over the per-period sum (`net-chart.ts:230`) and the conflict
   target is overwritten **unconditionally, without `COALESCE`** (`net-chart.ts:258-271`).
   The three frames read the opponent header as 11, 11 and **71**; the third frame executes
   last, so the surviving `against` ALL PERIODS row reads `total_shots = 71` against an EA
   `shots_against` of **8**. A last-writer-wins unconditional overwrite converts a
   single-frame OCR slip into the published game total.
4. **It contradicts already-published data.** The net-chart P2 `for` total (1) disagrees with
   match 1090's `match_period_summaries` P2 `shots_for` (**3**) — and those period rows are
   `review_status = 'reviewed'`, i.e. live on the frontend.
5. **Partial mitigation.** New shot-type rows take the schema default
   `review_status = 'pending_review'`, and `match-enrichments.ts:145-146` filters OCR
   shot-type rows to `reviewed`, so the bad aggregate would not reach the frontend
   unreviewed. It would, however, sit in the table as a plausible-looking row awaiting a
   human who could publish it with one action.

No existing value would be altered (there are none), and no unexpected period number is
emitted — every frame reads period 2 and nothing else.

---

## 7. Current-audit disposition and evidence, per window

| # | window | disposition | decisive evidence |
| --: | --- | --- | --- |
| 1 | 1090 net_chart seg9002 | **NEEDS-REMEDIATION** | Real, high-confidence period-2 evidence exists, but the unconditional ALL PERIODS recompute publishes a one-period breakdown as the whole game **and** last-writer-wins propagates a `71` header misread into `total_shots` (EA: 8). Also contradicts the already-`reviewed` P2 `shots_for = 3`. The promoter, not the payload, is what makes execution unsafe. |
| 2 | 2683 shots seg9010 | **NEEDS-REMEDIATION** | Under the pinned schema-3 command every period header is unreadable → 0 of 20 cells promote, so the window as-specified recovers nothing for the only match in this set with no shots coverage at all. The schema-2 control proves readable content exists in the same 1.5 s span. The defect is in frame selection / period-label OCR, not in the frame. |
| 3 | 2672 goals seg9003 | **WITHHOLD-INVALID** | Clean, tab-confirmed, identity-confirmed payload that **fails EA reconciliation**: `for` Σ = 1 vs EA 3. Cause is structural (25 s forfeit-shaped WIN), not OCR, but the stated criterion fails. |
| 4 | 2672 goals seg9007 | **WITHHOLD-INVALID** | Payload identical to #3; same failed reconciliation; provably redundant with #3 in both execution orders. |
| 5 | 2676 goals seg9003 | **SAFE-TO-PROPOSE** | Clean payload on all 3 frames, zero malformed cells, tab and identity confirmed, no phantom period, no new row, no value overwritten — and it **reconciles exactly** in both directions (`for` 1+1+0+1 = 3 = EA 3; `against` 0+0+2+0 = 2 = EA 2), with the screen's own TOT row agreeing. Fills 8 currently-NULL goals cells for a match with no per-period goals at all. No degradation identified. |
| 6 | 2403 goals seg9005 | **WITHHOLD-INVALID** | Clean payload that **fails EA reconciliation**: `against` Σ = 2 vs EA 3. Cause structural (35 s DNF), criterion still fails. |
| 7 | 2403 goals seg9010 | **WITHHOLD-INVALID** | Payload identical to #6; same failure; provably redundant with #6 in both orders. |
| 8 | 2404 shots seg9017 | **WITHHOLD-REDUNDANT** | Valid, internally consistent payload (`against` 8+6+8+0 = 22 = repaired TOT) that produces **zero** database changes: the one known fillable cell (P2 `shots_for`) is exactly the cell it cannot read (`'1 0'` → uncertain → NULL), and every other expected-period cell is already populated and `COALESCE`-protected. No coverage gain. |

**Totals:** SAFE-TO-PROPOSE **1** · WITHHOLD-INVALID **4** · WITHHOLD-REDUNDANT **1** ·
NEEDS-REMEDIATION **2** · UNVERIFIED **0** — total **8**.

### Intrinsic payload quality vs current-database redundancy

| window | intrinsic payload quality | redundancy under current DB state |
| --- | --- | --- |
| 1090 net_chart | good per-period read; **unstable header field** (11/11/71) | not redundant — 0 shot-type rows exist |
| 2683 shots | content readable, **period labels unreadable under the pinned command** | not redundant — 0 shots cells exist |
| 2672 ×2 | well-formed, high-confidence, **externally unreconcilable** | not redundant vs DB; **fully redundant with each other** |
| 2676 goals | well-formed, high-confidence, **fully reconciled** | not redundant — 0 goals cells exist |
| 2403 ×2 | well-formed, high-confidence, **externally unreconcilable by 1 goal** | not redundant vs DB; **fully redundant with each other** |
| 2404 shots | well-formed but incomplete on the one cell that matters | **fully redundant** — zero net effect |

### Safety checks each payload passes or fails

| check | 1090 | 2683 | 2672×2 | 2676 | 2403×2 | 2404 |
| --- | --- | --- | --- | --- | --- | --- |
| `resolveBgmSide` resolves (authoritative `bgm_was_home`) | pass | pass | pass | pass | pass | pass |
| box-score zero-period-cell throw avoided | n/a | pass | pass | pass | pass | pass |
| net-chart `PERIOD_LABEL_UNRECOGNIZED` avoided | pass | n/a | n/a | n/a | n/a | n/a |
| no phantom / out-of-range period emitted | pass | pass | pass | pass | pass | pass |
| no existing populated cell overwritten | pass | pass | pass | pass | pass | pass |
| ALL PERIODS aggregate not corrupted | **FAIL** | n/a | n/a | n/a | n/a | n/a |
| EA-final reconciliation (goals only) | n/a | n/a | **FAIL** | **pass** | **FAIL** | n/a |
| produces any coverage gain | yes | **no** | yes | yes | yes | **no** |

---

## 8. Exact database changes each payload would attempt — simulation only

**Nothing below was executed.** These are the writes the current promoters *would* attempt,
derived from the in-memory simulation.

### Window 1 — 1090 net_chart seg9002 → `match_shot_type_summaries`

| op | key | values |
| --- | --- | --- |
| INSERT | (1090, `for`, 2, ocr) | label `2ND PERIOD`, total 1, wrist 0, slap 1, backhand 0, snap 0, defl 0, pp 0 |
| INSERT | (1090, `against`, 2, ocr) | label `2ND PERIOD`, total 2, wrist 0, slap 0, backhand 0, snap 2, defl 0, pp 0 |
| INSERT then 2× unconditional OVERWRITE | (1090, `for`, −1, ocr) | label `ALL PERIODS`, **total 5**, wrist 0, slap 1, backhand 0, snap 0, defl 0, pp 0 |
| INSERT then 2× unconditional OVERWRITE | (1090, `against`, −1, ocr) | label `ALL PERIODS`, **total 71** (final value), wrist 0, slap 0, backhand 0, snap 2, defl 0, pp 0 |

Plus: 1 `ocr_capture_batches` row, 1 `ocr_segments` row tagged `rescue-b2-anchor-v1`, 3
`ocr_extractions` rows (all `success`), and their `ocr_extraction_fields`.
`match_period_summaries`: **no change**.

### Window 2 — 2683 shots seg9010

**No domain-row writes at all.** All 20 period cells carry `period_number = 0` and are
skipped by `box-score.ts:67`. The promoter does *not* throw (the `periods` array is
non-empty), so all three extractions record `transform_status = 'success'` while writing
nothing — a false-success shape. Batch/segment/extraction rows would still be created.

### Windows 3 & 4 — 2672 goals seg9003 / seg9007 → `match_period_summaries` UPDATEs

| key | column | before | after |
| --- | --- | --- | --- |
| (2672, 1) | `goals_for` / `goals_against` | NULL / NULL | **1** / **0** |
| (2672, 2) | `goals_for` / `goals_against` | NULL / NULL | 0 / 0 |
| (2672, 3) | `goals_for` / `goals_against` | NULL / NULL | 0 / 0 |
| (2672, 4) | `goals_for` / `goals_against` | NULL / NULL | 0 / 0 |

Plus `ocr_extraction_id` = `COALESCE(existing, new)` (existing 30481 wins on all four rows).
No INSERT, no new period, no other column touched. Identical for either window and either
order; the second window to run changes nothing.

### Window 5 — 2676 goals seg9003 → `match_period_summaries` UPDATEs

| key | column | before | after |
| --- | --- | --- | --- |
| (2676, 1) | `goals_for` / `goals_against` | NULL / NULL | **1** / **0** |
| (2676, 2) | `goals_for` / `goals_against` | NULL / NULL | **1** / **0** |
| (2676, 3) | `goals_for` / `goals_against` | NULL / NULL | **0** / **2** |
| (2676, 4) | `goals_for` / `goals_against` | NULL / NULL | **1** / **0** |

Σ `for` = 3, Σ `against` = 2, matching EA 3–2. No INSERT, no new period, no other column
touched, rows stay `pending_review`.

### Windows 6 & 7 — 2403 goals seg9005 / seg9010 → `match_period_summaries` UPDATEs

| key | column | before | after |
| --- | --- | --- | --- |
| (2403, 1) | `goals_for` / `goals_against` | NULL / NULL | **0** / **2** |
| (2403, 2) | `goals_for` / `goals_against` | NULL / NULL | 0 / 0 |
| (2403, 3) | `goals_for` / `goals_against` | NULL / NULL | 0 / 0 |
| (2403, 4) | `goals_for` / `goals_against` | NULL / NULL | 0 / 0 |

Identical for either window and either order.

### Window 8 — 2404 shots seg9017

**No domain-row changes.** Every emitted period (1, 2, 3, 4) already has a row; `shots_for`
and `shots_against` are non-NULL and win the `COALESCE` on P1/P3/P4, and the incoming P2
`for` value is NULL so it cannot fill the one empty cell. `ocr_extraction_id` also stays at
its existing value. Only batch/segment/extraction rows would be created.

---

## 9. Remaining risks and missing evidence

**Risks identified by this audit**

1. **Sampling mode changes the answer.** Four of eight windows produce materially different
   payloads under schema-2 vs schema-3 frame selection. Any single-mode conclusion — including
   this one — is conditional on the mode. Dispositions here are pinned to schema 3 because
   that is what run 3 executed.
2. **`recomputeAllPeriodsAggregate` is a last-writer-wins unconditional overwrite over a
   preferred single-cell header read.** Match 1090 demonstrates a 6.5× total-shots error
   (`71` vs EA `8`) surviving into the ALL PERIODS row purely because the worst of three
   frames executed last. This is a general defect, not a property of these eight windows.
3. **`post_game_box_score_*` false success.** A payload whose period headers all fail to
   normalize yields `period_number = 0` for every cell, writes nothing, and still records
   `transform_status = 'success'` — the same shape audit-v3 identified for the faceoff-map
   screen. Window 2683 exhibits it exactly.
4. **EA finals for DNF/forfeit matches are not the played score,** so the goals reconciliation
   anchor is invalid for those matches. Four of the eight windows fail on this basis alone.
5. **Numeric-cell provenance remains row-level.** `ocr_extraction_id` keeps the first
   contributor by design, so column-level attribution of any of these writes would be
   unavailable after the fact.

**Evidence still missing**

- The deleted audit-v2/v3 per-window labels and gate OCR payloads. Not recovered, not
  approximated, still UNVERIFIED — this audit deliberately makes no claim about them.
- The frame-selection mode used by the 2026-08-05 schema-2-era runs, which would be needed
  before comparing any historical payload to these.
- Per-period EA truth for shots and faceoffs (does not exist in the EA payload), which is why
  windows 2 and 8 are assessed on completeness and internal consistency only.
- Whether match 2676's OT goal is corroborated by any independent source (the `post_game_events`
  screen for that match was not examined; it is outside this audit's eight-window scope).

---

## 10. No production execution is authorized

**This document authorizes nothing.** It is an audit record, not an approval.

- No `--execute`, no `ingest-ocr`, no `reprocess`, no promotion, no reconciliation, and no
  production promoter invocation occurred, and none is authorized by anything written here.
- **No execution allowlist was created**, and none may be derived from this document. The
  archived `rescue-execution-allowlist.json` was read only; it binds
  `repository_head = 06b19867…` and would abort against the current HEAD in any case.
- **SAFE-TO-PROPOSE is a recommendation for later management review only.** Exactly one
  window (#5, match 2676 goals seg9003) carries it. Executing it would still require a
  separate approval decision, a fresh allowlist re-bound to the then-current repository HEAD,
  and a decision about the sampling mode.
- The standing prohibition on blind execution of any of the 22 outstanding rescue windows is
  unchanged.
- The verified 97-window reconciliation (75 promoted / 1 failed / 21 not attempted) is
  untouched by this session.

### Verification evidence

| check | result |
| --- | --- |
| all eight windows represented exactly once | ✅ each resolved to exactly 1 manifest entry in both schema 2 and schema 3 |
| capture commands match manifest sampling except output destination | ✅ argv pairs recorded in `capture.json` / `capture-s3.json`; only the trailing path template differs |
| all output artifacts confined to `/tmp` | ✅ everything under `/tmp/rescue-resim-20260815/` |
| database sessions proven read-only | ✅ `READ_ONLY=on` guard printed before every query group; SELECT-only |
| rescue batch count before/after | ✅ **76 → 76** |
| archived `SHA256SUMS` | ✅ all 7 files `OK`, before and after |
| manifest / receipt hashes unchanged | ✅ `rescue-manifest.json` `70b5bfbb…78ecc8`; `rescue-receipts.jsonl` `2ceae0a4…30e25b8` |
| no ingest-cache file has a new mtime | ✅ full `find -printf '%T@ %p'` before/after diff is **empty** |
| no executable allowlist exists | ✅ none created; archive artifact read-only and HEAD-bound to a stale commit |
| repository files changed | this document + the current top entry of `HANDOFF.md` only |
