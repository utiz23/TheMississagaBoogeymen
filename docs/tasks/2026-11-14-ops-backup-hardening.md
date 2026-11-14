# Task: Backup hardening — weekly/monthly copies after a missed day; one run at a time

- **State:** Deployed 2026-11-14 03:42 on Hotel-Echo (operator: "D1, approved")
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

- 2026-11-14 03:22 Lead2: written from the operator's "Proceed with both" (dashboard item "Backup
  hardening"). Items 2 and 4 as offered on 10-09; item 3 is in the same lines, so it is in.

- 2026-11-14 03:34 task agent: branch and worktree made; wrote `ops/nightly-backup/test/backup.test.sh` first; on the old
  `backup.sh` 19 of 33 checks failed (red as expected).
- 2026-11-14 03:34 task agent: changed `backup.sh` (ISO-week and month rule read from file names, one date per run, lock with
  `flock -n` on fd 9, own-`.partial` cleanup, main part runs only when executed) and the README. No Dockerfile
  change: busybox `flock` is in the Alpine image. 33 of 33 pass. Checks run, Report filled, State = Verify.

- 2026-11-14 03:39 Lead2: reviewed the diff line by line; re-ran the tests (33/33) and `bash -n`;
  checked read-only that the live `backup` container has `flock` (busybox, `/usr/bin/flock`). Added a
  prettier-only commit on the README (it was red on `main` before). Rebased, merged `--ff-only`.

- 2026-11-14 03:42 Lead2: deployed (operator "D1, approved"). The 03:00 run had finished (03:01, 5/5).
  `git pull` to `9ab1a87a`; rollback tag `eanhl-team-website-backup:rollback-he-2026-11-14-pre-hardening`;
  `build backup` + `up -d --no-deps backup`. The start-up run began 03:42:17; a second run at 03:42:22
  logged "another backup run is in progress; nothing done", exit 1 (lock works in the real image). The
  first run: restore 336 = 336 matches, B2 `eanhl-20261114T094217Z.dump`, 5/5 complete 03:43:44, and it
  made `weekly/eanhl-2026-11-14.dump` (this ISO week had no copy under the old Sunday rule). Monthly
  unchanged (`2026-11-01` exists).

Resume: check the 2026-11-15 03:00 run (5/5; no new weekly copy, because this week has one).

## Report (task agent fills when state = Verify)

- **What changed (visible effect):** `backup.sh`: one weekly copy per ISO week and one monthly copy per
  month, made by the first successful run that finds the slot empty (read from the file names; old Sunday/1st
  copies count). The weekly copy is now normally Monday's. All dates in a run come from `day` (taken once);
  `save_local` makes no `date` call. A lock (`flock -n` on `/tmp/eanhl-backup.lock`, fd 9) allows one run at a
  time: the second logs "another backup run is in progress; nothing done", touches no backup file, sends no
  ping, exits 1. `place_copy` removes only its own `.partial` files (name has this run's process number). Main
  part runs only when the file is executed. `BACKUP_DIR` and `LOCK_FILE` can be set from the environment
  (defaults `/backups`, `/tmp/eanhl-backup.lock`). README says the rules in plain words. No Dockerfile change.
- **How it was checked (commands, numbers):** `bash ops/nightly-backup/test/backup.test.sh` in a temp folder:
  33 of 33 pass (red first: 19 of 33 failed on the old script). Covers weekly/monthly rules, missed Sunday and
  missed 1st, old Sunday/1st copies, year change (2026-W53, 2020-W53, 2027-W01), iso_week vs GNU `date` on 15
  dates, prune keeps newest N, one date per run, `.partial` of another run kept, lock held means no change, no
  ping, exit non-zero. `bash -n` on both scripts: ok. `shellcheck`: not installed. `pnpm format:check`: red on
  `main` too (8 files, none of mine; my README edit adds no new prettier diff, my test and task file are clean).
- **Tried, no gain:** none.
- **Not done:** not run inside the real Alpine image (no Docker here): busybox `flock -n <fd>` and busybox
  `date`/`printf` behaviour are not tested there (iso_week uses only bash arithmetic, so it does not depend on
  busybox `date`). Suggest one manual check after the deploy: run `backup.sh` twice at once. Old `.partial`
  files left by a killed run are no longer swept (the old code swept all); they are small and rare, and a
  Lead decision. No deploy, no push, no merge.
- **Git state:** branch `work/backup-hardening`, rebased on `main` at 60eef6a7, checks pass (see above)

## Verifier result (Verifier fills)

- **Ran:**
- **Got:**
- **Compared with claim:**
- **Verdict:** pass | fail | pass with notes
