"""Phase 2A loadout extractor package.

Public surface:
    ClosedVocab        — frozen dataclass, alias-regex + fuzzy match_canonical
    ClosedVocabEntry   — single entry (canonical + compiled alias patterns)
    load_closed_vocab  — load an entries:-schema YAML by family + version
    load_attribute_keys — load attribute_keys.yaml (groups:-schema) as dict
"""

from .closed_vocab import ClosedVocab, ClosedVocabEntry, load_attribute_keys, load_closed_vocab

__all__ = [
    "ClosedVocab",
    "ClosedVocabEntry",
    "load_closed_vocab",
    "load_attribute_keys",
]
