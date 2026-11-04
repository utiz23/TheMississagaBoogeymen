> Seed copy, NOT in force here. Copied unchanged from `eanhl-live-engine` `docs/operations/workflow-v2.md` at commit b9e2914 (2026-11-04). Engine paths and names below are the engine's; see README.md for what to adapt.

# Workflow v2: cards, lanes, one lead

Status: in force from 2026-11-03 (switch-over done 2026-11-04). Replaces the
chat-per-milestone setup. `CLAUDE.md` "Who does what" summarises it.

Written for: the operator first, then every Claude session on this project.

## 1. Why change

- Chats live for weeks, grow large and change names. State sits in chat memory
  and in prose rules.
- Many chats commit to `main`. Patches travel as `.patch` files in
  `docs/planning/`. 13 old worktrees sit outside the repo.
- The M3 chat does the hardest technical work and also coordinates all chats.
- No CI. Acceptance numbers are copied by hand.
- The real limits are the operator's decision time, one GPU and 12 CPU
  threads. More chats do not raise them. They only lengthen the queue of
  waiting decisions.

## 2. Roles

| Role | Count | Does | Does not |
|---|---|---|---|
| **Operator** | 1 | Approves cards, decides, marks data, accepts milestones | – |
| **Lead** | 1 session | Writes cards, keeps the board, merges verified branches, keeps `HANDOFF.md` and the journal, prepares the weekly decision page | Run experiments, tune, edit engine code, decide what is the operator's |
| **Task agent** | 1 per card | Does one card in its own branch and worktree, reports on the card | Merge to `main`, edit outside its card's paths, start work without a Ready card |
| **Verifier** | 1 per card with a claim | Re-runs the checks on the branch, reports pass or fail | Fix the code, see the author's claimed number before it has its own |
| **Codex** | optional | Second opinion on risky design choices (operator types the command) | – |

Seniority between sessions is gone. The Lead coordinates. The operator decides.
The rule stays: a session may not do, or ask for, what the operator has not
allowed.

## 3. Cards

A **card** is one file in `docs/cards/`, made from `docs/cards/TEMPLATE.md`.
Name: `YYYY-MM-DD-<lane>-<slug>.md`. One goal per card. If the scope grows,
write a new card. A card should end within one or two agent sessions.

States:

| State | Meaning | Who moves it |
|---|---|---|
| Proposed | Written, not approved | Lead or any session writes it |
| Ready | The operator approved it. Go rule is written. | Operator (tells the Lead) |
| Running | A task agent has it | Task agent |
| Verify | Done by the agent. Report written. Rebased on `main`. | Task agent |
| Merged | Checks passed, branch is in `main` | Lead |
| Parked | Stopped on purpose, with the reason on the card | Lead or operator |
| Dropped | Not wanted any more | Operator |

The **board** is `docs/board.md`: one table, one line per open card. Only the
Lead edits it. Task agents edit only their own card.

## 4. Lanes

A lane is a set of paths with one run tag. A card names its lane and the exact
paths it may edit. Card S-2 (2026-11-03) made this map complete: every tracked
file has one row. `tools/check_card_paths.py` reads this table, so keep one row
per line and put each path in backticks. Text outside backticks is a note.

A path is a file, a folder (`dir/` or `dir`) or a glob (`*` stays inside one
folder). When two rows cover the same file, the most specific path wins: a file
name beats a glob, a glob beats a folder, a longer path beats a shorter one.

