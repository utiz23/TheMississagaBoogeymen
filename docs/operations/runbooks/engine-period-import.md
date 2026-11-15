# Runbook: engine period import (P1)

Status: written 2026-11-14 with task `docs/tasks/2026-11-14-worker-period-import-p1.md`. Not deployed
until the operator gives the OK. Every `--apply` run needs the operator's OK and a fresh backup.

Readers: the operator and the website Lead.

## 1. What it does

- The engine (`eanhl-live-engine`) reads goals and shots per period from the recordings. It writes one
  file per game on the main PC: `~/projects/eanhl-live-engine/out/website-export/periods/<ea_match_id>.json`.
- The worker CLI `import-engine-periods` reads a folder of these files and writes the numbers to the
  table `match_period_summaries` with `source = 'engine_video'`.
- The site then shows "goals by period" on the game page, on the home latest-game panel and on the
  `/games` cards, with the small label "Read from video".
- EA data and rows of other sources (`ocr`, `ea`, `manual`) are never changed.

## 2. The rules the CLI enforces

| Rule                                                                                                                                                                      | If it fails                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `schema_version` is 1                                                                                                                                                     | File refused                                     |
| `complete` is true                                                                                                                                                        | File skipped (not an error)                      |
| Every field is the right type; periods are 1..N with no gap; N is at most 6 (OT3)                                                                                         | File refused                                     |
| The game title exists and the match (title + EA match id) exists in our database                                                                                          | File refused                                     |
| The period goals add up to **our database's EA final score**, on both sides                                                                                               | File refused, **nothing written for that match** |
| The file's own `final` equals its period goal sums                                                                                                                        | File refused                                     |
| The engine's `end_of_game_check` is never trusted alone: a file that is not complete AND does not add up to EA's final is shown `REFUSED` (cut recordings say "pass" too) | File refused (never written)                     |
| The file name is `<ea_match_id>.json` and the content has the same id; one file per match                                                                                 | File refused                                     |

- A match that passes gets goals and shots rows with their review columns set to `reviewed`. Faceoffs
  stay empty and `pending_review`. A match that fails gets no rows at all.
- The site checks the goal sum again when it reads (`getMatchPeriodSummaries`, `getEnginePeriodStrips`).
  A match whose engine rows do not add up to the EA final is shown without them.
- Rows of another source win: if a match also has reviewed OCR/EA rows, the game page shows those and
  not the engine rows.
- The opponent's name or abbreviation in the file is never read, shown or stored (it can be misread, for
  example PIK for DIK). The site always shows EA's opponent from our `matches` table.
- A period with no usable shot count (`shots_bm` / `shots_opp` null) is stored as null and shown as a dash.
  Goals of that match still import.
- Warnings in the table (never a refusal): `our_side` differs from EA home/away, more goals than shots
  in a period, the goal list differs from the goal counts, EA result is DNF. The column "shots (info)"
  compares the period shots with EA's whole-game shots. They can differ (EA counts shots its own way).
- Re-running is safe: the CLI replaces only that match's `engine_video` rows (one transaction), and
  leaves a match alone when the numbers have not changed.

## 3. Steps (the operator's OK for step 5; the Lead does 1 to 4 and 6 to 7)

1. **Copy the files to Hotel-Echo** (main PC, a fresh folder each time):

   ```
   rsync -a --delete ~/projects/eanhl-live-engine/out/website-export/periods/ hotel-echo:~/periods-import/
   ```

2. **Fresh backup** (on Hotel-Echo; use the date and time in the name):

   ```
   ssh hotel-echo 'docker exec eanhl-team-website-db-1 pg_dump -U eanhl -d eanhl -Fc --no-owner --no-privileges > ~/eanhl-backups/manual/eanhl-pre-periods-$(date +%F-%H%M).dump && ls -l ~/eanhl-backups/manual | tail -2'
   ```

3. **Put the files in the worker container** (the worker image must already contain the CLI: a
   `worker` redeploy per the `docker-redeploy` skill comes first):

   ```
   ssh hotel-echo 'cd ~/eanhl-team-website && docker compose exec worker rm -rf /tmp/periods && docker compose cp ~/periods-import worker:/tmp/periods'
   ```

4. **Dry run** (writes nothing; this is the default):

   ```
   ssh hotel-echo 'cd ~/eanhl-team-website && docker compose exec worker node dist/import-engine-periods-cli.js --dir /tmp/periods'
   ```

   Read the table. For each file it shows the match, EA's final, the period sum, the number of periods,
   the shots (info), the action and a note. Actions: `INSERT` (new rows), `REPLACE` (rows change),
   `UNCHANGED`, `SKIPPED` (engine says not complete), `REFUSED` (reason in the note).
   Check by hand: every `REFUSED` has a clear reason; the period sum equals the EA final on every
   `INSERT` / `REPLACE` line; no surprise match ids.

5. **Apply** (operator's OK first):

   ```
   ssh hotel-echo 'cd ~/eanhl-team-website && docker compose exec worker node dist/import-engine-periods-cli.js --dir /tmp/periods --apply'
   ```

6. **Check** (read-only):

   ```
   ssh hotel-echo 'docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "SELECT m.id, m.ea_match_id, m.score_for, m.score_against, sum(p.goals_for) gf, sum(p.goals_against) ga, count(*) periods FROM match_period_summaries p JOIN matches m ON m.id = p.match_id WHERE p.source = '"'"'engine_video'"'"' GROUP BY m.id ORDER BY m.id DESC"'
   ```

   `gf`/`ga` must equal `score_for`/`score_against` on every line. Then open two of the games on the
   site: the game page, the home latest-game panel (if it is one of them) and a `/games` card.

7. **Clean up**: `ssh hotel-echo 'rm -rf ~/periods-import'` and remove `/tmp/periods` in the container (it is
   lost at the next redeploy anyway).

## 4. Undo

Delete the `engine_video` rows of one match (the site shows the box again only after a new import):

```
ssh hotel-echo 'docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "DELETE FROM match_period_summaries WHERE source = '"'"'engine_video'"'"' AND match_id = 1234"'
```

Use a number list or no `match_id` clause to remove all engine rows. Never delete rows of another
source. The backup from step 2 restores everything.

## 5. Notes

- Dry run first, always. The CLI prints which database it talks to and "DRY RUN" or "APPLY" in its first line.
- The engine only exports games with a sure EA match id. A game it could not match is not in the folder.
- Faceoffs and player names are not part of step 1.
- To read only (no Hotel-Echo): the same dry run works on the main PC with a read-only tunnel to the live
  database; the table is the same.
