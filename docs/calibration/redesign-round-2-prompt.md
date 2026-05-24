# Round 2 prompt — External internet research

**To be run as:** a general-purpose agent with WebSearch + WebFetch tools, after Round 1 completes. Output saves to `docs/calibration/redesign-round-2-external-internet-2026-05-19.md`.

---

You are Round 2 of a four-round research process to redesign an OCR pipeline that ingests recorded EA NHL Pro Clubs match videos into a Postgres-backed stats site. Rounds: (1) internal codebase research — completed; (2) external internet research — **you, now**; (3) deep-research literature review — running in parallel with you; (4) Codex synthesis — runs last.

**The redesign's goal**, one sentence: reliably extract every metric defined in `docs/ocr/source-screen-inventory.md` and `research/OCR-SS/Manual OCR benchmark for verification V2.md` from a recorded EA NHL match video, without manual intervention, at ≥98% per-field accuracy. Constraints: single-author, low-volume (~30 matches/season), no API ground truth for most fields, no test-time human review, must survive NHL 26 → 27 UI changes.

**The pipeline today.** Two-pass design:

- Pass 1: 1 fps sampling → HSV-cosine color classification + anchor-text fuzzy-Levenshtein gate → 8 screen types or `unknown_screen` → run-length compressed segments.
- Pass 2: dense per-segment ffmpeg extraction → screen-specific parsers → `ocr_extractions` table.
- Promotion layer: per-screen promoters fan extractions into per-table downstream rows.
- OCR engine: RapidOCR (CUDA) on RTX 3060.
- Truth system: V2-style hand-keyed markdown (one match keyed so far).

**What I need from you.** A written assessment, citing URLs and dated. Focus on the _production wisdom_ the internet has accumulated — not theory, not vendor marketing. Sections required:

1. **State of the art in structured-data OCR from video.** What architectures dominate production pipelines in adjacent domains:
   - Sports broadcast scoreboard / graphics extraction (NFL/NBA/NHL telemetry providers like Stats Perform, Sportradar, Genius Sports, SportsCode — what's been written about their pipelines).
   - eSports / game-video data extraction (e.g. League of Legends post-game extractors, Counter-Strike demo parsers, Rocket League replay extractors). The community/mod scene often reverse-engineers exactly the structured data the publisher doesn't expose.
   - Document-AI and form-OCR pipelines (LayoutLMv3, Donut, PaddleOCR Structure) — relevant because EA's UI is essentially a structured document at every frame.
     For each: cite specific blog posts / papers / GitHub repos. What architecture do they use, and why?

2. **Single-pass vs two-pass vs event-driven OCR.** Survey the comparative production tradeoffs as discussed in the wild. Which approach do production systems actually ship? Where does the two-pass design fail (cite specific writeups)? Where does event-driven extraction fail? Has anyone written about HMM/Viterbi segmentation of game UI states?

3. **OCR engines compared in production.** RapidOCR vs PaddleOCR vs Tesseract vs cloud (Textract / Google Vision) vs vision-language models (GPT-4V / Claude vision / Gemini). For each: what do production writeups say about latency, accuracy on stylised game-UI fonts, hallucination/fabrication rate, total cost-per-match at our volume? Has anyone benchmarked these on EA Sports UI specifically?

4. **Probabilistic OCR / multi-hypothesis output.** Production systems that emit `P(field=value | evidence)` distributions instead of hard decisions — what's the operational experience? Where does it pay off? Where does it cost more than it's worth?

5. **Small-corpus calibration loops.** Active-learning for OCR with very small labelled fixture sets (think: ~50 frames per class). What works in practice for single-author projects? Snorkel-style weak supervision? Self-training? Few-shot prompt engineering with vision-language models? Cite specific writeups.

6. **EA Pro Clubs API anchoring.** Is there community wisdom about how much to trust EA's undocumented Pro Clubs API for player identity vs OCR? (Our `players.ea_id` is permanently nullable because blazeId is absent in production payloads — gamertag from EA payload is the real anchor.) Has anyone written about EA NHL stat-tracking that combines API + video?

7. **Surviving UI changes.** How do production game-OCR pipelines handle the annual game-version-bump that breaks every visual assumption? Versioned classifier configs? Pixel-level anchor regression tests? Re-training? Cite real examples.

8. **Honest negative results.** Have any production systems tried a vision-language-model-end-to-end approach (e.g. screenshot → GPT-4V → JSON) and reported it doesn't work, or works but costs too much? Find these.

**Hard constraints:**

- Cite specific URLs and dates for every claim. No "I recall that…" — link the source.
- Distinguish between vendor marketing and engineering writeups. Discount the former.
- Note where the literature/community is silent or fuzzy — silence is data.
- Length: thorough. ~3000–6000 words.
- Save to `docs/calibration/redesign-round-2-external-internet-2026-05-19.md`.

Begin.
