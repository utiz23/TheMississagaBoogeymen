from __future__ import annotations

import json
import sys
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


if __name__ == "__main__":
    app()
