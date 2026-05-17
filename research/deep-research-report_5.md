# Video-to-OCR Pipeline for Game UI Extraction

## Executive recommendations

Your current two-pass architecture is directionally right, but I would change four things before you build it out further. First, for Pass 1, start with a **hybrid deterministic screen classifier** built from cheap visual signatures plus OCR anchors, not a CNN. The public game/broadcast OCR projects I found are overwhelmingly **HUD-specific and rule-driven** rather than built around a general screen classifier: urlValoscribeturn39view6 is tied to professional broadcast HUD extraction, urlPractistics Scrim OCRturn12search19 extracts fixed VALORANT match screens, and urlScoreSightturn39view8 is built around configurable scoreboard OCR rather than general scene understanding. That is a strong signal that, for a fixed game/UI version, deterministic gating remains competitive and often preferable. citeturn39view6turn12search19turn39view8

Second, for Pass 2 OCR, the best fit for **your current stack** is **urlRapidOCRturn39view0 on ONNX Runtime GPU**, with **urlPaddleOCRturn39view1 on CUDA** as the second-best option. RapidOCR explicitly exists to convert PaddleOCR models into ONNX for easier and faster engineering deployment across platforms, while PaddleOCR remains the larger, more upstream-active OCR toolkit. Transformer/VLM OCR stacks such as urlSuryaturn39view3 and urlGOT-OCR2.0turn39view4 are valuable as fallback tools, but the available public materials position them as heavier general OCR systems rather than the first choice for dense, repeated 1080p game-HUD extraction. Independent 2025 comparisons likewise recommend starting with traditional OCR stacks and only escalating to multimodal OCR for harder layouts. citeturn39view0turn39view1turn39view3turn39view4turn7search2

Third, use **urlPySceneDetect docsturn9view0 only as a proposal generator**, not as the sole segment oracle. Its detectors are built for cuts/fades, and the docs are explicit that `detect-content`/`detect-adaptive` are for fast cuts while `detect-threshold` is for fades. Your game UI overlays can appear or disappear without a true shot transition. For your domain, the robust pattern is: coarse whole-video classification at low cadence, then scene detection only to refine boundaries. citeturn9view0turn10view1turn10view2turn10view3

Fourth, stop treating **frame index as time**. OBS/ShadowPlay/Xbox captures can carry VFR timestamps, B-frame reordering, discontinuities, or generated PTS. FFmpeg’s own docs say `-fps_mode passthrough` preserves demuxer timestamps, `-copyts` preserves input timestamps, and the image2 muxer can put PTS into filenames with `-frame_pts 1`. PyAV also exposes `Packet.pts`, `Packet.dts`, `Frame.pts`, and `time_base`, which is the right abstraction if you want timestamp-safe Python processing. citeturn27view0turn27view1turn27view2turn30view0turn32search1turn32search2turn32search15

| Decision area                | Recommended choice                                  | Second-best                                          | Why                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pass 1 screen classification | Hybrid signature + OCR-anchor classifier            | MobileNetV3-Small + OOD gate                         | Fixed HUDs and current public game/broadcast OCR tools skew toward deterministic, HUD-specific logic rather than general learned screen classification. citeturn39view6turn12search19turn39view8turn12search5                             |
| Pass 2 OCR backend           | urlRapidOCRturn39view0 + ONNX Runtime GPU       | urlPaddleOCRturn39view1 + CUDA                   | Lowest migration risk for your existing parsers, ONNX-friendly deployment, and lighter runtime profile; PaddleOCR is the stronger upstream if you need newer recognizers or multilingual expansion. citeturn39view0turn39view1turn7search2 |
| Boundary refinement          | `detect-adaptive` in urlPySceneDetectturn9view1 | `detect-content` with tuned weights                  | `detect-adaptive` is explicitly designed to reduce false detections from camera movement; `detect-content` is the useful baseline. citeturn10view1turn10view2turn9view3                                                                    |
| Timestamp source             | Frame PTS / packet PTS                              | Demuxer packet timeline + remapped sampling manifest | FFmpeg and PyAV both expose the timestamp mechanisms you need; frame index alone is unsafe on VFR/B-frame sources. citeturn27view0turn27view2turn30view0turn32search1turn32search15                                                      |

