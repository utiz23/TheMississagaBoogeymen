# WS2 Pass-1 Pre-OCR Gate — Real-Footage Wall-Saving Measurement

**Date:** 2026-06-05 (measured) · 2026-06-07 (acted on: gate flipped default-OFF)
**Status:** ✅ MEASURED — result is **net-negative** on representative game footage.
**Action taken:** recommendation (1) applied — `nhl26.yaml: pass1.pre_ocr_gate.enabled`
flipped `true → false`. Machinery, thresholds, CLI `--pass1-gate`, and the env switch
are retained; the proving-bench `WS2_GATE=on` arm now force-enables the gate so its
coverage survives the default flip.
**Scope:** Closes the long-standing WS2 open item ("the gate fires on 0 frames on the
bench clips … so the wall saving is **unmeasured** — needs a host ingest on footage with
fades/black frames"). It is now measured.

## TL;DR

On a real 35-minute full-game capture, the conservative black-frame gate fired on
**12 / 2085 sampled frames (0.58%)** and made Pass-1 **~108 s slower** (OCR loop) /
**~116 s slower** (total Pass-1), not faster. The gate computes a per-frame visual
signal on **100%** of frames to skip OCR on **0.58%** of them, and the gated frames
(black/empty) are the _cheapest_ frames to OCR anyway — so the per-frame overhead
swamps the saving. **The break-even fire rate is ~3.5% on this CPU host and ~18–35%
on the production GPU path** — far above what real game footage produces. Recommend
reconsidering the default-ON posture (see Recommendation).

## Method

- Tool: `video-ingest classify-only` (Pass-1 only; never touches Pass-2 state).
- A/B: `--pass1-gate --force-pass1` vs `--no-pass1-gate --force-pass1` on the **same**
  clip. Each effective gate state has its own Pass-1 cache key; `--force-pass1`
  guarantees cold compute on both legs.
- Footage: `/mnt/k/2026-05-31_16-09-36.mkv` — the canonical **match-2582** capture
  (~34.7 min, 1920×1080@60, 2085 frames sampled at 1 fps).
- Metric of record: `pass1_sampling_telemetry` from `segments.json`, which splits
  `decode_ms` (I/O-bound) from `classify_ms` (the OCR loop the gate targets), so the
  comparison is insulated from `/mnt/k` decode-I/O variance.
- OCR backend: **CPU** RapidOCR. This host has no `CUDAExecutionProvider`
  (`onnxruntime` providers = `['Azure','CPU']`); `use_gpu=True` silently falls back.
  This is the same path the WS1a 35.7% `ocr_of_total` figure was measured on.

## Results

| Metric (2085 frames, identical clip) |    Gate ON |  Gate OFF |          Δ (ON − OFF) |
| ------------------------------------ | ---------: | --------: | --------------------: |
| `frames_gated`                       | 12 (0.58%) |         0 |                     — |
| `classify_ms` (OCR loop)             |  3,763,422 | 3,655,846 | **+107,576 (+2.94%)** |
| `decode_ms`                          |    510,968 |   502,601 |  +8,367 (noise floor) |
| `viterbi_ms`                         |         84 |        88 |       −4 (negligible) |
| `elapsed_pass1_ms`                   |  4,274,877 | 4,158,847 | **+116,030 (+2.79%)** |
| `/usr/bin/time` wall                 |    1:13:08 |   1:11:27 |            **+101 s** |

The classify-loop delta (+108 s) is **>10× the decode noise floor** (~8 s, same video
re-read), so the net-loss is real and outside measurement noise. All three independent
clocks (telemetry classify, telemetry pass1, OS wall) agree on direction and magnitude.

## Why it loses

The gate's input, `compute_visual_signals`, is computed in the Pass-1 hot loop
(`orchestrator.py:296`) **only when the gate is enabled**, and it is the _sole_ caller
on that path — i.e. it is **purely additive** overhead, paid on every frame:

- Microbenchmark (1080p): `compute_visual_signals` ≈ **70–90 ms/frame** (≈70 ms even on
  a pure-black frame — the cost is the content-independent `cvtColor`×2 + `Laplacian` +
  `Canny` + `resize`).
- Implied from the A/B: per-frame signal overhead ≈ 62 ms (solving
  `2085·s − 12·c = +107.6 s` with mean OCR cost `c ≈ 1.75 s/frame`), consistent with the
  microbenchmark.
- `compute_visual_signals` also builds an **HSV histogram + dHash** that the gate does
  **not** use (the gate needs only brightness, edge-density, log-blur).

**Break-even fire rate** `f > s/c`:

- CPU (this run): `62 ms / 1753 ms ≈ **3.5%**`. Observed: 0.58%.
- GPU (prod path, OCR ~5–10× faster, signal cost unchanged on CPU):
  `62 ms / (175–350 ms) ≈ **18–35%**`.

So on the production GPU path the gate would need ~a _quarter_ of the video to be
black/fade to break even — it is structurally net-negative there, **more** so than on
CPU. The deferred `max_edge_density` tuning could raise the fire rate but cannot
plausibly reach 18–35% on normal gameplay footage.

Note also: WS2 was accepted on a **zero-regression (ON ≡ OFF)** classification criterion
— the gate produces no _correctness_ benefit to offset the wall cost; it is a pure
wall-time optimization that, as measured, costs wall time.

## Caveats

- **n = 1 clip.** The fire rate (0.58%) drives the whole result; black/fade-heavy
  footage (long lobby waits, many goal-replay fades) would fire more. But break-even
  needs ≥3.5% (CPU) / ≥18% (GPU), which a tight single-game capture does not approach.
  A second clip with more transitions would tighten the envelope (gate-ON alone
  suffices — `frames_gated/2085` vs the break-even line); not yet run.
- CPU OCR path. The GPU path makes the gate _worse_, not better (signal overhead is
  CPU/cv2 regardless of OCR device while OCR — the only thing saved — gets cheaper).

## Recommendation

The gate is shipped **default-ON** (`nhl26.yaml: pass1.pre_ocr_gate.enabled: true`,
env kill switch `OCR_PASS1_GATE_ENABLED=false`). Given the measured net-loss, options,
cheapest first:

1. **Flip default to OFF** (keep the machinery + kill switch inverted). Zero-risk wall
   win on realistic footage; one-line YAML change.
2. **Make the gate signal cheap** — a gate-only signal computing _only_ brightness +
   edge-density + log-blur from a single `BGR2GRAY` (drop the HSV convert, histogram,
   and dHash). Could roughly halve the 62 ms; break-even still ~1.8% CPU / ~9–18% GPU,
   so this alone probably does **not** make it net-positive on normal footage.
3. **Raise fire rate** via the deferred `max_edge_density` tuning + proving-bench
   re-validation — unlikely to clear the GPU break-even line.

Recommendation: **(1)** for the wall win now; revisit (2)+(3) only if a black/fade-heavy
footage profile is shown to clear break-even.

**Applied (2026-06-07):** option (1) — `nhl26.yaml: pass1.pre_ocr_gate.enabled: false`.
No threshold change; the gate machinery, CLI `--pass1-gate` override, and the
`OCR_PASS1_GATE_ENABLED` env switch (now disable-only on an already-off gate) remain.
The proving-bench `WS2_GATE=on` arm was updated to force-enable the parsed gate config
so flipping the shipped default does not silently neuter its gate-ON coverage.

## Reproduce

```bash
GO=tools/game_ocr/.venv/bin/python   # combined venv (rapidocr + PyAV + video_ingest on PYTHONPATH via CWD)
OUT=$(mktemp -d)
cd tools/video_ingest
$GO -m video_ingest.cli classify-only --video /mnt/k/2026-05-31_16-09-36.mkv --output-root "$OUT" --pass1-gate    --force-pass1
$GO -m video_ingest.cli classify-only --video /mnt/k/2026-05-31_16-09-36.mkv --output-root "$OUT" --no-pass1-gate --force-pass1
# read pass1_sampling_telemetry.{frames_gated,classify_ms,decode_ms} from $OUT/<sha>/segments.json
```

Env note: the combined `tools/game_ocr/.venv` was missing **PyAV** (`av`); installed
`av==13.1.0` so the canonical-PTS sampler loads. `video_ingest`/`game_ocr` resolve via
CWD + the venv install; run from `tools/video_ingest`.