| Lane | Tag | Paths | Old chat |
|---|---|---|---|
| Geometry | M1 | `engine/rink`, `calibration/` (see note), `tests/rink`, `tests/fixtures/rink`, `tests/rink_answers.py`, `tests/rink_synth.py`, `tests/test_rink_*`, `tests/test_mark_rink_points.py`, `tests/test_fit_*`, `tests/test_check_m1*`, `tools/*rink*`, `tools/check_m1*`, `tools/fit_*` | M1 |
| Detection | M2 | `engine/figures`, `models/` (build products), `tests/figures`, `tests/test_figures_*`, `tests/test_check_m2*`, `tests/test_train_detector.py`, `tests/test_export_detector.py`, `tests/test_mark_figures.py`, `tests/test_pick_*_frames.py`, `tests/test_filter_pieces.py`, `tools/check_m2*`, `tools/train_detector.py`, `tools/export_detector.py`, `tools/mark_figures.py`, `tools/pick_figure_frames.py`, `tools/pick_hard_frames.py`, `tools/pick_crowd_frames.py`, `tools/filter_pieces.py`, `tools/measure_rings27.py`, `tools/ring_palette_effect.py` | M2 |
| Tracking | M3 | `engine/tracking`, `tests/tracking`, `tests/fixtures/tags`, `tests/test_tracking_*`, `tests/test_check_m3*`, `tests/test_mark_identity.py`, `tools/check_m3*`, `tools/mark_identity.py`, `tools/pick_identity_clips.py` | M3 |
| Text | MT | `engine/readers`, `engine/text`, `engine/ocr`, `tests/text`, `tests/acceptance` (M0 answers), `tests/fixtures/text`, `tests/fixtures/scorebug`, `tests/test_text_*`, `tests/text_*_lines.py`, `tests/test_scorebug_*`, `tests/test_glyphs.py`, `tests/test_check_t*`, `tests/test_mark_text_times.py`, `tools/check_t*`, `tools/check_m0_acceptance.py`, `tools/scan_scorebug.py`, `tools/harvest_glyphs.py`, `tools/mark_text_times.py`, `tools/make_endgame_review.py` | MT |
| Client | APP | `app/`, `engine/drawing.py`, `engine/preview.py`, `engine/review`, `tests/review`, `tests/test_app_*`, `tests/test_preview.py`, `tests/test_viewer.py`, `tools/viewer.py`, `tools/make_event_reviews.py` | Rinkside |
| Platform | 2A | `engine/jobs.py`, `tools/run_queue.py`, `tools/obs`, `tools/progress.py`, `tools/check_card_paths.py`, `tools/preflight.py`, `tools/new_worktree.py`, `tools/scoreboard.py`, `tests/test_jobs.py`, `tests/test_run_queue_tool.py`, `tests/test_progress.py`, `tests/test_obs_*`, `tests/fixtures/obs`, `tests/test_check_card_paths.py`, `tests/test_preflight.py`, `tests/test_new_worktree.py`, `tests/test_scoreboard.py`, `.github/`, CI, preflight, backups, installs | 2A |
| Shared | – | `engine/__init__.py`, `engine/types.py`, `engine/timeline`, `engine/pipeline.py`, `engine/cli.py`, `engine/sources`, `engine/status.py`, `pyproject.toml`, `uv.lock`, `CLAUDE.md`, `.gitignore`, `.claude/settings.json`, `tools/__init__.py`, `tests/__init__.py`, `tests/conftest.py`, `tests/clips`, `tests/clip_answers.py`, `tests/test_pipeline_*`, `tests/test_counters.py`, `tests/test_games.py`, `tests/test_moments.py`, `tests/test_smoothing.py`, `tests/test_writer.py`, `tests/test_file_source.py`, `tests/test_prefetch.py`, `tests/test_smoke.py` | – |
| Lead | – | `HANDOFF.md`, `docs/board.md`, `docs/journal/`, `.claude/skills/handoff-update/` | – |
| No lane | – | `docs/`, `README.md`, `engine/arrows` (shelved), `tools/arrows_*`, `tests/test_arrows_*`, `tests/fixtures/arrows`, `tests/audio` (sound study), `tools/mark_events.py`, `tests/test_mark_events.py`, `tools/cut_clip.py`, `tools/dump_frames.py`, `tools/fetch_roster.py` (Tracking and Text both use it) | – |

Rules for the rows:

- **Tests** are flat files, `tests/test_<topic>_*.py`. A test file belongs to the
  lane of the code it tests.
