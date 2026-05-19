# Redesign Round 2 — External Internet Research

**Date:** 2026-05-19
**Author:** Round-2 research agent (Claude Opus 4.7, via Claude Code)
**Scope:** External, public-internet survey of production wisdom on video-to-structured-data OCR pipelines, as input to the four-round NHL Pro Clubs OCR redesign.
**Companion docs:**
- Round 1 (internal): `docs/calibration/redesign-round-1-internal-2026-05-19.md`
- Round 2 prompt: `docs/calibration/redesign-round-2-prompt.md`
- Round 3 (deep-research literature review): in flight, parallel
- Round 4 (Codex synthesis): pending

## 0. Reading guide and methodology notes

Every claim below is followed by a URL. Where I read the source directly with `WebFetch` I quote it; where `WebFetch` was denied or the page was too thin, I rely on the search-engine summary and label the claim as such. I tried to read the actual README / paper / blog post in every case before citing, and I flag explicitly when I could not.

I want to flag the **publication-date weirdness** in the OCR-benchmark literature up front: several of the most-cited papers carry 2025 / 2026 / 2603 / 2605 arXiv IDs. Some are bona-fide preprints from earlier in 2025; some appear to be late-2025 / early-2026 work that arXiv indexed with non-standard month codes. I treat anything dated 2024-or-later as "modern" without trying to resolve the calendar question, because the engineering wisdom is what matters here, not citation hygiene.

The deeper meta-finding before I get to the sections: **for our problem (single-author, low-volume, no ground-truth API, annual UI churn, ~30 matches/season, ≥98% per-field accuracy), there is almost no directly-applicable production wisdom in the public literature.** Every adjacent community has either (a) a replay file, an in-game memory hook, or an official API that beats OCR badly enough that nobody publishes the OCR-only path; or (b) a broadcast-feed problem that runs at orders of magnitude higher volume and tolerates orders of magnitude more error. The blank space in the middle — "I have ~30 videos a year, no API, and I need near-perfect numbers" — is genuinely uninhabited. I'll come back to this in §11.

---

## 1. State of the art in structured-data OCR from video — adjacent domains

### 1.1 Sports broadcast scoreboard/graphics extraction

The big-money telemetry providers (Stats Perform, Sportradar, Genius Sports, Hawk-Eye, Hudl) publish almost nothing useful about how they do scoreboard OCR specifically. Their public engineering content is dominated by ball-tracking, player-tracking, and event-classification — all things that are downstream of, but distinct from, reading the scorebug.

The most concrete piece is the **AWS engineering blog on Sportradar's near-real-time soccer goal predictor** ([aws.amazon.com/blogs/machine-learning/predicting-soccer-goals-in-near-real-time-using-computer-vision](https://aws.amazon.com/blogs/machine-learning/predicting-soccer-goals-in-near-real-time-using-computer-vision/), Aug 2022; updated coverage at [amazon.science 2024](https://www.amazon.science/latest-news/how-some-of-awss-most-innovative-customers-are-using-computer-vision-technologies)). Key numbers Sportradar publishes:

- Goal-prediction model: I3D (inflated-3D) backbone, fine-tuned on SageMaker, **75% precision at 90% recall**.
- Per-inference latency **~200 ms**, end-to-end including ingestion **~700 ms**.
- Production stack: EKS + MSK (Kafka) + FSx for Lustre, GPU and CPU instances side by side.

Note the precision number — **at production telemetry scale, 75% precision is fine** because (a) other signals (audio crowd noise, optical flow, OCR scorebug delta) gate it and (b) telemetry-as-a-service is allowed to be a few seconds wrong if it self-corrects. This is the polar opposite of our regime, where one wrong assist credit on a 17-game career stat is a visible bug.