## Screen classification and cross-version drift

The direct answer to Q1 is **yes**: for a fixed set of roughly 12 UI states whose layouts, colors, and headers barely move within one game version, a **color-signature + text-presence hybrid is still competitive in 2025–2026**, and in your case it is the better starting point. The strongest public examples I found in esports/broadcast extraction do not point to a settled “small CNN everywhere” standard. Instead, they point to **version-pinned, HUD-specific CV/OCR systems**: urlValoscribeturn39view6 is an automated VOD analysis tool for pro broadcasts, and the author states publicly that it was built for the broadcast HUD used at Champions 2025; urlPractistics Scrim OCRturn12search19 extracts structured OCR from specific match screens; urlScoreSightturn39view8 is configurable scoreboard OCR software. This is exactly the maintenance regime you are in: one known HUD family, fixed layouts, expensive silent failures. citeturn39view6turn12search5turn12search19turn39view8

That same public code ecosystem also shows why you should not overfit to a one-version signature forever. Version-specific HUD tools in entity["video_game","Valorant","fps 2020"] and entity["video_game","League of Legends","moba 2009"] commonly document narrow display or HUD assumptions; for example, one League overlay repo explicitly says it only supports fullscreen borderless 1920×1080. Meanwhile, the 2026 **TimeWarp** paper on interface drift shows that even modern web agents become brittle when UIs change across versions, layouts, and eras. The lesson generalizes well to game UIs: if you choose a deterministic classifier now, you still need an explicit drift/unknown path rather than assuming a future NHL 27 tab is “close enough.” citeturn34search6turn36search2

My recommendation is therefore:

- **Use the hybrid now** for Pass 1.
- Add a **small MobileNetV3-Small classifier later** only if you want to reduce per-version hand-tuning or generalize across multiple NHL versions.
- Always place an **OOD / unknown-screen gate** in front of the parser.

For the CNN-specific question: I did **not** find a published benchmark that answers “how many labeled frames per class give ~99% accuracy on a fixed sports-game HUD?” directly. The best practical budget I would use is **200–500 distinct frames per class** for a first MobileNetV3 run on one NHL version, and **1,000+ per class** if you want the same model to survive modest cross-version drift. That is an engineering budget, not a published NHL-specific benchmark.

| Approach                                         | Fit for NHL 26 fixed HUDs | Label burden         | Drift behavior                                   | Failure transparency | Recommendation         |
| ------------------------------------------------ | ------------------------- | -------------------- | ------------------------------------------------ | -------------------- | ---------------------- |
| Hybrid color/layout signature + OCR anchors      | Excellent                 | Very low             | Weak unless versioned                            | High                 | **Pick first**         |
| MobileNetV3-Small / EfficientNet-Lite classifier | Good                      | Moderate             | Better than pure signatures, still needs OOD     | Medium               | **Second-best**        |
| General VLM / screenshot understanding model     | Poor for dense pass       | Very high complexity | Better semantic robustness, bad cost/latency fit | Low-medium           | Avoid for primary pass |

The other important Q1 finding is that I did **not** surface an actively maintained, off-the-shelf open-source framework whose main product is “game-UI screen classification across many titles.” What I found instead were **application-specific extraction pipelines**: urlValoscribeturn39view6, urlPractistics Scrim OCRturn12search19, urlScoreSightturn39view8, and game-text OCR projects like urlmeikiocrturn39view5. That pushes the recommendation toward cloning **architecture patterns** from these projects, not waiting for a general framework that does not appear to exist in a mature form. citeturn39view6turn12search19turn39view8turn39view5

## OCR backend choice for small 1080p HUD text

The direct answer to Q2 is **pick RapidOCR on ONNX Runtime GPU first, keep PaddleOCR CUDA as your second-best upgrade path**. RapidOCR’s own README says the project was created by converting PaddleOCR models to ONNX to improve engineering portability and deployment speed; that matters in your stack because you already run an existing RapidOCR-based parser pipeline and you already have ONNX Runtime. PaddleOCR, however, is the larger upstream project by a wide margin and will usually be the first place where newer recognizers and PP-OCR-family improvements appear. citeturn39view0turn39view1