- **Answer files.** `tests/rink/`, `tests/figures/`, `tests/tracking/`,
  `tests/text/` and `tests/acceptance/` hold the operator's answers and marks,
  not test code. An answer file changes only on a card that names it (the file
  or its folder) and has the operator's OK for that change.
- **Shared** paths need a card that names them and the Lead's OK in writing on
  the card. Two open cards may not name the same shared path.
- **Lead** paths: only the Lead edits them. A task agent edits only its own card.
- **No lane:** nobody owns these paths. A card may edit one only when it names
  it. `docs/` is not a lane: a card may edit the docs it names.
- **Note on `calibration/`:** Geometry owns all of it today, but most files in
  it are scorebug glyphs (`calibration/nhl27/scorebug/`, Text) and ring
  palettes (`calibration/*/rings.yaml`, Detection). A split is a Lead decision
  (S-2 report).

**Sealed** (no card may name it; the checker reports any change to it): `tests/tracking/ids_2026-06-24_17-10-11_g4.yaml` (M3 final gate).

Checks: `uv run python tools/check_card_paths.py --lanes` lists every tracked
file that no row covers, or that two rows cover equally.
`uv run python tools/check_card_paths.py docs/cards/<card>.md --branch work/<slug>`
lists every path the branch changed outside the card's "May edit" paths.

Client run tag: **`APP`** (operator, 2026-11-03). Rinkside shows it as a grey chip
until a Client card gives it a colour.

## 5. Git rules

One branch and one worktree per card. The agent runs this from any checkout
of the repo (replace `<slug>`):

```
uv run python tools/new_worktree.py <slug>
```

It does these steps (it refuses if the branch or folder
exists, and it never removes anything):

```
git worktree add -b work/<slug> ~/work/<slug> main
cd ~/work/<slug>
uv sync                                  # own .venv; never share the main one
ln -s /home/michal/projects/eanhl-live-engine/models models
ln -s /home/michal/projects/eanhl-live-engine/out out
```

Why: the editable install in a `.venv` points to the tree that made it. A shared
`.venv` would test main's code, not the branch. `models/` and `out/` are
git-ignored and not in a new worktree. The `.gitignore` entries end in `/`, so
they do not match a symlink. The script adds the lines `/models` and `/out`
once to `$(git rev-parse --git-common-dir)/info/exclude` so `git status` stays
clean. A first `uv sync` can be large (the `.venv` of `m1-c` is
11 GB). Disk is no problem (831 GB free); time is.

- Work and commit on `work/<slug>` only. Commit messages follow `CLAUDE.md`.
- Runs write to `out/<slug>/` and carry the card's run tag.
- Before state **Verify**: `git rebase main` in the worktree, then the preflight
  list (section 6).
- Only the Lead merges, with `git merge --ff-only work/<slug>`. If that fails,
  the Lead may rebase the branch itself when the rebase has no conflicts and the
  preflight passes again afterwards (operator, 2026-11-03). Any conflict: the
  card goes back to Running for a new rebase.
- No `.patch` files. The branch is the result.
- After the merge the Lead removes the worktree and deletes the branch. Never
  remove a worktree with commits that are not in `main` or on a named branch.

## 6. Checks

Preflight (the agent runs it; the Lead repeats it before the merge):

```
uv run python tools/preflight.py --card docs/cards/<card>.md
```

It runs, one line per step and a final PASS or FAIL (exit 1 on any failure):

```
uv run ruff check . && uv run ruff format --check .
uv run pyright
uv run pytest -q -m "not clips"
uv run python tools/check_card_paths.py <card> --base main   # path check
```

If `tools/check_card_paths.py` is not in the tree, or no `--card` is given, it
prints the changed paths (`git diff --name-only main...HEAD`) and says "path
check: by hand": every path must be inside the card's paths.