The **AWS Architecture blog on data pipelines for sporting events** ([aws.amazon.com/blogs/architecture/building-a-data-pipeline-for-tracking-sporting-events-using-aws-services](https://aws.amazon.com/blogs/architecture/building-a-data-pipeline-for-tracking-sporting-events-using-aws-services/), Aug 2021) and the **Hawk-Eye + Flink + Amazon MSK piece** ([aws.amazon.com/blogs/media/hawk-eye-innovations-powers-real-time-sports-data-with-flink-and-amazon-msk](https://aws.amazon.com/blogs/media/hawk-eye-innovations-powers-real-time-sports-data-with-flink-and-amazon-msk/)) both treat scoreboard reading as one input of many fused into a streaming event store. They don't disclose the OCR engine. **Silence is data here:** the providers are evidently not building public-facing scoreboard OCR libraries; the scoreboard is just one signal feeding a fusion layer.

The closest thing to a public engineering writeup of broadcast scoreboard OCR is the **API4AI Medium post "Scoreboard OCR Meets Logo Metrics: Context Matters"** ([medium.com/@API4AI/scoreboard-ocr-meets-logo-metrics-context-matters-14824e6c9325](https://medium.com/@API4AI/scoreboard-ocr-meets-logo-metrics-context-matters-14824e6c9325)). WebFetch was denied on this URL; the search-engine summary surfaces the operational rules:
- "Normalize timestamps across feeds (program feed, iso cameras, scoreboard crop) and use the scoreboard clock as ground truth."
- "Implement simple sanity rules (scores only increase, periods change in known sequences) to smooth short OCR hiccups during wipes or replays."

That last point is the only piece of broadcast-OCR wisdom that transfers directly to us: **monotonic / structurally-constrained fields (score, period, shot count) should drive temporal smoothing rather than the OCR votes themselves.** I'll come back to this in §10.

**ScoreSight** ([github.com/royshil/scoresight](https://github.com/royshil/scoresight)) is the most production-grade open-source scoreboard-OCR tool. README highlights I confirmed by WebFetch:
- Engine: **Tesseract**.
- Stack: Qt6 + OpenCV + Python (~99% Python).
- Pipeline elements named: "perspective correction", "image processing and binarization techniques, local, global etc.", "camera bump and drift correction with stabilization algorithm".
- Claimed rate: "up to 30 updates/s", "unlimited detection boxes".
- **Status flag at the top of the README:** "⚠️ Stalled ⚠️ This project is not under active development."
- README does **not** publish accuracy, per-frame cost, or robustness numbers. This is the typical state of open-source broadcast OCR tooling: works enough for a streamer, never validated to a number, and ultimately abandoned.

The OBS forum thread on ScoreSight ([obsproject.com/forum/resources/scoresight-free-open-source-ocr-tool-for-gaming-and-scoreboards.1884](https://obsproject.com/forum/resources/scoresight-free-open-source-ocr-tool-for-gaming-and-scoreboards.1884/)) was access-denied to WebFetch, but the listing description (via SERP) lists "for Gaming and Scoreboards" as the primary positioning — i.e., the same tool is being used in both broadcast and game-overlay contexts by hobbyists. The cross-pollination between broadcast and game-UI OCR communities is real but very shallow technically.

XY Kao's blog on "Real-time scoreboard digit recognition (OCR) with a webcam" ([xy-kao.com/projects/scoreboard-ocr-with-python-webcam](https://xy-kao.com/projects/scoreboard-ocr-with-python-webcam/)) is one of the few writeups that names a concrete digit-OCR pipeline: HSV thresholding with multiple color ranges (e.g., `(20,40,40)–(40,255,255)`, `(170,60,60)–(180,255,255)`, `(0,60,60)–(10,255,255)`), erosion to fatten segments, contour-based per-digit ROI extraction, and Tesseract on per-digit crops rather than the whole frame. (WebFetch was denied; this is the SERP summary of his content.) The seven-segment-display angle ([w3tutorials.net/blog/digital-numbers-on-tesseract-ocr](https://www.w3tutorials.net/blog/digital-numbers-on-tesseract-ocr/)) confirms a general theme: **Tesseract on whole frames of stylized digits performs poorly; Tesseract on per-digit binarized crops with custom traineddata performs much better.** That tradition lives on in PaddleOCR and RapidOCR pipelines too (see §3).

### 1.2 eSports / game-video data extraction

**League of Legends.** This community has by far the most evidence and the most decisive take: **OCR is a fallback. Real production runs through Riot's live-client API, the spectator endpoint, replay-file parsers, or game memory.** Concrete sources:

- `floh22/LeagueOCR` ([github.com/floh22/LeagueOCR](https://github.com/floh22/LeagueOCR)). Explicitly positioned to "augment the official Riot Games API"; the entire selling point is filling gaps the API doesn't expose. WebFetch'd README confirms there is **no documented OCR engine, architecture, classification methodology, or accuracy number** in the public README; the author calls the codebase "somewhat of a mess in parts". This is what a real production OCR effort in this domain looks like: a stop-gap with no published validation.
- `floh22/LeagueBroadcast` ([github.com/floh22/LeagueBroadcast](https://github.com/floh22/LeagueBroadcast)). The same author's preferred path. Quote (WebFetch'd): *"League Broadcast uses Memory Reading to get information that the Riot API does not expose."* And the kicker, again WebFetch'd verbatim: *"This repo no longer functions due to the introduction of Vanguard."* This is the canonical story arc for "go around the OCR layer by reading memory": works until the anti-cheat update kills it. Confirmed by the Riot dev blog on Vanguard for LoL ([leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/), May 2024) and external coverage at [esportsheaven.com](https://www.esportsheaven.com/features/the-cracks-in-riot-vanguards-shield-anti-cheat-and-the-secret-battle-with-hackers/). EASHL does not have this problem because EA does not run an in-game anti-cheat capable of blocking memory reads — but EA also does not expose a live API.
- `pyLoL` ([github.com/league-of-legends-replay-extractor/pyLoL](https://github.com/league-of-legends-replay-extractor/pyLoL)). Uses **YOLO-v12 for champion tracking** (input 512×512 px, mAP 92.2%, precision 91.3%, recall 90.2% per WebFetch'd README) plus an OCR module to grab realtime KDA and CS. README does **not** name the OCR engine. Note the YOLO-not-OCR choice for the harder visual problem (champions on minimap) — this is the established eSports pattern: **bespoke object detection for visually identifiable entities, OCR only for hard text that nothing else can produce.**
- `RCVolus/league-prod-toolkit` ([github.com/RCVolus/league-prod-toolkit](https://github.com/RCVolus/league-prod-toolkit)) and `Sky-CSC/OSL` ([github.com/Sky-CSC/OSL](https://github.com/Sky-CSC/OSL)) both wrap Riot's live client + spectator APIs, not OCR. These are the actively-maintained projects.
- Henry Zhu's writeup "League of Legends data scraping the hard and tedious way for fun" ([maknee.github.io/blog/2025/League-Data-Scraping](https://maknee.github.io/blog/2025/League-Data-Scraping/), Feb 2025; HN discussion at [news.ycombinator.com/item?id=43024173](https://news.ycombinator.com/item?id=43024173)). Both WebFetches denied; per SERP this is a packet-decryption / Unicorn-Engine binary-instrumentation pipeline, not OCR. Author explicitly notes that decryption keys rotate with patches and that the emulator helps because *"the decryption changes often with game updates"*. The community direction in 2025 was clearly **away from pixel-level extraction and toward whatever lower-level interface still works**. Until Vanguard.

**Counter-Strike.** `markus-wa/demoinfocs-golang` ([github.com/markus-wa/demoinfocs-golang](https://github.com/markus-wa/demoinfocs-golang), [pkg.go.dev/.../v2/pkg/demoinfocs](https://pkg.go.dev/github.com/markus-wa/demoinfocs-golang/v2/pkg/demoinfocs), [pkg.go.dev/.../v4/pkg/demoinfocs](https://pkg.go.dev/github.com/jimppan/demoinfocs-golang/v4/pkg/demoinfocs)) is the canonical CS:GO / CS2 demo parser. Valve's own `csgo-demoinfo` ([github.com/ValveSoftware/csgo-demoinfo](https://github.com/ValveSoftware/csgo-demoinfo)) is the upstream reference. Forks at FaceIt ([github.com/faceit/demoinfocs-golang](https://github.com/faceit/demoinfocs-golang)) confirm production usage. **CS:GO has no community HUD-OCR project of any meaningful size** because every match generates a `.dem` file that contains every event at tick resolution. **Searched explicitly; there is no community HUD-OCR tool I can find — this is the loudest possible negative result for "OCR a game UI when a replay parser exists".**

**Rocket League.** Same pattern. `nickbabcock/boxcars` (Rust, [github.com/nickbabcock/boxcars](https://github.com/nickbabcock/boxcars)) and `tfausak/rattletrap` (Haskell, [github.com/tfausak/rattletrap](https://github.com/tfausak/rattletrap), Hackage at [hackage.haskell.org/package/rattletrap](https://hackage.haskell.org/package/rattletrap)) parse `.replay` files. `nickbabcock/rrrocket` ([github.com/nickbabcock/rrrocket](https://github.com/nickbabcock/rrrocket)) is the CLI wrapper. Boxcars README notes a "1000x speedup if you're only interested in the header (where tidbits like goals and scores are stored)" — i.e., the structured data is **literally inside the file**. There is no HUD-OCR project. The community's overlay/stats stack instead lives in **BakkesMod** ([bakkesplugins.com](https://bakkesplugins.com/), `Lyliya/RocketStats` at [github.com/Lyliya/RocketStats](https://github.com/Lyliya/RocketStats)), which is a memory-injection mod that exposes session stats directly to OBS overlays. **Memory injection > OCR > replay-file parsing in latency; replay parsing > OCR in offline accuracy** is the implicit RL community ranking.

**Apex Legends / Fortnite.** This is the closest analogue to our problem and the most useful comparison:

- `Kaiserouo/Apex-Legends-Tracker-Video-OCR` ([github.com/Kaiserouo/Apex-Legends-Tracker-Video-OCR](https://github.com/Kaiserouo/Apex-Legends-Tracker-Video-OCR)). WebFetch'd README quotes:
  - Engine: **pytesseract / Tesseract**.
  - Single-pass over frames, no preprocessing pipeline described.
  - **Self-reported performance: "For example.mkv (10fps, 2 min 39 sec), it took like 10 minutes."** That's roughly real-time × 4 on CPU Tesseract — slower than the 1 fps + dense Pass-2 design we already have.
  - Self-reported accuracy: "It will have some mistakes, but checking the numbers is faster than typing them." The author explicitly designs for manual post-correction.
- `remram44/apex-legends-ocr-data` ([github.com/remram44/apex-legends-ocr-data](https://github.com/remram44/apex-legends-ocr-data)). Uses "Python, Tesseract, OpenCV" per the GitHub topic tags. README content was not surfaced.
- Apex Legends Tracker API ([apex.tracker.gg/site-api](https://apex.tracker.gg/site-api), [apexlegendsapi.com](https://apexlegendsapi.com/), [tracker.gg/developers/docs/titles/apex](https://tracker.gg/developers/docs/titles/apex)). Tracker Network and ApexLegendsAPI both run **unofficial** APIs scraped from EA's own backend. This is the same pattern we're on with `proclubs.ea.com`.

The **Apex community explicitly built OCR tools because the unofficial API only exposes selected legends and selected fields**, not because OCR is the right tool. The community has converged on: API for what you can get, OCR for the gaps, accept manual cleanup. This is exactly what we are building against — but with a key difference: our team is one person, and our acceptable error budget for things like build attributes is essentially zero, because every wrong number poisons cross-game career aggregates.

**EA NHL (EASHL) and Madden communities.**

- `eliashussary/chelstats` ([github.com/eliashussary/chelstats](https://github.com/eliashussary/chelstats)). WebFetch'd README: *"Their API powering the stats site provides _alot_ more data. CHEL STATS aims to present _all_ of the stats available directly from EA's API."* **Pure EA Pro Clubs API. No OCR.**
- `ravibhagw/chelstats` ([github.com/ravibhagw/chelstats](https://github.com/ravibhagw/chelstats), retrospective blog at [ravib.dev/personal-projects/2024/01/30/parsing-from-api.html](http://ravib.dev/personal-projects/2024/01/30/parsing-from-api.html)). Wrapper around `nhl14proclubs`. SERP-derived: *"EA has decommissioned the legacy API and has locked down its newer API with API keys (effectively limiting access to authorized parties), bringing the original chelstats project to an end."* This is critical for §6: **EA has, at least once, locked down a Pro Clubs API after the community built on it.** The current open endpoint (`proclubs.ea.com/api/nhl/clubs/matches?...`) is the second-generation endpoint, and EA forum posts confirm the community lives in fear of it disappearing ([answers.ea.com EASHL API thread](https://answers.ea.com/t5/World-of-CHEL/eashl-api/m-p/13491808), [forums.ea.com 26 EASHL Clubs Website and API](https://forums.ea.com/discussions/nhl-26-general-discussion-en/26-eashl-clubs-website-and-api/12548651)).
- `chelhead.com` ([chelhead.com](https://chelhead.com/), FAQ at [chelhead.com/faq/](https://chelhead.com/faq/)). WebFetch denied. Per SERP: *"ChelHead collects data directly from EA Sports' Pro Clubs data sources... However, the APIs are internal, undocumented, and designed as APIs to power specific frontends, which often cause breaking changes without notice for each edition of the game."* This is the live confirmation that the entire NHL-26-era community is **API-anchored, not OCR-anchored**, and the API behavior breaks across game versions.
- `glebb/eashl` ([github.com/glebb/eashl](https://github.com/glebb/eashl)). WebFetch'd README: *"The app uses public ea sports urls to fetch data in json format... This project is not active. Stuff worked until NHL 16 but after that it's not been updated."* Same pattern: pure API, broke at a game-version bump, abandoned.
- `devinmcinnis/eashl` ([github.com/devinmcinnis/eashl](https://github.com/devinmcinnis/eashl)). Per search: "Player stat tracker for EASHL NHL13." Same story.

**Conclusion for EASHL specifically: there is no public OCR-based stat tracker for EA NHL. The community has tried the API path five separate times and watched it break.** Our project is doing something the community has effectively given up on — but for a defensible reason: OCR gives us fields the API never exposed (X-factor activations, shot locations, build attributes, gamertag-anchored persona identity, etc.).

**Madden stat-trackers** in the public space ([theedgepredictor/nfl-madden-data](https://github.com/theedgepredictor/nfl-madden-data), forums.operationsports CFM spreadsheet thread) appear to all be **manually-entered** CFM (Connected Franchise Mode) data sheets, not OCR. The closest published OCR-for-football work is the academic `next-gen-scraPy` ([ar5iv.labs.arxiv.org/html/1906.03339](https://ar5iv.labs.arxiv.org/html/1906.03339)), which extracts NFL pass tracking from **broadcast graphics screenshots**, not from Madden gameplay. So the Madden community confirms the EASHL pattern: **no one has built a production OCR pipeline for an EA sports game**.

### 1.3 Document-AI / form-OCR pipelines applied to game UIs

The big-five academic models — **LayoutLMv3, Donut, Pix2Struct, ScreenAI, Florence-2** — all theoretically apply, but none have surfaced as a serious production foundation for game-UI extraction in the open source ecosystem I searched.

- **Donut** ([github.com/clovaai/donut](https://github.com/clovaai/donut), [huggingface.co/docs/transformers/en/model_doc/donut](https://huggingface.co/docs/transformers/en/model_doc/donut)). Naver Clova's OCR-free document Transformer. The selling point per the Medium writeup ([medium.com/data-science/ocr-free-document-understanding-with-donut-1acfbdf099be](https://medium.com/data-science/ocr-free-document-understanding-with-donut-1acfbdf099be)): "Unlike older models that do OCR first and then pass results to an NLP layer (a two-step process prone to cascading errors), Donut skips the explicit OCR step entirely." Fine-tunes well on small datasets (CORD, RVL-CDIP), publishes pretrained checkpoints. **No public reports of Donut being fine-tuned on game UIs.** It would in principle be a natural fit for "screen-type-of-frame → structured JSON" — but you'd be the first one publishing.
- **Pix2Struct** ([arxiv.org/abs/2210.03347](https://arxiv.org/html/2210.03347), [huggingface.co/docs/transformers/model_doc/pix2struct](https://huggingface.co/docs/transformers/model_doc/pix2struct)). Google's image-to-text model "pretrained by learning to parse masked screenshots of web pages into simplified HTML". Per the paper, "in low-resource domains such as illustrations and UIs, there are significant improvements (ranging from 1 to 44 points)". This is the closest published model to our problem domain. Like Donut, **zero public game-UI fine-tunes that I can find.** Has a UI-fine-tuned checkpoint (Pix2Struct-UI) but it's screenshot-to-caption / VQA, not screenshot-to-JSON.
- **ScreenAI** ([arxiv.org/abs/2402.04615](https://arxiv.org/html/2402.04615), Google, Feb 2024). 5B-parameter VLM specifically pretrained on UI and infographics. State-of-the-art on UI question answering. Not open-weights as of my searches — Google has not released the model. Useful as a benchmark of "what is possible" but not as a usable production tool.
- **LayoutLMv3** ([huggingface.co/blog/document-ai](https://github.com/huggingface/blog/blob/main/document-ai.md)). Still OCR-dependent (it consumes OCR boxes as input). The whole point of switching architectures in our regime is to escape the OCR-engine-first cascade, so LayoutLMv3 doesn't help.
- **Florence-2** ([huggingface.co/blog/PandorAI1995/ocr-processing-text-in-image-analysis-vlm-models](https://huggingface.co/blog/PandorAI1995/ocr-processing-text-in-image-analysis-vlm-models)). 230M / 770M params, runs locally on consumer GPUs, "accepts both images and text prompts and outputs text for tasks such as captioning, object detection, segmentation, OCR, and region-based grounding". Public weights, public license. **Plausibly the most relevant single model for a redesign**; see §3 for the cost / accuracy tradeoff and §8 for negative-results caveats.

**PaddleOCR-Structure** and **RapidOCR** are the production-grade open-source text-detection-plus-recognition stacks. PaddleOCR's PP-OCRv5 release notes claim "13% accuracy boost over previous versions" while keeping "Extreme Efficiency" per its own blog ([medium.com/@alex_paddleocr/pinpoint-performance-bottlenecks-with-paddleocr-v3-2s-fine-grained-benchmark](https://medium.com/@alex_paddleocr/pinpoint-performance-bottlenecks-with-paddleocr-v3-2s-fine-grained-benchmark-d7ba18d63f7d)). RapidOCR is the ONNX-runtime port of PP-OCR; CUDA-backed RapidOCR is what we currently run at ~336 ms/full-frame on a 3060. PP-OCRv5 ([huggingface.co/PaddlePaddle/PP-OCRv5_server_det](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det)) and PaddleOCR-VL (a fine-tuned VLM, 94.50 overall on OmniDocBench per LlamaIndex blog [llamaindex.ai/blog/omnidocbench-is-saturated-what-s-next-for-ocr-benchmarks](https://www.llamaindex.ai/blog/omnidocbench-is-saturated-what-s-next-for-ocr-benchmarks)) are the obvious in-family upgrade path.

---

## 2. Single-pass vs two-pass vs event-driven OCR — production tradeoffs

The published literature on this is dominated by two camps that don't really talk to each other: (a) academic broadcast-video researchers who use HMM/Viterbi state-decoding of UI events, and (b) operations-blog writers who run single-pass dumb pipelines at scale and accept the accuracy hit.

### 2.1 HMM / Viterbi over UI state — does anybody use this in production?

Closest published work is the **arxiv survey "Content-aware Video Analysis for Sports"** ([arxiv.org/pdf/1703.01170](https://arxiv.org/pdf/1703.01170)) and the cricket-highlight-generation paper ([openaccess.thecvf.com/content_cvpr_2018_workshops/papers/w34/Shukla_Automatic_Cricket_Highlight_CVPR_2018_paper.pdf](https://openaccess.thecvf.com/content_cvpr_2018_workshops/papers/w34/Shukla_Automatic_Cricket_Highlight_CVPR_2018_paper.pdf)). HOG + color histogram + HMM is the canonical recipe; Viterbi is used to recover "Story Start / Advertisement / Action" state sequences. The cricket paper explicitly names OCR over the scorebug as one of the "event-driven features" feeding the HMM emission distribution.

But these are academic and the published F1 / accuracy numbers are domain-specific. **No production tracker I found writes about HMM/Viterbi by name**, partly because for telemetry use cases the providers already get high-frequency events from non-vision feeds and don't need to denoise frame classifications.

The closest production analogue is the **API4AI scoreboard piece** mentioned in §1.1 — "monotonic score, period sequence" sanity rules are the operational shadow of a transition matrix. **Constraint-based filtering is what HMM-decoding looks like when nobody admits to using it.**

### 2.2 Event-driven frame selection

The most relevant new paper I found is **Event-Anchored Frame Selection (EFS)** ([arxiv.org/html/2603.00983](https://arxiv.org/html/2603.00983), OpenReview at [openreview.net/forum?id=43Ycr1QZXr](https://openreview.net/forum?id=43Ycr1QZXr)). Quote (SERP-derived): "Event-Anchored Frame Selection (EFS) is a hierarchical, event-aware pipeline that partitions the video stream into visually homogeneous temporal segments serving as proxies for semantic events, then selects the most query-relevant frame as an anchor within each event. This approach shows substantial gains in OCR problems (+7.91%), along with improvements in spatial and temporal perception tasks."

The pattern they describe is **exactly the two-pass design we have** — segment into homogeneous regions, then sample within each segment. The differences are:
- They select one anchor per segment; we sample densely. For our regime (stylized fonts, low confidence) **denser sampling is a legitimate accuracy gain** (see §10), so the EFS recipe is not strictly superior.
- They optimize for VLM cost (frames-as-tokens); we run RapidOCR locally where the marginal frame is cheap. **Our cost calculus is different in kind.**

The DEV.to writeup "Cutting Costs 13-45% with Frame Dedup + Scene Detection" ([dev.to/pritom14/how-i-built-video-token-optimization-for-vision-llms-cutting-costs-13-45-with-frame-dedup-scene-2ic](https://dev.to/pritom14/how-i-built-video-token-optimization-for-vision-llms-cutting-costs-13-45-with-frame-dedup-scene-2ic)) is the operational variant: scene-change detect, dedup near-identical frames, send only what's left to a VLM. Same conclusion: scene-change-driven selection is a cost lever for VLM pipelines, not an accuracy lever for traditional OCR pipelines.

**Where two-pass fails** in the published wisdom:
- **Stylized text the screen-classifier mis-segments as `unknown_screen`**, dropping the whole window. This is the failure mode our internal Round 1 already named. EFS doesn't actually rescue you from this — if your classifier misses the event, the event never enters the OCR pipeline.
- **Transitions and overlays.** The API4AI piece: "smooth short OCR hiccups during wipes or replays." During NHL 26 X-factor activation animations, the score bug is briefly occluded or animated; if the anchor frame falls in the animation, that segment loses its score read.
- **Cross-segment fields.** Some downstream tables (event lists, build attributes) are spread across multiple segments. A pure per-segment promoter cannot fuse them.

**Where event-driven (1-pass-with-trigger) fails** in the published wisdom:
- **No event signal in source.** Cricket / soccer can hook audio crowd noise, goal whistles, or commentary keywords. EA NHL replays have none of these reliably (canned crowd loops; commentary is generic; no whistle audio markers that survive a screen recording at variable bitrate). The event-driven approach requires an event detector that isn't itself OCR — and for EA NHL we don't have one.
- **False-negative latency.** If you wait for a state transition, you miss the start. The "first kickoff scorebug" problem in soccer broadcast pipelines is real and is why providers run continuous frame sampling parallel to event-driven triggers.

The honest production summary: **two-pass dominates in practice**, because event-driven approaches require an event detector you don't have, and single-pass dense-OCR approaches are too expensive at broadcast scale. Our 1-fps + dense-Pass-2 design is already the consensus shape; **the question is not whether to change shape but how to harden Pass 1 and how to add a third stage (consensus / probabilistic / VLM-arbitration) on top.**

---

## 3. OCR engines compared in production for stylized game UI

### 3.1 Headline numbers from the only video-OCR benchmark that exists

**VideoDB OCR Benchmark** ([github.com/video-db/ocr-benchmark](https://github.com/video-db/ocr-benchmark), paper at [arxiv.org/abs/2502.06445](https://arxiv.org/abs/2502.06445), HN discussion at [news.ycombinator.com/item?id=43045801](https://news.ycombinator.com/item?id=43045801), Feb 2025). 1,477 manually annotated frames across code editors, news broadcasts, YouTube videos, and advertisements. Models compared: Claude-3, Gemini-1.5, GPT-4o, EasyOCR, RapidOCR. Headline numbers per the SERP summary:

- **GPT-4o: 76.22% accuracy** (best overall).
- **EasyOCR: 49.30% accuracy** (worst, traditional).
- Gemini-1.5 Pro "drops to ~50% accuracy on financial content despite achieving 76.13% overall" — i.e., **domain shift hammers VLMs harder than the headline suggests.**
- Named failure modes: "hallucinations, content security policies, and sensitivity to occluded or stylized text".

The benchmark does **not** include a game-UI domain. Closest analogue is "news broadcasts" and "advertisements", both of which contain stylized text but are designed to be readable. **Game scoreboards under animation are harder than either.**

### 3.2 MME-VideoOCR

**MME-VideoOCR** ([mme-videoocr.github.io](https://mme-videoocr.github.io/), [arxiv.org/abs/2505.21333](https://arxiv.org/abs/2505.21333), May 2025). 10 task categories, 25 tasks, 44 scenarios, 1,464 videos, 2,000 manually-annotated Q/A pairs. **18 state-of-the-art MLLMs evaluated.** Headline number (per SERP): "even the best-performing model (Gemini-2.5 Pro) achieved an accuracy of only 73.7%."

Named failure modes: "motion blur, temporal variations, and visual effects inherent in video content". This is the exact failure-mode list that hurts an NHL game recording: animated scorebug transitions, X-factor flash overlays, replay-camera cuts.

**Translating to our regime: if Gemini-2.5 Pro tops out at 73.7% on the published video-OCR benchmark, no contemporary VLM is anywhere near our ≥98% target for end-to-end frame-to-JSON.** They will work for low-stakes fields and as arbiters; they will not work as the sole OCR. Multiple independent commentators echo this — for example, the chart-degradation paper "Losing the Plot" ([arxiv.org/pdf/2509.18425](https://arxiv.org/pdf/2509.18425), Sep 2025) which names "value fabrication (producing incorrect numerical values)" as a primary failure mode.

### 3.3 OmniDocBench (CVPR 2025) — saturated already

**OmniDocBench** ([github.com/opendatalab/OmniDocBench](https://github.com/opendatalab/OmniDocBench), CVPR 2025). 1651 PDF pages, 10 document types. Per the LlamaIndex blog "OmniDocBench is Saturated, What's Next for OCR Benchmarks?" ([llamaindex.ai/blog/omnidocbench-is-saturated-what-s-next-for-ocr-benchmarks](https://www.llamaindex.ai/blog/omnidocbench-is-saturated-what-s-next-for-ocr-benchmarks)):

- **GLM-OCR: 94.62** overall.
- **PaddleOCR-VL-1.5: 94.50**.
- **MinerU2.5: 90.67**.
- **Qwen3-VL-235B: 89.15**.
- **Gemini-3 Pro: 90.33**.

The benchmark is on **documents**, not game UIs, so this is upper-bound performance under favorable conditions. The key data point is the gap between fine-tuned domain-specific OCR-VLMs (PaddleOCR-VL) and general VLMs (Qwen3-VL-235B, Gemini-3 Pro): **the domain-specific fine-tune is meaningfully better on documents and an order of magnitude cheaper to run.** This is the strongest single argument for "fine-tune a small model rather than chain a VLM" in our regime, where we will not get more than a few thousand labelled frames in any plausible future.

### 3.4 Tesseract is essentially out

PaddleOCR-vs-Tesseract benchmarks ([codesota.com/ocr/paddleocr-vs-tesseract](https://www.codesota.com/ocr/paddleocr-vs-tesseract), [github.com/PaddlePaddle/PaddleOCR/discussions/8349](https://github.com/PaddlePaddle/PaddleOCR/discussions/8349), [ironsoftware.com/csharp/ocr/blog/compare-to-other-components/paddle-ocr-vs-tesseract](https://ironsoftware.com/csharp/ocr/blog/compare-to-other-components/paddle-ocr-vs-tesseract/), peer-reviewed 2024 study at [ijrpr.com/uploads/V6ISSUE10/IJRPR53627.pdf](https://ijrpr.com/uploads/V6ISSUE10/IJRPR53627.pdf), 2024 multi-engine comparison at [toon-beerten.medium.com/ocr-comparison-tesseract-versus-easyocr-vs-paddleocr-vs-mmocr-a362d9c79e66](https://toon-beerten.medium.com/ocr-comparison-tesseract-versus-easyocr-vs-paddleocr-vs-mmocr-a362d9c79e66)) consistently show Tesseract performing worst on stylized fonts and complex backgrounds, even though it scores well (~92%) on clean English prose. The 2024 study explicitly notes "an engine that scores well on prose can fail on a three-column line-item table with currency symbols, tax codes, and mixed font sizes" — i.e., the failure mode is **structural complexity and stylization, not raw text recognition**. EA NHL UIs are exactly this kind of structurally complex + stylized scene.

The community working ScoreSight + Tesseract has stalled (see §1.1). The community working `Kaiserouo/Apex-Legends-Tracker-Video-OCR` + Tesseract has stalled. **Tesseract is a community-OCR endpoint, not a forward-looking choice.**

### 3.5 Cloud OCR

Pricing per the Apr 2025 comparison ([businesswaretech.com/blog/research-best-ai-services-for-automatic-invoice-processing](https://www.businesswaretech.com/blog/research-best-ai-services-for-automatic-invoice-processing), [aws.amazon.com/textract/pricing](https://aws.amazon.com/textract/pricing/), [cloudthat.com/resources/blog/comparison-of-ai-based-text-extraction-services](https://www.cloudthat.com/resources/blog/comparison-of-ai-based-text-extraction-services)):

- AWS Textract Detect Document Text: **$0.0015/page** (~$1.50/1k pages).
- Google Cloud Vision: ~**$1.50/1k units** above free tier.
- Azure Form Recognizer: comparable, slightly cheaper for basic, structured layouts.

For our volume (~30 matches/season × ~30–40 distinct frames/match × N samples per frame ≈ 5,000–20,000 frame-pages/season) the cost is trivial (~$10–$30/season). The blockers are different:
- **Accuracy on stylized digits is not benchmarked.** None of the cloud-OCR vendors publish numbers on game UI.
- **No fine-tuning on AWS Textract** ("Textract uses Amazon's pre-trained models and does not allow customers to provide their own training data" — same comparison piece). Azure and Google allow custom training, but that brings us back to the "small labelled corpus" problem in §5.
- **The 2024 comparison reports Azure/Google scoring ~78–93% on document field recognition, both ahead of AWS.** That's **document field recognition**, not stylized game-UI digit reads, and the variance bar overlaps the per-field 98% target we need.

Cloud OCR is a viable arbiter / fallback for ambiguous fields. It is **not** a credible primary engine for an offline-friendly, version-stable, single-author hobby project where we may want to reprocess the whole corpus after a UI bump.

### 3.6 VLMs — the hallucination problem on numeric fields

This is the most important sub-section.

**Number hallucination is a named, measured failure mode of VLMs.** Concrete evidence:
- Arxiv 2403.01373 "Quantity Matters: Towards Assessing and Mitigating Number Hallucination" ([arxiv.org/html/2403.01373v1](https://arxiv.org/html/2403.01373v1), Mar 2024). Targets the failure mode where VLMs incorrectly identify the **count or value of numeric content** in images.
- "Losing the Plot: How VLM responses degrade on imperfect charts" ([arxiv.org/pdf/2509.18425](https://arxiv.org/pdf/2509.18425), Sep 2025). Names "value fabrication (producing incorrect numerical values)" and "table/translation drift (errors during chart-to-table conversion)" — the exact mistakes a build-attributes promoter would suffer if we let GPT-4o read the 25-attribute attribute grid.
- "Seeing is Believing? Mitigating OCR Hallucinations in Multimodal Large Language Models" ([arxiv.org/html/2506.20168v2](https://arxiv.org/html/2506.20168v2), 2025). Frames the prescription: "for areas with a high risk of hallucination, models should demonstrate awareness to appropriately reject providing an answer."
- "Vision Language Models Map Logos to Text via Semantic Entanglement in the Visual Projector" ([arxiv.org/pdf/2510.12287](https://arxiv.org/pdf/2510.12287), Oct 2025). Documents VLMs "assert the presence of text in logos that contain no characters at all", outputting brand names with high confidence. This is the exact pathology for an X-factor icon or a team-logo overlay.

**Cost / latency / accuracy summary I'd write up for an engineering review:**

| Engine | Approx per-frame cost (our vol) | Accuracy on stylized digits | Hallucinates numbers? | Fine-tunable? |
| --- | --- | --- | --- | --- |
| RapidOCR (CUDA, current) | ~336 ms, free | medium — fine for big white digits, weak on attribute grids | no (returns "" or wrong char) | yes (PP-OCRv5 training pipeline) |
| PaddleOCR-VL fine-tune | ~500 ms - 1s GPU | best of open-source on documents (94.5 OmniDocBench) | no (it's still a CRNN family) | yes |
| Donut fine-tune | ~1-2s GPU | unknown on game UI; strong on receipts | low if fine-tuned | yes — needs ~hundreds of labelled examples |
| Florence-2 fine-tune | ~1s GPU | unknown — promising | medium | yes |
| Tesseract | ~200ms CPU, free | poor on stylized | no, but does drop chars | yes (traineddata) |
| AWS Textract | ~$0.0015/frame, ~1s API | unknown game-UI | no | no |
| Azure Form Recognizer | similar | unknown | no | yes (custom model) |
| GPT-4o vision | ~$0.005-0.02/frame, ~3s | best general-purpose | **YES, frequently on small digits** | no (only prompt) |
| Claude Opus 4.7 vision | similar | best hallucination rate (0.09% CC-OCR per cometapi.com [GPT-5.5 vs Opus 4.7 comparison](https://www.cometapi.com/gpt-5-5-vs-claude-opus-4-7-which-ai-to-use-when-hallucination-matters-2026-benchmark-data/)) | **low but non-zero** | no |
| Gemini-2.5 Pro | similar | best video-OCR (73.7% MME) | medium | no |

For our regime, RapidOCR with custom traineddata or PP-OCRv5 fine-tune **plus** a VLM arbiter on low-confidence fields is the architecturally sensible play. Pure-VLM is ruled out by §8.

---

## 4. Probabilistic / multi-hypothesis OCR output

There is **very thin direct production literature here**, which is itself a finding. The academic case is well-established (USPTO patents on multi-frame video text recognition [image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8290273](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8290273), confidence-prediction work at [arxiv.org/pdf/1805.11161](https://arxiv.org/pdf/1805.11161), and Bayesian OCR uncertainty at [arxiv.org/pdf/1807.11037](https://arxiv.org/pdf/1807.11037) for video segmentation). The practical published work is narrower than the academic concept:

- The **LEADTOOLS production docs** ([leadtools.com/help/sdk/v21/dh/to/ocr-confidence-reporting.html](https://www.leadtools.com/help/sdk/v21/dh/to/ocr-confidence-reporting.html)) document an enterprise-grade confidence-score convention: "A value of 64 or more indicates high confidence... less than 64 marks that code as suspicious." This is **per-character confidence reporting in a commercial OCR SDK** — the kind of thing PaddleOCR-VL and RapidOCR also expose via the `rec_score` field on each detection. The op wisdom: "don't write the value to your final store if the score is below threshold T; route it to manual review." Almost nobody publishes T.
- The **arxiv 2409.04117 "Confidence-Aware Document OCR Error Detection"** ([arxiv.org/pdf/2409.04117](https://arxiv.org/pdf/2409.04117), Sep 2024) defines a per-token confidence aggregation and shows that **threshold-and-route works better than threshold-and-drop** at production scale — keep the OCR output but flag it; let a second model re-decide.
- The **arxiv 2407.21424 "Cost-Effective Hallucination Detection for LLMs"** ([arxiv.org/pdf/2407.21424](https://arxiv.org/pdf/2407.21424), Jul 2024) confirms the multi-stage pattern for LLM-based pipelines: confidence-score then calibrate then threshold. Direct quote (SERP-extracted): "a hallucination detection pipeline entails producing a confidence score representing the likelihood that a generated answer is a hallucination, calibrating the score conditional on attributes of the inputs and candidate response, and finally performing detection by thresholding the calibrated score."

**Where probabilistic OCR pays off in published reports:**
- When you have a downstream consumer that can fork into "trusted" and "review" buckets. We do — the EA payload is the cheap arbiter for the subset of fields it covers.
- When you have **multi-frame redundancy**. We do — 1-fps Pass 1 followed by dense Pass 2 is exactly the source of redundant evidence.

**Where it costs more than it's worth:**
- When a single field has 99% prior confidence (e.g., the team name on a scoreboard during a single match). Probabilistic aggregation here is overkill; deterministic anchor logic suffices.
- When the cost of "no decision" is higher than the cost of "wrong decision" — not our case; we'd rather flag a build attribute as `?` than emit a wrong 87.

**Recommendation that falls out:** emit per-field `(value, confidence, evidence_frames[])` triples to `ocr_extractions`, with promotion to canonical tables gated on confidence-or-consensus. This is consistent with the existing schema (`transform_status` enum already supports `pending|success|error` — extend with a `low_confidence` state).

---

## 5. Small-corpus calibration loops

This is the section where the published wisdom is **closest to our regime** — small-corpus tooling has been an academic obsession for years.

- **Pseudo-labelling** ([arxiv.org/pdf/2301.07294](https://arxiv.org/pdf/2301.07294), [arxiv.org/pdf/2401.00575](https://arxiv.org/pdf/2401.00575), [arxiv.org/pdf/2104.13037](https://arxiv.org/pdf/2104.13037) "AT-ST: Self-Training Adaptation Strategy for OCR in Domains with Limited Transcriptions", [arxiv.org/pdf/2303.01117](https://arxiv.org/pdf/2303.01117)). The published wins are real: MNIST self-training with 1,000 labelled images and 59,000 unlabelled pushed accuracy +4.87 pp. AT-ST specifically targets OCR domain adaptation with limited transcriptions; for our case a single keyed match (V2-style) is already enough to bootstrap a self-training loop on the other ~50 unlabelled matches.
- **Snorkel weak supervision** ([snorkel.ai/blog/few-shot-learning-large-language-models](https://snorkel.ai/blog/few-shot-learning-large-language-models/), [arxiv.org/pdf/1711.10160](https://arxiv.org/pdf/1711.10160), [arxiv.org/pdf/1812.00417](https://arxiv.org/pdf/1812.00417) "Snorkel DryBell: A Case Study in Deploying Weak Supervision at Industrial Scale"). The 2023 Snorkel-with-LLMs piece: "Treating language models as labeling functions in a weak supervision framework and combining them with other labeling functions outperforms using the LLM directly as a predictor (41.6% error reduction) and using human-generated labeling functions alone (20.1% error reduction)." **The pattern fits our regime exactly** — define labelling functions (regex parsers, EA-API cross-checks, monotonicity constraints, position-based template rules), use Snorkel's generative model to combine them, train the final OCR head on the noisy labels.
- **Few-shot VLM prompting** ([arxiv.org/html/2412.00142v3](https://arxiv.org/html/2412.00142v3), [arxiv.org/pdf/2502.09057](https://arxiv.org/pdf/2502.09057) "Vision-Language In-Context Learning Driven Few-Shot Visual Inspection Model"). Both report that with **5–20 in-context examples** a VLM can match light fine-tuning on visual inspection tasks. For a screen-type classifier this is enormous: one V2-keyed match contains ~30–40 distinct screens, which is already enough to one-shot-prime a classifier.
- **CLIP zero-shot screen classification** ([pinecone.io/learn/series/image-search/zero-shot-image-classification-clip](https://www.pinecone.io/learn/series/image-search/zero-shot-image-classification-clip/), [huggingface.co/docs/transformers/tasks/zero_shot_image_classification](https://huggingface.co/docs/transformers/tasks/zero_shot_image_classification), [auto.gluon.ai/stable/tutorials/multimodal/image_prediction/clip_zeroshot.html](https://auto.gluon.ai/stable/tutorials/multimodal/image_prediction/clip_zeroshot.html)). Per-frame CLIP forward at 224×224 is ~5–10 ms on a 3060. Calibration burden is zero per game version — you write English prompts like "the NHL pre-game lineup screen" / "the NHL build attributes detail screen" and CLIP gives you cosine similarities. **The risk is mode collapse**: similar UI screens (e.g., two-team head-to-head vs three-stars-of-game with the same chrome) will frequently rank within similarity epsilon of each other.
- **From Pixels to Titles: Video Game Identification by Screenshots using CNNs** ([arxiv.org/pdf/2311.15963](https://arxiv.org/pdf/2311.15963), Nov 2023). 8,796 games, 170,881 screenshots, 22 home console systems. **EfficientNetV2S best, 77.44% average accuracy.** For our 8-screen-type problem, accuracies will be much higher (smaller closed class set, single console, no genre-mix problem) — this paper's value is the architectural family selection (EfficientNetV2S / EfficientNet-Lite over MobileNetV3-Small for accuracy-per-FLOP). Plus the "Comparative Analysis of Lightweight Deep Learning Models" piece ([arxiv.org/pdf/2505.03303](https://arxiv.org/pdf/2505.03303), May 2025) confirms EfficientNetV2-S as the production sweet spot for memory-constrained classification.

**Operational recipe that falls out of this section:** seed the classifier with a hand-keyed match, fine-tune EfficientNet-Lite (or zero-shot via CLIP) on ROIs, then run a Snorkel-style weak-supervision loop where the EA payload (when it covers a field), regex parsers, and monotonicity constraints all vote — and you only ask the human for adjudication when the labelling functions disagree. **Snorkel-plus-active-learning is the move** for our regime.

---

## 6. EA Pro Clubs API anchoring

The community evidence (§1.2 EASHL bullet list) converges on one clear claim: **trust the EA Pro Clubs API for the fields it returns, distrust it for everything else, and trust the gamertag string above the blazeId field.**

Concrete confirmations:
- ravib.dev's blog post on parsing the API ([ravib.dev/personal-projects/2024/01/30/parsing-from-api.html](http://ravib.dev/personal-projects/2024/01/30/parsing-from-api.html), Jan 2024) — WebFetch denied, but the EA forum and search summaries cite endpoints like `proclubs.ea.com/api/nhl/clubs/matches?clubIds=…&platform=ps4&matchType=club_private` and note that the API returns ~5 recent matches with all values as strings. This matches our internal observation that blazeId is absent in production payloads.
- The ChelHead FAQ summary (via SERP) on `proclubs.ea.com`: "internal, undocumented, and designed as APIs to power specific frontends, which often cause breaking changes without notice for each edition of the game."
- The historical chelstats (ravibhagw) postmortem: EA decommissioned the legacy NHL-14 API and locked the next-gen one behind keys. **This has happened before and will happen again.**
- `glebb/eashl`'s graveyard README: worked through NHL 16, dead since. **Five-year half-life on the API** is the empirical observation.

Nobody in the public space combines EA's API with OCR. We are the first I can find. **The cross-reference value goes one way: the API is the cheap arbiter for the fields it covers (goals, assists, +/-, save %, gamertag, club ID, match ID). Everything not in the API — X-factor effects, shot coordinates, build attributes, on-ice TOI, line/pair codes, faceoff dot OCR — is OCR-only.** The internal Round 1 doc already identifies this; the external evidence is consistent: **`players.ea_id` nullable forever is the correct decision**, and gamertag is the production identity anchor. Multiple EA forum threads ([answers.ea.com/t5/Other-NHL-Games/nhl-21-api-for-stats/m-p/9765951](https://answers.ea.com/t5/Other-NHL-Games/nhl-21-api-for-stats/m-p/9765951), [answers.ea.com/t5/Other-NHL-Games/NHL21-API-Private-Match-history/m-p/10096304](https://answers.ea.com/t5/Other-NHL-Games/NHL21-API-Private-Match-history/m-p/10096304), [forums.ea.com/discussions/nhl-26-general-discussion-en/26-eashl-clubs-website-and-api/12548651](https://forums.ea.com/discussions/nhl-26-general-discussion-en/26-eashl-clubs-website-and-api/12548651)) corroborate: blazeId is unreliable; persona / gamertag is the only thing that survives.

The community wisdom on EA Pro Clubs API durability also says: **never assume the API will be there next year**. Three of three previous attempts (devinmcinnis NHL13, glebb NHL14-16, ravibhagw NHL14-pre-decommission) have died. The contemporary survivors (chelstats by eliashussary, chelhead.com) are running on the second-generation endpoint and explicitly say it changes per game release. **Architectural implication: the OCR pipeline must remain capable of producing every field — including the ones the API currently provides — because the API will eventually disappear and we'll need to backfill.** This is in tension with §3.6's recommendation to use the API as an arbiter, but the resolution is that you use the API today AND keep the OCR honest.

---

## 7. Surviving annual UI changes

There is very little public production wisdom on this for game-OCR specifically. The closest writeups are:

- **Henry Zhu's League data scraping piece** (cited §1.2). The key admission is that decryption rotates with patches and Unicorn Engine emulation is the only way to keep up. **That is exactly the pixel-OCR analogue we'd hit: every new EA NHL release shifts the UI atoms (color palette, anchor text wording, ROI offsets) and a brittle pipeline has to be re-keyed from scratch.**
- The "version-aware" / "version drift" generic literature ([techradar.com/pro/what-is-version-drift-in-ai](https://www.techradar.com/pro/what-is-version-drift-in-ai), [ajithp.com/2025/10/05/enterprise-ai-version-drift](https://ajithp.com/2025/10/05/enterprise-ai-version-drift/)) is about **document version drift in enterprise AI**, not about computer-vision pipelines for annual game releases. **Negative finding: nobody publishes about game-version-bump CV pipelines.**
- The Operation Sports NHL 26 patch-notes archive ([operationsports.com/nhl-26-update-1-30-arrives-tomorrow-december-2-patch-notes](https://www.operationsports.com/nhl-26-update-1-30-arrives-tomorrow-december-2-patch-notes/), and the 1.2 / 1.4 / 1.5 / 1.6 threads). These document **mid-cycle UI changes within a single game year** — e.g., 1.2.0 fixed a "blank screen issue appearing after tapping Play in the Action Tracker post-match"; 1.30 fixed a backend UI bug in 3v3 Clubs. **Within-year UI churn is real and measurable.** A version-aware pipeline has to handle game-version + patch-version + content-season combinations.

The template-matching / anchor-aware ROI literature ([researchgate "Process of region-of-interest-based template matching"](https://www.researchgate.net/figure/Process-of-region-of-interest-based-template-matching-A-template-found-inside-ROI_fig4_282512767), USPTO casino-table patents at [image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10650550](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10650550)) gives one transferable pattern: **define anchor objects that are themselves stable across versions, then derive ROI offsets via homography rather than absolute coordinates.** The casino-table patent specifically describes "generating template images with meta-data defining regions of interest, capturing table images, identifying objects at the first region of interest, and then generating camera meta-data for other regions based on homography calculations." This is the template recipe for an annual-UI-bump-survivable pipeline:

1. **Per-version anchor library.** Each game version (NHL 25, 26, 27) gets its own set of anchor templates (logos, persistent text like "PERIOD 1", "FACEOFF WON", color regions).
2. **Anchor detection first**, then ROI offsets calibrated against the anchors. New version → re-key the anchor library only; ROIs are derived.
3. **CLIP / EfficientNet classifier scoped to the active version.** Versioned classifier configs.
4. **Pixel-level anchor regression tests on the calibration corpus.** When a new game version drops, the regression suite says "these matches were keyed under NHL 26 and still parse correctly; do not promote a new classifier that breaks them."

The community-level evidence that this is essential is **the EASHL stat-tracker graveyard from §1.2** — every previous community project broke at a version bump. We have a real opportunity to be the first version-stable EASHL pipeline, **and** we are the only project I found that can plausibly keep its calibration corpus working across NHL 26 → 27.

---

## 8. Honest negative results

This is the section where the literature is least directly useful but where the **silence is most informative.**

**Has anyone tried screenshot → GPT-4V → JSON end-to-end for game stats and reported negative results?**

I searched explicitly. The closest published negative reports are:
- **MME-VideoOCR (§3.2):** Gemini-2.5 Pro best at 73.7% on video OCR. That is below the ≥98% per-field bar by a country mile.
- **VideoDB OCR Benchmark (§3.1):** GPT-4o 76.22% on a benchmark that **does not contain stylized game UIs**. Domain-shift expected to make it worse, not better.
- **Quantity Matters (arxiv 2403.01373):** number hallucination is a measured failure mode of every state-of-the-art VLM.
- **Losing the Plot (arxiv 2509.18425):** chart-OCR degrades sharply on imperfect inputs with value-fabrication as the primary failure.
- **PromptPort paper** ([arxiv.org/pdf/2601.06151](https://arxiv.org/pdf/2601.06151)). Frames "format collapse" — strict JSON parsers reject otherwise-correct extractions because output formatting is unreliable across models and prompts. Quote: "On a 37,346-example camera metadata benchmark across six model families, they find severe format collapse (e.g., Gemma-2B: ROS 0.116 vs CSS 0.246)." The ROS (strict-parse) vs CSS (post-canonicalization) gap means **a naive VLM-to-JSON pipeline drops half its correct answers to parser rejection** — which the operator may never notice without dual-metric evaluation.
- **OpenAI dev community thread "Structured Outputs not reliable with GPT-4o-mini and GPT-4o"** ([community.openai.com/t/structured-outputs-not-reliable-with-gpt-4o-mini-and-gpt-4o/918735](https://community.openai.com/t/structured-outputs-not-reliable-with-gpt-4o-mini-and-gpt-4o/918735)). Reported even with structured-outputs mode enabled, GPT-4o occasionally drifts off schema for complex extractions.

**The absence of "we built a screenshot-to-JSON game-OCR pipeline with GPT-4V and it worked" blog posts is the loudest single signal in this entire research round.** If it worked, somebody would have shipped it as a YouTube tutorial. The community OCR projects (LeagueOCR, Apex Video OCR, ScoreSight) are all still using Tesseract or RapidOCR. The VLM-evaluation literature consistently shows numeric-field hallucination above an acceptable rate for our regime. The pattern is: **VLMs are excellent zero-shot generalists for "extract everything from this receipt" but persistently bad arbiters for "is that a 7 or a 1" in a stylized 24-px digit on a transient overlay.**

There is one fair caveat to this: **Claude vision (the model writing this report) has the lowest CC-OCR hallucination rate in the 2026 benchmarks** ([cometapi.com/gpt-5-5-vs-claude-opus-4-7-which-ai-to-use-when-hallucination-matters-2026-benchmark-data](https://www.cometapi.com/gpt-5-5-vs-claude-opus-4-7-which-ai-to-use-when-hallucination-matters-2026-benchmark-data/), [mindstudio.ai/blog/claude-opus-47-benchmark-breakdown](https://www.mindstudio.ai/blog/claude-opus-47-benchmark-breakdown), [codesota.com/ocr/claude-vs-gpt4o-ocr](https://www.codesota.com/ocr/claude-vs-gpt4o-ocr)) and per the GPT-5.5-vs-Opus-4.7 comparison, "Claude has the lowest hallucination rate on CC-OCR at 0.09%". That is **good enough to use as an arbiter on low-confidence RapidOCR reads**, and possibly good enough for entire small-cardinality classifications (X-factor name, fight result enum). I'd want to validate this against our own corpus before depending on it, but the published evidence makes Claude vision the strongest VLM candidate for arbiter duty.

---

## 9. Game-UI screen-classification techniques

Four candidate techniques, with cost / calibration burden:

- **CLIP zero-shot.** ~5–10 ms/frame on RTX 3060; calibration is just English prompts. Risk: cosine similarities cluster between visually similar screens. Where used in production: search/retrieval, content moderation (per [galileo.ai/blog/openai-clip-computer-vision-zero-shot-classification](https://galileo.ai/blog/openai-clip-computer-vision-zero-shot-classification)). **Recommended as the Pass-0 classifier**, with a fine-tuned head on top for the residual ambiguity cases.
- **Small CNN (EfficientNetV2-S or EfficientNet-Lite).** ~15–30 ms/frame at 224×224; needs ~50–500 labelled examples per class. Per "From Pixels to Titles" (arxiv 2311.15963), EfficientNetV2-S is the consistent winner on the closed-class screenshot-classification task. Per arxiv 2505.03303 (Comparative Analysis of Lightweight Deep Learning Models, May 2025), MobileNetV3-Small and EfficientNetV2-S occupy the Pareto frontier for memory-constrained inference. **Recommended as the production classifier once we have ~200 frames/class** — which one V2-keyed match plus a small bootstrap loop gets us.
- **Template matching.** Per-anchor cost is sub-ms; calibration burden is "re-cut the templates whenever the UI shifts". Production examples in the patent literature (casino-table patents above) and in OCR pre-processing pipelines (xy-kao webcam scoreboard). **Recommended for the anchor library underneath everything else** — both CLIP and CNN should run inside an anchor-detected ROI, not over the whole frame.
- **SIFT / SURF / ORB feature matching.** ~30 ms/frame for ORB. Per OpenCV documentation, ORB is the open-licensed, fast alternative. Used in the production literature for **panorama stitching and AR registration**, not commonly for UI screen classification — partly because templates are a cheaper solution when the camera is fixed. **Not recommended for our use** unless we needed it for camera-feed (live overlay) work, which we don't.

The **silence is data:** there is no published "best practice" stack for "classify a game UI screen into one of 8 types in 50 ms on consumer GPU". The community has built it ad-hoc in each project (LeagueOCR rolls its own, ScoreSight uses Qt+OpenCV regions). The closest published recipe is the Spotlight paper ([arxiv.org/pdf/2209.14927](https://arxiv.org/pdf/2209.14927)) which pretrains a VLM on 2.5M mobile UI screens — overkill for our 8 classes, and not the right model anyway.

**My recommendation that falls out:** anchor-template detection first → ROI crop → EfficientNetV2-S classifier with CLIP as a zero-shot fallback. The HSV-cosine + anchor-text fuzzy-Levenshtein gate we have today is a perfectly reasonable pre-deep-learning approximation of this stack; the redesign should evolve it not replace it.

---

## 10. Cross-frame consensus / aggregator patterns

Concrete published patterns:
- **Consensus sequence voting** ([Klink et al., CVIU 1996](https://www.sciencedirect.com/science/article/abs/pii/S1077314296905020), [ACM doi 10.1006/cviu.1996.0502](https://dl.acm.org/doi/10.1006/cviu.1996.0502)). Headline number: "Eliminate between 20 and 50% of errors caused by a single OCR package by scanning documents multiple times." This is **scanning the same physical document with multiple OCR engines or multiple scan-passes**; the technique generalizes to multi-frame OCR of the same visual element.
- **Median / mode voting over per-frame digit reads.** Standard scoreboard-OCR move per API4AI Medium (§1.1). The "scores only increase, periods change in known sequences" sanity rules act as constraint priors on the mode.
- **Multi-frame video text recognition** ([USPTO patent 8290273](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8290273)). "Multi-frame persistence of videotext is exploited to mitigate challenges posed by varying characteristics of videotext across frame instances."
- **Region-based temporal aggregation (RTA)** ([arxiv.org/pdf/1807.11037](https://arxiv.org/pdf/1807.11037)). Uncertainty estimation from temporal evidence, comparable to MC dropout but cheaper.
- **Bipartite/Hungarian matching for marker-to-event association** ([Wikipedia](https://en.wikipedia.org/wiki/Hungarian_algorithm), [thinkautonomous.ai/blog/hungarian-algorithm](https://www.thinkautonomous.ai/blog/hungarian-algorithm/), DETR introduction at [digitalocean.com/community/tutorials/introduction-detr-hungarian-algorithm-2](https://www.digitalocean.com/community/tutorials/introduction-detr-hungarian-algorithm-2)). Production usage in multi-object tracking is well-established (ByteTrack at [arxiv.org/abs/eccv_2022/papers/136820001-supp.pdf](https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136820001-supp.pdf), BoxMOT at [pypi.org/project/boxmot/10.0.12](https://pypi.org/project/boxmot/10.0.12/), [labellerr.com/blog/bot-sort-tracking](https://www.labellerr.com/blog/bot-sort-tracking/)). For **our event-list problem (Pass-2 dense extraction has multiple frames per event; Pass-3 needs to associate them with a single event row)**, Hungarian assignment between extraction candidates and event slots is the textbook approach.
- **Bayesian aggregation** ([arxiv.org/pdf/1410.0375](https://arxiv.org/pdf/1410.0375) Elicitation for Aggregation; [aclanthology.org/2025.findings-acl.581.pdf](https://aclanthology.org/2025.findings-acl.581.pdf) Probabilistic Aggregation and Targeted Embedding). Less production maturity; mostly academic.
- **Edit-distance clustering** is implicit in our existing fuzzy-Levenshtein gate. The published canonical recipe is **Smith-Waterman or Needleman-Wunsch alignment of OCR strings followed by majority vote at each position** (the same recipe as the 1996 CVIU paper above). For player gamertags (variable-length, with leetspeak / underscores), edit-distance clustering with a 2-character tolerance is the standard approach.

**For our regime, the operational ranking of consensus patterns** is:

1. **Monotonicity / constraint-based filtering** is cheapest and highest-leverage (score only goes up, GP only increases, period only goes 1→2→3→OT, on-ice TOI sums to game length per player).
2. **Mode-over-frames with edit-distance clustering** for gamertags, attribute reads, and small-cardinality enums.
3. **Hungarian matching** for event-list-to-promoter association (event markers in Pass 2 → canonical event rows).
4. **Bayesian aggregation** for fields where we want a real `P(value | evidence)` distribution to surface via the promotion layer.

---

## 11. Meta-conclusions and gaps in the literature

### What the literature says, summarized

1. **No production OCR pipeline for EA NHL exists in public.** Every existing EASHL stat tracker is API-only. Every dies at a game-version bump or an API decommissioning. We are not standing on the shoulders of community giants here; we are the first.
2. **Replay-file > memory hook > OCR for any game that exposes replay files.** EA NHL does not.
3. **API > OCR for fields the API covers** — but the EA Pro Clubs API has a five-year empirical half-life and covers only the boring counting stats. The interesting fields (X-factor activations, build attributes, line/pair codes, faceoff dot coordinates, shot/pass coordinates) have never been API-accessible.
4. **VLMs are not currently good enough for primary OCR on stylized digits.** Best video-OCR benchmark scores top out at ~73.7% (Gemini 2.5 Pro on MME-VideoOCR). Number-hallucination is a measured failure mode. They are good enough for arbiter duty on low-confidence reads.
5. **PaddleOCR / RapidOCR family is the production-grade open-source winner.** PP-OCRv5 / PaddleOCR-VL is the natural upgrade path from current RapidOCR. Fine-tuning on a custom traineddata for stylized EA NHL digits is a tested community technique.
6. **Two-pass is the right shape.** Event-driven needs an event detector that we don't have (no whistle audio, no caption signal in EA NHL recordings beyond what we OCR ourselves). Single-pass dense is wasteful.
7. **Anchor-template-driven ROI is the right way to survive UI bumps.** Versioned classifier configs are mandatory. Pixel-level regression tests against the V2-keyed corpus are the gate.
8. **Multi-frame consensus pays off cheaply.** Monotonicity / constraint-based filtering is free; mode-voting is cheap; Hungarian assignment is well-trodden; per-field confidence is the right abstraction in the schema.
9. **Snorkel-style weak supervision + active learning is the small-corpus playbook.** Labelling functions (regex, EA-API cross-check, monotonicity, anchor-position) + a generative label model + selective human adjudication = the path to 98% per-field accuracy with ~50 labelled fixtures.
10. **Don't trust GPT-4o on numbers.** Use Claude vision for arbitration where you need a VLM at all, and use it as a binary confirmation tool (`is this digit 7 or 1?`) not as a primary extractor.

### Gaps in the literature that this project is exposed to

1. **No public benchmark exists for stylized game-UI digit OCR.** All published benchmarks (OmniDocBench, VideoDB OCR, MME-VideoOCR) test on documents, news, advertisements, charts. The closest analogue is "news broadcasts" and even that is a different design tradition than esports UI. We will need to publish (or at least keep internally) our own benchmark. The Round 1 baseline JSONs (`baseline-match-250.json`, `baseline-match-463.json`) are the seed.
2. **No published version-bump survival playbook for game-CV.** Every previous EASHL tracker died at a game version bump. Every cited paper assumes a static domain. We will need to invent the version-aware-anchor-library pattern ourselves; the casino-table USPTO patents are the closest analogue.
3. **No published wisdom on EA Pro Clubs API durability.** The community knows the API breaks but does not publish a mean-time-to-failure. Three out of three previous community projects had ~3–5 year API survival. Our schema decision to make `players.ea_id` nullable forever and anchor on gamertag is consistent with this.
4. **No published wisdom on the V2-style hand-keyed-truth → small-corpus-calibration loop for game-UI OCR specifically.** The closest analogues are Snorkel-DryBell (industrial-scale weak supervision for click prediction), AT-ST (OCR domain adaptation with limited transcriptions), and the few-shot VLM-as-labelling-function papers. None target our exact regime. We will be inventing here.
5. **No published wisdom on Claude-vision arbitration of RapidOCR low-confidence reads.** The published benchmarks confirm Claude has the lowest hallucination rate but the arbitration-cascade design is not published. **This is a real opportunity** — there is room to publish a small writeup on the technique if it works.

### Three concrete suggestions for the Round-4 synthesis

(Acknowledging these belong properly to Round 4, but Round 1 produced a hard recommendation and the symmetry calls for one here too.)

1. **Don't replace the two-pass shape; harden Pass 1 with EfficientNetV2-S + CLIP zero-shot fallback, and harden Pass 2 with monotonicity-constrained mode-voting + Claude-vision arbitration for low-confidence fields.** That is the consensus shape from §2 + §3 + §10.
2. **Version-aware anchor library + versioned classifier configs + per-version regression test corpus.** That is the only thing that survives NHL 26 → 27. Round 1 hints at this; the external evidence makes it mandatory.
3. **Snorkel-style weak-supervision label model with EA-API cross-check as the strongest labelling function.** Active-learning loop where the human adjudicates only on disagreement between labelling functions. That is the realistic path to ≥98% per-field on a hobbyist labour budget.

I'm willing to disagree with the consensus on one front: **the published wisdom (and especially the cloud-OCR marketing literature) consistently overstates the maturity of VLM-end-to-end OCR for production**. The independent benchmark evidence (videodb, MME-VideoOCR, "Losing the Plot", "Quantity Matters") consistently disagrees. We should under-weight blog posts that show GPT-4o doing magic on a receipt and over-weight the published failure-mode literature. Our 98% per-field accuracy bar **is in fact too high for any current end-to-end VLM**, and we should architect explicitly around that constraint rather than hoping a model update saves us.

---

## Sources

Primary internet sources cited above (deduplicated, in approximate order of appearance):

- AWS ML blog — Sportradar near-real-time soccer goals: [aws.amazon.com/blogs/machine-learning/predicting-soccer-goals-in-near-real-time-using-computer-vision/](https://aws.amazon.com/blogs/machine-learning/predicting-soccer-goals-in-near-real-time-using-computer-vision/) (Aug 2022)
- Amazon Science — Sportradar / CV roundup: [amazon.science/latest-news/how-some-of-awss-most-innovative-customers-are-using-computer-vision-technologies](https://www.amazon.science/latest-news/how-some-of-awss-most-innovative-customers-are-using-computer-vision-technologies) (2024)
- AWS Architecture blog — sporting-events data pipeline: [aws.amazon.com/blogs/architecture/building-a-data-pipeline-for-tracking-sporting-events-using-aws-services/](https://aws.amazon.com/blogs/architecture/building-a-data-pipeline-for-tracking-sporting-events-using-aws-services/) (Aug 2021)
- Hawk-Eye + Flink + Amazon MSK: [aws.amazon.com/blogs/media/hawk-eye-innovations-powers-real-time-sports-data-with-flink-and-amazon-msk/](https://aws.amazon.com/blogs/media/hawk-eye-innovations-powers-real-time-sports-data-with-flink-and-amazon-msk/)
- API4AI Medium — Scoreboard OCR Meets Logo Metrics: [medium.com/@API4AI/scoreboard-ocr-meets-logo-metrics-context-matters-14824e6c9325](https://medium.com/@API4AI/scoreboard-ocr-meets-logo-metrics-context-matters-14824e6c9325)
- ScoreSight (royshil/scoresight): [github.com/royshil/scoresight](https://github.com/royshil/scoresight)
- OBS ScoreSight thread: [obsproject.com/forum/resources/scoresight-free-open-source-ocr-tool-for-gaming-and-scoreboards.1884](https://obsproject.com/forum/resources/scoresight-free-open-source-ocr-tool-for-gaming-and-scoreboards.1884/)
- XY Kao realtime scoreboard OCR: [xy-kao.com/projects/scoreboard-ocr-with-python-webcam](https://xy-kao.com/projects/scoreboard-ocr-with-python-webcam/)
- Seven-segment Tesseract: [w3tutorials.net/blog/digital-numbers-on-tesseract-ocr](https://www.w3tutorials.net/blog/digital-numbers-on-tesseract-ocr/)
- floh22/LeagueOCR: [github.com/floh22/LeagueOCR](https://github.com/floh22/LeagueOCR)
- floh22/LeagueBroadcast: [github.com/floh22/LeagueBroadcast](https://github.com/floh22/LeagueBroadcast)
- pyLoL: [github.com/league-of-legends-replay-extractor/pyLoL](https://github.com/league-of-legends-replay-extractor/pyLoL)
- RCVolus league-prod-toolkit: [github.com/RCVolus/league-prod-toolkit](https://github.com/RCVolus/league-prod-toolkit)
- Sky-CSC OSL: [github.com/Sky-CSC/OSL](https://github.com/Sky-CSC/OSL)
- Henry Zhu — League data scraping: [maknee.github.io/blog/2025/League-Data-Scraping](https://maknee.github.io/blog/2025/League-Data-Scraping/) (Feb 2025) + HN [news.ycombinator.com/item?id=43024173](https://news.ycombinator.com/item?id=43024173)
- Riot dev blog Vanguard for LoL: [leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/) (May 2024)
- markus-wa/demoinfocs-golang: [github.com/markus-wa/demoinfocs-golang](https://github.com/markus-wa/demoinfocs-golang)
- Valve csgo-demoinfo: [github.com/ValveSoftware/csgo-demoinfo](https://github.com/ValveSoftware/csgo-demoinfo)
- nickbabcock/boxcars: [github.com/nickbabcock/boxcars](https://github.com/nickbabcock/boxcars)
- tfausak/rattletrap: [github.com/tfausak/rattletrap](https://github.com/tfausak/rattletrap)
- BakkesMod: [bakkesplugins.com](https://bakkesplugins.com/)
- Lyliya/RocketStats: [github.com/Lyliya/RocketStats](https://github.com/Lyliya/RocketStats)
- Kaiserouo Apex Video OCR: [github.com/Kaiserouo/Apex-Legends-Tracker-Video-OCR](https://github.com/Kaiserouo/Apex-Legends-Tracker-Video-OCR)
- remram44/apex-legends-ocr-data: [github.com/remram44/apex-legends-ocr-data](https://github.com/remram44/apex-legends-ocr-data)
- Apex Legends Tracker API: [apex.tracker.gg/site-api](https://apex.tracker.gg/site-api)
- ApexLegendsAPI: [apexlegendsapi.com](https://apexlegendsapi.com/)
- ChelHead: [chelhead.com](https://chelhead.com/) + FAQ [chelhead.com/faq/](https://chelhead.com/faq/)
- eliashussary/chelstats: [github.com/eliashussary/chelstats](https://github.com/eliashussary/chelstats)
- ravibhagw/chelstats: [github.com/ravibhagw/chelstats](https://github.com/ravibhagw/chelstats) + blog [ravib.dev/personal-projects/2024/01/30/parsing-from-api.html](http://ravib.dev/personal-projects/2024/01/30/parsing-from-api.html) (Jan 2024)
- glebb/eashl: [github.com/glebb/eashl](https://github.com/glebb/eashl)
- devinmcinnis/eashl: [github.com/devinmcinnis/eashl](https://github.com/devinmcinnis/eashl)
- EA forum NHL21 API: [answers.ea.com/t5/Other-NHL-Games/nhl-21-api-for-stats/m-p/9765951](https://answers.ea.com/t5/Other-NHL-Games/nhl-21-api-for-stats/m-p/9765951)
- EA forum NHL21 private match history: [answers.ea.com/t5/Other-NHL-Games/NHL21-API-Private-Match-history/m-p/10096304](https://answers.ea.com/t5/Other-NHL-Games/NHL21-API-Private-Match-history/m-p/10096304)
- EA forum NHL26 EASHL Clubs Website / API: [forums.ea.com/discussions/nhl-26-general-discussion-en/26-eashl-clubs-website-and-api/12548651](https://forums.ea.com/discussions/nhl-26-general-discussion-en/26-eashl-clubs-website-and-api/12548651)
- EA forum World of CHEL EASHL API thread: [answers.ea.com/t5/World-of-CHEL/eashl-api/m-p/13491808](https://answers.ea.com/t5/World-of-CHEL/eashl-api/m-p/13491808)
- next-gen-scraPy NFL tracking: [ar5iv.labs.arxiv.org/html/1906.03339](https://ar5iv.labs.arxiv.org/html/1906.03339)
- Donut: [github.com/clovaai/donut](https://github.com/clovaai/donut), [huggingface.co/docs/transformers/en/model_doc/donut](https://huggingface.co/docs/transformers/en/model_doc/donut)
- Pix2Struct: [arxiv.org/html/2210.03347](https://arxiv.org/html/2210.03347), [huggingface.co/docs/transformers/model_doc/pix2struct](https://huggingface.co/docs/transformers/model_doc/pix2struct)
- ScreenAI: [arxiv.org/html/2402.04615](https://arxiv.org/html/2402.04615) (Feb 2024)
- LayoutLMv3 / HuggingFace doc-AI: [github.com/huggingface/blog/blob/main/document-ai.md](https://github.com/huggingface/blog/blob/main/document-ai.md)
- Florence-2 OCR analysis: [huggingface.co/blog/PandorAI1995/ocr-processing-text-in-image-analysis-vlm-models](https://huggingface.co/blog/PandorAI1995/ocr-processing-text-in-image-analysis-vlm-models)
- PaddleOCR / PP-OCRv5: [github.com/PaddlePaddle/PaddleOCR](https://github.com/PADDLEPADDLE/PADDLEOCR), [huggingface.co/PaddlePaddle/PP-OCRv5_server_det](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det), [medium.com/@alex_paddleocr/pinpoint-performance-bottlenecks-with-paddleocr-v3-2s-fine-grained-benchmark-d7ba18d63f7d](https://medium.com/@alex_paddleocr/pinpoint-performance-bottlenecks-with-paddleocr-v3-2s-fine-grained-benchmark-d7ba18d63f7d)
- PP-OCR paper: [arxiv.org/pdf/2009.09941](https://arxiv.org/pdf/2009.09941)
- PP-OCRv3 paper: [arxiv.org/pdf/2206.03001](https://arxiv.org/pdf/2206.03001)
- PaddleOCR vs Tesseract (CodeSOTA): [codesota.com/ocr/paddleocr-vs-tesseract](https://www.codesota.com/ocr/paddleocr-vs-tesseract)
- PaddleOCR vs Tesseract (peer-reviewed 2024): [ijrpr.com/uploads/V6ISSUE10/IJRPR53627.pdf](https://ijrpr.com/uploads/V6ISSUE10/IJRPR53627.pdf)
- Multi-engine OCR comparison: [toon-beerten.medium.com/ocr-comparison-tesseract-versus-easyocr-vs-paddleocr-vs-mmocr-a362d9c79e66](https://toon-beerten.medium.com/ocr-comparison-tesseract-versus-easyocr-vs-paddleocr-vs-mmocr-a362d9c79e66)
- VideoDB OCR Benchmark: [github.com/video-db/ocr-benchmark](https://github.com/video-db/ocr-benchmark) + paper [arxiv.org/abs/2502.06445](https://arxiv.org/abs/2502.06445) (Feb 2025) + HN [news.ycombinator.com/item?id=43045801](https://news.ycombinator.com/item?id=43045801)
- MME-VideoOCR: [mme-videoocr.github.io](https://mme-videoocr.github.io/) + [arxiv.org/abs/2505.21333](https://arxiv.org/abs/2505.21333) (May 2025)
- Do Current Video LLMs Have Strong OCR Abilities: [arxiv.org/pdf/2412.20613](https://arxiv.org/pdf/2412.20613)
- OmniDocBench: [github.com/opendatalab/OmniDocBench](https://github.com/opendatalab/OmniDocBench) + LlamaIndex [llamaindex.ai/blog/omnidocbench-is-saturated-what-s-next-for-ocr-benchmarks](https://www.llamaindex.ai/blog/omnidocbench-is-saturated-what-s-next-for-ocr-benchmarks)
- AWS Textract pricing: [aws.amazon.com/textract/pricing](https://aws.amazon.com/textract/pricing/)
- AWS / Azure / GCV invoice benchmark: [businesswaretech.com/blog/research-best-ai-services-for-automatic-invoice-processing](https://www.businesswaretech.com/blog/research-best-ai-services-for-automatic-invoice-processing)
- CloudThat OCR comparison: [cloudthat.com/resources/blog/comparison-of-ai-based-text-extraction-services](https://www.cloudthat.com/resources/blog/comparison-of-ai-based-text-extraction-services)
- InfoWorld doc-parsing AWS/Azure/GCV review: [infoworld.com/article/2271149/review-document-parsing-in-aws-azure-and-google-cloud.html](https://www.infoworld.com/article/2271149/review-document-parsing-in-aws-azure-and-google-cloud.html)
- Number-hallucination in VLMs: [arxiv.org/html/2403.01373v1](https://arxiv.org/html/2403.01373v1) (Mar 2024)
- Losing the Plot: chart-degradation: [arxiv.org/pdf/2509.18425](https://arxiv.org/pdf/2509.18425) (Sep 2025)
- Seeing is Believing: mitigating OCR hallucinations: [arxiv.org/html/2506.20168v2](https://arxiv.org/html/2506.20168v2) (2025)
- VLMs map logos to text: [arxiv.org/pdf/2510.12287](https://arxiv.org/pdf/2510.12287) (Oct 2025)
- Holistic analysis of GPT-4V hallucination (Bingo): [arxiv.org/pdf/2311.03287](https://arxiv.org/pdf/2311.03287)
- Claude vs GPT-4o OCR: [codesota.com/ocr/claude-vs-gpt4o-ocr](https://www.codesota.com/ocr/claude-vs-gpt4o-ocr)
- Claude Opus 4.7 benchmark breakdown: [mindstudio.ai/blog/claude-opus-47-benchmark-breakdown](https://www.mindstudio.ai/blog/claude-opus-47-benchmark-breakdown)
- GPT-5.5 vs Claude Opus 4.7 hallucination: [cometapi.com/gpt-5-5-vs-claude-opus-4-7-which-ai-to-use-when-hallucination-matters-2026-benchmark-data](https://www.cometapi.com/gpt-5-5-vs-claude-opus-4-7-which-ai-to-use-when-hallucination-matters-2026-benchmark-data/)
- PromptPort: [arxiv.org/pdf/2601.06151](https://arxiv.org/pdf/2601.06151)
- OpenAI dev community Structured Outputs reliability: [community.openai.com/t/structured-outputs-not-reliable-with-gpt-4o-mini-and-gpt-4o/918735](https://community.openai.com/t/structured-outputs-not-reliable-with-gpt-4o-mini-and-gpt-4o/918735)
- USPTO Multi-frame videotext recognition: [image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8290273](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8290273)
- OCR confidence values patent: [image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8452099](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8452099)
- Casino-table ROI patent: [image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10650550](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10650550)
- LEADTOOLS OCR confidence reporting: [leadtools.com/help/sdk/v21/dh/to/ocr-confidence-reporting.html](https://www.leadtools.com/help/sdk/v21/dh/to/ocr-confidence-reporting.html)
- Confidence-aware doc OCR error detection: [arxiv.org/pdf/2409.04117](https://arxiv.org/pdf/2409.04117) (Sep 2024)
- Cost-effective hallucination detection: [arxiv.org/pdf/2407.21424](https://arxiv.org/pdf/2407.21424) (Jul 2024)
- Snorkel: [arxiv.org/pdf/1711.10160](https://arxiv.org/pdf/1711.10160), [snorkel.ai/blog/few-shot-learning-large-language-models](https://snorkel.ai/blog/few-shot-learning-large-language-models/), DryBell [arxiv.org/pdf/1812.00417](https://arxiv.org/pdf/1812.00417)
- AT-ST OCR self-training: [arxiv.org/pdf/2104.13037](https://arxiv.org/pdf/2104.13037)
- Pseudo-labelling refs: [arxiv.org/pdf/2301.07294](https://arxiv.org/pdf/2301.07294), [arxiv.org/pdf/2401.00575](https://arxiv.org/pdf/2401.00575), [arxiv.org/pdf/2303.01117](https://arxiv.org/pdf/2303.01117)
- Few-shot VLM classification (SAVs): [arxiv.org/html/2412.00142v3](https://arxiv.org/html/2412.00142v3)
- VLM in-context few-shot inspection: [arxiv.org/pdf/2502.09057](https://arxiv.org/pdf/2502.09057) (Feb 2025)
- CLIP zero-shot refs: [pinecone.io/learn/series/image-search/zero-shot-image-classification-clip](https://www.pinecone.io/learn/series/image-search/zero-shot-image-classification-clip/), [galileo.ai/blog/openai-clip-computer-vision-zero-shot-classification](https://galileo.ai/blog/openai-clip-computer-vision-zero-shot-classification), [huggingface.co/docs/transformers/tasks/zero_shot_image_classification](https://huggingface.co/docs/transformers/tasks/zero_shot_image_classification)
- From Pixels to Titles (game-screenshot CNN classifier): [arxiv.org/pdf/2311.15963](https://arxiv.org/pdf/2311.15963)
- Lightweight DL comparison (May 2025): [arxiv.org/pdf/2505.03303](https://arxiv.org/pdf/2505.03303)
- Spotlight (mobile UI VLM): [arxiv.org/pdf/2209.14927](https://arxiv.org/pdf/2209.14927)
- Event-Anchored Frame Selection (EFS): [arxiv.org/html/2603.00983](https://arxiv.org/html/2603.00983) + OpenReview [openreview.net/forum?id=43Ycr1QZXr](https://openreview.net/forum?id=43Ycr1QZXr)
- DEV.to frame-dedup + scene detection for VLMs: [dev.to/pritom14/how-i-built-video-token-optimization-for-vision-llms-cutting-costs-13-45-with-frame-dedup-scene-2ic](https://dev.to/pritom14/how-i-built-video-token-optimization-for-vision-llms-cutting-costs-13-45-with-frame-dedup-scene-2ic)
- HMM cricket highlight CVPR 2018: [openaccess.thecvf.com/content_cvpr_2018_workshops/papers/w34/Shukla_Automatic_Cricket_Highlight_CVPR_2018_paper.pdf](https://openaccess.thecvf.com/content_cvpr_2018_workshops/papers/w34/Shukla_Automatic_Cricket_Highlight_CVPR_2018_paper.pdf)
- Content-aware sports video survey: [arxiv.org/pdf/1703.01170](https://arxiv.org/pdf/1703.01170)
- Consensus sequence voting for OCR (1996): [sciencedirect.com/science/article/abs/pii/S1077314296905020](https://www.sciencedirect.com/science/article/abs/pii/S1077314296905020)
- ByteTrack: [ecva.net/papers/eccv_2022/papers_ECCV/papers/136820001-supp.pdf](https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136820001-supp.pdf)
- BoxMOT: [pypi.org/project/boxmot/10.0.12](https://pypi.org/project/boxmot/10.0.12/)
- Hungarian algorithm refs: [en.wikipedia.org/wiki/Hungarian_algorithm](https://en.wikipedia.org/wiki/Hungarian_algorithm), [thinkautonomous.ai/blog/hungarian-algorithm](https://www.thinkautonomous.ai/blog/hungarian-algorithm/), [digitalocean.com/community/tutorials/introduction-detr-hungarian-algorithm-2](https://www.digitalocean.com/community/tutorials/introduction-detr-hungarian-algorithm-2)
- Operation Sports NHL 26 patch notes (sample): [operationsports.com/nhl-26-update-1-30-arrives-tomorrow-december-2-patch-notes](https://www.operationsports.com/nhl-26-update-1-30-arrives-tomorrow-december-2-patch-notes/), [operationsports.com/nhl-26-update-1-2-0-improves-goalie-ai-and-career-mode-stability-patch-notes](https://www.operationsports.com/nhl-26-update-1-2-0-improves-goalie-ai-and-career-mode-stability-patch-notes/), [operationsports.com/nhl-26-update-1-5-available-today-patch-notes](https://www.operationsports.com/nhl-26-update-1-5-available-today-patch-notes/)
- Tesseract digit/seven-segment recipes: [tesseract-ocr.github.io/tessdoc/ImproveQuality.html](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html), [arxiv.org/pdf/2004.08079](https://arxiv.org/pdf/2004.08079)