The reason I am **not** recommending Surya, PaddleOCR-VL, or GOT-OCR2 as the primary backend is not that they are weak OCR systems. It is that your problem is **dense, repeated, structured OCR over thousands of small HUD crops**, where classical detector-recognizer stacks still fit better than transformer-heavy document/VLM OCR. Public 2025 comparisons of open OCR models explicitly recommend starting with traditional OCR systems for speed/cost and only escalating to multimodal OCR when the layout is unusually complex. OCRBench v2 also exists precisely because text-centric OCR evaluation has become broader and more difficult, but it is not a sports-HUD benchmark and should not be treated as one. citeturn7search2turn7search6

The most relevant domain analogue I found is urlmeikiocrturn39view5, which is purpose-built for Japanese video game text and states that it significantly outperforms general OCR tools like PaddleOCR and EasyOCR on that domain. That is a very important architecture signal for you: if generic OCR misses too often on NHL broadcast/game fonts, the highest-upside move is probably **domain adaptation or a custom recognizer**, not jumping directly to a VLM. citeturn7search0turn39view5

I did **not** find a trustworthy, apples-to-apples public benchmark that reports **single-image RTX 3060 latency** for all of RapidOCR, PaddleOCR, EasyOCR, Surya, and GOT-OCR2 on **1920×1080 sports-game UI frames or 400×200 HUD crops**. Rather than invent numbers, the table below gives the best deployment judgment supported by the public materials.

| Backend                      | RTX 3060 latency                                                                                                                                                            | Small HUD text fit                                                                | VRAM / cold start                                    | Runtime stack                             | Maintenance signal                                                   | Recommendation        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- | --------------------- |
| urlRapidOCRturn39view0   | No apples-to-apples public 3060 figure surfaced; expected to be among the fastest classical options because it is ONNX-oriented and engineered for rapid offline deployment | Good, especially if your current parsers already work with it                     | Lightest among compared options; low warmup burden   | ONNX Runtime / multi-backend              | 6.5k stars, 1,497 commits visible                                    | **Pick first**        |
| urlPaddleOCRturn39view1  | No trustworthy public 3060 single-image figure surfaced in the reviewed sources                                                                                             | Best classical-stack candidate if RapidOCR misses very small stylized text        | Moderate; higher setup complexity than ORT-only path | Native Paddle / CUDA, many deploy targets | 77.7k stars, 6,881 commits visible                                   | **Second-best**       |
| urlEasyOCRturn39view2    | No trustworthy 3060 figure surfaced; usually a slower/heavier engineering path than ONNX stacks                                                                             | Adequate, but not the best fit for this pipeline                                  | Higher cold-start and PyTorch dependency footprint   | PyTorch                                   | 29.4k stars, 619 commits visible                                     | Third tier            |
| urlSuryaturn39view3      | Public materials reviewed did not surface 3060 per-image HUD numbers; likely too heavy for dense pass                                                                       | Strong general OCR/layout system, but overpowered for primary HUD OCR             | Higher VRAM and noticeably larger warmup burden      | Python / transformer-heavy                | 19.7k stars, 960 commits visible                                     | Fallback / audit path |
| urlGOT-OCR2.0turn39view4 | No apples-to-apples 3060 HUD figures surfaced; unsuitable as dense primary OCR                                                                                              | Strong research OCR/VLM direction, weak fit for high-volume structured extraction | High relative memory/cold-start cost                 | PyTorch / multimodal                      | 8.1k stars, 101 commits visible                                      | Avoid as primary      |
| PaddleOCR-VL                 | No useful public 3060 HUD figures surfaced in reviewed sources                                                                                                              | Better for complex document-style understanding than fixed HUD parsing            | Heavy                                                | VLM                                       | Not reviewed as a standalone maintained repo in the surfaced sources | Avoid as primary      |

The practical implication is blunt: for your workload, **crop quality, timestamp correctness, and parser consensus will likely move accuracy more than swapping among the top two classical OCR stacks**. If you need a big quality jump later, the public evidence suggests the higher-upside move is a domain-adapted recognizer in the spirit of urlmeikiocrturn39view5, not a dense VLM OCR pass. citeturn7search0turn39view5turn7search2

