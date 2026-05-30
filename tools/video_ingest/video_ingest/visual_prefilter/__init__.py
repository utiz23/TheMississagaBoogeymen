"""Visual prefilter shared by Pass-1 emissions biasing and Pass-2 frame
selection. Phase 1 ships the signal primitives (this module); policy
modules (`pass1_policy`, `pass2_policy`) and template matching land in
follow-up phases.
"""

from video_ingest.visual_prefilter.signals import (
    VisualSignals,
    compute_visual_signals,
)

__all__ = ["VisualSignals", "compute_visual_signals"]