It adds the clips tests (`pytest -m clips`) by itself when the diff touches
`engine/`, and the app checks (`uv run --directory app pytest -q` and
`uv run --directory app pyright`) when it touches `app/`. `--clips` and `--app`
force them. A GitHub Action (`.github/workflows/ci.yml`) runs ruff, pyright and
the quick tests on every push to `main`.

## 7. Evidence rules (kept from the old rules)

- Acceptance runs on EASHL club games only. Every report names its footage
  ("club games only: N games, M frames"). Goalie camera is ignored. Both
  policies in `CLAUDE.md` stand, with their T exceptions.
- Held-out games are scored **before** any tuning on them. The gap to the tuned
  games goes in the report.
- The go rule is written on the card **before** the run. A rule needs a reason
  from the game, not only a number that fits.
- **New:** any card that claims a number gets a Verifier. The Verifier runs the
  checker on the branch first, then compares its result with the claim. A gap
  larger than the card's tolerance sends the card back.
- A "tried, no gain" result is kept: it goes in the card's Report, and the Lead
  copies it to the topic's evidence doc.

## 8. Limits and rhythm

**Limits.** At most 3 task agents run at once. At most 1 of them uses the GPU
or a heavy queue job at a time. The operator has at most 3 open decisions. If
3 wait, the Lead starts no card that creates a fourth.

**Week.**
1. *Plan, 10 minutes.* The Lead shows the board and proposed cards. The operator
   says which are Ready.
2. *Run.* Task agents work. The queue runs at night.
3. *Review, one sitting.* The Lead shows one page: cards in Verify, results, and
   the decisions needed, sorted by what waiting costs. The operator decides and
   does the marking.

**New Lead chat.** The Lead reminds the operator to start a new Lead chat:
once a week, at the end of the review (after the board, `HANDOFF.md` and the
journal are updated); and sooner when the Lead chat's context is full or has
been compacted, or when the Lead forgets an agreement or errs on the board or a
merge. Never in the middle of a merge or while an operator answer is pending.
The state lives in files, so a new Lead loses nothing.

**Documents.** The operator's live page is `docs/decisions.md`: what waits for the
operator, what can start, what comes soon. The Lead updates it after every
merge, decision or new Ready card. The detail lives on the card. A code commit carries its own docs.
The Lead writes the journal weekly. `HANDOFF.md` is an index: five or six lines
per lane, each with a link to the card. Target 100–150 lines.

## 9. Switch-over

Do not stop running jobs. The queue belongs to the queue, not to a chat.

**Done 2026-11-04:** steps 1 to 6 are all done (Lead card `lead-claude-md-v2` for step 6).

1. **Wait for the night queue** (M1 maps, MT text, 01-30 map, M2 reruns A and B)
   or start anyway; the switch does not touch queue jobs.
2. **Wrap up each old chat.** Paste prompt P0 from `kickoff-prompts.md` into M1,
   M2, M3, MT, Rinkside (and 2A if open). Each one writes handoff cards for its
   open work, lists its branches and worktrees, and stops.
3. **Start the Lead** (prompt P1) in a new chat. It reads the handoff cards,
   builds the board, writes the setup cards S-1 to S-4 (list in `docs/board.md`)
   and shows you the first decision page.
4. **Approve the setup cards.** Start task agents for them (prompt P2). They set
   up cleanup, preflight, CI and the scoreboard.
5. **From then on**, new work starts as a card. Old chats stay closed.
6. **Change `CLAUDE.md`** (a Lead card, your approval): replace "Chats and who
   decides" with the lanes in section 4; keep the run-tag rule; update
   `how-we-work.md` roles.

Lost context is the main risk of closing long chats. P0 asks each chat to write
down facts learned the hard way (the card's "Hard-won facts" section). Read
those before you approve closing a chat.

## 10. What stays

The operator decides. Process is sized to risk. Plain language (STE). Say what is
not done. Test on real captured frames. One focused commit per verified step.
Never commit broken work. No force-push or new GitHub branches pushed without
the operator's OK (local `work/*` branches are fine; push them only when a card
says so).