## Segment identification and PySceneDetect tuning

The best answer to Q3 is: **use `detect-adaptive` first, but only as a boundary refiner around candidate windows, not as the only way you discover windows**. The PySceneDetect docs say `detect-adaptive` is a two-pass algorithm that starts with content scores and uses a rolling average to mitigate false detections from camera movement. That maps well to hockey gameplay, where rapid pans and rink motion can generate false cuts. `detect-content` is the baseline comparator, `detect-hist` is simpler and palette-based, `detect-hash` is perceptual-hash based, and `detect-threshold` is for fades rather than your UI overlays. citeturn10view1turn10view2turn11view0turn10view0turn10view3

PySceneDetect’s own issue history reinforces that recommendation. Issue discussions explicitly call out false positives from fast camera movement, and the project notes that `detect-content`/`detect-adaptive` can incorporate edge-based components to help compensate for motion, while `detect-adaptive` exists partly to address those camera-motion false positives. citeturn9view3turn9view5

The part that should change your architecture is this: **static UI overlays are not the same thing as shot boundaries**. Even a perfect shot-boundary detector will miss semantic transitions where a post-game panel slides in without a “scene cut” in the film/TV sense. That is why I would make Pass 1 a two-stage detector:

1. **Whole-video coarse scan** at 1–2 fps with your cheap hybrid classifier.
2. **Boundary refinement** around positive regions with PySceneDetect.
3. **Dense extraction** only inside approved windows.

For alternative segmenters, the clearest public neural baseline remains **urlTransNetV2turn13view0**, whose paper/repo report state-of-the-art shot-boundary performance on ClipShots/BBC/RAI. That is useful if you later want a learned cut detector, but it is still a **shot-boundary detector**, not a semantic “UI overlay detector.” It is a strong alternative to PySceneDetect for hard-cut discovery, not a replacement for your coarse screen-type classifier. citeturn13view0turn13view1

| Detector           | What it actually does                                          | Best fit in your pipeline                                              | Main pitfall                                |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| `detect-adaptive`  | Two-pass HSL/content detector with rolling-average suppression | **Best first pick** for refining transitions near suspected UI windows | Still not a semantic overlay detector       |
| `detect-content`   | Adjacent-frame HSL difference                                  | Good baseline and debugging tool                                       | More false positives during gameplay motion |
| `detect-hist`      | Y-channel histogram difference                                 | Possible helper for palette-heavy UI transitions                       | No temporal smoothing; still cut-oriented   |
| `detect-hash`      | Perceptual hash distance                                       | Niche; useful if large global visual changes dominate                  | Less semantically interpretable             |
| `detect-threshold` | Fade in/out detector                                           | Low relevance here                                                     | Solves the wrong transition type            |

On efficiency: PySceneDetect does **not** magically downsample 60 fps to a lower analysis fps for you. The docs expose `--downscale` and `--frame-skip`; older documentation is explicit about both. One important issue thread notes that frame skipping is not compatible with the adaptive detector in the same way as other detectors, which means for 60 fps hockey capture you should prefer **external coarse sampling** for window discovery instead of assuming Adaptive can cheaply skip half the stream for free. citeturn9view2turn9view4

## WSL2 NVDEC and timestamp-safe frame extraction

### WSL2 NVDEC reliability

The current state of Q4 is: **WSL2 CUDA support is real and usable, but the failure mode is usually build/config mismatch, not “NVDEC fundamentally unsupported.”** NVIDIA’s WSL guide says WSL 2 GPU support is official, requires a current Windows NVIDIA driver, and explicitly warns you **not** to install a Linux display driver inside WSL; it also notes that `nvidia-smi` has a limited feature set in WSL. NVIDIA’s FFmpeg acceleration docs separately say FFmpeg’s NVIDIA path requires `nvcodec-headers` support. citeturn18view0turn18view1turn16search17

The most useful negative evidence is the WSL GitHub issue where a user built FFmpeg in Docker on WSL2 and got `Unknown decoder 'h264_cuvid'` and missing `libnvcuvid.so`. That is exactly the sort of failure you should expect from the wrong FFmpeg build or the wrong container/runtime boundary. In other words: **prove the decoder exists in a plain WSL shell first; only then move it into Docker if you still need Docker.** citeturn19view1turn19view2

