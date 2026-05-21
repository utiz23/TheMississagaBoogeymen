"""Phase 2A loadout extractor package.

Public surface:
    ClosedVocab        — frozen dataclass, alias-regex + fuzzy match_canonical
    ClosedVocabEntry   — single entry (canonical + compiled alias patterns)
    load_closed_vocab  — load an entries:-schema YAML by family + version
    load_attribute_keys — load attribute_keys.yaml (groups:-schema) as dict

    SubjectIdentity         — frozen dataclass; ONE frame's identified subject (new)
    extract_subject_identity — identify the subject of a single loadout-view frame (new)

    SlotIdentity            — DEPRECATED frozen dataclass (old one-row-per-visible-row contract)
    extract_slot_identities — DEPRECATED extract slot identities from a frame

    IconEvidence         — frozen dataclass; one icon-family candidate
    LoadoutIconExtractor — wraps match_icon + _classify_xfactor_tier

    OpenTextEvidence         — frozen dataclass; one n-best candidate for open-text fields
    LoadoutOpenTextExtractor — filters RapidOCR lines to ROI, emits ranked candidates
"""

from .closed_vocab import ClosedVocab, ClosedVocabEntry, load_attribute_keys, load_closed_vocab
from .icon import IconEvidence, LoadoutIconExtractor
from .open_text import LoadoutOpenTextExtractor, OpenTextEvidence
from .slot_identity import (
    MAX_ROWS_PER_LOADOUT_SEGMENT,
    ROW_Y_BUCKET_TOLERANCE_PX,
    # New (Phase 2A revised)
    SubjectIdentity,
    extract_subject_identity,
    # Deprecated (Phase 2A original, kept for backward compat)
    SlotIdentity,
    extract_slot_identities,
)

__all__ = [
    "ClosedVocab",
    "ClosedVocabEntry",
    "load_closed_vocab",
    "load_attribute_keys",
    # New
    "SubjectIdentity",
    "extract_subject_identity",
    # Deprecated (backward compat)
    "SlotIdentity",
    "extract_slot_identities",
    "ROW_Y_BUCKET_TOLERANCE_PX",
    "MAX_ROWS_PER_LOADOUT_SEGMENT",
    "IconEvidence",
    "LoadoutIconExtractor",
    "OpenTextEvidence",
    "LoadoutOpenTextExtractor",
]
