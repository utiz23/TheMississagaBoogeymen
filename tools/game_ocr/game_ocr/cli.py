from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

import typer

from game_ocr.extractor import Extractor, ScreenRegistry


app = typer.Typer(add_completion=False, no_args_is_help=True)


@app.command()
def extract(
    screen: str = typer.Option(..., help="Supported screen type."),
    input: Path = typer.Option(..., exists=True, readable=True, resolve_path=True, help="Image file or folder."),
    output: Path = typer.Option(..., resolve_path=True, help="JSON output path."),
) -> None:
    registry = ScreenRegistry()
    if screen not in registry.list_screen_types():
        typer.secho(f"Unsupported screen '{screen}'. Choices: {', '.join(registry.list_screen_types())}", err=True, fg=typer.colors.RED)
        raise typer.Exit(code=2)

    extractor = Extractor(registry=registry)
    results = extractor.extract_input(screen, input)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = [result.model_dump(mode="json") for result in results]
    output.write_text(json.dumps(payload, indent=2))

    warnings = 0
    for result in results:
        warnings += len(result.warnings) + len(result.errors)
        for message in result.errors:
            print(f"[error] {result.meta.source_path}: {message}", file=sys.stderr)
        for message in result.warnings:
            print(f"[warn] {result.meta.source_path}: {message}", file=sys.stderr)

    typer.echo(f"Wrote {len(results)} result(s) to {output}")
    if warnings:
        raise typer.Exit(code=1)


@app.command("list-screens")
def list_screens() -> None:
    registry = ScreenRegistry()
    for screen_type in registry.list_screen_types():
        typer.echo(screen_type)


@app.command()
def classify(
    input: Path = typer.Option(
        ..., exists=True, readable=True, resolve_path=True,
        help="Image file or directory of images.",
    ),
    version: str = typer.Option("nhl26", help="Game-UI config version (nhl26, nhl27, ...)."),
    use_gpu: bool = typer.Option(True, help="Use CUDA EP if available."),
) -> None:
    """Classify image(s) into screen types. Emits NDJSON to stdout — one
    JSON object per input image with screen_type + confidence + anchor
    text. Used by video_ingest's Pass-1 segmenter."""
    import cv2  # local import keeps Typer help fast

    # Lazy GPU lib preload so CPU-only usage doesn't pay the import cost.
    if use_gpu:
        try:
            repo_root = Path(__file__).resolve().parents[3]
            sys.path.insert(0, str(repo_root / "tools" / "video_ingest"))
            from video_ingest import gpu_libs as _gpu_libs  # type: ignore
            _gpu_libs.preload()
        except Exception:
            pass  # CPU EP will still work

    from game_ocr.classifier import Classifier, load_classifier_config

    cfg = load_classifier_config(version)
    clf = Classifier(cfg, use_gpu=use_gpu)

    if input.is_file():
        paths = [input]
    else:
        paths = sorted(
            p for p in input.iterdir()
            if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".bmp"}
        )

    for p in paths:
        img = cv2.imread(str(p))
        if img is None:
            typer.secho(f"[error] cv2.imread failed: {p}", err=True, fg=typer.colors.RED)
            continue
        r = clf.classify(img)
        out = {
            "path": str(p),
            "screen_type": r.screen_type,
            "color_class": r.color_class,
            "color_score": round(r.color_score, 4),
            "confidence": round(r.confidence, 4),
            "anchor_text": r.anchor_text,
        }
        typer.echo(json.dumps(out))


if __name__ == "__main__":
    app()