For prebuilt FFmpeg, the public evidence I trust most is **urlBtbN FFmpeg Buildsturn15view0**. FFmpeg’s own download page says FFmpeg itself distributes source and links to third-party builds, and BtbN is one of the most actively maintained binary build channels I surfaced; its repo is large and its releases page showed a latest auto-build on **May 12, 2026**. citeturn20search5turn15view0turn15view1

My WSL2 diagnostic checklist would therefore be:

```bash
# Confirm WSL sees the GPU
nvidia-smi

# Confirm ffmpeg was built with hwaccel support you need
ffmpeg -hide_banner -hwaccels
ffmpeg -hide_banner -decoders | grep -E 'cuvid|nvdec|h264_cuvid|hevc_cuvid'

# Probe a file without writing frames
ffmpeg -hide_banner -benchmark -loglevel verbose \
  -hwaccel cuda -c:v h264_cuvid -i input.mp4 -f null -

# If using Python/TorchAudio, verify the decoder is visible there too
python - <<'PY'
from torchaudio.utils import ffmpeg_utils
print([k for k in ffmpeg_utils.get_video_decoders().keys() if "cuvid" in k])
PY
```

That sequence is grounded in NVIDIA’s WSL and FFmpeg acceleration documentation, plus TorchAudio’s NVDEC tutorial showing direct enumeration of `h264_cuvid` and related decoders. citeturn18view0turn18view1turn24view0

On expected speed: NVIDIA’s NVDEC application note gives **Ampere H.264 decode at 748 fps per NVDEC engine** for 1920×1080 YUV420 under its lab conditions, and also says all GeForce products have a **single NVDEC**. That means your RTX 3060 has plenty of raw decode headroom relative to 60 fps input. But real-world forum evidence shows that single-process library pipelines can underutilize the video decoder because parser, frame mapping, synchronization, and host/device transfer overhead dominate. TorchAudio’s own tutorial also notes that hardware decode can be slower than software at lower resolutions and only becomes faster at higher resolutions. So the realistic answer is: **decode itself should not be your main bottleneck, but wall-clock gains can still be modest if you immediately pull frames back to CPU and write PNGs.** citeturn21view0turn22view0turn24view0

### VFR, PTS, and frame naming

The direct answer to Q5 is: **make PTS your source of truth and demote frame index to a debugging aid.** FFmpeg says `-fps_mode passthrough` passes frames with demuxer timestamps, `-copyts` preserves input timestamps, and the image2 muxer can use `frame_pts=1` to expand output filenames with packet PTS. FFmpeg also documents `fflags=+genpts` as a way to generate missing PTS when DTS exists. PyAV exposes the same timestamp machinery directly in Python. citeturn27view0turn27view2turn29view0turn30view0turn32search1turn32search2turn32search15

A safe preflight for any incoming OBS/ShadowPlay/Xbox file is:

```bash
# Packet timeline
ffprobe -v error -select_streams v:0 \
  -show_packets \
  -show_entries packet=pts_time,dts_time,duration_time,flags \
  -of json input.mp4 > packets.json

# Decoded-frame timeline
ffprobe -v error -select_streams v:0 \
  -show_frames \
  -show_entries frame=best_effort_timestamp_time,pkt_dts_time,pict_type,coded_picture_number \
  -of json input.mp4 > frames.json
```

Then, if you still want files on disk, preserve timestamps in filenames:

```bash
ffmpeg -v error -copyts -start_at_zero -fps_mode passthrough \
  -i input.mp4 -map 0:v:0 -f image2 -frame_pts 1 frames/%012d.png
```

Those flags are straight from FFmpeg’s own documentation. The key point is that once you sample with an `fps=` filter you are creating a new cadence, so either keep a manifest from output image to source PTS or just do the sampling in PyAV using `Frame.pts * Frame.time_base`. FFmpeg/Frigate issue threads from security-camera deployments also make the cost of bad timestamps concrete: unset timestamps and out-of-order playback really do break production systems. citeturn27view0turn27view2turn30view0turn33search9turn33search6

