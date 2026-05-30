"""Pass 2: dense PNG extraction for each Pass-1 segment.

Per-segment ffmpeg invocation. Each segment becomes its own
sub-directory containing zero-padded PNG frames. The directory name
encodes segment index + screen type so downstream `periodFromPath`
fallbacks and `cutoff_event_recovery` filename regexes can pick up
ordering cheaply.

We use `-ss` BEFORE `-i` for keyframe-aligned fast seek, plus `-to`
for the segment end. Padding around the Pass-1 boundary is configured
in the version YAML (defaults to 1s) to defend against the 1-fps
sample granularity in Pass 1.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from video_ingest.pass1_classify import (
    Segment,
    VIDEO_INGEST_CONFIGS_DIR,
    _sha256_of,
)

# Lazy import sentinel — populated on first use when loadout_engine='typed_v1'.
# Exposed at module scope so unit tests can patch it without a live game_ocr
# install: `patch("video_ingest.pass2_extract.extract_loadout_evidence", ...)`
extract_loadout_evidence = None  # type: ignore[assignment]
# Lazy import sentinel for the Phase 3b lobby extractor — same pattern as
# loadout. Populated on first use when lobby_engine='typed_v1'.
extract_lobby_evidence = None  # type: ignore[assignment]


PASS2_MANIFEST_FILENAME = "pass2_manifest.json"


def compute_pass2_cache_key(version: str, artifact_mode: bool = True) -> str:
    """Hash of the orchestrator-side version YAML + the artifact_mode flag.
    Pass 2 doesn't need the classifier YAML — classifier changes propagate
    via segments_hash. The artifact_mode byte is included so a switch
    between PNG-on-disk and in-memory frame providers invalidates the
    cache (running typed_v1 evidence extraction without artifacts when
    the cached run had PNGs would produce a directory the extractors
    can't read)."""
    version_yaml = VIDEO_INGEST_CONFIGS_DIR / f"{version}.yaml"
    parts: list[bytes] = [version_yaml.read_bytes(), b"\x00"]
    parts.append(b"artifact_mode=true" if artifact_mode else b"artifact_mode=false")
    return _sha256_of(b"".join(parts))


@dataclass
class Pass2Config:
    window_padding_seconds: float = 1.0
    sample_rates: dict[str, float] = None  # type: ignore[assignment]
    extract_screens: set[str] = None  # type: ignore[assignment]
    # loadout_engine: selects the player_loadout_view extraction path.
    # 'legacy' (default) = existing parse_loadout_result() pass-through.
    # 'typed_v1'         = extract_loadout_evidence() → loadout_evidence.json.
    # Task 2B-9 flipped the production default to 'typed_v1'.
    loadout_engine: str = "legacy"
    # lobby_engine: selects the pre_game_lobby_state_2 extraction path.
    # 'legacy' (default) = existing parse_pre_game_result() pass-through
    #                       (still used for pre_game_lobby_state_1 — no
    #                       typed extractor exists for that state per Phase 3a).
    # 'typed_v1'         = extract_lobby_evidence() → lobby_evidence.json.
    # Task 3B-8 flips the production default to 'typed_v1' for state_2 only.
    lobby_engine: str = "legacy"
    # Phase 3a: artifact mode. True = write PNGs to disk per segment (the
    # legacy behavior, fed to legacy game_ocr.cli + the existing typed_v1
    # extractors that glob the segment dir). False = process frames in
    # memory and only write evidence JSON. Phase 3a scaffolds the flag +
    # cache key inclusion; Phase 3b wires the typed_v1 extractors to
    # consume a `FrameProvider` so the False path actually skips PNG
    # writes for those segments. Default True preserves today's behavior.
    artifact_mode: bool = True


def _ffmpeg_extract(
    video_path: Path,
    out_dir: Path,
    start_seconds: float,
    end_seconds: float,
    fps: float,
) -> int:
    """Run ffmpeg to extract PNGs into out_dir. Returns frame count."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(out_dir / "%05d.png")
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        # Seek BEFORE -i for fast keyframe-aligned start.
        "-ss", f"{start_seconds:.3f}",
        "-to", f"{end_seconds:.3f}",
        "-i", str(video_path),
        "-vf", f"fps={fps}",
        "-fps_mode", "passthrough",
        pattern,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (rc={res.returncode}) for {out_dir}\n{res.stderr}"
        )
    return len(list(out_dir.glob("*.png")))


def segment_dir_name(seg_idx: int, seg: Segment) -> str:
    """Standardized per-segment directory name. Encodes segment index
    plus screen_type so listings sort chronologically."""
    return f"seg-{seg_idx:03d}-{seg.screen_type}"


@dataclass
class Pass2Result:
    segment_index: int
    segment: Segment
    directory: Path
    frame_count: int
    sample_fps: float
    start_seconds: float
    end_seconds: float


def extract_segments(
    video_path: Path,
    segments: list[Segment],
    config: Pass2Config,
    pass2_root: Path,
    video_duration_seconds: float | None = None,
    *,
    version: str,
    segments_hash: str,
) -> list[Pass2Result]:
    """Extract every segment whose screen_type is in `extract_screens`.
    Skipped segments still get an entry in the returned list (frame_count=0)
    so the orchestrator can log them.

    Writes pass2_manifest.json with the cache identifiers needed for the
    Issue-2 invalidation contract: pass2_cache_key (config-derived) plus
    segments_hash (so Pass 1 invalidation cascades to Pass 2)."""
    if config.sample_rates is None or config.extract_screens is None:
        raise ValueError("Pass2Config.sample_rates and extract_screens must be set")

    out: list[Pass2Result] = []
    pass2_root.mkdir(parents=True, exist_ok=True)

    for i, seg in enumerate(segments):
        if seg.screen_type not in config.extract_screens:
            continue
        fps = float(config.sample_rates.get(seg.screen_type, 1.0))
        pad = config.window_padding_seconds
        start = max(0.0, seg.start_seconds - pad)
        end = seg.end_seconds + pad
        if video_duration_seconds is not None:
            end = min(end, video_duration_seconds)
        if end <= start:
            continue

        seg_dir = pass2_root / segment_dir_name(i, seg)
        frame_count = _ffmpeg_extract(video_path, seg_dir, start, end, fps)

        # --- loadout_engine dispatch (player_loadout_view only) ---------------
        if seg.screen_type == "player_loadout_view":
            loadout_engine = config.loadout_engine
            if loadout_engine == "typed_v1":
                _run_typed_v1_loadout(seg_dir, segment_index=i)
            elif loadout_engine != "legacy":
                raise ValueError(
                    f"Unknown pass2.loadout_engine: {loadout_engine!r}; "
                    f"expected 'legacy' or 'typed_v1'"
                )
            # 'legacy' branch: no action here — downstream ingest-ocr-cli /
            # parse_loadout_result() handles this segment as before.

        # --- lobby_engine dispatch (pre_game_lobby_state_2 only) --------------
        if seg.screen_type == "pre_game_lobby_state_2":
            lobby_engine = config.lobby_engine
            if lobby_engine == "typed_v1":
                _run_typed_v1_lobby(seg_dir, segment_index=i)
            elif lobby_engine != "legacy":
                raise ValueError(
                    f"Unknown pass2.lobby_engine: {lobby_engine!r}; "
                    f"expected 'legacy' or 'typed_v1'"
                )
            # 'legacy' branch: no action here — downstream ingest-ocr-cli /
            # parse_pre_game_result() handles this segment as before.
            # NOTE: pre_game_lobby_state_1 does NOT get a typed-v1 path
            # because Phase 3a confirmed state_1 frames don't appear in
            # operator recordings (see docs/calibration/phase-3a-hmm-
            # disambiguation-2026-05-22.md). state_1 segments continue
            # through the legacy parser.

        out.append(Pass2Result(
            segment_index=i,
            segment=seg,
            directory=seg_dir,
            frame_count=frame_count,
            sample_fps=fps,
            start_seconds=start,
            end_seconds=end,
        ))
        print(
            f"  seg {i:03d}  {seg.screen_type:30s}  {start:6.1f}s..{end:6.1f}s  "
            f"@ {fps}fps  →  {frame_count} frames  ({seg_dir.relative_to(pass2_root.parent)})",
            file=sys.stderr,
        )

    write_pass2_manifest(
        pass2_root.parent / PASS2_MANIFEST_FILENAME,
        out,
        version=version,
        cache_key=compute_pass2_cache_key(version, config.artifact_mode),
        segments_hash=segments_hash,
        artifact_mode=config.artifact_mode,
    )
    return out


def _run_typed_v1_loadout(seg_dir: Path, *, segment_index: int) -> None:
    """Run the typed_v1 loadout extractor and write FieldEvidenceRecord[] JSON.

    Lazily imports ``extract_loadout_evidence`` from ``game_ocr.loadout_evidence``
    on first call (keeps Pass-2 startup fast and allows test patching at the
    module-level name ``video_ingest.pass2_extract.extract_loadout_evidence``).

    Writes ``<seg_dir>/loadout_evidence.json``.
    """
    global extract_loadout_evidence  # noqa: PLW0603
    if extract_loadout_evidence is None:
        from game_ocr.loadout_evidence import (  # type: ignore[no-redef]
            extract_loadout_evidence as _extract,
        )
        # Assign to the module-level name so subsequent calls (and tests that
        # patch after the first import) see the same object.
        import video_ingest.pass2_extract as _self
        _self.extract_loadout_evidence = _extract
        extract_loadout_evidence = _extract

    records = extract_loadout_evidence(
        bundle_dir=seg_dir,
        segment_index=segment_index,
    )
    out_path = seg_dir / "loadout_evidence.json"
    with out_path.open("w") as fp:
        json.dump([r.to_dict() for r in records], fp, indent=2)


def _run_typed_v1_lobby(seg_dir: Path, *, segment_index: int) -> None:
    """Run the typed_v1 lobby extractor and write FieldEvidenceRecord[] JSON.

    Mirrors `_run_typed_v1_loadout`: lazy import of `extract_lobby_evidence`
    from ``game_ocr.lobby_evidence`` on first call; writes
    ``<seg_dir>/lobby_evidence.json``.
    """
    global extract_lobby_evidence  # noqa: PLW0603
    if extract_lobby_evidence is None:
        from game_ocr.lobby_evidence import (  # type: ignore[no-redef]
            extract_lobby_evidence as _extract,
        )
        import video_ingest.pass2_extract as _self
        _self.extract_lobby_evidence = _extract
        extract_lobby_evidence = _extract

    records = extract_lobby_evidence(
        bundle_dir=seg_dir,
        segment_index=segment_index,
    )
    out_path = seg_dir / "lobby_evidence.json"
    with out_path.open("w") as fp:
        json.dump([r.to_dict() for r in records], fp, indent=2)


@dataclass
class Pass2ManifestLoaded:
    version: str | None
    pass2_cache_key: str | None
    segments_hash: str | None
    # Phase 3a: artifact_mode the cached run wrote with. None on legacy
    # manifests that pre-date the field — treated as a cache miss so the
    # operator's current artifact_mode setting takes effect on re-extract.
    artifact_mode: bool | None
    results: list[Pass2Result]

    @property
    def is_legacy(self) -> bool:
        """True if the manifest lacks any required Issue-2 / Phase-3a
        cache field. Caller treats this as cache miss."""
        return (
            self.version is None
            or self.pass2_cache_key is None
            or self.segments_hash is None
            or self.artifact_mode is None
        )


def write_pass2_manifest(
    path: Path,
    results: list[Pass2Result],
    *,
    version: str,
    cache_key: str,
    segments_hash: str,
    artifact_mode: bool = True,
) -> None:
    """Persist the Pass 2 manifest. Called once per fresh extraction; the
    file is the authoritative record of which (padded) windows ffmpeg saw,
    plus the cache identifiers used to detect config drift on subsequent
    runs."""
    entries = [
        {
            "segment_index": r.segment_index,
            "screen_type": r.segment.screen_type,
            "directory": str(r.directory),
            "frame_count": r.frame_count,
            "sample_fps": r.sample_fps,
            "start_seconds": r.start_seconds,
            "end_seconds": r.end_seconds,
        }
        for r in results
    ]
    payload = {
        "version": version,
        "pass2_cache_key": cache_key,
        "segments_hash": segments_hash,
        "artifact_mode": artifact_mode,
        "entries": entries,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def load_pass2_manifest(path: Path, segments: list[Segment]) -> Pass2ManifestLoaded:
    """Load the Pass 2 manifest. Returns a `Pass2ManifestLoaded` whose
    `version`/`pass2_cache_key`/`segments_hash`/`artifact_mode` are None
    for legacy bare-list manifests (Issue-4 schema) or pre-Phase-3a
    manifests that pre-date the artifact_mode field. Raises
    FileNotFoundError if the manifest is absent."""
    data = json.loads(path.read_text())
    if isinstance(data, list):
        entries = data
        version = None
        cache_key = None
        segments_hash = None
        artifact_mode: bool | None = None
    else:
        entries = data.get("entries", [])
        version = data.get("version")
        cache_key = data.get("pass2_cache_key")
        segments_hash = data.get("segments_hash")
        # `artifact_mode` was introduced in Phase 3a. Pre-existing manifests
        # lack the key; treat that as None (legacy) so the cache mismatch
        # path forces a fresh extract under the operator's current setting.
        artifact_mode = data.get("artifact_mode")
        if artifact_mode is not None and not isinstance(artifact_mode, bool):
            raise ValueError(
                f"pass2_manifest.json `artifact_mode` must be a bool when present, "
                f"got {type(artifact_mode).__name__}: {artifact_mode!r}"
            )
    results: list[Pass2Result] = []
    for entry in entries:
        idx = entry["segment_index"]
        results.append(Pass2Result(
            segment_index=idx,
            segment=segments[idx],
            directory=Path(entry["directory"]),
            frame_count=entry["frame_count"],
            sample_fps=entry["sample_fps"],
            start_seconds=entry["start_seconds"],
            end_seconds=entry["end_seconds"],
        ))
    return Pass2ManifestLoaded(
        version=version,
        pass2_cache_key=cache_key,
        segments_hash=segments_hash,
        artifact_mode=artifact_mode,
        results=results,
    )
