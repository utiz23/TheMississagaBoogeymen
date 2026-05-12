# Deep-Research Queue

Persistent list of topics we want to commission deep research on, but haven't yet.
Order is rough priority. Move items out as they're commissioned, and add the
returned dossier link.

---

## Active / Commissioned

- **Card progression / collectibles design system** — prompt drafted at
  [`docs/cards/card-progression-deep-research-prompt.md`](../cards/card-progression-deep-research-prompt.md).
  Awaiting submission.

## Queued — later research

### Hockey analytics for EASHL-scale data

What to learn from real NHL analytics that adapts to our ~100s-of-games scale:

- per-60-minute rate stats and when to use them vs raw counts
- xG-like models for amateur shot data (we have shot location grids per
  zone — what can we usefully build from that?)
- how to display rating-with-confidence when sample size is small (most
  EASHL players have GP in the dozens, not hundreds)
- position-adjusted rating math (D vs F vs G comparability — common
  problem solved many ways)
- relevance / decay weighting (recent games count more, but how much)

There's some prior internal work on this (memory: V3 scoring formula,
Luszczyszyn anchor, G:A ratio) — a Round-2 deep research would deepen
that with literature-survey-grade output on small-sample analytics.

**Why this is on the queue (not yet commissioned):** we just shipped
ratings/rank ingestion (migration 0024). Before going deeper, we want
to see how the existing ratings feel in the UI for a few weeks. The
deep research is more valuable when we know what the gaps actually are.

### Broadcast-strip / sports overlay UI design

What modern hockey broadcasts (and good sports broadcasts in general)
do with typography, motion, info density, and color hierarchy:

- scoreboard overlay patterns — what stays static vs what animates
- typography for stats at small sizes (tabular numerals, leading, weight contrast)
- info-density bands — how broadcasts pack a lot of info into a strip
  without it reading as cluttered
- motion design for state changes (goal scored, period change, OT) —
  what reads as "broadcast" vs "web app"
- color usage patterns for team accent / win-loss / inactive states
- how broadcasts handle responsive sizing (mobile clip, desktop, big screen)

Would inform both the renovation polish _and_ the card design
simultaneously — our stated design direction is "broadcast strip
esports aesthetic" but we haven't surveyed prior art deeply.

**Why this is on the queue (not yet commissioned):** lower-priority
than card progression because it's polish on something that's already
shipped and works. Best timed when we're about to do another visible
renovation pass.

---

## Done / archived

(Past deep-research dossiers ingested. Linked here for provenance.)

- **Marker-extraction calibration** — Round 1 + Round 2 in
  [`docs/ocr/marker-extraction-research.md`](../ocr/marker-extraction-research.md).
  4 internal spikes queued.
- **Event-list extraction** — Round 1 + Round 2 in
  [`docs/ocr/event-list-extraction-research.md`](../ocr/event-list-extraction-research.md).
  17 internal-spike candidates queued.
- **Pre-game extraction** — diagnosis + internal research in
  [`docs/ocr/pre-game-extraction-research.md`](../ocr/pre-game-extraction-research.md).
  Pipeline shipped.