## Robustness patterns for version migration

The best answer to Q6 is: **make version-awareness a first-class concept in the pipeline.** Do not let “screen type” implicitly mean “screen type on whatever game build happens to be in the file.” Public examples already point in that direction. The author of urlValoscribeturn39view6 says the tool was built for the Champions 2025 broadcast HUD. The 2026 **TimeWarp** paper shows that interface drift is not a theoretical nuisance; it materially degrades model behavior across UI versions. citeturn12search5turn36search2

For OOD detection, the most sensible pair of methods for your use case is a **logit-based score plus a feature-space score**. The 2025 task-oriented OOD survey is a good modern overview, the 2020 energy-based paper is the canonical logit-space baseline, and the 2018 Mahalanobis paper remains the classic feature-space post-hoc detector. More recent work also argues that hybrid combinations of feature- and logit-based scores can outperform either alone because they fail differently. For a small screen classifier, that means a practical gate such as:

- max-softmax or energy score on the screen classifier output,
- embedding distance to the nearest class centroid or exemplar bank,
- parser-level schema checks after classification.

If any of those fail, the frame becomes `unknown_screen` and is **not parsed**. citeturn37search2turn37search3turn38search1turn38search6

My concrete version-management pattern would be:

- `artifacts/screencls/nhl26/v1/...`
- `artifacts/screencls/nhl27/v1/...`
- `configs/parsers/nhl26/*.yaml`
- `configs/parsers/nhl27/*.yaml`
- a visual version detector that runs **before** layout parsing, using stable anchors such as logo treatment, tab order, header strings, or roster typography.

I would **not** rely on container metadata for game-version detection. Capture metadata usually tells you about OBS/encoder/container, not the game build. Visual signatures are the more reliable source.

## Open questions and limitations

Two important public-data gaps remained after this review.

The first is that I did **not** find a clean, trustworthy, apples-to-apples benchmark for **RapidOCR vs PaddleOCR vs EasyOCR vs Surya vs GOT-OCR2 on RTX 3060 for NHL-style 1080p HUD crops**. Public sources are good on architecture, maintenance, and broad OCR benchmarks, but weak on this exact deployment scenario. That is why the OCR recommendation above is based on **fit-to-stack and model family behavior**, not a fabricated latency leaderboard.

The second is that I did **not** surface a mature open-source framework whose main purpose is **game-UI screen classification across titles and versions**. The open-source ecosystem is full of valuable analogous tools, but they tend to be bespoke HUD/OCR pipelines rather than reusable classification frameworks.

## Top findings most likely to change your architecture

- **Do not make PySceneDetect your only Pass 1 gate.** Use a cheap whole-video classifier at 1–2 fps to discover candidate UI windows, and then use `detect-adaptive` only to refine the edges. Scene-cut tools solve cut detection; your problem is semantic overlay discovery. citeturn9view0turn10view1turn10view2turn13view1

- **Keep RapidOCR, but move it to GPU before swapping OCR families.** The strongest public evidence favors classical OCR first and multimodal OCR only as fallback, and RapidOCR was explicitly created to turn PaddleOCR models into a more deployment-friendly ONNX path. citeturn39view0turn39view1turn7search2

- **Promote PTS to the canonical clock.** FFmpeg and PyAV both give you timestamp-safe workflows; frame index should become a secondary diagnostic field, not the source of truth for event time. citeturn27view0turn27view2turn30view0turn32search15

- **Version the classifier and parser separately, and add an unknown-screen/OOD gate.** Public HUD-extraction projects are already version-pinned, and the modern OOD literature gives you practical post-hoc tools like energy and Mahalanobis scores to fail closed instead of silently misparsing. citeturn12search5turn36search2turn37search3turn38search1

- **Treat decode throughput as secondary to I/O and extraction policy.** The RTX 3060 has more than enough raw NVDEC capacity for 1080p60, but real pipelines still lose time to frame mapping, transfer, and image writing. The big architecture win is therefore not “decode faster at all costs”; it is “decode fewer frames, write fewer files, and only OCR inside high-confidence windows.” citeturn21view0turn22view0turn24view0
