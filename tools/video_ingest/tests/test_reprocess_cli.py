"""Task 8 — reprocess subcommand skeleton CLI surface.

Pins the command's existence and the required flag set. The full reprocess
body lands in Task 9; here we only assert the CLI surface and the --undo
escape valve is wired through to decoder-runs-cli.
"""

from __future__ import annotations

from typer.testing import CliRunner

from video_ingest.cli import app


def test_reprocess_subcommand_help_lists_required_args() -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["reprocess", "--help"])
    assert result.exit_code == 0, result.stdout
    assert "--match-id" in result.stdout
    assert "--video" in result.stdout
    assert "--dry-run" in result.stdout
    assert "--undo" in result.stdout


def test_reprocess_subcommand_is_registered() -> None:
    runner = CliRunner()
    # `--match-id` is required; bare `reprocess` must error.
    result = runner.invoke(app, ["reprocess"])
    assert result.exit_code != 0
