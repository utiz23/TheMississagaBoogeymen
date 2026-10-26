# Documentation Index

Documents are grouped by purpose. Put a new document in the narrowest folder
that fits. Do not put documents in the repository root or in `docs/` itself.

For a map of the whole repository (code, tools, and local-only folders such as
`_local/`), see the [root `README.md`](../README.md#repository-map).

## Start here

- [`../HANDOFF.md`](../HANDOFF.md) — current state and next actions.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture and schema notes.
- [`journal/`](journal/) — dated work diary (`YYYY-MM.md`). The detail that
  `HANDOFF.md` links to instead of repeating.

## Folders

| Folder                         | What goes here                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [`planning/`](planning/)       | Roadmaps, polish backlog, research queue, legal drafts, backup-transport designs                                              |
| [`specs/`](specs/)             | Feature and UI specifications; `cards/` = player-card and badge design; `player-dossiers/`                                    |
| [`superpowers/`](superpowers/) | Dated design specs (`specs/`) and implementation plans (`plans/`). The superpowers skills write here                          |
| [`operations/`](operations/)   | How we run things: workflow, smoke checks, backups; `runbooks/` = repair and backfill steps; `records/` = past deploy records |
| [`design/`](design/)           | Design references: mockups, screenshots, card examples, page designs; `handoffs/` = Claude Design exports                     |
| [`branding/`](branding/)       | Logos, icons, flags, palettes, rink event-map art                                                                             |
| [`research/`](research/)       | Internal research and reviews (UI reviews, audits, card research, video-extraction research)                                  |
| [`ocr/`](ocr/)                 | **Historical.** OCR designs, investigations, reports and runbooks                                                             |
| [`calibration/`](calibration/) | **Historical.** OCR benchmark baselines and phase reports. Worker tests read its JSON files — do not move                     |
| [`archive/`](archive/)         | Old `HANDOFF.md` snapshots and retired plans. Never edited                                                                    |

OCR and video-stats work moved to the sister repo `eanhl-live-engine` on
2026-10-21. `ocr/` and `calibration/` are kept for reference only.

### Planning: what is current

- [`planning/product-roadmap.md`](planning/product-roadmap.md),
  [`planning/database-roadmap.md`](planning/database-roadmap.md),
  [`planning/operational-v1-roadmap.md`](planning/operational-v1-roadmap.md) — roadmaps.
- [`planning/polish-backlog.md`](planning/polish-backlog.md) — UI and UX cleanup backlog.
- [`planning/research-queue.md`](planning/research-queue.md) — open research questions.
- Legal drafts and reviews (`privacy-policy-*`, `terms-of-use-*`,
  `data-collection-policy-*`, `ea-nhl-attribution-notice-*`, `ea-*`) — the
  public `/legal` pages are transcribed from the `-draft.md` files, and a web
  test reads them from this folder.
- `proton-drive-*` — backup-transport designs. Proton is parked; the backup
  code in `ops/backup/` still cites these files.

## Rules for moving documents

- Code, tests, migrations and the `ops/backup` scripts cite some documents by
  path. Before you move a document, run `git grep -n "<its path>"`.
- Do not edit `archive/`, applied migrations, or files that have `ocr` in
  their path outside `docs/` (that starts the long OCR pre-push check).
- Add each move to the table below.

## Moved on 2026-10-26

Old links in `archive/` snapshots, migrations, frozen OCR code and old branches
still use the old paths. Use this table to find the file.

| Old path                                                                 | New path                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `Game sheet prototype layout (1)/` (repo root)                           | `docs/design/handoffs/2026-07-game-sheet/`                              |
| `docs/POLISH_BACKLOG.md`                                                 | `docs/planning/polish-backlog.md`                                       |
| `docs/phase-b-labeling-worksheet.md`                                     | `docs/ocr/phase-b-labeling-worksheet.md`                                |
| `docs/cards/badges.md`, `docs/cards/blueprint.md`                        | `docs/specs/cards/`                                                     |
| `docs/cards/badge-catalog.md`, `card-system-brief.md` (untracked drafts) | `docs/specs/cards/`                                                     |
| `docs/cards/card-progression-deep-research-*.md`                         | `docs/research/`                                                        |
| `docs/reviews/Match-ID-UI-UX-Review.md`                                  | `docs/research/match-id-ui-ux-review.md`                                |
| `docs/reviews/*` (other two)                                             | `docs/research/`                                                        |
| `docs/retrospectives/2026-05-12-pre-game-ocr-and-research-rounds.md`     | `docs/ocr/2026-05-12-pre-game-ocr-and-research-rounds-retrospective.md` |
| `docs/runbook/ocr-corpus-mass-ingest.md`                                 | `docs/ocr/ocr-corpus-mass-ingest-runbook.md`                            |
| `docs/runbook/*` (other two)                                             | `docs/operations/runbooks/`                                             |
| `docs/operations/deploy-*.md`                                            | `docs/operations/records/`                                              |
| `docs/templates/player-profile-fields.md`                                | `docs/specs/player-dossiers/profile-fields-template.md`                 |

Deleted as exact duplicates: `docs/ocr/deep-research-report_3.md` (same as
`_2`), two `(1)` screenshots in `design/screenshots/`, and
`branding/icons/archive/duplicates/`. The root `SVG/` folder (untracked) was a
copy of `design/handoffs/2026-10-cards/badge-icons-src/`.
