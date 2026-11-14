# Task: Backup hardening — weekly/monthly copies after a missed day; one run at a time

- **State:** Running (since 2026-11-14 03:24; task agent of `Lead2`)
- **Lane:** Ops
- **Risk:** medium (the nightly backup is the data-safety net; this changes which copies it keeps)
- **Slug:** backup-hardening (branch `work/backup-hardening`, worktree `.claude/worktrees/backup-hardening`)
- **Operator approval:** 2026-11-14 ("Proceed with both")
- **Operator gate before merge:** no (the Lead reviews the diff line by line); the deploy is the operator's OK
- **Needs a deploy:** yes: rebuild and restart the `backup` service on Hotel-Echo only (operator's OK;
  not at 03:00; the Lead checks the first scheduled run after it)
- **Helper model:** Sonnet

## Goal and visible result

From the Codex review of 2026-10-09 (journal `docs/journal/2026-10.md`, "Codex review of the nightly
backup done"), fix P2 items 2, 3 and 4 in `ops/nightly-backup/backup.sh`:

1. **Item 2 — missed weekly/monthly copy.** Today a weekly copy is made only when the run falls on a
   Sunday, a monthly copy only on the 1st. If that run is missed (machine off, a failure), the slot is
   lost. New rule: **one weekly copy per ISO week, made by the first successful run of that week; one
   monthly copy per calendar month, made by the first successful run of that month.** "Has this week /
   month a copy?" is read from the file names in `weekly/` and `monthly/` (`eanhl-YYYY-MM-DD.dump`). Old
   Sunday/1st copies count for their own week/month. Visible effect: the weekly copy is normally
   Monday's (the first run of an ISO week), not Sunday's; a missed day no longer loses a slot.
2. **Item 3 — date read after the dump.** All date decisions in one run (daily name, week, month) use
   the date taken once at the start of the run (`day`), never a second `date` call later.
3. **Item 4 — two runs at once.** A manual run (`docker compose exec backup backup.sh`) and the
   scheduled run can overlap, and each removes the other's `.partial` files. New rule: **only one run at
   a time** (a lock, for example `flock` on a file inside the container, if the image has it — check the
   `Dockerfile`). A run that finds the lock taken logs "another backup run is in progress; nothing done",
   touches no files, sends **no** Healthchecks.io ping (the running one reports), and exits non-zero.
   `place_copy` removes only its own `.partial` files, not every `.*.partial` in the folder.

Not in scope: item 1 (blank `HC_PING_URL` disables alerts; live has it set), the retention counts, B2,
the restore test, `ops/backup/` (the older Proton/E3 tool).

## Paths

- **May edit:** `ops/nightly-backup/backup.sh`, `ops/nightly-backup/Dockerfile` (only if the lock tool
  must be added), `ops/nightly-backup/README.md` (the rules above, in plain words), new
  `ops/nightly-backup/test/` (tests), this task file.
- **Shared paths needed (Lead OK required):** none
- **Must not touch:** everything else; never the real backup folders on any machine.

## Checks

- **Checks (guide section 6):** `pnpm format:check`; `bash -n` on every changed script; `shellcheck` if it
  is installed (say "not installed" if not).
- **Tests (new, plain bash, must run on the main PC without Docker, in a temp folder only):** make the
  date logic and the lock testable (for example, `backup.sh` only runs its main part when executed, not
  when sourced; the date can be passed in). Test: first run of a week makes a weekly copy, a second run
  in the same week does not; a week whose Sunday was missed still gets one; same for months, including a
  missed 1st; an old Sunday copy counts for its week; year change (ISO week 1 / week 52–53); prune still
  keeps the newest N; a second run while the lock is held does nothing and exits non-zero without a
  Healthchecks call; `place_copy` leaves another run's `.partial` file alone.
- **Evidence:** the test output; the diff of `backup.sh`.

## Done when (written before the work starts)

- **Done when:** all checks pass and the tests above pass; reason: a missed night must not lose a
  weekly/monthly copy, and two runs must never damage each other's files.
- **Not done if:** any change to retention counts, the dump, the restore test or the B2 upload; or a
  test touches a real backup folder.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 03:24 Lead2: written from the operator's "Proceed with both" (dashboard item "Backup
  hardening"). Items 2 and 4 as offered on 10-09; item 3 is in the same lines, so it is in.

Resume: task agent makes the branch and worktree, then writes the tests first.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Tried, no gain:**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail

## Verifier result (Verifier fills)

- **Ran:**
- **Got:**
- **Compared with claim:**
- **Verdict:** pass | fail | pass with notes
