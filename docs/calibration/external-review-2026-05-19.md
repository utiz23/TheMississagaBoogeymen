# External Review — 2026-05-19

> Written from the perspective of an outside engineer joining this week with no prior exposure to the codebase.

---

**1. Over-Engineering**

The research is materially over-built for the system described in the baseline: one author, a handful of teammates, two matches in hand, roughly 30 matches per season, and no SLA. Recommending Hungarian assignment, seeded tracklets, calibration artifacts, frozen eval splits, append-only label manifests, and optional DVC-style reproducibility is what you do when you expect volume, staff turnover, or operational risk. The internal review correctly trims some of that, but it still accepts the premise that the chevron matcher and classifier stack deserve architecture-first treatment. For this scale, the bar is not "literature-aligned design"; it is "does this save obvious manual cleanup this week?" A lot of the proposed machinery does not.

**2. Simpler Alternatives**

The research walks past simpler paths too quickly. The baseline already says L3 completeness is driven by EA-payload-derived expectations and that match 250 lineup resolution is functionally near 100% despite cosmetic OCR drift. That should have triggered a blunt option: lean harder on EA/API data for everything it can authoritatively provide, and treat OCR as enrichment, not truth — especially for loadout attributes and decorative tables. Likewise, for Class A residuals the baseline already offers a simple option: widen Levenshtein selectively or keep them flagged for review. That is a valid product decision at this scale. Neither the research nor the internal review seriously considers "accept a few flagged residuals and stop."

**3. Operator Workflow Realism**

The internal review is right to attack the five-minute labeling assumption, and I would push harder. The baseline says match 463 has 1,680 sampled frames and only two accepted loadout frames, while the research proposes disagreement, near-boundary, downstream-failure, and random slices without a hard cap. That is not a five-minute loop. It is barely a ten-minute loop unless the tool aggressively pre-filters and the task definition is stripped down to maybe 15–20 clicks. If the first round also asks the operator to manage manifests, labels, and eval hygiene, it is longer than ten minutes. The research treats active learning as if selection cost is the same as annotation cost; for a single user, the overhead dominates.

**4. Do-Nothing Options**

There is more do-nothing value here than either document admits. The clearest example is Q1: the baseline reports six chevron-collision pairs on one unattended match, not a season-wide epidemic, and even the internal review notes the recommendation is partly overfit to match 463. That is a reason to ask whether this is a real product defect or a report artifact amplified by the new delta-based Class C detector. If those six pairs do not materially distort the site's visible outputs, then a sophisticated matcher rewrite is pixel-perfectionism. The same applies to Q2 and Q3: if loadout OCR is mainly missing decorative or low-value attributes, doing nothing until more matches exist is rational.

**5. Work Order**

The ordering is wrong for the actual workload. With two matches today and roughly 30 per season, Phase 0 loadout-attrs should move to the back unless those attributes unlock something user-visible that the baseline does not show. Phase 3 annotate-segments should also not be elevated into an infrastructure project before proving the classifier problem matters in production. The first move should be the smallest useful version of Phase 5b.2 only if the six collision pairs are visibly corrupting match pages; otherwise defer it too. My outside ordering is: first verify whether Class C causes real output errors, second apply the cheapest matcher patch or threshold tweak that clears those errors, third postpone loadout/classifier corpus work until at least a few more unattended matches exist.

---

Overall, the research is strong on method and weak on restraint. The internal review catches some implementation mismatches, but it still under-challenges whether this tiny system deserves pipeline-grade solutions at all. The correct outside take is: do the cheapest thing that eliminates visible user-facing errors, ignore everything else until volume justifies it, and revisit after a full season of data exists.
